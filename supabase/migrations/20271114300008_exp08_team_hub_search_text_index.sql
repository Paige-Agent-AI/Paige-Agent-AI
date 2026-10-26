-- EXP08 Team Hub: rare-word search, indexed. Owner ruling 2026-10-25
-- (docs/brain/decision-log.md, "EXP08 Team Hub owner rulings"), measured in the AWS assessment
-- (Linear ANT-161, 2026-10-25). Same refusals, visibility, ordering, limit and output.
--   1. team_hub_messages_body_trgm_ascii_idx: a pg_trgm GIN index on team_hub_messages.body, for
--      bodies that are plain ASCII only. The owner approved it on 2026-10-25, amending the 2026-10-24
--      "nothing indexed" exclusion for this index only. It stores trigrams of message text inside
--      Postgres, read only by the planner on the same definer path; nothing leaves the database and no
--      embedding or copy is made.
--      WHY ONLY ASCII: ILIKE folds case one character at a time, the trigram index folds the whole string.
--      Under production's ICU collation those disagree for some text (a Greek final sigma, for one), so
--      a trigram index over every body would silently miss real matches. For an ASCII query against an
--      ASCII body they agree under every collation. team_hub_search is re-emitted to use the index only
--      there; non-ASCII bodies are read newest first through team_hub_messages_tenant_time_nonascii_idx,
--      and a non-ASCII query takes exactly the scan it took before. The two halves partition the bodies,
--      so the result is the same set, in the same order.
--      WHY A REGEX: "plain ASCII" is written body ~ '^[\x01-\x7f]*$' (text holds no NUL, so this is
--      exactly octet_length = char_length). Postgres estimates a regex from the column's histogram but
--      has no estimate at all for octet_length(body)=char_length(body), and that default guess (0.5%)
--      sent common words through the trigram index to sort every match (measured: 64 ms became 261 ms
--      at 200k messages). With the regex a common word walks the newest messages and stops at the limit.
--   2. The parent check for a reply is a scalar subquery instead of EXISTS, in all three branches.
--      Same answer (id is the primary key), but EXISTS was planned as a hash of every live message, a
--      full read of the table on each search of a common word. That was the cost of the shipped search
--      too: 64 ms for "status" at 200k messages, 1.3 ms now.
--   3. team_hub_search plans each call afresh (plan_cache_mode=force_custom_plan, on this function only).
--      plpgsql caches its query plans per connection, and after five calls Postgres may switch to one
--      generic plan that cannot see the search word or the limit. Measured: after a few hundred
--      searches on one connection, a rare word took that generic plan and read all 204k messages
--      (260 ms instead of 2 ms). Planning each call costs well under a millisecond.
--   The owner also approved a partial index on paige_workspace_events for the per-turn Team Hub check.
--   It is NOT built: that check runs through PostgREST prepared statements, and after five executions
--   Postgres moved it to a generic plan that cannot prove a partial predicate from parameters, so the
--   index went unused (measured in the proof database, 2026-10-25). See docs/brain/decision-log.md.
-- Rollback: re-emit team_hub_search from 20271114250008 and drop the two indexes.

BEGIN;
SET LOCAL lock_timeout = '2s';

-- pg_trgm is already installed on production (schema public). A fresh database gets it in public.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
DO $do$
DECLARE trgm_schema text;
BEGIN
 SELECT n.nspname INTO trgm_schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm';
 EXECUTE format('CREATE INDEX IF NOT EXISTS team_hub_messages_body_trgm_ascii_idx ON public.team_hub_messages '
  'USING gin (body %I.gin_trgm_ops) WHERE body ~ ''^[\x01-\x7f]*$''', trgm_schema);
END $do$;
CREATE INDEX IF NOT EXISTS team_hub_messages_tenant_time_nonascii_idx
 ON public.team_hub_messages (tenant_id, created_at DESC, id DESC) WHERE body !~ '^[\x01-\x7f]*$';

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
   'conversation_label',CASE WHEN h.kind<>'dm' THEN h.name
    WHEN public._team_hub_is_active(p_expected_tenant,h.dm_user_id) THEN coalesce(nullif(btrim(dp.full_name),''),'Teammate')
    ELSE 'Former teammate' END,
   'thread_root_id',h.parent_message_id,
   'author_name',CASE WHEN public._team_hub_is_active(p_expected_tenant,h.author_user_id)
    THEN coalesce(nullif(btrim(ap.full_name),''),'Teammate') ELSE 'Former teammate' END,
   'created_at',h.created_at,
   'snippet',public._team_hub_search_snippet(h.body,q))
   ORDER BY h.created_at DESC, h.id DESC),'[]'::jsonb) INTO results
 FROM (SELECT m.id, m.channel_id, m.parent_message_id, m.author_user_id, m.body, m.created_at, c.kind, c.name,
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

COMMIT;
