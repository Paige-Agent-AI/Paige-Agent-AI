-- E09 Slice A: a customer lists, opens-to-sign and downloads the Sales Agreements a business sent
-- them, from their portal, on the ONE existing agreements engine (paige_agreements + signers). No
-- new table, column, policy, trigger, event type, bucket or email.
--
-- WHY DEFINER FUNCTIONS AND NOT A POLICY. pa_tenant_isolation (20270401000000:622-632) is a
-- RESTRICTIVE gate that gives a portal client NOTHING, and its comment asks that any widening be a
-- deliberate, reviewed act. These three functions are that act, kept narrow: each re-proves the
-- caller's ONE relationship (client_portal_relationship_id + the Slice 1 lock) and returns or
-- touches only agreements whose contact_id IS that relationship. The RLS gate is not relaxed.
--
-- THE ONE WRITER, client_portal_open_agreement_signing, is the customer-side twin of
-- issue_agreement_signing_link (20270532110000:45-176) with three deliberate differences:
--   1. It NEVER writes paige_agreements. It never freezes a document, never moves a status and,
--      unlike the owner path, never rewrites expires_at. Only the customer's own signer row's
--      token_hash and token_expires_at change. It never clears token_revoked_at: a link someone
--      revoked stays revoked, and the portal refuses rather than undo it.
--   2. The new link expires at the EARLIER of the agreement's deadline and the emailed link's own
--      expiry, so it is never later than the link the business sent; with neither, or with that
--      moment already past, no link is issued here (NOT_SIGNABLE_HERE). There is one token per
--      signer row (token_hash UNIQUE), so this REPLACES the emailed link: the emailed one stops
--      working (owner decision D-A4, default). A re-open can only keep or shorten the deadline.
--   3. It files NO paige_agreement_events row. Those print in the sealed certificate
--      (_shared/agreements/seal.ts) and on the approved, frozen owner completion screen, where a
--      'resent' row reads "Sent again" — untrue for a customer opening their own portal. The audit
--      goes to paige_audit_log instead. The customer's real view is still recorded by
--      peek_agreement_signing when the frozen /sign/:token page loads.
BEGIN;

-- ── The one state derivation, shared by the list and the writer ─────────────────────────────────
-- Two copies of "is this waiting for you?" would drift; the list would offer a button the writer
-- refuses, or the reverse. Internal only: no role may call it directly; the two DEFINER callers run
-- as the owner.
--
-- "Your signer" is the agreement's counterparty signer, and there must be EXACTLY ONE. With none or
-- several (a co-signer), the portal cannot tell which row is this login, so it lists the agreement
-- as 'awaiting_signature' — waiting on a signature, not provably this customer's — and points them
-- to the signing link the business emailed, or to asking for a new one (D-A3).
--
-- AND THAT ONE SIGNER MUST BE THIS LOGIN (conservative default, pending an owner ruling). The sealed
-- certificate credits the signature to the person and address named on the signer row, and the
-- portal files no agreement event, so nothing in the certificate would show the link was obtained
-- through a portal session rather than at that address. So the portal hands out the signer's link
-- only when the signer row's email IS one of the caller's own addresses: the login's confirmed
-- email, or the client record's primary email (client_primary_address). Compared by the one email
-- match key (contact_method_match_key: trimmed, lowercase). Otherwise the agreement is listed as
-- 'awaiting_signature', NOT 'awaiting_you': the portal cannot say the signature it waits for is this
-- customer's, so it is neither counted nor headed as theirs. p_my_email_keys is that set, derived by
-- the two DEFINER callers from auth.uid() and the re-proved relationship — never from a caller
-- argument.
--
-- And the link it would hand out must have a deadline: the EARLIER of the agreement's deadline and
-- the signer's current (emailed) token expiry, returned as 'deadline' so the list can show the date
-- that actually binds ("Sign by"). With neither, or with that moment past, it is not signable here,
-- so the list never offers a button the writer refuses.
--
-- sign_note says WHY an 'awaiting_you' row is not signable here, so the page never points at a link
-- that is dead: 'link_revoked' (the emailed link was revoked), 'link_expired' (the emailed link's own
-- expiry has passed while the agreement is still open) — both mean "ask the business for a new
-- link" — and 'use_email_link' for every other case, where the emailed link may still work.
-- 'awaiting_countersign': the customer has signed and only the business's own signatories remain.
CREATE OR REPLACE FUNCTION public._client_portal_agreement_state(p_agreement_id uuid, p_my_email_keys text[])
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  _a public.paige_agreements%ROWTYPE;
  _n integer;
  _me public.paige_agreement_signers%ROWTYPE;
  _earlier integer;
  _state text;
  _note text := NULL;
  _deadline timestamptz;
BEGIN
  SELECT * INTO _a FROM public.paige_agreements WHERE id = p_agreement_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*) INTO _n FROM public.paige_agreement_signers
   WHERE agreement_id = _a.id AND signer_role = 'counterparty';
  IF _n = 1 THEN
    SELECT * INTO _me FROM public.paige_agreement_signers
     WHERE agreement_id = _a.id AND signer_role = 'counterparty';
  END IF;

  IF _a.status = 'completed' THEN _state := 'signed';
  ELSIF _a.status = 'declined' OR _me.status = 'declined' THEN _state := 'declined';
  ELSIF _a.status = 'voided' THEN _state := 'withdrawn';
  ELSIF _a.status = 'expired' OR (_a.expires_at IS NOT NULL AND _a.expires_at <= now()) THEN _state := 'expired';
  ELSIF _a.status NOT IN ('sent','viewed','partially_signed') THEN _state := 'unavailable';
  ELSIF _n <> 1 THEN
    _state := 'awaiting_signature'; _note := 'use_email_link';
  ELSIF _me.status = 'signed' THEN
    -- Only the business left: every signer still to sign is the business's own signatory.
    IF EXISTS (SELECT 1 FROM public.paige_agreement_signers
                WHERE agreement_id = _a.id AND status <> 'signed' AND signer_role = 'tenant_signatory')
       AND NOT EXISTS (SELECT 1 FROM public.paige_agreement_signers
                WHERE agreement_id = _a.id AND status <> 'signed' AND signer_role <> 'tenant_signatory') THEN
      _state := 'awaiting_countersign';
    ELSE
      _state := 'awaiting_others';
    END IF;
  ELSE
    -- Same rule as sign-agreement's out-of-turn check: an earlier-order signer still to sign.
    SELECT count(*) INTO _earlier FROM public.paige_agreement_signers
     WHERE agreement_id = _a.id AND signing_order < _me.signing_order AND status <> 'signed';
    IF _earlier > 0 THEN _state := 'awaiting_business';
    ELSIF (public.contact_method_match_key('email', _me.email) = ANY (coalesce(p_my_email_keys, '{}'::text[]))) IS NOT TRUE THEN
      -- The one signer is at an address that is not this customer's: waiting on a signature, but not
      -- provably theirs.
      _state := 'awaiting_signature'; _note := 'use_email_link';
    ELSE
      _state := 'awaiting_you';
      _deadline := least(_a.expires_at, _me.token_expires_at);
      IF _deadline IS NULL THEN
        _note := 'use_email_link';
      END IF;
      -- Parity with issue_agreement_signing_link's PA001 refusal: an uploaded document whose frozen
      -- copy did not come from the upload reader is not provably the file the owner uploaded, so no
      -- link is handed to it from here either. The content hash is required by
      -- pa_sent_is_frozen_ck for every sent status; it is re-checked so a signing link is never
      -- issued over an unfrozen document even if that constraint is ever relaxed.
      IF _a.content_sha256 IS NULL
         OR (_a.body_source = 'tenant_upload'
             AND position('/presented-source-' IN coalesce(_a.content_storage_key, '')) = 0) THEN
        _note := 'use_email_link';
      END IF;
      -- The emailed link's own expiry has passed while the agreement is still open: that link is dead,
      -- and no later one is issued here. Ask the business for a new link.
      IF _deadline <= now() THEN
        _note := 'link_expired';
      END IF;
      -- A revoked link on an agreement that is still open. Every revocation the engine writes today
      -- rides a terminal status, so this is defensive; but the portal never undoes a revocation it did
      -- not make, so a revoked signer is not signable here (the writer refuses NOT_SIGNABLE_HERE).
      IF _me.token_revoked_at IS NOT NULL THEN
        _note := 'link_revoked';
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'state', _state,
    'signer_id', CASE WHEN _n = 1 THEN _me.id END,
    'can_sign', (_state = 'awaiting_you' AND _note IS NULL),
    'sign_note', _note,
    'deadline', _deadline);
END;
$$;
REVOKE ALL ON FUNCTION public._client_portal_agreement_state(uuid, text[]) FROM PUBLIC, anon, authenticated;

-- The caller's own email match keys: the login's CONFIRMED email (an unconfirmed address proves
-- nothing about who holds it) and the client record's primary email. Internal, like the state.
CREATE OR REPLACE FUNCTION public._client_portal_my_email_keys(p_uid uuid, p_client_id uuid)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(array_agg(DISTINCT k) FILTER (WHERE k IS NOT NULL AND k <> ''), '{}'::text[])
    FROM (
      SELECT public.contact_method_match_key('email', u.email) AS k
        FROM auth.users u WHERE u.id = p_uid AND u.email_confirmed_at IS NOT NULL
      UNION ALL
      SELECT public.contact_method_match_key('email', public.client_primary_address(p_client_id, 'email'))
    ) keys
$$;
REVOKE ALL ON FUNCTION public._client_portal_my_email_keys(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── A1a: the customer's agreements ──────────────────────────────────────────────────────────────
-- Returns NULL for anyone who is not a customer of exactly one business (staff, an unlinked login,
-- a foreign p_tenant_id). Never returned: body, document path, storage keys, hashes, token data,
-- any signer's name or email, offer, amounts, creator, events.
CREATE OR REPLACE FUNCTION public.client_portal_agreements(p_tenant_id uuid DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _business text;
  _limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  _rows jsonb;
  _total integer;
  _summary jsonb;
  _keys text[];
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN NULL; END IF;
  -- LOCK SCOPE (the same in both reads): the customer's own client row only, like Progress — never
  -- the business's tenants row on every page load. The one writer also share-locks the tenant.
  SELECT c.tenant_id, t.name INTO _tenant, _business
    FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
   WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
     AND c.merged_into_contact_id IS NULL AND t.status = 'active'
   FOR SHARE OF c;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _keys := public._client_portal_my_email_keys(_uid, _client_id);

  -- "Sign by" is the date that actually binds: for a row waiting on THIS customer, the earlier of the
  -- agreement's deadline and the emailed link's own expiry (the state's 'deadline'). Every other row
  -- carries the agreement's own expires_at.
  WITH mine AS (
    SELECT a.id, a.title, a.commercial_terms_id, a.status, a.sent_at, a.completed_at,
           a.sealed_storage_key, st.st,
           CASE WHEN st.st->>'state' = 'awaiting_you'
                THEN coalesce((st.st->>'deadline')::timestamptz, a.expires_at)
                ELSE a.expires_at END AS expires_at
      FROM public.paige_agreements a
      CROSS JOIN LATERAL (SELECT public._client_portal_agreement_state(a.id, _keys) AS st) st
     WHERE a.tenant_id = _tenant AND a.contact_id = _client_id AND a.status <> 'draft'
  ), shaped AS (
    SELECT m.*,
           (m.st->>'state' = 'awaiting_you') AS waiting,
           jsonb_build_object(
             'id', m.id,
             'title', left(m.title, 200),
             'engagement_title', (SELECT left(tca.title, 200) FROM public.tenant_client_agreements tca
                                   WHERE tca.id = m.commercial_terms_id AND tca.tenant_id = _tenant
                                     AND tca.contact_id = _client_id),
             'state', m.st->>'state',
             'sent_at', m.sent_at,
             'completed_at', m.completed_at,
             'expires_at', m.expires_at,
             'can_sign', (m.st->>'can_sign')::boolean,
             'can_download', (m.status = 'completed' AND m.sealed_storage_key IS NOT NULL),
             'sign_note', m.st->>'sign_note') AS item
      FROM mine m
  ), ordered AS (
    SELECT s.item, row_number() OVER (ORDER BY
             s.waiting DESC,
             CASE WHEN s.waiting THEN s.expires_at END ASC NULLS LAST,
             coalesce(s.completed_at, s.sent_at) DESC NULLS LAST,
             s.id) AS rn,
           count(*) OVER () AS total
      FROM shaped s
  )
  SELECT coalesce(jsonb_agg(o.item ORDER BY o.rn) FILTER (WHERE o.rn <= _limit), '[]'::jsonb),
         coalesce(max(o.total), 0)
    INTO _rows, _total
    FROM ordered o;

  SELECT jsonb_build_object(
           'awaiting_you', count(*) FILTER (WHERE public._client_portal_agreement_state(a.id, _keys)->>'state' = 'awaiting_you'),
           'signed', count(*) FILTER (WHERE a.status = 'completed'))
    INTO _summary
    FROM public.paige_agreements a
   WHERE a.tenant_id = _tenant AND a.contact_id = _client_id AND a.status <> 'draft';

  RETURN jsonb_build_object('tenant_id', _tenant, 'business_name', _business, 'server_now', now(),
    'summary', _summary, 'agreements', _rows, 'has_more', _total > _limit);
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_agreements(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_agreements(uuid, integer) TO authenticated, service_role;

-- ── A1b: open one of your agreements to sign (mints the /sign/:token link) ──────────────────────
-- Codes: CLIENT_AGREEMENT_UNAVAILABLE (not yours, not found, draft, or no relationship — one code so
-- a stranger learns nothing about which agreements exist), NOT_SIGNABLE (with the derived state:
-- signed, declined, withdrawn, expired, waiting on the business or on others), NOT_SIGNABLE_HERE
-- with a 'note' saying why: 'link_revoked' (the signer link was revoked while the agreement is still
-- open) or 'link_expired' (the emailed link's own expiry has passed) — ask the business for a new
-- link — or 'use_email_link' (no single counterparty, a signer row that is not this login's own
-- email, no deadline to give the link, or a document this path will not hand a link to),
-- TRY_AGAIN_LATER (more than 10 opens of this agreement by this customer in an hour).
--
-- LOCK ORDER is signer rows FOR UPDATE, then the agreement FOR KEY SHARE — the same order
-- decline_agreement_signing writes in (signer, then agreement, then every signer), and a lock on the
-- agreement that never blocks the owner's void or the engine's status moves, so neither can
-- deadlock against a customer pressing "Review and sign". Eligibility is re-derived AFTER the
-- signer lock, on a fresh statement snapshot: a sign, decline or completion that committed first is
-- seen and refused, and one that commits later waits for this row and then revokes or re-mints it.
CREATE OR REPLACE FUNCTION public.client_portal_open_agreement_signing(p_agreement_id uuid, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _a public.paige_agreements%ROWTYPE;
  _st jsonb;
  _signer uuid;
  _locked integer;
  _token text;
  _expires timestamptz;
  _emailed_expiry timestamptz;
  _revoked_at timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_AGREEMENT_UNAVAILABLE'); END IF;
  -- The writer, like the Messages writer, share-locks the client AND the business, so neither the
  -- relationship nor the business can be switched off between this check and the token write.
  SELECT c.tenant_id INTO _tenant
    FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
   WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
     AND c.merged_into_contact_id IS NULL AND t.status = 'active'
   FOR SHARE OF c, t;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_AGREEMENT_UNAVAILABLE'); END IF;

  -- Scope first, unlocked: this customer's own, sent agreement in this business, or the one refusal.
  PERFORM 1 FROM public.paige_agreements a
   WHERE a.id = p_agreement_id AND a.tenant_id = _tenant AND a.contact_id = _client_id AND a.status <> 'draft';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_AGREEMENT_UNAVAILABLE'); END IF;

  -- Every counterparty row of this agreement, locked, so the "exactly one" read below cannot race.
  SELECT count(*) INTO _locked FROM (
    SELECT s.id FROM public.paige_agreement_signers s
     WHERE s.agreement_id = p_agreement_id AND s.signer_role = 'counterparty'
     ORDER BY s.id FOR UPDATE) l;

  SELECT * INTO _a FROM public.paige_agreements a
   WHERE a.id = p_agreement_id AND a.tenant_id = _tenant AND a.contact_id = _client_id
   FOR KEY SHARE;
  IF NOT FOUND OR _a.status = 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_AGREEMENT_UNAVAILABLE');
  END IF;

  _st := public._client_portal_agreement_state(_a.id, public._client_portal_my_email_keys(_uid, _client_id));
  -- Waiting on a signature the portal cannot prove is this customer's: the same "not here" answer the
  -- list gives, with the same note.
  IF _st->>'state' = 'awaiting_signature' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE_HERE', 'note', coalesce(_st->>'sign_note', 'use_email_link'));
  END IF;
  IF _st->>'state' <> 'awaiting_you' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE', 'state', _st->>'state');
  END IF;
  IF (_st->>'can_sign')::boolean IS NOT TRUE OR _locked <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE_HERE', 'note', coalesce(_st->>'sign_note', 'use_email_link'));
  END IF;
  _signer := (_st->>'signer_id')::uuid;

  -- target_type leads so the count rides idx_audit_target (target_type, target_id, created_at DESC).
  IF (SELECT count(*) FROM public.paige_audit_log l
       WHERE l.target_type = 'paige_agreement' AND l.target_id = _a.id
         AND l.action = 'agreement.portal_link_issued'
         AND l.actor_user_id = _uid AND l.created_at > now() - interval '1 hour') >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TRY_AGAIN_LATER');
  END IF;

  -- The deadline: the EARLIER of the agreement's and the emailed link's (read from the signer row
  -- this transaction holds locked), never later than either, never invented. And a revoked link is
  -- refused here too, on the locked row: the portal never mints over a revocation. The state above
  -- already refused this case; it is re-checked on the locked row so no link outlives the one the
  -- business sent even if the two ever drift.
  SELECT s.token_expires_at, s.token_revoked_at INTO _emailed_expiry, _revoked_at
    FROM public.paige_agreement_signers s WHERE s.id = _signer;
  _expires := least(_a.expires_at, _emailed_expiry);
  IF _revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE_HERE', 'note', 'link_revoked');
  END IF;
  IF _expires IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE_HERE', 'note', 'use_email_link');
  END IF;
  IF _expires <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE_HERE', 'note', 'link_expired');
  END IF;

  -- 256 bits from pgcrypto's CSPRNG; only the digest is stored. pgcrypto is schema-qualified: it
  -- lives in `extensions`, which this function's pinned search_path deliberately does not include.
  _token := encode(extensions.gen_random_bytes(32), 'hex');

  UPDATE public.paige_agreement_signers
     SET token_hash = encode(extensions.digest(_token, 'sha256'), 'hex'),
         token_expires_at = _expires,
         updated_at = now()
   WHERE id = _signer AND agreement_id = _a.id AND status IN ('pending','viewed')
     AND token_revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE_HERE', 'note', 'use_email_link'); END IF;

  INSERT INTO public.paige_audit_log (actor_user_id, actor_role, action, target_type, target_id, tenant_id, payload)
  VALUES (_uid, 'client', 'agreement.portal_link_issued', 'paige_agreement', _a.id, _tenant,
          jsonb_build_object('signer_id', _signer));

  RETURN jsonb_build_object('ok', true, 'token', _token, 'expires_at', _expires);
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_open_agreement_signing(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_open_agreement_signing(uuid, uuid) TO authenticated, service_role;

-- ── A1c: may this customer download this signed copy? ───────────────────────────────────────────
-- The agreement-document edge door calls this with the CALLER'S client, then reads the sealed key
-- itself with the service role. No storage key ever reaches a browser from here.
CREATE OR REPLACE FUNCTION public.client_portal_agreement_document_scope(p_agreement_id uuid, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _out jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NOT NULL THEN
    SELECT c.tenant_id INTO _tenant
      FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
     WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
       AND c.merged_into_contact_id IS NULL AND t.status = 'active'
     FOR SHARE OF c;
  END IF;
  IF _tenant IS NOT NULL THEN
    SELECT jsonb_build_object('agreement_id', a.id, 'tenant_id', a.tenant_id, 'title', left(a.title, 200))
      INTO _out
      FROM public.paige_agreements a
     WHERE a.id = p_agreement_id AND a.tenant_id = _tenant AND a.contact_id = _client_id
       AND a.status = 'completed' AND a.sealed_storage_key IS NOT NULL;
  END IF;
  IF _out IS NULL THEN
    RAISE EXCEPTION 'CLIENT_AGREEMENT_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  RETURN _out;
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_agreement_document_scope(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_agreement_document_scope(uuid, uuid) TO authenticated, service_role;

COMMIT;
