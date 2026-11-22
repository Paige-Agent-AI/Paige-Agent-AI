-- EXP07: forward compatibility for original media publication receipts.
-- Never-published local31 moved byte-for-byte to reserved34 (ANT147/950a23fa),
-- then extended for the approved original provider-native schedule instruction.
-- Original function signatures, row types, grants and text-only duplicate behavior are preserved.
BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.content_publication_bind(uuid,uuid,uuid,text,uuid,uuid,jsonb)'::regprocedure
      AND md5(prosrc) IN ('a883690aca797065aa234f1b7fbe2a0c', '8817ca0548a47ac3d54fabfa438759af')
      AND proowner = 'postgres'::regrole AND prosecdef AND provolatile = 'v' AND proconfig = ARRAY['search_path=public']
      AND (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(proacl) a) = ARRAY['postgres=X/postgres','service_role=X/postgres'])
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.content_publication_list(uuid,uuid)'::regprocedure
      AND md5(prosrc) IN ('d0cdbf3a8efd27bf81e3b67a60e1a21c', 'c0abaf2525ee411ade5f5e07cfe3cc7d')
      AND proowner = 'postgres'::regrole AND prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=public']
      AND (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(proacl) a) = ARRAY['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres'])
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.content_publication_record(uuid,uuid,text,text,text,text,text,jsonb)'::regprocedure
      AND md5(prosrc) IN ('1d9e3efa875530e9486f4909fb09a742', '4778a678cd552c3d324443ac5ec7c657')
      AND proowner = 'postgres'::regrole AND prosecdef AND provolatile = 'v' AND proconfig = ARRAY['search_path=public']
      AND (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(proacl) a) = ARRAY['postgres=X/postgres','service_role=X/postgres']) THEN
    RAISE EXCEPTION 'EXP07_PUBLICATION_SOURCE_CHANGED: re-ground original functions before applying';
  END IF;
END;
$guard$;

-- Same receipt table and original writer. No queue, calendar event or scheduler.
DO $status_guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.content_publications'::regclass
   AND conname='content_publications_status_check' AND contype='c'
   AND pg_get_constraintdef(oid) IN (
    'CHECK ((status = ANY (ARRAY[''registered''::text, ''approved''::text, ''publishing''::text, ''published''::text, ''partial''::text, ''failed''::text, ''outcome_unknown''::text, ''refused''::text])))',
    'CHECK ((status = ANY (ARRAY[''registered''::text, ''approved''::text, ''publishing''::text, ''published''::text, ''partial''::text, ''failed''::text, ''outcome_unknown''::text, ''refused''::text, ''scheduled''::text, ''schedule_changing''::text, ''cancelled''::text])))')) THEN
  RAISE EXCEPTION 'EXP07_PUBLICATION_STATUS_SOURCE_CHANGED'; END IF;
END $status_guard$;
ALTER TABLE public.content_publications DROP CONSTRAINT content_publications_status_check;
ALTER TABLE public.content_publications ADD CONSTRAINT content_publications_status_check CHECK(status IN
 ('registered','approved','publishing','published','partial','failed','outcome_unknown','refused','scheduled','schedule_changing','cancelled'));

CREATE OR REPLACE FUNCTION public.content_publication_bind(p_id uuid, p_tenant_id uuid, p_content_id uuid, p_platform text, p_connection_id uuid, p_confirmation_id uuid, p_request_args jsonb)
 RETURNS content_publications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _row public.content_publications;
DECLARE _caller uuid := auth.uid();
BEGIN
  IF _caller IS NOT NULL THEN
    RAISE EXCEPTION 'CONTENT_FORBIDDEN: publication records are written only by the publish door' USING ERRCODE = '42501';
  END IF;
  -- Serialize binds for this tenant, piece and platform, including distinct approvals.
  -- A known successful publication for the same exact revision/target/caption is also final.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'content-publication:' || p_tenant_id::text || ':' || p_content_id::text || ':' || p_platform, 0
  ));
  IF EXISTS (
    SELECT 1 FROM public.content_publications
    WHERE tenant_id = p_tenant_id AND content_id = p_content_id AND platform = p_platform
      AND (
        status IN ('approved', 'publishing', 'outcome_unknown', 'scheduled', 'schedule_changing')
        OR (
          status IN ('published', 'partial')
          AND p_request_args ? 'content_revision'
          AND request_args->>'content_revision' = p_request_args->>'content_revision'
          AND request_args->>'account_id' = p_request_args->>'account_id'
          AND request_args->>'channel_id' IS NOT DISTINCT FROM p_request_args->>'channel_id'
          AND request_args->>'caption' = p_request_args->>'caption'
          AND (request_args->>'media_snapshot') IS NOT DISTINCT FROM (p_request_args->>'media_snapshot')
          AND (request_args->>'schedule') IS NOT DISTINCT FROM (p_request_args->>'schedule')
        )
      )
  ) THEN
    RAISE EXCEPTION 'CONTENT_PUBLICATION_ALREADY_EXISTS' USING ERRCODE = 'PT409';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.content_publications (
      tenant_id, content_id, platform, connection_id, confirmation_id, request_args, status
    ) VALUES (
      p_tenant_id, p_content_id, p_platform, p_connection_id, p_confirmation_id,
      COALESCE(p_request_args, '{}'::jsonb), 'approved'
    ) RETURNING * INTO _row;
  ELSE
    UPDATE public.content_publications
      SET content_id = p_content_id, platform = p_platform, connection_id = p_connection_id,
          confirmation_id = p_confirmation_id, request_args = COALESCE(p_request_args, '{}'::jsonb),
          status = 'approved', updated_at = now()
      WHERE id = p_id AND tenant_id = p_tenant_id AND status = 'registered'
        AND content_id IS NULL AND confirmation_id IS NULL
      RETURNING * INTO _row;
  END IF;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'CONTENT_NOT_FOUND: no unbound attempt to bind' USING ERRCODE = 'P0002';
  END IF;
  RETURN _row;
END $function$
;

CREATE OR REPLACE FUNCTION public.content_publication_list(p_content_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF content_publications
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _caller uuid := auth.uid(); _tenant uuid; _can_read_destination boolean;
BEGIN
  IF _caller IS NOT NULL THEN
    _tenant := public.current_user_tenant_id();
    IF _tenant IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
    END IF;
    IF p_tenant_id IS NOT NULL AND p_tenant_id <> _tenant THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: that is not the workspace you are working in' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.is_tenant_member(_tenant) OR public.agency_can_manage_child(_tenant)) THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: a workspace member is required' USING ERRCODE = '42501';
    END IF;
  ELSE
    _tenant := p_tenant_id;
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
  END IF;
  _can_read_destination := _caller IS NULL OR public.is_tenant_admin(_tenant)
    OR public.agency_can_manage_child(_tenant);
  RETURN QUERY
  SELECT (CASE
    WHEN _can_read_destination IS TRUE OR NOT (e.request_args ? 'account_id' OR e.request_args ? 'media_snapshot' OR e.request_args ? 'schedule' OR e.provider_response ? 'schedule') THEN e
    ELSE jsonb_populate_record(e, jsonb_build_object(
      'connection_id', NULL,
      'provider_post_id', NULL,
      'provider_post_url', NULL,
      'provider_request_id', NULL,
      'provider_response', '{}'::jsonb,
      'request_args', e.request_args - ARRAY['account_id', 'connection_id', 'channel_id', 'channel_label', 'media_snapshot', 'schedule', 'connection_generation']
    ))
  END).* FROM public.content_publications e
  WHERE e.tenant_id = _tenant AND (p_content_id IS NULL OR e.content_id = p_content_id)
  ORDER BY e.created_at DESC, e.id DESC;
END $function$
;

CREATE OR REPLACE FUNCTION public.content_publication_record(p_id uuid, p_tenant_id uuid, p_status text, p_provider_post_id text DEFAULT NULL::text, p_provider_post_url text DEFAULT NULL::text, p_provider_request_id text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_provider_response jsonb DEFAULT NULL::jsonb)
 RETURNS content_publications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _row public.content_publications;
DECLARE _caller uuid := auth.uid();
DECLARE _analytics jsonb; _metric record; _last_check text; _retain_observation boolean := false;
DECLARE _schedule jsonb; _claim jsonb; _proposal public.paige_pending_confirmations; _version integer;

DECLARE _walk text := CASE p_status
  WHEN 'publishing' THEN 'publishing' WHEN 'published' THEN 'published' WHEN 'partial' THEN 'partial'
  WHEN 'failed' THEN 'failed' WHEN 'outcome_unknown' THEN 'outcome_unknown' WHEN 'refused' THEN 'refused'
  WHEN 'scheduled' THEN 'scheduled' WHEN 'schedule_changing' THEN 'schedule_changing' WHEN 'cancelled' THEN 'cancelled'
  ELSE NULL END;
BEGIN
  IF _caller IS NOT NULL THEN
    RAISE EXCEPTION 'CONTENT_FORBIDDEN: publication records are written only by the publish door' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'CONTENT_INVALID: a tenant is required' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    -- Creation: the walk check does not apply (the row starts at 'registered').
    INSERT INTO public.content_publications (tenant_id, status)
      VALUES (p_tenant_id, 'registered') RETURNING * INTO _row;
  ELSE
    IF _walk IS NULL THEN
      RAISE EXCEPTION 'CONTENT_INVALID: that is not a door status' USING ERRCODE = '22023';
    END IF;

    -- Claim a change on the SAME scheduled provider job and current native version.
    -- The original one-use proposal must already be consumed for this exact call.
    IF _walk='schedule_changing' THEN
      SELECT * INTO _row FROM public.content_publications WHERE id=p_id AND tenant_id=p_tenant_id FOR UPDATE;
      _claim:=p_provider_response->'schedule_claim';
      SELECT * INTO _proposal FROM public.paige_pending_confirmations WHERE id=(_claim->>'confirmation_id')::uuid;
      IF _row.id IS NULL OR _row.status<>'scheduled' OR _claim IS NULL OR jsonb_typeof(_claim)<>'object'
       OR p_provider_response-'schedule_claim'<>'{}'::jsonb
       OR _claim-ARRAY['confirmation_id','expected_version','operation','previous_schedule','next_schedule','approved_by']<>'{}'::jsonb
       OR (SELECT count(*) FROM jsonb_object_keys(_claim))<>6
       OR jsonb_typeof(_claim->'expected_version') IS DISTINCT FROM 'number'
       OR jsonb_typeof(_claim->'operation') IS DISTINCT FROM 'string'
       OR jsonb_typeof(_claim->'approved_by') IS DISTINCT FROM 'string'
       OR jsonb_typeof(_claim->'confirmation_id') IS DISTINCT FROM 'string'
       OR _proposal.id IS NULL OR _proposal.consumed_at IS NULL OR _proposal.thread_id IS NOT NULL OR _proposal.scoped_client_id IS NOT NULL
       OR _proposal.server_issued_at IS NULL OR _proposal.issued_in_request IS NULL OR _proposal.expires_at<=clock_timestamp()
       OR _proposal.tool_name IS DISTINCT FROM 'social.post_publish' OR _proposal.tenant_id IS DISTINCT FROM p_tenant_id OR _proposal.user_id::text IS DISTINCT FROM _claim->>'approved_by'
       OR _proposal.args->>'publication_id' IS DISTINCT FROM p_id::text OR _proposal.args->>'operation' IS DISTINCT FROM _claim->>'operation'
       OR (_proposal.args->>'publication_version')::integer IS DISTINCT FROM (_claim->>'expected_version')::integer
       OR (_claim->>'expected_version')::integer IS DISTINCT FROM (_row.provider_response->'schedule'->>'version')::integer
       OR _claim->>'operation' NOT IN ('reschedule','cancel_schedule')
       OR (_proposal.args->>'previous_schedule')::jsonb IS DISTINCT FROM _claim->'previous_schedule'
       OR (_proposal.args->>'schedule')::jsonb IS DISTINCT FROM _claim->'next_schedule'
       OR _claim->'previous_schedule' IS DISTINCT FROM _row.provider_response->'schedule'->'current'
       OR _proposal.args->>'provider_request_id' IS DISTINCT FROM _row.provider_request_id
       OR p_provider_request_id IS DISTINCT FROM _row.provider_request_id OR _row.provider_request_id IS NULL
       OR EXISTS(SELECT 1 FROM unnest(ARRAY['content_id','content_revision','caption','platform','connection_id','account_id','channel_id','channel_label','media_snapshot','connection_generation']) k
          WHERE _proposal.args->k IS DISTINCT FROM _row.request_args->k)
       OR (_claim->>'operation'='cancel_schedule' AND _claim->'next_schedule' IS DISTINCT FROM _claim->'previous_schedule')
       OR (_claim->'previous_schedule'->>'scheduled_for')::timestamptz<=clock_timestamp()+interval '2 minutes'
       OR (_claim->'next_schedule'->>'scheduled_for')::timestamptz<=clock_timestamp()+interval '2 minutes' THEN
        RAISE EXCEPTION 'CONTENT_SCHEDULE_CHANGED: original schedule approval/version required' USING ERRCODE='PT409';
      END IF;
      IF (SELECT count(*) FROM jsonb_object_keys(coalesce(_row.provider_response->'schedule'->'approvals','{}'::jsonb)))>=100 THEN
       RAISE EXCEPTION 'CONTENT_SCHEDULE_LIMIT: retain the original provider job and receipt' USING ERRCODE='PT409'; END IF;
      UPDATE public.content_publications SET status='schedule_changing',error_code=NULL,
       provider_response=provider_response||jsonb_build_object('schedule',(provider_response->'schedule')||jsonb_build_object('mutation',_claim,'state','changing',
        'approvals',coalesce(provider_response->'schedule'->'approvals','{}'::jsonb)||jsonb_build_object(_claim->>'confirmation_id',
          jsonb_build_object('state','changing','version',(_claim->>'expected_version')::integer+1,'instruction',_claim->'next_schedule')))),
       updated_at=now() WHERE id=p_id AND tenant_id=p_tenant_id RETURNING * INTO _row;
      RETURN _row;
    END IF;

    IF _walk IN ('scheduled','cancelled') OR p_provider_response ? 'schedule' THEN
      SELECT * INTO _row FROM public.content_publications WHERE id=p_id AND tenant_id=p_tenant_id FOR UPDATE;
      _schedule:=p_provider_response->'schedule'; _claim:=_row.provider_response->'schedule'->'mutation';
      IF _row.id IS NULL OR jsonb_typeof(_schedule) IS DISTINCT FROM 'object'
       OR _schedule-ARRAY['current','version','state','mutation','provider_media']<>'{}'::jsonb
       OR _schedule->>'state' IS DISTINCT FROM _walk
       OR jsonb_typeof(_schedule->'version') IS DISTINCT FROM 'number'
       OR jsonb_typeof(_schedule->'current') IS DISTINCT FROM 'object'
       OR (_schedule->'current')-ARRAY['scheduled_for','timezone','civil_time','offset_minutes','disambiguation']<>'{}'::jsonb
       OR (SELECT count(*) FROM jsonb_object_keys(_schedule->'current'))<>5
       OR jsonb_typeof(_schedule->'current'->'scheduled_for') IS DISTINCT FROM 'string'
       OR jsonb_typeof(_schedule->'current'->'timezone') IS DISTINCT FROM 'string'
       OR jsonb_typeof(_schedule->'current'->'civil_time') IS DISTINCT FROM 'string'
       OR jsonb_typeof(_schedule->'current'->'offset_minutes') IS DISTINCT FROM 'number'
       OR jsonb_typeof(_schedule->'current'->'disambiguation') IS DISTINCT FROM 'string'
       OR _schedule->'current'->>'disambiguation' NOT IN ('unique','earlier','later')
       OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=_schedule->'current'->>'timezone')
       OR NOT isfinite((_schedule->'current'->>'scheduled_for')::timestamptz)
       OR to_char((_schedule->'current'->>'scheduled_for')::timestamptz AT TIME ZONE (_schedule->'current'->>'timezone'),'YYYY-MM-DD"T"HH24:MI') IS DISTINCT FROM _schedule->'current'->>'civil_time'
       OR extract(epoch FROM (((_schedule->'current'->>'civil_time')::timestamp AT TIME ZONE 'UTC')-(_schedule->'current'->>'scheduled_for')::timestamptz))/60 IS DISTINCT FROM (_schedule->'current'->>'offset_minutes')::numeric
       OR (_walk<>'outcome_unknown' AND nullif(p_provider_request_id,'') IS NULL)
       OR (_row.provider_request_id IS NOT NULL AND p_provider_request_id IS DISTINCT FROM _row.provider_request_id) THEN
        RAISE EXCEPTION 'CONTENT_SCHEDULE_INVALID: original provider result required' USING ERRCODE='22023';
      END IF;
      _schedule:=jsonb_set(_schedule,'{provider_media}',coalesce(_schedule->'provider_media','[]'::jsonb));
      IF jsonb_typeof(_schedule->'provider_media') IS DISTINCT FROM 'array' OR jsonb_array_length(_schedule->'provider_media')>20
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(_schedule->'provider_media') m WHERE jsonb_typeof(m)<>'object'
        OR m-ARRAY['url','type','altText']<>'{}'::jsonb OR coalesce(m->>'type','') NOT IN ('image','video')
        OR jsonb_typeof(m->'url') IS DISTINCT FROM 'string' OR m->>'url' NOT LIKE 'https://%' OR length(m->>'url')>4096
        OR (m ? 'altText' AND (jsonb_typeof(m->'altText') IS DISTINCT FROM 'string' OR length(m->>'altText')>500)))
       OR (_walk IN ('scheduled','cancelled','published') AND jsonb_array_length(_schedule->'provider_media')<>
          CASE WHEN _row.request_args ? 'media_snapshot' THEN jsonb_array_length((_row.request_args->>'media_snapshot')::jsonb) ELSE 0 END)
       OR (_claim IS NOT NULL AND _schedule->'provider_media' IS DISTINCT FROM coalesce(_row.provider_response->'schedule'->'provider_media','[]'::jsonb)) THEN
       RAISE EXCEPTION 'CONTENT_SCHEDULE_MEDIA_CHANGED: original provider media required' USING ERRCODE='22023'; END IF;
      IF _claim IS NOT NULL THEN
       IF _schedule->'mutation' IS DISTINCT FROM _claim OR _schedule->'current' IS DISTINCT FROM _claim->'next_schedule'
        OR (_schedule->>'version')::integer IS DISTINCT FROM (_claim->>'expected_version')::integer+1
        OR (_walk='cancelled' AND _claim->>'operation'<>'cancel_schedule')
        OR (_walk='scheduled' AND _claim->>'operation'<>'reschedule') THEN
         RAISE EXCEPTION 'CONTENT_SCHEDULE_CHANGED: claimed change required' USING ERRCODE='PT409'; END IF;
      ELSE
       IF _walk='cancelled' OR (_row.request_args->>'schedule')::jsonb IS DISTINCT FROM _schedule->'current'
        OR (_schedule->>'version')::integer IS DISTINCT FROM 1 THEN
         RAISE EXCEPTION 'CONTENT_SCHEDULE_CHANGED: original future instruction required' USING ERRCODE='PT409'; END IF;
      END IF;
      -- A repeat read of the current accepted schedule is idempotent. It cannot
      -- regress a published receipt or swap its provider/source/version.
      IF _row.status=_walk AND _walk IN ('scheduled','cancelled') AND p_provider_response->'reconciled'='true'::jsonb
       AND _row.provider_response->'schedule'->'current'=_schedule->'current'
       AND _row.provider_response->'schedule'->'version'=_schedule->'version' THEN RETURN _row; END IF;
      -- Bounded approval/readback history stays in this SAME receipt so an old
      -- private card keeps its original reference after proposal cleanup or edits.
      _schedule:=_schedule||jsonb_build_object('approvals',coalesce(_row.provider_response->'schedule'->'approvals','{}'::jsonb)
        ||CASE WHEN _row.provider_response->'schedule'->'approvals'->(coalesce(_claim->>'confirmation_id',_row.confirmation_id::text))->>'state' IN ('scheduled','cancelled') THEN '{}'::jsonb
        ELSE jsonb_build_object(coalesce(_claim->>'confirmation_id',_row.confirmation_id::text),
          jsonb_build_object('state',_walk,'version',(_schedule->>'version')::integer,'instruction',_schedule->'current')) END);
      p_provider_response:=jsonb_set(p_provider_response,'{schedule}',_schedule);
    END IF;

    -- Read-only provider performance is cached on the SAME terminal receipt. This
    -- branch cannot change publication status, source, destination or provider ids.
    IF _walk = 'published' AND p_provider_response ? 'analytics' THEN
      SELECT * INTO _row FROM public.content_publications
        WHERE id = p_id AND tenant_id = p_tenant_id FOR UPDATE;
      IF _row.id IS NULL OR _row.status <> 'published' OR NOT (_row.request_args ? 'account_id')
        OR p_provider_post_id IS DISTINCT FROM _row.provider_post_id
        OR p_provider_post_url IS DISTINCT FROM _row.provider_post_url
        OR p_provider_request_id IS DISTINCT FROM _row.provider_request_id
        OR p_error_code IS NOT NULL THEN
        RAISE EXCEPTION 'CONTENT_NOT_FOUND: the original published result must remain unchanged' USING ERRCODE = 'P0002';
      END IF;
      _analytics := p_provider_response->'analytics';
      IF jsonb_typeof(p_provider_response) <> 'object' OR p_provider_response-'analytics' <> '{}'::jsonb
        OR octet_length(p_provider_response::text) > 8192 OR jsonb_typeof(_analytics) <> 'object'
        OR _analytics-ARRAY['state','metrics','measured_at','checked_at'] <> '{}'::jsonb
        OR COALESCE(_analytics->>'state','') NOT IN ('available','pending','unsupported','error')
        OR jsonb_typeof(_analytics->'metrics') IS DISTINCT FROM 'object'
        OR (_analytics->'metrics')-ARRAY['views','likes','comments','shares'] <> '{}'::jsonb
        OR (_analytics->>'state' <> 'available' AND _analytics->'metrics' <> '{}'::jsonb)
        OR (_analytics->>'state' = 'available' AND _analytics->'metrics' = '{}'::jsonb)
        OR (_analytics ? 'measured_at' AND jsonb_typeof(_analytics->'measured_at') NOT IN ('string','null'))
        OR length(COALESCE(_analytics->>'measured_at','')) > 80 THEN
        RAISE EXCEPTION 'CONTENT_INVALID: bounded provider performance required' USING ERRCODE = '22023';
      END IF;
      FOR _metric IN SELECT value FROM jsonb_each(_analytics->'metrics') LOOP
        IF jsonb_typeof(_metric.value) <> 'number' OR length(_metric.value::text) > 20 THEN
          RAISE EXCEPTION 'CONTENT_INVALID: a real nonnegative metric is required' USING ERRCODE = '22023';
        END IF;
        IF (_metric.value::text)::numeric < 0 OR (_metric.value::text)::numeric > 9007199254740991
          OR trunc((_metric.value::text)::numeric) <> (_metric.value::text)::numeric THEN
          RAISE EXCEPTION 'CONTENT_INVALID: a real nonnegative metric is required' USING ERRCODE = '22023';
        END IF;
      END LOOP;
      IF _analytics->>'measured_at' IS NOT NULL THEN
        IF NOT isfinite((_analytics->>'measured_at')::timestamptz)
          OR (_analytics->>'measured_at')::timestamptz > clock_timestamp() + interval '5 minutes' THEN
          RAISE EXCEPTION 'CONTENT_INVALID: a finite observed provider time is required' USING ERRCODE = '22023';
        END IF;
        -- A late response cannot replace a newer observed provider snapshot.
        IF _row.provider_response->'analytics'->>'measured_at' IS NOT NULL
          AND (_analytics->>'measured_at')::timestamptz < (_row.provider_response->'analytics'->>'measured_at')::timestamptz THEN
          _retain_observation := true;
        END IF;
      END IF;
      _last_check := CASE WHEN _retain_observation THEN 'stale'
        WHEN _analytics->>'state' = 'available' AND _analytics->>'measured_at' IS NULL THEN 'unverified'
        ELSE _analytics->>'state' END;
      IF _row.provider_response->'analytics'->>'state' = 'available'
        AND (_retain_observation OR _analytics->>'state' <> 'available' OR _analytics->>'measured_at' IS NULL) THEN
        _analytics := _row.provider_response->'analytics';
      END IF;
      _analytics := jsonb_set(_analytics,'{last_check_state}',to_jsonb(_last_check),true);
      _analytics := jsonb_set(_analytics,'{checked_at}',to_jsonb(now()),true);
      UPDATE public.content_publications SET
        provider_response = COALESCE(provider_response,'{}'::jsonb) || jsonb_build_object('analytics',_analytics),
        updated_at = now()
        WHERE id = p_id AND tenant_id = p_tenant_id RETURNING * INTO _row;
      RETURN _row;
    END IF;

    UPDATE public.content_publications
      SET status = _walk,
          provider_post_id = COALESCE(p_provider_post_id, provider_post_id),
          provider_post_url = COALESCE(p_provider_post_url, provider_post_url),
          provider_request_id = COALESCE(p_provider_request_id, provider_request_id),
          error_code = p_error_code,
          provider_response = COALESCE(p_provider_response, provider_response),
          updated_at = now()
      WHERE id = p_id AND tenant_id = p_tenant_id
        -- Forward-only: the walk order, and only from a live-earlier status.
        AND CASE status
          WHEN 'registered' THEN _walk IN ('publishing','refused')
            AND p_error_code IS DISTINCT FROM 'approval_abandoned'
          WHEN 'approved' THEN _walk IN ('publishing','refused')
            AND (p_error_code IS DISTINCT FROM 'approval_abandoned'
              OR (_walk = 'refused' AND updated_at < now() - interval '2 minutes'))
          WHEN 'publishing' THEN _walk IN ('published','partial','failed','outcome_unknown','refused','scheduled')
            AND p_error_code IS DISTINCT FROM 'approval_abandoned'
          -- A provider readback can resolve the same attempt to a terminal state.
          WHEN 'outcome_unknown' THEN _walk IN ('published','failed','scheduled','cancelled','outcome_unknown')
            AND p_provider_response->'reconciled' = 'true'::jsonb
            AND p_provider_request_id IS NOT NULL
            AND request_args ? 'account_id'
            AND (provider_request_id IS NULL OR provider_request_id = p_provider_request_id)
          WHEN 'schedule_changing' THEN _walk IN ('scheduled','cancelled','published','outcome_unknown')
            AND p_provider_request_id=provider_request_id AND p_provider_response ? 'schedule'
          WHEN 'scheduled' THEN _walk IN ('published','failed','outcome_unknown')
            AND p_provider_response->'reconciled'='true'::jsonb AND p_provider_request_id=provider_request_id
          WHEN 'cancelled' THEN _walk IN ('published','outcome_unknown') AND p_provider_response->'reconciled'='true'::jsonb AND p_provider_request_id=provider_request_id
          ELSE false END
      RETURNING * INTO _row;
    IF _row.id IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NOT_FOUND: no such publication attempt, or that status change is not a step forward' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN _row;
END $function$
;

-- EXP07: closed Social proposal/receipt bindings in the original private NEXUS cards.
-- Original signatures, ACLs, accepted-turn token, decision/claim/post/settlement and other domains remain.

DO $social_guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public._team_hub_card_scope_guard()'::regprocedure
  AND md5(prosrc) IN ('a8ede8a4929e497b23f5b1c998587f3f','3144dc31e84efba511cc15d4babce71a') AND proowner='postgres'::regrole AND provolatile='v'
  AND NOT prosecdef AND proconfig=ARRAY['search_path=""']
  AND (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(proacl) a)=ARRAY['postgres=X/postgres']) THEN
  RAISE EXCEPTION 'EXP07_SOCIAL_CARD_SOURCE_CHANGED'; END IF;
END $social_guard$;

CREATE OR REPLACE FUNCTION public._team_hub_card_scope_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.team_hub_messages m JOIN public.team_hub_channels c ON c.id=m.channel_id
   WHERE m.id=NEW.message_id AND m.tenant_id=NEW.tenant_id AND m.channel_id=NEW.channel_id AND c.tenant_id=NEW.tenant_id
    AND c.kind='agent_dm' AND m.author_kind='agent' AND m.agent_key=c.agent_key AND m.author_user_id=NEW.approver_user_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_CARD_SCOPE' USING ERRCODE='23514'; END IF;
 IF (TG_OP='INSERT' OR NEW.confirmation_id IS DISTINCT FROM OLD.confirmation_id)
   AND NOT EXISTS(SELECT 1 FROM public.paige_pending_confirmations p WHERE p.id=NEW.confirmation_id
    AND p.user_id=NEW.approver_user_id AND p.tenant_id=NEW.tenant_id AND p.thread_id IS NULL AND p.tool_name=NEW.tool_name) THEN
  RAISE EXCEPTION 'TEAM_HUB_CARD_SCOPE' USING ERRCODE='23514'; END IF;
 IF NEW.outcome_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_hub_messages o
   JOIN public.team_hub_messages m ON m.id=NEW.message_id
   WHERE o.id=NEW.outcome_message_id AND o.id<>m.id AND o.channel_id=NEW.channel_id AND o.author_kind='agent'
    AND o.agent_key=m.agent_key AND o.author_user_id=NEW.approver_user_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_CARD_SCOPE' USING ERRCODE='23514'; END IF;
 IF NEW.tool_name='social.post_publish' AND NOT EXISTS(
  SELECT 1 FROM public.team_hub_channels c WHERE c.id=NEW.channel_id AND c.tenant_id=NEW.tenant_id
   AND c.kind='agent_dm' AND c.agent_key='nexus' AND c.created_by=NEW.approver_user_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_CARD_SCOPE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $function$;

DO $social_guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public._team_hub_assert_agent_read_scope(team_hub_agent_turns)'::regprocedure
  AND md5(prosrc) IN ('5545c370d54a7baef54ba37f9619e729','da16cf7c4a5341338b16a010fdfcc605') AND proowner='postgres'::regrole AND provolatile='v'
  AND prosecdef AND proconfig=ARRAY['search_path=""']
  AND (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(proacl) a)=ARRAY['postgres=X/postgres']) THEN
  RAISE EXCEPTION 'EXP07_SOCIAL_CARD_SOURCE_CHANGED'; END IF;
END $social_guard$;

CREATE OR REPLACE FUNCTION public._team_hub_assert_agent_read_scope(t team_hub_agent_turns)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c public.team_hub_channels; config jsonb; tools jsonb:=t.read_context->'tools'; item jsonb;
BEGIN
 PERFORM public._sales_invoice_actor(t.asker_user_id,t.tenant_id);
 IF NOT EXISTS(SELECT 1 FROM public.tenants n WHERE n.id=t.tenant_id
   AND n.account_type='standalone' AND n.parent_tenant_id IS NULL) THEN
  RAISE EXCEPTION 'Source read workspace unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public._team_hub_visible(t.tenant_id,t.asker_user_id,t.channel_id);
 IF NOT FOUND OR c.kind<>'agent_dm' OR c.agent_key IS DISTINCT FROM t.agent_key OR t.intent<>'dm'
   OR t.agent_key NOT IN ('merit','cura','vera','paige','zion','nexus') THEN
  RAISE EXCEPTION 'Source read requires original private specialist DM' USING ERRCODE='42501'; END IF;
 -- EXP08 A2b card reads START: original token staging and atomic publication guard.
 IF t.agent_key IN ('paige','zion','nexus') THEN
  IF jsonb_typeof(tools) IS DISTINCT FROM 'array' OR jsonb_array_length(tools) NOT BETWEEN 1 AND 3 THEN
   RAISE EXCEPTION 'Card source scope unavailable' USING ERRCODE='42501'; END IF;
  IF t.agent_key<>'paige' THEN
   SELECT s.config INTO config FROM public.paige_subagents s
    WHERE s.tenant_id IS NULL AND s.slug=t.agent_key FOR SHARE;
   IF NOT FOUND OR config->'capability_scope'->>'mode' IS DISTINCT FROM 'allowlist'
    OR coalesce(config->'capability_scope'->>'access','') NOT IN ('read','card')
    OR jsonb_typeof(config->'capability_scope'->'tools') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Card source roster unavailable' USING ERRCODE='42501'; END IF;
  END IF;
  -- EXP05 Planning: same accepted token, current versions before publication.
  IF tools ? 'plan_list' OR t.read_context ? 'planning' THEN
   IF t.agent_key<>'zion' OR NOT (tools ? 'plan_list') THEN
    RAISE EXCEPTION 'Planning source requires original ZION DM' USING ERRCODE='42501'; END IF;
   PERFORM public._team_hub_assert_planning_read(t);
  END IF;
  -- EXP05 Calendar: original native records, same accepted turn and total budget.
  IF tools ? 'read_calendar_agenda' OR t.read_context ? 'calendar' THEN
   IF t.agent_key<>'zion' OR NOT (tools ? 'read_calendar_agenda') THEN
    RAISE EXCEPTION 'Calendar source requires original ZION DM' USING ERRCODE='42501'; END IF;
   PERFORM public._team_hub_assert_calendar_read(t);
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(tools) LOOP
   IF jsonb_typeof(item)<>'string' OR NOT (CASE t.agent_key
    WHEN 'paige' THEN item#>>'{}' IN ('crm_list_tasks','crm_get_task','crm_list_team','growth_list')
    WHEN 'zion' THEN item#>>'{}' IN ('crm_list_tasks','crm_get_task','crm_list_team','plan_list','read_calendar_agenda')
    WHEN 'nexus' THEN item#>>'{}' IN ('growth_list','read_social_publication') ELSE false END)
    OR (t.agent_key<>'paige' AND NOT (config->'capability_scope'->'tools' @> jsonb_build_array(item))) THEN
    RAISE EXCEPTION 'Card source no longer permitted' USING ERRCODE='42501'; END IF;
  END LOOP;
  IF t.agent_key='zion' THEN
   FOR item IN SELECT value FROM jsonb_array_elements(coalesce(t.read_context->'record_links','[]'::jsonb)) LOOP
    IF item->>'destination'='operations_work' AND jsonb_typeof(item->'record_id')='string' AND NOT (item ? 'record_kind') THEN
     IF NOT (tools ? 'crm_list_tasks' OR tools ? 'crm_get_task') THEN
      RAISE EXCEPTION 'Original Task read required' USING ERRCODE='42501'; END IF;
     PERFORM 1 FROM public.tasks r WHERE r.id=(item->>'record_id')::uuid AND r.tenant_id=t.tenant_id FOR SHARE;
     IF NOT FOUND THEN RAISE EXCEPTION 'Original Task reference unavailable' USING ERRCODE='42501'; END IF;
    END IF;
   END LOOP;
  END IF;
  IF t.consumed_at IS NULL AND (t.read_context->>'expires_at')::timestamptz<=clock_timestamp() THEN
   RAISE EXCEPTION 'Source read verification expired' USING ERRCODE='42501'; END IF;
  RETURN;
 END IF;
 -- EXP08 A2b card reads END.
 SELECT s.config INTO config FROM public.paige_subagents s
  WHERE s.tenant_id IS NULL AND s.slug=t.agent_key FOR SHARE;
 IF NOT FOUND OR config->'capability_scope'->>'mode' IS DISTINCT FROM 'allowlist'
   OR config->'capability_scope'->>'access' IS DISTINCT FROM 'read'
   OR jsonb_typeof(config->'capability_scope'->'tools') IS DISTINCT FROM 'array'
   OR jsonb_typeof(tools) IS DISTINCT FROM 'array' OR jsonb_array_length(tools) NOT BETWEEN 1 AND 3 THEN
  RAISE EXCEPTION 'Source read scope unavailable' USING ERRCODE='42501'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(tools) LOOP
  IF jsonb_typeof(item)<>'string' OR NOT (config->'capability_scope'->'tools' @> jsonb_build_array(item))
    OR NOT (CASE t.agent_key
      WHEN 'merit' THEN item#>>'{}' IN ('agreement_list','agreement_status','read_client_engagement_status')
      WHEN 'cura' THEN item#>>'{}'='read_client_engagement_status'
      WHEN 'vera' THEN item#>>'{}'='read_business_metric' ELSE false END) THEN
   RAISE EXCEPTION 'Source read no longer permitted' USING ERRCODE='42501'; END IF;
 END LOOP;
 -- A consumed turn's historical reply stays historical. Unconsumed attestations are short lived.
 IF t.consumed_at IS NULL AND (t.read_context->>'expires_at')::timestamptz<=clock_timestamp() THEN
  RAISE EXCEPTION 'Source read verification expired' USING ERRCODE='42501'; END IF;
END $function$;

DO $social_guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)'::regprocedure
  AND md5(prosrc) IN ('bd0e68f3c3e88976786d716dc4a870a6','fb04b67134a1323117836978a66c0bfa') AND proowner='postgres'::regrole AND provolatile='v'
  AND prosecdef AND proconfig=ARRAY['search_path=""']
  AND (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(proacl) a)=ARRAY['authenticated=X/postgres','postgres=X/postgres']) THEN
  RAISE EXCEPTION 'EXP07_SOCIAL_CARD_SOURCE_CHANGED'; END IF;
END $social_guard$;

CREATE OR REPLACE FUNCTION public.team_hub_post_agent_message(p_expected_tenant uuid, p_channel_id uuid, p_agent_key text, p_body text, p_client_request_id uuid, p_parent_message_id uuid, p_asked_in_message_id uuid, p_intent text, p_turn_token text, p_private_answer boolean DEFAULT false, p_confirmation_id uuid DEFAULT NULL::uuid, p_card_kind text DEFAULT NULL::text, p_card_outcome jsonb DEFAULT NULL::jsonb, p_card_summary text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
 turn public.team_hub_agent_turns; src public.team_hub_messages; msg public.team_hub_messages; hashed text;
 body text:=coalesce(public._team_hub_trim(p_body),'');
 private_line constant text:='That part is just for you, so I''m answering it in our DM.';
 -- A2b: the proposal a 'dm' post links, or the card an 'outcome:<card>' post answers, and that card's thread.
 conf public.paige_pending_confirmations; card public.team_hub_message_cards; card_root uuid;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF p_client_request_id IS NULL OR p_agent_key IS NULL OR p_intent IS NULL
   OR p_turn_token IS NULL OR char_length(p_turn_token) NOT BETWEEN 32 AND 200 THEN
  RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 hashed:=encode(sha256(convert_to(p_turn_token,'UTF8')),'hex');
 SELECT * INTO turn FROM public.team_hub_agent_turns t WHERE t.asker_user_id=actor AND t.tenant_id=p_expected_tenant
  AND t.channel_id=ch.id AND t.agent_key=p_agent_key AND t.intent=p_intent AND t.token_hash=hashed FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  -- EXP04 original post: current native authority, bound to this exact accepted token.
  IF turn.read_context->>'token_hash'=hashed THEN
   PERFORM public._team_hub_assert_agent_read_scope(turn);
  END IF;
 -- The same token and request id again: the outcome of an earlier call was unknown. Return that row.
 IF turn.consumed_at IS NOT NULL THEN
  SELECT * INTO msg FROM public.team_hub_messages m WHERE m.id=turn.posted_message_id
   AND m.author_user_id=actor AND m.client_request_id=p_client_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true)
   -- A2b: and the card it links, if it links one.
   || CASE WHEN EXISTS(SELECT 1 FROM public.team_hub_message_cards k WHERE k.message_id=msg.id)
    THEN jsonb_build_object('card',jsonb_build_object('message_id',msg.id)) ELSE '{}'::jsonb END;
 END IF;
 SELECT * INTO src FROM public.team_hub_messages m WHERE m.id=turn.source_message_id;
 -- A2b: an outcome post answers in its card's thread and links to no asking message (the card itself
 -- already answers it); it carries no proposal and no private line. Every other post keeps the rule below.
 IF p_intent~'^outcome:' THEN
  IF src.deleted_at IS NOT NULL OR p_private_answer OR p_confirmation_id IS NOT NULL OR p_card_kind IS NOT NULL
    OR p_card_summary IS NOT NULL THEN
   RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  SELECT * INTO card FROM public.team_hub_message_cards k WHERE k.message_id=substr(p_intent,9)::uuid
   AND k.tenant_id=p_expected_tenant AND k.channel_id=ch.id FOR UPDATE;
  IF NOT FOUND OR card.approver_user_id<>actor OR card.decision IS DISTINCT FROM 'approved'
    OR card.outcome IS NULL
    OR card.outcome_message_id IS NOT NULL
    OR (p_card_outcome IS NOT NULL AND (jsonb_typeof(p_card_outcome)<>'object' OR p_card_outcome->>'state' IS DISTINCT FROM card.outcome)) THEN
   RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  SELECT coalesce(m.parent_message_id,m.id) INTO card_root FROM public.team_hub_messages m WHERE m.id=card.message_id;
  IF p_asked_in_message_id IS NOT NULL OR p_parent_message_id IS DISTINCT FROM card_root THEN
   RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 ELSE
 -- Where the reply goes. A reply answers where it was asked: a thread question in its thread, a
 -- top-level question at the top level, linked to it (owner ruling 2026-10-27, Q2). An answer in the
 -- agent DM links to the asking message only when that message is in the DM itself.
 IF src.deleted_at IS NOT NULL
   OR p_asked_in_message_id IS DISTINCT FROM (CASE WHEN src.channel_id=ch.id THEN src.id END)
   OR p_parent_message_id IS DISTINCT FROM (CASE WHEN src.channel_id=ch.id THEN src.parent_message_id END) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  -- A2b: a 'dm' post in the agent DM may link one proposal: the caller's own, in this workspace, outside
  -- any chat thread and client focus, still live, minted in THIS turn (never one an earlier turn or
  -- another surface left waiting), for a card tool in this agent's stored DM scope, and linked nowhere yet.
  -- Its sentence, when given, goes only with a link, and is 1 to 280 characters once trimmed.
  IF p_card_outcome IS NOT NULL OR (p_card_summary IS NOT NULL AND (p_confirmation_id IS NULL
    OR char_length(coalesce(public._team_hub_trim(p_card_summary),'')) NOT BETWEEN 1 AND 280)) THEN
   RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  IF p_confirmation_id IS NOT NULL OR p_card_kind IS NOT NULL THEN
   IF p_confirmation_id IS NULL OR p_card_kind IS NULL OR p_intent<>'dm' OR ch.kind<>'agent_dm' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
   SELECT * INTO conf FROM public.paige_pending_confirmations p WHERE p.id=p_confirmation_id AND p.user_id=actor
    AND p.tenant_id=p_expected_tenant
    AND p.thread_id IS NULL
    AND p.scoped_client_id IS NULL AND p.consumed_at IS NULL AND p.expires_at>now()
    AND p.server_issued_at IS NOT NULL AND p.server_issued_at>=turn.accepted_at
    FOR UPDATE;
   IF NOT FOUND
     OR (conf.tool_name,p_card_kind) NOT IN (('crm_assign_task','task_handover'),('crm_cancel_task','task_cancel'),
      ('growth_page_publish','page_publish'),('social.post_publish','social_publish'))
     OR (conf.tool_name='social.post_publish' AND (
       ch.agent_key<>'nexus' OR turn.read_context->>'token_hash' IS DISTINCT FROM turn.token_hash
       OR NOT (coalesce(turn.read_context->'tools','[]'::jsonb) ? 'read_social_publication')
       OR coalesce((turn.read_context->>'expires_at')::timestamptz,'-infinity')<=clock_timestamp()
       OR NOT (EXISTS(SELECT 1 FROM public.marketing_content mc WHERE mc.tenant_id=p_expected_tenant
        AND mc.id=(conf.args->>'content_id')::uuid AND mc.status<>'archived'
        AND mc.updated_at=(conf.args->>'content_revision')::timestamptz)
        OR (conf.args->>'operation' IN ('reschedule','cancel_schedule') AND EXISTS(SELECT 1 FROM public.content_publications cp
          WHERE cp.id=(conf.args->>'publication_id')::uuid AND cp.tenant_id=p_expected_tenant AND cp.status='scheduled'
           AND cp.content_id=(conf.args->>'content_id')::uuid AND cp.request_args->>'content_revision'=conf.args->>'content_revision'
           AND cp.provider_response->'schedule'->'version'=conf.args->'publication_version')))))
     OR NOT (CASE WHEN conf.tool_name='social.post_publish' THEN ch.agent_key='nexus'
       AND EXISTS(SELECT 1 FROM public.paige_subagents a WHERE a.slug='nexus' AND a.tenant_id IS NULL
        AND a.config->'capability_scope'->>'mode'='allowlist' AND a.config->'capability_scope'->>'access'='card'
        AND (a.config->'capability_scope'->'tools') ? 'social_post_publish'
        AND (a.config->'capability_scope'->'tools') ? 'read_social_publication')
      WHEN ch.agent_key='paige' THEN conf.tool_name IN ('ask_choices','capability_status','read_business_time_zone',
       'team_hub_read_conversation','crm_list_tasks','crm_get_task','crm_list_team','growth_list',
       'crm_assign_task','crm_cancel_task','growth_page_publish')
      ELSE EXISTS(SELECT 1 FROM public.paige_subagents a WHERE a.slug=ch.agent_key AND a.tenant_id IS NULL
       AND a.config->'capability_scope'->>'access'='card' AND (a.config->'capability_scope'->'tools') ? conf.tool_name) END)
     OR EXISTS(SELECT 1 FROM public.team_hub_message_cards k WHERE k.confirmation_id=conf.id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  END IF;
 END IF;
 IF p_private_answer THEN body:=btrim(body||E'\n\n'||private_line, E' \t\r\n'); END IF;
 IF body='' THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF char_length(body)>8000 THEN RETURN jsonb_build_object('ok',false,'code','too_long'); END IF;
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,parent_message_id,client_request_id,
  author_kind,agent_key,asked_in_message_id)
  VALUES (p_expected_tenant,ch.id,actor,body,p_parent_message_id,p_client_request_id,'agent',p_agent_key,p_asked_in_message_id)
  ON CONFLICT DO NOTHING RETURNING * INTO msg;
 IF msg.id IS NULL THEN
  -- A2b: a card or an outcome is recorded only on a row this post writes itself.
  IF conf.id IS NOT NULL OR card.message_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  -- Already stored: under this request id (an earlier attempt of this same post), or by the one-reply
  -- rule (this agent already answered this message). Return that row; never another person's or agent's.
  SELECT * INTO msg FROM public.team_hub_messages m WHERE m.author_user_id=actor AND m.client_request_id=p_client_request_id;
  IF NOT FOUND THEN
   SELECT * INTO msg FROM public.team_hub_messages m WHERE m.author_kind='agent' AND m.agent_key=p_agent_key
    AND m.asked_in_message_id=p_asked_in_message_id AND m.channel_id=ch.id;
  END IF;
  -- The row must also answer THIS turn's question in THIS place: a request id reused for another
  -- question by the same agent is refused, never bound to the turn as if it were its reply. A row
  -- another turn already posted is that turn's reply, never this one's: two DM questions asked
  -- elsewhere both answer in the agent DM unlinked, so place and link alone cannot tell them apart.
  IF NOT FOUND OR msg.author_user_id<>actor OR msg.author_kind<>'agent' OR msg.agent_key<>p_agent_key
    OR msg.channel_id<>ch.id
    OR EXISTS(SELECT 1 FROM public.team_hub_agent_turns o WHERE o.posted_message_id=msg.id AND o.id<>turn.id)
    OR msg.asked_in_message_id IS DISTINCT FROM p_asked_in_message_id
    OR msg.parent_message_id IS DISTINCT FROM p_parent_message_id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  UPDATE public.team_hub_agent_turns t SET consumed_at=now(), posted_message_id=msg.id WHERE t.id=turn.id;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
 END IF;
 UPDATE public.team_hub_agent_turns t SET consumed_at=now(), posted_message_id=msg.id WHERE t.id=turn.id;
 -- A2b: the card link, or the outcome post recorded on its card, in the same transaction as the post.
 IF conf.id IS NOT NULL THEN
  INSERT INTO public.team_hub_message_cards(message_id,tenant_id,channel_id,approver_user_id,confirmation_id,tool_name,kind,summary)
   VALUES (msg.id,p_expected_tenant,ch.id,actor,conf.id,conf.tool_name,p_card_kind,public._team_hub_trim(p_card_summary));
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'card',jsonb_build_object('message_id',msg.id));
 END IF;
 IF card.message_id IS NOT NULL THEN
  UPDATE public.team_hub_message_cards k SET outcome_message_id=msg.id WHERE k.message_id=card.message_id;
 END IF;
 RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg));
END $function$;

DO $social_guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.team_hub_settle_card(uuid,uuid,uuid,jsonb)'::regprocedure
  AND md5(prosrc) IN ('83eb8b40e802e18982c4a165c50662f6','9f196e1a1ab64597fce7a9f357ecc5bd') AND proowner='postgres'::regrole AND provolatile='v'
  AND prosecdef AND proconfig=ARRAY['search_path=""']
  AND (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(proacl) a)=ARRAY['postgres=X/postgres','service_role=X/postgres']) THEN
  RAISE EXCEPTION 'EXP07_SOCIAL_CARD_SOURCE_CHANGED'; END IF;
END $social_guard$;

CREATE OR REPLACE FUNCTION public.team_hub_settle_card(p_expected_tenant uuid, p_actor uuid, p_message_id uuid, p_outcome jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=p_actor; card public.team_hub_message_cards;
 state text; note text; rec jsonb;
BEGIN
 -- A request that carries a user's JWT is never the server settling (as team_hub_accept_agent_turn).
 IF auth.uid() IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF p_expected_tenant IS NULL OR actor IS NULL OR NOT public._team_hub_is_active(p_expected_tenant, actor) THEN
  RETURN jsonb_build_object('ok',false,'code','not_member'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_expected_tenant
   AND t.account_type='standalone' AND t.parent_tenant_id IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','unavailable'); END IF;
 IF NOT public._team_hub_participates(p_expected_tenant, actor) THEN
  RETURN jsonb_build_object('ok',false,'code','conversations_off'); END IF;
 IF p_message_id IS NULL OR p_outcome IS NULL OR jsonb_typeof(p_outcome)<>'object'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_outcome) x(k) WHERE x.k NOT IN ('state','note','record'))
   OR jsonb_typeof(p_outcome->'state') IS DISTINCT FROM 'string' OR p_outcome->>'state' NOT IN ('done','failed','unconfirmed')
   OR (p_outcome ? 'note' AND jsonb_typeof(p_outcome->'note') NOT IN ('string','null'))
   OR (p_outcome ? 'record' AND jsonb_typeof(p_outcome->'record') NOT IN ('object','null')) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 state:=p_outcome->>'state';
 note:=nullif(public._team_hub_trim(p_outcome->>'note'),'');
 rec:=CASE WHEN jsonb_typeof(p_outcome->'record')='object' THEN p_outcome->'record' END;
 IF (note IS NOT NULL AND char_length(note)>280)
   OR (rec IS NOT NULL AND (state<>'done' OR (rec - 'destination' - 'record_id')<>'{}'::jsonb
    OR jsonb_typeof(rec->'destination') IS DISTINCT FROM 'string' OR rec->>'destination' !~ '^[a-z][a-z0-9_]{0,63}$'
    OR jsonb_typeof(rec->'record_id') IS DISTINCT FROM 'string'
    OR rec->>'record_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT * INTO card FROM public.team_hub_message_cards k WHERE k.message_id=p_message_id AND k.tenant_id=p_expected_tenant FOR UPDATE;
 IF NOT FOUND
   OR NOT EXISTS(SELECT 1 FROM public._team_hub_visible(p_expected_tenant,actor,card.channel_id))
   OR NOT EXISTS(SELECT 1 FROM public.team_hub_messages m WHERE m.id=card.message_id AND m.deleted_at IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF card.approver_user_id<>actor THEN RETURN jsonb_build_object('ok',false,'code','not_yours'); END IF;
 IF card.decision IS DISTINCT FROM 'approved' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF card.outcome IS NOT NULL THEN
  RETURN jsonb_build_object('ok',true,'already',true,'outcome',card.outcome,'note',card.outcome_note); END IF;
 -- Original Social success requires the native publication for THIS card's sole approval.
 IF card.kind='social_publish' AND state='done' AND NOT EXISTS(
  SELECT 1 FROM public.content_publications cp JOIN public.paige_pending_confirmations pc ON pc.id=card.confirmation_id
  WHERE (cp.confirmation_id=card.confirmation_id OR cp.provider_response->'schedule'->'approvals' ? card.confirmation_id::text)
   AND cp.tenant_id=p_expected_tenant
   AND pc.user_id=actor AND pc.tenant_id=p_expected_tenant AND pc.tool_name='social.post_publish'
   AND pc.thread_id IS NULL AND pc.scoped_client_id IS NULL AND pc.consumed_at IS NOT NULL
   AND cp.content_id=(pc.args->>'content_id')::uuid AND cp.request_args->>'content_revision'=pc.args->>'content_revision'
   AND nullif(cp.provider_request_id,'') IS NOT NULL
   AND ((cp.status='published' AND coalesce(pc.args->>'operation','publish')='publish' AND nullif(cp.provider_post_id,'') IS NOT NULL AND cp.provider_post_url LIKE 'https://%')
    OR (cp.provider_response->'schedule'->'approvals'->(card.confirmation_id::text)->>'state' IN ('scheduled','cancelled')
      AND cp.provider_response->'schedule'->'approvals'->(card.confirmation_id::text)->'instruction'=(pc.args->>'schedule')::jsonb
      AND (cp.provider_response->'schedule'->'approvals'->(card.confirmation_id::text)->>'version')::integer=
        coalesce((pc.args->>'publication_version')::integer+1,(pc.args->>'schedule_version')::integer)))) THEN
  RETURN jsonb_build_object('ok',false,'code','unverified'); END IF;
 IF card.kind='social_publish' AND state='failed' AND EXISTS(
  SELECT 1 FROM public.content_publications cp WHERE (cp.confirmation_id=card.confirmation_id OR cp.provider_response->'schedule'->'approvals' ? card.confirmation_id::text)
   AND cp.tenant_id=p_expected_tenant AND cp.status IN ('approved','publishing','outcome_unknown','published','partial','scheduled','schedule_changing','cancelled')) THEN
  RETURN jsonb_build_object('ok',false,'code','unverified'); END IF;
 IF state='failed' THEN
  UPDATE public.paige_pending_confirmations p SET consumed_at=clock_timestamp() WHERE p.id=card.confirmation_id
   AND p.user_id=actor AND p.tenant_id=p_expected_tenant AND p.thread_id IS NULL AND p.consumed_at IS NULL;
 END IF;
 UPDATE public.team_hub_message_cards k SET outcome=state, outcome_note=note, outcome_record=rec, settled_at=clock_timestamp()
  WHERE k.message_id=card.message_id;
 RETURN jsonb_build_object('ok',true,'outcome',state);
END $function$;

DO $social_guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.team_hub_card_states(uuid,uuid,uuid[])'::regprocedure
  AND md5(prosrc) IN ('942febe890d60e20b3470f2175a2dafd','4f986b550ad1b28c277e1db308a16f75') AND proowner='postgres'::regrole AND provolatile='s'
  AND prosecdef AND proconfig=ARRAY['search_path=""']
  AND (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(proacl) a)=ARRAY['authenticated=X/postgres','postgres=X/postgres']) THEN
  RAISE EXCEPTION 'EXP07_SOCIAL_CARD_SOURCE_CHANGED'; END IF;
END $social_guard$;

CREATE OR REPLACE FUNCTION public.team_hub_card_states(p_expected_tenant uuid, p_channel_id uuid, p_message_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels; cards jsonb;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF p_message_ids IS NULL OR cardinality(p_message_ids)>100 OR array_position(p_message_ids,NULL) IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('message_id',s.message_id,
   'card',jsonb_build_object('state',s.state,'kind',s.kind,
    'actions',jsonb_build_array(jsonb_build_object('summary',s.summary)
     || CASE WHEN s.approver_user_id=actor AND (s.state='waiting' OR s.can_resume) THEN jsonb_build_object('fingerprint',s.fingerprint) ELSE '{}'::jsonb END
     || CASE WHEN s.state IN ('done','failed') AND s.outcome_note IS NOT NULL THEN jsonb_build_object('note',s.outcome_note) ELSE '{}'::jsonb END),
    'can_resume',s.can_resume AND s.approver_user_id=actor,
    'asker_user_id',s.approver_user_id,
    'decided_by_name',CASE WHEN s.decision IS NULL THEN NULL WHEN s.approver_active
     THEN coalesce(nullif(btrim(pr.full_name),''),'Teammate') ELSE 'Former teammate' END,
    'decided_at',s.decided_at,'expires_at',s.expires_at),
   'outcome_message_id',s.outcome_message_id,'record',s.outcome_record)
   || CASE WHEN s.social_reference IS NOT NULL THEN jsonb_build_object('social_reference',s.social_reference) ELSE '{}'::jsonb END
   || CASE WHEN s.approver_user_id=actor AND s.approval_context IS NOT NULL
      THEN jsonb_build_object('approval_context',s.approval_context) ELSE '{}'::jsonb END
   ORDER BY s.message_id),'[]'::jsonb) INTO cards
 FROM (
  SELECT k.message_id, k.kind, k.approver_user_id, k.decision, k.decided_at, k.outcome_message_id, k.outcome_record,
   k.outcome_note, coalesce(k.summary,p.summary) AS summary, p.fingerprint, p.expires_at, a.active AS approver_active,
   provenance.approval_context, social.reference AS social_reference,
   (k.decision='approved' AND k.outcome IS NULL AND k.decided_at<=now()-interval '10 seconds'
     AND a.active AND p.id IS NOT NULL AND p.consumed_at IS NULL AND p.scoped_client_id IS NULL AND p.expires_at>now()) AS can_resume,
   CASE WHEN k.decision='declined' THEN 'declined'
    WHEN k.decision='approved' THEN CASE WHEN k.outcome IS NOT NULL THEN k.outcome
     WHEN k.decided_at>now()-interval '10 minutes' THEN 'working' ELSE 'unconfirmed' END
    WHEN NOT a.active OR p.id IS NULL THEN 'expired'
    WHEN p.consumed_at IS NOT NULL THEN 'unconfirmed'
    WHEN p.expires_at<=now() THEN 'expired'
    ELSE 'waiting' END AS state
  FROM public.team_hub_message_cards k
  JOIN public.team_hub_messages m ON m.id=k.message_id AND m.channel_id=ch.id AND m.tenant_id=p_expected_tenant AND m.deleted_at IS NULL
  LEFT JOIN public.paige_pending_confirmations p ON p.id=k.confirmation_id AND p.user_id=k.approver_user_id
   AND p.tenant_id=k.tenant_id AND p.thread_id IS NULL
  CROSS JOIN LATERAL (SELECT public._team_hub_is_active(k.tenant_id,k.approver_user_id) AS active) a
  LEFT JOIN LATERAL (
   SELECT jsonb_build_object('tenant_id',k.tenant_id,'channel_id',ch.id,'approver_user_id',actor,
     'agent_key',t.agent_key,'source_message_id',t.source_message_id,'root_message_id',root.id) AS approval_context
   FROM public.team_hub_agent_turns t
   JOIN public.team_hub_messages src ON src.id=t.source_message_id AND src.tenant_id=k.tenant_id
    AND src.author_user_id=actor AND src.author_kind='user' AND src.deleted_at IS NULL
   JOIN public.team_hub_messages root ON root.id=coalesce(m.parent_message_id,m.id)
    AND root.tenant_id=k.tenant_id AND root.channel_id=ch.id AND root.parent_message_id IS NULL AND root.deleted_at IS NULL
   WHERE k.approver_user_id=actor AND ch.kind='agent_dm' AND ch.created_by=actor
    AND m.author_user_id=actor AND m.author_kind='agent' AND m.agent_key=ch.agent_key
    AND t.posted_message_id=m.id AND t.tenant_id=k.tenant_id AND t.asker_user_id=actor
    AND t.channel_id=ch.id AND t.agent_key=m.agent_key AND t.intent='dm' AND t.consumed_at IS NOT NULL
    AND t.agent_key IN ('paige','vera','nexus','cura','mentor','merit','zion')
    AND EXISTS(SELECT 1 FROM public._team_hub_visible(k.tenant_id,actor,src.channel_id))
    AND NOT EXISTS(SELECT 1 FROM public.team_hub_agent_turns other WHERE other.posted_message_id=m.id AND other.id<>t.id)
  ) provenance ON true
  LEFT JOIN LATERAL (
   SELECT count(*) AS matches,min(cp.id::text) AS publication_id,min(cp.content_id::text) AS content_id,
    min(cp.request_args->>'content_revision') AS content_revision
   FROM public.content_publications cp WHERE (cp.confirmation_id=k.confirmation_id OR cp.provider_response->'schedule'->'approvals' ? k.confirmation_id::text) AND cp.tenant_id=k.tenant_id
  ) publication ON true
  LEFT JOIN LATERAL (
   SELECT jsonb_build_object('schema',1,'tenant_id',k.tenant_id,
    'content_id',CASE WHEN publication.matches=1 THEN publication.content_id ELSE p.args->>'content_id' END,
    'content_revision',CASE WHEN publication.matches=1 THEN publication.content_revision ELSE p.args->>'content_revision' END,
    'publication_id',CASE WHEN publication.matches=1 THEN publication.publication_id END) AS reference
   WHERE k.tool_name='social.post_publish' AND k.kind='social_publish' AND ch.kind='agent_dm' AND ch.agent_key='nexus'
    AND k.approver_user_id=actor AND provenance.approval_context IS NOT NULL AND publication.matches<=1
    AND (publication.matches=1 OR (p.tool_name=k.tool_name AND p.scoped_client_id IS NULL
     AND p.server_issued_at IS NOT NULL AND p.issued_in_request IS NOT NULL))
    AND coalesce(publication.content_id,p.args->>'content_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND length(coalesce(publication.content_revision,p.args->>'content_revision')) BETWEEN 1 AND 80
  ) social ON true
  WHERE k.message_id=ANY(p_message_ids) AND k.channel_id=ch.id AND k.tenant_id=p_expected_tenant
 ) s
 LEFT JOIN public.profiles pr ON pr.user_id=s.approver_user_id;
 RETURN jsonb_build_object('ok',true,'cards',cards);
END $function$;

DO $social_kind$
DECLARE normalized text;
BEGIN
 SELECT regexp_replace(pg_get_constraintdef(oid),'[[:space:]()]|::text','','g') INTO normalized FROM pg_constraint
  WHERE conrelid='public.team_hub_message_cards'::regclass AND conname='team_hub_message_cards_kind_chk';
 IF normalized NOT IN (
  'CHECKtool_name=''crm_assign_task''ANDkind=''task_handover''ORtool_name=''crm_cancel_task''ANDkind=''task_cancel''ORtool_name=''growth_page_publish''ANDkind=''page_publish''',
  'CHECKtool_name=''crm_assign_task''ANDkind=''task_handover''ORtool_name=''crm_cancel_task''ANDkind=''task_cancel''ORtool_name=''growth_page_publish''ANDkind=''page_publish''ORtool_name=''social.post_publish''ANDkind=''social_publish''') OR normalized IS NULL THEN
  RAISE EXCEPTION 'EXP07_SOCIAL_CARD_KIND_CHANGED'; END IF;
 ALTER TABLE public.team_hub_message_cards DROP CONSTRAINT team_hub_message_cards_kind_chk;
 ALTER TABLE public.team_hub_message_cards ADD CONSTRAINT team_hub_message_cards_kind_chk CHECK (
  (tool_name='crm_assign_task' AND kind='task_handover') OR (tool_name='crm_cancel_task' AND kind='task_cancel')
  OR (tool_name='growth_page_publish' AND kind='page_publish') OR (tool_name='social.post_publish' AND kind='social_publish'));
END $social_kind$;

DO $social_roster$
DECLARE roster public.paige_subagents; next_tools jsonb;
BEGIN
 IF (SELECT count(*) FROM public.paige_subagents WHERE tenant_id IS NULL AND slug='nexus')<>1 THEN
  RAISE EXCEPTION 'EXP07_NEXUS_ROSTER_CHANGED'; END IF;
 SELECT * INTO roster FROM public.paige_subagents WHERE tenant_id IS NULL AND slug='nexus' FOR UPDATE;
 IF roster.config->'capability_scope'->>'mode' IS DISTINCT FROM 'allowlist'
  OR roster.config->'capability_scope'->>'access' IS DISTINCT FROM 'card'
  OR jsonb_typeof(roster.config->'capability_scope'->'tools') IS DISTINCT FROM 'array'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(roster.config->'capability_scope'->'tools') v WHERE jsonb_typeof(v)<>'string') THEN
  RAISE EXCEPTION 'EXP07_NEXUS_ROSTER_CHANGED'; END IF;
 next_tools:=roster.config->'capability_scope'->'tools';
 IF NOT (next_tools ? 'read_social_publication') THEN next_tools:=next_tools||jsonb_build_array('read_social_publication'); END IF;
 IF NOT (next_tools ? 'social_post_publish') THEN next_tools:=next_tools||jsonb_build_array('social_post_publish'); END IF;
 UPDATE public.paige_subagents SET config=jsonb_set(config,'{capability_scope,tools}',next_tools,false)
  WHERE id=roster.id AND tenant_id IS NULL AND slug='nexus';
END $social_roster$;

COMMIT;
