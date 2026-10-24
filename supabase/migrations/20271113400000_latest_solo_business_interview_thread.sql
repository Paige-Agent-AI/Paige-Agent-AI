-- EXP01 PR4: the resume door for an unfinished private Solo interview.
-- A returning owner re-entering onboarding must land back in their own
-- unfinished interview conversation, not a blank one. This lookup finds the
-- caller's most recent interview checkpoint across their OWN threads in their
-- canonical Solo workspace and returns ONLY {threadId, phase,
-- checkpointUpdatedAt} — no transcript, no facts: metadata is a navigation
-- hint and consumers must re-read canonical Setup (the sibling contract).
--
-- Authority mirrors the sibling checkpoint read: the caller's own canonical
-- workspace, their own threads. Validation is the sibling's own — a checkpoint
-- the sibling refuses (malformed or caller-forged) is skipped here, never
-- trusted. The newest VALID checkpoint decides: 'active'/'paused' resumes;
-- 'completed' retires the lookup (an older 'active' thread behind a completed
-- interview is a stale chapter, never a resume target).
begin;

create or replace function public.latest_solo_business_interview_thread()
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tid uuid := public.solo_setup_assert_canonical_tenant_for_read();
  v_cp jsonb;
  v_thread record;
begin
  if v_uid is null then return null; end if;
  for v_thread in
    -- Candidate threads: the CALLER's own threads in this workspace that carry
    -- a checkpoint namespace on a genuine non-terminal USER turn. The thread-
    -- shape predicates mirror what the sibling assert requires (private coach
    -- lens, no contact/studio scope, not archived) so rejected shapes never
    -- burn candidate slots ahead of a valid unfinished thread. Grouped per
    -- thread, newest activity first; only the first few can matter.
    select th.id as thread_id
    from public.paige_chat_threads th
    join public.paige_chat_turns t on t.thread_id = th.id
    where th.tenant_id = v_tid
      and th.caller_user_id = v_uid
      and th.lens = 'coach'
      and th.contact_id is null
      and th.studio_session_id is null
      and not th.is_archived
      and t.role = 'user'
      and t.interactive_terminal_state is null
      and t.work_id is null
      and t.bundle_ref ? 'solo_business_interview'
    group by th.id
    order by max(t.created_at) desc
    limit 8
  loop
    -- The sibling's own validation decides what counts as an interview
    -- checkpoint; a per-thread refusal (forged metadata, foreign thread) is
    -- a skip, not a failure of the lookup.
    begin
      v_cp := public.get_solo_business_interview_checkpoint(v_thread.thread_id);
    exception when others then
      v_cp := null;
    end;
    if v_cp is null then continue; end if;
    if v_cp->>'phase' in ('active','paused') then
      return jsonb_build_object(
        'threadId', v_thread.thread_id,
        'phase', v_cp->>'phase',
        'checkpointUpdatedAt', v_cp->'checkpointUpdatedAt');
    end if;
    -- The caller's newest valid interview position is completed: nothing
    -- unfinished remains to resume.
    return null;
  end loop;
  return null;
end $$;

revoke all on function public.latest_solo_business_interview_thread() from public,anon,service_role;
grant execute on function public.latest_solo_business_interview_thread() to authenticated;

comment on function public.latest_solo_business_interview_thread() is
  'Owner-only navigation hint: the caller''s own most recent unfinished private Solo interview thread. Returns only {threadId, phase, checkpointUpdatedAt} — no transcript or facts; consumers must re-read canonical Setup.';
commit;
