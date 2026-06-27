# Phase 8 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish ControlPad Phase 8 with an admin settings editor, threshold/security audits, verification, and production deployment instructions.

**Architecture:** Keep settings as the existing single-row Supabase table. Use a server action for admin-only validation and updates, then render the page through the existing app shell and shadcn/Tailwind components. Security verification is a repo audit plus focused tests/scripts where local infrastructure supports it.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Tailwind CSS, shadcn/ui, Node test runner.

## Global Constraints

- Read `CLAUDE.md`, `docs/PROJECT_PLAN.md`, and `docs/DATA_MODEL.md`; the plan is source of truth.
- Never hardcode alert thresholds; read them from `settings`.
- RLS must stay enabled on every table.
- Service role and Twilio secrets must never be exposed to browser code.
- Do not handle user credentials, billing, or secret entry.
- Keep UI simple, legible, and consistent with the existing app shell and components.

---

### Task 1: Settings Action And Page

**Files:**
- Create: `src/app/settings/actions.ts`
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Produces: `updateSettings(prevState: SettingsFormState, formData: FormData): Promise<SettingsFormState>`
- Produces: `SettingsFormState = { error: string | null; success?: string }`

- [x] Write validation for numeric and time fields in `src/app/settings/actions.ts`.
- [x] Enforce `profile.role === "admin"` server-side before updating.
- [x] Update `settings` row `id = 1` and revalidate `/settings`.
- [x] Replace the ComingSoon placeholder with a real form for all seven columns.
- [x] Show inline save errors and success copy.
- [x] Run `npm run lint`.

### Task 2: Configurable Threshold UI Usage

**Files:**
- Modify: `src/app/grades/page.tsx`
- Modify: `src/app/grades/[courseId]/page.tsx`
- Modify: `src/app/quran/page.tsx`
- Modify: `src/app/quran/quran-bulk-form.tsx`

**Interfaces:**
- Consumes: `settings.grade_floor`
- Consumes: `settings.quran_inactivity_days`
- Produces: UI badges and stale-row highlights based on configured settings.

- [x] Load `grade_floor` on grades list/detail pages.
- [x] Change grade tone helpers to accept the configured floor and use a small warning band above it.
- [x] Load `quran_inactivity_days` on Quran pages.
- [x] Pass `quranInactivityDays` into `QuranBulkForm`.
- [x] Replace hardcoded Quran stale thresholds with configured values.
- [x] Run `npm run lint`.

### Task 3: RLS And Secret Audit

**Files:**
- Create: `scripts/audit-launch-readiness.mjs`

**Interfaces:**
- Produces: a local audit command that checks RLS enablement/policy coverage, known role restrictions, secret imports, env gitignore, and threshold hardcode candidates.

- [x] Parse `supabase/migrations/20260626000000_initial_schema.sql` and confirm all app tables enable RLS.
- [x] Confirm expected table policies exist for settings, payments, parent student access, moderator read-only billing, and moderator settings read-only.
- [x] Scan `src` for server-only secret names in client components/browser modules.
- [x] Confirm `.gitignore` contains `.env*`.
- [x] Report remaining threshold hardcodes, excluding docs, tests, schema defaults, and formatting literals.
- [x] Run `node scripts/audit-launch-readiness.mjs`.

### Task 4: Full Verification And Deployment

**Files:**
- Modify only if verification reveals a focused issue.

**Interfaces:**
- Consumes: npm scripts `lint`, `test`, and `build`.
- Produces: launch status and Vercel deployment result or exact user steps.

- [x] Run `npm run lint`.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Check Vercel CLI/project state without requesting credentials.
- [ ] If configured, run production deploy.
- [x] If not configured, provide exact Vercel steps and required env vars.

## Self-Review

- Spec coverage: Settings page, threshold audit, RLS review, secret review, UI tidy, verification, deploy attempt, go-live checklist, and first admin instructions are covered.
- Placeholder scan: no task depends on unspecified behavior.
- Type consistency: `SettingsFormState` and `updateSettings` names are defined in Task 1 and consumed only by the settings form.
