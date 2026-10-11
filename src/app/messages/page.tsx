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

import { SimulateInboundForm } from "./simulate-inbound-form";
import { TestTextButton } from "./test-text-button";

// ── Tunable constants ────────────────────────────────────────────────────────

/** How many recent messages to show. */
const MESSAGE_LIMIT = 150;

/** How many recent incoming texts to show. */
const INBOUND_LIMIT = 50;

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

type InboundRow = {
  id: string;
  from_phone: string;
  body: string;
  outcome: "absence_report" | "needs_child" | "forwarded" | "ignored";
  simulated: boolean;
  created_at: string;
  guardians: { full_name: string } | { full_name: string }[] | null;
};

const outcomeDisplay: Record<InboundRow["outcome"], { label: string; tone: StatusTone }> = {
  absence_report: { label: "Absence report", tone: "warning" },
  needs_child: { label: "Asked which child", tone: "neutral" },
  forwarded: { label: "Forwarded to admin", tone: "neutral" },
  ignored: { label: "Ignored (keyword)", tone: "neutral" },
};

function senderLabel(row: InboundRow) {
  const guardian = Array.isArray(row.guardians) ? row.guardians[0] : row.guardians;
  return guardian?.full_name ?? "Unknown number";
}

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
  absence_report_reply: "Absence report reply",
  parent_message: "Parent text (forwarded)",
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

  // Missing table (migration not applied yet) → just hide the log.
  const { data: inboundData, error: inboundError } = await supabase
    .from("inbound_messages")
    .select("id, from_phone, body, outcome, simulated, created_at, guardians(full_name)")
    .order("created_at", { ascending: false })
    .limit(INBOUND_LIMIT);
  const inboundRows = inboundError ? [] : ((inboundData ?? []) as InboundRow[]);

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

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>Incoming texts</CardTitle>
            <CardDescription className="max-w-2xl">
              Texts parents send to the school number. Absences become reports to review on
              Attendance; anything else is forwarded to admin. Until Twilio is live, use
              &ldquo;Simulate text&rdquo; with a guardian&apos;s phone number to try it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SimulateInboundForm />
            {inboundRows.length > 0 ? (
              <DataTable
                data={inboundRows}
                getRowKey={(row) => row.id}
                columns={[
                  {
                    key: "when",
                    header: "When",
                    cell: (row) => formatTimestamp(row.created_at),
                    className: "whitespace-nowrap text-muted-foreground",
                  },
                  {
                    key: "from",
                    header: "From",
                    cell: (row) => (
                      <div>
                        <p className="font-medium">{senderLabel(row)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {maskPhone(row.from_phone)}
                          {row.simulated ? " · simulated" : ""}
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: "message",
                    header: "Message",
                    cell: (row) => <p className="max-w-md text-sm leading-5">{row.body}</p>,
                  },
                  {
                    key: "outcome",
                    header: "Outcome",
                    cell: (row) => (
                      <StatusBadge
                        status={outcomeDisplay[row.outcome]?.label ?? row.outcome}
                        tone={outcomeDisplay[row.outcome]?.tone ?? "neutral"}
                      />
                    ),
                  },
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No incoming texts yet.</p>
            )}
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
