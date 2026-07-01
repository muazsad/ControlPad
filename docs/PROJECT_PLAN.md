# Salaam Institute — ControlPad

**Master project plan & source of truth**
Springfield, MA · Last updated: June 2026

> This document is the single source of truth for the ControlPad build. Every other doc (the database schema, `CLAUDE.md`, the build prompts) derives from this. When scope changes, change it here first.

---

## 1. What ControlPad is

Salaam Institute students attend an external online school, **GCVS**, on-site under staff supervision. The problem today: teachers and parents have **no visibility into GCVS**, so a student's grades can drop badly before anyone notices.

ControlPad is the school's own layer on top of GCVS. It does **not** integrate with GCVS (no API access). Instead, moderators enter the key data into ControlPad, and ControlPad provides:

- **Visibility** — moderators and parents can see grades, attendance, and Quran progress in one place.
- **Early warning** — automatic alerts (mostly SMS) when something slips: low grades, absences, tardies, stalled Quran memorization, unpaid tuition.
- **A daily picture for the admin** — a summary of the day's problems waiting when the admin arrives.

The guiding principle: **catch problems early and notify the right person automatically.** SMS is the primary channel because some parents are not tech-savvy.

---

## 2. Users & roles

| Role | Who | Can do |
|------|-----|--------|
| **Admin** | School director (arrives ~3pm) | Everything: all students, settings/thresholds, billing, receives the daily summary and all alerts. |
| **Moderator** | Teachers who supervise GCVS sessions / Quran teachers | Mark attendance, enter & update grades, log Quran progress; view student records. |
| **Parent** | Guardians | View **only their own children's** grades, attendance, Quran progress, and payment status. Primary channel is **SMS**; a web login is **optional** for those who want it. |

A guardian can have multiple children; a child can have multiple guardians (many-to-many).

**Access control** is enforced in the database with Supabase Row Level Security (RLS), so a parent can never query another family's data even if the front end has a bug.

---

## 3. Modules

### 3.1 Students & enrollment
- Student profiles: name, date of birth, grade level, enrollment status, GCVS reference info, linked guardians.
- Most students are already enrolled, so this is mostly add/edit plus a simple new-student registration form. **Lower priority** — built after the alerting modules.

### 3.2 Grades
- Courses/subjects per student (mirroring their GCVS courses).
- Moderators update the current grade per course; **grade history is kept** so we can detect a downward *trend*, not just an absolute low.
- All moderators can view; parents see their own child's.
- **Alert:** when a grade drops below the grade floor -> SMS to admin (and optionally the parent).

### 3.3 Attendance
- Daily status per student: Present / Tardy / Absent / Excused, marked by moderators.
- Attendance operates against the configured school calendar: regular school days are editable,
  breaks are no-school ranges, and special days can mark one-off closures or half days.
- **Alerts:**
  - Student is absent and has not been marked present/tardy/excused within X hours of the 8am start -> SMS to **parent + admin**.
  - X tardies within a rolling 7-day window -> SMS to **parent**.

### 3.4 Quran / Hifz progress
- Per student, log each new lesson: date, surah/juz, lines (or ayahs) memorized, running cumulative total.
- Moderators input lessons; moderators and parents track progress.
- Quran pacing should use the configured school calendar once alert logic is calendar-aware, so
  breaks and no-school days do not make students look inactive.
- **Alert:** a student "slipping" — e.g. no new memorization logged in X days, or rate falling below target -> notify parent (and admin).

### 3.5 Tuition & billing
- Monthly fee per student. Admin marks each month paid / unpaid. (No payment processing yet.)
- **Alert:** if payment isn't recorded by day X of the month -> SMS to parent.
- **Later phase:** Stripe for actual online payment.

### 3.6 Notifications / SMS engine (cross-cutting)
- All automated alerts route through one place, sent via **Twilio**.
- Every message is written to a **notification log** (recipient, content, trigger, timestamp, delivery status) for audit and to avoid duplicate sends.

### 3.7 Admin daily summary
- The day's problems, ready when the admin signs in (and optionally pushed as a digest at ~3pm): today's absences and tardies, low/dropping grades, Quran slippage, overdue payments.
- Implemented as a **dashboard on the admin home page** + a scheduled digest.

### 3.8 Settings
- Every threshold is configurable here so you tune behavior **without code**:
  - Grade floor (default **70%**)
  - Tardy window after start (default **2 hours** -> checked at ~10am)
  - Tardies per week before alert (default **3**)
  - Quran inactivity before alert (default **7 days**)
  - Payment due day of month (default **5th**)
  - School start (8am) and admin digest time (3pm)
- School calendar configuration also lives here:
  - Weekly pattern of school days. Default: **Monday, Tuesday, Wednesday, Thursday, Saturday on; Friday and Sunday off**.
  - Breaks as named no-school date ranges.
  - Special days as date-specific overrides: **no school** or **half day** with optional times and notes.
  - Special weeks are modeled by bulk-applying special days across a date range, not by a separate table.

> Defaults above are placeholders — change any of them in the app once it's live.

---

## 4. Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend & hosting | **Next.js (App Router) on Vercel** | One repo, deploys automatically. |
| Database, auth, storage | **Supabase** (Postgres + Auth + RLS) | RLS enforces per-role / per-family access. |
| SMS | **Twilio** | ~1-2 USD/mo for a phone number + well under 1 cent per text. |
| Scheduled jobs | **Vercel Cron -> protected API routes** | Runs the time-based checks (absence window, weekly tardy tally, payment due, 3pm digest). If we need higher frequency than the Vercel plan allows, fall back to **Supabase pg_cron**. |
| Payments (future) | **Stripe** | Not in initial build. |

### How the alerts actually fire
- **Event-based** (e.g. a grade saved below the floor): checked the moment data is written, then queued to SMS.
- **Time-based** (absence window, weekly tardies, payment due, daily digest): a scheduled job queries the database on a timer and queues any needed SMS.
- All SMS pass through the single send function and get logged.

---

## 5. Data model (high level)

Detailed schema/SQL comes in `DATA_MODEL.md`. The core tables:

- **profiles** — one per auth user; holds role (admin / moderator / parent).
- **students** — student records.
- **guardians** <-> **students** — many-to-many link (a join table).
- **courses** — a student's GCVS courses.
- **grades** — grade entries per course over time (history kept).
- **attendance** — one row per student per day.
- **quran_progress** — memorization log entries.
- **payments** — monthly fee status per student.
- **settings** — the configurable thresholds (single row, admin-editable).
- **notifications** — log of every SMS/alert sent.

---

## 6. Privacy & safety note

ControlPad holds **children's educational records and family phone numbers**. Treat it accordingly:
- RLS on every table so families and moderators see only what they should.
- Service-role/secret keys live only in server environment variables, never in the browser.
- The notification log helps prove what was sent and to whom.

This is sensitive data; we build it locked-down from the start rather than bolting security on later.

---

## 7. Build roadmap

| Phase | What gets built | Your setup actions |
|-------|-----------------|--------------------|
| **0. Scope & docs** | This plan + schema + `CLAUDE.md` + build prompts | — |
| **1. Foundation** | Repo, Next.js skeleton, Supabase project, auth, roles, base schema, first Vercel deploy | Create Supabase + Vercel accounts; supply keys |
| **2. People & access** | Students, guardians, moderators; role-based login; RLS | — |
| **3. Grades** | Grade entry + history + low-grade SMS | Twilio account + keys |
| **4. Attendance** | Attendance marking + absence/tardy SMS (introduces Cron) | — |
| **5. Quran progress** | Memorization log + slippage alerts | — |
| **6. Tuition** | Monthly payment tracking + overdue SMS | — |
| **7. Admin summary** | Dashboard + 3pm digest | — |
| **8. Polish** | Settings page, hardening, full production deploy | — |
| **Later** | Stripe payments, richer parent portal | — |

Each phase is built and verified before moving on, so you always have a working app.

---

## 8. Your account/setup tasks (only you can do these)

For security, Claude Code will never create accounts or handle your credentials — it will tell you exactly what to do, and you do it:

1. **Supabase** — create an account and a project; copy the project URL, anon key, and service-role key.
2. **Vercel** — create an account; connect your GitHub repo for auto-deploys.
3. **Twilio** — create an account; buy a phone number; copy the Account SID and Auth Token.
4. Paste these as **environment variables** where Claude Code instructs (a `SETUP.md` will list every variable).

---

## 9. The workflow

- **Claude.ai (this project)** = planning brain. We refine this plan, the schema, and the build prompts here.
- **Claude Code** = the builder in your repo. It reads `CLAUDE.md` (its standing instructions) plus these docs, then writes the code, runs Supabase migrations, and wires up deploys. Setup reference: https://docs.claude.com/en/docs/claude-code/overview
- **Handoff** = the markdown files in `/docs` + `CLAUDE.md`. For each phase, you paste that phase's prompt into Claude Code and it builds. To change direction, update the doc here, then tell Claude Code.

---

## 10. Confirmed decisions

1. **Roles** — three roles: **admin** (overall), **moderator** (teachers who edit attendance/grades/Quran), **parent** (view-only, own children). ✅
2. **SMS provider** — **Twilio**. ✅
3. **Thresholds** — start with the §3.8 defaults; all editable later in-app. ✅

---

*Next deliverables: `DATA_MODEL.md` (full schema), `CLAUDE.md` (repo rules for Claude Code), `SETUP.md` (accounts & env vars), and `BUILD_PROMPTS.md` (phase-by-phase prompts to paste into Claude Code).*
