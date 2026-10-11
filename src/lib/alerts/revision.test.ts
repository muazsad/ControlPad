import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_WEEKLY_PATTERN } from "@/lib/schedule/calendar";
import type { SendSmsInput } from "@/lib/sms/send-sms";

import { checkRevisionOverdueAlerts, type RevisionAlertDatabase, type RevisionStudent } from "./revision";

function database(students: RevisionStudent[]): RevisionAlertDatabase {
  return {
    async getRevisionOverdueSchoolDays() {
      return 5;
    },
    async getSchoolCalendar() {
      return { weeklyPattern: DEFAULT_WEEKLY_PATTERN, breaks: [], specialDays: [] };
    },
    async getAdminRecipients() {
      return [{ full_name: "Director", phone: "+14135550001" }];
    },
    async getStudents() {
      return students;
    },
  };
}

const yusuf: RevisionStudent = {
  id: "s1",
  name: "Yusuf Ali",
  memorized: [
    { juz: 3, markedAt: "2026-09-01" },
    { juz: 7, markedAt: "2026-09-01" },
    { juz: 12, markedAt: "2026-09-01" },
    { juz: 20, markedAt: "2026-09-01" },
    { juz: 30, markedAt: "2026-09-01" },
  ],
  entries: [{ date: "2026-10-12", lesson_type: "dhor", juz: 30 }], // juz 30 is fresh
  guardians: [{ full_name: "Parent", phone: "+14135550002" }],
};

async function run(date: string, students: RevisionStudent[]) {
  const sent: SendSmsInput[] = [];
  const result = await checkRevisionOverdueAlerts(date, {
    database: database(students),
    sendSms: async (message) => {
      sent.push(message);
      return { status: "sent" } as never;
    },
  });
  return { result, sent };
}

describe("checkRevisionOverdueAlerts", () => {
  it("sends one capped SMS per student to parent and admin, deduped by ISO week", async () => {
    const { result, sent } = await run("2026-10-12", [yusuf]); // Monday
    assert.equal(result.students, 1);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.map((s) => s.recipientType).sort(), ["admin", "parent"]);
    assert.ok(sent.every((s) => s.triggerType === "revision_overdue"));
    assert.ok(sent.every((s) => s.dedupeKey === "revision_overdue:s1:2026-W42"));
    assert.equal(
      sent[0].body,
      "Salaam Institute: Yusuf hasn't revised Juz 3, 7 and 2 more in over a month. Please encourage review at home.",
    );
  });

  it("skips no-school days", async () => {
    const { result, sent } = await run("2026-10-11", [yusuf]); // Sunday: off
    assert.deepEqual(result, { students: 0, messages: 0 });
    assert.equal(sent.length, 0);
  });

  it("does nothing when every memorized juz was revised recently", async () => {
    const { sent } = await run("2026-10-12", [
      {
        ...yusuf,
        memorized: [{ juz: 3, markedAt: "2026-09-01" }],
        entries: [{ date: "2026-10-10", lesson_type: "sabaq_para", juz: 3 }],
      },
    ]);
    assert.equal(sent.length, 0);
  });
});
