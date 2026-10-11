import { createServiceClient } from "@/lib/supabase/server";
import { sendSms, type SendSmsInput, type SmsResult } from "@/lib/sms/send-sms";
import { computeOverduePaymentCycles } from "@/lib/alerts/payment-overdue";
import { evaluateQuranInactivity } from "@/lib/alerts/quran";
import { getServiceSchoolCalendar } from "@/lib/schedule/calendar-data";
import {
  dayType,
  isSchoolDay,
  type CalendarDayType,
  type SchoolCalendarConfig,
} from "@/lib/schedule/calendar";
import { getServiceScheduleGroups } from "@/lib/schedule/schedule-groups-data";
import {
  scheduleForDate,
  timeToMinutes,
  type DefaultSchedule,
  type ScheduleGroup,
} from "@/lib/schedule/student-schedule";

const SCHOOL_TIME_ZONE = "America/New_York";

export const GRADE_DROP_THRESHOLD = 5;

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

/** Expected today (per schedule group) but no attendance record yet. */
export type UnmarkedIssue = {
  studentId: string;
  studentName: string;
  /** "HH:MM" — they count as unmarked once this time has passed. */
  tardyCutoffTime: string;
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
  schoolDayType: CalendarDayType;
  settings: AdminDigestSettings;
  absences: AttendanceIssue[];
  tardies: AttendanceIssue[];
  unmarked: UnmarkedIssue[];
  lowGrades: LowGradeIssue[];
  droppingGrades: DroppingGradeIssue[];
  quranSlippage: QuranSlipIssue[];
  overduePayments: OverduePaymentIssue[];
};

export type AdminDigestDatabase = {
  /** `now` limits "unmarked" to students whose tardy cutoff has passed. */
  getSummary(date: string, now?: Date): Promise<AdminDailySummary>;
  getAdminRecipients(): Promise<AdminRecipient[]>;
};

type AdminDigestDeps = {
  database?: AdminDigestDatabase;
  sendSms?: (input: SendSmsInput) => Promise<SmsResult>;
};

export type AdminDigestSendResult = {
  sent: boolean;
  skippedReason?: "before_digest_time" | "no_school";
  recipients: number;
  summary: AdminDailySummary;
};

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  created_at?: string | null;
  schedule_group_id?: string | null;
};

type AttendanceRow = {
  student_id: string;
  status: "present" | "absent" | "tardy" | "excused";
  students: StudentRow | StudentRow[] | null;
};

export type GradeIssueRow = {
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
  period_month: string;
  status: "paid" | "unpaid";
};

export type GradeIssueSummary = {
  lowGrades: LowGradeIssue[];
  droppingGrades: DroppingGradeIssue[];
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

/**
 * Students expected on `date` (per their schedule group, or the school-wide
 * pattern) with no attendance record. When `nowMinutes` is given, only those
 * whose tardy cutoff has passed are included, so the morning dashboard doesn't
 * list everyone before they've had a chance to arrive.
 */
export function findUnmarkedStudents(input: {
  date: string;
  nowMinutes: number | null;
  students: { id: string; name: string; groupId: string | null }[];
  markedStudentIds: ReadonlySet<string>;
  groups: ScheduleGroup[];
  calendar: SchoolCalendarConfig;
  defaults: DefaultSchedule;
}): UnmarkedIssue[] {
  const groupsById = new Map(input.groups.map((group) => [group.id, group]));
  const result: UnmarkedIssue[] = [];
  for (const student of input.students) {
    if (input.markedStudentIds.has(student.id)) continue;
    const group = student.groupId ? groupsById.get(student.groupId) ?? null : null;
    const schedule = scheduleForDate(input.date, group, input.calendar, input.defaults);
    if (!schedule) continue;
    if (
      input.nowMinutes !== null &&
      input.nowMinutes <= timeToMinutes(schedule.tardyCutoffTime)
    ) {
      continue;
    }
    result.push({
      studentId: student.id,
      studentName: student.name,
      tardyCutoffTime: schedule.tardyCutoffTime,
    });
  }
  return result.sort((a, b) => a.studentName.localeCompare(b.studentName));
}

function periodMonthFor(date: string) {
  return `${date.slice(0, 7)}-01`;
}

function issueCount(summary: AdminDailySummary) {
  return (
    summary.absences.length +
    summary.tardies.length +
    summary.unmarked.length +
    summary.lowGrades.length +
    summary.droppingGrades.length +
    summary.quranSlippage.length +
    summary.overduePayments.length
  );
}

export function summarizeGradeIssues(
  gradeRows: GradeIssueRow[],
  gradeFloor: number,
): GradeIssueSummary {
  const latestByCourse = new Map<string, GradeIssueRow[]>();
  for (const row of gradeRows) {
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
    if (currentGrade < gradeFloor) {
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
      if (delta <= -GRADE_DROP_THRESHOLD) {
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

  return { lowGrades, droppingGrades };
}

function namesForDigest(summary: AdminDailySummary) {
  const names = [
    ...summary.absences.map((issue) => issue.studentName),
    ...summary.tardies.map((issue) => issue.studentName),
    ...summary.unmarked.map((issue) => issue.studentName),
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
    async getSummary(date, now) {
      const { data: settingsRow, error: settingsError } = await supabase
        .from("settings")
        .select(
          "admin_digest_time, grade_floor, quran_inactivity_days, payment_due_day, school_start, tardy_window_hours",
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
      const [calendar, groups] = await Promise.all([
        getServiceSchoolCalendar(),
        getServiceScheduleGroups(),
      ]);
      const schoolDayType = dayType(date, calendar);
      const schoolIsInSession = isSchoolDay(date, calendar);

      const [
        attendanceResult,
        gradesResult,
        studentsResult,
        quranResult,
        paidPaymentsResult,
      ] = await Promise.all([
        // Not gated on the school-wide calendar: grouped students may attend
        // on days the rest of the school is off (e.g. a Quran-only Friday).
        supabase
          .from("attendance")
          .select("student_id, status, students(id, first_name, last_name)")
          .eq("date", date),
        supabase
          .from("grades")
          .select(
            "course_id, grade_value, recorded_at, courses(id, name), students(id, first_name, last_name)",
          )
          .order("recorded_at", { ascending: false }),
        supabase
          .from("students")
          .select("id, first_name, last_name, created_at, schedule_group_id")
          .eq("enrollment_status", "active"),
        supabase
          .from("quran_progress")
          .select("student_id, date")
          .order("date", { ascending: false }),
        supabase
          .from("payments")
          .select("student_id, period_month, status")
          .eq("period_month", periodMonthFor(date))
      ]);

      if (attendanceResult.error) throw new Error(attendanceResult.error.message);
      if (gradesResult.error) throw new Error(gradesResult.error.message);
      if (studentsResult.error) throw new Error(studentsResult.error.message);
      if (quranResult.error) throw new Error(quranResult.error.message);
      if (paidPaymentsResult.error) {
        throw new Error(paidPaymentsResult.error.message);
      }

      const attendanceRows = (attendanceResult.data ?? []) as AttendanceRow[];
      const attendanceIssues = attendanceRows
        .map((row) => {
          const student = firstRelated(row.students);
          if (!student || (row.status !== "absent" && row.status !== "tardy")) {
            return null;
          }
          return {
            studentId: student.id,
            studentName: studentName(student),
            status: row.status,
          };
        })
        .filter((issue): issue is AttendanceIssue => Boolean(issue));

      const { lowGrades, droppingGrades } = summarizeGradeIssues(
        (gradesResult.data ?? []) as GradeIssueRow[],
        settings.gradeFloor,
      );

      const students = (studentsResult.data ?? []) as StudentRow[];

      const clock = now ? datePartsInSchoolTimeZone(now) : null;
      const unmarked = findUnmarkedStudents({
        date,
        // Today: only past each student's cutoff. Past dates: everyone unmarked.
        nowMinutes: clock && clock.date === date ? clock.minutes : null,
        students: students.map((student) => ({
          id: student.id,
          name: studentName(student),
          groupId: student.schedule_group_id ?? null,
        })),
        markedStudentIds: new Set(attendanceRows.map((row) => row.student_id)),
        groups,
        calendar,
        defaults: {
          schoolStart: String(settingsRow.school_start).slice(0, 5),
          tardyWindowHours: Number(settingsRow.tardy_window_hours),
        },
      });

      const latestQuranDate = new Map<string, string>();
      for (const row of (quranResult.data ?? []) as QuranRow[]) {
        if (!latestQuranDate.has(row.student_id)) {
          latestQuranDate.set(row.student_id, row.date);
        }
      }

      const quranSlippage = schoolIsInSession
        ? students
            .filter((student) => {
              const latest = latestQuranDate.get(student.id);
              return evaluateQuranInactivity({
                lastLessonDate: latest ?? null,
                asOfDate: date,
                inactivitySchoolDays: settings.quranInactivityDays,
                calendar,
              }).slipping;
            })
            .map((student) => {
              const latest = latestQuranDate.get(student.id);
              return {
                studentId: student.id,
                studentName: studentName(student),
                daysSinceLastLesson: evaluateQuranInactivity({
                  lastLessonDate: latest ?? null,
                  asOfDate: date,
                  inactivitySchoolDays: settings.quranInactivityDays,
                  calendar,
                }).schoolDaysSinceLastLesson,
              };
            })
        : [];

      const paymentRows = (paidPaymentsResult.data ?? []) as PaymentRow[];
      const paymentByStudent = new Map(
        paymentRows.map((payment) => [payment.student_id, payment]),
      );
      const currentPeriodMonth = periodMonthFor(date);
      const overduePayments = students
        .filter((student) => {
          const payment = paymentByStudent.get(student.id);
          return (
            computeOverduePaymentCycles({
              asOfDate: date,
              paymentDueDay: settings.paymentDueDay,
              enrollmentAnchorDate: student.created_at ?? null,
              cycles: [
                {
                  periodMonth: currentPeriodMonth,
                  status: payment?.status ?? "unpaid",
                },
              ],
            }).length > 0
          );
        })
        .map((student) => ({
          studentId: student.id,
          studentName: studentName(student),
          periodMonth: currentPeriodMonth,
        }));

      return {
        date,
        schoolDayType,
        settings,
        absences: attendanceIssues.filter((issue) => issue.status === "absent"),
        tardies: attendanceIssues.filter((issue) => issue.status === "tardy"),
        unmarked,
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
  deps: AdminDigestDeps & { now?: Date } = {},
) {
  const database = deps.database ?? createSupabaseAdminDigestDatabase();
  return database.getSummary(asOfDate, deps.now);
}

export function formatAdminDigestSms(summary: AdminDailySummary) {
  const schoolNote =
    summary.schoolDayType === "off"
      ? " No school today."
      : summary.schoolDayType === "half"
        ? " Half-day schedule today."
        : "";
  const counts =
    `Absences ${summary.absences.length}, Tardies ${summary.tardies.length}, ` +
    (summary.unmarked.length > 0 ? `Not checked in ${summary.unmarked.length}, ` : "") +
    `Low grades ${summary.lowGrades.length}, Dropping ${summary.droppingGrades.length}, ` +
    `Quran ${summary.quranSlippage.length}, Payments ${summary.overduePayments.length}.`;
  const names = namesForDigest(summary);
  const details =
    names.length > 0
      ? ` Review: ${names.join(", ")}${issueCount(summary) > names.length ? ", and more" : ""}.`
      : " All clear.";

  return `ControlPad daily summary for ${summary.date}:${schoolNote} ${counts}${details}`;
}

export async function sendAdminDigest(
  input: { date: string; force?: boolean; now?: Date },
  deps: AdminDigestDeps = {},
): Promise<AdminDigestSendResult> {
  const database = deps.database ?? createSupabaseAdminDigestDatabase();
  const send = deps.sendSms ?? sendSms;
  const summary = await database.getSummary(input.date, input.now ?? new Date());

  if (!input.force && summary.schoolDayType === "off") {
    return { sent: false, skippedReason: "no_school", recipients: 0, summary };
  }

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
