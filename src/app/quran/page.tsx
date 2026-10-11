import Link from "next/link";
import { BookOpen } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Card } from "@/components/ui/card";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { studentName, type Student } from "@/lib/people/people";
import { isRevision } from "@/lib/quran/lessons";
import { createClient } from "@/lib/supabase/server";
import { QuranBulkForm, QuranBulkFormEmpty } from "./quran-bulk-form";

type LatestEntry = {
  student_id: string;
  date: string;
  surah: string | null;
  lines_memorized: number;
};

type ParentProgressRow = {
  student: Student;
  latest: LatestEntry | null;
  totalLines: number;
  lastRevision: string | null;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(dateStr: string) {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24),
  );
}

function slipTone(days: number | null, quranInactivityDays: number | null) {
  if (days === null) return "neutral";
  if (quranInactivityDays === null) return "neutral";
  if (days >= quranInactivityDays * 2) return "danger";
  if (days >= quranInactivityDays) return "warning";
  return "success";
}

export default async function QuranPage() {
  const profile = await getCurrentProfile();
  const isStaff = profile.role === "admin" || profile.role === "moderator";
  const supabase = await createClient();

  if (isStaff) {
    // Staff: load all active students + their latest quran entry.
    const [{ data: studentData }, { data: settingsData }] = await Promise.all([
      supabase
        .from("students")
        .select(
          "id, first_name, last_name, date_of_birth, grade_level, enrollment_status, gcvs_reference, created_at, updated_at",
        )
        .eq("enrollment_status", "active")
        .order("last_name", { ascending: true }),
      supabase
        .from("settings")
        .select("quran_inactivity_days")
        .eq("id", 1)
        .single(),
    ]);

    const students = (studentData ?? []) as Student[];
    const quranInactivityDays =
      settingsData?.quran_inactivity_days == null
        ? null
        : Number(settingsData.quran_inactivity_days);
    const studentIds = students.map((s) => s.id);

    // Fetch each student's most recent quran_progress date.
    const { data: latestData } = studentIds.length > 0
      ? await supabase
          .from("quran_progress")
          .select("student_id, date, surah, lines_memorized")
          .in("student_id", studentIds)
          // "Last lesson" and the slip highlight track new memorization only.
          .eq("lesson_type", "sabaq")
          .order("date", { ascending: false })
          .order("recorded_at", { ascending: false })
      : { data: [] };

    // Keep only the latest row per student.
    const latestMap = new Map<string, LatestEntry>();
    for (const row of (latestData ?? []) as LatestEntry[]) {
      if (!latestMap.has(row.student_id)) {
        latestMap.set(row.student_id, row);
      }
    }
    const latestEntries = Array.from(latestMap.values());

    return (
      <AppShell fullName={profile.fullName} role={profile.role}>
        <div className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            title="Quran / Hifz"
            description="Log today's sabaq (new lines), sabaq para and dhor for every student in one go. Only sabaq counts toward memorized totals."
          />
          <Card className="overflow-hidden border shadow-sm">
            {students.length === 0 ? (
              <QuranBulkFormEmpty />
            ) : (
              <QuranBulkForm
                students={students}
                latestEntries={latestEntries}
                initialDate={todayIso()}
                quranInactivityDays={quranInactivityDays}
              />
            )}
          </Card>
        </div>
      </AppShell>
    );
  }

  // Parent: read-only view of linked children's progress.
  // RLS ensures the students query returns only their children.
  const [{ data: studentData }, { data: settingsData }] = await Promise.all([
    supabase
      .from("students")
      .select(
        "id, first_name, last_name, date_of_birth, grade_level, enrollment_status, gcvs_reference, created_at, updated_at",
      )
      .eq("enrollment_status", "active")
      .order("last_name", { ascending: true }),
    supabase
      .from("settings")
      .select("quran_inactivity_days")
      .eq("id", 1)
      .single(),
  ]);

  const students = (studentData ?? []) as Student[];
  const studentIds = students.map((s) => s.id);
  const quranInactivityDays =
    settingsData?.quran_inactivity_days == null
      ? null
      : Number(settingsData.quran_inactivity_days);

  const { data: progressData } = studentIds.length > 0
    ? await supabase
        .from("quran_progress")
        .select("student_id, date, surah, lines_memorized, lesson_type")
        .in("student_id", studentIds)
        .order("date", { ascending: false })
    : { data: [] };

  const rows = progressData ?? [];

  // Build per-student summary. Totals and "last lesson" are sabaq only;
  // revision (sabaq para / dhor) only feeds the last revision date.
  const latestMap = new Map<string, LatestEntry>();
  const totalLinesMap = new Map<string, number>();
  const lastRevisionMap = new Map<string, string>();
  for (const row of rows as (LatestEntry & { lesson_type: string | null })[]) {
    if (isRevision(row)) {
      if (!lastRevisionMap.has(row.student_id)) lastRevisionMap.set(row.student_id, row.date);
      continue;
    }
    if (!latestMap.has(row.student_id)) {
      latestMap.set(row.student_id, row);
    }
    totalLinesMap.set(
      row.student_id,
      (totalLinesMap.get(row.student_id) ?? 0) + Number(row.lines_memorized),
    );
  }

  const parentRows: ParentProgressRow[] = students.map((s) => ({
    student: s,
    latest: latestMap.get(s.id) ?? null,
    totalLines: totalLinesMap.get(s.id) ?? 0,
    lastRevision: lastRevisionMap.get(s.id) ?? null,
  }));

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          title="Quran progress"
          description="Your children's memorization progress."
        />
        <DataTable
          data={parentRows}
          getRowKey={(row) => row.student.id}
          empty={
            <EmptyState
              title="No progress recorded yet"
              description="Your children's Quran lessons haven't been logged yet. Check back after the next session."
              icon={BookOpen}
            />
          }
          columns={[
            {
              key: "student",
              header: "Student",
              cell: (row) => (
                <Link
                  href={`/quran/${row.student.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {studentName(row.student)}
                </Link>
              ),
            },
            {
              key: "latest",
              header: "Last lesson",
              cell: (row) =>
                row.latest ? (
                  <div>
                    <p className="text-sm">{row.latest.date}</p>
                    {row.latest.surah ? (
                      <p className="text-xs text-muted-foreground">
                        {row.latest.surah}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            },
            {
              key: "status",
              header: "Status",
              cell: (row) => {
                const days = row.latest ? daysSince(row.latest.date) : null;
                const label =
                  days === null
                    ? "No data"
                    : days === 0
                      ? "Today"
                      : `${days}d ago`;
                return (
                  <StatusBadge
                    status={label}
                    tone={slipTone(days, quranInactivityDays)}
                  />
                );
              },
            },
            {
              key: "revision",
              header: "Last revision",
              cell: (row) =>
                row.lastRevision ? (
                  <span className="text-sm">{row.lastRevision}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            },
            {
              key: "total",
              header: "Memorized lines",
              cell: (row) =>
                row.totalLines > 0 ? (
                  <span className="font-medium">{row.totalLines}</span>
                ) : (
                  "—"
                ),
              className: "text-muted-foreground",
            },
          ]}
        />
      </div>
    </AppShell>
  );
}
