-- INERT original E04 O5 client financial projection; not a versioned release.
-- Extends the SAME private query. No public endpoint, actor/relationship, writer,
-- provider, grant, calendar, cursor or document authority change.
DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('eba917a1ba725cd71a3b5de01f30affb','1a622edb93cf9041638be41b615020c4')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
  OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_client','p_limit','p_after','p_as_of','p_payment_evidence_version']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
  RAISE EXCEPTION 'Original client financial projection source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_read(uuid,uuid,integer,integer)')
  AND pg_catalog.md5(prosrc)='9add10afcf85dfbec91f1268248dbb58' AND pg_catalog.pg_get_userbyid(proowner)='postgres'
  AND NOT prosecdef AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u' AND NOT proretset
  AND prorettype='jsonb'::regtype AND pronargdefaults=0 AND proargnames=ARRAY['_tenant','_invoice','_payment_limit','_financial_version']
  AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial reader requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

CREATE OR REPLACE FUNCTION public._client_portal_invoice_facts_for_client(_tenant uuid, _client uuid, p_limit integer, p_after jsonb, p_as_of date, p_payment_evidence_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  _after_at timestamptz;
  _after_id uuid;
  _today date := p_as_of;
  _result jsonb;
  _current_coherent boolean;
  _legacy_unsafe boolean;
BEGIN
  IF p_payment_evidence_version IS NULL OR p_payment_evidence_version NOT IN (1,2,3) THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  IF _tenant IS NULL OR _client IS NULL THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  IF p_as_of IS NOT NULL AND NOT isfinite(p_as_of) THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 40 THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_after IS NOT NULL THEN
    IF jsonb_typeof(p_after) IS DISTINCT FROM 'object' OR NOT (p_after ?& ARRAY['issued_at','id'])
       OR (p_after - ARRAY['issued_at','id']) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE = '22023';
    END IF;
    BEGIN
      _after_at := (p_after->>'issued_at')::timestamptz;
      _after_id := (p_after->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE = '22023';
    END;
    IF _after_at IS NULL OR NOT isfinite(_after_at) OR _after_id IS NULL THEN
      RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- SAME original query and authoritative current reader. The reader retains
  -- invoice and accepted-source locks; compare its current identity and gross
  -- facts with the original query snapshot before any result leaves this function.
  WITH source AS MATERIALIZED (
    SELECT i.id,i.invoice_number,i.status,i.currency,i.due_date,i.billing_issued_at,
      i.billing_issued_snapshot_version,coalesce(i.billing_lifecycle_version,i.billing_draft_version) AS source_version,
      public._sales_invoice_read(_tenant,i.id,0,3)->'financial_summary' AS financial
    FROM public.paige_invoices i
    WHERE i.tenant_id=_tenant AND i.contact_id=_client
      AND i.status IN ('issued','void')
      AND i.billing_issued_snapshot_version IS NOT NULL AND i.billing_document IS NOT NULL
  ), facts AS MATERIALIZED (
    SELECT i.id, i.invoice_number, i.status, lower(i.currency) AS currency, i.due_date,
      i.billing_issued_at AS issued_at, i.billing_issued_snapshot_version AS issued_snapshot_version,
      b.amount_minor,
      CASE WHEN p_payment_evidence_version=3 THEN (i.financial->>'outstanding_minor')::numeric
        WHEN p_payment_evidence_version=2 THEN b.receivable_remaining_minor ELSE b.remaining_minor END AS remaining_minor,
      b.manual_minor,
      CASE WHEN p_payment_evidence_version IN (2,3) THEN b.live_provider_minor ELSE b.provider_minor END AS provider_minor,
      b.test_provider_minor,i.financial,
      coalesce(i.financial->'invoice_id'=to_jsonb(i.id)
        AND i.financial->'invoice_version'=to_jsonb(i.source_version)
        AND i.financial->>'currency'=lower(i.currency)
        AND i.financial->'manual_recorded_minor'=to_jsonb(b.manual_minor)
        AND i.financial->'provider_confirmed_minor'=to_jsonb(b.live_provider_minor)
        AND i.financial->'test_provider_minor'=to_jsonb(b.test_provider_minor)
        AND ((i.status='issued' AND i.financial->>'standing'<>'not_applicable')
          OR (i.status='void' AND i.financial->>'standing'='not_applicable')),false) AS financial_coherent
    FROM source i
    CROSS JOIN LATERAL public._sales_invoice_financial_position_rows(_tenant, i.id) b
  ), candidates AS (
    SELECT * FROM facts WHERE p_after IS NULL OR (issued_at, id) < (_after_at, _after_id)
    ORDER BY issued_at DESC, id DESC LIMIT p_limit + 1
  ), page AS (
    SELECT * FROM candidates ORDER BY issued_at DESC, id DESC LIMIT p_limit
  ), latest_request AS (
    -- The business's most recent payment request per issued page invoice; the URL never leaves here.
    SELECT p.id, (
      SELECT (public._sales_invoice_payment_projection(_tenant, p.id, op.id, p.remaining_minor::bigint)->>'provider_url') IS NOT NULL
      FROM public.paige_invoice_provider_operations op
      WHERE op.tenant_id = _tenant AND op.invoice_id = p.id
      ORDER BY op.created_at DESC, op.id DESC LIMIT 1) AS payable
    FROM page p WHERE p.status = 'issued' AND (p_payment_evidence_version<>3 OR (p.financial->>'standing'='recorded' AND p.remaining_minor>0))
  ), projected AS (
    SELECT p.id, p.issued_at, jsonb_build_object(
      'id', p.id, 'invoice_number', p.invoice_number, 'status', p.status, 'currency', p.currency,
      'issued_at', p.issued_at, 'due_date', p.due_date,
      'issued_snapshot_version', p.issued_snapshot_version,
      'amount_minor', p.amount_minor::text, 'remaining_minor', p.remaining_minor::text,
      'provider_verified_minor', p.provider_minor::text, 'manual_recorded_minor', p.manual_minor::text,
      'test_provider_minor', p.test_provider_minor::text,
      'payable', coalesce(r.payable, false),
      'past_due', CASE WHEN p_payment_evidence_version=3 AND p.status='issued'
        AND p.financial->>'standing'<>'recorded' THEN NULL
        ELSE p.status='issued' AND p.remaining_minor>0 AND p.due_date IS NOT NULL AND p.due_date<_today END)
      ||CASE WHEN p_payment_evidence_version=3 THEN jsonb_build_object(
        'financial_standing',p.financial->'standing',
        'financial_revision',p.financial->'source_hash',
        'refund_payable_minor',p.financial->>'refund_payable_minor',
        'credit_minor',p.financial->>'credit_minor','provider_net_minor',p.financial->>'provider_net_minor') ELSE '{}'::jsonb END AS value
    FROM page p LEFT JOIN latest_request r ON r.id = p.id
  ), amounts AS (
    SELECT currency,CASE WHEN p_payment_evidence_version<>3 OR bool_and(financial->>'standing'='recorded')
        THEN sum(remaining_minor) END AS remaining_minor,sum(provider_minor) AS provider_minor,
      sum(manual_minor) AS manual_minor,sum(test_provider_minor) AS test_provider_minor,
      CASE WHEN bool_and(financial->>'standing'='recorded') THEN 'recorded' ELSE 'needs_review' END AS financial_standing,
      CASE WHEN bool_and(financial->>'standing'='recorded') THEN sum((financial->>'refund_payable_minor')::numeric) END AS refund_payable_minor,
      CASE WHEN bool_and(financial->>'standing'='recorded') THEN sum((financial->>'credit_minor')::numeric) END AS credit_minor,
      CASE WHEN bool_and(financial->>'standing'='recorded') THEN sum((financial->>'provider_net_minor')::numeric) END AS provider_net_minor
    FROM facts WHERE status <> 'void' GROUP BY currency
  )
  SELECT jsonb_build_object(
    'schema_version', 1,
    'tenant_id', _tenant,
    'business_name', (SELECT t.name FROM public.tenants t WHERE t.id = _tenant),
    'invoices', coalesce((SELECT jsonb_agg(value ORDER BY issued_at DESC, id DESC) FROM projected), '[]'::jsonb),
    'invoice_count', (SELECT count(*) FROM facts),
    'has_more', (SELECT count(*) FROM candidates) > p_limit,
    'next_cursor', CASE WHEN (SELECT count(*) FROM candidates) > p_limit THEN
      (SELECT jsonb_build_object('issued_at', issued_at, 'id', id) FROM page ORDER BY issued_at, id LIMIT 1) END,
    'balances', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'currency', currency, 'remaining_minor', remaining_minor::text,
      'provider_verified_minor', provider_minor::text, 'manual_recorded_minor', manual_minor::text,
      'test_provider_minor', test_provider_minor::text)
      ||CASE WHEN p_payment_evidence_version=3 THEN jsonb_build_object('financial_standing',financial_standing,
        'refund_payable_minor',refund_payable_minor::text,'credit_minor',credit_minor::text,
        'provider_net_minor',provider_net_minor::text) ELSE '{}'::jsonb END ORDER BY currency) FROM amounts), '[]'::jsonb),
    'open_count',CASE WHEN p_payment_evidence_version=3 AND EXISTS(
      SELECT 1 FROM facts WHERE status='issued' AND financial->>'standing'<>'recorded') THEN NULL
      ELSE (SELECT count(*) FROM facts WHERE status='issued' AND remaining_minor>0) END,
    '_native_sources', jsonb_build_object('as_of_date',p_as_of,'all_facts_identity',
      encode(extensions.digest(coalesce((SELECT jsonb_agg(CASE WHEN p_payment_evidence_version=3 THEN to_jsonb(f)-'financial_coherent'
        ELSE to_jsonb(f)-'financial'-'financial_coherent' END ORDER BY f.id) FROM facts f),'[]'::jsonb)::text,'sha256'),'hex')),
    'read_at', statement_timestamp()
  ),coalesce((SELECT bool_and(financial_coherent) FROM facts),true),
    coalesce((SELECT bool_or(status='issued' AND (financial->>'standing' IS DISTINCT FROM 'recorded'
      OR financial->'outstanding_minor' IS DISTINCT FROM to_jsonb(remaining_minor)
      OR financial->'refund_payable_minor' IS DISTINCT FROM '0'::jsonb
      OR financial->'credit_minor' IS DISTINCT FROM '0'::jsonb)) FROM facts),false)
    INTO _result,_current_coherent,_legacy_unsafe;
  IF NOT _current_coherent THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_SOURCE_CHANGED' USING ERRCODE='40001';END IF;
  IF p_payment_evidence_version<>3 AND _legacy_unsafe THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_FINANCIAL_VIEW_CHANGED' USING ERRCODE='40001';END IF;
  RETURN _result||CASE WHEN p_payment_evidence_version IN(2,3)
    THEN jsonb_build_object('payment_evidence_version',2) ELSE '{}'::jsonb END
    ||CASE WHEN p_payment_evidence_version=3 THEN jsonb_build_object('financial_evidence_version',3) ELSE '{}'::jsonb END;
END;
$function$;

REVOKE ALL ON FUNCTION public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer) FROM PUBLIC;
DO $private_acl$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)'::regprocedure
   AND (a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
  RAISE EXCEPTION 'Private client financial query permission drift' USING ERRCODE='23514';
 END IF;
END $private_acl$;

