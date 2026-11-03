-- Conditional AAL2 enforcement: users without a verified TOTP factor keep
-- their existing access; enrolled users need an AAL2 session.
do $$
begin
  if to_regclass('auth.mfa_factors') is null then
    raise exception 'Supabase Auth MFA is unavailable: auth.mfa_factors does not exist.';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'mfa_factors'
      and column_name in ('user_id', 'factor_type', 'status')
    group by table_schema, table_name
    having count(distinct column_name) = 3
  ) then
    raise exception 'Unexpected auth.mfa_factors schema; expected user_id, factor_type, and status columns.';
  end if;
end;
$$;

create or replace function public.mfa_aal2_is_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when auth.uid() is null then coalesce(auth.role() = 'service_role', false)
    else
      not exists (
        select 1
        from auth.mfa_factors as factor
        where factor.user_id = auth.uid()
          and factor.factor_type = 'totp'
          and factor.status = 'verified'
      )
      or auth.jwt() ->> 'aal' = 'aal2'
  end
$function$;

revoke all on function public.mfa_aal2_is_satisfied() from public, anon;
grant execute on function public.mfa_aal2_is_satisfied() to authenticated, service_role;

create or replace function public.enforce_mfa_aal2_if_required()
returns void
language plpgsql
set search_path = ''
as $function$
begin
  if not public.mfa_aal2_is_satisfied() then
    raise exception using
      errcode = '42501',
      message = 'AAL2 authentication is required for accounts with verified two-factor authentication.';
  end if;
end
$function$;

revoke all on function public.enforce_mfa_aal2_if_required() from public, anon;
grant execute on function public.enforce_mfa_aal2_if_required() to authenticated, service_role;

-- RLS policies are restrictive, so these checks are ANDed with existing
-- ownership and role policies instead of replacing or widening them.
do $$
declare
  relation record;
begin
  for relation in
    select n.nspname, c.relname
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    execute format(
      'drop policy if exists mfa_require_aal2_for_enrolled_users on %I.%I',
      relation.nspname,
      relation.relname
    );
    execute format(
      'create policy mfa_require_aal2_for_enrolled_users on %I.%I as restrictive for all to authenticated using (public.mfa_aal2_is_satisfied()) with check (public.mfa_aal2_is_satisfied())',
      relation.nspname,
      relation.relname
    );
  end loop;

  if exists (
    select 1
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'storage'
      and c.relname = 'objects'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  ) then
    drop policy if exists mfa_require_aal2_for_enrolled_users on storage.objects;
    create policy mfa_require_aal2_for_enrolled_users
      on storage.objects as restrictive for all to authenticated
      using (public.mfa_aal2_is_satisfied())
      with check (public.mfa_aal2_is_satisfied());
  end if;
end;
$$;

-- SECURITY DEFINER RPCs bypass table RLS. Add the same conditional check to
-- every callable public SECURITY DEFINER routine and trigger function.
do $$
declare
  routine record;
  definition text;
  guarded_body text;
begin
  for routine in
    select p.oid, p.prosrc, l.lanname, p.proname
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    join pg_language as l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname not in ('mfa_aal2_is_satisfied', 'enforce_mfa_aal2_if_required')
      and position('public.enforce_mfa_aal2_if_required()' in p.prosrc) = 0
      and (
        p.prorettype = 'trigger'::regtype
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  loop
    definition := pg_get_functiondef(routine.oid);
    if routine.lanname = 'plpgsql' then
      definition := regexp_replace(
        definition,
        '\mBEGIN\M',
        E'BEGIN\n  PERFORM public.enforce_mfa_aal2_if_required();\n',
        'i'
      );
    elsif routine.lanname = 'sql' then
      guarded_body := format(
        'select _mfa_result.* from (select public.enforce_mfa_aal2_if_required()) as _mfa_guard cross join lateral (%s) as _mfa_result',
        routine.prosrc
      );
      definition := regexp_replace(
        definition,
        'AS \$function\$.*\$function\$',
        'AS $function$' || guarded_body || '$function$',
        'n'
      );
    else
      raise exception 'Cannot add AAL enforcement to SECURITY DEFINER routine %. Unsupported language %.',
        routine.proname,
        routine.lanname;
    end if;
    if definition = pg_get_functiondef(routine.oid) then
      raise exception 'Could not add AAL enforcement to SECURITY DEFINER routine %.',
        routine.proname;
    end if;
    execute definition;
  end loop;
end;
$$;
