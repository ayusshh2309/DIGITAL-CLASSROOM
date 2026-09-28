begin;

do $$
begin
  if to_regclass('public.teachers') is null then
    raise exception 'Expected public.teachers to exist before applying this migration';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teachers' and column_name = 'phone'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teachers' and column_name = 'phone_number'
  ) then
    alter table public.teachers rename column phone to phone_number;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teachers' and column_name = 'profile_photo'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teachers' and column_name = 'profile_photo_url'
  ) then
    alter table public.teachers rename column profile_photo to profile_photo_url;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teachers' and column_name = 'experience_years'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teachers' and column_name = 'years_experience'
  ) then
    alter table public.teachers rename column experience_years to years_experience;
  end if;
end;
$$;

alter table public.teachers
  add column if not exists user_id uuid,
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists country_code text,
  add column if not exists phone_number text,
  add column if not exists profile_photo_url text,
  add column if not exists date_of_birth date,
  add column if not exists gender text,
  add column if not exists country text,
  add column if not exists state text,
  add column if not exists city text,
  add column if not exists address text,
  add column if not exists bio text,
  add column if not exists highest_qualification text,
  add column if not exists degree_course text,
  add column if not exists specialization text,
  add column if not exists university_college text,
  add column if not exists graduation_year integer,
  add column if not exists languages text[] not null default '{}',
  add column if not exists subjects text[] not null default '{}',
  add column if not exists employment_status text,
  add column if not exists institution_name text,
  add column if not exists institution_type text,
  add column if not exists years_experience integer,
  add column if not exists teaching_mode text,
  add column if not exists teacher_id text,
  add column if not exists grades jsonb not null default '[]'::jsonb,
  add column if not exists streams jsonb not null default '[]'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teachers' and column_name = 'email'
  ) then
    execute 'alter table public.teachers alter column email drop not null';
    execute $migration$
      update public.teachers as teacher
      set user_id = auth_user.id
      from auth.users as auth_user
      where teacher.user_id is null
        and lower(teacher.email) = lower(auth_user.email)
    $migration$;
  end if;
end;
$$;

update public.teachers as teacher
set user_id = auth_user.id
from auth.users as auth_user
where teacher.user_id is null
  and teacher.id::text = auth_user.id::text;

do $$
begin
  if exists (select 1 from public.teachers where user_id is null) then
    raise exception 'Every teacher must be linked to auth.users before enabling teacher profile access';
  end if;
  alter table public.teachers alter column user_id set not null;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.teachers'::regclass
      and conname = 'teachers_user_id_fkey'
  ) then
    alter table public.teachers
      add constraint teachers_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

create unique index if not exists teachers_user_id_key
  on public.teachers (user_id);

create table if not exists public.teacher_settings (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null unique references public.teachers(id) on delete cascade,
  language text not null default 'English',
  timezone text not null default 'Asia/Kolkata',
  date_format text not null default 'DD MMM YYYY',
  time_format text not null default '12h',
  week_start_day text not null default 'Monday',
  auto_save boolean not null default true,
  email_notifications boolean not null default true,
  sound_notifications boolean not null default true,
  compact_view boolean not null default false,
  show_tips boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teacher_subjects (
  teacher_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  grade text not null,
  created_at timestamptz not null default now(),
  primary key (teacher_id, subject, grade)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists teachers_set_updated_at on public.teachers;
create trigger teachers_set_updated_at
before update on public.teachers
for each row execute function public.set_updated_at();

drop trigger if exists teacher_settings_set_updated_at on public.teacher_settings;
create trigger teacher_settings_set_updated_at
before update on public.teacher_settings
for each row execute function public.set_updated_at();

alter table public.teachers enable row level security;
alter table public.teacher_settings enable row level security;
alter table public.teacher_subjects enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'teachers'
  loop
    execute format('drop policy %I on public.teachers', policy_record.policyname);
  end loop;

  for policy_record in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'teacher_settings'
  loop
    execute format('drop policy %I on public.teacher_settings', policy_record.policyname);
  end loop;
end;
$$;

create policy teachers_select_own on public.teachers
for select to authenticated using (user_id = (select auth.uid()));

create policy teachers_insert_own on public.teachers
for insert to authenticated with check (user_id = (select auth.uid()));

create policy teachers_update_own on public.teachers
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists teacher_subjects_select_own on public.teacher_subjects;
create policy teacher_subjects_select_own on public.teacher_subjects
for select to authenticated using (teacher_id = (select auth.uid()));

drop policy if exists teacher_subjects_insert_own on public.teacher_subjects;
create policy teacher_subjects_insert_own on public.teacher_subjects
for insert to authenticated with check (teacher_id = (select auth.uid()));

drop policy if exists teacher_subjects_update_own on public.teacher_subjects;
create policy teacher_subjects_update_own on public.teacher_subjects
for update to authenticated
using (teacher_id = (select auth.uid()))
with check (teacher_id = (select auth.uid()));

create policy teacher_settings_select_own on public.teacher_settings
for select to authenticated
using (
  exists (
    select 1 from public.teachers
    where teachers.id = teacher_settings.teacher_id
      and teachers.user_id = (select auth.uid())
  )
);

create policy teacher_settings_insert_own on public.teacher_settings
for insert to authenticated
with check (
  exists (
    select 1 from public.teachers
    where teachers.id = teacher_settings.teacher_id
      and teachers.user_id = (select auth.uid())
  )
);

create policy teacher_settings_update_own on public.teacher_settings
for update to authenticated
using (
  exists (
    select 1 from public.teachers
    where teachers.id = teacher_settings.teacher_id
      and teachers.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.teachers
    where teachers.id = teacher_settings.teacher_id
      and teachers.user_id = (select auth.uid())
  )
);

revoke all on public.teachers from anon;
revoke delete on public.teachers from authenticated;
grant select, insert, update on public.teachers to authenticated;
revoke all on public.teacher_subjects from anon;
grant select, insert, update on public.teacher_subjects to authenticated;
revoke update on public.teachers from authenticated;
grant update (
  full_name,
  phone_number,
  date_of_birth,
  gender,
  country,
  state,
  city,
  address,
  profile_photo_url,
  bio,
  highest_qualification,
  languages,
  employment_status,
  institution_name,
  institution_type,
  years_experience,
  teaching_mode
) on public.teachers to authenticated;

revoke all on public.teacher_settings from anon;
revoke delete on public.teacher_settings from authenticated;
grant select, insert on public.teacher_settings to authenticated;
revoke update on public.teacher_settings from authenticated;
grant update (
  language,
  timezone,
  date_format,
  time_format,
  week_start_day,
  auto_save,
  email_notifications,
  sound_notifications,
  compact_view,
  show_tips
) on public.teacher_settings to authenticated;

insert into storage.buckets (id, name, public)
values ('teacher-profile-images', 'teacher-profile-images', false)
on conflict (id) do update set public = false;

drop policy if exists teacher_profile_images_read_own on storage.objects;
create policy teacher_profile_images_read_own on storage.objects
for select to authenticated
using (
  bucket_id = 'teacher-profile-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists teacher_profile_images_insert_own on storage.objects;
create policy teacher_profile_images_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'teacher-profile-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists teacher_profile_images_update_own on storage.objects;
create policy teacher_profile_images_update_own on storage.objects
for update to authenticated
using (
  bucket_id = 'teacher-profile-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'teacher-profile-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists teacher_profile_images_delete_own on storage.objects;
create policy teacher_profile_images_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id = 'teacher-profile-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'teachers'
    ) then
      alter publication supabase_realtime add table public.teachers;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'teacher_settings'
    ) then
      alter publication supabase_realtime add table public.teacher_settings;
    end if;
  end if;
end;
$$;

commit;
