-- ============================================================================
-- EXP08 — co-owner authority: only the ACCOUNT HOLDER (or the platform owner) grants or revokes
-- co-ownership. Additive; changes no data.
--
-- LIVE DEFECT (production, verified 2026-10-26). grant_co_owner / revoke_co_owner gated on
-- `public.is_tenant_owner(_caller, _tenant) OR _is_platform`. is_tenant_owner is true for EVERY
-- active owner seat, so any co-owner could mint further co-owners and could revoke the account
-- holder of record (tenants.owner_user_id), demoting them to admin. The last-owner floor only
-- protects the final owner. Production md5(prosrc) before this change:
--   grant_co_owner  b62661d7311288ffa7852da832f86013
--   revoke_co_owner 8b1cb22a4e244fb53695a40bd8f63226
-- Both match their last repo definition, 20260803190000_slice_a_multi_owner_is_owner.sql
-- L241-361 (no later migration re-emits either function).
--
-- OWNER DIRECTION (provisional default, pending confirmation in a later design): only the account
-- holder of record may grant or revoke co-ownership; co-owners cannot act on each other or on the
-- account holder. The platform owner path (is_platform_owner(), super_admin) stays — it is how the
-- one production co-owner was granted (2026-09-03) — except that NOBODY revokes the account holder
-- here: moving the account holder is an ownership transfer, a separate future step.
--
-- WHAT CHANGES, AND ONLY THIS (proof: supabase/tests/exp08_co_owner_authority.sql diffs prosrc):
--   * new helper public.is_tenant_account_holder(_user, _tenant):
--       tenants.owner_user_id = _user AND public.is_tenant_owner(_user, _tenant)
--     (the holder must ALSO still hold an active owner seat — a suspended holder is not one).
--   * grant_co_owner: the gate is is_tenant_account_holder(caller) OR platform owner; message.
--   * revoke_co_owner: the same gate; then a non-platform caller may not revoke themselves; then
--     nobody (platform owner included) revokes the tenant's account holder.
-- Signatures, owner, SECURITY DEFINER, search_path, grants, the FOR UPDATE lock, the last-owner
-- floor, every other refusal and the audit writes are byte-identical.
--
-- HONEST NOTES.
--   * is_tenant_owner (20270521000000) also answers true for a platform_admin in a COMPANY
--     workspace. The old gate therefore let a platform_admin grant/revoke there; the new gate does
--     not unless that person is also the account holder. Production 2026-10-26: both company
--     workspaces have no owner_user_id and no active owners, so only super_admin acts there now.
--   * Production 2026-10-26: 12 tenants; 4 have no owner_user_id (none has an active owner) and
--     1 holder has no active owner seat. On those, only the platform owner can grant co-ownership
--     after this change. Every tenant that has an active owner has its holder as an active owner.
--   * The self-revocation refusal cannot change an OUTCOME under this gate (the only non-platform
--     caller who passes the gate is the holder, whom the next refusal protects anyway); it is
--     defence in depth for when the gate widens, and the proof pins it by its message.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_tenant_account_holder(_user uuid, _tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user IS NOT NULL
     AND _tenant IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.tenants t
        WHERE t.id = _tenant AND t.owner_user_id = _user
     )
     AND public.is_tenant_owner(_user, _tenant);
$function$;

COMMENT ON FUNCTION public.is_tenant_account_holder(uuid, uuid) IS
  'EXP08 co-owner authority: true iff _user is the tenant''s account holder of record '
  '(tenants.owner_user_id) AND still holds an active owner seat (is_tenant_owner). '
  'The only non-platform authority for grant_co_owner / revoke_co_owner.';

-- Not anon: an unauthenticated caller has no standing to ask about. is_tenant_owner's other grants.
REVOKE ALL ON FUNCTION public.is_tenant_account_holder(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_account_holder(uuid, uuid) TO authenticated, service_role;

-- grant_co_owner: ELEVATES an EXISTING ACTIVE member to owner. Refuses non-active/
-- non-member. Gate: is_tenant_account_holder(caller) OR is_platform_owner().
CREATE OR REPLACE FUNCTION public.grant_co_owner(_tenant uuid, _user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _is_platform boolean := public.is_platform_owner();
  _active_member boolean;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'CO_OWNER_UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF _tenant IS NULL OR _user IS NULL THEN
    RAISE EXCEPTION 'CO_OWNER_BAD_ARGS' USING ERRCODE = '22023';
  END IF;
  IF NOT (public.is_tenant_account_holder(_caller, _tenant) OR _is_platform) THEN
    RAISE EXCEPTION 'CO_OWNER_FORBIDDEN: only the account holder may grant co-ownership'
      USING ERRCODE = '42501';
  END IF;

  -- Elevate ONLY an existing, active member of THIS tenant.
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = _user AND status = 'active'
  ) INTO _active_member;
  IF NOT _active_member THEN
    RAISE EXCEPTION
      'CO_OWNER_NOT_ACTIVE_MEMBER: target must be an active member of this tenant first'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.tenant_members
     SET is_owner = true,
         role     = 'owner'::public.tenant_role,
         status   = 'active',
         updated_at = now()
   WHERE tenant_id = _tenant AND user_id = _user;

  INSERT INTO public.paige_audit_log
    (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
  VALUES (
    _caller,
    CASE WHEN _is_platform THEN 'super_admin' ELSE 'owner' END,
    'tenant:grant_co_owner', 'tenant_member', _user,
    jsonb_build_object('tenant_id', _tenant, 'lane', 'auto'),
    _tenant
  );
END;
$function$;

-- revoke_co_owner: demotes an owner to is_owner=false + role='admin' in lockstep, with a
-- last-owner FLOOR. Locks ALL active is_owner rows FOR UPDATE *before* counting (serializes
-- concurrent revokes so two callers cannot each pass the >1 check and strip the last owner).
CREATE OR REPLACE FUNCTION public.revoke_co_owner(_tenant uuid, _user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _is_platform boolean := public.is_platform_owner();
  _target_is_owner boolean;
  _owner_count int;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'CO_OWNER_UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF _tenant IS NULL OR _user IS NULL THEN
    RAISE EXCEPTION 'CO_OWNER_BAD_ARGS' USING ERRCODE = '22023';
  END IF;
  IF NOT (public.is_tenant_account_holder(_caller, _tenant) OR _is_platform) THEN
    RAISE EXCEPTION 'CO_OWNER_FORBIDDEN: only the account holder may revoke co-ownership'
      USING ERRCODE = '42501';
  END IF;
  IF _user = _caller AND NOT _is_platform THEN
    RAISE EXCEPTION 'CO_OWNER_FORBIDDEN: you cannot revoke your own ownership here'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant AND owner_user_id = _user) THEN
    RAISE EXCEPTION 'CO_OWNER_FORBIDDEN: the account holder''s ownership cannot be revoked here'
      USING ERRCODE = '42501';
  END IF;

  -- Lock every active owner row for this tenant BEFORE the count (floor race guard).
  PERFORM 1
     FROM public.tenant_members
    WHERE tenant_id = _tenant AND is_owner = true AND status = 'active'
    FOR UPDATE;

  SELECT count(*) INTO _owner_count
    FROM public.tenant_members
   WHERE tenant_id = _tenant AND is_owner = true AND status = 'active';

  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = _user
       AND is_owner = true AND status = 'active'
  ) INTO _target_is_owner;

  IF NOT _target_is_owner THEN
    RAISE EXCEPTION 'CO_OWNER_NOT_OWNER: target is not an active owner of this tenant'
      USING ERRCODE = '42501';
  END IF;

  IF _owner_count <= 1 THEN
    RAISE EXCEPTION 'CO_OWNER_LAST: cannot revoke the last owner of a tenant'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.tenant_members
     SET is_owner = false,
         role     = 'admin'::public.tenant_role,
         updated_at = now()
   WHERE tenant_id = _tenant AND user_id = _user;

  INSERT INTO public.paige_audit_log
    (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
  VALUES (
    _caller,
    CASE WHEN _is_platform THEN 'super_admin' ELSE 'owner' END,
    'tenant:revoke_co_owner', 'tenant_member', _user,
    jsonb_build_object('tenant_id', _tenant, 'lane', 'auto'),
    _tenant
  );
END;
$function$;

-- Identical to 20260803190000: CREATE OR REPLACE keeps the ACL; re-stated so the repo reproduces it.
REVOKE ALL ON FUNCTION public.grant_co_owner(uuid, uuid)  FROM public, anon;
REVOKE ALL ON FUNCTION public.revoke_co_owner(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.grant_co_owner(uuid, uuid)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_co_owner(uuid, uuid) TO authenticated, service_role;
