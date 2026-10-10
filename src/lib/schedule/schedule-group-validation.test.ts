import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseScheduleGroupForm } from "./schedule-group-validation";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const monday = {
  day_1_on: "on",
  day_1_start: "16:00",
  day_1_grace: "5",
  day_1_check: "16:30",
};

describe("parseScheduleGroupForm", () => {
  it("parses enabled days and ignores unchecked ones", () => {
    const result = parseScheduleGroupForm(
      form({
        name: " Quran only ",
        description: "",
        ...monday,
        day_2_start: "08:00", // not checked → ignored
        day_2_grace: "x",
        day_2_check: "07:00",
      }),
    );
    assert.deepEqual(result, {
      ok: true,
      values: {
        name: "Quran only",
        description: null,
        days: [{ weekday: 1, startTime: "16:00", tardyGraceMinutes: 5, absenceCheckTime: "16:30" }],
      },
    });
  });

  it("requires a name and at least one day", () => {
    assert.equal(parseScheduleGroupForm(form({ ...monday })).ok, false);
    const noDays = parseScheduleGroupForm(form({ name: "Empty" }));
    assert.deepEqual(noDays, { ok: false, error: "Pick at least one day this group attends." });
  });

  it("rejects bad times, grace, and a check before start", () => {
    const badTime = parseScheduleGroupForm(form({ name: "G", ...monday, day_1_start: "4pm" }));
    assert.match(badTime.ok ? "" : badTime.error, /Monday: start time/);

    const badGrace = parseScheduleGroupForm(form({ name: "G", ...monday, day_1_grace: "1.5" }));
    assert.match(badGrace.ok ? "" : badGrace.error, /tardy grace/);

    const early = parseScheduleGroupForm(form({ name: "G", ...monday, day_1_check: "15:00" }));
    assert.match(early.ok ? "" : early.error, /can't be before the start time/);
  });
});
