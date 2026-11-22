BEGIN;
SELECT plan(26);

SELECT is((SELECT unit_amount_cents FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1'),7450,'offer amount is exactly 7450 cents');
SELECT is((SELECT currency FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1'),'usd','offer currency is usd');
SELECT is((SELECT billing_interval FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1'),'month','offer is monthly');
SELECT is((SELECT interval_count FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1'),1,'offer interval count is one');
SELECT is((SELECT trial_days FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1'),30,'offer has exactly one 30-day trial');
SELECT is((SELECT provider_mode FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1'),'live','offer is live mode only');
SELECT is((SELECT account_type FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1'),'standalone','offer provisions only the Solo standalone account type');
SELECT is((SELECT stripe_account FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1'),'legacy','offer is pinned to the approved Stripe account contract');
SELECT is((SELECT p.slug FROM public.platform_subscription_offers o JOIN public.platform_subscription_plans p ON p.id=o.plan_id WHERE o.offer_code='paige-solo-beta-monthly-v1'),'solo','offer is bound only to the canonical Solo plan');
SELECT is((SELECT status FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1'),'live_ready','offer is ready only after live provider identifiers are configured');
SELECT ok((SELECT stripe_product_id IS NOT NULL AND stripe_price_id IS NOT NULL FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1'),'canonical server configuration binds the verified live provider objects');
SELECT is((SELECT count(*)::integer FROM public.platform_subscription_offers WHERE status='live_ready'),1,'The original Solo Beta offer is the only live enrollment offer during rollout');
SELECT ok(NOT has_table_privilege('authenticated','public.platform_subscription_offers','SELECT'),'browser cannot read provider offer identifiers');
SELECT ok(NOT has_table_privilege('authenticated','public.solo_beta_enrollments','SELECT'),'browser cannot read enrollment authority rows');
SELECT ok(NOT has_table_privilege('authenticated','public.solo_beta_fulfillment_receipts','SELECT'),'browser cannot read fulfillment receipts directly');
SELECT ok(NOT has_function_privilege('authenticated','public.solo_beta_claim_checkout(uuid)','EXECUTE'),'browser cannot claim checkout attempts');
SELECT ok(NOT has_function_privilege('authenticated','public.solo_beta_claim_stripe_event(text,text,boolean,text,uuid,text,text,text,timestamptz)','EXECUTE'),'browser cannot claim Stripe events');
SELECT ok(NOT has_function_privilege('authenticated','public.solo_beta_fulfill_checkout(text,uuid,integer,uuid,text,text,text,text,text,boolean,integer,text,text,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean)','EXECUTE'),'browser cannot fulfill an entitlement');
SELECT ok(has_function_privilege('service_role','public.solo_beta_fulfill_checkout(text,uuid,integer,uuid,text,text,text,text,text,boolean,integer,text,text,integer,text,timestamptz,timestamptz,timestamptz,timestamptz,boolean)','EXECUTE'),'service role retains atomic fulfillment');
SELECT throws_ok(
  $$SELECT * FROM public.solo_beta_claim_stripe_event('evt_test_rejected','checkout.session.completed',false,'digest','00000000-0000-0000-0000-000000000001','cs_test','sub_test','cus_test',now())$$,
  'P0001','solo_beta_event_not_eligible','test events fail closed before processing'
);
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stripe_event_log' AND policyname='admins read stripe_event_log'),'tenant-admin cross-account event policy is removed');
SELECT ok(EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stripe_event_log' AND policyname='stripe_event_log_platform_owner_read'),'platform-owner-only event read policy exists');

-- Lifecycle convergence must change the membership authorization boundary in
-- the same database transaction as the canonical subscription records.
INSERT INTO auth.users (id,aud,role,email) VALUES
  ('b1910000-0000-0000-0000-000000000001','authenticated','authenticated','solo-lifecycle-proof@tests.invalid');
INSERT INTO public.tenants
  (id,slug,name,status,account_type,account_number_prefix,account_number,features,brand)
VALUES
  ('b1910000-0000-0000-0000-00000000aaaa','solo-lifecycle-proof','Solo Lifecycle Proof','active','standalone','SLP',8919003,'{}'::jsonb,'{}'::jsonb);
INSERT INTO public.tenant_members (tenant_id,user_id,role,status,is_owner,joined_at) VALUES
  ('b1910000-0000-0000-0000-00000000aaaa','b1910000-0000-0000-0000-000000000001','owner','active',true,now());
INSERT INTO public.platform_subscriptions (
  tenant_id,plan_id,status,billing_period,current_period_start,current_period_end,
  stripe_subscription_id,stripe_customer_id,offer_code,provider_mode,
  stripe_product_id,stripe_price_id,trial_started_at,trial_ends_at,provider_verified_at
) SELECT
  'b1910000-0000-0000-0000-00000000aaaa',plan_id,'active','monthly',
  '2026-08-31 00:00:00+00','2026-09-30 00:00:00+00','sub_solo_lifecycle_proof',
  'cus_solo_lifecycle_proof','paige-solo-beta-monthly-v1','live',
  'prod_solo_lifecycle_proof','price_solo_lifecycle_proof',
  '2026-08-01 00:00:00+00','2026-08-31 00:00:00+00',now()
FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1';
INSERT INTO public.user_subscriptions (
  user_id,plan_slug,status,trial_ends_at,current_period_start,current_period_end,stripe_subscription_id
) VALUES (
  'b1910000-0000-0000-0000-000000000001','solo','active','2026-08-31 00:00:00+00',
  '2026-08-31 00:00:00+00','2026-09-30 00:00:00+00','sub_solo_lifecycle_proof'
);
INSERT INTO public.solo_beta_enrollments (
  user_id,offer_code,state,stripe_customer_id,stripe_subscription_id,tenant_id
) VALUES (
  'b1910000-0000-0000-0000-000000000001','paige-solo-beta-monthly-v1','fulfilled',
  'cus_solo_lifecycle_proof','sub_solo_lifecycle_proof','b1910000-0000-0000-0000-00000000aaaa'
);
INSERT INTO public.stripe_event_log (
  event_id,type,livemode,payload_digest,lifecycle_state,offer_code,owner_user_id,
  stripe_subscription_id,stripe_customer_id,provider_created_at,validated_at,processing_at,attempt_count
) VALUES (
  'evt_solo_lifecycle_failed','invoice.payment_failed',true,'digest-failed','processing',
  'paige-solo-beta-monthly-v1','b1910000-0000-0000-0000-000000000001',
  'sub_solo_lifecycle_proof','cus_solo_lifecycle_proof','2026-09-01 00:00:00+00',now(),now(),1
);

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$SELECT public.solo_beta_sync_subscription(
    'evt_solo_lifecycle_failed','invoice.payment_failed','2026-09-01 00:00:00+00',
    'sub_solo_lifecycle_proof','cus_solo_lifecycle_proof','b1910000-0000-0000-0000-000000000001',
    'prod_solo_lifecycle_proof','price_solo_lifecycle_proof',true,7450,'usd','month',1,'past_due',
    '2026-08-31 00:00:00+00','2026-09-30 00:00:00+00',
    '2026-08-01 00:00:00+00','2026-08-31 00:00:00+00',false
  )$$,
  'verified payment failure converges the canonical lifecycle atomically'
);
RESET ROLE;
SELECT is(
  (SELECT status FROM public.tenant_members
   WHERE tenant_id='b1910000-0000-0000-0000-00000000aaaa' AND user_id='b1910000-0000-0000-0000-000000000001'),
  'suspended','payment recovery suspends the Solo owner membership authorization boundary'
);

INSERT INTO public.stripe_event_log (
  event_id,type,livemode,payload_digest,lifecycle_state,offer_code,owner_user_id,
  stripe_subscription_id,stripe_customer_id,provider_created_at,validated_at,processing_at,attempt_count
) VALUES (
  'evt_solo_lifecycle_recovered','customer.subscription.updated',true,'digest-recovered','processing',
  'paige-solo-beta-monthly-v1','b1910000-0000-0000-0000-000000000001',
  'sub_solo_lifecycle_proof','cus_solo_lifecycle_proof','2026-09-02 00:00:00+00',now(),now(),1
);
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$SELECT public.solo_beta_sync_subscription(
    'evt_solo_lifecycle_recovered','customer.subscription.updated','2026-09-02 00:00:00+00',
    'sub_solo_lifecycle_proof','cus_solo_lifecycle_proof','b1910000-0000-0000-0000-000000000001',
    'prod_solo_lifecycle_proof','price_solo_lifecycle_proof',true,7450,'usd','month',1,'active',
    '2026-08-31 00:00:00+00','2026-09-30 00:00:00+00',
    '2026-08-01 00:00:00+00','2026-08-31 00:00:00+00',false
  )$$,
  'verified active recovery restores all canonical lifecycle records atomically'
);
RESET ROLE;
SELECT is(
  (SELECT status FROM public.tenant_members
   WHERE tenant_id='b1910000-0000-0000-0000-00000000aaaa' AND user_id='b1910000-0000-0000-0000-000000000001'),
  'active','verified active recovery restores the Solo owner membership authorization boundary'
);

SELECT * FROM finish();
ROLLBACK;
