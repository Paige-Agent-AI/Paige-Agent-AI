-- ISOLATED full production-schema-only clone only; never execute on production.
-- INT-298 / INT-342 MBC slice 6a: a form-started process runs only for its form or campaign, and a campaign
-- step's outcome only stands on a proven finish. Real triggers, writers and reads; real JWT identity.
BEGIN;
SET LOCAL timezone='UTC';
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE FUNCTION pg_temp.require_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.require_denied(command text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
RAISE EXCEPTION 'FAIL: %',label; END $$;
CREATE FUNCTION pg_temp.require_refused(command text,reason text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM<>reason THEN RAISE EXCEPTION 'FAIL: % (refused with %, expected %)',label,SQLERRM,reason; END IF; RETURN; END;
RAISE EXCEPTION 'FAIL: %',label; END $$;
CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',uid,true),set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true) $$;
CREATE FUNCTION pg_temp.as_server() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
CREATE FUNCTION pg_temp.scope(automation text,scope jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.configure_process_scope(automation::uuid,scope,'human') $$;
CREATE FUNCTION pg_temp.payload(sub text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT payload FROM public.paige_native_events WHERE event_key='form.submitted' AND dedup_key='form.submitted:'||sub $$;

DO $fixture_owner$ DECLARE fixture_owner_id uuid; BEGIN
 IF (SELECT count(*) FROM public.user_roles WHERE role='super_admin')>1 THEN RAISE EXCEPTION 'FIXTURE: canonical owner is ambiguous'; END IF;
 SELECT user_id INTO fixture_owner_id FROM public.user_roles WHERE role='super_admin';
 IF fixture_owner_id IS NULL THEN
   fixture_owner_id := 'a2980600-0000-4000-8000-000000000004';
   INSERT INTO auth.users(id,email) VALUES(fixture_owner_id,'scope-fixture-owner@example.invalid');
   INSERT INTO public.user_roles(user_id,role) VALUES(fixture_owner_id,'super_admin');
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',fixture_owner_id)::text,true);
END $fixture_owner$;
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('a2980600-0000-4000-8000-000000000011','scope-proof-a','Scope proof A','active','standalone','SPA','{"system_workspace":true}'),
 ('a2980600-0000-4000-8000-000000000012','scope-proof-b','Scope proof B','active','standalone','SPB','{"system_workspace":true}');
SELECT pg_temp.as_server();
INSERT INTO auth.users(id,email) VALUES
 ('a2980600-0000-4000-8000-000000000001','scope-admin@example.invalid'),
 ('a2980600-0000-4000-8000-000000000002','scope-member@example.invalid'),
 ('a2980600-0000-4000-8000-000000000003','scope-admin-unsynced@example.invalid');
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('a2980600-0000-4000-8000-000000000011','a2980600-0000-4000-8000-000000000001','admin','active',false),
 ('a2980600-0000-4000-8000-000000000011','a2980600-0000-4000-8000-000000000002','member','active',false),
 ('a2980600-0000-4000-8000-000000000011','a2980600-0000-4000-8000-000000000003','admin','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('a2980600-0000-4000-8000-000000000001','a2980600-0000-4000-8000-000000000011'),
 ('a2980600-0000-4000-8000-000000000002','a2980600-0000-4000-8000-000000000011'),
 ('a2980600-0000-4000-8000-000000000003','a2980600-0000-4000-8000-000000000011')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
SELECT pg_temp.as_server();
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,account_number) VALUES
 ('a2980600-0000-4000-8000-0000000000c1','a2980600-0000-4000-8000-000000000011','a2980600-0000-4000-8000-000000000001','Dana','Lead','SPA-1');
INSERT INTO public.growth_forms(id,tenant_id,slug,name,status) VALUES
 ('a2980600-0000-4000-8000-0000000000f1','a2980600-0000-4000-8000-000000000011','spring-intake','Spring intake','active'),
 ('a2980600-0000-4000-8000-0000000000f2','a2980600-0000-4000-8000-000000000011','newsletter','Newsletter sign-up','active'),
 ('a2980600-0000-4000-8000-0000000000fb','a2980600-0000-4000-8000-000000000012','other-form','Other workspace form','active');
INSERT INTO public.campaign_briefs(id,tenant_id,short_ref,name,lifecycle_status) VALUES
 ('a2980600-0000-4000-8000-0000000000b1','a2980600-0000-4000-8000-000000000011','CB-SC1','Spring intake','draft'),
 ('a2980600-0000-4000-8000-0000000000b2','a2980600-0000-4000-8000-000000000011','CB-SC2','Old push','draft'),
 ('a2980600-0000-4000-8000-0000000000bb','a2980600-0000-4000-8000-000000000012','CB-SCB','Other workspace','draft');
INSERT INTO public.campaign_brief_asset_links(tenant_id,brief_id,asset_kind,asset_id,created_through) VALUES
 ('a2980600-0000-4000-8000-000000000011','a2980600-0000-4000-8000-0000000000b1','form','a2980600-0000-4000-8000-0000000000f1','human'),
 ('a2980600-0000-4000-8000-000000000011','a2980600-0000-4000-8000-0000000000b2','form','a2980600-0000-4000-8000-0000000000f1','human');
UPDATE public.campaign_briefs SET lifecycle_status='archived' WHERE id='a2980600-0000-4000-8000-0000000000b2';
INSERT INTO public.paige_automations(id,tenant_id,name,trigger_key,conditions) VALUES
 ('a2980600-0000-4000-8000-0000000000a1','a2980600-0000-4000-8000-000000000011','Welcome spring leads','form.submitted','[{"field":"payload.source","op":"eq","value":"public"}]'),
 ('a2980600-0000-4000-8000-0000000000a2','a2980600-0000-4000-8000-000000000011','New contact hello','contact.created','[]'),
 ('a2980600-0000-4000-8000-0000000000ab','a2980600-0000-4000-8000-000000000012','Other workspace process','form.submitted','[]');

-- 1. form.submitted names the live campaigns its form serves, and only those.
INSERT INTO public.growth_form_submissions(id,tenant_id,form_id,contact_id,payload_json) VALUES
 ('a2980600-0000-4000-8000-0000000000e1','a2980600-0000-4000-8000-000000000011','a2980600-0000-4000-8000-0000000000f1','a2980600-0000-4000-8000-0000000000c1','{}'),
 ('a2980600-0000-4000-8000-0000000000e2','a2980600-0000-4000-8000-000000000011','a2980600-0000-4000-8000-0000000000f2','a2980600-0000-4000-8000-0000000000c1','{}');
SELECT pg_temp.require_true(pg_temp.payload('a2980600-0000-4000-8000-0000000000e1')->'campaign_brief_ids'='["a2980600-0000-4000-8000-0000000000b1"]'::jsonb,'the event names the form''s live campaign, not the archived one');
SELECT pg_temp.require_true(pg_temp.payload('a2980600-0000-4000-8000-0000000000e2')->'campaign_brief_ids'='[]'::jsonb,'a form in no campaign names none');
SELECT pg_temp.require_true(pg_temp.payload('a2980600-0000-4000-8000-0000000000e1')->>'form_id'='a2980600-0000-4000-8000-0000000000f1','the form is still named');

-- 2. A form-started process cannot go live without its form or campaign, whoever writes it.
SELECT pg_temp.require_refused($$UPDATE public.paige_automations SET state='live' WHERE id='a2980600-0000-4000-8000-0000000000a1'$$,'PROCESS_SCOPE_REQUIRED','an unscoped form process cannot go live');
SELECT pg_temp.require_refused($$INSERT INTO public.paige_automations(tenant_id,name,trigger_key,state) VALUES ('a2980600-0000-4000-8000-000000000011','Born live','form.submitted','live')$$,'PROCESS_SCOPE_REQUIRED','nor be created live');
UPDATE public.paige_automations SET state='live' WHERE id='a2980600-0000-4000-8000-0000000000a2';
SELECT pg_temp.require_true((SELECT state='live' FROM public.paige_automations WHERE id='a2980600-0000-4000-8000-0000000000a2'),'other triggers are untouched');

-- 3. The owner/admin sets the scope; it replaces any earlier scope and keeps every other condition.
SELECT pg_temp.as_user('a2980600-0000-4000-8000-000000000001');
SELECT pg_temp.require_true((pg_temp.scope('a2980600-0000-4000-8000-0000000000a1','{"formId":"a2980600-0000-4000-8000-0000000000f1"}')->'scope'->>'kind')='form','scoped to one form');
SELECT pg_temp.require_true((SELECT conditions FROM public.paige_automations WHERE id='a2980600-0000-4000-8000-0000000000a1')
  ='[{"field":"payload.source","op":"eq","value":"public"},{"field":"payload.form_id","op":"eq","value":"a2980600-0000-4000-8000-0000000000f1"}]'::jsonb,'the condition is set beside the existing one');
SELECT pg_temp.require_true((public.get_process_scope('a2980600-0000-4000-8000-0000000000a1')->'scope'->'forms'->0->>'name')='Spring intake' AND (public.get_process_scope('a2980600-0000-4000-8000-0000000000a1')->>'can_go_live')::boolean,'the read names the form');
SELECT pg_temp.require_true((pg_temp.scope('a2980600-0000-4000-8000-0000000000a1','{"briefId":"a2980600-0000-4000-8000-0000000000b1"}')->'scope'->>'kind')='campaign','re-scoped to a campaign');
SELECT pg_temp.require_true((SELECT jsonb_array_length(conditions)=2 AND conditions->1='{"field":"payload.campaign_brief_ids","op":"contains","value":"a2980600-0000-4000-8000-0000000000b1"}'::jsonb
  FROM public.paige_automations WHERE id='a2980600-0000-4000-8000-0000000000a1'),'one scope only, the other condition kept');
SELECT pg_temp.require_true((public.get_process_scope('a2980600-0000-4000-8000-0000000000a1')->'scope'->'campaign'->>'name')='Spring intake','the read names the campaign');
SELECT pg_temp.require_true((pg_temp.scope('a2980600-0000-4000-8000-0000000000a1','{"formIds":["a2980600-0000-4000-8000-0000000000f2","a2980600-0000-4000-8000-0000000000f1","a2980600-0000-4000-8000-0000000000f1"]}')->'scope'->'form_ids')
  ='["a2980600-0000-4000-8000-0000000000f1","a2980600-0000-4000-8000-0000000000f2"]'::jsonb,'several forms, each once');
SELECT pg_temp.require_true((SELECT conditions->1->'value' FROM public.paige_automations WHERE id='a2980600-0000-4000-8000-0000000000a1')
  ='["a2980600-0000-4000-8000-0000000000f1","a2980600-0000-4000-8000-0000000000f2"]'::jsonb,'the stored condition names each form once');
SELECT pg_temp.as_server();
UPDATE public.paige_automations SET state='live' WHERE id='a2980600-0000-4000-8000-0000000000a1';
SELECT pg_temp.require_true((SELECT state='live' FROM public.paige_automations WHERE id='a2980600-0000-4000-8000-0000000000a1'),'a scoped form process goes live');

-- 4. Refusals: other workspace, bad shape, two scopes, another trigger, a member.
SELECT pg_temp.as_user('a2980600-0000-4000-8000-000000000001');
SELECT pg_temp.require_refused($$SELECT pg_temp.scope('a2980600-0000-4000-8000-0000000000a1','{"formId":"a2980600-0000-4000-8000-0000000000fb"}')$$,'PROCESS_SCOPE_NOT_FOUND','another workspace''s form');
SELECT pg_temp.require_refused($$SELECT pg_temp.scope('a2980600-0000-4000-8000-0000000000a1','{"briefId":"a2980600-0000-4000-8000-0000000000bb"}')$$,'PROCESS_SCOPE_NOT_FOUND','another workspace''s campaign');
SELECT pg_temp.require_refused($$SELECT pg_temp.scope('a2980600-0000-4000-8000-0000000000a1','{"formId":"not-a-uuid"}')$$,'PROCESS_SCOPE_INVALID','a form is an id');
SELECT pg_temp.require_refused($$SELECT pg_temp.scope('a2980600-0000-4000-8000-0000000000a1','{"formIds":[]}')$$,'PROCESS_SCOPE_INVALID','at least one form');
SELECT pg_temp.require_refused($$SELECT pg_temp.scope('a2980600-0000-4000-8000-0000000000a1','{"formId":"a2980600-0000-4000-8000-0000000000f1","briefId":"a2980600-0000-4000-8000-0000000000b1"}')$$,'PROCESS_SCOPE_INVALID','a form or a campaign, not both');
SELECT pg_temp.require_refused($$SELECT pg_temp.scope('a2980600-0000-4000-8000-0000000000a2','{"formId":"a2980600-0000-4000-8000-0000000000f1"}')$$,'PROCESS_NOT_FORM_STARTED','only form-started processes take a form scope');
SELECT pg_temp.require_refused($$SELECT pg_temp.scope('a2980600-0000-4000-8000-0000000000ab','{"formId":"a2980600-0000-4000-8000-0000000000f1"}')$$,'PROCESS_NOT_FOUND','another workspace''s process');
SELECT pg_temp.as_user('a2980600-0000-4000-8000-000000000002');
SELECT pg_temp.require_denied($$SELECT pg_temp.scope('a2980600-0000-4000-8000-0000000000a1','{"formId":"a2980600-0000-4000-8000-0000000000f1"}')$$,'a member cannot scope a process');
SELECT pg_temp.as_server();
SELECT pg_temp.require_refused($$UPDATE public.paige_automations SET conditions='[{"field":"payload.form_id","op":"eq","value":"a2980600-0000-4000-8000-0000000000f1"},{"field":"payload.campaign_brief_ids","op":"contains","value":"a2980600-0000-4000-8000-0000000000b1"}]' WHERE id='a2980600-0000-4000-8000-0000000000a1'$$,'PROCESS_SCOPE_INVALID','a direct write cannot give two scopes');
SELECT pg_temp.require_refused($$UPDATE public.paige_automations SET conditions='[{"field":"payload.form_id","op":"eq","value":"a2980600-0000-4000-8000-0000000000fb"}]' WHERE id='a2980600-0000-4000-8000-0000000000a1'$$,'PROCESS_SCOPE_NOT_FOUND','a direct write cannot name another workspace''s form');
SELECT pg_temp.require_refused($$UPDATE public.paige_automations SET conditions='[]' WHERE id='a2980600-0000-4000-8000-0000000000a1'$$,'PROCESS_SCOPE_REQUIRED','a live form process cannot drop its scope');
SELECT pg_temp.require_true((SELECT count(*)=3 FROM public.audit_logs WHERE action='process.scope' AND data->>'tenant_id'='a2980600-0000-4000-8000-000000000011'),'every scope change is audited once');

-- 5. A step marked done with nothing behind it takes no outcome and never reads as observed.
INSERT INTO public.paige_actions(id,tenant_id,action_kind,from_department,to_department,title,status,result) VALUES
 ('a2980600-0000-4000-8000-0000000000d1','a2980600-0000-4000-8000-000000000011','marketing.campaign_action','marketing','marketing','Marked done unseen','done',NULL),
 ('a2980600-0000-4000-8000-0000000000d2','a2980600-0000-4000-8000-000000000011','marketing.campaign_action','marketing','marketing','Approved and done','done','{"approval_status":"approved"}');
SELECT pg_temp.as_user('a2980600-0000-4000-8000-000000000001');
SELECT public.configure_campaign_brief_actions(NULL,jsonb_build_object('type','link_action','briefId','a2980600-0000-4000-8000-0000000000b1','actionId',x,'tactic','Launch','family','email'),'link-'||x,'human')
  FROM unnest(ARRAY['a2980600-0000-4000-8000-0000000000d1','a2980600-0000-4000-8000-0000000000d2']) x;
SELECT pg_temp.require_refused($$SELECT public.configure_campaign_brief_actions(NULL,'{"type":"record_outcome","briefId":"a2980600-0000-4000-8000-0000000000b1","actionId":"a2980600-0000-4000-8000-0000000000d1","observed":{"summary":"Lots of replies"}}','o-1','human')$$,'CAMPAIGN_ACTION_NOT_PROVEN','a recorded step takes no outcome');
SELECT pg_temp.require_true((public.configure_campaign_brief_actions(NULL,'{"type":"record_outcome","briefId":"a2980600-0000-4000-8000-0000000000b1","actionId":"a2980600-0000-4000-8000-0000000000d2","observed":{"summary":"Twelve replies"}}','o-2','human')->>'lifecycle')='outcome_observed','an approved step takes its outcome');
SELECT pg_temp.as_server();
UPDATE public.campaign_brief_actions SET observed_result='{"summary":"Planted"}', observed_at=now(), observed_through='paige',
  evaluation='{"verdict":"met"}', evaluated_at=now(), evaluated_through='paige' WHERE action_id='a2980600-0000-4000-8000-0000000000d1';
SELECT pg_temp.as_user('a2980600-0000-4000-8000-000000000001');
CREATE TEMP TABLE r1 AS SELECT public.get_campaign_brief_actions(NULL,'a2980600-0000-4000-8000-0000000000b1') v;
SELECT pg_temp.require_true((SELECT a->>'lifecycle'='recorded' AND a->'observed_result'='null'::jsonb AND a->'evaluation'='null'::jsonb
  FROM r1, jsonb_array_elements(v->'actions') a WHERE a->>'action_id'='a2980600-0000-4000-8000-0000000000d1'),'a planted outcome on a recorded step never reads as an evaluated success') FROM r1;
SELECT pg_temp.require_true((SELECT a->>'lifecycle'='outcome_observed' AND a->'observed_result'->>'summary'='Twelve replies'
  FROM r1, jsonb_array_elements(v->'actions') a WHERE a->>'action_id'='a2980600-0000-4000-8000-0000000000d2'),'an approved step keeps its outcome') FROM r1;

-- 6. Marketing admits on the tenant policy; a refusal by the action bus is reported as the bus's.
SELECT pg_temp.as_server();
DELETE FROM public.user_roles WHERE user_id='a2980600-0000-4000-8000-000000000003' AND role IN ('admin','coach','super_admin');
SELECT pg_temp.as_user('a2980600-0000-4000-8000-000000000003');
SELECT pg_temp.require_true(public.is_tenant_admin('a2980600-0000-4000-8000-000000000011'),'FIXTURE: still the workspace''s admin');
DO $bus$ BEGIN
  PERFORM public.configure_campaign_brief_actions(NULL,'{"type":"plan_action","briefId":"a2980600-0000-4000-8000-0000000000b1","title":"Send the invite","tactic":"Launch","family":"email"}','plan-unsynced','human');
  RAISE EXCEPTION 'FAIL: the bus refusal is reported';
EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM <> 'CAMPAIGN_ACTION_BUS_REFUSED' THEN RAISE EXCEPTION 'FAIL: the bus refusal is named (got %)', SQLERRM; END IF;
END $bus$;
SELECT pg_temp.as_server();
SELECT pg_temp.require_true((SELECT count(*)=0 FROM public.paige_actions WHERE title='Send the invite'),'a refused step is not planned');
ROLLBACK;
