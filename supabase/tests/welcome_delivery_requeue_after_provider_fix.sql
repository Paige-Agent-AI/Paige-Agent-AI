-- Welcome delivery re-queue proof for 20271111030000_welcome_delivery_requeue_after_provider_fix.sql.
-- The live stranding: attempt cap (5) flipped the provider-rejected welcome to
-- needs_attention, which the drainer never scans, so the row is dead even after
-- the provider path is repaired. The migration re-arms ONLY rows that carry a
-- provider_rejected code and never produced any send receipt; everything else
-- keeps its state. `supabase test db` has already replayed every migration (the
-- requeue ran before fixtures existed and matched nothing), so this proof re-runs
-- the exact UPDATE against freshly stranded rows.

BEGIN;
SELECT plan(8);

-- Three minimal fulfillment chains; the completed-receipt trigger queues each
-- welcome row as pending, exactly like production.
DO $$
DECLARE
  sfx text;
BEGIN
  FOREACH sfx IN ARRAY ARRAY['a','b','c'] LOOP
    INSERT INTO auth.users(id,aud,role,email,raw_user_meta_data)
    VALUES(
      'b2031000-0000-0000-0000-0000000000' || (CASE sfx WHEN 'a' THEN '1' WHEN 'b' THEN '2' ELSE '3' END),
      'authenticated','authenticated',
      'welcome-requeue-' || sfx || '@tests.invalid',
      '{"full_name":"Requeue Proof ' || upper(sfx) || '"}'::jsonb
    );
    INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,brand)
    VALUES(
      'b2031000-0000-0000-0000-00000000a0' || (CASE sfx WHEN 'a' THEN '1' WHEN 'b' THEN '2' ELSE '3' END),
      'welcome-requeue-' || sfx, 'Welcome Requeue ' || upper(sfx),
      'active','standalone','WRQ', 8920301 + (CASE sfx WHEN 'a' THEN 1 WHEN 'b' THEN 2 ELSE 3 END),
      '{"solo_beta_offer_code":"paige-solo-beta-monthly-v1"}'::jsonb,'{}'::jsonb
    );
    INSERT INTO public.platform_subscriptions(
      id,tenant_id,plan_id,status,billing_period,current_period_start,current_period_end,
      stripe_subscription_id,stripe_customer_id,offer_code,provider_mode,
      stripe_product_id,stripe_price_id,trial_started_at,trial_ends_at,provider_verified_at
    )
    SELECT
      'b2031000-0000-0000-0000-00000000b0' || (CASE sfx WHEN 'a' THEN '1' WHEN 'b' THEN '2' ELSE '3' END),
      'b2031000-0000-0000-0000-00000000a0' || (CASE sfx WHEN 'a' THEN '1' WHEN 'b' THEN '2' ELSE '3' END),
      plan_id,'trialing','monthly',now(),now()+interval '30 days',
      'sub_welcome_requeue_' || sfx,'cus_welcome_requeue_' || sfx,offer_code,'live',
      stripe_product_id,stripe_price_id,now(),now()+interval '30 days',now()
    FROM public.platform_subscription_offers WHERE offer_code='paige-solo-beta-monthly-v1';
    INSERT INTO public.solo_beta_fulfillment_receipts(
      event_id,user_id,tenant_id,subscription_id,offer_code,outcome,reference_id
    ) VALUES(
      'evt_welcome_requeue_' || sfx,
      'b2031000-0000-0000-0000-0000000000' || (CASE sfx WHEN 'a' THEN '1' WHEN 'b' THEN '2' ELSE '3' END),
      'b2031000-0000-0000-0000-00000000a0' || (CASE sfx WHEN 'a' THEN '1' WHEN 'b' THEN '2' ELSE '3' END),
      'b2031000-0000-0000-0000-00000000b0' || (CASE sfx WHEN 'a' THEN '1' WHEN 'b' THEN '2' ELSE '3' END),
      'paige-solo-beta-monthly-v1','completed',
      'b2031000-0000-0000-0000-00000000c0' || (CASE sfx WHEN 'a' THEN '1' WHEN 'b' THEN '2' ELSE '3' END)
    );
  END LOOP;
END $$;

SELECT is((SELECT count(*)::integer FROM public.solo_beta_welcome_deliveries
  WHERE fulfillment_event_id LIKE 'evt_welcome_requeue_%'),3,
  'three completed fulfillments each queue one welcome row');

-- Strand each row the way the live incident did. Row a is the live shape:
-- attempt cap hit on provider_rejected with no send receipt ever produced.
UPDATE public.solo_beta_welcome_deliveries SET
  state='needs_attention', last_error_code='provider_rejected', attempt_count=8,
  sent_at=NULL, provider_message_id=NULL, next_attempt_at=now()+interval '1 hour'
WHERE fulfillment_event_id='evt_welcome_requeue_a';
-- Row b: attention state from a DIFFERENT failure class — must not be re-armed.
UPDATE public.solo_beta_welcome_deliveries SET
  state='needs_attention', last_error_code='ambiguous_delivery_window_expired', attempt_count=6,
  sent_at=NULL, provider_message_id=NULL
WHERE fulfillment_event_id='evt_welcome_requeue_b';
-- Row c: provider_rejected but not terminal — the drainer already owns it.
UPDATE public.solo_beta_welcome_deliveries SET
  state='retryable_failure', last_error_code='provider_rejected', attempt_count=2,
  next_attempt_at=now()+interval '10 minutes'
WHERE fulfillment_event_id='evt_welcome_requeue_c';

SELECT is((SELECT last_error_code FROM public.solo_beta_welcome_deliveries
  WHERE fulfillment_event_id='evt_welcome_requeue_a'),'provider_rejected',
  'stranded row a carries the live provider_rejected code before the requeue');

-- The migration's exact UPDATE, re-run against the stranded fixtures.
UPDATE public.solo_beta_welcome_deliveries
SET state = 'retryable_failure',
    next_attempt_at = now(),
    updated_at = now()
WHERE state = 'needs_attention'
  AND last_error_code = 'provider_rejected'
  AND sent_at IS NULL
  AND provider_message_id IS NULL;

SELECT is((SELECT state FROM public.solo_beta_welcome_deliveries
  WHERE fulfillment_event_id='evt_welcome_requeue_a'),'retryable_failure',
  'provider-rejected never-sent welcome is re-armed for the drainer');
SELECT ok((SELECT next_attempt_at FROM public.solo_beta_welcome_deliveries
  WHERE fulfillment_event_id='evt_welcome_requeue_a') <= now(),
  're-armed row is immediately due, not parked behind a backoff');
SELECT is((SELECT count(*)::integer FROM public.solo_beta_welcome_deliveries
  WHERE fulfillment_event_id='evt_welcome_requeue_a'
    AND (sent_at IS NOT NULL OR provider_message_id IS NOT NULL)),0,
  're-arm never fabricates a send receipt');
SELECT is((SELECT state FROM public.solo_beta_welcome_deliveries
  WHERE fulfillment_event_id='evt_welcome_requeue_b'),'needs_attention',
  'attention rows from other failure classes stay untouched');
SELECT is((SELECT state FROM public.solo_beta_welcome_deliveries
  WHERE fulfillment_event_id='evt_welcome_requeue_c'),'retryable_failure',
  'non-terminal provider-rejected rows are left to the drainer');

-- Idempotence: after the re-arm no row matches the predicate anymore, so a
-- replay of the migration cannot move anything a second time.
SELECT is((SELECT count(*)::integer FROM public.solo_beta_welcome_deliveries
  WHERE state='needs_attention' AND last_error_code='provider_rejected'
    AND sent_at IS NULL AND provider_message_id IS NULL),0,
  'requeue predicate is exhausted after one pass (idempotent replay)');

SELECT * FROM finish();
ROLLBACK;
