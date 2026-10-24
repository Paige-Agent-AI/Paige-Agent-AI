-- EXP09: one canonical customer relationship per login PER business.
-- Preserve original recipient/token/CRM/audit flow, and all non-customer invite branches.
BEGIN;
DO $lease$
DECLARE expected jsonb;actual jsonb;
BEGIN
 FOR expected IN SELECT value FROM pg_catalog.jsonb_array_elements($contracts$[
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"_token text","hash":"10316cc79166fbcc24825cbbacf34e89","owner":"postgres","config":["search_path=public"],"result":"uuid","definer":true,"language":"plpgsql","signature":"accept_tenant_invite(text)","volatility":"v"},
{"acl":["postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"","hash":"a6e37b8e7881c142be52d3b65e1c6f8c","owner":"postgres","config":["search_path=public"],"result":"trigger","definer":true,"language":"plpgsql","signature":"auto_advance_journey_on_tier()","volatility":"v"},
{"acl":["postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"","hash":"7a1f9bd8eda9eb23ffde44552190b404","owner":"postgres","config":["search_path=public"],"result":"TABLE(healed boolean, onboarding_stage text, client_id uuid)","definer":true,"language":"plpgsql","signature":"ensure_client_role_self_heal()","volatility":"v"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"","hash":"cd959462bca734f717e6911e4773d5f2","owner":"postgres","config":["search_path=public"],"result":"jsonb","definer":false,"language":"plpgsql","signature":"load_self_context()","volatility":"v"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false"],"args":"","hash":"39cb7d0fc5b50f669c3cc049e98971f9","owner":"postgres","config":["search_path=public"],"result":"TABLE(tenant_id uuid, tenant_name text, playbook_config jsonb, playbook_slug text, funding_enabled boolean, brand jsonb)","definer":true,"language":"plpgsql","signature":"get_paige_persona_context()","volatility":"s"},
{"acl":["postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"_actor uuid","hash":"ac743fec2458ecf43c25db8fc0c80ad6","owner":"postgres","config":["search_path=public"],"result":"jsonb","definer":true,"language":"plpgsql","signature":"get_actor_access(uuid)","volatility":"s"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"p_tenant_id uuid","hash":"ff84ba24689e5043d7d15ed3d9150268","owner":"postgres","config":["search_path=public, pg_temp"],"result":"uuid","definer":true,"language":"plpgsql","signature":"client_portal_relationship_id(uuid)","volatility":"s"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"p_tenant_id uuid","hash":"090fd2f8ef6f29ddf8091be7cbd6db7d","owner":"postgres","config":["search_path=public, pg_temp"],"result":"jsonb","definer":true,"language":"plpgsql","signature":"client_portal_self_profile(uuid)","volatility":"s"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"p_token text","hash":"bc5463b7136b57352f8c854729570140","owner":"postgres","config":["search_path=public, pg_temp"],"result":"jsonb","definer":true,"language":"plpgsql","signature":"client_portal_invite_status(text)","volatility":"s"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false"],"args":"","hash":"b3826e6b52ba34cd40348112b8145883","owner":"postgres","config":["search_path=public, pg_temp"],"result":"jsonb","definer":true,"language":"plpgsql","signature":"client_portal_frame()","volatility":"s"},
{"acl":["postgres:EXECUTE:false"],"args":"","hash":"c1dceae767c0b94a7e465f678a72d648","owner":"postgres","config":["search_path=\"\""],"result":"trigger","definer":true,"language":"plpgsql","signature":"_clients_portal_access_guard()","volatility":"v"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false"],"args":"p_expected_actor_id uuid, p_expected_tenant_id uuid, p_contact_id uuid, p_action text, p_reason text, p_note text, p_expected_changed_at timestamp with time zone","hash":"c56f93bbcf4c17b216975e97a4ec8a1f","owner":"postgres","config":["search_path=\"\""],"result":"jsonb","definer":true,"language":"plpgsql","signature":"set_client_portal_access(uuid,uuid,uuid,text,text,text,timestamp with time zone)","volatility":"v"},
{"acl":["postgres:EXECUTE:false"],"args":"p_tenant_id uuid, p_lock text","hash":"416002c40cb71ed54cc4c3387c37563f","owner":"postgres","config":["search_path=\"\""],"result":"uuid","definer":true,"language":"plpgsql","signature":"_client_portal_lock_relationship(uuid,text)","volatility":"v"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false"],"args":"p_limit integer, p_after uuid","hash":"3fe81a22912dd6292462b69a155a25f0","owner":"postgres","config":["search_path=\"\""],"result":"jsonb","definer":true,"language":"plpgsql","signature":"client_portal_relationship_choices(integer,uuid)","volatility":"s"},
{"acl":["postgres:EXECUTE:false"],"args":"","hash":"72efd408dc26f9672088f10eea9ebea1","owner":"postgres","config":["search_path=\"\""],"result":"uuid","definer":false,"language":"plpgsql","signature":"_client_portal_request_business()","volatility":"s"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false"],"args":"p_slug text","hash":"ca744991908d2e8239b84bb76033dc03","owner":"postgres","config":["search_path=\"\""],"result":"jsonb","definer":true,"language":"plpgsql","signature":"client_portal_entry_for_slug(text)","volatility":"s"}
]$contracts$::jsonb) LOOP
  SELECT pg_catalog.jsonb_build_object(
   'signature',expected->>'signature','hash',pg_catalog.md5(p.prosrc),
   'owner',pg_catalog.pg_get_userbyid(p.proowner),'language',l.lanname,
   'definer',p.prosecdef,'volatility',p.provolatile,
   'args',pg_catalog.pg_get_function_identity_arguments(p.oid),
   'result',pg_catalog.pg_get_function_result(p.oid),'config',p.proconfig,
   'acl',(SELECT pg_catalog.jsonb_agg(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END||':'||a.privilege_type||':'||a.is_grantable::text ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END) FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner)))a))
  INTO actual FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
  WHERE p.oid=pg_catalog.to_regprocedure('public.'||(expected->>'signature'));
  IF actual IS NULL OR (actual-'acl') IS DISTINCT FROM (expected-'acl')
   OR ((actual->'acl') IS DISTINCT FROM (expected->'acl') AND NOT(
    expected->>'signature' IN('auto_advance_journey_on_tier()','ensure_client_role_self_heal()')
    AND actual->'acl'='["postgres:EXECUTE:false"]'::jsonb)) THEN
   RAISE EXCEPTION 'Original customer admission dependency changed; reconcile: %',expected->>'signature' USING ERRCODE='42501';
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=pg_catalog.to_regclass('public.clients_linked_user_id_unique') AND indisunique AND indisvalid AND indisready AND pg_catalog.pg_get_indexdef(indexrelid)='CREATE UNIQUE INDEX clients_linked_user_id_unique ON public.clients USING btree (linked_user_id) WHERE (linked_user_id IS NOT NULL)' AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conindid=indexrelid))
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=pg_catalog.to_regclass('public.clients_tenant_linked_user_key') AND indisunique AND indisvalid AND indisready AND pg_catalog.pg_get_indexdef(indexrelid)='CREATE UNIQUE INDEX clients_tenant_linked_user_key ON public.clients USING btree (tenant_id, linked_user_id)')
  OR pg_catalog.to_regclass('public.clients_linked_user_lookup_idx') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.clients'::regclass AND tgname='trg_clients_portal_access_guard' AND tgenabled='O' AND tgfoid='public._clients_portal_access_guard()'::regprocedure AND pg_catalog.pg_get_triggerdef(oid)='CREATE TRIGGER trg_clients_portal_access_guard BEFORE INSERT OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION _clients_portal_access_guard()') THEN
  RAISE EXCEPTION 'Original customer admission indexes or access trigger changed; reconcile' USING ERRCODE='42501';
 END IF;
END $lease$;

CREATE OR REPLACE FUNCTION public.accept_tenant_invite(_token text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _tok public.tenant_invite_tokens;
  _email text;
  _email_confirmed_at timestamptz;
  _full text;
  _first text;
  _last text;
  _client_id uuid;
  _existing_tenant uuid;
  _tenant_owner uuid;
  _has_active_owner boolean;   -- #227 Layer-2 shell-gate
  _minter_ok boolean;          -- #227 Layer-2 shell-gate
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'must be signed in to accept an invite';
  END IF;

  SELECT * INTO _tok FROM public.tenant_invite_tokens WHERE token = _token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite token not found'; END IF;
  IF _tok.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'invite has been revoked'; END IF;
  IF _tok.expires_at <= now() THEN RAISE EXCEPTION 'invite has expired'; END IF;
  IF _tok.max_uses IS NOT NULL AND _tok.uses >= _tok.max_uses THEN
    RAISE EXCEPTION 'invite has reached its usage limit';
  END IF;

  -- Solo Team tokens are also reachable through this legacy RPC. Enforce the same recipient
  -- boundary before any membership, role, profile or token write. Other invite kinds retain
  -- their existing eligibility and acceptance behavior.
  IF _tok.kind = 'team' THEN
    SELECT email, email_confirmed_at INTO _email, _email_confirmed_at
    FROM auth.users WHERE id = _uid;
    IF _email_confirmed_at IS NULL
       OR NULLIF(btrim(_email), '') IS NULL
       OR NULLIF(btrim(_tok.email), '') IS NULL
       OR lower(btrim(_tok.email)) <> lower(btrim(_email)) THEN
      RAISE EXCEPTION 'team invitation belongs to a different email address' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF _tok.kind = 'consumer' THEN
    -- E09_CONSUMER_INVITE_INTEGRITY_V1
    SELECT email, email_confirmed_at INTO _email, _email_confirmed_at
      FROM auth.users WHERE id = _uid;
    IF NULLIF(btrim(_tok.email), '') IS NULL
       OR _email_confirmed_at IS NULL
       OR NULLIF(btrim(_email), '') IS NULL
       OR lower(btrim(_tok.email)) <> lower(btrim(_email)) THEN
      RAISE EXCEPTION 'portal invitation belongs to a different verified recipient' USING ERRCODE = '42501';
    END IF;
    -- Historic consumer invites may have max_uses=NULL. They still grant once.
    IF COALESCE(_tok.uses, 0) <> 0 OR _tok.last_used_at IS NOT NULL THEN
      RAISE EXCEPTION 'portal invitation has already been accepted' USING ERRCODE = '42501';
    END IF;
    IF _tok.contact_id IS NULL THEN
      RAISE EXCEPTION 'portal invitation requires an explicit client relationship' USING ERRCODE = '42501';
    END IF;

    -- Lock the exact canonical contact; never fall back to another contact or
    -- create a duplicate CRM record when the invite binding is stale.
    SELECT c.id INTO _client_id FROM public.clients c
      WHERE c.id = _tok.contact_id AND c.tenant_id = _tok.tenant_id
        AND c.status = 'active' AND c.merged_into_contact_id IS NULL
        AND (c.linked_user_id IS NULL OR c.linked_user_id = _uid)
        AND EXISTS (SELECT 1 FROM public.client_contact_methods cm
          WHERE cm.client_id = c.id AND cm.tenant_id = c.tenant_id AND cm.kind = 'email'
            AND cm.match_key = public.contact_method_match_key('email', _tok.email))
      FOR UPDATE OF c;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'portal invitation client relationship is no longer available' USING ERRCODE = '42501';
    END IF;
    -- Keep one canonical relationship per login in each business.
    -- Other businesses retain their own original relationship authorization.
    IF EXISTS (SELECT 1 FROM public.clients c
      WHERE c.linked_user_id = _uid AND c.tenant_id = _tok.tenant_id
        AND c.id <> _client_id) THEN
      RAISE EXCEPTION 'portal identity requires relationship access reconciliation' USING ERRCODE = '42501';
    END IF;

    UPDATE public.clients SET linked_user_id = _uid,
      onboarding_stage = COALESCE(onboarding_stage, 'invited'), updated_at = now()
      WHERE id = _client_id AND tenant_id = _tok.tenant_id;
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'client')
      ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
      VALUES (_uid, 'client_portal', 'consumer_invite_accepted', _tok.id,
        jsonb_build_object('tenant_id', _tok.tenant_id, 'client_id', _client_id,
          'actor_user_id', _uid, 'via', 'accept_tenant_invite'));
    -- E09_CUSTOMER_ENTRY_V1: commit the same native token and audit; leave
    -- profiles.active_tenant_id and all business/staff membership untouched.
    PERFORM 1 FROM public.tenants WHERE id = _tok.tenant_id AND status = 'active' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501'; END IF;
    UPDATE public.tenant_invite_tokens SET uses = uses + 1, last_used_at = now() WHERE id = _tok.id;
    RETURN _tok.tenant_id;

  ELSIF _tok.kind = 'subaccount_owner' THEN
    SELECT email INTO _email FROM auth.users WHERE id = _uid;
    IF _tok.email IS NOT NULL AND lower(_tok.email) <> lower(COALESCE(_email, '')) THEN
      RAISE EXCEPTION 'This invite was sent to a different email address. Accept it while signed in as %', _tok.email;
    END IF;

    -- #227 HOLE#1 Layer-2 SHELL-GATE: establish ownership ONLY on a shell child that has
    -- no active owner yet, AND only when the minter is (still) agency-over-child / platform.
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_members
       WHERE tenant_id = _tok.tenant_id AND is_owner = true AND status = 'active'
    ) INTO _has_active_owner;

    SELECT ( public.is_platform_owner(_tok.created_by)
             OR public.agency_can_manage_child(_tok.tenant_id, _tok.created_by) )
      INTO _minter_ok;

    IF NOT _has_active_owner AND _minter_ok THEN
      -- LEGITIMATE first owner of the shell child, born correct — is_owner=true +
      -- role='owner' in lockstep (guard-exempt: current_user='postgres' inside definer).
      INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at)
      VALUES (_tok.tenant_id, _uid, 'owner'::public.tenant_role, 'active', true, now())
      ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET is_owner  = true,
            role      = 'owner'::public.tenant_role,
            status    = 'active',
            joined_at = COALESCE(public.tenant_members.joined_at, now()),
            updated_at = now();

      -- Display-only owner_user_id parity: set ONLY when still unset (never overwrite a
      -- real owner_user_id; Parts B/D reconcile the historically-leaked pointer).
      UPDATE public.tenants
         SET owner_user_id = _uid, updated_at = now()
       WHERE id = _tok.tenant_id AND owner_user_id IS NULL;

      INSERT INTO public.paige_audit_log
        (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
      VALUES (_uid, 'owner', 'tenant:subaccount_owner_established', 'tenant_member', _uid,
              jsonb_build_object('tenant_id', _tok.tenant_id, 'lane', 'auto', 'via', 'accept_tenant_invite'),
              _tok.tenant_id);
    ELSE
      -- Already-owned / peer child, or minter no longer authorized → plain admin seat.
      -- is_owner pinned FALSE on fresh insert; ON CONFLICT preserves an existing owner
      -- (lockstep) and NEVER raises is_owner — no second silent co-owner.
      INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at)
      VALUES (_tok.tenant_id, _uid, 'admin'::public.tenant_role, 'active', false, now())
      ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET role = (CASE WHEN public.tenant_members.role = 'owner'::public.tenant_role
                         THEN 'owner'::public.tenant_role
                         ELSE 'admin'::public.tenant_role END),
            status = 'active',
            joined_at = COALESCE(public.tenant_members.joined_at, now()),
            updated_at = now();
    END IF;

  ELSIF _tok.kind = 'agency_team' THEN
    SELECT email INTO _email FROM auth.users WHERE id = _uid;
    IF _tok.email IS NOT NULL AND lower(_tok.email) <> lower(COALESCE(_email, '')) THEN
      RAISE EXCEPTION 'This invite was sent to a different email address. Accept it while signed in as %', _tok.email;
    END IF;
    IF _tok.agency_role IS NULL OR _tok.agency_role NOT IN
       ('agency_admin','agency_manager','agency_biller','agency_specialist','agency_viewer') THEN
      RAISE EXCEPTION 'This agency invite is missing a valid role. Ask the agency to resend it.';
    END IF;

    DELETE FROM public.agency_team_members
     WHERE agency_tenant_id = _tok.tenant_id
       AND user_id IS NULL
       AND email IS NOT NULL
       AND lower(email) = lower(COALESCE(_email, ''));

    UPDATE public.agency_team_members
       SET agency_role = _tok.agency_role,
           status = 'active',
           email = COALESCE(email, _email),
           joined_at = COALESCE(joined_at, now()),
           updated_at = now()
     WHERE agency_tenant_id = _tok.tenant_id AND user_id = _uid;
    IF NOT FOUND THEN
      INSERT INTO public.agency_team_members
        (agency_tenant_id, user_id, email, agency_role, status, invited_by, invited_at, joined_at)
      VALUES
        (_tok.tenant_id, _uid, _email, _tok.agency_role, 'active', _tok.created_by, _tok.created_at, now());
    END IF;

  ELSE
    -- SECURITY (Tier Rail Phase A): a generic staff/'team' invite may only grant
    -- tenant_members on a NON-agency tenant.
    IF (SELECT account_type FROM public.tenants WHERE id = _tok.tenant_id)
         IN ('agency','enterprise') THEN
      RAISE EXCEPTION 'Staff invites cannot grant access on an agency or enterprise account. Use an agency team invite instead.';
    END IF;

    -- FIX-1 (§9): an invite NEVER mints or elevates ownership. Owner elevation is
    -- EXCLUSIVELY grant_co_owner(). Fresh seat: is_owner pinned false; any owner
    -- default_role coerced to 'admin' (keeps role/is_owner lockstep). ON CONFLICT:
    -- is_owner and role left UNTOUCHED — see §13 NOTE below.
    INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at)
    VALUES (
      _tok.tenant_id, _uid,
      (CASE WHEN _tok.default_role = 'owner'::public.tenant_role
            THEN 'admin'::public.tenant_role ELSE _tok.default_role END),
      'active', false, now())
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET status = 'active',
          joined_at = COALESCE(public.tenant_members.joined_at, now()),
          updated_at = now();
    -- §13 NOTE (deliberate deviation from the literal "force is_owner=false on the ON
    -- CONFLICT"): the conflict path intentionally does NOT write is_owner or role. It
    -- cannot ESCALATE (a returning member keeps their existing bit; only grant_co_owner
    -- raises it) and it must NOT force-clear it, which would DEMOTE / last-owner-strip a
    -- legitimate owner who re-accepts a staff invite. Escalation is fully closed at the
    -- fresh-INSERT (pins false) + the create-side owner-token rejection.
  END IF;

  UPDATE public.tenant_invite_tokens SET uses = uses + 1, last_used_at = now() WHERE id = _tok.id;
  UPDATE public.profiles SET active_tenant_id = _tok.tenant_id WHERE user_id = _uid;

  RETURN _tok.tenant_id;
END $function$;

-- Keep user-link lookups indexed while the original per-business unique constraint
-- continues to reject duplicate contacts, including concurrent acceptance races.
CREATE INDEX clients_linked_user_lookup_idx ON public.clients USING btree(linked_user_id) WHERE linked_user_id IS NOT NULL;
DROP INDEX public.clients_linked_user_id_unique;
COMMIT;
