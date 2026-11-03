-- Expiring, user-bound recovery transactions. Apply after
-- 20261104001500_backup_recovery_code_rpcs.sql.
-- A recovery code is consumed only after Supabase has verified a replacement
-- TOTP factor and issued an AAL2 session. Completion is claimed atomically
-- before factor removal so cancellation cannot race the external Auth call.

create table if not exists public.user_recovery_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recovery_code_id uuid not null references public.user_recovery_codes(id) on delete cascade,
  transaction_token_hash text not null unique
    check (transaction_token_hash ~ '^[0-9a-f]{64}$'),
  prior_factor_ids uuid[] not null default '{}'::uuid[],
  replacement_factor_id uuid,
  completion_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  constraint user_recovery_transactions_code_id_key unique (recovery_code_id),
  constraint user_recovery_transactions_expiry_check check (expires_at > created_at),
  constraint user_recovery_transactions_completion_check check (
    (
      completed_at is null
      and (
        (completion_claimed_at is null and replacement_factor_id is null)
        or (completion_claimed_at is not null and replacement_factor_id is not null)
      )
    )
    or (completed_at is not null and replacement_factor_id is not null)
  )
);

alter table public.user_recovery_transactions
  add column if not exists completion_claimed_at timestamptz;

alter table public.user_recovery_transactions
  drop constraint if exists user_recovery_transactions_completion_check;
alter table public.user_recovery_transactions
  add constraint user_recovery_transactions_completion_check check (
    (
      completed_at is null
      and (
        (completion_claimed_at is null and replacement_factor_id is null)
        or (completion_claimed_at is not null and replacement_factor_id is not null)
      )
    )
    or (completed_at is not null and completion_claimed_at is not null and replacement_factor_id is not null)
  );

do $migration$
begin
  if exists (
    select 1
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
    where not exists (
      select 1
      from information_schema.columns as columns
      where columns.table_schema = 'public'
        and columns.table_name = 'user_recovery_transactions'
        and columns.column_name = expected.name
        and columns.data_type = expected.data_type
        and columns.is_nullable = expected.is_nullable
    )
  ) then
    raise exception
      'public.user_recovery_transactions has an incompatible or missing column.';
  end if;
end
$migration$;

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

drop function if exists public.claim_user_recovery_completion(uuid, text);

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
