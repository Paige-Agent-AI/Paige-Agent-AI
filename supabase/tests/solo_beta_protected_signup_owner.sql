begin;
select plan(14);

select ok(not has_function_privilege('anon', 'public.solo_beta_read_protected_owner(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.solo_beta_read_protected_owner(uuid,text,text)', 'EXECUTE'),
  'Only the service can recover a protected Auth identity');
select ok(not has_function_privilege('anon', 'public.solo_beta_bind_protected_owner(uuid,text,text,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.solo_beta_bind_protected_owner(uuid,text,text,uuid)', 'EXECUTE'),
  'Only the service can bind a protected Auth identity');

insert into public.solo_beta_protected_signup_intake
  (reference_id, resume_secret_hash, primary_email, accepted_documents, accepted_at,
    renewal_consent_version, stripe_product_id, stripe_price_id, provider_livemode, return_origin, created_at)
values
  ('bc51e8d9-72a5-491a-aa44-51602c002311', repeat('a',64), 'protected-owner-pgtap@example.invalid', '{"privacy":1}', now(),
    'solo_beta_v2_email_verified_2026_11', 'prod_exp00owner', 'price_exp00owner', true, 'https://paigeagent.ai', now()),
  ('bc51e8d9-72a5-491a-aa44-51602c002312', repeat('b',64), 'protected-test-pgtap@example.invalid', '{"privacy":1}', now(),
    'solo_beta_v2_email_verified_2026_11', 'prod_exp00owner', 'price_exp00owner', false, 'https://paigeagent.ai', now()),
  ('bc51e8d9-72a5-491a-aa44-51602c002313', repeat('c',64), 'protected-expired-pgtap@example.invalid', '{"privacy":1}', now() - interval '4 days',
    'solo_beta_v2_email_verified_2026_11', 'prod_exp00owner', 'price_exp00owner', true, 'https://paigeagent.ai', now() - interval '4 days'),
  ('bc51e8d9-72a5-491a-aa44-51602c002315', repeat('e',64), 'protected-loopback-pgtap@example.invalid', '{"privacy":1}', now(),
    'solo_beta_v2_email_verified_2026_11', 'prod_exp00owner', 'price_exp00owner', false, 'http://localhost:5173', now());

insert into public.solo_beta_protected_checkout_attempts
  (reference_id, provider_livemode, stripe_customer_id, stripe_checkout_id, stripe_price_id, stripe_product_id,
    create_started_at, stripe_subscription_id, trial_started_at, trial_ends_at, verification_deadline_at)
values
  ('bc51e8d9-72a5-491a-aa44-51602c002311', true, 'cus_ownerpgtap', 'cs_live_ownerpgtap', 'price_exp00owner', 'prod_exp00owner',
    now(), 'sub_ownerpgtap', now(), now() + interval '720 hours', now() + interval '72 hours'),
  ('bc51e8d9-72a5-491a-aa44-51602c002312', false, 'cus_testpgtap', 'cs_test_ownerpgtap', 'price_exp00owner', 'prod_exp00owner',
    now(), 'sub_testpgtap', now(), now() + interval '720 hours', now() + interval '72 hours'),
  ('bc51e8d9-72a5-491a-aa44-51602c002313', true, 'cus_expiredpgtap', 'cs_live_expiredpgtap', 'price_exp00owner', 'prod_exp00owner',
    now() - interval '4 days', 'sub_expiredpgtap', now() - interval '4 days', now() - interval '4 days' + interval '720 hours', now() - interval '4 days' + interval '72 hours'),
  ('bc51e8d9-72a5-491a-aa44-51602c002315', false, 'cus_loopbackpgtap', 'cs_test_loopbackpgtap', 'price_exp00owner', 'prod_exp00owner',
    now(), 'sub_loopbackpgtap', now(), now() + interval '720 hours', now() + interval '72 hours');

insert into auth.users (id, aud, role, email, created_at, raw_app_meta_data)
values
  ('bc51e8d9-72a5-491a-aa44-51602c002314', 'authenticated', 'authenticated', 'protected-owner-pgtap@example.invalid',
    now(), '{"solo_beta_protected_reference":"another-attempt"}'),
  ('bc51e8d9-72a5-491a-aa44-51602c002316', 'authenticated', 'authenticated', 'protected-expired-pgtap@example.invalid',
    now() - interval '4 days', '{"solo_beta_protected_reference":"bc51e8d9-72a5-491a-aa44-51602c002313"}');

set local role service_role;
select is((select count(*) from public.solo_beta_read_protected_owner('bc51e8d9-72a5-491a-aa44-51602c002311',
  repeat('d',64), 'https://paigeagent.ai')), 0::bigint, 'A different resume secret returns no identity');
select is((select count(*) from public.solo_beta_read_protected_owner('bc51e8d9-72a5-491a-aa44-51602c002311',
  repeat('a',64), 'https://app.paigeagent.ai')), 0::bigint, 'A different allowed origin cannot recover this intake');
select is((select count(*) from public.solo_beta_read_protected_owner('bc51e8d9-72a5-491a-aa44-51602c002312',
  repeat('b',64), 'https://paigeagent.ai')), 0::bigint, 'A matched sandbox pair cannot prepare a live owner');
select is((select primary_email from public.solo_beta_read_protected_owner('bc51e8d9-72a5-491a-aa44-51602c002315',
  repeat('e',64), 'http://localhost:5173')), 'protected-loopback-pgtap@example.invalid', 'A matched sandbox pair can prepare its loopback owner');
select is((select count(*) from public.solo_beta_read_protected_owner('bc51e8d9-72a5-491a-aa44-51602c002315',
  repeat('e',64), 'https://paigeagent.ai')), 0::bigint, 'The loopback grant cannot prepare an owner on the public origin');
select is((select count(*) from public.solo_beta_read_protected_owner('bc51e8d9-72a5-491a-aa44-51602c002313',
  repeat('c',64), 'https://paigeagent.ai')), 0::bigint, 'An expired window cannot bind a previously created but unbound identity');
select is(public.solo_beta_bind_protected_owner('bc51e8d9-72a5-491a-aa44-51602c002311', repeat('a',64),
  'https://paigeagent.ai', 'bc51e8d9-72a5-491a-aa44-51602c002314'), false, 'An email match cannot bind a differently marked user');
reset role;

update auth.users set raw_app_meta_data = '{"solo_beta_protected_reference":"bc51e8d9-72a5-491a-aa44-51602c002311"}'
where id = 'bc51e8d9-72a5-491a-aa44-51602c002314';
set local role service_role;
select is(public.solo_beta_bind_protected_owner('bc51e8d9-72a5-491a-aa44-51602c002311', repeat('a',64),
  'https://paigeagent.ai', 'bc51e8d9-72a5-491a-aa44-51602c002314'), true, 'The server-marked owner binds');
select is(public.solo_beta_bind_protected_owner('bc51e8d9-72a5-491a-aa44-51602c002311', repeat('a',64),
  'https://paigeagent.ai', 'bc51e8d9-72a5-491a-aa44-51602c002314'), true, 'A replay returns the same owner');
select is((select email_verified from public.solo_beta_read_protected_owner('bc51e8d9-72a5-491a-aa44-51602c002311',
  repeat('a',64), 'https://paigeagent.ai')), false, 'The binding itself does not verify email');
reset role;

delete from auth.users where id = 'bc51e8d9-72a5-491a-aa44-51602c002314';
set local role service_role;
select is((select accepted_documents from public.solo_beta_protected_signup_intake
  where reference_id = 'bc51e8d9-72a5-491a-aa44-51602c002311'), '{"privacy":1}'::jsonb, 'Auth deletion preserves the original acceptance');
select is((select count(*) from public.solo_beta_read_protected_owner('bc51e8d9-72a5-491a-aa44-51602c002311',
  repeat('a',64), 'https://paigeagent.ai')), 0::bigint, 'A deleted owner cannot be recovered or replaced with the grant');
reset role;

select * from finish();
rollback;
