import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SendSmsInput } from "@/lib/sms/send-sms";
import {
  DEFAULT_WEEKLY_PATTERN,
  type SchoolCalendarConfig,
} from "@/lib/schedule/calendar";
import type { ScheduleGroup } from "@/lib/schedule/student-schedule";
import {
  minutesIntoDate,
  planAttendanceEscalation,
  runAttendanceTick,
  schoolClock,
  type EscalationDatabase,
  type EscalationStudent,
} from "./attendance-escalation";

const calendar: SchoolCalendarConfig = {
  weeklyPattern: DEFAULT_WEEKLY_PATTERN,
  breaks: [],
  specialDays: [],
};

const settings = {
  schoolStart: "08:00",
  tardyWindowHours: 2,
  parentAlertDelayMinutes: 60,
};

const groups: ScheduleGroup[] = [
  {
    id: "full",
    name: "Full time",
    days: [1, 2, 3, 4, 6].map((weekday) => ({
      weekday,
      startTime: "08:00",
      tardyGraceMinutes: 10,
      absenceCheckTime: "10:00",
    })),
  },
  {
    id: "quran",
    name: "Quran only",
    days: [1, 3, 5].map((weekday) => ({
      weekday,
      startTime: "16:00",
      tardyGraceMinutes: 5,
      absenceCheckTime: "16:30",
    })),
  },
];

function student(
  id: string,
  groupId: string | null,
  status: EscalationStudent["status"],
): EscalationStudent {
  return {
    id,
    firstName: id,
    lastName: "Test",
    groupId,
    status,
    guardians: [{ full_name: "Parent", phone: `+1413555${id.padStart(4, "0").slice(-4)}` }],
  };
}

// 2026-10-12 is a Monday
const MONDAY = "2026-10-12";
const at = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

describe("planAttendanceEscalation", () => {
  const students = [
    student("a1", "full", null), // unmarked
    student("a2", "full", "absent"),
    student("a3", "full", "present"),
    student("a4", "full", "excused"),
    student("q1", "quran", null), // later schedule
  ];

  it("does nothing before a group's absence-check time", () => {
    const plan = planAttendanceEscalation({
      date: MONDAY,
      nowMinutes: at("09:59"),
      students,
      groups,
      calendar,
      settings,
    });
    assert.equal(plan.expectedToday, 5);
    assert.equal(plan.adminBatches.length, 0);
    assert.equal(plan.parentAlerts.length, 0);
  });

  it("flags unmarked and absent students to the admin at check time, per group", () => {
    const plan = planAttendanceEscalation({
      date: MONDAY,
      nowMinutes: at("10:00"),
      students,
      groups,
      calendar,
      settings,
    });
    assert.equal(plan.adminBatches.length, 1);
    assert.equal(plan.adminBatches[0].key, "full");
    assert.equal(plan.adminBatches[0].parentAlertTime, "11:00");
    assert.deepEqual(
      plan.adminBatches[0].students.map((s) => [s.id, s.state]),
      [
        ["a1", "unmarked"],
        ["a2", "absent"],
      ],
    );
    assert.equal(plan.parentAlerts.length, 0);
  });

  it("texts parents only after the delay, and only for students still unmarked/absent", () => {
    const corrected = students.map((s) =>
      s.id === "a1" ? { ...s, status: "present" as const } : s,
    );
    const plan = planAttendanceEscalation({
      date: MONDAY,
      nowMinutes: at("11:00"),
      students: corrected,
      groups,
      calendar,
      settings,
    });
    assert.deepEqual(
      plan.parentAlerts.map((s) => s.id),
      ["a2"],
    );
  });

  it("handles each group on its own times", () => {
    const plan = planAttendanceEscalation({
      date: MONDAY,
      nowMinutes: at("17:30"),
      students,
      groups,
      calendar,
      settings,
    });
    assert.deepEqual(
      plan.adminBatches.map((b) => b.key).sort(),
      ["full", "quran"],
    );
    assert.deepEqual(
      plan.parentAlerts.map((s) => s.id).sort(),
      ["a1", "a2", "q1"],
    );
    assert.equal(plan.lastParentAlertMinutes, at("17:30"));
  });

  it("ignores students not scheduled that day", () => {
    // 2026-10-13 is a Tuesday — Quran-only does not meet
    const plan = planAttendanceEscalation({
      date: "2026-10-13",
      nowMinutes: at("20:00"),
      students: [student("q1", "quran", null)],
      groups,
      calendar,
      settings,
    });
    assert.equal(plan.expectedToday, 0);
    assert.equal(plan.adminBatches.length, 0);
  });

  it("uses school-wide settings for students without a group", () => {
    const plan = planAttendanceEscalation({
      date: MONDAY,
      nowMinutes: at("10:00"),
      students: [student("d1", null, null)],
      groups,
      calendar,
      settings,
    });
    assert.equal(plan.adminBatches[0].key, "default");
    assert.equal(plan.adminBatches[0].absenceCheckTime, "10:00");
  });
});

describe("schoolClock", () => {
  it("reads Eastern date and minutes, including across DST", () => {
    assert.deepEqual(schoolClock(new Date("2026-10-12T14:05:00Z")), {
      date: "2026-10-12",
      minutes: at("10:05"),
    });
    assert.deepEqual(schoolClock(new Date("2026-12-14T15:05:00Z")), {
      date: "2026-12-14",
      minutes: at("10:05"),
    });
    assert.deepEqual(schoolClock(new Date("2026-10-13T03:30:00Z")), {
      date: "2026-10-12",
      minutes: at("23:30"),
    });
  });

  it("treats past dates as fully elapsed and future dates as not started", () => {
    const now = new Date("2026-10-12T14:05:00Z");
    assert.equal(minutesIntoDate("2026-10-11", now), 24 * 60);
    assert.equal(minutesIntoDate("2026-10-13", now), -1);
  });
});

describe("runAttendanceTick", () => {
  class FakeDb implements EscalationDatabase {
    async getSettings() {
      return settings;
    }
    async getSchoolCalendar() {
      return calendar;
    }
    async getScheduleGroups() {
      return groups;
    }
    async getAdminRecipients() {
      return [{ phone: "+14135550100" }, { phone: null }];
    }
    async getActiveStudents() {
      return [student("a1", "full", null), student("a2", "full", "absent")];
    }
  }

  it("sends one admin batch text, then parent texts after the delay, then the tardy check", async () => {
    const sent: SendSmsInput[] = [];
    const tardyDates: string[] = [];
    const quranDates: string[] = [];
    const deps = {
      database: new FakeDb(),
      sendSms: async (input: SendSmsInput) => {
        sent.push(input);
        return { status: "dry_run" as const, notification: {} };
      },
      checkTardies: async (date: string) => {
        tardyDates.push(date);
        return { messages: 0 };
      },
      checkQuran: async (date: string) => {
        quranDates.push(date);
        return { messages: 0 };
      },
    };

    // 10:05 EDT
    const early = await runAttendanceTick(
      { now: new Date("2026-10-12T14:05:00Z") },
      deps,
    );
    assert.equal(early.date, MONDAY);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].recipientType, "admin");
    assert.equal(sent[0].triggerType, "absence_review");
    assert.equal(sent[0].dedupeKey, `absence_review:${MONDAY}:full`);
    assert.match(sent[0].body, /2 Full time students not checked in by 10:00 AM/);
    assert.match(sent[0].body, /a1 Test \(unmarked\), a2 Test \(absent\)/);
    assert.match(sent[0].body, /Parents will be texted at 11:00 AM/);
    assert.equal(early.tardyCheck.ran, false);
    assert.equal(early.quranCheck.ran, false);

    sent.length = 0;
    // 11:00 EDT — admin batch re-sent (deduped by sendSms) + two parent texts
    const later = await runAttendanceTick(
      { now: new Date("2026-10-12T15:00:00Z") },
      deps,
    );
    const parents = sent.filter((m) => m.recipientType === "parent");
    assert.equal(parents.length, 2);
    assert.equal(parents[0].triggerType, "absence");
    assert.match(parents[0].body, /has not been checked in today/);
    assert.match(parents[1].body, /was marked absent today/);
    assert.equal(later.tardyCheck.ran, true);
    assert.deepEqual(tardyDates, [MONDAY]);
    // 11:00 Eastern is QURAN_CHECK_TIME
    assert.equal(later.quranCheck.ran, true);
    assert.deepEqual(quranDates, [MONDAY]);
    assert.equal(later.digest.ran, false);
  });

  it("triggers the daily digest within an hour after admin_digest_time", async () => {
    class DigestDb extends FakeDb {
      async getSettings() {
        return { ...settings, adminDigestTime: "15:00" };
      }
    }
    const digestCalls: string[] = [];
    const deps = {
      database: new DigestDb(),
      sendSms: async () => ({ status: "dry_run" as const, notification: {} }),
      checkTardies: async () => ({ messages: 0 }),
      checkQuran: async () => ({ messages: 0 }),
      sendDigest: async (date: string) => {
        digestCalls.push(date);
        return { sent: true };
      },
    };

    // 2:55pm EST in December (19:55 UTC) — too early
    await runAttendanceTick({ now: new Date("2026-12-14T19:55:00Z") }, deps);
    // 3:05pm EST
    const result = await runAttendanceTick({ now: new Date("2026-12-14T20:05:00Z") }, deps);
    // 4:10pm EST — outside the window
    await runAttendanceTick({ now: new Date("2026-12-14T21:10:00Z") }, deps);

    assert.deepEqual(digestCalls, ["2026-12-14"]);
    assert.deepEqual(result.digest, { ran: true, sent: true, skippedReason: null });
  });

  it("runs at 11:00 Eastern in both summer and winter", async () => {
    const calls: string[] = [];
    const deps = {
      database: new FakeDb(),
      sendSms: async () => ({ status: "dry_run" as const, notification: {} }),
      checkTardies: async () => ({ messages: 0 }),
      checkQuran: async (date: string) => {
        calls.push(date);
        return { messages: 0 };
      },
      sendDigest: async () => ({ sent: false }),
    };
    // 11:05 EDT (UTC-4) and 11:05 EST (UTC-5)
    await runAttendanceTick({ now: new Date("2026-10-12T15:05:00Z") }, deps);
    await runAttendanceTick({ now: new Date("2026-12-14T16:05:00Z") }, deps);
    // 10:05 EST — too early
    await runAttendanceTick({ now: new Date("2026-12-15T15:05:00Z") }, deps);
    assert.deepEqual(calls, ["2026-10-12", "2026-12-14"]);
  });
});
