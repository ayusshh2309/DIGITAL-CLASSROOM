create extension if not exists pgcrypto;

create sequence if not exists public.student_id_seq;

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  student_id text not null unique,
  full_name text not null,
  email text not null,
  phone text not null,
  date_of_birth date not null,
  gender text not null check (gender in ('male', 'female', 'other', 'prefer_not_to_say')),
  father_name text not null,
  father_phone text not null,
  mother_name text not null,
  mother_phone text not null,
  country text not null,
  state text not null,
  city text not null,
  address text not null,
  profile_photo_url text,
  grade integer not null check (grade between 5 and 12),
  stream text,
  school_name text not null,
  board text not null,
  academic_year text not null,
  roll_number text,
  medium_of_instruction text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint students_email_nonempty_check check (length(btrim(email)) > 0),
  constraint students_full_name_nonempty_check check (length(btrim(full_name)) > 0),
  constraint students_phone_nonempty_check check (length(btrim(phone)) > 0),
  constraint students_date_of_birth_check check (date_of_birth <= current_date),
  constraint students_parent_names_nonempty_check check (
    length(btrim(father_name)) > 0 and length(btrim(mother_name)) > 0
  ),
  constraint students_parent_phones_nonempty_check check (
    length(btrim(father_phone)) > 0 and length(btrim(mother_phone)) > 0
  ),
  constraint students_address_nonempty_check check (
    length(btrim(country)) > 0 and length(btrim(state)) > 0
    and length(btrim(city)) > 0 and length(btrim(address)) > 0
  ),
  constraint students_academic_details_nonempty_check check (
    length(btrim(school_name)) > 0 and length(btrim(board)) > 0
    and length(btrim(academic_year)) > 0 and length(btrim(medium_of_instruction)) > 0
  ),
  constraint students_grade_stream_check check (
    (grade between 5 and 10 and stream is null)
    or (
      grade in (11, 12)
      and stream is not null
      and stream in ('science_pcm', 'science_pcb', 'commerce', 'arts_humanities')
    )
  )
);

create index if not exists students_grade_stream_idx
  on public.students (grade, stream);

create unique index if not exists students_email_unique_idx
  on public.students (lower(email));

create or replace function public.set_student_registration_fields()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  auth_email text;
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then
    raise exception 'Student profiles can only be created or changed by their authenticated owner.';
  end if;

  select users.email
    into auth_email
    from auth.users as users
    where users.id = new.user_id;

  if auth_email is null then
    raise exception 'The authenticated account email could not be verified.';
  end if;
  new.email := lower(auth_email);

  if tg_op = 'INSERT' then
    new.student_id := 'SLDC' || to_char(current_date, 'YYYY') ||
      lpad(nextval('public.student_id_seq')::text, 5, '0');
  else
    new.student_id := old.student_id;
    new.user_id := old.user_id;
  end if;

  return new;
end;
$$;

create or replace function public.set_student_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_student_registration_fields on public.students;
create trigger set_student_registration_fields
  before insert or update on public.students
  for each row execute function public.set_student_registration_fields();

drop trigger if exists set_student_updated_at on public.students;
create trigger set_student_updated_at
  before update on public.students
  for each row execute function public.set_student_updated_at();

revoke all on function public.set_student_registration_fields() from public, anon, authenticated;
revoke all on function public.set_student_updated_at() from public, anon, authenticated;

alter table public.students enable row level security;

drop policy if exists "Students read their own registration" on public.students;
create policy "Students read their own registration"
  on public.students for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Students create their own registration" on public.students;
create policy "Students create their own registration"
  on public.students for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Students update their own registration" on public.students;
create policy "Students update their own registration"
  on public.students for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.students to authenticated;
revoke all on public.students from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-profile-images', 'student-profile-images', false, 2097152, array['image/jpeg', 'image/png', 'image/gif'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Students upload their own profile images" on storage.objects;
create policy "Students upload their own profile images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'student-profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Students view their own profile images" on storage.objects;
create policy "Students view their own profile images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'student-profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Students update their own profile images" on storage.objects;
create policy "Students update their own profile images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'student-profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'student-profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Students remove their own profile images" on storage.objects;
create policy "Students remove their own profile images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'student-profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

alter table public.students replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'students'
    ) then
    alter publication supabase_realtime add table public.students;
  end if;
end;
$$;
