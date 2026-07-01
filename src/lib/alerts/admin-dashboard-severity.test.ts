import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dailySummarySeverity,
  gradeIssueSeverity,
} from "./admin-dashboard-severity";
import type { AdminDailySummary } from "./admin-digest";

const summary: AdminDailySummary = {
  date: "2026-07-01",
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

describe("admin dashboard severity", () => {
  it("maps dropping-only grade issues to warning", () => {
    assert.equal(gradeIssueSeverity({ belowFloorCount: 0, droppingCount: 1 }), "warning");
  });

  it("maps below-floor grade issues to danger", () => {
    assert.equal(gradeIssueSeverity({ belowFloorCount: 1, droppingCount: 1 }), "danger");
  });

  it("keeps warning-only days out of the danger banner", () => {
    const result = dailySummarySeverity({
      ...summary,
      droppingGrades: [
        {
          studentId: "student-1",
          studentName: "Muaz Sadique",
          courseId: "english",
          courseName: "English",
          currentGrade: 80,
          previousGrade: 89,
          delta: -9,
        },
      ],
    });

    assert.equal(result.tone, "warning");
    assert.equal(result.label, "All clear, 1 to watch");
    assert.equal(result.dangerCount, 0);
    assert.equal(result.warningCount, 1);
  });

  it("uses danger for below-floor grade issues", () => {
    const result = dailySummarySeverity({
      ...summary,
      lowGrades: [
        {
          studentId: "student-1",
          studentName: "Amina Noor",
          courseId: "math",
          courseName: "Math",
          gradeValue: 65,
        },
      ],
    });

    assert.equal(result.tone, "danger");
    assert.equal(result.label, "Needs attention");
    assert.equal(result.dangerCount, 1);
  });
});
