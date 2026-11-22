begin;
select plan(9);

insert into public.solo_beta_protected_signup_intake
  (reference_id, resume_secret_hash, primary_email, accepted_documents, accepted_at,
    renewal_consent_version, stripe_product_id, stripe_price_id, provider_livemode, return_origin)
values
  ('bc51e8d9-72a5-491a-aa44-51602c002331', repeat('a',64), 'checkout-event-one@example.invalid', '{"privacy":1}', now(),
    'solo_beta_v2_email_verified_2026_11', 'prod_checkoutreceipt', 'price_checkoutreceipt', false, 'http://localhost:5173'),
  ('bc51e8d9-72a5-491a-aa44-51602c002332', repeat('b',64), 'checkout-event-two@example.invalid', '{"privacy":1}', now(),
    'solo_beta_v2_email_verified_2026_11', 'prod_checkoutreceipt', 'price_checkoutreceipt', false, 'http://localhost:5173');
insert into public.solo_beta_protected_checkout_attempts
  (reference_id, provider_livemode, stripe_customer_id, stripe_checkout_id, stripe_price_id, stripe_product_id,
    create_started_at, stripe_subscription_id, trial_started_at, trial_ends_at, verification_deadline_at)
values
  ('bc51e8d9-72a5-491a-aa44-51602c002331', false, 'cus_checkoutreceipt1', 'cs_test_checkoutreceipt1',
    'price_checkoutreceipt', 'prod_checkoutreceipt', now(), 'sub_checkoutreceipt1', now(),
    now() + interval '720 hours', now() + interval '72 hours'),
  ('bc51e8d9-72a5-491a-aa44-51602c002332', false, 'cus_checkoutreceipt2', 'cs_test_checkoutreceipt2',
    'price_checkoutreceipt', 'prod_checkoutreceipt', now(), 'sub_checkoutreceipt2', now(),
    now() + interval '720 hours', now() + interval '72 hours');

select ok(not has_function_privilege('anon',
  'public.solo_beta_bind_protected_checkout_event(text,text,boolean,text,timestamptz,text)', 'EXECUTE'),
  'Anonymous users cannot bind signed provider events');
set local role service_role;
select is(public.solo_beta_bind_protected_checkout_event('cs_test_checkoutreceipt1', 'sub_checkoutreceipt1', true,
  'evt_checkoutreceipt', now(), repeat('c',64)), false, 'A different provider mode is refused');
select is(public.solo_beta_bind_protected_checkout_event('cs_test_checkoutreceipt1', 'sub_checkoutreceipt2', false,
  'evt_checkoutreceipt', now(), repeat('c',64)), false, 'A different subscription is refused');
select is(public.solo_beta_bind_protected_checkout_event('cs_test_checkoutreceipt1', 'sub_checkoutreceipt1', false,
  'evt_checkoutreceipt', now(), 'invalid'), false, 'Incomplete provenance is refused');
select is(public.solo_beta_bind_protected_checkout_event('cs_test_checkoutreceipt1', 'sub_checkoutreceipt1', false,
  'evt_checkoutreceipt', now(), repeat('c',64)), true, 'The original event is bound to its exact recorded trial');
select is(public.solo_beta_bind_protected_checkout_event('cs_test_checkoutreceipt1', 'sub_checkoutreceipt1', false,
  'evt_checkoutreceipt', now(), repeat('c',64)), true, 'A replay of the exact event succeeds');
select is(public.solo_beta_bind_protected_checkout_event('cs_test_checkoutreceipt1', 'sub_checkoutreceipt1', false,
  'evt_checkoutreceipt', now(), repeat('d',64)), false, 'Conflicting evidence under the same event ID is refused');
select is(public.solo_beta_bind_protected_checkout_event('cs_test_checkoutreceipt2', 'sub_checkoutreceipt2', false,
  'evt_checkoutreceipt', now(), repeat('c',64)), false, 'An event cannot bind to a second checkout');
select is((select checkout_event_id from public.solo_beta_protected_checkout_attempts
  where stripe_checkout_id = 'cs_test_checkoutreceipt1'), 'evt_checkoutreceipt', 'Original provenance survives attempted replacement');
reset role;
select * from finish();
rollback;
