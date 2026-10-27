-- EXP08 Team Hub agents, A1a: agent-authored messages, agent mentions, the person-to-agent DM, the
-- accepted-turn record, the per-seat cap and the one-reply rule.
-- Migration: supabase/migrations/20271117010008_exp08_team_hub_agents.sql.
-- Contract: docs/delivery/exp08-team-hub-agents-contract.md, section 5 A1 "Proof -> SQL".
-- Disposable PostgreSQL only. Never target the linked project. Every migration commits its own
-- BEGIN/COMMIT, so this proof runs in a database it creates and drops.
--
-- WHAT IS REAL AND WHAT IS A DOUBLE. The setup (everything before the Team Hub chain) is copied verbatim
-- from supabase/tests/exp08_team_lifecycle.sql, which documents what in it is real (production bodies,
-- md5-checked) and what is a double. Real, unchanged: every Team Hub migration that defines a body this
-- change re-emits or calls (20271113850008, ...860008, ...4160008, ...4240008, ...4250008, ...4300008,
-- 20261048000000, 20271115040008), and the migration under test. Before the migration runs, every
-- team_hub function in that chain is md5(prosrc)-checked against production (read 2026-10-27), so the
-- bodies it re-emits are production's newest bodies. After it runs, each re-emitted body is reduced back
-- to production's byte for byte by undoing only the listed A1 hunks, so nothing outside them changed.
-- Synthetic people and ids only.
-- ── Setup, copied verbatim from supabase/tests/exp08_team_lifecycle.sql (lines 25-717) ──
\set ON_ERROR_STOP on
\set QUIET on
DROP DATABASE IF EXISTS exp08_team_hub_agents_a1_proof;
CREATE DATABASE exp08_team_hub_agents_a1_proof;
\c exp08_team_hub_agents_a1_proof
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

-- 1. The chain is production. Every team_hub function, md5(prosrc), read from production 2026-10-27.
CREATE TEMP TABLE prod_md5(sig text PRIMARY KEY, md5 text NOT NULL);
INSERT INTO prod_md5 VALUES
 ('_team_hub_file_can_read(text)','9c803cf0d32b564fc247b9c9eeb69ae6'),
 ('_team_hub_file_can_upload(text)','fd2fcf53106295a1785e485ad7e3ba29'),
 ('_team_hub_file_json(team_hub_files)','86504048cc2d2e39d375eb87f7433ea7'),
 ('_team_hub_file_scope_guard()','39677d0cfbabd81118bc0a5e9743e69d'),
 ('_team_hub_hold_seats(uuid,uuid[])','af0dee455ee0413ee5b907505ff89acd'),
 ('_team_hub_is_active(uuid,uuid)','c290399dc80d95d16116a0f88b0abd8c'),
 ('_team_hub_member_scope_guard()','b3ac0fa9bdb843c635d3fd1ebbf1e351'),
 ('_team_hub_mention_scope_guard()','eedaf37ce3415eb31275b6c05723a11c'),
 ('_team_hub_message_json(team_hub_messages)','f5f3da6bf4887242af2351f71629ee3f'),
 ('_team_hub_message_scope_guard()','a096efb328948b2e7fda67d1306febae'),
 ('_team_hub_participates(uuid,uuid)','4f2fb69d09f7b362027edf195a37da83'),
 ('_team_hub_refusal(uuid)','b6ee98245fdbb9e0229547061a9391d2'),
 ('_team_hub_search_snippet(text,text)','236716498c56c3bee7ec0ae3c6de48be'),
 ('_team_hub_seat_ended()','9a5f9cdb3556d27497f40c0c0da771e4'),
 ('_team_hub_seat_started()','f37dd473a288f572f694b63ecb8f1666'),
 ('_team_hub_trim(text)','299a334fd290fe2eb0dc9482da5aab05'),
 ('_team_hub_visible(uuid,uuid,uuid)','28a7e5c90f2a29b19b4481c4850a414f'),
 ('_team_hub_work_ref_scope_guard()','d50eba43885422e7b502ea0a9304bce4'),
 ('set_solo_team_member_team_hub_access(uuid,uuid,boolean)','285608bde29fe1b238eb26fe98d5f3d1'),
 ('team_hub_add_members(uuid,uuid,uuid[])','25bac1def127e3998036368329e4c80d'),
 ('team_hub_begin_file(uuid,uuid,text,text,bigint,uuid)','74917c7d31eaab3c7c8c597ea1a61095'),
 ('team_hub_claim_stale_files(uuid)','4e47e1760c1c2b300a47a2878fb48591'),
 ('team_hub_create_channel(uuid,text,text,uuid[],uuid)','66c82c0a843b9bf98aa8e18f7ab4c2a2'),
 ('team_hub_discard_file(uuid,uuid)','702b36cf1a248f80cff0fde4bc084d66'),
 ('team_hub_file_for_check(uuid,uuid)','67eb50ec868378fc53f55f7c8ebbdfd9'),
 ('team_hub_file_verdict(uuid,uuid,text,boolean,text)','806e097ec981e45129e93b81f37724b4'),
 ('team_hub_join_channel(uuid,uuid)','b28a684657c15f092295c9a3b9f124c5'),
 ('team_hub_leave_channel(uuid,uuid)','302461d4fdb8d85dbc2ecca16790fdcb'),
 ('team_hub_list_conversations(uuid)','bf7ac43bab2489ca0f7ddff7f056ceb2'),
 ('team_hub_list_messages(uuid,uuid,uuid,timestamp with time zone,uuid,integer)','425c6d84055788cc651001b8fe13199d'),
 ('team_hub_list_work(uuid,integer)','3f460dc9af63029f5496f41f28aabf44'),
 ('team_hub_mark_read(uuid,uuid,uuid)','9c5ff3594f8529e7bff24677dacf34a4'),
 ('team_hub_open_dm(uuid,uuid)','14363512d49614142c3886a17dea11f6'),
 ('team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[])','95c50a965063180165a5d8f04cd05153'),
 ('team_hub_request_task(uuid,uuid,text,uuid,timestamp with time zone,uuid,uuid)','74bcf41f85d7eac9ef35c9d4b733ef6a'),
 ('team_hub_search(uuid,text,integer)','f5ff7517068fd5eb1bb36ce33cc72031');
DO $$ DECLARE bad text; BEGIN
 SELECT string_agg(coalesce(p.sig,c.sig),', ') INTO bad FROM prod_md5 p
  FULL JOIN (SELECT x.oid::regprocedure::text AS sig, md5(x.prosrc) AS md5 FROM pg_proc x
   WHERE x.pronamespace='public'::regnamespace AND x.proname LIKE '%team_hub%') c ON c.sig=p.sig
  WHERE p.md5 IS DISTINCT FROM c.md5;
 IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: the chain is not production for: %', bad; END IF;
END $$;
\echo 'PASS: before the change, every team_hub function in the chain is production''s body (md5(prosrc), 36 of 36)'

CREATE TEMP TABLE before_src AS SELECT p.oid::regprocedure::text AS sig, p.proname::text AS name, p.prosrc AS src
 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team_hub%';
CREATE TEMP TABLE before_trg AS SELECT t.tgname::text AS name, replace(pg_get_triggerdef(t.oid),'FUNCTION public.','FUNCTION ') AS def
 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('team_hub_member_scope','team_hub_message_scope');

-- 2. The change, then a second apply: a no-op.
\ir ../migrations/20271117010008_exp08_team_hub_agents.sql
CREATE TEMP VIEW agents_state AS
SELECT 'fn:'||p.oid::regprocedure::text AS k, concat_ws('|', p.proacl::text, p.prosecdef::text, p.provolatile::text,
  p.proconfig::text, md5(p.prosrc)) AS v
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE '%team_hub%' OR p.proname='operator_retirement_disposition')
UNION ALL
SELECT 'trg:'||t.tgrelid::regclass::text||':'||t.tgname, pg_get_triggerdef(t.oid) FROM pg_trigger t
 WHERE NOT t.tgisinternal AND t.tgrelid::regclass::text LIKE '%team_hub%'
UNION ALL
SELECT 'con:'||c.conrelid::regclass::text||':'||c.conname, pg_get_constraintdef(c.oid)||'|'||c.convalidated FROM pg_constraint c
 WHERE c.conrelid::regclass::text LIKE '%team_hub%'
UNION ALL
SELECT 'idx:'||i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid) FROM pg_index i WHERE i.indrelid::regclass::text LIKE '%team_hub%'
UNION ALL
SELECT 'col:'||a.attrelid::regclass::text||':'||a.attname, concat_ws('|', format_type(a.atttypid,a.atttypmod), a.attnotnull::text,
  pg_get_expr(d.adbin,d.adrelid)) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid::regclass::text LIKE '%team_hub%' AND a.attnum>0 AND NOT a.attisdropped
UNION ALL
SELECT 'rel:'||c.oid::regclass::text, concat_ws('|', c.relacl::text, c.relrowsecurity::text) FROM pg_class c
 WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND c.relname LIKE 'team_hub%';
CREATE TEMP TABLE agents_before AS SELECT * FROM agents_state;
\ir ../migrations/20271117010008_exp08_team_hub_agents.sql
DO $$ BEGIN
 IF EXISTS(SELECT k,v FROM agents_before EXCEPT SELECT k,v FROM agents_state)
   OR EXISTS(SELECT k,v FROM agents_state EXCEPT SELECT k,v FROM agents_before) THEN
  RAISE EXCEPTION 'FAIL: a second apply of the agents migration changed a function, trigger, constraint, index, column or grant'; END IF;
END $$;
\echo 'PASS: the agents migration applies over the production chain; a second apply is a no-op (functions, triggers, constraints, indexes, columns, grants, RLS)'

-- 3. Byte identity outside the change. Each re-emitted body, with ONLY the listed A1 hunks undone, is
-- production's body exactly. Every other team_hub function is untouched.
CREATE TEMP TABLE a1_hunks(name text, ord int, after_text text, before_text text, PRIMARY KEY (name, ord));
INSERT INTO a1_hunks VALUES
 ('_team_hub_seat_ended',1,$h$  -- A1: the person's turns that are still running, then their agent DMs (with what was said there).
  DELETE FROM public.team_hub_agent_turns t
   WHERE t.tenant_id=OLD.tenant_id AND t.asker_user_id=OLD.user_id AND t.consumed_at IS NULL;
  DELETE FROM public.team_hub_channels c
   WHERE c.tenant_id=OLD.tenant_id AND c.kind='agent_dm' AND c.created_by=OLD.user_id
    AND NOT EXISTS(SELECT 1 FROM public.team_hub_files f WHERE f.channel_id=c.id);
$h$,$h$$h$),
 ('_team_hub_seat_ended',2,$h$ -- This trigger never UPDATEs team_hub_channels. Account retirement deletes rows by the ctids it
$h$,$h$ -- This trigger never writes team_hub_channels. Account retirement deletes rows by the ctids it
$h$),
 ('_team_hub_member_scope_guard',1,$h$ -- A1: an agent DM is one person and one agent; nobody else, owners included, is ever a member.
 IF EXISTS(SELECT 1 FROM public.team_hub_channels c WHERE c.id=NEW.channel_id AND c.kind='agent_dm'
   AND c.created_by<>NEW.user_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_MEMBER_SCOPE' USING ERRCODE='23514'; END IF;
$h$,$h$$h$),
 ('_team_hub_message_scope_guard',1,$h$ -- A1: an agent reply links only to a person's message in its own conversation, so nothing private
 -- in a DM ever points back into a channel.
 IF NEW.asked_in_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_hub_messages a
   WHERE a.id=NEW.asked_in_message_id AND a.channel_id=NEW.channel_id AND a.author_kind='user') THEN
  RAISE EXCEPTION 'TEAM_HUB_MESSAGE_SCOPE' USING ERRCODE='23514'; END IF;
 IF NEW.author_kind='agent' AND EXISTS(SELECT 1 FROM public.team_hub_channels c WHERE c.id=NEW.channel_id
   AND c.kind='agent_dm' AND c.agent_key IS DISTINCT FROM NEW.agent_key) THEN
  RAISE EXCEPTION 'TEAM_HUB_MESSAGE_SCOPE' USING ERRCODE='23514'; END IF;
$h$,$h$$h$),
 ('_team_hub_message_json',1,$h$  -- A1: who wrote it (a person, or an agent asked by author_user_id), and which agents it asks.
  || jsonb_build_object('author_kind',p_message.author_kind,'agent_key',p_message.agent_key,
  'asked_in_message_id',p_message.asked_in_message_id,
  'agent_mentions',coalesce((SELECT jsonb_agg(x.agent_key ORDER BY x.agent_key)
   FROM public.team_hub_message_agent_mentions x WHERE x.message_id=p_message.id),'[]'::jsonb))
$h$,$h$$h$),
 ('team_hub_leave_channel',1,$h$ IF ch.kind IN ('dm','agent_dm') THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
$h$,$h$ IF ch.kind='dm' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
$h$),
 ('team_hub_search',1,$h$   -- A1: an agent DM is named by its agent.
   'conversation_label',CASE WHEN h.kind='agent_dm' THEN public._team_hub_agent_name(h.channel_agent_key)
    WHEN h.kind<>'dm' THEN h.name
$h$,$h$   'conversation_label',CASE WHEN h.kind<>'dm' THEN h.name
$h$),
 ('team_hub_search',2,$h$   -- A1: an agent's message carries the agent's name.
   'author_name',CASE WHEN h.author_kind='agent' THEN public._team_hub_agent_name(h.agent_key)
    WHEN public._team_hub_is_active(p_expected_tenant,h.author_user_id)
$h$,$h$   'author_name',CASE WHEN public._team_hub_is_active(p_expected_tenant,h.author_user_id)
$h$),
 ('team_hub_search',3,$h$   m.author_kind, m.agent_key, c.agent_key AS channel_agent_key,
$h$,$h$$h$),
 ('team_hub_post_message',1,$h$ files uuid[]:=coalesce(p_file_ids,'{}'::uuid[]); held int; agents text[]:=coalesce(p_agent_mention_keys,'{}'::text[]);
$h$,$h$ files uuid[]:=coalesce(p_file_ids,'{}'::uuid[]); held int;
$h$),
 ('team_hub_post_message',2,$h$ -- A1: only a person's own message; a request id an agent row holds is never this person's post.
$h$,$h$$h$),
 ('team_hub_post_message',3,$h$  IF msg.channel_id<>ch.id OR msg.author_kind<>'user' THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
$h$,$h$  IF msg.channel_id<>ch.id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
$h$),
 ('team_hub_post_message',4,$h$  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- A1: 0 to 3 distinct agents from the roster, and never in an agent DM (that DM already has its
 -- agent, and another agent would read a conversation that is only the person's and its agent's).
 IF cardinality(agents)>3 OR array_position(agents,NULL) IS NOT NULL
   OR cardinality(agents)<>(SELECT count(DISTINCT x.k) FROM unnest(agents) x(k))
   OR EXISTS(SELECT 1 FROM unnest(agents) x(k) WHERE x.k NOT IN ('paige','vera','nexus','cura','mentor','merit','zion'))
   OR (cardinality(agents)>0 AND ch.kind='agent_dm') THEN
$h$,$h$$h$),
 ('team_hub_post_message',5,$h$  IF NOT FOUND OR msg.channel_id IS DISTINCT FROM ch.id OR msg.author_kind<>'user' THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
$h$,$h$  IF NOT FOUND OR msg.channel_id IS DISTINCT FROM ch.id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
$h$),
 ('team_hub_post_message',6,$h$ INSERT INTO public.team_hub_message_agent_mentions(message_id,tenant_id,channel_id,agent_key)
  SELECT msg.id,p_expected_tenant,ch.id,x.k FROM unnest(agents) x(k);
$h$,$h$$h$),
 ('team_hub_list_conversations',1,$h$ -- A1: 'agent_name_clash' when the first word of their display name is an agent's name.
$h$,$h$$h$),
 ('team_hub_list_conversations',2,$h$   'permission',r.permission,'team_conversations',r.team_hub_access,
   'agent_name_clash',lower(split_part(btrim(r.display_name),' ',1)) IN ('paige','vera','nexus','cura','mentor','merit','zion'))
   ORDER BY lower(r.display_name), r.user_id),'[]'::jsonb) INTO people
$h$,$h$   'permission',r.permission,'team_conversations',r.team_hub_access) ORDER BY lower(r.display_name), r.user_id),'[]'::jsonb) INTO people
$h$),
 ('team_hub_list_conversations',3,$h$   -- A1: the agent of an agent DM; null for every other conversation.
   'agent_key',c.agent_key,
$h$,$h$$h$),
 ('team_hub_list_conversations',4,$h$    WHERE x.channel_id=c.id AND x.parent_message_id IS NULL AND x.deleted_at IS NULL
     AND (x.author_user_id<>actor OR x.author_kind='agent')
$h$,$h$    WHERE x.channel_id=c.id AND x.parent_message_id IS NULL AND x.deleted_at IS NULL AND x.author_user_id<>actor
$h$);
CREATE TEMP TABLE identity_check AS
WITH RECURSIVE undo(name, ord, src) AS (
 SELECT b.name, 0, p.prosrc FROM before_src b
  JOIN pg_proc p ON p.pronamespace='public'::regnamespace AND p.proname=b.name
  WHERE b.name IN (SELECT DISTINCT name FROM a1_hunks)
 UNION ALL
 SELECT u.name, h.ord, replace(u.src, h.after_text, h.before_text) FROM undo u
  JOIN a1_hunks h ON h.name=u.name AND h.ord=u.ord+1
)
SELECT u.name, md5(u.src) AS undone, (SELECT md5(b.src) FROM before_src b WHERE b.name=u.name) AS production,
 (SELECT bool_and(position(h.after_text IN p.prosrc)>0) FROM a1_hunks h, pg_proc p
   WHERE h.name=u.name AND p.pronamespace='public'::regnamespace AND p.proname=u.name) AS hunks_present
FROM undo u WHERE u.ord=(SELECT max(ord) FROM a1_hunks h WHERE h.name=u.name);
DO $$ DECLARE bad text; changed text[]; BEGIN
 IF (SELECT count(*) FROM identity_check)<>8 THEN RAISE EXCEPTION 'FAIL: expected 8 re-emitted bodies, found %', (SELECT count(*) FROM identity_check); END IF;
 SELECT string_agg(name,', ') INTO bad FROM identity_check WHERE undone<>production OR NOT hunks_present;
 IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: outside its A1 hunks, the body differs from production: %', bad; END IF;
 -- Every other team_hub function of the chain is byte-identical.
 SELECT array_agg(b.name ORDER BY b.name) INTO changed FROM before_src b
  JOIN pg_proc p ON p.pronamespace='public'::regnamespace AND p.proname=b.name WHERE p.prosrc<>b.src;
 IF changed IS DISTINCT FROM ARRAY['_team_hub_member_scope_guard','_team_hub_message_json','_team_hub_message_scope_guard',
   '_team_hub_seat_ended','team_hub_leave_channel','team_hub_list_conversations','team_hub_post_message','team_hub_search'] THEN
  RAISE EXCEPTION 'FAIL: the functions that changed are %', changed; END IF;
END $$;
\echo 'PASS: byte identity: each of the 8 re-emitted bodies, with only its listed A1 hunks undone, is production''s md5; the other 28 team_hub functions are unchanged'
-- The two re-created triggers: before the change each is production's definition (pg_trigger, read
-- 2026-10-27); after it, each differs only by the columns the migration header lists.
DO $$ DECLARE now_def text; BEGIN
 IF (SELECT def FROM before_trg WHERE name='team_hub_member_scope') IS DISTINCT FROM
   'CREATE TRIGGER team_hub_member_scope BEFORE INSERT OR UPDATE OF channel_id, tenant_id ON public.team_hub_channel_members FOR EACH ROW EXECUTE FUNCTION _team_hub_member_scope_guard()'
   OR (SELECT def FROM before_trg WHERE name='team_hub_message_scope') IS DISTINCT FROM
   'CREATE TRIGGER team_hub_message_scope BEFORE INSERT OR UPDATE OF channel_id, tenant_id, parent_message_id ON public.team_hub_messages FOR EACH ROW EXECUTE FUNCTION _team_hub_message_scope_guard()' THEN
  RAISE EXCEPTION 'FAIL: before the change, the two scope triggers are not production''s definitions'; END IF;
 SELECT replace(pg_get_triggerdef(t.oid),'FUNCTION public.','FUNCTION ') INTO now_def FROM pg_trigger t WHERE t.tgname='team_hub_member_scope';
 IF now_def IS DISTINCT FROM replace((SELECT def FROM before_trg WHERE name='team_hub_member_scope'),
   'OF channel_id, tenant_id ON','OF channel_id, tenant_id, user_id ON') THEN
  RAISE EXCEPTION 'FAIL: team_hub_member_scope differs from production by more than user_id: %', now_def; END IF;
 SELECT replace(pg_get_triggerdef(t.oid),'FUNCTION public.','FUNCTION ') INTO now_def FROM pg_trigger t WHERE t.tgname='team_hub_message_scope';
 IF now_def IS DISTINCT FROM replace((SELECT def FROM before_trg WHERE name='team_hub_message_scope'),
   'parent_message_id ON','parent_message_id, asked_in_message_id, author_kind, agent_key ON') THEN
  RAISE EXCEPTION 'FAIL: team_hub_message_scope differs from production by more than the three agent columns: %', now_def; END IF;
END $$;
\echo 'PASS: the two re-created scope triggers are production''s definitions plus only the listed columns (member: user_id; message: asked_in_message_id, author_kind, agent_key)'

-- 4. Structure, grants and the incumbent guards.
DO $$ DECLARE f text; BEGIN
 IF to_regprocedure('public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[])') IS NOT NULL
   OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='team_hub_post_message')<>1 THEN
  RAISE EXCEPTION 'FAIL: team_hub_post_message must have exactly one (eight-argument) signature'; END IF;
 FOREACH f IN ARRAY ARRAY['team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[])',
   'team_hub_open_agent_dm(uuid,text)','team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)'] LOOP
  IF NOT has_function_privilege('authenticated','public.'||f,'EXECUTE') OR has_function_privilege('anon','public.'||f,'EXECUTE')
    OR has_function_privilege('service_role','public.'||f,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: % must be executable by authenticated only (never the service role)', f; END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)','team_hub_end_agent_turn(uuid,text)'] LOOP
  IF NOT has_function_privilege('service_role','public.'||f,'EXECUTE') OR has_function_privilege('anon','public.'||f,'EXECUTE')
    OR has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: % must be executable by the service role only', f; END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[])',
   'team_hub_open_agent_dm(uuid,text)','team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)',
   'team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)','team_hub_end_agent_turn(uuid,text)',
   'team_hub_list_conversations(uuid)','team_hub_search(uuid,text,integer)','team_hub_leave_channel(uuid,uuid)'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=('public.'||f)::regprocedure AND p.prosecdef AND p.proconfig[1]='search_path=""')
    OR EXISTS(SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
     WHERE p.oid=('public.'||f)::regprocedure AND a.grantee=0) THEN
   RAISE EXCEPTION 'FAIL: % is not a SECURITY DEFINER door on an empty search_path, or PUBLIC can execute it', f; END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['_team_hub_agent_name(text)','_team_hub_agent_mention_scope_guard()','_team_hub_agent_turn_scope_guard()',
   '_team_hub_member_scope_guard()','_team_hub_message_scope_guard()','_team_hub_message_json(team_hub_messages)','_team_hub_seat_ended()'] LOOP
  IF has_function_privilege('anon','public.'||f,'EXECUTE') OR has_function_privilege('authenticated','public.'||f,'EXECUTE')
    OR has_function_privilege('service_role','public.'||f,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: internal helper % is callable by a request role', f; END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['team_hub_message_agent_mentions','team_hub_agent_turns'] LOOP
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||f)::regclass)
    OR EXISTS(SELECT 1 FROM pg_policies WHERE tablename=f)
    OR has_table_privilege('anon','public.'||f,'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('authenticated','public.'||f,'SELECT,INSERT,UPDATE,DELETE') THEN
   RAISE EXCEPTION 'FAIL: % must be RLS-on with no policy and no browser grant', f; END IF;
  IF public.operator_retirement_disposition(f)<>'delete' THEN
   RAISE EXCEPTION 'FAIL: % is not registered for deletion at account retirement', f; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid IN ('public.team_hub_messages'::regclass,'public.team_hub_channels'::regclass)
   AND conname IN ('team_hub_messages_author_kind_chk','team_hub_channels_kind_check','team_hub_channels_shape_chk') AND NOT convalidated)
   OR (SELECT count(*) FROM pg_constraint WHERE conrelid IN ('public.team_hub_messages'::regclass,'public.team_hub_channels'::regclass)
   AND conname IN ('team_hub_messages_author_kind_chk','team_hub_channels_kind_check','team_hub_channels_shape_chk'))<>3 THEN
  RAISE EXCEPTION 'FAIL: the three CHECKs are not present and validated'; END IF;
 IF pg_get_indexdef('public.team_hub_messages_agent_reply_key'::regclass)
   <>'CREATE UNIQUE INDEX team_hub_messages_agent_reply_key ON public.team_hub_messages USING btree (asked_in_message_id, agent_key) WHERE (author_kind = ''agent''::text)' THEN
  RAISE EXCEPTION 'FAIL: the one-reply index is not the partial unique (asked_in_message_id, agent_key) WHERE author_kind=agent'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.team_hub_messages'::regclass AND attname='author_user_id' AND attnotnull) THEN
  RAISE EXCEPTION 'FAIL: team_hub_messages.author_user_id must stay NOT NULL'; END IF;
 -- The incumbent proofs' guards over every team_hub body (team_work.sql, files.sql), kept true.
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team_hub%'
   AND (p.prosrc ~* '(paige_orchestrator|delegate_to_subagent|file_action|advance_action|approval|calendar|booking)'
    OR p.prosrc ILIKE '%is_tenant_member%')) THEN
  RAISE EXCEPTION 'FAIL: a team_hub body names a delegation, approval, calendar or booking path'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_agent_turns'::regclass
   AND conname='team_hub_agent_turns_attempts_chk' AND convalidated) THEN
  RAISE EXCEPTION 'FAIL: team_hub_agent_turns_attempts_chk (the newest attempt is accepted_at) is missing'; END IF;
 IF position('''work_ref''' IN (SELECT prosrc FROM pg_proc WHERE oid='public._team_hub_message_json(team_hub_messages)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'FAIL: _team_hub_message_json no longer carries work_ref'; END IF;
END $$;
\echo 'PASS: structure: one eight-argument team_hub_post_message; agent doors authenticated-only, turn doors service-role-only; helpers unreachable; new tables RLS-on, no grants, registered for retirement; CHECKs validated; the one-reply index; the incumbent body guards hold'

-- 5. Behaviour. People: u1 owner (Morgan), u3 admin (Priya), u2 and u5 members (Sam, Marcus), u6 a member
-- named after an agent. A caller is impersonated by JWT claims and SET ROLE, as in the lifecycle proof.
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
CREATE FUNCTION pg_temp.unread(actor text, tenant text, channel text) RETURNS int LANGUAGE sql AS $$
 SELECT (c->>'unread')::int FROM jsonb_array_elements(pg_temp.j(actor, format('public.team_hub_list_conversations(%L::uuid)', tenant))->'conversations') c
  WHERE c->>'id'=channel $$;
CREATE FUNCTION pg_temp.listed(actor text, tenant text, channel text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT c FROM jsonb_array_elements(pg_temp.j(actor, format('public.team_hub_list_conversations(%L::uuid)', tenant))->'conversations') c
  WHERE c->>'id'=channel $$;
UPDATE public.profiles SET full_name='Vera Lane' WHERE user_id=:'u6';

SELECT pg_temp.j(:'u1', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'ta','launch','team','{}'))->>'channel_id' AS launch \gset
SELECT pg_temp.check(pg_temp.j(u, format('public.team_hub_join_channel(%L::uuid,%L::uuid)', :'ta', :'launch'))->>'ok'='true', 'setup: a teammate joins #launch')
 FROM unnest(ARRAY[:'u2', :'u3', :'u5']) u;
SELECT pg_temp.check(:'launch' <> '', 'setup: #launch exists');

-- 5a. A person's message stores the agents it asks.
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@CURA who is onboarding this week?', '{cura}') AS p1 \gset
SELECT (:'p1')::jsonb#>>'{message,id}' AS src1 \gset
SELECT pg_temp.check((:'p1')::jsonb->>'ok'='true' AND (:'p1')::jsonb#>'{message,agent_mentions}'='["cura"]'::jsonb
 AND (:'p1')::jsonb#>>'{message,author_kind}'='user' AND (:'p1')::jsonb#>'{message,agent_key}'='null'::jsonb
 AND (SELECT count(*) FROM public.team_hub_message_agent_mentions WHERE message_id=:'src1' AND agent_key='cura')=1,
 'a person''s message stores its agent mention and says so: author_kind user, agent_mentions [cura]');
SELECT pg_temp.check(pg_temp.post(:'u2', :'ta', :'launch', 'four', '{cura,zion,vera,nexus}')->>'code'='invalid'
 AND pg_temp.post(:'u2', :'ta', :'launch', 'unknown', '{cura,bogus}')->>'code'='invalid'
 AND pg_temp.post(:'u2', :'ta', :'launch', 'twice', '{cura,cura}')->>'code'='invalid'
 AND pg_temp.post(:'u2', :'ta', :'launch', 'null', '{cura,NULL}')->>'code'='invalid'
 AND pg_temp.post(:'u2', :'ta', :'launch', 'three', '{cura,zion,vera}')->>'ok'='true',
 'agent mentions: at most 3, distinct, from the roster; a 4th, an unknown, a repeat or a null is refused invalid');
-- PAIGE's call (chat.ts names exactly these arguments) and team_hub_request_task's positional call still resolve.
SELECT pg_temp.check(pg_temp.j(:'u3', format('public.team_hub_post_message(p_expected_tenant=>%L::uuid,p_channel_id=>%L::uuid,p_body=>%L,p_client_request_id=>gen_random_uuid(),p_parent_message_id=>NULL,p_mention_ids=>''{}''::uuid[],p_file_ids=>''{}''::uuid[])', :'ta', :'launch', 'PAIGE drafted this'))#>'{message,agent_mentions}'='[]'::jsonb
 AND pg_temp.j(:'u1', format('public.team_hub_request_task(%L::uuid,%L::uuid,%L,%L::uuid,NULL,gen_random_uuid(),NULL)', :'ta', :'launch', 'Book the venue walkthrough', :'u5'))#>>'{message,work_ref,source}'='planning',
 'PAIGE''s named post and team_hub_request_task''s positional call resolve to the new signature unchanged');

-- 5b. Only the turn's own token posts. No accepted turn, a browser calling the definer directly: refused.
SELECT pg_temp.check(pg_temp.agent_post(:'u2', :'ta', :'launch', 'cura', 'I am CURA', gen_random_uuid()::text, NULL, :'src1', 'reply', pg_temp.tok('none'))->>'code'='not_allowed',
 'the asker calling team_hub_post_agent_message directly, with no accepted turn, is refused not_allowed');
SELECT pg_temp.check(pg_temp.j(:'u2', format('public.team_hub_accept_agent_turn(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)', :'ta', :'u2', :'launch', :'src1', 'cura','reply', pg_temp.h('x')))->>'error' LIKE 'permission denied%'
 AND pg_temp.j(NULL, format('public.team_hub_accept_agent_turn(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)', :'ta', :'u2', :'launch', :'src1', 'cura','reply', pg_temp.h('x')), 'anon')->>'error' LIKE 'permission denied%'
 AND pg_temp.j(:'u2', format('public.team_hub_accept_agent_turn(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)', :'ta', :'u2', :'launch', :'src1', 'cura','reply', pg_temp.h('x')), 'service_role')->>'code'='not_allowed'
 AND pg_temp.j(:'u2', format('public.team_hub_end_agent_turn(gen_random_uuid(),%L)', pg_temp.h('x')))->>'error' LIKE 'permission denied%',
 'team_hub_accept_agent_turn and team_hub_end_agent_turn are refused to authenticated and anon, and to any caller carrying a user JWT');

-- 5c. Rule 2 at acceptance: the source must be the asker's own message asking this agent.
SELECT pg_temp.post(:'u5', :'ta', :'launch', '@CURA what about me?', '{cura}')#>>'{message,id}' AS src_marcus \gset
SELECT pg_temp.check(pg_temp.accept(:'ta', :'u5', :'launch', :'src1', 'cura', 'reply', pg_temp.tok('m'))->>'code'='not_allowed'
 AND pg_temp.accept(:'ta', :'u2', :'launch', :'src1', 'zion', 'reply', pg_temp.tok('z'))->>'code'='not_allowed'
 AND pg_temp.accept(:'ta', :'u2', :'launch', :'src_marcus', 'cura', 'reply', pg_temp.tok('s'))->>'code'='not_allowed'
 AND pg_temp.accept(:'ta', :'u2', :'launch', :'src1', 'cura', 'dm', pg_temp.tok('d'))->>'code'='not_allowed'
 AND pg_temp.accept(:'ta', :'u2', :'launch', :'src1', 'cura', 'report:'||gen_random_uuid()||':'||gen_random_uuid(), pg_temp.tok('r'))->>'code'='invalid'
 AND pg_temp.j(NULL, format('public.team_hub_accept_agent_turn(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)', :'ta', :'u2', :'launch', :'src1', 'cura','reply','not-a-hash'), 'service_role')->>'code'='invalid'
 AND pg_temp.accept(:'tb', :'u2', :'launch', :'src1', 'cura', 'reply', pg_temp.tok('t'))->>'code'='not_member'
 AND pg_temp.accept(:'tc', :'u11', :'launch', :'src1', 'cura', 'reply', pg_temp.tok('c'))->>'code'='unavailable',
 'acceptance refuses another person''s message, an agent the message does not ask, a dm intent outside the agent DM, reports (A3), another workspace and a sub-account');
UPDATE public.tenant_members SET team_hub_access=false WHERE tenant_id=:'ta' AND user_id=:'u5';
SELECT pg_temp.check(pg_temp.accept(:'ta', :'u5', :'launch', :'src_marcus', 'cura', 'reply', pg_temp.tok('off'))->>'code'='conversations_off',
 'acceptance refuses a seat whose Team conversations are off');
UPDATE public.tenant_members SET team_hub_access=true WHERE tenant_id=:'ta' AND user_id=:'u5';

-- 5d. Accept, post, consume; nobody else's token, no second use.
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'src1', 'cura', 'reply', pg_temp.tok('T1')) AS a1 \gset
SELECT pg_temp.check((:'a1')::jsonb->>'ok'='true'
 AND pg_temp.accept(:'ta', :'u2', :'launch', :'src1', 'cura', 'reply', pg_temp.tok('T1-again'))->>'code'='in_flight',
 'an accepted turn is recorded once; accepting it again while it runs answers in_flight');
SELECT gen_random_uuid() AS r1 \gset
SELECT pg_temp.check(pg_temp.agent_post(:'u5', :'ta', :'launch', 'cura', 'I am CURA', :'r1', NULL, :'src1', 'reply', pg_temp.tok('T1'))->>'code'='not_allowed'
 AND pg_temp.agent_post(:'u1', :'ta', :'launch', 'cura', 'I am CURA', :'r1', NULL, :'src1', 'reply', pg_temp.tok('T1'))->>'code'='not_allowed',
 'another member, the owner included, cannot post an agent reply to Sam''s message even holding Sam''s token');
SELECT pg_temp.check(pg_temp.agent_post(:'u2', :'ta', :'launch', 'cura', 'I am CURA', :'r1', NULL, :'src1', 'reply', pg_temp.tok('wrong'))->>'code'='not_allowed'
 AND pg_temp.agent_post(:'u2', :'ta', :'launch', 'zion', 'I am CURA', :'r1', NULL, :'src1', 'reply', pg_temp.tok('T1'))->>'code'='not_allowed'
 AND pg_temp.agent_post(:'u2', :'ta', :'launch', 'cura', 'I am CURA', :'r1', NULL, NULL, 'reply', pg_temp.tok('T1'))->>'code'='invalid'
 AND pg_temp.agent_post(:'u2', :'ta', :'launch', 'cura', 'I am CURA', :'r1', :'src1', :'src1', 'reply', pg_temp.tok('T1'))->>'code'='invalid',
 'a wrong token or agent is refused; a reply not linked to its question, or put in a thread the question is not in, is refused');
SELECT pg_temp.agent_post(:'u2', :'ta', :'launch', 'cura', 'Two people start Monday.', :'r1', NULL, :'src1', 'reply', pg_temp.tok('T1')) AS reply1 \gset
SELECT (:'reply1')::jsonb#>>'{message,id}' AS reply1_id \gset
SELECT pg_temp.check((:'reply1')::jsonb->>'ok'='true'
 AND (:'reply1')::jsonb @> jsonb_build_object('message',jsonb_build_object('author_kind','agent','agent_key','cura','asked_in_message_id',:'src1','author_user_id',:'u2','parent_message_id',NULL))
 AND (SELECT consumed_at IS NOT NULL AND posted_message_id=(:'reply1_id')::uuid FROM public.team_hub_agent_turns WHERE id=((:'a1')::jsonb->>'turn_id')::uuid),
 'the asker''s server posts the agent reply: author_kind agent, agent cura, linked to Sam''s message, accountable to Sam; the turn is consumed in the same transaction');
SELECT pg_temp.check(pg_temp.agent_post(:'u2', :'ta', :'launch', 'cura', 'again', gen_random_uuid()::text, NULL, :'src1', 'reply', pg_temp.tok('T1'))->>'code'='not_allowed'
 AND pg_temp.agent_post(:'u2', :'ta', :'launch', 'cura', 'Two people start Monday.', :'r1', NULL, :'src1', 'reply', pg_temp.tok('T1')) @> jsonb_build_object('ok',true,'duplicate',true,'message',jsonb_build_object('id',:'reply1_id'))
 AND pg_temp.accept(:'ta', :'u2', :'launch', :'src1', 'cura', 'reply', pg_temp.tok('T1-third')) @> jsonb_build_object('code','duplicate','message_id',:'reply1_id')
 AND (SELECT count(*) FROM public.team_hub_messages WHERE author_kind='agent' AND asked_in_message_id=:'src1')=1,
 'a consumed turn is refused for a new post (replay); the same token and request id after an unknown outcome return the posted reply; acceptance answers duplicate');
SELECT pg_temp.check(pg_temp.post(:'u2', :'ta', :'launch', 'retry', '{}')->>'ok'='true'
 AND pg_temp.j(:'u2', format('public.team_hub_post_message(%L::uuid,%L::uuid,%L,%L::uuid)', :'ta', :'launch', 'collide', :'r1'))->>'code'='invalid',
 'a person''s post that reuses the request id an agent reply holds is refused, never answered with the agent''s row');

-- 5e. Unread: the agent's reply counts for every member who can see the channel, the asker included.
SELECT pg_temp.check(pg_temp.unread(:'u2', :'ta', :'launch')>=1
 AND (SELECT count(*) FROM public.team_hub_messages x JOIN public.team_hub_channel_members m ON m.channel_id=x.channel_id AND m.user_id=:'u2'
   WHERE x.channel_id=:'launch' AND x.parent_message_id IS NULL AND x.deleted_at IS NULL AND (x.author_user_id<>:'u2' OR x.author_kind='agent')
    AND (m.last_read_at IS NULL OR x.created_at>m.last_read_at))=pg_temp.unread(:'u2', :'ta', :'launch')
 AND pg_temp.unread(:'u2', :'ta', :'launch')>(SELECT count(*) FROM public.team_hub_messages x JOIN public.team_hub_channel_members m ON m.channel_id=x.channel_id AND m.user_id=:'u2'
   WHERE x.channel_id=:'launch' AND x.parent_message_id IS NULL AND x.deleted_at IS NULL AND x.author_user_id<>:'u2'
    AND (m.last_read_at IS NULL OR x.created_at>m.last_read_at)),
 'the asker sees the agent reply as unread (it would not count as theirs)');
SELECT pg_temp.j(:'u5', format('public.team_hub_mark_read(%L::uuid,%L::uuid,%L::uuid)', :'ta', :'launch', :'src1')) AS mr \gset
SELECT pg_temp.check(pg_temp.unread(:'u5', :'ta', :'launch')>=1 AND pg_temp.unread(:'u3', :'ta', :'launch')>=1 AND pg_temp.unread(:'u1', :'ta', :'launch')>=1
 AND pg_temp.unread(:'u5', :'ta', :'launch')=(SELECT count(*) FROM public.team_hub_messages x WHERE x.channel_id=:'launch' AND x.parent_message_id IS NULL
   AND x.author_user_id<>:'u5' AND x.created_at>(SELECT created_at FROM public.team_hub_messages WHERE id=:'src1')),
 'an agent reply raises unread for every member who can see the channel');


-- 5f. One reply per (message, agent): storage refuses a second; the door returns the first.
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
SELECT pg_temp.check(pg_temp.err(format('INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,author_kind,agent_key,asked_in_message_id) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L,%L,%L)',
  :'ta', :'launch', :'u2', 'second', 'agent', 'cura', :'src1')) LIKE '%team_hub_messages_agent_reply_key%',
 'storage refuses a second agent reply to the same message by the same agent (partial unique index)');
-- A turn re-opened as if a concurrent attempt raced the first: the door returns the existing reply.
UPDATE public.team_hub_agent_turns SET consumed_at=NULL, posted_message_id=NULL, token_hash=pg_temp.h(pg_temp.tok('T1-race'))
 WHERE id=((:'a1')::jsonb->>'turn_id')::uuid;
-- (A call that writes and a read of what it wrote go in separate statements: one statement reads one snapshot.)
SELECT pg_temp.agent_post(:'u2', :'ta', :'launch', 'cura', 'A second answer', gen_random_uuid()::text, NULL, :'src1', 'reply', pg_temp.tok('T1-race')) AS race \gset
SELECT pg_temp.check((:'race')::jsonb @> jsonb_build_object('ok',true,'duplicate',true,'message',jsonb_build_object('id',:'reply1_id'))
 AND (SELECT count(*) FROM public.team_hub_messages WHERE author_kind='agent' AND asked_in_message_id=:'src1')=1
 AND (SELECT posted_message_id=(:'reply1_id')::uuid FROM public.team_hub_agent_turns WHERE id=((:'a1')::jsonb->>'turn_id')::uuid),
 'a second reply for the same (message, agent) returns the first and stores nothing');
-- A request id reused for another question is refused, never bound to the other turn. Priya asks CURA
-- two things; the reply to B arrives under the request id A's reply already holds.
SELECT pg_temp.post(:'u3', :'ta', :'launch', '@CURA question A', '{cura}')#>>'{message,id}' AS qa \gset
SELECT pg_temp.post(:'u3', :'ta', :'launch', '@CURA question B', '{cura}')#>>'{message,id}' AS qb \gset
SELECT pg_temp.accept(:'ta', :'u3', :'launch', :'qa', 'cura', 'reply', pg_temp.tok('QA'))->>'turn_id' AS qa_turn \gset
SELECT gen_random_uuid() AS rq \gset
SELECT pg_temp.agent_post(:'u3', :'ta', :'launch', 'cura', 'Answer to A', :'rq', NULL, :'qa', 'reply', pg_temp.tok('QA'))#>>'{message,id}' AS qa_reply \gset
SELECT pg_temp.accept(:'ta', :'u3', :'launch', :'qb', 'cura', 'reply', pg_temp.tok('QB'))->>'turn_id' AS qb_turn \gset
SELECT pg_temp.agent_post(:'u3', :'ta', :'launch', 'cura', 'Answer to B', :'rq', NULL, :'qb', 'reply', pg_temp.tok('QB')) AS qb_reused \gset
SELECT pg_temp.check(:'qa_reply'<>'' AND :'qb_turn'<>'' AND (:'qb_reused')::jsonb->>'code'='invalid'
 AND (SELECT consumed_at IS NULL AND posted_message_id IS NULL FROM public.team_hub_agent_turns WHERE id=:'qb_turn')
 AND (SELECT posted_message_id=(:'qa_reply')::uuid FROM public.team_hub_agent_turns WHERE id=:'qa_turn'),
 'a reply sent under the request id another question''s reply holds is refused invalid; turn B stays unbound, turn A keeps its reply');
SELECT pg_temp.agent_post(:'u3', :'ta', :'launch', 'cura', 'Answer to B', gen_random_uuid()::text, NULL, :'qb', 'reply', pg_temp.tok('QB')) AS qb_reply \gset
SELECT pg_temp.check((:'qb_reply')::jsonb @> jsonb_build_object('ok',true,'message',jsonb_build_object('asked_in_message_id',:'qb'))
 AND (SELECT posted_message_id=((:'qb_reply')::jsonb#>>'{message,id}')::uuid FROM public.team_hub_agent_turns WHERE id=:'qb_turn'),
 'turn B then posts its own reply, linked to question B');

-- 5g. The person-to-agent DM: one member, invisible to everyone else, owners included.
SELECT pg_temp.j(:'u2', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'merit'))->>'channel_id' AS dm_merit \gset
SELECT pg_temp.check(:'dm_merit'<>''
 AND pg_temp.j(:'u2', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'merit'))->>'channel_id'=:'dm_merit'
 AND pg_temp.j(:'u2', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'bogus'))->>'code'='invalid'
 AND pg_temp.j(:'u2', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'tb', 'merit'))->>'code'='scope_changed'
 AND (SELECT kind='agent_dm' AND agent_key='merit' AND dm_key='agent:merit:'||:'u2' AND visibility='private' FROM public.team_hub_channels WHERE id=:'dm_merit')
 AND (SELECT array_agg(user_id) FROM public.team_hub_channel_members WHERE channel_id=:'dm_merit')=ARRAY[(:'u2')::uuid],
 'Sam opens his DM with MERIT: one per person and agent, reopening returns it, only Sam is a member');
SELECT pg_temp.check(pg_temp.listed(:'u1', :'ta', :'dm_merit') IS NULL
 AND pg_temp.j(:'u1', format('public.team_hub_list_messages(%L::uuid,%L::uuid)', :'ta', :'dm_merit'))->>'code'='not_found'
 AND pg_temp.j(:'u1', format('public.team_hub_join_channel(%L::uuid,%L::uuid)', :'ta', :'dm_merit'))->>'code'='not_found'
 AND pg_temp.j(:'u2', format('public.team_hub_add_members(%L::uuid,%L::uuid,%L::uuid[])', :'ta', :'dm_merit', format('{%s}', :'u1')))->>'code'='not_allowed'
 AND pg_temp.j(:'u2', format('public.team_hub_leave_channel(%L::uuid,%L::uuid)', :'ta', :'dm_merit'))->>'code'='not_allowed'
 AND pg_temp.err(format('INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by) VALUES (%L,%L,%L,%L)', :'dm_merit', :'ta', :'u1', :'u1')) LIKE 'TEAM_HUB_MEMBER_SCOPE%'
 AND pg_temp.err(format('INSERT INTO public.team_hub_channels(tenant_id,kind,visibility,dm_key,agent_key,created_by) VALUES (%L,%L,%L,%L,%L,%L)', :'ta', 'agent_dm', 'private', 'agent:merit:'||:'u5', 'merit', :'u2')) LIKE '%team_hub_channels_shape_chk%'
 AND pg_temp.err(format('INSERT INTO public.team_hub_channels(tenant_id,kind,visibility,dm_key,agent_key,created_by) VALUES (%L,%L,%L,%L,%L,%L)', :'ta', 'dm', 'private', 'x:y', 'merit', :'u2')) LIKE '%team_hub_channels_shape_chk%',
 'an agent DM refuses a second member (door and storage), is invisible to the owner, cannot be joined, added to or left; its key must name its person; a person DM never carries an agent');
SELECT pg_temp.check(pg_temp.listed(:'u2', :'ta', :'dm_merit') @> '{"kind":"agent_dm","agent_key":"merit","visibility":"private","dm_user_id":null,"member_count":1}'::jsonb
 AND pg_temp.listed(:'u2', :'ta', :'launch') @> '{"agent_key":null}'::jsonb,
 'Sam''s list carries his agent DM with its agent_key and no person; every other conversation says agent_key null');

-- 5h. The private part: the fixed line comes from the database, the answer goes to the DM, and nothing
-- in the DM points back into the channel.
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@MERIT what did Harper pay us last quarter?', '{merit}')#>>'{message,id}' AS src2 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'src2', 'merit', 'reply', pg_temp.tok('T2'))->>'ok' AS a2 \gset
SELECT pg_temp.agent_post(:'u2', :'ta', :'launch', 'merit', 'For the room: a friendly nudge at 7 days.', gen_random_uuid()::text, NULL, :'src2', 'reply', pg_temp.tok('T2'), true) AS reply2 \gset
SELECT pg_temp.check(:'a2'='true' AND (:'reply2')::jsonb#>>'{message,body}'=E'For the room: a friendly nudge at 7 days.\n\nThat part is just for you, so I''m answering it in our DM.',
 'the private-part line is appended by the database, worded exactly, after the public part');
SELECT pg_temp.accept(:'ta', :'u2', :'dm_merit', :'src2', 'merit', 'dm', pg_temp.tok('T3')) AS a3 \gset
SELECT pg_temp.check((:'a3')::jsonb->>'ok'='true'
 AND pg_temp.accept(:'ta', :'u2', :'dm_merit', :'src2', 'cura', 'dm', pg_temp.tok('T3x'))->>'code'='not_allowed'
 AND pg_temp.accept(:'ta', :'u5', :'dm_merit', :'src_marcus', 'merit', 'dm', pg_temp.tok('T3y'))->>'code'='not_found'
 AND pg_temp.agent_post(:'u2', :'ta', :'dm_merit', 'merit', 'Harper paid 4,800.', gen_random_uuid()::text, NULL, :'src2', 'dm', pg_temp.tok('T3'))->>'code'='invalid',
 'the DM turn is accepted only in the asker''s DM with that agent; the answer may not link back to the channel message');
SELECT pg_temp.agent_post(:'u2', :'ta', :'dm_merit', 'merit', 'Harper paid 4,800 in September.', gen_random_uuid()::text, NULL, NULL, 'dm', pg_temp.tok('T3')) AS dm_answer \gset
SELECT pg_temp.check((:'dm_answer')::jsonb @> jsonb_build_object('ok',true,'message',jsonb_build_object('author_kind','agent','agent_key','merit','asked_in_message_id',NULL))
 AND (SELECT channel_id=(:'dm_merit')::uuid FROM public.team_hub_messages WHERE id=((:'dm_answer')::jsonb#>>'{message,id}')::uuid)
 AND pg_temp.err(format('INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,author_kind,agent_key,asked_in_message_id) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L,%L,%L)',
  :'ta', :'dm_merit', :'u2', 'linked', 'agent', 'merit', :'src2')) LIKE 'TEAM_HUB_MESSAGE_SCOPE%'
 AND pg_temp.err(format('INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,author_kind,agent_key) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L,%L)',
  :'ta', :'dm_merit', :'u2', 'wrong agent', 'agent', 'cura')) LIKE 'TEAM_HUB_MESSAGE_SCOPE%'
 AND pg_temp.err(format('INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,agent_key) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L)',
  :'ta', :'launch', :'u2', 'person with agent', 'cura')) LIKE '%team_hub_messages_author_kind_chk%',
 'the DM answer posts in the DM, unlinked; storage refuses an agent row linked across conversations, another agent in an agent DM, and a person row carrying an agent');
-- A message Sam writes in the DM is a DM source; an agent mention there is refused.
SELECT pg_temp.post(:'u2', :'ta', :'dm_merit', 'And the quarter before?')#>>'{message,id}' AS src3 \gset
SELECT pg_temp.check(:'src3'<>'' AND pg_temp.post(:'u2', :'ta', :'dm_merit', '@ZION too', '{zion}')->>'code'='invalid'
 AND pg_temp.accept(:'ta', :'u2', :'dm_merit', :'src3', 'merit', 'dm', pg_temp.tok('T4'))->>'ok'='true'
 AND pg_temp.agent_post(:'u2', :'ta', :'dm_merit', 'merit', 'June was 3,100.', gen_random_uuid()::text, NULL, :'src3', 'dm', pg_temp.tok('T4'))#>>'{message,asked_in_message_id}'=:'src3'
 AND pg_temp.accept(:'ta', :'u2', :'dm_merit', :'src3', 'merit', 'reply', pg_temp.tok('T4r'))->>'code'='not_allowed',
 'in his DM Sam asks MERIT directly (intent dm, linked to his DM message); agent mentions and reply turns are refused there');
SELECT pg_temp.check(pg_temp.err(format('INSERT INTO public.team_hub_message_agent_mentions(message_id,tenant_id,channel_id,agent_key) VALUES (%L,%L,%L,%L)',
  :'reply1_id', :'ta', :'launch', 'zion')) LIKE 'TEAM_HUB_AGENT_MENTION_SCOPE%',
 'an agent''s text never carries an agent mention (storage)');
-- A message in a thread is answered in its thread (owner ruling Q2).
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@VERA quick one in the thread', '{vera}', :'src1')#>>'{message,id}' AS src_thread \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'src_thread', 'vera', 'reply', pg_temp.tok('T5'))->>'ok' AS a5 \gset
SELECT pg_temp.check(:'a5'='true'
 AND pg_temp.agent_post(:'u2', :'ta', :'launch', 'vera', 'Top level', gen_random_uuid()::text, NULL, :'src_thread', 'reply', pg_temp.tok('T5'))->>'code'='invalid'
 AND pg_temp.agent_post(:'u2', :'ta', :'launch', 'vera', 'In the thread', gen_random_uuid()::text, :'src1', :'src_thread', 'reply', pg_temp.tok('T5'))#>>'{message,parent_message_id}'=:'src1',
 'a thread question is answered in its thread, never at the top level');

-- 5i. Labels and casts: agent DMs and agent rows are named by their agent; person DMs still resolve.
SELECT pg_temp.j(:'u2', format('public.team_hub_open_dm(%L::uuid,%L::uuid)', :'ta', :'u5'))->>'channel_id' AS dm_people \gset
SELECT pg_temp.post(:'u2', :'ta', :'dm_people', 'Harper nudge plan')->>'ok' AS dm_people_ok \gset
SELECT pg_temp.j(:'u2', format('public.team_hub_search(%L::uuid,%L)', :'ta', 'Harper')) AS search_sam \gset
SELECT pg_temp.check(:'dm_people_ok'='true'
 AND pg_temp.listed(:'u2', :'ta', :'dm_people')->>'dm_user_id'=:'u5'
 AND (SELECT bool_or(r->>'conversation_kind'='agent_dm' AND r->>'conversation_label'='MERIT' AND r->>'author_name'='MERIT')
   FROM jsonb_array_elements((:'search_sam')::jsonb->'results') r)
 AND (SELECT bool_or(r->>'conversation_kind'='dm' AND r->>'conversation_label'='Person 5') FROM jsonb_array_elements((:'search_sam')::jsonb->'results') r)
 AND NOT (SELECT bool_or(r->>'conversation_id'=:'dm_merit') FROM jsonb_array_elements(pg_temp.j(:'u1', format('public.team_hub_search(%L::uuid,%L)', :'ta', 'Harper'))->'results') r),
 'search names an agent DM and an agent''s message by the agent, still names a person DM by its person (the uuid cast never sees an agent key), and never shows the owner Sam''s agent DM');
SELECT pg_temp.check((SELECT bool_and((p->>'agent_name_clash')::boolean=(p->>'user_id'=:'u6'))
   FROM jsonb_array_elements(pg_temp.j(:'u1', format('public.team_hub_list_conversations(%L::uuid)', :'ta'))->'people') p),
 'the roster marks exactly the teammate whose first name is an agent''s name (Vera Lane), so the screen can add a surname initial');
\echo 'PASS: agent mentions, acceptance (rule 2, service role only), single-use posting, replay and wrong-token refusal, the one-reply rule, unread for everyone, the agent DM, the private-part line, thread placement and labels'

-- 5j. The per-seat cap: at most 30 model turns started per person per rolling hour in a workspace.
-- Every start counts, each acceptance and each re-arm of an ended or abandoned turn ("Ask again"
-- re-runs a full model turn). A refusal starts nothing. Another person is unaffected.
CREATE FUNCTION pg_temp.used(asker text) RETURNS int LANGUAGE sql AS $$
 SELECT coalesce(sum((SELECT count(*) FROM unnest(t.attempts) a(at) WHERE a.at>now()-interval '1 hour')),0)::int
 FROM public.team_hub_agent_turns t WHERE t.asker_user_id=asker::uuid $$;
CREATE FUNCTION pg_temp.burst(tenant text, asker text, channel text, n int) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE codes text[]:='{}'; m jsonb; i int; a jsonb;
BEGIN
 FOR i IN 1..n LOOP
  m:=pg_temp.post(asker, tenant, channel, '@ZION task '||i, '{zion}');
  a:=pg_temp.accept(tenant, asker, channel, m#>>'{message,id}', 'zion', 'reply', pg_temp.tok('burst-'||i));
  codes:=codes||coalesce(a->>'code',CASE WHEN a->>'ok'='true' THEN 'ok' END, a->>'error');
 END LOOP;
 RETURN codes;
END $$;
-- Accept, then end without posting, n times on ONE source: the first start is a new turn, every later
-- one re-arms it. Returns ok / rearmed / the refusal code for each start.
CREATE FUNCTION pg_temp.cycle(tenant text, asker text, channel text, src text, agent text, tag text, n int) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE codes text[]:='{}'; i int; a jsonb; e jsonb;
BEGIN
 FOR i IN 1..n LOOP
  a:=pg_temp.accept(tenant, asker, channel, src, agent, 'reply', pg_temp.tok(tag||'-'||i));
  IF a->>'ok'='true' THEN
   e:=pg_temp.j(NULL, format('public.team_hub_end_agent_turn(%L::uuid,%L)', a->>'turn_id', pg_temp.h(pg_temp.tok(tag||'-'||i))), 'service_role');
   IF e->>'ok' IS DISTINCT FROM 'true' THEN codes:=codes||('end:'||coalesce(e->>'code',e->>'error')); CONTINUE; END IF;
  END IF;
  codes:=codes||coalesce(a->>'code',CASE WHEN a->>'rearmed'='true' THEN 'rearmed' WHEN a->>'ok'='true' THEN 'ok' END, a->>'error');
 END LOOP;
 RETURN codes;
END $$;
SELECT pg_temp.used(:'u2') AS used_before \gset
SELECT pg_temp.burst(:'ta', :'u2', :'launch', 31-:used_before) AS burst \gset
SELECT pg_temp.check(:'used_before'::int=5
 AND (:'burst')::text[]=array_fill('ok'::text, ARRAY[30-:used_before])||ARRAY['rate_limited']
 AND (SELECT count(*) FROM public.team_hub_agent_turns WHERE asker_user_id=:'u2')=30 AND pg_temp.used(:'u2')=30,
 'the 31st start for one seat in an hour is refused rate_limited');
SELECT id, token_hash FROM public.team_hub_agent_turns WHERE asker_user_id=:'u2' AND consumed_at IS NULL ORDER BY accepted_at DESC, id LIMIT 1 \gset last_
SELECT coalesce(pg_temp.j(NULL, format('public.team_hub_end_agent_turn(%L::uuid,%L)', :'last_id', pg_temp.h('wrong')), 'service_role')->>'code','none') AS end_wrong \gset
SELECT coalesce(pg_temp.j(NULL, format('public.team_hub_end_agent_turn(%L::uuid,%L)', :'last_id', :'last_token_hash'), 'service_role')->>'ok','none') AS end_ok \gset
SELECT coalesce((SELECT consumed_at IS NOT NULL AND posted_message_id IS NULL FROM public.team_hub_agent_turns WHERE id=:'last_id'),false) AS ended \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', (SELECT source_message_id::text FROM public.team_hub_agent_turns WHERE id=:'last_id'), 'zion', 'reply', pg_temp.tok('rearm')) AS rearm \gset
SELECT pg_temp.check(:'end_wrong'='not_found' AND :'end_ok'='true' AND :'ended'::boolean
 AND (:'rearm')::jsonb->>'code'='rate_limited'
 AND (SELECT consumed_at IS NOT NULL AND token_hash=:'last_token_hash' FROM public.team_hub_agent_turns WHERE id=:'last_id')
 AND (SELECT count(*) FROM public.team_hub_agent_turns WHERE asker_user_id=:'u2')=30 AND pg_temp.used(:'u2')=30,
 'a turn ends only with its own token; at the cap, Ask again on an ended turn is refused rate_limited and the turn stays ended with its old token');
SELECT pg_temp.check(pg_temp.accept(:'ta', :'u5', :'launch', :'src_marcus', 'cura', 'reply', pg_temp.tok('marcus'))->>'ok'='true',
 'another seat''s turns are counted separately');
-- Accept-and-end on one source, again and again: each re-arm runs a model turn, so it counts.
SELECT pg_temp.post(:'u4', :'ta', :'launch', '@ZION one question, asked over and over', '{zion}')#>>'{message,id}' AS src_cycle \gset
SELECT pg_temp.used(:'u4') AS u4_before \gset
SELECT pg_temp.cycle(:'ta', :'u4', :'launch', :'src_cycle', 'zion', 'cyc', 31) AS cycles \gset
SELECT pg_temp.check(:'u4_before'::int=0
 AND (:'cycles')::text[]=ARRAY['ok']||array_fill('rearmed'::text, ARRAY[29])||ARRAY['rate_limited']
 AND (SELECT count(*) FROM public.team_hub_agent_turns WHERE source_message_id=:'src_cycle')=1
 AND pg_temp.used(:'u4')=30,
 'accept-and-end cycles on one source: a new turn, 29 re-arms (Ask again works under the cap), then rate_limited; one row, 30 starts');
-- A turn whose edge invocation died without ending it is not "running" for ever: after 10 minutes a
-- retry re-arms it (and counts), and the abandoned invocation's token stops working.
SELECT pg_temp.post(:'u3', :'ta', :'launch', '@NEXUS stale check', '{nexus}')#>>'{message,id}' AS src_stale \gset
SELECT pg_temp.accept(:'ta', :'u3', :'launch', :'src_stale', 'nexus', 'reply', pg_temp.tok('S1'))->>'turn_id' AS stale_turn \gset
SELECT pg_temp.accept(:'ta', :'u3', :'launch', :'src_stale', 'nexus', 'reply', pg_temp.tok('S2'))->>'code' AS stale_running \gset
-- The invocation started 11 minutes ago (its attempt with it: the newest attempt is always accepted_at).
UPDATE public.team_hub_agent_turns SET accepted_at=now()-interval '11 minutes', attempts=ARRAY[now()-interval '11 minutes'] WHERE id=:'stale_turn';
SELECT pg_temp.used(:'u3') AS u3_before_stale \gset
SELECT pg_temp.accept(:'ta', :'u3', :'launch', :'src_stale', 'nexus', 'reply', pg_temp.tok('S2')) AS stale_rearm \gset
SELECT pg_temp.agent_post(:'u3', :'ta', :'launch', 'nexus', 'late', gen_random_uuid()::text, NULL, :'src_stale', 'reply', pg_temp.tok('S1'))->>'code' AS stale_old \gset
SELECT pg_temp.check(:'stale_running'='in_flight'
 AND (:'stale_rearm')::jsonb @> jsonb_build_object('ok',true,'rearmed',true,'turn_id',:'stale_turn')
 AND pg_temp.used(:'u3')=:'u3_before_stale'::int+1
 AND :'stale_old'='not_allowed'
 AND pg_temp.agent_post(:'u3', :'ta', :'launch', 'nexus', 'On time', gen_random_uuid()::text, NULL, :'src_stale', 'reply', pg_temp.tok('S2'))->>'ok'='true'
 AND (SELECT count(*) FROM public.team_hub_agent_turns WHERE source_message_id=:'src_stale')=1,
 'a running turn answers in_flight; one left unended for 10 minutes re-arms on retry (one row, one more start counted), and the abandoned token is refused');
\echo 'PASS: the per-seat cap of 30 starts per hour (re-arms counted), the end door, Ask again under the cap, and the stale re-arm'

-- 5k. A seat that ends takes its agent DMs and running turns with it; a hold keeps them; an agent DM
-- holding a file record is left for the files retirement provider, never stranded in Storage.
UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=:'ta' AND user_id=:'u2';
SELECT pg_temp.check(EXISTS(SELECT 1 FROM public.team_hub_channels WHERE id=:'dm_merit')
 AND EXISTS(SELECT 1 FROM public.team_hub_agent_turns WHERE asker_user_id=:'u2' AND consumed_at IS NULL),
 'a suspension (a hold) keeps the agent DM and the running turns');
UPDATE public.tenant_members SET status='active' WHERE tenant_id=:'ta' AND user_id=:'u2';
SELECT pg_temp.j(:'u5', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'cura'))->>'channel_id' AS dm_marcus_files \gset
INSERT INTO public.team_hub_files(id,tenant_id,channel_id,uploaded_by,client_request_id,storage_path,file_name,mime_type,size_bytes)
 VALUES ('51000000-0000-4000-8000-000000000001',:'ta',:'dm_marcus_files',:'u5',gen_random_uuid(),
  :'ta'||'/team-hub/51000000-0000-4000-8000-000000000001','notes.txt','text/plain',10);
SELECT pg_temp.post(:'u5', :'ta', :'dm_marcus_files', 'Notes for the Harper call')#>>'{message,id}' AS marcus_note \gset
SELECT count(*) AS consumed_before FROM public.team_hub_agent_turns WHERE asker_user_id=:'u2' AND consumed_at IS NOT NULL AND channel_id=:'launch' \gset
DELETE FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id IN (:'u2', :'u5');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.team_hub_channels WHERE id=:'dm_merit')
 AND NOT EXISTS(SELECT 1 FROM public.team_hub_agent_turns WHERE asker_user_id=:'u2' AND consumed_at IS NULL)
 AND (SELECT count(*) FROM public.team_hub_agent_turns WHERE asker_user_id=:'u2' AND consumed_at IS NOT NULL AND channel_id=:'launch')=:consumed_before
 AND EXISTS(SELECT 1 FROM public.team_hub_messages WHERE id=:'reply1_id')
 AND EXISTS(SELECT 1 FROM public.team_hub_channels WHERE id=:'dm_marcus_files')
 AND NOT EXISTS(SELECT 1 FROM public.team_hub_channel_members WHERE channel_id=:'dm_marcus_files'),
 'when a seat ends its agent DMs and running turns go; replies already posted in a channel stay; an agent DM with a file record stays, memberless');
-- Marcus is re-invited: his kept agent DM comes back with its history, as a person DM does.
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES (:'ta',:'u5','member','active',false,now());
SELECT pg_temp.j(:'u5', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'cura'))->>'channel_id' AS dm_marcus_back \gset
SELECT pg_temp.check(:'dm_marcus_back'=:'dm_marcus_files'
 AND (SELECT bool_or(m->>'id'=:'marcus_note') FROM jsonb_array_elements(pg_temp.j(:'u5', format('public.team_hub_list_messages(%L::uuid,%L::uuid)', :'ta', :'dm_marcus_files'))->'messages') m),
 'a re-invited person reopens the agent DM kept for its file, with its history');
DELETE FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u5';

-- 5l. Deleting a workspace still cascades through Team Hub, agent rows included.
SELECT pg_temp.j(:'u7', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'tb','general','team','{}'))->>'channel_id' AS b_general \gset
SELECT pg_temp.post(:'u7', :'tb', :'b_general', '@PAIGE hello', '{paige}')#>>'{message,id}' AS b_src \gset
SELECT pg_temp.accept(:'tb', :'u7', :'b_general', :'b_src', 'paige', 'reply', pg_temp.tok('B1'))->>'ok' AS b_a \gset
SELECT pg_temp.agent_post(:'u7', :'tb', :'b_general', 'paige', 'Hello!', gen_random_uuid()::text, NULL, :'b_src', 'reply', pg_temp.tok('B1'))->>'ok' AS b_p \gset
SELECT pg_temp.j(:'u7', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'tb', 'zion'))->>'ok' AS b_dm \gset
SELECT pg_temp.err(format('DELETE FROM public.tenants WHERE id=%L', :'tb')) AS b_deleted \gset
SELECT pg_temp.check(:'b_a'='true' AND :'b_p'='true' AND :'b_dm'='true' AND :'b_deleted'='ok'
 AND NOT EXISTS(SELECT 1 FROM public.team_hub_agent_turns WHERE tenant_id=:'tb')
 AND NOT EXISTS(SELECT 1 FROM public.team_hub_channels WHERE tenant_id=:'tb'),
 'deleting a workspace cascades through tenant_members and Team Hub, agent turns and agent DMs included, without error');
\echo 'PASS: a seat that ends drops its agent DMs and running turns (a hold keeps them; a DM holding a file is left, and returns with its history on re-invite); deleting a workspace cascades cleanly'

-- 5m. MUTANTS (§71.4). Each guard is weakened on its own, inside a transaction that is rolled back,
-- and the property it protects is re-probed: every mutant must make its probe fail. Setup runs outside
-- the transaction (one transaction has one now(), which unread and the cap read). A mutant that does
-- not change the body it names stops the run, so a silent no-op can never pass.
RESET ROLE;
CREATE FUNCTION pg_temp.mutate(fn regprocedure, old text, new text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE body text:=pg_get_functiondef(fn);
BEGIN
 IF (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'mutant does not match % exactly once', fn; END IF;
 EXECUTE replace(body,old,new);
END $$;
CREATE TEMP TABLE mutant_results(mutant text PRIMARY KEY, guarded boolean);
SELECT pg_temp.j(:'u1', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'ta','mutants','team','{}'))->>'channel_id' AS mch \gset
SELECT pg_temp.check(pg_temp.j(u, format('public.team_hub_join_channel(%L::uuid,%L::uuid)', :'ta', :'mch'))->>'ok'='true', 'mutants: a teammate joins #mutants')
 FROM unnest(ARRAY[:'u3', :'u6']) u;
SELECT pg_temp.post(:'u3', :'ta', :'mch', '@CURA m', '{cura}')#>>'{message,id}' AS msrc \gset
SELECT pg_temp.accept(:'ta', :'u3', :'mch', :'msrc', 'cura', 'reply', pg_temp.tok('M')) ->>'ok' AS macc \gset
SELECT pg_temp.check(:'macc'='true', 'mutants: setup turn accepted');

-- M1: the post door no longer matches the token.
BEGIN;
SELECT pg_temp.mutate('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)', ' AND t.token_hash=hashed FOR UPDATE;', ' FOR UPDATE;');
SELECT coalesce((pg_temp.agent_post(:'u3', :'ta', :'mch', 'cura', 'forged', gen_random_uuid()::text, NULL, :'msrc', 'reply', pg_temp.tok('wrong'))->>'code'='not_allowed'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M1 token not matched', :'g');
-- M2: a post no longer consumes its turn (replay).
SELECT pg_temp.agent_post(:'u3', :'ta', :'mch', 'cura', 'First answer', gen_random_uuid()::text, NULL, :'msrc', 'reply', pg_temp.tok('M'))#>>'{message,id}' AS mreply \gset
SELECT pg_temp.check(:'mreply'<>'', 'mutants: setup reply posted');
BEGIN;
UPDATE public.team_hub_agent_turns SET consumed_at=NULL, posted_message_id=NULL WHERE source_message_id=:'msrc';
DROP INDEX public.team_hub_messages_agent_reply_key;
SELECT pg_temp.mutate('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)',
 E' UPDATE public.team_hub_agent_turns t SET consumed_at=now(), posted_message_id=msg.id WHERE t.id=turn.id;\n RETURN jsonb_build_object(''ok'',true,''message'',public._team_hub_message_json(msg));',
 E' RETURN jsonb_build_object(''ok'',true,''message'',public._team_hub_message_json(msg));');
SELECT pg_temp.agent_post(:'u3', :'ta', :'mch', 'cura', 'once', gen_random_uuid()::text, NULL, :'msrc', 'reply', pg_temp.tok('M'))->>'ok' AS once \gset
SELECT coalesce((pg_temp.agent_post(:'u3', :'ta', :'mch', 'cura', 'twice', gen_random_uuid()::text, NULL, :'msrc', 'reply', pg_temp.tok('M'))->>'code' IS DISTINCT FROM NULL),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M2 turn not consumed (replay)', :'g');
-- M3: the one-reply index is gone.
BEGIN;
DROP INDEX public.team_hub_messages_agent_reply_key;
SELECT coalesce((pg_temp.err(format('INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,author_kind,agent_key,asked_in_message_id) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L,%L,%L)',
  :'ta', :'mch', :'u3', 'second', 'agent', 'cura', :'msrc'))<>'ok'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M3 one-reply index dropped', :'g');
-- M4: acceptance is open to a signed-in person (grant and body check both removed).
BEGIN;
GRANT EXECUTE ON FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) TO authenticated;
SELECT pg_temp.mutate('public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)',
 E' IF auth.uid() IS NOT NULL THEN RETURN jsonb_build_object(''ok'',false,''code'',''not_allowed''); END IF;\n', E'\n');
SELECT pg_temp.post(:'u3', :'ta', :'mch', '@ZION self', '{zion}')#>>'{message,id}' AS m4src \gset
SELECT coalesce((pg_temp.j(:'u3', format('public.team_hub_accept_agent_turn(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)', :'ta', :'u3', :'mch', :'m4src', 'zion','reply', pg_temp.h(pg_temp.tok('self'))))->>'ok' IS DISTINCT FROM 'true'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M4 acceptance open to authenticated', :'g');
-- M5: rule 2 no longer needs the message to ask this agent.
BEGIN;
SELECT pg_temp.mutate('public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)',
 E' OR NOT EXISTS(SELECT 1 FROM public.team_hub_message_agent_mentions x\n    WHERE x.message_id=src.id AND x.agent_key=p_agent_key) THEN', ' THEN');
SELECT coalesce((pg_temp.accept(:'ta', :'u3', :'mch', :'msrc', 'vera', 'reply', pg_temp.tok('M5'))->>'code'='not_allowed'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M5 rule 2 mention not required', :'g');
-- M6: the post door no longer binds the turn to its conversation.
SELECT pg_temp.j(:'u1', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'ta','mutants-two','team','{}'))->>'channel_id' AS mch2 \gset
SELECT pg_temp.post(:'u3', :'ta', :'mch', '@MENTOR m6', '{mentor}')#>>'{message,id}' AS m6src \gset
SELECT pg_temp.accept(:'ta', :'u3', :'mch', :'m6src', 'mentor', 'reply', pg_temp.tok('M6'))->>'ok' AS m6acc \gset
BEGIN;
SELECT pg_temp.mutate('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)', E'\n  AND t.channel_id=ch.id AND t.agent_key=p_agent_key', E'\n  AND t.agent_key=p_agent_key');
SELECT coalesce((pg_temp.agent_post(:'u3', :'ta', :'mch2', 'mentor', 'elsewhere', gen_random_uuid()::text, NULL, NULL, 'reply', pg_temp.tok('M6'))->>'code'='not_allowed'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M6 turn not bound to its conversation', :'g');
-- M7: the per-seat cap is off by one.
SELECT pg_temp.used(:'u3') AS m7_used \gset
SELECT pg_temp.burst(:'ta', :'u3', :'mch', 29-:m7_used) AS m7_fill \gset
BEGIN;
SELECT pg_temp.mutate('public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)', 'IF used>=30 THEN', 'IF used>=31 THEN');
SELECT coalesce(((pg_temp.burst(:'ta', :'u3', :'mch', 2))[2]='rate_limited'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M7 cap 31 not 30', :'g');
-- M8: a stale turn is "running" for ever.
SELECT pg_temp.post(:'u6', :'ta', :'mch', '@NEXUS m8', '{nexus}')#>>'{message,id}' AS m8src \gset
SELECT pg_temp.accept(:'ta', :'u6', :'mch', :'m8src', 'nexus', 'reply', pg_temp.tok('M8a'))->>'turn_id' AS m8turn \gset
UPDATE public.team_hub_agent_turns SET accepted_at=now()-interval '11 minutes', attempts=ARRAY[now()-interval '11 minutes'] WHERE id=:'m8turn';
BEGIN;
SELECT pg_temp.mutate('public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)', E'turn.accepted_at>now()-interval ''10 minutes''', 'true');
SELECT coalesce((pg_temp.accept(:'ta', :'u6', :'mch', :'m8src', 'nexus', 'reply', pg_temp.tok('M8b'))->>'ok'='true'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M8 stale turn never re-arms', :'g');
-- M9: unread no longer counts an agent's reply for the person who asked.
SELECT pg_temp.post(:'u6', :'ta', :'mch', '@CURA m9', '{cura}')#>>'{message,id}' AS m9src \gset
SELECT pg_temp.j(:'u6', format('public.team_hub_mark_read(%L::uuid,%L::uuid,%L::uuid)', :'ta', :'mch', :'m9src'))->>'ok' AS m9read \gset
SELECT pg_temp.accept(:'ta', :'u6', :'mch', :'m9src', 'cura', 'reply', pg_temp.tok('M9'))->>'ok' AS m9acc \gset
SELECT pg_temp.agent_post(:'u6', :'ta', :'mch', 'cura', 'Answer for Vera Lane', gen_random_uuid()::text, NULL, :'m9src', 'reply', pg_temp.tok('M9'))->>'ok' AS m9post \gset
SELECT pg_temp.check(:'m9read'='true' AND :'m9acc'='true' AND :'m9post'='true' AND pg_temp.unread(:'u6', :'ta', :'mch')=1, 'mutants: the asker has exactly the agent reply unread');
BEGIN;
SELECT pg_temp.mutate('public.team_hub_list_conversations(uuid)', E'AND (x.author_user_id<>actor OR x.author_kind=''agent'')', 'AND x.author_user_id<>actor');
SELECT coalesce((pg_temp.unread(:'u6', :'ta', :'mch')=1),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M9 agent reply not unread for the asker', :'g');
-- M10: an agent DM admits a second member.
SELECT pg_temp.j(:'u6', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'zion'))->>'channel_id' AS m10dm \gset
BEGIN;
SELECT pg_temp.mutate('public._team_hub_member_scope_guard()', E'AND c.created_by<>NEW.user_id) THEN', E'AND false) THEN');
SELECT coalesce((pg_temp.err(format('INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by) VALUES (%L,%L,%L,%L)', :'m10dm', :'ta', :'u1', :'u1'))<>'ok'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M10 agent DM admits a second member', :'g');
-- M11: a seat that ends keeps its agent DMs.
BEGIN;
SELECT pg_temp.mutate('public._team_hub_seat_ended()', E'WHERE c.tenant_id=OLD.tenant_id AND c.kind=''agent_dm''', E'WHERE false AND c.tenant_id=OLD.tenant_id AND c.kind=''agent_dm''');
DELETE FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u6';
SELECT coalesce((NOT EXISTS(SELECT 1 FROM public.team_hub_channels WHERE id=:'m10dm')),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M11 agent DM kept after the seat ends', :'g');
-- M12: a reply may link to a message in another conversation (the DM-to-channel leak).
BEGIN;
SELECT pg_temp.mutate('public._team_hub_message_scope_guard()', E'WHERE a.id=NEW.asked_in_message_id AND a.channel_id=NEW.channel_id', E'WHERE a.id=NEW.asked_in_message_id');
SELECT coalesce((pg_temp.err(format('INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,author_kind,agent_key,asked_in_message_id) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L,%L,%L)',
  :'ta', :'m10dm', :'u6', 'linked', 'agent', 'zion', :'m9src'))<>'ok'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M12 reply linked across conversations', :'g');
-- M13: the conflict-recovery path no longer checks that the stored reply answers this turn's question.
SELECT pg_temp.post(:'u6', :'ta', :'mch', '@CURA m13 question A', '{cura}')#>>'{message,id}' AS m13a \gset
SELECT pg_temp.post(:'u6', :'ta', :'mch', '@CURA m13 question B', '{cura}')#>>'{message,id}' AS m13b \gset
SELECT gen_random_uuid() AS r13 \gset
SELECT pg_temp.accept(:'ta', :'u6', :'mch', :'m13a', 'cura', 'reply', pg_temp.tok('M13A'))->>'ok' AS m13acc_a \gset
SELECT pg_temp.agent_post(:'u6', :'ta', :'mch', 'cura', 'Answer to A', :'r13', NULL, :'m13a', 'reply', pg_temp.tok('M13A'))->>'ok' AS m13post_a \gset
SELECT pg_temp.accept(:'ta', :'u6', :'mch', :'m13b', 'cura', 'reply', pg_temp.tok('M13B'))->>'turn_id' AS m13turn_b \gset
SELECT pg_temp.check(:'m13acc_a'='true' AND :'m13post_a'='true' AND :'m13turn_b'<>'', 'mutants: M13 setup');
BEGIN;
-- Turn A's binding is cleared (the race state the earlier probe builds), so only the question-and-place
-- check stands between turn B and A's reply; the another-turn's-reply guard is M24's.
UPDATE public.team_hub_agent_turns SET consumed_at=NULL, posted_message_id=NULL WHERE source_message_id=:'m13a' AND agent_key='cura';
SELECT pg_temp.mutate('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)',
 E'\n    OR msg.asked_in_message_id IS DISTINCT FROM p_asked_in_message_id\n    OR msg.parent_message_id IS DISTINCT FROM p_parent_message_id THEN', ' THEN');
SELECT coalesce((pg_temp.agent_post(:'u6', :'ta', :'mch', 'cura', 'Answer to B', :'r13', NULL, :'m13b', 'reply', pg_temp.tok('M13B'))->>'code'='invalid'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M13 reused request id binds another question''s reply', :'g');
-- M24: the conflict-recovery path no longer refuses a row that is already another turn's reply. Vera Lane
-- asks CURA question X in #mutants and Y in #m24-two; both are accepted as dm turns into her CURA DM, where
-- each answer posts unlinked at the top level, so place and link cannot tell X's answer from Y's. X's
-- answer posts under request id R24; Y's answer then arrives under the same R24.
SELECT pg_temp.j(:'u1', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'ta','m24-two','team','{}'))->>'channel_id' AS m24ch \gset
SELECT pg_temp.j(:'u6', format('public.team_hub_join_channel(%L::uuid,%L::uuid)', :'ta', :'m24ch'))->>'ok' AS m24join \gset
SELECT pg_temp.post(:'u6', :'ta', :'mch', '@CURA m24 question X', '{cura}')#>>'{message,id}' AS m24x \gset
SELECT pg_temp.post(:'u6', :'ta', :'m24ch', '@CURA m24 question Y', '{cura}')#>>'{message,id}' AS m24y \gset
SELECT pg_temp.j(:'u6', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'cura'))->>'channel_id' AS m24dm \gset
SELECT gen_random_uuid() AS r24 \gset
SELECT pg_temp.accept(:'ta', :'u6', :'m24dm', :'m24x', 'cura', 'dm', pg_temp.tok('M24X'))->>'turn_id' AS m24turn_x \gset
SELECT pg_temp.agent_post(:'u6', :'ta', :'m24dm', 'cura', 'Answer to X', :'r24', NULL, NULL, 'dm', pg_temp.tok('M24X'))#>>'{message,id}' AS m24reply_x \gset
SELECT pg_temp.accept(:'ta', :'u6', :'m24dm', :'m24y', 'cura', 'dm', pg_temp.tok('M24Y'))->>'turn_id' AS m24turn_y \gset
SELECT pg_temp.check(:'m24join'='true' AND :'m24x'<>'' AND :'m24y'<>'' AND :'m24turn_x'<>'' AND :'m24reply_x'<>'' AND :'m24turn_y'<>''
 AND (SELECT posted_message_id=(:'m24reply_x')::uuid FROM public.team_hub_agent_turns WHERE id=:'m24turn_x'),
 'mutants: M24 setup, two dm turns into one agent DM from two conversations; X answered under R24');
-- Unmutated: Y's answer under R24 is refused invalid; turn Y stays open and unbound, turn X keeps its reply.
SELECT pg_temp.agent_post(:'u6', :'ta', :'m24dm', 'cura', 'Answer to Y', :'r24', NULL, NULL, 'dm', pg_temp.tok('M24Y')) AS m24y_reused \gset
SELECT pg_temp.check((:'m24y_reused')::jsonb->>'code'='invalid'
 AND (SELECT consumed_at IS NULL AND posted_message_id IS NULL FROM public.team_hub_agent_turns WHERE id=:'m24turn_y')
 AND (SELECT posted_message_id=(:'m24reply_x')::uuid FROM public.team_hub_agent_turns WHERE id=:'m24turn_x')
 AND (SELECT count(*) FROM public.team_hub_messages WHERE channel_id=:'m24dm' AND author_kind='agent')=1,
 'a dm answer sent under the request id another dm turn''s reply holds is refused invalid; turn Y is neither consumed nor bound to X''s reply');
BEGIN;
SELECT pg_temp.mutate('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)',
 E'\n    OR EXISTS(SELECT 1 FROM public.team_hub_agent_turns o WHERE o.posted_message_id=msg.id AND o.id<>turn.id)', '');
SELECT pg_temp.agent_post(:'u6', :'ta', :'m24dm', 'cura', 'Answer to Y', :'r24', NULL, NULL, 'dm', pg_temp.tok('M24Y')) AS m24mut \gset
SELECT coalesce(((:'m24mut')::jsonb->>'code'='invalid'
 AND (SELECT consumed_at IS NULL AND posted_message_id IS NULL FROM public.team_hub_agent_turns WHERE id=:'m24turn_y')),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M24 recovery binds another turn''s reply', :'g');
-- Turn Y then posts its own answer under a fresh request id, bound to itself.
SELECT pg_temp.agent_post(:'u6', :'ta', :'m24dm', 'cura', 'Answer to Y', gen_random_uuid()::text, NULL, NULL, 'dm', pg_temp.tok('M24Y')) AS m24y_reply \gset
SELECT pg_temp.check((:'m24y_reply')::jsonb->>'ok'='true' AND (:'m24y_reply')::jsonb->>'duplicate' IS NULL
 AND (SELECT posted_message_id=((:'m24y_reply')::jsonb#>>'{message,id}')::uuid FROM public.team_hub_agent_turns WHERE id=:'m24turn_y'),
 'turn Y then posts its own answer, bound to turn Y');
-- M14: a re-arm skips the cap. M15: the cap counts rows, not starts. Both re-probed by accept-and-end
-- cycles on one source for a seat with no turns yet (Person 8, in #mutants-two so #mutants' unread
-- counts stay as the M9 control reads them), rolled back each time.
SELECT pg_temp.post(:'u8', :'ta', :'mch2', '@ZION m14 asked over and over', '{zion}')#>>'{message,id}' AS m14src \gset
SELECT pg_temp.check(:'m14src'<>'' AND pg_temp.used(:'u8')=0, 'mutants: M14/M15 setup, a seat with no turns');
BEGIN;
SELECT pg_temp.mutate('public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)',
 'IF used>=30 THEN', 'IF used>=30 AND NOT existing THEN');
SELECT coalesce(((pg_temp.cycle(:'ta', :'u8', :'mch2', :'m14src', 'zion', 'm14', 31))[31]='rate_limited'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M14 re-arm skips the cap', :'g');
BEGIN;
SELECT pg_temp.mutate('public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)',
 E'SELECT coalesce(sum((SELECT count(*) FROM unnest(t.attempts) a(at) WHERE a.at>now()-interval ''1 hour'')),0) INTO used', 'SELECT count(*) INTO used');
SELECT coalesce(((pg_temp.cycle(:'ta', :'u8', :'mch2', :'m14src', 'zion', 'm15', 31))[31]='rate_limited'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M15 cap counts rows not starts', :'g');
-- M16: a reply turn no longer needs its source to be in the conversation it answers in.
SELECT pg_temp.post(:'u6', :'ta', :'mch', '@VERA m16', '{vera}')#>>'{message,id}' AS m16src \gset
BEGIN;
SELECT pg_temp.mutate('public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)', 'OR src.channel_id<>ch.id OR', 'OR');
SELECT coalesce((pg_temp.accept(:'ta', :'u6', :'mch2', :'m16src', 'vera', 'reply', pg_temp.tok('M16'))->>'code'='not_allowed'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M16 reply source in another conversation', :'g');
-- M17: a DM turn from a message elsewhere no longer needs that message to ask this agent (rule 2).
SELECT pg_temp.post(:'u6', :'ta', :'mch', '@CURA m17', '{cura}')#>>'{message,id}' AS m17src \gset
BEGIN;
SELECT pg_temp.mutate('public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)',
 E'\n    OR NOT EXISTS(SELECT 1 FROM public.team_hub_message_agent_mentions x WHERE x.message_id=src.id AND x.agent_key=p_agent_key)) THEN', ') THEN');
SELECT coalesce((pg_temp.accept(:'ta', :'u6', :'m10dm', :'m17src', 'zion', 'dm', pg_temp.tok('M17'))->>'code'='not_allowed'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M17 dm turn from a message that does not ask this agent', :'g');
-- M18: a DM turn from a message elsewhere no longer needs the asker to still see that conversation.
SELECT pg_temp.j(:'u6', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'ta','m18-private','private', format('{%s}', :'u1')))->>'channel_id' AS m18ch \gset
SELECT pg_temp.post(:'u6', :'ta', :'m18ch', '@ZION m18 the plan in here', '{zion}')#>>'{message,id}' AS m18src \gset
SELECT pg_temp.j(:'u6', format('public.team_hub_leave_channel(%L::uuid,%L::uuid)', :'ta', :'m18ch'))->>'ok' AS m18left \gset
SELECT pg_temp.check(:'m18src'<>'' AND :'m18left'='true' AND NOT EXISTS(SELECT 1 FROM public._team_hub_visible(:'ta', :'u6', :'m18ch')),
 'mutants: M18 setup, the asker left the private channel her question is in');
BEGIN;
SELECT pg_temp.mutate('public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)',
 E'(NOT EXISTS(SELECT 1 FROM public._team_hub_visible(p_tenant,p_asker,src.channel_id))\n    OR NOT EXISTS(SELECT 1 FROM public.team_hub_message_agent_mentions x WHERE',
 '(NOT EXISTS(SELECT 1 FROM public.team_hub_message_agent_mentions x WHERE');
SELECT coalesce((pg_temp.accept(:'ta', :'u6', :'m10dm', :'m18src', 'zion', 'dm', pg_temp.tok('M18'))->>'code'='not_allowed'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M18 dm turn from a conversation the asker no longer sees', :'g');
-- M19: the post door no longer refuses a source deleted after its turn was accepted.
SELECT pg_temp.post(:'u6', :'ta', :'mch', '@MENTOR m19', '{mentor}')#>>'{message,id}' AS m19src \gset
SELECT pg_temp.accept(:'ta', :'u6', :'mch', :'m19src', 'mentor', 'reply', pg_temp.tok('M19'))->>'ok' AS m19acc \gset
UPDATE public.team_hub_messages SET deleted_at=now() WHERE id=:'m19src';
SELECT pg_temp.check(:'m19acc'='true', 'mutants: M19 setup, accepted then the question deleted');
BEGIN;
SELECT pg_temp.mutate('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)',
 E' IF src.deleted_at IS NOT NULL\n   OR p_asked_in_message_id', ' IF p_asked_in_message_id');
SELECT coalesce((pg_temp.agent_post(:'u6', :'ta', :'mch', 'mentor', 'late answer', gen_random_uuid()::text, NULL, :'m19src', 'reply', pg_temp.tok('M19'))->>'code'='invalid'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M19 post answers a deleted question', :'g');
-- M20: acceptance no longer refuses a deleted source.
SELECT pg_temp.post(:'u6', :'ta', :'mch', '@MERIT m20', '{merit}')#>>'{message,id}' AS m20src \gset
UPDATE public.team_hub_messages SET deleted_at=now() WHERE id=:'m20src';
BEGIN;
SELECT pg_temp.mutate('public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)',
 ' AND m.author_kind=''user'' AND m.deleted_at IS NULL;', ' AND m.author_kind=''user'';');
SELECT coalesce((pg_temp.accept(:'ta', :'u6', :'mch', :'m20src', 'merit', 'reply', pg_temp.tok('M20'))->>'code'='not_allowed'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M20 acceptance of a deleted question', :'g');
-- M21: a seat that ends deletes an agent DM that holds a file record (the record goes, its bytes strand).
SELECT pg_temp.j(:'u6', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'cura'))->>'channel_id' AS m21dm \gset
INSERT INTO public.team_hub_files(id,tenant_id,channel_id,uploaded_by,client_request_id,storage_path,file_name,mime_type,size_bytes)
 VALUES ('51000000-0000-4000-8000-000000000002',:'ta',:'m21dm',:'u6',gen_random_uuid(),
  :'ta'||'/team-hub/51000000-0000-4000-8000-000000000002','plan.txt','text/plain',10);
BEGIN;
SELECT pg_temp.mutate('public._team_hub_seat_ended()', E'\n    AND NOT EXISTS(SELECT 1 FROM public.team_hub_files f WHERE f.channel_id=c.id)', '');
SELECT pg_temp.err(format('DELETE FROM public.tenant_members WHERE tenant_id=%L AND user_id=%L', :'ta', :'u6')) AS m21del \gset
SELECT coalesce((:'m21del'='ok' AND EXISTS(SELECT 1 FROM public.team_hub_files WHERE id='51000000-0000-4000-8000-000000000002')
 AND EXISTS(SELECT 1 FROM public.team_hub_channels WHERE id=:'m21dm')),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M21 seat end drops an agent DM holding a file', :'g');
-- M22: search no longer names an agent DM by its agent. M23: nor an agent's message by the agent.
SELECT pg_temp.post(:'u6', :'ta', :'m10dm', 'zebra stripes on the m22 plan')->>'ok' AS m22post \gset
SELECT pg_temp.check(:'m22post'='true', 'mutants: M22 setup, a message in the agent DM');
CREATE FUNCTION pg_temp.search_has(actor text, q text, field text, want text) RETURNS boolean LANGUAGE sql AS $$
 SELECT coalesce(bool_or(r->>field=want),false) FROM jsonb_array_elements(pg_temp.j(actor, format('public.team_hub_search(%L::uuid,%L)',
  '20000000-0000-4000-8000-00000000000a', q))->'results') r $$;
BEGIN;
SELECT pg_temp.mutate('public.team_hub_search(uuid,text,integer)',
 E'CASE WHEN h.kind=''agent_dm'' THEN public._team_hub_agent_name(h.channel_agent_key)\n    WHEN h.kind<>''dm'' THEN h.name', 'CASE WHEN h.kind<>''dm'' THEN h.name');
SELECT pg_temp.search_has(:'u6', 'zebra stripes', 'conversation_label', 'ZION') AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M22 agent DM not labelled by its agent in search', :'g');
BEGIN;
SELECT pg_temp.mutate('public.team_hub_search(uuid,text,integer)',
 E'CASE WHEN h.author_kind=''agent'' THEN public._team_hub_agent_name(h.agent_key)\n    WHEN public._team_hub_is_active', 'CASE WHEN public._team_hub_is_active');
SELECT pg_temp.search_has(:'u6', 'Answer for Vera Lane', 'author_name', 'CURA') AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('M23 agent message not named by its agent in search', :'g');
-- Controls: with nothing mutated, each probe that can be re-run holds.
SELECT pg_temp.check(pg_temp.agent_post(:'u3', :'ta', :'mch', 'cura', 'forged', gen_random_uuid()::text, NULL, :'msrc', 'reply', pg_temp.tok('wrong'))->>'code'='not_allowed'
 AND pg_temp.accept(:'ta', :'u3', :'mch', :'msrc', 'vera', 'reply', pg_temp.tok('M5'))->>'code'='not_allowed'
 AND pg_temp.agent_post(:'u3', :'ta', :'mch2', 'mentor', 'elsewhere', gen_random_uuid()::text, NULL, NULL, 'reply', pg_temp.tok('M6'))->>'code'='not_allowed'
-- Two unread for Vera Lane now: the M9 reply and M13's reply to question A (an agent's row is
 -- unread for the person who asked it, which is what M9 protects).
 AND pg_temp.unread(:'u6', :'ta', :'mch')=2
 AND pg_temp.agent_post(:'u6', :'ta', :'mch', 'cura', 'Answer to B', :'r13', NULL, :'m13b', 'reply', pg_temp.tok('M13B'))->>'code'='invalid'
 AND (SELECT posted_message_id IS NULL AND consumed_at IS NULL FROM public.team_hub_agent_turns WHERE id=:'m13turn_b')
 AND pg_temp.accept(:'ta', :'u6', :'mch2', :'m16src', 'vera', 'reply', pg_temp.tok('M16'))->>'code'='not_allowed'
 AND pg_temp.accept(:'ta', :'u6', :'m10dm', :'m17src', 'zion', 'dm', pg_temp.tok('M17'))->>'code'='not_allowed'
 AND pg_temp.accept(:'ta', :'u6', :'m10dm', :'m18src', 'zion', 'dm', pg_temp.tok('M18'))->>'code'='not_allowed'
 AND pg_temp.agent_post(:'u6', :'ta', :'mch', 'mentor', 'late answer', gen_random_uuid()::text, NULL, :'m19src', 'reply', pg_temp.tok('M19'))->>'code'='invalid'
 AND pg_temp.accept(:'ta', :'u6', :'mch', :'m20src', 'merit', 'reply', pg_temp.tok('M20'))->>'code'='not_allowed'
 AND pg_temp.search_has(:'u6', 'zebra stripes', 'conversation_label', 'ZION')
 AND pg_temp.search_has(:'u6', 'Answer for Vera Lane', 'author_name', 'CURA'),
 'mutants: every re-runnable probe holds on the unmutated migration (controls)');
-- The two controls that write: the seat-end file guard (rolled back) and the cap cycles (Person 8, last).
BEGIN;
SELECT pg_temp.err(format('DELETE FROM public.tenant_members WHERE tenant_id=%L AND user_id=%L', :'ta', :'u6')) AS c21del \gset
SELECT (:'c21del'='ok' AND EXISTS(SELECT 1 FROM public.team_hub_files WHERE id='51000000-0000-4000-8000-000000000002')
 AND EXISTS(SELECT 1 FROM public.team_hub_channels WHERE id=:'m21dm')
 AND NOT EXISTS(SELECT 1 FROM public.team_hub_channels WHERE id=:'m10dm')) AS c21 \gset
ROLLBACK;
SELECT pg_temp.cycle(:'ta', :'u8', :'mch2', :'m14src', 'zion', 'c14', 31) AS c14 \gset
SELECT pg_temp.check(:'c21'::boolean AND (:'c14')::text[]=ARRAY['ok']||array_fill('rearmed'::text, ARRAY[29])||ARRAY['rate_limited'],
 'mutants: unmutated, a seat end keeps the agent DM holding a file (and drops the one without), and the cycles stop at 30 starts (controls)');
SELECT pg_temp.check((SELECT count(*) FROM mutant_results)=24 AND NOT EXISTS(SELECT 1 FROM mutant_results WHERE guarded IS NOT FALSE),
 'mutants: all 24 weakened guards break the property they protect: '||(SELECT string_agg(mutant||'='||coalesce(guarded::text,'null'), '; ' ORDER BY mutant) FROM mutant_results));
\echo 'PASS: 24 of 24 mutants (token, replay, one-reply index, acceptance grant, rule 2, conversation binding, cap, stale re-arm, unread, agent DM member, seat end, cross-conversation link, reused request id, another turn''s reply, re-arm off the cap, rows not starts, reply source elsewhere, dm source not asking, dm source not visible, post on a deleted question, acceptance of a deleted question, seat-end file guard, search DM label, search agent author) each fail their probe; controls hold'

-- 6. The roster correction (20271117010108) on the six platform rows. The table carries production's
-- columns for these rows and the rows production holds (read 2026-10-27), with two customisations made
-- first to prove the guards: NEXUS's description edited (so its remit is NOT corrected), VERA already
-- carrying its own team_hub_tools (kept).
RESET ROLE;
CREATE TABLE public.paige_subagents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, name text,
 domain text, description text, runtime text CHECK (runtime IN ('local','langgraph','soft')), enabled boolean DEFAULT true,
 display_order int DEFAULT 100, system_prompt text, config jsonb DEFAULT '{}'::jsonb, daily_invocation_cap int DEFAULT 200,
 monthly_token_cap int DEFAULT 2000000, department text, tenant_id uuid, role text, goal text, backstory text, version int DEFAULT 1,
 rail_display_name text, parent_subagent_slug text, updated_at timestamptz DEFAULT now());
INSERT INTO public.paige_subagents(slug,name,department,domain,rail_display_name,role,description,goal,backstory,version,runtime,system_prompt,config,display_order) VALUES
 ('vera','VERA','owner_ops','intelligence_finance_risk','VERA','VP Intelligence, Finance & Risk','VP Intelligence, Finance & Risk. Source-backed business performance, financial evidence, goals, trends and operational risks. Explains periods, currencies, freshness, coverage and uncertainty for PAIGE and the owner.','The owner understands actual business performance, sees evidence-backed priorities and can make an informed decision with PAIGE.','VERA is PAIGE''s intelligence specialist. She interprets permitted business records, explains financial and operational evidence, and makes recommendations whose sources and limits the owner can inspect. PAIGE remains the principal COO; VERA''s remit never grants execution authority.',2,'soft',NULL,'{"team_hub_tools":{"custom":true}}',1),
 ('nexus','NEXUS','owner_ops','growth','NEXUS','VP Growth','VP Growth (edited by this business).','Grow the tenant''s book — every campaign, sequence, and pipeline motion compounds.','NEXUS owns the growth engine end to end: what the market hears, which leads move, and why deals close. Approved sequences run autonomously; new drafts wait for the owner.',1,'soft',NULL,'{}',2),
 ('cura','CURA','client_experience','client_success','CURA','VP Client Success','VP Client Success. Client onboarding, retention, community, at-risk detection, churn prevention, the client portal and client-facing Paige. Warm by voice, relentless about the client''s outcome.','Every client feels cared for and reaches their outcome — nobody drifts.','CURA runs the client side of the house: onboarding, nurture, at-risk detection, and the portal experience. Lifecycle nudges run on their own; retention-critical outreach asks first.',1,'soft',NULL,'{}',3),
 ('mentor','MENTOR','owner_ops','discovery_education_strategy','MENTOR','VP Discovery, Education & Strategy','VP Discovery, Education & Strategy. Business discovery, entrepreneurship education, the business''s knowledge, strategic guidance, and helping the owner understand their next useful business action. Teacherly and clear.','The owner understands their business and always knows their next useful move.','MENTOR is the teacher-strategist of the team.',1,'soft',NULL,'{}',4),
 ('merit','MERIT','owner_ops','finance_people','MERIT','VP Finance & People','VP Finance & People. Money spine (L1-L4), revenue tracking, dunning, refunds, hiring and comp, contracts and IP, Business Vault obligations, entity-type adherence. Stewarding, careful.','Money and obligations are never a surprise — tracked, stewarded, and flagged early.','MERIT stewards the tenant''s money and team: retainers, dunning, contracts, and the obligations vault. Money decisions confirm; tracking and reminders run on their own.',1,'soft',NULL,'{}',5),
 ('zion','ZION','owner_ops','operations_automation','ZION','VP Operations & Automation','VP Operations & Automation. Weekly planning, work ownership, tasks, deadlines, reminders, Calendar commitments, governed workflow design, automation monitoring and safe recovery through original records and receipts.','The owner understands current responsibilities, reviews a realistic plan, authorizes permitted work and can verify what actually happened.','ZION is PAIGE''s operations specialist.',3,'soft','zion prompt','{"job_kind":"plan"}',6),
 ('design-studio','Design Studio','owner_ops','design','DESIGN','Designer','Builds pages.','g','b',1,'soft',NULL,'{"capability_scope":{"mode":"allowlist","tools":["ask_choices"]}}',50);
CREATE TEMP TABLE subagents_before AS SELECT * FROM public.paige_subagents;
\ir ../migrations/20271117010108_exp08_team_hub_agents_roster.sql
CREATE TEMP TABLE subagents_once AS SELECT * FROM public.paige_subagents;
\ir ../migrations/20271117010108_exp08_team_hub_agents_roster.sql
SELECT pg_temp.check(NOT EXISTS(SELECT to_jsonb(a)-'updated_at' FROM subagents_once a EXCEPT SELECT to_jsonb(b)-'updated_at' FROM public.paige_subagents b),
 'roster: a second apply changes nothing');
SELECT pg_temp.check((SELECT role='VP Sales & Getting Paid' AND domain='sales_getting_paid' AND version=3 AND name='MERIT' AND department='owner_ops'
   AND rail_display_name='MERIT' AND runtime='soft' AND enabled AND system_prompt IS NULL AND description LIKE 'VP Sales & Getting Paid.%'
   FROM public.paige_subagents WHERE slug='merit'),
 'roster: MERIT is corrected to Sales & getting paid (the 23 Oct standard), name, department, runtime and prompt unchanged; version 1 to 3 (remit, then config)');
SELECT pg_temp.check((SELECT role='VP Growth' AND description='VP Growth (edited by this business).' AND version=2 FROM public.paige_subagents WHERE slug='nexus'),
 'roster: an edited NEXUS seed is not overwritten (seed guard); it gains only the config version');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM subagents_before b JOIN public.paige_subagents a USING (slug)
   WHERE a.slug NOT IN ('merit') AND (to_jsonb(a)-'config'-'updated_at'-'version') IS DISTINCT FROM (to_jsonb(b)-'config'-'updated_at'-'version'))
 AND NOT EXISTS(SELECT 1 FROM subagents_before b JOIN public.paige_subagents a USING (slug)
   WHERE a.version IS DISTINCT FROM b.version + CASE WHEN a.slug='merit' THEN 2 WHEN a.slug IN ('vera','nexus','cura','mentor','zion') THEN 1 ELSE 0 END),
 'roster: every other row keeps every non-config field; a row whose config changed gains exactly one version (as the orchestrator''s config writer does), design-studio none');
SELECT pg_temp.check((SELECT config->'job_kind'='"plan"' FROM public.paige_subagents WHERE slug='zion')
 AND (SELECT config->'team_hub_tools'='{"custom":true}' FROM public.paige_subagents WHERE slug='vera')
 AND (SELECT config FROM public.paige_subagents WHERE slug='design-studio')=(SELECT config FROM subagents_before WHERE slug='design-studio')
 AND (SELECT bool_and(config ?& ARRAY['team_hub_tools','capability_scope','personality']) FROM public.paige_subagents WHERE slug IN ('vera','nexus','cura','mentor','merit','zion')),
 'roster: config keys are only ever added (ZION keeps job_kind, VERA keeps its own team_hub_tools, other agents untouched)');
SELECT pg_temp.check((SELECT bool_and(config->'team_hub_tools'='{"mode":"allowlist","tools":["team_hub_read_conversation","read_business_time_zone","ask_choices","capability_status","marketplace_browse","list_event_kinds","team_hub_answer_privately"],"version":1}'::jsonb)
   FROM public.paige_subagents WHERE slug IN ('nexus','cura','mentor','merit','zion'))
 AND (SELECT bool_and(NOT (config->'team_hub_tools'->'tools') ?| ARRAY['team_hub_conversations','team_hub_search','crm_search_contacts','crm_list_team','list_subagents','web_search','web_fetch','inbox_list','get_business_snapshot','read_calendar_agenda'])
   FROM public.paige_subagents WHERE slug IN ('nexus','cura','mentor','merit','zion')),
 'roster: the channel allowlist is exactly the §6 list and carries none of the excluded private, CRM, comms, finance, calendar or web tools');
SELECT pg_temp.check((SELECT bool_and(config->'capability_scope'->>'mode'='allowlist' AND config->'capability_scope'->>'access'='read'
   AND (config->'capability_scope'->'tools') <@ '["ask_choices","capability_status","read_business_time_zone","team_hub_read_conversation","read_business_metric","get_business_snapshot","growth_list","campaign_brief_list","read_campaign_leads","crm_search_contacts","crm_get_contact_summary","read_client_engagement_status","read_tenant_knowledge","marketplace_browse","crm_list_deals","crm_pipeline_summary","agreement_list","agreement_status","crm_list_tasks","crm_get_task","plan_list","read_weekly_commitment_status","read_calendar_agenda","read_calendar_booking","crm_list_team"]'::jsonb)
   FROM public.paige_subagents WHERE slug IN ('vera','nexus','cura','mentor','merit','zion')),
 'roster: every DM tool scope is an allowlist of reads only (A1)');
SELECT pg_temp.check((SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(config->'personality') k)
   = ARRAY['energy','formality','house_words','humour','intro','length','never_does','role_line','shared_rules','short_role','sounds_like','things_to_avoid','version','warmth']
   AND (config->'personality'->>'warmth')::int BETWEEN 1 AND 5 AND config->'personality'->>'humour' IN ('off','light')
   AND char_length(config->'personality'->>'intro')<=160 AND jsonb_array_length(config->'personality'->'shared_rules')=7)
   FROM public.paige_subagents WHERE slug IN ('vera','nexus','cura','mentor','merit','zion'))
 AND (SELECT config->'personality'->>'short_role' FROM public.paige_subagents WHERE slug='merit')='Sales & getting paid',
 'roster: each personality is presentation only (the A4 keys, within limits, no tool, scope, lane or authority field); MERIT reads Sales & getting paid');
-- NEXUS as production holds it (the untouched seed): the remit is corrected; its config keys stay.
UPDATE public.paige_subagents SET description='VP Growth. Content strategy and creation, campaigns, sales sequences, pipeline management, lead scoring, brand voice enforcement, competitive positioning. Energetic, market-aware.',
 config='{}', version=1 WHERE slug='nexus';
\ir ../migrations/20271117010108_exp08_team_hub_agents_roster.sql
SELECT pg_temp.check((SELECT role='VP Marketing & Growth' AND domain='marketing_growth' AND version=3 AND name='NEXUS'
   AND description NOT ILIKE '%sales sequences%' AND description NOT ILIKE '%pipeline%' AND config ?& ARRAY['team_hub_tools','capability_scope','personality']
   FROM public.paige_subagents WHERE slug='nexus'),
 'roster: the untouched NEXUS seed is corrected to Marketing & growth (sales and pipeline belong to MERIT)');
\echo 'PASS: roster: MERIT corrected to the 23 Oct standard on the untouched seed; config keys only added; the channel allowlist, read-only DM scopes and presentation-only personalities; replay is a no-op'

RESET ROLE;
\c postgres
DROP DATABASE exp08_team_hub_agents_a1_proof;
\echo 'PASS: EXP08 Team Hub agents A1a proof complete; disposable database dropped'
