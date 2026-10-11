import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TREND_DANGER_CHANGE,
  TREND_WINDOW_DAYS,
  gradeTrend,
  studentTrend,
  trendTone,
} from "./trend";

const today = "2026-10-20"; // window cutoff = Oct 6

const snap = (date: string, grade: number) => ({
  recordedAt: `${date}T15:00:00Z`,
  grade,
});

describe("gradeTrend", () => {
  it("uses the latest snapshot on or before the cutoff as the baseline", () => {
    const trend = gradeTrend(
      [snap("2026-09-20", 90), snap("2026-10-06", 88), snap("2026-10-12", 80), snap("2026-10-19", 75)],
      today,
    );
    assert.equal(TREND_WINDOW_DAYS, 14);
    assert.equal(trend?.baseline, 88);
    assert.equal(trend?.baselineDate, "2026-10-06");
    assert.equal(trend?.latest, 75);
    assert.equal(trend?.change, -13);
    assert.deepEqual(trend?.points, [88, 80, 75]);
  });

  it("falls back to the earliest in-window snapshot when there is none before it", () => {
    const trend = gradeTrend([snap("2026-10-08", 85), snap("2026-10-15", 80)], today);
    assert.equal(trend?.baseline, 85);
    assert.equal(trend?.change, -5);
  });

  it("is null with a single snapshot inside the window", () => {
    assert.equal(gradeTrend([snap("2026-10-15", 80)], today), null);
  });

  it("is null with no snapshots", () => {
    assert.equal(gradeTrend([], today), null);
  });

  it("reports a rising grade as a positive change", () => {
    const trend = gradeTrend([snap("2026-10-01", 70), snap("2026-10-18", 82.5)], today);
    assert.equal(trend?.change, 12.5);
    assert.equal(trendTone(trend?.change ?? null), "success");
  });

  it("treats a lone old snapshot as its own baseline (no change)", () => {
    const trend = gradeTrend([snap("2026-09-01", 77)], today);
    assert.equal(trend?.change, 0);
    assert.deepEqual(trend?.points, [77]);
  });

  it("ignores snapshots after today and sorts unordered input", () => {
    const trend = gradeTrend(
      [snap("2026-10-19", 75), snap("2026-10-25", 10), snap("2026-10-01", 90)],
      today,
    );
    assert.equal(trend?.baseline, 90);
    assert.equal(trend?.latest, 75);
  });

  it("honors a custom window", () => {
    // 7-day window: cutoff Oct 13, so Oct 12 is the baseline.
    const trend = gradeTrend([snap("2026-10-12", 90), snap("2026-10-19", 84)], today, 7);
    assert.equal(trend?.baseline, 90);
    assert.equal(trend?.change, -6);
  });
});

describe("trendTone", () => {
  it("is danger at the cutoff, warning for smaller drops, success otherwise", () => {
    assert.equal(TREND_DANGER_CHANGE, -10);
    assert.equal(trendTone(-10), "danger");
    assert.equal(trendTone(-9.9), "warning");
    assert.equal(trendTone(0), "success");
    assert.equal(trendTone(null), "neutral");
  });
});

describe("studentTrend", () => {
  it("returns the worst course and the average across courses with a trend", () => {
    const a = gradeTrend([snap("2026-10-01", 90), snap("2026-10-18", 80)], today)!;
    const b = gradeTrend([snap("2026-10-01", 70), snap("2026-10-18", 72)], today)!;
    const result = studentTrend([
      { courseName: "Algebra", trend: a },
      { courseName: "Biology", trend: b },
      { courseName: "History", trend: null },
    ]);
    assert.equal(result.worst?.courseName, "Algebra");
    assert.equal(result.averageChange, -4); // (-10 + 2) / 2
  });

  it("is empty when no course has a trend", () => {
    assert.deepEqual(studentTrend([{ courseName: "Algebra", trend: null }]), {
      worst: null,
      averageChange: null,
    });
  });
});
