-- EXP07 row 9 — channel readiness, read through the ONE governed seam the Social surface
-- already consumes. get_social_presence_evidence already answers, per network, what the workspace
-- SAID (the capture-only handle). This extends the same SECURITY DEFINER read with what the
-- connection lifecycle PROVES (paige_social_connections, service-role-only by design — this
-- function is the governed window): each network's connection state, the connected identity's
-- label, when it was last verified, and how many profiles exist. The callers' authority is
-- unchanged (the same role gate, the same server-resolved tenant, the same refusal-as-six-rows
-- contract); a connection still grants NOTHING but the truth of its own state — no reach, no
-- engagement, no publish claim is derivable, and the surfaces say so.
--
-- Multiple profiles per network are aggregated honestly: the PRIMARY status is the most-privileged
-- state present (connected > authorizing > needs_reauth > error > setup_required > disconnected),
-- the label and verified-at come from that primary row, and `connection_profiles` carries the
-- count so a surface can say "2 profiles connected" instead of hiding one.

-- The OUT column list grows (four readiness columns), and Postgres refuses to change a
-- function's return type in place — drop and recreate, then re-grant exactly as before.
DROP FUNCTION IF EXISTS public.get_social_presence_evidence(uuid);

CREATE FUNCTION public.get_social_presence_evidence(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE (
  network text,
  status text,
  handle text,
  as_of timestamptz,
  reason text,
  -- The workspace these rows describe. Returned so a caller can prove the rows belong to the
  -- conversation it is in: get_paige_persona_context() resolves a conversation's tenant
  -- client-link-first, so a user who is a linked CLIENT of workspace B and a member of workspace A
  -- holds a B-scoped conversation while this read resolves A. Without this column the binding is
  -- impossible rather than merely omitted (§9).
  tenant_id uuid,
  -- EXP07 row 9: the connection lifecycle's answer for this network. NULL columns = no connection
  -- row exists (the capture-only handle remains the whole truth). connection_status is the
  -- lifecycle's own vocabulary (setup_required/authorizing/connected/needs_reauth/disconnected/
  -- error), never translated here — the projection layer owns the owner's words.
  connection_status text,
  connection_label text,
  connection_verified_at timestamptz,
  connection_profiles int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_handles jsonb;
  v_updated timestamptz;
  v_networks constant text[] := ARRAY['instagram','facebook','linkedin','youtube','tiktok','x'];
  v_row record;
BEGIN
  -- A JWT-authenticated caller's tenant is ALWAYS server-resolved, never client-supplied
  -- (§9/§588). _tenant_id is honored only on the service-role path, where no JWT identity exists.
  IF v_uid IS NOT NULL THEN
    v_tenant := public.current_user_tenant_id();
  ELSE
    v_tenant := _tenant_id;
  END IF;

  IF v_tenant IS NULL THEN
    RETURN QUERY
    SELECT n, 'unavailable'::text, NULL::text, NULL::timestamptz,
           'workspace not resolved'::text, NULL::uuid,
           NULL::text, NULL::text, NULL::timestamptz, NULL::int
      FROM unnest(v_networks) AS n;
    RETURN;
  END IF;

  -- ROLE GATE (§59 — the EXECUTE grant is never the guard). Unchanged from the previous body:
  -- this capability declares audience owner_internal, so a workspace's own CLIENTS (authenticated
  -- users of the same tenant) must not learn the coach's internal record of which accounts are
  -- set up or connected. Guarded on v_uid so the trusted service-role callers (PAIGE's agent,
  -- Systems Check) pass with their caller-resolved tenant.
  --
  -- Refused, not empty: the contract promises six rows on every call, so a refusal is six
  -- 'unavailable' rows with a reason — which also leaks nothing about whether any account exists.
  IF v_uid IS NOT NULL
     AND NOT (public.is_tenant_admin(v_tenant) OR public.is_platform_owner())
  THEN
    RETURN QUERY
    SELECT n, 'unavailable'::text, NULL::text, NULL::timestamptz,
           'not permitted for this account'::text, v_tenant,
           NULL::text, NULL::text, NULL::timestamptz, NULL::int
      FROM unnest(v_networks) AS n;
    RETURN;
  END IF;

  SELECT coalesce(t.features -> 'social_handles', '{}'::jsonb), t.updated_at
    INTO v_handles, v_updated
    FROM public.tenants t
   WHERE t.id = v_tenant;

  IF v_handles IS NULL THEN
    RETURN QUERY
    SELECT n, 'unavailable'::text, NULL::text, NULL::timestamptz,
           'workspace record not readable'::text, v_tenant,
           NULL::text, NULL::text, NULL::timestamptz, NULL::int
      FROM unnest(v_networks) AS n;
    RETURN;
  END IF;

  FOR v_row IN
    SELECT
      n,
      CASE WHEN nullif(btrim(coalesce(v_handles ->> n, '')), '') IS NOT NULL
           THEN 'on_record' ELSE 'not_recorded' END::text AS status,
      nullif(btrim(coalesce(v_handles ->> n, '')), '') AS handle,
      -- The workspace row's own last-changed time. It is NOT a per-handle timestamp and must never
      -- be reported as one: nothing records when an individual handle was set, so the honest claim is
      -- "this workspace record last changed then", which is what the Chat renderer says.
      v_updated AS as_of,
      v_tenant AS tenant_id,
      c.primary_status,
      c.primary_label,
      c.primary_verified_at,
      c.profiles
    FROM unnest(v_networks) AS n
    LEFT JOIN (
      -- The lifecycle's answer, aggregated per network. The primary status is the most-privileged
      -- state present; its row supplies label and verified-at. Tenant-scoped to the RESOLVED
      -- workspace — a cross-tenant connection never reaches another workspace's readiness.
      SELECT
        provider_key,
        count(*)::int AS profiles,
        (array_agg(status ORDER BY CASE status
          WHEN 'connected' THEN 1
          WHEN 'authorizing' THEN 2
          WHEN 'needs_reauth' THEN 3
          WHEN 'error' THEN 4
          WHEN 'setup_required' THEN 5
          WHEN 'disconnected' THEN 6
          ELSE 7 END, updated_at DESC))[1] AS primary_status,
        (array_agg(label ORDER BY CASE status
          WHEN 'connected' THEN 1
          WHEN 'authorizing' THEN 2
          WHEN 'needs_reauth' THEN 3
          WHEN 'error' THEN 4
          WHEN 'setup_required' THEN 5
          WHEN 'disconnected' THEN 6
          ELSE 7 END, updated_at DESC))[1] AS primary_label,
        (array_agg(last_verified_at ORDER BY CASE status
          WHEN 'connected' THEN 1
          WHEN 'authorizing' THEN 2
          WHEN 'needs_reauth' THEN 3
          WHEN 'error' THEN 4
          WHEN 'setup_required' THEN 5
          WHEN 'disconnected' THEN 6
          ELSE 7 END, updated_at DESC))[1] AS primary_verified_at
      FROM public.paige_social_connections
      WHERE tenant_id = v_tenant
      GROUP BY provider_key
    ) c ON c.provider_key = n
  LOOP
    RETURN QUERY
    SELECT v_row.n, v_row.status, v_row.handle, v_row.as_of, NULL::text, v_row.tenant_id,
           v_row.primary_status, v_row.primary_label, v_row.primary_verified_at,
           v_row.profiles;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_social_presence_evidence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_social_presence_evidence(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_social_presence_evidence(uuid) IS
  'Per-network social presence evidence for the resolved workspace: the capture-only handle the workspace recorded, plus (EXP07 row 9) the connection lifecycle''s readiness answer — primary status by privilege order, its label and verified-at, and the profile count. Owner/admin-gated like the handles read; a connection grants no audience or performance figure.';
