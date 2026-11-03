-- Conditional AAL2 checks for high-impact teacher/student writes.
--
-- This deliberately does not add policies to every public table, rewrite
-- SECURITY DEFINER RPCs, or alter Supabase Auth or Storage policies.
-- Protected operations:
--   * Attendance session and record mutations.
--   * Quiz configuration, answer-key, attempt, and answer mutations.
--
-- Existing row-ownership policies remain authoritative. These triggers add
-- an authentication-assurance check after normal authorization has allowed a
-- write; they do not grant access to any row.

begin;

do $preflight$
declare
  expected_table text;
  table_oid oid;
  existing_function oid;
  existing_owner oid;
  existing_security_definer boolean;
  existing_search_path text[];
  existing_return_type oid;
  existing_language text;
begin
  if to_regclass('auth.mfa_factors') is null
    or not exists (
      select 1
      from information_schema.columns
      where table_schema = 'auth'
        and table_name = 'mfa_factors'
        and column_name = 'user_id'
    )
    or not exists (
      select 1
      from information_schema.columns
      where table_schema = 'auth'
        and table_name = 'mfa_factors'
        and column_name = 'factor_type'
    )
    or not exists (
      select 1
      from information_schema.columns
      where table_schema = 'auth'
        and table_name = 'mfa_factors'
        and column_name = 'status'
    )
  then
    raise exception
      'Supabase Auth MFA schema is unavailable or incompatible; expected auth.mfa_factors(user_id, factor_type, status).';
  end if;

  foreach expected_table in array array[
    'attendance_sessions',
    'attendance_records',
    'quizzes',
    'quiz_questions',
    'quiz_attempts',
    'quiz_answers'
  ]
  loop
    table_oid := to_regclass(format('public.%I', expected_table));
    if table_oid is null then
      raise exception
        'Required sensitive table public.% is missing. Review the operation scope before running this script.',
        expected_table;
    end if;

    if not exists (
      select 1
      from pg_class
      where oid = table_oid
        and relkind in ('r', 'p')
        and relrowsecurity
    ) then
      raise exception
        'RLS is not enabled on public.%; refusing to add an AAL2 write guard without existing row-authorization policies.',
        expected_table;
    end if;
  end loop;

  foreach expected_table in array array[
    'public.mfa_aal2_is_satisfied()',
    'public.enforce_mfa_aal2_for_sensitive_write()'
  ]
  loop
    existing_function := to_regprocedure(expected_table);
    if existing_function is null then
      continue;
    end if;

    select procedure.proowner,
           procedure.prosecdef,
           procedure.proconfig,
           procedure.prorettype,
           language.lanname
    into existing_owner,
         existing_security_definer,
         existing_search_path,
         existing_return_type,
         existing_language
    from pg_proc as procedure
    join pg_language as language on language.oid = procedure.prolang
    where procedure.oid = existing_function;

    if existing_owner <> to_regrole('postgres')
      or not existing_security_definer
      or not coalesce(existing_search_path @> array['search_path=""'], false)
      or existing_language <> 'plpgsql'
      or (
        expected_table = 'public.mfa_aal2_is_satisfied()'
        and existing_return_type <> 'boolean'::regtype
      )
      or (
        expected_table = 'public.enforce_mfa_aal2_for_sensitive_write()'
        and existing_return_type <> 'trigger'::regtype
      )
    then
      raise exception
        'Existing function % has incompatible ownership or security settings; review it before rerunning this script.',
        expected_table;
    end if;
  end loop;

  if exists (
    select 1
    from pg_trigger as trigger_row
    join pg_class as relation on relation.oid = trigger_row.tgrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'attendance_sessions',
        'attendance_records',
        'quizzes',
        'quiz_questions',
        'quiz_attempts',
        'quiz_answers'
      )
      and trigger_row.tgname = 'mfa_aal2_guard_sensitive_writes'
      and not trigger_row.tgisinternal
      and (
        trigger_row.tgfoid is distinct from
          to_regprocedure('public.enforce_mfa_aal2_for_sensitive_write()')
        or (trigger_row.tgtype & 31) <> 31
        or trigger_row.tgenabled not in ('O', 'A')
      )
  ) then
    raise exception
      'A trigger named mfa_aal2_guard_sensitive_writes already exists with an incompatible definition; review it before applying this script.';
  end if;
end
$preflight$;

create or replace function public.mfa_aal2_is_satisfied()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  current_auth_role text := auth.role();
begin
  if current_user_id is null then
    -- Permit trusted SQL jobs and service-role Edge Function operations.
    -- Do not let anonymous API requests through this branch.
    return current_auth_role is null or current_auth_role = 'service_role';
  end if;

  return not exists (
    select 1
    from auth.mfa_factors as factor
    where factor.user_id = current_user_id
      and factor.factor_type = 'totp'
      and factor.status = 'verified'
  ) or auth.jwt() ->> 'aal' = 'aal2';
end
$function$;

alter function public.mfa_aal2_is_satisfied() owner to postgres;
revoke all on function public.mfa_aal2_is_satisfied()
  from public, anon, authenticated, service_role;

create or replace function public.enforce_mfa_aal2_for_sensitive_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.mfa_aal2_is_satisfied() then
    raise exception using
      errcode = '42501',
      message = 'AAL2 authentication is required for this sensitive operation on accounts with verified two-factor authentication.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

alter function public.enforce_mfa_aal2_for_sensitive_write() owner to postgres;
revoke all on function public.enforce_mfa_aal2_for_sensitive_write()
  from public, anon, authenticated, service_role;

do $install_triggers$
declare
  target_table text;
  target_oid oid;
  existing_trigger oid;
begin
  foreach target_table in array array[
    'attendance_sessions',
    'attendance_records',
    'quizzes',
    'quiz_questions',
    'quiz_attempts',
    'quiz_answers'
  ]
  loop
    target_oid := to_regclass(format('public.%I', target_table));
    select oid
    into existing_trigger
    from pg_trigger
    where tgrelid = target_oid
      and tgname = 'mfa_aal2_guard_sensitive_writes'
      and not tgisinternal;

    if existing_trigger is null then
      execute format(
        'CREATE TRIGGER mfa_aal2_guard_sensitive_writes BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_mfa_aal2_for_sensitive_write()',
        target_table
      );
    end if;
  end loop;
end
$install_triggers$;

commit;
