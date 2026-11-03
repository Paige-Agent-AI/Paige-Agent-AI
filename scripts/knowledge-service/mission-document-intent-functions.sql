-- ORIGINAL Mission brief data admission. Private helpers; no new execution door.
CREATE FUNCTION public.normalize_business_mission_document_intent(p_tenant uuid,p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $intent$
DECLARE
 s jsonb;r jsonb;e jsonb;step jsonb;who jsonb;task jsonb;v text;due date;
 sources jsonb:='[]';steps jsonb:='[]';source_ids text[]:='{}';step_ids text[]:='{}';resolved text[]:='{}';layer text[];
 doc uuid;step_id uuid;person uuid;assignee uuid;quote_units integer:=0;i integer;
BEGIN
 IF p_tenant IS NULL THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
 IF p_intent IS NULL OR p_intent='null'::jsonb THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR pg_column_size(p_intent)>524288
  OR NOT(p_intent ?& ARRAY['contractVersion','sources','steps']) OR (SELECT count(*) FROM jsonb_object_keys(p_intent))<>3
  OR p_intent->'contractVersion' IS DISTINCT FROM '1'::jsonb
  OR jsonb_typeof(p_intent->'sources') IS DISTINCT FROM 'array' OR jsonb_typeof(p_intent->'steps') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023';
 END IF;
 IF jsonb_array_length(p_intent->'sources') NOT BETWEEN 1 AND 20 OR jsonb_array_length(p_intent->'steps') NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_intent->'sources') LOOP
  IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT(s ?& ARRAY['reference','title','excerpts'])
   OR (SELECT count(*) FROM jsonb_object_keys(s))<>3 OR jsonb_typeof(s->'reference') IS DISTINCT FROM 'object'
   OR jsonb_typeof(s->'title') IS DISTINCT FROM 'string' OR btrim(s->>'title')=''
   OR public.knowledge_utf16_length(s->>'title')>300 OR jsonb_typeof(s->'excerpts') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  r:=s->'reference';
  IF NOT(r ?& ARRAY['contractVersion','tenantId','documentId','revision','contentSha256']) OR (SELECT count(*) FROM jsonb_object_keys(r))<>5
   OR r->'contractVersion' IS DISTINCT FROM '1'::jsonb OR r->>'tenantId' IS DISTINCT FROM p_tenant::text
   OR jsonb_typeof(r->'documentId') IS DISTINCT FROM 'string' OR jsonb_typeof(r->'revision') IS DISTINCT FROM 'number'
   OR (r->>'revision' COLLATE pg_catalog."C") !~ '^[1-9][0-9]{0,9}$'
   OR (r->>'revision')::numeric>2147483647 OR jsonb_typeof(r->'contentSha256') IS DISTINCT FROM 'string'
   OR (r->>'contentSha256' COLLATE pg_catalog."C") !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  BEGIN doc:=(r->>'documentId')::uuid; EXCEPTION WHEN invalid_text_representation THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END;
  IF doc IS NULL OR r->>'documentId' IS DISTINCT FROM doc::text OR doc::text=ANY(source_ids)
   OR jsonb_array_length(s->'excerpts') NOT BETWEEN 1 AND 20 THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(s->'excerpts') LOOP
   IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR NOT(e ?& ARRAY['start','end','text'])
    OR (SELECT count(*) FROM jsonb_object_keys(e))<>3 OR jsonb_typeof(e->'start') IS DISTINCT FROM 'number'
    OR jsonb_typeof(e->'end') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'text') IS DISTINCT FROM 'string'
    OR (e->>'start' COLLATE pg_catalog."C") !~ '^[0-9]{1,6}$' OR (e->>'end' COLLATE pg_catalog."C") !~ '^[0-9]{1,6}$' THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
   IF (e->>'end')::integer<= (e->>'start')::integer OR (e->>'end')::integer>480000
    OR public.knowledge_utf16_length(e->>'text')<>(e->>'end')::integer-(e->>'start')::integer THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
   quote_units:=quote_units+public.knowledge_utf16_length(e->>'text');
   IF quote_units>12000 THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  END LOOP;
  source_ids:=array_append(source_ids,doc::text);
  sources:=sources||jsonb_build_array(jsonb_build_object('reference',r,'title',s->>'title','excerpts',s->'excerpts'));
 END LOOP;
 FOR step IN SELECT value FROM jsonb_array_elements(p_intent->'steps') LOOP
  IF jsonb_typeof(step) IS DISTINCT FROM 'object'
   OR NOT(step ?& ARRAY['id','title','description','responsible','dueOn','dependencies','sourceIds','basis','proposedTask'])
   OR (SELECT count(*) FROM jsonb_object_keys(step))<>9 OR jsonb_typeof(step->'id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(step->'title') IS DISTINCT FROM 'string' OR btrim(step->>'title')=''
   OR public.knowledge_utf16_length(step->>'title')>180 OR jsonb_typeof(step->'description') IS DISTINCT FROM 'string'
   OR btrim(step->>'description')='' OR public.knowledge_utf16_length(step->>'description')>4000
   OR jsonb_typeof(step->'responsible') IS DISTINCT FROM 'object' OR jsonb_typeof(step->'proposedTask') IS DISTINCT FROM 'object'
   OR jsonb_typeof(step->'dependencies') IS DISTINCT FROM 'array' OR jsonb_typeof(step->'sourceIds') IS DISTINCT FROM 'array'
   OR jsonb_typeof(step->'basis') IS DISTINCT FROM 'string' OR step->>'basis' NOT IN ('recommendation','source_obligation') THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  BEGIN step_id:=(step->>'id')::uuid; EXCEPTION WHEN invalid_text_representation THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END;
  IF step_id IS NULL OR step->>'id' IS DISTINCT FROM step_id::text OR step_id::text=ANY(step_ids)
   OR jsonb_array_length(step->'dependencies')>49 OR jsonb_array_length(step->'sourceIds')>20
   OR (step->>'basis'='source_obligation' AND jsonb_array_length(step->'sourceIds')=0) THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  IF step->'dueOn'<>'null'::jsonb THEN
   IF jsonb_typeof(step->'dueOn') IS DISTINCT FROM 'string' OR (step->>'dueOn' COLLATE pg_catalog."C") !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
   BEGIN due:=(step->>'dueOn')::date; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END;
   IF to_char(due,'YYYY-MM-DD') IS DISTINCT FROM step->>'dueOn' THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(step->'sourceIds') x WHERE jsonb_typeof(x.value)<>'string' OR NOT(x.value#>>'{}'=ANY(source_ids)))
   OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(step->'sourceIds'))<>jsonb_array_length(step->'sourceIds')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(step->'dependencies') x WHERE jsonb_typeof(x.value)<>'string')
   OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(step->'dependencies'))<>jsonb_array_length(step->'dependencies') THEN
   RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  who:=step->'responsible';task:=step->'proposedTask';person:=NULL;assignee:=NULL;
  IF who->>'kind'='unassigned' AND (SELECT count(*) FROM jsonb_object_keys(who))=1 THEN NULL;
  ELSIF who->>'kind'='person' AND who ? 'userId' AND (SELECT count(*) FROM jsonb_object_keys(who))=2 AND jsonb_typeof(who->'userId')='string' THEN
   BEGIN person:=(who->>'userId')::uuid; EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END;
   IF person IS NULL OR who->>'userId' IS DISTINCT FROM person::text THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  ELSIF who->>'kind'='specialist' AND who ? 'alias' AND (SELECT count(*) FROM jsonb_object_keys(who))=2
   AND jsonb_typeof(who->'alias')='string' AND btrim(who->>'alias')<>'' AND public.knowledge_utf16_length(who->>'alias')<=80 THEN
   who:=jsonb_build_object('kind','specialist','alias',btrim(who->>'alias'));
  ELSE RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  IF NOT(task ?& ARRAY['action','assigneeUserId']) OR (SELECT count(*) FROM jsonb_object_keys(task))<>2
   OR task->>'action' IS DISTINCT FROM 'task.create' THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  IF task->'assigneeUserId'<>'null'::jsonb THEN
   IF jsonb_typeof(task->'assigneeUserId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
   BEGIN assignee:=(task->>'assigneeUserId')::uuid; EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END;
   IF assignee IS NULL OR person IS DISTINCT FROM assignee OR task->>'assigneeUserId' IS DISTINCT FROM assignee::text THEN
    RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  END IF;
  step_ids:=array_append(step_ids,step_id::text);
  steps:=steps||jsonb_build_array(step||jsonb_build_object('title',btrim(step->>'title'),'description',btrim(step->>'description'),'responsible',who));
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(steps) s CROSS JOIN LATERAL jsonb_array_elements_text(s.value->'dependencies') d
  WHERE NOT(d.value=ANY(step_ids))) THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
 -- Bounded topological validation, not an exponential recursive path walk.
 FOR i IN 1..50 LOOP
  SELECT array_agg(s.value->>'id') INTO layer FROM jsonb_array_elements(steps) s
   WHERE NOT(s.value->>'id'=ANY(resolved)) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(s.value->'dependencies') d WHERE NOT(d.value=ANY(resolved)));
  IF layer IS NULL THEN RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023'; END IF;
  resolved:=resolved||layer;
  EXIT WHEN cardinality(resolved)=cardinality(step_ids);
 END LOOP;
 RETURN jsonb_build_object('contractVersion',1,'sources',sources,'steps',steps);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
 RAISE EXCEPTION 'MISSION_DOCUMENT_INTENT_INVALID' USING ERRCODE='22023';
END $intent$;
REVOKE ALL ON FUNCTION public.normalize_business_mission_document_intent(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.lock_business_mission_document_sources(p_actor uuid,p_tenant uuid,p_intent jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $sources$
DECLARE s jsonb;actual jsonb;
BEGIN
 IF p_actor IS NULL OR p_actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF p_intent IS NULL THEN RETURN; END IF;
 -- Deterministic original source locks. The original helper retains caller,
 -- active tenant, member/profile locks, permitted read, version/hash and UTF16.
 FOR s IN SELECT value FROM jsonb_array_elements(p_intent->'sources') ORDER BY value->'reference'->>'documentId' LOOP
  actual:=public.lock_knowledge_source_evidence(p_actor,p_tenant,s->'reference',s->'excerpts');
  IF actual->>'title' IS DISTINCT FROM s->>'title' THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
 END LOOP;
END $sources$;
REVOKE ALL ON FUNCTION public.lock_business_mission_document_sources(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.project_business_mission_document_intent(p_tenant uuid,p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $project$
DECLARE s jsonb;permitted jsonb;doc jsonb;e jsonb;status text:='available';h text;
BEGIN
 IF p_intent IS NULL THEN RETURN jsonb_build_object('document_work_intent',NULL,'document_work_intent_status','none','document_work_intent_hash',NULL); END IF;
 h:=encode(sha256(convert_to(p_intent::text,'UTF8')),'hex');
 FOR s IN SELECT value FROM jsonb_array_elements(p_intent->'sources') LOOP
  BEGIN permitted:=public.read_tenant_knowledge(p_tenant,(s->'reference'->>'documentId')::uuid,1,0);
  EXCEPTION WHEN insufficient_privilege OR no_data_found THEN status:='source_unavailable';EXIT; END;
  IF permitted->>'tenant_id' IS DISTINCT FROM p_tenant::text OR jsonb_array_length(permitted->'documents') IS DISTINCT FROM 1 THEN status:='source_unavailable';EXIT; END IF;
  doc:=permitted->'documents'->0;
  IF doc->>'revision' IS DISTINCT FROM s->'reference'->>'revision'
   OR encode(sha256(convert_to(doc->>'content','UTF8')),'hex') IS DISTINCT FROM s->'reference'->>'contentSha256' THEN status:='source_changed';EXIT; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(s->'excerpts') LOOP
   IF NOT public.knowledge_utf16_excerpt_matches(doc->>'content',(e->>'start')::integer,(e->>'end')::integer,e->>'text') THEN status:='source_changed';EXIT; END IF;
  END LOOP;
  EXIT WHEN status<>'available';
 END LOOP;
 -- Persisted history remains immutable, but a later source loss is never a raw
 -- quote disclosure or renewed Task authority. Keep only opaque intent identity.
 RETURN jsonb_build_object('document_work_intent',CASE WHEN status='available' THEN p_intent ELSE NULL END,
  'document_work_intent_status',status,'document_work_intent_hash',h);
END $project$;
REVOKE ALL ON FUNCTION public.project_business_mission_document_intent(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
