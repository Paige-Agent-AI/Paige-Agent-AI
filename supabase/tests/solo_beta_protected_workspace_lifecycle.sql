begin;
select plan(33);

select ok(not has_function_privilege('anon',
  'public.solo_beta_sync_protected_workspace_lifecycle(uuid,text,text,boolean,text,boolean,timestamptz,timestamptz,timestamptz,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated',
  'public.solo_beta_sync_protected_workspace_lifecycle(uuid,text,text,boolean,text,boolean,timestamptz,timestamptz,timestamptz,boolean)', 'EXECUTE'),
  'protected lifecycle projection is service-only');

insert into public.legal_documents (slug, version, title, body_md, is_current)
values ('saas-standalone', 92212, 'Lifecycle proof terms', 'Synthetic terms', false);
insert into auth.users (id, aud, role, email, created_at, raw_app_meta_data)
values ('b2480000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'workspace-lifecycle-proof@example.invalid', now() - interval '32 days',
  '{"solo_beta_protected_reference":"b2480000-0000-4000-8000-000000000011"}');
insert into public.solo_beta_protected_signup_intake (
  reference_id, resume_secret_hash, primary_email, accepted_documents, accepted_at,
  renewal_consent_version, stripe_product_id, stripe_price_id, provider_livemode,
  return_origin, created_at, owner_user_id, owner_bound_at
) values (
  'b2480000-0000-4000-8000-000000000011', repeat('b', 64), 'workspace-lifecycle-proof@example.invalid',
  '{"saas-standalone":92212}', now() - interval '33 days',
  'solo_beta_v2_email_verified_2026_11', 'prod_v2lifecycleproof', 'price_v2lifecycleproof', false,
  'http://localhost:5173', now() - interval '33 days', 'b2480000-0000-4000-8000-000000000001', now() - interval '1 hour'
);
insert into public.solo_beta_protected_checkout_attempts (
  reference_id, provider_livemode, stripe_customer_id, stripe_checkout_id, stripe_price_id, stripe_product_id,
  create_started_at, stripe_subscription_id, trial_started_at, trial_ends_at, verification_deadline_at,
  checkout_event_id, checkout_event_created_at, checkout_event_digest
) values (
  'b2480000-0000-4000-8000-000000000011', false, 'cus_v2lifecycleproof', 'cs_test_v2lifecycleproof',
  'price_v2lifecycleproof', 'prod_v2lifecycleproof', now() - interval '2 hours', 'sub_v2lifecycleproof',
  now() - interval '2 hours', now() - interval '2 hours' + interval '720 hours', now() - interval '2 hours' + interval '72 hours',
  'evt_v2lifecycleproof', now() - interval '2 hours', repeat('c', 64)
);

set local role service_role;
create temp table protected_lifecycle_proof as
select * from public.solo_beta_prepare_protected_workspace(
  'b2480000-0000-4000-8000-000000000011', repeat('b', 64), 'http://localhost:5173');
select is((select count(*) from protected_lifecycle_proof), 1::bigint, 'one real canonical Solo workspace was prepared');
select ok(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
  'trialing', true, now() - interval '2 minutes', null, null, false),
  'a renewal-held trial synchronizes');
select is((select account_number from public.solo_beta_read_protected_workspace(
  'b2480000-0000-4000-8000-000000000011', 'b2480000-0000-4000-8000-000000000001', false)),
  (select account_number from protected_lifecycle_proof), 'period-end cancellation preserves the unexpired trial workspace');
select is(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_unrelated', false,
  'canceled', true, now() - interval '1 minute', null, null, false), false,
  'an unrelated customer cannot cancel the workspace');
reset role;

-- Expiry belongs to the provisional Meet grant. A held, current Stripe trial
-- must leave the native membership intact for a later verified sign-in.
update public.solo_beta_protected_checkout_attempts
set trial_started_at = now() - interval '73 hours', trial_ends_at = now() + interval '647 hours',
    verification_deadline_at = now() - interval '1 hour'
where reference_id = 'b2480000-0000-4000-8000-000000000011';
update public.platform_subscriptions
set trial_started_at = now() - interval '73 hours', trial_ends_at = now() + interval '647 hours',
    current_period_start = now() - interval '73 hours', current_period_end = now() + interval '647 hours'
where stripe_subscription_id = 'sub_v2lifecycleproof';
update public.user_subscriptions
set trial_ends_at = now() + interval '647 hours',
    current_period_start = now() - interval '73 hours', current_period_end = now() + interval '647 hours'
where stripe_subscription_id = 'sub_v2lifecycleproof';
select ok(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
  'trialing', true, now() - interval '90 seconds', null, null, false),
  'a renewal-held trial still synchronizes after the provisional deadline');
select is((select m.status from public.tenant_members m join protected_lifecycle_proof w on w.tenant_id = m.tenant_id
  and w.owner_user_id = m.user_id), 'active', 'the billing webhook does not suspend a current held trial on email deadline alone');
select is((select count(*) from public.solo_beta_read_protected_workspace(
  'b2480000-0000-4000-8000-000000000011', 'b2480000-0000-4000-8000-000000000001', false)), 0::bigint,
  'the provisional workspace read expires even though the membership remains active');
update auth.users set email_confirmed_at = now()
where id = 'b2480000-0000-4000-8000-000000000001';
select is((select account_number from public.solo_beta_read_protected_workspace(
  'b2480000-0000-4000-8000-000000000011', 'b2480000-0000-4000-8000-000000000001', false)),
  (select account_number from protected_lifecycle_proof), 'late verification restores the same trial workspace without a new provider event');
select ok((select cancel_at_period_end from public.platform_subscriptions where stripe_subscription_id = 'sub_v2lifecycleproof'),
  'late verification leaves the renewal hold in place');
select ok(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
  'trialing', false, now() - interval '90 seconds', null, null, false),
  'a conflicting read from the same Stripe second is acknowledged safely');
select ok((select a.provider_cancel_at_period_end and s.cancel_at_period_end
  from public.solo_beta_protected_checkout_attempts a
  join public.platform_subscriptions s using (stripe_subscription_id)
  where s.stripe_subscription_id = 'sub_v2lifecycleproof'),
  'a same-second read cannot release the recorded hold');
select ok(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
  'trialing', false, now() - interval '89 seconds', null, null, false),
  'a newer exact Stripe read can release the hold');
select ok((select not a.provider_cancel_at_period_end and not s.cancel_at_period_end
  from public.solo_beta_protected_checkout_attempts a
  join public.platform_subscriptions s using (stripe_subscription_id)
  where s.stripe_subscription_id = 'sub_v2lifecycleproof'),
  'both billing records reflect the newer renewal observation');
do $$ begin
  perform public.solo_beta_sync_protected_workspace_lifecycle(
    'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
    'trialing', true, now() - interval '88 seconds', null, null, false);
end $$;
update auth.users set email_confirmed_at = null
where id = 'b2480000-0000-4000-8000-000000000001';

-- Advance only the rollback fixture past the verified trial end. This models
-- the provider clock without rewriting historical evidence in the product.
update public.solo_beta_protected_checkout_attempts
set trial_started_at = now() - interval '721 hours', trial_ends_at = now() - interval '1 hour',
    verification_deadline_at = now() - interval '649 hours'
where reference_id = 'b2480000-0000-4000-8000-000000000011';
update public.platform_subscriptions
set trial_started_at = now() - interval '721 hours', trial_ends_at = now() - interval '1 hour',
    current_period_start = now() - interval '721 hours', current_period_end = now() - interval '1 hour'
where stripe_subscription_id = 'sub_v2lifecycleproof';
update public.user_subscriptions
set trial_ends_at = now() - interval '1 hour',
    current_period_start = now() - interval '721 hours', current_period_end = now() - interval '1 hour'
where stripe_subscription_id = 'sub_v2lifecycleproof';

select ok(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
  'active', false, now() - interval '1 minute', now() - interval '1 hour', now() + interval '719 hours', true),
  'provider state for an unverified owner is recorded');
select is((select status from public.platform_subscriptions where stripe_subscription_id = 'sub_v2lifecycleproof'),
  'trialing', 'even paid provider evidence cannot promote an unverified owner');
select is((select m.status from public.tenant_members m join protected_lifecycle_proof w on w.tenant_id = m.tenant_id
  and w.owner_user_id = m.user_id), 'suspended', 'the expired workspace is held without verified enrollment authority');

update auth.users set email_confirmed_at = now() - interval '2 days'
where id = 'b2480000-0000-4000-8000-000000000001';
select ok(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
  'active', false, now() - interval '1 minute', now() - interval '1 hour', now() + interval '719 hours', false),
  'unpaid active provider state is recorded without promotion');
select is((select status from public.platform_subscriptions where stripe_subscription_id = 'sub_v2lifecycleproof'),
  'trialing', 'active status alone does not convert an expired trial into a paid entitlement');
select ok(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
  'active', false, now() - interval '1 minute', now() - interval '1 hour', now() + interval '719 hours', true),
  'paid period evidence promotes exactly the linked verified owner');
select ok(exists (
  select 1 from public.platform_subscriptions s join public.user_subscriptions us
    on us.stripe_subscription_id = s.stripe_subscription_id
  where s.stripe_subscription_id = 'sub_v2lifecycleproof' and us.user_id = 'b2480000-0000-4000-8000-000000000001'
    and s.status = 'active' and us.status = 'active' and s.current_period_end = us.current_period_end
    and s.current_period_end = now() + interval '719 hours'
), 'the exact paid period is carried by both canonical entitlement rows');
select is((select account_number from public.solo_beta_read_protected_workspace(
  'b2480000-0000-4000-8000-000000000011', 'b2480000-0000-4000-8000-000000000001', false)),
  (select account_number from protected_lifecycle_proof), 'verified return reads the original account number after billing recovery');

select ok(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
  'past_due', false, now(), null, null, false), 'an exact past-due observation is accepted');
select ok(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
  'active', false, now(), now() - interval '1 hour', now() + interval '719 hours', false),
  'a same-second active observation without payment is safely acknowledged');
select is((select status from public.platform_subscriptions where stripe_subscription_id = 'sub_v2lifecycleproof'),
  'past_due', 'the conservative same-second observation remains until evidence proves payment');
select ok(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
  'active', false, now(), now() - interval '1 hour', now() + interval '719 hours', true),
  'the paid period can reconcile an earlier same-second past-due observation');
select is((select m.status from public.tenant_members m join protected_lifecycle_proof w on w.tenant_id = m.tenant_id
  and w.owner_user_id = m.user_id), 'active', 'paid reconciliation restores the billing-held owner only');

update public.tenant_members m set status = 'suspended'
where m.tenant_id = (select tenant_id from protected_lifecycle_proof)
  and m.user_id = 'b2480000-0000-4000-8000-000000000001';
select ok(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
  'active', false, now(), now() - interval '1 hour', now() + interval '719 hours', true),
  'a paid refresh is accepted for an independently suspended membership');
select is((select m.status from public.tenant_members m join protected_lifecycle_proof w on w.tenant_id = m.tenant_id
  and w.owner_user_id = m.user_id), 'suspended', 'a billing refresh never undoes an independent suspension');
update public.tenant_members m set status = 'active'
where m.tenant_id = (select tenant_id from protected_lifecycle_proof)
  and m.user_id = 'b2480000-0000-4000-8000-000000000001';
select ok(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
  'canceled', false, now(), null, null, false), 'real cancellation is written to the workspace');
select ok(public.solo_beta_sync_protected_workspace_lifecycle(
  'b2480000-0000-4000-8000-000000000011', 'sub_v2lifecycleproof', 'cus_v2lifecycleproof', false,
  'active', false, now() - interval '1 minute', now() - interval '1 hour', now() + interval '719 hours', true),
  'a stale active delivery is safe to acknowledge');
select ok(exists (
  select 1 from public.user_subscriptions us join public.platform_subscriptions s
    on s.stripe_subscription_id = us.stripe_subscription_id
  join public.tenant_members m on m.tenant_id = s.tenant_id and m.user_id = us.user_id
  where s.stripe_subscription_id = 'sub_v2lifecycleproof' and s.status = 'canceled'
    and us.status = 'canceled' and m.status = 'suspended'
), 'terminal state synchronizes both entitlement rows and suspends the exact owner');
select is((select count(*) from public.solo_beta_read_protected_workspace(
  'b2480000-0000-4000-8000-000000000011', 'b2480000-0000-4000-8000-000000000001', false)), 0::bigint,
  'terminal entitlement cannot open the old workspace on return');

select * from finish();
rollback;
