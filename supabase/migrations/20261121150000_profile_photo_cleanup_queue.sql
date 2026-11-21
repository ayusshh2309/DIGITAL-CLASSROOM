begin;

do $$
begin
  if to_regclass('public.teachers') is null
    or to_regclass('public.students') is null
    or to_regclass('auth.users') is null
    or to_regclass('storage.buckets') is null then
    raise exception 'Profile photo cleanup requires public.teachers, public.students, auth.users, and storage.buckets.';
  end if;

  if not exists (
    select 1 from storage.buckets where id = 'teacher-profile-images'
  ) or not exists (
    select 1 from storage.buckets where id = 'student-profile-images'
  ) then
    raise exception 'Both profile image Storage buckets must exist before installing cleanup triggers.';
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron')
    or to_regprocedure('cron.schedule(text,text,text)') is null
    or to_regprocedure('cron.unschedule(bigint)') is null then
    raise exception 'Enable pg_cron and its scheduling functions before installing profile photo cleanup.';
  end if;
  if to_regrole('service_role') is null
    or to_regprocedure('auth.role()') is null then
    raise exception 'Supabase service_role and auth.role() are required for restricted cleanup RPCs.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net')
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'Enable pg_net and net.http_post before installing profile photo cleanup.';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault is required for the profile photo cleanup scheduler secrets.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teachers'
      and column_name = 'id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teachers'
      and column_name = 'user_id' and data_type = 'uuid' and is_nullable = 'NO'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teachers'
      and column_name = 'profile_photo_url' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'user_id' and data_type = 'uuid' and is_nullable = 'NO'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
      and column_name = 'profile_photo_url' and data_type = 'text'
  ) then
    raise exception 'Expected UUID profile identifiers and user_id columns plus text profile_photo_url columns on both profile tables.';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    join pg_attribute profile_user
      on profile_user.attrelid = constraint_row.conrelid
     and profile_user.attname = 'user_id'
     and not profile_user.attisdropped
    join pg_attribute auth_user
      on auth_user.attrelid = constraint_row.confrelid
     and auth_user.attname = 'id'
     and not auth_user.attisdropped
    where constraint_row.conrelid = 'public.teachers'::regclass
      and constraint_row.confrelid = 'auth.users'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confdeltype = 'c'
      and constraint_row.conkey = array[profile_user.attnum]::smallint[]
      and constraint_row.confkey = array[auth_user.attnum]::smallint[]
  ) or not exists (
    select 1
    from pg_constraint constraint_row
    join pg_attribute profile_user
      on profile_user.attrelid = constraint_row.conrelid
     and profile_user.attname = 'user_id'
     and not profile_user.attisdropped
    join pg_attribute auth_user
      on auth_user.attrelid = constraint_row.confrelid
     and auth_user.attname = 'id'
     and not auth_user.attisdropped
    where constraint_row.conrelid = 'public.students'::regclass
      and constraint_row.confrelid = 'auth.users'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confdeltype = 'c'
      and constraint_row.conkey = array[profile_user.attnum]::smallint[]
      and constraint_row.confkey = array[auth_user.attnum]::smallint[]
  ) then
    raise exception 'Both profile tables must have a single-column user_id foreign key to auth.users(id) with ON DELETE CASCADE.';
  end if;

  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'profile_photo_cleanup_project_url'
      and decrypted_secret ~* '^https?://[^/?#]+/?$'
  ) or not exists (
    select 1 from vault.decrypted_secrets
    where name = 'profile_photo_cleanup_secret'
      and decrypted_secret ~ '^[A-Za-z0-9_-]{32,128}$'
  ) or not exists (
    select 1 from vault.decrypted_secrets
    where name = 'profile_photo_cleanup_anon_key'
      and btrim(decrypted_secret) <> ''
  ) then
    raise exception 'Create Vault secrets profile_photo_cleanup_project_url, profile_photo_cleanup_secret, and profile_photo_cleanup_anon_key before applying this migration.';
  end if;
end;
$$;

create table if not exists public.profile_photo_cleanup_queue (
  id bigint generated always as identity primary key,
  source_table text not null check (source_table in ('teachers', 'students')),
  source_row_id uuid not null,
  user_id uuid not null,
  bucket_id text not null check (
    (source_table = 'teachers' and bucket_id = 'teacher-profile-images')
    or
    (source_table = 'students' and bucket_id = 'student-profile-images')
  ),
  object_path text not null check (length(object_path) between 1 and 1024),
  source_origin text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'completed', 'blocked')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  lease_token uuid,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint profile_photo_cleanup_queue_lease_check check (
    (status = 'processing' and lease_token is not null and lease_expires_at is not null)
    or
    (status <> 'processing' and lease_token is null and lease_expires_at is null)
  )
);

create index if not exists profile_photo_cleanup_queue_due_idx
  on public.profile_photo_cleanup_queue (next_attempt_at, created_at)
  where status in ('pending', 'retry');

create index if not exists profile_photo_cleanup_queue_expired_lease_idx
  on public.profile_photo_cleanup_queue (lease_expires_at)
  where status = 'processing';

alter table public.profile_photo_cleanup_queue enable row level security;
revoke all on table public.profile_photo_cleanup_queue
  from public, anon, authenticated, service_role;

create or replace function public.parse_profile_photo_cleanup_reference(
  p_reference text,
  p_expected_bucket text,
  p_user_id uuid
)
returns table (object_path text, source_origin text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  reference_value text := p_reference;
  parsed_url text[];
  path_value text;
  origin_value text := null;
  scheme_value text;
  host_value text;
  bucket_value text;
begin
  if p_reference is null or reference_value = '' or p_user_id is null then
    raise exception 'Profile photo reference or owner UUID is missing.';
  end if;
  if reference_value <> btrim(reference_value) then
    raise exception 'Profile photo reference contains surrounding whitespace.';
  end if;

  if reference_value ~* '^https?://' then
    parsed_url := regexp_match(
      reference_value,
      '^https?://([^/?#@]+)/storage/v1/object/(public|sign|authenticated)/([^/?#]+)/([^?#]+)(\?[^#]*)?$',
      'i'
    );
    if parsed_url is null then
      raise exception 'Profile photo URL is not a supported Supabase Storage object URL.';
    end if;

    scheme_value := lower(substring(reference_value from '^([a-z]+)://'));
    host_value := lower(parsed_url[1]);
    bucket_value := parsed_url[3];
    path_value := parsed_url[4];
    if scheme_value = 'http' and host_value !~ '^(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$' then
      raise exception 'Non-local profile photo URLs must use HTTPS.';
    end if;
    if bucket_value <> p_expected_bucket then
      raise exception 'Profile photo URL references an unexpected Storage bucket.';
    end if;
    origin_value := scheme_value || '://' || host_value;
  else
    if position('://' in reference_value) > 0 then
      raise exception 'Profile photo URL scheme is unsupported.';
    end if;
    path_value := reference_value;
  end if;

  if path_value = ''
    or length(path_value) > 1024
    or left(path_value, 1) = '/'
    or right(path_value, 1) = '/'
    or position('//' in path_value) > 0
    or position('%' in path_value) > 0
    or position('?' in path_value) > 0
    or position('#' in path_value) > 0
    or position(chr(92) in path_value) > 0
    or path_value ~ '[[:cntrl:]]'
    or path_value ~ '(^|/)\.\.?(/|$)'
    or split_part(path_value, '/', 1) <> p_user_id::text then
    raise exception 'Profile photo object path is invalid or does not belong to its profile owner.';
  end if;

  object_path := path_value;
  source_origin := origin_value;
  return next;
end;
$$;

create or replace function public.assert_profile_photo_cleanup_origin(p_source_origin text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  project_url text;
  project_origin text;
begin
  select decrypted_secret
    into strict project_url
  from vault.decrypted_secrets
  where name = 'profile_photo_cleanup_project_url';

  if project_url !~* '^https?://[^/?#]+/?$' then
    raise exception 'Vault secret profile_photo_cleanup_project_url must be a Supabase project origin URL.';
  end if;
  if p_source_origin is null then
    return;
  end if;

  project_origin := regexp_replace(btrim(project_url), '/+$', '');
  if lower(p_source_origin) <> lower(project_origin) then
    raise exception 'Profile photo URL origin does not match this Supabase project.';
  end if;
end;
$$;

create or replace function public.verify_profile_photo_cleanup_invocation_secret(
  p_provided_secret text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_secret text;
  difference integer;
  character_index integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role is required to validate cleanup configuration.';
  end if;

  if p_provided_secret is null
    or p_provided_secret !~ '^[A-Za-z0-9_-]{32,128}$' then
    return false;
  end if;

  select decrypted_secret
    into strict expected_secret
  from vault.decrypted_secrets
  where name = 'profile_photo_cleanup_secret';

  if expected_secret is null
    or expected_secret !~ '^[A-Za-z0-9_-]{32,128}$' then
    raise exception 'Profile photo cleanup invocation configuration is invalid.';
  end if;

  -- Compare the complete strings without an early exit.
  difference := length(p_provided_secret) # length(expected_secret);
  for character_index in 1..greatest(length(p_provided_secret), length(expected_secret))
  loop
    difference := difference
      | (
        coalesce(ascii(substr(p_provided_secret, character_index, 1)), 0)
        # coalesce(ascii(substr(expected_secret, character_index, 1)), 0)
      );
  end loop;

  return difference = 0;
end;
$$;

do $$
declare
  photo_reference record;
  parsed_reference record;
begin
  for photo_reference in
    select 'teachers'::text as source_table, id as profile_id, user_id, profile_photo_url
    from public.teachers
    where profile_photo_url is not null and btrim(profile_photo_url) <> ''
    union all
    select 'students'::text as source_table, id as profile_id, user_id, profile_photo_url
    from public.students
    where profile_photo_url is not null and btrim(profile_photo_url) <> ''
  loop
    begin
      if photo_reference.source_table = 'teachers' then
        select *
          into strict parsed_reference
        from public.parse_profile_photo_cleanup_reference(
          photo_reference.profile_photo_url,
          'teacher-profile-images',
          photo_reference.user_id
        );
      else
        select *
          into strict parsed_reference
        from public.parse_profile_photo_cleanup_reference(
          photo_reference.profile_photo_url,
          'student-profile-images',
          photo_reference.user_id
        );
      end if;
      perform public.assert_profile_photo_cleanup_origin(parsed_reference.source_origin);
    exception when sqlstate 'P0001' then
      raise exception 'Unsupported profile photo reference on public.% row % (user_id %); cleanup migration was stopped. Verify or correct the profile_photo_url before retrying.',
        photo_reference.source_table,
        photo_reference.profile_id,
        photo_reference.user_id;
    end;
  end loop;
end;
$$;

create or replace function public.capture_teacher_profile_photo_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parsed_reference record;
begin
  if old.profile_photo_url is null or btrim(old.profile_photo_url) = '' then
    return old;
  end if;

  begin
    select *
      into strict parsed_reference
    from public.parse_profile_photo_cleanup_reference(
      old.profile_photo_url,
      'teacher-profile-images',
      old.user_id
    );
    perform public.assert_profile_photo_cleanup_origin(parsed_reference.source_origin);
  exception when sqlstate 'P0001' then
    raise exception 'Cannot delete Teacher profile %: its photo reference cannot be safely queued. Correct or clear the profile_photo_url after verifying the Storage object, then retry.',
      old.id;
  end;

  insert into public.profile_photo_cleanup_queue (
    source_table,
    source_row_id,
    user_id,
    bucket_id,
    object_path,
    source_origin
  )
  values (
    'teachers',
    old.id,
    old.user_id,
    'teacher-profile-images',
    parsed_reference.object_path,
    parsed_reference.source_origin
  );

  return old;
end;
$$;

create or replace function public.capture_student_profile_photo_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parsed_reference record;
begin
  if old.profile_photo_url is null or btrim(old.profile_photo_url) = '' then
    return old;
  end if;

  begin
    select *
      into strict parsed_reference
    from public.parse_profile_photo_cleanup_reference(
      old.profile_photo_url,
      'student-profile-images',
      old.user_id
    );
    perform public.assert_profile_photo_cleanup_origin(parsed_reference.source_origin);
  exception when sqlstate 'P0001' then
    raise exception 'Cannot delete Student profile %: its photo reference cannot be safely queued. Correct or clear the profile_photo_url after verifying the Storage object, then retry.',
      old.id;
  end;

  insert into public.profile_photo_cleanup_queue (
    source_table,
    source_row_id,
    user_id,
    bucket_id,
    object_path,
    source_origin
  )
  values (
    'students',
    old.id,
    old.user_id,
    'student-profile-images',
    parsed_reference.object_path,
    parsed_reference.source_origin
  );

  return old;
end;
$$;

alter function public.capture_teacher_profile_photo_before_delete() owner to postgres;
alter function public.capture_student_profile_photo_before_delete() owner to postgres;
alter function public.parse_profile_photo_cleanup_reference(text, text, uuid) owner to postgres;
alter function public.assert_profile_photo_cleanup_origin(text) owner to postgres;
alter function public.verify_profile_photo_cleanup_invocation_secret(text) owner to postgres;

revoke all on function public.capture_teacher_profile_photo_before_delete()
  from public, anon, authenticated, service_role;
revoke all on function public.capture_student_profile_photo_before_delete()
  from public, anon, authenticated, service_role;
revoke all on function public.parse_profile_photo_cleanup_reference(text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.assert_profile_photo_cleanup_origin(text)
  from public, anon, authenticated, service_role;
revoke all on function public.verify_profile_photo_cleanup_invocation_secret(text)
  from public, anon, authenticated, service_role;

drop trigger if exists teachers_profile_photo_cleanup_before_delete on public.teachers;
create trigger teachers_profile_photo_cleanup_before_delete
before delete on public.teachers
for each row
execute function public.capture_teacher_profile_photo_before_delete();

drop trigger if exists students_profile_photo_cleanup_before_delete on public.students;
create trigger students_profile_photo_cleanup_before_delete
before delete on public.students
for each row
execute function public.capture_student_profile_photo_before_delete();

create or replace function public.claim_profile_photo_cleanup_batch(p_batch_size integer default 25)
returns table (
  id bigint,
  source_table text,
  user_id uuid,
  bucket_id text,
  object_path text,
  source_origin text,
  lease_token uuid,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role is required to claim profile photo cleanup work.';
  end if;

  return query
  with due as (
    select queue_row.id
    from public.profile_photo_cleanup_queue as queue_row
    where (
      queue_row.status in ('pending', 'retry')
      and queue_row.next_attempt_at <= now()
    ) or (
      queue_row.status = 'processing'
      and queue_row.lease_expires_at <= now()
    )
    order by queue_row.created_at, queue_row.id
    for update skip locked
    limit greatest(1, least(coalesce(p_batch_size, 25), 100))
  ),
  claimed as (
    update public.profile_photo_cleanup_queue as queue_row
    set status = 'processing',
        attempts = queue_row.attempts + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '5 minutes',
        updated_at = now()
    from due
    where queue_row.id = due.id
    returning
      queue_row.id,
      queue_row.source_table,
      queue_row.user_id,
      queue_row.bucket_id,
      queue_row.object_path,
      queue_row.source_origin,
      queue_row.lease_token,
      queue_row.attempts
  )
  select
    claimed.id,
    claimed.source_table,
    claimed.user_id,
    claimed.bucket_id,
    claimed.object_path,
    claimed.source_origin,
    claimed.lease_token,
    claimed.attempts
  from claimed;
end;
$$;

create or replace function public.complete_profile_photo_cleanup(
  p_queue_id bigint,
  p_lease_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role is required to complete profile photo cleanup.';
  end if;

  update public.profile_photo_cleanup_queue
  set status = 'completed',
      lease_token = null,
      lease_expires_at = null,
      last_error = null,
      completed_at = now(),
      updated_at = now()
  where id = p_queue_id
    and status = 'processing'
    and lease_token = p_lease_token;

  if not found then
    raise exception 'Profile photo cleanup lease is no longer valid.';
  end if;
end;
$$;

create or replace function public.retry_profile_photo_cleanup(
  p_queue_id bigint,
  p_lease_token uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role is required to retry profile photo cleanup.';
  end if;

  update public.profile_photo_cleanup_queue
  set status = 'retry',
      next_attempt_at = now() + make_interval(
        secs => least(21600, (15 * power(2, least(attempts, 10)))::integer)
      ),
      lease_token = null,
      lease_expires_at = null,
      last_error = left(coalesce(p_error, 'Storage deletion failed.'), 2000),
      updated_at = now()
  where id = p_queue_id
    and status = 'processing'
    and lease_token = p_lease_token;

  if not found then
    raise exception 'Profile photo cleanup lease is no longer valid.';
  end if;
end;
$$;

create or replace function public.block_profile_photo_cleanup(
  p_queue_id bigint,
  p_lease_token uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role is required to block profile photo cleanup.';
  end if;

  update public.profile_photo_cleanup_queue
  set status = 'blocked',
      lease_token = null,
      lease_expires_at = null,
      last_error = left(coalesce(p_error, 'Cleanup item failed validation.'), 2000),
      updated_at = now()
  where id = p_queue_id
    and status = 'processing'
    and lease_token = p_lease_token;

  if not found then
    raise exception 'Profile photo cleanup lease is no longer valid.';
  end if;
end;
$$;

alter function public.claim_profile_photo_cleanup_batch(integer) owner to postgres;
alter function public.complete_profile_photo_cleanup(bigint, uuid) owner to postgres;
alter function public.retry_profile_photo_cleanup(bigint, uuid, text) owner to postgres;
alter function public.block_profile_photo_cleanup(bigint, uuid, text) owner to postgres;

revoke all on function public.claim_profile_photo_cleanup_batch(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_profile_photo_cleanup(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.retry_profile_photo_cleanup(bigint, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.block_profile_photo_cleanup(bigint, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_profile_photo_cleanup_batch(integer) to service_role;
grant execute on function public.complete_profile_photo_cleanup(bigint, uuid) to service_role;
grant execute on function public.retry_profile_photo_cleanup(bigint, uuid, text) to service_role;
grant execute on function public.block_profile_photo_cleanup(bigint, uuid, text) to service_role;
grant execute on function public.verify_profile_photo_cleanup_invocation_secret(text) to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'profile-photo-cleanup-worker'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'profile-photo-cleanup-worker',
    '* * * * *',
    $job$
      select net.http_post(
        url := regexp_replace(
          (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'profile_photo_cleanup_project_url'
          ),
          '/+$',
          ''
        ) || '/functions/v1/cleanup-profile-photos',
        headers := jsonb_build_object(
          'Content-Type',
          'application/json',
          'apikey',
          (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'profile_photo_cleanup_anon_key'
          ),
          'Authorization',
          'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'profile_photo_cleanup_anon_key'
          ),
          'x-profile-cleanup-secret',
          (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'profile_photo_cleanup_secret'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      );
    $job$
  );
end;
$$;

commit;
