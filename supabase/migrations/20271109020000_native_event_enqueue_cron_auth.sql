-- Repair the existing native-event enqueue seam using the incumbent cron auth.
-- No event replay, subscriber activation, schedule, credential or domain write.
begin;

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
begin
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

commit;
