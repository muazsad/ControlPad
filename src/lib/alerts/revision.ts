import { isoWeekKey } from "@/lib/grades/pace";
import { isRevision } from "@/lib/quran/lessons";
import {
  DEFAULT_REVISION_OVERDUE_SCHOOL_DAYS,
  juzRevisionStatuses,
  overdueJuz,
  revisionOverdueMessage,
  type MemorizedJuz,
  type QuranLessonEntry,
} from "@/lib/quran/revision";
import { getServiceSchoolCalendar } from "@/lib/schedule/calendar-data";
import { isSchoolDay, type SchoolCalendarConfig } from "@/lib/schedule/calendar";
import { sendSms, type SendSmsInput, type SmsResult } from "@/lib/sms/send-sms";
import { createServiceClient } from "@/lib/supabase/server";

// Daily "revision overdue" texts, run from the attendance tick next to the
// Quran inactivity check. One SMS per student (to parents + admin) listing the
// memorized juz that haven't had sabaq para or dhor in too many school days.

type Recipient = { full_name: string; phone: string | null };

export type RevisionStudent = {
  id: string;
  name: string;
  memorized: MemorizedJuz[];
  /** Revision entries (sabaq para / dhor); sabaq rows are ignored. */
  entries: QuranLessonEntry[];
  guardians: Recipient[];
};

export type RevisionAlertDatabase = {
  getRevisionOverdueSchoolDays(): Promise<number>;
  getSchoolCalendar(): Promise<SchoolCalendarConfig>;
  getAdminRecipients(): Promise<Recipient[]>;
  getStudents(): Promise<RevisionStudent[]>;
};

type Deps = {
  database?: RevisionAlertDatabase;
  sendSms?: (input: SendSmsInput) => Promise<SmsResult>;
};

export type RevisionAlertResult = { students: number; messages: number };

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  student_memorized_juz: { juz: number; marked_at: string }[] | null;
  quran_progress: { date: string; lesson_type: string | null; juz: number | null }[] | null;
  student_guardians:
    | { guardians: Recipient | Recipient[] | null }[]
    | null;
};

export function createSupabaseRevisionAlertDatabase(): RevisionAlertDatabase {
  const supabase = createServiceClient();

  return {
    async getRevisionOverdueSchoolDays() {
      const { data, error } = await supabase
        .from("settings")
        .select("revision_overdue_school_days")
        .eq("id", 1)
        .single();
      if (error) throw new Error(error.message);
      return Number(data.revision_overdue_school_days ?? DEFAULT_REVISION_OVERDUE_SCHOOL_DAYS);
    },
    async getSchoolCalendar() {
      return getServiceSchoolCalendar();
    },
    async getAdminRecipients() {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("role", "admin")
        .not("phone", "is", null);
      if (error) throw new Error(error.message);
      return (data ?? []) as Recipient[];
    },
    async getStudents() {
      // One query: memorized juz, revision entries and guardians per student.
      const { data, error } = await supabase
        .from("students")
        .select(
          "id, first_name, last_name, student_memorized_juz(juz, marked_at), quran_progress(date, lesson_type, juz), student_guardians(guardians(full_name, phone))",
        )
        .eq("enrollment_status", "active")
        .neq("quran_progress.lesson_type", "sabaq");
      if (error) throw new Error(error.message);

      return ((data ?? []) as unknown as StudentRow[]).map((row) => ({
        id: row.id,
        name: `${row.first_name} ${row.last_name}`.trim(),
        memorized: (row.student_memorized_juz ?? []).map((item) => ({
          juz: item.juz,
          markedAt: item.marked_at,
        })),
        entries: (row.quran_progress ?? []).filter(isRevision),
        guardians: (row.student_guardians ?? []).flatMap((link) =>
          Array.isArray(link.guardians) ? link.guardians : link.guardians ? [link.guardians] : [],
        ),
      }));
    },
  };
}

export async function checkRevisionOverdueAlerts(
  asOfDate: string,
  deps: Deps = {},
): Promise<RevisionAlertResult> {
  const database = deps.database ?? createSupabaseRevisionAlertDatabase();
  const send = deps.sendSms ?? sendSms;
  const [threshold, calendar] = await Promise.all([
    database.getRevisionOverdueSchoolDays(),
    database.getSchoolCalendar(),
  ]);

  // Same rule as the Quran inactivity check: nothing on no-school days.
  if (!isSchoolDay(asOfDate, calendar)) return { students: 0, messages: 0 };

  const [students, admins] = await Promise.all([
    database.getStudents(),
    database.getAdminRecipients(),
  ]);
  const week = isoWeekKey(asOfDate);
  const messages: SendSmsInput[] = [];
  let flagged = 0;

  for (const student of students) {
    const overdue = overdueJuz(
      juzRevisionStatuses({
        memorized: student.memorized,
        entries: student.entries,
        asOfDate,
        thresholdSchoolDays: threshold,
        calendar,
      }),
    );
    if (overdue.length === 0) continue;
    flagged += 1;

    const body = revisionOverdueMessage(
      student.name,
      overdue.map((status) => status.juz),
    );
    const recipients = [
      ...student.guardians.map((r) => ({ phone: r.phone, type: "parent" as const })),
      ...admins.map((r) => ({ phone: r.phone, type: "admin" as const })),
    ];
    for (const recipient of recipients) {
      if (!recipient.phone) continue;
      messages.push({
        recipientPhone: recipient.phone,
        recipientType: recipient.type,
        studentId: student.id,
        triggerType: "revision_overdue",
        body,
        dedupeKey: `revision_overdue:${student.id}:${week}`,
      });
    }
  }

  await Promise.all(messages.map((message) => send(message)));
  return { students: flagged, messages: messages.length };
}
