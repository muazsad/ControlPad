"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/current-profile";
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
