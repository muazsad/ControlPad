import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateQuranInactivity } from "./quran";
import type { SchoolCalendarConfig } from "@/lib/schedule/calendar";

const noSchoolCalendar: SchoolCalendarConfig = {
  weeklyPattern: {
    sunday: false,
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
  },
  breaks: [],
  specialDays: [],
};

describe("quran inactivity calendar checks", () => {
  it("does not trip inactivity when a seven-day calendar gap contains no school days", () => {
    const result = evaluateQuranInactivity({
      lastLessonDate: "2026-07-01",
      asOfDate: "2026-07-08",
      inactivitySchoolDays: 7,
      calendar: noSchoolCalendar,
    });

    assert.equal(result.slipping, false);
    assert.equal(result.schoolDaysSinceLastLesson, 0);
  });
});
