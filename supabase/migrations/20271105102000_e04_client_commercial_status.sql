-- E04 O11: authenticated client projection over existing canonical invoices.
-- CLI-generated locally and ordered after the prospective presentation contract.
-- No bearer grants, provider requests, ledger, receipt writes or completion claims.
-- A private domain check shared by the two read projections below. Existing
-- auth.uid, canonical roles and client linkage remain the authority source.
CREATE OR REPLACE FUNCTION public._assert_e04_client_commercial_scope(
  p_expected_actor_id uuid,p_expected_tenant_id uuid,p_client_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();
BEGIN
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_expected_actor_id
    OR p_expected_tenant_id IS NULL OR p_client_id IS NULL
    OR public.is_platform_owner() IS TRUE THEN
    RAISE EXCEPTION 'CLIENT_COMMERCIAL_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  -- Reuse the actual actor and linked-client floor, never a profile/email guess.
  PERFORM 1 FROM auth.users WHERE id=v_actor AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<now()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLIENT_COMMERCIAL_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenants WHERE id=p_expected_tenant_id
    AND account_type::text='standalone' AND parent_tenant_id IS NULL AND status::text='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLIENT_COMMERCIAL_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=p_expected_tenant_id
    AND user_id=v_actor AND status='active') THEN
    RAISE EXCEPTION 'CLIENT_COMMERCIAL_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.clients WHERE id=p_client_id AND tenant_id=p_expected_tenant_id
    AND linked_user_id=v_actor AND merged_into_contact_id IS NULL AND status::text='active' FOR SHARE;
  IF NOT FOUND OR (SELECT count(*) FROM public.clients WHERE tenant_id=p_expected_tenant_id
    AND linked_user_id=v_actor AND merged_into_contact_id IS NULL AND status::text='active')<>1 THEN
    RAISE EXCEPTION 'CLIENT_COMMERCIAL_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._assert_e04_client_commercial_scope(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.read_client_commercial_status_scoped(
  p_expected_actor_id uuid,p_expected_tenant_id uuid,p_client_id uuid,
  p_invoice_id uuid DEFAULT NULL,p_limit integer DEFAULT 40,p_after jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_actor uuid:=auth.uid(); v_result jsonb; v_after_at timestamptz; v_after_id uuid;
BEGIN
  PERFORM public._assert_e04_client_commercial_scope(p_expected_actor_id,p_expected_tenant_id,p_client_id);
  IF p_limit IS NULL OR p_limit<1 OR p_limit>40 THEN
    RAISE EXCEPTION 'CLIENT_COMMERCIAL_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_after IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_after) IS DISTINCT FROM 'object'
      OR NOT (p_after ?& ARRAY['issued_at','id'])
      OR (p_after - ARRAY['issued_at','id'])<>'{}'::jsonb THEN
      RAISE EXCEPTION 'CLIENT_COMMERCIAL_INPUT_INVALID' USING ERRCODE='22023';
    END IF;
    BEGIN
      v_after_at:=(p_after->>'issued_at')::timestamptz;
      v_after_id:=(p_after->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'CLIENT_COMMERCIAL_INPUT_INVALID' USING ERRCODE='22023';
    END;
    IF v_after_at IS NULL OR NOT pg_catalog.isfinite(v_after_at) OR v_after_id IS NULL THEN
      RAISE EXCEPTION 'CLIENT_COMMERCIAL_INPUT_INVALID' USING ERRCODE='22023';
    END IF;
  END IF;

  -- A single statement snapshot makes the list, detail and all-page totals agree.
  -- Balances, reversals and provider evidence come ONLY from Sales' canonical owner.
  WITH facts AS MATERIALIZED (
    SELECT i.id,i.invoice_number,CASE WHEN i.status='void' THEN 'void'
      WHEN i.status='recorded' THEN 'recorded' ELSE 'issued' END AS status,
      pg_catalog.lower(i.currency) AS currency,
      i.due_date,i.billing_document,i.billing_issued_snapshot_version,
      coalesce(i.billing_issued_at,i.created_at) AS issued_at,
      b.amount_minor,b.allocated_minor,b.remaining_minor,b.manual_minor,b.provider_minor,b.test_provider_minor
    FROM public.paige_invoices i
    CROSS JOIN LATERAL public._sales_invoice_balance_rows(p_expected_tenant_id,i.id) b
    WHERE i.tenant_id=p_expected_tenant_id AND i.contact_id=p_client_id
      AND i.status IN ('issued','sent','paid','void','uncollectible','recorded')
  ), candidates AS (
    SELECT * FROM facts WHERE p_after IS NULL OR (issued_at,id)<(v_after_at,v_after_id)
    ORDER BY issued_at DESC,id DESC LIMIT p_limit+1
  ), page AS (
    SELECT * FROM candidates ORDER BY issued_at DESC,id DESC LIMIT p_limit
  ), amounts AS (
    SELECT currency,sum(remaining_minor)::text AS remaining_minor,
      sum(manual_minor)::text AS manual_minor,sum(provider_minor)::text AS provider_minor,
      sum(test_provider_minor)::text AS test_provider_minor
    FROM facts WHERE status<>'void' GROUP BY currency
  ), projected AS (
    SELECT f.id,f.issued_at,pg_catalog.jsonb_build_object(
      'id',f.id,'invoice_number',f.invoice_number,'status',f.status,'currency',f.currency,
      'issued_at',f.issued_at,'due_date',f.due_date,'issued_snapshot_version',f.billing_issued_snapshot_version,
      'amount_minor',f.amount_minor::text,'allocated_minor',f.allocated_minor::text,
      'remaining_minor',f.remaining_minor::text,'manual_recorded_minor',f.manual_minor::text,
      'provider_verified_minor',f.provider_minor::text,'test_provider_minor',f.test_provider_minor::text,
      'document_available',pg_catalog.jsonb_typeof(f.billing_document) IS NOT DISTINCT FROM 'object') AS value
    FROM page f
  ) SELECT pg_catalog.jsonb_build_object(
    'schema_version',1,'actor_id',v_actor,'tenant_id',p_expected_tenant_id,'client_id',p_client_id,
    'invoices',coalesce((SELECT pg_catalog.jsonb_agg(value ORDER BY issued_at DESC,id DESC) FROM projected),'[]'::jsonb),
    'invoice_count',(SELECT count(*) FROM facts),'has_more',(SELECT count(*) FROM candidates)>p_limit,
    'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN
      (SELECT pg_catalog.jsonb_build_object('issued_at',issued_at,'id',id) FROM page ORDER BY issued_at,id LIMIT 1) ELSE NULL END,
    'balances',coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'currency',currency,'remaining_minor',remaining_minor,'manual_recorded_minor',manual_minor,
      'provider_verified_minor',provider_minor,'test_provider_minor',test_provider_minor) ORDER BY currency) FROM amounts),'[]'::jsonb),
    'invoice',CASE WHEN p_invoice_id IS NOT NULL THEN
      (SELECT pg_catalog.jsonb_build_object('id',id,'invoice_number',invoice_number,'status',status,
        'issued_snapshot_version',billing_issued_snapshot_version,'document',billing_document,
        'currency',currency,'amount_minor',amount_minor::text,'allocated_minor',allocated_minor::text,
        'remaining_minor',remaining_minor::text,'manual_recorded_minor',manual_minor::text,
        'provider_verified_minor',provider_minor::text,'test_provider_minor',test_provider_minor::text)
       FROM facts WHERE id=p_invoice_id) ELSE NULL END,
    'next_payment',pg_catalog.jsonb_build_object('state','unavailable','reason','effective_due_obligation_not_recorded'),
    'engagement_completion',pg_catalog.jsonb_build_object('state','not_evaluated'),
    'balance_basis','canonical_invoice_allocations','read_at',pg_catalog.statement_timestamp()
  ) INTO v_result;
  IF p_invoice_id IS NOT NULL AND v_result->'invoice'='null'::jsonb THEN
    RAISE EXCEPTION 'CLIENT_COMMERCIAL_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.read_client_commercial_status_scoped(uuid,uuid,uuid,uuid,integer,jsonb)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_client_commercial_status_scoped(uuid,uuid,uuid,uuid,integer,jsonb)
  TO authenticated;

-- Customer document and payment history reuse the existing immutable ledger
-- projection and its version/as_of cursor, without minting a bearer grant.
CREATE OR REPLACE FUNCTION public.read_client_sales_invoice_payment_ledger_scoped(
  p_expected_actor_id uuid,p_expected_tenant_id uuid,p_client_id uuid,p_invoice_id uuid,
  _limit integer DEFAULT 100,_cursor jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_status text;v_ledger jsonb;v_rows jsonb;
BEGIN
  PERFORM public._assert_e04_client_commercial_scope(p_expected_actor_id,p_expected_tenant_id,p_client_id);
  SELECT status INTO v_status FROM public.paige_invoices WHERE id=p_invoice_id
    AND tenant_id=p_expected_tenant_id AND contact_id=p_client_id
    AND status IN ('issued','sent','paid','void','uncollectible','recorded') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLIENT_COMMERCIAL_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  v_ledger:=public._sales_invoice_payment_ledger(p_expected_tenant_id,p_invoice_id,_limit,_cursor);
  SELECT coalesce(pg_catalog.jsonb_agg(value-'provider_operation_id' ORDER BY ordinal),'[]'::jsonb)
    INTO v_rows FROM pg_catalog.jsonb_array_elements(v_ledger->'payment_ledger'->'rows') WITH ORDINALITY AS x(value,ordinal);
  -- Collection strategy and internal provider-operation identity are owner data.
  RETURN pg_catalog.jsonb_set(v_ledger,'{payment_ledger,rows}',v_rows)||pg_catalog.jsonb_build_object(
    'status',CASE WHEN v_status='void' THEN 'void' WHEN v_status='recorded' THEN 'recorded' ELSE 'issued' END);
END $$;
REVOKE ALL ON FUNCTION public.read_client_sales_invoice_payment_ledger_scoped(uuid,uuid,uuid,uuid,integer,jsonb)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_client_sales_invoice_payment_ledger_scoped(uuid,uuid,uuid,uuid,integer,jsonb)
  TO authenticated;

-- Preserve provider environment in the incumbent read projections. Balances,
-- pagination, merchant binding and checkout eligibility keep their canonical owners.
CREATE OR REPLACE FUNCTION public._sales_invoice_read(_tenant uuid,_invoice uuid,_payment_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; balance record; payments jsonb;
BEGIN
 result:=public._sales_invoice_read_before_provider(_tenant,_invoice,_payment_limit);
 SELECT * INTO STRICT balance FROM public._sales_invoice_balance_rows(_tenant,_invoice);
 SELECT coalesce(jsonb_agg(row.value||jsonb_build_object('evidence_kind',p.evidence_kind,'provider',p.provider,'provider_verified_at',p.provider_verified_at,'provider_environment',p.provider_environment,
  'provenance',CASE WHEN p.evidence_kind='provider_verified' THEN 'provider_verified' WHEN p.import_provenance IS NOT NULL THEN 'owner_imported_unverified' ELSE 'human_recorded' END) ORDER BY row.ordinality),'[]'::jsonb)
 INTO payments FROM jsonb_array_elements(result->'payments') WITH ORDINALITY row(value,ordinality)
 JOIN public.paige_invoice_payments p ON p.id=(row.value->>'id')::uuid AND p.tenant_id=_tenant AND p.invoice_id=_invoice;
 RETURN result||jsonb_build_object('manual_recorded_cents',balance.manual_minor,'provider_verified_cents',balance.provider_minor,'test_provider_cents',balance.test_provider_minor,
  'allocated_cents',balance.allocated_minor,'remaining_cents',balance.remaining_minor,'payments',payments,
  'settlement',CASE WHEN result->>'status'='void' THEN 'void'
   WHEN balance.provider_minor>0 AND balance.manual_minor>0 AND balance.remaining_minor=0 THEN 'mixed_recorded_settled'
   WHEN balance.provider_minor>0 AND balance.remaining_minor=0 THEN 'provider_verified_settled'
   WHEN balance.provider_minor>0 AND balance.manual_minor>0 THEN 'mixed_recorded_partial'
   WHEN balance.provider_minor>0 THEN 'provider_verified_partial' ELSE result->>'settlement' END);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_read(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._sales_invoice_read(uuid,uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public._sales_invoice_payment_ledger(_tenant uuid,_invoice uuid,_limit integer,_cursor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; truth jsonb; rows jsonb;
BEGIN
 result:=public._sales_invoice_payment_ledger_before_provider(_tenant,_invoice,_limit,_cursor);
 truth:=public._sales_invoice_read(_tenant,_invoice,0);
 SELECT coalesce(jsonb_agg(row.value||CASE WHEN p.evidence_kind='provider_verified' THEN jsonb_build_object('provenance','provider_verified',
  'provider_environment',p.provider_environment,'provider',p.provider,'provider_operation_id',p.provider_operation_id,'provider_verified_at',p.provider_verified_at) ELSE '{}'::jsonb END ORDER BY row.ordinality),'[]'::jsonb)
 INTO rows FROM jsonb_array_elements(result->'payment_ledger'->'rows') WITH ORDINALITY row(value,ordinality)
 LEFT JOIN public.paige_invoice_payments p ON p.id=(row.value->>'id')::uuid AND p.tenant_id=_tenant AND p.invoice_id=_invoice;
 RETURN jsonb_set(result||jsonb_build_object('manual_recorded_cents',truth->'manual_recorded_cents','provider_verified_cents',truth->'provider_verified_cents','test_provider_cents',truth->'test_provider_cents',
  'allocated_cents',truth->'allocated_cents','settlement',truth->'settlement'),'{payment_ledger,rows}',rows);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._sales_invoice_payment_projection(_tenant uuid,_invoice uuid,_operation uuid,_remaining bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE; invoice public.paige_invoices%ROWTYPE; usable boolean;
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
 RETURN jsonb_build_object('amount_minor',op.amount_minor,'currency',op.currency,'state',op.state,'environment',op.environment,
  'provider_url',CASE WHEN usable THEN op.provider_url ELSE NULL END,'expires_at',op.expires_at);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_payment_projection(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;

-- Read the existing approved request only. This never creates checkout, mutates a
-- provider operation, allocates a payment, or grants a new bearer capability.
CREATE OR REPLACE FUNCTION public.read_client_sales_invoice_payment_request_scoped(
 p_expected_actor_id uuid,p_expected_tenant_id uuid,p_client_id uuid,p_invoice_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE invoice public.paige_invoices%ROWTYPE;truth jsonb;op_id uuid;request jsonb;
BEGIN
 PERFORM public._assert_e04_client_commercial_scope(p_expected_actor_id,p_expected_tenant_id,p_client_id);
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=p_invoice_id AND tenant_id=p_expected_tenant_id
  AND contact_id=p_client_id AND status='issued' AND billing_document IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CLIENT_COMMERCIAL_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 truth:=public._sales_invoice_read(p_expected_tenant_id,p_invoice_id,0);
 SELECT id INTO op_id FROM public.paige_invoice_provider_operations
  WHERE tenant_id=p_expected_tenant_id AND invoice_id=p_invoice_id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF FOUND THEN request:=public._sales_invoice_payment_projection(p_expected_tenant_id,p_invoice_id,op_id,(truth->>'remaining_cents')::bigint); END IF;
 RETURN pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'invoice_number',invoice.invoice_number,
  'remaining_cents',truth->'remaining_cents','test_provider_cents',truth->'test_provider_cents','payment_request',request);
END $$;
REVOKE ALL ON FUNCTION public.read_client_sales_invoice_payment_request_scoped(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_client_sales_invoice_payment_request_scoped(uuid,uuid,uuid,uuid) TO authenticated;
