begin;
select plan(17);

select ok(not has_table_privilege('anon', 'public.solo_beta_protected_checkout_attempts', 'SELECT'),
  'Anonymous callers cannot read protected checkout claims');
select ok(not has_table_privilege('authenticated', 'public.solo_beta_protected_checkout_attempts', 'SELECT'),
  'Authenticated browser callers cannot read protected checkout claims');
select ok(not has_function_privilege('authenticated', 'public.solo_beta_claim_protected_trial(uuid,text)', 'EXECUTE'),
  'Authenticated callers cannot claim a Stripe subscription create');
select ok(not has_function_privilege('authenticated', 'public.solo_beta_replace_expired_protected_checkout(uuid,text,text)', 'EXECUTE'),
  'Authenticated callers cannot replace a Checkout session');
select ok(not has_column_privilege('service_role', 'public.solo_beta_protected_checkout_attempts', 'create_started_at', 'UPDATE'),
  'A service caller must use the single-use claim');

set local role service_role;

insert into public.solo_beta_protected_checkout_attempts
  (reference_id, provider_livemode, stripe_customer_id, stripe_checkout_id, stripe_price_id, stripe_product_id)
values
  ('7138c991-de3a-47ab-b507-37b2bad8772a', false, 'cus_local_pg', 'cs_test_local_pg', 'price_local_pg', 'prod_local_pg');

select is(public.solo_beta_replace_expired_protected_checkout('7138c991-de3a-47ab-b507-37b2bad8772a',
  'cs_test_local_pg', 'cs_test_replacement'), true, 'The service may bind a replacement before a trial claim');
select is(public.solo_beta_replace_expired_protected_checkout('7138c991-de3a-47ab-b507-37b2bad8772a',
  'cs_test_local_pg', 'cs_test_racing_replacement'), false, 'A stale replacement cannot replace the new session');

select is(public.solo_beta_claim_protected_trial('7138c991-de3a-47ab-b507-37b2bad8772a', 'cs_test_wrong'),
  false, 'A different Checkout session cannot claim the trial');
select is(public.solo_beta_record_protected_trial('7138c991-de3a-47ab-b507-37b2bad8772a', 'cs_test_replacement',
  'sub_local_pg', '2026-10-30 00:00+00', '2026-11-29 00:00+00', '2026-11-02 00:00+00'),
  false, 'Provider evidence cannot be written before a claim');
select is(public.solo_beta_claim_protected_trial('7138c991-de3a-47ab-b507-37b2bad8772a', 'cs_test_replacement'),
  true, 'The bound Checkout session can claim exactly once');
select is(public.solo_beta_claim_protected_trial('7138c991-de3a-47ab-b507-37b2bad8772a', 'cs_test_replacement'),
  false, 'Replay cannot take another create claim');
select is(public.solo_beta_replace_expired_protected_checkout('7138c991-de3a-47ab-b507-37b2bad8772a',
  'cs_test_replacement', 'cs_test_replacement_for_claim'), false, 'A trial claim freezes the Checkout identity');
do $$
begin
  perform public.solo_beta_record_protected_trial_failure('7138c991-de3a-47ab-b507-37b2bad8772a',
    'cs_test_replacement', 'renewal_guard_unverified', 'sub_local_pg');
end $$;
select is((select last_error_code from public.solo_beta_protected_checkout_attempts
  where reference_id = '7138c991-de3a-47ab-b507-37b2bad8772a'),
  'renewal_guard_unverified', 'An unverified renewal guard remains available for recovery');
select is(public.solo_beta_record_protected_trial('7138c991-de3a-47ab-b507-37b2bad8772a', 'cs_test_replacement',
  'sub_local_pg', '2026-10-30 00:00+00', '2026-11-29 00:00+00', '2026-11-02 00:00+00'),
  true, 'The provider readback records the original protected trial');
select is((select last_error_code from public.solo_beta_protected_checkout_attempts
  where reference_id = '7138c991-de3a-47ab-b507-37b2bad8772a'),
  null, 'A successful provider receipt closes the recovery diagnostic');
select is(public.solo_beta_record_protected_trial('7138c991-de3a-47ab-b507-37b2bad8772a', 'cs_test_replacement',
  'sub_local_pg', '2026-10-30 00:00+00', '2026-11-29 00:00+00', '2026-11-02 00:00+00'),
  true, 'Re-recording the identical provider readback is idempotent');
select is(public.solo_beta_record_protected_trial('7138c991-de3a-47ab-b507-37b2bad8772a', 'cs_test_replacement',
  'sub_local_pg_other', '2026-10-30 00:00+00', '2026-11-29 00:00+00', '2026-11-02 00:00+00'),
  false, 'A different provider subscription cannot replace the receipt');

reset role;
select * from finish();
rollback;
