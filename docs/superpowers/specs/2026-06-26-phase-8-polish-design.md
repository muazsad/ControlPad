# Phase 8 Polish Design

## Goal

Finish the launch polish for ControlPad by replacing the placeholder Settings page, auditing configurable thresholds, verifying database access rules, checking browser secret exposure, and preparing the app for production deployment.

## Scope

This phase covers only the Phase 8 work from `docs/BUILD_PROMPTS.md`: admin settings, hardening, UI tidy-up, verification, deployment attempt, go-live checklist, and first real admin account instructions. It does not add Stripe, payment processing, richer parent self-service, or GCVS integration.

## Settings Page

`src/app/settings/page.tsx` will become an admin-only server-rendered settings editor. The page reads the single `settings` row, shows all seven thresholds, and submits to a server action that validates and updates:

- `grade_floor`
- `tardy_window_hours`
- `tardies_per_week`
- `quran_inactivity_days`
- `payment_due_day`
- `school_start`
- `admin_digest_time`

Validation will keep values inside practical ranges and return inline errors without exposing sensitive data. Non-admin users continue to be redirected away server-side.

## Threshold Audit

Alert behavior must read from `settings`. Existing alert libraries already load settings for grades, attendance, Quran, payment, and admin digest. Phase 8 will also remove UI-facing hardcoded grade/Quran status thresholds where those screens can use the configured row instead, so daily-use screens match the alert behavior.

## Security Review

RLS will be reviewed against `docs/DATA_MODEL.md`. The migration should have RLS enabled on every table. Parents must only read linked-family data, moderators must not write `payments` or `settings`, and settings remain admin-writable with moderator read-only. Secret checks will confirm service-role and Twilio secrets are used only in server-side modules/scripts, browser clients use only public Supabase variables, and `.env*` is gitignored.

## UI Polish

Polish stays focused on daily use: a clear settings page, compact inputs, helpful save feedback, and threshold hints. No broad redesign.

## Verification And Deployment

Run lint, tests, and production build. Attempt Vercel production deployment only if the local Vercel CLI/project auth is already configured and does not require entering secrets or credentials. If deployment needs account setup or secret entry, stop and provide exact instructions for the user.
