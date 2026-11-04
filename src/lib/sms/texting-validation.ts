import { toE164 } from "@/lib/people/people";

export type TextingSetup = { accountSid: string; authToken: string | null; phone: string; testNumber: string | null };

const text = (f: FormData, k: string) => ((f.get(k) as string | null) ?? "").trim();

export function parseTextingSetup(f: FormData): { ok: true; values: TextingSetup } | { ok: false; error: string } {
  const accountSid = text(f, "account_sid");
  const authToken = text(f, "auth_token") || null;
  const phone = toE164(text(f, "phone"));
  const rawTest = text(f, "test_number");
  const testNumber = rawTest ? toE164(rawTest) : null;

  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) return { ok: false, error: "Account SID starts with AC and has 34 characters." };
  if (authToken && !/^[0-9a-zA-Z]{32}$/.test(authToken)) return { ok: false, error: "Auth Token is 32 letters and numbers." };
  if (!phone) return { ok: false, error: "Enter the Twilio phone number." };
  if (rawTest && !testNumber) return { ok: false, error: "Enter a valid test number." };
  return { ok: true, values: { accountSid, authToken, phone, testNumber } };
}
