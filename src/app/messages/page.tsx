import { MessageSquare } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge, type StatusTone } from "@/components/controlpad/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireRole } from "@/lib/auth/current-profile";
import { getSmsConfig, maskPhone, type SmsMode } from "@/lib/sms/send-sms";
import { createClient } from "@/lib/supabase/server";

import { TestTextButton } from "./test-text-button";

// ── Tunable constants ────────────────────────────────────────────────────────

/** How many recent messages to show. */
const MESSAGE_LIMIT = 150;

// ── Types ────────────────────────────────────────────────────────────────────

type NotificationRow = {
  id: string;
  recipient_phone: string;
  recipient_type: string;
  trigger_type: string;
  body: string;
  status: "queued" | "sent" | "failed" | "dry_run";
  error: string | null;
  created_at: string;
  students: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
};

const triggerLabels: Record<string, string> = {
  low_grade: "Low grade",
  absence: "Absence",
  absence_review: "Attendance review",
  tardy_threshold: "Tardies",
  quran_slip: "Quran slip",
  payment_overdue: "Tuition overdue",
  admin_digest: "Daily digest",
  manual_test: "Test",
  special_day: "Special day",
  pace_behind: "Behind pace",
  missing_assignments: "Missing work",
};

const statusDisplay: Record<NotificationRow["status"], { label: string; tone: StatusTone }> = {
  sent: { label: "Sent", tone: "success" },
  queued: { label: "Sending", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  dry_run: { label: "Not sent (dry run)", tone: "neutral" },
};

const modeDisplay: Record<SmsMode, { label: string; tone: StatusTone; description: string }> = {
  off: {
    label: "Texting off",
    tone: "warning",
    description:
      "Alerts are still generated and logged below, but no texts are sent. Once a Twilio number is set up (docs/SETUP.md), add its keys in Vercel to turn texting on.",
  },
  test: {
    label: "Test mode",
    tone: "warning",
    description:
      "Every text is sent to the test number instead of the real parent or admin, prefixed with who it was meant for.",
  },
  live: {
    label: "Live",
    tone: "success",
    description: "Texts are delivered to parents and admins.",
  },
};

function studentLabel(row: NotificationRow) {
  const student = Array.isArray(row.students) ? row.students[0] : row.students;
  return student ? `${student.first_name} ${student.last_name}` : "—";
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function MessagesPage() {
  const profile = await requireRole(["admin"]);
  const config = getSmsConfig();
  const mode = modeDisplay[config.mode];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id, recipient_phone, recipient_type, trigger_type, body, status, error, created_at, students(first_name, last_name)",
    )
    .order("created_at", { ascending: false })
    .limit(MESSAGE_LIMIT);

  const rows = (data ?? []) as NotificationRow[];

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Messages"
          description="Every automated text ControlPad has sent or would have sent, newest first."
        />

        <Card className="border shadow-sm">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                Texting status <StatusBadge status={mode.label} tone={mode.tone} />
              </CardTitle>
              <CardDescription className="max-w-2xl">{mode.description}</CardDescription>
            </div>
            <TestTextButton />
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
            <p>
              <span className="font-medium text-foreground">Reason: </span>
              {config.reason}
            </p>
            <p>
              <span className="font-medium text-foreground">Sending number: </span>
              {config.twilio ? maskPhone(config.twilio.fromPhone) : "Not set"}
            </p>
            <p>
              <span className="font-medium text-foreground">Test number: </span>
              {config.testNumber ? maskPhone(config.testNumber) : "Not set"}
            </p>
          </CardContent>
        </Card>

        {error ? (
          <EmptyState
            title="Could not load messages"
            description={error.message}
            icon={MessageSquare}
          />
        ) : (
          <DataTable
            data={rows}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                title="No messages yet"
                description="Alerts will appear here as soon as one is triggered."
                icon={MessageSquare}
              />
            }
            columns={[
              {
                key: "when",
                header: "When",
                cell: (row) => formatTimestamp(row.created_at),
                className: "whitespace-nowrap text-muted-foreground",
              },
              {
                key: "type",
                header: "Type",
                cell: (row) => (
                  <div>
                    <p className="font-medium">
                      {triggerLabels[row.trigger_type] ?? row.trigger_type}
                    </p>
                    <p className="mt-1 text-xs capitalize text-muted-foreground">
                      To {row.recipient_type} {maskPhone(row.recipient_phone)}
                    </p>
                  </div>
                ),
              },
              {
                key: "student",
                header: "Student",
                cell: studentLabel,
              },
              {
                key: "message",
                header: "Message",
                cell: (row) => (
                  <div className="max-w-md">
                    <p className="text-sm leading-5">{row.body}</p>
                    {row.status === "failed" && row.error ? (
                      <p className="mt-1 text-xs text-status-danger">{row.error}</p>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (row) => {
                  const display = statusDisplay[row.status] ?? {
                    label: row.status,
                    tone: "neutral" as const,
                  };
                  return <StatusBadge status={display.label} tone={display.tone} />;
                },
              },
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
