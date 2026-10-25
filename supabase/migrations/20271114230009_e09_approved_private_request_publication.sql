-- CLI scaffold 20261025152327; forward slot coordinated with E04/E05.
-- The one canonical stored-call gate approves. This domain executor consumes
-- its claimed evidence; it never issues/claims approvals or invokes a provider.
BEGIN;

DO $e09_publication_dependencies$
DECLARE item record; actual text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public._client_portal_access_authorize(uuid,uuid,boolean)','7c3eb55c866321fed052ae742b75e42d'),
  ('public.admin_propose_paige_actions(uuid,jsonb)','21bd99c7a036f28f82a677fa25c6db04')
 ) source(signature,body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc
   WHERE oid=pg_catalog.to_regprocedure(item.signature);
  IF actual IS DISTINCT FROM item.body THEN
   RAISE EXCEPTION 'Original Portal publication dependency changed (%); reconcile before release',item.signature;
  END IF;
 END LOOP;
 IF pg_catalog.to_regprocedure('public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid)') IS NOT NULL THEN
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc
   WHERE oid='public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure;
  IF actual IS DISTINCT FROM '81e21f92abe3d552f89d98c8d7b3b9d3' THEN
   RAISE EXCEPTION 'Portal publication source changed; preserve before replay';
  END IF;
 END IF;
END $e09_publication_dependencies$;

-- Preserve the original function OID, ABI, owner, ACL and every unrelated branch.
-- Ordinary action_advance is not the HIGH stored-call customer-publication path.
DO $e09_ordinary_publication_fence$
DECLARE definition text; body_hash text;
 anchor constant text:=E'  _next := COALESCE(p_to_status, _row.status);';
 guard constant text:=E'\n\n  -- E09: private customer requests publish only through the original HIGH stored-call gate.\n  IF _row.action_kind = ''client.portal_recommendation'' AND _next IN (''drafted'',''executing'') THEN\n    RAISE EXCEPTION ''PORTAL_REQUEST_APPROVED_PUBLICATION_REQUIRED'' USING ERRCODE=''42501'';\n  END IF;';
BEGIN
 SELECT pg_catalog.md5(prosrc),pg_catalog.pg_get_functiondef(oid) INTO body_hash,definition
  FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.advance_action(uuid,text,jsonb,text,uuid,uuid,jsonb,text,text,uuid)');
 IF body_hash='0d412f9c0a734aeb2815dca39ab061a3' THEN RETURN; END IF;
 IF body_hash IS DISTINCT FROM '66dcedb5e40dd43a54373c0e0ded1884'
  OR (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,anchor,'')))/pg_catalog.length(anchor)<>1 THEN
  RAISE EXCEPTION 'Original advance source changed; preserve and reconcile before Portal publication';
 END IF;
 EXECUTE pg_catalog.replace(definition,anchor,anchor||guard);
END $e09_ordinary_publication_fence$;

CREATE OR REPLACE FUNCTION public.share_client_portal_request(
 _expected_actor_id uuid,_expected_tenant_id uuid,_confirmation_id uuid,
 _fingerprint text,_claimed_in_request uuid,_thread_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $e09_request_share$
DECLARE
 proposal public.paige_pending_confirmations%ROWTYPE;
 customer public.clients%ROWTYPE;
 work public.paige_actions%ROWTYPE;
 item public.paige_customer_actions%ROWTYPE;
 kind public.paige_action_kinds%ROWTYPE;
 approved jsonb;
 publication jsonb;
 publication_result jsonb;
 v_work_id uuid;
 v_contact_id uuid;
 v_customer_action_id uuid;
 source_version timestamptz;
 access_version timestamptz;
 v_published_at timestamptz;
BEGIN
 IF _expected_actor_id IS NULL OR _expected_tenant_id IS NULL OR _confirmation_id IS NULL
  OR _claimed_in_request IS NULL OR _fingerprint IS NULL OR _fingerprint !~ '^[a-f0-9]{16}$' THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_APPROVAL_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 -- ORIGINAL owner/profile lock serializes active-business switches. Inputs are
 -- comparisons, never an assumed actor, a service identity or an approval token.
 IF public._client_portal_access_authorize(_expected_actor_id,_expected_tenant_id,true) IS DISTINCT FROM 'standalone'
  OR NOT public.is_tenant_member(_expected_tenant_id)
  OR NOT public.has_any_role(auth.uid(),ARRAY['admin','super_admin']) THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.tenants t WHERE t.id=_expected_tenant_id AND t.status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;

 -- Read only this actor's common proposal to resolve the ORIGINAL targets. It is
 -- reread/locked below after source locks; no caller-authored approval metadata.
 SELECT p.* INTO proposal FROM public.paige_pending_confirmations p
  WHERE p.id=_confirmation_id AND p.user_id=_expected_actor_id AND p.tenant_id=_expected_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_REQUEST_APPROVAL_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 approved:=proposal.args;
 IF pg_catalog.jsonb_typeof(approved) IS DISTINCT FROM 'object'
  OR NOT approved ?& ARRAY['expected_tenant_id','contact_id','work_id','version','title','body','recipient_user_id','access_version']
  OR approved-ARRAY['expected_tenant_id','contact_id','work_id','version','title','body','recipient_user_id','access_version']<>'{}'::jsonb
  OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(approved) e WHERE
   (e.key<>'access_version' AND pg_catalog.jsonb_typeof(e.value) IS DISTINCT FROM 'string')
   OR (e.key='access_version' AND pg_catalog.jsonb_typeof(e.value) NOT IN ('string','null')))
  OR approved->>'expected_tenant_id' IS DISTINCT FROM _expected_tenant_id::text THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_APPROVAL_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 BEGIN
  v_work_id:=(approved->>'work_id')::uuid;v_contact_id:=(approved->>'contact_id')::uuid;
  source_version:=(approved->>'version')::timestamptz;
  access_version:=(approved->>'access_version')::timestamptz;
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_APPROVAL_UNAVAILABLE' USING ERRCODE='42501';
 END;
 IF v_work_id IS NULL OR v_contact_id IS NULL OR source_version IS NULL OR NOT pg_catalog.isfinite(source_version)
  OR (access_version IS NOT NULL AND NOT pg_catalog.isfinite(access_version))
  OR pg_catalog.char_length(approved->>'title') NOT BETWEEN 1 AND 160
  OR pg_catalog.char_length(approved->>'body') NOT BETWEEN 1 AND 4000 THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_APPROVAL_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 SELECT c.* INTO customer FROM public.clients c WHERE c.id=v_contact_id AND c.tenant_id=_expected_tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 SELECT k.* INTO kind FROM public.paige_action_kinds k WHERE k.slug='client.portal_recommendation' FOR SHARE;
 SELECT a.* INTO work FROM public.paige_actions a WHERE a.id=v_work_id AND a.tenant_id=_expected_tenant_id
  AND a.contact_id=v_contact_id AND a.created_by=_expected_actor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000'; END IF;
 SELECT p.* INTO proposal FROM public.paige_pending_confirmations p WHERE p.id=_confirmation_id FOR SHARE;

 -- Every lock may have waited. Revalidate original actor/owner/Work standing,
 -- exact stored claim, selected relationship, access and client-owned consent.
 PERFORM public._client_portal_access_authorize(_expected_actor_id,_expected_tenant_id,true);
 IF NOT public.is_tenant_member(_expected_tenant_id)
  OR NOT public.has_any_role(auth.uid(),ARRAY['admin','super_admin'])
  OR customer.status IS DISTINCT FROM 'active' OR customer.merged_into_contact_id IS NOT NULL
  OR customer.portal_access_state IS DISTINCT FROM 'open' OR customer.linked_user_id IS NULL
  OR customer.linked_user_id::text IS DISTINCT FROM approved->>'recipient_user_id'
  OR customer.portal_access_changed_at IS DISTINCT FROM access_version
  OR customer.paige_shared_context_consent IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;
 IF proposal.user_id IS DISTINCT FROM _expected_actor_id OR proposal.tenant_id IS DISTINCT FROM _expected_tenant_id
  OR proposal.tool_name IS DISTINCT FROM 'client_portal_request_share' OR proposal.args IS DISTINCT FROM approved
  OR proposal.thread_id IS DISTINCT FROM _thread_id OR proposal.scoped_client_id IS NOT NULL
  OR proposal.fingerprint IS DISTINCT FROM _fingerprint OR proposal.claimed_in_request IS DISTINCT FROM _claimed_in_request
  OR proposal.issued_in_request IS NULL OR proposal.issued_in_request=_claimed_in_request
  OR proposal.server_issued_at IS NULL OR proposal.consumed_at IS NULL
  OR NOT pg_catalog.isfinite(proposal.server_issued_at) OR NOT pg_catalog.isfinite(proposal.consumed_at)
  OR NOT pg_catalog.isfinite(proposal.expires_at) OR proposal.server_issued_at>proposal.consumed_at
  OR proposal.consumed_at>pg_catalog.clock_timestamp() OR proposal.consumed_at>=proposal.expires_at THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_APPROVAL_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 IF work.action_kind IS DISTINCT FROM 'client.portal_recommendation'
  OR work.payload#>'{client_portal_private_request,schema_version}' IS DISTINCT FROM '1'::jsonb
  OR work.payload#>>'{client_portal_private_request,intent_id}' IS NULL
  OR work.title IS DISTINCT FROM approved->>'title' OR work.summary IS DISTINCT FROM approved->>'body'
  OR work.assigned_to_user_id IS DISTINCT FROM _expected_actor_id THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000';
 END IF;

 publication:=work.payload->'client_portal_publication';
 IF work.customer_action_id IS NOT NULL THEN
  -- Historical reconciliation only: never a new execution, even after expiry
  -- or a changed current autonomy setting. Same common claim/args/Work required.
  IF work.status IS DISTINCT FROM 'done' OR publication->>'confirmation_id' IS DISTINCT FROM proposal.id::text
   OR publication->'approved_args' IS DISTINCT FROM approved
   OR publication->>'claimed_in_request' IS DISTINCT FROM _claimed_in_request::text
   OR publication->'schema_version' IS DISTINCT FROM '1'::jsonb THEN
   RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000';
  END IF;
  -- Historical read only. The original response writer locks PCA -> contact ->
  -- Work. Taking a PCA lock after our contact/Work locks would invert that order.
  -- No customer mutation or copy of customer words occurs on this replay path.
  SELECT a.* INTO item FROM public.paige_customer_actions a WHERE a.id=work.customer_action_id
   AND a.tenant_id=_expected_tenant_id AND a.contact_id=v_contact_id;
  IF NOT FOUND OR item.initiated_by_admin_id IS DISTINCT FROM _expected_actor_id OR item.action_type IS DISTINCT FROM 'recommendation'
   OR item.title IS DISTINCT FROM approved->>'title' OR item.body IS DISTINCT FROM approved->>'body'
   OR item.payload_json IS DISTINCT FROM '{}'::jsonb THEN
   RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000';
  END IF;
  RETURN pg_catalog.jsonb_build_object('schema_version',1,'actor_id',auth.uid(),'tenant_id',_expected_tenant_id,
   'contact_id',v_contact_id,'work_id',work.id,'customer_action_id',item.id,'status','shared','replayed',true,'published_at',work.executed_at);
 END IF;
 IF work.status IS DISTINCT FROM 'assigned' OR work.draft_content IS NOT NULL OR work.approval_id IS NOT NULL
  OR publication IS NOT NULL OR work.updated_at IS DISTINCT FROM source_version
  OR kind.enabled IS DISTINCT FROM true OR kind.executor IS DISTINCT FROM 'surface_to_client'
  OR kind.draft_subagent_slug IS NOT NULL OR (kind.tenant_id IS NOT NULL AND kind.tenant_id<>_expected_tenant_id) THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000';
 END IF;
 IF proposal.expires_at<=pg_catalog.clock_timestamp()
  OR coalesce(public.resolve_tool_autonomy(_expected_tenant_id,'client_portal_request_share'),'off') NOT IN ('confirm','auto') THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_APPROVAL_UNAVAILABLE' USING ERRCODE='42501';
 END IF;

 -- SAME original publisher, PCA, customer notification and domain audit. Closed
 -- public payload: private intent, approval evidence and Work metadata stay here.
 publication_result:=public.admin_propose_paige_actions(v_contact_id,pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
  'action_type','recommendation','title',approved->>'title','body',approved->>'body','payload','{}'::jsonb)));
 IF publication_result->'ok' IS DISTINCT FROM 'true'::jsonb OR publication_result->>'count' IS DISTINCT FROM '1'
  OR pg_catalog.jsonb_typeof(publication_result->'ids') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(publication_result->'ids')<>1 THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_PUBLICATION_UNAVAILABLE' USING ERRCODE='55000';
 END IF;
 v_customer_action_id:=(publication_result#>>'{ids,0}')::uuid;
 IF v_customer_action_id IS NULL THEN RAISE EXCEPTION 'PORTAL_REQUEST_PUBLICATION_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 v_published_at:=pg_catalog.clock_timestamp();
 UPDATE public.paige_actions a SET status='done',customer_action_id=v_customer_action_id,
  executed_at=v_published_at,resolved_at=v_published_at,result=publication_result,
  payload=coalesce(a.payload,'{}'::jsonb)||pg_catalog.jsonb_build_object('client_portal_publication',pg_catalog.jsonb_build_object(
   'schema_version',1,'confirmation_id',proposal.id,'claimed_in_request',_claimed_in_request,'approved_args',approved))
 WHERE a.id=work.id;
 INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
 VALUES(auth.uid(),'paige_action','advance_action',work.id,pg_catalog.jsonb_build_object('to','done','kind',work.action_kind,
  'customer_action_id',v_customer_action_id,'confirmation_id',proposal.id));
 RETURN pg_catalog.jsonb_build_object('schema_version',1,'actor_id',auth.uid(),'tenant_id',_expected_tenant_id,
  'contact_id',v_contact_id,'work_id',work.id,'customer_action_id',v_customer_action_id,'status','shared','replayed',false,'published_at',v_published_at);
END $e09_request_share$;

REVOKE ALL ON FUNCTION public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid) IS
 'Owner-JWT original Work publication using a consumed trusted common HIGH proposal, exact source/version/words and current client access/consent. No issuing/claiming approval, provider or private payload projection. Same original Work/PCA reconciliation after uncertain acknowledgment. Unmounted until the canonical command is integrated.';
NOTIFY pgrst,'reload schema';
COMMIT;
