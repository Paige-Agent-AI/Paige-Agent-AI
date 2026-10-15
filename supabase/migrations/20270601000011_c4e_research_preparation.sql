-- CLI-created C4e preparation, renumbered after the repository's future-version tail.
-- No caller, worker, cron, wake, result or provider is wired by this migration.
-- The service caller supplies a freshly resolved audit snapshot, never permission.
begin;
create or replace function public.prepare_paige_research_work(
 _tenant_id uuid, _initiating_user_id uuid, _intent_id uuid, _thread_id uuid,
 _request_payload jsonb, _authority_context jsonb, _scope_epoch text
) returns table(work_id uuid,work_status text,blocked_reason text,resumed_existing boolean)
language plpgsql security definer set search_path='' as $$
declare created record; stored public.paige_durable_work%rowtype;
begin
 if _thread_id is null then raise exception 'RESEARCH_PREPARATION_THREAD_REQUIRED' using errcode='22023'; end if;
 if _request_payload is null or jsonb_typeof(_request_payload)<>'object'
  or pg_column_size(_request_payload)>16384
  or jsonb_typeof(_request_payload->'version') is distinct from 'number'
  or _request_payload->>'version' is distinct from '1'
  or jsonb_typeof(_request_payload->'question') is distinct from 'string'
  or char_length(btrim(_request_payload->>'question')) not between 3 and 6000 then
  raise exception 'RESEARCH_PREPARATION_INPUT_INVALID' using errcode='22023'; end if;
 if exists(select 1 from jsonb_object_keys(_request_payload) as k(key)
  where k.key not in ('version','question','max_hops','freshness_days','strict','domain','caller','flavor_facets')) then
  raise exception 'RESEARCH_PREPARATION_INPUT_INVALID' using errcode='22023'; end if;
 if _request_payload?'max_hops' then
  if jsonb_typeof(_request_payload->'max_hops')<>'number'
   or _request_payload->>'max_hops' !~ '^[1-3]$' then
   raise exception 'RESEARCH_PREPARATION_INPUT_INVALID' using errcode='22023'; end if;
 end if;
 if _request_payload?'freshness_days' then
  if jsonb_typeof(_request_payload->'freshness_days')<>'number'
   or _request_payload->>'freshness_days' !~ '^[0-9]{1,4}$' then
   raise exception 'RESEARCH_PREPARATION_INPUT_INVALID' using errcode='22023'; end if;
  if (_request_payload->>'freshness_days')::integer not between 1 and 3650 then
   raise exception 'RESEARCH_PREPARATION_INPUT_INVALID' using errcode='22023'; end if;
 end if;
 if (_request_payload?'strict') and jsonb_typeof(_request_payload->'strict')<>'boolean' then
  raise exception 'RESEARCH_PREPARATION_INPUT_INVALID' using errcode='22023'; end if;
 if exists(select 1 from jsonb_each(_request_payload) as kv(key,value)
  where kv.key in ('domain','caller') and (jsonb_typeof(kv.value)<>'string'
   or char_length(btrim(kv.value#>>'{}')) not between 1 and 100)) then
  raise exception 'RESEARCH_PREPARATION_INPUT_INVALID' using errcode='22023'; end if;
 if _request_payload?'flavor_facets' then
  if jsonb_typeof(_request_payload->'flavor_facets')<>'array' then
   raise exception 'RESEARCH_PREPARATION_INPUT_INVALID' using errcode='22023'; end if;
  if jsonb_array_length(_request_payload->'flavor_facets')>8 or exists(
   select 1 from jsonb_array_elements(_request_payload->'flavor_facets') as facet(value)
   where jsonb_typeof(facet.value)<>'string' or char_length(btrim(facet.value#>>'{}')) not between 1 and 500) then
   raise exception 'RESEARCH_PREPARATION_INPUT_INVALID' using errcode='22023'; end if;
 end if;
 -- Snapshot is deliberately not a budget reservation, approval redemption or
 -- provider entitlement. An activated path must revalidate all three at dispatch.
 if _authority_context is null or jsonb_typeof(_authority_context)<>'object'
  or _authority_context->>'authority_source' is distinct from 'server_resolved'
  or _authority_context->'approval_reusable' is distinct from 'false'::jsonb
  or jsonb_typeof(_authority_context->'budget_context') is distinct from 'object' then
  raise exception 'RESEARCH_PREPARATION_AUTHORITY_INVALID' using errcode='22023'; end if;
 select * into created from public.create_paige_durable_work(
  _tenant_id,_initiating_user_id,_intent_id,_thread_id,'deep_research','research',
  _authority_context,_scope_epoch,60,1);
 select w.* into stored from public.paige_durable_work w where w.id=created.work_id for update;
 if stored.dispatch_started_attempt<>0 then
  raise exception 'RESEARCH_PREPARATION_ALREADY_DISPATCHED' using errcode='55000'; end if;
 if stored.request_payload is null then
  update public.paige_durable_work set request_payload=_request_payload,
   updated_at=now(),version=version+1 where id=created.work_id;
 elsif stored.request_payload is distinct from _request_payload then
  raise exception 'DURABLE_WORK_INTENT_REPLAY_MISMATCH' using errcode='22023';
 end if;
 if stored.status='claimed' then
  perform public.transition_paige_durable_work(created.work_id,created.server_idempotency_key,
   'blocked',null,'Research is prepared but execution is not enabled.',
   'research_execution_not_enabled',null,60,false);
 elsif stored.status<>'blocked' or stored.blocked_reason is distinct from 'research_execution_not_enabled' then
  raise exception 'RESEARCH_PREPARATION_STATE_CONFLICT' using errcode='55000';
 end if;
 return query select created.work_id,'blocked'::text,'research_execution_not_enabled'::text,created.resumed_existing;
end $$;
revoke all on function public.prepare_paige_research_work(uuid,uuid,uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.prepare_paige_research_work(uuid,uuid,uuid,uuid,jsonb,jsonb,text) to service_role;
comment on function public.prepare_paige_research_work(uuid,uuid,uuid,uuid,jsonb,jsonb,text) is
 'Service-only immutable research preparation on the canonical envelope. Always blocked; no wake or execution. Snapshot is audit only, never reusable permission.';
commit;
