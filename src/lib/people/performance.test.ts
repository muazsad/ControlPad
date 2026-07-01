import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalPerformance } from "./performance";

describe("globalPerformance", () => {
  it("returns insufficient data instead of scoring a missing grade or Quran factor", () => {
    assert.deepEqual(globalPerformance({ gradeScore: null, quranScore: 10 }), {
      status: "insufficient_data",
      score: null,
    });
    assert.deepEqual(globalPerformance({ gradeScore: 85, quranScore: null }), {
      status: "insufficient_data",
      score: null,
    });
    assert.deepEqual(globalPerformance({ gradeScore: null, quranScore: null }), {
      status: "insufficient_data",
      score: null,
    });
  });

  it("scores only when both grade and Quran factors are present", () => {
    assert.deepEqual(globalPerformance({ gradeScore: 80, quranScore: 60 }), {
      status: "scored",
      score: 70,
    });
  });
});
