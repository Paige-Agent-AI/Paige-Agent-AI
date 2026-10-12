-- INT-179 Slice 2b · milestone 2: a dispatcher that dies after claiming no longer strands its act for 24 hours.
--
-- 20271023000000 made dispatch at-most-once: a caller fires an act only while it holds `detail.dispatch_claim`, and a
-- claim older than 10 minutes may be re-taken. Two recovery gaps remained, both found by reading the lifecycle:
--
--   (1) AUTOMATIC ACTS. A runner that claims and then dies leaves the act accepted_for_execution with a live claim.
--       The event is re-claimed by the sweeper 5 minutes later, but the claim is still live, so that drain leaves the
--       act alone and fails the event; every drain spends one of the event's 5 attempts. A crash on a late attempt
--       exhausts them before the claim goes stale, the event lands in `error` (or stays `claimed` at 5 attempts), and
--       nothing re-drives it. The reconciler only read back, so the act waited 24 hours and was then recorded as an
--       unconfirmed ambiguous failure — although the native readback had already proved it never ran.
--   (2) APPROVED ACTS. execute-approval locks the approval row (`claimed_at`) before running the held act and releases
--       it only on the paths that return. A crash in between leaves the row locked: every later approval answers
--       "in progress", so the human cannot retry, and only the 24-hour reconciler ever closed it.
--
-- The reconciler is now the recovery pass for both (one home, the existing 5-minute cron — no second job):
--   * every orchestration approval locked over 10 minutes is released, so approving again resumes it (the executor
--     re-checks authority, re-takes the claim and dispatches). This also covers a crash BEFORE redeem, where the act
--     is still approval_pending.
-- For an act accepted_for_execution/retrying, untouched for 10 minutes, whose dispatch claim is missing or stale by
-- the SAME rule the claim RPC uses (so nothing a live runner could still hold is ever treated as dead):
--   * native, readback finds the effect   → executed (unchanged).
--   * native, nothing landed, engine-owned → if its event is still inside the normal retry lifecycle, leave it (the
--     next drain re-takes the stale claim). If the event is exhausted, re-open it for one more drain, SCOPED to this
--     automation and to acts that existed when the event happened (recovery_scope), so the ONE engine path re-checks
--     governance, re-takes the claim and dispatches. Bounded: 3 recoveries. Exhausted → failed `dispatch_not_started`
--     — the readback proves it never ran, so it is not reported as ambiguous.
--   * native, nothing landed, approved     → left to the approver. 24 hours after the APPROVAL with no retry →
--     failed `dispatch_not_started`.
--   * a CLAIMED act whose adapter's readback cannot prove the effect is absent, with no provider reference →
--     ambiguous `dispatch_outcome_unknown`. Never re-driven: an external effect whose outcome cannot be established is
--     never replayed automatically. (No such adapter dispatches today; n8n effectful execution is off.) An act of
--     that kind that was never claimed never dispatched and is not touched.
-- The 24-hour bound now runs from the dispatch (`dispatched_at`, the approval time for an approved act) instead of
-- the row's creation, so an act held for approval for days is not failed minutes after it is approved.
-- The pass skips archived and execution-paused tenants, isolates each row (one failure never aborts the pass), and
-- stamps every row it looks at and leaves alone, so waiting rows rotate instead of filling every 50-row pass.
--
-- paige_claim_act_dispatch gains `_allow_retake` (default true, the prior behaviour). A caller dispatching through an
-- adapter whose readback cannot prove absence passes false: it may claim an act no one ever claimed, but never take
-- over a lost claim, because the dead holder may already have fired.

-- ── 1. The claim RPC, with the re-take switch ───────────────────────────────────────────────────────────────────────
drop function if exists public.paige_claim_act_dispatch(uuid, uuid, uuid, interval);

create function public.paige_claim_act_dispatch(
  _event_id     uuid,
  _act_id       uuid,
  _claim        uuid,
  _stale_after  interval default interval '10 minutes',
  _allow_retake boolean  default true
) returns public.paige_act_executions
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _row    public.paige_act_executions;
  _window interval := greatest(coalesce(_stale_after, interval '10 minutes'), interval '7 minutes');
begin
  if auth.uid() is not null then
    raise exception 'ACT_DISPATCH_CLAIM_FORBIDDEN: service role only' using errcode = '42501';
  end if;
  if _claim is null then
    raise exception 'ACT_DISPATCH_CLAIM_INVALID: a claim id is required' using errcode = '22023';
  end if;

  update public.paige_act_executions
     set detail = coalesce(detail, '{}'::jsonb)
                  || jsonb_build_object('dispatch_claim', _claim::text, 'dispatch_claimed_at', now())
   where event_id = _event_id
     and act_id   = _act_id
     and outcome::text in ('accepted_for_execution', 'retrying')
     and case
           when detail->>'dispatch_claim' is null then true
           -- a prior claim exists: only a caller allowed to take over a lost claim may proceed past here
           when coalesce(_allow_retake, true) = false then false
           when coalesce(detail->>'dispatch_claimed_at', '') !~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}' then true
           when not pg_input_is_valid(detail->>'dispatch_claimed_at', 'timestamptz') then true
           when (detail->>'dispatch_claimed_at')::timestamptz > clock_timestamp() + interval '1 minute' then true
           else (detail->>'dispatch_claimed_at')::timestamptz < now() - _window
         end
  returning * into _row;

  if _row.id is null then
    return null;
  end if;
  return _row;
end $$;

revoke all on function public.paige_claim_act_dispatch(uuid, uuid, uuid, interval, boolean) from public, anon, authenticated;
grant execute on function public.paige_claim_act_dispatch(uuid, uuid, uuid, interval, boolean) to service_role;

comment on function public.paige_claim_act_dispatch(uuid, uuid, uuid, interval, boolean) is
  'INT-179 Slice 2b: at-most-once dispatch gate for a Layer-C act. Stamps detail.dispatch_claim on an '
  'accepted_for_execution/retrying row that has no live claim and returns it; NULL otherwise. A claim older than '
  'the stale window (min 7 minutes), or whose timestamp is missing, unparseable or over a minute ahead, may be '
  're-taken only when _allow_retake is true (an adapter whose readback proves absence). Service-role only.';

-- ── 2. The re-open scope ────────────────────────────────────────────────────────────────────────────────────────────
-- A recovery re-opens a finished event so the ONE engine path can dispatch the stranded act. Re-opened as-is, that
-- drain would load every subscriber live NOW and every act configured NOW — delivering an old event to a process
-- granted after it, or running an act added after it. The scope pins a re-opened event to the automations recovery
-- re-opened it for, and (in the drainer) to the acts that existed when the event happened. NULL = a normal event.
alter table public.paige_native_events add column if not exists recovery_scope uuid[];

comment on column public.paige_native_events.recovery_scope is
  'INT-179 Slice 2b: set only by paige_reconcile_orchestration_acts when it re-opens a finished event to re-drive a '
  'stranded act. When non-null the drainer delivers ONLY to these automations and governs ONLY acts created at or '
  'before the event. NULL for every normal event.';

-- ── 3. The reconciler, now also the crash-recovery pass ─────────────────────────────────────────────────────────────
create or replace function public.paige_reconcile_orchestration_acts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _cand       record;
  _cur        public.paige_act_executions;
  _ev         public.paige_native_events;
  _readable   boolean;
  _landed_id  uuid;
  _claim_live boolean;
  _claim_at   text;
  _epoch      timestamptz;
  _recoveries integer;
  _released   integer;
  _new        text;
  _code       text;
  _err        text;
  _row        public.paige_act_executions;
  _actual     text;
  _advanced   integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'RECONCILE_FORBIDDEN: service role / cron only' using errcode = '42501';
  end if;

  -- (a) An orchestration approval locked longer than 10 minutes belongs to an executor that died: the edge
  --     wall-clock cap is far below that. Release it so the owner can approve again. Safe whatever the act's state:
  --     before redeem nothing ran; after it the resume path re-reads, re-checks authority and dispatches only under
  --     the act's own dispatch claim; a settled act is just re-stamped. One statement for every stale lock, so a
  --     crash BEFORE redeem (the act still approval_pending, which the scan below never visits) is covered too.
  update public.paige_pending_approvals
     set claimed_at = null,
         metadata   = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('dispatch_interrupted_at', now())
   where source = 'paige_orchestration'
     and status = 'pending'
     and claimed_at is not null
     and claimed_at < now() - interval '10 minutes';
  get diagnostics _released = row_count;
  _advanced := _advanced + _released;

  -- (b) Acts this pass can act on, oldest first. Every row it looks at and leaves alone is stamped below, which
  --     moves its updated_at, so rows waiting on something else rotate to the back instead of filling every pass.
  --     Excluded up front, because no branch could ever move them:
  --       * an act on an archived or execution-paused tenant (the lifecycle guard refuses its event writes);
  --       * a non-native act that is ambiguous, or carries a provider reference (its adapter's own readback owns it),
  --         or was never claimed (it never dispatched, and a row from before the claim protocol cannot be judged).
  for _cand in
    select ae.id
      from public.paige_act_executions ae
      join public.tenants t on t.id = ae.tenant_id
      left join public.paige_native_events ev on ev.id = ae.event_id
     where ae.outcome::text in ('ambiguous', 'accepted_for_execution', 'retrying')
       and ae.updated_at < now() - interval '10 minutes'
       and t.archived_at is null
       and not coalesce(t.lifecycle_execution_paused, false)
       and (
             -- native: an unconfirmed (ambiguous) act only where the readback can settle it
             (ae.adapter_kind = 'native'
              and (ae.outcome::text <> 'ambiguous' or (ev.subject_table = 'clients' and ae.correlation_ref is not null)))
             or (ae.adapter_kind <> 'native'
                 and ae.outcome::text <> 'ambiguous' and ae.provider_ref is null and ae.detail ? 'dispatch_claim')
           )
     order by ae.updated_at asc
     limit 50
  loop
    -- One row's failure never aborts the pass: its writes roll back, it is stamped so it rotates, and it is logged.
    begin
      -- Re-read under the row lock. The claim RPC and every ledger write take the same lock, so a runner that claims
      -- between the scan and here is seen, and nothing below can race a dispatch it decides is dead.
      select * into _cur from public.paige_act_executions where id = _cand.id for update skip locked;
      if _cur.id is null
         or _cur.outcome::text not in ('ambiguous', 'accepted_for_execution', 'retrying')
         or _cur.updated_at >= now() - interval '10 minutes' then
        continue;
      end if;

      select * into _ev from public.paige_native_events ev where ev.id = _cur.event_id;

      -- Only the native journey-stage readback can PROVE whether the effect landed: a transition stamped with the
      -- act's correlation reference exists, or it does not.
      _readable := _cur.adapter_kind = 'native' and _ev.subject_table = 'clients' and _cur.correlation_ref is not null;
      _epoch    := coalesce(_cur.dispatched_at, _cur.created_at);
      _new := null; _code := null; _err := null;

      if _readable then
        select t.id into _landed_id
          from public.paige_journey_stage_transitions t
         where t.contact_id = _ev.subject_id and t.source_event = _cur.correlation_ref
         limit 1;
        if _landed_id is not null then
          _new := 'executed';
        end if;
      end if;

      if _new is null and _cur.outcome::text = 'ambiguous' then
        -- unchanged rule for an unconfirmed dispatch: never re-driven; failed once its window has passed.
        if _readable and _epoch < now() - interval '24 hours' then
          _new := 'failed'; _code := 'reconcile_exhausted'; _err := 'ambiguous_never_confirmed_by_correlation';
        end if;
      elsif _new is null then
        -- accepted_for_execution / retrying, nothing landed (or not readable). A claim the claim RPC would still
        -- refuse to re-take belongs to a runner that may be alive — leave it. The SAME rule as the RPC's CASE in
        -- section 1, and the same window as DISPATCH_CLAIM_STALE in dispatch-claim.ts (a drift test pins it).
        _claim_at := _cur.detail->>'dispatch_claimed_at';
        -- CASE, not AND: evaluated in order, so the cast only ever sees a value that parses.
        _claim_live := case
          when (_cur.detail->>'dispatch_claim') is null then false
          when coalesce(_claim_at, '') !~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}' then false
          when not pg_input_is_valid(_claim_at, 'timestamptz') then false
          when _claim_at::timestamptz > clock_timestamp() + interval '1 minute' then false
          else _claim_at::timestamptz >= now() - interval '10 minutes'
        end;

        if _claim_live then
          null; -- a runner may still be dispatching
        elsif not _readable then
          -- The scan admits a non-readable act only when it was CLAIMED and carries no provider reference: either a
          -- dispatcher took it and died, or its dispatch returned without one. Nothing can prove the effect absent or
          -- present, so it is recorded as unknown — never replayed.
          if _cur.provider_ref is null and _cur.detail ? 'dispatch_claim' then
            _new := 'ambiguous'; _code := 'dispatch_outcome_unknown'; _err := 'claimed_without_provider_ref';
          end if;
        elsif _cur.detail ? 'approved_by' then
          -- An approved act. The human's approval is the authority to run it, so recovery hands it back to them:
          -- step (a) released the approval's stale lock, and approving again resumes it. No retry within 24 hours
          -- of the approval → failed; the readback proves it never ran.
          if _epoch < now() - interval '24 hours' then
            _new := 'failed'; _code := 'dispatch_not_started'; _err := 'approved_act_never_dispatched';
          end if;
        else
          -- An automatic act: re-drive it through the one engine path, a bounded number of times.
          _recoveries := case when coalesce(_cur.detail->>'dispatch_recoveries', '') ~ '^\d{1,3}$'
                              then (_cur.detail->>'dispatch_recoveries')::int else 0 end;
          if _recoveries >= 3 or _epoch < now() - interval '24 hours' then
            _new := 'failed'; _code := 'dispatch_not_started'; _err := 'dispatch_recovery_exhausted';
          elsif _ev.id is not null
                and (_ev.processing_state in ('error', 'done')
                     -- 5 = the sweeper's attempts cap (paige_claim_event / paige_sweep_stuck_events): past it nothing
                     -- drains the event again. Below it the normal lifecycle still owns the event, and its next drain
                     -- re-takes the stale claim and dispatches — nothing to do here.
                     or (_ev.processing_state = 'pending' and _ev.attempts >= 5)
                     -- a claimed event is being drained unless its claim is older than the sweeper's 5 minutes
                     or (_ev.processing_state = 'claimed' and _ev.attempts >= 5
                         and _ev.claimed_at < now() - interval '5 minutes')) then
            -- Re-open the exhausted event for exactly one more drain (attempts 4 of the cap's 5), scoped to this
            -- automation and to acts that existed when the event happened (see recovery_scope).
            update public.paige_native_events
               set processing_state = 'pending',
                   attempts         = 4,
                   last_error       = 'dispatch_recovery: act ' || _cur.act_id::text,
                   recovery_scope   = (select array_agg(distinct a)
                                         from unnest(coalesce(recovery_scope, '{}'::uuid[]) || _cur.automation_id) a)
             where id = _ev.id;
            -- a delivery recorded done would be skipped by the drainer; this one still owes a dispatch
            update public.paige_event_dispatches
               set status = 'error', error = 'dispatch_recovery'
             where event_id = _cur.event_id and automation_id = _cur.automation_id and status = 'done';
            update public.paige_act_executions
               set detail = coalesce(detail, '{}'::jsonb)
                            || jsonb_build_object('dispatch_recoveries', _recoveries + 1, 'dispatch_recovered_at', now())
             where id = _cur.id;
            begin
              perform public.paige_fire_event_processor(_cur.event_id, _cur.tenant_id);
            exception when others then
              -- the native-event sweeper picks a pending event up within 5 minutes anyway
              raise warning 'paige_reconcile_orchestration_acts: fire for event % failed: %', _cur.event_id, sqlerrm;
            end;
            _advanced := _advanced + 1;
            continue;
          end if;
        end if;
      end if;

      if _new is null then
        -- Looked at, nothing to do yet. Stamp it so updated_at moves and the next pass reaches other rows first.
        update public.paige_act_executions
           set detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('recovery_checked_at', now())
         where id = _cur.id;
        continue;
      end if;

      -- Advance through the sanctioned monotonic RPC and stamp the companion from what ACTUALLY persisted (a
      -- concurrent resume may have settled it first; §13 — the inbox never reports an outcome the ledger did not
      -- record).
      _row := public.paige_record_act_execution(
        _cur.event_id, _cur.automation_id, _cur.act_id, _cur.act_position, _cur.tenant_id,
        _cur.adapter_kind, _cur.capability_key, _cur.effective_lane, _new::public.paige_act_outcome,
        _code, _cur.idempotency_key, _cur.correlation_ref, null,
        jsonb_build_object('reconciled_via', 'durable_orchestration_sweep', 'prior_outcome', _cur.outcome::text),
        _err, null, case when _new in ('executed', 'failed') then now() else null end
      );
      _actual := coalesce(_row.outcome::text, _new);
      _advanced := _advanced + 1;

      if _actual in ('executed', 'failed') then
        update public.paige_pending_approvals
           set status      = 'approved',
               reviewed_at = now(),
               claimed_at  = null,
               metadata    = coalesce(metadata, '{}'::jsonb)
                             || jsonb_build_object('act_outcome', _actual, 'executed', _actual = 'executed',
                                                   'execute_note', 'resolved by durable reconciler')
         where source = 'paige_orchestration'
           and tenant_id = _cur.tenant_id
           and metadata->>'event_id' = _cur.event_id::text
           and metadata->>'act_id'   = _cur.act_id::text
           and status = 'pending';
      end if;
    exception when others then
      raise warning 'paige_reconcile_orchestration_acts: act % skipped: % (%)', _cand.id, sqlerrm, sqlstate;
      begin
        update public.paige_act_executions
           set detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('recovery_checked_at', now(),
                                                                            'recovery_error', left(sqlerrm, 200))
         where id = _cand.id;
      exception when others then
        null; -- the row stays where it is; the warning above already names it
      end;
    end;
  end loop;

  return _advanced;
end $$;

revoke all on function public.paige_reconcile_orchestration_acts() from public, anon, authenticated;
grant execute on function public.paige_reconcile_orchestration_acts() to service_role;

comment on function public.paige_reconcile_orchestration_acts() is
  'INT-179 Slice 2b: the durable reconcile and crash-recovery pass for Layer-C acts (5-minute cron). Releases '
  'orchestration approval locks older than 10 minutes. Native readback confirms a landed effect -> executed. An '
  'accepted native act whose dispatcher died (claim missing or stale) on an exhausted event is re-driven through '
  'that event, scoped to its automation (automatic, max 3); an approved one is left to its approver. Proved '
  'never-run after that -> failed dispatch_not_started. A claimed non-native act whose outcome cannot be proved -> '
  'ambiguous dispatch_outcome_unknown, never replayed. Rows left alone are stamped so they rotate. Skips archived '
  'and paused tenants; one row''s error never aborts the pass. Advances only via the monotonic RPC; service-role only.';
