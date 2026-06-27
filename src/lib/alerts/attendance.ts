import { createServiceClient } from "@/lib/supabase/server";
import { sendSms, type SendSmsInput, type SmsResult } from "@/lib/sms/send-sms";

const SCHOOL_TIME_ZONE = "America/New_York";

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

export type AttendanceSettings = {
  schoolStart: string;
  tardyWindowHours: number;
  tardiesPerWeek: number;
};

export type AttendanceAlertDatabase = {
  getAttendanceSettings(): Promise<AttendanceSettings>;
  getAdminRecipients(): Promise<Recipient[]>;
  getAbsentStudentsForDate(date: string): Promise<AttendanceAlertStudent[]>;
  getStudentsAtTardyThreshold(input: {
    endDate: string;
    tardiesPerWeek: number;
  }): Promise<TardyThresholdStudent[]>;
};

type AlertDeps = {
  database?: AttendanceAlertDatabase;
  sendSms?: (input: SendSmsInput) => Promise<SmsResult>;
};

type AbsenceAlertInput = {
  date: string;
  now?: Date;
};

type TardyAlertInput = {
  date: string;
};

type AlertResult = {
  checked: boolean;
  students: number;
  messages: number;
};

type AttendanceRow = {
  student_id: string;
  students:
    | {
        id: string;
        first_name: string;
        last_name: string;
      }
    | {
        id: string;
        first_name: string;
        last_name: string;
      }[]
    | null;
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

type TardyRow = {
  student_id: string;
  students:
    | {
        id: string;
        first_name: string;
        last_name: string;
      }
    | {
        id: string;
        first_name: string;
        last_name: string;
      }[]
    | null;
};

function firstRelated<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function studentName(student: Pick<AttendanceAlertStudent, "first_name" | "last_name">) {
  return `${student.first_name} ${student.last_name}`.trim();
}

function parseTimeToMinutes(time: string) {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
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

function hasAbsenceWindowOpened(input: {
  date: string;
  now: Date;
  schoolStart: string;
  tardyWindowHours: number;
}) {
  const current = schoolDateParts(input.now);
  if (current.date > input.date) return true;
  if (current.date < input.date) return false;

  const windowMinutes =
    parseTimeToMinutes(input.schoolStart) + input.tardyWindowHours * 60;
  return current.minutes >= windowMinutes;
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
    async getAdminRecipients() {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("role", "admin")
        .not("phone", "is", null);

      if (error) throw new Error(error.message);
      return (data ?? []) as Recipient[];
    },
    async getAbsentStudentsForDate(date) {
      const { data, error } = await supabase
        .from("attendance")
        .select("student_id, students(id, first_name, last_name)")
        .eq("date", date)
        .eq("status", "absent");

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as AttendanceRow[];
      const guardianMap = await guardianMapForStudents(
        rows.map((row) => row.student_id),
      );

      return rows
        .map((row) => {
          const student = firstRelated(row.students);
          if (!student) return null;
          return {
            id: student.id,
            first_name: student.first_name,
            last_name: student.last_name,
            guardians: guardianMap.get(student.id) ?? [],
          };
        })
        .filter((student): student is AttendanceAlertStudent => Boolean(student));
    },
    async getStudentsAtTardyThreshold({ endDate, tardiesPerWeek }) {
      const start = new Date(`${endDate}T00:00:00.000Z`);
      start.setUTCDate(start.getUTCDate() - 6);
      const startDate = start.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("attendance")
        .select("student_id, students(id, first_name, last_name)")
        .eq("status", "tardy")
        .gte("date", startDate)
        .lte("date", endDate);

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as TardyRow[];
      const counts = new Map<string, { count: number; row: TardyRow }>();
      for (const row of rows) {
        const current = counts.get(row.student_id);
        counts.set(row.student_id, {
          count: (current?.count ?? 0) + 1,
          row: current?.row ?? row,
        });
      }

      const thresholdRows = Array.from(counts.entries()).filter(
        ([, value]) => value.count >= tardiesPerWeek,
      );
      const guardianMap = await guardianMapForStudents(
        thresholdRows.map(([studentId]) => studentId),
      );

      return thresholdRows
        .map(([studentId, value]) => {
          const student = firstRelated(value.row.students);
          if (!student) return null;
          return {
            id: student.id,
            first_name: student.first_name,
            last_name: student.last_name,
            guardians: guardianMap.get(studentId) ?? [],
            tardyCount: value.count,
          };
        })
        .filter((student): student is TardyThresholdStudent => Boolean(student));
    },
  };
}

export async function checkAbsenceAlerts(
  input: AbsenceAlertInput,
  deps: AlertDeps = {},
): Promise<AlertResult> {
  const database = deps.database ?? createSupabaseAttendanceAlertDatabase();
  const send = deps.sendSms ?? sendSms;
  const settings = await database.getAttendanceSettings();

  if (
    !hasAbsenceWindowOpened({
      date: input.date,
      now: input.now ?? new Date(),
      schoolStart: settings.schoolStart,
      tardyWindowHours: settings.tardyWindowHours,
    })
  ) {
    return { checked: false, students: 0, messages: 0 };
  }

  const [students, admins] = await Promise.all([
    database.getAbsentStudentsForDate(input.date),
    database.getAdminRecipients(),
  ]);
  const messages: SendSmsInput[] = [];

  for (const student of students) {
    const body = `${studentName(student)} is still marked absent for ${input.date}. Please review attendance in ControlPad.`;
    for (const guardian of student.guardians) {
      messages.push({
        recipientPhone: guardian.phone,
        recipientType: "parent",
        studentId: student.id,
        triggerType: "absence",
        body,
        dedupeWindowHours: 24,
      });
    }
    for (const admin of admins) {
      if (!admin.phone) continue;
      messages.push({
        recipientPhone: admin.phone,
        recipientType: "admin",
        studentId: student.id,
        triggerType: "absence",
        body,
        dedupeWindowHours: 24,
      });
    }
  }

  await Promise.all(messages.map((message) => send(message)));

  return { checked: true, students: students.length, messages: messages.length };
}

export async function checkTardyThresholdAlerts(
  input: TardyAlertInput,
  deps: AlertDeps = {},
): Promise<AlertResult> {
  const database = deps.database ?? createSupabaseAttendanceAlertDatabase();
  const send = deps.sendSms ?? sendSms;
  const settings = await database.getAttendanceSettings();
  const students = await database.getStudentsAtTardyThreshold({
    endDate: input.date,
    tardiesPerWeek: settings.tardiesPerWeek,
  });
  const messages: SendSmsInput[] = [];

  for (const student of students) {
    const body = `${studentName(student)} has ${student.tardyCount} tardies in the last 7 days, meeting the ControlPad threshold of ${settings.tardiesPerWeek}. Please contact Salaam Institute if you have questions.`;
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
