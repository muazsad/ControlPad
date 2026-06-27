# Admin Daily Summary Design

## Context

ControlPad Phase 7 adds the admin's daily picture from `docs/PROJECT_PLAN.md`
and `docs/BUILD_PROMPTS.md`: today's absences, tardies, low or dropping grades,
Quran slippage, and overdue payments should be visible when the admin signs in
around 3pm. A scheduled digest should also notify admins.

Twilio is not configured yet, so the digest must be safe in dry-run mode. The
existing `sendSms` module already logs queued notifications when Twilio
environment variables are missing. Phase 7 will use that behavior instead of
adding another delivery path.

## Scope

- Admin dashboard cards and issue lists for today's attendance, low/dropping
  grades, Quran slippage, and overdue tuition.
- A protected cron route for the admin digest.
- SMS-only digest delivery through `src/lib/sms/send-sms.ts`.
- Notification logging with `trigger_type = 'admin_digest'` and
  `student_id = null`.
- No email provider, no schema migration, and no billing/account actions.

## Architecture

Create `src/lib/alerts/admin-digest.ts` as the shared summary engine. It will
read `settings` first, then compute a typed `AdminDailySummary` from Supabase
using the service client for cron and server-side dashboard calls. The same
module will format a compact SMS body and send it to admin profiles with phone
numbers.

The admin home page will replace the placeholder Phase 1 cards with real
summary counts and issue tables. Parent and moderator dashboard behavior stays
unchanged except that moderators continue to hide tuition/admin-only details.

The cron route `src/app/api/cron/admin-digest/route.ts` will require
`CRON_SECRET`, accept an optional `date=YYYY-MM-DD` query param for testing, and
check `settings.admin_digest_time` before sending unless a manual test override
is provided. Vercel cron remains a fixed schedule; the route decides whether the
configured settings time has arrived.

## Data Rules

- Absences and tardies come from `attendance.date = today`.
- Low grades use each course's latest grade and compare it to
  `settings.grade_floor`.
- Dropping grades use the latest two grade entries per course and flag a
  negative delta, while low grades remain flagged even without a prior entry.
- Quran slippage uses active students whose latest `quran_progress.date` is
  older than `settings.quran_inactivity_days`, or active students with no Quran
  entries.
- Overdue payments use active students without a paid row for the current
  `period_month` once `asOfDate` is after `settings.payment_due_day`.
- Thresholds and digest time are always read from `settings`; no threshold is
  hardcoded in UI or cron logic.

## Digest Behavior

- The digest is SMS-only.
- Each admin profile with a phone number receives one summary SMS.
- The SMS is concise and includes counts first, followed by a short list of the
  most urgent names when there are issues.
- The send uses `sendSms` with `triggerType: "admin_digest"`,
  `recipientType: "admin"`, `studentId: null`, and a daily dedupe window.
- If Twilio env vars are missing, `sendSms` logs a queued notification with the
  existing dry-run error and no real SMS is sent.
- If there are no issues, the digest may still log/send an all-clear message so
  the admin knows the check ran.

## UI Design

The admin dashboard should be practical and scan-friendly:

- Top band: greeting, today's date, digest time, and a badge indicating whether
  the day is clear or needs attention.
- Summary cards: absences, tardies, low/dropping grades, Quran slippage, and
  overdue payments, using the existing `SummaryCard` and status tones.
- Priority section: compact lists grouped by issue type, with student names,
  reason, and module links.
- Empty states use the existing `EmptyState` component and avoid heavy
  decoration.

## Testing

- Unit-test summary formatting and digest send behavior with mocked database and
  mocked `sendSms`.
- Unit-test threshold logic for low grades, dropping grades, Quran slippage, and
  overdue payments using deterministic dates.
- Route-level behavior can be covered indirectly by testing the digest module and
  verifying the cron route uses `requireCronSecret`.
- Final verification must run typecheck, lint, and production build.

## Open Decisions

- Email is explicitly out of scope for this phase.
- Vercel cron schedule can be added as a fixed schedule that calls the protected
  route; the route remains responsible for honoring `settings.admin_digest_time`.
