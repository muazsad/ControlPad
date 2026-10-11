import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_WEEKLY_PATTERN,
  type SchoolCalendarConfig,
} from "@/lib/schedule/calendar";

import {
  PACE_DANGER_MULTIPLIER,
  courseWindow,
  evaluateCoursePace,
  expectedDayPredicate,
  expectedPercent,
  isoWeekKey,
  missingTone,
  paceGap,
  paceTone,
} from "./pace";

// Window Mon 2026-10-05 … Sun 2026-10-18. Default week = Mon–Thu + Sat, so the
// expected days are Oct 5,6,7,8,10,12,13,14,15,17 (10 days).
const window = { start: "2026-10-05", end: "2026-10-18" };
const defaults = { schoolStart: "08:00", tardyWindowHours: 2 };

function calendar(partial: Partial<SchoolCalendarConfig> = {}): SchoolCalendarConfig {
  return {
    weeklyPattern: DEFAULT_WEEKLY_PATTERN,
    breaks: [],
    specialDays: [],
    ...partial,
  };
}

const expected = (today: string, config = calendar()) =>
  expectedPercent(window, today, expectedDayPredicate(null, config, defaults));

describe("courseWindow", () => {
  it("prefers the course's own dates when both are set", () => {
    assert.deepEqual(
      courseWindow(
        { startDate: "2026-09-01", endDate: "2026-12-18" },
        { termStart: "2026-08-25", termEnd: "2027-06-10" },
      ),
      { start: "2026-09-01", end: "2026-12-18" },
    );
  });

  it("falls back to the term when the course has only one date", () => {
    assert.deepEqual(
      courseWindow(
        { startDate: "2026-09-01", endDate: null },
        { termStart: "2026-08-25", termEnd: "2027-06-10" },
      ),
      { start: "2026-08-25", end: "2027-06-10" },
    );
  });

  it("is null with no course or term dates", () => {
    assert.equal(
      courseWindow({}, { termStart: null, termEnd: "2027-06-10" }),
      null,
    );
  });

  it("is null for a backwards or absurdly long window", () => {
    const none = { termStart: null, termEnd: null };
    assert.equal(courseWindow({ startDate: "2026-10-10", endDate: "2026-10-01" }, none), null);
    assert.equal(courseWindow({ startDate: "2020-01-01", endDate: "2026-01-01" }, none), null);
  });
});

describe("expectedPercent", () => {
  it("is 0 before the window starts", () => {
    assert.equal(expected("2026-10-01"), 0);
  });

  it("counts today's school day as elapsed", () => {
    assert.equal(expected("2026-10-08"), 40); // Oct 5–8 = 4 of 10
  });

  it("does not advance on days the student isn't expected", () => {
    assert.equal(expected("2026-10-09"), 40); // Friday
    assert.equal(expected("2026-10-11"), 50); // Sat Oct 10 counted, Sunday not
  });

  it("is 100 on and after the end", () => {
    assert.equal(expected("2026-10-18"), 100);
    assert.equal(expected("2027-03-01"), 100);
  });

  it("does not let a break inside the window inflate the pace", () => {
    const withBreak = calendar({
      breaks: [
        { id: "b", name: "Break", startDate: "2026-10-12", endDate: "2026-10-15" },
      ],
    });
    // Expected days become Oct 5,6,7,8,10,17 (6). By Oct 10, 5 of 6 are done.
    assert.ok(Math.abs((expected("2026-10-10", withBreak) ?? 0) - (5 / 6) * 100) < 1e-9);
    // Without the break the same date is only 50%.
    assert.equal(expected("2026-10-10"), 50);
    // The break itself doesn't move it.
    assert.equal(
      expected("2026-10-14", withBreak),
      expected("2026-10-10", withBreak),
    );
  });

  it("skips special days where students aren't expected", () => {
    const closed = calendar({
      specialDays: [
        { date: "2026-10-06", type: "no_gcvs", studentsExpected: false },
      ],
    });
    assert.ok(Math.abs((expected("2026-10-08", closed) ?? 0) - (3 / 9) * 100) < 1e-9);
  });

  it("is null for a null window", () => {
    assert.equal(expectedPercent(null, "2026-10-08", () => true), null);
  });

  it("is null when the window has no expected days", () => {
    assert.equal(expectedPercent(window, "2026-10-08", () => false), null);
  });
});

describe("paceGap", () => {
  it("is expected minus actual, to one decimal", () => {
    assert.equal(paceGap(55, 40), 15);
    assert.equal(paceGap(33.3333, 30), 3.3);
    assert.equal(paceGap(40, 50), -10);
  });

  it("is null when either side is missing", () => {
    assert.equal(paceGap(null, 40), null);
    assert.equal(paceGap(55, null), null);
  });
});

describe("paceTone", () => {
  const threshold = 10;
  it("is neutral without a gap", () => {
    assert.equal(paceTone(null, threshold), "neutral");
  });
  it("is success below the threshold, including when ahead", () => {
    assert.equal(paceTone(-20, threshold), "success");
    assert.equal(paceTone(9.9, threshold), "success");
  });
  it("is warning from the threshold up to 2× it", () => {
    assert.equal(paceTone(10, threshold), "warning");
    assert.equal(paceTone(19.9, threshold), "warning");
  });
  it("is danger from 2× the threshold", () => {
    assert.equal(PACE_DANGER_MULTIPLIER, 2);
    assert.equal(paceTone(20, threshold), "danger");
    assert.equal(paceTone(80, threshold), "danger");
  });
  it("uses the same bands for missing assignments", () => {
    assert.equal(missingTone(null, 3), "neutral");
    assert.equal(missingTone(2, 3), "success");
    assert.equal(missingTone(3, 3), "warning");
    assert.equal(missingTone(6, 3), "danger");
  });
});

describe("evaluateCoursePace", () => {
  const base = {
    course: {},
    term: { termStart: window.start, termEnd: window.end },
    isExpectedDay: expectedDayPredicate(null, calendar(), defaults),
    paceGapThreshold: 10,
    missingAssignmentsThreshold: 3,
  };

  it("combines expected, actual, gap and tones", () => {
    const result = evaluateCoursePace({
      ...base,
      today: "2026-10-12", // expected 60%
      latest: { percentComplete: 35, missingAssignments: 4 },
    });
    assert.equal(result.expected, 60);
    assert.equal(result.gap, 25);
    assert.equal(result.paceTone, "danger");
    assert.equal(result.missingTone, "warning");
  });

  it("is neutral with no snapshot or no window", () => {
    const noSnapshot = evaluateCoursePace({ ...base, today: "2026-10-12", latest: null });
    assert.equal(noSnapshot.gap, null);
    assert.equal(noSnapshot.paceTone, "neutral");

    const noWindow = evaluateCoursePace({
      ...base,
      term: { termStart: null, termEnd: null },
      today: "2026-10-12",
      latest: { percentComplete: 35, missingAssignments: 0 },
    });
    assert.equal(noWindow.expected, null);
    assert.equal(noWindow.paceTone, "neutral");
    assert.equal(noWindow.missingTone, "success");
  });
});

describe("isoWeekKey", () => {
  it("returns ISO week keys, including year boundaries", () => {
    assert.equal(isoWeekKey("2026-10-11"), "2026-W41"); // Sunday ends the week of Oct 5
    assert.equal(isoWeekKey("2026-10-12"), "2026-W42");
    assert.equal(isoWeekKey("2027-01-01"), "2026-W53");
    assert.equal(isoWeekKey("2024-12-30"), "2025-W01");
  });
});
