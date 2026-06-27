import Link from "next/link";
import { Plus, Users } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import {
  enrollmentBadgeTone,
  studentName,
  type Student,
} from "@/lib/people/people";
import { createClient } from "@/lib/supabase/server";

export default async function StudentsPage() {
  const profile = await getCurrentProfile();
  const canManage = profile.role === "admin" || profile.role === "moderator";

  const supabase = await createClient();
  // RLS scopes this automatically: staff see all students, a parent sees only
  // students linked to their guardian record.
  const { data, error } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, date_of_birth, grade_level, enrollment_status, gcvs_reference, created_at, updated_at",
    )
    .order("last_name", { ascending: true });

  const students = (data ?? []) as Student[];

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Students"
          description={
            canManage
              ? "Manage student profiles, enrollment details, and guardian links."
              : "Your children's records at Salaam Institute."
          }
          action={
            canManage ? (
              <Button asChild className="h-10">
                <Link href="/students/new">
                  <Plus className="size-4" aria-hidden="true" />
                  New student
                </Link>
              </Button>
            ) : undefined
          }
        />

        {error ? (
          <EmptyState
            title="Could not load students"
            description={error.message}
            icon={Users}
          />
        ) : (
          <DataTable
            data={students}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                title={canManage ? "No students yet" : "No linked children"}
                description={
                  canManage
                    ? "Add your first student to start tracking grades, attendance, and Quran progress."
                    : "An administrator has not linked any students to your account yet."
                }
                icon={Users}
              />
            }
            columns={[
              {
                key: "name",
                header: "Name",
                cell: (row) =>
                  canManage ? (
                    <Link
                      href={`/students/${row.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {studentName(row)}
                    </Link>
                  ) : (
                    <span className="font-medium">{studentName(row)}</span>
                  ),
              },
              {
                key: "grade",
                header: "Grade",
                cell: (row) => row.grade_level ?? "—",
              },
              {
                key: "status",
                header: "Enrollment",
                cell: (row) => (
                  <StatusBadge
                    status={row.enrollment_status}
                    tone={enrollmentBadgeTone(row.enrollment_status)}
                    className="capitalize"
                  />
                ),
              },
              {
                key: "dob",
                header: "Date of birth",
                cell: (row) => row.date_of_birth ?? "—",
                className: "text-muted-foreground",
              },
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
