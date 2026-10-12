-- ISOLATED full production-schema-only clone only; never execute on production.
-- INT-298 / INT-342 MBC slice 7a: a visit to a published page, live funnel or standalone form is recorded for the
-- business that owns it (never one the request names), continued only for the same target within 30 idle minutes,
-- and read only by that business. Nothing but the service role can write one; a submission links only a live visit
-- in the same business. Real JWT identity for the reads.
BEGIN;
SET LOCAL timezone='UTC';
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE FUNCTION pg_temp.require_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.require_error(command text,reason text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>reason THEN RAISE EXCEPTION 'FAIL: % (refused with %, expected %)',label,SQLERRM,reason; END IF; RETURN; END;
RAISE EXCEPTION 'FAIL: %',label; END $$;
CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',uid,true),set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true) $$;
CREATE FUNCTION pg_temp.as_server() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
CREATE FUNCTION pg_temp.visit(kind text,target uuid,token text DEFAULT NULL,step integer DEFAULT 0,host text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.growth_public_visit_record(kind,target,token,step,'{"utm_source":"newsletter"}'::jsonb,host) $$;

DO $fixture_owner$ DECLARE fixture_owner_id uuid; BEGIN
 IF (SELECT count(*) FROM public.user_roles WHERE role='super_admin')>1 THEN RAISE EXCEPTION 'FIXTURE: canonical owner is ambiguous'; END IF;
 SELECT user_id INTO fixture_owner_id FROM public.user_roles WHERE role='super_admin';
 IF fixture_owner_id IS NULL THEN
   fixture_owner_id := 'a2980700-0000-4000-8000-000000000704';
   INSERT INTO auth.users(id,email) VALUES(fixture_owner_id,'visits-fixture-owner@example.invalid');
   INSERT INTO public.user_roles(user_id,role) VALUES(fixture_owner_id,'super_admin');
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',fixture_owner_id)::text,true);
END $fixture_owner$;
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('a2980700-0000-4000-8000-000000000711','visits-a','Visits A','active','standalone','VSA','{"system_workspace":true}'),
 ('a2980700-0000-4000-8000-000000000712','visits-b','Visits B','active','standalone','VSB','{"system_workspace":true}'),
 ('a2980700-0000-4000-8000-000000000713','visits-closed','Visits closed','suspended','standalone','VSC','{"system_workspace":true}'),
 ('a2980700-0000-4000-8000-000000000714','visits-archived','Visits archived','active','standalone','VSD','{"system_workspace":true}');
SELECT pg_temp.as_server();
INSERT INTO auth.users(id,email) VALUES
 ('a2980700-0000-4000-8000-000000000701','visits-a-member@example.invalid'),
 ('a2980700-0000-4000-8000-000000000702','visits-b-member@example.invalid');
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('a2980700-0000-4000-8000-000000000711','a2980700-0000-4000-8000-000000000701','member','active',false),
 ('a2980700-0000-4000-8000-000000000712','a2980700-0000-4000-8000-000000000702','member','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('a2980700-0000-4000-8000-000000000701','a2980700-0000-4000-8000-000000000711'),
 ('a2980700-0000-4000-8000-000000000702','a2980700-0000-4000-8000-000000000712')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
SELECT pg_temp.as_server();
INSERT INTO public.growth_pages(id,tenant_id,slug,title,status) VALUES
 ('a2980700-0000-4000-8000-0000000007a1','a2980700-0000-4000-8000-000000000711','spring','Spring','published'),
 ('a2980700-0000-4000-8000-0000000007a2','a2980700-0000-4000-8000-000000000711','draft-page','Draft','draft'),
 ('a2980700-0000-4000-8000-0000000007a3','a2980700-0000-4000-8000-000000000713','closed-page','Closed','published'),
 ('a2980700-0000-4000-8000-0000000007a4','a2980700-0000-4000-8000-000000000711','summer','Summer','published'),
 ('a2980700-0000-4000-8000-0000000007a5','a2980700-0000-4000-8000-000000000712','b-page','B page','published'),
 ('a2980700-0000-4000-8000-0000000007a6','a2980700-0000-4000-8000-000000000714','archived-page','Archived business page','published');
-- Archiving goes through the canonical operation in production (a01_operator_account_archive); only this rolled-back
-- fixture write steps around it, to put one archived business in front of the visit writer.
ALTER TABLE public.tenants DISABLE TRIGGER a01_operator_account_archive;
UPDATE public.tenants SET archived_at=now() WHERE id='a2980700-0000-4000-8000-000000000714';
ALTER TABLE public.tenants ENABLE TRIGGER a01_operator_account_archive;
INSERT INTO public.growth_forms(id,tenant_id,slug,name,status) VALUES
 ('a2980700-0000-4000-8000-0000000007f1','a2980700-0000-4000-8000-000000000711','intake','Intake','active'),
 ('a2980700-0000-4000-8000-0000000007f2','a2980700-0000-4000-8000-000000000711','other','Other form','active'),
 ('a2980700-0000-4000-8000-0000000007f3','a2980700-0000-4000-8000-000000000712','b-intake','B intake','active');
INSERT INTO public.growth_funnels(id,tenant_id,slug,name,status) VALUES
 ('a2980700-0000-4000-8000-0000000007c1','a2980700-0000-4000-8000-000000000711','spring-funnel','Spring funnel','active');

-- 1. A visit belongs to the business that owns the page; the visitor never names it.
CREATE TEMP TABLE t(k text PRIMARY KEY, v text);
INSERT INTO t SELECT 'page', pg_temp.visit('page','a2980700-0000-4000-8000-0000000007a1',NULL,0,'news.example.com')->>'visit_token';
SELECT pg_temp.require_true((SELECT v ~ '^pv_[0-9a-f]{64}$' FROM t WHERE k='page'),'a new visit gets a server-made token');
SELECT pg_temp.require_true((SELECT count(*)=1 FROM public.growth_public_visits v JOIN t ON t.k='page' AND v.visit_token=t.v
  WHERE v.tenant_id='a2980700-0000-4000-8000-000000000711' AND v.target_kind='page' AND v.referrer_host='news.example.com'
    AND v.utm_json->>'utm_source'='newsletter' AND v.furthest_step=0),'the visit is the page owner''s, with only the referring host and tags');

-- 2. The same tab continues the same visit; a token for another target or business starts a new one.
SELECT pg_temp.require_true((pg_temp.visit('page','a2980700-0000-4000-8000-0000000007a1',(SELECT v FROM t WHERE k='page'))->>'started')::boolean=false,'the same token continues the visit');
SELECT pg_temp.require_true((SELECT count(*)=1 FROM public.growth_public_visits WHERE page_id='a2980700-0000-4000-8000-0000000007a1'),'continuing records no second visit');
SELECT pg_temp.require_true((pg_temp.visit('form','a2980700-0000-4000-8000-0000000007f1',(SELECT v FROM t WHERE k='page'))->>'started')::boolean,'a page token used for a form starts a new visit');
SELECT pg_temp.require_true((pg_temp.visit('page','a2980700-0000-4000-8000-0000000007a4',(SELECT v FROM t WHERE k='page'))->>'started')::boolean,'a token for one page starts a new visit on another page of the same business');
SELECT pg_temp.require_true((pg_temp.visit('page','a2980700-0000-4000-8000-0000000007a5',(SELECT v FROM t WHERE k='page'))->>'started')::boolean,'a token from one business starts a new visit in another');
SELECT pg_temp.require_true((SELECT count(*)=1 FROM public.growth_public_visits WHERE page_id='a2980700-0000-4000-8000-0000000007a5' AND tenant_id='a2980700-0000-4000-8000-000000000712'),'the other business''s visit is its own record, not a continuation');
-- An idle visit is over: the same token after 30 minutes starts a new one.
UPDATE public.growth_public_visits SET last_seen_at=now()-interval '31 minutes' WHERE visit_token=(SELECT v FROM t WHERE k='page');
SELECT pg_temp.require_true((pg_temp.visit('page','a2980700-0000-4000-8000-0000000007a1',(SELECT v FROM t WHERE k='page'))->>'started')::boolean,'a visit idle for 30 minutes is not continued');
SELECT pg_temp.require_true((SELECT count(*)=2 FROM public.growth_public_visits WHERE page_id='a2980700-0000-4000-8000-0000000007a1'),'the idle visit and the new one are two visits');

-- 3. Only something public now, in a live business, is visited.
SELECT pg_temp.require_error($$SELECT pg_temp.visit('page','a2980700-0000-4000-8000-0000000007a2')$$,'PUBLIC_VISIT_TARGET_UNAVAILABLE','a draft page records no visit');
SELECT pg_temp.require_error($$SELECT pg_temp.visit('page','a2980700-0000-4000-8000-0000000007a3')$$,'PUBLIC_VISIT_TARGET_UNAVAILABLE','a suspended business records no visit');
SELECT pg_temp.require_error($$SELECT pg_temp.visit('page','a2980700-0000-4000-8000-0000000007a6')$$,'PUBLIC_VISIT_TARGET_UNAVAILABLE','an archived business records no visit');
SELECT pg_temp.require_error($$SELECT pg_temp.visit('page','a2980700-0000-4000-8000-0000000007f1')$$,'PUBLIC_VISIT_TARGET_UNAVAILABLE','a form id named as a page records nothing');
SELECT pg_temp.require_error($$SELECT pg_temp.visit('video','a2980700-0000-4000-8000-0000000007a1')$$,'PUBLIC_VISIT_INVALID','an unknown kind is refused');
INSERT INTO t SELECT 'badhost', pg_temp.visit('page','a2980700-0000-4000-8000-0000000007a1',NULL,0,'bad host/path')->>'visit_token';
SELECT pg_temp.require_true((SELECT referrer_host IS NULL FROM public.growth_public_visits v JOIN t ON t.k='badhost' AND v.visit_token=t.v),'a malformed referring host is dropped, not stored');

-- 4. A funnel visit opens its funnel session and keeps the furthest step, never rewinding.
INSERT INTO t SELECT 'funnel', pg_temp.visit('funnel','a2980700-0000-4000-8000-0000000007c1',NULL,0)->>'visit_token';
SELECT pg_temp.visit('funnel','a2980700-0000-4000-8000-0000000007c1',(SELECT v FROM t WHERE k='funnel'),2);
SELECT pg_temp.visit('funnel','a2980700-0000-4000-8000-0000000007c1',(SELECT v FROM t WHERE k='funnel'),1);
SELECT pg_temp.require_true((SELECT v.furthest_step=2 AND s.current_step=2 AND s.tenant_id='a2980700-0000-4000-8000-000000000711'
  FROM public.growth_public_visits v JOIN public.growth_funnel_sessions s ON s.id=v.funnel_session_id
  WHERE v.visit_token=(SELECT v FROM t WHERE k='funnel')),'the funnel visit and its session reach step 2 and never rewind');
INSERT INTO t SELECT 'stepped', pg_temp.visit('page','a2980700-0000-4000-8000-0000000007a1',NULL,5)->>'visit_token';
SELECT pg_temp.require_true((SELECT furthest_step=0 FROM public.growth_public_visits v JOIN t ON t.k='stepped' AND v.visit_token=t.v),'a page visit has no step');

-- 5. A submission links only a live visit in its own business: to this form, or to a page or funnel.
INSERT INTO t SELECT 'form', pg_temp.visit('form','a2980700-0000-4000-8000-0000000007f1')->>'visit_token';
INSERT INTO t SELECT 'page2', pg_temp.visit('page','a2980700-0000-4000-8000-0000000007a1')->>'visit_token';
SELECT pg_temp.require_true((SELECT count(*)=1 FROM public.growth_public_visit_for_submission('a2980700-0000-4000-8000-0000000007f1',(SELECT v FROM t WHERE k='form'))),'a form visit links to that form');
SELECT pg_temp.require_true((SELECT count(*)=0 FROM public.growth_public_visit_for_submission('a2980700-0000-4000-8000-0000000007f2',(SELECT v FROM t WHERE k='form'))),'a visit to one form never links to another form');
SELECT pg_temp.require_true((SELECT count(*)=1 FROM public.growth_public_visit_for_submission('a2980700-0000-4000-8000-0000000007f2',(SELECT v FROM t WHERE k='page2'))),'a page visit links to a form on that page');
SELECT pg_temp.require_true((SELECT count(*)=0 FROM public.growth_public_visit_for_submission('a2980700-0000-4000-8000-0000000007f3',(SELECT v FROM t WHERE k='page2'))),'a visit never links to another business''s form');
SELECT pg_temp.require_true((SELECT funnel_session_token LIKE 'fs\_%' FROM public.growth_public_visit_for_submission('a2980700-0000-4000-8000-0000000007f1',(SELECT v FROM t WHERE k='funnel'))),'a funnel visit hands back its own session');
UPDATE public.growth_public_visits SET last_seen_at=now()-interval '3 hours' WHERE visit_token=(SELECT v FROM t WHERE k='page2');
SELECT pg_temp.require_true((SELECT count(*)=0 FROM public.growth_public_visit_for_submission('a2980700-0000-4000-8000-0000000007f2',(SELECT v FROM t WHERE k='page2'))),'a visit over two hours old links nothing');

-- 6. Each business reads only its own visits; no signed-in person writes one. (As the real role, so row security applies.)
SELECT pg_temp.as_user('a2980700-0000-4000-8000-000000000701');
SET LOCAL ROLE authenticated;
SELECT pg_temp.require_true((SELECT count(*)>0 AND bool_and(tenant_id='a2980700-0000-4000-8000-000000000711') FROM public.growth_public_visits),'a member reads their own business''s visits');
SELECT pg_temp.require_error($$INSERT INTO public.growth_public_visits(tenant_id,target_kind,page_id,visit_token) VALUES('a2980700-0000-4000-8000-000000000711','page','a2980700-0000-4000-8000-0000000007a1','pv_x')$$,'permission denied for table growth_public_visits','a signed-in person cannot write a visit');
SELECT pg_temp.require_error($$SELECT public.growth_public_visit_record('page','a2980700-0000-4000-8000-0000000007a1')$$,'permission denied for function growth_public_visit_record','a signed-in person cannot call the writer');
RESET ROLE;
SELECT pg_temp.as_user('a2980700-0000-4000-8000-000000000702');
SET LOCAL ROLE authenticated;
SELECT pg_temp.require_true((SELECT count(*)=1 AND bool_and(tenant_id='a2980700-0000-4000-8000-000000000712') FROM public.growth_public_visits),'another business reads only its own visit, none of the first business''s');
RESET ROLE;
SELECT pg_temp.as_server();
SELECT pg_temp.require_true(NOT has_function_privilege('anon','public.growth_public_visit_record(text,uuid,text,integer,jsonb,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.growth_public_visit_record(text,uuid,text,integer,jsonb,text)','EXECUTE')
  AND has_function_privilege('service_role','public.growth_public_visit_record(text,uuid,text,integer,jsonb,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.growth_public_visit_for_submission(uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.growth_public_visit_for_submission(uuid,text)','EXECUTE')
  AND NOT has_table_privilege('anon','public.growth_public_visits','SELECT'),'only the service role records or links a visit; anonymous callers read nothing');
SELECT pg_temp.require_true(NOT has_function_privilege('anon','public.growth_funnel_session_upsert(uuid,text,integer,boolean,jsonb,text,text,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.growth_funnel_session_upsert(uuid,text,integer,boolean,jsonb,text,text,uuid)','EXECUTE'),'a funnel session moves only through a recorded visit, never a direct call');
SELECT pg_temp.require_true(public.operator_retirement_disposition('growth_public_visits')='delete','an account''s visits are deleted with it at retirement, never blocking it');

ROLLBACK;
