-- INT-179 Slice 2b milestone 2 (20271024000100) — a dispatcher that dies after claiming no longer strands its act.
-- The reconciler re-drives an automatic act through its exhausted event (bounded, scoped to its automation), hands an
-- approved act back to its approver (every stale approval lock released), records a claimed act whose outcome cannot
-- be proved as ambiguous (never replayed), and fails an act the readback proves never ran as dispatch_not_started.
-- Nothing a live runner could still hold is touched; a paused tenant or one failing row never stops the pass; rows it
-- leaves alone rotate, so they can never fill every pass.
-- House pgTAP style: synthetic opaque fixtures, FK constraints dropped and seeding triggers disabled inside the
-- transaction, which is ALWAYS rolled back. The reconciler runs as the cron/service role (auth.uid() NULL).
begin;
select plan(61);

insert into public.tenants(id, slug, name, status, account_type, account_number_prefix, features) values
  ('22222222-2222-4222-8222-222222222222', 'paige-2b-recovery-proof-tenant', 'Paige 2b Recovery Proof Tenant', 'active', 'standalone', 'P2B', '{}'::jsonb),
  ('33333333-3333-4333-8333-333333333333', 'paige-2b-recovery-paused-tenant', 'Paige 2b Recovery Paused Tenant', 'active', 'standalone', 'P2C', '{}'::jsonb);

do $$
declare r record;
begin
  for r in
    select conrelid::regclass::text as tbl, conname from pg_constraint
     where contype = 'f'
       and conrelid in ('public.paige_act_executions'::regclass, 'public.paige_native_events'::regclass,
                        'public.paige_journey_stage_transitions'::regclass, 'public.paige_event_dispatches'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;
alter table public.paige_act_executions    disable trigger user;
alter table public.paige_pending_approvals disable trigger user;

-- ev(n, state, attempts, claimed_ago): an event for contact c..n
create function pg_temp.ev(_n text, _state text, _attempts int, _claimed_ago interval default null) returns void
language sql as $$
  insert into public.paige_native_events(id, event_key, tenant_id, subject_table, subject_id, dedup_key, processing_state, attempts, claimed_at)
  values (('e0000000-0000-4000-8000-0000000000' || _n)::uuid, 'contact.created', '22222222-2222-4222-8222-222222222222',
          'clients', ('c0000000-0000-4000-8000-0000000000' || _n)::uuid, 'dk-rec-' || _n, _state, _attempts,
          case when _claimed_ago is null then null else now() - _claimed_ago end);
$$;
-- act(n, adapter, outcome, detail, created_ago, updated_ago, dispatched_ago, provider_ref)
create function pg_temp.act(_n text, _adapter text, _outcome text, _detail jsonb, _created_ago interval,
                            _updated_ago interval, _dispatched_ago interval default null, _provider text default null)
returns void language sql as $$
  insert into public.paige_act_executions
    (id, event_id, automation_id, act_id, act_position, tenant_id, adapter_kind, capability_key, effective_lane, outcome,
     idempotency_key, correlation_ref, provider_ref, detail, created_at, updated_at, dispatched_at)
  values (('ad000000-0000-4000-8000-0000000000' || _n)::uuid, ('e0000000-0000-4000-8000-0000000000' || _n)::uuid,
          ('a0000000-0000-4000-8000-0000000000' || _n)::uuid, ('ac000000-0000-4000-8000-0000000000' || _n)::uuid, 1,
          '22222222-2222-4222-8222-222222222222', _adapter,
          case when _adapter = 'native' then 'crm.advance_journey_stage' else 'n8n_run_workflow' end,
          'auto', _outcome, 'idem-rec-' || _n, 'corr-rec-' || _n, _provider, _detail,
          now() - _created_ago, now() - _updated_ago,
          case when _dispatched_ago is null then null else now() - _dispatched_ago end);
$$;
create function pg_temp.claim(_ago interval) returns jsonb language sql as $$
  select jsonb_build_object('dispatch_claim', gen_random_uuid()::text, 'dispatch_claimed_at', now() - _ago)
$$;
create function pg_temp.row(_n text) returns public.paige_act_executions language sql as $$
  select * from public.paige_act_executions where id = ('ad000000-0000-4000-8000-0000000000' || _n)::uuid
$$;
create function pg_temp.evstate(_n text) returns text language sql as $$
  select processing_state || ':' || attempts from public.paige_native_events where id = ('e0000000-0000-4000-8000-0000000000' || _n)::uuid
$$;
create function pg_temp.companion(_n text) returns public.paige_pending_approvals language sql as $$
  select * from public.paige_pending_approvals
   where source = 'paige_orchestration' and metadata->>'act_id' = 'ac000000-0000-4000-8000-0000000000' || _n
$$;
create function pg_temp.approval(_n text, _claimed_ago interval) returns void language sql as $$
  insert into public.paige_pending_approvals(type, draft_content, category, tenant_id, source, status, risk_level, claimed_at, metadata)
  values ('other', '{}'::jsonb, 'crm.advance_journey_stage', '22222222-2222-4222-8222-222222222222', 'paige_orchestration',
          'pending', 'medium', case when _claimed_ago is null then null else now() - _claimed_ago end,
          jsonb_build_object('source', 'paige_orchestration', 'event_id', 'e0000000-0000-4000-8000-0000000000' || _n,
                             'act_id', 'ac000000-0000-4000-8000-0000000000' || _n));
$$;

-- ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- 01 automatic: claimed 15 min ago and died; the event ran out of attempts (error at 5)
select pg_temp.ev('01', 'error', 5);
select pg_temp.act('01', 'native', 'accepted_for_execution', pg_temp.claim('15 minutes'), '20 minutes', '15 minutes');
insert into public.paige_event_dispatches(event_id, automation_id, tenant_id, status, error)
  values ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'error', 'act_reconcile_pending');
-- 02 automatic: claim still live (2 min) although the row has been quiet — a runner may be dispatching
select pg_temp.ev('02', 'error', 5);
select pg_temp.act('02', 'native', 'accepted_for_execution', pg_temp.claim('2 minutes'), '20 minutes', '15 minutes');
-- 03 automatic: died before claiming (no claim); the event is stuck claimed at its 5th attempt
select pg_temp.ev('03', 'claimed', 5, '20 minutes');
select pg_temp.act('03', 'native', 'accepted_for_execution', '{}'::jsonb, '20 minutes', '15 minutes');
-- 04 automatic: three recoveries already spent
select pg_temp.ev('04', 'error', 5);
select pg_temp.act('04', 'native', 'accepted_for_execution', pg_temp.claim('15 minutes') || '{"dispatch_recoveries":3}'::jsonb, '2 hours', '15 minutes');
-- 05 automatic: the dispatch landed before the runner died (a correlation-stamped transition exists)
select pg_temp.ev('05', 'error', 5);
select pg_temp.act('05', 'native', 'accepted_for_execution', pg_temp.claim('15 minutes'), '20 minutes', '15 minutes');
insert into public.paige_journey_stage_transitions(contact_id, to_stage_id, source_event)
  values ('c0000000-0000-4000-8000-000000000005', 1, 'corr-rec-05');
-- 06 approved an hour ago; the executor died after claiming; the approval row is still locked (30 min)
select pg_temp.ev('06', 'done', 1);
select pg_temp.act('06', 'native', 'accepted_for_execution',
  pg_temp.claim('15 minutes') || jsonb_build_object('approved_by', 'b0000000-0000-4000-8000-000000000006'),
  '3 days', '15 minutes', '1 hour');
select pg_temp.approval('06', '30 minutes');
-- 07 approved 25 hours ago, never retried
select pg_temp.ev('07', 'done', 1);
select pg_temp.act('07', 'native', 'accepted_for_execution',
  pg_temp.claim('25 hours') || jsonb_build_object('approved_by', 'b0000000-0000-4000-8000-000000000007'),
  '3 days', '25 hours', '25 hours');
select pg_temp.approval('07', null);
-- 08 held three days, approved 30 min ago, dispatch unconfirmed: the 24 h window starts at the approval
select pg_temp.ev('08', 'done', 1);
select pg_temp.act('08', 'native', 'ambiguous', jsonb_build_object('approved_by', 'b0000000-0000-4000-8000-000000000008'),
  '3 days', '15 minutes', '30 minutes');
-- 09 an adapter whose readback cannot prove absence, claim lost, no provider reference
select pg_temp.ev('09', 'error', 5);
select pg_temp.act('09', 'n8n', 'accepted_for_execution', pg_temp.claim('15 minutes'), '20 minutes', '15 minutes');
-- 10 the same, but the provider already returned an execution id (its readback owns it)
select pg_temp.ev('10', 'error', 5);
select pg_temp.act('10', 'n8n', 'accepted_for_execution', pg_temp.claim('15 minutes'), '20 minutes', '15 minutes', null, 'exec-10');
-- 11 automatic, claim stale, but its event is being drained right now (claimed 1 min ago)
select pg_temp.ev('11', 'claimed', 3, '1 minute');
select pg_temp.act('11', 'native', 'accepted_for_execution', pg_temp.claim('15 minutes'), '20 minutes', '15 minutes');
-- 12 automatic, the event and its delivery were recorded done
select pg_temp.ev('12', 'done', 2);
select pg_temp.act('12', 'native', 'accepted_for_execution', pg_temp.claim('15 minutes'), '20 minutes', '15 minutes');
insert into public.paige_event_dispatches(event_id, automation_id, tenant_id, status)
  values ('e0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000012', '22222222-2222-4222-8222-222222222222', 'done');
-- 13 approved 10 min ago; the approval lock is fresh (2 min) — an executor may still be running
select pg_temp.ev('13', 'done', 1);
select pg_temp.act('13', 'native', 'accepted_for_execution',
  pg_temp.claim('15 minutes') || jsonb_build_object('approved_by', 'b0000000-0000-4000-8000-000000000013'),
  '1 day', '15 minutes', '10 minutes');
select pg_temp.approval('13', '2 minutes');
-- 14 automatic, a damaged claim timestamp (passes the prefix check, does not parse)
select pg_temp.ev('14', 'error', 5);
select pg_temp.act('14', 'native', 'accepted_for_execution',
  '{"dispatch_claim":"x","dispatch_claimed_at":"2026-99-99T99:99:99"}'::jsonb, '20 minutes', '15 minutes');
-- 15 automatic, quiet for only 5 minutes — inside the 10-minute bar
select pg_temp.ev('15', 'error', 5);
select pg_temp.act('15', 'native', 'accepted_for_execution', pg_temp.claim('15 minutes'), '20 minutes', '5 minutes');

-- 16 automatic, stale claim, exhausted event — but the tenant's execution is paused (its event writes are refused)
select pg_temp.ev('16', 'error', 5);
select pg_temp.act('16', 'native', 'accepted_for_execution', pg_temp.claim('15 minutes'), '20 minutes', '15 minutes');
update public.paige_native_events set tenant_id = '33333333-3333-4333-8333-333333333333' where id = 'e0000000-0000-4000-8000-000000000016';
update public.paige_act_executions set tenant_id = '33333333-3333-4333-8333-333333333333' where id = 'ad000000-0000-4000-8000-000000000016';
alter table public.tenants disable trigger a01_operator_account_archive; -- the pause is set directly, not via the operator flow
update public.tenants set lifecycle_execution_paused = true where id = '33333333-3333-4333-8333-333333333333';
alter table public.tenants enable trigger a01_operator_account_archive;
-- 17 automatic, stale claim, exhausted event, and a write it needs fails (a stand-in trigger on its delivery row)
select pg_temp.ev('17', 'error', 5);
select pg_temp.act('17', 'native', 'accepted_for_execution', pg_temp.claim('15 minutes'), '20 minutes', '16 minutes');
insert into public.paige_event_dispatches(event_id, automation_id, tenant_id, status)
  values ('e0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000017', '22222222-2222-4222-8222-222222222222', 'done');
create function public.paige_2b_proof_refuse_17() returns trigger language plpgsql as $f$
begin
  if new.event_id = 'e0000000-0000-4000-8000-000000000017' then raise exception 'proof: delivery write refused'; end if;
  return new;
end $f$;
create trigger paige_2b_proof_refuse_17 before update on public.paige_event_dispatches
  for each row execute function public.paige_2b_proof_refuse_17();
-- 18 an n8n act accepted but NEVER claimed: it never dispatched, so it is not "claim lost, outcome unknown"
select pg_temp.ev('18', 'error', 5);
select pg_temp.act('18', 'n8n', 'accepted_for_execution', '{}'::jsonb, '20 minutes', '15 minutes');
-- 19 automatic, stale claim, but its event is still inside the normal retry lifecycle (pending at 2 attempts)
select pg_temp.ev('19', 'pending', 2);
select pg_temp.act('19', 'native', 'accepted_for_execution', pg_temp.claim('15 minutes'), '20 minutes', '15 minutes');
-- 22 the executor died BEFORE redeem: the act is still approval_pending and the approval stays locked (30 min)
select pg_temp.ev('22', 'done', 1);
select pg_temp.act('22', 'native', 'approval_pending', '{}'::jsonb, '1 day', '30 minutes');
select pg_temp.approval('22', '30 minutes');

-- The reconciler's own ledger writes must move updated_at (that is what paces a second pass); the mint stays off.
alter table public.paige_act_executions enable trigger trg_paige_act_executions_touch;

select ok(public.paige_reconcile_orchestration_acts() > 0, 'the pass acts on the stranded acts');

-- ── Automatic acts ────────────────────────────────────────────────────────────────────────────────────────────────
select is((pg_temp.row('01')).outcome::text, 'accepted_for_execution', '01 a dead dispatcher''s act is not failed or replayed by the reconciler itself');
select is(pg_temp.evstate('01'), 'pending:4', '01 its exhausted event is re-opened for exactly one more drain');
select is((select recovery_scope from public.paige_native_events where id = 'e0000000-0000-4000-8000-000000000001'),
  array['a0000000-0000-4000-8000-000000000001'::uuid], '01 the re-open is scoped to the stranded automation (no other subscriber is delivered)');
select is(((pg_temp.row('01')).detail->>'dispatch_recoveries')::int, 1, '01 the recovery is counted on the act');
select ok((pg_temp.row('01')).detail ? 'dispatch_claim', '01 the stale claim is left in place (the next drain re-takes it, at most once)');
select is((select status from public.paige_event_dispatches where event_id = 'e0000000-0000-4000-8000-000000000001'), 'error', '01 the delivery still owes the dispatch');
select alike((select last_error from public.paige_native_events where id = 'e0000000-0000-4000-8000-000000000001'), 'dispatch_recovery:%', '01 the event records why it was re-opened');

select is(pg_temp.evstate('02'), 'error:5', '02 a live claim is never treated as dead: the event is not re-opened');
select ok(not ((pg_temp.row('02')).detail ? 'dispatch_recoveries'), '02 and no recovery is counted');

select is(pg_temp.evstate('03'), 'pending:4', '03 a dispatcher that died before claiming is recovered too (event stuck claimed at 5)');
select is(((pg_temp.row('03')).detail->>'dispatch_recoveries')::int, 1, '03 the recovery is counted');

select is((pg_temp.row('04')).outcome::text, 'failed', '04 three recoveries spent: failed');
select is((pg_temp.row('04')).refusal_code, 'dispatch_not_started', '04 classified as never started (the readback proved nothing landed), not ambiguous');
select is((pg_temp.row('04')).error, 'dispatch_recovery_exhausted', '04 with the reason');
select isnt((pg_temp.row('04')).settled_at, null, '04 and settled');
select is(pg_temp.evstate('04'), 'error:5', '04 its event is not re-opened again');

select is((pg_temp.row('05')).outcome::text, 'executed', '05 a dispatch that landed before the crash is adopted as executed, never re-driven');
select is(pg_temp.evstate('05'), 'error:5', '05 its event is not re-opened');

select is(pg_temp.evstate('11'), 'claimed:3', '11 an event being drained right now is left to finish');
select ok(not ((pg_temp.row('11')).detail ? 'dispatch_recoveries'), '11 and no recovery is counted');

select is(pg_temp.evstate('12'), 'pending:4', '12 an act whose event was recorded done is re-driven too');
select is((select status from public.paige_event_dispatches where event_id = 'e0000000-0000-4000-8000-000000000012'), 'error', '12 its delivery is re-opened, or the drainer would skip it');

select is(pg_temp.evstate('14'), 'pending:4', '14 a damaged claim timestamp is stale, never a cast error that stops the pass');
select is(pg_temp.evstate('15'), 'error:5', '15 an act quiet for under 10 minutes is not touched');

select is(pg_temp.evstate('16'), 'error:5', '16 a paused tenant''s act is not recovered (its event cannot be written)');
select ok(not ((pg_temp.row('16')).detail ? 'recovery_checked_at'), '16 and it is not even visited, so it cannot abort the pass');

select is(pg_temp.evstate('17'), 'error:5', '17 a row whose recovery write fails is rolled back');
select ok(not ((pg_temp.row('17')).detail ? 'dispatch_recoveries'), '17 with no recovery counted');
select alike((pg_temp.row('17')).detail->>'recovery_error', '%delivery write refused%', '17 the failure is recorded on the act');
select ok((pg_temp.row('17')).updated_at > now() - interval '1 minute', '17 and it rotates to the back of the queue');

select is((pg_temp.row('19')).outcome::text, 'accepted_for_execution', '19 an act whose event is still retrying is left to that lifecycle');
select is(pg_temp.evstate('19'), 'pending:2', '19 its event keeps its attempts (its next drain re-takes the stale claim)');
select ok((pg_temp.row('19')).detail ? 'recovery_checked_at', '19 and the act rotates');

-- ── Approved acts ─────────────────────────────────────────────────────────────────────────────────────────────────
select is((pg_temp.row('06')).outcome::text, 'accepted_for_execution', '06 an approved act is never re-fired by the reconciler');
select is((pg_temp.companion('06')).claimed_at, null, '06 its stale approval lock is released, so approving again resumes it');
select is((pg_temp.companion('06')).status, 'pending', '06 the approval stays pending (nothing ran)');
select ok((pg_temp.companion('06')).metadata ? 'dispatch_interrupted_at', '06 the approval records that its run was interrupted');
select is(pg_temp.evstate('06'), 'done:1', '06 its event is not re-opened (the approver owns the authority to run it)');

select is((pg_temp.row('07')).outcome::text, 'failed', '07 24 hours after the approval with no retry: failed');
select is((pg_temp.row('07')).refusal_code, 'dispatch_not_started', '07 classified as never started');
select is((pg_temp.companion('07')).status, 'approved', '07 the approval is closed');
select is((pg_temp.companion('07')).metadata->>'act_outcome', 'failed', '07 and says the act failed');

select is((pg_temp.row('08')).outcome::text, 'ambiguous', '08 an act held for days is not failed minutes after it was approved (the window runs from the approval)');

select isnt((pg_temp.companion('13')).claimed_at, null, '13 a fresh approval lock is left alone (an executor may still be running)');

select is((pg_temp.companion('22')).claimed_at, null, '22 a lock left by a crash before redeem is released too');
select is((pg_temp.row('22')).outcome::text, 'approval_pending', '22 and the act is still held for approval (nothing ran)');

-- ── Adapters whose readback cannot prove absence ─────────────────────────────────────────────────────────────────
select is((pg_temp.row('09')).outcome::text, 'ambiguous', '09 a lost claim on an unprovable adapter is recorded ambiguous');
select is((pg_temp.row('09')).refusal_code, 'dispatch_outcome_unknown', '09 as outcome unknown');
select is(pg_temp.evstate('09'), 'error:5', '09 and never re-driven (an external effect is never replayed)');
select is((pg_temp.row('10')).outcome::text, 'accepted_for_execution', '10 with a provider reference the adapter''s own readback owns it');
select is((pg_temp.row('18')).outcome::text, 'accepted_for_execution', '18 an n8n act never claimed is not recorded as a lost claim');
select ok(not ((pg_temp.row('18')).detail ? 'recovery_checked_at'), '18 and is not scanned at all');

-- ── A second pass is paced ────────────────────────────────────────────────────────────────────────────────────────
select public.paige_reconcile_orchestration_acts();
select is(((pg_temp.row('01')).detail->>'dispatch_recoveries')::int, 1, 'a second pass right away does not count a second recovery');

-- ── Rows the pass cannot advance never starve one it can ─────────────────────────────────────────────────────────
-- 55 unconfirmed dispatches inside their 24 h window (looked at, left alone) are all older than one recoverable act.
insert into public.paige_native_events(id, event_key, tenant_id, subject_table, subject_id, dedup_key, processing_state, attempts)
  select ('e1000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'contact.created', '22222222-2222-4222-8222-222222222222',
         'clients', ('c1000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'dk-starve-' || g, 'done', 1
    from generate_series(1, 55) g;
insert into public.paige_act_executions
  (event_id, automation_id, act_id, act_position, tenant_id, adapter_kind, capability_key, effective_lane, outcome,
   idempotency_key, correlation_ref, detail, created_at, updated_at, dispatched_at)
  select ('e1000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, gen_random_uuid(), gen_random_uuid(), 1,
         '22222222-2222-4222-8222-222222222222', 'native', 'crm.advance_journey_stage', 'auto', 'ambiguous',
         'idem-starve-' || g, 'corr-starve-' || g, '{}'::jsonb, now() - interval '4 hours', now() - interval '3 hours',
         now() - interval '3 hours'
    from generate_series(1, 55) g;
select pg_temp.ev('23', 'error', 5);
select pg_temp.act('23', 'native', 'accepted_for_execution', pg_temp.claim('2 hours'), '2 hours', '1 hour');
alter table public.paige_act_executions enable trigger trg_paige_act_executions_touch;
select public.paige_reconcile_orchestration_acts();
select is(pg_temp.evstate('23'), 'error:5', 'starvation: the first pass spends its 50 slots on the older rows');
select public.paige_reconcile_orchestration_acts();
select is(pg_temp.evstate('23'), 'pending:4', 'starvation: they rotated, so the next pass reaches the recoverable act');
select is((select count(*)::int from public.paige_act_executions where correlation_ref like 'corr-starve-%' and outcome::text = 'ambiguous'),
  55, 'starvation: the rows it could not advance are left exactly as they were');

-- ── The claim RPC's re-take switch (the protocol a recovered dispatch goes through) ──────────────────────────────
alter table public.paige_act_executions disable trigger user;
select pg_temp.ev('20', 'pending', 0);
select pg_temp.act('20', 'n8n', 'accepted_for_execution', '{}'::jsonb, '1 minute', '1 minute');
select pg_temp.ev('21', 'pending', 0);
select pg_temp.act('21', 'n8n', 'accepted_for_execution', pg_temp.claim('15 minutes'), '20 minutes', '15 minutes');
select isnt((public.paige_claim_act_dispatch('e0000000-0000-4000-8000-000000000020', 'ac000000-0000-4000-8000-000000000020', gen_random_uuid(), '10 minutes', false)).id, null,
  'an act nobody ever claimed may be claimed without the re-take right');
select is((public.paige_claim_act_dispatch('e0000000-0000-4000-8000-000000000021', 'ac000000-0000-4000-8000-000000000021', gen_random_uuid(), '10 minutes', false)).id, null,
  'a lost claim is never taken over without the re-take right (the dead holder may have fired)');
select isnt((public.paige_claim_act_dispatch('e0000000-0000-4000-8000-000000000021', 'ac000000-0000-4000-8000-000000000021', gen_random_uuid())).id, null,
  'with the default (re-take allowed) the same stale claim is taken over');
select ok(not exists (select 1 from pg_proc where proname = 'paige_claim_act_dispatch' and pronargs = 4),
  'the four-argument claim function is gone, so no caller can bypass the re-take switch');

select * from finish();
rollback;
