-- EXP08 Team Hub increment 1: storage, callable seam and workspace isolation.
-- Disposable PostgreSQL only. Never target the linked project. The migration commits its own
-- BEGIN/COMMIT, so this proof runs in a database it creates and drops; nothing is left behind.
-- Each RPC below runs as its own autocommit statement, the way a browser request does, so
-- now() (created_at, last_read_at) advances between calls exactly as it does in production.
\set ON_ERROR_STOP on
\set QUIET on
DROP DATABASE IF EXISTS exp08_team_hub_proof;
CREATE DATABASE exp08_team_hub_proof;
\c exp08_team_hub_proof
SET client_min_messages=warning;
\o /dev/null

-- Minimal fixture: only what the migration and the real workspace resolver read.
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
-- Agency and operator standing, which the real resolver admits and Team Hub must not.
CREATE TABLE public.fixture_agency_managers(tenant_id uuid, user_id uuid);
CREATE TABLE public.fixture_platform_admins(user_id uuid);
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

-- Workspaces A and B are canonical SOLO. D is an agency; C is its sub-account, carrying the
-- legacy account_type='standalone' some early sub-accounts still have, so only the parent tells
-- it apart. Synthetic people only.
INSERT INTO public.tenants(id,name,account_type,parent_tenant_id) VALUES
 ('20000000-0000-4000-8000-00000000000a','Workspace A','standalone',NULL),
 ('20000000-0000-4000-8000-00000000000b','Workspace B','standalone',NULL),
 ('20000000-0000-4000-8000-00000000000d','Agency D','agency',NULL),
 ('20000000-0000-4000-8000-00000000000c','Sub-account C','standalone','20000000-0000-4000-8000-00000000000d');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,job_title,joined_at) VALUES
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000001','owner','active',true,'Founder','2026-01-01'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000002','member','active',false,'Designer','2026-01-02'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000003','admin','active',false,'Producer','2026-01-03'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000004','member','active',false,NULL,'2026-01-04'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000005','member','active',false,NULL,'2026-01-05'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000006','member','active',false,NULL,'2026-01-06'),
 ('20000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-000000000007','owner','active',true,NULL,'2026-01-07'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000008','member','active',false,NULL,'2026-01-08'),
 ('20000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-000000000008','member','active',false,NULL,'2026-01-01'),
 ('20000000-0000-4000-8000-00000000000c','10000000-0000-4000-8000-000000000011','owner','active',true,NULL,'2026-01-01'),
 ('20000000-0000-4000-8000-00000000000d','10000000-0000-4000-8000-000000000012','owner','active',true,NULL,'2026-01-01'),
 -- The seat agency_enter_subaccount gives an agency manager inside the child.
 ('20000000-0000-4000-8000-00000000000c','10000000-0000-4000-8000-000000000012','admin','active',false,NULL,'2026-01-02'),
 ('20000000-0000-4000-8000-00000000000c','10000000-0000-4000-8000-000000000013','member','removed',false,NULL,'2026-01-03');
INSERT INTO public.profiles(user_id,full_name,active_tenant_id) VALUES
 ('10000000-0000-4000-8000-000000000001','Test Owner','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000002','Jordan Test','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000003','Jordan Test','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000005','Removed Test','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000006','Suspended Test','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000007','Other Workspace','20000000-0000-4000-8000-00000000000b'),
 ('10000000-0000-4000-8000-000000000008','Two Workspaces','20000000-0000-4000-8000-00000000000b'),
 ('10000000-0000-4000-8000-000000000009','Agency Test','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000010','Operator Test','20000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-000000000011','Child Owner','20000000-0000-4000-8000-00000000000c'),
 ('10000000-0000-4000-8000-000000000012','Agency Owner','20000000-0000-4000-8000-00000000000d'),
 ('10000000-0000-4000-8000-000000000013','Removed Child','20000000-0000-4000-8000-00000000000c');
INSERT INTO public.fixture_agency_managers VALUES ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000009');
INSERT INTO public.fixture_platform_admins VALUES ('10000000-0000-4000-8000-000000000010');
-- The canonical account-retirement policy, abridged: the real signature, header and shape from
-- 20270602000504_operator_provider_independent_retirement.sql, the registrant the Team Hub patch
-- reconciles against (growth_public_visits, 20271024100000_int298_public_visits.sql), and
-- entries of each disposition. The migration patches this function the way it patches the real one.
CREATE OR REPLACE FUNCTION public.operator_retirement_disposition(_table text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN _table=ANY(ARRAY['growth_public_visits',
 'tenants','tenant_members','calendars','programs','program_approvals'
 ]) THEN 'delete' WHEN _table=ANY(ARRAY['profiles','paige_audit_log','platform_subscriptions','platform_usage_events','paige_llm_trace','paige_voice_cost_reservations']) THEN 'preserve' ELSE 'blocked' END
$$;
REVOKE ALL ON FUNCTION public.operator_retirement_disposition(text) FROM PUBLIC,anon,authenticated,service_role;
-- A second session, for the seat-lock proofs. Kept out of public.
CREATE SCHEMA fixture;
CREATE EXTENSION dblink SCHEMA fixture;
COMMIT;

-- Supabase's default privileges: every table and function created in public afterwards is
-- granted to anon, authenticated and service_role unless the migration revokes it. Without this
-- the grant assertions below could not fail.
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
\set u13 '10000000-0000-4000-8000-000000000013'
\set tc '20000000-0000-4000-8000-00000000000c'
\set td '20000000-0000-4000-8000-00000000000d'

\ir ../migrations/20271113850008_exp08_team_hub_collaboration.sql

-- Replay: a second apply must be a no-op on every object the migration owns.
CREATE TEMP TABLE replay_before AS
SELECT 'rel:'||c.relname AS k, concat_ws('|', c.relacl::text, c.relrowsecurity::text,
  (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)::text,
  (SELECT string_agg(pg_get_constraintdef(x.oid), ',' ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid),
  (SELECT string_agg(pg_get_indexdef(i.indexrelid), ',' ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid),
  (SELECT string_agg(pg_get_triggerdef(t.oid), ',' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) AS v
FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'team_hub_%' AND c.relkind='r'
UNION ALL
SELECT 'fn:'||p.oid::regprocedure::text, concat_ws('|', p.proacl::text, p.prosecdef::text, p.proconfig::text, md5(p.prosrc))
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team_hub_%'
UNION ALL
SELECT 'trg:tenant_members:'||t.tgname, pg_get_triggerdef(t.oid)
FROM pg_trigger t WHERE t.tgrelid='public.tenant_members'::regclass AND NOT t.tgisinternal
UNION ALL
SELECT 'policy:'||p.oid::regprocedure::text, concat_ws('|', p.proacl::text, md5(p.prosrc))
FROM pg_proc p WHERE p.oid='public.operator_retirement_disposition(text)'::regprocedure;
\ir ../migrations/20271113850008_exp08_team_hub_collaboration.sql
\o
DO $$ BEGIN
 IF (SELECT count(*) FROM replay_before WHERE k LIKE 'rel:%')<>4 OR (SELECT count(*) FROM replay_before WHERE k LIKE 'fn:%')<>19
   OR (SELECT count(*) FROM replay_before WHERE k LIKE 'trg:tenant_members:%')<>1
   OR (SELECT count(*) FROM replay_before WHERE k LIKE 'policy:%')<>1 THEN
  RAISE EXCEPTION 'FAIL: migration did not create its four tables, nineteen functions and one tenant_members trigger'; END IF;
 IF EXISTS(SELECT k,v FROM replay_before EXCEPT (
  SELECT 'rel:'||c.relname, concat_ws('|', c.relacl::text, c.relrowsecurity::text,
   (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)::text,
   (SELECT string_agg(pg_get_constraintdef(x.oid), ',' ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid),
   (SELECT string_agg(pg_get_indexdef(i.indexrelid), ',' ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid),
   (SELECT string_agg(pg_get_triggerdef(t.oid), ',' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal))
  FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'team_hub_%' AND c.relkind='r'
  UNION ALL
  SELECT 'fn:'||p.oid::regprocedure::text, concat_ws('|', p.proacl::text, p.prosecdef::text, p.proconfig::text, md5(p.prosrc))
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team_hub_%'
  UNION ALL
  SELECT 'trg:tenant_members:'||t.tgname, pg_get_triggerdef(t.oid)
  FROM pg_trigger t WHERE t.tgrelid='public.tenant_members'::regclass AND NOT t.tgisinternal
  UNION ALL
  SELECT 'policy:'||p.oid::regprocedure::text, concat_ws('|', p.proacl::text, md5(p.prosrc))
  FROM pg_proc p WHERE p.oid='public.operator_retirement_disposition(text)'::regprocedure)) THEN
  RAISE EXCEPTION 'FAIL: replaying the migration changed a table, grant, policy, index, trigger, function or the retirement policy'; END IF;
END $$;
\echo 'PASS: migration applies; a second apply is a no-op on tables, grants, RLS, indexes, triggers and functions'

-- Structural floor: RLS with no policies, nothing granted to browser roles, DEFINER doors only.
DO $$ DECLARE f text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'team_hub_%' AND c.relkind='r'
   AND (NOT c.relrowsecurity OR EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid)
    OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))) THEN
  RAISE EXCEPTION 'FAIL: a Team Hub table is policy-open to, or grants any of SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER to, a browser role'; END IF;
 FOREACH f IN ARRAY ARRAY['team_hub_list_conversations(uuid)','team_hub_create_channel(uuid,text,text,uuid[],uuid)',
  'team_hub_open_dm(uuid,uuid)','team_hub_join_channel(uuid,uuid)','team_hub_leave_channel(uuid,uuid)',
  'team_hub_add_members(uuid,uuid,uuid[])','team_hub_list_messages(uuid,uuid,uuid,timestamptz,uuid,integer)',
  'team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[])','team_hub_mark_read(uuid,uuid,uuid)'] LOOP
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
 IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='team_hub_list_messages')<>1 THEN
  RAISE EXCEPTION 'FAIL: the earlier team_hub_list_messages signature survived beside the cursor one'; END IF;
 IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='team_hub_mark_read')<>1 THEN
  RAISE EXCEPTION 'FAIL: the earlier team_hub_mark_read signature survived beside the read-through one (A8)'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
   WHERE t.tgrelid='public.tenant_members'::regclass AND t.tgname='team_hub_seat_ended'
    AND p.proname='_team_hub_seat_ended' AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']
    AND pg_get_triggerdef(t.oid) LIKE '%AFTER DELETE OR UPDATE OF status ON public.tenant_members FOR EACH ROW%') THEN
  RAISE EXCEPTION 'FAIL: the seat-ended trigger is not an AFTER UPDATE OF status OR DELETE DEFINER trigger'; END IF;
END $$;
\echo 'PASS: under Supabase default privileges, four tables have RLS, no policies and no browser grant of any table privilege; nine jsonb DEFINER doors, authenticated only'

-- A10: all four tables are deleted with the account at retirement, by the guarded patch; the
-- rest of the policy is untouched, and the guard refuses a policy it cannot reconcile.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'team\_hub\_%' AND c.relkind='r'
   AND public.operator_retirement_disposition(c.relname::text) IS DISTINCT FROM 'delete')
   OR (SELECT count(*) FROM unnest(ARRAY['team_hub_channels','team_hub_channel_members','team_hub_messages','team_hub_message_mentions']) t
    WHERE public.operator_retirement_disposition(t)='delete')<>4 THEN
  RAISE EXCEPTION 'FAIL: a Team Hub table is not registered delete in the retirement policy (A10)'; END IF;
 IF public.operator_retirement_disposition('growth_public_visits')<>'delete' OR public.operator_retirement_disposition('tenants')<>'delete'
   OR public.operator_retirement_disposition('profiles')<>'preserve' OR public.operator_retirement_disposition('fixture_unregistered')<>'blocked' THEN
  RAISE EXCEPTION 'FAIL: registering Team Hub changed another table''s retirement disposition'; END IF;
 IF (SELECT array_length(string_to_array(p.prosrc,'''team_hub_channels'''),1)-1 FROM pg_proc p
   WHERE p.oid='public.operator_retirement_disposition(text)'::regprocedure)<>1 THEN
  RAISE EXCEPTION 'FAIL: team_hub_channels is registered other than exactly once'; END IF;
 IF has_function_privilege('authenticated','public.operator_retirement_disposition(text)','EXECUTE')
   OR has_function_privilege('anon','public.operator_retirement_disposition(text)','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: patching the retirement policy widened its grants'; END IF;
END $$;
-- The guard itself: the migration's own A10 block, run against a policy that lacks the registrant
-- it reconciles against, must refuse rather than patch blind.
\set a10_block `sed -n '/^-- A10:/,/^END \$\$;$/p' supabase/migrations/20271113850008_exp08_team_hub_collaboration.sql`
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
  RAISE EXCEPTION 'FAIL: the A10 patch registered Team Hub into a policy it could not reconcile';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Canonical retirement policy requires reconciliation before registering Team Hub' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
\echo 'PASS: retirement deletes all four Team Hub tables with the account (A10); the rest of the policy is untouched; the guard refuses an unreconciled policy'

-- Session helpers. Each RPC call is still its own statement.
CREATE FUNCTION pg_temp.act(u text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', CASE WHEN u IS NULL THEN '{"role":"authenticated"}'
  ELSE json_build_object('sub',u,'role','authenticated')::text END, false); END $$;
CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.denied(statement text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE statement; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
-- Every door, called with plausible arguments, reduced to its refusal code.
CREATE FUNCTION pg_temp.codes(t uuid, ch uuid) RETURNS text[] LANGUAGE sql AS $$
 SELECT ARRAY[
  public.team_hub_list_conversations(t)->>'code',
  public.team_hub_create_channel(t,'refused-probe','team','{}',gen_random_uuid())->>'code',
  public.team_hub_open_dm(t,'10000000-0000-4000-8000-000000000002')->>'code',
  public.team_hub_join_channel(t,ch)->>'code',
  public.team_hub_leave_channel(t,ch)->>'code',
  public.team_hub_add_members(t,ch,ARRAY['10000000-0000-4000-8000-000000000004']::uuid[])->>'code',
  public.team_hub_list_messages(t,ch)->>'code',
  public.team_hub_post_message(t,ch,'refused probe',gen_random_uuid())->>'code',
  public.team_hub_mark_read(t,ch,gen_random_uuid())->>'code'] $$;
CREATE FUNCTION pg_temp.message_count() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
 SELECT count(*) FROM public.team_hub_messages $$;
CREATE FUNCTION pg_temp.mention_count() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
 SELECT count(*) FROM public.team_hub_message_mentions $$;
CREATE FUNCTION pg_temp.channel_count() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
 SELECT count(*) FROM public.team_hub_channels $$;
\o /dev/null

---------------------------------------------------------------------------------------------
-- 1. An active member can create, post, read, reply, mention and mark read.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT public.team_hub_list_conversations(:'ta') AS r \gset first_
SELECT pg_temp.check(r->>'ok'='true' AND r->>'tenant_id'=:'ta' AND r#>>'{me,user_id}'=:'u1', 'list: ok, tenant and me'),
 pg_temp.check(r->'conversations'='[]'::jsonb, 'list: first use has no conversations and invents none'),
 pg_temp.check(jsonb_array_length(r->'people')=7, 'list: roster is the seven active seats of workspace A'),
 pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'people') e WHERE e->>'user_id' IN (:'u7',:'u9',:'u10')),
  'list: other-workspace, agency and operator people are never listed'),
 pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'people') e WHERE e ? 'email'
   OR (e - ARRAY['user_id','display_name','title','permission'])<>'{}'::jsonb), 'list: people carry exactly four fields, never an email'),
 pg_temp.check((SELECT e->>'display_name' FROM jsonb_array_elements(r->'people') e WHERE e->>'user_id'=:'u4')='Teammate',
  'list: a seat without a profile name reads Teammate'),
 pg_temp.check((SELECT array_agg(e->>'title' ORDER BY e->>'title') FROM jsonb_array_elements(r->'people') e
   WHERE e->>'display_name'='Jordan Test')=ARRAY['Designer','Producer'], 'list: two people with one name are told apart by title'),
 pg_temp.check((SELECT e->>'permission' FROM jsonb_array_elements(r->'people') e WHERE e->>'user_id'=:'u1')='owner'
   AND (SELECT e->>'permission' FROM jsonb_array_elements(r->'people') e WHERE e->>'user_id'=:'u3')='admin', 'list: permission is owner/admin/member')
FROM (SELECT (:'first_r')::jsonb AS r) x;
SELECT pg_temp.check(public.team_hub_create_channel(:'ta',n,'team','{}',gen_random_uuid())->>'code'='invalid', 'create: invalid name '||n)
FROM unnest(ARRAY['a','-launch','bad name','bad_name','x23456789012345678901234567890z','']) n;
SELECT pg_temp.check(public.team_hub_create_channel(:'ta','launch','public','{}',gen_random_uuid())->>'code'='invalid', 'create: unknown visibility'),
 pg_temp.check(public.team_hub_create_channel(:'ta',NULL,'team','{}',gen_random_uuid())->>'code'='invalid', 'create: no name'),
 pg_temp.check(public.team_hub_create_channel(:'ta','launch','team','{}',NULL)->>'code'='invalid', 'create: no client request id');
SELECT public.team_hub_create_channel(:'ta','  General ','team','{}',gen_random_uuid())->>'channel_id' AS general \gset
SELECT pg_temp.check(public.team_hub_create_channel(:'ta','general','team','{}',gen_random_uuid())->>'channel_id'=:'general',
 'create: a retry by the same creator within 60 seconds returns the same channel');
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(public.team_hub_create_channel(:'ta','general','team','{}',gen_random_uuid())->>'code'='name_taken',
 'create: another creator gets name_taken');
SELECT pg_temp.check(public.team_hub_create_channel(:'ta','leads','private',ARRAY[:'u3',:'u7']::uuid[],gen_random_uuid())->>'code'='invalid',
  'create: a private member from another workspace is invalid'),
 pg_temp.check(public.team_hub_create_channel(:'ta','leads','private',ARRAY[:'u3',:'u9']::uuid[],gen_random_uuid())->>'code'='invalid',
  'create: an agency manager without a seat is invalid');
SELECT pg_temp.check(pg_temp.channel_count()=1, 'create: a refused private create stores nothing');
SELECT public.team_hub_create_channel(:'ta','leads','private',ARRAY[:'u3',:'u5',:'u3']::uuid[],gen_random_uuid())->>'channel_id' AS leads \gset
SELECT pg_temp.check(public.team_hub_join_channel(:'ta',:'general')->>'ok'='true' AND public.team_hub_join_channel(:'ta',:'general')->>'ok'='true',
  'join: a team channel joins, idempotently'),
 pg_temp.check(public.team_hub_join_channel(:'ta',:'leads')->>'code'='not_found', 'join: a private channel cannot be joined');
SELECT pg_temp.act(:'u5');
SELECT pg_temp.check(public.team_hub_join_channel(:'ta',:'general')->>'ok'='true', 'join: a second teammate joins');
SELECT pg_temp.act(:'u1');
SELECT public.team_hub_post_message(:'ta',:'general','  Kickoff at ten  ','30000000-0000-4000-8000-000000000001',NULL,ARRAY[:'u2']::uuid[]) AS r \gset post1_
SELECT pg_temp.check(r->>'ok'='true' AND r->'duplicate' IS NULL AND r#>>'{message,body}'='Kickoff at ten'
  AND r#>>'{message,author_user_id}'=:'u1' AND r#>'{message,mentions}'=jsonb_build_array(:'u2'), 'post: stored, trimmed, with its mention')
FROM (SELECT (:'post1_r')::jsonb AS r) x;
SELECT (:'post1_r')::jsonb#>>'{message,id}' AS m1 \gset
SELECT public.team_hub_post_message(:'ta',:'general','Agenda attached below','30000000-0000-4000-8000-000000000002')#>>'{message,id}' AS m2 \gset
SELECT public.team_hub_post_message(:'ta',:'general','Room is booked','30000000-0000-4000-8000-000000000003')#>>'{message,id}' AS m3 \gset
SELECT pg_temp.act(:'u2');
SELECT public.team_hub_post_message(:'ta',:'general','I will bring the deck','30000000-0000-4000-8000-000000000004',:'m1')#>>'{message,id}' AS r1 \gset
SELECT public.team_hub_list_conversations(:'ta') AS r \gset u2a_
SELECT pg_temp.check((SELECT (e->>'unread')::int FROM jsonb_array_elements(r->'conversations') e WHERE e->>'id'=:'general')=3,
  'unread: three top-level messages by others, not my reply'),
 pg_temp.check((SELECT e->>'joined' FROM jsonb_array_elements(r->'conversations') e WHERE e->>'id'=:'general')='true'
  AND (SELECT e->'member_count' FROM jsonb_array_elements(r->'conversations') e WHERE e->>'id'=:'general')='null'::jsonb,
  'list: joined team channel, member_count only for private conversations'),
 pg_temp.check((SELECT (e->>'member_count')::int FROM jsonb_array_elements(r->'conversations') e WHERE e->>'id'=:'leads')=3,
  'list: private channel counts its three members once each'),
 pg_temp.check((SELECT e->'member_ids' FROM jsonb_array_elements(r->'conversations') e WHERE e->>'id'=:'leads')
   =jsonb_build_array(:'u2',:'u3',:'u5'), 'list: a private channel lists its members to a member (A4)'),
 pg_temp.check((SELECT e ? 'member_ids' AND e->'member_ids'='null'::jsonb FROM jsonb_array_elements(r->'conversations') e
   WHERE e->>'id'=:'general'), 'list: a team channel carries no member_ids (A4)')
FROM (SELECT (:'u2a_r')::jsonb AS r) x;
SELECT pg_temp.check(public.team_hub_mark_read(:'ta',:'general',:'m2')->>'ok'='true', 'mark read: through a displayed message');
SELECT pg_temp.check((SELECT (e->>'unread')::int FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
  WHERE e->>'id'=:'general')=1, 'mark read (A8): read through the displayed message only; the one after it stays unread');
SELECT pg_temp.check(public.team_hub_mark_read(:'ta',:'general',:'r1')->>'code'='invalid', 'mark read: a reply is not a read-through point'),
 pg_temp.check(public.team_hub_mark_read(:'ta',:'leads',:'m1')->>'code'='invalid', 'mark read: a message of another conversation is invalid'),
 pg_temp.check(public.team_hub_mark_read(:'ta',:'general',gen_random_uuid())->>'code'='invalid', 'mark read: an unknown message is invalid'),
 pg_temp.check(public.team_hub_mark_read(:'ta',:'general',NULL)->>'code'='invalid', 'mark read: no message is invalid');
SELECT pg_temp.check(public.team_hub_mark_read(:'ta',:'general',:'m3')->>'ok'='true', 'mark read: ok');
SELECT pg_temp.check((SELECT (e->>'unread')::int FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
  WHERE e->>'id'=:'general')=0, 'unread: cleared by mark read');
SELECT pg_temp.check(public.team_hub_mark_read(:'ta',:'general',:'m1')->>'ok'='true'
  AND (SELECT (e->>'unread')::int FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
   WHERE e->>'id'=:'general')=0, 'mark read: an older message never moves the read point back');
SELECT pg_temp.act(:'u1');
SELECT public.team_hub_post_message(:'ta',:'general','One more thing','30000000-0000-4000-8000-000000000005')#>>'{message,id}' AS m4 \gset
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check((SELECT (e->>'unread')::int FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
  WHERE e->>'id'=:'general')=1, 'unread: a later message counts again');
-- The client displayed m3; m4 arrived before it reported reading. m4 stays unread.
SELECT pg_temp.check(public.team_hub_mark_read(:'ta',:'general',:'m3')->>'ok'='true'
  AND (SELECT (e->>'unread')::int FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
   WHERE e->>'id'=:'general')=1, 'mark read (A8): a message posted after the displayed one stays unread');
SELECT public.team_hub_list_messages(:'ta',:'general',NULL,NULL,NULL,2) AS r \gset page1_
SELECT pg_temp.check(r->>'ok'='true' AND r->>'has_more'='true' AND jsonb_array_length(r->'messages')=2
  AND r#>>'{messages,0,id}'=:'m4' AND r#>>'{messages,1,id}'=:'m3', 'read: newest first, a page of two with more'),
 pg_temp.check(r->'channel'=jsonb_build_object('id',:'general','kind','channel','name','general','visibility','team','joined',true),
  'read: the channel header'),
 pg_temp.check(NOT r ? 'root', 'read: the top level carries no thread root')
FROM (SELECT (:'page1_r')::jsonb AS r) x;
SELECT pg_temp.check(public.team_hub_list_messages(:'ta',:'general',NULL,
  ((:'page1_r')::jsonb#>>'{messages,1,created_at}')::timestamptz)->>'code'='invalid', 'read: a cursor time without its id is invalid (A6)'),
 pg_temp.check(public.team_hub_list_messages(:'ta',:'general',NULL,NULL,
  ((:'page1_r')::jsonb#>>'{messages,1,id}')::uuid)->>'code'='invalid', 'read: a cursor id without its time is invalid (A6)');
SELECT public.team_hub_list_messages(:'ta',:'general',NULL,((:'page1_r')::jsonb#>>'{messages,1,created_at}')::timestamptz,
 ((:'page1_r')::jsonb#>>'{messages,1,id}')::uuid,2) AS r \gset page2_
SELECT pg_temp.check(r->>'has_more'='false' AND r#>>'{messages,0,id}'=:'m2' AND r#>>'{messages,1,id}'=:'m1', 'read: paging back to the oldest page'),
 pg_temp.check((r#>>'{messages,1,reply_count}')::int=1 AND r#>>'{messages,1,last_reply_at}' IS NOT NULL
  AND r#>'{messages,1,mentions}'=jsonb_build_array(:'u2'), 'read: reply count, last reply and mentions on the root')
FROM (SELECT (:'page2_r')::jsonb AS r) x;
SELECT pg_temp.check((SELECT r->>'ok'='true' AND r->>'has_more'='false' AND r->'messages'='[]'::jsonb FROM (SELECT
  public.team_hub_list_messages(:'ta',:'general',NULL,((:'page2_r')::jsonb#>>'{messages,1,created_at}')::timestamptz,
   ((:'page2_r')::jsonb#>>'{messages,1,id}')::uuid) AS r) y),
  'read: nothing before the oldest message'),
 pg_temp.check(jsonb_array_length(public.team_hub_list_messages(:'ta',:'general',NULL,NULL,NULL,0)->'messages')=1
  AND jsonb_array_length(public.team_hub_list_messages(:'ta',:'general',NULL,NULL,NULL,1000)->'messages')=4, 'read: limit clamps to 1..100');
SELECT pg_temp.check(r->>'ok'='true' AND r#>>'{root,id}'=:'m1' AND r#>>'{root,body}'='Kickoff at ten'
  AND jsonb_array_length(r->'messages')=1 AND r#>>'{messages,0,id}'=:'r1' AND r#>>'{messages,0,parent_message_id}'=:'m1'
  AND r->>'has_more'='false', 'thread: the root apart, then its replies (A7)')
FROM (SELECT public.team_hub_list_messages(:'ta',:'general',:'m1') AS r) x;
SELECT pg_temp.act(:'u3');
SELECT pg_temp.check((SELECT e->>'joined' FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
  WHERE e->>'id'=:'general')='false', 'post: the poster has not joined yet');
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'general','Joining in','30000000-0000-4000-8000-000000000006')->>'ok'='true', 'post: a non-joined teammate posts');
SELECT pg_temp.check((SELECT e->>'joined' FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
  WHERE e->>'id'=:'general')='true', 'post: posting to a team channel joins the poster');
SELECT pg_temp.check((SELECT (e->>'unread')::int FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
  WHERE e->>'id'=:'general')=0, 'post: joining by posting reads the history; nothing earlier counts as unread');
-- Joining reads the history too. Rolled back so the rest of the proof keeps its memberships.
BEGIN;
SELECT pg_temp.act(:'u4');
SELECT pg_temp.check(public.team_hub_join_channel(:'ta',:'general')->>'ok'='true', 'join: a new member joins');
-- A separate statement, so the read cannot run before the join.
SELECT pg_temp.check((SELECT e->>'joined'='true' AND (e->>'unread')::int=0
  FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
  WHERE e->>'id'=:'general'), 'join: existing messages do not count as unread for a new member');
ROLLBACK;
SELECT pg_temp.act(:'u3');
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'general',E' \n\t ',gen_random_uuid())->>'code'='invalid', 'post: blank body is invalid'),
 pg_temp.check(public.team_hub_post_message(:'ta',:'general',repeat('x',8001),gen_random_uuid())->>'code'='too_long', 'post: 8001 characters is too_long'),
 pg_temp.check(public.team_hub_post_message(:'ta',:'general',repeat('x',8000),'30000000-0000-4000-8000-000000000007')->>'ok'='true', 'post: 8000 characters is stored'),
 pg_temp.check(public.team_hub_post_message(:'ta',:'general',E'\u00A0\u3000\uFEFF',gen_random_uuid())->>'code'='invalid',
  'post: a body of only non-breaking and other Unicode spaces is invalid, as the composer says'),
 pg_temp.check(public.team_hub_post_message(:'ta',:'general',E'\u00A0 Spaced out \u2003',gen_random_uuid())#>>'{message,body}'='Spaced out',
  'post: leading and trailing Unicode spaces are trimmed the way the composer trims them'),
 pg_temp.check(public.team_hub_post_message(:'ta',:'general',repeat(E'\U0001F600',8001),gen_random_uuid())->>'code'='too_long',
  'post: length counts characters, not UTF-16 units: 8001 emoji is too_long'),
 pg_temp.check(public.team_hub_post_message(:'ta',:'general','No id',NULL)->>'code'='invalid', 'post: no client request id is invalid');
\echo 'PASS: active member creates, joins, posts, reads with paging, replies, mentions, counts unread and marks read'

-- Direct messages.
SELECT pg_temp.act(:'u1');
SELECT public.team_hub_open_dm(:'ta',:'u2')->>'channel_id' AS dm12 \gset
SELECT pg_temp.check(public.team_hub_open_dm(:'ta',:'u2')->>'channel_id'=:'dm12', 'dm: reopening returns the same conversation');
SELECT pg_temp.check(public.team_hub_open_dm(:'ta',u::uuid)->>'code'='invalid', 'dm: not with '||u)
FROM unnest(ARRAY[:'u1',:'u7',:'u9',:'u10','10000000-0000-4000-8000-0000000000ff']) u;
SELECT pg_temp.check(public.team_hub_leave_channel(:'ta',:'dm12')->>'code'='not_allowed', 'dm: cannot be left'),
 pg_temp.check(public.team_hub_add_members(:'ta',:'dm12',ARRAY[:'u3']::uuid[])->>'code'='not_allowed', 'dm: nobody can be added'),
 pg_temp.check(public.team_hub_post_message(:'ta',:'dm12','Quick one','30000000-0000-4000-8000-000000000008',NULL,ARRAY[:'u3']::uuid[])->>'code'='invalid',
  'dm: a teammate outside the DM cannot be mentioned');
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(public.team_hub_open_dm(:'ta',:'u1')->>'channel_id'=:'dm12', 'dm: the other person opens the same conversation'),
 pg_temp.check((SELECT e->>'kind'='dm' AND e->'name'='null'::jsonb AND e->>'visibility'='private' AND e->>'dm_user_id'=:'u1'
   AND (e->>'member_count')::int=2 AND e->'member_ids'=jsonb_build_array(:'u1',:'u2')
   FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e WHERE e->>'id'=:'dm12'),
  'dm: listed with the other person, two members and their ids (A4)');
\echo 'PASS: direct messages open once per pair, only with active teammates, and cannot be left or widened'

-- Private channel membership.
SELECT pg_temp.check(public.team_hub_add_members(:'ta',:'leads',ARRAY[:'u4']::uuid[])->>'added'='1'
  AND public.team_hub_add_members(:'ta',:'leads',ARRAY[:'u4']::uuid[])->>'added'='0', 'add: a member adds a teammate, idempotently'),
 pg_temp.check(public.team_hub_add_members(:'ta',:'leads',ARRAY[:'u7']::uuid[])->>'code'='invalid', 'add: another workspace person is invalid'),
 pg_temp.check(public.team_hub_add_members(:'ta',:'general',ARRAY[:'u4']::uuid[])->>'code'='not_allowed', 'add: team channels take no added people');
SELECT pg_temp.act(:'u4');
SELECT pg_temp.check(public.team_hub_list_messages(:'ta',:'leads')->>'ok'='true', 'add: the added teammate can read');
SELECT pg_temp.act(:'u2');
SELECT public.team_hub_leave_channel(:'ta',:'general');
SELECT pg_temp.check((SELECT e->>'joined' FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
  WHERE e->>'id'=:'general')='false', 'leave: a team channel stays visible, no longer joined'),
 pg_temp.check((SELECT (e->>'unread')::int FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
  WHERE e->>'id'=:'general')=0, 'leave: unread counts only joined conversations'),
 pg_temp.check(public.team_hub_mark_read(:'ta',:'general',:'m1')->>'code'='not_allowed', 'mark read: an unjoined team channel is not_allowed');
SELECT pg_temp.act(:'u4');
SELECT pg_temp.check(public.team_hub_leave_channel(:'ta',:'leads')->>'ok'='true', 'leave: a private channel can be left');
SELECT pg_temp.check(public.team_hub_list_messages(:'ta',:'leads')->>'code'='not_found', 'leave: leaving a private channel removes access');
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(public.team_hub_list_messages(:'ta',:'leads')->>'ok'='true', 'leave: a private channel others are still in stays open (A5)');
\echo 'PASS: private channels add active teammates only; leaving a private channel removes access'

---------------------------------------------------------------------------------------------
-- 2. Invalid mentions store nothing; duplicates return the original; threads are one level.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1');
SELECT pg_temp.message_count() AS before_messages, pg_temp.mention_count() AS before_mentions \gset
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'general','Hello',gen_random_uuid(),NULL,ARRAY[:'u7']::uuid[])->>'code'='invalid', 'mention: other workspace'),
 pg_temp.check(public.team_hub_post_message(:'ta',:'general','Hello',gen_random_uuid(),NULL,ARRAY[:'u9']::uuid[])->>'code'='invalid', 'mention: agency without seat'),
 pg_temp.check(public.team_hub_post_message(:'ta',:'general','Hello',gen_random_uuid(),NULL,ARRAY[:'u2',NULL]::uuid[])->>'code'='invalid', 'mention: null id');
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'leads','Owner, look','30000000-0000-4000-8000-000000000009',NULL,ARRAY[:'u3',:'u1']::uuid[])->>'code'='invalid',
 'mention: a workspace owner outside a private channel cannot be mentioned there');
SELECT pg_temp.check(pg_temp.message_count()=:before_messages AND pg_temp.mention_count()=:before_mentions, 'mention: refused posts stored no message and no mention');
SELECT pg_temp.check(r->>'ok'='true' AND r->'duplicate' IS NULL AND r#>'{message,mentions}'=jsonb_build_array(:'u3'),
  'mention: the refused client request id is not consumed; the corrected post stores')
FROM (SELECT public.team_hub_post_message(:'ta',:'leads','Owner, look','30000000-0000-4000-8000-000000000009',NULL,ARRAY[:'u3']::uuid[]) AS r) x;
\echo 'PASS: invalid mentions store nothing and do not consume the client request id'
SELECT pg_temp.act(:'u1');
SELECT pg_temp.message_count() AS before_messages \gset
SELECT pg_temp.check(r->>'ok'='true' AND r->>'duplicate'='true' AND r#>>'{message,id}'=:'m1' AND r#>>'{message,body}'='Kickoff at ten',
  'duplicate: a retry returns the original message')
FROM (SELECT public.team_hub_post_message(:'ta',:'general','Kickoff at ten','30000000-0000-4000-8000-000000000001',NULL,ARRAY[:'u2']::uuid[]) AS r) x;
SELECT pg_temp.check(pg_temp.message_count()=:before_messages, 'duplicate: no second row');
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'dm12','Kickoff at ten','30000000-0000-4000-8000-000000000001')->>'code'='invalid',
  'duplicate: reusing a request id in another conversation is invalid, not a cross-post');
\echo 'PASS: a duplicate client request id returns the original message with no second row'
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'general','Reply to reply',gen_random_uuid(),:'r1')->>'code'='invalid', 'thread: no reply to a reply'),
 pg_temp.check(public.team_hub_post_message(:'ta',:'dm12','Wrong place',gen_random_uuid(),:'m1')->>'code'='invalid', 'thread: no reply across conversations'),
 pg_temp.check(public.team_hub_list_messages(:'ta',:'general',:'r1')->>'code'='not_found', 'thread: a reply is not a thread root');
RESET ROLE;
DO $$ BEGIN
 BEGIN
  INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,parent_message_id,client_request_id)
  SELECT tenant_id,channel_id,author_user_id,'depth two',id,gen_random_uuid() FROM public.team_hub_messages WHERE parent_message_id IS NOT NULL LIMIT 1;
  RAISE EXCEPTION 'FAIL: storage accepted a second thread level';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE public.team_hub_messages root SET parent_message_id=(SELECT o.id FROM public.team_hub_messages o
   WHERE o.channel_id=root.channel_id AND o.parent_message_id IS NULL AND o.id<>root.id LIMIT 1)
  WHERE EXISTS(SELECT 1 FROM public.team_hub_messages r WHERE r.parent_message_id=root.id);
  RAISE EXCEPTION 'FAIL: storage let a root with replies become a reply';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id)
  SELECT '20000000-0000-4000-8000-00000000000b',channel_id,author_user_id,'wrong tenant',gen_random_uuid() FROM public.team_hub_messages LIMIT 1;
  RAISE EXCEPTION 'FAIL: storage accepted a message whose tenant differs from its channel';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by)
  SELECT id,'20000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000007' FROM public.team_hub_channels LIMIT 1;
  RAISE EXCEPTION 'FAIL: storage accepted a membership whose tenant differs from its channel';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.team_hub_message_mentions(message_id,tenant_id,channel_id,mentioned_user_id)
  SELECT id,'20000000-0000-4000-8000-00000000000b',channel_id,'10000000-0000-4000-8000-000000000004' FROM public.team_hub_messages LIMIT 1;
  RAISE EXCEPTION 'FAIL: storage accepted a mention whose tenant differs from its message';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.team_hub_message_mentions(message_id,tenant_id,channel_id,mentioned_user_id)
  SELECT m.id,m.tenant_id,o.id,'10000000-0000-4000-8000-000000000004' FROM public.team_hub_messages m
   JOIN public.team_hub_channels o ON o.tenant_id=m.tenant_id AND o.id<>m.channel_id LIMIT 1;
  RAISE EXCEPTION 'FAIL: storage accepted a mention whose channel differs from its message';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
\echo 'PASS: thread depth is limited to one, in the door and in storage; tenant and channel must match on members, messages and mentions'

-- The concurrent-retry path. A fixture trigger stores the same (author, client request id)
-- just ahead of the door's own insert, so ON CONFLICT DO NOTHING fires deterministically: the
-- path a second browser tab racing the first takes.
CREATE FUNCTION public.fixture_race_first() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id)
  VALUES (NEW.tenant_id,current_setting('fixture.race_channel')::uuid,NEW.author_user_id,'stored by the racing retry',NEW.client_request_id);
 RETURN NEW;
END $$;
CREATE TRIGGER fixture_race_first BEFORE INSERT ON public.team_hub_messages FOR EACH ROW
 WHEN (NEW.body='race probe') EXECUTE FUNCTION public.fixture_race_first();
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT set_config('fixture.race_channel',:'dm12',false);
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'general','race probe','30000000-0000-4000-8000-0000000000a1')->>'code'='invalid',
 'race: a concurrent retry stored in another conversation is invalid, never a cross-post success');
SELECT set_config('fixture.race_channel',:'general',false);
SELECT pg_temp.check(r->>'ok'='true' AND r->>'duplicate'='true' AND r#>>'{message,body}'='stored by the racing retry',
  'race: a concurrent retry in the same conversation returns the row it stored')
FROM (SELECT public.team_hub_post_message(:'ta',:'general','race probe','30000000-0000-4000-8000-0000000000a2') AS r) x;
RESET ROLE;
SELECT pg_temp.check((SELECT array_agg(channel_id::text ORDER BY client_request_id) FROM public.team_hub_messages
  WHERE client_request_id IN ('30000000-0000-4000-8000-0000000000a1','30000000-0000-4000-8000-0000000000a2'))=ARRAY[:'dm12',:'general'],
 'race: exactly one row per request id, each where the racing retry put it');
DROP TRIGGER fixture_race_first ON public.team_hub_messages;
DROP FUNCTION public.fixture_race_first();
\echo 'PASS: the concurrent-retry path returns the stored row in its own conversation and refuses it in another'

---------------------------------------------------------------------------------------------
-- 3. A non-member of a private channel, even the workspace owner, gets not_found.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'conversations') e WHERE e->>'id'=:'leads' OR e->>'name'='leads'),
  'private: the owner''s conversation list has no entry, name or count for it')
FROM (SELECT public.team_hub_list_conversations(:'ta') AS r) x;
SELECT pg_temp.check((pg_temp.codes(:'ta',:'leads'))[4:9]=ARRAY['not_found','not_found','not_found','not_found','not_found','not_found'],
  'private: join, leave, add, read, post and mark read are all not_found for the owner');
SELECT pg_temp.check(public.team_hub_list_messages(:'ta',:'leads','30000000-0000-4000-8000-000000000009')->>'code'='not_found', 'private: thread read too');
\echo 'PASS: a non-member of a private channel gets not_found on list, read and post; the list has no entry or count'

---------------------------------------------------------------------------------------------
-- 4. Another workspace gets not_found; an expected-tenant mismatch gets scope_changed.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u7');
SELECT pg_temp.check(r->>'ok'='true' AND r->>'tenant_id'=:'tb' AND r->'conversations'='[]'::jsonb
  AND (SELECT array_agg(e->>'user_id' ORDER BY e->>'user_id') FROM jsonb_array_elements(r->'people') e)=ARRAY[:'u7',:'u8'],
  'other workspace: sees only its own roster and no conversations of A')
FROM (SELECT public.team_hub_list_conversations(:'tb') AS r) x;
SELECT pg_temp.check((pg_temp.codes(:'tb',:'general'))[4:9]=ARRAY['not_found','not_found','not_found','not_found','not_found','not_found'],
  'other workspace: every door on a channel of A is not_found');
SELECT pg_temp.check(public.team_hub_list_messages(:'tb',:'leads')->>'code'='not_found'
  AND public.team_hub_post_message(:'tb',:'dm12','hi',gen_random_uuid())->>'code'='not_found', 'other workspace: private channel and DM too');
SELECT pg_temp.act(:'u8');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general')=array_fill('scope_changed'::text,ARRAY[9]),
  'scope: a member of A whose current workspace is B gets scope_changed from every door');
SELECT pg_temp.check(public.team_hub_list_conversations(NULL)->>'code'='scope_changed', 'scope: no expected workspace is scope_changed');
\echo 'PASS: another workspace gets not_found; an expected-tenant mismatch gets scope_changed'

---------------------------------------------------------------------------------------------
-- 5. A removed or suspended member gets not_member everywhere; old rows grant nothing.
---------------------------------------------------------------------------------------------
RESET ROLE;
UPDATE public.tenant_members SET status='removed' WHERE user_id=:'u5' AND tenant_id=:'ta';
UPDATE public.tenant_members SET status='suspended' WHERE user_id=:'u6' AND tenant_id=:'ta';
SET ROLE authenticated;
SELECT pg_temp.act(:'u5');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'leads')=array_fill('not_member'::text,ARRAY[9])
  AND pg_temp.codes(:'ta',:'general')=array_fill('not_member'::text,ARRAY[9]), 'removed: not_member from every door, despite channel rows');
SELECT pg_temp.act(:'u6');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general')=array_fill('not_member'::text,ARRAY[9]), 'suspended: not_member from every door');
-- A member row left behind for an inactive seat (as data written before the seat-ended trigger
-- would be) still counts for nothing: the list filters to active seats on its own.
RESET ROLE;
INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by) VALUES (:'leads',:'ta',:'u6',:'u2');
SET ROLE authenticated;
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'people') e WHERE e->>'user_id' IN (:'u5',:'u6'))
  AND (SELECT (e->>'member_count')::int FROM jsonb_array_elements(r->'conversations') e WHERE e->>'id'=:'leads')=2
  AND (SELECT e->'member_ids' FROM jsonb_array_elements(r->'conversations') e WHERE e->>'id'=:'leads')=jsonb_build_array(:'u2',:'u3'),
  'removed: gone from the roster and from the private member count and ids, even with a leftover row')
FROM (SELECT public.team_hub_list_conversations(:'ta') AS r) x;
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'leads','Still here?',gen_random_uuid(),NULL,ARRAY[:'u5']::uuid[])->>'code'='invalid'
  AND public.team_hub_open_dm(:'ta',:'u6')->>'code'='invalid' AND public.team_hub_add_members(:'ta',:'leads',ARRAY[:'u6']::uuid[])->>'code'='invalid',
  'removed: cannot be mentioned, messaged or added');
\echo 'PASS: a removed or suspended member gets not_member everywhere; existing channel rows grant nothing'

---------------------------------------------------------------------------------------------
-- 5b. A2: a seat that stops being active loses its private channels and DMs, in that
-- workspace only. Re-inviting restores none of them; reopening a DM brings its history back.
---------------------------------------------------------------------------------------------
RESET ROLE;
SELECT pg_temp.check((SELECT array_agg(c.name ORDER BY c.name) FROM public.team_hub_channel_members m
  JOIN public.team_hub_channels c ON c.id=m.channel_id WHERE m.user_id=:'u5')=ARRAY['general'],
 'seat ended (status): the removed person keeps only the team channel row, not the private one');
SELECT pg_temp.act(:'u2'); SET ROLE authenticated;
SELECT public.team_hub_open_dm(:'ta',:'u4')->>'channel_id' AS dm24 \gset
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'dm24','Before you left','30000000-0000-4000-8000-0000000000b1')->>'ok'='true', 'seat ended: a DM with history');
SELECT pg_temp.act(:'u7');
SELECT public.team_hub_create_channel(:'tb','b-private','private',ARRAY[:'u8']::uuid[],gen_random_uuid())->>'channel_id' AS bprivate \gset
SELECT pg_temp.act(:'u4');
SELECT public.team_hub_create_channel(:'ta','u4-only','private','{}',gen_random_uuid())->>'channel_id' AS u4only \gset
RESET ROLE;
-- Retirement deletes by planned ctids and fires the seat trigger mid-way, so the trigger must
-- never rewrite a channel row.
SELECT string_agg(id::text||'@'||ctid::text||'@'||coalesce(archived_at::text,''),',' ORDER BY id) AS channel_rows_before
 FROM public.team_hub_channels WHERE tenant_id=:'ta' \gset
SELECT count(*) AS u2_private_before FROM public.team_hub_channel_members m JOIN public.team_hub_channels c ON c.id=m.channel_id
 WHERE m.user_id=:'u2' AND c.visibility='private' \gset
-- A status write that leaves the seat active, and a write to another column, change nothing.
UPDATE public.tenant_members SET status='active' WHERE user_id=:'u2' AND tenant_id=:'ta';
UPDATE public.tenant_members SET job_title='Lead Designer' WHERE user_id=:'u2' AND tenant_id=:'ta';
SELECT pg_temp.check((SELECT count(*) FROM public.team_hub_channel_members m JOIN public.team_hub_channels c ON c.id=m.channel_id
  WHERE m.user_id=:'u2' AND c.visibility='private')=:u2_private_before, 'seat ended: an active seat that stays active keeps everything');
DELETE FROM public.tenant_members WHERE user_id=:'u4' AND tenant_id=:'ta';
DELETE FROM public.tenant_members WHERE user_id=:'u8' AND tenant_id=:'ta';
SELECT pg_temp.check((SELECT string_agg(id::text||'@'||ctid::text||'@'||coalesce(archived_at::text,''),',' ORDER BY id)
  FROM public.team_hub_channels WHERE tenant_id=:'ta')=:'channel_rows_before',
 'seat ended: no channel row is rewritten, so a ctid-planned retirement still finds every row');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.team_hub_channel_members WHERE user_id=:'u4' AND channel_id=:'dm24'),
  'seat ended (delete): the DM membership goes with the seat'),
 pg_temp.check(EXISTS(SELECT 1 FROM public.team_hub_channel_members WHERE user_id=:'u8' AND channel_id=:'bprivate'),
  'seat ended: a private channel in another workspace is untouched'),
 pg_temp.check(NOT EXISTS(SELECT 1 FROM public.team_hub_channel_members WHERE channel_id=:'u4only'),
  'seat ended: a private channel left with no members has no one who can reach it');
SELECT pg_temp.check((SELECT count(*) FROM public.tenant_members WHERE user_id IN (:'u4',:'u8') AND tenant_id=:'ta')=0
  AND (SELECT status FROM public.tenant_members WHERE user_id=:'u2' AND tenant_id=:'ta')='active'
  AND (SELECT job_title FROM public.tenant_members WHERE user_id=:'u2' AND tenant_id=:'ta')='Lead Designer',
 'seat ended: tenant_members writes land exactly as issued');
SELECT pg_temp.act(:'u2'); SET ROLE authenticated;
SELECT pg_temp.check((SELECT e->>'dm_user_id'=:'u4' AND e->'member_ids'=jsonb_build_array(:'u2') AND (e->>'member_count')::int=1
   FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e WHERE e->>'id'=:'dm24'),
  'seat ended: the remaining person still sees the DM and who it was with, but not as a member'),
 pg_temp.check(public.team_hub_post_message(:'ta',:'dm24','Hello?',gen_random_uuid(),NULL,ARRAY[:'u4']::uuid[])->>'code'='invalid',
  'seat ended: the person who left cannot be mentioned');
-- Re-invite both, then confirm nothing private came back with the seat.
RESET ROLE;
UPDATE public.tenant_members SET status='active' WHERE user_id=:'u5' AND tenant_id=:'ta';
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,joined_at) VALUES (:'ta',:'u4','member','active','2026-01-04');
SELECT pg_temp.act(:'u5'); SET ROLE authenticated;
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'conversations') e WHERE e->>'id'=:'leads' OR e->>'name'='leads')
  AND (SELECT e->>'joined' FROM jsonb_array_elements(r->'conversations') e WHERE e->>'id'=:'general')='true',
  'reactivated: the private channel stays gone; the team channel is still joined')
FROM (SELECT public.team_hub_list_conversations(:'ta') AS r) x;
SELECT pg_temp.check((pg_temp.codes(:'ta',:'leads'))[4:9]=ARRAY['not_found','not_found','not_found','not_found','not_found','not_found'],
  'reactivated: every door on the private channel is not_found');
SELECT pg_temp.act(:'u4');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e WHERE e->>'id'=:'dm24')
  AND public.team_hub_list_messages(:'ta',:'dm24')->>'code'='not_found', 'reactivated: the DM is not restored by the seat');
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(public.team_hub_open_dm(:'ta',:'u4')->>'channel_id'=:'dm24', 'reactivated: reopening the DM finds the same conversation');
SELECT pg_temp.act(:'u4');
SELECT pg_temp.check(r->>'ok'='true' AND r#>>'{messages,0,body}'='Before you left', 'reactivated: a reopened DM shows its earlier messages again')
FROM (SELECT public.team_hub_list_messages(:'ta',:'dm24') AS r) x;
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check((SELECT (e->>'member_count')::int FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
  WHERE e->>'id'=:'leads')=2, 'reactivated: the private member count did not grow back');
-- Removed and re-invited again, this time with the other person simply writing in the DM they
-- still see: their message reaches the re-invited teammate, who can be mentioned again.
RESET ROLE;
UPDATE public.tenant_members SET status='removed' WHERE user_id=:'u4' AND tenant_id=:'ta';
UPDATE public.tenant_members SET status='active' WHERE user_id=:'u4' AND tenant_id=:'ta';
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.team_hub_channel_members WHERE user_id=:'u4' AND channel_id=:'dm24'),
  'reinvited: the DM membership went with the seat');
SELECT pg_temp.act(:'u2'); SET ROLE authenticated;
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'dm24','Welcome back',gen_random_uuid(),NULL,ARRAY[:'u4']::uuid[])->>'ok'='true',
  'reinvited: writing in the DM restores the other person, who can be mentioned');
SELECT pg_temp.act(:'u4');
SELECT pg_temp.check((SELECT (e->>'unread')::int>=1 FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
  WHERE e->>'id'=:'dm24'), 'reinvited: the DM is back in their list, unread');
SELECT pg_temp.act(:'u2');
\echo 'PASS: a seat that stops being active loses its private channels and DMs in that workspace only; re-inviting restores none; a DM post brings the other person back'

---------------------------------------------------------------------------------------------
-- 5c. A9: an operator archive is a hold, not an ending. Memberships stay while every door
-- refuses the archived seat, and restore brings Team Hub back intact. A held seat that is then
-- removed has ended like any other.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u5');
SELECT public.team_hub_open_dm(:'ta',:'u1')->>'channel_id' AS dm15 \gset
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'dm15','Before the archive','30000000-0000-4000-8000-0000000000d1')->>'ok'='true',
 'archive: a DM with history');
RESET ROLE;
CREATE TEMP TABLE held_before AS
 SELECT channel_id, user_id, added_at, last_read_at FROM public.team_hub_channel_members WHERE tenant_id=:'ta';
SELECT pg_temp.check((SELECT count(*) FROM held_before h JOIN public.team_hub_channels c ON c.id=h.channel_id WHERE c.visibility='private')>=4,
 'archive: the workspace holds private-channel and DM memberships to keep');
-- The statement operator_archive_account issues (20271020000100_operator_archive_delete_authority.sql).
UPDATE public.tenant_members SET status='archived' WHERE tenant_id=:'ta' AND status='active';
SELECT pg_temp.check(NOT EXISTS((SELECT * FROM held_before) EXCEPT ALL
   (SELECT channel_id, user_id, added_at, last_read_at FROM public.team_hub_channel_members WHERE tenant_id=:'ta'))
  AND NOT EXISTS((SELECT channel_id, user_id, added_at, last_read_at FROM public.team_hub_channel_members WHERE tenant_id=:'ta')
   EXCEPT ALL (SELECT * FROM held_before)), 'archive: every membership, private channels and DMs included, is held exactly');
SET ROLE authenticated;
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'leads')=array_fill('not_member'::text,ARRAY[9])
  AND pg_temp.codes(:'ta',:'dm12')=array_fill('not_member'::text,ARRAY[9]), 'archive: an archived seat is not_member from every door');
SELECT pg_temp.act(:'u5');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'dm15')=array_fill('not_member'::text,ARRAY[9]), 'archive: on its DM too');
RESET ROLE;
-- The statement operator_restore_archived_account issues for each saved seat that was active.
UPDATE public.tenant_members SET status='active' WHERE tenant_id=:'ta' AND status='archived';
SELECT pg_temp.check(NOT EXISTS((SELECT * FROM held_before) EXCEPT ALL
   (SELECT channel_id, user_id, added_at, last_read_at FROM public.team_hub_channel_members WHERE tenant_id=:'ta'))
  AND NOT EXISTS((SELECT channel_id, user_id, added_at, last_read_at FROM public.team_hub_channel_members WHERE tenant_id=:'ta')
   EXCEPT ALL (SELECT * FROM held_before)), 'restore: memberships are exactly as they were before the archive');
SET ROLE authenticated;
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check((SELECT e->'member_ids' FROM jsonb_array_elements(r->'conversations') e WHERE e->>'id'=:'leads')=jsonb_build_array(:'u2',:'u3')
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'conversations') e WHERE e->>'id'=:'dm12' AND e->>'joined'='true'),
  'restore: the private channel, its members and the DM are back in the list')
FROM (SELECT public.team_hub_list_conversations(:'ta') AS r) x;
SELECT pg_temp.check(public.team_hub_list_messages(:'ta',:'leads')#>>'{messages,0,body}'='Owner, look', 'restore: the private channel reads again');
SELECT pg_temp.act(:'u5');
SELECT pg_temp.check(public.team_hub_list_messages(:'ta',:'dm15')#>>'{messages,0,body}'='Before the archive', 'restore: the DM and its history are back');
RESET ROLE;
UPDATE public.tenant_members SET status='archived' WHERE tenant_id=:'ta' AND user_id=:'u5';
UPDATE public.tenant_members SET status='removed' WHERE tenant_id=:'ta' AND user_id=:'u5';
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.team_hub_channel_members WHERE user_id=:'u5' AND channel_id=:'dm15')
  AND EXISTS(SELECT 1 FROM public.team_hub_channel_members WHERE user_id=:'u1' AND channel_id=:'dm15'),
 'archive then removal: the removed seat loses the DM; the other person keeps it');
UPDATE public.tenant_members SET status='active' WHERE tenant_id=:'ta' AND user_id=:'u5';
\echo 'PASS: an operator archive holds Team Hub memberships, refuses archived seats, and restore brings them back intact (A9)'

---------------------------------------------------------------------------------------------
-- 5d. Every door that inserts a membership holds the seat it adds (FOR SHARE), so the
-- seat-ended trigger cannot race it. Driven with a second session through dblink.
---------------------------------------------------------------------------------------------
RESET ROLE;
SELECT set_config('fixture.lock_conn', format('dbname=%s user=%s port=%s host=%s application_name=team_hub_lock_probe',
 current_database(), current_user, current_setting('port'),
 coalesce(nullif(btrim(split_part(current_setting('unix_socket_directories'),',',1)),''),'127.0.0.1')), false);
SELECT set_config('fixture.ta',:'ta',false), set_config('fixture.general',:'general',false), set_config('fixture.leads',:'leads',false);
-- (a) While a door's transaction is open, a status change to the seat it added cannot proceed.
DO $$ DECLARE probe record; got text; ta text:=current_setting('fixture.ta'); BEGIN
 PERFORM set_config('lock_timeout','300ms',true);
 FOR probe IN SELECT * FROM (VALUES
  ('join', '10000000-0000-4000-8000-000000000001', format('SELECT public.team_hub_join_channel(%L,%L)::text',ta,current_setting('fixture.general')), '10000000-0000-4000-8000-000000000001'),
  ('post', '10000000-0000-4000-8000-000000000001', format('SELECT public.team_hub_post_message(%L,%L,''lock probe'',gen_random_uuid())::text',ta,current_setting('fixture.general')), '10000000-0000-4000-8000-000000000001'),
  ('open_dm', '10000000-0000-4000-8000-000000000001', format('SELECT public.team_hub_open_dm(%L,%L)::text',ta,'10000000-0000-4000-8000-000000000003'), '10000000-0000-4000-8000-000000000003'),
  ('create_channel', '10000000-0000-4000-8000-000000000001', format('SELECT public.team_hub_create_channel(%L,''lock-probe'',''private'',ARRAY[%L]::uuid[],gen_random_uuid())::text',ta,'10000000-0000-4000-8000-000000000003'), '10000000-0000-4000-8000-000000000003'),
  ('add_members', '10000000-0000-4000-8000-000000000002', format('SELECT public.team_hub_add_members(%L,%L,ARRAY[%L]::uuid[])::text',ta,current_setting('fixture.leads'),'10000000-0000-4000-8000-000000000001'), '10000000-0000-4000-8000-000000000001')
 ) p(door, actor, call, seat) LOOP
  PERFORM fixture.dblink_connect('team_hub_lock_probe',current_setting('fixture.lock_conn'));
  PERFORM fixture.dblink_exec('team_hub_lock_probe','BEGIN');
  PERFORM fixture.dblink_exec('team_hub_lock_probe',format('SET LOCAL request.jwt.claims=%L',
   json_build_object('sub',probe.actor,'role','authenticated')::text));
  PERFORM fixture.dblink_exec('team_hub_lock_probe','SET LOCAL ROLE authenticated');
  SELECT t.r INTO got FROM fixture.dblink('team_hub_lock_probe',probe.call) AS t(r text);
  IF got::jsonb->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FAIL: seat lock probe %: the door refused: %', probe.door, got; END IF;
  BEGIN
   UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=ta::uuid AND user_id=probe.seat::uuid;
   RAISE EXCEPTION 'FAIL: seat lock: % did not hold the seat it added; a concurrent status change went through', probe.door;
  EXCEPTION WHEN lock_not_available THEN NULL; END;
  PERFORM fixture.dblink_exec('team_hub_lock_probe','ROLLBACK');
  PERFORM fixture.dblink_disconnect('team_hub_lock_probe');
 END LOOP;
END $$;
-- (b) A seat suspended while the door waits on it fails the re-check under the lock: refused,
-- and no membership lands for a seat the trigger already processed.
BEGIN;
UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=:'ta' AND user_id=:'u4';
SELECT fixture.dblink_connect('team_hub_race_probe',current_setting('fixture.lock_conn'));
SELECT fixture.dblink_exec('team_hub_race_probe',format('SET request.jwt.claims=%L',
 json_build_object('sub',:'u2','role','authenticated')::text));
SELECT fixture.dblink_exec('team_hub_race_probe','SET ROLE authenticated');
SELECT set_config('fixture.race_pid',(SELECT t.pid::text FROM fixture.dblink('team_hub_race_probe','SELECT pg_backend_pid()') AS t(pid int)),false);
SELECT fixture.dblink_send_query('team_hub_race_probe',
 format('SELECT public.team_hub_add_members(%L,%L,ARRAY[%L]::uuid[])::text',:'ta',:'leads',:'u4'));
DO $$ DECLARE waited boolean:=false; BEGIN
 FOR i IN 1..250 LOOP
  IF EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=current_setting('fixture.race_pid')::int AND NOT l.granted) THEN waited:=true; EXIT; END IF;
  PERFORM pg_sleep(0.02);
 END LOOP;
 IF NOT waited THEN RAISE EXCEPTION 'FAIL: seat lock: add_members did not wait on a seat being changed'; END IF;
END $$;
COMMIT;
SELECT t.r AS race_result FROM fixture.dblink_get_result('team_hub_race_probe') AS t(r text) \gset
SELECT fixture.dblink_disconnect('team_hub_race_probe');
SELECT pg_temp.check((:'race_result')::jsonb->>'code'='invalid', 'seat lock: a seat suspended while the door waited is refused'),
 pg_temp.check(NOT EXISTS(SELECT 1 FROM public.team_hub_channel_members WHERE user_id=:'u4' AND channel_id=:'leads'),
  'seat lock: no membership lands for the suspended seat');
UPDATE public.tenant_members SET status='active' WHERE tenant_id=:'ta' AND user_id=:'u4';
\echo 'PASS: join, post, open_dm, create_channel and add_members hold the seats they add; a seat changed meanwhile is refused'

---------------------------------------------------------------------------------------------
-- 6. Agency, operator, no-identity and anonymous callers are refused.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u9');
SELECT pg_temp.check(public.current_user_tenant_id()=:'ta', 'agency: the real resolver does admit the agency into A');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general')=array_fill('not_member'::text,ARRAY[9]), 'agency: refused by every door');
SELECT pg_temp.act(:'u10');
SELECT pg_temp.check(public.current_user_tenant_id()=:'ta', 'operator: the real resolver does admit the operator into A');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general')=array_fill('not_member'::text,ARRAY[9]), 'operator: refused by every door');
SELECT pg_temp.act(NULL);
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general')=array_fill('not_member'::text,ARRAY[9]), 'no identity: refused by every door');
RESET ROLE; SET ROLE anon;
SELECT pg_temp.check(pg_temp.denied(format(s,:'ta',:'general')), 'anon: no EXECUTE on '||s)
FROM unnest(ARRAY[
 'SELECT public.team_hub_list_conversations(%L)',
 'SELECT public.team_hub_create_channel(%L,''x1'',''team'',''{}'',gen_random_uuid()) WHERE %L IS NOT NULL',
 'SELECT public.team_hub_open_dm(%L,%L)',
 'SELECT public.team_hub_join_channel(%L,%L)',
 'SELECT public.team_hub_leave_channel(%L,%L)',
 'SELECT public.team_hub_add_members(%L,%L,''{}'')',
 'SELECT public.team_hub_list_messages(%L,%L)',
 'SELECT public.team_hub_post_message(%L,%L,''hi'',gen_random_uuid())',
 'SELECT public.team_hub_mark_read(%L,%L,gen_random_uuid())']) s;
\echo 'PASS: agency, operator, no-identity and anonymous callers are refused'

---------------------------------------------------------------------------------------------
-- 6b. A1: only a canonical SOLO workspace opens Team Hub. Refusal order is not_member, then
-- unavailable, then scope_changed.
---------------------------------------------------------------------------------------------
RESET ROLE; SELECT pg_temp.act(:'u11'); SET ROLE authenticated;
SELECT pg_temp.check(public.current_user_tenant_id()=:'tc', 'sub-account: the resolver lands the owner in C');
SELECT pg_temp.check(pg_temp.codes(:'tc',:'general')=array_fill('unavailable'::text,ARRAY[9]),
  'sub-account: a legacy standalone-typed child of an agency is unavailable from every door');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general')=array_fill('unavailable'::text,ARRAY[9]),
  'order: unavailable comes before scope_changed');
SELECT pg_temp.act(:'u12');
SELECT pg_temp.check(pg_temp.codes(:'td',:'general')=array_fill('unavailable'::text,ARRAY[9]), 'agency: an agency workspace is unavailable');
RESET ROLE; UPDATE public.profiles SET active_tenant_id=:'tc' WHERE user_id=:'u12'; SET ROLE authenticated;
SELECT pg_temp.check(public.current_user_tenant_id()=:'tc'
  AND pg_temp.codes(:'tc',:'general')=array_fill('unavailable'::text,ARRAY[9]),
  'agency: the manager''s seat inside the sub-account does not open Team Hub');
SELECT pg_temp.act(:'u13');
SELECT pg_temp.check(pg_temp.codes(:'tc',:'general')=array_fill('not_member'::text,ARRAY[9]), 'order: not_member comes before unavailable');
RESET ROLE;
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.team_hub_channels WHERE tenant_id IN (:'tc',:'td')),
  'unavailable: no door wrote anything in a non-SOLO workspace');
\echo 'PASS: Agency and Sub-account workspaces are unavailable; refusal order is not_member, unavailable, scope_changed'
SET ROLE anon;

---------------------------------------------------------------------------------------------
-- 7. Direct table access by authenticated (and anon) is refused.
---------------------------------------------------------------------------------------------
SELECT pg_temp.check(pg_temp.denied(format('SELECT 1 FROM public.%I',t)), 'anon: cannot read '||t)
FROM unnest(ARRAY['team_hub_channels','team_hub_channel_members','team_hub_messages','team_hub_message_mentions']) t;
RESET ROLE; SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.denied(format('SELECT 1 FROM public.%I',t)), 'authenticated: cannot read '||t),
 pg_temp.check(pg_temp.denied(format('DELETE FROM public.%I',t)), 'authenticated: cannot delete '||t)
FROM unnest(ARRAY['team_hub_channels','team_hub_channel_members','team_hub_messages','team_hub_message_mentions']) t;
SELECT pg_temp.check(pg_temp.denied(format('INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id) VALUES (%L,%L,%L,''x'',gen_random_uuid())',
  :'ta',:'general',:'u1')), 'authenticated: cannot insert a message directly'),
 pg_temp.check(pg_temp.denied(format('UPDATE public.team_hub_channel_members SET last_read_at=now() WHERE channel_id=%L',:'general')),
  'authenticated: cannot update membership directly');
\echo 'PASS: direct table reads and writes by authenticated and anon are refused'

---------------------------------------------------------------------------------------------
-- 8. A3: names are unique among team-visible channels only. A private name never collides,
-- so probing one never answers name_taken.
---------------------------------------------------------------------------------------------
RESET ROLE; SELECT pg_temp.act(:'u2'); SET ROLE authenticated;
SELECT public.team_hub_create_channel(:'ta','roadmap','private',ARRAY[:'u3']::uuid[],gen_random_uuid())->>'channel_id' AS roadmap_a \gset
SELECT pg_temp.act(:'u4');
SELECT public.team_hub_create_channel(:'ta','roadmap','private','{}',gen_random_uuid()) AS r \gset probe_
SELECT pg_temp.check(r->>'ok'='true' AND r->>'channel_id'<>:'roadmap_a', 'names: a second private channel may share a private name')
FROM (SELECT (:'probe_r')::jsonb AS r) x;
SELECT (:'probe_r')::jsonb->>'channel_id' AS roadmap_b \gset
SELECT pg_temp.check(public.team_hub_create_channel(:'ta','roadmap','private','{}',gen_random_uuid())->>'channel_id'=:'roadmap_b',
  'names: a private retry by the same creator within 60 seconds returns the same channel'),
 pg_temp.check(public.team_hub_create_channel(:'ta','leads','private','{}',gen_random_uuid())->>'ok'='true',
  'names: probing another team''s private name never returns name_taken');
SELECT public.team_hub_create_channel(:'ta','roadmap','team','{}',gen_random_uuid())->>'channel_id' AS roadmap_team \gset
SELECT pg_temp.check(:'roadmap_team' NOT IN (:'roadmap_a',:'roadmap_b'), 'names: a private name does not reserve the team name');
SELECT pg_temp.act(:'u3');
SELECT pg_temp.check(public.team_hub_create_channel(:'ta','roadmap','team','{}',gen_random_uuid())->>'code'='name_taken',
  'names: a team name is taken for another team channel'),
 pg_temp.check(public.team_hub_create_channel(:'ta','general','private','{}',gen_random_uuid())->>'ok'='true',
  'names: a private channel may carry a team channel''s name');
\echo 'PASS: team-visible names are unique; private names repeat and never answer name_taken'

---------------------------------------------------------------------------------------------
-- 9. A5: the last member out of a private channel archives it.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u4');
SELECT pg_temp.check(public.team_hub_leave_channel(:'ta',:'roadmap_b')->>'ok'='true', 'last member: leaves');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
  WHERE e->>'id'=:'roadmap_b'), 'last member: the channel is gone from the list');
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(public.team_hub_leave_channel(:'ta',:'roadmap_a')->>'ok'='true', 'not last: one of two leaves');
RESET ROLE;
SELECT pg_temp.check((SELECT archived_at IS NOT NULL FROM public.team_hub_channels WHERE id=:'roadmap_b'),
  'last member: the empty private channel is archived'),
 pg_temp.check((SELECT archived_at IS NULL FROM public.team_hub_channels WHERE id=:'roadmap_a')
  AND (SELECT archived_at IS NULL FROM public.team_hub_channels WHERE id=:'leads'), 'not last: a private channel with members stays open');
\echo 'PASS: the last member leaving a private channel archives it; others stay open'

---------------------------------------------------------------------------------------------
-- 10. An archived channel or DM is not_found from every door and absent from the list.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT public.team_hub_create_channel(:'ta','archive-me','team','{}',gen_random_uuid())->>'channel_id' AS gone \gset
SELECT public.team_hub_open_dm(:'ta',:'u3')->>'channel_id' AS gonedm \gset
SELECT public.team_hub_post_message(:'ta',:'gone','Last words','30000000-0000-4000-8000-0000000000c1')#>>'{message,id}' AS gone_m \gset
SELECT public.team_hub_post_message(:'ta',:'gonedm','Last words too','30000000-0000-4000-8000-0000000000c2')->>'ok' AS ignored \gset
RESET ROLE;
UPDATE public.team_hub_channels SET archived_at=now() WHERE id IN (:'gone',:'gonedm');
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.team_hub_list_conversations(:'ta')->'conversations') e
  WHERE e->>'id' IN (:'gone',:'gonedm') OR e->>'name'='archive-me'), 'archived: neither the channel nor the DM is listed');
SELECT pg_temp.check((pg_temp.codes(:'ta',c::uuid))[4:9]=ARRAY['not_found','not_found','not_found','not_found','not_found','not_found'],
  'archived: every door is not_found on '||c)
FROM unnest(ARRAY[:'gone',:'gonedm']) c;
SELECT pg_temp.check(public.team_hub_open_dm(:'ta',:'u3')->>'code'='not_found', 'archived: reopening the DM is not_found'),
 pg_temp.check(public.team_hub_list_messages(:'ta',:'gone',:'gone_m')->>'code'='not_found', 'archived: its threads are not_found'),
 pg_temp.check(public.team_hub_post_message(:'ta',:'gone','Last words','30000000-0000-4000-8000-0000000000c1')->>'code'='not_found',
  'archived: a retry into it is not_found, not a duplicate success');
\echo 'PASS: archived channels and DMs are not_found from every door and absent from the list'

---------------------------------------------------------------------------------------------
-- 11. A6/A7: the compound cursor loses nothing when rows share a created_at, at the top level
-- and in a thread, and a thread pages newest first with has_more.
---------------------------------------------------------------------------------------------
SELECT public.team_hub_create_channel(:'ta','cursor-test','team','{}',gen_random_uuid())->>'channel_id' AS cur \gset
RESET ROLE;
INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,created_at)
SELECT :'ta',:'cur',:'u1','tie '||n,gen_random_uuid(),'2026-10-01 12:00:00+00' FROM generate_series(1,5) n;
INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,parent_message_id,client_request_id,created_at)
SELECT :'ta',:'cur',:'u2','reply '||n,(SELECT id FROM public.team_hub_messages WHERE channel_id=:'cur' ORDER BY id LIMIT 1),gen_random_uuid(),
 CASE WHEN n<=3 THEN timestamptz '2026-10-01 13:00:00+00' ELSE timestamptz '2026-10-01 12:30:00+00' END FROM generate_series(1,5) n;
SELECT id AS cur_root FROM public.team_hub_messages WHERE channel_id=:'cur' AND parent_message_id IS NULL ORDER BY id LIMIT 1 \gset
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT set_config('fixture.ta',:'ta',false), set_config('fixture.cur',:'cur',false), set_config('fixture.cur_root',:'cur_root',false);
CREATE TEMP TABLE pages(mode text, page int, ids text[], has_more boolean);
DO $$ DECLARE r jsonb; b timestamptz; bid uuid; page int; mode text; root uuid;
BEGIN
 FOREACH mode IN ARRAY ARRAY['top','thread'] LOOP
  b:=NULL; bid:=NULL; page:=0;
  root:=CASE WHEN mode='thread' THEN current_setting('fixture.cur_root')::uuid END;
  LOOP
   page:=page+1;
   r:=public.team_hub_list_messages(current_setting('fixture.ta')::uuid,current_setting('fixture.cur')::uuid,root,b,bid,2);
   IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'FAIL: cursor page refused: %', r; END IF;
   IF mode='thread' AND r#>>'{root,id}' IS DISTINCT FROM root::text THEN RAISE EXCEPTION 'FAIL: thread page without its root'; END IF;
   INSERT INTO pages SELECT mode,page,ARRAY(SELECT e->>'id' FROM jsonb_array_elements(r->'messages') e),(r->>'has_more')::boolean;
   EXIT WHEN NOT (r->>'has_more')::boolean OR page>10;
   b:=(r#>>'{messages,-1,created_at}')::timestamptz; bid:=(r#>>'{messages,-1,id}')::uuid;
  END LOOP;
 END LOOP;
END $$;
RESET ROLE;
SELECT pg_temp.check((SELECT array_agg(cardinality(ids) ORDER BY page) FROM pages WHERE mode='top')=ARRAY[2,2,1]
  AND (SELECT array_agg(has_more ORDER BY page) FROM pages WHERE mode='top')=ARRAY[true,true,false],
 'cursor: five top-level messages sharing one created_at page as 2, 2, 1');
SELECT pg_temp.check((SELECT array_agg(i ORDER BY i) FROM pages, unnest(ids) i WHERE mode='top')
  =(SELECT array_agg(id::text ORDER BY id::text) FROM public.team_hub_messages WHERE channel_id=:'cur' AND parent_message_id IS NULL),
 'cursor: every top-level message appears exactly once across the pages');
SELECT pg_temp.check((SELECT array_agg(i ORDER BY page, o) FROM pages, unnest(ids) WITH ORDINALITY u(i,o) WHERE mode='thread')
  =(SELECT array_agg(id::text ORDER BY created_at DESC, id DESC) FROM public.team_hub_messages WHERE parent_message_id=:'cur_root'),
 'thread: every reply exactly once, newest first, across the pages (A7)'),
 pg_temp.check((SELECT array_agg(has_more ORDER BY page) FROM pages WHERE mode='thread')=ARRAY[true,true,false],
 'thread: has_more until the oldest reply');
\echo 'PASS: the compound cursor pages ties without loss; threads page newest first with has_more'

---------------------------------------------------------------------------------------------
-- 12. Deleting a workspace still cascades cleanly through the seat-ended trigger.
---------------------------------------------------------------------------------------------
DELETE FROM public.tenants WHERE id=:'tb';
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=:'tb')
  AND NOT EXISTS(SELECT 1 FROM public.team_hub_channels WHERE tenant_id=:'tb')
  AND NOT EXISTS(SELECT 1 FROM public.team_hub_channel_members WHERE tenant_id=:'tb'), 'delete: a workspace and its Team Hub go together');
\echo 'PASS: deleting a workspace cascades through tenant_members and Team Hub without error'

RESET ROLE;
\o
\c postgres
DROP DATABASE exp08_team_hub_proof;
\echo 'PASS: EXP08 Team Hub increment 1 storage and isolation proof complete; disposable database dropped'
