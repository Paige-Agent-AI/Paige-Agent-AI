-- INT-1807 continuation (#1807 / INT-304 CL-2): the canonical refusal/non-application record
-- the outcome classifier has been waiting for. `classifyPipelineObservation`
-- (_shared/pipeline-metadata-reconciliation.ts) accepts refused_before_dispatch /
-- failed_not_applied only from "a protected pre-dispatch or explicit provider
-- non-application record, with the complete original binding" — this migration is that
-- record's canonical home and its two read/write seams.
--
-- WHAT IS RECORDED — exactly one provably-safe class today: a database-ANSWERED refusal
-- of the single-RPC Pipeline door call (configure_tenant_pipeline / _as_paige). A
-- SQLSTATE/PGRST-coded error is the database itself answering; that one transaction
-- rolled back whole, so nothing the command would have written was written
-- (_shared/approval-outcome.ts `databaseAnswered` / `refusedByDatabase` doctrine).
-- Transport failures, timeouts and lost answers are NEVER recorded — they stay
-- outcome_unknown. `refused_before_dispatch` needs the door's own typed pre-dispatch
-- vocabulary (Pipeline-owned) and is reserved in the CHECK for that future producer.
--
-- AUTHORITY: this record settles, retries, releases and dispatches nothing. It is an
-- observation a later authenticated status read may classify — never permission. The
-- write seam is service-only (the chat handler calls it beside the door call it just
-- witnessed); every binding field is derived server-side from the thread and the
-- consumed confirmation row, never from request JSON. The read seam revalidates the
-- full protected lineage (discovery + original resolver) before returning evidence.
--
-- Numbering: RENUMBERED 20270602000411 -> 20270602000430 after the production frontier
-- advanced to 20270602000423 and open-PR claims to 20270602000428 mid-flight (the
-- chronic below-frontier race; deploy-migrations refuses an unrecorded older entry).
begin;
create table if not exists public.pipeline_metadata_non_application (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  actor_user_id uuid not null,
  thread_id uuid not null,
  intent_id uuid not null,
  -- The consumed paige_pending_confirmations row this observation belongs to; one
  -- record per effect (the first definite answer stands, replays change nothing).
  effect_id uuid not null,
  idempotency_key text not null,
  command_hash text not null,
  -- The consumed card's issued_in_request: the scope identity of the original proposal
  -- (C4a card token right half). Re-derived by the reader from the same card.
  scope_epoch text not null,
  sqlstate text not null constraint pipeline_non_application_sqlstate
    check (sqlstate ~ '^[0-9A-Z]{5}$' or sqlstate ~ '^PGRST[0-9]{3}$'),
  kind text not null constraint pipeline_non_application_kind
    check (kind in ('refused_before_dispatch', 'failed_not_applied')),
  created_at timestamptz not null default now(),
  constraint pipeline_non_application_effect_unique unique (effect_id)
);
alter table public.pipeline_metadata_non_application enable row level security;
revoke all on public.pipeline_metadata_non_application from public, anon, authenticated;

-- Service-only write. The caller supplies only references it holds at the dispatch seam:
-- the thread, the interactive intent, the C4a card token (fingerprint:issued_in_request)
-- and the database's own answer code. Tenant, actor, effect, idempotency key, command
-- hash and scope epoch are derived from the thread and the consumed card.
create or replace function public.record_pipeline_metadata_non_application(
  p_thread uuid, p_intent uuid, p_token text, p_sqlstate text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_thread public.paige_chat_threads%rowtype;
  v_card public.paige_pending_confirmations%rowtype;
  v_fingerprint text;
  v_nonce uuid;
  v_id uuid;
begin
  if p_thread is null or p_intent is null or p_token is null or p_sqlstate is null
   or position(':' in p_token) = 0 then raise exception 'PIPELINE_NON_APPLICATION_BINDING_INVALID'; end if;
  v_fingerprint := split_part(p_token, ':', 1);
  if v_fingerprint !~ '^[0-9a-f]{16}$'
   or split_part(p_token, ':', 2) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or (p_sqlstate !~ '^[0-9A-Z]{5}$' and p_sqlstate !~ '^PGRST[0-9]{3}$')
   then raise exception 'PIPELINE_NON_APPLICATION_BINDING_INVALID'; end if;
  v_nonce := split_part(p_token, ':', 2)::uuid;
  select * into v_thread from public.paige_chat_threads t
   where t.id = p_thread and t.tenant_id is not null and t.caller_user_id is not null;
  if not found then raise exception 'PIPELINE_NON_APPLICATION_BINDING_INVALID'; end if;
  -- The card this observation belongs to: the caller's own thread, the Pipeline tool,
  -- server-issued, minted by the named request, and CONSUMED (the claim precedes
  -- dispatch; an unspent card's refusal is answered on its card, not here). The command
  -- shape mirrors read_pipeline_metadata_original so a record can only exist for an
  -- effect whose original command that resolver would accept.
  select * into v_card from public.paige_pending_confirmations c
   where c.thread_id = p_thread and c.user_id = v_thread.caller_user_id
   and c.tenant_id = v_thread.tenant_id and c.tool_name = 'pipeline_configure'
   and c.fingerprint = v_fingerprint and c.issued_in_request = v_nonce
   and c.server_issued_at is not null and c.consumed_at is not null;
  if not found or jsonb_typeof(v_card.args->'command') is distinct from 'object'
   or v_card.args->'command'->>'type' is distinct from 'update-pipeline'
   or jsonb_typeof(v_card.args->'idempotency_key') is distinct from 'string'
   or coalesce(v_card.args->>'idempotency_key', '') = ''
   then raise exception 'PIPELINE_NON_APPLICATION_BINDING_INVALID'; end if;
  insert into public.pipeline_metadata_non_application(
    tenant_id, actor_user_id, thread_id, intent_id, effect_id,
    idempotency_key, command_hash, scope_epoch, sqlstate, kind)
  values (
    v_thread.tenant_id, v_thread.caller_user_id, p_thread, p_intent, v_card.id,
    v_card.args->>'idempotency_key', md5((v_card.args->'command')::text),
    v_card.issued_in_request::text, p_sqlstate, 'failed_not_applied')
  on conflict (effect_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.pipeline_metadata_non_application r where r.effect_id = v_card.id;
  end if;
  return v_id;
end $$;
revoke all on function public.record_pipeline_metadata_non_application(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_pipeline_metadata_non_application(uuid,uuid,text,text) to service_role;

-- Authenticated-only read. Composes the two frozen #1807 lineage validators — the
-- caller-bound original-effect discovery and the original-operation resolver — then
-- returns classifier-shaped evidence ONLY when a non-application record exists for
-- exactly that effect with exactly the derived binding. No record, or any mismatch,
-- returns null: the caller stays honestly on outcome_unknown. This function performs
-- no mutation and grants no settlement, retry, release or continuation authority.
create or replace function public.read_pipeline_metadata_observation(
  _thread uuid, _intent uuid, _effect uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid := public.current_user_tenant_id();
  v_effect uuid;
  v_original jsonb;
  v_card public.paige_pending_confirmations%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or v_actor is null or v_tenant is null
   or _thread is null or _intent is null then return null; end if;
  v_effect := public.find_pipeline_metadata_original_effect(_thread, _intent);
  if v_effect is null or (_effect is not null and v_effect is distinct from _effect) then return null; end if;
  v_original := public.read_pipeline_metadata_original(_thread, _intent, v_effect);
  if v_original is null then return null; end if;
  select * into v_card from public.paige_pending_confirmations c
   where c.id = v_effect and c.thread_id = _thread and c.user_id = v_actor
   and c.tenant_id = v_tenant and c.tool_name = 'pipeline_configure'
   and c.server_issued_at is not null and c.issued_in_request is not null
   and c.consumed_at is not null;
  if not found then return null; end if;
  if not exists(select 1 from public.pipeline_metadata_non_application r
   where r.effect_id = v_effect and r.tenant_id = v_tenant and r.actor_user_id = v_actor
   and r.thread_id = _thread and r.intent_id = _intent
   and r.idempotency_key = v_original->>'idempotencyKey'
   and r.command_hash = v_original->>'commandHash'
   and r.scope_epoch = v_card.issued_in_request::text) then return null; end if;
  return jsonb_build_object(
    'authoritative', true, 'effect', 'none', 'conflicting', false,
    'kind', (select r.kind from public.pipeline_metadata_non_application r where r.effect_id = v_effect),
    'binding', jsonb_build_object(
      'tenantId', v_tenant, 'actorId', v_actor, 'threadId', _thread,
      'intentId', _intent, 'operationId', v_effect,
      'scopeEpoch', v_card.issued_in_request::text));
end $$;
revoke all on function public.read_pipeline_metadata_observation(uuid,uuid,uuid) from public, anon, service_role;
grant execute on function public.read_pipeline_metadata_observation(uuid,uuid,uuid) to authenticated;
commit;
