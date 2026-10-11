-- Staff accountability: each schedule group can have one responsible teacher
-- (a moderator or admin), who owns attendance and Quran logging for the
-- group's students. Additive only; existing groups start with no teacher.
-- Spec: docs/superpowers/specs/2026-10-11-staff-accountability-design.md

alter table schedule_groups
  add column if not exists teacher_id uuid references profiles(id) on delete set null;

create index if not exists idx_schedule_groups_teacher on schedule_groups(teacher_id);
