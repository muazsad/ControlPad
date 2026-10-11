import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GraduationCap } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaceBar } from "@/components/controlpad/pace-bar";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import {
  courseWindow,
  expectedDayPredicate,
  expectedPercent,
  paceForCourse,
} from "@/lib/grades/pace";
import { loadPaceContext } from "@/lib/grades/pace-data";
import { easternDateKey } from "@/lib/grades/sweep";
import { studentName } from "@/lib/people/people";
import { createClient } from "@/lib/supabase/server";

import { formatGrade, gradeTone } from "../grade-display";
import { GradeForm } from "../grade-form";
import { CourseDatesForm } from "./course-dates-form";
import { PaceChart, type PacePoint } from "./pace-chart";

type CourseDetail = {
  id: string;
  name: string;
  gcvs_course_code: string | null;
  student_id: string;
  start_date: string | null;
  end_date: string | null;
  students: {
    id: string;
    first_name: string;
    last_name: string;
    grade_level: string | null;
    schedule_group_id: string | null;
  };
};

type GradeRow = {
  id: string;
  grade_value: number;
  percent_complete: number | null;
  missing_assignments: number | null;
  note: string | null;
  recorded_at: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_STEP_DAYS = 7;

function dateMs(date: string) {
  return new Date(`${date}T00:00:00.000Z`).getTime();
}

/** Expected-pace line (weekly points, plus today) merged with actual snapshots. */
function buildPacePoints(input: {
  window: { start: string; end: string } | null;
  today: string;
  isExpectedDay: (date: string) => boolean;
  snapshots: { date: string; percent: number | null }[];
}): PacePoint[] {
  const { window } = input;
  if (!window) return [];
  const byTime = new Map<number, PacePoint>();
  const point = (t: number) => {
    const existing = byTime.get(t) ?? { t };
    byTime.set(t, existing);
    return existing;
  };

  const expectedAt = (date: string) =>
    expectedPercent(window, date, input.isExpectedDay) ?? undefined;
  const end = dateMs(window.end);
  for (let t = dateMs(window.start); t < end; t += CHART_STEP_DAYS * DAY_MS) {
    point(t).expected = expectedAt(new Date(t).toISOString().slice(0, 10));
  }
  point(end).expected = expectedAt(window.end);
  const todayMs = dateMs(input.today);
  if (todayMs >= dateMs(window.start) && todayMs <= end) {
    point(todayMs).expected = expectedAt(input.today);
  }
  for (const snapshot of input.snapshots) {
    if (snapshot.percent === null) continue;
    const t = dateMs(snapshot.date);
    const p = point(t);
    p.expected ??= expectedAt(snapshot.date);
    // Newest snapshot wins when several land on one day (grades are newest-first).
    p.actual ??= snapshot.percent;
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

export default async function CourseGradesPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const profile = await getCurrentProfile();
  const canManage = profile.role === "admin" || profile.role === "moderator";
  const { courseId } = await params;
  const supabase = await createClient();

  const [
    { data: course },
    { data: gradeData, error: gradesError },
    { data: settingsData },
    paceContext,
  ] = await Promise.all([
    supabase
      .from("courses")
      .select(
        "id, name, gcvs_course_code, student_id, start_date, end_date, students(id, first_name, last_name, grade_level, schedule_group_id)",
      )
      .eq("id", courseId)
      .maybeSingle(),
    supabase
      .from("grades")
      .select(
        "id, grade_value, percent_complete, missing_assignments, note, recorded_at",
      )
      .eq("course_id", courseId)
      .order("recorded_at", { ascending: false }),
    supabase.from("settings").select("grade_floor").eq("id", 1).single(),
    // Pace is staff-only: parents can't read settings.
    canManage ? loadPaceContext() : Promise.resolve(null),
  ]);

  if (!course) notFound();

  const c = course as unknown as CourseDetail;
  const grades = (gradeData ?? []) as GradeRow[];
  const latest = grades[0] ?? null;
  const displayStudentName = studentName(c.students);
  const gradeFloor =
    settingsData?.grade_floor == null ? null : Number(settingsData.grade_floor);

  // Pace: latest snapshot vs. where the student should be today.
  const today = easternDateKey(new Date());
  const courseDates = { startDate: c.start_date, endDate: c.end_date };
  const pace =
    paceContext &&
    paceForCourse(
      paceContext,
      today,
      c.students.schedule_group_id,
      courseDates,
      latest
        ? {
            percentComplete:
              latest.percent_complete == null
                ? null
                : Number(latest.percent_complete),
            missingAssignments: latest.missing_assignments,
          }
        : null,
    );
  const chartPoints = paceContext
    ? buildPacePoints({
        window: courseWindow(courseDates, paceContext.term),
        today,
        isExpectedDay: expectedDayPredicate(
          c.students.schedule_group_id
            ? (paceContext.groups.get(c.students.schedule_group_id) ?? null)
            : null,
          paceContext.calendar,
          paceContext.defaults,
        ),
        snapshots: grades.map((grade) => ({
          date: easternDateKey(new Date(grade.recorded_at)),
          percent:
            grade.percent_complete == null
              ? null
              : Number(grade.percent_complete),
        })),
      })
    : [];

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-5xl space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href="/grades">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to grades
          </Link>
        </Button>

        <PageHeader
          title={c.name}
          description={`${displayStudentName}${
            c.students.grade_level ? ` · ${c.students.grade_level}` : ""
          }`}
          action={
            latest ? (
              <StatusBadge
                status={formatGrade(Number(latest.grade_value))}
                tone={gradeTone(Number(latest.grade_value), gradeFloor)}
              />
            ) : (
              <StatusBadge status="No data" tone="neutral" />
            )
          }
        />

        {canManage ? (
          <Card className="border shadow-sm">
            <CardHeader>
              <CardTitle>Record grade</CardTitle>
            </CardHeader>
            <CardContent>
              <GradeForm courseId={c.id} />
            </CardContent>
          </Card>
        ) : null}

        {pace ? (
          <Card className="border shadow-sm">
            <CardHeader>
              <CardTitle>Pace</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <PaceBar
                actual={pace.actual}
                expected={pace.expected}
                paceTone={pace.paceTone}
                missing={pace.missing}
                missingTone={pace.missingTone}
              />
              {pace.window ? (
                chartPoints.some((point) => point.actual !== undefined) ? (
                  <PaceChart points={chartPoints} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Record a % complete to chart it against the expected pace.
                  </p>
                )
              ) : (
                <p className="text-sm text-muted-foreground">
                  No course or term dates are set, so expected pace can&apos;t
                  be worked out.
                  {canManage
                    ? " Set course dates below or the term in Settings."
                    : ""}
                </p>
              )}
              {canManage ? (
                <div className="rounded-lg border bg-muted/25 p-4">
                  <p className="mb-3 text-sm font-medium">Course dates</p>
                  <CourseDatesForm
                    courseId={c.id}
                    startDate={c.start_date}
                    endDate={c.end_date}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Grade history</CardTitle>
          </CardHeader>
          <CardContent>
            {gradesError ? (
              <EmptyState
                title="Could not load grade history"
                description={gradesError.message}
                icon={GraduationCap}
              />
            ) : (
              <DataTable
                data={grades}
                getRowKey={(row) => row.id}
                empty={
                  <EmptyState
                    title="No grade snapshots yet"
                    description={
                      canManage
                        ? "Record the first grade from GCVS to start history."
                        : "No grade history has been recorded for this course."
                    }
                    icon={GraduationCap}
                  />
                }
                columns={[
                  {
                    key: "grade",
                    header: "Grade",
                    cell: (row) => (
                      <StatusBadge
                        status={formatGrade(Number(row.grade_value))}
                        tone={gradeTone(Number(row.grade_value), gradeFloor)}
                      />
                    ),
                  },
                  {
                    key: "percent",
                    header: "% complete",
                    cell: (row) =>
                      row.percent_complete == null
                        ? "—"
                        : `${Number(row.percent_complete)}%`,
                  },
                  {
                    key: "missing",
                    header: "Missing",
                    cell: (row) => row.missing_assignments ?? "—",
                  },
                  {
                    key: "recorded",
                    header: "Recorded",
                    cell: (row) =>
                      new Date(row.recorded_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                  },
                  {
                    key: "note",
                    header: "Note",
                    cell: (row) => row.note ?? "—",
                    className: "text-muted-foreground",
                  },
                ]}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
