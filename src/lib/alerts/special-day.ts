import { createServiceClient } from "@/lib/supabase/server";
import { sendSms, type SendSmsInput, type SmsResult } from "@/lib/sms/send-sms";
import {
  specialDayAppliesTo,
  type SpecialDay,
} from "@/lib/schedule/calendar";
import {
  SPECIAL_DAY_COLUMNS,
  specialDayFromRow,
  type SpecialDayRow,
} from "@/lib/schedule/calendar-data";
import { timeToMinutes } from "@/lib/schedule/student-schedule";

// Parent texts for special days (schedule change, no GCVS, field trip, …).
// Sent automatically the evening before (when the admin turned that on) by the
// attendance tick, or immediately from Settings → Special days.

import {
  SPECIAL_DAY_DEDUPE_HOURS,
  SPECIAL_DAY_NOTICE_TIME,
} from "@/lib/alerts/special-day-constants";

export {
  SPECIAL_DAY_DEDUPE_HOURS,
  SPECIAL_DAY_MESSAGE_MAX_LENGTH,
  SPECIAL_DAY_NOTICE_TIME,
} from "@/lib/alerts/special-day-constants";

const MESSAGE_PREFIX = "Salaam Institute: ";

export type SpecialDayStudent = {
  groupId: string | null;
  guardians: { phone: string | null }[];
};

export function specialDayNoticeBody(message: string): string {
  const trimmed = message.trim();
  return /^salaam institute/i.test(trimmed) ? trimmed : `${MESSAGE_PREFIX}${trimmed}`;
}

/** Unique guardian phones for students the special day applies to. */
export function specialDayRecipients(
  day: SpecialDay,
  students: SpecialDayStudent[],
): string[] {
  const phones = new Set<string>();
  for (const student of students) {
    if (!specialDayAppliesTo(day, student.groupId)) continue;
    for (const guardian of student.guardians) {
      const phone = guardian.phone?.trim();
      if (phone) phones.add(phone);
    }
  }
  return Array.from(phones).sort();
}

/** Small stable hash so an edited message is a new dedupe key. */
function messageHash(message: string): string {
  let hash = 5381;
  for (let i = 0; i < message.length; i += 1) {
    hash = ((hash << 5) + hash + message.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function specialDayDedupeKey(date: string, message: string): string {
  return `special_day:${date}:${messageHash(message.trim())}`;
}

/**
 * Whether the tick should send the automatic text for `day` now. `today` and
 * `nowMinutes` are the school-local date and time.
 */
export function shouldAutoSendSpecialDayNotice(input: {
  day: SpecialDay | undefined;
  today: string;
  nowMinutes: number;
}): boolean {
  const { day } = input;
  if (!day?.notifyParents || !day.parentMessage?.trim() || day.parentsNotifiedAt) {
    return false;
  }
  const eveningBefore = new Date(`${day.date.slice(0, 10)}T00:00:00.000Z`);
  eveningBefore.setUTCDate(eveningBefore.getUTCDate() - 1);
  const noticeDate = eveningBefore.toISOString().slice(0, 10);
  if (input.today !== noticeDate) return false;
  return input.nowMinutes >= timeToMinutes(SPECIAL_DAY_NOTICE_TIME);
}

// ── Sending ──────────────────────────────────────────────────────────────────

export type SpecialDayNoticeDatabase = {
  getSpecialDay(date: string): Promise<SpecialDay | null>;
  getActiveStudents(): Promise<SpecialDayStudent[]>;
  markNotified(date: string, at: Date): Promise<void>;
};

type StudentRow = {
  schedule_group_id: string | null;
  student_guardians:
    | { guardians: { phone: string | null } | { phone: string | null }[] | null }[]
    | null;
};

export function createSupabaseSpecialDayNoticeDatabase(): SpecialDayNoticeDatabase {
  const supabase = createServiceClient();
  return {
    async getSpecialDay(date) {
      const { data, error } = await supabase
        .from("school_special_days")
        .select(SPECIAL_DAY_COLUMNS)
        .eq("date", date)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? specialDayFromRow(data as SpecialDayRow) : null;
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
          Array.isArray(link.guardians)
            ? link.guardians
            : link.guardians
              ? [link.guardians]
              : [],
        ),
      }));
    },
    async markNotified(date, at) {
      const { error } = await supabase
        .from("school_special_days")
        .update({ parents_notified_at: at.toISOString() })
        .eq("date", date);
      if (error) throw new Error(error.message);
    },
  };
}

export type SpecialDayNoticeResult = {
  sent: boolean;
  reason: string | null;
  recipients: number;
  statuses: Record<string, number>;
};

/** Texts the special day's message to parents of students in scope. */
export async function sendSpecialDayNotice(
  input: { date: string; now?: Date },
  deps: {
    database?: SpecialDayNoticeDatabase;
    sendSms?: (input: SendSmsInput) => Promise<SmsResult>;
  } = {},
): Promise<SpecialDayNoticeResult> {
  const database = deps.database ?? createSupabaseSpecialDayNoticeDatabase();
  const send = deps.sendSms ?? sendSms;
  const now = input.now ?? new Date();

  const day = await database.getSpecialDay(input.date);
  const message = day?.parentMessage?.trim();
  if (!day || !message) {
    return { sent: false, reason: "No parent message is set for this day.", recipients: 0, statuses: {} };
  }

  const phones = specialDayRecipients(day, await database.getActiveStudents());
  if (phones.length === 0) {
    return { sent: false, reason: "No parent phone numbers for the students this day applies to.", recipients: 0, statuses: {} };
  }

  const body = specialDayNoticeBody(message);
  const dedupeKey = specialDayDedupeKey(day.date, message);
  const results = await Promise.all(
    phones.map((phone) =>
      send({
        recipientPhone: phone,
        recipientType: "parent",
        studentId: null,
        triggerType: "special_day",
        body,
        dedupeKey,
        dedupeWindowHours: SPECIAL_DAY_DEDUPE_HOURS,
      }),
    ),
  );

  const statuses: Record<string, number> = {};
  for (const result of results) statuses[result.status] = (statuses[result.status] ?? 0) + 1;

  await database.markNotified(day.date, now);
  return { sent: true, reason: null, recipients: phones.length, statuses };
}
