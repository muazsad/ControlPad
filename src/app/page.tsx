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
  dailySummarySeverity,
  gradeIssueSeverity,
} from "@/lib/alerts/admin-dashboard-severity";
import {
  enrollmentBadgeTone,
  studentName,
  type Student,
} from "@/lib/people/people";
import {
  getEscalationStudents,
} from "@/lib/people/escalation-data";
import type {
  EscalationLevel,
  EscalationStudentResult,
} from "@/lib/people/escalation";
import { createClient } from "@/lib/supabase/server";

function dangerIssueTone(count: number) {
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

function escalationTone(level: EscalationLevel) {
  if (level === "critical") return "danger" as const;
  if (level === "watch") return "warning" as const;
  return "neutral" as const;
}

function signalLabel(signal: string) {
  if (signal === "quran") return "Quran";
  return signal.charAt(0).toUpperCase() + signal.slice(1);
}

function CriticalStudentsSection({
  escalations,
}: {
  escalations: EscalationStudentResult[];
}) {
  const rows = escalations.filter((row) => row.level !== "ok");

  return (
    <Card className="border shadow-sm">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Critical students</CardTitle>
          <CardDescription>
            Repeat patterns across the last 30 days, separate from today&apos;s snapshot.
          </CardDescription>
        </div>
        <StatusBadge
          status={`${rows.length}`}
          tone={rows.some((row) => row.level === "critical") ? "danger" : "neutral"}
        />
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            title="No persistent issues"
            description="Repeat grade, attendance, Quran, or tuition patterns will appear here."
            icon={CheckCircle2}
          />
        ) : (
          <div className="divide-y rounded-lg border">
            {rows.map((row) => (
              <div
                key={row.studentId}
                className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/students/${row.studentId}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      {row.studentName}
                    </Link>
                    <StatusBadge
                      status={row.level}
                      tone={escalationTone(row.level)}
                      className="capitalize"
                    />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {row.reasons.join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  {Object.entries(row.signals)
                    .filter(([, signal]) => signal.tripped)
                    .map(([key, signal]) => (
                      <StatusBadge
                        key={key}
                        status={`${signalLabel(key)} ${signal.occurrences}x / ${signal.durationDays}d`}
                        tone={escalationTone(signal.level)}
                      />
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AdminDashboard({
  fullName,
  summary,
  escalations,
}: {
  fullName: string;
  summary: AdminDailySummary;
  escalations: EscalationStudentResult[];
}) {
  const gradeIssueCount =
    summary.lowGrades.length + summary.droppingGrades.length;
  const gradeIssueDescription =
    gradeIssueCount > 0
      ? `Below ${summary.settings.gradeFloor}%: ${summary.lowGrades.length} · Dropping: ${summary.droppingGrades.length}`
      : "No grade issues are waiting.";
  const issueTotal = totalIssues(summary);
  const summarySeverity = dailySummarySeverity(summary);
  const gradeTone = gradeIssueSeverity({
    belowFloorCount: summary.lowGrades.length,
    droppingCount: summary.droppingGrades.length,
  });

  const cards = [
    {
      title: "Absences today",
      value: summary.absences.length,
      description:
        summary.schoolDayType === "off"
          ? "No school today."
          : summary.absences.length > 0
            ? "Students marked absent today."
            : "No students are marked absent.",
      href: "/attendance",
      icon: CalendarX2,
      tone: dangerIssueTone(summary.absences.length),
    },
    {
      title: "Tardies today",
      value: summary.tardies.length,
      description:
        summary.schoolDayType === "off"
          ? "No school today."
          : summary.schoolDayType === "half"
            ? "Half-day schedule today."
            : summary.tardies.length > 0
              ? "Students marked tardy today."
              : "No students are marked tardy.",
      href: "/attendance",
      icon: Clock3,
      tone: summary.tardies.length > 0 ? ("warning" as const) : ("success" as const),
    },
    {
      title: "Low/dropping grades",
      value: gradeIssueCount,
      description: gradeIssueDescription,
      href: "/grades",
      icon: GraduationCap,
      tone: gradeTone,
    },
    {
      title: "Quran slippage",
      value: summary.quranSlippage.length,
      description:
        summary.schoolDayType === "off"
          ? "No school today."
          : summary.quranSlippage.length > 0
            ? `Threshold: ${summary.settings.quranInactivityDays} school days.`
            : "No Quran slippage is waiting.",
      href: "/quran",
      icon: BookOpenCheck,
      tone: dangerIssueTone(summary.quranSlippage.length),
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
      tone: dangerIssueTone(summary.overduePayments.length),
    },
  ];

  return (
    <div className="space-y-7">
      <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge status="Admin" tone="neutral" />
              {summary.schoolDayType === "off" ? (
                <StatusBadge status="No school today" tone="neutral" />
              ) : summary.schoolDayType === "half" ? (
                <StatusBadge status="Half-day schedule" tone="warning" />
              ) : null}
              <StatusBadge
                status={summarySeverity.label}
                tone={summarySeverity.tone}
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
                ? summarySeverity.dangerCount > 0
                  ? `${summarySeverity.dangerCount} urgent item${summarySeverity.dangerCount === 1 ? "" : "s"} need review.`
                  : `${summarySeverity.warningCount} item${summarySeverity.warningCount === 1 ? "" : "s"} to watch.`
                : "No urgent items are waiting."}
            </p>
          </div>
        </div>
      </section>

      <CriticalStudentsSection escalations={escalations} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((item) => (
          <SummaryCard key={item.title} {...item} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <IssueGroup
          title="Attendance"
          href="/attendance"
          empty={
            summary.schoolDayType === "off"
              ? "No school today."
              : "No absences or tardies today."
          }
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
              <StatusBadge status="Below floor" tone="danger" />
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
          empty={
            summary.schoolDayType === "off"
              ? "No school today."
              : "No Quran slippage today."
          }
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
  let adminEscalations: EscalationStudentResult[] = [];
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
    const today = todayInSchoolTimeZone();
    [adminDailySummary, adminEscalations] = await Promise.all([
      getAdminDailySummary(today),
      getEscalationStudents(today),
    ]);
  }

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      {profile.role === "parent" ? (
        <ParentDashboard fullName={profile.fullName} students={children} />
      ) : profile.role === "admin" && adminDailySummary ? (
        <AdminDashboard
          fullName={profile.fullName}
          summary={adminDailySummary}
          escalations={adminEscalations}
        />
      ) : (
        <StaffDashboard fullName={profile.fullName} role={profile.role} />
      )}
    </AppShell>
  );
}
