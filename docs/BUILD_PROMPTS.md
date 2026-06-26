# ControlPad — Build Prompts

Copy-and-paste prompts for **Claude Code**, one phase at a time. Don't skip ahead — each phase assumes the previous one is built, working, and committed.

**How to use:**
1. Put `PROJECT_PLAN.md`, `DATA_MODEL.md`, `CLAUDE.md`, and this file in the repo (`CLAUDE.md` at the root, the rest in `docs/`).
2. Open Claude Code in the repo.
3. Paste the next phase's prompt.
4. When it pauses for an account/secret step, do that part yourself (see `SETUP.md`), then tell it to continue.
5. Verify it works, then move to the next phase.

> Every prompt below already assumes the rules in `CLAUDE.md` (RLS on, secrets server-side, read thresholds from `settings`, all SMS logged). You don't need to repeat them.

---

## Phase 1 — Foundation

```
Read CLAUDE.md and docs/PROJECT_PLAN.md and docs/DATA_MODEL.md first.

Set up the foundation for ControlPad:
- Initialize a Next.js (App Router) + TypeScript + Tailwind project.
- Add server and browser Supabase clients in lib/supabase/.
- Set up Supabase Auth (email/password) with a login page and protected routes.
- Create the initial database migration in supabase/migrations/ implementing the
  enums and tables from docs/DATA_MODEL.md, with RLS enabled on every table and
  the user_role() helper and the policies described there.
- Add a profiles row creation flow so a signed-in user has a role.
- Create a placeholder home page that greets the user by role.

Before any step that needs my Supabase keys or account, stop and tell me exactly
what to do. List the env vars you need (match docs/SETUP.md). When done, tell me
how to run it locally and how to deploy to Vercel.
```

## Phase 2 — People & access

```
Read CLAUDE.md and the docs first.

Build people management and role-based access:
- Admin screens to create/edit students, guardians, and the student<->guardian
  links (a guardian can have many children and vice versa).
- Admin ability to invite/create moderator accounts.
- For parents: support linking a guardian record to an auth user (optional login).
- Enforce the access matrix from docs/DATA_MODEL.md: admin = all, moderator =
  read/write student data + read guardians, parent = read own children only.
- Role-aware navigation so each role only sees what it should.

Add a couple of seed/test records so I can log in as each role and confirm a
parent cannot see another family's data.
```

## Phase 3 — Grades + low-grade SMS

```
Read CLAUDE.md and the docs first. This phase introduces SMS, so I will set up
Twilio when you tell me to (docs/SETUP.md).

Build the grades module:
- Moderator UI to add courses per student and record a grade per course; keep
  full grade history (new row each time), show the latest as the current grade.
- Parent and moderator views of grades; parents see only their children.
- Build lib/sms/ as the single Twilio send function that logs every message to
  the notifications table and checks for duplicates first.
- Alert: when a saved grade is below settings.grade_floor, queue an SMS to the
  admin (and optionally the student's parents). Read the threshold from settings.

Stop and give me the Twilio env vars when you need them. Show me how to test an
alert without spamming real numbers.
```

## Phase 4 — Attendance + alerts + Cron

```
Read CLAUDE.md and the docs first. This phase introduces scheduled jobs.

Build attendance:
- Moderator UI to mark daily attendance (present/tardy/absent/excused), one row
  per student per day.
- Parent/moderator views.
- Set up Vercel Cron hitting protected API routes (require CRON_SECRET):
  - A job that runs settings.tardy_window_hours after settings.school_start: any
    student still 'absent' (not present/tardy/excused) -> SMS parent + admin.
  - A job that checks rolling 7-day tardy counts -> SMS parent when it reaches
    settings.tardies_per_week.
- All sends go through lib/sms/ and are logged + deduped.

Tell me what to add to vercel.json / Vercel settings for the cron schedule, and
how to trigger the jobs manually for testing. If the schedule frequency exceeds
my Vercel plan's limits, propose the Supabase pg_cron fallback.
```

## Phase 5 — Quran progress + slip alerts

```
Read CLAUDE.md and the docs first.

Build the Quran/Hifz module:
- Moderator UI to log a lesson per student (date, surah, ayah range, lines
  memorized, optional running cumulative total).
- Progress views for moderators and parents (own children only).
- A cron-based check: if days since a student's latest quran_progress entry
  exceeds settings.quran_inactivity_days, SMS the parent (and admin). Logged +
  deduped like the others.
```

## Phase 6 — Tuition tracking + overdue SMS

```
Read CLAUDE.md and the docs first.

Build tuition tracking (no online payments yet):
- Admin UI to mark each student's monthly fee paid/unpaid per period_month.
- Parent view of their children's payment status.
- A cron-based check: once the day of month passes settings.payment_due_day and
  the current month is still unpaid, SMS the parent. Logged + deduped.

Leave clean seams for adding Stripe later, but do not build payment processing now.
```

## Phase 7 — Admin daily summary

```
Read CLAUDE.md and the docs first.

Build the admin daily summary:
- An admin dashboard that shows, for today: absences, tardies, low/dropping
  grades, Quran slippage, and overdue payments — so it's all waiting when the
  admin signs in (~3pm).
- A scheduled digest at settings.admin_digest_time that can also send the admin a
  summary (SMS and/or email), logged like other notifications.
```

## Phase 8 — Settings, hardening, launch

```
Read CLAUDE.md and the docs first.

Final polish:
- Admin Settings page to edit every threshold in the settings table
  (grade floor, tardy window, tardies/week, quran inactivity, payment due day,
  school start, digest time). Confirm nothing in the app hardcodes these.
- Review RLS on every table against docs/DATA_MODEL.md; verify a parent cannot
  reach another family's data and a moderator cannot edit billing or settings.
- Confirm no secret is exposed to the browser and .env files are gitignored.
- Tidy the UI for daily use and do a full production deploy to Vercel.

Give me a short go-live checklist and how to add the first real admin account.
```

---

## Later (not yet)

- **Stripe** online tuition payments.
- A richer parent self-service portal.
- GCVS integration, *if* an API ever becomes available.

When you start any of these, update `docs/PROJECT_PLAN.md` first, then write a new phase prompt here.
