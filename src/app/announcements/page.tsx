import { Megaphone, X } from "lucide-react";

import { AppShell } from "@/components/controlpad/app-shell";
import { DataTable } from "@/components/controlpad/data-table";
import { EmptyState } from "@/components/controlpad/empty-state";
import { PageHeader } from "@/components/controlpad/page-header";
import { StatusBadge, type StatusTone } from "@/components/controlpad/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { addDays } from "@/lib/absence-reports/parse";
import {
  audienceLabel,
  easternClock,
  UNGROUPED,
  type Audience,
} from "@/lib/announcements/announcements";
import { requireRole } from "@/lib/auth/current-profile";
import { getScheduleGroups } from "@/lib/schedule/schedule-groups-data";
import { createClient } from "@/lib/supabase/server";

import { cancelAnnouncement } from "./actions";
import { ComposeForm, type AudienceOption, type CountingStudent } from "./compose-form";

// ── Tunable constants ────────────────────────────────────────────────────────

/** How many past announcements to list. */
const HISTORY_LIMIT = 50;

// ── Types ────────────────────────────────────────────────────────────────────

type AnnouncementRow = {
  id: string;
  message: string;
  audience: Audience;
  status: "scheduled" | "sending" | "sent" | "cancelled" | "failed";
  send_at: string;
  sent_at: string | null;
  recipients: number | null;
  failed_count: number | null;
  delivery_mode: string | null;
  error: string | null;
};

type StudentRow = {
  schedule_group_id: string | null;
  student_guardians:
    | { guardians: { phone: string | null } | { phone: string | null }[] | null }[]
    | null;
};

const statusDisplay: Record<AnnouncementRow["status"], { label: string; tone: StatusTone }> = {
  scheduled: { label: "Scheduled", tone: "warning" },
  sending: { label: "Sending", tone: "warning" },
  sent: { label: "Sent", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function resultText(row: AnnouncementRow) {
  if (row.status === "failed") return row.error ?? "Failed";
  if (row.status !== "sent" || row.recipients === null) return "—";
  const families = `${row.recipients} famil${row.recipients === 1 ? "y" : "ies"}`;
  if (row.delivery_mode === "off") return `${families} · logged, not sent (texting off)`;
  if (row.delivery_mode === "test") return `${families} · test mode`;
  return row.failed_count ? `${families} · ${row.failed_count} failed` : families;
}

export default async function AnnouncementsPage() {
  const profile = await requireRole(["admin"]);
  const supabase = await createClient();

  const [groups, { data: studentData }, { data: historyData, error: historyError }] =
    await Promise.all([
      getScheduleGroups(),
      supabase
        .from("students")
        .select("schedule_group_id, student_guardians(guardians(phone))")
        .eq("enrollment_status", "active"),
      supabase
        .from("announcements")
        .select(
          "id, message, audience, status, send_at, sent_at, recipients, failed_count, delivery_mode, error",
        )
        .order("send_at", { ascending: false })
        .limit(HISTORY_LIMIT),
    ]);

  // Family phones become opaque numbers so no phone numbers reach the browser.
  const phoneIds = new Map<string, number>();
  const counting: CountingStudent[] = ((studentData ?? []) as StudentRow[]).map((row) => {
    const phones = (row.student_guardians ?? [])
      .flatMap((link) =>
        Array.isArray(link.guardians) ? link.guardians : link.guardians ? [link.guardians] : [],
      )
      .map((guardian) => guardian.phone?.trim())
      .filter((phone): phone is string => Boolean(phone));
    return {
      group: row.schedule_group_id ?? UNGROUPED,
      families: phones.map((phone) => {
        if (!phoneIds.has(phone)) phoneIds.set(phone, phoneIds.size);
        return phoneIds.get(phone)!;
      }),
    };
  });

  const studentsPerGroup = new Map<string, number>();
  for (const student of counting) {
    studentsPerGroup.set(student.group, (studentsPerGroup.get(student.group) ?? 0) + 1);
  }
  const options: AudienceOption[] = groups.map((group) => ({
    key: group.id,
    label: group.name,
    students: studentsPerGroup.get(group.id) ?? 0,
  }));
  if (studentsPerGroup.get(UNGROUPED)) {
    options.push({
      key: UNGROUPED,
      label: "Students without a group",
      students: studentsPerGroup.get(UNGROUPED) ?? 0,
    });
  }

  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const history = historyError ? [] : ((historyData ?? []) as AnnouncementRow[]);
  const today = easternClock(new Date()).date;

  return (
    <AppShell fullName={profile.fullName} role={profile.role}>
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          title="Announcements"
          description="Text all parents or chosen schedule groups — closures, Eid schedules, reminders."
        />

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>New announcement</CardTitle>
            <CardDescription>
              Each family gets one text, even with several children enrolled. Texts follow the
              current texting mode on the Messages page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {historyError ? (
              <EmptyState
                title="Announcements aren't set up yet"
                description="Apply the announcements migration (supabase db push), then reload."
                icon={Megaphone}
              />
            ) : (
              <ComposeForm
                options={options}
                students={counting}
                defaultDate={addDays(today, 1)}
                minDate={today}
              />
            )}
          </CardContent>
        </Card>

        {historyError ? null : (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">History</h2>
            <DataTable
              data={history}
              getRowKey={(row) => row.id}
              empty={
                <EmptyState
                  title="No announcements yet"
                  description="Sent and scheduled announcements will appear here."
                  icon={Megaphone}
                />
              }
              columns={[
                {
                  key: "when",
                  header: "When",
                  cell: (row) => (
                    <div className="whitespace-nowrap">
                      <p>{formatTimestamp(row.sent_at ?? row.send_at)}</p>
                      {row.status === "scheduled" ? (
                        <p className="mt-1 text-xs text-muted-foreground">Scheduled</p>
                      ) : null}
                    </div>
                  ),
                  className: "text-muted-foreground",
                },
                {
                  key: "message",
                  header: "Message",
                  cell: (row) => (
                    <div className="max-w-md">
                      <p className="text-sm leading-5">{row.message}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        To {audienceLabel(row.audience, groupNames)}
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
                        status={statusDisplay[row.status]?.label ?? row.status}
                        tone={statusDisplay[row.status]?.tone ?? "neutral"}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">{resultText(row)}</p>
                    </div>
                  ),
                },
                {
                  key: "actions",
                  header: "",
                  cell: (row) =>
                    row.status === "scheduled" ? (
                      <form action={cancelAnnouncement.bind(null, row.id)}>
                        <Button type="submit" variant="outline" size="sm">
                          <X className="size-4" aria-hidden="true" />
                          Cancel
                        </Button>
                      </form>
                    ) : null,
                },
              ]}
            />
          </section>
        )}
      </div>
    </AppShell>
  );
}
