import { createServiceClient } from "@/lib/supabase/server";
import { sendSms, type SendSmsInput, type SmsResult } from "@/lib/sms/send-sms";

type Recipient = {
  full_name: string;
  phone: string | null;
};

export type GradeAlertDatabase = {
  getGradeFloor(): Promise<number>;
  getAdminRecipients(): Promise<Recipient[]>;
  getGuardianRecipients(studentId: string): Promise<Recipient[]>;
};

type GradeAlertInput = {
  studentId: string;
  studentName: string;
  courseName: string;
  gradeValue: number;
  includeGuardians?: boolean;
};

type GradeAlertDeps = {
  database?: GradeAlertDatabase;
  sendSms?: (input: SendSmsInput) => Promise<SmsResult>;
};

type GradeAlertResult = {
  alerted: boolean;
  gradeFloor: number;
  recipients: number;
};

function formatPercent(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function createSupabaseGradeAlertDatabase(): GradeAlertDatabase {
  const supabase = createServiceClient();

  return {
    async getGradeFloor() {
      const { data, error } = await supabase
        .from("settings")
        .select("grade_floor")
        .eq("id", 1)
        .single();

      if (error) throw new Error(error.message);
      return Number(data.grade_floor);
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
    async getGuardianRecipients(studentId) {
      const { data, error } = await supabase
        .from("student_guardians")
        .select("guardians(full_name, phone)")
        .eq("student_id", studentId);

      if (error) throw new Error(error.message);

      return (data ?? [])
        .map((row) => {
          const guardian = row.guardians;
          if (Array.isArray(guardian)) return guardian[0] as Recipient | undefined;
          return guardian as Recipient | undefined;
        })
        .filter((guardian): guardian is Recipient => Boolean(guardian?.phone));
    },
  };
}

export async function checkLowGradeAlert(
  input: GradeAlertInput,
  deps: GradeAlertDeps = {},
): Promise<GradeAlertResult> {
  const database = deps.database ?? createSupabaseGradeAlertDatabase();
  const send = deps.sendSms ?? sendSms;
  const gradeFloor = await database.getGradeFloor();

  if (input.gradeValue >= gradeFloor) {
    return { alerted: false, gradeFloor, recipients: 0 };
  }

  const adminRecipients = await database.getAdminRecipients();
  const guardianRecipients = input.includeGuardians
    ? await database.getGuardianRecipients(input.studentId)
    : [];
  const body = `${input.studentName}'s ${input.courseName} grade is ${formatPercent(
    input.gradeValue,
  )}, below the ${formatPercent(gradeFloor)} floor. Please review in ControlPad.`;
  const recipients = [
    ...adminRecipients.map((recipient) => ({
      phone: recipient.phone,
      type: "admin" as const,
    })),
    ...guardianRecipients.map((recipient) => ({
      phone: recipient.phone,
      type: "parent" as const,
    })),
  ].filter((recipient): recipient is { phone: string; type: "admin" | "parent" } =>
    Boolean(recipient.phone),
  );

  await Promise.all(
    recipients.map((recipient) =>
      send({
        recipientPhone: recipient.phone,
        recipientType: recipient.type,
        studentId: input.studentId,
        triggerType: "low_grade",
        body,
      }),
    ),
  );

  return {
    alerted: recipients.length > 0,
    gradeFloor,
    recipients: recipients.length,
  };
}
