import {
  isoWeekKey,
  paceForCourse,
  type CourseDates,
  type PaceContext,
} from "@/lib/grades/pace";
import { loadPaceContext } from "@/lib/grades/pace-data";
import { easternDateKey } from "@/lib/grades/sweep";
import { sendSms, type SendSmsInput, type SmsResult } from "@/lib/sms/send-sms";
import { createServiceClient } from "@/lib/supabase/server";

// Event-based alerts for course pace and missing assignments. Called after a
// grade snapshot is saved; every text goes through sendSms() (which logs it and
// dedupes), keyed by course + ISO week so a course texts at most weekly.

type Recipient = { full_name: string; phone: string | null };

export type PaceAlertDatabase = {
  getAdminRecipients(): Promise<Recipient[]>;
  getGuardianRecipients(studentId: string): Promise<Recipient[]>;
};

export type PaceAlertInput = {
  studentId: string;
  studentName: string;
  courseId: string;
  courseName: string;
  /** The student's schedule group (null = none). */
  groupId: string | null;
  course: CourseDates;
  /** The snapshot just saved (after carry-forward). */
  percentComplete: number | null;
  missingAssignments: number | null;
};

export type PaceAlertDeps = {
  database?: PaceAlertDatabase;
  sendSms?: (input: SendSmsInput) => Promise<SmsResult>;
  /** Pass a preloaded context when alerting for many snapshots in a row. */
  context?: PaceContext;
  now?: Date;
};

export type PaceAlertResult = {
  paceAlerted: boolean;
  missingAlerted: boolean;
  recipients: number;
};

export function createSupabasePaceAlertDatabase(): PaceAlertDatabase {
  const supabase = createServiceClient();

  return {
    async getAdminRecipients() {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("role", "admin")
        .not("phone", "is", null);
      if (error) throw new Error(error.message);
      return (data ?? []) as Recipient[];
    },
    async getGuardianRecipients(studentId) {
      const { data, error } = await supabase
        .from("student_guardians")
        .select("guardians(full_name, phone)")
        .eq("student_id", studentId);
      if (error) throw new Error(error.message);
      return (data ?? [])
        .map((row) => {
          const guardian = row.guardians;
          return (Array.isArray(guardian) ? guardian[0] : guardian) as
            | Recipient
            | undefined;
        })
        .filter((guardian): guardian is Recipient => Boolean(guardian?.phone));
    },
  };
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "Your student";
}

export function paceBehindMessage(input: {
  studentName: string;
  courseName: string;
  actual: number;
  expected: number;
}): string {
  const name = firstName(input.studentName);
  return `Salaam Institute: ${name} is behind in ${input.courseName} (${Math.round(
    input.actual,
  )}% done, should be about ${Math.round(input.expected)}%). Please check in with ${name}.`;
}

export function missingAssignmentsMessage(input: {
  studentName: string;
  courseName: string;
  missing: number;
}): string {
  return `Salaam Institute: ${firstName(input.studentName)} has ${input.missing} missing assignment${
    input.missing === 1 ? "" : "s"
  } in ${input.courseName}.`;
}

export async function checkPaceAlerts(
  input: PaceAlertInput,
  deps: PaceAlertDeps = {},
): Promise<PaceAlertResult> {
  const send = deps.sendSms ?? sendSms;
  const context = deps.context ?? (await loadPaceContext({ service: true }));
  const today = easternDateKey(deps.now ?? new Date());
  const week = isoWeekKey(today);

  const evaluation = paceForCourse(
    context,
    today,
    input.groupId,
    input.course,
    {
      percentComplete: input.percentComplete,
      missingAssignments: input.missingAssignments,
    },
  );

  const behind =
    evaluation.gap !== null &&
    evaluation.expected !== null &&
    evaluation.actual !== null &&
    evaluation.gap >= context.paceGapThreshold;
  const missingTooMany =
    input.missingAssignments !== null &&
    input.missingAssignments >= context.missingAssignmentsThreshold;

  if (!behind && !missingTooMany) {
    return { paceAlerted: false, missingAlerted: false, recipients: 0 };
  }

  const database = deps.database ?? createSupabasePaceAlertDatabase();
  const [admins, guardians] = await Promise.all([
    database.getAdminRecipients(),
    database.getGuardianRecipients(input.studentId),
  ]);
  const recipients = [
    ...admins.map((r) => ({ phone: r.phone, type: "admin" as const })),
    ...guardians.map((r) => ({ phone: r.phone, type: "parent" as const })),
  ].filter((r): r is { phone: string; type: "admin" | "parent" } => Boolean(r.phone));

  const sends: Promise<SmsResult>[] = [];
  if (behind) {
    const body = paceBehindMessage({
      studentName: input.studentName,
      courseName: input.courseName,
      actual: evaluation.actual as number,
      expected: evaluation.expected as number,
    });
    for (const r of recipients) {
      sends.push(
        send({
          recipientPhone: r.phone,
          recipientType: r.type,
          studentId: input.studentId,
          triggerType: "pace_behind",
          body,
          dedupeKey: `pace_behind:${input.courseId}:${week}`,
        }),
      );
    }
  }
  if (missingTooMany) {
    const body = missingAssignmentsMessage({
      studentName: input.studentName,
      courseName: input.courseName,
      missing: input.missingAssignments as number,
    });
    for (const r of recipients) {
      sends.push(
        send({
          recipientPhone: r.phone,
          recipientType: r.type,
          studentId: input.studentId,
          triggerType: "missing_assignments",
          body,
          dedupeKey: `missing_assignments:${input.courseId}:${week}`,
        }),
      );
    }
  }
  await Promise.all(sends);

  return {
    paceAlerted: behind && recipients.length > 0,
    missingAlerted: missingTooMany && recipients.length > 0,
    recipients: recipients.length,
  };
}
