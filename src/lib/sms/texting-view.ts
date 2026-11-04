import { headers } from "next/headers";

import type { TextingView } from "@/app/settings/texting-form";
import { loadSchoolSmsConfig, type SchoolSmsRow } from "@/lib/sms/school-sms-config";
import { createServiceClient } from "@/lib/supabase/server";

/** The Texting card's data: never the token itself, only whether one is saved. */
export async function loadTextingView(schoolId: string): Promise<TextingView> {
  const [{ data }, effective, requestHeaders] = await Promise.all([
    createServiceClient()
      .from("school_sms_config")
      .select(
        "twilio_account_sid, twilio_auth_token_enc, twilio_phone_number, verified_at, requested_mode, live_approved_at, test_number",
      )
      .eq("school_id", schoolId)
      .maybeSingle(),
    loadSchoolSmsConfig(schoolId).catch(() => null),
    headers(),
  ]);
  const row = data as SchoolSmsRow | null;
  const sid = row?.twilio_account_sid ?? null;
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return {
    accountSidMasked: sid ? `AC••••${sid.slice(-4)}` : null,
    hasToken: Boolean(row?.twilio_auth_token_enc),
    phone: row?.twilio_phone_number ?? null,
    testNumber: row?.test_number ?? null,
    verified: Boolean(row?.verified_at),
    requestedMode: row?.requested_mode ?? "off",
    liveApproved: Boolean(row?.live_approved_at),
    effectiveMode: effective?.mode ?? "off",
    reason: effective?.reason ?? "Texting settings couldn't be loaded.",
    webhookUrl: `${protocol}://${host}/api/sms/inbound`,
  };
}
