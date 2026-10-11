// Sends announcements (now, or when due on the 10-minute tick). Every text
// goes through sendSms — SMS_MODE, logging and dedupe apply.
// Spec: docs/superpowers/specs/2026-10-11-announcements-design.md

import { getSmsConfig, sendSms, type SendSmsInput, type SmsResult } from "@/lib/sms/send-sms";
import { createServiceClient } from "@/lib/supabase/server";

import {
  ANNOUNCEMENT_DEDUPE_HOURS,
  announcementBody,
  announcementRecipients,
  type AnnouncementStudent,
  type Audience,
} from "./announcements";

// ── Types ────────────────────────────────────────────────────────────────────

export type ClaimedAnnouncement = { id: string; message: string; audience: Audience };

export type AnnouncementDatabase = {
  /**
   * Atomically moves a scheduled announcement to "sending" and returns it, or
   * null if it was already taken (sent, cancelled, or another run claimed it).
   */
  claim(id: string): Promise<ClaimedAnnouncement | null>;
  /** Scheduled announcements whose send_at has passed. */
  findDue(now: Date): Promise<string[]>;
  getActiveStudents(): Promise<AnnouncementStudent[]>;
  finish(
    id: string,
    patch: {
      status: "sent" | "failed";
      sent_at: string;
      recipients: number;
      failed_count: number;
      delivery_mode: string;
      error: string | null;
    },
  ): Promise<void>;
};

export type AnnouncementSendResult =
  | { status: "not_claimed" }
  | { status: "sent" | "failed"; recipients: number; failed: number; mode: string };

// ── Sending ──────────────────────────────────────────────────────────────────

export async function sendAnnouncement(
  id: string,
  deps: {
    database?: AnnouncementDatabase;
    sendSms?: (input: SendSmsInput) => Promise<SmsResult>;
    now?: () => Date;
    mode?: string;
  } = {},
): Promise<AnnouncementSendResult> {
  const database = deps.database ?? createSupabaseAnnouncementDatabase();
  const send = deps.sendSms ?? sendSms;
  const now = deps.now ?? (() => new Date());
  const mode = deps.mode ?? getSmsConfig().mode;

  const announcement = await database.claim(id);
  if (!announcement) return { status: "not_claimed" };

  try {
    const phones = announcementRecipients(
      announcement.audience,
      await database.getActiveStudents(),
    );
    const body = announcementBody(announcement.message);
    const results = await Promise.all(
      phones.map((phone) =>
        send({
          recipientPhone: phone,
          recipientType: "parent",
          studentId: null,
          triggerType: "announcement",
          body,
          dedupeKey: `announcement:${announcement.id}`,
          dedupeWindowHours: ANNOUNCEMENT_DEDUPE_HOURS,
        }),
      ),
    );
    const failed = results.filter(
      (result) => result.status === "failed" || result.status === "gave_up",
    ).length;
    // Only call it failed if nothing got through.
    const status = phones.length > 0 && failed === phones.length ? "failed" : "sent";
    await database.finish(announcement.id, {
      status,
      sent_at: now().toISOString(),
      recipients: phones.length,
      failed_count: failed,
      delivery_mode: mode,
      error: status === "failed" ? "Every text failed — see Messages for details." : null,
    });
    return { status, recipients: phones.length, failed, mode };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sending failed.";
    await database.finish(announcement.id, {
      status: "failed",
      sent_at: now().toISOString(),
      recipients: 0,
      failed_count: 0,
      delivery_mode: mode,
      error: message,
    });
    return { status: "failed", recipients: 0, failed: 0, mode };
  }
}

/** Called by the 10-minute tick: sends every scheduled announcement that's due. */
export async function sendDueAnnouncements(
  now: Date,
  deps: { database?: AnnouncementDatabase; sendSms?: (input: SendSmsInput) => Promise<SmsResult> } = {},
): Promise<{ sent: number }> {
  const database = deps.database ?? createSupabaseAnnouncementDatabase();
  const due = await database.findDue(now);
  let sent = 0;
  for (const id of due) {
    const result = await sendAnnouncement(id, { database, sendSms: deps.sendSms });
    if (result.status === "sent") sent += 1;
  }
  return { sent };
}

// ── Database ─────────────────────────────────────────────────────────────────

type StudentRow = {
  schedule_group_id: string | null;
  student_guardians:
    | { guardians: { phone: string | null } | { phone: string | null }[] | null }[]
    | null;
};

export function createSupabaseAnnouncementDatabase(): AnnouncementDatabase {
  const supabase = createServiceClient();
  return {
    async claim(id) {
      const { data, error } = await supabase
        .from("announcements")
        .update({ status: "sending" })
        .eq("id", id)
        .eq("status", "scheduled")
        .select("id, message, audience")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id as string,
        message: data.message as string,
        audience: (data.audience as string[] | null) ?? null,
      };
    },
    async findDue(now) {
      const { data, error } = await supabase
        .from("announcements")
        .select("id")
        .eq("status", "scheduled")
        .lte("send_at", now.toISOString())
        .order("send_at", { ascending: true });
      if (error) {
        // Before the migration is applied there is nothing to send.
        if (/announcements/.test(error.message)) return [];
        throw new Error(error.message);
      }
      return (data ?? []).map((row) => row.id as string);
    },
    async getActiveStudents() {
      const { data, error } = await supabase
        .from("students")
        .select("schedule_group_id, student_guardians(guardians(phone))")
        .eq("enrollment_status", "active");
      if (error) throw new Error(error.message);
      return ((data ?? []) as StudentRow[]).map((row) => ({
        groupId: row.schedule_group_id,
        guardians: (row.student_guardians ?? []).flatMap((link) =>
          Array.isArray(link.guardians) ? link.guardians : link.guardians ? [link.guardians] : [],
        ),
      }));
    },
    async finish(id, patch) {
      const { error } = await supabase.from("announcements").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}
