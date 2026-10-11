-- ANT-49: synthetic, rollback-only proof. Run on an isolated canonical schema, never production.
BEGIN;
CREATE FUNCTION pg_temp.check_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;
DO $$ BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO service_role', (SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema()));
END $$;
CREATE FUNCTION pg_temp.refused(statement text, expected_state text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
    IF actual_state <> expected_state THEN RAISE EXCEPTION 'FAIL: % (expected %, got %)', label, expected_state, actual_state; END IF;
    RAISE NOTICE 'PASS: %', label; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % (accepted)', label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.check_true(boolean,text),pg_temp.refused(text,text,text) TO service_role;

INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) VALUES
 ('af490000-0000-4000-8000-000000000001','test-ant49-a','Test agreement A','active','standalone','TAA',9949001,'{}'),
 ('af490000-0000-4000-8000-000000000002','test-ant49-b','Test agreement B','active','standalone','TAB',9949002,'{}');
INSERT INTO public.clients(id,tenant_id,first_name,last_name,account_number) VALUES
 ('af490000-0000-4000-8000-000000000011','af490000-0000-4000-8000-000000000001','Test','Client A','ANT49-A'),
 ('af490000-0000-4000-8000-000000000012','af490000-0000-4000-8000-000000000001','Test','Client A2','ANT49-A2'),
 ('af490000-0000-4000-8000-000000000021','af490000-0000-4000-8000-000000000002','Test','Client B','ANT49-B');
INSERT INTO public.tenant_products(id,tenant_id,name,status) VALUES
 ('af490000-0000-4000-8000-000000000031','af490000-0000-4000-8000-000000000001','Test offer A','active'),
 ('af490000-0000-4000-8000-000000000032','af490000-0000-4000-8000-000000000001','Test offer A2','active'),
 ('af490000-0000-4000-8000-000000000041','af490000-0000-4000-8000-000000000002','Test offer B','active');
INSERT INTO public.tenant_prices(id,tenant_id,product_id,unit_amount,currency) VALUES
 ('af490000-0000-4000-8000-000000000051','af490000-0000-4000-8000-000000000001','af490000-0000-4000-8000-000000000031',350000,'usd'),
 ('af490000-0000-4000-8000-000000000052','af490000-0000-4000-8000-000000000001','af490000-0000-4000-8000-000000000032',350000,'usd'),
 ('af490000-0000-4000-8000-000000000061','af490000-0000-4000-8000-000000000002','af490000-0000-4000-8000-000000000041',350000,'usd');
INSERT INTO public.tenant_agreement_versions(id,tenant_id,template_slug,source_mode,title,body_markdown) VALUES
 ('af490000-0000-4000-8000-000000000071','af490000-0000-4000-8000-000000000001','test-ant49','tenant_fork','Test template A','Synthetic terms'),
 ('af490000-0000-4000-8000-000000000081','af490000-0000-4000-8000-000000000002','test-ant49','tenant_fork','Test template B','Synthetic terms');

-- All writers, including privileged adapters, must meet the row relationship invariant.
-- This first valid INSERT reproduces the pre-fix missing-commercial_terms_id failure.
SET LOCAL ROLE service_role;
INSERT INTO public.tenant_client_agreements(id,tenant_id,contact_id,offer_id,term_kind,price_basis,agreed_amount_minor,agreed_currency,catalog_price_id) VALUES
 ('af490000-0000-4000-8000-000000000091','af490000-0000-4000-8000-000000000001','af490000-0000-4000-8000-000000000011','af490000-0000-4000-8000-000000000031','one_time','negotiated',350000,'usd','af490000-0000-4000-8000-000000000051'),
 ('af490000-0000-4000-8000-000000000092','af490000-0000-4000-8000-000000000001','af490000-0000-4000-8000-000000000012','af490000-0000-4000-8000-000000000031','one_time','negotiated',350000,'usd',null),
 ('af490000-0000-4000-8000-000000000093','af490000-0000-4000-8000-000000000002','af490000-0000-4000-8000-000000000021','af490000-0000-4000-8000-000000000041','one_time','negotiated',350000,'usd',null);
SELECT pg_temp.check_true((SELECT count(*)=3 FROM public.tenant_client_agreements WHERE id IN ('af490000-0000-4000-8000-000000000091','af490000-0000-4000-8000-000000000092','af490000-0000-4000-8000-000000000093')), 'legitimate commercial inserts for both tenants and optional price');
INSERT INTO public.paige_agreements(id,tenant_id,contact_id,offer_id,commercial_terms_id,title,body_source,source_version_id,body_markdown) VALUES
 ('af490000-0000-4000-8000-000000000101','af490000-0000-4000-8000-000000000001','af490000-0000-4000-8000-000000000011','af490000-0000-4000-8000-000000000031','af490000-0000-4000-8000-000000000091','Test signing A','tenant_template','af490000-0000-4000-8000-000000000071','Synthetic body'),
 ('af490000-0000-4000-8000-000000000102','af490000-0000-4000-8000-000000000002','af490000-0000-4000-8000-000000000021',null,null,'Test signing B','paige_draft',null,'Synthetic body');
SELECT pg_temp.check_true((SELECT count(*)=2 FROM public.paige_agreements WHERE id IN ('af490000-0000-4000-8000-000000000101','af490000-0000-4000-8000-000000000102')), 'legitimate signing inserts for both tenants and optional links');

DO $proof$
DECLARE change record; commercial_insert text; signing_insert text;
BEGIN
  FOR change IN SELECT * FROM (VALUES
    ('tenant_id','af490000-0000-4000-8000-000000000002','foreign tenant reassignment'),
    ('contact_id','af490000-0000-4000-8000-000000000021','foreign client'),
    ('offer_id','af490000-0000-4000-8000-000000000041','foreign offer'),
    ('catalog_price_id','af490000-0000-4000-8000-000000000061','foreign price'),
    ('catalog_price_id','af490000-0000-4000-8000-000000000052','same-tenant wrong-offer price')
  ) AS cases(column_name,foreign_id,label) LOOP
    commercial_insert := format('INSERT INTO public.tenant_client_agreements(tenant_id,contact_id,offer_id,term_kind,price_basis,agreed_amount_minor,agreed_currency,catalog_price_id) SELECT tenant_id,contact_id,offer_id,term_kind,price_basis,agreed_amount_minor,agreed_currency,catalog_price_id FROM jsonb_populate_record(NULL::public.tenant_client_agreements,(SELECT to_jsonb(a) FROM public.tenant_client_agreements a WHERE id=%L)||jsonb_build_object(%L,%L))', 'af490000-0000-4000-8000-000000000091',change.column_name,change.foreign_id);
    PERFORM pg_temp.refused(commercial_insert,'42501','commercial insert: '||change.label);
    PERFORM pg_temp.refused(format('UPDATE public.tenant_client_agreements SET %I=%L WHERE id=%L',change.column_name,change.foreign_id,'af490000-0000-4000-8000-000000000091'),'42501','commercial update: '||change.label);
  END LOOP;
  FOR change IN SELECT * FROM (VALUES
    ('tenant_id','af490000-0000-4000-8000-000000000002','foreign tenant reassignment'),
    ('contact_id','af490000-0000-4000-8000-000000000021','foreign client'),
    ('offer_id','af490000-0000-4000-8000-000000000041','foreign offer'),
    ('commercial_terms_id','af490000-0000-4000-8000-000000000093','foreign commercial terms'),
    ('commercial_terms_id','af490000-0000-4000-8000-000000000092','same-tenant wrong-client terms'),
    ('source_version_id','af490000-0000-4000-8000-000000000081','foreign template version')
  ) AS cases(column_name,foreign_id,label) LOOP
    signing_insert := format('INSERT INTO public.paige_agreements(tenant_id,contact_id,offer_id,commercial_terms_id,title,body_source,source_version_id,body_markdown) SELECT tenant_id,contact_id,offer_id,commercial_terms_id,title,body_source,source_version_id,body_markdown FROM jsonb_populate_record(NULL::public.paige_agreements,(SELECT to_jsonb(a) FROM public.paige_agreements a WHERE id=%L)||jsonb_build_object(%L,%L))','af490000-0000-4000-8000-000000000101',change.column_name,change.foreign_id);
    PERFORM pg_temp.refused(signing_insert,'42501','signing insert: '||change.label);
    PERFORM pg_temp.refused(format('UPDATE public.paige_agreements SET %I=%L WHERE id=%L',change.column_name,change.foreign_id,'af490000-0000-4000-8000-000000000101'),'42501','signing update: '||change.label);
  END LOOP;
END $proof$;
UPDATE public.tenant_client_agreements SET notes='Synthetic amendment' WHERE id='af490000-0000-4000-8000-000000000091';
UPDATE public.paige_agreements SET title='Synthetic draft amendment' WHERE id='af490000-0000-4000-8000-000000000101';
SELECT pg_temp.check_true((SELECT notes='Synthetic amendment' FROM public.tenant_client_agreements WHERE id='af490000-0000-4000-8000-000000000091'),'legitimate commercial update');
SELECT pg_temp.check_true((SELECT title='Synthetic draft amendment' FROM public.paige_agreements WHERE id='af490000-0000-4000-8000-000000000101'),'legitimate signing draft update');
UPDATE public.tenant_client_agreements SET catalog_price_snapshot_minor=350000,catalog_price_snapshot_currency='usd',catalog_price_snapshot_at=now() WHERE id='af490000-0000-4000-8000-000000000091';
SELECT pg_temp.refused($s$UPDATE public.tenant_client_agreements SET catalog_price_snapshot_minor=1 WHERE id='af490000-0000-4000-8000-000000000091'$s$,'23514','catalog snapshot remains immutable');
UPDATE public.paige_agreements SET status='sent',content_sha256=repeat('a',64) WHERE id='af490000-0000-4000-8000-000000000101';
SELECT pg_temp.refused($s$UPDATE public.paige_agreements SET body_markdown='changed' WHERE id='af490000-0000-4000-8000-000000000101'$s$,'23514','sent body remains immutable');
SELECT pg_temp.refused($s$UPDATE public.paige_agreements SET source_version_id=null WHERE id='af490000-0000-4000-8000-000000000101'$s$,'23514','sent template version remains immutable');
SELECT pg_temp.refused($s$UPDATE public.paige_agreements SET content_sha256=repeat('b',64) WHERE id='af490000-0000-4000-8000-000000000101'$s$,'23514','presented digest remains immutable');
UPDATE public.paige_agreements SET status='completed',sealed_sha256=repeat('c',64),sealed_storage_key='test/sealed' WHERE id='af490000-0000-4000-8000-000000000101';
SELECT pg_temp.refused($s$UPDATE public.paige_agreements SET sealed_sha256=repeat('d',64) WHERE id='af490000-0000-4000-8000-000000000101'$s$,'23514','completed seal remains immutable');
SELECT pg_temp.refused($s$UPDATE public.paige_agreements SET sealed_storage_key='changed' WHERE id='af490000-0000-4000-8000-000000000101'$s$,'23514','completed storage reference remains immutable');
SELECT pg_temp.refused($s$UPDATE public.paige_agreements SET status='draft' WHERE id='af490000-0000-4000-8000-000000000101'$s$,'23514','completed status cannot reopen');
SELECT pg_temp.check_true((SELECT count(DISTINCT tgfoid)=2 FROM pg_trigger WHERE tgname='trg_agreement_tenant_links' AND tgrelid IN ('public.tenant_client_agreements'::regclass,'public.paige_agreements'::regclass) AND tgenabled='O'),'enabled table-specific validators have distinct identities');
SELECT pg_temp.check_true(NOT has_function_privilege('anon','public.enforce_commercial_agreement_tenant_links()','EXECUTE') AND NOT has_function_privilege('authenticated','public.enforce_commercial_agreement_tenant_links()','EXECUTE'),'commercial trigger helper is not a callable API');
SELECT pg_temp.check_true(NOT has_function_privilege('anon','public.enforce_signing_agreement_tenant_links()','EXECUTE') AND NOT has_function_privilege('authenticated','public.enforce_signing_agreement_tenant_links()','EXECUTE'),'signing trigger helper is not a callable API');
RESET ROLE;
ROLLBACK;
