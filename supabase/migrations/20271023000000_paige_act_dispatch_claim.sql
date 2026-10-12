-- INT-179 Slice 2b · at-most-once dispatch for Layer-C acts, and no overwrite of an act that is in flight.
--
-- Two gaps in the act ledger (20270126000000), both latent today because only the native journey-stage
-- adapter dispatches and its effect is reconciled by correlation, and both fatal for any adapter whose effect
-- cannot be re-read (an external provider):
--
--   (1) IN-FLIGHT OVERWRITE. paige_record_act_execution refused writes only FROM a final row. A row that is
--       in flight (accepted_for_execution · retrying · ambiguous) could be overwritten by any incoming outcome,
--       including a freshly re-derived DECISION (held_by_lane, approval_pending, refused_*) — which is final, so
--       a re-drain could re-hold an act whose effect may already have landed, and it could then be approved and
--       fired a second time. It also REPLACED `detail` on every write, dropping the immutable snapshot args and
--       anything a prior writer recorded. Now: a decision never overwrites an in-flight row, an in-flight row
--       never moves back to accepted_for_execution, and `detail` is merged (the incoming keys win, except
--       the two dispatch-claim keys, which only the claim RPC may write).
--
--   (2) NO DISPATCH CLAIM. The engine wrote accepted_for_execution and then dispatched; the approval executor
--       redeemed and then dispatched. Neither could tell whether another caller was already dispatching the
--       same act — the redeem RPC returns accepted_for_execution whether this call redeemed it or another did.
--       paige_claim_act_dispatch is the one at-most-once gate: a single guarded UPDATE that stamps a claim into
--       `detail` only when no live claim exists, so of any number of concurrent callers exactly one gets the row
--       back and may dispatch. The outcome is NOT changed, so the reconciler, the resume path and the engine's
--       reconcile set keep working exactly as before. A claim older than the stale window (default 10 minutes,
--       never less than 7 — longer than the 400 s edge-function wall-clock cap, so a live runner's claim is never
--       re-taken) may be re-taken, so a runner that died after claiming does not wedge the act; callers re-take
--       only after their own readback found no landed effect.
--
-- Service-role only, both functions (§59: auth.uid() IS NULL re-enforced in-body; no anon/authenticated grant).

create or replace function public.paige_record_act_execution(
  _event_id       uuid,
  _automation_id  uuid,
  _act_id         uuid,
  _act_position   int,
  _tenant_id      uuid,
  _adapter_kind   text,
  _capability_key text,
  _effective_lane text,
  _outcome        public.paige_act_outcome,
  _refusal_code   text,
  _idempotency_key text,
  _correlation_ref text,
  _provider_ref   text,
  _detail         jsonb,
  _error          text,
  _dispatched_at  timestamptz default null,
  _settled_at     timestamptz default null
) returns public.paige_act_executions
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _row public.paige_act_executions;
  -- Outcomes that are FINAL for the drainer (unchanged from 20270126000000; pinned to outcomes.ts
  -- FINAL_OUTCOMES by the drift guard).
  _final constant text[] := array[
    'condition_not_matched','held_by_lane','approval_pending',
    'refused_authority','refused_budget','refused_trust_compass','refused_consent',
    'executed','failed','cancelled'
  ];
  -- The DECISION outcomes: the final outcomes that record what the engine decided rather than what a dispatch
  -- did. A decision is re-derived on every drain, so it must never land on a row whose dispatch is in flight.
  _decision constant text[] := array[
    'condition_not_matched','held_by_lane','approval_pending',
    'refused_authority','refused_budget','refused_trust_compass','refused_consent'
  ];
begin
  if auth.uid() is not null then
    raise exception 'ACT_EXECUTION_FORBIDDEN: service role only' using errcode = '42501';
  end if;

  insert into public.paige_act_executions (
    event_id, automation_id, act_id, act_position, tenant_id,
    adapter_kind, capability_key, effective_lane, outcome, refusal_code,
    idempotency_key, correlation_ref, provider_ref, detail, error,
    dispatched_at, settled_at, decided_at
  ) values (
    _event_id, _automation_id, _act_id, _act_position, _tenant_id,
    _adapter_kind, _capability_key, _effective_lane, _outcome, _refusal_code,
    _idempotency_key, coalesce(_correlation_ref, _idempotency_key), _provider_ref,
    -- the dispatch claim is written ONLY by paige_claim_act_dispatch; a ledger write can never set or erase it
    coalesce(_detail, '{}'::jsonb) - 'dispatch_claim' - 'dispatch_claimed_at', _error,
    _dispatched_at, _settled_at, now()
  )
  on conflict (event_id, act_id) do update
     set outcome        = excluded.outcome,
         refusal_code   = excluded.refusal_code,
         adapter_kind   = excluded.adapter_kind,
         capability_key = excluded.capability_key,
         effective_lane = excluded.effective_lane,
         -- never lose a provider correlation id once it is known
         provider_ref   = coalesce(excluded.provider_ref, public.paige_act_executions.provider_ref),
         -- MERGE, never replace: the snapshot args and any dispatch claim survive every later write
         detail         = coalesce(public.paige_act_executions.detail, '{}'::jsonb) || excluded.detail,
         error          = excluded.error,
         dispatched_at  = coalesce(excluded.dispatched_at, public.paige_act_executions.dispatched_at),
         settled_at     = coalesce(excluded.settled_at, public.paige_act_executions.settled_at)
     -- MONOTONIC GUARD (cast the domain column to text so the array comparisons resolve unambiguously):
     --   • a FINAL row is left untouched;
     --   • past that point the row is in flight, so a DECISION never overwrites it;
     --   • and an in-flight row never moves back to accepted_for_execution (that would re-open its dispatch).
     where public.paige_act_executions.outcome::text <> all (_final)
       and excluded.outcome::text <> all (_decision)
       and not (excluded.outcome::text = 'accepted_for_execution'
                and public.paige_act_executions.outcome::text <> 'accepted_for_execution')
  returning * into _row;

  -- If the guard suppressed the UPDATE (RETURNING yields nothing) → return the existing row unchanged, so the
  -- caller sees the persisted truth rather than its own attempt.
  if _row.id is null then
    select * into _row from public.paige_act_executions
     where event_id = _event_id and act_id = _act_id;
  end if;

  return _row;
end $$;

revoke all on function public.paige_record_act_execution(
  uuid, uuid, uuid, int, uuid, text, text, text, public.paige_act_outcome, text,
  text, text, text, jsonb, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.paige_record_act_execution(
  uuid, uuid, uuid, int, uuid, text, text, text, public.paige_act_outcome, text,
  text, text, text, jsonb, text, timestamptz, timestamptz
) to service_role;

-- The one at-most-once dispatch gate. Returns the claimed row, or NULL when another caller holds a live claim
-- or the act is not dispatchable (absent, held, settled, ambiguous). Only the caller that gets a row may fire.
create or replace function public.paige_claim_act_dispatch(
  _event_id    uuid,
  _act_id      uuid,
  _claim       uuid,
  _stale_after interval default interval '10 minutes'
) returns public.paige_act_executions
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _row    public.paige_act_executions;
  -- The floor outlasts the 400 s edge-function wall-clock cap: a caller can never shrink the window enough to
  -- re-take a claim from a runner that may still be alive.
  _window interval := greatest(coalesce(_stale_after, interval '10 minutes'), interval '7 minutes');
begin
  if auth.uid() is not null then
    raise exception 'ACT_DISPATCH_CLAIM_FORBIDDEN: service role only' using errcode = '42501';
  end if;
  if _claim is null then
    raise exception 'ACT_DISPATCH_CLAIM_INVALID: a claim id is required' using errcode = '22023';
  end if;

  -- One statement: concurrent callers serialise on the row lock and the loser re-evaluates the WHERE against
  -- the winner's committed claim, so exactly one gets a row back. `ambiguous` is never claimable — its effect
  -- may have landed and only a correlation reconcile may advance it.
  update public.paige_act_executions
     set detail = coalesce(detail, '{}'::jsonb)
                  || jsonb_build_object('dispatch_claim', _claim::text, 'dispatch_claimed_at', now())
   where event_id = _event_id
     and act_id   = _act_id
     and outcome::text in ('accepted_for_execution', 'retrying')
     -- CASE, not OR: it evaluates in order, so a malformed or missing timestamp is treated as stale (re-takeable)
     -- instead of raising on the cast and wedging every later claim on the row.
     and case
           when detail->>'dispatch_claim' is null then true
           when coalesce(detail->>'dispatch_claimed_at', '') !~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}' then true
           else (detail->>'dispatch_claimed_at')::timestamptz < now() - _window
         end
  returning * into _row;

  if _row.id is null then
    return null;
  end if;
  return _row;
end $$;

revoke all on function public.paige_claim_act_dispatch(uuid, uuid, uuid, interval) from public, anon, authenticated;
grant execute on function public.paige_claim_act_dispatch(uuid, uuid, uuid, interval) to service_role;

comment on function public.paige_claim_act_dispatch(uuid, uuid, uuid, interval) is
  'INT-179 Slice 2b: at-most-once dispatch gate for a Layer-C act. Stamps detail.dispatch_claim on an '
  'accepted_for_execution/retrying row that has no live claim and returns it; NULL otherwise. A claim older '
  'than the stale window (min 7 minutes) may be re-taken after the caller''s own readback. Service-role only.';
