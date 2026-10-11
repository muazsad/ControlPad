"use server";

import { revalidatePath } from "next/cache";

import { handleInboundSms } from "@/lib/absence-reports/inbound";
import { requireRole } from "@/lib/auth/current-profile";
import { toE164 } from "@/lib/people/people";
import { maskPhone, sendSms } from "@/lib/sms/send-sms";
import { createClient } from "@/lib/supabase/server";

export type TestTextState = { error: string | null; success: string | null };

/** Sends a test text to the signed-in admin's own phone (profiles.phone). */
export async function sendTestText(): Promise<TestTextState> {
  const profile = await requireRole(["admin"]);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("phone")
    .eq("id", profile.id)
    .single();

  if (error) return { error: error.message, success: null };
  const phone = (data?.phone as string | null)?.trim();
  if (!phone) {
    return {
      error: "Your profile has no phone number. Add one on the Staff page first.",
      success: null,
    };
  }

  const result = await sendSms({
    recipientPhone: phone,
    recipientType: "admin",
    studentId: null,
    triggerType: "manual_test",
    body: "ControlPad test message. If you received this, texting is working.",
    dedupeWindowHours: 0,
  });

  revalidatePath("/messages");

  if (result.status === "failed") {
    return { error: `Twilio rejected the message: ${result.error}`, success: null };
  }
  if (result.status === "dry_run") {
    return {
      error: null,
      success: "Logged as a dry run — texting isn't turned on yet, so nothing was sent.",
    };
  }
  return { error: null, success: `Test text sent to ${maskPhone(phone)}.` };
}

export type SimulateInboundState = { error: string | null; success: string | null };

/** Longest simulated message accepted (a few SMS segments). */
const MAX_SIMULATED_BODY = 500;

const outcomeText = {
  absence_report: "Recorded as an absence report — review it on Attendance.",
  needs_child: "The parent was asked which child. Simulate their reply from the same number.",
  forwarded: "Not an absence — forwarded to admin.",
  ignored: "Carrier keyword — ignored (Twilio answers these itself).",
  duplicate: "Already processed.",
} as const;

/**
 * Runs a pretend incoming text through the same code as the Twilio webhook, so
 * parent-reported absences can be tried before texting is live. Replies follow
 * SMS_MODE like any other text (dry runs while texting is off).
 */
export async function simulateInboundText(
  _prev: SimulateInboundState,
  form: FormData,
): Promise<SimulateInboundState> {
  await requireRole(["admin"]);

  const from = toE164((form.get("from") as string | null) ?? "");
  const body = ((form.get("body") as string | null) ?? "").trim();
  if (!from) return { error: "Enter the parent's phone number, e.g. (413) 555-0101.", success: null };
  if (!body) return { error: "Enter the message text.", success: null };
  if (body.length > MAX_SIMULATED_BODY) {
    return { error: `Keep the message under ${MAX_SIMULATED_BODY} characters.`, success: null };
  }

  try {
    const result = await handleInboundSms({ from, body, twilioSid: null, simulated: true });
    revalidatePath("/messages");
    revalidatePath("/attendance");
    revalidatePath("/");
    return { error: null, success: outcomeText[result.outcome] };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not process the message.",
      success: null,
    };
  }
}
