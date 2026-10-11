import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { studentName, type Student } from "@/lib/people/people";
import {
  summarizeQuranProgress,
  type QuranPattern,
} from "@/lib/people/quran-progress";
import { createClient } from "@/lib/supabase/server";
import { isRevision, isSabaq, QURAN_LESSON_LABELS, lessonTypeOf } from "@/lib/quran/lessons";
import {
  DEFAULT_REVISION_OVERDUE_SCHOOL_DAYS,
  juzRevisionStatuses,
  lastRevisionDate,
} from "@/lib/quran/revision";
import { getSchoolCalendar } from "@/lib/schedule/calendar-data";
import { todayInSchoolTimeZone } from "@/lib/alerts/admin-digest";
import { JuzGrid, type JuzCell } from "./juz-grid";
import { QuranProgressChart, type QuranChartPoint } from "./quran-progress-chart";

type ProgressRow = {
  id: string;
  date: string;
  surah: string | null;
  from_ayah: number | null;
  to_ayah: number | null;
  lines_memorized: number;
  note: string | null;
  recorded_at: string;
  lesson_type: string | null;
  juz: number | null;
};

const PATTERN_LABEL: Record<QuranPattern, string> = {
  consistent: "Consistent",
  accelerating: "Accelerating",
  irregular: "Irregular",
  stagnant: "Stagnant",
};

const PATTERN_TONE: Record<
  QuranPattern,
  "success" | "warning" | "danger" | "neutral"
> = {
  consistent: "success",
  accelerating: "success",
  irregular: "warning",
  stagnant: "danger",
};

export default async function QuranStudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const profile = await getCurrentProfile();
  const { studentId } = await params;
  const supabase = await createClient();

  // RLS handles access: staff see all, parents see only their linked children.
  const { data: studentData } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, date_of_birth, grade_level, enrollment_status, gcvs_reference, created_at, updated_at",
    )
    .eq("id", studentId)
    .maybeSingle();

  if (!studentData) notFound();
  const student = studentData as Student;

  const isStaff = profile.role === "admin" || profile.role === "moderator";

  const [{ data: progressData }, { data: memorizedData }, { data: settingsData }, calendar] =
    await Promise.all([
      supabase
        .from("quran_progress")
        .select(
          "id, date, surah, from_ayah, to_ayah, lines_memorized, note, recorded_at, lesson_type, juz",
        )
        .eq("student_id", studentId)
        .order("date", { ascending: false })
        .order("recorded_at", { ascending: false }),
      supabase
        .from("student_memorized_juz")
        .select("juz, marked_at")
        .eq("student_id", studentId),
      // Parents can't read settings; revision tones are staff-only.
      isStaff
        ? supabase.from("settings").select("revision_overdue_school_days").eq("id", 1).single()
        : Promise.resolve({ data: null }),
      getSchoolCalendar(),
    ]);

  const entries = (progressData ?? []) as ProgressRow[];
  // Only sabaq is memorization: totals, pattern and the chart line.
  const sabaqEntries = entries.filter(isSabaq);
  const progressSummary = summarizeQuranProgress(
    sabaqEntries.map(({ date, lines_memorized }) => ({ date, lines_memorized })),
  );

  // Running memorized totals chronologically (oldest first), sabaq rows only.
  let running = 0;
  const runningTotals = new Map<string, number>();
  for (const row of [...sabaqEntries].reverse()) {
    running += Number(row.lines_memorized);
    runningTotals.set(row.id, running);
  }
  const totalLines = running;

  // Chart: memorization line + revision entries per day.
  const revisionsByDate = new Map<string, number>();
  for (const row of entries.filter(isRevision)) {
    revisionsByDate.set(row.date, (revisionsByDate.get(row.date) ?? 0) + 1);
  }
  const cumulativeByDate = new Map(progressSummary.series.map((p) => [p.date, p.cumulativeLines]));
  const chartSeries: QuranChartPoint[] = [];
  let carried = 0; // revision-only days keep the previous memorized total
  for (const date of [...new Set([...cumulativeByDate.keys(), ...revisionsByDate.keys()])].sort()) {
    carried = cumulativeByDate.get(date) ?? carried;
    chartSeries.push({ date, cumulativeLines: carried, revisions: revisionsByDate.get(date) ?? 0 });
  }

  // Memorized juz grid.
  const today = todayInSchoolTimeZone();
  const threshold = Number(
    settingsData?.revision_overdue_school_days ?? DEFAULT_REVISION_OVERDUE_SCHOOL_DAYS,
  );
  const memorized = ((memorizedData ?? []) as { juz: number; marked_at: string }[]).map(
    (row) => ({ juz: row.juz, markedAt: row.marked_at }),
  );
  const statuses = new Map(
    juzRevisionStatuses({
      memorized,
      entries,
      asOfDate: today,
      thresholdSchoolDays: threshold,
      calendar,
    }).map((status) => [status.juz, status]),
  );
  const juzCells: JuzCell[] = Array.from({ length: 30 }, (_, i) => {
    const juz = i + 1;
    const status = statuses.get(juz);
    if (!status) return { juz, memorized: false, tone: "neutral", title: "Not memorized" };
    const revised = status.lastRevisionDate
      ? `Last revised ${status.lastRevisionDate}`
      : `Not revised since marked (${status.since})`;
    return {
      juz,
      memorized: true,
      tone: isStaff ? status.tone : "neutral",
      title: isStaff
        ? `${revised} · ${status.schoolDaysSince} school day${status.schoolDaysSince === 1 ? "" : "s"} ago`
        : revised,
    };
  });
  const latestRevision = lastRevisionDate(entries);
  const backHref = "/quran";

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-5xl space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href={backHref}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to Quran
          </Link>
        </Button>

        <PageHeader
          title={studentName(student)}
          description={student.grade_level ? `Grade: ${student.grade_level}` : undefined}
        />

        {/* Summary strip */}
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sabaq lessons
            </p>
            <p className="mt-1 text-2xl font-semibold">{sabaqEntries.length}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Memorized lines
            </p>
            <p className="mt-1 text-2xl font-semibold">{totalLines}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Last sabaq
            </p>
            {sabaqEntries[0] ? (
              <p className="mt-1 text-2xl font-semibold">{sabaqEntries[0].date}</p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">None yet</p>
            )}
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Last revision
            </p>
            {latestRevision ? (
              <p className="mt-1 text-2xl font-semibold">{latestRevision}</p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">None yet</p>
            )}
          </div>
        </div>

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Memorized juz</CardTitle>
            <CardDescription>
              {isStaff
                ? `Green: revised recently. Amber: getting close. Red: not revised in over ${threshold} school days. Click a juz to mark or unmark it. Logging sabaq para or dhor marks it automatically.`
                : "Juz your child has memorized. Hover a juz for its last revision."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JuzGrid studentId={student.id} cells={juzCells} canEdit={isStaff} />
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Memorization pattern</CardTitle>
                <CardDescription>
                  Memorized lines over time (sabaq only, summed from raw entries). Bars show revision entries.
                </CardDescription>
              </div>
              {progressSummary.pattern.status === "classified" ? (
                <StatusBadge
                  status={PATTERN_LABEL[progressSummary.pattern.pattern]}
                  tone={PATTERN_TONE[progressSummary.pattern.pattern]}
                />
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {progressSummary.pattern.description}
            </p>
          </CardHeader>
          <CardContent>
            {progressSummary.pattern.status === "classified" ? (
              <QuranProgressChart series={chartSeries} />
            ) : (
              <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 text-center text-sm text-muted-foreground">
                Not enough data to chart a trend yet.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Lesson history</CardTitle>
              <CardDescription>
                Most recent entries shown first.
              </CardDescription>
            </div>
            {isStaff ? (
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link href="/quran">Log new lesson</Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            <DataTable
              data={entries}
              getRowKey={(row) => row.id}
              empty={
                <EmptyState
                  title="No lessons yet"
                  description={
                    isStaff
                      ? "Use the Quran page to log this student's first lesson."
                      : "No Quran lessons have been recorded for this student yet."
                  }
                  icon={BookOpen}
                />
              }
              columns={[
                {
                  key: "date",
                  header: "Date",
                  cell: (row) => <span className="font-medium">{row.date}</span>,
                },
                {
                  key: "type",
                  header: "Type",
                  cell: (row) => (
                    <span className="text-sm">
                      {QURAN_LESSON_LABELS[lessonTypeOf(row)]}
                      {row.juz ? ` · Juz ${row.juz}` : ""}
                    </span>
                  ),
                },
                {
                  key: "surah",
                  header: "Surah",
                  cell: (row) => row.surah ?? "—",
                },
                {
                  key: "ayahs",
                  header: "Ayahs",
                  cell: (row) =>
                    row.from_ayah && row.to_ayah
                      ? `${row.from_ayah}–${row.to_ayah}`
                      : "—",
                  className: "text-muted-foreground",
                },
                {
                  key: "lines",
                  header: "Lines",
                  cell: (row) =>
                    isSabaq(row) ? (
                      <StatusBadge
                        status={`${row.lines_memorized}`}
                        tone={row.lines_memorized > 0 ? "success" : "neutral"}
                      />
                    ) : (
                      <span className="text-muted-foreground">revision</span>
                    ),
                },
                {
                  key: "cumulative",
                  header: "Running total",
                  cell: (row) => (
                    <span className="text-sm font-medium">
                      {runningTotals.get(row.id) ?? "—"}
                    </span>
                  ),
                },
                {
                  key: "note",
                  header: "Note",
                  cell: (row) => row.note ?? "—",
                  className: "text-muted-foreground",
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
