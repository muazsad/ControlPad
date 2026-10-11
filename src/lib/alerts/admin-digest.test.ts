import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findUnmarkedStudents,
  formatAdminDigestSms,
  sendAdminDigest,
  summarizeGradeIssues,
  summarizeGradeHealth,
  summarizeRevisionIssues,
  summarizePaceIssues,
  type AdminDigestDatabase,
  type AdminDailySummary,
} from "./admin-digest";
import type { SendSmsInput } from "@/lib/sms/send-sms";
import { DEFAULT_WEEKLY_PATTERN } from "@/lib/schedule/calendar";
import type { PaceContext } from "@/lib/grades/pace";

const emptySummary: AdminDailySummary = {
  date: "2026-06-27",
  schoolDayType: "full",
  settings: {
    adminDigestTime: "15:00",
    gradeFloor: 70,
    quranInactivityDays: 7,
    paymentDueDay: 5,
    paceGapThreshold: 10,
    missingAssignmentsThreshold: 3,
    staleGradeSchoolDays: 10,
    revisionOverdueSchoolDays: 21,
  },
  absences: [],
  tardies: [],
  unmarked: [],
  lowGrades: [],
  droppingGrades: [],
  behindPace: [],
  missingWork: [],
  staleCourses: [],
  biggestDrops: [],
  quranSlippage: [],
  revisionOverdue: [],
  sabaqWithoutRevision: [],
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

  it("formats off-day summaries with a no-school note", () => {
    const body = formatAdminDigestSms({
      ...emptySummary,
      date: "2026-07-03",
      schoolDayType: "off",
    });

    assert.match(body, /No school today/);
    assert.match(body, /Absences 0/);
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

  it("skips scheduled sends on no-school days unless forced", async () => {
    const sent: SendSmsInput[] = [];

    const result = await sendAdminDigest(
      {
        date: "2026-07-03",
        now: new Date("2026-07-03T16:00:00-04:00"),
      },
      {
        database: new FakeAdminDigestDatabase({ ...emptySummary, schoolDayType: "off" }),
        sendSms: async (input) => {
          sent.push(input);
          return { status: "queued", notification: {} };
        },
      },
    );

    assert.equal(result.sent, false);
    assert.equal(result.skippedReason, "no_school");
    assert.equal(sent.length, 0);
  });
});

describe("findUnmarkedStudents", () => {
  const calendar = { weeklyPattern: DEFAULT_WEEKLY_PATTERN, breaks: [], specialDays: [] };
  const defaults = { schoolStart: "08:00", tardyWindowHours: 2 };
  const groups = [
    {
      id: "quran-only",
      name: "Quran only",
      days: [{ weekday: 5, startTime: "16:00", tardyGraceMinutes: 5, absenceCheckTime: "16:30" }],
    },
  ];
  const students = [
    { id: "a", name: "Amina", groupId: null },
    { id: "b", name: "Bilal", groupId: null },
    { id: "q", name: "Qasim", groupId: "quran-only" },
  ];

  it("lists expected students with no record once their cutoff has passed", () => {
    // Monday 2026-10-12 at 08:30 — ungrouped cutoff is 08:00
    const result = findUnmarkedStudents({
      date: "2026-10-12",
      nowMinutes: 8 * 60 + 30,
      students,
      markedStudentIds: new Set(["b"]),
      groups,
      calendar,
      defaults,
    });
    assert.deepEqual(result.map((r) => r.studentId), ["a"]);
  });

  it("waits until each student's own cutoff", () => {
    // Friday 2026-10-16 — only the Quran-only group meets (cutoff 16:05)
    const before = findUnmarkedStudents({
      date: "2026-10-16", nowMinutes: 16 * 60, students,
      markedStudentIds: new Set(), groups, calendar, defaults,
    });
    const after = findUnmarkedStudents({
      date: "2026-10-16", nowMinutes: 16 * 60 + 10, students,
      markedStudentIds: new Set(), groups, calendar, defaults,
    });
    assert.equal(before.length, 0);
    assert.deepEqual(after.map((r) => r.studentId), ["q"]);
  });

  it("mentions unmarked students in the digest text", () => {
    const body = formatAdminDigestSms({
      ...emptySummary,
      unmarked: [{ studentId: "a", studentName: "Amina Noor", tardyCutoffTime: "08:00" }],
    });
    assert.match(body, /Not checked in 1/);
    assert.match(body, /Amina Noor/);
  });
});

describe("summarizePaceIssues", () => {
  // Term Mon Oct 5 – Sun Oct 18 2026; on Oct 12 the expected pace is 60%.
  const context: PaceContext = {
    term: { termStart: "2026-10-05", termEnd: "2026-10-18" },
    paceGapThreshold: 10,
    missingAssignmentsThreshold: 3,
  staleGradeSchoolDays: 10,
    calendar: { weeklyPattern: DEFAULT_WEEKLY_PATTERN, breaks: [], specialDays: [] },
    groups: new Map(),
    defaults: { schoolStart: "08:00", tardyWindowHours: 2 },
  };

  function row(
    courseId: string,
    studentId: string,
    percent: number | null,
    missing: number | null,
    recordedAt = "2026-10-11T10:00:00.000Z",
  ) {
    return {
      course_id: courseId,
      grade_value: 80,
      percent_complete: percent,
      missing_assignments: missing,
      recorded_at: recordedAt,
      courses: { id: courseId, name: courseId, start_date: null, end_date: null },
      students: { id: studentId, first_name: "Student", last_name: studentId },
    };
  }

  it("flags behind-pace and missing-work courses, most severe first", () => {
    const result = summarizePaceIssues({
      gradeRows: [
        row("a", "s1", 45, 0), // gap 15 → warning
        row("b", "s2", 30, 6), // gap 30 → danger; 6 missing → danger
        row("c", "s3", 58, 3), // gap 2 → fine; 3 missing → warning
      ],
      students: [
        { id: "s1", groupId: null },
        { id: "s2", groupId: null },
        { id: "s3", groupId: null },
      ],
      context,
      today: "2026-10-12",
    });
    assert.deepEqual(
      result.behindPace.map((issue) => [issue.courseId, issue.tone]),
      [
        ["b", "danger"],
        ["a", "warning"],
      ],
    );
    assert.deepEqual(
      result.missingWork.map((issue) => [issue.courseId, issue.tone]),
      [
        ["b", "danger"],
        ["c", "warning"],
      ],
    );
  });

  it("uses only each course's latest snapshot and skips inactive students", () => {
    const result = summarizePaceIssues({
      gradeRows: [
        row("a", "s1", 58, 0, "2026-10-11T10:00:00.000Z"), // latest: fine
        row("a", "s1", 10, 9, "2026-10-04T10:00:00.000Z"), // older: ignored
        row("z", "gone", 5, 9),
      ],
      students: [{ id: "s1", groupId: null }],
      context,
      today: "2026-10-12",
    });
    assert.deepEqual(result, { behindPace: [], missingWork: [] });
  });

  it("ignores courses with no pace data", () => {
    const result = summarizePaceIssues({
      gradeRows: [row("a", "s1", null, null)],
      students: [{ id: "s1", groupId: null }],
      context,
      today: "2026-10-12",
    });
    assert.deepEqual(result, { behindPace: [], missingWork: [] });
  });
});

describe("summarizeGradeHealth", () => {
  const context: PaceContext = {
    term: { termStart: null, termEnd: null },
    paceGapThreshold: 10,
    missingAssignmentsThreshold: 3,
    staleGradeSchoolDays: 5,
    calendar: { weeklyPattern: DEFAULT_WEEKLY_PATTERN, breaks: [], specialDays: [] },
    groups: new Map(),
    defaults: { schoolStart: "08:00", tardyWindowHours: 2 },
  };

  const gradeRow = (courseId: string, grade: number, recordedAt: string) => ({
    course_id: courseId,
    grade_value: grade,
    recorded_at: recordedAt,
    courses: null,
    students: null,
  });

  it("lists stale and never-graded courses and ranks the biggest drops", () => {
    const result = summarizeGradeHealth({
      gradeRows: [
        gradeRow("alg", 75, "2026-10-19T15:00:00Z"),
        gradeRow("alg", 90, "2026-10-01T15:00:00Z"),
        gradeRow("bio", 80, "2026-09-20T15:00:00Z"), // stale
        gradeRow("his", 70, "2026-10-01T15:00:00Z"),
        gradeRow("his", 74, "2026-10-19T15:00:00Z"), // rising: not a drop
      ],
      students: [
        {
          id: "s1",
          name: "Amina Noor",
          groupId: null,
          courses: [
            { id: "alg", name: "Algebra", created_at: "2026-08-20T12:00:00Z" },
            { id: "bio", name: "Biology", created_at: "2026-08-20T12:00:00Z" },
            { id: "art", name: "Art", created_at: "2026-08-20T12:00:00Z" }, // never graded
          ],
        },
        {
          id: "s2",
          name: "Bilal Khan",
          groupId: null,
          courses: [{ id: "his", name: "History", created_at: "2026-08-20T12:00:00Z" }],
        },
      ],
      context,
      today: "2026-10-20",
    });

    assert.deepEqual(
      result.staleCourses.map((issue) => [issue.courseName, issue.status]).sort(),
      [
        ["Art", "never"],
        ["Biology", "stale"],
      ],
    );
    assert.equal(result.biggestDrops.length, 1);
    assert.equal(result.biggestDrops[0].studentName, "Amina Noor");
    assert.equal(result.biggestDrops[0].courseName, "Algebra");
    assert.equal(result.biggestDrops[0].change, -15);
    assert.equal(result.biggestDrops[0].tone, "danger");
  });

  it("adds a stale count line to the digest text", () => {
    const sms = formatAdminDigestSms({
      ...emptySummary,
      staleCourses: [
        { studentId: "s1", studentName: "Amina", courseId: "bio", courseName: "Biology", status: "stale", schoolDaysSince: 12 },
        { studentId: "s2", studentName: "Bilal", courseId: "his", courseName: "History", status: "never", schoolDaysSince: 14 },
      ],
    });
    assert.match(sms, /2 courses not updated in 10\+ school days\./);
    assert.doesNotMatch(formatAdminDigestSms(emptySummary), /not updated/);
  });
});

describe("summarizeRevisionIssues", () => {
  const calendar = { weeklyPattern: DEFAULT_WEEKLY_PATTERN, breaks: [], specialDays: [] };

  it("lists students with overdue juz and students memorizing without revising", () => {
    const result = summarizeRevisionIssues({
      quranRows: [
        // s1: juz 3 revised recently, juz 7 never revised → overdue
        { student_id: "s1", date: "2026-10-10", lesson_type: "dhor", juz: 3 },
        // s2: three sabaq, no revision in the window
        { student_id: "s2", date: "2026-10-06", lesson_type: "sabaq", juz: null },
        { student_id: "s2", date: "2026-10-08", lesson_type: "sabaq", juz: null },
        { student_id: "s2", date: "2026-10-12", lesson_type: "sabaq", juz: null },
      ],
      memorizedRows: [
        { student_id: "s1", juz: 3, marked_at: "2026-09-01" },
        { student_id: "s1", juz: 7, marked_at: "2026-09-01" },
      ],
      students: [
        { id: "s1", name: "Yusuf Ali" },
        { id: "s2", name: "Maryam Khan" },
      ],
      thresholdSchoolDays: 5,
      calendar,
      today: "2026-10-12",
    });
    assert.deepEqual(
      result.revisionOverdue.map((issue) => [issue.studentName, issue.juz]),
      [["Yusuf Ali", [7]]],
    );
    assert.deepEqual(
      result.sabaqWithoutRevision.map((issue) => [issue.studentName, issue.sabaqCount]),
      [["Maryam Khan", 3]],
    );
  });

  it("adds both counts to the digest text", () => {
    const sms = formatAdminDigestSms({
      ...emptySummary,
      revisionOverdue: [{ studentId: "s1", studentName: "Yusuf", juz: [7], tone: "danger" }],
    });
    assert.match(sms, /Revision overdue 1, Sabaq without revision 0/);
    assert.match(sms, /Review: Yusuf/);
  });
});
