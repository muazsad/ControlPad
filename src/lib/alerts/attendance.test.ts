import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkTardyThresholdAlerts,
  studentsAtTardyThreshold,
  type AttendanceAlertDatabase,
  type TardyCandidate,
} from "./attendance";
import type { ScheduleGroup } from "@/lib/schedule/student-schedule";
import type { SendSmsInput } from "@/lib/sms/send-sms";
import {
  DEFAULT_WEEKLY_PATTERN,
  type SchoolCalendarConfig,
} from "@/lib/schedule/calendar";

class FakeAttendanceAlertDatabase implements AttendanceAlertDatabase {
  settings = {
    schoolStart: "08:00",
    tardyWindowHours: 2,
    tardiesPerWeek: 3,
  };

  admins = [{ full_name: "Admin", phone: "+14135550100" }];
  // 2026-06-25 is a Thursday; Mon 22, Tue 23, Thu 25 are school days.
  candidates: TardyCandidate[] = [
    {
      id: "student-2",
      first_name: "Yusuf",
      last_name: "Ali",
      groupId: null,
      tardyDates: ["2026-06-22", "2026-06-23", "2026-06-25"],
      guardians: [{ full_name: "Parent", phone: "+14135550102" }],
    },
  ];

  calendar: SchoolCalendarConfig = {
    weeklyPattern: DEFAULT_WEEKLY_PATTERN,
    breaks: [],
    specialDays: [],
  };

  async getAttendanceSettings() {
    return this.settings;
  }

  async getSchoolCalendar() {
    return this.calendar;
  }

  async getAdminRecipients() {
    return this.admins;
  }

  async getScheduleGroups(): Promise<ScheduleGroup[]> {
    return [];
  }

  async getTardyCandidates() {
    return this.candidates;
  }
}

describe("attendance alerts", () => {
  it("sends tardy threshold alerts to guardians using settings.tardies_per_week", async () => {
    const database = new FakeAttendanceAlertDatabase();
    const sent: SendSmsInput[] = [];

    const result = await checkTardyThresholdAlerts(
      {
        date: "2026-06-25",
      },
      {
        database,
        sendSms: async (input) => {
          sent.push(input);
          return { status: "queued", notification: {} };
        },
      },
    );

    assert.equal(result.students, 1);
    assert.equal(result.messages, 1);
    assert.equal(sent[0].recipientPhone, "+14135550102");
    assert.equal(sent[0].recipientType, "parent");
    assert.equal(sent[0].triggerType, "tardy_threshold");
    assert.equal(sent[0].dedupeWindowHours, 24 * 7);
    assert.match(sent[0].body, /Yusuf Ali/);
    assert.match(sent[0].body, /3 tardies/);
  });
});

describe("studentsAtTardyThreshold", () => {
  const calendar: SchoolCalendarConfig = {
    weeklyPattern: DEFAULT_WEEKLY_PATTERN, // Mon–Thu + Sat
    breaks: [],
    specialDays: [],
  };
  const defaults = { schoolStart: "08:00", tardyWindowHours: 2 };
  const fridayGroup: ScheduleGroup = {
    id: "quran-only",
    name: "Quran only",
    days: [{ weekday: 5, startTime: "16:00", tardyGraceMinutes: 5, absenceCheckTime: "16:30" }],
  };
  const candidate = (groupId: string | null, tardyDates: string[]): TardyCandidate => ({
    id: "s1",
    first_name: "Amina",
    last_name: "K",
    groupId,
    tardyDates,
    guardians: [],
  });

  it("counts tardies on days only the student's group attends", () => {
    // Fridays 2026-06-12, 06-19, 06-26 — not school-wide days.
    const result = studentsAtTardyThreshold({
      date: "2026-06-26",
      candidates: [candidate("quran-only", ["2026-06-12", "2026-06-19", "2026-06-26"])],
      groups: [fridayGroup],
      calendar,
      defaults,
      tardiesPerWeek: 3,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].tardyCount, 3);
  });

  it("skips students who aren't expected on the check date", () => {
    const result = studentsAtTardyThreshold({
      date: "2026-06-25", // Thursday — Quran-only group doesn't meet
      candidates: [candidate("quran-only", ["2026-06-12", "2026-06-19", "2026-06-05"])],
      groups: [fridayGroup],
      calendar,
      defaults,
      tardiesPerWeek: 3,
    });
    assert.equal(result.length, 0);
  });

  it("ignores tardies older than the student's last 7 expected days", () => {
    // Ungrouped: last 7 school days ending Thu 06-25 start Tue 06-16.
    const result = studentsAtTardyThreshold({
      date: "2026-06-25",
      candidates: [candidate(null, ["2026-06-08", "2026-06-09", "2026-06-25"])],
      groups: [],
      calendar,
      defaults,
      tardiesPerWeek: 3,
    });
    assert.equal(result.length, 0);
  });
});
