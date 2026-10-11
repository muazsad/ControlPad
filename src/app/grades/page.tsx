import Link from "next/link";
import { AlertTriangle, GraduationCap, ListChecks, TrendingDown } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { Sparkline } from "@/components/controlpad/sparkline";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { formatGrade, gradeTone } from "./grade-display";
import { studentGradeHealth } from "@/lib/grades/grade-health";
import { paceForCourse, worstTone } from "@/lib/grades/pace";
import { loadPaceContext } from "@/lib/grades/pace-data";
import { easternDateKey } from "@/lib/grades/sweep";
import { TREND_WINDOW_DAYS, trendTone } from "@/lib/grades/trend";
import { getAllStudentMetrics } from "@/lib/people/student-metrics";
import { createClient } from "@/lib/supabase/server";

export default async function GradesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const profile = await getCurrentProfile();
  const canManage = profile.role === "admin" || profile.role === "moderator";
  const { view } = await searchParams;
  const showDrops = canManage && view === "drops";
  const supabase = await createClient();

  // Pace, staleness and trends are staff-only (parents can't read settings).
  const [metrics, { data: settingsData }, paceContext] = await Promise.all([
    getAllStudentMetrics(),
    supabase.from("settings").select("grade_floor").eq("id", 1).single(),
    canManage ? loadPaceContext() : Promise.resolve(null),
  ]);

  const today = easternDateKey(new Date());
  const students = metrics.map((student) => {
    if (!paceContext) {
      return { ...student, paceBehind: 0, paceMissing: 0, paceTone: "neutral" as const, health: null };
    }
    // Pace from the latest snapshot fields already in the metrics query.
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
      health: studentGradeHealth({
        courses: student.courseSnapshots,
        groupId: student.groupId,
        context: paceContext,
        today,
      }),
    };
  });

  // "Dropping fastest": most negative worst-course change first.
  const droppers = students
    .filter((student) => student.health?.trend.worst)
    .sort(
      (a, b) =>
        (a.health?.trend.worst?.trend.change ?? 0) -
          (b.health?.trend.worst?.trend.change ?? 0) ||
        a.name.localeCompare(b.name),
    );

  const gradeFloor =
    settingsData?.grade_floor == null ? null : Number(settingsData.grade_floor);

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Grades"
          description={
            showDrops
              ? `Students ranked by their biggest grade decline in a course over the last ${TREND_WINDOW_DAYS} days.`
              : "Grade averages and performance across all students. Click a student to view full course history."
          }
          action={
            canManage ? (
              <Button asChild className="h-10">
                <Link href="/grades/sweep">
                  <ListChecks className="size-4" aria-hidden="true" />
                  Weekly sweep
                </Link>
              </Button>
            ) : undefined
          }
        />

        {canManage ? (
          <div className="flex gap-2">
            <Button asChild variant={showDrops ? "outline" : "default"} size="sm">
              <Link href="/grades">All students</Link>
            </Button>
            <Button asChild variant={showDrops ? "default" : "outline"} size="sm">
              <Link href="/grades?view=drops">
                <TrendingDown className="size-4" aria-hidden="true" />
                Dropping fastest
              </Link>
            </Button>
          </div>
        ) : null}

        {showDrops ? (
          <DataTable
            data={droppers}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                title="No grade trends yet"
                description={`A trend needs a grade from before the last ${TREND_WINDOW_DAYS} days, or at least two grades inside it.`}
                icon={TrendingDown}
              />
            }
            columns={[
              {
                key: "student",
                header: "Student",
                cell: (row) => (
                  <Link
                    href={`/students/${row.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.name}
                  </Link>
                ),
              },
              {
                key: "course",
                header: "Course",
                cell: (row) => row.health?.trend.worst?.courseName ?? "—",
              },
              {
                key: "move",
                header: "Before → after",
                cell: (row) => {
                  const trend = row.health?.trend.worst?.trend;
                  return trend ? (
                    <span className="tabular-nums">
                      {formatGrade(trend.baseline)} → {formatGrade(trend.latest)}
                    </span>
                  ) : (
                    "—"
                  );
                },
              },
              {
                key: "change",
                header: "Change",
                cell: (row) => {
                  const trend = row.health?.trend.worst?.trend;
                  if (!trend) return "—";
                  return (
                    <StatusBadge
                      status={`${trend.change > 0 ? "+" : ""}${trend.change} pts`}
                      tone={trendTone(trend.change)}
                    />
                  );
                },
              },
              {
                key: "spark",
                header: "Trend",
                cell: (row) => {
                  const trend = row.health?.trend.worst?.trend;
                  return trend ? (
                    <Sparkline points={trend.points} tone={trendTone(trend.change)} />
                  ) : null;
                },
              },
              {
                key: "average",
                header: "Avg change",
                cell: (row) => {
                  const average = row.health?.trend.averageChange;
                  return (
                    <span className="tabular-nums text-muted-foreground">
                      {average == null ? "—" : `${average > 0 ? "+" : ""}${average}`}
                    </span>
                  );
                },
              },
            ]}
          />
        ) : (
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
                    {row.health && row.health.staleCourses.length > 0 ? (
                      <span title={row.health.staleTitle} className="mt-1 inline-block">
                        <StatusBadge status="Stale" tone="neutral" />
                      </span>
                    ) : null}
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
                  <span className="tabular-nums text-sm">{row.courseCount}</span>
                ),
                className: "text-muted-foreground",
              },
              ...(canManage
                ? [
                    {
                      key: "pace",
                      header: "Pace",
                      cell: (row: (typeof students)[number]) => (
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
                  ]
                : []),
              {
                key: "performance",
                header: "Performance",
                cell: (row) =>
                  row.health?.allStale ? (
                    <span title={row.health.staleTitle}>
                      <StatusBadge status="Stale data" tone="neutral" />
                    </span>
                  ) : (
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
        )}
      </div>
    </AppShell>
  );
}
