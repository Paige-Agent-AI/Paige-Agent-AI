-- O5: one atomic original capture + adjustment observation; default activation remains OFF.
BEGIN;
DO $source$
DECLARE expected jsonb;p record;
BEGIN
 FOR expected IN SELECT value FROM pg_catalog.jsonb_array_elements($dependencies$[{"signature":"_sales_payment_operation_service()","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","prosecdef":false,"proisstrict":false,"proleakproof":false,"provolatile":"v","proparallel":"u","pronargdefaults":0,"proconfig":["search_path=pg_catalog, public"],"proargnames":null,"result":"void","body_hash":"b30924620fb5f90dd8ea8431e13bf7fe"},{"signature":"_sales_payment_reconciliation_payload(uuid)","owner":"postgres","acl":"{postgres=X/postgres}","prosecdef":true,"proisstrict":false,"proleakproof":false,"provolatile":"s","proparallel":"u","pronargdefaults":0,"proconfig":["search_path=pg_catalog, public"],"proargnames":["_operation"],"result":"jsonb","body_hash":"81b74168580c96d722eb39c28c3b6b64"},{"signature":"allocate_verified_sales_invoice_payment(uuid,uuid,uuid,jsonb)","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","prosecdef":true,"proisstrict":false,"proleakproof":false,"provolatile":"v","proparallel":"u","pronargdefaults":0,"proconfig":["search_path=pg_catalog, public"],"proargnames":["_expected_tenant_id","_operation_id","_claim_token","_readback"],"result":"jsonb","body_hash":"17310e2c68bc386ecbc0f2850476006d"},{"signature":"complete_sales_payment_reconciliation_work(uuid,uuid,text,integer,text)","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","prosecdef":true,"proisstrict":false,"proleakproof":false,"provolatile":"v","proparallel":"u","pronargdefaults":0,"proconfig":["search_path=pg_catalog, public"],"proargnames":["_expected_tenant_id","_work_id","_server_idempotency_key","_attempt_count","_outcome"],"result":"jsonb","body_hash":"e4ffc07bfa9ba8681c13fd9206d5d362"},{"signature":"heartbeat_sales_payment_reconciliation_work(uuid,uuid,text,integer)","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","prosecdef":true,"proisstrict":false,"proleakproof":false,"provolatile":"v","proparallel":"u","pronargdefaults":0,"proconfig":["search_path=pg_catalog, public"],"proargnames":["_expected_tenant_id","_work_id","_server_idempotency_key","_attempt_count"],"result":"jsonb","body_hash":"a2f1c3d5440dba557ccd727938a87c6c"},{"signature":"read_sales_invoice_payment_dispatch(uuid,uuid)","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","prosecdef":true,"proisstrict":false,"proleakproof":false,"provolatile":"v","proparallel":"u","pronargdefaults":0,"proconfig":["search_path=pg_catalog, public"],"proargnames":["_expected_tenant_id","_operation_id"],"result":"jsonb","body_hash":"78ec4e48b972552bd505c5ea075bd574"},{"signature":"record_sales_invoice_provider_observation(uuid,uuid,uuid,bigint,jsonb,text)","owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","prosecdef":true,"proisstrict":false,"proleakproof":false,"provolatile":"v","proparallel":"u","pronargdefaults":0,"proconfig":["search_path=\"\""],"proargnames":["_expected_tenant_id","_operation_id","_claim_token","_expected_observation_version","_snapshot","_reference"],"result":"jsonb","body_hash":"950fdbc386da780ae6ccefa89d0a0043"}]$dependencies$::jsonb) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.'||(expected->>'signature'));
  IF NOT FOUND OR pg_catalog.md5(p.prosrc) IS DISTINCT FROM expected->>'body_hash'
   OR pg_catalog.pg_get_userbyid(p.proowner) IS DISTINCT FROM expected->>'owner'
   OR p.proacl::text IS DISTINCT FROM expected->>'acl'
   OR pg_catalog.to_jsonb(p.prosecdef) IS DISTINCT FROM expected->'prosecdef'
   OR p.proisstrict OR p.proleakproof OR p.proretset
   OR p.provolatile::text IS DISTINCT FROM expected->>'provolatile'
   OR p.proparallel::text IS DISTINCT FROM expected->>'proparallel'
   OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL
   OR pg_catalog.to_jsonb(p.proconfig) IS DISTINCT FROM expected->'proconfig'
   OR coalesce(pg_catalog.to_jsonb(p.proargnames),'null'::jsonb) IS DISTINCT FROM expected->'proargnames'
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM expected->>'result' THEN
   RAISE EXCEPTION 'Original payment recovery source/authority changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
 END LOOP;
 SELECT * INTO p FROM pg_catalog.pg_proc
  WHERE oid=pg_catalog.to_regprocedure('public.complete_sales_capture_observation_work(uuid,uuid,text,integer,jsonb,jsonb)');
 IF FOUND AND (pg_catalog.md5(p.prosrc)<>'d3fe627d8a28422c3e5f6d8cf9f511e1' OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
  OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof OR p.proretset OR p.provolatile<>'v' OR p.proparallel<>'u'
  OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL OR pg_catalog.pg_get_function_result(p.oid)<>'jsonb'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  OR p.proargnames IS DISTINCT FROM ARRAY['_expected_tenant_id','_work_id','_server_idempotency_key','_attempt_count','_capture','_snapshot']) THEN
  RAISE EXCEPTION 'Initial capture recovery replay source/authority changed' USING ERRCODE='23514';
 END IF;
END $source$;

-- Candidate for the original GET-only payment reconciliation worker. No provider effect.
-- Keep the ORIGINAL allocator, observation journal, Work identity and Rail writers.
CREATE OR REPLACE FUNCTION public.complete_sales_capture_observation_work(
 _expected_tenant_id uuid,_work_id uuid,_server_idempotency_key text,_attempt_count integer,
 _capture jsonb,_snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $commit$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE; w public.paige_durable_work%ROWTYPE;
 capture_result jsonb; observation_result jsonb; work_result jsonb; replay_only boolean;
BEGIN
 PERFORM public._sales_payment_operation_service();
 SELECT p.* INTO op FROM public.paige_invoice_provider_operations p
  WHERE p.tenant_id=_expected_tenant_id AND p.reconciliation_work_id=_work_id;
 IF NOT FOUND OR op.provider<>'stripe' OR op.dispatch_claim_token IS NULL THEN
  RAISE EXCEPTION 'Original payment work unavailable' USING ERRCODE='42501';END IF;
 -- Follow the original allocator/observation lock order, THEN lock its Work.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(op.id::text,81742));
 PERFORM 1 FROM public.paige_invoices i WHERE i.id=op.invoice_id AND i.tenant_id=op.tenant_id FOR UPDATE;
 SELECT p.* INTO op FROM public.paige_invoice_provider_operations p WHERE p.id=op.id AND p.tenant_id=_expected_tenant_id FOR UPDATE;
 SELECT d.* INTO w FROM public.paige_durable_work d WHERE d.id=_work_id AND d.tenant_id=_expected_tenant_id FOR UPDATE;
 IF NOT FOUND OR w.work_kind IS DISTINCT FROM 'sales_payment_reconciliation'
  OR w.capability_key IS DISTINCT FROM 'sales_invoice.payment_request'
  OR w.intent_id IS DISTINCT FROM op.id OR w.initiating_user_id IS DISTINCT FROM op.actor_user_id
  OR w.idempotency_key IS DISTINCT FROM _server_idempotency_key
  OR _attempt_count IS NULL OR _attempt_count<1 OR w.attempt_count IS DISTINCT FROM _attempt_count
  OR w.dispatch_started_attempt IS DISTINCT FROM _attempt_count
  OR w.request_payload IS DISTINCT FROM public._sales_payment_reconciliation_payload(op.id) THEN
  RAISE EXCEPTION 'Original payment work unavailable' USING ERRCODE='42501';END IF;
 replay_only:=op.state='settled';
 IF replay_only THEN
  IF w.status IS DISTINCT FROM 'succeeded' THEN RAISE EXCEPTION 'Original payment work unavailable' USING ERRCODE='42501';END IF;
 ELSE
  -- Recheck the current lease inside this transaction, after all provider GETs.
  PERFORM public.heartbeat_sales_payment_reconciliation_work(_expected_tenant_id,_work_id,_server_idempotency_key,_attempt_count);
 END IF;
 -- No observer can see a gross capture committed without its complete adjustment
 -- snapshot. ANY second-leg/receipt/Rail error rolls the original allocation back.
 capture_result:=public.allocate_verified_sales_invoice_payment(op.tenant_id,op.id,op.dispatch_claim_token,_capture);
 observation_result:=public.record_sales_invoice_provider_observation(op.tenant_id,op.id,op.dispatch_claim_token,0,_snapshot,'initial-work-'||w.id::text);
 IF replay_only AND observation_result->'replayed' IS DISTINCT FROM 'true'::jsonb THEN
  RAISE EXCEPTION 'Initial payment observation replay required' USING ERRCODE='40001';END IF;
 work_result:=public.complete_sales_payment_reconciliation_work(op.tenant_id,w.id,w.idempotency_key,w.attempt_count,'settled');
 RETURN pg_catalog.jsonb_build_object('state','reconciled','effect','capture_and_provider_observation',
  'operation_id',op.id,'work_id',w.id,'work_status',work_result->'work_status',
  'allocation_payment_id',capture_result->'allocation_payment_id','observation',observation_result,
  'replayed',replay_only);
END $commit$;
REVOKE ALL ON FUNCTION public.complete_sales_capture_observation_work(uuid,uuid,text,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sales_capture_observation_work(uuid,uuid,text,integer,jsonb,jsonb) TO service_role;

COMMIT;
