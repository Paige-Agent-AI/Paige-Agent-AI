-- EXP08 Team Hub increment 4: one read-only search door over the conversations the asker can see
-- now. Contract: docs/delivery/exp08-team-hub-increment4-paige-contract.md, section 4. Owner
-- decision: docs/brain/decision-log.md, "EXP08 Team Hub increment 4, PAIGE with Team Hub".
-- Additive only: no table, column, index, trigger, policy or storage, and no retirement entry (A10
-- registers tables, and this adds none). Nothing is stored, indexed or embedded; the search is a
-- bounded scan of the messages in the asker's visible conversations, which is honestly slower than
-- an index at scale, because an index or embedding would store content the owner excluded.
-- The caller is re-checked in the body (§59), in the contract's order:
--   1. public._team_hub_refusal(p_expected_tenant), returned as is. It requires an active seat in
--      the workspace current_user_tenant_id() resolves, a canonical SOLO account, and that the
--      expected tenant is that workspace. p_expected_tenant is a fence, never a selector.
--   2. Only conversations that pass public._team_hub_visible for auth.uid() now: in the
--      workspace, not archived, and team-visible or the caller is a member. A removed member, a
--      non-member of a private channel and the third party to a DM find nothing there.
--   3. Only messages that are not deleted (deleted_at IS NULL), and no reply whose thread root is
--      deleted, since team_hub_list_messages cannot open that thread either.
-- Matching is a literal, case-insensitive substring of the body: \ % and _ in the query are
-- escaped and ILIKE uses ESCAPE '\', so the query is never a pattern. The query is trimmed with the
-- same whitespace rule as a message body and must be 2..200 characters, otherwise
-- {"ok":false,"code":"invalid"}. The limit is clamped to 1..20. Newest first, (created_at, id).
-- Each result carries the message and conversation ids, a conversation label (the channel name, or
-- for a DM the other person's display name, both exactly as team_hub_list_conversations derives
-- them), the thread root (the parent message id for a reply, null for a top-level message), the
-- author's display name, the time, and a snippet of at most 240 characters around the first match.
-- Never an email, a storage path or a file name. Every grant is explicit: Supabase's default
-- privileges hand new functions to anon and authenticated, and this file revokes them.
-- Forward-only and replay-safe: a second apply changes nothing.
BEGIN;
SET LOCAL lock_timeout = '2s';

-- Internal: at most 240 characters of the body, around the first case-insensitive match. A body
-- of 240 or fewer is returned whole. A longer one is a 240-character window with the match
-- centred where it fits; a cut end is marked with an ellipsis inside the 240, so the snippet never
-- exceeds 240 and a query of up to 200 characters stays whole inside it. If the case-folded
-- position cannot be found the window is the leading 240 characters.
CREATE OR REPLACE FUNCTION public._team_hub_search_snippet(p_body text, p_query text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE n int:=char_length(p_body); pos int:=strpos(lower(p_body),lower(p_query)); win_start int; snip text;
BEGIN
 IF n<=240 THEN RETURN p_body; END IF;
 IF pos=0 THEN pos:=1; END IF;
 win_start:=greatest(1,least(pos-(240-char_length(p_query))/2,n-239));
 snip:=substr(p_body,win_start,240);
 IF win_start>1 THEN snip:=E'\u2026'||substr(snip,2); END IF;
 IF win_start+239<n THEN snip:=left(snip,239)||E'\u2026'; END IF;
 RETURN snip;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_search_snippet(text,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.team_hub_search(p_expected_tenant uuid, p_query text, p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant);
 q text:=public._team_hub_trim(p_query); pattern text; lim int:=greatest(1,least(20,coalesce(p_limit,20))); results jsonb;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 IF q IS NULL OR char_length(q)<2 OR char_length(q)>200 THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- A literal: the escape character first, then the two wildcards.
 pattern:='%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%';
 SELECT coalesce(jsonb_agg(jsonb_build_object('message_id',h.id,'conversation_id',h.channel_id,
   'conversation_kind',h.kind,
   -- The label team_hub_list_conversations gives: the channel name, or for a DM the other person
   -- named from the pair key, so it still names them after their seat ends. Never an email.
   'conversation_label',CASE WHEN h.kind='dm' THEN coalesce(nullif(btrim(dp.full_name),''),'Teammate') ELSE h.name END,
   'thread_root_id',h.parent_message_id,
   'author_name',coalesce(nullif(btrim(ap.full_name),''),'Teammate'),
   'created_at',h.created_at,
   'snippet',public._team_hub_search_snippet(h.body,q))
   ORDER BY h.created_at DESC, h.id DESC),'[]'::jsonb) INTO results
 FROM (SELECT m.id, m.channel_id, m.parent_message_id, m.author_user_id, m.body, m.created_at, c.kind, c.name,
   CASE WHEN c.kind='dm' THEN (SELECT k.id::uuid FROM unnest(string_to_array(c.dm_key,':')) k(id)
    WHERE k.id<>actor::text LIMIT 1) END AS dm_user_id
  FROM public.team_hub_channels c
  JOIN public.team_hub_messages m ON m.channel_id=c.id
  WHERE c.tenant_id=p_expected_tenant
   AND EXISTS(SELECT 1 FROM public._team_hub_visible(p_expected_tenant,actor,c.id))
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
