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
