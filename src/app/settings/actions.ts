"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { sendSpecialDayNotice } from "@/lib/alerts/special-day";
import { WEEKDAY_KEYS } from "@/lib/schedule/calendar";
import { parseSpecialDayForm } from "@/lib/schedule/special-day-validation";

import {
  parseScheduleGroupForm,
  type ScheduleGroupValues,
} from "@/lib/schedule/schedule-group-validation";

import { parseSettingsForm } from "./settings-validation";

export type SettingsFormState = {
  error: string | null;
  success: string | null;
};

export async function updateSettings(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requireRole(["admin"]);

  const parsed = parseSettingsForm(formData);
  if (!parsed.ok) {
    return { error: parsed.error, success: null };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .update({
      ...parsed.values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    return { error: error.message, success: null };
  }

  revalidatePath("/settings");
  return { error: null, success: "Settings saved." };
}

function requiredText(formData: FormData, key: string, label: string): string {
  const value = (formData.get(key) as string | null)?.trim() ?? "";
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function dateValue(formData: FormData, key: string, label: string): string {
  const value = requiredText(formData, key, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format.`);
  }
  return value;
}

function assertDateRange(startDate: string, endDate: string) {
  if (endDate < startDate) {
    throw new Error("End date must be on or after start date.");
  }
}

function datesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }

  return dates;
}

export async function updateWeeklyPattern(formData: FormData) {
  await requireRole(["admin"]);

  const values = Object.fromEntries(
    WEEKDAY_KEYS.map((day) => [day, formData.get(day) === "on"]),
  );

  const supabase = await createClient();
  const { error } = await supabase.from("school_weekly_patterns").upsert(
    {
      id: 1,
      ...values,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (error) throw error;

  revalidatePath("/settings");
}

export async function createBreak(formData: FormData) {
  await requireRole(["admin"]);

  const name = requiredText(formData, "name", "Break name");
  const startDate = dateValue(formData, "start_date", "Start date");
  const endDate = dateValue(formData, "end_date", "End date");
  assertDateRange(startDate, endDate);

  const supabase = await createClient();
  const { error } = await supabase.from("school_breaks").insert({
    name,
    start_date: startDate,
    end_date: endDate,
  });

  if (error) throw error;

  revalidatePath("/settings");
}

export async function updateBreak(id: string, formData: FormData) {
  await requireRole(["admin"]);

  const name = requiredText(formData, "name", "Break name");
  const startDate = dateValue(formData, "start_date", "Start date");
  const endDate = dateValue(formData, "end_date", "End date");
  assertDateRange(startDate, endDate);

  const supabase = await createClient();
  const { error } = await supabase
    .from("school_breaks")
    .update({
      name,
      start_date: startDate,
      end_date: endDate,
    })
    .eq("id", id);

  if (error) throw error;

  revalidatePath("/settings");
}

export async function deleteBreak(id: string) {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { error } = await supabase.from("school_breaks").delete().eq("id", id);

  if (error) throw error;

  revalidatePath("/settings");
}

export type SpecialDayFormState = {
  error: string | null;
  success: string | null;
};

function failure(error: unknown): SpecialDayFormState {
  return {
    error: error instanceof Error ? error.message : String(error),
    success: null,
  };
}

/**
 * Creates (originalDate = null) or updates a special day. Editing the parent
 * message clears parents_notified_at, so the new message can go out again.
 */
export async function saveSpecialDay(
  originalDate: string | null,
  _prev: SpecialDayFormState,
  formData: FormData,
): Promise<SpecialDayFormState> {
  await requireRole(["admin"]);

  let date: string;
  try {
    date = dateValue(formData, "date", "Date");
  } catch (error) {
    return failure(error);
  }
  const parsed = parseSpecialDayForm(formData);
  if (!parsed.ok) return { error: parsed.error, success: null };

  const supabase = await createClient();

  let parentsNotifiedAt: string | null = null;
  if (originalDate) {
    const { data: existing, error: readError } = await supabase
      .from("school_special_days")
      .select("parent_message, parents_notified_at")
      .eq("date", originalDate)
      .maybeSingle();
    if (readError) return failure(readError.message);
    const sameMessage =
      (existing?.parent_message ?? null) === parsed.values.parent_message;
    parentsNotifiedAt =
      sameMessage && date === originalDate ? existing?.parents_notified_at ?? null : null;
  }

  const { error: upsertError } = await supabase.from("school_special_days").upsert(
    {
      date,
      ...parsed.values,
      parents_notified_at: parentsNotifiedAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "date" },
  );
  if (upsertError) return failure(upsertError.message);

  if (originalDate && date !== originalDate) {
    const { error: deleteError } = await supabase
      .from("school_special_days")
      .delete()
      .eq("date", originalDate);
    if (deleteError) return failure(deleteError.message);
  }

  revalidatePath("/settings");
  return { error: null, success: originalDate ? "Special day saved." : "Special day added." };
}

export async function deleteSpecialDay(date: string) {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { error } = await supabase
    .from("school_special_days")
    .delete()
    .eq("date", date);

  if (error) throw error;

  revalidatePath("/settings");
}

/** Applies the same options to every date in a range (no parent message). */
export async function applySpecialDayRange(
  _prev: SpecialDayFormState,
  formData: FormData,
): Promise<SpecialDayFormState> {
  await requireRole(["admin"]);

  let startDate: string;
  let endDate: string;
  try {
    startDate = dateValue(formData, "start_date", "Start date");
    endDate = dateValue(formData, "end_date", "End date");
    assertDateRange(startDate, endDate);
  } catch (error) {
    return failure(error);
  }

  const parsed = parseSpecialDayForm(formData, { allowParentMessage: false });
  if (!parsed.ok) return { error: parsed.error, success: null };

  const updatedAt = new Date().toISOString();
  const rows = datesInRange(startDate, endDate).map((date) => ({
    date,
    ...parsed.values,
    parents_notified_at: null,
    updated_at: updatedAt,
  }));

  const supabase = await createClient();
  const { error } = await supabase
    .from("school_special_days")
    .upsert(rows, { onConflict: "date" });

  if (error) return failure(error.message);

  revalidatePath("/settings");
  return { error: null, success: `Applied to ${rows.length} day${rows.length === 1 ? "" : "s"}.` };
}

/** "Text parents now" — sends the saved parent message for `date`. */
export async function textParentsForSpecialDay(
  date: string,
): Promise<SpecialDayFormState> {
  await requireRole(["admin"]);

  try {
    const result = await sendSpecialDayNotice({ date });
    revalidatePath("/settings");
    revalidatePath("/messages");
    if (!result.sent) return { error: result.reason, success: null };

    const dryRuns = result.statuses.dry_run ?? 0;
    const failed = result.statuses.failed ?? 0;
    const duplicates = result.statuses.duplicate ?? 0;
    const parts = [
      dryRuns > 0
        ? `${dryRuns} logged as dry run (texting is off)`
        : `${result.statuses.sent ?? 0} sent`,
      duplicates > 0 ? `${duplicates} already had this message` : null,
      failed > 0 ? `${failed} failed — see Messages` : null,
    ].filter(Boolean);
    return {
      error: null,
      success: `${result.recipients} parent${result.recipients === 1 ? "" : "s"}: ${parts.join(", ")}.`,
    };
  } catch (error) {
    return failure(error);
  }
}

// ── Schedule groups ─────────────────────────────────────────────────────────

export type ScheduleGroupFormState = {
  error: string | null;
  success: string | null;
};

async function saveGroupDays(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string,
  days: ScheduleGroupValues["days"],
) {
  const { error: deleteError } = await supabase
    .from("schedule_group_days")
    .delete()
    .eq("group_id", groupId);
  if (deleteError) return deleteError.message;

  const { error: insertError } = await supabase.from("schedule_group_days").insert(
    days.map((day) => ({
      group_id: groupId,
      weekday: day.weekday,
      start_time: day.startTime,
      tardy_grace_minutes: day.tardyGraceMinutes,
      absence_check_time: day.absenceCheckTime,
    })),
  );
  return insertError?.message ?? null;
}

function friendlyGroupError(message: string) {
  return /duplicate key|unique/i.test(message)
    ? "A group with that name already exists."
    : message;
}

export async function createScheduleGroup(
  _prev: ScheduleGroupFormState,
  formData: FormData,
): Promise<ScheduleGroupFormState> {
  await requireRole(["admin"]);

  const parsed = parseScheduleGroupForm(formData);
  if (!parsed.ok) return { error: parsed.error, success: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schedule_groups")
    .insert({ name: parsed.values.name, description: parsed.values.description })
    .select("id")
    .single();
  if (error) return { error: friendlyGroupError(error.message), success: null };

  const daysError = await saveGroupDays(supabase, data.id, parsed.values.days);
  if (daysError) return { error: daysError, success: null };

  revalidatePath("/settings");
  revalidatePath("/attendance");
  return { error: null, success: `Created ${parsed.values.name}.` };
}

export async function updateScheduleGroup(
  _prev: ScheduleGroupFormState,
  formData: FormData,
): Promise<ScheduleGroupFormState> {
  await requireRole(["admin"]);

  const id = (formData.get("id") as string | null)?.trim();
  if (!id) return { error: "Missing group id.", success: null };

  const parsed = parseScheduleGroupForm(formData);
  if (!parsed.ok) return { error: parsed.error, success: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("schedule_groups")
    .update({ name: parsed.values.name, description: parsed.values.description })
    .eq("id", id);
  if (error) return { error: friendlyGroupError(error.message), success: null };

  const daysError = await saveGroupDays(supabase, id, parsed.values.days);
  if (daysError) return { error: daysError, success: null };

  revalidatePath("/settings");
  revalidatePath("/attendance");
  return { error: null, success: `Saved ${parsed.values.name}.` };
}

export async function deleteScheduleGroup(id: string) {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { error } = await supabase.from("schedule_groups").delete().eq("id", id);
  if (error) throw error;

  revalidatePath("/settings");
  revalidatePath("/attendance");
  revalidatePath("/students");
}
