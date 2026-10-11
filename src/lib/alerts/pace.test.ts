import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_WEEKLY_PATTERN } from "@/lib/schedule/calendar";
import type { PaceContext } from "@/lib/grades/pace";
import type { SendSmsInput } from "@/lib/sms/send-sms";

import {
  checkPaceAlerts,
  missingAssignmentsMessage,
  paceBehindMessage,
  type PaceAlertDatabase,
  type PaceAlertInput,
} from "./pace";

const context: PaceContext = {
  term: { termStart: "2026-10-05", termEnd: "2026-10-18" },
  paceGapThreshold: 10,
  missingAssignmentsThreshold: 3,
  staleGradeSchoolDays: 10,
  calendar: { weeklyPattern: DEFAULT_WEEKLY_PATTERN, breaks: [], specialDays: [] },
  groups: new Map(),
  defaults: { schoolStart: "08:00", tardyWindowHours: 2 },
};

const database: PaceAlertDatabase = {
  async getAdminRecipients() {
    return [{ full_name: "Director", phone: "+14135550001" }];
  },
  async getGuardianRecipients() {
    return [{ full_name: "Parent", phone: "+14135550002" }];
  },
};

const input: PaceAlertInput = {
  studentId: "s1",
  studentName: "Amina Noor",
  courseId: "c1",
  courseName: "Algebra",
  groupId: null,
  course: {},
  percentComplete: 20,
  missingAssignments: 0,
};

// Mon Oct 12 2026, 10:00 Eastern: 6 of 10 expected days elapsed = 60%.
const now = new Date("2026-10-12T14:00:00Z");

async function run(overrides: Partial<PaceAlertInput>) {
  const sent: SendSmsInput[] = [];
  const result = await checkPaceAlerts(
    { ...input, ...overrides },
    {
      database,
      context,
      now,
      sendSms: async (message) => {
        sent.push(message);
        return { status: "sent" } as never;
      },
    },
  );
  return { result, sent };
}

describe("checkPaceAlerts", () => {
  it("texts parent and admin when the gap reaches the threshold", async () => {
    const { result, sent } = await run({ percentComplete: 50 }); // gap 10
    assert.equal(result.paceAlerted, true);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.map((s) => s.recipientType).sort(), ["admin", "parent"]);
    assert.ok(sent.every((s) => s.triggerType === "pace_behind"));
    assert.ok(sent.every((s) => s.dedupeKey === "pace_behind:c1:2026-W42"));
    assert.match(sent[0].body, /Amina is behind in Algebra \(50% done, should be about 60%\)/);
  });

  it("does nothing just under the threshold", async () => {
    const { result, sent } = await run({ percentComplete: 50.1 });
    assert.equal(result.paceAlerted, false);
    assert.equal(sent.length, 0);
  });

  it("texts about missing work at the threshold, with its own dedupe key", async () => {
    const { result, sent } = await run({ percentComplete: 60, missingAssignments: 3 });
    assert.equal(result.paceAlerted, false);
    assert.equal(result.missingAlerted, true);
    assert.ok(sent.every((s) => s.triggerType === "missing_assignments"));
    assert.ok(sent.every((s) => s.dedupeKey === "missing_assignments:c1:2026-W42"));
    assert.match(sent[0].body, /Amina has 3 missing assignments in Algebra\./);
  });

  it("sends both when both thresholds are hit", async () => {
    const { sent } = await run({ percentComplete: 10, missingAssignments: 5 });
    assert.equal(sent.length, 4);
  });

  it("skips pace when there is no percent or no window", async () => {
    assert.equal((await run({ percentComplete: null })).sent.length, 0);
    const noWindow = await checkPaceAlerts(
      { ...input },
      {
        database,
        now,
        context: { ...context, term: { termStart: null, termEnd: null } },
        sendSms: async () => {
          throw new Error("should not send");
        },
      },
    );
    assert.equal(noWindow.paceAlerted, false);
  });
});

describe("messages", () => {
  it("are short and singular/plural aware", () => {
    assert.equal(
      missingAssignmentsMessage({ studentName: "Amina Noor", courseName: "Biology", missing: 1 }),
      "Salaam Institute: Amina has 1 missing assignment in Biology.",
    );
    assert.equal(
      paceBehindMessage({ studentName: "Amina Noor", courseName: "Algebra", actual: 40, expected: 55 }),
      "Salaam Institute: Amina is behind in Algebra (40% done, should be about 55%). Please check in with Amina.",
    );
  });
});
