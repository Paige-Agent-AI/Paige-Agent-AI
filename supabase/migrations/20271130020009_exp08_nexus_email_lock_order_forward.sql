-- CLI-created 20261103044530, forward slot after immutable Preview-applied
-- 20271130020008. Change ONLY the independently reviewed private consumer's
-- contention refusal. Original Comms/publication/departure/retirement unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $repair$
DECLARE target oid; before_metadata jsonb;
BEGIN
 target:=to_regprocedure('public._team_hub_email_scope(public.team_hub_agent_turns)');
 IF target IS NULL OR md5(pg_get_functiondef(target)) IS DISTINCT FROM '7ea5a9d739309b2d255f8ff98194f276' THEN
  RAISE EXCEPTION 'EXP08 email forward predecessor changed' USING ERRCODE='55000'; END IF;
 SELECT to_jsonb(p)-'prosrc' INTO before_metadata FROM pg_proc p WHERE p.oid=target;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target AND pg_get_userbyid(p.proowner)='postgres'
   AND p.prosecdef AND NOT p.proretset AND p.provolatile='v'
   AND p.proconfig=ARRAY['search_path=""']::text[] AND p.proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'EXP08 email forward predecessor metadata changed' USING ERRCODE='55000'; END IF;
 IF md5(pg_get_functiondef('public._comms_email_actor(uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'ff1a928247c3d00c8641b639dacb7fb9' THEN
  RAISE EXCEPTION 'Original Comms actor changed before email forward' USING ERRCODE='55000'; END IF;
 EXECUTE $definition$
CREATE OR REPLACE FUNCTION public._team_hub_email_scope(t public.team_hub_agent_turns)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.team_hub_channels; config jsonb;
BEGIN
 -- Compose with ORIGINAL departure/permission ordering without changing the
 -- Comms helper: retirement exclusion → identity → membership → profile.
 -- A publication trigger may already hold its turn. Never wait on a departure's
 -- membership lock while retaining that child; refusal releases it for removal.
 BEGIN
  LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE NOWAIT;
  PERFORM 1 FROM auth.users WHERE id=t.asker_user_id FOR SHARE NOWAIT;
  PERFORM 1 FROM public.tenant_members WHERE tenant_id=t.tenant_id AND user_id=t.asker_user_id
   AND status='active' AND role IN ('owner','admin') FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Private email preparation unavailable' USING ERRCODE='42501'; END IF;
  -- A publication already holding child tables cannot wait on a withdrawing
  -- parent. Prehold the remaining ORIGINAL Comms authority rows as well.
  PERFORM 1 FROM public.tenants WHERE id=t.tenant_id FOR SHARE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE user_id=t.asker_user_id FOR SHARE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION 'Private email preparation unavailable' USING ERRCODE='42501';
 END;
 PERFORM public._comms_email_actor(t.asker_user_id,t.tenant_id);
 IF NOT coalesce(public._team_hub_participates(t.tenant_id,t.asker_user_id),false) THEN
  RAISE EXCEPTION 'Private email preparation unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=t.tenant_id AND account_type='standalone' AND parent_tenant_id IS NULL)
  OR t.agent_key IS DISTINCT FROM 'nexus' OR t.intent IS DISTINCT FROM 'dm' THEN
  RAISE EXCEPTION 'Private email preparation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public._team_hub_visible(t.tenant_id,t.asker_user_id,t.channel_id);
 IF NOT FOUND OR c.kind IS DISTINCT FROM 'agent_dm' OR c.agent_key IS DISTINCT FROM 'nexus'
  OR c.visibility IS DISTINCT FROM 'private' OR c.created_by IS DISTINCT FROM t.asker_user_id THEN
  RAISE EXCEPTION 'Private email preparation unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.team_hub_messages WHERE id=t.source_message_id AND tenant_id=t.tenant_id
   AND channel_id=t.channel_id AND author_user_id=t.asker_user_id AND author_kind='user' AND deleted_at IS NULL)
  OR (t.posted_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_hub_messages WHERE id=t.posted_message_id
   AND tenant_id=t.tenant_id AND channel_id=t.channel_id AND author_user_id=t.asker_user_id AND author_kind='agent'
   AND agent_key='nexus' AND deleted_at IS NULL)) THEN
  RAISE EXCEPTION 'Private email preparation unavailable' USING ERRCODE='42501'; END IF;
 BEGIN
  SELECT a.config INTO STRICT config FROM public.paige_subagents a WHERE a.tenant_id IS NULL AND a.slug='nexus' FOR SHARE;
 EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'Private email preparation unavailable' USING ERRCODE='42501';
 END;
 IF config#>>'{capability_scope,mode}' IS DISTINCT FROM 'allowlist'
  OR config#>>'{capability_scope,access}' IS DISTINCT FROM 'card'
  OR jsonb_typeof(config#>'{capability_scope,tools}') IS DISTINCT FROM 'array'
  OR NOT (config#>'{capability_scope,tools}') @> '["comms_send_email"]'::jsonb THEN
  RAISE EXCEPTION 'Private email preparation unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(config#>'{capability_scope,tools}') e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string') THEN
  RAISE EXCEPTION 'Private email preparation unavailable' USING ERRCODE='42501'; END IF;
END $$;
 $definition$;
 IF target IS DISTINCT FROM to_regprocedure('public._team_hub_email_scope(public.team_hub_agent_turns)')
  OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM before_metadata THEN
  RAISE EXCEPTION 'EXP08 email forward changed original metadata' USING ERRCODE='55000'; END IF;
END $repair$;
COMMIT;
