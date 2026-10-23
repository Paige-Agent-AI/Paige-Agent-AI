-- EXP09: reuse the original customer-safe Sessions read; no writer/runtime/Identity change.
BEGIN;
DO $lease$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
  WHERE p.oid=pg_catalog.to_regprocedure('public.client_portal_sessions(uuid,text,timestamptz,integer)')
   AND pg_catalog.md5(p.prosrc)='1bbb4e8f7361b6396bb8131b71246ee3' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
  WHERE p.oid=pg_catalog.to_regprocedure('public._portal_session_location_label(text,text,boolean,boolean)')
   AND pg_catalog.md5(p.prosrc)='2263158bf71f718f1b372f621e7ef3b3' AND pg_catalog.pg_get_userbyid(p.proowner)='postgres') THEN
  RAISE EXCEPTION 'Original customer Sessions source changed; reconcile' USING ERRCODE='42501';
 END IF;
END $lease$;

-- Internal projection is not an authority grant; only postgres may execute it.
CREATE FUNCTION public._client_portal_sessions_projection(
 p_tenant_id uuid,p_client_id uuid,p_window text,p_before timestamptz,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $projection$
DECLARE
  _client_id uuid := p_client_id;
  _tenant uuid := p_tenant_id;
  _upcoming boolean := coalesce(p_window, 'upcoming') <> 'past';
  _limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  _rows jsonb;
  _next timestamptz;
BEGIN
  IF p_tenant_id IS NULL OR p_client_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.clients c WHERE c.id=p_client_id AND c.tenant_id=p_tenant_id) THEN
    RETURN NULL;
  END IF;
  WITH own AS (
    -- One row per meeting: a collective booking is N host legs sharing collective_group_id; keep
    -- the smallest id, the same representative the booking Rail emits for. Class session marker
    -- rows and host blocks are never the customer's sessions.
    SELECT DISTINCT ON (coalesce(b.collective_group_id, b.id)) b.*
    FROM public.internal_bookings b
    WHERE b.tenant_id = _tenant AND b.contact_id = _client_id
      AND b.booking_kind <> 'class_session' AND b.status <> 'blocked'
    ORDER BY coalesce(b.collective_group_id, b.id), b.id
  ), win AS (
    SELECT o.*,
      CASE WHEN _upcoming THEN extract(epoch FROM o.start_at) ELSE -extract(epoch FROM o.start_at) END AS sort_key
    FROM own o
    WHERE ((o.status = 'scheduled' AND o.end_at >= now()) = _upcoming)
      AND (p_before IS NULL OR (_upcoming AND o.start_at > p_before) OR (NOT _upcoming AND o.start_at < p_before))
  ), ranked AS (
    SELECT w.*, row_number() OVER (ORDER BY w.sort_key, w.id) AS rn FROM win w
  ), boundary AS (
    SELECT r.start_at FROM ranked r WHERE r.rn = _limit
  ), page AS (
    -- A page never splits sessions that share a start time: the cursor is a start time, so every
    -- row tied with the last one rides along and the next page loses and repeats nothing.
    SELECT r.* FROM ranked r
    WHERE r.rn <= _limit OR r.start_at = (SELECT start_at FROM boundary)
  ), shaped AS (
    SELECT p.sort_key, p.id, p.start_at,
      -- A negative notice is never a licence to change a session after it starts: clamp at zero.
      CASE WHEN cal.id IS NULL THEN NULL ELSE p.start_at - make_interval(mins => greatest(cal.min_notice_min, 0)) END AS deadline,
      cal.id AS cal_id, cal.enabled AS cal_enabled, cal.slug AS cal_slug, cal.accent AS cal_accent,
      cal.title AS cal_title, cal.duration_min AS cal_duration,
      p.title AS raw_title, p.end_at, p.timezone, p.status, p.booking_kind,
      p.appointment_type, p.location_type, p.location_value, p.meeting_url, p.meeting_link
    FROM page p
    LEFT JOIN public.calendars cal ON cal.id = p.calendar_id AND cal.tenant_id = _tenant
  ), joined AS (
    SELECT s.*,
      (SELECT u FROM unnest(ARRAY[s.meeting_url, s.meeting_link,
          CASE WHEN s.location_type IN ('zoom','google_meet','custom') THEN s.location_value END]) u
       WHERE u ~* '^https://[^[:space:]]+$' LIMIT 1) AS join_url
    FROM shaped s
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'id', j.id,
      -- The service's own name first; the raw booking title may be staff-written.
      'title', coalesce(nullif(btrim(j.appointment_type->>'name'), ''), nullif(btrim(j.cal_title), ''), 'Session'),
      'start_at', j.start_at,
      'end_at', j.end_at,
      'timezone', j.timezone,
      'status', j.status,
      'kind', CASE j.booking_kind WHEN 'collective' THEN 'collective' WHEN 'class_seat' THEN 'class_seat' ELSE 'single' END,
      'location', jsonb_build_object(
        'type', coalesce(j.location_type, 'unknown'),
        'label', public._portal_session_location_label(j.location_type, j.location_value, j.join_url IS NOT NULL,
          NOT (j.status = 'scheduled' AND j.end_at >= now())),
        'join_url', j.join_url),
      -- Which icon the place deserves, decided by the kind of place, never by whether a link exists.
      'location_kind', CASE
        WHEN j.location_type IN ('zoom','google_meet') THEN 'video'
        WHEN j.location_type = 'custom' AND j.join_url IS NOT NULL THEN 'video'
        WHEN j.location_type = 'phone' THEN 'phone'
        WHEN j.location_type = 'in_person' THEN 'in_person'
        ELSE 'tbd' END,
      'calendar', CASE WHEN j.cal_id IS NULL THEN NULL ELSE jsonb_build_object(
        'slug', j.cal_slug,
        'duration_min', coalesce(CASE WHEN (j.appointment_type->>'duration_min') ~ '^[0-9]{1,4}$'
          THEN (j.appointment_type->>'duration_min')::integer END, j.cal_duration),
        'appointment_type_id', nullif(j.appointment_type->>'id', ''),
        'accent', j.cal_accent) END,
      'change', jsonb_build_object(
        'can_cancel', j.status = 'scheduled' AND j.cal_id IS NOT NULL AND now() <= j.deadline,
        'can_reschedule', j.status = 'scheduled' AND j.cal_id IS NOT NULL AND now() <= j.deadline AND j.cal_enabled,
        'deadline', j.deadline,
        'reason', CASE
          WHEN j.status <> 'scheduled' THEN 'NOT_SCHEDULED'
          WHEN j.cal_id IS NULL THEN 'NO_CALENDAR'
          WHEN now() > j.deadline THEN 'WINDOW_CLOSED'
          WHEN NOT j.cal_enabled THEN 'CALENDAR_UNAVAILABLE'
        END)
    ) ORDER BY j.sort_key, j.id), '[]'::jsonb),
    -- The last start time on this page, in the window's order.
    CASE WHEN _upcoming THEN max(j.start_at) ELSE min(j.start_at) END
  INTO _rows, _next
  FROM joined j;

  -- next_before is the cursor for the following page in this window's order (pass it back as
  -- p_before); NULL when nothing further exists.
  IF _next IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.internal_bookings b
    WHERE b.tenant_id = _tenant AND b.contact_id = _client_id
      AND b.booking_kind <> 'class_session' AND b.status <> 'blocked'
      AND ((b.status = 'scheduled' AND b.end_at >= now()) = _upcoming)
      AND ((_upcoming AND b.start_at > _next) OR (NOT _upcoming AND b.start_at < _next))) THEN
    _next := NULL;
  END IF;
  RETURN jsonb_build_object('tenant_id', _tenant, 'server_now', now(), 'sessions', _rows, 'next_before', _next);
END;
$projection$;
REVOKE ALL ON FUNCTION public._client_portal_sessions_projection(uuid,uuid,text,timestamptz,integer)
 FROM PUBLIC,anon,authenticated,service_role;

-- Body-only replacement retains the actual header/defaults/attributes/owner/ACL.
DO $public$
DECLARE target oid:=pg_catalog.to_regprocedure('public.client_portal_sessions(uuid,text,timestamptz,integer)');
 prior text; definition text;
 replacement text:=$replacement$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _upcoming boolean := coalesce(p_window, 'upcoming') <> 'past';
  _limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  _rows jsonb;
  _next timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  -- 42501 "select an authorized customer relationship" (more than one business) propagates as is.
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN NULL; END IF;
  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client_id AND c.linked_user_id = _uid;
  IF _tenant IS NULL THEN RETURN NULL; END IF;

  RETURN public._client_portal_sessions_projection(_tenant,_client_id,p_window,p_before,p_limit);
END;
$replacement$;
BEGIN
 SELECT prosrc INTO prior FROM pg_catalog.pg_proc WHERE oid=target;
 IF pg_catalog.md5(prior) IS DISTINCT FROM '1bbb4e8f7361b6396bb8131b71246ee3'
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=target AND pg_catalog.pg_get_userbyid(p.proowner)='postgres') THEN
  RAISE EXCEPTION 'Original Sessions body changed; reconcile' USING ERRCODE='42501';
 END IF;
 definition:=pg_catalog.pg_get_functiondef(target);
 IF length(definition)-length(replace(definition,prior,''))<>length(prior) THEN
  RAISE EXCEPTION 'Original Sessions body is not unique' USING ERRCODE='42501';
 END IF;
 EXECUTE replace(definition,prior,replacement);
END $public$;
COMMIT;
