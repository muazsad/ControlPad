import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, Pencil, Plus, Star } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireRole } from "@/lib/auth/current-profile";
import {
  enrollmentBadgeTone,
  studentName,
  type Guardian,
  type Student,
} from "@/lib/people/people";
import {
  avgGradeScore,
  quranScore,
  attendanceRate,
  globalPerformance,
  performanceTone,
} from "@/lib/people/performance";
import { createClient } from "@/lib/supabase/server";
import { CourseForm } from "@/app/grades/course-form";
import { formatGrade, gradeTone, latestGrade } from "@/app/grades/grade-display";
import { GradeForm } from "@/app/grades/grade-form";
import {
  StudentGuardianLinks,
  type LinkedGuardian,
} from "./student-guardian-links";

type GradeSnapshot = {
  id: string;
  grade_value: number;
  recorded_at: string;
  note: string | null;
};

type CourseRow = {
  id: string;
  name: string;
  gcvs_course_code: string | null;
  student_id: string;
  grades: GradeSnapshot[];
};

type QuranEntry = { date: string; lines_memorized: number };
type AttendanceRecord = { status: "present" | "tardy" | "absent" | "excused" };

const TREND_LABEL: Record<string, string> = {
  improving: "Improving",
  steady: "Steady",
  slowing: "Slowing",
  stalled: "Stalled",
};

const TREND_CLASS: Record<string, string> = {
  improving: "text-[var(--color-success)]",
  steady: "text-muted-foreground",
  slowing: "text-[var(--color-warning)]",
  stalled: "text-[var(--color-danger)]",
};

function StatTile({
  label,
  value,
  sub,
  subClass,
}: {
  label: string;
  value: string;
  sub?: string;
  subClass?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card px-4 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {sub && (
        <span className={`text-xs font-medium ${subClass ?? "text-muted-foreground"}`}>
          {sub}
        </span>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm">{value ?? "—"}</dd>
    </div>
  );
}

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireRole(["admin", "moderator"]);
  const { id } = await params;
  const isAdmin = profile.role === "admin";

  const supabase = await createClient();

  const { data: student } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, date_of_birth, grade_level, enrollment_status, gcvs_reference, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!student) notFound();
  const s = student as Student;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

  const [
    { data: links },
    { data: courseData },
    { data: settingsData },
    { data: quranData },
    { data: attendanceData },
  ] = await Promise.all([
    supabase
      .from("student_guardians")
      .select(
        "relationship, is_primary, guardians(id, full_name, phone, email, user_id, created_at)",
      )
      .eq("student_id", id),
    supabase
      .from("courses")
      .select("id, name, gcvs_course_code, student_id, grades(id, grade_value, recorded_at, note)")
      .eq("student_id", id)
      .order("name", { ascending: true })
      .order("recorded_at", {
        referencedTable: "grades",
        ascending: false,
      }),
    supabase.from("settings").select("grade_floor").eq("id", 1).single(),
    supabase
      .from("quran_progress")
      .select("date, lines_memorized")
      .eq("student_id", id)
      .gte("date", cutoff)
      .order("date", { ascending: false }),
    supabase
      .from("attendance")
      .select("status")
      .eq("student_id", id)
      .gte("date", cutoff),
  ]);

  const linked: LinkedGuardian[] = (links ?? []).map((row) => {
    const g = row.guardians as unknown as Guardian;
    return { ...g, relationship: row.relationship, is_primary: row.is_primary };
  });
  const courses = (courseData ?? []) as unknown as CourseRow[];
  const gradeFloor =
    settingsData?.grade_floor == null ? null : Number(settingsData.grade_floor);

  // Compute performance metrics
  const latestGradesPerCourse = courses
    .map((c) => latestGrade(c.grades))
    .filter((g): g is NonNullable<typeof g> => g !== null)
    .map((g) => Number(g.grade_value));
  const gradeAvg = avgGradeScore(latestGradesPerCourse);

  const quranEntries = (quranData ?? []) as QuranEntry[];
  const quranResult = quranScore(quranEntries);
  const totalQuranLines = quranEntries.reduce((s, e) => s + e.lines_memorized, 0);

  const attendanceRecords = (attendanceData ?? []) as AttendanceRecord[];
  const attRate = attendanceRate(attendanceRecords);

  const globalResult = globalPerformance({
    gradeScore: gradeAvg,
    quranScore: quranResult.score,
    gradedCourseCount: latestGradesPerCourse.length,
    quranEntryCount: quranEntries.length,
  });
  const globalScore = globalResult.score;
  const globalTone = performanceTone(globalScore);

  // Only admins can create links, so only they need the candidate list.
  let available: Guardian[] = [];
  if (isAdmin) {
    const { data: allGuardians } = await supabase
      .from("guardians")
      .select("id, full_name, phone, email, user_id, created_at")
      .order("full_name", { ascending: true });
    const linkedIds = new Set(linked.map((g) => g.id));
    available = ((allGuardians ?? []) as Guardian[]).filter(
      (g) => !linkedIds.has(g.id),
    );
  }

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-4xl space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href="/students">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to students
          </Link>
        </Button>

        <PageHeader
          title={studentName(s)}
          description={s.grade_level ? `Grade: ${s.grade_level}` : undefined}
          action={
            <Button asChild variant="outline" className="h-10">
              <Link href={`/students/${s.id}/edit`}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Link>
            </Button>
          }
        />

        {/* Performance snapshot */}
        <Card className="border shadow-sm">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2">
              <Star className="size-5" aria-hidden="true" />
              Performance (last 30 days)
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Global</span>
              <StatusBadge
                status={
                  globalResult.status === "scored" && globalScore !== null
                    ? `${Math.round(globalScore)}%`
                    : "Not enough data yet"
                }
                tone={globalTone}
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Grade avg"
                value={gradeAvg !== null ? `${Math.round(gradeAvg)}%` : "—"}
                sub={gradeAvg !== null ? `${latestGradesPerCourse.length} course${latestGradesPerCourse.length !== 1 ? "s" : ""}` : "No grades yet"}
              />
              <StatTile
                label="Quran lines"
                value={totalQuranLines > 0 ? String(totalQuranLines) : "—"}
                sub={TREND_LABEL[quranResult.trend]}
                subClass={TREND_CLASS[quranResult.trend]}
              />
              <StatTile
                label="Attendance rate"
                value={attendanceRecords.length > 0 ? `${Math.round(attRate)}%` : "—"}
                sub={attendanceRecords.length > 0 ? `${attendanceRecords.length} session${attendanceRecords.length !== 1 ? "s" : ""}` : "No records"}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Global score = grades + Quran only (equal weight). Attendance shown for reference.
            </p>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle>Profile</CardTitle>
            <StatusBadge
              status={s.enrollment_status}
              tone={enrollmentBadgeTone(s.enrollment_status)}
              className="capitalize"
            />
          </CardHeader>
          <CardContent>
            <dl className="grid gap-5 sm:grid-cols-2">
              <Detail label="First name" value={s.first_name} />
              <Detail label="Last name" value={s.last_name} />
              <Detail label="Date of birth" value={s.date_of_birth} />
              <Detail label="Grade level" value={s.grade_level} />
              <Detail label="GCVS reference" value={s.gcvs_reference} />
              <Detail
                label="Enrollment"
                value={s.enrollment_status}
              />
            </dl>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="space-y-3">
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-5" aria-hidden="true" />
              Classes / Grades
            </CardTitle>
            <div className="rounded-lg border bg-muted/25 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Plus className="size-4" aria-hidden="true" />
                Add class
              </div>
              <CourseForm
                students={[]}
                fixedStudentId={s.id}
                redirectTo={`/students/${s.id}`}
                compact
              />
            </div>
          </CardHeader>
          <CardContent>
            {courses.length === 0 ? (
              <EmptyState
                title="No classes yet"
                description="Add this student's first GCVS class to start tracking grades."
                icon={BookOpen}
              />
            ) : (
              <div className="divide-y rounded-lg border">
                {courses.map((course) => {
                  const latest = latestGrade(course.grades);
                  const latestValue = latest
                    ? Number(latest.grade_value)
                    : null;
                  const recordedLabel = latest
                    ? new Date(latest.recorded_at).toLocaleDateString()
                    : "No grade recorded";

                  return (
                    <div
                      key={course.id}
                      className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_160px_minmax(320px,1.4fr)] lg:items-start"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/grades/${course.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {course.name}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {course.gcvs_course_code ?? "No GCVS code"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <StatusBadge
                          status={formatGrade(latestValue)}
                          tone={gradeTone(latestValue, gradeFloor)}
                        />
                        <p className="text-xs text-muted-foreground">
                          {recordedLabel}
                        </p>
                      </div>
                      <GradeForm
                        courseId={course.id}
                        studentId={s.id}
                        studentName={studentName(s)}
                        courseName={course.name}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Guardians</CardTitle>
          </CardHeader>
          <CardContent>
            <StudentGuardianLinks
              studentId={s.id}
              linked={linked}
              available={available}
              canManage={isAdmin}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
