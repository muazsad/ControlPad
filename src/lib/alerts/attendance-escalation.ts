import { createServiceClient } from "@/lib/supabase/server";
import { sendSms, type SendSmsInput, type SmsResult } from "@/lib/sms/send-sms";
import { sendAdminDigest } from "@/lib/alerts/admin-digest";
import { checkTardyThresholdAlerts } from "@/lib/alerts/attendance";
import { checkQuranSlipAlerts } from "@/lib/alerts/quran";
import {
  sendSpecialDayNotice,
  shouldAutoSendSpecialDayNotice,
} from "@/lib/alerts/special-day";
import { specialDayForDate, type SchoolCalendarConfig } from "@/lib/schedule/calendar";
import { getServiceSchoolCalendar } from "@/lib/schedule/calendar-data";
import { getServiceScheduleGroups } from "@/lib/schedule/schedule-groups-data";
import {
  addMinutesToTime,
  formatTime12h,
  scheduleForDate,
  timeToMinutes,
  type DefaultSchedule,
  type ScheduleGroup,
} from "@/lib/schedule/student-schedule";

// Two-stage absence escalation, driven by each student's schedule group:
//
//   1. At the group's absence-check time, the admin gets ONE text listing the
//      group's students who are still unmarked or marked absent.
//   2. `settings.parent_alert_delay_minutes` later, parents of students who are
//      STILL unmarked or absent get a text. If staff mark the student present,
//      tardy, or excused in between, no parent text goes out.
//
// Called every ~10 minutes by /api/cron/attendance-tick. Safe to call
// repeatedly: sendSms dedupes on (recipient, dedupe key / student + trigger).

// ── Tunable constants ────────────────────────────────────────────────────────

const SCHOOL_TIME_ZONE = "America/New_York";

/** Max student names listed in one admin text before "and N more". */
const ADMIN_MESSAGE_MAX_NAMES = 6;

/** Dedupe window for per-student parent absence texts (one per school day). */
const PARENT_DEDUPE_HOURS = 20;

/** Dedupe window for batched admin review texts (keyed per date + group). */
const ADMIN_DEDUPE_HOURS = 20;

/**
 * The daily admin digest is triggered by the tick during this many minutes
 * after settings.admin_digest_time (sendSms dedupes it to once per day).
 */
const DIGEST_TRIGGER_WINDOW_MINUTES = 60;

/**
 * Local (Eastern) time the daily Quran inactivity check runs from the tick.
 * Running it here instead of a fixed-UTC Vercel cron keeps it at the same local
 * time year-round. Repeated ticks inside the window are deduped by sendSms.
 */
export const QURAN_CHECK_TIME = "11:00";
const QURAN_CHECK_WINDOW_MINUTES = 60;

// ── Types ────────────────────────────────────────────────────────────────────

export type AttendanceMark = "present" | "tardy" | "absent" | "excused";

export type EscalationStudent = {
  id: string;
  firstName: string;
  lastName: string;
  groupId: string | null;
  status: AttendanceMark | null;
  guardians: { full_name: string; phone: string }[];
  /**
   * A parent texted in that the student is out (absence report pending review
   * or marked unexcused). The admin text still lists them; parents aren't texted.
   */
  reportedAbsent?: boolean;
};

export type FlaggedStudent = {
  id: string;
  name: string;
  state: "unmarked" | "absent" | "reported";
};

export type AdminBatch = {
  /** Group id, or "default" for students without a group. */
  key: string;
  label: string;
  absenceCheckTime: string;
  /** null when a special day pauses parent texts for this batch. */
  parentAlertTime: string | null;
  students: FlaggedStudent[];
};

export type ParentAlert = FlaggedStudent & {
  guardians: { full_name: string; phone: string }[];
};

export type EscalationPlan = {
  expectedToday: number;
  adminBatches: AdminBatch[];
  parentAlerts: ParentAlert[];
  /** Latest parent-alert time among today's schedules (minutes), or null. */
  lastParentAlertMinutes: number | null;
};

export type EscalationSettings = DefaultSchedule & {
  parentAlertDelayMinutes: number;
  /** "HH:MM"; when set, the tick also triggers the daily admin digest. */
  adminDigestTime?: string;
};

// ── Time zone helpers ────────────────────────────────────────────────────────

export function schoolClock(now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

/** Minutes into `date` (school time) that `now` represents, clamped for other days. */
export function minutesIntoDate(date: string, now: Date): number {
  const clock = schoolClock(now);
  if (clock.date > date) return 24 * 60;
  if (clock.date < date) return -1;
  return clock.minutes;
}

function friendlyDate(date: string): string {
  return new Date(`${date}T12:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ── Pure planning ────────────────────────────────────────────────────────────

export function planAttendanceEscalation(input: {
  date: string;
  nowMinutes: number;
  students: EscalationStudent[];
  groups: ScheduleGroup[];
  calendar: SchoolCalendarConfig;
  settings: EscalationSettings;
}): EscalationPlan {
  const groupsById = new Map(input.groups.map((group) => [group.id, group]));
  const batches = new Map<string, AdminBatch>();
  const parentAlerts: ParentAlert[] = [];
  let expectedToday = 0;
  let lastParentAlertMinutes: number | null = null;

  for (const student of input.students) {
    const group = student.groupId ? groupsById.get(student.groupId) ?? null : null;
    const schedule = scheduleForDate(input.date, group, input.calendar, input.settings);
    if (!schedule) continue;
    expectedToday += 1;

    const checkMinutes = timeToMinutes(schedule.absenceCheckTime);
    const parentMinutes = checkMinutes + input.settings.parentAlertDelayMinutes;
    if (schedule.parentAlerts) {
      lastParentAlertMinutes = Math.max(lastParentAlertMinutes ?? 0, parentMinutes);
    }

    if (student.status !== null && student.status !== "absent") continue;
    if (input.nowMinutes < checkMinutes) continue;

    const flagged: FlaggedStudent = {
      id: student.id,
      name: `${student.firstName} ${student.lastName}`.trim(),
      state: student.reportedAbsent
        ? "reported"
        : student.status === "absent"
          ? "absent"
          : "unmarked",
    };

    // Separate batch when parent texts are paused, so the admin text says so.
    const key = `${schedule.groupId ?? "default"}${schedule.parentAlerts ? "" : ":no-parent-texts"}`;
    const batch =
      batches.get(key) ??
      ({
        key,
        label: schedule.groupName ?? "School-default",
        absenceCheckTime: schedule.absenceCheckTime,
        parentAlertTime: schedule.parentAlerts
          ? addMinutesToTime(
              schedule.absenceCheckTime,
              input.settings.parentAlertDelayMinutes,
            )
          : null,
        students: [],
      } satisfies AdminBatch);
    batch.students.push(flagged);
    batches.set(key, batch);

    // The parent already told us — no "not checked in" text for them.
    if (
      flagged.state !== "reported" &&
      schedule.parentAlerts &&
      input.nowMinutes >= parentMinutes
    ) {
      parentAlerts.push({ ...flagged, guardians: student.guardians });
    }
  }

  return {
    expectedToday,
    adminBatches: Array.from(batches.values()),
    parentAlerts,
    lastParentAlertMinutes,
  };
}

export function adminReviewMessage(batch: AdminBatch, date: string): string {
  const shown = batch.students.slice(0, ADMIN_MESSAGE_MAX_NAMES);
  const extra = batch.students.length - shown.length;
  const names =
    shown
      .map(
        (student) =>
          `${student.name} (${student.state === "reported" ? "parent reported" : student.state})`,
      )
      .join(", ") +
    (extra > 0 ? `, and ${extra} more` : "");
  const count = batch.students.length;
  return (
    `ControlPad ${friendlyDate(date)}: ${count} ${batch.label} student${count === 1 ? "" : "s"} ` +
    `not checked in by ${formatTime12h(batch.absenceCheckTime)}: ${names}. ` +
    (batch.parentAlertTime
      ? `Parents will be texted at ${formatTime12h(batch.parentAlertTime)} unless attendance is updated.`
      : `Parent texts are paused today (special day).`)
  );
}

export function parentAbsenceMessage(alert: ParentAlert, date: string): string {
  return alert.state === "absent"
    ? `Salaam Institute: ${alert.name} was marked absent today (${friendlyDate(date)}). Please contact the school if you have questions.`
    : `Salaam Institute: ${alert.name} has not been checked in today (${friendlyDate(date)}). If this is unexpected, please contact the school.`;
}

export function escalationMessages(
  plan: EscalationPlan,
  date: string,
  admins: { phone: string | null }[],
): SendSmsInput[] {
  const messages: SendSmsInput[] = [];

  for (const batch of plan.adminBatches) {
    const body = adminReviewMessage(batch, date);
    for (const admin of admins) {
      if (!admin.phone) continue;
      messages.push({
        recipientPhone: admin.phone,
        recipientType: "admin",
        studentId: null,
        triggerType: "absence_review",
        body,
        dedupeKey: `absence_review:${date}:${batch.key}`,
        dedupeWindowHours: ADMIN_DEDUPE_HOURS,
      });
    }
  }

  for (const alert of plan.parentAlerts) {
    const body = parentAbsenceMessage(alert, date);
    for (const guardian of alert.guardians) {
      messages.push({
        recipientPhone: guardian.phone,
        recipientType: "parent",
        studentId: alert.id,
        triggerType: "absence",
        body,
        dedupeWindowHours: PARENT_DEDUPE_HOURS,
      });
    }
  }

  return messages;
}

// ── Database ─────────────────────────────────────────────────────────────────

/** Absence-report statuses that mean "the parent told us the student is out". */
const REPORTED_ABSENCE_STATUSES = ["pending", "unexcused"];

export type EscalationDatabase = {
  getSettings(): Promise<EscalationSettings>;
  getSchoolCalendar(): Promise<SchoolCalendarConfig>;
  getScheduleGroups(): Promise<ScheduleGroup[]>;
  getAdminRecipients(): Promise<{ phone: string | null }[]>;
  getActiveStudents(date: string): Promise<EscalationStudent[]>;
};

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  schedule_group_id: string | null;
  attendance: { status: AttendanceMark; date: string }[] | null;
  student_guardians:
    | {
        guardians:
          | { full_name: string; phone: string | null }
          | { full_name: string; phone: string | null }[]
          | null;
      }[]
    | null;
};

export function createSupabaseEscalationDatabase(): EscalationDatabase {
  const supabase = createServiceClient();

  return {
    async getSettings() {
      const { data, error } = await supabase
        .from("settings")
        .select("school_start, tardy_window_hours, parent_alert_delay_minutes, admin_digest_time")
        .eq("id", 1)
        .single();
      if (error) throw new Error(error.message);
      return {
        schoolStart: String(data.school_start).slice(0, 5),
        tardyWindowHours: Number(data.tardy_window_hours),
        parentAlertDelayMinutes: Number(data.parent_alert_delay_minutes),
        adminDigestTime: String(data.admin_digest_time).slice(0, 5),
      };
    },
    getSchoolCalendar: getServiceSchoolCalendar,
    getScheduleGroups: getServiceScheduleGroups,
    async getAdminRecipients() {
      const { data, error } = await supabase
        .from("profiles")
        .select("phone")
        .eq("role", "admin")
        .not("phone", "is", null);
      if (error) throw new Error(error.message);
      return (data ?? []) as { phone: string | null }[];
    },
    async getActiveStudents(date) {
      const { data, error } = await supabase
        .from("students")
        .select(
          "id, first_name, last_name, schedule_group_id, attendance(status, date), student_guardians(guardians(full_name, phone))",
        )
        .eq("enrollment_status", "active")
        .eq("attendance.date", date);
      if (error) throw new Error(error.message);

      // Parent-reported absences. Tolerate the table being missing (migration
      // not applied yet) so the tick keeps working.
      const { data: reportData, error: reportError } = await supabase
        .from("absence_reports")
        .select("student_id")
        .eq("date", date)
        .in("status", REPORTED_ABSENCE_STATUSES);
      const reported = new Set(
        reportError ? [] : (reportData ?? []).map((row) => row.student_id as string),
      );

      return ((data ?? []) as StudentRow[]).map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        groupId: row.schedule_group_id,
        reportedAbsent: reported.has(row.id),
        status:
          (row.attendance ?? []).find((record) => record.date === date)?.status ??
          null,
        guardians: (row.student_guardians ?? [])
          .flatMap((link) =>
            Array.isArray(link.guardians) ? link.guardians : [link.guardians],
          )
          .filter(
            (guardian): guardian is { full_name: string; phone: string } =>
              Boolean(guardian?.phone),
          ),
      }));
    },
  };
}

// ── Runner ───────────────────────────────────────────────────────────────────

export type AttendanceTickResult = {
  date: string;
  expectedToday: number;
  adminBatches: number;
  parentAlerts: number;
  messages: number;
  sent: Record<string, number>;
  tardyCheck: { ran: boolean; messages: number };
  quranCheck: { ran: boolean; messages: number };
  specialDayNotice: { date: string; recipients: number } | null;
  digest: { ran: boolean; sent: boolean; skippedReason: string | null };
};

export async function runAttendanceTick(
  input: { now: Date; date?: string },
  deps: {
    database?: EscalationDatabase;
    sendSms?: (input: SendSmsInput) => Promise<SmsResult>;
    checkTardies?: (date: string) => Promise<{ messages: number }>;
    checkQuran?: (date: string) => Promise<{ messages: number }>;
    sendSpecialDayNotice?: (date: string, now: Date) => Promise<{ recipients: number }>;
    sendDigest?: (
      date: string,
      now: Date,
    ) => Promise<{ sent: boolean; skippedReason?: string }>;
  } = {},
): Promise<AttendanceTickResult> {
  const database = deps.database ?? createSupabaseEscalationDatabase();
  const send = deps.sendSms ?? sendSms;
  const checkTardies =
    deps.checkTardies ?? ((date: string) => checkTardyThresholdAlerts({ date }));
  const checkQuran = deps.checkQuran ?? ((date: string) => checkQuranSlipAlerts(date));
  const sendNotice =
    deps.sendSpecialDayNotice ??
    ((date: string, now: Date) => sendSpecialDayNotice({ date, now }));
  const sendDigest =
    deps.sendDigest ?? ((date: string, now: Date) => sendAdminDigest({ date, now }));

  const date = input.date ?? schoolClock(input.now).date;
  const nowMinutes = minutesIntoDate(date, input.now);

  const [settings, calendar, groups, students, admins] = await Promise.all([
    database.getSettings(),
    database.getSchoolCalendar(),
    database.getScheduleGroups(),
    database.getActiveStudents(date),
    database.getAdminRecipients(),
  ]);

  const plan = planAttendanceEscalation({
    date,
    nowMinutes,
    students,
    groups,
    calendar,
    settings,
  });
  const messages = escalationMessages(plan, date, admins);
  const results = await Promise.all(messages.map((message) => send(message)));

  const sent: Record<string, number> = {};
  for (const result of results) sent[result.status] = (sent[result.status] ?? 0) + 1;

  // Weekly tardy check runs once the day's last parent-alert time has passed
  // (it dedupes per student for 7 days, so repeated ticks are harmless).
  let tardyCheck = { ran: false, messages: 0 };
  if (
    plan.lastParentAlertMinutes !== null &&
    nowMinutes >= plan.lastParentAlertMinutes
  ) {
    const result = await checkTardies(date);
    tardyCheck = { ran: true, messages: result.messages };
  }

  // Daily Quran inactivity check at QURAN_CHECK_TIME (local), year-round.
  let quranCheck = { ran: false, messages: 0 };
  const quranMinutes = timeToMinutes(QURAN_CHECK_TIME);
  if (
    nowMinutes >= quranMinutes &&
    nowMinutes < quranMinutes + QURAN_CHECK_WINDOW_MINUTES
  ) {
    const result = await checkQuran(date);
    quranCheck = { ran: true, messages: result.messages };
  }

  // Evening-before parent text for tomorrow's special day (if turned on).
  let specialDayNotice: AttendanceTickResult["specialDayNotice"] = null;
  const tomorrowDate = new Date(`${date}T00:00:00.000Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);
  if (
    shouldAutoSendSpecialDayNotice({
      day: specialDayForDate(tomorrow, calendar),
      today: date,
      nowMinutes,
    })
  ) {
    const result = await sendNotice(tomorrow, input.now);
    specialDayNotice = { date: tomorrow, recipients: result.recipients };
  }

  // Daily admin digest at settings.admin_digest_time (local), year-round.
  let digest: AttendanceTickResult["digest"] = {
    ran: false,
    sent: false,
    skippedReason: null,
  };
  if (settings.adminDigestTime) {
    const digestMinutes = timeToMinutes(settings.adminDigestTime);
    if (
      nowMinutes >= digestMinutes &&
      nowMinutes < digestMinutes + DIGEST_TRIGGER_WINDOW_MINUTES
    ) {
      const result = await sendDigest(date, input.now);
      digest = {
        ran: true,
        sent: result.sent,
        skippedReason: result.skippedReason ?? null,
      };
    }
  }

  return {
    date,
    expectedToday: plan.expectedToday,
    adminBatches: plan.adminBatches.length,
    parentAlerts: plan.parentAlerts.length,
    messages: messages.length,
    sent,
    tardyCheck,
    quranCheck,
    specialDayNotice,
    digest,
  };
}
