-- Original atomic document writer: future historical report support only.
-- Public submit remains unchanged; no report worker/type/Chat activation here.
BEGIN;
DO $report_artifact$
DECLARE fn regprocedure := 'public.complete_paige_document_work(uuid,text,text,text,jsonb,text,text,integer,integer)'::regprocedure;
 source text; definition text; changed text; prior_acl aclitem[]; i integer;
 before_fragments text[] := ARRAY[
  $a$  _inserted_turn boolean := false;$a$,
  $a$  if _work.status = 'succeeded' then$a$,
  $a$'sales_offer','agreement_draft')$a$,
  $a$jsonb_build_object('document_purpose', case when _doc_type = 'agreement_draft' then 'agreement_draft' else 'draft' end),
      _work.id, 1$a$,
  $a$case when _doc_type = 'agreement_draft' then 'agreement_draft' else 'draft' end$a$,
  $a$if _content.id is null or _turn is null then$a$,
  $a$or _content.kind <> 'document' or _content.work_id is distinct from _work.id then$a$
 ];
 after_fragments text[] := ARRAY[
  $a$  _inserted_turn boolean := false;
  _is_report boolean;
  _artifact_meta jsonb;
  _report_provenance jsonb;$a$,
  $a$  _is_report := coalesce(_work.request_payload->>'doc_type' = 'business_review',false);
  if _is_report is distinct from coalesce(_doc_type = 'business_review',false) then
    raise exception 'DURABLE_DOCUMENT_REPORT_TYPE_MISMATCH' using errcode = '22023';
  end if;
  _artifact_meta := jsonb_build_object('document_purpose',CASE WHEN _doc_type='agreement_draft' THEN 'agreement_draft' ELSE 'draft' END);
  if _is_report then
    if _work.capability_key <> 'document_generate'
      or _work.request_payload ?| ARRAY['target_content_id','expected_revision']
      or _provider is not null or _model is not null or _tokens_used is distinct from 0
      or jsonb_typeof(_work.request_payload->'report_evidence') is distinct from 'object'
      or _work.request_payload->'report_evidence'->>'version' is distinct from '1'
      or jsonb_typeof(_work.request_payload->'report_evidence'->'measurements') is distinct from 'array'
      or jsonb_typeof(_work.request_payload->'report_period') is distinct from 'object' then
      raise exception 'DURABLE_DOCUMENT_REPORT_CAPTURE_INVALID' using errcode = '22023';
    end if;
    if jsonb_array_length(_work.request_payload->'report_evidence'->'measurements') not between 1 and 12
      or pg_column_size(_work.request_payload->'report_evidence') > 24576
      or nullif(_work.request_payload->'report_evidence'->>'captured_at','') is null
      or not coalesce(_work.request_payload->'report_period'->>'key' in ('month','quarter'),false)
      or nullif(_work.request_payload->'report_period'->>'start','') is null
      or nullif(_work.request_payload->'report_period'->>'end','') is null
      or exists (select 1 from jsonb_array_elements(_work.request_payload->'report_evidence'->'measurements') m
        where jsonb_typeof(m) is distinct from 'object') then
      raise exception 'DURABLE_DOCUMENT_REPORT_CAPTURE_INVALID' using errcode = '22023';
    end if;
    if not exists (select 1 from public.paige_chat_threads t where t.id=_work.thread_id
      and t.tenant_id=_work.tenant_id and t.caller_user_id=_work.initiating_user_id and not t.is_archived) then
      raise exception 'DURABLE_DOCUMENT_REPORT_CONTEXT_CHANGED' using errcode = '42501';
    end if;
    -- Closed provenance projection from the immutable original capture, never
    -- another metric calculation or a caller-supplied second source of truth.
    select jsonb_agg(jsonb_build_object(
      'metric_key',m->'metric_key','metric_version',m->'metric_version',
      'source_revision_ref',m->'source_revision_ref','source_refs',m->'source_refs',
      'as_of',m->'as_of','range',m->'range','freshness',m->'freshness',
      'coverage',m->'coverage','exclusions',m->'exclusions','caveats',m->'caveats',
      'business_time_zone',m->'business_time_zone')) into _report_provenance
     from jsonb_array_elements(_work.request_payload->'report_evidence'->'measurements') m;
    _artifact_meta := jsonb_build_object('document_purpose','metric_business_review',
      'captured_at',_work.request_payload->'report_evidence'->'captured_at',
      'report_period',jsonb_build_object('key',_work.request_payload->'report_period'->'key',
        'start',_work.request_payload->'report_period'->'start','end',_work.request_payload->'report_period'->'end'),
      'metric_provenance',_report_provenance);
  end if;
  if _work.status = 'succeeded' then$a$,
  $a$'sales_offer','agreement_draft','business_review')$a$,
  $a$_artifact_meta,
      _work.id, 1$a$,
  $a$_artifact_meta->>'document_purpose'$a$,
  $a$if _content.id is null or _turn is null
      or (_is_report and _content.meta is distinct from _artifact_meta) then$a$,
  $a$or _content.kind <> 'document' or _content.work_id is distinct from _work.id
     or (_is_report and (_content.meta is distinct from _artifact_meta or _content.status is distinct from 'draft')) then$a$
 ];
 expected_counts integer[] := ARRAY[1,1,1,1,3,1,1];
BEGIN
 SELECT p.prosrc,pg_get_functiondef(p.oid),p.proacl INTO source,definition,prior_acl FROM pg_proc p WHERE p.oid=fn;
 IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=fn AND p.prosecdef AND pg_get_userbyid(p.proowner)='postgres'
   AND p.proconfig=ARRAY['search_path=""'] AND has_function_privilege('service_role',p.oid,'EXECUTE')
   AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)) THEN
  RAISE EXCEPTION 'DOCUMENT_REPORT_ARTIFACT_METADATA_CHANGED';
 END IF;
 IF md5(source) <> 'c0a5e4a1651e70994225865a232658d7' THEN
  changed := source;
  FOR i IN REVERSE array_length(after_fragments,1)..1 LOOP
   changed := replace(changed,after_fragments[i],before_fragments[i]);
  END LOOP;
  IF md5(changed)='c0a5e4a1651e70994225865a232658d7' THEN RETURN; END IF;
  RAISE EXCEPTION 'DOCUMENT_REPORT_ARTIFACT_SOURCE_CHANGED';
 END IF;
 changed := source;
 FOR i IN 1..array_length(before_fragments,1) LOOP
  IF (length(changed)-length(replace(changed,before_fragments[i],'')))/length(before_fragments[i]) <> expected_counts[i] THEN
   RAISE EXCEPTION 'DOCUMENT_REPORT_ARTIFACT_ANCHOR_CHANGED: %',i;
  END IF;
  changed := replace(changed,before_fragments[i],after_fragments[i]);
  definition := replace(definition,before_fragments[i],after_fragments[i]);
 END LOOP;
 EXECUTE definition;
 IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=fn AND md5(p.prosrc)=md5(changed) AND p.proacl IS NOT DISTINCT FROM prior_acl) THEN
  RAISE EXCEPTION 'DOCUMENT_REPORT_ARTIFACT_READBACK_MISMATCH';
 END IF;
END $report_artifact$;
COMMIT;
