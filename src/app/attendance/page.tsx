import Link from "next/link";
import { CalendarDays, Search } from "lucide-react";

import { AbsenceReportReview } from "@/app/attendance/absence-report-review";
import { AttendanceRowForm } from "@/app/attendance/attendance-row-form";
import type { AttendanceStatus } from "@/app/attendance/actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyDate } from "@/lib/absence-reports/parse";
import {
  getAbsenceReportsForDate,
  getPendingAbsenceReports,
  type AbsenceReport,
} from "@/lib/absence-reports/reports-data";
import { schoolClock } from "@/lib/alerts/attendance-escalation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { studentName, type Student } from "@/lib/people/people";
import { getSchoolCalendar } from "@/lib/schedule/calendar-data";
import { getScheduleGroups } from "@/lib/schedule/schedule-groups-data";
import {
  formatTime12h,
  scheduleForDate,
  type DaySchedule,
} from "@/lib/schedule/student-schedule";
import { createClient } from "@/lib/supabase/server";

type AttendancePageProps = {
  searchParams?: Promise<{ date?: string; view?: string }>;
};

type AttendanceRecord = {
  id: string;
  student_id: string;
  date: string;
  status: AttendanceStatus;
  arrived_at: string | null;
  note: string | null;
  recorded_at: string;
};

type AttendanceRow = {
  student: Student;
  record: AttendanceRecord | null;
  schedule: DaySchedule | null;
};

function isIsoDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function todayIso() {
  return schoolClock(new Date()).date;
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
  const today = todayIso();
  const selectedDate = isIsoDate(params?.date) ? params.date : today;
  const showAll = params?.view === "all";
  const supabase = await createClient();

  const [groups, calendar, { data: settingsData }] = await Promise.all([
    getScheduleGroups(),
    getSchoolCalendar(),
    canManage
      ? supabase
          .from("settings")
          .select("school_start, tardy_window_hours")
          .eq("id", 1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const defaults = {
    schoolStart: String(settingsData?.school_start ?? "08:00").slice(0, 5),
    tardyWindowHours: Number(settingsData?.tardy_window_hours ?? 2),
  };
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const [pendingReports, reportsForDate] = canManage
    ? await Promise.all([
        getPendingAbsenceReports(),
        getAbsenceReportsForDate(selectedDate),
      ])
    : [[] as AbsenceReport[], new Map<string, AbsenceReport>()];

  const { data: studentData, error: studentError } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, date_of_birth, grade_level, enrollment_status, gcvs_reference, schedule_group_id, created_at, updated_at",
    )
    .eq("enrollment_status", "active")
    .order("last_name", { ascending: true });

  const students = (studentData ?? []) as Student[];
  const studentIds = students.map((student) => student.id);
  const { data: attendanceData, error: attendanceError } =
    studentIds.length > 0
      ? await supabase
          .from("attendance")
          .select("id, student_id, date, status, arrived_at, note, recorded_at")
          .eq("date", selectedDate)
          .in("student_id", studentIds)
      : { data: [], error: null };

  const records = new Map(
    ((attendanceData ?? []) as AttendanceRecord[]).map((record) => [
      record.student_id,
      record,
    ]),
  );
  const allRows: AttendanceRow[] = students.map((student) => ({
    student,
    record: records.get(student.id) ?? null,
    schedule: scheduleForDate(
      selectedDate,
      student.schedule_group_id ? groupsById.get(student.schedule_group_id) ?? null : null,
      calendar,
      defaults,
    ),
  }));
  // Staff see who is expected that day (per schedule group) unless they ask for all.
  // Parents always see all of their children.
  const rows =
    canManage && !showAll
      ? allRows.filter((row) => row.schedule !== null || row.record !== null)
      : allRows;
  const expected = allRows.filter((row) => row.schedule !== null);
  const unmarked = expected.filter((row) => !row.record).length;
  const loadError = studentError ?? attendanceError;
  const viewHref = (view: "all" | "expected") =>
    `/attendance?date=${selectedDate}${view === "all" ? "&view=all" : ""}`;

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Attendance"
          description={
            canManage
              ? "Tap “Arrived now” as students come in — present or tardy is decided from each student’s schedule group. Saving again updates the same daily row."
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
              {showAll ? <input type="hidden" name="view" value="all" /> : null}
              <Button type="submit" className="h-10 sm:mb-0">
                <Search className="size-4" aria-hidden="true" />
                View date
              </Button>
            </form>
            {canManage ? (
              <div className="mt-4 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <p className="text-muted-foreground">
                  {expected.length} expected · {expected.length - unmarked} marked ·{" "}
                  <span className={unmarked > 0 ? "font-medium text-status-warning" : undefined}>
                    {unmarked} unmarked
                  </span>
                </p>
                <Link
                  href={viewHref(showAll ? "expected" : "all")}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {showAll ? "Show only students expected this day" : "Show all active students"}
                </Link>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {canManage && pendingReports.length > 0 ? (
          <Card className="border border-status-warning/30 shadow-sm">
            <CardHeader>
              <CardTitle>Parent-reported absences</CardTitle>
              <CardDescription>
                {profile.role === "admin"
                  ? "Parents texted that these students will be out. Parents won't get the “not checked in” text while a report is pending."
                  : "Parents texted that these students will be out. The admin reviews each report."}
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y">
              {pendingReports.map((report) => (
                <div
                  key={report.id}
                  className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {report.studentName}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {report.date === today ? "Today" : friendlyDate(report.date)}
                      </span>
                    </p>
                    <p className="mt-1 text-sm leading-5">
                      &ldquo;{report.reason ?? "No reason given"}&rdquo;
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {report.guardianName ?? "Parent"} ·{" "}
                      {new Date(report.createdAt).toLocaleString("en-US", {
                        timeZone: "America/New_York",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  {profile.role === "admin" ? <AbsenceReportReview reportId={report.id} /> : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

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
                title={
                  !canManage
                    ? "No attendance yet"
                    : allRows.length > 0
                      ? "Nobody is scheduled this day"
                      : "No active students"
                }
                description={
                  !canManage
                    ? "No linked active students have attendance records yet."
                    : allRows.length > 0
                      ? "No schedule group meets on this date, or it's a break or no-school day. Use “Show all active students” to mark someone anyway."
                      : "Add active students before marking attendance."
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
                      {row.schedule
                        ? `${row.schedule.groupName ?? "School-wide"} · starts ${formatTime12h(row.schedule.startTime)}`
                        : "Not scheduled this day"}
                    </p>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (row) => (
                  <div>
                    <StatusBadge
                      status={row.record?.status ?? (row.schedule ? "Unmarked" : "No data")}
                      tone={attendanceTone(row.record?.status ?? null)}
                      className="capitalize"
                    />
                    {reportsForDate.get(row.student.id) &&
                    reportsForDate.get(row.student.id)?.status !== "dismissed" ? (
                      <p className="mt-1 text-xs font-medium text-status-warning">
                        Parent reported
                        {reportsForDate.get(row.student.id)?.status === "pending"
                          ? " · awaiting review"
                          : ""}
                      </p>
                    ) : null}
                    {row.record?.arrived_at ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Arrived {formatTime12h(row.record.arrived_at)}
                      </p>
                    ) : null}
                  </div>
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
                          key={`${row.student.id}-${row.record?.status ?? "none"}-${row.record?.arrived_at ?? ""}`}
                          studentId={row.student.id}
                          date={selectedDate}
                          isToday={selectedDate === today}
                          status={row.record?.status ?? null}
                          arrivedAt={row.record?.arrived_at ?? null}
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
