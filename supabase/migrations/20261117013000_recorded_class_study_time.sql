begin;

do $$
begin
  if to_regclass('public.study_sessions') is null
    or to_regclass('public.study_session_segments') is null
    or to_regclass('public.recorded_classes') is null
    or to_regclass('public.live_classes') is null then
    raise exception 'Recorded-class study time requires the existing study and recording tables.';
  end if;
  if to_regprocedure('public.study_time_start_activity_v1(text,uuid)') is null
    or to_regprocedure('public.live_class_student_can_view(uuid,integer,text,text)') is null then
    raise exception 'Recorded-class study time requires the existing activity and student-access functions.';
  end if;
end;
$$;

alter table public.study_sessions
  add column if not exists recorded_class_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.study_sessions'::regclass
      and conname = 'study_sessions_recorded_class_id_fkey'
  ) then
    alter table public.study_sessions
      add constraint study_sessions_recorded_class_id_fkey
      foreign key (recorded_class_id)
      references public.recorded_classes(id)
      on delete set null;
  end if;
end;
$$;

alter table public.study_sessions
  drop constraint if exists study_sessions_activity_type_check,
  drop constraint if exists study_sessions_activity_resource_check;

alter table public.study_sessions
  add constraint study_sessions_activity_type_check
    check (activity_type = any (array['material'::text, 'quiz'::text, 'recorded_class'::text])),
  add constraint study_sessions_activity_resource_check
    check (
      (activity_type = 'material'::text
        and material_id is not null
        and quiz_id is null
        and recorded_class_id is null)
      or (activity_type = 'quiz'::text
        and quiz_id is not null
        and material_id is null
        and recorded_class_id is null)
      or (activity_type = 'recorded_class'::text
        and material_id is null
        and quiz_id is null
        and (
          (status = 'active'::text and recorded_class_id is not null)
          or status = any (array['completed'::text, 'abandoned'::text])
        ))
    );

create or replace function public.study_time_start_activity_v1(
  p_activity_type text,
  p_resource_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
    v_student_id uuid;
    v_session_id uuid;
    v_existing public.study_sessions%rowtype;
    v_material public.materials%rowtype;
    v_quiz public.quizzes%rowtype;
    v_recording public.recorded_classes%rowtype;
    v_recording_id uuid;
    v_recorded_subject_id bigint;
begin
    select s.id
    into v_student_id
    from public.students s
    where s.user_id = (select auth.uid());

    if v_student_id is null then
        raise exception 'Student profile not found';
    end if;

    if p_activity_type is null
       or p_activity_type not in ('material', 'quiz', 'recorded_class')
       or p_resource_id is null then
        raise exception 'Invalid activity details';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_student_id::text, 0)
    );

    if p_activity_type = 'material' then
        select m.*
        into v_material
        from public.materials m
        where m.id = p_resource_id;

        if not found then
            raise exception 'Material not found';
        end if;

        if not public.student_can_view_material(
            v_material.teacher_id,
            v_material.grade,
            v_material.stream,
            v_material.subject_id,
            v_material.material_type
        ) then
            raise exception 'You are not allowed to access this material';
        end if;
    elsif p_activity_type = 'quiz' then
        select q.*
        into v_quiz
        from public.quizzes q
        where q.id = p_resource_id;

        if not found then
            raise exception 'Quiz not found';
        end if;

        if not public.quiz_student_is_eligible(p_resource_id) then
            raise exception 'You are not eligible for this quiz';
        end if;

        if not exists (
            select 1
            from public.quiz_attempts qa
            where qa.quiz_id = p_resource_id
              and qa.student_id = v_student_id
              and qa.status = 'in_progress'
        ) then
            raise exception 'No active quiz attempt found';
        end if;
    else
        select rc.id, class.subject_id
        into v_recording_id, v_recorded_subject_id
        from public.recorded_classes rc
        join public.live_classes class
          on class.id = rc.live_class_id
         and class.teacher_id = rc.teacher_id
        where rc.id = p_resource_id
          and rc.recording_status = 'available'
          and rc.recording_verified_at is not null
          and rc.storage_path is not null
          and rc.storage_path ~* (
            '^manual/' || rc.teacher_id::text || '/' || rc.live_class_id::text || '/' ||
            '[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}\.(mp4|webm|mov)$'
          )
          and lower(btrim(coalesce(class.publication_status, ''))) = 'published'
          and lower(btrim(coalesce(class.status, ''))) not in ('cancelled', 'canceled')
          and public.live_class_student_can_view(
            class.teacher_id,
            class.grade::integer,
            class.stream,
            class.subject_id::text
          );

        if not found then
            raise exception 'Recorded class not found or not available to this student';
        end if;

        select rc.*
        into v_recording
        from public.recorded_classes rc
        where rc.id = v_recording_id;

        if not found then
            raise exception 'Recorded class not found or not available to this student';
        end if;
    end if;

    select ss.*
    into v_existing
    from public.study_sessions ss
    where ss.student_id = v_student_id
      and ss.status = 'active'
    for update;

    if found then
        if v_existing.activity_type = p_activity_type
           and (
               (p_activity_type = 'material'
                and v_existing.material_id = p_resource_id)
               or (p_activity_type = 'quiz'
                and v_existing.quiz_id = p_resource_id)
               or (p_activity_type = 'recorded_class'
                and v_existing.recorded_class_id = p_resource_id)
           ) then
            return v_existing.id;
        end if;

        update public.study_sessions
        set status = 'abandoned',
            ended_at = now(),
            updated_at = now()
        where id = v_existing.id;
    end if;

    insert into public.study_sessions (
        student_id,
        activity_type,
        material_id,
        quiz_id,
        recorded_class_id,
        subject_id,
        status,
        started_at,
        last_heartbeat_at
    )
    values (
        v_student_id,
        p_activity_type,
        case when p_activity_type = 'material' then p_resource_id end,
        case when p_activity_type = 'quiz' then p_resource_id end,
        case when p_activity_type = 'recorded_class' then p_resource_id end,
        case
          when p_activity_type = 'material' then v_material.subject_id
          when p_activity_type = 'quiz' then v_quiz.subject_id
          else v_recorded_subject_id
        end,
        'active',
        now(),
        now()
    )
    returning id into v_session_id;

    return v_session_id;
end;
$function$;

commit;
