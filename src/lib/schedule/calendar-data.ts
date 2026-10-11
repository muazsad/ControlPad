import {
  DEFAULT_WEEKLY_PATTERN,
  type SpecialDayType,
  type SchoolBreak,
  type SchoolCalendarConfig,
  type SpecialDay,
  type WeeklyPattern,
} from "@/lib/schedule/calendar";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type CalendarClient = Awaited<ReturnType<typeof createClient>>;

type WeeklyPatternRow = WeeklyPattern;

type SchoolBreakRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
};

export type SpecialDayRow = {
  date: string;
  type: SpecialDayType;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  // Added by 20261011000000_special_day_options; absent before it is applied.
  students_expected?: boolean | null;
  send_attendance_alerts?: boolean | null;
  applies_to?: string[] | null;
  parent_message?: string | null;
  notify_parents?: boolean | null;
  parents_notified_at?: string | null;
};

export const SPECIAL_DAY_COLUMNS =
  "date, type, start_time, end_time, note, students_expected, send_attendance_alerts, applies_to, parent_message, notify_parents, parents_notified_at";
const LEGACY_SPECIAL_DAY_COLUMNS = "date, type, start_time, end_time, note";

/** Postgres "undefined column" — the special-day options migration isn't applied yet. */
function isMissingColumnError(error: SupabaseLikeError | null | undefined) {
  return error?.code === "42703" || /column .* does not exist/i.test(error?.message ?? "");
}

export function specialDayFromRow(row: SpecialDayRow): SpecialDay {
  return {
    date: row.date,
    type: row.type,
    startTime: row.start_time ? row.start_time.slice(0, 5) : null,
    endTime: row.end_time ? row.end_time.slice(0, 5) : null,
    note: row.note,
    studentsExpected: row.students_expected ?? row.type !== "no_school",
    sendAttendanceAlerts: row.send_attendance_alerts ?? true,
    appliesTo: row.applies_to ?? null,
    parentMessage: row.parent_message ?? null,
    notifyParents: row.notify_parents ?? false,
    parentsNotifiedAt: row.parents_notified_at ?? null,
  };
}

/** Loads special days, falling back to the original columns before the migration. */
export async function loadSpecialDayRows(
  supabase: CalendarClient,
): Promise<{ data: SpecialDayRow[] | null; error: SupabaseLikeError | null }> {
  const result = await supabase
    .from("school_special_days")
    .select(SPECIAL_DAY_COLUMNS)
    .order("date", { ascending: true });
  if (!isMissingColumnError(result.error)) {
    return { data: result.data as SpecialDayRow[] | null, error: result.error };
  }
  const legacy = await supabase
    .from("school_special_days")
    .select(LEGACY_SPECIAL_DAY_COLUMNS)
    .order("date", { ascending: true });
  return { data: legacy.data as SpecialDayRow[] | null, error: legacy.error };
}

type SupabaseLikeError = {
  code?: string;
  message?: string;
};

function defaultCalendarConfig(): SchoolCalendarConfig {
  return {
    weeklyPattern: DEFAULT_WEEKLY_PATTERN,
    breaks: [],
    specialDays: [],
  };
}

export function isMissingSchoolCalendarTableError(
  error: SupabaseLikeError | null | undefined,
): boolean {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" ||
    error?.code === "42P01" ||
    (/Could not find the table/i.test(message) &&
      /school_(weekly_patterns|breaks|special_days)/i.test(message)) ||
    (/relation .* does not exist/i.test(message) &&
      /school_(weekly_patterns|breaks|special_days)/i.test(message))
  );
}

async function loadSchoolCalendar(
  supabase: CalendarClient,
): Promise<SchoolCalendarConfig> {
  const [weeklyResult, breaksResult, specialDaysResult] = await Promise.all([
    supabase
      .from("school_weekly_patterns")
      .select("sunday, monday, tuesday, wednesday, thursday, friday, saturday")
      .eq("id", 1)
      .maybeSingle(),
    supabase
      .from("school_breaks")
      .select("id, name, start_date, end_date")
      .order("start_date", { ascending: true }),
    loadSpecialDayRows(supabase),
  ]);

  const errors = [
    weeklyResult.error,
    breaksResult.error,
    specialDaysResult.error,
  ].filter(Boolean);

  if (errors.some(isMissingSchoolCalendarTableError)) {
    const unexpectedError = errors.find(
      (error) => !isMissingSchoolCalendarTableError(error),
    );
    if (unexpectedError) throw new Error(unexpectedError.message);
    return defaultCalendarConfig();
  }

  if (weeklyResult.error) throw new Error(weeklyResult.error.message);
  if (breaksResult.error) throw new Error(breaksResult.error.message);
  if (specialDaysResult.error) throw new Error(specialDaysResult.error.message);

  return {
    weeklyPattern:
      ((weeklyResult.data as WeeklyPatternRow | null) ?? DEFAULT_WEEKLY_PATTERN),
    breaks: ((breaksResult.data ?? []) as SchoolBreakRow[]).map(
      (row): SchoolBreak => ({
        id: row.id,
        name: row.name,
        startDate: row.start_date,
        endDate: row.end_date,
      }),
    ),
    specialDays: (specialDaysResult.data ?? []).map(specialDayFromRow),
  };
}

export async function getSchoolCalendar(): Promise<SchoolCalendarConfig> {
  return loadSchoolCalendar(await createClient());
}

export async function getServiceSchoolCalendar(): Promise<SchoolCalendarConfig> {
  return loadSchoolCalendar(createServiceClient());
}
