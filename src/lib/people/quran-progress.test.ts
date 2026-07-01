import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarizeQuranProgress } from "./quran-progress";

describe("summarizeQuranProgress", () => {
  it("sorts entries by date and computes cumulative lines from raw entries", () => {
    const result = summarizeQuranProgress(
      [
        { date: "2026-06-10", lines_memorized: 3 },
        { date: "2026-06-01", lines_memorized: 5 },
        { date: "2026-06-05", lines_memorized: 2 },
      ],
      { referenceDate: "2026-06-11" },
    );

    assert.deepEqual(result.series, [
      { date: "2026-06-01", linesThisEntry: 5, cumulativeLines: 5 },
      { date: "2026-06-05", linesThisEntry: 2, cumulativeLines: 7 },
      { date: "2026-06-10", linesThisEntry: 3, cumulativeLines: 10 },
    ]);
  });

  it("returns insufficient data below the minimum entries for pattern scoring", () => {
    const result = summarizeQuranProgress(
      [{ date: "2026-06-10", lines_memorized: 3 }],
      { referenceDate: "2026-06-11" },
    );

    assert.equal(result.pattern.status, "insufficient_data");
    assert.equal(result.pattern.pattern, null);
  });

  it("classifies stale progress as stagnant before other patterns", () => {
    const result = summarizeQuranProgress(
      [
        { date: "2026-06-01", lines_memorized: 5 },
        { date: "2026-06-02", lines_memorized: 5 },
        { date: "2026-06-03", lines_memorized: 5 },
      ],
      { referenceDate: "2026-06-20" },
    );

    assert.equal(result.pattern.status, "classified");
    assert.equal(result.pattern.pattern, "stagnant");
    assert.equal(result.pattern.daysSinceLastEntry, 17);
  });

  it("classifies a stronger recent rate as accelerating", () => {
    const result = summarizeQuranProgress(
      [
        { date: "2026-05-10", lines_memorized: 2 },
        { date: "2026-05-17", lines_memorized: 2 },
        { date: "2026-06-07", lines_memorized: 8 },
        { date: "2026-06-14", lines_memorized: 8 },
      ],
      { referenceDate: "2026-06-15" },
    );

    assert.equal(result.pattern.status, "classified");
    assert.equal(result.pattern.pattern, "accelerating");
    assert.equal(result.pattern.recentLinesPerWeek, 4);
    assert.equal(result.pattern.priorLinesPerWeek, 1);
  });

  it("classifies regular gaps and steady lines as consistent", () => {
    const result = summarizeQuranProgress(
      [
        { date: "2026-06-01", lines_memorized: 4 },
        { date: "2026-06-04", lines_memorized: 4 },
        { date: "2026-06-07", lines_memorized: 4 },
        { date: "2026-06-10", lines_memorized: 4 },
      ],
      { referenceDate: "2026-06-11" },
    );

    assert.equal(result.pattern.status, "classified");
    assert.equal(result.pattern.pattern, "consistent");
    assert.equal(result.pattern.gapStats.coefficientOfVariation, 0);
  });

  it("classifies uneven gaps as irregular", () => {
    const result = summarizeQuranProgress(
      [
        { date: "2026-06-01", lines_memorized: 4 },
        { date: "2026-06-02", lines_memorized: 4 },
        { date: "2026-06-10", lines_memorized: 4 },
        { date: "2026-06-11", lines_memorized: 4 },
      ],
      { referenceDate: "2026-06-12" },
    );

    assert.equal(result.pattern.status, "classified");
    assert.equal(result.pattern.pattern, "irregular");
    assert.ok(result.pattern.gapStats.coefficientOfVariation > 0.5);
  });
});
