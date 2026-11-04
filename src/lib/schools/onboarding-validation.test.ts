import assert from "node:assert/strict";
import test from "node:test";

import { parseCreateSchool } from "@/lib/schools/onboarding-validation";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

test("valid input, sms name defaults to school name, phone normalised", () => {
  const result = parseCreateSchool(form({
    school_name: "  Noor Academy ", sms_name: "", time_zone: "America/Chicago",
    full_name: "Sara Khan", phone: "(413) 555-0101",
  }));
  assert.deepEqual(result, {
    ok: true,
    values: { schoolName: "Noor Academy", smsName: "Noor Academy", timeZone: "America/Chicago", fullName: "Sara Khan", phone: "+14135550101" },
  });
});

test("rejects short names, bad zones, bad phones", () => {
  assert.equal(parseCreateSchool(form({ school_name: "N", time_zone: "America/Chicago", full_name: "S" })).ok, false);
  assert.equal(parseCreateSchool(form({ school_name: "Noor", time_zone: "Mars/Base", full_name: "S" })).ok, false);
  assert.equal(parseCreateSchool(form({ school_name: "Noor", time_zone: "America/Chicago", full_name: "" })).ok, false);
  assert.equal(parseCreateSchool(form({ school_name: "Noor", time_zone: "America/Chicago", full_name: "S", phone: "12" })).ok, false);
  assert.equal(parseCreateSchool(form({ school_name: "Noor", sms_name: "x".repeat(41), time_zone: "America/Chicago", full_name: "S" })).ok, false);
});

test("phone is optional", () => {
  const result = parseCreateSchool(form({ school_name: "Noor", time_zone: "America/Chicago", full_name: "S" }));
  assert.equal(result.ok && result.values.phone, null);
});
