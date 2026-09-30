-- No row holds the retired title role, and the paths that removed it are gone.
--
-- "Coach" is a title a business gives its people, never a role. 20270508000000 forbade the value on
-- every role and seat column; the platform-role constraint was added NOT VALID because four legacy
-- platform-role rows still held it. This deletes them, validates the constraint, and removes what
-- existed only to remove the value.
--
-- DESTRUCTIVE — authorized in writing by Antonio Cook (coach removal ruling (c)), for exactly this
-- deletion and nothing else.
--
-- BLAST RADIUS, measured on production before this migration was written (counts only):
--   * 4 rows in public.user_roles with role 'coach', and no other row anywhere is deleted;
--   * every one of the 4 holders also holds the admin platform role and an active business seat, so
--     no one loses access to anything: the deleted value already granted nothing (20270509000000);
--   * 0 active client assignments name any of the 4 holders;
--   * 0 foreign keys reference public.user_roles, so nothing cascades;
--   * the three delete triggers on public.user_roles concern other roles and let these rows go:
--     protect_owner_admin and trg_guard_last_super_admin concern the admin and super_admin roles;
--     trg_enforce_protected_role_grant (20270510000000) concerns the operator tiers, which the value
--     is not, and admits a migration's trusted context in any case.
-- The deletion refuses to run if more than 4 rows hold the value, so it can never remove more than
-- was measured. A rebuilt database holds none and deletes nothing.
--
-- Then:
--   1. user_roles_role_not_retired_title_role is validated: no stored row can hold the value.
--   2. admin_remove_coach_role(uuid) is dropped. Its only caller, the operator tool
--      remove_coach_role, is removed in the same change.
--   3. revoke_platform_access (both overloads) no longer lists the value among the roles it deletes.
--   4. revoke_tenant_member_role loses its active-clients check for the value and its branch mapping
--      a remaining platform role of that value to a seat, and refuses the value by name before it
--      writes anything, as grant_tenant_member_role does. Without the refusal, revoking the value
--      would delete nothing and then resync the target's seat, revoking the membership of a person
--      who holds no other platform role.
-- Every other line of the three redefined functions is production's current body, unchanged.
-- Signatures, security, settings and grants are unchanged; CREATE OR REPLACE keeps the grants.
--
-- Applied as one statement, so production takes all of it or none of it, with a short lock wait so
-- a blocked attempt fails the deploy instead of holding up other queries.
SET lock_timeout = '10s';

DO $migration$
DECLARE
  _held int;
BEGIN

SELECT count(*) INTO _held FROM public.user_roles WHERE role::text = 'coach';
IF _held > 4 THEN
  RAISE EXCEPTION 'retired title role: % rows hold the value, more than the 4 authorized for deletion', _held;
END IF;
DELETE FROM public.user_roles WHERE role::text = 'coach';

ALTER TABLE public.user_roles VALIDATE CONSTRAINT user_roles_role_not_retired_title_role;

DROP FUNCTION public.admin_remove_coach_role(uuid);

CREATE OR REPLACE FUNCTION public.revoke_platform_access(_user_id uuid, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _revoked_roles text[];
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_platform_owner()) THEN
    RAISE EXCEPTION 'Platform-operator privileges required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.app_settings_owner o
    JOIN auth.users u ON u.email = o.owner_email WHERE u.id = _user_id
  ) THEN
    RAISE EXCEPTION 'Cannot revoke platform owner';
  END IF;

  SELECT array_agg(role::text) INTO _revoked_roles FROM public.user_roles
   WHERE user_id = _user_id
     AND role::text IN ('admin','sales_rep','broker','broker_team_member','cs_rep','finance','viewer','moderator','owner');

  DELETE FROM public.user_roles
   WHERE user_id = _user_id
     AND role::text IN ('admin','sales_rep','broker','broker_team_member','cs_rep','finance','viewer','moderator','owner');
  DELETE FROM public.tenant_members WHERE user_id = _user_id;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (auth.uid(), 'user', 'revoke_platform_access', _user_id,
          jsonb_build_object('revoked_by', auth.uid(), 'reason', _reason));

  INSERT INTO public.paige_audit_log
    (actor_user_id, actor_role, action, target_type, target_id, payload)
  VALUES (auth.uid(), 'admin', 'role:revoke', 'user_role', _user_id,
          jsonb_build_object('revoked_roles', COALESCE(_revoked_roles, ARRAY[]::text[]), 'reason', _reason));
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_platform_access(_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_platform_owner()) THEN
    RAISE EXCEPTION 'Platform-operator privileges required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.app_settings_owner o
    JOIN auth.users u ON u.email = o.owner_email WHERE u.id = _user_id
  ) THEN
    RAISE EXCEPTION 'Cannot revoke platform owner';
  END IF;
  DELETE FROM public.user_roles
   WHERE user_id = _user_id
     AND role::text IN ('admin','sales_rep','broker','broker_team_member','cs_rep','finance','viewer','moderator','owner');
  DELETE FROM public.tenant_members WHERE user_id = _user_id;
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (auth.uid(), 'user', 'revoke_platform_access', _user_id,
          jsonb_build_object('revoked_by', auth.uid()));
END;
$function$;

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

END
$migration$;

RESET lock_timeout;
