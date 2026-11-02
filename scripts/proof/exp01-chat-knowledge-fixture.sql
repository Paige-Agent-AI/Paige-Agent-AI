-- Isolated dependency fixture only; NOT actual Chat admission/full schema.
ALTER TABLE public.paige_chat_threads ADD COLUMN audience text DEFAULT 'workspace',
 ADD COLUMN lens text DEFAULT 'coach',ADD COLUMN contact_id uuid,ADD COLUMN studio_session_id uuid,
 ADD COLUMN title text,ADD COLUMN consent_snapshot jsonb,ADD COLUMN auto_delete_at timestamptz,
 ADD COLUMN last_message_at timestamptz,ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE public.paige_chat_threads ALTER COLUMN id SET DEFAULT gen_random_uuid();
CREATE FUNCTION public.is_tenant_owner(a uuid,t uuid) RETURNS boolean LANGUAGE sql AS $$SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=a AND tenant_id=t AND status='active' AND is_owner)$$;
CREATE FUNCTION public.agency_can_manage_child(t uuid,a uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
ALTER TABLE public.paige_chat_turns ADD COLUMN thread_id uuid,ADD COLUMN role text,
 ADD COLUMN interactive_actor_id uuid,ADD COLUMN interactive_tenant_id uuid,
 ADD COLUMN interactive_intent_id uuid,ADD COLUMN bundle_ref jsonb;
INSERT INTO public.paige_chat_threads(id,tenant_id,caller_user_id) VALUES
 ('50000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO public.paige_chat_turns(id,thread_id,role,interactive_actor_id,interactive_tenant_id,interactive_intent_id,bundle_ref) VALUES
 ('80000000-0000-4000-8000-000000000001','50000000-0000-0000-0000-000000000001','user','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','90000000-0000-4000-8000-000000000001','{"incumbent":"preserved"}'),
 ('80000000-0000-4000-8000-000000000002','50000000-0000-0000-0000-000000000001','assistant','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','90000000-0000-4000-8000-000000000001','{}'),
 ('80000000-0000-4000-8000-000000000003','50000000-0000-0000-0000-000000000002','user','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','90000000-0000-4000-8000-000000000002','{}');
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SET ROLE service_role;
INSERT INTO public.extract_test VALUES('chat',public.test_extract('70000000-0000-4000-8000-000000000080',NULL,NULL,'Original chat source'),NULL);
UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='chat';
SELECT public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,1,'Original chat source',started->>'input_hash') FROM public.extract_test WHERE name='chat';
RESET ROLE;
SET ROLE authenticated;
SELECT public.save_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(result->>'document_id')::uuid,(result->>'work_id')::uuid,2,'Explicitly edited chat source','{"title":"Neutral reviewed source","summary":null,"category":null,"tags":[]}') FROM public.extract_test WHERE name='chat';
UPDATE public.extract_test SET started=started||jsonb_build_object('publication',public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(result->>'document_id')::uuid,(result->>'work_id')::uuid,3,'60000000-0000-4000-8000-000000000080',encode(sha256(convert_to('Explicitly edited chat source','UTF8')),'hex'))) WHERE name='chat';
RESET ROLE;
DO $$ DECLARE w uuid:=(SELECT (started#>>'{publication,work_id}')::uuid FROM public.extract_test WHERE name='chat'); s jsonb:=public.start_knowledge_publication(w); c jsonb; BEGIN
 FOR c IN SELECT * FROM jsonb_array_elements(s->'chunks') LOOP
  PERFORM public.stage_knowledge_publication(w,s->>'server_key',(s->>'attempt')::integer,(s->>'revision')::integer,
   jsonb_build_array(jsonb_build_object('index',(c->>'index')::integer,'sha256',c->>'sha256','embedding',(SELECT jsonb_agg(0.5 ORDER BY n) FROM generate_series(1,1024)n))));
 END LOOP;
 PERFORM public.complete_knowledge_publication(w,s->>'server_key',(s->>'attempt')::integer,(s->>'revision')::integer);
END $$;
CREATE FUNCTION public.test_chat_work() RETURNS uuid LANGUAGE sql AS $$ SELECT (started#>>'{publication,work_id}')::uuid FROM public.extract_test WHERE name='chat' $$;
CREATE FUNCTION public.test_chat_save(turn_id uuid DEFAULT NULL,rev integer DEFAULT 0,sha text DEFAULT NULL,thread_id uuid DEFAULT '50000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
 SELECT public.save_paige_chat_knowledge_link('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',thread_id,turn_id,
 public.test_chat_work(),(result->>'document_id')::uuid,4,'70000000-0000-4000-8000-000000000080',coalesce(sha,encode(sha256(convert_to('Original chat source','UTF8')),'hex')),rev) FROM public.extract_test WHERE name='chat' $$;
CREATE FUNCTION public.test_chat_inspect() RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
 SELECT public.inspect_paige_chat_knowledge_link('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',public.test_chat_work()) $$;
GRANT EXECUTE ON FUNCTION public.test_chat_work(),public.test_chat_save(uuid,integer,text,uuid),public.test_chat_inspect() TO authenticated;
-- A new neutral binary envelope through the SAME original source-bound native
-- functions. Raw PDF bytes and edited canonical text deliberately differ.
SET ROLE service_role;
INSERT INTO public.extract_test VALUES('chat-binary',public.submit_knowledge_extraction('10000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000001','70000000-0000-4000-8000-000000000081',NULL,NULL,'Binary host proof',NULL,public.test_binary_binding()),NULL);
UPDATE public.extract_test SET started=public.start_knowledge_extraction((result->>'work_id')::uuid) WHERE name='chat-binary';
SELECT public.complete_knowledge_extraction((result->>'work_id')::uuid,started->>'server_key',1,1,'Acme Services shall deliver a report.',started->>'input_hash',public.test_binary_manifest()-'extracted_content') FROM public.extract_test WHERE name='chat-binary';
RESET ROLE;
SET ROLE authenticated;
SELECT public.save_tenant_knowledge_review('00000000-0000-0000-0000-000000000001',(result->>'document_id')::uuid,(result->>'work_id')::uuid,2,'A reviewed binary agreement.','{"title":"Binary host proof","summary":null,"category":null,"tags":[]}') FROM public.extract_test WHERE name='chat-binary';
UPDATE public.extract_test SET started=started||jsonb_build_object('publication',public.submit_tenant_knowledge_publication('00000000-0000-0000-0000-000000000001',(result->>'document_id')::uuid,(result->>'work_id')::uuid,3,'60000000-0000-4000-8000-000000000081',encode(sha256(convert_to('A reviewed binary agreement.','UTF8')),'hex'))) WHERE name='chat-binary';
RESET ROLE;
DO $$ DECLARE w uuid:=(SELECT (started#>>'{publication,work_id}')::uuid FROM public.extract_test WHERE name='chat-binary'); s jsonb:=public.start_knowledge_publication(w); c jsonb; BEGIN
 FOR c IN SELECT * FROM jsonb_array_elements(s->'chunks') LOOP
  PERFORM public.stage_knowledge_publication(w,s->>'server_key',(s->>'attempt')::integer,(s->>'revision')::integer,
   jsonb_build_array(jsonb_build_object('index',(c->>'index')::integer,'sha256',c->>'sha256','embedding',(SELECT jsonb_agg(0.5 ORDER BY n) FROM generate_series(1,1024)n))));
 END LOOP;
 PERFORM public.complete_knowledge_publication(w,s->>'server_key',(s->>'attempt')::integer,(s->>'revision')::integer);
END $$;
CREATE FUNCTION public.test_chat_binary_save(sha text DEFAULT NULL,thread_id uuid DEFAULT '50000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
 SELECT public.save_paige_chat_knowledge_link('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',thread_id,NULL,
 (started#>>'{publication,work_id}')::uuid,(result->>'document_id')::uuid,4,'70000000-0000-4000-8000-000000000081',coalesce(sha,public.test_binary_binding()->>'sha256'),0) FROM public.extract_test WHERE name='chat-binary' $$;
GRANT EXECUTE ON FUNCTION public.test_chat_binary_save(text,uuid) TO authenticated;
SET ROLE service_role;
INSERT INTO public.extract_test VALUES('chat-pending',public.test_extract('70000000-0000-4000-8000-000000000082',NULL,NULL,'Pending original source'),NULL);
RESET ROLE;
CREATE FUNCTION public.test_chat_stage(name_selected text DEFAULT 'chat-pending',thread_id uuid DEFAULT '50000000-0000-0000-0000-000000000001',turn_id uuid DEFAULT NULL,rev integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
 SELECT public.stage_paige_chat_knowledge_intake('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',thread_id,turn_id,
 (result->>'work_id')::uuid,(result->>'document_id')::uuid,1,
 CASE WHEN name_selected='chat' THEN '70000000-0000-4000-8000-000000000080'::uuid ELSE '70000000-0000-4000-8000-000000000082'::uuid END,
 encode(sha256(convert_to(CASE WHEN name_selected='chat' THEN 'Original chat source' ELSE 'Pending original source' END,'UTF8')),'hex'),rev)
 FROM public.extract_test WHERE name=name_selected $$;
GRANT EXECUTE ON FUNCTION public.test_chat_stage(text,uuid,uuid,integer) TO authenticated;
