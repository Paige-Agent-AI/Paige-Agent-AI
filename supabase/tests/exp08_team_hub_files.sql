-- EXP08 Team Hub increment 3: files on messages. The file record table, its four browser doors,
-- the two service-role doors, the four restrictive storage policies, the replaced post door and
-- the A10 disposition. Contract: docs/delivery/exp08-team-hub-increment3-attachments-contract.md.
-- Disposable PostgreSQL only. Never target the linked project. All three Team Hub migrations
-- commit their own BEGIN/COMMIT, so this proof runs in a database it creates and drops.
-- Each RPC and each storage statement below runs as its own autocommit statement, the way a
-- browser request does.
--
-- WHAT IS REAL AND WHAT IS A DOUBLE. The three Team Hub migrations and the Operations wrapper
-- (20271020000110) are loaded unchanged. The storage schema is a STUB copied from Supabase's own
-- definitions: storage.buckets and storage.objects with the columns, the (bucket_id, name) unique
-- index, RLS enabled and the grants Supabase ships (path_tokens generated as Supabase generates
-- it), and storage.foldername with Supabase's body. The comms-attachments bucket row and its four
-- permissive "comms_attach member *" policies are copied verbatim from
-- 20260726211000_comms_c15_scheduled_drainer.sql. auth.uid() and auth.role() are Supabase's
-- bodies. What a stub cannot be is the Storage API itself: here an upload is a direct INSERT into
-- storage.objects as the browser's role, which is what the Storage API's RLS check evaluates, and
-- service-role object removal is done as the database owner. is_platform_owner, is_tenant_member
-- (active seat only), the Operations doubles and the retirement policy are FIXTURE DOUBLES, as in
-- the increment 2 proof.
\set ON_ERROR_STOP on
\set QUIET on
DROP DATABASE IF EXISTS exp08_team_hub_files_proof;
CREATE DATABASE exp08_team_hub_files_proof;
\c exp08_team_hub_files_proof
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

-- Replay: a second apply of increment 3 must be a no-op on every object the three increments own,
-- on the storage policies, and on the retirement policy.
CREATE TEMP VIEW replay_state AS
SELECT 'rel:'||c.relname AS k, concat_ws('|', c.relacl::text, c.relrowsecurity::text,
  (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)::text,
  (SELECT string_agg(pg_get_constraintdef(x.oid), ',' ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid),
  (SELECT string_agg(pg_get_indexdef(i.indexrelid), ',' ORDER BY pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid=c.oid),
  (SELECT string_agg(pg_get_triggerdef(t.oid), ',' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) AS v
FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'team_hub_%' AND c.relkind='r'
UNION ALL
SELECT 'fn:'||p.oid::regprocedure::text, concat_ws('|', p.proacl::text, p.prosecdef::text, p.proconfig::text, md5(p.prosrc))
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team_hub_%'
UNION ALL
SELECT 'storage-policy:'||p.polname, concat_ws('|', p.polcmd::text, p.polpermissive::text, p.polroles::regrole[]::text,
  pg_get_expr(p.polqual,p.polrelid), pg_get_expr(p.polwithcheck,p.polrelid))
FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass
UNION ALL
SELECT 'policy:'||p.oid::regprocedure::text, concat_ws('|', p.proacl::text, md5(p.prosrc))
FROM pg_proc p WHERE p.oid='public.operator_retirement_disposition(text)'::regprocedure;
CREATE TEMP TABLE replay_before AS SELECT * FROM replay_state;
\ir ../migrations/20271114160008_exp08_team_hub_files.sql
\o
DO $$ BEGIN
 IF (SELECT count(*) FROM replay_before WHERE k LIKE 'rel:%')<>6 OR (SELECT count(*) FROM replay_before WHERE k LIKE 'storage-policy:%')<>8 THEN
  RAISE EXCEPTION 'FAIL: expected six Team Hub tables and eight storage.objects policies (four permissive, four restrictive)'; END IF;
 IF EXISTS(SELECT k,v FROM replay_before EXCEPT SELECT k,v FROM replay_state)
   OR EXISTS(SELECT k,v FROM replay_state EXCEPT SELECT k,v FROM replay_before) THEN
  RAISE EXCEPTION 'FAIL: replaying increment 3 changed a table, grant, policy, index, trigger, function or the retirement policy'; END IF;
END $$;
\echo 'PASS: increment 3 applies over increments 1 and 2; a second apply is a no-op on tables, grants, RLS, storage policies, triggers and functions'

-- Structural floor.
DO $$ DECLARE f text; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid='public.team_hub_files'::regclass AND c.relrowsecurity)
   OR EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.team_hub_files'::regclass)
   OR has_table_privilege('authenticated','public.team_hub_files','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_table_privilege('anon','public.team_hub_files','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
  RAISE EXCEPTION 'FAIL: team_hub_files is policy-open to, or grants a table privilege to, a browser role'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'team_hub_%' AND c.relkind='r'
   AND (NOT c.relrowsecurity OR EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid)
    OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))) THEN
  RAISE EXCEPTION 'FAIL: a Team Hub table lost its floor after increment 3'; END IF;
 FOREACH f IN ARRAY ARRAY['team_hub_begin_file(uuid,uuid,text,text,bigint,uuid)','team_hub_file_for_check(uuid,uuid)',
   'team_hub_discard_file(uuid,uuid)','team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[])'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=('public.'||f)::regprocedure AND p.prosecdef
     AND p.proconfig=ARRAY['search_path=""'] AND p.prorettype='jsonb'::regtype)
   OR has_function_privilege('anon','public.'||f,'EXECUTE') OR has_function_privilege('service_role','public.'||f,'EXECUTE')
   OR NOT has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: % is not a jsonb SECURITY DEFINER door for authenticated only', f; END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['team_hub_file_verdict(uuid,uuid,text,boolean,text)','team_hub_claim_stale_files(uuid)'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=('public.'||f)::regprocedure AND p.prosecdef
     AND p.proconfig=ARRAY['search_path=""'] AND p.prorettype='jsonb'::regtype)
   OR has_function_privilege('anon','public.'||f,'EXECUTE') OR has_function_privilege('authenticated','public.'||f,'EXECUTE')
   OR NOT has_function_privilege('service_role','public.'||f,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: % is not a jsonb SECURITY DEFINER door for the service role only', f; END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['_team_hub_file_can_upload(text)','_team_hub_file_can_read(text)'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=('public.'||f)::regprocedure AND p.prosecdef
     AND p.proconfig=ARRAY['search_path=""'] AND p.prorettype='boolean'::regtype)
   OR has_function_privilege('anon','public.'||f,'EXECUTE') OR has_function_privilege('service_role','public.'||f,'EXECUTE')
   OR NOT has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN
   RAISE EXCEPTION 'FAIL: % is not a boolean SECURITY DEFINER storage predicate for authenticated only', f; END IF;
 END LOOP;
 -- Every other internal helper stays unreachable from a browser.
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '\_team\_hub\_%'
   AND p.proname NOT IN ('_team_hub_file_can_upload','_team_hub_file_can_read')
   AND (has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE'))) THEN
  RAISE EXCEPTION 'FAIL: an internal Team Hub helper is callable by a browser role'; END IF;
 IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='team_hub_post_message')<>1 THEN
  RAISE EXCEPTION 'FAIL: the six-argument team_hub_post_message was overloaded rather than replaced'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE '%team\_hub\_%'
   AND p.prosrc ILIKE '%is_tenant_member%') THEN
  RAISE EXCEPTION 'FAIL: Team Hub uses is_tenant_member, which admits operators'; END IF;
 IF (SELECT array_agg(p.polname::text ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass AND NOT p.polpermissive
   AND p.polroles=ARRAY['authenticated'::regrole::oid])
   <>ARRAY['team_hub_files_delete_boundary','team_hub_files_insert_boundary','team_hub_files_select_boundary','team_hub_files_update_boundary']
  OR (SELECT string_agg(p.polname::text||'='||p.polcmd::text, ',' ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass AND NOT p.polpermissive)
   <>'team_hub_files_delete_boundary=d,team_hub_files_insert_boundary=a,team_hub_files_select_boundary=r,team_hub_files_update_boundary=w'
  OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass AND p.polpermissive AND p.polname LIKE 'comms\_attach member %')<>4 THEN
  RAISE EXCEPTION 'FAIL: storage.objects does not carry exactly the four restrictive Team Hub policies, to authenticated, beside the four permissive comms policies'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='storage.objects'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'FAIL: storage.objects lost RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
   WHERE t.tgrelid='public.team_hub_files'::regclass AND t.tgname='team_hub_file_scope'
    AND p.proname='_team_hub_file_scope_guard' AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=""']
    AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR UPDATE OF tenant_id, channel_id, message_id, uploaded_by ON public.team_hub_files FOR EACH ROW%') THEN
  RAISE EXCEPTION 'FAIL: the file scope trigger is not BEFORE INSERT OR UPDATE OF tenant_id, channel_id, message_id, uploaded_by'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_messages'::regclass AND conname='team_hub_messages_body_check')
   OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_messages'::regclass AND conname='team_hub_messages_body_chk') THEN
  RAISE EXCEPTION 'FAIL: the message body check was not replaced'; END IF;
 IF (SELECT prosrc FROM pg_proc WHERE oid='public._team_hub_message_json(public.team_hub_messages)'::regprocedure) NOT LIKE '%''work_ref''%' THEN
  RAISE EXCEPTION 'FAIL: the message shape dropped work_ref'; END IF;
END $$;
\echo 'PASS: under Supabase default privileges the file table has RLS, no policies and no browser grant; four browser doors, two service-role doors, two storage predicates; four restrictive storage policies'

-- A10: the file table is deleted with the account; nothing else moves; the guard refuses a policy
-- it cannot reconcile.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'team\_hub\_%' AND c.relkind='r'
   AND public.operator_retirement_disposition(c.relname::text) IS DISTINCT FROM 'delete') THEN
  RAISE EXCEPTION 'FAIL: a Team Hub table is not registered delete in the retirement policy (A10)'; END IF;
 IF public.operator_retirement_disposition('growth_public_visits')<>'delete' OR public.operator_retirement_disposition('tenants')<>'delete'
   OR public.operator_retirement_disposition('profiles')<>'preserve' OR public.operator_retirement_disposition('fixture_unregistered')<>'blocked' THEN
  RAISE EXCEPTION 'FAIL: registering the file table changed another table''s retirement disposition'; END IF;
 IF (SELECT array_length(string_to_array(p.prosrc,'''team_hub_files'''),1)-1 FROM pg_proc p
   WHERE p.oid='public.operator_retirement_disposition(text)'::regprocedure)<>1 THEN
  RAISE EXCEPTION 'FAIL: team_hub_files is registered other than exactly once'; END IF;
 IF has_function_privilege('authenticated','public.operator_retirement_disposition(text)','EXECUTE')
   OR has_function_privilege('anon','public.operator_retirement_disposition(text)','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL: patching the retirement policy widened its grants'; END IF;
END $$;
\set a10_block `sed -n '/^-- A10:/,/^END \$\$;$/p' supabase/migrations/20271114160008_exp08_team_hub_files.sql`
SELECT set_config('fixture.a10_block',:'a10_block',false) IS NOT NULL AS a10_loaded \gset
BEGIN;
CREATE OR REPLACE FUNCTION public.operator_retirement_disposition(_table text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN _table=ANY(ARRAY['tenants','team_hub_messages'
 ]) THEN 'delete' WHEN _table=ANY(ARRAY['profiles']) THEN 'preserve' ELSE 'blocked' END
$$;
DO $$ BEGIN
 IF position('SELECT CASE WHEN _table=ANY(ARRAY[' IN current_setting('fixture.a10_block'))=0 THEN
  RAISE EXCEPTION 'FAIL: the A10 block was not found in the migration'; END IF;
 BEGIN
  EXECUTE current_setting('fixture.a10_block');
  RAISE EXCEPTION 'FAIL: the A10 patch registered the file table into a policy without increment 2''s entry';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Canonical retirement policy requires reconciliation before registering Team Hub files' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
\echo 'PASS: retirement deletes the file table with the account (A10); the rest of the policy is untouched; the guard refuses an unreconciled policy'

-- Session helpers. Each RPC and storage call is still its own statement.
CREATE FUNCTION pg_temp.act(u text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', CASE WHEN u IS NULL THEN '{"role":"authenticated"}'
  ELSE json_build_object('sub',u,'role','authenticated')::text END, false); END $$;
CREATE FUNCTION pg_temp.service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims','{"role":"service_role"}',false); EXECUTE 'SET ROLE service_role'; END $$;
CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.denied(statement text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE statement; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
-- Storage as the current role, under RLS. put: an upload; sees: a read; moved/removed: rows touched.
CREATE FUNCTION pg_temp.put(p_name text, p_owner text DEFAULT NULL, p_size bigint DEFAULT 1000,
 p_mime text DEFAULT 'application/pdf') RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
  VALUES ('comms-attachments',p_name,coalesce(p_owner,auth.uid()::text),jsonb_build_object('size',p_size,'mimetype',p_mime));
 RETURN true;
EXCEPTION WHEN insufficient_privilege THEN RETURN false; END $$;
CREATE FUNCTION pg_temp.sees(p_name text) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='comms-attachments' AND o.name=p_name) $$;
CREATE FUNCTION pg_temp.touched(statement text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE statement; GET DIAGNOSTICS n=ROW_COUNT; RETURN n::text;
EXCEPTION WHEN insufficient_privilege THEN RETURN 'denied'; END $$;
-- As the database owner, which stands in for the service role's RLS bypass.
CREATE FUNCTION pg_temp.object(p_name text) RETURNS storage.objects LANGUAGE sql SECURITY DEFINER AS $$
 SELECT * FROM storage.objects o WHERE o.bucket_id='comms-attachments' AND o.name=p_name $$;
CREATE FUNCTION pg_temp.file(p_id uuid) RETURNS public.team_hub_files LANGUAGE sql SECURITY DEFINER AS $$
 SELECT * FROM public.team_hub_files f WHERE f.id=p_id $$;
CREATE FUNCTION pg_temp.file_at(p_path text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
 SELECT id FROM public.team_hub_files f WHERE f.storage_path=p_path $$;
CREATE FUNCTION pg_temp.path(p_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
 SELECT storage_path FROM public.team_hub_files f WHERE f.id=p_id $$;
-- Everything a request could leave behind, in one comparable value.
CREATE FUNCTION pg_temp.stored() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
 SELECT concat_ws('/', (SELECT count(*) FROM public.team_hub_messages), (SELECT count(*) FROM public.team_hub_files),
  (SELECT count(*) FROM public.team_hub_files WHERE message_id IS NOT NULL),
  (SELECT string_agg(id::text||state, ',' ORDER BY id) FROM public.team_hub_files),
  (SELECT count(*) FROM public.team_hub_channel_members), (SELECT count(*) FROM public.team_hub_message_mentions)) $$;
-- A ready file of u's, the whole way: begin as u, upload as u, verdict as the service role.
-- Called as the database owner; leaves the role reset and u acting.
CREATE FUNCTION pg_temp.ready(u text, t uuid, ch uuid, nm text, mime text DEFAULT 'application/pdf', sz bigint DEFAULT 1000)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb; fid uuid;
BEGIN
 PERFORM pg_temp.act(u); EXECUTE 'SET ROLE authenticated';
 r:=public.team_hub_begin_file(t,ch,nm,mime,sz,gen_random_uuid());
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FAIL: fixture begin refused: %', r; END IF;
 fid:=(r#>>'{file,id}')::uuid;
 IF NOT pg_temp.put(r#>>'{file,path}',u,sz,mime) THEN RAISE EXCEPTION 'FAIL: fixture upload refused'; END IF;
 PERFORM pg_temp.service();
 r:=public.team_hub_file_verdict(fid,u::uuid,mime,true,NULL);
 IF r->>'state' IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'FAIL: fixture verdict did not accept: %', r; END IF;
 EXECUTE 'RESET ROLE'; PERFORM pg_temp.act(u);
 RETURN fid;
END $$;
-- The four browser doors, reduced to their refusal codes.
CREATE FUNCTION pg_temp.codes(t uuid, ch uuid, f uuid) RETURNS text[] LANGUAGE sql AS $$
 SELECT ARRAY[
  public.team_hub_begin_file(t,ch,'probe.pdf','application/pdf',1,gen_random_uuid())->>'code',
  public.team_hub_file_for_check(t,f)->>'code',
  public.team_hub_discard_file(t,f)->>'code',
  public.team_hub_post_message(t,ch,'Probe',gen_random_uuid(),NULL,'{}',ARRAY[f])->>'code'] $$;
\o /dev/null

---------------------------------------------------------------------------------------------
-- 1. Conversations: two team channels, two private channels and a DM.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT public.team_hub_create_channel(:'ta','general','team','{}',gen_random_uuid())->>'channel_id' AS general \gset
SELECT public.team_hub_create_channel(:'ta','random','team','{}',gen_random_uuid())->>'channel_id' AS random \gset
SELECT public.team_hub_create_channel(:'ta','leads','private',ARRAY[:'u2']::uuid[],gen_random_uuid())->>'channel_id' AS leads \gset
SELECT public.team_hub_create_channel(:'ta','ops','private',ARRAY[:'u2']::uuid[],gen_random_uuid())->>'channel_id' AS ops \gset
SELECT public.team_hub_open_dm(:'ta',:'u2')->>'channel_id' AS dm12 \gset
SELECT pg_temp.act(:'u7');
SELECT public.team_hub_create_channel(:'tb','b-general','team','{}',gen_random_uuid())->>'channel_id' AS bgeneral \gset
RESET ROLE;

---------------------------------------------------------------------------------------------
-- 2. Begin: validation, shape, idempotency, visibility and the door. Refusals store nothing.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.stored() AS before \gset
SELECT pg_temp.check(public.team_hub_begin_file(:'ta',:'general',n,m,s,gen_random_uuid())->>'code'=c,
  'begin '||c||': '||coalesce(left(n,20),'null name')||' / '||coalesce(m,'null type')||' / '||coalesce(s::text,'null size'))
FROM (VALUES (NULL::text,:'pdf'::text,1::bigint,'invalid'),('',:'pdf',1,'invalid'),(repeat('a',252)||'.pdf',:'pdf',1,'invalid'),
 ('a/b.pdf',:'pdf',1,'invalid'),(E'a\\b.pdf',:'pdf',1,'invalid'),(E'a\nb.pdf',:'pdf',1,'invalid'),(E'a\u0001b.pdf',:'pdf',1,'invalid'),
 ('noextension','text/plain',1,'invalid'),('photo.png',:'pdf',1,'invalid'),('notes.txt','text/csv',1,'invalid'),
 ('report.pdf',NULL,1,'invalid'),('report.pdf','application/x-pdf',1,'invalid'),
 ('legacy.doc','application/msword',1,'invalid'),('legacy.xls','application/vnd.ms-excel',1,'invalid'),
 ('deck.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation',1,'invalid'),
 ('tool.exe','application/octet-stream',1,'invalid'),('page.html','text/html',1,'invalid'),('image.svg','image/svg+xml',1,'invalid'),
 ('macro.docm','application/vnd.openxmlformats-officedocument.wordprocessingml.document',1,'invalid'),
 ('report.pdf',:'pdf',0,'invalid'),('report.pdf',:'pdf',NULL,'invalid'),('report.pdf',:'pdf',-5,'invalid'),
 ('report.pdf',:'pdf',10485761,'too_large'),('report.pdf',:'pdf',9223372036854775807,'too_large')) v(n,m,s,c);
SELECT pg_temp.check(public.team_hub_begin_file(:'ta',:'general','report.pdf',:'pdf',1,NULL)->>'code'='invalid', 'begin: a missing request id is invalid'),
 pg_temp.check(public.team_hub_begin_file(:'ta',gen_random_uuid(),'report.pdf',:'pdf',1,gen_random_uuid())->>'code'='not_found', 'begin: an unknown conversation is not_found'),
 pg_temp.check(public.team_hub_begin_file(:'ta',:'bgeneral','report.pdf',:'pdf',1,gen_random_uuid())->>'code'='not_found', 'begin: another workspace''s conversation is not_found');
SELECT pg_temp.check(pg_temp.stored()=:'before', 'begin: every refusal stored nothing');
-- The first file, kept for the rest of the proof.
SELECT public.team_hub_begin_file(:'ta',:'general','  Q3 plan.PDF',:'pdf',1000,'50000000-0000-4000-8000-000000000001') AS r \gset x_
SELECT (:'x_r')::jsonb#>>'{file,id}' AS fx, (:'x_r')::jsonb#>>'{file,path}' AS px \gset
SELECT pg_temp.check(r->>'ok'='true' AND r - ARRAY['ok','file']='{}'::jsonb, 'begin: ok and file only, not a duplicate'),
 pg_temp.check(r->'file'=jsonb_build_object('id',:'fx','path',:'ta'||'/team-hub/'||:'fx','name','  Q3 plan.PDF','mime',:'pdf','size',1000,'state','pending'),
  'begin: file is {id, path <tenant>/team-hub/<id>, name, mime, size, state pending}; the extension matches case-insensitively')
FROM (SELECT (:'x_r')::jsonb AS r) x;
SELECT pg_temp.check(r->>'ok'='true' AND r->>'duplicate'='true' AND r#>>'{file,id}'=:'fx', 'begin: a retry returns the same record')
FROM (SELECT public.team_hub_begin_file(:'ta',:'general','renamed.png','image/png',5,'50000000-0000-4000-8000-000000000001') AS r) x;
SELECT pg_temp.check(public.team_hub_begin_file(:'ta',:'random','  Q3 plan.PDF',:'pdf',1000,'50000000-0000-4000-8000-000000000001')->>'code'='invalid',
 'begin: the same request id in another conversation is invalid');
SELECT pg_temp.check((pg_temp.file(:'fx')).storage_path=:'ta'||'/team-hub/'||:'fx' AND (pg_temp.file(:'fx')).uploaded_by=:'u1'
  AND (pg_temp.file(:'fx')).channel_id=:'general' AND (pg_temp.file(:'fx')).message_id IS NULL,
 'begin: the server built the path; the record names its uploader and conversation');
-- u3, the workspace admin, cannot see leads.
SELECT pg_temp.act(:'u3');
SELECT pg_temp.check(public.team_hub_begin_file(:'ta',:'leads','report.pdf',:'pdf',1,gen_random_uuid())->>'code'='not_found'
  AND public.team_hub_begin_file(:'ta',:'dm12','report.pdf',:'pdf',1,gen_random_uuid())->>'code'='not_found',
 'begin: a private channel or DM the caller is not in is not_found, even for an admin');
-- Every allowed type, the longest name and the largest size are accepted.
SELECT pg_temp.check(public.team_hub_begin_file(:'ta',:'general',n,m,s,gen_random_uuid())->>'ok'='true', 'begin accepts: '||left(n,24)||' / '||m)
FROM (VALUES ('a.pdf',:'pdf',1::bigint),('a.png','image/png',1),('a.jpg','image/jpeg',1),('a.jpeg','image/jpeg',1),('a.webp','image/webp',1),
 ('a.gif','image/gif',1),('a.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',1),
 ('a.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',1),('a.txt','text/plain',1),('a.csv','text/csv',1),
 (repeat('n',251)||'.pdf',:'pdf',1),('max.pdf',:'pdf',10485760)) v(n,m,s);
\echo 'PASS: begin validates name, extension against type, the nine types, size and visibility; a retry returns the same record'

---------------------------------------------------------------------------------------------
-- 3. The unposted limit: 20 pending or ready unposted files a day per person.
---------------------------------------------------------------------------------------------
-- u3 now holds 12. Eight more reach the limit.
SELECT pg_temp.check(public.team_hub_begin_file(:'ta',:'general','fill'||g||'.pdf',:'pdf',1,('60000000-0000-4000-8000-0000000000'||lpad(g::text,2,'0'))::uuid)->>'ok'='true', 'limit: file '||g)
FROM generate_series(13,20) g;
SELECT pg_temp.stored() AS before \gset
SELECT pg_temp.check(public.team_hub_begin_file(:'ta',:'general','one-more.pdf',:'pdf',1,gen_random_uuid())->>'code'='limit_reached', 'limit: the 21st unposted file is limit_reached');
SELECT pg_temp.check(public.team_hub_begin_file(:'ta',:'general','fill20.pdf',:'pdf',1,'60000000-0000-4000-8000-000000000020')->>'duplicate'='true',
 'limit: a retry of a stored file still returns it at the limit');
SELECT pg_temp.check(pg_temp.stored()=:'before', 'limit: the refusal stored nothing');
SELECT pg_temp.check(public.team_hub_discard_file(:'ta',(public.team_hub_begin_file(:'ta',:'general','fill20.pdf',:'pdf',1,'60000000-0000-4000-8000-000000000020')#>>'{file,id}')::uuid)->>'ok'='true',
 'limit: discarding one frees a place');
SELECT public.team_hub_begin_file(:'ta',:'general','after-discard.pdf',:'pdf',1,gen_random_uuid())#>>'{file,id}' AS u3_last \gset
SELECT pg_temp.check(:'u3_last' IS NOT NULL AND public.team_hub_begin_file(:'ta',:'general','again.pdf',:'pdf',1,gen_random_uuid())->>'code'='limit_reached',
 'limit: the freed place is taken, and the next is limit_reached again');
-- A refused file and a day-old pending file do not count.
RESET ROLE;
SELECT pg_temp.service();
SELECT pg_temp.check(public.team_hub_file_verdict(:'u3_last',:'u3','image/png',true,NULL)->>'state'='rejected', 'limit: a refused file');
RESET ROLE;
UPDATE public.team_hub_files SET created_at=now()-interval '25 hours' WHERE client_request_id='60000000-0000-4000-8000-000000000013';
SELECT pg_temp.act(:'u3'); SET ROLE authenticated;
SELECT pg_temp.check(public.team_hub_begin_file(:'ta',:'general','next1.pdf',:'pdf',1,gen_random_uuid())->>'ok'='true', 'limit: a place after the refusal');
SELECT public.team_hub_begin_file(:'ta',:'general','next2.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,id}' AS u3_next2 \gset
SELECT pg_temp.check(public.team_hub_begin_file(:'ta',:'general','next3.pdf',:'pdf',1,gen_random_uuid())->>'code'='limit_reached',
 'limit: a refused file and a pending file older than a day are not counted, and the limit holds again');
-- Posting a file frees its place too.
SELECT pg_temp.check(pg_temp.put(pg_temp.path(:'u3_next2')), 'limit: one of them is uploaded');
RESET ROLE; SELECT pg_temp.service();
SELECT pg_temp.check(public.team_hub_file_verdict(:'u3_next2',:'u3',:'pdf',true,NULL)->>'state'='ready', 'limit: and checked ready');
RESET ROLE; SELECT pg_temp.act(:'u3'); SET ROLE authenticated;
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'general','',gen_random_uuid(),NULL,'{}',ARRAY[:'u3_next2']::uuid[])->>'ok'='true', 'limit: and posted');
SELECT pg_temp.check(public.team_hub_begin_file(:'ta',:'general','next3.pdf',:'pdf',1,gen_random_uuid())->>'ok'='true'
  AND public.team_hub_begin_file(:'ta',:'general','next4.pdf',:'pdf',1,gen_random_uuid())->>'code'='limit_reached', 'limit: a posted file is not counted');
\echo 'PASS: more than 20 unposted files in a day is limit_reached; posted, refused, discarded and day-old files do not count'

---------------------------------------------------------------------------------------------
-- 4. Storage INSERT: only the uploader, only their own unexpired pending path, only while they
-- can see the conversation. Every other caller is refused, whatever the permissive policy says.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1');
SELECT public.team_hub_begin_file(:'ta',:'ops','ops.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,path}' AS pz \gset
SELECT public.team_hub_begin_file(:'ta',:'general','stale.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,path}' AS pw \gset
SELECT public.team_hub_begin_file(:'ta',:'general','gone.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,id}' AS fd \gset
SELECT pg_temp.path(:'fd') AS pd \gset
SELECT pg_temp.check(public.team_hub_discard_file(:'ta',:'fd')->>'ok'='true', 'setup: a discarded file');
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(NOT pg_temp.put(:'px'), 'insert: another member of the conversation cannot upload to the uploader''s path'),
 pg_temp.check(NOT pg_temp.put(:'px',:'u1'), 'insert: nor by naming the uploader as owner');
SELECT pg_temp.act(:'u1');
SELECT pg_temp.check(NOT pg_temp.put(:'px',:'u2'), 'insert: the uploader cannot store the object under another owner'),
 pg_temp.check(NOT pg_temp.put(:'ta'||'/team-hub/'||gen_random_uuid()), 'insert: a Team Hub path with no record is refused'),
 pg_temp.check(NOT pg_temp.put(:'px'||'/extra'), 'insert: a deeper path under the prefix is refused'),
 pg_temp.check(NOT pg_temp.put(:'ta'||'/team-hub/'||upper(:'fx')), 'insert: the file id is exact and lowercase'),
 pg_temp.check(NOT pg_temp.put(:'pd'), 'insert: a discarded file''s path is refused');
SELECT pg_temp.act(:'u7');
SELECT pg_temp.check(NOT pg_temp.put(:'px'), 'insert: another workspace is refused');
SELECT pg_temp.act(:'u9');
SELECT pg_temp.check(NOT pg_temp.put(:'px'), 'insert: agency standing is refused');
SELECT pg_temp.act(:'u10');
SELECT pg_temp.check(pg_temp.put(:'ta'||'/'||gen_random_uuid()||'-inbox.pdf'), 'insert: the platform owner''s standing is real: the permissive policy admits it to an Inbox path'),
 pg_temp.check(NOT pg_temp.put(:'px'), 'insert: the platform owner is refused on the Team Hub path');
SELECT pg_temp.act(NULL);
SELECT pg_temp.check(NOT pg_temp.put(:'px','10000000-0000-4000-8000-000000000001'), 'insert: no identity is refused');
RESET ROLE; SET ROLE anon;
SELECT pg_temp.check(NOT pg_temp.put(:'px','10000000-0000-4000-8000-000000000001'), 'insert: anon is refused');
RESET ROLE;
-- A day-old pending record no longer opens its path.
UPDATE public.team_hub_files SET created_at=now()-interval '25 hours' WHERE storage_path=:'pw';
-- u1 leaves ops; u2 stays, so ops stands, but u1 cannot see it.
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT public.team_hub_leave_channel(:'ta',:'ops');
SELECT pg_temp.check(NOT pg_temp.put(:'pw'), 'insert: a pending record older than a day is refused'),
 pg_temp.check(NOT pg_temp.put(:'pz'), 'insert: a conversation the uploader can no longer see is refused');
SELECT pg_temp.check(pg_temp.put(:'px'), 'insert: the uploader stores their own pending path');
SELECT pg_temp.check(NOT pg_temp.sees(:'px'), 'read: a pending object is not readable, even by its uploader');
-- A workspace switch: u8 begins in A, then switches to B.
SELECT pg_temp.act(:'u8');
RESET ROLE; UPDATE public.profiles SET active_tenant_id=:'ta' WHERE user_id=:'u8'; SET ROLE authenticated;
SELECT public.team_hub_begin_file(:'ta',:'general','switch.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,path}' AS py \gset
RESET ROLE; UPDATE public.profiles SET active_tenant_id=:'tb' WHERE user_id=:'u8'; SET ROLE authenticated;
SELECT pg_temp.check(NOT pg_temp.put(:'py'), 'insert: the uploader''s own path is refused once they switch workspace');
RESET ROLE; UPDATE public.profiles SET active_tenant_id=:'ta' WHERE user_id=:'u8'; SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.put(:'py'), 'insert: and accepted back in that workspace');
RESET ROLE; UPDATE public.profiles SET active_tenant_id=:'tb' WHERE user_id=:'u8';
\echo 'PASS: storage insert on the Team Hub prefix is the uploader''s own pending path only; other members, workspaces, agency, platform owner and anon are refused'

---------------------------------------------------------------------------------------------
-- 5. Storage UPDATE and DELETE: refused on the prefix for everyone in a browser; a rename into
-- the prefix is refused; an Inbox path in the same bucket is unaffected.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.touched(format('UPDATE storage.objects SET metadata=''{"size":1,"mimetype":"application/pdf"}'' WHERE name=%L',:'px'))='0',
  'update: the uploader cannot overwrite a Team Hub object'),
 pg_temp.check(pg_temp.touched(format('UPDATE storage.objects SET name=%L WHERE name=%L',:'ta'||'/'||gen_random_uuid()||'-out.pdf',:'px'))='0',
  'update: nor move it out of the prefix'),
 pg_temp.check(pg_temp.touched(format('DELETE FROM storage.objects WHERE name=%L',:'px'))='0', 'delete: the uploader cannot remove a Team Hub object');
SELECT :'ta'||'/'||gen_random_uuid()||'-inbox.pdf' AS pin \gset
SELECT pg_temp.check(pg_temp.put(:'pin'), 'inbox: a member uploads an Inbox attachment as before');
SELECT pg_temp.check(pg_temp.touched(format('UPDATE storage.objects SET name=%L WHERE name=%L',:'pw',:'pin'))='denied',
  'update: an Inbox object cannot be renamed into the Team Hub prefix, even onto the caller''s own path');
SELECT pg_temp.check(pg_temp.sees(:'pin'), 'inbox: a member reads it as before'),
 pg_temp.check(pg_temp.touched(format('UPDATE storage.objects SET metadata=''{"note":1}'' WHERE name=%L',:'pin'))='1', 'inbox: a member updates it as before');
SELECT pg_temp.act(:'u10');
SELECT pg_temp.check(pg_temp.sees(:'pin'), 'inbox: the platform owner reads it as before'),
 pg_temp.check(pg_temp.touched(format('UPDATE storage.objects SET metadata=''{}'' WHERE name=%L',:'px'))='0', 'update: the platform owner cannot touch a Team Hub object'),
 pg_temp.check(pg_temp.touched(format('DELETE FROM storage.objects WHERE name=%L',:'px'))='0', 'delete: the platform owner cannot remove one');
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(pg_temp.touched(format('DELETE FROM storage.objects WHERE name=%L',:'pin'))='1', 'inbox: a member removes it as before');
RESET ROLE;
SELECT pg_temp.check((pg_temp.object(:'px')).metadata=jsonb_build_object('size',1000,'mimetype',:'pdf') AND (pg_temp.object(:'px')).owner_id=:'u1',
 'update/delete: the Team Hub object is exactly as uploaded');
-- The prefix is the second path segment, split_part(name,'/',2)='team-hub', the rule the
-- retirement manifest and guard use. The two-segment name <tenant>/team-hub is inside it, so no
-- browser caller can create it and leave the account's retirement blocked on an unremovable name.
SELECT :'ta'||'/'||gen_random_uuid()||'-inbox.pdf' AS pin2 \gset
SELECT pg_temp.act(:'u2'); SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.put(:'pin2'), 'prefix: setup: a member''s Inbox attachment');
SELECT pg_temp.check(NOT pg_temp.put(:'ta'||'/team-hub'), 'prefix: a member cannot create the two-segment name <tenant>/team-hub'),
 pg_temp.check(NOT pg_temp.put(:'ta'||'/team-hub/y/z'), 'prefix: nor a four-segment name under the prefix'),
 pg_temp.check(pg_temp.touched(format('UPDATE storage.objects SET name=%L WHERE name=%L',:'ta'||'/team-hub',:'pin2'))='denied',
  'prefix: nor rename an Inbox object onto <tenant>/team-hub');
SELECT pg_temp.check(pg_temp.touched(format('DELETE FROM storage.objects WHERE name=%L',:'pin2'))='1', 'prefix: the Inbox attachment is removed as before');
SELECT pg_temp.act(:'u10');
SELECT pg_temp.check(NOT pg_temp.put(:'ta'||'/team-hub'), 'prefix: nor can the platform owner');
-- The prefix test reads only the second segment, so it needs no tenant in the first. The platform
-- owner, whom the member policies admit to any name, shows it: a non-tenant four-segment name is
-- stored outside the prefix, refused under it, and an upper-case TEAM-HUB segment is outside it.
SELECT pg_temp.check(pg_temp.put('x/inbox/y/z'), 'prefix: control: the platform owner stores x/inbox/y/z, outside the prefix'),
 pg_temp.check(NOT pg_temp.put('x/team-hub/y/z'), 'prefix: but not x/team-hub/y/z, which is inside it with no tenant first segment'),
 pg_temp.check(pg_temp.put('x/TEAM-HUB/y/z'), 'prefix: and x/TEAM-HUB/y/z is outside it: the segment is case-sensitive');
SELECT pg_temp.check(pg_temp.touched('DELETE FROM storage.objects WHERE bucket_id=''comms-attachments'' AND name IN (''x/inbox/y/z'',''x/TEAM-HUB/y/z'')')='2',
 'prefix: the platform owner removes both outside-prefix names as before');
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES ('comms-attachments',:'ta'||'/team-hub',:'u2','{}');
SELECT pg_temp.act(:'u2'); SET ROLE authenticated;
SELECT pg_temp.check(NOT pg_temp.sees(:'ta'||'/team-hub'), 'prefix: an existing <tenant>/team-hub object is not readable'),
 pg_temp.check(pg_temp.touched(format('UPDATE storage.objects SET metadata=''{}'' WHERE name=%L',:'ta'||'/team-hub'))='0', 'prefix: nor writable'),
 pg_temp.check(pg_temp.touched(format('DELETE FROM storage.objects WHERE name=%L',:'ta'||'/team-hub'))='0', 'prefix: nor removable in a browser');
RESET ROLE;
-- Postgres applies SELECT policies to the rows an UPDATE or DELETE reads and writes, so the read
-- boundary alone already hides that name. Each write boundary must hold on its own as well:
-- without the read boundary (rolled back), the update and delete boundaries still refuse it.
BEGIN;
DROP POLICY team_hub_files_select_boundary ON storage.objects;
SELECT :'ta'||'/'||gen_random_uuid()||'-inbox.pdf' AS pin3 \gset
SELECT pg_temp.act(:'u2'); SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.put(:'pin3'), 'prefix: isolated: setup: a member''s Inbox attachment');
SELECT pg_temp.check(pg_temp.sees(:'ta'||'/team-hub'), 'prefix: isolated: without the read boundary the member policy shows the object'),
 pg_temp.check(pg_temp.touched(format('UPDATE storage.objects SET metadata=''{}'' WHERE name=%L',:'ta'||'/team-hub'))='0',
  'prefix: isolated: the update boundary alone refuses writing <tenant>/team-hub'),
 pg_temp.check(pg_temp.touched(format('DELETE FROM storage.objects WHERE name=%L',:'ta'||'/team-hub'))='0',
  'prefix: isolated: the delete boundary alone refuses removing <tenant>/team-hub');
RESET ROLE;
DELETE FROM storage.objects WHERE bucket_id='comms-attachments' AND name=:'ta'||'/team-hub';
SELECT pg_temp.act(:'u2'); SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.touched(format('UPDATE storage.objects SET name=%L WHERE name=%L',:'ta'||'/team-hub',:'pin3'))='denied',
  'prefix: isolated: the update boundary alone refuses renaming an Inbox object onto <tenant>/team-hub');
ROLLBACK;
RESET ROLE;
DELETE FROM storage.objects WHERE bucket_id='comms-attachments' AND name=:'ta'||'/team-hub';
-- The segment is case-sensitive in every layer: an upper-case TEAM-HUB folder is an ordinary
-- comms object, governed by the member policies exactly as an Inbox attachment is.
SELECT :'ta'||'/TEAM-HUB/'||gen_random_uuid() AS pup \gset
SELECT pg_temp.act(:'u2'); SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.put(:'pup'), 'prefix: an upper-case TEAM-HUB folder is outside the prefix; a member uploads it as an Inbox object');
SELECT pg_temp.check(pg_temp.sees(:'pup'), 'prefix: and reads it as before'),
 pg_temp.check(pg_temp.touched(format('DELETE FROM storage.objects WHERE name=%L',:'pup'))='1', 'prefix: and removes it as before');
RESET ROLE;
\echo 'PASS: no browser caller overwrites, moves, renames into or deletes a Team Hub object; the prefix is the second segment, so <tenant>/team-hub is inside it; Inbox attachments in the same bucket are unaffected'

---------------------------------------------------------------------------------------------
-- 6. for_check: the uploader's own pending or ready file, in a conversation they see.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.check(public.team_hub_file_for_check(:'ta',:'fx')=jsonb_build_object('ok',true,'file',
  jsonb_build_object('id',:'fx','path',:'px','mime',:'pdf','size',1000,'state','pending')), 'for_check: {id, path, mime, size, state}, never the name');
SELECT pg_temp.check(public.team_hub_file_for_check(:'ta',(SELECT id FROM pg_temp.file(gen_random_uuid())))->>'code'='not_found', 'for_check: no file is not_found'),
 pg_temp.check(public.team_hub_file_for_check(:'ta',:'fd')->>'code'='invalid', 'for_check: a discarded file is invalid'),
 pg_temp.check(public.team_hub_file_for_check(:'ta',pg_temp.file_at(:'pz'))->>'code'='not_found',
  'for_check: a file in a conversation the uploader left is not_found');
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(public.team_hub_file_for_check(:'ta',:'fx')->>'code'='not_found', 'for_check: another member is not_found');
\echo 'PASS: for_check answers only the uploader, for a pending or ready file in a conversation they see'

---------------------------------------------------------------------------------------------
-- 7. The verdict: service role only; ready only when the sniffed type, the stored owner, size and
-- type all match the record; anything else is rejected with a reason code.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1');
SELECT pg_temp.check(pg_temp.denied(format('SELECT public.team_hub_file_verdict(%L,%L,%L,true,NULL)',:'fx',:'u1',:'pdf')),
  'verdict: authenticated has no EXECUTE'),
 pg_temp.check(pg_temp.denied(format('SELECT public.team_hub_claim_stale_files(%L)',:'u1')), 'claim: authenticated has no EXECUTE');
RESET ROLE; SET ROLE anon;
SELECT pg_temp.check(pg_temp.denied(format('SELECT public.team_hub_file_verdict(%L,%L,%L,true,NULL)',:'fx',:'u1',:'pdf')), 'verdict: anon has no EXECUTE');
RESET ROLE;
-- Five more uploads of u1's, each wrong in one way.
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT public.team_hub_begin_file(:'ta',:'general','r1.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,id}' AS r1,
 public.team_hub_begin_file(:'ta',:'general','r2.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,id}' AS r2,
 public.team_hub_begin_file(:'ta',:'general','r3.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,id}' AS r3,
 public.team_hub_begin_file(:'ta',:'general','r4.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,id}' AS r4,
 public.team_hub_begin_file(:'ta',:'general','r5.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,id}' AS r5,
 public.team_hub_begin_file(:'ta',:'general','r6.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,id}' AS r6,
 public.team_hub_begin_file(:'ta',:'general','r7.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,id}' AS r7 \gset
SELECT pg_temp.check(pg_temp.put(pg_temp.path(:'r1')) AND pg_temp.put(pg_temp.path(:'r2'),NULL,999)
  AND pg_temp.put(pg_temp.path(:'r3'),NULL,1000,'image/png') AND pg_temp.put(pg_temp.path(:'r6')) AND pg_temp.put(pg_temp.path(:'r7')),
 'setup: the uploader stores r1, r2 (wrong stored size), r3 (wrong stored type), r6 and r7');
RESET ROLE;
-- r4's object exists but is not its uploader's; r5 was never uploaded.
INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES ('comms-attachments',pg_temp.path(:'r4'),:'u2',jsonb_build_object('size',1000,'mimetype',:'pdf'));
SELECT pg_temp.service();
SELECT pg_temp.check(public.team_hub_file_verdict(:'fx',:'u2',:'pdf',true,NULL)->>'code'='not_found'
  AND (pg_temp.file(:'fx')).state='pending', 'verdict: the wrong uploader is refused and decides nothing');
SELECT pg_temp.check(public.team_hub_file_verdict(:'r1',:'u1','image/png',true,NULL)=jsonb_build_object('ok',true,'state','rejected','reason','type_mismatch'),
  'verdict: a sniffed type that is not the declared one is rejected'),
 pg_temp.check(public.team_hub_file_verdict(:'r2',:'u1',:'pdf',true,NULL)->>'state'='rejected', 'verdict: a stored size that is not the declared one is rejected'),
 pg_temp.check(public.team_hub_file_verdict(:'r3',:'u1',:'pdf',true,NULL)->>'state'='rejected', 'verdict: a stored type that is not the declared one is rejected'),
 pg_temp.check(public.team_hub_file_verdict(:'r4',:'u1',:'pdf',true,NULL)->>'state'='rejected', 'verdict: an object stored by someone else is rejected'),
 pg_temp.check(public.team_hub_file_verdict(:'r5',:'u1',:'pdf',true,NULL)->>'state'='rejected', 'verdict: a missing object is rejected');
SELECT pg_temp.check(public.team_hub_file_verdict(:'r6',:'u1','application/zip',false,'macro_found')=jsonb_build_object('ok',true,'state','rejected','reason','macro_found'),
  'verdict: the edge function''s refusal is stored with its reason code'),
 pg_temp.check(public.team_hub_file_verdict(:'r7',:'u1',:'pdf',false,'Q3 plan.pdf is bad')->>'reason'='rejected',
  'verdict: a reason that is not a short code (it could carry a file name) is stored as rejected');
SELECT pg_temp.check(r->>'ok'='true' AND r->>'state'='ready', 'verdict: everything matching is ready: '||r::text)
FROM (SELECT public.team_hub_file_verdict(:'fx',:'u1',:'pdf',true,NULL) AS r) x;
SELECT pg_temp.check(public.team_hub_file_verdict(:'fx',:'u1',:'pdf',false,'late_refusal')=jsonb_build_object('ok',false,'code','invalid','state','ready')
  AND public.team_hub_file_verdict(:'r1',:'u1',:'pdf',true,NULL)=jsonb_build_object('ok',false,'code','invalid','state','rejected'),
  'verdict: only a pending file is decided; a second verdict changes nothing');
-- The in-body guard holds even with the grant: service_role's database role, an authenticated JWT.
SELECT set_config('request.jwt.claims',json_build_object('sub',:'u1','role','authenticated')::text,false);
SELECT pg_temp.check(public.team_hub_file_verdict(:'r5',:'u1',:'pdf',true,NULL)=jsonb_build_object('ok',false,'code','not_allowed')
  AND public.team_hub_claim_stale_files(:'u1')=jsonb_build_object('ok',false,'code','not_allowed'), 'verdict/claim: refused in the body without a service-role JWT');
RESET ROLE;
SELECT pg_temp.check(f.state='ready' AND f.checked_at IS NOT NULL AND f.rejected_reason IS NULL, 'verdict: ready records when it was checked') FROM pg_temp.file(:'fx') f;
SELECT pg_temp.check(bool_and(f.state='rejected' AND f.checked_at IS NOT NULL AND f.rejected_reason IS NOT NULL), 'verdict: every refusal is recorded with a reason')
FROM public.team_hub_files f WHERE f.id IN (:'r1',:'r2',:'r3',:'r4',:'r5',:'r6',:'r7');
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.check(public.team_hub_file_for_check(:'ta',:'fx')#>>'{file,state}'='ready', 'for_check: a ready file is answered'),
 pg_temp.check(public.team_hub_file_for_check(:'ta',:'r1')->>'code'='invalid', 'for_check: a rejected file is invalid'),
 pg_temp.check(NOT pg_temp.sees(pg_temp.path(:'r6')), 'read: a rejected object is never readable'),
 pg_temp.check(NOT pg_temp.sees(:'px'), 'read: a ready file nobody has posted is not readable yet');
RESET ROLE;
\echo 'PASS: the verdict is service-role only and accepts only a matching sniff, owner, size and type; every mismatch is rejected with a reason code'

---------------------------------------------------------------------------------------------
-- 8. Posting with files.
---------------------------------------------------------------------------------------------
SELECT pg_temp.ready(:'u1',:'ta',:'general','second.png','image/png',2048) AS f2 \gset
SELECT pg_temp.ready(:'u1',:'ta',:'general','three.csv','text/csv') AS f3 \gset
SELECT pg_temp.ready(:'u1',:'ta',:'general','four.txt','text/plain') AS f4 \gset
SELECT pg_temp.ready(:'u1',:'ta',:'general','five.gif','image/gif') AS f5 \gset
SELECT pg_temp.ready(:'u1',:'ta',:'general','six.webp','image/webp') AS f6 \gset
SELECT pg_temp.ready(:'u1',:'ta',:'general','seven.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') AS f7 \gset
SELECT pg_temp.ready(:'u1',:'ta',:'random','elsewhere.pdf') AS fh \gset
SELECT pg_temp.ready(:'u1',:'ta',:'leads','private.pdf') AS fl \gset
SELECT pg_temp.ready(:'u1',:'ta',:'dm12','direct.pdf') AS fm \gset
SELECT pg_temp.ready(:'u2',:'ta',:'general','theirs.pdf') AS fg \gset
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT public.team_hub_begin_file(:'ta',:'general','still-pending.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,id}' AS fp \gset
SELECT pg_temp.put(pg_temp.path(:'fp'));
SELECT public.team_hub_post_message(:'ta',:'general','Root for replies',gen_random_uuid())#>>'{message,id}' AS root \gset
SELECT pg_temp.stored() AS before \gset
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'general','Files',gen_random_uuid(),NULL,'{}',ids)->>'code'='invalid', 'post: '||label)
FROM (VALUES (ARRAY[:'fx',:'f2',:'f3',:'f4',:'f5',:'f6']::uuid[],'six files is invalid'),
 (ARRAY[:'fx',:'fx']::uuid[],'a repeated file is invalid'),(ARRAY[:'fx',NULL]::uuid[],'a null id is invalid'),
 (ARRAY[:'fp']::uuid[],'a file that is not ready is invalid'),(ARRAY[:'r1']::uuid[],'a rejected file is invalid'),
 (ARRAY[:'fd']::uuid[],'a discarded file is invalid'),(ARRAY[:'fg']::uuid[],'someone else''s file is invalid'),
 (ARRAY[:'fh']::uuid[],'a file of another conversation is invalid'),(ARRAY[gen_random_uuid()]::uuid[],'an unknown file is invalid'),
 (ARRAY[:'fx',:'fp']::uuid[],'one bad file among good ones is invalid')) v(ids,label);
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'general',E'  \n ',gen_random_uuid())->>'code'='invalid', 'post: a blank body with no files is still invalid'),
 pg_temp.check(public.team_hub_post_message(:'ta',:'general','',gen_random_uuid(),NULL,'{}',NULL)->>'code'='invalid', 'post: a null file list is no files');
SELECT pg_temp.check(pg_temp.stored()=:'before', 'post: every refused post stored nothing and stamped no file');
-- Files only: the body may be blank.
SELECT public.team_hub_post_message(:'ta',:'general',E' \t ','50000000-0000-4000-8000-0000000000f1',NULL,'{}',ARRAY[:'f2',:'fx']::uuid[]) AS r \gset p1_
SELECT (:'p1_r')::jsonb#>>'{message,id}' AS m1 \gset
SELECT pg_temp.check(r->>'ok'='true' AND r->'duplicate' IS NULL AND r#>>'{message,body}'='', 'post: files with a blank body post a message with no text'),
 pg_temp.check(r#>'{message,files}'=jsonb_build_array(
   jsonb_build_object('id',:'fx','name','  Q3 plan.PDF','mime',:'pdf','size',1000,'path',:'px'),
   jsonb_build_object('id',:'f2','name','second.png','mime','image/png','size',2048,'path',pg_temp.path(:'f2'))),
  'post: the message carries files [{id, name, mime, size, path}] in the order they were attached'),
 pg_temp.check((r->'message') - ARRAY['id','author_user_id','body','created_at','parent_message_id','reply_count',
   'last_reply_at','mentions','work_ref','files']='{}'::jsonb AND r#>'{message,work_ref}'='null'::jsonb,
  'post: the message carries exactly increments 1 and 2''s fields plus files')
FROM (SELECT (:'p1_r')::jsonb AS r) x;
RESET ROLE;
SELECT pg_temp.check(bool_and(f.message_id=:'m1' AND f.posted_at IS NOT NULL AND f.state='ready'), 'post: both files are stamped with the message')
FROM public.team_hub_files f WHERE f.id IN (:'fx',:'f2');
SELECT pg_temp.check(split_part(:'before','/',1)::int+1=split_part(pg_temp.stored(),'/',1)::int
  AND split_part(:'before','/',3)::int+2=split_part(pg_temp.stored(),'/',3)::int, 'post: exactly one message and two stamped files');
SET ROLE authenticated;
SELECT pg_temp.stored() AS before \gset
SELECT pg_temp.check(r->>'duplicate'='true' AND r#>>'{message,id}'=:'m1' AND jsonb_array_length(r#>'{message,files}')=2,
 'post: a retry returns the original message with its files')
FROM (SELECT public.team_hub_post_message(:'ta',:'general','different now','50000000-0000-4000-8000-0000000000f1',NULL,'{}',ARRAY[:'f3']::uuid[]) AS r) x;
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'general','Again',gen_random_uuid(),NULL,'{}',ARRAY[:'fx']::uuid[])->>'code'='invalid',
 'post: a file already posted is invalid');
SELECT pg_temp.check(pg_temp.stored()=:'before', 'post: the retry and the repost stored nothing');
-- Five files with text, as a thread reply.
SELECT public.team_hub_post_message(:'ta',:'general','Here are five',gen_random_uuid(),:'root','{}',ARRAY[:'f3',:'f4',:'f5',:'f6',:'f7']::uuid[]) AS r \gset p2_
SELECT (:'p2_r')::jsonb#>>'{message,id}' AS m2 \gset
SELECT pg_temp.check(r->>'ok'='true' AND r#>>'{message,parent_message_id}'=:'root' AND r#>>'{message,body}'='Here are five'
  AND (SELECT array_agg(e->>'id' ORDER BY n) FROM jsonb_array_elements(r#>'{message,files}') WITH ORDINALITY x(e,n))=ARRAY[:'f3',:'f4',:'f5',:'f6',:'f7'],
 'post: five files with text, in a thread reply')
FROM (SELECT (:'p2_r')::jsonb AS r) x;
SELECT pg_temp.check((SELECT jsonb_array_length(e->'files') FROM jsonb_array_elements(public.team_hub_list_messages(:'ta',:'general')->'messages') e WHERE e->>'id'=:'m1')=2
  AND (SELECT e->'files' FROM jsonb_array_elements(public.team_hub_list_messages(:'ta',:'general')->'messages') e WHERE e->>'id'=:'root')='[]'::jsonb
  AND jsonb_array_length(public.team_hub_list_messages(:'ta',:'general',:'root')#>'{messages,0,files}')=5,
 'read: listed messages and thread replies carry their files; a message with none carries []');
SELECT public.team_hub_post_message(:'ta',:'leads','For leads',gen_random_uuid(),NULL,'{}',ARRAY[:'fl']::uuid[])#>>'{message,id}' AS ml \gset
SELECT public.team_hub_post_message(:'ta',:'dm12','For you',gen_random_uuid(),NULL,'{}',ARRAY[:'fm']::uuid[])#>>'{message,id}' AS mm \gset
-- Another member cannot attach someone's file even in the same conversation.
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'general','Mine now',gen_random_uuid(),NULL,'{}',ARRAY[:'f2']::uuid[])->>'code'='invalid',
 'post: another member cannot post the uploader''s file');
\echo 'PASS: posting takes 0 to 5 of the caller''s own ready, unposted files of this conversation; files-only messages post; a retry returns the files'

---------------------------------------------------------------------------------------------
-- 9. Reading a posted file: whoever can see the conversation now, and nobody else.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.sees(:'px'), 'read: the uploader reads a posted file');
-- Readable is not writable: the overwrite and delete refusals hold on a row the caller can see.
SELECT pg_temp.check(pg_temp.touched(format('UPDATE storage.objects SET metadata=''{"size":1,"mimetype":"application/pdf"}'' WHERE name=%L',:'px'))='0',
  'update: the uploader cannot overwrite a posted file they can read'),
 pg_temp.check(pg_temp.touched(format('DELETE FROM storage.objects WHERE name=%L',:'px'))='0', 'delete: nor remove it');
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(pg_temp.touched(format('UPDATE storage.objects SET name=%L WHERE name=%L',:'ta'||'/'||gen_random_uuid()||'-copy.pdf',:'px'))='0'
  AND pg_temp.touched(format('DELETE FROM storage.objects WHERE name=%L',:'px'))='0', 'update/delete: another reader cannot move or remove it');
SELECT pg_temp.check(pg_temp.sees(:'px'), 'read: a member of the team channel reads it'),
 pg_temp.check(pg_temp.sees(pg_temp.path(:'fl')), 'read: a member of the private channel reads its file'),
 pg_temp.check(pg_temp.sees(pg_temp.path(:'fm')), 'read: the other person in a DM reads its file');
SELECT pg_temp.act(:'u5');
SELECT pg_temp.check(pg_temp.sees(:'px'), 'read: an active teammate who never joined the team channel reads it'),
 pg_temp.check(NOT pg_temp.sees(pg_temp.path(:'fl')) AND NOT pg_temp.sees(pg_temp.path(:'fm')), 'read: a non-member of a private channel or DM cannot');
SELECT pg_temp.act(:'u3');
SELECT pg_temp.check(NOT pg_temp.sees(pg_temp.path(:'fl')), 'read: the workspace admin who is not in the private channel cannot');
SELECT pg_temp.act(:'u7');
SELECT pg_temp.check(NOT pg_temp.sees(:'px'), 'read: another workspace cannot');
SELECT pg_temp.act(:'u8');
SELECT pg_temp.check(NOT pg_temp.sees(:'px'), 'read: a member of A working in B cannot');
SELECT pg_temp.act(:'u9');
SELECT pg_temp.check(NOT pg_temp.sees(:'px'), 'read: agency standing cannot');
SELECT pg_temp.act(:'u10');
SELECT pg_temp.check(NOT pg_temp.sees(:'px'), 'read: the platform owner cannot, though the permissive policy admits them');
SELECT pg_temp.act(:'u6');
SELECT pg_temp.check(NOT pg_temp.sees(:'px'), 'read: a suspended seat cannot');
SELECT pg_temp.act(:'u11');
SELECT pg_temp.check(NOT pg_temp.sees(:'px'), 'read: a sub-account owner cannot');
SELECT pg_temp.act(NULL);
SELECT pg_temp.check(NOT pg_temp.sees(:'px'), 'read: no identity cannot');
RESET ROLE; SET ROLE anon;
SELECT pg_temp.check(NOT pg_temp.sees(:'px'), 'read: anon cannot');
RESET ROLE;
-- Removed now means unreadable now.
SELECT pg_temp.act(:'u2'); SET ROLE authenticated;
SELECT public.team_hub_leave_channel(:'ta',:'leads');
SELECT pg_temp.check(NOT pg_temp.sees(pg_temp.path(:'fl')), 'read: a person removed from a private channel loses its files at once');
SELECT pg_temp.act(:'u1');
SELECT pg_temp.check(pg_temp.sees(pg_temp.path(:'fl')), 'read: the member who stayed still reads it');
RESET ROLE; UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=:'ta' AND user_id=:'u5';
SELECT pg_temp.act(:'u5'); SET ROLE authenticated;
SELECT pg_temp.check(NOT pg_temp.sees(:'px'), 'read: a seat that is suspended loses every file at once');
RESET ROLE; UPDATE public.tenant_members SET status='active' WHERE tenant_id=:'ta' AND user_id=:'u5';
-- A deleted message takes its files' read access with it.
UPDATE public.team_hub_messages SET deleted_at=now() WHERE id=:'m2';
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.check(NOT pg_temp.sees(pg_temp.path(:'f3')) AND pg_temp.sees(:'px'), 'read: a deleted message''s files are no longer readable');
RESET ROLE; UPDATE public.team_hub_messages SET deleted_at=NULL WHERE id=:'m2';
\echo 'PASS: a posted file is readable by whoever can see its conversation now; a removed member, non-member, other workspace, agency, platform owner and anon cannot'

---------------------------------------------------------------------------------------------
-- 10. Discard: only the uploader, only unposted, idempotent.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u2'); SET ROLE authenticated;
SELECT pg_temp.check(public.team_hub_discard_file(:'ta',:'fp')->>'code'='not_found', 'discard: another member is not_found');
SELECT pg_temp.act(:'u1');
SELECT pg_temp.check(public.team_hub_discard_file(:'ta',:'fp')=jsonb_build_object('ok',true,'path',pg_temp.path(:'fp')), 'discard: returns the path to remove'),
 pg_temp.check((pg_temp.file(:'fp')).state='discarded', 'discard: the file is discarded');
SELECT pg_temp.check(public.team_hub_discard_file(:'ta',:'fp')=jsonb_build_object('ok',true,'path',pg_temp.path(:'fp')), 'discard: a second discard returns the path again'),
 pg_temp.check(public.team_hub_discard_file(:'ta',:'fx')->>'code'='not_allowed' AND (pg_temp.file(:'fx')).state='ready', 'discard: a posted file is not_allowed and stays'),
 pg_temp.check(public.team_hub_discard_file(:'ta',:'r1')->>'ok'='true' AND (pg_temp.file(:'r1')).state='rejected', 'discard: a refused file returns its path and stays refused'),
 pg_temp.check(public.team_hub_discard_file(:'ta',pg_temp.file_at(:'pz'))->>'ok'='true',
  'discard: the uploader clears their own upload in a conversation they left');
SELECT pg_temp.check(public.team_hub_discard_file(:'ta',:'fh')->>'ok'='true'
  AND public.team_hub_post_message(:'ta',:'random','Too late',gen_random_uuid(),NULL,'{}',ARRAY[:'fh']::uuid[])->>'code'='invalid',
 'discard: a discarded ready file can no longer be posted');
\echo 'PASS: discard is the uploader''s, on unposted files only, and idempotent'

---------------------------------------------------------------------------------------------
-- 11. The stale sweep: the uploader's own unposted files older than a day, pending or ready, and
-- nothing else. A ready file nobody posted is unreadable, so its bytes are claimed for removal.
---------------------------------------------------------------------------------------------
SELECT public.team_hub_begin_file(:'ta',:'general','fresh.pdf',:'pdf',1000,gen_random_uuid())#>>'{file,id}' AS fresh \gset
RESET ROLE;
SELECT pg_temp.ready(:'u1',:'ta',:'general','old-ready.pdf') AS fold \gset
RESET ROLE;
SELECT pg_temp.ready(:'u1',:'ta',:'general','fresh-ready.pdf') AS fnew \gset
RESET ROLE;
SELECT pg_temp.ready(:'u1',:'ta',:'general','old-posted.pdf') AS fpost \gset
SET ROLE authenticated;
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'general','',gen_random_uuid(),NULL,'{}',ARRAY[:'fpost']::uuid[])->>'ok'='true', 'claim: setup: a posted file');
RESET ROLE;
UPDATE public.team_hub_files SET created_at=now()-interval '3 days' WHERE id IN (:'fold',:'fpost');
-- The edge function removed the objects of every file discarded or refused earlier in this proof.
DELETE FROM storage.objects o USING public.team_hub_files x
 WHERE o.bucket_id='comms-attachments' AND o.name=x.storage_path AND x.state IN ('discarded','rejected');
SELECT pg_temp.service();
SELECT pg_temp.check(public.team_hub_claim_stale_files(:'u1')=jsonb_build_object('ok',true,'paths',
  (SELECT jsonb_agg(x ORDER BY x) FROM unnest(ARRAY[:'pw',pg_temp.path(:'fold')]) x)),
 'claim: returns exactly the uploader''s pending and ready unposted files older than a day');
-- The stale pending file's upload was refused in section 7, so only the ready file has stored bytes.
SELECT pg_temp.check(public.team_hub_claim_stale_files(:'u1')=jsonb_build_object('ok',true,'paths',jsonb_build_array(pg_temp.path(:'fold'))),
 'claim: a removal that failed (object still stored) is offered again on the next sweep; a file with no stored object is not');
RESET ROLE;
DELETE FROM storage.objects o WHERE o.bucket_id='comms-attachments' AND o.name IN (:'pw',pg_temp.path(:'fold'));
SELECT pg_temp.service();
SELECT pg_temp.check(public.team_hub_claim_stale_files(:'u1')=jsonb_build_object('ok',true,'paths','[]'::jsonb),
 'claim: once the objects are removed, a sweep finds nothing');
RESET ROLE;
SELECT pg_temp.check((SELECT state FROM public.team_hub_files WHERE storage_path=:'pw')='discarded', 'claim: the stale pending file is discarded'),
 pg_temp.check((pg_temp.file(:'fold')).state='discarded' AND (pg_temp.file(:'fold')).message_id IS NULL, 'claim: the stale ready, never-posted file is discarded'),
 pg_temp.check((pg_temp.file(:'fresh')).state='pending' AND (pg_temp.file(:'fnew')).state='ready', 'claim: fresh pending and ready files are untouched'),
 pg_temp.check((pg_temp.file(:'fpost')).state='ready' AND (pg_temp.file(:'fpost')).message_id IS NOT NULL, 'claim: a posted file, however old, is untouched'),
 pg_temp.check((SELECT state FROM public.team_hub_files WHERE client_request_id='60000000-0000-4000-8000-000000000013')='pending',
  'claim: another person''s stale file is untouched');
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.check(public.team_hub_post_message(:'ta',:'general','Too late',gen_random_uuid(),NULL,'{}',ARRAY[:'fold']::uuid[])->>'code'='invalid',
 'claim: a claimed ready file can no longer be posted');
RESET ROLE;
\echo 'PASS: the stale sweep is service-role only and discards only that uploader''s day-old unposted files, pending or ready; posted files stay'

---------------------------------------------------------------------------------------------
-- 11b. The scheduled sweep (migration 20271114260008): who has sweep work now, by exactly the claim's
-- own two conditions, for the hourly team-hub-file-sweep function to loop through the claim above.
---------------------------------------------------------------------------------------------
\ir ../migrations/20271114260008_exp08_team_hub_stale_file_sweep.sql
\o /dev/null
-- An independent statement of who has work: a day-old unposted pending/ready file, or a discarded or
-- refused file whose object is still stored. Oldest work first, then by id.
CREATE FUNCTION pg_temp.expected_uploaders() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
 SELECT coalesce(jsonb_agg(u ORDER BY first_at, u),'[]'::jsonb) FROM (
  SELECT f.uploaded_by AS u, min(f.created_at) AS first_at FROM public.team_hub_files f
  LEFT JOIN storage.objects o ON o.bucket_id='comms-attachments' AND o.name=f.storage_path
  WHERE (f.message_id IS NULL AND f.state<>'discarded' AND f.state<>'rejected' AND now()-f.created_at>=interval '1 day')
     OR (f.state IN ('discarded','rejected') AND o.id IS NOT NULL)
  GROUP BY f.uploaded_by) w $$;
SELECT pg_temp.check(EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.team_hub_stale_file_uploaders(int)'::regprocedure
   AND p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND p.prorettype='jsonb'::regtype)
  AND NOT has_function_privilege('anon','public.team_hub_stale_file_uploaders(int)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.team_hub_stale_file_uploaders(int)','EXECUTE')
  AND has_function_privilege('service_role','public.team_hub_stale_file_uploaders(int)','EXECUTE'),
 'sweep list: a jsonb SECURITY DEFINER door for the service role only');
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.denied('SELECT public.team_hub_stale_file_uploaders(50)'), 'sweep list: authenticated has no EXECUTE');
RESET ROLE;
SELECT pg_temp.act(:'u1');
SELECT pg_temp.check(public.team_hub_stale_file_uploaders(50)=jsonb_build_object('ok',false,'code','not_allowed'),
 'sweep list: refused in the body without a service-role JWT');
-- The age boundary: u1's pending file is 23 hours old, under a day, so it is not yet sweep work; the
-- other owner's pending file is 25 hours old, so it is.
RESET ROLE;
UPDATE public.team_hub_files SET created_at=now()-interval '23 hours' WHERE id=:'fresh';
-- A refused file whose object is still stored is sweep work at any age: a fresh refusal of u2's,
-- with its object left in place as if the removal had failed.
SELECT pg_temp.act(:'u2'); SET ROLE authenticated;
SELECT public.team_hub_begin_file(:'ta',:'general','refused-kept.pdf',:'pdf',1000,gen_random_uuid())#>'{file}' AS rk \gset
SELECT pg_temp.check(pg_temp.put((:'rk'::jsonb)->>'path',:'u2',1000,:'pdf'), 'sweep list: setup: u2 uploads');
SELECT pg_temp.service();
SELECT pg_temp.check(public.team_hub_file_verdict(((:'rk'::jsonb)->>'id')::uuid,:'u2',:'pdf',false,'macro_found')->>'state'='rejected',
 'sweep list: setup: u2''s file is refused');
RESET ROLE;
SELECT pg_temp.check(pg_temp.sees((:'rk'::jsonb)->>'path'), 'sweep list: setup: the refused file''s object is still stored');
SELECT uploaded_by AS stale_owner FROM public.team_hub_files WHERE client_request_id='60000000-0000-4000-8000-000000000013' \gset
SELECT pg_temp.service();
SELECT public.team_hub_stale_file_uploaders(50) AS sweep_list \gset
RESET ROLE;
SELECT pg_temp.check((:'sweep_list'::jsonb)->'uploaders'=pg_temp.expected_uploaders()
  AND (:'sweep_list'::jsonb)->'uploaders' @> to_jsonb(ARRAY[:'stale_owner'])
  AND NOT (:'sweep_list'::jsonb)->'uploaders' @> to_jsonb(ARRAY[:'u1'])
  AND (:'sweep_list'::jsonb)->'uploaders' @> to_jsonb(ARRAY[:'u2']),
 'sweep list: exactly the uploaders with work; the owner of a day-old pending file and of a refused file still stored are listed; an uploader whose work was all swept, and whose old file was posted, is not');
-- u1's fresh ready file becomes day-old: u1 now has work, and is oldest, so it comes first and a limit of 1 keeps it.
UPDATE public.team_hub_files SET created_at=now()-interval '3 days' WHERE id=:'fnew';
SELECT pg_temp.service();
SELECT pg_temp.check((public.team_hub_stale_file_uploaders(50)->'uploaders')->>0=:'u1'
  AND public.team_hub_stale_file_uploaders(1)=jsonb_build_object('ok',true,'uploaders',jsonb_build_array(:'u1'))
  AND jsonb_array_length(public.team_hub_stale_file_uploaders(0)->'uploaders')=1
  AND jsonb_array_length(public.team_hub_stale_file_uploaders(-7)->'uploaders')=1,
 'sweep list: oldest work first; the limit is honoured and clamped to at least one');
-- The sweep then claims it: the file is discarded and its path offered; u1 stays listed while the object is stored.
SELECT pg_temp.check(public.team_hub_claim_stale_files(:'u1')=jsonb_build_object('ok',true,'paths',jsonb_build_array(pg_temp.path(:'fnew'))),
 'sweep: the claim for a listed uploader returns the stale file''s path');
SELECT pg_temp.check(public.team_hub_stale_file_uploaders(50)->'uploaders' @> to_jsonb(ARRAY[:'u1']),
 'sweep list: an uploader whose removal has not happened yet stays listed, so a failed removal is retried');
RESET ROLE;
DELETE FROM storage.objects o WHERE o.bucket_id='comms-attachments' AND o.name=pg_temp.path(:'fnew');
SELECT pg_temp.service();
SELECT public.team_hub_stale_file_uploaders(50) AS sweep_after \gset
RESET ROLE;
SELECT pg_temp.check(NOT (:'sweep_after'::jsonb)->'uploaders' @> to_jsonb(ARRAY[:'u1'])
  AND (:'sweep_after'::jsonb)->'uploaders'=pg_temp.expected_uploaders()
  AND (pg_temp.file(:'fnew')).state='discarded' AND (pg_temp.file(:'fpost')).state='ready',
 'sweep list: once the object is removed the uploader drops off; a posted file is never swept');
SELECT pg_temp.check(to_regnamespace('cron') IS NULL, 'sweep schedule: a database without pg_cron applies the migration and skips the schedule');
\echo 'PASS: the scheduled sweep lists exactly the uploaders the claim would act on, oldest first, service role only; the claim and removal then clear them'

---------------------------------------------------------------------------------------------
-- 12. Increment 2 still works on the replaced post door.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.check(r->>'ok'='true' AND r#>>'{message,body}'='/PAIGE draft a task' AND r#>>'{message,work_ref,source}'='planning'
  AND r#>'{message,files}'='[]'::jsonb, 'request_task: still posts its command message through the replaced door, with work_ref and no files')
FROM (SELECT public.team_hub_request_task(:'ta',:'general','Send the brief',:'u2',NULL,gen_random_uuid()) AS r) x;
SELECT pg_temp.check(r->>'ok'='true' AND r#>>'{message,body}'='Plain words' AND r#>'{message,files}'='[]'::jsonb,
 'post: the six-argument positional call still posts a plain message')
FROM (SELECT public.team_hub_post_message(:'ta',:'general','Plain words',gen_random_uuid(),NULL,'{}') AS r) x;
\echo 'PASS: team_hub_request_task and a plain post still work through the replaced post door'

---------------------------------------------------------------------------------------------
-- 13. Isolation of the doors, and no direct access to the record table.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u8');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general',:'fresh')=ARRAY['scope_changed','scope_changed','scope_changed','scope_changed'], 'scope: a workspace switch mid-request is scope_changed');
SELECT pg_temp.act(:'u9');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general',:'fresh')=ARRAY['not_member','not_member','not_member','not_member'], 'agency standing: not_member');
SELECT pg_temp.act(:'u10');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general',:'fresh')=ARRAY['not_member','not_member','not_member','not_member'], 'operator standing: not_member');
SELECT pg_temp.act(NULL);
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general',:'fresh')=ARRAY['not_member','not_member','not_member','not_member'], 'no identity: not_member');
SELECT pg_temp.act(:'u6');
SELECT pg_temp.check(pg_temp.codes(:'ta',:'general',:'fresh')=ARRAY['not_member','not_member','not_member','not_member'], 'suspended seat: not_member');
SELECT pg_temp.act(:'u11');
SELECT pg_temp.check(pg_temp.codes(:'tc',:'general',:'fresh')=ARRAY['unavailable','unavailable','unavailable','unavailable'], 'sub-account: unavailable');
SELECT pg_temp.act(:'u12');
SELECT pg_temp.check(pg_temp.codes(:'td',:'general',:'fresh')=ARRAY['unavailable','unavailable','unavailable','unavailable'], 'agency workspace: unavailable');
SELECT pg_temp.act(:'u7');
SELECT pg_temp.check(public.team_hub_file_for_check(:'tb',:'fresh')->>'code'='not_found' AND public.team_hub_discard_file(:'tb',:'fresh')->>'code'='not_found',
 'other workspace: a file of A is not_found');
RESET ROLE;
SELECT pg_temp.check((pg_temp.file(:'fresh')).state='pending', 'isolation: no refused caller changed the file');
SET ROLE anon;
SELECT pg_temp.check(pg_temp.denied(format(s,:'ta',:'fresh')), 'anon: no EXECUTE on '||s)
FROM unnest(ARRAY['SELECT public.team_hub_begin_file(%L,%L,''a.pdf'',''application/pdf'',1,gen_random_uuid())',
 'SELECT public.team_hub_file_for_check(%L,%L)','SELECT public.team_hub_discard_file(%L,%L)',
 'SELECT public.team_hub_post_message(%L,%L,''x'',gen_random_uuid(),NULL,''{}'',''{}'')',
 'SELECT public._team_hub_file_can_read(%L||%L)','SELECT public.team_hub_claim_stale_files(%L) WHERE %L IS NOT NULL']) s;
SELECT pg_temp.check(pg_temp.denied('SELECT 1 FROM public.team_hub_files'), 'anon: cannot read the file table');
RESET ROLE; SELECT pg_temp.act(:'u1'); SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.denied('SELECT 1 FROM public.team_hub_files'), 'authenticated: cannot read the file table'),
 pg_temp.check(pg_temp.denied(format('UPDATE public.team_hub_files SET state=''ready'' WHERE id=%L',:'fresh')), 'authenticated: cannot mark a file ready'),
 pg_temp.check(pg_temp.denied('DELETE FROM public.team_hub_files'), 'authenticated: cannot delete file records'),
 pg_temp.check(pg_temp.denied(format('INSERT INTO public.team_hub_files(tenant_id,channel_id,uploaded_by,client_request_id,storage_path,file_name,mime_type,size_bytes) VALUES (%L,%L,%L,gen_random_uuid(),''x'',''a.pdf'',''application/pdf'',1)',
  :'ta',:'general',:'u1')), 'authenticated: cannot insert a file record directly');
RESET ROLE; SELECT pg_temp.service();
SELECT pg_temp.check(pg_temp.denied(format('SELECT public.team_hub_begin_file(%L,%L,''a.pdf'',''application/pdf'',1,gen_random_uuid())',:'ta',:'general')),
 'service role: the browser doors are not granted to it');
RESET ROLE;
\echo 'PASS: workspace switches, agency, operator, suspended, no-identity, anonymous and non-SOLO callers are refused by every door; direct record access is refused'

---------------------------------------------------------------------------------------------
-- 14. Storage backstops on the record table.
---------------------------------------------------------------------------------------------
DO $$ DECLARE ta uuid:='20000000-0000-4000-8000-00000000000a'; tb uuid:='20000000-0000-4000-8000-00000000000b';
 u1 uuid:='10000000-0000-4000-8000-000000000001'; u2 uuid:='10000000-0000-4000-8000-000000000002';
 g uuid:=(SELECT id FROM public.team_hub_channels WHERE tenant_id=ta AND name='general');
 r uuid:=(SELECT id FROM public.team_hub_channels WHERE tenant_id=ta AND name='random'); fid uuid:=gen_random_uuid(); probe text;
BEGIN
 FOREACH probe IN ARRAY ARRAY[
  format('INSERT INTO public.team_hub_files(id,tenant_id,channel_id,uploaded_by,client_request_id,storage_path,file_name,mime_type,size_bytes) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L,''a.pdf'',''application/pdf'',1)',fid,ta,g,u1,ta||'/team-hub/'||gen_random_uuid()),
  format('INSERT INTO public.team_hub_files(id,tenant_id,channel_id,uploaded_by,client_request_id,storage_path,file_name,mime_type,size_bytes) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L,''a.pdf'',''application/pdf'',1)',fid,ta,g,u1,ta||'/'||fid),
  format('INSERT INTO public.team_hub_files(id,tenant_id,channel_id,uploaded_by,client_request_id,storage_path,file_name,mime_type,size_bytes) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L,''a/b.pdf'',''application/pdf'',1)',fid,ta,g,u1,ta||'/team-hub/'||fid),
  format('INSERT INTO public.team_hub_files(id,tenant_id,channel_id,uploaded_by,client_request_id,storage_path,file_name,mime_type,size_bytes) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L,''a.doc'',''application/msword'',1)',fid,ta,g,u1,ta||'/team-hub/'||fid),
  format('INSERT INTO public.team_hub_files(id,tenant_id,channel_id,uploaded_by,client_request_id,storage_path,file_name,mime_type,size_bytes) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L,''a.pdf'',''application/pdf'',10485761)',fid,ta,g,u1,ta||'/team-hub/'||fid),
  format('INSERT INTO public.team_hub_files(id,tenant_id,channel_id,uploaded_by,client_request_id,storage_path,file_name,mime_type,size_bytes,state) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L,''a.pdf'',''application/pdf'',1,''ready'')',fid,ta,g,u1,ta||'/team-hub/'||fid),
  format('INSERT INTO public.team_hub_files(id,tenant_id,channel_id,uploaded_by,client_request_id,storage_path,file_name,mime_type,size_bytes,state) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L,''a.pdf'',''application/pdf'',1,''rejected'')',fid,ta,g,u1,ta||'/team-hub/'||fid),
  format('INSERT INTO public.team_hub_files(id,tenant_id,channel_id,uploaded_by,client_request_id,storage_path,file_name,mime_type,size_bytes) VALUES (%L,%L,%L,%L,gen_random_uuid(),%L,''a.pdf'',''application/pdf'',1)',fid,tb,g,u1,tb||'/team-hub/'||fid),
  format('UPDATE public.team_hub_files SET message_id=(SELECT id FROM public.team_hub_messages WHERE channel_id=%L LIMIT 1), posted_at=now() WHERE id=(SELECT id FROM public.team_hub_files WHERE channel_id=%L AND state=''pending'' LIMIT 1)',g,g),
  format('UPDATE public.team_hub_files SET channel_id=%L WHERE message_id IS NOT NULL',r),
  format('UPDATE public.team_hub_files SET message_id=(SELECT id FROM public.team_hub_messages WHERE channel_id=%L AND author_user_id=%L LIMIT 1), posted_at=now() WHERE state=''ready'' AND message_id IS NULL AND uploaded_by=%L',g,u1,u2)]
 LOOP
  BEGIN EXECUTE probe; RAISE EXCEPTION 'FAIL: storage accepted %', probe;
  EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
END $$;
\echo 'PASS: a record''s path is its own tenant/team-hub/id; name, type, size and state are checked; it matches its conversation, and its message and author once posted'

---------------------------------------------------------------------------------------------
-- 15. Deleting a message takes its file records; deleting a workspace takes all of them.
---------------------------------------------------------------------------------------------
DELETE FROM public.team_hub_messages WHERE id=:'m2';
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.team_hub_files WHERE id IN (:'f3',:'f4',:'f5',:'f6',:'f7'))
  AND EXISTS(SELECT 1 FROM public.team_hub_files WHERE id=:'fx'), 'delete: a message takes its file records');
DELETE FROM public.tenants WHERE id=:'ta';
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM public.team_hub_files), 'delete: a workspace and its file records go together');
\echo 'PASS: deleting a message removes its file records; deleting a workspace cascades through the file table'

RESET ROLE;
\o
\c postgres
DROP DATABASE exp08_team_hub_files_proof;
\echo 'PASS: EXP08 Team Hub increment 3 files proof complete; disposable database dropped'
