-- Parent-reported absences: inbound texts and the absence reports they create.
-- Additive only. Both tables are written by the server (service role) from the
-- Twilio webhook; admins review reports in the app.
-- Spec: docs/superpowers/specs/2026-10-11-parent-absence-reports-design.md

-- 1. Every text received on the school number.
create table if not exists inbound_messages (
  id              uuid primary key default gen_random_uuid(),
  from_phone      text not null,
  body            text not null,
  -- Twilio MessageSid; null for simulated texts. Unique so Twilio retries are ignored.
  twilio_sid      text unique,
  guardian_id     uuid references guardians(id) on delete set null,
  outcome         text not null
                  check (outcome in ('absence_report', 'needs_child', 'forwarded', 'ignored')),
  -- Follow-up state for outcome = 'needs_child' (waiting for the parent to name a child).
  pending_date    date,
  pending_reason  text,
  resolved_at     timestamptz,
  simulated       boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists idx_inbound_messages_from_created
  on inbound_messages(from_phone, created_at desc);

-- 2. One report per student per date.
do $$ begin
  create type absence_report_status as enum ('pending', 'excused', 'unexcused', 'dismissed');
exception when duplicate_object then null; end $$;

create table if not exists absence_reports (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references students(id) on delete cascade,
  guardian_id         uuid references guardians(id) on delete set null,
  inbound_message_id  uuid references inbound_messages(id) on delete set null,
  date                date not null,
  reason              text,
  status              absence_report_status not null default 'pending',
  reviewed_by         uuid references auth.users(id),
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (student_id, date)
);

create index if not exists idx_absence_reports_status_date on absence_reports(status, date);

drop trigger if exists absence_reports_updated_at on absence_reports;
create trigger absence_reports_updated_at
  before update on absence_reports
  for each row execute function update_updated_at();

-- 3. RLS.
alter table inbound_messages enable row level security;
alter table absence_reports enable row level security;

drop policy if exists inbound_messages_admin_read on inbound_messages;
create policy inbound_messages_admin_read on inbound_messages
  for select using (public.user_role() = 'admin');

drop policy if exists absence_reports_admin_all on absence_reports;
create policy absence_reports_admin_all on absence_reports
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

drop policy if exists absence_reports_moderator_read on absence_reports;
create policy absence_reports_moderator_read on absence_reports
  for select using (public.user_role() = 'moderator');

-- 4. Notification triggers.
alter type notification_trigger add value if not exists 'absence_report_reply';
alter type notification_trigger add value if not exists 'parent_message';
