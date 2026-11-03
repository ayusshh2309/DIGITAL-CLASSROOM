-- Merge existing teacher_languages rows into teachers.languages without
-- replacing values already stored on teachers. Run before retiring the old table.
begin;

with migrated as (
  select
    teacher_id,
    array_agg(distinct btrim(language) order by btrim(language)) as languages
  from public.teacher_languages
  where nullif(btrim(language), '') is not null
  group by teacher_id
)
update public.teachers as teacher
set languages = (
  select coalesce(
    array_agg(normalized.language order by lower(normalized.language), normalized.language),
    array[]::text[]
  )
  from (
    select distinct on (lower(btrim(source.language)))
      btrim(source.language) as language
    from unnest(
      coalesce(teacher.languages, array[]::text[]) || migrated.languages
    ) as source(language)
    where nullif(btrim(source.language), '') is not null
    order by lower(btrim(source.language)), btrim(source.language)
  ) as normalized
)
from migrated
where teacher.id = migrated.teacher_id;

-- Review any numeric legacy values before cleanup. No language master table is
-- defined by this project, so these values must not be guessed or remapped here.
select id, languages
from public.teachers
where exists (
  select 1
  from unnest(coalesce(languages, array[]::text[])) as value(language)
  where btrim(value.language) ~ '^[0-9]+$'
)
order by id;

-- Confirm every non-empty source language is present on the corresponding teacher.
select source.teacher_id, source.language
from public.teacher_languages as source
join public.teachers as teacher on teacher.id = source.teacher_id
where nullif(btrim(source.language), '') is not null
  and not exists (
    select 1
    from unnest(coalesce(teacher.languages, array[]::text[])) as value(language)
    where lower(btrim(value.language)) = lower(btrim(source.language))
  )
order by source.teacher_id, source.language;

commit;
