-- pgcrypto lives in schema `extensions`, not `public`. Four SECURITY DEFINER functions pin a
-- search_path that does not include `extensions` and call pgcrypto unqualified, so on production
-- every call errors with `function digest(text, unknown) does not exist`:
--
--   peek_agreement_signing(text)                     search_path=public, pg_temp  digest
--   issue_agreement_signing_link(uuid,uuid,integer)  search_path=public, pg_temp  digest, gen_random_bytes
--   decline_agreement_signing(text,text)             search_path=public, pg_temp  digest
--   accept_invitation(text,uuid)                     search_path=public           digest
--
-- The first three are the whole signer side of agreements: `/sign/:token` cannot open any link, an
-- owner cannot issue one, and a signer cannot decline. accept_invitation has no caller today
-- (supabase/tests/title_role_grant_paths_closed.sql says so and stands in a public.digest to test
-- it); it is restated because it is the same defect and the catalog proof below refuses the class.
--
-- Found by a read-only production query (pg_proc, 2026-10-18): every public function whose
-- comment-stripped body calls a pgcrypto function without a schema, under a pinned search_path that
-- lacks `extensions`. These four were the only ones. platform_encrypt/platform_decrypt also call
-- pgcrypto unqualified but pin `public, extensions` and work.
--
-- THE FIX IS QUALIFICATION, NOT A WIDER search_path. Each body below is the CURRENT production
-- body byte-for-byte with only `digest(` / `gen_random_bytes(` rewritten to `extensions.digest(` /
-- `extensions.gen_random_bytes(` (comments untouched). Owner, SECURITY DEFINER, volatility, return
-- type and search_path are unchanged; the existing grants are re-issued exactly.
--
-- LEASED: if any body on the target differs from the one this was written against, nothing is
-- written (42501). Proof: supabase/tests/pgcrypto_search_path_signing.sql.
--
-- definer-anon-exempt: peek_agreement_signing and decline_agreement_signing were already granted to
-- anon (20270404000000 / 20270407000000) and are re-granted unchanged — the signer has no account,
-- the 256-bit token is the credential, and the body looks up by its digest. No grant is widened.
BEGIN;

DO $lease$
BEGIN
  IF (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE e.extname = 'pgcrypto') IS DISTINCT FROM 'extensions' THEN
    RAISE EXCEPTION 'pgcrypto is not installed in schema extensions; the qualified calls would not resolve'
      USING ERRCODE = '42501';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.peek_agreement_signing(text)'::regprocedure)
     IS DISTINCT FROM '95e4eb42dd703e561e822ec367b00cc8' THEN
    RAISE EXCEPTION 'public.peek_agreement_signing(text) changed since this fix was written; nothing was written'
      USING ERRCODE = '42501';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.issue_agreement_signing_link(uuid,uuid,integer)'::regprocedure)
     IS DISTINCT FROM '5af1e73dc5a344fcd89a772abf87b3c1' THEN
    RAISE EXCEPTION 'public.issue_agreement_signing_link(uuid,uuid,integer) changed since this fix was written; nothing was written'
      USING ERRCODE = '42501';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.decline_agreement_signing(text,text)'::regprocedure)
     IS DISTINCT FROM '46627c7cf4a5abc31bdbe483ef1f939e' THEN
    RAISE EXCEPTION 'public.decline_agreement_signing(text,text) changed since this fix was written; nothing was written'
      USING ERRCODE = '42501';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.accept_invitation(text,uuid)'::regprocedure)
     IS DISTINCT FROM 'f1e6791759f9a84a88d183e0b8606aa5' THEN
    RAISE EXCEPTION 'public.accept_invitation(text,uuid) changed since this fix was written; nothing was written'
      USING ERRCODE = '42501';
  END IF;
END
$lease$;

-- peek_agreement_signing: L18 of the body qualified.
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

  IF _a.commercial_terms_id IS NOT NULL THEN
    SELECT tca.agreed_amount_minor, tca.agreed_currency, tca.term_kind
      INTO _amount_minor, _amount_currency, _term_summary
      FROM public.tenant_client_agreements tca
     WHERE tca.id = _a.commercial_terms_id AND tca.tenant_id = _a.tenant_id;
  END IF;

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

-- issue_agreement_signing_link: L92; L96; L100 of the body qualified.
CREATE OR REPLACE FUNCTION public.issue_agreement_signing_link(_expected_tenant_id uuid, _signing_id uuid, _ttl_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _token text;
  _expires timestamptz;
  _signer uuid;
  _status text;
  _src text;
  _body text;
  _frozen text;
  _key text;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;
  IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could run; nothing was written'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_tenant_admin(_tenant) THEN
    RAISE EXCEPTION 'only an owner or admin may issue a signing link' USING ERRCODE = '42501';
  END IF;
  IF _ttl_days IS NULL OR _ttl_days < 1 OR _ttl_days > 365 THEN
    RAISE EXCEPTION 'a signing link lasts between 1 and 365 days' USING ERRCODE = '23514';
  END IF;

  SELECT status, body_source, body_markdown, content_sha256, content_storage_key
    INTO _status, _src, _body, _frozen, _key
    FROM public.paige_agreements
   WHERE id = _signing_id AND tenant_id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that agreement is not in this workspace' USING ERRCODE = '42501';
  END IF;
  IF _status IN ('completed','declined','voided','expired') THEN
    RAISE EXCEPTION 'this agreement is already %; a new link cannot be issued for it', _status
      USING ERRCODE = '23514';
  END IF;

  -- ── THE NEW REFUSAL ─────────────────────────────────────────────────────────────────────────
  -- Read it as: this row says its body is an uploaded file, something has already frozen a document
  -- for it, and that frozen document did not come from the code that knows how to read an uploaded
  -- file. Whatever is on file, it is not provably the thing the owner uploaded, so nobody is going
  -- to be sent a link to it. A NULL key fails the same way and for the same reason — an unlocatable
  -- frozen document is not evidence of anything.
  --
  -- THE MESSAGE DOES NOT NAME A CAUSE, and that is deliberate. The obvious sentence — "this was
  -- prepared before a defect was fixed" — is false for a row that can be built entirely AFTER the
  -- fix: a text agreement whose send froze `presented-<uuid>.pdf` and then failed every delivery
  -- stays a draft (`agreement-send/index.ts:428`), and a draft's `body_source` is still editable
  -- (`enforce_agreement_seal_immutable`, 20270401000000:544), so switching it to an upload lands
  -- exactly here. Refusing it is right — the frozen bytes are a render of the discarded text, not
  -- the new file — but blaming a historical defect for it would be a guess presented as a fact.
  -- What the predicate actually establishes is the stored document's provenance, so that is all
  -- the sentence claims.
  --
  -- This sits ahead of the signer check on purpose. A missing signer is a step on the way to
  -- sending; this is a dead end. Telling an owner to add a signer to an agreement that can never be
  -- sent walks them further down a path that ends here anyway.
  IF _src = 'tenant_upload' AND _frozen IS NOT NULL
     AND position('/presented-source-' IN coalesce(_key, '')) = 0 THEN
    -- 'PA001' rather than the 23514 every other refusal here raises, and the reason is the whole
    -- point of the refusal. The surface maps a SQLSTATE to public copy and deliberately never
    -- echoes a database message (`useSoloAgreementSignings.ts:252`), so on 23514 an owner would be
    -- shown "Check the client, the document and the wording, then try again." — an instruction to
    -- retry something that can never succeed, because the content columns are write-once
    -- (`enforce_agreement_seal_immutable`, 20270401000000:522). A refusal that sends a person round
    -- a loop forever is a worse outcome than the defect it replaces. A distinct code lets the
    -- surface say the one true thing instead, without weakening that no-echo rule. The only
    -- property relied on is that PostgREST reports the raised SQLSTATE as the error's `code`.
    RAISE EXCEPTION 'the document stored for this agreement is not the file that was uploaded'
      USING ERRCODE = 'PA001';
  END IF;

  SELECT id INTO _signer FROM public.paige_agreement_signers
   WHERE agreement_id = _signing_id ORDER BY signing_order LIMIT 1;
  IF _signer IS NULL THEN
    RAISE EXCEPTION 'add a signer before issuing a link' USING ERRCODE = '23514';
  END IF;

  -- FREEZE BEFORE THE LINK EXISTS. The moment a token is issued somebody can be shown the document,
  -- so the digest of what they will be shown is recorded first. For a text body that is the body
  -- itself, which is exactly what the page renders. An uploaded FILE cannot be hashed from here —
  -- the database cannot read storage — so that path refuses and goes through the send function,
  -- which can read the object and hash its real bytes. Refusing is the point: a link issued against
  -- an unhashed document would make "the signer saw exactly this" unprovable from the first minute.
  IF _frozen IS NULL THEN
    IF _src = 'tenant_upload' THEN
      RAISE EXCEPTION 'an uploaded document is frozen when it is sent; use the send path so its real bytes are hashed'
        USING ERRCODE = '23514';
    END IF;
    _frozen := encode(extensions.digest(coalesce(_body,''), 'sha256'), 'hex');
  END IF;

  -- gen_random_bytes(32) is 256 bits from pgcrypto's CSPRNG. Only the digest is stored.
  _token := encode(extensions.gen_random_bytes(32), 'hex');
  _expires := now() + make_interval(days => _ttl_days);

  UPDATE public.paige_agreement_signers
     SET token_hash = encode(extensions.digest(_token, 'sha256'), 'hex'),
         token_expires_at = _expires,
         token_revoked_at = NULL,
         updated_at = now()
   WHERE id = _signer;

  UPDATE public.paige_agreements
     SET content_sha256 = coalesce(content_sha256, _frozen),
         status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
         sent_at = coalesce(sent_at, now()),
         expires_at = _expires,
         updated_at = now()
   WHERE id = _signing_id AND tenant_id = _tenant;

  INSERT INTO public.paige_agreement_events
    (agreement_id, tenant_id, signer_id, event_type, actor_kind, actor_user_id)
  VALUES (_signing_id, _tenant, _signer, 'sent', 'owner', _actor);

  RETURN jsonb_build_object('signing_id', _signing_id, 'token', _token, 'expires_at', _expires);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_agreement_signing_link(uuid,uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_agreement_signing_link(uuid,uuid,integer) TO authenticated;

-- decline_agreement_signing: L11 of the body qualified.
CREATE OR REPLACE FUNCTION public.decline_agreement_signing(_token text, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _hash text;
  _s record;
  _a record;
  _changed integer := 0;
BEGIN
  IF _token IS NULL OR _token !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  _hash := encode(extensions.digest(_token, 'sha256'), 'hex');

  SELECT * INTO _s FROM public.paige_agreement_signers WHERE token_hash = _hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;

  SELECT * INTO _a FROM public.paige_agreements WHERE id = _s.agreement_id;
  IF _a.id IS NULL
     OR _s.token_revoked_at IS NOT NULL
     OR _s.token_expires_at IS NULL OR _s.token_expires_at <= now()
     OR _a.status NOT IN ('sent','viewed','partially_signed')
  THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  UPDATE public.paige_agreement_signers
     SET status = 'declined', declined_at = now(),
         decline_reason = left(coalesce(_reason,''), 1000), updated_at = now()
   WHERE id = _s.id AND status IN ('pending','viewed');
  GET DIAGNOSTICS _changed = ROW_COUNT;
  IF _changed = 0 THEN RETURN jsonb_build_object('ok', false); END IF;

  -- One decline ends it for everyone and kills every remaining link. Leaving it live would strand
  -- later signers behind somebody who will never sign, while the document still looked open.
  UPDATE public.paige_agreements
     SET status = 'declined', declined_at = now(), updated_at = now()
   WHERE id = _a.id AND status IN ('sent','viewed','partially_signed');

  UPDATE public.paige_agreement_signers
     SET token_revoked_at = now(), updated_at = now()
   WHERE agreement_id = _a.id AND token_hash IS NOT NULL AND token_revoked_at IS NULL;

  INSERT INTO public.paige_agreement_events
    (agreement_id, tenant_id, signer_id, event_type, actor_kind, actor_email, detail)
  VALUES (_a.id, _a.tenant_id, _s.id, 'declined', 'signer', _s.email,
          jsonb_build_object('reason', nullif(btrim(coalesce(_reason,'')), '')));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.decline_agreement_signing(text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_agreement_signing(text,text) TO anon, authenticated;

-- accept_invitation: L17 of the body qualified.
CREATE OR REPLACE FUNCTION public.accept_invitation(_token text, _user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    _invitation record;
    _token_hash text;
    _tenant_role public.tenant_role;
    _caller_email text;
  BEGIN
    -- §9/#117: an invitation may only be redeemed BY the authenticated caller,
    -- FOR themselves, and only when the caller's email matches the invite target.
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
    END IF;
    IF _user_id <> auth.uid() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    _token_hash := encode(extensions.digest(_token, 'sha256'), 'hex');

    SELECT * INTO _invitation
    FROM public.invitations
    WHERE token_hash = _token_hash
      AND accepted_at IS NULL
      AND expires_at > now();

    IF _invitation IS NULL THEN
      RETURN json_build_object('success', false, 'message', 'Invalid or expired invitation');
    END IF;

    -- §9/#117: the caller's verified email must match the invitation's target email.
    SELECT email INTO _caller_email FROM auth.users WHERE id = auth.uid();
    IF _caller_email IS NULL
       OR _invitation.email IS NULL
       OR lower(_caller_email) <> lower(_invitation.email) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- "Coach" is a title a business gives its people, never a role anyone is granted.
    IF _invitation.role = 'coach'::public.app_role THEN
      RAISE EXCEPTION 'this invitation carries a retired role' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, _invitation.role)
    ON CONFLICT (user_id, role) DO NOTHING;

    IF _invitation.tenant_id IS NOT NULL
       AND _invitation.role::text IN ('admin','sales_rep','broker','broker_team_member','cs_rep','finance','viewer','moderator','user','client')
       AND _invitation.role <> 'super_admin'::public.app_role THEN
      _tenant_role := public.map_app_role_to_tenant_role(_invitation.role);

      INSERT INTO public.tenant_members (tenant_id, user_id, role, status, invited_at, joined_at)
      VALUES (_invitation.tenant_id, _user_id, _tenant_role, 'active', _invitation.created_at, now())
      ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET role = CASE
              WHEN public.tenant_members.role = 'owner'::public.tenant_role THEN public.tenant_members.role
              WHEN EXCLUDED.role = 'admin'::public.tenant_role THEN 'admin'::public.tenant_role
              ELSE public.tenant_members.role
            END,
            status = 'active',
            joined_at = COALESCE(public.tenant_members.joined_at, now()),
            updated_at = now();

      UPDATE public.profiles
         SET active_tenant_id = _invitation.tenant_id
       WHERE user_id = _user_id
         AND active_tenant_id IS NULL;
    END IF;

    UPDATE public.invitations
    SET accepted_at = now()
    WHERE id = _invitation.id;

    RETURN json_build_object(
      'success', true,
      'role', _invitation.role,
      'tenant_id', _invitation.tenant_id,
      'message', 'Invitation accepted successfully'
    );
  END;
  $function$;

REVOKE ALL ON FUNCTION public.accept_invitation(text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text,uuid) TO authenticated, service_role;

-- update_profile_ssn(uuid,text,text,date,text) — THE SAME DEFECT, AND IT IS NOT ON PRODUCTION.
-- 20260415000001 creates it (pgp_sym_encrypt unqualified, search_path=public), but production's
-- ledger row for that version is a `git_ledger_reconciliation` stub and the overload does not exist
-- there (read-only check, 2026-10-18). Every database rebuilt from this tree — CI, local — does
-- have it, so the catalog proof would rightly refuse it. Restated only where it exists, leased the
-- same way; CREATE OR REPLACE keeps whatever grants that database gave it, so none is touched.
-- Production is a no-op here. Whether production should HAVE this overload is a separate question.
DO $ssn$
BEGIN
  IF to_regprocedure('public.update_profile_ssn(uuid,text,text,date,text)') IS NULL THEN
    RETURN;
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.update_profile_ssn(uuid,text,text,date,text)'::regprocedure)
     IS DISTINCT FROM '268aa3381050288efa47be68bb18aa6e' THEN
    RAISE EXCEPTION 'public.update_profile_ssn(uuid,text,text,date,text) changed since this fix was written; nothing was written'
      USING ERRCODE = '42501';
  END IF;
  EXECUTE $restate$CREATE OR REPLACE FUNCTION public.update_profile_ssn(_user_id uuid, _ssn_plaintext text, _ssn_last_4 text, _date_of_birth date, _encryption_key text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_encrypted TEXT;
BEGIN
  -- Validate caller is updating their own profile
  IF auth.uid() != _user_id THEN
    RAISE EXCEPTION 'Unauthorized: Can only update own profile';
  END IF;

  -- Validate SSN last 4 format (4 digits)
  IF _ssn_last_4 IS NOT NULL AND _ssn_last_4 !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'Invalid SSN last 4 format. Must be exactly 4 digits.';
  END IF;

  -- Encrypt SSN when provided
  IF _ssn_plaintext IS NOT NULL THEN
    IF _ssn_plaintext !~ '^\d{9}$' THEN
      RAISE EXCEPTION 'Invalid SSN format. Must be 9 digits with no dashes.';
    END IF;

    IF _encryption_key IS NULL OR length(_encryption_key) < 32 THEN
      RAISE EXCEPTION 'Encryption key is required when updating SSN.';
    END IF;

    v_encrypted := encode(
      extensions.pgp_sym_encrypt(_ssn_plaintext, _encryption_key, 'cipher-algo=aes256'),
      'base64'
    );
  END IF;

  -- Validate date of birth
  IF _date_of_birth IS NOT NULL AND _date_of_birth > CURRENT_DATE THEN
    RAISE EXCEPTION 'Date of birth cannot be in the future';
  END IF;

  IF _date_of_birth IS NOT NULL AND _date_of_birth > CURRENT_DATE - INTERVAL '13 years' THEN
    RAISE EXCEPTION 'Must be at least 13 years old';
  END IF;

  -- Update profile; COALESCE preserves existing values for fields not being updated
  UPDATE public.profiles
  SET
    ssn_encrypted  = COALESCE(v_encrypted, ssn_encrypted),
    ssn_last_4     = COALESCE(_ssn_last_4, ssn_last_4),
    date_of_birth  = COALESCE(_date_of_birth, date_of_birth),
    updated_at     = now()
  WHERE user_id = _user_id;

  -- Log PII access
  INSERT INTO public.pii_access_log (
    accessed_user_id,
    accessor_user_id,
    table_name,
    field_names,
    access_type
  ) VALUES (
    _user_id,
    auth.uid(),
    'profiles',
    ARRAY['ssn_encrypted', 'ssn_last_4', 'date_of_birth'],
    'update'
  );
END;
$function$$restate$;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.update_profile_ssn(uuid,text,text,date,text)'::regprocedure)
     IS DISTINCT FROM 'e092e15281a9248dee07daa816cb5897' THEN
    RAISE EXCEPTION 'update_profile_ssn(uuid,text,text,date,text) was not restated as written';
  END IF;
END
$ssn$;

-- Readback: the body is exactly the qualified one, the shape is unchanged, the grants are exact.
DO $readback$
DECLARE
  _f record;
BEGIN
  FOR _f IN SELECT * FROM (VALUES
    ('public.peek_agreement_signing(text)'::regprocedure, '1436a0512f2373ae5f0d84d3552a6aba', ARRAY['anon','authenticated']::text[]),
    ('public.issue_agreement_signing_link(uuid,uuid,integer)'::regprocedure, '10b5f67e2904efa69e579903107821e9', ARRAY['authenticated']::text[]),
    ('public.decline_agreement_signing(text,text)'::regprocedure, '654e4364555e35ee4e0d47601aea0754', ARRAY['anon','authenticated']::text[]),
    ('public.accept_invitation(text,uuid)'::regprocedure, 'e74e81fcaa47c0437b5768f0b775494e', ARRAY['authenticated','service_role']::text[])
  ) v(fn, body_md5, grantees) LOOP
    IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = _f.fn) IS DISTINCT FROM _f.body_md5 THEN
      RAISE EXCEPTION '% was not restated as written', _f.fn;
    END IF;
    IF NOT (SELECT prosecdef AND provolatile = 'v' AND pg_get_userbyid(proowner) = 'postgres'
              FROM pg_proc WHERE oid = _f.fn) THEN
      RAISE EXCEPTION '% lost its definer, volatility or owner', _f.fn;
    END IF;
    IF (SELECT array_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END
                         ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END)
          FROM pg_proc p, aclexplode(p.proacl) a
         WHERE p.oid = _f.fn AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner)
       IS DISTINCT FROM (SELECT array_agg(g ORDER BY g) FROM unnest(_f.grantees) g) THEN
      RAISE EXCEPTION '% does not carry exactly its previous grants', _f.fn;
    END IF;
  END LOOP;
END
$readback$;

COMMIT;
