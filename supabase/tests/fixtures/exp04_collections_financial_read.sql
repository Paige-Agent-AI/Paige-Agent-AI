-- EXP04 O5 unversioned original Collections read candidate. NOT a native forward.
-- Preserve the original actor/snapshot/cursor authority and unversioned callers.
-- Representation selection changes no permission, financial record or provider.
CREATE OR REPLACE FUNCTION public.list_sales_collection_register(
 _expected_tenant_id uuid,_entity text DEFAULT 'invoice',_limit integer DEFAULT 50,_cursor jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; rows jsonb; headers jsonb; actual boolean;
BEGIN
 result:=public._list_sales_collection_register_before_provider(_expected_tenant_id,_entity,_limit,_cursor);
 BEGIN
  headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Invalid invoice financial representation' USING ERRCODE='22023';
 END;
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' OR (headers ? 'x-paige-invoice-evidence-version' AND
  (jsonb_typeof(headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string'
   OR headers->>'x-paige-invoice-evidence-version'<>'2')) THEN
  RAISE EXCEPTION 'Invalid invoice financial representation' USING ERRCODE='22023';
 END IF;
 actual:=coalesce(headers->>'x-paige-invoice-evidence-version'='2',false);
 IF _entity='invoice' THEN
  SELECT coalesce(jsonb_agg(row.value||jsonb_build_object(
   'manual_recorded_cents',b.manual_minor,
   'provider_verified_cents',CASE WHEN actual THEN b.live_provider_minor ELSE b.provider_minor END,
   'remaining_cents',CASE WHEN actual THEN b.receivable_remaining_minor ELSE b.remaining_minor END,
   'collection_required',(CASE WHEN actual THEN b.receivable_remaining_minor ELSE b.remaining_minor END)>0
    AND row.value->>'status' IN ('issued','recorded'))
   ||CASE WHEN actual THEN jsonb_build_object('payment_evidence_version',2,
     'allocated_cents',b.receivable_allocated_minor,'test_provider_verified_cents',b.test_provider_minor)
    ELSE '{}'::jsonb END ORDER BY row.ordinality),'[]'::jsonb)
  INTO rows FROM jsonb_array_elements(result->'rows') WITH ORDINALITY row(value,ordinality)
  CROSS JOIN LATERAL public._sales_invoice_financial_position_rows(_expected_tenant_id,(row.value->>'id')::uuid) b;
 ELSE
  SELECT coalesce(jsonb_agg(row.value
   ||CASE WHEN p.evidence_kind='provider_verified' THEN jsonb_build_object('provenance','provider_verified','provider',p.provider)
     ELSE '{}'::jsonb END
   ||CASE WHEN actual THEN jsonb_build_object('payment_evidence_version',2,
     'provider_environment',CASE WHEN p.evidence_kind='provider_verified' THEN p.provider_environment END)
     ELSE '{}'::jsonb END ORDER BY row.ordinality),'[]'::jsonb)
  INTO rows FROM jsonb_array_elements(result->'rows') WITH ORDINALITY row(value,ordinality)
  LEFT JOIN public.paige_invoice_payments p ON p.tenant_id=_expected_tenant_id AND p.id=(row.value->>'id')::uuid;
 END IF;
 RETURN result||jsonb_build_object('rows',rows,'balance_basis','canonical_receipt_allocations')
  ||CASE WHEN actual THEN jsonb_build_object('payment_evidence_version',2) ELSE '{}'::jsonb END;
END $$;
