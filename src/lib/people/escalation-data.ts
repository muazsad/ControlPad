import { createClient } from "@/lib/supabase/server";
import {
  ESCALATION_WINDOW_DAYS,
  computeStudentEscalations,
  type EscalationAttendanceEntry,
  type EscalationNotificationEntry,
  type EscalationPaymentEntry,
  type EscalationStudentInput,
  type EscalationStudentResult,
} from "@/lib/people/escalation";
import { periodMonthFor, paymentDueDate } from "@/lib/alerts/payment-overdue";
import { getSchoolCalendar } from "@/lib/schedule/calendar-data";
import { schoolDayWindowEnding } from "@/lib/schedule/calendar";

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  created_at: string | null;
};

type GradeRow = {
  student_id: string;
  course_id: string;
  grade_value: number | string;
  recorded_at: string;
};

type AttendanceRow = {
  student_id: string;
  date: string;
  status: "present" | "tardy" | "absent" | "excused";
};

type QuranRow = {
  student_id: string;
  date: string;
  lines_memorized: number | string;
};

type PaymentRow = {
  student_id: string;
  period_month: string;
  status: "paid" | "unpaid";
};

type NotificationRow = {
  student_id: string | null;
  trigger_type: string;
  created_at: string;
};

function studentName(student: StudentRow) {
  return `${student.first_name} ${student.last_name}`.trim();
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(periodMonth: string, months: number) {
  const d = new Date(`${periodMonth}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function duePeriodMonthsInWindow(input: {
  startDate: string;
  asOfDate: string;
  paymentDueDay: number;
}) {
  const months: string[] = [];
  let current = periodMonthFor(input.startDate);
  const end = periodMonthFor(input.asOfDate);

  while (current <= end) {
    const dueDate = paymentDueDate(current, input.paymentDueDay);
    if (dueDate >= input.startDate && dueDate <= input.asOfDate) {
      months.push(current);
    }
    current = addMonths(current, 1);
  }

  return months;
}

function groupByStudent<T extends { student_id: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const existing = map.get(row.student_id) ?? [];
    existing.push(row);
    map.set(row.student_id, existing);
  }
  return map;
}

function earliestDate(values: (string | null | undefined)[]): string | null {
  const dates = values
    .filter((value): value is string => Boolean(value))
    .map(dateOnly)
    .sort();
  return dates[0] ?? null;
}

function enrollmentAnchorFor(input: {
  student: StudentRow;
  payments: PaymentRow[];
  attendance: AttendanceRow[];
  grades: GradeRow[];
  asOfDate: string;
}) {
  if (input.student.created_at) return dateOnly(input.student.created_at);

  // Proxy fallback only: the schema has students.created_at, but if imported
  // data ever lacks it, use the earliest existing school record as enrollment.
  return (
    earliestDate([
      ...input.payments.map((payment) => payment.period_month),
      ...input.attendance.map((record) => record.date),
      ...input.grades.map((grade) => grade.recorded_at),
    ]) ?? periodMonthFor(input.asOfDate)
  );
}

export async function getEscalationStudents(
  asOfDate: string,
): Promise<EscalationStudentResult[]> {
  const supabase = await createClient();
  const endDate = dateOnly(asOfDate);
  const calendar = await getSchoolCalendar();
  const schoolWindow = schoolDayWindowEnding(
    endDate,
    ESCALATION_WINDOW_DAYS,
    calendar,
  );
  const startDate = schoolWindow[0] ?? addDays(endDate, -ESCALATION_WINDOW_DAYS);
  const startIso = `${startDate}T00:00:00.000Z`;

  const [
    settingsResult,
    studentsResult,
    gradesResult,
    attendanceResult,
    quranResult,
    paymentsResult,
    notificationsResult,
  ] = await Promise.all([
    supabase
      .from("settings")
      .select("grade_floor, tardies_per_week, quran_inactivity_days, payment_due_day")
      .eq("id", 1)
      .single(),
    supabase
      .from("students")
      .select("id, first_name, last_name, created_at")
      .eq("enrollment_status", "active")
      .order("last_name", { ascending: true }),
    supabase
      .from("grades")
      .select("student_id, course_id, grade_value, recorded_at")
      .gte("recorded_at", startIso)
      .lte("recorded_at", `${endDate}T23:59:59.999Z`)
      .order("recorded_at", { ascending: true }),
    supabase
      .from("attendance")
      .select("student_id, date, status")
      .gte("date", startDate)
      .lte("date", endDate),
    supabase
      .from("quran_progress")
      .select("student_id, date, lines_memorized")
      .lte("date", endDate)
      .order("date", { ascending: true }),
    supabase
      .from("payments")
      .select("student_id, period_month, status")
      .gte("period_month", periodMonthFor(startDate))
      .lte("period_month", periodMonthFor(endDate)),
    supabase
      .from("notifications")
      .select("student_id, trigger_type, created_at")
      .gte("created_at", startIso)
      .lte("created_at", `${endDate}T23:59:59.999Z`),
  ]);

  if (settingsResult.error) throw new Error(settingsResult.error.message);
  if (studentsResult.error) throw new Error(studentsResult.error.message);
  if (gradesResult.error) throw new Error(gradesResult.error.message);
  if (attendanceResult.error) throw new Error(attendanceResult.error.message);
  if (quranResult.error) throw new Error(quranResult.error.message);
  if (paymentsResult.error) throw new Error(paymentsResult.error.message);
  if (notificationsResult.error) {
    throw new Error(notificationsResult.error.message);
  }

  const settings = {
    asOfDate: endDate,
    gradeFloor: Number(settingsResult.data.grade_floor),
    tardiesPerWeek: Number(settingsResult.data.tardies_per_week),
    quranInactivityDays: Number(settingsResult.data.quran_inactivity_days),
    paymentDueDay: Number(settingsResult.data.payment_due_day),
    calendar,
  };
  const students = (studentsResult.data ?? []) as StudentRow[];
  const gradesByStudent = groupByStudent((gradesResult.data ?? []) as GradeRow[]);
  const attendanceByStudent = groupByStudent(
    (attendanceResult.data ?? []) as AttendanceRow[],
  );
  const quranByStudent = groupByStudent((quranResult.data ?? []) as QuranRow[]);
  const payments = (paymentsResult.data ?? []) as PaymentRow[];
  const notificationsByStudent = groupByStudent(
    ((notificationsResult.data ?? []) as NotificationRow[]).filter(
      (row): row is NotificationRow & { student_id: string } =>
        row.student_id !== null,
    ),
  );
  const dueMonths = duePeriodMonthsInWindow({
    startDate,
    asOfDate: endDate,
    paymentDueDay: settings.paymentDueDay,
  });
  const paymentStatusByStudentPeriod = new Map<string, PaymentRow>();
  for (const payment of payments) {
    paymentStatusByStudentPeriod.set(
      `${payment.student_id}:${payment.period_month}`,
      payment,
    );
  }

  const input: EscalationStudentInput[] = students.map((student) => {
    const studentRawPayments = payments.filter(
      (payment) => payment.student_id === student.id,
    );
    const studentAttendance = attendanceByStudent.get(student.id) ?? [];
    const studentGrades = gradesByStudent.get(student.id) ?? [];
    const enrollmentAnchorDate = enrollmentAnchorFor({
      student,
      payments: studentRawPayments,
      attendance: studentAttendance,
      grades: studentGrades,
      asOfDate: endDate,
    });
    const studentPayments: EscalationPaymentEntry[] = dueMonths.map((periodMonth) => {
      const payment = paymentStatusByStudentPeriod.get(`${student.id}:${periodMonth}`);
      return {
        periodMonth,
        status: payment?.status ?? "unpaid",
      };
    });

    return {
      id: student.id,
      name: studentName(student),
      enrollmentAnchorDate,
      grades: studentGrades.map((grade) => ({
        date: dateOnly(grade.recorded_at),
        courseId: grade.course_id,
        gradeValue: Number(grade.grade_value),
      })),
      attendance: studentAttendance.map(
        (record): EscalationAttendanceEntry => ({
          date: record.date,
          status: record.status,
        }),
      ),
      quranProgress: (quranByStudent.get(student.id) ?? []).map((entry) => ({
        date: entry.date,
        lines_memorized: Number(entry.lines_memorized),
      })),
      payments: studentPayments,
      notifications: (notificationsByStudent.get(student.id) ?? []).map(
        (notification): EscalationNotificationEntry => ({
          createdAt: notification.created_at,
          triggerType: notification.trigger_type,
        }),
      ),
    };
  });

  return computeStudentEscalations(input, settings);
}
