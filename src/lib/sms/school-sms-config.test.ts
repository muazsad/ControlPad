import assert from "node:assert/strict";
import test from "node:test";

import { resolveSmsConfig, type SchoolSmsRow } from "@/lib/sms/school-sms-config";

const decrypt = (value: string) => value.replace("enc:", "");
const base: SchoolSmsRow = {
  twilio_account_sid: "AC123",
  twilio_auth_token_enc: "enc:token",
  twilio_phone_number: "+14135550000",
  verified_at: "2026-11-01T00:00:00Z",
  requested_mode: "live",
  live_approved_at: "2026-11-02T00:00:00Z",
  test_number: "+14135559999",
};

test("approved live with no env ceiling is live, with decrypted credentials", () => {
  const config = resolveSmsConfig(base, {}, decrypt);
  assert.equal(config.mode, "live");
  assert.deepEqual(config.twilio, { accountSid: "AC123", authToken: "token", fromPhone: "+14135550000" });
});

test("live waiting for approval falls back to test, or off without a test number", () => {
  assert.equal(resolveSmsConfig({ ...base, live_approved_at: null }, {}, decrypt).mode, "test");
  const off = resolveSmsConfig({ ...base, live_approved_at: null, test_number: null }, {}, decrypt);
  assert.equal(off.mode, "off");
  assert.match(off.reason, /approval/i);
});

test("not set up or unverified is off", () => {
  assert.equal(resolveSmsConfig(null, {}, decrypt).mode, "off");
  assert.equal(resolveSmsConfig({ ...base, verified_at: null }, {}, decrypt).mode, "off");
  assert.equal(resolveSmsConfig({ ...base, twilio_auth_token_enc: null }, {}, decrypt).mode, "off");
});

test("env SMS_MODE is a ceiling", () => {
  assert.equal(resolveSmsConfig(base, { SMS_MODE: "off" }, decrypt).mode, "off");
  assert.equal(resolveSmsConfig(base, { SMS_MODE: "test" }, decrypt).mode, "test");
  assert.equal(resolveSmsConfig({ ...base, requested_mode: "test" }, { SMS_MODE: "live" }, decrypt).mode, "test");
});

test("requested off is off; test without a test number is off", () => {
  assert.equal(resolveSmsConfig({ ...base, requested_mode: "off" }, {}, decrypt).mode, "off");
  assert.equal(resolveSmsConfig({ ...base, requested_mode: "test", test_number: null }, {}, decrypt).mode, "off");
});

test("a token that won't decrypt is off, not a crash", () => {
  const config = resolveSmsConfig(base, {}, () => { throw new Error("bad key"); });
  assert.equal(config.mode, "off");
  assert.match(config.reason, /decrypt/i);
});
