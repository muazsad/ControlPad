import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkAbsenceAlerts,
  checkTardyThresholdAlerts,
  type AttendanceAlertDatabase,
} from "./attendance";
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
  absentStudents = [
    {
      id: "student-1",
      first_name: "Amina",
      last_name: "Noor",
      guardians: [{ full_name: "Parent", phone: "+14135550101" }],
    },
  ];

  tardyStudents = [
    {
      id: "student-2",
      first_name: "Yusuf",
      last_name: "Ali",
      tardyCount: 3,
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

  async getAbsentStudentsForDate() {
    return this.absentStudents;
  }

  async getStudentsAtTardyThreshold() {
    return this.tardyStudents;
  }
}

describe("attendance alerts", () => {
  it("sends absence alerts to guardians and admins after the configured window", async () => {
    const database = new FakeAttendanceAlertDatabase();
    const sent: SendSmsInput[] = [];

    const result = await checkAbsenceAlerts(
      {
        date: "2026-06-25",
        now: new Date("2026-06-25T10:01:00-04:00"),
      },
      {
        database,
        sendSms: async (input) => {
          sent.push(input);
          return { status: "queued", notification: {} };
        },
      },
    );

    assert.equal(result.checked, true);
    assert.equal(result.students, 1);
    assert.equal(result.messages, 2);
    assert.deepEqual(
      sent.map((message) => message.recipientType).sort(),
      ["admin", "parent"],
    );
    assert.equal(sent[0].triggerType, "absence");
    assert.equal(sent[0].dedupeWindowHours, 24);
    assert.match(sent[0].body, /Amina Noor/);
    assert.match(sent[0].body, /2026-06-25/);
  });

  it("skips absence alerts before settings.school_start plus settings.tardy_window_hours", async () => {
    const database = new FakeAttendanceAlertDatabase();
    const sent: SendSmsInput[] = [];

    const result = await checkAbsenceAlerts(
      {
        date: "2026-06-25",
        now: new Date("2026-06-25T09:59:00-04:00"),
      },
      {
        database,
        sendSms: async (input) => {
          sent.push(input);
          return { status: "queued", notification: {} };
        },
      },
    );

    assert.equal(result.checked, false);
    assert.equal(result.messages, 0);
    assert.equal(sent.length, 0);
  });

  it("does not flag an absence on a Friday off-day", async () => {
    const database = new FakeAttendanceAlertDatabase();
    const sent: SendSmsInput[] = [];

    const result = await checkAbsenceAlerts(
      {
        date: "2026-07-03",
        now: new Date("2026-07-03T12:00:00-04:00"),
      },
      {
        database,
        sendSms: async (input) => {
          sent.push(input);
          return { status: "queued", notification: {} };
        },
      },
    );

    assert.equal(result.checked, false);
    assert.equal(result.students, 0);
    assert.equal(result.messages, 0);
    assert.equal(sent.length, 0);
  });

  it("uses a half-day start time for the absence window when configured", async () => {
    const database = new FakeAttendanceAlertDatabase();
    database.calendar = {
      weeklyPattern: DEFAULT_WEEKLY_PATTERN,
      breaks: [],
      specialDays: [
        {
          date: "2026-07-07",
          type: "half_day",
          startTime: "09:00",
          endTime: "12:00",
        },
      ],
    };
    const sent: SendSmsInput[] = [];

    const result = await checkAbsenceAlerts(
      {
        date: "2026-07-07",
        now: new Date("2026-07-07T10:30:00-04:00"),
      },
      {
        database,
        sendSms: async (input) => {
          sent.push(input);
          return { status: "queued", notification: {} };
        },
      },
    );

    assert.equal(result.checked, false);
    assert.equal(sent.length, 0);
  });

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
