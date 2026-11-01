-- Synthetic Planning table port for the existing E08 disposable proof ONLY.
-- The caller-JWT function below is the exact catalog source read 2026-11-01;
-- its md5 is checked. This is not a replacement reader or full-schema proof.
ALTER TABLE public.plans ADD COLUMN created_by uuid,ADD COLUMN owner_user_id uuid,
 ADD COLUMN scope text DEFAULT 'individual',ADD COLUMN horizon text DEFAULT 'week',ADD COLUMN title text,
 ADD COLUMN starts_on date DEFAULT '2026-11-01',ADD COLUMN ends_on date DEFAULT '2026-11-07',
 ADD COLUMN status text DEFAULT 'active',ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.plan_items ADD COLUMN remind_at timestamptz;
-- Keep the incumbent E08 role/membership ports exactly as declared there. The
-- original caller reader and the validation projection use the SAME ports;
-- full production-helper/managed-schema proof remains a separate release gate.
CREATE OR REPLACE FUNCTION public.is_platform_owner(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path='' AS $function$ SELECT public.is_super_admin(_user_id) $function$;
CREATE OR REPLACE FUNCTION public.plan_list(p_horizon text DEFAULT NULL::text, p_plan_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_assigned_to_user_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 50, p_tenant_id uuid DEFAULT NULL::uuid, p_contact_id uuid DEFAULT NULL::uuid, p_by_item_date boolean DEFAULT false, p_include_cancelled boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _caller uuid := auth.uid(); _tenant uuid; _staff boolean := false; _plans jsonb; _loose jsonb; _lim int;
BEGIN
  -- planning_cancelled_history_v1
  IF _caller IS NOT NULL THEN
    _tenant := public.current_user_tenant_id();
    IF p_tenant_id IS NOT NULL AND p_tenant_id IS DISTINCT FROM _tenant THEN
      RAISE EXCEPTION 'PLAN_FORBIDDEN: tenant mismatch' USING ERRCODE='42501';
    END IF;
    IF NOT public.is_tenant_member(_tenant) THEN RAISE EXCEPTION 'PLAN_FORBIDDEN' USING ERRCODE='42501'; END IF;
    _staff := public.has_any_role(_caller, ARRAY['admin','super_admin']) OR public.is_platform_owner();
  ELSE _tenant := p_tenant_id; IF _tenant IS NULL THEN RAISE EXCEPTION 'PLAN_NO_TENANT' USING ERRCODE='22023'; END IF; _staff := true; END IF;
  _lim := GREATEST(1, LEAST(COALESCE(p_limit,50),200));

  SELECT jsonb_agg(row_to_json(p)::jsonb || jsonb_build_object('items', COALESCE(it.items,'[]'::jsonb)) ORDER BY p.starts_on DESC) INTO _plans
  FROM (
    SELECT * FROM public.plans
     WHERE tenant_id=_tenant
       AND (_staff OR owner_user_id=_caller OR created_by=_caller OR scope='team')
       AND (p_plan_id IS NULL OR id=p_plan_id)
       AND (p_horizon IS NULL OR horizon=p_horizon)
       AND (p_status IS NULL OR status=p_status OR (p_include_cancelled AND p_status IN ('open','in_progress','blocked','done','cancelled')))
       AND (p_by_item_date OR ((p_from IS NULL OR ends_on >= p_from) AND (p_to IS NULL OR starts_on <= p_to)))
     ORDER BY starts_on DESC LIMIT _lim
  ) p
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(row_to_json(i)::jsonb ORDER BY i.due_at NULLS LAST, i.remind_at NULLS LAST, i.created_at) AS items
      FROM public.plan_items i
     WHERE i.plan_id = p.id AND i.tenant_id=_tenant
       AND (NOT p_include_cancelled OR p_status IS NULL OR p_status NOT IN ('open','in_progress','blocked','done','cancelled') OR i.status=p_status)
       AND (_staff OR i.assigned_to_user_id=_caller OR i.created_by=_caller)
       AND (p_assigned_to_user_id IS NULL OR i.assigned_to_user_id = p_assigned_to_user_id)
       AND (p_contact_id IS NULL OR i.contact_id = p_contact_id)
       AND (NOT p_by_item_date OR (
            (p_from IS NULL OR COALESCE(i.due_at::date, i.remind_at::date) >= p_from)
        AND (p_to IS NULL OR COALESCE(i.due_at::date, i.remind_at::date) <= p_to)))
       AND (p_include_cancelled OR i.status <> 'cancelled')
  ) it ON true;

  SELECT jsonb_agg(row_to_json(i)::jsonb ORDER BY i.remind_at NULLS LAST, i.due_at NULLS LAST, i.created_at) INTO _loose
  FROM public.plan_items i
  WHERE i.tenant_id=_tenant
    AND i.plan_id IS NULL
    AND (_staff OR i.assigned_to_user_id=_caller OR i.created_by=_caller)
    AND (p_assigned_to_user_id IS NULL OR i.assigned_to_user_id = p_assigned_to_user_id)
    AND (p_contact_id IS NULL OR i.contact_id = p_contact_id)
    AND (p_status IS NULL OR i.status = p_status)
    AND (p_include_cancelled OR i.status <> 'cancelled')
    AND (p_from IS NULL OR COALESCE(i.due_at::date, i.remind_at::date) >= p_from)
    AND (p_to IS NULL OR COALESCE(i.due_at::date, i.remind_at::date) <= p_to)
  LIMIT _lim;

  RETURN jsonb_build_object('plans', COALESCE(_plans,'[]'::jsonb), 'loose_items', COALESCE(_loose,'[]'::jsonb));
END $function$
;
REVOKE ALL ON FUNCTION public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean,boolean) TO authenticated,service_role;
SELECT pg_temp.check((SELECT md5(prosrc)='702f2b52fc0d4e5c615fde7ec906b840' FROM pg_proc WHERE
 oid='public.plan_list(text,uuid,text,uuid,date,date,integer,uuid,uuid,boolean,boolean)'::regprocedure),'Planning reader is exact original native source');
