// ── Tunable constants ────────────────────────────────────────────────────────

export const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export const DEFAULT_WEEKLY_PATTERN: WeeklyPattern = {
  sunday: false,
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: false,
  saturday: true,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────────────────

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export type WeeklyPattern = Record<WeekdayKey, boolean>;

export type SchoolBreak = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
};

export const SPECIAL_DAY_TYPES = [
  "no_school",
  "half_day",
  "schedule_change",
  "no_gcvs",
  "field_trip",
  "other",
] as const;

export type SpecialDayType = (typeof SPECIAL_DAY_TYPES)[number];

export const SPECIAL_DAY_TYPE_LABELS: Record<SpecialDayType, string> = {
  no_school: "No school",
  half_day: "Half day",
  schedule_change: "Schedule change",
  no_gcvs: "No GCVS",
  field_trip: "Field trip",
  other: "Other",
};

/** Token in `appliesTo` meaning "students without a schedule group". */
export const UNGROUPED_SCOPE = "ungrouped";

export type SpecialDay = {
  date: string;
  type: SpecialDayType;
  startTime?: string | null;
  endTime?: string | null;
  note?: string | null;
  /** false = nobody in scope is expected. Defaults: false for no_school, else true. */
  studentsExpected?: boolean;
  /** false = absence/tardy texts to parents are paused for students in scope. */
  sendAttendanceAlerts?: boolean;
  /** null/undefined = whole school; else group ids and/or UNGROUPED_SCOPE. */
  appliesTo?: string[] | null;
  parentMessage?: string | null;
  notifyParents?: boolean;
  parentsNotifiedAt?: string | null;
};

export function isSpecialDayType(value: string): value is SpecialDayType {
  return (SPECIAL_DAY_TYPES as readonly string[]).includes(value);
}

/** Whether nobody in scope is expected on this special day. */
export function specialDayClosesSchool(day: SpecialDay): boolean {
  return day.type === "no_school" || day.studentsExpected === false;
}

/** Whether the special day applies to a student in `groupId` (null = ungrouped). */
export function specialDayAppliesTo(day: SpecialDay, groupId: string | null): boolean {
  if (!day.appliesTo || day.appliesTo.length === 0) return true;
  return day.appliesTo.includes(groupId ?? UNGROUPED_SCOPE);
}

/** Whether the special day covers the whole school (no group scoping). */
export function specialDayIsSchoolWide(day: SpecialDay): boolean {
  return !day.appliesTo || day.appliesTo.length === 0;
}

export type SchoolCalendarConfig = {
  weeklyPattern: WeeklyPattern;
  breaks: SchoolBreak[];
  specialDays: SpecialDay[];
};

export type CalendarDayType = "full" | "half" | "off";

// ── Helpers ──────────────────────────────────────────────────────────────────

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function utcDate(value: string | Date): Date {
  const iso = dateOnly(value);
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid calendar date: ${String(value)}`);
  }
  return date;
}

function weekdayFor(value: string | Date): WeekdayKey {
  return WEEKDAY_KEYS[utcDate(value).getUTCDay()];
}

function isWithinInclusive(date: string, start: string, end: string): boolean {
  return date >= dateOnly(start) && date <= dateOnly(end);
}

function specialDayFor(
  date: string,
  config: SchoolCalendarConfig,
): SpecialDay | undefined {
  return config.specialDays.find((day) => dateOnly(day.date) === date);
}

function isBreakDay(date: string, config: SchoolCalendarConfig): boolean {
  return config.breaks.some((schoolBreak) =>
    isWithinInclusive(date, schoolBreak.startDate, schoolBreak.endDate),
  );
}

// ── Public functions ─────────────────────────────────────────────────────────

export function dayType(
  dateValue: string | Date,
  config: SchoolCalendarConfig,
): CalendarDayType {
  const date = dateOnly(dateValue);
  const specialDay = specialDayFor(date, config);

  if (specialDay && specialDayIsSchoolWide(specialDay) && specialDayClosesSchool(specialDay)) {
    return "off";
  }
  if (isBreakDay(date, config)) return "off";
  if (specialDay?.type === "half_day") return "half";

  return config.weeklyPattern[weekdayFor(date)] ? "full" : "off";
}

export function specialDayForDate(
  dateValue: string | Date,
  config: SchoolCalendarConfig,
): SpecialDay | undefined {
  return specialDayFor(dateOnly(dateValue), config);
}

export function schoolStartForDate(
  dateValue: string | Date,
  config: SchoolCalendarConfig,
  standardStartTime: string,
): string {
  const specialDay = specialDayForDate(dateValue, config);
  if (specialDay?.startTime && specialDayAppliesTo(specialDay, null)) {
    return specialDay.startTime;
  }
  return standardStartTime;
}

export function isSchoolDay(
  date: string | Date,
  config: SchoolCalendarConfig,
): boolean {
  return dayType(date, config) !== "off";
}

export function schoolDaysBetween(
  start: string | Date,
  end: string | Date,
  config: SchoolCalendarConfig,
): number {
  const startDate = utcDate(start);
  const endDate = utcDate(end);

  if (endDate < startDate) return 0;

  let count = 0;
  for (
    let cursor = startDate.getTime();
    cursor <= endDate.getTime();
    cursor += MS_PER_DAY
  ) {
    if (isSchoolDay(new Date(cursor), config)) count += 1;
  }

  return count;
}

export function schoolDaysSince(
  startExclusive: string | Date,
  endInclusive: string | Date,
  config: SchoolCalendarConfig,
): number {
  const startDate = utcDate(startExclusive);
  startDate.setUTCDate(startDate.getUTCDate() + 1);
  return schoolDaysBetween(startDate, endInclusive, config);
}

export function schoolDayWindowEnding(
  endDate: string | Date,
  schoolDayCount: number,
  config: SchoolCalendarConfig,
): string[] {
  if (schoolDayCount <= 0) return [];

  const dates: string[] = [];
  const cursor = utcDate(endDate);

  while (dates.length < schoolDayCount) {
    const date = dateOnly(cursor);
    if (isSchoolDay(date, config)) dates.unshift(date);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return dates;
}
