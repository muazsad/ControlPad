import { CalendarDays, Search } from "lucide-react";

import { AttendanceRowForm } from "@/app/attendance/attendance-row-form";
import type { AttendanceStatus } from "@/app/attendance/actions";
import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { studentName, type Student } from "@/lib/people/people";
import { createClient } from "@/lib/supabase/server";

type AttendancePageProps = {
  searchParams?: Promise<{ date?: string }>;
};

type AttendanceRecord = {
  id: string;
  student_id: string;
  date: string;
  status: AttendanceStatus;
  note: string | null;
  recorded_at: string;
};

type AttendanceRow = {
  student: Student;
  record: AttendanceRecord | null;
};

function isIsoDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function attendanceTone(status: AttendanceStatus | null) {
  if (status === "present") return "success";
  if (status === "tardy") return "warning";
  if (status === "absent") return "danger";
  return "neutral";
}

export default async function AttendancePage({
  searchParams,
}: AttendancePageProps) {
  const profile = await getCurrentProfile();
  const canManage = profile.role === "admin" || profile.role === "moderator";
  const params = await searchParams;
  const selectedDate = isIsoDate(params?.date) ? params.date : todayIso();
  const supabase = await createClient();

  const { data: studentData, error: studentError } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, date_of_birth, grade_level, enrollment_status, gcvs_reference, created_at, updated_at",
    )
    .eq("enrollment_status", "active")
    .order("last_name", { ascending: true });

  const students = (studentData ?? []) as Student[];
  const studentIds = students.map((student) => student.id);
  const { data: attendanceData, error: attendanceError } =
    studentIds.length > 0
      ? await supabase
          .from("attendance")
          .select("id, student_id, date, status, note, recorded_at")
          .eq("date", selectedDate)
          .in("student_id", studentIds)
      : { data: [], error: null };

  const records = new Map(
    ((attendanceData ?? []) as AttendanceRecord[]).map((record) => [
      record.student_id,
      record,
    ]),
  );
  const rows: AttendanceRow[] = students.map((student) => ({
    student,
    record: records.get(student.id) ?? null,
  }));
  const loadError = studentError ?? attendanceError;

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Attendance"
          description={
            canManage
              ? "Mark each active student once per school day. Saving again updates the same daily row."
              : "Daily attendance records for your linked children."
          }
        />

        <Card className="border shadow-sm">
          <CardContent className="pt-6">
            <form className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  name="date"
                  type="date"
                  defaultValue={selectedDate}
                  className="h-10 w-full sm:w-48"
                />
              </div>
              <Button type="submit" className="h-10 sm:mb-0">
                <Search className="size-4" aria-hidden="true" />
                View date
              </Button>
            </form>
          </CardContent>
        </Card>

        {loadError ? (
          <EmptyState
            title="Could not load attendance"
            description={loadError.message}
            icon={CalendarDays}
          />
        ) : (
          <DataTable
            data={rows}
            getRowKey={(row) => row.student.id}
            empty={
              <EmptyState
                title={canManage ? "No active students" : "No attendance yet"}
                description={
                  canManage
                    ? "Add active students before marking attendance."
                    : "No linked active students have attendance records yet."
                }
                icon={CalendarDays}
              />
            }
            columns={[
              {
                key: "student",
                header: "Student",
                cell: (row) => (
                  <div>
                    <p className="font-medium">{studentName(row.student)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.student.grade_level ?? "Grade not set"}
                    </p>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (row) => (
                  <StatusBadge
                    status={row.record?.status ?? "No data"}
                    tone={attendanceTone(row.record?.status ?? null)}
                    className="capitalize"
                  />
                ),
              },
              {
                key: "note",
                header: "Note",
                cell: (row) => row.record?.note ?? "—",
                className: "text-muted-foreground",
              },
              {
                key: "recorded",
                header: "Recorded",
                cell: (row) =>
                  row.record
                    ? new Date(row.record.recorded_at).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "—",
                className: "text-muted-foreground",
              },
              ...(canManage
                ? [
                    {
                      key: "mark",
                      header: "Mark attendance",
                      cell: (row: AttendanceRow) => (
                        <AttendanceRowForm
                          studentId={row.student.id}
                          date={selectedDate}
                          status={row.record?.status ?? null}
                          note={row.record?.note ?? null}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
