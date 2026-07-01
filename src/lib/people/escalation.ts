import { summarizeQuranProgress } from "@/lib/people/quran-progress";

// ── Tunable constants ────────────────────────────────────────────────────────

/** Rolling history window used for escalation scoring. */
export const ESCALATION_WINDOW_DAYS = 30;

/** One repeated signal at or above this count escalates to critical. */
export const PERSISTENCE_THRESHOLD = 3;

/** Multiple active signals at once escalate to critical. */
export const MULTI_SIGNAL_CRITICAL_COUNT = 2;

/** Total score required for watch level. */
export const WATCH_SCORE_CUTOFF = 1;

/** Total score required for critical level. */
export const CRITICAL_SCORE_CUTOFF = 3;

/** Grade drop in points that counts as a sustained dropping event. */
export const GRADE_DROP_THRESHOLD = 5;

// ── Types ────────────────────────────────────────────────────────────────────

export type EscalationLevel = "ok" | "watch" | "critical";
export type EscalationSignalKey = "grades" | "attendance" | "quran" | "payments";

export type EscalationGradeEntry = {
  date: string;
  courseId: string;
  gradeValue: number;
};

export type EscalationAttendanceEntry = {
  date: string;
  status: "present" | "tardy" | "absent" | "excused";
};

export type EscalationQuranEntry = {
  date: string;
  lines_memorized: number;
};

export type EscalationPaymentEntry = {
  periodMonth: string;
  status: "paid" | "unpaid" | "overdue";
};

export type EscalationNotificationEntry = {
  createdAt: string;
  triggerType: string;
};

export type EscalationStudentInput = {
  id: string;
  name: string;
  grades: EscalationGradeEntry[];
  attendance: EscalationAttendanceEntry[];
  quranProgress: EscalationQuranEntry[];
  payments: EscalationPaymentEntry[];
  notifications: EscalationNotificationEntry[];
};

export type EscalationSettings = {
  asOfDate: string;
  gradeFloor: number;
  tardiesPerWeek: number;
  quranInactivityDays: number;
  paymentDueDay: number;
};

export type EscalationSignalBreakdown = {
  level: EscalationLevel;
  tripped: boolean;
  occurrences: number;
  score: number;
  firstDate: string | null;
  latestDate: string | null;
  durationDays: number;
  details: string;
};

export type GradeEscalationSignal = EscalationSignalBreakdown & {
  belowFloorCount: number;
  droppingTrendCount: number;
};

export type AttendanceEscalationSignal = EscalationSignalBreakdown & {
  absences: number;
  tardies: number;
};

export type QuranEscalationSignal = EscalationSignalBreakdown & {
  pattern: "consistent" | "accelerating" | "irregular" | "stagnant" | null;
  daysSinceLastEntry: number | null;
};

export type PaymentEscalationSignal = EscalationSignalBreakdown & {
  overdueCycles: number;
  maxDaysOverdue: number;
};

export type EscalationStudentResult = {
  studentId: string;
  studentName: string;
  level: EscalationLevel;
  totalScore: number;
  trippedSignalCount: number;
  reasons: string[];
  notificationCount: number;
  signals: {
    grades: GradeEscalationSignal;
    attendance: AttendanceEscalationSignal;
    quran: QuranEscalationSignal;
    payments: PaymentEscalationSignal;
  };
};

// ── Utilities ────────────────────────────────────────────────────────────────

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function dateMs(date: string): number {
  return new Date(`${dateOnly(date)}T00:00:00.000Z`).getTime();
}

function daysBetween(startDate: string, endDate: string): number {
  return Math.floor((dateMs(endDate) - dateMs(startDate)) / (1000 * 60 * 60 * 24));
}

function daysBefore(referenceDate: string, days: number): string {
  const d = new Date(`${dateOnly(referenceDate)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function windowed<T extends { date: string }>(
  rows: T[],
  startDate: string,
  endDate: string,
): T[] {
  return rows.filter((row) => row.date >= startDate && row.date <= endDate);
}

function signalLevel(score: number): EscalationLevel {
  if (score >= CRITICAL_SCORE_CUTOFF) return "critical";
  if (score >= WATCH_SCORE_CUTOFF) return "watch";
  return "ok";
}

function baseSignal(input: {
  occurrences: number;
  score?: number;
  dates: string[];
  asOfDate: string;
  details: string;
}): EscalationSignalBreakdown {
  const score = input.score ?? input.occurrences;
  const sortedDates = [...input.dates].sort();
  const firstDate = sortedDates[0] ?? null;
  const latestDate = sortedDates.at(-1) ?? null;
  return {
    level: signalLevel(score),
    tripped: score >= WATCH_SCORE_CUTOFF,
    occurrences: input.occurrences,
    score,
    firstDate,
    latestDate,
    durationDays: firstDate ? daysBetween(firstDate, input.asOfDate) : 0,
    details: input.details,
  };
}

function paymentDueDate(periodMonth: string, dueDay: number): string {
  const d = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00.000Z`);
  d.setUTCDate(dueDay);
  return d.toISOString().slice(0, 10);
}

// ── Signal scorers ──────────────────────────────────────────────────────────

function gradeSignal(
  grades: EscalationGradeEntry[],
  settings: EscalationSettings,
): GradeEscalationSignal {
  const startDate = daysBefore(settings.asOfDate, ESCALATION_WINDOW_DAYS);
  const recentGrades = windowed(grades, startDate, settings.asOfDate).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const belowFloor = recentGrades.filter((grade) => grade.gradeValue < settings.gradeFloor);

  let droppingTrendCount = 0;
  const droppingDates: string[] = [];
  const byCourse = new Map<string, EscalationGradeEntry[]>();
  for (const grade of recentGrades) {
    const courseGrades = byCourse.get(grade.courseId) ?? [];
    courseGrades.push(grade);
    byCourse.set(grade.courseId, courseGrades);
  }

  for (const courseGrades of byCourse.values()) {
    for (let i = 1; i < courseGrades.length; i += 1) {
      const previous = courseGrades[i - 1];
      const current = courseGrades[i];
      if (previous.gradeValue - current.gradeValue >= GRADE_DROP_THRESHOLD) {
        droppingTrendCount += 1;
        droppingDates.push(current.date);
      }
    }
  }

  const occurrences = belowFloor.length + droppingTrendCount;
  const signal = baseSignal({
    occurrences,
    dates: [...belowFloor.map((grade) => grade.date), ...droppingDates],
    asOfDate: settings.asOfDate,
    details:
      occurrences > 0
        ? `${belowFloor.length} below floor, ${droppingTrendCount} dropping`
        : "No persistent grade issues",
  });

  return {
    ...signal,
    belowFloorCount: belowFloor.length,
    droppingTrendCount,
  };
}

function attendanceSignal(
  attendance: EscalationAttendanceEntry[],
  settings: EscalationSettings,
): AttendanceEscalationSignal {
  const startDate = daysBefore(settings.asOfDate, ESCALATION_WINDOW_DAYS);
  const records = windowed(attendance, startDate, settings.asOfDate);
  const absences = records.filter((record) => record.status === "absent");
  const tardies = records.filter((record) => record.status === "tardy");
  const occurrences = absences.length + tardies.length;
  const score =
    absences.length +
    tardies.length +
    Math.floor(tardies.length / settings.tardiesPerWeek);
  const signal = baseSignal({
    occurrences,
    score,
    dates: [...absences.map((record) => record.date), ...tardies.map((record) => record.date)],
    asOfDate: settings.asOfDate,
    details:
      occurrences > 0
        ? `${absences.length} absent, ${tardies.length} tardy`
        : "No repeated attendance issues",
  });

  return { ...signal, absences: absences.length, tardies: tardies.length };
}

function quranSignal(
  quranProgress: EscalationQuranEntry[],
  settings: EscalationSettings,
): QuranEscalationSignal {
  const startDate = daysBefore(settings.asOfDate, ESCALATION_WINDOW_DAYS);
  const entries = windowed(quranProgress, startDate, settings.asOfDate);
  const summary = summarizeQuranProgress(entries, {
    referenceDate: settings.asOfDate,
  });
  const pattern =
    summary.pattern.status === "classified" ? summary.pattern.pattern : null;
  const daysSinceLastEntry = summary.pattern.daysSinceLastEntry;
  const tripped = pattern === "stagnant" || pattern === "irregular";
  const occurrences =
    pattern === "stagnant" && daysSinceLastEntry !== null
      ? Math.max(1, Math.floor(daysSinceLastEntry / settings.quranInactivityDays))
      : tripped
        ? 1
        : 0;
  const latestDate = entries
    .map((entry) => entry.date)
    .sort()
    .at(-1);
  const signal = baseSignal({
    occurrences,
    dates: latestDate ? [latestDate] : [],
    asOfDate: settings.asOfDate,
    details:
      tripped && daysSinceLastEntry !== null
        ? `${pattern} Quran pattern, ${daysSinceLastEntry} days since last entry`
        : "No persistent Quran slippage",
  });

  return { ...signal, pattern, daysSinceLastEntry };
}

function paymentSignal(
  payments: EscalationPaymentEntry[],
  settings: EscalationSettings,
): PaymentEscalationSignal {
  const startDate = daysBefore(settings.asOfDate, ESCALATION_WINDOW_DAYS);
  const overdue = payments
    .filter((payment) => payment.status !== "paid")
    .map((payment) => ({
      ...payment,
      dueDate: paymentDueDate(payment.periodMonth, settings.paymentDueDay),
    }))
    .filter(
      (payment) =>
        payment.dueDate >= startDate && payment.dueDate <= settings.asOfDate,
    );
  const maxDaysOverdue = overdue.reduce(
    (max, payment) => Math.max(max, daysBetween(payment.dueDate, settings.asOfDate)),
    0,
  );
  const signal = baseSignal({
    occurrences: overdue.length,
    dates: overdue.map((payment) => payment.dueDate),
    asOfDate: settings.asOfDate,
    details:
      overdue.length > 0
        ? `${overdue.length} overdue tuition cycle${overdue.length === 1 ? "" : "s"}`
        : "No repeated tuition issues",
  });

  return { ...signal, overdueCycles: overdue.length, maxDaysOverdue };
}

// ── Public functions ─────────────────────────────────────────────────────────

export function computeStudentEscalations(
  students: EscalationStudentInput[],
  settings: EscalationSettings,
): EscalationStudentResult[] {
  return students
    .map((student) => {
      const signals = {
        grades: gradeSignal(student.grades, settings),
        attendance: attendanceSignal(student.attendance, settings),
        quran: quranSignal(student.quranProgress, settings),
        payments: paymentSignal(student.payments, settings),
      };
      const signalList = Object.entries(signals) as [
        EscalationSignalKey,
        EscalationSignalBreakdown,
      ][];
      const tripped = signalList.filter(([, signal]) => signal.tripped);
      const totalScore = signalList.reduce(
        (sum, [, signal]) => sum + signal.score,
        0,
      );
      const hasPersistentSignal = signalList.some(
        ([, signal]) => signal.occurrences >= PERSISTENCE_THRESHOLD,
      );
      const level: EscalationLevel =
        tripped.length >= MULTI_SIGNAL_CRITICAL_COUNT ||
        hasPersistentSignal ||
        totalScore >= CRITICAL_SCORE_CUTOFF
          ? "critical"
          : totalScore >= WATCH_SCORE_CUTOFF
            ? "watch"
            : "ok";

      return {
        studentId: student.id,
        studentName: student.name,
        level,
        totalScore,
        trippedSignalCount: tripped.length,
        reasons: tripped.map(([key, signal]) => `${key}: ${signal.details}`),
        notificationCount: student.notifications.length,
        signals,
      };
    })
    .sort((a, b) => {
      const levelRank: Record<EscalationLevel, number> = {
        critical: 2,
        watch: 1,
        ok: 0,
      };
      return (
        levelRank[b.level] - levelRank[a.level] ||
        b.totalScore - a.totalScore ||
        a.studentName.localeCompare(b.studentName)
      );
    });
}
