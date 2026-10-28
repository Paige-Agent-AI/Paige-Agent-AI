-- EXP08 Team Hub agents, A2b: Prepare in an agent DM, then Approve / Not now / the outcome.
-- Migration: supabase/migrations/20271121140008_exp08_team_hub_a2b_cards.sql.
-- Contract: docs/delivery/exp08-team-hub-agents-contract.md, section 5 A2 ("A2b").
-- Disposable PostgreSQL only. Never target the linked project. The proof runs in a database it creates
-- and drops.
--
-- WHAT IS REAL AND WHAT IS A DOUBLE. The setup and the incumbent chain (everything before "The A1c
-- migration") are copied verbatim from supabase/tests/exp08_team_hub_a1c.sql lines 16-720, which documents
-- what in them is real (production bodies, md5-checked) and what is a double. Then, REAL: the A1c
-- migration (20271120020008); the proposal store as its own migrations define it (20261023000000,
-- 20261026000000, 20261201000400, plus production's two later columns/indexes); the roster migration
-- (20271117010108) over the six platform rows. A DOUBLE: the paige_subagents table itself (production's
-- columns, abridged seed text), and every proposal row, written as a governed door writes it (the service
-- role; server_issued_at from the edge's clock). No governed door, model or edge function runs here: the
-- door's own claim and execution are the edge's (card-act.ts), proven in its Deno tests. Synthetic people
-- and ids only.
-- ── Setup, copied verbatim from supabase/tests/exp08_team_hub_a1c.sql (lines 16-720) ──
\set ON_ERROR_STOP on
\set QUIET on
DROP DATABASE IF EXISTS exp08_team_hub_a2b_proof;
CREATE DATABASE exp08_team_hub_a2b_proof;
\c exp08_team_hub_a2b_proof
SET client_min_messages=warning;
\o /dev/null

BEGIN;
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
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);

CREATE TYPE public.tenant_role AS ENUM ('owner','admin','coach','member');
-- The production labels (pg_enum, 2026-10-26): revoke_tenant_member_role names several of them.
CREATE TYPE public.app_role AS ENUM ('admin','moderator','user','affiliate','coach','broker','broker_team_member',
 'super_admin','sales_rep','cs_rep','finance','viewer','client','developer','platform_admin');
CREATE TYPE public.task_status AS ENUM ('pending','in_progress','completed','cancelled');
CREATE TABLE public.tenants(id uuid PRIMARY KEY, name text NOT NULL,
 account_type text NOT NULL DEFAULT 'standalone', parent_tenant_id uuid REFERENCES public.tenants(id),
 archived_at timestamptz);
-- The production columns (information_schema, 2026-10-26), before this change.
CREATE TABLE public.tenant_members(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, role public.tenant_role NOT NULL DEFAULT 'member',
 status text NOT NULL DEFAULT 'active', invited_at timestamptz, joined_at timestamptz DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 is_owner boolean NOT NULL DEFAULT false, job_title text, responsibilities text,
 UNIQUE (tenant_id, user_id));
CREATE TABLE public.profiles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE,
 full_name text, active_tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL);
CREATE TABLE public.user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 role public.app_role NOT NULL, UNIQUE (user_id, role));
CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, action text NOT NULL,
 entity text NOT NULL, entity_id uuid, data jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.coach_clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, coach_user_id uuid,
 status text NOT NULL DEFAULT 'active', updated_at timestamptz);
CREATE TABLE public.tenant_legal_profile(tenant_id uuid PRIMARY KEY, authorized_representative_user_id uuid);
CREATE TABLE public.tenant_invite_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
 token text NOT NULL UNIQUE, kind text NOT NULL, email text, default_role public.tenant_role NOT NULL DEFAULT 'member',
 job_title text, responsibilities text, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days', revoked_at timestamptz,
 uses int NOT NULL DEFAULT 0, max_uses int, last_used_at timestamptz, updated_at timestamptz,
 created_by uuid, contact_id uuid, agency_role text);
CREATE TABLE public.paige_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid, actor_role text,
 action text, target_type text, target_id uuid, payload jsonb, tenant_id uuid, created_at timestamptz DEFAULT now());
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;
-- The two tables whose policies section M corrects, with the production policies as they stand
-- before this change (pg_policies, 2026-10-26). Only the columns the policies read.
CREATE TABLE public.paige_invoices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, label text);
CREATE TABLE public.tenant_agreement_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, label text);
ALTER TABLE public.paige_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_agreement_versions ENABLE ROW LEVEL SECURITY;
-- What the departure review reads, with the production status vocabularies.
CREATE TABLE public.tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL,
 status public.task_status NOT NULL DEFAULT 'pending', due_date timestamptz, created_at timestamptz DEFAULT now(),
 updated_at timestamptz DEFAULT now(), deal_id uuid, tenant_id uuid);
CREATE TABLE public.deals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, owner_user_id uuid,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')), expected_close_date date,
 created_at timestamptz NOT NULL DEFAULT now(), tenant_id uuid, contact_client_id uuid, value_cents bigint, currency text,
 version bigint NOT NULL DEFAULT 1);
CREATE TABLE public.clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), first_name text, last_name text, email text,
 entity_name text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','inactive','archived')),
 assigned_coach_user_id uuid, lead_owner_user_id uuid, tenant_id uuid, merged_into_contact_id uuid,
 updated_at timestamptz DEFAULT now());
CREATE TABLE public.paige_pending_approvals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL DEFAULT 'pending'
 CHECK (status IN ('pending','approved','rejected','sent','changes_requested','escalated','skipped')),
 assigned_to_user_id uuid, tenant_id uuid, type text NOT NULL DEFAULT 'other', category text, summary text,
 priority smallint, sla_due_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.channel_connectors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','disabled')), active boolean NOT NULL DEFAULT true,
 mailbox_owner_user_id uuid, channel_type text NOT NULL DEFAULT 'email', provider text, mailbox_class text,
 display_name text, from_address text, created_at timestamptz DEFAULT now());

-- DOUBLES.
CREATE TABLE public.fixture_agency_managers(tenant_id uuid, user_id uuid);
CREATE TABLE public.fixture_platform_admins(user_id uuid);
CREATE TABLE public.fixture_global_roles(user_id uuid, role text);
-- What production's user_roles triggers read (columns they use; production rows 2026-10-26 for the
-- operator-role list, a synthetic platform-owner email for app_settings_owner).
CREATE TABLE public.platform_operator_roles(role text PRIMARY KEY);
INSERT INTO public.platform_operator_roles VALUES ('platform_admin'),('super_admin');
CREATE TABLE public.app_settings_owner(owner_email text);
INSERT INTO public.app_settings_owner VALUES ('person36@example.test');
CREATE FUNCTION public.agency_can_manage_child(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM public.fixture_agency_managers WHERE tenant_id=$1 AND user_id=$2) $$;
CREATE FUNCTION public.agency_team_role(uuid, uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM public.fixture_platform_admins WHERE user_id=$1) $$;
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT EXISTS(SELECT 1 FROM public.fixture_platform_admins WHERE user_id=auth.uid()) $$;
CREATE FUNCTION public.is_company_workspace(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
-- Admin scope stage 0's bodies (grant_tenant_member_role, change_user_role) call it: super_admin OR
-- platform_admin, which in this proof is the one platform-admin fixture.
CREATE FUNCTION public.is_platform_operator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT public.is_platform_owner() OR public.is_platform_admin(auth.uid()) $$;
CREATE FUNCTION public.is_direct_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_tenant_member(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=auth.uid() AND status='active') $$;
CREATE FUNCTION public.is_tenant_admin(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=auth.uid()
  AND status='active' AND role IN ('owner','admin')) $$;
CREATE FUNCTION public.has_any_role(_user uuid, _roles text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$
 SELECT EXISTS(SELECT 1 FROM public.fixture_global_roles WHERE user_id=_user AND role=ANY(_roles)) $$;

-- REAL, verbatim from production.
CREATE OR REPLACE FUNCTION public.current_user_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT p.active_tenant_id FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.active_tenant_id IS NOT NULL
         AND (
           EXISTS (SELECT 1 FROM public.tenant_members m
                     WHERE m.user_id = auth.uid() AND m.tenant_id = p.active_tenant_id AND m.status = 'active')
           OR public.agency_can_manage_child(p.active_tenant_id, auth.uid())
           OR public.agency_team_role(p.active_tenant_id, auth.uid()) IS NOT NULL
           OR public.is_platform_admin(auth.uid())
         )),
    (SELECT tenant_id FROM public.tenant_members
       WHERE user_id = auth.uid() AND status = 'active'
       ORDER BY joined_at ASC LIMIT 1)
  );
$function$;
REVOKE ALL ON FUNCTION public.current_user_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_id() TO authenticated, service_role;

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
  OR (_tenant_id IS NOT NULL AND _user_id IS NOT NULL
      AND (COALESCE(_user_id = auth.uid(), false) OR COALESCE(auth.role(), '') <> ALL (ARRAY['anon', 'authenticated']))
      AND public.is_company_workspace(_tenant_id) AND public.is_platform_admin(_user_id));
$function$;

CREATE OR REPLACE FUNCTION public.map_tenant_role_to_app_role(_tenant_role tenant_role)
 RETURNS app_role
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
    SELECT CASE _tenant_role
      WHEN 'owner'  THEN 'admin'::app_role
      WHEN 'admin'  THEN 'admin'::app_role
      WHEN 'member' THEN 'user'::app_role
    END
  $function$;

CREATE OR REPLACE FUNCTION public.tenant_assignee_qualifies(_tenant_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _tenant_id IS NOT NULL AND _user_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.tenant_members m
             WHERE m.tenant_id = _tenant_id AND m.user_id = _user_id AND m.status = 'active')
    OR public.agency_can_manage_child(_tenant_id, _user_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.refresh_assigned_relationships(_tenant_ids uuid[], _user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.coach_clients cc SET status = 'suspended', updated_at = now()
   WHERE cc.status = 'active'
     AND cc.tenant_id = ANY (_tenant_ids)
     AND (_user_id IS NULL OR cc.coach_user_id = _user_id)
     AND NOT public.tenant_assignee_qualifies(cc.tenant_id, cc.coach_user_id);
  UPDATE public.coach_clients cc SET status = 'active', updated_at = now()
   WHERE cc.status = 'suspended'
     AND cc.tenant_id = ANY (_tenant_ids)
     AND (_user_id IS NULL OR cc.coach_user_id = _user_id)
     AND public.tenant_assignee_qualifies(cc.tenant_id, cc.coach_user_id);
END;
$function$;

-- The nine tenant_members trigger functions, as production has them before this change.
CREATE OR REPLACE FUNCTION public.guard_archived_tenant_membership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status='active' AND EXISTS(SELECT 1 FROM public.tenants WHERE id=NEW.tenant_id AND archived_at IS NOT NULL) THEN RAISE EXCEPTION 'restore before granting access' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_company_workspace_membership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.refresh_assigned_relationships_on_membership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _tenant uuid; _user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN _tenant := OLD.tenant_id; _user := OLD.user_id;
  ELSE _tenant := NEW.tenant_id; _user := NEW.user_id; END IF;
  PERFORM public.refresh_assigned_relationships(
    ARRAY(SELECT _tenant UNION SELECT t.id FROM public.tenants t WHERE t.parent_tenant_id = _tenant),
    _user);
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resync_a2p_representative_on_membership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
  v_user uuid := coalesce(new.user_id, old.user_id);
begin
  update public.tenant_legal_profile
     set authorized_representative_user_id = authorized_representative_user_id
   where tenant_id = v_tenant
     and authorized_representative_user_id = v_user;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_tenant_member_to_user_roles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_role app_role;
  _old_role app_role;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.status = 'active' THEN
    _new_role := public.map_tenant_role_to_app_role(NEW.role);
    IF _new_role IN ('super_admin'::app_role, 'platform_admin'::app_role, 'developer'::app_role) THEN
      _new_role := NULL;
    END IF;
    IF _new_role IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.user_id) THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.user_id, _new_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    _old_role := public.map_tenant_role_to_app_role(OLD.role);
    IF _old_role IS NOT NULL
       AND (OLD.role <> NEW.role OR NEW.status <> 'active')
       AND _old_role <> COALESCE(public.map_tenant_role_to_app_role(NEW.role), 'user'::app_role)
    THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = OLD.user_id AND tm.status = 'active'
          AND tm.id <> OLD.id
          AND public.map_tenant_role_to_app_role(tm.role) = _old_role
      ) THEN
        DELETE FROM public.user_roles WHERE user_id = OLD.user_id AND role = _old_role;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    _old_role := public.map_tenant_role_to_app_role(OLD.role);
    IF _old_role IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = OLD.user_id AND tm.status = 'active'
          AND public.map_tenant_role_to_app_role(tm.role) = _old_role
      ) THEN
        DELETE FROM public.user_roles WHERE user_id = OLD.user_id AND role = _old_role;
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_tenant_member_consent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'active' AND NEW.user_id <> _caller THEN
    IF TG_OP = 'UPDATE'
       AND OLD.status = 'active'
       AND OLD.user_id = NEW.user_id THEN
      NULL;
    ELSE
      NEW.status := 'pending';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_tenant_member_owner_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
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

CREATE OR REPLACE FUNCTION public.tenant_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END $function$;

-- The production trigger definitions (pg_trigger, 2026-10-26). team_hub_seat_ended is the Team Hub
-- migration's own, created when it is applied below.
CREATE TRIGGER a01_archived_tenant_membership BEFORE INSERT OR UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION guard_archived_tenant_membership();
CREATE TRIGGER trg_guard_company_workspace_membership BEFORE INSERT OR DELETE OR UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION guard_company_workspace_membership();
CREATE TRIGGER trg_refresh_assigned_relationships AFTER INSERT OR DELETE OR UPDATE OF status, role ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION refresh_assigned_relationships_on_membership();
CREATE TRIGGER trg_resync_a2p_representative_on_membership AFTER INSERT OR DELETE OR UPDATE OF status, role, is_owner ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION resync_a2p_representative_on_membership();
CREATE TRIGGER trg_sync_tenant_member_to_user_roles AFTER INSERT OR DELETE OR UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION sync_tenant_member_to_user_roles();
CREATE TRIGGER trg_tenant_members_consent BEFORE INSERT OR UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION enforce_tenant_member_consent();
CREATE TRIGGER trg_tenant_members_owner_guard BEFORE INSERT OR UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION guard_tenant_member_owner_flag();
CREATE TRIGGER trg_tenant_members_updated_at BEFORE UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION tenant_set_updated_at();

-- Verbatim from production: the accept path a new teammate arrives through.
CREATE OR REPLACE FUNCTION public.accept_solo_team_invite(_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _actor_email text;
  _actor_email_confirmed_at timestamptz;
  _invite public.tenant_invite_tokens;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  SELECT email, email_confirmed_at INTO _actor_email, _actor_email_confirmed_at FROM auth.users WHERE id = _actor;
  SELECT * INTO _invite FROM public.tenant_invite_tokens
  WHERE token = _token AND kind = 'team' FOR UPDATE;
  IF _invite.id IS NULL THEN RAISE EXCEPTION 'team invitation not found'; END IF;
  IF _invite.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'team invitation has been revoked'; END IF;
  IF _invite.expires_at <= now() THEN RAISE EXCEPTION 'team invitation has expired'; END IF;
  IF _invite.uses > 0 OR (_invite.max_uses IS NOT NULL AND _invite.uses >= _invite.max_uses) THEN
    RAISE EXCEPTION 'team invitation has already been accepted';
  END IF;
  -- Identity comes from the authenticated subject's stored account, never browser email or metadata.
  IF _actor_email_confirmed_at IS NULL
     OR NULLIF(btrim(_actor_email), '') IS NULL
     OR NULLIF(btrim(_invite.email), '') IS NULL
     OR lower(btrim(_invite.email)) <> lower(btrim(_actor_email)) THEN
    RAISE EXCEPTION 'team invitation belongs to a different email address' USING ERRCODE = '42501';
  END IF;
  IF _invite.default_role NOT IN ('admin'::public.tenant_role, 'member'::public.tenant_role) THEN
    RAISE EXCEPTION 'team invitation has an unsupported permission';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = _invite.tenant_id AND tm.user_id = _actor
  ) THEN
    RAISE EXCEPTION 'this account already belongs to the workspace';
  END IF;

  INSERT INTO public.tenant_members
    (tenant_id, user_id, role, status, is_owner, invited_at, joined_at, job_title, responsibilities)
  VALUES
    (_invite.tenant_id, _actor, _invite.default_role, 'active', false, _invite.created_at, now(),
     _invite.job_title, _invite.responsibilities);

  UPDATE public.tenant_invite_tokens
  SET uses = uses + 1, last_used_at = now(), updated_at = now()
  WHERE id = _invite.id AND uses = 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'team invitation was already accepted'; END IF;

  UPDATE public.profiles SET active_tenant_id = _invite.tenant_id WHERE user_id = _actor;
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'tenant_invite', 'team_invite_accepted', _invite.id,
          jsonb_build_object('tenant_id', _invite.tenant_id, 'permission', _invite.default_role::text));
  RETURN _invite.tenant_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_solo_team_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_solo_team_invite(text) TO authenticated;

-- The Operations core, abridged exactly as in the Team Hub increment 2 and 3 proofs.
CREATE TABLE public.plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE);
CREATE TABLE public.plan_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 plan_id uuid REFERENCES public.plans(id) ON DELETE CASCADE,
 parent_item_id uuid REFERENCES public.plan_items(id) ON DELETE SET NULL,
 item_type text NOT NULL CHECK (item_type IN ('milestone','task','reminder')),
 created_by uuid, assigned_to_user_id uuid, title text NOT NULL, summary text,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled','blocked')),
 priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
 due_at timestamptz, contact_id uuid, campaign_ref jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.plan_assign_task(
  p_title text, p_assigned_to_user_id uuid, p_plan_id uuid DEFAULT NULL, p_milestone_id uuid DEFAULT NULL,
  p_due_at timestamptz DEFAULT NULL, p_priority text DEFAULT 'normal', p_summary text DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL, p_campaign_ref jsonb DEFAULT NULL, p_file_to_bus boolean DEFAULT true, p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _caller uuid := auth.uid(); _tenant uuid; _staff boolean := false; _id uuid;
BEGIN
  _tenant := public.current_user_tenant_id();
  IF p_tenant_id IS NOT NULL AND p_tenant_id <> _tenant THEN RAISE EXCEPTION 'PLAN_FORBIDDEN: tenant mismatch' USING ERRCODE='42501'; END IF;
  IF NOT public.is_tenant_member(_tenant) THEN RAISE EXCEPTION 'PLAN_FORBIDDEN: not a member' USING ERRCODE='42501'; END IF;
  _staff := public.has_any_role(_caller, ARRAY['admin','super_admin','coach']);
  IF p_assigned_to_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE user_id=p_assigned_to_user_id AND tenant_id=_tenant AND status='active') THEN
    RAISE EXCEPTION 'PLAN_ASSIGNEE_NOT_IN_TENANT' USING ERRCODE='42501'; END IF;
  IF NOT _staff AND p_assigned_to_user_id IS DISTINCT FROM _caller THEN
    RAISE EXCEPTION 'PLAN_FORBIDDEN: assigning to a teammate needs admin or coach' USING ERRCODE='42501'; END IF;
  INSERT INTO public.plan_items(tenant_id, plan_id, parent_item_id, item_type, title, summary, due_at, assigned_to_user_id, priority, contact_id, campaign_ref, created_by)
  VALUES (_tenant, p_plan_id, p_milestone_id, 'task', btrim(p_title), p_summary, p_due_at, p_assigned_to_user_id, COALESCE(p_priority,'normal'), p_contact_id, p_campaign_ref, _caller)
  RETURNING id INTO _id;
  RETURN jsonb_build_object('ok',true,'item_id',_id,'item_type','task','assignee',p_assigned_to_user_id,'action_id',NULL);
END $$;
REVOKE ALL ON FUNCTION public.plan_assign_task(text,uuid,uuid,uuid,timestamptz,text,text,uuid,jsonb,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_assign_task(text,uuid,uuid,uuid,timestamptz,text,text,uuid,jsonb,boolean,uuid) TO authenticated, service_role;

-- STUB of Supabase Storage, as in the increment 3 proof (the files migration needs it to apply).
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(
 id text NOT NULL PRIMARY KEY, name text NOT NULL, owner uuid,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
 public boolean DEFAULT false, avif_autodetection boolean DEFAULT false,
 file_size_limit bigint, allowed_mime_types text[], owner_id text);
CREATE TABLE storage.objects(
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, bucket_id text REFERENCES storage.buckets(id),
 name text, owner uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
 last_accessed_at timestamptz DEFAULT now(), metadata jsonb,
 path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
 version text, owner_id text, user_metadata jsonb);
CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[1:array_length(_parts,1)-1];
END
$function$;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.buckets, storage.objects TO anon, authenticated, service_role;
INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES ('comms-attachments','comms-attachments',false,10485760);

CREATE OR REPLACE FUNCTION public.operator_retirement_disposition(_table text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN _table=ANY(ARRAY['growth_public_visits',
 'tenants','tenant_members','calendars','programs','program_approvals'
 ]) THEN 'delete' WHEN _table=ANY(ARRAY['profiles','paige_audit_log','platform_subscriptions','platform_usage_events','paige_llm_trace','paige_voice_cost_reservations']) THEN 'preserve' ELSE 'blocked' END
$$;
REVOKE ALL ON FUNCTION public.operator_retirement_disposition(text) FROM PUBLIC,anon,authenticated,service_role;

-- People. A: u1 owner, u10 co-owner, u3 u4 admins, u2 u5 u6 u8 members, u9 admin, u26 a legacy coach.
-- B: u7 owner, u8 member, u9 admin (so u9's global admin survives a suspension in A). C is an agency's
-- sub-account (not SOLO), D the agency.
INSERT INTO public.tenants(id,name,account_type,parent_tenant_id) VALUES
 ('20000000-0000-4000-8000-00000000000a','Workspace A','standalone',NULL),
 ('20000000-0000-4000-8000-00000000000b','Workspace B','standalone',NULL),
 ('20000000-0000-4000-8000-00000000000d','Agency D','agency',NULL),
 ('20000000-0000-4000-8000-00000000000c','Sub-account C','standalone','20000000-0000-4000-8000-00000000000d');
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT ('10000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid, 'person'||n||'@example.test', now()
 FROM generate_series(1,34) n;
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000001','owner','active',true,'2026-01-01'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000010','owner','active',true,'2026-01-01'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000002','member','active',false,'2026-01-02'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000003','admin','active',false,'2026-01-03'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000004','admin','active',false,'2026-01-04'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000005','member','active',false,'2026-01-05'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000006','member','active',false,'2026-01-06'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000008','member','active',false,'2026-01-08'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000009','admin','active',false,'2026-01-09'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000026','coach','active',false,'2026-01-10'),
 ('20000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-000000000007','owner','active',true,'2026-01-07'),
 ('20000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-000000000008','member','active',false,'2026-01-01'),
 ('20000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-000000000009','admin','active',false,'2026-01-02'),
 ('20000000-0000-4000-8000-00000000000c','10000000-0000-4000-8000-000000000011','owner','active',true,'2026-01-01'),
 ('20000000-0000-4000-8000-00000000000d','10000000-0000-4000-8000-000000000012','owner','active',true,'2026-01-01');
INSERT INTO public.profiles(user_id,full_name,active_tenant_id)
 SELECT ('10000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid, 'Person '||n,
  CASE n WHEN 7 THEN '20000000-0000-4000-8000-00000000000b'::uuid WHEN 11 THEN '20000000-0000-4000-8000-00000000000c'::uuid
   WHEN 12 THEN '20000000-0000-4000-8000-00000000000d'::uuid ELSE '20000000-0000-4000-8000-00000000000a'::uuid END
 FROM generate_series(1,34) n;
INSERT INTO public.fixture_global_roles VALUES ('10000000-0000-4000-8000-000000000001','admin');

-- The production policies before this change, verbatim from pg_policies.
CREATE POLICY tenant_members_insert_invoices ON public.paige_invoices FOR INSERT TO authenticated
 WITH CHECK (tenant_id IN ( SELECT tm.tenant_id FROM tenant_members tm WHERE (tm.user_id = auth.uid())));
CREATE POLICY tenant_members_select_invoices ON public.paige_invoices FOR SELECT TO authenticated
 USING (tenant_id IN ( SELECT tm.tenant_id FROM tenant_members tm WHERE (tm.user_id = auth.uid())));
CREATE POLICY tenant_members_update_invoices ON public.paige_invoices FOR UPDATE TO authenticated
 USING (tenant_id IN ( SELECT tm.tenant_id FROM tenant_members tm WHERE (tm.user_id = auth.uid())));
CREATE POLICY "Tenant members read own agreement versions" ON public.tenant_agreement_versions FOR SELECT TO authenticated
 USING ((EXISTS ( SELECT 1 FROM tenant_members tm WHERE ((tm.tenant_id = tenant_agreement_versions.tenant_id) AND (tm.user_id = auth.uid())))) OR is_platform_owner());
CREATE POLICY "Tenant owners/admins write own agreement versions" ON public.tenant_agreement_versions FOR ALL TO authenticated
 USING ((EXISTS ( SELECT 1 FROM tenant_members tm WHERE ((tm.tenant_id = tenant_agreement_versions.tenant_id) AND (tm.user_id = auth.uid()) AND (tm.role = ANY (ARRAY['owner'::tenant_role, 'admin'::tenant_role]))))) OR is_platform_owner())
 WITH CHECK ((EXISTS ( SELECT 1 FROM tenant_members tm WHERE ((tm.tenant_id = tenant_agreement_versions.tenant_id) AND (tm.user_id = auth.uid()) AND (tm.role = ANY (ARRAY['owner'::tenant_role, 'admin'::tenant_role]))))) OR is_platform_owner());
-- Production grants these tables need for the policies to be the only thing deciding: the browser
-- role reads tenant_members under RLS, and the service role writes it directly (accept-invite).
GRANT SELECT ON public.tenant_members TO authenticated;
GRANT ALL ON public.tenant_members TO service_role;
GRANT ALL ON public.user_roles TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.paige_invoices, public.tenant_agreement_versions TO authenticated;
GRANT DELETE ON public.tenant_agreement_versions TO authenticated;
COMMIT;

-- REAL, verbatim from production (2026-10-26): the role functions that write status = 'active' onto an
-- existing seat, the self-seating paths, and the Settings → Team invitation functions this change
-- re-emits. md5(prosrc) of each is asserted against production below, before anything changes.
-- EXCEPT the two role functions admin scope stage 0 (20271115030008) redefines, and its new helper
-- is_workspace_admin: stage 0 sorts before this migration and reaches production first, so those are
-- stage 0's bodies, verbatim from that migration and pinned to ITS md5(prosrc). The production bodies
-- they replace were grant_tenant_member_role e9871873b2324b963b25753e6685d371 and change_user_role
-- 0ff56ed2913edc7a4fd6adc59d88b52f (the same values admin_scope_stage0.sql pins as its baseline).
\ir exp08_team_lifecycle_production_functions.sql
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('grant_tenant_member_role(uuid,app_role,uuid,text)','556cdbece2e14619961e91352a24897b'),
   ('change_user_role(uuid,app_role,app_role,uuid,text)','f4555d175fdb61fd1d8d179656aef69c'),
   ('is_workspace_admin(uuid)','01bd64a6c58068d996e8d5df15888565')) v(sig, s0_md5)
 LOOP
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=('public.'||r.sig)::regprocedure) IS DISTINCT FROM r.s0_md5 THEN
   RAISE EXCEPTION 'FAIL: % is not admin scope stage 0''s body (md5(prosrc) differs from %)', r.sig, r.s0_md5; END IF;
 END LOOP;
END $$;
\echo 'PASS: grant_tenant_member_role, change_user_role and is_workspace_admin are admin scope stage 0''s bodies (md5(prosrc) matches, 3 of 3)'
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('revoke_tenant_member_role(uuid,app_role,uuid,text)','9d4842ca5565d1b8e38ed88a46064d5a'),
   ('agency_enter_subaccount(uuid)','6bf10c159ebd93e1f73302995cad2de2'),
   ('accept_tenant_invite(text)','99b75b7f65d50cc4971c12dca4bef74e'),
   ('accept_solo_team_invite(text)','038edcac803ff779de8b56a9cfeed0d1'),
   ('create_solo_team_invite(uuid,uuid,text,text,text,text)','6fe329d6c9af94ef02d853d0e470693a'),
   ('resend_solo_team_invite(uuid,uuid,uuid)','ca86710ae52871e3c388c17cb203cee1'),
   ('solo_team_invite_authority(uuid,uuid)','6fee3e014b35dcc7f77503828f476e60'),
   ('has_role(uuid,app_role)','dcfc17cfff0b246634d5df8bf8ceb915'),
   ('is_super_admin(uuid)','d014606ddbd8a120e5f3afeda5f937fa'),
   ('map_app_role_to_tenant_role(app_role)','ba55cb38fb4c7e4545ffd9cc5122faf8'),
   ('sync_user_role_to_tenant_member()','264bff7c3e071d75e9c6f1310fec8406'),
   ('enforce_protected_role_grant()','fa8828993a7da90521044e01f4fade48'),
   ('prevent_owner_admin_removal()','daeb1b91408969a62224140148a99414')) v(sig, prod_md5)
 LOOP
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=('public.'||r.sig)::regprocedure) IS DISTINCT FROM r.prod_md5 THEN
   RAISE EXCEPTION 'FAIL: % is not the production body (md5(prosrc) differs from %)', r.sig, r.prod_md5; END IF;
 END LOOP;
END $$;
\echo 'PASS: the remaining role, self-seating, invitation and user_roles trigger functions are the production bodies (md5(prosrc) matches, 13 of 13)'

-- The REAL Operations wrapper, unchanged, so team_hub_request_task can be driven.
\ir ../migrations/20271020000110_operations_scoped_task_creation.sql

-- Supabase's default privileges, so the grant assertions below could fail.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

\set ta '20000000-0000-4000-8000-00000000000a'
\set tb '20000000-0000-4000-8000-00000000000b'
\set tc '20000000-0000-4000-8000-00000000000c'
\set u1 '10000000-0000-4000-8000-000000000001'
\set u2 '10000000-0000-4000-8000-000000000002'
\set u3 '10000000-0000-4000-8000-000000000003'
\set u4 '10000000-0000-4000-8000-000000000004'
\set u5 '10000000-0000-4000-8000-000000000005'
\set u6 '10000000-0000-4000-8000-000000000006'
\set u7 '10000000-0000-4000-8000-000000000007'
\set u8 '10000000-0000-4000-8000-000000000008'
\set u9 '10000000-0000-4000-8000-000000000009'
\set u10 '10000000-0000-4000-8000-000000000010'
\set u11 '10000000-0000-4000-8000-000000000011'
\set u13 '10000000-0000-4000-8000-000000000013'
\set u14 '10000000-0000-4000-8000-000000000014'
\set u15 '10000000-0000-4000-8000-000000000015'
\set u16 '10000000-0000-4000-8000-000000000016'
\set u17 '10000000-0000-4000-8000-000000000017'
\set u18 '10000000-0000-4000-8000-000000000018'
\set u19 '10000000-0000-4000-8000-000000000019'
\set u20 '10000000-0000-4000-8000-000000000020'
\set u21 '10000000-0000-4000-8000-000000000021'
\set u22 '10000000-0000-4000-8000-000000000022'
\set u23 '10000000-0000-4000-8000-000000000023'
\set u24 '10000000-0000-4000-8000-000000000024'
\set u25 '10000000-0000-4000-8000-000000000025'
\set u26 '10000000-0000-4000-8000-000000000026'
\set u27 '10000000-0000-4000-8000-000000000027'
\set u28 '10000000-0000-4000-8000-000000000028'
\set u29 '10000000-0000-4000-8000-000000000029'
\set u30 '10000000-0000-4000-8000-000000000030'
\set u31 '10000000-0000-4000-8000-000000000031'
\set u32 '10000000-0000-4000-8000-000000000032'
\set u33 '10000000-0000-4000-8000-000000000033'
\set nobody '10000000-0000-4000-8000-000000000099'

-- The incumbent chain: every migration that defines a body this change re-emits or calls.
\ir ../migrations/20271113850008_exp08_team_hub_collaboration.sql
\ir ../migrations/20271113860008_exp08_team_hub_team_work.sql
\ir ../migrations/20271114160008_exp08_team_hub_files.sql
\ir ../migrations/20271114240008_exp08_team_hub_search.sql
\ir ../migrations/20271114250008_exp08_team_hub_read_performance.sql
\ir ../migrations/20271114300008_exp08_team_hub_search_text_index.sql
\ir ../migrations/20261048000000_an_owner_can_remove_someone_from_their_workspace.sql
\ir ../migrations/20271115040008_exp08_team_lifecycle.sql
\ir ../migrations/20271117010008_exp08_team_hub_agents.sql
\ir ../migrations/20271119010008_exp08_team_hub_agent_turn_states.sql

-- The A1c migration, which applies before this one (its own proof is exp08_team_hub_a1c.sql).
\ir ../migrations/20271120020008_exp08_team_hub_a1c_writing_and_broadcast.sql

-- The proposal store, REAL: the confirmations migrations as they define it (table, claim indexes, RLS,
-- the browser's read-only grant, issued_in_request, server_issued_at), plus the two later columns and
-- index that production also carries (20271112130000 claimed_in_request, 20271020000401 the tenant index).
\ir ../migrations/20261023000000_confirmations_bind_the_approval_to_the_call.sql
\ir ../migrations/20261026000000_a_token_cannot_be_redeemed_by_the_turn_that_minted_it.sql
\ir ../migrations/20261201000400_canonical_proposal_integrity.sql
ALTER TABLE public.paige_pending_confirmations ADD COLUMN IF NOT EXISTS claimed_in_request uuid;
CREATE INDEX IF NOT EXISTS idx_paige_pending_confirmations_tenant ON public.paige_pending_confirmations (tenant_id);

-- The roster table, as exp08_team_hub_agents_a1.sql section 6 builds it (production's columns), with the
-- six platform rows as production held them before 20271117010108, then that migration (REAL).
CREATE TABLE public.paige_subagents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, name text,
 domain text, description text, runtime text CHECK (runtime IN ('local','langgraph','soft')), enabled boolean DEFAULT true,
 display_order int DEFAULT 100, system_prompt text, config jsonb DEFAULT '{}'::jsonb, daily_invocation_cap int DEFAULT 200,
 monthly_token_cap int DEFAULT 2000000, department text, tenant_id uuid, role text, goal text, backstory text, version int DEFAULT 1,
 rail_display_name text, parent_subagent_slug text, updated_at timestamptz DEFAULT now());
INSERT INTO public.paige_subagents(slug,name,department,domain,rail_display_name,role,description,goal,backstory,version,runtime,system_prompt,config,display_order) VALUES
 ('vera','VERA','owner_ops','intelligence_finance_risk','VERA','VP Intelligence, Finance & Risk','VP Intelligence, Finance & Risk.','g','b',2,'soft',NULL,'{}',1),
 ('nexus','NEXUS','owner_ops','growth','NEXUS','VP Growth','VP Growth. Content strategy and creation, campaigns, sales sequences, pipeline management, lead scoring, brand voice enforcement, competitive positioning. Energetic, market-aware.','Grow the tenant''s book — every campaign, sequence, and pipeline motion compounds.','NEXUS owns the growth engine end to end: what the market hears, which leads move, and why deals close. Approved sequences run autonomously; new drafts wait for the owner.',1,'soft',NULL,'{}',2),
 ('cura','CURA','client_experience','client_success','CURA','VP Client Success','VP Client Success.','g','b',1,'soft',NULL,'{}',3),
 ('mentor','MENTOR','owner_ops','discovery_education_strategy','MENTOR','VP Discovery, Education & Strategy','VP Discovery.','g','b',1,'soft',NULL,'{}',4),
 ('merit','MERIT','owner_ops','finance_people','MERIT','VP Finance & People','VP Finance & People.','g','b',1,'soft',NULL,'{}',5),
 ('zion','ZION','owner_ops','operations_automation','ZION','VP Operations & Automation','VP Operations & Automation.','g','b',3,'soft','zion prompt','{"job_kind":"plan"}',6),
 ('design-studio','Design Studio','owner_ops','design','DESIGN','Designer','Builds pages.','g','b',1,'soft',NULL,'{"capability_scope":{"mode":"allowlist","tools":["ask_choices"]}}',50);
\ir ../migrations/20271117010108_exp08_team_hub_agents_roster.sql
CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;

-- 1. Before the change: the four helpers are production's bodies (the values the migration pins), and
-- the two doors it replaces are this chain's bodies (A1a's post door, A1b's acceptance).
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('_team_hub_refusal(uuid)','b6ee98245fdbb9e0229547061a9391d2'),
   ('_team_hub_visible(uuid,uuid,uuid)','28a7e5c90f2a29b19b4481c4850a414f'),
   ('_team_hub_is_active(uuid,uuid)','c290399dc80d95d16116a0f88b0abd8c'),
   ('_team_hub_participates(uuid,uuid)','4f2fb69d09f7b362027edf195a37da83'),
   ('team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)','f28f30095f96a0c58e1206cbe61340d2'),
   ('team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)','c6930cf3329da4c0db6a8390f1564eaa')) v(sig, md)
 LOOP
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=('public.'||r.sig)::regprocedure) IS DISTINCT FROM r.md THEN
   RAISE EXCEPTION 'FAIL: % is not the body the migration was written against', r.sig; END IF;
 END LOOP;
END $$;
\echo 'PASS: before the change, the four helpers are production''s bodies and the two replaced doors are the chain''s (md5(prosrc), 6 of 6)'
CREATE TEMP TABLE before_src AS SELECT p.oid::regprocedure::text AS sig, p.proname::text AS name, p.prosrc AS src
 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team_hub%';
CREATE TEMP TABLE roster_before AS SELECT * FROM public.paige_subagents;

-- 2. The change, then a second apply: a no-op.
\ir ../migrations/20271121140008_exp08_team_hub_a2b_cards.sql
CREATE TEMP VIEW a2b_state AS
SELECT 'fn:'||p.oid::regprocedure::text AS k, concat_ws('|', p.proacl::text, p.prosecdef::text, p.provolatile::text, p.proconfig::text, md5(p.prosrc)) AS v
 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE '%team_hub%' OR p.proname='operator_retirement_disposition')
UNION ALL
SELECT 'con:'||c.conrelid::regclass::text||':'||c.conname, pg_get_constraintdef(c.oid)||'|'||c.convalidated FROM pg_constraint c
 WHERE c.conrelid IN ('public.team_hub_agent_turns'::regclass, 'public.team_hub_message_cards'::regclass)
UNION ALL
SELECT 'col:'||a.attrelid::regclass::text||':'||a.attname, format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull FROM pg_attribute a
 WHERE a.attrelid IN ('public.team_hub_message_cards'::regclass, 'public.paige_pending_confirmations'::regclass) AND a.attnum>0 AND NOT a.attisdropped
UNION ALL
SELECT 'rel:'||c.relname, concat_ws('|', c.relacl::text, c.relrowsecurity::text) FROM pg_class c
 WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','i') AND (c.relname LIKE 'team_hub%' OR c.relname LIKE '%pending_confirmations%')
UNION ALL
SELECT 'tg:'||t.tgname, t.tgrelid::regclass::text||'|'||t.tgfoid::regprocedure::text FROM pg_trigger t
 WHERE NOT t.tgisinternal AND t.tgrelid::regclass::text LIKE '%team_hub%'
UNION ALL
SELECT 'roster:'||a.slug, (to_jsonb(a)-'updated_at')::text FROM public.paige_subagents a;
CREATE TEMP TABLE a2b_before AS SELECT * FROM a2b_state;
\ir ../migrations/20271121140008_exp08_team_hub_a2b_cards.sql
DO $$ BEGIN
 IF EXISTS(SELECT k,v FROM a2b_before EXCEPT SELECT k,v FROM a2b_state)
   OR EXISTS(SELECT k,v FROM a2b_state EXCEPT SELECT k,v FROM a2b_before) THEN
  RAISE EXCEPTION 'FAIL: a second apply changed a function, constraint, column, index, trigger, grant or roster row'; END IF;
END $$;
\echo 'PASS: the migration applies over the A1c chain; a second apply is a no-op (functions, constraints, columns, indexes, triggers, grants, RLS, the retirement policy, the roster)'

-- 3. Byte identity: each re-emitted door with only its marked A2b hunks undone is the body it replaces;
-- no other team_hub function of the chain changed, and no team_hub_* object was removed.
CREATE FUNCTION pg_temp.undo(src text, pairs text[]) RETURNS text LANGUAGE plpgsql AS $$
DECLARE out text:=src; i int:=1;
BEGIN
 WHILE i<cardinality(pairs) LOOP
  IF (length(out)-length(replace(out,pairs[i+1],'')))/length(pairs[i+1])<>1 THEN RAISE EXCEPTION 'FAIL: hunk % is not in the body exactly once', (i+1)/2; END IF;
  out:=replace(out,pairs[i+1],pairs[i]); i:=i+2;
 END LOOP;
 RETURN out;
END $$;
DO $$ DECLARE src text; changed text[]; BEGIN
 SELECT prosrc INTO src FROM pg_proc WHERE oid='public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure;
 IF md5(pg_temp.undo(src, ARRAY[
  $h$ existing boolean;
BEGIN$h$, $h$ existing boolean;
 card public.team_hub_message_cards; -- A2b
BEGIN$h$,
  $h$   OR p_intent IS NULL OR p_intent NOT IN ('reply','dm')
$h$, $h$   -- A2b: or 'outcome:<card message id>', the turn that posts one card's outcome.
   OR p_intent IS NULL OR (p_intent NOT IN ('reply','dm')
    AND p_intent !~ '^outcome:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
$h$,
  $h$   RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 ELSE
$h$, $h$   RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 ELSIF p_intent~'^outcome:' THEN
  -- A2b: the card is in the asker's own DM with this agent, they decided it 'approved', its outcome is
  -- settled, and the source is the asking message of the turn that posted the card. Posted once.
  SELECT * INTO card FROM public.team_hub_message_cards k WHERE k.message_id=substr(p_intent,9)::uuid
   AND k.tenant_id=p_tenant AND k.channel_id=ch.id;
  IF NOT FOUND OR ch.kind<>'agent_dm' OR ch.agent_key<>p_agent_key OR ch.created_by<>p_asker
    OR card.approver_user_id<>p_asker OR card.decision IS DISTINCT FROM 'approved' OR card.outcome IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.team_hub_agent_turns o WHERE o.posted_message_id=card.message_id
     AND o.asker_user_id=p_asker AND o.source_message_id=src.id) THEN
   RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  IF card.outcome_message_id IS NOT NULL THEN
   RETURN jsonb_build_object('ok',false,'code','duplicate','message_id',card.outcome_message_id); END IF;
 ELSE
$h$,
  $h$'repeated',true); END IF;$h$, $h$'repeated',true,'accepted_at',turn.accepted_at); END IF; -- A2b: accepted_at$h$,
  $h$'rearmed',true);$h$, $h$'rearmed',true,'accepted_at',now()); -- A2b: accepted_at$h$,
  $h$'turn_id',turn.id);$h$, $h$'turn_id',turn.id,'accepted_at',turn.accepted_at); -- A2b: accepted_at$h$]))
  <>'f28f30095f96a0c58e1206cbe61340d2' THEN
  RAISE EXCEPTION 'FAIL: outside its A2b hunks, team_hub_accept_agent_turn differs from the A1b body'; END IF;

 SELECT prosrc INTO src FROM pg_proc WHERE oid='public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)'::regprocedure;
 IF md5(pg_temp.undo(src, ARRAY[
  $h$I''m answering it in our DM.';
BEGIN$h$, $h$I''m answering it in our DM.';
 -- A2b: the proposal a 'dm' post links, or the card an 'outcome:<card>' post answers, and that card's thread.
 conf public.paige_pending_confirmations; card public.team_hub_message_cards; card_root uuid;
BEGIN$h$,
  $h$'duplicate',true);
 END IF;
 SELECT * INTO src$h$, $h$'duplicate',true)
   -- A2b: and the card it links, if it links one.
   || CASE WHEN EXISTS(SELECT 1 FROM public.team_hub_message_cards k WHERE k.message_id=msg.id)
    THEN jsonb_build_object('card',jsonb_build_object('message_id',msg.id)) ELSE '{}'::jsonb END;
 END IF;
 SELECT * INTO src$h$,
  $h$m.id=turn.source_message_id;
 -- Where$h$, (SELECT substring(src FROM 'm\.id=turn\.source_message_id;\n -- A2b: an outcome post.*?\n ELSE\n -- Where')),
  $h$  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF p_private_answer$h$, (SELECT substring(src FROM '  RETURN jsonb_build_object\(''ok'',false,''code'',''invalid''\); END IF;\n  -- A2b: a ''dm'' post in the agent DM.*?\n END IF;\n IF p_private_answer')),
  $h$ IF msg.id IS NULL THEN
  -- Already$h$, $h$ IF msg.id IS NULL THEN
  -- A2b: a card or an outcome is recorded only on a row this post writes itself.
  IF conf.id IS NOT NULL OR card.message_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  -- Already$h$,
  $h$ UPDATE public.team_hub_agent_turns t SET consumed_at=now(), posted_message_id=msg.id WHERE t.id=turn.id;
 RETURN$h$, (SELECT substring(src FROM ' UPDATE public\.team_hub_agent_turns t SET consumed_at=now\(\), posted_message_id=msg\.id WHERE t\.id=turn\.id;\n -- A2b: the card link.*?\n END IF;\n RETURN'))]))
  <>'c6930cf3329da4c0db6a8390f1564eaa' THEN
  RAISE EXCEPTION 'FAIL: outside its A2b hunks, team_hub_post_agent_message differs from the A1a body'; END IF;
 -- Every A2b block undone above starts with an "A2b:" comment (the regex hunks match from it).
 IF (length(src)-length(replace(src,'-- A2b:','')))/length('-- A2b:')<>6 THEN
  RAISE EXCEPTION 'FAIL: the post door carries an unexpected number of A2b markers'; END IF;

 SELECT array_agg(b.name ORDER BY b.name) INTO changed FROM before_src b
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(b.sig) WHERE p.oid IS NULL OR p.prosrc<>b.src;
 IF changed IS DISTINCT FROM ARRAY['team_hub_accept_agent_turn','team_hub_post_agent_message'] THEN
  RAISE EXCEPTION 'FAIL: the functions that changed are %', changed; END IF;
 IF (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
   AND p.proname LIKE '%team_hub%' AND NOT EXISTS(SELECT 1 FROM before_src b WHERE b.name=p.proname))
   IS DISTINCT FROM ARRAY['_team_hub_card_scope_guard','team_hub_card_states','team_hub_decide_card','team_hub_settle_card'] THEN
  RAISE EXCEPTION 'FAIL: the new team_hub functions are not exactly the guard and the three card doors'; END IF;
END $$;
\echo 'PASS: byte identity: the acceptance door and the post door with only their marked A2b hunks undone are the bodies they replace; every other team_hub function is unchanged; the new ones are the card guard and the three card doors'

-- 4. Structure, grants and the incumbent guards.
DO $$ DECLARE fn text; BEGIN
 IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='team_hub_post_agent_message')<>1
   OR to_regprocedure('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)') IS NOT NULL THEN
  RAISE EXCEPTION 'FAIL: the ten-argument post door is still there (an overload would make named calls ambiguous)'; END IF;
 FOREACH fn IN ARRAY ARRAY['team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)',
   'team_hub_decide_card(uuid,uuid,text,text)','team_hub_settle_card(uuid,uuid,jsonb)','team_hub_card_states(uuid,uuid,uuid[])'] LOOP
  IF NOT has_function_privilege('authenticated','public.'||fn,'EXECUTE') OR has_function_privilege('anon','public.'||fn,'EXECUTE')
    OR has_function_privilege('service_role','public.'||fn,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: % must be executable by authenticated only', fn; END IF;
 END LOOP;
 IF has_function_privilege('authenticated','public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)','EXECUTE')
   OR has_function_privilege('anon','public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)','EXECUTE')
   OR NOT has_function_privilege('service_role','public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: the acceptance door must stay service-role only'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)',
   'team_hub_decide_card(uuid,uuid,text,text)','team_hub_settle_card(uuid,uuid,jsonb)','team_hub_card_states(uuid,uuid,uuid[])',
   'team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)']) f
   WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=('public.'||f)::regprocedure AND p.prosecdef AND p.proconfig[1]='search_path=""')
    OR EXISTS(SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
     WHERE p.oid=('public.'||f)::regprocedure AND a.grantee=0)) THEN
  RAISE EXCEPTION 'FAIL: a door is not SECURITY DEFINER on an empty search_path, or PUBLIC can execute it'; END IF;
 IF has_function_privilege('authenticated','public._team_hub_card_scope_guard()','EXECUTE')
   OR has_function_privilege('service_role','public._team_hub_card_scope_guard()','EXECUTE')
   OR has_function_privilege('anon','public._team_hub_card_scope_guard()','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: the card guard is executable from outside'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.team_hub_message_cards'::regclass)
   OR EXISTS(SELECT 1 FROM pg_policies WHERE tablename='team_hub_message_cards')
   OR has_table_privilege('authenticated','public.team_hub_message_cards','SELECT,INSERT,UPDATE,DELETE')
   OR has_table_privilege('anon','public.team_hub_message_cards','SELECT,INSERT,UPDATE,DELETE') THEN
  RAISE EXCEPTION 'FAIL: team_hub_message_cards must be RLS-on with no policy and no browser grant'; END IF;
 -- The edge reads the link row (card-binding.ts, card-act.ts) and the agent message and turn metadata
 -- (card-act.ts) with the service role, which keeps Supabase's default table privileges.
 IF NOT has_table_privilege('service_role','public.team_hub_message_cards','SELECT')
   OR NOT has_table_privilege('service_role','public.team_hub_messages','SELECT')
   OR NOT has_table_privilege('service_role','public.team_hub_agent_turns','SELECT') THEN
  RAISE EXCEPTION 'FAIL: the service role cannot read the card link, the agent message or the turn the edge reads'; END IF;
 IF public.operator_retirement_disposition('team_hub_message_cards') IS DISTINCT FROM public.operator_retirement_disposition('team_hub_message_agent_mentions')
   OR public.operator_retirement_disposition('team_hub_message_cards')<>'delete' THEN
  RAISE EXCEPTION 'FAIL: the card table does not go with the account at retirement like every Team Hub table'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_agent_turns'::regclass AND conname='team_hub_agent_turns_intent_check')
   OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_agent_turns'::regclass AND conname='team_hub_agent_turns_intent_chk' AND convalidated)
   OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_message_cards'::regclass AND conname='team_hub_message_cards_confirmation_key' AND contype='u')
   OR EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_message_cards'::regclass AND contype='f'
    AND confrelid='public.paige_pending_confirmations'::regclass) THEN
  RAISE EXCEPTION 'FAIL: the intent CHECK, the UNIQUE proposal link, or its deliberate absence of a foreign key'; END IF;
 IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.team_hub_message_cards'::regclass AND contype='f'
   AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.team_hub_message_cards'::regclass AND attname='message_id')])
   NOT LIKE '%ON DELETE CASCADE'
   OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.team_hub_message_cards'::regclass AND contype='f'
   AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.team_hub_message_cards'::regclass AND attname='outcome_message_id')])
   NOT LIKE '%ON DELETE SET NULL'
   OR to_regclass('public.team_hub_message_cards_channel_idx') IS NULL THEN
  RAISE EXCEPTION 'FAIL: the card message cascades, the outcome message sets null, and the channel index exists'; END IF;
 -- No DDL on the proposal store: its columns, constraints, indexes, policies and grants are as before.
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.paige_pending_confirmations'::regclass AND NOT tgisinternal)<>0
   OR (SELECT array_agg(polname::text ORDER BY polname) FROM pg_policy WHERE polrelid='public.paige_pending_confirmations'::regclass)
    IS DISTINCT FROM ARRAY['paige_pending_confirmations_own','paige_pending_confirmations_read'] THEN
  RAISE EXCEPTION 'FAIL: the proposal store gained a trigger or a policy'; END IF;
 -- The incumbent proofs' body guards (team_work.sql, files.sql, agents_a1.sql, agent_turn_states.sql and
 -- a1c.sql), in both of their LIKE forms, rerun on the A2b chain.
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team_hub%'
   AND (p.prosrc ~* '(paige_orchestrator|delegate_to_subagent|file_action|advance_action|approval|calendar|booking)'
    OR p.prosrc ILIKE '%is_tenant_member%')) THEN
  RAISE EXCEPTION 'FAIL: a team_hub body names a delegation, approval, calendar or booking path'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team\_hub\_%'
   AND p.prosrc ~* '(paige_orchestrator|delegate_to_subagent|file_action|advance_action|approval|calendar|booking)') THEN
  RAISE EXCEPTION 'FAIL: a Team Hub function reaches a delegation, approval or calendar path'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team\_hub\_%'
   AND p.prosrc ILIKE '%is_tenant_member%') THEN
  RAISE EXCEPTION 'FAIL: Team Hub uses is_tenant_member, which admits operators'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team_hub%'
   AND p.prosrc ILIKE '%paige_pending_approvals%') THEN
  RAISE EXCEPTION 'FAIL: a team_hub body names the proposal queue A2 never files into'; END IF;
END $$;
\echo 'PASS: structure: one thirteen-argument post door; post, decide, settle and states authenticated-only, acceptance service-role only, all SECURITY DEFINER on an empty search_path; the card guard unreachable; the card table RLS-on with no grant, retired with the account; the named intent CHECK, the UNIQUE proposal link with no foreign key; no DDL on the proposal store; the incumbent body guards hold'

-- 5. The roster: exactly ZION and NEXUS, version 1 to version 2, nothing else.
DO $$ BEGIN
 IF (SELECT config->'capability_scope' FROM public.paige_subagents WHERE slug='zion')
    <>'{"version":2,"mode":"allowlist","access":"card","tools":["ask_choices","capability_status","read_business_time_zone","team_hub_read_conversation","crm_list_tasks","crm_get_task","plan_list","read_weekly_commitment_status","read_calendar_agenda","read_calendar_booking","crm_list_team","crm_assign_task","crm_cancel_task"]}'::jsonb
   OR (SELECT config->'capability_scope' FROM public.paige_subagents WHERE slug='nexus')
    <>'{"version":2,"mode":"allowlist","access":"card","tools":["ask_choices","capability_status","read_business_time_zone","team_hub_read_conversation","growth_list","campaign_brief_list","read_campaign_leads","growth_page_publish"]}'::jsonb THEN
  RAISE EXCEPTION 'FAIL: ZION and NEXUS do not read back their version 2 scopes'; END IF;
 IF EXISTS(SELECT 1 FROM roster_before b JOIN public.paige_subagents a USING (slug)
   WHERE a.version IS DISTINCT FROM b.version + CASE WHEN a.slug IN ('zion','nexus') THEN 1 ELSE 0 END
    OR (to_jsonb(a)-'config'-'updated_at'-'version') IS DISTINCT FROM (to_jsonb(b)-'config'-'updated_at'-'version')
    OR (a.config-'capability_scope') IS DISTINCT FROM (b.config-'capability_scope')
    OR (a.slug NOT IN ('zion','nexus') AND a.config IS DISTINCT FROM b.config)) THEN
  RAISE EXCEPTION 'FAIL: the roster change touched another row, another key or another field, or did not bump the version once'; END IF;
END $$;
-- A customised row is left alone, and a present row that reads back neither scope stops the file.
CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ran'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
BEGIN;
UPDATE public.paige_subagents SET config=jsonb_set(config,'{capability_scope,tools}','["ask_choices"]'), version=version+1 WHERE slug='nexus';
\set rostersql `sed -n '/^UPDATE public.paige_subagents a SET/,/^END \$\$;/p' supabase/migrations/20271121140008_exp08_team_hub_a2b_cards.sql`
SELECT pg_temp.try(:'rostersql') AS rs \gset
SELECT pg_temp.check((SELECT config->'capability_scope'->'tools'='["ask_choices"]'::jsonb FROM public.paige_subagents WHERE slug='nexus')
 AND :'rs' LIKE 'Team Hub A2b: the ZION or NEXUS platform row does not read back%', 'roster: a customised NEXUS scope is never overwritten, and the read-back refuses it: '||:'rs');
ROLLBACK;
\echo 'PASS: roster: ZION and NEXUS go from version 1 to version 2 (access card, plus their card tools), each bumping version once; every other row, key and field unchanged; a customised scope is never overwritten and stops the file'

-- 6. Behaviour. People: u1 owner, u2 and u5 members, u3 admin, all of Workspace A; u7 owns Workspace B.
SET client_min_messages=warning;
CREATE FUNCTION pg_temp.j(actor text, q text, as_role text DEFAULT 'authenticated') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims', CASE WHEN actor IS NULL THEN '' ELSE json_build_object('sub',actor,'role',as_role)::text END, false);
 BEGIN
  EXECUTE format('SET ROLE %I', as_role);
  EXECUTE 'SELECT ('||q||')::jsonb' INTO r;
  RESET ROLE;
  RETURN r;
 EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error',SQLERRM);
 END;
END $$;
CREATE FUNCTION pg_temp.h(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(t,'UTF8')),'hex') $$;
CREATE FUNCTION pg_temp.tok(n text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'turn-token-'||n||'-'||repeat('k',32) $$;
CREATE FUNCTION pg_temp.accept(tenant text, asker text, channel text, src text, agent text, intent text, token text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(NULL, format('public.team_hub_accept_agent_turn(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)',
  tenant, asker, channel, src, agent, intent, pg_temp.h(token)), 'service_role') $$;
CREATE FUNCTION pg_temp.post(actor text, tenant text, channel text, body text, agents text DEFAULT '{}', parent text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_post_message(%L::uuid,%L::uuid,%L,gen_random_uuid(),%L::uuid,''{}''::uuid[],''{}''::uuid[],%L::text[])',
  tenant, channel, body, parent, agents)) $$;
-- agent-turn.ts's named call, with the four A2b arguments only when they are set.
CREATE FUNCTION pg_temp.apost(actor text, tenant text, channel text, agent text, body text, crid text, parent text, asked text,
 intent text, token text, conf text DEFAULT NULL, kind text DEFAULT NULL, outcome jsonb DEFAULT NULL, private boolean DEFAULT false,
 summary text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_post_agent_message(p_expected_tenant=>%L::uuid,p_channel_id=>%L::uuid,p_agent_key=>%L,p_body=>%L,p_client_request_id=>%L::uuid,p_parent_message_id=>%L::uuid,p_asked_in_message_id=>%L::uuid,p_intent=>%L,p_turn_token=>%L,p_private_answer=>%L::boolean%s%s%s%s)',
  tenant, channel, agent, body, crid, parent, asked, intent, token, private,
  CASE WHEN conf IS NULL THEN '' ELSE format(',p_confirmation_id=>%L::uuid', conf) END,
  CASE WHEN kind IS NULL THEN '' ELSE format(',p_card_kind=>%L', kind) END,
  CASE WHEN outcome IS NULL THEN '' ELSE format(',p_card_outcome=>%L::jsonb', outcome) END,
  CASE WHEN summary IS NULL THEN '' ELSE format(',p_card_summary=>%L', summary) END)) $$;
CREATE FUNCTION pg_temp.decide(actor text, tenant text, msg text, decision text, fp text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_decide_card(%L::uuid,%L::uuid,%L,%L)', tenant, msg, decision, fp)) $$;
CREATE FUNCTION pg_temp.settle(actor text, tenant text, msg text, outcome jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_settle_card(%L::uuid,%L::uuid,%L::jsonb)', tenant, msg, outcome)) $$;
CREATE FUNCTION pg_temp.cstates(actor text, tenant text, channel text, ids text[]) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_card_states(%L::uuid,%L::uuid,%L::uuid[])', tenant, channel, ids)) $$;
CREATE FUNCTION pg_temp.cs(r jsonb, msg text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT x FROM jsonb_array_elements(r->'cards') x WHERE x->>'message_id'=msg $$;
CREATE FUNCTION pg_temp.all_keys(v jsonb) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE out text[]:='{}'; e record;
BEGIN
 IF jsonb_typeof(v)='object' THEN FOR e IN SELECT * FROM jsonb_each(v) LOOP out:=out||e.key||pg_temp.all_keys(e.value); END LOOP;
 ELSIF jsonb_typeof(v)='array' THEN FOR e IN SELECT * FROM jsonb_array_elements(v) LOOP out:=out||pg_temp.all_keys(e.value); END LOOP; END IF;
 RETURN out;
END $$;
-- A seat change as trusted database code makes it (no JWT): the lifecycle consent trigger refuses a JWT
-- caller lifting a suspension, which is the point of that trigger, not of this proof.
CREATE FUNCTION pg_temp.seat(tenant text, member text, st text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('request.jwt.claims', '', false);
 UPDATE public.tenant_members SET status=st WHERE tenant_id=tenant::uuid AND user_id=member::uuid;
 IF (SELECT status FROM public.tenant_members WHERE tenant_id=tenant::uuid AND user_id=member::uuid) IS DISTINCT FROM st THEN
  RAISE EXCEPTION 'seat: % did not become %', member, st; END IF;
END $$;
-- A proposal as a governed door writes it (the service role, server_issued_at from the edge's clock).
CREATE FUNCTION pg_temp.proposal(asker text, tenant text, tool text, label text, issued timestamptz DEFAULT clock_timestamp(),
 thread uuid DEFAULT NULL, client uuid DEFAULT NULL, expires timestamptz DEFAULT clock_timestamp()+interval '30 minutes') RETURNS uuid LANGUAGE sql AS $$
 INSERT INTO public.paige_pending_confirmations(user_id,tenant_id,thread_id,scoped_client_id,tool_name,fingerprint,args,summary,expires_at,server_issued_at,issued_in_request)
  VALUES (asker::uuid,tenant::uuid,thread,client,tool,substr(md5(label),1,16),jsonb_build_object('task_id',gen_random_uuid(),'secret_arg','ARGS-'||label),
   'Summary of '||label,expires,issued,gen_random_uuid()) RETURNING id $$;
CREATE FUNCTION pg_temp.fp(label text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT substr(md5(label),1,16) $$;
-- One Prepare: the person asks in the agent DM, the turn is accepted, the door writes its proposal, and the
-- agent's reply links it. Returns the ids.
CREATE FUNCTION pg_temp.make_card(asker text, tenant text, channel text, agent text, tool text, kind text, label text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE q text; c uuid; r jsonb; t text:=pg_temp.tok(label);
BEGIN
 q:=pg_temp.post(asker,tenant,channel,'Please '||label)#>>'{message,id}';
 IF q IS NULL OR (pg_temp.accept(tenant,asker,channel,q,agent,'dm',t))->>'ok'<>'true' THEN RAISE EXCEPTION 'make_card: accept failed for %', label; END IF;
 c:=pg_temp.proposal(asker,tenant,tool,label);
 r:=pg_temp.apost(asker,tenant,channel,agent,'Here is '||label,gen_random_uuid()::text,NULL,q,'dm',t,c::text,kind);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'make_card: post failed for %: %', label, r; END IF;
 RETURN jsonb_build_object('q',q,'card',r#>>'{message,id}','conf',c,'fp',pg_temp.fp(label),'token',t,'resp',r);
END $$;
-- A reader who is not the card's approver but can see its DM. Storage forbids that (an agent DM has one
-- member), so the probes that need it fabricate the membership with the member guard switched off, inside
-- a transaction that rolls back. It proves each door re-checks the approver even if visibility were wrong.
CREATE FUNCTION pg_temp.peek(channel text, tenant text, viewer text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 ALTER TABLE public.team_hub_channel_members DISABLE TRIGGER team_hub_member_scope;
 INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by) VALUES (channel::uuid,tenant::uuid,viewer::uuid,viewer::uuid);
 ALTER TABLE public.team_hub_channel_members ENABLE TRIGGER team_hub_member_scope;
END $$;

SELECT pg_temp.j(:'u1', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'ta','launch','team','{}'))->>'channel_id' AS launch \gset
SELECT pg_temp.j(:'u2', format('public.team_hub_join_channel(%L::uuid,%L::uuid)', :'ta', :'launch'))->>'ok' AS jl \gset
SELECT pg_temp.j(:'u2', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'zion'))->>'channel_id' AS zdm \gset
SELECT pg_temp.j(:'u2', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'nexus'))->>'channel_id' AS ndm \gset
SELECT pg_temp.j(:'u2', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'paige'))->>'channel_id' AS pdm \gset
SELECT pg_temp.j(:'u2', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'vera'))->>'channel_id' AS vdm \gset
SELECT pg_temp.j(:'u5', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'zion'))->>'channel_id' AS z5dm \gset
SELECT pg_temp.check(:'launch'<>'' AND :'jl'='true' AND :'zdm'<>'' AND :'ndm'<>'' AND :'pdm'<>'' AND :'vdm'<>'' AND :'z5dm'<>'',
 'setup: #launch, Person 2''s DMs with ZION, NEXUS, PAIGE and VERA, Person 5''s DM with ZION');

-- 6a. Prepare: the link, and every refusal, one case each, all on one accepted turn.
SELECT pg_temp.post(:'u2', :'ta', :'zdm', 'Cancel the kickoff task')#>>'{message,id}' AS q1 \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_cancel_task', 'early', clock_timestamp()-interval '1 second') AS c_early \gset
SELECT pg_temp.accept(:'ta', :'u2', :'zdm', :'q1', 'zion', 'dm', pg_temp.tok('L1')) AS a1 \gset
SELECT pg_temp.check((:'a1')::jsonb->>'ok'='true' AND ((:'a1')::jsonb->>'accepted_at')::timestamptz=(SELECT accepted_at FROM public.team_hub_agent_turns WHERE id=((:'a1')::jsonb->>'turn_id')::uuid),
 'acceptance returns accepted_at, the stored acceptance time');
SELECT pg_temp.proposal(:'u3', :'ta', 'crm_cancel_task', 'other user') AS c_user \gset
SELECT pg_temp.proposal(:'u2', :'tb', 'crm_cancel_task', 'other tenant') AS c_tenant \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_cancel_task', 'threaded', clock_timestamp(), gen_random_uuid()) AS c_thread \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_cancel_task', 'client focus', clock_timestamp(), NULL, gen_random_uuid()) AS c_client \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_cancel_task', 'consumed') AS c_used \gset
UPDATE public.paige_pending_confirmations SET consumed_at=now() WHERE id=:'c_used';
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_cancel_task', 'expired', clock_timestamp(), NULL, NULL, clock_timestamp()-interval '1 second') AS c_expired \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'growth_page_publish', 'out of scope') AS c_scope \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_update_task', 'not a card tool') AS c_tool \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_cancel_task', 'good') AS c_good \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_cancel_task', 'legacy', NULL) AS c_legacy \gset
CREATE FUNCTION pg_temp.try_link(conf text, kind text DEFAULT 'task_cancel', crid text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.apost('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-00000000000a',
  (SELECT id::text FROM public.team_hub_channels WHERE dm_key='agent:zion:10000000-0000-4000-8000-000000000002'),
  'zion','Card body',coalesce(crid,gen_random_uuid()::text),NULL,
  (SELECT id::text FROM public.team_hub_messages WHERE body='Cancel the kickoff task'),'dm',pg_temp.tok('L1'),conf,kind) $$;
SELECT pg_temp.check(pg_temp.try_link(:'c_user')->>'code'='invalid', 'link refused: another person''s proposal');
SELECT pg_temp.check(pg_temp.try_link(:'c_tenant')->>'code'='invalid', 'link refused: the person''s proposal in another workspace');
SELECT pg_temp.check(pg_temp.try_link(:'c_thread')->>'code'='invalid', 'link refused: a proposal minted inside a PAIGE chat thread (thread_id set)');
SELECT pg_temp.check(pg_temp.try_link(:'c_client')->>'code'='invalid', 'link refused: a proposal minted with a client in focus');
SELECT pg_temp.check(pg_temp.try_link(:'c_early')->>'code'='invalid', 'link refused: a proposal issued before this turn was accepted');
SELECT pg_temp.check(pg_temp.try_link(:'c_legacy')->>'code'='invalid', 'link refused: a proposal with no server issue time');
SELECT pg_temp.check(pg_temp.try_link(:'c_used')->>'code'='invalid', 'link refused: a consumed proposal');
SELECT pg_temp.check(pg_temp.try_link(:'c_expired')->>'code'='invalid', 'link refused: an expired proposal');
SELECT pg_temp.check(pg_temp.try_link(:'c_scope','page_publish')->>'code'='invalid', 'link refused: a card tool outside ZION''s stored DM scope (a page publish)');
SELECT pg_temp.check(pg_temp.try_link(:'c_tool','task_cancel')->>'code'='invalid', 'link refused: a tool that is not an A2b card tool');
SELECT pg_temp.check(pg_temp.try_link(:'c_good','task_handover')->>'code'='invalid', 'link refused: a kind that is not the tool''s');
SELECT pg_temp.check(pg_temp.try_link(:'c_good',NULL)->>'code'='invalid' AND pg_temp.try_link(NULL,'task_cancel')->>'code'='invalid',
 'link refused: a proposal without a kind, or a kind without a proposal');
SELECT pg_temp.check(pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Card body', gen_random_uuid()::text, NULL, :'q1', 'dm', pg_temp.tok('L1'), :'c_good', 'task_cancel', '{"state":"done"}')->>'code'='invalid',
 'link refused: an outcome passed on a dm post');
SELECT pg_temp.check((SELECT consumed_at IS NULL AND posted_message_id IS NULL FROM public.team_hub_agent_turns WHERE id=((:'a1')::jsonb->>'turn_id')::uuid)
 AND (SELECT count(*) FROM public.team_hub_messages WHERE channel_id=:'zdm' AND author_kind='agent')=0
 AND (SELECT count(*) FROM public.team_hub_message_cards)=0,
 'every refusal wrote nothing: the turn is still unconsumed, no agent message, no card');
SELECT gen_random_uuid() AS crid1 \gset
SELECT pg_temp.try_link(:'c_good', 'task_cancel', :'crid1') AS link1 \gset
SELECT pg_temp.check((:'link1')::jsonb->>'ok'='true' AND (:'link1')::jsonb#>>'{card,message_id}'=(:'link1')::jsonb#>>'{message,id}'
 AND (SELECT k.tenant_id=:'ta' AND k.channel_id=:'zdm' AND k.approver_user_id=:'u2' AND k.confirmation_id=:'c_good' AND k.tool_name='crm_cancel_task'
   AND k.kind='task_cancel' AND k.decision IS NULL AND k.outcome IS NULL FROM public.team_hub_message_cards k WHERE k.message_id=((:'link1')::jsonb#>>'{message,id}')::uuid)
 AND (SELECT consumed_at IS NULL FROM public.paige_pending_confirmations WHERE id=:'c_good')
 AND NOT ((:'link1')::jsonb->'message' ? 'card') AND position('ARGS-good' IN (:'link1'))=0,
 'link: the turn''s own live proposal links to the posted reply (card.message_id is the reply), the proposal stays live, the message JSON is unchanged and carries no arguments');
SELECT (:'link1')::jsonb#>>'{message,id}' AS card1 \gset
SELECT pg_temp.check(pg_temp.try_link(:'c_good', 'task_cancel', :'crid1')->>'duplicate'='true'
 AND pg_temp.try_link(:'c_good', 'task_cancel', :'crid1')#>>'{card,message_id}'=:'card1',
 'a retry with the same token and request id returns the posted reply and its card, writing nothing');
-- Already linked: a second turn cannot link the same proposal.
SELECT pg_temp.post(:'u2', :'ta', :'zdm', 'And again')#>>'{message,id}' AS q2 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'zdm', :'q2', 'zion', 'dm', pg_temp.tok('L2'))->>'ok' AS a2 \gset
SELECT pg_temp.check(:'a2'='true' AND pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Second', gen_random_uuid()::text, NULL, :'q2', 'dm', pg_temp.tok('L2'), :'c_good', 'task_cancel')->>'code'='invalid',
 'link refused: a proposal already linked to a card');
-- Not an agent DM: a reply turn in a channel cannot link anything.
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@ZION cancel it', '{zion}')#>>'{message,id}' AS q3 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q3', 'zion', 'reply', pg_temp.tok('L3'))->>'ok' AS a3 \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_cancel_task', 'channel try') AS c_chan \gset
SELECT pg_temp.check(:'a3'='true' AND pg_temp.apost(:'u2', :'ta', :'launch', 'zion', 'In channel', gen_random_uuid()::text, NULL, :'q3', 'reply', pg_temp.tok('L3'), :'c_chan', 'task_cancel')->>'code'='invalid'
 AND pg_temp.apost(:'u2', :'ta', :'launch', 'zion', 'In channel', gen_random_uuid()::text, NULL, :'q3', 'reply', pg_temp.tok('L3'))->>'ok'='true',
 'link refused: a reply in a channel (not an agent DM); the same turn still posts its plain reply');
-- Scope by agent: NEXUS may Prepare a page publish, PAIGE her D13 card tools, VERA (still version 1, reads) nothing.
SELECT pg_temp.make_card(:'u2', :'ta', :'ndm', 'nexus', 'growth_page_publish', 'page_publish', 'publish spring page') AS nx \gset
SELECT pg_temp.make_card(:'u2', :'ta', :'pdm', 'paige', 'crm_cancel_task', 'task_cancel', 'paige cancel') AS px \gset
SELECT pg_temp.post(:'u2', :'ta', :'vdm', 'VERA, cancel it')#>>'{message,id}' AS qv \gset
SELECT pg_temp.accept(:'ta', :'u2', :'vdm', :'qv', 'vera', 'dm', pg_temp.tok('LV'))->>'ok' AS av \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_cancel_task', 'vera try') AS c_vera \gset
SELECT pg_temp.check(:'av'='true' AND (:'nx')::jsonb->>'card' IS NOT NULL AND (:'px')::jsonb->>'card' IS NOT NULL
 AND pg_temp.apost(:'u2', :'ta', :'vdm', 'vera', 'V', gen_random_uuid()::text, NULL, :'qv', 'dm', pg_temp.tok('LV'), :'c_vera', 'task_cancel')->>'code'='invalid',
 'scope: NEXUS links a page publish, PAIGE a task cancel (her inlined DM scope), VERA (a read-only scope) nothing');
-- The card's own sentence (written by the server at prepare, from that turn's reads): refused without a
-- link, blank, or over 280 characters, writing nothing; with the link it is stored trimmed and read in
-- place of the door's own summary. (Rolled back, so the counts below are unaffected.)
BEGIN;
SELECT pg_temp.post(:'u2', :'ta', :'zdm', 'Hand the kickoff task to Person 3')#>>'{message,id}' AS qs \gset
SELECT pg_temp.accept(:'ta', :'u2', :'zdm', :'qs', 'zion', 'dm', pg_temp.tok('LS'))->>'ok' AS as1 \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_assign_task', 'summarised') AS c_sum \gset
SELECT pg_temp.check(:'as1'='true'
 AND pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'S', gen_random_uuid()::text, NULL, :'qs', 'dm', pg_temp.tok('LS'), NULL, NULL, NULL, false, 'Hand it over.')->>'code'='invalid'
 AND pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'S', gen_random_uuid()::text, NULL, :'qs', 'dm', pg_temp.tok('LS'), :'c_sum', 'task_handover', NULL, false, '   ')->>'code'='invalid'
 AND pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'S', gen_random_uuid()::text, NULL, :'qs', 'dm', pg_temp.tok('LS'), :'c_sum', 'task_handover', NULL, false, repeat('s',281))->>'code'='invalid'
 AND (SELECT consumed_at IS NULL FROM public.team_hub_agent_turns WHERE source_message_id=:'qs'::uuid)
 AND NOT EXISTS(SELECT 1 FROM public.team_hub_message_cards WHERE confirmation_id=:'c_sum'),
 'card sentence: refused without a link, blank, or over 280 characters; nothing written and the turn still unconsumed');
SELECT pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'S', gen_random_uuid()::text, NULL, :'qs', 'dm', pg_temp.tok('LS'), :'c_sum', 'task_handover', NULL, false,
 E'  Hand \u201cKickoff deck\u201d over to Person 3.  ') AS lsum \gset
SELECT pg_temp.check((:'lsum')::jsonb->>'ok'='true'
 AND (SELECT summary FROM public.team_hub_message_cards WHERE confirmation_id=:'c_sum')=E'Hand \u201cKickoff deck\u201d over to Person 3.'
 AND pg_temp.cs(pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[(:'lsum')::jsonb#>>'{message,id}']), (:'lsum')::jsonb#>>'{message,id}')#>>'{card,actions,0,summary}'
  =E'Hand \u201cKickoff deck\u201d over to Person 3.',
 'card sentence: stored trimmed with the link and read in place of the door''s summary');
ROLLBACK;
-- Storage backstop: a card for a message of another workspace, a person's message, or another person's proposal fails.
SELECT pg_temp.j(:'u7', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'tb', 'zion'))->>'channel_id' AS bz \gset
SELECT pg_temp.post(:'u7', :'tb', :'bz', 'B asks')#>>'{message,id}' AS qb \gset
SELECT pg_temp.accept(:'tb', :'u7', :'bz', :'qb', 'zion', 'dm', pg_temp.tok('B1'))->>'ok' AS ab \gset
SELECT pg_temp.apost(:'u7', :'tb', :'bz', 'zion', 'B reply', gen_random_uuid()::text, NULL, :'qb', 'dm', pg_temp.tok('B1'))#>>'{message,id}' AS bmsg \gset
CREATE FUNCTION pg_temp.raw_card(msg text, tenant text, channel text, approver text, conf text, tool text DEFAULT 'crm_cancel_task', kind text DEFAULT 'task_cancel') RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.team_hub_message_cards(message_id,tenant_id,channel_id,approver_user_id,confirmation_id,tool_name,kind)
  VALUES (msg::uuid,tenant::uuid,channel::uuid,approver::uuid,conf::uuid,tool,kind);
 RETURN 'inserted';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_cancel_task', 'raw') AS c_raw \gset
SELECT pg_temp.check(:'ab'='true' AND :'bmsg'<>''
 AND pg_temp.raw_card(:'bmsg', :'ta', :'zdm', :'u2', :'c_raw') LIKE 'TEAM_HUB_CARD_SCOPE%'
 AND pg_temp.raw_card(:'bmsg', :'ta', :'bz', :'u7', :'c_raw') LIKE 'TEAM_HUB_CARD_SCOPE%'
 AND pg_temp.raw_card(:'q1', :'ta', :'zdm', :'u2', :'c_raw') LIKE 'TEAM_HUB_CARD_SCOPE%'
 AND pg_temp.raw_card(:'bmsg', :'tb', :'bz', :'u7', :'c_raw') LIKE 'TEAM_HUB_CARD_SCOPE%'
 AND pg_temp.raw_card(:'card1', :'ta', :'zdm', :'u2', :'c_raw', 'crm_cancel_task', 'task_handover') LIKE '%team_hub_message_cards_kind_chk%',
 'storage: a card for another workspace''s message, a person''s message, or another person''s proposal fails the scope guard; a tool with the wrong kind fails its CHECK');
\echo 'PASS: Prepare: a dm reply links only its own turn''s live proposal (refused: another person''s, another workspace''s, in a chat thread, with a client in focus, issued before the turn, without a server issue time, consumed, expired, outside the agent''s scope, not a card tool, the wrong kind, already linked, outside an agent DM); refusals write nothing; a retry returns the card; NEXUS, PAIGE and ZION link their own card tools, VERA none; the storage guard refuses another workspace'

-- 6b. The member-safe read, waiting.
SELECT pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[:'card1', :'q1']) AS s1 \gset
SELECT pg_temp.check(jsonb_array_length((:'s1')::jsonb->'cards')=1
 AND pg_temp.cs(:'s1', :'card1')=jsonb_build_object('message_id',:'card1','card',jsonb_build_object('state','waiting','kind','task_cancel',
   'actions',jsonb_build_array(jsonb_build_object('summary','Summary of good','fingerprint',pg_temp.fp('good'))),
   'asker_user_id',:'u2','decided_by_name',NULL,'decided_at',NULL,
   'expires_at',(SELECT to_jsonb(expires_at) FROM public.paige_pending_confirmations WHERE id=:'c_good')),
  'outcome_message_id',NULL,'record',NULL)
 AND NOT ('args'=ANY(pg_temp.all_keys((:'s1')::jsonb))) AND NOT ('approval'=ANY(pg_temp.all_keys((:'s1')::jsonb)))
 AND position('ARGS-good' IN (:'s1'))=0 AND position('task_id' IN (:'s1'))=0,
 'states: the approver reads waiting with the summary, the fingerprint and the stored expiry; a non-card message returns nothing; no args or approval key at any depth, no argument value');
SELECT pg_temp.check(pg_temp.cstates(:'u3', :'ta', :'zdm', ARRAY[:'card1'])->>'code'='not_found'
 AND pg_temp.cstates(:'u1', :'ta', :'zdm', ARRAY[:'card1'])->>'code'='not_found'
 AND pg_temp.cstates(:'u7', :'ta', :'zdm', ARRAY[:'card1'])->>'code'='scope_changed'
 AND pg_temp.cstates(:'u7', :'tb', :'bz', ARRAY[:'card1'])->'cards'='[]'::jsonb
 AND pg_temp.cstates(:'u2', :'ta', :'launch', ARRAY[:'card1'])->'cards'='[]'::jsonb
 AND pg_temp.cstates(:'u2', :'ta', :'zdm', array_fill(:'card1'::text, ARRAY[101]))->>'code'='invalid'
 AND pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[NULL]::text[])->>'code'='invalid',
 'states: another member and the owner are refused the DM, another workspace reads nothing, a card id read through another conversation returns nothing, more than 100 ids or a null id is refused');
BEGIN;
SELECT pg_temp.peek(:'zdm', :'ta', :'u3');
SELECT pg_temp.check(pg_temp.cs(pg_temp.cstates(:'u3', :'ta', :'zdm', ARRAY[:'card1']), :'card1')#>'{card,actions,0}'=jsonb_build_object('summary','Summary of good'),
 'states: even a reader who could see the DM but is not the approver gets no fingerprint');
ROLLBACK;
\echo 'PASS: states (waiting): the approver alone reads the fingerprint; never arguments; only conversations the caller can see now'

-- 6c. Decide.
SELECT pg_temp.check(pg_temp.decide(:'u3', :'ta', :'card1', 'approve', pg_temp.fp('good'))->>'code'='not_found'
 AND pg_temp.decide(:'u7', :'ta', :'card1', 'approve', pg_temp.fp('good'))->>'code'='scope_changed'
 AND pg_temp.decide(:'u7', :'tb', :'card1', 'approve', pg_temp.fp('good'))->>'code'='not_found'
 AND pg_temp.decide(:'u2', :'ta', :'card1', 'approve', pg_temp.fp('other'))->>'code'='invalid'
 AND pg_temp.decide(:'u2', :'ta', :'card1', 'maybe', pg_temp.fp('good'))->>'code'='invalid'
 AND pg_temp.decide(:'u2', :'ta', :'card1', 'approve', 'NOT-HEX')->>'code'='invalid',
 'decide: refused for a member who cannot see the card (not_found), another workspace (its refusal / not_found), a wrong fingerprint, an unknown decision or a malformed fingerprint');
BEGIN;
SELECT pg_temp.peek(:'zdm', :'ta', :'u3');
SELECT pg_temp.check(pg_temp.decide(:'u3', :'ta', :'card1', 'approve', pg_temp.fp('good'))->>'code'='not_yours'
 AND pg_temp.settle(:'u3', :'ta', :'card1', '{"state":"done"}')->>'code'='not_yours',
 'decide and settle: a non-approver who could see the DM is refused not_yours');
ROLLBACK;
SELECT pg_temp.seat(:'ta', :'u2', 'suspended');
SELECT pg_temp.decide(:'u2', :'ta', :'card1', 'approve', pg_temp.fp('good')) AS dsus \gset
SELECT pg_temp.seat(:'ta', :'u2', 'active');
SELECT pg_temp.check((:'dsus')::jsonb->>'code'='not_member' AND (SELECT decision IS NULL FROM public.team_hub_message_cards WHERE message_id=:'card1'),
 'decide: an approver whose seat is not active is refused, and nothing is decided');
SELECT pg_temp.decide(:'u2', :'ta', :'card1', 'approve', pg_temp.fp('good')) AS d1 \gset
SELECT pg_temp.check((:'d1')::jsonb=jsonb_build_object('ok',true,'decision','approved','confirmation_id',:'c_good')
 AND (SELECT decision='approved' AND decided_at IS NOT NULL FROM public.team_hub_message_cards WHERE message_id=:'card1')
 AND (SELECT consumed_at IS NULL FROM public.paige_pending_confirmations WHERE id=:'c_good')
 AND pg_temp.decide(:'u2', :'ta', :'card1', 'decline', pg_temp.fp('good'))=jsonb_build_object('ok',true,'already',true,'decision','approved','outcome',NULL,'confirmation_id',:'c_good')
 AND pg_temp.cs(pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[:'card1']), :'card1')#>>'{card,state}'='working'
 AND pg_temp.cs(pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[:'card1']), :'card1')#>>'{card,decided_by_name}'='Person 2'
 AND NOT (pg_temp.cs(pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[:'card1']), :'card1')#>'{card,actions,0}' ? 'fingerprint'),
 'decide approve: the decision only (the proposal stays live for the door''s own claim); a repeat returns the first decision; the card reads working, decided by the approver, with no fingerprint');
SELECT pg_temp.make_card(:'u2', :'ta', :'zdm', 'zion', 'crm_assign_task', 'task_handover', 'hand over onboarding') AS dx \gset
SELECT pg_temp.decide(:'u2', :'ta', (:'dx')::jsonb->>'card', 'decline', (:'dx')::jsonb->>'fp') AS d2 \gset
SELECT pg_temp.check((:'d2')::jsonb->>'decision'='declined'
 AND (SELECT consumed_at IS NOT NULL FROM public.paige_pending_confirmations WHERE id=((:'dx')::jsonb->>'conf')::uuid)
 AND (SELECT decision='declined' FROM public.team_hub_message_cards WHERE message_id=((:'dx')::jsonb->>'card')::uuid)
 AND pg_temp.cs(pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[(:'dx')::jsonb->>'card']), (:'dx')::jsonb->>'card')#>>'{card,state}'='declined'
 AND pg_temp.decide(:'u2', :'ta', (:'dx')::jsonb->>'card', 'approve', (:'dx')::jsonb->>'fp')->>'decision'='declined'
 AND pg_temp.settle(:'u2', :'ta', (:'dx')::jsonb->>'card', '{"state":"done"}')->>'code'='not_allowed',
 'decide decline: consumes the proposal and stores declined in one transaction; it reads declined; a later approve returns the decline; a declined card cannot be settled');
SELECT pg_temp.make_card(:'u2', :'ta', :'zdm', 'zion', 'crm_cancel_task', 'task_cancel', 'expire me') AS ex \gset
UPDATE public.paige_pending_confirmations SET expires_at=now()-interval '1 second' WHERE id=((:'ex')::jsonb->>'conf')::uuid;
SELECT pg_temp.make_card(:'u2', :'ta', :'zdm', 'zion', 'crm_cancel_task', 'task_cancel', 'used elsewhere') AS ux \gset
UPDATE public.paige_pending_confirmations SET consumed_at=now() WHERE id=((:'ux')::jsonb->>'conf')::uuid;
SELECT pg_temp.check(pg_temp.decide(:'u2', :'ta', (:'ex')::jsonb->>'card', 'approve', (:'ex')::jsonb->>'fp')->>'code'='expired'
 AND pg_temp.decide(:'u2', :'ta', (:'ux')::jsonb->>'card', 'approve', (:'ux')::jsonb->>'fp')->>'code'='already_decided'
 AND (SELECT count(*) FROM public.team_hub_message_cards WHERE message_id IN (((:'ex')::jsonb->>'card')::uuid,((:'ux')::jsonb->>'card')::uuid) AND decision IS NOT NULL)=0,
 'decide: refused expired past the proposal''s own expiry, and already_decided when the proposal was redeemed elsewhere; neither card is decided');
\echo 'PASS: decide: the approver only (not_yours even if visibility were wrong), only in a visible conversation of their own workspace, with an active seat and the card''s fingerprint; approve stores the decision only; decline consumes and stores declined together; a repeat returns the first; expired and redeemed-elsewhere refused'

-- 6d. Settle, and the outcome post.
SELECT pg_temp.check(pg_temp.settle(:'u2', :'ta', :'card1', '{"state":"finished"}')->>'code'='invalid'
 AND pg_temp.settle(:'u2', :'ta', :'card1', '{"state":"done","extra":1}')->>'code'='invalid'
 AND pg_temp.settle(:'u2', :'ta', :'card1', jsonb_build_object('state','done','note',repeat('n',281)))->>'code'='invalid'
 AND pg_temp.settle(:'u2', :'ta', :'card1', '{"state":"done","record":{"destination":"operations_work","record_id":"x"}}')->>'code'='invalid'
 AND pg_temp.settle(:'u2', :'ta', :'card1', '{"state":"done","record":{"destination":"operations_work","record_id":"10000000-0000-4000-8000-000000000001","args":1}}')->>'code'='invalid'
 AND pg_temp.settle(:'u2', :'ta', :'card1', '{"state":"failed","record":{"destination":"operations_work","record_id":"10000000-0000-4000-8000-000000000001"}}')->>'code'='invalid'
 AND pg_temp.settle(:'u2', :'ta', :'card1', '{"state":"done","note":3}')->>'code'='invalid'
 AND pg_temp.settle(:'u2', :'ta', :'card1', '"done"')->>'code'='invalid'
 AND pg_temp.settle(:'u2', :'ta', (:'ex')::jsonb->>'card', '{"state":"done"}')->>'code'='not_allowed'
 AND (SELECT outcome IS NULL FROM public.team_hub_message_cards WHERE message_id=:'card1'),
 'settle: refused for an unknown state, an extra key, a note over 280 characters, a non-uuid record, a record with another key, a record on a failure, a non-text note, a non-object, or an undecided card');
-- The outcome turn: refused before the outcome is settled.
SELECT 'outcome:'||:'card1' AS oi \gset
SELECT pg_temp.check(pg_temp.accept(:'ta', :'u2', :'zdm', :'q1', 'zion', :'oi', pg_temp.tok('O1'))->>'code'='not_allowed',
 'outcome turn: refused while the outcome is not settled');
-- The door ran (it consumes its own proposal), then settle records done with the record it produced.
UPDATE public.paige_pending_confirmations SET consumed_at=now() WHERE id=:'c_good';
SELECT pg_temp.settle(:'u2', :'ta', :'card1', '{"state":"done","note":"  Kickoff task cancelled.  ","record":{"destination":"operations_work","record_id":"30000000-0000-4000-8000-000000000001"}}') AS st1 \gset
SELECT pg_temp.check((:'st1')::jsonb=jsonb_build_object('ok',true,'outcome','done')
 AND (SELECT outcome='done' AND outcome_note='Kickoff task cancelled.' AND outcome_record='{"destination":"operations_work","record_id":"30000000-0000-4000-8000-000000000001"}'::jsonb
   AND settled_at IS NOT NULL AND outcome_message_id IS NULL FROM public.team_hub_message_cards WHERE message_id=:'card1')
 AND pg_temp.settle(:'u2', :'ta', :'card1', '{"state":"failed"}')=jsonb_build_object('ok',true,'already',true,'outcome','done','note','Kickoff task cancelled.')
 AND pg_temp.cs(pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[:'card1']), :'card1')#>'{card,actions,0}'=jsonb_build_object('summary','Summary of good','note','Kickoff task cancelled.')
 AND (SELECT outcome='done' FROM public.team_hub_message_cards WHERE message_id=:'card1')
 AND pg_temp.cs(pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[:'card1']), :'card1')#>>'{card,state}'='done'
 AND pg_temp.cs(pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[:'card1']), :'card1')->'record'='{"destination":"operations_work","record_id":"30000000-0000-4000-8000-000000000001"}'::jsonb,
 'settle: done is recorded once (note trimmed, record kept), before anything is posted; a second settle returns the first, with its note, and changes nothing; the card reads done with its record and its note');
-- Outcome accept and post, in the card's thread, linked to nothing, once.
SELECT pg_temp.check(pg_temp.accept(:'ta', :'u3', :'zdm', :'q1', 'zion', :'oi', pg_temp.tok('O0'))->>'code' IN ('not_member','not_found','not_allowed')
 AND pg_temp.accept(:'ta', :'u2', :'zdm', :'q2', 'zion', :'oi', pg_temp.tok('O0'))->>'code'='not_allowed'
 AND pg_temp.accept(:'ta', :'u2', :'zdm', :'q1', 'nexus', :'oi', pg_temp.tok('O0'))->>'code'='not_allowed'
 AND pg_temp.accept(:'ta', :'u2', :'ndm', :'q1', 'zion', :'oi', pg_temp.tok('O0'))->>'code'='not_allowed'
 AND pg_temp.accept(:'ta', :'u2', :'zdm', :'q1', 'zion', 'outcome:not-a-uuid', pg_temp.tok('O0'))->>'code'='invalid'
 AND pg_temp.accept(:'ta', :'u2', :'zdm', :'q1', 'zion', 'outcome:'||((:'dx')::jsonb->>'card'), pg_temp.tok('O0'))->>'code'='not_allowed',
 'outcome turn: refused for another person, another source than the card''s own question, another agent, another conversation, a malformed id, or a declined card');
SELECT pg_temp.accept(:'ta', :'u2', :'zdm', :'q1', 'zion', :'oi', pg_temp.tok('O1')) AS ao \gset
SELECT pg_temp.check((:'ao')::jsonb->>'ok'='true' AND (:'ao')::jsonb ? 'accepted_at'
 AND pg_temp.accept(:'ta', :'u2', :'zdm', :'q1', 'zion', :'oi', pg_temp.tok('O1'))->>'repeated'='true'
 AND pg_temp.accept(:'ta', :'u2', :'zdm', :'q1', 'zion', :'oi', pg_temp.tok('O1')) ? 'accepted_at',
 'outcome turn: accepted for the approver once settled, with accepted_at; the same token again is the same turn, with accepted_at');
SELECT pg_temp.check(pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Done.', gen_random_uuid()::text, NULL, :'q1', :'oi', pg_temp.tok('O1'))->>'code'='invalid'
 AND pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Done.', gen_random_uuid()::text, :'card1', :'q1', :'oi', pg_temp.tok('O1'))->>'code'='invalid'
 AND pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Done.', gen_random_uuid()::text, :'card1', NULL, :'oi', pg_temp.tok('O1'), :'c_raw', 'task_cancel')->>'code'='invalid'
 AND pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Done.', gen_random_uuid()::text, :'card1', NULL, :'oi', pg_temp.tok('O1'), NULL, NULL, '{"state":"failed"}')->>'code'='invalid'
 AND pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Done.', gen_random_uuid()::text, :'card1', NULL, :'oi', pg_temp.tok('O1'), NULL, NULL, NULL, true)->>'code'='invalid'
 AND pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Done.', gen_random_uuid()::text, :'card1', NULL, :'oi', pg_temp.tok('O1'), NULL, NULL, NULL, false, 'A sentence')->>'code'='invalid'
 AND pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Done.', gen_random_uuid()::text, :'card1', NULL, :'oi', pg_temp.tok('O9'))->>'code'='not_allowed',
 'outcome post: refused outside the card''s thread, linked to the asking message, carrying a proposal, with an outcome other than the settled one, with the private line, with a card sentence, or without the turn''s token');
SELECT gen_random_uuid() AS ocrid \gset
SELECT pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Done. Kickoff task cancelled.', :'ocrid', :'card1', NULL, :'oi', pg_temp.tok('O1'), NULL, NULL, '{"state":"done"}') AS op \gset
SELECT pg_temp.check((:'op')::jsonb->>'ok'='true' AND NOT ((:'op')::jsonb ? 'card')
 AND (SELECT outcome_message_id::text FROM public.team_hub_message_cards WHERE message_id=:'card1')=(:'op')::jsonb#>>'{message,id}'
 AND (SELECT parent_message_id::text=:'card1' AND asked_in_message_id IS NULL AND agent_key='zion' AND author_kind='agent'
   FROM public.team_hub_messages WHERE id=((:'op')::jsonb#>>'{message,id}')::uuid)
 AND pg_temp.cs(pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[:'card1']), :'card1')->>'outcome_message_id'=(:'op')::jsonb#>>'{message,id}'
 AND pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Done. Kickoff task cancelled.', :'ocrid', :'card1', NULL, :'oi', pg_temp.tok('O1'))->>'duplicate'='true'
 AND pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Done again', gen_random_uuid()::text, :'card1', NULL, :'oi', pg_temp.tok('O1'))->>'code'='not_allowed'
 AND pg_temp.accept(:'ta', :'u2', :'zdm', :'q1', 'zion', :'oi', pg_temp.tok('O2'))->>'code'='duplicate'
 AND (SELECT count(*) FROM public.team_hub_messages WHERE parent_message_id=:'card1')=1,
 'outcome post: posted once in the card''s thread, linked to nothing, recorded on the card; a retry returns it; a second post or a new outcome turn is refused');
-- A failure: the door reported nothing ran, the proposal is still live, settle consumes it.
SELECT pg_temp.decide(:'u2', :'ta', (:'nx')::jsonb->>'card', 'approve', (:'nx')::jsonb->>'fp')->>'decision' AS dn \gset
SELECT pg_temp.settle(:'u2', :'ta', (:'nx')::jsonb->>'card', '{"state":"failed","note":"The page has no published version."}') AS sf \gset
SELECT pg_temp.check(:'dn'='approved' AND (:'sf')::jsonb->>'outcome'='failed'
 AND (SELECT consumed_at IS NOT NULL FROM public.paige_pending_confirmations WHERE id=((:'nx')::jsonb->>'conf')::uuid)
 AND pg_temp.cs(pg_temp.cstates(:'u2', :'ta', :'ndm', ARRAY[(:'nx')::jsonb->>'card']), (:'nx')::jsonb->>'card')#>>'{card,state}'='failed'
 AND pg_temp.cs(pg_temp.cstates(:'u2', :'ta', :'ndm', ARRAY[(:'nx')::jsonb->>'card']), (:'nx')::jsonb->>'card')#>>'{card,actions,0,note}'='The page has no published version.',
 'settle failed: a live proposal is consumed in the same transaction, so nothing can run it later; the card reads failed, with its reason');
\echo 'PASS: settle and outcome: the approver records one outcome before anything is posted (failed consumes a live proposal); the outcome turn is accepted only once it is settled, for the approver, the card''s own question, agent and conversation; the outcome posts once in the card''s thread, recorded on the card'

-- 6e. Every row of the state derivation.
SELECT pg_temp.make_card(:'u2', :'ta', :'zdm', 'zion', 'crm_cancel_task', 'task_cancel', 'stale run') AS sx \gset
SELECT pg_temp.decide(:'u2', :'ta', (:'sx')::jsonb->>'card', 'approve', (:'sx')::jsonb->>'fp')->>'ok' AS dsx \gset
UPDATE public.team_hub_message_cards SET decided_at=now()-interval '11 minutes' WHERE message_id=((:'sx')::jsonb->>'card')::uuid;
SELECT pg_temp.make_card(:'u2', :'ta', :'zdm', 'zion', 'crm_cancel_task', 'task_cancel', 'unsure') AS ix \gset
SELECT pg_temp.decide(:'u2', :'ta', (:'ix')::jsonb->>'card', 'approve', (:'ix')::jsonb->>'fp')->>'ok' AS dix \gset
SELECT pg_temp.settle(:'u2', :'ta', (:'ix')::jsonb->>'card', '{"state":"unconfirmed"}')->>'ok' AS six \gset
SELECT pg_temp.make_card(:'u2', :'ta', :'zdm', 'zion', 'crm_cancel_task', 'task_cancel', 'gone') AS gx \gset
DELETE FROM public.paige_pending_confirmations WHERE id=((:'gx')::jsonb->>'conf')::uuid;
SELECT pg_temp.make_card(:'u2', :'ta', :'zdm', 'zion', 'crm_cancel_task', 'task_cancel', 'still waiting') AS wx \gset
SELECT pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[:'card1', (:'dx')::jsonb->>'card', (:'ex')::jsonb->>'card', (:'ux')::jsonb->>'card',
 (:'sx')::jsonb->>'card', (:'ix')::jsonb->>'card', (:'gx')::jsonb->>'card', (:'wx')::jsonb->>'card']) AS sall \gset
SELECT pg_temp.check(pg_temp.cs(:'sall', :'card1')#>>'{card,state}'='done'
 AND pg_temp.cs(:'sall', (:'dx')::jsonb->>'card')#>>'{card,state}'='declined'
 AND pg_temp.cs(:'sall', (:'ex')::jsonb->>'card')#>>'{card,state}'='expired'
 AND pg_temp.cs(:'sall', (:'ux')::jsonb->>'card')#>>'{card,state}'='unconfirmed'
 AND pg_temp.cs(:'sall', (:'sx')::jsonb->>'card')#>>'{card,state}'='unconfirmed'
 AND pg_temp.cs(:'sall', (:'ix')::jsonb->>'card')#>>'{card,state}'='unconfirmed'
 AND pg_temp.cs(:'sall', (:'gx')::jsonb->>'card')#>>'{card,state}'='expired'
 AND pg_temp.cs(:'sall', (:'wx')::jsonb->>'card')#>>'{card,state}'='waiting'
 AND pg_temp.cs(:'sall', (:'wx')::jsonb->>'card')#>'{card,actions,0}' ? 'fingerprint'
 AND NOT (pg_temp.cs(:'sall', (:'wx')::jsonb->>'card')#>'{card,actions,0}' ? 'note')
 AND NOT (pg_temp.cs(:'sall', (:'ix')::jsonb->>'card')#>'{card,actions,0}' ? 'note')
 AND (SELECT bool_and(NOT (x#>'{card,actions,0}' ? 'fingerprint')) FROM jsonb_array_elements((:'sall')::jsonb->'cards') x WHERE x#>>'{card,state}'<>'waiting')
 AND jsonb_array_length((:'sall')::jsonb->'cards')=8
 AND NOT ('args'=ANY(pg_temp.all_keys((:'sall')::jsonb))) AND NOT ('approval'=ANY(pg_temp.all_keys((:'sall')::jsonb)))
 AND position('ARGS-' IN (:'sall'))=0,
 'states: done; declined; expired past its expiry; unconfirmed when redeemed elsewhere; unconfirmed when approved and never settled for over 10 minutes; unconfirmed when settled so; expired when the proposal is gone; waiting (the only state with a fingerprint); no args or approval key, no argument value');
-- An approver whose seat is held (suspended keeps the DM): an undecided card reads expired.
BEGIN;
SELECT pg_temp.peek(:'zdm', :'ta', :'u3');
SELECT pg_temp.seat(:'ta', :'u2', 'suspended');
SELECT pg_temp.check(pg_temp.cs(pg_temp.cstates(:'u3', :'ta', :'zdm', ARRAY[(:'wx')::jsonb->>'card']), (:'wx')::jsonb->>'card')#>>'{card,state}'='expired'
 AND pg_temp.cs(pg_temp.cstates(:'u3', :'ta', :'zdm', ARRAY[:'card1']), :'card1')#>>'{card,decided_by_name}'='Former teammate',
 'states: an undecided card whose approver''s seat is not active reads expired; a decided one names them Former teammate');
ROLLBACK;
\echo 'PASS: states: every row of the derivation (waiting, working, done, failed, unconfirmed three ways, declined, expired three ways); the fingerprint only while waiting'

-- 6f. Acceptance: accepted_at on a re-arm, and an outcome turn counts toward the 30 per hour.
SELECT pg_temp.post(:'u2', :'ta', :'zdm', 'Rearm me')#>>'{message,id}' AS qr \gset
SELECT pg_temp.accept(:'ta', :'u2', :'zdm', :'qr', 'zion', 'dm', pg_temp.tok('R1'))->>'turn_id' AS tr \gset
SELECT pg_temp.j(NULL, format('public.team_hub_end_agent_turn(%L::uuid,%L)', :'tr', pg_temp.h(pg_temp.tok('R1'))), 'service_role')->>'ok' AS er \gset
SELECT pg_temp.accept(:'ta', :'u2', :'zdm', :'qr', 'zion', 'dm', pg_temp.tok('R2')) AS ar \gset
SELECT pg_temp.check(:'er'='true' AND (:'ar')::jsonb->>'rearmed'='true'
 AND ((:'ar')::jsonb->>'accepted_at')::timestamptz=(SELECT accepted_at FROM public.team_hub_agent_turns WHERE id=:'tr'),
 'acceptance: a re-arm returns accepted_at, the new acceptance time');
SELECT pg_temp.make_card(:'u5', :'ta', :'z5dm', 'zion', 'crm_cancel_task', 'task_cancel', 'cap card') AS cx \gset
SELECT pg_temp.decide(:'u5', :'ta', (:'cx')::jsonb->>'card', 'approve', (:'cx')::jsonb->>'fp')->>'ok' AS dcx \gset
SELECT pg_temp.settle(:'u5', :'ta', (:'cx')::jsonb->>'card', '{"state":"done"}')->>'ok' AS scx \gset
SELECT pg_temp.post(:'u5', :'ta', :'z5dm', 'filler')#>>'{message,id}' AS qf \gset
INSERT INTO public.team_hub_agent_turns(tenant_id,channel_id,asker_user_id,source_message_id,agent_key,intent,token_hash,accepted_at,attempts,consumed_at)
 SELECT :'ta'::uuid, :'z5dm'::uuid, :'u5'::uuid, :'qf'::uuid, 'zion', 'dm', pg_temp.h('filler'), now(), array_append(array_agg(now()-(n||' minutes')::interval ORDER BY n DESC), now()), now()
 FROM generate_series(1,27) n;
SELECT pg_temp.accept(:'ta', :'u5', :'z5dm', (:'cx')::jsonb->>'q', 'zion', 'outcome:'||((:'cx')::jsonb->>'card'), pg_temp.tok('C1')) AS ac \gset
SELECT pg_temp.post(:'u5', :'ta', :'z5dm', 'one more')#>>'{message,id}' AS qn \gset
SELECT pg_temp.check(:'dcx'='true' AND :'scx'='true' AND (:'ac')::jsonb->>'ok'='true'
 AND pg_temp.accept(:'ta', :'u5', :'z5dm', :'qn', 'zion', 'dm', pg_temp.tok('C2'))->>'code'='rate_limited',
 'acceptance: the outcome turn is the 30th start in the hour, so the next turn is rate_limited (outcome turns count toward the cap)');
\echo 'PASS: acceptance: accepted_at on a new turn, a repeat and a re-arm; outcome turns only for a settled card and counted toward the 30 per hour'

-- 7. Mutants: each weakens one guard, and the property it protects is re-probed. A mutant that does not
-- change the body it names stops the run.
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
CREATE FUNCTION pg_temp.mutate(fn regprocedure, old text, new text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE body text:=pg_get_functiondef(fn);
BEGIN
 IF (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'mutant does not match % exactly once', fn; END IF;
 EXECUTE replace(body,old,new);
END $$;
CREATE TEMP TABLE mutant_results(mutant text PRIMARY KEY, guarded boolean);
CREATE FUNCTION pg_temp.post_sig() RETURNS regprocedure LANGUAGE sql AS $$ SELECT 'public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)'::regprocedure $$;
CREATE FUNCTION pg_temp.decide_sig() RETURNS regprocedure LANGUAGE sql AS $$ SELECT 'public.team_hub_decide_card(uuid,uuid,text,text)'::regprocedure $$;
CREATE FUNCTION pg_temp.states_sig() RETURNS regprocedure LANGUAGE sql AS $$ SELECT 'public.team_hub_card_states(uuid,uuid,uuid[])'::regprocedure $$;
-- A fresh accepted turn in Person 2's ZION DM, for the link probes.
SELECT pg_temp.post(:'u2', :'ta', :'zdm', 'Mutant probe')#>>'{message,id}' AS qm \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_cancel_task', 'mutant early', clock_timestamp()-interval '1 second') AS m_early \gset
SELECT pg_temp.accept(:'ta', :'u2', :'zdm', :'qm', 'zion', 'dm', pg_temp.tok('M'))->>'ok' AS am \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'crm_cancel_task', 'mutant thread', clock_timestamp(), gen_random_uuid()) AS m_thread \gset
SELECT pg_temp.proposal(:'u2', :'ta', 'growth_page_publish', 'mutant scope') AS m_scope \gset
CREATE FUNCTION pg_temp.mlink(conf text, kind text DEFAULT 'task_cancel') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.apost('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-00000000000a',
  (SELECT id::text FROM public.team_hub_channels WHERE dm_key='agent:zion:10000000-0000-4000-8000-000000000002'),
  'zion','Mutant card',gen_random_uuid()::text,NULL,(SELECT id::text FROM public.team_hub_messages WHERE body='Mutant probe'),'dm',pg_temp.tok('M'),conf,kind) $$;
-- An approved, unsettled card with an outcome turn written directly (the acceptance door would refuse it).
SELECT pg_temp.make_card(:'u2', :'ta', :'zdm', 'zion', 'crm_cancel_task', 'task_cancel', 'mutant unsettled') AS mu \gset
SELECT pg_temp.decide(:'u2', :'ta', (:'mu')::jsonb->>'card', 'approve', (:'mu')::jsonb->>'fp')->>'ok' AS dmu \gset
INSERT INTO public.team_hub_agent_turns(tenant_id,channel_id,asker_user_id,source_message_id,agent_key,intent,token_hash,accepted_at,attempts)
 VALUES (:'ta', :'zdm', :'u2', ((:'mu')::jsonb->>'q')::uuid, 'zion', 'outcome:'||((:'mu')::jsonb->>'card'), pg_temp.h(pg_temp.tok('MU')), now(), ARRAY[now()]);
-- A plain agent reply in the same DM, with no card, for the storage probes.
SELECT pg_temp.post(:'u2', :'ta', :'zdm', 'Plain question')#>>'{message,id}' AS qp \gset
SELECT pg_temp.accept(:'ta', :'u2', :'zdm', :'qp', 'zion', 'dm', pg_temp.tok('P'))->>'ok' AS ap \gset
SELECT pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Plain answer', gen_random_uuid()::text, NULL, :'qp', 'dm', pg_temp.tok('P'))#>>'{message,id}' AS plain \gset
SELECT pg_temp.check(:'am'='true' AND :'dmu'='true' AND :'ap'='true' AND :'plain'<>'', 'mutants: probes set up');

-- K1: decide skips approver = actor.
BEGIN;
SELECT pg_temp.mutate(pg_temp.decide_sig(), $m$ IF card.approver_user_id<>actor THEN RETURN jsonb_build_object('ok',false,'code','not_yours'); END IF;$m$, '');
SELECT pg_temp.peek(:'zdm', :'ta', :'u3');
SELECT coalesce(pg_temp.decide(:'u3', :'ta', (:'wx')::jsonb->>'card', 'approve', (:'wx')::jsonb->>'fp')->>'code'='not_yours',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K1 decide by a non-approver', :'g');
-- K2: declined derived from consumed_at, not from the stored decision.
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), $m$WHEN k.decision='declined' THEN 'declined'$m$, $m$WHEN p.consumed_at IS NOT NULL THEN 'declined'$m$);
SELECT coalesce(pg_temp.cs(pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[:'card1']), :'card1')#>>'{card,state}'='done',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K2 declined read from consumed_at', :'g');
-- K3: the fingerprint to anyone who can read the card.
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), $m$WHEN s.approver_user_id=actor AND s.state='waiting'$m$, $m$WHEN s.state='waiting'$m$);
SELECT pg_temp.peek(:'zdm', :'ta', :'u3');
SELECT coalesce(NOT (pg_temp.cs(pg_temp.cstates(:'u3', :'ta', :'zdm', ARRAY[(:'wx')::jsonb->>'card']), (:'wx')::jsonb->>'card')#>'{card,actions,0}' ? 'fingerprint'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K3 fingerprint to a non-approver', :'g');
-- K4: the proposal's arguments in the states JSON.
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), $m$jsonb_build_object('summary',s.summary)$m$,
 $m$jsonb_build_object('summary',s.summary,'args',(SELECT x.args FROM public.paige_pending_confirmations x WHERE x.fingerprint=s.fingerprint LIMIT 1))$m$);
SELECT pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[(:'wx')::jsonb->>'card']) AS mk4 \gset
SELECT coalesce(NOT ('args'=ANY(pg_temp.all_keys((:'mk4')::jsonb))) AND position('ARGS-' IN (:'mk4'))=0,false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K4 arguments in the states read', :'g');
-- K5: the proposal need not be minted in this turn.
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$ AND p.server_issued_at>=turn.accepted_at$m$, '');
SELECT coalesce(pg_temp.mlink(:'m_early')->>'code'='invalid',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K5 proposal from before the turn', :'g');
-- K6: a proposal minted inside a chat thread is linkable.
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$    AND p.thread_id IS NULL
$m$, '');
SELECT coalesce(pg_temp.mlink(:'m_thread')->>'code'='invalid',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K6 thread_id set', :'g');
-- K7: the agent's stored DM scope not checked.
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$     OR NOT (CASE WHEN$m$, $m$     OR false AND NOT (CASE WHEN$m$);
SELECT coalesce(pg_temp.mlink(:'m_scope','page_publish')->>'code'='invalid',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K7 scope not checked', :'g');
-- K8: decide skips the conversation's visibility.
BEGIN;
SELECT pg_temp.mutate(pg_temp.decide_sig(), $m$   OR NOT EXISTS(SELECT 1 FROM public._team_hub_visible(p_expected_tenant,actor,card.channel_id))
$m$, '');
SELECT coalesce(pg_temp.decide(:'u3', :'ta', (:'wx')::jsonb->>'card', 'approve', (:'wx')::jsonb->>'fp')->>'code'='not_found',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K8 decide without visibility', :'g');
-- K9: approve consumes the proposal (the door's own claim would then find nothing to run).
BEGIN;
SELECT pg_temp.mutate(pg_temp.decide_sig(), $m$ UPDATE public.team_hub_message_cards k SET decision='approved'$m$,
 $m$ UPDATE public.paige_pending_confirmations p SET consumed_at=clock_timestamp() WHERE p.id=conf.id;
 UPDATE public.team_hub_message_cards k SET decision='approved'$m$);
SELECT pg_temp.decide(:'u2', :'ta', (:'wx')::jsonb->>'card', 'approve', (:'wx')::jsonb->>'fp')->>'decision' AS k9 \gset
SELECT coalesce(:'k9'='approved' AND (SELECT consumed_at IS NULL FROM public.paige_pending_confirmations WHERE id=((:'wx')::jsonb->>'conf')::uuid),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K9 approve consumes', :'g');
-- K10: no UNIQUE on confirmation_id (two cards for one proposal).
BEGIN;
ALTER TABLE public.team_hub_message_cards DROP CONSTRAINT team_hub_message_cards_confirmation_key;
SELECT coalesce(pg_temp.raw_card(:'plain', :'ta', :'zdm', :'u2', (:'wx')::jsonb->>'conf') LIKE '%team_hub_message_cards_confirmation_key%',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K10 no UNIQUE proposal link', :'g');
-- K11: an outcome posted before it is settled.
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$    OR card.outcome IS NULL
$m$, '');
SELECT pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Done?', gen_random_uuid()::text, (:'mu')::jsonb->>'card', NULL,
 'outcome:'||((:'mu')::jsonb->>'card'), pg_temp.tok('MU')) AS k11 \gset
\echo 'K11 under the mutant:' :'k11'
SELECT coalesce((:'k11')::jsonb->>'code'='invalid',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K11 outcome without settle', :'g');
-- K11b: the same, with the storage CHECK (the second line, which K11 meets) also gone: an outcome is
-- then posted and recorded on a card nobody settled.
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$    OR card.outcome IS NULL
$m$, '');
ALTER TABLE public.team_hub_message_cards DROP CONSTRAINT team_hub_message_cards_state_chk;
SELECT pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Done?', gen_random_uuid()::text, (:'mu')::jsonb->>'card', NULL,
 'outcome:'||((:'mu')::jsonb->>'card'), pg_temp.tok('MU')) AS k11b \gset
SELECT coalesce((:'k11b')::jsonb->>'code'='invalid' AND (SELECT outcome_message_id IS NULL FROM public.team_hub_message_cards
 WHERE message_id=((:'mu')::jsonb->>'card')::uuid),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K11b outcome without settle, no storage CHECK', :'g');
-- K12: an inactive approver's card reads waiting.
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), $m$WHEN NOT a.active OR p.id IS NULL THEN 'expired'$m$, $m$WHEN p.id IS NULL THEN 'expired'$m$);
SELECT pg_temp.peek(:'zdm', :'ta', :'u3');
SELECT pg_temp.seat(:'ta', :'u2', 'suspended');
SELECT coalesce(pg_temp.cs(pg_temp.cstates(:'u3', :'ta', :'zdm', ARRAY[(:'wx')::jsonb->>'card']), (:'wx')::jsonb->>'card')#>>'{card,state}'='expired',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K12 inactive approver reads waiting', :'g');
-- K13: no storage scope guard.
BEGIN;
DROP TRIGGER team_hub_card_scope ON public.team_hub_message_cards;
SELECT coalesce(pg_temp.raw_card(:'bmsg', :'ta', :'zdm', :'u2', :'c_raw') LIKE 'TEAM_HUB_CARD_SCOPE%',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K13 no scope trigger', :'g');
-- K14: settle 'failed' leaves a live proposal live.
BEGIN;
SELECT pg_temp.mutate('public.team_hub_settle_card(uuid,uuid,jsonb)'::regprocedure, $m$ IF state='failed' THEN$m$, $m$ IF false THEN$m$);
SELECT pg_temp.decide(:'u2', :'ta', (:'wx')::jsonb->>'card', 'approve', (:'wx')::jsonb->>'fp')->>'ok' AS k14a \gset
SELECT pg_temp.settle(:'u2', :'ta', (:'wx')::jsonb->>'card', '{"state":"failed"}')->>'ok' AS k14b \gset
SELECT coalesce(:'k14a'='true' AND :'k14b'='true' AND (SELECT consumed_at IS NOT NULL FROM public.paige_pending_confirmations WHERE id=((:'wx')::jsonb->>'conf')::uuid),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K14 failed leaves the proposal live', :'g');
-- K15: decline does not consume (the door could still run a declined card).
BEGIN;
SELECT pg_temp.mutate(pg_temp.decide_sig(), $m$  UPDATE public.paige_pending_confirmations p SET consumed_at=clock_timestamp() WHERE p.id=conf.id AND p.consumed_at IS NULL;
$m$, '');
SELECT pg_temp.decide(:'u2', :'ta', (:'wx')::jsonb->>'card', 'decline', (:'wx')::jsonb->>'fp')->>'decision' AS k15 \gset
SELECT coalesce(:'k15'='declined' AND (SELECT consumed_at IS NOT NULL FROM public.paige_pending_confirmations WHERE id=((:'wx')::jsonb->>'conf')::uuid),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('K15 decline does not consume', :'g');

-- The migration's own guard: run on its own, it accepts the bodies as they are now (this file's) and
-- refuses a dependency or a replaced body that differs.
\set guardsql `sed -n '/^DO \$guard\$/,/^END \$guard\$;/p' supabase/migrations/20271121140008_exp08_team_hub_a2b_cards.sql`
SELECT pg_temp.try(:'guardsql') AS gd0 \gset
BEGIN;
SELECT pg_temp.mutate('public._team_hub_participates(uuid,uuid)'::regprocedure, 'AND m.team_hub_access)', 'AND m.team_hub_access) -- drift');
SELECT pg_temp.try(:'guardsql') AS gd1 \gset
ROLLBACK;
BEGIN;
SELECT pg_temp.mutate('public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure, $m$'accepted_at',turn.accepted_at); -- A2b: accepted_at
END$m$, $m$'accepted_at',turn.accepted_at,'drift',1); -- A2b: accepted_at
END$m$);
SELECT pg_temp.try(:'guardsql') AS gd2 \gset
ROLLBACK;
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$ RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg));
END$m$, $m$ RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'drift',1);
END$m$);
SELECT pg_temp.try(:'guardsql') AS gd3 \gset
ROLLBACK;
SELECT pg_temp.check(length(:'guardsql')>500 AND :'gd0'='ran'
 AND :'gd1' LIKE 'Team Hub A2b dependency public._team_hub_participates(uuid,uuid) changed%'
 AND :'gd2' LIKE 'Team Hub A2b source public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) changed%'
 AND :'gd3' LIKE 'Team Hub A2b source team_hub_post_agent_message changed%',
 'the migration''s md5 guard accepts its own bodies and refuses a drifted dependency, acceptance door or post door: '||:'gd0'||' / '||:'gd1'||' / '||:'gd2'||' / '||:'gd3');
\echo 'PASS: the migration''s md5(prosrc) guard accepts the bodies it was written against (or its own) and refuses a drifted dependency, acceptance door or post door'

-- Controls: every probe holds on the unmutated migration.
BEGIN;
SELECT pg_temp.peek(:'zdm', :'ta', :'u3');
SELECT (pg_temp.decide(:'u3', :'ta', (:'wx')::jsonb->>'card', 'approve', (:'wx')::jsonb->>'fp')->>'code'='not_yours'
 AND NOT (pg_temp.cs(pg_temp.cstates(:'u3', :'ta', :'zdm', ARRAY[(:'wx')::jsonb->>'card']), (:'wx')::jsonb->>'card')#>'{card,actions,0}' ? 'fingerprint')) AS c1 \gset
SELECT pg_temp.seat(:'ta', :'u2', 'suspended');
SELECT (pg_temp.cs(pg_temp.cstates(:'u3', :'ta', :'zdm', ARRAY[(:'wx')::jsonb->>'card']), (:'wx')::jsonb->>'card')#>>'{card,state}'='expired') AS c2 \gset
ROLLBACK;
-- (Each write and the read that checks it are separate statements: a statement reads the rows as they
-- were when it began.)
BEGIN;
SELECT pg_temp.decide(:'u2', :'ta', (:'wx')::jsonb->>'card', 'approve', (:'wx')::jsonb->>'fp')->>'decision'='approved' AS c3a \gset
SELECT (SELECT consumed_at IS NULL FROM public.paige_pending_confirmations WHERE id=((:'wx')::jsonb->>'conf')::uuid) AS c3b \gset
SELECT pg_temp.settle(:'u2', :'ta', (:'wx')::jsonb->>'card', '{"state":"failed"}')->>'ok'='true' AS c3c \gset
SELECT (SELECT consumed_at IS NOT NULL FROM public.paige_pending_confirmations WHERE id=((:'wx')::jsonb->>'conf')::uuid) AS c3d \gset
ROLLBACK;
SELECT (:'c3a' AND :'c3b' AND :'c3c' AND :'c3d') AS c3 \gset
BEGIN;
SELECT pg_temp.decide(:'u2', :'ta', (:'wx')::jsonb->>'card', 'decline', (:'wx')::jsonb->>'fp')->>'decision'='declined' AS c4a \gset
SELECT (SELECT consumed_at IS NOT NULL FROM public.paige_pending_confirmations WHERE id=((:'wx')::jsonb->>'conf')::uuid) AS c4b \gset
ROLLBACK;
SELECT (:'c4a' AND :'c4b') AS c4 \gset
BEGIN;
SELECT (pg_temp.raw_card(:'plain', :'ta', :'zdm', :'u2', (:'wx')::jsonb->>'conf') LIKE '%team_hub_message_cards_confirmation_key%'
 AND pg_temp.raw_card(:'bmsg', :'ta', :'zdm', :'u2', :'c_raw') LIKE 'TEAM_HUB_CARD_SCOPE%') AS c5 \gset
ROLLBACK;
SELECT pg_temp.check(:'c1' AND :'c2' AND :'c3' AND :'c4' AND :'c5'
 AND pg_temp.decide(:'u3', :'ta', (:'wx')::jsonb->>'card', 'approve', (:'wx')::jsonb->>'fp')->>'code'='not_found'
 AND pg_temp.cs(pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[:'card1']), :'card1')#>>'{card,state}'='done'
 AND NOT ('args'=ANY(pg_temp.all_keys(pg_temp.cstates(:'u2', :'ta', :'zdm', ARRAY[(:'wx')::jsonb->>'card']))))
 AND pg_temp.mlink(:'m_early')->>'code'='invalid' AND pg_temp.mlink(:'m_thread')->>'code'='invalid'
 AND pg_temp.mlink(:'m_scope','page_publish')->>'code'='invalid'
 AND pg_temp.apost(:'u2', :'ta', :'zdm', 'zion', 'Done?', gen_random_uuid()::text, (:'mu')::jsonb->>'card', NULL,
  'outcome:'||((:'mu')::jsonb->>'card'), pg_temp.tok('MU'))->>'code'='invalid',
 'mutants: every probe holds on the unmutated migration (controls)');
\o
SELECT mutant, guarded AS probe_still_holds FROM mutant_results ORDER BY mutant;
\o /dev/null
SELECT pg_temp.check((SELECT count(*) FROM mutant_results)=16 AND NOT EXISTS(SELECT 1 FROM mutant_results WHERE guarded IS NOT FALSE),
 'mutants: all 16 weakened guards break the property they protect: '||(SELECT string_agg(mutant||'='||coalesce(guarded::text,'null'), '; ' ORDER BY mutant) FROM mutant_results));
\echo 'PASS: 16 of 16 mutants (decide by a non-approver, declined read from consumed_at, fingerprint to a non-approver, arguments in the states read, a proposal from before the turn, a proposal in a chat thread, the agent scope unchecked, decide without visibility, approve consuming, no UNIQUE proposal link, an outcome before settle (door alone, and door with the storage CHECK gone), an inactive approver reading waiting, no scope trigger, failed leaving the proposal live, decline not consuming) each fail their probe; controls hold'

RESET ROLE;
\c postgres
DROP DATABASE exp08_team_hub_a2b_proof;
\echo 'PASS: EXP08 Team Hub agents A2b proof complete; disposable database dropped'
