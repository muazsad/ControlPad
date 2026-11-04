// Every service-role query on a tenant table (or profiles) must mention
// school_id. The service role bypasses RLS, so this is the only guard besides
// composite FKs. Mark a deliberate exception with a comment within the three
// lines before `.from(`:   // tenant-scope-ok: <reason>
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { TENANT_TABLES } from "../src/lib/schools/tenant-tables.mjs";

const SCOPED = new Set([...TENANT_TABLES, "profiles"]);
const root = new URL("../src/", import.meta.url).pathname;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

test("service-role queries on tenant tables filter by school_id", () => {
  const problems = [];
  for (const file of files(root)) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("createServiceClient")) continue;
    if (file.endsWith("lib/supabase/server.ts")) continue;
    const lines = source.split("\n");
    for (const match of source.matchAll(/\.from\("(\w+)"\)/g)) {
      const table = match[1];
      if (!SCOPED.has(table)) continue;
      const lineIndex = source.slice(0, match.index).split("\n").length - 1;
      const before = lines.slice(Math.max(0, lineIndex - 3), lineIndex).join("\n");
      if (/tenant-scope-ok:/.test(before)) continue;
      // The query chain: from `.from(` up to the end of the statement.
      const rest = source.slice(match.index);
      const end = rest.search(/;\s*(\n|$)/);
      const chain = end === -1 ? rest : rest.slice(0, end);
      if (!/school_id/.test(chain)) problems.push(`${file.replace(root, "src/")}:${lineIndex + 1} ${table}`);
    }
  }
  assert.deepEqual(problems, [], `Unscoped service-role queries:\n${problems.join("\n")}`);
});
