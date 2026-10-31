begin;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'materials',
    'students',
    'subjects',
    'teachers',
    'teacher_grade_groups',
    'teacher_subject_assignments',
    'live_classes',
    'quizzes',
    'calendar_events',
    'announcements',
    'announcement_recipients'
  ] loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'Required Student Calendar table public.% is missing', table_name;
    end if;
  end loop;

  if to_regclass('storage.objects') is null then
    raise exception 'Required Storage table storage.objects is missing';
  end if;

  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'The supabase_realtime publication is missing';
  end if;
end;
$$;

create or replace function public.student_can_view_material(requested_material_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.materials material
      join public.students student
        on student.user_id = (select auth.uid())
      join public.subjects subject
        on subject.id = material.subject_id
      where material.id = requested_material_id
        and material.grade = student.grade
        and (
          (
            lower(btrim(material.material_type)) = 'pdf'
            and material.storage_bucket = 'pdfs'
          )
          or (
            lower(btrim(material.material_type)) in ('photo', 'image')
            and material.storage_bucket = 'photos'
          )
          or (
            lower(btrim(material.material_type)) = 'document'
            and material.storage_bucket = 'documents'
          )
          or (
            lower(btrim(material.material_type)) = 'video'
            and material.storage_bucket = 'videos'
          )
        )
        and coalesce(subject.grades, '{}'::integer[]) @> array[student.grade]
        and (
          (
            student.grade between 5 and 10
            and exists (
              select 1
              from public.teacher_grade_groups grade_group
              where grade_group.teacher_id = material.teacher_id
                and grade_group.grade = student.grade
                and grade_group.stream is null
                and (
                  coalesce(grade_group.teach_all_subjects, false)
                  or exists (
                    select 1
                    from public.teacher_subject_assignments assignment
                    where assignment.teacher_id = material.teacher_id
                      and assignment.grade = student.grade
                      and assignment.stream is null
                      and assignment.subject_id = material.subject_id
                  )
                )
            )
          )
          or (
            student.grade in (11, 12)
            and lower(btrim(material.stream)) = lower(btrim(student.stream))
            and exists (
              select 1
              from unnest(coalesce(subject.streams, '{}'::text[])) allowed_stream(stream)
              where lower(btrim(allowed_stream.stream)) = lower(btrim(student.stream))
            )
            and exists (
              select 1
              from public.teacher_grade_groups grade_group
              where grade_group.teacher_id = material.teacher_id
                and grade_group.grade = student.grade
                and lower(btrim(grade_group.stream)) = lower(btrim(student.stream))
                and (
                  coalesce(grade_group.teach_all_subjects, false)
                  or exists (
                    select 1
                    from public.teacher_subject_assignments assignment
                    where assignment.teacher_id = material.teacher_id
                      and assignment.grade = student.grade
                      and lower(btrim(assignment.stream)) = lower(btrim(student.stream))
                      and assignment.subject_id = material.subject_id
                  )
                )
            )
          )
        )
    );
$$;

alter function public.student_can_view_material(uuid) owner to postgres;
revoke all on function public.student_can_view_material(uuid) from public, anon;
grant execute on function public.student_can_view_material(uuid) to authenticated;

alter table public.materials enable row level security;
drop policy if exists materials_students_select_eligible on public.materials;
drop policy if exists materials_students_select_published_videos on public.materials;
drop policy if exists materials_students_select_eligible_videos on public.materials;
drop policy if exists materials_students_calendar_select on public.materials;
create policy materials_students_calendar_select
  on public.materials
  for select to authenticated
  using (public.student_can_view_material(id));

drop policy if exists materials_students_read_eligible_storage
  on storage.objects;
drop policy if exists materials_students_read_eligible_videos_storage
  on storage.objects;
drop policy if exists materials_students_calendar_storage_select
  on storage.objects;
create policy materials_students_calendar_storage_select
  on storage.objects
  for select to authenticated
  using (
    bucket_id in ('pdfs', 'videos', 'photos', 'documents')
    and exists (
      select 1
      from public.materials material
      where material.storage_bucket = storage.objects.bucket_id
        and material.file_path = storage.objects.name
        and public.student_can_view_material(material.id)
    )
  );

do $$
declare
  table_name text;
begin
  if not (select puballtables from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'materials',
      'live_classes',
      'quizzes',
      'calendar_events',
      'announcements',
      'announcement_recipients'
    ] loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;

commit;
