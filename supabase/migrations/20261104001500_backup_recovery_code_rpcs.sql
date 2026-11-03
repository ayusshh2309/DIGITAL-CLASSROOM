-- Backup recovery-code storage and service-role-only RPCs.
-- Apply this migration once with `supabase db push`; do not also run the
-- legacy sql/user_recovery_codes.sql script.

-- Refuse incompatible objects or pre-existing browser access rather than
-- allowing CREATE TABLE IF NOT EXISTS to silently accept an unsafe object.
do $preflight$
declare
  target_table text;
  relation_kind "char";
  postgres_oid oid := to_regrole('postgres');
  service_role_oid oid := to_regrole('service_role');
begin
  if service_role_oid is null or postgres_oid is null then
    raise exception 'Expected Supabase database roles are missing.';
  end if;

  foreach target_table in array array[
    'user_recovery_codes',
    'user_recovery_code_rate_limits'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is null then
      continue;
    end if;

    select class.relkind
    into relation_kind
    from pg_class as class
    where class.oid = to_regclass(format('public.%I', target_table));

    if relation_kind <> 'r' then
      raise exception 'public.% is not an ordinary table; refusing recovery migration.', target_table;
    end if;

    if not exists (
      select 1
      from pg_class as relation
      where relation.oid = to_regclass(format('public.%I', target_table))
        and relation.relowner = postgres_oid
    ) then
      raise exception
        'public.% is not owned by postgres; review its ownership before applying this migration.',
        target_table;
    end if;

    if exists (
      select 1
      from pg_policy as policy
      where policy.polrelid = to_regclass(format('public.%I', target_table))
    ) then
      raise exception
        'public.% has an existing RLS policy; review and remove it before applying this migration.',
        target_table;
    end if;

    if exists (
      select 1
      from information_schema.table_privileges as privileges
      where privileges.table_schema = 'public'
        and privileges.table_name = target_table
        and privileges.grantee in ('PUBLIC', 'anon', 'authenticated')
      union all
      select 1
      from information_schema.column_privileges as privileges
      where privileges.table_schema = 'public'
        and privileges.table_name = target_table
        and privileges.grantee in ('PUBLIC', 'anon', 'authenticated')
    ) then
      raise exception
        'public.% has table- or column-level privileges for PUBLIC, anon, or authenticated; revoke and review those grants before applying this migration.',
        target_table;
    end if;

    if exists (
      select 1
      from pg_class as relation
      cross join lateral aclexplode(
        coalesce(relation.relacl, acldefault('r', relation.relowner))
      ) as acl
      where relation.oid = to_regclass(format('public.%I', target_table))
        and acl.privilege_type in (
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        )
        and acl.grantee not in (0, relation.relowner, service_role_oid)
    ) or exists (
      select 1
      from pg_attribute as attribute
      cross join lateral aclexplode(attribute.attacl) as acl
      where attribute.attrelid = to_regclass(format('public.%I', target_table))
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attacl is not null
        and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
        and acl.grantee not in (
          0,
          (select relowner from pg_class
           where oid = to_regclass(format('public.%I', target_table))),
          service_role_oid
        )
    ) then
      raise exception
        'public.% has a direct table or column grant to a role other than its owner or service_role; review the ACL before applying this migration.',
        target_table;
    end if;
  end loop;
end
$preflight$;

do $function_permission_preflight$
declare
  function_signature text;
  function_oid oid;
  function_row record;
begin
  foreach function_signature in array array[
    'public.take_recovery_code_rate_limit(uuid,text,integer,integer)',
    'public.replace_user_recovery_codes(uuid,text[],boolean)',
    'public.consume_user_recovery_code(uuid,text)'
  ]
  loop
    function_oid := to_regprocedure(function_signature);
    if function_oid is null then
      continue;
    end if;

    select * into function_row from pg_proc where oid = function_oid;
    if has_function_privilege('anon', function_oid, 'EXECUTE')
      or has_function_privilege('authenticated', function_oid, 'EXECUTE')
      or exists (
        select 1
        from aclexplode(coalesce(function_row.proacl, acldefault('f', function_row.proowner))) as acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee not in (function_row.proowner, to_regrole('service_role'))
      )
    then
      raise exception
        'Existing recovery RPC % has browser or non-service execution grants; review its ACLs before applying this migration.',
        function_signature;
    end if;
  end loop;
end
$function_permission_preflight$;

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
  constraint_name text;
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
      and conname = 'user_recovery_codes_pkey'
      and not (
        contype = 'p'
        and conkey = array[(
          select attnum
          from pg_attribute
          where attrelid = 'public.user_recovery_codes'::regclass
            and attname = 'id'
        )]::smallint[]
      )
  ) then
    raise exception
      'public.user_recovery_codes_pkey exists with an incompatible definition.';
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
    and contype = 'u'
    and conkey = array[
      (select attnum from pg_attribute
       where attrelid = 'public.user_recovery_codes'::regclass and attname = 'id'),
      (select attnum from pg_attribute
       where attrelid = 'public.user_recovery_codes'::regclass and attname = 'user_id')
    ]::smallint[]
  ) then
    if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_recovery_codes'::regclass
      and conname = 'user_recovery_codes_id_user_id_key'
    ) then
    raise exception
      'public.user_recovery_codes_id_user_id_key exists with an incompatible definition.';
    end if;
    alter table public.user_recovery_codes
    add constraint user_recovery_codes_id_user_id_key unique (id, user_id);
  end if;

  if exists (
    select 1
    from public.user_recovery_codes as recovery_code
    left join auth.users as auth_user on auth_user.id = recovery_code.user_id
    where auth_user.id is null
  ) then
    raise exception
    'public.user_recovery_codes contains user_id values absent from auth.users; reconcile the records before applying this migration.';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_recovery_codes'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and confdeltype = 'c'
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
    if exists (
      select 1
      from pg_constraint
      where conrelid = 'public.user_recovery_codes'::regclass
        and conname = 'user_recovery_codes_user_id_fkey'
    ) then
      raise exception
        'public.user_recovery_codes_user_id_fkey exists with an incompatible definition.';
    end if;
    alter table public.user_recovery_codes
      add constraint user_recovery_codes_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.user_recovery_codes'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.user_recovery_codes'::regclass and attname = 'user_id'
      )]::smallint[]
      and confkey = array[(
        select attnum from pg_attribute
        where attrelid = 'auth.users'::regclass and attname = 'id'
      )]::smallint[]
      and not convalidated
  loop
    execute format(
      'ALTER TABLE public.user_recovery_codes VALIDATE CONSTRAINT %I',
      constraint_name
    );
  end loop;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_recovery_codes'::regclass
    and contype = 'f'
    and conkey = array[(
      select attnum
      from pg_attribute
      where attrelid = 'public.user_recovery_codes'::regclass
        and attname = 'user_id'
    )]::smallint[]
    and (
      confrelid <> 'auth.users'::regclass
      or confkey <> array[(
        select attnum
        from pg_attribute
        where attrelid = 'auth.users'::regclass
          and attname = 'id'
      )]::smallint[]
      or confdeltype <> 'c'
    )
  ) then
    raise exception
    'public.user_recovery_codes has an incompatible user_id foreign key.';
  end if;

  alter table public.user_recovery_codes
    alter column id set default gen_random_uuid(),
    alter column created_at set default now();
end
$migration$;

do $constraint_preflight$
declare
  constraint_definition text;
begin
  if exists (
    select 1
    from public.user_recovery_codes
    where code_hash !~ '^[0-9a-f]{64}$'
  ) then
    raise exception
      'public.user_recovery_codes contains hashes that are not 64-character lowercase hexadecimal values; reconcile the records before applying this migration.';
  end if;

  select pg_get_constraintdef(oid)
  into constraint_definition
  from pg_constraint
  where conrelid = 'public.user_recovery_codes'::regclass
    and conname = 'user_recovery_codes_code_hash_check';

  if constraint_definition is not null
    and constraint_definition <> 'CHECK ((code_hash ~ ''^[0-9a-f]{64}$''::text))'
  then
    raise exception
    'public.user_recovery_codes.user_recovery_codes_code_hash_check is incompatible; review it before applying this migration.';
  end if;

  if constraint_definition is null then
    if exists (
    select 1
    from public.user_recovery_codes
    where code_hash !~ '^[0-9a-f]{64}$'
    ) then
    raise exception
      'public.user_recovery_codes contains hashes that are not 64-character lowercase hexadecimal values; reconcile the data before applying this migration.';
    end if;

    alter table public.user_recovery_codes
    add constraint user_recovery_codes_code_hash_check
    check (code_hash ~ '^[0-9a-f]{64}$');
  elsif not (
    select convalidated
    from pg_constraint
    where conrelid = 'public.user_recovery_codes'::regclass
      and conname = 'user_recovery_codes_code_hash_check'
  ) then
    alter table public.user_recovery_codes
      validate constraint user_recovery_codes_code_hash_check;
  end if;

  if exists (
    select 1
    from public.user_recovery_codes
    group by user_id, code_hash
    having count(*) > 1
  ) then
    raise exception
    'public.user_recovery_codes contains duplicate user/hash pairs; reconcile the records before creating the unique index.';
  end if;
end
$constraint_preflight$;

do $index_preflight$
declare
  index_oid oid;
begin
  index_oid := to_regclass('public.user_recovery_codes_user_hash_key');
  if index_oid is not null and not exists (
    select 1
    from pg_index as index_info
    where index_info.indexrelid = index_oid
    and index_info.indrelid = 'public.user_recovery_codes'::regclass
    and index_info.indisunique
    and index_info.indisvalid
    and index_info.indnkeyatts = 2
    and pg_get_indexdef(index_info.indexrelid) ilike '%(user_id, code_hash)%'
  ) then
    raise exception
    'public.user_recovery_codes_user_hash_key exists with an incompatible definition.';
  end if;

  index_oid := to_regclass('public.user_recovery_codes_unused_by_user_idx');
  if index_oid is not null and not exists (
    select 1
    from pg_index as index_info
    where index_info.indexrelid = index_oid
    and index_info.indrelid = 'public.user_recovery_codes'::regclass
    and not index_info.indisunique
    and index_info.indisvalid
    and index_info.indnkeyatts = 1
    and pg_get_indexdef(index_info.indexrelid) ilike '%(user_id) WHERE (used_at IS NULL)%'
  ) then
    raise exception
    'public.user_recovery_codes_unused_by_user_idx exists with an incompatible definition.';
  end if;
end
$index_preflight$;

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
declare
  constraint_name text;
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
      and conname = 'user_recovery_code_rate_limits_pkey'
      and not (
        contype = 'p'
        and conkey = array[
          (select attnum from pg_attribute
           where attrelid = 'public.user_recovery_code_rate_limits'::regclass and attname = 'user_id'),
          (select attnum from pg_attribute
           where attrelid = 'public.user_recovery_code_rate_limits'::regclass and attname = 'action')
        ]::smallint[]
      )
  ) then
    raise exception
      'public.user_recovery_code_rate_limits_pkey exists with an incompatible definition.';
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
      and confkey = array[(
        select attnum from pg_attribute
        where attrelid = 'auth.users'::regclass and attname = 'id'
      )]::smallint[]
      and confdeltype = 'c'
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
    if exists (
      select 1
      from pg_constraint
      where conrelid = 'public.user_recovery_code_rate_limits'::regclass
        and conname = 'user_recovery_code_rate_limits_user_id_fkey'
    ) then
      raise exception
        'public.user_recovery_code_rate_limits_user_id_fkey exists with an incompatible definition.';
    end if;
    alter table public.user_recovery_code_rate_limits
      add constraint user_recovery_code_rate_limits_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if exists (
    select 1
    from public.user_recovery_code_rate_limits as rate_limit
    left join auth.users as auth_user on auth_user.id = rate_limit.user_id
    where auth_user.id is null
  ) then
    raise exception
      'public.user_recovery_code_rate_limits contains user_id values absent from auth.users; reconcile the records before applying this migration.';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_recovery_code_rate_limits'::regclass
      and contype = 'f'
      and conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.user_recovery_code_rate_limits'::regclass
          and attname = 'user_id'
      )]::smallint[]
      and (
        confrelid <> 'auth.users'::regclass
        or confdeltype <> 'c'
      )
  ) then
    raise exception
      'public.user_recovery_code_rate_limits has an incompatible user_id foreign key.';
  end if;

  if exists (
    select 1
    from public.user_recovery_code_rate_limits
    where attempt_count <= 0
       or action not in ('verify', 'generate', 'regenerate')
  ) then
    raise exception
      'public.user_recovery_code_rate_limits contains invalid attempts or actions; reconcile the records before applying this migration.';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_recovery_code_rate_limits'::regclass
      and conname = 'user_recovery_code_rate_limits_attempt_count_check'
      and contype = 'c'
      and pg_get_constraintdef(oid) = 'CHECK ((attempt_count > 0))'
  ) then
    if exists (
      select 1
      from pg_constraint
      where conrelid = 'public.user_recovery_code_rate_limits'::regclass
        and conname = 'user_recovery_code_rate_limits_attempt_count_check'
    ) then
      raise exception
        'public.user_recovery_code_rate_limits_attempt_count_check exists with an incompatible definition.';
    end if;
    alter table public.user_recovery_code_rate_limits
      add constraint user_recovery_code_rate_limits_attempt_count_check
      check (attempt_count > 0);
  end if;

  if not (
    select convalidated
    from pg_constraint
    where conrelid = 'public.user_recovery_code_rate_limits'::regclass
      and conname = 'user_recovery_code_rate_limits_attempt_count_check'
      and contype = 'c'
  ) then
    alter table public.user_recovery_code_rate_limits
      validate constraint user_recovery_code_rate_limits_attempt_count_check;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_recovery_code_rate_limits'::regclass
      and conname = 'user_recovery_code_rate_limits_action_check'
      and contype = 'c'
      and pg_get_constraintdef(oid) =
        'CHECK ((action = ANY (ARRAY[''verify''::text, ''generate''::text, ''regenerate''::text])))'
  ) then
    if exists (
      select 1
      from pg_constraint
      where conrelid = 'public.user_recovery_code_rate_limits'::regclass
        and conname = 'user_recovery_code_rate_limits_action_check'
    ) then
      raise exception
        'public.user_recovery_code_rate_limits_action_check exists with an incompatible definition.';
    end if;
    alter table public.user_recovery_code_rate_limits
      add constraint user_recovery_code_rate_limits_action_check
      check (action in ('verify', 'generate', 'regenerate'));
  end if;

  if not (
    select convalidated
    from pg_constraint
    where conrelid = 'public.user_recovery_code_rate_limits'::regclass
      and conname = 'user_recovery_code_rate_limits_action_check'
      and contype = 'c'
  ) then
    alter table public.user_recovery_code_rate_limits
      validate constraint user_recovery_code_rate_limits_action_check;
  end if;

  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.user_recovery_code_rate_limits'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.user_recovery_code_rate_limits'::regclass
          and attname = 'user_id'
      )]::smallint[]
      and confkey = array[(
        select attnum from pg_attribute
        where attrelid = 'auth.users'::regclass
          and attname = 'id'
      )]::smallint[]
      and not convalidated
  loop
    execute format(
      'ALTER TABLE public.user_recovery_code_rate_limits VALIDATE CONSTRAINT %I',
      constraint_name
    );
  end loop;
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

do $security_audit$
declare
  target_table text;
  table_oid oid;
  function_signature text;
  function_oid oid;
  function_row record;
  grant_row record;
  service_role_oid oid := to_regrole('service_role');
  postgres_oid oid := to_regrole('postgres');
begin
  if service_role_oid is null
    or postgres_oid is null
    or to_regrole('anon') is null
    or to_regrole('authenticated') is null
    or to_regrole('postgres') is null
  then
    raise exception
      'Expected Supabase database roles are missing; recovery migration permissions cannot be verified.';
  end if;

  if pg_has_role('anon', service_role_oid, 'member')
    or pg_has_role('authenticated', service_role_oid, 'member')
  then
    raise exception
      'Browser roles inherit service_role privileges; remove that membership before enabling recovery functions.';
  end if;

  foreach target_table in array array[
    'user_recovery_codes',
    'user_recovery_code_rate_limits'
  ]
  loop
    table_oid := to_regclass(format('public.%I', target_table));

    if not coalesce((select relrowsecurity from pg_class where oid = table_oid), false) then
      raise exception 'RLS is not enabled on public.%.', target_table;
    end if;

    if not exists (
      select 1 from pg_class where oid = table_oid and relowner = postgres_oid
    ) then
      raise exception 'public.% is not owned by postgres.', target_table;
    end if;

    if has_table_privilege('anon', table_oid, 'SELECT')
      or has_table_privilege('anon', table_oid, 'INSERT')
      or has_table_privilege('anon', table_oid, 'UPDATE')
      or has_table_privilege('anon', table_oid, 'DELETE')
      or has_table_privilege('authenticated', table_oid, 'SELECT')
      or has_table_privilege('authenticated', table_oid, 'INSERT')
      or has_table_privilege('authenticated', table_oid, 'UPDATE')
      or has_table_privilege('authenticated', table_oid, 'DELETE')
      or has_table_privilege('service_role', table_oid, 'SELECT') is false
      or has_table_privilege('service_role', table_oid, 'INSERT') is false
      or has_table_privilege('service_role', table_oid, 'UPDATE') is false
      or has_table_privilege('service_role', table_oid, 'DELETE') is false
    then
      raise exception 'Unexpected table privileges remain on public.%.', target_table;
    end if;

    if exists (
      select 1
      from information_schema.column_privileges as privileges
      where privileges.table_schema = 'public'
        and privileges.table_name = target_table
        and privileges.grantee in ('PUBLIC', 'anon', 'authenticated')
    ) then
      raise exception 'Browser roles retain column privileges on public.%.', target_table;
    end if;

    if exists (
      select 1
      from pg_policy as policy
      where policy.polrelid = table_oid
    ) then
      raise exception 'An unexpected RLS policy remains on public.%.', target_table;
    end if;
  end loop;

  foreach function_signature in array array[
    'public.take_recovery_code_rate_limit(uuid,text,integer,integer)',
    'public.replace_user_recovery_codes(uuid,text[],boolean)',
    'public.consume_user_recovery_code(uuid,text)'
  ]
  loop
    function_oid := to_regprocedure(function_signature);
    if function_oid is null then
      raise exception 'Expected recovery RPC % was not created.', function_signature;
    end if;

    execute format('ALTER FUNCTION %s OWNER TO postgres', function_oid::regprocedure);

    select * into function_row from pg_proc where oid = function_oid;
    if not function_row.prosecdef
      or not coalesce(function_row.proconfig @> array['search_path=""'], false)
      or function_row.prosrc not ilike '%auth.role()%'
      or function_row.prosrc not ilike '%service_role%'
    then
      raise exception
        'Recovery RPC % lacks SECURITY DEFINER, an empty search_path, or a service_role guard.',
        function_signature;
    end if;

    for grant_row in
      select distinct acl.grantee
      from aclexplode(coalesce(function_row.proacl, acldefault('f', function_row.proowner))) as acl
      where acl.privilege_type = 'EXECUTE'
        and acl.grantee not in (0, function_row.proowner, service_role_oid)
    loop
      execute format(
        'REVOKE ALL ON FUNCTION %s FROM %I',
        function_oid::regprocedure,
        (select rolname from pg_roles where oid = grant_row.grantee)
      );
    end loop;

    execute format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      function_oid::regprocedure
    );
    execute format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      function_oid::regprocedure
    );

    if has_function_privilege('anon', function_oid, 'EXECUTE')
      or has_function_privilege('authenticated', function_oid, 'EXECUTE')
      or not has_function_privilege('service_role', function_oid, 'EXECUTE')
    then
      raise exception 'Recovery RPC % has unsafe execution grants.', function_signature;
    end if;
  end loop;
end
$security_audit$;
