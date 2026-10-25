-- EXP08 Team Hub increment 2: starting a task in Operations from a conversation, the link table,
-- the work list, and isolation. Contract: docs/delivery/exp08-team-hub-increment2-work-contract.md.
-- Disposable PostgreSQL only. Never target the linked project. Both Team Hub migrations commit
-- their own BEGIN/COMMIT, so this proof runs in a database it creates and drops.
-- Each RPC below runs as its own autocommit statement, the way a browser request does.
--
-- WHAT IS REAL AND WHAT IS A DOUBLE. public.plan_assign_task_scoped is the REAL Operations wrapper,
-- loaded unchanged from 20271020000110_operations_scoped_task_creation.sql: its signature, its
-- raise codes (PLAN_SCOPE_CHANGED, PLAN_FORBIDDEN, PLAN_ASSIGNMENT_FORBIDDEN,
-- PLAN_TASK_INPUT_INVALID, PLAN_CREATE_UNCONFIRMED ...) and its assignee rule (another person only
-- for an owner or admin) are the shipped ones. Everything it stands on is a FIXTURE DOUBLE, not
-- the production object: plan_items and plans (only the columns the writers touch, no RLS), the
-- canonical core public.plan_assign_task (abridged from 20260711340000_paige_planning.sql: the same
-- signature and the same raises for tenant, member, active-assignee and teammate-needs-staff, but
-- no action-bus filing and no audit row), is_tenant_admin, is_tenant_member (active seat only; the
-- production predicate also admits operators in company workspaces, which Team Hub refuses before
-- Operations is reached) and has_any_role (a fixture table of global roles). A fixture setting,
-- fixture.ops_raise, makes the core double raise a chosen Operations error, so every refusal
-- mapping is driven. The real Operations code is not otherwise in this database.
\set ON_ERROR_STOP on
\set QUIET on
DROP DATABASE IF EXISTS exp08_team_hub_work_proof;
CREATE DATABASE exp08_team_hub_work_proof;
\c exp08_team_hub_work_proof
SET client_min_messages=warning;
\o /dev/null

-- Minimal fixture: what both Team Hub migrations, the Operations wrapper and the real workspace
-- resolver read.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid $$;
CREATE TYPE public.tenant_role AS ENUM ('owner','admin','coach','member');
CREATE TABLE public.tenants(id uuid PRIMARY KEY, name text NOT NULL,
 account_type text NOT NULL DEFAULT 'standalone', parent_tenant_id uuid REFERENCES public.tenants(id));
CREATE TABLE public.tenant_members(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, role public.tenant_role NOT NULL DEFAULT 'member',
 status text NOT NULL DEFAULT 'active', is_owner boolean NOT NULL DEFAULT false,
 job_title text, joined_at timestamptz DEFAULT now(), UNIQUE (tenant_id, user_id));
CREATE TABLE public.profiles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE,
 full_name text, active_tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL);
CREATE TABLE public.fixture_agency_managers(tenant_id uuid, user_id uuid);
CREATE TABLE public.fixture_platform_admins(user_id uuid);
CREATE TABLE public.fixture_global_roles(user_id uuid, role text);
CREATE FUNCTION public.agency_can_manage_child(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM public.fixture_agency_managers WHERE tenant_id=$1 AND user_id=$2) $$;
CREATE FUNCTION public.agency_team_role(uuid, uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM public.fixture_platform_admins WHERE user_id=$1) $$;
-- Real body, verbatim from 20260714144656_tier_rail_phaseB_agency_standing.sql.
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

-- DOUBLES of what the Operations wrapper stands on. See the header.
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
-- The canonical core, abridged (see the header). fixture.ops_raise: a message to raise, or
-- 'noinsert' to report success without writing, which the real wrapper must then refuse.
CREATE FUNCTION public.plan_assign_task(
  p_title text, p_assigned_to_user_id uuid, p_plan_id uuid DEFAULT NULL, p_milestone_id uuid DEFAULT NULL,
  p_due_at timestamptz DEFAULT NULL, p_priority text DEFAULT 'normal', p_summary text DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL, p_campaign_ref jsonb DEFAULT NULL, p_file_to_bus boolean DEFAULT true, p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _caller uuid := auth.uid(); _tenant uuid; _staff boolean := false; _id uuid;
 _knob text := nullif(current_setting('fixture.ops_raise', true), '');
BEGIN
  _tenant := public.current_user_tenant_id();
  IF p_tenant_id IS NOT NULL AND p_tenant_id <> _tenant THEN RAISE EXCEPTION 'PLAN_FORBIDDEN: tenant mismatch' USING ERRCODE='42501'; END IF;
  IF NOT public.is_tenant_member(_tenant) THEN RAISE EXCEPTION 'PLAN_FORBIDDEN: not a member' USING ERRCODE='42501'; END IF;
  _staff := public.has_any_role(_caller, ARRAY['admin','super_admin','coach']);
  IF _knob IS NOT NULL AND _knob <> 'noinsert' THEN RAISE EXCEPTION '%', _knob USING ERRCODE='42501'; END IF;
  IF p_assigned_to_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.tenant_members WHERE user_id=p_assigned_to_user_id AND tenant_id=_tenant AND status='active') THEN
    RAISE EXCEPTION 'PLAN_ASSIGNEE_NOT_IN_TENANT' USING ERRCODE='42501'; END IF;
  IF NOT _staff AND p_assigned_to_user_id IS DISTINCT FROM _caller THEN
    RAISE EXCEPTION 'PLAN_FORBIDDEN: assigning to a teammate needs admin or coach' USING ERRCODE='42501'; END IF;
  IF _knob = 'noinsert' THEN RETURN jsonb_build_object('ok',true,'item_id',gen_random_uuid(),'item_type','task'); END IF;
  INSERT INTO public.plan_items(tenant_id, plan_id, parent_item_id, item_type, title, summary, due_at, assigned_to_user_id, priority, contact_id, campaign_ref, created_by)
  VALUES (_tenant, p_plan_id, p_milestone_id, 'task', btrim(p_title), p_summary, p_due_at, p_assigned_to_user_id, COALESCE(p_priority,'normal'), p_contact_id, p_campaign_ref, _caller)
  RETURNING id INTO _id;
  RETURN jsonb_build_object('ok',true,'item_id',_id,'item_type','task','assignee',p_assigned_to_user_id,'action_id',NULL);
END $$;
REVOKE ALL ON FUNCTION public.plan_assign_task(text,uuid,uuid,uuid,timestamptz,text,text,uuid,jsonb,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_assign_task(text,uuid,uuid,uuid,timestamptz,text,text,uuid,jsonb,boolean,uuid) TO authenticated, service_role;

-- Workspaces A and B are canonical SOLO. D is an agency; C is its sub-account. Synthetic people.
INSERT INTO public.tenants(id,name,account_type,parent_tenant_id) VALUES
 ('20000000-0000-4000-8000-00000000000a','Workspace A','standalone',NULL),
 ('20000000-0000-4000-8000-00000000000b','Workspace B','standalone',NULL),
 ('20000000-0000-4000-8000-00000000000d','Agency D','agency',NULL),
 ('20000000-0000-4000-8000-00000000000c','Sub-account C','standalone','20000000-0000-4000-8000-00000000000d');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 -- u1 owner, u2 member, u3 admin, u4 member with no profile row, u5 member, u6 suspended.
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000001','owner','active',true,'2026-01-01'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000002','member','active',false,'2026-01-02'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000003','admin','active',false,'2026-01-03'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000004','member','active',false,'2026-01-04'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000005','member','active',false,'2026-01-05'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000006','member','suspended',false,'2026-01-06'),
 ('20000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-000000000007','owner','active',true,'2026-01-07'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000008','member','active',false,'2026-01-08'),
 ('20000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-000000000008','member','active',false,'2026-01-01'),
 ('20000000-0000-4000-8000-00000000000c','10000000-0000-4000-8000-000000000011','owner','active',true,'2026-01-01'),
 ('20000000-0000-4000-8000-00000000000d','10000000-0000-4000-8000-000000000012','owner','active',true,'2026-01-01');
INSERT INTO public.profiles(user_id,full_name,active_tenant_id) VALUES
 ('10000000-0000-4000-8000-000000000001','Test Owner','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000002','Member Test','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000003','Admin Test','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000005','Second Member','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000006','Suspended Test','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000007','Other Workspace','20000000-0000-4000-8000-00000000000b'),
 ('10000000-0000-4000-8000-000000000008','Two Workspaces','20000000-0000-4000-8000-00000000000b'),
 ('10000000-0000-4000-8000-000000000009','Agency Test','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000010','Operator Test','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000011','Child Owner','20000000-0000-4000-8000-00000000000c'),
 ('10000000-0000-4000-8000-000000000012','Agency Owner','20000000-0000-4000-8000-00000000000d');
INSERT INTO public.fixture_agency_managers VALUES ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000009');
INSERT INTO public.fixture_platform_admins VALUES ('10000000-0000-4000-8000-000000000010');
-- The owner holds the global staff role the canonical core checks; the workspace admin u3 does not.
INSERT INTO public.fixture_global_roles VALUES ('10000000-0000-4000-8000-000000000001','admin');
-- The canonical retirement policy, abridged exactly as in the increment 1 proof.
CREATE OR REPLACE FUNCTION public.operator_retirement_disposition(_table text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN _table=ANY(ARRAY['growth_public_visits',
 'tenants','tenant_members','calendars','programs','program_approvals'
 ]) THEN 'delete' WHEN _table=ANY(ARRAY['profiles','paige_audit_log','platform_subscriptions','platform_usage_events','paige_llm_trace','paige_voice_cost_reservations']) THEN 'preserve' ELSE 'blocked' END
$$;
REVOKE ALL ON FUNCTION public.operator_retirement_disposition(text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

-- The REAL Operations wrapper, unchanged.
\ir ../migrations/20271020000110_operations_scoped_task_creation.sql

-- Supabase's default privileges, so the grant assertions below could fail.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
BEGIN;
CREATE TABLE public.fixture_default_probe(x int);
CREATE FUNCTION public.fixture_default_probe_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
DO $$ BEGIN
 IF NOT has_table_privilege('anon','public.fixture_default_probe','SELECT')
   OR NOT has_table_privilege('authenticated','public.fixture_default_probe','INSERT')
   OR NOT has_function_privilege('anon','public.fixture_default_probe_fn()','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: the fixture does not reproduce Supabase default privileges'; END IF;
END $$;
ROLLBACK;

\set ta '20000000-0000-4000-8000-00000000000a'
\set tb '20000000-0000-4000-8000-00000000000b'
\set tc '20000000-0000-4000-8000-00000000000c'
\set td '20000000-0000-4000-8000-00000000000d'
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
\set u12 '10000000-0000-4000-8000-000000000012'

\ir ../migrations/20271113850008_exp08_team_hub_collaboration.sql
\ir ../migrations/20271113860008_exp08_team_hub_team_work.sql

-- Replay: a second apply of increment 2 must be a no-op on every object either increment owns.
CREATE TEMP TABLE replay_before AS
SELECT 'rel:'||c.relname AS k, concat_ws('|', c.relacl::text, c.relrowsecurity::text,
  (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)::text,
  (SELECT string_agg(pg_get_constraintdef(x.oid), ',' ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid),
  (SELECT string_agg(pg_get_indexdef(i.indexrelid), ',' ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid),
  (SELECT string_agg(pg_get_triggerdef(t.oid), ',' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) AS v
FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'team_hub_%' AND c.relkind='r'
UNION ALL
SELECT 'fn:'||p.oid::regprocedure::text, concat_ws('|', p.proacl::text, p.prosecdef::text, p.proconfig::text, md5(p.prosrc))
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE '%team_hub_%' OR p.proname='plan_assign_task_scoped')
UNION ALL
SELECT 'trg:tenant_members:'||t.tgname, pg_get_triggerdef(t.oid)
FROM pg_trigger t WHERE t.tgrelid='public.tenant_members'::regclass AND NOT t.tgisinternal
UNION ALL
SELECT 'policy:'||p.oid::regprocedure::text, concat_ws('|', p.proacl::text, md5(p.prosrc))
FROM pg_proc p WHERE p.oid='public.operator_retirement_disposition(text)'::regprocedure;
\ir ../migrations/20271113860008_exp08_team_hub_team_work.sql
\o
DO $$ BEGIN
 IF (SELECT count(*) FROM replay_before WHERE k LIKE 'rel:%')<>5 OR (SELECT count(*) FROM replay_before WHERE k LIKE 'fn:%')<>23
   OR (SELECT count(*) FROM replay_before WHERE k LIKE 'trg:tenant_members:%')<>1
   OR (SELECT count(*) FROM replay_before WHERE k LIKE 'policy:%')<>1 THEN
  RAISE EXCEPTION 'FAIL: the two increments did not leave five tables, twenty-two Team Hub functions plus the Operations wrapper, and one tenant_members trigger'; END IF;
 IF EXISTS(SELECT k,v FROM replay_before EXCEPT (
  SELECT 'rel:'||c.relname, concat_ws('|', c.relacl::text, c.relrowsecurity::text,
   (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)::text,
   (SELECT string_agg(pg_get_constraintdef(x.oid), ',' ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid),
   (SELECT string_agg(pg_get_indexdef(i.indexrelid), ',' ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid),
   (SELECT string_agg(pg_get_triggerdef(t.oid), ',' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal))
  FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'team_hub_%' AND c.relkind='r'
  UNION ALL
  SELECT 'fn:'||p.oid::regprocedure::text, concat_ws('|', p.proacl::text, p.prosecdef::text, p.proconfig::text, md5(p.prosrc))
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE '%team_hub_%' OR p.proname='plan_assign_task_scoped')
  UNION ALL
  SELECT 'trg:tenant_members:'||t.tgname, pg_get_triggerdef(t.oid)
  FROM pg_trigger t WHERE t.tgrelid='public.tenant_members'::regclass AND NOT t.tgisinternal
  UNION ALL
  SELECT 'policy:'||p.oid::regprocedure::text, concat_ws('|', p.proacl::text, md5(p.prosrc))
  FROM pg_proc p WHERE p.oid='public.operator_retirement_disposition(text)'::regprocedure)) THEN
  RAISE EXCEPTION 'FAIL: replaying increment 2 changed a table, grant, policy, index, trigger, function or the retirement policy'; END IF;
 IF (SELECT prosrc FROM pg_proc WHERE oid='public._team_hub_message_json(public.team_hub_messages)'::regprocedure) NOT LIKE '%''work_ref''%' THEN
  RAISE EXCEPTION 'FAIL: the message shape was not redefined to carry work_ref'; END IF;
END $$;
\echo 'PASS: increment 2 applies over increment 1; a second apply is a no-op on tables, grants, RLS, indexes, triggers and functions'

-- Structural floor: the link table has RLS, no policies and no browser grant; two jsonb DEFINER
-- doors for authenticated only; helpers and the scope trigger are not browser-callable; Operations'
-- wrapper keeps exactly the grants it shipped with.
DO $$ DECLARE f text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='public.team_hub_work_refs'::regclass AND c.relrowsecurity)
   OR EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.team_hub_work_refs'::regclass)
   OR has_table_privilege('authenticated','public.team_hub_work_refs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_table_privilege('anon','public.team_hub_work_refs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
  RAISE EXCEPTION 'FAIL: team_hub_work_refs is policy-open to, or grants a table privilege to, a browser role'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'team_hub_%' AND c.relkind='r'
   AND (NOT c.relrowsecurity OR EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid)
    OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))) THEN
  RAISE EXCEPTION 'FAIL: a Team Hub table lost its floor after increment 2'; END IF;
 FOREACH f IN ARRAY ARRAY['team_hub_request_task(uuid,uuid,text,uuid,timestamptz,uuid,uuid)','team_hub_list_work(uuid,integer)'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=('public.'||f)::regprocedure AND p.prosecdef
     AND p.proconfig=ARRAY['search_path=""'] AND p.prorettype='jsonb'::regtype)
   OR has_function_privilege('anon','public.'||f,'EXECUTE')
   OR NOT has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: % is not a jsonb SECURITY DEFINER door for authenticated only', f; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '\_team\_hub\_%'
   AND (has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE'))) THEN
  RAISE EXCEPTION 'FAIL: an internal Team Hub helper is callable by a browser role'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team\_hub\_%'
   AND p.prosrc ILIKE '%is_tenant_member%') THEN
  RAISE EXCEPTION 'FAIL: Team Hub uses is_tenant_member, which admits operators'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team\_hub\_%'
   AND p.prosrc ~* '(paige_orchestrator|delegate_to_subagent|file_action|advance_action|approval|calendar|booking)') THEN
  RAISE EXCEPTION 'FAIL: a Team Hub function reaches a delegation, approval or calendar path'; END IF;
 IF has_function_privilege('anon','public.plan_assign_task_scoped(uuid,uuid,text,uuid,uuid,uuid,timestamptz,text,text,uuid)','EXECUTE')
   OR NOT has_function_privilege('authenticated','public.plan_assign_task_scoped(uuid,uuid,text,uuid,uuid,uuid,timestamptz,text,text,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: the Operations wrapper''s grants changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
   WHERE t.tgrelid='public.team_hub_work_refs'::regclass AND t.tgname='team_hub_work_ref_scope'
    AND p.proname='_team_hub_work_ref_scope_guard' AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=""']
    AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR UPDATE OF message_id, tenant_id, channel_id ON public.team_hub_work_refs FOR EACH ROW%') THEN
  RAISE EXCEPTION 'FAIL: the link scope trigger is not BEFORE INSERT OR UPDATE OF message_id, tenant_id, channel_id'; END IF;
END $$;
\echo 'PASS: under Supabase default privileges the link table has RLS, no policies and no browser grant; two jsonb DEFINER doors, authenticated only; no delegation, approval or calendar path'

-- A10: the link table is deleted with the account at retirement; nothing else moves; the guard
-- refuses a policy it cannot reconcile.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'team\_hub\_%' AND c.relkind='r'
   AND public.operator_retirement_disposition(c.relname::text) IS DISTINCT FROM 'delete') THEN
  RAISE EXCEPTION 'FAIL: a Team Hub table is not registered delete in the retirement policy (A10)'; END IF;
 IF public.operator_retirement_disposition('growth_public_visits')<>'delete' OR public.operator_retirement_disposition('tenants')<>'delete'
   OR public.operator_retirement_disposition('profiles')<>'preserve' OR public.operator_retirement_disposition('fixture_unregistered')<>'blocked' THEN
  RAISE EXCEPTION 'FAIL: registering the link table changed another table''s retirement disposition'; END IF;
 IF (SELECT array_length(string_to_array(p.prosrc,'''team_hub_work_refs'''),1)-1 FROM pg_proc p
   WHERE p.oid='public.operator_retirement_disposition(text)'::regprocedure)<>1
  OR (SELECT array_length(string_to_array(p.prosrc,'''team_hub_channels'''),1)-1 FROM pg_proc p
   WHERE p.oid='public.operator_retirement_disposition(text)'::regprocedure)<>1 THEN
  RAISE EXCEPTION 'FAIL: a Team Hub table is registered other than exactly once'; END IF;
 IF has_function_privilege('authenticated','public.operator_retirement_disposition(text)','EXECUTE')
   OR has_function_privilege('anon','public.operator_retirement_disposition(text)','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: patching the retirement policy widened its grants'; END IF;
END $$;
\set a10_block `sed -n '/^-- A10:/,/^END \$\$;$/p' supabase/migrations/20271113860008_exp08_team_hub_team_work.sql`
SELECT set_config('fixture.a10_block',:'a10_block',false) IS NOT NULL AS a10_loaded \gset
BEGIN;
CREATE OR REPLACE FUNCTION public.operator_retirement_disposition(_table text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN _table=ANY(ARRAY['tenants'
 ]) THEN 'delete' WHEN _table=ANY(ARRAY['profiles']) THEN 'preserve' ELSE 'blocked' END
$$;
DO $$ BEGIN
 IF position('SELECT CASE WHEN _table=ANY(ARRAY[' IN current_setting('fixture.a10_block'))=0 THEN
  RAISE EXCEPTION 'FAIL: the A10 block was not found in the migration'; END IF;
 BEGIN
  EXECUTE current_setting('fixture.a10_block');
  RAISE EXCEPTION 'FAIL: the A10 patch registered the link table into a policy it could not reconcile';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Canonical retirement policy requires reconciliation before registering Team Hub work references' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
\echo 'PASS: retirement deletes the link table with the account (A10); the rest of the policy is untouched; the guard refuses an unreconciled policy'

-- Session helpers. Each RPC call is still its own statement.
CREATE FUNCTION pg_temp.act(u text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', CASE WHEN u IS NULL THEN '{"role":"authenticated"}'
  ELSE json_build_object('sub',u,'role','authenticated')::text END, false); END $$;
CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.denied(statement text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE statement; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
-- Everything a request could leave behind, in one comparable value.
CREATE FUNCTION pg_temp.stored() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
 SELECT concat_ws('/', (SELECT count(*) FROM public.team_hub_messages), (SELECT count(*) FROM public.team_hub_work_refs),
  (SELECT count(*) FROM public.plan_items), (SELECT count(*) FROM public.team_hub_channel_members)) $$;
CREATE FUNCTION pg_temp.tasks() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*) FROM public.plan_items $$;
CREATE FUNCTION pg_temp.joined(ch uuid, u uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
 SELECT EXISTS(SELECT 1 FROM public.team_hub_channel_members WHERE channel_id=ch AND user_id=u) $$;
CREATE FUNCTION pg_temp.item(id uuid) RETURNS public.plan_items LANGUAGE sql SECURITY DEFINER AS $$
 SELECT * FROM public.plan_items WHERE plan_items.id=item.id $$;
-- Both doors, reduced to their refusal codes.
CREATE FUNCTION pg_temp.codes(t uuid, ch uuid) RETURNS text[] LANGUAGE sql AS $$
 SELECT ARRAY[
  public.team_hub_request_task(t,ch,'Probe','10000000-0000-4000-8000-000000000001',NULL,gen_random_uuid())->>'code',
  public.team_hub_list_work(t)->>'code'] $$;
SELECT (now()+interval '1 day')::text AS tomorrow, (now()-interval '1 minute')::text AS past \gset
\o /dev/null

---------------------------------------------------------------------------------------------
-- 1. Conversations: a team channel, a private channel the admin is not in, and a DM.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT public.team_hub_create_channel(:'ta','general','team','{}',gen_random_uuid())->>'channel_id' AS general \gset
SELECT public.team_hub_create_channel(:'ta','leads','private',ARRAY[:'u2']::uuid[],gen_random_uuid())->>'channel_id' AS leads \gset
SELECT public.team_hub_open_dm(:'ta',:'u2')->>'channel_id' AS dm12 \gset
SELECT public.team_hub_post_message(:'ta',:'general','Plain message','30000000-0000-4000-8000-000000000001')#>>'{message,id}' AS plain \gset
SELECT pg_temp.check(public.team_hub_list_work(:'ta')=jsonb_build_object('ok',true,'items','[]'::jsonb),
 'list work: first use is empty and invents nothing');

---------------------------------------------------------------------------------------------
-- 2. The owner starts a task: one message, one task, one link, in one request.
---------------------------------------------------------------------------------------------
SELECT pg_temp.stored() AS before \gset
SELECT public.team_hub_request_task(:'ta',:'general',E'  Send the launch brief  ',:'u2',:'tomorrow',
 '40000000-0000-4000-8000-000000000001') AS r \gset t1_
SELECT pg_temp.check((:'t1_r')::jsonb->>'ok'='true', 'create: the owner''s request succeeds: '||(:'t1_r'));
SELECT (:'t1_r')::jsonb#>>'{message,id}' AS t1_msg, (:'t1_r')::jsonb#>>'{message,work_ref,id}' AS t1_work \gset
SELECT pg_temp.check(r->>'ok'='true' AND r->'duplicate' IS NULL, 'create: ok, not a duplicate'),
 pg_temp.check((r->'message'->>'body')='/PAIGE draft a task' AND r#>>'{message,author_user_id}'=:'u1'
  AND r#>'{message,mentions}'='[]'::jsonb AND r#>'{message,parent_message_id}'='null'::jsonb,
  'create: the message is the fixed command text; the title lives in Operations, not the message'),
 pg_temp.check(r#>'{message,work_ref}'=jsonb_build_object('source','planning','id',:'t1_work'),
  'create: the message carries work_ref {source, id}'),
 pg_temp.check((r->'message') - ARRAY['id','author_user_id','body','created_at','parent_message_id','reply_count',
   'last_reply_at','mentions','work_ref']='{}'::jsonb, 'create: the message carries exactly increment 1''s fields plus work_ref'),
 pg_temp.check(r - ARRAY['ok','message']='{}'::jsonb, 'create: the result carries exactly ok and message')
FROM (SELECT (:'t1_r')::jsonb AS r) x;
SELECT pg_temp.check(i.title='Send the launch brief' AND i.assigned_to_user_id=:'u2' AND i.created_by=:'u1'
  AND i.tenant_id=:'ta' AND i.item_type='task' AND i.status='open' AND i.due_at=(:'tomorrow')::timestamptz,
  'create: Operations holds the task: trimmed title, assignee, creator, workspace, due date')
FROM pg_temp.item(:'t1_work') i;
RESET ROLE;
SELECT pg_temp.check(pg_temp.stored()=concat_ws('/',split_part(:'before','/',1)::int+1,split_part(:'before','/',2)::int+1,
  split_part(:'before','/',3)::int+1,split_part(:'before','/',4)::int), 'create: exactly one message, one link and one task'),
 pg_temp.check((SELECT w.tenant_id=:'ta' AND w.channel_id=:'general' AND w.work_source='planning' AND w.work_id=:'t1_work'
   AND w.created_by=:'u1' FROM public.team_hub_work_refs w WHERE w.message_id=:'t1_msg'), 'create: the link names the message, conversation and task'),
 pg_temp.check((SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_attribute a
   WHERE a.attrelid='public.team_hub_work_refs'::regclass AND a.attnum>0 AND NOT a.attisdropped)
   =ARRAY['message_id','tenant_id','channel_id','work_source','work_id','created_by','created_at'],
  'storage: the link stores no status, title, assignee or due date');
SET ROLE authenticated;
SELECT pg_temp.check((SELECT e->'work_ref' FROM jsonb_array_elements(public.team_hub_list_messages(:'ta',:'general')->'messages') e
  WHERE e->>'id'=:'t1_msg')=jsonb_build_object('source','planning','id',:'t1_work')
 AND (SELECT e ? 'work_ref' AND e->'work_ref'='null'::jsonb FROM jsonb_array_elements(public.team_hub_list_messages(:'ta',:'general')->'messages') e
  WHERE e->>'id'=:'plain'), 'read: listed messages carry work_ref, null on a plain message');
SELECT pg_temp.check(r->>'ok'='true' AND r#>>'{message,body}'='Still a plain post' AND r#>'{message,work_ref}'='null'::jsonb,
 'post: increment 1''s post door still works and its message carries work_ref null')
FROM (SELECT public.team_hub_post_message(:'ta',:'general','Still a plain post',gen_random_uuid()) AS r) x;
\echo 'PASS: a request creates the command message, the Operations task and the link together; messages carry work_ref'

---------------------------------------------------------------------------------------------
-- 3. Exactly once: a retry returns the original and never reaches Operations again.
---------------------------------------------------------------------------------------------
SELECT pg_temp.stored() AS before \gset
SELECT pg_temp.check(r->>'ok'='true' AND r->>'duplicate'='true' AND r#>>'{message,id}'=:'t1_msg'
  AND r#>>'{message,work_ref,id}'=:'t1_work', 'retry: returns the original message and task, marked duplicate')
FROM (SELECT public.team_hub_request_task(:'ta',:'general','Send the launch brief',:'u2',:'tomorrow','40000000-0000-4000-8000-000000000001') AS r) x;
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'general','',NULL,:'past','40000000-0000-4000-8000-000000000001')#>>'{message,work_ref,id}'=:'t1_work',
 'retry: a retry whose draft changed, or whose due date has since passed, still returns the original');
SELECT pg_temp.check(pg_temp.stored()=:'before', 'retry: no second message, link or plan_items row');
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'dm12','Send the launch brief',:'u2',NULL,'40000000-0000-4000-8000-000000000001')->>'code'='invalid',
  'retry: the same request id in another conversation is invalid, not a second task'),
 pg_temp.check(public.team_hub_request_task(:'ta',:'general','Reuse a plain id',:'u1',NULL,'30000000-0000-4000-8000-000000000001')->>'code'='invalid',
  'retry: the request id of a plain message is invalid, and starts no task');
SELECT pg_temp.check(pg_temp.stored()=:'before', 'retry: refused retries stored nothing');
\echo 'PASS: a retry returns the original message and task; no second plan_items row is ever created'

---------------------------------------------------------------------------------------------
-- 4. Input is checked before Operations is reached; nothing is stored. Operations is set to
-- raise if it is reached at all, so each of these answers proves the check came first.
---------------------------------------------------------------------------------------------
SELECT pg_temp.stored() AS before \gset
SELECT set_config('fixture.ops_raise','FIXTURE: Operations must not be reached',false);
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'general',t,:'u1',NULL,gen_random_uuid())->>'code'='invalid', 'invalid title: '||coalesce(left(t,12),'null'))
FROM unnest(ARRAY[NULL,'',E' \n\t ',E' 　﻿',repeat('x',501),repeat(E'\U0001F600',501)]) t;
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'general','Title',:'u1',d::timestamptz,gen_random_uuid())->>'code'='invalid', 'invalid due date: '||d)
FROM unnest(ARRAY[:'past','infinity','-infinity','2020-01-01T00:00:00Z']) d;
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'general','Title',a::uuid,NULL,gen_random_uuid())->>'code'='invalid', 'invalid assignee: '||coalesce(a,'null'))
FROM unnest(ARRAY[NULL,:'u6',:'u7',:'u9','10000000-0000-4000-8000-0000000000ff']) a;
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'general','Title',:'u1',NULL,NULL)->>'code'='invalid', 'invalid: no client request id');
SELECT pg_temp.check(pg_temp.stored()=:'before', 'invalid: nothing stored, no task created');
SELECT set_config('fixture.ops_raise','',false);
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'general',repeat(E'\U0001F600',500),:'u1',NULL,gen_random_uuid())->>'ok'='true',
 'title: 500 characters (not UTF-16 units) is accepted');
\echo 'PASS: a bad title, a past or non-finite due date, an inactive or foreign assignee and a missing request id are invalid and store nothing'

---------------------------------------------------------------------------------------------
-- 5. Every Operations refusal rolls back the message, the join, the task and the link.
---------------------------------------------------------------------------------------------
-- u5 has not joined general. A refused request must not have joined them either.
SELECT pg_temp.act(:'u5');
SELECT pg_temp.stored() AS before \gset
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'general','For the owner',:'u1',NULL,'40000000-0000-4000-8000-000000000005')->>'code'='not_allowed',
 'refusal: a member assigning someone else is not_allowed (Operations PLAN_ASSIGNMENT_FORBIDDEN)');
SELECT set_config('fixture.ops_raise',e,false), pg_temp.check(public.team_hub_request_task(:'ta',:'general','For me',:'u5',NULL,'40000000-0000-4000-8000-000000000005')->>'code'=c,
  'refusal: Operations '||e||' maps to '||c)
FROM (VALUES ('PLAN_SCOPE_CHANGED','scope_changed'),('PLAN_FORBIDDEN: not a member','unavailable'),
 ('PLAN_FORBIDDEN: Solo Operations unavailable','unavailable'),('PLAN_ASSIGNMENT_FORBIDDEN','not_allowed'),
 ('PLAN_TASK_INPUT_INVALID','invalid'),('PLAN_ASSIGNEE_NOT_IN_TENANT','invalid'),
 ('PLAN_CREATE_UNCONFIRMED','failed'),('PLAN_PROJECT_UNAVAILABLE','failed'),('something unexpected','failed'),
 ('noinsert','failed')) v(e,c);
SELECT set_config('fixture.ops_raise','',false);
RESET ROLE;
SELECT pg_temp.check(pg_temp.stored()=:'before', 'refusal: every refusal left no message, link, task or membership'),
 pg_temp.check(NOT pg_temp.joined(:'general',:'u5'), 'refusal: the team-channel join that posting makes was rolled back too');
SET ROLE authenticated;
SELECT pg_temp.check(r->>'ok'='true' AND r->'duplicate' IS NULL AND r#>>'{message,work_ref,source}'='planning',
  'refusal: the refused request id was not consumed; the corrected request creates the task')
FROM (SELECT public.team_hub_request_task(:'ta',:'general','For me',:'u5',NULL,'40000000-0000-4000-8000-000000000005') AS r) x;
SELECT pg_temp.check(pg_temp.joined(:'general',:'u5'), 'create: posting the command joins a member to the team channel, as a post does');
-- Natural refusals from the real wrapper and the core beneath it, not the knob.
SELECT pg_temp.act(:'u3');
SELECT pg_temp.stored() AS before \gset
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'general','For a teammate',:'u2',NULL,gen_random_uuid())->>'code'='not_allowed',
 'refusal: a workspace admin without the canonical writer''s staff role is not_allowed, not unavailable');
SELECT pg_temp.act(:'u4');
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'general','For me',:'u4',NULL,gen_random_uuid())->>'code'='scope_changed',
 'refusal: a seat with no profile row is refused by Operations (PLAN_SCOPE_CHANGED) and maps to scope_changed');
SELECT pg_temp.check(pg_temp.stored()=:'before', 'refusal: natural refusals stored nothing');
\echo 'PASS: every Operations refusal maps to its code and rolls back the message, join, task and link; the request id is not consumed'

---------------------------------------------------------------------------------------------
-- 6. Assignment follows Operations' own rule: owner or admin may assign anyone; a member, only self.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u2');
SELECT public.team_hub_request_task(:'ta',:'leads','Draft the deck',:'u2',NULL,'40000000-0000-4000-8000-000000000006') AS r \gset lead_
SELECT pg_temp.check(r->>'ok'='true', 'member: assigns to self, in a private channel') FROM (SELECT (:'lead_r')::jsonb AS r) x;
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'leads','For the owner',:'u1',NULL,gen_random_uuid())->>'code'='not_allowed',
 'member: cannot assign the owner');
SELECT pg_temp.act(:'u1');
SELECT public.team_hub_request_task(:'ta',:'dm12','Review contract',:'u2',NULL,gen_random_uuid()) AS r \gset dm_
SELECT pg_temp.check(r->>'ok'='true' AND (pg_temp.item((r#>>'{message,work_ref,id}')::uuid)).assigned_to_user_id=:'u2',
 'owner: assigns a teammate, in a DM') FROM (SELECT (:'dm_r')::jsonb AS r) x;
-- In a thread: the parent must be a root of the same conversation.
SELECT public.team_hub_request_task(:'ta',:'general','Follow up',:'u1',NULL,gen_random_uuid(),:'plain') AS r \gset th_
SELECT pg_temp.check(r->>'ok'='true' AND r#>>'{message,parent_message_id}'=:'plain', 'thread: a task can start in a thread')
FROM (SELECT (:'th_r')::jsonb AS r) x;
SELECT pg_temp.stored() AS before \gset
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'general','Nested',:'u1',NULL,gen_random_uuid(),((:'th_r')::jsonb#>>'{message,id}')::uuid)->>'code'='invalid',
  'thread: not under a reply'),
 pg_temp.check(public.team_hub_request_task(:'ta',:'dm12','Elsewhere',:'u1',NULL,gen_random_uuid(),:'plain')->>'code'='invalid',
  'thread: not under a root of another conversation');
SELECT pg_temp.check(pg_temp.stored()=:'before', 'thread: refused requests stored nothing');
\echo 'PASS: an owner assigns anyone active, a member only themselves; tasks start in channels, DMs and threads'

---------------------------------------------------------------------------------------------
-- 7. The work list: conversations the caller can see now, newest first, no status.
---------------------------------------------------------------------------------------------
SELECT public.team_hub_list_work(:'ta') AS r \gset w1_
SELECT pg_temp.check(r->>'ok'='true' AND r - ARRAY['ok','items']='{}'::jsonb, 'list work: ok and items only'),
 pg_temp.check(jsonb_array_length(r->'items')=6, 'list work: the owner sees all six links'),
 pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'items') e
   WHERE e - ARRAY['message_id','channel_id','parent_message_id','source','work_id','created_by','created_at']<>'{}'::jsonb
    OR e->>'source'<>'planning'), 'list work: each item carries exactly its seven fields and never a status'),
 pg_temp.check((SELECT bool_and(a.c>=b.c) FROM (SELECT n, (e->>'created_at')::timestamptz c FROM jsonb_array_elements(r->'items') WITH ORDINALITY x(e,n)) a
   JOIN (SELECT n, (e->>'created_at')::timestamptz c FROM jsonb_array_elements(r->'items') WITH ORDINALITY x(e,n)) b ON b.n=a.n+1),
  'list work: newest first'),
 pg_temp.check((SELECT e->>'channel_id'=:'general' AND e->>'work_id'=:'t1_work' AND e->>'created_by'=:'u1' AND e->'parent_message_id'='null'::jsonb
   FROM jsonb_array_elements(r->'items') e WHERE e->>'message_id'=:'t1_msg'), 'list work: a row names its conversation, task and author'),
 pg_temp.check((SELECT e->>'parent_message_id' FROM jsonb_array_elements(r->'items') e
   WHERE e->>'message_id'=(:'th_r')::jsonb#>>'{message,id}')=:'plain', 'list work: a thread row names its root so the thread can open')
FROM (SELECT (:'w1_r')::jsonb AS r) x;
SELECT pg_temp.check(jsonb_array_length(public.team_hub_list_work(:'ta',1)->'items')=1
  AND public.team_hub_list_work(:'ta',1)#>>'{items,0,message_id}'=(:'w1_r')::jsonb#>>'{items,0,message_id}'
  AND jsonb_array_length(public.team_hub_list_work(:'ta',0)->'items')=1
  AND jsonb_array_length(public.team_hub_list_work(:'ta',1000)->'items')=6, 'list work: limit clamps to 1..100 and keeps the newest');
-- u3, the workspace admin, is not in leads and not in the DM.
SELECT pg_temp.act(:'u3');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'items') e WHERE e->>'channel_id' IN (:'leads',:'dm12'))
  AND jsonb_array_length(r->'items')=4, 'list work: a non-member of a private channel or DM sees none of its tasks, even as admin')
FROM (SELECT public.team_hub_list_work(:'ta') AS r) x;
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'leads','Sneak in',:'u3',NULL,gen_random_uuid())->>'code'='not_found'
  AND public.team_hub_request_task(:'ta',:'dm12','Sneak in',:'u3',NULL,gen_random_uuid())->>'code'='not_found',
  'request: a non-member of a private channel or DM gets not_found');
-- Visibility is "now": the owner leaves leads and its row goes from the owner's list.
SELECT pg_temp.act(:'u1');
SELECT public.team_hub_leave_channel(:'ta',:'leads');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.team_hub_list_work(:'ta')->'items') e WHERE e->>'channel_id'=:'leads'),
 'list work: leaving a private channel removes its tasks from the list');
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(EXISTS(SELECT 1 FROM jsonb_array_elements(public.team_hub_list_work(:'ta')->'items') e WHERE e->>'channel_id'=:'leads'),
 'list work: the member still in leads still sees it');
-- The last member leaves; leads is archived (A5). Even its own author's retry reads nothing back.
SELECT public.team_hub_leave_channel(:'ta',:'leads');
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'leads','Draft the deck',:'u2',NULL,'40000000-0000-4000-8000-000000000006')->>'code'='not_found',
  'retry: a conversation the author can no longer see is not_found, never the stored task'),
 pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.team_hub_list_work(:'ta')->'items') e WHERE e->>'channel_id'=:'leads'),
  'list work: an archived conversation''s tasks are gone from every list');
\echo 'PASS: the work list shows only conversations the caller can see now, newest first, with no status'

---------------------------------------------------------------------------------------------
-- 8. Isolation: another workspace, a workspace switch, agency, operator, anonymous, non-SOLO.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u7');
SELECT pg_temp.check(public.team_hub_list_work(:'tb')=jsonb_build_object('ok',true,'items','[]'::jsonb), 'other workspace: sees no work of A');
SELECT pg_temp.check(public.team_hub_request_task(:'tb',:'general','Cross',:'u7',NULL,gen_random_uuid())->>'code'='not_found',
 'other workspace: a conversation of A is not_found');
SELECT pg_temp.act(:'u8');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general')=ARRAY['scope_changed','scope_changed'], 'scope: a workspace switch mid-request is scope_changed');
SELECT pg_temp.act(:'u9');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general')=ARRAY['not_member','not_member'], 'agency standing: not_member');
SELECT pg_temp.act(:'u10');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general')=ARRAY['not_member','not_member'], 'operator standing: not_member');
SELECT pg_temp.act(NULL);
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general')=ARRAY['not_member','not_member'], 'no identity: not_member');
SELECT pg_temp.act(:'u11');
SELECT pg_temp.check(pg_temp.codes(:'tc',:'general')=ARRAY['unavailable','unavailable'], 'sub-account: unavailable');
SELECT pg_temp.act(:'u12');
SELECT pg_temp.check(pg_temp.codes(:'td',:'general')=ARRAY['unavailable','unavailable'], 'agency workspace: unavailable');
SELECT pg_temp.act(:'u6');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general')=ARRAY['not_member','not_member'], 'suspended seat: not_member');
RESET ROLE;
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.plan_items WHERE tenant_id<>:'ta')
  AND NOT EXISTS(SELECT 1 FROM public.team_hub_work_refs WHERE tenant_id<>:'ta'), 'isolation: no refused caller created a task or link anywhere');
SET ROLE anon;
SELECT pg_temp.check(pg_temp.denied(format(s,:'ta',:'general')), 'anon: no EXECUTE on '||s)
FROM unnest(ARRAY['SELECT public.team_hub_request_task(%L,%L,''x'',NULL,NULL,gen_random_uuid())',
 'SELECT public.team_hub_list_work(%L) WHERE %L IS NOT NULL']) s;
SELECT pg_temp.check(pg_temp.denied('SELECT 1 FROM public.team_hub_work_refs'), 'anon: cannot read the link table');
RESET ROLE; SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.denied('SELECT 1 FROM public.team_hub_work_refs'), 'authenticated: cannot read the link table'),
 pg_temp.check(pg_temp.denied('DELETE FROM public.team_hub_work_refs'), 'authenticated: cannot delete links'),
 pg_temp.check(pg_temp.denied(format('INSERT INTO public.team_hub_work_refs(message_id,tenant_id,channel_id,work_source,work_id,created_by) VALUES (%L,%L,%L,''planning'',gen_random_uuid(),%L)',
  :'plain',:'ta',:'general',:'u1')), 'authenticated: cannot insert a link directly'),
 pg_temp.check(pg_temp.denied(format('UPDATE public.team_hub_work_refs SET work_id=gen_random_uuid() WHERE message_id=%L',:'t1_msg')),
  'authenticated: cannot repoint a link');
\echo 'PASS: other workspaces, workspace switches, agency, operator, suspended, no-identity, anonymous and non-SOLO callers are refused; direct link access is refused'

---------------------------------------------------------------------------------------------
-- 9. Storage backstops: a link matches its message's workspace and conversation, names one
-- source, and points to a task at most once.
---------------------------------------------------------------------------------------------
RESET ROLE;
DO $$ BEGIN
 BEGIN
  INSERT INTO public.team_hub_work_refs(message_id,tenant_id,channel_id,work_source,work_id,created_by)
  SELECT id,'20000000-0000-4000-8000-00000000000b',channel_id,'planning',gen_random_uuid(),author_user_id
   FROM public.team_hub_messages m WHERE NOT EXISTS(SELECT 1 FROM public.team_hub_work_refs w WHERE w.message_id=m.id) LIMIT 1;
  RAISE EXCEPTION 'FAIL: storage accepted a link whose workspace differs from its message';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.team_hub_work_refs(message_id,tenant_id,channel_id,work_source,work_id,created_by)
  SELECT m.id,m.tenant_id,o.id,'planning',gen_random_uuid(),m.author_user_id FROM public.team_hub_messages m
   JOIN public.team_hub_channels o ON o.tenant_id=m.tenant_id AND o.id<>m.channel_id
   WHERE NOT EXISTS(SELECT 1 FROM public.team_hub_work_refs w WHERE w.message_id=m.id) LIMIT 1;
  RAISE EXCEPTION 'FAIL: storage accepted a link whose conversation differs from its message';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE public.team_hub_work_refs SET channel_id=(SELECT o.id FROM public.team_hub_channels o
   WHERE o.tenant_id=team_hub_work_refs.tenant_id AND o.id<>team_hub_work_refs.channel_id LIMIT 1);
  RAISE EXCEPTION 'FAIL: storage let a link move to another conversation';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.team_hub_work_refs(message_id,tenant_id,channel_id,work_source,work_id,created_by)
  SELECT id,tenant_id,channel_id,'approval',gen_random_uuid(),author_user_id
   FROM public.team_hub_messages m WHERE NOT EXISTS(SELECT 1 FROM public.team_hub_work_refs w WHERE w.message_id=m.id) LIMIT 1;
  RAISE EXCEPTION 'FAIL: storage accepted a work source other than planning';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.team_hub_work_refs(message_id,tenant_id,channel_id,work_source,work_id,created_by)
  SELECT m.id,m.tenant_id,m.channel_id,'planning',(SELECT work_id FROM public.team_hub_work_refs LIMIT 1),m.author_user_id
   FROM public.team_hub_messages m WHERE NOT EXISTS(SELECT 1 FROM public.team_hub_work_refs w WHERE w.message_id=m.id) LIMIT 1;
  RAISE EXCEPTION 'FAIL: storage linked one task to two messages';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
\echo 'PASS: a link matches its message''s workspace and conversation, names planning only, and points to a task at most once'

---------------------------------------------------------------------------------------------
-- 10. The concurrent-retry path. A fixture trigger stores the same (author, request id) just
-- ahead of the door's own insert, the way a second tab that committed first would; the door
-- must return what that request stored and never call Operations itself.
---------------------------------------------------------------------------------------------
CREATE FUNCTION public.fixture_race_first() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE racer uuid; task uuid; mode text:=current_setting('fixture.race',true);
BEGIN
 IF coalesce(mode,'') NOT IN ('task','plain') THEN RETURN NEW; END IF;
 PERFORM set_config('fixture.race','',true);
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id)
  VALUES (NEW.tenant_id,NEW.channel_id,NEW.author_user_id,'/PAIGE draft a task',NEW.client_request_id) RETURNING id INTO racer;
 IF mode='task' THEN
  INSERT INTO public.plan_items(tenant_id,item_type,title,created_by,assigned_to_user_id)
   VALUES (NEW.tenant_id,'task','Stored by the racing retry',NEW.author_user_id,NEW.author_user_id) RETURNING id INTO task;
  INSERT INTO public.team_hub_work_refs(message_id,tenant_id,channel_id,work_source,work_id,created_by)
   VALUES (racer,NEW.tenant_id,NEW.channel_id,'planning',task,NEW.author_user_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fixture_race_first BEFORE INSERT ON public.team_hub_messages FOR EACH ROW EXECUTE FUNCTION public.fixture_race_first();
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.tasks() AS tasks_before \gset
SELECT set_config('fixture.race','task',false);
SELECT pg_temp.check(r->>'ok'='true' AND r->>'duplicate'='true'
  AND (pg_temp.item((r#>>'{message,work_ref,id}')::uuid)).title='Stored by the racing retry',
  'race: a concurrent retry that stored first is returned, with its task')
FROM (SELECT public.team_hub_request_task(:'ta',:'general','Mine',:'u1',NULL,'40000000-0000-4000-8000-0000000000a1') AS r) x;
SELECT pg_temp.check(pg_temp.tasks()=:tasks_before+1, 'race: only the racing request''s task exists; the door never reached Operations');
SELECT set_config('fixture.race','plain',false);
SELECT pg_temp.check(public.team_hub_request_task(:'ta',:'general','Mine',:'u1',NULL,'40000000-0000-4000-8000-0000000000a2')->>'code'='invalid',
 'race: a concurrent plain message under the same request id is invalid, and starts no task');
SELECT pg_temp.check(pg_temp.tasks()=:tasks_before+1, 'race: still no task from the door');
SELECT set_config('fixture.race','',false);
RESET ROLE;
DROP TRIGGER fixture_race_first ON public.team_hub_messages;
DROP FUNCTION public.fixture_race_first();
\echo 'PASS: the concurrent-retry path returns the stored request and never calls Operations a second time'

---------------------------------------------------------------------------------------------
-- 11. Deleting a message takes its link; deleting a workspace takes all of it.
---------------------------------------------------------------------------------------------
DELETE FROM public.team_hub_messages WHERE id=:'t1_msg';
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.team_hub_work_refs WHERE message_id=:'t1_msg')
  AND EXISTS(SELECT 1 FROM public.plan_items WHERE id=:'t1_work'), 'delete: a message takes its link; the task stays in Operations');
DELETE FROM public.tenants WHERE id=:'ta';
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.team_hub_work_refs) AND NOT EXISTS(SELECT 1 FROM public.team_hub_messages WHERE tenant_id=:'ta'),
 'delete: a workspace and its Team Hub links go together');
\echo 'PASS: deleting a message removes its link; deleting a workspace cascades through the link table'

RESET ROLE;
\o
\c postgres
DROP DATABASE exp08_team_hub_work_proof;
\echo 'PASS: EXP08 Team Hub increment 2 team-work proof complete; disposable database dropped'
