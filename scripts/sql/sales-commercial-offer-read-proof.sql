-- Runs within the existing canonical Sales proof transaction; no hosted data.
RESET ROLE;
ALTER TABLE tenant_products ADD COLUMN description text, ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE tenant_prices ADD COLUMN kind text DEFAULT 'one_time',ADD COLUMN installments_total integer,ADD COLUMN sort_order integer DEFAULT 0;
INSERT INTO tenant_products(id,tenant_id,name,status,description) VALUES
 ('40000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','Test service','active','Duplicate requires choice'),
 ('40000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','100% plan_','paused',NULL);
INSERT INTO tenant_prices(id,tenant_id,product_id,currency,unit_amount,billing_interval,interval_count,active,kind,installments_total)
 SELECT ('50000000-0000-0000-0000-'||lpad((100+i)::text,12,'0'))::uuid,'20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','usd',30000,'month',1,true,'installment',10 FROM generate_series(1,23)i;
\ir ../../supabase/migrations/20270583000000_sales_commercial_offer_read.sql
\ir ../../supabase/migrations/20270583000000_sales_commercial_offer_read.sql
SELECT proof_assert(NOT has_function_privilege('anon','public.read_sales_commercial_offers(uuid,text,uuid,integer,uuid)','EXECUTE') AND NOT has_function_privilege('service_role','public.read_sales_commercial_offers(uuid,text,uuid,integer,uuid)','EXECUTE'),'offer read only caller authenticated, not anonymous/service');
SET LOCAL ROLE authenticated;
SELECT proof_assert(jsonb_array_length(read_sales_commercial_offers('20000000-0000-0000-0000-000000000001','Test service')->'offers')=2,'duplicate offer names remain two choices');
SELECT proof_assert(jsonb_array_length(read_sales_commercial_offers('20000000-0000-0000-0000-000000000001','%')->'offers')=1,'percent search is literal rather than wildcard');
SELECT proof_assert(read_sales_commercial_offers('20000000-0000-0000-0000-000000000001','plan_')#>>'{offers,0,status}'='paused','read preserves recorded availability without inventing active');
SELECT proof_assert(jsonb_array_length(read_sales_commercial_offers('20000000-0000-0000-0000-000000000001',NULL,'40000000-0000-0000-0000-000000000002')->'offers')=0,'foreign exact offer never disclosed');
SELECT proof_assert(jsonb_array_length(read_sales_commercial_offers('20000000-0000-0000-0000-000000000001',NULL,'40000000-0000-0000-0000-000000000003')#>'{offers,0,prices}')=20 AND (read_sales_commercial_offers('20000000-0000-0000-0000-000000000001',NULL,'40000000-0000-0000-0000-000000000003')#>>'{offers,0,prices_has_more}')::boolean,'bounded price choices expose truncation');
SELECT proof_assert(read_sales_commercial_offers('20000000-0000-0000-0000-000000000001',NULL,'40000000-0000-0000-0000-000000000003')#>>'{offers,0,prices,0,unit_minor}'='30000' AND read_sales_commercial_offers('20000000-0000-0000-0000-000000000001',NULL,'40000000-0000-0000-0000-000000000003')#>>'{offers,0,prices,0,installments_total}'='10','installment price stays a recorded cycle amount, not total');
SELECT proof_assert((read_sales_commercial_offers('20000000-0000-0000-0000-000000000001','Test',NULL,1)->>'has_more')::boolean AND read_sales_commercial_offers('20000000-0000-0000-0000-000000000001','Test',NULL,1)->>'next_cursor'='40000000-0000-0000-0000-000000000003','offer cursor is bounded current-tenant record');
SELECT proof_denied($q$SELECT read_sales_commercial_offers('20000000-0000-0000-0000-000000000002','service')$q$,'42501','foreign expected workspace refused');
SELECT proof_denied($q$SELECT read_sales_commercial_offers('20000000-0000-0000-0000-000000000001',NULL,NULL)$q$,'22023','unbounded offer listing refused');
SELECT proof_denied($q$SELECT read_sales_commercial_offers('20000000-0000-0000-0000-000000000001','Test',NULL,21)$q$,'22023','oversized offer result refused');
RESET ROLE;
UPDATE tenant_members SET status='suspended' WHERE tenant_id='20000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT proof_denied($q$SELECT read_sales_commercial_offers('20000000-0000-0000-0000-000000000001','Test')$q$,'42501','suspended owner refused despite stored owner role');
RESET ROLE;
UPDATE tenant_members SET status='active',role='member' WHERE tenant_id='20000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT proof_denied($q$SELECT read_sales_commercial_offers('20000000-0000-0000-0000-000000000001','Test')$q$,'42501','non-owner member refused');
RESET ROLE;
UPDATE tenant_members SET role='owner' WHERE tenant_id='20000000-0000-0000-0000-000000000001';
SELECT set_config('test.actor','',true);
SET LOCAL ROLE authenticated;
SELECT proof_denied($q$SELECT read_sales_commercial_offers('20000000-0000-0000-0000-000000000001','Test')$q$,'42501','missing authenticated actor refused');
RESET ROLE;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
