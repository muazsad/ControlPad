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
  parent_alert_delay_minutes: "60",
  term_start: "2026-09-01",
  term_end: "2027-06-10",
  pace_gap_threshold: "10",
  missing_assignments_threshold: "3",
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
        parent_alert_delay_minutes: 60,
        term_start: "2026-09-01",
        term_end: "2027-06-10",
        pace_gap_threshold: 10,
        missing_assignments_threshold: 3,
      },
    });
  });

  it("allows blank term dates but only as a pair", () => {
    const blank = parseSettingsForm(form({ ...validSettings, term_start: "", term_end: "" }));
    assert.equal(blank.ok, true);
    if (blank.ok) {
      assert.equal(blank.values.term_start, null);
      assert.equal(blank.values.term_end, null);
    }
    assert.equal(parseSettingsForm(form({ ...validSettings, term_end: "" })).ok, false);
  });

  it("rejects a term that ends before it starts and bad pace thresholds", () => {
    assert.equal(
      parseSettingsForm(form({ ...validSettings, term_end: "2026-08-01" })).ok,
      false,
    );
    assert.equal(parseSettingsForm(form({ ...validSettings, pace_gap_threshold: "0" })).ok, false);
    assert.equal(
      parseSettingsForm(form({ ...validSettings, missing_assignments_threshold: "2.5" })).ok,
      false,
    );
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
