-- EXP08 Team Hub agents, A1c: "<AGENT> is writing…" for everyone who can see the conversation, and
-- @channel / @here.
-- Migration: supabase/migrations/20271119030008_exp08_team_hub_a1c_writing_and_broadcast.sql.
-- Contract: docs/delivery/exp08-team-hub-agents-contract.md, "A1c notes".
-- Disposable PostgreSQL only. Never target the linked project. The proof runs in a database it creates
-- and drops.
--
-- WHAT IS REAL AND WHAT IS A DOUBLE. The setup and the incumbent chain (everything before section 1)
-- are copied verbatim from supabase/tests/exp08_team_hub_agent_turn_states.sql lines 14-718, which
-- documents what in them is real (production bodies, md5-checked) and what is a double. Then the A1b
-- migration (20271119010008, not yet on production: its bodies are checked against the A1b file as
-- applied here), and the migration under test. team_hub_post_message and _team_hub_message_json are
-- md5(prosrc)-checked against production (read 2026-10-27) before the change. Synthetic people and
-- ids only.
-- ── Setup, copied verbatim from supabase/tests/exp08_team_hub_agent_turn_states.sql (lines 14-718) ──
\set ON_ERROR_STOP on
\set QUIET on
DROP DATABASE IF EXISTS exp08_team_hub_a1c_proof;
CREATE DATABASE exp08_team_hub_a1c_proof;
\c exp08_team_hub_a1c_proof
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

-- 1. The bodies this change re-emits: production's (md5(prosrc), read 2026-10-27) for the two that are
-- live there; the A1b file's own body for the turn-state read, which is not yet on production.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[])','4dc15ad28671cc2d81dade9fc88fa548'),
   ('_team_hub_message_json(team_hub_messages)','ad0b586878d11116293c93dee22fb14a'),
   ('_team_hub_refusal(uuid)','b6ee98245fdbb9e0229547061a9391d2'),
   ('_team_hub_visible(uuid,uuid,uuid)','28a7e5c90f2a29b19b4481c4850a414f'),
   ('_team_hub_is_active(uuid,uuid)','c290399dc80d95d16116a0f88b0abd8c'),
   ('_team_hub_participates(uuid,uuid)','4f2fb69d09f7b362027edf195a37da83'),
   ('team_hub_mark_read(uuid,uuid,uuid)','9c5ff3594f8529e7bff24677dacf34a4')) v(sig, prod_md5)
 LOOP
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=('public.'||r.sig)::regprocedure) IS DISTINCT FROM r.prod_md5 THEN
   RAISE EXCEPTION 'FAIL: % is not the production body', r.sig; END IF;
 END LOOP;
END $$;
\echo 'PASS: before the change, the post door, the message JSON and the five helpers are production''s bodies (md5(prosrc), 7 of 7)'
CREATE TEMP TABLE before_src AS SELECT p.oid::regprocedure::text AS sig, p.proname::text AS name, p.prosrc AS src
 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team_hub%';
CREATE TEMP TABLE a1b_states AS SELECT md5(prosrc) AS v FROM pg_proc WHERE oid='public.team_hub_agent_turn_states(uuid,uuid,uuid[])'::regprocedure;

-- 2. The change, then a second apply: a no-op.
\ir ../migrations/20271119030008_exp08_team_hub_a1c_writing_and_broadcast.sql
CREATE TEMP VIEW a1c_state AS
SELECT 'fn:'||p.oid::regprocedure::text AS k, concat_ws('|', p.proacl::text, p.prosecdef::text, p.provolatile::text, p.proconfig::text, md5(p.prosrc)) AS v
 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE '%team_hub%' OR p.proname='operator_retirement_disposition')
UNION ALL
SELECT 'con:'||c.conrelid::regclass::text||':'||c.conname, pg_get_constraintdef(c.oid)||'|'||c.convalidated FROM pg_constraint c
 WHERE c.conrelid IN ('public.team_hub_messages'::regclass, 'public.team_hub_message_broadcast_recipients'::regclass)
UNION ALL
SELECT 'col:'||a.attrelid::regclass::text||':'||a.attname, format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull FROM pg_attribute a
 WHERE a.attrelid IN ('public.team_hub_messages'::regclass, 'public.team_hub_message_broadcast_recipients'::regclass, 'public.team_hub_channel_members'::regclass) AND a.attnum>0 AND NOT a.attisdropped
UNION ALL
SELECT 'rel:'||c.relname, concat_ws('|', c.relacl::text, c.relrowsecurity::text) FROM pg_class c
 WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','i') AND c.relname LIKE 'team_hub%'
UNION ALL
SELECT 'tg:'||t.tgname, t.tgrelid::regclass::text||'|'||t.tgfoid::regprocedure::text FROM pg_trigger t
 WHERE NOT t.tgisinternal AND t.tgrelid::regclass::text LIKE '%team_hub%';
CREATE TEMP TABLE a1c_before AS SELECT * FROM a1c_state;
\ir ../migrations/20271119030008_exp08_team_hub_a1c_writing_and_broadcast.sql
DO $$ BEGIN
 IF EXISTS(SELECT k,v FROM a1c_before EXCEPT SELECT k,v FROM a1c_state)
   OR EXISTS(SELECT k,v FROM a1c_state EXCEPT SELECT k,v FROM a1c_before) THEN
  RAISE EXCEPTION 'FAIL: a second apply changed a function, constraint, column, index, trigger or grant'; END IF;
END $$;
\echo 'PASS: the migration applies over the A1b chain; a second apply is a no-op (functions, constraints, columns, indexes, triggers, grants, RLS, the retirement policy)'

-- 3. Byte identity: each re-emitted body with only its marked A1c hunks undone is the body it replaces;
-- every other team_hub function of the chain is untouched.
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
 SELECT prosrc INTO src FROM pg_proc WHERE oid='public._team_hub_message_json(team_hub_messages)'::regprocedure;
 IF md5(pg_temp.undo(src, ARRAY[
  $h$   FROM public.team_hub_message_agent_mentions x WHERE x.message_id=p_message.id),'[]'::jsonb))
$h$, $h$   FROM public.team_hub_message_agent_mentions x WHERE x.message_id=p_message.id),'[]'::jsonb))
  -- A1c: an @channel or @here the message carries, only when it carries one (every other row is unchanged).
  || CASE WHEN p_message.broadcast_mention IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('broadcast',p_message.broadcast_mention) END
$h$]))<>'ad0b586878d11116293c93dee22fb14a' THEN RAISE EXCEPTION 'FAIL: outside its A1c hunk, _team_hub_message_json differs from production'; END IF;

 SELECT prosrc INTO src FROM pg_proc WHERE oid='public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[],text)'::regprocedure;
 IF md5(pg_temp.undo(src, ARRAY[
  $h$ files uuid[]:=coalesce(p_file_ids,'{}'::uuid[]); held int; agents text[]:=coalesce(p_agent_mention_keys,'{}'::text[]);
BEGIN$h$, $h$ files uuid[]:=coalesce(p_file_ids,'{}'::uuid[]); held int; agents text[]:=coalesce(p_agent_mention_keys,'{}'::text[]);
 broadcast text:=p_broadcast_mention; reach uuid[]; -- A1c
BEGIN$h$,
  $h$   OR (cardinality(agents)>0 AND ch.kind='agent_dm') THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
$h$, $h$   OR (cardinality(agents)>0 AND ch.kind='agent_dm') THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- A1c: @channel or @here, in a channel only (never a DM or an agent DM). It never asks an agent: only
 -- p_agent_mention_keys does, and an agent turn is accepted only for those rows.
 IF broadcast IS NOT NULL AND (broadcast NOT IN ('channel','here') OR ch.kind<>'channel') THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
$h$,
  $h$ INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,parent_message_id,client_request_id)
  VALUES (p_expected_tenant,ch.id,actor,body,p_parent_message_id,p_client_request_id)$h$,
  $h$ -- A1c: who an @channel or @here reaches, as a mention row reaches its person. @channel: every member of
 -- the channel who takes part in Team conversations. @here: those of them active in it in the last 10
 -- minutes: they posted in it (their own message or thread reply, never an agent reply to their question),
 -- or their own read door ran for it (last_active_at, which only team_hub_mark_read writes; never
 -- last_read_at, which joining, being seated and the Team conversations toggle also set). Never the author.
 -- A broadcast that reaches nobody is stored as a plain message.
 IF broadcast IS NOT NULL THEN
  reach:=ARRAY(SELECT m.user_id FROM public.team_hub_channel_members m
   WHERE m.channel_id=ch.id AND m.user_id<>actor AND public._team_hub_participates(p_expected_tenant,m.user_id)
    AND (broadcast='channel' OR m.last_active_at>=now()-interval '10 minutes'
     OR EXISTS(SELECT 1 FROM public.team_hub_messages x WHERE x.channel_id=ch.id AND x.author_user_id=m.user_id
      AND x.author_kind='user' AND x.deleted_at IS NULL AND x.created_at>=now()-interval '10 minutes')));
  IF cardinality(reach)=0 THEN broadcast:=NULL; END IF;
 END IF;
 -- A1c: broadcast_mention.
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,parent_message_id,client_request_id,broadcast_mention)
  VALUES (p_expected_tenant,ch.id,actor,body,p_parent_message_id,p_client_request_id,broadcast)$h$,
  $h$  SELECT msg.id,p_expected_tenant,ch.id,x.k FROM unnest(agents) x(k);
$h$, $h$  SELECT msg.id,p_expected_tenant,ch.id,x.k FROM unnest(agents) x(k);
 -- A1c: the recipients reached above.
 IF broadcast IS NOT NULL THEN
  INSERT INTO public.team_hub_message_broadcast_recipients(message_id,tenant_id,channel_id,user_id)
   SELECT msg.id,p_expected_tenant,ch.id,x.id FROM unnest(reach) x(id);
 END IF;
$h$]))<>'4dc15ad28671cc2d81dade9fc88fa548' THEN RAISE EXCEPTION 'FAIL: outside its A1c hunks, team_hub_post_message differs from production'; END IF;

 SELECT prosrc INTO src FROM pg_proc WHERE oid='public.team_hub_agent_turn_states(uuid,uuid,uuid[])'::regprocedure;
 IF md5(pg_temp.undo(src, ARRAY[
  $h$ THEN s.state ELSE 'replied' END,$h$, $h$
     -- A1c: a reply being written shows everyone who can see the conversation that it is (state only).
     OR (NOT s.private_part AND s.state='answering') THEN s.state ELSE 'replied' END,$h$,
  $h$ OR s.bring_in IS NOT NULL;$h$, $h$ OR s.bring_in IS NOT NULL
  -- A1c: and a reply being written ("<AGENT> is writing…" for everyone, like a person typing). Only the
  -- state: no text, no token, no turn id; never a running turn in a conversation the caller cannot see.
  OR (NOT s.private_part AND s.state='answering');$h$]))<>(SELECT v FROM a1b_states) THEN
  RAISE EXCEPTION 'FAIL: outside its two A1c hunks, team_hub_agent_turn_states differs from the A1b body'; END IF;

 SELECT prosrc INTO src FROM pg_proc WHERE oid='public.team_hub_mark_read(uuid,uuid,uuid)'::regprocedure;
 IF md5(pg_temp.undo(src, ARRAY[
  $h$,through)
  WHERE m.channel_id=ch.id AND m.user_id=actor;$h$, $h$,through)
  -- A1c: the person's own read door ran now (the activity @here reads).
  , last_active_at=now()
  WHERE m.channel_id=ch.id AND m.user_id=actor;$h$]))<>'9c5ff3594f8529e7bff24677dacf34a4' THEN
  RAISE EXCEPTION 'FAIL: outside its A1c hunk, team_hub_mark_read differs from production'; END IF;

 SELECT array_agg(b.name ORDER BY b.name) INTO changed FROM before_src b
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(b.sig) WHERE p.oid IS NULL OR p.prosrc<>b.src;
 IF changed IS DISTINCT FROM ARRAY['_team_hub_message_json','team_hub_agent_turn_states','team_hub_mark_read','team_hub_post_message'] THEN
  RAISE EXCEPTION 'FAIL: the functions that changed are %', changed; END IF;
END $$;
\echo 'PASS: byte identity: the message JSON, the post door, the read door and the turn-state read with only their marked A1c hunks undone are the bodies they replace; every other team_hub function is unchanged'

-- 4. Structure and grants.
DO $$ BEGIN
 IF to_regprocedure('public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[])') IS NOT NULL THEN
  RAISE EXCEPTION 'FAIL: the eight-argument post door is still there (an overload would make named calls ambiguous)'; END IF;
 IF NOT has_function_privilege('authenticated','public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[],text)','EXECUTE')
   OR has_function_privilege('anon','public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[],text)','EXECUTE')
   OR has_function_privilege('service_role','public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[],text)','EXECUTE')
   OR NOT has_function_privilege('authenticated','public.team_hub_agent_turn_states(uuid,uuid,uuid[])','EXECUTE')
   OR has_function_privilege('anon','public.team_hub_agent_turn_states(uuid,uuid,uuid[])','EXECUTE')
   OR has_function_privilege('service_role','public.team_hub_agent_turn_states(uuid,uuid,uuid[])','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: the post door and the state read must be executable by authenticated only'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['team_hub_agent_turn_states(uuid,uuid,uuid[])','team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[],text)']) f
   WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=('public.'||f)::regprocedure AND p.prosecdef AND p.proconfig[1]='search_path=""')
    OR EXISTS(SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
     WHERE p.oid=('public.'||f)::regprocedure AND a.grantee=0)) THEN
  RAISE EXCEPTION 'FAIL: a door is not SECURITY DEFINER on an empty search_path, or PUBLIC can execute it'; END IF;
 IF has_function_privilege('authenticated','public._team_hub_broadcast_scope_guard()','EXECUTE')
   OR has_function_privilege('service_role','public._team_hub_broadcast_scope_guard()','EXECUTE')
   OR has_function_privilege('authenticated','public._team_hub_message_json(team_hub_messages)','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: an internal helper is executable from outside'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.team_hub_message_broadcast_recipients'::regclass)
   OR EXISTS(SELECT 1 FROM pg_policies WHERE tablename='team_hub_message_broadcast_recipients')
   OR has_table_privilege('authenticated','public.team_hub_message_broadcast_recipients','SELECT,INSERT,UPDATE,DELETE')
   OR has_table_privilege('anon','public.team_hub_message_broadcast_recipients','SELECT,INSERT,UPDATE,DELETE') THEN
  RAISE EXCEPTION 'FAIL: team_hub_message_broadcast_recipients must be RLS-on with no policy and no browser grant'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_messages'::regclass
   AND conname='team_hub_messages_broadcast_mention_chk' AND convalidated) THEN
  RAISE EXCEPTION 'FAIL: the broadcast_mention CHECK is missing'; END IF;
 IF public.operator_retirement_disposition('team_hub_message_broadcast_recipients') IS DISTINCT FROM public.operator_retirement_disposition('team_hub_message_agent_mentions') THEN
  RAISE EXCEPTION 'FAIL: the new table does not go with the account at retirement like every Team Hub table'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team_hub%'
   AND (p.prosrc ~* '(paige_orchestrator|delegate_to_subagent|file_action|advance_action|approval|calendar|booking)'
    OR p.prosrc ILIKE '%is_tenant_member%')) THEN
  RAISE EXCEPTION 'FAIL: a team_hub body names a delegation, approval, calendar or booking path'; END IF;
END $$;
\echo 'PASS: structure: the post door and the state read authenticated-only, SECURITY DEFINER on an empty search_path; no eight-argument overload left; the recipients table RLS-on with no grant and retired with the account; the CHECK is validated'

-- 5. Behaviour. Helpers copied from exp08_team_hub_agent_turn_states.sql section 5, plus the broadcast post.
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
CREATE FUNCTION pg_temp.accept(tenant text, asker text, channel text, src text, agent text, intent text, token text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(NULL, format('public.team_hub_accept_agent_turn(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L)',
  tenant, asker, channel, src, agent, intent, pg_temp.h(token)), 'service_role') $$;
CREATE FUNCTION pg_temp.post(actor text, tenant text, channel text, body text, agents text DEFAULT '{}', parent text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_post_message(%L::uuid,%L::uuid,%L,gen_random_uuid(),%L::uuid,''{}''::uuid[],''{}''::uuid[],%L::text[])',
  tenant, channel, body, parent, agents)) $$;
-- The browser's named call, with p_broadcast_mention only when the message carries one.
CREATE FUNCTION pg_temp.bpost(actor text, tenant text, channel text, body text, broadcast text, agents text DEFAULT '{}', crid text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_post_message(p_expected_tenant=>%L::uuid,p_channel_id=>%L::uuid,p_body=>%L,p_client_request_id=>%L::uuid,p_agent_mention_keys=>%L::text[],p_broadcast_mention=>%L)',
  tenant, channel, body, coalesce(crid, gen_random_uuid()::text), agents, broadcast)) $$;
CREATE FUNCTION pg_temp.agent_post(actor text, tenant text, channel text, agent text, body text, crid text, parent text, asked text,
 intent text, token text, private boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_post_agent_message(%L::uuid,%L::uuid,%L,%L,%L::uuid,%L::uuid,%L::uuid,%L,%L,%L::boolean)',
  tenant, channel, agent, body, crid, parent, asked, intent, token, private)) $$;
CREATE FUNCTION pg_temp.states(actor text, tenant text, channel text, ids text[]) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_agent_turn_states(%L::uuid,%L::uuid,%L::uuid[])', tenant, channel, ids)) $$;
CREATE FUNCTION pg_temp.st(r jsonb, msg text, agent text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT x FROM jsonb_array_elements(r->'states') x WHERE x->>'message_id'=msg AND x->>'agent_key'=agent $$;
CREATE FUNCTION pg_temp.end_turn(turn text, token text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(NULL, format('public.team_hub_end_agent_turn(%L::uuid,%L)', turn, pg_temp.h(token)), 'service_role') $$;
CREATE FUNCTION pg_temp.recipients(msg text) RETURNS text[] LANGUAGE sql AS $$
 SELECT coalesce(array_agg(r.user_id::text ORDER BY r.user_id),'{}') FROM public.team_hub_message_broadcast_recipients r WHERE r.message_id=msg::uuid $$;

-- People in Workspace A: u1 owner, u2 and u5 members, u3 admin. u7 owns Workspace B.
SELECT pg_temp.j(:'u1', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'ta','launch','team','{}'))->>'channel_id' AS launch \gset
SELECT pg_temp.check(pg_temp.j(u, format('public.team_hub_join_channel(%L::uuid,%L::uuid)', :'ta', :'launch'))->>'ok'='true', 'setup: a teammate joins #launch')
 FROM unnest(ARRAY[:'u2', :'u3', :'u5']) u;
SELECT pg_temp.j(:'u1', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'ta','board','private',
 format('{%s}', :'u2')))->>'channel_id' AS board \gset
SELECT pg_temp.j(:'u7', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'tb','general','team','{}'))->>'channel_id' AS bgen \gset
SELECT pg_temp.j(:'u2', format('public.team_hub_open_agent_dm(%L::uuid,%L)', :'ta', 'vera'))->>'channel_id' AS vera_dm \gset
SELECT pg_temp.j(:'u2', format('public.team_hub_open_dm(%L::uuid,%L::uuid)', :'ta', :'u3'))->>'channel_id' AS dm23 \gset
SELECT pg_temp.check(:'launch'<>'' AND :'board'<>'' AND :'bgen'<>'' AND :'vera_dm'<>'' AND :'dm23'<>'',
 'setup: #launch (team), #board (private: the owner and Person 2), Workspace B''s #general, Person 2''s DM with VERA and with Person 3');

-- 5a. "<AGENT> is writing…" for everyone who can see the conversation.
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@CURA @ZION who is onboarding this week?', '{cura,zion}')#>>'{message,id}' AS q1 \gset
SELECT pg_temp.check(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1'])->'states'='[]'::jsonb,
 'unstarted: another member reads nothing about the question');
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q1', 'cura', 'reply', pg_temp.tok('C1'))->>'turn_id' AS t1 \gset
SELECT pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1']) AS so \gset
SELECT pg_temp.states(:'u1', :'ta', :'launch', ARRAY[:'q1']) AS sw \gset
SELECT pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q1']) AS sa \gset
SELECT pg_temp.check(pg_temp.st(:'so', :'q1', 'cura') = jsonb_build_object('message_id',:'q1','agent_key','cura','state','answering','private_part',false,'asker_name','Person 2')
 AND pg_temp.st(:'sw', :'q1', 'cura')->>'state'='answering'
 AND pg_temp.st(:'so', :'q1', 'zion') IS NULL AND jsonb_array_length((:'so')::jsonb->'states')=1
 AND pg_temp.st(:'sa', :'q1', 'cura')->>'state'='answering' AND pg_temp.st(:'sa', :'q1', 'zion')->>'state'='none'
 AND position(:'t1' IN (:'so')::text)=0 AND position(pg_temp.h(pg_temp.tok('C1')) IN (:'so')::text)=0 AND position('onboarding' IN (:'so')::text)=0,
 'running: another member and the owner read answering for CURA (state only: no turn id, no token, no text); ZION, unstarted, stays hidden from them; the asker reads both');
-- Thread replies are questions too: a question asked in a thread is read the same way.
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@MENTOR in the thread?', '{mentor}', :'q1')#>>'{message,id}' AS q1t \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q1t', 'mentor', 'reply', pg_temp.tok('T1'))->>'ok' AS at1 \gset
SELECT pg_temp.check(:'at1'='true' AND pg_temp.st(pg_temp.states(:'u5', :'ta', :'launch', ARRAY[:'q1t']), :'q1t', 'mentor')->>'state'='answering',
 'a question in a thread: another member reads answering for it');
-- Posted: others read nothing new (the reply itself is in the stream); the asker reads replied.
SELECT pg_temp.agent_post(:'u2', :'ta', :'launch', 'cura', 'Two people start Monday.', gen_random_uuid()::text, NULL, :'q1', 'reply', pg_temp.tok('C1'))->>'ok' AS r1 \gset
SELECT pg_temp.check(:'r1'='true' AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1']), :'q1', 'cura') IS NULL
 AND pg_temp.st(pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q1']), :'q1', 'cura')->>'state'='replied',
 'posted: another member no longer reads answering; the asker reads replied');
-- Ended without a post, and a turn left running past 10 minutes: never shown to anyone else.
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q1', 'zion', 'reply', pg_temp.tok('Z1'))->>'turn_id' AS tz \gset
SELECT pg_temp.check(pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1']), :'q1', 'zion')->>'state'='answering'
 AND pg_temp.end_turn(:'tz', pg_temp.tok('Z1'))->>'ok'='true'
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1']), :'q1', 'zion') IS NULL
 AND pg_temp.st(pg_temp.states(:'u2', :'ta', :'launch', ARRAY[:'q1']), :'q1', 'zion')->>'state'='failed',
 'ended without a post: another member stops reading answering and never reads failed; the asker reads failed');
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@VERA how did September go?', '{vera}')#>>'{message,id}' AS q2 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'q2', 'vera', 'reply', pg_temp.tok('V1'))->>'turn_id' AS tv \gset
UPDATE public.team_hub_agent_turns SET accepted_at=now()-interval '11 minutes', attempts=ARRAY[now()-interval '11 minutes'] WHERE id=:'tv';
SELECT pg_temp.check(pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q2']), :'q2', 'vera') IS NULL,
 'a turn left running for more than 10 minutes is ended: another member reads nothing');

-- 5b. Scope: a private channel, an agent DM, another workspace.
SELECT pg_temp.post(:'u2', :'ta', :'board', '@MERIT board pricing?', '{merit}')#>>'{message,id}' AS q6 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'board', :'q6', 'merit', 'reply', pg_temp.tok('B6'))->>'ok' AS a6 \gset
SELECT pg_temp.check(:'a6'='true'
 AND pg_temp.st(pg_temp.states(:'u1', :'ta', :'board', ARRAY[:'q6']), :'q6', 'merit')->>'state'='answering'
 AND pg_temp.states(:'u3', :'ta', :'board', ARRAY[:'q6'])->>'code'='not_found'
 AND pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q6'])->'states'='[]'::jsonb,
 'a private channel: its other member (the owner) reads answering; a non-member is refused not_found, and passing the question id through #launch returns nothing of it');
SELECT pg_temp.post(:'u2', :'ta', :'vera_dm', 'What were last month''s numbers?', '{}')#>>'{message,id}' AS q5 \gset
SELECT pg_temp.accept(:'ta', :'u2', :'vera_dm', :'q5', 'vera', 'dm', pg_temp.tok('V5'))->>'ok' AS a5 \gset
SELECT pg_temp.check(:'a5'='true'
 AND pg_temp.st(pg_temp.states(:'u2', :'ta', :'vera_dm', ARRAY[:'q5']), :'q5', 'vera')->>'state'='answering'
 AND pg_temp.states(:'u1', :'ta', :'vera_dm', ARRAY[:'q5'])->>'code'='not_found'
 AND pg_temp.states(:'u3', :'ta', :'vera_dm', ARRAY[:'q5'])->>'code'='not_found'
 AND pg_temp.states(:'u1', :'ta', :'launch', ARRAY[:'q5'])->'states'='[]'::jsonb,
 'an agent DM stays its one member''s: the owner and another member are refused not_found, and its question id read through #launch returns nothing');
SELECT pg_temp.check(pg_temp.states(:'u7', :'ta', :'launch', ARRAY[:'q1t'])->>'code'='scope_changed'
 AND pg_temp.states(:'u7', :'tb', :'launch', ARRAY[:'q1t'])->>'code'='not_found'
 AND pg_temp.states(:'u7', :'tb', :'bgen', ARRAY[:'q1t'])->'states'='[]'::jsonb,
 'another workspace''s owner reads nothing: refused for Workspace A, not_found for its channel in their own, and an id from A through their channel returns nothing');
\echo 'PASS: writing for everyone: another member and the owner read answering (state only) for a running reply in a team channel and a thread; nothing once it posted, ended or went stale; a private channel''s non-member, anyone but its member on an agent DM, and another workspace read nothing'

-- 5c. @channel / @here.
CREATE FUNCTION pg_temp.read_door(actor text, tenant text, channel text, through text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.j(actor, format('public.team_hub_mark_read(%L::uuid,%L::uuid,%L::uuid)', tenant, channel, through)) $$;
CREATE FUNCTION pg_temp.member(channel text, who text) RETURNS public.team_hub_channel_members LANGUAGE sql AS $$
 SELECT m FROM public.team_hub_channel_members m WHERE m.channel_id=channel::uuid AND m.user_id=who::uuid $$;
-- Who is in #launch, and how each got there. Every way of arriving writes last_read_at=now(), and none
-- of them is the person being active:
--   Person 3 joined (team_hub_join_channel, in the setup above);
--   Person 27's seat started (an invitation accepted: the seat trigger joins every open team channel);
--   Person 28 was switched on (the Team conversations toggle joins every open team channel);
--   Person 4 joined, asked CURA 20 minutes ago, and CURA's reply (stored with Person 4 as the asker) is
--   2 minutes old: an agent reply to their question is not their post.
-- Active: Person 5 posted 5 minutes ago; Person 8 posted a thread reply 3 minutes ago; Person 6's own
-- read door ran 9 minutes ago. Not active any more: the owner posted 40 minutes ago and their read door
-- last ran 11 minutes ago.
RESET ROLE;
INSERT INTO public.tenant_invite_tokens(tenant_id,token,kind,email,default_role,created_by,team_hub_access) VALUES
 (:'ta', 'a1c-invite-27', 'team', 'person27@example.test', 'member', :'u1', true),
 (:'ta', 'a1c-invite-28', 'team', 'person28@example.test', 'member', :'u1', false);
SELECT pg_temp.check(pg_temp.j(u, format('(SELECT to_jsonb(public.accept_solo_team_invite(%L)))', t))->>'error' IS NULL, 'setup: Person '||right(u,2)||' accepts their invitation')
 FROM (VALUES (:'u27','a1c-invite-27'), (:'u28','a1c-invite-28')) v(u,t);
SELECT pg_temp.check(pg_temp.member(:'launch', :'u28') IS NULL
 AND pg_temp.j(:'u1', format('(SELECT public.set_solo_team_member_team_hub_access(%L::uuid,%L::uuid,true))', :'u28', :'ta'))->>'error' IS NULL
 AND (pg_temp.member(:'launch', :'u27')).user_id IS NOT NULL AND (pg_temp.member(:'launch', :'u28')).user_id IS NOT NULL,
 'setup: Person 27''s seat started and Person 28 was switched on; both are now in #launch');
SELECT pg_temp.check(pg_temp.j(u, format('public.team_hub_join_channel(%L::uuid,%L::uuid)', :'ta', :'launch'))->>'ok'='true', 'setup: Person 4, 6 and 8 join #launch')
 FROM unnest(ARRAY[:'u4', :'u6', :'u8']) u;
SELECT pg_temp.post(:'u5', :'ta', :'launch', 'Back from lunch.')#>>'{message,id}' AS m5 \gset
SELECT pg_temp.post(:'u1', :'ta', :'launch', 'Morning, all.')#>>'{message,id}' AS m1 \gset
SELECT pg_temp.post(:'u8', :'ta', :'launch', 'On it.', '{}', :'m1')#>>'{message,id}' AS m8 \gset
SELECT pg_temp.post(:'u4', :'ta', :'launch', '@CURA who covers Friday?', '{cura}')#>>'{message,id}' AS q4 \gset
SELECT pg_temp.accept(:'ta', :'u4', :'launch', :'q4', 'cura', 'reply', pg_temp.tok('Q4'))->>'ok' AS aq4 \gset
SELECT pg_temp.agent_post(:'u4', :'ta', :'launch', 'cura', 'Person 6 covers Friday.', gen_random_uuid()::text, NULL, :'q4', 'reply', pg_temp.tok('Q4')) AS rq4 \gset
SELECT pg_temp.check(pg_temp.read_door(:'u6', :'ta', :'launch', :'m1')->>'ok'='true' AND pg_temp.read_door(:'u1', :'ta', :'launch', :'m1')->>'ok'='true',
 'setup: Person 6 and the owner read #launch through the read door');
UPDATE public.team_hub_messages SET created_at=now()-interval '5 minutes' WHERE id=:'m5';
UPDATE public.team_hub_messages SET created_at=now()-interval '3 minutes' WHERE id=:'m8';
UPDATE public.team_hub_messages SET created_at=now()-interval '40 minutes' WHERE author_user_id=:'u1' AND channel_id=:'launch';
UPDATE public.team_hub_messages SET created_at=now()-interval '20 minutes' WHERE id=:'q4';
UPDATE public.team_hub_messages SET created_at=now()-interval '2 minutes' WHERE id=((:'rq4')::jsonb#>>'{message,id}')::uuid;
UPDATE public.team_hub_channel_members SET last_active_at=now()-interval '9 minutes' WHERE channel_id=:'launch' AND user_id=:'u6';
UPDATE public.team_hub_channel_members SET last_active_at=now()-interval '11 minutes' WHERE channel_id=:'launch' AND user_id=:'u1';
-- The arrival values stay exactly as the doors wrote them: a fresh last_read_at, and no activity.
SELECT pg_temp.check((SELECT bool_and((pg_temp.member(:'launch', u)).last_read_at>=now()-interval '10 minutes'
   AND (pg_temp.member(:'launch', u)).last_active_at IS NULL) FROM unnest(ARRAY[:'u3', :'u27', :'u28', :'u4']) u)
 AND :'aq4'='true' AND (:'rq4')::jsonb->>'ok'='true'
 AND (SELECT author_kind='agent' AND author_user_id=:'u4'::uuid FROM public.team_hub_messages WHERE id=((:'rq4')::jsonb#>>'{message,id}')::uuid)
 AND (pg_temp.member(:'launch', :'u6')).last_active_at IS NOT NULL
 AND (pg_temp.member(:'launch', :'u5')).last_active_at IS NULL AND (pg_temp.member(:'launch', :'u8')).last_active_at IS NULL,
 'before the broadcast: Persons 3, 27, 28 and 4 carry a last_read_at under 10 minutes old from joining, a seat start or the toggle, and no last_active_at; CURA''s reply is stored as an agent row asked by Person 4; posting set nobody''s last_active_at; the read door set Person 6''s');
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@channel the launch is Friday', 'channel') AS pc \gset
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@here who can review now?', 'here') AS ph \gset
SELECT pg_temp.check((:'pc')::jsonb->>'ok'='true' AND (:'pc')::jsonb#>>'{message,broadcast}'='channel'
 AND pg_temp.recipients((:'pc')::jsonb#>>'{message,id}')=(SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[:'u1', :'u3', :'u4', :'u5', :'u6', :'u8', :'u27', :'u28']) x)
 AND (:'ph')::jsonb->>'ok'='true' AND (:'ph')::jsonb#>>'{message,broadcast}'='here'
 AND pg_temp.recipients((:'ph')::jsonb#>>'{message,id}')=(SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[:'u5', :'u6', :'u8']) x),
 '@channel reaches every other member of the channel; @here reaches only those who posted (Person 5, and Person 8 in a thread) or whose own read door ran (Person 6, 9 minutes ago) in the last 10 minutes: not a join (Person 3), a seat start (Person 27), the toggle (Person 28), an agent reply to their question (Person 4), or a read door 11 minutes ago (the owner); never the author');
-- A broadcast that reaches nobody is a plain message: alone in a channel, or nobody else active.
SELECT pg_temp.j(:'u2', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'ta','alone','team','{}'))->>'channel_id' AS alone \gset
SELECT pg_temp.j(:'u2', format('public.team_hub_create_channel(%L::uuid,%L,%L,%L::uuid[],gen_random_uuid())', :'ta','quiet','team','{}'))->>'channel_id' AS quiet \gset
SELECT pg_temp.check(pg_temp.j(:'u3', format('public.team_hub_join_channel(%L::uuid,%L::uuid)', :'ta', :'quiet'))->>'ok'='true', 'setup: Person 3 joins #quiet');
SELECT pg_temp.bpost(:'u2', :'ta', :'alone', '@channel anyone?', 'channel') AS pz1 \gset
SELECT pg_temp.bpost(:'u2', :'ta', :'quiet', '@here anyone?', 'here') AS pz2 \gset
SELECT pg_temp.bpost(:'u2', :'ta', :'quiet', '@channel anyone?', 'channel') AS pz3 \gset
SELECT pg_temp.check((:'pz1')::jsonb->>'ok'='true' AND NOT ((:'pz1')::jsonb->'message' ? 'broadcast')
 AND (SELECT broadcast_mention IS NULL FROM public.team_hub_messages WHERE id=((:'pz1')::jsonb#>>'{message,id}')::uuid)
 AND pg_temp.recipients((:'pz1')::jsonb#>>'{message,id}')='{}'
 AND (:'pz2')::jsonb->>'ok'='true' AND NOT ((:'pz2')::jsonb->'message' ? 'broadcast')
 AND (SELECT broadcast_mention IS NULL FROM public.team_hub_messages WHERE id=((:'pz2')::jsonb#>>'{message,id}')::uuid)
 AND (:'pz3')::jsonb#>>'{message,broadcast}'='channel' AND pg_temp.recipients((:'pz3')::jsonb#>>'{message,id}')=ARRAY[:'u3'],
 'a broadcast that reaches nobody is stored as a plain message (no broadcast, no chip, no recipients): @channel alone in #alone, and @here in #quiet where Person 3 only joined; @channel in #quiet still reaches Person 3');
-- The activity column has one writer: the read door. Every other body leaves it alone.
SELECT pg_temp.check((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosrc ~ 'last_active_at')
  =ARRAY['team_hub_mark_read','team_hub_post_message']
 AND (SELECT array_agg(p.proname::text) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosrc ~ 'last_active_at\s*=')=ARRAY['team_hub_mark_read']
 AND NOT has_column_privilege('authenticated','public.team_hub_channel_members','last_active_at','UPDATE')
 AND NOT has_column_privilege('authenticated','public.team_hub_channel_members','last_active_at','SELECT'),
 'last_active_at is written by team_hub_mark_read only (the post door only reads it), and the browser can neither read nor write it');
-- A member with Team conversations off is not reached; a plain message carries no broadcast key.
UPDATE public.tenant_members SET team_hub_access=false WHERE tenant_id=:'ta' AND user_id=:'u5';
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@channel second notice', 'channel') AS pc2 \gset
SELECT pg_temp.post(:'u2', :'ta', :'launch', 'plain words') AS pp \gset
UPDATE public.tenant_members SET team_hub_access=true WHERE tenant_id=:'ta' AND user_id=:'u5';
SELECT pg_temp.check(pg_temp.recipients((:'pc2')::jsonb#>>'{message,id}')=(SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[:'u1', :'u3', :'u4', :'u6', :'u8', :'u27', :'u28']) x)
 AND (:'pp')::jsonb->>'ok'='true' AND NOT ((:'pp')::jsonb->'message' ? 'broadcast')
 AND NOT ((:'pp')::jsonb->'message' ? 'broadcast_mention'),
 'a member whose Team conversations are off is not reached; a message without @channel or @here has no broadcast key at all');
-- Never in a DM or an agent DM, never an unknown kind; a retry returns the original; it never asks an agent.
SELECT pg_temp.check(pg_temp.bpost(:'u2', :'ta', :'dm23', '@channel hi', 'channel')->>'code'='invalid'
 AND pg_temp.bpost(:'u2', :'ta', :'dm23', '@here hi', 'here')->>'code'='invalid'
 AND pg_temp.bpost(:'u2', :'ta', :'vera_dm', '@here hi', 'here')->>'code'='invalid'
 AND pg_temp.bpost(:'u2', :'ta', :'launch', '@everyone hi', 'everyone')->>'code'='invalid'
 AND pg_temp.bpost(:'u2', :'ta', :'launch', '@channel hi', '')->>'code'='invalid'
 AND (SELECT count(*) FROM public.team_hub_messages WHERE body IN ('@channel hi','@here hi','@everyone hi'))=0,
 '@channel / @here are refused in a person DM and an agent DM, and an unknown or empty kind is refused; nothing is stored');
SELECT gen_random_uuid() AS crid \gset
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@channel retry me', 'channel', '{}', :'crid') AS pr1 \gset
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@channel retry me', 'channel', '{}', :'crid') AS pr2 \gset
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@channel @CURA the plan?', 'channel', '{}') AS pa \gset
SELECT pg_temp.check((:'pr2')::jsonb->>'duplicate'='true' AND (:'pr2')::jsonb#>>'{message,id}'=(:'pr1')::jsonb#>>'{message,id}'
 AND (SELECT count(*) FROM public.team_hub_message_broadcast_recipients WHERE message_id=((:'pr1')::jsonb#>>'{message,id}')::uuid)=8
 AND NOT EXISTS(SELECT 1 FROM public.team_hub_message_agent_mentions WHERE message_id=((:'pa')::jsonb#>>'{message,id}')::uuid)
 AND pg_temp.accept(:'ta', :'u2', :'launch', (:'pa')::jsonb#>>'{message,id}', 'cura', 'reply', pg_temp.tok('PA'))->>'code'='not_allowed'
 AND pg_temp.accept(:'ta', :'u2', :'launch', (:'pc')::jsonb#>>'{message,id}', 'paige', 'reply', pg_temp.tok('PC'))->>'code'='not_allowed',
 'a retry returns the original once, with its recipients stored once; @channel never asks an agent: no agent mention row, and no agent turn is accepted for it');
-- Every existing caller still resolves: the positional eight-argument call PAIGE''s seam and the tests
-- use, the request-task door''s six positional arguments, and the named call without the new argument.
SELECT pg_temp.check(pg_temp.post(:'u2', :'ta', :'launch', 'positional eight')->>'ok'='true'
 AND pg_temp.j(:'u2', format('public.team_hub_post_message(p_expected_tenant=>%L::uuid,p_channel_id=>%L::uuid,p_body=>%L,p_client_request_id=>gen_random_uuid(),p_parent_message_id=>NULL,p_mention_ids=>''{}''::uuid[],p_file_ids=>''{}''::uuid[])',
   :'ta', :'launch', 'named seven'))->>'ok'='true'
 AND pg_temp.j(:'u2', format('public.team_hub_request_task(%L::uuid,%L::uuid,%L,%L::uuid,NULL::timestamptz,gen_random_uuid(),NULL::uuid)', :'ta', :'launch', 'Send the packet', :'u2'))->>'ok'='true',
 'existing callers resolve: positional eight arguments, PAIGE''s named seven, and the request-task door');
-- Storage backstops: the author, another workspace, a plain message.
CREATE FUNCTION pg_temp.raw_recipient(msg text, tenant text, channel text, who text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.team_hub_message_broadcast_recipients VALUES (msg::uuid, tenant::uuid, channel::uuid, who::uuid);
 RAISE EXCEPTION 'inserted';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;
RESET ROLE;
SELECT pg_temp.check(pg_temp.raw_recipient((:'pc')::jsonb#>>'{message,id}', :'ta', :'launch', :'u2')='TEAM_HUB_BROADCAST_SCOPE'
 AND pg_temp.raw_recipient((:'pc')::jsonb#>>'{message,id}', :'tb', :'launch', :'u7')='TEAM_HUB_BROADCAST_SCOPE'
 AND pg_temp.raw_recipient((:'pp')::jsonb#>>'{message,id}', :'ta', :'launch', :'u3')='TEAM_HUB_BROADCAST_SCOPE'
 AND pg_temp.raw_recipient((:'ph')::jsonb#>>'{message,id}', :'ta', :'launch', :'u1')='inserted'
 AND pg_temp.j(:'u2', 'SELECT to_jsonb(count(*)) FROM public.team_hub_message_broadcast_recipients')->>'error' LIKE 'permission denied%',
 'storage backstops: a recipient row for the author, for another workspace, or on a plain message fails (a valid row would insert); the browser cannot read the table');
\echo 'PASS: @channel / @here: stored on the message through the post door, recipients reached as a mention reaches its person (@here by the stored activity rule), refused outside a channel, never asks an agent, retried once, every existing caller unchanged, storage backstops hold'

-- 6. MUTANTS (§71.4). Each guard is weakened on its own inside a rolled-back transaction, and the
-- property it protects is re-probed: every mutant must make its probe fail. A mutant that does not
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
CREATE FUNCTION pg_temp.states_sig() RETURNS regprocedure LANGUAGE sql AS $$ SELECT 'public.team_hub_agent_turn_states(uuid,uuid,uuid[])'::regprocedure $$;
CREATE FUNCTION pg_temp.post_sig() RETURNS regprocedure LANGUAGE sql AS $$ SELECT 'public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[],text)'::regprocedure $$;
-- A fresh running question in #launch, for probes that need one.
SELECT pg_temp.post(:'u2', :'ta', :'launch', '@NEXUS announce it?', '{nexus}')#>>'{message,id}' AS qm \gset
SELECT pg_temp.accept(:'ta', :'u2', :'launch', :'qm', 'nexus', 'reply', pg_temp.tok('QM'))->>'ok' AS aqm \gset

-- W1: the conversation need not be visible to the caller (others would read a private channel's writing).
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), 'SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);',
 'SELECT * INTO ch FROM public.team_hub_channels c WHERE c.id=p_channel_id AND c.tenant_id=p_expected_tenant;');
SELECT coalesce(pg_temp.states(:'u3', :'ta', :'board', ARRAY[:'q6'])->>'code'='not_found' AND pg_temp.states(:'u1', :'ta', :'vera_dm', ARRAY[:'q5'])->>'code'='not_found',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('W1 conversation not visible', :'g');
-- W2: others read every state, not only answering (a failed or unstarted turn would show).
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), $m$  OR (NOT s.private_part AND s.state='answering');$m$, $m$  OR (NOT s.private_part AND s.state IN ('answering','failed','none'));$m$);
SELECT coalesce(pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1']), :'q1', 'zion') IS NULL
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q2']), :'q2', 'vera') IS NULL,false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('W2 others read failed or stale turns', :'g');
-- W3: the A1c state hunk removed: others would be told 'replied' while the reply is being written.
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), $m$
     OR (NOT s.private_part AND s.state='answering') THEN s.state$m$, $m$
     THEN s.state$m$);
SELECT coalesce(pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'qm']), :'qm', 'nexus')->>'state'='answering',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('W3 writing masked as replied', :'g');
-- W4: the A1c row hunk removed: others would read nothing while the reply is written (the A1b behaviour).
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), $m$
  OR (NOT s.private_part AND s.state='answering');$m$, $m$
  ;$m$);
SELECT coalesce(pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'qm']), :'qm', 'nexus')->>'state'='answering',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('W4 writing shown to the asker only', :'g');
-- W5: the workspace door skipped (another workspace would get past the refusal).
BEGIN;
SELECT pg_temp.mutate(pg_temp.states_sig(), $m$ IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible$m$, $m$ SELECT * INTO ch FROM public._team_hub_visible$m$);
SELECT coalesce(pg_temp.states(:'u7', :'ta', :'launch', ARRAY[:'qm'])->>'code'='scope_changed',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('W5 workspace door skipped', :'g');
-- B1: @channel allowed outside a channel.
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$ OR ch.kind<>'channel') THEN$m$, $m$) THEN$m$);
SELECT coalesce(pg_temp.bpost(:'u2', :'ta', :'dm23', '@channel mutant', 'channel')->>'code'='invalid'
 AND pg_temp.bpost(:'u2', :'ta', :'vera_dm', '@here mutant', 'here')->>'code'='invalid',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('B1 broadcast in a DM', :'g');
-- B2: @here reaches everyone (the activity rule skipped).
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$AND (broadcast='channel' OR m.last_active_at$m$, $m$AND (true OR m.last_active_at$m$);
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@here mutant', 'here')#>>'{message,id}' AS mh \gset
SELECT coalesce(NOT (:'u1'=ANY(pg_temp.recipients(:'mh'))),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('B2 here reaches the inactive', :'g');
-- B3: the author reached by their own broadcast.
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$ m.user_id<>actor AND public._team_hub_participates$m$, $m$ public._team_hub_participates$m$);
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@channel mutant', 'channel') AS mc \gset
SELECT coalesce((:'mc')::jsonb->>'ok'='true' AND NOT (:'u2'=ANY(pg_temp.recipients((:'mc')::jsonb#>>'{message,id}'))),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('B3 author is a recipient', :'g');
-- B4: a member with Team conversations off reached.
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$ AND public._team_hub_participates(p_expected_tenant,m.user_id)
$m$, $m$
$m$);
UPDATE public.tenant_members SET team_hub_access=false WHERE tenant_id=:'ta' AND user_id=:'u5';
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@channel mutant', 'channel')#>>'{message,id}' AS mc \gset
SELECT coalesce(NOT (:'u5'=ANY(pg_temp.recipients(:'mc'))),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('B4 conversations-off member reached', :'g');
-- B5: an unknown kind accepted by the door (the storage CHECK is then the only line).
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$(broadcast NOT IN ('channel','here') OR ch.kind$m$, $m$(ch.kind$m$);
SELECT coalesce(pg_temp.bpost(:'u2', :'ta', :'launch', '@everyone mutant', 'everyone')->>'code'='invalid',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('B5 unknown kind accepted', :'g');
-- B6: every message's JSON grows a broadcast key (null on plain rows).
BEGIN;
SELECT pg_temp.mutate('public._team_hub_message_json(team_hub_messages)'::regprocedure,
 $m$CASE WHEN p_message.broadcast_mention IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('broadcast',p_message.broadcast_mention) END$m$,
 $m$jsonb_build_object('broadcast',p_message.broadcast_mention)$m$);
SELECT coalesce(NOT (pg_temp.post(:'u2', :'ta', :'launch', 'plain mutant')->'message' ? 'broadcast'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('B6 plain JSON changed', :'g');
-- B7: the recipients table readable from the browser.
BEGIN;
GRANT SELECT ON public.team_hub_message_broadcast_recipients TO authenticated;
SELECT coalesce(pg_temp.j(:'u2', 'SELECT to_jsonb(count(*)) FROM public.team_hub_message_broadcast_recipients')->>'error' LIKE 'permission denied%',false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('B7 recipients table granted', :'g');
-- B8: @here reads last_read_at again (the defect this round fixes): joining, a seat start and the toggle
-- would read as "here".
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$m.last_active_at>=now()-interval '10 minutes'$m$, $m$m.last_read_at>=now()-interval '10 minutes'$m$);
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@here mutant', 'here')#>>'{message,id}' AS mh \gset
SELECT coalesce(NOT (pg_temp.recipients(:'mh') && ARRAY[:'u3', :'u27', :'u28']),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('B8 here reads arrival last_read_at', :'g');
-- B9: the author_kind guard removed: an agent reply to Person 4's question would count as Person 4 posting.
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$x.author_kind='user' AND x.deleted_at$m$, $m$x.deleted_at$m$);
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@here mutant', 'here')#>>'{message,id}' AS mh \gset
SELECT coalesce(NOT (:'u4'=ANY(pg_temp.recipients(:'mh'))),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('B9 agent reply counts as the asker posting', :'g');
-- B10: the read door stops recording activity: a person who just read would not be "here".
BEGIN;
SELECT pg_temp.mutate('public.team_hub_mark_read(uuid,uuid,uuid)'::regprocedure, $m$
  , last_active_at=now()$m$, '');
SELECT pg_temp.j(:'u9', format('public.team_hub_join_channel(%L::uuid,%L::uuid)', :'ta', :'launch'))->>'ok' AS j9 \gset
SELECT pg_temp.read_door(:'u9', :'ta', :'launch', :'m1')->>'ok' AS r9 \gset
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@here mutant', 'here')#>>'{message,id}' AS mh \gset
SELECT coalesce(:'j9'='true' AND :'r9'='true' AND :'u9'=ANY(pg_temp.recipients(:'mh')),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('B10 read door records no activity', :'g');
-- B11: a broadcast that reaches nobody stored as a broadcast anyway.
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$  IF cardinality(reach)=0 THEN broadcast:=NULL; END IF;
$m$, '');
SELECT coalesce(NOT (pg_temp.bpost(:'u2', :'ta', :'alone', '@channel mutant', 'channel')->'message' ? 'broadcast'),false) AS g \gset
ROLLBACK;
INSERT INTO mutant_results VALUES ('B11 empty broadcast stored as one', :'g');

-- The migration's own guard: run on its own, it accepts the bodies as they are now (this file's) and
-- refuses a dependency or a replaced body that differs.
\set guardsql `sed -n '/^DO \$guard\$/,/^END \$guard\$;/p' supabase/migrations/20271119030008_exp08_team_hub_a1c_writing_and_broadcast.sql`
CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ran'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
SELECT pg_temp.try(:'guardsql') AS gd0 \gset
BEGIN;
SELECT pg_temp.mutate('public._team_hub_participates(uuid,uuid)'::regprocedure, 'AND m.team_hub_access)', 'AND m.team_hub_access) -- drift');
SELECT pg_temp.try(:'guardsql') AS gd1 \gset
ROLLBACK;
BEGIN;
SELECT pg_temp.mutate('public.team_hub_mark_read(uuid,uuid,uuid)'::regprocedure, $m$ RETURN jsonb_build_object('ok',true);$m$, $m$ RETURN jsonb_build_object('ok',true,'drift',1);$m$);
SELECT pg_temp.try(:'guardsql') AS gd2 \gset
ROLLBACK;
BEGIN;
SELECT pg_temp.mutate(pg_temp.post_sig(), $m$ RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg));
END$m$, $m$ RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'drift',1);
END$m$);
SELECT pg_temp.try(:'guardsql') AS gd3 \gset
ROLLBACK;
SELECT pg_temp.check(length(:'guardsql')>500 AND :'gd0'='ran'
 AND :'gd1' LIKE 'Team Hub A1c dependency public._team_hub_participates(uuid,uuid) changed%'
 AND :'gd2' LIKE 'Team Hub A1c source public.team_hub_mark_read(uuid,uuid,uuid) changed%'
 AND :'gd3' LIKE 'Team Hub A1c source team_hub_post_message changed%',
 'the migration''s md5 guard accepts its own bodies and refuses a drifted dependency, read door or post door: '||:'gd0'||' / '||:'gd1'||' / '||:'gd2'||' / '||:'gd3');
\echo 'PASS: the migration''s md5(prosrc) guard accepts the bodies it was written against (or its own) and refuses a drifted dependency, read door or post door'

-- Controls: every probe holds on the unmutated migration.
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@here control', 'here')#>>'{message,id}' AS ch1 \gset
BEGIN;
SELECT pg_temp.j(:'u9', format('public.team_hub_join_channel(%L::uuid,%L::uuid)', :'ta', :'launch'))->>'ok' AS j9 \gset
SELECT pg_temp.read_door(:'u9', :'ta', :'launch', :'m1')->>'ok' AS r9 \gset
SELECT pg_temp.bpost(:'u2', :'ta', :'launch', '@here control', 'here')#>>'{message,id}' AS ch9 \gset
SELECT (:'j9'='true' AND :'r9'='true' AND :'u9'=ANY(pg_temp.recipients(:'ch9'))) AS c9 \gset
ROLLBACK;
SELECT pg_temp.check(:'aqm'='true'
 AND pg_temp.states(:'u3', :'ta', :'board', ARRAY[:'q6'])->>'code'='not_found' AND pg_temp.states(:'u1', :'ta', :'vera_dm', ARRAY[:'q5'])->>'code'='not_found'
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q1']), :'q1', 'zion') IS NULL
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'q2']), :'q2', 'vera') IS NULL
 AND pg_temp.st(pg_temp.states(:'u3', :'ta', :'launch', ARRAY[:'qm']), :'qm', 'nexus')->>'state'='answering'
 AND pg_temp.states(:'u7', :'ta', :'launch', ARRAY[:'qm'])->>'code'='scope_changed'
 AND pg_temp.bpost(:'u2', :'ta', :'dm23', '@channel control', 'channel')->>'code'='invalid'
 AND pg_temp.bpost(:'u2', :'ta', :'vera_dm', '@here control', 'here')->>'code'='invalid'
 AND NOT (:'u1'=ANY(pg_temp.recipients(:'ch1'))) AND NOT (:'u2'=ANY(pg_temp.recipients(:'ch1')))
 AND NOT (pg_temp.recipients(:'ch1') && ARRAY[:'u3', :'u27', :'u28', :'u4']) AND :'c9'
 AND NOT (pg_temp.bpost(:'u2', :'ta', :'alone', '@channel control', 'channel')->'message' ? 'broadcast')
 AND pg_temp.bpost(:'u2', :'ta', :'launch', '@everyone control', 'everyone')->>'code'='invalid'
 AND NOT (pg_temp.post(:'u2', :'ta', :'launch', 'plain control')->'message' ? 'broadcast')
 AND pg_temp.j(:'u2', 'SELECT to_jsonb(count(*)) FROM public.team_hub_message_broadcast_recipients')->>'error' LIKE 'permission denied%',
 'mutants: every probe holds on the unmutated migration (controls)');
SELECT pg_temp.check((SELECT count(*) FROM mutant_results)=16 AND NOT EXISTS(SELECT 1 FROM mutant_results WHERE guarded IS NOT FALSE),
 'mutants: all 16 weakened guards break the property they protect: '||(SELECT string_agg(mutant||'='||coalesce(guarded::text,'null'), '; ' ORDER BY mutant) FROM mutant_results));
\echo 'PASS: 16 of 16 mutants (conversation visibility, others reading failed or stale turns, writing masked as replied, writing for the asker only, workspace door, broadcast in a DM, @here reaching the inactive, author as recipient, conversations-off member reached, unknown kind, plain JSON changed, recipients granted, @here reading arrival last_read_at, an agent reply counted as the asker posting, the read door recording nothing, an empty broadcast stored as one) each fail their probe; controls hold'

RESET ROLE;
\c postgres
DROP DATABASE exp08_team_hub_a1c_proof;
\echo 'PASS: EXP08 Team Hub agents A1c proof complete; disposable database dropped'
