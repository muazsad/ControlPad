"use server";

import { revalidatePath } from "next/cache";

import {
  attendanceForDecision,
  parseReviewDecision,
  reportNote,
} from "@/lib/absence-reports/review";
import { schoolClock } from "@/lib/alerts/attendance-escalation";
import { requireRole } from "@/lib/auth/current-profile";
import { getSchoolCalendar } from "@/lib/schedule/calendar-data";
import { getScheduleGroups } from "@/lib/schedule/schedule-groups-data";
import {
  minutesToTime,
  scheduleForDate,
  statusForArrival,
} from "@/lib/schedule/student-schedule";
import { createClient } from "@/lib/supabase/server";

export type AttendanceStatus = "present" | "tardy" | "absent" | "excused";
export type AttendanceActionState = { error: string | null; saved?: boolean };

/** "auto" = decide present vs tardy from the arrival time and the student's schedule. */
type StatusChoice = AttendanceStatus | "auto";

const statusChoices: StatusChoice[] = ["auto", "present", "tardy", "absent", "excused"];

function text(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

function nullable(form: FormData, key: string): string | null {
  const value = text(form, key);
  return value === "" ? null : value;
}

function parseStatus(value: string): StatusChoice | null {
  return (statusChoices as string[]).includes(value) ? (value as StatusChoice) : null;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

async function statusFromArrival(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
  date: string,
  arrivedAt: string,
): Promise<AttendanceStatus | { error: string }> {
  const [{ data: student, error: studentError }, { data: settings, error: settingsError }, groups, calendar] =
    await Promise.all([
      supabase.from("students").select("schedule_group_id").eq("id", studentId).single(),
      supabase.from("settings").select("school_start, tardy_window_hours").eq("id", 1).single(),
      getScheduleGroups(),
      getSchoolCalendar(),
    ]);
  if (studentError) return { error: studentError.message };
  if (settingsError) return { error: settingsError.message };

  const group = groups.find((item) => item.id === student.schedule_group_id) ?? null;
  const schedule = scheduleForDate(date, group, calendar, {
    schoolStart: String(settings.school_start).slice(0, 5),
    tardyWindowHours: Number(settings.tardy_window_hours),
  });

  // Not scheduled that day (e.g. a make-up visit): they came, so they're present.
  if (!schedule) return "present";
  return statusForArrival(arrivedAt, schedule);
}

export async function markAttendance(
  _prev: AttendanceActionState,
  form: FormData,
): Promise<AttendanceActionState> {
  const profile = await requireRole(["admin", "moderator"]);

  const studentId = text(form, "student_id");
  const date = text(form, "date");
  const arrivedNow = text(form, "intent") === "arrived_now";
  let status = arrivedNow ? "auto" : parseStatus(text(form, "status"));
  let arrivedAt: string | null = text(form, "arrived_at") || null;

  if (!studentId) return { error: "Missing student reference." };
  if (!isIsoDate(date)) return { error: "Choose a valid attendance date." };
  if (!status) return { error: "Choose an attendance status." };

  if (arrivedNow) {
    const clock = schoolClock(new Date());
    if (clock.date !== date) {
      return { error: "“Arrived now” only works for today. Enter the arrival time instead." };
    }
    arrivedAt = minutesToTime(clock.minutes);
  }

  if (arrivedAt && !isTime(arrivedAt)) return { error: "Arrival time must use HH:MM." };
  if (status === "absent" || status === "excused") arrivedAt = null;

  const supabase = await createClient();

  if (status === "auto") {
    if (!arrivedAt) {
      return { error: "Enter an arrival time, or pick a status instead of “From arrival time”." };
    }
    const resolved = await statusFromArrival(supabase, studentId, date, arrivedAt);
    if (typeof resolved !== "string") return resolved;
    status = resolved;
  }

  const { error } = await supabase.from("attendance").upsert(
    {
      student_id: studentId,
      date,
      status,
      arrived_at: arrivedAt,
      note: nullable(form, "note"),
      recorded_by: profile.id,
      recorded_at: new Date().toISOString(),
    },
    { onConflict: "student_id,date" },
  );

  if (error) return { error: error.message };

  revalidatePath("/attendance");
  return { error: null, saved: true };
}

/** Admin decision on a parent-reported absence (excused / unexcused / dismissed). */
export async function reviewAbsenceReport(
  _prev: AttendanceActionState,
  form: FormData,
): Promise<AttendanceActionState> {
  const profile = await requireRole(["admin"]);

  const reportId = text(form, "report_id");
  const decision = parseReviewDecision(text(form, "decision"));
  if (!reportId) return { error: "Missing report reference." };
  if (!decision) return { error: "Choose excused, unexcused, or dismiss." };

  const supabase = await createClient();
  const { data: report, error: reportError } = await supabase
    .from("absence_reports")
    .select("id, student_id, date, reason, status")
    .eq("id", reportId)
    .single();
  if (reportError) return { error: reportError.message };
  if (report.status !== "pending") return { error: "This report was already reviewed." };

  const { data: existing, error: existingError } = await supabase
    .from("attendance")
    .select("status")
    .eq("student_id", report.student_id)
    .eq("date", report.date)
    .maybeSingle();
  if (existingError) return { error: existingError.message };

  const outcome = attendanceForDecision(
    decision,
    (existing?.status as AttendanceStatus | undefined) ?? null,
  );
  if ("error" in outcome) return { error: outcome.error };

  const now = new Date().toISOString();
  if (outcome.status) {
    const { error } = await supabase.from("attendance").upsert(
      {
        student_id: report.student_id,
        date: report.date,
        status: outcome.status,
        arrived_at: null,
        note: reportNote(report.reason as string | null),
        recorded_by: profile.id,
        recorded_at: now,
      },
      { onConflict: "student_id,date" },
    );
    if (error) return { error: error.message };
  }

  const { error: updateError } = await supabase
    .from("absence_reports")
    .update({ status: decision, reviewed_by: profile.id, reviewed_at: now })
    .eq("id", reportId);
  if (updateError) return { error: updateError.message };

  revalidatePath("/attendance");
  revalidatePath("/");
  return { error: null, saved: true };
}
