-- Security: forged marketing consent (#2087) and unsafe form/booking links (#2090).
-- Grounded read-only against production (xygzykjyynhzqytbqnzu) on 2026-10-13; findings recorded in the
-- issues and in docs/brain/decision-log.md.
--
-- #2087 — who may write consent, and which records a send may trust.
--   Production at write time: communications_consents holds ONE row. It came from signup (0.15 s after the
--   account was created) and carries the full evidence shape (consent_granted_at, disclosure_version, https
--   source_url), but its account has NO verified phone, so who owns that number is unproven. Under the
--   rule below it no longer authorizes a send: a historical row is not trusted because it exists. No row was
--   written through record_communications_consent or the null-user insert branch. No consent-dependent send
--   has run in 30 days: 0 stage-automation rules, 0 operator SMS ever, 0 SMS in communication_log, 0 rows
--   in email_send_log.
--   1. record_communications_consent: EXECUTE for the service role only (anon and authenticated held it,
--      so anyone could write any tenant's, contact's or phone's consent). The body also refuses a
--      browser role, so a later grant cannot reopen it (§59).
--   2. communications_consents: no browser role may insert or delete. The "self insert" policy let any
--      signed-in user write a complete evidence row for any phone number. Its null-user branch let them
--      attach any tenant, contact or marketing flags. Both are dropped. anon keeps no privilege at all.
--      (Production granted anon full table DML, with RLS the only guard.) Signed-in users keep read
--      access through the unchanged read policies, and may update only withdrawn_at, withdrawn_reason
--      and revoked_at on their own rows, which is revocation. The remaining writers are server-side:
--      tenant-signup, the two STOP/START webhooks and affiliate-application-confirm (service role), and
--      the persist_solo_beta_signup_consent trigger. Both signup paths write evidence for a phone number the
--      signer TYPED (the trigger reads it from signup metadata the browser supplies), which is why the gate
--      below also demands a verified number (#2094 tracks proving ownership at signup).
--   3. has_sms_consent / has_email_marketing_consent: service role only (grant AND body). Both are
--      anon-callable today, which lets anyone probe whether a number or address has consented. They now
--      trust only platform evidence: consent_granted_at set (the evidence-shape CHECK then guarantees a
--      user, an https source and a disclosure version), no tenant, no contact, not withdrawn, not revoked,
--      and, for SMS, the evidence's own account has VERIFIED that number (communication_preferences, set
--      only by verify-sms-code). paige-operator-sms-send now asks this one gate instead of matching on the
--      phone alone.
--      Unverified preference rows authorize nothing. No server path writes verified email-marketing
--      evidence today, so has_email_marketing_consent now answers false, which fails closed.
--      Tenant-to-contact consent is never decided here. It belongs to the tenant ledger
--      (paige_consent_events, tenant-scoped RLS, read by the pre-send pipeline), and
--      dispatch-stage-automation now reads it there.
--   4. paige_consent_events / paige_suppressions: their browser policies keyed authority on the GLOBAL
--      'admin' role (§59 trap), so a plain member of business B who is an admin anywhere else could write
--      B's consent ledger (granting marketing consent) or delete B's suppressions (un-opting-out a contact),
--      and read both. Now: platform owner, or the active workspace's own owner/admin (is_tenant_admin), or
--      its managing agency (agency_can_manage_child). The server's service-role writers are unchanged.
--
-- #2090 — a stored link that a public page renders must be a web address.
--   public.is_safe_web_url(text): null/empty, or an http(s) URL with a host, no whitespace, no control
--   characters, no backslash, at most 2048 characters. Enforced by BEFORE INSERT/UPDATE triggers on every
--   write path, service role included:
--     growth_forms        success_action_json / draft_success_action_json -> redirect_url, download_url
--     calendars           redirect_url
--   The messages are written for the person who typed the link. The calendar message carries the
--   PRESET_ prefix that the booking editors already strip.
--   Production at write time: 5 forms and 13 calendars, none with a redirect or download link, so
--   nothing needs cleaning and no existing row is touched. The browser guards (GrowthFormRenderer,
--   BookingPage) stay as defence in depth.

-- ───────────────────────────── #2087 ─────────────────────────────

CREATE OR REPLACE FUNCTION public.record_communications_consent(
  p_email text,
  p_phone text DEFAULT NULL::text,
  p_tenant_id uuid DEFAULT NULL::uuid,
  p_contact_id uuid DEFAULT NULL::uuid,
  p_email_marketing boolean DEFAULT false,
  p_sms_marketing boolean DEFAULT false,
  p_sms_transactional boolean DEFAULT false,
  p_voice_marketing boolean DEFAULT false,
  p_source text DEFAULT 'unknown'::text,
  p_ip_address text DEFAULT NULL::text,
  p_user_agent text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_doc_version integer;
BEGIN
  -- A server-side recorder: the caller has already decided who this is and why (§59 — the grant is not the
  -- guard). A browser role never writes consent, whatever grants a later migration adds.
  IF coalesce(auth.role(), '') NOT IN ('service_role', '') THEN
    RAISE EXCEPTION 'CONSENT_WRITE_FORBIDDEN: consent is recorded by the server, not the browser'
      USING ERRCODE = '42501';
  END IF;

  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'email is required for communications consent';
  END IF;

  SELECT version INTO v_doc_version
  FROM public.legal_documents
  WHERE slug = 'communications-consent' AND is_current = true
  ORDER BY version DESC LIMIT 1;

  -- Never evidence: consent_granted_at / disclosure_version / source_url stay null, so no send gate trusts
  -- a row written here. It records a preference, not an authorization.
  INSERT INTO public.communications_consents (
    user_id, tenant_id, contact_id, email, phone,
    email_transactional, email_marketing,
    sms_transactional, sms_marketing, voice_marketing,
    document_slug, document_version, source, ip_address, user_agent
  )
  VALUES (
    auth.uid(), p_tenant_id, p_contact_id, lower(trim(p_email)), p_phone,
    true, COALESCE(p_email_marketing, false),
    COALESCE(p_sms_transactional, false),
    COALESCE(p_sms_marketing, false),
    COALESCE(p_voice_marketing, false),
    'communications-consent', COALESCE(v_doc_version, 1), p_source, p_ip_address, p_user_agent
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_communications_consent(text, text, uuid, uuid, boolean, boolean, boolean, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_communications_consent(text, text, uuid, uuid, boolean, boolean, boolean, boolean, text, text, text) TO service_role;

DROP POLICY IF EXISTS "comms_consents self insert" ON public.communications_consents;

REVOKE ALL ON TABLE public.communications_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.communications_consents TO authenticated;
GRANT UPDATE (withdrawn_at, withdrawn_reason, revoked_at) ON TABLE public.communications_consents TO authenticated;
GRANT ALL ON TABLE public.communications_consents TO service_role;

CREATE OR REPLACE FUNCTION public.has_sms_consent(_phone text, _marketing boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Verified platform evidence only. consent_granted_at is set exclusively by server paths, and the
  -- evidence-shape CHECK guarantees user, https source and disclosure version on such a row.
  WITH target AS (
    SELECT _phone AS raw_phone, public.normalize_e164_phone(_phone) AS normalized_phone
  )
  SELECT EXISTS (
      SELECT 1
      FROM public.communications_consents consent
      WHERE (
          consent.phone = target.raw_phone
          OR (
            target.normalized_phone IS NOT NULL
            AND consent.phone = target.normalized_phone
          )
        )
        AND consent.consent_granted_at IS NOT NULL
        AND consent.tenant_id IS NULL
        AND consent.contact_id IS NULL
        AND consent.withdrawn_at IS NULL
        AND consent.revoked_at IS NULL
        AND (
          (_marketing = false AND consent.sms_transactional = true)
          OR (_marketing = true AND consent.sms_marketing = true)
        )
        -- The account behind the evidence proved it owns this number (verify-sms-code sets it).
        AND EXISTS (
          SELECT 1 FROM public.communication_preferences pref
          WHERE pref.user_id = consent.user_id
            AND pref.sms_phone_verified = true
            AND public.normalize_e164_phone(pref.sms_phone_number) = consent.phone
        )
    )
    AND coalesce(auth.role(), '') IN ('service_role', '')
  FROM target;
$function$;

CREATE OR REPLACE FUNCTION public.has_email_marketing_consent(_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Verified platform evidence only (see has_sms_consent). No server path records verified email-marketing
  -- evidence yet, so this answers false: fail closed. A tenant's own contacts are never decided here; their
  -- consent is the tenant ledger, paige_consent_events.
  SELECT EXISTS (
    SELECT 1 FROM public.communications_consents
    WHERE lower(email) = lower(_email)
      AND consent_granted_at IS NOT NULL
      AND tenant_id IS NULL
      AND contact_id IS NULL
      AND withdrawn_at IS NULL
      AND revoked_at IS NULL
      AND email_marketing = true
  )
  AND coalesce(auth.role(), '') IN ('service_role', '');
$function$;

REVOKE ALL ON FUNCTION public.has_sms_consent(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_sms_consent(text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.has_email_marketing_consent(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_email_marketing_consent(text) TO service_role;

-- ───────────────────────────── #2090 ─────────────────────────────

CREATE OR REPLACE FUNCTION public.is_safe_web_url(_url text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT _url IS NULL
    OR _url = ''
    OR (
      length(_url) <= 2048
      AND _url ~* '^https?://[^[:space:][:cntrl:]/?#\\]+([/?#][^[:space:][:cntrl:]\\]*)?$'
      -- a real host: after any userinfo, it starts with a letter, a digit or an IPv6 bracket
      AND substring(_url from '^[A-Za-z]+://([^/?#]*)') ~ '(^|@)[[:alnum:]\[][^@]*$'
    );
$function$;

REVOKE ALL ON FUNCTION public.is_safe_web_url(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_safe_web_url(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.growth_forms_guard_success_links()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.is_safe_web_url(NEW.success_action_json ->> 'redirect_url')
     OR NOT public.is_safe_web_url(NEW.success_action_json ->> 'download_url')
     OR NOT public.is_safe_web_url(NEW.draft_success_action_json ->> 'redirect_url')
     OR NOT public.is_safe_web_url(NEW.draft_success_action_json ->> 'download_url') THEN
    RAISE EXCEPTION 'FORM_LINK_INVALID: A form''s redirect or download link must be a full web address that starts with https:// or http://.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.growth_forms_guard_success_links() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS growth_forms_guard_success_links ON public.growth_forms;
CREATE TRIGGER growth_forms_guard_success_links
  BEFORE INSERT OR UPDATE OF success_action_json, draft_success_action_json ON public.growth_forms
  FOR EACH ROW EXECUTE FUNCTION public.growth_forms_guard_success_links();

CREATE OR REPLACE FUNCTION public.calendars_guard_redirect_url()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.is_safe_web_url(NEW.redirect_url) THEN
    RAISE EXCEPTION 'PRESET_REDIRECT_INVALID: Enter the full address of the page to send guests to, starting with https:// (or http://).'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.calendars_guard_redirect_url() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS calendars_guard_redirect_url ON public.calendars;
CREATE TRIGGER calendars_guard_redirect_url
  BEFORE INSERT OR UPDATE OF redirect_url ON public.calendars
  FOR EACH ROW EXECUTE FUNCTION public.calendars_guard_redirect_url();

-- ───────────── #2087: the tenant ledger's browser policies (§59 global-role trap) ─────────────

-- The policies below call these as the browser role. Production already grants both to authenticated
-- (read 2026-10-13); stated here so the policies cannot depend on drift.
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(uuid), public.agency_can_manage_child(uuid) TO authenticated;

DROP POLICY IF EXISTS paige_consent_events_insert ON public.paige_consent_events;
CREATE POLICY paige_consent_events_insert ON public.paige_consent_events FOR INSERT
  WITH CHECK (public.is_platform_owner() OR (tenant_id = public.current_user_tenant_id()
    AND (public.is_tenant_admin(tenant_id) OR public.agency_can_manage_child(tenant_id))));
DROP POLICY IF EXISTS paige_consent_events_select ON public.paige_consent_events;
CREATE POLICY paige_consent_events_select ON public.paige_consent_events FOR SELECT
  USING (public.is_platform_owner() OR (tenant_id = public.current_user_tenant_id()
    AND (public.is_tenant_admin(tenant_id) OR public.agency_can_manage_child(tenant_id))));

DROP POLICY IF EXISTS paige_suppressions_insert ON public.paige_suppressions;
CREATE POLICY paige_suppressions_insert ON public.paige_suppressions FOR INSERT
  WITH CHECK (public.is_platform_owner() OR (tenant_id = public.current_user_tenant_id()
    AND (public.is_tenant_admin(tenant_id) OR public.agency_can_manage_child(tenant_id))));
DROP POLICY IF EXISTS paige_suppressions_select ON public.paige_suppressions;
CREATE POLICY paige_suppressions_select ON public.paige_suppressions FOR SELECT
  USING (public.is_platform_owner() OR (tenant_id = public.current_user_tenant_id()
    AND (public.is_tenant_admin(tenant_id) OR public.agency_can_manage_child(tenant_id))));
DROP POLICY IF EXISTS paige_suppressions_delete ON public.paige_suppressions;
CREATE POLICY paige_suppressions_delete ON public.paige_suppressions FOR DELETE
  USING (public.is_platform_owner() OR (tenant_id = public.current_user_tenant_id()
    AND (public.is_tenant_admin(tenant_id) OR public.agency_can_manage_child(tenant_id))));
