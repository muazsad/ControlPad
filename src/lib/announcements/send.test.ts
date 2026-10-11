import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SendSmsInput, SmsResult } from "@/lib/sms/send-sms";

import { sendAnnouncement, sendDueAnnouncements, type AnnouncementDatabase } from "./send";

function fakeDb(rows: { id: string; message: string; audience: string[] | null; status: string; due: boolean }[]) {
  const finished: Record<string, unknown>[] = [];
  const database: AnnouncementDatabase = {
    async claim(id) {
      const row = rows.find((item) => item.id === id && item.status === "scheduled");
      if (!row) return null;
      row.status = "sending";
      return { id: row.id, message: row.message, audience: row.audience };
    },
    async findDue() {
      return rows.filter((row) => row.status === "scheduled" && row.due).map((row) => row.id);
    },
    async getActiveStudents() {
      return [
        { groupId: "full", guardians: [{ phone: "+14135550101" }] },
        { groupId: "quran", guardians: [{ phone: "+14135550101" }, { phone: "+14135550202" }] },
      ];
    },
    async finish(id, patch) {
      finished.push({ id, ...patch });
      const row = rows.find((item) => item.id === id);
      if (row) row.status = patch.status;
    },
  };
  return { database, finished };
}

function recorder(status: SmsResult["status"] = "sent") {
  const sent: SendSmsInput[] = [];
  return {
    sent,
    sendSms: async (input: SendSmsInput): Promise<SmsResult> => {
      sent.push(input);
      return status === "failed"
        ? { status: "failed", notification: null, error: "nope" }
        : ({ status, notification: null } as SmsResult);
    },
  };
}

const now = () => new Date("2026-10-12T14:00:00.000Z");

describe("sendAnnouncement", () => {
  it("texts each family once with the school prefix and records the result", async () => {
    const db = fakeDb([{ id: "a1", message: "No school Friday", audience: null, status: "scheduled", due: false }]);
    const sms = recorder();
    const result = await sendAnnouncement("a1", { database: db.database, sendSms: sms.sendSms, now, mode: "live" });

    assert.deepEqual(result, { status: "sent", recipients: 2, failed: 0, mode: "live" });
    assert.deepEqual(sms.sent.map((m) => m.recipientPhone), ["+14135550101", "+14135550202"]);
    assert.equal(sms.sent[0].body, "Salaam Institute: No school Friday");
    assert.equal(sms.sent[0].triggerType, "announcement");
    assert.equal(sms.sent[0].dedupeKey, "announcement:a1");
    assert.equal(db.finished[0].status, "sent");
    assert.equal(db.finished[0].recipients, 2);
  });

  it("only sends to the chosen groups", async () => {
    const db = fakeDb([{ id: "a1", message: "hi", audience: ["full"], status: "scheduled", due: false }]);
    const sms = recorder();
    await sendAnnouncement("a1", { database: db.database, sendSms: sms.sendSms, now, mode: "live" });
    assert.deepEqual(sms.sent.map((m) => m.recipientPhone), ["+14135550101"]);
  });

  it("never sends the same announcement twice", async () => {
    const db = fakeDb([{ id: "a1", message: "hi", audience: null, status: "scheduled", due: false }]);
    const sms = recorder();
    await sendAnnouncement("a1", { database: db.database, sendSms: sms.sendSms, now, mode: "live" });
    const again = await sendAnnouncement("a1", { database: db.database, sendSms: sms.sendSms, now, mode: "live" });
    assert.deepEqual(again, { status: "not_claimed" });
    assert.equal(sms.sent.length, 2);
  });

  it("marks it failed when every text fails", async () => {
    const db = fakeDb([{ id: "a1", message: "hi", audience: null, status: "scheduled", due: false }]);
    const result = await sendAnnouncement("a1", {
      database: db.database,
      sendSms: recorder("failed").sendSms,
      now,
      mode: "live",
    });
    assert.equal(result.status, "failed");
    assert.equal(db.finished[0].status, "failed");
  });
});

describe("sendDueAnnouncements", () => {
  it("sends only due, still-scheduled announcements", async () => {
    const db = fakeDb([
      { id: "due", message: "hi", audience: null, status: "scheduled", due: true },
      { id: "later", message: "hi", audience: null, status: "scheduled", due: false },
      { id: "cancelled", message: "hi", audience: null, status: "cancelled", due: true },
    ]);
    const sms = recorder("dry_run");
    const result = await sendDueAnnouncements(now(), { database: db.database, sendSms: sms.sendSms });
    assert.deepEqual(result, { sent: 1 });
    assert.deepEqual(db.finished.map((row) => row.id), ["due"]);
  });
});
