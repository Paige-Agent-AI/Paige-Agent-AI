-- E09 Slice A: customer portal Agreements on the ONE Sales Agreements engine. Full replayed schema,
-- actual caller roles, synthetic data only (§63); no network, no email; all rolled back.
-- Proves: a customer lists only their own sent agreements in their one business; the state each
-- one reads as; opening to sign mints a link the frozen /sign/:token flow accepts while writing
-- NOTHING to paige_agreements and NO agreement event; the emailed link stops working (D-A4, stated
-- honestly); every refusal; the download scope; sub-account parity; and no RLS policy changed.
BEGIN;
SELECT plan(113);

-- ── Seed ────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES
 ('0a090000-0000-4000-8000-000000000001','authenticated','authenticated','agr-owner-a@tests.invalid',now()),
 ('0a090000-0000-4000-8000-000000000002','authenticated','authenticated','agr-customer-a@tests.invalid',now()),
 ('0a090000-0000-4000-8000-000000000003','authenticated','authenticated','agr-customer-b@tests.invalid',now()),
 ('0a090000-0000-4000-8000-000000000004','authenticated','authenticated','agr-customer-tb@tests.invalid',now()),
 ('0a090000-0000-4000-8000-000000000005','authenticated','authenticated','agr-staff-a@tests.invalid',now()),
 ('0a090000-0000-4000-8000-000000000006','authenticated','authenticated','agr-customer-two@tests.invalid',now()),
 ('0a090000-0000-4000-8000-000000000007','authenticated','authenticated','agr-customer-sub@tests.invalid',now());
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('a0900000-0000-4000-8000-000000000001','test-tenant-e09-agreements-a','Test tenant agreements A','active','standalone',NULL,'E09GA',9491001,'{}'),
 ('a0900000-0000-4000-8000-000000000002','test-tenant-e09-agreements-b','Test tenant agreements B','active','standalone',NULL,'E09GB',9491002,'{}'),
 ('a0900000-0000-4000-8000-000000000003','test-tenant-e09-agreements-agency','Test agency agreements','active','agency',NULL,'E09GP',9491003,'{}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('a0900000-0000-4000-8000-000000000004','test-tenant-e09-agreements-sub','Test sub-account agreements','active','sub_account','a0900000-0000-4000-8000-000000000003','E09GS',9491004,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('a0900000-0000-4000-8000-000000000001','0a090000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('a0900000-0000-4000-8000-000000000001','0a090000-0000-4000-8000-000000000005','member','active',false,now());
UPDATE public.profiles SET active_tenant_id='a0900000-0000-4000-8000-000000000001'
 WHERE user_id IN('0a090000-0000-4000-8000-000000000001','0a090000-0000-4000-8000-000000000005');
-- Clients carry no email, so no counterparty is auto-seeded: every signer below is explicit.
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('c0900000-0000-4000-8000-000000000001','a0900000-0000-4000-8000-000000000001','0a090000-0000-4000-8000-000000000002','0a090000-0000-4000-8000-000000000001','Agreement','CustomerA','active'),
 ('c0900000-0000-4000-8000-000000000002','a0900000-0000-4000-8000-000000000001','0a090000-0000-4000-8000-000000000003','0a090000-0000-4000-8000-000000000001','Agreement','CustomerB','active'),
 ('c0900000-0000-4000-8000-000000000003','a0900000-0000-4000-8000-000000000002','0a090000-0000-4000-8000-000000000004','0a090000-0000-4000-8000-000000000001','Agreement','ForeignTenant','active'),
 ('c0900000-0000-4000-8000-000000000005','a0900000-0000-4000-8000-000000000001','0a090000-0000-4000-8000-000000000006','0a090000-0000-4000-8000-000000000001','Two','InA','active'),
 ('c0900000-0000-4000-8000-000000000007','a0900000-0000-4000-8000-000000000004','0a090000-0000-4000-8000-000000000007','0a090000-0000-4000-8000-000000000001','Agreement','SubCustomer','active');
-- A login linked in two businesses is not possible today (one global partial unique link index); the
-- future multi-business shape is staged here, inside this rolled-back transaction, the same way
-- client_portal_self_projection.sql does, to prove the ambiguity refuses rather than picks.
DROP INDEX public.clients_linked_user_id_unique;
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('c0900000-0000-4000-8000-000000000006','a0900000-0000-4000-8000-000000000002','0a090000-0000-4000-8000-000000000006','0a090000-0000-4000-8000-000000000001','Two','InB','active');
-- An older duplicate of customer A, merged into A: its agreement is not A's to see.
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('c0900000-0000-4000-8000-000000000004','a0900000-0000-4000-8000-000000000001',NULL,'0a090000-0000-4000-8000-000000000001','Merged','Duplicate','active');
-- The governed merge-lineage convention (client_portal_self_projection.sql) as a trusted fixture:
-- service-role claims, no subject, the lineage switch on. The fixture writer stays the test owner.
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('app.crm_merge_lineage_write','on',true);
UPDATE public.clients SET merged_into_contact_id='c0900000-0000-4000-8000-000000000001',merged_at=now() WHERE id='c0900000-0000-4000-8000-000000000004';
SELECT set_config('app.crm_merge_lineage_write','off',true);
SELECT set_config('request.jwt.claims','{}',true);

INSERT INTO public.tenant_products(id,tenant_id,name) VALUES
 ('d0900000-0000-4000-8000-000000000001','a0900000-0000-4000-8000-000000000001','Synthetic website build');
INSERT INTO public.tenant_client_agreements(id,tenant_id,contact_id,offer_id,title,term_kind,price_basis,agreed_amount_minor,agreed_currency) VALUES
 ('7ca90000-0000-4000-8000-000000000001','a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','d0900000-0000-4000-8000-000000000001','Website build engagement','one_time','negotiated',150000,'usd'),
 ('7ca90000-0000-4000-8000-000000000002','a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','d0900000-0000-4000-8000-000000000001','Engagement later moved','one_time','negotiated',90000,'usd');

-- Agreements: aNN. sent_at is now() - NN days so the "everything else" order is deterministic.
CREATE FUNCTION pg_temp.ag(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
 $$ SELECT ('a6090000-0000-4000-8000-0000000000' || lpad(_n::text,2,'0'))::uuid $$;
CREATE FUNCTION pg_temp.sg(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
 $$ SELECT ('5e090000-0000-4000-8000-0000000000' || lpad(_n::text,2,'0'))::uuid $$;
CREATE FUNCTION pg_temp.mk(_n int, _tenant uuid, _contact uuid, _status text, _expires interval, _terms uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.paige_agreements(id,tenant_id,contact_id,commercial_terms_id,title,body_markdown,status,content_sha256,
   sealed_sha256,sealed_storage_key,sent_at,completed_at,expires_at,created_by)
 VALUES (pg_temp.ag(_n), _tenant, _contact, _terms, 'Synthetic agreement ' || _n, 'Synthetic body ' || _n, _status,
   CASE WHEN _status IN ('draft','voided') THEN NULL ELSE repeat('c',64) END,
   CASE WHEN _status = 'completed' THEN repeat('d',64) END,
   CASE WHEN _status = 'completed' THEN 'tenant/sealed-' || _n || '.pdf' END,
   CASE WHEN _status <> 'draft' THEN now() - make_interval(days => _n) END,
   CASE WHEN _status = 'completed' THEN now() - interval '1 day' END,
   CASE WHEN _expires IS NULL THEN NULL ELSE now() + _expires END,
   '0a090000-0000-4000-8000-000000000001')
$$;
CREATE FUNCTION pg_temp.sgn(_n int, _agreement int, _role text, _order int, _status text, _tenant uuid)
RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.paige_agreement_signers(id,agreement_id,tenant_id,full_name,email,signer_role,signing_order,status,
   esign_consent_at,esign_consent_slug,esign_consent_version,esign_consent_sha256,typed_name,signed_at)
 VALUES (pg_temp.sg(_n), pg_temp.ag(_agreement), _tenant, 'Synthetic signer ' || _n, 'signer-' || _n || '@tests.invalid',
   _role, _order, _status,
   CASE WHEN _status = 'signed' THEN now() - interval '2 hours' END, CASE WHEN _status = 'signed' THEN 'esign-consent' END,
   CASE WHEN _status = 'signed' THEN 1 END, CASE WHEN _status = 'signed' THEN repeat('e',64) END,
   CASE WHEN _status = 'signed' THEN 'Synthetic signer ' || _n END, CASE WHEN _status = 'signed' THEN now() - interval '1 hour' END)
$$;

SELECT pg_temp.mk(1,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','draft',NULL);
SELECT pg_temp.mk(2,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','sent',interval '10 days','7ca90000-0000-4000-8000-000000000001');
SELECT pg_temp.mk(3,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','viewed',NULL);
SELECT pg_temp.mk(4,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','completed',NULL);
SELECT pg_temp.mk(5,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','declined',NULL);
SELECT pg_temp.mk(6,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','voided',NULL);
SELECT pg_temp.mk(7,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','expired',NULL);
SELECT pg_temp.mk(8,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','sent',interval '-1 hour');
SELECT pg_temp.mk(9,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','sent',interval '30 days');
SELECT pg_temp.mk(10,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','partially_signed',interval '30 days');
SELECT pg_temp.mk(11,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','sent',interval '5 days');
SELECT pg_temp.mk(12,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','sent',interval '20 days');
INSERT INTO public.paige_agreements(id,tenant_id,contact_id,title,body_source,document_path,status,content_sha256,content_storage_key,sent_at,created_by)
VALUES (pg_temp.ag(13),'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','Synthetic agreement 13','tenant_upload',
 'tenant/upload-13.pdf','sent',repeat('c',64),'tenant/presented-13.pdf',now() - interval '13 days','0a090000-0000-4000-8000-000000000001');
SELECT pg_temp.mk(14,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','sent',interval '15 days','7ca90000-0000-4000-8000-000000000002');
SELECT pg_temp.mk(15,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000004','sent',interval '10 days');
SELECT pg_temp.mk(16,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000002','sent',interval '10 days');
SELECT pg_temp.mk(17,'a0900000-0000-4000-8000-000000000002','c0900000-0000-4000-8000-000000000003','sent',interval '10 days');
SELECT pg_temp.mk(18,'a0900000-0000-4000-8000-000000000004','c0900000-0000-4000-8000-000000000007','sent',interval '10 days');
SELECT pg_temp.mk(19,'a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000002','completed',NULL);

SELECT pg_temp.sgn(2,2,'counterparty',1,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(3,3,'counterparty',1,'viewed','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(4,4,'counterparty',1,'signed','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(5,5,'counterparty',1,'declined','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(6,6,'counterparty',1,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(7,7,'counterparty',1,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(8,8,'counterparty',1,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(30,9,'tenant_signatory',1,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(9,9,'counterparty',2,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(10,10,'counterparty',1,'signed','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(31,10,'witness',2,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(11,11,'counterparty',1,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(32,11,'counterparty',1,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(33,12,'tenant_signatory',1,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(13,13,'counterparty',1,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(14,14,'counterparty',1,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(15,15,'counterparty',1,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(16,16,'counterparty',1,'pending','a0900000-0000-4000-8000-000000000001');
SELECT pg_temp.sgn(17,17,'counterparty',1,'pending','a0900000-0000-4000-8000-000000000002');
SELECT pg_temp.sgn(18,18,'counterparty',1,'pending','a0900000-0000-4000-8000-000000000004');
SELECT pg_temp.sgn(19,19,'counterparty',1,'signed','a0900000-0000-4000-8000-000000000001');
-- The emailed link for agreement 2: a known plaintext whose digest is the signer's token, carrying
-- the agreement's own deadline (what issue_agreement_signing_link or agreement-send leaves behind).
UPDATE public.paige_agreement_signers SET token_hash = encode(digest(repeat('ab',32),'sha256'),'hex'),
  token_expires_at = (SELECT expires_at FROM public.paige_agreements WHERE id = pg_temp.ag(2))
 WHERE id = pg_temp.sg(2);
-- Engagement 2 later moved to another customer: agreement 14 must not show its name.
UPDATE public.tenant_client_agreements SET contact_id = 'c0900000-0000-4000-8000-000000000002'
 WHERE id = '7ca90000-0000-4000-8000-000000000002';

CREATE FUNCTION pg_temp.as_user(_actor uuid, _sql text, _role text DEFAULT 'authenticated') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.list_a(_limit int DEFAULT 50) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('0a090000-0000-4000-8000-000000000002', format('SELECT public.client_portal_agreements(p_limit=>%s)', _limit)) $$;
CREATE FUNCTION pg_temp.row_a(_n int) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT r FROM jsonb_array_elements(pg_temp.list_a()->'agreements') r WHERE r->>'id' = pg_temp.ag(_n)::text $$;
CREATE FUNCTION pg_temp.open(_actor uuid, _n int, _tenant uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user(_actor, format('SELECT public.client_portal_open_agreement_signing(%L::uuid, %L::uuid)', pg_temp.ag(_n), _tenant)) $$;
CREATE FUNCTION pg_temp.scope(_actor uuid, _n int) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user(_actor, format('SELECT public.client_portal_agreement_document_scope(%L::uuid)', pg_temp.ag(_n))) $$;

-- ── 1. Grants ───────────────────────────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon','public.client_portal_agreements(uuid,integer)','EXECUTE'),'anon cannot list agreements');
SELECT ok(NOT has_function_privilege('anon','public.client_portal_open_agreement_signing(uuid,uuid)','EXECUTE'),'anon cannot open an agreement');
SELECT ok(NOT has_function_privilege('anon','public.client_portal_agreement_document_scope(uuid,uuid)','EXECUTE'),'anon cannot read a document scope');
SELECT ok(has_function_privilege('authenticated','public.client_portal_agreements(uuid,integer)','EXECUTE')
  AND has_function_privilege('service_role','public.client_portal_agreements(uuid,integer)','EXECUTE'),'authenticated and service_role may list');
SELECT ok(has_function_privilege('authenticated','public.client_portal_open_agreement_signing(uuid,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.client_portal_open_agreement_signing(uuid,uuid)','EXECUTE'),'authenticated and service_role may open');
SELECT ok(has_function_privilege('authenticated','public.client_portal_agreement_document_scope(uuid,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.client_portal_agreement_document_scope(uuid,uuid)','EXECUTE'),'authenticated and service_role may scope');
SELECT ok(NOT has_function_privilege('authenticated','public._client_portal_agreement_state(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public._client_portal_agreement_state(uuid)','EXECUTE'),'the internal state helper is callable by no client role');
SELECT is((SELECT count(*) FROM pg_proc WHERE proname IN ('client_portal_agreements','client_portal_open_agreement_signing','client_portal_agreement_document_scope') AND prosecdef AND provolatile='v'),3::bigint,'all three are SECURITY DEFINER and VOLATILE');
SELECT ok((SELECT bool_and(proconfig @> ARRAY['search_path=public, pg_temp']) FROM pg_proc WHERE proname IN ('client_portal_agreements','client_portal_open_agreement_signing','client_portal_agreement_document_scope','_client_portal_agreement_state')),'all four pin search_path');

-- ── 2. Customer A's list: exactly theirs, exact keys, nothing private ───────────────────────────
SELECT is((SELECT array_agg(right(r->>'id',2) ORDER BY o) FROM jsonb_array_elements(pg_temp.list_a()->'agreements') WITH ORDINALITY x(r,o)),
 ARRAY['11','02','14','12','03','13','04','05','06','07','08','09','10'],
 'customer A sees exactly their 13 sent agreements: waiting first by deadline, then newest');
SELECT ok(pg_temp.row_a(1) IS NULL,'their draft is not listed');
SELECT ok(pg_temp.row_a(15) IS NULL,'an agreement on a merged duplicate contact is not listed');
SELECT ok(pg_temp.row_a(16) IS NULL AND pg_temp.row_a(19) IS NULL,'another customer of the same business is not listed');
SELECT ok(pg_temp.row_a(17) IS NULL,'another business''s agreement is not listed');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.list_a()) k),
 ARRAY['agreements','business_name','has_more','server_now','summary','tenant_id'],'root carries exactly its six keys');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.row_a(2)) k),
 ARRAY['can_download','can_sign','completed_at','engagement_title','expires_at','id','sent_at','sign_note','state','title'],'each row carries exactly its ten keys');
SELECT is((SELECT count(DISTINCT x) FROM jsonb_array_elements(pg_temp.list_a()->'agreements') r, jsonb_object_keys(r) x),10::bigint,'no row carries any other key');
SELECT ok(pg_temp.list_a()::text !~* '(synthetic body|signer-[0-9]+@|sealed-|presented-|upload-13|cccccccc|dddddddd|150000|d0900000|0a090000-0000-4000-8000-000000000001|token|hash)',
 'no body, signer email, storage key, hash, amount, offer, creator or token data appears anywhere');
SELECT is(pg_temp.list_a()->>'tenant_id','a0900000-0000-4000-8000-000000000001','root names the one business');
SELECT is(pg_temp.list_a()->>'business_name','Test tenant agreements A','root carries the business name');
SELECT is(pg_temp.list_a()->'summary','{"awaiting_you":6,"signed":1}'::jsonb,'summary counts what waits for them and what is signed');
SELECT is(pg_temp.list_a()->>'has_more','false','all rows fit the default page');
SELECT is((SELECT jsonb_array_length(pg_temp.list_a(2)->'agreements')),2,'p_limit pages');
SELECT is(pg_temp.list_a(2)->>'has_more','true','has_more is true when rows remain');
SELECT is((SELECT jsonb_array_length(pg_temp.list_a(0)->'agreements')),1,'p_limit clamps up to 1');
SELECT is((SELECT jsonb_array_length(pg_temp.list_a(500)->'agreements')),13,'p_limit clamps down to 50');

-- ── 3. State mapping ────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.row_a(2)->>'state','awaiting_you','sent, my signer pending: waiting for you');
SELECT is(pg_temp.row_a(3)->>'state','awaiting_you','viewed, my signer viewed: waiting for you');
SELECT is(pg_temp.row_a(4)->>'state','signed','completed: signed');
SELECT is(pg_temp.row_a(5)->>'state','declined','declined: declined');
SELECT is(pg_temp.row_a(6)->>'state','withdrawn','voided: withdrawn');
SELECT is(pg_temp.row_a(7)->>'state','expired','expired status: expired');
SELECT is(pg_temp.row_a(8)->>'state','expired','sent but past its deadline: expired');
SELECT is(pg_temp.row_a(9)->>'state','awaiting_business','an earlier-order business signer has not signed: waiting for the business');
SELECT is(pg_temp.row_a(10)->>'state','awaiting_others','my signer signed, the agreement is not complete: waiting for others');
SELECT is(pg_temp.row_a(11)->>'state'||'|'||(pg_temp.row_a(11)->>'can_sign')||'|'||(pg_temp.row_a(11)->>'sign_note'),'awaiting_you|false|use_email_link','two counterparties: listed, signable only from the email');
SELECT is(pg_temp.row_a(12)->>'state'||'|'||(pg_temp.row_a(12)->>'can_sign')||'|'||(pg_temp.row_a(12)->>'sign_note'),'awaiting_you|false|use_email_link','no counterparty: listed, signable only from the email');
SELECT is(pg_temp.row_a(13)->>'state'||'|'||(pg_temp.row_a(13)->>'can_sign')||'|'||(pg_temp.row_a(13)->>'sign_note'),'awaiting_you|false|use_email_link','an upload whose frozen copy is not provably the upload: email only');
SELECT is(pg_temp.row_a(2)->>'can_sign'||'|'||coalesce(pg_temp.row_a(2)->>'sign_note','null'),'true|null','the one signable row can be signed here');
SELECT is((SELECT count(*) FROM jsonb_array_elements(pg_temp.list_a()->'agreements') r WHERE (r->>'can_sign')::boolean),3::bigint,'can_sign is true only for 2, 3 and 14');
SELECT is((SELECT array_agg(right(r->>'id',2) ORDER BY r->>'id') FROM jsonb_array_elements(pg_temp.list_a()->'agreements') r WHERE (r->>'can_download')::boolean),ARRAY['04'],'only the completed, sealed agreement can be downloaded');
SELECT is(pg_temp.row_a(2)->>'engagement_title','Website build engagement','the linked Sales agreement''s name is shown');
SELECT ok(pg_temp.row_a(14)->'engagement_title' = 'null'::jsonb,'an engagement now belonging to another customer is not named');
SELECT ok(pg_temp.row_a(3)->'engagement_title' = 'null'::jsonb,'no linked engagement, no name');
SELECT is(pg_temp.row_a(4)->>'completed_at' IS NOT NULL AND pg_temp.row_a(2)->>'expires_at' IS NOT NULL,true,'dates are carried');

-- ── 4. Who gets nothing ─────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_agreements()$q$)->>'sqlstate','42501','signed out (no subject) is refused');
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_agreements()$q$,'anon')->>'sqlstate','42501','anonymous is refused');
SELECT ok(pg_temp.as_user('0a090000-0000-4000-8000-000000000005',$q$SELECT public.client_portal_agreements()$q$) IS NULL,'staff with no relationship get NULL');
SELECT ok(pg_temp.as_user('0a090000-0000-4000-8000-000000000001',$q$SELECT public.client_portal_agreements()$q$) IS NULL,'the business owner is not their own customer');
SELECT ok(pg_temp.as_user('0a090000-0000-4000-8000-000000000002',$q$SELECT public.client_portal_agreements('a0900000-0000-4000-8000-000000000002')$q$) IS NULL,'a foreign business argument grants nothing');
SELECT is(pg_temp.as_user('0a090000-0000-4000-8000-000000000006',$q$SELECT public.client_portal_agreements()$q$),
 '{"sqlstate":"42501","error":"select an authorized customer relationship"}'::jsonb,'two relationships: refused with the exact message');
SELECT is(pg_temp.as_user('0a090000-0000-4000-8000-000000000006',$q$SELECT public.client_portal_agreements('a0900000-0000-4000-8000-000000000001')$q$)->'agreements','[]'::jsonb,'naming one of their two businesses narrows to it');
SELECT is(pg_temp.as_user('0a090000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_agreements()$q$)->'summary','{"awaiting_you":1,"signed":1}'::jsonb,'customer B sees only their own');
SELECT is(pg_temp.as_user('0a090000-0000-4000-8000-000000000002',$q$SELECT count(*)::text::jsonb FROM public.paige_agreements$q$)::text,'0','the raw table still shows a customer nothing');

-- ── 5. Open, happy path ─────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE before_open AS
 SELECT (SELECT to_jsonb(a) FROM public.paige_agreements a WHERE a.id = pg_temp.ag(2)) AS agreement,
        (SELECT count(*) FROM public.paige_agreement_events) AS events,
        (SELECT count(*) FROM public.paige_audit_log WHERE action = 'agreement.portal_link_issued') AS audits;
CREATE TEMP TABLE opened AS SELECT pg_temp.open('0a090000-0000-4000-8000-000000000002',2) AS r;
SELECT is((SELECT r->>'ok' FROM opened),'true','the customer opens their own waiting agreement');
SELECT is((SELECT array_agg(k ORDER BY k) FROM opened, jsonb_object_keys(r) k),ARRAY['expires_at','ok','token'],'the answer carries exactly ok, token, expires_at');
SELECT ok((SELECT r->>'token' ~ '^[0-9a-f]{64}$' FROM opened),'the token is 64 hex characters');
SELECT is((SELECT token_hash FROM public.paige_agreement_signers WHERE id = pg_temp.sg(2)),
 (SELECT encode(digest(r->>'token','sha256'),'hex') FROM opened),'only its sha256 is stored, on the customer''s own signer row');
SELECT is((SELECT token_expires_at FROM public.paige_agreement_signers WHERE id = pg_temp.sg(2)),
 (SELECT expires_at FROM public.paige_agreements WHERE id = pg_temp.ag(2)),'the new link keeps the agreement''s deadline');
SELECT is((SELECT (r->>'expires_at')::timestamptz FROM opened),(SELECT expires_at FROM public.paige_agreements WHERE id = pg_temp.ag(2)),'and says so');
SELECT ok((SELECT token_revoked_at IS NULL FROM public.paige_agreement_signers WHERE id = pg_temp.sg(2)),'the new link is not revoked');
SELECT is((SELECT to_jsonb(a) FROM public.paige_agreements a WHERE a.id = pg_temp.ag(2)),(SELECT agreement FROM before_open),'the agreement row is byte-identical: no freeze, no status, no deadline change');
SELECT is((SELECT count(*) FROM public.paige_agreement_events),(SELECT events FROM before_open),'no agreement event is written');
SELECT is((SELECT count(*) FROM public.paige_audit_log WHERE action = 'agreement.portal_link_issued'),(SELECT audits + 1 FROM before_open),'exactly one audit row');
SELECT is((SELECT jsonb_build_object('actor',actor_user_id,'role',actor_role,'type',target_type,'target',target_id,'tenant',tenant_id,'payload',payload)
  FROM public.paige_audit_log WHERE action = 'agreement.portal_link_issued' AND target_id = pg_temp.ag(2)),
 jsonb_build_object('actor','0a090000-0000-4000-8000-000000000002','role','client','type','paige_agreement','target',pg_temp.ag(2),
  'tenant','a0900000-0000-4000-8000-000000000001','payload',jsonb_build_object('signer_id',pg_temp.sg(2))),'the audit row names the customer, the agreement, the business and the signer');
SELECT is((SELECT status FROM public.paige_agreement_signers WHERE id = pg_temp.sg(2)),'pending','opening is not viewing: the signer is untouched until the page loads');
-- The lookup every token door makes (peek, sign-agreement, decline, agreement-document door 1):
-- the hash, not revoked, not expired, a signer still to sign, an agreement still open in time.
SELECT is((SELECT count(*) FROM public.paige_agreement_signers s JOIN public.paige_agreements a ON a.id = s.agreement_id
  WHERE s.token_hash = (SELECT encode(digest(r->>'token','sha256'),'hex') FROM opened)
    AND s.token_revoked_at IS NULL AND s.token_expires_at > now() AND s.status IN ('pending','viewed')
    AND a.status IN ('sent','viewed','partially_signed') AND (a.expires_at IS NULL OR a.expires_at > now())
    AND a.id = pg_temp.ag(2)),1::bigint,'the portal token passes the token doors'' own lookup, for that agreement only');
-- KNOWN DEFECT, reported and NOT fixed here (the frozen signing contract): on this replayed schema
-- pgcrypto lives in `extensions`, and peek_agreement_signing pins search_path = public, pg_temp, so
-- it cannot hash ANY token ("function digest(text, unknown) does not exist"). To still drive the
-- frozen function's real body against the portal token, its search_path is widened inside this
-- rolled-back transaction only. The body is not changed.
ALTER FUNCTION public.peek_agreement_signing(text) SET search_path = public, extensions, pg_temp;
SELECT is((SELECT is_valid FROM public.peek_agreement_signing((SELECT r->>'token' FROM opened))),true,'the frozen signing flow accepts the portal link');
SELECT is((SELECT document_title FROM public.peek_agreement_signing((SELECT r->>'token' FROM opened))),'Synthetic agreement 2','for that agreement');

-- ── 7. The emailed link stops working (D-A4, stated honestly) ───────────────────────────────────
SELECT is((SELECT is_valid FROM public.peek_agreement_signing(repeat('ab',32))),false,'after a portal open the emailed link no longer opens the agreement');
SELECT is((SELECT count(*) FROM public.paige_agreement_signers WHERE token_hash = encode(digest(repeat('ab',32),'sha256'),'hex')),0::bigint,'its digest is gone');

-- ── 6. Open refusals ────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE before_refusals AS SELECT
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.paige_agreement_signers s WHERE s.agreement_id <> pg_temp.ag(3)) AS signers,
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.paige_agreements a) AS agreements;
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',1),'{"ok":false,"error":"CLIENT_AGREEMENT_UNAVAILABLE"}'::jsonb,'their own draft: unavailable, as if it did not exist');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',4),'{"ok":false,"error":"NOT_SIGNABLE","state":"signed"}'::jsonb,'completed: not signable');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',5),'{"ok":false,"error":"NOT_SIGNABLE","state":"declined"}'::jsonb,'declined: not signable');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',6),'{"ok":false,"error":"NOT_SIGNABLE","state":"withdrawn"}'::jsonb,'voided: not signable');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',7),'{"ok":false,"error":"NOT_SIGNABLE","state":"expired"}'::jsonb,'expired: not signable');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',8),'{"ok":false,"error":"NOT_SIGNABLE","state":"expired"}'::jsonb,'past its deadline: not signable');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',9),'{"ok":false,"error":"NOT_SIGNABLE","state":"awaiting_business"}'::jsonb,'not their turn: not signable');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',10),'{"ok":false,"error":"NOT_SIGNABLE","state":"awaiting_others"}'::jsonb,'their signer already signed: not signable');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',11),'{"ok":false,"error":"NOT_SIGNABLE_HERE"}'::jsonb,'two counterparties: use the emailed link');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',12),'{"ok":false,"error":"NOT_SIGNABLE_HERE"}'::jsonb,'no counterparty: use the emailed link');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',13),'{"ok":false,"error":"NOT_SIGNABLE_HERE"}'::jsonb,'unprovable uploaded document: use the emailed link');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',15),'{"ok":false,"error":"CLIENT_AGREEMENT_UNAVAILABLE"}'::jsonb,'a merged duplicate''s agreement: unavailable');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',16),'{"ok":false,"error":"CLIENT_AGREEMENT_UNAVAILABLE"}'::jsonb,'another customer''s agreement: the same unavailable');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',17),'{"ok":false,"error":"CLIENT_AGREEMENT_UNAVAILABLE"}'::jsonb,'another business''s agreement: the same unavailable');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',17,'a0900000-0000-4000-8000-000000000002'),'{"ok":false,"error":"CLIENT_AGREEMENT_UNAVAILABLE"}'::jsonb,'naming that business does not help');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',99),'{"ok":false,"error":"CLIENT_AGREEMENT_UNAVAILABLE"}'::jsonb,'a random id: the same unavailable');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000005',2),'{"ok":false,"error":"CLIENT_AGREEMENT_UNAVAILABLE"}'::jsonb,'staff cannot mint a customer link');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000001',2),'{"ok":false,"error":"CLIENT_AGREEMENT_UNAVAILABLE"}'::jsonb,'nor can the owner, from the customer door');
SELECT is(pg_temp.as_user(NULL,format('SELECT public.client_portal_open_agreement_signing(%L)',pg_temp.ag(2)),'anon')->>'sqlstate','42501','anonymous is refused');
SELECT is(pg_temp.as_user(NULL,format('SELECT public.client_portal_open_agreement_signing(%L)',pg_temp.ag(2)))->>'sqlstate','42501','no subject is refused');
SELECT is((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.paige_agreement_signers s WHERE s.agreement_id <> pg_temp.ag(3)),(SELECT signers FROM before_refusals),'no refusal touched any signer row');
SELECT is((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.paige_agreements a),(SELECT agreements FROM before_refusals),'no refusal touched any agreement');
-- Ten opens an hour, then a pause.
SELECT is((SELECT count(*) FROM generate_series(1,10) g WHERE pg_temp.open('0a090000-0000-4000-8000-000000000002',3)->>'ok' = 'true'),10::bigint,'ten opens of one agreement in an hour succeed');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000002',3),'{"ok":false,"error":"TRY_AGAIN_LATER"}'::jsonb,'the eleventh is asked to wait');
SELECT is((SELECT count(*) FROM public.paige_audit_log WHERE action = 'agreement.portal_link_issued' AND target_id = pg_temp.ag(3)),10::bigint,'the refused eleventh wrote no audit row');
SELECT ok(pg_temp.open('0a090000-0000-4000-8000-000000000002',14)->>'ok' = 'true','the limit is per agreement, not per customer');
-- Why the open's own "content frozen" check is defensive: a sent agreement without a hash cannot exist.
SELECT throws_ok($q$INSERT INTO public.paige_agreements(tenant_id,contact_id,title,body_markdown,status) VALUES
 ('a0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','Unfrozen','Body','sent')$q$,'23514',NULL,'a sent agreement must carry its content hash, so an unfrozen one never reaches the open');

-- ── 8. Download scope ───────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.scope('0a090000-0000-4000-8000-000000000002',4),
 jsonb_build_object('agreement_id',pg_temp.ag(4),'tenant_id','a0900000-0000-4000-8000-000000000001','title','Synthetic agreement 4'),
 'their completed, sealed agreement: exactly id, business and title — no storage key');
SELECT is(pg_temp.scope('0a090000-0000-4000-8000-000000000002',2),'{"sqlstate":"42501","error":"CLIENT_AGREEMENT_UNAVAILABLE"}'::jsonb,'not completed: refused');
SELECT is(pg_temp.scope('0a090000-0000-4000-8000-000000000002',6)->>'sqlstate','42501','voided: refused');
SELECT is(pg_temp.scope('0a090000-0000-4000-8000-000000000002',19)->>'sqlstate','42501','another customer''s completed agreement: refused');
SELECT is(pg_temp.scope('0a090000-0000-4000-8000-000000000003',4)->>'sqlstate','42501','and the reverse');
SELECT is(pg_temp.scope('0a090000-0000-4000-8000-000000000004',4)->>'sqlstate','42501','another business''s customer: refused');
SELECT is(pg_temp.scope('0a090000-0000-4000-8000-000000000005',4)->>'sqlstate','42501','staff: refused at the customer door');
SELECT is(pg_temp.scope('0a090000-0000-4000-8000-000000000002',99)->>'sqlstate','42501','a random id: refused');
SELECT is(pg_temp.as_user(NULL,format('SELECT public.client_portal_agreement_document_scope(%L)',pg_temp.ag(4)),'anon')->>'sqlstate','42501','anonymous: refused');
SELECT throws_ok($q$UPDATE public.paige_agreements SET sealed_storage_key = NULL WHERE id = 'a6090000-0000-4000-8000-000000000004'$q$,'23514',NULL,'a completed agreement without its sealed key cannot exist, so the scope''s key check is defensive');

-- ── 9. Sub-account parity ───────────────────────────────────────────────────────────────────────
SELECT is((SELECT array_agg(r->>'id') FROM jsonb_array_elements(pg_temp.as_user('0a090000-0000-4000-8000-000000000007',$q$SELECT public.client_portal_agreements()$q$)->'agreements') r),
 ARRAY[pg_temp.ag(18)::text],'a sub-account''s customer lists their own agreement');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000007',18)->>'ok','true','and opens it to sign');
SELECT is(pg_temp.open('0a090000-0000-4000-8000-000000000007',2)->>'error','CLIENT_AGREEMENT_UNAVAILABLE','and nothing outside their business');

-- ── 10. No policy changed ───────────────────────────────────────────────────────────────────────
SELECT is((SELECT string_agg(tablename||':'||policyname||':'||cmd||':'||permissive, ',' ORDER BY tablename, policyname) FROM pg_policies
  WHERE schemaname='public' AND tablename IN ('paige_agreements','paige_agreement_signers','paige_agreement_events')),
 'paige_agreement_events:pae_no_direct_write:INSERT:RESTRICTIVE,paige_agreement_events:pae_tenant_isolation:ALL:RESTRICTIVE,paige_agreement_events:pae_tenant_read:SELECT:PERMISSIVE,'
 'paige_agreement_signers:pas_no_direct_delete:DELETE:RESTRICTIVE,paige_agreement_signers:pas_no_direct_update:UPDATE:RESTRICTIVE,paige_agreement_signers:pas_no_direct_write:INSERT:RESTRICTIVE,paige_agreement_signers:pas_tenant_isolation:ALL:RESTRICTIVE,paige_agreement_signers:pas_tenant_read:SELECT:PERMISSIVE,'
 'paige_agreements:pa_no_direct_delete:DELETE:RESTRICTIVE,paige_agreements:pa_no_direct_update:UPDATE:RESTRICTIVE,paige_agreements:pa_no_direct_write:INSERT:RESTRICTIVE,paige_agreements:pa_tenant_isolation:ALL:RESTRICTIVE,paige_agreements:pa_tenant_read:SELECT:PERMISSIVE',
 'the agreements engine keeps exactly its thirteen policies');
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('paige_agreements','paige_agreement_signers','paige_agreement_events')
  AND (coalesce(qual,'')||coalesce(with_check,'')) ~* '(linked_user_id|client_portal|clients)'),0::bigint,'no policy grants a portal customer anything');

SELECT * FROM finish();
ROLLBACK;
