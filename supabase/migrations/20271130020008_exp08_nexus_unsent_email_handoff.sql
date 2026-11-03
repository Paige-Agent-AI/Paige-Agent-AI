-- CLI-created 20261103022920; forward-renumbered after observed production
-- frontier20271130010103. ORIGINAL Hub accepted turn holds a private preparation
-- and references to ORIGINAL Messages/audit only. No email writer/approval store.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $baseline$
DECLARE signature text; expected text;
BEGIN
 FOR signature,expected IN SELECT * FROM (VALUES
  ('public._comms_email_actor(uuid,uuid)','ff1a928247c3d00c8641b639dacb7fb9'),
  ('public._team_hub_visible(uuid,uuid,uuid)','944ae4d661b7ea427717b35b6fc86c4d'),
  ('public._team_hub_is_active(uuid,uuid)','8a17dba7a1a8fd50bcc5c7457e6caa05'),
  ('public._team_hub_participates(uuid,uuid)','c204534d91951e1a6841003f1b9976a7'),
  ('public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid)','195f827f04a3cffe6ba18b98b3075225')
 ) AS p(signature,expected) LOOP
  IF to_regprocedure(signature) IS NULL OR md5(pg_get_functiondef(to_regprocedure(signature))) IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'EXP08 email prerequisite source changed: %',signature USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(signature) AND pg_get_userbyid(p.proowner)='postgres'
   AND p.proacl::text=CASE WHEN signature IN ('public._team_hub_visible(uuid,uuid,uuid)','public._team_hub_is_active(uuid,uuid)','public._team_hub_participates(uuid,uuid)')
    THEN '{postgres=X/postgres}' ELSE '{postgres=X/postgres,service_role=X/postgres}' END) THEN
   RAISE EXCEPTION 'EXP08 email prerequisite owner/ACL changed: %',signature USING ERRCODE='55000'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.team_hub_agent_turns'::regclass
  AND attname='email_draft' AND NOT attisdropped) THEN
  RAISE EXCEPTION 'EXP08 email column already exists; reconcile forward history' USING ERRCODE='55000'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.team_hub_agent_turns'::regclass)
  OR has_table_privilege('authenticated','public.team_hub_agent_turns','INSERT,UPDATE')
  OR has_any_column_privilege('authenticated','public.team_hub_agent_turns','INSERT,UPDATE') THEN
  RAISE EXCEPTION 'Original accepted-turn storage is not browser-write protected' USING ERRCODE='55000'; END IF;
 -- Audit events can be caller-recorded. Trusted execution comes from ORIGINAL
 -- Messages metadata, which must remain protected from direct browser writes.
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.messages'::regclass)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated' AND (rolsuper OR rolbypassrls))
  OR EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid='public.messages'::regclass AND p.polpermissive
    AND p.polcmd IN ('a','w','*') AND EXISTS(SELECT 1 FROM unnest(p.polroles) role_id
      WHERE CASE WHEN role_id=0 THEN true ELSE pg_has_role('authenticated',role_id,'MEMBER') END)) THEN
  RAISE EXCEPTION 'Original message execution metadata is not browser-write protected; reconcile before email consumer' USING ERRCODE='55000'; END IF;
END $baseline$;

ALTER TABLE public.team_hub_agent_turns ADD COLUMN email_draft jsonb;
ALTER TABLE public.team_hub_agent_turns ADD CONSTRAINT team_hub_email_draft_size
 CHECK(email_draft IS NULL OR (jsonb_typeof(email_draft)='object' AND octet_length(email_draft::text)<=65536));

CREATE FUNCTION public._team_hub_email_scope(t public.team_hub_agent_turns)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.team_hub_channels; config jsonb;
BEGIN
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
REVOKE ALL ON FUNCTION public._team_hub_email_scope(public.team_hub_agent_turns) FROM PUBLIC,anon,authenticated,service_role;

-- The original posting UPDATE fires this too: an expired/revoked scope cannot
-- publish a prepared email merely because the model completed earlier.
CREATE FUNCTION public._team_hub_email_turn_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb:=NEW.email_draft;
BEGIN
 IF TG_OP='UPDATE' AND NEW.token_hash IS DISTINCT FROM OLD.token_hash AND NEW.posted_message_id IS NULL THEN
  NEW.email_draft:=NULL; RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.posted_message_id IS NULL AND NEW.posted_message_id IS NULL AND NEW.consumed_at IS NOT NULL THEN
  -- The ORIGINAL token-bound end door must still retire an unposted turn after
  -- revocation. Cleanup publishes no private result and grants no domain effect.
  NEW.email_draft:=NULL; RETURN NEW; END IF;
 IF v IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.posted_message_id IS DISTINCT FROM OLD.posted_message_id
  AND NEW.accepted_at<clock_timestamp()-interval '5 minutes' THEN
  RAISE EXCEPTION 'Prepared email expired before publication' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN ('subject','body','contact_id','connector_id','result'))
  OR jsonb_typeof(v->'subject') IS DISTINCT FROM 'string' OR length(btrim(v->>'subject')) NOT BETWEEN 1 AND 200
  OR length(v->>'subject')>200 OR v->>'subject' ~ E'[\r\n]'
  OR jsonb_typeof(v->'body') IS DISTINCT FROM 'string' OR length(btrim(v->>'body'))<1 OR length(v->>'body')>10000 THEN
  RAISE EXCEPTION 'Invalid prepared email' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' AND OLD.email_draft IS NOT NULL AND (OLD.email_draft ? 'contact_id' OR OLD.email_draft ? 'result')
  AND (v->>'subject' IS DISTINCT FROM OLD.email_draft->>'subject' OR v->>'body' IS DISTINCT FROM OLD.email_draft->>'body'
    OR v->>'contact_id' IS DISTINCT FROM OLD.email_draft->>'contact_id'
    OR v->>'connector_id' IS DISTINCT FROM OLD.email_draft->>'connector_id') THEN
  RAISE EXCEPTION 'Prepared email selection is already bound' USING ERRCODE='40001'; END IF;
 PERFORM public._team_hub_email_scope(NEW);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_email_turn_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER team_hub_email_turn_scope BEFORE INSERT OR UPDATE ON public.team_hub_agent_turns
 FOR EACH ROW EXECUTE FUNCTION public._team_hub_email_turn_guard();

CREATE FUNCTION public.team_hub_email_draft_scope(p_turn_id uuid,p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.team_hub_agent_turns;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT * INTO t FROM public.team_hub_agent_turns WHERE id=p_turn_id AND token_hash=p_token_hash
  AND consumed_at IS NULL AND accepted_at>=clock_timestamp()-interval '5 minutes';
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 PERFORM public._team_hub_email_scope(t);
 RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','not_allowed');
END $$;
REVOKE ALL ON FUNCTION public.team_hub_email_draft_scope(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_email_draft_scope(uuid,text) TO service_role;

CREATE FUNCTION public.team_hub_stage_email_draft(p_turn_id uuid,p_token_hash text,p_subject text,p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.team_hub_agent_turns;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT * INTO t FROM public.team_hub_agent_turns WHERE id=p_turn_id AND token_hash=p_token_hash AND consumed_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 PERFORM public._team_hub_email_scope(t);
 SELECT * INTO t FROM public.team_hub_agent_turns WHERE id=p_turn_id AND token_hash=p_token_hash AND consumed_at IS NULL FOR UPDATE;
 IF NOT FOUND OR t.accepted_at<clock_timestamp()-interval '5 minutes' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 UPDATE public.team_hub_agent_turns SET email_draft=jsonb_build_object('subject',p_subject,'body',p_body) WHERE id=t.id;
 RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','not_allowed');
END $$;
REVOKE ALL ON FUNCTION public.team_hub_stage_email_draft(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_stage_email_draft(uuid,text,text,text) TO service_role;

-- Reads the caller's OWN published private preparation. A non-null contact is
-- the person's explicit exact-content handoff, permanently bound before Save.
-- No email, provider, approval or audit write is performed here.
CREATE FUNCTION public.team_hub_email_draft(p_expected_tenant uuid,p_message_id uuid,p_contact_id uuid DEFAULT NULL,p_connector_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.team_hub_agent_turns; actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL OR p_expected_tenant IS DISTINCT FROM public.current_user_tenant_id() THEN
  RETURN jsonb_build_object('ok',false,'code','scope_changed'); END IF;
 IF (p_contact_id IS NULL) IS DISTINCT FROM (p_connector_id IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT * INTO t FROM public.team_hub_agent_turns WHERE tenant_id=p_expected_tenant
  AND asker_user_id=actor AND posted_message_id=p_message_id AND consumed_at IS NOT NULL AND email_draft IS NOT NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 PERFORM public._team_hub_email_scope(t);
 IF p_contact_id IS NOT NULL THEN
  PERFORM 1 FROM public.clients WHERE id=p_contact_id AND tenant_id=t.tenant_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  -- Selection is still not send authority. The original writer repeats its
  -- mailbox/connection checks and owns all provider/readiness decisions.
  PERFORM 1 FROM public.channel_connectors WHERE id=p_connector_id AND tenant_id=t.tenant_id
   AND active AND status='active' AND channel_type='email'
   AND (mailbox_class='shared_support' OR (mailbox_class='personal' AND mailbox_owner_user_id=actor)) FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  SELECT * INTO t FROM public.team_hub_agent_turns WHERE id=t.id AND posted_message_id=p_message_id
   AND consumed_at IS NOT NULL AND email_draft IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  IF t.email_draft ? 'contact_id' AND (t.email_draft->>'contact_id' IS DISTINCT FROM p_contact_id::text
   OR t.email_draft->>'connector_id' IS DISTINCT FROM p_connector_id::text) THEN
   RETURN jsonb_build_object('ok',false,'code','selection_bound'); END IF;
  IF NOT (t.email_draft ? 'contact_id') THEN
   UPDATE public.team_hub_agent_turns SET email_draft=email_draft||jsonb_build_object('contact_id',p_contact_id,'connector_id',p_connector_id) WHERE id=t.id RETURNING * INTO t;
  END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'tenant_id',t.tenant_id,'actor_id',t.asker_user_id,'turn_id',t.id,
  'conversation_id',t.channel_id,'source_message_id',t.source_message_id,'message_id',t.posted_message_id,'draft',t.email_draft);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','not_allowed');
END $$;
REVOKE ALL ON FUNCTION public.team_hub_email_draft(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_email_draft(uuid,uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.team_hub_email_drafts(p_expected_tenant uuid,p_message_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item uuid; entry jsonb; entries jsonb:='[]'::jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_expected_tenant IS DISTINCT FROM public.current_user_tenant_id() THEN
  RETURN jsonb_build_object('ok',false,'code','scope_changed'); END IF;
 IF p_message_ids IS NULL OR cardinality(p_message_ids)>50 THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- Iterate only current caller-owned matching turns, using the original unique
 -- posted-message index. No per-missing-id lookup or existence signal is exposed.
 FOR item IN SELECT posted_message_id FROM public.team_hub_agent_turns WHERE tenant_id=p_expected_tenant
  AND asker_user_id=auth.uid() AND posted_message_id=ANY(p_message_ids) AND email_draft IS NOT NULL LOOP
  entry:=public.team_hub_email_draft(p_expected_tenant,item,NULL,NULL);
  IF entry->'ok'='true'::jsonb THEN entries:=entries||jsonb_build_array(entry); END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'drafts',entries);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_email_drafts(uuid,uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_email_drafts(uuid,uuid[]) TO authenticated;

-- A reference to the ORIGINAL writer's receipt, never a client-authored Done.
-- Also performs read-only UNKNOWN reconciliation when passed the same stable
-- original operation. Absence is unknown; this function never retries a save.
CREATE FUNCTION public.team_hub_record_email_draft(p_expected_tenant uuid,p_actor uuid,p_message_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.team_hub_agent_turns; a public.paige_audit_log; m public.messages; ref jsonb;
BEGIN
 IF p_actor IS NULL OR p_operation_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT * INTO t FROM public.team_hub_agent_turns WHERE tenant_id=p_expected_tenant AND asker_user_id=p_actor
  AND posted_message_id=p_message_id AND consumed_at IS NOT NULL AND email_draft IS NOT NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 PERFORM public._team_hub_email_scope(t);
 IF NOT (t.email_draft ? 'contact_id') OR NOT (t.email_draft ? 'connector_id') THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF t.email_draft ? 'result' THEN
  -- This immutable private reference was checked against the original committed
  -- message at first binding. Later edits do not rewrite that historical receipt.
  IF t.email_draft#>>'{result,operation_id}' IS DISTINCT FROM p_operation_id::text THEN
   RETURN jsonb_build_object('ok',false,'code','selection_bound'); END IF;
  RETURN jsonb_build_object('ok',true,'status','saved','result',t.email_draft->'result');
 END IF;
 SELECT * INTO a FROM public.paige_audit_log WHERE tenant_id=t.tenant_id AND actor_user_id=t.asker_user_id
  AND action='comms.email_draft_saved' AND target_type='message' AND payload->>'operation_id'=p_operation_id::text ORDER BY created_at,id LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'status','unknown'); END IF;
 SELECT * INTO m FROM public.messages WHERE id=a.target_id AND tenant_id=t.tenant_id
  AND contact_id::text=t.email_draft->>'contact_id' AND connector_id::text=t.email_draft->>'connector_id' AND channel_type='email' AND direction='outbound';
 IF NOT FOUND OR m.subject IS DISTINCT FROM t.email_draft->>'subject' OR m.body_text IS DISTINCT FROM t.email_draft->>'body'
  OR m.meta#>>'{comms_draft_save,id}' IS DISTINCT FROM p_operation_id::text
  OR m.meta#>>'{comms_draft_save,actor}' IS DISTINCT FROM t.asker_user_id::text
  OR m.meta#>>'{comms_draft_save,receipt_id}' IS DISTINCT FROM a.id::text
  OR m.meta#>>'{comms_draft_save,digest}' IS NULL
  OR m.meta#>>'{comms_draft_save,digest}' IS DISTINCT FROM a.payload->>'request_digest'
  OR a.payload->>'saved_version' IS NULL
  OR (a.payload->>'saved_version')::timestamptz IS DISTINCT FROM m.updated_at THEN
  RETURN jsonb_build_object('ok',true,'status','unknown'); END IF;
 -- Use the original receipt's SAVED version, not a fabricated current-version
 -- claim. Reopening always reads the current version through original mailbox RLS.
 ref:=jsonb_build_object('message_id',m.id,'updated_at',a.payload->>'saved_version','receipt_id',a.id,'operation_id',p_operation_id);
 SELECT * INTO t FROM public.team_hub_agent_turns WHERE id=t.id AND posted_message_id=p_message_id AND email_draft IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF t.email_draft ? 'result' AND t.email_draft->'result' IS DISTINCT FROM ref THEN
  RETURN jsonb_build_object('ok',false,'code','selection_bound'); END IF;
 IF NOT (t.email_draft ? 'result') THEN
  UPDATE public.team_hub_agent_turns SET email_draft=email_draft||jsonb_build_object('result',ref) WHERE id=t.id;
 END IF;
 RETURN jsonb_build_object('ok',true,'status','saved','result',ref);
EXCEPTION WHEN insufficient_privilege THEN RETURN jsonb_build_object('ok',false,'code','not_allowed');
END $$;
REVOKE ALL ON FUNCTION public.team_hub_record_email_draft(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_record_email_draft(uuid,uuid,uuid,uuid) TO service_role;

-- Add ONLY this consumer's original capabilities; retain every incoming tool,
-- identity, personality, shared scope, tenant override and configuration key.
DO $roster$
DECLARE original jsonb; updated jsonb; tools jsonb;
BEGIN
 BEGIN
  SELECT config INTO STRICT original FROM public.paige_subagents WHERE tenant_id IS NULL AND slug='nexus' FOR UPDATE;
 EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'Reconcile unique original NEXUS before email consumer' USING ERRCODE='55000';
 END;
 IF original#>>'{capability_scope,mode}' IS DISTINCT FROM 'allowlist'
  OR original#>>'{capability_scope,access}' IS DISTINCT FROM 'card'
  OR jsonb_typeof(original#>'{capability_scope,tools}') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Reconcile original NEXUS scope before email consumer' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(original#>'{capability_scope,tools}') e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string') THEN
  RAISE EXCEPTION 'Reconcile original NEXUS tool list before email consumer' USING ERRCODE='55000'; END IF;
 tools:=original#>'{capability_scope,tools}';
 IF NOT tools @> '["comms_send_email"]'::jsonb THEN tools:=tools||'["comms_send_email"]'::jsonb; END IF;
 updated:=jsonb_set(original,'{capability_scope,tools}',tools);
 IF updated IS DISTINCT FROM original THEN
  UPDATE public.paige_subagents SET config=updated,version=version+1,updated_at=statement_timestamp() WHERE tenant_id IS NULL AND slug='nexus';
 END IF;
END $roster$;
COMMIT;
