# Student Profile Classes And Quran Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make class management and grade updates available inside each student profile, and simplify Quran bulk entry so staff only enter lines memorized.

**Architecture:** Keep the existing schema: `courses` remain per-student and `grades` remain append-only snapshots. Add a small testable grade-display helper, reuse the existing grade server actions from both `/grades` and `/students/[id]`, and trim the Quran bulk form without changing stored data.

**Tech Stack:** Next.js App Router, TypeScript, Supabase server client, server actions, Tailwind/shadcn UI, Node built-in test runner via `tsx`.

## Global Constraints

- Follow `docs/PROJECT_PLAN.md`; courses are per student and grade history is preserved.
- RLS remains the access boundary; staff mutations are guarded server-side with `requireRole(["admin", "moderator"])`.
- Do not hardcode grade alert thresholds; continue using `settings.grade_floor`.
- Do not expose service-role keys or PII in client logs.
- Leave the app working and deployable after the change.

---

### Task 1: Grade Display Helper

**Files:**
- Create: `src/app/grades/grade-display.test.ts`
- Create: `src/app/grades/grade-display.ts`

**Interfaces:**
- Produces: `latestGrade<T extends { recorded_at: string }>(grades: T[]): T | null`
- Produces: `gradeTone(value: number | null, gradeFloor: number | null): "neutral" | "danger" | "warning" | "success"`
- Produces: `formatGrade(value: number | null): string`

- [ ] Write tests showing latest grade is selected by newest `recorded_at`, grade tones use the configured floor, and null grades format as `No data`.
- [ ] Run `npm test -- src/app/grades/grade-display.test.ts` and confirm the tests fail because the helper does not exist.
- [ ] Implement the helper functions.
- [ ] Run `npm test -- src/app/grades/grade-display.test.ts` and confirm the tests pass.

### Task 2: Reusable Course Form Redirect

**Files:**
- Modify: `src/app/grades/actions.ts`
- Modify: `src/app/grades/course-form.tsx`

**Interfaces:**
- Consumes: `createCourse(_prev, form)` server action.
- Produces: optional hidden `redirect_to` support so student profiles can stay on `/students/[id]`.
- Produces: optional hidden `fixed_student_id` support so the student profile form does not need a student dropdown.

- [ ] Update `createCourse` to prefer `fixed_student_id` over `student_id`.
- [ ] Update `createCourse` to redirect to `redirect_to` when provided, otherwise keep redirecting to `/grades/[courseId]`.
- [ ] Update `CourseForm` props to accept `fixedStudentId?: string`, `redirectTo?: string`, and `compact?: boolean`.
- [ ] Keep the existing `/grades` add-course flow working with the student dropdown.

### Task 3: Student Profile Classes And Inline Grade Updates

**Files:**
- Modify: `src/app/students/[id]/page.tsx`

**Interfaces:**
- Consumes: `CourseForm` with `fixedStudentId` and `redirectTo`.
- Consumes: `GradeForm` for each course row.
- Consumes: grade display helpers from Task 1.

- [ ] Fetch the student courses with their grade snapshots and `settings.grade_floor`.
- [ ] Add a `Classes / Grades` card after the profile card.
- [ ] Inside the card, show add-class controls for course name and optional GCVS code.
- [ ] List all classes for the student with latest grade badge, latest recorded date, and inline `GradeForm`.
- [ ] Show an empty state when the student has no classes.

### Task 4: Quran Lines-Only Bulk Entry

**Files:**
- Modify: `src/app/quran/quran-bulk-form.tsx`
- Modify: `src/app/quran/actions.ts`

**Interfaces:**
- Keeps: rows are skipped when `lines_<studentId>` is blank.
- Keeps: `lines_memorized` accepts zero or positive numeric values.
- Produces: staff UI only asks for `lines_memorized`; `surah`, `from_ayah`, `to_ayah`, and `note` are saved as null from bulk entry.

- [ ] Remove the surah/from/to/note inputs from the bulk staff row.
- [ ] Keep the lesson date and per-student latest entry context.
- [ ] Simplify server action row creation so optional Quran detail fields are null for bulk lines-only entries.
- [ ] Update page copy from "lessons" to "lines memorized" where it helps staff understand the action.

### Task 5: Verification

**Files:**
- No production files unless checks reveal issues.

**Interfaces:**
- Confirms the app compiles and core tests pass.

- [ ] Run `npm test -- src/app/grades/grade-display.test.ts`.
- [ ] Run `npm test`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
