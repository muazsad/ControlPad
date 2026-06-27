import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSettingsForm } from "./settings-validation";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
}

const validSettings = {
  grade_floor: "72",
  tardy_window_hours: "1.5",
  tardies_per_week: "3",
  quran_inactivity_days: "6",
  payment_due_day: "5",
  school_start: "08:00",
  admin_digest_time: "15:00",
};

describe("parseSettingsForm", () => {
  it("parses valid settings into database column values", () => {
    assert.deepEqual(parseSettingsForm(form(validSettings)), {
      ok: true,
      values: {
        grade_floor: 72,
        tardy_window_hours: 1.5,
        tardies_per_week: 3,
        quran_inactivity_days: 6,
        payment_due_day: 5,
        school_start: "08:00",
        admin_digest_time: "15:00",
      },
    });
  });

  it("rejects out-of-range numeric values", () => {
    assert.deepEqual(
      parseSettingsForm(
        form({
          ...validSettings,
          grade_floor: "101",
        }),
      ),
      {
        ok: false,
        error: "Grade floor must be between 0 and 100.",
      },
    );
  });

  it("rejects invalid time values", () => {
    assert.deepEqual(
      parseSettingsForm(
        form({
          ...validSettings,
          admin_digest_time: "25:00",
        }),
      ),
      {
        ok: false,
        error: "Admin digest time must use HH:MM format.",
      },
    );
  });
});
