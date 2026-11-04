import assert from "node:assert/strict";
import test from "node:test";

import { isValidTimeZone, US_TIME_ZONES } from "@/lib/schools/time-zones";

test("accepts IANA zones and rejects junk", () => {
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("America/Los_Angeles"), true);
  assert.equal(isValidTimeZone("Mars/Base"), false);
  assert.equal(isValidTimeZone(""), false);
});

test("every offered US zone is valid", () => {
  for (const zone of US_TIME_ZONES) assert.equal(isValidTimeZone(zone.value), true, zone.value);
});
