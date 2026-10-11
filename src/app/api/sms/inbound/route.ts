import { NextResponse, type NextRequest } from "next/server";

import { handleInboundSms } from "@/lib/absence-reports/inbound";
import { isValidTwilioSignature } from "@/lib/sms/twilio-signature";

export const dynamic = "force-dynamic";

// Twilio "A message comes in" webhook for the school number (docs/SETUP.md §3).
// Every request must carry a valid X-Twilio-Signature. Replies are sent through
// sendSms (so SMS_MODE and the notifications log apply), never as TwiML.

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(status = 200) {
  return new NextResponse(EMPTY_TWIML, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return NextResponse.json({ error: "Texting is not configured." }, { status: 503 });
  }

  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });

  // Twilio signs the exact URL configured in its console. Behind Vercel's proxy
  // request.url matches it; TWILIO_INBOUND_URL overrides it if they ever differ.
  const url = process.env.TWILIO_INBOUND_URL?.trim() || request.url;
  if (
    !isValidTwilioSignature({
      authToken,
      url,
      params,
      signature: request.headers.get("x-twilio-signature"),
    })
  ) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 403 });
  }

  const from = params.From?.trim();
  if (!from) return twiml();

  try {
    await handleInboundSms({
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
