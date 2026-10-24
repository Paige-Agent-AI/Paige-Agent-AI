-- EXP08 Team Hub increment 1: channels, direct messages and one-level threads between the
-- active teammates of one workspace. Human-to-human only: no Paige act, provider, approval or
-- durable job. Contract: docs/delivery/exp08-team-hub-collaboration-contract.md.
-- Tables are RLS-on with no policies and no browser grant. The nine SECURITY DEFINER doors
-- below re-check the caller in their bodies (§59): an active tenant_members seat in the
-- workspace public.current_user_tenant_id() resolves, and that workspace is a canonical SOLO
-- account (A1). Operator and agency standing, which that resolver and is_tenant_member admit,
-- never opens Team Hub. Workspace role never opens a private channel, and a seat that stops
-- being active loses its private channels and DMs (A2), except under an operator archive, which
-- holds them for restore (A9). Expected refusals return
-- {"ok":false,"code":...}; nothing raises. Every grant is explicit: Supabase's default
-- privileges hand new tables and functions to anon and authenticated, and this file revokes them.
-- Forward-only and replay-safe: a second apply changes nothing.
BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE TABLE IF NOT EXISTS public.team_hub_channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('channel','dm')),
 name text,
 visibility text NOT NULL CHECK (visibility IN ('team','private')),
 dm_key text,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 archived_at timestamptz,
 CONSTRAINT team_hub_channels_shape_chk CHECK (
  (kind='channel' AND name IS NOT NULL AND name ~ '^[a-z0-9][a-z0-9-]{1,29}$' AND dm_key IS NULL)
  OR (kind='dm' AND name IS NULL AND visibility='private' AND dm_key IS NOT NULL))
);
-- A3: names are unique only among unarchived team-visible channels. Private names may repeat,
-- so creating one never reveals that another private channel exists.
CREATE UNIQUE INDEX IF NOT EXISTS team_hub_channels_name_key
 ON public.team_hub_channels (tenant_id, name) WHERE archived_at IS NULL AND visibility='team';
CREATE UNIQUE INDEX IF NOT EXISTS team_hub_channels_dm_key
 ON public.team_hub_channels (tenant_id, dm_key);

CREATE TABLE IF NOT EXISTS public.team_hub_channel_members (
 channel_id uuid NOT NULL REFERENCES public.team_hub_channels(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 added_by uuid NOT NULL,
 added_at timestamptz NOT NULL DEFAULT now(),
 last_read_at timestamptz,
 PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_hub_channel_members_user_idx
 ON public.team_hub_channel_members (user_id, tenant_id);

CREATE TABLE IF NOT EXISTS public.team_hub_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 channel_id uuid NOT NULL REFERENCES public.team_hub_channels(id) ON DELETE CASCADE,
 author_user_id uuid NOT NULL,
 body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000 AND body=btrim(body, E' \t\r\n')),
 parent_message_id uuid REFERENCES public.team_hub_messages(id),
 client_request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 edited_at timestamptz,
 deleted_at timestamptz,
 CONSTRAINT team_hub_messages_request_key UNIQUE (author_user_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS team_hub_messages_stream_idx
 ON public.team_hub_messages (channel_id, parent_message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS team_hub_messages_thread_idx
 ON public.team_hub_messages (parent_message_id) WHERE parent_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.team_hub_message_mentions (
 message_id uuid NOT NULL REFERENCES public.team_hub_messages(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL,
 channel_id uuid NOT NULL,
 mentioned_user_id uuid NOT NULL,
 PRIMARY KEY (message_id, mentioned_user_id)
);

ALTER TABLE public.team_hub_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_hub_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_hub_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_hub_message_mentions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_hub_channels, public.team_hub_channel_members,
 public.team_hub_messages, public.team_hub_message_mentions FROM PUBLIC, anon, authenticated;

-- Storage backstops. The doors refuse these first; a direct write that skips them still fails.
CREATE OR REPLACE FUNCTION public._team_hub_member_scope_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.team_hub_channels c WHERE c.id=NEW.channel_id AND c.tenant_id=NEW.tenant_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_MEMBER_SCOPE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_member_scope_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER team_hub_member_scope BEFORE INSERT OR UPDATE OF channel_id, tenant_id
 ON public.team_hub_channel_members FOR EACH ROW EXECUTE FUNCTION public._team_hub_member_scope_guard();

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
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_message_scope_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER team_hub_message_scope BEFORE INSERT OR UPDATE OF channel_id, tenant_id, parent_message_id
 ON public.team_hub_messages FOR EACH ROW EXECUTE FUNCTION public._team_hub_message_scope_guard();

CREATE OR REPLACE FUNCTION public._team_hub_mention_scope_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.team_hub_messages m WHERE m.id=NEW.message_id
   AND m.tenant_id=NEW.tenant_id AND m.channel_id=NEW.channel_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_MENTION_SCOPE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_mention_scope_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER team_hub_mention_scope BEFORE INSERT OR UPDATE OF message_id, tenant_id, channel_id
 ON public.team_hub_message_mentions FOR EACH ROW EXECUTE FUNCTION public._team_hub_mention_scope_guard();

-- A2: when a seat stops being active (deleted, or status moved off 'active'), that person's
-- private-channel and DM memberships in that workspace go, so re-inviting them restores no
-- private channel. Team-channel rows stay: team channels are open to every active seat anyway.
-- A9: operator account archive (status 'archived', set by operator_archive_account) is a hold,
-- not an ending. Memberships stay, so operator_restore_archived_account brings Team Hub back
-- intact; meanwhile every door refuses the archived seat not_member. A held seat that leaves the
-- hold for anything but active, or is deleted, has ended.
-- AFTER, never raises, returns NULL: tenant_members behaves exactly as it did. DEFINER because
-- whoever changes the seat holds no privilege on Team Hub storage.
CREATE OR REPLACE FUNCTION public._team_hub_seat_ended()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.status IN ('active','archived')
   AND (TG_OP='DELETE' OR coalesce(NEW.status,'') NOT IN ('active','archived')) THEN
  DELETE FROM public.team_hub_channel_members m USING public.team_hub_channels c
   WHERE m.channel_id=c.id AND m.tenant_id=OLD.tenant_id AND m.user_id=OLD.user_id AND c.visibility='private';
  -- A5 holds here too: a private channel this emptied is archived, as if its last member left.
  -- DMs are not archived: the other person can still reopen one.
  UPDATE public.team_hub_channels c SET archived_at=now()
   WHERE c.tenant_id=OLD.tenant_id AND c.kind='channel' AND c.visibility='private' AND c.archived_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.team_hub_channel_members m WHERE m.channel_id=c.id);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_seat_ended() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER team_hub_seat_ended AFTER UPDATE OF status OR DELETE
 ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public._team_hub_seat_ended();

-- Internal helpers. Callable only from the doors below, which run as their owner.
-- The whitespace String.prototype.trim removes, so the server and the composer agree on what an
-- empty message is. The storage CHECK trims less, so every body this returns satisfies it.
CREATE OR REPLACE FUNCTION public._team_hub_trim(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT regexp_replace(p_text,
  '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
  '', 'g')
$$;
REVOKE ALL ON FUNCTION public._team_hub_trim(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._team_hub_is_active(p_tenant uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenant_members m
  WHERE m.tenant_id=p_tenant AND m.user_id=p_user AND m.status='active')
$$;
REVOKE ALL ON FUNCTION public._team_hub_is_active(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Every door that inserts a membership first takes FOR SHARE on the seats it is about to add, so
-- a concurrent status change or delete of those seats waits for the door to commit and the
-- seat-ended trigger then sees, and removes, the new row. A seat that changed first fails the
-- status re-check under the lock and the door refuses. Locked in user_id order.
CREATE OR REPLACE FUNCTION public._team_hub_hold_seats(p_tenant uuid, p_users uuid[])
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE held bigint;
BEGIN
 SELECT count(DISTINCT s.user_id) INTO held FROM (SELECT m.user_id FROM public.tenant_members m
  WHERE m.tenant_id=p_tenant AND m.user_id=ANY(p_users) AND m.status='active' ORDER BY m.user_id FOR SHARE) s;
 RETURN held=(SELECT count(DISTINCT x.id) FROM unnest(p_users) x(id));
END $$;
REVOKE ALL ON FUNCTION public._team_hub_hold_seats(uuid,uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- NULL when the caller may act in p_expected_tenant; otherwise the refusal code, in the order
-- not_member, unavailable, scope_changed. p_expected_tenant fences a workspace switch
-- mid-request. It never selects the workspace.
-- A1: only a canonical SOLO account, the rule assert_canonical_solo_tenant enforces. Agency and
-- Sub-account are held, including the seat agency_enter_subaccount gives a manager in a child.
CREATE OR REPLACE FUNCTION public._team_hub_refusal(p_expected_tenant uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); resolved uuid;
BEGIN
 IF actor IS NULL THEN RETURN 'not_member'; END IF;
 resolved:=public.current_user_tenant_id();
 IF resolved IS NULL OR NOT public._team_hub_is_active(resolved, actor) THEN RETURN 'not_member'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=resolved
   AND t.account_type='standalone' AND t.parent_tenant_id IS NULL) THEN RETURN 'unavailable'; END IF;
 IF p_expected_tenant IS DISTINCT FROM resolved THEN RETURN 'scope_changed'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_refusal(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- see(channel): in the workspace, not archived, and team-visible or the caller is a member.
-- No row means not_found, whether the channel is elsewhere, private or absent.
CREATE OR REPLACE FUNCTION public._team_hub_visible(p_tenant uuid, p_actor uuid, p_channel uuid)
RETURNS SETOF public.team_hub_channels LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT c.* FROM public.team_hub_channels c
  WHERE c.id=p_channel AND c.tenant_id=p_tenant AND c.archived_at IS NULL
   AND (c.visibility='team' OR EXISTS(SELECT 1 FROM public.team_hub_channel_members m
    WHERE m.channel_id=c.id AND m.user_id=p_actor))
$$;
REVOKE ALL ON FUNCTION public._team_hub_visible(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._team_hub_message_json(p_message public.team_hub_messages)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_message.id,'author_user_id',p_message.author_user_id,'body',p_message.body,
  'created_at',p_message.created_at,'parent_message_id',p_message.parent_message_id,
  'reply_count',(SELECT count(*) FROM public.team_hub_messages r
   WHERE r.parent_message_id=p_message.id AND r.deleted_at IS NULL),
  'last_reply_at',(SELECT max(r.created_at) FROM public.team_hub_messages r
   WHERE r.parent_message_id=p_message.id AND r.deleted_at IS NULL),
  'mentions',coalesce((SELECT jsonb_agg(x.mentioned_user_id ORDER BY x.mentioned_user_id)
   FROM public.team_hub_message_mentions x WHERE x.message_id=p_message.id),'[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public._team_hub_message_json(public.team_hub_messages) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.team_hub_list_conversations(p_expected_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); people jsonb; conversations jsonb;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 -- Active roster only. Never an email.
 SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',r.user_id,'display_name',r.display_name,'title',r.job_title,
   'permission',r.permission) ORDER BY lower(r.display_name), r.user_id),'[]'::jsonb) INTO people
 FROM (SELECT tm.user_id, coalesce(nullif(btrim(p.full_name),''),'Teammate') AS display_name, tm.job_title,
   CASE WHEN tm.is_owner OR tm.role::text='owner' THEN 'owner' ELSE tm.role::text END AS permission
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
   'unread',CASE WHEN m.user_id IS NULL THEN 0 ELSE (SELECT count(*) FROM public.team_hub_messages x
    WHERE x.channel_id=c.id AND x.parent_message_id IS NULL AND x.deleted_at IS NULL AND x.author_user_id<>actor
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

-- p_client_request_id is required; the stored channel carries no request id, so a retry is
-- recognised as the same creator, name and visibility within 60 seconds. A per-creator,
-- per-name lock makes that hold for concurrent retries too, since private names carry no
-- unique index to collide on (A3). name_taken is only ever about a team-visible channel.
CREATE OR REPLACE FUNCTION public.team_hub_create_channel(p_expected_tenant uuid, p_name text, p_visibility text,
 p_member_ids uuid[], p_client_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant);
 channel_name text:=lower(btrim(p_name)); members uuid[]:='{}'; created uuid; retried uuid;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 IF channel_name IS NULL OR channel_name !~ '^[a-z0-9][a-z0-9-]{1,29}$' OR p_visibility IS NULL
  OR p_visibility NOT IN ('team','private') OR p_client_request_id IS NULL THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF p_visibility='private' THEN
  IF EXISTS(SELECT 1 FROM unnest(coalesce(p_member_ids,'{}'::uuid[])) x(id)
    WHERE x.id IS NULL OR NOT public._team_hub_is_active(p_expected_tenant,x.id)) THEN
   RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  members:=ARRAY(SELECT DISTINCT x.id FROM unnest(p_member_ids) x(id) WHERE x.id<>actor);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_expected_tenant::text||':'||actor::text||':'||channel_name,0));
 SELECT c.id INTO retried FROM public.team_hub_channels c
  WHERE c.tenant_id=p_expected_tenant AND c.kind='channel' AND c.name=channel_name AND c.visibility=p_visibility
   AND c.created_by=actor AND c.archived_at IS NULL AND c.created_at>now()-interval '60 seconds'
   AND EXISTS(SELECT 1 FROM public._team_hub_visible(p_expected_tenant,actor,c.id))
  ORDER BY c.created_at DESC LIMIT 1;
 IF retried IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'channel_id',retried); END IF;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,actor||members) THEN
  RETURN jsonb_build_object('ok',false,'code',CASE WHEN public._team_hub_is_active(p_expected_tenant,actor)
   THEN 'invalid' ELSE 'not_member' END); END IF;
 IF p_visibility='team' THEN
  INSERT INTO public.team_hub_channels(tenant_id,kind,name,visibility,created_by)
   VALUES (p_expected_tenant,'channel',channel_name,'team',actor)
   ON CONFLICT (tenant_id,name) WHERE archived_at IS NULL AND visibility='team' DO NOTHING RETURNING id INTO created;
  IF created IS NULL THEN RETURN jsonb_build_object('ok',false,'code','name_taken'); END IF;
 ELSE
  INSERT INTO public.team_hub_channels(tenant_id,kind,name,visibility,created_by)
   VALUES (p_expected_tenant,'channel',channel_name,'private',actor) RETURNING id INTO created;
 END IF;
 INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by)
  SELECT created,p_expected_tenant,x.id,actor FROM unnest(actor||members) x(id);
 RETURN jsonb_build_object('ok',true,'channel_id',created);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_create_channel(uuid,text,text,uuid[],uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_create_channel(uuid,text,text,uuid[],uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.team_hub_open_dm(p_expected_tenant uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); pair_key text; dm public.team_hub_channels;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 IF p_user_id IS NULL OR p_user_id=actor OR NOT public._team_hub_is_active(p_expected_tenant,p_user_id) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor,p_user_id]) THEN
  RETURN jsonb_build_object('ok',false,'code',CASE WHEN public._team_hub_is_active(p_expected_tenant,actor)
   THEN 'invalid' ELSE 'not_member' END); END IF;
 pair_key:=least(actor,p_user_id)::text||':'||greatest(actor,p_user_id)::text;
 INSERT INTO public.team_hub_channels(tenant_id,kind,visibility,dm_key,created_by)
  VALUES (p_expected_tenant,'dm','private',pair_key,actor) ON CONFLICT (tenant_id,dm_key) DO NOTHING;
 SELECT * INTO dm FROM public.team_hub_channels c WHERE c.tenant_id=p_expected_tenant AND c.dm_key=pair_key;
 -- An archived conversation is one nobody can see: not_found, like every other door.
 IF dm.archived_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by)
  VALUES (dm.id,p_expected_tenant,actor,actor),(dm.id,p_expected_tenant,p_user_id,actor)
  ON CONFLICT (channel_id,user_id) DO NOTHING;
 RETURN jsonb_build_object('ok',true,'channel_id',dm.id);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_open_dm(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_open_dm(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.team_hub_join_channel(p_expected_tenant uuid, p_channel_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND OR ch.kind<>'channel' OR ch.visibility<>'team' THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor]) THEN RETURN jsonb_build_object('ok',false,'code','not_member'); END IF;
 -- Joining reads the history: only what arrives after this counts as unread.
 INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by,last_read_at)
  VALUES (ch.id,p_expected_tenant,actor,actor,now()) ON CONFLICT (channel_id,user_id) DO NOTHING;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_join_channel(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_join_channel(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.team_hub_leave_channel(p_expected_tenant uuid, p_channel_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF ch.kind='dm' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
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

CREATE OR REPLACE FUNCTION public.team_hub_add_members(p_expected_tenant uuid, p_channel_id uuid, p_user_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels; added int;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 -- A private channel is visible only to its members, so visibility is the current-member check.
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF ch.kind<>'channel' OR ch.visibility<>'private' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF p_user_ids IS NULL OR EXISTS(SELECT 1 FROM unnest(p_user_ids) x(id)
   WHERE x.id IS NULL OR NOT public._team_hub_is_active(p_expected_tenant,x.id)) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,p_user_ids) THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by)
  SELECT DISTINCT ch.id,p_expected_tenant,x.id,actor FROM unnest(p_user_ids) x(id)
  ON CONFLICT (channel_id,user_id) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 RETURN jsonb_build_object('ok',true,'added',added);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_add_members(uuid,uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_add_members(uuid,uuid,uuid[]) TO authenticated;

-- A6: the cursor is the compound (created_at, id) of the oldest message already shown, so rows
-- sharing a created_at are never skipped. Half a cursor is invalid.
-- A7: a thread returns its root apart from its replies, the replies newest first under the same
-- cursor, and has_more for older replies. The top level is newest first too.
-- Nothing has shipped, so the earlier five-argument signature is dropped rather than overloaded.
DROP FUNCTION IF EXISTS public.team_hub_list_messages(uuid,uuid,uuid,timestamptz,int);
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
 -- One page query for both modes: top-level messages of the channel, or the replies of root.
 SELECT coalesce(jsonb_agg(s.item ORDER BY s.n),'[]'::jsonb) INTO messages FROM (
  SELECT public._team_hub_message_json(m) AS item, row_number() OVER (ORDER BY m.created_at DESC, m.id DESC) AS n
  FROM public.team_hub_messages m
  WHERE m.channel_id=ch.id AND m.parent_message_id IS NOT DISTINCT FROM root.id AND m.deleted_at IS NULL
   AND (p_before IS NULL OR (m.created_at,m.id)<(p_before,p_before_id))
  ORDER BY m.created_at DESC, m.id DESC LIMIT lim) s;
 has_more:=EXISTS(SELECT 1 FROM public.team_hub_messages m
  WHERE m.channel_id=ch.id AND m.parent_message_id IS NOT DISTINCT FROM root.id AND m.deleted_at IS NULL
   AND (p_before IS NULL OR (m.created_at,m.id)<(p_before,p_before_id)) OFFSET lim);
 RETURN jsonb_build_object('ok',true,'channel',jsonb_build_object('id',ch.id,'kind',ch.kind,'name',ch.name,
   'visibility',ch.visibility,'joined',EXISTS(SELECT 1 FROM public.team_hub_channel_members x
    WHERE x.channel_id=ch.id AND x.user_id=actor)),
  'messages',messages,'has_more',has_more)
  || CASE WHEN root.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('root',public._team_hub_message_json(root)) END;
END $$;
REVOKE ALL ON FUNCTION public.team_hub_list_messages(uuid,uuid,uuid,timestamptz,uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_list_messages(uuid,uuid,uuid,timestamptz,uuid,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.team_hub_post_message(p_expected_tenant uuid, p_channel_id uuid, p_body text,
 p_client_request_id uuid, p_parent_message_id uuid DEFAULT NULL, p_mention_ids uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
 body text:=public._team_hub_trim(p_body); mentions uuid[]; msg public.team_hub_messages; other uuid;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF p_client_request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- A retry returns the original. The same request id in another conversation is a client error.
 SELECT * INTO msg FROM public.team_hub_messages m WHERE m.author_user_id=actor AND m.client_request_id=p_client_request_id;
 IF FOUND THEN
  IF msg.channel_id<>ch.id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
 END IF;
 IF body IS NULL OR body='' THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF char_length(body)>8000 THEN RETURN jsonb_build_object('ok',false,'code','too_long'); END IF;
 IF p_parent_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_hub_messages p
   WHERE p.id=p_parent_message_id AND p.channel_id=ch.id AND p.parent_message_id IS NULL AND p.deleted_at IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- A DM keeps reaching the other person. If their seat ended and they were re-invited, the seat
 -- trigger removed their membership; posting restores it, as reopening the DM does. A person
 -- whose seat is not active stays out. This comes before the mention check so the restored person
 -- can be mentioned; an active DM party belongs in the DM even if this post is then refused.
 IF ch.kind='dm' THEN
  other:=CASE split_part(ch.dm_key,':',1) WHEN actor::text THEN split_part(ch.dm_key,':',2)
   ELSE split_part(ch.dm_key,':',1) END::uuid;
  IF other IS NOT NULL AND public._team_hub_hold_seats(p_expected_tenant,ARRAY[other]) THEN
   INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by)
    VALUES (ch.id,p_expected_tenant,other,actor) ON CONFLICT (channel_id,user_id) DO NOTHING;
  END IF;
 END IF;
 -- A mention must be an active member who can see this conversation: anyone active for a team
 -- channel, the channel's members for a private channel or DM.
 IF EXISTS(SELECT 1 FROM unnest(coalesce(p_mention_ids,'{}'::uuid[])) x(id)
   WHERE x.id IS NULL OR NOT public._team_hub_is_active(p_expected_tenant,x.id)
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
  IF NOT FOUND OR msg.channel_id IS DISTINCT FROM ch.id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
 END IF;
 INSERT INTO public.team_hub_message_mentions(message_id,tenant_id,channel_id,mentioned_user_id)
  SELECT msg.id,p_expected_tenant,ch.id,x.id FROM unnest(mentions) x(id);
 RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg));
END $$;
REVOKE ALL ON FUNCTION public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[]) TO authenticated;

-- A8: reads through the message the client displayed, never past it, so a message that arrived
-- after it stays unread. last_read_at only moves forward. The earlier two-argument signature,
-- which read through now(), is dropped rather than overloaded: nothing has shipped.
DROP FUNCTION IF EXISTS public.team_hub_mark_read(uuid,uuid);
CREATE OR REPLACE FUNCTION public.team_hub_mark_read(p_expected_tenant uuid, p_channel_id uuid, p_through_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels; through timestamptz;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.team_hub_channel_members m WHERE m.channel_id=ch.id AND m.user_id=actor) THEN
  RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 SELECT m.created_at INTO through FROM public.team_hub_messages m
  WHERE m.id=p_through_message_id AND m.channel_id=ch.id AND m.parent_message_id IS NULL AND m.deleted_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 UPDATE public.team_hub_channel_members m SET last_read_at=greatest(coalesce(m.last_read_at,'-infinity'),through)
  WHERE m.channel_id=ch.id AND m.user_id=actor;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_mark_read(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_mark_read(uuid,uuid,uuid) TO authenticated;

-- A10: Team Hub goes with the account at retirement, like the workspace it belongs to, so it never
-- blocks permanent deletion. The guarded patch of the canonical policy that public_visits uses.
DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer; BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=position(anchor IN body);
 IF position('team_hub_channels' IN body)>0 THEN RETURN; END IF;
 IF at=0 OR position('''growth_public_visits''' IN body)=0 THEN
  RAISE EXCEPTION 'Canonical retirement policy requires reconciliation before registering Team Hub'; END IF;
 EXECUTE left(body,at+length(anchor)-1)||'''team_hub_channels'',''team_hub_channel_members'',''team_hub_messages'',''team_hub_message_mentions'','
  ||substr(body,at+length(anchor));
END $$;
COMMIT;
