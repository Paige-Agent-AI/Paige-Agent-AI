-- Repair the existing native-event enqueue seam using the incumbent cron auth.
-- No event replay, subscriber activation, schedule, credential or domain write.
begin;

-- A fixed database-minted deployment boundary, never a mutable admin setting.
-- Reapplication must retain it: moving it forward would strand legitimate
-- post-cutover deliveries whose acknowledgement/recovery is still uncertain.
do $cutover$
declare _cutover timestamptz;
begin
  if pg_catalog.to_regprocedure('public.paige_native_event_transport_cutover_at()') is null then
    _cutover := pg_catalog.clock_timestamp();
    execute pg_catalog.format(
      'create function public.paige_native_event_transport_cutover_at() returns timestamptz language sql immutable parallel safe set search_path = '''' as %L',
      pg_catalog.format('select pg_catalog.to_timestamp(%L::double precision)', extract(epoch from _cutover))
    );
    alter function public.paige_native_event_transport_cutover_at() owner to postgres;
  end if;
  -- Never invoke a pre-existing app-owned same-name function as the migrator.
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.paige_native_event_transport_cutover_at()')
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) then
    raise exception 'NATIVE_EVENT_CUTOVER_OWNER_INVALID';
  end if;
  _cutover := public.paige_native_event_transport_cutover_at();
  if _cutover is null or not pg_catalog.isfinite(_cutover) or _cutover > pg_catalog.clock_timestamp() then
    raise exception 'NATIVE_EVENT_CUTOVER_INVALID';
  end if;
end;
$cutover$;
alter function public.paige_native_event_transport_cutover_at() owner to postgres;
revoke all on function public.paige_native_event_transport_cutover_at()
  from public, anon, authenticated;
grant execute on function public.paige_native_event_transport_cutover_at()
  to service_role;

-- Enforce the same boundary at the row transition, including a pre-deployment
-- function frame that entered before CREATE OR REPLACE invalidated its cache.
-- NOT VALID leaves historical rows untouched while every new write is checked.
-- The table lock and both DDL statements are inside this atomic transaction.
alter table public.paige_native_events
  drop constraint if exists paige_native_events_transport_cutover_claim;
alter table public.paige_native_events
  add constraint paige_native_events_transport_cutover_claim check (
    processing_state <> 'claimed' or coalesce(
      pg_catalog.isfinite(occurred_at) and pg_catalog.isfinite(created_at)
      and pg_catalog.isfinite(public.paige_native_event_transport_cutover_at())
      and occurred_at >= public.paige_native_event_transport_cutover_at()
      and created_at >= public.paige_native_event_transport_cutover_at(), false
    )
  ) not valid;

create or replace function public.paige_fire_event_processor(
  p_event_id uuid,
  p_tenant_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  cron_token text;
  _cutover timestamptz;
begin
  _cutover := public.paige_native_event_transport_cutover_at();
  if _cutover is null or not pg_catalog.isfinite(_cutover) then return; end if;
  if not exists (
    select 1 from public.paige_native_events e
    where e.id = p_event_id
      and pg_catalog.isfinite(e.occurred_at) and pg_catalog.isfinite(e.created_at)
      and e.occurred_at >= _cutover and e.created_at >= _cutover
  ) then return; end if;

  -- Same internal token seam as heartbeat/Knowledge. Never copy a service key
  -- into Vault or accept a caller URL/header. The drainer validates the token
  -- before claiming and independently derives tenant authority from the event.
  cron_token := public.cron_token_header();
  if nullif(pg_catalog.btrim(cron_token), '') is null then
    raise notice 'native_event_enqueue_unavailable: cron token missing';
    return;
  end if;

  perform net.http_post(
    url := 'https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/paige-native-event-dispatch',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json', 'x-cron-token', cron_token
    ),
    body := pg_catalog.jsonb_build_object(
      'event_id', p_event_id, 'tenant_id', p_tenant_id
    )
  );
exception when others then
  -- The transactional outbox survives failed best-effort delivery. Its existing
  -- sweeper retries; raw errors might contain transport/token material.
  raise notice 'native_event_enqueue_failed: SQLSTATE %', sqlstate;
end;
$function$;

revoke all on function public.paige_fire_event_processor(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.paige_fire_event_processor(uuid, uuid)
  to service_role;

-- Also refuse late/already queued HTTP attempts at the actual atomic claim.
-- The native row still supplies tenant/payload authority, and the existing
-- lease, attempt cap and terminal-state rules remain unchanged.
create or replace function public.paige_claim_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _row public.paige_native_events%rowtype;
  _cutover timestamptz;
begin
  if auth.uid() is not null then
    raise exception 'EVENT_CLAIM_FORBIDDEN: service role only' using errcode='42501';
  end if;
  _cutover := public.paige_native_event_transport_cutover_at();
  if _cutover is null or not pg_catalog.isfinite(_cutover) then
    return pg_catalog.jsonb_build_object('ok', true, 'claimed', false);
  end if;

  update public.paige_native_events
     set processing_state = 'claimed',
         attempts = attempts + 1,
         claimed_at = now()
   where id = p_event_id
     and pg_catalog.isfinite(occurred_at) and pg_catalog.isfinite(created_at)
     and occurred_at >= _cutover and created_at >= _cutover
     and attempts < 5
     and (processing_state = 'pending'
       or (processing_state = 'claimed' and claimed_at < now() - interval '5 minutes'))
  returning * into _row;

  if _row.id is null then
    return pg_catalog.jsonb_build_object('ok', true, 'claimed', false);
  end if;
  return pg_catalog.jsonb_build_object(
    'ok', true, 'claimed', true,
    'event_id', _row.id, 'tenant_id', _row.tenant_id,
    'event_key', _row.event_key, 'subject_table', _row.subject_table,
    'subject_id', _row.subject_id, 'payload', _row.payload, 'attempts', _row.attempts
  );
end;
$function$;
revoke all on function public.paige_claim_event(uuid) from public, anon, authenticated;
grant execute on function public.paige_claim_event(uuid) to service_role;

-- The weekly wrapper/publisher and cron schedule are intentionally untouched.
-- Filter before ORDER/LIMIT so historical rows cannot starve future recovery.
create or replace function public.paige_sweep_stuck_events_before_weekly()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row record; _count int := 0; _cutover timestamptz;
begin
  _cutover := public.paige_native_event_transport_cutover_at();
  if _cutover is null or not pg_catalog.isfinite(_cutover) then return 0; end if;
  for _row in
    select id, tenant_id from public.paige_native_events
    where processing_state in ('pending', 'claimed')
      and pg_catalog.isfinite(occurred_at) and pg_catalog.isfinite(created_at)
      and occurred_at >= _cutover and created_at >= _cutover
      and attempts < 5
      and created_at < now() - interval '5 minutes'
    order by created_at
    limit 100
    for update skip locked
  loop
    begin
      perform public.paige_fire_event_processor(_row.id, _row.tenant_id);
      _count := _count + 1;
    exception when others then
      raise notice 'paige_sweep_stuck_events: event % failed to re-drive: %', _row.id, sqlerrm;
    end;
  end loop;
  return _count;
end;
$function$;
revoke all on function public.paige_sweep_stuck_events_before_weekly()
  from public, anon, authenticated;
grant execute on function public.paige_sweep_stuck_events_before_weekly()
  to service_role;

commit;
