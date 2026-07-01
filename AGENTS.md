# AGENTS.md

Standing instructions for Codex working in this repository. Read this and `docs/PROJECT_PLAN.md` before doing anything. The plan is the source of truth; if a request conflicts with it, flag the conflict.

## What this project is

ControlPad is an admin/visibility/alerts web app for Salaam Institute (an Islamic school in Springfield, MA). It sits on top of an external online school (GCVS) that staff transcribe data into. Core jobs: track grades, attendance, Quran memorization, and tuition, and automatically alert parents/admin (mostly by SMS) when something slips. Full detail in `docs/PROJECT_PLAN.md`; schema in `docs/DATA_MODEL.md`.

## Tech stack (do not swap without asking)

- **Next.js (App Router) + TypeScript**, hosted on **Vercel**
- **Supabase**: Postgres, Auth, Row Level Security
- **Twilio** for SMS
- **Vercel Cron** for time-based jobs (fallback: Supabase `pg_cron`)
- Styling: Tailwind CSS. Keep the UI simple and legible — admins/teachers use it daily, some parents are not tech-savvy.

## Repo conventions

- `app/` — routes (App Router). Group by role where it helps (`app/(admin)`, `app/(moderator)`, `app/(parent)`).
- `lib/supabase/` — separate **server** and **browser** clients. Never import the server/service-role client into a client component.
- `lib/sms/` — the single Twilio send module. All SMS go through here and get logged to `notifications`.
- `lib/alerts/` — the threshold-checking logic (grade, absence, tardy, quran, payment).
- `app/api/cron/` — protected cron endpoints.
- `supabase/migrations/` — all schema changes as migration files.
- `docs/` — the planning docs (this set).

## Security rules (non-negotiable)

- **RLS on every table.** Follow the access matrix in `docs/DATA_MODEL.md`. Never disable RLS to "make it work."
- The **service role key** is server-only (cron, SMS engine). Never expose it to the browser, never prefix it with `NEXT_PUBLIC_`.
- All secrets live in environment variables (see `docs/SETUP.md`). Never hardcode or commit them. Confirm `.env*` is gitignored.
- Always check the user's role **server-side**; never trust the client.
- Cron endpoints must require a secret (`CRON_SECRET`) so they can't be triggered by outsiders.

## Behavioral rules

- **Build one phase at a time** following `docs/BUILD_PROMPTS.md`. After each phase, leave the app in a working, deployable state.
- **Never hardcode thresholds.** Read them from the `settings` table (grade floor, tardy window, etc.).
- **Every alert** is checked against `settings`, sent via `lib/sms/`, and written to `notifications`. Before sending, check `notifications` to avoid duplicate alerts for the same student+trigger in the relevant window.
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


<claude-mem-context>
# Memory Context

# [ControlPad] recent context, 2026-07-01 7:06pm EDT

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (23,254t read) | 1,528,442t work | 98% savings

### Jun 26, 2026
S51 Build tuition tracking — design spec written, committed, and awaiting user review before implementation plan (Jun 26 at 9:24 PM)
S52 Build tuition tracking — implementation starting; tasks created and first task in progress (Jun 26 at 9:27 PM)
S53 ControlPad read-only recon: schema validation, routing audit, component inventory, and implementation plan for student profile + leaderboard features (Jun 26 at 9:29 PM)
### Jun 27, 2026
464 7:34p 🔵 ControlPad: Exact Schema for grades, quran_progress, attendance — All Required Fields Confirmed Present
465 " 🔵 ControlPad: Routing Structure, Data Fetching Pattern, and Existing Components
S55 Create pure TypeScript performance metric utility at src/lib/people/performance.ts — completed and committed (Jun 27 at 7:36 PM)
466 7:38p 🟣 Pure TypeScript Performance Metric Utility Module Added
467 7:39p 🔵 Existing src/lib/people/people.ts Module Structure Confirmed
468 " 🟣 performance.ts Written to src/lib/people/ — Full Implementation Details
469 " ✅ performance.ts Passed TypeScript Check and Committed to main
S54 Create src/lib/people/performance.ts — pure TypeScript performance metric utility for student grades, Quran progress, attendance, and composite scoring (Jun 27 at 7:39 PM)
S56 Wire performance.ts utility into student detail page — add quran/attendance data fetching, compute metrics server-side, and render a Performance snapshot card (Jun 27 at 7:40 PM)
470 7:41p 🔵 Student Detail Page Structure Examined Before Performance Integration
471 " ✅ performance.ts Imports Added to Student Detail Page
472 " ✅ Performance UI Scaffolding Added to Student Detail Page
473 " ✅ Quran and Attendance Queries Added to Student Detail Page with Performance Computation
474 7:42p 🟣 Performance Snapshot Card Rendered on Student Detail Page
475 " ✅ Student Profile Performance Integration Committed to main
S57 Add shared student-metrics helper and convert Grades tab from per-course form to per-student performance list (Jun 27 at 7:42 PM)
476 7:44p 🔵 quran_progress and attendance Tables Not Found in Initial Migration
477 " 🔵 quran_progress and attendance Tables Confirmed to Exist in Schema
478 7:45p 🟣 student-metrics.ts Created — Single-Query All-Student Metrics Aggregator
479 " 🔄 Grades Page Rewritten to Show Per-Student Performance Instead of Per-Course List
480 7:46p ✅ student-metrics.ts and Grades Page Passed Type Check and Lint
481 8:02p 🔵 Students List Page Current Structure Examined Before Performance Column Addition
S58 Replace DOB column with Performance metric on Students list page — completed and committed (Jun 27 at 8:02 PM)
482 8:13p 🔄 Students Page Data Layer Switched from Direct Query to getAllStudentMetrics()
483 " 🟣 Students List Page Performance Column Added, DOB Removed, tsc and ESLint Clean
S59 Add Top Performers leaderboard page with recharts bar chart and adjustable weighting — committed as sha 60b31b0 (Jun 27 at 8:14 PM)
484 8:15p 🔵 AppShell Navigation Structure and Role-Based Routing Confirmed
485 " 🔵 UI Component Inventory and Nav Active Logic Confirmed
486 " ✅ recharts Installed as New Dependency
S60 Top Performers page (Task 5) — complete implementation with recharts bar chart, adjustable factor weighting, localStorage persistence, production build verification, and CLAUDE.md documentation update (Jun 27 at 8:17 PM)
### Jul 1, 2026
487 5:08p 🔴 Global Performance Score Treats Missing Data as Zero for New Students
488 " 🔵 Root Cause Traced: quranScore() Never Returns Null, Causing False Danger Badge
489 " 🔵 Complete Consumer Map for globalScore/globalTone Across the Codebase
490 5:09p 🟣 TDD RED Phase Confirmed for globalPerformance Insufficient-Data Return Type
491 " 🔴 globalPerformance() Refactored to Return Status Object, Requiring Both Factors
492 " 🔄 student-metrics.ts Updated to Use New globalPerformance Object API with Count-Based Gating
493 " 🔴 All Global Badge Render Sites Updated to Show "Not enough data yet" for Insufficient-Data Students
494 5:10p 🔴 Top Performers Leaderboard Now Excludes Insufficient-Data Students; Quote Style Normalized
495 5:11p 🔴 All Tests Pass, Lint Clean, Build Succeeds — Insufficient-Data Fix Verified Complete
496 " 🔵 Grade Alert System Is Separate From Global Performance Metric — No Overlap
497 5:12p 🔵 Grade Issue Detection Refactored: summarizeGradeIssues Extracted, 5% Drop Threshold Added
499 " 🔵 Stale Cache Hit on admin-digest.ts — Read Returns Pre-Patch Content Despite Successful Apply
500 " 🔵 Triple-Apply Loop: Stale Cache Caused Same Patches Applied 3x and Cached Test Output Served as Fresh Results
498 5:14p 🔵 Full Verification Passed — Build Clean After All Changes, AGENTS.md Also Modified
503 5:16p 🟣 New spec received: Escalation utility + Critical Students dashboard section
504 5:17p 🔴 student-metrics.ts full shape — key anchor for escalation helper
505 " 🔴 Admin-digest.ts existing signal types — reusable for escalation
506 " 🔴 Admin dashboard page.tsx layout — insertion point for Critical Students section
507 " 🔴 escalation.ts + escalation.test.ts: GREEN — 34/34 tests pass after 2 fix iterations
508 " 🔴 grades table has NO `date` column — only `recorded_at` (timestamptz)
509 " 🔴 page.tsx data-fetch pattern: AdminDashboard fetched in HomePage, escalation needs parallel fetch
510 5:29p 🟣 Grade Card Tone Severity Fix — Danger vs Warning Signal Separation
515 5:30p ✅ Escalation Test File Re-Created — New TDD Cycle Starting
511 6:24p 🟣 Grade Card Severity Module — Danger vs Warning Separation
512 " 🔵 Live Data Confirms Grade Card Tone Fix — Amber Not Red
513 " 🔴 Tardy Card Tone Fixed — Warning Not Danger
514 " 🟣 Escalation System — Full 4-Step Implementation (Prior Session Work Confirmed)

Access 1528k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>