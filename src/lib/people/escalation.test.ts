import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeStudentEscalations } from "./escalation";
import { DEFAULT_WEEKLY_PATTERN } from "@/lib/schedule/calendar";

const baseStudent = {
  id: "student-1",
  name: "Amina Noor",
};

describe("computeStudentEscalations", () => {
  it("marks one repeated signal as critical when it reaches the persistence threshold", () => {
    const [result] = computeStudentEscalations(
      [
        {
          ...baseStudent,
          grades: [
            { date: "2026-06-05", courseId: "math", gradeValue: 66 },
            { date: "2026-06-15", courseId: "math", gradeValue: 65 },
            { date: "2026-06-25", courseId: "math", gradeValue: 64 },
          ],
          attendance: [],
          quranProgress: [],
          payments: [],
          notifications: [],
        },
      ],
      {
        asOfDate: "2026-07-01",
        gradeFloor: 70,
        tardiesPerWeek: 3,
        quranInactivityDays: 7,
        paymentDueDay: 5,
      },
    );

    assert.equal(result.level, "critical");
    assert.equal(result.signals.grades.tripped, true);
    assert.equal(result.signals.grades.occurrences, 3);
    assert.match(result.reasons[0], /grades/i);
  });

  it("marks multiple simultaneous watch signals as critical", () => {
    const [result] = computeStudentEscalations(
      [
        {
          ...baseStudent,
          grades: [{ date: "2026-06-25", courseId: "math", gradeValue: 66 }],
          attendance: [{ date: "2026-06-28", status: "absent" }],
          quranProgress: [],
          payments: [],
          notifications: [],
        },
      ],
      {
        asOfDate: "2026-07-01",
        gradeFloor: 70,
        tardiesPerWeek: 3,
        quranInactivityDays: 7,
        paymentDueDay: 5,
      },
    );

    assert.equal(result.level, "critical");
    assert.equal(result.trippedSignalCount, 2);
    assert.equal(result.signals.grades.level, "watch");
    assert.equal(result.signals.attendance.level, "watch");
  });

  it("keeps a single non-persistent issue at watch", () => {
    const [result] = computeStudentEscalations(
      [
        {
          ...baseStudent,
          grades: [],
          attendance: [{ date: "2026-06-28", status: "tardy" }],
          quranProgress: [],
          payments: [],
          notifications: [],
        },
      ],
      {
        asOfDate: "2026-07-01",
        gradeFloor: 70,
        tardiesPerWeek: 3,
        quranInactivityDays: 7,
        paymentDueDay: 5,
      },
    );

    assert.equal(result.level, "watch");
    assert.equal(result.signals.attendance.occurrences, 1);
  });

  it("ignores attendance issues recorded on off-days", () => {
    const [result] = computeStudentEscalations(
      [
        {
          ...baseStudent,
          grades: [],
          attendance: [
            { date: "2026-07-03", status: "absent" },
            { date: "2026-07-05", status: "tardy" },
          ],
          quranProgress: [],
          payments: [],
          notifications: [],
        },
      ],
      {
        asOfDate: "2026-07-07",
        gradeFloor: 70,
        tardiesPerWeek: 3,
        quranInactivityDays: 7,
        paymentDueDay: 5,
        calendar: {
          weeklyPattern: DEFAULT_WEEKLY_PATTERN,
          breaks: [],
          specialDays: [],
        },
      },
    );

    assert.equal(result.signals.attendance.tripped, false);
    assert.equal(result.signals.attendance.occurrences, 0);
    assert.equal(result.level, "ok");
  });

  it("uses sustained grade drops as grade occurrences", () => {
    const [result] = computeStudentEscalations(
      [
        {
          ...baseStudent,
          grades: [
            { date: "2026-06-01", courseId: "english", gradeValue: 89 },
            { date: "2026-06-12", courseId: "english", gradeValue: 80 },
          ],
          attendance: [],
          quranProgress: [],
          payments: [],
          notifications: [],
        },
      ],
      {
        asOfDate: "2026-07-01",
        gradeFloor: 70,
        tardiesPerWeek: 3,
        quranInactivityDays: 7,
        paymentDueDay: 5,
      },
    );

    assert.equal(result.level, "watch");
    assert.equal(result.signals.grades.droppingTrendCount, 1);
    assert.equal(result.signals.grades.belowFloorCount, 0);
  });

  it("flags persistent stagnant Quran progress as critical using the inactivity setting", () => {
    const [result] = computeStudentEscalations(
      [
        {
          ...baseStudent,
          grades: [],
          attendance: [],
          quranProgress: [
            { date: "2026-06-01", lines_memorized: 4 },
            { date: "2026-06-05", lines_memorized: 4 },
          ],
          payments: [],
          notifications: [],
        },
      ],
      {
        asOfDate: "2026-07-01",
        gradeFloor: 70,
        tardiesPerWeek: 3,
        quranInactivityDays: 7,
        paymentDueDay: 5,
      },
    );

    assert.equal(result.level, "critical");
    assert.equal(result.signals.quran.tripped, true);
    assert.equal(result.signals.quran.daysSinceLastEntry, 26);
  });

  it("does not flag payment cycles before a student's enrollment anchor", () => {
    const [result] = computeStudentEscalations(
      [
        {
          ...baseStudent,
          enrollmentAnchorDate: "2026-07-01",
          grades: [],
          attendance: [],
          quranProgress: [],
          payments: [
            { periodMonth: "2026-06-01", status: "unpaid" },
            { periodMonth: "2026-07-01", status: "paid" },
          ],
          notifications: [],
        },
      ],
      {
        asOfDate: "2026-07-01",
        gradeFloor: 70,
        tardiesPerWeek: 3,
        quranInactivityDays: 7,
        paymentDueDay: 5,
      },
    );

    assert.equal(result.signals.payments.tripped, false);
    assert.equal(result.signals.payments.overdueCycles, 0);
    assert.equal(result.level, "ok");
  });

  it("flags unpaid payment cycles after enrollment once past due", () => {
    const [result] = computeStudentEscalations(
      [
        {
          ...baseStudent,
          enrollmentAnchorDate: "2026-06-01",
          grades: [],
          attendance: [],
          quranProgress: [],
          payments: [{ periodMonth: "2026-06-01", status: "unpaid" }],
          notifications: [],
        },
      ],
      {
        asOfDate: "2026-07-01",
        gradeFloor: 70,
        tardiesPerWeek: 3,
        quranInactivityDays: 7,
        paymentDueDay: 5,
      },
    );

    assert.equal(result.signals.payments.tripped, true);
    assert.equal(result.signals.payments.overdueCycles, 1);
    assert.equal(result.signals.payments.maxDaysOverdue, 26);
  });
});
