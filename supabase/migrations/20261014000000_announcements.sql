-- Announcements: one-off texts to all parents or chosen schedule groups, sent
-- immediately or at a scheduled time (by the 10-minute tick). Additive only.
-- Spec: docs/superpowers/specs/2026-10-11-announcements-design.md

create table if not exists announcements (
  id             uuid primary key default gen_random_uuid(),
  message        text not null check (char_length(message) between 1 and 450),
  -- null = all parents. Otherwise schedule group ids, plus 'ungrouped' for
  -- students without a group.
  audience       text[],
  status         text not null default 'scheduled'
                 check (status in ('scheduled', 'sending', 'sent', 'cancelled', 'failed')),
  send_at        timestamptz not null,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,
  -- Results, filled in when it goes out.
  recipients     int,
  failed_count   int,
  delivery_mode  text,
  error          text
);

create index if not exists idx_announcements_due on announcements(status, send_at);

alter table announcements enable row level security;

drop policy if exists announcements_admin_all on announcements;
create policy announcements_admin_all on announcements
  for all using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

alter type notification_trigger add value if not exists 'announcement';
