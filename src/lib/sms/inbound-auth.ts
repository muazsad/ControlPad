import { isValidTwilioSignature } from "@/lib/sms/twilio-signature";

// Decides which school an incoming text belongs to and whether Twilio really
// sent it: the school is the one that owns the `To` number, and the signature
// must be valid for *that* school's auth token (spec §7.4).

export type InboundSchool = { schoolId: string; tokenEnc: string };

export type InboundAuthResult =
  | { ok: true; schoolId: string }
  /** 200 = ignore quietly (unknown number); 403 = bad signature; 500 = our fault. */
  | { ok: false; status: 200 | 403 | 500 };

export async function authenticateInbound(
  input: { url: string; params: Record<string, string>; signature: string | null },
  deps: {
    findByNumber: (to: string) => Promise<InboundSchool | null>;
    decrypt: (sealed: string) => string;
  },
): Promise<InboundAuthResult> {
  const to = input.params.To?.trim();
  if (!to) return { ok: false, status: 200 };

  const school = await deps.findByNumber(to);
  if (!school) return { ok: false, status: 200 };

  let authToken: string;
  try {
    authToken = deps.decrypt(school.tokenEnc);
  } catch {
    return { ok: false, status: 500 };
  }

  const valid = isValidTwilioSignature({
    authToken,
    url: input.url,
    params: input.params,
    signature: input.signature,
  });
  return valid ? { ok: true, schoolId: school.schoolId } : { ok: false, status: 403 };
}
