-- ISOLATED full production-schema-only clone only; never execute on production.
-- INT-298 / INT-342 MBC slice 6c: the reads PAIGE calls refuse any business but the one the chat is in; a step
-- PAIGE plans and a scope PAIGE sets go through the dossier's own writer and the scope seam, marked as hers;
-- the four writes ask first in Autonomy settings and read as PAIGE's in the activity record. Real JWT identity.
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

DO $fixture_owner$ DECLARE fixture_owner_id uuid; BEGIN
 IF (SELECT count(*) FROM public.user_roles WHERE role='super_admin')>1 THEN RAISE EXCEPTION 'FIXTURE: canonical owner is ambiguous'; END IF;
 SELECT user_id INTO fixture_owner_id FROM public.user_roles WHERE role='super_admin';
 IF fixture_owner_id IS NULL THEN
   fixture_owner_id := 'a2980700-0000-4000-8000-000000000004';
   INSERT INTO auth.users(id,email) VALUES(fixture_owner_id,'steps-chat-fixture-owner@example.invalid');
   INSERT INTO public.user_roles(user_id,role) VALUES(fixture_owner_id,'super_admin');
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',fixture_owner_id)::text,true);
END $fixture_owner$;
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('a2980700-0000-4000-8000-000000000011','steps-chat-a','Steps chat A','active','standalone','SCA','{"system_workspace":true}'),
 ('a2980700-0000-4000-8000-000000000012','steps-chat-b','Steps chat B','active','standalone','SCB','{"system_workspace":true}');
SELECT pg_temp.as_server();
INSERT INTO auth.users(id,email) VALUES
 ('a2980700-0000-4000-8000-000000000001','steps-chat-admin@example.invalid'),
 ('a2980700-0000-4000-8000-000000000002','steps-chat-member@example.invalid');
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('a2980700-0000-4000-8000-000000000011','a2980700-0000-4000-8000-000000000001','admin','active',false),
 ('a2980700-0000-4000-8000-000000000011','a2980700-0000-4000-8000-000000000002','member','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('a2980700-0000-4000-8000-000000000001','a2980700-0000-4000-8000-000000000011'),
 ('a2980700-0000-4000-8000-000000000002','a2980700-0000-4000-8000-000000000011')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
SELECT pg_temp.as_server();
INSERT INTO public.growth_forms(id,tenant_id,slug,name,status) VALUES
 ('a2980700-0000-4000-8000-0000000000f1','a2980700-0000-4000-8000-000000000011','steps-chat-intake','Spring intake','active');
INSERT INTO public.campaign_briefs(id,tenant_id,short_ref,name,lifecycle_status) VALUES
 ('a2980700-0000-4000-8000-0000000000b1','a2980700-0000-4000-8000-000000000011','CB-STC1','Spring intake','draft'),
 ('a2980700-0000-4000-8000-0000000000bb','a2980700-0000-4000-8000-000000000012','CB-STCB','Other workspace','draft');
INSERT INTO public.paige_automations(id,tenant_id,name,trigger_key,conditions) VALUES
 ('a2980700-0000-4000-8000-0000000000a1','a2980700-0000-4000-8000-000000000011','Welcome spring leads','form.submitted','[]'),
 ('a2980700-0000-4000-8000-0000000000a2','a2980700-0000-4000-8000-000000000011','New contact hello','contact.created','[]');

-- 1. The reads answer only for the business the chat is in.
SELECT pg_temp.as_user('a2980700-0000-4000-8000-000000000001');
SELECT pg_temp.require_true((public.read_campaign_steps('a2980700-0000-4000-8000-000000000011',NULL)->>'can_manage')::boolean,'an admin reads the campaign steps of the business the chat is in');
SELECT pg_temp.require_error($$SELECT public.read_campaign_steps('a2980700-0000-4000-8000-000000000012',NULL)$$,'active_account_changed','another business is refused, never read');
SELECT pg_temp.require_error($$SELECT public.read_campaign_steps(NULL,NULL)$$,'active_account_changed','no business named is refused');
SELECT pg_temp.require_error($$SELECT public.read_process_scope('a2980700-0000-4000-8000-000000000012','a2980700-0000-4000-8000-0000000000a1')$$,'active_account_changed','a process read naming another business is refused');
SELECT pg_temp.require_true(public.read_process_scope('a2980700-0000-4000-8000-000000000011','a2980700-0000-4000-8000-0000000000a1')->'scope' = 'null'::jsonb,'an unscoped form process reads as unscoped');
SELECT pg_temp.require_true((public.read_process_scope('a2980700-0000-4000-8000-000000000011','a2980700-0000-4000-8000-0000000000a2')->>'applies')::boolean = false,'a process on another trigger has no form scope');

-- 2. A step PAIGE plans is the bus's own action, through the dossier's writer, and reads as hers.
SELECT public.configure_campaign_brief_actions('a2980700-0000-4000-8000-000000000011',
  '{"type":"plan_action","briefId":"a2980700-0000-4000-8000-0000000000b1","title":"Thank everyone who booked","tactic":"Win-back email","family":"email","dueAt":"2031-03-01T12:00:00.000Z"}'::jsonb,
  'chat:steps-proof-plan','paige');
SELECT pg_temp.require_true((SELECT count(*)=1 FROM jsonb_array_elements(public.read_campaign_steps('a2980700-0000-4000-8000-000000000011','a2980700-0000-4000-8000-0000000000b1')->'actions') s
  WHERE s->>'created_through'='paige' AND s->>'lifecycle'='planned' AND (s->>'due_at')::timestamptz='2031-03-01T12:00:00Z'),'the planned step reads back as PAIGE''s, planned, on the day asked');
SELECT pg_temp.require_true((SELECT count(*)=1 FROM public.paige_actions a JOIN public.campaign_brief_actions l ON l.action_id=a.id
  WHERE l.brief_id='a2980700-0000-4000-8000-0000000000b1' AND a.action_kind='marketing.campaign_action' AND a.autonomy_lane='confirm'),'the step is one action-bus row of the record-only kind, at confirm');
-- The same ask again returns the step already planned, not a second one.
SELECT public.configure_campaign_brief_actions('a2980700-0000-4000-8000-000000000011',
  '{"type":"plan_action","briefId":"a2980700-0000-4000-8000-0000000000b1","title":"Thank everyone who booked","tactic":"Win-back email","family":"email","dueAt":"2031-03-01T12:00:00.000Z"}'::jsonb,
  'chat:steps-proof-plan','paige');
SELECT pg_temp.require_true((SELECT count(*)=1 FROM public.campaign_brief_actions WHERE brief_id='a2980700-0000-4000-8000-0000000000b1'),'replaying the same request key plans nothing twice');

-- 3. A scope PAIGE sets goes through the seam and reads back by name.
SELECT public.configure_process_scope('a2980700-0000-4000-8000-0000000000a1','{"formIds":["a2980700-0000-4000-8000-0000000000f1"]}'::jsonb,'paige');
SELECT pg_temp.require_true(public.read_process_scope('a2980700-0000-4000-8000-000000000011','a2980700-0000-4000-8000-0000000000a1')#>>'{scope,forms,0,name}'='Spring intake','the scope reads back with the form''s name');
SELECT pg_temp.require_true((SELECT state FROM public.paige_automations WHERE id='a2980700-0000-4000-8000-0000000000a1')='draft','setting a scope never switches the process on');

-- 4. A member reads the plan without names; an anonymous caller reads nothing.
SELECT pg_temp.as_user('a2980700-0000-4000-8000-000000000002');
SELECT pg_temp.require_true((SELECT bool_and(s->'title' = 'null'::jsonb) FROM jsonb_array_elements(public.read_campaign_steps('a2980700-0000-4000-8000-000000000011',NULL)->'actions') s),'a member reads steps without their names');
SELECT pg_temp.as_server();
SELECT pg_temp.require_error($$SELECT public.read_campaign_steps('a2980700-0000-4000-8000-000000000011',NULL)$$,'CAMPAIGN_BRIEF_FORBIDDEN','no signed-in person reads nothing');
SELECT pg_temp.require_true(NOT has_function_privilege('anon','public.read_campaign_steps(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.read_process_scope(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.read_campaign_steps(uuid,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.read_process_scope(uuid,uuid)','EXECUTE'),'the reads are for a signed-in person only');

-- 5. The four writes ask first in Autonomy settings, beside everything that was there; activity reads as PAIGE's.
SELECT pg_temp.as_user('a2980700-0000-4000-8000-000000000001');
SELECT pg_temp.require_true((SELECT count(*)=4 FROM public.list_tool_autonomy(NULL)
  WHERE tool_key IN ('campaign_step_plan','campaign_step_record_result','campaign_step_judge','process_scope_set') AND mode='confirm' AND is_default AND category='Campaigns'),'the four writes ask first by default');
SELECT pg_temp.require_true((SELECT count(*)=1 FROM public.list_tool_autonomy(NULL) WHERE tool_key='set_ad_creative_featured'),'earlier catalogue rows are forwarded unchanged');
SELECT pg_temp.require_true(public._workspace_event_display('capability_run','capability_succeeded','campaign_step_plan')->>'title'='PAIGE planned a campaign step','a planned step reads as PAIGE''s in the activity record');
SELECT pg_temp.require_true(public._workspace_event_display('capability_run','capability_succeeded','process_scope_set')->>'summary' LIKE '%not switched on or off%','a scope change says it switched nothing on');
SELECT pg_temp.require_true(public._workspace_event_display('capability_run','capability_succeeded','email_series_draft')->>'title'='PAIGE saved an email series draft','other wording is forwarded unchanged');

ROLLBACK;
