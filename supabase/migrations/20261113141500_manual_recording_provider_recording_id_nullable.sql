begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recorded_classes'
      and column_name = 'provider_recording_id'
  ) then
    raise exception 'public.recorded_classes.provider_recording_id must exist before manual uploads can be finalized.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recorded_classes'
      and column_name = 'provider_recording_id'
      and is_nullable = 'NO'
  ) then
    alter table public.recorded_classes
      alter column provider_recording_id drop not null;
  end if;
end;
$$;

commit;
