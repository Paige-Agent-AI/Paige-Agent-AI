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
--   * revoke_co_owner: the same gate, which ALSO admits a step-down (_user = _caller, the caller
--     holding an active owner seat in _tenant — owner ruling 2026-10-26, "A co-owner can step down
--     to Admin themselves"); then nobody (platform owner included) revokes the tenant's account
--     holder, which also refuses the holder stepping down.
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
--   * An earlier draft of this migration also refused ALL self-revocation by a non-platform caller.
--     It is gone: it would have taken away the co-owner step-down production allows today, which
--     the owner ruled must stay. The holder still cannot revoke themselves (the holder refusal).
--     The step-down seat check reads tenant_members directly, NOT is_tenant_owner, so the
--     company-workspace operator branch of is_tenant_owner does not count as a seat; the target
--     check after the FOR UPDATE lock re-verifies the same seat, so a seat lost in between still
--     ends in CO_OWNER_NOT_OWNER.
--   * The platform_admin narrowing above is CONSISTENT with the owner ruling of 2026-10-26: only
--     the account holder adds or removes owners; the platform super admin may do so only for
--     recovery when there is no working account holder (that recovery gating is a later
--     increment). Nothing here is widened beyond super_admin.
--
-- §58 — CAPABILITIES THIS CHANGE REMOVES OR KEEPS, each against production today.
--   * (was ✓, owner-ruled) The account holder could step down via revoke_co_owner while another
--     owner remained. Now nobody, the platform owner included, demotes the holder here; moving the
--     holder (a holder transfer) is a later increment.
--   * (was ✓, owner-ruled) A platform_admin (operator, not super_admin) could grant and revoke
--     co-ownership in a company workspace through is_tenant_owner's operator branch. Now only the
--     account holder or the platform super admin acts (the super admin, for recovery).
--   * KEPT per the owner ruling: a co-owner who is not the holder steps down to admin themselves
--     (revoke_co_owner(_tenant, auth.uid())), subject to the last-owner floor, as on production.
--
-- TRACKED FOLLOW-UP, OUTSIDE THIS CHANGE. revoke_platform_access (executable by authenticated, gated
-- is_platform_admin() OR is_platform_owner()) DELETEs tenant_members rows, owner and holder seats
-- included, so it bypasses revoke_co_owner's last-owner floor and its holder refusal. Not touched
-- here; it needs its own grounded change.
--
-- VERIFIER FOLLOW-UPS FOLDED INTO THIS SAME MIGRATION (it was unmerged when they were found).
--   S1  Now that tenants.owner_user_id is an AUTHORITY signal, the #227 F.0 "shell carve-out" in
--       guard_tenant_owner_only_columns (20260804020000, never re-emitted since; prod md5(prosrc)
--       ad32e93ac6869c6b2a102208c8deb1d2 = that body) was an escalation: it let ANY authenticated
--       caller that the tenants UPDATE policies admit (tenant owner/admin via is_tenant_admin,
--       platform_admin via "Platform staff update tenants") set owner_user_id NULL -> ANY active
--       owner. A co-owner of a holderless tenant could crown themselves holder and then revoke the
--       other co-owners; an admin could pick the holder. Narrowed: for an authenticated end user
--       (the guard's own test: auth.uid() IS NOT NULL and not is_platform_owner()), NULL -> X is
--       allowed only when X = auth.uid() AND X is the ONLY active owner of the tenant. Trusted
--       contexts are detected exactly as before (auth.uid() IS NULL — service_role, migrations —
--       or the platform owner) and are unchanged. The one JWT-bearing producer,
--       accept_tenant_invite's 'subaccount_owner' path, sets owner_user_id = _uid = auth.uid()
--       only after its shell-gate proved there was NO active owner and inserted the invitee as
--       one, so the invitee is the sole active owner and still passes. Production 2026-10-26: no
--       holderless tenant has any active owner, so the hole was latent, not exercised.
--   S4  is_tenant_account_holder is NOT executable by authenticated (it let any signed-in user
--       probe whether user X holds tenant Y). Both RPCs run as their owner, so they need no grant.
--   NIT revoke_co_owner reads the holder of record under FOR SHARE on the tenants row, AFTER the
--       existing FOR UPDATE on the active owner rows, so the holder cannot change between the
--       refusal and the demotion. Lock order is tenant_members -> tenants, the same order
--       accept_tenant_invite takes (member upsert, then UPDATE tenants).
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

-- Not PUBLIC, anon or authenticated: it answers "does user X hold tenant Y" for ANY X and Y, so a
-- signed-in caller must not be able to probe it. grant_co_owner / revoke_co_owner are SECURITY
-- DEFINER and call it as their owner, so they need no grant; service_role keeps it for server paths.
REVOKE ALL ON FUNCTION public.is_tenant_account_holder(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_account_holder(uuid, uuid) TO service_role;

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
  -- Step-down (owner ruling 2026-10-26): an ACTIVE owner may give up their OWN seat. The account
  -- holder is excluded by the holder refusal below, which binds every caller.
  IF NOT (public.is_tenant_account_holder(_caller, _tenant) OR _is_platform
          OR (_user = _caller AND EXISTS (SELECT 1 FROM public.tenant_members
                WHERE tenant_id = _tenant AND user_id = _caller AND is_owner = true AND status = 'active'))) THEN
    RAISE EXCEPTION 'CO_OWNER_FORBIDDEN: only the account holder may revoke co-ownership'
      USING ERRCODE = '42501';
  END IF;

  -- Lock every active owner row for this tenant BEFORE the count (floor race guard).
  PERFORM 1
     FROM public.tenant_members
    WHERE tenant_id = _tenant AND is_owner = true AND status = 'active'
    FOR UPDATE;

  -- Hold the tenant row FOR SHARE (after the owner-row lock: members -> tenants) so the holder of
  -- record cannot change between this refusal and the demotion below.
  PERFORM 1 FROM public.tenants WHERE id = _tenant FOR SHARE;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant AND owner_user_id = _user) THEN
    RAISE EXCEPTION 'CO_OWNER_FORBIDDEN: the account holder''s ownership cannot be revoked here'
      USING ERRCODE = '42501';
  END IF;

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

-- ── S1: guard_tenant_owner_only_columns — narrow the #227 F.0 shell carve-out ─────────────────────
-- Re-emitted from its newest body (20260804020000 F.0; production md5(prosrc)
-- ad32e93ac6869c6b2a102208c8deb1d2) with ONLY the carve-out changed: three comment lines replaced
-- with two, and two conditions added (NEW.owner_user_id = auth.uid(); no OTHER active owner). The trusted-
-- context test on its first line, the guarded columns, the refusal and its message are
-- byte-identical (proof: supabase/tests/exp08_co_owner_authority.sql diffs prosrc).
CREATE OR REPLACE FUNCTION public.guard_tenant_owner_only_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_platform_owner() THEN
    RETURN NEW;
  END IF;

  -- #227 DEFECT-2 carve-out, narrowed by EXP08 (20271116020008): an authenticated caller may only
  -- ESTABLISH themselves (NULL -> auth.uid()) as holder, and only as the tenant's SOLE active owner.
  IF OLD.owner_user_id IS NULL
     AND NEW.owner_user_id IS NOT NULL
     AND NEW.owner_user_id = auth.uid()
     AND NEW.platform_fee_bps       IS NOT DISTINCT FROM OLD.platform_fee_bps
     AND NEW.parent_tenant_id       IS NOT DISTINCT FROM OLD.parent_tenant_id
     AND NEW.stripe_customer_id     IS NOT DISTINCT FROM OLD.stripe_customer_id
     AND NEW.stripe_subscription_id IS NOT DISTINCT FROM OLD.stripe_subscription_id
     AND EXISTS (
       SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = NEW.id
          AND tm.user_id   = NEW.owner_user_id
          AND tm.is_owner  = true
          AND tm.status    = 'active'
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = NEW.id
          AND tm.user_id  <> NEW.owner_user_id
          AND tm.is_owner  = true
          AND tm.status    = 'active'
     ) THEN
    RETURN NEW;
  END IF;

  IF NEW.owner_user_id       IS DISTINCT FROM OLD.owner_user_id
     OR NEW.platform_fee_bps IS DISTINCT FROM OLD.platform_fee_bps
     OR NEW.parent_tenant_id IS DISTINCT FROM OLD.parent_tenant_id
     OR NEW.stripe_customer_id     IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id THEN
    RAISE EXCEPTION 'Only the platform owner may change tenant ownership, billing, or hierarchy';
  END IF;
  RETURN NEW;
END; $function$;

COMMENT ON FUNCTION public.guard_tenant_owner_only_columns() IS
  '#227 F.0 (§9), narrowed by EXP08 20271116020008: non-platform authenticated callers cannot '
  'change tenant billing/hierarchy or set/move the account holder of record (owner_user_id). '
  'ONE carve-out: a caller may ESTABLISH themselves as holder (owner_user_id NULL -> auth.uid()) '
  'only while they are the tenant''s SOLE active is_owner member, with no other guarded column '
  'changing — the born-correct owner set inside accept_tenant_invite. owner_user_id is an '
  'AUTHORITY signal (is_tenant_account_holder gates grant_co_owner / revoke_co_owner), so the '
  'carve-out must never let a co-owner or an admin choose the holder. Trusted contexts '
  '(auth.uid() IS NULL: service_role, migrations) and the platform owner are exempt, as before.';

COMMENT ON COLUMN public.tenant_members.is_owner IS
  'Slice A Option 1 (§9, #218/#221/#212): SOLE authoritative tenant-ownership SEAT signal. '
  'Mutated ONLY by grant_co_owner()/revoke_co_owner() or trusted postgres-owned SECURITY '
  'DEFINER provisioning; direct client DML is blocked by trg_tenant_members_owner_guard. '
  'Since EXP08 20271116020008, tenants.owner_user_id (the account holder of record) is ALSO '
  'an authority input: is_tenant_account_holder() = holder of record AND an active owner seat '
  'here, and only that person (or the platform owner) grants or revokes co-ownership. '
  'Distinct from the frontend/UI is_owner (which means platform-owner/super_admin).';

COMMENT ON COLUMN public.tenants.owner_user_id IS
  'The account holder of record (EXP08 20271116020008). An AUTHORITY signal, not display-only: '
  'is_tenant_account_holder() requires it AND an active tenant_members owner seat, and gates '
  'grant_co_owner / revoke_co_owner. Changed only by the platform owner or a trusted context '
  '(guard_tenant_owner_only_columns); an authenticated caller may only establish themselves '
  '(NULL -> self) while the tenant''s sole active owner.';
