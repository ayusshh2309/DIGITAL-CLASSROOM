-- Transactions for recovery performed with Supabase Auth native recovery
-- codes. Auth consumes the native code during MFA verification; this table
-- tracks only the subsequent replacement-factor workflow.

begin;

do $preflight$
begin
  if to_regrole('service_role') is null
    or to_regrole('postgres') is null
    or to_regclass('auth.users') is null
  then
    raise exception 'Expected Supabase roles and auth.users are missing.';
  end if;

  if to_regclass('public.user_native_mfa_recovery_transactions') is not null then
    raise exception
      'public.user_native_mfa_recovery_transactions already exists; review it before applying this migration.';
  end if;
end
$preflight$;

create table public.user_native_mfa_recovery_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_token_hash text not null unique
    check (transaction_token_hash ~ '^[0-9a-f]{64}$'),
  prior_factor_ids uuid[] not null default '{}'::uuid[]
    check (
      cardinality(prior_factor_ids) <= 10
      and array_position(prior_factor_ids, null) is null
    ),
  replacement_factor_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'completed', 'cancelled', 'expired')),
  completion_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  constraint user_native_mfa_recovery_expiry_check
    check (expires_at > created_at),
  constraint user_native_mfa_recovery_completion_check
    check (
      (status = 'pending'
        and completion_claimed_at is null
        and replacement_factor_id is null
        and completed_at is null
        and cancelled_at is null
        and expired_at is null)
      or (status = 'claimed'
        and completion_claimed_at is not null
        and replacement_factor_id is not null
        and completed_at is null
        and cancelled_at is null
        and expired_at is null)
      or (status = 'completed'
        and completion_claimed_at is not null
        and replacement_factor_id is not null
        and completed_at is not null
        and cancelled_at is null
        and expired_at is null)
      or (status = 'cancelled'
        and completion_claimed_at is null
        and replacement_factor_id is null
        and completed_at is null
        and cancelled_at is not null
        and expired_at is null)
      or (status = 'expired'
        and completion_claimed_at is null
        and replacement_factor_id is null
        and completed_at is null
        and cancelled_at is null
        and expired_at is not null)
    )
);

create unique index user_native_mfa_recovery_one_pending_per_user_idx
  on public.user_native_mfa_recovery_transactions (user_id)
  where status in ('pending', 'claimed');

alter table public.user_native_mfa_recovery_transactions enable row level security;
revoke all on table public.user_native_mfa_recovery_transactions from public, anon, authenticated;
grant select, insert, update, delete
  on table public.user_native_mfa_recovery_transactions to service_role;

create or replace function public.begin_native_mfa_recovery_transaction(
  p_user_id uuid,
  p_transaction_token_hash text,
  p_prior_factor_ids uuid[]
)
returns table (started boolean, expires_at timestamptz, state text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expires_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_user_id is null
    or p_transaction_token_hash is null
    or p_transaction_token_hash !~ '^[0-9a-f]{64}$'
    or p_prior_factor_ids is null
    or cardinality(p_prior_factor_ids) = 0
    or cardinality(p_prior_factor_ids) > 10
    or array_position(p_prior_factor_ids, null) is not null
  then
    raise exception 'Invalid native MFA recovery transaction request.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  update public.user_native_mfa_recovery_transactions as recovery_transaction
  set status = 'expired', expired_at = now()
  where recovery_transaction.user_id = p_user_id
    and recovery_transaction.status = 'pending'
    and recovery_transaction.expires_at <= now();

  if exists (
    select 1
    from public.user_native_mfa_recovery_transactions as recovery_transaction
    where recovery_transaction.user_id = p_user_id
      and recovery_transaction.status in ('pending', 'claimed')
  ) then
    return query
      select false, recovery_transaction.expires_at, recovery_transaction.status
      from public.user_native_mfa_recovery_transactions as recovery_transaction
      where recovery_transaction.user_id = p_user_id
        and recovery_transaction.status in ('pending', 'claimed')
      limit 1;
    return;
  end if;

  v_expires_at := now() + interval '15 minutes';
  insert into public.user_native_mfa_recovery_transactions (
    user_id,
    transaction_token_hash,
    prior_factor_ids,
    expires_at
  )
  values (
    p_user_id,
    p_transaction_token_hash,
    p_prior_factor_ids,
    v_expires_at
  );

  return query select true, v_expires_at, 'pending'::text;
end
$function$;

create or replace function public.get_native_mfa_recovery_transaction(
  p_user_id uuid,
  p_transaction_token_hash text
)
returns table (
  transaction_found boolean,
  state text,
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
    raise exception 'Invalid native MFA recovery transaction lookup request.';
  end if;

  update public.user_native_mfa_recovery_transactions as recovery_transaction
  set status = 'expired', expired_at = now()
  where recovery_transaction.user_id = p_user_id
    and recovery_transaction.transaction_token_hash = p_transaction_token_hash
    and recovery_transaction.status = 'pending'
    and recovery_transaction.expires_at <= now();

  return query
    select
      true,
      recovery_transaction.status,
      recovery_transaction.status = 'completed',
      recovery_transaction.expires_at,
      recovery_transaction.replacement_factor_id,
      recovery_transaction.prior_factor_ids
    from public.user_native_mfa_recovery_transactions as recovery_transaction
    where recovery_transaction.user_id = p_user_id
      and recovery_transaction.transaction_token_hash = p_transaction_token_hash;

  if not found then
    return query
      select false, null::text, false, null::timestamptz, null::uuid, '{}'::uuid[];
  end if;
end
$function$;

create or replace function public.claim_native_mfa_recovery_completion(
  p_user_id uuid,
  p_transaction_token_hash text,
  p_replacement_factor_id uuid
)
returns table (
  claimed boolean,
  already_completed boolean,
  state text,
  replacement_factor_id uuid,
  prior_factor_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_transaction public.user_native_mfa_recovery_transactions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_user_id is null
    or p_transaction_token_hash is null
    or p_transaction_token_hash !~ '^[0-9a-f]{64}$'
    or p_replacement_factor_id is null
  then
    raise exception 'Invalid native MFA recovery completion claim.';
  end if;

  select recovery_transaction.*
  into v_transaction
  from public.user_native_mfa_recovery_transactions as recovery_transaction
  where recovery_transaction.user_id = p_user_id
    and recovery_transaction.transaction_token_hash = p_transaction_token_hash
  for update;

  if not found then
    return query select false, false, 'not_found'::text, null::uuid, '{}'::uuid[];
    return;
  end if;

  if v_transaction.status = 'completed' then
    return query
      select
        v_transaction.replacement_factor_id = p_replacement_factor_id,
        true,
        v_transaction.status,
        v_transaction.replacement_factor_id,
        v_transaction.prior_factor_ids;
    return;
  end if;

  if v_transaction.status = 'expired' or
    (v_transaction.status = 'pending' and v_transaction.expires_at <= now()) then
    if v_transaction.status = 'pending' then
      update public.user_native_mfa_recovery_transactions as recovery_transaction
      set status = 'expired', expired_at = now()
      where recovery_transaction.id = v_transaction.id;
    end if;
    return query
      select false, false, 'expired'::text, null::uuid, v_transaction.prior_factor_ids;
    return;
  end if;

  if v_transaction.status = 'cancelled' then
    return query
      select false, false, 'cancelled'::text, null::uuid, v_transaction.prior_factor_ids;
    return;
  end if;

  if v_transaction.status = 'pending' then
    if p_replacement_factor_id = any(v_transaction.prior_factor_ids) then
      return query
        select false, false, 'pending'::text, null::uuid, v_transaction.prior_factor_ids;
      return;
    end if;
    update public.user_native_mfa_recovery_transactions as recovery_transaction
    set
      status = 'claimed',
      completion_claimed_at = now(),
      replacement_factor_id = p_replacement_factor_id
    where recovery_transaction.id = v_transaction.id;
  elsif v_transaction.status <> 'claimed' or
    v_transaction.replacement_factor_id is distinct from p_replacement_factor_id then
    return query
      select false, false, v_transaction.status, v_transaction.replacement_factor_id,
        v_transaction.prior_factor_ids;
    return;
  end if;

  return query
    select true, false, 'claimed'::text, p_replacement_factor_id, v_transaction.prior_factor_ids;
end
$function$;

create or replace function public.complete_native_mfa_recovery_transaction(
  p_user_id uuid,
  p_transaction_token_hash text,
  p_replacement_factor_id uuid
)
returns table (completed boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_transaction public.user_native_mfa_recovery_transactions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_user_id is null
    or p_transaction_token_hash is null
    or p_transaction_token_hash !~ '^[0-9a-f]{64}$'
    or p_replacement_factor_id is null
  then
    raise exception 'Invalid native MFA recovery completion request.';
  end if;

  select recovery_transaction.*
  into v_transaction
  from public.user_native_mfa_recovery_transactions as recovery_transaction
  where recovery_transaction.user_id = p_user_id
    and recovery_transaction.transaction_token_hash = p_transaction_token_hash
  for update;

  if not found then
    return query select false;
    return;
  end if;

  if v_transaction.status = 'completed' then
    return query select v_transaction.replacement_factor_id = p_replacement_factor_id;
    return;
  end if;

  if v_transaction.status <> 'claimed'
    or v_transaction.replacement_factor_id is distinct from p_replacement_factor_id
    or p_replacement_factor_id = any(v_transaction.prior_factor_ids)
  then
    return query select false;
    return;
  end if;

  update public.user_native_mfa_recovery_transactions as recovery_transaction
  set status = 'completed', completed_at = now()
  where recovery_transaction.id = v_transaction.id;

  return query select true;
end
$function$;

create or replace function public.cancel_native_mfa_recovery_transaction(
  p_user_id uuid,
  p_transaction_token_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_transaction public.user_native_mfa_recovery_transactions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or p_user_id is null
    or p_transaction_token_hash is null
    or p_transaction_token_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Invalid native MFA recovery cancellation request.';
  end if;

  select recovery_transaction.*
  into v_transaction
  from public.user_native_mfa_recovery_transactions as recovery_transaction
  where recovery_transaction.user_id = p_user_id
    and recovery_transaction.transaction_token_hash = p_transaction_token_hash
  for update;

  if not found then
    return 'not_found';
  end if;

  if v_transaction.status <> 'pending' then
    return v_transaction.status;
  end if;

  if v_transaction.expires_at <= now() then
    update public.user_native_mfa_recovery_transactions
    set status = 'expired', expired_at = now()
    where id = v_transaction.id;
    return 'expired';
  end if;

  update public.user_native_mfa_recovery_transactions
  set status = 'cancelled', cancelled_at = now()
  where id = v_transaction.id;

  return 'cancelled';
end
$function$;

revoke all on function public.begin_native_mfa_recovery_transaction(uuid, text, uuid[])
  from public, anon, authenticated;
revoke all on function public.get_native_mfa_recovery_transaction(uuid, text)
  from public, anon, authenticated;
revoke all on function public.claim_native_mfa_recovery_completion(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_native_mfa_recovery_transaction(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_native_mfa_recovery_transaction(uuid, text)
  from public, anon, authenticated;

grant execute on function public.begin_native_mfa_recovery_transaction(uuid, text, uuid[])
  to service_role;
grant execute on function public.get_native_mfa_recovery_transaction(uuid, text)
  to service_role;
grant execute on function public.claim_native_mfa_recovery_completion(uuid, text, uuid)
  to service_role;
grant execute on function public.complete_native_mfa_recovery_transaction(uuid, text, uuid)
  to service_role;
grant execute on function public.cancel_native_mfa_recovery_transaction(uuid, text)
  to service_role;

commit;
