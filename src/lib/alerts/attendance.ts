import { createServiceClient } from "@/lib/supabase/server";
import { sendSms, type SendSmsInput, type SmsResult } from "@/lib/sms/send-sms";
import { getServiceSchoolCalendar } from "@/lib/schedule/calendar-data";
import { type SchoolCalendarConfig } from "@/lib/schedule/calendar";
import { getServiceScheduleGroups } from "@/lib/schedule/schedule-groups-data";
import {
  expectedDatesEnding,
  scheduleForDate,
  type DefaultSchedule,
  type ScheduleGroup,
} from "@/lib/schedule/student-schedule";

const SCHOOL_TIME_ZONE = "America/New_York";

/** Tardies are counted over each student's last N expected school days. */
export const TARDY_WINDOW_SCHOOL_DAYS = 7;

/**
 * How far back (calendar days) to look for those N days. Bounds the query for
 * students in groups that meet rarely (e.g. once a week → ~7 weeks).
 */
export const TARDY_LOOKBACK_MAX_DAYS = 63;

type Recipient = {
  full_name: string;
  phone: string | null;
};

type GuardianRecipient = {
  full_name: string;
  phone: string;
};

export type AttendanceAlertStudent = {
  id: string;
  first_name: string;
  last_name: string;
  guardians: GuardianRecipient[];
};

export type TardyThresholdStudent = AttendanceAlertStudent & {
  tardyCount: number;
};

/** A student with at least one tardy in the lookback range. */
export type TardyCandidate = AttendanceAlertStudent & {
  groupId: string | null;
  tardyDates: string[];
};

export type AttendanceSettings = {
  schoolStart: string;
  tardyWindowHours: number;
  tardiesPerWeek: number;
};

export type AttendanceAlertDatabase = {
  getAttendanceSettings(): Promise<AttendanceSettings>;
  getSchoolCalendar(): Promise<SchoolCalendarConfig>;
  getScheduleGroups(): Promise<ScheduleGroup[]>;
  getAdminRecipients(): Promise<Recipient[]>;
  /** Active students with a tardy between startDate and endDate (inclusive). */
  getTardyCandidates(input: {
    startDate: string;
    endDate: string;
  }): Promise<TardyCandidate[]>;
};

type AlertDeps = {
  database?: AttendanceAlertDatabase;
  sendSms?: (input: SendSmsInput) => Promise<SmsResult>;
};

type TardyAlertInput = {
  date: string;
};

type AlertResult = {
  checked: boolean;
  students: number;
  messages: number;
};

type GuardianLinkRow = {
  student_id: string;
  guardians:
    | {
        full_name: string;
        phone: string | null;
      }
    | {
        full_name: string;
        phone: string | null;
      }[]
    | null;
};

type TardyStudent = {
  id: string;
  first_name: string;
  last_name: string;
  schedule_group_id: string | null;
  enrollment_status: string;
};

type TardyRow = {
  student_id: string;
  date: string;
  students: TardyStudent | TardyStudent[] | null;
};

function firstRelated<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function studentName(student: Pick<AttendanceAlertStudent, "first_name" | "last_name">) {
  return `${student.first_name} ${student.last_name}`.trim();
}

function schoolDateParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHOOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

export function todayInSchoolTimeZone(now = new Date()) {
  return schoolDateParts(now).date;
}

function addDays(date: string, days: number): string {
  const cursor = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

/**
 * Students at or over the tardy threshold on `date`. Each student's tardies are
 * counted over *their own* last TARDY_WINDOW_SCHOOL_DAYS expected days (their
 * schedule group's weekdays, or the school-wide pattern if ungrouped), so
 * tardies on days only their group attends count. Only students expected on
 * `date` are returned — the check runs on the days they attend.
 */
export function studentsAtTardyThreshold(input: {
  date: string;
  candidates: TardyCandidate[];
  groups: ScheduleGroup[];
  calendar: SchoolCalendarConfig;
  defaults: DefaultSchedule;
  tardiesPerWeek: number;
}): TardyThresholdStudent[] {
  const groupsById = new Map(input.groups.map((group) => [group.id, group]));
  const result: TardyThresholdStudent[] = [];

  for (const candidate of input.candidates) {
    const group = candidate.groupId ? groupsById.get(candidate.groupId) ?? null : null;
    const today = scheduleForDate(input.date, group, input.calendar, input.defaults);
    // Not expected today, or a special day has paused parent texts.
    if (!today || !today.parentAlerts) continue;

    const window = new Set(
      expectedDatesEnding(
        input.date,
        TARDY_WINDOW_SCHOOL_DAYS,
        group,
        input.calendar,
        input.defaults,
        TARDY_LOOKBACK_MAX_DAYS,
      ),
    );
    const tardyCount = new Set(
      candidate.tardyDates.filter((date) => window.has(date)),
    ).size;
    if (tardyCount < input.tardiesPerWeek) continue;

    result.push({
      id: candidate.id,
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      guardians: candidate.guardians,
      tardyCount,
    });
  }

  return result;
}

async function guardianMapForStudents(studentIds: string[]) {
  if (studentIds.length === 0) return new Map<string, GuardianRecipient[]>();

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("student_guardians")
    .select("student_id, guardians(full_name, phone)")
    .in("student_id", studentIds);

  if (error) throw new Error(error.message);

  const map = new Map<string, GuardianRecipient[]>();
  for (const row of (data ?? []) as GuardianLinkRow[]) {
    const guardian = firstRelated(row.guardians);
    if (!guardian?.phone) continue;
    const guardians = map.get(row.student_id) ?? [];
    guardians.push({ full_name: guardian.full_name, phone: guardian.phone });
    map.set(row.student_id, guardians);
  }
  return map;
}

export function createSupabaseAttendanceAlertDatabase(): AttendanceAlertDatabase {
  const supabase = createServiceClient();

  return {
    async getAttendanceSettings() {
      const { data, error } = await supabase
        .from("settings")
        .select("school_start, tardy_window_hours, tardies_per_week")
        .eq("id", 1)
        .single();

      if (error) throw new Error(error.message);
      return {
        schoolStart: String(data.school_start),
        tardyWindowHours: Number(data.tardy_window_hours),
        tardiesPerWeek: Number(data.tardies_per_week),
      };
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
    getScheduleGroups: getServiceScheduleGroups,
    async getTardyCandidates({ startDate, endDate }) {
      const { data, error } = await supabase
        .from("attendance")
        .select(
          "student_id, date, students(id, first_name, last_name, schedule_group_id, enrollment_status)",
        )
        .eq("status", "tardy")
        .gte("date", startDate)
        .lte("date", endDate);

      if (error) throw new Error(error.message);

      const byStudent = new Map<string, { student: TardyStudent; dates: string[] }>();
      for (const row of (data ?? []) as TardyRow[]) {
        const student = firstRelated(row.students);
        if (!student || student.enrollment_status !== "active") continue;
        const entry = byStudent.get(row.student_id) ?? { student, dates: [] };
        entry.dates.push(String(row.date).slice(0, 10));
        byStudent.set(row.student_id, entry);
      }

      const guardianMap = await guardianMapForStudents(Array.from(byStudent.keys()));

      return Array.from(byStudent.entries()).map(([studentId, { student, dates }]) => ({
        id: student.id,
        first_name: student.first_name,
        last_name: student.last_name,
        groupId: student.schedule_group_id,
        guardians: guardianMap.get(studentId) ?? [],
        tardyDates: dates,
      }));
    },
  };
}

export async function checkTardyThresholdAlerts(
  input: TardyAlertInput,
  deps: AlertDeps = {},
): Promise<AlertResult> {
  const database = deps.database ?? createSupabaseAttendanceAlertDatabase();
  const send = deps.sendSms ?? sendSms;
  const [settings, calendar, groups, candidates] = await Promise.all([
    database.getAttendanceSettings(),
    database.getSchoolCalendar(),
    database.getScheduleGroups(),
    database.getTardyCandidates({
      startDate: addDays(input.date, -TARDY_LOOKBACK_MAX_DAYS),
      endDate: input.date,
    }),
  ]);

  const students = studentsAtTardyThreshold({
    date: input.date,
    candidates,
    groups,
    calendar,
    defaults: {
      schoolStart: settings.schoolStart.slice(0, 5),
      tardyWindowHours: settings.tardyWindowHours,
    },
    tardiesPerWeek: settings.tardiesPerWeek,
  });
  const messages: SendSmsInput[] = [];

  for (const student of students) {
    const body = `${studentName(student)} has ${student.tardyCount} tardies in their last ${TARDY_WINDOW_SCHOOL_DAYS} school days, meeting the ControlPad threshold of ${settings.tardiesPerWeek}. Please contact Salaam Institute if you have questions.`;
    for (const guardian of student.guardians) {
      messages.push({
        recipientPhone: guardian.phone,
        recipientType: "parent",
        studentId: student.id,
        triggerType: "tardy_threshold",
        body,
        dedupeWindowHours: 24 * 7,
      });
    }
  }

  await Promise.all(messages.map((message) => send(message)));

  return { checked: true, students: students.length, messages: messages.length };
}
