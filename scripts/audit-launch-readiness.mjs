import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationPath = path.join(
  root,
  "supabase/migrations/20260626000000_initial_schema.sql",
);
const gitignorePath = path.join(root, ".gitignore");
const srcDir = path.join(root, "src");

const appTables = [
  "profiles",
  "students",
  "guardians",
  "student_guardians",
  "courses",
  "grades",
  "attendance",
  "quran_progress",
  "payments",
  "settings",
  "notifications",
];

const requiredPolicySnippets = [
  {
    label: "settings admin write",
    pattern:
      /create policy settings_admin_all on settings[\s\S]*?for all using \(public\.user_role\(\) = 'admin'\)[\s\S]*?with check \(public\.user_role\(\) = 'admin'\)/,
  },
  {
    label: "settings moderator read-only",
    pattern:
      /create policy settings_moderator_read on settings[\s\S]*?for select using \(public\.user_role\(\) = 'moderator'\)/,
  },
  {
    label: "payments moderator read-only",
    pattern:
      /create policy payments_moderator_read on payments[\s\S]*?for select using \(public\.user_role\(\) = 'moderator'\)/,
  },
  {
    label: "payments parent own children",
    pattern:
      /create policy payments_parent_read on payments[\s\S]*?where sg\.student_id = payments\.student_id and g\.user_id = auth\.uid\(\)/,
  },
  {
    label: "students parent own children",
    pattern:
      /create policy students_parent_read on students[\s\S]*?where sg\.student_id = students\.id and g\.user_id = auth\.uid\(\)/,
  },
];

const clientFilePatterns = [
  /"use client";/,
  /src\/lib\/supabase\/client\.ts$/,
  /src\/components\//,
];

const forbiddenClientSecrets = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "CRON_SECRET",
];

const thresholdNeedles = [
  {
    label: "grade floor literal",
    pattern: /\b(value|grade|grade_value)\s*[<>=!]+\s*70\b/,
  },
  {
    label: "Quran inactivity literal",
    pattern: /\bdays\s*[<>=!]+\s*7\b/,
  },
  {
    label: "settings default fallback literal",
    pattern: /\?\?\s*(70|7|5|3|2)\b/,
  },
];

const ignoredThresholdFiles = [
  /settings-validation\.test\.ts$/,
  /alerts\/.*\.test\.ts$/,
  /DATA_MODEL\.md$/,
  /PROJECT_PLAN\.md$/,
  /BUILD_PROMPTS\.md$/,
  /SETUP\.md$/,
  /20260626000000_initial_schema\.sql$/,
];

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function rel(file) {
  return path.relative(root, file);
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message) {
  console.error(`FAIL ${message}`);
}

const failures = [];
const migration = readFileSync(migrationPath, "utf8");

for (const table of appTables) {
  const pattern = new RegExp(`alter table ${table} enable row level security;`);
  if (pattern.test(migration)) {
    pass(`RLS enabled on ${table}`);
  } else {
    failures.push(`RLS is not enabled on ${table}`);
  }
}

for (const { label, pattern } of requiredPolicySnippets) {
  if (pattern.test(migration)) {
    pass(`RLS policy present: ${label}`);
  } else {
    failures.push(`Missing expected RLS policy: ${label}`);
  }
}

const gitignore = readFileSync(gitignorePath, "utf8");
if (/^\.env\*$/m.test(gitignore)) {
  pass(".env files are gitignored");
} else {
  failures.push(".gitignore must include .env*");
}

const srcFiles = walkFiles(srcDir).filter((file) => /\.(ts|tsx)$/.test(file));
for (const file of srcFiles) {
  const relative = rel(file);
  const content = readFileSync(file, "utf8");
  const isClientReachable = clientFilePatterns.some((pattern) =>
    pattern.test(content) || pattern.test(relative),
  );

  if (!isClientReachable) continue;

  for (const secret of forbiddenClientSecrets) {
    if (content.includes(secret)) {
      failures.push(`${relative} references server-only secret ${secret}`);
    }
  }
}

if (!failures.some((item) => item.includes("server-only secret"))) {
  pass("No server-only secrets referenced by client/browser modules");
}

const thresholdFindings = [];
for (const file of srcFiles) {
  const relative = rel(file);
  if (ignoredThresholdFiles.some((pattern) => pattern.test(relative))) {
    continue;
  }

  const content = readFileSync(file, "utf8");
  for (const { label, pattern } of thresholdNeedles) {
    if (pattern.test(content)) {
      thresholdFindings.push(`${relative}: ${label}`);
    }
  }
}

if (thresholdFindings.length === 0) {
  pass("No remaining app threshold hardcode candidates found");
} else {
  failures.push(
    `Threshold hardcode candidates remain:\n${thresholdFindings
      .map((item) => `  - ${item}`)
      .join("\n")}`,
  );
}

if (failures.length > 0) {
  for (const message of failures) {
    fail(message);
  }
  process.exit(1);
}

console.log("Launch readiness audit passed.");
