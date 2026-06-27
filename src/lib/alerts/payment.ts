import { createServiceClient } from "@/lib/supabase/server";
import { sendSms, type SendSmsInput, type SmsResult } from "@/lib/sms/send-sms";

type GuardianRecipient = {
  full_name: string;
  phone: string;
};

type AdminRecipient = {
  full_name: string;
  phone: string | null;
};

export type OverdueStudent = {
  id: string;
  first_name: string;
  last_name: string;
  guardians: GuardianRecipient[];
};

export type PaymentSettings = {
  paymentDueDayOfMonth: number;
};

export type PaymentAlertDatabase = {
  getPaymentSettings(): Promise<PaymentSettings>;
  getAdminRecipients(): Promise<AdminRecipient[]>;
  getOverdueStudents(periodMonth: string): Promise<OverdueStudent[]>;
};

type AlertDeps = {
  database?: PaymentAlertDatabase;
  sendSms?: (input: SendSmsInput) => Promise<SmsResult>;
};

type AlertResult = {
  students: number;
  messages: number;
};

function studentName(s: Pick<OverdueStudent, "first_name" | "last_name">) {
  return `${s.first_name} ${s.last_name}`.trim();
}

export function createSupabasePaymentAlertDatabase(): PaymentAlertDatabase {
  const supabase = createServiceClient();

  return {
    async getPaymentSettings() {
      const { data, error } = await supabase
        .from("settings")
        .select("payment_due_day")
        .eq("id", 1)
        .single();
      if (error) throw new Error(error.message);
      return { paymentDueDayOfMonth: Number(data.payment_due_day) };
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

    async getOverdueStudents(periodMonth) {
      // Fetch all active students.
      const { data: allStudents, error: studentsError } = await supabase
        .from("students")
        .select("id, first_name, last_name")
        .eq("enrollment_status", "active");
      if (studentsError) throw new Error(studentsError.message);

      const students = allStudents ?? [];
      if (students.length === 0) return [];

      const studentIds = students.map((s) => s.id as string);

      // Fetch payments that are marked paid for the given period month.
      const { data: paidRows, error: paymentsError } = await supabase
        .from("payments")
        .select("student_id")
        .in("student_id", studentIds)
        .eq("period_month", periodMonth)
        .eq("status", "paid");
      if (paymentsError) throw new Error(paymentsError.message);

      const paidIds = new Set((paidRows ?? []).map((r) => r.student_id as string));

      // Students who do NOT appear in the paid set are overdue.
      const overdueIds = studentIds.filter((id) => !paidIds.has(id));

      if (overdueIds.length === 0) return [];

      // Fetch guardians for overdue students.
      const { data: guardianLinks, error: guardianError } = await supabase
        .from("student_guardians")
        .select("student_id, guardians(full_name, phone)")
        .in("student_id", overdueIds);
      if (guardianError) throw new Error(guardianError.message);

      type GuardianLinkRow = {
        student_id: string;
        guardians:
          | { full_name: string; phone: string | null }
          | { full_name: string; phone: string | null }[]
          | null;
      };

      const guardianMap = new Map<string, GuardianRecipient[]>();
      for (const row of (guardianLinks ?? []) as GuardianLinkRow[]) {
        const g = Array.isArray(row.guardians)
          ? row.guardians[0]
          : row.guardians;
        if (!g?.phone) continue;
        const list = guardianMap.get(row.student_id) ?? [];
        list.push({ full_name: g.full_name, phone: g.phone });
        guardianMap.set(row.student_id, list);
      }

      // Return only students who have at least one guardian with a phone number.
      return students
        .filter(
          (s) =>
            overdueIds.includes(s.id as string) &&
            (guardianMap.get(s.id as string) ?? []).length > 0,
        )
        .map((s) => ({
          id: s.id as string,
          first_name: s.first_name as string,
          last_name: s.last_name as string,
          guardians: guardianMap.get(s.id as string) ?? [],
        }));
    },
  };
}

export async function checkPaymentOverdueAlerts(
  asOfDate: string,
  deps: AlertDeps = {},
): Promise<AlertResult> {
  const database = deps.database ?? createSupabasePaymentAlertDatabase();
  const send = deps.sendSms ?? sendSms;

  const settings = await database.getPaymentSettings();

  // Not yet overdue — payment day hasn't passed yet this month.
  const dayOfMonth = parseInt(asOfDate.slice(8, 10), 10);
  if (dayOfMonth <= settings.paymentDueDayOfMonth) {
    return { students: 0, messages: 0 };
  }

  // Period month is the first day of the month containing asOfDate.
  const periodMonth = asOfDate.slice(0, 7) + "-01";

  const [overdueStudents, admins] = await Promise.all([
    database.getOverdueStudents(periodMonth),
    database.getAdminRecipients(),
  ]);

  // Format the month for display, e.g. "June 2026".
  const monthDisplay = new Date(periodMonth + "T00:00:00.000Z").toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  const messages: SendSmsInput[] = [];

  for (const student of overdueStudents) {
    const name = studentName(student);
    const parentBody = `Salaam Institute: ${name}'s tuition for ${monthDisplay} has not been received. Please contact the school.`;
    const adminBody = `ControlPad: ${name}'s tuition for ${monthDisplay} is overdue (due day: ${settings.paymentDueDayOfMonth}).`;

    for (const guardian of student.guardians) {
      messages.push({
        recipientPhone: guardian.phone,
        recipientType: "parent",
        studentId: student.id,
        triggerType: "payment_overdue",
        body: parentBody,
        dedupeWindowHours: 168,
      });
    }

    for (const admin of admins) {
      if (!admin.phone) continue;
      messages.push({
        recipientPhone: admin.phone,
        recipientType: "admin",
        studentId: student.id,
        triggerType: "payment_overdue",
        body: adminBody,
        dedupeWindowHours: 168,
      });
    }
  }

  await Promise.all(messages.map((m) => send(m)));

  return { students: overdueStudents.length, messages: messages.length };
}
