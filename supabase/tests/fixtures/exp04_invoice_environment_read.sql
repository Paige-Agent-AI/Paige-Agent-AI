-- EXP04 O5 unversioned customer-read candidate. NOT a deployed native forward.
-- The original frozen-record reader, payment history, pagination and outer
-- caller authority remain. All financial amounts come from the ONE native
-- position; TEST facts stay inspectable without becoming real collected money.
CREATE OR REPLACE FUNCTION public._sales_invoice_read(_tenant uuid,_invoice uuid,_payment_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; balance record; payments jsonb;
BEGIN
 result:=public._sales_invoice_read_before_provider(_tenant,_invoice,_payment_limit);
 SELECT * INTO STRICT balance FROM public._sales_invoice_financial_position_rows(_tenant,_invoice);
 SELECT coalesce(jsonb_agg(row.value||jsonb_build_object(
  'evidence_kind',p.evidence_kind,'provider',p.provider,'provider_verified_at',p.provider_verified_at,
  'provider_environment',CASE WHEN p.evidence_kind='provider_verified' THEN p.provider_environment END,
  'provenance',CASE WHEN p.evidence_kind='provider_verified' THEN 'provider_verified'
   WHEN p.import_provenance IS NOT NULL THEN 'owner_imported_unverified' ELSE 'human_recorded' END)
  ORDER BY row.ordinality),'[]'::jsonb)
 INTO payments FROM jsonb_array_elements(result->'payments') WITH ORDINALITY row(value,ordinality)
 JOIN public.paige_invoice_payments p ON p.id=(row.value->>'id')::uuid AND p.tenant_id=_tenant AND p.invoice_id=_invoice;
 RETURN result||jsonb_build_object('payment_evidence_version',2,
  'manual_recorded_cents',balance.manual_minor,'provider_verified_cents',balance.live_provider_minor,
  'test_provider_verified_cents',balance.test_provider_minor,
  'allocated_cents',balance.receivable_allocated_minor,'remaining_cents',balance.receivable_remaining_minor,
  'payments',payments,'settlement',CASE WHEN result->>'status'='void' THEN 'void'
   WHEN balance.live_provider_minor>0 AND balance.manual_minor>0 AND balance.receivable_remaining_minor=0 THEN 'mixed_recorded_settled'
   WHEN balance.live_provider_minor>0 AND balance.receivable_remaining_minor=0 THEN 'provider_verified_settled'
   WHEN balance.live_provider_minor>0 AND balance.manual_minor>0 THEN 'mixed_recorded_partial'
   WHEN balance.live_provider_minor>0 THEN 'provider_verified_partial'
   WHEN balance.manual_minor>0 AND balance.receivable_remaining_minor=0 THEN 'manually_recorded_settled'
   WHEN balance.manual_minor>0 THEN 'manually_recorded_partial' ELSE 'unpaid' END);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_read(uuid,uuid,integer) FROM PUBLIC;
