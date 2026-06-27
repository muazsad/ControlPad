"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

export type AttendanceStatus = "present" | "tardy" | "absent" | "excused";
export type AttendanceActionState = { error: string | null; saved?: boolean };

const attendanceStatuses: AttendanceStatus[] = [
  "present",
  "tardy",
  "absent",
  "excused",
];

function text(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

function nullable(form: FormData, key: string): string | null {
  const value = text(form, key);
  return value === "" ? null : value;
}

function parseStatus(value: string): AttendanceStatus | null {
  return (attendanceStatuses as string[]).includes(value)
    ? (value as AttendanceStatus)
    : null;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function markAttendance(
  _prev: AttendanceActionState,
  form: FormData,
): Promise<AttendanceActionState> {
  const profile = await requireRole(["admin", "moderator"]);

  const studentId = text(form, "student_id");
  const date = text(form, "date");
  const status = parseStatus(text(form, "status"));

  if (!studentId) return { error: "Missing student reference." };
  if (!isIsoDate(date)) return { error: "Choose a valid attendance date." };
  if (!status) return { error: "Choose an attendance status." };

  const supabase = await createClient();
  const { error } = await supabase.from("attendance").upsert(
    {
      student_id: studentId,
      date,
      status,
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
