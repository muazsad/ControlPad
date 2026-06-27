"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

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
