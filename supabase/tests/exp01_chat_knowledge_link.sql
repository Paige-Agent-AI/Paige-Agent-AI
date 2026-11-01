-- Inserted before the existing receipt proof's finish/ROLLBACK. Same four
-- synthetic actors; no customer account, native enqueue, HTTP or provider call.
RESET ROLE;
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000002');
CREATE TEMP TABLE e01_host_original_functions AS SELECT oid,md5(pg_get_functiondef(oid)) definition,proowner,proconfig,proacl
 FROM pg_proc WHERE oid=ANY(ARRAY['public.paige_chat_thread_create(uuid,text,text,jsonb)'::regprocedure,
 'public.paige_chat_turn_append(uuid,text,text,text[],uuid,text,integer,integer,jsonb,jsonb)'::regprocedure,
 'public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean,boolean)'::regprocedure,
 'public._paige_durable_work_protect_identity()'::regprocedure,'public.read_tenant_knowledge_review(uuid,uuid)'::regprocedure,
 'public.submit_tenant_knowledge_publication(uuid,uuid,uuid,integer,uuid,text)'::regprocedure]);
-- EXP01_CHAT_INSTALL_CANDIDATE
CREATE TEMP TABLE e01_host_functions AS SELECT oid,md5(pg_get_functiondef(oid)) definition,proowner,proconfig,proacl
 FROM pg_proc WHERE proname IN ('_paige_chat_knowledge_scope','_paige_chat_knowledge_source','_paige_chat_knowledge_intake_source','inspect_paige_chat_knowledge_intake','stage_paige_chat_knowledge_intake','inspect_paige_chat_knowledge_link','save_paige_chat_knowledge_link','list_paige_chat_knowledge_links');
-- EXP01_CHAT_REPLAY_CANDIDATE
SELECT is((SELECT count(*)::integer FROM e01_host_functions b JOIN pg_proc p USING(oid) WHERE b.definition IS DISTINCT FROM md5(pg_get_functiondef(p.oid))
 OR b.proowner<>p.proowner OR b.proconfig IS DISTINCT FROM p.proconfig OR b.proacl IS DISTINCT FROM p.proacl),0,'host replay retains exact eight functions/owner/settings/ACL');
SELECT ok(NOT has_table_privilege('authenticated','public.paige_durable_work','UPDATE'),'authenticated callers cannot forge native host source annotations');
SELECT ok(NOT has_function_privilege('service_role','public.save_paige_chat_knowledge_link(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer)','EXECUTE'),'service cannot impersonate the explicit host Save action');
SELECT ok(NOT has_function_privilege('anon','public.inspect_paige_chat_knowledge_link(uuid,uuid,uuid,uuid)','EXECUTE'),'anon cannot inspect private host sources');
SELECT ok(NOT has_function_privilege('authenticated','public._paige_chat_knowledge_source(uuid,uuid,uuid)','EXECUTE'),'native source resolution remains private');
CREATE TEMP TABLE e01_host_state(name text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT,UPDATE ON e01_host_state TO authenticated;
CREATE TEMP TABLE e01_host_before_intake AS SELECT count(*) total FROM public.paige_chat_threads;
-- Seed a no-dispatch native envelope, then use ORIGINAL start/complete/review/
-- promotion functions. The enqueue RPC is deliberately never called by proof.
DO $$ DECLARE tenant uuid:='e0100200-0000-4000-8000-000000000001'; actor uuid:='e0100100-0000-4000-8000-000000000002';
 doc uuid:='e0100300-0000-4000-8000-000000000080'; w record; s jsonb; publication record; manifest jsonb; c jsonb;
 original text:='Original host source'; reviewed text:='Explicitly reviewed host source';
BEGIN
 SELECT * INTO w FROM public.create_paige_durable_work(tenant,actor,'e0100600-0000-4000-8000-000000000080',NULL,
  'knowledge.extract','knowledge_extract',jsonb_build_object('tenant_id',tenant,'actor_user_id',actor,'source','knowledge_extraction'),'tenant:'||tenant::text,60,3);
 INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,created_by,record_state,source,extraction_input,extraction_work_id,extraction_revision)
 VALUES(doc,tenant,'Host source proof','',actor,'draft','paste',original,w.work_id,1);
 UPDATE public.paige_durable_work SET request_payload=jsonb_build_object('version',1,'document_id',doc,'request_hash',encode(sha256(convert_to(jsonb_build_object('target',NULL,'revision',NULL,'title','Host source proof','hash',encode(sha256(convert_to(original,'UTF8')),'hex'),'source',NULL)::text,'UTF8')),'hex'),
  'input_hash',encode(sha256(convert_to(original,'UTF8')),'hex'),'revision',1) WHERE id=w.work_id;
 INSERT INTO e01_host_state VALUES('intake',public.stage_paige_chat_knowledge_intake(tenant,actor,NULL,NULL,w.work_id,doc,1,
  'e0100600-0000-4000-8000-000000000080',encode(sha256(convert_to(original,'UTF8')),'hex'),0));
 s:=public.start_knowledge_extraction(w.work_id);
 PERFORM public.complete_knowledge_extraction(w.work_id,s->>'server_key',(s->>'attempt')::integer,(s->>'revision')::integer,original,s->>'input_hash');
 PERFORM public.save_tenant_knowledge_review(tenant,doc,w.work_id,2,reviewed,'{"title":"Host source proof","summary":null,"category":null,"tags":[]}');
 manifest:=public.knowledge_publication_manifest(reviewed,'voyage-3');
 SELECT * INTO publication FROM public.create_paige_durable_work(tenant,actor,'e0100700-0000-4000-8000-000000000080',NULL,
  'knowledge.publish','knowledge_publish',jsonb_build_object('tenant_id',tenant,'actor_user_id',actor,'source','knowledge_publication'),'tenant:'||tenant::text,60,3);
 UPDATE public.paige_durable_work SET request_payload=jsonb_build_object('version',1,'document_id',doc,'extraction_work_id',w.work_id,'revision',3,
  'review_hash',encode(sha256(convert_to(reviewed,'UTF8')),'hex'),'manifest',manifest,'source',NULL,
  'request_hash',encode(sha256(convert_to(jsonb_build_object('document',doc,'revision',3,'review',encode(sha256(convert_to(reviewed,'UTF8')),'hex'),'manifest',manifest,'source',NULL)::text,'UTF8')),'hex')) WHERE id=publication.work_id;
 s:=public.start_knowledge_publication(publication.work_id);
 FOR c IN SELECT * FROM jsonb_array_elements(s->'chunks') LOOP
  PERFORM public.stage_knowledge_publication(publication.work_id,s->>'server_key',(s->>'attempt')::integer,(s->>'revision')::integer,
   jsonb_build_array(jsonb_build_object('index',(c->>'index')::integer,'sha256',c->>'sha256',
    'embedding',(SELECT jsonb_agg(0.5 ORDER BY n) FROM generate_series(1,1024)n))));
 END LOOP;
 PERFORM public.complete_knowledge_publication(publication.work_id,s->>'server_key',(s->>'attempt')::integer,(s->>'revision')::integer);
 INSERT INTO e01_host_state VALUES('work',to_jsonb(publication.work_id)),('extraction',to_jsonb(w.work_id));
END $$;
SELECT is((SELECT count(*) FROM public.paige_chat_threads),(SELECT total+1 FROM e01_host_before_intake),'original admission creates one actual first-value conversation before review');
SELECT is((SELECT value->>'extractionStatus' FROM e01_host_state WHERE name='intake'),'claimed','native admission receipt never claims extraction completion');
SELECT is((SELECT value#>>'{reference,phase}' FROM e01_host_state WHERE name='intake'),'intake','pre-review binding is explicitly an intake reference');
SELECT ok((SELECT NOT (value->'reference') ? 'publicationWorkId' AND NOT (value->'reference') ? 'publicationOutcome' FROM e01_host_state WHERE name='intake'),'admission cannot fabricate publication identity or receipt');
-- Genuine original Chat create/admission, no model/executor/effect activation.
INSERT INTO e01_host_state VALUES('mode',to_jsonb((SELECT active FROM public.paige_chat_interactive_rollout WHERE singleton)));
SET LOCAL ROLE authenticated;
INSERT INTO e01_host_state SELECT 'thread',value#>'{reference,threadId}' FROM e01_host_state WHERE name='intake';
INSERT INTO e01_host_state VALUES('admission',public.paige_chat_interactive_begin_v2(
 (SELECT (value#>>'{}')::uuid FROM e01_host_state WHERE name='thread'),'e0100800-0000-4000-8000-000000000080',NULL,
 'Review this source with me.',false,false,(SELECT (value#>>'{}')::boolean FROM e01_host_state WHERE name='mode')));
SELECT is((SELECT value->>'status' FROM e01_host_state WHERE name='admission'),'accepted','actual original native begin accepts the real user turn');
SELECT is(public.inspect_paige_chat_knowledge_intake('e0100200-0000-4000-8000-000000000001',auth.uid(),NULL,
 (SELECT (value#>>'{}')::uuid FROM e01_host_state WHERE name='extraction'))->>'currentDocumentRevision','4','reopen discovers current canonical revision while retaining original intake version');
RESET ROLE;
CREATE TEMP TABLE e01_host_original_rows AS SELECT id,to_jsonb(w)-'chat_source_link' AS original FROM public.paige_durable_work w;
CREATE TEMP TABLE e01_host_turn_count AS SELECT count(*) total FROM public.paige_chat_turns;
CREATE TEMP TABLE e01_host_turn_work AS SELECT id,work_id FROM public.paige_chat_turns;
CREATE TEMP TABLE e01_host_thread_count AS SELECT count(*) total FROM public.paige_chat_threads;
CREATE FUNCTION pg_temp.e01_host_save(turn_id uuid DEFAULT NULL,cas integer DEFAULT 0,hash text DEFAULT NULL,new_thread boolean DEFAULT false) RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
 SELECT public.save_paige_chat_knowledge_link('e0100200-0000-4000-8000-000000000001',auth.uid(),
 CASE WHEN new_thread THEN NULL ELSE (SELECT (value#>>'{}')::uuid FROM e01_host_state WHERE name='thread') END,turn_id,(SELECT (value#>>'{}')::uuid FROM e01_host_state WHERE name='work'),
 'e0100300-0000-4000-8000-000000000080',4,'e0100600-0000-4000-8000-000000000080',coalesce(hash,encode(sha256(convert_to('Original host source','UTF8')),'hex')),cas) $$;
CREATE FUNCTION pg_temp.e01_host_inspect() RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
 SELECT public.inspect_paige_chat_knowledge_link('e0100200-0000-4000-8000-000000000001',auth.uid(),
 (SELECT (value#>>'{}')::uuid FROM e01_host_state WHERE name='thread'),(SELECT (value#>>'{}')::uuid FROM e01_host_state WHERE name='work')) $$;
SAVEPOINT e01_host_first_value;
SET LOCAL ROLE authenticated;
SELECT ok(pg_temp.e01_host_save(NULL,0,NULL,true)#>>'{reference,threadId}' IS NOT NULL,'brand-new Chat Save uses the original real conversation constructor');
SELECT ok(pg_temp.e01_host_save(NULL,0,NULL,true)#>'{reference,turnId}'='null'::jsonb,'new conversation source link never appends a fictional message');
SELECT is(public.inspect_paige_chat_knowledge_link('e0100200-0000-4000-8000-000000000001',auth.uid(),NULL,
 (SELECT (value#>>'{}')::uuid FROM e01_host_state WHERE name='work')),pg_temp.e01_host_save(NULL,0,NULL,true),'lost conversation creation acknowledgment inspects same original work identity');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.paige_chat_threads),(SELECT total FROM e01_host_thread_count),'publication observers reuse the original intake conversation without a duplicate');
ROLLBACK TO SAVEPOINT e01_host_first_value;
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.e01_host_inspect(),' {"status":"absent_at_read"}'::jsonb,'host inspection is absence before explicit Save');
SELECT is(pg_temp.e01_error($$SELECT pg_temp.e01_host_save(NULL,0,repeat('a',64))$$),'40001','mismatched original File hash is refused');
SELECT is(pg_temp.e01_host_save()#>>'{reference,linkRevision}','1','staged attachment native host CAS is saved once');
SELECT ok(pg_temp.e01_host_inspect()#>'{reference,turnId}'='null'::jsonb,'pending attachment never invents a persisted message');
SELECT is(pg_temp.e01_host_save(),pg_temp.e01_host_inspect(),'same-intent replay reconciles authoritative original annotation');
SELECT is(pg_temp.e01_error($$SELECT pg_temp.e01_host_save((SELECT (value->>'turn_id')::uuid FROM e01_host_state WHERE name='admission'),0)$$),'40001','stale host CAS cannot adopt a message');
SELECT is(pg_temp.e01_host_save((SELECT (value->>'turn_id')::uuid FROM e01_host_state WHERE name='admission'),1)#>>'{reference,linkRevision}','2','real original admitted user turn attaches with native CAS');
SELECT is(pg_temp.e01_host_inspect()#>>'{reference,extractionIntentId}','e0100600-0000-4000-8000-000000000080','source extraction intent is native resolved');
SELECT is(pg_temp.e01_host_inspect()#>>'{reference,publicationIntentId}','e0100700-0000-4000-8000-000000000080','publication intent is distinct and native resolved');
SELECT is(pg_temp.e01_host_inspect()#>>'{reference,generationId}',(SELECT value#>>'{}' FROM e01_host_state WHERE name='work'),'canonical generation is the actual original publication work');
SELECT ok(pg_temp.e01_host_inspect()#>>'{reference,publicationOutcome}' IN ('capability_succeeded','capability_completed_unrecorded'),'actual original publication outcome is retained without invented receipt identity');
SELECT is(jsonb_array_length(public.list_paige_chat_knowledge_links('e0100200-0000-4000-8000-000000000001',auth.uid(),
 (SELECT (value#>>'{}')::uuid FROM e01_host_state WHERE name='thread'))->'items'),1,'permission-aware reload finds exactly one original saved source');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.paige_chat_turns),(SELECT total FROM e01_host_turn_count),'host linking appends no synthetic message');
SELECT is((SELECT count(*)::integer FROM public.paige_chat_turns t FULL JOIN e01_host_turn_work b USING(id)
 WHERE b.id IS NULL OR t.id IS NULL OR t.work_id IS DISTINCT FROM b.work_id),0,'every original message Work binding remains unchanged');
SELECT is((SELECT count(*)::integer FROM public.paige_durable_work w FULL JOIN e01_host_original_rows b USING(id)
 WHERE b.id IS NULL OR w.id IS NULL OR to_jsonb(w)-'chat_source_link' IS DISTINCT FROM b.original),0,'ALL original Work identity/version/authority/payload/receipt/worker fields conserved');
SAVEPOINT e01_host_source;
UPDATE public.tenant_knowledge_docs SET summary='Different source revision' WHERE id='e0100300-0000-4000-8000-000000000080';
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.e01_host_inspect(),' {"status":"recorded","current":false,"reason":"source_unavailable_or_changed"}'::jsonb,'source revision drift withholds details on native reopen');
SELECT is(pg_temp.e01_error($$SELECT pg_temp.e01_host_save()$$),'40001','changed-source host replay cannot write again');
ROLLBACK TO SAVEPOINT e01_host_source;
SAVEPOINT e01_host_private;
SELECT is(pg_temp.e01_error($$UPDATE public.paige_chat_threads SET audience='customer_private' WHERE id=(SELECT (value#>>'{}')::uuid FROM e01_host_state WHERE name='thread')$$),'42501','original audience guard refuses manufacturing a private thread from the admitted workspace turn');
ROLLBACK TO SAVEPOINT e01_host_private;
SAVEPOINT e01_host_actor;
SET LOCAL ROLE authenticated;
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000004');
SELECT is(pg_temp.e01_error('SELECT pg_temp.e01_host_inspect()'),'42501','foreign current actor/workspace cannot inspect source');
ROLLBACK TO SAVEPOINT e01_host_actor;
SAVEPOINT e01_host_revoke;
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000001');
UPDATE public.tenant_members SET status='suspended' WHERE tenant_id='e0100200-0000-4000-8000-000000000001' AND user_id='e0100100-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000002');
SELECT is(pg_temp.e01_error('SELECT pg_temp.e01_host_inspect()'),'42501','same JWT revoked scoped Admin loses native source eligibility');
ROLLBACK TO SAVEPOINT e01_host_revoke;
SELECT is((SELECT count(*)::integer FROM e01_host_original_functions b JOIN pg_proc p USING(oid) WHERE b.definition IS DISTINCT FROM md5(pg_get_functiondef(p.oid))
 OR b.proowner<>p.proowner OR b.proconfig IS DISTINCT FROM p.proconfig OR b.proacl IS DISTINCT FROM p.proacl),0,'original Chat admission/append/Work identity/Knowledge writers and permissions remain exact');
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000001');
