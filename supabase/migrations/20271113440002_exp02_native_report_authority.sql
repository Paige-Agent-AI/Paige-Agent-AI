-- Revalidate future report work in the original claim and atomic completion.
-- Public submission still admits only the original nine types. No activation.
BEGIN;

DO $report_authority$
DECLARE patch record; source text; definition text; changed text; prior_acl aclitem[];
BEGIN
 FOR patch IN SELECT * FROM (VALUES
  ('public.start_paige_document_work_execution(uuid)'::regprocedure,
   '81a2a0ab7dbf4384e6da22e5f11f9dd6',
   $before$  if not exists (
    select 1 from public.tenants t where t.id = _row.tenant_id and t.status = 'active'$before$,
   $after$  if (_row.request_payload->>'doc_type' = 'business_review'
    and public._analytics_metric_actor_authorized(_row.initiating_user_id,_row.tenant_id) is distinct from true)
  or not exists (
    select 1 from public.tenants t where t.id = _row.tenant_id and t.status = 'active'$after$),
  ('public.complete_paige_document_work(uuid,text,text,text,jsonb,text,text,integer,integer)'::regprocedure,
   '4c58e791d20db13b5dc8fe8fd6ce0c36',
   $before$  if _work.status = 'succeeded' then$before$,
   $after$  -- Stored work identity is context, never reusable Metric permission.
  -- Check before historical success readback as well as before new persistence.
  if (_work.request_payload->>'doc_type' = 'business_review' or _doc_type = 'business_review')
    and public._analytics_metric_actor_authorized(_work.initiating_user_id,_work.tenant_id) is distinct from true then
    raise exception 'DURABLE_DOCUMENT_METRIC_AUTHORITY_CHANGED' using errcode = '42501';
  end if;
  if _work.status = 'succeeded' then$after$)
 ) AS edits(fn,original_md5,before_fragment,after_fragment) LOOP
  SELECT p.prosrc,pg_get_functiondef(p.oid),p.proacl INTO source,definition,prior_acl
   FROM pg_proc p WHERE p.oid=patch.fn;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=patch.fn AND p.prosecdef
    AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']
    AND has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)) THEN
   RAISE EXCEPTION 'DOCUMENT_REPORT_AUTHORITY_METADATA_CHANGED: %',patch.fn;
  END IF;
  -- Only these exact current source bodies, including original title-role
  -- retirement, are reviewed. Unknown intervening source must fail loudly.
  IF md5(source) IS DISTINCT FROM patch.original_md5 THEN
   IF position(patch.after_fragment IN source)>0
    AND md5(replace(source,patch.after_fragment,patch.before_fragment))=patch.original_md5 THEN
    CONTINUE; -- exact replay, never accept an unrelated changed body
   END IF;
   RAISE EXCEPTION 'DOCUMENT_REPORT_AUTHORITY_SOURCE_CHANGED: %',patch.fn;
  END IF;
  IF (length(source)-length(replace(source,patch.before_fragment,''))) / length(patch.before_fragment) <> 1 THEN
   RAISE EXCEPTION 'DOCUMENT_REPORT_AUTHORITY_ANCHOR_CHANGED: %',patch.fn;
  END IF;
  changed := replace(source,patch.before_fragment,patch.after_fragment);
  EXECUTE replace(definition,patch.before_fragment,patch.after_fragment);
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=patch.fn AND md5(p.prosrc)=md5(changed)
    AND p.proacl IS NOT DISTINCT FROM prior_acl AND p.prosecdef AND pg_get_userbyid(p.proowner)='postgres'
    AND p.proconfig=ARRAY['search_path=""']) THEN
   RAISE EXCEPTION 'DOCUMENT_REPORT_AUTHORITY_METADATA_CHANGED: %',patch.fn;
  END IF;
 END LOOP;
END $report_authority$;

COMMIT;
