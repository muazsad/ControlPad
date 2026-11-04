import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { SERVICE_ONLY_TABLES, TENANT_TABLES } from "../src/lib/schools/tenant-tables.mjs";

const dir = new URL("../supabase/migrations/", import.meta.url).pathname;
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(dir, f), "utf8").replace(/--.*$/gm, ""))
  .join("\n");

const created = new Set(
  [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi)].map((m) => m[1]),
);

function finalPolicies() {
  const policies = new Map(); // "table.name" -> body
  const pattern =
    /(create\s+policy\s+(\S+)\s+on\s+(?:public\.)?(\w+)([\s\S]*?);)|(drop\s+policy\s+if\s+exists\s+(\S+)\s+on\s+(?:public\.)?(\w+)\s*'?\s*;)/gi; // '? : drops inside execute '...'
  for (const m of sql.matchAll(pattern)) {
    if (m[1]) policies.set(`${m[3]}.${m[2]}`, m[4]);
    else policies.delete(`${m[7]}.${m[6]}`);
  }
  return policies;
}

test("every created table has RLS enabled", () => {
  for (const table of created) {
    assert.match(
      sql,
      new RegExp(`alter\\s+table\\s+(?:public\\.)?${table}\\s+enable\\s+row\\s+level\\s+security`, "i"),
      `${table} has no RLS`,
    );
  }
});

test("every tenant table that exists has a school_id column", () => {
  for (const table of TENANT_TABLES) {
    if (!created.has(table)) continue; // e.g. juz_tests before PR #7 merges
    const inCreate = new RegExp(
      `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\s*\\([^;]*\\bschool_id\\b`,
      "i",
    ).test(sql);
    const added = new RegExp(
      `alter\\s+table\\s+(?:public\\.)?${table}\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?school_id\\b`,
      "i",
    ).test(sql);
    assert.ok(inCreate || added, `${table} has no school_id`);
  }
});

test("every policy on a tenant table checks current_school_id()", () => {
  for (const [key, body] of finalPolicies()) {
    const table = key.split(".")[0];
    if (!TENANT_TABLES.includes(table)) continue;
    assert.match(body, /current_school_id\(\)/i, `${key} does not check the school`);
  }
});

test("profiles policies are school-scoped or own-row only", () => {
  for (const [key, body] of finalPolicies()) {
    if (!key.startsWith("profiles.")) continue;
    assert.ok(
      /current_school_id\(\)/i.test(body) || /id\s*=\s*auth\.uid\(\)/i.test(body),
      `${key} is neither school-scoped nor own-row`,
    );
    assert.doesNotMatch(body, /for\s+insert/i, `${key}: users must not insert their own profile`);
  }
});

test("service-only tables have no policies", () => {
  for (const [key] of finalPolicies()) {
    assert.ok(!SERVICE_ONLY_TABLES.includes(key.split(".")[0]), `${key} must not exist`);
  }
});
