-- EXP08 Team Hub: read and search performance (migration 20271114250008) changes NO behaviour.
-- The shipped team_hub_list_messages and team_hub_search are called across a matrix of actors,
-- conversations, thread roots, cursors, limits and queries; their exact JSON is recorded; the
-- performance migration is applied; the same calls must return byte-identical JSON. Then, on a
-- larger fixture, the two new indexes must actually serve the reads, and neither indexes text.
-- Measurements behind the change: Linear ANT-161, 2026-10-25 (AWS assessment).
-- Disposable PostgreSQL only; the fixture is the search proof's, unchanged.
\set QUIET on
\set ON_ERROR_STOP on
DROP DATABASE IF EXISTS exp08_team_hub_read_perf_proof;
CREATE DATABASE exp08_team_hub_read_perf_proof;
\c exp08_team_hub_read_perf_proof
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

-- DOUBLES. is_platform_owner stands for the platform operator, which the permissive comms
-- policies admit to every tenant's folder; is_tenant_member is an active seat only.
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' AS $$ SELECT EXISTS(SELECT 1 FROM public.fixture_platform_admins WHERE user_id=auth.uid()) $$;
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
-- The canonical Operations core, abridged exactly as in the increment 2 proof.
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

-- STUB of Supabase Storage: the shipped columns, index, RLS and grants, and foldername's body.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(
 id text NOT NULL PRIMARY KEY, name text NOT NULL, owner uuid,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
 public boolean DEFAULT false, avif_autodetection boolean DEFAULT false,
 file_size_limit bigint, allowed_mime_types text[], owner_id text);
CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);
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

-- Verbatim from 20260726211000_comms_c15_scheduled_drainer.sql §4.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comms-attachments', 'comms-attachments', false, 10485760,
  array['image/jpeg','image/jpg','image/png','image/webp','image/gif',
        'application/pdf','text/plain','text/csv',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update set
  public = false, file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "comms_attach member read" on storage.objects;
create policy "comms_attach member read" on storage.objects
  for select to authenticated using (
    bucket_id = 'comms-attachments'
    and (public.is_platform_owner() or public.is_tenant_member(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "comms_attach member upload" on storage.objects;
create policy "comms_attach member upload" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'comms-attachments'
    and (public.is_platform_owner() or public.is_tenant_member(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "comms_attach member update" on storage.objects;
create policy "comms_attach member update" on storage.objects
  for update to authenticated using (
    bucket_id = 'comms-attachments'
    and (public.is_platform_owner() or public.is_tenant_member(((storage.foldername(name))[1])::uuid))
  );

drop policy if exists "comms_attach member delete" on storage.objects;
create policy "comms_attach member delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'comms-attachments'
    and (public.is_platform_owner() or public.is_tenant_member(((storage.foldername(name))[1])::uuid))
  );

-- Workspaces A and B are canonical SOLO. D is an agency; C is its sub-account. Synthetic people.
INSERT INTO public.tenants(id,name,account_type,parent_tenant_id) VALUES
 ('20000000-0000-4000-8000-00000000000a','Workspace A','standalone',NULL),
 ('20000000-0000-4000-8000-00000000000b','Workspace B','standalone',NULL),
 ('20000000-0000-4000-8000-00000000000d','Agency D','agency',NULL),
 ('20000000-0000-4000-8000-00000000000c','Sub-account C','standalone','20000000-0000-4000-8000-00000000000d');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 -- u1 owner, u2 member, u3 admin, u5 member, u6 suspended; u7 owns B; u8 sits in A and B.
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000001','owner','active',true,'2026-01-01'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000002','member','active',false,'2026-01-02'),
 ('20000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-000000000003','admin','active',false,'2026-01-03'),
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
INSERT INTO public.fixture_global_roles VALUES ('10000000-0000-4000-8000-000000000001','admin');
-- The canonical retirement policy, abridged exactly as in the earlier Team Hub proofs.
CREATE OR REPLACE FUNCTION public.operator_retirement_disposition(_table text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN _table=ANY(ARRAY['growth_public_visits',
 'tenants','tenant_members','calendars','programs','program_approvals'
 ]) THEN 'delete' WHEN _table=ANY(ARRAY['profiles','paige_audit_log','platform_subscriptions','platform_usage_events','paige_llm_trace','paige_voice_cost_reservations']) THEN 'preserve' ELSE 'blocked' END
$$;
REVOKE ALL ON FUNCTION public.operator_retirement_disposition(text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

-- The REAL Operations wrapper, unchanged, so team_hub_request_task can be driven.
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
   OR NOT has_function_privilege('anon','public.fixture_default_probe_fn()','EXECUTE')
   OR NOT has_function_privilege('service_role','public.fixture_default_probe_fn()','EXECUTE') THEN
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
\set u5 '10000000-0000-4000-8000-000000000005'
\set u6 '10000000-0000-4000-8000-000000000006'
\set u7 '10000000-0000-4000-8000-000000000007'
\set u8 '10000000-0000-4000-8000-000000000008'
\set u9 '10000000-0000-4000-8000-000000000009'
\set u10 '10000000-0000-4000-8000-000000000010'
\set u11 '10000000-0000-4000-8000-000000000011'
\set u12 '10000000-0000-4000-8000-000000000012'
\set pdf 'application/pdf'

\ir ../migrations/20271113850008_exp08_team_hub_collaboration.sql
\ir ../migrations/20271113860008_exp08_team_hub_team_work.sql
\ir ../migrations/20271114160008_exp08_team_hub_files.sql

-- What increments 1 to 3 own, so the search migration can be shown to add no table, column,
-- index, trigger, policy or storage, and to change no other function.
CREATE TEMP VIEW search_state AS
SELECT 'rel:'||c.relname AS k, concat_ws('|', c.relkind::text, c.relacl::text, c.relrowsecurity::text,
  (SELECT string_agg(a.attname||':'||a.atttypid::regtype::text, ',' ORDER BY a.attnum) FROM pg_attribute a
   WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) AS v
FROM pg_class c WHERE c.relnamespace IN ('public'::regnamespace,'storage'::regnamespace)
UNION ALL SELECT 'policy:'||p.polrelid::regclass::text||'.'||p.polname, pg_get_expr(p.polqual,p.polrelid) FROM pg_policy p
UNION ALL SELECT 'trigger:'||t.tgrelid::regclass::text||'.'||t.tgname, pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE NOT t.tgisinternal
UNION ALL SELECT 'fn:'||p.oid::regprocedure::text, concat_ws('|', p.proacl::text, md5(p.prosrc))
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname NOT IN ('team_hub_search','_team_hub_search_snippet');
CREATE TEMP TABLE search_before AS SELECT * FROM search_state;
\ir ../migrations/20271114240008_exp08_team_hub_search.sql
CREATE TEMP TABLE search_once AS
SELECT p.oid::regprocedure::text AS k, concat_ws('|', p.proacl::text, p.prosecdef::text, p.proconfig::text, p.provolatile::text, md5(p.prosrc)) AS v
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('team_hub_search','_team_hub_search_snippet');
\ir ../migrations/20271114240008_exp08_team_hub_search.sql
DO $$ BEGIN
 IF EXISTS(SELECT k,v FROM search_before EXCEPT SELECT k,v FROM search_state)
   OR EXISTS(SELECT k,v FROM search_state EXCEPT SELECT k,v FROM search_before) THEN
  RAISE EXCEPTION 'FAIL: the search migration added or changed a relation, column, policy, trigger or another function'; END IF;
 IF (SELECT count(*) FROM search_once)<>2 THEN RAISE EXCEPTION 'FAIL: expected exactly the search door and its snippet helper'; END IF;
 IF EXISTS(SELECT k,v FROM search_once EXCEPT SELECT p.oid::regprocedure::text, concat_ws('|', p.proacl::text, p.prosecdef::text,
     p.proconfig::text, p.provolatile::text, md5(p.prosrc))
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('team_hub_search','_team_hub_search_snippet')) THEN
  RAISE EXCEPTION 'FAIL: a second apply of the search migration changed the door or its helper'; END IF;
END $$;
\echo 'PASS: the search migration adds one door and one internal helper, nothing else; a second apply is a no-op'

-- Structural floor, under Supabase's default privileges.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.team_hub_search(uuid,text,int)'::regprocedure AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=""'] AND p.prorettype='jsonb'::regtype AND p.provolatile='s' AND p.pronargdefaults=1
   AND pg_get_function_arguments(p.oid)='p_expected_tenant uuid, p_query text, p_limit integer DEFAULT 20') THEN
  RAISE EXCEPTION 'FAIL: team_hub_search is not a STABLE jsonb SECURITY DEFINER door with search_path='''' and p_limit DEFAULT 20'; END IF;
 IF NOT has_function_privilege('authenticated','public.team_hub_search(uuid,text,int)','EXECUTE')
   OR has_function_privilege('anon','public.team_hub_search(uuid,text,int)','EXECUTE')
   OR has_function_privilege('service_role','public.team_hub_search(uuid,text,int)','EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid='public.team_hub_search(uuid,text,int)'::regprocedure
    AND a.grantee=0) THEN
  RAISE EXCEPTION 'FAIL: team_hub_search is not executable by authenticated only'; END IF;
 IF has_function_privilege('authenticated','public._team_hub_search_snippet(text,text)','EXECUTE')
   OR has_function_privilege('anon','public._team_hub_search_snippet(text,text)','EXECUTE')
   OR has_function_privilege('service_role','public._team_hub_search_snippet(text,text)','EXECUTE')
   OR (SELECT prosecdef FROM pg_proc WHERE oid='public._team_hub_search_snippet(text,text)'::regprocedure) THEN
  RAISE EXCEPTION 'FAIL: the snippet helper is reachable by a role or runs as definer'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '\_team\_hub\_%'
   AND p.proname NOT IN ('_team_hub_file_can_upload','_team_hub_file_can_read')
   AND (has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE'))) THEN
  RAISE EXCEPTION 'FAIL: an internal Team Hub helper is callable by a browser role'; END IF;
 IF (SELECT prosrc FROM pg_proc WHERE oid='public.team_hub_search(uuid,text,int)'::regprocedure) ILIKE '%is_tenant_member%' THEN
  RAISE EXCEPTION 'FAIL: the search door uses is_tenant_member, which admits operators'; END IF;
END $$;
\echo 'PASS: team_hub_search is a STABLE jsonb SECURITY DEFINER door for authenticated only (not anon, PUBLIC or the service role); its snippet helper is unreachable'

-- Session helpers. Each RPC is still its own statement.
CREATE FUNCTION pg_temp.act(u text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', CASE WHEN u IS NULL THEN '{"role":"authenticated"}'
  ELSE json_build_object('sub',u,'role','authenticated')::text END, false); END $$;
CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.denied(statement text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE statement; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
-- The message ids of a search result, in the order returned.
CREATE FUNCTION pg_temp.ids(r jsonb) RETURNS uuid[] LANGUAGE sql AS $$
 SELECT CASE WHEN r->>'ok'='true' THEN coalesce((SELECT array_agg((e->>'message_id')::uuid ORDER BY o)
  FROM jsonb_array_elements(r->'results') WITH ORDINALITY x(e,o)),'{}'::uuid[]) END $$;
-- The same members, ignoring order.
CREATE FUNCTION pg_temp.same(a uuid[], b uuid[]) RETURNS boolean LANGUAGE sql AS $$
 SELECT a IS NOT NULL AND b IS NOT NULL AND (SELECT coalesce(array_agg(x ORDER BY x),'{}') FROM unnest(a) x)
  =(SELECT coalesce(array_agg(x ORDER BY x),'{}') FROM unnest(b) x) $$;
CREATE FUNCTION pg_temp.hit(r jsonb, m uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT e FROM jsonb_array_elements(r->'results') e WHERE (e->>'message_id')::uuid=m $$;
-- Everything a request could leave behind, in one comparable value. As the database owner.
CREATE FUNCTION pg_temp.stored() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
 SELECT concat_ws('/', (SELECT count(*) FROM public.team_hub_messages), (SELECT count(*) FROM public.team_hub_channels),
  (SELECT string_agg(channel_id::text||user_id::text||coalesce(last_read_at::text,'-'), ',' ORDER BY channel_id, user_id)
   FROM public.team_hub_channel_members),
  (SELECT count(*) FROM public.team_hub_message_mentions), (SELECT count(*) FROM public.team_hub_files)) $$;
\set q 'venue deposit'

---------------------------------------------------------------------------------------------
-- 1. Conversations in workspace A: #general (team), #leads (private: u1, u2), a DM between u1
--    and u2. Workspace B: #b-general. One matching message in each.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT public.team_hub_create_channel(:'ta','general','team','{}',gen_random_uuid())->>'channel_id' AS general \gset
SELECT public.team_hub_create_channel(:'ta','leads','private',ARRAY[:'u2']::uuid[],gen_random_uuid())->>'channel_id' AS leads \gset
SELECT public.team_hub_open_dm(:'ta',:'u2')->>'channel_id' AS dm12 \gset
SELECT public.team_hub_post_message(:'ta',:'general','Pay the venue deposit by Friday',gen_random_uuid())#>>'{message,id}' AS m_gen \gset
SELECT public.team_hub_post_message(:'ta',:'dm12','Between us: the Venue Deposit came from savings',gen_random_uuid())#>>'{message,id}' AS m_dm \gset
SELECT pg_temp.act(:'u2');
SELECT public.team_hub_post_message(:'ta',:'leads','Leads only: the venue deposit is negotiable',gen_random_uuid())#>>'{message,id}' AS m_leads \gset
SELECT pg_temp.act(:'u7');
SELECT public.team_hub_create_channel(:'tb','b-general','team','{}',gen_random_uuid())->>'channel_id' AS bgeneral \gset
SELECT public.team_hub_post_message(:'tb',:'bgeneral','Workspace B also owes a venue deposit',gen_random_uuid())#>>'{message,id}' AS m_b \gset
RESET ROLE;
SELECT pg_temp.check(:'m_gen' IS NOT NULL AND :'m_dm' IS NOT NULL AND :'m_leads' IS NOT NULL AND :'m_b' IS NOT NULL
  AND :'leads' IS NOT NULL AND :'dm12' IS NOT NULL, 'fixture: every conversation and message was created');


---------------------------------------------------------------------------------------------
-- 2. A richer fixture, written by the database owner: long streams, ties on created_at, threads,
--    a deleted message, a deleted thread root with replies, and replies under a live root.
---------------------------------------------------------------------------------------------
INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,created_at)
SELECT :'ta'::uuid, :'general'::uuid, CASE WHEN g%3=0 THEN :'u2'::uuid ELSE :'u1'::uuid END,
 CASE WHEN g%97=0 THEN 'About the venue deposit, note '||g ELSE 'Status note '||g END,
 gen_random_uuid(), timestamptz '2027-01-01' + make_interval(secs=>(g/4)) FROM generate_series(1,3000) g;
INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,created_at)
SELECT :'ta'::uuid, :'leads'::uuid, :'u2'::uuid, 'Leads venue deposit thread '||g, gen_random_uuid(),
 timestamptz '2027-01-01' + make_interval(secs=>g) FROM generate_series(1,400) g;
INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,created_at)
SELECT :'ta'::uuid, :'dm12'::uuid, :'u1'::uuid, 'DM status '||g, gen_random_uuid(),
 timestamptz '2027-01-01' + make_interval(secs=>g) FROM generate_series(1,150) g;
INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,created_at)
SELECT :'tb'::uuid, :'bgeneral'::uuid, :'u7'::uuid, 'B status venue deposit '||g, gen_random_uuid(),
 timestamptz '2027-01-01' + make_interval(secs=>g) FROM generate_series(1,200) g;
-- Threads: three live roots in #general with 40 replies each (some tied), one deleted root with replies.
CREATE TEMP TABLE roots AS SELECT id FROM public.team_hub_messages
 WHERE channel_id=:'general' AND parent_message_id IS NULL ORDER BY created_at DESC, id DESC LIMIT 4;
INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,parent_message_id,client_request_id,created_at)
SELECT :'ta'::uuid, :'general'::uuid, :'u2'::uuid, 'Reply status '||g||' venue deposit', r.id, gen_random_uuid(),
 timestamptz '2027-02-01' + make_interval(secs=>(g/2)) FROM roots r, generate_series(1,40) g;
UPDATE public.team_hub_messages SET deleted_at=now() WHERE id=(SELECT id FROM roots ORDER BY id LIMIT 1);
UPDATE public.team_hub_messages SET deleted_at=now()
 WHERE id IN (SELECT id FROM public.team_hub_messages WHERE channel_id=:'general' AND parent_message_id IS NULL
  ORDER BY created_at DESC, id DESC OFFSET 7 LIMIT 3);
-- A deleted reply under a live root, so the thread page must still leave deleted replies out.
UPDATE public.team_hub_messages SET deleted_at=now()
 WHERE id IN (SELECT id FROM public.team_hub_messages WHERE parent_message_id=(SELECT id FROM roots ORDER BY id OFFSET 1 LIMIT 1)
  ORDER BY created_at DESC, id DESC OFFSET 1 LIMIT 2);
-- A teammate whose seat is no longer active (u6 is suspended): their #general messages and a DM
-- with them, so both 'Former teammate' labels are part of the recorded output.
INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,created_at)
SELECT :'ta'::uuid, :'general'::uuid, :'u6'::uuid, 'Former author venue deposit '||g, gen_random_uuid(),
 timestamptz '2027-01-01' + make_interval(secs=>g*7) FROM generate_series(1,20) g;
INSERT INTO public.team_hub_channels(tenant_id,kind,visibility,dm_key,created_by)
 VALUES (:'ta','dm','private',least(:'u1'::uuid,:'u6'::uuid)::text||':'||greatest(:'u1'::uuid,:'u6'::uuid)::text,:'u1')
 RETURNING id AS dm16 \gset
INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by)
 VALUES (:'dm16',:'ta',:'u1',:'u1'),(:'dm16',:'ta',:'u6',:'u1');
INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,created_at)
SELECT :'ta'::uuid, :'dm16'::uuid, CASE WHEN g%2=0 THEN :'u6'::uuid ELSE :'u1'::uuid END, 'Former DM venue deposit '||g,
 gen_random_uuid(), timestamptz '2027-01-01' + make_interval(secs=>g) FROM generate_series(1,30) g;
-- An archived channel with messages: nobody may open or search it.
INSERT INTO public.team_hub_channels(tenant_id,kind,name,visibility,created_by,archived_at)
 VALUES (:'ta','channel','old-ops','team',:'u1',now()) RETURNING id AS archived \gset
INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,created_at)
SELECT :'ta'::uuid, :'archived'::uuid, :'u1'::uuid, 'Archived venue deposit '||g, gen_random_uuid(),
 timestamptz '2027-01-01' + make_interval(secs=>g) FROM generate_series(1,25) g;
ANALYZE public.team_hub_messages;

CREATE FUNCTION pg_temp.reply_cursor(n int) RETURNS text LANGUAGE sql AS $$
 SELECT quote_literal(created_at)||'::timestamptz,'||quote_literal(id)||'::uuid' FROM public.team_hub_messages
  WHERE parent_message_id=(SELECT id FROM roots ORDER BY id OFFSET 1 LIMIT 1)
  ORDER BY created_at DESC, id DESC OFFSET n LIMIT 1 $$;
-- The call matrix, as (key, sql) rows. Every call is made as the database owner with the actor's
-- claims set: both functions are SECURITY DEFINER and read the actor only from auth.uid().
CREATE TEMP TABLE calls(k text PRIMARY KEY, actor text, q text);
INSERT INTO calls
SELECT format('list a=%s ch=%s root=%s cur=%s lim=%s', a, ch, rt, cur, lim), a,
 format('SELECT public.team_hub_list_messages(%L,%L,%s,%s,%s)', CASE WHEN ch='bgeneral' THEN :'tb' ELSE :'ta' END,
  CASE ch WHEN 'general' THEN :'general' WHEN 'leads' THEN :'leads' WHEN 'dm12' THEN :'dm12' WHEN 'bgeneral' THEN :'bgeneral'
   WHEN 'dm16' THEN :'dm16' WHEN 'archived' THEN :'archived'
   ELSE '30000000-0000-4000-8000-000000000999' END,
  CASE rt WHEN 'none' THEN 'NULL' WHEN 'live' THEN quote_literal((SELECT id FROM roots ORDER BY id OFFSET 1 LIMIT 1))||'::uuid'
   WHEN 'deleted' THEN quote_literal((SELECT id FROM roots ORDER BY id LIMIT 1))||'::uuid'
   WHEN 'reply' THEN quote_literal((SELECT id FROM public.team_hub_messages WHERE parent_message_id IS NOT NULL ORDER BY id LIMIT 1))||'::uuid'
   ELSE quote_literal('30000000-0000-4000-8000-000000000998')||'::uuid' END,
  CASE cur WHEN 'none' THEN 'NULL,NULL'
   WHEN 'mid' THEN (SELECT quote_literal(created_at)||'::timestamptz,'||quote_literal(id)||'::uuid' FROM public.team_hub_messages
     WHERE channel_id=:'general' AND parent_message_id IS NULL ORDER BY created_at DESC, id DESC OFFSET 41 LIMIT 1)
   WHEN 'tie' THEN (SELECT quote_literal(created_at)||'::timestamptz,'||quote_literal(id)||'::uuid' FROM public.team_hub_messages
     WHERE channel_id=:'general' AND parent_message_id IS NULL ORDER BY created_at DESC, id DESC OFFSET 2 LIMIT 1)
   WHEN 'deep' THEN (SELECT quote_literal(created_at)||'::timestamptz,'||quote_literal(id)||'::uuid' FROM public.team_hub_messages
     WHERE channel_id=:'general' AND parent_message_id IS NULL ORDER BY created_at DESC, id DESC OFFSET 2990 LIMIT 1)
   -- Cursors inside the live root's own thread, every reply counted (deleted ones too): offsets
   -- 1 and 2 are a tied pair that is deleted, 3 and 4 a live tied pair, 10 and 37 plain mid-thread rows.
   WHEN 'r1' THEN pg_temp.reply_cursor(1) WHEN 'r2' THEN pg_temp.reply_cursor(2)
   WHEN 'r3' THEN pg_temp.reply_cursor(3) WHEN 'r4' THEN pg_temp.reply_cursor(4)
   WHEN 'r10' THEN pg_temp.reply_cursor(10)
   -- Two live replies are older than r37, so at limit 2 has_more is false only if the cursor row
   -- itself is left out of the count.
   WHEN 'r37' THEN pg_temp.reply_cursor(37)
   ELSE 'now(),NULL' END,
  coalesce(lim,'NULL'))
FROM unnest(ARRAY[:'u1',:'u2',:'u3',:'u5',:'u6',:'u8','none']) a,
 unnest(ARRAY['general','leads','dm12','dm16','archived','bgeneral','missing']) ch,
 unnest(ARRAY['none','live','deleted','reply','missing']) rt,
 unnest(ARRAY['none','mid','tie','deep','half','r1','r2','r3','r4','r10','r37']) cur,
 unnest(ARRAY['1','2','3','30','100',NULL,'0','-5','500']) lim
WHERE (rt='none' OR ch='general') AND (cur='none' OR (ch='general' AND rt IN ('none','live')))
 AND (cur NOT LIKE 'r%' OR rt='live');
INSERT INTO calls
SELECT format('search a=%s t=%s q=%s lim=%s', a, t, qq, lim), a,
 format('SELECT public.team_hub_search(%L,%L,%s)', CASE t WHEN 'a' THEN :'ta' ELSE :'tb' END, qq, coalesce(lim,'NULL'))
FROM unnest(ARRAY[:'u1',:'u2',:'u3',:'u5',:'u6',:'u7',:'u8','none']) a,
 unnest(ARRAY['a','b']) t,
 unnest(ARRAY['venue deposit','status','STATUS NOTE 1','reply','zz','x','%%','a_b','leads venue','note 2990',
  'former','archived venue',NULL,'   ']) qq,
 unnest(ARRAY['1','5','20','50',NULL,'-3']) lim;

CREATE FUNCTION pg_temp.run(round text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; r jsonb;
BEGIN
 FOR c IN SELECT * FROM calls ORDER BY k LOOP
  PERFORM set_config('request.jwt.claims', CASE WHEN c.actor='none' THEN '{"role":"authenticated"}'
   ELSE json_build_object('sub',c.actor,'role','authenticated')::text END, false);
  EXECUTE c.q INTO r;
  EXECUTE format('INSERT INTO %I(k,v) VALUES ($1,$2)', round) USING c.k, r;
 END LOOP;
 PERFORM set_config('request.jwt.claims','',false);
END $$;
CREATE TEMP TABLE before_run(k text PRIMARY KEY, v jsonb);
CREATE TEMP TABLE after_run(k text PRIMARY KEY, v jsonb);
SELECT pg_temp.run('before_run');
SELECT pg_temp.check((SELECT count(*) FROM before_run)=(SELECT count(*) FROM calls) AND (SELECT count(*) FROM calls)>800,
 'matrix: every call recorded before the change');
SELECT pg_temp.check((SELECT count(*) FROM before_run WHERE k LIKE 'list%' AND v->>'ok'='true' AND jsonb_array_length(v->'messages')>0)>50
 AND (SELECT count(*) FROM before_run WHERE k LIKE 'search%' AND v->>'ok'='true' AND jsonb_array_length(v->'results')>0)>50
 AND (SELECT count(*) FROM before_run WHERE v->>'ok'='false')>50
 AND EXISTS(SELECT 1 FROM before_run WHERE (v->>'has_more')::boolean)
 -- Thread cursors land inside the thread: some return a partial page, not empty or all of it.
 AND EXISTS(SELECT 1 FROM before_run WHERE k LIKE '%root=live cur=r%' AND v->>'ok'='true'
  AND jsonb_array_length(v->'messages') BETWEEN 1 AND 30 AND (v->>'has_more')::boolean)
 AND EXISTS(SELECT 1 FROM before_run WHERE k LIKE '%root=live cur=r%' AND v->>'ok'='true'
  AND jsonb_array_length(v->'messages') BETWEEN 1 AND 99 AND NOT (v->>'has_more')::boolean)
 -- Both 'Former teammate' labels appear in the recorded output.
 AND EXISTS(SELECT 1 FROM before_run, jsonb_array_elements(v->'results') e WHERE e->>'author_name'='Former teammate')
 AND EXISTS(SELECT 1 FROM before_run, jsonb_array_elements(v->'results') e WHERE e->>'conversation_label'='Former teammate')
 -- The archived channel is never shown.
 AND NOT EXISTS(SELECT 1 FROM before_run WHERE v::text LIKE '%Archived venue deposit%'),
 'matrix: real pages, thread-cursor pages, refusals, has_more and both Former teammate labels occur before the change');
\echo 'PASS: the shipped list and search were recorded across the call matrix'

---------------------------------------------------------------------------------------------
-- 3. Apply the performance migration. The same calls return the same JSON, byte for byte.
---------------------------------------------------------------------------------------------
\ir ../migrations/20271114250008_exp08_team_hub_read_performance.sql
SELECT pg_temp.run('after_run');
DO $$ DECLARE bad text; n int; BEGIN
 SELECT count(*), min(b.k) INTO n, bad FROM before_run b FULL JOIN after_run a USING (k) WHERE a.v IS DISTINCT FROM b.v;
 IF n>0 THEN RAISE EXCEPTION 'FAIL: % calls changed after the performance migration, first: %', n, bad; END IF;
END $$;
\echo 'PASS: after the performance migration every list and search call returns byte-identical JSON'

DO $$ BEGIN
 IF NOT has_function_privilege('authenticated','public.team_hub_list_messages(uuid,uuid,uuid,timestamptz,uuid,int)','EXECUTE')
  OR has_function_privilege('anon','public.team_hub_list_messages(uuid,uuid,uuid,timestamptz,uuid,int)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.team_hub_search(uuid,text,int)','EXECUTE')
  OR has_function_privilege('anon','public.team_hub_search(uuid,text,int)','EXECUTE')
  OR has_function_privilege('service_role','public.team_hub_search(uuid,text,int)','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: the re-emitted functions changed who may call them'; END IF;
 IF NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.team_hub_search(uuid,text,int)'::regprocedure)
  OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.team_hub_list_messages(uuid,uuid,uuid,timestamptz,uuid,int)'::regprocedure) THEN
  RAISE EXCEPTION 'FAIL: a re-emitted function is no longer SECURITY DEFINER'; END IF;
 -- The new indexes are over ids and times only: no message text is indexed (owner ruling 2026-10-24).
 IF EXISTS(SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid
   JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
   WHERE x.relname IN ('team_hub_messages_top_stream_idx','team_hub_messages_tenant_time_idx')
    AND a.attname NOT IN ('channel_id','tenant_id','created_at','id'))
  OR (SELECT count(*) FROM pg_class WHERE relname IN ('team_hub_messages_top_stream_idx','team_hub_messages_tenant_time_idx'))<>2
  OR EXISTS(SELECT 1 FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid
   WHERE i.indrelid='public.team_hub_messages'::regclass AND (i.indexprs IS NOT NULL AND pg_get_expr(i.indexprs,i.indrelid) ILIKE '%body%')) THEN
  RAISE EXCEPTION 'FAIL: the performance indexes are missing or index more than ids and times'; END IF;
END $$;
\echo 'PASS: both functions keep their callers and SECURITY DEFINER; the two new indexes cover ids and times only'

---------------------------------------------------------------------------------------------
-- 4. At volume the new indexes serve the reads (counted by pg_stat_user_indexes, not by timing).
---------------------------------------------------------------------------------------------
INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,client_request_id,created_at)
SELECT :'ta'::uuid, :'general'::uuid, :'u1'::uuid, 'Bulk status '||g, gen_random_uuid(),
 timestamptz '2026-01-01' + make_interval(secs=>g) FROM generate_series(1,200000) g;
ANALYZE public.team_hub_messages;
SELECT pg_stat_reset();
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT public.team_hub_list_messages(:'ta',:'general',NULL,NULL,NULL,30);
SELECT public.team_hub_search(:'ta','status');
RESET ROLE;
SELECT pg_stat_force_next_flush();
SELECT 1;
DO $$ BEGIN
 IF coalesce((SELECT idx_scan FROM pg_stat_user_indexes WHERE indexrelname='team_hub_messages_top_stream_idx'),0)<1 THEN
  RAISE EXCEPTION 'FAIL: opening a conversation did not use team_hub_messages_top_stream_idx'; END IF;
 IF coalesce((SELECT idx_scan FROM pg_stat_user_indexes WHERE indexrelname='team_hub_messages_tenant_time_idx'),0)<1 THEN
  RAISE EXCEPTION 'FAIL: a search did not use team_hub_messages_tenant_time_idx'; END IF;
END $$;
\echo 'PASS: at 200k messages, opening a conversation and searching both read through the new indexes'

\c postgres
DROP DATABASE exp08_team_hub_read_perf_proof;
\echo 'PASS: EXP08 Team Hub read and search performance proof complete; disposable database dropped'
