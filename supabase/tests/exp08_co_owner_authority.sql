-- EXP08 co-owner authority: only the ACCOUNT HOLDER (tenants.owner_user_id, still holding an active
-- owner seat) or the PLATFORM OWNER grants or revokes co-ownership; nobody revokes the holder here;
-- a co-owner who is not the holder may step down to admin themselves (owner ruling 2026-10-26).
-- Migration under test: supabase/migrations/20271116020008_exp08_co_owner_authority.sql.
-- Disposable PostgreSQL only (it creates and drops its own database). Never target a linked project.
--
-- WHAT IS REAL AND WHAT IS A DOUBLE.
--   Real, verbatim and md5(prosrc)-pinned to production (2026-10-26) BEFORE anything changes:
--     grant_co_owner / revoke_co_owner (20260803190000, b62661d7… / 8b1cb22a…),
--     is_tenant_owner (20270521000000, f392787e…), guard_tenant_member_owner_flag (20260803190000,
--     011b8efe…) and its trigger. Real, applied with \ir: the migration under test.
--   Real, LOADED FROM THE MIGRATION CHAIN (not copied: psql reads each newest CREATE out of its
--     migration file, so this proof must run from the repository root, as CI does) and
--     md5(prosrc)-pinned to production (2026-10-26): guard_tenant_owner_only_columns
--     (20260804020000 F.0, ad32e93a…) and its BEFORE UPDATE trigger trg_guard_tenant_owner_cols;
--     is_tenant_admin / is_tenant_member (20270521000000, 7d393ee7… / f4df3c17…), which the
--     tenants policies call. The four tenants UPDATE policies and two SELECT policies are
--     production's, verbatim (pg_policy, 2026-10-26), so a co-owner's / admin's / platform_admin's
--     direct UPDATE of tenants.owner_user_id is reachable exactly as it is live.
--   Doubles: is_platform_owner (super_admin fixture), is_platform_admin / is_platform_admin()
--     (fixture), is_platform_operator (fixture), is_company_workspace (fixture),
--     auth.uid()/auth.role() (Supabase's bodies), the columns of tenants / tenant_members /
--     paige_audit_log these functions read and write, and proof.accept_owner_path — the two
--     statements of accept_tenant_invite's 'subaccount_owner' branch (20271115040008, newest)
--     that touch ownership, verbatim, in a postgres-owned SECURITY DEFINER under the invitee's JWT.
--     Synthetic ids only.
--
-- PHASES.
--   1  PRODUCTION BODIES: every case runs; the failing set must be EXACTLY the cases marked 'hole'
--      (the live defect) and 'new' (the helper does not exist yet). Proves the holes are real.
--   2  MIGRATED: md5(prosrc) of the four new bodies pinned; signature/owner/SECURITY DEFINER/
--      search_path/volatility/ACL identical to phase 1; the new prosrc, with ONLY the changed lines
--      put back, is byte-identical to production's (both RPCs and the tenants guard); every case
--      passes.
--   3  MUTANTS (§71.4): each mutant rewrites ONE gate element inside a rolled-back subtransaction and
--      must fail at least one case; the semantically neutral controls must fail none.
-- Every case runs in its own subtransaction that is always rolled back, so each starts from the
-- same fixture, as `authenticated` (or `anon`) with request.jwt.claims set, like PostgREST.
\set ON_ERROR_STOP on
\set QUIET on
DROP DATABASE IF EXISTS exp08_co_owner_authority_proof;
CREATE DATABASE exp08_co_owner_authority_proof;
\c exp08_co_owner_authority_proof
SET client_min_messages=warning;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
-- Supabase's bodies.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;

CREATE TYPE public.tenant_role AS ENUM ('owner','admin','coach','member');
CREATE TABLE public.tenants(id uuid PRIMARY KEY, name text NOT NULL, owner_user_id uuid,
 platform_fee_bps integer, parent_tenant_id uuid, stripe_customer_id text, stripe_subscription_id text,
 updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.tenant_members(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, role public.tenant_role NOT NULL DEFAULT 'member',
 status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), is_owner boolean NOT NULL DEFAULT false,
 UNIQUE (tenant_id, user_id));
CREATE TABLE public.paige_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid, actor_role text,
 action text, target_type text, target_id uuid, payload jsonb, tenant_id uuid, created_at timestamptz DEFAULT now());

-- DOUBLES.
CREATE TABLE public.fixture_super_admins(user_id uuid);
CREATE TABLE public.fixture_platform_admins(user_id uuid);
CREATE TABLE public.fixture_company_workspaces(tenant_id uuid);
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT EXISTS(SELECT 1 FROM public.fixture_super_admins WHERE user_id=auth.uid()) $$;
CREATE FUNCTION public.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT EXISTS(SELECT 1 FROM public.fixture_platform_admins WHERE user_id=$1) $$;
CREATE FUNCTION public.is_company_workspace(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT EXISTS(SELECT 1 FROM public.fixture_company_workspaces WHERE tenant_id=$1) $$;
CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT EXISTS(SELECT 1 FROM public.fixture_platform_admins WHERE user_id=auth.uid()) $$;
CREATE FUNCTION public.is_platform_operator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT public.is_platform_owner() OR public.is_platform_admin() $$;

-- ── REAL, VERBATIM: production's bodies as they stand before this change ─────────────────────────
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

CREATE OR REPLACE FUNCTION public.guard_tenant_member_owner_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Exempt trusted server identities + the platform owner. NOTE: 'authenticator'
  -- is deliberately NOT exempt — it always SET ROLEs to authenticated/anon before
  -- running client DML, and the task requires authenticator direct-DML to be forbidden.
  IF current_user IN ('postgres','service_role','supabase_admin','supabase_auth_admin')
     OR public.is_platform_owner() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.is_owner, false)
       OR NEW.role = 'owner'::public.tenant_role THEN
      RAISE EXCEPTION
        'OWNER_GUARD: tenant ownership may only be set via grant_co_owner()/provisioning'
        USING ERRCODE = '42501';
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF (COALESCE(NEW.is_owner, false) IS DISTINCT FROM COALESCE(OLD.is_owner, false))
       OR ((NEW.role = 'owner'::public.tenant_role)
            IS DISTINCT FROM (OLD.role = 'owner'::public.tenant_role)) THEN
      RAISE EXCEPTION
        'OWNER_GUARD: tenant ownership may only be changed via grant_co_owner()/revoke_co_owner()'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

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
  IF NOT (public.is_tenant_owner(_caller, _tenant) OR _is_platform) THEN
    RAISE EXCEPTION 'CO_OWNER_FORBIDDEN: only a tenant owner may grant co-ownership'
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
  IF NOT (public.is_tenant_owner(_caller, _tenant) OR _is_platform) THEN
    RAISE EXCEPTION 'CO_OWNER_FORBIDDEN: only a tenant owner may revoke co-ownership'
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
REVOKE ALL ON FUNCTION public.grant_co_owner(uuid, uuid)  FROM public, anon;
REVOKE ALL ON FUNCTION public.revoke_co_owner(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.grant_co_owner(uuid, uuid)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_co_owner(uuid, uuid) TO authenticated, service_role;
CREATE TRIGGER trg_tenant_members_owner_guard BEFORE INSERT OR UPDATE ON public.tenant_members
 FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_member_owner_flag();

-- ── REAL, LOADED FROM THE MIGRATION CHAIN: the tenants guard and the helpers its policies call ──
-- Each \set reads the newest CREATE of that function out of its migration file (no later migration
-- re-emits any of the three; the md5 pins below fail loudly if that ever stops being true).
\set guard_def `sed -n '/^CREATE OR REPLACE FUNCTION public.guard_tenant_owner_only_columns()/,/^END; \$function\$;/p' supabase/migrations/20260804020000_hole227_subaccount_owner_correction.sql`
\set ita_def `sed -n '/^CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid)/,/^\$function\$;/p' supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql`
\set itm_def `sed -n '/^CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant uuid)/,/^\$function\$;/p' supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql`
SELECT (length(:'guard_def') > 1000 AND length(:'ita_def') > 200 AND length(:'itm_def') > 200) AS chain_loaded \gset
\if :chain_loaded
\else
  DO $$ BEGIN RAISE EXCEPTION 'FAIL: could not read the chain bodies; run this proof from the repository root'; END $$;
\endif
:guard_def
:ita_def
:itm_def
-- Production's trigger (20260708174151) and policies (pg_policy on public.tenants, 2026-10-26).
CREATE TRIGGER trg_guard_tenant_owner_cols
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_owner_only_columns();
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.tenants TO authenticated;
CREATE POLICY "Members read own tenant" ON public.tenants
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(id) OR public.is_platform_owner());
CREATE POLICY "Platform staff read all tenants" ON public.tenants
  FOR SELECT TO authenticated USING (public.is_platform_admin());
CREATE POLICY "Tenant admins update their tenant" ON public.tenants
  FOR UPDATE TO authenticated
  USING (public.is_platform_owner() OR public.is_tenant_admin(id))
  WITH CHECK (public.is_platform_owner() OR public.is_tenant_admin(id));
CREATE POLICY "Tenant admins update own tenant" ON public.tenants
  FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(id) OR public.is_platform_owner())
  WITH CHECK (public.is_tenant_admin(id) OR public.is_platform_owner());
CREATE POLICY "Platform owner manages tenants" ON public.tenants
  FOR ALL TO authenticated
  USING (public.is_platform_owner())
  WITH CHECK (public.is_platform_owner());
CREATE POLICY "Platform staff update tenants" ON public.tenants
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('grant_co_owner(uuid,uuid)','b62661d7311288ffa7852da832f86013'),
   ('revoke_co_owner(uuid,uuid)','8b1cb22a4e244fb53695a40bd8f63226'),
   ('is_tenant_owner(uuid,uuid)','f392787e7469ed325960850ad091473d'),
   ('guard_tenant_member_owner_flag()','011b8efe34db45a4f284517b85d6eed6'),
   ('guard_tenant_owner_only_columns()','ad32e93ac6869c6b2a102208c8deb1d2'),
   ('is_tenant_admin(uuid)','7d393ee77b2ebbc42791f0dce8dbcca5'),
   ('is_tenant_member(uuid)','f4df3c17e4d78b305986dd342e42b415')) v(sig, prod_md5) LOOP
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=('public.'||r.sig)::regprocedure) IS DISTINCT FROM r.prod_md5 THEN
   RAISE EXCEPTION 'FAIL: % is not the production body (md5(prosrc) differs from %)', r.sig, r.prod_md5; END IF;
 END LOOP; END $$;
\echo 'PASS: grant_co_owner, revoke_co_owner, is_tenant_owner, both owner guards, is_tenant_admin and is_tenant_member are the production bodies (md5(prosrc) matches, 7 of 7)'

-- ── FIXTURE ───────────────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA proof;
GRANT USAGE ON SCHEMA proof TO anon, authenticated, service_role;
CREATE FUNCTION proof.u(text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5('exp08-co-owner:'||$1)::uuid $$;
CREATE FUNCTION proof.expect(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _ok IS NOT TRUE THEN RAISE EXCEPTION 'EXPECTATION_FALSE: %', _what USING ERRCODE='P0001'; END IF; END $$;
GRANT EXECUTE ON FUNCTION proof.u(text), proof.expect(boolean, text) TO anon, authenticated, service_role;

-- Tenant A: holder H (active owner seat), co-owners C1 and C2, admin AD, member ME, and CX, a co-owner
--   whose owner seat is SUSPENDED. OUT is nobody's.
-- Tenant B: holder HB, co-owner CB, member MB (the cross-tenant target).
-- Tenant S: holder HS whose owner seat is SUSPENDED, co-owner CS, member MS.
-- Tenant X: holder HX is an active ADMIN, not an owner (production has one such holder); owner OX, member MX.
-- Tenant L: no holder of record, one owner LO (the last-owner floor), member LM.
-- Tenant W: a COMPANY workspace: holder WH, co-owner WC, member WM; PA is a platform_admin (not super_admin).
-- Tenant E (cross-tenant shapes, S2): holder HE; co-owners H (holder of A) and HS (holder of S whose
--   seat in S is suspended) and CE; member EM. H and HS hold owner seats HERE and must still act
--   in neither E (not its holder) nor, for HS, S (no active seat there).
-- Tenant Q (S1): NO holder of record; two active co-owners Q1 and Q2, admin AQ, member QM.
-- Tenant SH (S1): an un-onboarded shell — no holder, no members (the accept_tenant_invite path).
-- Tenant Z (S1): NO holder of record and NO active owner; admin ZA, member ZM.
-- P is the platform owner (super_admin) and holds no seat anywhere.
INSERT INTO public.tenants(id,name,owner_user_id) VALUES
 (proof.u('A'),'Tenant A',proof.u('H')), (proof.u('B'),'Tenant B',proof.u('HB')),
 (proof.u('S'),'Tenant S',proof.u('HS')), (proof.u('X'),'Tenant X',proof.u('HX')),
 (proof.u('L'),'Tenant L',NULL),          (proof.u('W'),'Tenant W',proof.u('WH')),
 (proof.u('E'),'Tenant E',proof.u('HE')), (proof.u('Q'),'Tenant Q',NULL),
 (proof.u('SH'),'Shell SH',NULL),         (proof.u('Z'),'Tenant Z',NULL);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner)
SELECT proof.u(t), proof.u(p), r::public.tenant_role, s, o FROM (VALUES
 ('A','H','owner','active',true), ('A','C1','owner','active',true), ('A','C2','owner','active',true),
 ('A','AD','admin','active',false), ('A','ME','member','active',false), ('A','CX','owner','suspended',true),
 ('B','HB','owner','active',true), ('B','CB','owner','active',true), ('B','MB','member','active',false),
 ('S','HS','owner','suspended',true), ('S','CS','owner','active',true), ('S','MS','member','active',false),
 ('X','HX','admin','active',false), ('X','OX','owner','active',true), ('X','MX','member','active',false),
 ('L','LO','owner','active',true), ('L','LM','member','active',false),
 ('W','WH','owner','active',true), ('W','WC','owner','active',true), ('W','WM','member','active',false),
 ('E','HE','owner','active',true), ('E','H','owner','active',true), ('E','HS','owner','active',true),
 ('E','CE','owner','active',true), ('E','EM','member','active',false),
 ('Q','Q1','owner','active',true), ('Q','Q2','owner','active',true), ('Q','AQ','admin','active',false),
 ('Q','QM','member','active',false),
 ('Z','ZA','admin','active',false), ('Z','ZM','member','active',false)
) v(t,p,r,s,o);
INSERT INTO public.fixture_super_admins VALUES (proof.u('P'));
INSERT INTO public.fixture_platform_admins VALUES (proof.u('PA'));
INSERT INTO public.fixture_company_workspaces VALUES (proof.u('W'));

-- ── CASES ─────────────────────────────────────────────────────────────────────────────────────────
-- kind: 'kept' = same outcome before and after; 'hole' = the live defect (production lets it through);
-- 'new' = the helper, which production does not have.
CREATE TABLE proof.checks(n serial, id text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('kept','hole','new')),
 as_role text NOT NULL DEFAULT 'authenticated', actor text, call text NOT NULL, expect text NOT NULL,
 msg text, post text);
CREATE FUNCTION proof.g(t text, p text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT format('SELECT public.grant_co_owner(proof.u(%L), proof.u(%L))', t, p) $$;
CREATE FUNCTION proof.r(t text, p text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT format('SELECT public.revoke_co_owner(proof.u(%L), proof.u(%L))', t, p) $$;
CREATE FUNCTION proof.h(p text, t text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT format('public.is_tenant_account_holder(proof.u(%L), proof.u(%L))', p, t) $$;
-- A direct client UPDATE of the holder of record; it must touch exactly one row (so RLS cannot
-- make a refusal look like a success, nor a no-op look like an attack that got through).
CREATE FUNCTION proof.set_holder(t text, p text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT format('WITH u AS (UPDATE public.tenants SET owner_user_id = proof.u(%L) WHERE id = proof.u(%L) RETURNING 1) SELECT proof.expect(count(*) = 1, ''exactly one tenants row updated'') FROM u', p, t) $$;
-- The same self-crown, with ANOTHER guarded column changed in the same statement.
CREATE FUNCTION proof.set_holder_and(t text, p text, extra text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT format('WITH u AS (UPDATE public.tenants SET owner_user_id = proof.u(%L), %s WHERE id = proof.u(%L) RETURNING 1) SELECT proof.expect(count(*) = 1, ''exactly one tenants row updated'') FROM u', p, extra, t) $$;
CREATE FUNCTION proof.holder_is(t text, p text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT format('EXISTS(SELECT 1 FROM public.tenants WHERE id=proof.u(%L) AND owner_user_id=proof.u(%L))', t, p) $$;
-- The whole S1 attack, as the caller: crown yourself holder, then revoke a fellow co-owner.
CREATE FUNCTION proof.crown_then_revoke(_t text, _victim text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM proof.expect((SELECT count(*) FROM (SELECT 1 FROM public.tenants WHERE id = proof.u(_t)) x) = 1, 'tenant visible');
  UPDATE public.tenants SET owner_user_id = auth.uid() WHERE id = proof.u(_t);
  PERFORM public.revoke_co_owner(proof.u(_t), proof.u(_victim));
END $$;
GRANT EXECUTE ON FUNCTION proof.crown_then_revoke(text, text) TO authenticated;
-- DOUBLE of accept_tenant_invite's 'subaccount_owner' establishment (20271115040008 L1527-1540):
-- the shell-gate's no-active-owner check and the two ownership statements, verbatim, run as a
-- postgres-owned SECURITY DEFINER under the invitee's JWT — the one JWT-bearing producer of
-- tenants.owner_user_id (§37). The token, email and minter checks are omitted (not ownership).
CREATE FUNCTION proof.accept_owner_path(_tenant uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _has_active_owner boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND is_owner = true AND status = 'active'
  ) INTO _has_active_owner;
  IF _has_active_owner THEN RAISE EXCEPTION 'double: the shell-gate would not establish an owner here'; END IF;
      INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner)
      VALUES (_tenant, _uid, 'owner'::public.tenant_role, 'active', true)
      ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET is_owner  = true,
            role      = 'owner'::public.tenant_role,
            status    = 'active',
            updated_at = now();
      UPDATE public.tenants
         SET owner_user_id = _uid, updated_at = now()
       WHERE id = _tenant AND owner_user_id IS NULL;
END $$;
GRANT EXECUTE ON FUNCTION proof.accept_owner_path(uuid) TO authenticated;
CREATE FUNCTION proof.seat(t text, p text, owner boolean, role text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT format('EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=proof.u(%L) AND user_id=proof.u(%L) AND is_owner=%L AND role=%L)', t, p, owner, role) $$;
CREATE FUNCTION proof.audit(t text, p text, act text, by text, by_role text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT format('EXISTS(SELECT 1 FROM public.paige_audit_log WHERE tenant_id=proof.u(%L) AND target_id=proof.u(%L) AND action=%L AND actor_user_id=proof.u(%L) AND actor_role=%L AND payload=jsonb_build_object(''tenant_id'',proof.u(%L),''lane'',''auto''))', t, p, act, by, by_role, t) $$;

INSERT INTO proof.checks(id,kind,actor,call,expect,msg,post) VALUES
 -- grant
 ('g01 account holder grants an active member','kept','H',proof.g('A','ME'),'00000',NULL,
   proof.seat('A','ME',true,'owner')||' AND '||proof.audit('A','ME','tenant:grant_co_owner','H','owner')),
 ('g02 co-owner grants','hole','C1',proof.g('A','ME'),'42501','CO_OWNER_FORBIDDEN: only the account holder may grant co-ownership',NULL),
 ('g03 admin grants','kept','AD',proof.g('A','ME'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('g04 member grants self','kept','ME',proof.g('A','ME'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('g05 member grants another','kept','ME',proof.g('A','AD'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('g06 outsider grants','kept','OUT',proof.g('A','ME'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('g07 platform owner grants','kept','P',proof.g('A','ME'),'00000',NULL,
   proof.seat('A','ME',true,'owner')||' AND '||proof.audit('A','ME','tenant:grant_co_owner','P','super_admin')),
 ('g08 holder of A grants in B (cross-tenant)','kept','H',proof.g('B','MB'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('g09 holder with a SUSPENDED owner seat grants','kept','HS',proof.g('S','MS'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('g10 holder who holds no owner seat (admin) grants','kept','HX',proof.g('X','MX'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('g11 co-owner of S (holder suspended) grants','hole','CS',proof.g('S','MS'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('g12 platform_admin in a company workspace grants','hole','PA',proof.g('W','WM'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('g13 holder grants a non-member (unchanged refusal)','kept','H',proof.g('A','OUT'),'42501','CO_OWNER_NOT_ACTIVE_MEMBER',NULL),
 ('g14 unauthenticated grants','kept',NULL,proof.g('A','ME'),'42501','CO_OWNER_UNAUTHENTICATED',NULL),
 ('g15 holder grants with a NULL target','kept','H','SELECT public.grant_co_owner(proof.u(''A''), NULL)','22023','CO_OWNER_BAD_ARGS',NULL),
 -- revoke
 ('r01 account holder revokes a co-owner','kept','H',proof.r('A','C1'),'00000',NULL,
   proof.seat('A','C1',false,'admin')||' AND '||proof.audit('A','C1','tenant:revoke_co_owner','H','owner')),
 ('r02 co-owner revokes the account holder','hole','C1',proof.r('A','H'),'42501','CO_OWNER_FORBIDDEN: only the account holder may revoke co-ownership',NULL),
 ('r03 co-owner revokes another co-owner','hole','C1',proof.r('A','C2'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('r04 co-owner C1 steps down to admin (owner ruling: kept)','kept','C1',proof.r('A','C1'),'00000',NULL,
   proof.seat('A','C1',false,'admin')||' AND '||proof.audit('A','C1','tenant:revoke_co_owner','C1','owner')||' AND '||proof.seat('A','H',true,'owner')),
 ('r05 account holder revokes self (steps down)','hole','H',proof.r('A','H'),'42501','CO_OWNER_FORBIDDEN: the account holder''s ownership cannot be revoked here',NULL),
 ('r06 platform owner revokes the account holder','hole','P',proof.r('A','H'),'42501','CO_OWNER_FORBIDDEN: the account holder''s ownership cannot be revoked here',NULL),
 ('r07 platform owner revokes the account holder of B','hole','P',proof.r('B','HB'),'42501','CO_OWNER_FORBIDDEN: the account holder''s ownership cannot be revoked here',NULL),
 ('r08 platform owner revokes a co-owner','kept','P',proof.r('A','C1'),'00000',NULL,
   proof.seat('A','C1',false,'admin')||' AND '||proof.audit('A','C1','tenant:revoke_co_owner','P','super_admin')),
 ('r09 last-owner floor (no holder, one owner)','kept','P',proof.r('L','LO'),'42501','CO_OWNER_LAST',NULL),
 ('r10 holder of A revokes a co-owner of B (cross-tenant)','kept','H',proof.r('B','CB'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('r11 holder with a SUSPENDED owner seat revokes','kept','HS',proof.r('S','CS'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('r12 admin revokes a co-owner','kept','AD',proof.r('A','C1'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('r13 holder revokes a non-owner (unchanged refusal)','kept','H',proof.r('A','ME'),'42501','CO_OWNER_NOT_OWNER',NULL),
 ('r14 platform_admin in a company workspace revokes','hole','PA',proof.r('W','WC'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('r15 unauthenticated revokes','kept',NULL,proof.r('A','C1'),'42501','CO_OWNER_UNAUTHENTICATED',NULL),
 ('r16 holder revokes the only other owner, floor not reached (2 owners)','kept','HB',proof.r('B','CB'),'00000',NULL,
   proof.seat('B','CB',false,'admin')||' AND '||proof.seat('B','HB',true,'owner')),
 -- step-down (owner ruling 2026-10-26: "A co-owner can step down to Admin themselves")
 ('d01 co-owner OX, the ONLY active owner of X (holder HX holds no seat), steps down: floor','kept','OX',proof.r('X','OX'),'42501','CO_OWNER_LAST',NULL),
 ('d02 sole owner LO of holderless L steps down: floor','kept','LO',proof.r('L','LO'),'42501','CO_OWNER_LAST',NULL),
 ('d03 co-owner CX with a SUSPENDED owner seat steps down','kept','CX',proof.r('A','CX'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('d04 co-owner CB of B steps down in A, where CB holds no seat','kept','CB',proof.r('A','CB'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('d05 admin AD (no owner seat) revokes self','kept','AD',proof.r('A','AD'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('d06 holder of A steps down as co-owner of E (not E''s holder)','kept','H',proof.r('E','H'),'00000',NULL,
   proof.seat('E','H',false,'admin')||' AND '||proof.audit('E','H','tenant:revoke_co_owner','H','owner')||' AND '||proof.seat('A','H',true,'owner')||' AND '||proof.holder_is('A','H'));

-- Rows with an explicit role: the helper (S4: service_role only; authenticated and anon refused),
-- the cross-tenant shapes (S2) and the holder-of-record carve-out (S1).
INSERT INTO proof.checks(id,kind,as_role,actor,call,expect,msg,post) VALUES
 -- the helper
 ('h01 helper: holder with active owner seat','new','service_role',NULL,'SELECT proof.expect('||proof.h('H','A')||', ''h01'')','00000',NULL,NULL),
 ('h02 helper: co-owner is not the holder','new','service_role',NULL,'SELECT proof.expect(NOT '||proof.h('C1','A')||', ''h02'')','00000',NULL,NULL),
 ('h03 helper: suspended holder','new','service_role',NULL,'SELECT proof.expect(NOT '||proof.h('HS','S')||', ''h03'')','00000',NULL,NULL),
 ('h04 helper: holder without an owner seat','new','service_role',NULL,'SELECT proof.expect(NOT '||proof.h('HX','X')||', ''h04'')','00000',NULL,NULL),
 ('h05 helper: holder of A in B','new','service_role',NULL,'SELECT proof.expect(NOT '||proof.h('H','B')||', ''h05'')','00000',NULL,NULL),
 ('h06 helper: owner of a tenant with no holder','new','service_role',NULL,'SELECT proof.expect(NOT '||proof.h('LO','L')||', ''h06'')','00000',NULL,NULL),
 ('h07 helper: NULL user and NULL tenant','new','service_role',NULL,'SELECT proof.expect(NOT public.is_tenant_account_holder(NULL, proof.u(''A'')) AND NOT public.is_tenant_account_holder(proof.u(''H''), NULL), ''h07'')','00000',NULL,NULL),
 ('h08 helper: anon may not execute it','new','anon',NULL,'SELECT '||proof.h('H','A'),'42501','permission denied',NULL),
 ('h09 helper: authenticated may not execute it (no probing who holds what)','new','authenticated','H','SELECT '||proof.h('H','A'),'42501','permission denied',NULL),
 ('h10 helper: holder of A who co-owns E is not E''s holder','new','service_role',NULL,'SELECT proof.expect(NOT '||proof.h('H','E')||', ''h10'')','00000',NULL,NULL),
 ('h11 helper: holder of S without a seat there, owner elsewhere, is not S''s holder','new','service_role',NULL,'SELECT proof.expect(NOT '||proof.h('HS','S')||' AND '||proof.h('HE','E')||', ''h11'')','00000',NULL,NULL),
 -- cross-tenant (S2)
 ('x01 holder of A who co-owns E grants in E','hole','authenticated','H',proof.g('E','EM'),'42501','CO_OWNER_FORBIDDEN: only the account holder may grant co-ownership',NULL),
 ('x02 holder of A who co-owns E revokes a co-owner of E','hole','authenticated','H',proof.r('E','CE'),'42501','CO_OWNER_FORBIDDEN: only the account holder may revoke co-ownership',NULL),
 ('x03 holder of S (no active seat in S) who co-owns E grants in E','hole','authenticated','HS',proof.g('E','EM'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('x04 holder of S (no active seat in S) who co-owns E revokes in S','kept','authenticated','HS',proof.r('S','CS'),'42501','CO_OWNER_FORBIDDEN',NULL),
 ('x05 holder of E grants in E (control: E''s own holder still acts)','kept','authenticated','HE',proof.g('E','EM'),'00000',NULL,
   proof.seat('E','EM',true,'owner')),
 -- the holder-of-record carve-out in guard_tenant_owner_only_columns (S1)
 ('s01 co-owner Q1 crowns self holder of holderless Q (Q2 also an owner)','hole','authenticated','Q1',proof.set_holder('Q','Q1'),'P0001','Only the platform owner may change tenant ownership',NULL),
 ('s02 admin AQ names co-owner Q2 holder of Q','hole','authenticated','AQ',proof.set_holder('Q','Q2'),'P0001','Only the platform owner may change tenant ownership',NULL),
 ('s03 platform_admin (not super_admin) names Q2 holder of Q','hole','authenticated','PA',proof.set_holder('Q','Q2'),'P0001','Only the platform owner may change tenant ownership',NULL),
 ('s04 the full attack: Q1 crowns self, then revokes Q2','hole','authenticated','Q1','SELECT proof.crown_then_revoke(''Q'', ''Q2'')','P0001','Only the platform owner may change tenant ownership',NULL),
 ('s05 sole active owner LO establishes self as holder of L','kept','authenticated','LO',proof.set_holder('L','LO'),'00000',NULL,
   proof.holder_is('L','LO')),
 ('s06 trusted context (no JWT subject: migration / service path) sets Q''s holder','kept','postgres',NULL,proof.set_holder('Q','Q2'),'00000',NULL,
   proof.holder_is('Q','Q2')),
 ('s07 invitee establishes ownership of shell SH (accept_tenant_invite owner path)','kept','authenticated','IV','SELECT proof.accept_owner_path(proof.u(''SH''))','00000',NULL,
   proof.holder_is('SH','IV')||' AND '||proof.seat('SH','IV',true,'owner')),
 ('s08 co-owner C1 moves an existing holder (A) to self','kept','authenticated','C1',proof.set_holder('A','C1'),'P0001','Only the platform owner may change tenant ownership',NULL),
 ('s09 admin AQ (no owner seat) crowns self holder of Q','kept','authenticated','AQ',proof.set_holder('Q','AQ'),'P0001','Only the platform owner may change tenant ownership',NULL),
 ('s10 platform owner sets Q''s holder (recovery path, unchanged)','kept','authenticated','P',proof.set_holder('Q','Q1'),'00000',NULL,
   proof.holder_is('Q','Q1')),
 ('s11 platform_admin names the SOLE owner LO holder of L (only LO may, for themselves)','hole','authenticated','PA',proof.set_holder('L','LO'),'P0001','Only the platform owner may change tenant ownership',NULL),
 ('s12 sole active owner OX replaces X''s seatless holder HX with self (recovery is the platform owner''s)','kept','authenticated','OX',proof.set_holder('X','OX'),'P0001','Only the platform owner may change tenant ownership',NULL),
 ('s13 admin ZA crowns self holder of Z (no holder, no active owner)','kept','authenticated','ZA',proof.set_holder('Z','ZA'),'P0001','Only the platform owner may change tenant ownership',NULL),
 ('s14 member ZM crowns self holder of Z (no UPDATE policy admits a member: 0 rows)','kept','authenticated','ZM',proof.set_holder('Z','ZM'),'P0001','EXPECTATION_FALSE: exactly one tenants row updated',NULL),
 ('s15 sole owner LO self-crowns L AND changes stripe_customer_id','kept','authenticated','LO',proof.set_holder_and('L','LO','stripe_customer_id = ''cus_exp08'''),'P0001','Only the platform owner may change tenant ownership',NULL),
 ('s16 sole owner LO self-crowns L AND changes parent_tenant_id','kept','authenticated','LO',proof.set_holder_and('L','LO','parent_tenant_id = proof.u(''A'')'),'P0001','Only the platform owner may change tenant ownership',NULL);

-- One case, isolated: claims + role set, call caught, post-state read as postgres, then all rolled back.
CREATE FUNCTION proof.run_check(_id text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE c proof.checks; _state text; _msg text; _post boolean := true; _verdict text;
BEGIN
  SELECT * INTO c FROM proof.checks WHERE id = _id;
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN c.actor IS NULL THEN json_build_object('role', c.as_role)::text
           ELSE json_build_object('sub', proof.u(c.actor), 'role', c.as_role)::text END, true);
    EXECUTE format('SET LOCAL ROLE %I', c.as_role);
    BEGIN
      EXECUTE c.call; _state := '00000'; _msg := '';
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT;
    END;
    RESET ROLE;
    IF _state = '00000' AND c.post IS NOT NULL THEN EXECUTE 'SELECT (' || c.post || ')::boolean' INTO _post; END IF;
    _verdict := CASE WHEN _state = c.expect AND (c.msg IS NULL OR strpos(_msg, c.msg) > 0) AND _post IS TRUE
                     THEN 'pass' ELSE format('got %s "%s" post=%s', _state, _msg, coalesce(_post::text,'null')) END;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = _verdict;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN RETURN SQLERRM;
  END;
END $$;
CREATE FUNCTION proof.failing() RETURNS TABLE(id text, why text) LANGUAGE sql AS $$
  SELECT id, v FROM (SELECT id, n, proof.run_check(id) v FROM proof.checks) x WHERE v <> 'pass' ORDER BY n $$;

-- ═════════════════════ PHASE 1: production's bodies — the holes are real ═════════════════════
\echo '── PHASE 1, production bodies: cases that fail (expected: every hole and every new case) ──'
CREATE TABLE proof.phase1 AS SELECT * FROM proof.failing();
SELECT id AS failing_on_production, why FROM proof.phase1;
DO $$ DECLARE _bad text; BEGIN
  SELECT string_agg(c.id, E'\n') INTO _bad FROM proof.checks c
   WHERE (c.kind IN ('hole','new')) <> EXISTS(SELECT 1 FROM proof.phase1 f WHERE f.id = c.id);
  IF _bad IS NOT NULL THEN RAISE EXCEPTION E'FAIL: on production the failing set is not exactly hole+new:\n%', _bad; END IF;
  -- And each hole fails for the right reason: production lets it THROUGH (00000), it does not merely word it differently.
  SELECT string_agg(c.id, E'\n') INTO _bad FROM proof.checks c JOIN proof.phase1 f USING (id)
   WHERE c.kind = 'hole' AND f.why NOT LIKE 'got 00000%';
  IF _bad IS NOT NULL THEN RAISE EXCEPTION E'FAIL: a hole is refused by production, so it is not a hole:\n%', _bad; END IF;
END $$;
SELECT format('PASS: on production %s kept cases pass, %s holes go THROUGH (the live defect), %s helper cases fail (no helper yet)',
  (SELECT count(*) FROM proof.checks WHERE kind='kept'), (SELECT count(*) FROM proof.checks WHERE kind='hole'),
  (SELECT count(*) FROM proof.checks WHERE kind='new')) AS phase1 \gset
\echo :phase1

CREATE TABLE proof.prior AS
SELECT p.proname::text AS name, p.prosrc, p.prorettype, p.proargtypes::text AS argtypes, p.proargnames::text AS argnames,
       p.prosecdef, p.provolatile, p.proconfig::text AS config, p.proowner, p.proacl::text AS acl, p.prolang
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('grant_co_owner','revoke_co_owner','guard_tenant_owner_only_columns');

-- ═════════════════════ PHASE 2: the migration under test ═════════════════════
\ir ../migrations/20271116020008_exp08_co_owner_authority.sql

DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('grant_co_owner(uuid,uuid)','2a75180de63325dd7e328a73e494e6dc'),
   ('revoke_co_owner(uuid,uuid)','e2ba8ca80d63df58ebc93b34e5dc5f01'),
   ('is_tenant_account_holder(uuid,uuid)','4a3cab59aad7a70ff06a9054aa4aa60e'),
   ('guard_tenant_owner_only_columns()','d77a4bfab3aa53b73e592497acf0f46a')) v(sig, want) LOOP
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=('public.'||r.sig)::regprocedure) IS DISTINCT FROM r.want THEN
   RAISE EXCEPTION 'FAIL: % body is not the pinned one (md5(prosrc) differs from %)', r.sig, r.want; END IF;
 END LOOP; END $$;
\echo 'PASS: the four new bodies are the pinned ones (md5(prosrc), 4 of 4)'

DO $$ DECLARE _bad text; BEGIN
  SELECT string_agg(o.name, ', ') INTO _bad FROM proof.prior o JOIN pg_proc p
    ON p.pronamespace='public'::regnamespace AND p.proname=o.name
   WHERE (p.prorettype, p.proargtypes::text, p.proargnames::text, p.prosecdef, p.provolatile, p.proconfig::text, p.proowner, p.proacl::text, p.prolang)
         IS DISTINCT FROM (o.prorettype, o.argtypes, o.argnames, o.prosecdef, o.provolatile, o.config, o.proowner, o.acl, o.prolang);
  IF _bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: signature/owner/definer/search_path/volatility/ACL changed for %', _bad; END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('grant_co_owner','revoke_co_owner','guard_tenant_owner_only_columns')) <> 3 THEN
    RAISE EXCEPTION 'FAIL: an overload appeared'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.is_tenant_account_holder(uuid,uuid)'::regprocedure
     AND prosecdef AND provolatile = 's' AND proconfig::text = '{search_path=public}'
     AND proacl::text = '{postgres=X/postgres,service_role=X/postgres}') THEN
    RAISE EXCEPTION 'FAIL: the helper is not STABLE SECURITY DEFINER, search_path=public, service_role only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.tenants'::regclass AND tgname='trg_guard_tenant_owner_cols'
     AND tgfoid='public.guard_tenant_owner_only_columns()'::regprocedure AND tgenabled='O') THEN
    RAISE EXCEPTION 'FAIL: the tenants guard trigger is not wired to the guard'; END IF;
  IF col_description('public.tenants'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid='public.tenants'::regclass AND attname='owner_user_id')) NOT LIKE '%AUTHORITY signal%'
     OR col_description('public.tenant_members'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid='public.tenant_members'::regclass AND attname='is_owner')) LIKE '%DISPLAY-ONLY%'
     OR obj_description('public.guard_tenant_owner_only_columns()'::regprocedure, 'pg_proc') LIKE '%display-only%' THEN
    RAISE EXCEPTION 'FAIL: a comment still calls owner_user_id display-only, or the column comment is missing'; END IF;
END $$;
\echo 'PASS: signatures, owner, SECURITY DEFINER, search_path, volatility and ACL are unchanged for both RPCs and the tenants guard; the helper is STABLE DEFINER, search_path=public, service_role only (no PUBLIC/anon/authenticated); the guard trigger is wired; no comment calls owner_user_id display-only'

-- Put back ONLY the gate lines: the result must be production's body byte for byte.
CREATE FUNCTION proof.swap(_src text, _from text, _to text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF (length(_src) - length(replace(_src, _from, ''))) / length(_from) <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected exactly one occurrence of %', _from; END IF;
  RETURN replace(_src, _from, _to);
END $$;
DO $$ DECLARE _g text; _r text; BEGIN
  SELECT prosrc INTO _g FROM pg_proc WHERE oid='public.grant_co_owner(uuid,uuid)'::regprocedure;
  _g := proof.swap(_g, 'public.is_tenant_account_holder(_caller, _tenant)', 'public.is_tenant_owner(_caller, _tenant)');
  _g := proof.swap(_g, 'only the account holder may grant co-ownership', 'only a tenant owner may grant co-ownership');
  IF _g IS DISTINCT FROM (SELECT prosrc FROM proof.prior WHERE name='grant_co_owner') THEN
    RAISE EXCEPTION 'FAIL: grant_co_owner differs from production beyond its gate'; END IF;
  SELECT prosrc INTO _r FROM pg_proc WHERE oid='public.revoke_co_owner(uuid,uuid)'::regprocedure;
  _r := proof.swap(_r,
      E'  -- Step-down (owner ruling 2026-10-26): an ACTIVE owner may give up their OWN seat. The account\n'
    || E'  -- holder is excluded by the holder refusal below, which binds every caller.\n'
    || E'  IF NOT (public.is_tenant_account_holder(_caller, _tenant) OR _is_platform\n'
    || E'          OR (_user = _caller AND EXISTS (SELECT 1 FROM public.tenant_members\n'
    || E'                WHERE tenant_id = _tenant AND user_id = _caller AND is_owner = true AND status = ''active''))) THEN\n',
      E'  IF NOT (public.is_tenant_owner(_caller, _tenant) OR _is_platform) THEN\n');
  _r := proof.swap(_r, 'only the account holder may revoke co-ownership', 'only a tenant owner may revoke co-ownership');
  _r := proof.swap(_r, E'\n  -- Hold the tenant row FOR SHARE (after the owner-row lock: members -> tenants) so the holder of\n'
    || E'  -- record cannot change between this refusal and the demotion below.\n'
    || E'  PERFORM 1 FROM public.tenants WHERE id = _tenant FOR SHARE;\n'
    || E'  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant AND owner_user_id = _user) THEN\n'
    || E'    RAISE EXCEPTION ''CO_OWNER_FORBIDDEN: the account holder''''s ownership cannot be revoked here''\n'
    || E'      USING ERRCODE = ''42501'';\n  END IF;\n', '');
  IF _r IS DISTINCT FROM (SELECT prosrc FROM proof.prior WHERE name='revoke_co_owner') THEN
    RAISE EXCEPTION 'FAIL: revoke_co_owner differs from production beyond its gate'; END IF;
END $$;
-- The tenants guard: put back the two carve-out comment lines and drop the two added conditions.
DO $$ DECLARE _x text; BEGIN
  SELECT prosrc INTO _x FROM pg_proc WHERE oid='public.guard_tenant_owner_only_columns()'::regprocedure;
  _x := proof.swap(_x,
      E'  -- #227 DEFECT-2 carve-out, narrowed by EXP08 (20271116020008): an authenticated caller may only\n'
    || E'  -- ESTABLISH themselves (NULL -> auth.uid()) as holder, and only as the tenant''s SOLE active owner.\n',
      E'  -- #227 DEFECT-2 carve-out: tenant_members-consistent owner ESTABLISHMENT on a shell.\n'
    || E'  -- Only owner_user_id may change (NULL → an existing active is_owner member); every\n'
    || E'  -- other guarded column must be unchanged.\n');
  _x := proof.swap(_x, E'     AND NEW.owner_user_id = auth.uid()\n', '');
  _x := proof.swap(_x, E'     )\n     AND NOT EXISTS (\n'
    || E'       SELECT 1 FROM public.tenant_members tm\n'
    || E'        WHERE tm.tenant_id = NEW.id\n'
    || E'          AND tm.user_id  <> NEW.owner_user_id\n'
    || E'          AND tm.is_owner  = true\n'
    || E'          AND tm.status    = ''active''\n'
    || E'     ) THEN\n', E'     ) THEN\n');
  IF _x IS DISTINCT FROM (SELECT prosrc FROM proof.prior WHERE name='guard_tenant_owner_only_columns') THEN
    RAISE EXCEPTION 'FAIL: guard_tenant_owner_only_columns differs from production beyond its carve-out'; END IF;
END $$;
\echo 'PASS: with only the changed lines put back, all three bodies are production''s byte for byte (grant: 1 gate line + 1 message; revoke: the gate (1 line -> 2 comment + 3 code lines, adding the step-down) + 1 message + 1 new refusal, the holder one under a FOR SHARE tenant lock; guard: 3 comment lines replaced with 2 + 2 carve-out conditions)'

\echo '── PHASE 2, migrated: cases that fail (expected: none) ──'
CREATE TABLE proof.phase2 AS SELECT * FROM proof.failing();
SELECT id AS failing_after_migration, why FROM proof.phase2;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM proof.phase2) THEN RAISE EXCEPTION 'FAIL: % case(s) fail after the migration', (SELECT count(*) FROM proof.phase2); END IF; END $$;
SELECT format('PASS: after the migration all %s cases pass (%s kept, %s holes closed, %s helper)',
  (SELECT count(*) FROM proof.checks), (SELECT count(*) FROM proof.checks WHERE kind='kept'),
  (SELECT count(*) FROM proof.checks WHERE kind='hole'), (SELECT count(*) FROM proof.checks WHERE kind='new')) AS phase2 \gset
\echo :phase2

-- Direct DML still cannot change ownership (the RPC remains the only path for a client).
DO $$ DECLARE _state text; BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', proof.u('H'), 'role','authenticated')::text, true);
    GRANT UPDATE ON public.tenant_members TO authenticated;
    SET LOCAL ROLE authenticated;
    BEGIN
      UPDATE public.tenant_members SET is_owner = true, role = 'owner' WHERE tenant_id = proof.u('A') AND user_id = proof.u('ME');
      _state := '00000';
    EXCEPTION WHEN OTHERS THEN _state := SQLSTATE; END;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE='P0099', MESSAGE=_state;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN _state := SQLERRM; END;
  IF _state <> '42501' THEN RAISE EXCEPTION 'FAIL: direct ownership DML by the holder was not refused by the owner guard (%)', _state; END IF;
END $$;
\echo 'PASS: direct tenant_members ownership DML by an authenticated holder is still refused by the owner guard (42501)'

-- ═════════════════════ PHASE 3: mutants (§71.4) ═════════════════════
CREATE TABLE proof.mutants(n serial, name text, sig text, from_text text, to_text text, control boolean NOT NULL DEFAULT false, failing text[]);
INSERT INTO proof.mutants(name, sig, from_text, to_text, control) VALUES
 ('M1 grant gate back to is_tenant_owner', 'grant_co_owner(uuid,uuid)',
   'public.is_tenant_account_holder(_caller, _tenant)', 'public.is_tenant_owner(_caller, _tenant)', false),
 ('M2 revoke gate back to is_tenant_owner', 'revoke_co_owner(uuid,uuid)',
   'public.is_tenant_account_holder(_caller, _tenant)', 'public.is_tenant_owner(_caller, _tenant)', false),
 ('M3 revoke: drop the account-holder refusal', 'revoke_co_owner(uuid,uuid)',
   'IF EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant AND owner_user_id = _user) THEN', 'IF false THEN', false),
 ('M5 helper: drop the is_tenant_owner conjunct', 'is_tenant_account_holder(uuid,uuid)',
   'AND public.is_tenant_owner(_user, _tenant)', '', false),
 ('M6 helper: drop the owner_user_id conjunct', 'is_tenant_account_holder(uuid,uuid)',
   'AND t.owner_user_id = _user', '', false),
 ('M7 revoke: platform owner exempt from the account-holder refusal', 'revoke_co_owner(uuid,uuid)',
   'WHERE id = _tenant AND owner_user_id = _user) THEN', 'WHERE id = _tenant AND owner_user_id = _user) AND NOT _is_platform THEN', false),
 ('M8 grant: drop the platform-owner path', 'grant_co_owner(uuid,uuid)',
   'public.is_tenant_account_holder(_caller, _tenant) OR _is_platform', 'public.is_tenant_account_holder(_caller, _tenant)', false),
 ('SD1 step-down allowed for the holder (holder refusal skipped when revoking self)', 'revoke_co_owner(uuid,uuid)',
   'WHERE id = _tenant AND owner_user_id = _user) THEN', 'WHERE id = _tenant AND owner_user_id = _user) AND _user <> _caller THEN', false),
 ('SD2 step-down allowed for a non-owner (seat check drops is_owner)', 'revoke_co_owner(uuid,uuid)',
   'user_id = _caller AND is_owner = true AND status', 'user_id = _caller AND status', false),
 ('SD3 step-down without the active-status check', 'revoke_co_owner(uuid,uuid)',
   'AND is_owner = true AND status = ''active''))) THEN', 'AND is_owner = true))) THEN', false),
 ('SD4 step-down lets _user != _caller', 'revoke_co_owner(uuid,uuid)',
   '_user = _caller AND EXISTS', 'true AND EXISTS', false),
 ('SD5 step-down seat in ANY tenant', 'revoke_co_owner(uuid,uuid)',
   'WHERE tenant_id = _tenant AND user_id = _caller', 'WHERE user_id = _caller', false),
 ('V1 helper: drop the t.id = _tenant conjunct (holder of ANY tenant)', 'is_tenant_account_holder(uuid,uuid)',
   'WHERE t.id = _tenant AND t.owner_user_id = _user', 'WHERE t.owner_user_id = _user', false),
 ('V2 helper: owner seat in ANY tenant (is_tenant_owner(_user, NULL))', 'is_tenant_account_holder(uuid,uuid)',
   'AND public.is_tenant_owner(_user, _tenant)', 'AND public.is_tenant_owner(_user, NULL)', false),
 ('G1 guard: drop NEW.owner_user_id = auth.uid() (anyone may be named)', 'guard_tenant_owner_only_columns()',
   E'     AND NEW.owner_user_id = auth.uid()\n', '', false),
 ('G2 guard: drop the sole-active-owner condition (NOT EXISTS of nothing)', 'guard_tenant_owner_only_columns()',
   E'          AND tm.user_id  <> NEW.owner_user_id\n', E'          AND false AND tm.user_id  <> NEW.owner_user_id\n', false),
 ('G3 guard: carve-out no longer requires a holderless tenant', 'guard_tenant_owner_only_columns()',
   E'  IF OLD.owner_user_id IS NULL\n     AND NEW.owner_user_id IS NOT NULL\n', E'  IF NEW.owner_user_id IS NOT NULL\n', false),
 ('G4 guard: seat check drops tm.is_owner = true (any active member may crown self)', 'guard_tenant_owner_only_columns()',
   E'          AND tm.user_id   = NEW.owner_user_id\n          AND tm.is_owner  = true\n', E'          AND tm.user_id   = NEW.owner_user_id\n', false),
 ('G5 guard: carve-out drops the stripe_customer_id unchanged-condition', 'guard_tenant_owner_only_columns()',
   E'     AND NEW.stripe_customer_id     IS NOT DISTINCT FROM OLD.stripe_customer_id\n', '', false),
 ('G6 guard: carve-out drops the parent_tenant_id unchanged-condition', 'guard_tenant_owner_only_columns()',
   E'     AND NEW.parent_tenant_id       IS NOT DISTINCT FROM OLD.parent_tenant_id\n', '', false),
 ('C1 control: grant reads auth.uid() again instead of _caller (equivalent)', 'grant_co_owner(uuid,uuid)',
   'IF _caller IS NULL THEN', 'IF auth.uid() IS NULL THEN', true),
 ('C2 control: helper conjuncts reordered (equivalent)', 'is_tenant_account_holder(uuid,uuid)',
   'SELECT _user IS NOT NULL', 'SELECT _tenant IS NOT NULL AND _user IS NOT NULL', true),
 ('C3 control: guard compares auth.uid() = NEW.owner_user_id (equivalent)', 'guard_tenant_owner_only_columns()',
   'AND NEW.owner_user_id = auth.uid()', 'AND auth.uid() = NEW.owner_user_id', true),
 ('C4 control: step-down ALSO excludes the holder in the gate (equivalent: the holder refusal binds every caller)', 'revoke_co_owner(uuid,uuid)',
   '_user = _caller AND EXISTS', '_user = _caller AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant AND owner_user_id = _caller) AND EXISTS', true);

DO $$ DECLARE m record; _def text; _fail text[]; BEGIN
  FOR m IN SELECT * FROM proof.mutants ORDER BY n LOOP
    BEGIN
      _def := proof.swap(pg_get_functiondef(('public.'||m.sig)::regprocedure), m.from_text, m.to_text);
      EXECUTE _def;
      SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO _fail FROM proof.failing();
      RAISE EXCEPTION USING ERRCODE = 'P0098', MESSAGE = 'rollback mutant';
    EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL;
    END;
    UPDATE proof.mutants SET failing = _fail WHERE n = m.n;
  END LOOP;
END $$;
\echo '── PHASE 3, mutants: the cases each one fails ──'
SELECT name AS mutant, cardinality(failing) AS failing_cases, array_to_string(failing, ' | ') AS which FROM proof.mutants ORDER BY n;
DO $$ DECLARE _bad text; BEGIN
  SELECT string_agg(name, ', ') INTO _bad FROM proof.mutants WHERE NOT control AND cardinality(failing) = 0;
  IF _bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: mutants survive: %', _bad; END IF;
  SELECT string_agg(name, ', ') INTO _bad FROM proof.mutants WHERE control AND cardinality(failing) <> 0;
  IF _bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: a neutral control was flagged (the cases are brittle): %', _bad; END IF;
  -- The mutant really ran: the live bodies are the migrated ones again after every rollback.
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.revoke_co_owner(uuid,uuid)'::regprocedure) <> 'e2ba8ca80d63df58ebc93b34e5dc5f01'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.guard_tenant_owner_only_columns()'::regprocedure) <> 'd77a4bfab3aa53b73e592497acf0f46a' THEN
    RAISE EXCEPTION 'FAIL: a mutant leaked out of its subtransaction'; END IF;
END $$;
SELECT format('PASS counts: %s cases; production %s pass / %s fail (%s holes + %s helper, expected); migrated %s pass / 0 fail; %s of %s mutants killed; %s of %s controls survive',
  (SELECT count(*) FROM proof.checks), (SELECT count(*) FROM proof.checks) - (SELECT count(*) FROM proof.phase1),
  (SELECT count(*) FROM proof.phase1), (SELECT count(*) FROM proof.checks WHERE kind='hole'),
  (SELECT count(*) FROM proof.checks WHERE kind='new'), (SELECT count(*) FROM proof.checks),
  (SELECT count(*) FROM proof.mutants WHERE NOT control AND cardinality(failing) > 0),
  (SELECT count(*) FROM proof.mutants WHERE NOT control),
  (SELECT count(*) FROM proof.mutants WHERE control AND cardinality(failing) = 0),
  (SELECT count(*) FROM proof.mutants WHERE control)) AS summary \gset
\echo :summary

\c postgres
DROP DATABASE exp08_co_owner_authority_proof;
