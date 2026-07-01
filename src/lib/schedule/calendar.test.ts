import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_WEEKLY_PATTERN,
  dayType,
  isSchoolDay,
  schoolDaysBetween,
  type SchoolCalendarConfig,
} from "./calendar";

const config: SchoolCalendarConfig = {
  weeklyPattern: DEFAULT_WEEKLY_PATTERN,
  breaks: [
    {
      id: "winter-break",
      name: "Winter Break",
      startDate: "2026-12-21",
      endDate: "2026-12-25",
    },
  ],
  specialDays: [
    {
      date: "2026-07-06",
      type: "no_school",
      note: "Teacher work day",
    },
    {
      date: "2026-07-07",
      type: "half_day",
      startTime: "08:00",
      endTime: "12:00",
      note: "Conference day",
    },
  ],
};

describe("school calendar helpers", () => {
  it("uses the default Monday through Thursday plus Saturday weekly pattern", () => {
    assert.equal(isSchoolDay("2026-07-03", config), false);
    assert.equal(isSchoolDay("2026-07-04", config), true);
    assert.equal(isSchoolDay("2026-07-05", config), false);
    assert.equal(isSchoolDay("2026-07-06", config), false);
  });

  it("treats breaks and no-school special days as off days", () => {
    assert.equal(dayType("2026-12-22", config), "off");
    assert.equal(dayType("2026-07-06", config), "off");
  });

  it("treats half-day special days as school days with a half-day type", () => {
    assert.equal(dayType("2026-07-07", config), "half");
    assert.equal(isSchoolDay("2026-07-07", config), true);
  });

  it("counts school days inclusively across a date range", () => {
    assert.equal(schoolDaysBetween("2026-07-01", "2026-07-07", config), 4);
  });
});
