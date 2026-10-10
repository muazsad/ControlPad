import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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

  async getStudentsAtTardyThreshold() {
    return this.tardyStudents;
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
