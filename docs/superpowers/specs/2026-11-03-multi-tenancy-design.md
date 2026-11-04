# Multi-tenancy — design spec

**Status:** draft, waiting on owner decisions (§2) · **Branch:** `feat/multi-tenant` (off `main` @ `daa9a41`)
**Date:** 2026-11-03

## 1. Goal

Today ControlPad serves one school (Salaam Institute). Every table is global, `settings` is a single row
(`id = 1`), the first person to sign in becomes admin, all text is prefixed "Salaam Institute:", times are
hard-coded to `America/New_York`, and the crons read every student in the database.

After this work, anyone can sign up, create a school, configure it (settings, calendar, schedule groups,
staff) and use every feature — students, guardians, grades, attendance, Quran/hifz, tuition,
announcements, messages, SMS alerts and the scheduled jobs — with their data isolated from every other
school **by the database**, not just by the app.

**Done means:**
- Migrations are additive and safe; existing data is backfilled into school #1.
- A new user can sign up and get an empty, working school.
- RLS stops cross-school reads and writes, with tests.
- Crons and alerts run per school.
- `npm test` and `npm run build` pass; `PROJECT_PLAN.md` and `DATA_MODEL.md` are updated.

**Out of scope:** online tuition payments (Stripe), custom domains or per-school branding beyond the name,
school deletion and data export (a later admin feature), and moving GCVS-specific wording out of the UI.

---

## 2. Decisions for the owner

Each has a recommendation. §3 onwards assumes the recommendation and notes where an answer changes it.

| # | Decision | Recommendation | Alternatives |
|---|---|---|---|
| D1 | **Tenancy model** | One database, a `schools` table, `school_id` on every table, enforced by RLS | Schema per school; Supabase project per school. Both multiply migrations, crons and keys per school. Too heavy for this app. |
| D2 | **Salaam Institute's data** | Migrate everything into school #1, keep all existing logins working | Start Salaam fresh (data loss); keep Salaam on a separate deployment (two codebases to maintain) |
| D3 | **SMS per school** | **A Twilio number per school**, all on the owner's Twilio account. Inbound texts are routed by the `To` number. New schools start with texting **off** until the owner assigns a number. | (a) One shared number: inbound routing is by the parent's phone, which is ambiguous if a family is in two schools, and every school's texts come from the same sender. (b) Each school brings its own Twilio account: they'd paste credentials into the app (stored encrypted), which means more support and more secrets to protect. |
| D4 | **Billing / pricing** | None in v1. Free, with the owner turning texting on per school (this is where real cost sits). | Stripe subscription before texting can be enabled; per-SMS pass-through billing |
| D5 | **One user, several schools?** | Schema supports it (`school_members`), and a user has one *active* school at a time with a switcher shown only when they have more than one. Needed anyway for a parent whose children attend two schools. | Strictly one school per user: simpler, but an email used in school A can never be staff or a parent in school B |
| D6 | **Onboarding** | `/signup` (email + password) → `/onboarding` (school name, time zone, your name + phone) → dashboard with a **setup checklist** (settings, calendar, schedule groups, staff, first students) that disappears when done | A blocking multi-step wizard before the app can be used |
| D7 | **Who can sign up** | Open sign-up, plus the safeguards in §8 (texting off by default, owner enables it). | Invite code / waitlist; owner approves each new school before it works at all |
| D8 | **Email confirmation on sign-up** | Require it (Supabase sends the email). Supabase's built-in mailer is limited to a few emails per hour, so before opening sign-up publicly the owner should add custom SMTP (e.g. Resend) in Supabase. | No confirmation: faster, but anyone can sign up with someone else's email |

---

## 3. Data model

### 3.1 New tables

```sql
create table schools (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(trim(name)) between 2 and 80),
  sms_name            text not null,              -- prefix on texts, e.g. "Salaam Institute"
  time_zone           text not null default 'America/New_York',  -- IANA, validated in app
  sms_mode            text not null default 'off' check (sms_mode in ('off','test','live')),
  twilio_phone_number text unique,                -- E.164; set by the platform owner (D3)
  sms_test_number     text,                       -- where 'test' mode sends
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table school_members (
  school_id  uuid not null references schools(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       user_role not null,
  phone      text,                                -- staff alert phone, per school
  created_at timestamptz not null default now(),
  primary key (school_id, user_id)
);

-- Platform owner(s): can see the school list and set texting/number per school (§8).
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
```

`profiles` keeps `full_name` and gains `active_school_id uuid references schools(id)`. `profiles.role`
and `profiles.phone` move to `school_members` (D5): the columns stay for one release, then a later
migration drops them.

### 3.2 `school_id` on every existing table

Added to **every** table, including child tables that could reach it through `students`, so each RLS
policy is a direct column check (fast, indexable, no joins, no recursion):

`students, guardians, student_guardians, courses, grades, attendance, quran_progress,
student_memorized_juz, juz_tests*, payments, notifications, schedule_groups, schedule_group_days,
school_breaks, school_special_days, inbound_messages, absence_reports, announcements` plus the per-school
config tables below.

\* `juz_tests` is in open PR muazsad/ControlPad#7, not on `main` yet. Whichever lands second adds
`school_id` to it. If #7 merges first, this branch's migration covers it. If this branch merges first,
#7's migration is updated to create the column.

**Consistency:** a row's `school_id` must match its student's. Students get `unique (id, school_id)`, and
each child table references `(student_id, school_id) → students(id, school_id)` with a composite foreign
key. The same applies to `courses → grades`, `guardians → student_guardians`, and
`schedule_groups → schedule_group_days / students.schedule_group_id`. A bug in server code can then never
attach a grade to another school's student. The database refuses it.

**Default:** `school_id default public.current_school_id()` (§4). Signed-in inserts that don't mention
`school_id` keep working unchanged. Service-role code has no signed-in user, so it **must** pass
`school_id` explicitly (the default is null, which `not null` rejects). That is deliberate.

### 3.3 Single-row tables become per school

| Table | Today | After |
|---|---|---|
| `settings` | `id int = 1` | `school_id uuid primary key`; `id` column dropped after backfill |
| `school_weekly_patterns` | `id int = 1` | same |

`create_school()` (§6) inserts both rows with defaults. The ~20 `.eq("id", 1)` reads become
`.eq("school_id", schoolId)` (signed-in reads could rely on RLS, but explicit is clearer and also works
for the service role).

### 3.4 Uniques that must become per school

- `schedule_groups.name unique` → `unique (school_id, name)`
- `school_special_days` primary key `date` → `(school_id, date)`
- `guardians`: no change. The same phone can exist in two schools, and inbound routing uses the
  school's number (D3).
- `inbound_messages.twilio_sid unique` stays global (Twilio SIDs are global).

### 3.5 Migration order (all additive, one file per step)

1. `…_schools.sql`: create `schools`, `school_members`, `platform_admins`; insert school #1 ("Salaam
   Institute", `America/New_York`, `sms_mode = 'off'`, no number yet; texting is off today anyway).
2. `…_school_id_columns.sql`: add nullable `school_id` everywhere, backfill everything to school #1, copy
   `profiles.role/phone` into `school_members`, set `profiles.active_school_id`, then `set not null`,
   defaults, composite FKs, per-school uniques and indexes `(school_id, …)`.
3. `…_tenant_rls.sql`: helpers (§4) and rewritten policies (§5).
4. `…_tick_all_day.sql`: tick every 10 minutes around the clock (§7.2).

Steps 1–3 run inside a transaction each. Re-running is safe (`if not exists`, `on conflict do nothing`).
Run the full set against a **copy** of production first (SETUP §… gets a "restore a backup to a branch
project" section).

---

## 4. Auth & the active school

RLS can't read cookies, so the active school lives in the database:

```sql
-- Active school of the signed-in user, only if they are still a member of it.
create function public.current_school_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select p.active_school_id from profiles p
  join school_members m on m.school_id = p.active_school_id and m.user_id = p.id
  where p.id = auth.uid() $$;

-- Role in the active school (replaces today's user_role()).
create or replace function public.user_role() returns user_role
  language sql stable security definer set search_path = public as $$
  select m.role from school_members m
  where m.user_id = auth.uid() and m.school_id = public.current_school_id() $$;
```

`user_role()` keeps its name and signature, so every existing policy body that says
`user_role() = 'admin'` stays meaningful. It now means *admin of my active school*.
`parent_has_student()` and `parent_can_read_guardian()` gain the same school filter.

**App side** (`src/lib/auth/current-profile.ts`):
- `CurrentProfile` gains `schoolId`, `schoolName`, `timeZone`, and `schools` (for the switcher).
- `getCurrentProfile()`: no user → `/login`; no profile or no membership → `/onboarding`; no valid active
  school but one or more memberships → set it to the first one and continue.
- `requireRole(allowed)` is unchanged at call sites. The role it checks is now the role in the active school.
- New `switchSchool(schoolId)` server action: verifies membership, updates `active_school_id`, revalidates.
  The school switcher appears in the user menu only with more than one membership.

---

## 5. RLS

Every policy on a tenant table gets `school_id = public.current_school_id()` added (in `using` **and**
`with check`), keeping today's role rules from the access matrix exactly as they are:

```sql
create policy students_admin_all on students for all
  using      (school_id = current_school_id() and user_role() = 'admin')
  with check (school_id = current_school_id() and user_role() = 'admin');
```

New-table access:

| Table | Admin | Moderator | Parent | Other |
|---|---|---|---|---|
| `schools` | read own; update name/sms_name/time_zone | read own | read own (name only) | platform admin: read all, update sms fields |
| `school_members` | full (own school) | read own school | read own row | — |
| `platform_admins` | none | none | none | service role only |

`sms_mode`, `twilio_phone_number` and `sms_test_number` can only be changed by a platform admin (column
check in a security-definer RPC). A school admin can't switch their school to live texting themselves (D4/D7).

**Tests** (both run in `npm test` or alongside it):
1. **Static (`tests/tenant-rls.test.mjs`, in `npm test`):** parses all migrations and fails if any
   `public` table lacks RLS, lacks a `school_id` column (except `schools`, `platform_admins`, `profiles`),
   or has a policy without `current_school_id()`, using the same approach as the existing
   `rls-policy-recursion.test.mjs`.
2. **Behavioural (`supabase/tests/tenant_isolation.test.sql`, pgTAP, `supabase test db`):** creates two
   schools with an admin, moderator and parent each, then as each user asserts zero rows from the other
   school on every table, that inserts/updates with the other school's id are rejected, and that a
   composite-FK mismatch is rejected. Needs Docker locally, so the owner runs it (instructions in SETUP).

---

## 6. Sign-up & onboarding

- **`/signup`** (public): name, email, password → `supabase.auth.signUp` (confirmation email per D8) →
  "check your email" → `/auth/callback` → `/onboarding`.
- **`/onboarding`** (signed in, no membership): school name, time zone (US zones dropdown, default
  Eastern), your phone. It calls `create_school(name, time_zone, full_name, phone)`, a `security definer`
  RPC that in one transaction inserts the school, the admin membership, the profile (if missing), the
  `settings` and `school_weekly_patterns` rows, and sets `active_school_id`. It is rate-limited to 3
  schools per user.
- **`/setup-profile`**: the "first person becomes admin" bootstrap is removed (it would let the first
  sign-up take over Salaam). Users created by an admin already have a profile and membership, so the page
  becomes a redirect to `/onboarding`.
- **`/login`**: adds a "Create a school" link. Unchanged otherwise.
- **Setup checklist** (dashboard, admin, until all done or dismissed): review settings, set the weekly
  pattern, add a schedule group, add staff, add students + guardians, (texting: "ask ControlPad to enable
  texting"). Each item links to the existing page. No new configuration UI is needed: every setting
  already has a page.
- **Staff / parent logins** (`createAuthUserWithProfile`): take the admin's `schoolId` and insert the
  `school_members` row. If the email already has an account (D5), add a membership instead of failing.
  The admin then sees "added existing account". The admin never sets or learns that person's password.

---

## 7. Server-side (service role) code

### 7.1 Rule

The service role bypasses RLS, so isolation there relies entirely on code. Every service-role entry point
takes a `schoolId` and every query filters on it. To make that hard to forget:

- `createServiceClient()` stays, and a new `forSchool(schoolId)` helper returns `{ db, schoolId }`.
  Alert and SMS functions take that object instead of building their own client.
- Composite FKs (§3.2) make cross-school writes fail even if a filter is missed.
- `scripts/audit-launch-readiness.mjs` gains a check: in files that import `createServiceClient`, every
  `.from("<tenant table>")` chain must contain `school_id`. It runs in `npm test` as a static test.

### 7.2 Crons

- `/api/cron/attendance-tick` and `/api/cron/payment-overdue` load all schools, then run the existing
  per-school logic in a loop with **per-school error isolation**: one school failing is logged, by school
  id only, and the loop continues. The JSON response reports per school.
- Each school's local time comes from `schools.time_zone`. The hard-coded `America/New_York` constants
  (`attendance-escalation`, `attendance`, `admin-digest`, `announcements`, `grades/sweep`,
  `student-schedule`) become a `timeZone` parameter, defaulting nowhere (a missing zone is a type error).
- The pg_cron tick runs every 10 minutes **all day** (`*/10 * * * *`) instead of 10:00–23:50 UTC,
  because schools may be in other zones. Each school's local-time constants (`QURAN_CHECK_TIME`, the
  6 PM special-day notice, the digest time) decide what actually runs, so off-hours ticks do nothing.
  Cost: 144 calls/day, each a few cheap queries per school.
- `?date=` and `?force=1` still work. A new `?school=<id>` limits a manual run to one school.
- **Scale note:** one tick loops every school sequentially within Vercel's 300 s limit. That's fine for
  tens of schools. At hundreds, fan out (one request per school, or Vercel Queues). Not built now.

### 7.3 SMS (`lib/sms/send-sms.ts`)

- `sendSms()` takes `schoolId` and loads the school's `sms_mode`, `twilio_phone_number`,
  `sms_test_number` and `sms_name`. The env `SMS_MODE` becomes a **global ceiling**: env `off` forces
  every school off, env `test` caps live schools at test. Twilio SID and token stay in env (one account, D3).
- A school with no number is always `off` (dry-run logged), whatever its `sms_mode`.
- `notifications.school_id` is set on every log row. Dedupe (`decideDedupe`) is unchanged but its query
  adds `school_id`.
- Every hard-coded "Salaam Institute:" prefix becomes `${school.sms_name}:`.

### 7.4 Inbound (`/api/sms/inbound`)

Signature check unchanged. Then `To` → `schools.twilio_phone_number` → `schoolId`. If no school matches:
log by `To` only, return empty TwiML, and send no reply. `handleInboundSms({ schoolId, … })` looks up the
guardian **within that school**. The `/messages` simulator passes the admin's school.

Under D3 alternative (a), a shared number: route by `From` over guardians in all schools; if the phone is
in several schools, forward to every matching school's admin and don't auto-file an absence. That's more
complex, which is why it isn't recommended.

---

## 8. Abuse & cost safeguards (open sign-up)

- New schools: `sms_mode = 'off'`, no number, so a school can't send real texts until the platform owner
  assigns a number (manual Twilio purchase + A2P registration per school brand, or under the owner's ISV
  registration).
- A minimal **`/platform`** page (platform admins only): list schools (name, created, member count,
  student count, texting state) and set a school's number / SMS mode. No access to school data.
- Rate limits: 3 schools per user. Announcement size and send caps already exist.
- Platform admins are added by the owner (one row in `platform_admins`; instructions in SETUP).

---

## 9. UI changes (small)

- Brand: `BrandMark`/layout title show the active school's name instead of "Salaam Institute"
  (ControlPad stays the product name on `/login`, `/signup` and `/onboarding`).
- Settings → new **School** card: name, SMS name, time zone; texting state shown read-only with "contact
  ControlPad to enable texting".
- User menu: school switcher (only with 2+ memberships).
- Dashboard: setup checklist (§6).

---

## 10. Rollout & phasing

Each phase keeps `main` deployable and Salaam working:

1. **Schema + backfill + RLS** (§3–5): with one school and `school_id` defaults, the app behaves exactly as
   before. The pgTAP and static tests land here.
2. **Auth & active school** (§4) + `.eq("id", 1)` → `school_id` reads.
3. **Service-role per school** (§7): crons loop schools, `sendSms(schoolId)`, inbound routing by `To`,
   time zone parameterised, the audit check.
4. **Sign-up, onboarding, setup checklist, `/platform`, school settings card** (§6, §8, §9).
5. **Docs**: `PROJECT_PLAN.md`, `DATA_MODEL.md`, `SETUP.md`, `CLAUDE.md` (new rules: every table has
   `school_id`; service-role code takes `schoolId`).
6. Later migration, after a release in production: drop `profiles.role/phone`, `settings.id`,
   `school_weekly_patterns.id`.

Owner steps (Claude doesn't do these): back up / branch the Supabase project and run `supabase db push`
there first; then production; set the Twilio number's inbound webhook (unchanged URL); add yourself to
`platform_admins`; configure custom SMTP before announcing sign-up; for each new school that wants
texting, buy a number and register it.

---

## 11. Risks

- **A missed `school_id` filter in service-role code** leaks or mis-sends across schools. Mitigation:
  `forSchool()` helper, composite FKs, static audit test, pgTAP tests.
- **Backfill on the live database**: the tables are small (one school), so locks are brief. Rehearse on a
  copy first.
- **Hard-coded Eastern assumptions** beyond the obvious constants (e.g. "after 6 PM Eastern" in absence
  parsing). Each one is grep-found and parameterised in phase 3, and tests run with a non-Eastern zone.
- **PR #7 (`juz_tests`)** ordering, see §3.2.
