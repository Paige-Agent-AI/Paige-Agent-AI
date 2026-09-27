-- No row may hold the retired title role.
--
-- "Coach" is a title a business gives its people. It never grants permission, and the value is
-- retired from the platform, not from one table: every column that stores a platform role or a
-- business seat refuses it, and the tenant grant function refuses it by name.
--
-- Rows holding the value on production when this was written: user_roles 4, every other column 0.
-- The user_roles constraint is therefore added NOT VALID: it refuses every new write now and is
-- validated once the four legacy rows are deleted (slice 5). Every other constraint is validated
-- here. No row is changed or deleted by this migration.
--
-- grant_tenant_member_role is the production body with two changes: it refuses the value before any
-- write, and its seat-upgrade branch for the value is removed (the seat it produced can no longer be
-- stored). Name, signature, settings and grants are unchanged.
--
-- The enum value itself is not removed here; rebuilding both enums without it is filed separately.
--
-- Applied as one statement, so production takes all of it or none of it, with a short lock wait so a
-- blocked attempt fails the deploy instead of holding up other queries.
SET lock_timeout = '10s';

DO $migration$
BEGIN
  ALTER TABLE public.user_roles
    ADD CONSTRAINT user_roles_role_not_retired_title_role
    CHECK (role IS DISTINCT FROM 'coach'::public.app_role) NOT VALID;

  ALTER TABLE public.invitations
    ADD CONSTRAINT invitations_role_not_retired_title_role
    CHECK (role IS DISTINCT FROM 'coach'::public.app_role);

  ALTER TABLE public.platform_invites
    ADD CONSTRAINT platform_invites_role_not_retired_title_role
    CHECK (role IS DISTINCT FROM 'coach'::public.app_role);

  ALTER TABLE public.tenant_members
    ADD CONSTRAINT tenant_members_role_not_retired_title_role
    CHECK (role IS DISTINCT FROM 'coach'::public.tenant_role);

  ALTER TABLE public.tenant_invite_tokens
    ADD CONSTRAINT tenant_invite_tokens_default_role_not_retired_title_role
    CHECK (default_role IS DISTINCT FROM 'coach'::public.tenant_role);

  ALTER TABLE public.paige_approval_policies
    ADD CONSTRAINT paige_approval_policies_auto_assign_role_not_retired_title_role
    CHECK (auto_assign_role IS DISTINCT FROM 'coach'::public.app_role);

  ALTER TABLE public.paige_approval_policies
    ADD CONSTRAINT paige_approval_policies_requires_role_not_retired_title_role
    CHECK (requires_role IS DISTINCT FROM 'coach'::public.app_role);

  ALTER TABLE public.paige_approval_policies
    ADD CONSTRAINT paige_approval_policies_visible_to_roles_not_retired_title_role
    CHECK (NOT ('coach'::public.app_role = ANY (COALESCE(visible_to_roles, '{}'::public.app_role[]))));

  ALTER TABLE public.paige_pending_approvals
    ADD CONSTRAINT paige_pending_approvals_requires_role_not_retired_title_role
    CHECK (requires_role IS DISTINCT FROM 'coach'::public.app_role);

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

    _tenant_role := public.map_app_role_to_tenant_role(_role);

    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;

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
END
$migration$;

RESET lock_timeout;
