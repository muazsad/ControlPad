# Parent-reported absences — design

**Status:** built on `feature/parent-absence-reports` (Oct 11, 2026). Goes live with Twilio.

## Goal

A parent texts the school number ("Amina sick today") and ControlPad records an
absence report **before** the absence alert goes out, so the parent doesn't get
a "your child hasn't been checked in" text about something they already told us.
The admin approves each report.

## Decisions (confirmed with owner)

| Question | Decision |
|---|---|
| Effect on attendance | **Pending admin approval.** A report does not change attendance by itself. The admin marks it *Excused*, *Unexcused absence*, or *Dismiss*. |
| Channels | **Text only** (Twilio inbound webhook). An admin-only "Simulate an incoming text" box on `/messages` exercises the same code path until Twilio is live. |
| Texts that aren't absences | **Forwarded to admin** by SMS (guardian name + message) and logged on `/messages`. |
| Dates | **Today or tomorrow** by text. No date word → today, or tomorrow if sent after 6 PM Eastern. |

## Flow

1. Twilio POSTs to `/api/sms/inbound`. The route checks `X-Twilio-Signature`
   (HMAC-SHA1 with `TWILIO_AUTH_TOKEN`), then calls `handleInboundSms()`.
2. Opt-out/help keywords (STOP, START, HELP, …) are logged and ignored — Twilio
   answers those itself.
3. The sender is matched to guardians by phone (E.164). Unknown number → forward
   to admin.
4. `planInboundSms()` (pure) decides:
   - **Absence report** — message looks like an absence (sick, absent, not
     coming, appointment, …) and the child is clear (only child, first name in
     the message, or "both/all/kids").
   - **Ask which child** — absence-like but the guardian has several children and
     none is named. Parent gets "Which child? Reply with a name: A, B, or ALL".
     A reply within 2 hours that names a child completes the report.
   - **Forward** — anything else (thanks, running late, questions).
5. Reports are stored in `absence_reports` (one per student per date; a second
   text for the same day doesn't create a duplicate). Parent gets an
   acknowledgement: "Thanks — we've noted that Amina will be absent today (Mon,
   Oct 12). The school will review it."
6. Every inbound text is stored in `inbound_messages` with its outcome.

## Effect on alerts

- The 10-minute tick treats a student with a **pending** or **unexcused** report
  as *reported*: the admin absence-check text still lists them, marked
  "(parent reported)", but **no parent absence text** is sent.
- *Excused* writes an `excused` attendance row → normal behavior (not flagged).
- *Dismissed* → normal behavior (as if no report).

## Admin review

- `/attendance`: a "Parent-reported absences" card lists every pending report
  (any date) with the parent's message and Excuse / Unexcused / Dismiss buttons
  (admin only; moderators see it read-only). The table shows a "Parent reported"
  badge on those students.
- Excused / Unexcused upsert the attendance row (`excused` / `absent`, note
  "Parent reported: …"). Refused if the student was already marked present or
  tardy that day — dismiss instead.
- Dashboard: banner with the number of reports waiting.
- `/messages`: "Incoming texts" log + the simulator.

## Data

- `inbound_messages` — from_phone, body, twilio_sid (unique; Twilio retries are
  ignored), guardian_id, outcome (`absence_report`/`needs_child`/`forwarded`/
  `ignored`), follow-up fields (`pending_date`, `pending_reason`, `resolved_at`),
  `simulated`. Admin read only; written by the service role.
- `absence_reports` — student, guardian, inbound message, date, reason, status
  (`pending`/`excused`/`unexcused`/`dismissed`), reviewer. Unique (student, date).
  Admin all; moderator read.
- New notification triggers: `absence_report_reply` (to parent), `parent_message`
  (forward to admin).

## Out of scope

Parent web form, date ranges, "running late" handling, a confirmation text after
the admin decides.
