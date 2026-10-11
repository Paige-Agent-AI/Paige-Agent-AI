-- INT-304 C4d (CL-3): the authorized continuation-fields read. The pure eligibility
-- projection (`_shared/durable-job/continuation.ts` projectDurableContinuation) has had
-- zero runtime callers because nothing selects the canonical envelope's internal fields
-- under fresh authorization — this function is that server adapter's SQL half.
--
-- Read-only and inert by construction: it validates exactly like the frozen durable
-- observation reader (20270601000014) — authenticated caller, owned active thread whose
-- CURRENT intent is the work's conversational intent, active tenant membership, the
-- caller-bound work row, the document/research capability class, CURRENT owner/admin
-- permission (an initiating actor or a historical authority snapshot is not permission),
-- and exactly-one durable_accepted protected effect binding the work to this intent —
-- then returns the fields the projection pins. It grants nothing: eligibility means only
-- that bounded terminal context may be explained. No dispatch, wake, settlement, retry,
-- approval or exactly-once consumption exists here or is implied.
--
-- Numbering: RENUMBERED 20270602000412 -> 20270602000431 in the same frontier race as
-- 430 (prod frontier 20270602000423, open-PR claims 20270602000428).
begin;
create or replace function public.read_paige_durable_continuation(
 _thread uuid, _intent uuid, _work uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
 actor uuid := auth.uid();
 tenant uuid := public.current_user_tenant_id();
 t public.paige_chat_threads%rowtype;
 w public.paige_durable_work%rowtype;
 matched bigint;
 accepted boolean;
 objective text;
begin
 if auth.role() is distinct from 'authenticated' or actor is null or tenant is null then return null; end if;
 select * into t from public.paige_chat_threads where id = _thread and caller_user_id = actor and tenant_id = tenant and not is_archived;
 if not found or t.interactive_latest_intent is distinct from _intent then return null; end if;
 if not exists(select 1 from public.tenants where id = tenant and status = 'active')
  or not exists(select 1 from public.tenant_members where tenant_id = tenant and user_id = actor and status = 'active') then return null; end if;
 select * into w from public.paige_durable_work where id = _work and thread_id = _thread and tenant_id = tenant and initiating_user_id = actor;
 if not found then return null; end if;
 if not ((w.capability_key = 'document_generate' and w.work_kind = 'document_authoring')
  or (w.capability_key = 'deep_research' and w.work_kind = 'research')) then return null; end if;
 if not(public.has_tenant_role(actor, tenant, 'owner') or public.has_tenant_role(actor, tenant, 'admin')) then return null; end if;
 select count(*), bool_and(e->>'outcome' = 'durable_accepted' and e->>'tool' = w.capability_key)
  into matched, accepted
  from public.paige_chat_turns r cross join lateral jsonb_array_elements(
   case when jsonb_typeof(r.bundle_ref->'interactive'->'effects') = 'array'
    then r.bundle_ref->'interactive'->'effects' else '[]'::jsonb end) e
  where r.thread_id = _thread and r.role = 'assistant' and r.interactive_intent_id = _intent
   and r.interactive_actor_id = actor and r.interactive_tenant_id = tenant
   and r.interactive_terminal_state is not null and e->>'work_id' = _work::text;
 if matched <> 1 or accepted is distinct from true then return null; end if;
 -- The canonical objective is read from the frozen request payload — never reconstructed
 -- from a new prompt or a model response. Same source the projection pins it against.
 objective := case w.work_kind
  when 'document_authoring' then w.request_payload->>'brief'
  when 'research' then w.request_payload->>'question' end;
 if nullif(btrim(coalesce(objective, '')), '') is null then return null; end if;
 return jsonb_build_object(
  'workId', w.id, 'tenantId', tenant, 'actorId', actor, 'threadId', _thread,
  'intentId', _intent, 'workIntentId', w.intent_id, 'scopeEpoch', w.scope_epoch,
  'capabilityKey', w.capability_key, 'workKind', w.work_kind,
  'status', w.status, 'settledAt', w.settled_at,
  'terminalOutcome', w.terminal_outcome, 'errorCode', w.error_code,
  'blockedReason', w.blocked_reason,
  'canonicalObjective', objective,
  'approvalPending', (w.status = 'blocked' and w.blocked_reason = 'approval_expired'));
end $$;
revoke all on function public.read_paige_durable_continuation(uuid,uuid,uuid) from public, anon, service_role;
grant execute on function public.read_paige_durable_continuation(uuid,uuid,uuid) to authenticated;
commit;
