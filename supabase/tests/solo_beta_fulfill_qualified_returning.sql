-- EXP00 regression (2026-10-18): the live Solo Beta fulfillment failed on its
-- FIRST-EVER execution with `column reference "reference_id" is ambiguous`
-- because the RETURNS TABLE output parameter collided with the unqualified
-- `RETURNING reference_id` in the enrollment update. This test drives the REAL
-- claim → fulfill sequence with a fully-eligible fixture, so the ambiguity (or
-- any future break of the fulfillment write path) fails CI instead of the first
-- paying customer.
BEGIN;
SELECT plan(9);

INSERT INTO auth.users(id,aud,role,email,raw_user_meta_data)
VALUES('b2040000-0000-0000-0000-000000000001','authenticated','authenticated',
       'solo-fulfill-proof@tests.invalid','{"full_name":"Solo Fulfill Proof"}'::jsonb);
UPDATE public.profiles SET full_name='Solo Fulfill Proof',
  consent_privacy_policy=true,consent_data_usage=true,consent_timestamp=now()
WHERE user_id='b2040000-0000-0000-0000-000000000001';

INSERT INTO public.signup_intake(
  user_id,business_name,industry,team_size,who_you_help,plan_slug,billing_period,
  account_type,agreement_slug,agreement_version,terms_accepted_at
) VALUES(
  'b2040000-0000-0000-0000-000000000001','Fulfill Proof Advisory','Consulting','2–5',
  'small businesses','solo','monthly','standalone','saas-standalone',
  (SELECT min(version) FROM public.legal_documents WHERE slug='saas-standalone' AND is_current),
  now()
);
INSERT INTO public.legal_acceptances(user_id,document_slug,document_version,context)
SELECT 'b2040000-0000-0000-0000-000000000001','saas-standalone',min(version),
  jsonb_build_object('via','test')
FROM public.legal_documents WHERE slug='saas-standalone' AND is_current;

-- Checkout lifecycle up to the fulfilled-pending point, exactly as the webhook
-- sequence drives it: claim a checkout attempt, open it, then claim the Stripe
-- event (which stamps the enrollment verification_pending + event 'processing').
SELECT is((SELECT (r).claimed FROM public.solo_beta_claim_checkout('b2040000-0000-0000-0000-000000000001') r),
  true,'checkout attempt claimed');

UPDATE public.solo_beta_enrollments
SET state='checkout_open',
    stripe_customer_id='cus_solo_fulfill_proof',
    checkout_session_id='cs_live_solo_fulfill_proof'
WHERE user_id='b2040000-0000-0000-0000-000000000001';

SELECT is((SELECT (r).claimed
  FROM public.solo_beta_claim_stripe_event(
    'evt_solo_fulfill_proof','checkout.session.completed',true,
    'digest_solo_fulfill_proof','b2040000-0000-0000-0000-000000000001',
    'cs_live_solo_fulfill_proof','sub_solo_fulfill_proof','cus_solo_fulfill_proof',
    now()) r),
  true,'completion event claimed for fulfillment');

-- The exact call the webhook makes. The ambiguous reference (or any later
-- regression of the write path) raises here and fails the suite.
CREATE TEMP TABLE fulfill_result AS
SELECT * FROM public.solo_beta_fulfill_checkout(
  'evt_solo_fulfill_proof',
  'b2040000-0000-0000-0000-000000000001',
  (SELECT checkout_attempt FROM public.solo_beta_enrollments WHERE user_id='b2040000-0000-0000-0000-000000000001'),
  (SELECT checkout_fencing_token FROM public.solo_beta_enrollments WHERE user_id='b2040000-0000-0000-0000-000000000001'),
  'cus_solo_fulfill_proof','sub_solo_fulfill_proof','cs_live_solo_fulfill_proof',
  (SELECT stripe_product_id FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1'),
  (SELECT stripe_price_id FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1'),
  true,7450,'usd','month',1,'trialing',
  now(), now()+interval '30 days',
  now(), now()+interval '30 days',
  false
);

SELECT is((SELECT count(*)::integer FROM fulfill_result),1,
  'fulfillment returns exactly one provisioned result row');
SELECT is((SELECT state FROM public.solo_beta_enrollments
  WHERE user_id='b2040000-0000-0000-0000-000000000001'),'fulfilled',
  'enrollment is fulfilled after the real RPC sequence');
SELECT is((SELECT account_type FROM public.tenants
  WHERE id=(SELECT tenant_id FROM fulfill_result)),'standalone',
  'provisioned workspace is a standalone Solo tenant');
SELECT is((SELECT features->>'solo_beta_offer_code' FROM public.tenants
  WHERE id=(SELECT tenant_id FROM fulfill_result)),'paige-solo-beta-monthly-v1',
  'server-authored Beta entitlement stamp lands on the tenant');
SELECT is((SELECT provider_mode FROM public.platform_subscriptions
  WHERE stripe_subscription_id='sub_solo_fulfill_proof'),'live',
  'subscription is recorded live against the real offer');
SELECT is((SELECT outcome FROM public.solo_beta_fulfillment_receipts
  WHERE event_id='evt_solo_fulfill_proof'),'completed',
  'immutable fulfillment receipt is written');
SELECT is((SELECT count(*)::integer FROM public.solo_beta_welcome_deliveries
  WHERE fulfillment_event_id='evt_solo_fulfill_proof'),1,
  'verified welcome is atomically queued by the real fulfillment');

SELECT * FROM finish();
ROLLBACK;
