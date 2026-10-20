-- ============================================================================================
-- E09 F1a — the per-business finance entitlement, made canonical and un-self-grantable.
--
-- Owner direction (2026-10-19, direction B): funding and credit are not standard features of any
-- business, now or for future businesses. The source of truth is the EXISTING per-business
-- entitlement — an active install of an `is_finance` Marketplace item OR
-- `tenants.features.finance_in_scope` (get_paige_persona_context, 20260805130000) — never a global
-- switch. Preserve the one installed entitlement and every legitimate record, billing row and
-- setting. No bulk disablement, no destruction, no billing change, no silent privilege expansion.
--
-- What this migration does (plan e09-knowledge-entitlement-plan §3.1 (a)–(i)):
--   (a) _tenant_finance_entitled(tenant): THE predicate, the persona expression verbatim. Service only.
--   (b) current_tenant_finance_entitled() for staff (no arguments; the business comes from the
--       caller's session) and client_portal_finance_entitled(tenant) for a portal customer (the
--       caller's own open relationship in that business; a 42501 from the resolver reads as false).
--   (c) _marketplace_item_is_finance(item): classification read past RLS, so an unlisted finance
--       item (invisible under mp_items_read) cannot slip through the guard below.
--   (d) A guard on marketplace_installs: no direct browser write (role authenticated/anon) may
--       create, re-activate, swap, move, uninstall or delete a FINANCE install. The Marketplace RPCs
--       (SECURITY DEFINER), stripe-webhook and marketplace-install (service role) are unaffected,
--       and so is every non-finance install.
--   (e) A guard on tenants.features.finance_in_scope: a browser write can no longer add, change or
--       remove the flag. A features write that leaves the key unchanged passes.
--   (f) New push-preference rows default the three credit/funding categories to OFF. The 4
--       existing rows are not touched.
--   (g) The two legacy notify trigger functions become no-ops. Both forwarded a stored service key to
--       a hard-coded host that is not this project; production holds no such key today, so both
--       already returned early. Their three triggers stay attached (notify_new_funding_match backs
--       two: on funding_matches and on user_funding_matches); nothing they did reaches anyone.
--   (h) create_subaccount (7-argument core): the latest body, copied verbatim, with 'funding'
--       removed from the starter presets. Inheritance already refused to carry 'funding' down.
--   (i) Credit rows: staff credit alerts (which by construction are always about a business's
--       CUSTOMER — tenant_staff_owns_user requires a linked client) now also require the business to
--       be finance-entitled, to file (INSERT) and to update; a portal customer can no longer file a
--       credit upload, in the table or in the storage bucket. A staff member's own upload is
--       unchanged (owner question Q5 is open).
--
-- §58 removals, named: direct browser writes to finance installs and to finance_in_scope; 'funding'
-- as a sub-account starter preset; the bodies of the two notify trigger functions (three triggers);
-- customer-tier credit uploads; staff credit-alert writes (INSERT and UPDATE) in a business without
-- the entitlement. Production counts on 2026-10-19: 0 customer credit uploads, 0 credit alerts,
-- 1 entitled business (unchanged).
--
-- Q5 (staff credit processing in a business WITHOUT the entitlement) is undecided and untouched:
-- nothing here gates a staff member's own credit work on the entitlement.
-- ============================================================================================

BEGIN;

-- ── (a) the canonical predicate ─────────────────────────────────────────────────────────────
-- The expression is get_paige_persona_context's, verbatim (20260805130000:95-105). A drift test
-- (detect-credit-alerts/authority.test.ts and _shared/finance-entitlement.drift.test.ts) holds the
-- two together and holds the TypeScript helper to this function.
CREATE OR REPLACE FUNCTION public._tenant_finance_entitled(_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT COALESCE(
      EXISTS (
        SELECT 1
        FROM public.marketplace_installs mi
        JOIN public.marketplace_items it ON it.id = mi.item_id
        WHERE mi.tenant_id = t.id
          AND mi.status = 'active'
          AND it.is_finance = true
      )
      OR (t.features ->> 'finance_in_scope')::boolean,
      false
    )
    FROM public.tenants t
    WHERE t.id = _tenant
  ), false);
$function$;
REVOKE ALL ON FUNCTION public._tenant_finance_entitled(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._tenant_finance_entitled(uuid) TO service_role;
COMMENT ON FUNCTION public._tenant_finance_entitled(uuid) IS
  'E09 F1a: THE per-business finance entitlement (active is_finance Marketplace install OR features.finance_in_scope). Internal; service role only. Callers: _shared/finance-entitlement.ts, the caller-scoped wrappers below.';

-- ── (b) caller-scoped wrappers ──────────────────────────────────────────────────────────────
-- Staff: the business is the caller's own session business (current_user_tenant_id derives it from
-- auth.uid() and an active seat); no argument can name another business. A portal customer holds no
-- seat, so this is false for them.
CREATE OR REPLACE FUNCTION public.current_tenant_finance_entitled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(public._tenant_finance_entitled(public.current_user_tenant_id()), false);
$function$;
REVOKE ALL ON FUNCTION public.current_tenant_finance_entitled() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_tenant_finance_entitled() TO authenticated;

-- Customer: true only when the caller holds an OPEN portal relationship in p_tenant_id (Slice 7's
-- resolver, keyed to auth.uid()) and that business is entitled. The tenant argument narrows the
-- caller's own authority; it never supplies any. The resolver's 42501 (several open relationships)
-- is caught here and reads as false, so it never reaches the page.
CREATE OR REPLACE FUNCTION public.client_portal_finance_entitled(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _c uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN false;
  END IF;
  BEGIN
    _c := public.client_portal_relationship_id(p_tenant_id);
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN false;
  END;
  IF _c IS NULL THEN
    RETURN false;
  END IF;
  RETURN COALESCE(public._tenant_finance_entitled(p_tenant_id), false);
END;
$function$;
REVOKE ALL ON FUNCTION public.client_portal_finance_entitled(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_finance_entitled(uuid) TO authenticated;

-- ── (c) item classification, read past RLS ──────────────────────────────────────────────────
-- Returns only the is_finance boolean of an item id. Granted to authenticated because the guard
-- below is SECURITY INVOKER (it must see the real caller in current_user) and runs this as the
-- writing role. It exposes no tenant data.
CREATE OR REPLACE FUNCTION public._marketplace_item_is_finance(_item uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((SELECT it.is_finance FROM public.marketplace_items it WHERE it.id = _item), false);
$function$;
REVOKE ALL ON FUNCTION public._marketplace_item_is_finance(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._marketplace_item_is_finance(uuid) TO authenticated;

-- ── (d) the install guard ───────────────────────────────────────────────────────────────────
-- SECURITY INVOKER on purpose: inside a Marketplace RPC (SECURITY DEFINER) current_user is the
-- function's owner, and for stripe-webhook / marketplace-install it is service_role, so only a
-- direct browser write (authenticated, or anon) is refused.
CREATE OR REPLACE FUNCTION public._marketplace_install_finance_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
       (TG_OP IN ('INSERT', 'UPDATE') AND public._marketplace_item_is_finance(NEW.item_id))
    OR (TG_OP IN ('UPDATE', 'DELETE') AND public._marketplace_item_is_finance(OLD.item_id))
  ) THEN
    RAISE EXCEPTION 'FINANCE_INSTALL_REQUIRES_MARKETPLACE'
      USING ERRCODE = '42501',
            HINT = 'Finance installs change only through the Marketplace install and uninstall.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
REVOKE ALL ON FUNCTION public._marketplace_install_finance_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS marketplace_install_finance_guard ON public.marketplace_installs;
CREATE TRIGGER marketplace_install_finance_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.marketplace_installs
  FOR EACH ROW EXECUTE FUNCTION public._marketplace_install_finance_guard();

-- ── (e) the flag guard ──────────────────────────────────────────────────────────────────────
-- No platform-owner exemption: the operator's path to the flag is a Marketplace install, so the
-- guard creates no new privilege path. INSERT is covered too (only the platform owner may insert a
-- tenant from the browser today).
CREATE OR REPLACE FUNCTION public._tenant_finance_flag_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
       (TG_OP = 'INSERT' AND (NEW.features ? 'finance_in_scope'))
    OR (TG_OP = 'UPDATE'
        AND (NEW.features -> 'finance_in_scope') IS DISTINCT FROM (OLD.features -> 'finance_in_scope'))
  ) THEN
    RAISE EXCEPTION 'FINANCE_FLAG_REQUIRES_MARKETPLACE'
      USING ERRCODE = '42501',
            HINT = 'finance_in_scope is set only by a Marketplace install.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._tenant_finance_flag_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tenant_finance_flag_guard ON public.tenants;
CREATE TRIGGER tenant_finance_flag_guard
  BEFORE INSERT OR UPDATE OF features ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public._tenant_finance_flag_guard();

-- ── (f) push defaults, new rows only ────────────────────────────────────────────────────────
ALTER TABLE public.push_notification_preferences
  ALTER COLUMN notify_dispute_updates SET DEFAULT false,
  ALTER COLUMN notify_funding_matches SET DEFAULT false,
  ALTER COLUMN notify_credit_score_changes SET DEFAULT false;

-- ── (g) the two legacy notify triggers become no-ops ────────────────────────────────────────
-- Production bodies (read 2026-10-19): both read _internal_secrets.service_role_key and, when
-- present, POSTed it as a bearer to a hard-coded host that is not this project
-- (send-notification / send-push-notification). Production has no such key, so both returned early.
-- Three triggers stay attached and now do nothing (pg_trigger on production, read 2026-10-19):
-- trg_notify_credit_alert_inserted on credit_alerts (notify_credit_alert_inserted), and
-- trg_funding_matches_notify on funding_matches AND trg_user_funding_matches_notify on
-- user_funding_matches (both notify_new_funding_match; match-funding-products writes the latter).
CREATE OR REPLACE FUNCTION public.notify_credit_alert_inserted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  -- E09 F1a: retired. Credit alerts are sent only by detect-credit-alerts, under its entitlement rule.
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_credit_alert_inserted() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_new_funding_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  -- E09 F1a: retired. No funding-match push is sent from the database.
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_new_funding_match() FROM PUBLIC, anon, authenticated, service_role;

-- ── (h) create_subaccount: 'funding' is no longer a starter preset ──────────────────────────
-- Body copied verbatim from 20260818000000_onboarding_systems_check_enqueue.sql:77-208 (production
-- prosrc md5 34d8a452fb80733587efc90ef23be491 on 2026-10-19, identical); the single change is
-- 'funding' removed from _known_slugs, so create_subaccount(..., 'funding', ...) is refused 22023.
-- The 6-argument wrapper is unchanged. Funding reaches a business only through the Marketplace.
CREATE OR REPLACE FUNCTION public.create_subaccount(_name text, _industry text, _description text, _parent_tenant_id uuid, _actor uuid, _playbook_slug text DEFAULT NULL::text, _inherit_from_parent boolean DEFAULT true)
 RETURNS tenants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := _actor;
  _parent uuid := _parent_tenant_id;
  _parent_type text;
  _parent_brand jsonb;
  _parent_features jsonb;
  _tenant public.tenants;
  _base_slug text;
  _slug text;
  _suffix int := 0;
  _child_count int;
  _child_brand jsonb := '{}'::jsonb;
  _child_features jsonb := '{}'::jsonb;
  _pb_config jsonb;
  _known_slugs text[] := ARRAY['general','coaching-default','fitness','consultant','agency'];
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _parent IS NULL THEN
    RAISE EXCEPTION 'no parent tenant in context' USING ERRCODE = '22000';
  END IF;
  -- Auth gate: the ACTOR must own the parent. _actor/_uid is used ONLY for authorization here;
  -- it MUST NOT flow into the child's ownership or roster (#215 / #212 rule 2).
  IF NOT public.is_tenant_owner(_uid, _parent) THEN
    RAISE EXCEPTION 'only the tenant owner may create a sub-account' USING ERRCODE = '42501';
  END IF;

  SELECT account_type, brand, features
    INTO _parent_type, _parent_brand, _parent_features
    FROM public.tenants WHERE id = _parent;
  IF _parent_type NOT IN ('agency', 'enterprise') THEN
    RAISE EXCEPTION 'sub-accounts require an Agency or Enterprise account' USING ERRCODE = '42501';
  END IF;

  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RAISE EXCEPTION 'sub-account name required' USING ERRCODE = '22000';
  END IF;

  IF _playbook_slug IS NOT NULL AND NOT (_playbook_slug = ANY (_known_slugs)) THEN
    RAISE EXCEPTION 'unknown playbook preset: %', _playbook_slug USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO _child_count FROM public.tenants WHERE parent_tenant_id = _parent;
  IF _child_count >= 100 THEN
    RAISE EXCEPTION 'sub-account limit (100) reached for this workspace' USING ERRCODE = '54000';
  END IF;

  _base_slug := trim(both '-' from regexp_replace(lower(trim(_name)), '[^a-z0-9]+', '-', 'g'));
  IF _base_slug IS NULL OR length(_base_slug) = 0 THEN _base_slug := 'subaccount'; END IF;
  _base_slug := left(_base_slug, 40);
  _slug := _base_slug;
  WHILE EXISTS (SELECT 1 FROM public.tenants WHERE slug = _slug) LOOP
    _suffix := _suffix + 1;
    _slug := _base_slug || '-' || _suffix::text;
  END LOOP;

  IF _inherit_from_parent AND _parent_brand IS NOT NULL THEN
    _child_brand := jsonb_strip_nulls(jsonb_build_object(
      'logo_url',      _parent_brand->'logo_url',
      'logo_dark_url', _parent_brand->'logo_dark_url',
      'favicon_url',   _parent_brand->'favicon_url',
      'primary_color', _parent_brand->'primary_color',
      'accent_color',  _parent_brand->'accent_color',
      'font',          _parent_brand->'font',
      'tagline',       _parent_brand->'tagline',
      'product_name',  _parent_brand->'product_name',
      'from_name',     _parent_brand->'from_name',
      'support_email', _parent_brand->'support_email'
    ));
  END IF;
  _child_brand := _child_brand || jsonb_strip_nulls(jsonb_build_object(
    'industry', _industry,
    'about',    _description
  ));

  IF _playbook_slug IS NOT NULL THEN
    _child_features := _child_features || jsonb_build_object('playbook', _playbook_slug);
  ELSIF _inherit_from_parent
        AND _parent_features IS NOT NULL
        AND (_parent_features ? 'playbook_config') THEN
    _pb_config := _parent_features->'playbook_config';
    IF COALESCE(_pb_config->>'slug', '') <> 'funding' THEN
      _child_features := _child_features || jsonb_build_object('playbook_config', _pb_config);
      IF _pb_config ? 'slug' THEN
        _child_features := _child_features || jsonb_build_object('playbook', _pb_config->>'slug');
      END IF;
    END IF;
  ELSIF _inherit_from_parent
        AND _parent_features IS NOT NULL
        AND (_parent_features ? 'playbook')
        AND COALESCE(_parent_features->>'playbook', '') NOT IN ('', 'funding') THEN
    _child_features := _child_features || jsonb_build_object('playbook', _parent_features->>'playbook');
  END IF;

  IF _inherit_from_parent
     AND _parent_features IS NOT NULL
     AND (_parent_features ? 'portal_config') THEN
    _child_features := _child_features || jsonb_build_object('portal_config', _parent_features->'portal_config');
  END IF;

  -- #215 / #212: the child is a true sub_account with NO owner yet (owner_user_id NULL) and NO
  -- members. The agency owner (_uid) is intentionally NOT written as owner or member — they
  -- administer the umbrella via the parent chain, they are not on the child's roster. The real
  -- principal becomes owner/admin by accepting a 'subaccount_owner' invite (P1b establishes the
  -- owner; today they land as admin). owner_user_id is nullable and excluded from
  -- tenants_one_toplevel_per_owner; INSERT triggers do not require a non-null owner.
  INSERT INTO public.tenants (slug, name, owner_user_id, parent_tenant_id, status, account_type, brand, features)
  VALUES (
    _slug, trim(_name), NULL, _parent, 'active', 'sub_account',
    _child_brand,
    _child_features
  )
  RETURNING * INTO _tenant;

  -- D3: fire the FIRST onboarding Systems Check for this brand-new sub-account (every tier gets one,
  -- §56). Wrapped so a failure NEVER aborts creation (§13/§32) — the helper also swallows internally.
  BEGIN
    PERFORM public.enqueue_onboarding_systems_check(_tenant.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'create_subaccount: onboarding systems-check enqueue failed for %: %', _tenant.id, sqlerrm;
  END;

  RETURN _tenant;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_subaccount(text, text, text, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_subaccount(text, text, text, uuid, uuid, text, boolean) TO service_role;

-- ── (i) credit rows ─────────────────────────────────────────────────────────────────────────
-- A login that is linked as some business's client and holds no active seat anywhere.
CREATE OR REPLACE FUNCTION public._user_is_portal_customer_only(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT _user IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.clients c WHERE c.linked_user_id = _user)
     AND NOT EXISTS (
       SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = _user AND tm.status = 'active'
     );
$function$;
REVOKE ALL ON FUNCTION public._user_is_portal_customer_only(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._user_is_portal_customer_only(uuid) TO service_role;

-- The same question about the caller, for RLS. No argument; keyed to auth.uid().
CREATE OR REPLACE FUNCTION public._caller_is_portal_customer_only()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public._user_is_portal_customer_only(auth.uid());
$function$;
REVOKE ALL ON FUNCTION public._caller_is_portal_customer_only() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._caller_is_portal_customer_only() TO authenticated;

-- Staff credit-alert writes. tenant_staff_owns_user (the policy's existing check) admits the
-- platform owner, or an owner/admin (or managing agency) of a business where the subject is a
-- linked client. This keeps exactly that shape and adds: that business is finance-entitled. The
-- subject of a staff-filed credit alert is always a business's customer, so this is the
-- customer-subject path the owner's direction closes (it is not Q5, which is staff's own work).
CREATE OR REPLACE FUNCTION public._credit_subject_staff_entitled(_subject uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.linked_user_id = _subject
        AND (
          public.agency_can_manage_child(c.tenant_id, auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.tenant_members tm
             WHERE tm.tenant_id = c.tenant_id
               AND tm.user_id = auth.uid()
               AND tm.status = 'active'
               AND tm.role IN ('owner', 'admin')
          )
        )
        AND public._tenant_finance_entitled(c.tenant_id)
    )
  );
$function$;
REVOKE ALL ON FUNCTION public._credit_subject_staff_entitled(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._credit_subject_staff_entitled(uuid) TO authenticated;

-- credit_alerts: the staff insert and update policies. Names confirmed on production 2026-10-19.
-- "Admins can read all alerts", "Clients can read own alerts", "Clients can update own alerts" and
-- "Coaches can read assigned client alerts" are unchanged (0 alerts exist; nothing is hidden).
ALTER POLICY "Admins can insert alerts" ON public.credit_alerts
  WITH CHECK (public.tenant_staff_owns_user(auth.uid(), client_id)
              AND public._credit_subject_staff_entitled(client_id));
ALTER POLICY "Admins can update all alerts" ON public.credit_alerts
  USING (public.tenant_staff_owns_user(auth.uid(), client_id)
         AND public._credit_subject_staff_entitled(client_id));

-- credit_report_uploads: a portal customer may no longer file their own upload. Staff self-upload
-- (the path in use) and the admin / coach upload policies are unchanged.
ALTER POLICY "Users can upload own credit reports" ON public.credit_report_uploads
  WITH CHECK ((auth.uid() = user_id) AND (uploaded_by = auth.uid())
              AND NOT public._caller_is_portal_customer_only());

-- The storage policy of the same name on the credit-report-uploads bucket, recreated with the same
-- predicate plus the customer refusal (DROP/CREATE is the repo's convention for storage.objects).
DROP POLICY IF EXISTS "Users can upload own credit reports" ON storage.objects;
CREATE POLICY "Users can upload own credit reports"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'credit-report-uploads'
    AND (auth.uid())::text = (storage.foldername(name))[1]
    AND NOT public._caller_is_portal_customer_only()
  );

COMMIT;
