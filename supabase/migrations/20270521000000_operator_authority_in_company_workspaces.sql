-- ============================================================================
-- Operator authority in company-owned workspaces (Option B, owner ruling 2026-09-29)
-- ============================================================================
-- RULING (the owner, verbatim substance): a person holding the platform operator role, acting
-- inside a company-owned system workspace, has owner authority there, with every action recorded
-- under that person's own identity. This applies to the role, never to a named account or email.
-- It never grants operators owner authority in any customer's workspace. A one-off owner row for
-- one account (Option A) is rejected.
--
-- WHAT THIS DOES
--   1. ADDS is_company_workspace(_tenant): a top-level standalone tenant whose features carry
--      system_workspace = true. Today that is exactly "Paige Operator Workspace" and "Paige
--      Platform Defaults" — both company-owned, neither a customer.
--   2. LOCKS that flag. Until now any tenant owner/admin — and any platform_admin through the
--      "Platform staff update tenants" policy — could write tenants.features, including
--      system_workspace. After this migration only the platform owner (super_admin) or a direct
--      server context with no request session at all (a migration, pg_cron) can set or clear it,
--      on insert or update. A service_role session is NOT trusted: an edge function acting for a
--      signed-in person (e.g. paige-mcp's update_tenant_features) runs as service_role with no
--      auth.uid(), and trusting it would let a delegated platform_admin mark a customer's
--      workspace as the company's. No edge function writes this key. Without this lock, rule 3 of
--      the ruling could be broken by anyone who can write a customer's features.
--   2b. LOCKS membership in a company workspace. Authority there comes from the operator role and
--      ends with it; nobody may seat themselves (or anyone) as a lasting owner/admin/member of a
--      company workspace — that would be Option A by another door, and it would survive losing
--      the role. Only the platform owner or the same direct server context may insert, change or
--      remove tenant_members rows for a company workspace. Production holds no such rows today.
--      Deliberate consequence: once the platform owner seats someone there, only the platform
--      owner (or a server context) can change or remove that seat — not the member, not an
--      operator, not a service-role offboarding path.
--   2c. REFUSES seat-creating invitations into a company workspace unless written by a direct
--      server context: every staff invitation (invitations) and every tenant_invite_tokens kind
--      except 'consumer'. A consumer (client portal) invite never creates a seat — accepting it
--      links a clients row and grants the client role — so contacts that arrive in a company
--      workspace (e.g. through its forms) can still be given portal access. The workspace is read
--      as COALESCE(NEW.tenant_id, current_user_tenant_id()), because invitations stamps an omitted
--      tenant_id in a later trigger. An invitation is accepted by the invitee, who is not
--      the platform owner, so it could only fail at acceptance (2b); refusing it when created is
--      the honest answer, and it closes the other door to a lasting seat (an operator minting an
--      invite for an account they control). The platform owner seats people directly
--      (grant_tenant_member_role). Production holds no such invitations today.
--   2d. sync_user_role_to_tenant_member keeps its prior outcome: it never seats anyone in a
--      company workspace on an operator's behalf (before this migration an operator was not an
--      admin there, so it skipped; now it skips explicitly). Without this, an operator whose
--      active workspace is the company's would fail to accept any invitation elsewhere.
--      Unchanged and allowed by 2b: when the PLATFORM OWNER grants a role while their active
--      workspace is a company workspace, the sync still seats the grantee there, as it always has.
--   3. WIDENS the four membership predicates, and only for a company workspace:
--        is_tenant_admin(_tenant)            OR (is_platform_operator() AND is_company_workspace)
--        is_tenant_member(_tenant)           OR (is_platform_operator() AND is_company_workspace)
--        is_tenant_admin_as(_actor,_tenant)  OR (is_platform_admin(_actor) AND is_company_workspace)
--        is_tenant_owner(_user,_tenant)      OR (_tenant given AND is_platform_admin(_user) AND company)
--      Every policy and function built on them follows (live count: is_tenant_admin 35 policies /
--      92 functions, is_tenant_member 59 policies / 37 functions). In a customer's workspace every
--      one of them returns exactly what it returned before: the added branch requires the tenant
--      to be a company workspace, which a customer can no longer mark it as (2).
--   4. create_contact_v2: its two inline owner/admin membership checks now call
--      is_tenant_admin_as — the same predicate they spelled out — so an operator creating a
--      contact in a company workspace (directly, or as the form processor's resolved operator on
--      the service path) is admitted, and a customer workspace is unchanged. Nothing else in the
--      function changes (it is copied from production's live definition, 2026-09-29).
--
-- IDENTITY: nothing here impersonates anyone. auth.uid() (or the actor the service path names) is
-- the operator's own user id; created_by, audit_logs.user_id and every downstream write record
-- that person.
--
-- NOT CHANGED (named so the boundary is visible): functions that read tenant_members directly
-- instead of these helpers keep member-only behaviour, e.g. deal-owner assignment in
-- configure_tenant_pipeline (PIPELINE_OWNER_INVALID), folder archive keyed on
-- tenants.owner_user_id, CRM command execution (execute_crm_command*), internal booking changes.
--
-- REVERSIBILITY: fully reversible and writes, moves and deletes no data. To revert: restore the
-- four predicates and create_contact_v2 to their prior definitions (quoted in this PR and in
-- 20260714235406 / 20260803190000 / 20270515010000), drop triggers trg_guard_company_workspace_flag
-- trg_guard_company_workspace_membership and both trg_guard_company_workspace_invitation, restore
-- sync_user_role_to_tenant_member (as last defined in 20270506000000; the prior body differs only in the
-- admin branch), and drop functions guard_company_workspace_flag(),
-- guard_company_workspace_membership(), guard_company_workspace_invitation(),
-- is_direct_server_context() and is_company_workspace(uuid).
-- ============================================================================

-- ── 1. What a company workspace is ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_company_workspace(_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants t
     WHERE t.id = _tenant
       AND t.parent_tenant_id IS NULL
       AND t.account_type = 'standalone'
       AND COALESCE(t.features -> 'system_workspace' = 'true'::jsonb, false)
  );
$$;
REVOKE ALL ON FUNCTION public.is_company_workspace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_company_workspace(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.is_company_workspace(uuid) IS
  'A company-owned system workspace: top-level, standalone, features.system_workspace = true. Only the platform owner can set that flag (trg_guard_company_workspace_flag).';

-- ── 2. Only the platform owner decides which workspaces are the company's ────
-- A direct server context: no request session of any kind (a migration, pg_cron, a psql session).
-- anon, authenticated and service_role sessions are all request sessions; service_role in
-- particular is how edge functions act for a signed-in person, so it is never trusted here.
-- NOTE: a SECURITY DEFINER function that clears request.jwt.claims inside itself becomes a direct
-- context and inherits this trust; today only operator_provision_tenant (platform-owner gated
-- first) and _n8n_cancel_on_workspace_switch (n8n tables only) do. Any new one must be reviewed.
CREATE OR REPLACE FUNCTION public.is_direct_server_context()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(auth.role(), '') NOT IN ('anon', 'authenticated', 'service_role');
$$;
REVOKE ALL ON FUNCTION public.is_direct_server_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_direct_server_context() TO authenticated, service_role;
COMMENT ON FUNCTION public.is_direct_server_context() IS
  'True only with no request session at all (migration, pg_cron). Never true for an anon, authenticated or service_role session.';

CREATE OR REPLACE FUNCTION public.guard_company_workspace_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Compared as JSON, so a malformed stored value can never make this trigger throw.
  _was boolean := TG_OP = 'UPDATE' AND COALESCE(OLD.features -> 'system_workspace' = 'true'::jsonb, false);
  _now boolean := COALESCE(NEW.features -> 'system_workspace' = 'true'::jsonb, false);
BEGIN
  IF _now IS NOT DISTINCT FROM _was THEN
    RETURN NEW;
  END IF;
  -- Trusted: the platform owner, or a direct server context. Not service_role (see header).
  IF NOT (public.is_platform_owner() OR public.is_direct_server_context()) THEN
    RAISE EXCEPTION 'TENANT_FORBIDDEN: only the platform owner can mark a workspace as company-owned'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_company_workspace_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_company_workspace_flag ON public.tenants;
CREATE TRIGGER trg_guard_company_workspace_flag
  BEFORE INSERT OR UPDATE OF features ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.guard_company_workspace_flag();

-- ── 2b. Membership in a company workspace is the platform owner's alone ───────
CREATE OR REPLACE FUNCTION public.guard_company_workspace_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tenant uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
BEGIN
  IF (public.is_company_workspace(_tenant)
      OR (TG_OP = 'UPDATE' AND public.is_company_workspace(OLD.tenant_id)))
     AND NOT (public.is_platform_owner() OR public.is_direct_server_context()) THEN
    RAISE EXCEPTION 'TENANT_FORBIDDEN: membership of a company workspace is managed by the platform owner; operators act there through their role'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_company_workspace_membership() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_company_workspace_membership ON public.tenant_members;
CREATE TRIGGER trg_guard_company_workspace_membership
  BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_company_workspace_membership();

-- ── 2c. A company workspace takes no invitations ─────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_company_workspace_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- A client portal invite creates no seat (see header 2c). Nested so NEW.kind is only read on
  -- the table that has it.
  IF TG_TABLE_NAME = 'tenant_invite_tokens' THEN
    IF NEW.kind = 'consumer' THEN
      RETURN NEW;
    END IF;
  END IF;
  -- On INSERT, invitations fills an omitted tenant_id in a later trigger (trg_stamp_tenant_id),
  -- so read the workspace it will land in. On UPDATE only the value written counts: a NULL there
  -- is the ON DELETE SET NULL of a tenant being deleted, never a move into a workspace.
  IF public.is_company_workspace(CASE WHEN TG_OP = 'INSERT'
                                      THEN COALESCE(NEW.tenant_id, public.current_user_tenant_id())
                                      ELSE NEW.tenant_id END)
     AND NOT public.is_direct_server_context() THEN
    RAISE EXCEPTION 'TENANT_FORBIDDEN: a company workspace does not take invitations; the platform owner adds people to it directly'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_company_workspace_invitation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_company_workspace_invitation ON public.tenant_invite_tokens;
CREATE TRIGGER trg_guard_company_workspace_invitation
  BEFORE INSERT OR UPDATE OF tenant_id ON public.tenant_invite_tokens
  FOR EACH ROW EXECUTE FUNCTION public.guard_company_workspace_invitation();
DROP TRIGGER IF EXISTS trg_guard_company_workspace_invitation ON public.invitations;
CREATE TRIGGER trg_guard_company_workspace_invitation
  BEFORE INSERT OR UPDATE OF tenant_id ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.guard_company_workspace_invitation();

-- ── 2d. Role sync never seats anyone in a company workspace for an operator ───
-- Production's live definition, with one change: the admin branch excludes a company workspace.
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

-- ── 3. Membership predicates: owner authority for operators, company workspaces only ──
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = auth.uid()
       AND status = 'active' AND role IN ('owner','admin')
  )
  OR (public.is_company_workspace(_tenant) AND public.is_platform_operator());
$function$;

CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = auth.uid() AND status = 'active'
  )
  OR (public.is_company_workspace(_tenant) AND public.is_platform_operator());
$function$;

CREATE OR REPLACE FUNCTION public.is_tenant_admin_as(_actor uuid, _tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = _actor
       AND status = 'active' AND role IN ('owner','admin')
  )
  OR (_actor IS NOT NULL AND public.is_company_workspace(_tenant) AND public.is_platform_admin(_actor));
$function$;

CREATE OR REPLACE FUNCTION public.is_tenant_owner(_user_id uuid, _tenant_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.user_id = _user_id
      AND tm.is_owner = true
      AND tm.status = 'active'
      AND (_tenant_id IS NULL OR tm.tenant_id = _tenant_id)
  )
  -- Only for a named company workspace: "owner of any tenant" (NULL) is never widened. And only
  -- when a person asks about themselves (or a server path asks), so this function never becomes
  -- a way for anyone to learn whether some other user id holds the operator role.
  OR (_tenant_id IS NOT NULL AND _user_id IS NOT NULL
      AND (COALESCE(_user_id = auth.uid(), false) OR COALESCE(auth.role(), '') <> ALL (ARRAY['anon', 'authenticated']))
      AND public.is_company_workspace(_tenant_id) AND public.is_platform_admin(_user_id));
$function$;

-- ── 4. create_contact_v2: its owner/admin checks use the shared predicate ─────
CREATE OR REPLACE FUNCTION public.create_contact_v2(p_first_name text, p_last_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_entity_name text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_lifecycle_stage text DEFAULT 'new_lead'::text, p_source text DEFAULT 'paige'::text, p_tags text[] DEFAULT '{}'::text[], p_primary_offer text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_assigned_coach_user_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid, p_created_by uuid DEFAULT NULL::uuid, p_channel text DEFAULT NULL::text)
 RETURNS TABLE(contact_id uuid, client_ref text, was_created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _creator uuid := CASE WHEN auth.uid() IS NOT NULL THEN auth.uid() ELSE p_created_by END;
  _tenant uuid := CASE WHEN auth.uid() IS NOT NULL THEN public.current_user_tenant_id() ELSE p_tenant_id END;
  _id uuid;
  _existing uuid;
  _ref text;
  _email text := NULLIF(btrim(p_email), '');
BEGIN
  IF _creator IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NO_OPERATOR' USING ERRCODE = '42501';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NO_TENANT' USING ERRCODE = '22023';
  END IF;
  IF _caller IS NOT NULL AND _creator IS DISTINCT FROM _caller THEN
    RAISE EXCEPTION 'CONTACT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Authenticated callers remain pinned to current_user_tenant_id(); supplied
  -- tenant and creator parameters never confer browser authority.
  -- is_tenant_admin_as is the active owner/admin membership test (plus, in a company-owned
  -- workspace only, the platform operator role — 20270521000000).
  IF _caller IS NOT NULL
     AND NOT public.is_platform_owner()
     AND NOT public.is_tenant_admin_as(_caller, _tenant) THEN
    RAISE EXCEPTION 'CONTACT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- The service path is actor-explicit. Re-authorize the creator/tenant pairing
  -- inside this SECURITY DEFINER boundary instead of trusting RPC parameters.
  IF _caller IS NULL
     AND NOT public.is_tenant_admin_as(_creator, _tenant) THEN
    RAISE EXCEPTION 'CONTACT_CREATOR_NOT_IN_TENANT' USING ERRCODE = '42501';
  END IF;

  -- A contact cannot be assigned to a foreign or revoked tenant seat.
  IF p_assigned_coach_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.tenant_members tm
       WHERE tm.tenant_id = _tenant
         AND tm.user_id = p_assigned_coach_user_id
         AND tm.status = 'active'
     ) THEN
    RAISE EXCEPTION 'CONTACT_COACH_NOT_IN_TENANT' USING ERRCODE = '42501';
  END IF;

  IF _email IS NOT NULL THEN
    _existing := public.client_id_for_address(_tenant, 'email', _email);
    IF _existing IS NOT NULL THEN
      SELECT account_number INTO _ref FROM public.clients WHERE id = _existing;
      contact_id := _existing;
      client_ref := _ref;
      was_created := false;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.clients (
      first_name, last_name, entity_name, title,
      lifecycle_stage, source, tags, primary_offer, current_notes,
      assigned_coach_user_id, status, created_by, tenant_id,
      created_by_channel_type
    ) VALUES (
      COALESCE(NULLIF(btrim(p_first_name), ''), NULLIF(split_part(COALESCE(_email, ''), '@', 1), ''), 'New'),
      COALESCE(NULLIF(btrim(p_last_name), ''), 'Contact'),
      NULLIF(btrim(p_entity_name), ''),
      NULLIF(btrim(p_title), ''),
      COALESCE(NULLIF(p_lifecycle_stage, ''), 'new_lead'),
      COALESCE(NULLIF(p_source, ''), 'paige'),
      COALESCE(p_tags, '{}'),
      NULLIF(btrim(p_primary_offer), ''),
      NULLIF(btrim(p_notes), ''),
      p_assigned_coach_user_id,
      'active',
      _creator,
      _tenant,
      NULLIF(btrim(p_channel), '')
    )
    RETURNING id, account_number INTO _id, _ref;
    -- Inside the block: a concurrent create of the same address loses on the methods' unique
    -- index, rolls its contact back, and returns the one that won.
    PERFORM public._attach_client_address(_tenant, _id, 'email', _email);
    PERFORM public._attach_client_address(_tenant, _id, 'phone', p_phone);
  EXCEPTION WHEN unique_violation THEN
    _existing := public.client_id_for_address(_tenant, 'email', _email);
    IF _existing IS NOT NULL THEN
      SELECT account_number INTO _ref FROM public.clients WHERE id = _existing;
      contact_id := _existing;
      client_ref := _ref;
      was_created := false;
      RETURN NEXT;
      RETURN;
    END IF;
    RAISE;
  END;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (
    _creator,
    'client',
    'create_contact',
    _id,
    jsonb_build_object(
      'tenant_id', _tenant,
      'source', p_source,
      'channel', p_channel
    )
  );

  contact_id := _id;
  client_ref := _ref;
  was_created := true;
  RETURN NEXT;
  RETURN;
END;
$function$;
