-- Reconcile the existing E04 historical-context correction after the current frontier.
-- Preserve 20271110040000 pgcrypto qualification, original token/view lifecycle and ACL.
-- No agreement/terms/version/history backfill, signature, charge or provider effect.
-- definer-anon-exempt: existing 256-bit signing-token credential, hashed lookup only;
-- tenant/agreement/signer derive from the stored row, fixed twelve-column allow-list,
-- uniform refusal and unchanged anon/authenticated access. No new access is granted.
CREATE OR REPLACE FUNCTION public.peek_agreement_signing(_token text)
 RETURNS TABLE(document_title text, document_body text, document_path text, business_name text, brand jsonb, signer_display_name text, amount_minor bigint, amount_currency text, term_summary text, expires_at timestamp with time zone, signature_state text, is_valid boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _hash text;
  _s record;
  _a record;
  _t record;
  _amount_minor bigint := NULL;
  _amount_currency text := NULL;
  _term_summary text := NULL;
BEGIN
  -- Shape first: anything that is not 64 hex characters is refused without touching a table.
  IF _token IS NULL OR _token !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::text, NULL::jsonb, NULL::text,
                        NULL::bigint, NULL::text, NULL::text, NULL::timestamptz, NULL::text, false;
    RETURN;
  END IF;

  _hash := encode(extensions.digest(_token, 'sha256'), 'hex');

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

  -- No immutable presented-and-approved economics snapshot exists on these records.
  -- Current linked commercial terms can change after this document was frozen.
  -- Leave structured economics unknown; preserve the original document itself.

  RETURN QUERY SELECT
    _a.title,
    _a.body_markdown,
    _a.document_path,
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
$function$;

REVOKE ALL ON FUNCTION public.peek_agreement_signing(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.peek_agreement_signing(text) TO anon, authenticated;
