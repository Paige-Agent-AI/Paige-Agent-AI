-- INERT original public bearer payment-request financial representation.
-- Original token/expiry/revocation/invoice-version locks and service-only ACL unchanged.
DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.read_public_sales_invoice_payment_request(text)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('fa82176ce57fba9b1b9d82080ce07bc0','b7b62fe3131bea45818bfd99ccc9c01d')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
  OR p.proargnames IS DISTINCT FROM ARRAY['_token_hash'] OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
  RAISE EXCEPTION 'Original bearer payment source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_read(uuid,uuid,integer,integer)')
  AND pg_catalog.md5(prosrc)='9add10afcf85dfbec91f1268248dbb58'
  AND pg_catalog.pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial reader requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

CREATE OR REPLACE FUNCTION public.read_public_sales_invoice_payment_request(_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE truth jsonb; grant_row public.paige_invoice_access_grants%ROWTYPE; invoice public.paige_invoices%ROWTYPE; op_id uuid; request jsonb; headers jsonb; evidence_version text; financial jsonb; environment text;
BEGIN
 -- Preserve the existing bearer contract: no alternate grant or identity store.
 truth:=public.read_public_sales_invoice(_token_hash);
 IF truth IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO grant_row FROM public.paige_invoice_access_grants WHERE token_hash=_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO invoice FROM public.paige_invoices WHERE tenant_id=grant_row.tenant_id AND id=grant_row.invoice_id
  AND status='issued' AND billing_issued_snapshot_version=grant_row.issued_snapshot_version FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Representation never grants authority; original bearer and invoice locks precede it.
 headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' OR (headers ? 'x-paige-invoice-evidence-version' AND
  (jsonb_typeof(headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string'
    OR headers->>'x-paige-invoice-evidence-version' NOT IN('2','3'))) THEN
  RAISE EXCEPTION 'Invoice payment representation unavailable' USING ERRCODE='22023';END IF;
 evidence_version:=headers->>'x-paige-invoice-evidence-version';
 truth:=public._sales_invoice_read(invoice.tenant_id,invoice.id,0);
 financial:=public._sales_invoice_read(invoice.tenant_id,invoice.id,0,3)->'financial_summary';
 IF evidence_version='3' THEN
  truth:=truth||jsonb_build_object('remaining_cents',financial->'outstanding_minor');
 ELSIF financial->>'standing' IS DISTINCT FROM 'recorded'
  OR financial->'outstanding_minor' IS DISTINCT FROM truth->'remaining_cents'
  OR financial->'refund_payable_minor' IS DISTINCT FROM '0'::jsonb
  OR financial->'credit_minor' IS DISTINCT FROM '0'::jsonb THEN
  RAISE EXCEPTION 'Invoice financial representation changed' USING ERRCODE='40001';END IF;
 SELECT id,public.paige_invoice_provider_operations.environment INTO op_id,environment FROM public.paige_invoice_provider_operations WHERE tenant_id=invoice.tenant_id AND invoice_id=invoice.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF FOUND AND (evidence_version IS DISTINCT FROM '3' OR (financial->>'standing'='recorded' AND (truth->>'remaining_cents')::bigint>0)) THEN
  request:=public._sales_invoice_payment_projection(invoice.tenant_id,invoice.id,op_id,(truth->>'remaining_cents')::bigint);
  IF evidence_version='3' THEN request:=request||jsonb_build_object('environment',environment);END IF;
 END IF;
 RETURN jsonb_build_object('invoice_number',invoice.invoice_number,'remaining_cents',truth->'remaining_cents','payment_request',request)
  ||CASE WHEN evidence_version='3' THEN jsonb_build_object(
    'invoice_id',invoice.id,'invoice_version',invoice.billing_lifecycle_version,'currency',financial->'currency',
    'payment_evidence_version',2,'financial_evidence_version',3,'financial_summary',financial) ELSE '{}'::jsonb END;
END $function$
;
