-- Original-record fixtures only, actual caller roles, rolled back. No native submit,
-- HTTP wake, provider, publication or Chat execution. Frozen work payload shape is
-- the inspected original submit contract; this proof exercises the new reader.
BEGIN;
SELECT no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0c10100-0000-4000-8000-0000000000a1','authenticated','authenticated','cura-prep-owner-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0c10100-0000-4000-8000-0000000000a2','authenticated','authenticated','cura-prep-client@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0c10100-0000-4000-8000-0000000000a5','authenticated','authenticated','cura-prep-member@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0c10100-0000-4000-8000-0000000000b1','authenticated','authenticated','cura-prep-owner-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0c10100-0000-4000-8000-0000000000f1','authenticated','authenticated','cura-prep-operator@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.user_roles(user_id,role) VALUES('e0c10100-0000-4000-8000-0000000000f1','super_admin');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id) VALUES
 ('e0c10200-0000-4000-8000-00000000000a','cura-preparation-reader-a','Reader test A','active','standalone',NULL),
 ('e0c10200-0000-4000-8000-00000000000b','cura-preparation-reader-b','Reader test B','active','standalone',NULL);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0c10200-0000-4000-8000-00000000000a','e0c10100-0000-4000-8000-0000000000a1','owner','active',true,now()),
 ('e0c10200-0000-4000-8000-00000000000a','e0c10100-0000-4000-8000-0000000000a5','member','active',false,now()),
 ('e0c10200-0000-4000-8000-00000000000b','e0c10100-0000-4000-8000-0000000000a1','owner','active',true,now()),
 ('e0c10200-0000-4000-8000-00000000000b','e0c10100-0000-4000-8000-0000000000b1','owner','active',true,now());
-- A real external-client relationship is not staff workspace membership.
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0c10300-0000-4000-8000-0000000000a2','e0c10200-0000-4000-8000-00000000000a','e0c10100-0000-4000-8000-0000000000a2','e0c10100-0000-4000-8000-0000000000a1','Test','Customer','active');
UPDATE public.profiles SET active_tenant_id='e0c10200-0000-4000-8000-00000000000a' WHERE user_id IN
 ('e0c10100-0000-4000-8000-0000000000a1','e0c10100-0000-4000-8000-0000000000a5','e0c10100-0000-4000-8000-0000000000f1');
UPDATE public.profiles SET active_tenant_id='e0c10200-0000-4000-8000-00000000000b' WHERE user_id='e0c10100-0000-4000-8000-0000000000b1';
CREATE FUNCTION pg_temp.u(w text) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e0c10100-0000-4000-8000-0000000000'||w)::uuid $$;
CREATE FUNCTION pg_temp.t(w text) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e0c10200-0000-4000-8000-00000000000'||w)::uuid $$;
CREATE TEMP TABLE prep_fixture(name text,work_id uuid,document_id uuid,intent_id uuid);
CREATE FUNCTION pg_temp.seed_preparation(n text,a text,t text,i uuid,d uuid,k text DEFAULT 'knowledge_extract',c text DEFAULT 'knowledge.extract')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE w record; h text;
BEGIN
 SELECT * INTO w FROM public.create_paige_durable_work(pg_temp.t(t),pg_temp.u(a),i,NULL,c,k,
  jsonb_build_object('tenant_id',pg_temp.t(t),'actor_user_id',pg_temp.u(a),'source','knowledge_extraction'),'tenant:'||pg_temp.t(t)::text,60,3);
 h:=encode(sha256(convert_to(jsonb_build_object('target',NULL::uuid,'revision',NULL::integer,'title','Program FAQ',
  'hash',encode(sha256(convert_to('Approved program details.','UTF8')),'hex'),'source',NULL::jsonb)::text,'UTF8')),'hex');
 UPDATE public.paige_durable_work SET request_payload=jsonb_build_object('version',1,'document_id',d,'request_hash',h,
  'input_hash',encode(sha256(convert_to('Approved program details.','UTF8')),'hex'),'revision',1) WHERE id=w.work_id;
 INSERT INTO prep_fixture VALUES(n,w.work_id,d,i);
END $$;
SELECT pg_temp.seed_preparation('a','a1','a','e0c10500-0000-4000-8000-000000000001','e0c10400-0000-4000-8000-000000000001');
SELECT pg_temp.seed_preparation('b','b1','b','e0c10500-0000-4000-8000-000000000001','e0c10400-0000-4000-8000-000000000002');
SELECT pg_temp.seed_preparation('foreign','a1','a','e0c10500-0000-4000-8000-000000000002','e0c10400-0000-4000-8000-000000000002');
SELECT pg_temp.seed_preparation('missing','a1','a','e0c10500-0000-4000-8000-000000000003','e0c10400-0000-4000-8000-000000000099');
SELECT pg_temp.seed_preparation('kind','a1','a','e0c10500-0000-4000-8000-000000000004','e0c10400-0000-4000-8000-000000000001','knowledge_publish','knowledge.publish');
INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,created_by,record_state,source)
 SELECT document_id,pg_temp.t(name),'Program FAQ','','e0c10100-0000-4000-8000-0000000000a1','draft','paste' FROM prep_fixture WHERE name IN ('a','b');
CREATE FUNCTION pg_temp.as_user(a uuid,q text,r text DEFAULT 'authenticated') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role',r)::text,true);
 IF r='anon' THEN SET LOCAL ROLE anon; ELSIF r='service_role' THEN SET LOCAL ROLE service_role; ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE q INTO v; EXCEPTION WHEN OTHERS THEN v:=jsonb_build_object('sqlstate',SQLSTATE); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true); RETURN v;
END $$;
CREATE FUNCTION pg_temp.observe(a text DEFAULT 'a1',t text DEFAULT 'a',i uuid DEFAULT 'e0c10500-0000-4000-8000-000000000001',
 title text DEFAULT 'Program FAQ',body text DEFAULT 'Approved program details.',r text DEFAULT 'authenticated') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user(CASE WHEN a IS NULL THEN NULL ELSE pg_temp.u(a) END,
 format('SELECT public.read_cura_knowledge_preparation(%L,%L,%L,%L)',pg_temp.t(t),i,title,body),r) $$;
CREATE TEMP TABLE prep_before AS SELECT
 (SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM public.paige_durable_work w) work,
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.tenant_knowledge_docs d) docs,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tenant_knowledge_client_shares s) shares;
SELECT ok(has_function_privilege('authenticated','public.read_cura_knowledge_preparation(uuid,uuid,text,text)','EXECUTE'),'caller JWT may use read projection');
SELECT ok(NOT has_function_privilege('anon','public.read_cura_knowledge_preparation(uuid,uuid,text,text)','EXECUTE'),'anon cannot execute');
SELECT ok(NOT has_function_privilege('service_role','public.read_cura_knowledge_preparation(uuid,uuid,text,text)','EXECUTE'),'service role cannot impersonate a reader');
SELECT ok((SELECT prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.read_cura_knowledge_preparation(uuid,uuid,text,text)'::regprocedure),'definer uses empty path; authority row-lock volatility explicit');
SELECT is(pg_temp.observe()->>'availability','available','exact owned original preparation is observable');
SELECT is(pg_temp.observe()->>'work_id',(SELECT work_id::text FROM prep_fixture WHERE name='a'),'read uses original work id');
SELECT is(pg_temp.observe()->>'source_document_id',(SELECT document_id::text FROM prep_fixture WHERE name='a'),'read links original own-business source');
SELECT is(pg_temp.observe()->>'work_status','claimed','acceptance does not invent completion');
SELECT is(pg_temp.observe()->>'preparation_recorded','true','matching native record is confirmed');
SELECT is(pg_temp.observe()->>'retry_authorized','false','recorded request grants no retry');
SELECT is(pg_temp.observe()->>'current_document_revision','1','current source revision is explicit');
SELECT is(pg_temp.observe(),pg_temp.observe(),'repeat observation returns the same canonical state');
SELECT is(pg_temp.observe('a1','a','e0c10500-0000-4000-8000-000000000001','  Program FAQ  ')->>'availability','available','same native title trim semantics');
SELECT is(pg_temp.observe('a1','a',gen_random_uuid())->>'availability','unavailable','unseen intent remains unconfirmed');
SELECT is(pg_temp.observe('a1','a',gen_random_uuid())->>'retry_authorized','false','absence never authorizes re-dispatch');
SELECT is(pg_temp.observe('a1','a','e0c10500-0000-4000-8000-000000000001','Different title')->>'availability','unavailable','same intent with different title withheld');
SELECT is(pg_temp.observe('a1','a','e0c10500-0000-4000-8000-000000000001','Program FAQ','Changed text')->>'availability','unavailable','same intent with changed bytes withheld');
SELECT is(pg_temp.observe('a1','a','e0c10500-0000-4000-8000-000000000004')->>'availability','unavailable','other capability/work kind withheld');
SELECT ok(pg_temp.observe('a1','a',gen_random_uuid())->'preparation_recorded'='null'::jsonb,'unavailable is not a false non-application result');
SELECT ok(NOT (pg_temp.observe() ?| ARRAY['content','title','input_hash','request_hash','idempotency_key','authority_context','safe_summary','publication','share']),'DTO excludes raw inputs, worker keys, private context and publication claims');
SELECT is(pg_temp.observe('b1','b')->>'work_id',(SELECT work_id::text FROM prep_fixture WHERE name='b'),'same intent UUID in another business resolves only its owner');
SELECT is(pg_temp.observe('b1','a')->>'sqlstate','42501','wrong-business owner refused');
SELECT is(pg_temp.observe('a2','a')->>'sqlstate','42501','external-client login refused');
SELECT is(pg_temp.observe('a5','a')->>'sqlstate','42501','ordinary nonpublisher member refused');
SELECT is(pg_temp.observe('f1','a')->>'sqlstate','42501','platform title is not business publishing permission');
SELECT is(pg_temp.observe(NULL,'a')->>'sqlstate','42501','missing actual actor refused');
SELECT is(pg_temp.observe('a1','a','e0c10500-0000-4000-8000-000000000001','Program FAQ','Approved program details.','anon')->>'sqlstate','42501','anon JWT label cannot become actor authority');
SELECT is(pg_temp.observe('a1','a','e0c10500-0000-4000-8000-000000000001','Program FAQ','Approved program details.','service_role')->>'sqlstate','42501','service context cannot use authenticated-only read');
SELECT ok((SELECT work=(SELECT jsonb_agg(to_jsonb(w) ORDER BY id) FROM public.paige_durable_work w) FROM prep_before),'reads never change work rows, attempts or receipts');
SELECT ok((SELECT docs=(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.tenant_knowledge_docs d) FROM prep_before),'reads never create or alter Knowledge');
SELECT ok((SELECT shares IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tenant_knowledge_client_shares s) FROM prep_before),'reads never change customer sharing');
SELECT is(pg_temp.observe('a1','a',NULL)->>'sqlstate','22023','missing original intent refused');
SELECT is(pg_temp.observe('a1','a','e0c10500-0000-4000-8000-000000000001','')->>'sqlstate','22023','empty title refused');
SELECT is(pg_temp.observe('a1','a','e0c10500-0000-4000-8000-000000000001','Program FAQ','')->>'sqlstate','22023','empty body refused');
SELECT is(pg_temp.observe('a1','a','e0c10500-0000-4000-8000-000000000001','Program FAQ',repeat('x',480001))->>'sqlstate','22023','oversized input refused');
SELECT is(pg_temp.observe('a1','a','e0c10500-0000-4000-8000-000000000001','Program FAQ',repeat(U&'\+01F600',240001))->>'sqlstate','22023','non-BMP code-unit limit preserved');
UPDATE public.profiles SET active_tenant_id=pg_temp.t('b') WHERE user_id=pg_temp.u('a1');
SELECT is(pg_temp.observe()->>'sqlstate','42501','workspace switch retires original A read');
SELECT is(pg_temp.observe('a1','b')->>'availability','unavailable','dual owner cannot read the other original actor work');
UPDATE public.profiles SET active_tenant_id=pg_temp.t('a') WHERE user_id=pg_temp.u('a1');
SELECT is(pg_temp.observe()->>'availability','available','returning session revalidates original authority');
UPDATE public.tenant_members SET status='inactive' WHERE user_id=pg_temp.u('a1') AND tenant_id=pg_temp.t('a');
SELECT is(pg_temp.observe()->>'sqlstate','42501','revocation effective on next read');
UPDATE public.tenant_members SET status='active',is_owner=false,role='member' WHERE user_id=pg_temp.u('a1') AND tenant_id=pg_temp.t('a');
SELECT is(pg_temp.observe()->>'sqlstate','42501','role downgrade removes publishing access');
UPDATE public.tenant_members SET is_owner=true,role='owner' WHERE user_id=pg_temp.u('a1') AND tenant_id=pg_temp.t('a');
UPDATE public.paige_durable_work SET status='outcome_unknown' WHERE id=(SELECT work_id FROM prep_fixture WHERE name='a');
SELECT is(pg_temp.observe()->>'work_status','outcome_unknown','work uncertainty is preserved, not called complete');
SELECT is(pg_temp.observe()->>'retry_authorized','false','unknown work grants no retry or hold clearance');
UPDATE public.tenant_knowledge_docs SET title='Later owner correction' WHERE id=(SELECT document_id FROM prep_fixture WHERE name='a');
SELECT ok((pg_temp.observe()->>'current_document_revision')::integer>1,'current source revision is separate from frozen original submission');
SELECT is(pg_temp.observe('a1','a','e0c10500-0000-4000-8000-000000000002')->'source_document_id','null'::jsonb,'inconsistent foreign source pointer reveals no document');
SELECT is(pg_temp.observe('a1','a','e0c10500-0000-4000-8000-000000000003')->>'preparation_recorded','true','retired source does not erase recorded original acceptance');
SELECT is(pg_temp.observe('a1','a','e0c10500-0000-4000-8000-000000000003')->'source_document_id','null'::jsonb,'missing source remains explicitly unavailable');
SELECT * FROM finish();
ROLLBACK;
