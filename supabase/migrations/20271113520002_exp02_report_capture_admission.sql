-- Original document submit only: capture permitted historical Metric evidence
-- once under the original work lock. No new store, issuer, approval or executor.
-- Chat's typed admission/catalogue and authenticated report acceptance are separate.
BEGIN;
DO $report_admission$
DECLARE fn regprocedure := 'public.submit_paige_document_work(uuid,uuid,jsonb)'::regprocedure;
 source text; definition text; changed text; prior_acl aclitem[]; i integer;
 before_fragments text[] := ARRAY[
  $a$  _scope text;$a$,
  $a$  if (_request_payload->>'doc_type') not in ($a$,
  $a$  select t.tenant_id into _tenant$a$,
  $a$  _authority := jsonb_build_object($a$,
  $a$  if _stored is null then
    update public.paige_durable_work
       set request_payload = _request_payload, updated_at = now(), version = version + 1
     where id = _created.work_id;
  elsif _stored is distinct from _request_payload then
    raise exception 'DURABLE_WORK_INTENT_REPLAY_MISMATCH' using errcode = '22023';
  end if;$a$
 ];
 after_fragments text[] := ARRAY[
  $a$  _scope text;
  _is_report boolean := false;
  _capture jsonb;
  _references jsonb;
  _period_start timestamptz;
  _period_end timestamptz;$a$,
  $a$  _is_report := coalesce(_request_payload->>'doc_type' = 'business_review',false);
  if _is_report then
    if jsonb_typeof(_request_payload->'version') is distinct from 'number'
      or jsonb_typeof(_request_payload->'title') is distinct from 'string'
      or jsonb_typeof(_request_payload->'brief') is distinct from 'string'
      or exists (select 1 from jsonb_object_keys(_request_payload) k(key)
        where key not in ('version','doc_type','title','brief','report_period','evidence_refs')) then
      raise exception 'DURABLE_DOCUMENT_REPORT_BRIEF_INVALID' using errcode = '22023';
    end if;
    if jsonb_typeof(_request_payload->'report_period') is distinct from 'object'
      or jsonb_typeof(_request_payload->'evidence_refs') is distinct from 'array' then
      raise exception 'DURABLE_DOCUMENT_REPORT_BRIEF_INVALID' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_object_keys(_request_payload->'report_period') k(key)
        where key not in ('key','start','end'))
      or not coalesce(_request_payload->'report_period'->>'key' in ('month','quarter'),false)
      or jsonb_typeof(_request_payload->'report_period'->'start') is distinct from 'string'
      or jsonb_typeof(_request_payload->'report_period'->'end') is distinct from 'string'
      or (_request_payload->'report_period'->>'start') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or (_request_payload->'report_period'->>'end') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or jsonb_array_length(_request_payload->'evidence_refs') not between 1 and 12
      or exists (select 1 from jsonb_array_elements(_request_payload->'evidence_refs') r(value)
        where jsonb_typeof(value) <> 'string' or (value #>> '{}') !~ '^aneb_v1_[0-9a-f]{64}$')
      or (select count(distinct value) from jsonb_array_elements(_request_payload->'evidence_refs') r(value))
        <> jsonb_array_length(_request_payload->'evidence_refs') then
      raise exception 'DURABLE_DOCUMENT_REPORT_BRIEF_INVALID' using errcode = '22023';
    end if;
    begin
      _period_start := (_request_payload->'report_period'->>'start')::timestamptz;
      _period_end := (_request_payload->'report_period'->>'end')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'DURABLE_DOCUMENT_REPORT_PERIOD_INVALID' using errcode = '22023';
    end;
    if _period_end <= _period_start then
      raise exception 'DURABLE_DOCUMENT_REPORT_PERIOD_INVALID' using errcode = '22023';
    end if;
  else
  if (_request_payload->>'doc_type') not in ($a$,
  $a$  end if; -- original nine-type validation remains unchanged above

  select t.tenant_id into _tenant$a$,
  $a$  if _is_report and public._analytics_metric_actor_authorized(_actor,_tenant) is distinct from true then
    raise exception 'DURABLE_DOCUMENT_METRIC_AUTHORITY_CHANGED' using errcode = '42501';
  end if;
  _authority := jsonb_build_object($a$,
  $a$  -- The original create/row-lock may wait; entry authority is not a lease.
  if _is_report and public._analytics_metric_actor_authorized(_actor,_tenant) is distinct from true then
    raise exception 'DURABLE_DOCUMENT_METRIC_AUTHORITY_CHANGED' using errcode = '42501';
  end if;
  if _stored is null then
    if _is_report then
      -- The original resolver owns scope, expiry/revocation and source revision.
      -- Capture happens after the original row lock and rolls back with this act.
      _capture := public._paige_document_capture_metric_evidence(_request_payload->'evidence_refs');
      if exists (select 1 from jsonb_array_elements(_capture->'measurements') m
        where m->'range'->>'key' is distinct from _request_payload->'report_period'->>'key'
          or (m->'range'->>'start')::timestamptz is distinct from _period_start
          or (m->'range'->>'end')::timestamptz is distinct from _period_end) then
        raise exception 'DURABLE_DOCUMENT_REPORT_PERIOD_MISMATCH' using errcode = '22023';
      end if;
      _stored := (_request_payload - 'evidence_refs') || jsonb_build_object('report_evidence',_capture);
    else
      _stored := _request_payload;
    end if;
    update public.paige_durable_work
       set request_payload = _stored, updated_at = now(), version = version + 1
     where id = _created.work_id;
  elsif _is_report then
    -- Replaying the SAME original intent never rereads/replaces captured facts,
    -- even after a reference expires. Current actor/thread gates still apply.
    if jsonb_typeof(_stored->'report_evidence'->'measurements') is distinct from 'array'
      or (_stored - 'report_evidence') is distinct from (_request_payload - 'evidence_refs') then
      raise exception 'DURABLE_WORK_INTENT_REPLAY_MISMATCH' using errcode = '22023';
    end if;
    select jsonb_agg(m->'evidence_ref' order by ordinal) into _references
      from jsonb_array_elements(_stored->'report_evidence'->'measurements') with ordinality r(m,ordinal);
    if _references is distinct from _request_payload->'evidence_refs' then
      raise exception 'DURABLE_WORK_INTENT_REPLAY_MISMATCH' using errcode = '22023';
    end if;
  elsif _stored is distinct from _request_payload then
    raise exception 'DURABLE_WORK_INTENT_REPLAY_MISMATCH' using errcode = '22023';
  end if;$a$
 ];
BEGIN
 SELECT p.prosrc,pg_get_functiondef(p.oid),p.proacl INTO source,definition,prior_acl FROM pg_proc p WHERE p.oid=fn;
 IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=fn AND p.prosecdef
   AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']
   AND has_function_privilege('authenticated',p.oid,'EXECUTE')
   AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
   AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)) THEN
  RAISE EXCEPTION 'DOCUMENT_REPORT_ADMISSION_METADATA_CHANGED';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public._paige_document_capture_metric_evidence(jsonb)'::regprocedure
   AND NOT p.prosecdef AND pg_get_userbyid(p.proowner)='postgres'
   AND md5(p.prosrc)='151a73a04e1e0d97ce2f641a5ee34c26'
   AND p.proconfig=ARRAY['search_path=""','TimeZone=UTC']
   AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
   AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
   AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
   AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)) THEN
  RAISE EXCEPTION 'DOCUMENT_REPORT_CAPTURE_METADATA_CHANGED';
 END IF;
 IF md5(source) <> '61b3191e13ddcfc17f59c43ba90dc0ff' THEN
  changed := source;
  FOR i IN REVERSE array_length(after_fragments,1)..1 LOOP
    changed := replace(changed,after_fragments[i],before_fragments[i]);
  END LOOP;
  IF md5(changed)='61b3191e13ddcfc17f59c43ba90dc0ff' THEN RETURN; END IF;
  RAISE EXCEPTION 'DOCUMENT_REPORT_ADMISSION_SOURCE_CHANGED';
 END IF;
 changed := source;
 FOR i IN 1..array_length(before_fragments,1) LOOP
  IF (length(changed)-length(replace(changed,before_fragments[i],'')))/length(before_fragments[i]) <> 1 THEN
    RAISE EXCEPTION 'DOCUMENT_REPORT_ADMISSION_ANCHOR_CHANGED: %',i;
  END IF;
  changed := replace(changed,before_fragments[i],after_fragments[i]);
 END LOOP;
 EXECUTE replace(definition,source,changed);
 IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=fn AND md5(p.prosrc)=md5(changed)
   AND p.proacl IS NOT DISTINCT FROM prior_acl AND p.prosecdef
   AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']) THEN
  RAISE EXCEPTION 'DOCUMENT_REPORT_ADMISSION_METADATA_CHANGED';
 END IF;
END $report_admission$;
COMMIT;
