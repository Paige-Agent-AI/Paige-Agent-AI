-- EXP08 Team Hub agents, A2b: Prepare in an agent DM, then Approve / Not now / the outcome, all on the
-- door's own proposal row. Contract: docs/delivery/exp08-team-hub-agents-contract.md, section 5 A2
-- (slices 2, 3 and 4, "A2b"). Owner rulings 2026-10-28 (docs/brain/decision-log.md, "EXP08 Team Hub
-- agents"); EXP08 owns Team Hub end to end (owner ruling 2026-10-27).
--
-- A Team Hub card is the governed door's own paige_pending_confirmations row (thread_id NULL, minted
-- by that door, claimed by that door's compare-and-set, run under the asker's JWT) plus ONE link row
-- here. No new proposal store, claimer or executor, and no DDL on paige_pending_confirmations.
--
-- WHAT THIS ADDS, all in EXP08's own tables, and nothing in it runs a model, a door or an act:
--   team_hub_agent_turns: the intent CHECK also admits 'outcome:<card message id>', the turn that posts
--     one card's outcome in its own thread. Re-created by name (team_hub_agent_turns_intent_chk).
--   team_hub_message_cards: the link from an agent's DM message to the proposal it shows, who may decide
--     it (the person who asked, approver_user_id), the decision ('approved' | 'declined'), and the
--     settled outcome ('done' | 'failed' | 'unconfirmed', an optional note of up to 280 characters, and
--     the record it produced as {destination, record_id}), plus the message that posted that outcome,
--     and the card's own sentence (summary, up to 280 characters): written by the server at prepare from
--     that turn's reads (the task's title, the person's name), so a card never shows a bare id. Without
--     one the card shows the door's own summary.
--     confirmation_id is UNIQUE and deliberately has no foreign key (the proposal belongs to the
--     confirmations owner). RLS on, no policy, no browser grant; a storage scope guard; retired with
--     the account like every Team Hub table.
--   team_hub_post_agent_message: DROP the ten-argument door and CREATE it with four defaulted
--     arguments (p_confirmation_id, p_card_kind, p_card_outcome, p_card_summary). Re-emitted from 20271117010008,
--     changed only where marked "A2b:". A 'dm' post may link one live proposal of the caller's, minted
--     in this turn, for a tool in the agent's stored DM scope; an 'outcome:<card>' post records itself
--     on that decided and settled card, once. Anything else that names a card is refused 'invalid'.
--   team_hub_accept_agent_turn: re-emitted from 20271119010008, changed only where marked "A2b:". It
--     admits 'outcome:<card>' for the card's own approver after the outcome is settled (counted toward
--     the same 30 per hour), and every success also returns accepted_at.
--   team_hub_decide_card (authenticated): the approver's Approve or Not now. Not now consumes the
--     proposal in the same transaction (consumed_at stays the one claim fact every door reads) and
--     stores 'declined'; Approve stores the decision only, so the door's own claim still runs it.
--   team_hub_settle_card (service role, approver passed in): records the outcome BEFORE anything is posted; a 'failed'
--     outcome whose proposal is still live consumes it in the same transaction.
--   team_hub_card_states (authenticated): the member-safe read. Never the proposal's arguments; the
--     fingerprint only to the approver and only while the card is waiting.
--   paige_subagents: ZION's and NEXUS's config.capability_scope go from version 1 to version 2
--     (access 'card', plus their A2b card tools), guarded on the exact stored version 1 value, and read
--     back. The other four rows change in A2c (recorded as a deviation in the contract's A2b note).
--
-- Doors re-check the caller in their bodies (§59); expected refusals return {"ok":false,"code":...}.
-- Forward-only and replay-safe: a second apply changes nothing.
-- Rollback: re-emit team_hub_post_agent_message (DROP the fourteen-argument door first) from
-- 20271117010008 and team_hub_accept_agent_turn from 20271119010008; drop team_hub_card_states,
-- team_hub_settle_card and team_hub_decide_card; drop team_hub_message_cards with its trigger and guard
-- and remove it from operator_retirement_disposition; drop team_hub_agent_turns_intent_chk and restore
-- the inline intent CHECK from 20271117010008; set ZION's and NEXUS's config.capability_scope back to the
-- version 1 values in 20271117010108 and bump version.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15min';

-- LOCKS UP FRONT, WITHOUT QUEUEING (the pattern of 20271120020008). This file adds a table whose foreign
-- keys reference team_hub_messages and changes a CHECK on team_hub_agent_turns. Both are taken here at
-- once with NOWAIT, which never waits and so never queues a reader; a failed attempt releases what it took
-- and the loop tries again a second later, for up to ten minutes. No lock is taken on
-- paige_pending_confirmations: this file only creates functions that read and update its rows.
DO $locks$
DECLARE _tries integer := 0;
BEGIN
  LOOP
    BEGIN
      LOCK TABLE public.team_hub_messages, public.team_hub_agent_turns IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      _tries := _tries + 1;
      IF _tries >= 600 THEN
        RAISE EXCEPTION 'EXP08 Team Hub A2b: could not take the table locks in % one-second attempts; nothing was applied, so retry when production is quieter', _tries;
      END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END $locks$;

-- ── 0. The bodies this file calls or replaces are the ones it was written against ────────────────
-- md5(prosrc). The four helpers: production, read 2026-10-27 (the values 20271120020008 pins). The two
-- replaced doors: the bodies this tree's chain creates (team_hub_accept_agent_turn from 20271119010008,
-- the ten-argument team_hub_post_agent_message from 20271117010008). All six values re-read from
-- production 2026-10-28 (md5(prosrc)) and equal; ZION's and NEXUS's stored version 1 scopes also equal
-- the values below. A replaced body may also already be this file's own (a second apply is a no-op).
DO $guard$
DECLARE expected record; actual text;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public._team_hub_refusal(uuid)','b6ee98245fdbb9e0229547061a9391d2'),
  ('public._team_hub_visible(uuid,uuid,uuid)','28a7e5c90f2a29b19b4481c4850a414f'),
  ('public._team_hub_is_active(uuid,uuid)','c290399dc80d95d16116a0f88b0abd8c'),
  ('public._team_hub_participates(uuid,uuid)','4f2fb69d09f7b362027edf195a37da83')
 ) AS dependencies(identity,body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(expected.identity);
  IF NOT FOUND OR actual IS DISTINCT FROM expected.body THEN
   RAISE EXCEPTION 'Team Hub A2b dependency % changed; reconcile before applying',expected.identity USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR expected IN SELECT * FROM (VALUES
  ('public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)','f28f30095f96a0c58e1206cbe61340d2','e2b0b503c90a603a2bca402f689a1555')
 ) AS replaced(identity,prior_body,own_body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(expected.identity);
  IF NOT FOUND OR actual NOT IN (expected.prior_body,expected.own_body) THEN
   RAISE EXCEPTION 'Team Hub A2b source % changed; reconcile before applying',expected.identity USING ERRCODE='23514'; END IF;
 END LOOP;
 -- The post door: the ten-argument body (dropped below), or, on a second apply, only this file's
 -- fourteen-argument body.
 SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc
  WHERE oid=to_regprocedure('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean)');
 IF FOUND THEN
  IF actual IS DISTINCT FROM 'c6930cf3329da4c0db6a8390f1564eaa'
    OR to_regprocedure('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)') IS NOT NULL THEN
   RAISE EXCEPTION 'Team Hub A2b source team_hub_post_agent_message changed; reconcile before applying' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc
   WHERE oid=to_regprocedure('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)');
  IF NOT FOUND OR actual IS DISTINCT FROM 'c9d9dc13cdb417e3b10a5b90a694ee34' THEN
   RAISE EXCEPTION 'Team Hub A2b source team_hub_post_agent_message changed; reconcile before applying' USING ERRCODE='23514'; END IF;
 END IF;
END $guard$;

-- ── A. The outcome turn's intent ─────────────────────────────────────────────────────────────────
-- 20271117010008 created the intent CHECK inline, so PostgreSQL named it team_hub_agent_turns_intent_check.
-- It is replaced by a named CHECK that also admits 'outcome:<uuid>'. team_hub_agent_turn_states reads
-- only 'reply' and 'dm' rows (20271120020008), so an outcome turn never shows as a question's state.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_agent_turns'::regclass
   AND conname='team_hub_agent_turns_intent_check') THEN
  ALTER TABLE public.team_hub_agent_turns DROP CONSTRAINT team_hub_agent_turns_intent_check;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.team_hub_agent_turns'::regclass AND c.contype='c'
   AND c.conname<>'team_hub_agent_turns_intent_chk'
   AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid='public.team_hub_agent_turns'::regclass AND a.attname='intent')]) THEN
  RAISE EXCEPTION 'Team Hub A2b: team_hub_agent_turns carries another CHECK on intent; reconcile before applying' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_agent_turns'::regclass
   AND conname='team_hub_agent_turns_intent_chk') THEN
  ALTER TABLE public.team_hub_agent_turns ADD CONSTRAINT team_hub_agent_turns_intent_chk CHECK (intent IN ('reply','dm')
   OR intent ~ '^report:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR intent ~ '^outcome:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') NOT VALID;
 END IF;
END $$;
ALTER TABLE public.team_hub_agent_turns VALIDATE CONSTRAINT team_hub_agent_turns_intent_chk;

-- ── B. The card link ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_hub_message_cards (
 message_id uuid PRIMARY KEY REFERENCES public.team_hub_messages(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL,
 channel_id uuid NOT NULL,
 approver_user_id uuid NOT NULL,
 confirmation_id uuid NOT NULL,
 tool_name text NOT NULL,
 kind text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 decision text,
 decided_at timestamptz,
 outcome text,
 outcome_note text,
 outcome_record jsonb,
 settled_at timestamptz,
 outcome_message_id uuid REFERENCES public.team_hub_messages(id) ON DELETE SET NULL,
 summary text,
 CONSTRAINT team_hub_message_cards_confirmation_key UNIQUE (confirmation_id),
 CONSTRAINT team_hub_message_cards_summary_chk CHECK (summary IS NULL OR char_length(summary) BETWEEN 1 AND 280),
 -- The A2b card set, hand-listed (never computed): each tool has exactly one kind.
 CONSTRAINT team_hub_message_cards_kind_chk CHECK ((tool_name, kind) IN (('crm_assign_task','task_handover'),
  ('crm_cancel_task','task_cancel'), ('growth_page_publish','page_publish'))),
 CONSTRAINT team_hub_message_cards_state_chk CHECK (
  (decision IS NULL OR decision IN ('approved','declined'))
  AND (decision IS NULL)=(decided_at IS NULL)
  AND (outcome IS NULL OR (outcome IN ('done','failed','unconfirmed') AND decision='approved'))
  AND (outcome IS NULL)=(settled_at IS NULL)
  AND (outcome_note IS NULL OR (outcome IS NOT NULL AND char_length(outcome_note) BETWEEN 1 AND 280))
  AND (outcome_record IS NULL OR (outcome='done' AND jsonb_typeof(outcome_record)='object'
   AND (outcome_record - 'destination' - 'record_id')='{}'::jsonb
   AND jsonb_typeof(outcome_record->'destination')='string' AND outcome_record->>'destination' ~ '^[a-z][a-z0-9_]{0,63}$'
   AND outcome_record->>'record_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  AND (outcome_message_id IS NULL OR outcome IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS team_hub_message_cards_channel_idx ON public.team_hub_message_cards (channel_id);
ALTER TABLE public.team_hub_message_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_hub_message_cards FROM PUBLIC, anon, authenticated;

-- Storage backstop. The post door writes these; a direct write that skips it still fails. A card belongs
-- to an agent's message in an agent DM of the same workspace, asked by its approver; the proposal it names
-- is that approver's, in that workspace, outside any chat thread; its outcome post is the same agent's, in
-- the same conversation.
CREATE OR REPLACE FUNCTION public._team_hub_card_scope_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.team_hub_messages m JOIN public.team_hub_channels c ON c.id=m.channel_id
   WHERE m.id=NEW.message_id AND m.tenant_id=NEW.tenant_id AND m.channel_id=NEW.channel_id AND c.tenant_id=NEW.tenant_id
    AND c.kind='agent_dm' AND m.author_kind='agent' AND m.agent_key=c.agent_key AND m.author_user_id=NEW.approver_user_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_CARD_SCOPE' USING ERRCODE='23514'; END IF;
 IF (TG_OP='INSERT' OR NEW.confirmation_id IS DISTINCT FROM OLD.confirmation_id)
   AND NOT EXISTS(SELECT 1 FROM public.paige_pending_confirmations p WHERE p.id=NEW.confirmation_id
    AND p.user_id=NEW.approver_user_id AND p.tenant_id=NEW.tenant_id AND p.thread_id IS NULL AND p.tool_name=NEW.tool_name) THEN
  RAISE EXCEPTION 'TEAM_HUB_CARD_SCOPE' USING ERRCODE='23514'; END IF;
 IF NEW.outcome_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_hub_messages o
   JOIN public.team_hub_messages m ON m.id=NEW.message_id
   WHERE o.id=NEW.outcome_message_id AND o.id<>m.id AND o.channel_id=NEW.channel_id AND o.author_kind='agent'
    AND o.agent_key=m.agent_key AND o.author_user_id=NEW.approver_user_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_CARD_SCOPE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_card_scope_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER team_hub_card_scope BEFORE INSERT OR UPDATE OF message_id, tenant_id, channel_id,
 approver_user_id, confirmation_id, tool_name, outcome_message_id
 ON public.team_hub_message_cards FOR EACH ROW EXECUTE FUNCTION public._team_hub_card_scope_guard();

-- ── C. Acceptance (20271119010008, plus A2b, marked) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.team_hub_accept_agent_turn(p_tenant uuid, p_asker uuid, p_channel_id uuid,
 p_source_message_id uuid, p_agent_key text, p_intent text, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ch public.team_hub_channels; src public.team_hub_messages; turn public.team_hub_agent_turns; used bigint;
 existing boolean;
 card public.team_hub_message_cards; -- A2b
BEGIN
 IF auth.uid() IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF p_tenant IS NULL OR p_asker IS NULL OR p_channel_id IS NULL OR p_source_message_id IS NULL
   OR p_agent_key IS NULL OR p_agent_key NOT IN ('paige','vera','nexus','cura','mentor','merit','zion')
   -- A2b: or 'outcome:<card message id>', the turn that posts one card's outcome.
   OR p_intent IS NULL OR (p_intent NOT IN ('reply','dm')
    AND p_intent !~ '^outcome:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
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
 ELSIF p_intent~'^outcome:' THEN
  -- A2b: the card is in the asker's own DM with this agent, they decided it 'approved', its outcome is
  -- settled, and the source is the asking message of the turn that posted the card. Posted once.
  SELECT * INTO card FROM public.team_hub_message_cards k WHERE k.message_id=substr(p_intent,9)::uuid
   AND k.tenant_id=p_tenant AND k.channel_id=ch.id;
  IF NOT FOUND OR ch.kind<>'agent_dm' OR ch.agent_key<>p_agent_key OR ch.created_by<>p_asker
    OR card.approver_user_id<>p_asker OR card.decision IS DISTINCT FROM 'approved' OR card.outcome IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.team_hub_agent_turns o WHERE o.posted_message_id=card.message_id
     AND o.asker_user_id=p_asker AND o.source_message_id=src.id) THEN
   RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
  IF card.outcome_message_id IS NOT NULL THEN
   RETURN jsonb_build_object('ok',false,'code','duplicate','message_id',card.outcome_message_id); END IF;
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
   RETURN jsonb_build_object('ok',true,'turn_id',turn.id,'repeated',true,'accepted_at',turn.accepted_at); END IF; -- A2b: accepted_at
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
  RETURN jsonb_build_object('ok',true,'turn_id',turn.id,'rearmed',true,'accepted_at',now()); -- A2b: accepted_at
 END IF;
 INSERT INTO public.team_hub_agent_turns(tenant_id,channel_id,asker_user_id,source_message_id,agent_key,intent,token_hash,
  accepted_at,attempts)
  VALUES (p_tenant,ch.id,p_asker,src.id,p_agent_key,p_intent,p_token_hash,now(),ARRAY[now()]) RETURNING * INTO turn;
 RETURN jsonb_build_object('ok',true,'turn_id',turn.id,'accepted_at',turn.accepted_at); -- A2b: accepted_at
END $$;
REVOKE ALL ON FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text) TO service_role;

-- ── D. The post door (20271117010008, plus A2b, marked) ──────────────────────────────────────────
-- DROP and recreate: the signature grows by four defaulted arguments. Its one caller (agent-turn.ts)
-- calls it by name, so every existing call still resolves with the four defaulting to none.
DROP FUNCTION IF EXISTS public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean);
CREATE OR REPLACE FUNCTION public.team_hub_post_agent_message(p_expected_tenant uuid, p_channel_id uuid, p_agent_key text,
 p_body text, p_client_request_id uuid, p_parent_message_id uuid, p_asked_in_message_id uuid, p_intent text,
 p_turn_token text, p_private_answer boolean DEFAULT false,
 p_confirmation_id uuid DEFAULT NULL, p_card_kind text DEFAULT NULL, p_card_outcome jsonb DEFAULT NULL,
 p_card_summary text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
 turn public.team_hub_agent_turns; src public.team_hub_messages; msg public.team_hub_messages; hashed text;
 body text:=coalesce(public._team_hub_trim(p_body),'');
 private_line constant text:='That part is just for you, so I''m answering it in our DM.';
 -- A2b: the proposal a 'dm' post links, or the card an 'outcome:<card>' post answers, and that card's thread.
 conf public.paige_pending_confirmations; card public.team_hub_message_cards; card_root uuid;
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
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true)
   -- A2b: and the card it links, if it links one.
   || CASE WHEN EXISTS(SELECT 1 FROM public.team_hub_message_cards k WHERE k.message_id=msg.id)
    THEN jsonb_build_object('card',jsonb_build_object('message_id',msg.id)) ELSE '{}'::jsonb END;
 END IF;
 SELECT * INTO src FROM public.team_hub_messages m WHERE m.id=turn.source_message_id;
 -- A2b: an outcome post answers in its card's thread and links to no asking message (the card itself
 -- already answers it); it carries no proposal and no private line. Every other post keeps the rule below.
 IF p_intent~'^outcome:' THEN
  IF src.deleted_at IS NOT NULL OR p_private_answer OR p_confirmation_id IS NOT NULL OR p_card_kind IS NOT NULL
    OR p_card_summary IS NOT NULL THEN
   RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  SELECT * INTO card FROM public.team_hub_message_cards k WHERE k.message_id=substr(p_intent,9)::uuid
   AND k.tenant_id=p_expected_tenant AND k.channel_id=ch.id FOR UPDATE;
  IF NOT FOUND OR card.approver_user_id<>actor OR card.decision IS DISTINCT FROM 'approved'
    OR card.outcome IS NULL
    OR card.outcome_message_id IS NOT NULL
    OR (p_card_outcome IS NOT NULL AND (jsonb_typeof(p_card_outcome)<>'object' OR p_card_outcome->>'state' IS DISTINCT FROM card.outcome)) THEN
   RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  SELECT coalesce(m.parent_message_id,m.id) INTO card_root FROM public.team_hub_messages m WHERE m.id=card.message_id;
  IF p_asked_in_message_id IS NOT NULL OR p_parent_message_id IS DISTINCT FROM card_root THEN
   RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 ELSE
 -- Where the reply goes. A reply answers where it was asked: a thread question in its thread, a
 -- top-level question at the top level, linked to it (owner ruling 2026-10-27, Q2). An answer in the
 -- agent DM links to the asking message only when that message is in the DM itself.
 IF src.deleted_at IS NOT NULL
   OR p_asked_in_message_id IS DISTINCT FROM (CASE WHEN src.channel_id=ch.id THEN src.id END)
   OR p_parent_message_id IS DISTINCT FROM (CASE WHEN src.channel_id=ch.id THEN src.parent_message_id END) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  -- A2b: a 'dm' post in the agent DM may link one proposal: the caller's own, in this workspace, outside
  -- any chat thread and client focus, still live, minted in THIS turn (never one an earlier turn or
  -- another surface left waiting), for a card tool in this agent's stored DM scope, and linked nowhere yet.
  -- Its sentence, when given, goes only with a link, and is 1 to 280 characters once trimmed.
  IF p_card_outcome IS NOT NULL OR (p_card_summary IS NOT NULL AND (p_confirmation_id IS NULL
    OR char_length(coalesce(public._team_hub_trim(p_card_summary),'')) NOT BETWEEN 1 AND 280)) THEN
   RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  IF p_confirmation_id IS NOT NULL OR p_card_kind IS NOT NULL THEN
   IF p_confirmation_id IS NULL OR p_card_kind IS NULL OR p_intent<>'dm' OR ch.kind<>'agent_dm' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
   SELECT * INTO conf FROM public.paige_pending_confirmations p WHERE p.id=p_confirmation_id AND p.user_id=actor
    AND p.tenant_id=p_expected_tenant
    AND p.thread_id IS NULL
    AND p.scoped_client_id IS NULL AND p.consumed_at IS NULL AND p.expires_at>now()
    AND p.server_issued_at IS NOT NULL AND p.server_issued_at>=turn.accepted_at
    FOR UPDATE;
   IF NOT FOUND
     OR (conf.tool_name,p_card_kind) NOT IN (('crm_assign_task','task_handover'),('crm_cancel_task','task_cancel'),
      ('growth_page_publish','page_publish'))
     OR NOT (CASE WHEN ch.agent_key='paige' THEN conf.tool_name IN ('ask_choices','capability_status','read_business_time_zone',
       'team_hub_read_conversation','crm_list_tasks','crm_get_task','crm_list_team','growth_list',
       'crm_assign_task','crm_cancel_task','growth_page_publish')
      ELSE EXISTS(SELECT 1 FROM public.paige_subagents a WHERE a.slug=ch.agent_key AND a.tenant_id IS NULL
       AND a.config->'capability_scope'->>'access'='card' AND (a.config->'capability_scope'->'tools') ? conf.tool_name) END)
     OR EXISTS(SELECT 1 FROM public.team_hub_message_cards k WHERE k.confirmation_id=conf.id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  END IF;
 END IF;
 IF p_private_answer THEN body:=btrim(body||E'\n\n'||private_line, E' \t\r\n'); END IF;
 IF body='' THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF char_length(body)>8000 THEN RETURN jsonb_build_object('ok',false,'code','too_long'); END IF;
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,parent_message_id,client_request_id,
  author_kind,agent_key,asked_in_message_id)
  VALUES (p_expected_tenant,ch.id,actor,body,p_parent_message_id,p_client_request_id,'agent',p_agent_key,p_asked_in_message_id)
  ON CONFLICT DO NOTHING RETURNING * INTO msg;
 IF msg.id IS NULL THEN
  -- A2b: a card or an outcome is recorded only on a row this post writes itself.
  IF conf.id IS NOT NULL OR card.message_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  -- Already stored: under this request id (an earlier attempt of this same post), or by the one-reply
  -- rule (this agent already answered this message). Return that row; never another person's or agent's.
  SELECT * INTO msg FROM public.team_hub_messages m WHERE m.author_user_id=actor AND m.client_request_id=p_client_request_id;
  IF NOT FOUND THEN
   SELECT * INTO msg FROM public.team_hub_messages m WHERE m.author_kind='agent' AND m.agent_key=p_agent_key
    AND m.asked_in_message_id=p_asked_in_message_id AND m.channel_id=ch.id;
  END IF;
  -- The row must also answer THIS turn's question in THIS place: a request id reused for another
  -- question by the same agent is refused, never bound to the turn as if it were its reply. A row
  -- another turn already posted is that turn's reply, never this one's: two DM questions asked
  -- elsewhere both answer in the agent DM unlinked, so place and link alone cannot tell them apart.
  IF NOT FOUND OR msg.author_user_id<>actor OR msg.author_kind<>'agent' OR msg.agent_key<>p_agent_key
    OR msg.channel_id<>ch.id
    OR EXISTS(SELECT 1 FROM public.team_hub_agent_turns o WHERE o.posted_message_id=msg.id AND o.id<>turn.id)
    OR msg.asked_in_message_id IS DISTINCT FROM p_asked_in_message_id
    OR msg.parent_message_id IS DISTINCT FROM p_parent_message_id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  UPDATE public.team_hub_agent_turns t SET consumed_at=now(), posted_message_id=msg.id WHERE t.id=turn.id;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
 END IF;
 UPDATE public.team_hub_agent_turns t SET consumed_at=now(), posted_message_id=msg.id WHERE t.id=turn.id;
 -- A2b: the card link, or the outcome post recorded on its card, in the same transaction as the post.
 IF conf.id IS NOT NULL THEN
  INSERT INTO public.team_hub_message_cards(message_id,tenant_id,channel_id,approver_user_id,confirmation_id,tool_name,kind,summary)
   VALUES (msg.id,p_expected_tenant,ch.id,actor,conf.id,conf.tool_name,p_card_kind,public._team_hub_trim(p_card_summary));
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'card',jsonb_build_object('message_id',msg.id));
 END IF;
 IF card.message_id IS NOT NULL THEN
  UPDATE public.team_hub_message_cards k SET outcome_message_id=msg.id WHERE k.message_id=card.message_id;
 END IF;
 RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg));
END $$;
REVOKE ALL ON FUNCTION public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text) TO authenticated;

-- ── E. Approve or Not now (the approver only) ────────────────────────────────────────────────────
-- Under the approver's JWT. Lock order: the card, then its proposal (the same order as settle, so the two
-- never wait on each other). Not now consumes the proposal (consumed_at, the one claim fact every door
-- reads, so no door can run it afterwards) and stores 'declined'. Approve stores the decision only: the
-- door's own compare-and-set claim runs the stored call next, under the same JWT. A second decision
-- returns the first.
CREATE OR REPLACE FUNCTION public.team_hub_decide_card(p_expected_tenant uuid, p_message_id uuid, p_decision text, p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); card public.team_hub_message_cards;
 conf public.paige_pending_confirmations;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 IF p_message_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('approve','decline')
   OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{16}$' THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT * INTO card FROM public.team_hub_message_cards k WHERE k.message_id=p_message_id AND k.tenant_id=p_expected_tenant FOR UPDATE;
 IF NOT FOUND
   OR NOT EXISTS(SELECT 1 FROM public._team_hub_visible(p_expected_tenant,actor,card.channel_id))
   OR NOT EXISTS(SELECT 1 FROM public.team_hub_messages m WHERE m.id=card.message_id AND m.deleted_at IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF card.approver_user_id<>actor THEN RETURN jsonb_build_object('ok',false,'code','not_yours'); END IF;
 IF card.decision IS NOT NULL THEN
  RETURN jsonb_build_object('ok',true,'already',true,'decision',card.decision,'outcome',card.outcome,
   'confirmation_id',card.confirmation_id,'decided_at',card.decided_at); END IF;
 SELECT * INTO conf FROM public.paige_pending_confirmations p WHERE p.id=card.confirmation_id AND p.user_id=actor
  AND p.tenant_id=p_expected_tenant AND p.thread_id IS NULL AND p.fingerprint=p_fingerprint FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- Redeemed somewhere else first (a direct door call): it can no longer be decided here.
 IF conf.consumed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','already_decided'); END IF;
 IF conf.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','expired'); END IF;
 IF p_decision='decline' THEN
  UPDATE public.paige_pending_confirmations p SET consumed_at=clock_timestamp() WHERE p.id=conf.id AND p.consumed_at IS NULL;
  UPDATE public.team_hub_message_cards k SET decision='declined', decided_at=clock_timestamp() WHERE k.message_id=card.message_id;
  RETURN jsonb_build_object('ok',true,'decision','declined','confirmation_id',card.confirmation_id);
 END IF;
 UPDATE public.team_hub_message_cards k SET decision='approved', decided_at=clock_timestamp() WHERE k.message_id=card.message_id;
 RETURN jsonb_build_object('ok',true,'decision','approved','confirmation_id',card.confirmation_id);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_decide_card(uuid,uuid,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_decide_card(uuid,uuid,text,text) TO authenticated;

-- ── F. The outcome, recorded before anything is posted (the approver only, once) ─────────────────
-- p_outcome: {"state":"done"|"failed"|"unconfirmed", "note"?: up to 280 characters,
-- "record"?: {"destination": <a link destination key>, "record_id": <uuid>}} (a record only with done).
-- 'failed' means the door reported nothing ran; if the proposal is still live it is consumed here, in the
-- same transaction, so nothing can run it later.
-- SERVICE ROLE ONLY (Codex P1 on #3041): an outcome is the server's record of what the door actually did,
-- written by card-act after it ran the door, never something the approver asserts with their own JWT. As
-- in team_hub_accept_agent_turn, auth.uid() is null here, so the approver is the one passed in (§59: the
-- only place a passed actor is honoured), and the edge function passes the user it verified from the JWT.
-- Every approver check below is re-run against that user.
CREATE OR REPLACE FUNCTION public.team_hub_settle_card(p_expected_tenant uuid, p_actor uuid, p_message_id uuid, p_outcome jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=p_actor; card public.team_hub_message_cards;
 state text; note text; rec jsonb;
BEGIN
 -- A request that carries a user's JWT is never the server settling (as team_hub_accept_agent_turn).
 IF auth.uid() IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF p_expected_tenant IS NULL OR actor IS NULL OR NOT public._team_hub_is_active(p_expected_tenant, actor) THEN
  RETURN jsonb_build_object('ok',false,'code','not_member'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_expected_tenant
   AND t.account_type='standalone' AND t.parent_tenant_id IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','unavailable'); END IF;
 IF NOT public._team_hub_participates(p_expected_tenant, actor) THEN
  RETURN jsonb_build_object('ok',false,'code','conversations_off'); END IF;
 IF p_message_id IS NULL OR p_outcome IS NULL OR jsonb_typeof(p_outcome)<>'object'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_outcome) x(k) WHERE x.k NOT IN ('state','note','record'))
   OR jsonb_typeof(p_outcome->'state') IS DISTINCT FROM 'string' OR p_outcome->>'state' NOT IN ('done','failed','unconfirmed')
   OR (p_outcome ? 'note' AND jsonb_typeof(p_outcome->'note') NOT IN ('string','null'))
   OR (p_outcome ? 'record' AND jsonb_typeof(p_outcome->'record') NOT IN ('object','null')) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 state:=p_outcome->>'state';
 note:=nullif(public._team_hub_trim(p_outcome->>'note'),'');
 rec:=CASE WHEN jsonb_typeof(p_outcome->'record')='object' THEN p_outcome->'record' END;
 IF (note IS NOT NULL AND char_length(note)>280)
   OR (rec IS NOT NULL AND (state<>'done' OR (rec - 'destination' - 'record_id')<>'{}'::jsonb
    OR jsonb_typeof(rec->'destination') IS DISTINCT FROM 'string' OR rec->>'destination' !~ '^[a-z][a-z0-9_]{0,63}$'
    OR jsonb_typeof(rec->'record_id') IS DISTINCT FROM 'string'
    OR rec->>'record_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT * INTO card FROM public.team_hub_message_cards k WHERE k.message_id=p_message_id AND k.tenant_id=p_expected_tenant FOR UPDATE;
 IF NOT FOUND
   OR NOT EXISTS(SELECT 1 FROM public._team_hub_visible(p_expected_tenant,actor,card.channel_id))
   OR NOT EXISTS(SELECT 1 FROM public.team_hub_messages m WHERE m.id=card.message_id AND m.deleted_at IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF card.approver_user_id<>actor THEN RETURN jsonb_build_object('ok',false,'code','not_yours'); END IF;
 IF card.decision IS DISTINCT FROM 'approved' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF card.outcome IS NOT NULL THEN
  RETURN jsonb_build_object('ok',true,'already',true,'outcome',card.outcome,'note',card.outcome_note); END IF;
 IF state='failed' THEN
  UPDATE public.paige_pending_confirmations p SET consumed_at=clock_timestamp() WHERE p.id=card.confirmation_id
   AND p.user_id=actor AND p.tenant_id=p_expected_tenant AND p.thread_id IS NULL AND p.consumed_at IS NULL;
 END IF;
 UPDATE public.team_hub_message_cards k SET outcome=state, outcome_note=note, outcome_record=rec, settled_at=clock_timestamp()
  WHERE k.message_id=card.message_id;
 RETURN jsonb_build_object('ok',true,'outcome',state);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_settle_card(uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_settle_card(uuid,uuid,uuid,jsonb) TO service_role;

-- ── G. The member-safe card read ─────────────────────────────────────────────────────────────────
-- For the cards on the given messages of a conversation the caller can see now. Never the proposal's
-- arguments. The fingerprint (what Approve sends) only to the approver, and only while waiting. The action's
-- sentence is the card's own (written at prepare) or else the door's; a done or failed card also carries
-- the server's outcome note (what now exists, or why it didn't run).
-- state: declined | done | failed | unconfirmed | working (approved, outcome not yet settled, for up to
-- 10 minutes, as a turn is taken as ended after 10) | expired (undecided and the proposal is gone, past
-- its own expiry, or the approver's seat is no longer active) | waiting. An undecided card whose proposal
-- was consumed somewhere else reads unconfirmed: it may have run outside Team Hub.
CREATE OR REPLACE FUNCTION public.team_hub_card_states(p_expected_tenant uuid, p_channel_id uuid, p_message_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels; cards jsonb;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF p_message_ids IS NULL OR cardinality(p_message_ids)>100 OR array_position(p_message_ids,NULL) IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('message_id',s.message_id,
   'card',jsonb_build_object('state',s.state,'kind',s.kind,
    'actions',jsonb_build_array(jsonb_build_object('summary',s.summary)
     || CASE WHEN s.approver_user_id=actor AND s.state='waiting' THEN jsonb_build_object('fingerprint',s.fingerprint) ELSE '{}'::jsonb END
     || CASE WHEN s.state IN ('done','failed') AND s.outcome_note IS NOT NULL THEN jsonb_build_object('note',s.outcome_note) ELSE '{}'::jsonb END),
    'asker_user_id',s.approver_user_id,
    'decided_by_name',CASE WHEN s.decision IS NULL THEN NULL WHEN s.approver_active
     THEN coalesce(nullif(btrim(pr.full_name),''),'Teammate') ELSE 'Former teammate' END,
    'decided_at',s.decided_at,'expires_at',s.expires_at),
   'outcome_message_id',s.outcome_message_id,'record',s.outcome_record)
   ORDER BY s.message_id),'[]'::jsonb) INTO cards
 FROM (
  SELECT k.message_id, k.kind, k.approver_user_id, k.decision, k.decided_at, k.outcome_message_id, k.outcome_record,
   k.outcome_note, coalesce(k.summary,p.summary) AS summary, p.fingerprint, p.expires_at, a.active AS approver_active,
   CASE WHEN k.decision='declined' THEN 'declined'
    WHEN k.decision='approved' THEN CASE WHEN k.outcome IS NOT NULL THEN k.outcome
     WHEN k.decided_at>now()-interval '10 minutes' THEN 'working' ELSE 'unconfirmed' END
    WHEN NOT a.active OR p.id IS NULL THEN 'expired'
    WHEN p.consumed_at IS NOT NULL THEN 'unconfirmed'
    WHEN p.expires_at<=now() THEN 'expired'
    ELSE 'waiting' END AS state
  FROM public.team_hub_message_cards k
  JOIN public.team_hub_messages m ON m.id=k.message_id AND m.channel_id=ch.id AND m.tenant_id=p_expected_tenant AND m.deleted_at IS NULL
  LEFT JOIN public.paige_pending_confirmations p ON p.id=k.confirmation_id AND p.user_id=k.approver_user_id
   AND p.tenant_id=k.tenant_id AND p.thread_id IS NULL
  CROSS JOIN LATERAL (SELECT public._team_hub_is_active(k.tenant_id,k.approver_user_id) AS active) a
  WHERE k.message_id=ANY(p_message_ids) AND k.channel_id=ch.id AND k.tenant_id=p_expected_tenant
 ) s
 LEFT JOIN public.profiles pr ON pr.user_id=s.approver_user_id;
 RETURN jsonb_build_object('ok',true,'cards',cards);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_card_states(uuid,uuid,uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_card_states(uuid,uuid,uuid[]) TO authenticated;

-- ── H. A10: the new table goes with the account at retirement, like every Team Hub table ──────────
DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer; BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=position(anchor IN body);
 IF position('''team_hub_message_cards''' IN body)>0 THEN RETURN; END IF;
 IF at=0 OR position('''team_hub_message_broadcast_recipients''' IN body)=0 THEN
  RAISE EXCEPTION 'Canonical retirement policy requires reconciliation before registering Team Hub cards'; END IF;
 EXECUTE left(body,at+length(anchor)-1)||'''team_hub_message_cards'','
  ||substr(body,at+length(anchor));
END $$;

-- ── I. The roster: ZION and NEXUS may Prepare their A2b card tools in a DM ───────────────────────
-- Guarded on each row's exact stored version 1 scope (20271117010108), so a customised or tenant row is
-- never overwritten; version 2 keeps every version 1 tool and adds the card tools. A config change is a
-- new version of the row. A row that is present but carries neither scope stops the file (reconcile).
UPDATE public.paige_subagents a SET
  config = jsonb_set(a.config, '{capability_scope}', s.v2),
  version = a.version + 1,
  updated_at = statement_timestamp()
FROM (VALUES
 ('zion', $j${"version": 1, "mode": "allowlist", "access": "read", "tools": ["ask_choices", "capability_status", "read_business_time_zone", "team_hub_read_conversation", "crm_list_tasks", "crm_get_task", "plan_list", "read_weekly_commitment_status", "read_calendar_agenda", "read_calendar_booking", "crm_list_team"]}$j$::jsonb,
  $j${"version": 2, "mode": "allowlist", "access": "card", "tools": ["ask_choices", "capability_status", "read_business_time_zone", "team_hub_read_conversation", "crm_list_tasks", "crm_get_task", "plan_list", "read_weekly_commitment_status", "read_calendar_agenda", "read_calendar_booking", "crm_list_team", "crm_assign_task", "crm_cancel_task"]}$j$::jsonb),
 ('nexus', $j${"version": 1, "mode": "allowlist", "access": "read", "tools": ["ask_choices", "capability_status", "read_business_time_zone", "team_hub_read_conversation", "growth_list", "campaign_brief_list", "read_campaign_leads"]}$j$::jsonb,
  $j${"version": 2, "mode": "allowlist", "access": "card", "tools": ["ask_choices", "capability_status", "read_business_time_zone", "team_hub_read_conversation", "growth_list", "campaign_brief_list", "read_campaign_leads", "growth_page_publish"]}$j$::jsonb)
) AS s(slug, v1, v2)
WHERE a.slug = s.slug AND a.tenant_id IS NULL AND a.config->'capability_scope' = s.v1;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.paige_subagents a WHERE a.tenant_id IS NULL AND a.slug IN ('zion','nexus')
   AND (a.config->'capability_scope'->>'version' IS DISTINCT FROM '2' OR a.config->'capability_scope'->>'access' IS DISTINCT FROM 'card'
    OR NOT ((a.config->'capability_scope'->'tools') ?& CASE a.slug WHEN 'zion' THEN ARRAY['crm_assign_task','crm_cancel_task']
     ELSE ARRAY['growth_page_publish'] END))) THEN
  RAISE EXCEPTION 'Team Hub A2b: the ZION or NEXUS platform row does not read back its version 2 scope; reconcile before applying' USING ERRCODE='23514';
 END IF;
END $$;
COMMIT;
