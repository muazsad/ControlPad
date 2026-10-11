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
import { studentGradeHealth } from "@/lib/grades/grade-health";
import { paceForCourse } from "@/lib/grades/pace";
import { loadPaceContext } from "@/lib/grades/pace-data";
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
  courses: {
    id: string;
    name: string;
    created_at: string | null;
    start_date: string | null;
    end_date: string | null;
  }[];
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
  const [{ data, error }, latestGrades, paceContext] = await Promise.all([
    supabase
      .from("students")
      .select(
        "id, first_name, last_name, schedule_group_id, schedule_groups(id, name), courses(id, name, created_at, start_date, end_date)",
      )
      .eq("enrollment_status", "active"),
    fetchLatestGrades(supabase),
    loadPaceContext(),
  ]);
  const today = easternDateKey(now);
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
    const health = studentGradeHealth({
      courses: courses.map((course) => ({
        courseId: course.id,
        courseName: course.name,
        createdAt: course.created_at,
        latestRecordedAt: latestGrades.get(course.id)?.recordedAt ?? null,
        snapshots: [],
      })),
      groupId: student.schedule_group_id,
      context: paceContext,
      today,
    });
    for (const course of courses) {
      const latest = latestGrades.get(course.id) ?? null;
      const staleness = health.courses.find((item) => item.courseId === course.id)?.staleness;
      const pace = paceForCourse(
        paceContext,
        today,
        student.schedule_group_id,
        { startDate: course.start_date, endDate: course.end_date },
        latest,
      );
      rows.push({
        courseId: course.id,
        studentId: student.id,
        studentName: student.name,
        courseName: course.name,
        groupId: student.schedule_group_id,
        lastValue: latest?.value ?? null,
        lastDate: latest ? formatGradeDate(latest.recordedAt, now) : null,
        lastPercent: latest?.percentComplete ?? null,
        lastMissing: latest?.missingAssignments ?? null,
        expectedPercent: pace.expected,
        paceTone: pace.paceTone,
        missingTone: pace.missingTone,
        updatedRecently: isWithinSweepWindow(latest?.recordedAt ?? null, now),
        staleStatus: staleness?.status ?? "fresh",
        staleDays: staleness?.schoolDaysSince ?? null,
      });
    }
  }

  // Stale rows float to the top (stable sort keeps students grouped A–Z).
  const staleRank = (row: SweepRow) => (row.staleStatus === "fresh" ? 1 : 0);
  rows.sort((a, b) => staleRank(a) - staleRank(b));

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Weekly grade sweep"
          description={`Type each course's current GCVS grade. Enter and the arrow keys move up and down the same column, Tab moves across a row, Esc clears a box. % complete and Missing are optional: blank fields keep their last value. Courses with no change are skipped. "Updated" means saved within the last ${SWEEP_WINDOW_DAYS} days.`}
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
