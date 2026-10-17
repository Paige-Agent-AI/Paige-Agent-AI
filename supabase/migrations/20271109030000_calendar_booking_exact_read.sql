-- Extend the canonical Calendar reader without changing existing four-argument callers.
-- The required five-argument overload owns the original authority/projection once;
-- the existing OID/defaults/owner/ACL signature delegates with an unrestricted ID.
-- No booking writer, provider, role, tenant, or historical record is changed.
BEGIN;

CREATE OR REPLACE FUNCTION public.list_team_bookings(
  _from timestamptz,
  _to timestamptz,
  _host_ids uuid[],
  _tenant_id uuid,
  _booking_id uuid
)
RETURNS TABLE (
  id uuid, tenant_id uuid, calendar_id uuid, host_user_id uuid, host_full_name text,
  contact_id uuid, title text, start_at timestamptz, end_at timestamptz, timezone text,
  status text, source text, guest_name text, guest_email text, guest_phone text,
  notes text, location_type text, location_value text,
  booking_kind text, class_session_id uuid, capacity integer, collective_group_id uuid,
  appointment_type jsonb, intake_answers jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
END $$;
ALTER FUNCTION public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_team_bookings(
  _from timestamptz,
  _to timestamptz,
  _host_ids uuid[] DEFAULT NULL,
  _tenant_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, tenant_id uuid, calendar_id uuid, host_user_id uuid, host_full_name text,
  contact_id uuid, title text, start_at timestamptz, end_at timestamptz, timezone text,
  status text, source text, guest_name text, guest_email text, guest_phone text,
  notes text, location_type text, location_value text,
  booking_kind text, class_session_id uuid, capacity integer, collective_group_id uuid,
  appointment_type jsonb, intake_answers jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY SELECT * FROM public.list_team_bookings(_from, _to, _host_ids, _tenant_id, NULL::uuid);
END $$;
-- CREATE OR REPLACE retains the incumbent four-argument OID, owner and grants.
REVOKE ALL ON FUNCTION public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
