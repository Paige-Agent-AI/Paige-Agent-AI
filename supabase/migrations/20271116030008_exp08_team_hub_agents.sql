-- EXP08 Team Hub agents, increment A1 part 1 (A1a): the storage and doors that let PAIGE and her six
-- agents (VERA, NEXUS, CURA, MENTOR, MERIT, ZION) take part in Team Hub conversations.
-- Contract: docs/delivery/exp08-team-hub-agents-contract.md, section 5 A1 "Backend, in EXP08's own
-- tables". Owner rulings 2026-10-26 and design approval 2026-10-27 (docs/brain/decision-log.md,
-- "EXP08 Team Hub agents").
--
-- REVERSAL, RECORDED (§58). 20271113850008's header says "Human-to-human only: no Paige act,
-- provider, approval or durable job." Migrations are forward-only, so that header stays as history.
-- The owner's 2026-10-26 ruling reverses it for agent participation only: "I would like those
-- conversations and their personalities dedicated inside of the Team Hub chat. That's where the
-- agents should be able to chat as well as PAIGE." Increment 2's "the specialist name stays plain
-- text, never a stored mention" is reversed the same way: agent mentions are stored, in their own
-- table. Nothing here adds an act, a provider, an approval or a durable job: agents only converse.
--
-- WHAT THIS ADDS, and nothing in it runs a model or posts by itself:
--   team_hub_messages: author_kind ('user' | 'agent'), agent_key, asked_in_message_id. author_user_id
--     stays NOT NULL; on an agent row it is the accountable person who asked, so the request key, the
--     files guard, unread counts and search names keep working unchanged.
--   team_hub_channels: agent_key and a new kind, 'agent_dm' (one person and one agent). A new kind, not
--     'dm', so no existing split_part(dm_key)::uuid cast ever sees an agent key.
--   team_hub_message_agent_mentions: which agents a person's message asks (at most 3).
--   team_hub_agent_turns: the accepted-turn record, the only proof an agent post came from a real turn.
--   Doors: team_hub_accept_agent_turn and team_hub_end_agent_turn (service_role only, called by
--     paige-ai-chat when it accepts or ends a turn it has re-read under the asker's JWT; they write
--     the permission record and nothing else), team_hub_open_agent_dm and team_hub_post_agent_message
--     (authenticated only, under the asker's JWT; the post needs the turn's single-use token, which
--     never leaves the edge function).
--   Re-emitted from their newest bodies, changed only where marked "A1:": team_hub_post_message
--     (20271115040008), _team_hub_message_json (20271114160008), team_hub_list_conversations
--     (20271115040008), team_hub_search (20271114300008), team_hub_leave_channel (20271113850008),
--     _team_hub_seat_ended (20271115040008), _team_hub_member_scope_guard and
--     _team_hub_message_scope_guard (20271113850008), and the retirement-disposition patch.
-- No UI uses any of it yet (A1b), and paige-ai-chat does not call it yet (A1b, Chat lane).
--
-- Tables are RLS-on with no policies and no browser grant; every door re-checks the caller in its
-- body (§59). Expected refusals return {"ok":false,"code":...}; nothing raises.
-- Forward-only and replay-safe: a second apply changes nothing.
-- Rollback: drop the four new doors, the two new helpers and the two new tables; re-emit the
-- re-emitted functions from the migrations named above (drop the eight-argument
-- team_hub_post_message first); restore team_hub_channels_kind_check and team_hub_channels_shape_chk
-- from 20271113850008; drop the three message columns, their CHECK and index, and agent_key.
BEGIN;
SET LOCAL lock_timeout = '2s';

-- ── A. Agent-authored messages ───────────────────────────────────────────────────────────────────
-- A constant default, so a catalog-only change on PostgreSQL 11+: no table rewrite.
ALTER TABLE public.team_hub_messages ADD COLUMN IF NOT EXISTS author_kind text NOT NULL DEFAULT 'user';
ALTER TABLE public.team_hub_messages ADD COLUMN IF NOT EXISTS agent_key text;
ALTER TABLE public.team_hub_messages ADD COLUMN IF NOT EXISTS asked_in_message_id uuid REFERENCES public.team_hub_messages(id);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_messages'::regclass
   AND conname='team_hub_messages_author_kind_chk') THEN
  ALTER TABLE public.team_hub_messages ADD CONSTRAINT team_hub_messages_author_kind_chk CHECK (
   author_kind IN ('user','agent')
   AND (author_kind='agent')=(agent_key IS NOT NULL)
   AND (agent_key IS NULL OR agent_key IN ('paige','vera','nexus','cura','mentor','merit','zion'))
   AND (asked_in_message_id IS NULL OR author_kind='agent')) NOT VALID;
 END IF;
END $$;
ALTER TABLE public.team_hub_messages VALIDATE CONSTRAINT team_hub_messages_author_kind_chk;
-- The one-reply rule: one agent reply per (asking message, agent).
CREATE UNIQUE INDEX IF NOT EXISTS team_hub_messages_agent_reply_key
 ON public.team_hub_messages (asked_in_message_id, agent_key) WHERE author_kind='agent';
COMMENT ON COLUMN public.team_hub_messages.author_user_id IS
  'The person who wrote the message, or for an agent row (author_kind = agent) the accountable person '
  'who asked the agent. Never null.';

-- ── B. The person-to-agent DM ────────────────────────────────────────────────────────────────────
ALTER TABLE public.team_hub_channels ADD COLUMN IF NOT EXISTS agent_key text;
DO $$ BEGIN
 -- The inline kind CHECK is auto-named team_hub_channels_kind_check (read on production 2026-10-27).
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_channels'::regclass
   AND conname='team_hub_channels_kind_check'
   AND pg_get_constraintdef(oid) NOT LIKE '%agent_dm%') THEN
  ALTER TABLE public.team_hub_channels DROP CONSTRAINT team_hub_channels_kind_check;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_channels'::regclass
   AND conname='team_hub_channels_kind_check') THEN
  ALTER TABLE public.team_hub_channels ADD CONSTRAINT team_hub_channels_kind_check
   CHECK (kind IN ('channel','dm','agent_dm')) NOT VALID;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_channels'::regclass
   AND conname='team_hub_channels_shape_chk'
   AND pg_get_constraintdef(oid) NOT LIKE '%agent_dm%') THEN
  ALTER TABLE public.team_hub_channels DROP CONSTRAINT team_hub_channels_shape_chk;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_channels'::regclass
   AND conname='team_hub_channels_shape_chk') THEN
  -- An agent DM has no name, is private, names its agent, and its key is 'agent:<agent>:<person>',
  -- so one person has at most one DM with each agent in a workspace (the dm_key unique index).
  ALTER TABLE public.team_hub_channels ADD CONSTRAINT team_hub_channels_shape_chk CHECK (
   (kind='channel' AND name IS NOT NULL AND name ~ '^[a-z0-9][a-z0-9-]{1,29}$' AND dm_key IS NULL AND agent_key IS NULL)
   OR (kind='dm' AND name IS NULL AND visibility='private' AND dm_key IS NOT NULL AND agent_key IS NULL)
   OR (kind='agent_dm' AND name IS NULL AND visibility='private'
    AND agent_key IN ('paige','vera','nexus','cura','mentor','merit','zion')
    AND dm_key='agent:'||agent_key||':'||created_by::text)) NOT VALID;
 END IF;
END $$;
ALTER TABLE public.team_hub_channels VALIDATE CONSTRAINT team_hub_channels_kind_check;
ALTER TABLE public.team_hub_channels VALIDATE CONSTRAINT team_hub_channels_shape_chk;

-- ── C. Agent mentions and the accepted-turn record ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_hub_message_agent_mentions (
 message_id uuid NOT NULL REFERENCES public.team_hub_messages(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL,
 channel_id uuid NOT NULL,
 agent_key text NOT NULL CHECK (agent_key IN ('paige','vera','nexus','cura','mentor','merit','zion')),
 PRIMARY KEY (message_id, agent_key)
);

-- One row per (asker, source message, agent, intent). intent is 'reply' (in the conversation the
-- source is in), 'dm' (in the asker's DM with the agent) or, from A3, 'report:<action>:<run>'.
-- Accepted and not consumed: the turn is running. Consumed with a posted message: it replied.
-- Consumed with none: it ended without posting (failed, or the tab closed); a retry re-arms the same
-- row with a new token, so it is still one turn toward the per-seat cap. The token itself is never
-- stored, only its SHA-256.
CREATE TABLE IF NOT EXISTS public.team_hub_agent_turns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 channel_id uuid NOT NULL REFERENCES public.team_hub_channels(id) ON DELETE CASCADE,
 asker_user_id uuid NOT NULL,
 source_message_id uuid NOT NULL REFERENCES public.team_hub_messages(id) ON DELETE CASCADE,
 agent_key text NOT NULL CHECK (agent_key IN ('paige','vera','nexus','cura','mentor','merit','zion')),
 intent text NOT NULL CHECK (intent IN ('reply','dm')
  OR intent ~ '^report:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 accepted_at timestamptz NOT NULL DEFAULT now(),
 consumed_at timestamptz,
 posted_message_id uuid REFERENCES public.team_hub_messages(id) ON DELETE CASCADE,
 CONSTRAINT team_hub_agent_turns_intent_key UNIQUE (asker_user_id, source_message_id, agent_key, intent),
 CONSTRAINT team_hub_agent_turns_state_chk CHECK (posted_message_id IS NULL OR consumed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS team_hub_agent_turns_cap_idx
 ON public.team_hub_agent_turns (tenant_id, asker_user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS team_hub_agent_turns_source_idx
 ON public.team_hub_agent_turns (source_message_id);

ALTER TABLE public.team_hub_message_agent_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_hub_agent_turns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_hub_message_agent_mentions, public.team_hub_agent_turns FROM PUBLIC, anon, authenticated;

-- Storage backstops. The doors refuse these first; a direct write that skips them still fails.
-- A mention belongs to a person's message in the same conversation: an agent's text never mentions.
CREATE OR REPLACE FUNCTION public._team_hub_agent_mention_scope_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.team_hub_messages m WHERE m.id=NEW.message_id
   AND m.tenant_id=NEW.tenant_id AND m.channel_id=NEW.channel_id AND m.author_kind='user') THEN
  RAISE EXCEPTION 'TEAM_HUB_AGENT_MENTION_SCOPE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_agent_mention_scope_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER team_hub_agent_mention_scope BEFORE INSERT OR UPDATE OF message_id, tenant_id, channel_id
 ON public.team_hub_message_agent_mentions FOR EACH ROW EXECUTE FUNCTION public._team_hub_agent_mention_scope_guard();

-- A turn belongs to its conversation's workspace, its source is the asker's own message in the same
-- workspace, and what it posted is that agent's row in the turn's conversation.
CREATE OR REPLACE FUNCTION public._team_hub_agent_turn_scope_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.team_hub_channels c WHERE c.id=NEW.channel_id AND c.tenant_id=NEW.tenant_id)
   OR NOT EXISTS(SELECT 1 FROM public.team_hub_messages m WHERE m.id=NEW.source_message_id
    AND m.tenant_id=NEW.tenant_id AND m.author_user_id=NEW.asker_user_id AND m.author_kind='user')
   OR (NEW.posted_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_hub_messages m
    WHERE m.id=NEW.posted_message_id AND m.channel_id=NEW.channel_id AND m.author_kind='agent'
     AND m.agent_key=NEW.agent_key AND m.author_user_id=NEW.asker_user_id)) THEN
  RAISE EXCEPTION 'TEAM_HUB_AGENT_TURN_SCOPE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_agent_turn_scope_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER team_hub_agent_turn_scope BEFORE INSERT OR UPDATE
 ON public.team_hub_agent_turns FOR EACH ROW EXECUTE FUNCTION public._team_hub_agent_turn_scope_guard();

-- ── D. Re-emitted storage guards ─────────────────────────────────────────────────────────────────
-- 20271113850008, plus A1: an agent DM has exactly one member, the person whose DM it is.
CREATE OR REPLACE FUNCTION public._team_hub_member_scope_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.team_hub_channels c WHERE c.id=NEW.channel_id AND c.tenant_id=NEW.tenant_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_MEMBER_SCOPE' USING ERRCODE='23514'; END IF;
 -- A1: an agent DM is one person and one agent; nobody else, owners included, is ever a member.
 IF EXISTS(SELECT 1 FROM public.team_hub_channels c WHERE c.id=NEW.channel_id AND c.kind='agent_dm'
   AND c.created_by<>NEW.user_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_MEMBER_SCOPE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_member_scope_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER team_hub_member_scope BEFORE INSERT OR UPDATE OF channel_id, tenant_id, user_id
 ON public.team_hub_channel_members FOR EACH ROW EXECUTE FUNCTION public._team_hub_member_scope_guard();

-- 20271113850008, plus A1: the asking message is in the same conversation, and an agent posts in an
-- agent DM only as that DM's own agent.
CREATE OR REPLACE FUNCTION public._team_hub_message_scope_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.team_hub_channels c WHERE c.id=NEW.channel_id AND c.tenant_id=NEW.tenant_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_MESSAGE_SCOPE' USING ERRCODE='23514'; END IF;
 -- One level: a reply's parent is a root in the same channel, and a root with replies stays a root.
 IF NEW.parent_message_id IS NOT NULL AND (
   NOT EXISTS(SELECT 1 FROM public.team_hub_messages p WHERE p.id=NEW.parent_message_id
    AND p.channel_id=NEW.channel_id AND p.parent_message_id IS NULL)
   OR EXISTS(SELECT 1 FROM public.team_hub_messages r WHERE r.parent_message_id=NEW.id)) THEN
  RAISE EXCEPTION 'TEAM_HUB_THREAD_DEPTH' USING ERRCODE='23514'; END IF;
 -- A1: an agent reply links only to a person's message in its own conversation, so nothing private
 -- in a DM ever points back into a channel.
 IF NEW.asked_in_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_hub_messages a
   WHERE a.id=NEW.asked_in_message_id AND a.channel_id=NEW.channel_id AND a.author_kind='user') THEN
  RAISE EXCEPTION 'TEAM_HUB_MESSAGE_SCOPE' USING ERRCODE='23514'; END IF;
 IF NEW.author_kind='agent' AND EXISTS(SELECT 1 FROM public.team_hub_channels c WHERE c.id=NEW.channel_id
   AND c.kind='agent_dm' AND c.agent_key IS DISTINCT FROM NEW.agent_key) THEN
  RAISE EXCEPTION 'TEAM_HUB_MESSAGE_SCOPE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_message_scope_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER team_hub_message_scope BEFORE INSERT OR UPDATE OF channel_id, tenant_id, parent_message_id,
 asked_in_message_id, author_kind, agent_key
 ON public.team_hub_messages FOR EACH ROW EXECUTE FUNCTION public._team_hub_message_scope_guard();

-- ── E. Helpers ───────────────────────────────────────────────────────────────────────────────────
-- The canonical display name of each agent (the 23 Oct 2026 roster standard). A tenant's own display
-- names arrive with A4 and layer over these; the stored key never changes.
CREATE OR REPLACE FUNCTION public._team_hub_agent_name(p_agent_key text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_agent_key WHEN 'paige' THEN 'PAIGE' WHEN 'vera' THEN 'VERA' WHEN 'nexus' THEN 'NEXUS'
  WHEN 'cura' THEN 'CURA' WHEN 'mentor' THEN 'MENTOR' WHEN 'merit' THEN 'MERIT' WHEN 'zion' THEN 'ZION' END
$$;
REVOKE ALL ON FUNCTION public._team_hub_agent_name(text) FROM PUBLIC, anon, authenticated, service_role;

-- ── F. Re-emitted reads ──────────────────────────────────────────────────────────────────────────
-- 20271114160008, plus A1: author_kind, agent_key, asked_in_message_id and agent_mentions.
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
$$;
REVOKE ALL ON FUNCTION public._team_hub_message_json(public.team_hub_messages) FROM PUBLIC, anon, authenticated, service_role;

-- 20271115040008, plus A1 (marked): each conversation's agent_key; an agent's message is unread for
-- everyone who can see it, the person who asked included; a teammate whose display name begins with
-- an agent's name is marked so the screen can show them with a surname initial.
CREATE OR REPLACE FUNCTION public.team_hub_list_conversations(p_expected_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); people jsonb; conversations jsonb;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 -- Active roster only. Never an email.
 -- EXP08 lifecycle: 'team_conversations' says whether this person can be added to a channel, opened
 -- in a DM or mentioned. They stay listed either way: they are still on the team, still named on
 -- what they wrote, and still assignable work.
 -- A1: 'agent_name_clash' when the first word of their display name is an agent's name.
 SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',r.user_id,'display_name',r.display_name,'title',r.job_title,
   'permission',r.permission,'team_conversations',r.team_hub_access,
   'agent_name_clash',lower(split_part(btrim(r.display_name),' ',1)) IN ('paige','vera','nexus','cura','mentor','merit','zion'))
   ORDER BY lower(r.display_name), r.user_id),'[]'::jsonb) INTO people
 FROM (SELECT tm.user_id, coalesce(nullif(btrim(p.full_name),''),'Teammate') AS display_name, tm.job_title,
   CASE WHEN tm.is_owner OR tm.role::text='owner' THEN 'owner' ELSE tm.role::text END AS permission, tm.team_hub_access
  FROM public.tenant_members tm LEFT JOIN public.profiles p ON p.user_id=tm.user_id
  WHERE tm.tenant_id=p_expected_tenant AND tm.status='active') r;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'name',c.name,'visibility',c.visibility,
   'joined',m.user_id IS NOT NULL,
   -- A4: the caller is a member of a private channel or DM, so may see who else is. Active only.
   'member_count',CASE WHEN c.visibility='private' THEN jsonb_array_length(a.member_ids) END,
   'member_ids',CASE WHEN c.visibility='private' THEN a.member_ids END,
   -- From the pair key, not the member rows: it still names the other person after their seat ends.
   'dm_user_id',CASE WHEN c.kind='dm' THEN (SELECT k.id::uuid FROM unnest(string_to_array(c.dm_key,':')) k(id)
    WHERE k.id<>actor::text) END,
   -- A1: the agent of an agent DM; null for every other conversation.
   'agent_key',c.agent_key,
   'unread',CASE WHEN m.user_id IS NULL THEN 0 ELSE (SELECT count(*) FROM public.team_hub_messages x
    WHERE x.channel_id=c.id AND x.parent_message_id IS NULL AND x.deleted_at IS NULL
     AND (x.author_user_id<>actor OR x.author_kind='agent')
     AND (m.last_read_at IS NULL OR x.created_at>m.last_read_at)) END,
   'last_message_at',l.last_message_at)
   ORDER BY c.kind, coalesce(l.last_message_at,c.created_at) DESC, c.id),'[]'::jsonb) INTO conversations
 FROM public.team_hub_channels c
 LEFT JOIN public.team_hub_channel_members m ON m.channel_id=c.id AND m.user_id=actor
 LEFT JOIN LATERAL (SELECT max(x.created_at) AS last_message_at FROM public.team_hub_messages x
  WHERE x.channel_id=c.id AND x.deleted_at IS NULL) l ON true
 LEFT JOIN LATERAL (SELECT coalesce(jsonb_agg(x.user_id ORDER BY x.user_id),'[]'::jsonb) AS member_ids
  FROM public.team_hub_channel_members x
  WHERE c.visibility='private' AND x.channel_id=c.id AND public._team_hub_is_active(c.tenant_id,x.user_id)) a ON true
 WHERE c.tenant_id=p_expected_tenant AND c.archived_at IS NULL AND (c.visibility='team' OR m.user_id IS NOT NULL);
 RETURN jsonb_build_object('ok',true,'tenant_id',p_expected_tenant,'me',jsonb_build_object('user_id',actor),
  'people',people,'conversations',conversations);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_list_conversations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_list_conversations(uuid) TO authenticated;

-- 20271114300008, plus A1 (marked): an agent DM is labelled with its agent, and an agent's message
-- carries the agent's name, never the name of the person who asked it.
CREATE OR REPLACE FUNCTION public.team_hub_search(p_expected_tenant uuid, p_query text, p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
-- Plan every call for its own query and limit. A cached generic plan cannot see the word, so after a
-- few calls on one connection (PostgREST reuses them) it walked every message for a rare word.
SET plan_cache_mode='force_custom_plan' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant);
 q text:=public._team_hub_trim(p_query); pattern text; lim int:=greatest(1,least(20,coalesce(p_limit,20))); results jsonb; visible uuid[]; hits uuid[];
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 IF q IS NULL OR char_length(q)<2 OR char_length(q)>200 THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- The conversations the asker can see now, resolved once per call rather than once per message.
 visible:=ARRAY(SELECT c.id FROM public.team_hub_channels c WHERE c.tenant_id=p_expected_tenant
  AND EXISTS(SELECT 1 FROM public._team_hub_visible(p_expected_tenant,actor,c.id)));
 -- A literal: the escape character first, then the two wildcards.
 pattern:='%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%';

 -- Which messages match, newest first, at most lim. Split by whether the query and the body are plain
 -- ASCII, because only there do ILIKE's per-character case folding and the trigram index's whole-string
 -- folding agree under every collation (production uses ICU, where a Greek final sigma, for one, folds
 -- differently and the index would miss a real match). So the trigram index serves only ASCII bodies
 -- for an ASCII query; every other body, and every non-ASCII query, is read in time order as before.
 -- The two halves partition the bodies, so the result is the same set the single scan returns. The
 -- body test is a regex, not octet_length, because the planner can estimate a regex (see the header).
 IF octet_length(q)=char_length(q) THEN
  hits:=ARRAY(SELECT u.id FROM (
    (SELECT m.id, m.created_at FROM public.team_hub_messages m
      WHERE m.tenant_id=p_expected_tenant AND m.channel_id=ANY(visible) AND m.deleted_at IS NULL
       AND (m.parent_message_id IS NULL OR (SELECT r.deleted_at IS NULL FROM public.team_hub_messages r
        WHERE r.id=m.parent_message_id))
       AND m.body ~ '^[\x01-\x7f]*$'
       AND m.body ILIKE pattern ESCAPE '\'
      ORDER BY m.created_at DESC, m.id DESC LIMIT lim)
    UNION ALL
    (SELECT m.id, m.created_at FROM public.team_hub_messages m
      WHERE m.tenant_id=p_expected_tenant AND m.channel_id=ANY(visible) AND m.deleted_at IS NULL
       AND (m.parent_message_id IS NULL OR (SELECT r.deleted_at IS NULL FROM public.team_hub_messages r
        WHERE r.id=m.parent_message_id))
       AND m.body !~ '^[\x01-\x7f]*$'
       AND m.body ILIKE pattern ESCAPE '\'
      ORDER BY m.created_at DESC, m.id DESC LIMIT lim)) u
   ORDER BY u.created_at DESC, u.id DESC LIMIT lim);
 ELSE
  hits:=ARRAY(SELECT m.id FROM public.team_hub_messages m
   WHERE m.tenant_id=p_expected_tenant AND m.channel_id=ANY(visible) AND m.deleted_at IS NULL
    AND (m.parent_message_id IS NULL OR (SELECT r.deleted_at IS NULL FROM public.team_hub_messages r
     WHERE r.id=m.parent_message_id))
    AND m.body ILIKE pattern ESCAPE '\'
   ORDER BY m.created_at DESC, m.id DESC LIMIT lim);
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('message_id',h.id,'conversation_id',h.channel_id,
   'conversation_kind',h.kind,
   -- The channel name, or for a DM the other person from the pair key. A person is named only while
   -- they hold an active seat here, as team_hub_list_conversations' people list does; otherwise
   -- 'Former teammate', never the name their profile carries now. Never an email.
   -- A1: an agent DM is named by its agent.
   'conversation_label',CASE WHEN h.kind='agent_dm' THEN public._team_hub_agent_name(h.channel_agent_key)
    WHEN h.kind<>'dm' THEN h.name
    WHEN public._team_hub_is_active(p_expected_tenant,h.dm_user_id) THEN coalesce(nullif(btrim(dp.full_name),''),'Teammate')
    ELSE 'Former teammate' END,
   'thread_root_id',h.parent_message_id,
   -- A1: an agent's message carries the agent's name.
   'author_name',CASE WHEN h.author_kind='agent' THEN public._team_hub_agent_name(h.agent_key)
    WHEN public._team_hub_is_active(p_expected_tenant,h.author_user_id)
    THEN coalesce(nullif(btrim(ap.full_name),''),'Teammate') ELSE 'Former teammate' END,
   'created_at',h.created_at,
   'snippet',public._team_hub_search_snippet(h.body,q))
   ORDER BY h.created_at DESC, h.id DESC),'[]'::jsonb) INTO results
 FROM (SELECT m.id, m.channel_id, m.parent_message_id, m.author_user_id, m.body, m.created_at, c.kind, c.name,
   m.author_kind, m.agent_key, c.agent_key AS channel_agent_key,
   CASE WHEN c.kind='dm' THEN (SELECT k.id::uuid FROM unnest(string_to_array(c.dm_key,':')) k(id)
    WHERE k.id<>actor::text LIMIT 1) END AS dm_user_id
  FROM public.team_hub_messages m
  JOIN public.team_hub_channels c ON c.id=m.channel_id
  WHERE m.id=ANY(hits)
  ORDER BY m.created_at DESC, m.id DESC) h
 LEFT JOIN public.profiles ap ON ap.user_id=h.author_user_id
 LEFT JOIN public.profiles dp ON dp.user_id=h.dm_user_id;
 RETURN jsonb_build_object('ok',true,'results',results);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_search(uuid,text,int) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_search(uuid,text,int) TO authenticated;

-- ── G. Re-emitted writers ────────────────────────────────────────────────────────────────────────
-- 20271113850008, plus A1: nobody leaves an agent DM (it would archive the person's own DM).
CREATE OR REPLACE FUNCTION public.team_hub_leave_channel(p_expected_tenant uuid, p_channel_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF ch.kind IN ('dm','agent_dm') THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 -- A5: the last member out of a private channel archives it in this transaction. The row lock
 -- serialises two last members leaving at once, so one of them always sees the other gone.
 PERFORM 1 FROM public.team_hub_channels c WHERE c.id=ch.id FOR UPDATE;
 DELETE FROM public.team_hub_channel_members m WHERE m.channel_id=ch.id AND m.user_id=actor;
 IF ch.visibility='private' AND NOT EXISTS(SELECT 1 FROM public.team_hub_channel_members m WHERE m.channel_id=ch.id) THEN
  UPDATE public.team_hub_channels c SET archived_at=now() WHERE c.id=ch.id AND c.archived_at IS NULL;
 END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_leave_channel(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_leave_channel(uuid,uuid) TO authenticated;

-- 20271115040008, plus A1 (marked): p_agent_mention_keys, up to 3 distinct agents a person's message
-- asks, stored in team_hub_message_agent_mentions; a person's retry never returns an agent's row.
-- DROP and recreate, as 20271114160008 did: team_hub_request_task's positional seven-argument call
-- and PAIGE's named call (chat.ts) still resolve, the new argument defaulting to none.
DROP FUNCTION IF EXISTS public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[]);
CREATE OR REPLACE FUNCTION public.team_hub_post_message(p_expected_tenant uuid, p_channel_id uuid, p_body text,
 p_client_request_id uuid, p_parent_message_id uuid DEFAULT NULL, p_mention_ids uuid[] DEFAULT '{}',
 p_file_ids uuid[] DEFAULT '{}', p_agent_mention_keys text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
 body text:=public._team_hub_trim(p_body); mentions uuid[]; msg public.team_hub_messages; other uuid;
 files uuid[]:=coalesce(p_file_ids,'{}'::uuid[]); held int; agents text[]:=coalesce(p_agent_mention_keys,'{}'::text[]);
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
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,parent_message_id,client_request_id)
  VALUES (p_expected_tenant,ch.id,actor,body,p_parent_message_id,p_client_request_id)
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
 UPDATE public.team_hub_files f SET message_id=msg.id, posted_at=now() WHERE f.id=ANY(files);
 RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg));
END $$;
REVOKE ALL ON FUNCTION public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[],text[]) TO authenticated;

-- 20271115040008, plus A1 (marked): when a seat ends, the person's agent DMs and their running
-- turns go too. Holds (suspended, archived) keep them, as they keep private memberships.
-- Deleting is safe under account retirement (it deletes rows, never moves one, so a planned row is
-- only ever already gone). An agent DM that holds a file record is left, unreachable like any
-- private conversation without members: deleting it would drop the record and strand its bytes in
-- Storage, where only the files retirement provider may remove them.
CREATE OR REPLACE FUNCTION public._team_hub_seat_ended()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.status IN ('active','archived','suspended')
   AND (TG_OP='DELETE' OR coalesce(NEW.status,'') NOT IN ('active','archived','suspended')) THEN
  DELETE FROM public.team_hub_channel_members m USING public.team_hub_channels c
   WHERE m.channel_id=c.id AND m.tenant_id=OLD.tenant_id AND m.user_id=OLD.user_id AND c.visibility='private';
  -- A1: the person's turns that are still running, then their agent DMs (with what was said there).
  DELETE FROM public.team_hub_agent_turns t
   WHERE t.tenant_id=OLD.tenant_id AND t.asker_user_id=OLD.user_id AND t.consumed_at IS NULL;
  DELETE FROM public.team_hub_channels c
   WHERE c.tenant_id=OLD.tenant_id AND c.kind='agent_dm' AND c.created_by=OLD.user_id
    AND NOT EXISTS(SELECT 1 FROM public.team_hub_files f WHERE f.channel_id=c.id);
 END IF;
 -- This trigger never UPDATEs team_hub_channels. Account retirement deletes rows by the ctids it
 -- planned, and fires this trigger mid-way; an UPDATE here would move a channel's ctid and make
 -- retirement roll back. A private channel left with no members is unreachable by every door,
 -- so it is left as it is rather than archived.
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_seat_ended() FROM PUBLIC, anon, authenticated, service_role;

-- ── H. The agent doors ───────────────────────────────────────────────────────────────────────────
-- Opens (or reopens) the caller's DM with one agent. Only the caller is ever a member.
CREATE OR REPLACE FUNCTION public.team_hub_open_agent_dm(p_expected_tenant uuid, p_agent_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); pair_key text; dm public.team_hub_channels;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 IF p_agent_key IS NULL OR p_agent_key NOT IN ('paige','vera','nexus','cura','mentor','merit','zion') THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor]) THEN
  RETURN jsonb_build_object('ok',false,'code',CASE WHEN public._team_hub_is_active(p_expected_tenant,actor)
   THEN 'conversations_off' ELSE 'not_member' END); END IF;
 pair_key:='agent:'||p_agent_key||':'||actor::text;
 INSERT INTO public.team_hub_channels(tenant_id,kind,visibility,dm_key,agent_key,created_by)
  VALUES (p_expected_tenant,'agent_dm','private',pair_key,p_agent_key,actor) ON CONFLICT (tenant_id,dm_key) DO NOTHING;
 SELECT * INTO dm FROM public.team_hub_channels c WHERE c.tenant_id=p_expected_tenant AND c.dm_key=pair_key;
 IF NOT FOUND OR dm.archived_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by)
  VALUES (dm.id,p_expected_tenant,actor,actor) ON CONFLICT (channel_id,user_id) DO NOTHING;
 RETURN jsonb_build_object('ok',true,'channel_id',dm.id);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_open_agent_dm(uuid,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_open_agent_dm(uuid,text) TO authenticated;

-- Records that paige-ai-chat accepted one agent turn for one person's message. SERVICE ROLE ONLY:
-- auth.uid() is null there, so the asker is the one passed in (§59: the only place a passed actor is
-- honoured), and the edge function passes the user it verified from the JWT after re-reading the
-- source under that JWT. This writes the permission record and nothing else: it posts no message and
-- runs no model, so the turn itself stays the asker's.
-- Rule 2 (an agent speaks only when asked), re-checked here against storage:
--   'reply': the source is the asker's own live message in this conversation and asks this agent;
--   'dm':    this conversation is the asker's DM with this agent, and the source is either the
--            asker's own live message in it, or the asker's own live message elsewhere that asks
--            this agent (the private part of a channel question). Reports ('report:...') arrive in A3
--            and are refused until then.
-- Per-seat cap (contract §9): 30 accepted turns per person per rolling hour in a workspace. A retry of
-- a turn that ended without posting re-arms the same row and is not counted again.
CREATE OR REPLACE FUNCTION public.team_hub_accept_agent_turn(p_tenant uuid, p_asker uuid, p_channel_id uuid,
 p_source_message_id uuid, p_agent_key text, p_intent text, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ch public.team_hub_channels; src public.team_hub_messages; turn public.team_hub_agent_turns; used bigint;
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
 IF FOUND THEN
  IF turn.posted_message_id IS NOT NULL THEN
   RETURN jsonb_build_object('ok',false,'code','duplicate','message_id',turn.posted_message_id); END IF;
  IF turn.consumed_at IS NULL THEN RETURN jsonb_build_object('ok',false,'code','in_flight'); END IF;
  IF turn.channel_id<>ch.id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  -- Ended without posting: re-arm the same turn with the new token. Still one turn toward the cap.
  UPDATE public.team_hub_agent_turns t SET token_hash=p_token_hash, accepted_at=now(), consumed_at=NULL
   WHERE t.id=turn.id;
  RETURN jsonb_build_object('ok',true,'turn_id',turn.id,'rearmed',true);
 END IF;
 SELECT count(*) INTO used FROM public.team_hub_agent_turns t
  WHERE t.tenant_id=p_tenant AND t.asker_user_id=p_asker AND t.accepted_at>now()-interval '1 hour';
 IF used>=30 THEN RETURN jsonb_build_object('ok',false,'code','rate_limited'); END IF;
 INSERT INTO public.team_hub_agent_turns(tenant_id,channel_id,asker_user_id,source_message_id,agent_key,intent,token_hash)
  VALUES (p_tenant,ch.id,p_asker,src.id,p_agent_key,p_intent,p_token_hash) RETURNING * INTO turn;
 RETURN jsonb_build_object('ok',true,'turn_id',turn.id);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) TO service_role;

-- Marks a running turn ended without a post (the model failed, or the asker's tab went away), so the
-- conversation stops showing it as running and a retry can re-arm it. SERVICE ROLE ONLY, and only
-- with the turn's own token, which only the edge function that accepted it holds.
CREATE OR REPLACE FUNCTION public.team_hub_end_agent_turn(p_turn_id uuid, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF p_turn_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 UPDATE public.team_hub_agent_turns t SET consumed_at=now()
  WHERE t.id=p_turn_id AND t.token_hash=p_token_hash AND t.consumed_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_end_agent_turn(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_end_agent_turn(uuid,text) TO service_role;

-- Posts one agent's reply, as the server writes it after the turn's stream completes, under the
-- asker's JWT (never the service role). It posts only when an unconsumed accepted turn exists for this
-- caller, conversation, agent and intent whose token matches, and consumes that turn in the same
-- transaction. The token is generated per turn inside the edge function and never reaches the
-- browser, so the asker calling this directly, with any text, is refused, and so is a replay.
-- A retry with the same token and request id after an unknown outcome returns the posted row.
-- When p_private_answer is true the fixed line below is appended here; the model cannot word it,
-- and it is the same whether or not a private answer exists.
CREATE OR REPLACE FUNCTION public.team_hub_post_agent_message(p_expected_tenant uuid, p_channel_id uuid, p_agent_key text,
 p_body text, p_client_request_id uuid, p_parent_message_id uuid, p_asked_in_message_id uuid, p_intent text,
 p_turn_token text, p_private_answer boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
 turn public.team_hub_agent_turns; src public.team_hub_messages; msg public.team_hub_messages; hashed text;
 body text:=coalesce(public._team_hub_trim(p_body),'');
 private_line constant text:='That part is just for you, so I''m answering it in our DM.';
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF p_client_request_id IS NULL OR p_agent_key IS NULL OR p_intent IS NULL
   OR p_turn_token IS NULL OR char_length(p_turn_token) NOT BETWEEN 32 AND 200 THEN
  RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 hashed:=encode(sha256(convert_to(p_turn_token,'UTF8')),'hex');
 SELECT * INTO turn FROM public.team_hub_agent_turns t WHERE t.asker_user_id=actor AND t.tenant_id=p_expected_tenant
  AND t.channel_id=ch.id AND t.agent_key=p_agent_key AND t.intent=p_intent AND t.token_hash=hashed FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 -- The same token and request id again: the outcome of an earlier call was unknown. Return that row.
 IF turn.consumed_at IS NOT NULL THEN
  SELECT * INTO msg FROM public.team_hub_messages m WHERE m.id=turn.posted_message_id
   AND m.author_user_id=actor AND m.client_request_id=p_client_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
 END IF;
 SELECT * INTO src FROM public.team_hub_messages m WHERE m.id=turn.source_message_id;
 -- Where the reply goes. A reply answers where it was asked: a thread question in its thread, a
 -- top-level question at the top level, linked to it (owner ruling 2026-10-27, Q2). An answer in the
 -- agent DM links to the asking message only when that message is in the DM itself.
 IF src.deleted_at IS NOT NULL
   OR p_asked_in_message_id IS DISTINCT FROM (CASE WHEN src.channel_id=ch.id THEN src.id END)
   OR p_parent_message_id IS DISTINCT FROM (CASE WHEN src.channel_id=ch.id THEN src.parent_message_id END) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF p_private_answer THEN body:=btrim(body||E'\n\n'||private_line, E' \t\r\n'); END IF;
 IF body='' THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF char_length(body)>8000 THEN RETURN jsonb_build_object('ok',false,'code','too_long'); END IF;
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,parent_message_id,client_request_id,
  author_kind,agent_key,asked_in_message_id)
  VALUES (p_expected_tenant,ch.id,actor,body,p_parent_message_id,p_client_request_id,'agent',p_agent_key,p_asked_in_message_id)
  ON CONFLICT DO NOTHING RETURNING * INTO msg;
 IF msg.id IS NULL THEN
  -- The one-reply rule already holds a reply from this agent to this message: return it.
  SELECT * INTO msg FROM public.team_hub_messages m WHERE m.author_kind='agent' AND m.agent_key=p_agent_key
   AND m.asked_in_message_id=p_asked_in_message_id AND m.channel_id=ch.id;
  IF NOT FOUND OR msg.author_user_id<>actor THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  UPDATE public.team_hub_agent_turns t SET consumed_at=now(), posted_message_id=msg.id WHERE t.id=turn.id;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
 END IF;
 UPDATE public.team_hub_agent_turns t SET consumed_at=now(), posted_message_id=msg.id WHERE t.id=turn.id;
 RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg));
END $$;
REVOKE ALL ON FUNCTION public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean) TO authenticated;

-- A10: the two new tables go with the account at retirement, like every Team Hub table. The same
-- guarded patch, reconciled against increment 1's registration of team_hub_messages.
DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer; BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=position(anchor IN body);
 IF position('''team_hub_agent_turns''' IN body)>0 THEN RETURN; END IF;
 IF at=0 OR position('''team_hub_messages''' IN body)=0 THEN
  RAISE EXCEPTION 'Canonical retirement policy requires reconciliation before registering Team Hub agents'; END IF;
 EXECUTE left(body,at+length(anchor)-1)||'''team_hub_message_agent_mentions'',''team_hub_agent_turns'','
  ||substr(body,at+length(anchor));
END $$;
COMMIT;
