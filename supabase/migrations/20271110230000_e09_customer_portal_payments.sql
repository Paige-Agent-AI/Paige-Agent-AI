-- E09 Payments: the customer reads the invoices their OWN business relationship has issued to them,
-- each invoice's payment history, and the payment link the business already sent. Read-only.
--
-- Visibility (owner decision D1): an invoice reaches its client the moment the business ISSUES it
-- to that client — managed `issued` and `void` rows with a frozen document only. Drafts, CSV
-- `recorded` imports and legacy rows never do. Issuing is the business's explicit act of sending.
--
-- Money boundary (CLAUDE.md §38): nothing here creates a charge, a checkout session, a payment
-- request, a receipt, a bearer grant or a provider call. A customer pays only through an EXISTING
-- request the business (or Paige, on the business's approval) already created, and only when the
-- incumbent `_sales_invoice_payment_projection` still validates it: Stripe Checkout direct charge on
-- the business's own connected account, never Paige as merchant of record.
--
-- One balance owner (CLAUDE.md §18): every amount comes from `_sales_invoice_balance_rows`, the
-- ledger from `_sales_invoice_payment_ledger`, the link from `_sales_invoice_payment_projection`.
-- None of the three is restated here; their bodies and grants are untouched.
--
-- One client invoice read home, derived from E04 #2170 (`aeb0db5f1`, branch
-- codex/e04-client-commercial-self-service; credit to E04). Its three client reads
-- (`read_client_commercial_status_scoped`, `read_client_sales_invoice_payment_{ledger,request}_scoped`)
-- are served here instead, through the same three Sales owners, so there is one home, not two. From
-- #2170's `_assert_e04_client_commercial_scope` this helper adopts the stricter caller guards: a
-- linked client who is ALSO active staff of the same business reads nothing, a platform owner reads
-- nothing, and a deleted or banned account is refused as unauthenticated (42501). It does NOT adopt
-- #2170's standalone-only tenant filter (§60/§61: a sub-account's customer reads the same) nor its
-- caller-supplied client id: the relationship is `client_portal_relationship_id`, derived from
-- auth.uid() and re-proven under FOR SHARE.
--
-- All four functions are VOLATILE: they take FOR SHARE row locks (directly and through the ledger
-- and projection owners), which PostgreSQL refuses inside a STABLE or IMMUTABLE function.
BEGIN;

-- ── The one customer billing scope ────────────────────────────────────────────────────────────────
-- Returns the caller's own client id, re-proven under FOR SHARE, or NULL for no relationship, for a
-- platform owner, and for a client who is also active staff of that business (guards from #2170). A
-- deleted or banned account raises 42501 like a signed-out caller. The multi-relationship 42501
-- propagates unchanged. Callers take the business from that client row (locked here for the rest of
-- the transaction), never from the argument.
CREATE OR REPLACE FUNCTION public._client_portal_billing_client(p_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _proven uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  -- A deleted or banned account is not a signed-in customer, whatever its token says (#2170).
  PERFORM 1 FROM auth.users u
  WHERE u.id = _uid AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until < now())
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  -- The platform owner is never anyone's customer here (#2170).
  IF public.is_platform_owner() IS TRUE THEN RETURN NULL; END IF;
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN NULL; END IF;
  -- Serialize against access changes and re-prove under the lock.
  SELECT c.id INTO _proven
  FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL AND t.status = 'active'
  FOR SHARE OF c, t;
  -- Someone who is both a linked client and active staff of the same business reads that business
  -- as staff, never through the customer door (#2170). Staff of a different business are unaffected.
  IF _proven IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members m JOIN public.clients c ON c.tenant_id = m.tenant_id
    WHERE c.id = _proven AND m.user_id = _uid AND m.status = 'active') THEN
    RETURN NULL;
  END IF;
  RETURN _proven;
END;
$$;
REVOKE ALL ON FUNCTION public._client_portal_billing_client(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ── List: the caller's issued invoices, all-page balances, keyset pages ───────────────────────────
CREATE OR REPLACE FUNCTION public.client_portal_invoices(
  p_tenant_id uuid DEFAULT NULL, p_limit integer DEFAULT 20, p_after jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _client uuid;
  _tenant uuid;
  _after_at timestamptz;
  _after_id uuid;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _result jsonb;
BEGIN
  _client := public._client_portal_billing_client(p_tenant_id);
  IF _client IS NULL THEN RETURN NULL; END IF;
  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client;

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
$$;
REVOKE ALL ON FUNCTION public.client_portal_invoices(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_invoices(uuid, integer, jsonb) TO authenticated, service_role;

-- ── Ledger: one visible invoice's document and payment history (the incumbent cursor) ─────────────
-- Parameter names `_limit`/`_cursor` match the edge collector `collectInvoiceLedger`.
CREATE OR REPLACE FUNCTION public.client_portal_invoice_ledger(
  p_invoice_id uuid, p_tenant_id uuid DEFAULT NULL, _limit integer DEFAULT 100, _cursor jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _client uuid;
  _tenant uuid;
  _ledger jsonb;
  _rows jsonb;
  _test numeric;
BEGIN
  _client := public._client_portal_billing_client(p_tenant_id);
  IF _client IS NULL THEN RETURN NULL; END IF;
  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client;
  -- One answer for "not yours" and "does not exist".
  PERFORM 1 FROM public.paige_invoices i
  WHERE i.id = p_invoice_id AND i.tenant_id = _tenant AND i.contact_id = _client
    AND i.status IN ('issued','void')
    AND i.billing_issued_snapshot_version IS NOT NULL AND i.billing_document IS NOT NULL
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;

  _ledger := public._sales_invoice_payment_ledger(_tenant, p_invoice_id, _limit, _cursor);
  -- Internal provider-operation identity is owner data. A provider receipt says which environment
  -- it came from, so a TEST receipt is never presented to the customer as money received.
  SELECT coalesce(jsonb_agg((x.value - 'provider_operation_id')
      || CASE WHEN x.value->>'provenance' = 'provider_verified'
           THEN jsonb_build_object('provider_environment', p.provider_environment) ELSE '{}'::jsonb END
      ORDER BY x.ordinal), '[]'::jsonb)
    INTO _rows
  FROM jsonb_array_elements(_ledger->'payment_ledger'->'rows') WITH ORDINALITY AS x(value, ordinal)
  LEFT JOIN public.paige_invoice_payments p
    ON p.id = (x.value->>'id')::uuid AND p.tenant_id = _tenant AND p.invoice_id = p_invoice_id;
  SELECT b.test_provider_minor INTO _test FROM public._sales_invoice_balance_rows(_tenant, p_invoice_id) b;
  RETURN jsonb_set(_ledger, '{payment_ledger,rows}', _rows)
    || jsonb_build_object('test_provider_cents', coalesce(_test, 0)::bigint);
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_invoice_ledger(uuid, uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_invoice_ledger(uuid, uuid, integer, jsonb) TO authenticated, service_role;

-- ── Payment request: the business's EXISTING link, if the incumbent projection still validates it ─
-- Never inserts, updates, claims or dispatches anything.
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
BEGIN
  _client := public._client_portal_billing_client(p_tenant_id);
  IF _client IS NULL THEN RETURN NULL; END IF;
  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client;
  SELECT i.invoice_number INTO _number FROM public.paige_invoices i
  WHERE i.id = p_invoice_id AND i.tenant_id = _tenant AND i.contact_id = _client AND i.status = 'issued'
    AND i.billing_issued_snapshot_version IS NOT NULL AND i.billing_document IS NOT NULL
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;

  SELECT b.remaining_minor, b.test_provider_minor INTO _remaining, _test
  FROM public._sales_invoice_balance_rows(_tenant, p_invoice_id) b;
  SELECT op.id, op.environment INTO _op_id, _op_environment
  FROM public.paige_invoice_provider_operations op
  WHERE op.tenant_id = _tenant AND op.invoice_id = p_invoice_id
  ORDER BY op.created_at DESC, op.id DESC LIMIT 1;
  IF _op_id IS NOT NULL THEN
    _request := public._sales_invoice_payment_projection(_tenant, p_invoice_id, _op_id, _remaining::bigint)
      || jsonb_build_object('environment', _op_environment);
  END IF;
  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', _number,
    'remaining_cents', _remaining::bigint, 'test_provider_cents', coalesce(_test, 0)::bigint,
    'payment_request', _request);
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_invoice_payment_request(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_invoice_payment_request(uuid, uuid) TO authenticated, service_role;

COMMIT;
