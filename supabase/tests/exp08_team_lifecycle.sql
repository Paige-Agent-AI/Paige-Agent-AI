-- EXP08 team lifecycle: suspend and reinstate, removal by an admin, the Team conversations switch,
-- joining the team channels on arrival, and the read-only departure review.
-- Migration: supabase/migrations/20271115040008_exp08_team_lifecycle.sql. Owner rulings 2026-10-26.
-- Disposable PostgreSQL only. Never target the linked project. Every migration commits its own
-- BEGIN/COMMIT, so this proof runs in a database it creates and drops.
--
-- WHAT IS REAL AND WHAT IS A DOUBLE. Real, unchanged: the Team Hub migrations (increments 1 to 3,
-- search, read performance), the Operations wrapper, the removal migration (20261048000000) and the
-- lifecycle migration under test. Real, copied verbatim from production (2026-10-26) because their
-- migrations carry unrelated objects: all nine tenant_members trigger functions as they stand before
-- this change (consent, sync, owner guard, archived guard, company-workspace guard, assigned
-- relationships, a2p resync, updated_at, Team Hub seat-ended), current_user_tenant_id, is_tenant_owner,
-- map_tenant_role_to_app_role, tenant_assignee_qualifies and accept_solo_team_invite; and, in
-- exp08_team_lifecycle_production_functions.sql (md5-checked against production before the migration
-- runs), the role functions, self-seating paths and invitation functions review round 2 attacks and
-- extends, and production's three user_roles triggers that touch the roles written here (sync to the
-- caller's workspace, the protected operator roles, the platform owner's admin; review round 3), plus
-- the five tenant_members policies as production had them. Two of those role functions,
-- grant_tenant_member_role and change_user_role, and their helper is_workspace_admin are instead
-- admin scope stage 0's bodies (20271115030008, which reaches production first), copied verbatim
-- from that migration and md5-checked against it. Section 5c (k) runs the accept-invite edge
-- function's order (team-seat.ts) as the service role. Doubles, as in
-- the earlier Team Hub proofs: agency standing, platform admin/owner, company workspace (none), the
-- Operations core (plan_assign_task) and the retirement policy. Synthetic people and ids only.
\set ON_ERROR_STOP on
\set QUIET on
DROP DATABASE IF EXISTS exp08_team_lifecycle_proof;
CREATE DATABASE exp08_team_lifecycle_proof;
\c exp08_team_lifecycle_proof
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

-- The incumbent chain, then removal, then the change under test.
\ir ../migrations/20271113850008_exp08_team_hub_collaboration.sql
\ir ../migrations/20271113860008_exp08_team_hub_team_work.sql
\ir ../migrations/20271114160008_exp08_team_hub_files.sql
\ir ../migrations/20271114240008_exp08_team_hub_search.sql
\ir ../migrations/20271114250008_exp08_team_hub_read_performance.sql
\ir ../migrations/20261048000000_an_owner_can_remove_someone_from_their_workspace.sql
\ir ../migrations/20271115040008_exp08_team_lifecycle.sql

-- Replay: a second apply changes nothing the migration owns.
CREATE TEMP VIEW lifecycle_state AS
SELECT 'fn:'||p.oid::regprocedure::text AS k, concat_ws('|', p.proacl::text, p.prosecdef::text, p.provolatile::text,
  p.proconfig::text, md5(p.prosrc)) AS v
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE '%team_hub%' OR p.proname IN
 ('suspend_solo_team_member','reinstate_solo_team_member','remove_solo_team_member','set_solo_team_member_team_hub_access',
  'team_member_holdings','enforce_tenant_member_consent','sync_tenant_member_to_user_roles','_tenant_member_reinstating',
  'create_solo_team_invite','resend_solo_team_invite','accept_solo_team_invite','accept_tenant_invite'))
UNION ALL
SELECT 'trg:'||t.tgname, pg_get_triggerdef(t.oid) FROM pg_trigger t
 WHERE t.tgrelid='public.tenant_members'::regclass AND NOT t.tgisinternal
UNION ALL
SELECT 'col:'||a.attname, concat_ws('|', format_type(a.atttypid,a.atttypmod), a.attnotnull::text,
  pg_get_expr(d.adbin,d.adrelid)) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.tenant_members'::regclass AND a.attnum>0 AND NOT a.attisdropped
UNION ALL
SELECT 'acl:tenant_members', (SELECT relacl::text FROM pg_class WHERE oid='public.tenant_members'::regclass)
UNION ALL
SELECT 'col:invite:'||a.attname, concat_ws('|', format_type(a.atttypid,a.atttypmod), a.attnotnull::text,
  pg_get_expr(d.adbin,d.adrelid)) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.tenant_invite_tokens'::regclass AND a.attnum>0 AND NOT a.attisdropped
UNION ALL
SELECT 'marks', concat_ws('|', (SELECT relacl::text FROM pg_class WHERE oid='public.tenant_member_reinstatement_marks'::regclass),
  (SELECT relrowsecurity::text FROM pg_class WHERE oid='public.tenant_member_reinstatement_marks'::regclass))
UNION ALL
SELECT 'pol:'||tablename||':'||policyname, concat_ws('|', cmd, roles::text, permissive, qual, with_check) FROM pg_policies
 WHERE tablename IN ('paige_invoices','tenant_agreement_versions');
CREATE TEMP TABLE lifecycle_before AS SELECT * FROM lifecycle_state;
\ir ../migrations/20271115040008_exp08_team_lifecycle.sql
DO $$ BEGIN
 IF EXISTS(SELECT k,v FROM lifecycle_before EXCEPT SELECT k,v FROM lifecycle_state)
   OR EXISTS(SELECT k,v FROM lifecycle_state EXCEPT SELECT k,v FROM lifecycle_before) THEN
  RAISE EXCEPTION 'FAIL: a second apply of the lifecycle migration changed a function, trigger, column or grant'; END IF;
END $$;
\echo 'PASS: the lifecycle migration applies over the Team Hub chain and removal; a second apply is a no-op (functions, triggers, both switch columns, the mark table, the five policies)'

-- Structural floor.
DO $$ DECLARE f text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid='public.tenant_members'::regclass AND a.attname='team_hub_access' AND a.attnotnull
    AND a.atttypid='boolean'::regtype AND pg_get_expr(d.adbin,d.adrelid)='true') THEN
  RAISE EXCEPTION 'FAIL: tenant_members.team_hub_access is not boolean NOT NULL DEFAULT true'; END IF;
 IF EXISTS(SELECT 1 FROM public.tenant_members WHERE NOT team_hub_access) THEN
  RAISE EXCEPTION 'FAIL: existing seats did not default to Team conversations on'; END IF;
 FOREACH f IN ARRAY ARRAY['suspend_solo_team_member(uuid,uuid)','reinstate_solo_team_member(uuid,uuid)',
   'remove_solo_team_member(uuid,uuid)','set_solo_team_member_team_hub_access(uuid,uuid,boolean)',
   'team_member_holdings(uuid,uuid)'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=('public.'||f)::regprocedure AND p.prosecdef
     AND p.proconfig=ARRAY['search_path=public, pg_temp'] AND p.prorettype='jsonb'::regtype)
   OR has_function_privilege('anon','public.'||f,'EXECUTE')
   OR NOT has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: % is not a jsonb SECURITY DEFINER act on a pinned search_path for authenticated only', f; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
     WHERE p.oid=('public.'||f)::regprocedure AND a.grantee=0) THEN
   RAISE EXCEPTION 'FAIL: % is executable by PUBLIC', f; END IF;
 END LOOP;
 IF (SELECT provolatile FROM pg_proc WHERE oid='public.team_member_holdings(uuid,uuid)'::regprocedure)<>'s' THEN
  RAISE EXCEPTION 'FAIL: the departure review is not STABLE'; END IF;
 FOREACH f IN ARRAY ARRAY['_team_hub_participates(uuid,uuid)','_team_hub_seat_started()'] LOOP
  IF has_function_privilege('anon','public.'||f,'EXECUTE') OR has_function_privilege('authenticated','public.'||f,'EXECUTE')
    OR has_function_privilege('service_role','public.'||f,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: internal helper % is callable by a browser or service role', f; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
   WHERE t.tgrelid='public.tenant_members'::regclass AND t.tgname='team_hub_seat_started' AND p.prosecdef
    AND p.proconfig=ARRAY['search_path=""']
    AND pg_get_triggerdef(t.oid) LIKE '%AFTER INSERT OR UPDATE OF status ON public.tenant_members FOR EACH ROW%') THEN
  RAISE EXCEPTION 'FAIL: team_hub_seat_started is not an AFTER INSERT OR UPDATE OF status definer trigger'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.tenant_members'::regclass AND NOT tgisinternal)<>10 THEN
  RAISE EXCEPTION 'FAIL: tenant_members should carry the nine incumbent triggers plus team_hub_seat_started'; END IF;
 IF has_table_privilege('authenticated','public.tenant_members','INSERT,UPDATE,DELETE,TRUNCATE')
   OR has_table_privilege('anon','public.tenant_members','INSERT,UPDATE,DELETE,TRUNCATE') THEN
  RAISE EXCEPTION 'FAIL: a browser role holds a write verb on tenant_members'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
   ('remove_solo_team_member','team_hub_post_message','team_hub_create_channel','team_hub_open_dm','team_hub_add_members',
    'team_hub_list_conversations'))<>6 THEN
  RAISE EXCEPTION 'FAIL: a re-emitted door was overloaded rather than replaced'; END IF;
 -- The invitation carries the switch, through ONE create signature reachable only by the service role.
 IF NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid='public.tenant_invite_tokens'::regclass AND a.attname='team_hub_access' AND a.attnotnull
    AND a.atttypid='boolean'::regtype AND pg_get_expr(d.adbin,d.adrelid)='true') THEN
  RAISE EXCEPTION 'FAIL: tenant_invite_tokens.team_hub_access is not boolean NOT NULL DEFAULT true'; END IF;
 IF to_regprocedure('public.create_solo_team_invite(uuid,uuid,text,text,text,text)') IS NOT NULL
   OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='create_solo_team_invite')<>1 THEN
  RAISE EXCEPTION 'FAIL: create_solo_team_invite must have exactly one (seven-argument) signature, or PostgREST calls are ambiguous'; END IF;
 FOREACH f IN ARRAY ARRAY['create_solo_team_invite(uuid,uuid,text,text,text,text,boolean)','resend_solo_team_invite(uuid,uuid,uuid)'] LOOP
  IF has_function_privilege('anon','public.'||f,'EXECUTE') OR has_function_privilege('authenticated','public.'||f,'EXECUTE')
    OR NOT has_function_privilege('service_role','public.'||f,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: % must be executable by the service role only', f; END IF;
 END LOOP;
 -- The reinstatement mark cannot be produced by anyone a request can be: no role holds any privilege on
 -- the table, the helper is unreachable, and the only function that writes it is reinstate.
 IF has_table_privilege('anon','public.tenant_member_reinstatement_marks','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_table_privilege('authenticated','public.tenant_member_reinstatement_marks','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_table_privilege('service_role','public.tenant_member_reinstatement_marks','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.tenant_member_reinstatement_marks'::regclass) THEN
  RAISE EXCEPTION 'FAIL: a request role holds a privilege on the reinstatement marks, or RLS is off'; END IF;
 IF has_function_privilege('anon','public._tenant_member_reinstating(uuid)','EXECUTE')
   OR has_function_privilege('authenticated','public._tenant_member_reinstating(uuid)','EXECUTE')
   OR has_function_privilege('service_role','public._tenant_member_reinstating(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: the reinstatement-mark helper is reachable by a request role'; END IF;
 IF (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
     WHERE p.prosrc ILIKE '%tenant_member_reinstatement_marks%')
   <> ARRAY['_tenant_member_reinstating','reinstate_solo_team_member'] THEN
  RAISE EXCEPTION 'FAIL: something other than reinstate_solo_team_member (and the read helper) touches the reinstatement marks'; END IF;
 IF EXISTS(SELECT 1 FROM public.tenant_member_reinstatement_marks) THEN
  RAISE EXCEPTION 'FAIL: the reinstatement marks are not empty at rest'; END IF;
 -- Every policy that joins tenant_members now requires an active seat.
 IF EXISTS(SELECT 1 FROM pg_policies WHERE (coalesce(qual,'')||coalesce(with_check,'')) ILIKE '%tenant_members%'
   AND (coalesce(qual,'')||coalesce(with_check,'')) NOT ILIKE '%status = ''active''%') THEN
  RAISE EXCEPTION 'FAIL: a policy joins tenant_members without requiring an active seat'; END IF;
END $$;
\echo 'PASS: the switch column defaults on (seats and invitations); five authenticated-only definer acts; one service-role-only create signature; internal helpers and the reinstatement mark unreachable by any request role and written only by reinstate; every tenant_members policy requires an active seat; browser roles still write nothing on tenant_members'

---------------------------------------------------------------------------------------------
-- Session helpers. Each act still runs as its own statement unless try() is used, which runs the
-- act as the browser role and ALWAYS rolls it back, returning 'ok' or the refusal text.
---------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.act(u text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', CASE WHEN u IS NULL THEN '{"role":"authenticated"}'
  ELSE json_build_object('sub',u,'role','authenticated')::text END, false); END $$;
CREATE FUNCTION pg_temp.nojwt() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims','',false); END $$;
CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.try(verb text, actor text, target text, expected text, flag boolean DEFAULT true)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.act(actor);
 BEGIN
  SET ROLE authenticated;
  CASE verb
   WHEN 'suspend' THEN PERFORM public.suspend_solo_team_member(target::uuid, expected::uuid);
   WHEN 'reinstate' THEN PERFORM public.reinstate_solo_team_member(target::uuid, expected::uuid);
   WHEN 'remove' THEN PERFORM public.remove_solo_team_member(target::uuid, expected::uuid);
   WHEN 'switch' THEN PERFORM public.set_solo_team_member_team_hub_access(target::uuid, expected::uuid, flag);
   WHEN 'holdings' THEN PERFORM public.team_member_holdings(target::uuid, expected::uuid);
  END CASE;
  RAISE EXCEPTION 'TRY_OK';
 EXCEPTION WHEN OTHERS THEN
  RETURN CASE WHEN SQLERRM='TRY_OK' THEN 'ok' ELSE SQLERRM END;
 END;
END $$;
-- As the database owner.
CREATE FUNCTION pg_temp.status(t uuid, u uuid) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce((SELECT status FROM public.tenant_members WHERE tenant_id=t AND user_id=u),'none') $$;
CREATE FUNCTION pg_temp.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=u AND role::text=r) $$;
CREATE FUNCTION pg_temp.in_channel(ch uuid, u uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM public.team_hub_channel_members WHERE channel_id=ch AND user_id=u) $$;
CREATE FUNCTION pg_temp.channels_of(t uuid, u uuid) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(coalesce(c.name,'dm'), ',' ORDER BY coalesce(c.name,'dm')),'') FROM public.team_hub_channel_members m
 JOIN public.team_hub_channels c ON c.id=m.channel_id WHERE m.tenant_id=t AND m.user_id=u $$;
CREATE FUNCTION pg_temp.audits(a text) RETURNS bigint LANGUAGE sql AS $$
 SELECT count(*) FROM public.audit_logs WHERE action=a $$;
-- Runs one statement as the browser role under actor's identity (NULL = no JWT, as the service role's
-- edge code), KEEPING what it wrote, and returns 'ok' or the refusal text. A refused statement rolls
-- itself back, as it would over PostgREST.
CREATE FUNCTION pg_temp.run(actor text, q text, as_role text DEFAULT 'authenticated') RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 IF actor IS NULL THEN PERFORM pg_temp.nojwt(); ELSE PERFORM pg_temp.act(actor); END IF;
 BEGIN
  EXECUTE format('SET ROLE %I', as_role);
  EXECUTE q;
  RESET ROLE;
  RETURN 'ok';
 EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
 END;
END $$;
-- Every Team Hub door a teammate uses, reduced to its refusal code (NULL where it succeeded).
CREATE FUNCTION pg_temp.doors(t uuid, ch uuid, other uuid) RETURNS text[] LANGUAGE sql AS $$
 SELECT ARRAY[
  public.team_hub_list_conversations(t)->>'code',
  public.team_hub_create_channel(t,'probe-'||substr(md5(random()::text),1,6),'team','{}',gen_random_uuid())->>'code',
  public.team_hub_open_dm(t,other)->>'code',
  public.team_hub_join_channel(t,ch)->>'code',
  public.team_hub_list_messages(t,ch)->>'code',
  public.team_hub_post_message(t,ch,'probe',gen_random_uuid())->>'code',
  public.team_hub_mark_read(t,ch,gen_random_uuid())->>'code',
  public.team_hub_list_work(t)->>'code',
  public.team_hub_search(t,'probe')->>'code',
  public.team_hub_request_task(t,ch,'Probe task',other,NULL,gen_random_uuid())->>'code',
  public.team_hub_begin_file(t,ch,'probe.pdf','application/pdf',1,gen_random_uuid())->>'code',
  public.team_hub_leave_channel(t,ch)->>'code'] $$;

---------------------------------------------------------------------------------------------
-- 1. Conversations in A, made through the doors: two team channels, an archived one, two private
--    channels and two DMs. u3 joins general only.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT coalesce(public.team_hub_create_channel(:'ta','general','team','{}',gen_random_uuid())->>'channel_id','none') AS general \gset
SELECT coalesce(public.team_hub_create_channel(:'ta','launch','team','{}',gen_random_uuid())->>'channel_id','none') AS launch \gset
SELECT coalesce(public.team_hub_create_channel(:'ta','old','team','{}',gen_random_uuid())->>'channel_id','none') AS old \gset
SELECT coalesce(public.team_hub_create_channel(:'ta','leads','private',ARRAY[:'u3',:'u4',:'u6']::uuid[],gen_random_uuid())->>'channel_id','none') AS leads \gset
SELECT coalesce(public.team_hub_create_channel(:'ta','ops','private','{}',gen_random_uuid())->>'channel_id','none') AS ops \gset
SELECT coalesce(public.team_hub_open_dm(:'ta',:'u3')->>'channel_id','none') AS dm13 \gset
SELECT coalesce(public.team_hub_open_dm(:'ta',:'u6')->>'channel_id','none') AS dm16 \gset
SELECT pg_temp.act(:'u3');
SELECT public.team_hub_join_channel(:'ta',:'general');
RESET ROLE;
UPDATE public.team_hub_channels SET archived_at=now() WHERE id=:'old';
INSERT INTO public.team_hub_channels(tenant_id,kind,name,visibility,created_by)
 VALUES (:'tc','channel','c-general','team',:'u11') RETURNING id AS cgeneral \gset
SELECT pg_temp.check(:'general' IS NOT NULL AND :'launch' IS NOT NULL AND :'leads' IS NOT NULL AND :'dm13' IS NOT NULL
 AND :'dm16' IS NOT NULL AND pg_temp.channels_of(:'ta',:'u3')='dm,general,leads', 'fixture: conversations made through the doors');
\echo 'PASS: fixture conversations exist; u3 is in general, leads and a DM'

---------------------------------------------------------------------------------------------
-- 2. The authority matrix, one rule for every act. Each call is rolled back.
---------------------------------------------------------------------------------------------
DO $$
DECLARE ta text:='20000000-0000-4000-8000-00000000000a'; tb text:='20000000-0000-4000-8000-00000000000b';
 u1 text:='10000000-0000-4000-8000-000000000001'; u2 text:='10000000-0000-4000-8000-000000000002';
 u3 text:='10000000-0000-4000-8000-000000000003'; u4 text:='10000000-0000-4000-8000-000000000004';
 u5 text:='10000000-0000-4000-8000-000000000005'; u7 text:='10000000-0000-4000-8000-000000000007';
 u10 text:='10000000-0000-4000-8000-000000000010'; u26 text:='10000000-0000-4000-8000-000000000026';
 nobody text:='10000000-0000-4000-8000-000000000099';
 noun text; verb text; r text;
BEGIN
 FOREACH verb IN ARRAY ARRAY['suspend','reinstate','remove','switch','holdings'] LOOP
  noun:=CASE verb WHEN 'suspend' THEN 'suspend someone' WHEN 'reinstate' THEN 'reinstate someone'
   WHEN 'remove' THEN 'remove someone' WHEN 'switch' THEN 'change someone''s team conversations'
   ELSE 'review what someone holds' END;
  -- Allowed: owner on a member and on an admin; admin on a member. Reinstate stops at its status
  -- rule, which is reached only once authority has passed.
  FOREACH r IN ARRAY ARRAY[pg_temp.try(verb,u1,u2,ta,false), pg_temp.try(verb,u1,u4,ta,false), pg_temp.try(verb,u3,u5,ta,false)] LOOP
   PERFORM pg_temp.check(r=CASE verb WHEN 'reinstate' THEN 'only a suspended teammate can be reinstated; nothing was changed' ELSE 'ok' END,
    verb||': owner on member/admin and admin on member are allowed (got '||r||')');
  END LOOP;
  -- Refused: a member asks.
  r:=pg_temp.try(verb,u2,u5,ta,false);
  PERFORM pg_temp.check(r LIKE 'only an owner or an admin may '||noun||' %', verb||': a member is refused (got '||r||')');
  -- No oracle: a member asking about someone elsewhere, or nobody, hears the same refusal.
  PERFORM pg_temp.check(pg_temp.try(verb,u2,u7,ta,false)=r AND pg_temp.try(verb,u2,nobody,ta,false)=r,
   verb||': a refused caller learns nothing about who is on the team');
  -- Refused: admin on admin.
  r:=pg_temp.try(verb,u3,u4,ta,false);
  PERFORM pg_temp.check(r LIKE 'only the workspace owner may %', verb||': an admin on an admin is refused (got '||r||')');
  -- Refused: anyone on an owner.
  PERFORM pg_temp.check(pg_temp.try(verb,u3,u1,ta,false) LIKE 'an owner%' AND pg_temp.try(verb,u1,u10,ta,false) LIKE 'an owner%',
   verb||': an owner is never a target');
  -- Refused: oneself.
  PERFORM pg_temp.check(pg_temp.try(verb,u3,u3,ta,false) LIKE 'you cannot %' AND pg_temp.try(verb,u1,u1,ta,false) LIKE 'you cannot %',
   verb||': nobody acts on themselves');
  -- Refused: the expected workspace is not the session's.
  PERFORM pg_temp.check(pg_temp.try(verb,u1,u2,tb,false) LIKE 'your active workspace changed before this could run; nothing was %'
   AND pg_temp.try(verb,u1,u2,NULL,false) LIKE 'your active workspace changed%', verb||': an expected-workspace mismatch is refused');
  -- Refused, no oracle: a target in another workspace reads exactly like nobody at all.
  PERFORM pg_temp.check(pg_temp.try(verb,u1,u7,ta,false)='that person is not on this workspace''s team'
   AND pg_temp.try(verb,u1,nobody,ta,false)='that person is not on this workspace''s team',
   verb||': another workspace''s person is not reachable and indistinguishable from nobody');
  -- Refused: the other workspace's owner cannot reach A's people from B.
  PERFORM pg_temp.check(pg_temp.try(verb,u7,u2,tb,false)='that person is not on this workspace''s team',
   verb||': an owner of B cannot act on a member of A');
  -- Refused: no identity.
  PERFORM pg_temp.check(pg_temp.try(verb,NULL,u2,ta,false)='authentication required in an active workspace',
   verb||': no identity is refused');
  -- Refused: a legacy specialised permission is not relabelled (holdings: the owner may review it).
  r:=pg_temp.try(verb,u1,u26,ta,false);
  PERFORM pg_temp.check(CASE WHEN verb='holdings' THEN r='ok' ELSE r LIKE 'only an Admin or a Member %' END,
   verb||': a legacy coach seat (got '||r||')');
 END LOOP;
 -- Status rules.
 PERFORM pg_temp.check(pg_temp.try('reinstate',u1,u2,ta)='only a suspended teammate can be reinstated; nothing was changed',
  'reinstate: an active seat is refused');
 PERFORM pg_temp.check(pg_temp.try('switch',u1,u2,ta,NULL)='name the person and say whether team conversations are on or off',
  'switch: on/off must be said');
 -- An admin may review a member, but not an admin; an owner may review an admin.
 PERFORM pg_temp.check(pg_temp.try('holdings',u3,u2,ta)='ok' AND pg_temp.try('holdings',u1,u3,ta)='ok'
  AND pg_temp.try('holdings',u3,u4,ta)='only the workspace owner may review what an admin holds', 'holdings: admin reviews members only');
 -- Grants: anon cannot call any act.
 PERFORM pg_temp.check(NOT has_function_privilege('anon','public.team_member_holdings(uuid,uuid)','EXECUTE'), 'anon cannot read holdings');
END $$;
\echo 'PASS: authority matrix for suspend, reinstate, remove, switch and holdings: owner on any admin or member, admin on members only; members, admin-on-admin, owners as targets, oneself, a changed workspace, another workspace and no identity are refused with no membership oracle'

---------------------------------------------------------------------------------------------
-- 3. Suspension: u3 (an admin whose only admin grant is A) and u9 (admin in A and B).
---------------------------------------------------------------------------------------------
INSERT INTO public.coach_clients(tenant_id,coach_user_id,status) VALUES (:'ta',:'u3','active');
SELECT pg_temp.check(pg_temp.has_role(:'u3','admin') AND pg_temp.has_role(:'u9','admin'), 'fixture: u3 and u9 hold global admin');
SELECT pg_temp.audits('member_suspended') AS sus0 \gset
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT public.suspend_solo_team_member(:'u3',:'ta') AS sus3 \gset
SELECT public.suspend_solo_team_member(:'u9',:'ta') AS sus9 \gset
RESET ROLE;
SELECT pg_temp.check((:'sus3')::jsonb->>'status'='suspended' AND (:'sus3')::jsonb->>'tenant_id'=:'ta'
 AND (:'sus3')::jsonb->>'user_id'=:'u3', 'suspend returns the seat it suspended');
SELECT pg_temp.check(pg_temp.status(:'ta',:'u3')='suspended' AND pg_temp.status(:'ta',:'u9')='suspended', 'suspend: the seats are suspended');
SELECT pg_temp.check(NOT pg_temp.has_role(:'u3','admin'), 'suspend: u3 loses the global admin role that only A granted');
SELECT pg_temp.check(pg_temp.has_role(:'u9','admin'), 'suspend: u9 keeps global admin, still granted by B');
SELECT pg_temp.check(pg_temp.channels_of(:'ta',:'u3')='dm,general,leads', 'suspend: private channel and DM memberships are kept (a hold)');
SELECT pg_temp.check((SELECT active_tenant_id FROM public.profiles WHERE user_id=:'u3') IS NULL
 AND (SELECT active_tenant_id FROM public.profiles WHERE user_id=:'u9') IS NULL, 'suspend: the stale active-workspace pointer is cleared');
SELECT pg_temp.check(pg_temp.audits('member_suspended')=:'sus0'::bigint+2
 AND EXISTS(SELECT 1 FROM public.audit_logs WHERE action='member_suspended' AND user_id=:'u1'
  AND data->>'target_user_id'=:'u3' AND data->>'tenant_id'=:'ta' AND data->>'role'='admin'), 'suspend: audited member_suspended');
SELECT pg_temp.check((SELECT status FROM public.coach_clients WHERE coach_user_id=:'u3')='suspended', 'suspend: assigned relationships are suspended by the incumbent trigger');
SELECT pg_temp.check(pg_temp.try('suspend',:'u1',:'u3',:'ta')='only an active teammate can be suspended; nothing was changed', 'suspend: twice is refused');
-- Even pointed back at A, a suspended person resolves nowhere in A and every door refuses.
UPDATE public.profiles SET active_tenant_id=:'ta' WHERE user_id IN (:'u3',:'u9');
SELECT pg_temp.act(:'u3'); SET ROLE authenticated;
SELECT coalesce(public.current_user_tenant_id()::text,'none') AS r3 \gset
SELECT pg_temp.doors(:'ta',:'leads',:'u1') AS d3 \gset
SELECT coalesce(public.team_hub_list_messages(:'ta',:'dm13')->>'code','ok') AS dm3 \gset
SELECT pg_temp.act(:'u9');
SELECT coalesce(public.current_user_tenant_id()::text,'none') AS r9 \gset
SELECT pg_temp.doors(:'ta',:'general',:'u1') AS d9 \gset
RESET ROLE;
SELECT pg_temp.check(:'r3'='none' AND :'r9'=:'tb', 'suspend: current_user_tenant_id no longer resolves to A');
SELECT pg_temp.check((:'d3')::text[]=array_fill('not_member'::text,ARRAY[12]) AND :'dm3'='not_member',
 'suspend: every Team Hub door refuses the suspended person not_member');
SELECT pg_temp.check((:'d9')::text[]=array_fill('scope_changed'::text,ARRAY[12]), 'suspend: a person active elsewhere cannot reach A');
SELECT pg_temp.check(pg_temp.try('holdings',:'u3',:'u2',:'ta')='authentication required in an active workspace',
 'suspend: a suspended admin holds no authority');
\echo 'PASS: suspension holds the seat: global admin revoked unless another seat grants it, private memberships and the row kept, pointer cleared, audited, every door and the workspace resolver refuse'

---------------------------------------------------------------------------------------------
-- 4. Reinstatement brings everything back, as 'active' (never 'pending'), and joins nothing new.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT public.reinstate_solo_team_member(:'u3',:'ta') AS rei3 \gset
RESET ROLE;
SELECT pg_temp.check((:'rei3')::jsonb->>'status'='active' AND pg_temp.status(:'ta',:'u3')='active', 'reinstate: the seat is active, not pending');
SELECT pg_temp.check(pg_temp.has_role(:'u3','admin'), 'reinstate: global admin is re-granted');
SELECT pg_temp.check(pg_temp.channels_of(:'ta',:'u3')='dm,general,leads', 'reinstate: kept memberships are back as they were and no team channel was joined');
SELECT pg_temp.check((SELECT status FROM public.coach_clients WHERE coach_user_id=:'u3')='active', 'reinstate: assigned relationships restored');
SELECT pg_temp.check(pg_temp.audits('member_reinstated')=1 AND EXISTS(SELECT 1 FROM public.audit_logs
 WHERE action='member_reinstated' AND user_id=:'u1' AND data->>'target_user_id'=:'u3'), 'reinstate: audited member_reinstated');
SELECT pg_temp.act(:'u3'); SET ROLE authenticated;
SELECT public.current_user_tenant_id() AS r3b \gset
SELECT coalesce(public.team_hub_list_messages(:'ta',:'leads')->>'ok','false') AS leads3 \gset
SELECT coalesce(public.team_hub_list_conversations(:'ta')->>'ok','false') AS conv3 \gset
RESET ROLE;
-- An admin suspends and reinstates a member.
SELECT pg_temp.act(:'u3'); SET ROLE authenticated;
SELECT coalesce(public.suspend_solo_team_member(:'u5',:'ta')->>'status','none') AS sus5 \gset
SELECT coalesce(public.reinstate_solo_team_member(:'u5',:'ta')->>'status','none') AS rei5 \gset
RESET ROLE;
SELECT pg_temp.check(:'r3b'=:'ta' AND :'leads3'='true' AND :'conv3'='true', 'reinstate: the doors open again, private channel included');
SELECT pg_temp.check(:'sus5'='suspended' AND :'rei5'='active' AND pg_temp.status(:'ta',:'u5')='active', 'an admin suspends and reinstates a member');
\echo 'PASS: reinstatement lands active (not pending), re-grants the global role, restores kept memberships and relationships, joins no new channel, and is audited'

---------------------------------------------------------------------------------------------
-- 5. Removal: an admin removes a member; a suspended seat can be removed and its private
--    memberships end; the owner keeps everything the removal migration gave them.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u3'); SET ROLE authenticated;
SELECT coalesce(public.remove_solo_team_member(:'u5',:'ta')->>'removed_user_id','none') AS rem5 \gset
SELECT pg_temp.act(:'u1');
SELECT coalesce(public.suspend_solo_team_member(:'u4',:'ta')->>'status','none') AS sus4 \gset
SELECT coalesce(public.remove_solo_team_member(:'u4',:'ta')->>'removed_user_id','none') AS rem4 \gset
RESET ROLE;
SELECT pg_temp.check(:'rem5'=:'u5' AND pg_temp.status(:'ta',:'u5')='none', 'remove: an admin removes a member');
SELECT pg_temp.check(:'sus4'='suspended' AND :'rem4'=:'u4' AND pg_temp.status(:'ta',:'u4')='none', 'remove: the owner removes a suspended admin');
SELECT pg_temp.check(NOT pg_temp.in_channel(:'leads',:'u4'), 'remove: a removed suspended seat loses its private memberships');
SELECT pg_temp.check(NOT pg_temp.has_role(:'u4','admin'), 'remove: the removed admin''s only global admin grant is revoked');
SELECT pg_temp.check(pg_temp.audits('member_removed')=2, 'remove: audited member_removed twice');
\echo 'PASS: an admin removes a member; the owner removes a suspended admin, whose private memberships and global role end'

---------------------------------------------------------------------------------------------
-- 5b. The other writer of 'suspended': solo_beta_sync_subscription suspends the OWNER's seat on a
--     billing lapse, as the service role. Its global-role behaviour is unchanged; its private
--     memberships are now kept; reactivating joins nothing.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT coalesce(public.team_hub_add_members(:'ta',:'ops',ARRAY[:'u10']::uuid[])->>'ok','false') AS add10 \gset
RESET ROLE;
SELECT pg_temp.nojwt();
UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=:'ta' AND user_id=:'u10' AND is_owner;
SELECT pg_temp.check(:'add10'='true' AND pg_temp.status(:'ta',:'u10')='suspended', 'billing: the owner seat is suspended');
SELECT pg_temp.check(pg_temp.has_role(:'u10','admin'), 'billing: a billing-suspended owner keeps the global role exactly as before');
SELECT pg_temp.check(pg_temp.in_channel(:'ops',:'u10'), 'billing: a billing-suspended owner keeps private memberships');
UPDATE public.tenant_members SET status='active' WHERE tenant_id=:'ta' AND user_id=:'u10' AND is_owner;
SELECT pg_temp.check(pg_temp.status(:'ta',:'u10')='active' AND pg_temp.channels_of(:'ta',:'u10')='ops',
 'billing: reactivating the owner joins no team channel');
\echo 'PASS: a billing suspension of the owner seat (the only other writer of suspended) keeps its global role as before, keeps private memberships, and reactivation joins nothing'

---------------------------------------------------------------------------------------------
-- 5c. A suspension is lifted ONLY by reinstate_solo_team_member (or trusted no-JWT database code).
--     Every attack is the review's, run through the PRODUCTION bodies loaded above: three role
--     functions that write status = 'active' onto an existing seat, the two self-seating paths, a
--     direct service-role table write, and a mark left over from another transaction.
---------------------------------------------------------------------------------------------
SELECT pg_temp.nojwt();
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES
 (:'ta',:'u28','member','active'), (:'ta',:'u29','admin','active'), (:'tc',:'u27','admin','active');
INSERT INTO public.fixture_agency_managers VALUES (:'tc',:'u27');
UPDATE public.profiles SET active_tenant_id=:'tc' WHERE user_id=:'u27';
INSERT INTO public.user_roles(user_id,role) VALUES (:'u9','user') ON CONFLICT DO NOTHING;
INSERT INTO public.tenant_invite_tokens(tenant_id,token,kind,default_role) VALUES (:'ta','staff-token-28','staff','member');
INSERT INTO public.tenant_invite_tokens(tenant_id,token,kind,email,default_role) VALUES (:'ta','team-token-28','team','person28@example.test','member');
SELECT pg_temp.check(pg_temp.has_role(:'u29','admin') AND pg_temp.has_role(:'u7','admin')
 AND pg_temp.has_role(:'u9','admin') AND pg_temp.status(:'ta',:'u9')='suspended', 'fixture: u29, u7 and u9 hold global admin; u9 is suspended in A');
SELECT pg_temp.run(:'u1',format('SELECT public.suspend_solo_team_member(%L,%L)',:'u28',:'ta')) AS s28,
 pg_temp.run(:'u1',format('SELECT public.suspend_solo_team_member(%L,%L)',:'u29',:'ta')) AS s29,
 pg_temp.run(:'u11',format('SELECT public.suspend_solo_team_member(%L,%L)',:'u27',:'tc')) AS s27 \gset
SELECT pg_temp.check(:'s28'='ok' AND :'s29'='ok' AND :'s27'='ok' AND NOT pg_temp.has_role(:'u29','admin'),
 'fixture: u28, u29 (A) and u27 (C) suspended; u29 lost the global admin only A granted');
-- (a) An admin re-grants a suspended admin a harmless role. (b) An admin tries to promote a suspended
-- member: refused, because while a seat is suspended only the owner changes its role (rule 1b). The
-- owner may, and the seat stays suspended holding no global admin.
SELECT pg_temp.run(:'u3',format('SELECT public.grant_tenant_member_role(%L,''user'',%L)',:'u29',:'ta')) AS a1,
 pg_temp.run(:'u3',format('SELECT public.grant_tenant_member_role(%L,''admin'',%L)',:'u28',:'ta')) AS a2 \gset
SELECT pg_temp.check(:'a1'='ok' AND pg_temp.status(:'ta',:'u29')='suspended' AND NOT pg_temp.has_role(:'u29','admin'),
 'B1: grant_tenant_member_role on a suspended admin leaves them suspended, with no global admin');
SELECT pg_temp.check(:'a2'='only the workspace owner can change a suspended teammate''s role or seat; nothing was changed'
 AND pg_temp.status(:'ta',:'u28')='suspended'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u28')='member'
 AND NOT pg_temp.has_role(:'u28','admin'),
 '1b: an admin cannot promote a suspended member; the grant is refused whole and nothing changed');
SELECT pg_temp.run(:'u1',format('SELECT public.grant_tenant_member_role(%L,''admin'',%L)',:'u28',:'ta')) AS a2o \gset
SELECT pg_temp.check(:'a2o'='ok' AND pg_temp.status(:'ta',:'u28')='suspended'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u28')='admin'
 AND NOT pg_temp.has_role(:'u28','admin'),
 '1b/B1: the owner may promote a suspended member; they stay suspended and hold no global admin');
-- (c) The owner of ANOTHER workspace, never a member of A, through change_user_role's global-role authority.
--     Admin scope stage 0 (20271115030008) took that authority away: a global 'admin' is no longer
--     admin power in A, so the call is refused before any write. The guarantee (the seat stays
--     suspended, no global admin appears) now holds for stage 0's reason; the one caller stage 0's
--     body still lets reach a suspended seat's upsert, a platform owner, is driven in (j).
SELECT pg_temp.run(:'u7',format('SELECT public.change_user_role(%L,''user'',''user'',%L)',:'u28',:'ta')) AS a3 \gset
SELECT pg_temp.check(:'a3'='ROLE_CHANGE_FORBIDDEN: admin privileges required' AND pg_temp.status(:'ta',:'u28')='suspended'
 AND NOT pg_temp.has_role(:'u28','admin'),
 'B1: a cross-tenant change_user_role is refused (stage 0) and does not reactivate the seat');
-- (d) revoke_tenant_member_role's re-seat branch on a suspended admin who keeps global admin through B.
SELECT pg_temp.run(:'u3',format('SELECT public.revoke_tenant_member_role(%L,''user'',%L)',:'u9',:'ta')) AS a4 \gset
SELECT pg_temp.check(:'a4'='ok' AND pg_temp.status(:'ta',:'u9')='suspended', 'B1: revoke_tenant_member_role does not reactivate a suspended admin');
-- (e) A billing suspension of a co-owner (no JWT), then an admin's grant; then billing reactivates.
UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=:'ta' AND user_id=:'u10';
SELECT pg_temp.run(:'u3',format('SELECT public.grant_tenant_member_role(%L,''user'',%L)',:'u10',:'ta')) AS a5 \gset
SELECT pg_temp.status(:'ta',:'u10') AS st10 \gset
SELECT pg_temp.nojwt();
UPDATE public.tenant_members SET status='active' WHERE tenant_id=:'ta' AND user_id=:'u10';
SELECT pg_temp.check(:'a5'='ok' AND :'st10'='suspended', 'B1: an admin''s grant does not lift a billing suspension');
SELECT pg_temp.check(pg_temp.status(:'ta',:'u10')='active', 'B1: billing (trusted, no JWT, the database owner) still reactivates the owner seat');
-- (f) The suspended person themselves: a generic staff invite, and a Solo Team invite.
SELECT pg_temp.run(:'u28','SELECT public.accept_tenant_invite(''staff-token-28'')') AS a6,
 pg_temp.run(:'u28','SELECT public.accept_solo_team_invite(''team-token-28'')') AS a7 \gset
SELECT pg_temp.check(:'a6'='ok' AND pg_temp.status(:'ta',:'u28')='suspended', 'B1/S2: accept_tenant_invite''s generic branch does not reactivate the person''s own suspended seat');
SELECT pg_temp.check(:'a7'='this account already belongs to the workspace' AND pg_temp.status(:'ta',:'u28')='suspended',
 'B1/S2: accept_solo_team_invite refuses a suspended person (they already belong)');
-- (g) A suspended agency manager re-entering the sub-account.
SELECT pg_temp.run(:'u27',format('SELECT public.agency_enter_subaccount(%L)',:'tc')) AS a8 \gset
SELECT pg_temp.check(:'a8'='ok' AND pg_temp.status(:'tc',:'u27')='suspended', 'B1/S2: agency_enter_subaccount does not reactivate the manager''s own suspended seat');
-- Recorded, not fixed here (open decision): the workspace resolver still admits an agency manager by
-- agency standing, so the suspended seat does not keep them out of the sub-account itself.
SELECT pg_temp.act(:'u27'); SET ROLE authenticated;
SELECT coalesce(public.current_user_tenant_id()::text,'none') AS r27 \gset
RESET ROLE;
SELECT pg_temp.check(:'r27'=:'tc', 'recorded: a suspended agency manager still resolves the sub-account through agency standing');
-- (h) A direct service-role table write with no JWT (the accept-invite edge function's upsert).
SELECT pg_temp.run(NULL,format('UPDATE public.tenant_members SET status=''active'' WHERE tenant_id=%L AND user_id=%L',:'ta',:'u29'),'service_role') AS a9 \gset
SELECT pg_temp.check(:'a9'='ok' AND pg_temp.status(:'ta',:'u29')='suspended', 'B1: a direct service-role write does not lift a suspension');
-- (i) A mark made in ANOTHER transaction proves nothing in this one.
SELECT pg_temp.nojwt();
INSERT INTO public.tenant_member_reinstatement_marks(membership_id)
 SELECT id FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u29';
SELECT pg_temp.run(:'u3',format('SELECT public.grant_tenant_member_role(%L,''user'',%L)',:'u29',:'ta')) AS a10 \gset
SELECT pg_temp.check(:'a10'='ok' AND pg_temp.status(:'ta',:'u29')='suspended', 'B1: a reinstatement mark from another transaction lifts nothing');
DELETE FROM public.tenant_member_reinstatement_marks;
-- (j) Rule 1b, review round 2's B2 and S5, through the PRODUCTION role bodies. u34 is an admin the
--     owner suspends (so the suspension revokes the global admin only A granted); u35 and u37 are
--     suspended members; u36 is a platform owner who belongs to no workspace.
\set u34 '10000000-0000-4000-8000-000000000034'
\set u35 '10000000-0000-4000-8000-000000000035'
\set u36 '10000000-0000-4000-8000-000000000036'
\set u37 '10000000-0000-4000-8000-000000000037'
SELECT pg_temp.nojwt();
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES (:'u35','person35@example.test',now()),
 (:'u36','person36@example.test',now()), (:'u37','person37@example.test',now());
INSERT INTO public.profiles(user_id,full_name,active_tenant_id) VALUES (:'u35','Person 35',:'ta'),
 (:'u36','Person 36',NULL), (:'u37','Person 37',:'ta');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES
 (:'ta',:'u34','admin','active'), (:'ta',:'u35','member','active'), (:'ta',:'u37','member','active');
INSERT INTO public.user_roles(user_id,role) VALUES (:'u34','user'),(:'u35','viewer'),(:'u37','viewer') ON CONFLICT DO NOTHING;
INSERT INTO public.fixture_platform_admins VALUES (:'u36');
SELECT pg_temp.run(:'u1',format('SELECT public.suspend_solo_team_member(%L,%L)',:'u34',:'ta')) AS s34,
 pg_temp.run(:'u1',format('SELECT public.suspend_solo_team_member(%L,%L)',:'u35',:'ta')) AS s35,
 pg_temp.run(:'u3',format('SELECT public.suspend_solo_team_member(%L,%L)',:'u37',:'ta')) AS s37 \gset
SELECT pg_temp.check(:'s34'='ok' AND :'s35'='ok' AND :'s37'='ok' AND NOT pg_temp.has_role(:'u34','admin'),
 'fixture: u34 (admin), u35 and u37 (members) suspended; u34 lost the global admin');
-- B2: admin u3 cannot end the owner-suspended admin's seat through revoke_tenant_member_role.
SELECT pg_temp.run(:'u3',format('SELECT public.remove_solo_team_member(%L,%L)',:'u34',:'ta')) AS b2r,
 pg_temp.run(:'u3',format('SELECT public.revoke_tenant_member_role(%L,''user'',%L)',:'u34',:'ta')) AS b2 \gset
SELECT pg_temp.check(:'b2r' LIKE 'only the workspace owner may remove an admin%'
 AND :'b2'='only the workspace owner can change a suspended teammate''s role or seat; nothing was changed'
 AND pg_temp.status(:'ta',:'u34')='suspended' AND pg_temp.has_role(:'u34','user'),
 'B2: an admin''s revoke_tenant_member_role on a suspended admin is refused whole: the seat stays suspended, the global role it deleted is back');
-- S5: admin u3 demotes the suspended admin through change_user_role, then tries to reinstate them.
--     Since admin scope stage 0, change_user_role refuses a target with no ACTIVE seat in the workspace
--     (outside the platform-operator paths) before it writes anything, so the demotion never reaches
--     rule 1b: no user_roles change, no seat write, no mirror_failed row. The seat is unchanged for
--     stage 0's reason; rule 1b's refusal of an admin is still driven by grant (1b above), revoke (B2)
--     and the service-role write below.
SELECT count(*) AS mf0 FROM public.paige_audit_log WHERE action='role:change:mirror_failed' AND target_id=:'u34' \gset
SELECT pg_temp.run(:'u3',format('SELECT public.change_user_role(%L,''user'',''viewer'',%L)',:'u34',:'ta')) AS s5a \gset
SELECT pg_temp.run(:'u3',format('SELECT public.reinstate_solo_team_member(%L,%L)',:'u34',:'ta')) AS s5b \gset
SELECT pg_temp.check(:'s5a'='ROLE_CHANGE_FORBIDDEN: this person is not an active member of this workspace'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u34')='admin'
 AND pg_temp.status(:'ta',:'u34')='suspended' AND pg_temp.has_role(:'u34','user') AND NOT pg_temp.has_role(:'u34','viewer')
 AND (SELECT count(*) FROM public.paige_audit_log WHERE action='role:change:mirror_failed' AND target_id=:'u34')=:'mf0'::bigint,
 'S5: change_user_role cannot demote a suspended admin (refused whole by stage 0); the seat and the global role are unchanged');
SELECT pg_temp.check(:'s5b'='only the workspace owner may reinstate an admin in this workspace' AND pg_temp.status(:'ta',:'u34')='suspended',
 'S5: so the admin still cannot reinstate them');
-- A direct service-role table write (the accept-invite edge upsert) cannot change a suspended seat's role.
SELECT pg_temp.run(NULL,format('UPDATE public.tenant_members SET role=''admin'' WHERE tenant_id=%L AND user_id=%L',:'ta',:'u35'),'service_role') AS svc35 \gset
SELECT pg_temp.check(:'svc35'='only the workspace owner can change a suspended teammate''s role or seat; nothing was changed'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u35')='member',
 '1b: a direct service-role write cannot change a suspended seat''s role');
-- What still works. An admin flips a suspended member's Team conversations switch (not authority).
SELECT pg_temp.run(:'u3',format('SELECT public.set_solo_team_member_team_hub_access(%L,%L,false)',:'u35',:'ta')) AS sw35 \gset
SELECT pg_temp.check(:'sw35'='ok' AND NOT (SELECT team_hub_access FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u35')
 AND pg_temp.status(:'ta',:'u35')='suspended', '1b: an admin can still change a suspended member''s Team conversations switch');
-- The platform owner, the one caller stage 0's change_user_role still lets reach a suspended seat's
-- upsert (its operator path), cannot reactivate it either: rule (1) keeps the seat suspended.
SELECT pg_temp.run(:'u36',format('SELECT public.change_user_role(%L,''viewer'',''viewer'',%L)',:'u35',:'ta')) AS p35 \gset
SELECT pg_temp.check(:'p35'='ok' AND pg_temp.status(:'ta',:'u35')='suspended'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u35')='member',
 'B1: a platform owner''s change_user_role (stage 0''s operator path) does not reactivate a suspended seat');
-- And a platform owner PROMOTING a suspended member through change_user_role: since stage 0 the one
-- writer left that puts a global 'admin' row down before writing a suspended seat (grant no longer
-- writes 'admin' at all). The seat takes the role (1b allows a platform owner), stays suspended, and
-- the seat sync's suspended branch (section B) takes the global 'admin' back.
\set u44 '10000000-0000-4000-8000-000000000044'
SELECT pg_temp.nojwt();
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES (:'u44','person44@example.test',now());
INSERT INTO public.profiles(user_id,full_name,active_tenant_id) VALUES (:'u44','Person 44',:'ta');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES (:'ta',:'u44','member','active');
INSERT INTO public.user_roles(user_id,role) VALUES (:'u44','user') ON CONFLICT DO NOTHING;
SELECT pg_temp.run(:'u1',format('SELECT public.suspend_solo_team_member(%L,%L)',:'u44',:'ta')) AS s44 \gset
SELECT pg_temp.run(:'u36',format('SELECT public.change_user_role(%L,''user'',''admin'',%L)',:'u44',:'ta')) AS p44 \gset
SELECT pg_temp.check(:'s44'='ok' AND :'p44'='ok' AND pg_temp.status(:'ta',:'u44')='suspended'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u44')='admin'
 AND NOT pg_temp.has_role(:'u44','admin'),
 '1b/B1: a platform owner may promote a suspended member through change_user_role; they stay suspended and hold no global admin');
-- The owner of the workspace: since stage 0 change_user_role refuses a suspended target outright (it
-- is not an ACTIVE member), so the owner's role change on a suspended seat goes through
-- grant_tenant_member_role (1b/B1 above) and trusted code (below). The owner ends a suspended
-- member's seat.
SELECT pg_temp.run(:'u1',format('SELECT public.change_user_role(%L,''user'',''viewer'',%L)',:'u34',:'ta')) AS o34,
 pg_temp.run(:'u1',format('SELECT public.revoke_tenant_member_role(%L,''viewer'',%L)',:'u35',:'ta')) AS o35 \gset
SELECT pg_temp.check(:'o34'='ROLE_CHANGE_FORBIDDEN: this person is not an active member of this workspace'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u34')='admin'
 AND pg_temp.status(:'ta',:'u34')='suspended',
 'stage 0: change_user_role refuses even the owner on a suspended seat; the seat is unchanged and stays suspended');
SELECT pg_temp.check(:'o35'='ok' AND pg_temp.status(:'ta',:'u35')='revoked', '1b: the owner can end a suspended member''s seat');
-- A platform owner who belongs to no workspace ends a suspended member's seat.
SELECT pg_temp.run(:'u36',format('SELECT public.revoke_tenant_member_role(%L,''viewer'',%L)',:'u37',:'ta')) AS p37 \gset
SELECT pg_temp.check(:'p37'='ok' AND pg_temp.status(:'ta',:'u37')='revoked', '1b: a platform owner can end a suspended seat');
-- Trusted database code with no JWT (as a migration or billing) may change a suspended seat.
SELECT pg_temp.nojwt();
UPDATE public.tenant_members SET role='member' WHERE tenant_id=:'ta' AND user_id=:'u34';
SELECT pg_temp.check((SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u34')='member'
 AND pg_temp.status(:'ta',:'u34')='suspended', '1b: trusted no-JWT database code may change a suspended seat');
UPDATE public.tenant_members SET role='admin' WHERE tenant_id=:'ta' AND user_id=:'u34';
SELECT pg_temp.check((SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u34')='admin'
 AND pg_temp.status(:'ta',:'u34')='suspended', '1b: and back; the seat stays suspended');
-- (k) Review round 3's B3, X6 and X7: the accept-invite edge function's consume path. It used to
--     write the global role first and the seat second, two unchecked service-role statements, so a
--     suspended member holding an admin invitation kept the global admin that 1b's refused seat write
--     never took back, and could then demote the workspace's active admins through every reader of
--     the global role (change_user_role's production body among them). The edge function now runs
--     team-seat.ts; pg_temp.edge_accept is that file's order, statement for statement, as the service
--     role with no JWT (each statement its own savepoint, as each PostgREST call is its own
--     transaction): (1) read the seat and refuse anything not active; (2) the SEAT first, RETURNING
--     its status, refused unless active; (3) the global role; (4) the seat again, taking back a role
--     this call added if the seat is no longer active. supabase/functions/accept-invite/team-seat.test.ts
--     holds the same contract against the TypeScript itself. skip_check = true drives step (2) as if
--     a suspension landed between (1) and (2).
\set u38 '10000000-0000-4000-8000-000000000038'
\set u39 '10000000-0000-4000-8000-000000000039'
\set u40 '10000000-0000-4000-8000-000000000040'
\set u41 '10000000-0000-4000-8000-000000000041'
\set u42 '10000000-0000-4000-8000-000000000042'
CREATE FUNCTION pg_temp.edge_accept(p_user uuid, p_tenant uuid, p_app_role text, skip_check boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE _seat record; _landed text; _had boolean; _after text; _invited text;
BEGIN
 PERFORM pg_temp.nojwt();
 SET ROLE service_role;
 _invited := CASE WHEN p_app_role = 'admin' THEN 'admin' ELSE 'member' END;
 SELECT id, status, role::text AS role, is_owner INTO _seat FROM public.tenant_members
  WHERE tenant_id = p_tenant AND user_id = p_user;
 IF NOT skip_check AND _seat.id IS NOT NULL AND _seat.status <> 'active' THEN
  RESET ROLE; RETURN 'seat_not_active';
 END IF;
 _had := EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role::text = p_app_role);
 _landed := CASE WHEN _seat.id IS NULL THEN _invited
                 WHEN _seat.is_owner OR _seat.role = 'owner' THEN _seat.role
                 WHEN _invited = 'admin' THEN 'admin' ELSE _seat.role END;
 IF _seat.id IS NULL OR _landed <> _seat.role THEN
  BEGIN
   INSERT INTO public.tenant_members(tenant_id, user_id, role, status, invited_at, joined_at)
   VALUES (p_tenant, p_user, _landed::public.tenant_role, 'active', now(), now())
   ON CONFLICT (tenant_id, user_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, user_id = EXCLUDED.user_id,
    role = EXCLUDED.role, status = EXCLUDED.status, invited_at = EXCLUDED.invited_at, joined_at = EXCLUDED.joined_at
   RETURNING status INTO _after;
  EXCEPTION WHEN OTHERS THEN
   RESET ROLE; RETURN CASE WHEN SQLSTATE = '42501' THEN 'seat_refused: ' || SQLERRM ELSE 'seat_write_failed' END;
  END;
  IF _after <> 'active' THEN RESET ROLE; RETURN 'seat_not_active'; END IF;
 END IF;
 INSERT INTO public.user_roles(user_id, role) VALUES (p_user, p_app_role::public.app_role)
  ON CONFLICT (user_id, role) DO UPDATE SET user_id = EXCLUDED.user_id, role = EXCLUDED.role;
 SELECT status INTO _after FROM public.tenant_members WHERE tenant_id = p_tenant AND user_id = p_user;
 IF _after IS DISTINCT FROM 'active' THEN
  IF NOT _had THEN DELETE FROM public.user_roles WHERE user_id = p_user AND role::text = p_app_role; END IF;
  RESET ROLE; RETURN 'seat_not_active';
 END IF;
 RESET ROLE;
 RETURN 'ok';
END $$;
SELECT pg_temp.nojwt();
INSERT INTO auth.users(id,email,email_confirmed_at) SELECT x::uuid, 'person'||right(x,2)||'@example.test', now()
 FROM unnest(ARRAY[:'u38',:'u39',:'u40',:'u41',:'u42']) x;
INSERT INTO public.profiles(user_id,full_name,active_tenant_id) SELECT x::uuid, 'Person '||right(x,2), :'ta'
 FROM unnest(ARRAY[:'u38',:'u39',:'u40',:'u41',:'u42']) x;
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES
 (:'ta',:'u38','member','active'), (:'ta',:'u39','admin','active'), (:'ta',:'u40','admin','active'), (:'ta',:'u42','member','active');
INSERT INTO public.user_roles(user_id,role) VALUES (:'u38','user'),(:'u42','user') ON CONFLICT DO NOTHING;
SELECT pg_temp.run(:'u1',format('SELECT public.suspend_solo_team_member(%L,%L)',:'u38',:'ta')) AS s38,
 pg_temp.run(:'u1',format('SELECT public.suspend_solo_team_member(%L,%L)',:'u39',:'ta')) AS s39 \gset
SELECT pg_temp.check(:'s38'='ok' AND :'s39'='ok' AND pg_temp.has_role(:'u40','admin') AND NOT pg_temp.has_role(:'u38','admin')
 AND NOT pg_temp.has_role(:'u39','admin'), 'fixture: u38 (member) and u39 (admin) suspended, neither holds global admin; u40 is an active admin');
-- X6: the suspended member u38 accepts an admin invitation (an admin can send one: send-admin-invitation
-- and PAIGE's create_team_invitation both offer 'admin'). Refused before any write.
SELECT count(*) AS w0 FROM public.user_roles \gset
SELECT pg_temp.edge_accept(:'u38',:'ta','admin') AS x6 \gset
SELECT pg_temp.check(:'x6'='seat_not_active' AND pg_temp.status(:'ta',:'u38')='suspended'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u38')='member'
 AND NOT pg_temp.has_role(:'u38','admin') AND (SELECT count(*) FROM public.user_roles)=:'w0'::bigint,
 'X6/B3: a suspended member''s admin invitation is refused before any write and leaves no global admin');
-- X6, the race: had a suspension landed after the check, the SEAT is written first, 1b refuses it, and
-- the global role is never written.
SELECT pg_temp.edge_accept(:'u38',:'ta','admin',true) AS x6r \gset
SELECT pg_temp.check(:'x6r'='seat_refused: only the workspace owner can change a suspended teammate''s role or seat; nothing was changed'
 AND pg_temp.status(:'ta',:'u38')='suspended' AND NOT pg_temp.has_role(:'u38','admin'),
 'X6/B3: even past the check, the seat is written first, 1b refuses it, and no global admin is written');
-- X6 control: the suspended ADMIN u39 (no role change). Refused at the check; past it, its seat write
-- lands 'suspended' (rule 1), the RETURNING status says so, and the global role is not written.
SELECT pg_temp.edge_accept(:'u39',:'ta','admin') AS x6c, pg_temp.edge_accept(:'u39',:'ta','sales_rep',true) AS x6cr \gset
SELECT pg_temp.check(:'x6c'='seat_not_active' AND :'x6cr'='seat_not_active' AND pg_temp.status(:'ta',:'u39')='suspended'
 AND NOT pg_temp.has_role(:'u39','admin') AND NOT pg_temp.has_role(:'u39','sales_rep'),
 'X6/B3: a suspended admin''s invitation is refused too, and lifts nothing even past the check');
-- X7: without the global admin, the suspended u38 (no active workspace) cannot demote the active admin
-- u40 through change_user_role. Under admin scope stage 0 this holds twice over: change_user_role no
-- longer reads a global 'admin' as authority at all (is_workspace_admin needs an active owner/admin
-- seat in A), so even a leaked global admin would not open it. The no-global-admin half of B3 is
-- asserted directly by X6 above and by every NOT has_role(u38,'admin') below.
UPDATE public.profiles SET active_tenant_id=NULL WHERE user_id=:'u38';
SELECT pg_temp.run(:'u38',format('SELECT public.change_user_role(%L,''user'',''viewer'',%L)',:'u40',:'ta')) AS x7 \gset
SELECT pg_temp.check(:'x7' LIKE 'ROLE_CHANGE_FORBIDDEN%'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u40')='admin'
 AND pg_temp.status(:'ta',:'u40')='active' AND pg_temp.has_role(:'u40','admin'),
 'X7/B3: the suspended member cannot demote an active admin; u40 stays an active admin with global admin');
-- The accepts that must keep working: a new person, and an already-active member raised to admin.
SELECT pg_temp.edge_accept(:'u41',:'ta','admin') AS n41, pg_temp.edge_accept(:'u42',:'ta','admin') AS n42 \gset
SELECT pg_temp.check(:'n41'='ok' AND pg_temp.status(:'ta',:'u41')='active'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u41')='admin'
 AND pg_temp.has_role(:'u41','admin'), 'B3: a new person''s admin invitation seats them active as admin with global admin');
SELECT pg_temp.check(:'n42'='ok' AND pg_temp.status(:'ta',:'u42')='active'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u42')='admin'
 AND pg_temp.has_role(:'u42','admin'), 'B3: an already-active member''s admin invitation raises them to admin');
-- Production's user_roles sync trigger, now loaded, as it bears on a suspended seat (review round 3's
-- note, recorded rather than changed): it seats the grantee in the CALLER's current workspace. Before
-- admin scope stage 0, an admin of A and E, working in A, who granted the suspended u38 'admin' in E
-- wrote the global 'admin' row first, the sync trigger then upserted u38's seat in A, and 1b refused
-- the whole grant. Stage 0's grant_tenant_member_role never writes a global 'admin' row, so the sync
-- trigger never fires and nothing touches u38's seat in A: the grant is an ordinary invitation to E,
-- which the consent trigger holds as an inert 'pending' seat until u38 accepts. Still never a leak:
-- no active seat in E, the suspension in A untouched, no global admin.
\set te '20000000-0000-4000-8000-00000000000e'
\set u43 '10000000-0000-4000-8000-000000000043'
SELECT pg_temp.nojwt();
INSERT INTO public.tenants(id,name,account_type) VALUES (:'te','Workspace E','standalone');
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES (:'u43','person43@example.test',now());
INSERT INTO public.profiles(user_id,full_name,active_tenant_id) VALUES (:'u43','Person 43',:'ta');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES (:'ta',:'u43','admin','active'),(:'te',:'u43','admin','active');
SELECT pg_temp.run(:'u43',format('SELECT public.grant_tenant_member_role(%L,''admin'',%L)',:'u38',:'te')) AS sx \gset
SELECT pg_temp.check(:'sx'='ok'
 AND pg_temp.status(:'te',:'u38')='pending' AND pg_temp.status(:'ta',:'u38')='suspended'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u38')='member'
 AND NOT pg_temp.has_role(:'u38','admin'),
 'recorded: a grant in E to someone suspended in the granter''s current workspace (A) leaves A untouched, seats E only as pending, and writes no global admin (stage 0)');
-- What the sync trigger still does under stage 0: a NON-admin grant to someone ACTIVE in E writes the
-- global row (stage 0 allows it for a real teammate of E), and the trigger then upserts that person's
-- seat in the granter's current workspace A. Someone with no seat in A gets an inert pending one
-- (consent rule 2); someone SUSPENDED in A has the trigger's status = 'active' held by rule (1) and
-- keeps their role (the trigger raises only to admin). Recorded, not changed here.
\set u45 '10000000-0000-4000-8000-000000000045'
\set u46 '10000000-0000-4000-8000-000000000046'
SELECT pg_temp.nojwt();
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES (:'u45','person45@example.test',now()),(:'u46','person46@example.test',now());
INSERT INTO public.profiles(user_id,full_name,active_tenant_id) VALUES (:'u45','Person 45',:'te'),(:'u46','Person 46',:'te');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES
 (:'ta',:'u45','member','active'),(:'te',:'u45','member','active'),(:'te',:'u46','member','active');
SELECT pg_temp.run(:'u1',format('SELECT public.suspend_solo_team_member(%L,%L)',:'u45',:'ta')) AS s45 \gset
SELECT pg_temp.run(:'u43',format('SELECT public.grant_tenant_member_role(%L,''sales_rep'',%L)',:'u45',:'te')) AS g45,
 pg_temp.run(:'u43',format('SELECT public.grant_tenant_member_role(%L,''sales_rep'',%L)',:'u46',:'te')) AS g46 \gset
SELECT pg_temp.check(:'s45'='ok' AND :'g45'='ok' AND :'g46'='ok'
 AND pg_temp.has_role(:'u45','sales_rep') AND pg_temp.has_role(:'u46','sales_rep')
 AND pg_temp.status(:'te',:'u45')='active' AND pg_temp.status(:'te',:'u46')='active'
 AND pg_temp.status(:'ta',:'u45')='suspended'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u45')='member'
 AND pg_temp.status(:'ta',:'u46')='pending',
 'recorded: the user_roles sync trigger seats a non-admin grantee in the granter''s current workspace; a suspended seat there stays suspended (rule 1), a new one is pending');
-- And an already-active admin accepting a staff invitation is not lowered.
SELECT pg_temp.edge_accept(:'u42',:'ta','sales_rep') AS n42b \gset
SELECT pg_temp.check(:'n42b'='ok' AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u42')='admin'
 AND pg_temp.has_role(:'u42','sales_rep') AND pg_temp.has_role(:'u42','admin'),
 'B3: an active admin''s staff invitation adds that role and never lowers the seat');
-- A platform owner with no current workspace promotes the suspended u38 through grant. Since stage 0,
-- grant_tenant_member_role writes no global 'admin' row for anyone, so there is nothing to take back;
-- the seat sync's suspended branch (section B) is driven by change_user_role's operator path (u44, 5c j).
SELECT pg_temp.run(:'u36',format('SELECT public.grant_tenant_member_role(%L,''admin'',%L)',:'u38',:'ta')) AS po38 \gset
SELECT pg_temp.check(:'po38'='ok' AND pg_temp.status(:'ta',:'u38')='suspended'
 AND (SELECT role::text FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u38')='admin'
 AND NOT pg_temp.has_role(:'u38','admin'),
 '1b/B1: a platform owner with no workspace may promote a suspended member; they stay suspended and hold no global admin');
-- Throughout, the suspended people reached nothing.
SELECT pg_temp.act(:'u28'); SET ROLE authenticated;
SELECT coalesce(public.team_hub_list_conversations(:'ta')->>'code','ok') AS door28 \gset
SELECT pg_temp.act(:'u2');
SELECT coalesce(public.team_hub_list_conversations(:'ta')->>'ok','false') AS door2 \gset
RESET ROLE;
SELECT pg_temp.check(:'door28'='not_member' AND :'door2'='true', 'B1: the attacked seats stay shut out; an active teammate is unaffected');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.tenant_member_reinstatement_marks), 'B1: the reinstatement marks are empty');
\echo 'PASS: B1 a suspension is lifted only by reinstatement: grant_tenant_member_role, change_user_role (cross-tenant), revoke_tenant_member_role, accept_tenant_invite, accept_solo_team_invite, agency_enter_subaccount, a direct service-role write and a stale mark all leave the seat suspended (production bodies); billing still reactivates'
\echo 'PASS: 1b while a seat is suspended only the owner, a platform owner or trusted no-JWT code changes its role or ends it: B2 (admin revoke of a suspended admin) and S5 (admin demote-then-reinstate) are refused, an admin promotion and a direct service-role role write are refused; the owner, a platform owner and trusted code still can, and the switch stays an admin''s to change'
\echo 'PASS: B3/X6/X7 accepting a team invitation (the edge function''s order, as the service role, with production''s user_roles triggers): a suspended member or admin is refused before any write and, even past the check, the seat is written first and refused or read back suspended, so no global admin is ever written; the suspended member cannot demote an active admin; a new person and an active member are seated, and an active admin is never lowered'


---------------------------------------------------------------------------------------------
-- 6. Consent: nobody can mint a suspended seat that was never active, so "reinstate" cannot
--    launder a foreign activation. The writes run as the database owner (as every definer does)
--    under a foreign caller's identity, which is what the consent trigger judges.
---------------------------------------------------------------------------------------------
SELECT pg_temp.nojwt();
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES
 (:'ta',:'u21','member','pending'), (:'ta',:'u22','member','revoked'), (:'ta',:'u23','member','active'),
 (:'ta',:'u25','member','archived');
SELECT pg_temp.act(:'u3');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES (:'ta',:'u20','member','suspended');
UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=:'ta' AND user_id IN (:'u21',:'u22',:'u25');
UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=:'ta' AND user_id=:'u23';
-- Repointing a suspended seat onto another person: an admin is refused outright (rule 1b); even the
-- owner, who may change a suspended seat, only produces an inert pending seat (rule 2).
SELECT pg_temp.run(:'u3',format('UPDATE public.tenant_members SET user_id=%L WHERE tenant_id=%L AND user_id=%L',:'u24',:'ta',:'u23'),'postgres') AS rp3 \gset
SELECT pg_temp.check(:'rp3'='only the workspace owner can change a suspended teammate''s role or seat; nothing was changed'
 AND pg_temp.status(:'ta',:'u23')='suspended', 'consent/1b: an admin cannot repoint a suspended seat onto another person');
SELECT pg_temp.run(:'u1',format('UPDATE public.tenant_members SET user_id=%L WHERE tenant_id=%L AND user_id=%L',:'u24',:'ta',:'u23'),'postgres') AS rp1 \gset
SELECT pg_temp.act(:'u3');
SELECT pg_temp.try('reinstate',:'u1',:'u20',:'ta') AS lau20, pg_temp.try('reinstate',:'u1',:'u21',:'ta') AS lau21 \gset
SELECT pg_temp.check(pg_temp.status(:'ta',:'u20')='pending', 'consent: a foreign INSERT of a suspended seat lands pending');
SELECT pg_temp.check(pg_temp.status(:'ta',:'u21')='pending' AND pg_temp.status(:'ta',:'u22')='pending'
 AND pg_temp.status(:'ta',:'u25')='pending', 'consent: pending, revoked and archived -> suspended by a foreign caller land pending');
SELECT pg_temp.check(:'rp1'='ok' AND pg_temp.status(:'ta',:'u24')='pending' AND pg_temp.status(:'ta',:'u23')='none',
 'consent: the owner repointing a suspended seat onto another person lands pending');
SELECT pg_temp.check(:'lau20'='only a suspended teammate can be reinstated; nothing was changed' AND :'lau21'=:'lau20',
 'consent: a neutralised seat cannot be reinstated');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id IN (:'u20',:'u21',:'u22',:'u24',:'u25') AND status='active'),
 'consent: none of the attempts produced an active seat');
\echo 'PASS: consent: a foreign INSERT and pending/revoked/archived -> suspended land pending; a user_id repoint of a suspended seat is refused for an admin and lands pending for the owner; none can be reinstated or become active'

---------------------------------------------------------------------------------------------
-- 6b. S1: the policies that joined tenant_members without a status now require an active seat.
--     u29 is a suspended admin, u28 a suspended (promoted) seat, u21 pending; u2 member and u3 admin
--     are active. Run as the browser role, so RLS is what decides.
---------------------------------------------------------------------------------------------
SELECT pg_temp.nojwt();
INSERT INTO public.paige_invoices(tenant_id,label) VALUES (:'ta','invoice-a'),(:'tb','invoice-b');
INSERT INTO public.tenant_agreement_versions(tenant_id,label) VALUES (:'ta','version-a');
UPDATE public.profiles SET active_tenant_id=:'ta' WHERE user_id IN (:'u21',:'u28',:'u29');
CREATE FUNCTION pg_temp.rls_count(actor text, q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN PERFORM pg_temp.act(actor); SET ROLE authenticated; EXECUTE q INTO n; RESET ROLE; RETURN n; END $$;
SELECT pg_temp.check(pg_temp.rls_count(:'u29','SELECT count(*) FROM public.paige_invoices')=0
 AND pg_temp.rls_count(:'u28','SELECT count(*) FROM public.paige_invoices')=0
 AND pg_temp.rls_count(:'u21','SELECT count(*) FROM public.paige_invoices')=0,
 'S1: suspended and pending seats read no invoices');
SELECT pg_temp.check(pg_temp.rls_count(:'u2','SELECT count(*) FROM public.paige_invoices')=1
 AND pg_temp.rls_count(:'u2','SELECT count(*) FROM public.paige_invoices WHERE tenant_id='''||:'tb'||'''')=0,
 'S1: an active member reads their own workspace''s invoice, not another''s');
SELECT pg_temp.run(:'u29',format('INSERT INTO public.paige_invoices(tenant_id,label) VALUES (%L,''forged'')',:'ta')) AS i29,
 pg_temp.run(:'u2',format('INSERT INTO public.paige_invoices(tenant_id,label) VALUES (%L,''by-u2'')',:'ta')) AS i2 \gset
SELECT pg_temp.check(:'i29' LIKE 'new row violates row-level security policy%' AND :'i2'='ok', 'S1: a suspended admin cannot insert an invoice; an active member can');
SELECT pg_temp.run(:'u29','UPDATE public.paige_invoices SET label=''changed-by-29''') AS u29up,
 pg_temp.run(:'u2','UPDATE public.paige_invoices SET label=''changed-by-2'' WHERE label=''invoice-a''') AS u2up \gset
SELECT pg_temp.check(:'u29up'='ok' AND NOT EXISTS(SELECT 1 FROM public.paige_invoices WHERE label='changed-by-29')
 AND :'u2up'='ok' AND EXISTS(SELECT 1 FROM public.paige_invoices WHERE label='changed-by-2'),
 'S1: a suspended admin''s invoice update reaches no row; an active member''s does');
SELECT pg_temp.check(pg_temp.rls_count(:'u29','SELECT count(*) FROM public.tenant_agreement_versions')=0
 AND pg_temp.rls_count(:'u2','SELECT count(*) FROM public.tenant_agreement_versions')=1,
 'S1: a suspended admin reads no agreement version; an active member reads theirs');
SELECT pg_temp.run(:'u29',format('INSERT INTO public.tenant_agreement_versions(tenant_id,label) VALUES (%L,''forged'')',:'ta')) AS v29,
 pg_temp.run(:'u29','DELETE FROM public.tenant_agreement_versions') AS d29,
 pg_temp.run(:'u3',format('INSERT INTO public.tenant_agreement_versions(tenant_id,label) VALUES (%L,''by-u3'')',:'ta')) AS v3 \gset
SELECT pg_temp.check(:'v29' LIKE 'new row violates row-level security policy%' AND :'d29'='ok'
 AND EXISTS(SELECT 1 FROM public.tenant_agreement_versions WHERE label='version-a')
 AND :'v3'='ok', 'S1: a suspended admin cannot write or delete agreement versions; an active admin can write');
\echo 'PASS: S1 invoices and agreement versions: suspended and pending seats read and write nothing, active seats keep their access, and another workspace stays invisible'

---------------------------------------------------------------------------------------------
-- 6c. Reinstatement, after every attack above, is still the one door, and it lands.
---------------------------------------------------------------------------------------------
SELECT pg_temp.run(:'u1',format('SELECT public.reinstate_solo_team_member(%L,%L)',:'u28',:'ta')) AS r28 \gset
SELECT pg_temp.check(:'r28'='ok' AND pg_temp.status(:'ta',:'u28')='active'
 AND NOT EXISTS(SELECT 1 FROM public.tenant_member_reinstatement_marks), 'reinstate: the owner reinstates u28; the mark is gone afterwards');
SELECT pg_temp.check(pg_temp.rls_count(:'u28','SELECT count(*) FROM public.paige_invoices')>=1, 'reinstate: the reinstated seat reads invoices again');
\echo 'PASS: after every attack, reinstate_solo_team_member still lifts the suspension and leaves no mark behind'


---------------------------------------------------------------------------------------------
-- 7. Team conversations off: u6 (a member, in leads and a DM) is switched off by admin u3.
---------------------------------------------------------------------------------------------
SELECT pg_temp.audits('team_hub_access_changed') AS acc0 \gset
SELECT pg_temp.act(:'u3'); SET ROLE authenticated;
SELECT public.set_solo_team_member_team_hub_access(:'u6',:'ta',false) AS off6 \gset
SELECT pg_temp.act(:'u6');
SELECT public.current_user_tenant_id() AS r6 \gset
SELECT pg_temp.doors(:'ta',:'general',:'u1') AS d6 \gset
SELECT coalesce(public.team_hub_list_messages(:'ta',:'leads')->>'code','ok') AS leads6 \gset
SELECT coalesce(public.team_hub_add_members(:'ta',:'leads',ARRAY[:'u2']::uuid[])->>'code','ok') AS add6 \gset
RESET ROLE;
SELECT pg_temp.check((:'off6')::jsonb->>'team_hub_access'='false' AND (:'off6')::jsonb->>'changed'='true'
 AND NOT (SELECT team_hub_access FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u6'), 'switch: off is stored');
SELECT pg_temp.check(pg_temp.audits('team_hub_access_changed')=:'acc0'::bigint+1, 'switch: audited team_hub_access_changed');
SELECT pg_temp.check(:'r6'=:'ta', 'switch: the person keeps member access to the workspace');
SELECT pg_temp.check((:'d6')::text[]=array_fill('conversations_off'::text,ARRAY[12]) AND :'leads6'='conversations_off'
 AND :'add6'='conversations_off', 'switch: every Team Hub door refuses conversations_off');
SELECT pg_temp.check(pg_temp.channels_of(:'ta',:'u6')='dm,leads', 'switch: memberships are kept while off');
-- Nobody can bring them into a conversation; they can still be given work.
DELETE FROM public.team_hub_channel_members WHERE channel_id=:'dm16' AND user_id=:'u6';
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT coalesce(public.team_hub_add_members(:'ta',:'ops',ARRAY[:'u6']::uuid[])->>'code','ok') AS addops \gset
SELECT coalesce(public.team_hub_create_channel(:'ta','side','private',ARRAY[:'u6']::uuid[],gen_random_uuid())->>'code','ok') AS mkside \gset
SELECT coalesce(public.team_hub_post_message(:'ta',:'general','hello',gen_random_uuid(),NULL,ARRAY[:'u6']::uuid[])->>'code','ok') AS ment6 \gset
SELECT coalesce(public.team_hub_post_message(:'ta',:'dm16','still there?',gen_random_uuid())->>'code','ok') AS dmpost \gset
SELECT coalesce(public.team_hub_request_task(:'ta',:'general','Spot job',:'u6',NULL,gen_random_uuid())->>'ok','false') AS task6 \gset
SELECT coalesce(public.team_hub_list_conversations(:'ta')->'people','[]'::jsonb) AS people \gset
SELECT pg_temp.act(:'u2');
SELECT coalesce(public.team_hub_open_dm(:'ta',:'u6')->>'code','ok') AS dm26 \gset
RESET ROLE;
SELECT pg_temp.check(:'addops'='invalid' AND :'mkside'='invalid' AND :'dm26'='invalid' AND :'ment6'='invalid',
 'switch: a person with conversations off cannot be added to a channel, a new private channel, a DM or mentioned');
SELECT pg_temp.check(:'dmpost'='recipient_conversations_off'
 AND NOT EXISTS(SELECT 1 FROM public.team_hub_messages WHERE body='still there?')
 AND NOT pg_temp.in_channel(:'dm16',:'u6'),
 'switch: a DM to someone with conversations off is refused recipient_conversations_off, stores nothing and does not bring them back in');
SELECT pg_temp.check(:'task6'='true' AND EXISTS(SELECT 1 FROM public.plan_items WHERE assigned_to_user_id=:'u6' AND title='Spot job'),
 'switch: work can still be assigned to them');
SELECT pg_temp.check((SELECT bool_and(CASE WHEN p->>'user_id'=:'u6' THEN p->>'team_conversations'='false' ELSE p->>'team_conversations'='true' END)
  AND bool_or(p->>'user_id'=:'u6') FROM jsonb_array_elements((:'people')::jsonb) p),
 'switch: the roster still lists them, marked team_conversations false');
-- Back on: they rejoin the open team channels (not the archived one), keep leads, and the doors open.
INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by) VALUES (:'dm16',:'ta',:'u6',:'u1');
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT public.set_solo_team_member_team_hub_access(:'u6',:'ta',true) AS on6 \gset
SELECT public.set_solo_team_member_team_hub_access(:'u6',:'ta',true) AS on6b \gset
SELECT coalesce(public.team_hub_post_message(:'ta',:'dm16','welcome back',gen_random_uuid())->>'ok','false') AS dmback \gset
SELECT pg_temp.act(:'u6');
SELECT coalesce(public.team_hub_list_conversations(:'ta')->>'ok','false') AS conv6 \gset
RESET ROLE;
SELECT pg_temp.check((:'on6')::jsonb->>'changed'='true' AND ((:'on6')::jsonb->>'joined_channels')::int=2
 AND pg_temp.channels_of(:'ta',:'u6')='dm,general,launch,leads', 'switch: back on rejoins the two open team channels and keeps leads');
SELECT pg_temp.check((:'on6b')::jsonb->>'changed'='false' AND ((:'on6b')::jsonb->>'joined_channels')::int=0
 AND pg_temp.audits('team_hub_access_changed')=:'acc0'::bigint+2, 'switch: on again is a no-op and is not audited');
SELECT pg_temp.check(:'conv6'='true' AND :'dmback'='true', 'switch: the doors open again, and a DM to them posts again');
SELECT pg_temp.check((SELECT added_by FROM public.team_hub_channel_members WHERE channel_id=:'launch' AND user_id=:'u6')=:'u1'
 AND (SELECT last_read_at FROM public.team_hub_channel_members WHERE channel_id=:'launch' AND user_id=:'u6') IS NOT NULL,
 'switch: the rejoin rows are added by the switcher with history read');
\echo 'PASS: Team conversations off keeps member access and work, is refused conversations_off by every door, cannot be added, DMed or mentioned, a DM to them is refused recipient_conversations_off rather than stored as delivered, and switching back on rejoins the open team channels'

---------------------------------------------------------------------------------------------
-- 8. Arrival: joining the team channels when a seat first becomes active.
---------------------------------------------------------------------------------------------
INSERT INTO public.tenant_invite_tokens(tenant_id,token,kind,email,default_role)
 VALUES (:'ta','team-token-14','team','person14@example.test','member');
SELECT pg_temp.act(:'u14'); SET ROLE authenticated;
SELECT public.accept_solo_team_invite('team-token-14') AS acc14 \gset
RESET ROLE;
SELECT pg_temp.nojwt();
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES (:'ta',:'u15','member','active');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,team_hub_access) VALUES (:'ta',:'u16','member','active',false);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES (:'ta',:'u17','member','pending');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,team_hub_access) VALUES (:'ta',:'u18','member','pending',false);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES (:'tc',:'u13','member','active');
SELECT pg_temp.act(:'u17');
UPDATE public.tenant_members SET status='active' WHERE tenant_id=:'ta' AND user_id=:'u17';
SELECT pg_temp.act(:'u18');
UPDATE public.tenant_members SET status='active' WHERE tenant_id=:'ta' AND user_id=:'u18';
SELECT pg_temp.act(:'u3');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES (:'ta',:'u19','member','active');
-- An operator archive and restore of a seat that had left a team channel brings back no channel.
SELECT pg_temp.nojwt();
UPDATE public.tenant_members SET status='active' WHERE tenant_id=:'ta' AND user_id=:'u25';
DELETE FROM public.team_hub_channel_members WHERE user_id=:'u25' AND channel_id=:'launch';
UPDATE public.tenant_members SET status='archived' WHERE tenant_id=:'ta' AND user_id=:'u25';
UPDATE public.tenant_members SET status='active' WHERE tenant_id=:'ta' AND user_id=:'u25';
SELECT pg_temp.check(:'acc14'=:'ta' AND pg_temp.channels_of(:'ta',:'u14')='general,launch',
 'arrival: accepting an invitation joins the two open team channels, not the archived one or a private one');
SELECT pg_temp.check((SELECT bool_and(added_by=:'u14' AND last_read_at IS NOT NULL AND tenant_id=:'ta')
 FROM public.team_hub_channel_members WHERE user_id=:'u14'), 'arrival: the rows are team_hub_join_channel''s (added by the person, history read)');
SELECT pg_temp.check(pg_temp.channels_of(:'ta',:'u15')='general,launch', 'arrival: a direct active insert joins too');
SELECT pg_temp.check(pg_temp.channels_of(:'ta',:'u16')='' AND pg_temp.channels_of(:'ta',:'u18')='', 'arrival: with Team conversations off, nothing is joined');
SELECT pg_temp.check(pg_temp.status(:'ta',:'u17')='active' AND pg_temp.channels_of(:'ta',:'u17')='general,launch', 'arrival: pending -> active by the person joins');
SELECT pg_temp.check(pg_temp.channels_of(:'tc',:'u13')='', 'arrival: a non-SOLO workspace joins nothing');
SELECT pg_temp.check(pg_temp.status(:'ta',:'u19')='pending' AND pg_temp.channels_of(:'ta',:'u19')='', 'arrival: a consent-neutralised activation joins nothing');
SELECT pg_temp.check(pg_temp.channels_of(:'ta',:'u25')='general', 'arrival: an archive restore re-joins nothing');
\echo 'PASS: arrival joins the open team channels through the accept path and a direct insert; not with conversations off, not in a non-SOLO workspace, not when neutralised, not on reinstatement or restore'

---------------------------------------------------------------------------------------------
-- 8b. The invitation carries Team conversations: created through Settings → Team's function with
--     no JWT (as the edge function's service client calls it), resent, and accepted through both
--     acceptance paths. A switched-off contractor never joins a team channel.
---------------------------------------------------------------------------------------------
SELECT pg_temp.nojwt(); SET ROLE service_role;
SELECT public.create_solo_team_invite(_actor=>:'u1',_expected_tenant_id=>:'ta',_email=>'person30@example.test',
 _permission=>'member',_team_hub_access=>false) AS inv30 \gset
-- Exactly the six named arguments the edge function sends today.
SELECT public.create_solo_team_invite(_actor=>:'u1',_expected_tenant_id=>:'ta',_email=>'person32@example.test',
 _permission=>'member',_job_title=>NULL,_responsibilities=>NULL) AS inv32 \gset
SELECT public.create_solo_team_invite(_actor=>:'u1',_expected_tenant_id=>:'ta',_email=>'person31@example.test',
 _permission=>'member',_team_hub_access=>false) AS inv31 \gset
SELECT public.resend_solo_team_invite(:'u1',:'ta',((:'inv30')::jsonb->>'id')::uuid) AS inv30b \gset
RESET ROLE;
SELECT pg_temp.run(NULL,format('SELECT public.create_solo_team_invite(%L,%L,''person33@example.test'',''member'',NULL,NULL,NULL)',:'u1',:'ta'),'service_role') AS invnull \gset
SELECT pg_temp.check((:'inv30')::jsonb->>'team_hub_access'='false' AND (:'inv32')::jsonb->>'team_hub_access'='true'
 AND (:'inv30b')::jsonb->>'team_hub_access'='false'
 AND (SELECT team_hub_access FROM public.tenant_invite_tokens WHERE id=((:'inv30b')::jsonb->>'id')::uuid) = false
 AND (SELECT revoked_at IS NOT NULL FROM public.tenant_invite_tokens WHERE id=((:'inv30')::jsonb->>'id')::uuid),
 'invite: created off, created on by default (the edge''s six arguments), and a resend carries off');
SELECT pg_temp.check(:'invnull'='say whether team conversations are on or off for this invitation', 'invite: a NULL choice is refused');
SELECT pg_temp.check(EXISTS(SELECT 1 FROM public.audit_logs WHERE action='team_invite_created'
 AND entity_id=((:'inv30')::jsonb->>'id')::uuid AND data->>'team_hub_access'='false'), 'invite: the creation audit records the choice');
-- The supported path, off and on.
SELECT pg_temp.run(:'u30',format('SELECT public.accept_solo_team_invite(%L)',(:'inv30b')::jsonb->>'token')) AS acc30,
 pg_temp.run(:'u32',format('SELECT public.accept_solo_team_invite(%L)',(:'inv32')::jsonb->>'token')) AS acc32 \gset
SELECT pg_temp.check(:'acc30'='ok' AND pg_temp.status(:'ta',:'u30')='active'
 AND NOT (SELECT team_hub_access FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u30')
 AND pg_temp.channels_of(:'ta',:'u30')='', 'invite: accepted with Team conversations off, the seat is off and joins no channel');
SELECT pg_temp.check(:'acc32'='ok' AND (SELECT team_hub_access FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u32')
 AND pg_temp.channels_of(:'ta',:'u32')='general,launch', 'invite: accepted with the default, the seat is on and joins the open team channels');
SELECT pg_temp.check(EXISTS(SELECT 1 FROM public.audit_logs WHERE action='team_invite_accepted' AND user_id=:'u30'
 AND data->>'team_hub_access'='false'), 'invite: the acceptance audit records the choice');
SELECT pg_temp.act(:'u30'); SET ROLE authenticated;
SELECT coalesce(public.team_hub_list_conversations(:'ta')->>'code','ok') AS door30 \gset
RESET ROLE;
SELECT pg_temp.check(:'door30'='conversations_off', 'invite: the switched-off arrival is refused conversations_off');
-- The legacy door: accept_tenant_invite still accepts a Solo Team token directly.
SELECT pg_temp.run(:'u31',format('SELECT public.accept_tenant_invite(%L)',(:'inv31')::jsonb->>'token')) AS acc31 \gset
SELECT pg_temp.check(:'acc31'='ok' AND pg_temp.status(:'ta',:'u31')='active'
 AND NOT (SELECT team_hub_access FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u31')
 AND pg_temp.channels_of(:'ta',:'u31')='', 'invite: the legacy accept_tenant_invite door carries off too, and joins nothing');
-- On a conflict an invitation can switch it off, never on: u21's existing pending seat.
SELECT pg_temp.nojwt();
INSERT INTO public.tenant_invite_tokens(tenant_id,token,kind,email,default_role,max_uses,team_hub_access)
 VALUES (:'ta','team-token-21','team','person21@example.test','member',1,false);
-- Another kind never carries the choice, even if the column says off.
INSERT INTO public.tenant_invite_tokens(tenant_id,token,kind,default_role,team_hub_access)
 VALUES (:'ta','staff-token-33','staff','member',false);
SELECT pg_temp.run(:'u21','SELECT public.accept_tenant_invite(''team-token-21'')') AS acc21,
 pg_temp.run(:'u33','SELECT public.accept_tenant_invite(''staff-token-33'')') AS acc33 \gset
SELECT pg_temp.check(:'acc21'='ok' AND pg_temp.status(:'ta',:'u21')='active'
 AND NOT (SELECT team_hub_access FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u21')
 AND pg_temp.channels_of(:'ta',:'u21')='', 'invite: accepting an off invitation onto an existing seat switches it off before arrival joins anything');
SELECT pg_temp.check(:'acc33'='ok' AND (SELECT team_hub_access FROM public.tenant_members WHERE tenant_id=:'ta' AND user_id=:'u33')
 AND pg_temp.channels_of(:'ta',:'u33')='general,launch', 'invite: a non-team invitation arrives on, as before');
\echo 'PASS: invitations carry Team conversations: off by choice, on by default for the edge''s six arguments, carried by resend, refused when NULL, copied onto the seat by both acceptance paths before arrival joins anything, never turned on by a conflict, ignored for other kinds'


---------------------------------------------------------------------------------------------
-- 9. The departure review: exactly the open items, this workspace only, capped with true totals.
---------------------------------------------------------------------------------------------
INSERT INTO public.plan_items(id,tenant_id,item_type,assigned_to_user_id,title,status,due_at,contact_id) VALUES
 ('30000000-0000-4000-8000-000000000001',:'ta','task',:'u2','Open later','open',now()+interval '9 days','32000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000002',:'ta','task',:'u2','In progress soon','in_progress',now()+interval '1 day','32000000-0000-4000-8000-000000000006'),
 ('30000000-0000-4000-8000-000000000003',:'ta','milestone',:'u2','Blocked undated','blocked',NULL,NULL),
 ('30000000-0000-4000-8000-000000000004',:'ta','task',:'u2','Done','done',now(),NULL),
 ('30000000-0000-4000-8000-000000000005',:'ta','task',:'u2','Cancelled','cancelled',now(),NULL),
 ('30000000-0000-4000-8000-000000000006',:'tb','task',:'u2','Other workspace','open',now(),NULL),
 ('30000000-0000-4000-8000-000000000007',:'ta','task',:'u8','Someone else','open',now(),NULL);
INSERT INTO public.plan_items(tenant_id,item_type,assigned_to_user_id,title,status,due_at)
 SELECT :'ta','task',:'u8','Bulk '||n,'open',now()+n*interval '1 hour' FROM generate_series(1,59) n;
INSERT INTO public.tasks(id,user_id,title,status,due_date,tenant_id,deal_id) VALUES
 ('31000000-0000-4000-8000-000000000001',:'u2','Call back','pending',now()+interval '2 days',:'ta','33000000-0000-4000-8000-000000000001'),
 ('31000000-0000-4000-8000-000000000002',:'u2','Send recap','in_progress',NULL,:'ta','33000000-0000-4000-8000-000000000004'),
 ('31000000-0000-4000-8000-000000000003',:'u2','Finished','completed',now(),:'ta',NULL),
 ('31000000-0000-4000-8000-000000000004',:'u2','Dropped','cancelled',now(),:'ta',NULL),
 ('31000000-0000-4000-8000-000000000005',:'u2','Elsewhere','pending',now(),:'tb',NULL);
INSERT INTO public.clients(id,first_name,last_name,email,entity_name,status,assigned_coach_user_id,lead_owner_user_id,tenant_id,merged_into_contact_id,updated_at) VALUES
 ('32000000-0000-4000-8000-000000000001','Rowan','Vale','rowan@example.test',NULL,'active',:'u2',NULL,:'ta',NULL,now()-interval '1 day'),
 ('32000000-0000-4000-8000-000000000002',NULL,NULL,'onlyemail@example.test','Harbor Studio','pending',NULL,:'u2',:'ta',NULL,now()-interval '2 days'),
 ('32000000-0000-4000-8000-000000000003',NULL,NULL,'nameless@example.test',NULL,'inactive',:'u2',:'u2',:'ta',NULL,now()-interval '3 days'),
 ('32000000-0000-4000-8000-000000000004','Archived','Client',NULL,NULL,'archived',:'u2',NULL,:'ta',NULL,now()),
 ('32000000-0000-4000-8000-000000000005','Merged','Client',NULL,NULL,'active',:'u2',NULL,:'ta','32000000-0000-4000-8000-000000000001',now()),
 ('32000000-0000-4000-8000-000000000006','Other','Tenant',NULL,NULL,'active',:'u2',NULL,:'tb',NULL,now());
-- Deal 4 (workspace B) is named by a workspace-A task's deal_id on purpose: a foreign deal (and so a
-- foreign client) must never be read through it.
INSERT INTO public.deals(id,title,owner_user_id,status,expected_close_date,tenant_id,contact_client_id,value_cents,currency,version) VALUES
 ('33000000-0000-4000-8000-000000000001','Retainer renewal',:'u2','open',current_date+30,:'ta','32000000-0000-4000-8000-000000000002',480000,'USD',7),
 ('33000000-0000-4000-8000-000000000002','Won deal',:'u2','won',NULL,:'ta',NULL,100,'USD',1),
 ('33000000-0000-4000-8000-000000000003','Lost deal',:'u2','lost',NULL,:'ta',NULL,100,'USD',1),
 ('33000000-0000-4000-8000-000000000004','Other deal',:'u2','open',NULL,:'tb','32000000-0000-4000-8000-000000000006',999,'EUR',1);
INSERT INTO public.paige_pending_approvals(id,status,assigned_to_user_id,tenant_id,category,type,summary,priority,created_at) VALUES
 ('34000000-0000-4000-8000-000000000001','pending',:'u2',:'ta','email','cs_draft','Follow-up email to Brightline',3,now()-interval '3 hours'),
 ('34000000-0000-4000-8000-000000000002','escalated',:'u2',:'ta',NULL,'campaign_send',repeat('Long summary ',20),1,now()-interval '1 hour'),
 ('34000000-0000-4000-8000-000000000003','changes_requested',:'u2',:'ta','  ','other',NULL,NULL,now()-interval '2 hours'),
 ('34000000-0000-4000-8000-000000000004','approved',:'u2',:'ta','email','cs_draft','Decided',1,now()),
 ('34000000-0000-4000-8000-000000000005','sent',:'u2',:'ta','email','cs_draft','Sent',1,now()),
 ('34000000-0000-4000-8000-000000000006','pending',:'u2',:'tb','email','cs_draft','Other workspace',1,now()),
 ('34000000-0000-4000-8000-000000000007','pending',:'u8',:'ta','email','cs_draft','Someone else',1,now());
INSERT INTO public.channel_connectors(id,tenant_id,status,active,mailbox_owner_user_id,provider,mailbox_class,display_name,from_address) VALUES
 ('35000000-0000-4000-8000-000000000001',:'ta','active',true,:'u2','gmail','personal','Person 2 at work',' Person2@Mailbox.Example '),
 ('35000000-0000-4000-8000-000000000002',:'ta','disabled',true,:'u2','gmail','personal',NULL,'off@mailbox.example'),
 ('35000000-0000-4000-8000-000000000003',:'ta','pending',true,:'u2','gmail','personal',NULL,'pending@mailbox.example'),
 ('35000000-0000-4000-8000-000000000004',:'ta','active',false,:'u2','gmail','personal',NULL,'inactive@mailbox.example'),
 ('35000000-0000-4000-8000-000000000005',:'tb','active',true,:'u2','gmail','personal',NULL,'other@mailbox.example');
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT public.team_member_holdings(:'u2',:'ta') AS h2 \gset
SELECT public.team_member_holdings(:'u8',:'ta') AS h8 \gset
RESET ROLE;
SELECT pg_temp.check((:'h2')::jsonb->>'ok'='true' AND (:'h2')::jsonb#>>'{member,user_id}'=:'u2'
 AND (:'h2')::jsonb#>>'{member,display_name}'='Person 2' AND (:'h2')::jsonb#>>'{member,role}'='member'
 AND (:'h2')::jsonb#>>'{member,status}'='active' AND (:'h2')::jsonb#>>'{member,team_hub_access}'='true', 'holdings: the member block');
SELECT pg_temp.check((SELECT array_agg(w->>'id') FROM jsonb_array_elements((:'h2')::jsonb#>'{holdings,work}') w)
 = ARRAY['30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003'],
 'holdings: work is the open, in-progress and blocked items, soonest due first, undated last');
SELECT pg_temp.check((SELECT array_agg(coalesce(w->>'client_label','-')) FROM jsonb_array_elements((:'h2')::jsonb#>'{holdings,work}') w)
 = ARRAY['-','Rowan Vale','-']
 AND (SELECT bool_and((w->>'updated_at') IS NOT NULL) FROM jsonb_array_elements((:'h2')::jsonb#>'{holdings,work}') w),
 'holdings: work carries its client''s label (never a client from another workspace) and the version plan_update_item_versioned needs');
SELECT pg_temp.check((SELECT array_agg(w->>'id') FROM jsonb_array_elements((:'h2')::jsonb#>'{holdings,crm_tasks}') w)
 = ARRAY['31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002'], 'holdings: CRM tasks pending and in progress only');
SELECT pg_temp.check((SELECT array_agg(coalesce(w->>'client_label','-')||'/'||coalesce(w->>'deal_id','-')) FROM jsonb_array_elements((:'h2')::jsonb#>'{holdings,crm_tasks}') w)
 = ARRAY['Harbor Studio/33000000-0000-4000-8000-000000000001','-/-']
 AND (SELECT bool_and((w->>'updated_at') IS NOT NULL) FROM jsonb_array_elements((:'h2')::jsonb#>'{holdings,crm_tasks}') w),
 'holdings: a CRM task carries its deal''s client; a deal in another workspace is never followed; each carries the version task.assign needs');
SELECT pg_temp.check((SELECT array_agg((w->>'id')||':'||(w->>'relation')||':'||(w->>'label')) FROM jsonb_array_elements((:'h2')::jsonb#>'{holdings,clients}') w)
 = ARRAY['32000000-0000-4000-8000-000000000001:assigned:Rowan Vale','32000000-0000-4000-8000-000000000002:lead_owner:Harbor Studio',
   '32000000-0000-4000-8000-000000000003:assigned:Client not recorded','32000000-0000-4000-8000-000000000003:lead_owner:Client not recorded'],
 'holdings: client relationships, archived and merged excluded, labelled by name or business, never email');
SELECT pg_temp.check((:'h2') NOT LIKE '%@example.test%', 'holdings: no client email anywhere in the review');
SELECT pg_temp.check((SELECT bool_and((w->>'updated_at') IS NOT NULL) FROM jsonb_array_elements((:'h2')::jsonb#>'{holdings,clients}') w),
 'holdings: each client relationship carries the version contact.assign_coach / assign_owner needs');
SELECT pg_temp.check((SELECT array_agg(w->>'id') FROM jsonb_array_elements((:'h2')::jsonb#>'{holdings,deals}') w)
 = ARRAY['33000000-0000-4000-8000-000000000001']
 AND (:'h2')::jsonb#>'{holdings,deals,0}' @> '{"value_cents":480000,"currency":"USD","version":7,"client_label":"Harbor Studio","client_id":"32000000-0000-4000-8000-000000000002"}'::jsonb,
 'holdings: open deals only, with value, currency, client and the version deal.assign_owner needs');
SELECT pg_temp.check((SELECT array_agg((w->>'id')||'|'||coalesce(w->>'kind','-')||'|'||coalesce(left(w->>'summary',13),'-')||'|'||(w->>'status'))
   FROM jsonb_array_elements((:'h2')::jsonb#>'{holdings,approvals}') w)
 = ARRAY['34000000-0000-4000-8000-000000000002|campaign_send|Long summary |escalated',
         '34000000-0000-4000-8000-000000000001|email|Follow-up ema|pending',
         '34000000-0000-4000-8000-000000000003|other|-|changes_requested']
 AND length((:'h2')::jsonb#>>'{holdings,approvals,0,summary}')=140
 AND (SELECT bool_and((w->>'created_at') IS NOT NULL) FROM jsonb_array_elements((:'h2')::jsonb#>'{holdings,approvals}') w),
 'holdings: approvals awaiting a decision, this workspace only, as rows: most urgent first, kind (category, else type), summary trimmed to 140, when it arrived');
SELECT pg_temp.check(jsonb_array_length((:'h2')::jsonb#>'{holdings,mailboxes}')=1
 AND (:'h2')::jsonb#>'{holdings,mailboxes,0}' = '{"id":"35000000-0000-4000-8000-000000000001","channel":"email","provider":"gmail","mailbox_class":"personal","label":"Person 2 at work","address":"person2@mailbox.example"}'::jsonb,
 'holdings: connected mailboxes as rows, this workspace only, active only: provider, label and the address Settings already shows');
SELECT pg_temp.check((:'h2')::jsonb->'counts'='{"work":3,"crm_tasks":2,"clients":4,"deals":1,"approvals":3,"mailboxes":1}'::jsonb, 'holdings: counts');
SELECT pg_temp.check(jsonb_array_length((:'h8')::jsonb#>'{holdings,work}')=50 AND (:'h8')::jsonb#>>'{counts,work}'='60'
 AND (:'h8')::jsonb#>>'{holdings,work,0,id}'='30000000-0000-4000-8000-000000000007', 'holdings: capped at 50, the true total in counts, most urgent first');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE action ILIKE '%holding%'), 'holdings: a read writes nothing');
\echo 'PASS: the departure review returns exactly the open work, CRM tasks, client relationships, deals, approvals and mailboxes in this workspace as item rows (each with the version its existing hand-over writer needs; deal value and client; approval summary; mailbox address), capped at 50 with true totals, never a client email'

RESET ROLE;
\c postgres
DROP DATABASE exp08_team_lifecycle_proof;
\echo 'PASS: EXP08 team lifecycle proof complete; disposable database dropped'
