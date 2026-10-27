-- EXP08 Team Hub agents, A1c: "<AGENT> is writing…" for everyone who can see the conversation, and
-- @channel / @here. Contract: docs/delivery/exp08-team-hub-agents-contract.md ("A1c notes"). Owner
-- rulings 2026-10-27 (docs/brain/decision-log.md, "EXP08 Team Hub agents"): while an agent composes,
-- everyone who can see the conversation sees the writing bubble, like a person; @channel / @here, Slack
-- semantics, no prototype needed. EXP08 owns Team Hub end to end.
--
-- WHAT THIS CHANGES, all in EXP08's own tables, and nothing in it runs a model or posts by itself:
--   team_hub_agent_turn_states (re-emitted from 20271119010008, changed only where marked "A1c:"): for a
--     question the caller can see, in a conversation the caller can see now, a reply turn that is
--     running reads 'answering' to every caller, not only the asker. Nothing else: no text, no token, no
--     turn id; a failed, unstarted or stale turn of another person stays hidden. An agent DM is still
--     visible to its one member only, so nobody else (the owner included) reads a state there.
--   team_hub_messages.broadcast_mention: 'channel' | 'here' | NULL.
--   team_hub_message_broadcast_recipients (no browser grant): who an @channel / @here reached, as a
--     mention row records its person. @channel: every member of the channel who takes part in Team
--     conversations. @here: those of them active in the last 10 minutes. Team Hub has no presence
--     substrate, so "active" is defined from what is stored: the member read a message posted in the
--     channel in the last 10 minutes (team_hub_mark_read moves last_read_at to the read message's time,
--     so a recent last_read_at proves a recent read), or posted in it in the last 10 minutes. The author
--     is never a recipient.
--   team_hub_post_message (re-emitted from 20271117010008, changed only where marked "A1c:"): the new
--     optional p_broadcast_mention ('channel' | 'here'), refused 'invalid' outside a channel. It never
--     asks an agent. DROP and recreate (the signature grows by one defaulted argument): every existing
--     caller still resolves (the browser's named call, PAIGE's named call in _shared/team-hub/chat.ts,
--     and team_hub_request_task's positional six-argument call), the new argument defaulting to none.
--   _team_hub_message_json (re-emitted from 20271117010008, marked "A1c:"): 'broadcast' only on a row
--     that carries one, so every other message's JSON is byte-for-byte what it was.
--
-- Doors re-check the caller in their bodies (§59); the new table is RLS-on with no policy and no browser
-- grant. Expected refusals return {"ok":false,"code":...}; nothing raises.
-- Forward-only and replay-safe: a second apply changes nothing.
-- Rollback: re-emit team_hub_agent_turn_states from 20271119010008; DROP team_hub_post_message(...,text)
-- and re-emit the eight-argument body and grants from 20271117010008; re-emit _team_hub_message_json from
-- 20271117010008; drop team_hub_message_broadcast_recipients and its guard; drop the column and its
-- CHECK; remove the table from operator_retirement_disposition.
BEGIN;
SET LOCAL lock_timeout = '2s';

-- ── A. @channel / @here storage ──────────────────────────────────────────────────────────────────
ALTER TABLE public.team_hub_messages ADD COLUMN IF NOT EXISTS broadcast_mention text;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_messages'::regclass
   AND conname='team_hub_messages_broadcast_mention_chk') THEN
  ALTER TABLE public.team_hub_messages ADD CONSTRAINT team_hub_messages_broadcast_mention_chk
   CHECK (broadcast_mention IS NULL OR (broadcast_mention IN ('channel','here') AND author_kind='user'));
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.team_hub_message_broadcast_recipients (
 message_id uuid NOT NULL REFERENCES public.team_hub_messages(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL,
 channel_id uuid NOT NULL,
 user_id uuid NOT NULL,
 PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_hub_message_broadcast_recipients_user_idx
 ON public.team_hub_message_broadcast_recipients (tenant_id, user_id);
ALTER TABLE public.team_hub_message_broadcast_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_hub_message_broadcast_recipients FROM PUBLIC, anon, authenticated;

-- Storage backstop. The door writes these; a direct write that skips it still fails. A recipient row
-- belongs to a person's @channel / @here message in the same workspace and channel, never its author.
CREATE OR REPLACE FUNCTION public._team_hub_broadcast_scope_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.team_hub_messages m WHERE m.id=NEW.message_id AND m.tenant_id=NEW.tenant_id
   AND m.channel_id=NEW.channel_id AND m.author_kind='user' AND m.broadcast_mention IS NOT NULL
   AND m.author_user_id<>NEW.user_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_BROADCAST_SCOPE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_broadcast_scope_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER team_hub_broadcast_scope BEFORE INSERT OR UPDATE OF message_id, tenant_id, channel_id, user_id
 ON public.team_hub_message_broadcast_recipients FOR EACH ROW EXECUTE FUNCTION public._team_hub_broadcast_scope_guard();

-- ── B. Message JSON (20271117010008, plus A1c, marked) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._team_hub_message_json(p_message public.team_hub_messages)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_message.id,'author_user_id',p_message.author_user_id,'body',p_message.body,
  'created_at',p_message.created_at,'parent_message_id',p_message.parent_message_id,
  'reply_count',(SELECT count(*) FROM public.team_hub_messages r
   WHERE r.parent_message_id=p_message.id AND r.deleted_at IS NULL),
  'last_reply_at',(SELECT max(r.created_at) FROM public.team_hub_messages r
   WHERE r.parent_message_id=p_message.id AND r.deleted_at IS NULL),
  'mentions',coalesce((SELECT jsonb_agg(x.mentioned_user_id ORDER BY x.mentioned_user_id)
   FROM public.team_hub_message_mentions x WHERE x.message_id=p_message.id),'[]'::jsonb),
  'work_ref',(SELECT jsonb_build_object('source',w.work_source,'id',w.work_id)
   FROM public.team_hub_work_refs w WHERE w.message_id=p_message.id),
  'files',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.file_name,'mime',f.mime_type,
    'size',f.size_bytes,'path',f.storage_path) ORDER BY f.created_at, f.id)
   FROM public.team_hub_files f WHERE f.message_id=p_message.id AND f.state='ready'),'[]'::jsonb))
  -- A1: who wrote it (a person, or an agent asked by author_user_id), and which agents it asks.
  || jsonb_build_object('author_kind',p_message.author_kind,'agent_key',p_message.agent_key,
  'asked_in_message_id',p_message.asked_in_message_id,
  'agent_mentions',coalesce((SELECT jsonb_agg(x.agent_key ORDER BY x.agent_key)
   FROM public.team_hub_message_agent_mentions x WHERE x.message_id=p_message.id),'[]'::jsonb))
  -- A1c: an @channel or @here the message carries, only when it carries one (every other row is unchanged).
  || CASE WHEN p_message.broadcast_mention IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('broadcast',p_message.broadcast_mention) END
$$;
REVOKE ALL ON FUNCTION public._team_hub_message_json(public.team_hub_messages) FROM PUBLIC, anon, authenticated, service_role;

-- ── C. The post door (20271117010008, plus A1c, marked) ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[]);
CREATE OR REPLACE FUNCTION public.team_hub_post_message(p_expected_tenant uuid, p_channel_id uuid, p_body text,
 p_client_request_id uuid, p_parent_message_id uuid DEFAULT NULL, p_mention_ids uuid[] DEFAULT '{}',
 p_file_ids uuid[] DEFAULT '{}', p_agent_mention_keys text[] DEFAULT '{}', p_broadcast_mention text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
 body text:=public._team_hub_trim(p_body); mentions uuid[]; msg public.team_hub_messages; other uuid;
 files uuid[]:=coalesce(p_file_ids,'{}'::uuid[]); held int; agents text[]:=coalesce(p_agent_mention_keys,'{}'::text[]);
 broadcast text:=p_broadcast_mention; -- A1c
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF p_client_request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- A retry returns the original, with its files. The same request id in another conversation is a client error.
 -- A1: only a person's own message; a request id an agent row holds is never this person's post.
 SELECT * INTO msg FROM public.team_hub_messages m WHERE m.author_user_id=actor AND m.client_request_id=p_client_request_id;
 IF FOUND THEN
  IF msg.channel_id<>ch.id OR msg.author_kind<>'user' THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
 END IF;
 -- 0 to 5 distinct, non-null ids.
 IF cardinality(files)>5 OR array_position(files,NULL) IS NOT NULL
   OR cardinality(files)<>(SELECT count(DISTINCT x.id) FROM unnest(files) x(id)) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF body IS NULL OR (body='' AND cardinality(files)=0) THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF char_length(body)>8000 THEN RETURN jsonb_build_object('ok',false,'code','too_long'); END IF;
 IF p_parent_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_hub_messages p
   WHERE p.id=p_parent_message_id AND p.channel_id=ch.id AND p.parent_message_id IS NULL AND p.deleted_at IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- A1: 0 to 3 distinct agents from the roster, and never in an agent DM (that DM already has its
 -- agent, and another agent would read a conversation that is only the person's and its agent's).
 IF cardinality(agents)>3 OR array_position(agents,NULL) IS NOT NULL
   OR cardinality(agents)<>(SELECT count(DISTINCT x.k) FROM unnest(agents) x(k))
   OR EXISTS(SELECT 1 FROM unnest(agents) x(k) WHERE x.k NOT IN ('paige','vera','nexus','cura','mentor','merit','zion'))
   OR (cardinality(agents)>0 AND ch.kind='agent_dm') THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- A1c: @channel or @here, in a channel only (never a DM or an agent DM). It never asks an agent: only
 -- p_agent_mention_keys does, and an agent turn is accepted only for those rows.
 IF broadcast IS NOT NULL AND (broadcast NOT IN ('channel','here') OR ch.kind<>'channel') THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- Before anything is written. Locked in id order, so a concurrent post of the same file waits
 -- here and then finds it posted.
 IF cardinality(files)>0 THEN
  SELECT count(*) INTO held FROM (SELECT f.id FROM public.team_hub_files f
   WHERE f.id=ANY(files) AND f.tenant_id=p_expected_tenant AND f.channel_id=ch.id AND f.uploaded_by=actor
    AND f.state='ready' AND f.message_id IS NULL ORDER BY f.id FOR UPDATE) s;
  IF held<>cardinality(files) THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 END IF;
 -- A DM keeps reaching the other person. If their seat ended and they were re-invited, the seat
 -- trigger removed their membership; posting restores it, as reopening the DM does. A person
 -- whose seat is not active stays out. This comes before the mention check so the restored person
 -- can be mentioned; an active DM party belongs in the DM even if this post is then refused.
 IF ch.kind='dm' THEN
  other:=CASE split_part(ch.dm_key,':',1) WHEN actor::text THEN split_part(ch.dm_key,':',2)
   ELSE split_part(ch.dm_key,':',1) END::uuid;
  -- EXP08 lifecycle: the other person is still on the team but has Team conversations off, so they
  -- cannot read this. Refused with its own code rather than stored as if delivered, before anything
  -- is written (files stay unposted). A former or suspended teammate is unchanged: the post is
  -- kept for the record, as before.
  IF other IS NOT NULL AND public._team_hub_is_active(p_expected_tenant,other)
    AND NOT public._team_hub_participates(p_expected_tenant,other) THEN
   RETURN jsonb_build_object('ok',false,'code','recipient_conversations_off'); END IF;
  IF other IS NOT NULL AND public._team_hub_hold_seats(p_expected_tenant,ARRAY[other]) THEN
   INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by)
    VALUES (ch.id,p_expected_tenant,other,actor) ON CONFLICT (channel_id,user_id) DO NOTHING;
  END IF;
 END IF;
 -- A mention must be an active member who can see this conversation: anyone active for a team
 -- channel, the channel's members for a private channel or DM.
 -- EXP08 lifecycle: and who takes part in Team conversations, so nobody is told about a
 -- conversation they are refused (participates, not merely an active seat).
 IF EXISTS(SELECT 1 FROM unnest(coalesce(p_mention_ids,'{}'::uuid[])) x(id)
   WHERE x.id IS NULL OR NOT public._team_hub_participates(p_expected_tenant,x.id)
    OR (ch.visibility='private' AND NOT EXISTS(SELECT 1 FROM public.team_hub_channel_members m
     WHERE m.channel_id=ch.id AND m.user_id=x.id))) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 mentions:=ARRAY(SELECT DISTINCT x.id FROM unnest(coalesce(p_mention_ids,'{}'::uuid[])) x(id));
 IF ch.visibility='team' THEN
  IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor]) THEN RETURN jsonb_build_object('ok',false,'code','not_member'); END IF;
  INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by,last_read_at)
   VALUES (ch.id,p_expected_tenant,actor,actor,now()) ON CONFLICT (channel_id,user_id) DO NOTHING;
 END IF;
 -- A1c: broadcast_mention.
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,parent_message_id,client_request_id,broadcast_mention)
  VALUES (p_expected_tenant,ch.id,actor,body,p_parent_message_id,p_client_request_id,broadcast)
  ON CONFLICT (author_user_id,client_request_id) DO NOTHING RETURNING * INTO msg;
 IF msg.id IS NULL THEN
  -- A concurrent retry stored it first.
  -- Never a success built from a row this statement cannot see.
  SELECT * INTO msg FROM public.team_hub_messages m WHERE m.author_user_id=actor AND m.client_request_id=p_client_request_id;
  IF NOT FOUND OR msg.channel_id IS DISTINCT FROM ch.id OR msg.author_kind<>'user' THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
 END IF;
 INSERT INTO public.team_hub_message_mentions(message_id,tenant_id,channel_id,mentioned_user_id)
  SELECT msg.id,p_expected_tenant,ch.id,x.id FROM unnest(mentions) x(id);
 INSERT INTO public.team_hub_message_agent_mentions(message_id,tenant_id,channel_id,agent_key)
  SELECT msg.id,p_expected_tenant,ch.id,x.k FROM unnest(agents) x(k);
 -- A1c: who an @channel or @here reached, as a mention row reaches its person. @channel: every member of
 -- the channel who takes part in Team conversations. @here: those of them active in the last 10 minutes
 -- (they read a message posted in it in the last 10 minutes, or posted in it themselves). Never the author.
 IF broadcast IS NOT NULL THEN
  INSERT INTO public.team_hub_message_broadcast_recipients(message_id,tenant_id,channel_id,user_id)
   SELECT msg.id,p_expected_tenant,ch.id,m.user_id FROM public.team_hub_channel_members m
   WHERE m.channel_id=ch.id AND m.user_id<>actor AND public._team_hub_participates(p_expected_tenant,m.user_id)
    AND (broadcast='channel' OR m.last_read_at>=now()-interval '10 minutes'
     OR EXISTS(SELECT 1 FROM public.team_hub_messages x WHERE x.channel_id=ch.id AND x.author_user_id=m.user_id
      AND x.author_kind='user' AND x.deleted_at IS NULL AND x.created_at>=now()-interval '10 minutes'));
 END IF;
 UPDATE public.team_hub_files f SET message_id=msg.id, posted_at=now() WHERE f.id=ANY(files);
 RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg));
END $$;
REVOKE ALL ON FUNCTION public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[],text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[],text) TO authenticated;

-- ── D. The member-safe turn-state read (20271119010008, plus A1c, marked) ────────────────────────
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
    'state',CASE WHEN s.author_user_id=actor OR (s.private_part AND s.state IN ('answering','replied_privately'))
     -- A1c: a reply being written shows everyone who can see the conversation that it is (state only).
     OR (NOT s.private_part AND s.state='answering') THEN s.state ELSE 'replied' END,
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
 WHERE s.author_user_id=actor OR (s.private_part AND s.state IN ('answering','replied_privately')) OR s.bring_in IS NOT NULL
  -- A1c: and a reply being written ("<AGENT> is writing…" for everyone, like a person typing). Only the
  -- state: no text, no token, no turn id; never a running turn in a conversation the caller cannot see.
  OR (NOT s.private_part AND s.state='answering');
 RETURN jsonb_build_object('ok',true,'states',states);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_agent_turn_states(uuid,uuid,uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_agent_turn_states(uuid,uuid,uuid[]) TO authenticated;

-- ── E. A10: the new table goes with the account at retirement, like every Team Hub table ──────────
DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer; BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=position(anchor IN body);
 IF position('''team_hub_message_broadcast_recipients''' IN body)>0 THEN RETURN; END IF;
 IF at=0 OR position('''team_hub_agent_turns''' IN body)=0 THEN
  RAISE EXCEPTION 'Canonical retirement policy requires reconciliation before registering Team Hub broadcasts'; END IF;
 EXECUTE left(body,at+length(anchor)-1)||'''team_hub_message_broadcast_recipients'','
  ||substr(body,at+length(anchor));
END $$;
COMMIT;
