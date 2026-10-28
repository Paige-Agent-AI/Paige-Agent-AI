-- EXP04 private read only. Original Planning, Studio and Delivery writers own
-- every fact below. Not mounted in the public standing reader by this slice.
BEGIN;
DO $guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc
 WHERE oid=pg_catalog.to_regprocedure('public._sales_client_effective_terms(uuid,uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>'2d0bb3db63603ffe58b66b492ffc37ef'
  OR p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proacl IS NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
   WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'Original effective terms projection changed' USING ERRCODE='23514';
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc
 WHERE oid=pg_catalog.to_regprocedure('public._sales_client_reviewed_delivery(uuid,uuid,uuid)');
 IF FOUND AND (pg_catalog.md5(p.prosrc)<>'93f5fb101c0c54acab9ac2ac4a4f37e3'
  OR p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proacl IS NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
   WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee<>p.proowner)) THEN
  RAISE EXCEPTION 'Original reviewed delivery projection changed' USING ERRCODE='23514';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public._sales_client_reviewed_delivery(_tenant uuid,_client uuid,_agreement uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $delivery$
DECLARE e jsonb; base jsonb; m jsonb; ids jsonb; draft jsonb; step jsonb; entry jsonb;
 p public.plans%ROWTYPE; w public.plan_items%ROWTYPE;
 s public.operations_delivery_submissions%ROWTYPE; a public.studio_artifact_versions%ROWTYPE;
 r public.operations_delivery_client_releases%ROWTYPE;
 n integer; position integer:=0; work_id uuid; phase text; items jsonb:='[]'::jsonb;
BEGIN
 e:=public._sales_client_effective_terms(_tenant,_client,_agreement);
 IF e->>'state' IS DISTINCT FROM 'verified' THEN RETURN NULL; END IF;
 base:=pg_catalog.jsonb_build_object('schema_version',1,'state','unavailable',
  'tenant_id',_tenant,'client_id',_client,'commercial_terms_id',_agreement,
  'signing_id',e->'signing_id','signing_version',e->'signing_version',
  'content_sha256',e->'document_sha256','sealed_sha256',e->'sealed_sha256');
 -- Do not hide a conflicting or malformed linked plan by filtering its client,
 -- signature or state first. Exactly one original engagement must be inspectable.
 SELECT count(*) INTO n FROM public.plans
 WHERE tenant_id=_tenant AND metadata#>>'{operations_engagement,commercial_terms_id}'=_agreement::text;
 IF n=0 THEN RETURN base||pg_catalog.jsonb_build_object('state','not_linked'); END IF;
 IF n<>1 THEN RETURN base; END IF;
 SELECT * INTO p FROM public.plans
 WHERE tenant_id=_tenant AND metadata#>>'{operations_engagement,commercial_terms_id}'=_agreement::text;
 m:=p.metadata->'operations_engagement';
 IF p.status IS NULL OR p.status='archived'
  OR m->'contact_id' IS DISTINCT FROM pg_catalog.to_jsonb(_client)
  OR m->'agreement_id' IS DISTINCT FROM e->'signing_id'
  OR m->'offer_id' IS DISTINCT FROM e->'offer_id'
  OR m->'version' IS DISTINCT FROM e->'signing_version'
  OR m->'content_sha256' IS DISTINCT FROM e->'document_sha256'
  OR m->'sealed_sha256' IS DISTINCT FROM e->'sealed_sha256' THEN
  RETURN base||pg_catalog.jsonb_build_object('state','scope_changed','plan_id',p.id);
 END IF;
 ids:=m->'milestone_ids';draft:=m#>'{scope_draft,milestones}';
 IF pg_catalog.jsonb_typeof(ids) IS DISTINCT FROM 'array'
  OR pg_catalog.jsonb_typeof(draft) IS DISTINCT FROM 'array'
  OR m#>>'{scope_draft,scope_origin}' IS DISTINCT FROM 'owner_reviewed' THEN RETURN base; END IF;
 n:=pg_catalog.jsonb_array_length(ids);
 IF n NOT BETWEEN 1 AND 50 OR pg_catalog.jsonb_array_length(draft)<>n THEN RETURN base; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(ids) x
  WHERE pg_catalog.jsonb_typeof(x) IS DISTINCT FROM 'string'
   OR x#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  OR (SELECT count(DISTINCT x) FROM pg_catalog.jsonb_array_elements(ids) x)<>n THEN RETURN base; END IF;
 -- A newly introduced milestone is a scope revision, not silently omitted work.
 IF EXISTS(SELECT 1 FROM public.plan_items i WHERE i.plan_id=p.id AND i.item_type='milestone'
  AND NOT ids @> pg_catalog.jsonb_build_array(i.id::text)) THEN
  RETURN base||pg_catalog.jsonb_build_object('state','scope_changed','plan_id',p.id);
 END IF;
 FOR entry IN SELECT value FROM pg_catalog.jsonb_array_elements(ids) LOOP
  work_id:=(entry#>>'{}')::uuid;step:=draft->position;position:=position+1;
  SELECT * INTO w FROM public.plan_items WHERE id=work_id;
  IF NOT FOUND OR w.tenant_id IS DISTINCT FROM _tenant OR w.plan_id IS DISTINCT FROM p.id
   OR w.contact_id IS DISTINCT FROM _client OR w.item_type IS DISTINCT FROM 'milestone'
   OR w.status IS NULL OR w.status='cancelled'
   OR pg_catalog.jsonb_typeof(step) IS DISTINCT FROM 'object'
   OR pg_catalog.jsonb_typeof(step->'title') IS DISTINCT FROM 'string'
   OR pg_catalog.length(pg_catalog.btrim(step->>'title')) NOT BETWEEN 1 AND 500
   OR (step ? 'summary' AND pg_catalog.jsonb_typeof(step->'summary') NOT IN ('string','null'))
   OR coalesce(pg_catalog.length(step->>'summary'),0)>10000
   OR w.title IS DISTINCT FROM pg_catalog.btrim(step->>'title')
   OR w.summary IS DISTINCT FROM step->>'summary'
   OR w.metadata#>'{operations_engagement,agreement_id}' IS DISTINCT FROM e->'signing_id'
   OR w.metadata#>'{operations_engagement,commercial_terms_id}' IS DISTINCT FROM pg_catalog.to_jsonb(_agreement)
   OR w.metadata#>'{operations_engagement,version}' IS DISTINCT FROM e->'signing_version' THEN
   RETURN base||pg_catalog.jsonb_build_object('state','scope_changed','plan_id',p.id);
  END IF;
  -- Select globally by the original Work identity before validating tenant and
  -- source. A malformed newer revision must never reveal an older acceptance.
  SELECT * INTO s FROM public.operations_delivery_submissions
  WHERE work_item_id=work_id ORDER BY revision_no DESC,id LIMIT 1;
  IF NOT FOUND THEN
   items:=items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('work_item_id',work_id,
    'phase','not_submitted','submission_id',NULL,'submission_revision',NULL,
    'artifact_digest',NULL,'release_id',NULL,'decision_at',NULL));
   CONTINUE;
  END IF;
  IF s.tenant_id IS DISTINCT FROM _tenant OR s.plan_id IS DISTINCT FROM p.id OR s.client_id IS DISTINCT FROM _client
   OR s.revision_no IS NULL OR s.revision_no<1 OR s.artifact_digest IS NULL OR s.artifact_digest !~ '^[0-9a-f]{64}$'
   OR (SELECT count(*) FROM public.operations_delivery_submissions WHERE work_item_id=work_id AND revision_no=s.revision_no)<>1
   OR s.submitted_by IS NULL OR s.reviewer_user_id IS NULL OR s.submitted_at IS NULL
   OR NOT coalesce((s.review_mode='second_person' AND s.reviewer_user_id<>s.submitted_by)
    OR (s.review_mode='owner_self_review' AND s.reviewer_user_id=s.submitted_by),false) THEN RETURN base; END IF;
  SELECT * INTO a FROM public.studio_artifact_versions WHERE id=s.artifact_version_id;
  IF NOT FOUND OR a.tenant_id IS DISTINCT FROM _tenant OR a.snapshot IS NULL
   OR pg_catalog.encode(extensions.digest(a.snapshot::text,'sha256'),'hex') IS DISTINCT FROM s.artifact_digest THEN RETURN base; END IF;
  IF s.state='in_review' THEN
   IF s.reviewed_by IS NOT NULL OR s.reviewed_at IS NOT NULL THEN RETURN base; END IF;
   phase:='internal_review';
  ELSIF s.state IN ('approved','revision_requested') THEN
   IF s.reviewed_by IS DISTINCT FROM s.reviewer_user_id OR s.reviewed_at IS NULL OR s.reviewed_at<s.submitted_at
    OR NOT EXISTS(SELECT 1 FROM public.audit_logs l WHERE l.entity='operations_delivery' AND l.entity_id=s.id
     AND l.action='delivery_reviewed' AND l.user_id=s.reviewed_by
     AND l.data->'tenant_id'=pg_catalog.to_jsonb(_tenant) AND l.data->>'state'=s.state
     AND l.data->'revision_no'=pg_catalog.to_jsonb(s.revision_no)) THEN RETURN base; END IF;
   phase:=CASE WHEN s.state='approved' THEN 'not_released' ELSE 'internal_revision_requested' END;
  ELSE RETURN base;
  END IF;
  SELECT count(*) INTO n FROM public.operations_delivery_client_releases WHERE submission_id=s.id;
  IF n>1 THEN RETURN base; END IF;
  r:=NULL;
  IF n=1 THEN
   SELECT * INTO r FROM public.operations_delivery_client_releases WHERE submission_id=s.id;
   IF s.state<>'approved' OR r.tenant_id IS DISTINCT FROM _tenant OR r.client_id IS DISTINCT FROM _client
    OR r.client_user_id IS NULL OR r.released_by IS NULL OR r.released_at IS NULL OR r.released_at<s.reviewed_at
    OR a.kind IS DISTINCT FROM 'content' OR a.snapshot->>'kind' IS DISTINCT FROM 'text'
    OR NOT EXISTS(SELECT 1 FROM public.audit_logs l WHERE l.entity='operations_delivery' AND l.entity_id=s.id
     AND l.action='delivery_released' AND l.user_id=r.released_by
     AND l.data->'tenant_id'=pg_catalog.to_jsonb(_tenant) AND l.data->'release_id'=pg_catalog.to_jsonb(r.id)) THEN RETURN base; END IF;
   IF r.state='awaiting_client' THEN
    IF r.decision_by IS NOT NULL OR r.decision_at IS NOT NULL THEN RETURN base; END IF;
    phase:='awaiting_client';
   ELSIF r.state IN ('accepted','client_revision_requested') THEN
    IF r.decision_by IS DISTINCT FROM r.client_user_id OR r.decision_at IS NULL OR r.decision_at<r.released_at
     OR (r.state='client_revision_requested' AND coalesce(pg_catalog.length(pg_catalog.btrim(r.client_note)),0)=0)
     OR NOT EXISTS(SELECT 1 FROM public.audit_logs l WHERE l.entity='operations_delivery' AND l.entity_id=s.id
      AND l.action='delivery_client_decision' AND l.user_id=r.decision_by
      AND l.data->'tenant_id'=pg_catalog.to_jsonb(_tenant) AND l.data->'release_id'=pg_catalog.to_jsonb(r.id)
      AND l.data->>'state'=r.state AND l.data->>'artifact_digest'=s.artifact_digest) THEN RETURN base; END IF;
    phase:=CASE WHEN r.state='accepted' THEN 'accepted' ELSE 'revision_requested' END;
   ELSE RETURN base;
   END IF;
  END IF;
  items:=items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('work_item_id',work_id,'phase',phase,
   'submission_id',s.id,'submission_revision',s.revision_no,'artifact_digest',s.artifact_digest,
   'release_id',r.id,'decision_at',CASE WHEN phase='internal_revision_requested' THEN s.reviewed_at ELSE r.decision_at END));
 END LOOP;
 RETURN base||pg_catalog.jsonb_build_object('state','verified','plan_id',p.id,
  'coverage_complete',true,'has_more',false,'milestone_count',pg_catalog.jsonb_array_length(ids),'items',items);
END
$delivery$;
REVOKE ALL ON FUNCTION public._sales_client_reviewed_delivery(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public._sales_client_reviewed_delivery(uuid,uuid,uuid) IS
 'Private bounded original reviewed-milestone/latest-submission/artifact/release/client-decision projection. Historical reviewed evidence only, no Work completion, financial calculation, new receipt, public execution authority or engagement-closure decision. Public reader/UI not mounted by this migration.';
-- Fail the first application atomically if project default privileges grant an
-- unexpected caller; a later replay is not the first private-ACL verification.
DO $readback$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc
 WHERE oid=pg_catalog.to_regprocedure('public._sales_client_reviewed_delivery(uuid,uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>'93f5fb101c0c54acab9ac2ac4a4f37e3'
  OR p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proacl IS NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
   WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'Private reviewed delivery readback changed' USING ERRCODE='23514';
 END IF;
END $readback$;
COMMIT;
