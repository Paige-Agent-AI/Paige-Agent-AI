-- EXP04 O5 test-only original ledger extension; NOT a forward migration.
-- Missing opt-in preserves the original payload. Explicit evidence2 carries
-- actual business balances and native running amounts, retaining raw history.
-- The header selects a representation; original outer caller/relationship and
-- this predecessor's document/version/cursor/share-lock authority remain.
CREATE OR REPLACE FUNCTION public._sales_invoice_payment_ledger(_tenant uuid,_invoice uuid,_limit integer,_cursor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; truth jsonb; rows jsonb; balance record; headers jsonb;
 actual boolean; test_receipts numeric; test_reversals numeric;
BEGIN
 result:=public._sales_invoice_payment_ledger_before_provider(_tenant,_invoice,_limit,_cursor);
 headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' OR
  (headers ? 'x-paige-invoice-evidence-version' AND
   (jsonb_typeof(headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string'
    OR headers->>'x-paige-invoice-evidence-version'<>'2')) THEN
  RAISE EXCEPTION 'Invoice evidence representation unavailable' USING ERRCODE='22023';
 END IF;
 actual:=headers->>'x-paige-invoice-evidence-version'='2';
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
  RETURN jsonb_set(result||jsonb_build_object('manual_recorded_cents',truth->'manual_recorded_cents',
   'provider_verified_cents',truth->'provider_verified_cents','allocated_cents',truth->'allocated_cents',
   'settlement',truth->'settlement'),'{payment_ledger,rows}',rows);
 END IF;

 truth:=public._sales_invoice_read(_tenant,_invoice,0);
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
 RETURN result||jsonb_build_object('payment_evidence_version',2,
  'manual_recorded_cents',truth->'manual_recorded_cents','provider_verified_cents',truth->'provider_verified_cents',
  'test_provider_verified_cents',truth->'test_provider_verified_cents','allocated_cents',truth->'allocated_cents',
  'remaining_cents',truth->'remaining_cents','settlement',truth->'settlement');
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) FROM PUBLIC;
