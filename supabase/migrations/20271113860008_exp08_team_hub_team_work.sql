-- EXP08 Team Hub increment 2: a conversation can start one real task in Operations, and the
-- message that started it points to that task. Contract:
-- docs/delivery/exp08-team-hub-increment2-work-contract.md (increment 1's rules all still hold).
-- Team Hub creates no task store, scheduler, approval inbox, action bus, specialist runtime or
-- ledger. The only writer is team_hub_request_task: it re-runs increment 1's door checks, posts a
-- fixed command message through team_hub_post_message, creates the task through Operations'
-- existing writer public.plan_assign_task_scoped (unchanged) with the caller's own identity and
-- the fenced workspace, and links the two in team_hub_work_refs. All of that is one transaction:
-- any refusal from Operations rolls back the message and the link and returns a mapped code.
-- Operations' writer is not idempotent, so this door is what makes a request exactly-once: the
-- message is stored first under (author, client_request_id), so a retry, or a concurrent retry
-- waiting on that unique key, finds the original and never reaches Operations again.
-- The link stores no status, title, assignee or due date. Status is read from the Operations
-- record itself, through the caller's own RLS, by the client.
-- The table is RLS-on with no policies and no browser grant; the doors re-check the caller in
-- their bodies (§59). Expected refusals return {"ok":false,"code":...}; nothing raises.
-- Forward-only and replay-safe: a second apply changes nothing.
BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE TABLE IF NOT EXISTS public.team_hub_work_refs (
 message_id uuid PRIMARY KEY REFERENCES public.team_hub_messages(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL,
 channel_id uuid NOT NULL,
 -- Widened only by a later owner-approved increment.
 work_source text NOT NULL CHECK (work_source='planning'),
 work_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT team_hub_work_refs_work_key UNIQUE (tenant_id, work_source, work_id)
);
CREATE INDEX IF NOT EXISTS team_hub_work_refs_list_idx
 ON public.team_hub_work_refs (tenant_id, created_at DESC, message_id DESC);

ALTER TABLE public.team_hub_work_refs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_hub_work_refs FROM PUBLIC, anon, authenticated;

-- Storage backstop. The door writes only matching rows; a direct write that skips it still fails.
CREATE OR REPLACE FUNCTION public._team_hub_work_ref_scope_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.team_hub_messages m WHERE m.id=NEW.message_id
   AND m.tenant_id=NEW.tenant_id AND m.channel_id=NEW.channel_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_WORK_REF_SCOPE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_work_ref_scope_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER team_hub_work_ref_scope BEFORE INSERT OR UPDATE OF message_id, tenant_id, channel_id
 ON public.team_hub_work_refs FOR EACH ROW EXECUTE FUNCTION public._team_hub_work_ref_scope_guard();

-- Increment 1's message shape, plus work_ref: {source, id} when the message started a task, else
-- null. Every door that returns a message (list, thread, post, request_task) carries it.
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
   FROM public.team_hub_work_refs w WHERE w.message_id=p_message.id))
$$;
REVOKE ALL ON FUNCTION public._team_hub_message_json(public.team_hub_messages) FROM PUBLIC, anon, authenticated, service_role;

-- The retry check comes before input validation, as in team_hub_post_message: a retry after the
-- due date has passed, or with an edited draft, still returns the original and creates nothing.
-- The same request id on a plain message, or in another conversation, is a client error.
-- The assignee must be an active seat in this workspace (invalid otherwise), checked before
-- Operations is reached; who may assign whom stays Operations' rule.
-- Inside the block, any refusal is raised so the subtransaction rolls back: the message, a team
-- channel join or DM restore that posting made, the task and the link all go together.
CREATE OR REPLACE FUNCTION public.team_hub_request_task(p_expected_tenant uuid, p_channel_id uuid, p_title text,
 p_assignee uuid, p_due_at timestamptz, p_client_request_id uuid, p_parent_message_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
 task_title text:=public._team_hub_trim(p_title); msg public.team_hub_messages; posted jsonb; ops jsonb; work uuid;
 err text; err_hint text; err_state text; code text;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF p_client_request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT * INTO msg FROM public.team_hub_messages m WHERE m.author_user_id=actor AND m.client_request_id=p_client_request_id;
 IF FOUND THEN
  IF msg.channel_id<>ch.id OR NOT EXISTS(SELECT 1 FROM public.team_hub_work_refs w WHERE w.message_id=msg.id) THEN
   RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
 END IF;
 IF task_title IS NULL OR char_length(task_title) NOT BETWEEN 1 AND 500
   OR p_assignee IS NULL OR NOT public._team_hub_is_active(p_expected_tenant,p_assignee)
   OR (p_due_at IS NOT NULL AND (NOT isfinite(p_due_at) OR p_due_at<now())) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 BEGIN
  posted:=public.team_hub_post_message(p_expected_tenant,ch.id,'/PAIGE draft a task',p_client_request_id,p_parent_message_id,'{}');
  IF posted->>'ok' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'TEAM_HUB_REQUEST_REFUSED' USING HINT=coalesce(posted->>'code','failed'); END IF;
  SELECT * INTO msg FROM public.team_hub_messages m WHERE m.id=(posted#>>'{message,id}')::uuid;
  IF NOT FOUND OR msg.author_user_id<>actor OR msg.client_request_id<>p_client_request_id OR msg.channel_id<>ch.id THEN
   RAISE EXCEPTION 'TEAM_HUB_REQUEST_REFUSED' USING HINT='invalid'; END IF;
  IF posted ? 'duplicate' THEN
   -- A concurrent retry stored it first and has committed, so its task and link are visible now.
   IF NOT EXISTS(SELECT 1 FROM public.team_hub_work_refs w WHERE w.message_id=msg.id) THEN
    RAISE EXCEPTION 'TEAM_HUB_REQUEST_REFUSED' USING HINT='invalid'; END IF;
   RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
  END IF;
  ops:=public.plan_assign_task_scoped(p_expected_actor_id:=actor,p_expected_tenant_id:=p_expected_tenant,
   p_title:=task_title,p_assigned_to_user_id:=p_assignee,p_due_at:=p_due_at);
  work:=nullif(ops->>'item_id','')::uuid;
  IF ops->>'ok' IS DISTINCT FROM 'true' OR work IS NULL THEN RAISE EXCEPTION 'PLAN_CREATE_UNCONFIRMED'; END IF;
  INSERT INTO public.team_hub_work_refs(message_id,tenant_id,channel_id,work_source,work_id,created_by)
   VALUES (msg.id,p_expected_tenant,ch.id,'planning',work,actor);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS err=MESSAGE_TEXT, err_hint=PG_EXCEPTION_HINT, err_state=RETURNED_SQLSTATE;
  code:=CASE
   WHEN err='TEAM_HUB_REQUEST_REFUSED' THEN err_hint
   WHEN err='PLAN_SCOPE_CHANGED' THEN 'scope_changed'
   -- The scoped wrapper's assignment rule, and the canonical writer's own teammate rule beneath it.
   WHEN err='PLAN_ASSIGNMENT_FORBIDDEN' OR err LIKE 'PLAN\_FORBIDDEN: assigning%' THEN 'not_allowed'
   WHEN err LIKE 'PLAN\_FORBIDDEN%' THEN 'unavailable'
   WHEN err IN ('PLAN_TASK_INPUT_INVALID','PLAN_ASSIGNEE_NOT_IN_TENANT') THEN 'invalid'
   ELSE 'failed' END;
  -- The browser only ever sees "failed"; the cause goes to the server log, never swallowed (§32).
  -- Server log only (LOG is below the default client_min_messages), the error text and SQLSTATE only.
  IF code='failed' THEN RAISE LOG 'team_hub_request_task: Operations did not create the task: % (SQLSTATE %)', err, err_state; END IF;
  RETURN jsonb_build_object('ok',false,'code',code);
 END;
 RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg));
END $$;
REVOKE ALL ON FUNCTION public.team_hub_request_task(uuid,uuid,text,uuid,timestamptz,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_request_task(uuid,uuid,text,uuid,timestamptz,uuid,uuid) TO authenticated;

-- The links of conversations the caller can see now, newest first. No status: the client reads
-- each record from Operations through its own RLS and says so when it cannot.
-- parent_message_id lets a row that started in a thread open that thread.
CREATE OR REPLACE FUNCTION public.team_hub_list_work(p_expected_tenant uuid, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant);
 lim int:=greatest(1,least(100,coalesce(p_limit,50))); items jsonb;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('message_id',s.message_id,'channel_id',s.channel_id,
   'parent_message_id',s.parent_message_id,'source',s.work_source,'work_id',s.work_id,
   'created_by',s.created_by,'created_at',s.created_at) ORDER BY s.created_at DESC, s.message_id DESC),'[]'::jsonb) INTO items
 FROM (SELECT w.message_id, w.channel_id, m.parent_message_id, w.work_source, w.work_id, w.created_by, w.created_at
  FROM public.team_hub_work_refs w JOIN public.team_hub_messages m ON m.id=w.message_id AND m.deleted_at IS NULL
  WHERE w.tenant_id=p_expected_tenant AND EXISTS(SELECT 1 FROM public._team_hub_visible(p_expected_tenant,actor,w.channel_id))
  ORDER BY w.created_at DESC, w.message_id DESC LIMIT lim) s;
 RETURN jsonb_build_object('ok',true,'items',items);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_list_work(uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_list_work(uuid,int) TO authenticated;

-- A10: the link table goes with the account at retirement, like increment 1's tables. The same
-- guarded patch, reconciled against increment 1's registration of team_hub_messages.
DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer; BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=position(anchor IN body);
 IF position('''team_hub_work_refs''' IN body)>0 THEN RETURN; END IF;
 IF at=0 OR position('''team_hub_messages''' IN body)=0 THEN
  RAISE EXCEPTION 'Canonical retirement policy requires reconciliation before registering Team Hub work references'; END IF;
 EXECUTE left(body,at+length(anchor)-1)||'''team_hub_work_refs'','||substr(body,at+length(anchor));
END $$;
COMMIT;
