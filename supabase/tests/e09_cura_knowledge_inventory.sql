-- Teach CURA inventory; inherited K1 synthetic fixtures, actual caller roles, no providers.
-- All data and actions roll back. This does not establish authenticated production proof.
BEGIN;
SELECT no_plan();

-- ── Seed ────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0b10100-0000-4000-8000-0000000000a1','authenticated','authenticated','k1-owner-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0b10100-0000-4000-8000-0000000000a2','authenticated','authenticated','k1-customer-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0b10100-0000-4000-8000-0000000000a3','authenticated','authenticated','k1-peer-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0b10100-0000-4000-8000-0000000000a4','authenticated','authenticated','k1-paused-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0b10100-0000-4000-8000-0000000000a5','authenticated','authenticated','k1-coach-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0b10100-0000-4000-8000-0000000000b1','authenticated','authenticated','k1-owner-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0b10100-0000-4000-8000-0000000000b2','authenticated','authenticated','k1-customer-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0b10100-0000-4000-8000-0000000000f1','authenticated','authenticated','k1-platform-owner@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.user_roles(user_id,role) VALUES ('e0b10100-0000-4000-8000-0000000000f1','super_admin');

-- A: Northwind Studio, NOT finance-entitled. B: Harbor Lane Advisors, entitled (flag written by the service path).
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,features) VALUES
 ('e0b10200-0000-4000-8000-00000000000a','test-tenant-k1-a','Northwind Studio','active','standalone',NULL,'{}'),
 ('e0b10200-0000-4000-8000-00000000000b','test-tenant-k1-b','Harbor Lane Advisors','active','standalone',NULL,'{"finance_in_scope": true}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0b10200-0000-4000-8000-00000000000a','e0b10100-0000-4000-8000-0000000000a1','owner','active',true,now()),
 ('e0b10200-0000-4000-8000-00000000000a','e0b10100-0000-4000-8000-0000000000a5','member','active',false,now()),
 ('e0b10200-0000-4000-8000-00000000000b','e0b10100-0000-4000-8000-0000000000b1','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e0b10200-0000-4000-8000-00000000000a'
 WHERE user_id IN ('e0b10100-0000-4000-8000-0000000000a1','e0b10100-0000-4000-8000-0000000000a5','e0b10100-0000-4000-8000-0000000000f1');
UPDATE public.profiles SET active_tenant_id='e0b10200-0000-4000-8000-00000000000b' WHERE user_id='e0b10100-0000-4000-8000-0000000000b1';
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0b10300-0000-4000-8000-0000000000a2','e0b10200-0000-4000-8000-00000000000a','e0b10100-0000-4000-8000-0000000000a2','e0b10100-0000-4000-8000-0000000000a1','Jordan','Rivera','active'),
 ('e0b10300-0000-4000-8000-0000000000a3','e0b10200-0000-4000-8000-00000000000a','e0b10100-0000-4000-8000-0000000000a3','e0b10100-0000-4000-8000-0000000000a1','Riley','Chen','active'),
 ('e0b10300-0000-4000-8000-0000000000a4','e0b10200-0000-4000-8000-00000000000a','e0b10100-0000-4000-8000-0000000000a4','e0b10100-0000-4000-8000-0000000000a1','Sam','Patel','active'),
 ('e0b10300-0000-4000-8000-0000000000b2','e0b10200-0000-4000-8000-00000000000b','e0b10100-0000-4000-8000-0000000000b2','e0b10100-0000-4000-8000-0000000000b1','Casey','Morgan','active');
-- Paused through the access writer's own seam switch (the Slice 7 guard admits it).
SELECT set_config('paige.portal_access_write','1',true);
UPDATE public.clients SET portal_access_state='paused' WHERE id='e0b10300-0000-4000-8000-0000000000a4';
SELECT set_config('paige.portal_access_write','',true);

-- Documents. Pinned ones carry a real manifest of their own content and one exact chunk.
CREATE TEMP TABLE k1_docs(id uuid,tenant uuid,title text,content text,pinned boolean,state text,tags text[]);
INSERT INTO k1_docs VALUES
 ('e0b10400-0000-4000-8000-000000000001','e0b10200-0000-4000-8000-00000000000a','Program guide','Our six-week onboarding program starts with a kickoff call.',true,'canonical',NULL),
 ('e0b10400-0000-4000-8000-000000000002','e0b10200-0000-4000-8000-00000000000a','Old notes','Legacy text that was never published.',false,'canonical',NULL),
 ('e0b10400-0000-4000-8000-000000000003','e0b10200-0000-4000-8000-00000000000a','Draft','',false,'draft',NULL),
 ('e0b10400-0000-4000-8000-000000000004','e0b10200-0000-4000-8000-00000000000a','Growth options','Ask us about opening a business line of credit.',true,'canonical',NULL),
 ('e0b10400-0000-4000-8000-000000000005','e0b10200-0000-4000-8000-00000000000a','Partner program','A partner track for clients ready to grow.',true,'canonical',ARRAY['marketplace:funding_coach']),
 ('e0b10400-0000-4000-8000-000000000006','e0b10200-0000-4000-8000-00000000000a','Session policy','Reschedule up to 24 hours before a session.',true,'canonical',NULL),
 ('e0b10400-0000-4000-8000-000000000007','e0b10200-0000-4000-8000-00000000000b','Readiness guide','How our funding readiness review works.',true,'canonical',NULL);
INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,created_by,record_state,tags,active_generation_id,publication_manifest,chunk_count)
SELECT id,tenant,title,content,'e0b10100-0000-4000-8000-0000000000a1',state,tags,
  CASE WHEN pinned THEN md5('gen'||id::text)::uuid END,
  CASE WHEN pinned THEN public.knowledge_publication_manifest(content,'voyage-3') END,
  CASE WHEN pinned THEN 1 ELSE 0 END
FROM k1_docs;
INSERT INTO public.tenant_knowledge_chunks(id,tenant_id,doc_id,chunk_index,content,generation_id,embedding_model,embedding_dim)
SELECT md5('chunk'||k.id::text)::uuid,k.tenant,k.id,c.chunk_index,c.chunk_text,md5('gen'||k.id::text)::uuid,'voyage-3',1024
FROM k1_docs k CROSS JOIN LATERAL public.knowledge_publication_chunks(k.content) c WHERE k.pinned;

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.as_user(_actor uuid,_sql text,_role text DEFAULT 'authenticated') RETURNS jsonb
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
CREATE FUNCTION pg_temp.u(_who text) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('e0b10100-0000-4000-8000-0000000000'||_who)::uuid $$;
CREATE FUNCTION pg_temp.t(_who text) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('e0b10200-0000-4000-8000-00000000000'||_who)::uuid $$;
CREATE FUNCTION pg_temp.c(_who text) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('e0b10300-0000-4000-8000-0000000000'||_who)::uuid $$;
CREATE FUNCTION pg_temp.d(_n int) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('e0b10400-0000-4000-8000-00000000000'||_n)::uuid $$;
-- prepare (as _actor) then set with the returned proposal.
CREATE FUNCTION pg_temp.prep(_actor text,_tenant text,_doc int,_available boolean DEFAULT true,_kind text DEFAULT 'information',
 _from timestamptz DEFAULT NULL,_until timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user(pg_temp.u(_actor),format(
  'SELECT public.prepare_client_portal_business_knowledge_share(%L,%L,%L,%L,%L,%L)',
  pg_temp.t(_tenant),pg_temp.d(_doc),_available,_kind,_from,_until)) $$;
CREATE FUNCTION pg_temp.biz(_actor text,_tenant text,_doc int,_available boolean DEFAULT true,_kind text DEFAULT 'information',
 _from timestamptz DEFAULT NULL,_until timestamptz DEFAULT NULL,_op uuid DEFAULT gen_random_uuid()) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE p jsonb;
BEGIN
 p:=pg_temp.prep(_actor,_tenant,_doc,_available,_kind,_from,_until);
 IF p ? 'sqlstate' THEN RETURN p; END IF;
 RETURN pg_temp.as_user(pg_temp.u(_actor),format(
  'SELECT public.set_client_portal_business_knowledge_share(%L,%L,%L,%L,%L,%L,%s,%L,%L)',
  pg_temp.t(_tenant),pg_temp.d(_doc),_available,_kind,_from,_until,p->>'expected_share_revision',p->>'proposal_hash',_op));
END $$;

-- Exact callers and closed metadata projection; no publication or customer creation.
CREATE FUNCTION pg_temp.inventory(_who text,_tenant text,_doc int DEFAULT NULL,_query text DEFAULT NULL,_limit int DEFAULT 20,_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user(pg_temp.u(_who),format(
  'SELECT public.read_client_portal_business_knowledge(%L,%L,%L,%s,%s)',pg_temp.t(_tenant),
  CASE WHEN _doc IS NULL THEN NULL ELSE pg_temp.d(_doc) END,_query,_limit,_offset)) $$;
CREATE FUNCTION pg_temp.item(_n int) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.inventory('a1','a',_n)->'documents'->0 $$;

SELECT ok(has_function_privilege('authenticated','public.read_client_portal_business_knowledge(uuid,uuid,text,integer,integer)','EXECUTE')
 AND NOT has_function_privilege('anon','public.read_client_portal_business_knowledge(uuid,uuid,text,integer,integer)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.read_client_portal_business_knowledge(uuid,uuid,text,integer,integer)','EXECUTE'),'inventory authenticated only');
SELECT ok(NOT has_table_privilege('authenticated','public.tenant_knowledge_client_shares','SELECT')
 AND NOT has_table_privilege('authenticated','public.tenant_knowledge_client_shares','UPDATE'),'inventory does not expose the raw share table');
SELECT is(pg_temp.inventory('a1','a')->>'tenant_id',pg_temp.t('a')::text,'owner sees their actual current business');
SELECT is(jsonb_array_length(pg_temp.inventory('a1','a')->'documents'),6,'only this business documents, including its own draft');
SELECT is(pg_temp.inventory('a1','a')->>'audience','business','business audience explicit');
SELECT is(pg_temp.item(1)->>'source_state','prepared','canonical pinned generation prepared');
SELECT is(pg_temp.item(2)->>'source_state','needs_publication','legacy ingested text needs original reviewed publication');
SELECT is(pg_temp.item(3)->>'source_state','draft','draft remains private, never called prepared');
SELECT is(pg_temp.item(4)->>'source_state','not_entitled','optional finance source not prepared for a non-entitled business');
SELECT is(pg_temp.item(5)->>'source_state','not_entitled','structural Marketplace finance marker respected');
SELECT is(pg_temp.item(1)->>'share_state','not_shared','prepared does not mean shared');
SELECT is(pg_temp.item(1)->'share','null'::jsonb,'missing share is explicitly absent');
SELECT is(pg_temp.inventory('a2','a')->>'sqlstate','42501','customer cannot inspect owner source inventory');
SELECT is(pg_temp.inventory('a5','a')->>'sqlstate','42501','ordinary member cannot publish or inspect publisher inventory');
SELECT is(pg_temp.inventory('f1','a')->>'sqlstate','42501','bare platform operator is not the business publisher');
SELECT is(pg_temp.inventory('b1','a')->>'sqlstate','42501','another business owner cannot read this inventory');
SELECT is(pg_temp.inventory('a1','b')->>'sqlstate','42501','selected workspace equality binds the read');
SELECT is(jsonb_array_length(pg_temp.inventory('a1','a',7)->'documents'),0,'foreign source ID returns no private record');
SELECT is(jsonb_array_length(pg_temp.inventory('a1','a',1)->'documents'),1,'exact authorized source ID narrows');
SELECT is(jsonb_array_length(pg_temp.inventory('a1','a',NULL,'PROGRAM')->'documents'),2,'case-insensitive title search');
SELECT is(jsonb_array_length(pg_temp.inventory('a1','a',NULL,'%')->'documents'),0,'search metacharacter is literal');
SELECT ok((pg_temp.inventory('a1','a',NULL,NULL,2,0)->>'has_more')::boolean,'bounded page reports observed extra row');
SELECT is((pg_temp.inventory('a1','a',NULL,NULL,2,0)->>'next_offset')::int,2,'next offset counts returned documents');
SELECT is(jsonb_array_length(pg_temp.inventory('a1','a',NULL,NULL,2,4)->'documents'),2,'later page returns remaining records');
SELECT ok(NOT (pg_temp.inventory('a1','a',NULL,NULL,2,4)->>'has_more')::boolean,'exact final page has no invented continuation');
SELECT is(jsonb_array_length(pg_temp.inventory('a1','a',NULL,NULL,2,6)->'documents'),0,'empty page remains empty');
SELECT is(pg_temp.inventory('a1','a',NULL,NULL,0,0)->>'sqlstate','22023','zero limit refused');
SELECT is(pg_temp.inventory('a1','a',NULL,NULL,101,0)->>'sqlstate','22023','excessive limit refused');
SELECT is(pg_temp.inventory('a1','a',NULL,NULL,20,-1)->>'sqlstate','22023','negative offset refused');
SELECT is(pg_temp.inventory('a1','a',NULL,NULL,20,100001)->>'sqlstate','22023','excessive offset refused');
SELECT is(pg_temp.inventory('a1','a',NULL,repeat('a',201))->>'sqlstate','22023','excessive query refused');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.item(1)) k),
 ARRAY['document_id','document_revision','generation_id','pending_review','share','share_state','source_fingerprint','source_state','title','updated_at']::text[],'closed document keys omit content, URLs, pending text, author and customer identity');
SELECT is((SELECT count(*) FROM public.tenant_knowledge_client_shares WHERE tenant_id=pg_temp.t('a')),0::bigint,'all reads created no customer share');

-- Publish only through the inherited prepare/set writer, under the actual test owner.
CREATE TEMP TABLE k3_result(value jsonb);
INSERT INTO k3_result VALUES(pg_temp.biz('a1','a',1,true,'faq',NULL,now()+interval '1 day'));
SELECT ok(NOT (SELECT value FROM k3_result) ? 'sqlstate','existing governed publisher accepted exact prepared source');
SELECT is(pg_temp.item(1)->>'share_state','shared','current approved source and window reported shared');
SELECT is(pg_temp.item(1)->'share'->>'customer_kind','faq','actual saved customer kind returned');
SELECT is(pg_temp.item(1)->'share'->>'receipt_id',(SELECT value->>'receipt_id' FROM k3_result),'same canonical audit receipt after fresh reload');
SELECT is(pg_temp.item(1)->'share'->>'share_revision',(SELECT value->>'current_revision' FROM k3_result),'same native revision after fresh reload');
SELECT is(pg_temp.item(6)->'share','null'::jsonb,'share from prior loop row cannot bleed into an unshared source');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE id=((SELECT value->>'receipt_id' FROM k3_result))::uuid),1::bigint,'repeated inventory reads do not duplicate the receipt');
SELECT ok(NOT pg_temp.biz('a1','a',6,true,'policy',now()+interval '1 day',now()+interval '2 days') ? 'sqlstate','original writer accepts scheduled policy');
SELECT is(pg_temp.item(6)->>'share_state','scheduled','future start is not active sharing');
UPDATE public.tenant_knowledge_client_shares SET valid_from=now()-interval '2 days',valid_until=now()-interval '1 day'
 WHERE tenant_id=pg_temp.t('a') AND document_id=pg_temp.d(6) AND audience='business';
SELECT is(pg_temp.item(6)->>'share_state','expired','expired source is explicitly inactive');
UPDATE public.tenant_knowledge_docs SET title='Corrected program guide' WHERE id=pg_temp.d(1);
SELECT is(pg_temp.item(1)->>'share_state','source_changed','changed source invalidates prior customer approval');
SELECT ok(NOT pg_temp.biz('a1','a',1,false) ? 'sqlstate','original writer can withdraw stale source');
SELECT is(pg_temp.item(1)->>'share_state','withdrawn','withdrawal persists despite stale source');
SELECT ok(NOT pg_temp.biz('b1','b',7) ? 'sqlstate','entitled business can approve its optional source');
SELECT is(pg_temp.inventory('b1','b',7)->'documents'->0->>'share_state','shared','entitled business uses same implementation');
UPDATE public.tenants SET features='{}' WHERE id=pg_temp.t('b');
SELECT is(pg_temp.inventory('b1','b',7)->'documents'->0->>'share_state','not_entitled','entitlement loss hides eligibility on fresh read');
UPDATE public.tenant_members SET status='suspended' WHERE tenant_id=pg_temp.t('a') AND user_id=pg_temp.u('a1');
SELECT is(pg_temp.inventory('a1','a')->>'sqlstate','42501','membership withdrawal takes effect on next read');

SELECT * FROM finish();
ROLLBACK;
