\set ON_ERROR_STOP on
-- DISPOSABLE LOCAL POSTGRES ONLY. Transaction rolls back all fixture data/schema.
-- This proves real PostgreSQL authenticated-role/RLS/RPC behavior with auth helpers
-- stubbed to caller GUCs. Hosted Supabase token/workspace helper behavior is UNVERIFIED.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE TABLE public.tenants(id uuid PRIMARY KEY);
CREATE TABLE public.clients(id uuid PRIMARY KEY,tenant_id uuid NOT NULL);
CREATE TABLE public.deals(id uuid PRIMARY KEY);
CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid);
CREATE TABLE public.tenant_products(id uuid PRIMARY KEY,tenant_id uuid,name text,status text);
CREATE TABLE public.tenant_prices(id uuid PRIMARY KEY,tenant_id uuid,product_id uuid,
 currency text,unit_amount integer,billing_interval text,interval_count integer,active boolean);
CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.workspace',true),'')::uuid $$;
CREATE FUNCTION public.is_tenant_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT $1=public.current_user_tenant_id() AND current_setting('test.admin',true)='true' $$;
\ir ../../supabase/migrations/20260629204156_de73719f-ec4d-4fbe-a0f4-5855a64c1562.sql
-- Deliberately permissive existing policy exposes whether restrictive guards work.
CREATE POLICY proof_member_all ON public.paige_invoices FOR ALL TO authenticated
USING (tenant_id=public.current_user_tenant_id()) WITH CHECK (tenant_id=public.current_user_tenant_id());
\ir ../../supabase/migrations/20270535000000_sales_billing_drafts.sql
\ir ../../supabase/migrations/20270535000000_sales_billing_drafts.sql
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT SELECT ON public.tenant_members TO authenticated;
INSERT INTO auth.users VALUES ('10000000-0000-0000-0000-000000000001');
INSERT INTO public.tenants VALUES ('20000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002');
INSERT INTO public.clients VALUES ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002');
INSERT INTO public.tenant_products VALUES
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Test service','active'),
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Other service','active');
INSERT INTO public.tenant_prices VALUES
 ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','usd',999,'one_time',1,true),
 ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','usd',999,'one_time',1,true),
 ('50000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','usd',1500,'month',1,true),
 ('50000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','usd',999,'one_time',1,true);
INSERT INTO public.paige_invoices(id,tenant_id,contact_id,invoice_number,amount_total_cents)
 VALUES ('60000000-0000-0000-0000-000000000099','20000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-000000000001','LEGACY-TEST',42);
CREATE FUNCTION public.proof_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS
$$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION public.proof_denied(statement text,expected_state text,label text) RETURNS void LANGUAGE plpgsql AS
$$ BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=expected_state THEN RAISE NOTICE 'PASS: % (%)',label,SQLSTATE; RETURN; END IF;
    RAISE EXCEPTION 'FAIL: % expected %, got %: %',label,expected_state,SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: % was allowed',label;
END $$;
-- Stable neutral fixture identifiers are local-only.
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true),
 set_config('test.workspace','20000000-0000-0000-0000-000000000001',true),set_config('test.admin','true',true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE proof_input(draft jsonb);
INSERT INTO proof_input VALUES ('{"client_id":"30000000-0000-0000-0000-000000000001","item":"Consultation","unit_minor":999,"quantity":3,"kind":"deposit","deposit_basis_points":2500,"provider":"stripe","currency":"usd","due_date":"2026-12-01","recipient_email":"client@example.test","memo":"Test draft"}');
CREATE TEMP TABLE proof_results(label text,result jsonb);
INSERT INTO proof_results SELECT 'first',public.save_sales_billing_draft(
 '20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',0,
 '70000000-0000-0000-0000-000000000001',draft) FROM proof_input;
INSERT INTO proof_results SELECT 'retry',public.save_sales_billing_draft(
 '20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',0,
 '70000000-0000-0000-0000-000000000001',draft) FROM proof_input;
SELECT proof_assert((SELECT result FROM proof_results WHERE label='first')=
 (SELECT result FROM proof_results WHERE label='retry'),'same-operation exact replay');
SELECT proof_assert((SELECT result#>>'{row,billing_draft,total_minor}' FROM proof_results WHERE label='first')='2997'
 AND (SELECT result#>>'{row,billing_draft,due_now_minor}' FROM proof_results WHERE label='first')='749'
 AND (SELECT result#>>'{row,billing_draft,remainder_minor}' FROM proof_results WHERE label='first')='2248',
 'integer round-half-up deposit invariant');
SELECT proof_assert((SELECT result#>>'{row,billing_draft_version}' FROM proof_results WHERE label='first')='1'
 AND (SELECT result#>>'{row,status}' FROM proof_results WHERE label='first')='draft','canonical draft/version readback');
SELECT proof_assert((SELECT count(*) FROM paige_invoices WHERE billing_draft_version IS NULL)=1,'legacy row unchanged');
SELECT proof_denied($q$SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',0,'70000000-0000-0000-0000-000000000002',(SELECT draft FROM proof_input))$q$,'40001','duplicate create conflicts');
SELECT proof_denied($q$SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',0,'70000000-0000-0000-0000-000000000001',(SELECT draft||'{"memo":"changed"}' FROM proof_input))$q$,'22023','operation reuse refuses changed payload');
-- Table guard blocks writes even though fixture grants/policies permit legacy writes.
SELECT proof_denied($q$INSERT INTO paige_invoices(id,tenant_id,contact_id,invoice_number,amount_total_cents,billing_draft_version) VALUES ('60000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','DIRECT',1,1)$q$,'42501','direct managed insert denied');
SELECT proof_denied($q$UPDATE paige_invoices SET billing_last_operation_id='70000000-0000-0000-0000-000000000009' WHERE invoice_number='LEGACY-TEST'$q$,'42501','legacy promotion denied');
DO $$ DECLARE n int; BEGIN
 UPDATE paige_invoices SET memo='bypass' WHERE billing_draft_version IS NOT NULL;
 GET DIAGNOSTICS n=ROW_COUNT; PERFORM proof_assert(n=0,'managed update invisible to direct writer');
 DELETE FROM paige_invoices WHERE billing_draft_version IS NOT NULL;
 GET DIAGNOSTICS n=ROW_COUNT; PERFORM proof_assert(n=0,'managed delete invisible to direct writer');
END $$;
-- Input, role, ownership and amount matrix all use the actual authenticated role.
DO $$ DECLARE patch jsonb; base jsonb; statement text; BEGIN
 SELECT draft INTO base FROM proof_input;
 FOR patch IN SELECT value FROM jsonb_array_elements('[
 {"client_id":"30000000-0000-0000-0000-000000000002"},
 {"price_id":"50000000-0000-0000-0000-000000000002","unit_minor":null},
 {"price_id":"50000000-0000-0000-0000-000000000004","unit_minor":null},
 {"unit_minor":0},{"unit_minor":-1},{"unit_minor":1.5},{"unit_minor":2147483647,"quantity":2},
 {"quantity":0},{"quantity":1001},{"quantity":"3"},{"deposit_basis_points":10000},
 {"deposit_basis_points":0},{"unit_minor":1,"quantity":1,"deposit_basis_points":1},
 {"currency":"eur"},{"provider":"unsupported"},{"recipient_email":"invalid"},
 {"memo":"PLACEHOLDER"},{"issued":true},{"kind":"recurring","cadence":"weekly"},
 {"price_id":"50000000-0000-0000-0000-000000000001"}
 ]'::jsonb) LOOP
   IF patch->>'memo'='PLACEHOLDER' THEN patch:=jsonb_build_object('memo',repeat('x',2001)); END IF;
   statement:=format('SELECT save_sales_billing_draft(%L,%L,0,%L,%L::jsonb)',
    '20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000010',
    '70000000-0000-0000-0000-000000000010',(base||patch)::text);
   PERFORM proof_denied(statement,'22023','invalid draft '||patch::text);
 END LOOP;
END $$;
SELECT set_config('test.admin','false',true);
SELECT proof_denied($q$SELECT list_sales_billing_drafts('20000000-0000-0000-0000-000000000001')$q$,'42501','wrong role list denied');
SELECT proof_denied($q$SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002',0,'70000000-0000-0000-0000-000000000002',(SELECT draft FROM proof_input))$q$,'42501','wrong role save denied');
SELECT proof_assert((SELECT count(*) FROM paige_invoices WHERE billing_draft_version IS NOT NULL)=0,'wrong role direct select denied');
SELECT set_config('test.admin','true',true),set_config('test.workspace','20000000-0000-0000-0000-000000000002',true);
SELECT proof_denied($q$SELECT list_sales_billing_drafts('20000000-0000-0000-0000-000000000001')$q$,'42501','stale workspace list denied');
SELECT proof_assert(jsonb_array_length(list_sales_billing_drafts('20000000-0000-0000-0000-000000000002')->'rows')=0,'other tenant list isolated');
SELECT proof_assert((SELECT count(*) FROM paige_invoices)=0,'other workspace direct select isolated');
SELECT proof_denied($q$SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000001',0,'70000000-0000-0000-0000-000000000002','{"client_id":"30000000-0000-0000-0000-000000000002","item":"Other","unit_minor":100,"quantity":1,"kind":"one_time","provider":"paypal","currency":"usd"}')$q$,'22023','cross tenant draft id collision refused');
SELECT set_config('test.actor','',true);
SELECT proof_denied($q$SELECT list_sales_billing_drafts('20000000-0000-0000-0000-000000000002')$q$,'42501','unauthenticated helper denied');
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true),set_config('test.workspace','20000000-0000-0000-0000-000000000001',true);
-- Canonical catalogue amount is copied; changing it must not change retry facts.
INSERT INTO proof_results SELECT 'catalogue',save_sales_billing_draft(
 '20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002',0,
 '70000000-0000-0000-0000-000000000002',
 '{"client_id":"30000000-0000-0000-0000-000000000001","price_id":"50000000-0000-0000-0000-000000000001","item":"Catalogue","quantity":2,"kind":"one_time","provider":"paypal","currency":"usd"}');
RESET ROLE;
UPDATE tenant_prices SET unit_amount=8888,active=false WHERE id='50000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
INSERT INTO proof_results SELECT 'catalogue-retry',save_sales_billing_draft(
 '20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002',0,
 '70000000-0000-0000-0000-000000000002',
 '{"client_id":"30000000-0000-0000-0000-000000000001","price_id":"50000000-0000-0000-0000-000000000001","item":"Catalogue","quantity":2,"kind":"one_time","provider":"paypal","currency":"usd"}');
SELECT proof_assert((SELECT result FROM proof_results WHERE label='catalogue')=
 (SELECT result FROM proof_results WHERE label='catalogue-retry'),'catalogue changed retry returns original facts');
INSERT INTO proof_results SELECT 'recurring',save_sales_billing_draft(
 '20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000003',0,
 '70000000-0000-0000-0000-000000000003',
 '{"client_id":"30000000-0000-0000-0000-000000000001","price_id":"50000000-0000-0000-0000-000000000003","item":"Monthly","quantity":1,"kind":"recurring","cadence":"monthly","provider":"stripe","currency":"usd"}');
SELECT proof_assert((SELECT result#>>'{row,billing_draft,total_minor}' FROM proof_results WHERE label='recurring')='1500','monthly canonical price snapshot');
SELECT proof_assert((list_sales_billing_drafts('20000000-0000-0000-0000-000000000001',1)->>'has_more')::boolean
 AND jsonb_array_length(list_sales_billing_drafts('20000000-0000-0000-0000-000000000001',1)->'rows')=1,'bounded pagination has_more');
SELECT proof_assert((list_sales_billing_drafts('20000000-0000-0000-0000-000000000001',1)->>'next_cursor')='60000000-0000-0000-0000-000000000003','stable UUID descending cursor');
SELECT proof_assert(jsonb_array_length(list_sales_billing_drafts('20000000-0000-0000-0000-000000000001',50,'60000000-0000-0000-0000-000000000003')->'rows')=2,'keyset next page');
INSERT INTO proof_results SELECT 'edited',save_sales_billing_draft(
 '20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',1,
 '70000000-0000-0000-0000-000000000004',draft||'{"memo":"Updated"}') FROM proof_input;
SELECT proof_assert((SELECT result#>>'{row,billing_draft_version}' FROM proof_results WHERE label='edited')='2','successful CAS edit increments version');
SELECT proof_denied($q$SELECT save_sales_billing_draft('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',0,'70000000-0000-0000-0000-000000000001',(SELECT draft FROM proof_input))$q$,'40001','older retry after edit refuses stale version');
RESET ROLE;
SELECT proof_denied($q$UPDATE paige_invoices SET status='sent' WHERE billing_draft_version IS NOT NULL$q$,'23514','even privileged legacy writer cannot issue managed draft');
SET LOCAL ROLE anon;
SELECT public.proof_denied($q$SELECT public.list_sales_billing_drafts('20000000-0000-0000-0000-000000000001')$q$,'42501','anon RPC execute revoked');
RESET ROLE;
SELECT proof_assert((SELECT count(*) FROM paige_invoices WHERE billing_draft_version IS NOT NULL AND
 (hosted_invoice_url IS NOT NULL OR stripe_invoice_id IS NOT NULL OR status<>'draft'))=0,'no provider or issued facts');
ROLLBACK;
\echo SALES BILLING DRAFT SQL PROOF PASS (local auth-helper stubs; hosted auth/provider UNVERIFIED)
