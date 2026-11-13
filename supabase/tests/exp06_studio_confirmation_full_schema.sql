-- REAL full-schema composition proof. Run ONLY through the existing disposable
-- local Supabase database-contract runner after candidate migrations/grants.
-- No auth/authority/function body is replaced. All SQL fixture data rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='90s';
SET LOCAL timezone='UTC';
CREATE TEMP TABLE e06_full_assertions(label text);
GRANT INSERT,SELECT ON e06_full_assertions TO authenticated,anon,service_role;
CREATE FUNCTION pg_temp.e06_assert(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'EXP06_FULL_SCHEMA_FAIL: %',label; END IF;
 INSERT INTO e06_full_assertions VALUES(label);
END $$;
CREATE FUNCTION pg_temp.e06_refuses(command text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE; END;
 PERFORM pg_temp.e06_assert(actual=expected,label);
END $$;
CREATE FUNCTION pg_temp.e06_actor(actor uuid) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',actor::text,true),
  set_config('request.jwt.claim.role','authenticated',true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) $$;
CREATE FUNCTION pg_temp.e06_server() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),
  set_config('request.jwt.claims','{"role":"service_role"}',true) $$;

-- Refuse a port/stub database instead of silently installing missing prerequisites.
SELECT pg_temp.e06_assert(
 to_regprocedure('public._paige_confirmation_studio_source_immutable()') IS NOT NULL
 AND to_regprocedure('public.studio_page_save_source(uuid,uuid,uuid)') IS NOT NULL
 AND to_regprocedure('public.read_weekly_commitment_draft(uuid)') IS NOT NULL,
 'candidate35 original source/wrapper prerequisites installed');
SELECT pg_temp.e06_assert((SELECT md5(pg_get_functiondef(oid))='7858e187f58d2c824b70093e0fcc8ea1'
 AND NOT prosecdef AND proowner='postgres'::regrole AND proacl::text='{postgres=X/postgres}'
 AND proconfig=ARRAY['search_path=""']::text[] FROM pg_proc
 WHERE oid='public._paige_confirmation_studio_source_immutable()'::regprocedure),
 'exact invoker source guard/owner/ACL/search_path installed');
SELECT pg_temp.e06_assert((SELECT md5(pg_get_functiondef(oid))='9a1e676ad5daab60e9c9d79c6df8bbe4'
 FROM pg_proc WHERE oid='public.handle_new_user()'::regprocedure)
 AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgenabled='O'
  AND tgfoid='public.handle_new_user()'::regprocedure AND NOT tgisinternal)
 AND (SELECT md5(pg_get_functiondef(oid))='c960dc79a2c86f63045aa16e4bd01e2f'
 FROM pg_proc WHERE oid='public.guard_operator_account_archive()'::regprocedure),
 'real original signup shell and tenant lifecycle guards present; no fixture ports');
SELECT pg_temp.e06_assert((SELECT md5(pg_get_functiondef(oid))='b58fbbc9b18a40de26fc85e5937d2298'
 FROM pg_proc WHERE oid='public.growth_page_upsert(uuid,text,text,jsonb,jsonb,jsonb,uuid,jsonb)'::regprocedure)
 AND (SELECT md5(pg_get_functiondef(oid))='414256973e5858b5ace8f3d38e57d725'
 FROM pg_proc WHERE oid='public.save_artifact_version(uuid,text,uuid,uuid)'::regprocedure),
 'complete original page/version writers preserved on full schema');
CREATE TEMP TABLE e06_full_catalog AS
 SELECT p.oid,to_jsonb(p) metadata FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','auth','private');
CREATE TEMP TABLE e06_full_fixture(
 actor_a uuid,actor_b uuid,tenant_a uuid,tenant_b uuid,tag text,session_id uuid,thread_id uuid,
 source jsonb,args jsonb,proposal_id uuid,legacy_id uuid,foreign_id uuid,weekly_id uuid,
 issued_nonce uuid,claim_nonce uuid,fingerprint text,page_id uuid);
INSERT INTO e06_full_fixture(actor_a,actor_b,tenant_a,tenant_b,tag,issued_nonce,claim_nonce,fingerprint,args)
 VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  'e06full-'||replace(gen_random_uuid()::text,'-',''),gen_random_uuid(),gen_random_uuid(),
  left(replace(gen_random_uuid()::text,'-',''),16),
  '{"slug":"full-schema-page","title":"Original full-schema page","blocks":[{"type":"hero","title":"Actual reviewed draft"}]}');
GRANT SELECT(actor_a,actor_b,tenant_a,tenant_b,tag,session_id,thread_id,proposal_id,legacy_id,foreign_id,weekly_id,
 issued_nonce,claim_nonce,fingerprint,page_id) ON e06_full_fixture TO authenticated,service_role;
GRANT SELECT(source,args),UPDATE(proposal_id) ON e06_full_fixture TO service_role;
SELECT pg_temp.e06_server();
DO $fixture$
DECLARE f e06_full_fixture;
BEGIN
 SELECT * INTO f FROM e06_full_fixture;
 -- Original AFTER INSERT handle_new_user creates only profile shells. Do not
 -- replace it, delete preexisting rows, invent roles or bypass consent guards.
 INSERT INTO auth.users(id,email) VALUES(f.actor_a,f.tag||'-a@example.invalid'),(f.actor_b,f.tag||'-b@example.invalid');
 INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features)
  VALUES(f.tenant_a,f.tag||'-a','EXP06 isolated full-schema A','active','standalone','EXA','{}'),
        (f.tenant_b,f.tag||'-b','EXP06 isolated full-schema B','active','standalone','EXB','{}');
 INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner)
  VALUES(f.tenant_a,f.actor_a,'owner','active',true),(f.tenant_b,f.actor_b,'owner','active',true);
 UPDATE public.profiles SET active_tenant_id=f.tenant_a WHERE user_id=f.actor_a;
 UPDATE public.profiles SET active_tenant_id=f.tenant_b WHERE user_id=f.actor_b;
 PERFORM pg_temp.e06_assert((SELECT count(*)=2 FROM public.profiles WHERE user_id IN (f.actor_a,f.actor_b))
  AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id IN (f.actor_a,f.actor_b)
   AND role::text IN ('super_admin','platform_admin','developer')),
  'ordinary fixture users provision through original triggers without platform roles');
END $fixture$;
DO $source$
DECLARE f e06_full_fixture; started jsonb; observed jsonb; audit_count bigint; version_count bigint;
BEGIN
 SELECT * INTO f FROM e06_full_fixture;
 PERFORM pg_temp.e06_actor(f.actor_a);
 SET LOCAL ROLE authenticated;
 started:=public.studio_start_project(f.tenant_a,gen_random_uuid(),'Full-schema private confirmation',
  '{"target":{"kind":"workspace"},"values":{"offers":"Original observed source"}}');
 observed:=public.studio_page_save_source(f.tenant_a,(started->>'session_id')::uuid,NULL);
 RESET ROLE;
 PERFORM pg_temp.e06_assert(started->'created'='true' AND observed->'ok'='true'
  AND observed->>'session_id'=started->>'session_id' AND observed->>'tenant_id'=f.tenant_a::text
  AND observed->'page_id'='null'::jsonb AND observed->'conversion'='null'::jsonb,
  'actual authenticated original start/source reads complete native expected state');
 UPDATE e06_full_fixture SET session_id=(started->>'session_id')::uuid,thread_id=(started->>'thread_id')::uuid,
  source=observed,args=jsonb_set(args,'{slug}',to_jsonb(f.tag||'-page'));
 SELECT count(*) INTO audit_count FROM public.audit_logs WHERE entity_id=(started->>'session_id')::uuid;
 SELECT count(*) INTO version_count FROM public.studio_artifact_versions WHERE session_id=(started->>'session_id')::uuid;
 SET LOCAL ROLE authenticated;
 observed:=public.studio_page_save_source(f.tenant_a,(started->>'session_id')::uuid,NULL);
 RESET ROLE;
 PERFORM pg_temp.e06_assert((SELECT count(*)=audit_count FROM public.audit_logs WHERE entity_id=(started->>'session_id')::uuid)
  AND (SELECT count(*)=version_count FROM public.studio_artifact_versions WHERE session_id=(started->>'session_id')::uuid),
  'source observation does not author page/version/audit or approve execution');
END $source$;

-- Only this original service INSERT stamps source, alongside unchanged args.
SELECT pg_temp.e06_server();
SET LOCAL ROLE service_role;
WITH p AS (
 INSERT INTO public.paige_pending_confirmations(user_id,tenant_id,thread_id,scoped_client_id,tool_name,
  fingerprint,args,summary,issued_in_request,server_issued_at,studio_page_save_source)
 SELECT actor_a,tenant_a,thread_id,NULL,'growth_page_save',fingerprint,args,'Original Studio approval',
  issued_nonce,clock_timestamp(),source FROM e06_full_fixture RETURNING id
) UPDATE e06_full_fixture SET proposal_id=(SELECT id FROM p);
SELECT pg_temp.e06_assert((SELECT p.args=f.args AND p.studio_page_save_source=f.source
 AND NOT(p.args ? 'studio_page_save_source') FROM public.paige_pending_confirmations p JOIN e06_full_fixture f ON f.proposal_id=p.id),
 'full-schema service INSERT retains exact native source separately from unchanged args');
RESET ROLE;
DO $extra_rows$
DECLARE f e06_full_fixture; legacy uuid; foreign_row uuid; weekly uuid;
BEGIN
 SELECT * INTO f FROM e06_full_fixture;
 INSERT INTO public.paige_pending_confirmations(user_id,tenant_id,thread_id,tool_name,fingerprint,args,summary,issued_in_request,server_issued_at)
  VALUES(f.actor_a,f.tenant_a,f.thread_id,'growth_page_save',left(replace(gen_random_uuid()::text,'-',''),16),'{}','Legacy NULL source',gen_random_uuid(),clock_timestamp()) RETURNING id INTO legacy;
 INSERT INTO public.paige_pending_confirmations(user_id,tenant_id,tool_name,fingerprint,args,summary)
  VALUES(f.actor_b,f.tenant_b,'other_tool',left(replace(gen_random_uuid()::text,'-',''),16),'{}','Foreign actor original row') RETURNING id INTO foreign_row;
 INSERT INTO public.paige_pending_confirmations(user_id,tenant_id,tool_name,fingerprint,args,summary,issued_in_request,server_issued_at)
  VALUES(f.actor_a,f.tenant_a,'weekly_commitment_draft',left(replace(gen_random_uuid()::text,'-',''),16),
   jsonb_build_object('_request_id',gen_random_uuid(),'_name','Native weekly projection','_weekday',1,
    '_local_time','09:00','_timezone','America/New_York'),'Specialized native wrapper',gen_random_uuid(),clock_timestamp()) RETURNING id INTO weekly;
 UPDATE e06_full_fixture SET legacy_id=legacy,foreign_id=foreign_row,weekly_id=weekly;
END $extra_rows$;
SELECT pg_temp.e06_actor(actor_a) FROM e06_full_fixture;
SET LOCAL ROLE authenticated;
SELECT pg_temp.e06_assert((SELECT count(*)=3 FROM (
 SELECT id,user_id,tenant_id,thread_id,scoped_client_id,tool_name,fingerprint,args,summary,created_at,expires_at,
  consumed_at,issued_in_request,server_issued_at,claimed_in_request FROM public.paige_pending_confirmations
 WHERE id IN (SELECT proposal_id FROM e06_full_fixture UNION ALL SELECT legacy_id FROM e06_full_fixture
  UNION ALL SELECT foreign_id FROM e06_full_fixture UNION ALL SELECT weekly_id FROM e06_full_fixture)) old_fields),
 'real authenticated role retains all15 fields and owner-only RLS on populated full schema');
SELECT pg_temp.e06_refuses('select studio_page_save_source from public.paige_pending_confirmations','42501','authenticated private column denied');
SELECT pg_temp.e06_refuses('select * from public.paige_pending_confirmations','42501','authenticated star denied');
SELECT pg_temp.e06_refuses('select to_jsonb(p) from public.paige_pending_confirmations p','42501','authenticated whole-row serialization denied');
SELECT pg_temp.e06_refuses('update public.paige_pending_confirmations set args=''{}'' where false','42501','authenticated args UPDATE denied');
SELECT pg_temp.e06_refuses('delete from public.paige_pending_confirmations where false','42501','authenticated DELETE denied');
SELECT pg_temp.e06_refuses('insert into public.paige_pending_confirmations(user_id,tool_name,fingerprint,args,summary) values(auth.uid(),''growth_page_save'',''035f000000000001'',''{}'',''forged'')',
 '42501','authenticated original INSERT denied');
SELECT pg_temp.e06_assert((SELECT public.read_weekly_commitment_draft(weekly_id)->>'phase'='awaiting_approval'
 AND NOT(public.read_weekly_commitment_draft(weekly_id) ? 'studio_page_save_source') FROM e06_full_fixture),
 'actual native whole-row wrapper closure returns only its original specialized projection');
SELECT pg_temp.e06_refuses('select public._weekly_draft_proposal((select weekly_id from e06_full_fixture))','42501','native whole-row helper remains private');
RESET ROLE;
SELECT pg_temp.e06_actor(actor_b) FROM e06_full_fixture;
SET LOCAL ROLE authenticated;
SELECT pg_temp.e06_assert((SELECT count(*)=1 FROM public.paige_pending_confirmations
 WHERE id IN (SELECT proposal_id FROM e06_full_fixture UNION ALL SELECT foreign_id FROM e06_full_fixture)),
 'foreign authenticated caller sees only its own original row');
RESET ROLE;
SELECT pg_temp.e06_server();
SET LOCAL ROLE anon;
SELECT pg_temp.e06_refuses('select studio_page_save_source from public.paige_pending_confirmations','42501','anon private field denied');
SELECT pg_temp.e06_refuses('select * from public.paige_pending_confirmations','42501','anon star denied');
SELECT pg_temp.e06_refuses('select args from public.paige_pending_confirmations','42501','anon incumbent field denied');
RESET ROLE;

-- Exercise every frozen source/binding field under actual service role.
SELECT pg_temp.e06_server();
SET LOCAL ROLE service_role;
DO $immutability$
DECLARE f record; assignment text;
BEGIN
 SELECT proposal_id,legacy_id,source INTO f FROM e06_full_fixture;
 PERFORM pg_temp.e06_refuses(format('update public.paige_pending_confirmations set studio_page_save_source=NULL where id=%L',f.proposal_id),'40001','source clearing refused');
 PERFORM pg_temp.e06_refuses(format('update public.paige_pending_confirmations set studio_page_save_source=''{"changed":true}'' where id=%L',f.proposal_id),'40001','source rebinding refused');
 PERFORM pg_temp.e06_refuses(format('update public.paige_pending_confirmations set studio_page_save_source=%L where id=%L',f.source,f.legacy_id),'40001','NULL legacy source cannot be blessed later');
 FOREACH assignment IN ARRAY ARRAY['id=gen_random_uuid()','user_id=gen_random_uuid()','tenant_id=gen_random_uuid()',
  'thread_id=gen_random_uuid()','scoped_client_id=gen_random_uuid()','tool_name=''other_tool''',
  'fingerprint=''035f000000000002''','args=''{"changed":true}''','issued_in_request=gen_random_uuid()',
  'server_issued_at=server_issued_at+interval ''1 second'''] LOOP
  PERFORM pg_temp.e06_refuses(format('update public.paige_pending_confirmations set %s where id=%L',assignment,f.proposal_id),'40001','original binding immutable: '||split_part(assignment,'=',1));
 END LOOP;
 UPDATE public.paige_pending_confirmations SET expires_at=expires_at+interval '1 minute',claimed_in_request=gen_random_uuid() WHERE id=f.proposal_id;
 PERFORM pg_temp.e06_assert((SELECT studio_page_save_source=f.source FROM public.paige_pending_confirmations WHERE id=f.proposal_id),
  'unchanged source permits original expiry/claim marker updates');
END $immutability$;
WITH refused AS (
 UPDATE public.paige_pending_confirmations p SET consumed_at=clock_timestamp() FROM e06_full_fixture f
 WHERE p.id=f.proposal_id AND p.user_id=f.actor_a AND p.tenant_id=f.tenant_a AND p.thread_id=f.thread_id
  AND p.scoped_client_id IS NULL AND p.tool_name='growth_page_save' AND p.fingerprint=f.fingerprint
  AND p.issued_in_request=f.issued_nonce AND p.issued_in_request<>f.issued_nonce
  AND p.issued_in_request IS NOT NULL AND p.server_issued_at IS NOT NULL AND p.consumed_at IS NULL AND p.expires_at>clock_timestamp()
 RETURNING p.id)
SELECT pg_temp.e06_assert((SELECT count(*)=0 FROM refused),'same-request original claim refuses before consumption');
WITH claimed AS (
 UPDATE public.paige_pending_confirmations p SET consumed_at=clock_timestamp() FROM e06_full_fixture f
 WHERE p.id=f.proposal_id AND p.user_id=f.actor_a AND p.tenant_id=f.tenant_a AND p.thread_id=f.thread_id
  AND p.scoped_client_id IS NULL AND p.tool_name='growth_page_save' AND p.fingerprint=f.fingerprint
  AND p.issued_in_request=f.issued_nonce AND p.issued_in_request<>f.claim_nonce
  AND p.issued_in_request IS NOT NULL AND p.server_issued_at IS NOT NULL AND p.consumed_at IS NULL AND p.expires_at>clock_timestamp()
 RETURNING p.id,p.args,p.studio_page_save_source)
SELECT pg_temp.e06_assert((SELECT count(*)=1 AND bool_and(c.args=f.args AND c.studio_page_save_source=f.source)
 FROM claimed c CROSS JOIN e06_full_fixture f),'same original full-schema single CAS returns exact args/private source separately');
WITH repeated AS (
 UPDATE public.paige_pending_confirmations p SET consumed_at=clock_timestamp() FROM e06_full_fixture f
 WHERE p.id=f.proposal_id AND p.user_id=f.actor_a AND p.tenant_id=f.tenant_a AND p.thread_id=f.thread_id
  AND p.scoped_client_id IS NULL AND p.tool_name='growth_page_save' AND p.fingerprint=f.fingerprint
  AND p.issued_in_request=f.issued_nonce AND p.issued_in_request<>f.claim_nonce
  AND p.issued_in_request IS NOT NULL AND p.server_issued_at IS NOT NULL AND p.consumed_at IS NULL AND p.expires_at>clock_timestamp()
 RETURNING p.id)
SELECT pg_temp.e06_assert((SELECT count(*)=0 FROM repeated),'original claim UNKNOWN cannot be blindly spent twice');
UPDATE public.paige_pending_confirmations p SET args='{"ordinary":"updated"}',consumed_at=clock_timestamp(),
 claimed_in_request=gen_random_uuid(),expires_at=clock_timestamp() FROM e06_full_fixture f WHERE p.id=f.foreign_id;
SELECT pg_temp.e06_assert((SELECT p.args='{"ordinary":"updated"}'::jsonb AND p.studio_page_save_source IS NULL
 FROM public.paige_pending_confirmations p JOIN e06_full_fixture f ON p.id=f.foreign_id),'nonStudio original args/consume/claim/expiry compatibility retained');
RESET ROLE;

-- Original controller composition: private expected metadata feeds SAME native
-- page writer after the actual claim; it is never added to approved args.
DO $composition$
DECLARE f e06_full_fixture; stored_args jsonb; stored_source jsonb; saved jsonb; reopened jsonb;
 versions bigint; audits bigint; changed jsonb;
BEGIN
 SELECT * INTO f FROM e06_full_fixture;
 SELECT args,studio_page_save_source INTO stored_args,stored_source FROM public.paige_pending_confirmations
  WHERE id=f.proposal_id AND consumed_at IS NOT NULL;
 PERFORM pg_temp.e06_actor(f.actor_a);
 SET LOCAL ROLE authenticated;
 saved:=public.studio_save_page(f.tenant_a,f.session_id,stored_source->'artifact_refs',stored_source->'project_context',
  NULL,NULL,NULL,stored_args->>'slug',stored_args->>'title',stored_args->'blocks',NULL,NULL,NULL);
 RESET ROLE;
 PERFORM pg_temp.e06_assert(saved->'ok'='true' AND saved->'changed'='true' AND saved->>'version_id' IS NOT NULL,
  'claimed source composes with original page/create/link/version writer on full schema');
 UPDATE e06_full_fixture SET page_id=(saved#>>'{page,id}')::uuid;
 SELECT count(*) INTO versions FROM public.studio_artifact_versions WHERE session_id=f.session_id;
 SELECT count(*) INTO audits FROM public.audit_logs WHERE entity_id IN (f.session_id,(saved#>>'{page,id}')::uuid);
 SET LOCAL ROLE authenticated;
 reopened:=public.studio_page_save_state(f.tenant_a,f.session_id,stored_source->'artifact_refs',stored_source->'project_context',
  NULL,NULL,NULL,stored_args->>'slug',stored_args->>'title',stored_args->'blocks',NULL,NULL,NULL);
 RESET ROLE;
 PERFORM pg_temp.e06_assert(reopened->'ok'='true' AND reopened->'reconciled'='true'
  AND reopened->>'version_id'=saved->>'version_id'
  AND (SELECT count(*)=versions FROM public.studio_artifact_versions WHERE session_id=f.session_id)
  AND (SELECT count(*)=audits FROM public.audit_logs WHERE entity_id IN (f.session_id,(saved#>>'{page,id}')::uuid)),
  'unknown save reads same original page/version without replay/link/audit');
 changed:=jsonb_set(stored_source->'project_context','{values,offers}','"Changed current project"');
 SET LOCAL ROLE authenticated;
 PERFORM public.studio_set_project_context(f.tenant_a,f.session_id,changed,stored_source->'project_context');
 reopened:=public.studio_save_page(f.tenant_a,f.session_id,stored_source->'artifact_refs',stored_source->'project_context',
  NULL,NULL,NULL,stored_args->>'slug',stored_args->>'title',stored_args->'blocks',NULL,NULL,NULL);
 RESET ROLE;
 PERFORM pg_temp.e06_assert(reopened->>'code'='changed' AND
  (SELECT studio_page_save_source=stored_source FROM public.paige_pending_confirmations WHERE id=f.proposal_id),
  'changed native project refuses old approved source without refreshing original proposal');
END $composition$;

-- New features compose with the actual signup/membership/client/form sources.
CREATE TEMP TABLE e06_business_fixture(business_id uuid,long_business_id uuid);
GRANT SELECT ON e06_business_fixture TO authenticated,service_role;
DO $business_fixture$
DECLARE f e06_full_fixture; b uuid; long_b uuid;
BEGIN
 SELECT * INTO f FROM e06_full_fixture;
 PERFORM pg_temp.e06_server();
 b:=public.upsert_contact('{"entity_type":"business","entity_name":"Observed business"}',NULL,f.tenant_a,f.actor_a,'api');
 long_b:=public.upsert_contact(jsonb_build_object('entity_type','business','entity_name',repeat('B',201)),NULL,f.tenant_a,f.actor_a,'api');
 INSERT INTO e06_business_fixture VALUES(b,long_b);
END $business_fixture$;

DO $business_source$
DECLARE f e06_full_fixture; i e06_business_fixture; selected jsonb; ctx jsonb; started jsonb; token text; cnt bigint;
 request_id uuid:=gen_random_uuid(); original_session uuid; reply jsonb;
BEGIN
 SELECT * INTO f FROM e06_full_fixture; SELECT * INTO i FROM e06_business_fixture;
 PERFORM pg_temp.e06_assert(public.has_any_role(f.actor_a,ARRAY['admin','super_admin']),
  'original owner seat provisions the actual global clients-admin read class');
 PERFORM pg_temp.e06_actor(f.actor_a); SET LOCAL ROLE authenticated;
 selected:=public.studio_business_targets(f.tenant_a,'Observed',20);
 RESET ROLE;
 PERFORM pg_temp.e06_assert(selected->'ok'='true' AND jsonb_array_length(selected->'businesses')=1
  AND (SELECT array_agg(key ORDER BY key)=ARRAY['entity_name','id','updated_at'] FROM jsonb_object_keys(selected#>'{businesses,0}') key),
  'business selector returns only actual id/name/raw version under original owner-admin provisioning');
 SELECT to_jsonb(updated_at)#>>'{}' INTO token FROM public.clients WHERE id=i.business_id;
 ctx:=jsonb_build_object('target',jsonb_build_object('kind','client','reference',i.business_id,'label','Observed business'),
  'business_source',jsonb_build_object('id',i.business_id,'updated_at',token),'business_name','Observed business','values',jsonb_build_object('publicName','Authored override'));
 SET LOCAL ROLE authenticated;
 reply:=public.studio_start_project(f.tenant_a,gen_random_uuid(),'Wrong selected default',jsonb_set(ctx,'{business_name}','"Previous selected business"'));
 RESET ROLE;
 PERFORM pg_temp.e06_assert(reply->>'code'='scope_changed','new start refuses a selected default name that is not the actual business identity');
 SET LOCAL ROLE authenticated;
 started:=public.studio_start_project(f.tenant_a,request_id,'Selected actual business',ctx);
 RESET ROLE;
 original_session:=(started->>'session_id')::uuid;
 PERFORM pg_temp.e06_assert(started->'created'='true','actual business identity/version binds an original Studio project');
 SELECT count(*) INTO cnt FROM public.studio_sessions WHERE tenant_id=f.tenant_a;
 UPDATE public.clients SET entity_name='Changed business',updated_at=clock_timestamp() WHERE id=i.business_id;
 SET LOCAL ROLE authenticated;
 selected:=public.studio_start_project(f.tenant_a,gen_random_uuid(),'Stale selected business',ctx);
 reply:=public.studio_start_project(f.tenant_a,request_id,'Selected actual business',ctx);
 RESET ROLE;
 PERFORM pg_temp.e06_assert(selected->>'code'='scope_changed'
  AND (SELECT count(*)=cnt FROM public.studio_sessions WHERE tenant_id=f.tenant_a),'stale business source refuses before original start effects');
 PERFORM pg_temp.e06_assert(reply->'ok'='true' AND reply->'created'='false'
  AND reply->>'session_id'=original_session::text,'original request reopens its saved identity after business changes without a new start');
 SET LOCAL ROLE authenticated;
 reply:=public.studio_set_project_context(f.tenant_a,original_session,ctx,jsonb_set(ctx,'{values,publicName}','"Authored override"'));
 RESET ROLE;
 PERFORM pg_temp.e06_assert(reply->'ok'='true','unchanged existing context readback remains available after business changes');
 SET LOCAL ROLE authenticated;
 reply:=public.studio_set_project_context(f.tenant_a,original_session,jsonb_set(ctx,'{values,publicName}','"New authored value"'),ctx);
 RESET ROLE;
 PERFORM pg_temp.e06_assert(reply->>'code'='scope_changed'
  AND (SELECT studio_session_scratchpad->'project_context'=ctx FROM public.studio_sessions WHERE id=original_session),
  'new context write revalidates stale business identity and leaves original saved context unchanged');
 SET LOCAL ROLE authenticated;
 reply:=public.studio_project_context(f.tenant_a,original_session);
 selected:=public.studio_page_save_source(f.tenant_a,original_session,NULL);
 RESET ROLE;
 PERFORM pg_temp.e06_assert(reply->'ok'='true' AND reply->'context'=ctx AND selected->>'code'='scope_changed',
  'legacy project context reopens while a new generation/save source refuses stale selected business');
 SELECT to_jsonb(updated_at)#>>'{}' INTO token FROM public.clients WHERE id=i.long_business_id;
 ctx:=jsonb_build_object('target',jsonb_build_object('kind','prospect','reference',i.long_business_id),
  'business_source',jsonb_build_object('id',i.long_business_id,'updated_at',token),'business_name',repeat('B',201),'values','{}'::jsonb);
 SET LOCAL ROLE authenticated;
 selected:=public.studio_business_targets(f.tenant_a,repeat('B',120),20);
 started:=public.studio_start_project(f.tenant_a,gen_random_uuid(),'Long real business without label',ctx);
 RESET ROLE;
 PERFORM pg_temp.e06_assert(length(selected#>>'{businesses,0,entity_name}')=201 AND started->'created'='true',
  '201-character business remains selectable and binds without optional shortened label');
 PERFORM pg_temp.e06_actor(f.actor_b); SET LOCAL ROLE authenticated;
 selected:=public.studio_business_targets(f.tenant_a,'',20);
 RESET ROLE;
 PERFORM pg_temp.e06_assert(selected->>'code'='scope_changed','business selector refuses foreign expected tenant');
 PERFORM pg_temp.e06_actor(f.actor_a);
 UPDATE public.clients SET status='archived' WHERE id=i.business_id;
 UPDATE public.clients SET merged_at=clock_timestamp() WHERE id=i.long_business_id;
 SET LOCAL ROLE authenticated;
 selected:=public.studio_business_targets(f.tenant_a,'',20);
 RESET ROLE;
 PERFORM pg_temp.e06_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(selected->'businesses') b
  WHERE b->>'id' IN (i.business_id::text,i.long_business_id::text)),'archived and either merged marker exclude business source');
END $business_source$;

SELECT pg_temp.e06_assert(NOT EXISTS(
 SELECT 1 FROM e06_full_catalog b FULL JOIN pg_proc p ON p.oid=b.oid
 WHERE (b.oid IS NOT NULL OR p.pronamespace IN ('public'::regnamespace,'auth'::regnamespace,'private'::regnamespace))
  AND b.metadata IS DISTINCT FROM to_jsonb(p)),
 'full-schema proof preserves every original public/auth/private function body and metadata');
SELECT jsonb_build_object('proof','EXP06 full-schema SQL','passed_assertions',count(*),'fixture_lifetime','ROLLBACK',
 'auth_functions','ORIGINAL','ports_replaced',false) FROM e06_full_assertions;
ROLLBACK;
