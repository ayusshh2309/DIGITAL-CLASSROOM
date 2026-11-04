begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id)
values
  ('00000000-0000-4000-8000-000000000010'),
  ('00000000-0000-4000-8000-000000000020')
on conflict (id) do nothing;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (select started
   from public.begin_native_mfa_recovery_transaction(
     '00000000-0000-4000-8000-000000000010',
     repeat('a', 64),
     array['00000000-0000-4000-8000-000000000011'::uuid]
   )),
  true,
  'a recovery transaction starts'
);

update public.user_native_mfa_recovery_transactions
set expires_at = now() + interval '30 seconds'
where transaction_token_hash = repeat('a', 64);

select is(
  (select state
   from public.claim_native_mfa_recovery_completion(
     '00000000-0000-4000-8000-000000000010',
     repeat('a', 64),
     '00000000-0000-4000-8000-000000000012'
   )),
  'claimed',
  'a claim made shortly before expiration succeeds'
);

update public.user_native_mfa_recovery_transactions
set
  created_at = now() - interval '1 day',
  expires_at = now() - interval '1 second',
  completion_claimed_at = now() - interval '1 day'
where transaction_token_hash = repeat('a', 64);

select is(
  (select claimed
   from public.claim_native_mfa_recovery_completion(
     '00000000-0000-4000-8000-000000000010',
     repeat('a', 64),
     '00000000-0000-4000-8000-000000000012'
   )),
  true,
  'a stale claim can be retried after the original transaction expiry'
);

select is(
  public.cancel_native_mfa_recovery_transaction(
    '00000000-0000-4000-8000-000000000010',
    repeat('a', 64)
  ),
  'claimed',
  'claimed recovery cannot be cancelled'
);

select is(
  (select completed
   from public.complete_native_mfa_recovery_transaction(
     '00000000-0000-4000-8000-000000000010',
     repeat('a', 64),
     '00000000-0000-4000-8000-000000000012'
   )),
  true,
  'claimed recovery finalizes after the original expiration'
);

select is(
  (select completed
   from public.complete_native_mfa_recovery_transaction(
     '00000000-0000-4000-8000-000000000010',
     repeat('a', 64),
     '00000000-0000-4000-8000-000000000012'
   )),
  true,
  'repeated finalization is idempotent for the same replacement'
);

select is(
  (select state
   from public.get_native_mfa_recovery_transaction(
     '00000000-0000-4000-8000-000000000010',
     repeat('a', 64)
   )),
  'completed',
  'completed transaction state is retained'
);

select is(
  (select transaction_found
   from public.get_native_mfa_recovery_transaction(
     '00000000-0000-4000-8000-000000000020',
     repeat('a', 64)
   )),
  false,
  'a transaction cannot be read under another user id'
);

select is(
  (select completed
   from public.complete_native_mfa_recovery_transaction(
     '00000000-0000-4000-8000-000000000010',
     repeat('a', 64),
     '00000000-0000-4000-8000-000000000015'
   )),
  false,
  'completed transaction cannot be finalized for another factor'
);

select is(
  (select started
   from public.begin_native_mfa_recovery_transaction(
     '00000000-0000-4000-8000-000000000010',
     repeat('b', 64),
     array['00000000-0000-4000-8000-000000000011'::uuid]
   )),
  true,
  'a new transaction can start after completion'
);

update public.user_native_mfa_recovery_transactions
set created_at = now() - interval '1 day',
    expires_at = now() - interval '1 second'
where transaction_token_hash = repeat('b', 64);

select is(
  (select state
   from public.claim_native_mfa_recovery_completion(
     '00000000-0000-4000-8000-000000000010',
     repeat('b', 64),
     '00000000-0000-4000-8000-000000000013'
   )),
  'expired',
  'an unclaimed expired transaction cannot be claimed'
);

select is(
  public.cancel_native_mfa_recovery_transaction(
    '00000000-0000-4000-8000-000000000010',
    repeat('b', 64)
  ),
  'expired',
  'an expired transaction remains explicitly expired'
);

select is(
  (select started
   from public.begin_native_mfa_recovery_transaction(
     '00000000-0000-4000-8000-000000000010',
     repeat('c', 64),
     array['00000000-0000-4000-8000-000000000011'::uuid]
   )),
  true,
  'a new transaction can start after expiration'
);

select is(
  public.cancel_native_mfa_recovery_transaction(
    '00000000-0000-4000-8000-000000000010',
    repeat('c', 64)
  ),
  'cancelled',
  'a pending transaction can be cancelled'
);

select is(
  (select state
   from public.claim_native_mfa_recovery_completion(
     '00000000-0000-4000-8000-000000000010',
     repeat('c', 64),
     '00000000-0000-4000-8000-000000000014'
   )),
  'cancelled',
  'a cancelled transaction cannot be claimed'
);

select is(
  (select started
   from public.begin_native_mfa_recovery_transaction(
     '00000000-0000-4000-8000-000000000010',
     repeat('d', 64),
     array['00000000-0000-4000-8000-000000000011'::uuid]
   )),
  true,
  'a new transaction can start after cancellation'
);

select * from finish();
rollback;
