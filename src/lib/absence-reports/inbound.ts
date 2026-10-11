// Handles one text received on the school number: logs it, records absence
// reports, and sends the reply / admin forward (always through sendSms, so
// SMS_MODE and the notifications log apply).
// Spec: docs/superpowers/specs/2026-10-11-parent-absence-reports-design.md

import { schoolClock } from "@/lib/alerts/attendance-escalation";
import { toE164 } from "@/lib/people/people";
import { sendSms, type SendSmsInput, type SmsResult } from "@/lib/sms/send-sms";
import { createServiceClient } from "@/lib/supabase/server";

import {
  acknowledgementMessage,
  askWhichChildMessage,
  FOLLOW_UP_WINDOW_MINUTES,
  forwardToAdminMessage,
  planInboundSms,
  trimReason,
  type InboundChild,
  type PendingFollowUp,
} from "./parse";

// ── Tunable constants ────────────────────────────────────────────────────────

/** Replies are keyed on the inbound message, so this only guards retries. */
const REPLY_DEDUPE_HOURS = 1;

// ── Types ────────────────────────────────────────────────────────────────────

export type InboundOutcome = "absence_report" | "needs_child" | "forwarded" | "ignored";

export type InboundGuardian = { id: string; fullName: string };

export type InboundDatabase = {
  inboundSidExists(twilioSid: string): Promise<boolean>;
  findGuardiansByPhone(phone: string): Promise<InboundGuardian[]>;
  /** Active students linked to any of these guardians (deduped). */
  getChildren(guardianIds: string[]): Promise<InboundChild[]>;
  /** Latest unresolved "which child?" question from this phone since `since`. */
  findPendingFollowUp(phone: string, since: Date): Promise<PendingFollowUp | null>;
  insertInbound(row: {
    from_phone: string;
    body: string;
    twilio_sid: string | null;
    guardian_id: string | null;
    outcome: InboundOutcome;
    pending_date?: string | null;
    pending_reason?: string | null;
    simulated: boolean;
  }): Promise<{ id: string }>;
  resolveFollowUp(id: string, at: Date): Promise<void>;
  /** Inserts reports, skipping any student who already has one that date. Returns how many were new. */
  insertReports(
    rows: {
      student_id: string;
      guardian_id: string | null;
      inbound_message_id: string;
      date: string;
      reason: string;
    }[],
  ): Promise<number>;
  getAdminPhones(): Promise<string[]>;
};

export type InboundResult = {
  outcome: InboundOutcome | "duplicate";
  reportsCreated: number;
  replies: SmsResult["status"][];
};

// ── Runner ───────────────────────────────────────────────────────────────────

export async function handleInboundSms(
  input: {
    from: string;
    body: string;
    twilioSid: string | null;
    simulated?: boolean;
    now?: Date;
  },
  deps: {
    database?: InboundDatabase;
    sendSms?: (input: SendSmsInput) => Promise<SmsResult>;
  } = {},
): Promise<InboundResult> {
  const database = deps.database ?? createSupabaseInboundDatabase();
  const send = deps.sendSms ?? sendSms;
  const now = input.now ?? new Date();
  const from = toE164(input.from) ?? input.from.trim();
  const body = input.body.trim();

  if (input.twilioSid && (await database.inboundSidExists(input.twilioSid))) {
    return { outcome: "duplicate", reportsCreated: 0, replies: [] };
  }

  const guardians = await database.findGuardiansByPhone(from);
  const guardianId = guardians[0]?.id ?? null;
  const children =
    guardians.length > 0 ? await database.getChildren(guardians.map((g) => g.id)) : [];
  const followUp =
    guardians.length > 0
      ? await database.findPendingFollowUp(
          from,
          new Date(now.getTime() - FOLLOW_UP_WINDOW_MINUTES * 60 * 1000),
        )
      : null;

  const clock = schoolClock(now);
  const plan = planInboundSms({
    body,
    knownSender: guardians.length > 0,
    children,
    clock,
    followUp,
  });

  const base = {
    from_phone: from,
    body,
    twilio_sid: input.twilioSid,
    guardian_id: guardianId,
    simulated: input.simulated ?? false,
  };
  const messages: SendSmsInput[] = [];
  let outcome: InboundOutcome;
  let reportsCreated = 0;

  if (plan.kind === "ignored") {
    outcome = "ignored";
    await database.insertInbound({ ...base, outcome });
  } else if (plan.kind === "report") {
    outcome = "absence_report";
    const inbound = await database.insertInbound({ ...base, outcome });
    reportsCreated = await database.insertReports(
      plan.children.map((child) => ({
        student_id: child.id,
        guardian_id: guardianId,
        inbound_message_id: inbound.id,
        date: plan.date,
        reason: plan.reason,
      })),
    );
    if (plan.resolvesFollowUpId) await database.resolveFollowUp(plan.resolvesFollowUpId, now);
    messages.push({
      recipientPhone: from,
      recipientType: "parent",
      studentId: plan.children.length === 1 ? plan.children[0].id : null,
      triggerType: "absence_report_reply",
      body: acknowledgementMessage(plan.children, plan.date, clock.date),
      dedupeKey: `inbound:${inbound.id}`,
      dedupeWindowHours: REPLY_DEDUPE_HOURS,
    });
  } else if (plan.kind === "ask_child") {
    outcome = "needs_child";
    if (followUp) await database.resolveFollowUp(followUp.id, now);
    const inbound = await database.insertInbound({
      ...base,
      outcome,
      pending_date: plan.date,
      pending_reason: plan.reason,
    });
    messages.push({
      recipientPhone: from,
      recipientType: "parent",
      studentId: null,
      triggerType: "absence_report_reply",
      body: askWhichChildMessage(plan.children),
      dedupeKey: `inbound:${inbound.id}`,
      dedupeWindowHours: REPLY_DEDUPE_HOURS,
    });
  } else {
    outcome = "forwarded";
    const inbound = await database.insertInbound({ ...base, outcome });
    const senderLabel =
      guardians.length > 0
        ? `${guardians[0].fullName}${
            children.length > 0
              ? ` (parent of ${children.map((c) => `${c.firstName} ${c.lastName}`.trim()).join(", ")})`
              : ""
          }`
        : `unknown number ${from}`;
    const forward = forwardToAdminMessage({ senderLabel, body: trimReason(body) });
    for (const phone of await database.getAdminPhones()) {
      messages.push({
        recipientPhone: phone,
        recipientType: "admin",
        studentId: null,
        triggerType: "parent_message",
        body: forward,
        dedupeKey: `inbound:${inbound.id}`,
        dedupeWindowHours: REPLY_DEDUPE_HOURS,
      });
    }
  }

  const results = await Promise.all(messages.map((message) => send(message)));
  return { outcome, reportsCreated, replies: results.map((result) => result.status) };
}

// ── Database ─────────────────────────────────────────────────────────────────

type ChildRow = {
  students:
    | { id: string; first_name: string; last_name: string; enrollment_status: string }
    | { id: string; first_name: string; last_name: string; enrollment_status: string }[]
    | null;
};

export function createSupabaseInboundDatabase(): InboundDatabase {
  const supabase = createServiceClient();

  return {
    async inboundSidExists(twilioSid) {
      const { data, error } = await supabase
        .from("inbound_messages")
        .select("id")
        .eq("twilio_sid", twilioSid)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
    async findGuardiansByPhone(phone) {
      const { data, error } = await supabase
        .from("guardians")
        .select("id, full_name")
        .eq("phone", phone)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({ id: row.id as string, fullName: row.full_name as string }));
    },
    async getChildren(guardianIds) {
      const { data, error } = await supabase
        .from("student_guardians")
        .select("students(id, first_name, last_name, enrollment_status)")
        .in("guardian_id", guardianIds);
      if (error) throw new Error(error.message);
      const byId = new Map<string, InboundChild>();
      for (const row of (data ?? []) as ChildRow[]) {
        const students = Array.isArray(row.students) ? row.students : [row.students];
        for (const student of students) {
          if (!student || student.enrollment_status !== "active") continue;
          byId.set(student.id, {
            id: student.id,
            firstName: student.first_name,
            lastName: student.last_name,
          });
        }
      }
      return Array.from(byId.values());
    },
    async findPendingFollowUp(phone, since) {
      const { data, error } = await supabase
        .from("inbound_messages")
        .select("id, pending_date, pending_reason")
        .eq("from_phone", phone)
        .eq("outcome", "needs_child")
        .is("resolved_at", null)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.pending_date) return null;
      return {
        id: data.id as string,
        date: String(data.pending_date),
        reason: (data.pending_reason as string | null) ?? "",
      };
    },
    async insertInbound(row) {
      const { data, error } = await supabase
        .from("inbound_messages")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: data.id as string };
    },
    async resolveFollowUp(id, at) {
      const { error } = await supabase
        .from("inbound_messages")
        .update({ resolved_at: at.toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    async insertReports(rows) {
      if (rows.length === 0) return 0;
      const { data, error } = await supabase
        .from("absence_reports")
        .upsert(rows, { onConflict: "student_id,date", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },
    async getAdminPhones() {
      const { data, error } = await supabase
        .from("profiles")
        .select("phone")
        .eq("role", "admin")
        .not("phone", "is", null);
      if (error) throw new Error(error.message);
      return (data ?? [])
        .map((row) => (row.phone as string | null)?.trim())
        .filter((phone): phone is string => Boolean(phone));
    },
  };
}
