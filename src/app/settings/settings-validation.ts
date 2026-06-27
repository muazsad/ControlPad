export type SettingsValues = {
  grade_floor: number;
  tardy_window_hours: number;
  tardies_per_week: number;
  quran_inactivity_days: number;
  payment_due_day: number;
  school_start: string;
  admin_digest_time: string;
};

export type SettingsParseResult =
  | { ok: true; values: SettingsValues }
  | { ok: false; error: string };

function text(formData: FormData, key: keyof SettingsValues) {
  return (formData.get(key) as string | null)?.trim() ?? "";
}

function numberInRange(
  formData: FormData,
  key: keyof SettingsValues,
  label: string,
  min: number,
  max: number,
): SettingsParseResult | number {
  const raw = text(formData, key);
  const value = Number(raw);

  if (!raw || !Number.isFinite(value) || value < min || value > max) {
    return { ok: false, error: `${label} must be between ${min} and ${max}.` };
  }

  return value;
}

function integerInRange(
  formData: FormData,
  key: keyof SettingsValues,
  label: string,
  min: number,
  max: number,
): SettingsParseResult | number {
  const result = numberInRange(formData, key, label, min, max);

  if (typeof result !== "number") return result;
  if (!Number.isInteger(result)) {
    return { ok: false, error: `${label} must be a whole number.` };
  }

  return result;
}

function timeValue(
  formData: FormData,
  key: keyof SettingsValues,
  label: string,
): SettingsParseResult | string {
  const raw = text(formData, key);

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
    return { ok: false, error: `${label} must use HH:MM format.` };
  }

  return raw;
}

export function parseSettingsForm(formData: FormData): SettingsParseResult {
  const gradeFloor = numberInRange(
    formData,
    "grade_floor",
    "Grade floor",
    0,
    100,
  );
  if (typeof gradeFloor !== "number") return gradeFloor;

  const tardyWindowHours = numberInRange(
    formData,
    "tardy_window_hours",
    "Tardy window",
    0,
    8,
  );
  if (typeof tardyWindowHours !== "number") return tardyWindowHours;

  const tardiesPerWeek = integerInRange(
    formData,
    "tardies_per_week",
    "Tardies per week",
    1,
    20,
  );
  if (typeof tardiesPerWeek !== "number") return tardiesPerWeek;

  const quranInactivityDays = integerInRange(
    formData,
    "quran_inactivity_days",
    "Quran inactivity",
    1,
    60,
  );
  if (typeof quranInactivityDays !== "number") return quranInactivityDays;

  const paymentDueDay = integerInRange(
    formData,
    "payment_due_day",
    "Payment due day",
    1,
    28,
  );
  if (typeof paymentDueDay !== "number") return paymentDueDay;

  const schoolStart = timeValue(formData, "school_start", "School start");
  if (typeof schoolStart !== "string") return schoolStart;

  const adminDigestTime = timeValue(
    formData,
    "admin_digest_time",
    "Admin digest time",
  );
  if (typeof adminDigestTime !== "string") return adminDigestTime;

  return {
    ok: true,
    values: {
      grade_floor: gradeFloor,
      tardy_window_hours: tardyWindowHours,
      tardies_per_week: tardiesPerWeek,
      quran_inactivity_days: quranInactivityDays,
      payment_due_day: paymentDueDay,
      school_start: schoolStart,
      admin_digest_time: adminDigestTime,
    },
  };
}
