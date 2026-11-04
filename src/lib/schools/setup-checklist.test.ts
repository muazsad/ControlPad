import assert from "node:assert/strict";
import test from "node:test";

import { buildSetupChecklist } from "@/lib/schools/setup-checklist";

test("items reflect counts; complete when all done", () => {
  const empty = buildSetupChecklist({ scheduleGroups: 0, staff: 0, students: 0, guardians: 0, textingVerified: false });
  assert.equal(empty.complete, false);
  assert.deepEqual(empty.items.map((i) => i.done), [false, false, false, false, false]);
  const full = buildSetupChecklist({ scheduleGroups: 1, staff: 1, students: 3, guardians: 2, textingVerified: true });
  assert.equal(full.complete, true);
});
