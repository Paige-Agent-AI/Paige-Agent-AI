-- EXP04 O5 test-only financial-position candidate; NOT a versioned migration.
-- Factor the ORIGINAL single Sales balance calculation, retaining its seven-column
-- compatibility projection. Receivable fields never count TEST verification as
-- customer cash. Manual-recorded and provider-verified evidence remain separate.
-- No provider call, financial write, credit authority or production mount.
CREATE OR REPLACE FUNCTION public._sales_invoice_financial_position_rows(_tenant uuid,_invoice uuid DEFAULT NULL)
RETURNS TABLE(invoice_id uuid,amount_minor bigint,allocated_minor numeric,
 remaining_minor numeric,manual_minor numeric,provider_minor numeric,test_provider_minor numeric,
 receivable_allocated_minor numeric,receivable_remaining_minor numeric,live_provider_minor numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT b.*,b.allocated_minor-b.test_provider_minor,b.remaining_minor+b.test_provider_minor,b.provider_minor-b.test_provider_minor
 FROM (
  SELECT i.id AS invoice_id,i.amount_total_cents::bigint AS amount_minor,coalesce(p.allocated,0) AS allocated_minor,
   i.amount_total_cents-coalesce(p.allocated,0) AS remaining_minor,coalesce(p.manual,0) AS manual_minor,
   coalesce(p.verified,0) AS provider_minor,coalesce(p.test_verified,0) AS test_provider_minor
  FROM public.paige_invoices i
  LEFT JOIN LATERAL (
   SELECT sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) allocated,
    sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) FILTER(WHERE evidence_kind='manual_recorded') manual,
    sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) FILTER(WHERE evidence_kind='provider_verified') verified,
    sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) FILTER(WHERE evidence_kind='provider_verified' AND provider_environment='test') test_verified
   FROM public.paige_invoice_payments WHERE tenant_id=_tenant AND invoice_id=i.id
  ) p ON true WHERE i.tenant_id=_tenant AND (_invoice IS NULL OR i.id=_invoice)
 ) b;
$$;
REVOKE ALL ON FUNCTION public._sales_invoice_financial_position_rows(uuid,uuid) FROM PUBLIC;
DO $private_acl$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public._sales_invoice_financial_position_rows(uuid,uuid)'::regprocedure
   AND (a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
  RAISE EXCEPTION 'Private financial position permission drift' USING ERRCODE='23514';
 END IF;
END $private_acl$;

-- Compatibility is a projection of the SAME calculation, not a second balance
-- engine. Existing provider_minor includes TEST; existing Finance readers that
-- subtract test_provider_minor retain their exact contract until adoption.
CREATE OR REPLACE FUNCTION public._sales_invoice_balance_rows(_tenant uuid,_invoice uuid DEFAULT NULL)
RETURNS TABLE(invoice_id uuid,amount_minor bigint,allocated_minor numeric,
 remaining_minor numeric,manual_minor numeric,provider_minor numeric,test_provider_minor numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT b.invoice_id,b.amount_minor,b.allocated_minor,b.remaining_minor,b.manual_minor,b.provider_minor,b.test_provider_minor
 FROM public._sales_invoice_financial_position_rows(_tenant,_invoice) b;
$$;
REVOKE ALL ON FUNCTION public._sales_invoice_balance_rows(uuid,uuid) FROM PUBLIC;

