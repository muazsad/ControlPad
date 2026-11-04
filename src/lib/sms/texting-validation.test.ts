import assert from "node:assert/strict";
import test from "node:test";

import { parseTextingSetup } from "@/lib/sms/texting-validation";

const form = (v: Record<string, string>) => { const f = new FormData(); for (const [k, x] of Object.entries(v)) f.set(k, x); return f; };
const sid = "AC" + "0123456789abcdef".repeat(2);

test("valid setup; blank token means keep the saved one", () => {
  assert.deepEqual(parseTextingSetup(form({ account_sid: ` ${sid} `, auth_token: "", phone: "413-555-0000", test_number: "" })), {
    ok: true, values: { accountSid: sid, authToken: null, phone: "+14135550000", testNumber: null },
  });
});

test("rejects bad sid, short token, bad phone", () => {
  assert.equal(parseTextingSetup(form({ account_sid: "AB12", auth_token: "", phone: "4135550000" })).ok, false);
  assert.equal(parseTextingSetup(form({ account_sid: sid, auth_token: "short", phone: "4135550000" })).ok, false);
  assert.equal(parseTextingSetup(form({ account_sid: sid, auth_token: "", phone: "12" })).ok, false);
});
