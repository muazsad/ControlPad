"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { WEEKDAY_KEYS, type SpecialDayType } from "@/lib/schedule/calendar";

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

function optionalText(formData: FormData, key: string): string | null {
  const value = (formData.get(key) as string | null)?.trim() ?? "";
  return value || null;
}

function dateValue(formData: FormData, key: string, label: string): string {
  const value = requiredText(formData, key, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format.`);
  }
  return value;
}

function optionalTime(formData: FormData, key: string, label: string): string | null {
  const value = optionalText(formData, key);
  if (!value) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`${label} must use HH:MM format.`);
  }
  return value;
}

function specialDayType(formData: FormData): SpecialDayType {
  const type = requiredText(formData, "type", "Special day type");
  if (type !== "no_school" && type !== "half_day") {
    throw new Error("Special day type must be no_school or half_day.");
  }
  return type;
}

function halfDayTimes(formData: FormData, type: SpecialDayType) {
  const startTime = optionalTime(formData, "start_time", "Start time");
  const endTime = optionalTime(formData, "end_time", "End time");

  if (type === "half_day" && (!startTime || !endTime)) {
    throw new Error("Half days need both start and end times.");
  }

  return {
    start_time: type === "half_day" ? startTime : null,
    end_time: type === "half_day" ? endTime : null,
  };
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

export async function upsertSpecialDay(formData: FormData) {
  await requireRole(["admin"]);

  const date = dateValue(formData, "date", "Date");
  const type = specialDayType(formData);
  const times = halfDayTimes(formData, type);

  const supabase = await createClient();
  const { error } = await supabase.from("school_special_days").upsert(
    {
      date,
      type,
      ...times,
      note: optionalText(formData, "note"),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "date" },
  );

  if (error) throw error;

  revalidatePath("/settings");
}

export async function updateSpecialDay(originalDate: string, formData: FormData) {
  await requireRole(["admin"]);

  const date = dateValue(formData, "date", "Date");
  const type = specialDayType(formData);
  const times = halfDayTimes(formData, type);

  const supabase = await createClient();
  const { error: upsertError } = await supabase.from("school_special_days").upsert(
    {
      date,
      type,
      ...times,
      note: optionalText(formData, "note"),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "date" },
  );

  if (upsertError) throw upsertError;

  if (date !== originalDate) {
    const { error: deleteError } = await supabase
      .from("school_special_days")
      .delete()
      .eq("date", originalDate);
    if (deleteError) throw deleteError;
  }

  revalidatePath("/settings");
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

export async function applySpecialDayRange(formData: FormData) {
  await requireRole(["admin"]);

  const startDate = dateValue(formData, "start_date", "Start date");
  const endDate = dateValue(formData, "end_date", "End date");
  assertDateRange(startDate, endDate);

  const type = specialDayType(formData);
  const times = halfDayTimes(formData, type);
  const note = optionalText(formData, "note");
  const updatedAt = new Date().toISOString();

  const rows = datesInRange(startDate, endDate).map((date) => ({
    date,
    type,
    ...times,
    note,
    updated_at: updatedAt,
  }));

  const supabase = await createClient();
  const { error } = await supabase
    .from("school_special_days")
    .upsert(rows, { onConflict: "date" });

  if (error) throw error;

  revalidatePath("/settings");
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
