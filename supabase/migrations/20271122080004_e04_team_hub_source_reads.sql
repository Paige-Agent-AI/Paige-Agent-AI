-- EXP04: private source reads in the EXISTING Team Hub accepted-turn/post/history.
-- No new message writer, capability registry, ledger, customer-Portal authority or act admission.
-- Existing rows remain NULL and take the original path. New/current eligible SOLO accounts
-- use the same native actor and platform specialist scope. Forward-only; never rewrite old turns.
BEGIN;
-- The original platform MERIT read scope already owns agreement list/status. Complete
-- this approved commercial-standing read through the SAME registration, preserving all
-- other keys/configuration. No tenant override, actor permission, shared scope or act changes.
DO $$ DECLARE row_id uuid; config jsonb; tools jsonb; BEGIN
 SELECT s.id,s.config INTO STRICT row_id,config FROM public.paige_subagents s
  WHERE s.tenant_id IS NULL AND s.slug='merit' FOR UPDATE;
 tools:=config->'capability_scope'->'tools';
 IF config->'capability_scope'->>'mode' IS DISTINCT FROM 'allowlist'
  OR config->'capability_scope'->>'access' IS DISTINCT FROM 'read'
  OR jsonb_typeof(tools) IS DISTINCT FROM 'array'
  OR NOT (tools @> '["agreement_list","agreement_status"]'::jsonb) THEN
  RAISE EXCEPTION 'Original MERIT private read scope requires reconciliation'; END IF;
 IF NOT (tools @> '["read_client_engagement_status"]'::jsonb) THEN
  UPDATE public.paige_subagents s SET config=jsonb_set(s.config,'{capability_scope,tools}',tools||'["read_client_engagement_status"]'::jsonb)
   WHERE s.id=row_id;
 END IF;
END $$;

ALTER TABLE public.team_hub_agent_turns ADD COLUMN IF NOT EXISTS read_context jsonb;
ALTER TABLE public.team_hub_agent_turns ADD CONSTRAINT team_hub_agent_read_context_shape
 CHECK (read_context IS NULL OR (jsonb_typeof(read_context)='object' AND octet_length(read_context::text)<=8192));
CREATE INDEX IF NOT EXISTS team_hub_agent_source_message_idx ON public.team_hub_agent_turns(posted_message_id)
 WHERE read_context IS NOT NULL;

-- The original Sales guard already locks Auth user, tenant, active profile and owner/admin
-- seat, in that order. Reuse it rather than treating a roster label or service role as authority.
CREATE OR REPLACE FUNCTION public._team_hub_assert_agent_read_scope(t public.team_hub_agent_turns)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.team_hub_channels; config jsonb; tools jsonb:=t.read_context->'tools'; item jsonb;
BEGIN
 PERFORM public._sales_invoice_actor(t.asker_user_id,t.tenant_id);
 IF NOT EXISTS(SELECT 1 FROM public.tenants n WHERE n.id=t.tenant_id
   AND n.account_type='standalone' AND n.parent_tenant_id IS NULL) THEN
  RAISE EXCEPTION 'Source read workspace unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public._team_hub_visible(t.tenant_id,t.asker_user_id,t.channel_id);
 IF NOT FOUND OR c.kind<>'agent_dm' OR c.agent_key IS DISTINCT FROM t.agent_key OR t.intent<>'dm'
   OR t.agent_key NOT IN ('merit','cura','vera') THEN
  RAISE EXCEPTION 'Source read requires original private specialist DM' USING ERRCODE='42501'; END IF;
 SELECT s.config INTO config FROM public.paige_subagents s
  WHERE s.tenant_id IS NULL AND s.slug=t.agent_key FOR SHARE;
 IF NOT FOUND OR config->'capability_scope'->>'mode' IS DISTINCT FROM 'allowlist'
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
END $$;
REVOKE ALL ON FUNCTION public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns) FROM PUBLIC,anon,authenticated,service_role;

-- The same token-hash staging pattern as original Bring in suggestions. Only the existing
-- trusted turn host calls it; a browser/model cannot attach references or mint an attestation.
CREATE OR REPLACE FUNCTION public.team_hub_stage_agent_read_context(p_turn_id uuid,p_token_hash text,
 p_read_tools jsonb,p_record_links jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.team_hub_agent_turns; link jsonb; links jsonb:='[]'::jsonb; dest text; ref uuid;
BEGIN
 IF p_turn_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
   OR jsonb_typeof(p_read_tools) IS DISTINCT FROM 'array'
   OR jsonb_array_length(p_read_tools) NOT BETWEEN 1 AND 3
   OR jsonb_typeof(p_record_links) IS DISTINCT FROM 'array' OR jsonb_array_length(p_record_links)>6 THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT * INTO t FROM public.team_hub_agent_turns a WHERE a.id=p_turn_id
  AND a.token_hash=p_token_hash AND a.consumed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 FOR link IN SELECT value FROM jsonb_array_elements(p_record_links) LOOP
  IF jsonb_typeof(link) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(link) k
    WHERE k NOT IN ('destination','record_id','subject')) THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  dest:=link->>'destination'; ref:=NULL;
  IF dest IS NULL OR dest NOT IN ('contacts','sales_agreements','sales_invoices','sales_collections','operations_work','business_time_zone','executive')
    OR NOT (link ? 'record_id') OR jsonb_typeof(link->'record_id') NOT IN ('string','null') THEN
   RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  IF jsonb_typeof(link->'record_id')='string' THEN
   IF link->>'record_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
   ref:=(link->>'record_id')::uuid;
   IF NOT (CASE dest
    WHEN 'contacts' THEN EXISTS(SELECT 1 FROM public.clients r WHERE r.id=ref AND r.tenant_id=t.tenant_id)
    WHEN 'sales_agreements' THEN EXISTS(SELECT 1 FROM public.paige_agreements r WHERE r.id=ref AND r.tenant_id=t.tenant_id)
    WHEN 'sales_invoices' THEN EXISTS(SELECT 1 FROM public.paige_invoices r WHERE r.id=ref AND r.tenant_id=t.tenant_id)
    ELSE false END) THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  END IF;
  -- Labels are built by the existing UI. Store only references, never copied customer text/URLs.
  links:=links||jsonb_build_array(jsonb_build_object('destination',dest,'record_id',ref));
 END LOOP;
 t.read_context:=jsonb_build_object('token_hash',p_token_hash,'tools',p_read_tools,'record_links',links,
   'expires_at',clock_timestamp()+interval '2 minutes');
 PERFORM public._team_hub_assert_agent_read_scope(t);
 UPDATE public.team_hub_agent_turns a SET read_context=t.read_context WHERE a.id=t.id;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb) TO service_role;

-- Presentation only, read by the original authorized message serializers. No grant of record
-- access, source facts, tool arguments, token, actor or read attestation reaches the browser/model.
CREATE OR REPLACE FUNCTION public._team_hub_agent_read_annotations(p_message uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce((SELECT jsonb_build_object('source_backed_read',true,'paige_record_links',t.read_context->'record_links')
  FROM public.team_hub_agent_turns t WHERE t.posted_message_id=p_message AND t.consumed_at IS NOT NULL
   AND t.read_context->>'token_hash'=t.token_hash LIMIT 1),'{}'::jsonb)
$$;
REVOKE ALL ON FUNCTION public._team_hub_agent_read_annotations(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve current AND unmerged E08 bodies by narrowly composing with their stable original
-- anchors. Fail closed if the original source contract changed; never replace an entire old body.
DO $patch$
DECLARE body text; anchor text; changed text; post_sig regprocedure; post_a1 regprocedure; post_a2 regprocedure;
BEGIN
 post_a1:=to_regprocedure('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)');
 post_a2:=to_regprocedure('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)');
 IF (post_a1 IS NULL)=(post_a2 IS NULL) THEN RAISE EXCEPTION 'Exactly one original Team Hub post ABI is required'; END IF;
 post_sig:=coalesce(post_a1,post_a2);
 body:=pg_get_functiondef(post_sig);
 anchor:=' -- The same token and request id again: the outcome of an earlier call was unknown. Return that row.';
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Original Team Hub post requires source-read composition'; END IF;
 changed:=replace(body,anchor,$guard$  -- EXP04 original post: current native authority, bound to this exact accepted token.
  IF turn.read_context->>'token_hash'=hashed THEN
   PERFORM public._team_hub_assert_agent_read_scope(turn);
  END IF;
$guard$||anchor);
 EXECUTE changed;
 body:=pg_get_functiondef('public._team_hub_message_json(public.team_hub_messages)'::regprocedure);
 -- pg_get_functiondef uses $function$ around the unchanged SQL body.
 anchor:=E'\n$function$';
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Original Team Hub serializer requires source-read composition'; END IF;
 EXECUTE replace(body,anchor,E'\n  || public._team_hub_agent_read_annotations(p_message.id)'||anchor);
 body:=pg_get_functiondef('public.team_hub_search(uuid,text,integer)'::regprocedure);
 anchor:='''snippet'',public._team_hub_search_snippet(h.body,q))';
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Original Team Hub search requires source-read composition'; END IF;
 EXECUTE replace(body,anchor,'''source_backed_read'',coalesce((public._team_hub_agent_read_annotations(h.id)->>''source_backed_read'')::boolean,false),'||anchor);
END $patch$;

-- No existing signature, ACL, retirement disposition, history row or scheduler changed.
-- Recovery is a forward correction of these original functions; do not replay signing or money.
COMMIT;
