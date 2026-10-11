// Loads absence reports for the signed-in user (RLS: admin all, moderator read).
// Returns empty results if the table doesn't exist yet, so pages keep working
// before the migration is applied.

import { createClient } from "@/lib/supabase/server";

export type AbsenceReportStatus = "pending" | "excused" | "unexcused" | "dismissed";

export type AbsenceReport = {
  id: string;
  studentId: string;
  studentName: string;
  guardianName: string | null;
  date: string;
  reason: string | null;
  status: AbsenceReportStatus;
  createdAt: string;
};

type Row = {
  id: string;
  student_id: string;
  date: string;
  reason: string | null;
  status: AbsenceReportStatus;
  created_at: string;
  students: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
  guardians: { full_name: string } | { full_name: string }[] | null;
};

const SELECT =
  "id, student_id, date, reason, status, created_at, students(first_name, last_name), guardians(full_name)";

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function toReport(row: Row): AbsenceReport {
  const student = one(row.students);
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: student ? `${student.first_name} ${student.last_name}`.trim() : "Unknown student",
    guardianName: one(row.guardians)?.full_name ?? null,
    date: row.date,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** All reports still waiting for review, oldest date first. */
export async function getPendingAbsenceReports(): Promise<AbsenceReport[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("absence_reports")
    .select(SELECT)
    .eq("status", "pending")
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return [];
  return ((data ?? []) as Row[]).map(toReport);
}

/** Reports for one date (any status), keyed by student id. */
export async function getAbsenceReportsForDate(date: string): Promise<Map<string, AbsenceReport>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("absence_reports").select(SELECT).eq("date", date);
  if (error) return new Map();
  return new Map(((data ?? []) as Row[]).map((row) => [row.student_id, toReport(row)]));
}
