-- INERT E04 O5 canonical checkout-link currentness repair, not a release.
-- SAME original projection/shape/permissions, same financial and target engines.
DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_payment_projection(uuid,uuid,uuid,bigint)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('228a194ceec12380fd8ce5f5aec5cc57','9577250340dcf99070b466bb40bef3a7')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
  OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_invoice','_operation','_remaining']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
  RAISE EXCEPTION 'Original payment-link projection source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)')
  AND pg_catalog.md5(prosrc)='bdb0960fa3d88b21cca90b79636dc7e1' AND pg_catalog.pg_get_userbyid(proowner)='postgres'
  AND NOT prosecdef AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u'
  AND proretset AND prorettype='record'::regtype AND pronargdefaults=0
  AND proargnames=ARRAY['_tenant','_invoice','_evidence_version','_proposal','invoice_id','financial_position']
  AND proallargtypes=ARRAY['uuid'::regtype::oid,'uuid'::regtype::oid,'integer'::regtype::oid,'jsonb'::regtype::oid,'uuid'::regtype::oid,'jsonb'::regtype::oid]
  AND proargmodes=ARRAY['i','i','i','i','t','t']::"char"[]
  AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_require_accepted_obligation(public.paige_invoices,jsonb)')
  AND pg_catalog.md5(prosrc)='e07fdfc39975c26c2ec07f0ac290ba2c' AND pg_catalog.pg_get_userbyid(proowner)='postgres'
  AND NOT prosecdef AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u'
  AND NOT proretset AND prorettype='void'::regtype AND pronargdefaults=0
  AND proargnames=ARRAY['_invoice','_command'] AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial target requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

CREATE OR REPLACE FUNCTION public._sales_invoice_payment_projection(_tenant uuid,_invoice uuid,_operation uuid,_remaining bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE; invoice public.paige_invoices%ROWTYPE; usable boolean; financial jsonb;
BEGIN
 SELECT * INTO invoice FROM public.paige_invoices WHERE tenant_id=_tenant AND id=_invoice FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE tenant_id=_tenant AND invoice_id=_invoice AND id=_operation;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 usable:=op.provider='stripe' AND op.state='customer_action_required' AND op.expires_at IS NOT NULL AND op.expires_at>clock_timestamp()
  AND invoice.status='issued' AND op.invoice_version=coalesce(invoice.billing_lifecycle_version,invoice.billing_draft_version)
  AND op.issued_snapshot_version=invoice.billing_issued_snapshot_version AND op.client_id=invoice.contact_id
  AND op.currency=lower(invoice.currency) AND _remaining>0 AND op.amount_minor<=_remaining
  AND op.provider_url ~ '^https://checkout[.]stripe[.]com/c/pay/[A-Za-z0-9_?=&%#./:+-]+$'
  AND EXISTS(SELECT 1 FROM public.tenant_stripe_accounts merchant WHERE merchant.tenant_id=_tenant
   AND merchant.stripe_account_id=op.merchant_account_id AND merchant.binding_version=op.merchant_binding_version
   AND merchant.provider_environment=op.environment AND merchant.charges_enabled AND merchant.sales_payment_permission);
 -- Reuse the canonical current position and accepted-target admission. This is
 -- a READ refusal only: no approval consumption, provider cancellation or charge.
 IF usable THEN
  BEGIN
   SELECT b.financial_position INTO STRICT financial
    FROM public._sales_invoice_financial_position_rows(_tenant,_invoice,3,NULL::jsonb)b;
   usable:=financial->>'financial_standing'='recorded'
    AND op.amount_minor<=(financial->>'actual_outstanding_minor')::numeric;
   IF usable THEN PERFORM public._sales_invoice_require_accepted_obligation(invoice,op.command);END IF;
  EXCEPTION WHEN SQLSTATE '40001' OR SQLSTATE '55000' OR SQLSTATE '22023' THEN
   usable:=false;
  END;
 END IF;
 RETURN jsonb_build_object('amount_minor',op.amount_minor,'currency',op.currency,'state',op.state,
  'provider_url',CASE WHEN usable THEN op.provider_url ELSE NULL END,'expires_at',op.expires_at);
END $$;
