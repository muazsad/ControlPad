// Server-only. Confirms Twilio credentials work and the number belongs to the account.
export type VerifyResult = { ok: true } | { ok: false; error: string };

export async function verifyTwilioCredentials(
  input: { accountSid: string; authToken: string; phoneNumber: string },
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult> {
  const url =
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}` +
    `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(input.phoneNumber)}`;
  const auth = Buffer.from(`${input.accountSid}:${input.authToken}`).toString("base64");
  try {
    const response = await fetchImpl(url, { headers: { Authorization: `Basic ${auth}` } });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "Twilio rejected the Account SID or Auth Token." };
    }
    if (!response.ok) return { ok: false, error: `Twilio returned ${response.status}.` };
    const payload = (await response.json()) as { incoming_phone_numbers?: unknown[] };
    if (!payload.incoming_phone_numbers?.length) {
      return { ok: false, error: "That phone number isn't on this Twilio account." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach Twilio. Try again." };
  }
}
