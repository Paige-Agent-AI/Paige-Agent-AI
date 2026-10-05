RESET ROLE;
\ir ../../supabase/migrations/20270572000000_sales_governed_invoice_draft.sql
\ir ../../supabase/migrations/20270572000000_sales_governed_invoice_draft.sql
SELECT proof_assert(NOT has_function_privilege('authenticated','public._save_sales_billing_draft(uuid,uuid,uuid,bigint,uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.execute_sales_invoice_draft_command(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE'),'browser cannot supply actor or governance');
CREATE TEMP TABLE governed_draft_command AS SELECT jsonb_build_object('action','invoice.draft_create','invoice_id','60000000-0000-0000-0000-000000000810','expected_version',0,'draft',draft) command FROM exact_input;
GRANT SELECT ON governed_draft_command,exact_input TO service_role;
CREATE FUNCTION proof_draft_governance(action text,tool text,channel text DEFAULT 'operator_card') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('actor_user_id','10000000-0000-0000-0000-000000000001','tenant_id','20000000-0000-0000-0000-000000000001','action',action,'tool',tool,'approval_channel',channel,'approved_fingerprint','0123456789abcdef','decision_receipt_recorded',true);
$$;
GRANT EXECUTE ON FUNCTION proof_draft_governance(text,text,text) TO service_role;
SET ROLE service_role;
SELECT proof_denied($q$SELECT execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000810',(SELECT command FROM governed_draft_command),'{}')$q$,'42501','missing canonical decision refuses creation');
CREATE TEMP TABLE governed_draft_result AS SELECT execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000810',command,proof_draft_governance('invoice.draft_create','billing_create_invoice')) result FROM governed_draft_command;
SELECT proof_assert((SELECT result#>>'{row,billing_draft,due_now_minor}'='50000' AND result#>>'{row,billing_draft,remainder_minor}'='300000' AND result->>'outcome'='draft_created' FROM governed_draft_result),'governed create reuses canonical exact draft writer');
SELECT proof_assert((SELECT execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000810',command,'{}')=result FROM governed_draft_command CROSS JOIN governed_draft_result),'historical exact operation readback reuses result without new authority/mutation');
SELECT proof_denied($q$SELECT execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000810',(SELECT jsonb_set(command,'{draft,memo}','"Changed"') FROM governed_draft_command),proof_draft_governance('invoice.draft_create','billing_create_invoice'))$q$,'22023','same operation different draft refused');
RESET ROLE;
SELECT proof_assert((SELECT count(*)=1 FROM paige_invoice_operations WHERE id='70000000-0000-0000-0000-000000000810') AND (SELECT count(*)=1 FROM paige_workspace_events WHERE source_id='70000000-0000-0000-0000-000000000810'),'one canonical operation and Rail receipt');
UPDATE tenant_tool_autonomy SET mode='off' WHERE tenant_id='20000000-0000-0000-0000-000000000001' AND tool_key='billing_create_invoice';
INSERT INTO tenant_tool_autonomy(tenant_id,tool_key,mode) SELECT '20000000-0000-0000-0000-000000000001','billing_create_invoice','off' WHERE NOT EXISTS(SELECT 1 FROM tenant_tool_autonomy WHERE tenant_id='20000000-0000-0000-0000-000000000001' AND tool_key='billing_create_invoice');
SET ROLE service_role;
SELECT proof_denied($q$SELECT execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000811',(SELECT jsonb_set(command,'{invoice_id}','"60000000-0000-0000-0000-000000000811"') FROM governed_draft_command),proof_draft_governance('invoice.draft_create','billing_create_invoice'))$q$,'42501','current canonical off refuses even approved package');
RESET ROLE;
UPDATE tenant_tool_autonomy SET mode='auto' WHERE tool_key='billing_create_invoice';
SELECT set_config('test.trust_rung','1',true);
SET ROLE service_role;
SELECT proof_denied($q$SELECT execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000811',(SELECT jsonb_set(command,'{invoice_id}','"60000000-0000-0000-0000-000000000811"') FROM governed_draft_command),proof_draft_governance('invoice.draft_create','billing_create_invoice','standing_autonomy_setting'))$q$,'42501','Trust ceiling prevents standing grant');
RESET ROLE;
SELECT set_config('test.trust_rung','2',true);
CREATE FUNCTION proof_draft_rail_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_id='70000000-0000-0000-0000-000000000812' THEN RAISE EXCEPTION 'Injected Rail failure' USING ERRCODE='55000'; END IF;RETURN NEW;END $$;
CREATE TRIGGER proof_draft_rail_failure BEFORE INSERT ON paige_workspace_events FOR EACH ROW EXECUTE FUNCTION proof_draft_rail_failure();
SET ROLE service_role;
SELECT proof_denied($q$SELECT execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000812',(SELECT jsonb_set(command,'{invoice_id}','"60000000-0000-0000-0000-000000000812"') FROM governed_draft_command),proof_draft_governance('invoice.draft_create','billing_create_invoice','standing_autonomy_setting'))$q$,'55000','Rail failure rolls draft mutation back atomically');
RESET ROLE;
SELECT proof_assert(NOT EXISTS(SELECT 1 FROM paige_invoices WHERE id='60000000-0000-0000-0000-000000000812') AND NOT EXISTS(SELECT 1 FROM paige_invoice_operations WHERE id='70000000-0000-0000-0000-000000000812'),'no draft or operation survives failed receipt');
DROP TRIGGER proof_draft_rail_failure ON paige_workspace_events;
SET ROLE authenticated;
SELECT proof_assert(save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000810',1,'70000000-0000-0000-0000-000000000813',(SELECT draft||'{"memo":"UI revision"}' FROM exact_input))#>>'{row,billing_draft_version}'='2','UI and governed adapter edit identical canonical draft');
RESET ROLE;

-- Positive standing authority and later UI revision share canonical state and immutable history.
SET ROLE service_role;
SELECT proof_assert(execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000814',
 (SELECT jsonb_set(command,'{invoice_id}','"60000000-0000-0000-0000-000000000814"') FROM governed_draft_command),
 proof_draft_governance('invoice.draft_create','billing_create_invoice','standing_autonomy_setting'))->>'outcome'='draft_created','current ordinary AUTO can create canonical draft');
SELECT proof_assert((SELECT execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000810',command,'{}')=result FROM governed_draft_command CROSS JOIN governed_draft_result),'historical replay remains frozen after independent UI revision');
SELECT proof_denied($q$SELECT execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000814',(SELECT command FROM governed_draft_command),proof_draft_governance('invoice.draft_create','billing_create_invoice'))$q$,'42501','foreign workspace refuses before historical replay');
RESET ROLE;
UPDATE tenant_members SET role='member' WHERE tenant_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT proof_denied($q$SELECT execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000810',(SELECT command FROM governed_draft_command),'{}')$q$,'42501','revoked owner role cannot read replay');
RESET ROLE;
UPDATE tenant_members SET role='owner' WHERE tenant_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001';
SET ROLE service_role;
SELECT proof_assert(execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000815',
 jsonb_build_object('action','invoice.draft_revise','invoice_id','60000000-0000-0000-0000-000000000810','expected_version',2,'draft',(SELECT draft||'{"memo":"Governed revision"}' FROM exact_input)),
 proof_draft_governance('invoice.draft_revise','sales_revise_invoice_draft'))#>>'{row,billing_draft_version}'='3','governed revision uses same canonical CAS after UI update');
SELECT proof_denied($q$SELECT execute_sales_invoice_draft_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000816',jsonb_build_object('action','invoice.draft_revise','invoice_id','60000000-0000-0000-0000-000000000810','expected_version',2,'draft',(SELECT draft FROM exact_input)),proof_draft_governance('invoice.draft_revise','sales_revise_invoice_draft'))$q$,'40001','stale governed revision refuses');
RESET ROLE;

SELECT proof_assert((SELECT count(*)=1 FROM public.list_tool_autonomy('20000000-0000-0000-0000-000000000001') WHERE tool_key='sales_revise_invoice_draft'),'catalogue replay adds exactly one revision row');
SELECT proof_assert(NOT EXISTS(SELECT 1 FROM public._list_tool_autonomy_before_sales_draft('20000000-0000-0000-0000-000000000001') old WHERE NOT EXISTS(SELECT 1 FROM public.list_tool_autonomy('20000000-0000-0000-0000-000000000001') new WHERE to_jsonb(new)=to_jsonb(old))),'all predecessor catalogue rows preserved');
SELECT proof_assert(public._workspace_event_display('capability_run','capability_succeeded','sales_revise_invoice_draft')->>'title'='Revised an invoice draft','Rail draft description never claims issuance or payment');
SELECT proof_assert(public._workspace_event_display('capability_run','capability_succeeded','growth_page_publish')=public._workspace_event_display_before_sales_draft('capability_run','capability_succeeded','growth_page_publish'),'unrelated Rail descriptions untouched');
