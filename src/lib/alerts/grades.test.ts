import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkLowGradeAlert, type GradeAlertDatabase } from "./grades";
import type { SendSmsInput } from "@/lib/sms/send-sms";

class FakeGradeAlertDatabase implements GradeAlertDatabase {
  gradeFloor: number;
  admins: { full_name: string; phone: string | null }[];
  guardians: { full_name: string; phone: string }[];

  constructor(input: {
    gradeFloor: number;
    admins?: { full_name: string; phone: string | null }[];
    guardians?: { full_name: string; phone: string }[];
  }) {
    this.gradeFloor = input.gradeFloor;
    this.admins = input.admins ?? [];
    this.guardians = input.guardians ?? [];
  }

  async getGradeFloor() {
    return this.gradeFloor;
  }

  async getAdminRecipients() {
    return this.admins;
  }

  async getGuardianRecipients() {
    return this.guardians;
  }
}

describe("checkLowGradeAlert", () => {
  it("does not send alerts when the grade is at or above the settings floor", async () => {
    const sent: SendSmsInput[] = [];

    const result = await checkLowGradeAlert(
      {
        studentId: "student-1",
        studentName: "Amina Noor",
        courseName: "Algebra I",
        gradeValue: 82,
        includeGuardians: true,
      },
      {
        database: new FakeGradeAlertDatabase({
          gradeFloor: 70,
          admins: [{ full_name: "Admin", phone: "+14135550100" }],
          guardians: [{ full_name: "Parent", phone: "+14135550101" }],
        }),
        sendSms: async (input) => {
          sent.push(input);
          return { status: "queued", notification: {} };
        },
      },
    );

    assert.equal(result.alerted, false);
    assert.equal(sent.length, 0);
  });

  it("sends a low-grade alert to admin phones when grade is below settings floor", async () => {
    const sent: SendSmsInput[] = [];

    const result = await checkLowGradeAlert(
      {
        studentId: "student-1",
        studentName: "Amina Noor",
        courseName: "Algebra I",
        gradeValue: 64,
        includeGuardians: false,
      },
      {
        database: new FakeGradeAlertDatabase({
          gradeFloor: 70,
          admins: [
            { full_name: "Admin One", phone: "+14135550100" },
            { full_name: "Admin No Phone", phone: null },
          ],
        }),
        sendSms: async (input) => {
          sent.push(input);
          return { status: "queued", notification: {} };
        },
      },
    );

    assert.equal(result.alerted, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].recipientPhone, "+14135550100");
    assert.equal(sent[0].recipientType, "admin");
    assert.equal(sent[0].triggerType, "low_grade");
    assert.match(sent[0].body, /Amina Noor/);
    assert.match(sent[0].body, /Algebra I/);
    assert.match(sent[0].body, /64%/);
    assert.match(sent[0].body, /70%/);
  });
});
