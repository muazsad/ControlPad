import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkAbsenceAlerts,
  checkTardyThresholdAlerts,
  type AttendanceAlertDatabase,
} from "./attendance";
import type { SendSmsInput } from "@/lib/sms/send-sms";

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

  async getAttendanceSettings() {
    return this.settings;
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
        date: "2026-06-26",
        now: new Date("2026-06-26T10:01:00-04:00"),
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
    assert.match(sent[0].body, /2026-06-26/);
  });

  it("skips absence alerts before settings.school_start plus settings.tardy_window_hours", async () => {
    const database = new FakeAttendanceAlertDatabase();
    const sent: SendSmsInput[] = [];

    const result = await checkAbsenceAlerts(
      {
        date: "2026-06-26",
        now: new Date("2026-06-26T09:59:00-04:00"),
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

  it("sends tardy threshold alerts to guardians using settings.tardies_per_week", async () => {
    const database = new FakeAttendanceAlertDatabase();
    const sent: SendSmsInput[] = [];

    const result = await checkTardyThresholdAlerts(
      {
        date: "2026-06-26",
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
