import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  easternDateKey,
  isWithinSweepWindow,
  carryForward,
  parseGradeInput,
  parseMissingInput,
  planSweep,
  type SweepCourse,
} from "./sweep";

const courses: SweepCourse[] = [
  { id: "c1", studentId: "s1", latestGrade: 85 },
  { id: "c2", studentId: "s1", latestGrade: null },
  { id: "c3", studentId: "s2", latestGrade: 72.5 },
];

describe("parseGradeInput", () => {
  it("treats empty and whitespace as blank", () => {
    assert.deepEqual(parseGradeInput(""), { status: "blank" });
    assert.deepEqual(parseGradeInput("   "), { status: "blank" });
  });

  it("accepts 0-100 with up to one decimal", () => {
    for (const [raw, value] of [
      ["0", 0],
      ["100", 100],
      ["100.0", 100],
      ["85", 85],
      ["85.5", 85.5],
      [" 85.5 ", 85.5],
      [".5", 0.5],
      ["85.", 85],
    ] as const) {
      assert.deepEqual(parseGradeInput(raw), { status: "ok", value }, raw);
    }
  });

  it("rejects out-of-range values", () => {
    for (const raw of ["100.1", "101", "1000"]) {
      assert.deepEqual(
        parseGradeInput(raw),
        { status: "invalid", reason: "out_of_range" },
        raw,
      );
    }
  });

  it("rejects non-numbers, negatives and NaN", () => {
    for (const raw of ["abc", "NaN", "-5", "8 5", "1e2", ".", "85%", "Infinity"]) {
      assert.deepEqual(
        parseGradeInput(raw),
        { status: "invalid", reason: "not_a_number" },
        raw,
      );
    }
  });

  it("rejects 2+ decimals", () => {
    for (const raw of ["85.55", "85.00", "0.123"]) {
      assert.deepEqual(
        parseGradeInput(raw),
        { status: "invalid", reason: "too_many_decimals" },
        raw,
      );
    }
  });

  it("rejects non-string input", () => {
    assert.deepEqual(parseGradeInput(85), {
      status: "invalid",
      reason: "not_a_number",
    });
    assert.deepEqual(parseGradeInput(null), {
      status: "invalid",
      reason: "not_a_number",
    });
  });
});

describe("planSweep", () => {
  it("drops blank entries without counting them", () => {
    const plan = planSweep(
      [
        { courseId: "c1", value: "" },
        { courseId: "c2", value: "  " },
      ],
      courses,
    );
    assert.deepEqual(plan, { toInsert: [], skippedUnchanged: 0, invalid: [] });
  });

  it("inserts changed grades with the student id from the server course", () => {
    const plan = planSweep([{ courseId: "c1", value: "90" }], courses);
    assert.deepEqual(plan.toInsert, [
      {
        courseId: "c1",
        studentId: "s1",
        gradeValue: 90,
        percentComplete: null,
        missingAssignments: null,
        gradeChanged: true,
        percentChanged: false,
        missingChanged: false,
      },
    ]);
    assert.equal(plan.skippedUnchanged, 0);
  });

  it("skips grades equal to the latest grade", () => {
    const plan = planSweep([{ courseId: "c1", value: "85" }], courses);
    assert.deepEqual(plan.toInsert, []);
    assert.equal(plan.skippedUnchanged, 1);
  });

  it('treats "85" and "85.0" as the same grade', () => {
    const plan = planSweep(
      [
        { courseId: "c1", value: "85.0" },
        { courseId: "c3", value: "72.5" },
      ],
      courses,
    );
    assert.deepEqual(plan.toInsert, []);
    assert.equal(plan.skippedUnchanged, 2);
  });

  it("compares against a latest grade stored with extra precision", () => {
    const plan = planSweep(
      [{ courseId: "c1", value: "85" }],
      [{ id: "c1", studentId: "s1", latestGrade: 85.00000001 }],
    );
    assert.equal(plan.skippedUnchanged, 1);
  });

  it("inserts when the course has no previous grade", () => {
    const plan = planSweep([{ courseId: "c2", value: "0" }], courses);
    assert.equal(plan.toInsert.length, 1);
    assert.equal(plan.toInsert[0].gradeValue, 0);
    assert.equal(plan.toInsert[0].gradeChanged, true);
  });

  it("rounds accepted values to one decimal", () => {
    const plan = planSweep([{ courseId: "c2", value: "91.7" }], courses);
    assert.equal(plan.toInsert[0].gradeValue, 91.7);
  });

  it("reports invalid values with a reason and does not insert them", () => {
    const plan = planSweep(
      [
        { courseId: "c1", value: "101" },
        { courseId: "c2", value: "abc" },
        { courseId: "c3", value: "88.88" },
      ],
      courses,
    );
    assert.deepEqual(plan.toInsert, []);
    assert.deepEqual(plan.invalid, [
      { courseId: "c1", reason: "out_of_range", field: "grade" },
      { courseId: "c2", reason: "not_a_number", field: "grade" },
      { courseId: "c3", reason: "too_many_decimals", field: "grade" },
    ]);
  });

  it("rejects unknown courses even with a valid value", () => {
    const plan = planSweep([{ courseId: "nope", value: "90" }], courses);
    assert.deepEqual(plan.toInsert, []);
    assert.deepEqual(plan.invalid, [
      { courseId: "nope", reason: "unknown_course", field: "grade" },
    ]);
  });

  it("does not report a blank entry for an unknown course", () => {
    const plan = planSweep([{ courseId: "nope", value: "" }], courses);
    assert.deepEqual(plan.invalid, []);
  });

  it("allows only one snapshot per course", () => {
    const plan = planSweep(
      [
        { courseId: "c1", value: "90" },
        { courseId: "c1", value: "95" },
      ],
      courses,
    );
    assert.equal(plan.toInsert.length, 1);
    assert.equal(plan.toInsert[0].gradeValue, 90);
    assert.deepEqual(plan.invalid, [{ courseId: "c1", reason: "duplicate", field: "grade" }]);
  });

  it("handles a mixed batch", () => {
    const plan = planSweep(
      [
        { courseId: "c1", value: "85" },
        { courseId: "c2", value: "77.5" },
        { courseId: "c3", value: "" },
        { courseId: "ghost", value: "50" },
      ],
      courses,
    );
    assert.equal(plan.toInsert.length, 1);
    assert.equal(plan.skippedUnchanged, 1);
    assert.equal(plan.invalid.length, 1);
  });
});

describe("parseMissingInput", () => {
  it("accepts blank and whole numbers", () => {
    assert.deepEqual(parseMissingInput(""), { status: "blank" });
    assert.deepEqual(parseMissingInput(" 0 "), { status: "ok", value: 0 });
    assert.deepEqual(parseMissingInput("12"), { status: "ok", value: 12 });
  });

  it("rejects decimals, negatives, junk and huge values", () => {
    assert.deepEqual(parseMissingInput("2.5"), {
      status: "invalid",
      reason: "not_a_whole_number",
    });
    for (const raw of ["-1", "abc", "1e2", "."]) {
      assert.deepEqual(
        parseMissingInput(raw),
        { status: "invalid", reason: "not_a_number" },
        raw,
      );
    }
    assert.deepEqual(parseMissingInput("1000"), {
      status: "invalid",
      reason: "out_of_range",
    });
  });
});

describe("planSweep with pace fields", () => {
  const paced: SweepCourse[] = [
    {
      id: "p1",
      studentId: "s1",
      latestGrade: 85,
      latestPercentComplete: 40,
      latestMissing: 2,
    },
    { id: "p2", studentId: "s1", latestGrade: null },
  ];

  it("carries blank fields forward from the latest snapshot", () => {
    const plan = planSweep([{ courseId: "p1", value: "", percent: "45", missing: "" }], paced);
    assert.deepEqual(plan.toInsert, [
      {
        courseId: "p1",
        studentId: "s1",
        gradeValue: 85,
        percentComplete: 45,
        missingAssignments: 2,
        gradeChanged: false,
        percentChanged: true,
        missingChanged: false,
      },
    ]);
  });

  it("inserts when only missing changes, keeping grade and percent", () => {
    const plan = planSweep([{ courseId: "p1", value: "85", percent: "", missing: "4" }], paced);
    assert.equal(plan.toInsert.length, 1);
    assert.equal(plan.toInsert[0].gradeValue, 85);
    assert.equal(plan.toInsert[0].percentComplete, 40);
    assert.equal(plan.toInsert[0].missingAssignments, 4);
    assert.equal(plan.toInsert[0].gradeChanged, false);
    assert.equal(plan.toInsert[0].missingChanged, true);
  });

  it("flags gradeChanged only when the grade itself differs", () => {
    const plan = planSweep([{ courseId: "p1", value: "80", percent: "40.0", missing: "2" }], paced);
    assert.equal(plan.toInsert.length, 1);
    assert.equal(plan.toInsert[0].gradeChanged, true);
    assert.equal(plan.toInsert[0].percentChanged, false);
    assert.equal(plan.toInsert[0].missingChanged, false);
  });

  it("skips when all three typed fields match the latest snapshot", () => {
    const plan = planSweep([{ courseId: "p1", value: "85.0", percent: "40", missing: "2" }], paced);
    assert.deepEqual(plan, { toInsert: [], skippedUnchanged: 1, invalid: [] });
  });

  it("treats a lone unchanged field as unchanged", () => {
    const plan = planSweep([{ courseId: "p1", value: "", percent: "", missing: "2" }], paced);
    assert.equal(plan.skippedUnchanged, 1);
    assert.equal(plan.toInsert.length, 0);
  });

  it("treats a first-ever missing/percent value as a change", () => {
    const plan = planSweep(
      [{ courseId: "c1", value: "", percent: "10", missing: "0" }],
      courses,
    );
    assert.equal(plan.toInsert.length, 1);
    assert.equal(plan.toInsert[0].percentComplete, 10);
    assert.equal(plan.toInsert[0].missingAssignments, 0);
    assert.equal(plan.toInsert[0].gradeValue, 85);
  });

  it("requires a grade when the course has none yet", () => {
    const plan = planSweep([{ courseId: "p2", value: "", percent: "10" }], paced);
    assert.deepEqual(plan.toInsert, []);
    assert.deepEqual(plan.invalid, [
      { courseId: "p2", reason: "grade_required", field: "grade" },
    ]);
  });

  it("stores null for pace fields that were never recorded", () => {
    const plan = planSweep([{ courseId: "p2", value: "70" }], paced);
    assert.equal(plan.toInsert[0].percentComplete, null);
    assert.equal(plan.toInsert[0].missingAssignments, null);
  });

  it("reports which field is invalid", () => {
    const plan = planSweep(
      [
        { courseId: "p1", value: "", percent: "101" },
        { courseId: "p2", value: "70", missing: "1.5" },
      ],
      paced,
    );
    assert.deepEqual(plan.invalid, [
      { courseId: "p1", reason: "out_of_range", field: "percent" },
      { courseId: "p2", reason: "not_a_whole_number", field: "missing" },
    ]);
  });
});

describe("carryForward", () => {
  it("keeps typed values and fills blanks from the latest snapshot", () => {
    const latest = { percentComplete: 40, missingAssignments: 2 };
    assert.deepEqual(
      carryForward(latest, { percentComplete: null, missingAssignments: 0 }),
      { percentComplete: 40, missingAssignments: 0 },
    );
    assert.deepEqual(
      carryForward(null, { percentComplete: null, missingAssignments: null }),
      { percentComplete: null, missingAssignments: null },
    );
  });
});

describe("Eastern sweep window", () => {
  it("converts to the Eastern calendar day, not the UTC day", () => {
    // 02:30 UTC on Oct 11 is 22:30 EDT on Oct 10.
    assert.equal(easternDateKey(new Date("2026-10-11T02:30:00Z")), "2026-10-10");
    // 04:30 UTC on Jan 11 is 23:30 EST on Jan 10.
    assert.equal(easternDateKey(new Date("2026-01-11T04:30:00Z")), "2026-01-10");
  });

  it("counts today and the six days before it", () => {
    const now = new Date("2026-10-11T15:00:00Z"); // Sun Oct 11, Eastern
    assert.equal(isWithinSweepWindow("2026-10-11T12:00:00Z", now), true);
    assert.equal(isWithinSweepWindow("2026-10-05T12:00:00Z", now), true);
    assert.equal(isWithinSweepWindow("2026-10-04T12:00:00Z", now), false);
  });

  it("uses Eastern days at the window edge", () => {
    const now = new Date("2026-10-11T15:00:00Z");
    // 03:30 UTC Oct 5 is still Oct 4 in Eastern → outside the window.
    assert.equal(isWithinSweepWindow("2026-10-05T03:30:00Z", now), false);
    // 04:30 UTC Oct 5 is 00:30 EDT Oct 5 → inside.
    assert.equal(isWithinSweepWindow("2026-10-05T04:30:00Z", now), true);
  });

  it("is false when there is no grade", () => {
    assert.equal(isWithinSweepWindow(null, new Date()), false);
  });
});
