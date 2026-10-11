import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSpecialDayForm } from "./special-day-validation";

function form(entries: [string, string][]) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("parseSpecialDayForm", () => {
  it("parses a scoped field trip with a parent message", () => {
    const result = parseSpecialDayForm(
      form([
        ["type", "field_trip"],
        ["students_expected", "on"],
        ["applies_to", "g1"],
        ["applies_to", "ungrouped"],
        ["parent_message", "Field trip Thursday."],
        ["notify_parents", "on"],
      ]),
    );
    assert.ok(result.ok);
    assert.deepEqual(result.values.applies_to, ["g1", "ungrouped"]);
    assert.equal(result.values.students_expected, true);
    assert.equal(result.values.send_attendance_alerts, false);
    assert.equal(result.values.notify_parents, true);
  });

  it("treats 'all' or nothing as the whole school", () => {
    const all = parseSpecialDayForm(form([["type", "other"], ["applies_to", "all"], ["applies_to", "g1"]]));
    assert.ok(all.ok);
    assert.equal(all.values.applies_to, null);
  });

  it("forces no_school to not expected, with no times or alerts", () => {
    const result = parseSpecialDayForm(
      form([
        ["type", "no_school"],
        ["students_expected", "on"],
        ["send_attendance_alerts", "on"],
        ["start_time", "08:00"],
        ["end_time", "12:00"],
      ]),
    );
    assert.ok(result.ok);
    assert.equal(result.values.students_expected, false);
    assert.equal(result.values.send_attendance_alerts, false);
    assert.equal(result.values.start_time, null);
  });

  it("requires times for schedule changes and a message for auto-texts", () => {
    assert.equal(parseSpecialDayForm(form([["type", "schedule_change"], ["students_expected", "on"]])).ok, false);
    assert.equal(parseSpecialDayForm(form([["type", "other"], ["notify_parents", "on"]])).ok, false);
    assert.equal(
      parseSpecialDayForm(form([["type", "other"], ["start_time", "10:00"], ["end_time", "09:00"], ["students_expected", "on"]])).ok,
      false,
    );
  });

  it("drops the parent message for range edits", () => {
    const result = parseSpecialDayForm(
      form([["type", "other"], ["parent_message", "hi"], ["notify_parents", "on"]]),
      { allowParentMessage: false },
    );
    assert.ok(result.ok);
    assert.equal(result.values.parent_message, null);
    assert.equal(result.values.notify_parents, false);
  });
});
