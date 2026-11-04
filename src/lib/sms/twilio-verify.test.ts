import assert from "node:assert/strict";
import test from "node:test";

import { verifyTwilioCredentials } from "@/lib/sms/twilio-verify";

const input = { accountSid: "AC" + "a".repeat(32), authToken: "t".repeat(32), phoneNumber: "+14135550000" };
const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

test("ok when the number is on the account", async () => {
  const seen: string[] = [];
  const result = await verifyTwilioCredentials(input, async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ incoming_phone_numbers: [{ phone_number: "+14135550000" }] }), { status: 200 });
  });
  assert.deepEqual(result, { ok: true });
  assert.match(seen[0], /IncomingPhoneNumbers\.json\?PhoneNumber=%2B14135550000/);
});

test("bad credentials", async () => {
  const result = await verifyTwilioCredentials(input, respond(401, { message: "Authenticate" }));
  assert.deepEqual(result, { ok: false, error: "Twilio rejected the Account SID or Auth Token." });
});

test("number not on this account", async () => {
  const result = await verifyTwilioCredentials(input, respond(200, { incoming_phone_numbers: [] }));
  assert.equal(result.ok, false);
});

test("network failure is reported, not thrown", async () => {
  const result = await verifyTwilioCredentials(input, async () => { throw new Error("offline"); });
  assert.equal(result.ok, false);
});
