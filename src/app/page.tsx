import Link from "next/link";
import {
  AlertTriangle,
  BookOpenCheck,
  CalendarX2,
  CheckCircle2,
  Clock3,
  CreditCard,
  GraduationCap,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

import { AppShell, roleLabels } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { StatusBadge } from "@/components/controlpad/status-badge";
import { SummaryCard } from "@/components/controlpad/summary-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import {
  getAdminDailySummary,
  todayInSchoolTimeZone,
  type AdminDailySummary,
} from "@/lib/alerts/admin-digest";
import {
  enrollmentBadgeTone,
  studentName,
  type Student,
} from "@/lib/people/people";
import { createClient } from "@/lib/supabase/server";

function issueTone(count: number) {
  return count > 0 ? ("danger" as const) : ("success" as const);
}

function totalIssues(summary: AdminDailySummary) {
  return (
    summary.absences.length +
    summary.tardies.length +
    summary.lowGrades.length +
    summary.droppingGrades.length +
    summary.quranSlippage.length +
    summary.overduePayments.length
  );
}

function IssueGroup({
  title,
  href,
  empty,
  hasItems,
  children,
}: {
  title: string;
  href: string;
  empty: string;
  hasItems: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Link
          href={href}
          className="text-sm font-medium text-primary hover:underline"
        >
          Open
        </Link>
      </div>
      <div className="p-4">
        {hasItems ? (
          children
        ) : (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )}
      </div>
    </div>
  );
}

function AdminDashboard({
  fullName,
  summary,
}: {
  fullName: string;
  summary: AdminDailySummary;
}) {
  const gradeIssueCount =
    summary.lowGrades.length + summary.droppingGrades.length;
  const issueTotal = totalIssues(summary);

  const cards = [
    {
      title: "Absences today",
      value: summary.absences.length,
      description:
        summary.absences.length > 0
          ? "Students marked absent today."
          : "No students are marked absent.",
      href: "/attendance",
      icon: CalendarX2,
      tone: issueTone(summary.absences.length),
    },
    {
      title: "Tardies today",
      value: summary.tardies.length,
      description:
        summary.tardies.length > 0
          ? "Students marked tardy today."
          : "No students are marked tardy.",
      href: "/attendance",
      icon: Clock3,
      tone: issueTone(summary.tardies.length),
    },
    {
      title: "Low/dropping grades",
      value: gradeIssueCount,
      description:
        gradeIssueCount > 0
          ? `Floor: ${summary.settings.gradeFloor}%.`
          : "No grade issues are waiting.",
      href: "/grades",
      icon: GraduationCap,
      tone: issueTone(gradeIssueCount),
    },
    {
      title: "Quran slippage",
      value: summary.quranSlippage.length,
      description:
        summary.quranSlippage.length > 0
          ? `Threshold: ${summary.settings.quranInactivityDays} days.`
          : "No Quran slippage is waiting.",
      href: "/quran",
      icon: BookOpenCheck,
      tone: issueTone(summary.quranSlippage.length),
    },
    {
      title: "Overdue payments",
      value: summary.overduePayments.length,
      description:
        summary.overduePayments.length > 0
          ? `Due day: ${summary.settings.paymentDueDay}.`
          : "No overdue tuition items.",
      href: "/tuition",
      icon: CreditCard,
      tone: issueTone(summary.overduePayments.length),
    },
  ];

  return (
    <div className="space-y-7">
      <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge status="Admin" tone="neutral" />
              <StatusBadge
                status={issueTotal > 0 ? "Needs attention" : "All clear"}
                tone={issueTotal > 0 ? "danger" : "success"}
              />
            </div>
            <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
              Good day, {fullName}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Daily summary for {summary.date}. Digest time is{" "}
              {summary.settings.adminDigestTime.slice(0, 5)}.
            </p>
          </div>
          <div className="rounded-lg border border-brand-gold/35 bg-accent px-4 py-3 text-sm text-accent-foreground">
            <p className="font-semibold">Today&apos;s watchlist</p>
            <p className="mt-1 text-muted-foreground">
              {issueTotal > 0
                ? `${issueTotal} item${issueTotal === 1 ? "" : "s"} need review.`
                : "No urgent items are waiting."}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((item) => (
          <SummaryCard key={item.title} {...item} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <IssueGroup
          title="Attendance"
          href="/attendance"
          empty="No absences or tardies today."
          hasItems={summary.absences.length + summary.tardies.length > 0}
        >
          {[...summary.absences, ...summary.tardies].map((issue) => (
            <div
              key={`${issue.studentId}-${issue.status}`}
              className="flex items-center justify-between gap-3 border-b py-2 last:border-0"
            >
              <span className="text-sm font-medium">{issue.studentName}</span>
              <StatusBadge
                status={issue.status}
                tone={issue.status === "absent" ? "danger" : "warning"}
                className="capitalize"
              />
            </div>
          ))}
        </IssueGroup>

        <IssueGroup
          title="Grades"
          href="/grades"
          empty="No grade issues today."
          hasItems={
            summary.lowGrades.length + summary.droppingGrades.length > 0
          }
        >
          {summary.lowGrades.map((issue) => (
            <div
              key={`low-${issue.courseId}`}
              className="flex items-center justify-between gap-3 border-b py-2 last:border-0"
            >
              <div>
                <p className="text-sm font-medium">{issue.studentName}</p>
                <p className="text-xs text-muted-foreground">
                  {issue.courseName} - {issue.gradeValue}%
                </p>
              </div>
              <StatusBadge status="Low" tone="danger" />
            </div>
          ))}
          {summary.droppingGrades.map((issue) => (
            <div
              key={`drop-${issue.courseId}`}
              className="flex items-center justify-between gap-3 border-b py-2 last:border-0"
            >
              <div>
                <p className="text-sm font-medium">{issue.studentName}</p>
                <p className="text-xs text-muted-foreground">
                  {issue.courseName} - {issue.previousGrade}% to{" "}
                  {issue.currentGrade}%
                </p>
              </div>
              <StatusBadge status="Dropping" tone="warning" />
            </div>
          ))}
        </IssueGroup>

        <IssueGroup
          title="Quran progress"
          href="/quran"
          empty="No Quran slippage today."
          hasItems={summary.quranSlippage.length > 0}
        >
          {summary.quranSlippage.map((issue) => (
            <div
              key={issue.studentId}
              className="flex items-center justify-between gap-3 border-b py-2 last:border-0"
            >
              <span className="text-sm font-medium">{issue.studentName}</span>
              <StatusBadge
                status={`${issue.daysSinceLastLesson} days`}
                tone="danger"
              />
            </div>
          ))}
        </IssueGroup>

        <IssueGroup
          title="Tuition"
          href="/tuition"
          empty="No overdue payments today."
          hasItems={summary.overduePayments.length > 0}
        >
          {summary.overduePayments.map((issue) => (
            <div
              key={issue.studentId}
              className="flex items-center justify-between gap-3 border-b py-2 last:border-0"
            >
              <span className="text-sm font-medium">{issue.studentName}</span>
              <StatusBadge status="Overdue" tone="danger" />
            </div>
          ))}
        </IssueGroup>
      </section>
    </div>
  );
}

function StaffDashboard({
  fullName,
  role,
}: {
  fullName: string;
  role: "admin" | "moderator";
}) {
  const moderatorSummary = [
    {
      title: "Attendance",
      value: "Open",
      description: "Mark daily attendance.",
      href: "/attendance",
      icon: CalendarX2,
      tone: "neutral" as const,
    },
    {
      title: "Grades",
      value: "Open",
      description: "Record course grades.",
      href: "/grades",
      icon: GraduationCap,
      tone: "neutral" as const,
    },
    {
      title: "Quran",
      value: "Open",
      description: "Log memorization progress.",
      href: "/quran",
      icon: BookOpenCheck,
      tone: "neutral" as const,
    },
  ];

  return (
    <div className="space-y-7">
      <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge status={roleLabels[role]} tone="neutral" />
              <StatusBadge status="All clear" tone="success" />
            </div>
            <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
              Good day, {fullName}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              The dashboard is ready for the daily problem list: attendance,
              grades, Quran progress, and tuition signals will appear here as
              each module comes online.
            </p>
          </div>
          <div className="rounded-lg border border-brand-gold/35 bg-accent px-4 py-3 text-sm text-accent-foreground">
            <p className="font-semibold">Today&apos;s watchlist</p>
            <p className="mt-1 text-muted-foreground">
              Empty state for Phase 1. Future alerts will use the colors below.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {moderatorSummary.map((item) => (
          <SummaryCard key={item.title} {...item} />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Priority issues</CardTitle>
            <CardDescription>
              Problems will be sorted here by urgency once real records exist.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="No urgent issues today"
              description="When a grade drops, a student is absent, Quran progress stalls, or tuition becomes overdue, it will show up here."
              icon={CheckCircle2}
            />
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Status language</CardTitle>
            <CardDescription>
              The same badge system will carry through every module.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <span className="text-sm text-muted-foreground">Healthy</span>
              <StatusBadge status="Present" />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <span className="text-sm text-muted-foreground">Watch</span>
              <StatusBadge status="Tardy" />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <span className="text-sm text-muted-foreground">Problem</span>
              <StatusBadge status="Absent" />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <span className="text-sm text-muted-foreground">Neutral</span>
              <StatusBadge status="Excused" />
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function ParentDashboard({
  fullName,
  students,
}: {
  fullName: string;
  students: Student[];
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
        <StatusBadge status="Parent view" tone="neutral" />
        <h1 className="mt-4 text-2xl font-semibold tracking-normal sm:text-3xl">
          Welcome, {fullName}
        </h1>
        <p className="mt-2 max-w-2xl text-base leading-7 text-muted-foreground">
          This view stays simple: your children&apos;s school status, important
          alerts, and payment updates without extra admin tools.
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          title="Children"
          value={students.length}
          description="Students linked to your account."
          icon={Users}
          tone="neutral"
        />
        <SummaryCard
          title="Attendance"
          value="Clear"
          description="No alerts are waiting."
          icon={CheckCircle2}
          tone="success"
        />
        <SummaryCard
          title="Needs attention"
          value="0"
          description="Urgent notices will be easy to spot."
          icon={AlertTriangle}
          tone="success"
        />
      </div>

      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">My children</CardTitle>
          <CardDescription>
            You can only see students linked to your guardian record.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            data={students}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                title="No linked children yet"
                description="An administrator hasn't connected any students to your account yet. Please contact the school office."
                icon={Users}
              />
            }
            columns={[
              {
                key: "name",
                header: "Name",
                cell: (row) => (
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
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default async function HomePage() {
  const profile = await getCurrentProfile();

  let children: Student[] = [];
  let adminDailySummary: AdminDailySummary | null = null;
  if (profile.role === "parent") {
    const supabase = await createClient();
    // RLS guarantees this only returns students linked to this parent.
    const { data } = await supabase
      .from("students")
      .select(
        "id, first_name, last_name, date_of_birth, grade_level, enrollment_status, gcvs_reference, created_at, updated_at",
      )
      .order("last_name", { ascending: true });
    children = (data ?? []) as Student[];
  } else if (profile.role === "admin") {
    adminDailySummary = await getAdminDailySummary(todayInSchoolTimeZone());
  }

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      {profile.role === "parent" ? (
        <ParentDashboard fullName={profile.fullName} students={children} />
      ) : profile.role === "admin" && adminDailySummary ? (
        <AdminDashboard fullName={profile.fullName} summary={adminDailySummary} />
      ) : (
        <StaffDashboard fullName={profile.fullName} role={profile.role} />
      )}
    </AppShell>
  );
}
