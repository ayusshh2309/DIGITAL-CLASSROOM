begin;

do $$
declare
  status_constraint record;
begin
  for status_constraint in
    select constraint_row.conname
    from pg_constraint as constraint_row
    join pg_attribute as status_attribute
      on status_attribute.attrelid = constraint_row.conrelid
      and status_attribute.attname = 'status'
      and not status_attribute.attisdropped
    where constraint_row.conrelid = 'public.live_classes'::regclass
      and constraint_row.contype = 'c'
      and array_length(constraint_row.conkey, 1) = 1
      and constraint_row.conkey[1] = status_attribute.attnum
      and pg_get_constraintdef(constraint_row.oid) ilike '%status%'
  loop
    execute format(
      'alter table public.live_classes drop constraint %I',
      status_constraint.conname
    );
  end loop;
end;
$$;

alter table public.live_classes
  add constraint live_classes_status_check
  check (lower(status) in ('scheduled', 'live', 'completed', 'cancelled', 'missed', 'attended'));

commit;
