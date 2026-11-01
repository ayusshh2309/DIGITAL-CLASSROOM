begin;

do $$
declare
  completion_table oid := to_regclass('public.student_material_completions');
begin
  if completion_table is null then
    raise exception 'Expected the existing public.student_material_completions table; this migration does not create it';
  end if;

  if exists (
    select required.column_name
    from (values
      ('student_id'),
      ('material_id'),
      ('completion_method'),
      ('completed_at'),
      ('created_at')
    ) as required(column_name)
    where not exists (
      select 1
      from information_schema.columns as column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = 'student_material_completions'
        and column_info.column_name = required.column_name
    )
  ) then
    raise exception 'The existing student_material_completions table is missing required verified columns';
  end if;

  if to_regprocedure('public.student_can_view_material(uuid)') is null then
    raise exception 'Expected public.student_can_view_material(uuid) to enforce existing material access';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    where relation.oid = completion_table
      and relation.relrowsecurity
  ) then
    raise exception 'student_material_completions must retain its existing row-level security';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'student_material_completions'
      and policy.cmd in ('SELECT', 'ALL')
      and (
        policy.roles @> array['authenticated']::name[]
        or policy.roles @> array['public']::name[]
      )
  ) then
    raise exception 'The existing authenticated SELECT policy on student_material_completions is required and will not be changed';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_info
    where constraint_info.conrelid = completion_table
      and constraint_info.contype = 'u'
      and cardinality(constraint_info.conkey) = 2
      and constraint_info.conkey @> array[
        (select attribute.attnum
         from pg_catalog.pg_attribute as attribute
         where attribute.attrelid = completion_table
           and attribute.attname = 'student_id'),
        (select attribute.attnum
         from pg_catalog.pg_attribute as attribute
         where attribute.attrelid = completion_table
           and attribute.attname = 'material_id')
      ]::smallint[]
  ) then
    raise exception 'Expected the existing unique constraint on (student_id, material_id)';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_info
    where constraint_info.conrelid = completion_table
      and constraint_info.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_info.oid) ilike '%manual_completion%'
  ) then
    raise exception 'Expected the existing completion_method constraint to allow manual_completion';
  end if;
end;
$$;

create or replace function public.complete_student_material_v1(p_material_id uuid)
returns table (
  completed boolean,
  newly_completed boolean,
  completed_count bigint
)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  registered_student_id uuid;
  inserted_count integer := 0;
  unique_completion_count bigint;
begin
  if authenticated_user_id is null then
    raise exception 'Sign in as a student to complete learning materials.'
      using errcode = '42501';
  end if;

  select student.id
    into registered_student_id
  from public.students as student
  where student.user_id = authenticated_user_id;

  if registered_student_id is null then
    raise exception 'A registered student profile is required to complete learning materials.'
      using errcode = '42501';
  end if;

  if p_material_id is null
    or not exists (
      select 1
      from public.materials as material
      where material.id = p_material_id
        and lower(btrim(material.material_type)) in ('pdf', 'photo', 'image', 'document')
        and public.student_can_view_material(material.id)
    ) then
    raise exception 'This material is unavailable or is not eligible for manual completion.'
      using errcode = '42501';
  end if;

  insert into public.student_material_completions (
    student_id,
    material_id,
    completion_method,
    completed_at,
    created_at
  )
  values (
    registered_student_id,
    p_material_id,
    'manual_completion',
    now(),
    now()
  )
  on conflict (student_id, material_id) do nothing;

  get diagnostics inserted_count = row_count;

  select count(*)::bigint
    into unique_completion_count
  from public.student_material_completions as completion
  where completion.student_id = registered_student_id;

  return query
  select true, inserted_count = 1, unique_completion_count;
end;
$$;

alter function public.complete_student_material_v1(uuid) owner to postgres;
revoke all on function public.complete_student_material_v1(uuid) from public, anon;
grant execute on function public.complete_student_material_v1(uuid) to authenticated;

revoke insert on table public.student_material_completions from public, anon, authenticated;

do $$
begin
  if has_table_privilege(
    'authenticated',
    'public.student_material_completions',
    'INSERT'
  ) then
    raise exception 'Direct authenticated INSERT is still available; refusing to leave material completions client-writable';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
