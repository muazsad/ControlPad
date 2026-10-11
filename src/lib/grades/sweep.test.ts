import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  easternDateKey,
  isWithinSweepWindow,
  parseGradeInput,
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
      { courseId: "c1", studentId: "s1", gradeValue: 90 },
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
    assert.deepEqual(plan.toInsert, [
      { courseId: "c2", studentId: "s1", gradeValue: 0 },
    ]);
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
      { courseId: "c1", reason: "out_of_range" },
      { courseId: "c2", reason: "not_a_number" },
      { courseId: "c3", reason: "too_many_decimals" },
    ]);
  });

  it("rejects unknown courses even with a valid value", () => {
    const plan = planSweep([{ courseId: "nope", value: "90" }], courses);
    assert.deepEqual(plan.toInsert, []);
    assert.deepEqual(plan.invalid, [
      { courseId: "nope", reason: "unknown_course" },
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
    assert.deepEqual(plan.invalid, [{ courseId: "c1", reason: "duplicate" }]);
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
