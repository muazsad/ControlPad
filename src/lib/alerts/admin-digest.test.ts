import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatAdminDigestSms,
  sendAdminDigest,
  summarizeGradeIssues,
  type AdminDigestDatabase,
  type AdminDailySummary,
} from "./admin-digest";
import type { SendSmsInput } from "@/lib/sms/send-sms";

const emptySummary: AdminDailySummary = {
  date: "2026-06-27",
  settings: {
    adminDigestTime: "15:00",
    gradeFloor: 70,
    quranInactivityDays: 7,
    paymentDueDay: 5,
  },
  absences: [],
  tardies: [],
  lowGrades: [],
  droppingGrades: [],
  quranSlippage: [],
  overduePayments: [],
};

class FakeAdminDigestDatabase implements AdminDigestDatabase {
  summary: AdminDailySummary;
  admins: { full_name: string; phone: string | null }[] = [
    { full_name: "Admin One", phone: "+14135550100" },
  ];

  constructor(summary: AdminDailySummary = emptySummary) {
    this.summary = summary;
  }

  async getSummary(date: string) {
    return { ...this.summary, date };
  }

  async getAdminRecipients() {
    return this.admins;
  }
}

describe("admin digest", () => {
  it("classifies an above-floor grade drop as dropping but not below floor", () => {
    const result = summarizeGradeIssues(
      [
        {
          course_id: "english",
          grade_value: 80,
          recorded_at: "2026-06-27T10:00:00.000Z",
          courses: { id: "english", name: "English" },
          students: { id: "student-1", first_name: "Muaz", last_name: "Sadique" },
        },
        {
          course_id: "english",
          grade_value: 89,
          recorded_at: "2026-06-20T10:00:00.000Z",
          courses: { id: "english", name: "English" },
          students: { id: "student-1", first_name: "Muaz", last_name: "Sadique" },
        },
      ],
      70,
    );

    assert.equal(result.lowGrades.length, 0);
    assert.equal(result.droppingGrades.length, 1);
    assert.equal(result.droppingGrades[0].currentGrade, 80);
    assert.equal(result.droppingGrades[0].previousGrade, 89);
    assert.equal(result.droppingGrades[0].delta, -9);
  });

  it("classifies a grade below the floor as below floor", () => {
    const result = summarizeGradeIssues(
      [
        {
          course_id: "math",
          grade_value: 65,
          recorded_at: "2026-06-27T10:00:00.000Z",
          courses: { id: "math", name: "Math" },
          students: { id: "student-2", first_name: "Amina", last_name: "Noor" },
        },
      ],
      70,
    );

    assert.equal(result.lowGrades.length, 1);
    assert.equal(result.lowGrades[0].gradeValue, 65);
    assert.equal(result.droppingGrades.length, 0);
  });

  it("does not classify a grade exactly at the floor as below floor", () => {
    const result = summarizeGradeIssues(
      [
        {
          course_id: "science",
          grade_value: 70,
          recorded_at: "2026-06-27T10:00:00.000Z",
          courses: { id: "science", name: "Science" },
          students: { id: "student-3", first_name: "Yusuf", last_name: "Ali" },
        },
      ],
      70,
    );

    assert.equal(result.lowGrades.length, 0);
  });

  it("formats an all-clear digest with zero counts", () => {
    const body = formatAdminDigestSms(emptySummary);

    assert.match(body, /ControlPad daily summary for 2026-06-27/);
    assert.match(body, /Absences 0/);
    assert.match(body, /Tardies 0/);
    assert.match(body, /Low grades 0/);
    assert.match(body, /Quran 0/);
    assert.match(body, /Payments 0/);
    assert.match(body, /All clear/);
  });

  it("formats issue counts and includes the first issue names", () => {
    const body = formatAdminDigestSms({
      ...emptySummary,
      absences: [{ studentId: "s1", studentName: "Amina Noor", status: "absent" }],
      tardies: [{ studentId: "s2", studentName: "Yusuf Ali", status: "tardy" }],
      lowGrades: [
        {
          studentId: "s3",
          studentName: "Maryam Khan",
          courseId: "c1",
          courseName: "Algebra I",
          gradeValue: 64,
        },
      ],
      droppingGrades: [
        {
          studentId: "s4",
          studentName: "Omar Ahmed",
          courseId: "c2",
          courseName: "Science",
          currentGrade: 76,
          previousGrade: 84,
          delta: -8,
        },
      ],
      quranSlippage: [
        {
          studentId: "s5",
          studentName: "Sara Osman",
          daysSinceLastLesson: 9,
        },
      ],
      overduePayments: [
        {
          studentId: "s6",
          studentName: "Hassan Said",
          periodMonth: "2026-06-01",
        },
      ],
    });

    assert.match(body, /Absences 1/);
    assert.match(body, /Tardies 1/);
    assert.match(body, /Low grades 1/);
    assert.match(body, /Dropping 1/);
    assert.match(body, /Quran 1/);
    assert.match(body, /Payments 1/);
    assert.match(body, /Amina Noor/);
    assert.match(body, /Maryam Khan/);
    assert.match(body, /Sara Osman/);
  });

  it("sends one admin_digest SMS per admin phone with a null student id", async () => {
    const database = new FakeAdminDigestDatabase();
    database.admins = [
      { full_name: "Admin One", phone: "+14135550100" },
      { full_name: "Admin Two", phone: "+14135550101" },
      { full_name: "Admin No Phone", phone: null },
    ];
    const sent: SendSmsInput[] = [];

    const result = await sendAdminDigest(
      {
        date: "2026-06-27",
        force: true,
        now: new Date("2026-06-27T15:01:00-04:00"),
      },
      {
        database,
        sendSms: async (input) => {
          sent.push(input);
          return { status: "queued", notification: {} };
        },
      },
    );

    assert.equal(result.sent, true);
    assert.equal(result.recipients, 2);
    assert.equal(sent.length, 2);
    assert.deepEqual(
      sent.map((message) => message.recipientPhone),
      ["+14135550100", "+14135550101"],
    );
    assert.equal(sent[0].recipientType, "admin");
    assert.equal(sent[0].triggerType, "admin_digest");
    assert.equal(sent[0].studentId, null);
    assert.equal(sent[0].dedupeWindowHours, 24);
  });

  it("skips scheduled sends before settings.admin_digest_time unless forced", async () => {
    const sent: SendSmsInput[] = [];

    const result = await sendAdminDigest(
      {
        date: "2026-06-27",
        now: new Date("2026-06-27T14:59:00-04:00"),
      },
      {
        database: new FakeAdminDigestDatabase(),
        sendSms: async (input) => {
          sent.push(input);
          return { status: "queued", notification: {} };
        },
      },
    );

    assert.equal(result.sent, false);
    assert.equal(result.recipients, 0);
    assert.equal(sent.length, 0);
  });
});
