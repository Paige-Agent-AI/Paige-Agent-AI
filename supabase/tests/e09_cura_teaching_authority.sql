-- Full schema, actual JWT/database roles, synthetic original records.
-- Entire transaction is ROLLBACK: pg_net sends only after commit, so original
-- worker wakes enqueued by new-source tests cannot leave this disposable DB.
-- https://supabase.com/docs/guides/database/extensions/pg_net#http_post
BEGIN;
SELECT no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0c20100-0000-4000-8000-0000000000a1','authenticated','authenticated','cura-teach-owner-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0c20100-0000-4000-8000-0000000000a2','authenticated','authenticated','cura-teach-client@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0c20100-0000-4000-8000-0000000000a5','authenticated','authenticated','cura-teach-member@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0c20100-0000-4000-8000-0000000000b1','authenticated','authenticated','cura-teach-owner-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0c20100-0000-4000-8000-0000000000f1','authenticated','authenticated','cura-teach-operator@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.user_roles(user_id,role) VALUES('e0c20100-0000-4000-8000-0000000000f1','super_admin');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id) VALUES
 ('e0c20200-0000-4000-8000-00000000000a','cura-teaching-writer-a','Reader test A','active','standalone',NULL),
 ('e0c20200-0000-4000-8000-00000000000b','cura-teaching-writer-b','Reader test B','active','standalone',NULL);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0c20200-0000-4000-8000-00000000000a','e0c20100-0000-4000-8000-0000000000a1','owner','active',true,now()),
 ('e0c20200-0000-4000-8000-00000000000a','e0c20100-0000-4000-8000-0000000000a5','member','active',false,now()),
 ('e0c20200-0000-4000-8000-00000000000b','e0c20100-0000-4000-8000-0000000000a1','owner','active',true,now()),
 ('e0c20200-0000-4000-8000-00000000000b','e0c20100-0000-4000-8000-0000000000b1','owner','active',true,now());
-- A real external-client relationship is not staff workspace membership.
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0c20300-0000-4000-8000-0000000000a2','e0c20200-0000-4000-8000-00000000000a','e0c20100-0000-4000-8000-0000000000a2','e0c20100-0000-4000-8000-0000000000a1','Test','Customer','active');
UPDATE public.profiles SET active_tenant_id='e0c20200-0000-4000-8000-00000000000a' WHERE user_id IN
 ('e0c20100-0000-4000-8000-0000000000a1','e0c20100-0000-4000-8000-0000000000a5','e0c20100-0000-4000-8000-0000000000f1');
UPDATE public.profiles SET active_tenant_id='e0c20200-0000-4000-8000-00000000000b' WHERE user_id='e0c20100-0000-4000-8000-0000000000b1';
CREATE FUNCTION pg_temp.u(w text) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e0c20100-0000-4000-8000-0000000000'||w)::uuid $$;
CREATE FUNCTION pg_temp.t(w text) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e0c20200-0000-4000-8000-00000000000'||w)::uuid $$;
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
SELECT pg_temp.seed_preparation('a','a1','a','e0c20500-0000-4000-8000-000000000001','e0c20400-0000-4000-8000-000000000001');
SELECT pg_temp.seed_preparation('b','b1','b','e0c20500-0000-4000-8000-000000000001','e0c20400-0000-4000-8000-000000000002');
SELECT pg_temp.seed_preparation('foreign','a1','a','e0c20500-0000-4000-8000-000000000002','e0c20400-0000-4000-8000-000000000002');
SELECT pg_temp.seed_preparation('missing','a1','a','e0c20500-0000-4000-8000-000000000003','e0c20400-0000-4000-8000-000000000099');
SELECT pg_temp.seed_preparation('kind','a1','a','e0c20500-0000-4000-8000-000000000004','e0c20400-0000-4000-8000-000000000001','knowledge_publish','knowledge.publish');
INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,created_by,record_state,source)
 SELECT document_id,pg_temp.t(name),'Program FAQ','','e0c20100-0000-4000-8000-0000000000a1','draft','paste' FROM prep_fixture WHERE name IN ('a','b');
CREATE FUNCTION pg_temp.as_user(a uuid,q text,r text DEFAULT 'authenticated') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role',r)::text,true);
 IF r='anon' THEN SET LOCAL ROLE anon; ELSIF r='service_role' THEN SET LOCAL ROLE service_role; ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE q INTO v; EXCEPTION WHEN OTHERS THEN v:=jsonb_build_object('sqlstate',SQLSTATE); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true); RETURN v;
END $$;
CREATE FUNCTION pg_temp.prepare(a text DEFAULT 'a1',t text DEFAULT 'a',
 i uuid DEFAULT 'e0c20500-0000-4000-8000-000000000001',
 title text DEFAULT 'Program FAQ',body text DEFAULT 'Approved program details.',
 r text DEFAULT 'authenticated') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user(CASE WHEN a IS NULL THEN NULL ELSE pg_temp.u(a) END,
 format('SELECT public.submit_cura_knowledge_preparation(%L,%L,%L,%L)',pg_temp.t(t),i,title,body),r) $$;
CREATE TEMP TABLE teach_results(name text,data jsonb);
CREATE TEMP TABLE teach_before AS SELECT
 (SELECT count(*) FROM public.paige_durable_work) work_count,
 (SELECT count(*) FROM public.tenant_knowledge_docs) doc_count,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tenant_knowledge_client_shares s) shares;
SELECT ok(has_function_privilege('authenticated','public.submit_cura_knowledge_preparation(uuid,uuid,text,text)','EXECUTE'),'actual caller may prepare through publisher gate');
SELECT ok(NOT has_function_privilege('anon','public.submit_cura_knowledge_preparation(uuid,uuid,text,text)','EXECUTE'),'anonymous caller denied');
SELECT ok(NOT has_function_privilege('service_role','public.submit_cura_knowledge_preparation(uuid,uuid,text,text)','EXECUTE'),'service role cannot impersonate publisher');
SELECT ok(NOT has_function_privilege('authenticated','public.submit_knowledge_extraction(uuid,uuid,uuid,uuid,integer,text,text,jsonb)','EXECUTE'),'original privileged writer remains unexposed');
SELECT ok((SELECT prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=""'] AND pg_get_userbyid(proowner)='postgres'
 FROM pg_proc WHERE oid='public.submit_cura_knowledge_preparation(uuid,uuid,text,text)'::regprocedure),'explicit native transaction and empty search path');
SELECT is(pg_temp.prepare()->>'replayed','true','original accepted intent replays through sole writer');
SELECT is(pg_temp.prepare()->>'work_id',(SELECT work_id::text FROM prep_fixture WHERE name='a'),'replay returns exact original work');
SELECT is(pg_temp.prepare()->>'document_id',(SELECT document_id::text FROM prep_fixture WHERE name='a'),'replay returns exact original private source');
SELECT ok((SELECT work_count=(SELECT count(*) FROM public.paige_durable_work) AND doc_count=(SELECT count(*) FROM public.tenant_knowledge_docs) FROM teach_before),'replay creates no work or source');
SELECT is(pg_temp.prepare('a1','a','e0c20500-0000-4000-8000-000000000001','Program FAQ','Changed approved text')->>'sqlstate','22023','same intent changed payload refused by original native writer');
INSERT INTO teach_results VALUES('new',pg_temp.prepare('a1','a','e0c20500-0000-4000-8000-000000000009'));
SELECT is((SELECT data->>'status' FROM teach_results WHERE name='new'),'claimed','new private preparation accepted by original writer');
SELECT is((SELECT data->>'replayed' FROM teach_results WHERE name='new'),'false','first preparation is distinguished from replay');
SELECT is((SELECT data->>'revision' FROM teach_results WHERE name='new'),'1','original native document revision retained');
SELECT ok((SELECT record_state='draft' AND content='' AND extraction_input='Approved program details.' AND active_generation_id IS NULL
 FROM public.tenant_knowledge_docs WHERE id=(SELECT (data->>'document_id')::uuid FROM teach_results WHERE name='new')),'source remains private, unpublished and unindexed');
SELECT ok((SELECT initiating_user_id=pg_temp.u('a1') AND tenant_id=pg_temp.t('a') AND work_kind='knowledge_extract' AND capability_key='knowledge.extract'
 FROM public.paige_durable_work WHERE id=(SELECT (data->>'work_id')::uuid FROM teach_results WHERE name='new')),'canonical work attributes actual caller and selected business');
SELECT ok((SELECT request_payload::text NOT LIKE '%Approved program details.%' FROM public.paige_durable_work
 WHERE id=(SELECT (data->>'work_id')::uuid FROM teach_results WHERE name='new')),'raw private input is not copied into work payload');
SELECT is(pg_temp.prepare('a1','a','e0c20500-0000-4000-8000-000000000009')->>'work_id',(SELECT data->>'work_id' FROM teach_results WHERE name='new'),'returning request preserves original work');
SELECT is(pg_temp.prepare('a1','a','e0c20500-0000-4000-8000-000000000009')->>'replayed','true','native repeat does not create another preparation');
SELECT ok((SELECT shares IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tenant_knowledge_client_shares s) FROM teach_before),'preparation never changes customer Knowledge visibility');
SELECT is(pg_temp.prepare('b1','a')->>'sqlstate','42501','foreign business owner refused');
SELECT is(pg_temp.prepare('a2','a')->>'sqlstate','42501','external customer cannot prepare business Knowledge');
SELECT is(pg_temp.prepare('a5','a')->>'sqlstate','42501','ordinary member cannot teach CURA');
SELECT is(pg_temp.prepare('f1','a')->>'sqlstate','42501','bare platform title does not confer business publishing');
SELECT is(pg_temp.prepare(NULL,'a')->>'sqlstate','42501','missing actual actor refused');
SELECT is(pg_temp.prepare('a1','a','e0c20500-0000-4000-8000-000000000001','Program FAQ','Approved program details.','anon')->>'sqlstate','42501','anonymous role cannot use a supplied subject');
SELECT is(pg_temp.prepare('a1','a','e0c20500-0000-4000-8000-000000000001','Program FAQ','Approved program details.','service_role')->>'sqlstate','42501','service role label cannot delegate identity');
SELECT is(pg_temp.prepare('a1','a',NULL)->>'sqlstate','22023','missing intent refused');
SELECT is(pg_temp.prepare('a1','a','e0c20500-0000-4000-8000-000000000001','')->>'sqlstate','22023','empty title refused before any work');
SELECT is(pg_temp.prepare('a1','a','e0c20500-0000-4000-8000-000000000001','Program FAQ','')->>'sqlstate','22023','empty input refused');
SELECT is(pg_temp.prepare('a1','a','e0c20500-0000-4000-8000-000000000001','Program FAQ',repeat('x',480001))->>'sqlstate','22023','original input limit preserved');
UPDATE public.profiles SET active_tenant_id=pg_temp.t('b') WHERE user_id=pg_temp.u('a1');
SELECT is(pg_temp.prepare()->>'sqlstate','42501','workspace change blocks old business even for dual owner');
INSERT INTO teach_results VALUES('other_business',pg_temp.prepare('a1','b'));
SELECT ok((SELECT data->>'work_id' IS NOT NULL AND data->>'work_id'<>(SELECT work_id::text FROM prep_fixture WHERE name='b') FROM teach_results WHERE name='other_business'),'same intent in other business is not another actor work');
UPDATE public.profiles SET active_tenant_id=pg_temp.t('a') WHERE user_id=pg_temp.u('a1');
UPDATE public.tenant_members SET is_owner=false,role='member' WHERE user_id=pg_temp.u('a1') AND tenant_id=pg_temp.t('a');
SELECT ok(public.knowledge_actor_authorized(pg_temp.u('a1'),pg_temp.t('a')),'downgraded member retains ordinary private Knowledge authority');
SELECT is(pg_temp.prepare()->>'sqlstate','42501','native publisher boundary rejects downgrade despite ordinary writer eligibility');
UPDATE public.tenant_members SET role='admin',status='inactive' WHERE user_id=pg_temp.u('a1') AND tenant_id=pg_temp.t('a');
SELECT is(pg_temp.prepare()->>'sqlstate','42501','inactive publisher membership is refused');
UPDATE public.tenant_members SET status='active' WHERE user_id=pg_temp.u('a1') AND tenant_id=pg_temp.t('a');
SELECT is(pg_temp.prepare()->>'replayed','true','business admin retains incumbent publishing permission');
UPDATE public.tenant_members SET role='member' WHERE user_id=pg_temp.u('a1') AND tenant_id=pg_temp.t('a');
UPDATE public.tenants SET parent_tenant_id=pg_temp.t('b') WHERE id=pg_temp.t('a');
SELECT is(pg_temp.prepare()->>'replayed','true','incumbent ancestor owner publishing permission is preserved');
UPDATE public.tenant_members SET is_owner=false,role='member' WHERE user_id=pg_temp.u('a1') AND tenant_id=pg_temp.t('b');
SELECT is(pg_temp.prepare()->>'sqlstate','42501','committed ancestor downgrade is refused');
UPDATE public.tenant_members SET role='admin' WHERE user_id=pg_temp.u('a1') AND tenant_id=pg_temp.t('b');
SELECT is(pg_temp.prepare()->>'replayed','true','incumbent ancestor admin publishing permission is preserved');
UPDATE public.tenants SET parent_tenant_id=NULL WHERE id=pg_temp.t('a');
SELECT is(pg_temp.prepare()->>'sqlstate','42501','reparenting away from publishing authority is refused');
UPDATE public.tenants SET parent_tenant_id=pg_temp.t('b') WHERE id=pg_temp.t('a');
DELETE FROM public.tenant_members WHERE user_id=pg_temp.u('a1') AND tenant_id=pg_temp.t('b');
SELECT is(pg_temp.prepare()->>'sqlstate','42501','ancestor membership deletion cuts off preparation');
SELECT is((SELECT count(*)::integer FROM public.paige_durable_work WHERE tenant_id IN (pg_temp.t('a'),pg_temp.t('b'))),7,'only two explicitly requested new preparations exist alongside original five');
SELECT is((SELECT count(*)::integer FROM public.tenant_knowledge_docs WHERE tenant_id IN (pg_temp.t('a'),pg_temp.t('b'))),4,'only two explicit private sources added to original two');
SELECT * FROM finish();
ROLLBACK;
