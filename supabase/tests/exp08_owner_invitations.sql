-- EXP08 co-owners and entity owners, increment I1: OWNER INVITATIONS.
-- Migration under test: supabase/migrations/20271119020008_exp08_owner_invitations.sql.
-- Contract cases 1 (escalation), 2 (accept-time), 6 (cross-tenant / shape), 7 (direct DML),
-- 12 (membership oracle) and 13 (byte-identity), plus peek_tenant_invite (§5.5).
-- Disposable PostgreSQL only (it creates and drops its own database). Never target a linked project.
-- Run from the repository root, as CI does: psql reads each real body out of its migration file.
--
-- WHAT IS REAL AND WHAT IS A DOUBLE.
--   Real, LOADED FROM THE MIGRATION CHAIN (sed reads the newest CREATE out of its migration file) and
--   md5(prosrc)-pinned to PRODUCTION (read 2026-10-27) before anything changes:
--     create_solo_team_invite c002b98c, resend_solo_team_invite b6c02932, accept_solo_team_invite
--     de8a6ac1, accept_tenant_invite 177c2710, enforce_tenant_member_consent 780419e0,
--     _tenant_member_reinstating 5cbe3b02 (20271115040008); revoke_solo_team_invite 2c4ed28d,
--     solo_team_invite_authority 6fee3e01 (20261047000000); archive_solo_team_invite 3dc08a57
--     (20261105000000); create_tenant_invite_token 3a91af3a (20260824000000);
--     guard_tenant_member_owner_flag 011b8efe (20260803190000); guard_tenant_owner_only_columns
--     d77a4bfa and is_tenant_account_holder 4a3cab59 (20271116020008); is_tenant_owner f392787e,
--     is_tenant_admin 7d393ee7, is_tenant_member f4df3c17, is_company_workspace 7944c5bd (20270521000000);
--     stamp_tier_send_invite 452f1538 (20260714142748); _client_portal_invitation_binding_guard
--     a9f6aa77 (20271108233000); guard_archived_tenant_membership acf074d1 (20270602000203).
--   Real, production's body inline (the repository has no file that holds it verbatim: 20271108120100
--   patched it in place with replace()): peek_tenant_invite 276541d0. tenant_set_updated_at e3addd32.
--   Real: the migration under test, applied with \ir. Production's tokens policy, tenants policies,
--   triggers and ACLs on the four tables (pg_policy / pg_trigger / relacl, 2026-10-27).
--   STRONGER THAN PRODUCTION, on purpose: authenticated is granted UPDATE/INSERT on tenant_members
--   (production grants SELECT only), so the owner-flag guard is proven on its own, not behind a grant.
--   Doubles: auth.uid()/auth.role() (Supabase's bodies), auth.users, is_platform_owner/_admin/
--   _operator, is_super_admin(uuid), agency_can_manage_child (fixtures), resolve_tenant_brand,
--   resolve_actor_tier; the columns of tenants/profiles/audit_logs/paige_audit_log these functions
--   use; proof.accept_owner_path (accept_tenant_invite's sub-account owner statements, as in
--   exp08_co_owner_authority.sql) and proof.portal_writer (the exact token statements of
--   set_client_portal_access and create_client_portal_invitation). Omitted triggers, named:
--   guard_company_workspace_invitation, the Team Hub seat triggers, sync_tenant_member_to_user_roles,
--   refresh/resync membership triggers. Synthetic ids and *.invalid addresses only.
--
-- PHASES.
--   1  PRODUCTION BODIES: every case runs; the failing set must be EXACTLY the cases marked 'hole'
--      (production lets them through) and 'new' (the capability does not exist yet).
--   2  MIGRATED: every case passes; md5(prosrc) of every new body pinned; signatures/owner/definer/
--      search_path/ACL as intended; each re-emitted body, with ONLY its marked lines put back, is
--      production's byte for byte (case 13).
--   3  MUTANTS (§71.4): each rewrites ONE element inside a rolled-back subtransaction and must fail
--      at least one case; the semantically neutral controls must fail none.
\set ON_ERROR_STOP on
\set QUIET on
DROP DATABASE IF EXISTS exp08_owner_invitations_proof;
CREATE DATABASE exp08_owner_invitations_proof;
\c exp08_owner_invitations_proof
SET client_min_messages=warning;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);

CREATE TYPE public.tenant_role AS ENUM ('owner','admin','coach','member');
CREATE TABLE public.tenants(id uuid PRIMARY KEY, name text NOT NULL, slug text, owner_user_id uuid,
 account_type text NOT NULL DEFAULT 'standalone', parent_tenant_id uuid, features jsonb NOT NULL DEFAULT '{}'::jsonb,
 archived_at timestamptz, status text NOT NULL DEFAULT 'active',
 platform_fee_bps integer, stripe_customer_id text, stripe_subscription_id text,
 updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.tenant_members(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, role public.tenant_role NOT NULL DEFAULT 'member', status text NOT NULL DEFAULT 'active',
 invited_at timestamptz, joined_at timestamptz DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), is_owner boolean NOT NULL DEFAULT false,
 job_title text CHECK (job_title IS NULL OR char_length(job_title) <= 120),
 responsibilities text CHECK (responsibilities IS NULL OR char_length(responsibilities) <= 2000),
 team_hub_access boolean NOT NULL DEFAULT true,
 CONSTRAINT tenant_members_role_not_retired_title_role CHECK (role IS DISTINCT FROM 'coach'),
 UNIQUE (tenant_id, user_id));
CREATE TABLE public.tenant_invite_tokens(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 token text NOT NULL UNIQUE, kind text NOT NULL DEFAULT 'consumer',
 default_role public.tenant_role NOT NULL DEFAULT 'member', created_by uuid,
 expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'), max_uses integer, uses integer NOT NULL DEFAULT 0,
 last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), contact_id uuid, email text, agency_role text,
 origin_account_id uuid, actor_tier text, target_tier text, job_title text, responsibilities text,
 archived_at timestamptz, portal_operation_id uuid, portal_proposal_hash text, portal_receipt_id uuid,
 team_hub_access boolean NOT NULL DEFAULT true,
 CONSTRAINT tenant_invite_portal_operation_shape CHECK ((((portal_operation_id IS NULL) AND (portal_proposal_hash IS NULL) AND (portal_receipt_id IS NULL)) OR ((portal_operation_id IS NOT NULL) AND (portal_proposal_hash IS NOT NULL) AND (portal_proposal_hash ~ '^[0-9a-f]{64}$'::text) AND (portal_receipt_id IS NOT NULL) AND (kind = 'consumer'::text) AND (created_by IS NOT NULL) AND (email IS NOT NULL) AND (NOT (max_uses IS DISTINCT FROM 1))))),
 CONSTRAINT tenant_invite_tokens_agency_role_chk CHECK (((agency_role IS NULL) OR (agency_role = ANY (ARRAY['agency_admin'::text, 'agency_manager'::text, 'agency_biller'::text, 'agency_specialist'::text, 'agency_viewer'::text])))),
 CONSTRAINT tenant_invite_tokens_default_role_not_retired_title_role CHECK ((default_role IS DISTINCT FROM 'coach'::tenant_role)),
 CONSTRAINT tit_actor_tier_chk CHECK (((actor_tier IS NULL) OR (actor_tier = ANY (ARRAY['god'::text, 'agency'::text, 'tenant'::text, 'subaccount'::text, 'client'::text])))),
 CONSTRAINT tit_target_tier_chk CHECK (((target_tier IS NULL) OR (target_tier = ANY (ARRAY['god'::text, 'agency'::text, 'tenant'::text, 'subaccount'::text, 'client'::text])))));
CREATE TABLE public.tenant_business_owners(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 owner_kind text NOT NULL CHECK (owner_kind = ANY (ARRAY['individual','company','trust','other_legal_person'])),
 legal_name text NOT NULL CHECK (char_length(btrim(legal_name)) >= 1 AND char_length(btrim(legal_name)) <= 500),
 display_name text CHECK (display_name IS NULL OR char_length(btrim(display_name)) <= 500),
 ownership_interest numeric CHECK (ownership_interest IS NULL OR (ownership_interest >= 0 AND ownership_interest <= 100)),
 effective_date date, ownership_status text NOT NULL DEFAULT 'active'
   CHECK (ownership_status = ANY (ARRAY['active','former','pending','other'])),
 representative_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_by uuid NOT NULL REFERENCES auth.users(id), updated_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 setup_provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(setup_provenance) = 'object'));
CREATE TABLE public.profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, full_name text, active_tenant_id uuid);
CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, action text NOT NULL,
 entity text NOT NULL, entity_id uuid, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.paige_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, actor_role text, action text NOT NULL,
 target_type text, target_id uuid, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL, operator_rows_server_only boolean);
CREATE TABLE public.tenant_member_reinstatement_marks(membership_id uuid, xact_id xid8);

-- DOUBLES.
CREATE TABLE public.fixture_super_admins(user_id uuid);
CREATE TABLE public.fixture_platform_admins(user_id uuid);
CREATE TABLE public.fixture_agency_managers(tenant_id uuid, user_id uuid);
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT EXISTS(SELECT 1 FROM public.fixture_super_admins WHERE user_id=auth.uid()) $$;
CREATE FUNCTION public.is_platform_owner(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT EXISTS(SELECT 1 FROM public.fixture_super_admins WHERE user_id=_user_id) $$;
CREATE FUNCTION public.is_super_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT EXISTS(SELECT 1 FROM public.fixture_super_admins WHERE user_id=_user_id) $$;
CREATE FUNCTION public.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT EXISTS(SELECT 1 FROM public.fixture_platform_admins WHERE user_id=$1) $$;
CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT EXISTS(SELECT 1 FROM public.fixture_platform_admins WHERE user_id=auth.uid()) $$;
CREATE FUNCTION public.is_platform_operator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT public.is_platform_owner() OR public.is_platform_admin() $$;
CREATE FUNCTION public.agency_can_manage_child(_child uuid, _actor uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT EXISTS(SELECT 1 FROM public.fixture_agency_managers WHERE tenant_id=_child AND user_id=_actor) $$;
CREATE FUNCTION public.resolve_actor_tier(_user uuid, _tenant uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'tenant'::text $$;
CREATE FUNCTION public.resolve_tenant_brand(_tenant_id uuid) RETURNS TABLE(id uuid, name text, slug text, logo_url text,
 logo_dark_url text, primary_color text, accent_color text) LANGUAGE sql STABLE AS $$
 SELECT t.id, t.name, t.slug, NULL::text, NULL::text, '#150C31'::text, '#EBB94C'::text FROM public.tenants t WHERE t.id = _tenant_id $$;
CREATE FUNCTION public.tenant_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END $function$;

-- ── REAL, LOADED FROM THE MIGRATION CHAIN ────────────────────────────────────────────────────────
\set d_icw `sed -n '/^CREATE OR REPLACE FUNCTION public.is_company_workspace(_tenant uuid)/,/^\$\$;$/p' supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql`
\set d_ito `sed -n '/^CREATE OR REPLACE FUNCTION public.is_tenant_owner(_user_id uuid/,/\$function\$;$/p' supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql`
\set d_ita `sed -n '/^CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid)/,/\$function\$;$/p' supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql`
\set d_itm `sed -n '/^CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant uuid)/,/\$function\$;$/p' supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql`
\set d_ith `sed -n '/^CREATE OR REPLACE FUNCTION public.is_tenant_account_holder(/,/\$function\$;$/p' supabase/migrations/20271116020008_exp08_co_owner_authority.sql`
\set d_gtc `sed -n '/^CREATE OR REPLACE FUNCTION public.guard_tenant_owner_only_columns()/,/\$function\$;$/p' supabase/migrations/20271116020008_exp08_co_owner_authority.sql`
\set d_gof `sed -n '/^CREATE OR REPLACE FUNCTION public.guard_tenant_member_owner_flag()/,/\$function\$;$/p' supabase/migrations/20260803190000_slice_a_multi_owner_is_owner.sql`
\set d_auth `sed -n '/^CREATE OR REPLACE FUNCTION public.solo_team_invite_authority(/,/\$function\$;$/p' supabase/migrations/20261047000000_an_invitation_is_sent_to_the_workspace_the_owner_named.sql`
\set d_rev `sed -n '/^CREATE OR REPLACE FUNCTION public.revoke_solo_team_invite(/,/\$function\$;$/p' supabase/migrations/20261047000000_an_invitation_is_sent_to_the_workspace_the_owner_named.sql`
\set d_arc `sed -n '/^CREATE OR REPLACE FUNCTION public.archive_solo_team_invite(/,/\$function\$;$/p' supabase/migrations/20261105000000_an_invitation_says_what_happened_to_it.sql`
\set d_cre `sed -n '/^CREATE OR REPLACE FUNCTION public.create_solo_team_invite(/,/\$function\$;$/p' supabase/migrations/20271115040008_exp08_team_lifecycle.sql`
\set d_res `sed -n '/^CREATE OR REPLACE FUNCTION public.resend_solo_team_invite(/,/\$function\$;$/p' supabase/migrations/20271115040008_exp08_team_lifecycle.sql`
\set d_acs `sed -n '/^CREATE OR REPLACE FUNCTION public.accept_solo_team_invite(/,/\$function\$;$/p' supabase/migrations/20271115040008_exp08_team_lifecycle.sql`
\set d_act `sed -n '/^CREATE OR REPLACE FUNCTION public.accept_tenant_invite(/,/\$function\$;$/p' supabase/migrations/20271115040008_exp08_team_lifecycle.sql`
\set d_con `sed -n '/^CREATE OR REPLACE FUNCTION public.enforce_tenant_member_consent()/,/\$function\$;$/p' supabase/migrations/20271115040008_exp08_team_lifecycle.sql`
\set d_rei `sed -n '/^CREATE OR REPLACE FUNCTION public._tenant_member_reinstating(/,/^\$\$;$/p' supabase/migrations/20271115040008_exp08_team_lifecycle.sql`
\set d_ctt `sed -n '/^CREATE OR REPLACE FUNCTION public.create_tenant_invite_token(/,/\$function\$;$/p' supabase/migrations/20260824000000_enterprise_hybrid_consumer_invite.sql`
\set d_sti `sed -n '/^CREATE OR REPLACE FUNCTION public.stamp_tier_send_invite()/,/\$function\$;$/p' supabase/migrations/20260714142748_tier_rail_phaseC.sql`
\set d_cpg `sed -n '/^CREATE FUNCTION public._client_portal_invitation_binding_guard()/,/END \$\$;$/p' supabase/migrations/20271108233000_e09_customer_invitation_operation.sql`
\set d_gat `sed -n '/^CREATE OR REPLACE FUNCTION public.guard_archived_tenant_membership()/,/\$\$;$/p' supabase/migrations/20270602000203_operator_account_archive.sql`
SELECT (length(:'d_icw') > 100 AND length(:'d_ito') > 300 AND length(:'d_ita') > 100 AND length(:'d_itm') > 100 AND length(:'d_ith') > 100
    AND length(:'d_gtc') > 1000 AND length(:'d_gof') > 500 AND length(:'d_auth') > 500 AND length(:'d_rev') > 300
    AND length(:'d_arc') > 500 AND length(:'d_cre') > 1500 AND length(:'d_res') > 500 AND length(:'d_acs') > 1500
    AND length(:'d_act') > 4000 AND length(:'d_con') > 1000 AND length(:'d_rei') > 50 AND length(:'d_ctt') > 1500
    AND length(:'d_sti') > 100 AND length(:'d_cpg') > 300 AND length(:'d_gat') > 50) AS chain_loaded \gset
\if :chain_loaded
\else
  DO $$ BEGIN RAISE EXCEPTION 'FAIL: could not read the chain bodies; run this proof from the repository root'; END $$;
\endif
:d_icw
:d_ito
:d_ita
:d_itm
:d_ith
:d_gtc
:d_gof
:d_auth
:d_rev
:d_arc
:d_cre
:d_res
:d_acs
:d_act
:d_con
:d_rei
:d_ctt
:d_sti
:d_cpg
:d_gat
-- peek_tenant_invite: production's body, verbatim (pg_get_functiondef, 2026-10-27).
CREATE OR REPLACE FUNCTION public.peek_tenant_invite(_token text)
 RETURNS TABLE(tenant_id uuid, tenant_name text, tenant_slug text, brand jsonb, kind text, default_role tenant_role, expires_at timestamp with time zone, is_valid boolean, invited_email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tok public.tenant_invite_tokens;
  _ten public.tenants;
  _rb  record;
BEGIN
  SELECT * INTO _tok FROM public.tenant_invite_tokens WHERE token = _token;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO _ten FROM public.tenants WHERE id = _tok.tenant_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO _rb FROM public.resolve_tenant_brand(_ten.id);

  tenant_id     := _ten.id;
  tenant_name   := _ten.name;
  tenant_slug   := _ten.slug;
  brand         := jsonb_build_object(
                     'logo_url',      _rb.logo_url,
                     'logo_dark_url', _rb.logo_dark_url,
                     'primary_color', _rb.primary_color,
                     'accent_color',  _rb.accent_color
                   );
  kind          := _tok.kind;
  default_role  := _tok.default_role;
  expires_at    := _tok.expires_at;
  invited_email := _tok.email;
  -- E09_CONSUMER_INVITE_PEEK_V1
  is_valid      := (_tok.revoked_at IS NULL)
                   AND (_tok.expires_at > now())
                   AND (_tok.max_uses IS NULL OR _tok.uses < _tok.max_uses)
                   AND (_tok.kind <> 'consumer' OR (_tok.uses = 0 AND _tok.last_used_at IS NULL));
  RETURN NEXT;
END $function$;

-- Production's ACLs on the functions under test (information_schema.routine_privileges, 2026-10-27).
REVOKE ALL ON FUNCTION public.create_solo_team_invite(uuid, uuid, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_solo_team_invite(uuid, uuid, text, text, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.resend_solo_team_invite(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resend_solo_team_invite(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.revoke_solo_team_invite(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_solo_team_invite(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.archive_solo_team_invite(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_solo_team_invite(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.solo_team_invite_authority(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.solo_team_invite_authority(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.accept_solo_team_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_solo_team_invite(text) TO authenticated;
REVOKE ALL ON FUNCTION public.accept_tenant_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_tenant_invite(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_tenant_account_holder(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_account_holder(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.peek_tenant_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_tenant_invite(text) TO anon, authenticated;

-- Production's triggers (pg_trigger, 2026-10-27) for the four tables, as far as these functions reach.
CREATE TRIGGER trg_guard_tenant_owner_cols BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_owner_only_columns();
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.tenant_set_updated_at();
CREATE TRIGGER a01_archived_tenant_membership BEFORE INSERT OR UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public.guard_archived_tenant_membership();
CREATE TRIGGER trg_tenant_members_consent BEFORE INSERT OR UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_member_consent();
CREATE TRIGGER trg_tenant_members_owner_guard BEFORE INSERT OR UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_member_owner_flag();
CREATE TRIGGER trg_tenant_members_updated_at BEFORE UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public.tenant_set_updated_at();
CREATE TRIGGER client_portal_invitation_binding_guard BEFORE INSERT OR UPDATE ON public.tenant_invite_tokens FOR EACH ROW EXECUTE FUNCTION public._client_portal_invitation_binding_guard();
CREATE TRIGGER trg_stamp_tier_send_invite BEFORE INSERT ON public.tenant_invite_tokens FOR EACH ROW EXECUTE FUNCTION public.stamp_tier_send_invite();
CREATE TRIGGER trg_tenant_invite_tokens_updated_at BEFORE UPDATE ON public.tenant_invite_tokens FOR EACH ROW EXECUTE FUNCTION public.tenant_set_updated_at();

-- Production's RLS and grants.
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_invite_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_business_owners ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_invite_tokens TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_members TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.tenant_members TO authenticated;   -- stronger than production (SELECT only)
REVOKE ALL ON public.tenant_business_owners FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.paige_audit_log, public.audit_logs TO service_role;
-- service_role has BYPASSRLS on Supabase; modelled here with an all-rows policy (no cluster role is altered).
CREATE POLICY "service role bypass (fixture)" ON public.tenants TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service role bypass (fixture)" ON public.tenant_invite_tokens TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Tenant admins manage invite tokens" ON public.tenant_invite_tokens
  FOR ALL TO authenticated
  USING (public.is_platform_owner() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_platform_owner() OR public.is_tenant_admin(tenant_id));
CREATE POLICY "Members read own tenant" ON public.tenants FOR SELECT TO authenticated
  USING (public.is_tenant_member(id) OR public.is_platform_owner());
CREATE POLICY "Tenant admins update own tenant" ON public.tenants FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(id) OR public.is_platform_owner())
  WITH CHECK (public.is_tenant_admin(id) OR public.is_platform_owner());
CREATE POLICY "Platform owner manages tenants" ON public.tenants FOR ALL TO authenticated
  USING (public.is_platform_owner()) WITH CHECK (public.is_platform_owner());

DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('create_solo_team_invite(uuid,uuid,text,text,text,text,boolean)','c002b98c2a117367ab487e21d88fcf08'),
   ('resend_solo_team_invite(uuid,uuid,uuid)','b6c0293243b3ae5161d45bf4f0f36973'),
   ('revoke_solo_team_invite(uuid,uuid,uuid)','2c4ed28dd36e7e7bc97d687fb6d93a82'),
   ('archive_solo_team_invite(uuid,uuid,uuid)','3dc08a57851eff073e72e8a56723cd2a'),
   ('accept_solo_team_invite(text)','de8a6ac14ef033515bb8d3247f4d1c84'),
   ('accept_tenant_invite(text)','177c271028efecfc63c23623ef3aff88'),
   ('create_tenant_invite_token(uuid,text,tenant_role,integer,integer,uuid,text)','3a91af3aeb67fb8dbbf450eb3d612ade'),
   ('guard_tenant_member_owner_flag()','011b8efe34db45a4f284517b85d6eed6'),
   ('guard_tenant_owner_only_columns()','d77a4bfab3aa53b73e592497acf0f46a'),
   ('is_tenant_account_holder(uuid,uuid)','4a3cab59aad7a70ff06a9054aa4aa60e'),
   ('solo_team_invite_authority(uuid,uuid)','6fee3e014b35dcc7f77503828f476e60'),
   ('peek_tenant_invite(text)','276541d0f26a55a1fd9697b8f9e2f858'),
   ('is_tenant_owner(uuid,uuid)','f392787e7469ed325960850ad091473d'),
   ('is_tenant_admin(uuid)','7d393ee77b2ebbc42791f0dce8dbcca5'),
   ('is_tenant_member(uuid)','f4df3c17e4d78b305986dd342e42b415'),
   ('is_company_workspace(uuid)','7944c5bde7171fbe4e6b2f03f090fe28'),
   ('enforce_tenant_member_consent()','780419e0d266f5bf8593ad0bb989a968'),
   ('_tenant_member_reinstating(uuid)','5cbe3b027b53d2b3ed624b51d1551f2a'),
   ('stamp_tier_send_invite()','452f15380dc34e5a7431464f7a698f4a'),
   ('_client_portal_invitation_binding_guard()','a9f6aa77a3662d65bb447ecb2d010ef0'),
   ('guard_archived_tenant_membership()','acf074d117a446ef2478aa0d43134d8a'),
   ('tenant_set_updated_at()','e3addd320004eb7a8494e7a0c2614c97')) v(sig, prod_md5) LOOP
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=('public.'||r.sig)::regprocedure) IS DISTINCT FROM r.prod_md5 THEN
   RAISE EXCEPTION 'FAIL: % is not the production body (md5(prosrc) differs from %)', r.sig, r.prod_md5; END IF;
 END LOOP; END $$;
\echo 'PASS: 22 of 22 real bodies are production''s (md5(prosrc), read 2026-10-27)'

-- ── FIXTURE ──────────────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA proof;
GRANT USAGE ON SCHEMA proof TO anon, authenticated, service_role;
CREATE FUNCTION proof.u(text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5('exp08-owners-i1:'||$1)::uuid $$;
CREATE FUNCTION proof.e(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower($1)||'@tests.invalid' $$;
CREATE FUNCTION proof.expect(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _ok IS NOT TRUE THEN RAISE EXCEPTION 'EXPECTATION_FALSE: %', _what USING ERRCODE='P0001'; END IF; END $$;
GRANT EXECUTE ON FUNCTION proof.u(text), proof.e(text), proof.expect(boolean, text) TO anon, authenticated, service_role;

-- People. Every one has a confirmed address. Morgan Hale (PS) is tenant S's holder, paused for billing.
INSERT INTO auth.users(id, email, email_confirmed_at)
SELECT proof.u(p), proof.e(p), now() FROM unnest(ARRAY['H','C1','AD','ME','HB','PS','CS','N1','D1','HG','GA','WH','HSUB',
 'LO','IV','P','INV1','INV2','INV3','OWN1','ADX','D2O','PRE']) p;
INSERT INTO public.profiles(user_id, full_name) VALUES (proof.u('PS'), 'Morgan Hale'), (proof.u('H'), 'Hollis Holder');
-- Tenants. A: a standalone Solo account, holder H, co-owner C1, admin AD, member ME.
--   B: another Solo account (holder HB): the cross-tenant record's home.
--   S: holder PS whose owner seat is SUSPENDED (billing), co-owner CS: state 'paused'.
--   N: no holder of record, owner N1: state 'none'. D: a holder pointer at no auth.users row, owner D1: 'none'.
--   G: an AGENCY (holder HG, admin GA). W: a COMPANY workspace (holder WH). SUB: a sub-account of G (holder HSUB).
--   L: no holder, sole active owner LO (the #227 carve-out). SH: an empty shell (the sub-account owner path).
--   D2: the holder of record GHOST was deleted from auth.users but left an ACTIVE owner seat; owner D2O.
INSERT INTO public.tenants(id, name, slug, owner_user_id, account_type, parent_tenant_id, features) VALUES
 (proof.u('A'), 'Northstar Studio', 'northstar', proof.u('H'), 'standalone', NULL, '{}'),
 (proof.u('B'), 'Tenant B', 'tb', proof.u('HB'), 'standalone', NULL, '{}'),
 (proof.u('S'), 'Tenant S', 'ts', proof.u('PS'), 'standalone', NULL, '{}'),
 (proof.u('N'), 'Tenant N', 'tn', NULL, 'standalone', NULL, '{}'),
 (proof.u('D'), 'Tenant D', 'td', proof.u('GONE'), 'standalone', NULL, '{}'),
 (proof.u('G'), 'Agency G', 'tg', proof.u('HG'), 'agency', NULL, '{}'),
 (proof.u('W'), 'Company W', 'tw', proof.u('WH'), 'standalone', NULL, '{"system_workspace": true}'),
 (proof.u('SUB'), 'Sub-account SUB', 'tsub', proof.u('HSUB'), 'sub_account', proof.u('G'), '{}'),
 (proof.u('L'), 'Tenant L', 'tl', NULL, 'standalone', NULL, '{}'),
 (proof.u('SH'), 'Shell SH', 'tsh', NULL, 'sub_account', proof.u('G'), '{}'),
 (proof.u('D2'), 'Tenant D2', 'td2', proof.u('GHOST'), 'standalone', NULL, '{}');
INSERT INTO public.tenant_members(tenant_id, user_id, role, status, is_owner)
SELECT proof.u(t), proof.u(p), r::public.tenant_role, s, o FROM (VALUES
 ('A','H','owner','active',true), ('A','C1','owner','active',true), ('A','AD','admin','active',false),
 ('A','ME','member','active',false), ('B','HB','owner','active',true),
 ('S','PS','owner','suspended',true), ('S','CS','owner','active',true),
 ('N','N1','owner','active',true), ('D','D1','owner','active',true),
 ('G','HG','owner','active',true), ('G','GA','admin','active',false),
 ('W','WH','owner','active',true), ('SUB','HSUB','owner','active',true),
 ('L','LO','owner','active',true), ('D2','GHOST','owner','active',true), ('D2','D2O','owner','active',true)) v(t,p,r,s,o);
INSERT INTO public.fixture_super_admins VALUES (proof.u('P'));
-- Legal owners (tenant_business_owners). A: a company, a trust and an individual; B: a company.
INSERT INTO public.tenant_business_owners(id, tenant_id, owner_kind, legal_name, created_by, updated_by) VALUES
 (proof.u('RA_CO'), proof.u('A'), 'company', 'Harbor Lane Holdings LLC', proof.u('H'), proof.u('H')),
 (proof.u('RA_TR'), proof.u('A'), 'trust', 'Cedar Row Trust', proof.u('H'), proof.u('H')),
 (proof.u('RA_IND'), proof.u('A'), 'individual', 'Morgan Hale', proof.u('H'), proof.u('H')),
 (proof.u('RB_CO'), proof.u('B'), 'company', 'Northwind Partners LP', proof.u('HB'), proof.u('HB'));
-- Invitations, written as the table owner (no guard is involved in creating the fixture).
INSERT INTO public.tenant_invite_tokens(id, tenant_id, token, kind, default_role, created_by, expires_at, max_uses, uses,
 revoked_at, email, agency_role, contact_id) VALUES
 (proof.u('T_ADM'), proof.u('A'), 'tok-adm', 'team', 'admin', proof.u('AD'), now() + interval '7 days', 1, 0, NULL, proof.e('INV2'), NULL, NULL),
 (proof.u('T_OWN'), proof.u('A'), 'tok-own', 'team', 'owner', proof.u('H'), now() + interval '7 days', 1, 0, NULL, proof.e('OWN1'), NULL, NULL),
 (proof.u('T_OWN_REV'), proof.u('A'), 'tok-own-rev', 'team', 'owner', proof.u('H'), now() + interval '7 days', 1, 0, '2026-01-01T00:00:00Z', proof.e('INV3'), NULL, NULL),
 (proof.u('T_OWN_USED'), proof.u('A'), 'tok-own-used', 'team', 'owner', proof.u('H'), now() + interval '7 days', 1, 1, NULL, proof.e('INV3'), NULL, NULL),
 (proof.u('T_REV'), proof.u('A'), 'tok-rev', 'team', 'member', proof.u('AD'), now() + interval '7 days', 1, 0, '2026-01-01T00:00:00Z', proof.e('INV3'), NULL, NULL),
 (proof.u('T_AG'), proof.u('G'), 'tok-ag', 'agency_team', 'member', proof.u('HG'), now() + interval '7 days', 1, 0, NULL, proof.e('INV3'), 'agency_viewer', NULL),
 (proof.u('T_CONS'), proof.u('A'), 'tok-cons', 'consumer', 'member', proof.u('AD'), now() + interval '7 days', 1, 0, NULL, proof.e('INV3'), NULL, proof.u('CONTACT')),
 (proof.u('T_CONS2'), proof.u('A'), 'tok-cons2', 'consumer', 'member', proof.u('AD'), now() + interval '7 days', 1, 0, NULL, proof.e('INV2'), NULL, proof.u('CONTACT2'));

-- ── PROOF HELPERS ────────────────────────────────────────────────────────────────────────────────
-- Run SQL as trusted server code with NO JWT (service role / migration context): auth.uid() IS NULL.
CREATE FUNCTION proof.trusted(_sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE _c text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE _sql;
  PERFORM set_config('request.jwt.claims', COALESCE(_c, ''), true);
END $$;
-- Run SQL as a postgres-owned SECURITY DEFINER under the CALLER's JWT (how set_client_portal_access
-- and the other definer writers run).
CREATE FUNCTION proof.as_definer(_sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN EXECUTE _sql; END $$;
-- The account holder (or anyone named) creating an owner invitation through the real function, as the
-- solo-team-invitations edge does (service role, actor passed). Returns the token.
CREATE FUNCTION proof.mint_owner(_t text, _actor text, _email text, _rec text DEFAULT NULL) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE _r jsonb; _c text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  EXECUTE 'SELECT public.create_solo_team_invite($1, $2, $3, ''owner'', NULL, NULL, true, $4)'
    INTO _r USING proof.u(_actor), proof.u(_t), _email, CASE WHEN _rec IS NULL THEN NULL ELSE proof.u(_rec) END;
  PERFORM set_config('request.jwt.claims', COALESCE(_c, ''), true);
  RETURN _r->>'token';
END $$;
-- The exact token statements of set_client_portal_access (20271111010000:441-443) and
-- create_client_portal_invitation (20271108233000:162-163), run as postgres-owned definer code.
CREATE FUNCTION proof.portal_writer() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.tenant_invite_tokens tk SET revoked_at = now()
      WHERE tk.contact_id = proof.u('CONTACT') AND tk.tenant_id = proof.u('A') AND tk.kind = 'consumer'
        AND tk.revoked_at IS NULL AND tk.last_used_at IS NULL;
  UPDATE public.tenant_invite_tokens SET portal_operation_id=proof.u('OP'),
    portal_proposal_hash=repeat('a', 64),portal_receipt_id=proof.u('RCPT') WHERE id=proof.u('T_CONS2');
END $$;
-- DOUBLE of accept_tenant_invite's 'subaccount_owner' establishment (20271115040008 L1527-1540), as
-- in exp08_co_owner_authority.sql: the one JWT-bearing producer of tenants.owner_user_id.
CREATE FUNCTION proof.accept_owner_path(_tenant uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
      INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at)
      VALUES (_tenant, _uid, 'owner'::public.tenant_role, 'active', true, now())
      ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET is_owner  = true,
            role      = 'owner'::public.tenant_role,
            status    = 'active',
            joined_at = COALESCE(public.tenant_members.joined_at, now()),
            updated_at = now();
      UPDATE public.tenants
         SET owner_user_id = _uid, updated_at = now()
       WHERE id = _tenant AND owner_user_id IS NULL;
END $$;
-- What owner recovery (a later increment) will do: set the flag transaction-locally around ONE UPDATE
-- of owner_user_id, inside postgres-owned code, under the caller's JWT.
CREATE FUNCTION proof.recovery_double(_tenant uuid, _to uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public' AS $$
BEGIN
  PERFORM set_config('paige.owner_recovery', 'on', true);
  UPDATE public.tenants SET owner_user_id = _to WHERE id = _tenant;
  PERFORM set_config('paige.owner_recovery', 'off', true);
END $$;
GRANT EXECUTE ON FUNCTION proof.trusted(text), proof.as_definer(text), proof.mint_owner(text, text, text, text),
 proof.portal_writer(), proof.accept_owner_path(uuid), proof.recovery_double(uuid, uuid) TO anon, authenticated, service_role;

-- SQL snippets the cases share.
CREATE FUNCTION proof.cre(_actor text, _t text, _email text, _perm text, _rec text DEFAULT NULL, _new jsonb DEFAULT NULL, _hub boolean DEFAULT true)
 RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT format('SELECT public.create_solo_team_invite(proof.u(%L), proof.u(%L), %L, %L, NULL, NULL, %L%s%s)',
   _actor, _t, _email, _perm, _hub,
   CASE WHEN _rec IS NULL AND _new IS NULL THEN '' WHEN _rec IS NULL THEN ', NULL' ELSE format(', proof.u(%L)', _rec) END,
   CASE WHEN _new IS NULL THEN '' ELSE format(', %L::jsonb', _new) END) $$;
CREATE FUNCTION proof.tok(_id text, _cond text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT format('EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE id = proof.u(%L) AND %s)', _id, _cond) $$;
CREATE FUNCTION proof.seat(_t text, _p text, _cond text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT format('EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id = proof.u(%L) AND user_id = proof.u(%L) AND %s)', _t, _p, _cond) $$;
CREATE FUNCTION proof.noseat(_t text, _p text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT format('NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id = proof.u(%L) AND user_id = proof.u(%L))', _t, _p) $$;
-- A direct client UPDATE that must touch exactly one row (so RLS cannot fake a refusal or a success).
CREATE FUNCTION proof.upd(_table text, _set text, _where text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT format('WITH u AS (UPDATE public.%s SET %s WHERE %s RETURNING 1) SELECT proof.expect(count(*) = 1, ''exactly one row updated'') FROM u', _table, _set, _where) $$;
CREATE FUNCTION proof.del(_table text, _where text) RETURNS text LANGUAGE sql IMMUTABLE AS
 $$ SELECT format('WITH d AS (DELETE FROM public.%s WHERE %s RETURNING 1) SELECT proof.expect(count(*) = 1, ''exactly one row deleted'') FROM d', _table, _where) $$;

-- ── CASES ────────────────────────────────────────────────────────────────────────────────────────
-- kind: 'kept' = same outcome before and after; 'hole' = production lets it THROUGH and it must be
-- refused (or production's post-state is wrong); 'new' = the owner capability, which production lacks.
CREATE TABLE proof.checks(n serial, id text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('kept','hole','new')),
 as_role text NOT NULL DEFAULT 'authenticated', actor text, call text NOT NULL, expect text NOT NULL DEFAULT '00000',
 msg text, post text, hint text);

-- ── Case 1: escalation ───────────────────────────────────────────────────────────────────────────
INSERT INTO proof.checks(id, kind, as_role, actor, call, expect, msg, post) VALUES
 -- R14 (2026-10-27, keep as today): admins invite admins and members.
 ('1.01 admin invites an Admin', 'kept', 'service_role', NULL, proof.cre('AD','A',proof.e('NEWA'),'admin'), '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE email = proof.e('NEWA') AND default_role = 'admin' AND created_by = proof.u('AD') AND revoked_at IS NULL)$p$),
 ('1.02 admin invites a Member', 'kept', 'service_role', NULL, proof.cre('AD','A',proof.e('NEWM'),'member'), '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE email = proof.e('NEWM') AND default_role = 'member')$p$),
 ('1.03 account holder invites an Owner (a person)', 'new', 'service_role', NULL, proof.cre('H','A',proof.e('NEWO'),'owner'), '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE email = proof.e('NEWO') AND kind = 'team' AND default_role = 'owner' AND business_owner_id IS NULL AND team_hub_access AND created_by = proof.u('H'))$p$),
 ('1.04 co-owner invites an Owner', 'new', 'service_role', NULL, proof.cre('C1','A',proof.e('NEWO'),'owner'), '42501', 'Only the account holder can add owners to this business.', NULL),
 ('1.05 admin invites an Owner', 'new', 'service_role', NULL, proof.cre('AD','A',proof.e('NEWO'),'owner'), '42501', 'Only the account holder can add owners to this business.', NULL),
 ('1.06 member invites anyone', 'kept', 'service_role', NULL, proof.cre('ME','A',proof.e('NEWO'),'owner'), '42501', 'only an owner or admin may manage team invitations', NULL),
 ('1.07 admin direct INSERT of an owner token', 'hole', 'authenticated', 'AD',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-own', 'team', 'owner', proof.u('AD'), proof.e('X'), 1)$c$, '42501', NULL, NULL),
 ('1.08 admin direct INSERT with a forged created_by', 'hole', 'authenticated', 'AD',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-forged', 'team', 'member', proof.u('H'), proof.e('X'), 1)$c$, '42501', NULL, NULL),
 ('1.09 platform owner direct INSERT of an owner token', 'hole', 'authenticated', 'P',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-p-own', 'team', 'owner', proof.u('P'), proof.e('X'), 1)$c$, '42501', NULL, NULL),
 ('1.10 platform owner direct INSERT of a sub-account owner token in another minter''s name', 'hole', 'authenticated', 'P',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('SH'), 'x-p-sub', 'subaccount_owner', 'admin', proof.u('HG'), proof.e('X'), 1)$c$, '42501', NULL, NULL),
 ('1.11 admin direct INSERT of its own member token', 'kept', 'authenticated', 'AD',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-own-member', 'team', 'member', proof.u('AD'), proof.e('X'), 1)$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE token = 'x-own-member')$p$),
 ('1.12a admin UPDATE default_role of a pending invitation', 'hole', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$default_role = 'owner'$s$, $w$id = proof.u('T_ADM')$w$), '42501', NULL, NULL),
 ('1.12b admin UPDATE expires_at of a pending invitation', 'hole', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$expires_at = now() + interval '90 days'$s$, $w$id = proof.u('T_ADM')$w$), '42501', NULL, NULL),
 ('1.12c admin UPDATE uses of a pending invitation', 'hole', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$uses = 0, max_uses = 99$s$, $w$id = proof.u('T_ADM')$w$), '42501', NULL, NULL),
 ('1.12d admin UPDATE email of a pending invitation', 'hole', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$email = 'attacker@tests.invalid'$s$, $w$id = proof.u('T_ADM')$w$), '42501', NULL, NULL),
 ('1.12e admin UPDATE contact_id of a consumer invitation', 'hole', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$contact_id = proof.u('OTHER_CONTACT')$s$, $w$id = proof.u('T_CONS')$w$), '42501', NULL, NULL),
 ('1.12f admin UPDATE token / kind / team_hub_access / archived_at', 'hole', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$token = 'chosen', kind = 'consumer', team_hub_access = false, archived_at = now()$s$, $w$id = proof.u('T_ADM')$w$), '42501', NULL, NULL),
 ('1.12g admin UPDATE created_by / tenant_id', 'hole', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$created_by = proof.u('H')$s$, $w$id = proof.u('T_ADM')$w$), '42501', NULL, NULL),
 ('1.12h admin UPDATE portal_* of a consumer invitation', 'kept', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$portal_operation_id = proof.u('OP'), portal_proposal_hash = repeat('b',64), portal_receipt_id = proof.u('R')$s$, $w$id = proof.u('T_CONS2')$w$), '42501', 'CUSTOMER_INVITATION_NATIVE_BINDING_REQUIRED', NULL),
 ('1.12i business_owner_id: admin UPDATE onto a pending invitation', 'new', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$business_owner_id = proof.u('RA_CO')$s$, $w$id = proof.u('T_ADM')$w$), '42501', 'INVITE_GUARD', NULL),
 ('1.14 agency admin UPDATE agency_role on a pending agency invitation', 'hole', 'authenticated', 'GA', proof.upd('tenant_invite_tokens', $s$agency_role = 'agency_admin'$s$, $w$id = proof.u('T_AG')$w$), '42501', NULL, NULL),
 ('1.16a admin un-revokes a withdrawn owner invitation', 'hole', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$revoked_at = NULL$s$, $w$id = proof.u('T_OWN_REV')$w$), '42501', NULL, NULL),
 ('1.16b admin un-revokes a withdrawn member invitation', 'hole', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$revoked_at = NULL$s$, $w$id = proof.u('T_REV')$w$), '42501', NULL, NULL),
 ('1.17 admin resets uses on an accepted owner invitation', 'hole', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$uses = 0$s$, $w$id = proof.u('T_OWN_USED')$w$), '42501', NULL, NULL),
 ('1.18 admin extends a withdrawn owner invitation', 'hole', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$expires_at = now() + interval '90 days'$s$, $w$id = proof.u('T_OWN_REV')$w$), '42501', NULL, NULL),
 ('1.19a admin DELETE of a pending owner invitation', 'hole', 'authenticated', 'AD', proof.del('tenant_invite_tokens', $w$id = proof.u('T_OWN')$w$), '42501', NULL, NULL),
 ('1.19b admin revokes a pending owner invitation from the legacy panel', 'hole', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$revoked_at = now()$s$, $w$id = proof.u('T_OWN')$w$), '42501', 'Only the account holder can change an owner invitation.', NULL),
 ('1.19c the holder revokes an owner invitation by direct UPDATE (only the functions may)', 'hole', 'authenticated', 'H', proof.upd('tenant_invite_tokens', $s$revoked_at = now()$s$, $w$id = proof.u('T_OWN')$w$), '42501', NULL, NULL),
 ('1.21 admin revokes a pending admin invitation (WorkspaceSettingsPanel)', 'kept', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$revoked_at = now()$s$, $w$id = proof.u('T_ADM')$w$), '00000', NULL,
   proof.tok('T_ADM', 'revoked_at IS NOT NULL')),
 ('1.22 a second revoke keeps the first revocation time', 'hole', 'authenticated', 'AD', proof.upd('tenant_invite_tokens', $s$revoked_at = now()$s$, $w$id = proof.u('T_REV')$w$), '00000', NULL,
   proof.tok('T_REV', $q$revoked_at = '2026-01-01T00:00:00Z'::timestamptz$q$)),
 ('1.23 admin DELETE of a pending non-owner invitation', 'kept', 'authenticated', 'AD', proof.del('tenant_invite_tokens', $w$id = proof.u('T_ADM')$w$), '00000', NULL,
   $p$NOT EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE id = proof.u('T_ADM'))$p$),
 ('1.24 service role inserts an agency invitation (agency-invite-member)', 'kept', 'service_role', NULL,
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, agency_role, created_by, email, max_uses) VALUES (proof.u('G'), 'x-agency', 'agency_team', 'member', 'agency_viewer', proof.u('HG'), proof.e('X'), 1)$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE token = 'x-agency' AND agency_role = 'agency_viewer')$p$),
 ('1.25 postgres-owned portal writers (set_client_portal_access revoke, create_client_portal_invitation stamp)', 'kept', 'authenticated', 'AD', $c$SELECT proof.portal_writer()$c$, '00000', NULL,
   proof.tok('T_CONS', 'revoked_at IS NOT NULL')||' AND '||proof.tok('T_CONS2', 'portal_operation_id IS NOT NULL')),
 ('1.26 account holder mints an owner token through create_tenant_invite_token', 'hole', 'authenticated', 'H',
   $c$SELECT public.create_tenant_invite_token(proof.u('A'), 'team', 'owner'::public.tenant_role, 7, 1, NULL, proof.e('X'))$c$, '42501', 'Owners are added only by this business''s account holder, from Settings → Team. You can invite an Admin or Member here.', NULL),
 ('1.27 platform owner mints an owner token through create_tenant_invite_token', 'hole', 'authenticated', 'P',
   $c$SELECT public.create_tenant_invite_token(proof.u('A'), 'consumer', 'owner'::public.tenant_role, 7, 1, NULL, proof.e('X'))$c$, '42501', 'Owners are added only by this business''s account holder, from Settings → Team. You can invite an Admin or Member here.', NULL),
 ('1.28 admin mints a team admin token through create_tenant_invite_token', 'kept', 'authenticated', 'AD',
   $c$SELECT public.create_tenant_invite_token(proof.u('A'), 'team', 'admin'::public.tenant_role, 7, 1, NULL, proof.e('X'))$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE email = proof.e('X') AND default_role = 'admin' AND created_by = proof.u('AD'))$p$),
 ('1.29 a legacy owner token through accept_tenant_invite', 'hole', 'authenticated', 'OWN1',
   $c$SELECT public.accept_tenant_invite('tok-own')$c$, '42501', 'this invitation can''t be accepted here', NULL),
 ('1.29b ... and nothing was written', 'hole', 'authenticated', 'OWN1',
   $c$DO $d$ BEGIN PERFORM public.accept_tenant_invite('tok-own'); EXCEPTION WHEN insufficient_privilege THEN NULL; END $d$$c$, '00000', NULL,
   proof.noseat('A','OWN1')||' AND '||proof.tok('T_OWN', 'uses = 0')),
 ('1.30 an admin token through accept_tenant_invite still seats an admin', 'kept', 'authenticated', 'INV2',
   $c$SELECT public.accept_tenant_invite('tok-adm')$c$, '00000', NULL, proof.seat('A','INV2', $q$role = 'admin' AND NOT is_owner$q$)),
 ('1.31 admin re-invites the same address (the replace path)', 'kept', 'service_role', NULL, proof.cre('AD','A',proof.e('INV2'),'member'), '00000', NULL,
   proof.tok('T_ADM', 'revoked_at IS NOT NULL')),
 ('1.32a admin resends an admin invitation', 'kept', 'service_role', NULL, $c$SELECT public.resend_solo_team_invite(proof.u('AD'), proof.u('A'), proof.u('T_ADM'))$c$, '00000', NULL, proof.tok('T_ADM', 'revoked_at IS NOT NULL')),
 ('1.32b admin revokes an admin invitation', 'kept', 'service_role', NULL, $c$SELECT public.revoke_solo_team_invite(proof.u('AD'), proof.u('A'), proof.u('T_ADM'))$c$, '00000', NULL, proof.tok('T_ADM', 'revoked_at IS NOT NULL')),
 ('1.32c admin clears a revoked member invitation', 'kept', 'service_role', NULL, $c$SELECT public.archive_solo_team_invite(proof.u('AD'), proof.u('A'), proof.u('T_REV'))$c$, '00000', NULL, proof.tok('T_REV', 'archived_at IS NOT NULL')),
 ('1.33a account holder resends an owner invitation', 'new', 'service_role', NULL, $c$SELECT public.resend_solo_team_invite(proof.u('H'), proof.u('A'), proof.u('T_OWN'))$c$, '00000', NULL,
   proof.tok('T_OWN', 'revoked_at IS NOT NULL')||$p$ AND EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE email = proof.e('OWN1') AND default_role = 'owner' AND revoked_at IS NULL)$p$),
 ('1.33b account holder withdraws an owner invitation', 'kept', 'service_role', NULL, $c$SELECT public.revoke_solo_team_invite(proof.u('H'), proof.u('A'), proof.u('T_OWN'))$c$, '00000', NULL, proof.tok('T_OWN', 'revoked_at IS NOT NULL')),
 ('1.33c account holder clears a withdrawn owner invitation', 'kept', 'service_role', NULL, $c$SELECT public.archive_solo_team_invite(proof.u('H'), proof.u('A'), proof.u('T_OWN_REV'))$c$, '00000', NULL, proof.tok('T_OWN_REV', 'archived_at IS NOT NULL')),
 ('1.34a co-owner withdraws an owner invitation', 'hole', 'service_role', NULL, $c$SELECT public.revoke_solo_team_invite(proof.u('C1'), proof.u('A'), proof.u('T_OWN'))$c$, '42501', 'Only the account holder can change an owner invitation.', NULL),
 ('1.34b admin resends an owner invitation', 'new', 'service_role', NULL, $c$SELECT public.resend_solo_team_invite(proof.u('AD'), proof.u('A'), proof.u('T_OWN'))$c$, '42501', 'Only the account holder can change an owner invitation.', NULL),
 ('1.34c admin clears a withdrawn owner invitation', 'hole', 'service_role', NULL, $c$SELECT public.archive_solo_team_invite(proof.u('AD'), proof.u('A'), proof.u('T_OWN_REV'))$c$, '42501', 'Only the account holder can change an owner invitation.', NULL),
 ('1.35 admin invites an address that has a live owner invitation', 'hole', 'service_role', NULL, proof.cre('AD','A',proof.e('OWN1'),'member'), '42501', 'There''s already an owner invitation for this address. Only the account holder can change it.', NULL),
 ('1.36 account holder re-invites that address as an Admin (replaces it)', 'kept', 'service_role', NULL, proof.cre('H','A',proof.e('OWN1'),'admin'), '00000', NULL, proof.tok('T_OWN', 'revoked_at IS NOT NULL')),
 ('1.37 paused account holder: a co-owner invites an Owner', 'new', 'service_role', NULL, proof.cre('CS','S',proof.e('NEWO'),'owner'), '42501', 'Morgan Hale''s access is paused for billing, so no one can add owners or change another owner''s access until it''s back. Nothing changed.', NULL),
 ('1.38 no account holder: an owner invites an Owner', 'new', 'service_role', NULL, proof.cre('N1','N',proof.e('NEWO'),'owner'), '42501', 'Tenant N has no account holder right now, so no one can add owners or change another owner''s access. Contact the Paige team.', NULL),
 ('1.39 a holder pointer at a deleted user is no account holder', 'new', 'service_role', NULL, proof.cre('D1','D',proof.e('NEWO'),'owner'), '42501', 'Tenant D has no account holder right now', NULL),
 ('1.39b a holder pointer at a deleted user who left an active owner seat is still no account holder', 'new', 'service_role', NULL, proof.cre('D2O','D2',proof.e('NEWO'),'owner'), '42501', 'Tenant D2 has no account holder right now', NULL),
 ('1.40 the paused holder''s own refusal (helper, as the function owner)', 'new', 'postgres', NULL, $c$SELECT public._assert_tenant_account_holder(proof.u('PS'), proof.u('S'), 'add')$c$, '42501', 'Your access to Tenant S is paused for billing, so you can''t add or change owners until it''s back. Nothing changed.', NULL),
 ('1.41 owner invitation with team conversations off', 'new', 'service_role', NULL, proof.cre('H','A',proof.e('NEWO'),'owner', NULL, NULL, false), 'P0001', 'Owners always take part in team conversations.', NULL);

-- ── Case 2: accept-time ──────────────────────────────────────────────────────────────────────────
INSERT INTO proof.checks(id, kind, as_role, actor, call, expect, msg, post) VALUES
 ('2.01 a person accepts an owner invitation', 'new', 'authenticated', 'INV1',
   $c$SELECT public.accept_solo_team_invite(proof.mint_owner('A', 'H', proof.e('INV1')))$c$, '00000', NULL,
   proof.seat('A','INV1', $q$is_owner AND role = 'owner' AND status = 'active' AND team_hub_access AND business_owner_id IS NULL$q$)),
 ('2.02 a representative accepts for a legal owner', 'new', 'authenticated', 'INV1',
   $c$SELECT public.accept_solo_team_invite(proof.mint_owner('A', 'H', proof.e('INV1'), 'RA_CO'))$c$, '00000', NULL,
   proof.seat('A','INV1', $q$is_owner AND role = 'owner' AND business_owner_id = proof.u('RA_CO')$q$)
   ||$p$ AND EXISTS(SELECT 1 FROM public.tenant_business_owners WHERE id = proof.u('RA_CO') AND representative_user_id = proof.u('INV1') AND owner_seat_vacant_since IS NULL AND ownership_status = 'active')
        AND EXISTS(SELECT 1 FROM public.paige_audit_log WHERE action = 'tenant:business_owner_representative_named' AND target_id = proof.u('RA_CO') AND actor_user_id = proof.u('INV1') AND payload ? 'previous_representative_user_id')$p$),
 ('2.03 accept after the sender''s owner seat is suspended', 'new', 'authenticated', 'INV1',
   $c$DO $d$ DECLARE _t text := proof.mint_owner('A', 'H', proof.e('INV1')); BEGIN
      PERFORM proof.trusted($s$UPDATE public.tenant_members SET status = 'suspended' WHERE tenant_id = proof.u('A') AND user_id = proof.u('H')$s$);
      PERFORM public.accept_solo_team_invite(_t); END $d$$c$, '42501',
   'This owner invitation can''t be used any more: the person who sent it can no longer add owners to Northstar Studio. Ask the account holder for a new one.', NULL),
 ('2.04 accept after the account holder of record moved', 'new', 'authenticated', 'INV1',
   $c$DO $d$ DECLARE _t text := proof.mint_owner('A', 'H', proof.e('INV1')); BEGIN
      PERFORM proof.trusted($s$UPDATE public.tenants SET owner_user_id = proof.u('C1') WHERE id = proof.u('A')$s$);
      PERFORM public.accept_solo_team_invite(_t); END $d$$c$, '42501', 'the person who sent it can no longer add owners', NULL),
 ('2.05 accept after the legal owner became an individual', 'new', 'authenticated', 'INV1',
   $c$DO $d$ DECLARE _t text := proof.mint_owner('A', 'H', proof.e('INV1'), 'RA_TR'); BEGIN
      PERFORM proof.trusted($s$UPDATE public.tenant_business_owners SET owner_kind = 'individual' WHERE id = proof.u('RA_TR')$s$);
      PERFORM public.accept_solo_team_invite(_t); END $d$$c$, '42501',
   'This owner invitation was for Cedar Row Trust, and that owner seat has changed since it was sent. Ask the account holder for a new invitation.', NULL),
 ('2.06 accept after the legal owner''s seat was filled', 'new', 'authenticated', 'INV1',
   $c$DO $d$ DECLARE _t text := proof.mint_owner('A', 'H', proof.e('INV1'), 'RA_TR'); BEGIN
      PERFORM proof.trusted($s$UPDATE public.tenant_members SET business_owner_id = proof.u('RA_TR') WHERE tenant_id = proof.u('A') AND user_id = proof.u('C1')$s$);
      PERFORM public.accept_solo_team_invite(_t); END $d$$c$, '42501', 'that owner seat has changed since it was sent', NULL),
 ('2.07 accept after the legal owner was deleted', 'new', 'authenticated', 'INV1',
   $c$DO $d$ DECLARE _t text := proof.mint_owner('A', 'H', proof.e('INV1'), 'RA_TR'); BEGIN
      PERFORM proof.trusted($s$DELETE FROM public.tenant_business_owners WHERE id = proof.u('RA_TR')$s$);
      PERFORM public.accept_solo_team_invite(_t); END $d$$c$, 'P0001', 'team invitation has been revoked', NULL),
 ('2.07b ... the deleted legal owner''s invitation is revoked and unlinked', 'new', 'authenticated', 'INV1',
   $c$DO $d$ DECLARE _t text := proof.mint_owner('A', 'H', proof.e('INV1'), 'RA_TR'); BEGIN
      PERFORM proof.trusted($s$DELETE FROM public.tenant_business_owners WHERE id = proof.u('RA_TR')$s$); END $d$$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE email = proof.e('INV1') AND default_role = 'owner' AND revoked_at IS NOT NULL AND business_owner_id IS NULL AND business_owner_removed_at IS NOT NULL)$p$),
 ('2.08 replaying an accepted owner invitation seats nobody twice', 'new', 'authenticated', 'INV1',
   $c$DO $d$ DECLARE _t text := proof.mint_owner('A', 'H', proof.e('INV1')); BEGIN
      PERFORM public.accept_solo_team_invite(_t);
      BEGIN PERFORM public.accept_solo_team_invite(_t); RAISE EXCEPTION USING ERRCODE = 'P0077', MESSAGE = 'replayed';
      EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM NOT LIKE '%already been accepted%' THEN RAISE; END IF; END; END $d$$c$, '00000', NULL,
   $p$(SELECT count(*) FROM public.tenant_members WHERE tenant_id = proof.u('A') AND user_id = proof.u('INV1')) = 1$p$),
 ('2.10 an expired owner invitation to ANOTHER address no longer blocks the legal owner', 'new', 'authenticated', 'INV1',
   $c$DO $d$ BEGIN
      PERFORM proof.trusted($s$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, expires_at, max_uses, email, business_owner_id) VALUES (proof.u('A'), 'tok-expired-tr', 'team', 'owner', proof.u('H'), now() - interval '1 day', 1, proof.e('OLDREP'), proof.u('RA_TR'))$s$);
      PERFORM proof.mint_owner('A', 'H', proof.e('INV1'), 'RA_TR'); END $d$$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE token = 'tok-expired-tr' AND revoked_at IS NOT NULL)
      AND EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE email = proof.e('INV1') AND business_owner_id = proof.u('RA_TR') AND revoked_at IS NULL)$p$),
 ('2.11 accept by another address', 'kept', 'authenticated', 'INV2', $c$SELECT public.accept_solo_team_invite('tok-own')$c$, '42501', 'team invitation belongs to a different email address', NULL),
 ('2.12 accept of an owner token on an agency account', 'new', 'authenticated', 'INV1',
   $c$DO $d$ BEGIN
      PERFORM proof.trusted($s$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, max_uses, email) VALUES (proof.u('G'), 'tok-g-own', 'team', 'owner', proof.u('HG'), 1, proof.e('INV1'))$s$);
      PERFORM public.accept_solo_team_invite('tok-g-own'); END $d$$c$, '42501', 'Owner invitations aren''t available for this account.', NULL),
 ('2.13 the sub-account''s account holder invites an Owner, who accepts', 'new', 'authenticated', 'INV1',
   $c$SELECT public.accept_solo_team_invite(proof.mint_owner('SUB', 'HSUB', proof.e('INV1')))$c$, '00000', NULL,
   proof.seat('SUB','INV1', $q$is_owner AND role = 'owner'$q$));

-- ── Case 6: cross-tenant and shape ───────────────────────────────────────────────────────────────
INSERT INTO proof.checks(id, kind, as_role, actor, call, expect, msg, post) VALUES
 ('6.01 another business''s legal owner', 'new', 'service_role', NULL, proof.cre('H','A',proof.e('NEWO'),'owner','RB_CO'), 'P0001', 'Choose the legal owner they represent.', NULL),
 ('6.02 an individual record', 'new', 'service_role', NULL, proof.cre('H','A',proof.e('NEWO'),'owner','RA_IND'), 'P0001', 'A person is invited as an owner in their own right, not as a legal owner.', NULL),
 ('6.03 two seats for one legal owner', 'new', 'service_role', NULL,
   $c$SELECT proof.trusted($s$UPDATE public.tenant_members SET business_owner_id = proof.u('RA_CO') WHERE tenant_id = proof.u('A') AND user_id IN (proof.u('H'), proof.u('C1'))$s$)$c$, '23505', NULL, NULL),
 ('6.04a a second live invitation for one legal owner', 'new', 'service_role', NULL,
   $c$SELECT proof.mint_owner('A','H',proof.e('REP1'),'RA_CO'), proof.mint_owner('A','H',proof.e('REP2'),'RA_CO')$c$, 'P0001', 'There''s already an owner invitation pending for Harbor Lane Holdings LLC.', NULL),
 ('6.04b a second live invitation for one legal owner, written directly', 'new', 'service_role', NULL,
   $c$DO $d$ BEGIN PERFORM proof.mint_owner('A','H',proof.e('REP1'),'RA_CO');
      PERFORM proof.trusted($s$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, max_uses, email, business_owner_id) VALUES (proof.u('A'), 'tok-dup', 'team', 'owner', proof.u('H'), 1, proof.e('REP2'), proof.u('RA_CO'))$s$); END $d$$c$, '23505', NULL, NULL),
 ('6.05a deleting a business with owner seats, owner invitations and legal owners (service role)', 'new', 'service_role', NULL,
   $c$DO $d$ BEGIN PERFORM proof.mint_owner('A','H',proof.e('REP1'),'RA_TR');
      PERFORM proof.trusted($s$UPDATE public.tenant_members SET business_owner_id = proof.u('RA_CO') WHERE tenant_id = proof.u('A') AND user_id = proof.u('C1')$s$);
      DELETE FROM public.tenants WHERE id = proof.u('A'); END $d$$c$, '00000', NULL,
   $p$NOT EXISTS(SELECT 1 FROM public.tenants WHERE id = proof.u('A')) AND NOT EXISTS(SELECT 1 FROM public.tenant_business_owners WHERE tenant_id = proof.u('A')) AND NOT EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE tenant_id = proof.u('A'))$p$),
 ('6.05b ... the same delete by the platform owner''s JWT (cascades run as the table owner)', 'new', 'authenticated', 'P',
   $c$DO $d$ BEGIN PERFORM proof.mint_owner('A','H',proof.e('REP1'),'RA_TR');
      PERFORM proof.trusted($s$UPDATE public.tenant_members SET business_owner_id = proof.u('RA_CO') WHERE tenant_id = proof.u('A') AND user_id = proof.u('C1')$s$);
      DELETE FROM public.tenants WHERE id = proof.u('A'); END $d$$c$, '00000', NULL,
   $p$NOT EXISTS(SELECT 1 FROM public.tenants WHERE id = proof.u('A'))$p$),
 ('6.06 a legal owner on a non-owner invitation (CHECK)', 'new', 'service_role', NULL,
   $c$SELECT proof.trusted($s$UPDATE public.tenant_invite_tokens SET business_owner_id = proof.u('RA_CO') WHERE id = proof.u('T_ADM')$s$)$c$, '23514', NULL, NULL),
 ('6.07 a legal owner on an admin seat (CHECK)', 'new', 'service_role', NULL,
   $c$SELECT proof.trusted($s$UPDATE public.tenant_members SET business_owner_id = proof.u('RA_CO') WHERE tenant_id = proof.u('A') AND user_id = proof.u('AD')$s$)$c$, '23514', NULL, NULL),
 ('6.08 an owner seat linked to an individual record (trigger)', 'new', 'service_role', NULL,
   $c$SELECT proof.trusted($s$UPDATE public.tenant_members SET business_owner_id = proof.u('RA_IND') WHERE tenant_id = proof.u('A') AND user_id = proof.u('C1')$s$)$c$, '42501', 'can only stand for a company, trust or other legal owner', NULL),
 ('6.08b an owner seat linked to another business''s legal owner (FK)', 'new', 'service_role', NULL,
   $c$SELECT proof.trusted($s$UPDATE public.tenant_members SET business_owner_id = proof.u('RB_CO') WHERE tenant_id = proof.u('A') AND user_id = proof.u('C1')$s$)$c$, '42501', 'can only stand for', NULL),
 ('6.10a an agency''s holder invites an Owner', 'new', 'service_role', NULL, proof.cre('HG','G',proof.e('NEWO'),'owner'), '42501', 'Owner invitations aren''t available for this account.', NULL),
 ('6.10b a company workspace''s holder invites an Owner', 'new', 'service_role', NULL, proof.cre('WH','W',proof.e('NEWO'),'owner'), '42501', 'Owner invitations aren''t available for this account.', NULL),
 ('6.11 a new legal owner added on the invitation', 'new', 'service_role', NULL,
   proof.cre('H','A',proof.e('NEWO'),'owner', NULL, '{"ownerKind":"company","legalName":"  Quayside Ventures LLC "}'::jsonb), '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_business_owners bo JOIN public.tenant_invite_tokens tk ON tk.business_owner_id = bo.id
       WHERE bo.tenant_id = proof.u('A') AND bo.legal_name = 'Quayside Ventures LLC' AND bo.owner_kind = 'company'
         AND bo.setup_provenance = '{"source":"team_invite"}'::jsonb AND bo.ownership_status = 'active' AND tk.email = proof.e('NEWO'))$p$),
 ('6.12a a new legal owner with no name', 'new', 'service_role', NULL, proof.cre('H','A',proof.e('NEWO'),'owner', NULL, '{"ownerKind":"trust","legalName":"  "}'::jsonb), 'P0001', 'Enter the legal name.', NULL),
 ('6.12b a new legal owner that is a person', 'new', 'service_role', NULL, proof.cre('H','A',proof.e('NEWO'),'owner', NULL, '{"ownerKind":"individual","legalName":"Pat"}'::jsonb), 'P0001', 'Choose whether the legal owner is', NULL),
 ('6.13 both an existing and a new legal owner', 'new', 'service_role', NULL,
   $c$SELECT public.create_solo_team_invite(proof.u('H'), proof.u('A'), proof.e('NEWO'), 'owner', NULL, NULL, true, proof.u('RA_CO'), '{"ownerKind":"trust","legalName":"T"}'::jsonb)$c$, 'P0001', 'not both', NULL),
 ('6.14 a legal owner on an Admin invitation', 'new', 'service_role', NULL, proof.cre('H','A',proof.e('NEWO'),'admin','RA_CO'), 'P0001', 'Only an owner invitation can be for a legal owner.', NULL),
 ('6.15 a legal owner that already has a representative', 'new', 'service_role', NULL,
   $c$DO $d$ BEGIN PERFORM proof.trusted($s$UPDATE public.tenant_members SET business_owner_id = proof.u('RA_CO') WHERE tenant_id = proof.u('A') AND user_id = proof.u('C1')$s$);
      PERFORM proof.mint_owner('A','H',proof.e('NEWO'),'RA_CO'); END $d$$c$, 'P0001', 'Harbor Lane Holdings LLC already has a representative on the team.', NULL);

-- ── Case 7: direct DML ───────────────────────────────────────────────────────────────────────────
INSERT INTO proof.checks(id, kind, as_role, actor, call, expect, msg, post) VALUES
 ('7.01 admin sets a seat''s legal owner directly', 'new', 'authenticated', 'AD', proof.upd('tenant_members', $s$business_owner_id = proof.u('RA_CO')$s$, $w$tenant_id = proof.u('A') AND user_id = proof.u('C1')$w$), '42501', 'OWNER_GUARD: which legal owner', NULL),
 ('7.02 admin raises a seat to owner directly', 'kept', 'authenticated', 'AD', proof.upd('tenant_members', $s$is_owner = true, role = 'owner'$s$, $w$tenant_id = proof.u('A') AND user_id = proof.u('ME')$w$), '42501', 'OWNER_GUARD', NULL),
 ('7.03 the platform owner sets a seat''s legal owner directly', 'new', 'authenticated', 'P', proof.upd('tenant_members', $s$business_owner_id = proof.u('RA_CO')$s$, $w$tenant_id = proof.u('A') AND user_id = proof.u('C1')$w$), '42501', 'OWNER_GUARD: which legal owner', NULL),
 ('7.04 the sole owner of a holderless business crowns themselves by direct UPDATE', 'hole', 'authenticated', 'LO', proof.upd('tenants', $s$owner_user_id = proof.u('LO')$s$, $w$id = proof.u('L')$w$), 'P0001', 'Only the platform owner may change', NULL),
 ('7.05 the platform owner moves the account holder by direct UPDATE', 'hole', 'authenticated', 'P', proof.upd('tenants', $s$owner_user_id = proof.u('C1')$s$, $w$id = proof.u('A')$w$), 'P0001', 'Only the platform owner may change', NULL),
 ('7.05b ... even with the recovery flag set by the client', 'hole', 'authenticated', 'P',
   $c$DO $d$ BEGIN PERFORM set_config('paige.owner_recovery', 'on', true); UPDATE public.tenants SET owner_user_id = proof.u('C1') WHERE id = proof.u('A'); END $d$$c$, 'P0001', 'Only the platform owner may change', NULL),
 ('7.06 the platform owner changes billing directly', 'kept', 'authenticated', 'P', proof.upd('tenants', $s$stripe_customer_id = 'cus_test'$s$, $w$id = proof.u('A')$w$), '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenants WHERE id = proof.u('A') AND stripe_customer_id = 'cus_test')$p$),
 ('7.07 an admin moves the account holder directly', 'kept', 'authenticated', 'AD', proof.upd('tenants', $s$owner_user_id = proof.u('AD')$s$, $w$id = proof.u('A')$w$), 'P0001', 'Only the platform owner may change', NULL),
 ('7.08 the sub-account owner path establishes the holder, audited', 'new', 'authenticated', 'IV', $c$SELECT proof.accept_owner_path(proof.u('SH'))$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenants WHERE id = proof.u('SH') AND owner_user_id = proof.u('IV'))
     AND EXISTS(SELECT 1 FROM public.paige_audit_log WHERE action = 'tenant:account_holder_changed' AND tenant_id = proof.u('SH') AND target_id = proof.u('SH')
       AND actor_user_id = proof.u('IV') AND actor_role = 'owner' AND payload->>'owner_user_id' = proof.u('IV')::text AND payload->'previous_owner_user_id' = 'null'::jsonb)$p$),
 ('7.09 a service-role move of the account holder is audited', 'new', 'service_role', NULL, proof.upd('tenants', $s$owner_user_id = proof.u('C1')$s$, $w$id = proof.u('A')$w$), '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.paige_audit_log WHERE action = 'tenant:account_holder_changed' AND tenant_id = proof.u('A') AND actor_user_id IS NULL AND actor_role = 'service'
       AND payload->>'previous_owner_user_id' = proof.u('H')::text AND payload->>'owner_user_id' = proof.u('C1')::text)$p$),
 ('7.10a recovery (postgres-owned code, flag, super admin) may move the holder, audited', 'new', 'authenticated', 'P', $c$SELECT proof.recovery_double(proof.u('N'), proof.u('N1'))$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenants WHERE id = proof.u('N') AND owner_user_id = proof.u('N1'))
     AND EXISTS(SELECT 1 FROM public.paige_audit_log WHERE action = 'tenant:account_holder_changed' AND tenant_id = proof.u('N') AND actor_role = 'super_admin' AND (payload->>'recovery')::boolean)$p$),
 ('7.10b the same code under a NON-super-admin JWT gains nothing', 'kept', 'authenticated', 'C1', $c$SELECT proof.recovery_double(proof.u('A'), proof.u('C1'))$c$, 'P0001', 'Only the platform owner may change', NULL),
 ('7.10c a client sets the recovery flag, then takes the sub-account owner path on a business with another owner', 'kept', 'authenticated', 'IV',
   $c$DO $d$ BEGIN PERFORM set_config('paige.owner_recovery', 'on', true); PERFORM proof.accept_owner_path(proof.u('L')); END $d$$c$, 'P0001', 'Only the platform owner may change', NULL),
 ('7.11a legal owners are not client-writable (INSERT)', 'kept', 'authenticated', 'H',
   $c$INSERT INTO public.tenant_business_owners(tenant_id, owner_kind, legal_name, created_by, updated_by) VALUES (proof.u('A'), 'company', 'X', proof.u('H'), proof.u('H'))$c$, '42501', NULL, NULL),
 ('7.11b legal owners are not client-writable (UPDATE)', 'kept', 'authenticated', 'H', $c$UPDATE public.tenant_business_owners SET representative_user_id = proof.u('H')$c$, '42501', NULL, NULL),
 ('7.11c legal owners are not client-writable (DELETE)', 'kept', 'authenticated', 'H', $c$DELETE FROM public.tenant_business_owners$c$, '42501', NULL, NULL),
 ('7.12 deleting a legal owner revokes its invitation whoever deletes it (postgres-owned code under a JWT)', 'new', 'authenticated', 'H',
   $c$DO $d$ BEGIN PERFORM proof.mint_owner('A','H',proof.e('REP1'),'RA_TR');
      PERFORM proof.as_definer($s$DELETE FROM public.tenant_business_owners WHERE id = proof.u('RA_TR')$s$); END $d$$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE email = proof.e('REP1') AND revoked_at IS NOT NULL AND business_owner_id IS NULL)$p$),
 ('7.13 interim (until I2): demoting a seat that represents a legal owner fails closed on the CHECK', 'new', 'service_role', NULL,
   $c$DO $d$ BEGIN PERFORM proof.trusted($s$UPDATE public.tenant_members SET business_owner_id = proof.u('RA_CO') WHERE tenant_id = proof.u('A') AND user_id = proof.u('C1')$s$);
      PERFORM proof.trusted($s$UPDATE public.tenant_members SET is_owner = false, role = 'admin' WHERE tenant_id = proof.u('A') AND user_id = proof.u('C1')$s$); END $d$$c$, '23514', NULL, NULL),
 ('7.14 a seated legal owner cannot be turned into an individual', 'new', 'service_role', NULL,
   $c$DO $d$ BEGIN PERFORM proof.trusted($s$UPDATE public.tenant_members SET business_owner_id = proof.u('RA_CO') WHERE tenant_id = proof.u('A') AND user_id = proof.u('C1')$s$);
      PERFORM proof.trusted($s$UPDATE public.tenant_business_owners SET owner_kind = 'individual' WHERE id = proof.u('RA_CO')$s$); END $d$$c$, '42501', 'holds an owner seat on the team', NULL);

-- ── Case 12: membership oracle — a non-holder's refusal never depends on the legal owner named ─────
INSERT INTO proof.checks(id, kind, as_role, actor, call, expect, msg, post) VALUES
 ('12.01 admin names another business''s legal owner', 'new', 'service_role', NULL, proof.cre('AD','A',proof.e('NEWO'),'owner','RB_CO'), '42501', 'Only the account holder can add owners to this business.', NULL),
 ('12.02 admin names a legal owner that does not exist', 'new', 'service_role', NULL, proof.cre('AD','A',proof.e('NEWO'),'owner','NOPE'), '42501', 'Only the account holder can add owners to this business.', NULL),
 ('12.03 admin names this business''s legal owner', 'new', 'service_role', NULL, proof.cre('AD','A',proof.e('NEWO'),'owner','RA_CO'), '42501', 'Only the account holder can add owners to this business.', NULL),
 ('12.04 admin names an individual record', 'new', 'service_role', NULL, proof.cre('AD','A',proof.e('NEWO'),'owner','RA_IND'), '42501', 'Only the account holder can add owners to this business.', NULL),
 ('12.05 co-owner adds a new legal owner inline (nothing is written)', 'new', 'service_role', NULL,
   proof.cre('C1','A',proof.e('NEWO'),'owner', NULL, '{"ownerKind":"company","legalName":"Sneaky LLC"}'::jsonb), '42501', 'Only the account holder can add owners to this business.', NULL);

-- ── peek_tenant_invite (§5.5) ────────────────────────────────────────────────────────────────────
INSERT INTO proof.checks(id, kind, as_role, actor, call, expect, msg, post) VALUES
 ('P.01 anon peek of an ordinary invitation is unchanged', 'kept', 'anon', NULL,
   $c$SELECT proof.expect((SELECT tenant_name = 'Northstar Studio' AND kind = 'team' AND default_role = 'admin' AND is_valid AND invited_email = proof.e('INV2') FROM public.peek_tenant_invite('tok-adm')), 'peek unchanged')$c$, '00000', NULL, NULL),
 ('P.02 anon peek of a legal owner''s invitation names it, and only its name', 'new', 'anon', NULL,
   $c$DO $d$ DECLARE _t text := proof.mint_owner('A','H',proof.e('INV1'),'RA_CO'); _r record; BEGIN
      SELECT * INTO _r FROM public.peek_tenant_invite(_t);
      PERFORM proof.expect(_r.business_owner_display = 'Harbor Lane Holdings LLC' AND _r.default_role = 'owner' AND _r.is_valid, 'owner name shown');
      PERFORM proof.expect(NOT (to_jsonb(_r) ?| ARRAY['ownership_interest','representative_user_id','business_owner_id']), 'nothing else about the record'); END $d$$c$, '00000', NULL, NULL),
 ('P.03 anon peek of a person-owner invitation names no legal owner', 'new', 'anon', NULL,
   $c$SELECT proof.expect((SELECT business_owner_display IS NULL AND default_role = 'owner' FROM public.peek_tenant_invite('tok-own')), 'no legal owner')$c$, '00000', NULL, NULL);

-- ── Round 2 (2026-10-27): review findings S1, S3, S6, B3 and the peek nit ─────────────────────────
INSERT INTO proof.checks(id, kind, as_role, actor, call, expect, msg, post) VALUES
 -- S1. The representative's record is not stamped with the invitee, so deleting the invitee's account
 -- (admin-delete-user, a power platform operators KEEP, owner ruling 2026-10-27) is not blocked by
 -- tenant_business_owners.updated_by (FK to auth.users, no ON DELETE action, as on production).
 ('2.14 after a representative accepts, deleting their account is not blocked by the legal owner record', 'new', 'authenticated', 'INV1',
   $c$DO $d$ BEGIN PERFORM public.accept_solo_team_invite(proof.mint_owner('A', 'H', proof.e('INV1'), 'RA_CO'));
      PERFORM proof.trusted($s$DELETE FROM public.tenant_members WHERE user_id = proof.u('INV1'); DELETE FROM public.profiles WHERE user_id = proof.u('INV1'); DELETE FROM auth.users WHERE id = proof.u('INV1')$s$); END $d$$c$, '00000', NULL,
   $p$NOT EXISTS(SELECT 1 FROM auth.users WHERE id = proof.u('INV1'))
     AND EXISTS(SELECT 1 FROM public.tenant_business_owners WHERE id = proof.u('RA_CO') AND representative_user_id IS NULL AND updated_by = proof.u('H'))$p$),
 -- S3 / V06. A resent legal-owner invitation is still for the same legal owner.
 ('2.15 the account holder resends a legal owner''s invitation and it stays for that legal owner', 'new', 'service_role', NULL,
   $c$DO $d$ DECLARE _id uuid; BEGIN PERFORM proof.mint_owner('A', 'H', proof.e('REP1'), 'RA_CO');
      SELECT id INTO _id FROM public.tenant_invite_tokens WHERE email = proof.e('REP1') AND revoked_at IS NULL;
      PERFORM public.resend_solo_team_invite(proof.u('H'), proof.u('A'), _id); END $d$$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE email = proof.e('REP1') AND default_role = 'owner' AND business_owner_id = proof.u('RA_CO') AND revoked_at IS NULL)
     AND (SELECT count(*) FROM public.tenant_invite_tokens WHERE email = proof.e('REP1')) = 2
     AND (SELECT count(*) FROM public.tenant_invite_tokens WHERE email = proof.e('REP1') AND revoked_at IS NULL) = 1$p$),
 -- S3 / V08. Inside postgres-owned code the #227 carve-out still only lets a caller crown THEMSELVES.
 ('7.15 postgres-owned code under one person''s JWT cannot make another owner the account holder', 'kept', 'authenticated', 'IV',
   $c$SELECT proof.as_definer($s$UPDATE public.tenants SET owner_user_id = proof.u('LO') WHERE id = proof.u('L')$s$)$c$, 'P0001', 'Only the platform owner may change', NULL),
 -- S3 / V12. The seat guard's INSERT branch: the platform owner (exempt from the ownership checks)
 -- still cannot INSERT a seat that names a legal owner.
 ('7.16 the platform owner inserts an owner seat that names a legal owner', 'new', 'authenticated', 'P',
   $c$INSERT INTO public.tenant_members(tenant_id, user_id, role, status, is_owner, business_owner_id) VALUES (proof.u('A'), proof.u('INV1'), 'owner', 'active', true, proof.u('RA_CO'))$c$, '42501', 'OWNER_GUARD: which legal owner', NULL),
 -- S6. Nobody but the account holder pre-empts an owner invitation's address.
 ('1.41 admin direct INSERT of a member invitation for an address with a live owner invitation', 'hole', 'authenticated', 'AD',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-pre', 'team', 'member', proof.u('AD'), proof.e('OWN1'), 1)$c$, '42501',
   'There''s already an owner invitation for this address. Only the account holder can change it, from Settings → Team.', NULL),
 ('1.42 admin mints a team Admin invitation for that address through create_tenant_invite_token', 'hole', 'authenticated', 'AD',
   $c$SELECT public.create_tenant_invite_token(proof.u('A'), 'team', 'admin'::public.tenant_role, 7, 1, NULL, proof.e('OWN1'))$c$, '42501',
   'There''s already an owner invitation for this address. Only the account holder can change it, from Settings → Team.', NULL),
 ('1.43 admin direct INSERT of a member invitation for an address with no owner invitation', 'kept', 'authenticated', 'AD',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-free', 'team', 'member', proof.u('AD'), proof.e('FREE'), 1)$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE token = 'x-free')$p$),
 ('1.44 the account holder''s own Settings → Team invitation still replaces the owner invitation', 'kept', 'service_role', NULL, proof.cre('H','A',proof.e('OWN1'),'admin'), '00000', NULL,
   proof.tok('T_OWN', 'revoked_at IS NOT NULL')||$p$ AND EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE email = proof.e('OWN1') AND default_role = 'admin' AND revoked_at IS NULL)$p$),
 -- B3. The Agency Team screen still offers Owner; what the person reads is true for where they are.
 ('1.45 Owner from the Agency Team screen on an agency account', 'hole', 'authenticated', 'HG',
   $c$SELECT public.create_tenant_invite_token(proof.u('G'), 'team', 'owner'::public.tenant_role, 30, NULL, NULL, NULL)$c$, '42501',
   'Agency accounts add Admins and Members. An owner is added by the account holder of a business account, from its Settings → Team.', NULL),
 ('1.46 Owner from the Agency Team screen while working inside a sub-account', 'new', 'authenticated', 'GA',
   $c$DO $d$ BEGIN PERFORM proof.trusted($s$INSERT INTO public.fixture_agency_managers VALUES (proof.u('SUB'), proof.u('GA'))$s$);
      PERFORM public.create_tenant_invite_token(proof.u('SUB'), 'team', 'owner'::public.tenant_role, 30, NULL, NULL, NULL); END $d$$c$, '42501',
   'Owners are added only by this business''s account holder, from Settings → Team. You can invite an Admin or Member here.', NULL),
 ('1.47 Owner asked for in a platform company workspace', 'hole', 'authenticated', 'WH',
   $c$SELECT public.create_tenant_invite_token(proof.u('W'), 'team', 'owner'::public.tenant_role, 30, NULL, NULL, NULL)$c$, '42501',
   'Owner invitations aren''t available for this account.', NULL),
 -- Nit. peek names the legal owner only while the invitation can still be used.
 ('P.04 anon peek of a revoked legal owner''s invitation names no legal owner', 'new', 'anon', NULL,
   $c$DO $d$ DECLARE _t text := proof.mint_owner('A','H',proof.e('INV1'),'RA_CO'); _r record; BEGIN
      PERFORM proof.trusted(format('UPDATE public.tenant_invite_tokens SET revoked_at = now() WHERE token = %L', _t));
      SELECT * INTO _r FROM public.peek_tenant_invite(_t);
      PERFORM proof.expect(_r.business_owner_display IS NULL AND NOT _r.is_valid AND _r.default_role = 'owner', 'a dead invitation names nobody'); END $d$$c$, '00000', NULL, NULL);

-- ── Round 3 (2026-10-27): review findings S-A to S-E ──────────────────────────────────────────────
INSERT INTO proof.checks(id, kind, as_role, actor, call, expect, msg, post) VALUES
 -- S-A. The address rule covers every kind that seats a person in tenant_members, not only 'team'.
 ('1.48 admin direct INSERT of a sub-account owner invitation (Admin) for an address with a live owner invitation', 'hole', 'authenticated', 'AD',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-pre-sub', 'subaccount_owner', 'admin', proof.u('AD'), proof.e('OWN1'), 1)$c$, '42501',
   'There''s already an owner invitation for this address. Only the account holder can change it, from Settings → Team.', NULL),
 ('1.49 admin direct INSERT of any other kind the generic accept seats, for that address', 'hole', 'authenticated', 'AD',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-pre-staff', 'staff', 'member', proof.u('AD'), proof.e('OWN1'), 1)$c$, '42501',
   'There''s already an owner invitation for this address', NULL),
 ('1.50 an agency invitation (no tenant_members seat) for that address is unchanged', 'kept', 'authenticated', 'AD',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-pre-ag', 'agency_team', 'member', proof.u('AD'), proof.e('OWN1'), 1)$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE token = 'x-pre-ag')$p$),
 -- S-C. A seat-creating invitation inserted under a person's JWT stores its address trimmed and lower case.
 ('1.51 admin direct INSERT of a member invitation with a padded, mixed-case address', 'hole', 'authenticated', 'AD',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-pad', 'team', 'member', proof.u('AD'), ' Pre@Tests.invalid ', 1)$c$, '42501',
   'INVITE_GUARD: an invitation''s email address is stored trimmed and in lower case', NULL),
 ('1.52 the padded-address pre-emption, end to end: a padded member invitation, then the holder''s owner invitation, then the member one accepted first', 'new', 'authenticated', 'AD',
   $c$DO $d$ DECLARE _t text; BEGIN
      INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-pad-pre', 'team', 'member', proof.u('AD'), ' '||proof.e('PRE')||' ', 1);
      _t := proof.mint_owner('A', 'H', proof.e('PRE'));
      PERFORM set_config('request.jwt.claims', json_build_object('sub', proof.u('PRE'), 'role', 'authenticated')::text, true);
      PERFORM public.accept_solo_team_invite('x-pad-pre'); END $d$$c$, '42501',
   'INVITE_GUARD: an invitation''s email address is stored trimmed and in lower case', NULL),
 -- S-E / V15. The address rule is case- and space-insensitive (and runs before the address-format rule).
 ('1.53 admin direct INSERT for an UPPER-CASE copy of an owner invitation''s address', 'hole', 'authenticated', 'AD',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-upper', 'team', 'member', proof.u('AD'), upper(proof.e('OWN1')), 1)$c$, '42501',
   'There''s already an owner invitation for this address', NULL),
 ('1.54 admin direct INSERT for a padded copy of an owner invitation''s address', 'hole', 'authenticated', 'AD',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-padcopy', 'team', 'member', proof.u('AD'), ' '||proof.e('OWN1')||'  ', 1)$c$, '42501',
   'There''s already an owner invitation for this address', NULL),
 -- S-E / V16. An EXPIRED owner invitation is not live: it blocks nobody.
 ('1.55 an expired owner invitation does not block an admin''s direct INSERT for its address', 'kept', 'authenticated', 'AD',
   $c$DO $d$ BEGIN
      PERFORM proof.trusted($s$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, expires_at, max_uses, email) VALUES (proof.u('A'), 'tok-exp-own1', 'team', 'owner', proof.u('H'), now() - interval '1 day', 1, proof.e('EXP1'))$s$);
      INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-after-exp', 'team', 'member', proof.u('AD'), proof.e('EXP1'), 1); END $d$$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE token = 'x-after-exp')$p$),
 ('1.56 an expired owner invitation does not block an admin''s Settings → Team invitation for its address', 'kept', 'service_role', NULL,
   $c$DO $d$ BEGIN
      PERFORM proof.trusted($s$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, expires_at, max_uses, email) VALUES (proof.u('A'), 'tok-exp-own2', 'team', 'owner', proof.u('H'), now() - interval '1 day', 1, proof.e('EXP2'))$s$);
      PERFORM public.create_solo_team_invite(proof.u('AD'), proof.u('A'), proof.e('EXP2'), 'member', NULL, NULL, true); END $d$$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE email = proof.e('EXP2') AND default_role = 'member' AND created_by = proof.u('AD') AND revoked_at IS NULL)$p$),
 -- S-E / V21. An archived business is 'archived', never 'none': nobody is told to contact the Paige team.
 ('1.57 an archived business with no account holder reads the holder-only refusal', 'new', 'postgres', NULL,
   $c$DO $d$ BEGIN UPDATE public.tenants SET archived_at = now() WHERE id = proof.u('N');
      PERFORM proof.expect(public._tenant_account_holder_state(proof.u('N')) = 'archived', 'state archived');
      PERFORM public._assert_tenant_account_holder(proof.u('N1'), proof.u('N'), 'add'); END $d$$c$, '42501',
   'Only the account holder can add owners to this business.', NULL),
 -- S-E / V24. create_tenant_invite_token refuses Owner for every kind, not only team and consumer.
 ('1.58 platform owner mints a sub-account owner invitation carrying Owner through create_tenant_invite_token', 'hole', 'authenticated', 'P',
   $c$SELECT public.create_tenant_invite_token(proof.u('SH'), 'subaccount_owner', 'owner'::public.tenant_role, 7, 1, NULL, proof.e('X'))$c$, '42501',
   'Owners are added only by this business''s account holder, from Settings → Team. You can invite an Admin or Member here.', NULL),
 ('1.59 agency holder mints an agency invitation carrying Owner through create_tenant_invite_token', 'hole', 'authenticated', 'HG',
   $c$SELECT public.create_tenant_invite_token(proof.u('G'), 'agency_team', 'owner'::public.tenant_role, 7, 1, NULL, proof.e('X'))$c$, '42501',
   'Agency accounts add Admins and Members.', NULL),
 -- S-B. An owner invitation whose legal owner was deleted is never resent (it would become a person-owner invitation).
 ('2.16 the account holder resends an owner invitation whose legal owner was deleted', 'new', 'service_role', NULL,
   $c$DO $d$ DECLARE _id uuid; BEGIN PERFORM proof.mint_owner('A', 'H', proof.e('REP1'), 'RA_TR');
      SELECT id INTO _id FROM public.tenant_invite_tokens WHERE email = proof.e('REP1') AND revoked_at IS NULL;
      PERFORM proof.trusted($s$DELETE FROM public.tenant_business_owners WHERE id = proof.u('RA_TR')$s$);
      PERFORM public.resend_solo_team_invite(proof.u('H'), proof.u('A'), _id); END $d$$c$, 'P0001',
   'This owner invitation was for a legal owner that has since been removed, so it can''t be sent again.', NULL),
 ('2.17 ... also when the account holder had already withdrawn it before the legal owner was deleted', 'new', 'service_role', NULL,
   $c$DO $d$ DECLARE _id uuid; BEGIN PERFORM proof.mint_owner('A', 'H', proof.e('REP1'), 'RA_TR');
      SELECT id INTO _id FROM public.tenant_invite_tokens WHERE email = proof.e('REP1') AND revoked_at IS NULL;
      PERFORM public.revoke_solo_team_invite(proof.u('H'), proof.u('A'), _id);
      PERFORM proof.trusted($s$DELETE FROM public.tenant_business_owners WHERE id = proof.u('RA_TR')$s$);
      PERFORM public.resend_solo_team_invite(proof.u('H'), proof.u('A'), _id); END $d$$c$, 'P0001',
   'This owner invitation was for a legal owner that has since been removed', NULL),
 -- S-D. The lock is asserted on the body; the race itself is NOT driven (this proof is one session).
 ('2.18 structure: accept locks the tenant row and the sender''s seat FOR SHARE before re-checking the sender', 'new', 'postgres', NULL,
   $c$SELECT proof.expect((SELECT strpos(prosrc, 'SELECT name INTO _tenant_name FROM public.tenants WHERE id = _invite.tenant_id FOR SHARE;') > 0
       AND strpos(prosrc, 'PERFORM 1 FROM public.tenant_members WHERE tenant_id = _invite.tenant_id AND user_id = _invite.created_by FOR SHARE;') > 0
       AND strpos(prosrc, 'SELECT name INTO _tenant_name FROM public.tenants WHERE id = _invite.tenant_id FOR SHARE;') < strpos(prosrc, 'IF NOT public.is_tenant_account_holder(_invite.created_by, _invite.tenant_id) THEN')
       AND strpos(prosrc, 'PERFORM 1 FROM public.tenant_members WHERE tenant_id = _invite.tenant_id AND user_id = _invite.created_by FOR SHARE;') < strpos(prosrc, 'IF NOT public.is_tenant_account_holder(_invite.created_by, _invite.tenant_id) THEN')
     FROM pg_proc WHERE oid = 'public.accept_solo_team_invite(text)'::regprocedure), 'both locks precede the sender check')$c$, '00000', NULL, NULL),
 -- S-E / V5. An owner seat takes part in team conversations whatever the stored invitation says.
 ('2.19 an owner invitation stored with team conversations off still seats an owner with them on', 'new', 'authenticated', 'INV1',
   $c$DO $d$ BEGIN
      PERFORM proof.trusted($s$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, max_uses, email, team_hub_access) VALUES (proof.u('A'), 'tok-own-nohub', 'team', 'owner', proof.u('H'), 1, proof.e('INV1'), false)$s$);
      PERFORM public.accept_solo_team_invite('tok-own-nohub'); END $d$$c$, '00000', NULL,
   proof.seat('A','INV1', $q$is_owner AND role = 'owner' AND team_hub_access$q$));

-- ── Round 4 (2026-10-27): review finding B1 (accept-side pre-emption) and S1 (the address rule's conditions) ──
-- Helpers. A person with a confirmed address; an invitation written as trusted code (no JWT, so no
-- guard is involved in creating it: "created before the owner invitation" or by the service role);
-- switching the JWT to another person inside one case.
CREATE FUNCTION proof.person(_p text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN INSERT INTO auth.users(id, email, email_confirmed_at) VALUES (proof.u(_p), proof.e(_p), now()) ON CONFLICT (id) DO NOTHING; END $$;
CREATE FUNCTION proof.put_token(_t text, _token text, _kind text, _role text, _by text, _email text,
  _uses int DEFAULT 0, _revoked boolean DEFAULT false, _expired boolean DEFAULT false, _archived boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE _c text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses, uses,
    revoked_at, expires_at, archived_at)
  VALUES (proof.u(_t), _token, _kind, _role::public.tenant_role, proof.u(_by), _email, 1, _uses,
    CASE WHEN _revoked THEN now() END, CASE WHEN _expired THEN now() - interval '1 day' ELSE now() + interval '7 days' END,
    CASE WHEN _archived THEN now() END);
  PERFORM set_config('request.jwt.claims', COALESCE(_c, ''), true);
END $$;
CREATE FUNCTION proof.as_person(_p text) RETURNS void LANGUAGE sql AS
 $$ SELECT set_config('request.jwt.claims', json_build_object('sub', proof.u(_p), 'role', 'authenticated')::text, true) $$;
GRANT EXECUTE ON FUNCTION proof.person(text), proof.put_token(text, text, text, text, text, text, int, boolean, boolean, boolean),
 proof.as_person(text) TO anon, authenticated, service_role;

INSERT INTO proof.checks(id, kind, as_role, actor, call, expect, msg, post) VALUES
 -- B1 / V1. An admin's invitation of another kind with NO address, accepted through accept_tenant_invite
 -- (which /join uses for every kind but team) by the person the owner invitation is for.
 ('4.01 V1: an admin''s staff invitation with no address, accepted by the owner invitation''s person', 'hole', 'authenticated', 'AD',
   $c$DO $d$ BEGIN
      INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'v1-staff', 'staff', 'member', proof.u('AD'), NULL, 1);
      PERFORM proof.as_person('OWN1');
      PERFORM public.accept_tenant_invite('v1-staff'); END $d$$c$, '42501',
   'You have an owner invitation to Northstar Studio waiting. Open that invitation to join as an owner. Nothing changed.', NULL),
 ('4.02 V1 end to end: refused, nothing written, and the owner invitation then seats them as an owner', 'new', 'authenticated', 'AD',
   $c$DO $d$ BEGIN
      INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'v1-staff', 'staff', 'member', proof.u('AD'), NULL, 1);
      PERFORM proof.as_person('OWN1');
      BEGIN PERFORM public.accept_tenant_invite('v1-staff'); EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      PERFORM proof.expect(NOT EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE token = 'v1-staff' AND uses > 0), 'the staff invitation was not used');
      PERFORM public.accept_solo_team_invite('tok-own'); END $d$$c$, '00000', NULL,
   proof.seat('A','OWN1', $q$is_owner AND role = 'owner' AND status = 'active'$q$)),
 -- B1 / V1b. The same with a made-up address.
 ('4.03 V1b: an admin''s staff invitation to a made-up address, accepted by the owner invitation''s person', 'hole', 'authenticated', 'AD',
   $c$DO $d$ BEGIN
      INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'v1b-staff', 'staff', 'member', proof.u('AD'), 'decoy@tests.invalid', 1);
      PERFORM proof.as_person('OWN1');
      PERFORM public.accept_tenant_invite('v1b-staff'); END $d$$c$, '42501', 'You have an owner invitation to Northstar Studio waiting.', NULL),
 -- B1 / V2. A sub-account owner invitation with no address on a Solo account: its Admin path.
 ('4.04 V2: an admin''s sub-account owner invitation with no address, accepted by the owner invitation''s person', 'hole', 'authenticated', 'AD',
   $c$DO $d$ BEGIN
      INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'v2-sub', 'subaccount_owner', 'member', proof.u('AD'), NULL, 1);
      PERFORM proof.as_person('OWN1');
      PERFORM public.accept_tenant_invite('v2-sub'); END $d$$c$, '42501', 'You have an owner invitation to Northstar Studio waiting.', NULL),
 -- The stated residuals of round 3: another kind created BEFORE the owner invitation, and service-role inserts.
 ('4.05 a sub-account owner invitation to that address created before the owner invitation', 'hole', 'authenticated', 'OWN1',
   $c$DO $d$ BEGIN PERFORM proof.put_token('A', 'pre-sub', 'subaccount_owner', 'admin', 'AD', proof.e('OWN1'));
      PERFORM public.accept_tenant_invite('pre-sub'); END $d$$c$, '42501', 'You have an owner invitation to Northstar Studio waiting.', NULL),
 ('4.06 a team Member invitation to that address inserted by the service role, accepted on the join page', 'hole', 'authenticated', 'OWN1',
   $c$DO $d$ BEGIN PERFORM proof.put_token('A', 'svc-team', 'team', 'member', 'AD', proof.e('OWN1'));
      PERFORM public.accept_solo_team_invite('svc-team'); END $d$$c$, '42501', 'You have an owner invitation to Northstar Studio waiting.', NULL),
 ('4.07 a team Member invitation to that address from before the owner invitation, through the legacy accept', 'hole', 'authenticated', 'OWN1',
   $c$DO $d$ BEGIN PERFORM proof.put_token('A', 'pre-team', 'team', 'member', 'AD', proof.e('OWN1'));
      PERFORM public.accept_tenant_invite('pre-team'); END $d$$c$, '42501', 'You have an owner invitation to Northstar Studio waiting.', NULL),
 ('4.08 a service-role seat write for that person (the accept-invite edge function''s path)', 'hole', 'service_role', NULL,
   $c$INSERT INTO public.tenant_members(tenant_id, user_id, role, status) VALUES (proof.u('A'), proof.u('OWN1'), 'member', 'active')$c$, '42501',
   'You have an owner invitation to Northstar Studio waiting.', NULL),
 ('4.09 an admin grants that person a seat (postgres-owned code under the admin''s JWT, as grant_tenant_member_role)', 'hole', 'authenticated', 'AD',
   $c$SELECT proof.as_definer($s$INSERT INTO public.tenant_members(tenant_id, user_id, role, status) VALUES (proof.u('A'), proof.u('OWN1'), 'member', 'active')$s$)$c$, '42501',
   'This person has an owner invitation to Northstar Studio waiting, so they join by accepting it. Only the account holder can change it, from Settings → Team. Nothing changed.', NULL),
 -- V3 / V4 stay refused (an invitation of kind team with no address is never accepted).
 ('4.10 V3: a team invitation with no address through accept_solo_team_invite', 'kept', 'authenticated', 'AD',
   $c$DO $d$ BEGIN
      INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'v3-team', 'team', 'member', proof.u('AD'), NULL, 1);
      PERFORM proof.as_person('OWN1');
      PERFORM public.accept_solo_team_invite('v3-team'); END $d$$c$, '42501', 'team invitation belongs to a different email address', NULL),
 ('4.11 V4: a team invitation with no address minted by create_tenant_invite_token, through accept_tenant_invite', 'kept', 'authenticated', 'AD',
   $c$DO $d$ DECLARE r public.tenant_invite_tokens; BEGIN
      r := public.create_tenant_invite_token(proof.u('A'), 'team', 'member'::public.tenant_role, 7, 1, NULL, NULL);
      PERFORM proof.as_person('OWN1');
      PERFORM public.accept_tenant_invite(r.token); END $d$$c$, '42501', 'team invitation belongs to a different email address', NULL),
 -- The seat-side rule's conditions, each pinned (round 4 mutants S01-S11).
 ('4.20 an owner invitation in ANOTHER business does not stop a seat here', 'kept', 'authenticated', 'Q1',
   $c$DO $d$ BEGIN PERFORM proof.person('Q1'); PERFORM proof.put_token('B', 'q1-own-b', 'team', 'owner', 'HB', proof.e('Q1'));
      PERFORM proof.put_token('A', 'q1-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('q1-staff'); END $d$$c$, '00000', NULL, proof.seat('A','Q1', $q$role = 'member' AND status = 'active'$q$)),
 ('4.21 a USED owner invitation does not stop a seat', 'kept', 'authenticated', 'Q2',
   $c$DO $d$ BEGIN PERFORM proof.person('Q2'); PERFORM proof.put_token('A', 'q2-own', 'team', 'owner', 'H', proof.e('Q2'), 1);
      PERFORM proof.put_token('A', 'q2-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('q2-staff'); END $d$$c$, '00000', NULL, proof.seat('A','Q2', $q$status = 'active'$q$)),
 ('4.22 a WITHDRAWN owner invitation does not stop a seat', 'kept', 'authenticated', 'Q3',
   $c$DO $d$ BEGIN PERFORM proof.person('Q3'); PERFORM proof.put_token('A', 'q3-own', 'team', 'owner', 'H', proof.e('Q3'), 0, true);
      PERFORM proof.put_token('A', 'q3-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('q3-staff'); END $d$$c$, '00000', NULL, proof.seat('A','Q3', $q$status = 'active'$q$)),
 ('4.23 an EXPIRED owner invitation does not stop a seat', 'kept', 'authenticated', 'Q4',
   $c$DO $d$ BEGIN PERFORM proof.person('Q4'); PERFORM proof.put_token('A', 'q4-own', 'team', 'owner', 'H', proof.e('Q4'), 0, false, true);
      PERFORM proof.put_token('A', 'q4-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('q4-staff'); END $d$$c$, '00000', NULL, proof.seat('A','Q4', $q$status = 'active'$q$)),
 ('4.24 an ARCHIVED owner invitation does not stop a seat', 'kept', 'authenticated', 'Q5',
   $c$DO $d$ BEGIN PERFORM proof.person('Q5'); PERFORM proof.put_token('A', 'q5-own', 'team', 'owner', 'H', proof.e('Q5'), 0, false, false, true);
      PERFORM proof.put_token('A', 'q5-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('q5-staff'); END $d$$c$, '00000', NULL, proof.seat('A','Q5', $q$status = 'active'$q$)),
 ('4.25 a live MEMBER team invitation to the address does not stop a seat', 'kept', 'authenticated', 'Q6',
   $c$DO $d$ BEGIN PERFORM proof.person('Q6'); PERFORM proof.put_token('A', 'q6-member', 'team', 'member', 'AD', proof.e('Q6'));
      PERFORM proof.put_token('A', 'q6-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('q6-staff'); END $d$$c$, '00000', NULL, proof.seat('A','Q6', $q$status = 'active'$q$)),
 ('4.26 a person who already has a seat re-accepts an invitation: unaffected', 'kept', 'authenticated', 'ME',
   $c$DO $d$ BEGIN PERFORM proof.put_token('A', 'me-own', 'team', 'owner', 'H', proof.e('ME'));
      PERFORM proof.put_token('A', 'me-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('me-staff'); END $d$$c$, '00000', NULL, proof.seat('A','ME', $q$role = 'member' AND status = 'active' AND NOT is_owner$q$)),
 ('4.27 the address is compared trimmed and in any case (an owner invitation stored padded, upper case, by the service role)', 'hole', 'authenticated', 'Q7',
   $c$DO $d$ BEGIN PERFORM proof.person('Q7'); PERFORM proof.put_token('A', 'q7-own', 'team', 'owner', 'H', ' '||upper(proof.e('Q7'))||' ');
      PERFORM proof.put_token('A', 'q7-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('q7-staff'); END $d$$c$, '42501', 'You have an owner invitation to Northstar Studio waiting.', NULL),
 ('4.28 an Owner-role invitation of another kind (never accepted as an owner anywhere) does not stop a seat', 'kept', 'authenticated', 'Q8',
   $c$DO $d$ BEGIN PERFORM proof.person('Q8'); PERFORM proof.put_token('A', 'q8-own-staff', 'staff', 'owner', 'H', proof.e('Q8'));
      PERFORM proof.put_token('A', 'q8-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('q8-staff'); END $d$$c$, '00000', NULL, proof.seat('A','Q8', $q$status = 'active'$q$)),
 -- S1. The token guard's address rule: pin each condition (kills the verifier's X01-X05).
 ('4.30 X01: another business''s owner invitation does not block an admin''s invitation here', 'kept', 'authenticated', 'AD',
   $c$DO $d$ BEGIN PERFORM proof.put_token('B', 'ob1-own', 'team', 'owner', 'HB', proof.e('OB1'));
      -- Through postgres-owned code (create_tenant_invite_token): a browser INSERT's own read of the
      -- tokens table is already scoped to its business by RLS, so only definer code can see B's row.
      PERFORM public.create_tenant_invite_token(proof.u('A'), 'team', 'member'::public.tenant_role, 7, 1, NULL, proof.e('OB1')); END $d$$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE tenant_id = proof.u('A') AND email = proof.e('OB1') AND created_by = proof.u('AD'))$p$),
 ('4.31 X02: a USED owner invitation does not block an admin''s invitation', 'kept', 'authenticated', 'AD',
   $c$DO $d$ BEGIN PERFORM proof.put_token('A', 'ou1-own', 'team', 'owner', 'H', proof.e('OU1'), 1);
      INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-ou1', 'team', 'member', proof.u('AD'), proof.e('OU1'), 1); END $d$$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE token = 'x-ou1')$p$),
 ('4.32 X03: a WITHDRAWN owner invitation does not block an admin''s invitation', 'kept', 'authenticated', 'AD',
   $c$DO $d$ BEGIN PERFORM proof.put_token('A', 'or1-own', 'team', 'owner', 'H', proof.e('OR1'), 0, true);
      INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-or1', 'team', 'member', proof.u('AD'), proof.e('OR1'), 1); END $d$$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE token = 'x-or1')$p$),
 ('4.33 X04: a live MEMBER team invitation to the address does not block an admin''s invitation', 'kept', 'authenticated', 'AD',
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-inv2', 'team', 'member', proof.u('AD'), proof.e('INV2'), 1)$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE token = 'x-inv2')$p$),
 ('4.34 X05: a service-role INSERT to an owner invitation''s address is exempt from the token guard (it cannot be used: 4.06)', 'kept', 'service_role', NULL,
   $c$INSERT INTO public.tenant_invite_tokens(tenant_id, token, kind, default_role, created_by, email, max_uses) VALUES (proof.u('A'), 'x-svc-own1', 'team', 'member', proof.u('AD'), proof.e('OWN1'), 1)$c$, '00000', NULL,
   $p$EXISTS(SELECT 1 FROM public.tenant_invite_tokens WHERE token = 'x-svc-own1')$p$);

-- ── Round 5 (2026-10-27): review should-fixes 1 and 2 ───────────────────────────────────────────────
-- 2. The HINT is asserted, not only the sentence (kills the verifier's Y13): both sentences carry
--    OWNER_INVITE_WAITING, the code solo-team-invitations and accept-invite recognise.
UPDATE proof.checks SET hint = 'OWNER_INVITE_WAITING' WHERE id LIKE '4.08 %' OR id LIKE '4.09 %';
-- 1. Only an owner invitation that accept_solo_team_invite would still honour keeps a person from
--    another seat. Helpers: an owner invitation naming a legal owner (and any max_uses), written as
--    trusted code; and SQL run as the service role (how the solo-team-invitations edge calls).
CREATE FUNCTION proof.put_owner(_t text, _token text, _by text, _email text, _rec text DEFAULT NULL, _max int DEFAULT 1, _uses int DEFAULT 0)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE _c text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.tenant_invite_tokens(id, tenant_id, token, kind, default_role, created_by, email, max_uses, uses, expires_at)
  VALUES (proof.u(_token), proof.u(_t), _token, 'team', 'owner', proof.u(_by), _email, _max, _uses, now() + interval '7 days');
  -- The column only exists once the migration is applied (phase 1 runs production's schema).
  IF _rec IS NOT NULL THEN
    EXECUTE 'UPDATE public.tenant_invite_tokens SET business_owner_id = $1 WHERE id = $2' USING proof.u(_rec), proof.u(_token);
  END IF;
  PERFORM set_config('request.jwt.claims', COALESCE(_c, ''), true);
END $$;
CREATE FUNCTION proof.as_service(_sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE _c text := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  EXECUTE _sql;
  PERFORM set_config('request.jwt.claims', COALESCE(_c, ''), true);
END $$;
GRANT EXECUTE ON FUNCTION proof.put_owner(text, text, text, text, text, int, int), proof.as_service(text) TO anon, authenticated, service_role;

INSERT INTO proof.checks(id, kind, as_role, actor, call, expect, msg, post) VALUES
 -- R3: the sender is not (or is no longer) the account holder, so accept refuses OWNER_INVITE_SENDER_NOT_HOLDER.
 ('5.01 R3: an owner invitation from someone who is not the account holder does not stop a seat', 'kept', 'authenticated', 'R1',
   $c$DO $d$ BEGIN PERFORM proof.person('R1'); PERFORM proof.put_owner('A', 'r1-own', 'C1', proof.e('R1'));
      PERFORM proof.put_token('A', 'r1-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('r1-staff'); END $d$$c$, '00000', NULL, proof.seat('A','R1', $q$role = 'member' AND status = 'active'$q$)),
 ('5.02 R3: the account holder''s owner invitation, sent before the holder moved, does not stop a seat', 'kept', 'authenticated', 'R2',
   $c$DO $d$ BEGIN PERFORM proof.person('R2'); PERFORM proof.put_owner('A', 'r2-own', 'H', proof.e('R2'));
      PERFORM proof.trusted($s$UPDATE public.tenants SET owner_user_id = proof.u('C1') WHERE id = proof.u('A')$s$);
      PERFORM proof.put_token('A', 'r2-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('r2-staff'); END $d$$c$, '00000', NULL, proof.seat('A','R2', $q$status = 'active'$q$)),
 ('5.03 R13: an owner invitation from a holder paused for billing does not stop a seat (accept would refuse it)', 'kept', 'authenticated', 'R3',
   $c$DO $d$ BEGIN PERFORM proof.person('R3'); PERFORM proof.put_owner('S', 'r3-own', 'PS', proof.e('R3'));
      PERFORM proof.put_token('S', 'r3-staff', 'staff', 'member', 'CS', NULL);
      PERFORM public.accept_tenant_invite('r3-staff'); END $d$$c$, '00000', NULL, proof.seat('S','R3', $q$status = 'active'$q$)),
 -- R4: the legal owner the invitation names was retyped to an individual, or its owner seat filled.
 ('5.04 R4: an owner invitation whose legal owner became an individual does not stop a seat', 'new', 'authenticated', 'R4',
   $c$DO $d$ BEGIN PERFORM proof.person('R4'); PERFORM proof.put_owner('A', 'r4-own', 'H', proof.e('R4'), 'RA_TR');
      PERFORM proof.trusted($s$UPDATE public.tenant_business_owners SET owner_kind = 'individual' WHERE id = proof.u('RA_TR')$s$);
      PERFORM proof.put_token('A', 'r4-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('r4-staff'); END $d$$c$, '00000', NULL, proof.seat('A','R4', $q$status = 'active'$q$)),
 ('5.05 R4: an owner invitation whose legal owner''s seat was filled since does not stop a seat', 'new', 'authenticated', 'R5',
   $c$DO $d$ BEGIN PERFORM proof.person('R5'); PERFORM proof.put_owner('A', 'r5-own', 'H', proof.e('R5'), 'RA_CO');
      PERFORM proof.trusted($s$UPDATE public.tenant_members SET business_owner_id = proof.u('RA_CO') WHERE tenant_id = proof.u('A') AND user_id = proof.u('C1')$s$);
      PERFORM proof.put_token('A', 'r5-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('r5-staff'); END $d$$c$, '00000', NULL, proof.seat('A','R5', $q$status = 'active'$q$)),
 ('5.06 an owner invitation naming a live legal owner with its seat open still stops a seat', 'new', 'authenticated', 'R6',
   $c$DO $d$ BEGIN PERFORM proof.person('R6'); PERFORM proof.put_owner('A', 'r6-own', 'H', proof.e('R6'), 'RA_TR');
      PERFORM proof.put_token('A', 'r6-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('r6-staff'); END $d$$c$, '42501', 'You have an owner invitation to Northstar Studio waiting.', NULL),
 -- Not a Solo account: accept refuses OWNER_INVITE_UNAVAILABLE. (A staff invitation cannot seat anyone in an
 -- agency, so the company workspace is the reachable non-Solo case; the agency is excluded by the same helper.)
 ('5.07 an owner invitation in a COMPANY workspace (not a Solo account) does not stop a seat there', 'kept', 'authenticated', 'R7',
   $c$DO $d$ BEGIN PERFORM proof.person('R7'); PERFORM proof.put_owner('W', 'r7-own', 'WH', proof.e('R7'));
      PERFORM proof.put_token('W', 'r7-staff', 'staff', 'member', 'WH', NULL);
      PERFORM public.accept_tenant_invite('r7-staff'); END $d$$c$, '00000', NULL, proof.seat('W','R7', $q$status = 'active'$q$)),
 ('5.08 an owner invitation whose uses are already at max_uses does not stop a seat', 'kept', 'authenticated', 'R8',
   $c$DO $d$ BEGIN PERFORM proof.person('R8'); PERFORM proof.put_owner('A', 'r8-own', 'H', proof.e('R8'), NULL, 0);
      PERFORM proof.put_token('A', 'r8-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('r8-staff'); END $d$$c$, '00000', NULL, proof.seat('A','R8', $q$status = 'active'$q$)),
 -- The withdraw-clears path, through the real revoke_solo_team_invite as the edge calls it.
 ('5.09 refused while the owner invitation waits; once the account holder withdraws it, the same invitation seats them', 'new', 'authenticated', 'R9',
   $c$DO $d$ DECLARE _refused boolean := false; BEGIN PERFORM proof.person('R9'); PERFORM proof.put_owner('A', 'r9-own', 'H', proof.e('R9'));
      PERFORM proof.put_token('A', 'r9-staff', 'staff', 'member', 'AD', NULL);
      BEGIN PERFORM public.accept_tenant_invite('r9-staff'); EXCEPTION WHEN insufficient_privilege THEN _refused := true; END;
      PERFORM proof.expect(_refused, 'refused while the owner invitation waits');
      PERFORM proof.as_service($s$SELECT public.revoke_solo_team_invite(proof.u('H'), proof.u('A'), proof.u('r9-own'))$s$);
      PERFORM public.accept_tenant_invite('r9-staff'); END $d$$c$, '00000', NULL, proof.seat('A','R9', $q$role = 'member' AND status = 'active'$q$)),
 -- Nit: the rule also covers an UPDATE that moves a seat to the person, and leaves one that keeps them alone.
 ('5.10 an UPDATE moving an existing seat to the owner invitation''s person is refused', 'hole', 'service_role', NULL,
   $c$UPDATE public.tenant_members SET user_id = proof.u('OWN1') WHERE tenant_id = proof.u('A') AND user_id = proof.u('ME')$c$, '42501',
   'You have an owner invitation to Northstar Studio waiting.', NULL),
 ('5.11 an UPDATE of a seat that names the same person (user_id set to itself) is unaffected', 'kept', 'service_role', NULL,
   $c$DO $d$ BEGIN PERFORM proof.put_owner('A', 'me-own5', 'H', proof.e('ME'));
      UPDATE public.tenant_members SET user_id = user_id, tenant_id = tenant_id WHERE tenant_id = proof.u('A') AND user_id = proof.u('ME'); END $d$$c$, '00000', NULL,
   proof.seat('A','ME', $q$role = 'member' AND status = 'active'$q$));
 -- With the sender, Solo and max_uses conditions in place, 4.21 and 4.25 no longer pin "used" and
 -- "Owner only" on their own (4.21's invitation is at max_uses, 4.25's is from an admin): these do.
INSERT INTO proof.checks(id, kind, as_role, actor, call, expect, msg, post) VALUES
 ('5.12 a USED owner invitation with no max_uses, from the account holder, does not stop a seat', 'kept', 'authenticated', 'R12',
   $c$DO $d$ BEGIN PERFORM proof.person('R12'); PERFORM proof.put_owner('A', 'r12-own', 'H', proof.e('R12'), NULL, NULL, 1);
      PERFORM proof.put_token('A', 'r12-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('r12-staff'); END $d$$c$, '00000', NULL, proof.seat('A','R12', $q$status = 'active'$q$)),
 ('5.13 a live MEMBER team invitation from the account holder does not stop a seat', 'kept', 'authenticated', 'R13',
   $c$DO $d$ BEGIN PERFORM proof.person('R13'); PERFORM proof.put_token('A', 'r13-member', 'team', 'member', 'H', proof.e('R13'));
      PERFORM proof.put_token('A', 'r13-staff', 'staff', 'member', 'AD', NULL);
      PERFORM public.accept_tenant_invite('r13-staff'); END $d$$c$, '00000', NULL, proof.seat('A','R13', $q$status = 'active'$q$));
-- Nit N1 (round 6): accept_solo_team_invite refuses an unconfirmed address, so an owner invitation
-- waiting on a person whose address is NOT confirmed is not one accept would honour: it holds no seat.
INSERT INTO proof.checks(id, kind, as_role, actor, call, expect, msg, post) VALUES
 ('5.14 an owner invitation to a person whose address is NOT confirmed does not stop a seat', 'kept', 'service_role', NULL,
   $c$DO $d$ BEGIN
      PERFORM proof.trusted($s$INSERT INTO auth.users(id, email, email_confirmed_at) VALUES (proof.u('R14'), proof.e('R14'), NULL)$s$);
      PERFORM proof.put_owner('A', 'r14-own', 'H', proof.e('R14'));
      INSERT INTO public.tenant_members(tenant_id, user_id, role, status) VALUES (proof.u('A'), proof.u('R14'), 'member', 'active'); END $d$$c$, '00000', NULL,
   proof.seat('A','R14', $q$role = 'member' AND status = 'active'$q$)),
 ('5.15 the same person, address now confirmed: the waiting owner invitation stops the seat', 'hole', 'service_role', NULL,
   $c$DO $d$ BEGIN
      PERFORM proof.trusted($s$INSERT INTO auth.users(id, email, email_confirmed_at) VALUES (proof.u('R15'), proof.e('R15'), NULL)$s$);
      PERFORM proof.put_owner('A', 'r15-own', 'H', proof.e('R15'));
      PERFORM proof.trusted($s$UPDATE auth.users SET email_confirmed_at = now() WHERE id = proof.u('R15')$s$);
      INSERT INTO public.tenant_members(tenant_id, user_id, role, status) VALUES (proof.u('A'), proof.u('R15'), 'member', 'active'); END $d$$c$, '42501',
   'You have an owner invitation to Northstar Studio waiting.', NULL);
UPDATE proof.checks SET hint = 'OWNER_INVITE_WAITING' WHERE id LIKE '5.06 %' OR id LIKE '5.10 %' OR id LIKE '5.15 %';

-- One case, isolated: claims + role set, call caught, post-state read as postgres, then all rolled back.
CREATE FUNCTION proof.run_check(_id text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE c proof.checks; _state text; _msg text; _hint text; _post boolean := true; _verdict text;
BEGIN
  SELECT * INTO c FROM proof.checks WHERE id = _id;
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN c.actor IS NULL THEN json_build_object('role', c.as_role)::text
           ELSE json_build_object('sub', proof.u(c.actor), 'role', c.as_role)::text END, true);
    EXECUTE format('SET LOCAL ROLE %I', c.as_role);
    BEGIN
      EXECUTE c.call; _state := '00000'; _msg := ''; _hint := '';
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT, _hint = PG_EXCEPTION_HINT;
    END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF _state = '00000' AND c.post IS NOT NULL THEN EXECUTE 'SELECT (' || c.post || ')::boolean' INTO _post; END IF;
    _verdict := CASE WHEN _state = c.expect AND (c.msg IS NULL OR strpos(_msg, c.msg) > 0) AND _post IS TRUE
                          AND (c.hint IS NULL OR _hint IS NOT DISTINCT FROM c.hint)
                     THEN 'pass' ELSE format('got %s "%s" hint=%s post=%s', _state, _msg, coalesce(_hint,'null'), coalesce(_post::text,'null')) END;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = _verdict;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN RETURN SQLERRM;
  END;
END $$;
CREATE FUNCTION proof.failing() RETURNS TABLE(id text, why text) LANGUAGE sql AS $$
  SELECT id, v FROM (SELECT id, n, proof.run_check(id) v FROM proof.checks) x WHERE v <> 'pass' ORDER BY n $$;

-- ═════════════════════ PHASE 1: production's bodies ═════════════════════
\echo '── PHASE 1, production bodies: cases that fail (expected: every hole and every new case) ──'
CREATE TABLE proof.phase1 AS SELECT * FROM proof.failing();
SELECT id AS failing_on_production, why FROM proof.phase1;
DO $$ DECLARE _bad text; BEGIN
  SELECT string_agg(c.id, E'\n') INTO _bad FROM proof.checks c
   WHERE (c.kind IN ('hole','new')) <> EXISTS(SELECT 1 FROM proof.phase1 f WHERE f.id = c.id);
  IF _bad IS NOT NULL THEN RAISE EXCEPTION E'FAIL: on production the failing set is not exactly hole+new:\n%', _bad; END IF;
  -- Each hole fails for the right reason: production lets it THROUGH (00000), it does not merely word it differently.
  SELECT string_agg(c.id, E'\n') INTO _bad FROM proof.checks c JOIN proof.phase1 f USING (id)
   WHERE c.kind = 'hole' AND f.why NOT LIKE 'got 00000%';
  IF _bad IS NOT NULL THEN RAISE EXCEPTION E'FAIL: a hole is refused by production, so it is not a hole:\n%', _bad; END IF;
END $$;
SELECT format('PASS: on production %s kept cases pass, %s holes go THROUGH, %s new-capability cases fail',
  (SELECT count(*) FROM proof.checks WHERE kind='kept'), (SELECT count(*) FROM proof.checks WHERE kind='hole'),
  (SELECT count(*) FROM proof.checks WHERE kind='new')) AS phase1 \gset
\echo :phase1

CREATE TABLE proof.prior AS
SELECT p.proname::text AS name, p.prosrc, p.prorettype, p.proargtypes::text AS argtypes, p.proargnames::text AS argnames,
       p.prosecdef, p.provolatile, p.proconfig::text AS config, p.proowner, p.proacl::text AS acl, p.prolang
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('guard_tenant_member_owner_flag',
   'guard_tenant_owner_only_columns','create_solo_team_invite','resend_solo_team_invite','revoke_solo_team_invite',
   'archive_solo_team_invite','accept_solo_team_invite','accept_tenant_invite','create_tenant_invite_token','peek_tenant_invite');
DO $$ BEGIN IF (SELECT count(*) FROM proof.prior) <> 10 THEN RAISE EXCEPTION 'FAIL: expected 10 prior bodies'; END IF; END $$;

-- S2. The migration's INCUMBENT GUARD, read out of the migration file between its markers. On
-- production's bodies it passes; with ANY ONE of the ten replaced bodies drifted (one comment line
-- added, inside a rolled-back subtransaction) it refuses, naming that function.
\set d_guard `sed -n '/^-- exp08-owners-incumbent-guard:begin$/,/^-- exp08-owners-incumbent-guard:end$/p' supabase/migrations/20271119020008_exp08_owner_invitations.sql`
SELECT set_config('proof.guard', :'d_guard', false) IS NOT NULL AS guard_loaded \gset
DO $$ DECLARE r record; _caught text; _n int := 0; BEGIN
  IF length(current_setting('proof.guard')) < 500 THEN RAISE EXCEPTION 'FAIL: the incumbent guard was not read out of the migration'; END IF;
  EXECUTE current_setting('proof.guard');   -- passes on production's bodies
  FOR r IN SELECT p.oid::regprocedure AS f, p.proname::text AS name FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('guard_tenant_member_owner_flag',
              'guard_tenant_owner_only_columns','create_solo_team_invite','resend_solo_team_invite','revoke_solo_team_invite',
              'archive_solo_team_invite','accept_solo_team_invite','accept_tenant_invite','create_tenant_invite_token','peek_tenant_invite') LOOP
    _caught := NULL;
    BEGIN
      EXECUTE regexp_replace(pg_get_functiondef(r.f), 'AS \$function\$', E'AS $function$\n-- drift', '');
      EXECUTE current_setting('proof.guard');
    EXCEPTION WHEN OTHERS THEN _caught := SQLERRM;
    END;
    IF _caught IS NULL OR strpos(_caught, 'is not the body this migration replaces') = 0 OR strpos(_caught, r.name) = 0 THEN
      RAISE EXCEPTION 'FAIL: the incumbent guard did not refuse a drifted %: %', r.f, coalesce(_caught, 'no error'); END IF;
    _n := _n + 1;
  END LOOP;
  IF _n <> 10 THEN RAISE EXCEPTION 'FAIL: % of 10 drifted bodies tried', _n; END IF;
  -- And it is still production's bodies afterwards (every drift was rolled back).
  EXECUTE current_setting('proof.guard');
END $$;
\echo 'PASS (S2): the incumbent guard passes on production''s 10 bodies and refuses each one drifted (10 of 10)'

-- ═════════════════════ PHASE 2: the migration under test ═════════════════════
\ir ../migrations/20271119020008_exp08_owner_invitations.sql

DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('_solo_shell_tenant(uuid)','9ade6efeff0689b78ff57b116a28c9d4'),
   ('_tenant_account_holder_state(uuid)','8f9d27463a4c825994f165a5777aca1f'),
   ('_assert_tenant_account_holder(uuid,uuid,text)','eb38790a60029b984d112e836610b5d7'),
   ('_business_owner_link_is_legal_owner()','752e990d76537b69b39d092bc2a4b8a6'),
   ('_business_owner_seated_kind_guard()','f3a85dbb0bad5a0e8e1b41bc208dc83b'),
   ('_business_owner_revoke_invitations()','f73040703141190e38b2cf6c4e2cf1f3'),
   ('guard_tenant_invite_token_identity()','ce27899afe1b56d845cdabbe0d4cf9c3'),
   ('_tenant_account_holder_changed()','0e4fb930e0e08d14005d3cafbabd2429'),
   ('guard_tenant_member_owner_flag()','43d3200e76dc48a2a47997a246b1b30b'),
   ('guard_tenant_owner_only_columns()','e87af8856e175f6be1f3fb5441c6e928'),
   ('create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)','5f34e2b64c05997e9f774134cacd6665'),
   ('resend_solo_team_invite(uuid,uuid,uuid)','6001fdaf0e038d3ab321cc4d3a328b59'),
   ('revoke_solo_team_invite(uuid,uuid,uuid)','42bc300b33d754388057bc33a591d9af'),
   ('archive_solo_team_invite(uuid,uuid,uuid)','e759e3a5b3237b5413de8181cc1c2c00'),
   ('accept_solo_team_invite(text)','49c772306ac53deda3183c9a89c91331'),
   ('accept_tenant_invite(text)','e36c5df4983e1de902f868dcfb2e8094'),
   ('create_tenant_invite_token(uuid,text,tenant_role,integer,integer,uuid,text)','298f12324cacc7512898daa86c0a120f'),
   ('peek_tenant_invite(text)','d0617ee8ccd7d980935cc0f75242c0fa'),
   ('is_tenant_account_holder(uuid,uuid)','4a3cab59aad7a70ff06a9054aa4aa60e'),
   ('_tenant_member_owner_invitation_waiting()','105e79e9571515d76b4e916681791fd3')
   ) v(sig, want) LOOP
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=('public.'||r.sig)::regprocedure) IS DISTINCT FROM r.want THEN
   RAISE EXCEPTION 'FAIL: % body is not the pinned one (md5(prosrc) is %, pinned %)', r.sig,
     (SELECT md5(prosrc) FROM pg_proc WHERE oid=('public.'||r.sig)::regprocedure), r.want; END IF;
 END LOOP; END $$;
\echo 'PASS: every new and re-emitted body is the pinned one (md5(prosrc), 20 of 20)'

-- Signatures, owner, definer, search_path, volatility and ACL: unchanged where nothing was meant to change.
DO $$ DECLARE _bad text; BEGIN
  SELECT string_agg(o.name, ', ') INTO _bad FROM proof.prior o JOIN pg_proc p
    ON p.pronamespace='public'::regnamespace AND p.proname=o.name
   WHERE o.name NOT IN ('guard_tenant_owner_only_columns','create_solo_team_invite','peek_tenant_invite')
     AND (p.prorettype, p.proargtypes::text, p.proargnames::text, p.prosecdef, p.provolatile, p.proconfig::text, p.proowner, p.proacl::text, p.prolang)
         IS DISTINCT FROM (o.prorettype, o.argtypes, o.argnames, o.prosecdef, o.provolatile, o.config, o.proowner, o.acl, o.prolang);
  IF _bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: signature/owner/definer/search_path/volatility/ACL changed for %', _bad; END IF;
  -- The tenants guard: only SECURITY DEFINER -> INVOKER.
  IF (SELECT (p.prorettype, p.proargtypes::text, p.provolatile, p.proconfig::text, p.proowner, p.proacl::text, p.prolang, p.prosecdef)
        IS DISTINCT FROM (o.prorettype, o.argtypes, o.provolatile, o.config, o.proowner, o.acl, o.prolang, false)
        FROM pg_proc p JOIN proof.prior o ON o.name = p.proname WHERE p.oid = 'public.guard_tenant_owner_only_columns()'::regprocedure) THEN
    RAISE EXCEPTION 'FAIL: guard_tenant_owner_only_columns changed beyond SECURITY DEFINER -> INVOKER'; END IF;
  -- create_solo_team_invite: exactly one signature, the 9-argument one, with production's ACL and settings.
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='create_solo_team_invite') <> 1
     OR (SELECT (p.prorettype, p.prosecdef, p.provolatile, p.proconfig::text, p.proowner, p.proacl::text)
           IS DISTINCT FROM (o.prorettype, o.prosecdef, o.provolatile, o.config, o.proowner, o.acl)
           FROM pg_proc p JOIN proof.prior o ON o.name = p.proname
          WHERE p.oid = 'public.create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)'::regprocedure)
     OR (SELECT proargnames::text FROM pg_proc WHERE oid = 'public.create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)'::regprocedure)
        <> (SELECT left(argnames, -1) || ',_business_owner_id,_new_business_owner}' FROM proof.prior WHERE name = 'create_solo_team_invite') THEN
    RAISE EXCEPTION 'FAIL: create_solo_team_invite is not one 9-argument function with production''s ACL'; END IF;
  -- peek_tenant_invite: re-created with production's owner, definer, search_path and ACL.
  IF (SELECT (p.prosecdef, p.provolatile, p.proconfig::text, p.proowner, p.proacl::text, p.proargtypes::text)
        IS DISTINCT FROM (o.prosecdef, o.provolatile, o.config, o.proowner, o.acl, o.argtypes)
        FROM pg_proc p JOIN proof.prior o ON o.name = p.proname WHERE p.oid = 'public.peek_tenant_invite(text)'::regprocedure)
     OR (SELECT proargnames[array_length(proargnames, 1)] FROM pg_proc WHERE oid = 'public.peek_tenant_invite(text)'::regprocedure) <> 'business_owner_display' THEN
    RAISE EXCEPTION 'FAIL: peek_tenant_invite changed beyond its one added result column'; END IF;
  -- The new helpers and trigger functions: postgres-owned, no client EXECUTE at all.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _bad FROM pg_proc p
   WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('_solo_shell_tenant','_tenant_account_holder_state',
     '_assert_tenant_account_holder','_business_owner_link_is_legal_owner','_business_owner_seated_kind_guard',
     '_business_owner_revoke_invitations','guard_tenant_invite_token_identity','_tenant_account_holder_changed',
     '_tenant_member_owner_invitation_waiting')
     AND (p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' OR p.proowner <> 'postgres'::regrole);
  IF _bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: a new function is client-executable or not postgres-owned: %', _bad; END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('_solo_shell_tenant','_tenant_account_holder_state',
     '_assert_tenant_account_holder','_business_owner_link_is_legal_owner','_business_owner_seated_kind_guard',
     '_business_owner_revoke_invitations','guard_tenant_invite_token_identity','_tenant_account_holder_changed',
     '_tenant_member_owner_invitation_waiting')) <> 9 THEN
    RAISE EXCEPTION 'FAIL: expected 9 new functions'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.guard_tenant_invite_token_identity()'::regprocedure) THEN
    RAISE EXCEPTION 'FAIL: the token guard must be SECURITY INVOKER (current_user must be the real role)'; END IF;
  -- Triggers wired as intended.
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O' AND (tgrelid, tgname, tgfoid) IN (
        ('public.tenant_invite_tokens'::regclass, 'trg_tenant_invite_token_identity_guard', 'public.guard_tenant_invite_token_identity()'::regprocedure),
        ('public.tenant_invite_tokens'::regclass, 'trg_tenant_invite_tokens_business_owner_link', 'public._business_owner_link_is_legal_owner()'::regprocedure),
        ('public.tenant_members'::regclass, 'trg_tenant_members_business_owner_link', 'public._business_owner_link_is_legal_owner()'::regprocedure),
        ('public.tenant_business_owners'::regclass, 'trg_tenant_business_owners_seated_kind', 'public._business_owner_seated_kind_guard()'::regprocedure),
        ('public.tenant_business_owners'::regclass, 'trg_tenant_business_owners_revoke_invitations', 'public._business_owner_revoke_invitations()'::regprocedure),
        ('public.tenants'::regclass, 'trg_tenant_account_holder_changed', 'public._tenant_account_holder_changed()'::regprocedure),
        ('public.tenants'::regclass, 'trg_guard_tenant_owner_cols', 'public.guard_tenant_owner_only_columns()'::regprocedure),
        ('public.tenant_members'::regclass, 'trg_tenant_members_owner_guard', 'public.guard_tenant_member_owner_flag()'::regprocedure),
        ('public.tenant_members'::regclass, 'trg_tenant_members_owner_invitation_waiting', 'public._tenant_member_owner_invitation_waiting()'::regprocedure))) <> 9 THEN
    RAISE EXCEPTION 'FAIL: a trigger is missing, disabled or wired to the wrong function'; END IF;
  -- The token guard fires on INSERT, UPDATE and DELETE, BEFORE, per row (tgtype 1|2|4|8|16 = 31).
  IF (SELECT tgtype FROM pg_trigger WHERE tgrelid = 'public.tenant_invite_tokens'::regclass AND tgname = 'trg_tenant_invite_token_identity_guard') <> 31 THEN
    RAISE EXCEPTION 'FAIL: the token guard is not BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW'; END IF;
  -- The seat-side rule fires BEFORE INSERT OR UPDATE OF tenant_id, user_id, per row (tgtype 1|2|4|16 = 23;
  -- round 5, was BEFORE INSERT only), and is a definer (it reads auth.users).
  IF (SELECT tgtype FROM pg_trigger WHERE tgrelid = 'public.tenant_members'::regclass AND tgname = 'trg_tenant_members_owner_invitation_waiting') <> 23
     OR (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_trigger t
           JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
          WHERE t.tgrelid = 'public.tenant_members'::regclass AND t.tgname = 'trg_tenant_members_owner_invitation_waiting')
        IS DISTINCT FROM ARRAY['tenant_id','user_id']
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public._tenant_member_owner_invitation_waiting()'::regprocedure) THEN
    RAISE EXCEPTION 'FAIL: the seat-side rule is not a BEFORE INSERT OR UPDATE OF tenant_id, user_id FOR EACH ROW definer trigger'; END IF;
  -- Constraints as drawn (§5.1).
  IF (SELECT count(*) FROM pg_constraint WHERE conname IN ('tenant_business_owners_tenant_id_id_key','tenant_members_business_owner_fkey',
      'tenant_members_business_owner_only_on_owner_seat','tenant_invite_tokens_business_owner_fkey','tenant_invite_tokens_business_owner_only_on_owner_invite')) <> 5
     OR (SELECT confdeltype FROM pg_constraint WHERE conname = 'tenant_members_business_owner_fkey') <> 'a'
     OR (SELECT confdeltype FROM pg_constraint WHERE conname = 'tenant_invite_tokens_business_owner_fkey') <> 'n'
     OR (SELECT array_length(confdelsetcols, 1) FROM pg_constraint WHERE conname = 'tenant_invite_tokens_business_owner_fkey') <> 1 THEN
    RAISE EXCEPTION 'FAIL: the legal-owner constraints are not as drawn'; END IF;
END $$;
\echo 'PASS: signatures/owner/definer/search_path/volatility/ACL unchanged except the three intended (tenants guard INVOKER, create_solo_team_invite 9 args, peek one more column); 9 new functions postgres-owned with no client EXECUTE; 9 triggers wired; 5 constraints as drawn'

-- Case 13. Put back ONLY the marked lines: each re-emitted body must be production's byte for byte.
CREATE FUNCTION proof.swap(_src text, _from text, _to text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF (length(_src) - length(replace(_src, _from, ''))) / length(_from) <> 1 THEN
    RAISE EXCEPTION 'FAIL: expected exactly one occurrence of %', left(_from, 200); END IF;
  RETURN replace(_src, _from, _to);
END $$;
DO $$ DECLARE _x text; _n int := 0; _e int := 0; BEGIN
  SELECT prosrc INTO _x FROM pg_proc WHERE oid='public.guard_tenant_member_owner_flag()'::regprocedure;
  _x := proof.swap(_x, $sw$BEGIN
  -- EXP08 owners (20271119020008): which legal owner a seat acts for is written ONLY by trusted server code
  -- (accept_solo_team_invite now; the co-owner functions in a later increment). Unlike the ownership
  -- checks below, the platform owner is NOT exempt: a super admin changes owners only through audited
  -- owner recovery, never by editing a seat.
  IF current_user NOT IN ('postgres','service_role','supabase_admin','supabase_auth_admin')
     AND ((TG_OP = 'INSERT' AND NEW.business_owner_id IS NOT NULL)
          OR (TG_OP = 'UPDATE' AND NEW.business_owner_id IS DISTINCT FROM OLD.business_owner_id)) THEN
    RAISE EXCEPTION
      'OWNER_GUARD: which legal owner a seat represents may only be set by an owner invitation'
      USING ERRCODE = '42501';
  END IF;

  -- Exempt trusted server identities$sw$, $sw$BEGIN
  -- Exempt trusted server identities$sw$);
  IF _x IS DISTINCT FROM (SELECT prosrc FROM proof.prior WHERE name='guard_tenant_member_owner_flag') THEN RAISE EXCEPTION 'FAIL: guard_tenant_member_owner_flag differs from production beyond its marked lines'; END IF;
  _n := _n + 1; _e := _e + 1;
  SELECT prosrc INTO _x FROM pg_proc WHERE oid='public.guard_tenant_owner_only_columns()'::regprocedure;
  _x := proof.swap(_x, $sw$    RETURN NEW;
  END IF;

  -- EXP08 owners (20271119020008): owner recovery. platform_owner_recovery (a later increment) sets
  -- paige.owner_recovery transaction-locally around its one UPDATE. The flag alone is no credential
  -- (any role can set_config it): it counts only inside postgres-owned code, and only for a super admin.
  IF current_user = 'postgres'
     AND current_setting('paige.owner_recovery', true) = 'on'
     AND public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.owner_user_id       IS DISTINCT FROM$sw$, $sw$    RETURN NEW;
  END IF;

  IF NEW.owner_user_id       IS DISTINCT FROM$sw$);
  _x := proof.swap(_x, $sw$  -- ESTABLISH themselves (NULL -> auth.uid()) as holder, and only as the tenant's SOLE active owner.
  -- EXP08 owners (20271119020008): and only inside trusted postgres-owned code (accept_tenant_invite),
  -- never by a direct client UPDATE. This guard runs SECURITY INVOKER, so current_user is real.
  IF current_user = 'postgres'
     AND OLD.owner_user_id IS NULL
$sw$, $sw$  -- ESTABLISH themselves (NULL -> auth.uid()) as holder, and only as the tenant's SOLE active owner.
  IF OLD.owner_user_id IS NULL
$sw$);
  _x := proof.swap(_x, $sw$  -- EXP08 owners (20271119020008): the platform owner keeps billing and hierarchy, but moves the account
  -- holder of record only through owner recovery (below), never by a direct UPDATE.
  IF auth.uid() IS NULL
     OR (public.is_platform_owner() AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id) THEN
    RETURN NEW;
  END IF;
$sw$, $sw$  IF auth.uid() IS NULL OR public.is_platform_owner() THEN
    RETURN NEW;
  END IF;
$sw$);
  IF _x IS DISTINCT FROM (SELECT prosrc FROM proof.prior WHERE name='guard_tenant_owner_only_columns') THEN RAISE EXCEPTION 'FAIL: guard_tenant_owner_only_columns differs from production beyond its marked lines'; END IF;
  _n := _n + 1; _e := _e + 3;
  SELECT prosrc INTO _x FROM pg_proc WHERE oid='public.create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)'::regprocedure;
  _x := proof.swap(_x, $sw$                            'team_hub_access', _row.team_hub_access, 'business_owner_id', _row.business_owner_id);$sw$, $sw$                            'team_hub_access', _row.team_hub_access);$sw$);
  _x := proof.swap(_x, $sw$                             'team_hub_access', _team_hub_access, 'business_owner_id', _row.business_owner_id));$sw$, $sw$                             'team_hub_access', _team_hub_access));$sw$);
  _x := proof.swap(_x, $sw$     _team_hub_access, _record.id)
  RETURNING * INTO _row;$sw$, $sw$     _team_hub_access)
  RETURNING * INTO _row;$sw$);
  _x := proof.swap(_x, $sw$     team_hub_access, business_owner_id)
  VALUES
$sw$, $sw$     team_hub_access)
  VALUES
$sw$);
  _x := proof.swap(_x, $sw$    RAISE EXCEPTION 'say whether team conversations are on or off for this invitation';
  END IF;
  -- EXP08 owners (20271119020008): only the ACCOUNT HOLDER invites an Owner (owner rulings R1, R4), on a
  -- Solo account, with team conversations on, as a person or for ONE non-individual legal owner of
  -- this business that has no seat and no other live invitation. Everyone else keeps inviting Admins
  -- and Members exactly as before (R14, "keep as today").
  IF _business_owner_id IS NOT NULL AND _new_business_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Choose the legal owner they represent, or add one, not both.' USING HINT = 'OWNER_RECORD_AMBIGUOUS';
  END IF;
  IF lower(trim(_permission)) <> 'owner' AND (_business_owner_id IS NOT NULL OR _new_business_owner IS NOT NULL) THEN
    RAISE EXCEPTION 'Only an owner invitation can be for a legal owner.' USING HINT = 'OWNER_RECORD_NOT_OWNER';
  END IF;
  IF lower(trim(_permission)) = 'owner' THEN
    IF NOT public._solo_shell_tenant(_tenant) THEN
      RAISE EXCEPTION 'Owner invitations aren''t available for this account.' USING ERRCODE = '42501', HINT = 'OWNER_INVITE_UNAVAILABLE';
    END IF;
    -- Before anything about the legal owner is read, so a refusal says nothing about the record.
    PERFORM public._assert_tenant_account_holder(_actor, _tenant, 'add');
    IF _team_hub_access IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Owners always take part in team conversations.' USING HINT = 'OWNER_TEAM_CONVERSATIONS';
    END IF;
    IF _new_business_owner IS NOT NULL THEN
      IF jsonb_typeof(_new_business_owner) IS DISTINCT FROM 'object'
         OR COALESCE(_new_business_owner->>'ownerKind', '') NOT IN ('company', 'trust', 'other_legal_person') THEN
        RAISE EXCEPTION 'Choose whether the legal owner is a company, a trust, or a partnership or other legal person.' USING HINT = 'OWNER_RECORD_KIND';
      END IF;
      IF char_length(btrim(COALESCE(_new_business_owner->>'legalName', ''))) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'Enter the legal name.' USING HINT = 'OWNER_RECORD_NAME';
      END IF;
      INSERT INTO public.tenant_business_owners (tenant_id, owner_kind, legal_name, created_by, updated_by, setup_provenance)
      VALUES (_tenant, _new_business_owner->>'ownerKind', btrim(_new_business_owner->>'legalName'), _actor, _actor,
              jsonb_build_object('source', 'team_invite'))
      RETURNING * INTO _record;
    ELSIF _business_owner_id IS NOT NULL THEN
      SELECT * INTO _record FROM public.tenant_business_owners
       WHERE id = _business_owner_id AND tenant_id = _tenant FOR UPDATE;
      IF _record.id IS NULL THEN
        RAISE EXCEPTION 'Choose the legal owner they represent.' USING HINT = 'OWNER_RECORD_NOT_FOUND';
      END IF;
      IF _record.owner_kind = 'individual' THEN
        RAISE EXCEPTION 'A person is invited as an owner in their own right, not as a legal owner.' USING HINT = 'OWNER_RECORD_INDIVIDUAL';
      END IF;
      IF EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant AND business_owner_id = _record.id) THEN
        RAISE EXCEPTION '% already has a representative on the team.', COALESCE(_record.display_name, _record.legal_name)
          USING HINT = 'OWNER_RECORD_SEATED';
      END IF;
      -- An expired, unused invitation for this record still holds the one-live-invitation index,
      -- whatever its email, and would turn the next invitation into a raw unique-index error.
      UPDATE public.tenant_invite_tokens
         SET revoked_at = now(), updated_at = now()
       WHERE business_owner_id = _record.id AND uses = 0 AND revoked_at IS NULL AND expires_at <= now();
      IF EXISTS (SELECT 1 FROM public.tenant_invite_tokens
                  WHERE business_owner_id = _record.id AND uses = 0 AND revoked_at IS NULL
                    AND lower(email) <> lower(trim(_email))) THEN
        RAISE EXCEPTION 'There''s already an owner invitation pending for %.', COALESCE(_record.display_name, _record.legal_name)
          USING HINT = 'OWNER_RECORD_INVITED';
      END IF;
    END IF;
  ELSIF NOT public.is_tenant_account_holder(_actor, _tenant) AND EXISTS (
    SELECT 1 FROM public.tenant_invite_tokens
     WHERE tenant_id = _tenant AND kind = 'team' AND default_role = 'owner'::public.tenant_role
       AND lower(email) = lower(trim(_email)) AND uses = 0 AND revoked_at IS NULL AND expires_at > now()
  ) THEN
    -- The replace below would withdraw it, and only the account holder changes an owner invitation.
    RAISE EXCEPTION 'There''s already an owner invitation for this address. Only the account holder can change it.'
      USING ERRCODE = '42501', HINT = 'OWNER_INVITE_EXISTS_FOR_ADDRESS';
  END IF;
$sw$, $sw$    RAISE EXCEPTION 'say whether team conversations are on or off for this invitation';
  END IF;
$sw$);
  _x := proof.swap(_x, $sw$  IF lower(trim(_permission)) NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'team invitations may grant only Owner, Admin or Member';$sw$, $sw$  IF lower(trim(_permission)) NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'team invitations may grant only Admin or Member';$sw$);
  _x := proof.swap(_x, $sw$  _row public.tenant_invite_tokens;
  _record public.tenant_business_owners;
BEGIN$sw$, $sw$  _row public.tenant_invite_tokens;
BEGIN$sw$);
  IF _x IS DISTINCT FROM (SELECT prosrc FROM proof.prior WHERE name='create_solo_team_invite') THEN RAISE EXCEPTION 'FAIL: create_solo_team_invite differs from production beyond its marked lines'; END IF;
  _n := _n + 1; _e := _e + 7;
  SELECT prosrc INTO _x FROM pg_proc WHERE oid='public.resend_solo_team_invite(uuid,uuid,uuid)'::regprocedure;
  _x := proof.swap(_x, $sw$                                        _old.team_hub_access, _old.business_owner_id);$sw$, $sw$                                        _old.team_hub_access);$sw$);
  _x := proof.swap(_x, $sw$  IF _old.uses > 0 THEN RAISE EXCEPTION 'an accepted invitation cannot be resent'; END IF;
  -- EXP08 owners (20271119020008): an owner invitation is the account holder's to resend.
  -- One whose legal owner was deleted is never reissued: the FK has nulled its link, and resending it
  -- would make it an owner invitation for the person in their own right.
  IF _old.default_role = 'owner'::public.tenant_role THEN
    PERFORM public._assert_tenant_account_holder(_actor, _tenant, 'invitation');
    IF _old.business_owner_removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'This owner invitation was for a legal owner that has since been removed, so it can''t be sent again. Send a new owner invitation instead.'
        USING HINT = 'OWNER_INVITE_RECORD_REMOVED';
    END IF;
  END IF;
$sw$, $sw$  IF _old.uses > 0 THEN RAISE EXCEPTION 'an accepted invitation cannot be resent'; END IF;
$sw$);
  IF _x IS DISTINCT FROM (SELECT prosrc FROM proof.prior WHERE name='resend_solo_team_invite') THEN RAISE EXCEPTION 'FAIL: resend_solo_team_invite differs from production beyond its marked lines'; END IF;
  _n := _n + 1; _e := _e + 2;
  SELECT prosrc INTO _x FROM pg_proc WHERE oid='public.revoke_solo_team_invite(uuid,uuid,uuid)'::regprocedure;
  _x := proof.swap(_x, $sw$  _tenant := public.solo_team_invite_authority(_actor, _expected_tenant_id);

  -- EXP08 owners (20271119020008): an owner invitation is the account holder's to withdraw.
  IF EXISTS (SELECT 1 FROM public.tenant_invite_tokens
              WHERE id = _invite_id AND tenant_id = _tenant AND kind = 'team'
                AND default_role = 'owner'::public.tenant_role) THEN
    PERFORM public._assert_tenant_account_holder(_actor, _tenant, 'invitation');
  END IF;

  UPDATE public.tenant_invite_tokens$sw$, $sw$  _tenant := public.solo_team_invite_authority(_actor, _expected_tenant_id);

  UPDATE public.tenant_invite_tokens$sw$);
  IF _x IS DISTINCT FROM (SELECT prosrc FROM proof.prior WHERE name='revoke_solo_team_invite') THEN RAISE EXCEPTION 'FAIL: revoke_solo_team_invite differs from production beyond its marked lines'; END IF;
  _n := _n + 1; _e := _e + 1;
  SELECT prosrc INTO _x FROM pg_proc WHERE oid='public.archive_solo_team_invite(uuid,uuid,uuid)'::regprocedure;
  _x := proof.swap(_x, $sw$    RAISE EXCEPTION 'that invitation is not on this workspace' USING ERRCODE = 'P0001';
  END IF;

  -- EXP08 owners (20271119020008): an owner invitation is the account holder's to clear.
  IF _invite.default_role = 'owner'::public.tenant_role THEN
    PERFORM public._assert_tenant_account_holder(_actor, _tenant, 'invitation');
  END IF;
$sw$, $sw$    RAISE EXCEPTION 'that invitation is not on this workspace' USING ERRCODE = 'P0001';
  END IF;
$sw$);
  IF _x IS DISTINCT FROM (SELECT prosrc FROM proof.prior WHERE name='archive_solo_team_invite') THEN RAISE EXCEPTION 'FAIL: archive_solo_team_invite differs from production beyond its marked lines'; END IF;
  _n := _n + 1; _e := _e + 1;
  SELECT prosrc INTO _x FROM pg_proc WHERE oid='public.accept_solo_team_invite(text)'::regprocedure;
  _x := proof.swap(_x, $sw$                             'team_hub_access', _invite.team_hub_access, 'business_owner_id', _invite.business_owner_id));$sw$, $sw$                             'team_hub_access', _invite.team_hub_access));$sw$);
  _x := proof.swap(_x, $sw$  UPDATE public.profiles SET active_tenant_id = _invite.tenant_id WHERE user_id = _actor;
  -- EXP08 owners (20271119020008): the seat is the only source of "Represented by …". The record's earlier
  -- representative, if any, is overwritten and kept in the audit row.
  IF _record.id IS NOT NULL THEN
    UPDATE public.tenant_business_owners
       SET representative_user_id = _actor, owner_seat_vacant_since = NULL, updated_at = now()
     WHERE id = _record.id;
    INSERT INTO public.paige_audit_log (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
    VALUES (_actor, 'owner', 'tenant:business_owner_representative_named', 'tenant_business_owner', _record.id,
            jsonb_build_object('tenant_id', _invite.tenant_id, 'business_owner_id', _record.id,
                               'representative_user_id', _actor,
                               'previous_representative_user_id', _record.representative_user_id,
                               'via', 'accept_solo_team_invite', 'invite_id', _invite.id),
            _invite.tenant_id);
  END IF;
$sw$, $sw$  UPDATE public.profiles SET active_tenant_id = _invite.tenant_id WHERE user_id = _actor;
$sw$);
  _x := proof.swap(_x, $sw$    (tenant_id, user_id, role, status, is_owner, invited_at, joined_at, job_title, responsibilities, team_hub_access,
     business_owner_id)
  VALUES
    (_invite.tenant_id, _actor, _invite.default_role, 'active', _invite.default_role = 'owner'::public.tenant_role, _invite.created_at, now(),
     _invite.job_title, _invite.responsibilities, _invite.team_hub_access OR _invite.default_role = 'owner'::public.tenant_role,
     _invite.business_owner_id);$sw$, $sw$    (tenant_id, user_id, role, status, is_owner, invited_at, joined_at, job_title, responsibilities, team_hub_access)
  VALUES
    (_invite.tenant_id, _actor, _invite.default_role, 'active', false, _invite.created_at, now(),
     _invite.job_title, _invite.responsibilities, _invite.team_hub_access);$sw$);
  _x := proof.swap(_x, $sw$    RAISE EXCEPTION 'team invitation has an unsupported permission';
  END IF;
  -- EXP08 owners (20271119020008): an owner invitation is re-checked at the moment it is used, under the
  -- token lock: the sender must STILL be the account holder, the account a Solo one, and a legal
  -- owner's seat still open (owner rulings R1, R4, R6; contract §5.3). The tenant row (the holder of
  -- record) and the sender's seat (which a billing suspension rewrites) are locked FOR SHARE first,
  -- so neither can change between this check and the seat it allows.
  IF _invite.default_role = 'owner'::public.tenant_role THEN
    SELECT name INTO _tenant_name FROM public.tenants WHERE id = _invite.tenant_id FOR SHARE;
    PERFORM 1 FROM public.tenant_members WHERE tenant_id = _invite.tenant_id AND user_id = _invite.created_by FOR SHARE;
    IF NOT public._solo_shell_tenant(_invite.tenant_id) THEN
      RAISE EXCEPTION 'Owner invitations aren''t available for this account.' USING ERRCODE = '42501', HINT = 'OWNER_INVITE_UNAVAILABLE';
    END IF;
    IF NOT public.is_tenant_account_holder(_invite.created_by, _invite.tenant_id) THEN
      RAISE EXCEPTION 'This owner invitation can''t be used any more: the person who sent it can no longer add owners to %. Ask the account holder for a new one.',
        COALESCE(_tenant_name, 'this business') USING ERRCODE = '42501', HINT = 'OWNER_INVITE_SENDER_NOT_HOLDER';
    END IF;
    IF _invite.business_owner_id IS NOT NULL THEN
      SELECT * INTO _record FROM public.tenant_business_owners
       WHERE id = _invite.business_owner_id AND tenant_id = _invite.tenant_id FOR UPDATE;
      IF _record.id IS NULL OR _record.owner_kind = 'individual'
         OR EXISTS (SELECT 1 FROM public.tenant_members
                     WHERE tenant_id = _invite.tenant_id AND business_owner_id = _record.id) THEN
        RAISE EXCEPTION 'This owner invitation was for %, and that owner seat has changed since it was sent. Ask the account holder for a new invitation.',
          COALESCE(_record.display_name, _record.legal_name, 'a legal owner') USING ERRCODE = '42501', HINT = 'OWNER_INVITE_SEAT_CHANGED';
      END IF;
    END IF;
  END IF;
$sw$, $sw$    RAISE EXCEPTION 'team invitation has an unsupported permission';
  END IF;
$sw$);
  _x := proof.swap(_x, $sw$  IF _invite.default_role NOT IN ('owner'::public.tenant_role, 'admin'::public.tenant_role, 'member'::public.tenant_role) THEN$sw$, $sw$  IF _invite.default_role NOT IN ('admin'::public.tenant_role, 'member'::public.tenant_role) THEN$sw$);
  _x := proof.swap(_x, $sw$  _invite public.tenant_invite_tokens;
  _record public.tenant_business_owners;
  _tenant_name text;
BEGIN$sw$, $sw$  _invite public.tenant_invite_tokens;
BEGIN$sw$);
  IF _x IS DISTINCT FROM (SELECT prosrc FROM proof.prior WHERE name='accept_solo_team_invite') THEN RAISE EXCEPTION 'FAIL: accept_solo_team_invite differs from production beyond its marked lines'; END IF;
  _n := _n + 1; _e := _e + 6;
  SELECT prosrc INTO _x FROM pg_proc WHERE oid='public.accept_tenant_invite(text)'::regprocedure;
  _x := proof.swap(_x, $sw$  ELSE
    -- EXP08 owners (20271119020008): an owner invitation is accepted only by accept_solo_team_invite,
    -- which re-checks the account holder at that moment. Here it used to be silently turned into an
    -- Admin seat and reported as accepted (§13). It is refused instead, before anything is written.
    IF _tok.default_role = 'owner'::public.tenant_role THEN
      RAISE EXCEPTION 'this invitation can''t be accepted here' USING ERRCODE = '42501', HINT = 'OWNER_INVITE_NOT_HERE';
    END IF;
    -- SECURITY (Tier Rail Phase A): a generic staff/'team' invite may only grant$sw$, $sw$  ELSE
    -- SECURITY (Tier Rail Phase A): a generic staff/'team' invite may only grant$sw$);
  IF _x IS DISTINCT FROM (SELECT prosrc FROM proof.prior WHERE name='accept_tenant_invite') THEN RAISE EXCEPTION 'FAIL: accept_tenant_invite differs from production beyond its marked lines'; END IF;
  _n := _n + 1; _e := _e + 1;
  SELECT prosrc INTO _x FROM pg_proc WHERE oid='public.create_tenant_invite_token(uuid,text,tenant_role,integer,integer,uuid,text)'::regprocedure;
  _x := proof.swap(_x, $sw$  -- FIX-1 (§9), narrowed by EXP08 owners (20271119020008): no token minted here carries Owner, for any
  -- kind or any caller, the platform owner included. An Owner is invited only by the account holder,
  -- through create_solo_team_invite (owner rulings R1, R4).
  -- The sentence is the one the Agency Team screen shows (it still offers Owner), so it says what that
  -- person CAN do, true for whichever account they are working in.
  IF _default_role = 'owner'::public.tenant_role THEN
    IF public.is_company_workspace(_tenant_id) THEN
      RAISE EXCEPTION 'Owner invitations aren''t available for this account.' USING ERRCODE = '42501', HINT = 'OWNER_INVITE_UNAVAILABLE';
    ELSIF (SELECT account_type FROM public.tenants WHERE id = _tenant_id) IN ('agency', 'enterprise') THEN
      RAISE EXCEPTION '% accounts add Admins and Members. An owner is added by the account holder of a business account, from its Settings → Team.',
        CASE WHEN (SELECT account_type FROM public.tenants WHERE id = _tenant_id) = 'enterprise' THEN 'Enterprise' ELSE 'Agency' END
        USING ERRCODE = '42501', HINT = 'OWNER_INVITE_SETTINGS_ONLY';
    END IF;
    RAISE EXCEPTION 'Owners are added only by this business''s account holder, from Settings → Team. You can invite an Admin or Member here.'
      USING ERRCODE = '42501', HINT = 'OWNER_INVITE_SETTINGS_ONLY';
  END IF;$sw$, $sw$  -- FIX-1 (§9): owner-level invite requires actual ownership, not mere admin.
  IF _default_role = 'owner'::public.tenant_role
     AND NOT (public.is_tenant_owner(auth.uid(), _tenant_id) OR public.is_platform_owner()) THEN
    RAISE EXCEPTION 'not authorized to create an owner-level invite for this tenant; owner elevation is via grant_co_owner()'
      USING ERRCODE = '42501';
  END IF;$sw$);
  IF _x IS DISTINCT FROM (SELECT prosrc FROM proof.prior WHERE name='create_tenant_invite_token') THEN RAISE EXCEPTION 'FAIL: create_tenant_invite_token differs from production beyond its marked lines'; END IF;
  _n := _n + 1; _e := _e + 1;
  SELECT prosrc INTO _x FROM pg_proc WHERE oid='public.peek_tenant_invite(text)'::regprocedure;
  _x := proof.swap(_x, $sw$                   AND (_tok.kind <> 'consumer' OR (_tok.uses = 0 AND _tok.last_used_at IS NULL));
  -- EXP08 owners (20271119020008): an owner invitation for a legal owner names it, so the invitee knows
  -- whom they would act for, and only while it can still be used. A deliberate exposure to whoever
  -- holds a live link: the name only, never the ownership interest or the representative.
  business_owner_display := NULL;
  IF is_valid AND _tok.default_role = 'owner'::public.tenant_role AND _tok.business_owner_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(bo.display_name), ''), bo.legal_name) INTO business_owner_display
      FROM public.tenant_business_owners bo
     WHERE bo.id = _tok.business_owner_id AND bo.tenant_id = _tok.tenant_id;
  END IF;
$sw$, $sw$                   AND (_tok.kind <> 'consumer' OR (_tok.uses = 0 AND _tok.last_used_at IS NULL));
$sw$);
  IF _x IS DISTINCT FROM (SELECT prosrc FROM proof.prior WHERE name='peek_tenant_invite') THEN RAISE EXCEPTION 'FAIL: peek_tenant_invite differs from production beyond its marked lines'; END IF;
  _n := _n + 1; _e := _e + 1;
  IF _n <> 10 THEN RAISE EXCEPTION 'FAIL: % of 10 bodies compared', _n; END IF;
  RAISE NOTICE 'byte-identity: % bodies, % marked edits', _n, _e;
END $$;
\echo 'PASS (case 13): with only the marked lines put back, all 10 re-emitted bodies are production''s byte for byte (24 marked edits)'

\echo '── PHASE 2, migrated: cases that fail (expected: none) ──'
CREATE TABLE proof.phase2 AS SELECT * FROM proof.failing();
SELECT id AS failing_after_migration, why FROM proof.phase2;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM proof.phase2) THEN RAISE EXCEPTION 'FAIL: % case(s) fail after the migration', (SELECT count(*) FROM proof.phase2); END IF; END $$;
SELECT format('PASS: after the migration all %s cases pass (%s kept, %s holes closed, %s new)',
  (SELECT count(*) FROM proof.checks), (SELECT count(*) FROM proof.checks WHERE kind='kept'),
  (SELECT count(*) FROM proof.checks WHERE kind='hole'), (SELECT count(*) FROM proof.checks WHERE kind='new')) AS phase2 \gset
\echo :phase2

-- ═════════════════════ PHASE 3: mutants (§71.4) ═════════════════════
CREATE TABLE proof.mutants(n serial, name text, sig text, from_text text, to_text text, control boolean NOT NULL DEFAULT false, failing text[]);
INSERT INTO proof.mutants(name, sig, from_text, to_text, control) VALUES
 ('S01 seat rule: an owner seat no longer exempt', '_tenant_member_owner_invitation_waiting()',
   $m$IF NEW.is_owner IS TRUE THEN$m$, $m$IF false THEN$m$, false),
 ('S02 seat rule: an existing seat no longer exempt', '_tenant_member_owner_invitation_waiting()',
   $m$IF EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = NEW.tenant_id AND m.user_id = NEW.user_id) THEN$m$, $m$IF false THEN$m$, false),
 ('S03 seat rule: another business''s owner invitation counts', '_tenant_member_owner_invitation_waiting()',
   $m$AND tk.tenant_id = NEW.tenant_id AND tk.kind$m$, $m$AND tk.kind$m$, false),
 ('S04 seat rule: an Owner-role invitation of any kind counts', '_tenant_member_owner_invitation_waiting()',
   $m$tk.kind = 'team' AND tk.default_role$m$, $m$tk.default_role$m$, false),
 ('S05 seat rule: a non-owner invitation counts', '_tenant_member_owner_invitation_waiting()',
   $m$AND tk.default_role = 'owner'::public.tenant_role$m$, $m$$m$, false),
 ('S06 seat rule: a used owner invitation counts', '_tenant_member_owner_invitation_waiting()',
   $m$AND tk.uses = 0 AND tk.revoked_at$m$, $m$AND tk.revoked_at$m$, false),
 ('S07 seat rule: a withdrawn owner invitation counts', '_tenant_member_owner_invitation_waiting()',
   $m$AND tk.revoked_at IS NULL AND tk.expires_at$m$, $m$AND tk.expires_at$m$, false),
 ('S08 seat rule: an expired owner invitation counts', '_tenant_member_owner_invitation_waiting()',
   $m$AND tk.expires_at > now() AND tk.archived_at$m$, $m$AND tk.archived_at$m$, false),
 ('S09 seat rule: an archived owner invitation counts', '_tenant_member_owner_invitation_waiting()',
   $m$ AND tk.archived_at IS NULL
$m$, $m$
$m$, false),
 ('S10 seat rule: the address compared exactly as stored', '_tenant_member_owner_invitation_waiting()',
   $m$ON lower(btrim(tk.email)) = lower(btrim(u.email))$m$, $m$ON tk.email = u.email$m$, false),
 ('S11 seat rule: the person and a granter read each other''s sentence', '_tenant_member_owner_invitation_waiting()',
   $m$IF auth.uid() IS NULL OR auth.uid() = NEW.user_id THEN$m$, $m$IF auth.uid() IS NULL OR auth.uid() <> NEW.user_id THEN$m$, false),
 ('S12 seat rule: the person''s sentence carries another HINT (Y13)', '_tenant_member_owner_invitation_waiting()',
   $m$'this business') USING ERRCODE = '42501', HINT = 'OWNER_INVITE_WAITING';
    END IF;$m$, $m$'this business') USING ERRCODE = '42501', HINT = 'OWNER_HOLDER_ONLY';
    END IF;$m$, false),
 ('S13 seat rule: the granter''s sentence carries no HINT (Y13)', '_tenant_member_owner_invitation_waiting()',
   $m$'this business') USING ERRCODE = '42501', HINT = 'OWNER_INVITE_WAITING';
  END IF;$m$, $m$'this business') USING ERRCODE = '42501';
  END IF;$m$, false),
 ('S14 seat rule: an owner invitation at max_uses counts (round 5)', '_tenant_member_owner_invitation_waiting()',
   $m$
                AND (tk.max_uses IS NULL OR tk.uses < tk.max_uses)$m$, $m$$m$, false),
 ('S15 seat rule: an owner invitation outside a Solo account counts (round 5)', '_tenant_member_owner_invitation_waiting()',
   $m$
                AND public._solo_shell_tenant(tk.tenant_id)$m$, $m$$m$, false),
 ('S16 seat rule: an owner invitation whose sender is not the account holder counts (round 5, R3)', '_tenant_member_owner_invitation_waiting()',
   $m$
                AND public.is_tenant_account_holder(tk.created_by, tk.tenant_id)$m$, $m$$m$, false),
 ('S17 seat rule: an owner invitation for a legal owner retyped to an individual counts (round 5, R4)', '_tenant_member_owner_invitation_waiting()',
   $m$
                                   AND bo.owner_kind <> 'individual'$m$, $m$$m$, false),
 ('S18 seat rule: an owner invitation for a legal owner whose seat is filled counts (round 5, R4)', '_tenant_member_owner_invitation_waiting()',
   $m$
                                   AND NOT EXISTS (SELECT 1 FROM public.tenant_members s
                                                    WHERE s.tenant_id = tk.tenant_id AND s.business_owner_id = bo.id)$m$, $m$$m$, false),
 ('S19 seat rule: a legal owner on the invitation is not looked at (round 5)', '_tenant_member_owner_invitation_waiting()',
   $m$AND (tk.business_owner_id IS NULL
                     OR EXISTS ($m$, $m$AND (true
                     OR EXISTS ($m$, false),
 ('S20 seat rule: an invitation naming a legal owner never counts (round 5)', '_tenant_member_owner_invitation_waiting()',
   $m$AND (tk.business_owner_id IS NULL
                     OR EXISTS ($m$, $m$AND (tk.business_owner_id IS NULL
                     OR false AND EXISTS ($m$, false),
 ('S21 seat rule: an owner invitation to an unconfirmed address counts (round 6, N1)', '_tenant_member_owner_invitation_waiting()',
   $m$ AND u.email_confirmed_at IS NOT NULL$m$, $m$$m$, false),
 ('X01 token guard: the address rule ignores the business', 'guard_tenant_invite_token_identity()',
   $m$WHERE tk.tenant_id = NEW.tenant_id AND tk.kind = 'team'$m$, $m$WHERE tk.kind = 'team'$m$, false),
 ('X02 token guard: a used owner invitation counts', 'guard_tenant_invite_token_identity()',
   $m$AND tk.uses = 0 AND tk.revoked_at IS NULL AND tk.expires_at > now()) THEN$m$, $m$AND tk.revoked_at IS NULL AND tk.expires_at > now()) THEN$m$, false),
 ('X03 token guard: a withdrawn owner invitation counts', 'guard_tenant_invite_token_identity()',
   $m$AND tk.uses = 0 AND tk.revoked_at IS NULL AND tk.expires_at > now()) THEN$m$, $m$AND tk.uses = 0 AND tk.expires_at > now()) THEN$m$, false),
 ('X04 token guard: a non-owner team invitation counts', 'guard_tenant_invite_token_identity()',
   $m$tk.kind = 'team' AND tk.default_role = 'owner'::public.tenant_role$m$, $m$tk.kind = 'team'$m$, false),
 ('X05 token guard: the service role no longer exempt from the address rule', 'guard_tenant_invite_token_identity()',
   $m$IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND NEW.kind NOT IN ('consumer', 'agency_team')
     AND NULLIF$m$, $m$IF TG_OP = 'INSERT' AND NEW.kind NOT IN ('consumer', 'agency_team')
     AND NULLIF$m$, false),
 ('M01 create: the account-holder gate removed', 'create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)',
   $m$PERFORM public._assert_tenant_account_holder(_actor, _tenant, 'add');$m$, $m$NULL;$m$, false),
 ('M02 create: the Solo-account gate removed', 'create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)',
   $m$IF NOT public._solo_shell_tenant(_tenant) THEN$m$, $m$IF false THEN$m$, false),
 ('M03 create: Owner with team conversations off allowed', 'create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)',
   $m$IF _team_hub_access IS DISTINCT FROM true THEN$m$, $m$IF false THEN$m$, false),
 ('M04 create: an individual record allowed', 'create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)',
   $m$IF _record.owner_kind = 'individual' THEN$m$, $m$IF false THEN$m$, false),
 ('M05 create: a seated record allowed', 'create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)',
   $m$IF EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant AND business_owner_id = _record.id) THEN$m$, $m$IF false THEN$m$, false),
 ('M06 create: expired invitations for the record not revoked', 'create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)',
   $m$AND uses = 0 AND revoked_at IS NULL AND expires_at <= now();$m$, $m$AND false;$m$, false),
 ('M07 create: a second live invitation for the record not refused', 'create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)',
   $m$AND lower(email) <> lower(trim(_email))) THEN$m$, $m$AND false) THEN$m$, false),
 ('M08 create: a non-holder may replace an owner invitation', 'create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)',
   $m$ELSIF NOT public.is_tenant_account_holder(_actor, _tenant) AND EXISTS ($m$, $m$ELSIF false AND EXISTS ($m$, false),
 ('M09 create: a record from any business', 'create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)',
   $m$WHERE id = _business_owner_id AND tenant_id = _tenant FOR UPDATE;$m$, $m$WHERE id = _business_owner_id FOR UPDATE;$m$, false),
 ('M10 resend: the account-holder gate removed', 'resend_solo_team_invite(uuid,uuid,uuid)',
   $m$PERFORM public._assert_tenant_account_holder(_actor, _tenant, 'invitation');$m$, $m$NULL;$m$, false),
 ('M11 revoke: the account-holder gate removed', 'revoke_solo_team_invite(uuid,uuid,uuid)',
   $m$PERFORM public._assert_tenant_account_holder(_actor, _tenant, 'invitation');$m$, $m$NULL;$m$, false),
 ('M12 archive: the account-holder gate removed', 'archive_solo_team_invite(uuid,uuid,uuid)',
   $m$PERFORM public._assert_tenant_account_holder(_actor, _tenant, 'invitation');$m$, $m$NULL;$m$, false),
 ('M13 accept: the sender is not re-checked', 'accept_solo_team_invite(text)',
   $m$IF NOT public.is_tenant_account_holder(_invite.created_by, _invite.tenant_id) THEN$m$, $m$IF false THEN$m$, false),
 ('M14 accept: the Solo account is not re-checked', 'accept_solo_team_invite(text)',
   $m$IF NOT public._solo_shell_tenant(_invite.tenant_id) THEN$m$, $m$IF false THEN$m$, false),
 ('M15 accept: an individual record is not re-checked', 'accept_solo_team_invite(text)',
   $m$IF _record.id IS NULL OR _record.owner_kind = 'individual'$m$, $m$IF _record.id IS NULL$m$, false),
 ('M16 accept: a filled seat is not re-checked', 'accept_solo_team_invite(text)',
   $m$
         OR EXISTS (SELECT 1 FROM public.tenant_members
                     WHERE tenant_id = _invite.tenant_id AND business_owner_id = _record.id) THEN$m$, $m$ THEN$m$, false),
 ('M17 accept: the owner seat lands without is_owner', 'accept_solo_team_invite(text)',
   $m$'active', _invite.default_role = 'owner'::public.tenant_role, _invite.created_at$m$, $m$'active', false, _invite.created_at$m$, false),
 ('M18 accept: the representative is not named', 'accept_solo_team_invite(text)',
   $m$SET representative_user_id = _actor, owner_seat_vacant_since$m$, $m$SET owner_seat_vacant_since$m$, false),
 ('M19 accept_tenant_invite: an owner token accepted again', 'accept_tenant_invite(text)',
   $m$IF _tok.default_role = 'owner'::public.tenant_role THEN$m$, $m$IF false THEN$m$, false),
 ('M20 create_tenant_invite_token: Owner minted again', 'create_tenant_invite_token(uuid,text,tenant_role,integer,integer,uuid,text)',
   $m$  IF _default_role = 'owner'::public.tenant_role THEN$m$, $m$  IF false THEN$m$, false),
 ('M21 token guard: owner rows writable', 'guard_tenant_invite_token_identity()',
   $m$IF OLD.default_role = 'owner'::public.tenant_role THEN$m$, $m$IF false THEN$m$, false),
 ('M22 token guard: columns not frozen', 'guard_tenant_invite_token_identity()',
   $m$IF (to_jsonb(NEW) - 'revoked_at' - 'updated_at') IS DISTINCT FROM$m$, $m$IF false AND (to_jsonb(NEW) - 'revoked_at' - 'updated_at') IS DISTINCT FROM$m$, false),
 ('M23 token guard: created_by not checked', 'guard_tenant_invite_token_identity()',
   $m$IF NEW.created_by IS DISTINCT FROM auth.uid() THEN$m$, $m$IF false THEN$m$, false),
 ('M24 token guard: a second revoke overwrites the first time', 'guard_tenant_invite_token_identity()',
   $m$    NEW.revoked_at := OLD.revoked_at;
$m$, $m$$m$, false),
 ('M25 token guard: un-revoke allowed', 'guard_tenant_invite_token_identity()',
   $m$    IF NEW.revoked_at IS NULL THEN$m$, $m$    IF false THEN$m$, false),
 ('M26 token guard: platform owner exempt', 'guard_tenant_invite_token_identity()',
   $m$IF auth.uid() IS NULL OR current_user = 'postgres' THEN$m$, $m$IF auth.uid() IS NULL OR current_user = 'postgres' OR public.is_platform_owner() THEN$m$, false),
 ('M27 token guard: owner tokens insertable', 'guard_tenant_invite_token_identity()',
   $m$IF NEW.default_role = 'owner'::public.tenant_role OR NEW.business_owner_id IS NOT NULL THEN$m$, $m$IF false THEN$m$, false),
 ('M28 seat guard: business_owner_id writable', 'guard_tenant_member_owner_flag()',
   $m$AND ((TG_OP = 'INSERT' AND NEW.business_owner_id IS NOT NULL)$m$, $m$AND false AND ((TG_OP = 'INSERT' AND NEW.business_owner_id IS NOT NULL)$m$, false),
 ('M29 seat guard: the platform owner exempt for business_owner_id', 'guard_tenant_member_owner_flag()',
   $m$IF current_user NOT IN ('postgres','service_role','supabase_admin','supabase_auth_admin')
     AND ((TG_OP$m$, $m$IF current_user NOT IN ('postgres','service_role','supabase_admin','supabase_auth_admin') AND NOT public.is_platform_owner()
     AND ((TG_OP$m$, false),
 ('M30 tenants guard: the platform owner moves the holder directly again', 'guard_tenant_owner_only_columns()',
   $m$OR (public.is_platform_owner() AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id) THEN$m$, $m$OR public.is_platform_owner() THEN$m$, false),
 ('M31 tenants guard: the carve-out works for a direct client UPDATE', 'guard_tenant_owner_only_columns()',
   $m$  IF current_user = 'postgres'
     AND OLD.owner_user_id IS NULL$m$, $m$  IF true
     AND OLD.owner_user_id IS NULL$m$, false),
 ('M32 tenants guard: recovery without a super admin', 'guard_tenant_owner_only_columns()',
   $m$     AND current_setting('paige.owner_recovery', true) = 'on'
     AND public.is_super_admin(auth.uid()) THEN$m$, $m$     AND current_setting('paige.owner_recovery', true) = 'on' THEN$m$, false),
 ('M33 tenants guard: recovery flag honoured outside postgres-owned code', 'guard_tenant_owner_only_columns()',
   $m$  IF current_user = 'postgres'
     AND current_setting('paige.owner_recovery', true) = 'on'$m$, $m$  IF true
     AND current_setting('paige.owner_recovery', true) = 'on'$m$, false),
 ('M34 holder moves are not audited', '_tenant_account_holder_changed()',
   $m$  INSERT INTO public.paige_audit_log$m$, $m$  RETURN NULL;
  INSERT INTO public.paige_audit_log$m$, false),
 ('M35 deleting a legal owner does not revoke its invitations', '_business_owner_revoke_invitations()',
   $m$   WHERE tenant_id = OLD.tenant_id AND business_owner_id = OLD.id;$m$, $m$   WHERE false;$m$, false),
 ('M36 link trigger: an individual record accepted', '_business_owner_link_is_legal_owner()',
   $m$ AND bo.owner_kind <> 'individual'$m$, $m$$m$, false),
 ('M37 holder refusal: paused reads as the generic refusal', '_assert_tenant_account_holder(uuid,uuid,text)',
   $m$  ELSIF _state = 'paused' THEN$m$, $m$  ELSIF false THEN$m$, false),
 ('M38 holder state: a suspended holder is not paused', '_tenant_account_holder_state(uuid)',
   $m$AND m.is_owner = true AND m.status = 'suspended') THEN 'paused'$m$, $m$AND false) THEN 'paused'$m$, false),
 ('M39 holder state: a pointer at a deleted user is not none', '_tenant_account_holder_state(uuid)',
   $m$
                OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.owner_user_id) THEN 'none'$m$, $m$ THEN 'none'$m$, false),
 ('M40 peek: the legal owner is not named', 'peek_tenant_invite(text)',
   $m$IF is_valid AND _tok.default_role = 'owner'::public.tenant_role AND _tok.business_owner_id IS NOT NULL THEN$m$, $m$IF false THEN$m$, false),
 ('M41 a seated legal owner may become an individual', '_business_owner_seated_kind_guard()',
   $m$IF NEW.owner_kind = 'individual' AND OLD.owner_kind <> 'individual' AND EXISTS ($m$, $m$IF false AND EXISTS ($m$, false),
 ('M42 Solo account includes agencies', '_solo_shell_tenant(uuid)',
   $m$
       AND t.account_type IN ('standalone', 'sub_account')$m$, $m$$m$, false),
 ('M43 Solo account includes company workspaces', '_solo_shell_tenant(uuid)',
   $m$ AND NOT public.is_company_workspace(_tenant);$m$, $m$;$m$, false),
 ('M44 accept: the legal owner record is stamped with the invitee (S1 reinstated)', 'accept_solo_team_invite(text)',
   $m$SET representative_user_id = _actor, owner_seat_vacant_since = NULL, updated_at = now()$m$, $m$SET representative_user_id = _actor, owner_seat_vacant_since = NULL, updated_by = _actor, updated_at = now()$m$, false),
 ('M45 resend: the legal owner dropped (V06)', 'resend_solo_team_invite(uuid,uuid,uuid)',
   $m$_old.team_hub_access, _old.business_owner_id);$m$, $m$_old.team_hub_access, NULL);$m$, false),
 ('M46 tenants guard: the carve-out stops requiring the caller themselves (V08)', 'guard_tenant_owner_only_columns()',
   $m$     AND NEW.owner_user_id = auth.uid()
     AND NEW.platform_fee_bps$m$, $m$     AND NEW.platform_fee_bps$m$, false),
 ('M47 seat guard: the INSERT branch removed (V12)', 'guard_tenant_member_owner_flag()',
   $m$(TG_OP = 'INSERT' AND NEW.business_owner_id IS NOT NULL)$m$, $m$(false)$m$, false),
 ('M48 token guard: an owner invitation''s address can be pre-empted', 'guard_tenant_invite_token_identity()',
   $m$IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND NEW.kind NOT IN ('consumer', 'agency_team')
     AND NULLIF(btrim(NEW.email), '') IS NOT NULL$m$, $m$IF false$m$, false),
 ('M49 token guard: the address rule skips postgres-owned code', 'guard_tenant_invite_token_identity()',
   $m$IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND NEW.kind NOT IN ('consumer', 'agency_team')
     AND NULLIF(btrim(NEW.email), '') IS NOT NULL$m$, $m$IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND current_user <> 'postgres' AND NEW.kind NOT IN ('consumer', 'agency_team')
     AND NULLIF(btrim(NEW.email), '') IS NOT NULL$m$, false),
 ('M50 create_tenant_invite_token: the agency sentence becomes the business one', 'create_tenant_invite_token(uuid,text,tenant_role,integer,integer,uuid,text)',
   $m$    ELSIF (SELECT account_type FROM public.tenants WHERE id = _tenant_id) IN ('agency', 'enterprise') THEN$m$, $m$    ELSIF false THEN$m$, false),
 ('M52 create_tenant_invite_token: a company workspace reads the business sentence', 'create_tenant_invite_token(uuid,text,tenant_role,integer,integer,uuid,text)',
   $m$    IF public.is_company_workspace(_tenant_id) THEN$m$, $m$    IF false THEN$m$, false),
 ('M51 peek: a dead invitation names the legal owner', 'peek_tenant_invite(text)',
   $m$IF is_valid AND _tok.default_role$m$, $m$IF _tok.default_role$m$, false),
 ('M53 token guard: the address rule back to team invitations only (S-A)', 'guard_tenant_invite_token_identity()',
   $m$AND auth.uid() IS NOT NULL AND NEW.kind NOT IN ('consumer', 'agency_team')
     AND NULLIF(btrim(NEW.email), '') IS NOT NULL$m$, $m$AND auth.uid() IS NOT NULL AND NEW.kind = 'team'
     AND NULLIF(btrim(NEW.email), '') IS NOT NULL$m$, false),
 ('M54 token guard: the address rule names two kinds instead of excluding the two non-seat kinds (S-A)', 'guard_tenant_invite_token_identity()',
   $m$AND auth.uid() IS NOT NULL AND NEW.kind NOT IN ('consumer', 'agency_team')
     AND NULLIF(btrim(NEW.email), '') IS NOT NULL$m$, $m$AND auth.uid() IS NOT NULL AND NEW.kind IN ('team', 'subaccount_owner')
     AND NULLIF(btrim(NEW.email), '') IS NOT NULL$m$, false),
 ('M55 token guard: an un-normalised address accepted (S-C)', 'guard_tenant_invite_token_identity()',
   $m$     AND NEW.email IS DISTINCT FROM lower(btrim(NEW.email)) THEN$m$, $m$     AND false THEN$m$, false),
 ('M56 token guard: the address rule is case-sensitive (V15)', 'guard_tenant_invite_token_identity()',
   $m$AND lower(btrim(tk.email)) = lower(btrim(NEW.email))$m$, $m$AND btrim(tk.email) = btrim(NEW.email)$m$, false),
 ('M57 token guard: the address rule does not trim (V15)', 'guard_tenant_invite_token_identity()',
   $m$AND lower(btrim(tk.email)) = lower(btrim(NEW.email))$m$, $m$AND lower(tk.email) = lower(NEW.email)$m$, false),
 ('M58 token guard: an expired owner invitation counts as live (V16)', 'guard_tenant_invite_token_identity()',
   $m$AND tk.uses = 0 AND tk.revoked_at IS NULL AND tk.expires_at > now()) THEN$m$, $m$AND tk.uses = 0 AND tk.revoked_at IS NULL) THEN$m$, false),
 ('M59 create: an expired owner invitation counts as live for a non-holder (V16)', 'create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)',
   $m$AND lower(email) = lower(trim(_email)) AND uses = 0 AND revoked_at IS NULL AND expires_at > now()
  ) THEN$m$, $m$AND lower(email) = lower(trim(_email)) AND uses = 0 AND revoked_at IS NULL
  ) THEN$m$, false),
 ('M60 holder state: the archived state is not checked (V21)', '_tenant_account_holder_state(uuid)',
   $m$           WHEN t.archived_at IS NOT NULL THEN 'archived'
$m$, $m$$m$, false),
 ('M61 create_tenant_invite_token: Owner allowed on a sub-account owner invitation (V24)', 'create_tenant_invite_token(uuid,text,tenant_role,integer,integer,uuid,text)',
   $m$  IF _default_role = 'owner'::public.tenant_role THEN$m$, $m$  IF _default_role = 'owner'::public.tenant_role AND _kind <> 'subaccount_owner' THEN$m$, false),
 ('M62 create_tenant_invite_token: Owner allowed on an agency invitation (V24)', 'create_tenant_invite_token(uuid,text,tenant_role,integer,integer,uuid,text)',
   $m$  IF _default_role = 'owner'::public.tenant_role THEN$m$, $m$  IF _default_role = 'owner'::public.tenant_role AND _kind <> 'agency_team' THEN$m$, false),
 ('M63 resend: an invitation whose legal owner was deleted is reissued (S-B)', 'resend_solo_team_invite(uuid,uuid,uuid)',
   $m$IF _old.business_owner_removed_at IS NOT NULL THEN$m$, $m$IF false THEN$m$, false),
 ('M64 deleting a legal owner marks only its unrevoked invitations (S-B)', '_business_owner_revoke_invitations()',
   $m$   WHERE tenant_id = OLD.tenant_id AND business_owner_id = OLD.id;$m$, $m$   WHERE tenant_id = OLD.tenant_id AND business_owner_id = OLD.id AND revoked_at IS NULL;$m$, false),
 ('M65 deleting a legal owner does not mark its invitations (S-B)', '_business_owner_revoke_invitations()',
   $m$business_owner_removed_at = now(), $m$, $m$$m$, false),
 ('M66 accept: the tenant row is not locked (S-D)', 'accept_solo_team_invite(text)',
   $m$WHERE id = _invite.tenant_id FOR SHARE;$m$, $m$WHERE id = _invite.tenant_id;$m$, false),
 ('M67 accept: the sender''s seat is not locked (S-D)', 'accept_solo_team_invite(text)',
   $m$    PERFORM 1 FROM public.tenant_members WHERE tenant_id = _invite.tenant_id AND user_id = _invite.created_by FOR SHARE;
$m$, $m$$m$, false),
 ('M68 accept: an owner seat takes the stored team-conversations choice (V5)', 'accept_solo_team_invite(text)',
   $m$_invite.responsibilities, _invite.team_hub_access OR _invite.default_role = 'owner'::public.tenant_role,$m$, $m$_invite.responsibilities, _invite.team_hub_access,$m$, false),
 ('C1 control: owner test written the other way round', 'create_solo_team_invite(uuid,uuid,text,text,text,text,boolean,uuid,jsonb)',
   $m$  IF lower(trim(_permission)) = 'owner' THEN$m$, $m$  IF 'owner' = lower(trim(_permission)) THEN$m$, true),
 ('C2 control: owner-row test written the other way round', 'guard_tenant_invite_token_identity()',
   $m$IF OLD.default_role = 'owner'::public.tenant_role THEN$m$, $m$IF 'owner'::public.tenant_role = OLD.default_role THEN$m$, true),
 ('C3 control: the owner seat''s team conversations, operands swapped', 'accept_solo_team_invite(text)',
   $m$_invite.team_hub_access OR _invite.default_role = 'owner'::public.tenant_role$m$, $m$_invite.default_role = 'owner'::public.tenant_role OR _invite.team_hub_access$m$, true),
 ('C4 control: recovery test made explicit', 'guard_tenant_owner_only_columns()',
   $m$AND public.is_super_admin(auth.uid()) THEN$m$, $m$AND public.is_super_admin(auth.uid()) IS TRUE THEN$m$, true);

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
-- T01 (round 5): the trigger back to BEFORE INSERT only (round 4's shape). Not a function body, so it
-- is swapped here: drop and re-create the trigger inside a rolled-back subtransaction.
DO $$ DECLARE _fail text[]; BEGIN
  BEGIN
    DROP TRIGGER trg_tenant_members_owner_invitation_waiting ON public.tenant_members;
    CREATE TRIGGER trg_tenant_members_owner_invitation_waiting BEFORE INSERT ON public.tenant_members
      FOR EACH ROW EXECUTE FUNCTION public._tenant_member_owner_invitation_waiting();
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO _fail FROM proof.failing();
    RAISE EXCEPTION USING ERRCODE = 'P0098', MESSAGE = 'rollback mutant';
  EXCEPTION WHEN SQLSTATE 'P0098' THEN NULL;
  END;
  INSERT INTO proof.mutants(name, sig, from_text, to_text, control, failing)
  VALUES ('T01 seat rule trigger: BEFORE INSERT only (round 4''s shape)', 'trigger', NULL, NULL, false, _fail);
END $$;
\echo '── PHASE 3, mutants: the cases each one fails ──'
SELECT name AS mutant, cardinality(failing) AS failing_cases, array_to_string(failing, ' | ') AS which FROM proof.mutants ORDER BY n;
DO $$ DECLARE _bad text; BEGIN
  SELECT string_agg(name, ', ') INTO _bad FROM proof.mutants WHERE NOT control AND cardinality(failing) = 0;
  IF _bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: mutants survive: %', _bad; END IF;
  SELECT string_agg(name, ', ') INTO _bad FROM proof.mutants WHERE control AND cardinality(failing) <> 0;
  IF _bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: a neutral control was flagged (the cases are brittle): %', _bad; END IF;
  IF EXISTS (SELECT 1 FROM proof.failing()) THEN RAISE EXCEPTION 'FAIL: a mutant leaked out of its subtransaction'; END IF;
END $$;
SELECT format('PASS counts: %s cases; production %s pass / %s fail (%s holes + %s new, expected); migrated %s pass / 0 fail; %s of %s mutants killed; %s of %s controls survive',
  (SELECT count(*) FROM proof.checks), (SELECT count(*) FROM proof.checks) - (SELECT count(*) FROM proof.phase1),
  (SELECT count(*) FROM proof.phase1), (SELECT count(*) FROM proof.checks WHERE kind='hole'),
  (SELECT count(*) FROM proof.checks WHERE kind='new'), (SELECT count(*) FROM proof.checks),
  (SELECT count(*) FROM proof.mutants WHERE NOT control AND cardinality(failing) > 0),
  (SELECT count(*) FROM proof.mutants WHERE NOT control),
  (SELECT count(*) FROM proof.mutants WHERE control AND cardinality(failing) = 0),
  (SELECT count(*) FROM proof.mutants WHERE control)) AS summary \gset
\echo :summary

\c postgres
DROP DATABASE exp08_owner_invitations_proof;
