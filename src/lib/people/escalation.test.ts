import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeStudentEscalations } from "./escalation";

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
});
