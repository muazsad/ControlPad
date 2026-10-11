import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { computeTwilioSignature, isValidTwilioSignature } from "./twilio-signature";

const url = "https://control-pad.vercel.app/api/sms/inbound";
const params = { From: "+14135550101", Body: "Amina sick", MessageSid: "SM123" };

describe("Twilio signature", () => {
  it("signs url + params sorted by key", () => {
    const expected = createHmac("sha1", "token")
      .update(`${url}BodyAmina sickFrom+14135550101MessageSidSM123`)
      .digest("base64");
    assert.equal(computeTwilioSignature("token", url, params), expected);
  });

  it("accepts a correct signature", () => {
    const signature = computeTwilioSignature("token", url, params);
    assert.equal(isValidTwilioSignature({ authToken: "token", url, params, signature }), true);
  });

  it("rejects a missing, wrong, or tampered signature", () => {
    const signature = computeTwilioSignature("token", url, params);
    assert.equal(isValidTwilioSignature({ authToken: "token", url, params, signature: null }), false);
    assert.equal(isValidTwilioSignature({ authToken: "other", url, params, signature }), false);
    assert.equal(
      isValidTwilioSignature({ authToken: "token", url, params: { ...params, Body: "x" }, signature }),
      false,
    );
  });
});
