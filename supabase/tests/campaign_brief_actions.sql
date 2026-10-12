-- ISOLATED full production-schema-only clone only; never execute on production.
-- INT-298 / INT-342 MBC slice 5: the Marketing Action contract through the real writer, the real
-- action-bus writer (file_action) and the read's derived lifecycle.
-- Real auth users, JWT identity, membership triggers and scope helpers. No auth helper replacement.
BEGIN;
SET LOCAL timezone='UTC';
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE FUNCTION pg_temp.require_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.require_denied(command text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
RAISE EXCEPTION 'FAIL: %',label; END $$;
-- Expects the named refusal (SQLSTATE 22023 with this message).
CREATE FUNCTION pg_temp.require_refused(command text,reason text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM<>reason THEN RAISE EXCEPTION 'FAIL: % (refused with %, expected %)',label,SQLERRM,reason; END IF; RETURN; END;
RAISE EXCEPTION 'FAIL: %',label; END $$;
CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',uid,true),set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true) $$;
CREATE FUNCTION pg_temp.cmd(command jsonb,key text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.configure_campaign_brief_actions(NULL,command,key,'human') $$;
CREATE FUNCTION pg_temp.link(action text,brief text,tactic text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.configure_campaign_brief_actions(NULL,jsonb_build_object('type','link_action','briefId',brief,'actionId',action,'tactic',tactic,'family','email'),'link-'||action||'-'||brief,'human') $$;
CREATE FUNCTION pg_temp.lifecycle(read jsonb,action text) RETURNS text LANGUAGE sql AS $$
 SELECT a->>'lifecycle' FROM jsonb_array_elements(read->'actions') a WHERE a->>'action_id'=action $$;
CREATE FUNCTION pg_temp.entry(read jsonb,action text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT a FROM jsonb_array_elements(read->'actions') a WHERE a->>'action_id'=action $$;

INSERT INTO auth.users(id,email) VALUES
 ('a2980500-0000-4000-8000-000000000001','actions-admin@example.invalid'),
 ('a2980500-0000-4000-8000-000000000002','actions-member@example.invalid');
DO $fixture_owner$ DECLARE fixture_owner_id uuid; BEGIN
 IF (SELECT count(*) FROM public.user_roles WHERE role='super_admin')>1 THEN RAISE EXCEPTION 'FIXTURE: canonical owner is ambiguous'; END IF;
 SELECT user_id INTO fixture_owner_id FROM public.user_roles WHERE role='super_admin';
 IF fixture_owner_id IS NULL THEN
   fixture_owner_id := 'a2980500-0000-4000-8000-000000000004';
   INSERT INTO auth.users(id,email) VALUES(fixture_owner_id,'actions-fixture-owner@example.invalid');
   INSERT INTO public.user_roles(user_id,role) VALUES(fixture_owner_id,'super_admin');
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',fixture_owner_id)::text,true);
 IF public.is_platform_owner() IS DISTINCT FROM true THEN RAISE EXCEPTION 'FIXTURE: canonical owner guard unavailable'; END IF;
END $fixture_owner$;
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('a2980500-0000-4000-8000-000000000011','actions-proof-a','Actions proof A','active','standalone','APA','{"system_workspace":true}'),
 ('a2980500-0000-4000-8000-000000000012','actions-proof-b','Actions proof B','active','standalone','APB','{"system_workspace":true}');
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('a2980500-0000-4000-8000-000000000011','a2980500-0000-4000-8000-000000000001','admin','active',false),
 ('a2980500-0000-4000-8000-000000000011','a2980500-0000-4000-8000-000000000002','member','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('a2980500-0000-4000-8000-000000000001','a2980500-0000-4000-8000-000000000011'),
 ('a2980500-0000-4000-8000-000000000002','a2980500-0000-4000-8000-000000000011')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;

-- A strategy, its campaigns, and a campaign in another workspace.
INSERT INTO public.business_missions(id,tenant_id,requested_by,request_source,title) VALUES
 ('a2980500-0000-4000-8000-0000000000e1','a2980500-0000-4000-8000-000000000011','a2980500-0000-4000-8000-000000000001','owner','Fill the spring cohort');
INSERT INTO public.campaign_briefs(id,tenant_id,short_ref,name,objective,lifecycle_status,mission_id) VALUES
 ('a2980500-0000-4000-8000-0000000000c1','a2980500-0000-4000-8000-000000000011','CB-ACT1','Spring intake','Twenty discovery calls','draft','a2980500-0000-4000-8000-0000000000e1'),
 ('a2980500-0000-4000-8000-0000000000c2','a2980500-0000-4000-8000-000000000011','CB-ACT2','Winter wrap-up',NULL,'archived',NULL),
 ('a2980500-0000-4000-8000-0000000000c4','a2980500-0000-4000-8000-000000000011','CB-ACT4','Summer referrals',NULL,'draft',NULL),
 ('a2980500-0000-4000-8000-0000000000c3','a2980500-0000-4000-8000-000000000012','CB-ACTB','Other workspace brief',NULL,'draft',NULL);
INSERT INTO public.paige_automations(id,tenant_id,name,trigger_key) VALUES
 ('a2980500-0000-4000-8000-0000000000f1','a2980500-0000-4000-8000-000000000011','Welcome new form leads','form.submitted'),
 ('a2980500-0000-4000-8000-0000000000f8','a2980500-0000-4000-8000-000000000012','Other workspace process','form.submitted');
INSERT INTO public.paige_workflow_registry(id,key,label,category,tenant_id) VALUES
 ('a2980500-0000-4000-8000-0000000000f2','actions-proof-send','Proof run','marketing','a2980500-0000-4000-8000-000000000011');
INSERT INTO public.paige_workflow_runs(id,registry_id,tenant_id,status) VALUES
 ('a2980500-0000-4000-8000-0000000000f3','a2980500-0000-4000-8000-0000000000f2','a2980500-0000-4000-8000-000000000011','running'),
 ('a2980500-0000-4000-8000-0000000000f4','a2980500-0000-4000-8000-0000000000f2','a2980500-0000-4000-8000-000000000011','succeeded');
-- A run whose durable work could not tell whether its effect happened.
INSERT INTO public.paige_durable_work(id,tenant_id,initiating_user_id,intent_id,capability_key,work_kind,authority_context,scope_epoch,idempotency_key,status) VALUES
 ('a2980500-0000-4000-8000-0000000000f5','a2980500-0000-4000-8000-000000000011','a2980500-0000-4000-8000-000000000001','a2980500-0000-4000-8000-0000000000f7',
  'marketing.proof','proof','{}','proof-epoch','actions-proof-unknown','outcome_unknown');
INSERT INTO public.paige_workflow_runs(id,registry_id,tenant_id,status,work_id) VALUES
 ('a2980500-0000-4000-8000-0000000000f6','a2980500-0000-4000-8000-0000000000f2','a2980500-0000-4000-8000-000000000011','running','a2980500-0000-4000-8000-0000000000f5');
-- Actions already on the bus in every state, written by the server role as the bus's own writers would.
INSERT INTO public.paige_actions(id,tenant_id,action_kind,from_department,to_department,title,status,due_at,result,workflow_run_id) VALUES
 ('a2980500-0000-4000-8000-0000000000d1','a2980500-0000-4000-8000-000000000011','marketing.campaign_action','marketing','marketing','Draft the invite','drafted',NULL,NULL,NULL),
 ('a2980500-0000-4000-8000-0000000000d2','a2980500-0000-4000-8000-000000000011','marketing.campaign_action','marketing','marketing','Approve the invite','pending_approval',NULL,NULL,NULL),
 ('a2980500-0000-4000-8000-0000000000d3','a2980500-0000-4000-8000-000000000011','marketing.campaign_action','marketing','marketing','Reminder next week','approved',now()+interval '7 days',NULL,NULL),
 ('a2980500-0000-4000-8000-0000000000d4','a2980500-0000-4000-8000-000000000011','marketing.campaign_action','marketing','marketing','Post the teaser','approved',NULL,NULL,NULL),
 ('a2980500-0000-4000-8000-0000000000d5','a2980500-0000-4000-8000-000000000011','marketing.campaign_action','marketing','marketing','Send the invite','executing',NULL,NULL,'a2980500-0000-4000-8000-0000000000f3'),
 ('a2980500-0000-4000-8000-0000000000d6','a2980500-0000-4000-8000-000000000011','marketing.campaign_action','marketing','marketing','Announce the cohort','done',NULL,'{"approval_status":"approved"}','a2980500-0000-4000-8000-0000000000f4'),
 ('a2980500-0000-4000-8000-0000000000d7','a2980500-0000-4000-8000-000000000011','marketing.campaign_action','marketing','marketing','Partner shout-out','failed',NULL,NULL,NULL),
 ('a2980500-0000-4000-8000-0000000000d8','a2980500-0000-4000-8000-000000000011','marketing.campaign_action','marketing','marketing','Webinar slot','blocked',NULL,NULL,NULL),
 ('a2980500-0000-4000-8000-0000000000d9','a2980500-0000-4000-8000-000000000011','marketing.campaign_action','marketing','marketing','Old idea','dismissed',NULL,NULL,NULL),
 ('a2980500-0000-4000-8000-0000000000da','a2980500-0000-4000-8000-000000000011','marketing.campaign_action','marketing','marketing','Thank-you note','done',NULL,'{"approval_status":"approved"}',NULL),
 ('a2980500-0000-4000-8000-0000000000dc','a2980500-0000-4000-8000-000000000011','marketing.campaign_action','marketing','marketing','Text the list','executing',NULL,NULL,'a2980500-0000-4000-8000-0000000000f6'),
 ('a2980500-0000-4000-8000-0000000000db','a2980500-0000-4000-8000-000000000012','marketing.campaign_action','marketing','marketing','Other workspace action','filed',NULL,NULL,NULL);

SELECT pg_temp.require_true(public.operator_retirement_disposition('campaign_brief_actions')='delete','actions retire with the account');
SELECT pg_temp.require_true(public.operator_retirement_disposition('campaign_brief_asset_links')='delete','existing retirement entries are kept');
SELECT pg_temp.require_true((SELECT executor='record_only' AND requires_approval AND default_autonomy_lane='confirm' AND draft_subagent_slug IS NULL
  AND tenant_id IS NULL AND enabled FROM public.paige_action_kinds WHERE slug='marketing.campaign_action'),'the campaign-step kind waits for approval and drafts nothing');

-- Planning asks for confirm itself: even a workspace whose kind default were auto gets a step that waits.
UPDATE public.paige_action_kinds SET default_autonomy_lane='auto' WHERE slug='marketing.campaign_action';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2980500-0000-4000-8000-000000000001');

-- 1. Planning files a real bus action at confirm, linked to the campaign; nothing is drafted or sent.
SELECT pg_temp.require_true((pg_temp.cmd(jsonb_build_object('type','plan_action','briefId','a2980500-0000-4000-8000-0000000000c1',
  'title','Invite past clients','summary','One email to everyone who finished last year','tactic','Win-back email','family','email',
  'dueAt','2031-03-01T09:00:00Z','automationId','a2980500-0000-4000-8000-0000000000f1',
  'expectedResult',jsonb_build_object('summary','Ten replies','metricKey','marketing.leads.captured','target',10)),'plan-1')->>'outcome')='planned','an owner plans a step');
SELECT pg_temp.require_true((SELECT count(*)=1 FROM public.campaign_brief_actions WHERE brief_id='a2980500-0000-4000-8000-0000000000c1'),'the step is linked');
RESET ROLE;
UPDATE public.paige_action_kinds SET default_autonomy_lane='confirm' WHERE slug='marketing.campaign_action';
SELECT pg_temp.require_true((SELECT a.status='filed' AND a.autonomy_lane='confirm' AND a.action_kind='marketing.campaign_action'
  AND a.payload->>'campaign_brief_id'='a2980500-0000-4000-8000-0000000000c1' AND a.due_at='2031-03-01T09:00:00Z' AND a.approval_id IS NULL
  AND a.tenant_id='a2980500-0000-4000-8000-000000000011' AND l.automation_id='a2980500-0000-4000-8000-0000000000f1'
  AND l.expected_result=jsonb_build_object('summary','Ten replies','metric_key','marketing.leads.captured','target',10)
  FROM public.campaign_brief_actions l JOIN public.paige_actions a ON a.id=l.action_id),'the bus row is filed at confirm with its plan');
SELECT pg_temp.require_true((SELECT count(*)=1 FROM public.audit_logs WHERE action='file_action' AND data->>'tenant_id'='a2980500-0000-4000-8000-000000000011'),'the bus audits its own filing');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2980500-0000-4000-8000-000000000001');

-- 2. A replay returns the cached answer; the same key for a different command conflicts.
SELECT pg_temp.require_true((pg_temp.cmd(jsonb_build_object('type','plan_action','briefId','a2980500-0000-4000-8000-0000000000c1',
  'title','Invite past clients','summary','One email to everyone who finished last year','tactic','Win-back email','family','email',
  'dueAt','2031-03-01T09:00:00Z','automationId','a2980500-0000-4000-8000-0000000000f1',
  'expectedResult',jsonb_build_object('summary','Ten replies','metricKey','marketing.leads.captured','target',10)),'plan-1')->>'outcome')='planned','a replay is the cached answer');
SELECT pg_temp.require_true((SELECT count(*)=1 FROM public.campaign_brief_actions),'a replay files nothing');
SELECT pg_temp.require_refused($$SELECT pg_temp.cmd('{"type":"plan_action","briefId":"a2980500-0000-4000-8000-0000000000c1","title":"Other","tactic":"x","family":"email"}','plan-1')$$,'CAMPAIGN_BRIEF_IDEMPOTENCY_CONFLICT','a reused key for another command conflicts');

-- 3. Linking existing actions; every lifecycle is derived from the action's own status.
SELECT pg_temp.link(x,'a2980500-0000-4000-8000-0000000000c1','Spring launch') FROM unnest(ARRAY[
 'a2980500-0000-4000-8000-0000000000d1','a2980500-0000-4000-8000-0000000000d2','a2980500-0000-4000-8000-0000000000d3',
 'a2980500-0000-4000-8000-0000000000d4','a2980500-0000-4000-8000-0000000000d5','a2980500-0000-4000-8000-0000000000d6',
 'a2980500-0000-4000-8000-0000000000d7','a2980500-0000-4000-8000-0000000000d8','a2980500-0000-4000-8000-0000000000d9',
 'a2980500-0000-4000-8000-0000000000dc']) x;
SELECT pg_temp.require_true((pg_temp.cmd('{"type":"link_action","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d1","tactic":"Spring launch","family":"email"}','link-again')->>'outcome')='already_linked','linking twice says so');
CREATE TEMP TABLE r1 AS SELECT public.get_campaign_brief_actions(NULL,'a2980500-0000-4000-8000-0000000000c1') v;
SELECT pg_temp.require_true(jsonb_array_length(v->'actions')=11 AND (v->>'can_manage')::boolean,'the owner reads eleven actions') FROM r1;
SELECT pg_temp.require_true(
  pg_temp.lifecycle(v,'a2980500-0000-4000-8000-0000000000d1')='prepared' AND
  pg_temp.lifecycle(v,'a2980500-0000-4000-8000-0000000000d2')='approval_required' AND
  pg_temp.lifecycle(v,'a2980500-0000-4000-8000-0000000000d3')='scheduled' AND
  pg_temp.lifecycle(v,'a2980500-0000-4000-8000-0000000000d4')='approved' AND
  pg_temp.lifecycle(v,'a2980500-0000-4000-8000-0000000000d5')='executing' AND
  pg_temp.lifecycle(v,'a2980500-0000-4000-8000-0000000000d6')='completed' AND
  pg_temp.lifecycle(v,'a2980500-0000-4000-8000-0000000000d7')='failed' AND
  pg_temp.lifecycle(v,'a2980500-0000-4000-8000-0000000000d8')='blocked' AND
  pg_temp.lifecycle(v,'a2980500-0000-4000-8000-0000000000d9')='stopped' AND
  pg_temp.lifecycle(v,'a2980500-0000-4000-8000-0000000000dc')='unknown' AND
  pg_temp.entry(v,'a2980500-0000-4000-8000-0000000000dc')->'evidence'->>'durable_work_status'='outcome_unknown' AND
  (SELECT count(*)=1 FROM jsonb_array_elements(v->'actions') a WHERE a->>'lifecycle'='planned'),'each status maps to its lifecycle') FROM r1;
SELECT pg_temp.require_true(
  pg_temp.entry(v,'a2980500-0000-4000-8000-0000000000d6')->'evidence'->>'basis'='workflow_run' AND
  pg_temp.entry(v,'a2980500-0000-4000-8000-0000000000d6')->'evidence'->>'workflow_run_status'='succeeded' AND
  pg_temp.entry(v,'a2980500-0000-4000-8000-0000000000d7')->'evidence'->>'basis'='recorded' AND
  pg_temp.entry(v,'a2980500-0000-4000-8000-0000000000d5')->'evidence'->>'workflow_run_status'='running' AND
  NOT (pg_temp.entry(v,'a2980500-0000-4000-8000-0000000000d5')->'evidence' ? 'basis') AND
  pg_temp.entry(v,'a2980500-0000-4000-8000-0000000000d1')->>'title'='Draft the invite','evidence says what a finish rests on') FROM r1;
SELECT pg_temp.require_true((SELECT b->'mission'->>'title'='Fill the spring cohort' AND b->>'objective'='Twenty discovery calls'
  FROM jsonb_array_elements(v->'briefs') b WHERE b->>'brief_id'='a2980500-0000-4000-8000-0000000000c1'),'the campaign carries its strategy') FROM r1;

-- 4. Outcomes only after a finish; evaluation only after an outcome.
SELECT pg_temp.require_refused($$SELECT pg_temp.cmd('{"type":"record_outcome","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d2","observed":{"summary":"Nothing yet"}}','o-1')$$,'CAMPAIGN_ACTION_NOT_FINISHED','an unfinished action has no outcome');
SELECT pg_temp.require_refused($$SELECT pg_temp.cmd('{"type":"evaluate_outcome","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d6","verdict":"met"}','o-2')$$,'CAMPAIGN_ACTION_NO_OUTCOME','no evaluation without an outcome');
SELECT pg_temp.require_refused($$SELECT pg_temp.cmd('{"type":"record_outcome","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d6","observed":{"summary":"Twelve replies","value":"12"}}','o-3')$$,'CAMPAIGN_ACTION_RESULT_INVALID','a value is a number');
SELECT pg_temp.require_true((pg_temp.cmd('{"type":"record_outcome","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d6","observed":{"summary":"Twelve replies","metricKey":"marketing.leads.captured","value":12}}','o-4')->>'lifecycle')='outcome_observed','a finished action takes an outcome');
SELECT pg_temp.require_true((pg_temp.cmd('{"type":"record_outcome","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d7","observed":{"summary":"No reply from the partner"}}','o-5')->>'outcome')='outcome_recorded','a failed action takes an outcome');
SELECT pg_temp.require_true((pg_temp.cmd('{"type":"evaluate_outcome","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d6","verdict":"met","note":"Above target"}','o-6')->>'lifecycle')='evaluated','an observed outcome is evaluated');
SELECT pg_temp.require_refused($$SELECT pg_temp.cmd('{"type":"record_outcome","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d6","observed":{"summary":"Rewritten"}}','o-7')$$,'CAMPAIGN_ACTION_ALREADY_EVALUATED','an evaluated outcome is not rewritten');
SELECT pg_temp.require_refused($$SELECT pg_temp.cmd('{"type":"evaluate_outcome","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d7","verdict":"great"}','o-8')$$,'CAMPAIGN_ACTION_VERDICT_INVALID','a verdict is one of three');
CREATE TEMP TABLE r2 AS SELECT public.get_campaign_brief_actions(NULL,'a2980500-0000-4000-8000-0000000000c1') v;
SELECT pg_temp.require_true(pg_temp.lifecycle(v,'a2980500-0000-4000-8000-0000000000d6')='evaluated'
  AND pg_temp.lifecycle(v,'a2980500-0000-4000-8000-0000000000d7')='outcome_observed'
  AND pg_temp.entry(v,'a2980500-0000-4000-8000-0000000000d6')->'evaluation'->>'verdict'='met'
  AND pg_temp.entry(v,'a2980500-0000-4000-8000-0000000000d6')->'observed_result'->>'value'='12'
  AND pg_temp.entry(v,'a2980500-0000-4000-8000-0000000000d6')->>'observed_through'='human','outcome and evaluation read back') FROM r2;

-- 5. Dependencies stay inside one campaign, and unlinking keeps dependants honest.
SELECT pg_temp.require_refused($$SELECT public.configure_campaign_brief_actions(NULL,'{"type":"link_action","briefId":"a2980500-0000-4000-8000-0000000000c4","actionId":"a2980500-0000-4000-8000-0000000000da","tactic":"Thanks","family":"email","dependsOnActionId":"a2980500-0000-4000-8000-0000000000d1"}','dep-1','human')$$,'CAMPAIGN_ACTION_DEPENDENCY_INVALID','a dependency in another campaign is refused');
SELECT public.configure_campaign_brief_actions(NULL,'{"type":"link_action","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000da","tactic":"Thanks","family":"email","dependsOnActionId":"a2980500-0000-4000-8000-0000000000d2"}','dep-2','human');
SELECT pg_temp.require_true((SELECT pg_temp.entry(public.get_campaign_brief_actions(NULL,'a2980500-0000-4000-8000-0000000000c1'),'a2980500-0000-4000-8000-0000000000da')->>'waiting_on_dependency')='true','a step waits on its unfinished dependency');
SELECT pg_temp.require_refused($$SELECT pg_temp.link('a2980500-0000-4000-8000-0000000000da','a2980500-0000-4000-8000-0000000000c4','Thanks')$$,'CAMPAIGN_ACTION_IN_OTHER_CAMPAIGN','an action serves one campaign');
SELECT pg_temp.require_true((pg_temp.cmd('{"type":"unlink_action","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d2"}','un-1')->>'outcome')='unlinked','an action is unlinked');
SELECT pg_temp.require_true((SELECT depends_on_action_id IS NULL FROM public.campaign_brief_actions WHERE action_id='a2980500-0000-4000-8000-0000000000da'),'its dependant no longer waits on it');
SELECT pg_temp.require_true((pg_temp.cmd('{"type":"unlink_action","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d2"}','un-2')->>'outcome')='not_linked','unlinking twice says so');
RESET ROLE;
SELECT pg_temp.require_true((SELECT status='pending_approval' FROM public.paige_actions WHERE id='a2980500-0000-4000-8000-0000000000d2'),'unlinking leaves the action itself unchanged');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2980500-0000-4000-8000-000000000001');

-- 6. Refusals: other workspace, archived campaign, bad input, a process from nowhere.
SELECT pg_temp.require_refused($$SELECT pg_temp.link('a2980500-0000-4000-8000-0000000000db','a2980500-0000-4000-8000-0000000000c1','x')$$,'CAMPAIGN_ACTION_NOT_FOUND','another workspace''s action is not linkable');
SELECT pg_temp.require_refused($$SELECT pg_temp.link('a2980500-0000-4000-8000-0000000000d2','a2980500-0000-4000-8000-0000000000c2','x')$$,'CAMPAIGN_BRIEF_NOT_FOUND','an archived campaign takes no actions');
SELECT pg_temp.require_refused($$SELECT pg_temp.link('a2980500-0000-4000-8000-0000000000d2','a2980500-0000-4000-8000-0000000000c3','x')$$,'CAMPAIGN_BRIEF_NOT_FOUND','another workspace''s campaign takes no actions');
SELECT pg_temp.require_refused($$SELECT pg_temp.cmd('{"type":"link_action","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d2","tactic":"x","family":"billboard"}','bad-1')$$,'CAMPAIGN_ACTION_FAMILY_INVALID','an unknown family is refused');
SELECT pg_temp.require_refused($$SELECT pg_temp.cmd('{"type":"link_action","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d2","tactic":" ","family":"email"}','bad-2')$$,'CAMPAIGN_ACTION_TACTIC_INVALID','a tactic is named');
SELECT pg_temp.require_refused($$SELECT pg_temp.cmd('{"type":"link_action","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d2","tactic":"x","family":"email","expectedResult":{"summary":"x","metricKey":"Leads!"}}','bad-3')$$,'CAMPAIGN_ACTION_RESULT_INVALID','a metric key is a dotted key');
SELECT pg_temp.require_refused($$SELECT pg_temp.cmd('{"type":"plan_action","briefId":"a2980500-0000-4000-8000-0000000000c1","title":"x","tactic":"x","family":"email","dueAt":"tomorrow"}','bad-4')$$,'CAMPAIGN_ACTION_ARGUMENTS_INVALID','a due time is a time');
SELECT pg_temp.require_refused($$SELECT pg_temp.cmd('{"type":"link_action","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d2","tactic":"x","family":"email","automationId":"a2980500-0000-4000-8000-0000000000f8"}','bad-6')$$,'CAMPAIGN_ACTION_PROCESS_NOT_FOUND','another workspace''s process is not a tactic here');
SELECT pg_temp.require_refused($$SELECT pg_temp.cmd('{"type":"send_now","briefId":"a2980500-0000-4000-8000-0000000000c1"}','bad-5')$$,'CAMPAIGN_BRIEF_ACTION_INVALID','there is no send command');
SELECT pg_temp.require_denied($$SELECT public.configure_campaign_brief_actions('a2980500-0000-4000-8000-000000000012','{"type":"unlink_action","briefId":"a2980500-0000-4000-8000-0000000000c3","actionId":"a2980500-0000-4000-8000-0000000000db"}','x-1','human')$$,'another workspace is refused');
SELECT pg_temp.require_denied($$SELECT public.get_campaign_brief_actions('a2980500-0000-4000-8000-000000000012',NULL)$$,'another workspace is not readable');
SELECT pg_temp.require_denied($$INSERT INTO public.campaign_brief_actions(tenant_id,brief_id,action_id,tactic,family,created_through) VALUES ('a2980500-0000-4000-8000-000000000011','a2980500-0000-4000-8000-0000000000c1','a2980500-0000-4000-8000-0000000000d2','x','email','human')$$,'no direct write');
RESET ROLE;
-- Integrity holds for the server role too.
DO $$ BEGIN
  BEGIN UPDATE public.campaign_brief_actions SET brief_id='a2980500-0000-4000-8000-0000000000c4' WHERE action_id='a2980500-0000-4000-8000-0000000000d1';
  EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
  RAISE EXCEPTION 'FAIL: a link never moves campaign';
END $$;
SELECT pg_temp.require_refused($$INSERT INTO public.campaign_brief_actions(tenant_id,brief_id,action_id,tactic,family,created_through) VALUES ('a2980500-0000-4000-8000-000000000011','a2980500-0000-4000-8000-0000000000c1','a2980500-0000-4000-8000-0000000000db','x','email','human')$$,'CAMPAIGN_ACTION_NOT_FOUND','the server role cannot link across workspaces');

-- 7. A member reads the plan and lifecycle, never titles or errors, and cannot change it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2980500-0000-4000-8000-000000000002');
CREATE TEMP TABLE r3 AS SELECT public.get_campaign_brief_actions(NULL,'a2980500-0000-4000-8000-0000000000c1') v;
SELECT pg_temp.require_true(NOT (v->>'can_manage')::boolean AND jsonb_array_length(v->'actions')=11
  AND (SELECT bool_and(a->'title'='null'::jsonb AND a->'summary'='null'::jsonb AND a->'approval'->'approval_id'='null'::jsonb) FROM jsonb_array_elements(v->'actions') a)
  AND pg_temp.lifecycle(v,'a2980500-0000-4000-8000-0000000000d6')='evaluated','a member reads the plan without titles') FROM r3;
SELECT pg_temp.require_denied($$SELECT pg_temp.cmd('{"type":"unlink_action","briefId":"a2980500-0000-4000-8000-0000000000c1","actionId":"a2980500-0000-4000-8000-0000000000d1"}','m-1')$$,'a member cannot change the plan');
RESET ROLE;

SELECT pg_temp.require_true((SELECT count(*)=18 FROM public.audit_logs WHERE action='campaign_brief.actions' AND data->>'tenant_id'='a2980500-0000-4000-8000-000000000011'),'every write is audited once');
SELECT pg_temp.require_true((SELECT count(*)=18 FROM public.campaign_brief_command_results WHERE tenant_id='a2980500-0000-4000-8000-000000000011'),'every write is in the ledger once');
ROLLBACK;
