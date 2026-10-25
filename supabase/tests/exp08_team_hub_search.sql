-- EXP08 Team Hub increment 4: the search door. public.team_hub_search returns only messages in
-- the conversations the asker can see now, through _team_hub_refusal and _team_hub_visible,
-- never a deleted message, never another workspace's, as a literal case-insensitive substring,
-- newest first, capped at 20, with no email and no storage path.
-- Contract: docs/delivery/exp08-team-hub-increment4-paige-contract.md, section 4.
-- Disposable PostgreSQL only. Never target the linked project. Every Team Hub migration commits
-- its own BEGIN/COMMIT, so this proof runs in a database it creates and drops. Each RPC below runs
-- as its own autocommit statement, the way a browser request does.
--
-- WHAT IS REAL AND WHAT IS A DOUBLE. The fixture is the increment 3 proof's, unchanged: the three
-- Team Hub migrations and the Operations wrapper (20271020000110) are loaded unchanged, then the
-- search migration. auth.uid(), auth.role() and current_user_tenant_id() are the real bodies; the
-- storage schema is the increment 3 stub; is_platform_owner, is_tenant_member, the Operations
-- doubles and the retirement policy are FIXTURE DOUBLES, as in the earlier Team Hub proofs. There
-- is no door that deletes a message yet, so a deleted message is written by the database owner,
-- setting the real deleted_at column. People and workspaces are fictional.
\set ON_ERROR_STOP on
\set QUIET on
DROP DATABASE IF EXISTS exp08_team_hub_search_proof;
CREATE DATABASE exp08_team_hub_search_proof;
\c exp08_team_hub_search_proof
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
\ir ../migrations/20271114170008_exp08_team_hub_search.sql
CREATE TEMP TABLE search_once AS
SELECT p.oid::regprocedure::text AS k, concat_ws('|', p.proacl::text, p.prosecdef::text, p.proconfig::text, p.provolatile::text, md5(p.prosrc)) AS v
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('team_hub_search','_team_hub_search_snippet');
\ir ../migrations/20271114170008_exp08_team_hub_search.sql
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
-- 2. Who finds what: visibility now, private channels, DMs and the workspace boundary.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u3'); SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.same(pg_temp.ids(public.team_hub_search(:'ta',:'q')),ARRAY[:'m_gen']::uuid[]),
  'search: an admin who is not in the private channel or the DM finds only the team channel message');
SELECT pg_temp.check(pg_temp.same(pg_temp.ids(public.team_hub_search(:'ta','VENUE DEPOSIT')),ARRAY[:'m_gen']::uuid[]),
  'search: matching is case-insensitive');
SELECT pg_temp.check(pg_temp.same(pg_temp.ids(public.team_hub_search(:'ta',E'  venue deposit \n')),ARRAY[:'m_gen']::uuid[]),
  'search: the query is trimmed');
SELECT pg_temp.act(:'u5');
SELECT pg_temp.check(pg_temp.same(pg_temp.ids(public.team_hub_search(:'ta',:'q')),ARRAY[:'m_gen']::uuid[]),
  'search: a member who never joined the team channel still finds its message, and nothing private');
SELECT pg_temp.act(:'u1');
SELECT pg_temp.check(pg_temp.same(pg_temp.ids(public.team_hub_search(:'ta',:'q')),ARRAY[:'m_gen',:'m_leads',:'m_dm']::uuid[]),
  'search: a member of the private channel and the DM finds all three');
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(pg_temp.same(pg_temp.ids(public.team_hub_search(:'ta',:'q')),ARRAY[:'m_gen',:'m_leads',:'m_dm']::uuid[]),
  'search: the other DM party finds the DM message');
SELECT pg_temp.act(:'u7');
SELECT pg_temp.check(pg_temp.same(pg_temp.ids(public.team_hub_search(:'tb',:'q')),ARRAY[:'m_b']::uuid[]),
  'search: another workspace finds only its own message');
SELECT pg_temp.act(:'u8');
SELECT pg_temp.check(pg_temp.same(pg_temp.ids(public.team_hub_search(:'tb',:'q')),ARRAY[:'m_b']::uuid[]),
  'search: a person seated in A and B, active in B, never sees A''s messages');
\echo 'PASS: a member finds team-visible messages; private channel and DM messages only by their members; another workspace''s never'

---------------------------------------------------------------------------------------------
-- 3. Refusals come from _team_hub_refusal, returned as is: {ok:false, code} and nothing else.
---------------------------------------------------------------------------------------------
SELECT pg_temp.check(public.team_hub_search(:'ta',:'q')='{"ok":false,"code":"scope_changed"}'::jsonb,
  'refusal: u8 active in B asking for A is scope_changed');
SELECT pg_temp.act(:'u1');
SELECT pg_temp.check(public.team_hub_search(:'tb',:'q')='{"ok":false,"code":"scope_changed"}'::jsonb, 'refusal: a wrong expected tenant is scope_changed'),
 pg_temp.check(public.team_hub_search(NULL,:'q')='{"ok":false,"code":"scope_changed"}'::jsonb, 'refusal: a missing expected tenant is scope_changed'),
 pg_temp.check(public.team_hub_search(:'tb','x')='{"ok":false,"code":"scope_changed"}'::jsonb, 'refusal: scope is checked before the query');
SELECT pg_temp.act(:'u6');
SELECT pg_temp.check(public.team_hub_search(:'ta',:'q')='{"ok":false,"code":"not_member"}'::jsonb, 'refusal: a suspended seat is not_member');
SELECT pg_temp.act(:'u9');
SELECT pg_temp.check(public.team_hub_search(:'ta',:'q')='{"ok":false,"code":"not_member"}'::jsonb, 'refusal: agency standing without a seat is not_member');
SELECT pg_temp.act(:'u10');
SELECT pg_temp.check(public.team_hub_search(:'ta',:'q')='{"ok":false,"code":"not_member"}'::jsonb, 'refusal: platform operator standing is not_member');
SELECT pg_temp.act(:'u11');
SELECT pg_temp.check(public.team_hub_search(:'tc',:'q')='{"ok":false,"code":"unavailable"}'::jsonb, 'refusal: a sub-account is unavailable');
SELECT pg_temp.act(:'u12');
SELECT pg_temp.check(public.team_hub_search(:'td',:'q')='{"ok":false,"code":"unavailable"}'::jsonb, 'refusal: an agency is unavailable');
SELECT pg_temp.act(NULL);
SELECT pg_temp.check(public.team_hub_search(:'ta',:'q')='{"ok":false,"code":"not_member"}'::jsonb, 'refusal: no caller is not_member');
\echo 'PASS: refusals are _team_hub_refusal''s, as is: scope_changed for a wrong or missing expected tenant, not_member, unavailable'

---------------------------------------------------------------------------------------------
-- 4. Query validation, after scope: 2..200 characters after the message-body trim.
---------------------------------------------------------------------------------------------
SELECT pg_temp.act(:'u1');
SELECT pg_temp.check(public.team_hub_search(:'ta',v.q)='{"ok":false,"code":"invalid"}'::jsonb, 'invalid: '||coalesce(left(v.q,12),'null'))
FROM (VALUES (NULL::text),(''),('a'),('   a   '),(E'\n\t '),(E' a　'),(repeat('x',201)),(' '||repeat('x',201)||' ')) v(q);
SELECT pg_temp.check(public.team_hub_search(:'ta',repeat('x',200))='{"ok":true,"results":[]}'::jsonb, 'valid: 200 characters'),
 pg_temp.check(public.team_hub_search(:'ta',' '||repeat('x',200)||' ')->>'ok'='true', 'valid: 200 characters after trimming'),
 pg_temp.check(public.team_hub_search(:'ta',E' ab ')->>'ok'='true', 'valid: two characters after trimming');
\echo 'PASS: a query outside 2..200 characters after trimming is invalid; 2 and 200 are accepted'

---------------------------------------------------------------------------------------------
-- 5. The result shape: labels, author names, thread roots and no email or storage path.
---------------------------------------------------------------------------------------------
SELECT public.team_hub_search(:'ta',:'q') AS r1 \gset
SELECT pg_temp.act(:'u2');
SELECT public.team_hub_search(:'ta',:'q') AS r2 \gset
RESET ROLE;
SELECT pg_temp.check((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(:'r1'::jsonb) k)=ARRAY['ok','results'],
  'shape: the envelope is ok and results only');
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(:'r1'::jsonb->'results') e
  WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k)<>ARRAY['author_name','conversation_id','conversation_kind',
   'conversation_label','created_at','message_id','snippet','thread_root_id']),
  'shape: every result carries exactly the eight contract fields, never an email, user id or storage path');
SELECT pg_temp.check(pg_temp.hit(:'r1',:'m_gen')=jsonb_build_object('message_id',:'m_gen','conversation_id',:'general',
  'conversation_kind','channel','conversation_label','general','thread_root_id',NULL,'author_name','Test Owner',
  'created_at',(SELECT created_at FROM public.team_hub_messages WHERE id=:'m_gen'),'snippet','Pay the venue deposit by Friday'),
  'shape: a channel hit names the channel, the author and the time, with the whole short body as the snippet');
SELECT pg_temp.check(pg_temp.hit(:'r1',:'m_leads')->>'conversation_label'='leads' AND pg_temp.hit(:'r1',:'m_leads')->>'author_name'='Member Test'
  AND pg_temp.hit(:'r1',:'m_leads')->>'conversation_kind'='channel', 'shape: a private channel hit names the channel and its author');
SELECT pg_temp.check(pg_temp.hit(:'r1',:'m_dm')->>'conversation_label'='Member Test' AND pg_temp.hit(:'r1',:'m_dm')->>'conversation_kind'='dm'
  AND pg_temp.hit(:'r1',:'m_dm')->>'conversation_id'=:'dm12', 'shape: for one DM party the DM is labelled with the other person');
SELECT pg_temp.check(pg_temp.hit(:'r2',:'m_dm')->>'conversation_label'='Test Owner' AND pg_temp.hit(:'r2',:'m_dm')->>'author_name'='Test Owner',
  'shape: for the other DM party it is labelled with the first');
SELECT pg_temp.check(pg_temp.ids(:'r1'::jsonb)=ARRAY(SELECT id FROM public.team_hub_messages WHERE id IN (:'m_gen',:'m_leads',:'m_dm')
  ORDER BY created_at DESC, id DESC), 'shape: newest first');
\echo 'PASS: results carry the eight contract fields only; channel and DM labels as Team Hub derives them; newest first'
SET ROLE authenticated;

---------------------------------------------------------------------------------------------
-- 6. A removed member stops finding it, whether they leave or their seat ends; an archived
--    conversation is found by nobody.
---------------------------------------------------------------------------------------------
SELECT public.team_hub_leave_channel(:'ta',:'leads')->>'ok' AS left_leads \gset
SELECT pg_temp.check(:'left_leads'='true' AND pg_temp.same(pg_temp.ids(public.team_hub_search(:'ta',:'q')),ARRAY[:'m_gen',:'m_dm']::uuid[]),
  'removed: a member who left the private channel no longer finds its message');
SELECT pg_temp.act(:'u1');
SELECT public.team_hub_add_members(:'ta',:'leads',ARRAY[:'u5']::uuid[])->>'ok' AS added_u5 \gset
SELECT pg_temp.act(:'u5');
SELECT pg_temp.check(:'added_u5'='true' AND pg_temp.same(pg_temp.ids(public.team_hub_search(:'ta',:'q')),ARRAY[:'m_gen',:'m_leads']::uuid[]),
  'removed: a newly added member finds the private message, not the DM');
RESET ROLE;
UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=:'ta' AND user_id=:'u5';
SET ROLE authenticated;
SELECT pg_temp.check(public.team_hub_search(:'ta',:'q')='{"ok":false,"code":"not_member"}'::jsonb, 'removed: a seat that ends is refused');
RESET ROLE;
UPDATE public.tenant_members SET status='active' WHERE tenant_id=:'ta' AND user_id=:'u5';
SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.same(pg_temp.ids(public.team_hub_search(:'ta',:'q')),ARRAY[:'m_gen']::uuid[]),
  'removed: re-seated, they find the team message and no longer the private one');
SELECT pg_temp.act(:'u1');
SELECT public.team_hub_leave_channel(:'ta',:'leads')->>'ok' AS u1_left \gset
RESET ROLE;
SELECT pg_temp.check(:'u1_left'='true' AND (SELECT archived_at IS NOT NULL FROM public.team_hub_channels WHERE id=:'leads'), 'fixture: the last member out archived #leads');
INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by) VALUES (:'leads',:'ta',:'u1',:'u1');
SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.same(pg_temp.ids(public.team_hub_search(:'ta',:'q')),ARRAY[:'m_gen',:'m_dm']::uuid[]),
  'archived: even a member of an archived channel does not find its messages');
\echo 'PASS: leaving, being removed by a seat ending, and archiving each stop a private message being found'

---------------------------------------------------------------------------------------------
-- 7. Deleted messages are excluded, and so is a reply whose thread root is deleted.
---------------------------------------------------------------------------------------------
SELECT public.team_hub_post_message(:'ta',:'general','Root about the zebra crossing',gen_random_uuid())#>>'{message,id}' AS m_root \gset
SELECT pg_temp.act(:'u2');
SELECT public.team_hub_post_message(:'ta',:'general','Reply: the zebra paint is booked',gen_random_uuid(),:'m_root')#>>'{message,id}' AS m_reply \gset
SELECT pg_temp.act(:'u3');
SELECT public.team_hub_search(:'ta','zebra') AS rz \gset
SELECT pg_temp.check(pg_temp.ids(:'rz'::jsonb)=ARRAY[:'m_reply',:'m_root']::uuid[], 'thread: a reply and its root are both found, newest first'),
 pg_temp.check(pg_temp.hit(:'rz',:'m_reply')->>'thread_root_id'=:'m_root' AND pg_temp.hit(:'rz',:'m_root')->'thread_root_id'='null'::jsonb,
  'thread: a reply names its thread root; a top-level message has none');
RESET ROLE;
UPDATE public.team_hub_messages SET deleted_at=now() WHERE id=:'m_gen';
SET ROLE authenticated;
SELECT pg_temp.check(public.team_hub_search(:'ta',:'q')='{"ok":true,"results":[]}'::jsonb, 'deleted: a deleted message is not found');
SELECT pg_temp.act(:'u2');
SELECT pg_temp.check(pg_temp.same(pg_temp.ids(public.team_hub_search(:'ta',:'q')),ARRAY[:'m_dm']::uuid[]),
  'deleted: the deleted message is gone for its other readers too');
RESET ROLE;
UPDATE public.team_hub_messages SET deleted_at=now() WHERE id=:'m_root';
SET ROLE authenticated;
SELECT pg_temp.check(public.team_hub_search(:'ta','zebra')='{"ok":true,"results":[]}'::jsonb,
  'deleted: a reply whose thread root is deleted is not found, as the thread cannot be opened');
\echo 'PASS: deleted messages, and replies under a deleted thread root, are excluded'

---------------------------------------------------------------------------------------------
-- 8. Wildcards and the escape character are literal.
---------------------------------------------------------------------------------------------
SELECT public.team_hub_post_message(:'ta',:'general','The rate is 100% final',gen_random_uuid())#>>'{message,id}' AS m_pct \gset
SELECT public.team_hub_post_message(:'ta',:'general','See file_name here',gen_random_uuid())#>>'{message,id}' AS m_us \gset
SELECT public.team_hub_post_message(:'ta',:'general','Path is back\slash today',gen_random_uuid())#>>'{message,id}' AS m_bs \gset
SELECT pg_temp.act(:'u3');
SELECT pg_temp.check(public.team_hub_search(:'ta','%%')='{"ok":true,"results":[]}'::jsonb, 'literal: %% matches no body without a %%'),
 pg_temp.check(public.team_hub_search(:'ta','__')='{"ok":true,"results":[]}'::jsonb, 'literal: __ matches no body without a __'),
 pg_temp.check(pg_temp.ids(public.team_hub_search(:'ta','0%'))=ARRAY[:'m_pct']::uuid[], 'literal: 0% finds only the body with 0%'),
 pg_temp.check(pg_temp.ids(public.team_hub_search(:'ta','e_n'))=ARRAY[:'m_us']::uuid[], 'literal: e_n finds only file_name'),
 pg_temp.check(pg_temp.ids(public.team_hub_search(:'ta','k\s'))=ARRAY[:'m_bs']::uuid[], 'literal: a backslash is a backslash'),
 pg_temp.check(public.team_hub_search(:'ta','k\%')='{"ok":true,"results":[]}'::jsonb, 'literal: a backslash before % escapes nothing'),
 pg_temp.check(public.team_hub_search(:'ta','\\')='{"ok":true,"results":[]}'::jsonb, 'literal: two backslashes match no single one');
\echo 'PASS: percent, underscore and backslash in the query are literal characters, never a pattern'

---------------------------------------------------------------------------------------------
-- 9. The limit is clamped to 1..20; ties on created_at fall back to id, newest first.
---------------------------------------------------------------------------------------------
SELECT count(*) FILTER (WHERE public.team_hub_post_message(:'ta',:'general','bulk entry '||g,gen_random_uuid())->>'ok'='true') AS bulk_tied
FROM generate_series(1,22) g \gset
SELECT public.team_hub_post_message(:'ta',:'general','bulk entry late one',gen_random_uuid())->>'ok' AS late1 \gset
SELECT public.team_hub_post_message(:'ta',:'general','bulk entry late two',gen_random_uuid())->>'ok' AS late2 \gset
RESET ROLE;
SELECT array_to_string(ARRAY(SELECT id FROM public.team_hub_messages WHERE body LIKE 'bulk entry %' ORDER BY created_at DESC, id DESC LIMIT 20),',') AS expect20 \gset
SET ROLE authenticated;
SELECT pg_temp.check(:'bulk_tied'='22' AND :'late1'='true' AND :'late2'='true', 'fixture: 24 bulk messages, 22 sharing one created_at');
SELECT pg_temp.check(pg_temp.ids(public.team_hub_search(:'ta','bulk entry'))=string_to_array(:'expect20',',')::uuid[], 'limit: the default is 20, newest first with id breaking ties'),
 pg_temp.check(pg_temp.ids(public.team_hub_search(:'ta','bulk entry',NULL))=string_to_array(:'expect20',',')::uuid[], 'limit: null is 20'),
 pg_temp.check(pg_temp.ids(public.team_hub_search(:'ta','bulk entry',100))=string_to_array(:'expect20',',')::uuid[], 'limit: 100 is clamped to 20'),
 pg_temp.check(pg_temp.ids(public.team_hub_search(:'ta','bulk entry',5))=(string_to_array(:'expect20',',')::uuid[])[1:5], 'limit: 5 is the newest 5'),
 pg_temp.check(pg_temp.ids(public.team_hub_search(:'ta','bulk entry',0))=(string_to_array(:'expect20',',')::uuid[])[1:1], 'limit: 0 is clamped to 1'),
 pg_temp.check(pg_temp.ids(public.team_hub_search(:'ta','bulk entry',-3))=(string_to_array(:'expect20',',')::uuid[])[1:1], 'limit: a negative limit is clamped to 1');
\echo 'PASS: the limit is clamped to 1..20 (default 20) and results are newest first by (created_at, id)'

---------------------------------------------------------------------------------------------
-- 10. Snippets: at most 240 characters, around the first match.
---------------------------------------------------------------------------------------------
SELECT public.team_hub_post_message(:'ta',:'general',repeat('a',600)||' middleneedle '||repeat('b',600),gen_random_uuid())#>>'{message,id}' AS m_mid \gset
SELECT public.team_hub_post_message(:'ta',:'general','headneedle '||repeat('c',500),gen_random_uuid())#>>'{message,id}' AS m_head \gset
SELECT public.team_hub_post_message(:'ta',:'general',repeat('d',500)||' tailneedle',gen_random_uuid())#>>'{message,id}' AS m_tail \gset
SELECT public.team_hub_post_message(:'ta',:'general',repeat('e',300)||repeat('q',200)||repeat('f',300),gen_random_uuid())#>>'{message,id}' AS m_long \gset
SELECT public.team_hub_search(:'ta','MIDDLENEEDLE')#>>'{results,0,snippet}' AS s_mid,
 public.team_hub_search(:'ta','headneedle')#>>'{results,0,snippet}' AS s_head,
 public.team_hub_search(:'ta','tailneedle')#>>'{results,0,snippet}' AS s_tail,
 public.team_hub_search(:'ta',repeat('q',200))#>>'{results,0,snippet}' AS s_long \gset
SELECT pg_temp.check(char_length(:'s_mid')=240 AND :'s_mid' LIKE E'…%a middleneedle b%…'
  AND abs(strpos(:'s_mid','middleneedle')-(240-12)/2)<=2, 'snippet: a middle match is centred, cut both ends, 240 characters'),
 pg_temp.check(char_length(:'s_head')=240 AND :'s_head' LIKE 'headneedle c%' AND :'s_head' LIKE E'%…', 'snippet: a leading match starts the snippet'),
 pg_temp.check(char_length(:'s_tail')=240 AND :'s_tail' LIKE E'…%d tailneedle', 'snippet: a trailing match ends the snippet'),
 pg_temp.check(char_length(:'s_long')<=240 AND strpos(:'s_long',repeat('q',200))>0, 'snippet: a 200-character match stays whole'),
 pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.team_hub_search(:'ta','needle')->'results') e
   WHERE char_length(e->>'snippet')>240), 'snippet: never longer than 240 characters');
\echo 'PASS: snippets are at most 240 characters, centred on the first case-insensitive match, whole for a short body'

---------------------------------------------------------------------------------------------
-- 11. Search writes nothing, and no browser role but authenticated may call it.
---------------------------------------------------------------------------------------------
RESET ROLE;
SELECT pg_temp.stored() AS before \gset
SET ROLE authenticated;
SELECT pg_temp.check(public.team_hub_search(:'ta','bulk entry')->>'ok'='true', 'reads: a search runs');
SELECT pg_temp.check(public.team_hub_search(:'tb','bulk entry')->>'ok'='false', 'reads: a refused search runs');
RESET ROLE;
SELECT pg_temp.check(pg_temp.stored()=:'before', 'reads: a search changes no message, membership, read marker, mention or file');
SET ROLE anon;
SELECT pg_temp.check(pg_temp.denied(format('SELECT public.team_hub_search(%L,%L)',:'ta','venue')), 'grant: anon cannot execute team_hub_search');
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.check(pg_temp.denied(format('SELECT public.team_hub_search(%L,%L)',:'ta','venue')), 'grant: the service role cannot execute team_hub_search');
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.denied('SELECT public._team_hub_search_snippet(''abc'',''b'')'), 'grant: the snippet helper is not callable');
RESET ROLE;
\echo 'PASS: a search writes nothing; anon and the service role cannot execute it; the helper is not callable'

\o
\c postgres
DROP DATABASE exp08_team_hub_search_proof;
\echo 'PASS: EXP08 Team Hub increment 4 search proof complete; disposable database dropped'
