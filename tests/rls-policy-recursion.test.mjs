import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migrationsDir = new URL("../supabase/migrations/", import.meta.url);

function readMigrations() {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(join(migrationsDir.pathname, file), "utf8"),
    }));
}

function extractPolicies(sql) {
  const policyPattern =
    /create\s+policy\s+(\S+)\s+on\s+(\S+)([\s\S]*?);/gi;
  return [...sql.matchAll(policyPattern)].map((match) => ({
    name: match[1],
    table: match[2],
    body: match[3],
  }));
}

function extractDroppedPolicies(sql) {
  const dropPattern =
    /drop\s+policy\s+if\s+exists\s+(\S+)\s+on\s+(\S+)\s*;/gi;
  return [...sql.matchAll(dropPattern)].map((match) => ({
    name: match[1],
    table: match[2],
  }));
}

test("parent RLS policies avoid recursive student_guardians lookups", () => {
  const effectivePolicies = new Map();
  const offenders = [];

  for (const migration of readMigrations()) {
    for (const policy of extractDroppedPolicies(migration.sql)) {
      effectivePolicies.delete(`${policy.table}.${policy.name}`);
    }

    for (const policy of extractPolicies(migration.sql)) {
      effectivePolicies.set(`${policy.table}.${policy.name}`, {
        ...policy,
        file: migration.file,
      });
    }
  }

  for (const policy of effectivePolicies.values()) {
      const isParentPolicy = policy.name.includes("parent");
      const isStudentGuardiansPolicy = policy.table === "student_guardians";
      const directlyReadsStudentGuardians =
        /\bfrom\s+student_guardians\b/i.test(policy.body) ||
        /\bjoin\s+student_guardians\b/i.test(policy.body);

      if (
        isParentPolicy &&
        !isStudentGuardiansPolicy &&
        directlyReadsStudentGuardians
      ) {
      offenders.push(`${policy.file}: ${policy.name} on ${policy.table}`);
      }
  }

  assert.deepEqual(offenders, []);
});
