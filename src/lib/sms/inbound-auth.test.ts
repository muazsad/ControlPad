import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { authenticateInbound } from "./inbound-auth";
import { computeTwilioSignature } from "./twilio-signature";

const url = "https://app.example/api/sms/inbound";
const params = { From: "+14135550101", To: "+14135550000", Body: "Amina sick today" };
const schools = new Map([
  ["+14135550000", { schoolId: "school-a", tokenEnc: "enc:token-a" }],
  ["+14135559999", { schoolId: "school-b", tokenEnc: "enc:token-b" }],
]);
const deps = {
  findByNumber: async (to: string) => schools.get(to) ?? null,
  decrypt: (sealed: string) => sealed.replace("enc:", ""),
};

describe("authenticateInbound", () => {
  it("accepts a text signed with the receiving school's token", async () => {
    const signature = computeTwilioSignature("token-a", url, params);
    assert.deepEqual(await authenticateInbound({ url, params, signature }, deps), {
      ok: true,
      schoolId: "school-a",
    });
  });

  it("rejects a text signed with another school's token", async () => {
    const signature = computeTwilioSignature("token-b", url, params);
    assert.deepEqual(await authenticateInbound({ url, params, signature }, deps), {
      ok: false,
      status: 403,
    });
  });

  it("rejects a missing signature", async () => {
    assert.deepEqual(await authenticateInbound({ url, params, signature: null }, deps), {
      ok: false,
      status: 403,
    });
  });

  it("ignores numbers no school owns, before checking anything else", async () => {
    const unknown = { ...params, To: "+14135551111" };
    assert.deepEqual(await authenticateInbound({ url, params: unknown, signature: "x" }, deps), {
      ok: false,
      status: 200,
    });
  });

  it("fails closed when the token can't be decrypted", async () => {
    const signature = computeTwilioSignature("token-a", url, params);
    const broken = { ...deps, decrypt: () => { throw new Error("bad key"); } };
    assert.deepEqual(await authenticateInbound({ url, params, signature }, broken), {
      ok: false,
      status: 500,
    });
  });
});
