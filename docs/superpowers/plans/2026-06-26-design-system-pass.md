# ControlPad Design System Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the existing Phase 1 app a trustworthy Salaam Institute branded UI, reusable app shell, and shared design-system patterns without changing auth, RLS, schema, middleware, or data flow.

**Architecture:** Install shadcn/ui primitives into `src/components/ui`, define CSS-variable design tokens in `src/app/globals.css`, then layer app-specific components in `src/components/controlpad`. Authenticated pages continue to fetch the current user and profile server-side; the new shell only receives already-fetched profile display data.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS v4, shadcn/ui, Radix UI dependencies, lucide-react, sonner, Supabase clients already present.

## Global Constraints

- Do not change auth logic, middleware, RLS, database schema, env vars, or Supabase data flow.
- Keep `.env*` gitignored and do not introduce secrets.
- Use shadcn/ui + Tailwind only for component-library work.
- Brand tokens: primary `#1E2A5E`, accent `#C8922E`, warm off-white background, near-navy foreground.
- Status tokens: success green, warning orange distinct from brand gold, danger red, neutral slate.
- Run `npx tsc --noEmit` and `npm run build` when complete.

---

### Task 1: shadcn/ui Foundation And Tokens

**Files:**
- Create: `components.json`
- Create/modify: `src/lib/utils.ts`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `src/components/ui/*`

**Interfaces:**
- Produces: shadcn UI primitives exported from `@/components/ui/*`.
- Produces: Tailwind theme variables such as `bg-background`, `text-primary`, `border-border`, and status variable classes.

- [ ] Install and initialize shadcn/ui for the existing Next.js App Router project.
- [ ] Add requested primitives: button, card, input, label, table, badge, dialog, dropdown-menu, avatar, separator, skeleton, sonner, tabs, select.
- [ ] Add brand/status CSS variables and Tailwind v4 `@theme inline` mappings.
- [ ] Keep Geist via `next/font` and make body use the new warm background.

### Task 2: Shared ControlPad Components

**Files:**
- Create: `src/components/controlpad/brand.tsx`
- Create: `src/components/controlpad/status-badge.tsx`
- Create: `src/components/controlpad/summary-card.tsx`
- Create: `src/components/controlpad/empty-state.tsx`
- Create: `src/components/controlpad/inline-error.tsx`
- Create: `src/components/controlpad/data-table.tsx`
- Create: `src/components/controlpad/loading-patterns.tsx`

**Interfaces:**
- Produces: `StatusBadge`, `SummaryCard`, `EmptyState`, `InlineError`, `DataTable`, and skeleton helpers for later phases.
- Consumes: shadcn primitives from Task 1.

- [ ] Build typed reusable components around the status scale and dashboard patterns.
- [ ] Keep empty/error/loading states friendly and compact.
- [ ] Avoid PII logging and avoid data fetching inside purely presentational components.

### Task 3: Role-Aware App Shell

**Files:**
- Create: `src/components/controlpad/app-shell.tsx`
- Create: `src/components/controlpad/user-menu.tsx`
- Create: `src/components/controlpad/mobile-nav.tsx`
- Modify: `src/app/sign-out-button.tsx`

**Interfaces:**
- Consumes: profile display data `{ fullName: string; role: "admin" | "moderator" | "parent" }`.
- Produces: role-aware admin/moderator sidebar shell and simplified parent shell.

- [ ] Add role-aware navigation for admin, moderator, and parent.
- [ ] Hide Tuition and Settings from moderators.
- [ ] Use a top-bar user dropdown with avatar and sign out.
- [ ] Make mobile navigation available through a dialog-based drawer.

### Task 4: Restyled Pages And Placeholder Routes

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/setup-profile/page.tsx`
- Modify: `src/app/page.tsx`
- Create: placeholder route pages under `src/app/students`, `src/app/grades`, `src/app/attendance`, `src/app/quran`, `src/app/tuition`, `src/app/settings`

**Interfaces:**
- Consumes: app shell and shared components from Tasks 2-3.
- Produces: restyled login, setup-profile, dashboard, and end-to-end nav routes.

- [ ] Restyle login with brand card, labels, loading state, and inline errors.
- [ ] Restyle setup-profile with selectable role options while preserving existing first-profile behavior.
- [ ] Convert home into a dashboard placeholder with status summary cards.
- [ ] Add "Coming soon" placeholder pages for nav routes.

### Task 5: Verification

**Files:**
- No production files unless verification reveals a type/build issue.

**Interfaces:**
- Confirms: TypeScript and Next production build pass.

- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm run build`.
- [ ] Report local viewing instructions and reusable component list.
