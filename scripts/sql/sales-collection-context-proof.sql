BEGIN;
SET LOCAL test.actor='10000000-0000-0000-0000-000000000001';
SET LOCAL test.workspace='20000000-0000-0000-0000-000000000001';
SET LOCAL test.admin='true';
UPDATE tenant_client_agreements SET title=repeat('T',210) WHERE id='40000000-0000-0000-0000-000000000001';
UPDATE clients SET first_name=repeat('C',210) WHERE id='30000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE recorded_schedule AS SELECT jsonb_build_object('schema_version',1,'kind','custom','currency','usd',
  'late_fee',jsonb_build_object('fixed_cents',0,'rate_bps',0,'grace_days',0,'agreement_basis',NULL),'interest',jsonb_build_object('annual_bps',0,'agreement_basis',NULL),
  'total_cents',350000,'anchor_date','2026-10-05','cadence','custom','count',11,'end_date',NULL,'deposit_cents',NULL,
  'dates',jsonb_build_array(jsonb_build_object('due_date','2026-10-05','amount_cents',50000,'label','Deposit')) ||
    (SELECT jsonb_agg(jsonb_build_object('due_date',to_char(date '2026-11-01'+n*interval '1 month','YYYY-MM-DD'),'amount_cents',30000,'label',NULL) ORDER BY n) FROM generate_series(0,9) n)) AS terms;
SELECT _sales_collection_validate_terms((SELECT terms FROM recorded_schedule));
UPDATE tenant_client_agreements SET agreed_amount_minor=350000,collection_terms=(SELECT terms FROM recorded_schedule),collection_terms_version=1;
CREATE TEMP TABLE context_read(result jsonb);
GRANT INSERT,SELECT ON context_read TO authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO context_read SELECT read_sales_collections('20000000-0000-0000-0000-000000000001','agreement');
SELECT proof_assert((SELECT result->>'tenant_id' FROM context_read)='20000000-0000-0000-0000-000000000001','caller workspace readback');
SELECT proof_assert((SELECT length(result#>>'{rows,0,title}') FROM context_read)=200 AND (SELECT (result#>>'{rows,0,title_truncated}')::boolean FROM context_read),'title bound explicit');
SELECT proof_assert((SELECT length(result#>>'{rows,0,client_name}') FROM context_read)=200 AND (SELECT (result#>>'{rows,0,client_name_truncated}')::boolean FROM context_read),'client name bound explicit');
SELECT proof_assert((SELECT result#>>'{rows,0,client_id}' FROM context_read)='30000000-0000-0000-0000-000000000001','canonical client reference retained');
SELECT proof_assert((SELECT (result#>>'{rows,0,terms_current}')::boolean FROM context_read),'canonical terms match obligation');
SELECT proof_assert((SELECT jsonb_array_length(result#>'{rows,0,collection_terms,dates}') FROM context_read)=11 AND (SELECT (result#>>'{rows,0,collection_terms,dates,0,amount_cents}')::integer FROM context_read)=50000,'exact deposit and finite schedule retained');
RESET ROLE;
SELECT proof_assert((SELECT count(*) FROM paige_workspace_events WHERE source_id=(SELECT (result->>'receipt_id')::uuid FROM context_read) AND capability_key='read_sales_collections')=1,'one canonical read receipt');
SELECT proof_assert(NOT has_function_privilege('service_role','public.read_sales_collections(uuid,text,integer,jsonb,uuid)','EXECUTE'),'service cannot impersonate caller');
SELECT proof_assert(NOT has_function_privilege('anon','public.read_sales_collections(uuid,text,integer,jsonb,uuid)','EXECUTE'),'anonymous denied');
INSERT INTO tenant_products(id,tenant_id,name,status) VALUES('50000000-0000-0000-0000-000000000085','20000000-0000-0000-0000-000000000002','Foreign source','active');
UPDATE tenant_client_agreements SET offer_id='50000000-0000-0000-0000-000000000085';
SET LOCAL ROLE authenticated;
SELECT proof_denied($q$SELECT read_sales_collections('20000000-0000-0000-0000-000000000001','agreement')$q$,'42501','foreign offer reference refused');
RESET ROLE;UPDATE tenant_client_agreements SET offer_id=NULL;
UPDATE tenant_members SET role='member' WHERE tenant_id='20000000-0000-0000-0000-000000000001';SET LOCAL ROLE authenticated;
SELECT proof_denied($q$SELECT read_sales_collections('20000000-0000-0000-0000-000000000001','agreement')$q$,'42501','role revoked');
RESET ROLE;UPDATE tenant_members SET role='owner' WHERE tenant_id='20000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE large_terms AS SELECT jsonb_build_object('schema_version',1,'kind','custom','currency','usd','total_cents',240,
  'anchor_date','2026-01-01','cadence','custom','count',240,'end_date',NULL,'deposit_cents',NULL,
  'late_fee',jsonb_build_object('fixed_cents',0,'rate_bps',0,'grace_days',0,'agreement_basis',NULL),
  'interest',jsonb_build_object('annual_bps',0,'agreement_basis',NULL),
  'dates',(SELECT jsonb_agg(jsonb_build_object('due_date',to_char(date '2026-01-01'+n,'YYYY-MM-DD'),'amount_cents',1,'label',repeat('L',120)) ORDER BY n) FROM generate_series(0,239) n)) AS terms;
SELECT _sales_collection_validate_terms((SELECT terms FROM large_terms));
INSERT INTO tenant_client_agreements(id,tenant_id,contact_id,title,status,agreed_amount_minor,agreed_currency,collection_terms,collection_terms_version)
  SELECT gen_random_uuid(),'20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Bounded source','draft',240,'usd',(SELECT terms FROM large_terms),1 FROM generate_series(1,30);
SET LOCAL ROLE authenticated;
SELECT proof_denied($q$SELECT read_sales_collections('20000000-0000-0000-0000-000000000001','agreement',50)$q$,'22023','aggregate source bound refuses oversized page');
SELECT proof_assert(jsonb_array_length(read_sales_collections('20000000-0000-0000-0000-000000000001','agreement',1)->'rows')=1,'smaller bounded page remains available');
RESET ROLE;
CREATE FUNCTION proof_fail_collection_read_rail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.capability_key='read_sales_collections' THEN RAISE EXCEPTION 'Forced read receipt failure' USING ERRCODE='55000';END IF;RETURN NEW;
END $$;
CREATE TRIGGER proof_collection_read_failure BEFORE INSERT ON paige_workspace_events FOR EACH ROW EXECUTE FUNCTION proof_fail_collection_read_rail();
CREATE TEMP TABLE context_counts AS SELECT (SELECT count(*) FROM paige_sales_export_snapshots) AS snapshots,(SELECT count(*) FROM paige_workspace_events) AS receipts;
SET LOCAL ROLE authenticated;
SELECT proof_denied($q$SELECT read_sales_collections('20000000-0000-0000-0000-000000000001','invoice')$q$,'55000','read receipt failure refuses result');
RESET ROLE;
SELECT proof_assert((SELECT count(*) FROM paige_sales_export_snapshots)=(SELECT snapshots FROM context_counts),'failed read rolls back snapshot');
SELECT proof_assert((SELECT count(*) FROM paige_workspace_events)=(SELECT receipts FROM context_counts),'failed read cannot claim receipt');
SELECT 'PASS collection context: canonical references, explicit text bounds, caller scope, private ACL and atomic receipt/snapshot rollback';
ROLLBACK;
