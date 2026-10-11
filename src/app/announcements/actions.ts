"use server";

import { revalidatePath } from "next/cache";

import { parseAnnouncementForm, UNGROUPED } from "@/lib/announcements/announcements";
import { sendAnnouncement } from "@/lib/announcements/send";
import { requireRole } from "@/lib/auth/current-profile";
import { getScheduleGroups } from "@/lib/schedule/schedule-groups-data";
import { createClient } from "@/lib/supabase/server";

export type AnnouncementFormState = {
  error: string | null;
  success: string | null;
  /** Bumped on each success so the form can reset itself. */
  version: number;
};

function text(form: FormData, key: string): string {
  return (form.get(key) as string | null) ?? "";
}

export async function createAnnouncement(
  prev: AnnouncementFormState,
  form: FormData,
): Promise<AnnouncementFormState> {
  const profile = await requireRole(["admin"]);
  const fail = (error: string) => ({ ...prev, error, success: null });

  const groups = await getScheduleGroups();
  const parsed = parseAnnouncementForm(
    {
      message: text(form, "message"),
      audience: text(form, "audience"),
      groups: form.getAll("groups").map(String),
      when: text(form, "when"),
      date: text(form, "date"),
      time: text(form, "time"),
    },
    {
      validGroupKeys: new Set([...groups.map((group) => group.id), UNGROUPED]),
      now: new Date(),
    },
  );
  if (!parsed.ok) return fail(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("announcements")
    .insert({
      message: parsed.values.message,
      audience: parsed.values.audience,
      status: "scheduled",
      send_at: parsed.values.sendAt.toISOString(),
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return fail(error.message);

  revalidatePath("/announcements");
  revalidatePath("/messages");

  if (!parsed.values.sendNow) {
    return {
      error: null,
      success: "Scheduled. It goes out within 10 minutes of the chosen time.",
      version: prev.version + 1,
    };
  }

  const result = await sendAnnouncement(data.id as string);
  revalidatePath("/announcements");
  if (result.status === "not_claimed") return fail("This announcement was already sent.");
  if (result.status === "failed") {
    return { error: "Sending failed — see Messages for details.", success: null, version: prev.version + 1 };
  }
  const families = `${result.recipients} famil${result.recipients === 1 ? "y" : "ies"}`;
  return {
    error: null,
    success:
      result.mode === "off"
        ? `Logged for ${families} — texting isn't on yet, so nothing was sent.`
        : result.failed > 0
          ? `Sent to ${families}; ${result.failed} failed (see Messages).`
          : `Sent to ${families}.`,
    version: prev.version + 1,
  };
}

/** Cancels a scheduled announcement that hasn't gone out yet. */
export async function cancelAnnouncement(id: string) {
  await requireRole(["admin"]);
  const supabase = await createClient();
  await supabase
    .from("announcements")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "scheduled");
  revalidatePath("/announcements");
}
