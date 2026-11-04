"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/current-profile";
import { credentialsKey, decryptSecret, encryptSecret } from "@/lib/sms/credentials-crypto";
import type { SmsMode } from "@/lib/sms/send-sms";
import { parseTextingSetup } from "@/lib/sms/texting-validation";
import { verifyTwilioCredentials } from "@/lib/sms/twilio-verify";
import { createServiceClient } from "@/lib/supabase/server";

import type { SettingsFormState } from "./actions";

// Service role: school_sms_config has no RLS policies, so only server code
// reads or writes it — always for the signed-in admin's own school.

// ── Texting (the school's own Twilio account) ────────────────────────────────

export async function saveTextingSetup(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const profile = await requireRole(["admin"]);
  const parsed = parseTextingSetup(formData);
  if (!parsed.ok) return { error: parsed.error, success: null };
  const values = parsed.values;

  // The token is never sent to the browser, so a blank field keeps the saved one.
  const service = createServiceClient();
  const { data: existing, error: loadError } = await service
    .from("school_sms_config")
    .select("twilio_auth_token_enc")
    .eq("school_id", profile.schoolId)
    .maybeSingle();
  if (loadError) return { error: loadError.message, success: null };

  let key: string;
  try {
    key = credentialsKey();
  } catch {
    return { error: "Texting can't be set up yet: the server is missing its encryption key.", success: null };
  }
  const tokenEnc = values.authToken
    ? encryptSecret(values.authToken, key)
    : ((existing?.twilio_auth_token_enc as string | null) ?? null);
  if (!tokenEnc) return { error: "Enter the Auth Token.", success: null };

  let authToken: string;
  try {
    authToken = values.authToken ?? decryptSecret(tokenEnc, key);
  } catch {
    return { error: "The saved Auth Token couldn't be read. Enter it again.", success: null };
  }
  const check = await verifyTwilioCredentials({
    accountSid: values.accountSid,
    authToken,
    phoneNumber: values.phone,
  });
  // Only a verified number is saved: an unverified one could squat another
  // school's number, and incoming texts are routed by it.
  if (!check.ok) return { error: `Not saved: ${check.error}`, success: null };

  const now = new Date().toISOString();
  const { error } = await service
    .from("school_sms_config")
    .update({
      twilio_account_sid: values.accountSid,
      twilio_auth_token_enc: tokenEnc,
      twilio_phone_number: values.phone,
      test_number: values.testNumber,
      verified_at: now,
      updated_at: now,
    })
    .eq("school_id", profile.schoolId);
  if (error) {
    // 23505: another school already registered this number.
    const message = error.code === "23505" ? "That number is already used by another school." : error.message;
    return { error: message, success: null };
  }

  revalidatePath("/settings");
  revalidatePath("/messages");
  return { error: null, success: "Saved and verified with Twilio." };
}

export async function setTextingMode(mode: SmsMode): Promise<{ error: string | null }> {
  const profile = await requireRole(["admin"]);
  if (!["off", "test", "live"].includes(mode)) return { error: "Unknown mode." };

  const { error } = await createServiceClient()
    .from("school_sms_config")
    .update({ requested_mode: mode, updated_at: new Date().toISOString() })
    .eq("school_id", profile.schoolId);
  revalidatePath("/settings");
  revalidatePath("/messages");
  return { error: error?.message ?? null };
}
