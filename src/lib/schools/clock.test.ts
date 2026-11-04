import assert from "node:assert/strict";
import test from "node:test";

import { localClock, localDate, localTimeToUtc } from "@/lib/schools/clock";

const now = new Date("2026-11-03T03:30:00.000Z"); // 22:30 Nov 2 Eastern, 19:30 Nov 2 Pacific

test("localClock uses the given zone", () => {
  assert.deepEqual(localClock(now, "America/New_York"), { date: "2026-11-02", minutes: 22 * 60 + 30 });
  assert.deepEqual(localClock(now, "America/Los_Angeles"), { date: "2026-11-02", minutes: 19 * 60 + 30 });
  assert.deepEqual(localClock(now, "UTC"), { date: "2026-11-03", minutes: 3 * 60 + 30 });
});

test("localDate is the date part", () => {
  assert.equal(localDate(now, "America/New_York"), "2026-11-02");
});

test("localTimeToUtc is DST-aware and zone-aware", () => {
  assert.equal(localTimeToUtc("2026-10-15", "19:00", "America/New_York").toISOString(), "2026-10-15T23:00:00.000Z");
  assert.equal(localTimeToUtc("2026-12-15", "08:00", "America/New_York").toISOString(), "2026-12-15T13:00:00.000Z");
  assert.equal(localTimeToUtc("2026-12-15", "08:00", "America/Los_Angeles").toISOString(), "2026-12-15T16:00:00.000Z");
});
