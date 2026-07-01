import {
  DEFAULT_WEEKLY_PATTERN,
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

type SpecialDayRow = {
  date: string;
  type: "no_school" | "half_day";
  start_time: string | null;
  end_time: string | null;
  note: string | null;
};

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
    supabase
      .from("school_special_days")
      .select("date, type, start_time, end_time, note")
      .order("date", { ascending: true }),
  ]);

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
    specialDays: ((specialDaysResult.data ?? []) as SpecialDayRow[]).map(
      (row): SpecialDay => ({
        date: row.date,
        type: row.type,
        startTime: row.start_time,
        endTime: row.end_time,
        note: row.note,
      }),
    ),
  };
}

export async function getSchoolCalendar(): Promise<SchoolCalendarConfig> {
  return loadSchoolCalendar(await createClient());
}

export async function getServiceSchoolCalendar(): Promise<SchoolCalendarConfig> {
  return loadSchoolCalendar(createServiceClient());
}
