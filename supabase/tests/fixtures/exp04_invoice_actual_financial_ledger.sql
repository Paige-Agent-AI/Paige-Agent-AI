-- INERT original O5 ledger/document current-financial projection, not a release.
-- SAME immutable history, frozen document, native summary and outer authority.
-- No new ledger, provider call, grant, mutation or financial calculation.
DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('327e4883b78725137137e1ad7349ba20','7484b4ef971f0e84eac8c5967a84103b','0b74d9b00e40b43a536ceb3b5a884c8a')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
  OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_invoice','_limit','_cursor']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
  RAISE EXCEPTION 'Original invoice ledger source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_read(uuid,uuid,integer,integer)')
  AND pg_catalog.md5(prosrc)='9add10afcf85dfbec91f1268248dbb58' AND pg_catalog.pg_get_userbyid(proowner)='postgres'
  AND NOT prosecdef AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u' AND NOT proretset
  AND prorettype='jsonb'::regtype AND pronargdefaults=0 AND proargnames=ARRAY['_tenant','_invoice','_payment_limit','_financial_version']
  AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial reader requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

CREATE OR REPLACE FUNCTION public._sales_invoice_payment_ledger(_tenant uuid,_invoice uuid,_limit integer,_cursor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; truth jsonb; rows jsonb; balance record; headers jsonb;
 actual boolean; test_receipts numeric; test_reversals numeric; financial jsonb; evidence_version text;
BEGIN
 result:=public._sales_invoice_payment_ledger_before_provider(_tenant,_invoice,_limit,_cursor);
 headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' OR
  (headers ? 'x-paige-invoice-evidence-version' AND
   (jsonb_typeof(headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string'
    OR headers->>'x-paige-invoice-evidence-version' NOT IN('2','3'))) THEN
  RAISE EXCEPTION 'Invoice evidence representation unavailable' USING ERRCODE='22023';
 END IF;
 evidence_version:=headers->>'x-paige-invoice-evidence-version';
 actual:=evidence_version IN('2','3');
 IF actual IS NOT TRUE THEN
  -- Reuse the SAME canonical seven-column compatibility projection. The owner
  -- getter may already serve evidence2; it must not silently change old ledgers.
  SELECT * INTO STRICT balance FROM public._sales_invoice_balance_rows(_tenant,_invoice);
  truth:=public._sales_invoice_read_before_provider(_tenant,_invoice,0);
  truth:=truth||jsonb_build_object('manual_recorded_cents',balance.manual_minor,
   'provider_verified_cents',balance.provider_minor,'allocated_cents',balance.allocated_minor,
   'settlement',CASE WHEN truth->>'status'='void' THEN 'void'
    WHEN balance.provider_minor>0 AND balance.manual_minor>0 AND balance.remaining_minor=0 THEN 'mixed_recorded_settled'
    WHEN balance.provider_minor>0 AND balance.remaining_minor=0 THEN 'provider_verified_settled'
    WHEN balance.provider_minor>0 AND balance.manual_minor>0 THEN 'mixed_recorded_partial'
    WHEN balance.provider_minor>0 THEN 'provider_verified_partial' ELSE truth->>'settlement' END);
  SELECT coalesce(jsonb_agg(row.value||CASE WHEN p.evidence_kind='provider_verified' THEN jsonb_build_object(
   'provenance','provider_verified','provider',p.provider,'provider_operation_id',p.provider_operation_id,
   'provider_verified_at',p.provider_verified_at) ELSE '{}'::jsonb END ORDER BY row.ordinality),'[]'::jsonb)
  INTO rows FROM jsonb_array_elements(result->'payment_ledger'->'rows') WITH ORDINALITY row(value,ordinality)
  LEFT JOIN public.paige_invoice_payments p ON p.id=(row.value->>'id')::uuid AND p.tenant_id=_tenant AND p.invoice_id=_invoice;
  financial:=public._sales_invoice_read(_tenant,_invoice,0,3)->'financial_summary';
  IF result->>'status'<>'void' AND (financial->>'standing' IS DISTINCT FROM 'recorded'
   OR financial->'outstanding_minor' IS DISTINCT FROM result->'remaining_cents'
   OR financial->'refund_payable_minor' IS DISTINCT FROM '0'::jsonb
   OR financial->'credit_minor' IS DISTINCT FROM '0'::jsonb) THEN
   RAISE EXCEPTION 'Invoice ledger financial representation changed; reload' USING ERRCODE='40001';END IF;
  RETURN jsonb_set(result||jsonb_build_object('manual_recorded_cents',truth->'manual_recorded_cents',
   'provider_verified_cents',truth->'provider_verified_cents','allocated_cents',truth->'allocated_cents',
   'settlement',truth->'settlement'),'{payment_ledger,rows}',rows);
 END IF;

 truth:=public._sales_invoice_read(_tenant,_invoice,0);
 SELECT * INTO STRICT balance FROM public._sales_invoice_financial_position_rows(_tenant,_invoice);
 -- The preserved three-argument getter is historical. Copy actual evidence from
 -- the SAME canonical native position without changing that getter's contract.
 truth:=truth||jsonb_build_object('manual_recorded_cents',balance.manual_minor,
  'provider_verified_cents',balance.live_provider_minor,'test_provider_verified_cents',balance.test_provider_minor,
  'allocated_cents',balance.receivable_allocated_minor,'remaining_cents',balance.receivable_remaining_minor,'settlement',CASE WHEN result->>'status'='void' THEN 'void'
   WHEN balance.live_provider_minor>0 AND balance.manual_minor>0 AND balance.receivable_remaining_minor=0 THEN 'mixed_recorded_settled'
   WHEN balance.live_provider_minor>0 AND balance.receivable_remaining_minor=0 THEN 'provider_verified_settled'
   WHEN balance.live_provider_minor>0 AND balance.manual_minor>0 THEN 'mixed_recorded_partial'
   WHEN balance.live_provider_minor>0 THEN 'provider_verified_partial'
   WHEN balance.manual_minor>0 AND balance.receivable_remaining_minor=0 THEN 'manually_recorded_settled'
   WHEN balance.manual_minor>0 THEN 'manually_recorded_partial' ELSE 'unpaid' END);
 -- Extend the incumbent native history with its TEST component under EXACTLY
 -- the original ordering. The original running amounts and gross totals stay
 -- inspectable; no browser infers debt from a partial page or a test receipt.
 WITH classified AS (
  SELECT p.*,CASE WHEN evidence_kind='provider_verified' AND provider_environment='test'
   THEN CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END ELSE 0 END AS test_delta,
   CASE WHEN evidence_kind='provider_verified' AND provider_environment='test' AND kind='receipt' THEN amount_cents ELSE 0 END AS test_receipt,
   CASE WHEN evidence_kind='provider_verified' AND provider_environment='test' AND kind='reversal' THEN amount_cents ELSE 0 END AS test_reversal
  FROM public.paige_invoice_payments p WHERE tenant_id=_tenant AND invoice_id=_invoice
 ), ordered AS (
  SELECT p.*,sum(test_delta) OVER (ORDER BY created_at,CASE WHEN kind='receipt' THEN 0 ELSE 1 END,id
   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS test_running FROM classified p
 )
 SELECT (SELECT coalesce(sum(test_receipt),0) FROM ordered),
  (SELECT coalesce(sum(test_reversal),0) FROM ordered),
  (SELECT coalesce(jsonb_agg(row.value||jsonb_build_object('evidence_kind',p.evidence_kind,
    'provider_environment',CASE WHEN p.evidence_kind='provider_verified' THEN p.provider_environment END,
    'receivable_running_received_cents',(row.value->>'running_received_cents')::numeric-p.test_running,
    'receivable_running_remaining_cents',(row.value->>'running_remaining_cents')::numeric+p.test_running)
   ||CASE WHEN p.evidence_kind='provider_verified' THEN jsonb_build_object('provenance','provider_verified',
    'provider',p.provider,'provider_operation_id',p.provider_operation_id,'provider_verified_at',p.provider_verified_at)
    ELSE '{}'::jsonb END ORDER BY row.ordinality),'[]'::jsonb)
   FROM jsonb_array_elements(result->'payment_ledger'->'rows') WITH ORDINALITY row(value,ordinality)
   JOIN ordered p ON p.id=(row.value->>'id')::uuid)
 INTO test_receipts,test_reversals,rows;
 result:=jsonb_set(result,'{payment_ledger}',(result->'payment_ledger')||jsonb_build_object(
  'rows',rows,'receivable_receipt_total_cents',(result#>>'{payment_ledger,receipt_total_cents}')::numeric-test_receipts,
  'receivable_reversal_total_cents',(result#>>'{payment_ledger,reversal_total_cents}')::numeric-test_reversals));
 result:=result||jsonb_build_object('payment_evidence_version',2,
  'manual_recorded_cents',truth->'manual_recorded_cents','provider_verified_cents',truth->'provider_verified_cents',
  'test_provider_verified_cents',truth->'test_provider_verified_cents','allocated_cents',truth->'allocated_cents',
  'remaining_cents',truth->'remaining_cents','settlement',truth->'settlement');
 financial:=public._sales_invoice_read(_tenant,_invoice,0,3)->'financial_summary';
 IF financial->'invoice_id' IS DISTINCT FROM to_jsonb(_invoice)
  OR financial->'invoice_version' IS DISTINCT FROM result->'version'
  OR financial->'manual_recorded_minor' IS DISTINCT FROM result->'manual_recorded_cents'
  OR financial->'provider_confirmed_minor' IS DISTINCT FROM result->'provider_verified_cents'
  OR financial->'test_provider_minor' IS DISTINCT FROM result->'test_provider_verified_cents' THEN
  RAISE EXCEPTION 'Invoice ledger financial source changed; reload' USING ERRCODE='40001';END IF;
 IF evidence_version='3' THEN
  RETURN result||jsonb_build_object('financial_evidence_version',3,'financial_summary',financial,
   'currency',financial->'currency','remaining_cents',financial->'outstanding_minor',
   'settlement',CASE WHEN result->>'status'='void' THEN 'void'
    WHEN financial->>'standing'<>'recorded' THEN 'verification_pending'
    WHEN (financial->>'outstanding_minor')::numeric=0 THEN 'no_amount_due' ELSE 'outstanding' END);
 END IF;
 IF result->>'status'<>'void' AND (financial->>'standing' IS DISTINCT FROM 'recorded'
  OR financial->'outstanding_minor' IS DISTINCT FROM result->'remaining_cents'
  OR financial->'refund_payable_minor' IS DISTINCT FROM '0'::jsonb
  OR financial->'credit_minor' IS DISTINCT FROM '0'::jsonb) THEN
  RAISE EXCEPTION 'Invoice ledger financial representation changed; reload' USING ERRCODE='40001';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) FROM PUBLIC;
