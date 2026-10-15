-- ISOLATED full production-schema-only clone only; never execute on production.
-- INT-298 / INT-342 S2: Marketing's private producer through the real INT-340 issuer and resolver.
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
CREATE FUNCTION pg_temp.require_invalid(command text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN invalid_parameter_value THEN RETURN; END;
RAISE EXCEPTION 'FAIL: %',label; END $$;
INSERT INTO auth.users(id,email) VALUES
 ('a2980000-0000-4000-8000-000000000001','marketing-admin@example.invalid'),
 ('a2980000-0000-4000-8000-000000000002','marketing-member@example.invalid');
-- Company fixture creation exercises the genuine canonical owner guard (as shared_metric_evidence does).
DO $fixture_owner$ DECLARE fixture_owner_id uuid; BEGIN
 IF (SELECT count(*) FROM public.user_roles WHERE role='super_admin')>1 THEN
   RAISE EXCEPTION 'FIXTURE: canonical owner is ambiguous';
 END IF;
 SELECT user_id INTO fixture_owner_id FROM public.user_roles WHERE role='super_admin';
 IF fixture_owner_id IS NULL THEN
   fixture_owner_id := 'a2980000-0000-4000-8000-000000000004';
   INSERT INTO auth.users(id,email) VALUES(fixture_owner_id,'marketing-fixture-owner@example.invalid');
   INSERT INTO public.user_roles(user_id,role) VALUES(fixture_owner_id,'super_admin');
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',fixture_owner_id)::text,true);
 IF public.is_platform_owner() IS DISTINCT FROM true THEN RAISE EXCEPTION 'FIXTURE: canonical owner guard unavailable'; END IF;
END $fixture_owner$;
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('a2980000-0000-4000-8000-000000000011','marketing-proof-a','Marketing proof A','active','standalone','MPA','{"system_workspace":true}'),
 ('a2980000-0000-4000-8000-000000000012','marketing-proof-b','Marketing proof B','active','standalone','MPB','{"system_workspace":true}');
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-000000000001','admin','active',false),
 ('a2980000-0000-4000-8000-000000000012','a2980000-0000-4000-8000-000000000001','admin','active',false),
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-000000000002','member','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('a2980000-0000-4000-8000-000000000001','a2980000-0000-4000-8000-000000000011'),
 ('a2980000-0000-4000-8000-000000000002','a2980000-0000-4000-8000-000000000011')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;

-- A real pipeline for the intake-route forms (the routing guard admits only this workspace's pipelines).
-- The real actor supplies creation provenance, as shared_metric_evidence does.
CREATE TEMP TABLE marketing_pipeline(id uuid NOT NULL);
SELECT set_config('request.jwt.claim.sub','a2980000-0000-4000-8000-000000000001',true),
 set_config('request.jwt.claims','{"sub":"a2980000-0000-4000-8000-000000000001","role":"authenticated"}',true);
WITH generated AS (
 INSERT INTO public.pipelines(tenant_id,name,is_default) VALUES ('a2980000-0000-4000-8000-000000000011','Marketing proof',true) RETURNING id
) INSERT INTO marketing_pipeline(id) SELECT id FROM generated;
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
-- Records the producer reads, written directly by the server role (the Studio publish guard admits it).
INSERT INTO public.growth_forms(id,tenant_id,slug,name,status,auto_create_deal,pipeline_id) VALUES
 ('a2980000-0000-4000-8000-0000000000f1','a2980000-0000-4000-8000-000000000011','routed-automation','Routed by automation','active',false,null),
 ('a2980000-0000-4000-8000-0000000000f2','a2980000-0000-4000-8000-000000000011','unrouted','Unrouted','active',false,null),
 ('a2980000-0000-4000-8000-0000000000f4','a2980000-0000-4000-8000-000000000011','archived','Archived','archived',false,null),
 -- Intake columns route a form only while it has no enabled automation (as growth-process-submission runs it).
 ('a2980000-0000-4000-8000-0000000000f6','a2980000-0000-4000-8000-000000000011','intake-only','Intake only','active',true,(SELECT id FROM marketing_pipeline)),
 ('a2980000-0000-4000-8000-0000000000f7','a2980000-0000-4000-8000-000000000011','intake-and-notify','Intake and notify','active',true,(SELECT id FROM marketing_pipeline)),
 ('a2980000-0000-4000-8000-0000000000f5','a2980000-0000-4000-8000-000000000012','foreign','Foreign','active',false,null);
INSERT INTO public.growth_form_automations(tenant_id,form_id,target_slug,enabled) VALUES
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f1','pipeline_attach',true),
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f2','pipeline_attach',false),
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f2','notify_team',true),
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f7','notify_team',true);
-- Email: three managed sends (two opened, one clicked), one through the business's own connector, and B's.
INSERT INTO public.email_campaigns(id,tenant_id,name,status) VALUES
 ('a2980000-0000-4000-8000-0000000000e1','a2980000-0000-4000-8000-000000000011','Proof campaign','completed'),
 ('a2980000-0000-4000-8000-0000000000e2','a2980000-0000-4000-8000-000000000012','Foreign campaign','completed');
INSERT INTO public.email_campaign_versions(id,campaign_id,tenant_id,version_no,state) VALUES
 ('a2980000-0000-4000-8000-0000000000e3','a2980000-0000-4000-8000-0000000000e1','a2980000-0000-4000-8000-000000000011',1,'sent'),
 ('a2980000-0000-4000-8000-0000000000e4','a2980000-0000-4000-8000-0000000000e2','a2980000-0000-4000-8000-000000000012',1,'sent');
INSERT INTO public.email_campaign_recipients(campaign_id,version_id,tenant_id,email,status,route,sent_at,opened_at,clicked_at) VALUES
 ('a2980000-0000-4000-8000-0000000000e1','a2980000-0000-4000-8000-0000000000e3','a2980000-0000-4000-8000-000000000011','one@example.invalid','sent','managed',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day'),
 ('a2980000-0000-4000-8000-0000000000e1','a2980000-0000-4000-8000-0000000000e3','a2980000-0000-4000-8000-000000000011','two@example.invalid','sent','managed',now()-interval '2 days',now()-interval '1 day',null),
 ('a2980000-0000-4000-8000-0000000000e1','a2980000-0000-4000-8000-0000000000e3','a2980000-0000-4000-8000-000000000011','three@example.invalid','sent','managed',now()-interval '2 days',null,null),
 ('a2980000-0000-4000-8000-0000000000e1','a2980000-0000-4000-8000-0000000000e3','a2980000-0000-4000-8000-000000000011','four@example.invalid','sent','connector',now()-interval '2 days',null,null),
 ('a2980000-0000-4000-8000-0000000000e2','a2980000-0000-4000-8000-0000000000e4','a2980000-0000-4000-8000-000000000012','foreign@example.invalid','sent','managed',now()-interval '2 days',now(),now());
INSERT INTO public.campaign_briefs(tenant_id,short_ref,name) VALUES
 ('a2980000-0000-4000-8000-000000000011','CB-SPRING','Spring intake'),
 ('a2980000-0000-4000-8000-000000000011','DUP','One'),
 ('a2980000-0000-4000-8000-000000000011','dup','Two'),
 ('a2980000-0000-4000-8000-000000000012','CB-OTHER','Foreign brief');
-- deal_id has no foreign key: one lead names a deal that is not in this workspace.
INSERT INTO public.growth_form_submissions(tenant_id,form_id,deal_id,utm_json,processing_state,created_at) VALUES
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f1',null,'{"utm_source":"Google","utm_campaign":"cb-spring"}','done',now()-interval '2 days'),
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f1',null,'{"utm_source":" google "}','done',now()-interval '3 days'),
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f2',null,'{}','error',now()-interval '1 day'),
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f2',null,'{"utm_source":"newsletter","utm_campaign":"DUP"}','pending',now()-interval '1 hour'),
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f2','a2980000-0000-4000-8000-0000000000d9','{"utm_source":7,"utm_campaign":"CB-OTHER"}','pending',now()-interval '2 minutes'),
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f2',null,'{"utm_source":"old"}','error',now()-interval '60 days'),
 -- A real tag spelled like a sentinel stays its own item; control characters never reach a label; a blank tag is no tag.
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f1',null,'{"utm_source":"_untagged","utm_campaign":" \n "}','done',now()-interval '4 days'),
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f1',null,'{"utm_source":"news\tletter"}','done',now()-interval '5 days'),
 ('a2980000-0000-4000-8000-000000000012','a2980000-0000-4000-8000-0000000000f5',null,'{"utm_source":"foreign"}','error',now()-interval '1 day');

CREATE TEMP TABLE marketing_results(key text PRIMARY KEY,bundle jsonb NOT NULL);
GRANT SELECT,INSERT ON marketing_results TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2980000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a2980000-0000-4000-8000-000000000001","role":"authenticated"}',true);
INSERT INTO marketing_results SELECT k,public.issue_analytics_evidence_bundle(k,'1.0.0','{}','month',now()-interval '30 days',now(),'a2980000-0000-4000-8000-000000000011')
 FROM unnest(ARRAY['marketing.leads.received','marketing.leads.daily','marketing.leads.by_utm_source','marketing.leads.by_campaign_tag',
  'marketing.leads.converted_to_opportunity','marketing.capture_points.published_current','marketing.forms.unrouted_current',
  'marketing.submissions.failed_current','marketing.email.sent','marketing.email.opened','marketing.email.clicked']) k;

-- Every bundle is Marketing's, scoped to A, and resolves to itself through the shared resolver.
SELECT pg_temp.require_true(bundle->>'owner_department'='marketing' AND bundle->>'account_epoch'='a2980000-0000-4000-8000-000000000011'
 AND bundle#>>'{range,key}'='month' AND bundle->>'evidence_ref' ~ '^aneb_v1_[0-9a-f]{64}$' AND NOT bundle ? 'evidence_state'
 AND public.resolve_analytics_evidence_reference(bundle->>'evidence_ref')=bundle,'shared issuance and readback: '||key) FROM marketing_results;
-- Leads in range, this workspace only (the 60-day-old and B's leads are outside).
SELECT pg_temp.require_true((SELECT bundle->>'truth_state'='LIVE' AND bundle#>>'{values,count}'='7' FROM marketing_results WHERE key='marketing.leads.received'),'leads received');
SELECT pg_temp.require_true((SELECT bundle#>>'{values,kind}'='series' AND jsonb_array_length(bundle#>'{values,points}') BETWEEN 30 AND 31
 AND (SELECT sum((p->>'value')::int) FROM jsonb_array_elements(bundle#>'{values,points}') p)=7 FROM marketing_results WHERE key='marketing.leads.daily'),'daily series sums to leads');
-- Tags fold case and whitespace; a non-string tag is no tag; untagged is its own item, never dropped.
SELECT pg_temp.require_true((SELECT bundle->>'truth_state'='LIVE' AND bundle#>'{values,items}'=
 '[{"key":"src:google","label":"Google","count":2},{"key":"src:_untagged","label":"_untagged","count":1},{"key":"src:news letter","label":"news letter","count":1},{"key":"src:newsletter","label":"newsletter","count":1},{"key":"_untagged","label":"No source tag","count":2}]'::jsonb
 FROM marketing_results WHERE key='marketing.leads.by_utm_source'),'source distribution');
-- A tag matching one brief in A is that brief; a tag matching two is excluded and disclosed; B's brief never matches.
SELECT pg_temp.require_true((SELECT bundle->>'truth_state'='PARTIAL' AND bundle->'exclusions'='[{"reason":"campaign_tag_matches_several_briefs","count":1}]'::jsonb
 AND bundle#>'{values,items}'@>'[{"label":"Spring intake","count":1},{"key":"tag:cb-other","label":"CB-OTHER","count":1},{"key":"_untagged","count":4}]'::jsonb
 AND jsonb_array_length(bundle#>'{values,items}')=3 FROM marketing_results WHERE key='marketing.leads.by_campaign_tag'),'campaign tag distribution');
-- A deal id that resolves to no deal in this workspace is excluded, not counted.
SELECT pg_temp.require_true((SELECT bundle->>'truth_state'='PARTIAL' AND bundle#>>'{values,count}'='0' AND bundle#>>'{coverage,contributing_count}'='6'
 AND bundle->'exclusions'='[{"reason":"opportunity_record_missing","count":1}]'::jsonb FROM marketing_results WHERE key='marketing.leads.converted_to_opportunity'),'opportunity link');
SELECT pg_temp.require_true((SELECT bundle#>>'{values,count}'='4' AND bundle#>>'{range,semantics}'='current_snapshot' FROM marketing_results WHERE key='marketing.capture_points.published_current'),'live forms');
-- A disabled pipeline automation does not route; another enabled automation is not a pipeline route.
SELECT pg_temp.require_true((SELECT bundle#>>'{values,count}'='2' AND bundle#>>'{coverage,contributing_count}'='4' FROM marketing_results WHERE key='marketing.forms.unrouted_current'),'unrouted live forms (intake columns lose to an enabled automation)');
-- Failed at any age; waiting more than 15 minutes is stalled; a 2-minute-old pending lead is not.
SELECT pg_temp.require_true((SELECT bundle#>'{values,items}'='[{"key":"failed","label":"Processing failed","count":2},{"key":"stalled","label":"Still waiting after 15 minutes","count":1}]'::jsonb
 FROM marketing_results WHERE key='marketing.submissions.failed_current'),'failed and stalled');
SELECT pg_temp.require_true((SELECT bundle->>'truth_state'='LIVE' AND bundle#>>'{values,count}'='4' FROM marketing_results WHERE key='marketing.email.sent'),'emails sent, any route, this workspace');
SELECT pg_temp.require_true((SELECT bool_and(bundle->>'truth_state'='PARTIAL' AND bundle#>>'{coverage,contributing_count}'='3'
 AND bundle->'exclusions'='[{"reason":"not_tracked_own_mail","count":1}]'::jsonb
 AND bundle#>>'{values,count}'=CASE key WHEN 'marketing.email.opened' THEN '2' ELSE '1' END)
 FROM marketing_results WHERE key IN ('marketing.email.opened','marketing.email.clicked')),'opens and clicks over tracked sends only');
SELECT pg_temp.require_true((SELECT (bundle#>'{values,points}'->0->>'at')::timestamptz=(bundle#>>'{range,start}')::timestamptz
 FROM marketing_results WHERE key='marketing.leads.daily'),'the first point starts at the range start');

-- A hundred and twenty tags fold to exactly 100 items; an emoji tag and a Unicode-space tag stay valid labels.
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
INSERT INTO public.growth_form_submissions(tenant_id,form_id,utm_json,processing_state,created_at)
 SELECT 'a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f1',jsonb_build_object('utm_source','bulk'||g),'done',now()-interval '6 days' FROM generate_series(1,120) g;
INSERT INTO public.growth_form_submissions(tenant_id,form_id,utm_json,processing_state,created_at) VALUES
 -- Three leads, so the emoji tag ranks inside the named 98 and its key and label are actually emitted.
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f1',jsonb_build_object('utm_source',repeat(U&'\+01F600',130),'utm_campaign',repeat(U&'\+01F600',130)),'done',now()-interval '6 days'),
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f1',jsonb_build_object('utm_source',repeat(U&'\+01F600',130),'utm_campaign',U&'\2028\00A0'),'done',now()-interval '6 days'),
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f1',jsonb_build_object('utm_source',repeat(U&'\+01F600',130)),'done',now()-interval '6 days'),
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f1',jsonb_build_object('utm_source',U&'\00A0\3000'),'done',now()-interval '6 days');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2980000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a2980000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT pg_temp.require_true(jsonb_array_length(b#>'{values,items}')=100
 AND (SELECT bool_and(char_length(i->>'key')<=80 AND char_length(i->>'label')<=120 AND btrim(i->>'label')<>'' AND (i->>'label')!~'[[:cntrl:]]') FROM jsonb_array_elements(b#>'{values,items}') i)
 AND b#>'{values,items}'@>'[{"key":"_untagged","count":3}]'::jsonb AND b#>'{values,items}' @> '[{"key":"_other"}]'::jsonb
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(b#>'{values,items}') i WHERE (i->>'count')::int=3 AND char_length(i->>'key')=80 AND i->>'key' LIKE 'src:%'),'fold to 100 items with valid labels; the emoji tag is emitted at the key limit')
 FROM (SELECT public.issue_analytics_evidence_bundle('marketing.leads.by_utm_source','1.0.0','{}','month',now()-interval '30 days',now(),'a2980000-0000-4000-8000-000000000011') b) x;
-- The campaign path cleans the same way: an emoji campaign tag is a valid key at the limit; a separator-only tag is no tag.
SELECT pg_temp.require_true((SELECT bool_and(char_length(i->>'key')<=80 AND char_length(i->>'label')<=120 AND btrim(i->>'label')<>'' AND (i->>'label')!~'[[:cntrl:]]') FROM jsonb_array_elements(b#>'{values,items}') i)
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(b#>'{values,items}') i WHERE char_length(i->>'key')=80 AND i->>'key' LIKE 'tag:%' AND char_length(i->>'label')=120)
 AND b#>'{values,items}'@>'[{"key":"_untagged"}]'::jsonb,'campaign tags with emoji and separators stay valid')
 FROM (SELECT public.issue_analytics_evidence_bundle('marketing.leads.by_campaign_tag','1.0.0','{}','month',now()-interval '30 days',now(),'a2980000-0000-4000-8000-000000000011') b) x;

-- Contract: unknown key, a dimension, and a daily range past 366 days are refused.
SELECT pg_temp.require_invalid($q$SELECT public.issue_analytics_evidence_bundle('marketing.roas','1.0.0','{}','month',now()-interval '30 days',now(),'a2980000-0000-4000-8000-000000000011')$q$,'unknown marketing key');
SELECT pg_temp.require_invalid($q$SELECT public.issue_analytics_evidence_bundle('marketing.leads.received','1.0.0','{"form_id":"x"}','month',now()-interval '30 days',now(),'a2980000-0000-4000-8000-000000000011')$q$,'dimension refused');
SELECT pg_temp.require_invalid($q$SELECT public.issue_analytics_evidence_bundle('marketing.leads.daily','1.0.0','{}','year',now()-interval '400 days',now(),'a2980000-0000-4000-8000-000000000011')$q$,'daily series over 366 days');
-- Private seams stay private; another workspace's epoch is denied.
SELECT pg_temp.require_denied($q$SELECT public._marketing_metric_bundle('a2980000-0000-4000-8000-000000000011','marketing.leads.received','1.0.0',now()-interval '1 day',now(),now(),'{}')$q$,'private producer');
SELECT pg_temp.require_denied($q$SELECT public.issue_analytics_evidence_bundle('marketing.leads.received','1.0.0','{}','month',now()-interval '30 days',now(),'a2980000-0000-4000-8000-000000000012')$q$,'foreign epoch');
-- A member of the workspace is refused, as for every other domain.
SELECT set_config('request.jwt.claim.sub','a2980000-0000-4000-8000-000000000002',true),set_config('request.jwt.claims','{"sub":"a2980000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT pg_temp.require_denied($q$SELECT public.issue_analytics_evidence_bundle('marketing.leads.received','1.0.0','{}','month',now()-interval '30 days',now(),'a2980000-0000-4000-8000-000000000011')$q$,'member denied');
SELECT pg_temp.require_denied($q$SELECT public.resolve_analytics_evidence_reference(bundle->>'evidence_ref') FROM marketing_results WHERE key='marketing.leads.received'$q$,'member cannot read admin reference');
RESET ROLE;
-- A new lead changes the source revision, so an issued reference no longer resolves.
SELECT set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true);
INSERT INTO public.growth_form_submissions(tenant_id,form_id,utm_json,processing_state,created_at) VALUES
 ('a2980000-0000-4000-8000-000000000011','a2980000-0000-4000-8000-0000000000f1','{}','done',now()-interval '1 day');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2980000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"a2980000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT pg_temp.require_denied($q$SELECT public.resolve_analytics_evidence_reference(bundle->>'evidence_ref') FROM marketing_results WHERE key='marketing.leads.received'$q$,'source change invalidates the reference');
-- Other domains still dispatch unchanged.
SELECT pg_temp.require_true((SELECT public.issue_analytics_evidence_bundle('team.active_members_current','1.0.0','{}','week',now()-interval '7 days',now(),'a2980000-0000-4000-8000-000000000011')->>'owner_department' IS NOT NULL),'other domains unchanged');
RESET ROLE;
ROLLBACK;
