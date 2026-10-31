-- TEST-ONLY continuation of the original native provider proof. Not a migration.
-- Finite event occurrences in canonical C4; no payment/credit/refund command.
create function public._sales_provider_observation_work_payload(_operation uuid,_event text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public._sales_payment_reconciliation_payload(p.id)||jsonb_build_object(
  'event_id',_event,'provider_transaction_id',p.verified_readback->>'provider_transaction_id',
  'provider_settlement_id',p.verified_readback->>'provider_settlement_id')
 from public.paige_invoice_provider_operations p where p.id=_operation
$$;
revoke all on function public._sales_provider_observation_work_payload(uuid,text) from public,anon,authenticated,service_role;

create function public._sales_provider_observation_work_scope(_work public.paige_durable_work)
returns public.paige_invoice_provider_operations
language plpgsql security invoker set search_path='' as $$
declare op public.paige_invoice_provider_operations%rowtype; event_id text;
begin
 event_id:=_work.request_payload->>'event_id';
 if coalesce(event_id,'')!~'^evt_[A-Za-z0-9]{1,124}$'
  or _work.work_kind is distinct from 'sales_provider_observation'
  or _work.capability_key is distinct from 'sales_invoice.payment_request' or _work.thread_id is not null
  or coalesce(_work.request_payload->>'operation_id','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'Provider observation work unavailable' using errcode='42501';end if;
 select * into op from public.paige_invoice_provider_operations
  where id=(_work.request_payload->>'operation_id')::uuid and tenant_id=_work.tenant_id;
 if not found or op.actor_user_id is distinct from _work.initiating_user_id
  or _work.intent_id is distinct from md5(op.id::text||':provider-observation-event:'||event_id)::uuid
  or _work.scope_epoch is distinct from 'sales_provider_observation:'||op.id::text||':'||event_id
  or _work.request_payload is distinct from public._sales_provider_observation_work_payload(op.id,event_id)
  or _work.authority_context is distinct from jsonb_build_object('tenant_id',op.tenant_id,'actor_user_id',op.actor_user_id,
   'operation_id',op.id,'provenance','authorized_payment_system_readback','allowed_effect','provider_get_and_observation_only') then
  raise exception 'Provider observation work scope unavailable' using errcode='42501';end if;
 -- Historical actor is provenance, not new owner authority. Re-read original
 -- capture/payment/invoice and CURRENT merchant binding before every attempt.
 perform public.read_sales_invoice_provider_observation_context(op.tenant_id,op.id);
 return op;
end $$;
revoke all on function public._sales_provider_observation_work_scope(public.paige_durable_work) from public,anon,authenticated,service_role;

create function public.register_sales_provider_observation_work(_expected_tenant_id uuid,_operation_id uuid,
 _event_id text,_merchant_account_id text,_environment text,_provider_transaction_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare op public.paige_invoice_provider_operations%rowtype;w public.paige_durable_work%rowtype;intent uuid;payload jsonb;context jsonb;
begin
 perform public._sales_payment_operation_service();
 if coalesce(_event_id,'')!~'^evt_[A-Za-z0-9]{1,124}$' then raise exception 'Invalid provider observation event' using errcode='22023';end if;
 select * into op from public.paige_invoice_provider_operations where tenant_id=_expected_tenant_id and id=_operation_id;
 if not found or op.merchant_account_id is distinct from _merchant_account_id or op.environment is distinct from _environment
  or op.verified_readback->>'provider_transaction_id' is distinct from _provider_transaction_id
  or coalesce(_provider_transaction_id,'')!~'^ch_[A-Za-z0-9]{1,125}$' then
  raise exception 'Original provider event scope unavailable' using errcode='42501';end if;
 perform public.read_sales_invoice_provider_observation_context(op.tenant_id,op.id);
 intent:=md5(op.id::text||':provider-observation-event:'||_event_id)::uuid;
 payload:=public._sales_provider_observation_work_payload(op.id,_event_id);
 context:=jsonb_build_object('tenant_id',op.tenant_id,'actor_user_id',op.actor_user_id,'operation_id',op.id,
  'provenance','authorized_payment_system_readback','allowed_effect','provider_get_and_observation_only');
 -- Deliberately no operation row lock while waiting on the canonical work key:
 -- completion locks work first, then the original journal's invoice/operation.
 insert into public.paige_durable_work(tenant_id,initiating_user_id,intent_id,thread_id,capability_key,work_kind,
  authority_context,scope_epoch,idempotency_key,lease_until,max_attempts,request_payload)
 values(op.tenant_id,op.actor_user_id,intent,null,'sales_invoice.payment_request','sales_provider_observation',context,
  'sales_provider_observation:'||op.id::text||':'||_event_id,'paige-work:'||gen_random_uuid()::text,now()+interval '5 minutes',25,payload)
 on conflict(tenant_id,initiating_user_id,intent_id) do nothing;
 select * into strict w from public.paige_durable_work
  where tenant_id=op.tenant_id and initiating_user_id=op.actor_user_id and intent_id=intent for update;
 perform public._sales_provider_observation_work_scope(w);
 return jsonb_build_object('work_id',w.id,'work_status',w.status,'attempt_count',w.attempt_count,'max_attempts',w.max_attempts);
end $$;
revoke all on function public.register_sales_provider_observation_work(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.register_sales_provider_observation_work(uuid,uuid,text,text,text,text) to service_role;

create function public.claim_sales_provider_observation_work(_limit integer default 3) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.paige_durable_work%rowtype;op public.paige_invoice_provider_operations%rowtype;claims jsonb:='[]';
begin
 perform public._sales_payment_operation_service();
 if _limit is null or _limit not between 1 and 3 then raise exception 'Invalid provider observation batch' using errcode='22023';end if;
 for w in select * from public.paige_durable_work where work_kind='sales_provider_observation'
  and ((status='claimed' and (dispatch_started_attempt<attempt_count or lease_until<=now()))
   or (status='blocked' and blocked_reason='provider_observation_unknown' and updated_at<=now()-interval '5 minutes')
   or status='expired') order by updated_at,id for update skip locked limit _limit loop
  begin op:=public._sales_provider_observation_work_scope(w);
  exception when insufficient_privilege or object_not_in_prerequisite_state then
   update public.paige_durable_work set status='blocked',blocked_reason='provider_observation_scope_changed',error_code='provider_observation_scope_changed',
    safe_summary='The original payment scope must be verified before another provider check.',lease_until=null,updated_at=now(),version=version+1 where id=w.id;
   continue;
  end;
  if w.status='claimed' and w.lease_until<=now() then
   perform public.transition_paige_durable_work(w.id,w.idempotency_key,'expired',null,'The previous provider observation lease expired.',null,'lease_expired',300,false);
   w.status:='expired';
  end if;
  if w.status in('blocked','expired') then
   if w.attempt_count>=w.max_attempts then
    update public.paige_durable_work set status='blocked',blocked_reason='provider_observation_exhausted',error_code='provider_observation_exhausted',
     safe_summary='Automatic checks reached their limit. The provider adjustment still requires verification.',lease_until=null,updated_at=now(),version=version+1 where id=w.id;
    continue;
   end if;
   perform public.transition_paige_durable_work(w.id,w.idempotency_key,'claimed',null,'Checking later provider facts against the original payment.',null,null,300,w.status='expired');
   select * into strict w from public.paige_durable_work where id=w.id;
  end if;
  update public.paige_durable_work set dispatch_started_attempt=attempt_count,heartbeat_at=now(),lease_until=now()+interval '5 minutes',
   safe_summary='Checking later provider facts against the original payment.',updated_at=now(),version=version+1 where id=w.id returning * into w;
  claims:=claims||jsonb_build_array(jsonb_build_object('work_id',w.id,'tenant_id',w.tenant_id,'operation_id',op.id,
   'event_id',w.request_payload->>'event_id','server_idempotency_key',w.idempotency_key,'attempt_count',w.attempt_count,'lease_until',w.lease_until));
 end loop;
 return jsonb_build_object('claims',claims);
end $$;
revoke all on function public.claim_sales_provider_observation_work(integer) from public,anon,authenticated;
grant execute on function public.claim_sales_provider_observation_work(integer) to service_role;

create function public.read_sales_provider_observation_work_context(_expected_tenant_id uuid,_work_id uuid,
 _server_idempotency_key text,_attempt_count integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.paige_durable_work%rowtype;op public.paige_invoice_provider_operations%rowtype;
begin
 perform public._sales_payment_operation_service();
 select * into w from public.paige_durable_work where id=_work_id and tenant_id=_expected_tenant_id for update;
 if not found or w.status<>'claimed' or w.idempotency_key is distinct from _server_idempotency_key
  or w.attempt_count is distinct from _attempt_count or w.dispatch_started_attempt is distinct from _attempt_count or w.lease_until<=now() then
  raise exception 'Provider observation lease unavailable' using errcode='42501';end if;
 op:=public._sales_provider_observation_work_scope(w);
 perform public.heartbeat_paige_durable_work(w.id,w.idempotency_key,300);
 return public.read_sales_invoice_provider_observation_context(op.tenant_id,op.id)
  ||jsonb_build_object('event_id',w.request_payload->>'event_id','work_id',w.id);
end $$;
revoke all on function public.read_sales_provider_observation_work_context(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.read_sales_provider_observation_work_context(uuid,uuid,text,integer) to service_role;

create function public.complete_sales_provider_observation_work(_expected_tenant_id uuid,_work_id uuid,
 _server_idempotency_key text,_attempt_count integer,_expected_observation_version bigint,_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.paige_durable_work%rowtype;op public.paige_invoice_provider_operations%rowtype;entry public.paige_invoice_operations%rowtype;
 result jsonb;outcome jsonb;normalized jsonb;reason text;
begin
 perform public._sales_payment_operation_service();
 select * into w from public.paige_durable_work where id=_work_id and tenant_id=_expected_tenant_id for update;
 if not found or w.idempotency_key is distinct from _server_idempotency_key or w.attempt_count is distinct from _attempt_count
  or w.dispatch_started_attempt is distinct from _attempt_count then raise exception 'Provider observation lease unavailable' using errcode='42501';end if;
 op:=public._sales_provider_observation_work_scope(w);
 if w.status in('succeeded','failed','cancelled') then
  if w.status<>'succeeded' or _snapshot is null or _expected_observation_version is null
   or w.terminal_outcome->'requested_observation_version' is distinct from to_jsonb(_expected_observation_version) then
   raise exception 'Provider observation work is terminal' using errcode='55000';end if;
  normalized:=public._sales_provider_observation_snapshot(_snapshot,op.currency,op.amount_minor);
  select * into entry from public.paige_invoice_operations where id=(w.terminal_outcome->>'observation_id')::uuid;
  if not found then raise exception 'Original observation receipt unavailable' using errcode='55000';end if;
  perform public._sales_provider_observation_entry(op,entry,(entry.command->>'expected_observation_version')::bigint,true);
  outcome:=jsonb_build_object('verified_readback',true,'effect','provider_observation_only','provider_operation_id',op.id,
   'observation_id',entry.id,'observation_version',entry.result->'observation_version','source_hash',entry.result->'source_hash',
   'requested_observation_version',_expected_observation_version);
  if w.terminal_outcome is distinct from outcome or entry.command->'snapshot' is distinct from normalized
   or not exists(select 1 from public.paige_workspace_events e where e.tenant_id=w.tenant_id and e.source_kind='capability_run'
    and e.source_id=w.id and e.source_revision=0 and e.outcome='capability_succeeded' and e.actor_id is null
    and e.actor_agent_slug is null and e.capability_key='sales_payment_reconcile'
    and e.detail=jsonb_build_object('effect','provider_observation_only','observation_id',entry.id,'work_id',w.id)) then
   raise exception 'Provider observation work is terminal' using errcode='55000';end if;
  return jsonb_build_object('work_id',w.id,'work_status','succeeded','effect','provider_observation_only','receipt',outcome,'replayed',true);
 end if;
 if w.status<>'claimed' or w.lease_until<=now() then raise exception 'Provider observation lease unavailable' using errcode='42501';end if;
 if _snapshot is null then
  if _expected_observation_version is not null then raise exception 'Unknown observation must not claim a source version' using errcode='22023';end if;
  reason:=case when w.attempt_count>=w.max_attempts then 'provider_observation_exhausted' else 'provider_observation_unknown' end;
  perform public.transition_paige_durable_work(w.id,w.idempotency_key,'blocked',null,'The provider adjustment could not be verified.',reason,reason,300,false);
  return jsonb_build_object('work_id',w.id,'work_status','blocked','blocked_reason',reason,'replayed',false);
 end if;
 result:=public.record_sales_invoice_provider_observation(op.tenant_id,op.id,op.dispatch_claim_token,
  _expected_observation_version,_snapshot,w.request_payload->>'event_id');
 outcome:=jsonb_build_object('verified_readback',true,'effect','provider_observation_only','provider_operation_id',op.id,
  'observation_id',result->'observation_id','observation_version',result->'observation_version','source_hash',result->'source_hash',
  'requested_observation_version',_expected_observation_version);
 perform public.transition_paige_durable_work(w.id,w.idempotency_key,'succeeded',outcome,
  'Later provider facts were verified against the original payment. No new payment or credit was executed.',null,null,300,false);
 perform public._record_workspace_rail_event(w.tenant_id,null,'capability_run',w.id,0,'capability_succeeded',null,
  'sales_payment_reconcile',null,null,null,jsonb_build_object('effect','provider_observation_only','observation_id',result->'observation_id','work_id',w.id));
 return jsonb_build_object('work_id',w.id,'work_status','succeeded','effect','provider_observation_only','receipt',outcome,'replayed',false);
end $$;
revoke all on function public.complete_sales_provider_observation_work(uuid,uuid,text,integer,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.complete_sales_provider_observation_work(uuid,uuid,text,integer,bigint,jsonb) to service_role;
