import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sendSms, type SmsDatabase } from "./send-sms";

type NotificationRow = {
  recipient_phone: string;
  recipient_type: string;
  student_id: string | null;
  trigger_type: string;
  body: string;
  status: string;
  error?: string | null;
};

class FakeSmsDatabase implements SmsDatabase {
  rows: NotificationRow[];

  constructor(rows: NotificationRow[] = []) {
    this.rows = rows;
  }

  async findRecentNotification(input: {
    recipientPhone: string;
    studentId: string | null;
    triggerType: string;
    since: Date;
  }) {
    return (
      this.rows.find(
        (row) =>
          row.recipient_phone === input.recipientPhone &&
          row.student_id === input.studentId &&
          row.trigger_type === input.triggerType,
      ) ?? null
    );
  }

  async insertNotification(row: NotificationRow) {
    this.rows.push(row);
    return { id: String(this.rows.length), ...row };
  }

  async updateNotification() {
    throw new Error("updateNotification should not be called in this test");
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

  it("logs a queued dry-run notification when Twilio env vars are missing", async () => {
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

    assert.equal(result.status, "queued");
    assert.equal(database.rows.length, 1);
    assert.equal(database.rows[0].status, "queued");
    assert.match(database.rows[0].error ?? "", /dry run/i);
  });
});
