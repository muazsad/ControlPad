"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/current-profile";
import { createAuthUserWithProfile } from "@/lib/auth/admin-accounts";
import { createClient } from "@/lib/supabase/server";
import { toE164 } from "@/lib/people/people";

export type ActionState = { error: string | null };

function text(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

export async function createGuardian(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);

  const fullName = text(form, "full_name");
  const phoneRaw = text(form, "phone");
  if (!fullName) return { error: "Full name is required." };

  const phone = toE164(phoneRaw);
  if (!phone) {
    return {
      error: "Enter a valid phone number (e.g. 413-555-1234 or +14135551234).",
    };
  }

  const email = text(form, "email");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("guardians")
    .insert({
      full_name: fullName,
      phone,
      email: email === "" ? null : email,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/guardians");
  redirect(`/guardians/${data.id}`);
}

export async function updateGuardian(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);

  const id = text(form, "id");
  const fullName = text(form, "full_name");
  const phoneRaw = text(form, "phone");
  if (!id) return { error: "Missing guardian id." };
  if (!fullName) return { error: "Full name is required." };

  const phone = toE164(phoneRaw);
  if (!phone) {
    return {
      error: "Enter a valid phone number (e.g. 413-555-1234 or +14135551234).",
    };
  }

  const email = text(form, "email");

  const supabase = await createClient();
  const { error } = await supabase
    .from("guardians")
    .update({
      full_name: fullName,
      phone,
      email: email === "" ? null : email,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/guardians");
  revalidatePath(`/guardians/${id}`);
  redirect(`/guardians/${id}`);
}

/**
 * Provisions an optional web login for a guardian: creates a Supabase auth user
 * with the parent role and links it to the guardian record. Admin-only.
 */
export async function enableGuardianLogin(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);

  const guardianId = text(form, "guardian_id");
  const email = text(form, "email");
  const password = text(form, "password");
  if (!guardianId) return { error: "Missing guardian id." };
  if (!email) return { error: "An email is required for login." };
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();
  const { data: guardian, error: readError } = await supabase
    .from("guardians")
    .select("id, full_name, phone, user_id")
    .eq("id", guardianId)
    .maybeSingle();

  if (readError) return { error: readError.message };
  if (!guardian) return { error: "Guardian not found." };
  if (guardian.user_id) {
    return { error: "This guardian already has a login." };
  }

  const result = await createAuthUserWithProfile({
    email,
    password,
    fullName: guardian.full_name,
    role: "parent",
    phone: guardian.phone,
  });

  if (result.error) return { error: result.error };

  const { error: linkError } = await supabase
    .from("guardians")
    .update({ user_id: result.userId, email })
    .eq("id", guardianId);

  if (linkError) return { error: linkError.message };

  revalidatePath(`/guardians/${guardianId}`);
  revalidatePath("/guardians");
  return { error: null };
}
