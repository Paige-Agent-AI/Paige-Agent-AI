-- Existing canonical Chat tables and protected v2 lifecycle. No staff membership,
-- workspace pointer, second history, executor or effect activation.
BEGIN;
ALTER TABLE public.paige_chat_threads ADD COLUMN audience text NOT NULL DEFAULT 'workspace'
  CHECK (audience IN ('workspace','customer_private'));
CREATE INDEX paige_chat_customer_history ON public.paige_chat_threads(caller_user_id,tenant_id,contact_id,created_at DESC)
  WHERE audience='customer_private';
-- Preserve workspace uniqueness and NULL-distinct personal/Studio behavior while
-- allowing the same actor/contact to have distinct staff and private audiences.
DROP INDEX public.idx_paige_chat_threads_single_active;
CREATE UNIQUE INDEX idx_paige_chat_threads_single_active
 ON public.paige_chat_threads(caller_user_id,contact_id,lens,audience)
 WHERE is_archived=false AND studio_session_id IS NULL;

-- Native relationship resolver is the single identity authority. Caller JWT only.
-- SECURITY DEFINER is needed because clients has no general customer SELECT grant.
CREATE OR REPLACE FUNCTION public.paige_chat_customer_thread_authorized(p_thread uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE _client uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  _client := public.client_portal_relationship_id();
  IF _client IS NULL THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM public.paige_chat_threads t JOIN public.clients c ON c.id=_client
    WHERE t.id=p_thread AND t.audience='customer_private' AND t.lens='client'
      AND t.caller_user_id=auth.uid() AND t.contact_id=c.id AND t.tenant_id=c.tenant_id
      AND NOT t.is_archived AND t.auto_delete_at>now());
END $$;
REVOKE ALL ON FUNCTION public.paige_chat_customer_thread_authorized(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.paige_chat_customer_thread_authorized(uuid) TO authenticated;

-- Freeze private audience/identity even for a customer who also owns a workspace.
CREATE OR REPLACE FUNCTION public.paige_chat_customer_audience_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE _contact_deleted boolean := false;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.audience='customer_private' AND current_user<>'postgres' THEN
      RAISE EXCEPTION 'customer thread is server issued' USING ERRCODE='42501';
    END IF;
  ELSIF OLD.audience='customer_private' OR NEW.audience='customer_private' THEN
    -- Preserve the existing clients FK ON DELETE SET NULL. Only its nested
    -- referential action may detach a deleted contact; browser updates cannot.
    _contact_deleted := OLD.audience='customer_private' AND OLD.contact_id IS NOT NULL
      AND NEW.contact_id IS NULL AND pg_trigger_depth()>1
      AND NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=OLD.contact_id)
      AND ROW(NEW.audience,NEW.caller_user_id,NEW.tenant_id,NEW.lens,NEW.studio_session_id)
        IS NOT DISTINCT FROM ROW(OLD.audience,OLD.caller_user_id,OLD.tenant_id,OLD.lens,OLD.studio_session_id);
    IF ROW(NEW.audience,NEW.caller_user_id,NEW.contact_id,NEW.tenant_id,NEW.lens,NEW.studio_session_id)
      IS DISTINCT FROM ROW(OLD.audience,OLD.caller_user_id,OLD.contact_id,OLD.tenant_id,OLD.lens,OLD.studio_session_id)
      AND NOT _contact_deleted THEN
      RAISE EXCEPTION 'customer thread audience is immutable' USING ERRCODE='42501';
    END IF;
    IF _contact_deleted THEN NEW.is_archived := true; END IF;
    IF current_user<>'postgres' AND NEW.auto_delete_at IS DISTINCT FROM OLD.auto_delete_at THEN
      RAISE EXCEPTION 'customer retention is server-owned' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.paige_chat_customer_audience_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER paige_chat_customer_audience_guard BEFORE INSERT OR UPDATE ON public.paige_chat_threads
  FOR EACH ROW EXECUTE FUNCTION public.paige_chat_customer_audience_guard();

DROP POLICY threads_tenant_isolation ON public.paige_chat_threads;
CREATE POLICY threads_tenant_isolation ON public.paige_chat_threads AS RESTRICTIVE FOR ALL TO authenticated
 USING (CASE WHEN audience='customer_private' THEN public.paige_chat_customer_thread_authorized(id)
   ELSE public.is_platform_owner() OR tenant_id=public.current_user_tenant_id() END)
 WITH CHECK (CASE WHEN audience='customer_private' THEN public.paige_chat_customer_thread_authorized(id)
   ELSE public.is_platform_owner() OR tenant_id=public.current_user_tenant_id() END);
CREATE POLICY threads_customer_private_select ON public.paige_chat_threads FOR SELECT TO authenticated
 USING (audience='customer_private' AND public.paige_chat_customer_thread_authorized(id));
CREATE POLICY turns_customer_private_select ON public.paige_chat_turns FOR SELECT TO authenticated
 USING (public.paige_chat_customer_thread_authorized(thread_id));
-- Permissive legacy policies cannot grant business admins/operator access to private AI text.
CREATE POLICY turns_customer_private_isolation ON public.paige_chat_turns AS RESTRICTIVE FOR ALL TO authenticated
 USING (EXISTS(SELECT 1 FROM public.paige_chat_threads t WHERE t.id=thread_id
   AND (t.audience='workspace' OR (interactive_actor_id=auth.uid()
     AND interactive_tenant_id=t.tenant_id AND interactive_intent_id IS NOT NULL
     AND (role='user' OR (role='assistant' AND interactive_terminal_state IS NOT NULL))))))
 WITH CHECK (EXISTS(SELECT 1 FROM public.paige_chat_threads t WHERE t.id=thread_id));

-- One canonical contact predicate: preserve the existing two-argument read
-- contract, including the customer's own relationship. The internal third
-- argument only narrows that predicate for staff operations. No new authority.
DO $scope_lease$
DECLARE expected record; actual_hash text; actual_owner oid;
BEGIN
  IF to_regprocedure('public.can_access_contact(uuid,uuid,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'canonical contact narrowing already exists' USING ERRCODE='42501';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('public.can_access_contact(uuid,uuid)',ARRAY['2587335d53357f1d08f8fbc1329659d1','ea2788607d3d167b689cf63047837755']),
    ('public.paige_tool_create_task(uuid,uuid,text,text,timestamptz,text)',ARRAY['3ac4174fa62a2fa83c86bbed89d763ac']),
    ('public.paige_tool_add_client_note(uuid,uuid,text,text)',ARRAY['a2e866225d975ce73fcfa7ebeb999adb'])
  ) x(signature,source_hashes) LOOP
    SELECT md5(p.prosrc),p.proowner INTO actual_hash,actual_owner
      FROM pg_proc p WHERE p.oid=to_regprocedure(expected.signature);
    IF actual_hash IS NULL OR NOT actual_hash=ANY(expected.source_hashes)
      OR actual_owner IS DISTINCT FROM current_user::regrole::oid THEN
      RAISE EXCEPTION 'canonical contact or staff writer source changed' USING ERRCODE='42501';
    END IF;
  END LOOP;
END;
$scope_lease$;

CREATE OR REPLACE FUNCTION public.can_access_contact(_user_id uuid, _contact_id uuid, _allow_linked_customer boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = _contact_id
        AND (
          public.agency_can_manage_child(c.tenant_id, _user_id)
          OR EXISTS (
            SELECT 1 FROM public.tenant_members tm
            WHERE tm.tenant_id = c.tenant_id
              AND tm.user_id = _user_id
              AND tm.status = 'active'
              AND tm.role IN ('owner','admin')
          )
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = _contact_id
        AND (
          c.lead_owner_user_id = _user_id
          OR c.cs_primary_user_id = _user_id
          OR c.assigned_coach_user_id = _user_id
          OR (_allow_linked_customer IS TRUE AND c.linked_user_id = _user_id)
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.paige_coach_assignments a
      WHERE a.contact_id = _contact_id
        AND a.active = true
        AND a.rep_user_id = _user_id
    );
$function$;
REVOKE ALL ON FUNCTION public.can_access_contact(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- Same signature, volatility, owner and existing ACL. Every old read uses the
-- original complete predicate; staff writers use its explicit internal narrowing.
CREATE OR REPLACE FUNCTION public.can_access_contact(_user_id uuid, _contact_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.can_access_contact(_user_id, _contact_id, true);
$function$;

-- Private customer threads never serve as staff authority, even for a person
-- who legitimately has a staff role elsewhere or is assigned to this contact.
-- Incumbent self-task behavior and authorized workspace/contact writers remain.
CREATE OR REPLACE FUNCTION public.paige_tool_create_task(p_thread_id uuid, p_contact_id uuid, p_title text, p_description text DEFAULT NULL::text, p_due_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_priority text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_tc uuid;
  v_task uuid;
  v_title text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(v_uid) THEN RAISE EXCEPTION 'staff role required'; END IF;
  IF p_title IS NULL OR length(btrim(p_title))=0 THEN RAISE EXCEPTION 'title required'; END IF;
  IF p_priority IS NOT NULL AND p_priority NOT IN ('low','medium','high')
    THEN RAISE EXCEPTION 'invalid priority'; END IF;

  SELECT caller_user_id, contact_id INTO v_owner, v_tc
    FROM public.paige_chat_threads WHERE id = p_thread_id
      AND audience = 'workspace'
      AND (contact_id IS NULL OR public.can_access_contact(v_uid, contact_id, false));
  IF v_owner IS NULL THEN RAISE EXCEPTION 'thread not found'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'thread not owned by caller'; END IF;
  IF v_tc IS DISTINCT FROM p_contact_id THEN RAISE EXCEPTION 'contact_id mismatch with thread'; END IF;

  v_title := btrim(p_title);

  INSERT INTO public.tasks (user_id, title, description, due_date, status, metadata)
  VALUES (
    v_uid,
    v_title,
    NULLIF(btrim(COALESCE(p_description,'')), ''),
    p_due_date,
    'pending'::task_status,
    jsonb_build_object(
      'contact_id', p_contact_id,
      'source', 'paige_tool_call',
      'thread_id', p_thread_id,
      'priority', COALESCE(p_priority,'medium')
    )
  )
  RETURNING id INTO v_task;

  INSERT INTO public.paige_audit_log (actor_user_id, action, target_type, target_id, payload)
  VALUES (
    v_uid,
    'tool_call:create_task',
    'task',
    v_task,
    jsonb_build_object(
      'thread_id', p_thread_id,
      'contact_id', p_contact_id,
      'tool_args', jsonb_build_object(
        'title', v_title,
        'description', p_description,
        'due_date', p_due_date,
        'priority', p_priority
      ),
      'tool_result', jsonb_build_object('task_id', v_task, 'ok', true)
    )
  );

  RETURN jsonb_build_object('ok', true, 'task_id', v_task, 'title', v_title);
END;$function$;

CREATE OR REPLACE FUNCTION public.paige_tool_add_client_note(p_thread_id uuid, p_contact_id uuid, p_content text, p_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_tc uuid;
  v_note uuid;
  v_body text;
  v_tags text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.is_staff(v_uid) THEN RAISE EXCEPTION 'staff role required'; END IF;
  IF p_content IS NULL OR length(btrim(p_content))=0 THEN RAISE EXCEPTION 'content required'; END IF;

  SELECT caller_user_id, contact_id INTO v_owner, v_tc
    FROM public.paige_chat_threads WHERE id = p_thread_id
      AND audience = 'workspace'
      AND (contact_id IS NULL OR public.can_access_contact(v_uid, contact_id, false));
  IF v_owner IS NULL THEN RAISE EXCEPTION 'thread not found'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'thread not owned by caller'; END IF;
  IF v_tc IS DISTINCT FROM p_contact_id THEN RAISE EXCEPTION 'contact_id mismatch with thread'; END IF;

  v_body := btrim(p_content);
  v_tags := CASE WHEN p_category IS NOT NULL AND length(btrim(p_category)) > 0
                 THEN ARRAY[btrim(lower(p_category))]
                 ELSE ARRAY[]::text[] END;

  INSERT INTO public.client_notes (contact_id, author_user_id, body, tags)
  VALUES (p_contact_id, v_uid, v_body, v_tags)
  RETURNING id INTO v_note;

  INSERT INTO public.paige_audit_log (actor_user_id, action, target_type, target_id, payload)
  VALUES (
    v_uid,
    'tool_call:add_client_note',
    'client_note',
    v_note,
    jsonb_build_object(
      'thread_id', p_thread_id,
      'contact_id', p_contact_id,
      'tool_args', jsonb_build_object(
        'content_preview', left(v_body, 200),
        'category', p_category
      ),
      'tool_result', jsonb_build_object('note_id', v_note, 'ok', true)
    )
  );

  RETURN jsonb_build_object('ok', true, 'note_id', v_note, 'preview', left(v_body, 200));
END;$function$;

CREATE OR REPLACE FUNCTION public.paige_chat_thread_create(p_contact_id uuid, p_lens text, p_title text, p_consent_snapshot jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_tenant_id uuid;
  v_thread_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_lens IS NULL OR p_lens NOT IN ('coach','client','platform','customer') THEN RAISE EXCEPTION 'invalid lens'; END IF;
  IF p_lens='platform' AND (p_contact_id IS NOT NULL OR public.is_platform_owner() IS NOT TRUE) THEN
    RAISE EXCEPTION 'platform lens requires authorized self scope' USING ERRCODE='42501';
  END IF;

  IF p_lens = 'customer' THEN
    IF p_contact_id IS NOT NULL THEN RAISE EXCEPTION 'customer subject is server resolved' USING ERRCODE='42501'; END IF;
    p_contact_id := public.client_portal_relationship_id();
    IF p_contact_id IS NULL THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
    SELECT tenant_id INTO v_tenant_id FROM public.clients WHERE id=p_contact_id AND linked_user_id=v_uid FOR SHARE;
    IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text,9821));
    SELECT id INTO v_thread_id FROM public.paige_chat_threads
      WHERE caller_user_id=v_uid AND tenant_id=v_tenant_id AND contact_id=p_contact_id
        AND audience='customer_private' AND NOT is_archived AND auto_delete_at>now()
      ORDER BY created_at DESC LIMIT 1;
    IF v_thread_id IS NOT NULL THEN RETURN v_thread_id; END IF;
    UPDATE public.paige_chat_threads SET is_archived=true
      WHERE caller_user_id=v_uid AND tenant_id=v_tenant_id AND contact_id=p_contact_id
        AND audience='customer_private' AND NOT is_archived AND auto_delete_at<=now();
  ELSIF p_contact_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant_id
      FROM public.clients WHERE id = p_contact_id
        AND (public.is_platform_owner() IS TRUE OR public.can_access_contact(v_uid,p_contact_id,false));
    IF v_tenant_id IS NULL THEN
      RAISE EXCEPTION 'workspace contact unavailable' USING ERRCODE='42501';
    END IF;
  ELSIF p_lens = 'platform' THEN
    IF NOT public.is_platform_owner() THEN
      RAISE EXCEPTION 'platform lens requires platform owner';
    END IF;
    v_tenant_id := NULL;
  ELSE
    v_tenant_id := public.current_user_tenant_id();
    IF v_tenant_id IS NULL THEN
      RAISE EXCEPTION 'self-mode requires caller tenant';
    END IF;
    IF NOT (public.is_platform_owner() IS TRUE OR public.is_tenant_member(v_tenant_id) IS TRUE
      OR public.is_tenant_owner(v_uid,v_tenant_id) IS TRUE OR public.agency_can_manage_child(v_tenant_id,v_uid) IS TRUE) THEN
      RAISE EXCEPTION 'workspace membership unavailable' USING ERRCODE='42501';
    END IF;
  END IF;

  INSERT INTO public.paige_chat_threads
    (caller_user_id, contact_id, tenant_id, lens, audience, title,
     consent_snapshot, auto_delete_at, last_message_at)
  VALUES
    (v_uid, p_contact_id, v_tenant_id, CASE WHEN p_lens='customer' THEN 'client' ELSE p_lens END,
     CASE WHEN p_lens='customer' THEN 'customer_private' ELSE 'workspace' END, p_title,
     p_consent_snapshot, now() + interval '90 days', now())
  RETURNING id INTO v_thread_id;

  RETURN v_thread_id;
END;
$function$;


CREATE OR REPLACE FUNCTION public.paige_chat_turn_append(p_thread_id uuid, p_role text, p_content text, p_surfaces_used text[], p_load_id uuid, p_model text, p_tokens_used integer, p_latency_ms integer, p_bundle_ref jsonb, p_tool_calls jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_turn uuid;
  v_owner uuid;
  v_tenant uuid;
  v_found boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_role NOT IN ('user','assistant','system') THEN RAISE EXCEPTION 'invalid role'; END IF;

  SELECT caller_user_id, tenant_id
    INTO v_owner, v_tenant
    FROM public.paige_chat_threads
   WHERE id = p_thread_id;
  v_found := FOUND;

  IF NOT v_found THEN RAISE EXCEPTION 'thread not found'; END IF;
  IF v_owner IS NULL OR v_owner <> v_uid THEN RAISE EXCEPTION 'thread not owned by caller'; END IF;

  IF (SELECT audience FROM public.paige_chat_threads WHERE id=p_thread_id)='customer_private' THEN
    IF NOT public.paige_chat_customer_thread_authorized(p_thread_id) THEN
      RAISE EXCEPTION 'customer thread unavailable' USING ERRCODE='42501';
    END IF;
    IF p_role='assistant' THEN
      RAISE EXCEPTION 'customer answers require a server-issued receipt' USING ERRCODE='42501';
    END IF;
  ELSIF NOT (
       (v_tenant IS NOT NULL AND v_tenant IS NOT DISTINCT FROM public.current_user_tenant_id())
    OR (v_tenant IS NULL AND public.is_platform_owner() IS TRUE)
    OR public.is_platform_owner() IS TRUE
  ) THEN
    RAISE EXCEPTION 'thread belongs to a different workspace';
  END IF;

  INSERT INTO public.paige_chat_turns
    (thread_id, role, content, surfaces_used, load_id, model,
     tokens_used, latency_ms, bundle_ref, tool_calls)
  VALUES
    (p_thread_id, p_role, p_content, p_surfaces_used, p_load_id, p_model,
     p_tokens_used, p_latency_ms, p_bundle_ref, p_tool_calls)
  RETURNING id INTO v_turn;

  UPDATE public.paige_chat_threads
     SET message_count   = message_count + 1,
         last_message_at = now(),
         auto_delete_at  = now() + interval '90 days',   -- sliding window (20260711300000)
         updated_at      = now()
   WHERE id = p_thread_id;

  RETURN v_turn;
END;
$function$;


CREATE OR REPLACE FUNCTION public.paige_chat_interactive_begin_v2(p_thread uuid, p_intent uuid, p_supersedes uuid, p_content text, p_bound_answer boolean DEFAULT false, p_stop boolean DEFAULT false, p_effectful boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t public.paige_chat_threads%rowtype; turn_id uuid; evidence jsonb;
begin
 if p_effectful is null then raise exception 'INTERACTIVE_PROTOCOL_NOT_READY'; end if;
 perform 1 from public.paige_chat_interactive_rollout where singleton for share;
 if p_stop is not true and coalesce((select active from public.paige_chat_interactive_rollout where singleton),false)
   and not p_effectful then raise exception 'INTERACTIVE_PROTOCOL_REQUIRED'; end if;
 if p_stop is not true and not coalesce((select active from public.paige_chat_interactive_rollout where singleton),false)
   and p_effectful then raise exception 'INTERACTIVE_PROTOCOL_NOT_READY'; end if;
 if auth.uid() is null then raise exception 'auth required' using errcode='42501'; end if;
 select * into t from public.paige_chat_threads where id=p_thread for update;
 if not found or t.caller_user_id is distinct from auth.uid() or not (
  (t.audience='customer_private' and public.paige_chat_customer_thread_authorized(p_thread))
  or (t.audience='workspace' and t.tenant_id is not null and t.tenant_id is not distinct from public.current_user_tenant_id())
  or (t.audience='workspace' and t.tenant_id is null and public.is_platform_owner() is true)) then
  raise exception 'thread scope mismatch' using errcode='42501'; end if;
 if p_stop then
  if p_supersedes is null then raise exception 'stop intent required'; end if;
  turn_id:=public.paige_chat_turn_append(p_thread,'system','',null,null,null,null,null,
   jsonb_build_object('interactive',jsonb_build_object('supersedes_intent_id',p_supersedes,'stopped',true)),null);
  update public.paige_chat_turns set interactive_actor_id=auth.uid(),interactive_tenant_id=t.tenant_id,
   interactive_supersedes_id=p_supersedes where id=turn_id;
  if t.interactive_latest_intent=p_supersedes then
   update public.paige_chat_threads set interactive_latest_intent=null,interactive_admission=null,interactive_admitted_intent=null where id=p_thread;
  end if;
  return jsonb_build_object('status','stopped');
 end if;
 if p_intent is null then raise exception 'intent required'; end if;
 evidence:=public.paige_chat_interactive_evidence(p_thread,auth.uid(),t.tenant_id,p_intent);
 if (evidence->>'stopped')::boolean then return jsonb_build_object('status','superseded'); end if;
 if exists(select 1 from public.paige_chat_turns where thread_id=p_thread
 and bundle_ref->'interactive'->>'supersedes_intent_id'=p_intent::text) then
  return jsonb_build_object('status','superseded');
 end if;
 if t.interactive_latest_intent=p_intent or exists(select 1 from public.paige_chat_turns
 where thread_id=p_thread and (interactive_intent_id=p_intent
  or bundle_ref->'interactive'->>'request_intent_id'=p_intent::text)) then
  if t.interactive_latest_intent=p_intent and t.interactive_executor_intent is null
   and t.interactive_admitted_intent=p_intent
   and t.interactive_admission is not distinct from (case when p_effectful then null::text else 'conversational' end)
   and not (evidence->>'terminal')::boolean then
   select id into turn_id from public.paige_chat_turns where thread_id=p_thread and role='user'
    and interactive_intent_id=p_intent and interactive_actor_id=auth.uid()
    and interactive_tenant_id is not distinct from t.tenant_id limit 1;
   return jsonb_build_object('status','accepted','turn_id',turn_id);
  end if;
  return jsonb_build_object('status','duplicate');
 end if;
 if not p_bound_answer then
  turn_id:=public.paige_chat_turn_append(p_thread,'user',p_content,null,null,null,null,null,
   jsonb_build_object('interactive',jsonb_build_object('request_intent_id',p_intent,
    'supersedes_intent_id',p_supersedes)),null);
  update public.paige_chat_turns set interactive_intent_id=p_intent,interactive_actor_id=auth.uid(),
   interactive_tenant_id=t.tenant_id,interactive_supersedes_id=p_supersedes where id=turn_id;
 elsif p_supersedes is not null then
  turn_id:=public.paige_chat_turn_append(p_thread,'system','',null,null,null,null,null,
   jsonb_build_object('interactive',jsonb_build_object('supersedes_intent_id',p_supersedes)),null);
  update public.paige_chat_turns set interactive_actor_id=auth.uid(),interactive_tenant_id=t.tenant_id,
   interactive_supersedes_id=p_supersedes where id=turn_id;
 end if;
 update public.paige_chat_threads set interactive_latest_intent=p_intent,
  interactive_admission=case when p_effectful then null else 'conversational' end,
  interactive_admitted_intent=p_intent where id=p_thread;
 return jsonb_build_object('status','accepted','turn_id',case when p_bound_answer then null else turn_id end);
end $function$;


CREATE OR REPLACE FUNCTION public.paige_chat_interactive_publication_context_v2(p_thread uuid, p_intent uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select auth.uid() is not null
    and p_thread is not null
    and p_intent is not null
    and exists (
      select 1
      from public.paige_chat_threads t
      where t.id = p_thread
        and t.caller_user_id = auth.uid()
        and t.interactive_latest_intent = p_intent
        and t.interactive_executor_intent is null
        and (
          (t.audience='customer_private' and public.paige_chat_customer_thread_authorized(p_thread))
          or (t.audience='workspace' and t.tenant_id is not null
            and exists (
              select 1 from public.profiles p
              where p.user_id = auth.uid()
                and p.active_tenant_id = t.tenant_id
            )
            and public.current_user_tenant_id() = t.tenant_id)
          or (t.audience='workspace' and t.tenant_id is null and public.is_platform_owner() is true)
        )
        and public.paige_chat_interactive_evidence(
          t.id, auth.uid(), t.tenant_id, p_intent
        ) @> '{"terminal":true,"stopped":false}'::jsonb
    );
$function$;

REVOKE ALL ON FUNCTION public.paige_chat_thread_create(uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.paige_chat_thread_create(uuid,text,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.paige_chat_turn_append(uuid,text,text,text[],uuid,text,integer,integer,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.paige_chat_turn_append(uuid,text,text,text[],uuid,text,integer,integer,jsonb,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.paige_chat_interactive_publication_context_v2(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.paige_chat_interactive_publication_context_v2(uuid,uuid) TO authenticated;
COMMIT;
