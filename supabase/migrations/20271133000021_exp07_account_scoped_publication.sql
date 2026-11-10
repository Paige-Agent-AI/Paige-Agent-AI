-- EXP07. Widen the existing native presence/writer ladder and publication receipt check.
-- Use CREATE OR REPLACE to retain the deployed signatures, owners, security settings and grants.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_social_presence_evidence(_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(network text, status text, handle text, as_of timestamp with time zone, reason text, tenant_id uuid, connection_status text, connection_label text, connection_verified_at timestamp with time zone, connection_profiles integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.record_social_handles(_expected_tenant_id uuid, _handles jsonb)
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

ALTER TABLE public.content_publications
  DROP CONSTRAINT content_publications_platform_check,
  ADD CONSTRAINT content_publications_platform_check CHECK (
    platform IS NULL OR platform IN (
      'tiktok','instagram','facebook','linkedin','youtube','x','threads',
      'pinterest','google_business','snapchat','discord','telegram'
    )
  );

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
        status IN ('approved', 'publishing', 'outcome_unknown')
        OR (
          status IN ('published', 'partial')
          AND p_request_args ? 'content_revision'
          AND request_args->>'content_revision' = p_request_args->>'content_revision'
          AND request_args->>'account_id' = p_request_args->>'account_id'
          AND request_args->>'channel_id' IS NOT DISTINCT FROM p_request_args->>'channel_id'
          AND request_args->>'caption' = p_request_args->>'caption'
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
END $function$;

CREATE OR REPLACE FUNCTION public.content_publication_record(p_id uuid, p_tenant_id uuid, p_status text, p_provider_post_id text DEFAULT NULL::text, p_provider_post_url text DEFAULT NULL::text, p_provider_request_id text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_provider_response jsonb DEFAULT NULL::jsonb)
 RETURNS content_publications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _row public.content_publications;
DECLARE _caller uuid := auth.uid();
DECLARE _walk text := CASE p_status
  WHEN 'publishing' THEN 'publishing' WHEN 'published' THEN 'published' WHEN 'partial' THEN 'partial'
  WHEN 'failed' THEN 'failed' WHEN 'outcome_unknown' THEN 'outcome_unknown' WHEN 'refused' THEN 'refused'
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
          WHEN 'publishing' THEN _walk IN ('published','partial','failed','outcome_unknown','refused')
            AND p_error_code IS DISTINCT FROM 'approval_abandoned'
          -- A provider readback can resolve the same attempt to a terminal state.
          WHEN 'outcome_unknown' THEN _walk IN ('published','failed')
            AND p_provider_response->'reconciled' = 'true'::jsonb
            AND p_provider_request_id IS NOT NULL
            AND request_args ? 'account_id'
            AND (provider_request_id IS NULL OR provider_request_id = p_provider_request_id)
          ELSE false END
      RETURNING * INTO _row;
    IF _row.id IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NOT_FOUND: no such publication attempt, or that status change is not a step forward' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN _row;
END $function$;

COMMIT;
