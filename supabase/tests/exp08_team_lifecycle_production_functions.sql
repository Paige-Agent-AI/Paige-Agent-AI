-- Production function bodies for the EXP08 team lifecycle proof (supabase/tests/exp08_team_lifecycle.sql).
-- Copied verbatim from the linked project's pg_get_functiondef on 2026-10-26 (read-only catalog read).
-- The proof asserts md5(prosrc) of every one against the production value before the migration runs,
-- so a drifted copy fails the proof rather than proving something about a body production never had.
-- Not a migration: nothing here is applied anywhere but the proof's disposable database.
--
-- EXCEPT three bodies that admin scope stage 0 (migration 20271115030008, merged before this change and
-- applied to production before 20271115040008 sorts after it) redefines or adds: grant_tenant_member_role,
-- change_user_role and their new helper is_workspace_admin. Those are copied verbatim from that migration
-- (function text byte-identical to 20271115030008's, including is_workspace_admin's REVOKE/GRANT/COMMENT),
-- because they are what the lifecycle migration will meet in production, and the proof pins their
-- md5(prosrc) to the stage-0 body instead of the 2026-10-26 production one. Stage 0 re-emits both role
-- functions with CREATE OR REPLACE, which keeps production's EXECUTE grants; the GRANT lines after them
-- are production's. Stage 0 redefines no other object this file or the proof embeds.
--
-- Why each is here:
--   grant_tenant_member_role, change_user_role, revoke_tenant_member_role — role functions executable
--     by authenticated that write status = 'active' onto an EXISTING seat (ON CONFLICT DO UPDATE or
--     UPDATE). Review showed each could lift a suspension; the proof drives each one.
--   agency_enter_subaccount(uuid) — re-seats the caller themselves as active (ON CONFLICT DO UPDATE).
--   accept_tenant_invite — its generic branch re-seats the caller as active, and it still accepts a
--     kind = 'team' token; the migration re-emits it to carry Team conversations from the invitation.
--   create_solo_team_invite, resend_solo_team_invite, solo_team_invite_authority — the Settings → Team
--     invitation path the migration extends.
--   has_role, is_super_admin(uuid), map_app_role_to_tenant_role — what those bodies call.
--   sync_user_role_to_tenant_member, enforce_protected_role_grant, prevent_owner_admin_removal and
--     their three triggers on user_roles — production's user_roles trigger set (review round 3), so a
--     global-role write here behaves as it does in production (X6/X7 drive it).
CREATE OR REPLACE FUNCTION public.grant_tenant_member_role(_user_id uuid, _role app_role, _tenant_id uuid DEFAULT NULL::uuid, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    _caller uuid := auth.uid();
    _resolved_tenant uuid;
    _tenant_role public.tenant_role;
    _protected public.app_role[] := ARRAY['super_admin','platform_admin','developer']::public.app_role[];
    _global_ok boolean;
  BEGIN
    IF _caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
    -- "Coach" is a title a business gives its people, never a role anyone is granted.
    IF _role = 'coach'::public.app_role THEN
      RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: coach is a title, never a role' USING ERRCODE = '42501';
    END IF;
    _resolved_tenant := COALESCE(_tenant_id, public.current_user_tenant_id());
    IF _resolved_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant context'; END IF;
    IF NOT (public.is_platform_owner() OR public.is_tenant_admin(_resolved_tenant)) THEN
      RAISE EXCEPTION 'Tenant admin privileges required';
    END IF;
    IF NOT public.is_platform_owner() AND _role = ANY(_protected) THEN
      RAISE EXCEPTION 'Cannot grant a platform-operator role here (owner-only)'
        USING ERRCODE = '42501';
    END IF;
    -- A role a row in platform_operator_roles makes an operator tier is refused here too, with the
    -- lockdown's own error. Production relied on the user_roles trigger for this, but below a person
    -- not active in this workspace gets no global row at all, so that trigger would never fire and
    -- the refusal would turn into a silent pending seat.
    IF NOT public.is_platform_owner()
       AND EXISTS (SELECT 1 FROM public.platform_operator_roles r WHERE r.role = _role::text) THEN
      RAISE EXCEPTION
        'PROTECTED_ROLE_GRANT_FORBIDDEN: role "%" (a platform-operator tier) may be granted or revoked only by an existing super_admin or a trusted service context (§53).', _role
        USING ERRCODE = '42501';
    END IF;

    _tenant_role := public.map_app_role_to_tenant_role(_role);

    -- STAGE 0: 'admin' is a seat, never a global row minted here. Any other role becomes a global
    -- row only for a person already active in this workspace, or on a platform-operator path. Read
    -- BEFORE the seat write below, which would otherwise make the target look active.
    _global_ok := public.is_platform_owner()
      OR (public.is_company_workspace(_resolved_tenant) AND public.is_platform_operator())
      OR EXISTS (SELECT 1 FROM public.tenant_members m
                  WHERE m.tenant_id = _resolved_tenant AND m.user_id = _user_id AND m.status = 'active');
    IF _role <> 'admin'::public.app_role AND _global_ok THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role)
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;

    INSERT INTO public.tenant_members (tenant_id, user_id, role, status, invited_at, joined_at)
    VALUES (_resolved_tenant, _user_id, _tenant_role, 'active', now(), now())
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET role = CASE
            WHEN public.tenant_members.role = 'owner'::public.tenant_role THEN public.tenant_members.role
            WHEN EXCLUDED.role = 'admin'::public.tenant_role THEN 'admin'::public.tenant_role
            ELSE public.tenant_members.role
          END,
          status = 'active',
          joined_at = COALESCE(public.tenant_members.joined_at, now()),
          updated_at = now();

    INSERT INTO public.profiles (user_id) VALUES (_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE public.profiles SET active_tenant_id = _resolved_tenant
     WHERE user_id = _user_id AND (active_tenant_id IS NULL OR public.is_platform_owner());

    INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
    VALUES (_caller, 'tenant_member', 'grant_tenant_member_role', _user_id,
            jsonb_build_object('tenant_id', _resolved_tenant, 'role', _role, 'reason', _reason));

    INSERT INTO public.paige_audit_log
      (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
    VALUES (_caller, 'admin', 'role:grant', 'user_role', _user_id,
            jsonb_build_object('to_role', _role, 'tenant_id', _resolved_tenant, 'reason', _reason),
            _resolved_tenant);
  END;
  $function$;
GRANT EXECUTE ON FUNCTION public.grant_tenant_member_role(uuid, app_role, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _tenant IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND (
       EXISTS (
         SELECT 1 FROM public.tenant_members m
          WHERE m.tenant_id = _tenant
            AND m.user_id = auth.uid()
            AND m.status = 'active'
            AND m.role IN ('owner','admin')
       )
       OR public.agency_can_manage_child(_tenant, auth.uid())
     );
$function$;
REVOKE ALL ON FUNCTION public.is_workspace_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.is_workspace_admin(uuid) IS
  'Caller (auth.uid()) is an active owner/admin of _tenant, or an agency managing _tenant lets them manage it. '
  'No platform-operator branch (unlike is_tenant_admin). Owner ruling 2026-10-26, migration 20271115030008.';

CREATE OR REPLACE FUNCTION public.change_user_role(_target_user_id uuid, _from_role app_role, _to_role app_role, _tenant_id uuid DEFAULT NULL::uuid, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _resolved_tenant uuid;
  _is_owner_call boolean := public.is_platform_owner();
  _is_admin_call boolean;
  _target_is_owner boolean;
  _tenant_role public.tenant_role;
  _protected public.app_role[] := ARRAY['admin','super_admin','platform_admin']::public.app_role[];
  _operator_path boolean;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'ROLE_CHANGE_UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  _resolved_tenant := COALESCE(_tenant_id, public.current_user_tenant_id());
  IF _resolved_tenant IS NULL THEN
    RAISE EXCEPTION 'ROLE_CHANGE_NO_TENANT' USING ERRCODE = '22023';
  END IF;

  -- STAGE 0: was "is_tenant_admin(_resolved_tenant) OR has_role(_caller, 'admin')".
  _is_admin_call := public.is_tenant_admin(_resolved_tenant) OR public.is_workspace_admin(_resolved_tenant);

  IF NOT (_is_owner_call OR _is_admin_call) THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: admin privileges required' USING ERRCODE = '42501';
  END IF;

  IF NOT _is_owner_call AND (_from_role = ANY(_protected) OR _to_role = ANY(_protected)) THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: cannot modify admin or super_admin (owner-only)'
      USING ERRCODE = '42501';
  END IF;

  IF _to_role = 'coach'::public.app_role THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: coach is a title, never a role' USING ERRCODE = '42501';
  END IF;

  IF _to_role = 'super_admin'::public.app_role THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: super_admin is bootstrap-only' USING ERRCODE = '42501';
  END IF;

  -- STAGE 0: only the workspace's own active people. The platform-operator paths are unchanged.
  _operator_path := _is_owner_call
    OR (public.is_company_workspace(_resolved_tenant) AND public.is_platform_operator());
  IF NOT _operator_path AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members m
     WHERE m.tenant_id = _resolved_tenant AND m.user_id = _target_user_id AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: this person is not an active member of this workspace'
      USING ERRCODE = '42501';
  END IF;

  -- FIX-2 (§9, Slice A Option 1): read the authoritative is_owner signal, NOT the
  -- display-only tenants.owner_user_id, and REFUSE any role change on a tenant owner
  -- (incl. a grant_co_owner co-owner). Ownership mutates ONLY via revoke_co_owner().
  _target_is_owner := public.is_tenant_owner(_target_user_id, _resolved_tenant);
  IF _target_is_owner THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: this member is a tenant owner; use revoke_co_owner() to change ownership'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _target_user_id AND role = _from_role;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_target_user_id, _to_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  BEGIN
    _tenant_role := public.map_app_role_to_tenant_role(_to_role);
    INSERT INTO public.tenant_members (tenant_id, user_id, role, status, invited_at, joined_at)
    VALUES (_resolved_tenant, _target_user_id, _tenant_role, 'active', now(), now())
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET role = EXCLUDED.role, status = 'active', updated_at = now()
      WHERE public.tenant_members.role <> 'owner'::public.tenant_role;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.paige_audit_log
      (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
    VALUES (
      _caller,
      CASE WHEN _is_owner_call THEN 'super_admin' ELSE 'admin' END,
      'role:change:mirror_failed', 'user_role', _target_user_id,
      jsonb_build_object(
        'from_role', _from_role,
        'to_role', _to_role,
        'tenant_id', _resolved_tenant,
        'error_message', SQLERRM,
        'error_code', SQLSTATE
      ),
      _resolved_tenant
    );
  END;

  INSERT INTO public.paige_audit_log
    (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
  VALUES (
    _caller,
    CASE WHEN _is_owner_call THEN 'super_admin' ELSE 'admin' END,
    'role:change', 'user_role', _target_user_id,
    jsonb_build_object('from_role', _from_role, 'to_role', _to_role,
                       'tenant_id', _resolved_tenant, 'reason', _reason),
    _resolved_tenant
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.change_user_role(uuid, app_role, app_role, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_tenant_member_role(_user_id uuid, _role app_role, _tenant_id uuid DEFAULT NULL::uuid, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _resolved_tenant uuid;
  _is_owner_call boolean := public.is_platform_owner();
  _is_admin_call boolean;
  _target_is_tenant_owner boolean;
  _admin_count int;
  _new_role public.tenant_role;
  _protected public.app_role[] := ARRAY['admin','super_admin','platform_admin']::public.app_role[];
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: authentication required' USING ERRCODE = '42501';
  END IF;
  _resolved_tenant := COALESCE(_tenant_id, public.current_user_tenant_id());
  IF _resolved_tenant IS NULL THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: no active tenant context' USING ERRCODE = '22023';
  END IF;
  -- §9/#117: drop the global has_role('admin') OR — authorize strictly on the
  -- RESOLVED tenant (is_tenant_admin) or the platform-owner branch below.
  _is_admin_call := public.is_tenant_admin(_resolved_tenant);
  IF NOT (_is_owner_call OR _is_admin_call) THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: admin privileges required' USING ERRCODE = '42501';
  END IF;

  -- FIX-2 (§9): refuse to modify a tenant owner here; ownership changes go through
  -- revoke_co_owner() exclusively (prevents an is_owner/role lockstep break).
  IF public.is_tenant_owner(_user_id, _resolved_tenant) THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: this member is a tenant owner; use revoke_co_owner() to change ownership'
      USING ERRCODE = '42501';
  END IF;

  IF NOT _is_owner_call AND _role = ANY(_protected) THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: cannot modify admin or super_admin (owner-only)' USING ERRCODE = '42501';
  END IF;
  -- The retired title role is a value no row may hold; refuse it before the seat resync below.
  IF _role = 'coach'::public.app_role THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: coach is a title, never a role' USING ERRCODE = '42501';
  END IF;
  IF _role = 'admin'::public.app_role THEN
    IF public.is_super_admin(_user_id) THEN
      RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: cannot remove admin from the platform owner' USING ERRCODE = '42501';
    END IF;
    -- FIX-2: migrated off tenants.owner_user_id (now redundant with the early owner-refuse
    -- above, but kept so no authz predicate reads the display-only column).
    _target_is_tenant_owner := public.is_tenant_owner(_user_id, _resolved_tenant);
    IF _target_is_tenant_owner THEN
      RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: the tenant owner cannot lose admin' USING ERRCODE = '42501';
    END IF;
    SELECT count(*) INTO _admin_count FROM public.user_roles WHERE role = 'admin'::public.app_role;
    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'LAST_ADMIN: at least one admin must remain' USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;

  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin'::public.app_role)
      THEN 'admin'::public.tenant_role
    WHEN EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id
         AND role = ANY(ARRAY['sales_rep','broker','cs_rep','finance','viewer','moderator','affiliate']::public.app_role[])
    ) THEN 'member'::public.tenant_role
    ELSE NULL
  END INTO _new_role;

  IF _new_role IS NULL THEN
    UPDATE public.tenant_members SET status = 'revoked', updated_at = now()
     WHERE tenant_id = _resolved_tenant AND user_id = _user_id AND role <> 'owner'::public.tenant_role;
  ELSE
    UPDATE public.tenant_members SET role = _new_role, status = 'active', updated_at = now()
     WHERE tenant_id = _resolved_tenant AND user_id = _user_id AND role <> 'owner'::public.tenant_role;
  END IF;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'tenant_member', 'revoke_tenant_member_role', _user_id,
          jsonb_build_object('tenant_id', _resolved_tenant, 'role', _role, 'reason', _reason));
  INSERT INTO public.paige_audit_log
    (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
  VALUES (_caller, CASE WHEN _is_owner_call THEN 'super_admin' ELSE 'admin' END,
          'role:revoke_one', 'user_role', _user_id,
          jsonb_build_object('role', _role, 'tenant_id', _resolved_tenant, 'reason', _reason),
          _resolved_tenant);
  RETURN jsonb_build_object('ok', true);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.revoke_tenant_member_role(uuid, app_role, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.agency_enter_subaccount(_child uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.agency_can_manage_child(_child, auth.uid()) THEN
    RAISE EXCEPTION 'agency_scope_forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, joined_at)
  VALUES (_child, auth.uid(), 'admin', 'active', now())
  ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET status = 'active',
        role   = (CASE WHEN tenant_members.role = 'owner' THEN 'owner' ELSE 'admin' END)::public.tenant_role;

  UPDATE public.profiles SET active_tenant_id = _child WHERE user_id = auth.uid();

  RETURN jsonb_build_object(
    'active_tenant_id', _child,
    'name',             (SELECT name FROM public.tenants WHERE id = _child)
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.agency_enter_subaccount(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin'::public.app_role); $function$;

CREATE OR REPLACE FUNCTION public.map_app_role_to_tenant_role(_app_role app_role)
 RETURNS tenant_role
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
    SELECT CASE _app_role
      WHEN 'admin'::public.app_role THEN 'admin'::public.tenant_role
      ELSE 'member'::public.tenant_role
    END
  $function$;

CREATE OR REPLACE FUNCTION public.solo_team_invite_authority(_actor uuid, _expected_tenant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _tenant uuid;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'not authorized to manage team invitations' USING ERRCODE = '42501';
  END IF;

  -- The workspace must be NAMED. Falling back to a guess is the defect this function exists to end,
  -- so an unnamed workspace is a refusal rather than an invitation to choose one.
  IF _expected_tenant_id IS NULL THEN
    RAISE EXCEPTION 'the workspace for this invitation was not named' USING ERRCODE = '42501';
  END IF;

  -- Authority is proved in THAT EXACT workspace. This is the whole guard: no COALESCE, no ORDER BY,
  -- no LIMIT, nothing that could resolve to a different workspace than the one passed in.
  SELECT tm.tenant_id INTO _tenant
  FROM public.tenant_members tm
  WHERE tm.tenant_id = _expected_tenant_id
    AND tm.user_id = _actor
    AND tm.status = 'active'
    AND (tm.is_owner OR tm.role IN ('owner'::public.tenant_role, 'admin'::public.tenant_role));

  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'only an owner or admin may manage team invitations in that workspace'
      USING ERRCODE = '42501';
  END IF;

  RETURN _tenant;
END;
$function$;
REVOKE ALL ON FUNCTION public.solo_team_invite_authority(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_solo_team_invite(_actor uuid, _expected_tenant_id uuid, _email text, _permission text DEFAULT 'member'::text, _job_title text DEFAULT NULL::text, _responsibilities text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _tenant uuid;
  _token text;
  _row public.tenant_invite_tokens;
BEGIN
  _tenant := public.solo_team_invite_authority(_actor, _expected_tenant_id);

  IF lower(trim(_permission)) NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'team invitations may grant only Admin or Member';
  END IF;
  IF NULLIF(lower(trim(_email)), '') IS NULL OR trim(_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'a valid email address is required';
  END IF;
  IF char_length(COALESCE(trim(_job_title), '')) > 120 OR char_length(COALESCE(trim(_responsibilities), '')) > 2000 THEN
    RAISE EXCEPTION 'work profile is too long';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    JOIN auth.users au ON au.id = tm.user_id
    WHERE tm.tenant_id = _tenant AND lower(au.email) = lower(trim(_email))
  ) THEN
    RAISE EXCEPTION 'this person already belongs to the workspace';
  END IF;

  -- One live invitation per tenant/email. Replacing a pending invite makes its
  -- previous token unusable before the new token is returned.
  UPDATE public.tenant_invite_tokens
  SET revoked_at = now(), updated_at = now()
  WHERE tenant_id = _tenant AND kind = 'team'
    AND lower(email) = lower(trim(_email))
    AND uses = 0 AND revoked_at IS NULL AND expires_at > now();

  _token := replace(replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', '');
  INSERT INTO public.tenant_invite_tokens
    (tenant_id, token, kind, default_role, created_by, expires_at, max_uses, email, job_title, responsibilities)
  VALUES
    (_tenant, _token, 'team', lower(trim(_permission))::public.tenant_role, _actor,
     now() + interval '7 days', 1, lower(trim(_email)), NULLIF(trim(_job_title), ''), NULLIF(trim(_responsibilities), ''))
  RETURNING * INTO _row;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'tenant_invite', 'team_invite_created', _row.id,
          jsonb_build_object('tenant_id', _tenant, 'permission', lower(trim(_permission))));
  -- `tenant_id` is returned so the caller can prove the invitation landed where it asked. A screen
  -- that sent workspace A and is handed back workspace B has been redirected, and should say so
  -- rather than report a success it cannot vouch for.
  RETURN jsonb_build_object('id', _row.id, 'token', _token, 'email', _row.email,
                            'expires_at', _row.expires_at, 'tenant_id', _tenant);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_solo_team_invite(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_solo_team_invite(uuid, uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.resend_solo_team_invite(_actor uuid, _expected_tenant_id uuid, _invite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _tenant uuid;
  _old public.tenant_invite_tokens;
BEGIN
  _tenant := public.solo_team_invite_authority(_actor, _expected_tenant_id);

  -- `tenant_id = _tenant` is what makes an invitation in another workspace invisible here rather
  -- than merely forbidden: a resend cannot reach across a workspace boundary even by id.
  SELECT * INTO _old FROM public.tenant_invite_tokens
  WHERE id = _invite_id AND tenant_id = _tenant AND kind = 'team' FOR UPDATE;
  IF _old.id IS NULL THEN RAISE EXCEPTION 'team invitation not found'; END IF;
  IF _old.uses > 0 THEN RAISE EXCEPTION 'an accepted invitation cannot be resent'; END IF;
  UPDATE public.tenant_invite_tokens SET revoked_at = COALESCE(revoked_at, now()), updated_at = now() WHERE id = _old.id;
  -- The re-entry carries the SAME proved workspace, so a resend can never resolve differently from
  -- the create it delegates to.
  RETURN public.create_solo_team_invite(_actor, _tenant, _old.email, _old.default_role::text, _old.job_title, _old.responsibilities);
END;
$function$;
REVOKE ALL ON FUNCTION public.resend_solo_team_invite(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resend_solo_team_invite(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.accept_tenant_invite(_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    PERFORM 1 FROM public.tenants WHERE id = _tok.tenant_id AND status = 'active' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501'; END IF;
    IF _tok.expires_at <= pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'invite has expired'; END IF;
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
REVOKE ALL ON FUNCTION public.accept_tenant_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_tenant_invite(text) TO authenticated, service_role;

-- The three user_roles triggers production carries (pg_trigger, 2026-10-26), added by review round 3:
-- without them the proof's trigger set was not production's. sync_user_role_to_tenant_member writes a
-- seat in the CALLER's current workspace when a global role is granted; enforce_protected_role_grant
-- holds the platform-operator roles; prevent_owner_admin_removal (trigger protect_owner_admin) keeps
-- the platform owner's 'admin'. Production's two other user_roles triggers, trg_auto_enroll_affiliate
-- (affiliate only) and trg_guard_last_super_admin (super_admin only), touch no role this proof writes.
CREATE OR REPLACE FUNCTION public.sync_user_role_to_tenant_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    _tenant_id uuid;
    _tenant_role public.tenant_role;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

    IF NEW.role = 'super_admin'::public.app_role THEN
      RETURN NEW;
    END IF;

    _tenant_id := public.current_user_tenant_id();
    IF _tenant_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- An operator's authority in a company workspace is the role's, not a seat (20270521000000).
    IF NOT (public.is_platform_owner()
            OR (public.is_tenant_admin(_tenant_id) AND NOT public.is_company_workspace(_tenant_id))) THEN
      RETURN NEW;
    END IF;

    _tenant_role := public.map_app_role_to_tenant_role(NEW.role);

    INSERT INTO public.tenant_members (tenant_id, user_id, role, status, invited_at, joined_at)
    VALUES (_tenant_id, NEW.user_id, _tenant_role, 'active', now(), now())
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
       SET active_tenant_id = _tenant_id
     WHERE user_id = NEW.user_id
       AND active_tenant_id IS NULL;

    RETURN NEW;
  END;
  $function$;

CREATE OR REPLACE FUNCTION public.enforce_protected_role_grant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _jwt_role text := auth.role();  -- 'authenticated' | 'anon' | 'service_role' | NULL (direct/no-JWT)
  _touched text[];
  _role_txt text;
BEGIN
  _touched := CASE TG_OP
    WHEN 'INSERT' THEN ARRAY[NEW.role::text]
    WHEN 'DELETE' THEN ARRAY[OLD.role::text]
    ELSE ARRAY[OLD.role::text, NEW.role::text]
  END;
  FOREACH _role_txt IN ARRAY _touched LOOP
    IF _role_txt IN ('super_admin', 'platform_admin')
       OR EXISTS (SELECT 1 FROM public.platform_operator_roles r WHERE r.role = _role_txt) THEN
      -- Allowed writers: (a) an existing platform owner (super_admin) acting via a verified JWT, OR
      -- (b) a trusted server context — a service_role API caller, or a direct no-JWT connection
      -- (migration / pg_cron / superuser / the auth service), where auth.role() is 'service_role' or
      -- NULL. A genuine authenticated/anon JWT that is NOT the platform owner is REFUSED. coalesce
      -- maps the no-JWT NULL to 'service' so it is treated as trusted.
      IF NOT (
           public.is_platform_owner()
        OR coalesce(_jwt_role, 'service') NOT IN ('authenticated', 'anon')
      ) THEN
        RAISE EXCEPTION
          'PROTECTED_ROLE_GRANT_FORBIDDEN: role "%" (a platform-operator tier) may be granted or revoked only by an existing super_admin or a trusted service context (§53).', _role_txt
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_owner_admin_removal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  owner_email text;
  owner_id uuid;
begin
  select o.owner_email into owner_email from public.app_settings_owner o limit 1;
  if owner_email is null then
    return coalesce(new, old);
  end if;

  select id into owner_id from auth.users where email = owner_email limit 1;

  if tg_op in ('DELETE','UPDATE')
     and old.role = 'admin'::public.app_role
     and old.user_id = owner_id then
    raise exception 'Cannot remove admin role from platform owner';
  end if;

  return coalesce(new, old);
end;
$function$;

CREATE TRIGGER protect_owner_admin BEFORE DELETE OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION prevent_owner_admin_removal();
CREATE TRIGGER trg_enforce_protected_role_grant BEFORE INSERT OR DELETE OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION enforce_protected_role_grant();
CREATE TRIGGER trg_sync_user_role_to_tenant_member AFTER INSERT OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION sync_user_role_to_tenant_member();
