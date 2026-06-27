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
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { studentName } from "@/lib/people/people";
import { createClient } from "@/lib/supabase/server";

import { formatGrade, gradeTone } from "../grade-display";
import { GradeForm } from "../grade-form";

type CourseDetail = {
  id: string;
  name: string;
  gcvs_course_code: string | null;
  student_id: string;
  students: {
    id: string;
    first_name: string;
    last_name: string;
    grade_level: string | null;
  };
};

type GradeRow = {
  id: string;
  grade_value: number;
  note: string | null;
  recorded_at: string;
};

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
  ] =
    await Promise.all([
      supabase
        .from("courses")
        .select(
          "id, name, gcvs_course_code, student_id, students(id, first_name, last_name, grade_level)",
        )
        .eq("id", courseId)
        .maybeSingle(),
      supabase
        .from("grades")
        .select("id, grade_value, note, recorded_at")
        .eq("course_id", courseId)
        .order("recorded_at", { ascending: false }),
      supabase.from("settings").select("grade_floor").eq("id", 1).single(),
    ]);

  if (!course) notFound();

  const c = course as unknown as CourseDetail;
  const grades = (gradeData ?? []) as GradeRow[];
  const latest = grades[0] ?? null;
  const displayStudentName = studentName(c.students);
  const gradeFloor =
    settingsData?.grade_floor == null ? null : Number(settingsData.grade_floor);

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
              <GradeForm
                courseId={c.id}
                studentId={c.student_id}
                studentName={displayStudentName}
                courseName={c.name}
              />
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
