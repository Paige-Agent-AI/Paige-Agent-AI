-- E09 Slice A: a customer lists, opens-to-sign and downloads the Sales Agreements a business sent
-- them, from their portal, on the ONE existing agreements engine (paige_agreements + signers). No
-- new table, column, policy, trigger, event type, bucket or email.
--
-- WHY DEFINER FUNCTIONS AND NOT A POLICY. pa_tenant_isolation (20270401000000:622-632) is a
-- RESTRICTIVE gate that gives a portal client NOTHING, and its comment asks that any widening be a
-- deliberate, reviewed act. These three functions are that act, kept narrow: each re-proves the
-- caller's ONE relationship (client_portal_relationship_id + the Slice 1 lock) and returns or
-- touches only agreements whose contact_id IS that relationship and on which the customer is a
-- counterparty signer (VISIBILITY, integrator default 2026-10-18, see the state helper). The RLS
-- gate is not relaxed.
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
--      Where NO link was ever emailed, a single signer at the login's own confirmed email may still
--      sign here, on a link that lasts until the earlier of the agreement's deadline and 24 hours
--      from the open (integrator default 2026-10-18, which the owner may overrule).
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
-- WHO THE SIGNATURE IS, decided FIRST, before any "signed" or "waiting" branch, so no sentence the
-- page draws can credit this customer with someone else's signature or promise them a turn that is
-- not theirs. 'counterparty' says it:
--   'you'   exactly one counterparty signer, and that row's email IS one of this login's own
--           addresses (the login's confirmed email or the client record's primary email), compared by
--           the one email match key (contact_method_match_key: trimmed, lowercase); or, with several
--           counterparties (D-A3), every row at one of those addresses has already signed — the
--           signature at this customer's address is done, so "You've signed" is true (round 6, W3);
--   'other' a counterparty signer exists but is not provably this customer — a co-signer still to
--           sign (several counterparty rows, D-A3) or one signer at another address;
--   'none'  no counterparty signer at all: only the business's own signatories (or witnesses).
-- VISIBILITY (integrator default, 2026-10-18, which the owner may overrule): the list, the open and
-- the download scope only ever reach an agreement on which this customer IS a counterparty signer —
-- a counterparty row at one of the addresses above (_client_portal_agreement_is_mine). An agreement
-- with no counterparty, or whose counterparties are all at other addresses, is not this customer's
-- to see: it is not listed, not opened and not downloaded, because its sealed copy names someone
-- else. So 'none', and 'other' for a single signer, are never shown; the helper still derives them.
-- The sealed certificate credits the signature to the person and address named on the signer row,
-- and the portal files no agreement event, so the portal hands out a link only when 'counterparty'
-- is 'you'. Anything else waiting on a counterparty is 'awaiting_signature': neither counted nor
-- headed as theirs. p_my_email_keys and p_login_email_key are derived by the two DEFINER callers
-- from auth.uid() and the re-proved relationship — never from a caller argument.
--
-- No counterparty, or every counterparty has signed: what is left is the business's (and any
-- witness's), so the row is 'awaiting_countersign' when every signer still to sign is the business's
-- own signatory, else 'awaiting_others' — never a sign note, because nothing waits on this customer.
--
-- WAS A LINK EVER EMAILED to the signer? 'link_emailed' is true when the engine recorded sending
-- it (a 'sent' or 'resent' paige_agreement_events row for that signer — both owner paths write one),
-- or when the signer holds a token the portal did not issue (no 'agreement.portal_link_issued' audit
-- row for that signer). A token the portal minted is never evidence of an email.
--
-- THE LINK THE PORTAL HANDS OUT, and how long it lasts:
--   * Emailed: the EARLIER of the agreement's deadline and the emailed link's own expiry, returned as
--     'deadline' (the list's "Sign by"). With neither, or with that moment past, not signable here.
--   * NEVER EMAILED (integrator default, 2026-10-18, which the owner may overrule): a single signer
--     at this login's own CONFIRMED email — not merely the client record's primary email, which the
--     business typed and the login never proved — may sign through the portal. The writer's link
--     then lasts until the EARLIER of the agreement's deadline and now() + 24 hours (with no agreement
--     deadline, now() + 24 hours), so a portal session never yields a long-lived link nobody emailed.
--     'deadline' is the agreement's own (the date that binds the signature, not the link).
--
-- sign_note says WHY an 'awaiting_you' or 'awaiting_signature' row is not signable here, so the page
-- never points at a link that is dead or never existed: 'link_revoked' and 'link_expired' (the
-- emailed link is dead — ask for a new one), 'use_email_link' (a link was emailed and may still
-- work), 'no_link_sent' (no link was ever emailed for it — ask for one).
-- An earlier draft of this migration had a two-argument state helper; a database that applied that
-- draft (a local or preview stack) would otherwise keep it as a stray overload. Production never had it.
DROP FUNCTION IF EXISTS public._client_portal_agreement_state(uuid, text[]);
CREATE OR REPLACE FUNCTION public._client_portal_agreement_state(p_agreement_id uuid, p_my_email_keys text[], p_login_email_key text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  _a public.paige_agreements%ROWTYPE;
  _n integer;
  _me public.paige_agreement_signers%ROWTYPE;
  _counterparty text;
  _all_signed boolean;
  _emailed boolean;
  _earlier integer;
  _earlier_not_business integer;
  _mine integer;
  _mine_open integer;
  _state text;
  _note text := NULL;
  _deadline timestamptz;
BEGIN
  SELECT * INTO _a FROM public.paige_agreements WHERE id = p_agreement_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*), coalesce(bool_and(status = 'signed'), true),
         count(*) FILTER (WHERE (public.contact_method_match_key('email', email) = ANY (coalesce(p_my_email_keys, '{}'::text[]))) IS TRUE),
         count(*) FILTER (WHERE status <> 'signed'
                            AND (public.contact_method_match_key('email', email) = ANY (coalesce(p_my_email_keys, '{}'::text[]))) IS TRUE)
    INTO _n, _all_signed, _mine, _mine_open
    FROM public.paige_agreement_signers
   WHERE agreement_id = _a.id AND signer_role = 'counterparty';
  IF _n = 1 THEN
    SELECT * INTO _me FROM public.paige_agreement_signers
     WHERE agreement_id = _a.id AND signer_role = 'counterparty';
  END IF;

  -- Whose signature, before anything else.
  _counterparty := CASE
    WHEN _n = 0 THEN 'none'
    WHEN _n = 1 AND (public.contact_method_match_key('email', _me.email) = ANY (coalesce(p_my_email_keys, '{}'::text[]))) IS TRUE THEN 'you'
    WHEN _n > 1 AND _mine > 0 AND _mine_open = 0 THEN 'you'
    ELSE 'other' END;

  -- Any counterparty's link emailed (for one signer, that signer's).
  _emailed := EXISTS (
    SELECT 1 FROM public.paige_agreement_signers s
     WHERE s.agreement_id = _a.id AND s.signer_role = 'counterparty'
       AND (EXISTS (SELECT 1 FROM public.paige_agreement_events e
                     WHERE e.agreement_id = _a.id AND e.signer_id = s.id AND e.event_type IN ('sent','resent'))
            OR (s.token_hash IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.paige_audit_log l
                                 WHERE l.target_type = 'paige_agreement' AND l.target_id = _a.id
                                   AND l.action = 'agreement.portal_link_issued'
                                   AND l.payload->>'signer_id' = s.id::text))));

  IF _a.status = 'completed' THEN _state := 'signed';
  ELSIF _a.status = 'declined' OR _me.status = 'declined' THEN _state := 'declined';
  ELSIF _a.status = 'voided' THEN _state := 'withdrawn';
  ELSIF _a.status = 'expired' OR (_a.expires_at IS NOT NULL AND _a.expires_at <= now()) THEN _state := 'expired';
  ELSIF _a.status NOT IN ('sent','viewed','partially_signed') THEN _state := 'unavailable';
  ELSIF _all_signed THEN
    -- No counterparty, or every counterparty has signed: only the business (and any witness) is left.
    IF EXISTS (SELECT 1 FROM public.paige_agreement_signers
                WHERE agreement_id = _a.id AND status <> 'signed' AND signer_role = 'tenant_signatory')
       AND NOT EXISTS (SELECT 1 FROM public.paige_agreement_signers
                WHERE agreement_id = _a.id AND status <> 'signed' AND signer_role <> 'tenant_signatory') THEN
      _state := 'awaiting_countersign';
    ELSE
      _state := 'awaiting_others';
    END IF;
  ELSIF _n <> 1 AND _counterparty = 'you' THEN
    -- Co-signers, and every one at this customer's address has signed: nothing is asked of them, only
    -- the other signers are left (round 6, W3) — never "use the link" to someone who has signed.
    _state := 'awaiting_others';
  ELSIF _n <> 1 THEN
    -- Co-signers, not all signed: the portal cannot tell which row is this login (D-A3).
    _state := 'awaiting_signature';
    _note := CASE WHEN _emailed THEN 'use_email_link' ELSE 'no_link_sent' END;
  ELSE
    -- Same rule as sign-agreement's out-of-turn check: an earlier-order signer still to sign. Only
    -- when every one of them is the business's own signatory is it "{Business} signs first"; a
    -- witness (or anyone else) ordered first is 'awaiting_earlier_signer' ("Someone else signs
    -- first"), never credited to the business (round 6, W1).
    SELECT count(*), count(*) FILTER (WHERE signer_role <> 'tenant_signatory') INTO _earlier, _earlier_not_business
      FROM public.paige_agreement_signers
     WHERE agreement_id = _a.id AND signing_order < _me.signing_order AND status <> 'signed';
    IF _earlier > 0 AND _earlier_not_business = 0 THEN _state := 'awaiting_business';
    ELSIF _earlier > 0 THEN _state := 'awaiting_earlier_signer';
    ELSIF _counterparty <> 'you' THEN
      -- The one signer is at an address that is not this customer's: waiting on a signature, but not
      -- provably theirs.
      _state := 'awaiting_signature';
      _note := CASE WHEN _emailed THEN 'use_email_link' ELSE 'no_link_sent' END;
    ELSE
      _state := 'awaiting_you';
      IF _emailed THEN
        _deadline := least(_a.expires_at, _me.token_expires_at);
        IF _deadline IS NULL THEN _note := 'use_email_link'; END IF;
      ELSE
        _deadline := _a.expires_at;
        -- Never emailed: only the login's own CONFIRMED email earns a portal link (default above).
        IF p_login_email_key IS NULL OR p_login_email_key = ''
           OR public.contact_method_match_key('email', _me.email) IS DISTINCT FROM p_login_email_key THEN
          _note := 'no_link_sent';
        END IF;
      END IF;
      -- Parity with issue_agreement_signing_link's PA001 refusal: an uploaded document whose frozen
      -- copy did not come from the upload reader is not provably the file the owner uploaded, so no
      -- link is handed to it from here either. The content hash is required by
      -- pa_sent_is_frozen_ck for every sent status; it is re-checked so a signing link is never
      -- issued over an unfrozen document even if that constraint is ever relaxed.
      IF _a.content_sha256 IS NULL
         OR (_a.body_source = 'tenant_upload'
             AND position('/presented-source-' IN coalesce(_a.content_storage_key, '')) = 0) THEN
        _note := CASE WHEN _emailed THEN 'use_email_link' ELSE 'no_link_sent' END;
      END IF;
      -- The emailed link's own expiry has passed while the agreement is still open: that link is dead,
      -- and no later one is issued here. Ask the business for a new link.
      IF _emailed AND _deadline <= now() THEN
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
    'counterparty', _counterparty,
    'link_emailed', _emailed,
    'signer_id', CASE WHEN _n = 1 THEN _me.id END,
    'can_sign', (_state = 'awaiting_you' AND _note IS NULL),
    'sign_note', _note,
    'deadline', _deadline);
END;
$$;
REVOKE ALL ON FUNCTION public._client_portal_agreement_state(uuid, text[], text) FROM PUBLIC, anon, authenticated;

-- The login's CONFIRMED email, as a match key (an unconfirmed address proves nothing about who holds
-- it). NULL when there is none. Internal, like the state.
CREATE OR REPLACE FUNCTION public._client_portal_login_email_key(p_uid uuid)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT nullif(public.contact_method_match_key('email', u.email), '')
    FROM auth.users u WHERE u.id = p_uid AND u.email_confirmed_at IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public._client_portal_login_email_key(uuid) FROM PUBLIC, anon, authenticated;

-- The caller's own email match keys: the login's confirmed email and the client record's primary
-- email. Internal, like the state.
CREATE OR REPLACE FUNCTION public._client_portal_my_email_keys(p_uid uuid, p_client_id uuid)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(array_agg(DISTINCT k) FILTER (WHERE k IS NOT NULL AND k <> ''), '{}'::text[])
    FROM (
      SELECT public._client_portal_login_email_key(p_uid) AS k
      UNION ALL
      SELECT public.contact_method_match_key('email', public.client_primary_address(p_client_id, 'email'))
    ) keys
$$;
REVOKE ALL ON FUNCTION public._client_portal_my_email_keys(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Is this customer a counterparty signer on this agreement? (VISIBILITY, integrator default above.)
-- True only when a counterparty row's email is one of the caller's own match keys. Every reader and
-- the one writer gate on it, so an agreement whose sealed copy names only other people is never
-- listed, opened or downloaded from the portal. Internal, like the state.
CREATE OR REPLACE FUNCTION public._client_portal_agreement_is_mine(p_agreement_id uuid, p_my_email_keys text[])
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.paige_agreement_signers s
     WHERE s.agreement_id = p_agreement_id AND s.signer_role = 'counterparty'
       AND (public.contact_method_match_key('email', s.email) = ANY (coalesce(p_my_email_keys, '{}'::text[]))) IS TRUE)
$$;
REVOKE ALL ON FUNCTION public._client_portal_agreement_is_mine(uuid, text[]) FROM PUBLIC, anon, authenticated;

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
  _login_key text;
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
  _login_key := public._client_portal_login_email_key(_uid);

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
      CROSS JOIN LATERAL (SELECT public._client_portal_agreement_state(a.id, _keys, _login_key) AS st) st
     WHERE a.tenant_id = _tenant AND a.contact_id = _client_id AND a.status <> 'draft'
       AND public._client_portal_agreement_is_mine(a.id, _keys)
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
             'sign_note', m.st->>'sign_note',
             'counterparty', m.st->>'counterparty',
             'link_emailed', (m.st->>'link_emailed')::boolean) AS item
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
           'awaiting_you', count(*) FILTER (WHERE public._client_portal_agreement_state(a.id, _keys, _login_key)->>'state' = 'awaiting_you'),
           'signed', count(*) FILTER (WHERE a.status = 'completed'))
    INTO _summary
    FROM public.paige_agreements a
   WHERE a.tenant_id = _tenant AND a.contact_id = _client_id AND a.status <> 'draft'
     AND public._client_portal_agreement_is_mine(a.id, _keys);

  RETURN jsonb_build_object('tenant_id', _tenant, 'business_name', _business, 'server_now', now(),
    'summary', _summary, 'agreements', _rows, 'has_more', _total > _limit);
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_agreements(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_agreements(uuid, integer) TO authenticated, service_role;

-- ── A1b: open one of your agreements to sign (mints the /sign/:token link) ──────────────────────
-- Codes: CLIENT_AGREEMENT_UNAVAILABLE (not yours, not one you are a counterparty signer on, not found,
-- draft, or no relationship — one code so a stranger learns nothing about which agreements exist),
-- NOT_SIGNABLE (with the derived state: signed, declined, withdrawn, expired, waiting on the business,
-- on an earlier signer or on others), NOT_SIGNABLE_HERE
-- with a 'note' saying why: 'link_revoked' (the signer link was revoked while the agreement is still
-- open) or 'link_expired' (the emailed link's own expiry has passed) — ask the business for a new
-- link — 'use_email_link' (a link was emailed, and: several counterparties, a signer row that is
-- not this login's own email, no deadline to give the link, or a document this path will not hand
-- a link to), or 'no_link_sent' (the same cases where no link was ever emailed, or a never-emailed
-- signer matched only by the client record's primary email, not the login's confirmed one),
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
  _keys text[];
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

  -- Scope first, unlocked: this customer's own, sent agreement in this business, on which they are a
  -- counterparty signer (VISIBILITY), or the one refusal — an agreement the list does not show is
  -- not opened either.
  _keys := public._client_portal_my_email_keys(_uid, _client_id);
  PERFORM 1 FROM public.paige_agreements a
   WHERE a.id = p_agreement_id AND a.tenant_id = _tenant AND a.contact_id = _client_id AND a.status <> 'draft'
     AND public._client_portal_agreement_is_mine(a.id, _keys);
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

  _st := public._client_portal_agreement_state(_a.id, _keys, public._client_portal_login_email_key(_uid));
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

  -- The deadline. When a link was emailed: the EARLIER of the agreement's and the emailed link's
  -- (read from the signer row this transaction holds locked), never later than either, never
  -- invented — so no link outlives the one the business sent. When none was ever emailed (the
  -- integrator default the owner may overrule, see the state helper): the EARLIER of the agreement's
  -- deadline and now() + 24 hours, so the portal never yields a long-lived link nobody emailed. A
  -- revoked link is refused here too, on the locked row: the portal never mints over a revocation.
  -- The state above already refused these cases; they are re-checked on the locked row even if the
  -- two ever drift.
  SELECT s.token_expires_at, s.token_revoked_at INTO _emailed_expiry, _revoked_at
    FROM public.paige_agreement_signers s WHERE s.id = _signer;
  IF (_st->>'link_emailed')::boolean IS NOT FALSE THEN
    _expires := least(_a.expires_at, _emailed_expiry);
  ELSE
    _expires := least(_a.expires_at, now() + interval '24 hours');
  END IF;
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
       AND a.status = 'completed' AND a.sealed_storage_key IS NOT NULL
       -- VISIBILITY: only a copy on which this customer is a counterparty signer (the sealed
       -- certificate names its signers; one that names only other people is not theirs).
       AND public._client_portal_agreement_is_mine(a.id, public._client_portal_my_email_keys(_uid, _client_id));
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
