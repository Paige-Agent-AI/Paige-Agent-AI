-- Same ORIGINAL provider proof and native writers; all new data rolls back.
-- Synthetic Auth/table/provider ports, NOT a Stripe or customer acceptance claim.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
CREATE TEMP TABLE e04_cash_checks(label text PRIMARY KEY);
CREATE TEMP TABLE e04_cash_state(key text PRIMARY KEY,value jsonb);
CREATE FUNCTION pg_temp.cash_check(_ok boolean,_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',_label; END IF;
 INSERT INTO e04_cash_checks VALUES(_label);RAISE NOTICE 'PASS: %',_label; END $$;
CREATE FUNCTION pg_temp.cash_refused(_sql text,_code text,_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE _sql;EXCEPTION WHEN OTHERS THEN
 IF sqlstate=_code THEN PERFORM pg_temp.cash_check(true,_label);RETURN;END IF;
 RAISE EXCEPTION 'FAIL: % unexpected %: %',_label,sqlstate,sqlerrm;END;
 RAISE EXCEPTION 'FAIL: % accepted',_label;END $$;
SELECT pg_temp.cash_check(to_regprocedure('public._sales_invoice_financial_position_rows(uuid,uuid,integer)') IS NOT NULL,'versioned original cash evidence implementation exists');

INSERT INTO public.paige_invoices SELECT (jsonb_populate_record(NULL::public.paige_invoices,
 to_jsonb(i)||jsonb_build_object('id','e0447700-0000-4000-8000-000000000001','invoice_number','INV-CASH-PROOF',
 'status','issued','amount_total_cents',350000,'billing_lifecycle_version',2,'billing_issued_at',clock_timestamp()-interval '5 minutes'))).*
 FROM public.paige_invoices i WHERE i.id='__INVOICE__';
-- Restore only disposable fixture readiness before exercising the ORIGINAL doors.
UPDATE public.tenant_members SET status='active',role='owner' WHERE tenant_id='__TENANT__' AND user_id='__ACTOR__';
UPDATE auth.users SET deleted_at=NULL,banned_until=NULL WHERE id='__ACTOR__';
UPDATE public.profiles SET active_tenant_id='__TENANT__' WHERE user_id='__ACTOR__';
UPDATE public.tenants SET status='active' WHERE id='__TENANT__';
UPDATE public.tenant_stripe_accounts SET provider_environment='live',charges_enabled=true,payouts_enabled=true,
 details_submitted=true,sales_payment_permission=true,binding_version=1,sales_readback_at=now() WHERE tenant_id='__TENANT__';
SELECT set_config('test.mode','confirm',true);
SET LOCAL ROLE service_role;
SELECT public.prepare_sales_invoice_payment_request('__ACTOR__','__TENANT__','e0447700-0000-4000-8000-000000000002',
 jsonb_build_object('action','invoice.payment_request','invoice_id','e0447700-0000-4000-8000-000000000001','client_id','__CLIENT__',
 'expected_version',2,'issued_snapshot_version',1,'provider','stripe','merchant_account_id','acct_fixtureA','merchant_binding_version',1,
 'environment','live','amount_minor',50000,'currency','usd','purpose','partial'),
 jsonb_build_object('actor_user_id','__ACTOR__','tenant_id','__TENANT__','action','invoice.payment_request',
 'tool','sales_create_payment_request','approval_channel','operator_card','approved_fingerprint','0123456789abcdef','decision_receipt_recorded',true));
SELECT public.claim_sales_invoice_payment_request('__TENANT__','e0447700-0000-4000-8000-000000000002','e0447700-0000-4000-8000-000000000003');
SELECT public.finalize_sales_invoice_payment_request('__TENANT__','e0447700-0000-4000-8000-000000000002','e0447700-0000-4000-8000-000000000003',
 'customer_action_required','cs_live_fixtureCash','open','https://checkout.stripe.com/c/pay/cs_live_fixtureCash',NULL);
SELECT public.allocate_verified_sales_invoice_payment('__TENANT__','e0447700-0000-4000-8000-000000000002','e0447700-0000-4000-8000-000000000003',
 jsonb_build_object('provider','stripe','merchant_account_id','acct_fixtureA','environment','live','provider_object_id','cs_live_fixtureCash',
 'provider_transaction_id','ch_fixtureCash','provider_settlement_id','txn_fixtureCash','amount_minor',50000,'currency','usd','status','verified',
 'readback_reference','req_fixtureCash','invoice_id','e0447700-0000-4000-8000-000000000001','client_id','__CLIENT__',
 'invoice_version',2,'issued_snapshot_version',1,'provider_received_at',
 to_char((clock_timestamp()-interval '2 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
RESET ROLE;
INSERT INTO e04_cash_state SELECT 'payment',to_jsonb(p) FROM public.paige_invoice_payments p WHERE provider_operation_id='e0447700-0000-4000-8000-000000000002';
INSERT INTO e04_cash_state SELECT 'legacy',to_jsonb(b) FROM public._sales_invoice_balance_rows('__TENANT__','e0447700-0000-4000-8000-000000000001') b;
INSERT INTO e04_cash_state SELECT 'position',to_jsonb(b) FROM public._sales_invoice_financial_position_rows('__TENANT__','e0447700-0000-4000-8000-000000000001') b;
INSERT INTO e04_cash_state SELECT 'document',jsonb_build_object('document',billing_document,'digest',billing_document_digest,
 'snapshot',billing_issued_snapshot_version,'amount',amount_total_cents) FROM public.paige_invoices WHERE id='e0447700-0000-4000-8000-000000000001';
CREATE FUNCTION pg_temp.cash() RETURNS jsonb LANGUAGE sql AS $$
 SELECT financial_position FROM public._sales_invoice_financial_position_rows('__TENANT__','e0447700-0000-4000-8000-000000000001',3) $$;
CREATE FUNCTION pg_temp.cash_balance(_id text,_amount integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('id',_id,'amount_minor',_amount,'currency','usd','status','available',
 'created_at',to_char((clock_timestamp()-interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) $$;
CREATE FUNCTION pg_temp.cash_observe(_snapshot jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE version bigint;
BEGIN SELECT provider_observation_version INTO STRICT version FROM public.paige_invoice_provider_operations WHERE id='e0447700-0000-4000-8000-000000000002';
 SET LOCAL ROLE service_role;
 PERFORM public.record_sales_invoice_provider_observation('__TENANT__','e0447700-0000-4000-8000-000000000002',
  'e0447700-0000-4000-8000-000000000003',version,_snapshot,'evt_cashProof');
 RESET ROLE;
END $$;
INSERT INTO e04_cash_state VALUES('empty',jsonb_build_object('state','observed','provider_transaction_id','ch_fixtureCash',
 'provider_settlement_id','txn_fixtureCash','refunds','[]'::jsonb,'disputes','[]'::jsonb));
INSERT INTO e04_cash_state SELECT 'refund',jsonb_build_object('id','re_fixtureCash','amount_minor',10000,'currency','usd',
 'created_at',to_char((clock_timestamp()-interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'status','succeeded','balance_transaction',pg_temp.cash_balance('txn_refundCash',-10000),'failure_balance_transaction',NULL);
INSERT INTO e04_cash_state SELECT 'dispute',jsonb_build_object('id','du_fixtureCash','amount_minor',10000,'currency','usd',
 'created_at',to_char((clock_timestamp()-interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'status','under_review','balance_transactions',jsonb_build_array(pg_temp.cash_balance('txn_disputeCash',-10000)));

SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_settled_net_minor'='50000' AND pg_temp.cash()->'commercial_review_required'='false','original native capture remains its recorded principal');
SELECT pg_temp.cash_observe(jsonb_set((SELECT value FROM e04_cash_state WHERE key='empty'),'{refunds}',jsonb_build_array((SELECT value FROM e04_cash_state WHERE key='refund'))));
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_observed_net_minor'='40000','refund decreases retained provider principal exactly once');
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_refunded_minor'='10000' AND pg_temp.cash()->>'provider_refund_cash_delta_minor'='-10000','refund completion and original cash debit stay separate facts');
SELECT pg_temp.cash_check(pg_temp.cash()->>'receivable_remaining_minor'='300000' AND pg_temp.cash()->'commercial_review_required'='true','refund does not forgive or automatically reopen commercial debt');
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_settled_net_minor'='40000' AND pg_temp.cash()->'provider_verification_pending'='false','completed available cash evidence has explicit settled principal');
SELECT pg_temp.cash_check(jsonb_array_length(pg_temp.cash()->'provider_observation_sources')=1 AND pg_temp.cash()#>>'{provider_observation_sources,0,observation_version}'='1','cash evidence retains exact current original observation');
SELECT pg_temp.cash_observe(jsonb_set((SELECT value FROM e04_cash_state WHERE key='empty'),'{refunds}',jsonb_build_array((SELECT value FROM e04_cash_state WHERE key='refund'))));
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_observed_net_minor'='40000' AND pg_temp.cash()#>>'{provider_observation_sources,0,observation_version}'='1','duplicate original readback cannot deduct another refund');
SELECT pg_temp.cash_observe(jsonb_set((SELECT value FROM e04_cash_state WHERE key='empty'),'{refunds}',jsonb_build_array(
 jsonb_set(jsonb_set((SELECT value FROM e04_cash_state WHERE key='refund'),'{status}','"pending"'),'{balance_transaction}','null'))));
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_refund_pending_minor'='10000' AND pg_temp.cash()->'provider_settled_net_minor'='null' AND pg_temp.cash()->'provider_verification_pending'='true','pending refund is verification pending rather than returned money');
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_refunded_minor'='0' AND pg_temp.cash()->>'provider_observed_net_minor'='50000','pending refund without debit does not fabricate a cash return');
SELECT pg_temp.cash_observe(jsonb_set((SELECT value FROM e04_cash_state WHERE key='empty'),'{refunds}',jsonb_build_array(
 (SELECT value FROM e04_cash_state WHERE key='refund')||jsonb_build_object('status','failed','failure_balance_transaction',pg_temp.cash_balance('txn_refundFailedCash',10000)))));
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_observed_net_minor'='50000' AND pg_temp.cash()->>'provider_refund_cash_delta_minor'='0' AND pg_temp.cash()->>'provider_refunded_minor'='0','failed refund and genuine reversal restore original principal without erasing history');
SELECT pg_temp.cash_observe(jsonb_set((SELECT value FROM e04_cash_state WHERE key='empty'),'{disputes}',jsonb_build_array((SELECT value FROM e04_cash_state WHERE key='dispute'))));
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_dispute_debited_minor'='10000' AND pg_temp.cash()->>'provider_observed_net_minor'='40000','actual dispute withdrawal is retained separately from a decision');
SELECT pg_temp.cash_check(pg_temp.cash()->'provider_settled_net_minor'='null' AND pg_temp.cash()->'provider_verification_pending'='true','open dispute remains unresolved despite a known cash withdrawal');
SELECT pg_temp.cash_observe(jsonb_set((SELECT value FROM e04_cash_state WHERE key='empty'),'{disputes}',jsonb_build_array(
 jsonb_set((SELECT value FROM e04_cash_state WHERE key='dispute'),'{status}','"won"'))));
SELECT pg_temp.cash_check(pg_temp.cash()->'provider_settled_net_minor'='null' AND pg_temp.cash()->>'provider_dispute_reinstated_minor'='0','won decision cannot fabricate funds reinstatement');
SELECT pg_temp.cash_observe(jsonb_set((SELECT value FROM e04_cash_state WHERE key='empty'),'{disputes}',jsonb_build_array(
 (SELECT value FROM e04_cash_state WHERE key='dispute')||'{"status":"won","balance_transactions":[]}'::jsonb)));
SELECT pg_temp.cash_check(pg_temp.cash()->'provider_settled_net_minor'='null' AND pg_temp.cash()->'provider_verification_pending'='true','won label with missing movements remains verification pending');
SELECT pg_temp.cash_observe(jsonb_set((SELECT value FROM e04_cash_state WHERE key='empty'),'{disputes}',jsonb_build_array(
 (SELECT value FROM e04_cash_state WHERE key='dispute')||jsonb_build_object('status','won','balance_transactions',jsonb_build_array(pg_temp.cash_balance('txn_disputeCash',-10000),pg_temp.cash_balance('txn_disputeReturnedCash',10000))))));
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_dispute_debited_minor'='10000' AND pg_temp.cash()->>'provider_dispute_reinstated_minor'='10000' AND pg_temp.cash()->>'provider_settled_net_minor'='50000','exact withdrawal and reinstatement recover principal without new settlement');
SELECT pg_temp.cash_observe(jsonb_set((SELECT value FROM e04_cash_state WHERE key='empty'),'{disputes}',jsonb_build_array(
 jsonb_set((SELECT value FROM e04_cash_state WHERE key='dispute'),'{status}','"lost"'))));
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_settled_net_minor'='40000' AND pg_temp.cash()->'commercial_review_required'='true','lost dispute cash remains separate from commercial disposition');
SELECT pg_temp.cash_observe(jsonb_set((SELECT value FROM e04_cash_state WHERE key='empty'),'{disputes}',jsonb_build_array(
 (SELECT value FROM e04_cash_state WHERE key='dispute')||jsonb_build_object('status','lost','balance_transactions',jsonb_build_array(pg_temp.cash_balance('txn_disputeCash',-10000),pg_temp.cash_balance('txn_disputeReturnedCash',10000))))));
SELECT pg_temp.cash_check(pg_temp.cash()->'provider_settled_net_minor'='null' AND pg_temp.cash()->'provider_verification_pending'='true','lost label with contradictory reinstatement remains unresolved');
SELECT pg_temp.cash_observe(jsonb_set((SELECT value FROM e04_cash_state WHERE key='empty'),'{refunds}',jsonb_build_array(
 jsonb_set((SELECT value FROM e04_cash_state WHERE key='refund'),'{balance_transaction,status}','"pending"'))));
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_observed_net_minor'='40000' AND pg_temp.cash()->'provider_settled_net_minor'='null','pending provider balance is observed but never represented as settled principal');
SELECT pg_temp.cash_observe((SELECT value FROM e04_cash_state WHERE key='empty')||jsonb_build_object(
 'refunds',jsonb_build_array((SELECT value FROM e04_cash_state WHERE key='refund')||jsonb_build_object('amount_minor',40000,'balance_transaction',pg_temp.cash_balance('txn_refundOverlapCash',-40000))),
 'disputes',jsonb_build_array((SELECT value FROM e04_cash_state WHERE key='dispute')||jsonb_build_object('status','lost','amount_minor',40000,'balance_transactions',jsonb_build_array(pg_temp.cash_balance('txn_disputeOverlapCash',-40000))))));
SELECT pg_temp.cash_check(pg_temp.cash()->'provider_observed_net_minor'='null' AND pg_temp.cash()->'provider_settled_net_minor'='null' AND pg_temp.cash()->'provider_verification_pending'='true','overlapping cash movements are unresolved rather than clamped to zero');
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_refund_cash_delta_minor'='-40000' AND pg_temp.cash()->>'provider_dispute_debited_minor'='40000','unresolved overlapping source movements remain inspectable');
SELECT pg_temp.cash_observe(jsonb_set((SELECT value FROM e04_cash_state WHERE key='empty'),'{disputes}',jsonb_build_array(
 jsonb_set((SELECT value FROM e04_cash_state WHERE key='dispute'),'{status}','"lost"'))));
SELECT pg_temp.cash_refused($q$DO $inner$ BEGIN
 DELETE FROM public.paige_workspace_events WHERE source_id=(SELECT provider_observation_operation_id FROM public.paige_invoice_provider_operations WHERE id='e0447700-0000-4000-8000-000000000002');
 PERFORM pg_temp.cash();END $inner$$q$,'55000','missing original observation Rail cannot become usable financial evidence');
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_settled_net_minor'='40000','failed source-integrity control rolls back without losing the genuine retained receipt');
SELECT pg_temp.cash_check((SELECT financial_position->>'provider_observed_net_minor'='0' AND financial_position->'commercial_review_required'='false' AND financial_position->'provider_verification_pending'='false' AND (financial_position->>'test_adjustment_count')::integer>0
 FROM public._sales_invoice_financial_position_rows('__TENANT__','__INVOICE__',3)),'TEST adjustment history neither moves actual money nor imposes a live debt decision');
UPDATE public.tenant_stripe_accounts SET stripe_account_id='acct_retiredProof' WHERE tenant_id='__TENANT__';
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_settled_net_minor'='40000','retired merchant connection does not erase original historical cash evidence');
UPDATE public.tenant_stripe_accounts SET stripe_account_id='acct_fixtureA' WHERE tenant_id='__TENANT__';
SET LOCAL ROLE service_role;
SELECT public.register_sales_provider_observation_work('__TENANT__','e0447700-0000-4000-8000-000000000002','evt_cashNewSignal','acct_fixtureA','live','ch_fixtureCash');
RESET ROLE;
INSERT INTO e04_cash_state SELECT 'work',to_jsonb(w) FROM public.paige_durable_work w WHERE work_kind='sales_provider_observation' AND request_payload->>'event_id'='evt_cashNewSignal';
SELECT pg_temp.cash_check(pg_temp.cash()->>'provider_observed_net_minor'='40000' AND pg_temp.cash()->'provider_settled_net_minor'='null' AND pg_temp.cash()->'provider_verification_pending'='true','new original unverified signal withholds settled outcome until same-work reconciliation');
SELECT pg_temp.cash_check((SELECT to_jsonb(w) FROM public.paige_durable_work w WHERE work_kind='sales_provider_observation' AND request_payload->>'event_id'='evt_cashNewSignal')=(SELECT value FROM e04_cash_state WHERE key='work'),'financial read never dispatches alters or completes original work');

SELECT pg_temp.cash_check((SELECT to_jsonb(p) FROM public.paige_invoice_payments p WHERE provider_operation_id='e0447700-0000-4000-8000-000000000002')=(SELECT value FROM e04_cash_state WHERE key='payment'),'all later provider observations preserve whole original receipt');
SELECT pg_temp.cash_check((SELECT to_jsonb(b) FROM public._sales_invoice_balance_rows('__TENANT__','e0447700-0000-4000-8000-000000000001') b)=(SELECT value FROM e04_cash_state WHERE key='legacy'),'whole seven-field legacy balance is exact');
SELECT pg_temp.cash_check((SELECT to_jsonb(b) FROM public._sales_invoice_financial_position_rows('__TENANT__','e0447700-0000-4000-8000-000000000001') b)=(SELECT value FROM e04_cash_state WHERE key='position'),'whole existing actual debt position is exact');
SELECT pg_temp.cash_check((SELECT jsonb_build_object('document',billing_document,'digest',billing_document_digest,'snapshot',billing_issued_snapshot_version,'amount',amount_total_cents) FROM public.paige_invoices WHERE id='e0447700-0000-4000-8000-000000000001')=(SELECT value FROM e04_cash_state WHERE key='document'),'original document economics and snapshot remain whole exact');
SELECT pg_temp.cash_check(NOT EXISTS(SELECT 1 FROM public._sales_invoice_financial_position_rows('__OTHER_TENANT__','e0447700-0000-4000-8000-000000000001',3)),'foreign tenant cannot select this invoice through the private calculation');
SELECT pg_temp.cash_refused($q$SELECT * FROM public._sales_invoice_financial_position_rows('__TENANT__',NULL,2)$q$,'22023','unsupported financial evidence version is refused');
SELECT pg_temp.cash_refused($q$SET LOCAL ROLE authenticated;SELECT * FROM public._sales_invoice_financial_position_rows('__TENANT__',NULL,3)$q$,'42501','ordinary authenticated callers cannot bypass canonical public read authorization');
SELECT pg_temp.cash_refused($q$SET LOCAL ROLE anon;SELECT * FROM public._sales_invoice_financial_position_rows('__TENANT__',NULL,3)$q$,'42501','anonymous callers cannot use the private cash calculation');
SELECT pg_temp.cash_refused($q$SET LOCAL ROLE service_role;SELECT * FROM public._sales_invoice_financial_position_rows('__TENANT__',NULL,3)$q$,'42501','service role has no new direct private cash entry');
SELECT jsonb_build_object('proof','E04_PROVIDER_CASH_POSITION','checks',(SELECT count(*) FROM e04_cash_checks),'sample',pg_temp.cash());
ROLLBACK;
