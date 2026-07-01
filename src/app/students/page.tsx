import Link from "next/link";
import { Plus, Users } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { enrollmentBadgeTone } from "@/lib/people/people";
import { getAllStudentMetrics } from "@/lib/people/student-metrics";

export default async function StudentsPage() {
  const profile = await getCurrentProfile();
  const canManage = profile.role === "admin" || profile.role === "moderator";

  // RLS scopes this automatically: staff see all students, a parent sees only
  // students linked to their guardian record.
  const students = await getAllStudentMetrics();

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
                    {row.name}
                  </Link>
                ) : (
                  <span className="font-medium">{row.name}</span>
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
