"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/current-profile";
import { createAuthUserWithProfile } from "@/lib/auth/admin-accounts";
import { toE164 } from "@/lib/people/people";

export type ActionState = { error: string | null; success: string | null };

function text(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

/** Admin creates a moderator account (teacher/supervisor). */
export async function createModerator(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);

  const fullName = text(form, "full_name");
  const email = text(form, "email");
  const password = text(form, "password");
  const phoneRaw = text(form, "phone");

  if (!fullName) return { error: "Full name is required.", success: null };
  if (!email) return { error: "Email is required.", success: null };
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters.", success: null };
  }

  let phone: string | null = null;
  if (phoneRaw) {
    phone = toE164(phoneRaw);
    if (!phone) {
      return {
        error: "Enter a valid phone number or leave it blank.",
        success: null,
      };
    }
  }

  const result = await createAuthUserWithProfile({
    email,
    password,
    fullName,
    role: "moderator",
    phone,
  });

  if (result.error) return { error: result.error, success: null };

  revalidatePath("/staff");
  return {
    error: null,
    success: `Moderator account created for ${fullName}. Share the temporary password securely.`,
  };
}
