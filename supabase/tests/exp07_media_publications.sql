-- Runs inside the proof runner's ROLLBACK transaction on the original synthetic fixture.
INSERT INTO public.marketing_content (id,tenant_id) VALUES
 ('00000000-0000-4000-8000-00000000aa71','00000000-0000-4000-8000-00000000d0a1');
SELECT set_config('test.uid','',true);
CREATE TEMP TABLE media_original_contract AS
 SELECT oid,proowner,proacl,prosecdef,proconfig,provolatile FROM pg_proc WHERE oid IN
 ('public.content_publication_bind(uuid,uuid,uuid,text,uuid,uuid,jsonb)'::regprocedure,
 'public.content_publication_list(uuid,uuid)'::regprocedure,
 'public.content_publication_record(uuid,uuid,text,text,text,text,text,jsonb)'::regprocedure);
CREATE TEMP TABLE media_attempt AS SELECT * FROM public.content_publication_bind(NULL,
 '00000000-0000-4000-8000-00000000d0a1','00000000-0000-4000-8000-00000000aa71','threads',NULL,gen_random_uuid(),
 '{"content_revision":"parent-v1","account_id":"own-account","channel_id":null,"channel_label":"Private target","caption":"Original caption","media_snapshot":"[{\"content_id\":\"private-image-v1\"}]"}');
SELECT public.content_publication_record(id,tenant_id,'publishing') FROM media_attempt;
SELECT public.content_publication_record(id,tenant_id,'published',p_provider_post_id=>'native-media-one',
 p_provider_post_url=>'https://www.threads.com/@fixture/post/one',p_provider_request_id=>'provider-one',
 p_provider_response=>'{"results":[{"success":true}]}') FROM media_attempt;

-- PROBE: duplicate
DO $probe$
DECLARE old public.content_publications; revised public.content_publications; legacy public.content_publications; args jsonb;
BEGIN
 SELECT * INTO old FROM public.content_publications WHERE id=(SELECT id FROM media_attempt);
 args := old.request_args;
 BEGIN
   PERFORM public.content_publication_bind(NULL,old.tenant_id,old.content_id,old.platform,NULL,gen_random_uuid(),args);
   RAISE EXCEPTION 'Exact successful media was admitted twice';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 legacy := public.content_publication_bind(NULL,old.tenant_id,old.content_id,'telegram',NULL,gen_random_uuid(),args-'media_snapshot');
 PERFORM public.content_publication_record(legacy.id,legacy.tenant_id,'publishing');
 PERFORM public.content_publication_record(legacy.id,legacy.tenant_id,'published');
 BEGIN
   PERFORM public.content_publication_bind(NULL,old.tenant_id,old.content_id,'telegram',NULL,gen_random_uuid(),args-'media_snapshot');
   RAISE EXCEPTION 'Legacy text duplicate was admitted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN
   revised := public.content_publication_bind(NULL,old.tenant_id,old.content_id,old.platform,NULL,gen_random_uuid(),
     jsonb_set(args,'{media_snapshot}','"[{\"content_id\":\"private-image-v2\"}]"'));
 EXCEPTION WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'MEDIA_REVISION_BLOCKED'; END;
 IF revised.id = old.id OR revised.status <> 'approved' THEN RAISE EXCEPTION 'Revised child media did not get its own approved attempt'; END IF;
 BEGIN
   PERFORM public.content_publication_bind(NULL,old.tenant_id,old.content_id,old.platform,NULL,gen_random_uuid(),
     jsonb_set(args,'{media_snapshot}','"third-child"'));
   RAISE EXCEPTION 'Different child media bypassed original in-flight serialization';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 RAISE NOTICE 'PASS: exact media duplicate refused, changed child admitted, in-flight serialization retained';
END;
$probe$;

-- PROBE: privacy
DO $probe$
DECLARE r public.content_publications;
BEGIN
 PERFORM set_config('test.uid','00000000-0000-4000-8000-00000000e001',true);
 SELECT * INTO r FROM public.content_publication_list('00000000-0000-4000-8000-00000000aa71') WHERE id=(SELECT id FROM media_attempt);
 IF r.request_args->>'media_snapshot' NOT LIKE '%private-image-v1%' THEN RAISE EXCEPTION 'Owner lost original media snapshot'; END IF;
 PERFORM set_config('test.uid','00000000-0000-4000-8000-00000000e002',true);
 SELECT * INTO r FROM public.content_publication_list('00000000-0000-4000-8000-00000000aa71') WHERE id=(SELECT id FROM media_attempt);
 IF r.id IS NULL OR r.status <> 'published' THEN RAISE EXCEPTION 'Member lost original outcome'; END IF;
 IF r.request_args ?| ARRAY['media_snapshot','account_id','channel_label'] OR r.provider_post_url IS NOT NULL
   THEN RAISE EXCEPTION 'MEMBER_MEDIA_EXPOSED'; END IF;
 -- The private media key alone is sufficient to redact, even in a malformed legacy row.
 PERFORM set_config('test.uid','',true);
 UPDATE public.content_publications SET request_args=request_args-'account_id' WHERE id=(SELECT id FROM media_attempt);
 PERFORM set_config('test.uid','00000000-0000-4000-8000-00000000e002',true);
 SELECT * INTO r FROM public.content_publication_list('00000000-0000-4000-8000-00000000aa71') WHERE id=(SELECT id FROM media_attempt);
 IF r.request_args ? 'media_snapshot' THEN RAISE EXCEPTION 'MEMBER_MEDIA_WITHOUT_ACCOUNT_EXPOSED'; END IF;
 PERFORM set_config('test.uid','',true);
 UPDATE public.content_publications SET request_args=(SELECT request_args FROM media_attempt) WHERE id=(SELECT id FROM media_attempt);
 IF EXISTS (SELECT * FROM media_original_contract EXCEPT SELECT oid,proowner,proacl,prosecdef,proconfig,provolatile FROM pg_proc)
   THEN RAISE EXCEPTION 'Original native identity/configuration/ACL changed'; END IF;
 RAISE NOTICE 'PASS: owner original media preserved, member redacted, missing-account bypass refused, native ABI preserved';
END;
$probe$;

-- PROBE: performance
DO $probe$
DECLARE old public.content_publications; refreshed public.content_publications; returned public.content_publications; bad jsonb;
BEGIN
 PERFORM set_config('test.uid','',true);
 SELECT * INTO old FROM public.content_publications WHERE id=(SELECT id FROM media_attempt);
 refreshed := public.content_publication_record(old.id,old.tenant_id,'published',old.provider_post_id,old.provider_post_url,old.provider_request_id,
   p_provider_response=>'{"analytics":{"state":"available","metrics":{"views":0,"likes":2},"measured_at":"2026-11-13T16:00:00Z","checked_at":"2000-01-01T00:00:00Z"}}');
 IF refreshed.id <> old.id OR refreshed.status <> old.status OR refreshed.request_args <> old.request_args
   OR refreshed.provider_post_id <> old.provider_post_id OR refreshed.provider_request_id <> old.provider_request_id
   OR refreshed.provider_post_url <> old.provider_post_url OR refreshed.provider_response->'results' <> old.provider_response->'results'
   OR refreshed.provider_response->'analytics'->'metrics'->>'views' <> '0'
   OR (refreshed.provider_response->'analytics'->>'checked_at')::timestamptz <> now() THEN RAISE EXCEPTION 'PERFORMANCE_ORIGINAL_RECEIPT_CHANGED'; END IF;
 FOREACH bad IN ARRAY ARRAY[
   '{"state":"available","metrics":{"views":-1}}'::jsonb,
   '{"state":"available","metrics":{"views":1.5}}'::jsonb,
   '{"state":"available","metrics":{"secret":"private"}}'::jsonb,
   '{"state":"invented","metrics":{}}'::jsonb,
   '{"state":"error","metrics":{"views":0}}'::jsonb,
   '{"state":"available","metrics":{"views":1},"measured_at":"infinity"}'::jsonb,
   '{"state":"available","metrics":{"views":1},"measured_at":"2999-01-01T00:00:00Z"}'::jsonb
 ] LOOP
   BEGIN
     PERFORM public.content_publication_record(old.id,old.tenant_id,'published',old.provider_post_id,old.provider_post_url,old.provider_request_id,
       p_provider_response=>jsonb_build_object('analytics',bad));
     RAISE EXCEPTION 'Invalid performance accepted';
   EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 END LOOP;
 returned := public.content_publication_record(old.id,old.tenant_id,'published',old.provider_post_id,old.provider_post_url,old.provider_request_id,
   p_provider_response=>'{"analytics":{"state":"pending","metrics":{},"measured_at":null}}');
 IF returned.provider_response->'analytics'->'metrics' <> refreshed.provider_response->'analytics'->'metrics'
   OR returned.provider_response->'analytics'->>'state' <> 'available'
   OR returned.provider_response->'analytics'->>'last_check_state' <> 'pending' THEN RAISE EXCEPTION 'LATE_NULL_MEASUREMENT_ERASED_COUNTERS'; END IF;
 BEGIN
   PERFORM public.content_publication_record(old.id,old.tenant_id,'published','different-native-post',old.provider_post_url,old.provider_request_id,
     p_provider_response=>'{"analytics":{"state":"pending","metrics":{}}}');
   RAISE EXCEPTION 'Performance changed original provider post';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 BEGIN
   PERFORM public.content_publication_record(old.id,old.tenant_id,'published',p_provider_post_url=>'https://foreign.example/changed');
   RAISE EXCEPTION 'Original terminal result was overwritten without analytics';
 EXCEPTION WHEN no_data_found THEN NULL; END;
 PERFORM set_config('test.uid','00000000-0000-4000-8000-00000000e001',true);
 BEGIN
   PERFORM public.content_publication_record(old.id,old.tenant_id,'published',old.provider_post_id,old.provider_post_url,old.provider_request_id,
     p_provider_response=>'{"analytics":{"state":"pending","metrics":{}}}');
   RAISE EXCEPTION 'Signed-in client wrote the service-only analytics cache';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('test.uid','00000000-0000-4000-8000-00000000e002',true);
 SELECT * INTO returned FROM public.content_publication_list(old.content_id) WHERE id=old.id;
 IF returned.provider_response <> '{}'::jsonb THEN RAISE EXCEPTION 'Member learned private provider analytics'; END IF;
 PERFORM set_config('test.uid','',true);
 RAISE NOTICE 'PASS: performance merges on original immutable receipt, native checks timestamp/counters/source/authority/privacy';
END;
$probe$;
