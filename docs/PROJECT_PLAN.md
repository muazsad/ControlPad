# Salaam Institute — ControlPad

**Master project plan & source of truth**
Springfield, MA · Last updated: October 2026

> This document is the single source of truth for ControlPad. `CLAUDE.md`, `DATA_MODEL.md`, and any feature specs derive from it. When scope changes, change it here first.
>
> **Current state:** All 8 original build phases are done, plus several post-roadmap features (§9). The app is in maintenance + improvement mode. Known gaps and the next-up list are in §10 — read that before starting new work.

---

## 1. What ControlPad is

Salaam Institute students attend an external online school, **GCVS**, on-site under staff supervision. The problem: teachers and parents have **no visibility into GCVS**, so a student's grades can drop badly before anyone notices.

ControlPad is the school's own layer on top of GCVS. It does **not** integrate with GCVS (no API access). Staff enter the key data into ControlPad, and ControlPad provides:

- **Visibility** — staff and parents see grades, attendance, and Quran progress in one place.
- **Early warning** — automatic SMS alerts when something slips: low grades, absences, tardies, stalled Quran memorization, unpaid tuition.
- **A daily picture for the admin** — the day's problems waiting on the dashboard, plus a texted digest.

Guiding principle: **catch problems early and notify the right person automatically.** SMS is the primary channel because some parents are not tech-savvy.

---

## 2. Users & roles

| Role | Who | Can do |
|------|-----|--------|
| **Admin** | School director (arrives ~3pm) | Everything: all students, settings/thresholds, school calendar, tuition, staff accounts, guardian logins. Receives the daily digest and admin alerts. |
| **Moderator** | Teachers who supervise GCVS sessions / Quran teachers | Mark attendance, enter grades, manage a student's classes, log Quran progress; view student and guardian records. No access to Tuition, Staff, or Settings. |
| **Parent** | Guardians | View **only their own children's** grades, attendance, Quran progress, and payment status (current month). Primary channel is **SMS**; a web login is **optional**. |

- A guardian can have multiple children; a child can have multiple guardians (many-to-many via `student_guardians`).
- **Account creation:** the admin creates moderator accounts from **/staff**, and creates an optional parent login from a guardian's page (**/guardians/[id]**). New users finish their profile at **/setup-profile**.
- **Access control** is enforced in the database with Supabase Row Level Security (RLS), so a parent can never read another family's data even if the front end has a bug. Roles are also checked server-side in every action (`requireRole`).

---

## 3. Modules (all built)

### 3.1 Students & guardians
- Student profiles: name, date of birth, grade level, enrollment status (active / inactive / withdrawn), GCVS reference, linked guardians.
- Student profile page (`/students/[id]`) shows classes + grade updates, Quran and attendance snapshot, and the global performance score.
- Guardians list/detail/edit pages; link/unlink guardians to students; optional parent login creation.
- Students list shows the global performance score (replaced DOB as the list column).

### 3.2 Grades
- Courses are **per student** (mirroring their GCVS courses). Classes can be managed from `/grades` or directly from the student profile.
- Grades are **append-only snapshots** — history is kept so a downward *trend* can be detected, not just an absolute low.
- `/grades` is a student list; `/grades/[courseId]` shows a course's history.
- **Alert (event-based):** when a grade is saved below `settings.grade_floor` → SMS (via `checkLowGradeAlert` in `lib/alerts/grades.ts`).

### 3.3 Attendance & schedule groups
- **Schedule groups** (e.g. *Full time*, *Quran only*): each student belongs to one. A group sets, per weekday, whether it attends, its **start time**, **tardy grace** (minutes), and **absence check** time. Students without a group use the school-wide weekly pattern + `settings.school_start`. Breaks and no-school days apply to everyone; grouped students keep their own times on half days. Managed in Settings (admin).
- Daily status per student: Present / Tardy / Absent / Excused, plus **arrival time** (one row per student per day).
- Staff tap **Arrived now** (or enter a time); the app marks Present or Tardy from the student's group (after start + grace = tardy). The attendance page shows only students expected that day, with an expected / marked / unmarked count.
- **Alerts (every 10 min, `/api/cron/attendance-tick`):**
  1. At a group's absence-check time → **one SMS to admin** listing that group's students who are unmarked or absent.
  2. `settings.parent_alert_delay_minutes` later (default 60) → SMS to **parents** of students still unmarked or absent. Correcting attendance in between prevents the parent text.
  3. After the day's last parent-alert time → `tardies_per_week` tardies over the last 7 school days → SMS to **parent**.

### 3.4 Quran / Hifz progress
- Per student, log each lesson: date, surah, ayah range, lines memorized, running cumulative total.
- Bulk entry form is simplified: staff only enter **lines memorized**.
- Per-student progress chart at `/quran/[studentId]`.
- Calendar-aware: breaks and no-school days don't count as inactivity.
- **Alert (cron):** no new memorization in `quran_inactivity_days` school days → SMS to **parent + admin**.

### 3.5 Tuition
- Monthly fee per student; admin toggles each month paid / unpaid. Parents see the current month only.
- No payment processing yet (Stripe is a later phase).
- **Alert (daily cron, `/api/cron/payment-overdue`):** after `payment_due_day`, SMS to parent + admin; repeats at most weekly per student while unpaid.

### 3.6 Notifications / SMS engine
- Every SMS goes through `lib/sms/send-sms.ts` (Twilio) and is written to the `notifications` table (recipient, body, trigger, student, status, Twilio SID, error, delivery mode).
- **Modes** (`SMS_MODE` env): `off` (log only, status `dry_run` — the default until Twilio keys exist), `test` (every text goes to `SMS_TEST_NUMBER`, prefixed with the intended recipient), `live`.
- **Messages page (`/messages`, admin):** texting status, a "send me a test text" button, and the log of every message sent or that would have been sent.
- Before sending, alerts check `notifications` to avoid duplicates (same recipient + student + trigger in the window, or an explicit `dedupe_key` for batched admin texts).
- Trigger types: `low_grade`, `absence`, `absence_review`, `tardy_threshold`, `quran_slip`, `payment_overdue`, `admin_digest`, `manual_test`.
- **Not yet live:** a Twilio number needs to be bought and A2P 10DLC-registered (`docs/SETUP.md` §3).

### 3.7 Admin dashboard, daily digest & escalation
- **Dashboard (`/`)**: summary cards and today's problems — absences/tardies, low or dropping grades, Quran slippage, overdue payments — with severity ordering (`lib/alerts/admin-dashboard-severity.ts`).
- **Critical students escalation**: scores each student over a rolling 30-day window across grades, attendance, Quran, and payments → `ok` / `watch` / `critical`. Logic in `lib/people/escalation.ts` (all tunable constants at the top of that file).
- **Daily digest**: SMS summary to admin(s) at `settings.admin_digest_time` (Eastern), triggered by the 10-minute attendance tick; skipped on no-school days. `/api/cron/admin-digest` supports `?force=1` and `?date=YYYY-MM-DD` for manual runs.
- Parents see a simplified "My children" dashboard instead.

### 3.8 Settings & school calendar (admin only, `/settings`)
Thresholds — all read from the single-row `settings` table, never hardcoded:

| Setting | Default |
|---|---|
| Grade floor | 70% |
| Parent alert delay (after admin is alerted) | 60 minutes |
| Tardy window after start (ungrouped students only) | 2 hours |
| Tardies per week before alert | 3 |
| Quran inactivity before alert | 7 days |
| Payment due day of month | 5th |
| School start (ungrouped students only) | 8:00am |
| Admin digest time | 3:00pm |

Schedule groups: see §3.3. Seeded with **Full time** (from the school-wide pattern and start time); all existing students were assigned to it.

School calendar:
- **Weekly pattern**: default Mon, Tue, Wed, Thu, **Sat** on; **Fri and Sun off**. Applies to ungrouped students and to the Quran/digest checks.
- **Breaks**: named no-school date ranges.
- **Special days**: date-specific `no_school` or `half_day` (with times + note). Special weeks = bulk-applying special days across a range.
- The app degrades gracefully if the calendar tables are missing.

### 3.9 Performance metrics
- **Global performance** (Students list, Grades tab, student profile): equal-weight average of grade score and Quran score. **Attendance is intentionally excluded.** Computed by `globalPerformance()` in `lib/people/performance.ts`; data from `getAllStudentMetrics()` in `lib/people/student-metrics.ts` (one query, no N+1). Tone: success ≥ 75, warning ≥ 50, danger < 50, neutral when insufficient data.
- **Top Performers (`/top-performers`)**: separate leaderboard using `compositeScore()` — a weighted blend of grades, Quran, **and attendance**. Weights are adjustable on that page only (React state + `localStorage["leaderboard-weights"]`) and never affect the global metric.

---

## 4. Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend & hosting | **Next.js 16 (App Router) + React 19 + TypeScript on Vercel** | Auto-deploys from GitHub (`muazsad/ControlPad`). |
| UI | **Tailwind v4 + shadcn/ui**, lucide icons, sonner toasts, Recharts | No other component libraries. Design rules in `CLAUDE.md`. |
| Database, auth | **Supabase** (Postgres + Auth + RLS) via `@supabase/ssr` | Separate server and browser clients. |
| SMS | **Twilio** | Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `SMS_MODE`, `SMS_TEST_NUMBER`. |
| Scheduled jobs | **Vercel Cron** (daily) + **Supabase pg_cron** (every 10 min) → protected API routes | Require `Authorization: Bearer $CRON_SECRET`. Vercel is on the **Hobby** plan (once-a-day crons only). |
| Tests | Node built-in test runner + `tsx` | `npm test`. |
| Payments (future) | **Stripe** | Not built. |

### How alerts fire
- **Event-based** (grade saved below floor): checked when the data is written.
- **Time-based** (absence, tardies, Quran slip, digest): Vercel Cron hits `/api/cron/*`, which queries the DB and sends SMS.
- All SMS pass through the single send module and are logged.

### Scheduled jobs

| Route | Runs from | Schedule | Notes |
|---|---|---|---|
| `/api/cron/attendance-tick` | Supabase pg_cron | every 10 min, 10:00–23:50 UTC | Absence escalation + weekly tardy check (schedule groups), and the daily admin digest at `admin_digest_time` Eastern. Needs Vault secrets (SETUP §5). |
| `/api/cron/quran-slip` | Vercel | daily 15:00 UTC (11am EDT / 10am EST) | Skips non-school days. |
| `/api/cron/payment-overdue` | Vercel | daily 15:30 UTC | Only acts after `payment_due_day`. |
| `/api/cron/tardy-threshold`, `/api/cron/admin-digest` | manual only | — | Run by attendance-tick now; kept for manual runs (`?force=1` on the digest). |

All routes accept `?date=YYYY-MM-DD` for manual/backfill runs.

---

## 5. Data model

Full schema in `DATA_MODEL.md` and `supabase/migrations/`:

| Migration | What it does |
|---|---|
| `20260626000000_initial_schema.sql` | Enums, all core tables, RLS policies, `user_role()` helper, `updated_at` triggers |
| `20260627000000_fix_student_guardians_rls_recursion.sql` | `parent_has_student()` / `parent_can_read_guardian()` security-definer helpers to fix RLS recursion |
| `20260701000000_add_school_calendar.sql` | `school_weekly_patterns`, `school_breaks`, `school_special_days` (admin write, all roles read) |
| `20261010000000_schedule_groups.sql` | `schedule_groups`, `schedule_group_days`; `students.schedule_group_id`, `attendance.arrived_at`, `settings.parent_alert_delay_minutes`, `notifications.dedupe_key/delivery_mode`; new enum values; seeds **Full time** and assigns all students |
| `20261010000100_attendance_tick_scheduler.sql` | Enables `pg_cron` + `pg_net`; schedules the 10-minute attendance tick (reads URL + secret from Vault) |

Core tables: `profiles` (role), `students`, `guardians`, `student_guardians`, `courses`, `grades`, `attendance`, `quran_progress`, `payments`, `settings` (single row), `notifications`, the three calendar tables, and `schedule_groups` + `schedule_group_days`.

---

## 6. Codebase map

> Everything lives under `src/`. There are **no** `(admin)/(moderator)/(parent)` route groups — roles are checked per page/action with `requireRole()`. Project components are in `src/components/controlpad/`.

```
src/
  app/                    one folder per nav tab: students, guardians, grades, top-performers,
                          attendance, quran, tuition, messages, staff, settings; plus login, auth/callback,
                          setup-profile. Mutations live in each folder's actions.ts (server actions).
  app/page.tsx            Dashboard (admin/moderator) or "My children" (parent)
  app/api/cron/           Protected cron routes + _utils.ts (requireCronSecret, cronDateParam)
  components/ui/          shadcn primitives
  components/controlpad/  AppShell, StatusBadge, SummaryCard, DataTable, EmptyState, PageHeader, …
  lib/supabase/           server.ts, client.ts, middleware.ts
  lib/auth/               current-profile.ts (requireRole), admin-accounts.ts
  lib/sms/                send-sms.ts — the only Twilio path
  lib/alerts/             grades, attendance (tardy threshold), attendance-escalation (tick),
                          quran, payment, payment-overdue, admin-digest, admin-dashboard-severity
  lib/people/             performance, student-metrics, escalation, quran-progress, people
  lib/schedule/           calendar.ts + student-schedule.ts (pure logic), calendar-data.ts +
                          schedule-groups-data.ts (DB loading), schedule-group-validation.ts
  middleware.ts           Supabase session refresh / auth gate
supabase/migrations/      All schema changes
scripts/seed.mjs          Seed data (`npm run seed`)
scripts/audit-launch-readiness.mjs   Static checks on RLS/security before launch
tests/                    RLS policy recursion test
docs/                     PROJECT_PLAN (this), DATA_MODEL, SETUP, BUILD_PROMPTS,
                          superpowers/ (per-feature specs + implementation plans)
```

---

## 7. Privacy & safety

ControlPad holds **children's educational records and family phone numbers**:
- RLS on every table; families and staff see only what they should.
- Service-role key and Twilio/cron secrets live only in server env vars (`.env.local` locally, Vercel env in prod; `.env*` is gitignored).
- Don't log full PII to the console.
- The notification log proves what was sent and to whom.
- Schema changes go through migrations and should be tested against a non-production Supabase project before applying to the live one.

---

## 8. Workflow

- **Claude Code** is the builder. It reads `CLAUDE.md` + this plan before working.
- `CLAUDE.md` is the only agent instructions file (Codex/`AGENTS.md` retired Oct 2026).
- Per change: branch off `main` → small, specific request → review diff → `npm test && npm run build` → check the Vercel preview → merge.
- Larger features get a spec + implementation plan in `docs/superpowers/` first (see existing examples).
- If a change affects scope, update this document in the same branch.

---

## 9. Build history

| Phase | What | Status |
|-------|------|--------|
| 0. Scope & docs | Plan, schema, `CLAUDE.md`, build prompts | ✅ |
| 1. Foundation | Next.js skeleton, Supabase, auth, roles, base schema, Vercel deploy | ✅ |
| 2. People & access | Students, guardians, moderators, role-based login, RLS | ✅ |
| 3. Grades | Grade entry + history + low-grade SMS | ✅ |
| 4. Attendance | Marking + absence/tardy SMS + Cron | ✅ |
| 5. Quran | Memorization log + slip alerts | ✅ |
| 6. Tuition | Monthly tracking (admin toggle, parent view) + overdue SMS | ✅ |
| 7. Admin summary | Dashboard + digest | ✅ |
| 8. Polish | Settings page, design-system pass, hardening, launch audit | ✅ |

**Post-roadmap additions (June–July 2026):**
- Design-system pass (shadcn, navy/gold brand, status colors, shared components)
- Student profile: manage classes + grades inline; Quran bulk form simplified to lines only
- Global performance metric on Students list, Grades tab, student profile
- Top Performers leaderboard with adjustable weights
- Critical-students escalation on the dashboard
- Configurable school calendar (weekly pattern, breaks, special days), calendar-aware alerts
- Graceful handling when calendar tables are missing

**October 2026:**
- Schedule groups (per-group weekdays, start, tardy grace, absence check)
- Arrival-time attendance ("Arrived now"), tardy decided from the student's group
- Two-stage absence escalation (admin first, then parents) every 10 minutes via Supabase pg_cron
- SMS modes (off / test / live), Messages page, test text
- Overdue-tuition SMS scheduled; daily crons run every day (Saturday covered)

---

## 10. Known gaps & next up

**Before texting goes live (owner):**
1. Run `supabase db push`, create the two Vault secrets, and set `CRON_SECRET` in Vercel (`docs/SETUP.md` §5–6).
2. Create the real schedule groups (e.g. *Quran only*) and assign students.
3. Buy the Twilio number + A2P 10DLC registration; run in `SMS_MODE=test` for a few days, then `live`.

**Open questions / known limits:**
- Half days: grouped students keep their normal times. Confirm whether afternoon groups (e.g. Quran only) should be off on half days.
- The weekly tardy count uses the school-wide calendar's last 7 school days, so tardies on days only a group attends (e.g. a Quran-only Friday) aren't counted.
- The daily Quran check (Vercel) runs at a fixed UTC time, so it shifts an hour between summer and winter. The digest no longer has this problem (it's triggered by the 10-minute tick).
- The digest is skipped on no-school days.
- The dashboard doesn't yet show "unmarked" students; the Attendance page and admin text do.

**Later:**
- Stripe online tuition payments
- Richer parent portal

---

## 11. Account/setup tasks (owner only)

Claude never creates accounts or handles credentials. The owner:
1. **Supabase** — project URL, anon key, service-role key.
2. **Vercel** — GitHub repo connected for auto-deploys; env vars set; `CRON_SECRET` set.
3. **Twilio** — account, purchased phone number, Account SID + Auth Token.
4. Env vars are listed in `docs/SETUP.md`.

---

## 12. Confirmed decisions

1. **Roles** — admin, moderator, parent (view-only, own children). ✅
2. **SMS provider** — Twilio. ✅
3. **Thresholds** — §3.8 defaults, all editable in-app. ✅
4. **School week** — Mon–Thu + Sat; Fri and Sun off (editable). ✅
5. **Global performance excludes attendance**; attendance only counts on Top Performers. ✅
6. **Grades are append-only snapshots**; courses are per student. ✅
