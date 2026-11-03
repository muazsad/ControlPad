import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalPerformance, quranScore } from "./performance";

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

describe("quranScore asOf (juz test freeze)", () => {
  it("scores relative to the given date instead of today", () => {
    const entries = [
      { date: "2026-09-25", lines_memorized: 10 },
      { date: "2026-09-10", lines_memorized: 5 },
    ];
    // As of Oct 1: recent window has 10 lines, prior has 5 → improving.
    assert.deepEqual(quranScore(entries, "2026-10-01"), { score: 90, trend: "improving" });
  });
});
