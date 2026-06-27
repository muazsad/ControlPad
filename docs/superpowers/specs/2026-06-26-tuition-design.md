# Tuition Tracking — Design Spec

**Date:** 2026-06-26  
**Phase:** 6 (per `docs/PROJECT_PLAN.md`)  
**Scope:** Monthly payment status tracking, admin UI, parent view, overdue SMS cron. No payment processing.

---

## 1. Goals

- Admin can mark each student's monthly tuition paid or unpaid.
- Parents can see their children's payment status for the current month.
- A daily cron SMS-alerts parent (+ admin) weekly once a month is overdue.
- Leave clean seams for Stripe: `amount` and `paid_at` columns stay in schema, untouched by this phase.

---

## 2. Data layer

The `payments` table already exists in the schema:

```sql
payments (
  id            uuid primary key,
  student_id    uuid references students(id),
  period_month  date not null,   -- first day of the covered month, e.g. 2026-06-01
  amount        numeric,         -- nullable; populated by Stripe later
  status        payment_status,  -- 'paid' | 'unpaid'
  paid_at       timestamptz,     -- set when marking paid, cleared when marking unpaid
  recorded_by   uuid references auth.users(id),
  unique (student_id, period_month)
)
```

`settings.payment_due_day` (int, default 5) drives the overdue threshold.

**No schema changes needed for this phase.**

---

## 3. Server action

**`src/app/tuition/actions.ts`** — `setPaymentStatus(studentId, periodMonth, newStatus)`

- Role-guards to admin only (server-side `getCurrentProfile`).
- Upserts into `payments` on conflict `(student_id, period_month)`.
- Sets `paid_at = now()` when `newStatus = 'paid'`; clears to `null` when `'unpaid'`.
- Sets `recorded_by = auth.uid()`.
- The unique constraint means first-time marking and toggling back both use the same upsert — no separate insert/update paths.

---

## 4. Admin UI — `/tuition`

**Access:** Admin only; non-admins redirect to `/`.

**Layout:** `AppShell` → `PageHeader` ("Tuition", "Mark each student's monthly payment status.")

**Month navigation bar** between header and table:
- Left/right `Link` chevron buttons shifting `?month` param by one month (e.g. `?month=2026-06`).
- Defaults to current month when param is absent.
- Right arrow is disabled/hidden when `month >= currentMonth` (no future months).
- Month displayed as "June 2026".

**Student table** (`<DataTable>`):

| Column | Notes |
|--------|-------|
| Student | Full name |
| Monthly fee | "—" for now (Stripe will populate `amount`) |
| Status | `<StatusBadge>` — "Paid" / success, "Unpaid" / danger |
| Action | Small `<form>` + server action button: "Mark paid" or "Mark unpaid" |

- Students with no `payments` row for the period are treated as unpaid.
- The action form carries hidden inputs: `studentId`, `periodMonth`, `newStatus`.

---

## 5. Parent view — `/tuition`

Same URL, role-detected. Renders inside `AppShell` (parent top-bar layout).

- Fetches only the current month's payments for the parent's linked children (RLS enforces family isolation).
- Read-only `<DataTable>` — Student name + Status badge, no action column.
- Footer note: "Contact the school to update your payment status."
- No month navigation (parents see current month only).

---

## 6. Alert library — `src/lib/alerts/payment.ts`

Follows the injectable-deps pattern of `quran.ts`:

```ts
interface PaymentAlertDatabase {
  getPaymentSettings(): Promise<{ paymentDueDayOfMonth: number }>
  getAdminRecipients(): Promise<{ full_name: string; phone: string | null }[]>
  getOverdueStudents(periodMonth: string, dueDayOfMonth: number): Promise<OverdueStudent[]>
}

// OverdueStudent: { id, first_name, last_name, guardians: { full_name, phone }[] }

function createSupabasePaymentAlertDatabase(): PaymentAlertDatabase
async function checkPaymentOverdueAlerts(asOfDate: string, deps?: AlertDeps): Promise<AlertResult>
```

**Overdue logic:**
- `periodMonth` = first day of the month containing `asOfDate` (e.g. `2026-06-01`).
- A student is overdue when `day(asOfDate) > paymentDueDayOfMonth` AND their `payments` row for `periodMonth` is missing or `status = 'unpaid'`.

**SMS messages (current — parent copy subject to change later):**
- Parent: `"Salaam Institute: [Name]'s tuition for [Month Year] has not been received. Please contact the school."`
- Admin: `"ControlPad: [Name]'s tuition for [Month Year] is overdue (due day: [N])."`

**Dedupe window:** 168 hours (7 days) — the same `(student_id, payment_overdue)` pair won't re-alert for a week, giving weekly reminders until paid.

---

## 7. Cron route — `/api/cron/payment-overdue`

```ts
// src/app/api/cron/payment-overdue/route.ts
requireCronSecret → cronDateParam → checkPaymentOverdueAlerts(date) → JSON { ok, date, students, messages }
```

**`vercel.json` entry:** `"0 14 * * 1-5"` (14:00 UTC = 9am ET, weekdays).

---

## 8. Stripe seam

- `payments.amount` stays nullable — no UI reads or writes it in this phase.
- `payments.paid_at` is set/cleared by the admin toggle — Stripe will overwrite it with the actual charge timestamp.
- `recorded_by` will be `null` for Stripe-initiated records; admin-toggled records will always have it set.
- No stub hooks, feature flags, or placeholder routes needed — the column presence is the seam.

---

## 9. Files to create / modify

| Path | Change |
|------|--------|
| `src/app/tuition/page.tsx` | Replace ComingSoon stub with full role-aware page |
| `src/app/tuition/actions.ts` | New — `setPaymentStatus` server action |
| `src/lib/alerts/payment.ts` | New — alert library following quran.ts pattern |
| `src/app/api/cron/payment-overdue/route.ts` | New — cron handler |
| `vercel.json` | Add payment-overdue cron entry |

No migration needed — `payments` table and `payment_due_day` setting already exist.
