-- Real function execution on fixture tables. Membership helpers remain fixtures:
-- these assertions prove wrapper ordering/ACL/CAS, not production membership policy.
\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION proof_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE OR REPLACE FUNCTION proof_denied(stmt text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=expected THEN RETURN; END IF;
    RAISE EXCEPTION 'wrong refusal [%]: %',SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION 'missing refusal';
END $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
SELECT proof_assert(NOT has_function_privilege('authenticated','public._save_client_agreement(uuid,uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,text,integer,integer,text,date,date,date,text,text,timestamptz)','EXECUTE'), 'private authenticated denied');
SELECT proof_assert(NOT has_function_privilege('anon','public._save_client_agreement(uuid,uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,text,integer,integer,text,date,date,date,text,text,timestamptz)','EXECUTE'), 'private anonymous denied');
SELECT proof_assert(NOT has_function_privilege('service_role','public._save_client_agreement(uuid,uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,text,integer,integer,text,date,date,date,text,text,timestamptz)','EXECUTE'), 'private service denied');
SET ROLE authenticated;
SELECT proof_denied($q$SELECT public._save_client_agreement(NULL,NULL,NULL,NULL,NULL,'one_time','negotiated')$q$,'42501');
CREATE TEMP TABLE saved AS SELECT public.save_client_agreement(
 'aaaaaaaa-0000-4000-8000-000000000001',NULL,
 'c1111111-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000f1',
 'installment','negotiated',NULL,350000,' USD ','month',1,10,'custom','2026-11-01',NULL,NULL,' Test package ') AS row;
SELECT proof_assert(row->>'agreed_amount_minor'='350000' AND row->>'agreed_currency'='usd'
 AND row->>'installments_total'='10' AND row->>'title'='Test package'
 AND row->>'created_by'='11111111-0000-4000-8000-000000000001', 'human create normalized canonical readback') FROM saved;
SELECT proof_denied(format($q$SELECT public.save_client_agreement('aaaaaaaa-0000-4000-8000-000000000001',%L,'c1111111-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000f1','one_time','negotiated',NULL,400000,'usd',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2000-01-01')$q$,row->>'id'),'40001') FROM saved;
SELECT proof_denied($q$SELECT public.save_client_agreement('bbbbbbbb-0000-4000-8000-000000000001',NULL,'ffffffff-0000-4000-8000-000000000001','ffffffff-0000-4000-8000-000000000002','one_time','negotiated')$q$,'42501');
RESET ROLE;
SELECT proof_assert(a.agreed_amount_minor=350000, 'stale edit did not write') FROM tenant_client_agreements a JOIN saved s ON a.id=(s.row->>'id')::uuid;
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid) RETURNS boolean LANGUAGE sql AS 'select false';
SET ROLE authenticated;
SELECT proof_denied($q$SELECT public.save_client_agreement('aaaaaaaa-0000-4000-8000-000000000001',NULL,'ffffffff-0000-4000-8000-000000000001','ffffffff-0000-4000-8000-000000000002','one_time','negotiated')$q$,'42501');
RESET ROLE;
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid) RETURNS boolean LANGUAGE sql AS 'select true';
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'select null::uuid';
SET ROLE authenticated;
SELECT proof_denied($q$SELECT public.save_client_agreement('aaaaaaaa-0000-4000-8000-000000000001',NULL,'ffffffff-0000-4000-8000-000000000001','ffffffff-0000-4000-8000-000000000002','one_time','negotiated')$q$,'42501');
RESET ROLE;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$select '11111111-0000-4000-8000-000000000001'::uuid$$;
SET ROLE anon;
SELECT proof_denied($q$SELECT public._save_client_agreement(NULL,NULL,NULL,NULL,NULL,'one_time','negotiated')$q$,'42501');
RESET ROLE;
SET ROLE service_role;
SELECT proof_denied($q$SELECT public._save_client_agreement(NULL,NULL,NULL,NULL,NULL,'one_time','negotiated')$q$,'42501');
RESET ROLE;
SELECT 'PASS shared writer human readback, private ACL, stale edit, authority-first refusals';
