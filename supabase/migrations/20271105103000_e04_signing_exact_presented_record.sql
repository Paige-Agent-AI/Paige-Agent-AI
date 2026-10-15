-- E04 exact signing presentation. CLI-generated forward migration, ordered after
-- the prospective commercial capsule, client invoice read continuation and
-- main's 20271101180000 numeric-target foundation. No published history rewrite.
-- Same token, expiry, revocation, status and once-only view contract; no backfill,
-- signature, effectuation, provider action or new agreement store.
CREATE OR REPLACE FUNCTION public.peek_agreement_signing(_token text)
RETURNS TABLE (
  document_title text,
  document_body text,
  document_path text,
  business_name text,
  brand jsonb,
  signer_display_name text,
  amount_minor bigint,
  amount_currency text,
  term_summary text,
  expires_at timestamptz,
  signature_state text,
  is_valid boolean
)
LANGUAGE plpgsql
-- NOT STABLE: this records the view. See the header.
VOLATILE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  _hash text;
  _s record;
  _a record;
  _t record;
  _amount_minor bigint := NULL;
  _amount_currency text := NULL;
  _term_summary text := NULL;
  _presented_file boolean;
  _capsule jsonb;
  _payload jsonb;
  _commercial_source jsonb;
BEGIN
  -- Shape first: anything that is not 64 hex characters is refused without touching a table.
  IF _token IS NULL OR _token !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text,
                        NULL::bigint, NULL::text, NULL::text, NULL::timestamptz, NULL::text, false;
    RETURN;
  END IF;

  _hash := encode(digest(_token, 'sha256'), 'hex');

  SELECT s.* INTO _s FROM public.paige_agreement_signers s WHERE s.token_hash = _hash;
  IF NOT FOUND
     OR _s.token_revoked_at IS NOT NULL
     OR _s.token_expires_at IS NULL OR _s.token_expires_at <= now()
     OR _s.status IN ('signed','declined')
  THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text,
                        NULL::bigint, NULL::text, NULL::text, NULL::timestamptz, NULL::text, false;
    RETURN;
  END IF;

  SELECT a.* INTO _a FROM public.paige_agreements a WHERE a.id = _s.agreement_id;
  IF NOT FOUND
     OR _a.tenant_id IS DISTINCT FROM _s.tenant_id
     OR _a.status NOT IN ('sent','viewed','partially_signed')
     OR (_a.expires_at IS NOT NULL AND _a.expires_at <= now())
  THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text,
                        NULL::bigint, NULL::text, NULL::text, NULL::timestamptz, NULL::text, false;
    RETURN;
  END IF;

  -- ── THE VIEW, recorded once ───────────────────────────────────────────────────────────────────
  -- Only from `pending`, so a reload is not a second view and a signer who is mid-ceremony is not
  -- rewound. The audit row is filed only when the signer row actually moved, so the trail counts
  -- openings rather than page loads.
  -- Choose the exact retained media. A copied PDF and its digest cannot be
  -- represented by the original editable text or a private storage path.
  _presented_file := _a.content_storage_key IS NOT NULL;
  IF (_presented_file AND (length(_a.content_storage_key)=0 OR
       coalesce(_a.content_sha256,'') !~ '^[a-f0-9]{64}$'))
     OR (_a.body_source='tenant_upload' AND NOT _presented_file) THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text,
                        NULL::bigint, NULL::text, NULL::text, NULL::timestamptz, NULL::text, false;
    RETURN;
  END IF;

  -- Only the immutable prospective capsule supplies structured economics.
  -- Historical documents remain readable with unknown economics; current
  -- mutable commercial rows are never promoted into what this signer saw.
  IF _a.commercial_presentation IS NOT NULL THEN
    _capsule:=_a.commercial_presentation;
    _payload:=_capsule->'payload';
    _commercial_source:=_payload->'source';
    IF NOT _presented_file OR _a.presented_body_markdown IS NULL
      OR jsonb_typeof(_capsule) IS DISTINCT FROM 'object'
      OR jsonb_typeof(_payload) IS DISTINCT FROM 'object'
      OR jsonb_typeof(_commercial_source) IS DISTINCT FROM 'object'
      OR jsonb_typeof(_payload->'principal_minor') IS DISTINCT FROM 'number'
      OR coalesce(_payload->>'principal_minor','') !~ '^[1-9][0-9]{0,9}$'
      OR _payload->>'currency' IS DISTINCT FROM 'usd' THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text,
                        NULL::bigint, NULL::text, NULL::text, NULL::timestamptz, NULL::text, false;
    RETURN;
    END IF;
    IF (_payload->>'principal_minor')::bigint>2147483647
      OR _commercial_source->>'agreement_id' IS DISTINCT FROM _a.id::text
      OR _commercial_source->>'tenant_id' IS DISTINCT FROM _a.tenant_id::text
      OR _commercial_source->>'client_id' IS DISTINCT FROM _a.contact_id::text
      OR _commercial_source->>'offer_id' IS DISTINCT FROM _a.offer_id::text
      OR _commercial_source->>'terms_id' IS DISTINCT FROM _a.commercial_terms_id::text
      OR _commercial_source->'agreement_version' IS DISTINCT FROM to_jsonb(_a.version)
      OR _payload->>'title' IS DISTINCT FROM _a.title
      OR _capsule->>'content_storage_key' IS DISTINCT FROM _a.content_storage_key
      OR _capsule->>'document_sha256' IS DISTINCT FROM _a.content_sha256
      OR _capsule->>'payload_digest' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        public._paige_commercial_canonical_json(_payload),'UTF8')),'hex')
      OR _capsule->>'presented_body_sha256' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(_a.presented_body_markdown,'UTF8')),'hex')
      OR _payload->>'body_sha256' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(_a.body_markdown,''),'UTF8')),'hex') THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text,
                        NULL::bigint, NULL::text, NULL::text, NULL::timestamptz, NULL::text, false;
    RETURN;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.paige_agreement_events e
      WHERE e.agreement_id=_a.id AND e.tenant_id=_a.tenant_id AND e.event_type='edited'
        AND e.actor_kind IN ('owner','paige') AND e.actor_user_id IS NOT NULL
        AND e.detail->>'action'='commercial_presentation_frozen'
        AND e.detail->>'payload_digest'=_capsule->>'payload_digest'
        AND e.detail->>'document_sha256'=_a.content_sha256
        AND e.detail->>'terms_id'=_a.commercial_terms_id::text
        AND e.detail->>'terms_version'=_commercial_source->>'terms_version') THEN
      RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text,
                          NULL::bigint, NULL::text, NULL::text, NULL::timestamptz, NULL::text, false;
      RETURN;
    END IF;
    _amount_minor:=(_payload->>'principal_minor')::bigint;
    _amount_currency:=_payload->>'currency';
    _term_summary:=_payload#>>'{collection_terms,kind}';
  END IF;

  UPDATE public.paige_agreement_signers
     SET status = 'viewed', first_viewed_at = now(), updated_at = now()
   WHERE id = _s.id AND status = 'pending';

  IF FOUND THEN
    INSERT INTO public.paige_agreement_events
      (agreement_id, tenant_id, signer_id, event_type, actor_kind, actor_email)
    VALUES (_a.id, _a.tenant_id, _s.id, 'viewed', 'signer', _s.email);

    -- Forward only, and only from `sent`: a partially-signed agreement does not fall back to viewed.
    -- `viewed_at` is set outside that status guard and coalesced, so the FIRST open is recorded even
    -- when the agreement has already moved on — and is never overwritten by a later one.
    UPDATE public.paige_agreements
       SET status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END,
           viewed_at = coalesce(viewed_at, now()),
           updated_at = now()
     WHERE id = _a.id AND status IN ('sent','viewed','partially_signed');

    -- Reflect what we just wrote rather than the row read a moment ago.
    _s.status := 'viewed';
  END IF;

  SELECT t.name, t.brand INTO _t FROM public.tenants t WHERE t.id = _a.tenant_id;

  -- No immutable presented-and-approved economics snapshot exists for these records.
  -- The linked commercial row is mutable; displaying it beside frozen document bytes
  -- falsely makes a current amount look like the signer's recorded financial context.
  -- Without a valid prospective capsule, economics stay NULL. The exact legacy
  -- text/file remains readable without parsing it into structured acceptance.

  RETURN QUERY SELECT
    _a.title,
    CASE WHEN _presented_file THEN NULL::text ELSE _a.body_markdown END,
    CASE WHEN _presented_file THEN 'retained-document'::text ELSE _a.document_path END,
    _t.name,
    _t.brand,
    _s.full_name,
    _amount_minor,
    _amount_currency,
    _term_summary,
    _a.expires_at,
    _a.status,
    true;
END;
$$;

-- definer-anon-exempt: the signer has no Supabase account, so there is no session to gate on — the
-- 256-bit token IS the credential. The body hashes it, looks up BY HASH, takes tenant, agreement and
-- signer from the row it found, returns a hand-written allow-list rather than a row, and refuses
-- every failure uniformly. Unchanged from 20270404000000; restated because the grant is re-issued.
REVOKE ALL ON FUNCTION public.peek_agreement_signing(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_agreement_signing(text) TO anon, authenticated;
