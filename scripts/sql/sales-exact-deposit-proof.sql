-- Appended to the canonical local invoice snapshot/lifecycle/preferences proof. No hosted writes.
RESET ROLE;
CREATE TEMP TABLE exact_originals AS SELECT id,billing_draft,billing_document,billing_document_digest
 FROM paige_invoices WHERE billing_issued_at IS NOT NULL;
\ir ../../supabase/migrations/20270571000000_sales_exact_invoice_deposit.sql
\ir ../../supabase/migrations/20270571000000_sales_exact_invoice_deposit.sql
SELECT proof_assert(NOT EXISTS(SELECT 1 FROM exact_originals old JOIN paige_invoices r USING(id)
 WHERE old.billing_draft IS DISTINCT FROM r.billing_draft OR old.billing_document IS DISTINCT FROM r.billing_document
 OR old.billing_document_digest IS DISTINCT FROM r.billing_document_digest),'issued historical facts unchanged');
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true),set_config('test.workspace','20000000-0000-0000-0000-000000000001',true),set_config('test.admin','true',true);
SET ROLE authenticated;
CREATE TEMP TABLE exact_input AS SELECT draft||'{"schema_version":3,"agreement_id":null,"deposit_basis_points":null,"deposit_minor":50000,"items":[{"price_id":null,"item":"Commercial service","unit_minor":350000,"quantity":1}]}'::jsonb AS draft FROM snapshot_input;
CREATE TEMP TABLE exact_saved AS SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000801',0,'70000000-0000-0000-0000-000000000801',draft) AS result FROM exact_input;
SELECT proof_assert((SELECT result#>>'{row,billing_draft,schema_version}'='3'
 AND result#>>'{row,billing_draft,deposit_minor}'='50000'
 AND result#>>'{row,billing_draft,due_now_minor}'='50000'
 AND result#>>'{row,billing_draft,remainder_minor}'='300000'
 AND result#>>'{row,amount_total_cents}'='350000' FROM exact_saved),'exact amount persists without percentage approximation');
SELECT proof_assert((SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000801',0,'70000000-0000-0000-0000-000000000801',draft)=result FROM exact_input CROSS JOIN exact_saved),'exact draft replay returns identical saved row');
SELECT proof_denied($q$SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000801',0,'70000000-0000-0000-0000-000000000801',(SELECT draft||'{"memo":"Changed replay"}' FROM exact_input))$q$,'22023','exact replay rejects changed payload');
SELECT proof_denied($q$SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000801',0,'70000000-0000-0000-0000-000000000805',(SELECT draft FROM exact_input))$q$,'40001','exact draft stale version refused');
SELECT set_config('test.admin','false',true);
SELECT proof_denied($q$SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000801',0,'70000000-0000-0000-0000-000000000801',(SELECT draft FROM exact_input))$q$,'42501','exact replay rechecks role');
SELECT set_config('test.admin','true',true),set_config('test.workspace','20000000-0000-0000-0000-000000000002',true);
SELECT proof_denied($q$SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000801',0,'70000000-0000-0000-0000-000000000801',(SELECT draft FROM exact_input))$q$,'42501','exact replay rechecks tenant');
SELECT set_config('test.workspace','20000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE patch jsonb; candidate jsonb; BEGIN
 FOR patch IN SELECT value FROM jsonb_array_elements('[{"deposit_minor":0},{"deposit_minor":350000},{"deposit_minor":350001},{"deposit_minor":1.5},{"deposit_minor":null},{"deposit_basis_points":1429},{"kind":"one_time"},{"schema_version":2},{"schema_version":4}]') LOOP
  SELECT draft||patch INTO candidate FROM exact_input;
  PERFORM proof_denied(format('SELECT save_sales_billing_draft(%L,%L,0,%L,%L::jsonb)','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000802','70000000-0000-0000-0000-000000000802',candidate::text),'22023','invalid exact deposit refused');
 END LOOP;
 SELECT draft-'deposit_minor' INTO candidate FROM exact_input;
 PERFORM proof_denied(format('SELECT save_sales_billing_draft(%L,%L,0,%L,%L::jsonb)','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000802','70000000-0000-0000-0000-000000000802',candidate::text),'22023','missing exact amount refused');
END $$;
RESET ROLE;
SET ROLE service_role;
SELECT proof_preferences(804,3,'{"prefix":"EXACT-","next_number":1}');
SELECT proof_assert(preview_sales_invoice_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','{"action":"invoice.publish","invoice_id":"60000000-0000-0000-0000-000000000801","expected_version":1}')->>'eligible'='true','exact draft publication preview admits schema3');
SELECT execute_sales_invoice_command('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000803','{"action":"invoice.publish","invoice_id":"60000000-0000-0000-0000-000000000801","expected_version":1}',proof_governance('invoice.publish','sales_publish_invoice'));
RESET ROLE;
SELECT proof_assert((SELECT status='issued' AND billing_document#>>'{snapshot,deposit_minor}'='50000'
 AND billing_document#>>'{snapshot,due_now_minor}'='50000' AND billing_document#>>'{snapshot,remainder_minor}'='300000'
 FROM paige_invoices WHERE id='60000000-0000-0000-0000-000000000801'),'canonical issuance freezes exact deposit and remaining obligation');
