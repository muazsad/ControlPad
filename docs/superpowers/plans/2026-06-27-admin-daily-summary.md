# Admin Daily Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 7 admin daily summary dashboard and SMS-only scheduled digest.

**Architecture:** Add one shared summary/digest module in `src/lib/alerts/admin-digest.ts`; use it from the server-rendered home page and a protected cron route. SMS delivery goes through `src/lib/sms/send-sms.ts`, which already logs dry-run queued notifications when Twilio is not configured.

**Tech Stack:** Next.js App Router, TypeScript, Supabase service/server clients, Node test runner with `tsx`, shadcn/ui/Tailwind, Vercel Cron, Twilio via the existing SMS module.

## Global Constraints

- Read thresholds and `settings.admin_digest_time` from the `settings` table.
- Do not add email support in this phase.
- Do not add a schema migration unless existing notification logging cannot store `admin_digest` with `student_id = null`.
- Do not expose service role or secrets to the browser.
- Every digest send must go through `sendSms` and be logged to `notifications`.
- Twilio is not configured yet; dry-run queued notifications are expected.

---

## File Structure

- Create `src/lib/alerts/admin-digest.ts`: summary types, Supabase query adapter, SMS body formatting, digest time gate, digest sender.
- Create `src/lib/alerts/admin-digest.test.ts`: test summary/digest formatting and SMS send behavior with fake databases.
- Modify `src/app/page.tsx`: replace admin placeholder cards with real `AdminDailySummary` data and grouped issue lists.
- Create `src/app/api/cron/admin-digest/route.ts`: protected route for scheduled digest.
- Modify `vercel.json`: add fixed weekday cron for the digest route.

---

### Task 1: Admin Summary Engine

**Files:**
- Create: `src/lib/alerts/admin-digest.ts`
- Test: `src/lib/alerts/admin-digest.test.ts`

**Interfaces:**
- Produces: `getAdminDailySummary(asOfDate: string, deps?: AdminDigestDeps): Promise<AdminDailySummary>`
- Produces: `formatAdminDigestSms(summary: AdminDailySummary): string`
- Produces: `sendAdminDigest(input: { date: string; force?: boolean; now?: Date }, deps?: AdminDigestDeps): Promise<AdminDigestSendResult>`

- [ ] **Step 1: Write failing tests**

Test behaviors:
- formats all-clear digest text with date and zero counts.
- formats issue digest text with counts and first issue names.
- sends one `admin_digest` SMS per admin phone with `studentId: null`.
- skips scheduled send before `settings.admin_digest_time` unless `force` is true.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/alerts/admin-digest.test.ts`

- [ ] **Step 3: Implement minimal engine**

Implement typed database interface, summary type, time gate, formatter, and send function.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/alerts/admin-digest.test.ts`

---

### Task 2: Dashboard UI

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `getAdminDailySummary(asOfDate: string)` and `AdminDailySummary`.

- [ ] **Step 1: Update admin dashboard server data**

Fetch summary only for admins. Keep parent dashboard and moderator behavior intact.

- [ ] **Step 2: Replace placeholder admin cards**

Use `SummaryCard`, `DataTable`, `StatusBadge`, `EmptyState`, and existing icons for the five Phase 7 categories.

- [ ] **Step 3: Run typecheck/build smoke**

Run: `npx tsc --noEmit`

---

### Task 3: Cron Route

**Files:**
- Create: `src/app/api/cron/admin-digest/route.ts`

**Interfaces:**
- Consumes: `requireCronSecret`, `cronDateParam`, and `sendAdminDigest`.

- [ ] **Step 1: Create protected route**

Require `CRON_SECRET`, support `date=YYYY-MM-DD`, support `force=1` for manual testing, and return JSON with send result.

- [ ] **Step 2: Verify route compiles**

Run: `npx tsc --noEmit`

---

### Task 4: Vercel Cron Schedule

**Files:**
- Modify: `vercel.json`

**Interfaces:**
- Produces: a fixed schedule calling `/api/cron/admin-digest`.

- [ ] **Step 1: Add cron entry**

Add a weekday schedule near the default 3pm school time. The route still honors `settings.admin_digest_time`.

- [ ] **Step 2: Verify JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('ok')"`

---

### Task 5: Final Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run tests**

Run: `npm test`

- [ ] **Step 2: Run lint**

Run: `npm run lint`

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Run production build**

Run: `npm run build`
