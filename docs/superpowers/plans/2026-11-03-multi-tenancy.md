# Multi-tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn ControlPad from a single-school app into one where anyone can sign up, create a school, bring their own Twilio account, and use every feature, with each school's data isolated by Postgres RLS.

**Architecture:** One database. A `schools` table, and `school_id` on every tenant table, defaulting to `current_school_id()` (read from `profiles.school_id`). RLS checks it on every policy, and composite foreign keys stop rows pointing across schools. Service-role code (crons, alerts, SMS, the inbound webhook) gets a `SchoolContext` and filters every query by `school_id`. Static tests enforce both rules. Twilio credentials are stored per school, AES-256-GCM encrypted with a server-only key. Live texting needs approval from a platform admin.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (Postgres 15+, RLS, pgTAP via `supabase test db`), Twilio REST API, Node test runner + `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-03-multi-tenancy-design.md`. Read it first. The § numbers below refer to it.

---

## Ground rules for every task

- Work in the `feat/multi-tenant` worktree (`.claude/worktrees/multi-tenant`). Never switch branches in the main checkout.
- Commit after every task. `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run build` must pass at the end of every phase and after every task, **except** these known red stretches: Tasks 1–3 (green again after Task 4) and Tasks 14–16 (shared loaders change signature in 14; the alert files catch up in 16). Never push in the middle of a red stretch.
- **Do not apply migrations** to any hosted Supabase project and don't create accounts. Owner steps are collected in Task 33.
- No PII in logs: log school ids and counts, never phones, names or message bodies.
- Commit at the end of each task with the message shown, plus the trailer:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## File map

**Created**
| File | Responsibility |
|---|---|
| `supabase/migrations/20261103000000_schools.sql` | `schools`, `school_sms_config`, `platform_admins`, `profiles.school_id`, `current_school_id()`, archive school |
| `supabase/migrations/20261103000100_school_id_columns.sql` | `school_id` on every tenant table, backfill, composite FKs, per-school keys |
| `supabase/migrations/20261103000200_tenant_rls.sql` | Helper rewrites, `create_school()`, every policy recreated with the school check |
| `supabase/migrations/20261103000300_tick_all_day.sql` | pg_cron tick every 10 min, 24 h |
| `supabase/tests/tenant_isolation.test.sql` | pgTAP behavioural isolation test |
| `tests/tenant-rls.test.mjs` | Static: RLS + `school_id` + policy school check on every tenant table |
| `tests/service-role-school-scope.test.mjs` | Static: service-role queries on tenant tables mention `school_id` |
| `scripts/delete-archive-school.mjs` | Owner-run deletion of the pre-tenancy archive |
| `src/lib/schools/tenant-tables.mjs` | Single list of tenant table names (shared by both static tests) |
| `src/lib/schools/time-zones.ts` (+ test) | `US_TIME_ZONES`, `isValidTimeZone()` |
| `src/lib/schools/clock.ts` (+ test) | `localClock(now, tz)`, `localDate(now, tz)` |
| `src/lib/schools/school-context.ts` | `SchoolContext` type, `contextFromProfile()` |
| `src/lib/schools/schools-data.ts` | `loadSchoolContext(id)`, `listActiveSchools()` (service role) |
| `src/lib/schools/for-each-school.ts` (+ test) | Per-school loop with error isolation |
| `src/lib/schools/onboarding-validation.ts` (+ test) | Parse/validate the create-school form |
| `src/lib/sms/credentials-crypto.ts` (+ test) | `encryptSecret()` / `decryptSecret()` |
| `src/lib/sms/school-sms-config.ts` (+ test) | `resolveSmsConfig()` (pure) + `loadSchoolSmsConfig()` |
| `src/lib/sms/twilio-verify.ts` (+ test) | `verifyTwilioCredentials()` |
| `src/lib/sms/texting-validation.ts` (+ test) | Parse/validate the Texting form |
| `src/lib/auth/platform-admin.ts` | `requirePlatformAdmin()` |
| `src/lib/schools/setup-checklist.ts` (+ test) | Pure checklist builder |
| `src/app/signup/page.tsx` | Sign-up form |
| `src/app/onboarding/page.tsx`, `actions.ts`, `onboarding-form.tsx` | Create school |
| `src/app/platform/page.tsx`, `actions.ts` | Platform admin school list + live approval |
| `src/app/settings/school-form.tsx`, `texting-form.tsx` | School and Texting cards |
| `src/components/controlpad/setup-checklist.tsx` | Dashboard checklist card |

**Modified (main ones)**: `src/lib/auth/current-profile.ts`, `src/lib/auth/admin-accounts.ts`, `src/lib/supabase/middleware.ts`, `src/lib/sms/send-sms.ts`, every `src/lib/alerts/*.ts` data factory, `src/lib/absence-reports/inbound.ts`, `src/lib/announcements/{announcements,send}.ts`, `src/lib/schedule/{calendar-data,schedule-groups-data}.ts`, `src/lib/grades/{pace-data,sweep}.ts`, `src/app/api/cron/*/route.ts`, `src/app/api/sms/inbound/route.ts`, every page/action that reads `settings` / `school_weekly_patterns`, `src/app/setup-profile/*`, `src/app/login/page.tsx`, `src/components/controlpad/{brand,app-shell}.tsx`, `src/app/layout.tsx`, docs.

---

## Phase 0 — Setup

### Task 0: Prepare the worktree

- [ ] **Step 1: Check PR muazsad/ControlPad#7 (juz tests).**
  Run: `gh pr view 7 --repo muazsad/ControlPad --json state`
  - If `MERGED`: `git fetch origin && git rebase origin/main`. `juz_tests` now exists and is covered by Task 3.
  - If still `OPEN`: continue. Task 3 handles `juz_tests` with a `to_regclass` guard. Before #7 merges, **its** migration must be updated to add the `school_id` column, composite FK and RLS school check (see Task 3 Step 3's guard comment). Note this on the PR.
- [ ] **Step 2:** `npm ci`
- [ ] **Step 3: Baseline.** `npm test` → all pass (note the count). `npm run build` → succeeds.

---

## Phase 1 — Schema, RLS, tests (spec §3–5)

### Task 1: Shared tenant-table list + failing static RLS test

**Files:** Create `src/lib/schools/tenant-tables.mjs`, `tests/tenant-rls.test.mjs`

- [ ] **Step 1: Write the tenant table list**

```js
// src/lib/schools/tenant-tables.mjs
// Every table whose rows belong to one school. Each must have a not-null
// school_id, RLS enabled, and only policies that check current_school_id().
// Used by tests/tenant-rls.test.mjs and tests/service-role-school-scope.test.mjs.
export const TENANT_TABLES = [
  "students",
  "guardians",
  "student_guardians",
  "courses",
  "grades",
  "attendance",
  "quran_progress",
  "student_memorized_juz",
  "juz_tests",
  "payments",
  "notifications",
  "settings",
  "school_weekly_patterns",
  "school_breaks",
  "school_special_days",
  "schedule_groups",
  "schedule_group_days",
  "inbound_messages",
  "absence_reports",
  "announcements",
  "school_sms_config",
];

// Tables that may only be touched by the service role (RLS on, no policies).
export const SERVICE_ONLY_TABLES = ["school_sms_config", "platform_admins"];
```

- [ ] **Step 2: Write the static test**

```js
// tests/tenant-rls.test.mjs
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
```

- [ ] **Step 3: Run.** `node --test tests/tenant-rls.test.mjs`
  Expected: FAIL. The school_id and policy tests fail (e.g. "students has no school_id").
- [ ] **Step 4: Commit:** `git add src/lib/schools/tenant-tables.mjs tests/tenant-rls.test.mjs && git commit -m "Multi-tenancy: static tenant RLS test (failing)"`

`npm test` is red until Task 4. That's expected inside this phase; don't push in between.

### Task 2: Migration — schools, SMS config, platform admins, archive school

**Files:** Create `supabase/migrations/20261103000000_schools.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Multi-tenancy, step 1 of 4 (docs/superpowers/specs/2026-11-03-multi-tenancy-design.md §3).
-- Additive. Creates schools and the archive school that holds all pre-tenancy data.

begin;

create table if not exists schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 2 and 80),
  sms_name    text not null check (length(trim(sms_name)) between 2 and 40),
  time_zone   text not null default 'America/New_York',
  archived    boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists schools_updated_at on schools;
create trigger schools_updated_at before update on schools
  for each row execute function update_updated_at();

alter table schools enable row level security;

-- Per-school Twilio setup. RLS on and NO policies: service role only.
create table if not exists school_sms_config (
  school_id              uuid primary key references schools(id) on delete cascade,
  twilio_account_sid     text,
  twilio_auth_token_enc  text,
  twilio_phone_number    text unique,
  verified_at            timestamptz,
  requested_mode         text not null default 'off' check (requested_mode in ('off', 'test', 'live')),
  live_approved_at       timestamptz,
  live_approved_by       uuid references auth.users(id) on delete set null,
  test_number            text,
  updated_at             timestamptz not null default now()
);

alter table school_sms_config enable row level security;

create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table platform_admins enable row level security;

alter table profiles add column if not exists school_id uuid references schools(id) on delete cascade;
create index if not exists profiles_school_id_idx on profiles (school_id);

-- The archive school: every pre-tenancy row moves here (spec §3.5). Fixed id so
-- later migrations and scripts can refer to it.
insert into schools (id, name, sms_name, archived)
values ('00000000-0000-0000-0000-000000000001', 'Pre-multi-tenant archive', 'Archive', true)
on conflict (id) do nothing;

update profiles set school_id = '00000000-0000-0000-0000-000000000001' where school_id is null;

-- The signed-in user's school, or null if they have none or it is archived.
create or replace function public.current_school_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select p.school_id
  from public.profiles p
  join public.schools s on s.id = p.school_id
  where p.id = auth.uid() and not s.archived
$$;

revoke all on function public.current_school_id() from public;
grant execute on function public.current_school_id() to authenticated, service_role;

commit;
```

- [ ] **Step 2: Commit:** `git add supabase/migrations/20261103000000_schools.sql && git commit -m "Multi-tenancy: schools, sms config, platform admins, archive school"`

### Task 3: Migration — `school_id` on every tenant table

**Files:** Create `supabase/migrations/20261103000100_school_id_columns.sql`

Composite FKs use `on delete set null (col)` (Postgres 15+). Owner check in Task 33: `select version();` ≥ 15.

- [ ] **Step 1: Write the migration** (written out per table on purpose: the static test reads it, and reviewers can see each table)

```sql
-- Multi-tenancy, step 2 of 4 (spec §3.2–3.5). Adds school_id everywhere,
-- backfills pre-tenancy rows into the archive school, then locks it down.

begin;

-- 1. Columns (nullable for the backfill).
alter table students              add column if not exists school_id uuid references schools(id) on delete cascade;
alter table guardians             add column if not exists school_id uuid references schools(id) on delete cascade;
alter table student_guardians     add column if not exists school_id uuid references schools(id) on delete cascade;
alter table courses               add column if not exists school_id uuid references schools(id) on delete cascade;
alter table grades                add column if not exists school_id uuid references schools(id) on delete cascade;
alter table attendance            add column if not exists school_id uuid references schools(id) on delete cascade;
alter table quran_progress        add column if not exists school_id uuid references schools(id) on delete cascade;
alter table student_memorized_juz add column if not exists school_id uuid references schools(id) on delete cascade;
alter table payments              add column if not exists school_id uuid references schools(id) on delete cascade;
alter table notifications         add column if not exists school_id uuid references schools(id) on delete cascade;
alter table settings              add column if not exists school_id uuid references schools(id) on delete cascade;
alter table school_weekly_patterns add column if not exists school_id uuid references schools(id) on delete cascade;
alter table school_breaks         add column if not exists school_id uuid references schools(id) on delete cascade;
alter table school_special_days   add column if not exists school_id uuid references schools(id) on delete cascade;
alter table schedule_groups       add column if not exists school_id uuid references schools(id) on delete cascade;
alter table schedule_group_days   add column if not exists school_id uuid references schools(id) on delete cascade;
alter table inbound_messages      add column if not exists school_id uuid references schools(id) on delete cascade;
alter table absence_reports       add column if not exists school_id uuid references schools(id) on delete cascade;
alter table announcements         add column if not exists school_id uuid references schools(id) on delete cascade;

-- 2. Backfill + not null + default, for each table above.
do $$
declare
  t text;
  archive constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  foreach t in array array[
    'students','guardians','student_guardians','courses','grades','attendance',
    'quran_progress','student_memorized_juz','payments','notifications','settings',
    'school_weekly_patterns','school_breaks','school_special_days','schedule_groups',
    'schedule_group_days','inbound_messages','absence_reports','announcements'
  ] loop
    execute format('update public.%I set school_id = %L where school_id is null', t, archive);
    execute format('alter table public.%I alter column school_id set not null', t);
    execute format('alter table public.%I alter column school_id set default public.current_school_id()', t);
    execute format('create index if not exists %I on public.%I (school_id)', t || '_school_id_idx', t);
  end loop;
end $$;

-- 3. juz_tests (PR #7). If it exists, give it the same treatment. If PR #7 merges
--    AFTER this migration has run, its own migration must add school_id, the
--    composite FK and the school-checked policies instead.
do $$
begin
  if to_regclass('public.juz_tests') is not null then
    alter table juz_tests add column if not exists school_id uuid references schools(id) on delete cascade;
    update juz_tests set school_id = '00000000-0000-0000-0000-000000000001' where school_id is null;
    alter table juz_tests alter column school_id set not null;
    alter table juz_tests alter column school_id set default public.current_school_id();
    create index if not exists juz_tests_school_id_idx on juz_tests (school_id);
  end if;
end $$;

-- 4. Parent keys for composite FKs.
alter table students        add constraint students_id_school_key        unique (id, school_id);
alter table guardians       add constraint guardians_id_school_key       unique (id, school_id);
alter table courses         add constraint courses_id_school_key         unique (id, school_id);
alter table schedule_groups add constraint schedule_groups_id_school_key unique (id, school_id);
alter table inbound_messages add constraint inbound_messages_id_school_key unique (id, school_id);

-- 5. Composite FKs: a child row's school must match its parent's.
alter table student_guardians
  add constraint student_guardians_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade,
  add constraint student_guardians_guardian_school_fkey
    foreign key (guardian_id, school_id) references guardians (id, school_id) on delete cascade;
alter table courses
  add constraint courses_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade;
alter table grades
  add constraint grades_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade,
  add constraint grades_course_school_fkey
    foreign key (course_id, school_id) references courses (id, school_id) on delete cascade;
alter table attendance
  add constraint attendance_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade;
alter table quran_progress
  add constraint quran_progress_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade;
alter table student_memorized_juz
  add constraint student_memorized_juz_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade;
alter table payments
  add constraint payments_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade;
alter table absence_reports
  add constraint absence_reports_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete cascade,
  add constraint absence_reports_guardian_school_fkey
    foreign key (guardian_id, school_id) references guardians (id, school_id) on delete set null (guardian_id),
  add constraint absence_reports_inbound_school_fkey
    foreign key (inbound_message_id, school_id) references inbound_messages (id, school_id)
    on delete set null (inbound_message_id);
alter table inbound_messages
  add constraint inbound_messages_guardian_school_fkey
    foreign key (guardian_id, school_id) references guardians (id, school_id) on delete set null (guardian_id);
alter table notifications
  add constraint notifications_student_school_fkey
    foreign key (student_id, school_id) references students (id, school_id) on delete set null (student_id);
alter table students
  add constraint students_group_school_fkey
    foreign key (schedule_group_id, school_id) references schedule_groups (id, school_id)
    on delete set null (schedule_group_id);
alter table schedule_group_days
  add constraint schedule_group_days_group_school_fkey
    foreign key (group_id, school_id) references schedule_groups (id, school_id) on delete cascade;

do $$
begin
  if to_regclass('public.juz_tests') is not null then
    alter table juz_tests
      add constraint juz_tests_student_school_fkey
        foreign key (student_id, school_id) references students (id, school_id) on delete cascade;
  end if;
end $$;

-- 6. Single-row tables become one row per school (spec §3.3).
alter table settings drop constraint if exists settings_pkey;
alter table settings drop constraint if exists settings_id_check;
alter table settings add primary key (school_id);

alter table school_weekly_patterns drop constraint if exists school_weekly_patterns_pkey;
alter table school_weekly_patterns drop constraint if exists school_weekly_patterns_id_check;
alter table school_weekly_patterns add primary key (school_id);

-- 7. Uniques that become per school (spec §3.4).
alter table schedule_groups drop constraint if exists schedule_groups_name_key;
alter table schedule_groups add constraint schedule_groups_school_name_key unique (school_id, name);

alter table school_special_days drop constraint if exists school_special_days_pkey;
alter table school_special_days add primary key (school_id, date);

commit;
```

- [ ] **Step 2: Check constraint names against the real schema.** The default names (`settings_pkey`, `settings_id_check`, `schedule_groups_name_key`, `school_special_days_pkey`, `school_weekly_patterns_pkey`, `school_weekly_patterns_id_check`) come from Postgres naming rules for the `create table` statements in `20260626000000_initial_schema.sql`, `20260701000000_add_school_calendar.sql` and `20261010000000_schedule_groups.sql`. Read those three `create table` blocks and confirm none names its constraints explicitly. If one does, use that name.
- [ ] **Step 3: Run** `node --test tests/tenant-rls.test.mjs`. The school_id test now passes; the policy test still fails.
- [ ] **Step 4: Commit:** `git commit -am "Multi-tenancy: school_id on every tenant table, composite FKs, per-school keys"` (add the new file first).

### Task 4: Migration — tenant RLS, helpers, `create_school()`

**Files:** Create `supabase/migrations/20261103000200_tenant_rls.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Multi-tenancy, step 3 of 4 (spec §4–6). Every policy is recreated with
-- school_id = current_school_id(). Role rules are unchanged from DATA_MODEL.md.

begin;

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public.user_role()
returns user_role
language sql stable security definer
set search_path = public
as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.school_id = public.current_school_id()
$$;

create or replace function public.parent_has_student(target_student_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.user_role() = 'parent'
  and exists (
    select 1
    from public.student_guardians sg
    join public.guardians g on g.id = sg.guardian_id
    where sg.student_id = target_student_id
      and g.user_id = auth.uid()
      and sg.school_id = public.current_school_id()
  )
$$;

create or replace function public.parent_can_read_guardian(target_guardian_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.user_role() = 'parent'
  and (
    exists (
      select 1 from public.guardians direct_guardian
      where direct_guardian.id = target_guardian_id
        and direct_guardian.user_id = auth.uid()
        and direct_guardian.school_id = public.current_school_id()
    )
    or exists (
      select 1
      from public.student_guardians own_link
      join public.guardians own_guardian on own_guardian.id = own_link.guardian_id
      join public.student_guardians target_link on target_link.student_id = own_link.student_id
      where own_guardian.user_id = auth.uid()
        and target_link.guardian_id = target_guardian_id
        and own_link.school_id = public.current_school_id()
    )
  )
$$;

-- ── create_school(): onboarding (spec §6) ────────────────────────────────────

create or replace function public.create_school(
  p_name text, p_sms_name text, p_time_zone text, p_full_name text, p_phone text
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_school uuid;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if public.current_school_id() is not null then
    raise exception 'This account already belongs to a school.' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'School name must be 2–80 characters.' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'Your name is required.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_time_zone) then
    raise exception 'Unknown time zone.' using errcode = 'P0001';
  end if;

  insert into schools (name, sms_name, time_zone, created_by)
  values (trim(p_name), coalesce(nullif(trim(p_sms_name), ''), trim(p_name)), p_time_zone, v_user)
  returning id into v_school;

  insert into settings (school_id) values (v_school);
  insert into school_weekly_patterns (school_id) values (v_school);
  insert into school_sms_config (school_id) values (v_school);

  insert into profiles (id, role, full_name, phone, school_id)
  values (v_user, 'admin', trim(p_full_name), nullif(trim(p_phone), ''), v_school)
  on conflict (id) do update
    set role = 'admin', full_name = excluded.full_name, phone = excluded.phone,
        school_id = excluded.school_id;

  return v_school;
end
$$;

revoke all on function public.create_school(text, text, text, text, text) from public;
grant execute on function public.create_school(text, text, text, text, text) to authenticated;

-- ── schools ──────────────────────────────────────────────────────────────────

create policy schools_member_read on schools
  for select using (id = public.current_school_id());
create policy schools_admin_update on schools
  for update using (id = public.current_school_id() and public.user_role() = 'admin')
  with check (id = public.current_school_id() and public.user_role() = 'admin');

-- Admins may only change these columns (not archived / created_by).
revoke update on schools from authenticated;
grant update (name, sms_name, time_zone) on schools to authenticated;

-- ── profiles ─────────────────────────────────────────────────────────────────
-- profiles_own_insert is removed: it let any user insert their own profile with
-- any role. Profiles are now created only by create_school() or by an admin.

drop policy if exists profiles_own_insert on profiles;
drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
-- profiles_own_read (id = auth.uid()) is kept as is: a user must read their own
-- row even before they have a school.
create policy profiles_moderator_read_staff on profiles
  for select using (
    school_id = public.current_school_id()
    and public.user_role() = 'moderator'
    and role in ('admin', 'moderator')
  );

-- ── Student data: admin all, moderator read+write, parent read own children ──

drop policy if exists students_admin_all on students;
drop policy if exists students_moderator_rw on students;
drop policy if exists students_parent_read on students;
create policy students_admin_all on students
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy students_moderator_rw on students
  for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
  with check (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy students_parent_read on students
  for select using (school_id = public.current_school_id() and public.parent_has_student(students.id));

drop policy if exists courses_admin_all on courses;
drop policy if exists courses_moderator_rw on courses;
drop policy if exists courses_parent_read on courses;
create policy courses_admin_all on courses
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy courses_moderator_rw on courses
  for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
  with check (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy courses_parent_read on courses
  for select using (school_id = public.current_school_id() and public.parent_has_student(courses.student_id));

drop policy if exists grades_admin_all on grades;
drop policy if exists grades_moderator_rw on grades;
drop policy if exists grades_parent_read on grades;
create policy grades_admin_all on grades
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy grades_moderator_rw on grades
  for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
  with check (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy grades_parent_read on grades
  for select using (school_id = public.current_school_id() and public.parent_has_student(grades.student_id));

drop policy if exists attendance_admin_all on attendance;
drop policy if exists attendance_moderator_rw on attendance;
drop policy if exists attendance_parent_read on attendance;
create policy attendance_admin_all on attendance
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy attendance_moderator_rw on attendance
  for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
  with check (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy attendance_parent_read on attendance
  for select using (school_id = public.current_school_id() and public.parent_has_student(attendance.student_id));

drop policy if exists quran_admin_all on quran_progress;
drop policy if exists quran_moderator_rw on quran_progress;
drop policy if exists quran_parent_read on quran_progress;
create policy quran_admin_all on quran_progress
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy quran_moderator_rw on quran_progress
  for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
  with check (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy quran_parent_read on quran_progress
  for select using (school_id = public.current_school_id() and public.parent_has_student(quran_progress.student_id));

drop policy if exists memorized_juz_admin_all on student_memorized_juz;
drop policy if exists memorized_juz_moderator_rw on student_memorized_juz;
drop policy if exists memorized_juz_parent_read on student_memorized_juz;
create policy memorized_juz_admin_all on student_memorized_juz
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy memorized_juz_moderator_rw on student_memorized_juz
  for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
  with check (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy memorized_juz_parent_read on student_memorized_juz
  for select using (school_id = public.current_school_id() and public.parent_has_student(student_memorized_juz.student_id));

-- juz_tests (PR #7): same three policies, only if the table exists. The policy
-- names must match the ones PR #7's migration created (check that file).
do $$
begin
  if to_regclass('public.juz_tests') is not null then
    execute 'drop policy if exists juz_tests_admin_all on juz_tests';
    execute 'drop policy if exists juz_tests_moderator_rw on juz_tests';
    execute 'drop policy if exists juz_tests_parent_read on juz_tests';
    execute $p$create policy juz_tests_admin_all on juz_tests
      for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
      with check (school_id = public.current_school_id() and public.user_role() = 'admin')$p$;
    execute $p$create policy juz_tests_moderator_rw on juz_tests
      for all using (school_id = public.current_school_id() and public.user_role() = 'moderator')
      with check (school_id = public.current_school_id() and public.user_role() = 'moderator')$p$;
    execute $p$create policy juz_tests_parent_read on juz_tests
      for select using (school_id = public.current_school_id() and public.parent_has_student(juz_tests.student_id))$p$;
  end if;
end $$;

-- ── Guardians / links: admin all, moderator read, parent own ─────────────────

drop policy if exists guardians_admin_all on guardians;
drop policy if exists guardians_moderator_read on guardians;
drop policy if exists guardians_parent_read on guardians;
create policy guardians_admin_all on guardians
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy guardians_moderator_read on guardians
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy guardians_parent_read on guardians
  for select using (school_id = public.current_school_id() and public.parent_can_read_guardian(guardians.id));

drop policy if exists sg_admin_all on student_guardians;
drop policy if exists sg_moderator_read on student_guardians;
drop policy if exists sg_parent_read on student_guardians;
create policy sg_admin_all on student_guardians
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy sg_moderator_read on student_guardians
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy sg_parent_read on student_guardians
  for select using (school_id = public.current_school_id() and public.parent_has_student(student_guardians.student_id));

-- ── Payments: admin all, moderator read, parent own children ─────────────────

drop policy if exists payments_admin_all on payments;
drop policy if exists payments_moderator_read on payments;
drop policy if exists payments_parent_read on payments;
create policy payments_admin_all on payments
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy payments_moderator_read on payments
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy payments_parent_read on payments
  for select using (school_id = public.current_school_id() and public.parent_has_student(payments.student_id));

-- ── Notifications: admin all, moderator read, parent own children ────────────

drop policy if exists notifications_admin_all on notifications;
drop policy if exists notifications_moderator_read on notifications;
drop policy if exists notifications_parent_read on notifications;
create policy notifications_admin_all on notifications
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy notifications_moderator_read on notifications
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy notifications_parent_read on notifications
  for select using (school_id = public.current_school_id() and public.parent_has_student(notifications.student_id));

-- ── Settings: admin all, moderator read ──────────────────────────────────────

drop policy if exists settings_admin_all on settings;
drop policy if exists settings_moderator_read on settings;
create policy settings_admin_all on settings
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy settings_moderator_read on settings
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');

-- ── Calendar + schedule groups: admin all, moderator read, parent read ───────

drop policy if exists school_weekly_patterns_admin_all on school_weekly_patterns;
drop policy if exists school_weekly_patterns_moderator_read on school_weekly_patterns;
drop policy if exists school_weekly_patterns_parent_read on school_weekly_patterns;
create policy school_weekly_patterns_admin_all on school_weekly_patterns
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy school_weekly_patterns_moderator_read on school_weekly_patterns
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy school_weekly_patterns_parent_read on school_weekly_patterns
  for select using (school_id = public.current_school_id() and public.user_role() = 'parent');

drop policy if exists school_breaks_admin_all on school_breaks;
drop policy if exists school_breaks_moderator_read on school_breaks;
drop policy if exists school_breaks_parent_read on school_breaks;
create policy school_breaks_admin_all on school_breaks
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy school_breaks_moderator_read on school_breaks
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy school_breaks_parent_read on school_breaks
  for select using (school_id = public.current_school_id() and public.user_role() = 'parent');

drop policy if exists school_special_days_admin_all on school_special_days;
drop policy if exists school_special_days_moderator_read on school_special_days;
drop policy if exists school_special_days_parent_read on school_special_days;
create policy school_special_days_admin_all on school_special_days
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy school_special_days_moderator_read on school_special_days
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy school_special_days_parent_read on school_special_days
  for select using (school_id = public.current_school_id() and public.user_role() = 'parent');

drop policy if exists schedule_groups_admin_all on schedule_groups;
drop policy if exists schedule_groups_moderator_read on schedule_groups;
drop policy if exists schedule_groups_parent_read on schedule_groups;
create policy schedule_groups_admin_all on schedule_groups
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy schedule_groups_moderator_read on schedule_groups
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy schedule_groups_parent_read on schedule_groups
  for select using (school_id = public.current_school_id() and public.user_role() = 'parent');

drop policy if exists schedule_group_days_admin_all on schedule_group_days;
drop policy if exists schedule_group_days_moderator_read on schedule_group_days;
drop policy if exists schedule_group_days_parent_read on schedule_group_days;
create policy schedule_group_days_admin_all on schedule_group_days
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy schedule_group_days_moderator_read on schedule_group_days
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');
create policy schedule_group_days_parent_read on schedule_group_days
  for select using (school_id = public.current_school_id() and public.user_role() = 'parent');

-- ── Incoming texts, absence reports, announcements ───────────────────────────

drop policy if exists inbound_messages_admin_read on inbound_messages;
create policy inbound_messages_admin_read on inbound_messages
  for select using (school_id = public.current_school_id() and public.user_role() = 'admin');

drop policy if exists absence_reports_admin_all on absence_reports;
drop policy if exists absence_reports_moderator_read on absence_reports;
create policy absence_reports_admin_all on absence_reports
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');
create policy absence_reports_moderator_read on absence_reports
  for select using (school_id = public.current_school_id() and public.user_role() = 'moderator');

drop policy if exists announcements_admin_all on announcements;
create policy announcements_admin_all on announcements
  for all using (school_id = public.current_school_id() and public.user_role() = 'admin')
  with check (school_id = public.current_school_id() and public.user_role() = 'admin');

commit;
```

- [ ] **Step 2: Run** `npm test` → the static tenant test and the existing `rls-policy-recursion.test.mjs` both pass. If the recursion test complains (e.g. about `student_guardians` inside policies), read its assertions. The new policies only call the helpers, so they should pass.
- [ ] **Step 3: Commit:** `git add supabase/migrations/20261103000200_tenant_rls.sql && git commit -m "Multi-tenancy: school-scoped RLS, helpers, create_school()"`

### Task 5: Migration — tick all day

**Files:** Create `supabase/migrations/20261103000300_tick_all_day.sql`

- [ ] **Step 1:**

```sql
-- Multi-tenancy, step 4 of 4 (spec §7.2). Schools can be in any US time zone,
-- so the 10-minute tick runs around the clock. Each school's local-time
-- constants decide what actually runs; off-hours ticks do nothing.
-- cron.schedule upserts by job name.
select cron.schedule(
  'controlpad-attendance-tick',
  '*/10 * * * *',
  $job$
    select net.http_get(
      url := (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'controlpad_app_url'
      ) || '/api/cron/attendance-tick',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'controlpad_cron_secret'
        )
      ),
      timeout_milliseconds := 30000
    );
  $job$
);
```

- [ ] **Step 2: Commit:** `git commit -m "Multi-tenancy: run the 10-minute tick all day"` (after `git add`).

### Task 6: pgTAP isolation test

**Files:** Create `supabase/tests/tenant_isolation.test.sql`

- [ ] **Step 1: Write the test**

```sql
-- Behavioural tenant isolation (spec §5). Run: supabase test db  (needs Docker).
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Two schools; admin, moderator and parent in each. Fixed ids for readability.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin-a@test.local'),
  ('a0000000-0000-0000-0000-00000000000b', 'mod-a@test.local'),
  ('a0000000-0000-0000-0000-00000000000c', 'parent-a@test.local'),
  ('b0000000-0000-0000-0000-00000000000a', 'admin-b@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'mod-b@test.local'),
  ('b0000000-0000-0000-0000-00000000000c', 'parent-b@test.local'),
  ('c0000000-0000-0000-0000-00000000000a', 'archived@test.local');

insert into schools (id, name, sms_name) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'School A', 'School A'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'School B', 'School B');

insert into profiles (id, role, full_name, school_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin', 'Admin A', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-00000000000b', 'moderator', 'Mod A', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-00000000000c', 'parent', 'Parent A', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('b0000000-0000-0000-0000-00000000000a', 'admin', 'Admin B', 'bbbbbbbb-0000-0000-0000-000000000000'),
  ('b0000000-0000-0000-0000-00000000000b', 'moderator', 'Mod B', 'bbbbbbbb-0000-0000-0000-000000000000'),
  ('b0000000-0000-0000-0000-00000000000c', 'parent', 'Parent B', 'bbbbbbbb-0000-0000-0000-000000000000'),
  ('c0000000-0000-0000-0000-00000000000a', 'admin', 'Old admin', '00000000-0000-0000-0000-000000000001');

insert into settings (school_id) values
  ('aaaaaaaa-0000-0000-0000-000000000000'), ('bbbbbbbb-0000-0000-0000-000000000000');

insert into students (id, first_name, last_name, school_id) values
  ('5a000000-0000-0000-0000-000000000001', 'Amina', 'A', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('5b000000-0000-0000-0000-000000000001', 'Bilal', 'B', 'bbbbbbbb-0000-0000-0000-000000000000'),
  ('5c000000-0000-0000-0000-000000000001', 'Old', 'Student', '00000000-0000-0000-0000-000000000001');

insert into guardians (id, full_name, phone, user_id, school_id) values
  ('6a000000-0000-0000-0000-000000000001', 'Parent A', '+14135550001', 'a0000000-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('6b000000-0000-0000-0000-000000000001', 'Parent B', '+14135550001', 'b0000000-0000-0000-0000-00000000000c', 'bbbbbbbb-0000-0000-0000-000000000000');

insert into student_guardians (student_id, guardian_id, school_id) values
  ('5a000000-0000-0000-0000-000000000001', '6a000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('5b000000-0000-0000-0000-000000000001', '6b000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000000');

insert into courses (id, student_id, name, school_id) values
  ('7a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'Algebra', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('7b000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001', 'Biology', 'bbbbbbbb-0000-0000-0000-000000000000');

insert into grades (course_id, student_id, grade_value, school_id) values
  ('7a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 90, 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('7b000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001', 80, 'bbbbbbbb-0000-0000-0000-000000000000');

insert into notifications (recipient_phone, recipient_type, trigger_type, body, school_id) values
  ('+14135550001', 'admin', 'manual_test', 'a', 'aaaaaaaa-0000-0000-0000-000000000000'),
  ('+14135550001', 'admin', 'manual_test', 'b', 'bbbbbbbb-0000-0000-0000-000000000000');

insert into school_sms_config (school_id, twilio_account_sid) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'ACaaaa'), ('bbbbbbbb-0000-0000-0000-000000000000', 'ACbbbb');

-- Composite FK: a grade can't point at another school's course (as postgres, RLS bypassed).
select throws_ok(
  $$ insert into grades (course_id, student_id, grade_value, school_id)
     values ('7b000000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-000000000001', 50,
             'aaaaaaaa-0000-0000-0000-000000000000') $$,
  '23503', null, 'composite FK rejects a cross-school grade');

create function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', uid::text, true);
$$;

set local role authenticated;

-- Admin A
select pg_temp.as_user('a0000000-0000-0000-0000-00000000000a');
select is((select count(*) from students)::int, 1, 'admin A sees one student');
select is((select first_name from students), 'Amina', 'admin A sees only school A');
select is((select count(*) from grades)::int, 1, 'admin A sees one grade');
select is((select count(*) from guardians)::int, 1, 'admin A sees one guardian');
select is((select count(*) from notifications)::int, 1, 'admin A sees own notifications');
select is((select count(*) from settings)::int, 1, 'admin A sees one settings row');
select is((select count(*) from schools)::int, 1, 'admin A sees one school');
select is((select count(*) from profiles)::int, 3, 'admin A sees school A profiles only');
select is((select count(*) from school_sms_config)::int, 0, 'sms config is service-only');
select is((select count(*) from platform_admins)::int, 0, 'platform_admins is service-only');
select throws_ok(
  $$ insert into students (first_name, last_name, school_id)
     values ('X', 'Y', 'bbbbbbbb-0000-0000-0000-000000000000') $$,
  '42501', null, 'admin A cannot insert into school B');
select lives_ok(
  $$ insert into students (first_name, last_name) values ('New', 'Student') $$,
  'insert without school_id defaults to admin A''s school');
select is((select school_id from students where first_name = 'New'),
  'aaaaaaaa-0000-0000-0000-000000000000'::uuid, 'default school_id is the current school');
update students set first_name = 'Hacked' where id = '5b000000-0000-0000-0000-000000000001';
select is((select count(*) from students where first_name = 'Hacked')::int, 0, 'admin A cannot update school B rows');
select throws_ok(
  $$ update profiles set school_id = 'bbbbbbbb-0000-0000-0000-000000000000'
     where id = 'a0000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'admin A cannot move a profile to school B');
select throws_ok(
  $$ update schools set archived = true $$,
  '42501', null, 'admins cannot change archived');

-- Moderator B
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000b');
select is((select first_name from students), 'Bilal', 'moderator B sees only school B');
select is((select count(*) from grades)::int, 1, 'moderator B sees one grade');

-- Parent B: own child only, and not parent A's same-phone guardian row.
select pg_temp.as_user('b0000000-0000-0000-0000-00000000000c');
select is((select count(*) from students)::int, 1, 'parent B sees one child');
select is((select count(*) from guardians)::int, 1, 'parent B sees own guardian row only');

-- Archived-school user sees nothing and has no role.
select pg_temp.as_user('c0000000-0000-0000-0000-00000000000a');
select is((select count(*) from students)::int, 0, 'archived school data is invisible');
select is(public.user_role()::text, null::text, 'archived user has no role');
select is((select count(*) from profiles)::int, 1, 'archived user still reads own profile');

select * from finish();
rollback;
```

- [ ] **Step 2:** You can't run this without Docker. If `supabase` and Docker are available locally: `supabase start && supabase test db` → `ok 1..24`. Otherwise leave it for the owner (Task 33).
- [ ] **Step 3: Commit:** `git add supabase/tests && git commit -m "Multi-tenancy: pgTAP tenant isolation test"`

### Task 7: Archive deletion script

**Files:** Create `scripts/delete-archive-school.mjs`

- [ ] **Step 1:**

```js
// Deletes the pre-multi-tenant archive school and everything in it (spec §3.5).
// Owner-run only:  node --env-file=.env.local scripts/delete-archive-school.mjs
// Prints counts first and needs you to type DELETE. Auth users are not removed.
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const ARCHIVE_ID = "00000000-0000-0000-0000-000000000001";
const TABLES = ["students", "guardians", "grades", "attendance", "quran_progress", "payments", "notifications", "profiles"];

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: school } = await supabase.from("schools").select("id, name, archived").eq("id", ARCHIVE_ID).maybeSingle();
if (!school) {
  console.log("No archive school found. Nothing to do.");
  process.exit(0);
}
if (!school.archived) {
  console.error("The school with the archive id is not archived. Refusing.");
  process.exit(1);
}

for (const table of TABLES) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true }).eq("school_id", ARCHIVE_ID);
  console.log(`${table}: ${error ? `error (${error.message})` : count}`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question('Type DELETE to permanently delete the archive school and all rows above: ');
rl.close();
if (answer.trim() !== "DELETE") {
  console.log("Cancelled.");
  process.exit(0);
}

const { error } = await supabase.from("schools").delete().eq("id", ARCHIVE_ID);
if (error) {
  console.error(`Delete failed: ${error.message}`);
  process.exit(1);
}
console.log("Archive school deleted.");
```

- [ ] **Step 2: Commit:** `git add scripts/delete-archive-school.mjs && git commit -m "Multi-tenancy: owner script to delete the archive school"`

---

## Phase 2 — Auth, current school, sign-up (spec §4, §6)

### Task 8: Time zones and clock

**Files:** Create `src/lib/schools/time-zones.ts`, `src/lib/schools/time-zones.test.ts`, `src/lib/schools/clock.ts`, `src/lib/schools/clock.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// src/lib/schools/time-zones.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { isValidTimeZone, US_TIME_ZONES } from "@/lib/schools/time-zones";

test("accepts IANA zones and rejects junk", () => {
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("America/Los_Angeles"), true);
  assert.equal(isValidTimeZone("Mars/Base"), false);
  assert.equal(isValidTimeZone(""), false);
});

test("every offered US zone is valid", () => {
  for (const zone of US_TIME_ZONES) assert.equal(isValidTimeZone(zone.value), true, zone.value);
});
```

```ts
// src/lib/schools/clock.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { localClock, localDate } from "@/lib/schools/clock";

const now = new Date("2026-11-03T03:30:00.000Z"); // 22:30 Nov 2 Eastern, 19:30 Nov 2 Pacific

test("localClock uses the given zone", () => {
  assert.deepEqual(localClock(now, "America/New_York"), { date: "2026-11-02", minutes: 22 * 60 + 30 });
  assert.deepEqual(localClock(now, "America/Los_Angeles"), { date: "2026-11-02", minutes: 19 * 60 + 30 });
  assert.deepEqual(localClock(now, "UTC"), { date: "2026-11-03", minutes: 3 * 60 + 30 });
});

test("localDate is the date part", () => {
  assert.equal(localDate(now, "America/New_York"), "2026-11-02");
});
```

- [ ] **Step 2:** `node --test --import tsx src/lib/schools/*.test.ts` → FAIL (modules missing).
- [ ] **Step 3: Implement**

```ts
// src/lib/schools/time-zones.ts
// Client-safe. Time zones offered when creating a school / in Settings → School.
export const US_TIME_ZONES = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
] as const;

export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
```

```ts
// src/lib/schools/clock.ts
// Client-safe. A school's local date and minutes-after-midnight at `now`.
export function localClock(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

export function localDate(now: Date, timeZone: string): string {
  return localClock(now, timeZone).date;
}
```

- [ ] **Step 4:** Run the tests again → PASS.
- [ ] **Step 5: Commit:** `git commit -m "Multi-tenancy: time zone list and local clock helpers"` (after `git add`).

### Task 9: SchoolContext and schools data

**Files:** Create `src/lib/schools/school-context.ts`, `src/lib/schools/schools-data.ts`, `src/lib/schools/for-each-school.ts`, `src/lib/schools/for-each-school.test.ts`

- [ ] **Step 1: Failing test for the loop**

```ts
// src/lib/schools/for-each-school.test.ts
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
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement**

```ts
// src/lib/schools/school-context.ts
// Client-safe type. Everything server-side code needs to act for one school.
export type SchoolContext = {
  schoolId: string;
  name: string;
  /** Prefix on every text, e.g. "Salaam Institute". */
  smsName: string;
  /** IANA zone; decides the school's local date and alert times. */
  timeZone: string;
};

export type SchoolRow = { id: string; name: string; sms_name: string; time_zone: string };

export function contextFromRow(row: SchoolRow): SchoolContext {
  return { schoolId: row.id, name: row.name, smsName: row.sms_name, timeZone: row.time_zone };
}
```

```ts
// src/lib/schools/schools-data.ts
// Service-role loaders for crons and webhooks (no signed-in user).
import { contextFromRow, type SchoolContext, type SchoolRow } from "@/lib/schools/school-context";
import { createServiceClient } from "@/lib/supabase/server";

const COLUMNS = "id, name, sms_name, time_zone";

export async function loadSchoolContext(schoolId: string): Promise<SchoolContext | null> {
  const { data, error } = await createServiceClient()
    .from("schools")
    .select(COLUMNS)
    .eq("id", schoolId)
    .eq("archived", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? contextFromRow(data as SchoolRow) : null;
}

/** Every non-archived school, oldest first. */
export async function listActiveSchools(): Promise<SchoolContext[]> {
  const { data, error } = await createServiceClient()
    .from("schools")
    .select(COLUMNS)
    .eq("archived", false)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SchoolRow[]).map(contextFromRow);
}
```

```ts
// src/lib/schools/for-each-school.ts
import type { SchoolContext } from "@/lib/schools/school-context";

export type SchoolRunResult<T> =
  | { schoolId: string; ok: true; result: T }
  | { schoolId: string; ok: false; error: string };

/**
 * Runs `run` for each school in turn. One school failing is logged (school id
 * only, no PII) and the rest still run.
 */
export async function forEachSchool<T>(
  schools: SchoolContext[],
  run: (ctx: SchoolContext) => Promise<T>,
  deps: { log?: (line: string) => void } = {},
): Promise<SchoolRunResult<T>[]> {
  const log = deps.log ?? ((line: string) => console.error(line));
  const results: SchoolRunResult<T>[] = [];
  for (const ctx of schools) {
    try {
      results.push({ schoolId: ctx.schoolId, ok: true, result: await run(ctx) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      log(`Scheduled run failed for school ${ctx.schoolId}: ${message}`);
      results.push({ schoolId: ctx.schoolId, ok: false, error: message });
    }
  }
  return results;
}
```

- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit:** `git commit -m "Multi-tenancy: SchoolContext, school loaders, per-school runner"`

### Task 10: `getCurrentProfile()` / `requireRole()` are school-aware

**Files:** Modify `src/lib/auth/current-profile.ts`

- [ ] **Step 1: Replace the file body** (keeps `requireRole` signature)

```ts
import { redirect } from "next/navigation";

import type { AppRole } from "@/components/controlpad/user-menu";
import type { SchoolContext } from "@/lib/schools/school-context";
import { createClient } from "@/lib/supabase/server";

export type CurrentProfile = {
  id: string;
  fullName: string;
  role: AppRole;
  schoolId: string;
  schoolName: string;
  smsName: string;
  timeZone: string;
};

const validRoles = new Set<AppRole>(["admin", "moderator", "parent"]);

type ProfileRow = {
  full_name: string;
  role: string;
  school_id: string | null;
  schools: { id: string; name: string; sms_name: string; time_zone: string; archived: boolean } | null;
};

export async function getCurrentProfile(): Promise<CurrentProfile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // profiles_own_read lets a user read their own row; schools_member_read lets
  // them read their school only while it isn't archived.
  const { data } = await supabase
    .from("profiles")
    .select("full_name, role, school_id, schools(id, name, sms_name, time_zone, archived)")
    .eq("id", user.id)
    .maybeSingle();

  const profile = data as ProfileRow | null;
  const school = profile?.schools;
  // No profile, no school, or an archived school → create a school first.
  if (!profile || !school || school.archived) redirect("/onboarding");

  const role = profile.role as AppRole;
  if (!validRoles.has(role)) redirect("/onboarding");

  return {
    id: user.id,
    fullName: profile.full_name,
    role,
    schoolId: school.id,
    schoolName: school.name,
    smsName: school.sms_name,
    timeZone: school.time_zone,
  };
}

/** The SchoolContext for server code acting on behalf of the signed-in user. */
export function schoolContextOf(profile: CurrentProfile): SchoolContext {
  return {
    schoolId: profile.schoolId,
    name: profile.schoolName,
    smsName: profile.smsName,
    timeZone: profile.timeZone,
  };
}

/**
 * Server-side role gate. Use at the top of any page or action that should only
 * be reachable by specific roles. The role is the user's role in their school.
 * RLS is still the real enforcement boundary; this is a UX/defense-in-depth layer.
 */
export async function requireRole(allowed: AppRole[]): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!allowed.includes(profile.role)) redirect("/");
  return profile;
}
```

- [ ] **Step 2:** `npx tsc --noEmit` → no errors from this file (it only adds fields).
- [ ] **Step 3: Commit:** `git commit -am "Multi-tenancy: school-aware current profile"`

### Task 11: Middleware, sign-up page, login link

**Files:** Modify `src/lib/supabase/middleware.ts`, `src/app/login/page.tsx`; Create `src/app/signup/page.tsx`

- [ ] **Step 1: Middleware public paths.** In `updateSession`, replace the `publicPaths` line with:

```ts
  // /api/sms/inbound is Twilio's webhook; it checks X-Twilio-Signature itself.
  const publicPaths = ["/login", "/signup", "/auth/callback", "/api/cron", "/api/sms/inbound"];
```

  and change the signed-in redirect so `/signup` also redirects home:

```ts
  if (user && (pathname === "/login" || pathname === "/signup")) {
```

- [ ] **Step 2: Sign-up page.** Model it on `src/app/login/page.tsx` (same Card layout, `BrandMark`, `InlineError`, sonner). Full component:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { BrandMark } from "@/components/controlpad/brand";
import { InlineError } from "@/components/controlpad/inline-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const MIN_PASSWORD_LENGTH = 8;

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      toast.error("Sign up failed", { description: error.message });
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center text-primary">
          <BrandMark />
        </div>
        <Card className="border shadow-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-semibold">
              {sent ? "Check your email" : "Create your school"}
            </CardTitle>
            <CardDescription>
              {sent
                ? `We sent a confirmation link to ${email}. Open it to finish setting up your school.`
                : "Start with your own account. You'll name your school next."}
            </CardDescription>
          </CardHeader>
          {sent ? null : (
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <InlineError message={error} />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Creating account…" : "Create account"}
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  Already have an account? <Link href="/login" className="underline">Sign in</Link>
                </p>
              </form>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
```

  Check `InlineError`'s prop name in `src/components/controlpad/inline-error.tsx` and match it.
- [ ] **Step 3: Auth callback `next` param.** Open `src/app/auth/callback/route.ts`. If it already honours `?next=`, leave it. Otherwise, after the code exchange, redirect to `next` only when it starts with `/` and not `//` (open-redirect guard), else `/`.
- [ ] **Step 4: Login page.** Replace the "Use your Salaam Institute account…" copy (line ~65) with "Use your ControlPad account to view today's school…", keeping the rest of the sentence. Under the form add:

```tsx
<p className="text-center text-sm text-muted-foreground">
  New school? <Link href="/signup" className="underline">Create a school</Link>
</p>
```

- [ ] **Step 5:** `npx tsc --noEmit && npm run lint` → clean.
- [ ] **Step 6: Commit:** `git commit -am "Multi-tenancy: sign-up page and public path"` (after `git add src/app/signup`).

### Task 12: Onboarding (create school)

**Files:** Create `src/lib/schools/onboarding-validation.ts` (+ `.test.ts`), `src/app/onboarding/page.tsx`, `src/app/onboarding/actions.ts`, `src/app/onboarding/onboarding-form.tsx`

- [ ] **Step 1: Failing validation test**

```ts
// src/lib/schools/onboarding-validation.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { parseCreateSchool } from "@/lib/schools/onboarding-validation";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

test("valid input, sms name defaults to school name, phone normalised", () => {
  const result = parseCreateSchool(form({
    school_name: "  Noor Academy ", sms_name: "", time_zone: "America/Chicago",
    full_name: "Sara Khan", phone: "(413) 555-0101",
  }));
  assert.deepEqual(result, {
    ok: true,
    values: { schoolName: "Noor Academy", smsName: "Noor Academy", timeZone: "America/Chicago", fullName: "Sara Khan", phone: "+14135550101" },
  });
});

test("rejects short names, bad zones, bad phones", () => {
  assert.equal(parseCreateSchool(form({ school_name: "N", time_zone: "America/Chicago", full_name: "S" })).ok, false);
  assert.equal(parseCreateSchool(form({ school_name: "Noor", time_zone: "Mars/Base", full_name: "S" })).ok, false);
  assert.equal(parseCreateSchool(form({ school_name: "Noor", time_zone: "America/Chicago", full_name: "" })).ok, false);
  assert.equal(parseCreateSchool(form({ school_name: "Noor", time_zone: "America/Chicago", full_name: "S", phone: "12" })).ok, false);
  assert.equal(parseCreateSchool(form({ school_name: "Noor", sms_name: "x".repeat(41), time_zone: "America/Chicago", full_name: "S" })).ok, false);
});

test("phone is optional", () => {
  const result = parseCreateSchool(form({ school_name: "Noor", time_zone: "America/Chicago", full_name: "S" }));
  assert.equal(result.ok && result.values.phone, null);
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement validation** (uses the existing `toE164` from `@/lib/people/people`; check its signature: it takes a string and returns `string | null`)

```ts
// src/lib/schools/onboarding-validation.ts
import { toE164 } from "@/lib/people/people";
import { isValidTimeZone } from "@/lib/schools/time-zones";

export type CreateSchoolValues = {
  schoolName: string;
  smsName: string;
  timeZone: string;
  fullName: string;
  phone: string | null;
};

export type ParseResult = { ok: true; values: CreateSchoolValues } | { ok: false; error: string };

const text = (data: FormData, key: string) => ((data.get(key) as string | null) ?? "").trim();

export function parseCreateSchool(data: FormData): ParseResult {
  const schoolName = text(data, "school_name");
  const smsName = text(data, "sms_name") || schoolName;
  const timeZone = text(data, "time_zone");
  const fullName = text(data, "full_name");
  const rawPhone = text(data, "phone");

  if (schoolName.length < 2 || schoolName.length > 80) return { ok: false, error: "School name must be 2–80 characters." };
  if (smsName.length < 2 || smsName.length > 40) return { ok: false, error: "Text name must be 2–40 characters." };
  if (!isValidTimeZone(timeZone)) return { ok: false, error: "Pick a time zone." };
  if (!fullName) return { ok: false, error: "Your name is required." };
  const phone = rawPhone ? toE164(rawPhone) : null;
  if (rawPhone && !phone) return { ok: false, error: "Enter a valid US phone number." };

  return { ok: true, values: { schoolName, smsName, timeZone, fullName, phone } };
}
```

- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Server action**

```ts
// src/app/onboarding/actions.ts
"use server";

import { redirect } from "next/navigation";

import { parseCreateSchool } from "@/lib/schools/onboarding-validation";
import { createClient } from "@/lib/supabase/server";

export type CreateSchoolState = { error: string | null };

export async function createSchool(_prev: CreateSchoolState, formData: FormData): Promise<CreateSchoolState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = parseCreateSchool(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.values;

  // create_school() runs as the signed-in user (auth.uid()); it refuses if the
  // user already belongs to a school.
  const { error } = await supabase.rpc("create_school", {
    p_name: v.schoolName,
    p_sms_name: v.smsName,
    p_time_zone: v.timeZone,
    p_full_name: v.fullName,
    p_phone: v.phone ?? "",
  });
  if (error) return { error: error.message };

  redirect("/");
}
```

- [ ] **Step 6: Page** (server component). Redirects home if the user already has a live school:

```tsx
// src/app/onboarding/page.tsx
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/controlpad/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: schoolId } = await supabase.rpc("current_school_id");
  if (schoolId) redirect("/");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md border shadow-sm">
        <CardHeader className="text-center">
          <div className="mb-2 flex justify-center text-primary"><BrandMark /></div>
          <CardTitle className="text-2xl font-semibold">Set up your school</CardTitle>
          <CardDescription>You&apos;ll be the school&apos;s admin. You can change these later in Settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingForm />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7: Form** (client). Fields `school_name`, `sms_name` (help text: "Starts every text, e.g. 'Noor Academy: …'. Leave blank to use the school name."), `time_zone` (a `<select>` over `US_TIME_ZONES`, default `America/New_York`; use the shadcn `Select` if `src/components/ui/select.tsx` exists, else a native `<select>` styled like `Input`), `full_name`, `phone` (optional). Use `useActionState(createSchool, { error: null })`, show `InlineError`, and toast on error, following `src/app/setup-profile/setup-profile-form.tsx`.
- [ ] **Step 8:** `npx tsc --noEmit && npm run lint && npm test` → clean.
- [ ] **Step 9: Commit:** `git commit -m "Multi-tenancy: onboarding creates a school"` (after `git add`).

### Task 13: Retire the first-admin bootstrap

**Files:** Modify `src/app/setup-profile/page.tsx`; delete `src/app/setup-profile/actions.ts`, `src/app/setup-profile/setup-profile-form.tsx`

- [ ] **Step 1:** Replace `page.tsx` with:

```tsx
import { redirect } from "next/navigation";

// The old "first person becomes admin" bootstrap is gone (multi-tenancy):
// every new user creates their own school instead.
export default function SetupProfilePage() {
  redirect("/onboarding");
}
```

- [ ] **Step 2:** `git rm src/app/setup-profile/actions.ts src/app/setup-profile/setup-profile-form.tsx`. Then `grep -rn "setup-profile" src` and point any remaining links/redirects at `/onboarding`.
- [ ] **Step 3:** `npx tsc --noEmit` → clean. **Commit:** `git commit -am "Multi-tenancy: replace first-admin bootstrap with onboarding"`

### Task 14: Per-school settings and calendar reads

**Files:** Modify every file listed below.

The rule: the single-row reads `.eq("id", 1)` become `.eq("school_id", <schoolId>)`, upserts conflict on `school_id` (or `school_id,date`), and the shared loaders take a `schoolId`.

- [ ] **Step 1: Loaders take `schoolId`.**
  - `src/lib/schedule/calendar-data.ts`: `loadSchoolCalendar(supabase, schoolId: string)`. In it, the weekly pattern query becomes `.eq("school_id", schoolId)`, and add `.eq("school_id", schoolId)` to the `school_breaks` query. `loadSpecialDayRows(supabase, schoolId)` adds `.eq("school_id", schoolId)` to both of its queries (lines ~67, ~74). Public API:
    ```ts
    export async function getSchoolCalendar(schoolId: string) { return loadSchoolCalendar(await createClient(), schoolId); }
    export async function getServiceSchoolCalendar(schoolId: string) { return loadSchoolCalendar(createServiceClient(), schoolId); }
    ```
  - `src/lib/schedule/schedule-groups-data.ts`: `loadScheduleGroups(supabase, schoolId)` adds `.eq("school_id", schoolId)`. Same two public wrappers take `schoolId`.
  - `src/lib/grades/pace-data.ts`: signature `loadPaceContext(schoolId: string, options: { service?: boolean } = {})`. Settings read `.eq("school_id", schoolId)`. Pass `schoolId` to the calendar and group loaders.
- [ ] **Step 2: Fix every caller.** Run `npx tsc --noEmit`. Each error is a caller missing `schoolId`. Pages and actions get it from `requireRole(...)` / `getCurrentProfile()` (`profile.schoolId`), which they already call. Service code gets it from `ctx.schoolId` (Phase 3 threads `ctx` through; until then pass `ctx.schoolId` where a `ctx` exists, and leave alert files for Task 16).
- [ ] **Step 3: Replace each settings / weekly-pattern read.** The call sites (from `grep -rn '\.eq("id", 1)' src`):
  `src/app/attendance/page.tsx:93`, `src/app/attendance/actions.ts:59`, `src/app/settings/page.tsx:61,78`, `src/app/settings/actions.ts:41`, `src/app/grades/[courseId]/page.tsx:130`, `src/app/quran/page.tsx:66,144`, `src/app/grades/page.tsx:35`, `src/app/quran/[studentId]/page.tsx:111`, `src/app/students/[id]/page.tsx:176`, `src/lib/people/escalation-data.ts:235`, `src/lib/people/staff-accountability-data.ts:63`.
  Each becomes `.eq("school_id", profile.schoolId)` (or a `schoolId` parameter for the two `lib/people` files; add one and pass it from `src/app/page.tsx`). Leave the alert files (`src/lib/alerts/*`) for Task 16.
- [ ] **Step 4: Settings upserts** in `src/app/settings/actions.ts`:
  - line ~91: the weekly pattern upsert sends `{ school_id: profile.schoolId, ...days }` with `{ onConflict: "school_id" }` (remove `id: 1`).
  - lines ~214 and ~275: special-day upserts use `{ onConflict: "school_id,date" }`. Rows don't need `school_id` (the column default fills it), but add `school_id: profile.schoolId` explicitly for clarity.
  - line ~41: settings update `.eq("school_id", profile.schoolId)`.
- [ ] **Step 5:** `grep -rn '\.eq("id", 1)\|onConflict: "id"\|onConflict: "date"' src` returns only `src/lib/alerts/*` lines.
- [ ] **Step 6:** `npx tsc --noEmit`. The only remaining errors are in `src/lib/alerts/*`, `src/lib/announcements/send.ts` and `src/lib/absence-reports/inbound.ts` (calls to the service loaders without a school). Task 16 fixes those; this is the expected red stretch.
- [ ] **Step 7: Commit:** `git commit -am "Multi-tenancy: per-school settings, calendar and schedule-group reads"`

### Task 15: Staff and parent logins in the admin's school

**Files:** Modify `src/lib/auth/admin-accounts.ts`, `src/app/staff/actions.ts`, `src/app/guardians/actions.ts`

- [ ] **Step 1:** Add `schoolId: string` to `CreateAccountInput` and set it on the profile insert:

```ts
  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role,
    full_name: fullName,
    phone,
    school_id: schoolId,
  });
```

  Map Supabase's "already registered" error to a neutral message (D5). Right after `createUser`:

```ts
  if (createError && /already (been )?registered|already exists/i.test(createError.message)) {
    return { userId: null, error: "This email is already used by another ControlPad account." };
  }
```

- [ ] **Step 2:** Callers (`src/app/staff/actions.ts:44`, `src/app/guardians/actions.ts:123`) pass `schoolId: profile.schoolId` from their existing `requireRole(["admin"])`.
- [ ] **Step 3:** Any profile reads in `src/app/staff/*` that list staff get `.eq("school_id", profile.schoolId)`. RLS scopes them already; the filter keeps intent explicit.
- [ ] **Step 4:** `npx tsc --noEmit` → clean. **Commit:** `git commit -am "Multi-tenancy: staff and parent logins belong to the admin's school"`

---

## Phase 3 — Service-role code per school (spec §7.1–7.2)

### Task 16: Alert data factories take a `SchoolContext`

**Files:** Modify `src/lib/alerts/{grades,pace,attendance,attendance-escalation,quran,revision,payment,special-day,admin-digest}.ts`, `src/lib/announcements/send.ts`, `src/lib/absence-reports/inbound.ts`, their callers, and the `*.test.ts` files that build these deps.

The same mechanical change applies to each file:

1. `createSupabaseXDatabase()` → `createSupabaseXDatabase(ctx: SchoolContext)`.
2. Inside it, **every** `.from("<tenant table>")` chain gets `.eq("school_id", ctx.schoolId)`. Inserts and upserts spread it in: `.insert({ ...row, school_id: ctx.schoolId })`; for arrays, `rows.map((row) => ({ ...row, school_id: ctx.schoolId }))`.
3. `settings` reads: `.eq("id", 1)` → `.eq("school_id", ctx.schoolId)`.
4. Admin recipients (`from("profiles")…eq("role","admin")`) add `.eq("school_id", ctx.schoolId)`. `profiles` is not in `TENANT_TABLES` but must still be filtered. The static test in Task 19 checks `profiles` as well.
5. Calendar and group loaders: `getServiceSchoolCalendar(ctx.schoolId)`, `getServiceScheduleGroups(ctx.schoolId)`, `loadPaceContext(ctx.schoolId, { service: true })`.
6. Public runner functions take `ctx` as their **first** argument and pass it to the factory, e.g.

```ts
export async function checkQuranSlipAlerts(
  ctx: SchoolContext,
  date: string,
  deps: { database?: QuranAlertDatabase; sendSms?: (input: SendSmsInput) => Promise<SmsResult> } = {},
) {
  const database = deps.database ?? createSupabaseQuranAlertDatabase(ctx);
  // …unchanged…
}
```

Queries to change (line numbers from `main` @ `daa9a41`):

| File | Queries |
|---|---|
| `alerts/grades.ts` | L44 settings, L54 profiles, L64 student_guardians |
| `alerts/pace.ts` | L56 profiles, L65 student_guardians; L112 `loadPaceContext(ctx.schoolId, { service: true })` |
| `alerts/attendance.ts` | L206 student_guardians, L229 settings, L246 profiles, L257 attendance |
| `alerts/attendance-escalation.ts` | L330 settings, L346 profiles, L355 students, L366 absence_reports |
| `alerts/quran.ts` | L88 settings, L102 profiles, L113 students, L126 quran_progress, L157 student_guardians |
| `alerts/revision.ts` | L62 settings, L74 profiles, L84 students |
| `alerts/payment.ts` | L51 settings, L61 profiles, L72 students, L84 payments, L100 student_guardians |
| `alerts/special-day.ts` | L110, L136 school_special_days, L119 students |
| `alerts/admin-digest.ts` | L643 settings, L680 attendance, L684 grades, L690 students, L696 quran_progress, L700 payments, L703 student_memorized_juz, L891 profiles |
| `announcements/send.ts` | L141, L157, L183 announcements, L171 students |
| `absence-reports/inbound.ts` | L214, L252, L271, L280 inbound_messages; L223 guardians; L232 student_guardians; L288 absence_reports (upsert rows get `school_id`); L296 profiles |

The `juz_tests` reads added by PR #7 (if merged) get the same treatment. Grep `from("juz_tests")`.

- [ ] **Step 1: Update the tests first.** Every `*.test.ts` that calls a runner gets a fixture context as the first argument:

```ts
const ctx: SchoolContext = { schoolId: "school-1", name: "Test School", smsName: "Test School", timeZone: "America/New_York" };
```

  Run `npm test` → FAIL (arity/type errors).
- [ ] **Step 2: Apply the change file by file** in the table order. After each file, `npx tsc --noEmit`.
- [ ] **Step 3: Runner wiring in `attendance-escalation.ts`.** `runAttendanceTick(ctx, input, deps)` passes `ctx` into its defaults:

```ts
  const database = deps.database ?? createSupabaseEscalationDatabase(ctx);
  const checkTardies = deps.checkTardies ?? ((date: string) => checkTardyThresholdAlerts(ctx, { date }));
  // checkQuran: checkQuranSlipAlerts(ctx, date) / checkRevisionOverdueAlerts(ctx, date)
  // sendNotice: sendSpecialDayNotice(ctx, { date, now })
  // sendDigest: sendAdminDigest(ctx, { date, now })
```

- [ ] **Step 4: Event-based callers** use the signed-in profile:
  - `src/app/grades/actions.ts`: `const ctx = schoolContextOf(profile);` → `loadPaceContext(ctx.schoolId, { service: true })`, `checkLowGradeAlert(ctx, {...})`, `checkPaceAlerts(ctx, ...)`.
  - `src/app/settings/actions.ts:290`: `sendSpecialDayNotice(schoolContextOf(profile), { date })`.
  - `src/app/announcements/actions.ts:71`: `sendAnnouncement(schoolContextOf(profile), id)`.
  - `src/app/messages/actions.ts:89`: `handleInboundSms(schoolContextOf(profile), { from, body, twilioSid: null, simulated: true })`.
  - `src/app/page.tsx:896`: `getAdminDailySummary(schoolContextOf(profile), today, { now: new Date() })`.
- [ ] **Step 5:** `npm test && npx tsc --noEmit` → PASS.
- [ ] **Step 6: Commit:** `git commit -am "Multi-tenancy: every alert, announcement and inbound query is school-scoped"`

### Task 17: Time zone and text prefix from the school

**Files:** Modify `src/lib/alerts/{attendance-escalation,attendance,admin-digest,payment,pace,quran,special-day}.ts`, `src/lib/quran/revision.ts`, `src/lib/absence-reports/{parse,inbound}.ts`, `src/lib/announcements/announcements.ts`, `src/app/announcements/compose-form.tsx`, `src/lib/grades/sweep.ts`, `src/app/grades/sweep/*`, `src/app/settings/special-days-form.tsx`, related tests.

- [ ] **Step 1: Tests first.** In `attendance-escalation.test.ts` add:

```ts
test("schoolClock follows the school's zone", () => {
  const now = new Date("2026-11-03T15:00:00.000Z");
  assert.equal(schoolClock(now, "America/New_York").minutes, 10 * 60);
  assert.equal(schoolClock(now, "America/Los_Angeles").minutes, 7 * 60);
});
```

  In `announcements.test.ts`, change the prefix expectations to a passed name:

```ts
assert.equal(announcementBody("Eid party Friday", "Noor Academy"), "Noor Academy: Eid party Friday");
assert.equal(announcementBody("Noor Academy: hi", "Noor Academy"), "Noor Academy: hi");
```

  Update the existing message tests (`pace.test.ts`, `revision.test.ts`, `special-day.test.ts`, `send.test.ts`, `parse` tests) to pass an `smsName` and expect `"Test School: …"`. Run `npm test` → FAIL.
- [ ] **Step 2: Clock.** Delete each local `SCHOOL_TIME_ZONE` constant and its hand-written `Intl` clock:
  - `attendance-escalation.ts`: `export function schoolClock(now: Date, timeZone: string) { return localClock(now, timeZone); }` and `minutesIntoDate(date, now, timeZone)`. `runAttendanceTick` uses `ctx.timeZone`.
  - `attendance.ts` / `admin-digest.ts`: `todayInSchoolTimeZone(now, timeZone)` → `localDate(now, timeZone)`. Callers pass `ctx.timeZone`.
  - `announcements.ts:102`: the scheduling helpers take `timeZone`. The compose form gets `timeZone` as a prop from the page (`profile.timeZone`).
  - `grades/sweep.ts:16`: drop the `SCHOOL_TIME_ZONE` export. The Eastern-window helpers take `timeZone`, and the sweep page passes `profile.timeZone` down to the client grid.
  - `absence-reports/inbound.ts`: `schoolClock(now, ctx.timeZone)`. Rename any "6 PM Eastern" comments in `parse.ts` to "6 PM school time".
  - Afterwards `grep -rn "America/New_York" src` should return only `src/lib/schools/time-zones.ts` and tests.
- [ ] **Step 3: Prefix.** Every message builder that hard-codes `Salaam Institute:` takes `smsName: string` and uses `` `${smsName}: …` ``:
  `payment.ts:174`, `pace.ts:92,102` (`paceBehindMessage({ ..., smsName })`), `quran.ts:228`, `quran/revision.ts:156`, `attendance-escalation.ts:251-252` (`parentAbsenceMessage(alert, date, smsName)`), `special-day.ts:29` (`specialDayNoticeBody(message, smsName)`), `absence-reports/parse.ts:207,212` (reply builders take `smsName`), `announcements.ts:26,56-58`:

```ts
export function announcementBody(message: string, smsName: string): string {
  const trimmed = message.trim();
  const prefix = `${smsName}: `;
  return trimmed.toLowerCase().startsWith(prefix.toLowerCase()) ? trimmed : `${prefix}${trimmed}`;
}
```

  Callers pass `ctx.smsName`. The compose form gets `smsName` as a prop. `special-days-form.tsx:283` copy uses an `smsName` prop: `Sent as “{smsName}: …” to parents…`.
  Afterwards `grep -rn "Salaam" src` should return nothing except brand/layout (Task 28).
- [ ] **Step 4:** `npm test && npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit:** `git commit -am "Multi-tenancy: school time zone and text prefix everywhere"`

### Task 18: Cron routes loop over schools

**Files:** Modify `src/app/api/cron/{attendance-tick,payment-overdue,tardy-threshold,quran-slip,admin-digest}/route.ts`, `src/app/api/cron/_utils.ts`

- [ ] **Step 1: `_utils.ts`.** Add:

```ts
import type { SchoolContext } from "@/lib/schools/school-context";
import { listActiveSchools } from "@/lib/schools/schools-data";

/** All active schools, or just `?school=<id>` when given (manual runs). */
export async function cronSchools(request: NextRequest): Promise<SchoolContext[]> {
  const only = request.nextUrl.searchParams.get("school");
  const schools = await listActiveSchools();
  return only ? schools.filter((school) => school.schoolId === only) : schools;
}
```

- [ ] **Step 2: attendance-tick**

```ts
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const results = await forEachSchool(await cronSchools(request), async (ctx) => {
    const date = cronDateParam(request, localDate(now, ctx.timeZone));
    const attendance = await runAttendanceTick(ctx, { now, date });
    // A failure here must not hide the attendance result.
    let announcements: { sent: number } | { error: string };
    try {
      announcements = await sendDueAnnouncements(ctx, now);
    } catch (error) {
      announcements = { error: error instanceof Error ? error.message : "failed" };
    }
    return { ...attendance, announcements };
  });

  return NextResponse.json({ ok: true, schools: results });
}
```

  Keep the header comment, updated to say it loops over schools.
- [ ] **Step 3: The other four routes** follow the same shape: `forEachSchool(await cronSchools(request), (ctx) => checkX(ctx, cronDateParam(request, localDate(now, ctx.timeZone))))`. `admin-digest` keeps `?force=1`.
- [ ] **Step 4:** `npx tsc --noEmit && npm run build` → clean.
- [ ] **Step 5: Commit:** `git commit -am "Multi-tenancy: crons run per school with error isolation"`

### Task 19: Static service-role scope test

**Files:** Create `tests/service-role-school-scope.test.mjs`

- [ ] **Step 1: Write the test**

```js
// Every service-role query on a tenant table (or profiles) must mention
// school_id. The service role bypasses RLS, so this is the only guard besides
// composite FKs. Mark a deliberate exception with a comment on the line
// before `.from(`:   // tenant-scope-ok: <reason>
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
      if (/tenant-scope-ok:/.test(lines[lineIndex - 1] ?? "")) continue;
      // The query chain: from `.from(` up to the end of the statement.
      const rest = source.slice(match.index);
      const end = rest.search(/;\s*(\n|$)/);
      const chain = end === -1 ? rest : rest.slice(0, end);
      if (!/school_id/.test(chain)) problems.push(`${file.replace(root, "src/")}:${lineIndex + 1} ${table}`);
    }
  }
  assert.deepEqual(problems, [], `Unscoped service-role queries:\n${problems.join("\n")}`);
});
```

- [ ] **Step 2:** `node --test tests/service-role-school-scope.test.mjs`. Every hit is a real miss: fix it, or (for genuinely cross-school lookups such as the inbound number lookup in Task 24, or the platform page in Task 26) add a `// tenant-scope-ok: <reason>` comment. The listing and counting in `schools-data.ts` reads `schools`, which isn't a tenant table, so it passes.
- [ ] **Step 3: Commit:** `git commit -am "Multi-tenancy: static test for school-scoped service-role queries"` (after `git add`).

---

## Phase 4 — Per-school Twilio, platform admin, UI (spec §7.3–7.4, §8–9)

### Task 20: Credential encryption

**Files:** Create `src/lib/sms/credentials-crypto.ts`, `src/lib/sms/credentials-crypto.test.ts`

- [ ] **Step 1: Failing test**

```ts
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { decryptSecret, encryptSecret } from "@/lib/sms/credentials-crypto";

const key = randomBytes(32).toString("base64");

test("round-trips and never contains the plaintext", () => {
  const sealed = encryptSecret("my-auth-token", key);
  assert.match(sealed, /^v1:/);
  assert.ok(!sealed.includes("my-auth-token"));
  assert.equal(decryptSecret(sealed, key), "my-auth-token");
});

test("same input encrypts differently each time", () => {
  assert.notEqual(encryptSecret("x", key), encryptSecret("x", key));
});

test("wrong key or tampering fails", () => {
  const sealed = encryptSecret("token", key);
  assert.throws(() => decryptSecret(sealed, randomBytes(32).toString("base64")));
  const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1);
  assert.throws(() => decryptSecret(tampered, key));
});

test("rejects a key that is not 32 bytes", () => {
  assert.throws(() => encryptSecret("x", Buffer.from("short").toString("base64")), /32 bytes/);
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement**

```ts
// src/lib/sms/credentials-crypto.ts
// Server-only. AES-256-GCM for per-school Twilio auth tokens (spec §7.3).
// Format: "v1:" + base64(iv[12] | tag[16] | ciphertext).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("SMS_CREDENTIALS_KEY must be 32 bytes (base64).");
  return key;
}

/** The key from env; throws a clear error if it's missing. */
export function credentialsKey(env: Record<string, string | undefined> = process.env): string {
  const key = env.SMS_CREDENTIALS_KEY?.trim();
  if (!key) throw new Error("SMS_CREDENTIALS_KEY is not set.");
  return key;
}

export function encryptSecret(plain: string, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(keyBase64), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

export function decryptSecret(sealed: string, keyBase64: string): string {
  if (!sealed.startsWith("v1:")) throw new Error("Unknown secret format.");
  const raw = Buffer.from(sealed.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(keyBase64), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4:** Run → PASS. **Commit:** `git commit -m "Multi-tenancy: AES-GCM encryption for Twilio tokens"`

### Task 21: Effective SMS config per school + `sendSms` uses it

**Files:** Create `src/lib/sms/school-sms-config.ts`, `src/lib/sms/school-sms-config.test.ts`; Modify `src/lib/sms/send-sms.ts`, `src/lib/sms/send-sms.test.ts`, every `sendSms` caller

- [ ] **Step 1: Failing test for `resolveSmsConfig`**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { resolveSmsConfig, type SchoolSmsRow } from "@/lib/sms/school-sms-config";

const decrypt = (value: string) => value.replace("enc:", "");
const base: SchoolSmsRow = {
  twilio_account_sid: "AC123",
  twilio_auth_token_enc: "enc:token",
  twilio_phone_number: "+14135550000",
  verified_at: "2026-11-01T00:00:00Z",
  requested_mode: "live",
  live_approved_at: "2026-11-02T00:00:00Z",
  test_number: "+14135559999",
};

test("approved live with no env ceiling is live, with decrypted credentials", () => {
  const config = resolveSmsConfig(base, {}, decrypt);
  assert.equal(config.mode, "live");
  assert.deepEqual(config.twilio, { accountSid: "AC123", authToken: "token", fromPhone: "+14135550000" });
});

test("live waiting for approval falls back to test, or off without a test number", () => {
  assert.equal(resolveSmsConfig({ ...base, live_approved_at: null }, {}, decrypt).mode, "test");
  const off = resolveSmsConfig({ ...base, live_approved_at: null, test_number: null }, {}, decrypt);
  assert.equal(off.mode, "off");
  assert.match(off.reason, /approval/i);
});

test("not set up or unverified is off", () => {
  assert.equal(resolveSmsConfig(null, {}, decrypt).mode, "off");
  assert.equal(resolveSmsConfig({ ...base, verified_at: null }, {}, decrypt).mode, "off");
  assert.equal(resolveSmsConfig({ ...base, twilio_auth_token_enc: null }, {}, decrypt).mode, "off");
});

test("env SMS_MODE is a ceiling", () => {
  assert.equal(resolveSmsConfig(base, { SMS_MODE: "off" }, decrypt).mode, "off");
  assert.equal(resolveSmsConfig(base, { SMS_MODE: "test" }, decrypt).mode, "test");
  assert.equal(resolveSmsConfig({ ...base, requested_mode: "test" }, { SMS_MODE: "live" }, decrypt).mode, "test");
});

test("requested off is off; test without a test number is off", () => {
  assert.equal(resolveSmsConfig({ ...base, requested_mode: "off" }, {}, decrypt).mode, "off");
  assert.equal(resolveSmsConfig({ ...base, requested_mode: "test", test_number: null }, {}, decrypt).mode, "off");
});

test("a token that won't decrypt is off, not a crash", () => {
  const config = resolveSmsConfig(base, {}, () => { throw new Error("bad key"); });
  assert.equal(config.mode, "off");
  assert.match(config.reason, /decrypt/i);
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement**

```ts
// src/lib/sms/school-sms-config.ts
// Server-only. Each school's effective texting mode (spec §7.3).
import { credentialsKey, decryptSecret } from "@/lib/sms/credentials-crypto";
import type { SmsConfig, SmsMode } from "@/lib/sms/send-sms";
import { createServiceClient } from "@/lib/supabase/server";

export type SchoolSmsRow = {
  twilio_account_sid: string | null;
  twilio_auth_token_enc: string | null;
  twilio_phone_number: string | null;
  verified_at: string | null;
  requested_mode: SmsMode;
  live_approved_at: string | null;
  test_number: string | null;
};

export const SCHOOL_SMS_COLUMNS =
  "twilio_account_sid, twilio_auth_token_enc, twilio_phone_number, verified_at, requested_mode, live_approved_at, test_number";

const RANK: Record<SmsMode, number> = { off: 0, test: 1, live: 2 };

function off(reason: string, testNumber: string | null = null): SmsConfig {
  return { mode: "off", reason, twilio: null, testNumber };
}

export function resolveSmsConfig(
  row: SchoolSmsRow | null,
  env: Record<string, string | undefined>,
  decrypt: (sealed: string) => string,
): SmsConfig {
  const ceilingRaw = env.SMS_MODE?.trim().toLowerCase();
  const ceiling: SmsMode = ceilingRaw === "off" || ceilingRaw === "test" ? ceilingRaw : "live";
  if (ceiling === "off") return off("Texting is turned off for every school (SMS_MODE=off).");

  if (!row?.twilio_account_sid || !row.twilio_auth_token_enc || !row.twilio_phone_number) {
    return off("Texting isn't set up yet (Settings → Texting).", row?.test_number ?? null);
  }
  if (!row.verified_at) return off("The Twilio details haven't been verified yet.", row.test_number);

  let authToken: string;
  try {
    authToken = decrypt(row.twilio_auth_token_enc);
  } catch {
    return off("The saved Twilio token couldn't be decrypted. Enter it again in Settings → Texting.", row.test_number);
  }
  const twilio = { accountSid: row.twilio_account_sid, authToken, fromPhone: row.twilio_phone_number };

  let wanted: SmsMode = row.requested_mode;
  let reason = wanted === "live" ? "Live texting is approved." : wanted === "test" ? "Test mode." : "Texting is off.";
  if (wanted === "live" && !row.live_approved_at) {
    wanted = "test";
    reason = "Live texting is waiting for approval.";
  }
  if (RANK[wanted] > RANK[ceiling]) {
    wanted = ceiling;
    reason = `Capped by SMS_MODE=${ceiling}.`;
  }
  if (wanted === "off") return off(reason, row.test_number);
  if (wanted === "test" && !row.test_number) return off(`${reason} Add a test number to use test mode.`);
  return { mode: wanted, reason, twilio, testNumber: row.test_number };
}

/** Loads and resolves one school's config (service role). */
export async function loadSchoolSmsConfig(
  schoolId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<SmsConfig> {
  const { data, error } = await createServiceClient()
    .from("school_sms_config")
    .select(SCHOOL_SMS_COLUMNS)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return resolveSmsConfig(data as SchoolSmsRow | null, env, (sealed) => decryptSecret(sealed, credentialsKey(env)));
}
```

- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Wire into `sendSms`.**
  - `SendSmsInput` gains `schoolId: string`.
  - Delete `requiredTwilioEnv` and `getSmsConfig` (env Twilio is no longer used). `SendSmsDeps` swaps `env` for `getConfig?: (schoolId: string) => Promise<SmsConfig>` (default `loadSchoolSmsConfig`).
  - In `sendSms`: `const config = await (deps.getConfig ?? loadSchoolSmsConfig)(input.schoolId);`
  - `createSupabaseSmsDatabase()`: `findRecentNotifications` adds `.eq("school_id", schoolId)` (pass `schoolId` in its args object). `insertNotification` row gets `school_id: input.schoolId`. `updateNotification` adds `.eq("school_id", schoolId)` (pass it as a parameter).
  - `send-sms.test.ts`: replace `env: {...}` deps with `getConfig: async () => ({ mode: "live", reason: "", twilio: {...}, testNumber: null })`, and add `schoolId: "school-1"` to inputs. Keep every existing assertion. Add one test that the inserted row carries `school_id: "school-1"`.
- [ ] **Step 6: Callers.** `npx tsc --noEmit` lists every `sendSms` call missing `schoolId`, plus `src/app/messages/page.tsx`, which used the deleted `getSmsConfig()`. Make Task 25 Step 1's change there now. Each is inside code that now has `ctx` (Task 16), so pass `schoolId: ctx.schoolId`. `src/app/messages/actions.ts:33` uses `profile.schoolId`. `announcements/send.ts:60` swaps `getSmsConfig().mode` for `(await loadSchoolSmsConfig(ctx.schoolId)).mode` (keep the `deps.mode` override for tests).
- [ ] **Step 7:** `npm test && npx tsc --noEmit` → PASS. **Commit:** `git commit -am "Multi-tenancy: per-school effective SMS mode; sendSms uses the school's Twilio"`

### Task 22: Twilio credential verification

**Files:** Create `src/lib/sms/twilio-verify.ts`, `src/lib/sms/twilio-verify.test.ts`

- [ ] **Step 1: Failing test**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { verifyTwilioCredentials } from "@/lib/sms/twilio-verify";

const input = { accountSid: "AC" + "a".repeat(32), authToken: "t".repeat(32), phoneNumber: "+14135550000" };
const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

test("ok when the number is on the account", async () => {
  const seen: string[] = [];
  const result = await verifyTwilioCredentials(input, async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ incoming_phone_numbers: [{ phone_number: "+14135550000" }] }), { status: 200 });
  });
  assert.deepEqual(result, { ok: true });
  assert.match(seen[0], /IncomingPhoneNumbers\.json\?PhoneNumber=%2B14135550000/);
});

test("bad credentials", async () => {
  const result = await verifyTwilioCredentials(input, respond(401, { message: "Authenticate" }));
  assert.deepEqual(result, { ok: false, error: "Twilio rejected the Account SID or Auth Token." });
});

test("number not on this account", async () => {
  const result = await verifyTwilioCredentials(input, respond(200, { incoming_phone_numbers: [] }));
  assert.equal(result.ok, false);
});

test("network failure is reported, not thrown", async () => {
  const result = await verifyTwilioCredentials(input, async () => { throw new Error("offline"); });
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement**

```ts
// src/lib/sms/twilio-verify.ts
// Server-only. Confirms Twilio credentials work and the number belongs to the account.
export type VerifyResult = { ok: true } | { ok: false; error: string };

export async function verifyTwilioCredentials(
  input: { accountSid: string; authToken: string; phoneNumber: string },
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult> {
  const url =
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}` +
    `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(input.phoneNumber)}`;
  const auth = Buffer.from(`${input.accountSid}:${input.authToken}`).toString("base64");
  try {
    const response = await fetchImpl(url, { headers: { Authorization: `Basic ${auth}` } });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "Twilio rejected the Account SID or Auth Token." };
    }
    if (!response.ok) return { ok: false, error: `Twilio returned ${response.status}.` };
    const payload = (await response.json()) as { incoming_phone_numbers?: unknown[] };
    if (!payload.incoming_phone_numbers?.length) {
      return { ok: false, error: "That phone number isn't on this Twilio account." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach Twilio. Try again." };
  }
}
```

- [ ] **Step 4:** Run → PASS. **Commit:** `git commit -m "Multi-tenancy: verify Twilio credentials and number ownership"`

### Task 23: Settings → Texting card

**Files:** Create `src/lib/sms/texting-validation.ts` (+ test), `src/app/settings/texting-form.tsx`; Modify `src/app/settings/actions.ts`, `src/app/settings/page.tsx`

- [ ] **Step 1: Failing validation test**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { parseTextingSetup } from "@/lib/sms/texting-validation";

const form = (v: Record<string, string>) => { const f = new FormData(); for (const [k, x] of Object.entries(v)) f.set(k, x); return f; };
const sid = "AC" + "0123456789abcdef".repeat(2);

test("valid setup; blank token means keep the saved one", () => {
  assert.deepEqual(parseTextingSetup(form({ account_sid: ` ${sid} `, auth_token: "", phone: "413-555-0000", test_number: "" })), {
    ok: true, values: { accountSid: sid, authToken: null, phone: "+14135550000", testNumber: null },
  });
});

test("rejects bad sid, short token, bad phone", () => {
  assert.equal(parseTextingSetup(form({ account_sid: "AB12", auth_token: "", phone: "4135550000" })).ok, false);
  assert.equal(parseTextingSetup(form({ account_sid: sid, auth_token: "short", phone: "4135550000" })).ok, false);
  assert.equal(parseTextingSetup(form({ account_sid: sid, auth_token: "", phone: "12" })).ok, false);
});
```

- [ ] **Step 2: Implement**

```ts
// src/lib/sms/texting-validation.ts
import { toE164 } from "@/lib/people/people";

export type TextingSetup = { accountSid: string; authToken: string | null; phone: string; testNumber: string | null };

const text = (f: FormData, k: string) => ((f.get(k) as string | null) ?? "").trim();

export function parseTextingSetup(f: FormData): { ok: true; values: TextingSetup } | { ok: false; error: string } {
  const accountSid = text(f, "account_sid");
  const authToken = text(f, "auth_token") || null;
  const phone = toE164(text(f, "phone"));
  const rawTest = text(f, "test_number");
  const testNumber = rawTest ? toE164(rawTest) : null;

  if (!/^AC[0-9a-f]{32}$/i.test(accountSid)) return { ok: false, error: "Account SID starts with AC and has 34 characters." };
  if (authToken && !/^[0-9a-zA-Z]{32}$/.test(authToken)) return { ok: false, error: "Auth Token is 32 letters and numbers." };
  if (!phone) return { ok: false, error: "Enter the Twilio phone number." };
  if (rawTest && !testNumber) return { ok: false, error: "Enter a valid test number." };
  return { ok: true, values: { accountSid, authToken, phone, testNumber } };
}
```

  Run tests → PASS.
- [ ] **Step 3: Server actions** in `src/app/settings/actions.ts`:

```ts
export type TextingState = { error: string | null; success: string | null };

export async function saveTextingSetup(_prev: TextingState, formData: FormData): Promise<TextingState> {
  const profile = await requireRole(["admin"]);
  const parsed = parseTextingSetup(formData);
  if (!parsed.ok) return { error: parsed.error, success: null };
  const v = parsed.values;

  const service = createServiceClient();
  const { data: existing, error: loadError } = await service
    .from("school_sms_config")
    .select("twilio_auth_token_enc")
    .eq("school_id", profile.schoolId)
    .maybeSingle();
  if (loadError) return { error: loadError.message, success: null };

  const key = credentialsKey();
  const tokenEnc = v.authToken ? encryptSecret(v.authToken, key) : existing?.twilio_auth_token_enc ?? null;
  if (!tokenEnc) return { error: "Enter the Auth Token.", success: null };

  const check = await verifyTwilioCredentials({
    accountSid: v.accountSid,
    authToken: v.authToken ?? decryptSecret(tokenEnc, key),
    phoneNumber: v.phone,
  });

  const { error } = await service
    .from("school_sms_config")
    .update({
      twilio_account_sid: v.accountSid,
      twilio_auth_token_enc: tokenEnc,
      twilio_phone_number: v.phone,
      test_number: v.testNumber,
      verified_at: check.ok ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("school_id", profile.schoolId);
  if (error) {
    // 23505 = the number is already registered to another school.
    const message = error.code === "23505" ? "That number is already used by another school." : error.message;
    return { error: message, success: null };
  }

  revalidatePath("/settings");
  revalidatePath("/messages");
  return check.ok
    ? { error: null, success: "Saved and verified with Twilio." }
    : { error: `Saved, but not verified: ${check.error}`, success: null };
}

export async function setTextingMode(mode: "off" | "test" | "live"): Promise<{ error: string | null }> {
  const profile = await requireRole(["admin"]);
  if (!["off", "test", "live"].includes(mode)) return { error: "Unknown mode." };
  const { error } = await createServiceClient()
    .from("school_sms_config")
    .update({ requested_mode: mode, updated_at: new Date().toISOString() })
    .eq("school_id", profile.schoolId);
  revalidatePath("/settings");
  revalidatePath("/messages");
  return { error: error?.message ?? null };
}
```

  Imports: `createServiceClient` from `@/lib/supabase/server`; `credentialsKey`, `decryptSecret`, `encryptSecret` from `@/lib/sms/credentials-crypto`; `verifyTwilioCredentials` from `@/lib/sms/twilio-verify`; `parseTextingSetup` from `@/lib/sms/texting-validation`.
- [ ] **Step 4: Page data.** In `settings/page.tsx` (admin), load via the service client: `twilio_account_sid, twilio_phone_number, test_number, verified_at, requested_mode, live_approved_at` (never the token; the select omits it). Also load `loadSchoolSmsConfig(profile.schoolId)` for the effective mode and reason. Pass a `TextingView` to the form: `{ accountSidMasked: "AC••••" + last4 | null, phone, testNumber, verified: boolean, requestedMode, liveApproved: boolean, effectiveMode, reason, webhookUrl }`. `webhookUrl` is `${origin}/api/sms/inbound`, from the request headers (`headers().get("host")`, `https://`).
- [ ] **Step 5: `texting-form.tsx`** (client, a shadcn Card like the other settings cards):
  - Fields: Account SID (placeholder shows the masked SID when saved; required on first save), Auth Token (`type="password"`, placeholder "Saved — leave blank to keep" when one exists), Twilio phone number, Test number (optional). **Save & verify** button → `saveTextingSetup` via `useActionState`; `InlineError` + toast.
  - Status line: `<StatusBadge>`, success "Verified" / warning "Not verified" / neutral "Not set up".
  - Mode: three buttons `Off` / `Test` / `Live`, calling `setTextingMode` (disabled until verified). Under Live, when requested but not approved: "Waiting for ControlPad approval. Texts go to your test number until then."
  - Help box: "In Twilio, set the number's *A message comes in* webhook to `{webhookUrl}` (HTTP POST)."
- [ ] **Step 6:** `npm test && npx tsc --noEmit && npm run lint` → clean. **Commit:** `git commit -am "Multi-tenancy: Settings → Texting (bring your own Twilio)"` (after `git add`).

### Task 24: Inbound webhook routes by `To`

**Files:** Modify `src/app/api/sms/inbound/route.ts`

- [ ] **Step 1: Replace the handler body**

```ts
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });

  // Which school? The number the parent texted (spec §7.4).
  const to = params.To?.trim();
  if (!to) return twiml();
  const service = createServiceClient();
  // tenant-scope-ok: looking up which school owns this Twilio number
  const { data: config, error } = await service
    .from("school_sms_config")
    .select("school_id, twilio_auth_token_enc")
    .eq("twilio_phone_number", to)
    .maybeSingle();
  if (error) return twiml(500);
  if (!config?.twilio_auth_token_enc) {
    console.error("Inbound SMS for an unknown number.");
    return twiml();
  }

  let authToken: string;
  try {
    authToken = decryptSecret(config.twilio_auth_token_enc as string, credentialsKey());
  } catch {
    console.error(`Inbound SMS: token for school ${config.school_id} could not be decrypted.`);
    return twiml(500);
  }

  // Twilio signs the exact URL configured in its console. Behind Vercel's proxy
  // request.url matches it; TWILIO_INBOUND_URL overrides it if they ever differ.
  const url = process.env.TWILIO_INBOUND_URL?.trim() || request.url;
  if (!isValidTwilioSignature({ authToken, url, params, signature: request.headers.get("x-twilio-signature") })) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 403 });
  }

  const ctx = await loadSchoolContext(config.school_id as string);
  const from = params.From?.trim();
  if (!ctx || !from) return twiml();

  try {
    await handleInboundSms(ctx, { from, body: params.Body ?? "", twilioSid: params.MessageSid ?? params.SmsSid ?? null });
  } catch (error) {
    // No PII in logs: just the failure.
    console.error("Inbound SMS failed:", error instanceof Error ? error.message : "unknown error");
    return twiml(500);
  }
  return twiml();
}
```

  Remove the old `TWILIO_AUTH_TOKEN` env check. Update the header comment: each school's number posts here; the school is found by `To`, and the signature is checked with that school's token.
- [ ] **Step 2:** If there's an existing route test, update it. Otherwise add `src/lib/absence-reports/inbound.test.ts` cases (it exists) asserting that `findGuardiansByPhone` runs on a database created for `ctx` (the fake records the `schoolId` it was built with).
- [ ] **Step 3:** `npm test && npx tsc --noEmit` → clean. **Commit:** `git commit -am "Multi-tenancy: inbound texts routed to the school that owns the number"`

### Task 25: Messages page shows the school's mode

**Files:** Modify `src/app/messages/page.tsx`

- [ ] **Step 1:** Replace `getSmsConfig()` (line ~127) with `await loadSchoolSmsConfig(profile.schoolId)`. Keep the existing display of `mode` and `reason`. If the mode is off because texting isn't set up, add a link to `/settings#texting`. Notifications and inbound queries on this page use the signed-in client, so RLS scopes them. Add `.eq("school_id", profile.schoolId)` anyway for clarity.
- [ ] **Step 2:** `npx tsc --noEmit` → clean. **Commit:** `git commit -am "Multi-tenancy: Messages page shows the school's texting state"`

### Task 26: Platform admin page

**Files:** Create `src/lib/auth/platform-admin.ts`, `src/app/platform/page.tsx`, `src/app/platform/actions.ts`, `src/app/platform/approve-button.tsx`

- [ ] **Step 1: Gate**

```ts
// src/lib/auth/platform-admin.ts
import { notFound, redirect } from "next/navigation";

import { createClient, createServiceClient } from "@/lib/supabase/server";

/** Signed-in user listed in platform_admins, else 404 (don't reveal the page). */
export async function requirePlatformAdmin(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await createServiceClient()
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) notFound();
  return { userId: user.id };
}
```

- [ ] **Step 2: Actions**

```ts
// src/app/platform/actions.ts
"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { createServiceClient } from "@/lib/supabase/server";

export async function setLiveApproval(schoolId: string, approve: boolean): Promise<{ error: string | null }> {
  const { userId } = await requirePlatformAdmin();
  const { error } = await createServiceClient()
    .from("school_sms_config")
    .update({
      live_approved_at: approve ? new Date().toISOString() : null,
      live_approved_by: approve ? userId : null,
      updated_at: new Date().toISOString(),
    })
    .eq("school_id", schoolId);
  revalidatePath("/platform");
  return { error: error?.message ?? null };
}
```

- [ ] **Step 3: Page.** It must not call `getCurrentProfile()`: a platform admin may have no school. It loads with the service client (mark each `.from` with `// tenant-scope-ok: platform admin overview, counts only`):
  - `schools` (non-archived): `id, name, created_at`.
  - `school_sms_config`: `school_id, verified_at, requested_mode, live_approved_at`.
  - Counts per school: `students` and `profiles` via `select("school_id")`, grouped in JS (fine for tens of schools).

  Render a `DataTable` with columns School | Created | Staff | Students | Texting (`StatusBadge`: neutral "Not set up", warning "Waiting for approval" when `requested_mode = 'live'` and not approved, success "Live", neutral "Test"/"Off") | Action (`ApproveButton`: "Approve live" / "Revoke", a client component calling `setLiveApproval` with a sonner toast). Use `PageHeader` and a simple container. There's no `AppShell`, since that needs a school.
- [ ] **Step 4:** Add `/platform` to nothing public in middleware (signed-in only by default).
- [ ] **Step 5:** `npx tsc --noEmit && npm run lint && npm test` → clean (the scope test passes with the annotations). **Commit:** `git commit -am "Multi-tenancy: /platform for approving live texting"` (after `git add`).

### Task 27: Settings → School card

**Files:** Create `src/app/settings/school-form.tsx`; Modify `src/app/settings/actions.ts`, `src/app/settings/page.tsx`

- [ ] **Step 1: Action**

```ts
export async function updateSchool(_prev: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const profile = await requireRole(["admin"]);
  const name = ((formData.get("school_name") as string | null) ?? "").trim();
  const smsName = ((formData.get("sms_name") as string | null) ?? "").trim() || name;
  const timeZone = ((formData.get("time_zone") as string | null) ?? "").trim();
  if (name.length < 2 || name.length > 80) return { error: "School name must be 2–80 characters." };
  if (smsName.length < 2 || smsName.length > 40) return { error: "Text name must be 2–40 characters." };
  if (!isValidTimeZone(timeZone)) return { error: "Pick a time zone." };

  const supabase = await createClient();
  // RLS (schools_admin_update) + column grants limit this to the admin's own school.
  const { error } = await supabase
    .from("schools")
    .update({ name, sms_name: smsName, time_zone: timeZone })
    .eq("id", profile.schoolId);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { error: null };
}
```

- [ ] **Step 2: Form** with the three fields (time zone select over `US_TIME_ZONES`). Place it as the first card on `/settings`, admin only. Pre-fill from `profile`.
- [ ] **Step 3:** `npx tsc --noEmit` → clean. **Commit:** `git commit -am "Multi-tenancy: Settings → School card"` (after `git add`).

### Task 28: School name in the shell

**Files:** Modify `src/components/controlpad/brand.tsx`, `src/components/controlpad/app-shell.tsx`, `src/app/layout.tsx`, `src/app/students/page.tsx`

- [ ] **Step 1:** `BrandMark` takes an optional `schoolName?: string`. It renders `schoolName` where it shows "Salaam Institute" (line ~19) and "ControlPad" when absent (login, signup, onboarding).
- [ ] **Step 2:** `AppShell` gets `schoolName` from wherever it receives the profile (`fullName` and `role` today). Pass `profile.schoolName` through, and replace "Salaam Institute operations" (line ~142) with `` `${schoolName} operations` ``.
- [ ] **Step 3:** `layout.tsx` metadata: `title: "ControlPad"`, `description: "School admin, alerts and parent texting"`.
- [ ] **Step 4:** `students/page.tsx:48`: `` `Your children's records at ${profile.schoolName}.` ``
- [ ] **Step 5:** `grep -rn "Salaam" src` → no results. `npm run build` → clean. **Commit:** `git commit -am "Multi-tenancy: school name in the app shell"`

### Task 29: Setup checklist

**Files:** Create `src/lib/schools/setup-checklist.ts` (+ test), `src/components/controlpad/setup-checklist.tsx`; Modify `src/app/page.tsx`

- [ ] **Step 1: Failing test**

```ts
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
```

- [ ] **Step 2: Implement**

```ts
// src/lib/schools/setup-checklist.ts
export type SetupCounts = { scheduleGroups: number; staff: number; students: number; guardians: number; textingVerified: boolean };
export type SetupItem = { key: string; label: string; href: string; done: boolean };

export function buildSetupChecklist(c: SetupCounts): { items: SetupItem[]; complete: boolean } {
  const items: SetupItem[] = [
    { key: "groups", label: "Add a schedule group (days and start times)", href: "/settings#schedule-groups", done: c.scheduleGroups > 0 },
    { key: "staff", label: "Add your teachers", href: "/staff", done: c.staff > 0 },
    { key: "students", label: "Add students", href: "/students", done: c.students > 0 },
    { key: "guardians", label: "Add parents and guardians", href: "/guardians", done: c.guardians > 0 },
    { key: "texting", label: "Connect your Twilio number", href: "/settings#texting", done: c.textingVerified },
  ];
  return { items, complete: items.every((item) => item.done) };
}
```

  Run → PASS.
- [ ] **Step 3: Component** (client): a Card titled "Get your school ready", with a check icon (success) or circle (neutral) per item linking to `href`, a "Review thresholds and the school calendar" link to `/settings`, and a **Hide** button storing `localStorage["setup-checklist-hidden:<schoolId>"]` (wrapped in try/catch). It renders nothing when `complete` or hidden.
- [ ] **Step 4: Dashboard.** In the admin branch of `src/app/page.tsx`, compute counts with the signed-in client (`count: "exact", head: true` on `schedule_groups`, `students`, `guardians`, and `profiles` where `role = 'moderator'`). `textingVerified` comes from `(await loadSchoolSmsConfig(profile.schoolId)).twilio !== null || <verified_at set>`. Simplest: a service read of `school_sms_config.verified_at` for `profile.schoolId`. Render the checklist at the top.
- [ ] **Step 5:** `npm test && npm run build` → clean. **Commit:** `git commit -am "Multi-tenancy: setup checklist on the dashboard"` (after `git add`).

---

## Phase 5 — Docs and verification

### Task 30: Docs

**Files:** Modify `docs/DATA_MODEL.md`, `docs/PROJECT_PLAN.md`, `docs/SETUP.md`, `CLAUDE.md`

- [ ] **DATA_MODEL.md:** add `schools`, `school_sms_config`, `platform_admins`, `profiles.school_id`. Add a "Tenancy" design note (every tenant table has `school_id`, default `current_school_id()`, composite FKs). Show `settings`/`school_weekly_patterns` keyed by `school_id`, `school_special_days` keyed `(school_id, date)`, and `schedule_groups` unique `(school_id, name)`. Rewrite the RLS section around `current_school_id()` with the new-table rows from spec §5, and note that `profiles_own_insert` was removed.
- [ ] **PROJECT_PLAN.md:** retitle it as ControlPad (multi-school). Add §1 note: anyone can sign up and create a school; Salaam Institute is one tenant. In §2, add Platform admin as a role. Add new module sections: sign-up/onboarding, Settings → School/Texting, `/platform`. In §3.6, replace the env-Twilio description with per-school Twilio, effective mode and approval. In §4, list the new env var `SMS_CREDENTIALS_KEY`, and mark `TWILIO_*` env as no longer used for sending. Scheduled jobs: the tick runs 24 h and loops schools. Add the four new migrations to §5, the new folders to §6, an entry to §9 history, and update §10 with owner steps (Task 33). Add confirmed decisions D1–D8 to §12.
- [ ] **SETUP.md:** add `SMS_CREDENTIALS_KEY` (generate with `openssl rand -base64 32`; Vercel + `.env.local`; never `NEXT_PUBLIC_`). Add custom SMTP for Supabase Auth, how to add a platform admin (`insert into platform_admins (user_id) select id from auth.users where email = '<you>';`, run in the SQL editor; it's data, not schema), and running the migrations on a scratch project first (`supabase db dump` / restore, or Supabase branching). Add `supabase test db` (Docker) and a per-school Twilio guide (buy number, A2P, webhook URL, paste SID/token/number in Settings → Texting).
- [ ] **CLAUDE.md:** add rules: every new table gets `school_id` (default `current_school_id()`), a composite FK to its parent, and policies checking `current_school_id()` (`tests/tenant-rls.test.mjs` enforces this; add the table to `src/lib/schools/tenant-tables.mjs`). Service-role code takes a `SchoolContext` and filters every query by `school_id` (`tests/service-role-school-scope.test.mjs`). `sendSms` needs `schoolId`; never read `TWILIO_*` env for sending. Use the school's `timeZone`; never hard-code a zone. Update the repo-conventions bullets for `src/lib/schools/`, `/signup`, `/onboarding` and `/platform`.
- [ ] **Commit:** `git commit -am "Multi-tenancy: docs"`

### Task 31: Full verification

- [ ] `npm test` → all pass (baseline count + new tests).
- [ ] `npx tsc --noEmit` → clean. `npm run lint` → clean. `npm run build` → succeeds.
- [ ] `grep -rn "America/New_York" src` → only `src/lib/schools/time-zones.ts` and tests. `grep -rn "Salaam" src` → none. `grep -rn '\.eq("id", 1)' src` → none.
- [ ] `node scripts/audit-launch-readiness.mjs` → no new failures (update its checks if it asserts single-school things, e.g. `settings.id = 1`).
- [ ] Read the full diff once against the spec (§3–§9), item by item.

### Task 32: Code review

- [ ] Use superpowers:requesting-code-review on the whole branch, focusing on: every service-role query scoped, no token ever selected into a page or returned to the client, the `create_school()` checks, RLS policy completeness, and the inbound route verifying the signature before acting.

### Task 33: Owner hand-off (Claude doesn't do these)

Put these steps in the PR description:
1. Check Postgres ≥ 15 (`select version();`).
2. Generate `SMS_CREDENTIALS_KEY` (`openssl rand -base64 32`) and add it to Vercel (Production + Preview) and `.env.local`.
3. In Supabase Auth: set up custom SMTP and add the site URL + `/auth/callback` to the redirect URLs.
4. Restore a copy of production into a scratch project, `supabase db push` there, run `supabase test db`, then check the Vercel preview against it: sign up, create a school, add a student, and confirm the old data is invisible.
5. `supabase db push` to production, then merge and deploy straight away (existing logins see onboarding until then).
6. Add yourself to `platform_admins` (SETUP).
7. Create Salaam Institute via sign-up/onboarding, enter its Twilio details, verify, request live, approve on `/platform`.
8. Later: `node --env-file=.env.local scripts/delete-archive-school.mjs`.
9. Rotate the service-role key if still pending (PROJECT_PLAN §10 item 6).
