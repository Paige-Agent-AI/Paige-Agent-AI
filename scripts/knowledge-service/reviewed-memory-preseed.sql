BEGIN;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
-- Existing legacy writer accepts arbitrary metadata. A fingerprint is not a
-- native approval or proof that the stored content matches the reviewed intent.
SET LOCAL ROLE authenticated;
SELECT public.record_paige_memory('summary','Unapproved unrelated content',NULL,
 jsonb_build_object('reviewed_save',public.test_memory_review('70000000-0000-4000-8000-000000000006'),'reviewed_request_sha256',
 encode(sha256(convert_to(jsonb_build_object('type','preference','content','Intended reviewed preference','thread',NULL,'metadata','{}'::jsonb,'review',public.test_memory_review('70000000-0000-4000-8000-000000000006'))::text,'UTF8')),'hex')),false,'proposed',NULL,NULL);
SELECT public.test_denied($q$SELECT public.record_paige_memory('preference','Intended reviewed preference',NULL,'{}',false,'confirmed',NULL,NULL,public.test_memory_review('70000000-0000-4000-8000-000000000006'))$q$,'PAIGE_MEMORY_REVIEW_INTENT_CONFLICT');
ROLLBACK;
