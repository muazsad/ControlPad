import { timeToMinutes, type ScheduleGroupDay } from "@/lib/schedule/student-schedule";

// Parses the schedule-group form on /settings. Field names:
//   name, description,
//   day_<0-6>_on ("on" when the group attends), day_<n>_start, day_<n>_grace,
//   day_<n>_check
// Weekday 0 = Sunday … 6 = Saturday.

// ── Tunable constants ────────────────────────────────────────────────────────

export const MAX_GROUP_NAME_LENGTH = 60;
export const MAX_TARDY_GRACE_MINUTES = 240;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ScheduleGroupValues = {
  name: string;
  description: string | null;
  days: ScheduleGroupDay[];
};

export type ScheduleGroupParseResult =
  | { ok: true; values: ScheduleGroupValues }
  | { ok: false; error: string };

function field(formData: FormData, key: string): string {
  return (formData.get(key) as string | null)?.trim() ?? "";
}

export function parseScheduleGroupForm(formData: FormData): ScheduleGroupParseResult {
  const name = field(formData, "name");
  if (!name) return { ok: false, error: "Group name is required." };
  if (name.length > MAX_GROUP_NAME_LENGTH) {
    return { ok: false, error: `Group name must be ${MAX_GROUP_NAME_LENGTH} characters or fewer.` };
  }

  const days: ScheduleGroupDay[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    if (formData.get(`day_${weekday}_on`) !== "on") continue;
    const label = DAY_NAMES[weekday];

    const startTime = field(formData, `day_${weekday}_start`);
    const absenceCheckTime = field(formData, `day_${weekday}_check`);
    const graceRaw = field(formData, `day_${weekday}_grace`);
    const tardyGraceMinutes = Number(graceRaw);

    if (!TIME_PATTERN.test(startTime)) {
      return { ok: false, error: `${label}: start time must use HH:MM format.` };
    }
    if (!TIME_PATTERN.test(absenceCheckTime)) {
      return { ok: false, error: `${label}: absence check time must use HH:MM format.` };
    }
    if (
      graceRaw === "" ||
      !Number.isInteger(tardyGraceMinutes) ||
      tardyGraceMinutes < 0 ||
      tardyGraceMinutes > MAX_TARDY_GRACE_MINUTES
    ) {
      return {
        ok: false,
        error: `${label}: tardy grace must be a whole number from 0 to ${MAX_TARDY_GRACE_MINUTES} minutes.`,
      };
    }
    if (timeToMinutes(absenceCheckTime) < timeToMinutes(startTime)) {
      return { ok: false, error: `${label}: absence check can't be before the start time.` };
    }

    days.push({ weekday, startTime, tardyGraceMinutes, absenceCheckTime });
  }

  if (days.length === 0) {
    return { ok: false, error: "Pick at least one day this group attends." };
  }

  return {
    ok: true,
    values: { name, description: field(formData, "description") || null, days },
  };
}
