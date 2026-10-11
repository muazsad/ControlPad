import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio's request signature: base64(HMAC-SHA1(authToken, url + each POST
 * param as key+value, sorted by key)). Compared in constant time.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
}

export function isValidTwilioSignature(input: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string | null;
}): boolean {
  if (!input.signature) return false;
  const expected = Buffer.from(computeTwilioSignature(input.authToken, input.url, input.params));
  const actual = Buffer.from(input.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
