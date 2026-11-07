-- Multi-tenancy follow-up. 20261103000100 added composite foreign keys
-- (child_id, school_id) → parent (id, school_id) but kept the original
-- single-column ones (child_id → parent.id). PostgREST then sees two
-- relationships between e.g. attendance and students and refuses every embed
-- like `students(first_name)` ("more than one relationship was found"), which
-- broke the admin dashboard.
--
-- The composite key enforces everything the single-column key did (school_id
-- is not null, so a non-null child_id is always checked), so drop the old one
-- wherever a composite key to the same parent covers the same column.
do $$
declare
  r record;
begin
  for r in
    select single.conrelid::regclass as tbl, single.conname
    from pg_constraint single
    join pg_constraint composite
      on composite.conrelid = single.conrelid
     and composite.confrelid = single.confrelid
     and composite.contype = 'f'
     and array_length(composite.conkey, 1) = 2
     and single.conkey[1] = any (composite.conkey)
    where single.contype = 'f'
      and array_length(single.conkey, 1) = 1
      and single.connamespace = 'public'::regnamespace
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = composite.conrelid
          and a.attnum = any (composite.conkey)
          and a.attname = 'school_id'
      )
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

-- PostgREST caches relationships; reload so embeds work straight away.
notify pgrst, 'reload schema';
