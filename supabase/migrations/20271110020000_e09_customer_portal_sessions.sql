-- E09 Sessions: a signed-in customer reads THEIR OWN bookings with the business, and may
-- reschedule or cancel one only inside that calendar's notice window. Two customer RPCs (plus two internal helpers), no table:
--   * client_portal_sessions          — customer-safe projection of public.internal_bookings.
--   * client_portal_session_change_admit — the authority + notice-window gate the booking-manage
--     edge function calls (under the caller's own JWT) before it writes. It NEVER writes
--     public.internal_bookings: the one writer that applies slot rules, Zoom and notifications
--     stays booking-manage. No parallel writer, no new booking from the portal.
-- Scope is the auth subject's relationship (client_portal_relationship_id), never an argument:
-- a tenant argument only narrows. Host identity, guest PII, intake answers, staff notes and
-- provider ids are never projected. The notice window is calendars.min_notice_min, measured
-- before the booking's CURRENT start (the only notice value the platform stores).
BEGIN;

-- Replay lookup for a customer change: booking-manage writes one audit row per committed change
-- carrying the caller's request id; admission answers a retried request from it.
CREATE INDEX IF NOT EXISTS audit_logs_portal_request_id
  ON public.audit_logs ((data->>'portal_request_id'))
  WHERE entity = 'internal_booking' AND data ? 'portal_request_id';

-- Mirrors public-booking's locationLabel(): the same words the guest's own confirmation shows,
-- for a session that is still ahead. A settled session (cancelled, done, no-show, or simply over)
-- names the place only: nothing is still "to follow" for a meeting that is not happening.
DROP FUNCTION IF EXISTS public._portal_session_location_label(text, text, boolean);
CREATE OR REPLACE FUNCTION public._portal_session_location_label(p_type text, p_value text, p_has_join boolean, p_settled boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT CASE WHEN p_settled THEN CASE p_type
    WHEN 'google_meet' THEN 'Google Meet'
    WHEN 'zoom' THEN 'Zoom'
    WHEN 'phone' THEN 'Phone call'
    WHEN 'in_person' THEN coalesce(nullif(btrim(p_value), ''), 'In person')
    WHEN 'custom' THEN coalesce(nullif(btrim(p_value), ''), 'Location not recorded')
    ELSE 'Location not recorded' END
  ELSE CASE p_type
    WHEN 'google_meet' THEN CASE WHEN p_has_join THEN 'Google Meet' ELSE 'Google Meet — link to follow' END
    WHEN 'zoom' THEN CASE WHEN p_has_join THEN 'Zoom' ELSE 'Zoom — link to follow' END
    WHEN 'phone' THEN coalesce('Phone call: ' || nullif(btrim(p_value), ''), 'Phone call')
    WHEN 'in_person' THEN coalesce('In person: ' || nullif(btrim(p_value), ''), 'In person')
    WHEN 'custom' THEN coalesce(nullif(btrim(p_value), ''), 'Details to follow')
    ELSE 'To be confirmed' END
  END $$;
REVOKE ALL ON FUNCTION public._portal_session_location_label(text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_portal_sessions(
  p_tenant_id uuid DEFAULT NULL, p_window text DEFAULT 'upcoming',
  p_before timestamptz DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.client_portal_sessions(uuid, text, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_sessions(uuid, text, timestamptz, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.client_portal_session_change_admit(
  p_booking_id uuid, p_action text, p_request_id uuid,
  p_new_start timestamptz DEFAULT NULL, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _prior public.audit_logs%ROWTYPE;
  _prior_to timestamptz;
  _b public.internal_bookings%ROWTYPE;
  _notice integer;
  _enabled boolean;
  _deadline timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_REQUIRED'); END IF;
  IF p_action IS NULL OR p_action NOT IN ('cancel','reschedule') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_ACTION');
  END IF;
  IF p_action = 'reschedule' AND p_new_start IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NEW_TIME_REQUIRED');
  END IF;
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND'); END IF;
  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client_id AND c.linked_user_id = _uid;
  IF _tenant IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND'); END IF;

  -- Replay of a committed change: booking-manage's audit row for this request id.
  SELECT a.* INTO _prior FROM public.audit_logs a
  WHERE a.entity = 'internal_booking' AND a.data ? 'portal_request_id'
    AND a.data->>'portal_request_id' = p_request_id::text
  ORDER BY a.created_at, a.id LIMIT 1;
  IF FOUND THEN
    BEGIN
      _prior_to := (_prior.data->>'to_start')::timestamptz;
    EXCEPTION WHEN others THEN _prior_to := NULL;
    END;
    IF _prior.entity_id = p_booking_id
      AND _prior.data->>'client_id' = _client_id::text
      AND _prior.data->>'tenant_id' = _tenant::text
      AND _prior.action = 'client_portal_' || p_action
      AND (p_action = 'cancel' OR _prior_to = p_new_start) THEN
      SELECT b.* INTO _b FROM public.internal_bookings b
      WHERE b.id = p_booking_id AND b.tenant_id = _tenant AND b.contact_id = _client_id;
      RETURN jsonb_build_object('ok', true, 'replay', true, 'status', _b.status, 'start_at', _b.start_at);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
  END IF;

  -- Only the caller's own booking in their own business. Anything else — another customer's,
  -- another business's, a host block, a random id — is the same "not found", never "forbidden".
  SELECT b.* INTO _b FROM public.internal_bookings b
  WHERE b.id = p_booking_id AND b.tenant_id = _tenant AND b.contact_id = _client_id
    AND b.status <> 'blocked'
  FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND'); END IF;

  -- A retry whose change already landed (e.g. the write committed but its audit row did not).
  IF p_action = 'cancel' AND _b.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'status', _b.status, 'start_at', _b.start_at);
  END IF;
  IF p_action = 'reschedule' AND _b.status = 'scheduled' AND _b.start_at = p_new_start THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'status', _b.status, 'start_at', _b.start_at);
  END IF;

  IF _b.status <> 'scheduled' THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_CHANGEABLE'); END IF;

  SELECT cal.min_notice_min, cal.enabled INTO _notice, _enabled
  FROM public.calendars cal WHERE cal.id = _b.calendar_id AND cal.tenant_id = _tenant;
  IF _b.calendar_id IS NULL OR _notice IS NULL OR _b.booking_kind = 'class_session'
    OR (p_action = 'reschedule' AND NOT _enabled) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_CHANGE_UNAVAILABLE');
  END IF;

  _deadline := _b.start_at - make_interval(mins => greatest(_notice, 0));
  IF now() > _deadline THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_CHANGE_WINDOW_CLOSED', 'deadline', _deadline);
  END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', _b.id, 'tenant_id', _tenant,
    'client_id', _client_id, 'deadline', _deadline);
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_session_change_admit(uuid, text, uuid, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_session_change_admit(uuid, text, uuid, timestamptz, uuid) TO authenticated, service_role;

-- A customer's class-seat move, claimed on the start time the caller loaded. booking-manage's
-- other customer writes are conditional updates (status + current start), so two identical
-- requests racing past admission change the booking once; the class move goes through
-- reschedule_class_booking, which treats "already at the new time" as a silent no-op, so the
-- claim lives here: lock the seat only while it still sits where the caller saw it, then move it.
-- The loser of a race waits on the lock, re-reads a start that has moved, and gets moved=false.
-- Service role only (booking-manage); the guest link keeps calling reschedule_class_booking.
CREATE OR REPLACE FUNCTION public._portal_session_move_class_seat(
  p_seat_id uuid, p_expected_start timestamptz, p_new_start_at timestamptz, p_new_end_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  _seat public.internal_bookings%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.internal_bookings
  WHERE id = p_seat_id AND booking_kind = 'class_seat' AND status = 'scheduled' AND start_at = p_expected_start
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('moved', false); END IF;
  _seat := public.reschedule_class_booking(p_seat_id, p_new_start_at, p_new_end_at);
  RETURN jsonb_build_object('moved', true, 'start_at', _seat.start_at);
END;
$$;
REVOKE ALL ON FUNCTION public._portal_session_move_class_seat(uuid, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._portal_session_move_class_seat(uuid, timestamptz, timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION public.client_portal_sessions(uuid, text, timestamptz, integer) IS
  'Customer-safe projection of the caller''s own bookings with their business (window upcoming|past, start-time cursor p_before = next_before). Allowlisted keys only: never host identity, guest PII, intake answers, notes or provider ids. change.* applies calendars.min_notice_min before the booking''s current start.';
COMMENT ON FUNCTION public.client_portal_session_change_admit(uuid, text, uuid, timestamptz, uuid) IS
  'Admission gate for a customer cancel/reschedule, called by booking-manage under the caller''s JWT before it writes: own booking only (else SESSION_NOT_FOUND), scheduled, on a calendar, inside min_notice_min before the current start. Replays a committed request id. Never writes internal_bookings.';
COMMENT ON FUNCTION public._portal_session_location_label(text, text, boolean, boolean) IS
  'Customer-facing location wording for a session, mirroring public-booking locationLabel() while it is ahead; the place only once it is settled. Internal helper; not callable by clients.';
COMMENT ON FUNCTION public._portal_session_move_class_seat(uuid, timestamptz, timestamptz, timestamptz) IS
  'booking-manage customer mode only: moves a class seat through reschedule_class_booking only while it is still scheduled at the start the caller loaded (moved=false otherwise), so a concurrent duplicate change is a replay, not a second move.';
COMMIT;
