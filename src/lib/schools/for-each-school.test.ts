import assert from "node:assert/strict";
import test from "node:test";

import { forEachSchool } from "@/lib/schools/for-each-school";
import type { SchoolContext } from "@/lib/schools/school-context";

const school = (id: string): SchoolContext => ({ schoolId: id, name: id, smsName: id, timeZone: "UTC" });

test("runs every school and isolates failures", async () => {
  const logged: string[] = [];
  const results = await forEachSchool(
    [school("a"), school("b"), school("c")],
    async (ctx) => {
      if (ctx.schoolId === "b") throw new Error("boom");
      return ctx.schoolId.toUpperCase();
    },
    { log: (line) => logged.push(line) },
  );
  assert.deepEqual(results, [
    { schoolId: "a", ok: true, result: "A" },
    { schoolId: "b", ok: false, error: "boom" },
    { schoolId: "c", ok: true, result: "C" },
  ]);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /school b/);
});
