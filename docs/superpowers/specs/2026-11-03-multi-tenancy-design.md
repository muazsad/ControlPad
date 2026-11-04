# Multi-tenancy — design spec

**Status:** draft for owner review · **Branch:** `feat/multi-tenant` (off `main` @ `daa9a41`)
**Date:** 2026-11-03

## 1. Goal

Today ControlPad serves one school (Salaam Institute). Every table is global, `settings` is a single row
(`id = 1`), the first person to sign in becomes admin, all text is prefixed "Salaam Institute:", times are
hard-coded to `America/New_York`, there is one Twilio account in env, and the crons read every student in
the database.

After this work, anyone can sign up, create a school, configure it (settings, calendar, schedule groups,
staff, their own Twilio) and use every feature — students, guardians, grades, attendance, Quran/hifz,
tuition, announcements, messages, SMS alerts and the scheduled jobs — with their data isolated from every
other school **by the database**, not just by the app.

**Done means:**
- Migrations are additive and safe; existing rows are preserved (parked in an archive school, §3.5).
- A new user can sign up and get an empty, working school.
- RLS stops cross-school reads and writes, with tests.
- Crons and alerts run per school.
- `npm test` and `npm run build` pass; `PROJECT_PLAN.md` and `DATA_MODEL.md` are updated.

**Out of scope:** billing / Stripe, custom domains or per-school branding beyond the name, school deletion
and data export, one login in several schools, and GCVS-specific wording in the UI.

---

## 2. Decisions

| # | Decision | Answer |
|---|---|---|
| D1 | Tenancy model | One database, a `schools` table, `school_id` on every table, enforced by RLS. *(Recommended; schema- or project-per-school rejected as too heavy.)* |
| D2 | Salaam Institute's existing data | **Owner: start fresh.** Salaam signs up like any school. Existing rows are not deleted by migration (§3.5). |
| D3 | SMS per school | **Owner: each school brings its own Twilio account** (SID, auth token, phone number), entered in Settings. Credentials are encrypted at rest. |
| D4 | Billing | **Owner: none in v1.** Free. |
| D5 | One user, several schools? | **Owner: one school per login.** An email already used at one school can't join another. A parent with children at two schools uses two emails. |
| D6 | Onboarding | `/signup` → confirm email → `/onboarding` (create school) → dashboard with a setup checklist. *(Recommended; open for review.)* |
| D7 | Who can sign up | **Owner: open sign-up, texting gated.** Any school can save and test its Twilio setup in test mode, but **live** texting needs a platform admin to approve it (§8). |
| D8 | Email confirmation | Required. Supabase's built-in mailer allows only a few emails per hour, so the owner adds custom SMTP before announcing sign-up. *(Recommended; open for review.)* |

---

## 3. Data model

### 3.1 New tables and columns

```sql
create table schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 2 and 80),
  sms_name    text not null,                       -- prefix on texts, e.g. "Salaam Institute"
  time_zone   text not null default 'America/New_York',  -- IANA, validated in app
  archived    boolean not null default false,      -- true only for the pre-tenancy archive (§3.5)
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Per-school texting setup (D3). Secrets are encrypted by the app (§7.3).
-- RLS on, NO policies: only the service role reads or writes this table.
create table school_sms_config (
  school_id              uuid primary key references schools(id) on delete cascade,
  twilio_account_sid     text,                     -- not secret, stored plain (shown masked)
  twilio_auth_token_enc  text,                     -- AES-256-GCM ciphertext, never sent to the browser
  twilio_phone_number    text unique,              -- E.164; verified to belong to the account
  verified_at            timestamptz,              -- last successful credential check
  requested_mode         text not null default 'off' check (requested_mode in ('off','test','live')),
  live_approved_at       timestamptz,              -- set by a platform admin (D7)
  live_approved_by       uuid references auth.users(id),
  test_number            text,                     -- where 'test' mode sends
  updated_at             timestamptz not null default now()
);

-- Platform owner(s): can list schools and approve live texting (§8). No access to school data.
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
```

`profiles` gains `school_id uuid references schools(id)` (one school per login, D5). `role` and `phone`
stay on `profiles` and mean "in that school". A profile without `school_id` is a signed-up user who
hasn't created a school yet.

### 3.2 `school_id` on every existing table

Added to **every** tenant table, including child tables that could reach it through `students`, so each
RLS policy is a direct column check (fast, indexable, no joins, no recursion):

`students, guardians, student_guardians, courses, grades, attendance, quran_progress,
student_memorized_juz, juz_tests*, payments, notifications, schedule_groups, schedule_group_days,
school_breaks, school_special_days, inbound_messages, absence_reports, announcements` plus the per-school
config tables in §3.3.

\* `juz_tests` is in open PR muazsad/ControlPad#7, not on `main` yet. Whichever lands second adds
`school_id` to it. If #7 merges first, this branch's migration covers it. If this branch merges first,
#7's migration is updated to create the column.

**Consistency:** a row's `school_id` must match its parent's. `students`, `courses`, `guardians` and
`schedule_groups` get `unique (id, school_id)`, and children reference `(parent_id, school_id)` with
composite foreign keys (e.g. `grades (course_id, school_id) → courses (id, school_id)`). A bug in server
code can then never attach a grade to another school's student. The database refuses it.

**Default:** `school_id default public.current_school_id()` (§4). Signed-in inserts that don't mention
`school_id` keep working unchanged. Service-role code has no signed-in user, so it **must** pass
`school_id` explicitly (the default is null and `not null` rejects it). That is deliberate.

### 3.3 Single-row tables become per school

| Table | Today | After |
|---|---|---|
| `settings` | `id int = 1` | `school_id uuid primary key` (the `id = 1` check is dropped) |
| `school_weekly_patterns` | `id int = 1` | same |

`create_school()` (§6) inserts both rows with today's defaults. The ~20 `.eq("id", 1)` reads become
`.eq("school_id", schoolId)`.

### 3.4 Uniques that must become per school

- `schedule_groups.name unique` → `unique (school_id, name)`
- `school_special_days` primary key `date` → `(school_id, date)`
- `inbound_messages.twilio_sid unique` stays global (Twilio SIDs are global).
- `school_sms_config.twilio_phone_number unique`: one school per number (§7.4 routes by it).

### 3.5 Existing data: the archive school (D2)

The owner chose to start Salaam fresh. A migration can't set `school_id not null` while leaving rows
without one, and silently deleting real children's records in a migration is not safe. So:

- The migration creates one school, **"Pre-multi-tenant archive"** (`archived = true`), and backfills
  every existing row and every existing profile into it.
- RLS hides archived schools from everyone (`current_school_id()` returns null for an archived school), so
  existing logins land on `/onboarding` as if new. The owner signs up or signs in and creates Salaam fresh.
- Crons skip archived schools. Nothing in the archive is texted.
- When the owner is sure, `scripts/delete-archive-school.mjs` (owner-run, prints counts and asks for
  confirmation) deletes the archive school. Every table cascades from `schools`. The archived profiles'
  auth users are left alone.

### 3.6 Migration files (each in its own transaction, re-runnable)

1. `…_schools.sql`: `schools`, `school_sms_config`, `platform_admins`, `profiles.school_id`; insert the
   archive school.
2. `…_school_id_columns.sql`: add nullable `school_id` everywhere, backfill to the archive school, then
   `set not null`, defaults, composite FKs, per-school uniques, `(school_id, …)` indexes, and per-school
   keys on `settings` / `school_weekly_patterns`.
3. `…_tenant_rls.sql`: helpers (§4), `create_school()` (§6) and the rewritten policies (§5).
4. `…_tick_all_day.sql`: the pg_cron tick runs every 10 minutes around the clock (§7.2).

The owner runs them on a scratch copy of production first (new SETUP.md section), then on production.

---

## 4. Auth & the current school

```sql
-- The signed-in user's school, unless it is archived.
create function public.current_school_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select p.school_id from profiles p join schools s on s.id = p.school_id
  where p.id = auth.uid() and not s.archived $$;

-- Role in that school. Same name/signature as today, so existing policy bodies keep their meaning.
create or replace function public.user_role() returns user_role
  language sql stable security definer set search_path = public as $$
  select p.role from profiles p where p.id = auth.uid() and p.school_id = public.current_school_id() $$;
```

`parent_has_student()` and `parent_can_read_guardian()` gain the same school filter.

**App side** (`src/lib/auth/current-profile.ts`):
- `CurrentProfile` gains `schoolId`, `schoolName`, `smsName` and `timeZone`.
- `getCurrentProfile()`: no user → `/login`; no profile, or no (non-archived) school → `/onboarding`.
- `requireRole(allowed)` keeps its signature. The role is the user's role in their school.
- `profiles.school_id` can't be changed by the user (RLS: no update of `school_id`/`role` on your own row).

---

## 5. RLS

Every policy on a tenant table gets `school_id = public.current_school_id()` in `using` **and**
`with check`. The role rules from the existing access matrix stay exactly as they are:

```sql
create policy students_admin_all on students for all
  using      (school_id = current_school_id() and user_role() = 'admin')
  with check (school_id = current_school_id() and user_role() = 'admin');
```

New tables:

| Table | Admin | Moderator | Parent | Other |
|---|---|---|---|---|
| `schools` | read own; update `name`, `sms_name`, `time_zone` | read own | read own | platform admins go through service-role server code, not RLS |
| `profiles` | read/write profiles in own school (staff + parent logins) | read own school's staff | read own row | every user reads their own row; nobody inserts their own profile (only `create_school()` / an admin) |
| `school_sms_config` | none (server actions only, §7.3) | none | none | service role |
| `platform_admins` | none | none | none | service role |

**Tests:**
1. **Static, in `npm test`** (`tests/tenant-rls.test.mjs`, same approach as `rls-policy-recursion.test.mjs`):
   fails if any `public` table lacks RLS, any tenant table lacks `school_id`, or any policy on a tenant
   table doesn't reference `current_school_id()`.
2. **Behavioural** (`supabase/tests/tenant_isolation.test.sql`, pgTAP, run with `supabase test db`): two
   schools, each with an admin, moderator and parent. For every table, as each user, it asserts zero rows
   from the other school, that inserts/updates carrying the other school's id fail, that composite-FK
   mismatches fail, and that archive-school rows are invisible. This needs Docker, so the owner runs it
   (SETUP instructions). It is also part of the pre-merge checklist.

---

## 6. Sign-up & onboarding

- **`/signup`** (public): name, email, password → `supabase.auth.signUp` → "check your email" →
  `/auth/callback` → `/onboarding`.
- **`/onboarding`** (signed in, no school): school name, SMS name (defaults to the school name), time zone
  (US zones dropdown, default Eastern), your phone. It calls `create_school(...)`, a `security definer`
  RPC that in one transaction inserts the school, its `settings`, `school_weekly_patterns` and empty
  `school_sms_config` rows, and creates or updates the caller's profile as `admin` of it. It refuses if
  the caller already has a non-archived school.
- **`/setup-profile`**: the "first person becomes admin" bootstrap is removed. The page redirects to
  `/onboarding`.
- **`/login`**: adds a "Create a school" link to `/signup`.
- **Setup checklist** (admin dashboard, until done or dismissed): review settings, weekly pattern, add a
  schedule group, add staff, add students + guardians, set up texting. Each links to the existing page;
  no new configuration UI beyond §7.3 and §9.
- **Staff / parent logins** (`createAuthUserWithProfile`): take the admin's `schoolId` and set it on the
  new profile. If the email already has an account, the action fails with "This email is already used by
  another ControlPad account" (D5). It never says which school.

---

## 7. Server-side (service role) code

### 7.1 Rule

The service role bypasses RLS, so isolation there relies entirely on code. Every service-role entry point
takes a `schoolId` and every query filters on it. To make that hard to forget:

- A `SchoolContext` type (`{ schoolId, timeZone, smsName }`) is passed into alert, SMS, inbound and
  announcement functions instead of each building its own assumptions.
- Composite FKs (§3.2) make cross-school writes fail even if a filter is missed.
- A static test (in `npm test`): in files importing `createServiceClient`, every `.from("<tenant table>")`
  chain must mention `school_id`. Known-safe exceptions are listed in the test with a reason.

### 7.2 Crons

- `/api/cron/attendance-tick` and `/api/cron/payment-overdue` load all non-archived schools and run the
  existing logic per school with **error isolation**: one school failing is logged by school id only and
  the loop continues. The JSON response reports per school.
- Each school's local time comes from `schools.time_zone`. The hard-coded `America/New_York` constants
  (`attendance-escalation`, `attendance`, `admin-digest`, `announcements`, `grades/sweep`,
  `student-schedule`, absence-report date parsing) become parameters with no default.
- The pg_cron tick runs every 10 minutes **all day** (`*/10 * * * *`) instead of 10:00–23:50 UTC,
  because schools may be in other zones. Local-time constants (`QURAN_CHECK_TIME`, the 6 PM special-day
  notice, digest time) still decide what runs, so off-hours ticks do nothing.
- `?date=` and `?force=1` still work. A new `?school=<id>` limits a manual run to one school.
- **Scale note:** one tick loops schools sequentially within Vercel's 300 s limit. That's fine for tens
  of schools. At hundreds, fan out (one request per school, or Vercel Queues). Not built now.

### 7.3 SMS (`lib/sms/send-sms.ts`) and Twilio credentials

- **Settings → Texting** (admin): Account SID, Auth Token, phone number, test number. **Save** encrypts
  the token server-side (AES-256-GCM, key from a new env var `SMS_CREDENTIALS_KEY`, 32 random bytes,
  server-only), then **verifies**: it calls Twilio with the credentials to confirm they work and that the
  number belongs to that account. It records `verified_at`. The token is never returned to the browser.
  The page shows "•••• last 4" and "Replace".
- The admin picks `off` / `test` / `live`. `test` works as soon as the setup is verified. `live` is saved
  as *requested* and shows "Waiting for approval" until a platform admin approves (D7).
- `sendSms(ctx, input)` loads the school's config and picks the **effective mode**:
  - env `SMS_MODE` is a global ceiling (`off` forces everyone off, `test` caps everyone at test);
  - not verified, no number, or no token → `off`;
  - `live` without `live_approved_at` → `test` if a test number is set, else `off`.
  It sends with that school's own Twilio credentials and number. The env `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN` and `TWILIO_PHONE_NUMBER` are no longer used for sending.
- `notifications.school_id` is set on every row. Dedupe (`decideDedupe`) is unchanged, but its query
  adds `school_id`.
- Every hard-coded "Salaam Institute:" prefix becomes `${ctx.smsName}:`.
- `/messages` shows the school's effective mode and why (e.g. "Live requested — waiting for approval").

### 7.4 Inbound (`/api/sms/inbound`)

Each school points its Twilio number's incoming-message webhook at the same URL (instructions on the
Texting card). On each request:

1. Look up `To` in `school_sms_config.twilio_phone_number`. No match → empty TwiML, no reply, log `To`
   only.
2. Verify `X-Twilio-Signature` with **that school's** decrypted auth token. If it fails → 403.
3. `handleInboundSms(ctx, { from, body, twilioSid })` matches the guardian **within that school** only.
   Replies go through `sendSms(ctx, …)`.

The `/messages` simulator passes the admin's own school context.

---

## 8. Platform admin & safeguards

- **`/platform`** (platform admins only, checked server-side against `platform_admins`): list of schools
  (name, created, staff/student counts, texting state). Actions: **approve live texting** / **revoke**.
  It shows no student, guardian or message data.
- Platform admins are added by the owner (one SQL insert, documented in SETUP; not done by Claude).
- New schools can't text anyone but their own test number until approved. Their own Twilio account
  carries the cost (D3/D4).
- `create_school()` allows one school per login (D5), which also limits sign-up spam per account.

---

## 9. UI changes (small)

- Brand: the app shell, layout title and SMS prefixes use the school's name. "ControlPad" stays the
  product name on `/login`, `/signup` and `/onboarding`.
- Settings → new **School** card (name, SMS name, time zone) and **Texting** card (§7.3).
- Dashboard: setup checklist (§6).

---

## 10. Rollout & phasing

Each phase keeps `main` building and tests green:

1. **Schema + archive backfill + RLS + tests** (§3–5).
2. **Auth & current school** (§4), `/signup`, `/onboarding`, `.eq("id", 1)` → `school_id` reads.
3. **Service-role per school** (§7): crons loop schools, `SchoolContext`, time zone parameters, static
   service-role test.
4. **Per-school Twilio** (§7.3–7.4), `/platform` (§8), School card, setup checklist.
5. **Docs**: `PROJECT_PLAN.md`, `DATA_MODEL.md`, `SETUP.md`, `CLAUDE.md` (new rules: every tenant table
   has `school_id`; service-role code takes a `SchoolContext`; never read `TWILIO_*` env for sending).

Phases 1 and 2 must ship together. Once phase 1 is applied, existing logins see `/onboarding`, which
only exists from phase 2. The whole branch ships as one PR and deploys right after the migrations are
applied.

**Owner steps (Claude doesn't do these):**
1. Run the migrations on a scratch Supabase project, run `supabase test db`, check the preview.
2. Add `SMS_CREDENTIALS_KEY` to Vercel (and `.env.local`). Command to generate it is in SETUP.
3. Configure custom SMTP in Supabase Auth (for sign-up confirmation emails).
4. `supabase db push` to production, then merge/deploy.
5. Add yourself to `platform_admins`.
6. Sign up / sign in and create Salaam Institute. Enter its Twilio details, test, approve live.
7. Later, run `scripts/delete-archive-school.mjs` when sure the old data isn't needed.

---

## 11. Risks

- **A missed `school_id` filter in service-role code** leaks or mis-sends across schools. Mitigations:
  `SchoolContext`, composite FKs, the static test, pgTAP tests.
- **Stored Twilio tokens.** A leaked `SMS_CREDENTIALS_KEY` plus a database dump exposes every school's
  Twilio account. The key lives only in server env, the table has no RLS policies, and tokens never
  reach the browser or logs. Rotation needs a re-encrypt script (not built; documented as a limit).
- **Hard-coded Eastern assumptions** beyond the constants found so far. Each is parameterised in phase 3,
  and tests run with a non-Eastern zone (e.g. `America/Los_Angeles`).
- **Existing logins land on onboarding** after deploy. That's expected (D2). The owner should know
  beforehand that the test accounts from `npm run seed` will see it too.
- **PR #7 (`juz_tests`)** ordering, see §3.2.
