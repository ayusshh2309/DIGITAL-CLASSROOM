-- Backup recovery-code storage and service-role-only RPCs.
-- Apply this migration once with `supabase db push`; do not also run the
-- legacy sql/user_recovery_codes.sql script.

create table if not exists public.user_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

do $migration$
declare
  expected_column record;
  actual_type text;
  is_nullable text;
begin
  for expected_column in
    select *
    from (values
      ('id', 'uuid', 'NO'),
      ('user_id', 'uuid', 'NO'),
      ('code_hash', 'text', 'NO'),
      ('used_at', 'timestamp with time zone', 'YES'),
      ('created_at', 'timestamp with time zone', 'NO')
    ) as expected(name, data_type, is_nullable)
  loop
    select columns.data_type, columns.is_nullable
    into actual_type, is_nullable
    from information_schema.columns as columns
    where columns.table_schema = 'public'
      and columns.table_name = 'user_recovery_codes'
      and columns.column_name = expected_column.name;

    if not found
      or actual_type <> expected_column.data_type
      or is_nullable <> expected_column.is_nullable
    then
      raise exception
        'public.user_recovery_codes has an incompatible or missing column: %.',
        expected_column.name;
    end if;
  end loop;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_recovery_codes'
      and column_name in ('code', 'recovery_code', 'plaintext_code')
  ) then
    raise exception
      'public.user_recovery_codes contains a plaintext recovery-code column; remove it securely before applying this migration.';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_recovery_codes'::regclass
      and contype = 'p'
      and conkey <> array[(
        select attnum
        from pg_attribute
        where attrelid = 'public.user_recovery_codes'::regclass
          and attname = 'id'
      )]::smallint[]
  ) then
    raise exception
      'public.user_recovery_codes has an incompatible primary key.';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_recovery_codes'::regclass
      and contype = 'p'
      and conkey = array[(
        select attnum
        from pg_attribute
        where attrelid = 'public.user_recovery_codes'::regclass
          and attname = 'id'
      )]::smallint[]
  ) then
    alter table public.user_recovery_codes
      add constraint user_recovery_codes_pkey primary key (id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_recovery_codes'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and conkey = array[(
        select attnum
        from pg_attribute
        where attrelid = 'public.user_recovery_codes'::regclass
          and attname = 'user_id'
      )]::smallint[]
      and confkey = array[(
        select attnum
        from pg_attribute
        where attrelid = 'auth.users'::regclass
          and attname = 'id'
      )]::smallint[]
  ) then
    alter table public.user_recovery_codes
      add constraint user_recovery_codes_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  alter table public.user_recovery_codes
    alter column id set default gen_random_uuid(),
    alter column created_at set default now();
end
$migration$;

create unique index if not exists user_recovery_codes_user_hash_key
  on public.user_recovery_codes (user_id, code_hash);
create index if not exists user_recovery_codes_unused_by_user_idx
  on public.user_recovery_codes (user_id)
  where used_at is null;

alter table public.user_recovery_codes enable row level security;
revoke all on table public.user_recovery_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.user_recovery_codes to service_role;

create table if not exists public.user_recovery_code_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  attempt_count integer not null check (attempt_count > 0),
  window_started_at timestamptz not null,
  primary key (user_id, action)
);

do $migration$
begin
  if exists (
    select 1
    from (values
      ('user_id', 'uuid', 'NO'),
      ('action', 'text', 'NO'),
      ('attempt_count', 'integer', 'NO'),
      ('window_started_at', 'timestamp with time zone', 'NO')
    ) as expected(name, data_type, is_nullable)
    where not exists (
      select 1
      from information_schema.columns as columns
      where columns.table_schema = 'public'
        and columns.table_name = 'user_recovery_code_rate_limits'
        and columns.column_name = expected.name
        and columns.data_type = expected.data_type
        and columns.is_nullable = expected.is_nullable
    )
  ) then
    raise exception
      'public.user_recovery_code_rate_limits has an incompatible or missing column.';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_recovery_code_rate_limits'::regclass
      and contype = 'p'
      and conkey <> array[
        (select attnum from pg_attribute
         where attrelid = 'public.user_recovery_code_rate_limits'::regclass and attname = 'user_id'),
        (select attnum from pg_attribute
         where attrelid = 'public.user_recovery_code_rate_limits'::regclass and attname = 'action')
      ]::smallint[]
  ) then
    raise exception
      'public.user_recovery_code_rate_limits has an incompatible primary key.';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_recovery_code_rate_limits'::regclass
      and contype = 'p'
      and conkey = array[
        (select attnum from pg_attribute
         where attrelid = 'public.user_recovery_code_rate_limits'::regclass and attname = 'user_id'),
        (select attnum from pg_attribute
         where attrelid = 'public.user_recovery_code_rate_limits'::regclass and attname = 'action')
      ]::smallint[]
  ) then
    alter table public.user_recovery_code_rate_limits
      add constraint user_recovery_code_rate_limits_pkey primary key (user_id, action);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_recovery_code_rate_limits'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and conkey = array[(
        select attnum
        from pg_attribute
        where attrelid = 'public.user_recovery_code_rate_limits'::regclass
          and attname = 'user_id'
      )]::smallint[]
      and confkey = array[(
        select attnum
        from pg_attribute
        where attrelid = 'auth.users'::regclass
          and attname = 'id'
      )]::smallint[]
  ) then
    alter table public.user_recovery_code_rate_limits
      add constraint user_recovery_code_rate_limits_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end
$migration$;

alter table public.user_recovery_code_rate_limits enable row level security;
revoke all on table public.user_recovery_code_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.user_recovery_code_rate_limits to service_role;

create or replace function public.take_recovery_code_rate_limit(
  p_user_id uuid,
  p_action text,
  p_max_attempts integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_user_id is null
    or p_action is null
    or p_action not in ('verify', 'generate', 'regenerate')
    or p_max_attempts is null
    or p_max_attempts < 1
    or p_window_seconds is null
    or p_window_seconds < 1
  then
    raise exception 'Invalid recovery-code rate-limit request.';
  end if;

  insert into public.user_recovery_code_rate_limits as current_limit (
    user_id,
    action,
    attempt_count,
    window_started_at
  )
  values (p_user_id, p_action, 1, now())
  on conflict (user_id, action) do update
  set
    attempt_count = case
      when current_limit.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else current_limit.attempt_count + 1
    end,
    window_started_at = case
      when current_limit.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else current_limit.window_started_at
    end
  returning attempt_count into v_attempt_count;

  return v_attempt_count <= p_max_attempts;
end
$function$;

create or replace function public.replace_user_recovery_codes(
  p_user_id uuid,
  p_code_hashes text[],
  p_regenerate boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_user_id is null
    or p_regenerate is null
    or coalesce(array_length(p_code_hashes, 1), 0) <> 10
    or exists (
      select 1
      from unnest(p_code_hashes) as codes(code_hash)
      where code_hash is null
        or code_hash !~ '^[0-9a-f]{64}$'
    )
    or (select count(distinct code_hash) from unnest(p_code_hashes) as codes(code_hash)) <> 10
  then
    raise exception 'Invalid recovery-code replacement request.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if not p_regenerate and exists (
    select 1
    from public.user_recovery_codes
    where user_id = p_user_id
      and used_at is null
  ) then
    return false;
  end if;

  delete from public.user_recovery_codes
  where user_id = p_user_id;

  insert into public.user_recovery_codes (user_id, code_hash)
  select p_user_id, code_hash
  from unnest(p_code_hashes) as codes(code_hash);

  return true;
end
$function$;

create or replace function public.consume_user_recovery_code(
  p_user_id uuid,
  p_code_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_user_id is null
    or p_code_hash is null
    or p_code_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Invalid recovery-code consume request.';
  end if;

  update public.user_recovery_codes
  set used_at = now()
  where user_id = p_user_id
    and code_hash = p_code_hash
    and used_at is null;

  return found;
end
$function$;

revoke all on function public.take_recovery_code_rate_limit(uuid, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.replace_user_recovery_codes(uuid, text[], boolean)
  from public, anon, authenticated;
revoke all on function public.consume_user_recovery_code(uuid, text)
  from public, anon, authenticated;
grant execute on function public.take_recovery_code_rate_limit(uuid, text, integer, integer)
  to service_role;
grant execute on function public.replace_user_recovery_codes(uuid, text[], boolean)
  to service_role;
grant execute on function public.consume_user_recovery_code(uuid, text)
  to service_role;
