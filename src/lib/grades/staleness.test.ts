import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_WEEKLY_PATTERN, type SchoolCalendarConfig } from "@/lib/schedule/calendar";

import { expectedDayPredicate } from "./pace";
import { courseStaleness, schoolDaysBetween, staleDescription } from "./staleness";

const defaults = { schoolStart: "08:00", tardyWindowHours: 2 };

function calendar(partial: Partial<SchoolCalendarConfig> = {}): SchoolCalendarConfig {
  return { weeklyPattern: DEFAULT_WEEKLY_PATTERN, breaks: [], specialDays: [], ...partial };
}

// Default week: Mon–Thu + Sat. Oct 5 2026 is a Monday.
const isExpected = expectedDayPredicate(null, calendar(), defaults);
const base = { thresholdSchoolDays: 5, isExpectedDay: isExpected };

describe("schoolDaysBetween", () => {
  it("counts expected days after `from` through `to`", () => {
    // Oct 5 → Oct 12: Tue 6, Wed 7, Thu 8, Sat 10, Mon 12 (Fri 9, Sun 11 off)
    assert.equal(schoolDaysBetween("2026-10-05", "2026-10-12", isExpected), 5);
    assert.equal(schoolDaysBetween("2026-10-12", "2026-10-12", isExpected), 0);
  });
});

describe("courseStaleness", () => {
  it("is fresh within the threshold, counting the boundary as fresh", () => {
    const result = courseStaleness({
      ...base,
      latestRecordedAt: "2026-10-05T15:00:00Z",
      createdAt: "2026-09-01T12:00:00Z",
      today: "2026-10-12", // 5 school days later
    });
    assert.deepEqual(result, { status: "fresh", schoolDaysSince: 5 });
  });

  it("is stale once MORE than the threshold of school days has passed", () => {
    const result = courseStaleness({
      ...base,
      latestRecordedAt: "2026-10-05T15:00:00Z",
      createdAt: "2026-09-01T12:00:00Z",
      today: "2026-10-13", // 6 school days later
    });
    assert.deepEqual(result, { status: "stale", schoolDaysSince: 6 });
  });

  it("does not count a break inside the gap", () => {
    const withBreak = expectedDayPredicate(
      null,
      calendar({
        breaks: [{ id: "b", name: "Break", startDate: "2026-10-06", endDate: "2026-10-12" }],
      }),
      defaults,
    );
    // Without the break Oct 5 → Oct 17 is 9 school days; the break removes 5 of them.
    const result = courseStaleness({
      ...base,
      isExpectedDay: withBreak,
      latestRecordedAt: "2026-10-05T15:00:00Z",
      createdAt: null,
      today: "2026-10-17",
    });
    assert.equal(result.schoolDaysSince, 4); // Oct 13, 14, 15, 17
    assert.equal(result.status, "fresh");
  });

  it("is never when there is no snapshot and the course is older than the threshold", () => {
    const result = courseStaleness({
      ...base,
      latestRecordedAt: null,
      createdAt: "2026-09-01T12:00:00Z",
      today: "2026-10-13",
    });
    assert.equal(result.status, "never");
    assert.ok((result.schoolDaysSince ?? 0) > 5);
  });

  it("gives a brand-new ungraded course the benefit of the doubt", () => {
    const result = courseStaleness({
      ...base,
      latestRecordedAt: null,
      createdAt: "2026-10-10T12:00:00Z",
      today: "2026-10-13",
    });
    assert.equal(result.status, "fresh");
  });

  it("is fresh with unknown dates rather than guessing", () => {
    assert.deepEqual(
      courseStaleness({ ...base, latestRecordedAt: null, createdAt: null, today: "2026-10-13" }),
      { status: "fresh", schoolDaysSince: null },
    );
  });

  it("uses the Eastern date of the snapshot, not the UTC date", () => {
    // 02:00 UTC Oct 6 is 22:00 EDT Oct 5.
    const result = courseStaleness({
      ...base,
      latestRecordedAt: "2026-10-06T02:00:00Z",
      createdAt: null,
      today: "2026-10-08",
    });
    assert.equal(result.schoolDaysSince, 3); // Oct 6, 7, 8
  });
});

describe("staleDescription", () => {
  it("reads plainly for stale and never-graded courses", () => {
    assert.equal(
      staleDescription("Biology", { status: "stale", schoolDaysSince: 12 }),
      "Biology: no update in 12 school days",
    );
    assert.equal(
      staleDescription("Biology", { status: "never", schoolDaysSince: 14 }),
      "Biology: never graded (added 14 school days ago)",
    );
  });
});
