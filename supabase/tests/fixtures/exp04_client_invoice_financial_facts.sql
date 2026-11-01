-- EXP04 O5 selected-schema candidate ONLY; not a deployed forward.
-- ONE original query, exact old five-argument caller adapter, closed native
-- real-receivable representation. No public grant, resolver, role or writer change.
-- Original source body md5 a307bf9e57e5b2ad692c74a329e683cd.
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
BEGIN
  IF p_payment_evidence_version IS NULL OR p_payment_evidence_version NOT IN (1,2) THEN
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

  -- One statement snapshot: the page, every-page totals and counts agree.
  WITH facts AS MATERIALIZED (
    SELECT i.id, i.invoice_number, i.status, lower(i.currency) AS currency, i.due_date,
      i.billing_issued_at AS issued_at, i.billing_issued_snapshot_version AS issued_snapshot_version,
      b.amount_minor,
      CASE WHEN p_payment_evidence_version=2 THEN b.receivable_remaining_minor ELSE b.remaining_minor END AS remaining_minor,
      b.manual_minor,
      CASE WHEN p_payment_evidence_version=2 THEN b.live_provider_minor ELSE b.provider_minor END AS provider_minor,
      b.test_provider_minor
    FROM public.paige_invoices i
    CROSS JOIN LATERAL public._sales_invoice_financial_position_rows(_tenant, i.id) b
    WHERE i.tenant_id = _tenant AND i.contact_id = _client
      AND i.status IN ('issued','void')
      AND i.billing_issued_snapshot_version IS NOT NULL AND i.billing_document IS NOT NULL
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
    FROM page p WHERE p.status = 'issued'
  ), projected AS (
    SELECT p.id, p.issued_at, jsonb_build_object(
      'id', p.id, 'invoice_number', p.invoice_number, 'status', p.status, 'currency', p.currency,
      'issued_at', p.issued_at, 'due_date', p.due_date,
      'issued_snapshot_version', p.issued_snapshot_version,
      'amount_minor', p.amount_minor::text, 'remaining_minor', p.remaining_minor::text,
      'provider_verified_minor', p.provider_minor::text, 'manual_recorded_minor', p.manual_minor::text,
      'test_provider_minor', p.test_provider_minor::text,
      'payable', coalesce(r.payable, false),
      'past_due', p.status = 'issued' AND p.remaining_minor > 0 AND p.due_date IS NOT NULL AND p.due_date < _today) AS value
    FROM page p LEFT JOIN latest_request r ON r.id = p.id
  ), amounts AS (
    SELECT currency, sum(remaining_minor) AS remaining_minor, sum(provider_minor) AS provider_minor,
      sum(manual_minor) AS manual_minor, sum(test_provider_minor) AS test_provider_minor
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
      'test_provider_minor', test_provider_minor::text) ORDER BY currency) FROM amounts), '[]'::jsonb),
    'open_count', (SELECT count(*) FROM facts WHERE status = 'issued' AND remaining_minor > 0),
    '_native_sources', jsonb_build_object('as_of_date',p_as_of,'all_facts_identity',
      encode(extensions.digest(coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM facts f),'[]'::jsonb)::text,'sha256'),'hex')),
    'read_at', statement_timestamp()
  ) INTO _result;
  RETURN _result || CASE WHEN p_payment_evidence_version=2
    THEN jsonb_build_object('payment_evidence_version',2) ELSE '{}'::jsonb END;
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

CREATE OR REPLACE FUNCTION public._client_portal_invoice_facts_for_client(_tenant uuid, _client uuid, p_limit integer, p_after jsonb, p_as_of date)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RETURN public._client_portal_invoice_facts_for_client(_tenant,_client,p_limit,p_after,p_as_of,1);
END;
$$;
REVOKE ALL ON FUNCTION public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date) FROM PUBLIC;

