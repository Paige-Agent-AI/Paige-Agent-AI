begin;
select plan(17);

select ok(not has_function_privilege('anon', 'public.solo_beta_prepare_protected_workspace(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.solo_beta_prepare_protected_workspace(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.solo_beta_read_protected_workspace(uuid,uuid,boolean)', 'EXECUTE'),
  'workspace provisioning and exact readback are service-only');

insert into public.legal_documents (slug, version, title, body_md, is_current)
values ('saas-standalone', 92211, 'Protected signup proof terms', 'Synthetic terms', false),
       ('privacy', 92211, 'Protected signup proof privacy', 'Synthetic privacy terms', false);

insert into auth.users (id, aud, role, email, created_at, raw_app_meta_data)
values ('b2460000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'workspace-v2-proof@example.invalid', now() - interval '1 hour',
  '{"solo_beta_protected_reference":"b2460000-0000-4000-8000-000000000011"}');

insert into public.solo_beta_protected_signup_intake (
  reference_id, resume_secret_hash, primary_email, accepted_documents, accepted_at,
  renewal_consent_version, stripe_product_id, stripe_price_id, provider_livemode,
  return_origin, created_at, owner_user_id, owner_bound_at
) values (
  'b2460000-0000-4000-8000-000000000011', repeat('a', 64), 'workspace-v2-proof@example.invalid',
  '{"saas-standalone":92211,"privacy":92211}', now() - interval '2 hours',
  'solo_beta_v2_email_verified_2026_11', 'prod_v2workspaceproof', 'price_v2workspaceproof', false,
  'http://localhost:5173', now() - interval '2 hours', 'b2460000-0000-4000-8000-000000000001', now() - interval '1 hour'
);
insert into public.solo_beta_protected_checkout_attempts (
  reference_id, provider_livemode, stripe_customer_id, stripe_checkout_id, stripe_price_id, stripe_product_id,
  create_started_at, stripe_subscription_id, trial_started_at, trial_ends_at, verification_deadline_at
) values (
  'b2460000-0000-4000-8000-000000000011', false, 'cus_v2workspaceproof', 'cs_test_v2workspaceproof',
  'price_v2workspaceproof', 'prod_v2workspaceproof', now() - interval '2 hours', 'sub_v2workspaceproof',
  now() - interval '2 hours', now() - interval '2 hours' + interval '720 hours', now() - interval '2 hours' + interval '72 hours'
);

set local role service_role;
select is((select count(*) from public.solo_beta_prepare_protected_workspace(
  'b2460000-0000-4000-8000-000000000011', repeat('a', 64), 'http://localhost:5173')), 0::bigint,
  'a trial without the signed Checkout event cannot provision');
select ok(public.solo_beta_bind_protected_checkout_event(
  'cs_test_v2workspaceproof', 'sub_v2workspaceproof', false, 'evt_v2workspaceproof', now() - interval '2 hours', repeat('c', 64)),
  'signed event provenance binds the exact protected Checkout and subscription');
select is((select count(*) from public.solo_beta_prepare_protected_workspace(
  'b2460000-0000-4000-8000-000000000011', repeat('d', 64), 'http://localhost:5173')), 0::bigint,
  'a wrong grant cannot provision');
select is((select count(*) from public.solo_beta_prepare_protected_workspace(
  'b2460000-0000-4000-8000-000000000011', repeat('a', 64), 'https://paigeagent.ai')), 0::bigint,
  'an unrelated origin cannot provision a sandbox Checkout');

create temp table protected_workspace_proof as
select * from public.solo_beta_prepare_protected_workspace(
  'b2460000-0000-4000-8000-000000000011', repeat('a', 64), 'http://localhost:5173');
select is((select count(*) from protected_workspace_proof), 1::bigint, 'the unverified bound owner provisions one Solo workspace');
select is((select tenant_id from public.solo_beta_prepare_protected_workspace(
  'b2460000-0000-4000-8000-000000000011', repeat('a', 64), 'http://localhost:5173')),
  (select tenant_id from protected_workspace_proof), 'replay returns the original workspace');
select is((select count(*) from public.solo_beta_read_protected_workspace(
  'b2460000-0000-4000-8000-000000000011', 'b2460000-0000-4000-8000-000000000009', false)), 0::bigint,
  'another owner cannot read the workspace through this enrollment');
select is((select count(*) from public.solo_beta_read_protected_workspace(
  'b2460000-0000-4000-8000-000000000011', 'b2460000-0000-4000-8000-000000000001', true)), 0::bigint,
  'a sandbox workspace cannot pass a live readback');
reset role;

select is((select count(*) from public.tenants t where t.owner_user_id = 'b2460000-0000-4000-8000-000000000001'
  and t.account_type = 'standalone' and t.parent_tenant_id is null), 1::bigint, 'one top-level Solo tenant persists');
select ok(exists (select 1 from public.tenant_members m join protected_workspace_proof w on w.tenant_id = m.tenant_id
  where m.user_id = w.owner_user_id and m.is_owner and m.status = 'active'), 'the canonical native owner membership persists');
select is((select count(*) from public.user_subscriptions s where s.user_id = 'b2460000-0000-4000-8000-000000000001'
  and s.plan_slug = 'solo' and s.status = 'trialing' and s.stripe_subscription_id = 'sub_v2workspaceproof'), 1::bigint,
  'one Solo entitlement is tied to the exact trial');
select ok(exists (select 1 from public.platform_subscriptions s join protected_workspace_proof w on w.tenant_id = s.tenant_id
  where s.offer_code = 'paige-solo-beta-monthly-v2' and s.provider_mode = 'test' and s.cancel_at_period_end),
  'the platform subscription retains the renewal hold and provider mode');
select is((select count(*) from public.solo_beta_fulfillment_receipts r join protected_workspace_proof w on w.tenant_id = r.tenant_id
  where r.event_id = 'evt_v2workspaceproof' and r.user_id = w.owner_user_id and r.outcome = 'completed'), 1::bigint,
  'one fulfillment receipt links the signed event to the same owner and workspace');
select is((select count(*) from public.legal_acceptances a where a.user_id = 'b2460000-0000-4000-8000-000000000001'
  and a.document_version = 92211 and a.accepted_at = now() - interval '2 hours'), 2::bigint,
  'the original accepted terms and timestamp survive a document rotation');

select ok(public.solo_beta_record_protected_lifecycle(
  'b2460000-0000-4000-8000-000000000011', 'sub_v2workspaceproof', 'cus_v2workspaceproof', false, 'canceled', true, now()),
  'canceled provider state is recorded');
select is((select count(*) from public.solo_beta_read_protected_workspace(
  'b2460000-0000-4000-8000-000000000011', 'b2460000-0000-4000-8000-000000000001', false)), 0::bigint,
  'canceled provider state closes workspace readback');

select * from finish();
rollback;
