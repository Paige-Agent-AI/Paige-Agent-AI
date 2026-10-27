-- EXP08 Team Hub agents, A1b part 3: what a conversation can tell about an agent turn, and two fixes
-- the turn needs at its own doors. Contract: docs/delivery/exp08-team-hub-agents-contract.md (flows 3,
-- 5 and 9; "A1b part 3 notes"). Owner rulings 2026-10-26 and 2026-10-27 (docs/brain/decision-log.md,
-- "EXP08 Team Hub agents"); owner ruling 2026-10-27: EXP08 owns Team Hub end to end.
--
-- WHAT THIS ADDS, all in EXP08's own tables, and nothing in it runs a model or posts by itself:
--   team_hub_agent_turns.suggestions: the agents a reply turn's agent suggested bringing in, each with
--     one line of context (flow 3). Written only by the turn's own edge invocation, before its post.
--   team_hub_stage_agent_suggestions (service role only): writes those suggestions onto an accepted,
--     unconsumed reply turn, with the turn's own token hash. Validated in the body: one to three of
--     the seven, distinct, never the replying agent and never one the question already asks; each
--     context one line of 1 to 200 characters.
--   team_hub_agent_turn_states (authenticated only): the member-safe read of turn state (flow 5's
--     other-viewer lines, flow 9 after a reload). For the asking messages the caller can see, in a
--     conversation the caller can see now, it returns only (message_id, agent_key, state, private_part,
--     asker_name, bring_in). state is answering | replied | replied_privately | failed | none. It never
--     returns message text, a DM's id, a turn id or token, or anything from a conversation the caller
--     cannot see. The person who asked sees every state of their own questions; everyone else sees
--     only the two approved private-part lines ("<AGENT> is answering <Name> privately." /
--     "<AGENT> replied to <Name> privately."), and Bring in's agent names without their context.
--   Re-emitted from 20271117010008, changed only where marked "A1b:": team_hub_accept_agent_turn.
--     The same token again (the same edge invocation retrying an acceptance whose answer was lost)
--     returns that turn, counted once, instead of in_flight; a re-arm clears the old suggestions.
--
-- Doors re-check the caller in their bodies (§59); the table stays RLS-on with no policy and no
-- browser grant. Expected refusals return {"ok":false,"code":...}; nothing raises.
-- Forward-only and replay-safe: a second apply changes nothing.
-- Rollback: drop team_hub_agent_turn_states and team_hub_stage_agent_suggestions; re-emit
-- team_hub_accept_agent_turn from 20271117010008; drop the suggestions column and its CHECK.
BEGIN;
SET LOCAL lock_timeout = '2s';

-- ── A. Suggestions on the accepted turn ──────────────────────────────────────────────────────────
ALTER TABLE public.team_hub_agent_turns ADD COLUMN IF NOT EXISTS suggestions jsonb;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_agent_turns'::regclass
   AND conname='team_hub_agent_turns_suggestions_chk') THEN
  ALTER TABLE public.team_hub_agent_turns ADD CONSTRAINT team_hub_agent_turns_suggestions_chk CHECK (suggestions IS NULL
   OR (jsonb_typeof(suggestions)='array' AND jsonb_array_length(suggestions) BETWEEN 1 AND 3));
 END IF;
END $$;

-- ── B. Acceptance (20271117010008, plus A1b, marked) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.team_hub_accept_agent_turn(p_tenant uuid, p_asker uuid, p_channel_id uuid,
 p_source_message_id uuid, p_agent_key text, p_intent text, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ch public.team_hub_channels; src public.team_hub_messages; turn public.team_hub_agent_turns; used bigint;
 existing boolean;
BEGIN
 IF auth.uid() IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF p_tenant IS NULL OR p_asker IS NULL OR p_channel_id IS NULL OR p_source_message_id IS NULL
   OR p_agent_key IS NULL OR p_agent_key NOT IN ('paige','vera','nexus','cura','mentor','merit','zion')
   OR p_intent IS NULL OR p_intent NOT IN ('reply','dm')
   OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- The same door rules as _team_hub_refusal, for the asker rather than auth.uid(): a canonical SOLO
 -- workspace, and an active seat there with Team conversations on.
 IF NOT public._team_hub_is_active(p_tenant,p_asker) THEN RETURN jsonb_build_object('ok',false,'code','not_member'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_tenant AND t.account_type='standalone' AND t.parent_tenant_id IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','unavailable'); END IF;
 IF NOT public._team_hub_participates(p_tenant,p_asker) THEN RETURN jsonb_build_object('ok',false,'code','conversations_off'); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_tenant,p_asker,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 SELECT * INTO src FROM public.team_hub_messages m WHERE m.id=p_source_message_id AND m.tenant_id=p_tenant
  AND m.author_user_id=p_asker AND m.author_kind='user' AND m.deleted_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF p_intent='reply' THEN
  IF ch.kind='agent_dm' OR src.channel_id<>ch.id OR NOT EXISTS(SELECT 1 FROM public.team_hub_message_agent_mentions x
    WHERE x.message_id=src.id AND x.agent_key=p_agent_key) THEN
   RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 ELSE
  IF ch.kind<>'agent_dm' OR ch.agent_key<>p_agent_key OR ch.created_by<>p_asker THEN
   RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  IF src.channel_id<>ch.id AND (NOT EXISTS(SELECT 1 FROM public._team_hub_visible(p_tenant,p_asker,src.channel_id))
    OR NOT EXISTS(SELECT 1 FROM public.team_hub_message_agent_mentions x WHERE x.message_id=src.id AND x.agent_key=p_agent_key)) THEN
   RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 END IF;
 -- One person's turns are counted one at a time, so two concurrent acceptances cannot both take the 30th.
 PERFORM pg_advisory_xact_lock(hashtextextended('team_hub_agent_turn:'||p_tenant::text||':'||p_asker::text,0));
 SELECT * INTO turn FROM public.team_hub_agent_turns t WHERE t.asker_user_id=p_asker AND t.source_message_id=src.id
  AND t.agent_key=p_agent_key AND t.intent=p_intent FOR UPDATE;
 existing:=FOUND;
 IF existing THEN
  IF turn.posted_message_id IS NOT NULL THEN
   RETURN jsonb_build_object('ok',false,'code','duplicate','message_id',turn.posted_message_id); END IF;
  -- A1b: the same token again is the same edge invocation retrying an acceptance whose answer it lost
  -- (a transport error). It gets its own turn back, counted once; any other token still waits.
  IF turn.consumed_at IS NULL AND turn.token_hash=p_token_hash AND turn.channel_id=ch.id THEN
   RETURN jsonb_build_object('ok',true,'turn_id',turn.id,'repeated',true); END IF;
  -- Still running. A turn left unended for 10 minutes is taken as ended: no edge invocation outlives
  -- that (the platform's wall-clock limit is far shorter), so an invocation that died without calling
  -- team_hub_end_agent_turn can never hold the turn "running" for ever. Its old token stops working
  -- the moment the turn is re-armed below.
  IF turn.consumed_at IS NULL AND turn.accepted_at>now()-interval '10 minutes' THEN
   RETURN jsonb_build_object('ok',false,'code','in_flight'); END IF;
  IF turn.channel_id<>ch.id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 END IF;
 -- The cap: every model turn this person started here in the last hour, re-arms included. Only rows
 -- accepted inside the window can hold an attempt inside it (team_hub_agent_turns_attempts_chk).
 SELECT coalesce(sum((SELECT count(*) FROM unnest(t.attempts) a(at) WHERE a.at>now()-interval '1 hour')),0) INTO used
  FROM public.team_hub_agent_turns t
  WHERE t.tenant_id=p_tenant AND t.asker_user_id=p_asker AND t.accepted_at>now()-interval '1 hour';
 IF used>=30 THEN RETURN jsonb_build_object('ok',false,'code','rate_limited'); END IF;
 IF existing THEN
  -- Ended without posting (or abandoned): re-arm the same turn with the new token, and count this
  -- start. Attempts older than the window are dropped, so the list stays bounded.
  -- A1b: a re-armed turn starts with no suggestions (suggestions=NULL).
  UPDATE public.team_hub_agent_turns t SET token_hash=p_token_hash, accepted_at=now(), consumed_at=NULL, suggestions=NULL,
   attempts=ARRAY(SELECT a.at FROM unnest(t.attempts) a(at) WHERE a.at>now()-interval '1 hour' ORDER BY a.at)||now()
   WHERE t.id=turn.id;
  RETURN jsonb_build_object('ok',true,'turn_id',turn.id,'rearmed',true);
 END IF;
 INSERT INTO public.team_hub_agent_turns(tenant_id,channel_id,asker_user_id,source_message_id,agent_key,intent,token_hash,
  accepted_at,attempts)
  VALUES (p_tenant,ch.id,p_asker,src.id,p_agent_key,p_intent,p_token_hash,now(),ARRAY[now()]) RETURNING * INTO turn;
 RETURN jsonb_build_object('ok',true,'turn_id',turn.id);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) TO service_role;

-- ── C. Staging Bring in (service role, the turn's own token) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.team_hub_stage_agent_suggestions(p_turn_id uuid, p_token_hash text, p_suggestions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE turn public.team_hub_agent_turns;
BEGIN
 IF auth.uid() IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF p_turn_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
   OR p_suggestions IS NULL OR jsonb_typeof(p_suggestions)<>'array' OR jsonb_array_length(p_suggestions) NOT BETWEEN 1 AND 3 THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT * INTO turn FROM public.team_hub_agent_turns t
  WHERE t.id=p_turn_id AND t.token_hash=p_token_hash AND t.consumed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 -- Only a reply in the conversation it was asked in suggests anyone: a DM has nobody to bring in.
 IF turn.intent<>'reply' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_suggestions) e WHERE jsonb_typeof(e)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(e))<>2 OR jsonb_typeof(e->'agent') IS DISTINCT FROM 'string'
    OR jsonb_typeof(e->'context') IS DISTINCT FROM 'string'
    OR e->>'agent' NOT IN ('paige','vera','nexus','cura','mentor','merit','zion') OR e->>'agent'=turn.agent_key
    OR EXISTS(SELECT 1 FROM public.team_hub_message_agent_mentions x WHERE x.message_id=turn.source_message_id AND x.agent_key=e->>'agent')
    OR char_length(btrim(e->>'context')) NOT BETWEEN 1 AND 200 OR e->>'context' ~ '[\r\n]')
   OR (SELECT count(DISTINCT e->>'agent') FROM jsonb_array_elements(p_suggestions) e)<>jsonb_array_length(p_suggestions) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 UPDATE public.team_hub_agent_turns t SET suggestions=(SELECT jsonb_agg(jsonb_build_object('agent',x.e->>'agent','context',btrim(x.e->>'context')) ORDER BY x.n)
   FROM jsonb_array_elements(p_suggestions) WITH ORDINALITY x(e,n))
  WHERE t.id=turn.id;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_stage_agent_suggestions(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_stage_agent_suggestions(uuid,text,jsonb) TO service_role;

-- ── D. The member-safe turn-state read ───────────────────────────────────────────────────────────
-- A turn left running for 10 minutes is taken as ended, as the acceptance door takes it.
CREATE OR REPLACE FUNCTION public.team_hub_agent_turn_states(p_expected_tenant uuid, p_channel_id uuid, p_message_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels; states jsonb;
 private_line constant text:='That part is just for you, so I''m answering it in our DM.';
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF p_message_ids IS NULL OR cardinality(p_message_ids)>100 OR array_position(p_message_ids,NULL) IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- Another person's question shows them only an approved private-part line; any other state of it is
 -- shown as 'replied' (a bring_in row exists only once the reply has posted, so that is true).
 SELECT coalesce(jsonb_agg(jsonb_build_object('message_id',s.id,'agent_key',s.agent_key,
    'state',CASE WHEN s.author_user_id=actor OR (s.private_part AND s.state IN ('answering','replied_privately')) THEN s.state ELSE 'replied' END,
    'private_part',s.private_part,'asker_name',s.asker_name)
   || CASE WHEN s.bring_in IS NULL THEN '{}'::jsonb
    -- The asker gets each suggestion's line of context; everyone else only who was suggested.
    WHEN s.author_user_id=actor THEN jsonb_build_object('bring_in',s.bring_in)
    ELSE jsonb_build_object('bring_in',(SELECT jsonb_agg(jsonb_build_object('agent',e->>'agent')) FROM jsonb_array_elements(s.bring_in) e)) END
   ORDER BY s.id, s.agent_key),'[]'::jsonb) INTO states
 FROM (
  SELECT a.id, a.author_user_id, a.agent_key, p.private_part,
   CASE WHEN public._team_hub_is_active(p_expected_tenant,a.author_user_id)
    THEN coalesce(nullif(btrim(pr.full_name),''),'Teammate') ELSE 'Former teammate' END AS asker_name,
   CASE WHEN p.private_part THEN
     CASE WHEN pt.posted_message_id IS NOT NULL THEN 'replied_privately'
      WHEN pt.id IS NOT NULL AND pt.consumed_at IS NULL AND pt.accepted_at>now()-interval '10 minutes' THEN 'answering'
      WHEN pt.id IS NOT NULL THEN 'failed' ELSE 'none' END
    ELSE
     CASE WHEN rm.id IS NOT NULL OR rt.posted_message_id IS NOT NULL THEN 'replied'
      WHEN rt.id IS NOT NULL AND rt.consumed_at IS NULL AND rt.accepted_at>now()-interval '10 minutes' THEN 'answering'
      WHEN rt.id IS NOT NULL THEN 'failed' ELSE 'none' END
   END AS state,
   CASE WHEN rm.id IS NOT NULL AND ch.kind<>'agent_dm' THEN rt.suggestions END AS bring_in
  -- The questions: a person's own messages in this conversation that ask an agent (its stored
  -- mentions; in an agent DM, the DM's own agent).
  FROM (SELECT m.id, m.author_user_id, k.agent_key FROM public.team_hub_messages m
    CROSS JOIN LATERAL (SELECT x.agent_key FROM public.team_hub_message_agent_mentions x
      WHERE x.message_id=m.id AND ch.kind<>'agent_dm'
     UNION SELECT ch.agent_key WHERE ch.kind='agent_dm') k
    WHERE m.id=ANY(p_message_ids) AND m.channel_id=ch.id AND m.tenant_id=p_expected_tenant
     AND m.author_kind='user' AND m.deleted_at IS NULL) a
  LEFT JOIN LATERAL (SELECT r.id, r.body FROM public.team_hub_messages r WHERE r.author_kind='agent' AND r.agent_key=a.agent_key
    AND r.asked_in_message_id=a.id AND r.channel_id=ch.id AND r.deleted_at IS NULL ORDER BY r.created_at LIMIT 1) rm ON true
  LEFT JOIN public.team_hub_agent_turns rt ON rt.asker_user_id=a.author_user_id AND rt.source_message_id=a.id
   AND rt.agent_key=a.agent_key AND rt.intent=CASE WHEN ch.kind='agent_dm' THEN 'dm' ELSE 'reply' END AND rt.channel_id=ch.id
  -- The private part: the reply ends with the fixed line the post door appends, so it is already
  -- visible to everyone who can read the reply. Its DM turn is read for its state only.
  CROSS JOIN LATERAL (SELECT ch.kind<>'agent_dm' AND rm.id IS NOT NULL
    AND right(rm.body, char_length(private_line))=private_line AS private_part) p
  LEFT JOIN public.team_hub_agent_turns pt ON p.private_part AND pt.asker_user_id=a.author_user_id
   AND pt.source_message_id=a.id AND pt.agent_key=a.agent_key AND pt.intent='dm'
  LEFT JOIN public.profiles pr ON pr.user_id=a.author_user_id
 ) s
 -- Everyone else: the two approved private-part lines, and who a posted reply suggested bringing in
 -- ("Only <Name> can bring them in."). Never another person's running, failed or unstarted turn.
 WHERE s.author_user_id=actor OR (s.private_part AND s.state IN ('answering','replied_privately')) OR s.bring_in IS NOT NULL;
 RETURN jsonb_build_object('ok',true,'states',states);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_agent_turn_states(uuid,uuid,uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_agent_turn_states(uuid,uuid,uuid[]) TO authenticated;
COMMIT;
