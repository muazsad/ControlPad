import {
  dayType,
  schoolStartForDate,
  specialDayForDate,
  type SchoolCalendarConfig,
} from "@/lib/schedule/calendar";

// Resolves *when* a given student is expected on a given date, based on their
// schedule group (or the school-wide defaults for students without a group).
// Pure functions only — no database access. Times are "HH:MM" in the school's
// local time zone (America/New_York).

// ── Types ────────────────────────────────────────────────────────────────────

export type ScheduleGroupDay = {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  startTime: string;
  tardyGraceMinutes: number;
  absenceCheckTime: string;
};

export type ScheduleGroup = {
  id: string;
  name: string;
  description?: string | null;
  days: ScheduleGroupDay[];
};

/** School-wide settings used for students who are not in a group. */
export type DefaultSchedule = {
  schoolStart: string;
  tardyWindowHours: number;
};

export type DaySchedule = {
  source: "group" | "default";
  groupId: string | null;
  groupName: string | null;
  startTime: string;
  /** Arrivals strictly after this time are tardy. */
  tardyCutoffTime: string;
  /** When unmarked/absent students are first flagged to the admin. */
  absenceCheckTime: string;
};

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// ── Time helpers ─────────────────────────────────────────────────────────────

export function normalizeTime(value: string): string {
  return value.slice(0, 5);
}

export function timeToMinutes(value: string): number {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

export function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function addMinutesToTime(value: string, minutes: number): string {
  return minutesToTime(timeToMinutes(value) + minutes);
}

/** "13:05" → "1:05 PM" */
export function formatTime12h(value: string): string {
  const minutes = timeToMinutes(value);
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function weekdayOf(date: string): number {
  return new Date(`${date.slice(0, 10)}T00:00:00.000Z`).getUTCDay();
}

// ── Public functions ─────────────────────────────────────────────────────────

/**
 * The student's schedule for `date`, or null if they are not expected.
 *
 * - Breaks and "no school" special days apply to everyone.
 * - Grouped students attend on their group's weekdays (the school-wide weekly
 *   pattern does not apply to them) and keep their group's times on half days.
 * - Students without a group use the school-wide weekly pattern, school start
 *   (or the half-day start) and tardy window, with no tardy grace.
 */
export function scheduleForDate(
  date: string,
  group: ScheduleGroup | null,
  calendar: SchoolCalendarConfig,
  defaults: DefaultSchedule,
): DaySchedule | null {
  const special = specialDayForDate(date, calendar);
  if (special?.type === "no_school") return null;
  const isBreak = calendar.breaks.some(
    (schoolBreak) =>
      date >= schoolBreak.startDate.slice(0, 10) &&
      date <= schoolBreak.endDate.slice(0, 10),
  );
  if (isBreak) return null;

  if (group) {
    const day = group.days.find((item) => item.weekday === weekdayOf(date));
    if (!day) return null;
    const startTime = normalizeTime(day.startTime);
    return {
      source: "group",
      groupId: group.id,
      groupName: group.name,
      startTime,
      tardyCutoffTime: addMinutesToTime(startTime, day.tardyGraceMinutes),
      absenceCheckTime: normalizeTime(day.absenceCheckTime),
    };
  }

  if (dayType(date, calendar) === "off") return null;
  const startTime = normalizeTime(
    schoolStartForDate(date, calendar, defaults.schoolStart),
  );
  return {
    source: "default",
    groupId: null,
    groupName: null,
    startTime,
    tardyCutoffTime: startTime,
    absenceCheckTime: addMinutesToTime(
      startTime,
      defaults.tardyWindowHours * 60,
    ),
  };
}

/** Present if they arrived at or before the tardy cutoff, otherwise tardy. */
export function statusForArrival(
  arrivedAt: string,
  schedule: Pick<DaySchedule, "tardyCutoffTime">,
): "present" | "tardy" {
  return timeToMinutes(arrivedAt) <= timeToMinutes(schedule.tardyCutoffTime)
    ? "present"
    : "tardy";
}
