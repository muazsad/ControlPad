import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { activeJuzTest, studentsOnJuzTest } from "./juz-test";

describe("activeJuzTest", () => {
  it("returns the open test", () => {
    assert.deepEqual(
      activeJuzTest(
        [
          { juz: 2, started_on: "2026-09-01", finished_on: "2026-09-05" },
          { juz: 3, started_on: "2026-10-01", finished_on: null },
        ],
        "2026-10-12",
      ),
      { juz: 3, startedOn: "2026-10-01" },
    );
  });

  it("is null when every test is finished or none exist", () => {
    assert.equal(activeJuzTest([{ juz: 2, started_on: "2026-09-01", finished_on: "2026-09-05" }], "2026-10-12"), null);
    assert.equal(activeJuzTest([], "2026-10-12"), null);
    assert.equal(activeJuzTest(null, "2026-10-12"), null);
  });

  it("ignores a test that starts after the date", () => {
    assert.equal(activeJuzTest([{ juz: 3, started_on: "2026-10-13", finished_on: null }], "2026-10-12"), null);
  });
});

describe("studentsOnJuzTest", () => {
  it("maps only students with an open test", () => {
    const active = studentsOnJuzTest(
      [
        { student_id: "a", juz: 3, started_on: "2026-10-01", finished_on: null },
        { student_id: "b", juz: 4, started_on: "2026-10-01", finished_on: "2026-10-03" },
      ],
      "2026-10-12",
    );
    assert.deepEqual([...active.keys()], ["a"]);
    assert.equal(active.get("a")?.juz, 3);
  });
});
