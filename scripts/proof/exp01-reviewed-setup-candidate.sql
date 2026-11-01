-- UNVERSIONED / INERT: not a migration and not a released API.
-- Requires the independently released original E13 validator. Never copy its body.
-- Existing Setup/legal-owner/delegated-management and full-schema gates remain.
BEGIN;
DO $original_setup_dependencies$
DECLARE expected record; f record; target oid;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.save_solo_setup_context(jsonb,jsonb,text,uuid)','d70cdc664b5c703395e4f077a30fdbd8','v','jsonb',3,
   '''[]''::jsonb, NULL::text, NULL::uuid','search_path=public, vault',ARRAY['authenticated']::text[]),
  ('public.get_solo_setup_context()','435c8ba9ec6a1ffb03e0cf6044ec6f00','s','jsonb',0,NULL::text,'search_path=public',ARRAY['authenticated']::text[]),
  ('public.get_solo_business_context()','5559c5e3fd8e3fb174a7f45fb08c46c9','s','jsonb',0,NULL::text,'search_path=public',ARRAY['authenticated']::text[]),
  ('public.solo_setup_access_scope()','0ec77d9d549daf94263e57848a00f5a6','s','text',0,NULL::text,'search_path=public',ARRAY[]::text[]),
  ('public.solo_setup_lock_expected_tenant(uuid)','53d6ebd2fe0cf57c9943b3aa4599f47c','v','uuid',0,NULL::text,'search_path=public',ARRAY[]::text[])
 ) v(signature,body_hash,volatility,return_type,defaults_count,defaults_text,settings,grantees) LOOP
  target:=to_regprocedure(expected.signature);
  IF target IS NULL THEN RAISE EXCEPTION 'SETUP_REVIEW_INSTALL_DRIFT'; END IF;
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=target;
  IF md5(f.prosrc)<>expected.body_hash OR f.proowner<>current_user::regrole OR NOT f.prosecdef
   OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR f.prokind<>'f'
   OR f.provolatile::text<>expected.volatility OR f.proparallel<>'u' OR f.proretset OR f.proisstrict OR f.proleakproof
   OR f.prorettype<>expected.return_type::regtype OR f.pronargdefaults<>expected.defaults_count
   OR pg_get_expr(f.proargdefaults,0) IS DISTINCT FROM expected.defaults_text
   OR f.proconfig IS DISTINCT FROM ARRAY[expected.settings]::text[]
   OR EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE NOT has_function_privilege(r,f.oid,'EXECUTE'))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE a.privilege_type<>'EXECUTE'
    OR a.grantor<>f.proowner OR (a.grantee<>f.proowner AND NOT EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE a.grantee=r::regrole::oid))
    OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'SETUP_REVIEW_INSTALL_DRIFT';
  END IF;
 END LOOP;
END $original_setup_dependencies$;
DO $dependency$
DECLARE f record;
BEGIN
 SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb)');
 IF NOT FOUND OR md5(f.prosrc)<>'c875eff4e94775dfeb6e140957d47507'
  OR f.proowner<>current_user::regrole OR f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR f.prokind<>'f' OR f.provolatile<>'v' OR f.proparallel<>'u'
  OR f.proisstrict OR f.proleakproof OR f.proretset OR f.prorettype<>'jsonb'::regtype OR f.pronargdefaults<>0
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
   WHERE a.grantee<>f.proowner OR a.grantor<>f.proowner OR a.privilege_type<>'EXECUTE')
 THEN RAISE EXCEPTION 'SETUP_REVIEW_SOURCE_DEPENDENCY'; END IF;
END $dependency$;
-- E01_OWNED_INSTALL_GUARD_BEGIN
DO $owned_existing$
DECLARE expected record; f record; installed integer:=0;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.lock_solo_reviewed_setup_scope(uuid,uuid)','cfd3332240798913d006d58f31f2f54e',false,ARRAY[]::text[]),
  ('public.lock_solo_reviewed_setup_facts(uuid,uuid,jsonb)','1eecbdbfdb90cc85f4633a5a18934915',false,ARRAY[]::text[]),
  ('public.stage_solo_reviewed_business_facts(uuid,uuid,uuid,text,bigint,jsonb)','9bbd60edf98a4517bd09fed190b004b8',true,ARRAY['authenticated']::text[]),
  ('public.inspect_solo_reviewed_business_facts(uuid,uuid,uuid)','baf098fd4fc9fe690f91e44e979628f0',true,ARRAY['authenticated']::text[]),
  ('public.save_solo_reviewed_business_facts(uuid,uuid,uuid,uuid,text,bigint,jsonb,text)','3fb4d22cf1d95c7d952ec6ddd154882e',true,ARRAY['authenticated']::text[])
 ) v(signature,body_hash,definer,grantees) LOOP
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF NOT FOUND THEN CONTINUE; END IF;
  installed:=installed+1;
  IF md5(f.prosrc)<>expected.body_hash OR f.proowner<>current_user::regrole
   OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR f.prokind<>'f'
   OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.prorettype<>'jsonb'::regtype
   OR f.proretset OR f.proisstrict OR f.proleakproof OR f.pronargdefaults<>0
   OR f.prosecdef IS DISTINCT FROM expected.definer OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE NOT has_function_privilege(r,f.oid,'EXECUTE'))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
    OR (a.grantee<>f.proowner AND NOT EXISTS(SELECT 1 FROM unnest(expected.grantees) r WHERE a.grantee=r::regrole::oid))
    OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'SETUP_REVIEW_INSTALLED_DRIFT';
  END IF;
 END LOOP;
 IF installed NOT IN (0,5) THEN RAISE EXCEPTION 'SETUP_REVIEW_PARTIAL_INSTALL'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.paige_audit_log'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_AUDIT_DRIFT'; END IF;
 IF (SELECT count(*) FROM pg_policy WHERE polrelid='public.paige_audit_log'::regclass
  AND polname='exp01_reviewed_facts_server_events')<>(CASE WHEN installed=0 THEN 0 ELSE 1 END) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_PARTIAL_INSTALL'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.paige_audit_log'::regclass AND polname='exp01_reviewed_facts_server_events'
  AND (polpermissive OR polcmd<>'a' OR polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid]
   OR polqual IS NOT NULL OR pg_get_expr(polwithcheck,polrelid) IS DISTINCT FROM
   '(action <> ALL (ARRAY[''solo_setup.reviewed_facts_staged''::text, ''solo_setup.reviewed_facts_approved''::text]))')) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_AUDIT_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.tenant_setup_business_context_meta'::regclass
  AND attname IN ('reviewed_fact_proposal','reviewed_fact_approval') AND NOT attisdropped
  AND (atttypid<>'jsonb'::regtype OR attnotnull OR atthasdef)) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_COLUMN_DRIFT'; END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.tenant_setup_business_context_meta'::regclass
   AND attname IN ('reviewed_fact_proposal','reviewed_fact_approval') AND NOT attisdropped)
   IS DISTINCT FROM (CASE WHEN installed=0 THEN 0 ELSE 2 END) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_PARTIAL_INSTALL'; END IF;
END $owned_existing$;
-- E01_OWNED_INSTALL_GUARD_END

ALTER TABLE public.tenant_setup_business_context_meta
 ADD COLUMN IF NOT EXISTS reviewed_fact_proposal jsonb,
 ADD COLUMN IF NOT EXISTS reviewed_fact_approval jsonb;
-- Same private original table; retain its RLS/no direct API grants.
-- These two original audit events are authored only by the native transaction.
-- A restrictive policy composes with, rather than replaces, original audit rules.
DO $audit_event_policy$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.paige_audit_log'::regclass AND polname='exp01_reviewed_facts_server_events') THEN
  CREATE POLICY exp01_reviewed_facts_server_events ON public.paige_audit_log
   AS RESTRICTIVE FOR INSERT TO authenticated
   WITH CHECK (action <> ALL (ARRAY['solo_setup.reviewed_facts_staged'::text,'solo_setup.reviewed_facts_approved'::text]));
 END IF;
END $audit_event_policy$;

CREATE OR REPLACE FUNCTION public.lock_solo_reviewed_setup_scope(p_tenant uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $scope$
DECLARE context jsonb;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor OR p_tenant IS NULL THEN
  RAISE EXCEPTION 'SETUP_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 -- Take the original Setup selection lock and tenant write lock before E13's
 -- shared authority locks. Receipt calls must not both hold SHARE and then
 -- upgrade the same profile/tenant. Cross-API lock/recovery proof remains owed.
 PERFORM public.solo_setup_lock_expected_tenant(p_tenant);
 PERFORM 1 FROM public.tenants WHERE id=p_tenant FOR UPDATE;
 IF NOT public.lock_knowledge_extraction_authority(p_actor,p_tenant) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=p_tenant AND user_id=p_actor AND status='active')
  OR public.solo_setup_access_scope() NOT IN ('owner_full','admin_operational') THEN
  RAISE EXCEPTION 'SETUP_REVIEW_AUTHORITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenant_setup_business_context_meta WHERE tenant_id=p_tenant FOR UPDATE;
 context:=public.get_solo_business_context();
 IF context->>'tenantId' IS DISTINCT FROM p_tenant::text THEN
  RAISE EXCEPTION 'SETUP_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 RETURN context;
END $scope$;
REVOKE ALL ON FUNCTION public.lock_solo_reviewed_setup_scope(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.lock_solo_reviewed_setup_facts(p_tenant uuid,p_actor uuid,p_facts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $facts$
DECLARE fact jsonb; evidence jsonb; result jsonb:='[]'; units integer:=0;
 allowed constant text[]:=ARRAY['legalName','publicName','dbaName','website','address','phone','industry','naicsCode','sicCode',
 'offers','deliveryModel','idealCustomer','customerSegments','serviceArea','currentPriority','goals90Day',
 'annualDirection','successDefinition','constraints','brandVoice','operatingPreferences','doNotAssume'];
BEGIN
 IF p_facts IS NULL OR jsonb_typeof(p_facts)<>'array' OR pg_column_size(p_facts)>131072
  OR jsonb_array_length(p_facts) NOT BETWEEN 1 AND 22 THEN
  RAISE EXCEPTION 'SETUP_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
 IF (SELECT count(DISTINCT value->>'field') FROM jsonb_array_elements(p_facts))<>jsonb_array_length(p_facts) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
 -- Deterministic source lock order for selections spanning multiple documents.
 FOR fact IN SELECT value FROM jsonb_array_elements(p_facts) ORDER BY value->'reference'->>'documentId',value->>'field' LOOP
  IF jsonb_typeof(fact)<>'object' OR NOT(fact ?& ARRAY['field','value','reference','excerpts'])
   OR (SELECT count(*) FROM jsonb_object_keys(fact))<>4 OR jsonb_typeof(fact->'field') IS DISTINCT FROM 'string'
   OR NOT((fact->>'field')=ANY(allowed))
   OR jsonb_typeof(fact->'value') IS DISTINCT FROM 'string' OR char_length(fact->>'value') NOT BETWEEN 1 AND 4000
   OR fact->>'value' IS DISTINCT FROM btrim(fact->>'value')
   OR jsonb_typeof(fact->'excerpts') IS DISTINCT FROM 'array' OR jsonb_array_length(fact->'excerpts')<1 THEN
   RAISE EXCEPTION 'SETUP_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
  evidence:=public.lock_knowledge_source_evidence(p_actor,p_tenant,fact->'reference',fact->'excerpts');
  IF evidence->>'status' IS DISTINCT FROM 'available' OR evidence->'reference' IS DISTINCT FROM fact->'reference'
   OR evidence->'excerpts' IS DISTINCT FROM fact->'excerpts' THEN
   RAISE EXCEPTION 'SETUP_REVIEW_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
  SELECT units+coalesce(sum(public.knowledge_utf16_length(e->>'text')),0)::integer INTO units
   FROM jsonb_array_elements(evidence->'excerpts') e;
  IF units>12000 THEN RAISE EXCEPTION 'SETUP_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
  result:=result||jsonb_build_array(fact);
 END LOOP;
 RETURN result;
END $facts$;
REVOKE ALL ON FUNCTION public.lock_solo_reviewed_setup_facts(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.stage_solo_reviewed_business_facts(
 _expected_tenant_id uuid,_expected_actor_id uuid,_review_id uuid,
 _expected_updated_at text,_expected_context_revision bigint,_facts jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stage$
DECLARE context jsonb; proposal jsonb; current_proposal jsonb;
BEGIN
 context:=public.lock_solo_reviewed_setup_scope(_expected_tenant_id,_expected_actor_id);
 IF _review_id IS NULL OR _expected_context_revision IS NULL OR _expected_context_revision<0 THEN
  RAISE EXCEPTION 'SETUP_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
 IF context->'brief'->>'updatedAt' IS DISTINCT FROM _expected_updated_at
  OR (context->>'contextRevision')::bigint IS DISTINCT FROM _expected_context_revision THEN
  RAISE EXCEPTION 'SETUP_REVIEW_CONFLICT' USING ERRCODE='40001'; END IF;
 INSERT INTO public.tenant_setup_business_context_meta(tenant_id,updated_by)
 VALUES(_expected_tenant_id,auth.uid()) ON CONFLICT DO NOTHING;
 proposal:=jsonb_build_object('schemaVersion',1,'actorId',auth.uid(),'tenantId',_expected_tenant_id,
  'reviewId',_review_id,'expectedUpdatedAt',_expected_updated_at,'expectedContextRevision',_expected_context_revision,
  'facts',public.lock_solo_reviewed_setup_facts(_expected_tenant_id,auth.uid(),_facts));
 SELECT reviewed_fact_proposal INTO current_proposal FROM public.tenant_setup_business_context_meta WHERE tenant_id=_expected_tenant_id;
 IF current_proposal->>'reviewId'=_review_id::text THEN
  IF current_proposal IS DISTINCT FROM proposal THEN RAISE EXCEPTION 'SETUP_REVIEW_ID_REUSED' USING ERRCODE='40001'; END IF;
  RETURN proposal;
 END IF;
 IF EXISTS(SELECT 1 FROM public.paige_audit_log WHERE tenant_id=_expected_tenant_id
  AND action='solo_setup.reviewed_facts_staged' AND payload->>'reviewId'=_review_id::text) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_SUPERSEDED' USING ERRCODE='40001'; END IF;
 UPDATE public.tenant_setup_business_context_meta SET reviewed_fact_proposal=proposal WHERE tenant_id=_expected_tenant_id;
 INSERT INTO public.paige_audit_log(actor_user_id,actor_role,action,target_type,target_id,tenant_id,payload)
 VALUES(auth.uid(),public.solo_setup_access_scope(),'solo_setup.reviewed_facts_staged','solo_business_brief',_expected_tenant_id,_expected_tenant_id,
  jsonb_build_object('reviewId',_review_id,'reviewHash',encode(extensions.digest(convert_to(proposal::text,'UTF8'),'sha256'),'hex')));
 RETURN proposal;
END $stage$;
REVOKE ALL ON FUNCTION public.stage_solo_reviewed_business_facts(uuid,uuid,uuid,text,bigint,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.stage_solo_reviewed_business_facts(uuid,uuid,uuid,text,bigint,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.inspect_solo_reviewed_business_facts(
 _expected_tenant_id uuid,_expected_actor_id uuid,_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $inspect$
DECLARE context jsonb; receipt jsonb; audit public.paige_audit_log; fact jsonb;
BEGIN
 context:=public.lock_solo_reviewed_setup_scope(_expected_tenant_id,_expected_actor_id);
 IF _request_id IS NULL THEN RAISE EXCEPTION 'SETUP_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO audit FROM public.paige_audit_log WHERE tenant_id=_expected_tenant_id AND actor_user_id=auth.uid()
  AND action='solo_setup.reviewed_facts_approved' AND payload->>'requestId'=_request_id::text;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','absent_at_read'); END IF;
 SELECT reviewed_fact_approval INTO receipt FROM public.tenant_setup_business_context_meta WHERE tenant_id=_expected_tenant_id;
 IF receipt->>'receiptId' IS DISTINCT FROM audit.id::text
  OR receipt->>'updatedAt' IS DISTINCT FROM context->'brief'->>'updatedAt'
  OR receipt->>'contextRevision' IS DISTINCT FROM context->>'contextRevision' THEN
  RETURN jsonb_build_object('status','recorded','receiptId',audit.id,'current',false,'reason','setup_changed'); END IF;
 -- Inspect never writes or retries the original save. Source denial/changes make
 -- a durable receipt historical, not renewed authority or missing persistence.
 BEGIN
  PERFORM public.lock_solo_reviewed_setup_facts(_expected_tenant_id,auth.uid(),receipt->'selectedFacts');
 EXCEPTION WHEN SQLSTATE '40001' OR SQLSTATE '42501' OR SQLSTATE '22023' OR SQLSTATE 'P0001' THEN
  RETURN jsonb_build_object('status','recorded','receiptId',audit.id,'current',false,'reason','source_unavailable_or_changed');
 END;
 FOR fact IN SELECT value FROM jsonb_array_elements(receipt->'selectedFacts') LOOP
  IF context->'brief'->>(fact->>'field') IS DISTINCT FROM fact->>'value' THEN
   RETURN jsonb_build_object('status','recorded','receiptId',audit.id,'current',false,'reason','setup_changed'); END IF;
 END LOOP;
 RETURN jsonb_build_object('status','recorded','receiptId',audit.id,'current',true,'receipt',receipt);
END $inspect$;
REVOKE ALL ON FUNCTION public.inspect_solo_reviewed_business_facts(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.inspect_solo_reviewed_business_facts(uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_solo_reviewed_business_facts(
 _expected_tenant_id uuid,_expected_actor_id uuid,_review_id uuid,_request_id uuid,
 _expected_updated_at text,_expected_context_revision bigint,_selected_fields jsonb,_purpose text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $save$
DECLARE context jsonb; proposal jsonb; selected jsonb; brief jsonb; fact jsonb; fields jsonb;
 fingerprint text; prior public.paige_audit_log; receipt_id uuid; receipt jsonb; result jsonb;
BEGIN
 context:=public.lock_solo_reviewed_setup_scope(_expected_tenant_id,_expected_actor_id);
 IF _review_id IS NULL OR _request_id IS NULL OR _purpose IS DISTINCT FROM 'setup_business_facts'
  OR _expected_context_revision IS NULL OR _expected_context_revision<0
  OR _selected_fields IS NULL OR jsonb_typeof(_selected_fields)<>'array' OR pg_column_size(_selected_fields)>4096
  OR jsonb_array_length(_selected_fields) NOT BETWEEN 1 AND 22
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(_selected_fields) e WHERE jsonb_typeof(e)<>'string')
  OR (SELECT count(DISTINCT e) FROM jsonb_array_elements(_selected_fields) e)<>jsonb_array_length(_selected_fields) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
 SELECT jsonb_agg(e ORDER BY e) INTO fields FROM jsonb_array_elements(_selected_fields) e;
 fingerprint:=encode(extensions.digest(convert_to(jsonb_build_array(_review_id,fields,_purpose,_expected_updated_at,_expected_context_revision)::text,'UTF8'),'sha256'),'hex');
 SELECT * INTO prior FROM public.paige_audit_log WHERE tenant_id=_expected_tenant_id AND actor_user_id=auth.uid()
  AND action='solo_setup.reviewed_facts_approved' AND payload->>'requestId'=_request_id::text;
 IF FOUND THEN
  IF prior.payload->>'requestHash' IS DISTINCT FROM fingerprint THEN
   RAISE EXCEPTION 'SETUP_REVIEW_REQUEST_REUSED' USING ERRCODE='40001'; END IF;
  RETURN public.inspect_solo_reviewed_business_facts(_expected_tenant_id,auth.uid(),_request_id);
 END IF;
 SELECT reviewed_fact_proposal INTO proposal FROM public.tenant_setup_business_context_meta WHERE tenant_id=_expected_tenant_id;
 IF proposal IS NULL OR proposal->>'reviewId' IS DISTINCT FROM _review_id::text
  OR proposal->>'actorId' IS DISTINCT FROM auth.uid()::text OR proposal->>'tenantId' IS DISTINCT FROM _expected_tenant_id::text
  OR proposal->>'expectedUpdatedAt' IS DISTINCT FROM _expected_updated_at
  OR (proposal->>'expectedContextRevision')::bigint IS DISTINCT FROM _expected_context_revision
  OR context->'brief'->>'updatedAt' IS DISTINCT FROM _expected_updated_at
  OR (context->>'contextRevision')::bigint IS DISTINCT FROM _expected_context_revision THEN
  RAISE EXCEPTION 'SETUP_REVIEW_CONFLICT' USING ERRCODE='40001'; END IF;
 SELECT jsonb_agg(f ORDER BY f->'reference'->>'documentId',f->>'field') INTO selected
  FROM jsonb_array_elements(proposal->'facts') f WHERE fields ? (f->>'field');
 IF selected IS NULL OR jsonb_array_length(selected)<>jsonb_array_length(fields) THEN
  RAISE EXCEPTION 'SETUP_REVIEW_SELECTION_CHANGED' USING ERRCODE='40001'; END IF;
 selected:=public.lock_solo_reviewed_setup_facts(_expected_tenant_id,auth.uid(),selected);
 brief:=context->'brief';
 FOR fact IN SELECT value FROM jsonb_array_elements(selected) LOOP
  brief:=jsonb_set(brief,ARRAY[fact->>'field'],fact->'value',true);
 END LOOP;
 -- Sole original writer; no paige-write-back, no no-CAS branch, no owner-list
 -- reconstruction and no inference of legal identity/Memory/Work approval.
 PERFORM public.save_solo_setup_context(brief,context->'businessOwners',_expected_updated_at,NULL);
 UPDATE public.tenant_setup_business_context_meta SET revision=revision+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  WHERE tenant_id=_expected_tenant_id;
 result:=public.get_solo_business_context();
 FOR fact IN SELECT value FROM jsonb_array_elements(selected) LOOP
  IF result->'brief'->>(fact->>'field') IS DISTINCT FROM fact->>'value' THEN
   RAISE EXCEPTION 'SETUP_REVIEW_READBACK_MISMATCH' USING ERRCODE='40001'; END IF;
 END LOOP;
 INSERT INTO public.paige_audit_log(actor_user_id,actor_role,action,target_type,target_id,tenant_id,payload)
 VALUES(auth.uid(),public.solo_setup_access_scope(),'solo_setup.reviewed_facts_approved','solo_business_brief',_expected_tenant_id,_expected_tenant_id,
  jsonb_build_object('requestId',_request_id,'reviewId',_review_id,'requestHash',fingerprint,
   'selectionHash',encode(extensions.digest(convert_to(selected::text,'UTF8'),'sha256'),'hex'),
   'purpose',_purpose,'contextRevision',result->'contextRevision')) RETURNING id INTO receipt_id;
 receipt:=jsonb_build_object('schemaVersion',1,'receiptId',receipt_id,'requestId',_request_id,'reviewId',_review_id,
  'actorId',auth.uid(),'tenantId',_expected_tenant_id,'purpose',_purpose,'selectedFacts',selected,
  'selectionHash',encode(extensions.digest(convert_to(selected::text,'UTF8'),'sha256'),'hex'),
  'updatedAt',result->'brief'->'updatedAt','contextRevision',result->'contextRevision');
 UPDATE public.tenant_setup_business_context_meta SET reviewed_fact_approval=receipt,reviewed_fact_proposal=NULL
  WHERE tenant_id=_expected_tenant_id;
 RETURN public.inspect_solo_reviewed_business_facts(_expected_tenant_id,auth.uid(),_request_id);
END $save$;
REVOKE ALL ON FUNCTION public.save_solo_reviewed_business_facts(uuid,uuid,uuid,uuid,text,bigint,jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_solo_reviewed_business_facts(uuid,uuid,uuid,uuid,text,bigint,jsonb,text) TO authenticated;
COMMIT;
