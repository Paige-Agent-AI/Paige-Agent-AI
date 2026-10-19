-- Common Chat publication context, not approval or execution authority.
-- One STABLE calling-query snapshot binds canonical terminal/latest/release to
-- the caller's original thread scope; separate scope/state reads can mix epochs.
-- Preserve native begin_v2 agency/operator and tenantless-owner semantics.
-- Non-null threads additionally require the explicitly selected workspace,
-- so current_user_tenant_id's first-membership fallback cannot select a context.
begin;

create or replace function public.paige_chat_interactive_publication_context_v2(
  p_thread uuid,
  p_intent uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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
          (t.tenant_id is not null
            and exists (
              select 1 from public.profiles p
              where p.user_id = auth.uid()
                and p.active_tenant_id = t.tenant_id
            )
            and public.current_user_tenant_id() = t.tenant_id)
          or (t.tenant_id is null and public.is_platform_owner() is true)
        )
        and public.paige_chat_interactive_evidence(
          t.id, auth.uid(), t.tenant_id, p_intent
        ) @> '{"terminal":true,"stopped":false}'::jsonb
    );
$$;

revoke all on function public.paige_chat_interactive_publication_context_v2(uuid,uuid)
  from public, anon, service_role;
grant execute on function public.paige_chat_interactive_publication_context_v2(uuid,uuid)
  to authenticated;
comment on function public.paige_chat_interactive_publication_context_v2(uuid,uuid) is
  'Caller-bound, single-snapshot canonical publication context only. Does not grant approval, execute, settle, release, or lease future workspace state.';

commit;
