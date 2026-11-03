-- Original production Calendar body over reduced tables in the EXISTING
-- disposable E08 proof only. No customer, full-schema or provider claim.
CREATE TABLE public.internal_bookings (
 id uuid PRIMARY KEY,tenant_id uuid,calendar_id uuid,host_user_id uuid,contact_id uuid,title text,
 start_at timestamptz,end_at timestamptz,timezone text,status text,source text,
 guest_name text,guest_email text,guest_phone text,notes text,location_type text,location_value text,
 booking_kind text,class_session_id uuid,capacity integer,collective_group_id uuid,
 appointment_type jsonb,intake_answers jsonb,updated_at timestamptz DEFAULT now());
-- Reuse the incumbent E08 fixture's original is_tenant_admin role port.
CREATE OR REPLACE FUNCTION public.list_team_bookings(_from timestamp with time zone, _to timestamp with time zone, _host_ids uuid[], _tenant_id uuid, _booking_id uuid)
 RETURNS TABLE(id uuid, tenant_id uuid, calendar_id uuid, host_user_id uuid, host_full_name text, contact_id uuid, title text, start_at timestamp with time zone, end_at timestamp with time zone, timezone text, status text, source text, guest_name text, guest_email text, guest_phone text, notes text, location_type text, location_value text, booking_kind text, class_session_id uuid, capacity integer, collective_group_id uuid, appointment_type jsonb, intake_answers jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := COALESCE(_tenant_id, public.current_user_tenant_id());
  _team boolean;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'BOOKING_FORBIDDEN: auth required' USING ERRCODE='42501'; END IF;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'BOOKING_NO_TENANT' USING ERRCODE='22023'; END IF;
  IF NOT (public.is_platform_owner() OR public.is_tenant_member(_tenant)) THEN
    RAISE EXCEPTION 'BOOKING_FORBIDDEN: not a member of this tenant' USING ERRCODE='42501';
  END IF;
  _team := public.is_platform_owner() OR public.is_tenant_admin(_tenant);

  -- Separate static statements keep exact-ID lookup selective under both
  -- custom and generic plans; no optional-OR scan of the tenant tuplestore.
  IF _booking_id IS NOT NULL THEN
  RETURN QUERY
    SELECT b.id, b.tenant_id, b.calendar_id, b.host_user_id, p.full_name,
           b.contact_id, b.title, b.start_at, b.end_at, b.timezone,
           b.status, b.source, b.guest_name, b.guest_email, b.guest_phone,
           b.notes, b.location_type, b.location_value,
           b.booking_kind, b.class_session_id, b.capacity, b.collective_group_id,
           b.appointment_type, b.intake_answers
      FROM public.internal_bookings b
      LEFT JOIN public.profiles p ON p.user_id = b.host_user_id
     WHERE b.id = _booking_id
       AND b.tenant_id = _tenant
       AND b.start_at < _to
       AND b.end_at >= _from
       AND (_team OR b.host_user_id = _caller)
       AND (_host_ids IS NULL OR b.host_user_id = ANY(_host_ids))
     ORDER BY b.start_at ASC;
  ELSE
  RETURN QUERY
    SELECT b.id, b.tenant_id, b.calendar_id, b.host_user_id, p.full_name,
           b.contact_id, b.title, b.start_at, b.end_at, b.timezone,
           b.status, b.source, b.guest_name, b.guest_email, b.guest_phone,
           b.notes, b.location_type, b.location_value,
           b.booking_kind, b.class_session_id, b.capacity, b.collective_group_id,
           b.appointment_type, b.intake_answers
      FROM public.internal_bookings b
      LEFT JOIN public.profiles p ON p.user_id = b.host_user_id
     WHERE b.tenant_id = _tenant
       AND b.start_at < _to
       AND b.end_at >= _from
       AND (_team OR b.host_user_id = _caller)
       AND (_host_ids IS NULL OR b.host_user_id = ANY(_host_ids))
     ORDER BY b.start_at ASC;
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid,uuid) TO authenticated,service_role;
SELECT pg_temp.check((SELECT md5(prosrc)='6ec4ba377abfe348192cdf17bb973869' FROM pg_proc WHERE oid='public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid,uuid)'::regprocedure),'EXP05 exact original Calendar reader source');
