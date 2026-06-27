import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatGrade, gradeTone, latestGrade } from "./grade-display";

describe("grade display helpers", () => {
  it("selects the newest grade snapshot by recorded_at", () => {
    const newest = {
      id: "newest",
      grade_value: 88,
      recorded_at: "2026-06-27T12:00:00.000Z",
    };

    assert.equal(
      latestGrade([
        {
          id: "older",
          grade_value: 71,
          recorded_at: "2026-06-25T12:00:00.000Z",
        },
        newest,
        {
          id: "oldest",
          grade_value: 93,
          recorded_at: "2026-06-24T12:00:00.000Z",
        },
      ]),
      newest,
    );
  });

  it("formats null, integer, and decimal grades for display", () => {
    assert.equal(formatGrade(null), "No data");
    assert.equal(formatGrade(80), "80%");
    assert.equal(formatGrade(82.35), "82.3%");
  });

  it("uses the configured grade floor for badge tone", () => {
    assert.equal(gradeTone(null, 70), "neutral");
    assert.equal(gradeTone(69.9, 70), "danger");
    assert.equal(gradeTone(72, 70), "warning");
    assert.equal(gradeTone(76, 70), "success");
  });
});
