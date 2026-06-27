import { createServiceClient } from "@/lib/supabase/server";
import { sendSms, type SendSmsInput, type SmsResult } from "@/lib/sms/send-sms";

const SCHOOL_TIME_ZONE = "America/New_York";

type AdminRecipient = {
  full_name: string;
  phone: string | null;
};

export type AdminDigestSettings = {
  adminDigestTime: string;
  gradeFloor: number;
  quranInactivityDays: number;
  paymentDueDay: number;
};

export type AttendanceIssue = {
  studentId: string;
  studentName: string;
  status: "absent" | "tardy";
};

export type LowGradeIssue = {
  studentId: string;
  studentName: string;
  courseId: string;
  courseName: string;
  gradeValue: number;
};

export type DroppingGradeIssue = {
  studentId: string;
  studentName: string;
  courseId: string;
  courseName: string;
  currentGrade: number;
  previousGrade: number;
  delta: number;
};

export type QuranSlipIssue = {
  studentId: string;
  studentName: string;
  daysSinceLastLesson: number;
};

export type OverduePaymentIssue = {
  studentId: string;
  studentName: string;
  periodMonth: string;
};

export type AdminDailySummary = {
  date: string;
  settings: AdminDigestSettings;
  absences: AttendanceIssue[];
  tardies: AttendanceIssue[];
  lowGrades: LowGradeIssue[];
  droppingGrades: DroppingGradeIssue[];
  quranSlippage: QuranSlipIssue[];
  overduePayments: OverduePaymentIssue[];
};

export type AdminDigestDatabase = {
  getSummary(date: string): Promise<AdminDailySummary>;
  getAdminRecipients(): Promise<AdminRecipient[]>;
};

type AdminDigestDeps = {
  database?: AdminDigestDatabase;
  sendSms?: (input: SendSmsInput) => Promise<SmsResult>;
};

export type AdminDigestSendResult = {
  sent: boolean;
  skippedReason?: "before_digest_time";
  recipients: number;
  summary: AdminDailySummary;
};

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
};

type AttendanceRow = {
  status: "absent" | "tardy";
  students: StudentRow | StudentRow[] | null;
};

type GradeRow = {
  course_id: string;
  grade_value: number | string;
  recorded_at: string;
  courses:
    | { id: string; name: string }
    | { id: string; name: string }[]
    | null;
  students: StudentRow | StudentRow[] | null;
};

type QuranRow = {
  student_id: string;
  date: string;
};

type PaymentRow = {
  student_id: string;
};

function firstRelated<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function studentName(student: Pick<StudentRow, "first_name" | "last_name">) {
  return `${student.first_name} ${student.last_name}`.trim();
}

function parseTimeToMinutes(time: string) {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

function datePartsInSchoolTimeZone(now: Date) {
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
  return datePartsInSchoolTimeZone(now).date;
}

function hasDigestTimeArrived(input: {
  date: string;
  now: Date;
  adminDigestTime: string;
}) {
  const current = datePartsInSchoolTimeZone(input.now);
  if (current.date > input.date) return true;
  if (current.date < input.date) return false;
  return current.minutes >= parseTimeToMinutes(input.adminDigestTime);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return Math.floor((end - start) / (1000 * 60 * 60 * 24));
}

function periodMonthFor(date: string) {
  return `${date.slice(0, 7)}-01`;
}

function issueCount(summary: AdminDailySummary) {
  return (
    summary.absences.length +
    summary.tardies.length +
    summary.lowGrades.length +
    summary.droppingGrades.length +
    summary.quranSlippage.length +
    summary.overduePayments.length
  );
}

function namesForDigest(summary: AdminDailySummary) {
  const names = [
    ...summary.absences.map((issue) => issue.studentName),
    ...summary.tardies.map((issue) => issue.studentName),
    ...summary.lowGrades.map((issue) => issue.studentName),
    ...summary.droppingGrades.map((issue) => issue.studentName),
    ...summary.quranSlippage.map((issue) => issue.studentName),
    ...summary.overduePayments.map((issue) => issue.studentName),
  ];
  return Array.from(new Set(names)).slice(0, 5);
}

export function createSupabaseAdminDigestDatabase(): AdminDigestDatabase {
  const supabase = createServiceClient();

  return {
    async getSummary(date) {
      const { data: settingsRow, error: settingsError } = await supabase
        .from("settings")
        .select(
          "admin_digest_time, grade_floor, quran_inactivity_days, payment_due_day",
        )
        .eq("id", 1)
        .single();

      if (settingsError) throw new Error(settingsError.message);

      const settings: AdminDigestSettings = {
        adminDigestTime: String(settingsRow.admin_digest_time),
        gradeFloor: Number(settingsRow.grade_floor),
        quranInactivityDays: Number(settingsRow.quran_inactivity_days),
        paymentDueDay: Number(settingsRow.payment_due_day),
      };

      const [
        attendanceResult,
        gradesResult,
        studentsResult,
        quranResult,
        paidPaymentsResult,
      ] = await Promise.all([
        supabase
          .from("attendance")
          .select("status, students(id, first_name, last_name)")
          .eq("date", date)
          .in("status", ["absent", "tardy"]),
        supabase
          .from("grades")
          .select(
            "course_id, grade_value, recorded_at, courses(id, name), students(id, first_name, last_name)",
          )
          .order("recorded_at", { ascending: false }),
        supabase
          .from("students")
          .select("id, first_name, last_name")
          .eq("enrollment_status", "active"),
        supabase
          .from("quran_progress")
          .select("student_id, date")
          .order("date", { ascending: false }),
        supabase
          .from("payments")
          .select("student_id")
          .eq("period_month", periodMonthFor(date))
          .eq("status", "paid"),
      ]);

      if (attendanceResult.error) throw new Error(attendanceResult.error.message);
      if (gradesResult.error) throw new Error(gradesResult.error.message);
      if (studentsResult.error) throw new Error(studentsResult.error.message);
      if (quranResult.error) throw new Error(quranResult.error.message);
      if (paidPaymentsResult.error) {
        throw new Error(paidPaymentsResult.error.message);
      }

      const attendanceIssues = ((attendanceResult.data ?? []) as AttendanceRow[])
        .map((row) => {
          const student = firstRelated(row.students);
          if (!student) return null;
          return {
            studentId: student.id,
            studentName: studentName(student),
            status: row.status,
          };
        })
        .filter((issue): issue is AttendanceIssue => Boolean(issue));

      const latestByCourse = new Map<string, GradeRow[]>();
      for (const row of (gradesResult.data ?? []) as GradeRow[]) {
        const entries = latestByCourse.get(row.course_id) ?? [];
        if (entries.length < 2) {
          entries.push(row);
          latestByCourse.set(row.course_id, entries);
        }
      }

      const lowGrades: LowGradeIssue[] = [];
      const droppingGrades: DroppingGradeIssue[] = [];
      for (const [courseId, entries] of latestByCourse.entries()) {
        const latest = entries[0];
        const previous = entries[1];
        const student = firstRelated(latest.students);
        const course = firstRelated(latest.courses);
        if (!student || !course) continue;

        const currentGrade = Number(latest.grade_value);
        if (currentGrade < settings.gradeFloor) {
          lowGrades.push({
            studentId: student.id,
            studentName: studentName(student),
            courseId,
            courseName: course.name,
            gradeValue: currentGrade,
          });
        }

        if (previous) {
          const previousGrade = Number(previous.grade_value);
          const delta = currentGrade - previousGrade;
          if (delta < 0) {
            droppingGrades.push({
              studentId: student.id,
              studentName: studentName(student),
              courseId,
              courseName: course.name,
              currentGrade,
              previousGrade,
              delta,
            });
          }
        }
      }

      const students = (studentsResult.data ?? []) as StudentRow[];
      const latestQuranDate = new Map<string, string>();
      for (const row of (quranResult.data ?? []) as QuranRow[]) {
        if (!latestQuranDate.has(row.student_id)) {
          latestQuranDate.set(row.student_id, row.date);
        }
      }

      const cutoff = isoDate(
        addDays(new Date(`${date}T00:00:00.000Z`), -settings.quranInactivityDays),
      );
      const quranSlippage = students
        .filter((student) => {
          const latest = latestQuranDate.get(student.id);
          return !latest || latest < cutoff;
        })
        .map((student) => {
          const latest = latestQuranDate.get(student.id);
          return {
            studentId: student.id,
            studentName: studentName(student),
            daysSinceLastLesson: latest
              ? daysBetween(latest, date)
              : settings.quranInactivityDays + 1,
          };
        });

      const dayOfMonth = Number(date.slice(8, 10));
      const paidStudentIds = new Set(
        ((paidPaymentsResult.data ?? []) as PaymentRow[]).map(
          (row) => row.student_id,
        ),
      );
      const overduePayments =
        dayOfMonth > settings.paymentDueDay
          ? students
              .filter((student) => !paidStudentIds.has(student.id))
              .map((student) => ({
                studentId: student.id,
                studentName: studentName(student),
                periodMonth: periodMonthFor(date),
              }))
          : [];

      return {
        date,
        settings,
        absences: attendanceIssues.filter((issue) => issue.status === "absent"),
        tardies: attendanceIssues.filter((issue) => issue.status === "tardy"),
        lowGrades,
        droppingGrades,
        quranSlippage,
        overduePayments,
      };
    },

    async getAdminRecipients() {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("role", "admin")
        .not("phone", "is", null);

      if (error) throw new Error(error.message);
      return (data ?? []) as AdminRecipient[];
    },
  };
}

export async function getAdminDailySummary(
  asOfDate: string,
  deps: AdminDigestDeps = {},
) {
  const database = deps.database ?? createSupabaseAdminDigestDatabase();
  return database.getSummary(asOfDate);
}

export function formatAdminDigestSms(summary: AdminDailySummary) {
  const counts =
    `Absences ${summary.absences.length}, Tardies ${summary.tardies.length}, ` +
    `Low grades ${summary.lowGrades.length}, Dropping ${summary.droppingGrades.length}, ` +
    `Quran ${summary.quranSlippage.length}, Payments ${summary.overduePayments.length}.`;
  const names = namesForDigest(summary);
  const details =
    names.length > 0
      ? ` Review: ${names.join(", ")}${issueCount(summary) > names.length ? ", and more" : ""}.`
      : " All clear.";

  return `ControlPad daily summary for ${summary.date}: ${counts}${details}`;
}

export async function sendAdminDigest(
  input: { date: string; force?: boolean; now?: Date },
  deps: AdminDigestDeps = {},
): Promise<AdminDigestSendResult> {
  const database = deps.database ?? createSupabaseAdminDigestDatabase();
  const send = deps.sendSms ?? sendSms;
  const summary = await database.getSummary(input.date);

  if (
    !input.force &&
    !hasDigestTimeArrived({
      date: input.date,
      now: input.now ?? new Date(),
      adminDigestTime: summary.settings.adminDigestTime,
    })
  ) {
    return {
      sent: false,
      skippedReason: "before_digest_time",
      recipients: 0,
      summary,
    };
  }

  const admins = (await database.getAdminRecipients()).filter(
    (admin): admin is { full_name: string; phone: string } => Boolean(admin.phone),
  );
  const body = formatAdminDigestSms(summary);

  await Promise.all(
    admins.map((admin) =>
      send({
        recipientPhone: admin.phone,
        recipientType: "admin",
        studentId: null,
        triggerType: "admin_digest",
        body,
        dedupeWindowHours: 24,
      }),
    ),
  );

  return { sent: true, recipients: admins.length, summary };
}
