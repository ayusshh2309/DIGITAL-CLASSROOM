-- Expiring, user-bound recovery transactions. Apply after
-- 20261104001500_backup_recovery_code_rpcs.sql.
-- A recovery code is consumed only after Supabase has verified a replacement
-- TOTP factor and issued an AAL2 session. Completion is claimed atomically
-- before factor removal so cancellation cannot race the external Auth call.

-- This migration must follow 01500. Refuse existing browser-facing policies
-- or grants and incompatible relation kinds before touching any object.
do $preflight$
declare
  relation_kind "char";
  service_role_oid oid := to_regrole('service_role');
  postgres_oid oid := to_regrole('postgres');
begin
  if service_role_oid is null or postgres_oid is null then
    raise exception 'Expected Supabase database roles are missing.';
  end if;

  if to_regclass('public.user_recovery_codes') is null
    or to_regclass('public.user_recovery_code_rate_limits') is null
  then
    raise exception
      'Recovery-code base tables are missing; apply 20261104001500_backup_recovery_code_rpcs.sql first.';
  end if;

  if to_regclass('public.user_recovery_transactions') is not null then
    select class.relkind
    into relation_kind
    from pg_class as class
    where class.oid = to_regclass('public.user_recovery_transactions');

    if relation_kind <> 'r' then
      raise exception
        'public.user_recovery_transactions is not an ordinary table; refusing recovery migration.';
    end if;

    if not exists (
      select 1
      from pg_class as relation
      where relation.oid = 'public.user_recovery_transactions'::regclass
        and relation.relowner = postgres_oid
    ) then
      raise exception
        'public.user_recovery_transactions is not owned by postgres; review its ownership before applying this migration.';
    end if;

    if exists (
      select 1
      from pg_policy as policy
      where policy.polrelid = 'public.user_recovery_transactions'::regclass
    ) then
      raise exception
        'public.user_recovery_transactions has an existing RLS policy; review and remove it before applying this migration.';
    end if;

    if exists (
      select 1
      from information_schema.table_privileges as privileges
      where privileges.table_schema = 'public'
        and privileges.table_name = 'user_recovery_transactions'
        and privileges.grantee in ('PUBLIC', 'anon', 'authenticated')
      union all
      select 1
      from information_schema.column_privileges as privileges
      where privileges.table_schema = 'public'
        and privileges.table_name = 'user_recovery_transactions'
        and privileges.grantee in ('PUBLIC', 'anon', 'authenticated')
    ) then
      raise exception
        'public.user_recovery_transactions has table- or column-level privileges for PUBLIC, anon, or authenticated; revoke and review those grants before applying this migration.';
    end if;

    if exists (
      select 1
      from pg_class as relation
      cross join lateral aclexplode(
        coalesce(relation.relacl, acldefault('r', relation.relowner))
      ) as acl
      where relation.oid = 'public.user_recovery_transactions'::regclass
        and acl.privilege_type in (
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        )
        and acl.grantee not in (0, relation.relowner, service_role_oid)
    ) or exists (
      select 1
      from pg_attribute as attribute
      cross join lateral aclexplode(attribute.attacl) as acl
      where attribute.attrelid = 'public.user_recovery_transactions'::regclass
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attacl is not null
        and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
        and acl.grantee not in (
          0,
          (select relowner from pg_class
           where oid = 'public.user_recovery_transactions'::regclass),
          service_role_oid
        )
    ) then
      raise exception
        'public.user_recovery_transactions has a direct table or column grant to a role other than its owner or service_role; review the ACL before applying this migration.';
    end if;
  end if;

  if to_regprocedure('public.claim_user_recovery_completion(uuid,text)') is not null then
    raise exception
      'Legacy public.claim_user_recovery_completion(uuid,text) exists. Review and revoke that overload explicitly before applying this migration; no function will be dropped automatically.';
  end if;
end
$preflight$;

do $base_table_preflight$
declare
  target_table text;
  table_oid oid;
  service_role_oid oid := to_regrole('service_role');
  postgres_oid oid := to_regrole('postgres');
begin
  foreach target_table in array array[
    'user_recovery_codes',
    'user_recovery_code_rate_limits'
  ]
  loop
    table_oid := to_regclass(format('public.%I', target_table));

    if not exists (
      select 1 from pg_class where oid = table_oid and relowner = postgres_oid
    ) then
      raise exception 'public.% is not owned by postgres.', target_table;
    end if;

    if exists (
      select 1
      from pg_policy as policy
      where policy.polrelid = table_oid
    ) then
      raise exception
        'public.% has an unexpected RLS policy; review it before applying the recovery transaction migration.',
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
        'public.% has browser table or column grants; review its ACL before applying the recovery transaction migration.',
        target_table;
    end if;

    if exists (
      select 1
      from pg_class as relation
      cross join lateral aclexplode(
        coalesce(relation.relacl, acldefault('r', relation.relowner))
      ) as acl
      where relation.oid = table_oid
        and acl.privilege_type in (
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        )
        and acl.grantee not in (0, relation.relowner, service_role_oid)
    ) or exists (
      select 1
      from pg_attribute as attribute
      cross join lateral aclexplode(attribute.attacl) as acl
      where attribute.attrelid = table_oid
        and attribute.attnum > 0
        and not attribute.attisdropped
        and attribute.attacl is not null
        and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
        and acl.grantee not in (
          0,
          (select relowner from pg_class where oid = table_oid),
          service_role_oid
        )
    ) then
      raise exception
        'public.% has a direct table or column grant to a role other than its owner or service_role; review the ACL before applying the recovery transaction migration.',
        target_table;
    end if;
  end loop;
end
$base_table_preflight$;

do $function_permission_preflight$
declare
  function_signature text;
  function_oid oid;
  function_row record;
begin
  foreach function_signature in array array[
    'public.get_user_recovery_transaction(uuid,text)',
    'public.begin_user_recovery_transaction(uuid,text,text,uuid[])',
    'public.claim_user_recovery_completion(uuid,text,uuid)',
    'public.complete_user_recovery_transaction(uuid,text,uuid)',
    'public.cancel_user_recovery_transaction(uuid,text)',
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

create table if not exists public.user_recovery_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  recovery_code_id uuid not null,
  transaction_token_hash text not null unique,
  prior_factor_ids uuid[] not null default '{}'::uuid[],
  replacement_factor_id uuid,
  completion_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  constraint user_recovery_transactions_code_id_key unique (recovery_code_id),
  constraint user_recovery_transactions_expiry_check check (expires_at > created_at),
  constraint user_recovery_transactions_completion_check_v2 check (
    (
      completed_at is null
      and (
        (completion_claimed_at is null and replacement_factor_id is null)
        or (completion_claimed_at is not null and replacement_factor_id is not null)
      )
    )
    or (
      completed_at is not null
      and completion_claimed_at is not null
      and replacement_factor_id is not null
    )
  )
);

alter table public.user_recovery_transactions
  add column if not exists completion_claimed_at timestamptz;

do $migration$
declare
  expected_column record;
  actual_type text;
  is_nullable text;
  constraint_definition text;
  constraint_name text;
begin
  for expected_column in
    select *
    from (values
      ('id', 'uuid', 'NO'),
      ('user_id', 'uuid', 'NO'),
      ('recovery_code_id', 'uuid', 'NO'),
      ('transaction_token_hash', 'text', 'NO'),
      ('prior_factor_ids', 'ARRAY', 'NO'),
      ('replacement_factor_id', 'uuid', 'YES'),
      ('completion_claimed_at', 'timestamp with time zone', 'YES'),
      ('created_at', 'timestamp with time zone', 'NO'),
      ('expires_at', 'timestamp with time zone', 'NO'),
      ('completed_at', 'timestamp with time zone', 'YES')
    ) as expected(name, data_type, is_nullable)
  loop
    select columns.data_type, columns.is_nullable
    into actual_type, is_nullable
    from information_schema.columns as columns
    where columns.table_schema = 'public'
      and columns.table_name = 'user_recovery_transactions'
      and columns.column_name = expected_column.name;

    if not found
      or actual_type <> expected_column.data_type
      or is_nullable <> expected_column.is_nullable
    then
      raise exception
        'public.user_recovery_transactions has an incompatible or missing column: %.',
        expected_column.name;
    end if;
  end loop;

  if exists (
    select 1
    from public.user_recovery_transactions as recovery_transaction
    left join public.user_recovery_codes as recovery_code
      on recovery_code.id = recovery_transaction.recovery_code_id
     and recovery_code.user_id = recovery_transaction.user_id
    where recovery_code.id is null
       or recovery_transaction.transaction_token_hash !~ '^[0-9a-f]{64}$'
       or recovery_transaction.expires_at <= recovery_transaction.created_at
       or not (
         (
           recovery_transaction.completed_at is null
           and (
             (
               recovery_transaction.completion_claimed_at is null
               and recovery_transaction.replacement_factor_id is null
             )
             or (
               recovery_transaction.completion_claimed_at is not null
               and recovery_transaction.replacement_factor_id is not null
             )
           )
         )
         or (
           recovery_transaction.completed_at is not null
           and recovery_transaction.completion_claimed_at is not null
           and recovery_transaction.replacement_factor_id is not null
         )
       )
  ) then
    raise exception
      'public.user_recovery_transactions contains rows violating ownership, token, expiry, or completion invariants; reconcile them without deleting data before applying this migration.';
  end if;

  if exists (
    select 1
    from public.user_recovery_transactions
    group by transaction_token_hash
    having count(*) > 1
  ) or exists (
    select 1
    from public.user_recovery_transactions
    group by recovery_code_id
    having count(*) > 1
  ) then
    raise exception
      'public.user_recovery_transactions contains duplicate tokens or recovery-code references; reconcile the records before applying this migration.';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_recovery_transactions'::regclass
      and conname = 'user_recovery_transactions_pkey'
      and not (
        contype = 'p'
        and conkey = array[(
          select attnum from pg_attribute
          where attrelid = 'public.user_recovery_transactions'::regclass
            and attname = 'id'
        )]::smallint[]
      )
  ) then
    raise exception
      'public.user_recovery_transactions_pkey exists with an incompatible definition.';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_recovery_transactions'::regclass
      and contype = 'p'
      and conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.user_recovery_transactions'::regclass
          and attname = 'id'
      )]::smallint[]
  ) then
    if exists (
      select 1
      from pg_constraint
      where conrelid = 'public.user_recovery_transactions'::regclass
        and contype = 'p'
    ) then
      raise exception
        'public.user_recovery_transactions has an incompatible primary key.';
    end if;
    alter table public.user_recovery_transactions
      add constraint user_recovery_transactions_pkey primary key (id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_recovery_transactions'::regclass
      and contype = 'f'
      and conname = 'user_recovery_transactions_user_id_fkey'
      and confrelid = 'auth.users'::regclass
      and conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.user_recovery_transactions'::regclass
          and attname = 'user_id'
      )]::smallint[]
      and confkey = array[(
        select attnum from pg_attribute
        where attrelid = 'auth.users'::regclass
          and attname = 'id'
      )]::smallint[]
      and confdeltype = 'c'
  ) then
    if exists (
      select 1 from pg_constraint
      where conrelid = 'public.user_recovery_transactions'::regclass
        and conname = 'user_recovery_transactions_user_id_fkey'
    ) then
      raise exception
        'public.user_recovery_transactions_user_id_fkey exists with an incompatible definition.';
    end if;
    alter table public.user_recovery_transactions
      add constraint user_recovery_transactions_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_recovery_transactions'::regclass
      and contype = 'f'
      and conname = 'user_recovery_transactions_recovery_code_owner_fkey'
      and confrelid = 'public.user_recovery_codes'::regclass
      and conkey = array[
        (select attnum from pg_attribute
         where attrelid = 'public.user_recovery_transactions'::regclass
           and attname = 'recovery_code_id'),
        (select attnum from pg_attribute
         where attrelid = 'public.user_recovery_transactions'::regclass
           and attname = 'user_id')
      ]::smallint[]
      and confkey = array[
        (select attnum from pg_attribute
         where attrelid = 'public.user_recovery_codes'::regclass
           and attname = 'id'),
        (select attnum from pg_attribute
         where attrelid = 'public.user_recovery_codes'::regclass
           and attname = 'user_id')
      ]::smallint[]
      and confdeltype = 'c'
  ) then
    if exists (
      select 1 from pg_constraint
      where conrelid = 'public.user_recovery_transactions'::regclass
        and conname = 'user_recovery_transactions_recovery_code_owner_fkey'
    ) then
      raise exception
        'public.user_recovery_transactions_recovery_code_owner_fkey exists with an incompatible definition.';
    end if;
    alter table public.user_recovery_transactions
      add constraint user_recovery_transactions_recovery_code_owner_fkey
      foreign key (recovery_code_id, user_id)
      references public.user_recovery_codes (id, user_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_recovery_transactions'::regclass
      and contype = 'u'
      and conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.user_recovery_transactions'::regclass
          and attname = 'transaction_token_hash'
      )]::smallint[]
  ) then
    if exists (
      select 1 from pg_constraint
      where conrelid = 'public.user_recovery_transactions'::regclass
        and conname = 'user_recovery_transactions_token_hash_key'
    ) then
      raise exception
        'public.user_recovery_transactions_token_hash_key exists with an incompatible definition.';
    end if;
    alter table public.user_recovery_transactions
      add constraint user_recovery_transactions_token_hash_key
      unique (transaction_token_hash);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_recovery_transactions'::regclass
      and contype = 'u'
      and conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.user_recovery_transactions'::regclass
          and attname = 'recovery_code_id'
      )]::smallint[]
  ) then
    if exists (
      select 1 from pg_constraint
      where conrelid = 'public.user_recovery_transactions'::regclass
        and conname = 'user_recovery_transactions_code_id_key'
    ) then
      raise exception
        'public.user_recovery_transactions_code_id_key exists with an incompatible definition.';
    end if;
    alter table public.user_recovery_transactions
      add constraint user_recovery_transactions_code_id_key
      unique (recovery_code_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_recovery_transactions'::regclass
      and conname = 'user_recovery_transactions_expiry_check'
      and contype = 'c'
      and pg_get_constraintdef(oid) = 'CHECK ((expires_at > created_at))'
  ) then
    if exists (
      select 1 from pg_constraint
      where conrelid = 'public.user_recovery_transactions'::regclass
        and conname = 'user_recovery_transactions_expiry_check'
    ) then
      raise exception
        'public.user_recovery_transactions_expiry_check exists with an incompatible definition.';
    end if;
    alter table public.user_recovery_transactions
      add constraint user_recovery_transactions_expiry_check
      check (expires_at > created_at);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_recovery_transactions'::regclass
      and conname = 'user_recovery_transactions_token_hash_check'
      and contype = 'c'
      and pg_get_constraintdef(oid) =
        'CHECK ((transaction_token_hash ~ ''^[0-9a-f]{64}$''::text))'
  ) then
    if exists (
      select 1 from pg_constraint
      where conrelid = 'public.user_recovery_transactions'::regclass
        and conname = 'user_recovery_transactions_token_hash_check'
    ) then
      raise exception
        'public.user_recovery_transactions_token_hash_check exists with an incompatible definition.';
    end if;
    alter table public.user_recovery_transactions
      add constraint user_recovery_transactions_token_hash_check
      check (transaction_token_hash ~ '^[0-9a-f]{64}$');
  end if;

  select pg_get_constraintdef(oid)
  into constraint_definition
  from pg_constraint
  where conrelid = 'public.user_recovery_transactions'::regclass
    and conname = 'user_recovery_transactions_completion_check_v2';

  if found and constraint_definition <>
    'CHECK ((((completed_at IS NULL) AND (((completion_claimed_at IS NULL) AND (replacement_factor_id IS NULL)) OR ((completion_claimed_at IS NOT NULL) AND (replacement_factor_id IS NOT NULL)))) OR ((completed_at IS NOT NULL) AND (completion_claimed_at IS NOT NULL) AND (replacement_factor_id IS NOT NULL))))'
  then
    raise exception
      'public.user_recovery_transactions_completion_check_v2 exists with an incompatible definition.';
  end if;

  if not found then
    alter table public.user_recovery_transactions
      add constraint user_recovery_transactions_completion_check_v2
      check (
        (
          completed_at is null
          and (
            (completion_claimed_at is null and replacement_factor_id is null)
            or (completion_claimed_at is not null and replacement_factor_id is not null)
          )
        )
        or (
          completed_at is not null
          and completion_claimed_at is not null
          and replacement_factor_id is not null
        )
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_recovery_transactions'::regclass
      and conname = 'user_recovery_transactions_completion_check_v2'
      and contype = 'c'
      and convalidated
  ) then
    alter table public.user_recovery_transactions
      validate constraint user_recovery_transactions_completion_check_v2;
  end if;

  foreach constraint_name in array array[
    'user_recovery_transactions_user_id_fkey',
    'user_recovery_transactions_recovery_code_owner_fkey'
  ]
  loop
    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.user_recovery_transactions'::regclass
        and conname = constraint_name
        and convalidated
    ) then
      execute format(
        'ALTER TABLE public.user_recovery_transactions VALIDATE CONSTRAINT %I',
        constraint_name
      );
    end if;
  end loop;

  foreach constraint_name in array array[
    'user_recovery_transactions_expiry_check',
    'user_recovery_transactions_token_hash_check',
    'user_recovery_transactions_completion_check_v2'
  ]
  loop
    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.user_recovery_transactions'::regclass
        and conname = constraint_name
        and convalidated
    ) then
      execute format(
        'ALTER TABLE public.user_recovery_transactions VALIDATE CONSTRAINT %I',
        constraint_name
      );
    end if;
  end loop;

  alter table public.user_recovery_transactions
    alter column id set default gen_random_uuid(),
    alter column prior_factor_ids set default '{}'::uuid[],
    alter column created_at set default now();
end
$migration$;

do $index_preflight$
declare
  index_oid oid := to_regclass('public.user_recovery_transactions_pending_by_user_idx');
begin
  if index_oid is not null and not exists (
    select 1
    from pg_index as index_info
    where index_info.indexrelid = index_oid
      and index_info.indrelid = 'public.user_recovery_transactions'::regclass
      and not index_info.indisunique
      and index_info.indisvalid
      and index_info.indnkeyatts = 2
      and pg_get_indexdef(index_info.indexrelid)
        ilike '%(user_id, expires_at) WHERE (completed_at IS NULL)%'
  ) then
    raise exception
      'public.user_recovery_transactions_pending_by_user_idx exists with an incompatible definition.';
  end if;
end
$index_preflight$;

create index if not exists user_recovery_transactions_pending_by_user_idx
  on public.user_recovery_transactions (user_id, expires_at)
  where completed_at is null;

alter table public.user_recovery_transactions enable row level security;
revoke all on table public.user_recovery_transactions from public, anon, authenticated;
grant select, insert, update, delete on table public.user_recovery_transactions to service_role;

create or replace function public.get_user_recovery_transaction(
  p_user_id uuid,
  p_transaction_token_hash text
)
returns table (
  found boolean,
  completed boolean,
  expires_at timestamptz,
  replacement_factor_id uuid,
  prior_factor_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_user_id is null
    or p_transaction_token_hash is null
    or p_transaction_token_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Invalid recovery transaction lookup request.';
  end if;

  return query
    select
      true,
      recovery_transaction.completed_at is not null,
      recovery_transaction.expires_at,
      recovery_transaction.replacement_factor_id,
      recovery_transaction.prior_factor_ids
    from public.user_recovery_transactions as recovery_transaction
    where recovery_transaction.user_id = p_user_id
      and recovery_transaction.transaction_token_hash = p_transaction_token_hash;

  if not found then
    return query select false, false, null::timestamptz, null::uuid, '{}'::uuid[];
  end if;
end
$function$;

create or replace function public.begin_user_recovery_transaction(
  p_user_id uuid,
  p_code_hash text,
  p_transaction_token_hash text,
  p_prior_factor_ids uuid[]
)
returns table (started boolean, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_code_id uuid;
  v_expires_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_user_id is null
    or p_code_hash is null
    or p_code_hash !~ '^[0-9a-f]{64}$'
    or p_transaction_token_hash is null
    or p_transaction_token_hash !~ '^[0-9a-f]{64}$'
    or p_prior_factor_ids is null
    or cardinality(p_prior_factor_ids) > 10
    or exists (
      select 1
      from unnest(p_prior_factor_ids) as factor_ids(factor_id)
      where factor_id is null
    )
  then
    raise exception 'Invalid recovery transaction request.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  delete from public.user_recovery_transactions as recovery_transaction
  where recovery_transaction.user_id = p_user_id
    and recovery_transaction.completed_at is null
    and (
      (
        recovery_transaction.completion_claimed_at is null
        and recovery_transaction.expires_at <= now()
      )
      or recovery_transaction.completion_claimed_at <= now() - interval '15 minutes'
    );

  if exists (
    select 1
    from public.user_recovery_transactions as recovery_transaction
    where recovery_transaction.user_id = p_user_id
      and recovery_transaction.completed_at is null
      and (
        recovery_transaction.completion_claimed_at > now() - interval '15 minutes'
        or recovery_transaction.expires_at > now()
      )
  ) then
    return query select false, null::timestamptz;
    return;
  end if;

  select recovery_code.id
  into v_code_id
  from public.user_recovery_codes as recovery_code
  where recovery_code.user_id = p_user_id
    and recovery_code.code_hash = p_code_hash
    and recovery_code.used_at is null
  for update;

  if not found then
    return query select false, null::timestamptz;
    return;
  end if;

  if exists (
    select 1
    from public.user_recovery_transactions as recovery_transaction
    where recovery_transaction.recovery_code_id = v_code_id
      and recovery_transaction.completed_at is null
      and recovery_transaction.expires_at > now()
  ) then
    return query select false, null::timestamptz;
    return;
  end if;

  v_expires_at := now() + interval '15 minutes';
  insert into public.user_recovery_transactions (
    user_id,
    recovery_code_id,
    transaction_token_hash,
    prior_factor_ids,
    expires_at
  )
  values (
    p_user_id,
    v_code_id,
    p_transaction_token_hash,
    p_prior_factor_ids,
    v_expires_at
  );

  return query select true, v_expires_at;
end
$function$;

create or replace function public.claim_user_recovery_completion(
  p_user_id uuid,
  p_transaction_token_hash text,
  p_replacement_factor_id uuid
)
returns table (
  claimed boolean,
  already_completed boolean,
  expires_at timestamptz,
  replacement_factor_id uuid,
  prior_factor_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_transaction public.user_recovery_transactions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_user_id is null
    or p_transaction_token_hash is null
    or p_transaction_token_hash !~ '^[0-9a-f]{64}$'
    or p_replacement_factor_id is null
  then
    raise exception 'Invalid recovery transaction completion claim.';
  end if;

  select recovery_transaction.*
  into v_transaction
  from public.user_recovery_transactions as recovery_transaction
  where recovery_transaction.user_id = p_user_id
    and recovery_transaction.transaction_token_hash = p_transaction_token_hash
  for update;

  if not found then
    return query select false, false, null::timestamptz, null::uuid, '{}'::uuid[];
    return;
  end if;

  if v_transaction.completed_at is not null then
    return query
      select
        v_transaction.replacement_factor_id = p_replacement_factor_id,
        true,
        v_transaction.expires_at,
        v_transaction.replacement_factor_id,
        v_transaction.prior_factor_ids;
    return;
  end if;

  if v_transaction.completion_claimed_at is null then
    if v_transaction.expires_at <= now() then
      return query
        select
          false,
          false,
          v_transaction.expires_at,
          null::uuid,
          v_transaction.prior_factor_ids;
      return;
    end if;

    update public.user_recovery_transactions as recovery_transaction
    set
      completion_claimed_at = now(),
      replacement_factor_id = p_replacement_factor_id
    where recovery_transaction.id = v_transaction.id;
  elsif v_transaction.completion_claimed_at <= now() - interval '15 minutes' then
    return query
      select
        false,
        false,
        v_transaction.expires_at,
        null::uuid,
        v_transaction.prior_factor_ids;
    return;
  elsif v_transaction.replacement_factor_id is distinct from p_replacement_factor_id then
    return query
      select
        false,
        false,
        v_transaction.expires_at,
        v_transaction.replacement_factor_id,
        v_transaction.prior_factor_ids;
    return;
  end if;

  return query
    select
      true,
      false,
      v_transaction.expires_at,
      p_replacement_factor_id,
      v_transaction.prior_factor_ids;
end
$function$;

create or replace function public.complete_user_recovery_transaction(
  p_user_id uuid,
  p_transaction_token_hash text,
  p_replacement_factor_id uuid
)
returns table (completed boolean, old_factor_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_transaction public.user_recovery_transactions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_user_id is null
    or p_transaction_token_hash is null
    or p_transaction_token_hash !~ '^[0-9a-f]{64}$'
    or p_replacement_factor_id is null
  then
    raise exception 'Invalid recovery transaction completion request.';
  end if;

  select recovery_transaction.*
  into v_transaction
  from public.user_recovery_transactions as recovery_transaction
  where recovery_transaction.user_id = p_user_id
    and recovery_transaction.transaction_token_hash = p_transaction_token_hash
  for update;

  if not found then
    return query select false, '{}'::uuid[];
    return;
  end if;

  if v_transaction.completed_at is not null then
    return query
      select
        v_transaction.replacement_factor_id = p_replacement_factor_id,
        v_transaction.prior_factor_ids;
    return;
  end if;

  if v_transaction.completion_claimed_at is null
    or v_transaction.completion_claimed_at <= now() - interval '15 minutes'
    or v_transaction.expires_at <= now()
    or v_transaction.replacement_factor_id is distinct from p_replacement_factor_id
    or p_replacement_factor_id = any(v_transaction.prior_factor_ids)
  then
    return query select false, '{}'::uuid[];
    return;
  end if;

  update public.user_recovery_codes
  set used_at = now()
  where id = v_transaction.recovery_code_id
    and user_id = p_user_id
    and used_at is null;

  if not found then
    return query select false, '{}'::uuid[];
    return;
  end if;

  update public.user_recovery_transactions
  set
    completed_at = now()
  where id = v_transaction.id;

  return query select true, v_transaction.prior_factor_ids;
end
$function$;

create or replace function public.cancel_user_recovery_transaction(
  p_user_id uuid,
  p_transaction_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_transaction public.user_recovery_transactions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_user_id is null
    or p_transaction_token_hash is null
    or p_transaction_token_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Invalid recovery transaction cancellation request.';
  end if;

  select recovery_transaction.*
  into v_transaction
  from public.user_recovery_transactions as recovery_transaction
  where recovery_transaction.user_id = p_user_id
    and recovery_transaction.transaction_token_hash = p_transaction_token_hash
  for update;

  if not found or v_transaction.completion_claimed_at is not null then
    return false;
  end if;

  delete from public.user_recovery_transactions
  where id = v_transaction.id
    and completed_at is null
    and completion_claimed_at is null;

  return found;
end
$function$;

revoke all on function public.claim_user_recovery_completion(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.begin_user_recovery_transaction(uuid, text, text, uuid[])
  from public, anon, authenticated;
revoke all on function public.get_user_recovery_transaction(uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_user_recovery_transaction(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_user_recovery_transaction(uuid, text)
  from public, anon, authenticated;
grant execute on function public.begin_user_recovery_transaction(uuid, text, text, uuid[])
  to service_role;
grant execute on function public.claim_user_recovery_completion(uuid, text, uuid)
  to service_role;
grant execute on function public.get_user_recovery_transaction(uuid, text)
  to service_role;
grant execute on function public.complete_user_recovery_transaction(uuid, text, uuid)
  to service_role;
grant execute on function public.cancel_user_recovery_transaction(uuid, text)
  to service_role;

-- New recovery flow completes consumption only after a verified replacement
-- factor. Prevent older Edge Function code from consuming codes prematurely.
revoke all on function public.consume_user_recovery_code(uuid, text)
  from public, anon, authenticated, service_role;

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
    or to_regrole('anon') is null
    or to_regrole('authenticated') is null
    or postgres_oid is null
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

  foreach target_table in array array['user_recovery_transactions']
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
      raise exception 'Browser roles retain table privileges on public.%.', target_table;
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
    'public.get_user_recovery_transaction(uuid,text)',
    'public.begin_user_recovery_transaction(uuid,text,text,uuid[])',
    'public.claim_user_recovery_completion(uuid,text,uuid)',
    'public.complete_user_recovery_transaction(uuid,text,uuid)',
    'public.cancel_user_recovery_transaction(uuid,text)'
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

  if has_function_privilege(
    'service_role',
    'public.consume_user_recovery_code(uuid,text)',
    'EXECUTE'
  ) then
    raise exception
      'The legacy direct-consumption RPC remains executable by service_role.';
  end if;
end
$security_audit$;
