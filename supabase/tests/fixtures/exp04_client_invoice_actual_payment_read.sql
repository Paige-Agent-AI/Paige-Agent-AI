-- INERT E04 O5 ORIGINAL customer payment-request financial projection.
-- No resolver/actor/client/invoice lock, public ABI, provider, grant or write change.
DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.client_portal_invoice_payment_request(uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('e59ce09de1660f47341787a89b7269ec','5addaaad6dbb3186f3b5ff67457ee009')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>1 OR p.prorettype<>'jsonb'::regtype
  OR pg_catalog.pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM 'NULL::uuid'
  OR p.proargnames IS DISTINCT FROM ARRAY['p_invoice_id','p_tenant_id']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
  RAISE EXCEPTION 'Original customer payment projection source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_read(uuid,uuid,integer,integer)')
  AND pg_catalog.md5(prosrc)='9add10afcf85dfbec91f1268248dbb58' AND pg_catalog.pg_get_userbyid(proowner)='postgres'
  AND NOT prosecdef AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u' AND NOT proretset
  AND prorettype='jsonb'::regtype AND pronargdefaults=0 AND proargnames=ARRAY['_tenant','_invoice','_payment_limit','_financial_version']
  AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial reader requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

CREATE OR REPLACE FUNCTION public.client_portal_invoice_payment_request(p_invoice_id uuid, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _client uuid;
  _tenant uuid;
  _number text;
  _remaining numeric;
  _test numeric;
  _op_id uuid;
  _op_environment text;
  _request jsonb;
  _headers jsonb;
  _evidence_version text;
  _financial jsonb;
BEGIN
  _client := public._client_portal_billing_client(p_tenant_id);
  IF _client IS NULL THEN RETURN NULL; END IF;
  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client;
  SELECT i.invoice_number INTO _number FROM public.paige_invoices i
  WHERE i.id = p_invoice_id AND i.tenant_id = _tenant AND i.contact_id = _client AND i.status = 'issued'
    AND i.billing_issued_snapshot_version IS NOT NULL AND i.billing_document IS NOT NULL
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;

  -- Original resolver and invoice lock above precede representation parsing.
  BEGIN _headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';END;
  IF jsonb_typeof(_headers) IS DISTINCT FROM 'object' OR (_headers ? 'x-paige-invoice-evidence-version' AND
    (jsonb_typeof(_headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string'
      OR _headers->>'x-paige-invoice-evidence-version' NOT IN('2','3'))) THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';END IF;
  _evidence_version:=_headers->>'x-paige-invoice-evidence-version';
  SELECT b.remaining_minor,b.test_provider_minor INTO _remaining,_test
    FROM public._sales_invoice_balance_rows(_tenant,p_invoice_id)b;
  IF _evidence_version IN('2','3') THEN
    SELECT b.receivable_remaining_minor,b.test_provider_minor INTO _remaining,_test
      FROM public._sales_invoice_financial_position_rows(_tenant,p_invoice_id)b;
  END IF;
  _financial:=public._sales_invoice_read(_tenant,p_invoice_id,0,3)->'financial_summary';
  IF _evidence_version='3' THEN
    _remaining:=(_financial->>'outstanding_minor')::numeric;
  ELSIF _financial->>'standing' IS DISTINCT FROM 'recorded'
    OR _financial->'outstanding_minor' IS DISTINCT FROM to_jsonb(_remaining)
    OR _financial->'refund_payable_minor' IS DISTINCT FROM '0'::jsonb
    OR _financial->'credit_minor' IS DISTINCT FROM '0'::jsonb THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_FINANCIAL_VIEW_CHANGED' USING ERRCODE='40001';
  END IF;
  SELECT op.id, op.environment INTO _op_id, _op_environment
  FROM public.paige_invoice_provider_operations op
  WHERE op.tenant_id = _tenant AND op.invoice_id = p_invoice_id
  ORDER BY op.created_at DESC, op.id DESC LIMIT 1;
  IF _op_id IS NOT NULL AND (_evidence_version IS DISTINCT FROM '3' OR (_financial->>'standing'='recorded' AND _remaining>0)) THEN
    _request := public._sales_invoice_payment_projection(_tenant, p_invoice_id, _op_id, _remaining::bigint)
      || jsonb_build_object('environment', _op_environment);
  END IF;
  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', _number,
    'remaining_cents', _remaining::bigint, 'test_provider_cents', coalesce(_test, 0)::bigint,
    'payment_request',_request)
    ||CASE WHEN _evidence_version IN('2','3') THEN jsonb_build_object('payment_evidence_version',2) ELSE '{}'::jsonb END
    ||CASE WHEN _evidence_version='3' THEN jsonb_build_object('financial_evidence_version',3,
      'financial_revision',_financial->'source_hash','financial_standing',_financial->'standing','refund_payable_minor',_financial->'refund_payable_minor',
      'credit_minor',_financial->'credit_minor','provider_net_minor',_financial->'provider_net_minor') ELSE '{}'::jsonb END;
END;
$$;
