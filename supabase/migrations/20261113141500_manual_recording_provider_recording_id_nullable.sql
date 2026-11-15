begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recorded_classes'
      and column_name = 'live_class_id'
      and data_type = 'uuid'
  ) then
    raise exception 'public.recorded_classes.live_class_id must use the live_classes UUID key.';
  end if;
end;
$$;

commit;
