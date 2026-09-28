-- A member's private conversation with Paige is hidden from an operator by default, openable on
-- purpose, and recorded when opened.
--
-- THE DEFECT (owner live drive, 2026-09-28). A super_admin acting as a workspace opened the PAIGE
-- panel and it resumed a member's private conversation, presented as the operator's own. The
-- panel lists the active workspace's coach-lens threads and relies on RLS for whose they are; the
-- SELECT policies on paige_chat_threads and paige_chat_turns admitted `is_platform_owner()` to every
-- thread in every workspace. The same widening reached Paige herself: `paige_operating_memory()`
-- is SECURITY INVOKER and folds up to three of the workspace's thread summaries into the prompt,
-- so an acting super_admin's Paige could draw on members' private conversations.
--
-- THE RULING (owner, relayed 2026-09-28): hidden by default, openable on purpose, audited when
-- opened; the super_admin carve-out is not removed — it stops being what the default view leans
-- on; a client filter alone is not a fix, so the server permission changes in the same change.
--
-- WHAT CHANGES
--   * The two SELECT policies admit a super_admin, through RLS, to their OWN threads and to
--     contact-bound threads (client conversations, which workspace admins already read). A
--     member's private thread (contact_id IS NULL, someone else's) is no longer an RLS read for
--     anyone but its owner. That closes the panel's default list, the transcript read behind it,
--     and paige_operating_memory()'s continuity block, with no change to either function.
--   * The carve-out moves, it is not deleted: `operator_open_member_thread()` lets an operator who
--     holds `tenant.member_threads.read` open one member's thread in the workspace they are acting
--     as, and records who opened which thread in which workspace, when. That capability is not in
--     G1's catalogue, so by G1's default rule (R0) only super_admin holds it — the tier the
--     carve-out already belonged to — and it widens only by a catalogue row.
--   * `operator_list_member_threads()` lets that operator see that such threads exist (whose, how
--     long, when last active) without their titles, which are derived from the first message.
--
-- WHAT ELSE CHANGES: the DELETE policy's platform branch reaches only contact-bound threads, so a
-- super_admin cannot delete a member's private thread. Studio-session threads (which the panel lists
-- in the Studio gallery, not here) are outside the member list and the open.
--
-- WHAT DOES NOT CHANGE: INSERT/UPDATE policies (self only); the RESTRICTIVE tenant isolation; every
-- SECURITY DEFINER writer (they keep their own owner checks).


-- The open act-as comes from operator_open_act_as_tenant(), defined by 20270513000000 (#1554): the
-- operator's pointer, where their most recent operator.tenant.enter/exit receipt is an enter for that
-- workspace, and receipts are server-written only. One home for "is this act-as real" (§18); this
-- migration therefore needs #1554's applied first, which its version order guarantees.

DROP POLICY IF EXISTS threads_select_owner_or_admin ON public.paige_chat_threads;
CREATE POLICY threads_select_owner_or_admin ON public.paige_chat_threads
  FOR SELECT TO authenticated
  USING (
    (is_platform_owner() AND (caller_user_id = auth.uid() OR contact_id IS NOT NULL))
    OR ((tenant_id = current_user_tenant_id())
        AND ((caller_user_id = auth.uid()) OR ((contact_id IS NOT NULL) AND is_tenant_admin(tenant_id))))
  );

-- The platform branch of DELETE reaches only contact-bound threads. Postgres checks the SELECT
-- policy on a DELETE only when the statement reads a column, so a bare DELETE would otherwise still
-- reach a member's private thread (independent review; PostgREST's safeupdate blocks it on the web
-- API, but the policy should not lean on that).
DROP POLICY IF EXISTS threads_delete_owner_or_platform ON public.paige_chat_threads;
CREATE POLICY threads_delete_owner_or_platform ON public.paige_chat_threads
  FOR DELETE TO authenticated
  USING (caller_user_id = auth.uid() OR (is_platform_owner() AND contact_id IS NOT NULL));

DROP POLICY IF EXISTS turns_select_via_thread ON public.paige_chat_turns;
CREATE POLICY turns_select_via_thread ON public.paige_chat_turns
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.paige_chat_threads t
      WHERE t.id = paige_chat_turns.thread_id
        AND (
          (is_platform_owner() AND (t.caller_user_id = auth.uid() OR t.contact_id IS NOT NULL))
          OR ((t.tenant_id = current_user_tenant_id())
              AND ((t.caller_user_id = auth.uid()) OR ((t.contact_id IS NOT NULL) AND is_tenant_admin(t.tenant_id))))
        )
    )
  );

-- The members' private threads in the workspace the caller is acting as: who, how many messages,
-- when last active. No title and no content. Other people's only; the caller's own threads are
-- already theirs to read.
CREATE OR REPLACE FUNCTION public.operator_list_member_threads()
RETURNS TABLE (
  thread_id uuid,
  owner_name text,
  message_count integer,
  last_message_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
begin
  -- Both grants, every call: reading a member's thread is a narrower act inside act-as, so withdrawing
  -- tenant.act_as closes it too, even inside an act-as already open (Codex review of 1b81bb3d).
  if auth.uid() is null
     or not public.operator_may('tenant.act_as')
     or not public.operator_may('tenant.member_threads.read') then
    raise exception 'operator_member_threads_not_permitted' using errcode = '42501';
  end if;
  v_tenant := public.operator_open_act_as_tenant();
  if v_tenant is null then
    raise exception 'operator_not_acting' using errcode = '42501';
  end if;
  return query
    select t.id,
           coalesce(nullif(btrim(pr.full_name), ''),
                    nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
                    'A member of this workspace'),
           coalesce(t.message_count, 0)::integer,
           t.last_message_at,
           t.created_at
    from public.paige_chat_threads t
    left join public.profiles pr on pr.user_id = t.caller_user_id
    where t.tenant_id = v_tenant
      and t.contact_id is null
      and t.studio_session_id is null
      and t.caller_user_id is distinct from auth.uid()
      and coalesce(t.is_archived, false) = false
    order by t.last_message_at desc nulls last, t.created_at desc;
end;
$function$;

REVOKE ALL ON FUNCTION public.operator_list_member_threads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_list_member_threads() TO authenticated;

-- Open one member's private thread, on purpose. Records the operator, the thread, the workspace and
-- the time before anything is returned; a refused open returns nothing and records nothing.
CREATE OR REPLACE FUNCTION public.operator_open_member_thread(_thread_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_thread public.paige_chat_threads%rowtype;
  v_owner_name text;
  v_turns jsonb;
begin
  -- Both grants, every call: reading a member's thread is a narrower act inside act-as, so withdrawing
  -- tenant.act_as closes it too, even inside an act-as already open (Codex review of 1b81bb3d).
  if auth.uid() is null
     or not public.operator_may('tenant.act_as')
     or not public.operator_may('tenant.member_threads.read') then
    raise exception 'operator_member_threads_not_permitted' using errcode = '42501';
  end if;
  v_tenant := public.operator_open_act_as_tenant();
  if v_tenant is null then
    raise exception 'operator_not_acting' using errcode = '42501';
  end if;

  select * into v_thread from public.paige_chat_threads where id = _thread_id;
  if not found
     or v_thread.tenant_id is distinct from v_tenant
     or v_thread.contact_id is not null
     or v_thread.studio_session_id is not null
     or v_thread.caller_user_id is not distinct from auth.uid() then
    -- One answer for "no such thread", "another workspace's" and "not a member's private thread",
    -- so the refusal says nothing about threads the caller may not see.
    raise exception 'member_thread_not_available' using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(pr.full_name), ''),
                  nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
                  'A member of this workspace')
    into v_owner_name
  from public.profiles pr where pr.user_id = v_thread.caller_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'role', tu.role, 'content', tu.content, 'createdAt', tu.created_at) order by tu.seq), '[]'::jsonb)
    into v_turns
  from public.paige_chat_turns tu
  where tu.thread_id = v_thread.id and tu.role in ('user', 'assistant');

  INSERT INTO public.paige_audit_log
    (actor_user_id, actor_role, action, target_type, target_id, tenant_id, payload)
  VALUES
    (auth.uid(), 'platform_operator', 'operator.thread.open', 'paige_chat_thread', v_thread.id, v_tenant,
     jsonb_build_object('owner_user_id', v_thread.caller_user_id,
                        'turn_count', jsonb_array_length(v_turns)));

  return jsonb_build_object(
    'threadId', v_thread.id,
    'ownerName', coalesce(v_owner_name, 'A member of this workspace'),
    'title', v_thread.title,
    'lastMessageAt', v_thread.last_message_at,
    'turns', v_turns
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.operator_open_member_thread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_open_member_thread(uuid) TO authenticated;
