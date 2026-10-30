BEGIN;
SELECT plan(32);
CREATE TEMP TABLE e02_read_label_event_count AS SELECT count(*) AS n FROM public.paige_workspace_events;

SELECT is(public._workspace_event_display('capability_run','capability_succeeded','read_sales_collections')->>'title',
  'Read collection records','collection lookup is named as a read');
SELECT is(public._workspace_event_display('capability_run','capability_succeeded','read_sales_commercial_package')->>'title',
  'Read commercial records','commercial package lookup is named as a read');
SELECT is(public._workspace_event_display('capability_run','capability_succeeded','read_sales_collections')->>'summary',
  'PAIGE read existing collection records to answer you. No business records were changed.','collection read never claims a business mutation');
SELECT is(public._workspace_event_display('capability_run','capability_succeeded','read_sales_commercial_package')->>'summary',
  'PAIGE read the existing invoice package to answer you. No business records were changed.','package read never claims an approval or payment');
SELECT ok((SELECT bool_and((public._workspace_event_display('capability_run','capability_succeeded',c)-'title'-'summary')
  =(public._workspace_event_display_before_e02_reads('capability_run','capability_succeeded',c)-'title'-'summary'))
  FROM unnest(ARRAY['read_sales_collections','read_sales_commercial_package']) AS c),
  'read labels preserve actor, department and every other display field');
SELECT ok((SELECT bool_and(public._workspace_event_display('capability_run',o,c)
  =public._workspace_event_display_before_e02_reads('capability_run',o,c))
  FROM unnest(ARRAY['read_sales_collections','read_sales_commercial_package']) AS c
  CROSS JOIN unnest(ARRAY['capability_failed','capability_refused','capability_unreachable','capability_outcome_unknown',
    'capability_completed_unrecorded','future_outcome',NULL]) AS o),
  'all non-successful and unknown read outcomes retain original meaning');
SELECT ok((SELECT bool_and(public._workspace_event_display(s,'capability_succeeded',c)
  =public._workspace_event_display_before_e02_reads(s,'capability_succeeded',c))
  FROM unnest(ARRAY['read_sales_collections','read_sales_commercial_package']) AS c
  CROSS JOIN unnest(ARRAY['owner_edit','mcp_connection',NULL]) AS s),
  'same keys in other source families are never relabelled');
SELECT ok((SELECT bool_and(public._workspace_event_display('capability_run',o,c)
  =public._workspace_event_display_before_e02_reads('capability_run',o,c))
  FROM unnest(ARRAY['owner_mission_target_save','owner_mission_target_transition','mission_target_save','set_business_time_zone',
    'read_business_time_zone','read_client_engagement_status','planning_weekly_commitment_check','weekly_commitment_draft',
    'sales_record_manual_payment','billing_send_invoice','n8n_run_workflow','future_capability',NULL]) AS c
  CROSS JOIN unnest(ARRAY['capability_succeeded','capability_failed','capability_refused','capability_unreachable',
    'capability_outcome_unknown','capability_completed_unrecorded',NULL]) AS o),
  'other capabilities delegate across every outcome, including future or missing keys');
SELECT is(public._workspace_event_display('capability_run','capability_succeeded','owner_mission_target_save')->>'actor_type',
  'owner_staff','native target save still credits the person');
SELECT is(public._workspace_event_display('capability_run','capability_succeeded','set_business_time_zone')->>'actor_type',
  'owner_staff','native business time zone change still credits the person');
SELECT is(public._workspace_event_display('capability_run','capability_succeeded','weekly_commitment_draft')->>'title',
  'Weekly responsibility saved as draft','weekly draft never becomes recurring execution');
SELECT ok(NOT has_function_privilege('anon','public._workspace_event_display(text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public._workspace_event_display_before_e02_reads(text,text,text)','EXECUTE'),
  'anonymous callers cannot invoke either private display function');
SELECT ok(NOT has_function_privilege('authenticated','public._workspace_event_display(text,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._workspace_event_display_before_e02_reads(text,text,text)','EXECUTE'),
  'authenticated callers cannot invoke either private display function');
SELECT ok(NOT has_function_privilege('service_role','public._workspace_event_display(text,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public._workspace_event_display_before_e02_reads(text,text,text)','EXECUTE'),
  'service callers cannot bypass the existing scoped Rail reader');
SELECT ok((SELECT bool_and(provolatile='i' AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public'])
  FROM pg_proc WHERE oid IN ('public._workspace_event_display(text,text,text)'::regprocedure,
    'public._workspace_event_display_before_e02_reads(text,text,text)'::regprocedure)),
  'display wrapper and predecessor remain immutable invokers with pinned search paths');
SELECT ok((SELECT bool_and(NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p
  WHERE p.oid IN ('public._workspace_event_display(text,text,text)'::regprocedure,
    'public._workspace_event_display_before_e02_reads(text,text,text)'::regprocedure)),
  'PUBLIC has no default execution grant on either helper');
SELECT is(public._workspace_event_display('capability_run','capability_succeeded','read_sales_collections'),
  public._workspace_event_display('capability_run','capability_succeeded','read_sales_collections'),
  'repeated display of the original collection receipt is deterministic');
SELECT is(public._workspace_event_display('capability_run','capability_succeeded','read_sales_commercial_package'),
  public._workspace_event_display('capability_run','capability_succeeded','read_sales_commercial_package'),
  'repeated display of the original package receipt is deterministic');
SELECT ok(pg_get_functiondef('public.get_solo_rail_activity(integer)'::regprocedure) LIKE '%_workspace_event_display(%',
  'existing scoped Rail reader still uses the shared display chain');
SELECT is((SELECT count(*) FROM public.paige_workspace_events),(SELECT n FROM e02_read_label_event_count),
  'display, repetition and denied-access checks append no activity receipt');

SELECT is(public._workspace_event_display('capability_run','capability_succeeded','agreement_list')->>'title',
  'Read agreement records','agreement listing names a read, not completed commercial work');
SELECT is(public._workspace_event_display('capability_run','capability_succeeded','agreement_status')->>'title',
  'Read agreement status','agreement status lookup is not signing or execution');
SELECT is(public._workspace_event_display('capability_run','capability_succeeded','find_clients_for_status')->>'title',
  'Looked up client records','nested client lookup remains a read');
SELECT is(public._workspace_event_display('capability_run','capability_succeeded','agreement_list')->>'summary',
  'Existing agreements were looked up. No agreement was sent, signed or changed.','agreement listing makes no effect claim');
SELECT is(public._workspace_event_display('capability_run','capability_succeeded','agreement_status')->>'summary',
  'The recorded status was checked. No agreement was approved, sent or signed.','status is not an authorized business action');
SELECT is(public._workspace_event_display('capability_run','capability_succeeded','find_clients_for_status')->>'summary',
  'Existing clients were searched for a status lookup. No business records were changed.','client matching claims no new client or changed status');
SELECT ok((SELECT bool_and((public._workspace_event_display('capability_run','capability_succeeded',c)-'title'-'summary')
  =(public._workspace_event_display_before_e04_effectuation('capability_run','capability_succeeded',c)-'title'-'summary'))
  FROM unnest(ARRAY['agreement_list','agreement_status','find_clients_for_status']) c),
  'all original non-copy fields and actor attribution remain exact');
SELECT ok((SELECT bool_and(public._workspace_event_display('capability_run',o,c)
  =public._workspace_event_display_before_e04_effectuation('capability_run',o,c))
  FROM unnest(ARRAY['agreement_list','agreement_status','find_clients_for_status']) c
  CROSS JOIN unnest(ARRAY['capability_failed','capability_refused','capability_unreachable','capability_outcome_unknown',
    'capability_completed_unrecorded','future_outcome',NULL]) o),
  'failed, uncertain, future and missing outcomes never acquire successful-read wording');
SELECT ok((SELECT bool_and(public._workspace_event_display(s,'capability_succeeded',c)
  =public._workspace_event_display_before_e04_effectuation(s,'capability_succeeded',c))
  FROM unnest(ARRAY['agreement_list','agreement_status','find_clients_for_status']) c
  CROSS JOIN unnest(ARRAY['owner_edit','mcp_connection','capability_run_future',NULL]) s),
  'only the original successful capability-run family is relabelled');
SELECT ok((SELECT bool_and(public._workspace_event_display('capability_run',o,c)
  =public._workspace_event_display_before_e04_effectuation('capability_run',o,c))
  FROM unnest(ARRAY['read_sales_collections','read_sales_commercial_package','read_client_engagement_status',
    'read_business_time_zone','owner_mission_target_save','weekly_commitment_draft',
    'agreement_list_future','agreement_status_future','find_clients_for_status_future',NULL]) c
  CROSS JOIN unnest(ARRAY['capability_succeeded','capability_failed','capability_refused','capability_outcome_unknown',NULL]) o),
  'other capabilities, future aliases and earlier read/owner/draft labels delegate unchanged');
SELECT ok(public._workspace_event_display('capability_run','capability_succeeded','sales_effectuate_commercial_terms')->>'title'
  ='Signed commercial terms made effective'
  AND public._workspace_event_display('capability_run','capability_succeeded','sales_effectuate_commercial_terms')->>'actor_type'='owner_staff'
  AND public._workspace_event_display('capability_run','capability_failed','sales_effectuate_commercial_terms')->>'title'
  ='Commercial terms not made effective','original signed-terms outcome and owner attribution are preserved');
SELECT ok((SELECT proargnames=ARRAY['_source_kind','_outcome','_capability'] AND prorettype='jsonb'::regtype
  AND prokind='f' AND proparallel='u' AND NOT proleakproof AND NOT proisstrict AND pronargdefaults=0
  AND pg_get_userbyid(proowner)='postgres' AND proacl=ARRAY['postgres=X/postgres']::aclitem[]
  FROM pg_proc WHERE oid='public._workspace_event_display(text,text,text)'::regprocedure),
  'original private function signature, owner and execution contract remain unchanged');
SELECT * FROM finish();
ROLLBACK;
