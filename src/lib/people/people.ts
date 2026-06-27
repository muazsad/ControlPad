// Shared types and helpers for the People & access module (students, guardians,
// and their links). Keep DB column names in sync with
// supabase/migrations/20260626000000_initial_schema.sql.

export type EnrollmentStatus = "active" | "inactive" | "withdrawn";

export type Student = {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  grade_level: string | null;
  enrollment_status: EnrollmentStatus;
  gcvs_reference: string | null;
  created_at: string;
  updated_at: string;
};

export type Guardian = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  user_id: string | null;
  created_at: string;
};

export type StudentGuardianLink = {
  student_id: string;
  guardian_id: string;
  relationship: string | null;
  is_primary: boolean;
};

export const enrollmentStatuses: EnrollmentStatus[] = [
  "active",
  "inactive",
  "withdrawn",
];

export function studentName(s: Pick<Student, "first_name" | "last_name">) {
  return `${s.first_name} ${s.last_name}`.trim();
}

const enrollmentTone: Record<EnrollmentStatus, "success" | "warning" | "neutral"> = {
  active: "success",
  inactive: "neutral",
  withdrawn: "warning",
};

export function enrollmentBadgeTone(status: EnrollmentStatus) {
  return enrollmentTone[status] ?? "neutral";
}

/**
 * Best-effort normalization of a phone number to E.164 (e.g. +14135551234).
 * Accepts numbers that already start with "+", or 10/11-digit US numbers.
 * Returns null when the input can't be confidently normalized so callers can
 * surface a validation error rather than store junk.
 */
export function toE164(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
