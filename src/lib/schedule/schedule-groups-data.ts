import type { ScheduleGroup } from "@/lib/schedule/student-schedule";
import { createClient, createServiceClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  schedule_group_days:
    | {
        weekday: number;
        start_time: string;
        tardy_grace_minutes: number;
        absence_check_time: string;
      }[]
    | null;
};

function isMissingTableError(error: { code?: string; message?: string } | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" ||
    error?.code === "42P01" ||
    /schedule_group/i.test(message)
  );
}

async function loadScheduleGroups(supabase: Client): Promise<ScheduleGroup[]> {
  const { data, error } = await supabase
    .from("schedule_groups")
    .select(
      "id, name, description, schedule_group_days(weekday, start_time, tardy_grace_minutes, absence_check_time)",
    )
    .order("name", { ascending: true });

  if (error) {
    // Before the schedule-groups migration is applied, behave as "no groups".
    if (isMissingTableError(error)) return [];
    throw new Error(error.message);
  }

  return ((data ?? []) as GroupRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    days: (row.schedule_group_days ?? [])
      .map((day) => ({
        weekday: day.weekday,
        startTime: day.start_time.slice(0, 5),
        tardyGraceMinutes: day.tardy_grace_minutes,
        absenceCheckTime: day.absence_check_time.slice(0, 5),
      }))
      .sort((a, b) => a.weekday - b.weekday),
  }));
}

export async function getScheduleGroups(): Promise<ScheduleGroup[]> {
  return loadScheduleGroups(await createClient());
}

export async function getServiceScheduleGroups(): Promise<ScheduleGroup[]> {
  return loadScheduleGroups(createServiceClient());
}
