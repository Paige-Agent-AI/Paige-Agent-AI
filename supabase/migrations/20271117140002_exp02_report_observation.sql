-- Recognize the original immutable Business Review artifact in the EXISTING
-- observation. No submit, retry, claim, worker, grant, new reader or activation.
BEGIN;
SET LOCAL lock_timeout='3s';

DO $report_observation$
DECLARE
 fn regprocedure:='public.read_paige_durable_observation(uuid,uuid,uuid)'::regprocedure;
 source text; definition text; changed text; restored text; prior_acl aclitem[]; i integer;
 before_fragments text[]:=ARRAY[
  $a$ -- Original chat intent and domain work intent are deliberately distinct for documents.$a$,
  $a$m.body::jsonb->>'docType' in ('guide','one_pager','ebook','checklist','worksheet','proposal','offer_letter','sales_offer','agreement_draft')$a$
 ];
 after_fragments text[]:=ARRAY[
  $a$ -- A historical report remains subject to its ORIGINAL current Metric
 -- read permission. Stored Work/authority is not a reusable permission grant.
 if w.request_payload->>'doc_type'='business_review' then
  if public._paige_metric_report_readable(tenant) is distinct from true then return null; end if;
 end if;
 -- Original chat intent and domain work intent are deliberately distinct for documents.$a$,
  $a$(
       (m.body::jsonb->>'docType' in ('guide','one_pager','ebook','checklist','worksheet','proposal','offer_letter','sales_offer','agreement_draft')
        and coalesce(w.request_payload->>'doc_type','')<>'business_review')
       or (m.body::jsonb->>'docType'='business_review' and w.request_payload->>'doc_type'='business_review'
        and m.id=w.id and m.created_by=actor and m.status in ('draft','archived')
        and m.meta->>'document_purpose'='metric_business_review'
        and m.meta->'report_period'=w.request_payload->'report_period'
        and m.meta->>'captured_at'=w.request_payload->'report_evidence'->>'captured_at'
        and case when jsonb_typeof(m.meta->'metric_provenance')='array'
          then jsonb_array_length(m.meta->'metric_provenance') between 1 and 12 else false end)
      )$a$
 ];
BEGIN
 SELECT p.prosrc,pg_get_functiondef(p.oid),p.proacl INTO source,definition,prior_acl
  FROM pg_proc p WHERE p.oid=fn;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn AND p.prosecdef AND p.provolatile='s'
  AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']
  AND p.proargnames=ARRAY['_thread','_intent','_work']::text[] AND p.prorettype='jsonb'::regtype
  AND has_function_privilege('authenticated',p.oid,'EXECUTE')
  AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
  AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
  AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0))
 THEN RAISE EXCEPTION 'REPORT_OBSERVATION_METADATA_CHANGED'; END IF;
 -- Reuse the original report artifact RLS permission, never a second decision.
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public._paige_metric_report_readable(uuid)'::regprocedure
  AND md5(p.prosrc)='4336bfd19107ac41cf993644f24074a6' AND p.prosecdef AND p.provolatile='s'
  AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""'])
 THEN RAISE EXCEPTION 'REPORT_OBSERVATION_PERMISSION_CHANGED'; END IF;
 IF md5(source) IS DISTINCT FROM '04027e1ce3e68c7752f598283254046c' THEN
  restored:=source;
  FOR i IN REVERSE array_length(after_fragments,1)..1 LOOP
   IF (length(restored)-length(replace(restored,after_fragments[i],'')))/length(after_fragments[i])<>1
    THEN RAISE EXCEPTION 'REPORT_OBSERVATION_SOURCE_CHANGED'; END IF;
   restored:=replace(restored,after_fragments[i],before_fragments[i]);
  END LOOP;
  IF md5(restored) IS DISTINCT FROM '04027e1ce3e68c7752f598283254046c'
   THEN RAISE EXCEPTION 'REPORT_OBSERVATION_SOURCE_CHANGED'; END IF;
  RETURN; -- exact already-applied source only; unknown intervening work refuses
 END IF;
 changed:=source;
 FOR i IN 1..array_length(before_fragments,1) LOOP
  IF (length(changed)-length(replace(changed,before_fragments[i],'')))/length(before_fragments[i])<>1
   THEN RAISE EXCEPTION 'REPORT_OBSERVATION_ANCHOR_CHANGED'; END IF;
  changed:=replace(changed,before_fragments[i],after_fragments[i]);
  definition:=replace(definition,before_fragments[i],after_fragments[i]);
 END LOOP;
 EXECUTE definition;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn AND md5(p.prosrc)=md5(changed)
  AND p.proacl IS NOT DISTINCT FROM prior_acl AND p.prosecdef AND p.provolatile='s'
  AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']
  AND p.proargnames=ARRAY['_thread','_intent','_work']::text[] AND p.prorettype='jsonb'::regtype)
 THEN RAISE EXCEPTION 'REPORT_OBSERVATION_METADATA_CHANGED'; END IF;
END $report_observation$;
COMMIT;
