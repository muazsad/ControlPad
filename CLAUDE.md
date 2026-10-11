# CLAUDE.md

Standing instructions for Claude Code working in this repository. Read this and `docs/PROJECT_PLAN.md` before doing anything. The plan is the source of truth; if a request conflicts with it, flag the conflict.

## What this project is

ControlPad is an admin/visibility/alerts web app for Salaam Institute (an Islamic school in Springfield, MA). It sits on top of an external online school (GCVS) that staff transcribe data into. Core jobs: track grades, attendance, Quran memorization, and tuition, and automatically alert parents/admin (mostly by SMS) when something slips. Full detail in `docs/PROJECT_PLAN.md`; schema in `docs/DATA_MODEL.md`.

## Tech stack (do not swap without asking)

- **Next.js (App Router) + TypeScript**, hosted on **Vercel**
- **Supabase**: Postgres, Auth, Row Level Security
- **Twilio** for SMS
- **Vercel Cron** for time-based jobs (fallback: Supabase `pg_cron`)
- Styling: Tailwind CSS. Keep the UI simple and legible — admins/teachers use it daily, some parents are not tech-savvy.

## Repo conventions

All app code lives under `src/` (import alias `@/` → `src/`). Full map in `docs/PROJECT_PLAN.md` §6.

- `src/app/` — routes (App Router), **one folder per nav tab** (`students`, `guardians`, `grades`, `top-performers`, `attendance`, `quran`, `tuition`, `messages`, `staff`, `settings`), plus `login`, `auth/callback`, `setup-profile`. There are **no role route groups** — each page/action checks the role server-side with `requireRole()` from `src/lib/auth/current-profile.ts`.
- Mutations are **server actions** in each route folder's `actions.ts`.
- `src/app/page.tsx` — admin/moderator dashboard, or the parent "My children" view.
- `src/lib/supabase/` — separate `server.ts` and `client.ts` (browser) clients, plus `middleware.ts`. Never import the server/service-role client into a client component.
- `src/lib/sms/send-sms.ts` — the single Twilio send module. All SMS go through here and get logged to `notifications`. Honors `SMS_MODE` (off / test / live); never bypass it.
- `src/lib/alerts/` — threshold-checking logic (grades, attendance, quran, payment, payment-overdue, admin-digest, admin-dashboard-severity).
- `src/lib/people/` — performance metrics, student metrics, escalation, Quran progress.
- `src/lib/schedule/` — school calendar + schedule groups. Pure logic in `calendar.ts` and `student-schedule.ts` (`scheduleForDate()` decides when a student is expected; always use it rather than reading `settings.school_start` directly); DB loading in `calendar-data.ts` and `schedule-groups-data.ts`. Time-based alerts must respect the calendar and each student's group. Special days can apply to the whole school or chosen groups (`applies_to`), close school, move start times, or pause parent attendance texts (`DaySchedule.parentAlerts`) — all handled inside `scheduleForDate()`; never re-implement special-day checks elsewhere.
- `src/app/api/cron/` — protected cron endpoints; use `requireCronSecret()` from `_utils.ts`. Daily schedules are in `vercel.json` (UTC; Vercel Hobby = once a day max). Anything more frequent runs from Supabase `pg_cron` (see the `attendance_tick_scheduler` migration).
- `supabase/migrations/` — all schema changes as migration files.
- Tests sit next to the code as `*.test.ts` (Node test runner + `tsx`); run with `npm test`.
- `docs/` — planning docs; `docs/superpowers/` holds per-feature specs and implementation plans.

## Security rules (non-negotiable)

- **RLS on every table.** Follow the access matrix in `docs/DATA_MODEL.md`. Never disable RLS to "make it work."
- The **service role key** is server-only (cron, SMS engine). Never expose it to the browser, never prefix it with `NEXT_PUBLIC_`.
- All secrets live in environment variables (see `docs/SETUP.md`). Never hardcode or commit them. Confirm `.env*` is gitignored.
- Always check the user's role **server-side**; never trust the client.
- Cron endpoints must require a secret (`CRON_SECRET`) so they can't be triggered by outsiders.

## Behavioral rules

- The original 8 build phases are complete; `docs/BUILD_PROMPTS.md` is historical. Check **§10 "Known gaps & next up"** in `docs/PROJECT_PLAN.md` before starting new work.
- Work in small, focused changes on a branch off `main`. After each change, `npm test` and `npm run build` must pass and the app must stay deployable.
- **Never hardcode thresholds.** Read them from the `settings` table (grade floor, tardy window, etc.).
- **Every alert** is checked against `settings`, sent via `lib/sms/`, and written to `notifications`. `sendSms()` dedupes for you via `decideDedupe()` (same recipient + student + trigger, or a `dedupeKey`, within `dedupeWindowHours`): only sent/queued texts in the current SMS mode block a repeat, dry runs only block other dry runs, failed sends retry up to `MAX_FAILED_SEND_ATTEMPTS`. Pick a sensible window/key; don't add your own dedupe queries.
- Anything that should run at a local time of day goes on the 10-minute tick (`runAttendanceTick` in `lib/alerts/attendance-escalation.ts`) with a named time constant — not a fixed-UTC Vercel cron, which shifts with daylight saving.
- Use Supabase **migrations** for schema changes — never tell the user to paste SQL into the dashboard for permanent changes.
- Write clear, typed code. Validate input. Handle the "no data yet" and "SMS failed" cases.
- This app holds children's records and family phone numbers. Treat data carefully; don't log full PII to the console.

## Things you must NOT do — ask the user instead

You cannot create accounts or handle the user's credentials. When a step needs one of these, stop and give the user clear instructions to do it themselves:

- Creating Supabase / Vercel / Twilio / GitHub accounts
- Entering passwords, API keys, card numbers, or any secret
- Buying the Twilio phone number or anything with a cost
- Anything that spends money or changes billing

You *can* tell them exactly which keys to copy and where to paste them (`docs/SETUP.md` lists every variable).

## When unsure

Ask a focused question rather than guessing on schema, role permissions, or money/account actions. If a change affects scope, note that `docs/PROJECT_PLAN.md` should be updated to match.

## Design System (established in Phase 1 — follow this in every phase)

The UI uses **shadcn/ui + Tailwind**. Do not introduce any other component library.
All reusable components live in `src/components/ui/` (shadcn primitives) and
`src/components/controlpad/` (project-specific: AppShell, StatusBadge, SummaryCard, DataTable, EmptyState, PageHeader, etc.).

### Brand colors (CSS variables in globals.css)
- Primary navy:   `--color-primary`   (~#1E2A5E)  — sidebar, nav, primary buttons, headings
- Accent gold:    `--color-accent`    (~#C8922E)  — active nav item highlight, secondary CTA only
- Background:     warm off-white (`--color-background`) — NOT pure white
- Foreground:     near-navy charcoal (`--color-foreground`)

### Status color scale (functional — keep clearly distinct from brand gold)
Always use these for data status, never improvise new colors:
- **Success / green**  (`--color-success`,  ~#16A34A) — Present, Paid, grade above floor, on-track
- **Warning / orange** (`--color-warning`,  ~#EA8A00) — Tardy, approaching threshold, due soon
- **Danger / red**     (`--color-danger`,   ~#DC2626) — Absent, Overdue, below grade floor, slipping
- **Neutral / slate**  (`--color-neutral`)            — Excused, no-data, secondary states

### Reusable components (always use these, never re-implement inline)
- `<StatusBadge status="present|tardy|absent|excused|paid|overdue|on-track|slipping|..." />`
- `<SummaryCard title count icon href />` — the dashboard summary cards
- `<DataTable />` — all tabular data (grades, attendance, payments) goes through this
- Skeleton loaders for every data-fetching page/component
- Empty states: friendly message + icon, never a blank space

### App shell
- Admin/Moderator: left sidebar (collapsible on mobile) — Dashboard, Students, Guardians, Grades,
  Top Performers, Attendance, Quran, then Tuition, Messages, Staff, Settings (these four Admin only).
  Nav is defined in `src/components/controlpad/app-shell.tsx`.
- Parent: simplified top-bar layout, larger text, minimal options. No sidebar.
- Top bar: wordmark left, user name + role + avatar dropdown (sign out) right.

## Performance metric architecture

### Global performance (shown on Students list, Grades tab, student profile)
- **Definition:** equal-weight average of `gradeScore` (0–100) and `quranScore` (0–100). Attendance is intentionally excluded.
- **Computed by:** `globalPerformance(gradeScore, quranScore)` in `src/lib/people/performance.ts`. All tunable constants (window sizes, tone thresholds) live at the top of that file — never hardcode them elsewhere.
- **Displayed as:** `<StatusBadge>` coloured by `performanceTone(score)` → success ≥ 75, warning ≥ 50, danger < 50, neutral for null.
- **Data source:** `getAllStudentMetrics()` in `src/lib/people/student-metrics.ts` — single Supabase query via nested `.select()` relations (no N+1). Always reuse this helper; do not write ad-hoc per-student loops.

### Top Performers leaderboard (`/top-performers`)
- **Separate metric.** Uses `compositeScore(weights, g, q, a)` from `performance.ts` — a weight-normalised blend of all three factors including attendance.
- **Attendance is used ONLY here.** It never enters the global metric on other tabs.
- **Weights are tab-local:** stored in React state + `localStorage["leaderboard-weights"]`. They have zero effect on the global metric shown anywhere else.
- Do not copy this weighting logic to other pages. If a new page needs a combined score, use `globalPerformance()` unless the spec explicitly says otherwise.

### Patterns
- Cards: `rounded-lg`, subtle border, soft shadow, consistent padding
- New pages: always use the established app shell layout, never a blank page
- Data tables: use `<DataTable>` wrapper, status columns always use `<StatusBadge>`
- Errors: inline field errors + sonner toast for action failures
- Loading: skeleton, never a spinner on a full page
- Do not polish empty states heavily — they will be replaced by real data soon
