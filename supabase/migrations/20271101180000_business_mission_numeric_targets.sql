BEGIN;
-- Owner-approved F7: numeric targets belong to existing Strategic Plays.
-- No actuals ledger, provider activation, Chat tool admission or new approval channel.
CREATE TABLE public.business_mission_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','paused','retired')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,mission_id) REFERENCES public.business_missions(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX business_mission_targets_mission_idx ON public.business_mission_targets(tenant_id,mission_id,updated_at DESC);

CREATE TABLE public.business_mission_target_versions (
  tenant_id uuid NOT NULL,
  target_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  state text NOT NULL CHECK (state IN ('active','paused','retired')),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition)='object' AND octet_length(definition::text)<=12000),
  revision_reason text NOT NULL CHECK (char_length(btrim(revision_reason)) BETWEEN 1 AND 1200),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,target_id,revision),
  FOREIGN KEY (tenant_id,target_id) REFERENCES public.business_mission_targets(tenant_id,id) ON DELETE CASCADE
);
CREATE TRIGGER business_mission_target_version_immutable
BEFORE UPDATE OR DELETE ON public.business_mission_target_versions
FOR EACH ROW EXECUTE FUNCTION public.prevent_business_mission_brief_mutation();

ALTER TABLE public.business_mission_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_mission_target_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_mission_targets,public.business_mission_target_versions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.business_mission_targets,public.business_mission_target_versions TO service_role;

-- Extend the existing domain idempotency receipt, not a replacement execution ledger.
ALTER TABLE public.business_mission_mutation_receipts DROP CONSTRAINT business_mission_mutation_receipts_operation_check;
ALTER TABLE public.business_mission_mutation_receipts ADD CONSTRAINT business_mission_mutation_receipts_operation_check
  CHECK (operation IN ('create','revise','transition','target_create','target_revise','target_transition'));

CREATE OR REPLACE FUNCTION public._business_mission_target_definition_valid(p_definition jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE m jsonb; p jsonb; desired text; upper_value text; start_at timestamptz; end_at timestamptz;
BEGIN
  IF p_definition IS NULL OR jsonb_typeof(p_definition)<>'object' OR octet_length(p_definition::text)>12000
    OR (SELECT count(*) FROM jsonb_object_keys(p_definition))<>6
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_definition) k WHERE k NOT IN ('title','metric','period','comparison','desired_value','upper_value'))
    OR jsonb_typeof(p_definition->'title')<>'string'
    OR char_length(btrim(p_definition->>'title')) NOT BETWEEN 3 AND 180 THEN RETURN false; END IF;
  m:=p_definition->'metric'; p:=p_definition->'period';
  IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['key','version','unit','value_kind','range_key','semantics']) k
      WHERE jsonb_typeof(m->k) IS DISTINCT FROM 'string')
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['start','end','time_zone']) k WHERE jsonb_typeof(p->k) IS DISTINCT FROM 'string')
    OR jsonb_typeof(p_definition->'comparison') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(m))<>9
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(m) k WHERE k NOT IN ('key','version','unit','value_kind','currency','dimensions','range_key','semantics','business_time_zone'))
    OR (m->>'key') !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
    OR char_length(m->>'key')>180 OR (m->>'version') !~ '^[0-9]+\.[0-9]+\.[0-9]+$'
    OR char_length(btrim(m->>'unit')) NOT BETWEEN 1 AND 80
    OR (m->>'value_kind') NOT IN ('count','decimal','currency_totals')
    OR (m->>'range_key') NOT IN ('week','month','quarter','year')
    OR (m->>'semantics') NOT IN ('current_snapshot','event_timestamp_cohort','current_status_date_cohort','source_readiness')
    OR jsonb_typeof(m->'dimensions') IS DISTINCT FROM 'object' OR octet_length((m->'dimensions')::text)>500 THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(m->'dimensions') e WHERE e.key !~ '^[a-z][a-z0-9_]{0,79}$' OR jsonb_typeof(e.value)<>'string' OR char_length(e.value#>>'{}')>120)
    OR (SELECT count(*) FROM jsonb_object_keys(p))<>3
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('start','end','time_zone'))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=p->>'time_zone') THEN RETURN false; END IF;
  IF (p->>'start') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    OR (p->>'end') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RETURN false; END IF;
  start_at:=(p->>'start')::timestamptz; end_at:=(p->>'end')::timestamptz;
  IF NOT isfinite(start_at) OR NOT isfinite(end_at) OR start_at>=end_at OR end_at-start_at>interval '10 years' THEN RETURN false; END IF;
  desired:=p_definition->>'desired_value'; upper_value:=p_definition->>'upper_value';
  IF jsonb_typeof(p_definition->'desired_value')<>'string' OR char_length(desired)>64
    OR desired !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'
    OR (p_definition->>'comparison') NOT IN ('at_least','at_most','within_range') THEN RETURN false; END IF;
  IF p_definition->>'comparison'='within_range' THEN
    IF jsonb_typeof(p_definition->'upper_value')<>'string' OR char_length(upper_value)>64
      OR upper_value !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$' OR desired::numeric>upper_value::numeric THEN RETURN false; END IF;
  ELSIF jsonb_typeof(p_definition->'upper_value') IS DISTINCT FROM 'null' THEN RETURN false; END IF;
  IF m->>'value_kind'='count' AND (desired !~ '^(0|[1-9][0-9]*)$' OR (upper_value IS NOT NULL AND upper_value !~ '^(0|[1-9][0-9]*)$')) THEN RETURN false; END IF;
  IF m->>'value_kind'='currency_totals' THEN
    IF m->>'unit'<>'currency_minor' OR jsonb_typeof(m->'currency') IS DISTINCT FROM 'string' OR (m->>'currency') !~ '^[a-z]{3}$'
      OR position('.' in desired)>0 OR position('.' in coalesce(upper_value,''))>0 THEN RETURN false; END IF;
  ELSIF jsonb_typeof(m->'currency') IS DISTINCT FROM 'null' THEN RETURN false; END IF;
  IF m->>'key'='sales.receivables.overdue_current' THEN
    IF m->>'version'<>'1.1.0' OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=m->>'business_time_zone') THEN RETURN false; END IF;
  ELSIF jsonb_typeof(m->'business_time_zone') IS DISTINCT FROM 'null' THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public._business_mission_target_definition_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_business_mission_target(p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; t uuid; answer jsonb;
BEGIN
  SELECT c.actor_id,c.tenant_id INTO a,t FROM public.business_mission_owner_context() c;
  SELECT jsonb_build_object('id',x.id,'tenant_id',x.tenant_id,'mission_id',x.mission_id,'revision',x.revision,'state',x.state,
    'created_by',x.created_by,'created_at',x.created_at,'updated_at',x.updated_at,'revision_reason',v.revision_reason)
    || v.definition INTO answer
  FROM public.business_mission_targets x JOIN public.business_mission_target_versions v
    ON v.tenant_id=x.tenant_id AND v.target_id=x.id AND v.revision=x.revision
  WHERE x.tenant_id=t AND x.id=p_target_id;
  IF answer IS NULL THEN RAISE EXCEPTION 'MISSION_TARGET_NOT_FOUND' USING errcode='P0002'; END IF;
  RETURN answer;
END $$;

CREATE OR REPLACE FUNCTION public.list_business_mission_targets(p_mission_id uuid,p_limit integer DEFAULT 100,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; t uuid; items jsonb; total_count bigint;
BEGIN
  SELECT c.actor_id,c.tenant_id INTO a,t FROM public.business_mission_owner_context() c;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset<0 OR p_offset>10000 THEN
    RAISE EXCEPTION 'MISSION_TARGET_ARGUMENTS_INVALID' USING errcode='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.business_missions m WHERE m.tenant_id=t AND m.id=p_mission_id) THEN
    RAISE EXCEPTION 'MISSION_NOT_FOUND' USING errcode='P0002'; END IF;
  SELECT count(*) INTO total_count FROM public.business_mission_targets x WHERE x.tenant_id=t AND x.mission_id=p_mission_id;
  SELECT coalesce(jsonb_agg(public.get_business_mission_target(x.id) ORDER BY x.updated_at DESC,x.id),'[]'::jsonb) INTO items
    FROM (SELECT id,updated_at FROM public.business_mission_targets WHERE tenant_id=t AND mission_id=p_mission_id
      ORDER BY updated_at DESC,id LIMIT p_limit OFFSET p_offset) x;
  RETURN jsonb_build_object('resolved_tenant_id',t,'targets',items,'total_count',total_count,'has_more',p_offset+jsonb_array_length(items)<total_count);
END $$;

CREATE OR REPLACE FUNCTION public.get_business_mission_target_revision(p_target_id uuid,p_revision integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; t uuid; answer jsonb;
BEGIN
  SELECT c.actor_id,c.tenant_id INTO a,t FROM public.business_mission_owner_context() c;
  SELECT jsonb_build_object('id',x.id,'tenant_id',x.tenant_id,'mission_id',x.mission_id,'revision',v.revision,'state',v.state,
      'created_by',v.created_by,'created_at',v.created_at,'revision_reason',v.revision_reason)||v.definition INTO answer
    FROM public.business_mission_targets x JOIN public.business_mission_target_versions v
      ON v.tenant_id=x.tenant_id AND v.target_id=x.id
    WHERE x.tenant_id=t AND x.id=p_target_id AND v.revision=p_revision;
  IF answer IS NULL THEN RAISE EXCEPTION 'MISSION_TARGET_NOT_FOUND' USING errcode='P0002'; END IF;
  RETURN answer;
END $$;

CREATE OR REPLACE FUNCTION public.list_business_mission_target_versions(p_target_id uuid,p_limit integer DEFAULT 100,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; t uuid; items jsonb; total_count bigint;
BEGIN
  SELECT c.actor_id,c.tenant_id INTO a,t FROM public.business_mission_owner_context() c;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset<0 OR p_offset>10000 THEN
    RAISE EXCEPTION 'MISSION_TARGET_ARGUMENTS_INVALID' USING errcode='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.business_mission_targets x WHERE x.tenant_id=t AND x.id=p_target_id) THEN
    RAISE EXCEPTION 'MISSION_TARGET_NOT_FOUND' USING errcode='P0002'; END IF;
  SELECT count(*) INTO total_count FROM public.business_mission_target_versions v WHERE v.tenant_id=t AND v.target_id=p_target_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('revision',v.revision,'state',v.state,'definition',v.definition,
      'revision_reason',v.revision_reason,'created_by',v.created_by,'created_at',v.created_at) ORDER BY v.revision DESC),'[]'::jsonb)
    INTO items FROM (SELECT * FROM public.business_mission_target_versions WHERE tenant_id=t AND target_id=p_target_id
      ORDER BY revision DESC LIMIT p_limit OFFSET p_offset) v;
  RETURN jsonb_build_object('resolved_tenant_id',t,'target_id',p_target_id,'versions',items,'total_count',total_count,
    'has_more',p_offset+jsonb_array_length(items)<total_count);
END $$;

CREATE OR REPLACE FUNCTION public.save_business_mission_target(p_request_key uuid,p_mission_id uuid,p_expected_mission_revision integer,
  p_target_id uuid,p_expected_target_revision integer,p_definition jsonb,p_metric_evidence_ref text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; t uuid; m public.business_missions%rowtype; x public.business_mission_targets%rowtype;
  receipt public.business_mission_mutation_receipts%rowtype; definition jsonb; evidence jsonb; operation_name text;
  payload_hash text; next_revision integer; answer jsonb; receipt_id uuid;
BEGIN
  SELECT c.actor_id,c.tenant_id INTO a,t FROM public.business_mission_owner_context() c;
  IF p_request_key IS NULL OR p_expected_mission_revision IS NULL OR p_expected_mission_revision<1
    OR ((p_target_id IS NULL)<>(p_expected_target_revision IS NULL))
    OR (p_expected_target_revision IS NOT NULL AND p_expected_target_revision<1)
    OR public._business_mission_target_definition_valid(p_definition) IS DISTINCT FROM true
    OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1200
    OR p_metric_evidence_ref IS NULL OR p_metric_evidence_ref !~ '^aneb_v1_[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'MISSION_TARGET_ARGUMENTS_INVALID' USING errcode='22023'; END IF;
  definition:=jsonb_set(p_definition,'{title}',to_jsonb(btrim(p_definition->>'title')));
  operation_name:=CASE WHEN p_target_id IS NULL THEN 'target_create' ELSE 'target_revise' END;
  payload_hash:=md5(jsonb_build_object('mission_id',p_mission_id,'expected_mission_revision',p_expected_mission_revision,
    'target_id',p_target_id,'expected_target_revision',p_expected_target_revision,'definition',definition,'reason',btrim(p_reason),
    'evidence_digest',encode(extensions.digest(convert_to(p_metric_evidence_ref,'UTF8'),'sha256'),'hex'))::text);
  -- Serializes same-mission writes and preserves the existing owner/tenant/revision boundary.
  SELECT * INTO m FROM public.business_missions WHERE tenant_id=t AND id=p_mission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MISSION_NOT_FOUND' USING errcode='P0002'; END IF;
  SELECT * INTO receipt FROM public.business_mission_mutation_receipts r
    WHERE r.tenant_id=t AND r.actor_user_id=a AND r.request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF receipt.operation<>operation_name OR receipt.payload_hash<>payload_hash OR receipt.mission_id<>p_mission_id THEN
      RAISE EXCEPTION 'MISSION_IDEMPOTENCY_CONFLICT' USING errcode='23505'; END IF;
    IF receipt.result IS NULL THEN RAISE EXCEPTION 'MISSION_REQUEST_INCOMPLETE' USING errcode='40001'; END IF;
    RETURN receipt.result||jsonb_build_object('replayed',true);
  END IF;
  IF m.revision<>p_expected_mission_revision THEN RAISE EXCEPTION 'MISSION_REVISION_CONFLICT' USING errcode='40001'; END IF;
  IF m.lifecycle_state IN ('completed','stopped') THEN RAISE EXCEPTION 'MISSION_CLOSED' USING errcode='22023'; END IF;
  IF p_target_id IS NOT NULL THEN
    SELECT * INTO x FROM public.business_mission_targets WHERE tenant_id=t AND mission_id=p_mission_id AND id=p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'MISSION_TARGET_NOT_FOUND' USING errcode='P0002'; END IF;
    IF x.revision<>p_expected_target_revision THEN RAISE EXCEPTION 'MISSION_TARGET_REVISION_CONFLICT' USING errcode='40001'; END IF;
    IF x.state='retired' THEN RAISE EXCEPTION 'MISSION_TARGET_RETIRED' USING errcode='22023'; END IF;
  END IF;
  -- Source definition is proven by the SAME current-caller issuer/resolver as all metric consumers.
  evidence:=public.resolve_analytics_evidence_reference(p_metric_evidence_ref);
  IF evidence->>'account_epoch' IS DISTINCT FROM t::text OR evidence->>'metric_key' IS DISTINCT FROM definition#>>'{metric,key}'
    OR evidence->>'metric_version' IS DISTINCT FROM definition#>>'{metric,version}' OR evidence->>'unit' IS DISTINCT FROM definition#>>'{metric,unit}'
    OR evidence#>>'{values,kind}' IS DISTINCT FROM definition#>>'{metric,value_kind}'
    OR evidence#>'{dimensions}' IS DISTINCT FROM definition#>'{metric,dimensions}'
    OR evidence#>>'{range,key}' IS DISTINCT FROM definition#>>'{metric,range_key}'
    OR evidence#>>'{range,semantics}' IS DISTINCT FROM definition#>>'{metric,semantics}'
    OR evidence#>>'{business_time_zone,zone}' IS DISTINCT FROM definition#>>'{metric,business_time_zone}' THEN
    RAISE EXCEPTION 'MISSION_TARGET_METRIC_MISMATCH' USING errcode='22023'; END IF;
  INSERT INTO public.business_mission_mutation_receipts(tenant_id,actor_user_id,request_key,operation,payload_hash,mission_id)
    VALUES(t,a,p_request_key,operation_name,payload_hash,p_mission_id) RETURNING id INTO receipt_id;
  IF p_target_id IS NULL THEN
    INSERT INTO public.business_mission_targets(tenant_id,mission_id,created_by) VALUES(t,p_mission_id,a) RETURNING * INTO x;
    next_revision:=1;
  ELSE
    next_revision:=x.revision+1;
    UPDATE public.business_mission_targets SET revision=next_revision,updated_at=now() WHERE tenant_id=t AND id=x.id;
  END IF;
  INSERT INTO public.business_mission_target_versions(tenant_id,target_id,revision,state,definition,revision_reason,created_by)
    VALUES(t,x.id,next_revision,x.state,definition,btrim(p_reason),a);
  answer:=jsonb_build_object('ok',true,'mission_id',p_mission_id,'target_id',x.id,'revision',next_revision,'state',x.state,
    'receipt_id',receipt_id,'request_key',p_request_key,'replayed',false);
  UPDATE public.business_mission_mutation_receipts SET result=answer WHERE tenant_id=t AND actor_user_id=a AND request_key=p_request_key;
  INSERT INTO public.paige_audit_log(tenant_id,actor_user_id,actor_role,action,target_type,target_id,payload)
    VALUES(t,a,'owner','business_mission.'||operation_name,'business_mission_target',x.id,jsonb_build_object('mission_id',p_mission_id,'revision',next_revision));
  RETURN answer;
END $$;

CREATE OR REPLACE FUNCTION public.transition_business_mission_target(p_request_key uuid,p_mission_id uuid,p_expected_mission_revision integer,
  p_target_id uuid,p_expected_target_revision integer,p_to_state text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; t uuid; m public.business_missions%rowtype; x public.business_mission_targets%rowtype;
  receipt public.business_mission_mutation_receipts%rowtype; definition jsonb; payload_hash text; next_revision integer; answer jsonb; receipt_id uuid;
BEGIN
  SELECT c.actor_id,c.tenant_id INTO a,t FROM public.business_mission_owner_context() c;
  IF p_request_key IS NULL OR p_target_id IS NULL OR p_expected_mission_revision IS NULL OR p_expected_mission_revision<1
    OR p_expected_target_revision IS NULL OR p_expected_target_revision<1 OR p_to_state IS NULL
    OR p_to_state NOT IN ('active','paused','retired') OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1200 THEN
    RAISE EXCEPTION 'MISSION_TARGET_ARGUMENTS_INVALID' USING errcode='22023'; END IF;
  payload_hash:=md5(jsonb_build_object('mission_id',p_mission_id,'expected_mission_revision',p_expected_mission_revision,
    'target_id',p_target_id,'expected_target_revision',p_expected_target_revision,'to_state',p_to_state,'reason',btrim(p_reason))::text);
  SELECT * INTO m FROM public.business_missions WHERE tenant_id=t AND id=p_mission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MISSION_NOT_FOUND' USING errcode='P0002'; END IF;
  SELECT * INTO receipt FROM public.business_mission_mutation_receipts r
    WHERE r.tenant_id=t AND r.actor_user_id=a AND r.request_key=p_request_key FOR UPDATE;
  IF FOUND THEN
    IF receipt.operation<>'target_transition' OR receipt.payload_hash<>payload_hash OR receipt.mission_id<>p_mission_id THEN
      RAISE EXCEPTION 'MISSION_IDEMPOTENCY_CONFLICT' USING errcode='23505'; END IF;
    IF receipt.result IS NULL THEN RAISE EXCEPTION 'MISSION_REQUEST_INCOMPLETE' USING errcode='40001'; END IF;
    RETURN receipt.result||jsonb_build_object('replayed',true);
  END IF;
  IF m.revision<>p_expected_mission_revision THEN RAISE EXCEPTION 'MISSION_REVISION_CONFLICT' USING errcode='40001'; END IF;
  -- A completed Play's definition is preserved. Retiring its target remains available as an explicit historical disposition.
  IF m.lifecycle_state IN ('completed','stopped') AND p_to_state<>'retired' THEN
    RAISE EXCEPTION 'MISSION_CLOSED' USING errcode='22023'; END IF;
  SELECT * INTO x FROM public.business_mission_targets WHERE tenant_id=t AND mission_id=p_mission_id AND id=p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MISSION_TARGET_NOT_FOUND' USING errcode='P0002'; END IF;
  IF x.revision<>p_expected_target_revision THEN RAISE EXCEPTION 'MISSION_TARGET_REVISION_CONFLICT' USING errcode='40001'; END IF;
  IF x.state='retired' OR x.state=p_to_state THEN RAISE EXCEPTION 'MISSION_TARGET_INVALID_TRANSITION' USING errcode='22023'; END IF;
  SELECT v.definition INTO STRICT definition FROM public.business_mission_target_versions v
    WHERE v.tenant_id=t AND v.target_id=x.id AND v.revision=x.revision;
  INSERT INTO public.business_mission_mutation_receipts(tenant_id,actor_user_id,request_key,operation,payload_hash,mission_id)
    VALUES(t,a,p_request_key,'target_transition',payload_hash,p_mission_id) RETURNING id INTO receipt_id;
  next_revision:=x.revision+1;
  UPDATE public.business_mission_targets SET revision=next_revision,state=p_to_state,updated_at=now() WHERE tenant_id=t AND id=x.id;
  INSERT INTO public.business_mission_target_versions(tenant_id,target_id,revision,state,definition,revision_reason,created_by)
    VALUES(t,x.id,next_revision,p_to_state,definition,btrim(p_reason),a);
  answer:=jsonb_build_object('ok',true,'mission_id',p_mission_id,'target_id',x.id,'revision',next_revision,'state',p_to_state,
    'receipt_id',receipt_id,'request_key',p_request_key,'replayed',false);
  UPDATE public.business_mission_mutation_receipts SET result=answer WHERE tenant_id=t AND actor_user_id=a AND request_key=p_request_key;
  INSERT INTO public.paige_audit_log(tenant_id,actor_user_id,actor_role,action,target_type,target_id,payload)
    VALUES(t,a,'owner','business_mission.target_transition','business_mission_target',x.id,
      jsonb_build_object('mission_id',p_mission_id,'revision',next_revision,'state',p_to_state));
  RETURN answer;
END $$;

-- A narrow current-caller projection of the EXISTING receipt. The bearer metric
-- evidence reference is never stored or returned here; no second receipt stream.
CREATE OR REPLACE FUNCTION public.get_business_mission_target_receipt(p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; t uuid; answer jsonb;
BEGIN
  SELECT c.actor_id,c.tenant_id INTO a,t FROM public.business_mission_owner_context() c;
  SELECT jsonb_build_object('id',r.id,'request_key',r.request_key,'mission_id',r.mission_id,'operation',r.operation,
      'result',r.result,'created_at',r.created_at) INTO answer
    FROM public.business_mission_mutation_receipts r
    WHERE r.tenant_id=t AND r.actor_user_id=a AND r.request_key=p_request_key
      AND r.operation IN ('target_create','target_revise','target_transition') AND r.result IS NOT NULL;
  IF answer IS NULL THEN RAISE EXCEPTION 'MISSION_TARGET_RECEIPT_NOT_FOUND' USING errcode='P0002'; END IF;
  RETURN answer;
END $$;

REVOKE ALL ON FUNCTION public.get_business_mission_target(uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.get_business_mission_target_revision(uuid,integer) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.list_business_mission_targets(uuid,integer,integer) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.list_business_mission_target_versions(uuid,integer,integer) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.save_business_mission_target(uuid,uuid,integer,uuid,integer,jsonb,text,text) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.transition_business_mission_target(uuid,uuid,integer,uuid,integer,text,text) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.get_business_mission_target_receipt(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_business_mission_target(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_business_mission_target_revision(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_business_mission_targets(uuid,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_business_mission_target_versions(uuid,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_business_mission_target(uuid,uuid,integer,uuid,integer,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_business_mission_target(uuid,uuid,integer,uuid,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_business_mission_target_receipt(uuid) TO authenticated;
COMMIT;
