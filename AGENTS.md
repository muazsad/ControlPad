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

# [ControlPad] recent context, 2026-06-26 10:39pm EDT

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (19,151t read) | 822,849t work | 98% savings

### Jun 26, 2026
407 12:42p 🟣 Student Server Actions Implemented with Role Guards and RLS
408 " 🟣 StudentForm Client Component Built with useActionState
409 " 🟣 Students List Page Implemented — Coming Soon Stub Replaced
410 12:43p 🟣 New Student Page Created at /students/new
411 " 🟣 StudentGuardianLinks Component Built for Detail Page
412 " 🟣 Student Detail Page Created at /students/[id]
413 12:44p 🟣 Task 2 Complete: Full Student CRUD and Guardian Linking
414 " 🟣 Task 3 In Progress: Guardian management files being created
415 12:46p 🟣 Task 3 Complete: Guardian detail page written — all guardian routes now exist
416 12:47p 🟣 Task 4 Started: Staff/moderator account creation — actions.ts written
417 " 🟣 Task 4: CreateModeratorForm component written with form-reset-on-success pattern
418 " 🟣 Task 4 Complete: /staff page written — full staff management route done
420 12:48p 🟣 Task 5: Home page being updated — imports added for real parent children data
421 " 🟣 Task 5: ParentDashboard upgraded from stub to live data — accepts children: Student[] prop
423 " 🟣 Task 5: seed.mjs created — idempotent seed with 4 test accounts and 2 isolated families
422 " 🟣 Task 5: HomePage now fetches RLS-filtered children for parent role — isolation mechanism complete
424 12:49p 🟣 Task 5 Complete, Task 6 Starting: npm run seed added to package.json; typecheck/build next
425 12:58p 🟣 Phase 2 People & Access: All 6 tasks completed — full implementation summary
427 " 🟣 Phase 2 production build passes — all 19 routes compile clean
428 " 🔴 ESLint found 2 errors and 1 warning requiring fixes
426 12:59p 🔵 TypeScript type-check passes with zero errors
429 1:00p 🔴 ESLint errors fixed: "children" prop renamed to "students" in ParentDashboard
430 9:06p 🔴 ESLint errors fully fixed: children prop renamed, bare anchor replaced with Link
431 " 🟣 Phase 3 Quran/Hifz module requested with bulk entry and inactivity cron
432 " 🔴 Phase 2 ESLint errors fully resolved — lint and build both pass clean
433 9:07p 🔵 Existing infrastructure available for Phase 3: SMS lib, cron utils, and two cron routes already built
434 " 🔵 Full cron pattern documented: _utils.ts, alert lib, route handler, vercel.json entry
435 " 🔵 Alert library architecture fully documented — dependency injection pattern for testability
436 " 🔵 Attendance bulk entry UI pattern fully documented — inline per-row forms in DataTable
438 9:08p 🟣 Phase 5 Quran module task plan created — 5 tasks (7-11) covering full feature scope
439 " 🟣 Task 7: logQuranLessons bulk server action created
440 9:09p 🟣 Task 8: QuranBulkForm client component created with stale-entry highlighting
441 9:16p 🔵 ControlPad Project Architecture and Scope Discovered
442 9:17p 🔵 Existing Codebase State Before Tuition Feature Build
S43 Build tuition tracking — second clarifying question: does monthly fee vary per student or is it a flat rate? (Jun 26 at 9:20 PM)
S45 Build tuition tracking — still on third clarifying question about inline amount entry vs. separate amount management (Jun 26 at 9:21 PM)
S46 Build tuition tracking — fourth clarifying question: SMS reminder frequency (one per month vs. weekly until paid) (Jun 26 at 9:21 PM)
S44 Build tuition tracking — third clarifying question: should amount entry be inline when marking paid, or set separately? (Jun 26 at 9:21 PM)
S47 Build tuition tracking — all design questions answered, now proposing admin UI implementation approach for approval (Jun 26 at 9:22 PM)
S48 Build tuition tracking — detailed architecture proposed across 4 layers, awaiting approval before UI details (Jun 26 at 9:23 PM)
S49 Build tuition tracking — admin UI layout and parent view fully specified, awaiting approval before coding (Jun 26 at 9:23 PM)
S50 Build tuition tracking — cron and alert layer fully specified, awaiting final approval before coding starts (Jun 26 at 9:24 PM)
S51 Build tuition tracking — design spec written, committed, and awaiting user review before implementation plan (Jun 26 at 9:24 PM)
443 9:26p ⚖️ Tuition Design Spec to Be Written Before Coding
444 " ✅ Created docs/superpowers/specs/ Directory
445 " ✅ Tuition Design Spec Written and Committed to Docs
446 9:27p ✅ Tuition Design Spec Committed to Branch codex/design-system-pass
447 " 🔵 SMS and Auth Infrastructure Details Confirmed Before Implementation
S52 Build tuition tracking — implementation starting; tasks created and first task in progress (Jun 26 at 9:29 PM)
448 9:30p 🔵 DataTable and Student Type APIs Confirmed for Tuition Page Implementation
449 9:31p 🟣 setPaymentStatus Server Action Implemented
450 " 🟣 Tuition Page Implemented — Admin Grid with Month Navigation and Parent Read-Only View
451 " 🟣 Task 2 Complete — Tuition UI Passes Lint with No Errors
452 " 🔴 TypeScript Cast Fix for Bound Server Action on Form Element
453 9:32p 🟣 Tuition UI Committed — Admin Toggle and Parent View Shipped
454 " 🟣 Payment Alert Library Implemented — src/lib/alerts/payment.ts
455 " 🔴 Bug Found: Parent View Uses URL Month Param Instead of Current Month
456 9:33p 🔴 Parent Month Lock Bug Fixed and Committed — sha 5516e6e
457 " 🔴 Code Quality Review: Tuition Actions + Page — "Needs Work" Verdict with 2 Important Issues
459 9:39p 🔴 actions.ts: _prevState param added for useActionState compatibility

Access 823k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>