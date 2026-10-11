# Announcements — design

**Status:** built on `feature/announcements` (stacked on `feature/staff-accountability`), Oct 11, 2026.

## Goal

The admin can text all parents, or the parents of chosen schedule groups, a
one-off message (closures, Eid schedule, reminders) — now or at a set time.

## Decisions (confirmed with owner)

| Question | Decision |
|---|---|
| Audience | **All parents, or one or more schedule groups** (plus "Students without a group"). Each family phone is texted once, however many children. Active students only. |
| Timing | **Send now** (with a confirm) **or schedule** a date/time; scheduled ones can be cancelled until they go out. |
| Where | New admin-only **Announcements** tab (compose + history). |

## Behavior

- Message ≤ 450 characters; "Salaam Institute: " is prefixed (unless already there). The form shows what parents will see, the character count, SMS segments, and how many families will get it.
- Scheduled times are Eastern, **8:00 AM–6:50 PM** only: the 10-minute tick runs 10:00–23:50 UTC (06:00–18:50 Eastern year-round), and 8 AM keeps texts out of early-morning quiet hours. Sent within 10 minutes of the chosen time.
- `/api/cron/attendance-tick` calls `sendDueAnnouncements(now)` after the attendance work (errors there don't hide the attendance result).
- **No double sends:** sending first *claims* the row (`scheduled` → `sending` in one conditional update), so the tick and "Send now" can't both send it; each text also dedupes on `announcement:<id>` per phone.
- Every text goes through `sendSms()` (trigger `announcement`), so `SMS_MODE` applies and each one is on `/messages`. While texting is off the announcement is recorded as sent with "logged, not sent (texting off)".
- Result stored on the row: recipients, failed count, delivery mode. Status `failed` only if every text failed (or recipients couldn't be loaded).
- Phone numbers never reach the browser: the recipient counter uses opaque family ids.

## Data

Migration `20261014000000_announcements.sql`: `announcements` (message, audience `text[]` — null = all parents, else group ids / `ungrouped`; status `scheduled|sending|sent|cancelled|failed`; `send_at`, `created_by`, `sent_at`, `recipients`, `failed_count`, `delivery_mode`, `error`). RLS: admin only. Trigger `announcement`.

## Out of scope

Per-student targeting, texting staff, editing a scheduled announcement (cancel and re-create), parent replies (they go through the incoming-text flow and are forwarded to admin).
