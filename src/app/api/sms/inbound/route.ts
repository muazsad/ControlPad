import { NextResponse, type NextRequest } from "next/server";

import { handleInboundSms } from "@/lib/absence-reports/inbound";
import { loadSchoolContext } from "@/lib/schools/schools-data";
import { credentialsKey, decryptSecret } from "@/lib/sms/credentials-crypto";
import { authenticateInbound } from "@/lib/sms/inbound-auth";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Twilio "A message comes in" webhook. Every school points its own number here
// (Settings → Texting). The school is the one that owns the `To` number, and
// X-Twilio-Signature must be valid for that school's auth token. Replies are
// sent through sendSms (so the school's texting mode and log apply), never as TwiML.

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(status = 200) {
  return new NextResponse(EMPTY_TWIML, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

async function findSchoolByNumber(to: string) {
  // tenant-scope-ok: looking up which school owns this Twilio number
  const { data, error } = await createServiceClient()
    .from("school_sms_config")
    .select("school_id, twilio_auth_token_enc")
    .eq("twilio_phone_number", to)
    .not("verified_at", "is", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.twilio_auth_token_enc) return null;
  return { schoolId: data.school_id as string, tokenEnc: data.twilio_auth_token_enc as string };
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });

  // Twilio signs the exact URL configured in its console. Behind Vercel's proxy
  // request.url matches it; TWILIO_INBOUND_URL overrides it if they ever differ.
  const url = process.env.TWILIO_INBOUND_URL?.trim() || request.url;

  let auth;
  try {
    auth = await authenticateInbound(
      { url, params, signature: request.headers.get("x-twilio-signature") },
      { findByNumber: findSchoolByNumber, decrypt: (sealed) => decryptSecret(sealed, credentialsKey()) },
    );
  } catch (error) {
    console.error("Inbound SMS lookup failed:", error instanceof Error ? error.message : "unknown error");
    return twiml(500);
  }
  if (!auth.ok) {
    if (auth.status === 403) return NextResponse.json({ error: "Invalid signature." }, { status: 403 });
    if (auth.status === 500) console.error("Inbound SMS: a school's Twilio token could not be decrypted.");
    return twiml(auth.status);
  }

  const ctx = await loadSchoolContext(auth.schoolId);
  const from = params.From?.trim();
  if (!ctx || !from) return twiml();

  try {
    await handleInboundSms(ctx, {
      from,
      body: params.Body ?? "",
      twilioSid: params.MessageSid ?? params.SmsSid ?? null,
    });
  } catch (error) {
    // No PII in logs: just the failure.
    console.error(
      "Inbound SMS failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return twiml(500);
  }

  return twiml();
}
