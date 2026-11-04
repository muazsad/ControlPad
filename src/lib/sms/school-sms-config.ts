// Server-only. Each school's effective texting mode (spec §7.3).
import { credentialsKey, decryptSecret } from "@/lib/sms/credentials-crypto";
import type { SmsConfig, SmsMode } from "@/lib/sms/send-sms";
import { createServiceClient } from "@/lib/supabase/server";

export type SchoolSmsRow = {
  twilio_account_sid: string | null;
  twilio_auth_token_enc: string | null;
  twilio_phone_number: string | null;
  verified_at: string | null;
  requested_mode: SmsMode;
  live_approved_at: string | null;
  test_number: string | null;
};

export const SCHOOL_SMS_COLUMNS =
  "twilio_account_sid, twilio_auth_token_enc, twilio_phone_number, verified_at, requested_mode, live_approved_at, test_number";

const RANK: Record<SmsMode, number> = { off: 0, test: 1, live: 2 };

function off(reason: string, testNumber: string | null = null): SmsConfig {
  return { mode: "off", reason, twilio: null, testNumber };
}

export function resolveSmsConfig(
  row: SchoolSmsRow | null,
  env: Record<string, string | undefined>,
  decrypt: (sealed: string) => string,
): SmsConfig {
  const ceilingRaw = env.SMS_MODE?.trim().toLowerCase();
  const ceiling: SmsMode = ceilingRaw === "off" || ceilingRaw === "test" ? ceilingRaw : "live";
  if (ceiling === "off") return off("Texting is turned off for every school (SMS_MODE=off).");

  if (!row?.twilio_account_sid || !row.twilio_auth_token_enc || !row.twilio_phone_number) {
    return off("Texting isn't set up yet (Settings → Texting).", row?.test_number ?? null);
  }
  if (!row.verified_at) return off("The Twilio details haven't been verified yet.", row.test_number);

  let authToken: string;
  try {
    authToken = decrypt(row.twilio_auth_token_enc);
  } catch {
    return off("The saved Twilio token couldn't be decrypted. Enter it again in Settings → Texting.", row.test_number);
  }
  const twilio = { accountSid: row.twilio_account_sid, authToken, fromPhone: row.twilio_phone_number };

  let wanted: SmsMode = row.requested_mode;
  let reason = wanted === "live" ? "Live texting is approved." : wanted === "test" ? "Test mode." : "Texting is off.";
  if (wanted === "live" && !row.live_approved_at) {
    wanted = "test";
    reason = "Live texting is waiting for approval.";
  }
  if (RANK[wanted] > RANK[ceiling]) {
    wanted = ceiling;
    reason = `Capped by SMS_MODE=${ceiling}.`;
  }
  if (wanted === "off") return off(reason, row.test_number);
  if (wanted === "test" && !row.test_number) return off(`${reason} Add a test number to use test mode.`);
  return { mode: wanted, reason, twilio, testNumber: row.test_number };
}

/** Loads and resolves one school's config (service role). */
export async function loadSchoolSmsConfig(
  schoolId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<SmsConfig> {
  const { data, error } = await createServiceClient()
    .from("school_sms_config")
    .select(SCHOOL_SMS_COLUMNS)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return resolveSmsConfig(data as SchoolSmsRow | null, env, (sealed) => decryptSecret(sealed, credentialsKey(env)));
}

/** True once the school's Twilio details have been verified (setup checklist). */
export async function isTextingVerified(schoolId: string): Promise<boolean> {
  const { data, error } = await createServiceClient()
    .from("school_sms_config")
    .select("verified_at")
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.verified_at);
}
