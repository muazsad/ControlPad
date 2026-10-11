import Link from "next/link";
import { AlertTriangle, GraduationCap, ListChecks } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { formatGrade, gradeTone } from "./grade-display";
import { paceForCourse, worstTone } from "@/lib/grades/pace";
import { loadPaceContext } from "@/lib/grades/pace-data";
import { easternDateKey } from "@/lib/grades/sweep";
import { getAllStudentMetrics } from "@/lib/people/student-metrics";
import { createClient } from "@/lib/supabase/server";

export default async function GradesPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const [metrics, { data: settingsData }, paceContext] = await Promise.all([
    getAllStudentMetrics(),
    supabase.from("settings").select("grade_floor").eq("id", 1).single(),
    loadPaceContext(),
  ]);

  // Pace per student from the latest snapshot fields already in the metrics query.
  const today = easternDateKey(new Date());
  const students = metrics.map((student) => {
    const evaluations = student.courseSnapshots.map((course) =>
      paceForCourse(
        paceContext,
        today,
        student.groupId,
        { startDate: course.startDate, endDate: course.endDate },
        { percentComplete: course.latestPercent, missingAssignments: course.latestMissing },
      ),
    );
    const behind = evaluations.filter(
      (e) => e.paceTone === "warning" || e.paceTone === "danger",
    ).length;
    const missing = evaluations.reduce((sum, e) => sum + (e.missing ?? 0), 0);
    return {
      ...student,
      paceBehind: behind,
      paceMissing: missing,
      paceTone: worstTone(evaluations.map((e) => e.paceTone)),
    };
  });

  const gradeFloor =
    settingsData?.grade_floor == null ? null : Number(settingsData.grade_floor);

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Grades"
          description="Grade averages and performance across all students. Click a student to view full course history."
          action={
            profile.role === "admin" || profile.role === "moderator" ? (
              <Button asChild className="h-10">
                <Link href="/grades/sweep">
                  <ListChecks className="size-4" aria-hidden="true" />
                  Weekly sweep
                </Link>
              </Button>
            ) : undefined
          }
        />

        <DataTable
          data={students}
          getRowKey={(row) => row.id}
          empty={
            <EmptyState
              title="No students found"
              description="No student records are linked to your account yet."
              icon={GraduationCap}
            />
          }
          columns={[
            {
              key: "student",
              header: "Student",
              cell: (row) => (
                <div>
                  <Link
                    href={`/students/${row.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.grade_level ?? "Grade not set"}
                  </p>
                </div>
              ),
            },
            {
              key: "avg_grade",
              header: "Avg grade",
              cell: (row) => {
                const belowFloor =
                  gradeFloor !== null &&
                  row.latestGradeValues.some((v) => v < gradeFloor);
                return (
                  <div className="flex items-center gap-1.5">
                    <StatusBadge
                      status={formatGrade(row.gradeScore)}
                      tone={gradeTone(row.gradeScore, gradeFloor)}
                    />
                    {belowFloor && (
                      <AlertTriangle
                        className="size-3.5 text-[var(--color-warning)]"
                        aria-label="One or more courses below grade floor"
                      />
                    )}
                  </div>
                );
              },
            },
            {
              key: "courses",
              header: "Courses",
              cell: (row) => (
                <span className="tabular-nums text-sm">
                  {row.courseCount}
                </span>
              ),
              className: "text-muted-foreground",
            },
            {
              key: "pace",
              header: "Pace",
              cell: (row) => (
                <div className="space-y-1">
                  <StatusBadge
                    status={
                      row.paceTone === "neutral"
                        ? "No pace data"
                        : row.paceBehind > 0
                          ? `${row.paceBehind} behind`
                          : "On pace"
                    }
                    tone={row.paceTone}
                  />
                  {row.paceMissing > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {row.paceMissing} missing
                    </p>
                  ) : null}
                </div>
              ),
            },
            {
              key: "performance",
              header: "Performance",
              cell: (row) => (
                <StatusBadge
                  status={
                    row.globalStatus === "scored" && row.globalScore !== null
                      ? `${Math.round(row.globalScore)}%`
                      : "Not enough data yet"
                  }
                  tone={row.globalTone}
                />
              ),
            },
          ]}
        />
      </div>
    </AppShell>
  );
}
