-- The client's network ladder widened (owner 2026-11-06: Discord and Telegram become
-- publishable); these two SECURITY DEFINER seams must move WITH it or the path breaks
-- twice: record_social_handles would refuse the new keys (and it fails the WHOLE
-- complete-set save), and get_social_presence_evidence would aggregate connected
-- rows then drop them at the unnest join — the publish picker could never show the
-- channels as connected (reviewer blockers A and B, caught before push). Each
-- function is re-declared from its own DDL with ONLY the array literal changed;
-- revoke/grant tails verbatim; the presence function's drop-if-exists first, exactly
-- as its own migration did for the return-type change. Plain statements throughout.

DROP FUNCTION IF EXISTS public.get_social_presence_evidence(uuid);

CREATE OR REPLACE FUNCTION public.record_social_handles(
  _expected_tenant_id uuid,
  _handles            jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor  uuid := auth.uid();
  _tenant uuid;
  _row    public.tenants;
  _clean  jsonb := '{}'::jsonb;
  _key    text;
  _value  text;
  -- The union of the two places the platform already names networks in tenant-visible text: the
  -- Systems Check registry question (20260816000000_systems_check_layer1.sql:255 — instagram,
  -- facebook, linkedin, tiktok, x) and the channels the Social surface draws (which adds youtube).
  -- src/solo/social-truth.ts carries the same list; widening one without the other lets a handle
  -- be typed in the form and refused here.
  _allowed constant text[] := ARRAY['instagram','facebook','linkedin','youtube','tiktok','x','discord','telegram'];
BEGIN
  -- TWO CALLER CLASSES, and the split is the §59 rule rather than a convenience.
  --
  -- A JWT caller's tenant is ALWAYS server-resolved and the passed one is refusal-only. A
  -- service-role caller (PAIGE's own agent, via paige-mcp) has NO auth.uid() to resolve from, so
  -- the passed tenant is honored there and ONLY there — which is precisely the condition §59 names
  -- as the one place a supplied identity may be trusted. Every other path would be an auth bypass:
  -- if this arm ever became reachable with a live auth.uid(), a caller could name any workspace.
  IF _actor IS NOT NULL THEN
    _tenant := public.current_user_tenant_id();
    IF _tenant IS NULL THEN
      RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
    END IF;

    -- Refusal-only, never a selector. current_user_tenant_id() reads profiles.active_tenant_id,
    -- which a workspace switch writes BEFORE the browser catches up — so a form opened against one
    -- workspace must abort rather than silently save into another.
    IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
      RAISE EXCEPTION 'your active workspace changed before this could save; nothing was written'
        USING ERRCODE = '42501';
    END IF;

    -- TENANT-SCOPED, deliberately not a global app_role. `user_roles` carries no tenant_id, so
    -- has_role(caller,'admin') is tenant-agnostic and answers the wrong question in both directions
    -- (§59's global-role trap).
    IF NOT public.is_tenant_admin(_tenant) THEN
      RAISE EXCEPTION 'only an owner or admin may record this business''s social accounts'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    _tenant := _expected_tenant_id;
    IF _tenant IS NULL THEN
      RAISE EXCEPTION 'a trusted caller must name the workspace it is writing for'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF _handles IS NULL OR jsonb_typeof(_handles) <> 'object' THEN
    RAISE EXCEPTION 'social accounts must be sent as an object of network to handle';
  END IF;

  -- A FLAT OBJECT OF STRINGS, and the shape is load-bearing rather than stylistic.
  -- social_handles_captured.ts:21-23 counts an object's values with hasText(), which is true only
  -- of a non-empty STRING. The natural rich shape {instagram:{handle,url}} counts as ZERO there, so
  -- storing it would make the surface show accounts on record while the Systems Check reported none
  -- — on the exact check this seam exists to make passable. Richer per-network metadata, if it is
  -- ever wanted, belongs in a SIBLING key, never nested inside this one.
  FOR _key, _value IN SELECT key, value FROM jsonb_each_text(_handles) LOOP
    IF NOT (_key = ANY (_allowed)) THEN
      RAISE EXCEPTION 'that is not a network this workspace records: %', _key;
    END IF;
    IF jsonb_typeof(_handles -> _key) <> 'string' THEN
      RAISE EXCEPTION 'the handle for % must be text', _key;
    END IF;
    _value := nullif(btrim(_value), '');
    IF _value IS NOT NULL THEN
      IF length(_value) > 120 THEN
        RAISE EXCEPTION 'the handle for % is too long', _key;
      END IF;
      _clean := _clean || jsonb_build_object(_key, _value);
    END IF;
    -- A cleared field is an OMISSION, not a stored blank: hasText() ignores '' anyway, so a stored
    -- empty string would be a key the check cannot count and a person can still see. The surface
    -- and the check must never disagree about how many accounts are on record.
  END LOOP;

  -- ONE KEY, merged server-side. `features` also carries playbook_config, playbook, portal_config,
  -- enabled_skills, __feature_flag_owners (the Blueprint install-ownership registry, read by
  -- uninstall to decide what it may tear down) and system_workspace (which gates the managed email
  -- sender and suppresses the onboarding Systems Check). A tenant admin CAN update tenants.features
  -- directly under the live RLS policy — which is exactly why the write must not be a client-side
  -- read-modify-write of the whole object: it would clobber, forge or erase any of those keys.
  UPDATE public.tenants
     SET features = coalesce(features, '{}'::jsonb) || jsonb_build_object('social_handles', _clean)
   WHERE id = _tenant
   RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'this workspace could not be read, so nothing was written';
  END IF;

  -- Reports what was ACTUALLY written, read back off the updated row (§13). The caller renders this
  -- rather than echoing what it sent, so a value the database normalised or dropped can never be
  -- shown back as though it had been stored.
  RETURN jsonb_build_object(
    'tenant_id', _row.id,
    'social_handles', coalesce(_row.features -> 'social_handles', '{}'::jsonb),
    'recorded_count', (SELECT count(*) FROM jsonb_object_keys(coalesce(_row.features -> 'social_handles', '{}'::jsonb)))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_social_handles(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_social_handles(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_social_handles(uuid, jsonb) TO authenticated;

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
  v_networks constant text[] := ARRAY['instagram','facebook','linkedin','youtube','tiktok','x','discord','telegram'];
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
      -- The lifecycle's answer, aggregated per network (requested_platform — the network the
      -- connection is FOR; provider_key names the transport, not the network). The primary
      -- status is the most-privileged state present; its row supplies label and verified-at.
      -- Tenant-scoped to the RESOLVED workspace, and a legacy row with no requested_platform
      -- can never be attributed to a network — it joins nothing, which is the honest absence.
      SELECT
        pc.requested_platform AS network_key,
        count(*)::int AS profiles,
        (array_agg(pc.status ORDER BY CASE pc.status
          WHEN 'connected' THEN 1
          WHEN 'authorizing' THEN 2
          WHEN 'needs_reauth' THEN 3
          WHEN 'error' THEN 4
          WHEN 'setup_required' THEN 5
          WHEN 'disconnected' THEN 6
          ELSE 7 END, pc.updated_at DESC))[1] AS primary_status,
        (array_agg(pc.label ORDER BY CASE pc.status
          WHEN 'connected' THEN 1
          WHEN 'authorizing' THEN 2
          WHEN 'needs_reauth' THEN 3
          WHEN 'error' THEN 4
          WHEN 'setup_required' THEN 5
          WHEN 'disconnected' THEN 6
          ELSE 7 END, pc.updated_at DESC))[1] AS primary_label,
        (array_agg(pc.last_verified_at ORDER BY CASE pc.status
          WHEN 'connected' THEN 1
          WHEN 'authorizing' THEN 2
          WHEN 'needs_reauth' THEN 3
          WHEN 'error' THEN 4
          WHEN 'setup_required' THEN 5
          WHEN 'disconnected' THEN 6
          ELSE 7 END, pc.updated_at DESC))[1] AS primary_verified_at
      FROM public.paige_social_connections pc
      WHERE pc.tenant_id = v_tenant AND pc.requested_platform IS NOT NULL
      GROUP BY pc.requested_platform
    ) c ON c.network_key = n
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
