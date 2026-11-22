-- Original EXP08 disposable A2b schema ONLY, after all historical assertions and mutants.
-- Synthetic Content tables extend the existing EXP07 minimal receipt fixture; no customer rows/provider.
-- Three original production Social function bodies and original private-read scope are copied verbatim,
-- then the actual forward carrier pins their prosrc/owner/ACL/search_path before replacing anything.
RESET ROLE;
SELECT set_config('request.jwt.claims','',false);
SELECT set_config('request.jwt.claim.sub','',false);
SET search_path=public;
CREATE TABLE public.content_publications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    created_by uuid,
    content_id uuid,
    platform text,
    connection_id uuid,
    confirmation_id uuid,
    status text DEFAULT 'registered'::text NOT NULL,
    provider_post_id text,
    provider_post_url text,
    provider_request_id text,
    error_code text,
    request_args jsonb DEFAULT '{}'::jsonb NOT NULL,
    provider_response jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_publications_platform_check CHECK (((platform IS NULL) OR (platform = ANY (ARRAY['tiktok'::text, 'instagram'::text, 'facebook'::text, 'linkedin'::text, 'youtube'::text, 'x'::text, 'threads'::text, 'pinterest'::text, 'google_business'::text, 'snapchat'::text, 'discord'::text, 'telegram'::text])))),
    CONSTRAINT content_publications_status_check CHECK ((status = ANY (ARRAY['registered'::text, 'approved'::text, 'publishing'::text, 'published'::text, 'partial'::text, 'failed'::text, 'outcome_unknown'::text, 'refused'::text])))
);

CREATE TABLE public.marketing_content (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL
);

ALTER TABLE ONLY public.content_publications
    ADD CONSTRAINT content_publications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.marketing_content
    ADD CONSTRAINT marketing_content_pkey PRIMARY KEY (id);

CREATE INDEX idx_content_publications_content ON public.content_publications USING btree (content_id, platform) WHERE (content_id IS NOT NULL);

CREATE INDEX idx_content_publications_tenant ON public.content_publications USING btree (tenant_id, created_at DESC);

ALTER TABLE ONLY public.content_publications
    ADD CONSTRAINT content_publications_content_id_fkey FOREIGN KEY (content_id) REFERENCES public.marketing_content(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.content_publications
    ADD CONSTRAINT content_publications_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.content_publications
    ADD CONSTRAINT content_publications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.marketing_content
    ADD CONSTRAINT marketing_content_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE public.content_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_content ADD COLUMN status text NOT NULL DEFAULT 'draft', ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
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
    WHEN _can_read_destination IS TRUE OR NOT (e.request_args ? 'account_id') THEN e
    ELSE jsonb_populate_record(e, jsonb_build_object(
      'connection_id', NULL,
      'provider_post_id', NULL,
      'provider_post_url', NULL,
      'provider_request_id', NULL,
      'provider_response', '{}'::jsonb,
      'request_args', e.request_args - ARRAY['account_id', 'connection_id', 'channel_id', 'channel_label']
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
END $function$
;
REVOKE ALL ON FUNCTION public.content_publication_bind(uuid,uuid,uuid,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.content_publication_bind(uuid,uuid,uuid,text,uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.content_publication_list(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.content_publication_list(uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.content_publication_record(uuid,uuid,text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.content_publication_record(uuid,uuid,text,text,text,text,text,jsonb) TO service_role;
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
    WHEN 'nexus' THEN item#>>'{}'='growth_list' ELSE false END)
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
END $function$
;
