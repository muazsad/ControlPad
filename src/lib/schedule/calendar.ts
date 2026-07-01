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

export type SpecialDayType = "no_school" | "half_day";

export type SpecialDay = {
  date: string;
  type: SpecialDayType;
  startTime?: string | null;
  endTime?: string | null;
  note?: string | null;
};

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

  if (specialDay?.type === "no_school") return "off";
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
  if (specialDay?.type === "half_day" && specialDay.startTime) {
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
