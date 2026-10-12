-- INT-179 Slice 2b (20271023000000) — the act ledger never overwrites an act that is in flight, keeps its
-- detail, and grants a dispatch to exactly one claimant. plan(35).
-- Behavioural proof against the schema `supabase db reset` replayed from zero (house pgTAP style; synthetic
-- opaque fixtures; the enclosing transaction is ALWAYS rolled back — no production/customer records).
-- The ledger's FK constraints are dropped and its user triggers disabled inside the rolled-back transaction, so
-- rows insert with synthetic ids; both functions are called as the service role (auth.uid() NULL), exactly as
-- the drainer, the approval executor and the reconciler call them.
begin;
select plan(35);

do $$
declare r record;
begin
  for r in select conname from pg_constraint where contype = 'f' and conrelid = 'public.paige_act_executions'::regclass loop
    execute format('alter table public.paige_act_executions drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.paige_act_executions disable trigger user;

-- rec(act, outcome, detail): one write through the ledger RPC for event e0, act <act>.
create function pg_temp.rec(_act uuid, _outcome text, _detail jsonb default '{}'::jsonb)
returns public.paige_act_executions language sql as $$
  select public.paige_record_act_execution(
    'e0000000-0000-4000-8000-000000000000'::uuid, 'a0000000-0000-4000-8000-000000000000'::uuid, _act, 1,
    '70000000-0000-4000-8000-000000000000'::uuid, 'native', 'crm.advance_journey_stage', 'confirm',
    _outcome::public.paige_act_outcome, null, 'idem-' || _act::text, 'corr-' || _act::text, null, _detail, null)
$$;
create function pg_temp.claim(_act uuid, _who uuid, _stale interval default interval '10 minutes')
returns uuid language sql as $$
  select (public.paige_claim_act_dispatch('e0000000-0000-4000-8000-000000000000'::uuid, _act, _who, _stale)).id
$$;
create function pg_temp.outcome(_act uuid) returns text language sql as $$
  select outcome::text from public.paige_act_executions
   where event_id = 'e0000000-0000-4000-8000-000000000000' and act_id = _act
$$;

-- ── A. In flight is never overwritten by a decision ─────────────────────────────────────────────────────
select pg_temp.rec('00000000-0000-4000-8000-0000000000a1', 'accepted_for_execution', '{"snapshot_args":{"stage_slug":"engaged"}}');
select is((pg_temp.rec('00000000-0000-4000-8000-0000000000a1', 'approval_pending')).outcome::text, 'accepted_for_execution',
  'A1 a re-derived approval_pending does not overwrite an accepted act (the persisted row is returned)');
select is((pg_temp.rec('00000000-0000-4000-8000-0000000000a1', 'held_by_lane')).outcome::text, 'accepted_for_execution',
  'A2 held_by_lane does not overwrite an accepted act');
select is((pg_temp.rec('00000000-0000-4000-8000-0000000000a1', 'refused_authority')).outcome::text, 'accepted_for_execution',
  'A3 refused_authority does not overwrite an accepted act');
select is((pg_temp.rec('00000000-0000-4000-8000-0000000000a1', 'condition_not_matched')).outcome::text, 'accepted_for_execution',
  'A4 condition_not_matched does not overwrite an accepted act');

select pg_temp.rec('00000000-0000-4000-8000-0000000000a2', 'accepted_for_execution');
select pg_temp.rec('00000000-0000-4000-8000-0000000000a2', 'ambiguous');
select is(pg_temp.outcome('00000000-0000-4000-8000-0000000000a2'), 'ambiguous', 'A5 accepted → ambiguous still advances');
select is((pg_temp.rec('00000000-0000-4000-8000-0000000000a2', 'approval_pending')).outcome::text, 'ambiguous',
  'A6 a decision does not overwrite an ambiguous act (its effect may have landed)');
select is((pg_temp.rec('00000000-0000-4000-8000-0000000000a2', 'accepted_for_execution')).outcome::text, 'ambiguous',
  'A7 an ambiguous act never moves back to accepted_for_execution (that would re-open its dispatch)');
select pg_temp.rec('00000000-0000-4000-8000-0000000000a3', 'accepted_for_execution');
select pg_temp.rec('00000000-0000-4000-8000-0000000000a3', 'retrying');
select is((pg_temp.rec('00000000-0000-4000-8000-0000000000a3', 'accepted_for_execution')).outcome::text, 'retrying',
  'A8 a retrying act never moves back to accepted_for_execution');

-- ── B. Legitimate transitions still advance; final rows stay frozen ───────────────────────────────────────
select is((pg_temp.rec('00000000-0000-4000-8000-0000000000a1', 'accepted_for_execution')).outcome::text, 'accepted_for_execution',
  'B1 accepted → accepted is idempotent');
select is((pg_temp.rec('00000000-0000-4000-8000-0000000000a2', 'executed')).outcome::text, 'executed',
  'B2 ambiguous → executed advances (a correlation reconcile)');
select is((pg_temp.rec('00000000-0000-4000-8000-0000000000a2', 'failed')).outcome::text, 'executed', 'B3 a final row is never overwritten');
select is((pg_temp.rec('00000000-0000-4000-8000-0000000000b1', 'approval_pending')).outcome::text, 'approval_pending',
  'B4 a decision still records on a new act');
select is((pg_temp.rec('00000000-0000-4000-8000-0000000000b1', 'held_by_lane')).outcome::text, 'approval_pending',
  'B5 a settled decision is not flipped by a re-derived one');

-- ── C. detail is merged, never replaced ─────────────────────────────────────────────────────────────────
select pg_temp.rec('00000000-0000-4000-8000-0000000000a1', 'accepted_for_execution', '{"approve":{"ok":true}}');
select ok((select detail ? 'snapshot_args' and detail ? 'approve' from public.paige_act_executions
            where act_id = '00000000-0000-4000-8000-0000000000a1'),
  'C1 a later write keeps the immutable snapshot args and adds its own keys');

-- ── D. The dispatch claim: exactly one claimant, never on a non-dispatchable act ───────────────────────────
select isnt(pg_temp.claim('00000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-000000000001'), null,
  'D1 the first claimant on an accepted act gets the row');
select is(pg_temp.claim('00000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-000000000002'), null,
  'D2 a second claimant is refused while the claim is live');
select is(pg_temp.outcome('00000000-0000-4000-8000-0000000000a1'), 'accepted_for_execution',
  'D3 the claim does not change the outcome (reconciler and resume paths unchanged)');
select is((select detail->>'dispatch_claim' from public.paige_act_executions where act_id = '00000000-0000-4000-8000-0000000000a1'),
  'c0000000-0000-4000-8000-000000000001', 'D4 the winning claim is recorded in detail');
select pg_temp.rec('00000000-0000-4000-8000-0000000000a1', 'accepted_for_execution', '{"x":1}');
select is(pg_temp.claim('00000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-000000000003'), null,
  'D5 a second runner re-writing accepted cannot erase the live claim and take it');
select is(pg_temp.claim('00000000-0000-4000-8000-0000000000b1', 'c0000000-0000-4000-8000-000000000004'), null,
  'D6 a held (approval_pending) act cannot be claimed');
select is(pg_temp.claim('00000000-0000-4000-8000-0000000000a2', 'c0000000-0000-4000-8000-000000000005'), null,
  'D7 a final (executed) act cannot be claimed');
select pg_temp.rec('00000000-0000-4000-8000-0000000000a4', 'accepted_for_execution');
select pg_temp.rec('00000000-0000-4000-8000-0000000000a4', 'ambiguous');
select is(pg_temp.claim('00000000-0000-4000-8000-0000000000a4', 'c0000000-0000-4000-8000-000000000006'), null,
  'D8 an ambiguous act cannot be claimed (only a correlation reconcile may advance it)');

-- ── E. A stale claim may be re-taken; the window has a floor ──────────────────────────────────────────────
update public.paige_act_executions
   set detail = detail || jsonb_build_object('dispatch_claimed_at', now() - interval '11 minutes')
 where act_id = '00000000-0000-4000-8000-0000000000a1';
select isnt(pg_temp.claim('00000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-000000000007'), null,
  'E1 a claim older than the stale window is re-taken (a dead runner does not wedge the act)');
update public.paige_act_executions
   set detail = detail || jsonb_build_object('dispatch_claimed_at', now() - interval '5 minutes')
 where act_id = '00000000-0000-4000-8000-0000000000a1';
select is(pg_temp.claim('00000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-000000000008', interval '0 seconds'), null,
  'E2 a caller cannot shrink the stale window below its 7-minute floor to steal a claim a live runner may hold');

-- ── G. Only the claim RPC writes the claim, and a damaged claim never wedges the row ──────────────────────
select pg_temp.rec('00000000-0000-4000-8000-0000000000a1', 'accepted_for_execution',
  '{"dispatch_claim":"forged","dispatch_claimed_at":"2000-01-01T00:00:00+00"}');
select is((select detail->>'dispatch_claim' from public.paige_act_executions where act_id = '00000000-0000-4000-8000-0000000000a1'),
  'c0000000-0000-4000-8000-000000000007', 'G1 a ledger write can neither forge nor erase the dispatch claim');
update public.paige_act_executions
   set detail = detail || '{"dispatch_claimed_at":"not a time"}'::jsonb
 where act_id = '00000000-0000-4000-8000-0000000000a1';
select isnt(pg_temp.claim('00000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-000000000009'), null,
  'G2 a missing or non-ISO claim timestamp is treated as stale, never a cast error that wedges the row');
-- G3–G9 (20271023000100): G3/G4 values the prefix regex accepted but that do not parse (they raised on the old
-- body); G5–G7 special inputs that must stay stale; G8 a far-future value; G9 a fresh claim stays live.
update public.paige_act_executions
   set detail = detail || '{"dispatch_claimed_at":"2026-99-99T99:99:99"}'::jsonb
 where act_id = '00000000-0000-4000-8000-0000000000a1';
select isnt(pg_temp.claim('00000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-00000000000a'), null,
  'G3 a timestamp-shaped value that does not parse is stale, never a cast error');
update public.paige_act_executions
   set detail = detail || '{"dispatch_claimed_at":"2026-01-01T00:00:00junk"}'::jsonb
 where act_id = '00000000-0000-4000-8000-0000000000a1';
select isnt(pg_temp.claim('00000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-00000000000b'), null,
  'G4 a valid timestamp prefix with trailing junk is stale, never a cast error');
update public.paige_act_executions
   set detail = detail || '{"dispatch_claimed_at":"infinity"}'::jsonb
 where act_id = '00000000-0000-4000-8000-0000000000a1';
select isnt(pg_temp.claim('00000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-00000000000c'), null,
  'G5 an infinite timestamp is stale, never a claim that holds forever');
update public.paige_act_executions
   set detail = detail || '{"dispatch_claimed_at":"now"}'::jsonb
 where act_id = '00000000-0000-4000-8000-0000000000a1';
select isnt(pg_temp.claim('00000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-00000000000d'), null,
  'G6 the special input now is stale (it parses to the current time and would never age out)');
update public.paige_act_executions
   set detail = detail || '{"dispatch_claimed_at":"tomorrow"}'::jsonb
 where act_id = '00000000-0000-4000-8000-0000000000a1';
select isnt(pg_temp.claim('00000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-00000000000e'), null,
  'G7 the special input tomorrow is stale (always in the future)');
update public.paige_act_executions
   set detail = detail || '{"dispatch_claimed_at":"9999-12-31 00:00:00+00"}'::jsonb
 where act_id = '00000000-0000-4000-8000-0000000000a1';
select isnt(pg_temp.claim('00000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-00000000000f'), null,
  'G8 a far-future timestamp is stale, never a claim held for years');
-- G9: the future check has a margin, so a claim written just now by another caller is still live.
update public.paige_act_executions
   set detail = detail || jsonb_build_object('dispatch_claimed_at', now())
 where act_id = '00000000-0000-4000-8000-0000000000a1';
select is(pg_temp.claim('00000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-000000000010'), null,
  'G9 a claim stamped now() is still live (the future check never re-takes a fresh claim)');

-- ── F. Service role only ─────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'public.paige_claim_act_dispatch(uuid,uuid,uuid,interval)', 'execute')
       and not has_function_privilege('anon', 'public.paige_claim_act_dispatch(uuid,uuid,uuid,interval)', 'execute'),
  'F1 anon and authenticated cannot execute the claim');
set local request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-000000000000","role":"authenticated"}';
select throws_ok($$ select public.paige_claim_act_dispatch('e0000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-0000000000a3', gen_random_uuid()) $$,
  '42501', null, 'F2 a caller with a user identity is refused in-body even with EXECUTE');
reset request.jwt.claims;

select * from finish();
rollback;
