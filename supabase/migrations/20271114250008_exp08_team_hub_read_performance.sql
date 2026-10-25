-- EXP08 Team Hub: read and search that cost the page, not the workspace.
-- Measured on the real migrations at 1M messages with production's planner settings
-- (Linear ANT-161, 2026-10-25 AWS assessment; contract docs/delivery/exp08-team-hub-increment4-paige-contract.md):
--   team_hub_list_messages, newest 30: 0.75-1.6 s -> 2-3 ms. Two causes, both fixed: row_number()
--   ran inside the LIMITed query, so every message was turned into JSON before 30 were kept; and
--   `parent_message_id IS NOT DISTINCT FROM` (or IS NULL) gave the planner no usable index order.
--   team_hub_search: 4.3-4.8 s -> 2-4 ms for a common word, ~1.8 s for a rare one. Visibility is
--   now resolved once per call instead of once per row, and messages are read newest first.
-- Behaviour is unchanged: the same refusals, visibility rules, ordering, page size, has_more, labels
-- and output. Both functions keep their signatures and privileges. The two indexes are btree indexes
-- over ids and times only: no message text is indexed (owner ruling 2026-10-24, "nothing indexed").
-- Rollback: re-emit the previous bodies (20271113850008, 20271114240008) and drop the two indexes.
-- One transaction with a short lock timeout, like its siblings: CREATE INDEX takes a SHARE lock on
-- team_hub_messages, and it must give up rather than queue posts behind a long-open writer.

BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE INDEX IF NOT EXISTS team_hub_messages_top_stream_idx
 ON public.team_hub_messages (channel_id, created_at DESC, id DESC) WHERE parent_message_id IS NULL;
CREATE INDEX IF NOT EXISTS team_hub_messages_tenant_time_idx
 ON public.team_hub_messages (tenant_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.team_hub_list_messages(p_expected_tenant uuid, p_channel_id uuid,
 p_thread_root uuid DEFAULT NULL, p_before timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
 root public.team_hub_messages; lim int:=greatest(1,least(100,coalesce(p_limit,50))); messages jsonb; has_more boolean;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF (p_before IS NULL)<>(p_before_id IS NULL) THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF p_thread_root IS NOT NULL THEN
  SELECT * INTO root FROM public.team_hub_messages m
   WHERE m.id=p_thread_root AND m.channel_id=ch.id AND m.parent_message_id IS NULL AND m.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 END IF;
 -- One page per mode, each a plain index-ordered scan: the newest page is taken first and only then
 -- turned into JSON and numbered, so the cost is the page, not the conversation.
 IF root.id IS NULL THEN
  SELECT coalesce(jsonb_agg(public._team_hub_message_json(p) ORDER BY p.created_at DESC, p.id DESC),'[]'::jsonb) INTO messages
  FROM (SELECT m.* FROM public.team_hub_messages m
   WHERE m.channel_id=ch.id AND m.parent_message_id IS NULL AND m.deleted_at IS NULL
    AND (p_before IS NULL OR (m.created_at,m.id)<(p_before,p_before_id))
   ORDER BY m.created_at DESC, m.id DESC LIMIT lim) p;
  has_more:=EXISTS(SELECT 1 FROM public.team_hub_messages m
   WHERE m.channel_id=ch.id AND m.parent_message_id IS NULL AND m.deleted_at IS NULL
    AND (p_before IS NULL OR (m.created_at,m.id)<(p_before,p_before_id)) OFFSET lim);
 ELSE
  SELECT coalesce(jsonb_agg(public._team_hub_message_json(p) ORDER BY p.created_at DESC, p.id DESC),'[]'::jsonb) INTO messages
  FROM (SELECT m.* FROM public.team_hub_messages m
   WHERE m.channel_id=ch.id AND m.parent_message_id=root.id AND m.deleted_at IS NULL
    AND (p_before IS NULL OR (m.created_at,m.id)<(p_before,p_before_id))
   ORDER BY m.created_at DESC, m.id DESC LIMIT lim) p;
  has_more:=EXISTS(SELECT 1 FROM public.team_hub_messages m
   WHERE m.channel_id=ch.id AND m.parent_message_id=root.id AND m.deleted_at IS NULL
    AND (p_before IS NULL OR (m.created_at,m.id)<(p_before,p_before_id)) OFFSET lim);
 END IF;
 RETURN jsonb_build_object('ok',true,'channel',jsonb_build_object('id',ch.id,'kind',ch.kind,'name',ch.name,
   'visibility',ch.visibility,'joined',EXISTS(SELECT 1 FROM public.team_hub_channel_members x
    WHERE x.channel_id=ch.id AND x.user_id=actor)),
  'messages',messages,'has_more',has_more)
  || CASE WHEN root.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('root',public._team_hub_message_json(root)) END;
END $$;
REVOKE ALL ON FUNCTION public.team_hub_list_messages(uuid,uuid,uuid,timestamptz,uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_list_messages(uuid,uuid,uuid,timestamptz,uuid,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.team_hub_search(p_expected_tenant uuid, p_query text, p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant);
 q text:=public._team_hub_trim(p_query); pattern text; lim int:=greatest(1,least(20,coalesce(p_limit,20))); results jsonb; visible uuid[];
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 IF q IS NULL OR char_length(q)<2 OR char_length(q)>200 THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- The conversations the asker can see now, resolved once per call rather than once per message.
 visible:=ARRAY(SELECT c.id FROM public.team_hub_channels c WHERE c.tenant_id=p_expected_tenant
  AND EXISTS(SELECT 1 FROM public._team_hub_visible(p_expected_tenant,actor,c.id)));
 -- A literal: the escape character first, then the two wildcards.
 pattern:='%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%';
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
  WHERE m.tenant_id=p_expected_tenant AND m.channel_id=ANY(visible)
   AND m.deleted_at IS NULL
   AND (m.parent_message_id IS NULL OR EXISTS(SELECT 1 FROM public.team_hub_messages r
    WHERE r.id=m.parent_message_id AND r.deleted_at IS NULL))
   AND m.body ILIKE pattern ESCAPE '\'
  ORDER BY m.created_at DESC, m.id DESC LIMIT lim) h
 LEFT JOIN public.profiles ap ON ap.user_id=h.author_user_id
 LEFT JOIN public.profiles dp ON dp.user_id=h.dm_user_id;
 RETURN jsonb_build_object('ok',true,'results',results);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_search(uuid,text,int) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_search(uuid,text,int) TO authenticated;

COMMIT;
