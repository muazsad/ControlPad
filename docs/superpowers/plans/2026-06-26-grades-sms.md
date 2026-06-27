# Grades And Low-Grade SMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 3 grades module with course creation, grade history, parent/staff views, and low-grade SMS alert logging/sending.

**Architecture:** Use server components for data views and server actions for mutations, all gated server-side through `requireRole`. Keep SMS and low-grade alert logic in `src/lib/sms` and `src/lib/alerts` so all notification behavior is reusable and testable outside React.

**Tech Stack:** Next.js App Router, TypeScript, Supabase SSR/server clients, Tailwind/shadcn UI, Node built-in test runner via `tsx`, Twilio REST API via server-side `fetch`.

## Global Constraints

- Read thresholds from `settings`; never hardcode grade floors.
- All SMS go through `src/lib/sms/send-sms.ts`, are deduped first, and are logged to `notifications`.
- Service role and Twilio secrets are server-only; never expose them in client components.
- Parent access relies on RLS so parents only see linked children.
- If Twilio env vars are missing, log a queued dry-run notification and do not call Twilio.
- Run `npm test`, `npx tsc --noEmit`, and `npm run build` before completion.

---

### Task 1: Test Harness

**Files:**
- Modify: `package.json`
- Create: `src/lib/test/fake-supabase.ts`

**Interfaces:**
- Produces: `npm test` running `node --test --import tsx`.
- Produces: small fake Supabase query helpers for alert/SMS unit tests.

- [ ] Add `tsx` as a dev dependency.
- [ ] Add a `test` script.
- [ ] Add fake query helpers if tests need them.
- [ ] Run `npm test` and expect an empty passing suite or explicit no-test success.

### Task 2: SMS Module

**Files:**
- Create: `src/lib/sms/send-sms.test.ts`
- Create: `src/lib/sms/send-sms.ts`

**Interfaces:**
- Produces: `sendSms(input, deps?)`.
- Consumes: Supabase-like dependency with `from()` query API.

- [ ] Write failing tests for duplicate suppression and dry-run logging.
- [ ] Implement `sendSms` with dedupe, notification insert, dry-run behavior, and Twilio REST fetch when configured.
- [ ] Run `npm test`.

### Task 3: Grade Alert Logic

**Files:**
- Create: `src/lib/alerts/grades.test.ts`
- Create: `src/lib/alerts/grades.ts`

**Interfaces:**
- Produces: `checkLowGradeAlert(input, deps?)`.
- Consumes: `sendSms`.

- [ ] Write failing tests proving grades above floor do nothing and grades below floor notify admin recipients.
- [ ] Implement settings lookup, admin phone lookup, message construction, and optional guardian lookup.
- [ ] Run `npm test`.

### Task 4: Grades Server Actions

**Files:**
- Create: `src/app/grades/actions.ts`
- Create: `src/app/grades/course-form.tsx`
- Create: `src/app/grades/grade-form.tsx`

**Interfaces:**
- Produces: `createCourse`, `recordGrade`.
- Consumes: `checkLowGradeAlert` after each grade insert.

- [ ] Add server actions gated to admin/moderator.
- [ ] Validate course/student IDs and grade range.
- [ ] Insert grade snapshots as new rows; do not update previous grades.
- [ ] Trigger low-grade alert after a successful insert.

### Task 5: Grades UI

**Files:**
- Modify: `src/app/grades/page.tsx`
- Create: `src/app/grades/[courseId]/page.tsx`

**Interfaces:**
- Consumes: grades actions, `DataTable`, `StatusBadge`, forms.

- [ ] Replace the placeholder page with a role-aware grades overview.
- [ ] Show latest grade per course and grade history by course.
- [ ] Staff can add courses/grades; parents get read-only RLS-scoped views.
- [ ] Preserve the app shell and design-system patterns.

### Task 6: Verification

**Files:**
- No production files unless checks reveal issues.

**Interfaces:**
- Confirms all planned behavior compiles and builds.

- [ ] Run `npm test`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm run build`.
- [ ] Document Twilio env vars and non-spam test path.
