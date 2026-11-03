do $migration$
begin
  raise exception
    'This legacy script is disabled. Apply the versioned Supabase migrations instead.';
end
$migration$;
