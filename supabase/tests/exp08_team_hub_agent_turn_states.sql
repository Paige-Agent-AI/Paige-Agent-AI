-- EXP08 Team Hub agents, A1b part 3: the member-safe turn-state read, staged Bring in suggestions,
-- and the same-token acceptance retry.
-- Migration: supabase/migrations/20271119010008_exp08_team_hub_agent_turn_states.sql.
-- Contract: docs/delivery/exp08-team-hub-agents-contract.md, "A1b part 3 notes".
-- Disposable PostgreSQL only. Never target the linked project. The proof runs in a database it creates
-- and drops.
--
-- WHAT IS REAL AND WHAT IS A DOUBLE. The setup and the incumbent chain (everything before section 1)
-- are copied verbatim from supabase/tests/exp08_team_hub_agents_a1.sql lines 17-720, which documents
-- what in them is real (production bodies, md5-checked) and what is a double. Then the real A1a
-- migration (20271117010008), and the migration under test. team_hub_accept_agent_turn and the
-- helpers the new doors call are md5(prosrc)-checked against production (read 2026-10-27) before the
-- change. Synthetic people and ids only.
-- ── Setup, copied verbatim from supabase/tests/exp08_team_lifecycle.sql (lines 25-717) ──
\set ON_ERROR_STOP on
\set QUIET on
DROP DATABASE IF EXISTS exp08_team_hub_agent_turn_states_proof;
CREATE DATABASE exp08_team_hub_agent_turn_states_proof;
\c exp08_team_hub_agent_turn_states_proof
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

-- 1. The doors this change re-emits or calls are production's bodies (md5(prosrc), read 2026-10-27).
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)','85def4429d1fd40fad8d6e76dbfa5f61'),
   ('team_hub_end_agent_turn(uuid,text)','a8643f30da5aa83611e79526d5799f3a'),
   ('team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)','c6930cf3329da4c0db6a8390f1564eaa'),
   ('_team_hub_refusal(uuid)','b6ee98245fdbb9e0229547061a9391d2'),
   ('_team_hub_visible(uuid,uuid,uuid)','28a7e5c90f2a29b19b4481c4850a414f'),
   ('_team_hub_is_active(uuid,uuid)','c290399dc80d95d16116a0f88b0abd8c')) v(sig, prod_md5)
 LOOP
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=('public.'||r.sig)::regprocedure) IS DISTINCT FROM r.prod_md5 THEN
   RAISE EXCEPTION 'FAIL: % is not the production body', r.sig; END IF;
 END LOOP;
END $$;
\echo 'PASS: before the change, the acceptance, end and post doors and the three helpers are production''s bodies (md5(prosrc), 6 of 6)'
CREATE TEMP TABLE before_src AS SELECT p.oid::regprocedure::text AS sig, p.proname::text AS name, p.prosrc AS src
 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team_hub%';

-- 2. The change, then a second apply: a no-op.
\ir ../migrations/20271119010008_exp08_team_hub_agent_turn_states.sql
CREATE TEMP VIEW states_state AS
SELECT 'fn:'||p.oid::regprocedure::text AS k, concat_ws('|', p.proacl::text, p.prosecdef::text, p.provolatile::text, p.proconfig::text, md5(p.prosrc)) AS v
 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team_hub%'
UNION ALL
SELECT 'con:'||c.conname, pg_get_constraintdef(c.oid)||'|'||c.convalidated FROM pg_constraint c WHERE c.conrelid='public.team_hub_agent_turns'::regclass
UNION ALL
SELECT 'col:'||a.attname, format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull FROM pg_attribute a
 WHERE a.attrelid='public.team_hub_agent_turns'::regclass AND a.attnum>0 AND NOT a.attisdropped
UNION ALL
SELECT 'rel:'||c.relname, concat_ws('|', c.relacl::text, c.relrowsecurity::text) FROM pg_class c
 WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND c.relname LIKE 'team_hub%';
CREATE TEMP TABLE states_before AS SELECT * FROM states_state;
\ir ../migrations/20271119010008_exp08_team_hub_agent_turn_states.sql
DO $$ BEGIN
 IF EXISTS(SELECT k,v FROM states_before EXCEPT SELECT k,v FROM states_state)
   OR EXISTS(SELECT k,v FROM states_state EXCEPT SELECT k,v FROM states_before) THEN
  RAISE EXCEPTION 'FAIL: a second apply changed a function, constraint, column or grant'; END IF;
END $$;
\echo 'PASS: the migration applies over the A1a chain; a second apply is a no-op (functions, constraints, columns, grants, RLS)'

-- 3. Byte identity: team_hub_accept_agent_turn with only its two A1b hunks undone is production's body;
-- every other team_hub function of the chain is untouched.
DO $$ DECLARE now_src text; undone text; changed text[]; BEGIN
 SELECT prosrc INTO now_src FROM pg_proc WHERE oid='public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure;
 undone:=replace(replace(now_src,
  $h$  -- A1b: the same token again is the same edge invocation retrying an acceptance whose answer it lost
  -- (a transport error). It gets its own turn back, counted once; any other token still waits.
  IF turn.consumed_at IS NULL AND turn.token_hash=p_token_hash AND turn.channel_id=ch.id THEN
   RETURN jsonb_build_object('ok',true,'turn_id',turn.id,'repeated',true); END IF;
$h$, ''),
  $h$  -- A1b: a re-armed turn starts with no suggestions (suggestions=NULL).
  UPDATE public.team_hub_agent_turns t SET token_hash=p_token_hash, accepted_at=now(), consumed_at=NULL, suggestions=NULL,
$h$, $h$  UPDATE public.team_hub_agent_turns t SET token_hash=p_token_hash, accepted_at=now(), consumed_at=NULL,
$h$);
 IF md5(undone)<>'85def4429d1fd40fad8d6e76dbfa5f61' OR undone=now_src THEN
  RAISE EXCEPTION 'FAIL: outside its two A1b hunks, team_hub_accept_agent_turn differs from production'; END IF;
 SELECT array_agg(b.name ORDER BY b.name) INTO changed FROM before_src b
  JOIN pg_proc p ON p.oid=b.sig::regprocedure WHERE p.prosrc<>b.src;
 IF changed IS DISTINCT FROM ARRAY['team_hub_accept_agent_turn'] THEN RAISE EXCEPTION 'FAIL: the functions that changed are %', changed; END IF;
END $$;
\echo 'PASS: byte identity: team_hub_accept_agent_turn with only its two A1b hunks undone is production''s md5; every other team_hub function is unchanged'

-- 4. Structure and grants.
DO $$ BEGIN
 IF NOT has_function_privilege('authenticated','public.team_hub_agent_turn_states(uuid,uuid,uuid[])','EXECUTE')
   OR has_function_privilege('anon','public.team_hub_agent_turn_states(uuid,uuid,uuid[])','EXECUTE')
   OR has_function_privilege('service_role','public.team_hub_agent_turn_states(uuid,uuid,uuid[])','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: team_hub_agent_turn_states must be executable by authenticated only'; END IF;
 IF NOT has_function_privilege('service_role','public.team_hub_stage_agent_suggestions(uuid,text,jsonb)','EXECUTE')
   OR has_function_privilege('anon','public.team_hub_stage_agent_suggestions(uuid,text,jsonb)','EXECUTE')
   OR has_function_privilege('authenticated','public.team_hub_stage_agent_suggestions(uuid,text,jsonb)','EXECUTE')
   OR NOT has_function_privilege('service_role','public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)','EXECUTE')
   OR has_function_privilege('authenticated','public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: the staging and acceptance doors must be executable by the service role only'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['team_hub_agent_turn_states(uuid,uuid,uuid[])','team_hub_stage_agent_suggestions(uuid,text,jsonb)',
     'team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)']) f
   WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=('public.'||f)::regprocedure AND p.prosecdef AND p.proconfig[1]='search_path=""')
    OR EXISTS(SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
     WHERE p.oid=('public.'||f)::regprocedure AND a.grantee=0)) THEN
  RAISE EXCEPTION 'FAIL: a door is not SECURITY DEFINER on an empty search_path, or PUBLIC can execute it'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.team_hub_agent_turns'::regclass)
   OR EXISTS(SELECT 1 FROM pg_policies WHERE tablename='team_hub_agent_turns')
   OR has_table_privilege('authenticated','public.team_hub_agent_turns','SELECT,INSERT,UPDATE,DELETE')
   OR has_table_privilege('anon','public.team_hub_agent_turns','SELECT,INSERT,UPDATE,DELETE') THEN
  RAISE EXCEPTION 'FAIL: team_hub_agent_turns must stay RLS-on with no policy and no browser grant'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_agent_turns'::regclass
   AND conname='team_hub_agent_turns_suggestions_chk' AND convalidated) THEN
  RAISE EXCEPTION 'FAIL: the suggestions CHECK is missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team_hub%'
   AND (p.prosrc ~* '(paige_orchestrator|delegate_to_subagent|file_action|advance_action|approval|calendar|booking)'
    OR p.prosrc ILIKE '%is_tenant_member%')) THEN
  RAISE EXCEPTION 'FAIL: a team_hub body names a delegation, approval, calendar or booking path'; END IF;
END $$;
\echo 'PASS: structure: the state read authenticated-only, staging and acceptance service-role-only, all SECURITY DEFINER on an empty search_path; the turn table stays RLS-on with no grant; the incumbent body guards hold'

-- 5. Behaviour. Helpers copied from exp08_team_hub_agents_a1.sql section 5 (lines 1000-1027), plus the two new doors.
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
CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.h(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(t,'UTF8')),'hex') $$;
CREATE FUNCTION pg_temp.tok(n text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'turn-token-'||n||'-'||repeat('k',32) $$;
-- The edge function's call: service role, no user JWT.
CREATE FUNCTION pg_temp.accept(tenant text, asker text, channel text, src text, agent text, intent text, token text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(NULL, format('public.team_hub_accept_agent_turn(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)',
  tenant, asker, channel, src, agent, intent, pg_temp.h(token)), 'service_role') $$;
CREATE FUNCTION pg_temp.post(actor text, tenant text, channel text, body text, agents text DEFAULT '{}', parent text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_post_message(%L::uuid,%L::uuid,%L,gen_random_uuid(),%L::uuid,''{}''::uuid[],''{}''::uuid[],%L::text[])',
  tenant, channel, body, parent, agents)) $$;
CREATE FUNCTION pg_temp.agent_post(actor text, tenant text, channel text, agent text, body text, crid text, parent text, asked text,
 intent text, token text, private boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_post_agent_message(%L::uuid,%L::uuid,%L,%L,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L::boolean)',
  tenant, channel, agent, body, crid, parent, asked, intent, token, private)) $$;
CREATE FUNCTION pg_temp.states(actor text, tenant text, channel text, ids text[]) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_agent_turn_states(%L::uuid,%L::uuid,%L::uuid[])', tenant, channel, ids)) $$;
-- One (message, agent) row of a state read, or null.
CREATE FUNCTION pg_temp.st(r jsonb, msg text, agent text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT x FROM jsonb_array_elements(r->'states') x WHERE x->>'message_id'=msg AND x->>'agent_key'=agent $$;
CREATE FUNCTION pg_temp.stage(turn text, token text, s jsonb, as_role text DEFAULT 'service_role', actor text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_stage_agent_suggestions(%L::uuid,%L,%L::jsonb)', turn, pg_temp.h(token), s), as_role) $$;
CREATE FUNCTION pg_temp.end_turn(turn text, token text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(NULL, format('public.team_hub_end_agent_turn(%L::uuid,%L)', turn, pg_temp.h(token)), 'service_role') $$;

-- People in Workspace A: u1 owner, u2 and u5 members, u3 admin. u7 owns Workspace B.
SELECT pg_temp.j(:'u1', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'ta','launch','team','{}'))->>'channel_id' AS launch \gset
SELECT pg_temp.check(pg_temp.j(u, format('public.team_hub_join_channel(%L::uuid,%L::uuid)', :'ta', :'launch'))->>'ok'='true', 'setup: a teammate joins #launch')
 FROM unnest(ARRAY[:'u2', :'u3', :'u5']) u;
SELECT pg_temp.j(:'u1', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'ta','board','private',
 format('{%s}', :'u2')))->>'channel_id' AS board \gset
SELECT pg_temp.check(:'launch'<>'' AND :'board'<>'', 'setup: #launch (team) and #board (private: the owner and Sam) exist');
SELECT pg_temp.j(:'u2', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'merit'))->>'channel_id' AS merit_dm \gset
SELECT pg_temp.j(:'u2', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'vera'))->>'channel_id' AS vera_dm \gset
SELECT pg_temp.check(:'merit_dm'<>'' AND :'vera_dm'<>'', 'setup: u2 opens agent DMs with MERIT and VERA');

-- 5a. A question nobody has started: the asker reads none; everyone else reads nothing.
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@CURA @ZION who is onboarding this week?', '{cura,zion}')#>>'{message,id}' AS q1 \gset
SELECT pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q1']) AS s \gset
SELECT pg_temp.check((:'s')::jsonb->>'ok'='true' AND pg_temp.st(:'s', :'q1', 'cura') = jsonb_build_object('message_id',:'q1','agent_key','cura','state','none','private_part',false,'asker_name','Person 2')
 AND pg_temp.st(:'s', :'q1', 'zion')->>'state'='none' AND jsonb_array_length((:'s')::jsonb->'states')=2,
 'unstarted: the asker reads one row per asked agent, state none, and only (message_id, agent_key, state, private_part, asker_name)');
SELECT pg_temp.check(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1'])->'states'='[]'::jsonb
 AND pg_temp.states(:'u1', :'ta', :'launch', ARRAY[:'q1'])->'states'='[]'::jsonb,
 'unstarted: another member and the owner read nothing about Sam''s question');

-- 5b. Running, and the same-token acceptance retry.
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q1', 'cura', 'reply', pg_temp.tok('C1')) AS a1 \gset
SELECT (:'a1')::jsonb->>'turn_id' AS t1 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q1', 'cura', 'reply', pg_temp.tok('C1')) AS a1r \gset
SELECT pg_temp.check((:'a1')::jsonb->>'ok'='true' AND (:'a1r')::jsonb @> jsonb_build_object('ok',true,'turn_id',:'t1','repeated',true)
 AND (SELECT cardinality(attempts) FROM public.team_hub_agent_turns WHERE id=:'t1')=1
 AND pg_temp.accept(:'ta', :'u2', :'launch', :'q1', 'cura', 'reply', pg_temp.tok('C1-other'))->>'code'='in_flight'
 AND (SELECT token_hash FROM public.team_hub_agent_turns WHERE id=:'t1')=pg_temp.h(pg_temp.tok('C1')),
 'acceptance retried with the same token returns the same turn, counted once; another token still answers in_flight and changes nothing');
SELECT pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q1']) AS s \gset
SELECT pg_temp.check(pg_temp.st(:'s', :'q1', 'cura')->>'state'='answering' AND pg_temp.st(:'s', :'q1', 'zion')->>'state'='none'
 AND pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1'])->'states'='[]'::jsonb,
 'running: the asker reads answering for CURA (ZION still none); another member reads nothing');

-- 5c. Staging Bring in: validated in the body, the turn's own token, service role only.
SELECT pg_temp.check(pg_temp.stage(:'t1', pg_temp.tok('C1'), '[{"agent":"cura","context":"self"}]')->>'code'='invalid'
 AND pg_temp.stage(:'t1', pg_temp.tok('C1'), '[{"agent":"zion","context":"already asked"}]')->>'code'='invalid'
 AND pg_temp.stage(:'t1', pg_temp.tok('C1'), '[{"agent":"bogus","context":"x"}]')->>'code'='invalid'
 AND pg_temp.stage(:'t1', pg_temp.tok('C1'), '[{"agent":"nexus","context":"a"},{"agent":"nexus","context":"b"}]')->>'code'='invalid'
 AND pg_temp.stage(:'t1', pg_temp.tok('C1'), '[{"agent":"nexus","context":"a"},{"agent":"vera","context":"b"},{"agent":"merit","context":"c"},{"agent":"mentor","context":"d"}]')->>'code'='invalid'
 AND pg_temp.stage(:'t1', pg_temp.tok('C1'), '[]')->>'code'='invalid'
 AND pg_temp.stage(:'t1', pg_temp.tok('C1'), '[{"agent":"nexus","context":"two\nlines"}]')->>'code'='invalid'
 AND pg_temp.stage(:'t1', pg_temp.tok('C1'), jsonb_build_array(jsonb_build_object('agent','nexus','context',repeat('x',201))))->>'code'='invalid'
 AND pg_temp.stage(:'t1', pg_temp.tok('C1'), '[{"agent":"nexus","context":"   "}]')->>'code'='invalid'
 AND pg_temp.stage(:'t1', pg_temp.tok('C1'), '[{"agent":"nexus","context":"x","extra":1}]')->>'code'='invalid'
 AND pg_temp.stage(:'t1', pg_temp.tok('C1'), '["nexus"]')->>'code'='invalid'
 AND pg_temp.stage(:'t1', pg_temp.tok('wrong'), '[{"agent":"nexus","context":"x"}]')->>'code'='not_found'
 AND pg_temp.stage(:'t1', pg_temp.tok('C1'), '[{"agent":"nexus","context":"x"}]', 'service_role', :'u2')->>'code'='not_allowed'
 AND pg_temp.stage(:'t1', pg_temp.tok('C1'), '[{"agent":"nexus","context":"x"}]', 'authenticated', :'u2')->>'error' LIKE 'permission denied%'
 AND pg_temp.stage(:'t1', pg_temp.tok('C1'), '[{"agent":"nexus","context":"x"}]', 'anon')->>'error' LIKE 'permission denied%',
 'staging refuses the replying agent, an agent the question already asks, an unknown, a repeat, four, none, a line break, 201 characters, blank, an extra key, a bare name, a wrong token, a user JWT, authenticated and anon');
SELECT pg_temp.check((SELECT suggestions IS NULL FROM public.team_hub_agent_turns WHERE id=:'t1'), 'staging: none of the refused calls wrote anything');
SELECT pg_temp.stage(:'t1', pg_temp.tok('C1'), '[{"agent":"nexus","context":" PAIGE suggested you take the welcome announcement. "},{"agent":"merit","context":"PAIGE suggested you take the agreement."}]')->>'ok' AS staged \gset
SELECT pg_temp.check(:'staged'='true'
 AND (SELECT suggestions FROM public.team_hub_agent_turns WHERE id=:'t1')='[{"agent":"nexus","context":"PAIGE suggested you take the welcome announcement."},{"agent":"merit","context":"PAIGE suggested you take the agreement."}]'::jsonb,
 'staging stores up to three suggestions in order, each context trimmed');
-- The reply posts. The asker reads replied with each suggestion's context; everyone else reads only who was suggested.
SELECT pg_temp.agent_post(:'u2', :'ta', :'launch', 'cura', 'Two people start Monday. @NEXUS can announce it.', gen_random_uuid()::text, NULL, :'q1', 'reply', pg_temp.tok('C1'))#>>'{message,id}' AS r1 \gset
SELECT pg_temp.check(pg_temp.stage(:'t1', pg_temp.tok('C1'), '[{"agent":"vera","context":"late"}]')->>'code'='not_found',
 'a consumed turn can no longer be staged');
SELECT pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q1']) AS s \gset
SELECT pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1']) AS so \gset
SELECT pg_temp.check(:'r1'<>'' AND pg_temp.st(:'s', :'q1', 'cura') = jsonb_build_object('message_id',:'q1','agent_key','cura','state','replied','private_part',false,'asker_name','Person 2',
   'bring_in','[{"agent":"nexus","context":"PAIGE suggested you take the welcome announcement."},{"agent":"merit","context":"PAIGE suggested you take the agreement."}]'::jsonb)
 AND pg_temp.st(:'so', :'q1', 'cura') = jsonb_build_object('message_id',:'q1','agent_key','cura','state','replied','private_part',false,'asker_name','Person 2',
   'bring_in','[{"agent":"nexus"},{"agent":"merit"}]'::jsonb)
 AND pg_temp.st(:'so', :'q1', 'zion') IS NULL,
 'posted: the asker reads replied with Bring in and its context; another member reads replied with the suggested agents only; ZION''s unstarted turn stays hidden from them');

-- 5d. Ended without a post, and a turn left running past 10 minutes: failed, the asker only.
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q1', 'zion', 'reply', pg_temp.tok('Z1'))->>'turn_id' AS tz \gset
SELECT pg_temp.check(pg_temp.end_turn(:'tz', pg_temp.tok('Z1'))->>'ok'='true'
 AND pg_temp.st(pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q1']), :'q1', 'zion')->>'state'='failed'
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1']), :'q1', 'zion') IS NULL,
 'ended without a post: the asker reads failed; another member reads nothing');
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@VERA how did September go?', '{vera}')#>>'{message,id}' AS q2 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q2', 'vera', 'reply', pg_temp.tok('V1'))->>'turn_id' AS tv \gset
UPDATE public.team_hub_agent_turns SET accepted_at=now()-interval '11 minutes', attempts=ARRAY[now()-interval '11 minutes'] WHERE id=:'tv';
SELECT pg_temp.check(pg_temp.st(pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q2']), :'q2', 'vera')->>'state'='failed',
 'a turn left running for more than 10 minutes reads failed, as acceptance takes it');

-- 5e. The private part (flow 5). Everyone who can read the reply reads the two approved lines; only the
-- asker reads a failure; no DM id, turn id or text ever appears.
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@MERIT what should I charge Hollis?', '{merit}')#>>'{message,id}' AS q3 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q3', 'merit', 'reply', pg_temp.tok('M1'))->>'turn_id' AS tm \gset
SELECT pg_temp.agent_post(:'u2', :'ta', :'launch', 'merit', 'Pricing depends on scope.', gen_random_uuid()::text, NULL, :'q3', 'reply', pg_temp.tok('M1'), true)#>>'{message,id}' AS r3 \gset
SELECT pg_temp.check(pg_temp.st(pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q3']), :'q3', 'merit') = jsonb_build_object('message_id',:'q3','agent_key','merit','state','none','private_part',true,'asker_name','Person 2')
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q3']), :'q3', 'merit') IS NULL,
 'a reply with a private part whose DM turn has not started: the asker reads none (private_part); another member reads nothing');
SELECT pg_temp.accept(:'ta', :'u2', :'merit_dm', :'q3', 'merit', 'dm', pg_temp.tok('M1dm'))->>'turn_id' AS tmd \gset
SELECT pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q3']) AS so \gset
SELECT pg_temp.states(:'u1', :'ta', :'launch', ARRAY[:'q3']) AS sw \gset
SELECT pg_temp.check(pg_temp.st(pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q3']), :'q3', 'merit')->>'state'='answering'
 AND pg_temp.st(:'so', :'q3', 'merit') = jsonb_build_object('message_id',:'q3','agent_key','merit','state','answering','private_part',true,'asker_name','Person 2')
 AND pg_temp.st(:'sw', :'q3', 'merit')->>'state'='answering'
 AND position(:'merit_dm' IN (:'so')::text)=0 AND position(:'tmd' IN (:'so')::text)=0 AND position(:'r3' IN (:'so')::text)=0
 AND position('charge' IN (:'so')::text)=0 AND position('Pricing' IN (:'so')::text)=0,
 'the DM turn running: the asker, another member and the owner read answering (private_part) with the asker''s name, and no DM id, turn id, reply id or text');
SELECT pg_temp.agent_post(:'u2', :'ta', :'merit_dm', 'merit', 'For Hollis: quote the 90-day outcome.', gen_random_uuid()::text, NULL, NULL, 'dm', pg_temp.tok('M1dm'))#>>'{message,id}' AS d3 \gset
SELECT pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q3']) AS so \gset
SELECT pg_temp.check(:'d3'<>'' AND pg_temp.st(pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q3']), :'q3', 'merit')->>'state'='replied_privately'
 AND pg_temp.st(:'so', :'q3', 'merit')->>'state'='replied_privately'
 AND position(:'d3' IN (:'so')::text)=0 AND position(:'merit_dm' IN (:'so')::text)=0 AND position('Hollis' IN (:'so')::text)=0,
 'the private answer posted: the asker and another member read replied_privately; the DM message, its id and its text never appear');
-- A failed private part: the asker only.
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@MERIT and the retainer?', '{merit}')#>>'{message,id}' AS q4 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q4', 'merit', 'reply', pg_temp.tok('M2'))->>'turn_id' AS tm2 \gset
SELECT pg_temp.check(pg_temp.agent_post(:'u2', :'ta', :'launch', 'merit', '', gen_random_uuid()::text, NULL, :'q4', 'reply', pg_temp.tok('M2'), true)->>'ok'='true', 'setup: a private-only reply');
SELECT pg_temp.accept(:'ta', :'u2', :'merit_dm', :'q4', 'merit', 'dm', pg_temp.tok('M2dm'))->>'turn_id' AS tm2d \gset
SELECT pg_temp.check(pg_temp.end_turn(:'tm2d', pg_temp.tok('M2dm'))->>'ok'='true'
 AND pg_temp.st(pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q4']), :'q4', 'merit')->>'state'='failed'
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q4']), :'q4', 'merit') IS NULL,
 'the DM turn ended without a post: the asker reads failed (private_part); another member reads nothing new');

-- 5f. An agent DM. Only its person can read it; the owner cannot.
SELECT pg_temp.post(:'u2', :'ta', :'vera_dm', 'What were last month''s numbers?', '{}')#>>'{message,id}' AS q5 \gset
SELECT pg_temp.check(pg_temp.st(pg_temp.states(:'u2', :'ta', :'vera_dm', ARRAY[:'q5']), :'q5', 'vera')->>'state'='none', 'agent DM: the asker reads none before the turn');
SELECT pg_temp.accept(:'ta', :'u2', :'vera_dm', :'q5', 'vera', 'dm', pg_temp.tok('V5'))->>'turn_id' AS tv5 \gset
SELECT pg_temp.check(pg_temp.st(pg_temp.states(:'u2', :'ta', :'vera_dm', ARRAY[:'q5']), :'q5', 'vera') = jsonb_build_object('message_id',:'q5','agent_key','vera','state','answering','private_part',false,'asker_name','Person 2')
 AND pg_temp.states(:'u1', :'ta', :'vera_dm', ARRAY[:'q5'])->>'code'='not_found'
 AND pg_temp.states(:'u1', :'ta', :'merit_dm', ARRAY[:'q3'])->>'code'='not_found'
 AND pg_temp.states(:'u3', :'ta', :'vera_dm', ARRAY[:'q5'])->>'code'='not_found'
 AND pg_temp.states(:'u1', :'ta', :'launch', ARRAY[:'q5'])->'states'='[]'::jsonb,
 'agent DM: the asker reads answering; the owner and another member are refused not_found on Sam''s DMs, and a DM question''s id read through #launch returns nothing');

-- 5g. Scope: a conversation the caller cannot see, another workspace, a removed person, ids from elsewhere, bad input.
SELECT pg_temp.post(:'u2', :'ta', :'board', '@MERIT board pricing?', '{merit}')#>>'{message,id}' AS q6 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'board', :'q6', 'merit', 'reply', pg_temp.tok('B6'))->>'turn_id' AS tb6 \gset
SELECT pg_temp.agent_post(:'u2', :'ta', :'board', 'merit', 'Depends.', gen_random_uuid()::text, NULL, :'q6', 'reply', pg_temp.tok('B6'), true)->>'ok' AS r6 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'merit_dm', :'q6', 'merit', 'dm', pg_temp.tok('B6dm'))->>'ok' AS r6dm \gset
SELECT pg_temp.check(:'r6'='true' AND :'r6dm'='true'
 AND pg_temp.st(pg_temp.states(:'u1', :'ta', :'board', ARRAY[:'q6']), :'q6', 'merit')->>'state'='answering'
 AND pg_temp.states(:'u3', :'ta', :'board', ARRAY[:'q6'])->>'code'='not_found'
 AND pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q6'])->'states'='[]'::jsonb
 AND pg_temp.states(:'u5', :'ta', :'launch', ARRAY[:'q6', :'q3'])->'states' = jsonb_build_array(pg_temp.st(pg_temp.states(:'u5', :'ta', :'launch', ARRAY[:'q3']), :'q3', 'merit')),
 'a private channel: its member (the owner) reads the private-part line; a non-member is refused not_found, and passing its question id through #launch returns nothing of it');
SELECT pg_temp.check(pg_temp.states(:'u7', :'ta', :'launch', ARRAY[:'q1'])->>'code'='scope_changed'
 AND pg_temp.states(:'u7', :'tb', :'launch', ARRAY[:'q1'])->>'code'='not_found'
 AND pg_temp.j(NULL, format('public.team_hub_agent_turn_states(%L::uuid,%L::uuid,%L::uuid[])', :'ta', :'launch', ARRAY[:'q1']), 'anon')->>'error' LIKE 'permission denied%'
 AND pg_temp.j(NULL, format('public.team_hub_agent_turn_states(%L::uuid,%L::uuid,%L::uuid[])', :'ta', :'launch', ARRAY[:'q1']), 'service_role')->>'error' LIKE 'permission denied%'
 AND pg_temp.states(:'u2', :'ta', :'launch', NULL)->>'code'='invalid'
 AND pg_temp.j(:'u2', format('public.team_hub_agent_turn_states(%L::uuid,%L::uuid,ARRAY[%L::uuid,NULL])', :'ta', :'launch', :'q1'))->>'code'='invalid'
 AND pg_temp.j(:'u2', format('public.team_hub_agent_turn_states(%L::uuid,%L::uuid,(SELECT array_agg(gen_random_uuid()) FROM generate_series(1,101)))', :'ta', :'launch'))->>'code'='invalid'
 AND pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'r1', :'d3'])->'states'='[]'::jsonb,
 'another workspace''s owner is refused (scope_changed, or not_found in their own), anon and the service role cannot execute, bad id lists are invalid, and agent messages or a DM message are never questions');
-- A removed person: refused; their question's private line is gone with their DM.
SELECT pg_temp.post(:'u5', :'ta', :'launch', '@MERIT my rate?', '{merit}')#>>'{message,id}' AS q7 \gset
SELECT pg_temp.accept(:'ta', :'u5', :'launch', :'q7', 'merit', 'reply', pg_temp.tok('R7'))->>'ok' AS a7 \gset
SELECT pg_temp.agent_post(:'u5', :'ta', :'launch', 'merit', '', gen_random_uuid()::text, NULL, :'q7', 'reply', pg_temp.tok('R7'), true)->>'ok' AS p7 \gset
SELECT pg_temp.j(:'u5', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'merit'))->>'channel_id' AS u5_dm \gset
SELECT pg_temp.accept(:'ta', :'u5', :'u5_dm', :'q7', 'merit', 'dm', pg_temp.tok('R7dm'))->>'ok' AS a7dm \gset
SELECT pg_temp.check(:'a7'='true' AND :'p7'='true' AND :'a7dm'='true'
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q7']), :'q7', 'merit') = jsonb_build_object('message_id',:'q7','agent_key','merit','state','answering','private_part',true,'asker_name','Person 5'),
 'setup: Marcus''s private part is answering, and another member reads it');
DELETE FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u5';
SELECT pg_temp.check(pg_temp.states(:'u5', :'ta', :'launch', ARRAY[:'q7'])->>'code'='not_member'
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q7']), :'q7', 'merit') IS NULL,
 'a removed person is refused not_member; their running private part is gone with their agent DM, so nobody reads a line about it');

-- 5h. A re-armed turn starts with no suggestions.
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@ZION plan the launch', '{zion}')#>>'{message,id}' AS q8 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q8', 'zion', 'reply', pg_temp.tok('Z8'))->>'turn_id' AS t8 \gset
SELECT pg_temp.stage(:'t8', pg_temp.tok('Z8'), '[{"agent":"nexus","context":"old"}]')->>'ok' AS st8 \gset
SELECT (SELECT suggestions IS NOT NULL FROM public.team_hub_agent_turns WHERE id=:'t8') AS had8 \gset
SELECT pg_temp.end_turn(:'t8', pg_temp.tok('Z8'))->>'ok' AS en8 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q8', 'zion', 'reply', pg_temp.tok('Z8b'))->>'rearmed' AS re8 \gset
SELECT pg_temp.check(:'st8'='true' AND :'had8'='t' AND :'en8'='true' AND :'re8'='true'
 AND (SELECT suggestions IS NULL FROM public.team_hub_agent_turns WHERE id=:'t8'),
 'a re-armed turn starts with no suggestions');
\echo 'PASS: states: unstarted, running, replied with Bring in (context for the asker only), failed and stale; the private part''s two approved lines for everyone who can read the reply and its failure for the asker only; agent DMs, private channels, other workspaces, removed people and foreign ids; the same-token acceptance retry; staging validated and token-bound'

-- 6. MUTANTS (§71.4). Each guard is weakened on its own inside a rolled-back transaction, and the
-- property it protects is re-probed: every mutant must make its probe fail. A mutant that does not
-- change the body it names stops the run.
RESET ROLE;
CREATE FUNCTION pg_temp.mutate(fn regprocedure, old text, new text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE body text:=pg_get_functiondef(fn);
BEGIN
 IF (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'mutant does not match % exactly once', fn; END IF;
 EXECUTE replace(body,old,new);
END $$;
CREATE TEMP TABLE mutant_results(mutant text PRIMARY KEY, guarded boolean);
-- A private reply that suggested NEXUS, whose DM turn then failed: another member sees only "replied".
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@MERIT price the workshop?', '{merit}')#>>'{message,id}' AS q9 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q9', 'merit', 'reply', pg_temp.tok('M9'))->>'turn_id' AS t9 \gset
SELECT pg_temp.stage(:'t9', pg_temp.tok('M9'), '[{"agent":"nexus","context":"MERIT suggested you take the announcement."}]')->>'ok' AS s9 \gset
SELECT pg_temp.agent_post(:'u2', :'ta', :'launch', 'merit', 'It depends on scope. @NEXUS can announce it.', gen_random_uuid()::text, NULL, :'q9', 'reply', pg_temp.tok('M9'), true)->>'ok' AS p9 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'merit_dm', :'q9', 'merit', 'dm', pg_temp.tok('M9dm'))->>'turn_id' AS t9d \gset
SELECT pg_temp.end_turn(:'t9d', pg_temp.tok('M9dm'))->>'ok' AS e9 \gset
SELECT pg_temp.check(:'s9'='true' AND :'p9'='true' AND :'e9'='true'
 AND pg_temp.st(pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q9']), :'q9', 'merit')->>'state'='failed'
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q9']), :'q9', 'merit') = jsonb_build_object('message_id',:'q9','agent_key','merit','state','replied','private_part',true,'asker_name','Person 2','bring_in','[{"agent":"nexus"}]'::jsonb),
 'a private reply with Bring in whose DM failed: the asker reads failed; another member reads replied and who was suggested, never the failure');
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@ZION mutant', '{zion}')#>>'{message,id}' AS qm \gset
CREATE FUNCTION pg_temp.states_sig() RETURNS regprocedure LANGUAGE sql AS $$ SELECT 'public.team_hub_agent_turn_states(uuid,uuid,uuid[])'::regprocedure $$;
CREATE FUNCTION pg_temp.stage_sig() RETURNS regprocedure LANGUAGE sql AS $$ SELECT 'public.team_hub_stage_agent_suggestions(uuid,text,jsonb)'::regprocedure $$;
CREATE FUNCTION pg_temp.accept_sig() RETURNS regprocedure LANGUAGE sql AS $$ SELECT 'public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure $$;

-- S1: the conversation need not be visible to the caller.
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), 'SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);',
 'SELECT * INTO ch FROM public.team_hub_channels c WHERE c.id=p_channel_id AND c.tenant_id=p_expected_tenant;');
SELECT coalesce(pg_temp.states(:'u3', :'ta', :'board', ARRAY[:'q6'])->>'code'='not_found' AND pg_temp.states(:'u1', :'ta', :'vera_dm', ARRAY[:'q5'])->>'code'='not_found',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S1 conversation not visible', :'g');
-- S2: everyone reads every state of everyone's questions.
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), ' WHERE s.author_user_id=actor OR (s.private_part', ' WHERE true OR (s.private_part');
SELECT coalesce(pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1']), :'q1', 'zion') IS NULL,false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S2 others read the asker''s states', :'g');
-- S3: everyone reads Bring in's context.
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), 'WHEN s.author_user_id=actor THEN jsonb_build_object(''bring_in'',s.bring_in)', 'WHEN true THEN jsonb_build_object(''bring_in'',s.bring_in)');
SELECT coalesce(NOT (pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1']), :'q1', 'cura')->'bring_in'->0 ? 'context'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S3 others read Bring in context', :'g');
-- S4: a question id from another conversation is read through this one.
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), ' AND m.channel_id=ch.id AND m.tenant_id=p_expected_tenant', ' AND m.tenant_id=p_expected_tenant');
SELECT coalesce(pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q6'])->'states'='[]'::jsonb,false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S4 question from another conversation', :'g');
-- S5: the workspace door is skipped (another workspace, a removed person).
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), 'IF refusal IS NOT NULL THEN', 'IF false THEN');
SELECT coalesce(pg_temp.states(:'u7', :'ta', :'launch', ARRAY[:'q1'])->>'code'='scope_changed' AND pg_temp.states(:'u5', :'ta', :'launch', ARRAY[:'q7'])->>'code'='not_member',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S5 workspace door skipped', :'g');
-- S6: another member reads a private part that failed or never started.
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), ' OR (s.private_part AND s.state IN (''answering'',''replied_privately'')) OR s.bring_in IS NOT NULL;', ' OR s.private_part OR s.bring_in IS NOT NULL;');
SELECT coalesce(pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q4']), :'q4', 'merit') IS NULL,false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S6 others read a failed private part', :'g');
-- S7: another member reads the real state behind a Bring in row.
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), '''state'',CASE WHEN s.author_user_id=actor OR (s.private_part AND s.state IN (''answering'',''replied_privately'')) THEN s.state ELSE ''replied'' END,', '''state'',s.state,');
SELECT coalesce(pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q9']), :'q9', 'merit')->>'state'='replied',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S7 state not masked for others', :'g');
-- S8: a turn left running for ever reads answering.
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), 'WHEN rt.id IS NOT NULL AND rt.consumed_at IS NULL AND rt.accepted_at>now()-interval ''10 minutes'' THEN', 'WHEN rt.id IS NOT NULL AND rt.consumed_at IS NULL THEN');
SELECT coalesce(pg_temp.st(pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q2']), :'q2', 'vera')->>'state'='failed',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S8 stale turn reads answering', :'g');
-- S9: the state read is open to anon.
BEGIN;
GRANT EXECUTE ON FUNCTION public.team_hub_agent_turn_states(uuid,uuid,uuid[]) TO anon;
SELECT coalesce(pg_temp.j(NULL, format('public.team_hub_agent_turn_states(%L::uuid,%L::uuid,%L::uuid[])', :'ta', :'launch', ARRAY[:'q1']), 'anon')->>'error' LIKE 'permission denied%',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S9 state read open to anon', :'g');
-- S10: acceptance no longer recognises its own token (a lost answer then reads in_flight).
BEGIN;
SELECT pg_temp.mutate(pg_temp.accept_sig(), 'IF turn.consumed_at IS NULL AND turn.token_hash=p_token_hash AND turn.channel_id=ch.id THEN', 'IF false THEN');
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'qm', 'zion', 'reply', pg_temp.tok('S10'))->>'ok' AS s10a \gset
SELECT coalesce(:'s10a'='true' AND pg_temp.accept(:'ta', :'u2', :'launch', :'qm', 'zion', 'reply', pg_temp.tok('S10'))->>'repeated'='true',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S10 same-token acceptance retry', :'g');
-- S11: staging no longer checks the token.
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'qm', 'zion', 'reply', pg_temp.tok('QM'))->>'turn_id' AS tqm \gset
BEGIN;
SELECT pg_temp.mutate(pg_temp.stage_sig(), ' AND t.token_hash=p_token_hash AND t.consumed_at IS NULL FOR UPDATE;', ' AND t.consumed_at IS NULL FOR UPDATE;');
SELECT coalesce(pg_temp.stage(:'tqm', pg_temp.tok('wrong'), '[{"agent":"nexus","context":"x"}]')->>'code'='not_found',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S11 staging token not checked', :'g');
-- S12: staging accepts a DM turn (a DM has nobody to bring in). The self-suggestion check is defence
-- in depth: a reply turn's agent is always one its question asks, so the already-asked check (S13)
-- refuses it first, and a mutant of the self check alone cannot fail a probe.
BEGIN;
SELECT pg_temp.mutate(pg_temp.stage_sig(), ' IF turn.intent<>''reply'' THEN RETURN', ' IF false THEN RETURN');
SELECT coalesce(pg_temp.stage(:'tv5', pg_temp.tok('V5'), '[{"agent":"nexus","context":"x"}]')->>'code'='not_allowed',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S12 staging a DM turn', :'g');
-- S13: staging suggests an agent the question already asks.
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@ZION @CURA mutant two', '{zion,cura}')#>>'{message,id}' AS qm2 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'qm2', 'zion', 'reply', pg_temp.tok('QM2'))->>'turn_id' AS tqm2 \gset
BEGIN;
SELECT pg_temp.mutate(pg_temp.stage_sig(), E'\n    OR EXISTS(SELECT 1 FROM public.team_hub_message_agent_mentions x WHERE x.message_id=turn.source_message_id AND x.agent_key=e->>''agent'')', '');
SELECT coalesce(pg_temp.stage(:'tqm2', pg_temp.tok('QM2'), '[{"agent":"cura","context":"asked"}]')->>'code'='invalid',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S13 suggests an agent already asked', :'g');
-- S14: staging is open to the browser.
BEGIN;
GRANT EXECUTE ON FUNCTION public.team_hub_stage_agent_suggestions(uuid,text,jsonb) TO authenticated;
SELECT pg_temp.mutate(pg_temp.stage_sig(), 'IF auth.uid() IS NOT NULL THEN RETURN', 'IF false THEN RETURN');
SELECT coalesce(pg_temp.stage(:'tqm', pg_temp.tok('QM'), '[{"agent":"nexus","context":"x"}]', 'authenticated', :'u2')->>'error' LIKE 'permission denied%',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('S14 staging open to the browser', :'g');

-- Controls: every probe holds on the unmutated migration.
SELECT pg_temp.check(pg_temp.states(:'u3', :'ta', :'board', ARRAY[:'q6'])->>'code'='not_found'
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1']), :'q1', 'zion') IS NULL
 AND NOT (pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1']), :'q1', 'cura')->'bring_in'->0 ? 'context')
 AND pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q6'])->'states'='[]'::jsonb
 AND pg_temp.states(:'u7', :'ta', :'launch', ARRAY[:'q1'])->>'code'='scope_changed'
 AND pg_temp.states(:'u5', :'ta', :'launch', ARRAY[:'q7'])->>'code'='not_member'
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q4']), :'q4', 'merit') IS NULL
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q9']), :'q9', 'merit')->>'state'='replied'
 AND pg_temp.st(pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q2']), :'q2', 'vera')->>'state'='failed'
 AND pg_temp.stage(:'tqm', pg_temp.tok('wrong'), '[{"agent":"nexus","context":"x"}]')->>'code'='not_found'
 AND pg_temp.stage(:'tqm', pg_temp.tok('QM'), '[{"agent":"zion","context":"me"}]')->>'code'='invalid'
 AND pg_temp.stage(:'tv5', pg_temp.tok('V5'), '[{"agent":"nexus","context":"x"}]')->>'code'='not_allowed'
 AND pg_temp.stage(:'tqm2', pg_temp.tok('QM2'), '[{"agent":"cura","context":"asked"}]')->>'code'='invalid'
 AND pg_temp.accept(:'ta', :'u2', :'launch', :'qm', 'zion', 'reply', pg_temp.tok('QM'))->>'repeated'='true',
 'mutants: every probe holds on the unmutated migration (controls)');
SELECT pg_temp.check((SELECT count(*) FROM mutant_results)=14 AND NOT EXISTS(SELECT 1 FROM mutant_results WHERE guarded IS NOT FALSE),
 'mutants: all 14 weakened guards break the property they protect: '||(SELECT string_agg(mutant||'='||coalesce(guarded::text,'null'), '; ' ORDER BY mutant) FROM mutant_results));
\echo 'PASS: 14 of 14 mutants (conversation visibility, others reading the asker''s states, Bring in context, foreign question, workspace door, failed private part, masked state, stale turn, anon grant, same-token acceptance, staging token, staging a DM turn, already-asked suggestion, staging grant) each fail their probe; controls hold'

RESET ROLE;
\c postgres
DROP DATABASE exp08_team_hub_agent_turn_states_proof;
\echo 'PASS: EXP08 Team Hub agents turn-state proof complete; disposable database dropped'
