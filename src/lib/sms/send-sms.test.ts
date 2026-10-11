import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideDedupe,
  getSmsConfig,
  maskPhone,
  MAX_FAILED_SEND_ATTEMPTS,
  sendSms,
  type RecentNotification,
  type SmsDatabase,
} from "./send-sms";

type NotificationRow = {
  recipient_phone: string;
  recipient_type: string;
  student_id: string | null;
  trigger_type: string;
  body: string;
  status: string;
  error?: string | null;
  dedupe_key?: string | null;
  delivery_mode?: string;
};

class FakeSmsDatabase implements SmsDatabase {
  rows: NotificationRow[];

  constructor(rows: NotificationRow[] = []) {
    this.rows = rows;
  }

  async findRecentNotifications(input: {
    recipientPhone: string;
    studentId: string | null;
    triggerType: string;
    since: Date;
    dedupeKey?: string | null;
  }): Promise<RecentNotification[]> {
    return this.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) =>
        row.recipient_phone !== input.recipientPhone
          ? false
          : input.dedupeKey
            ? row.dedupe_key === input.dedupeKey
            : row.student_id === input.studentId &&
              row.trigger_type === input.triggerType,
      )
      .reverse()
      .map(({ row, index }) => ({
        id: String(index + 1),
        status: row.status as RecentNotification["status"],
        delivery_mode: (row.delivery_mode ?? null) as RecentNotification["delivery_mode"],
      }));
  }

  async insertNotification(row: NotificationRow) {
    this.rows.push(row);
    return { id: String(this.rows.length), ...row };
  }

  updates: { id: string; patch: Record<string, unknown> }[] = [];

  async updateNotification(id: string, patch: Record<string, unknown>) {
    this.updates.push({ id, patch });
    return { id, ...patch };
  }
}

describe("sendSms", () => {
  it("does not insert or send when a recent duplicate notification exists", async () => {
    const database = new FakeSmsDatabase([
      {
        recipient_phone: "+14135550100",
        recipient_type: "admin",
        student_id: "student-1",
        trigger_type: "low_grade",
        body: "Existing alert",
        status: "queued",
      },
    ]);
    let fetchCalled = false;

    const result = await sendSms(
      {
        recipientPhone: "+14135550100",
        recipientType: "admin",
        studentId: "student-1",
        triggerType: "low_grade",
        body: "New alert",
      },
      {
        database,
        fetch: async () => {
          fetchCalled = true;
          throw new Error("fetch should not run");
        },
        env: {},
      },
    );

    assert.equal(result.status, "duplicate");
    assert.equal(database.rows.length, 1);
    assert.equal(fetchCalled, false);
  });

  it("logs a dry-run notification when Twilio env vars are missing", async () => {
    const database = new FakeSmsDatabase();

    const result = await sendSms(
      {
        recipientPhone: "+14135550100",
        recipientType: "admin",
        studentId: "student-1",
        triggerType: "low_grade",
        body: "Low grade alert",
      },
      {
        database,
        fetch: async () => {
          throw new Error("fetch should not run without env vars");
        },
        env: {},
      },
    );

    assert.equal(result.status, "dry_run");
    assert.equal(database.rows.length, 1);
    assert.equal(database.rows[0].status, "dry_run");
    assert.equal(database.rows[0].delivery_mode, "off");
    assert.match(database.rows[0].error ?? "", /not configured/i);
  });

  const twilioEnv = {
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "token",
    TWILIO_PHONE_NUMBER: "+14135559999",
  };

  it("redirects every message to SMS_TEST_NUMBER in test mode", async () => {
    const database = new FakeSmsDatabase();
    let sentBody: URLSearchParams | null = null;

    const result = await sendSms(
      {
        recipientPhone: "+14135550101",
        recipientType: "parent",
        studentId: "student-1",
        triggerType: "absence",
        body: "Amina was marked absent.",
      },
      {
        database,
        env: { ...twilioEnv, SMS_MODE: "test", SMS_TEST_NUMBER: "+14135550000" },
        fetch: (async (_url: string, init: RequestInit) => {
          sentBody = init.body as URLSearchParams;
          return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
        }) as typeof fetch,
      },
    );

    assert.equal(result.status, "sent");
    assert.ok(sentBody);
    const body = sentBody as URLSearchParams;
    assert.equal(body.get("To"), "+14135550000");
    assert.match(body.get("Body") ?? "", /^\[TEST to parent •••0101\] Amina/);
    // The log keeps the real intended recipient.
    assert.equal(database.rows[0].recipient_phone, "+14135550101");
    assert.equal(database.rows[0].delivery_mode, "test");
  });

  it("dedupes on dedupeKey when provided", async () => {
    const database = new FakeSmsDatabase([
      {
        recipient_phone: "+14135550100",
        recipient_type: "admin",
        student_id: null,
        trigger_type: "absence_review",
        body: "Earlier batch",
        status: "dry_run",
        dedupe_key: "absence_review:2026-10-12:g1",
      },
    ]);
    const send = (key: string) =>
      sendSms(
        {
          recipientPhone: "+14135550100",
          recipientType: "admin",
          studentId: null,
          triggerType: "absence_review",
          body: "Batch",
          dedupeKey: key,
        },
        { database, env: {} },
      );

    assert.equal((await send("absence_review:2026-10-12:g1")).status, "duplicate");
    assert.equal((await send("absence_review:2026-10-12:g2")).status, "dry_run");
  });

  const lowGradeAlert = {
    recipientPhone: "+14135550101",
    recipientType: "parent" as const,
    studentId: "student-1",
    triggerType: "low_grade" as const,
    body: "Low grade alert",
  };
  const priorRow = (status: string, deliveryMode = "live"): NotificationRow => ({
    recipient_phone: "+14135550101",
    recipient_type: "parent",
    student_id: "student-1",
    trigger_type: "low_grade",
    body: "Earlier alert",
    status,
    delivery_mode: deliveryMode,
  });
  const okFetch = (async () =>
    new Response(JSON.stringify({ sid: "SM2" }), { status: 201 })) as unknown as typeof fetch;

  it("does not let an earlier dry run block a real send", async () => {
    const database = new FakeSmsDatabase([priorRow("dry_run", "off")]);
    const result = await sendSms(lowGradeAlert, { database, env: twilioEnv, fetch: okFetch });
    assert.equal(result.status, "sent");
    assert.equal(database.rows.length, 2);
  });

  it("does not let an earlier failed send block a retry", async () => {
    const database = new FakeSmsDatabase([priorRow("failed")]);
    const result = await sendSms(lowGradeAlert, { database, env: twilioEnv, fetch: okFetch });
    assert.equal(result.status, "sent");
  });

  it("still dedupes against sent and queued notifications", async () => {
    for (const status of ["sent", "queued"]) {
      const database = new FakeSmsDatabase([priorRow(status)]);
      const result = await sendSms(lowGradeAlert, {
        database,
        env: twilioEnv,
        fetch: (async () => {
          throw new Error("fetch should not run");
        }) as typeof fetch,
      });
      assert.equal(result.status, "duplicate", status);
    }
  });

  it("dedupes dry runs against dry runs while texting is off", async () => {
    const database = new FakeSmsDatabase([priorRow("dry_run", "off")]);
    const result = await sendSms(lowGradeAlert, { database, env: {} });
    assert.equal(result.status, "duplicate");
    assert.equal(database.rows.length, 1);
  });

  it("does not let a test-mode text block the live alert", async () => {
    const database = new FakeSmsDatabase([priorRow("sent", "test")]);
    const result = await sendSms(lowGradeAlert, { database, env: twilioEnv, fetch: okFetch });
    assert.equal(result.status, "sent");
  });

  it("stops retrying after the max number of failed sends", async () => {
    const database = new FakeSmsDatabase(
      Array.from({ length: MAX_FAILED_SEND_ATTEMPTS }, () => priorRow("failed")),
    );
    const result = await sendSms(lowGradeAlert, {
      database,
      env: twilioEnv,
      fetch: (async () => {
        throw new Error("fetch should not run");
      }) as typeof fetch,
    });
    assert.equal(result.status, "gave_up");
    assert.equal(database.rows.length, MAX_FAILED_SEND_ATTEMPTS);
  });

  it("logs a new dry run after a failed send while texting is off", async () => {
    const database = new FakeSmsDatabase([priorRow("failed")]);
    const result = await sendSms(lowGradeAlert, { database, env: {} });
    assert.equal(result.status, "dry_run");
  });
});

describe("getSmsConfig", () => {
  const twilio = {
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "token",
    TWILIO_PHONE_NUMBER: "+14135559999",
  };

  it("is off until Twilio is configured", () => {
    assert.equal(getSmsConfig({}).mode, "off");
    assert.equal(getSmsConfig({ SMS_MODE: "live" }).mode, "off");
  });

  it("defaults to live once Twilio is configured", () => {
    assert.equal(getSmsConfig(twilio).mode, "live");
  });

  it("honours off and test, and requires a test number for test", () => {
    assert.equal(getSmsConfig({ ...twilio, SMS_MODE: "off" }).mode, "off");
    assert.equal(getSmsConfig({ ...twilio, SMS_MODE: "test" }).mode, "off");
    assert.equal(
      getSmsConfig({ ...twilio, SMS_MODE: "test", SMS_TEST_NUMBER: "+14135550000" }).mode,
      "test",
    );
    assert.equal(getSmsConfig({ ...twilio, SMS_MODE: "bogus" }).mode, "off");
  });

  it("masks phone numbers", () => {
    assert.equal(maskPhone("+14135550101"), "•••0101");
  });
});

describe("decideDedupe", () => {
  const row = (
    status: RecentNotification["status"],
    delivery_mode: RecentNotification["delivery_mode"],
  ): RecentNotification => ({ id: "n", status, delivery_mode });

  it("sends when there is nothing recent", () => {
    assert.equal(decideDedupe([], "live").action, "send");
  });

  it("treats rows logged before delivery modes existed as same-mode", () => {
    assert.equal(decideDedupe([row("sent", null)], "live").action, "duplicate");
  });

  it("lets a real live send block a dry run while texting is off", () => {
    assert.equal(decideDedupe([row("sent", "live")], "off").action, "duplicate");
  });

  it("only counts same-mode failures toward the retry cap", () => {
    const testFailures = Array.from({ length: MAX_FAILED_SEND_ATTEMPTS }, () =>
      row("failed", "test"),
    );
    assert.equal(decideDedupe(testFailures, "live").action, "send");
    assert.equal(decideDedupe(testFailures, "test").action, "gave_up");
  });
});
