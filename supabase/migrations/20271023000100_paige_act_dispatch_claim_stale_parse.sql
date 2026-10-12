-- INT-179 Slice 2b · follow-up: a claim timestamp that cannot be compared is stale, never a cast error.
--
-- 20271023000000 guarded the `dispatch_claimed_at` cast with a prefix regex. The regex accepts values that
-- look like a timestamp but do not parse (`2026-99-99T99:99:99`, `2026-01-01T00:00:00junk`), so the cast
-- raised and every later claim on that act failed — the wedge the guard was written to prevent.
--
-- The stale check now runs in this order: no claim, or a value without the ISO prefix (which also rejects
-- the special inputs `now`, `today`, `tomorrow`, `infinity`, `epoch`), is stale; a prefixed value that does not
-- parse (pg_input_is_valid) is stale; a value more than a minute in the FUTURE is stale, because no claim RPC
-- can have written it and it would otherwise hold the claim for years; anything else is compared with the
-- window as before. The regex is kept ahead of pg_input_is_valid on purpose: pg_input_is_valid alone accepts
-- `now` and `tomorrow`, which are never older than the window and would hold the claim forever. The future
-- check uses clock_timestamp(), never now(): a caller re-checking after another caller's claim committed reads
-- that caller's now(), which can be later than its own now() but never later than its clock_timestamp().
--
-- Only paige_claim_act_dispatch writes the key (as now()), and paige_record_act_execution strips it, so such a
-- value can reach the row only through a raw service-role write. The guarantee is restored anyway, because a
-- wedged claim fails silently: the act is never fired and only the 24 h reconciler notices.
--
-- Same signature, same body otherwise, same grants (service role only, §59).

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
     -- CASE, not OR: it evaluates in order, so a cast only ever sees a value that parses. Missing, non-ISO,
     -- unparseable or future → stale (re-takeable), never an error or a claim that holds forever.
     and case
           when detail->>'dispatch_claim' is null then true
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

revoke all on function public.paige_claim_act_dispatch(uuid, uuid, uuid, interval) from public, anon, authenticated;
grant execute on function public.paige_claim_act_dispatch(uuid, uuid, uuid, interval) to service_role;

comment on function public.paige_claim_act_dispatch(uuid, uuid, uuid, interval) is
  'INT-179 Slice 2b: at-most-once dispatch gate for a Layer-C act. Stamps detail.dispatch_claim on an '
  'accepted_for_execution/retrying row that has no live claim and returns it; NULL otherwise. A claim older '
  'than the stale window (min 7 minutes), or whose timestamp is missing, unparseable or in the future, may be '
  're-taken after the caller''s own readback. Service-role only.';
