-- LOCAL synthetic actor ports in original Knowledge fixture. These are not
-- authenticated customer identities, domain-write approval or a new source home.
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000001' WHERE user_id=auth.uid();
UPDATE public.tenant_members SET status='active' WHERE user_id=auth.uid();
UPDATE public.test_members SET active=true WHERE user_id=auth.uid();
INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,record_state) VALUES
 ('20000000-0000-4000-8000-000000000088','00000000-0000-0000-0000-000000000001','Synthetic quoted source','A'||chr(128512)||'B','canonical');
CREATE TABLE public.test_source_binding AS SELECT jsonb_build_object('contractVersion',1,'tenantId',tenant_id,'documentId',id,'revision',revision,'contentSha256',encode(sha256(convert_to(content,'UTF8')),'hex')) AS ref
 FROM public.tenant_knowledge_docs WHERE id='20000000-0000-4000-8000-000000000088';
CREATE FUNCTION public.test_source_binding(excerpts jsonb DEFAULT NULL,reference jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.lock_knowledge_source_evidence(auth.uid(),'00000000-0000-0000-0000-000000000001',coalesce(reference,(SELECT ref FROM public.test_source_binding)),
  coalesce(excerpts,jsonb_build_array(jsonb_build_object('start',1,'end',3,'text',chr(128512))))) $$;
SELECT public.test_assert(public.test_source_binding()->>'status'='available','current permitted source/version/SHA and literal quote accepted');
SELECT public.test_assert(public.test_source_binding()->>'factConfirmation'='not_asserted','source evidence never supplies domain fact approval');
SELECT public.test_assert(public.test_source_binding()->>'originalFileEvidence'='unavailable','canonical text is not raw file provenance');
SELECT public.test_denied($q$SELECT public.test_source_binding('[{"start":2,"end":3,"text":"B"}]')$q$,'KNOWLEDGE_SOURCE_QUOTE_CHANGED');
SELECT public.test_denied($q$SELECT public.test_source_binding('[]',(SELECT ref||'{"revision":999}' FROM public.test_source_binding))$q$,'KNOWLEDGE_SOURCE_CHANGED');
SELECT public.test_denied($q$SELECT public.test_source_binding('[]',(SELECT ref||jsonb_build_object('contentSha256',repeat('0',64)) FROM public.test_source_binding))$q$,'KNOWLEDGE_SOURCE_CHANGED');
SELECT public.test_denied($q$SELECT public.test_source_binding('[]',(SELECT ref||'{"documentId":"20000000-0000-0000-0000-000000000002"}' FROM public.test_source_binding))$q$,'KNOWLEDGE_SOURCE_UNAVAILABLE');
SELECT public.test_denied($q$SELECT public.lock_knowledge_source_evidence('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001',(SELECT ref FROM public.test_source_binding),'[]')$q$,'KNOWLEDGE_SOURCE_SCOPE_CHANGED');
UPDATE public.tenant_members SET status='inactive' WHERE user_id=auth.uid();
SELECT public.test_denied($q$SELECT public.test_source_binding()$q$,'KNOWLEDGE_SCOPE_CHANGED');
UPDATE public.tenant_members SET status='active' WHERE user_id=auth.uid();
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000002' WHERE user_id=auth.uid();
SELECT public.test_denied($q$SELECT public.test_source_binding()$q$,'KNOWLEDGE_SCOPE_CHANGED');
UPDATE public.profiles SET active_tenant_id='00000000-0000-0000-0000-000000000001' WHERE user_id=auth.uid();
SELECT public.test_assert(public.test_source_binding()->>'status'='available','fresh own-scope read works after scope restoration');
SELECT public.test_assert(NOT has_function_privilege('authenticated','public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb)','EXECUTE'),
 'source-binding helper has no public or service front door');

SELECT public.test_denied($q$SELECT public.test_source_binding('{}')$q$,'KNOWLEDGE_SOURCE_INVALID');
SELECT public.test_denied($q$SELECT public.test_source_binding('[null]')$q$,'KNOWLEDGE_SOURCE_INVALID');
SELECT public.test_denied($q$SELECT public.test_source_binding('[{"start":"1","end":3,"text":"x"}]')$q$,'KNOWLEDGE_SOURCE_INVALID');
SELECT public.test_denied($q$SELECT public.test_source_binding('[{"start":1.5,"end":3,"text":"x"}]')$q$,'KNOWLEDGE_SOURCE_INVALID');
SELECT public.test_denied($q$SELECT public.test_source_binding('[]',(SELECT ref||'{"approval":true}' FROM public.test_source_binding))$q$,'KNOWLEDGE_SOURCE_INVALID');
SELECT public.test_denied($q$SELECT public.test_source_binding('[]',(SELECT ref||jsonb_build_object('contentSha256',repeat('a',32)) FROM public.test_source_binding))$q$,'KNOWLEDGE_SOURCE_INVALID');
SELECT public.test_denied($q$SELECT public.test_source_binding((SELECT jsonb_agg(jsonb_build_object('start',0,'end',1,'text','A')) FROM generate_series(1,21)))$q$,'KNOWLEDGE_SOURCE_INVALID');

UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=auth.uid();
SELECT public.test_denied($q$SELECT public.test_source_binding()$q$,'KNOWLEDGE_SCOPE_CHANGED');
UPDATE auth.users SET banned_until=NULL,deleted_at=now() WHERE id=auth.uid();
SELECT public.test_denied($q$SELECT public.test_source_binding()$q$,'KNOWLEDGE_SCOPE_CHANGED');
UPDATE auth.users SET deleted_at=NULL WHERE id=auth.uid();
UPDATE public.tenants SET status='inactive' WHERE id='00000000-0000-0000-0000-000000000001';
SELECT public.test_denied($q$SELECT public.test_source_binding()$q$,'KNOWLEDGE_SCOPE_CHANGED');
UPDATE public.tenants SET status='active' WHERE id='00000000-0000-0000-0000-000000000001';
UPDATE public.tenant_members SET role='admin' WHERE user_id=auth.uid();
SELECT public.test_assert(public.test_source_binding()->>'status'='available','existing Admin source-read authority accepted');
UPDATE public.tenant_members SET role='member' WHERE user_id=auth.uid();
SELECT public.test_assert(public.test_source_binding()->>'status'='available','existing member source-read authority accepted without domain-write grant');
SELECT public.test_assert((SELECT array_agg(k ORDER BY k)=ARRAY['excerpts','factConfirmation','originalFileEvidence','reference','status','title'] FROM jsonb_object_keys(public.test_source_binding()) k),
 'readback exposes only the existing minimized text-evidence fields');

BEGIN;
UPDATE public.tenant_knowledge_docs SET content='Changed synthetic source' WHERE id='20000000-0000-4000-8000-000000000088';
SELECT public.test_denied($q$SELECT public.test_source_binding()$q$,'KNOWLEDGE_SOURCE_CHANGED');
ROLLBACK;
SELECT public.delete_tenant_knowledge('00000000-0000-0000-0000-000000000001','20000000-0000-4000-8000-000000000088',(SELECT revision FROM public.tenant_knowledge_docs WHERE id='20000000-0000-4000-8000-000000000088'));
SELECT public.test_denied($q$SELECT public.test_source_binding()$q$,'KNOWLEDGE_SOURCE_UNAVAILABLE');
