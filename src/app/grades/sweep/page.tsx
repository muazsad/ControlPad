import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { PageHeader } from "@/components/controlpad/page-header";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/current-profile";
import {
  SCHOOL_TIME_ZONE,
  SWEEP_WINDOW_DAYS,
  easternDateKey,
  isWithinSweepWindow,
} from "@/lib/grades/sweep";
import { fetchLatestGrades } from "@/lib/grades/sweep-data";
import { studentName } from "@/lib/people/people";
import { createClient } from "@/lib/supabase/server";

import { SweepForm, type SweepGroup, type SweepRow } from "./sweep-form";

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  schedule_group_id: string | null;
  schedule_groups: { id: string; name: string } | null;
  courses: { id: string; name: string }[];
};

function formatGradeDate(recordedAt: string, now: Date): string {
  const date = new Date(recordedAt);
  const sameYear =
    easternDateKey(date).slice(0, 4) === easternDateKey(now).slice(0, 4);
  return date.toLocaleDateString("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

const byText = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

export default async function GradeSweepPage() {
  const profile = await requireRole(["admin", "moderator"]);
  const supabase = await createClient();
  const now = new Date();

  // Query 1: active students + their courses (+ schedule group name).
  // Query 2: latest grade per course. Both bulk; no per-student loops.
  const [{ data, error }, latestGrades] = await Promise.all([
    supabase
      .from("students")
      .select(
        "id, first_name, last_name, schedule_group_id, schedule_groups(id, name), courses(id, name)",
      )
      .eq("enrollment_status", "active"),
    fetchLatestGrades(supabase),
  ]);
  if (error) throw error;

  const students = ((data ?? []) as unknown as StudentRow[])
    .map((student) => ({ ...student, name: studentName(student) }))
    .sort((a, b) => byText(a.name, b.name));

  const rows: SweepRow[] = [];
  const groups = new Map<string, SweepGroup>();

  for (const student of students) {
    if (student.schedule_groups) {
      groups.set(student.schedule_groups.id, student.schedule_groups);
    }
    const courses = [...student.courses].sort((a, b) => byText(a.name, b.name));
    for (const course of courses) {
      const latest = latestGrades.get(course.id) ?? null;
      rows.push({
        courseId: course.id,
        studentId: student.id,
        studentName: student.name,
        courseName: course.name,
        groupId: student.schedule_group_id,
        lastValue: latest?.value ?? null,
        lastDate: latest ? formatGradeDate(latest.recordedAt, now) : null,
        updatedRecently: isWithinSweepWindow(latest?.recordedAt ?? null, now),
      });
    }
  }

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Weekly grade sweep"
          description={`Type each course's current GCVS grade. Enter or Tab moves down, Shift+Enter moves up, Esc clears. Courses with no change are skipped. "Updated" means saved within the last ${SWEEP_WINDOW_DAYS} days.`}
          action={
            <Button asChild variant="outline" className="h-10">
              <Link href="/grades">
                <ArrowLeft className="size-4" aria-hidden="true" />
                Grades
              </Link>
            </Button>
          }
        />

        <SweepForm
          userId={profile.id}
          todayKey={easternDateKey(now)}
          rows={rows}
          groups={[...groups.values()].sort((a, b) => byText(a.name, b.name))}
        />
      </div>
    </AppShell>
  );
}
