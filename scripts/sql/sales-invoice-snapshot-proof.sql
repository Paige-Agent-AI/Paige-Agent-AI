-- Appended inside sales-billing-drafts-proof.sql's disposable transaction.
RESET ROLE;
CREATE TABLE public.client_contact_methods(id uuid PRIMARY KEY,tenant_id uuid,client_id uuid,kind text,value text);
CREATE TABLE public.paige_agreements(id uuid PRIMARY KEY,tenant_id uuid,contact_id uuid,title text,version integer,status text,expires_at timestamptz);
INSERT INTO clients VALUES ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001');
INSERT INTO client_contact_methods VALUES
 ('80000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','email','client@example.test'),
 ('80000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','email','other@example.test'),
 ('80000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','email','client@example.test'),
 ('80000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','phone','client@example.test');
INSERT INTO paige_agreements VALUES
 ('90000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Matching agreement',1,'draft',NULL),
 ('90000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','Other agreement',1,'draft',NULL),
 ('90000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Voided agreement',1,'voided',NULL),
 ('90000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','Different client',1,'draft',NULL),
 ('90000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Expired agreement',1,'sent',now()-interval '1 day');
\ir ../../supabase/migrations/20270536000001_sales_invoice_snapshot_v2.sql
\ir ../../supabase/migrations/20270536000001_sales_invoice_snapshot_v2.sql
\ir ../../supabase/migrations/20270539000000_sales_invoice_line_description.sql
\ir ../../supabase/migrations/20270539000000_sales_invoice_line_description.sql
UPDATE tenant_prices SET active=true,unit_amount=999 WHERE id='50000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE snapshot_input(draft jsonb);
INSERT INTO snapshot_input VALUES ('{"schema_version":2,"client_id":"30000000-0000-0000-0000-000000000001","items":[{"price_id":"50000000-0000-0000-0000-000000000001","item":"Catalog service","description":"Saved multiline\ndescription","unit_minor":null,"quantity":2},{"price_id":null,"item":"Custom review","unit_minor":1001,"quantity":1}],"kind":"deposit","deposit_basis_points":2500,"currency":"usd","cadence":null,"recipient_email":"client@example.test","recipient_phone":"+15555550123","email_source_method_id":"80000000-0000-0000-0000-000000000001","phone_source_method_id":null,"billing_address":{"line1":"123 Example St","line2":"Suite 2","city":"Sample","region":"CA","postal_code":"90210","country":null},"agreement_id":"90000000-0000-0000-0000-000000000001","processor_intent":null,"payment_method_intents":["zelle","cash","wire"],"delivery_channel_intents":["email","sms"],"due_date":"2026-12-01","memo":"Invoice-only snapshot"}');
CREATE TEMP TABLE snapshot_results(label text,result jsonb);
INSERT INTO snapshot_results SELECT 'created',save_sales_billing_draft(
 '20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000077',0,
 '70000000-0000-0000-0000-000000000077',draft) FROM snapshot_input;
SELECT proof_assert((SELECT result#>>'{row,amount_total_cents}' FROM snapshot_results WHERE label='created')='2999'
 AND (SELECT result#>>'{row,billing_draft,due_now_minor}' FROM snapshot_results WHERE label='created')='750'
 AND (SELECT result#>>'{row,billing_draft,remainder_minor}' FROM snapshot_results WHERE label='created')='2249','aggregate once-rounded deposit');
SELECT proof_assert((SELECT jsonb_array_length(result#>'{row,line_items}') FROM snapshot_results WHERE label='created')=2
 AND (SELECT result#>>'{row,billing_draft,billing_address,line2}' FROM snapshot_results WHERE label='created')='Suite 2'
 AND (SELECT result#>'{row,billing_draft,billing_address,country}' FROM snapshot_results WHERE label='created')='null'::jsonb
 AND (SELECT result#>'{row,billing_draft,delivery_channel_intents}' FROM snapshot_results WHERE label='created')='["email","sms"]'::jsonb,'all items/address/multiple delivery intents persist');
SELECT proof_assert((SELECT result#>>'{row,billing_draft,agreement_snapshot,title}' FROM snapshot_results WHERE label='created')='Matching agreement','canonical matching agreement snapshot');
DO $$ DECLARE patch jsonb; base jsonb; statement text; BEGIN
 SELECT draft INTO base FROM snapshot_input;
 FOR patch IN SELECT value FROM jsonb_array_elements('[
 {"schema_version":3},{"client_id":"30000000-0000-0000-0000-000000000002"},
 {"items":[]},{"items":[{"price_id":null,"item":"x","unit_minor":2147483647,"quantity":2}]},
 {"items":[{"price_id":null,"item":"x","unit_minor":1.5,"quantity":1}]},
 {"items":[{"price_id":"50000000-0000-0000-0000-000000000002","item":"x","unit_minor":null,"quantity":1}]},
 {"items":[{"price_id":"50000000-0000-0000-0000-000000000004","item":"x","unit_minor":null,"quantity":1}]},
 {"items":[{"price_id":"50000000-0000-0000-0000-000000000003","item":"x","unit_minor":null,"quantity":1}]},
 {"items":[{"price_id":null,"item":"x","unit_minor":1000,"quantity":1,"hidden":true}]},
 {"currency":"eur"},{"kind":"recurring","cadence":"monthly","deposit_basis_points":null},
 {"recipient_email":"invalid"},{"recipient_phone":"-------"},
 {"email_source_method_id":"80000000-0000-0000-0000-000000000002"},
 {"email_source_method_id":"80000000-0000-0000-0000-000000000003"},
 {"email_source_method_id":"80000000-0000-0000-0000-000000000004"},
 {"recipient_email":"manual@example.test"},
 {"agreement_id":"90000000-0000-0000-0000-000000000002"},
 {"agreement_id":"90000000-0000-0000-0000-000000000003"},
 {"agreement_id":"90000000-0000-0000-0000-000000000004"},
 {"agreement_id":"90000000-0000-0000-0000-000000000005"},
 {"billing_address":{"line1":"x","secret":true}},
 {"payment_method_intents":["card","card"]},{"payment_method_intents":["card",42]},
 {"delivery_channel_intents":["imessage"]},{"delivery_channel_intents":["email","email"]},
 {"issued":true},{"items":[{"price_id":null,"item":"x","unit_minor":1,"quantity":1}],"deposit_basis_points":1}
 ]'::jsonb) LOOP
   statement:=format('SELECT save_sales_billing_draft(%L,%L,0,%L,%L::jsonb)',
    '20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000078',
    '70000000-0000-0000-0000-000000000078',(base||patch)::text);
   PERFORM proof_denied(statement,'22023','versioned negative '||patch::text);
 END LOOP;
END $$;
DO $$ DECLARE base jsonb; many jsonb; BEGIN
 SELECT draft INTO base FROM snapshot_input;
 SELECT jsonb_agg(jsonb_build_object('price_id',NULL,'item',repeat('x',200),'unit_minor',100,'quantity',1)) INTO many FROM generate_series(1,50);
 PERFORM proof_assert((save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000079',0,
  '70000000-0000-0000-0000-000000000079',base||jsonb_build_object('items',many)))#>>'{row,amount_total_cents}'='5000','50 bounded long-label lines accepted');
 PERFORM proof_denied(format('SELECT save_sales_billing_draft(%L,%L,0,%L,%L::jsonb)',
  '20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000078','70000000-0000-0000-0000-000000000078',
  (base||jsonb_build_object('items',many||jsonb_build_array(many->0)))::text),'22023','51 lines refused');
END $$;
-- Legacy operation replay survives the forward migration and changed Catalog.
SELECT proof_assert((SELECT result FROM proof_results WHERE label='catalogue')=save_sales_billing_draft(
 '20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002',0,
 '70000000-0000-0000-0000-000000000002',
 '{"client_id":"30000000-0000-0000-0000-000000000001","price_id":"50000000-0000-0000-0000-000000000001","item":"Catalogue","quantity":2,"kind":"one_time","provider":"paypal","currency":"usd"}'),'legacy operation replay remains exact after migration');
RESET ROLE;
UPDATE tenant_prices SET active=false,unit_amount=8000 WHERE id='50000000-0000-0000-0000-000000000001';
UPDATE client_contact_methods SET value='changed@example.test' WHERE id='80000000-0000-0000-0000-000000000001';
UPDATE paige_agreements SET status='voided',version=2 WHERE id='90000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
INSERT INTO snapshot_results SELECT 'replayed',save_sales_billing_draft(
 '20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000077',0,
 '70000000-0000-0000-0000-000000000077',draft) FROM snapshot_input;
SELECT proof_assert((SELECT result FROM snapshot_results WHERE label='created')=(SELECT result FROM snapshot_results WHERE label='replayed'),'versioned replay ignores mutable Catalog CRM agreement');
SELECT proof_denied($q$SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000077',0,'70000000-0000-0000-0000-000000000077',(SELECT draft||'{"memo":"Changed"}' FROM snapshot_input))$q$,'22023','versioned operation rejects changed request');
SELECT set_config('test.admin','false',true);
SELECT proof_denied($q$SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000077',0,'70000000-0000-0000-0000-000000000077',(SELECT draft FROM snapshot_input))$q$,'42501','replay rechecks current role');
SELECT set_config('test.admin','true',true),set_config('test.workspace','20000000-0000-0000-0000-000000000002',true);
SELECT proof_denied($q$SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000077',0,'70000000-0000-0000-0000-000000000077',(SELECT draft FROM snapshot_input))$q$,'42501','replay rechecks workspace');
SELECT set_config('test.workspace','20000000-0000-0000-0000-000000000001',true);
RESET ROLE;
SELECT proof_assert((SELECT count(*) FROM paige_invoices WHERE billing_draft_version IS NOT NULL AND
 (hosted_invoice_url IS NOT NULL OR sent_at IS NOT NULL OR paid_at IS NOT NULL OR status<>'draft'))=0,'no provider dispatch or legacy promotion');
SET LOCAL ROLE authenticated;
DO $$ DECLARE base jsonb; candidate jsonb; BEGIN
 SELECT draft INTO base FROM snapshot_input;
 base := base || '{"email_source_method_id":null,"phone_source_method_id":null,"agreement_id":null}'::jsonb;
 base := jsonb_set(base,'{items}',jsonb_build_array(jsonb_build_object('price_id',NULL,'item','Custom scope','unit_minor',1000,'quantity',1)));
 candidate := jsonb_set(base,'{items,0,description}',to_jsonb(repeat('x',10000)));
 PERFORM proof_assert((save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000091',0,'70000000-0000-0000-0000-000000000091',candidate)#>>'{row,billing_draft,items,0,description}')=repeat('x',10000),'10000 description accepted intact');
 candidate := jsonb_set(base,'{items,0,description}',to_jsonb(repeat('x',10001)));
 PERFORM proof_denied(format('SELECT save_sales_billing_draft(%L,%L,0,%L,%L::jsonb)','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000092','70000000-0000-0000-0000-000000000092',candidate::text),'22023','10001 description refused');
 candidate := jsonb_set(base,'{items,0,description}','42'::jsonb);
 PERFORM proof_denied(format('SELECT save_sales_billing_draft(%L,%L,0,%L,%L::jsonb)','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000092','70000000-0000-0000-0000-000000000092',candidate::text),'22023','nontext description refused');
 END $$;
RESET ROLE;
\pset tuples_only on
\pset format unaligned
SELECT jsonb_build_object('snapshot_roundtrip',(SELECT result FROM snapshot_results WHERE label='created'));
