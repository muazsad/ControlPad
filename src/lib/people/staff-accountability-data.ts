// Loads today's staff checklist for the admin dashboard (RLS: admin reads all).

import { schoolClock } from "@/lib/alerts/attendance-escalation";
import { getSchoolCalendar } from "@/lib/schedule/calendar-data";
import { getScheduleGroups } from "@/lib/schedule/schedule-groups-data";
import { createClient } from "@/lib/supabase/server";

import {
  buildStaffChecklist,
  type AccountabilityAttendance,
  type AccountabilityStudent,
  type StaffMember,
  type TeacherChecklist,
} from "./staff-accountability";

type Client = Awaited<ReturnType<typeof createClient>>;

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  schedule_group_id: string | null;
  attendance: { status: AccountabilityAttendance; date: string }[] | null;
  quran_progress: { date: string }[] | null;
};

/** group id → teacher id. Empty before the teacher migration is applied. */
export async function getGroupTeachers(supabase?: Client): Promise<Map<string, string>> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("schedule_groups")
    .select("id, teacher_id")
    .not("teacher_id", "is", null);
  if (error) return new Map();
  return new Map((data ?? []).map((row) => [row.id as string, row.teacher_id as string]));
}

/** Admins and moderators, for the teacher picker and the checklist. */
export async function getStaffMembers(supabase?: Client): Promise<StaffMember[]> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client
    .from("profiles")
    .select("id, full_name")
    .in("role", ["admin", "moderator"])
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id as string, name: row.full_name as string }));
}

export async function getStaffChecklist(now = new Date()): Promise<{
  date: string;
  rows: TeacherChecklist[];
  anyTeacherAssigned: boolean;
}> {
  const supabase = await createClient();
  const clock = schoolClock(now);
  const date = clock.date;

  const [settingsResult, groups, calendar, groupTeachers, staff, studentsResult, reportsResult] =
    await Promise.all([
      supabase.from("settings").select("school_start, tardy_window_hours").eq("id", 1).single(),
      getScheduleGroups(),
      getSchoolCalendar(),
      getGroupTeachers(supabase),
      getStaffMembers(supabase),
      supabase
        .from("students")
        .select(
          "id, first_name, last_name, schedule_group_id, attendance(status, date), quran_progress(date)",
        )
        .eq("enrollment_status", "active")
        .eq("attendance.date", date)
        .eq("quran_progress.date", date),
      supabase
        .from("absence_reports")
        .select("student_id")
        .eq("date", date)
        .in("status", ["pending", "unexcused"]),
    ]);
  if (settingsResult.error) throw new Error(settingsResult.error.message);
  if (studentsResult.error) throw new Error(studentsResult.error.message);

  // Tolerate the absence-reports table not existing yet.
  const reported = new Set(
    reportsResult.error ? [] : (reportsResult.data ?? []).map((row) => row.student_id as string),
  );

  const students: AccountabilityStudent[] = ((studentsResult.data ?? []) as StudentRow[]).map(
    (row) => ({
      id: row.id,
      name: `${row.first_name} ${row.last_name}`.trim(),
      groupId: row.schedule_group_id,
      attendance: (row.attendance ?? []).find((record) => record.date === date)?.status ?? null,
      quranLogged: (row.quran_progress ?? []).some((record) => record.date === date),
      reportedAbsent: reported.has(row.id),
    }),
  );

  const rows = buildStaffChecklist({
    date,
    nowMinutes: clock.minutes,
    students,
    groups,
    groupTeachers,
    staff,
    calendar,
    defaults: {
      schoolStart: String(settingsResult.data.school_start).slice(0, 5),
      tardyWindowHours: Number(settingsResult.data.tardy_window_hours),
    },
  });

  return { date, rows, anyTeacherAssigned: groupTeachers.size > 0 };
}
