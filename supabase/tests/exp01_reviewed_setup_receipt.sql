-- Actual replayed schema, getters, authority and Setup writer. Synthetic records
-- exist only inside this CI rollback; no ordinary account or provider is used.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE e01_original_functions AS
 SELECT oid,md5(pg_get_functiondef(oid)) definition,proowner,proconfig,proacl
 FROM pg_proc WHERE oid=ANY(ARRAY[
 'public.save_solo_setup_context(jsonb,jsonb,text,uuid)'::regprocedure,
 'public.save_solo_business_context(uuid,jsonb,jsonb,text,jsonb,jsonb,jsonb,text,text,text,bigint,uuid)'::regprocedure,
 'public.get_solo_setup_context()'::regprocedure,'public.get_solo_business_context()'::regprocedure,
 'public.stage_solo_business_brief_proposal(uuid,uuid,jsonb,text)'::regprocedure]);
-- EXP01_INSTALL_CANDIDATE
CREATE TEMP TABLE e01_candidate_functions AS SELECT oid,md5(pg_get_functiondef(oid)) definition,proowner,proconfig,proacl
 FROM pg_proc WHERE proname IN ('lock_solo_reviewed_setup_scope','lock_solo_reviewed_setup_facts',
 'stage_solo_reviewed_business_facts','save_solo_reviewed_business_facts','inspect_solo_reviewed_business_facts');
-- EXP01_REPLAY_CANDIDATE
SELECT is((SELECT count(*)::integer FROM e01_original_functions b JOIN pg_proc p USING(oid)
 WHERE b.definition IS DISTINCT FROM md5(pg_get_functiondef(p.oid)) OR b.proowner<>p.proowner
 OR b.proconfig IS DISTINCT FROM p.proconfig OR b.proacl IS DISTINCT FROM p.proacl),0,'all original Setup source/owner/settings/ACL remain exact');
SELECT is((SELECT count(*)::integer FROM e01_candidate_functions b JOIN pg_proc p USING(oid)
 WHERE b.definition IS DISTINCT FROM md5(pg_get_functiondef(p.oid)) OR b.proowner<>p.proowner
 OR b.proconfig IS DISTINCT FROM p.proconfig OR b.proacl IS DISTINCT FROM p.proacl),0,'candidate replay preserves exact native source and metadata');
SELECT ok(NOT has_function_privilege('anon','public.save_solo_reviewed_business_facts(uuid,uuid,uuid,uuid,text,bigint,jsonb,text)','EXECUTE'),'anon has no approval API');
SELECT ok(NOT has_function_privilege('service_role','public.save_solo_reviewed_business_facts(uuid,uuid,uuid,uuid,text,bigint,jsonb,text)','EXECUTE'),'service cannot manufacture a human approval');
SELECT ok(has_function_privilege('authenticated','public.save_solo_reviewed_business_facts(uuid,uuid,uuid,uuid,text,bigint,jsonb,text)','EXECUTE'),'authenticated caller reaches guarded native approval');
SELECT ok(NOT has_function_privilege('authenticated','public.lock_solo_reviewed_setup_facts(uuid,uuid,jsonb)','EXECUTE'),'source revalidation helper remains private');
SELECT ok(NOT has_function_privilege('authenticated','public.lock_solo_reviewed_setup_scope(uuid,uuid)','EXECUTE'),'scope helper remains private');
SELECT ok(NOT has_table_privilege('authenticated','public.tenant_setup_business_context_meta','UPDATE'),'client cannot forge private review or receipt rows');
SELECT ok((SELECT bool_and(prosecdef AND proconfig=ARRAY['search_path=""']::text[]) FROM pg_proc
 WHERE proname IN ('stage_solo_reviewed_business_facts','save_solo_reviewed_business_facts','inspect_solo_reviewed_business_facts')),'all exposed native methods pin an empty search path');
SELECT ok((SELECT NOT polpermissive AND polcmd='a' FROM pg_policy WHERE polrelid='public.paige_audit_log'::regclass
 AND polname='exp01_reviewed_facts_server_events'),'receipt events compose through a restrictive server-only audit policy');

INSERT INTO auth.users(id,aud,role,email) VALUES
 ('e0100100-0000-4000-8000-000000000001','authenticated','authenticated','e01-receipt-owner@tests.invalid'),
 ('e0100100-0000-4000-8000-000000000002','authenticated','authenticated','e01-receipt-admin@tests.invalid'),
 ('e0100100-0000-4000-8000-000000000003','authenticated','authenticated','e01-receipt-member@tests.invalid'),
 ('e0100100-0000-4000-8000-000000000004','authenticated','authenticated','e01-receipt-foreign@tests.invalid');
INSERT INTO public.tenants(id,slug,name,status,account_type,owner_user_id,features,brand) VALUES
 ('e0100200-0000-4000-8000-000000000001','e01-receipt-proof-a','Receipt Proof A','active','standalone','e0100100-0000-4000-8000-000000000001','{}','{}'),
 ('e0100200-0000-4000-8000-000000000002','e01-receipt-proof-b','Receipt Proof B','active','standalone','e0100100-0000-4000-8000-000000000004','{}','{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0100200-0000-4000-8000-000000000001','e0100100-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0100200-0000-4000-8000-000000000001','e0100100-0000-4000-8000-000000000002','admin','active',false,now()),
 ('e0100200-0000-4000-8000-000000000001','e0100100-0000-4000-8000-000000000003','member','active',false,now()),
 ('e0100200-0000-4000-8000-000000000002','e0100100-0000-4000-8000-000000000004','owner','active',true,now());
INSERT INTO public.profiles(user_id,active_tenant_id) SELECT user_id,tenant_id FROM public.tenant_members
 WHERE tenant_id IN ('e0100200-0000-4000-8000-000000000001','e0100200-0000-4000-8000-000000000002')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=excluded.active_tenant_id;
INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,created_by,record_state) VALUES
 ('e0100300-0000-4000-8000-000000000001','e0100200-0000-4000-8000-000000000001','Agreement proof','Advisory','e0100100-0000-4000-8000-000000000001','canonical');
CREATE TEMP TABLE e01_state(name text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT,UPDATE ON e01_state TO authenticated;
CREATE FUNCTION pg_temp.e01_as(actor uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
END$$;
CREATE FUNCTION pg_temp.e01_error(statement text) RETURNS text LANGUAGE plpgsql SECURITY INVOKER AS $$BEGIN
 EXECUTE statement;RETURN 'NO_ERROR';EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;END$$;
CREATE FUNCTION pg_temp.e01_affected(statement text) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER AS $$DECLARE affected integer;BEGIN
 EXECUTE statement;GET DIAGNOSTICS affected=ROW_COUNT;RETURN affected;END$$;
CREATE FUNCTION pg_temp.e01_facts() RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
 SELECT jsonb_agg(jsonb_build_object('field',f.field,'value','Advisory','reference',
 jsonb_build_object('contractVersion',1,'tenantId',d.tenant_id,'documentId',d.id,'revision',d.revision,
 'contentSha256',encode(sha256(convert_to(d.content,'UTF8')),'hex')),'excerpts',
 jsonb_build_array(jsonb_build_object('start',0,'end',8,'text','Advisory'))))
 FROM public.tenant_knowledge_docs d CROSS JOIN (VALUES('offers'),('deliveryModel')) f(field)
 WHERE id='e0100300-0000-4000-8000-000000000001'$$;
-- Capture native reference as fixture owner, not by granting a protected table to the browser.
INSERT INTO e01_state VALUES('facts',pg_temp.e01_facts());
CREATE FUNCTION pg_temp.e01_stage(review uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$DECLARE c jsonb;BEGIN
 c:=public.get_solo_business_context();
 RETURN public.stage_solo_reviewed_business_facts('e0100200-0000-4000-8000-000000000001',auth.uid(),review,
 c->'brief'->>'updatedAt',(c->>'contextRevision')::bigint,(SELECT value FROM e01_state WHERE name='facts'));END$$;
CREATE FUNCTION pg_temp.e01_save(review uuid,request uuid,fields jsonb DEFAULT '["offers"]') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$DECLARE p jsonb;BEGIN
 SELECT value INTO p FROM e01_state WHERE name='proposal';
 RETURN public.save_solo_reviewed_business_facts('e0100200-0000-4000-8000-000000000001',auth.uid(),review,request,
 p->>'expectedUpdatedAt',(p->>'expectedContextRevision')::bigint,fields,'setup_business_facts');END$$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000001');
SELECT lives_ok($$SELECT public.save_solo_setup_context('{"publicName":"Receipt Proof A","legalName":"Receipt Proof LLC","offers":"Before","deliveryModel":"Unselected current value"}',
 '[{"id":"e0100600-0000-4000-8000-000000000001","ownerKind":"individual","legalName":"Fixture Legal Owner","ownershipInterest":"50","status":"active","representativeUserId":"e0100100-0000-4000-8000-000000000001"},
   {"id":"e0100600-0000-4000-8000-000000000002","ownerKind":"company","legalName":"Fixture Vacant Owner","ownershipInterest":"50","status":"active"}]',NULL,NULL)$$,'ordinary original owner Setup save remains available with representative and vacant ownership facts');
INSERT INTO e01_state VALUES('original_owners',public.get_solo_business_context()->'businessOwners');
SELECT is(public.get_solo_business_context()->'brief'->>'offers','Before','actual getter reads the original stored brief');
SELECT is(pg_temp.e01_error($$INSERT INTO public.paige_audit_log(actor_user_id,actor_role,action,target_type,target_id,tenant_id,payload)
 VALUES(auth.uid(),'owner','solo_setup.reviewed_facts_approved','solo_business_brief','e0100200-0000-4000-8000-000000000001','e0100200-0000-4000-8000-000000000001','{}')$$),'42501','browser cannot manufacture an original approval audit event');
SELECT is(public.inspect_solo_reviewed_business_facts('e0100200-0000-4000-8000-000000000001',auth.uid(),'e0100500-0000-4000-8000-000000000001')->>'status','absent_at_read','same-request inspection reports no approval before explicit review');
SELECT is(pg_temp.e01_error($$SELECT public.stage_solo_reviewed_business_facts('e0100200-0000-4000-8000-000000000001','e0100100-0000-4000-8000-000000000002',gen_random_uuid(),NULL,0,'[]')$$),'42501','client cannot impersonate another approving actor');
SELECT is(pg_temp.e01_error($$SELECT public.inspect_solo_reviewed_business_facts('e0100200-0000-4000-8000-000000000002',auth.uid(),gen_random_uuid())$$),'40001','expected workspace cannot select a foreign business');
INSERT INTO e01_state VALUES('proposal',pg_temp.e01_stage('e0100400-0000-4000-8000-000000000001'));
SELECT is(public.get_solo_business_context()->'brief'->>'offers','Before','staging reviewed evidence does not approve or save a fact');
SELECT is(pg_temp.e01_error($$SELECT pg_temp.e01_save('e0100400-0000-4000-8000-000000000001','e0100500-0000-4000-8000-000000000001','["industry"]')$$),'40001','unreviewed field selection refuses before original writer');
RESET ROLE;
UPDATE public.tenant_knowledge_docs SET revision=revision+1 WHERE id='e0100300-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.e01_error($$SELECT pg_temp.e01_save('e0100400-0000-4000-8000-000000000001','e0100500-0000-4000-8000-000000000001')$$),'40001','actual changed source revision invalidates staged approval');
SELECT is(public.get_solo_business_context()->'brief'->>'offers','Before','source refusal has no Setup effect');
RESET ROLE;
UPDATE e01_state SET value=pg_temp.e01_facts() WHERE name='facts';
SET LOCAL ROLE authenticated;
UPDATE e01_state SET value=pg_temp.e01_stage('e0100400-0000-4000-8000-000000000002') WHERE name='proposal';
SELECT is(pg_temp.e01_error($$SELECT pg_temp.e01_save('e0100400-0000-4000-8000-000000000001','e0100500-0000-4000-8000-000000000001')$$),'40001','superseded review cannot approve the newer selection');
INSERT INTO e01_state VALUES('saved',pg_temp.e01_save('e0100400-0000-4000-8000-000000000002','e0100500-0000-4000-8000-000000000001'));
SELECT is((SELECT value->>'current' FROM e01_state WHERE name='saved'),'true','actual owner save returns a current original receipt');
SELECT is(public.get_solo_business_context()->'brief'->>'offers','Advisory','actual original getter verifies saved selected value');
SELECT is((SELECT jsonb_array_length(value->'receipt'->'selectedFacts') FROM e01_state WHERE name='saved'),1,'receipt contains only explicitly selected facts from the two-fact review');
SELECT is(public.get_solo_business_context()->'brief'->>'deliveryModel','Unselected current value','reviewed but unselected field remains unchanged through original writer');
SELECT is(public.get_solo_business_context()->'businessOwners',(SELECT value FROM e01_state WHERE name='original_owners'),'Owner receipt preserves the exact original ownership list and provenance');
SELECT is(pg_temp.e01_save('e0100400-0000-4000-8000-000000000002','e0100500-0000-4000-8000-000000000001')->>'receiptId',
 (SELECT value->>'receiptId' FROM e01_state WHERE name='saved'),'same-request replay returns the original durable receipt');
SELECT is(pg_temp.e01_error($$SELECT pg_temp.e01_save('e0100400-0000-4000-8000-000000000002','e0100500-0000-4000-8000-000000000001','["industry"]')$$),'40001','same request cannot be reused with changed selected fields');
SELECT is(pg_temp.e01_affected($$UPDATE public.paige_audit_log SET payload='{}' WHERE tenant_id='e0100200-0000-4000-8000-000000000001' AND action='solo_setup.reviewed_facts_approved'$$),0,'browser cannot alter the original server approval event');
SELECT is(pg_temp.e01_affected($$DELETE FROM public.paige_audit_log WHERE tenant_id='e0100200-0000-4000-8000-000000000001' AND action='solo_setup.reviewed_facts_approved'$$),0,'browser cannot delete the original server approval event');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.paige_audit_log WHERE tenant_id='e0100200-0000-4000-8000-000000000001' AND action='solo_setup.reviewed_facts_approved'),1,'one immutable original approval receipt audit exists');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.paige_audit_log WHERE tenant_id='e0100200-0000-4000-8000-000000000001' AND payload::text LIKE '%Advisory%'),'private selected values/quotations are absent from audit payloads');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.tenants WHERE id='e0100200-0000-4000-8000-000000000001' AND brand::text LIKE '%contentSha256%'),'private source reference is not copied into public brand');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000002');
SELECT is(public.get_solo_setup_context()->>'accessScope','admin_operational','actual delegated Admin has original scoped operational access');
UPDATE e01_state SET value=pg_temp.e01_stage('e0100400-0000-4000-8000-000000000003') WHERE name='proposal';
SELECT is(pg_temp.e01_save('e0100400-0000-4000-8000-000000000003','e0100500-0000-4000-8000-000000000003')->>'current','true','authorized Admin explicitly saves selected operational facts through original writer');
SELECT is(public.get_solo_business_context()->'brief'->>'legalName','Receipt Proof LLC','Admin operational receipt preserves legal identity');
SELECT is(public.get_solo_business_context()->'businessOwners',(SELECT value FROM e01_state WHERE name='original_owners'),'Admin receipt passes the exact original ownership list through the original authority check');
UPDATE e01_state SET value=jsonb_build_array(jsonb_set(value->0,'{field}','"legalName"'::jsonb)) WHERE name='facts';
UPDATE e01_state SET value=pg_temp.e01_stage('e0100400-0000-4000-8000-000000000004') WHERE name='proposal';
SELECT is(pg_temp.e01_error($$SELECT pg_temp.e01_save('e0100400-0000-4000-8000-000000000004','e0100500-0000-4000-8000-000000000004','["legalName"]')$$),'42501','explicit source review does not grant Admin Owner-only legal identity authority');
SELECT is(public.get_solo_business_context()->'brief'->>'legalName','Receipt Proof LLC','protected-field refusal preserves actual original legal identity');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.paige_audit_log WHERE tenant_id='e0100200-0000-4000-8000-000000000001' AND action='solo_setup.reviewed_facts_approved'),2,'refused protected-field approval adds no receipt');
SET LOCAL ROLE authenticated;
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000003');
SELECT is(pg_temp.e01_error($$SELECT pg_temp.e01_stage(gen_random_uuid())$$),'42501','unassigned ordinary member cannot infer Setup authority from source access');
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000004');
SELECT is(pg_temp.e01_error($$SELECT public.inspect_solo_reviewed_business_facts('e0100200-0000-4000-8000-000000000001',auth.uid(),'e0100500-0000-4000-8000-000000000001')$$),'40001','foreign owner cannot inspect another workspace receipt');
RESET ROLE;
UPDATE public.tenant_members SET status='suspended' WHERE tenant_id='e0100200-0000-4000-8000-000000000001' AND user_id='e0100100-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.e01_as('e0100100-0000-4000-8000-000000000002');
SELECT ok(pg_temp.e01_error($$SELECT public.inspect_solo_reviewed_business_facts('e0100200-0000-4000-8000-000000000001',auth.uid(),'e0100500-0000-4000-8000-000000000003')$$) IN ('42501','40001'),'same-JWT revoked Admin loses receipt eligibility');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM e01_original_functions b JOIN pg_proc p USING(oid)
 WHERE b.definition IS DISTINCT FROM md5(pg_get_functiondef(p.oid)) OR b.proowner<>p.proowner
 OR b.proconfig IS DISTINCT FROM p.proconfig OR b.proacl IS DISTINCT FROM p.proacl),0,'full flow retains every original Setup function and ACL');
SELECT * FROM finish();
ROLLBACK;
