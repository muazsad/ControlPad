import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_WEEKLY_PATTERN,
  type SchoolCalendarConfig,
} from "@/lib/schedule/calendar";
import {
  addMinutesToTime,
  formatTime12h,
  scheduleForDate,
  statusForArrival,
  type ScheduleGroup,
} from "./student-schedule";

const calendar: SchoolCalendarConfig = {
  weeklyPattern: DEFAULT_WEEKLY_PATTERN,
  breaks: [{ id: "b1", name: "Winter", startDate: "2026-12-21", endDate: "2026-12-31" }],
  specialDays: [
    { date: "2026-10-14", type: "no_school" },
    // Existing half days are scoped to ungrouped students by the migration.
    {
      date: "2026-10-15",
      type: "half_day",
      startTime: "09:00",
      endTime: "12:00",
      appliesTo: ["ungrouped"],
    },
  ],
};

const defaults = { schoolStart: "08:00", tardyWindowHours: 2 };

const quranOnly: ScheduleGroup = {
  id: "g-quran",
  name: "Quran only",
  days: [
    // Friday (school-wide pattern has Friday off)
    { weekday: 5, startTime: "16:00", tardyGraceMinutes: 5, absenceCheckTime: "16:30" },
    // Thursday
    { weekday: 4, startTime: "16:00:00", tardyGraceMinutes: 5, absenceCheckTime: "16:30:00" },
  ],
};

describe("scheduleForDate", () => {
  it("uses the group's weekdays instead of the school-wide pattern", () => {
    // 2026-10-16 is a Friday
    const friday = scheduleForDate("2026-10-16", quranOnly, calendar, defaults);
    assert.equal(friday?.startTime, "16:00");
    assert.equal(friday?.tardyCutoffTime, "16:05");
    assert.equal(friday?.absenceCheckTime, "16:30");
    assert.equal(friday?.groupName, "Quran only");

    // 2026-10-12 is a Monday — not a Quran-only day
    assert.equal(scheduleForDate("2026-10-12", quranOnly, calendar, defaults), null);
  });

  it("applies breaks and no-school days to grouped students", () => {
    assert.equal(scheduleForDate("2026-12-24", quranOnly, calendar, defaults), null); // Thu in break
    assert.equal(scheduleForDate("2026-10-14", quranOnly, calendar, defaults), null);
  });

  it("keeps group times on half days scoped to ungrouped students", () => {
    const thursdayHalf = scheduleForDate("2026-10-15", quranOnly, calendar, defaults);
    assert.equal(thursdayHalf?.startTime, "16:00");
  });

  it("falls back to school-wide settings for students without a group", () => {
    const monday = scheduleForDate("2026-10-12", null, calendar, defaults);
    assert.deepEqual(monday, {
      source: "default",
      groupId: null,
      groupName: null,
      startTime: "08:00",
      tardyCutoffTime: "08:00",
      absenceCheckTime: "10:00",
      parentAlerts: true,
      specialDay: null,
    });
    assert.equal(scheduleForDate("2026-10-16", null, calendar, defaults), null); // Friday off
    assert.equal(scheduleForDate("2026-10-15", null, calendar, defaults)?.startTime, "09:00"); // half day
  });
});

describe("scheduleForDate with special-day options", () => {
  const withSpecial = (special: SchoolCalendarConfig["specialDays"][number]) => ({
    ...calendar,
    specialDays: [special],
  });
  // 2026-10-22 is a Thursday: ungrouped school day and a Quran-only day.
  const THURSDAY = "2026-10-22";

  it("moves group start times on a school-wide schedule change", () => {
    const cal = withSpecial({
      date: THURSDAY,
      type: "schedule_change",
      startTime: "17:00",
      endTime: "19:00",
    });
    const group = scheduleForDate(THURSDAY, quranOnly, cal, defaults);
    assert.equal(group?.startTime, "17:00");
    assert.equal(group?.tardyCutoffTime, "17:05");
    assert.equal(group?.absenceCheckTime, "17:30"); // offset kept
    assert.equal(group?.specialDay, "schedule_change");
    assert.equal(scheduleForDate(THURSDAY, null, cal, defaults)?.startTime, "17:00");
  });

  it("closes only the groups a scoped day applies to", () => {
    const cal = withSpecial({
      date: THURSDAY,
      type: "field_trip",
      studentsExpected: false,
      appliesTo: ["g-quran"],
    });
    assert.equal(scheduleForDate(THURSDAY, quranOnly, cal, defaults), null);
    const ungrouped = scheduleForDate(THURSDAY, null, cal, defaults);
    assert.equal(ungrouped?.startTime, "08:00");
    assert.equal(ungrouped?.specialDay, null);
  });

  it("keeps students expected but pauses parent alerts when asked", () => {
    const cal = withSpecial({
      date: THURSDAY,
      type: "no_gcvs",
      studentsExpected: true,
      sendAttendanceAlerts: false,
    });
    const ungrouped = scheduleForDate(THURSDAY, null, cal, defaults);
    assert.equal(ungrouped?.startTime, "08:00");
    assert.equal(ungrouped?.parentAlerts, false);
    assert.equal(scheduleForDate(THURSDAY, quranOnly, cal, defaults)?.parentAlerts, false);
  });

  it("treats a school-wide 'not expected' day as off for everyone", () => {
    const cal = withSpecial({ date: THURSDAY, type: "other", studentsExpected: false });
    assert.equal(scheduleForDate(THURSDAY, null, cal, defaults), null);
    assert.equal(scheduleForDate(THURSDAY, quranOnly, cal, defaults), null);
  });
});

describe("statusForArrival", () => {
  it("is present up to and including the cutoff, tardy after", () => {
    assert.equal(statusForArrival("08:10", { tardyCutoffTime: "08:10" }), "present");
    assert.equal(statusForArrival("07:45", { tardyCutoffTime: "08:10" }), "present");
    assert.equal(statusForArrival("08:11", { tardyCutoffTime: "08:10" }), "tardy");
  });
});

describe("time helpers", () => {
  it("adds minutes and formats 12-hour times", () => {
    assert.equal(addMinutesToTime("08:00", 150), "10:30");
    assert.equal(addMinutesToTime("23:30", 90), "23:59");
    assert.equal(formatTime12h("13:05"), "1:05 PM");
    assert.equal(formatTime12h("00:15"), "12:15 AM");
    assert.equal(formatTime12h("12:00"), "12:00 PM");
  });
});
