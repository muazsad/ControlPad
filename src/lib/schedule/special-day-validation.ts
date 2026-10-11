import { SPECIAL_DAY_MESSAGE_MAX_LENGTH } from "@/lib/alerts/special-day-constants";
import { isSpecialDayType, type SpecialDayType } from "@/lib/schedule/calendar";

// Parses the Settings → Special days form. Pure; returns { ok, values | error }.

/** Form value for "applies to the whole school". */
export const WHOLE_SCHOOL_SCOPE = "all";

export type SpecialDayValues = {
  type: SpecialDayType;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  students_expected: boolean;
  send_attendance_alerts: boolean;
  applies_to: string[] | null;
  parent_message: string | null;
  notify_parents: boolean;
};

type FormLike = Pick<FormData, "get" | "getAll">;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TYPES_NEEDING_TIMES: SpecialDayType[] = ["half_day", "schedule_change"];

function text(form: FormLike, key: string): string | null {
  const value = (form.get(key) as string | null)?.trim() ?? "";
  return value || null;
}

function checked(form: FormLike, key: string): boolean {
  return form.get(key) === "on" || form.get(key) === "true";
}

export function parseSpecialDayForm(
  form: FormLike,
  options: { allowParentMessage?: boolean } = {},
): { ok: true; values: SpecialDayValues } | { ok: false; error: string } {
  const allowParentMessage = options.allowParentMessage ?? true;
  const rawType = text(form, "type") ?? "";
  if (!isSpecialDayType(rawType)) return { ok: false, error: "Pick a special day type." };
  const type = rawType;

  const startTime = text(form, "start_time");
  const endTime = text(form, "end_time");
  for (const [label, value] of [["Start time", startTime], ["End time", endTime]] as const) {
    if (value && !TIME_PATTERN.test(value)) {
      return { ok: false, error: `${label} must use HH:MM format.` };
    }
  }
  if (TYPES_NEEDING_TIMES.includes(type) && (!startTime || !endTime)) {
    return { ok: false, error: "Half days and schedule changes need a start and end time." };
  }
  if (startTime && endTime && endTime <= startTime) {
    return { ok: false, error: "End time must be after start time." };
  }

  const scope = form
    .getAll("applies_to")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const appliesTo =
    scope.length === 0 || scope.includes(WHOLE_SCHOOL_SCOPE)
      ? null
      : Array.from(new Set(scope));

  const message = allowParentMessage ? text(form, "parent_message") : null;
  if (message && message.length > SPECIAL_DAY_MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Parent message is too long (max ${SPECIAL_DAY_MESSAGE_MAX_LENGTH} characters).`,
    };
  }
  const notifyParents = allowParentMessage && checked(form, "notify_parents");
  if (notifyParents && !message) {
    return { ok: false, error: "Write a parent message to text parents automatically." };
  }

  const studentsExpected = type === "no_school" ? false : checked(form, "students_expected");

  return {
    ok: true,
    values: {
      type,
      start_time: studentsExpected ? startTime : null,
      end_time: studentsExpected ? endTime : null,
      note: text(form, "note"),
      students_expected: studentsExpected,
      send_attendance_alerts: studentsExpected && checked(form, "send_attendance_alerts"),
      applies_to: appliesTo,
      parent_message: message,
      notify_parents: notifyParents,
    },
  };
}
