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

export type QuranSlipStudent = {
  id: string;
  first_name: string;
  last_name: string;
  daysSinceLastLesson: number;
  guardians: GuardianRecipient[];
};

export type QuranSettings = {
  quranInactivityDays: number;
};

export type QuranAlertDatabase = {
  getQuranSettings(): Promise<QuranSettings>;
  getAdminRecipients(): Promise<AdminRecipient[]>;
  getSlippingStudents(
    inactivityDays: number,
    asOfDate: string,
  ): Promise<QuranSlipStudent[]>;
};

type AlertDeps = {
  database?: QuranAlertDatabase;
  sendSms?: (input: SendSmsInput) => Promise<SmsResult>;
};

type AlertResult = {
  students: number;
  messages: number;
};

function studentName(s: Pick<QuranSlipStudent, "first_name" | "last_name">) {
  return `${s.first_name} ${s.last_name}`.trim();
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function createSupabaseQuranAlertDatabase(): QuranAlertDatabase {
  const supabase = createServiceClient();

  return {
    async getQuranSettings() {
      const { data, error } = await supabase
        .from("settings")
        .select("quran_inactivity_days")
        .eq("id", 1)
        .single();
      if (error) throw new Error(error.message);
      return { quranInactivityDays: Number(data.quran_inactivity_days) };
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

    async getSlippingStudents(inactivityDays, asOfDate) {
      // Find all active students.
      const { data: allStudents, error: studentsError } = await supabase
        .from("students")
        .select("id, first_name, last_name")
        .eq("enrollment_status", "active");
      if (studentsError) throw new Error(studentsError.message);

      const students = allStudents ?? [];
      if (students.length === 0) return [];

      const studentIds = students.map((s) => s.id as string);

      // Get the most recent quran_progress date per student (using the lesson
      // date, not recorded_at, so a backdated entry is counted correctly).
      const { data: latestRows, error: latestError } = await supabase
        .from("quran_progress")
        .select("student_id, date")
        .in("student_id", studentIds)
        .order("date", { ascending: false });
      if (latestError) throw new Error(latestError.message);

      const latestDate = new Map<string, string>();
      for (const row of latestRows ?? []) {
        if (!latestDate.has(row.student_id)) {
          latestDate.set(row.student_id, row.date as string);
        }
      }

      const cutoff = isoDate(
        addDays(new Date(`${asOfDate}T00:00:00.000Z`), -inactivityDays),
      );

      // A student slips when their most recent lesson date is before the cutoff,
      // OR they have no entries at all and were enrolled before the cutoff.
      const slippingIds = studentIds.filter((id) => {
        const last = latestDate.get(id);
        return !last || last < cutoff;
      });

      if (slippingIds.length === 0) return [];

      // Fetch guardians for slipping students.
      const { data: guardianLinks, error: guardianError } = await supabase
        .from("student_guardians")
        .select("student_id, guardians(full_name, phone)")
        .in("student_id", slippingIds);
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

      const asOfMs = new Date(`${asOfDate}T00:00:00.000Z`).getTime();

      return students
        .filter((s) => slippingIds.includes(s.id as string))
        .map((s) => {
          const last = latestDate.get(s.id as string);
          const daysSince = last
            ? Math.floor(
                (asOfMs - new Date(`${last}T00:00:00.000Z`).getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : inactivityDays + 1;
          return {
            id: s.id as string,
            first_name: s.first_name as string,
            last_name: s.last_name as string,
            daysSinceLastLesson: daysSince,
            guardians: guardianMap.get(s.id as string) ?? [],
          };
        });
    },
  };
}

export async function checkQuranSlipAlerts(
  asOfDate: string,
  deps: AlertDeps = {},
): Promise<AlertResult> {
  const database = deps.database ?? createSupabaseQuranAlertDatabase();
  const send = deps.sendSms ?? sendSms;
  const settings = await database.getQuranSettings();

  const [students, admins] = await Promise.all([
    database.getSlippingStudents(settings.quranInactivityDays, asOfDate),
    database.getAdminRecipients(),
  ]);

  const messages: SendSmsInput[] = [];

  for (const student of students) {
    const name = studentName(student);
    const parentBody =
      `Salaam Institute: ${name} has not had a new Quran lesson recorded in ${student.daysSinceLastLesson} day${student.daysSinceLastLesson === 1 ? "" : "s"}. ` +
      `Please reach out to the school if you have questions.`;
    const adminBody =
      `ControlPad: ${name}'s last Quran lesson was ${student.daysSinceLastLesson} day${student.daysSinceLastLesson === 1 ? "" : "s"} ago (threshold: ${settings.quranInactivityDays}).`;

    for (const guardian of student.guardians) {
      messages.push({
        recipientPhone: guardian.phone,
        recipientType: "parent",
        studentId: student.id,
        triggerType: "quran_slip",
        body: parentBody,
        // Re-alert after the full inactivity window elapses again.
        dedupeWindowHours: settings.quranInactivityDays * 24,
      });
    }

    for (const admin of admins) {
      if (!admin.phone) continue;
      messages.push({
        recipientPhone: admin.phone,
        recipientType: "admin",
        studentId: student.id,
        triggerType: "quran_slip",
        body: adminBody,
        dedupeWindowHours: settings.quranInactivityDays * 24,
      });
    }
  }

  await Promise.all(messages.map((m) => send(m)));

  return { students: students.length, messages: messages.length };
}
