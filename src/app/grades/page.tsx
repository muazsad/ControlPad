import Link from "next/link";
import { BookOpen, GraduationCap, Plus } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { studentName, type Student } from "@/lib/people/people";
import { createClient } from "@/lib/supabase/server";

import { CourseForm } from "./course-form";

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
  created_at: string;
  students: Pick<Student, "id" | "first_name" | "last_name" | "grade_level">;
  grades: GradeSnapshot[];
};

function latestGrade(course: CourseRow) {
  return course.grades[0] ?? null;
}

function gradeTone(value: number | null, gradeFloor: number | null) {
  if (value === null) return "neutral";
  if (gradeFloor === null) return "neutral";
  if (value < gradeFloor) return "danger";
  if (value < gradeFloor + 5) return "warning";
  return "success";
}

function formatGrade(value: number | null) {
  if (value === null) return "No data";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export default async function GradesPage() {
  const profile = await getCurrentProfile();
  const canManage = profile.role === "admin" || profile.role === "moderator";
  const supabase = await createClient();

  const [
    { data: courseData, error },
    { data: studentData },
    { data: settingsData },
  ] = await Promise.all([
    supabase
      .from("courses")
      .select(
        "id, name, gcvs_course_code, created_at, students(id, first_name, last_name, grade_level), grades(id, grade_value, recorded_at, note)",
      )
      .order("name", { ascending: true })
      .order("recorded_at", {
        referencedTable: "grades",
        ascending: false,
      }),
    canManage
      ? supabase
          .from("students")
          .select(
            "id, first_name, last_name, date_of_birth, grade_level, enrollment_status, gcvs_reference, created_at, updated_at",
          )
          .eq("enrollment_status", "active")
          .order("last_name", { ascending: true })
      : Promise.resolve({ data: null }),
    supabase.from("settings").select("grade_floor").eq("id", 1).single(),
  ]);

  const courses = (courseData ?? []) as unknown as CourseRow[];
  const students = (studentData ?? []) as Student[];
  const gradeFloor =
    settingsData?.grade_floor == null ? null : Number(settingsData.grade_floor);

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Grades"
          description={
            canManage
              ? "Add GCVS courses and record grade snapshots. Each saved grade keeps history."
              : "Current grades and grade history for your linked children."
          }
        />

        {canManage ? (
          <Card className="border shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="size-5" aria-hidden="true" />
                Add course
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CourseForm students={students} />
            </CardContent>
          </Card>
        ) : null}

        {error ? (
          <EmptyState
            title="Could not load grades"
            description={error.message}
            icon={GraduationCap}
          />
        ) : (
          <DataTable
            data={courses}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                title={canManage ? "No courses yet" : "No grades available"}
                description={
                  canManage
                    ? "Add a student's first GCVS course to start recording grades."
                    : "No course grades are linked to your account yet."
                }
                icon={BookOpen}
              />
            }
            columns={[
              {
                key: "course",
                header: "Course",
                cell: (row) => (
                  <div>
                    <Link
                      href={`/grades/${row.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {row.name}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.gcvs_course_code ?? "No GCVS code"}
                    </p>
                  </div>
                ),
              },
              {
                key: "student",
                header: "Student",
                cell: (row) => (
                  <div>
                    <p className="font-medium">{studentName(row.students)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.students.grade_level ?? "Grade not set"}
                    </p>
                  </div>
                ),
              },
              {
                key: "latest",
                header: "Latest grade",
                cell: (row) => {
                  const latest = latestGrade(row);
                  const value = latest ? Number(latest.grade_value) : null;
                  return (
                    <StatusBadge
                      status={formatGrade(value)}
                      tone={gradeTone(value, gradeFloor)}
                    />
                  );
                },
              },
              {
                key: "recorded",
                header: "Recorded",
                cell: (row) => {
                  const latest = latestGrade(row);
                  return latest
                    ? new Date(latest.recorded_at).toLocaleDateString()
                    : "—";
                },
                className: "text-muted-foreground",
              },
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
