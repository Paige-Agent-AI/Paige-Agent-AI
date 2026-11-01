-- Frozen WHOLE pre-factoring original query, used ONLY as a rollback test oracle.
-- Both original source contracts reuse this one fixture. Never a product reader.
CREATE OR REPLACE FUNCTION pg_temp.e04_legacy_invoice_oracle(_tenant uuid,_client uuid,p_limit integer,p_after jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $frozen$
DECLARE
  _after_at timestamptz;
  _after_id uuid;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _result jsonb;
BEGIN
  IF _tenant IS NULL OR _client IS NULL THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE='42501';
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
      i.billing_issued_at AS issued_at,
      b.amount_minor, b.remaining_minor, b.manual_minor, b.provider_minor, b.test_provider_minor
    FROM public.paige_invoices i
    CROSS JOIN LATERAL public._sales_invoice_balance_rows(_tenant, i.id) b
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
    'read_at', statement_timestamp()
  ) INTO _result;
  RETURN _result;
END;
$frozen$;
REVOKE ALL ON FUNCTION pg_temp.e04_legacy_invoice_oracle(uuid,uuid,integer,jsonb) FROM public,anon,authenticated,service_role;
