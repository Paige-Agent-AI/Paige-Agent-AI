-- TEST-ONLY native candidate; no deployment migration or activation.
-- Installed only by existing disposable native proof paths; never a migration.
-- Original-operation observations and canonical Rail; no financial adjustment.
do $guard$
begin
 if not exists(select 1 from pg_proc where oid='public._sales_payment_operation_service()'::regprocedure
  and md5(prosrc)='b30924620fb5f90dd8ea8431e13bf7fe' and not prosecdef)
 or not exists(select 1 from pg_proc where oid='public._sales_payment_operation_immutable()'::regprocedure
  and md5(prosrc)='8e8dbee045d0044d1b0b52752c0e5dfb')
 or not exists(select 1 from pg_proc where oid='public.read_sales_invoice_payment_dispatch(uuid,uuid)'::regprocedure
  and md5(prosrc)='78ec4e48b972552bd505c5ea075bd574' and prosecdef) then
  raise exception 'Original provider operation contract changed' using errcode='55000';
 end if;
end $guard$;
alter table public.paige_invoice_provider_operations
 add column provider_observation_version bigint not null default 0 check(provider_observation_version>=0),
 add column provider_observation_operation_id uuid references public.paige_invoice_operations(id);

create function public._sales_provider_observation_time(_value jsonb) returns timestamptz
language plpgsql set search_path='' as $$
declare value timestamptz;
begin
 if jsonb_typeof(_value) is distinct from 'string' or (_value#>>'{}') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' then
  raise exception 'Invalid provider observation time' using errcode='22023'; end if;
 begin value:=(_value#>>'{}')::timestamptz;
 exception when datetime_field_overflow or invalid_datetime_format then
  raise exception 'Invalid provider observation time' using errcode='22023'; end;
 if value<'1900-01-01'::timestamptz or value>clock_timestamp() then
  raise exception 'Invalid provider observation time' using errcode='22023'; end if;
 return value;
end $$;
revoke all on function public._sales_provider_observation_time(jsonb) from public,anon,authenticated,service_role;

create function public._sales_provider_observation_balance(_value jsonb,_amount bigint,_currency text) returns text
language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(_value) is distinct from 'object' or (select count(*) from jsonb_object_keys(_value))<>5
  or exists(select 1 from jsonb_object_keys(_value) k where k not in('id','amount_minor','currency','status','created_at'))
  or coalesce(_value->>'id','') !~ '^txn_[A-Za-z0-9]+$' or length(_value->>'id')>128
  or _value->'amount_minor' is distinct from to_jsonb(_amount) or _value->>'currency' is distinct from _currency
  or coalesce(_value->>'status','') not in('available','pending') then
  raise exception 'Invalid provider balance observation' using errcode='22023'; end if;
 perform public._sales_provider_observation_time(_value->'created_at');
 return _value->>'id';
end $$;
revoke all on function public._sales_provider_observation_balance(jsonb,bigint,text) from public,anon,authenticated,service_role;

create function public._sales_provider_observation_snapshot(_value jsonb,_currency text,_gross bigint) returns jsonb
language plpgsql set search_path='' as $$
declare row jsonb; entry jsonb; amount bigint; observed_id text; balance_id text; ids text[]:='{}'; balances text[];
 refunded bigint:=0; in_flight bigint:=0; negative_count integer; positive_count integer;
 refunds jsonb; disputes jsonb; debit boolean; failure boolean;
begin
 if _gross is null or _gross not between 1 and 2147483647 or _currency is null or _currency !~ '^[a-z]{3}$'
  or jsonb_typeof(_value) is distinct from 'object' or octet_length(_value::text)>512000
  or (select count(*) from jsonb_object_keys(_value))<>5
  or exists(select 1 from jsonb_object_keys(_value) k where k not in('state','provider_transaction_id','provider_settlement_id','refunds','disputes'))
  or _value->>'state' is distinct from 'observed'
  or coalesce(_value->>'provider_transaction_id','') !~ '^ch_[A-Za-z0-9]+$' or length(_value->>'provider_transaction_id')>128
  or coalesce(_value->>'provider_settlement_id','') !~ '^txn_[A-Za-z0-9]+$' or length(_value->>'provider_settlement_id')>128
  or jsonb_typeof(_value->'refunds') is distinct from 'array' or jsonb_array_length(_value->'refunds')>1000
  or jsonb_typeof(_value->'disputes') is distinct from 'array' or jsonb_array_length(_value->'disputes')>1000 then
  raise exception 'Invalid provider observation' using errcode='22023'; end if;
 balances:=array[_value->>'provider_settlement_id'];
 for row in select value from jsonb_array_elements(_value->'refunds') loop
  if jsonb_typeof(row) is distinct from 'object' or (select count(*) from jsonb_object_keys(row))<>7
   or exists(select 1 from jsonb_object_keys(row) k where k not in('id','amount_minor','currency','created_at','status','balance_transaction','failure_balance_transaction'))
   or coalesce(row->>'id','') !~ '^re_[A-Za-z0-9]+$' or length(row->>'id')>128 or row->>'id'=any(ids)
   or jsonb_typeof(row->'amount_minor') is distinct from 'number' or coalesce(row->>'amount_minor','') !~ '^[1-9][0-9]{0,9}$'
   or (row->>'amount_minor')::bigint>_gross or row->>'currency' is distinct from _currency
   or coalesce(row->>'status','') not in('pending','requires_action','succeeded','failed','canceled') then
   raise exception 'Invalid refund observation' using errcode='22023'; end if;
  ids:=array_append(ids,row->>'id');amount:=(row->>'amount_minor')::bigint;
  perform public._sales_provider_observation_time(row->'created_at');
  debit:=row->'balance_transaction'<>'null'::jsonb;failure:=row->'failure_balance_transaction'<>'null'::jsonb;
  if debit then
   balance_id:=public._sales_provider_observation_balance(row->'balance_transaction',-amount,_currency);
   if balance_id=any(balances) then raise exception 'Duplicate provider balance observation' using errcode='22023'; end if;
   balances:=array_append(balances,balance_id);
  end if;
  if failure then
   balance_id:=public._sales_provider_observation_balance(row->'failure_balance_transaction',amount,_currency);
   if balance_id=any(balances) then raise exception 'Duplicate provider balance observation' using errcode='22023'; end if;
   balances:=array_append(balances,balance_id);
  end if;
  if (row->>'status'='succeeded' and(not debit or failure))
   or(failure and(not debit or row->>'status' not in('failed','canceled')))
   or(debit and row->>'status' in('failed','canceled') and not failure) then
   raise exception 'Conflicting refund observation' using errcode='22023'; end if;
  if row->>'status'='succeeded' then refunded:=refunded+amount;
  elsif row->>'status' in('pending','requires_action') then in_flight:=in_flight+amount;end if;
 end loop;
 if refunded+in_flight>_gross then raise exception 'Refund observations exceed original capture' using errcode='22023';end if;
 for row in select value from jsonb_array_elements(_value->'disputes') loop
  if jsonb_typeof(row) is distinct from 'object' or (select count(*) from jsonb_object_keys(row))<>6
   or exists(select 1 from jsonb_object_keys(row) k where k not in('id','amount_minor','currency','created_at','status','balance_transactions'))
   or coalesce(row->>'id','') !~ '^du_[A-Za-z0-9]+$' or length(row->>'id')>128 or row->>'id'=any(ids)
   or jsonb_typeof(row->'amount_minor') is distinct from 'number' or coalesce(row->>'amount_minor','') !~ '^[1-9][0-9]{0,9}$'
   or (row->>'amount_minor')::bigint>_gross or row->>'currency' is distinct from _currency
   or coalesce(row->>'status','') not in('warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost')
   or jsonb_typeof(row->'balance_transactions') is distinct from 'array' or jsonb_array_length(row->'balance_transactions')>2 then
   raise exception 'Invalid dispute observation' using errcode='22023'; end if;
  ids:=array_append(ids,row->>'id');amount:=(row->>'amount_minor')::bigint;
  perform public._sales_provider_observation_time(row->'created_at');negative_count:=0;positive_count:=0;
  for entry in select value from jsonb_array_elements(row->'balance_transactions') loop
   if entry->'amount_minor'=to_jsonb(-amount) then negative_count:=negative_count+1;
   elsif entry->'amount_minor'=to_jsonb(amount) then positive_count:=positive_count+1;
   else raise exception 'Invalid dispute balance observation' using errcode='22023';end if;
   balance_id:=public._sales_provider_observation_balance(entry,(entry->>'amount_minor')::bigint,_currency);
   if balance_id=any(balances) then raise exception 'Duplicate provider balance observation' using errcode='22023';end if;
   balances:=array_append(balances,balance_id);
  end loop;
  if negative_count>1 or positive_count>1 then raise exception 'Conflicting dispute balance observation' using errcode='22023';end if;
 end loop;
 select coalesce(jsonb_agg(value order by value->>'id'),'[]'::jsonb) into refunds from jsonb_array_elements(_value->'refunds');
 select coalesce(jsonb_agg(jsonb_set(value,'{balance_transactions}',
  (select coalesce(jsonb_agg(b.value order by b.value->>'id'),'[]'::jsonb) from jsonb_array_elements(value->'balance_transactions') b)) order by value->>'id'),'[]'::jsonb)
 into disputes from jsonb_array_elements(_value->'disputes');
 return _value||jsonb_build_object('refunds',refunds,'disputes',disputes);
end $$;
revoke all on function public._sales_provider_observation_snapshot(jsonb,text,bigint) from public,anon,authenticated,service_role;

-- Test-only integrity extension. No deployment migration or activation.
-- Original provider facts/history/Rail only; no financial adjustment or payment.
create function public._sales_provider_observation_entry(
 _operation public.paige_invoice_provider_operations,
 _entry public.paige_invoice_operations,
 _expected bigint,
 _require_rail boolean
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare snapshot jsonb; source_hash text; identity uuid; receipt_detail jsonb;
begin
 if _expected is null or _expected not between 0 and 9007199254740990 or _require_rail is null
  or _operation.id is null or _operation.state is distinct from 'settled'
  or _entry.id is null or _entry.tenant_id is distinct from _operation.tenant_id
  or _entry.invoice_id is distinct from _operation.invoice_id or _entry.actor_user_id is distinct from _operation.actor_user_id
  or jsonb_typeof(_entry.command) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(_entry.command))<>6
  or _entry.command-array['action','provider_operation_id','expected_observation_version','source_hash','snapshot','readback_reference']<>'{}'::jsonb
  or _entry.command->>'action' is distinct from 'invoice.provider_observation'
  or _entry.command->'provider_operation_id' is distinct from to_jsonb(_operation.id)
  or _entry.command->'expected_observation_version' is distinct from to_jsonb(_expected)
  or jsonb_typeof(_entry.command->'readback_reference') is distinct from 'string'
  or coalesce(_entry.command->>'readback_reference','') !~ '^[A-Za-z0-9_-]{1,200}$' then
  raise exception 'Original provider observation history unavailable' using errcode='55000';
 end if;
 snapshot:=public._sales_provider_observation_snapshot(_entry.command->'snapshot',_operation.currency,_operation.amount_minor);
 source_hash:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
 identity:=md5(_operation.id::text||':provider-observation:'||_expected::text||':'||source_hash)::uuid;
 if _entry.id is distinct from identity
  or snapshot is distinct from _entry.command->'snapshot'
  or snapshot->>'provider_transaction_id' is distinct from _operation.verified_readback->>'provider_transaction_id'
  or snapshot->>'provider_settlement_id' is distinct from _operation.verified_readback->>'provider_settlement_id'
  or _entry.command->'source_hash' is distinct from to_jsonb(source_hash)
  or jsonb_typeof(_entry.result) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(_entry.result))<>9
  or _entry.result-array['state','effect','observation_id','provider_operation_id','observation_version','source_hash','snapshot','invoice_version','rail_recorded']<>'{}'::jsonb
  or _entry.result->>'state' is distinct from 'observed'
  or _entry.result->>'effect' is distinct from 'provider_observation_only'
  or _entry.result->'observation_id' is distinct from to_jsonb(_entry.id)
  or _entry.result->'provider_operation_id' is distinct from to_jsonb(_operation.id)
  or _entry.result->'observation_version' is distinct from to_jsonb(_expected+1)
  or _entry.result->'source_hash' is distinct from to_jsonb(source_hash)
  or _entry.result->'snapshot' is distinct from snapshot
  or _entry.result->'rail_recorded' is distinct from 'true'::jsonb
  or jsonb_typeof(_entry.result->'invoice_version') is distinct from 'number'
  or coalesce(_entry.result->>'invoice_version','') !~ '^[1-9][0-9]{0,15}$'
  or _expected+1>_operation.provider_observation_version
  or (_expected+1=_operation.provider_observation_version and _operation.provider_observation_operation_id is distinct from _entry.id) then
  raise exception 'Original provider observation history unavailable' using errcode='55000';
 end if;
 if (_entry.result->>'invoice_version')::bigint>9007199254740991 then
  raise exception 'Original provider observation history unavailable' using errcode='55000';
 end if;
 receipt_detail:=jsonb_build_object('effect','provider_observation_only','observation_id',_entry.id,
  'provider_operation_id',_operation.id,'source_hash',source_hash);
 if _require_rail and not exists(select 1 from public.paige_workspace_events e
  where e.tenant_id=_operation.tenant_id and e.actor_id is null and e.actor_agent_slug is null
   and e.source_kind='capability_run' and e.source_id=_entry.id and e.source_revision=0
   and e.outcome='capability_succeeded' and e.capability_key='sales_payment_reconcile'
   and e.detail=receipt_detail) then
  raise exception 'Original provider observation receipt unavailable' using errcode='55000';
 end if;
 return snapshot;
end $$;
revoke all on function public._sales_provider_observation_entry(public.paige_invoice_provider_operations,public.paige_invoice_operations,bigint,boolean) from public,anon,authenticated,service_role;

alter table public.paige_invoice_provider_operations
 add constraint e04_provider_observation_pointer_check check(
  provider_observation_version between 0 and 9007199254740991
  and ((provider_observation_version=0)=(provider_observation_operation_id is null)));

create function public._sales_provider_observation_link_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare entry public.paige_invoice_operations%rowtype; invoice_version bigint;
begin
 if tg_op='INSERT' then
  if new.provider_observation_version<>0 or new.provider_observation_operation_id is not null then
   raise exception 'New payment cannot import provider observations' using errcode='42501';
  end if;
  return new;
 end if;
 if row(new.provider_observation_version,new.provider_observation_operation_id)
  is not distinct from row(old.provider_observation_version,old.provider_observation_operation_id) then return new;end if;
 if old.state is distinct from 'settled' or new.state is distinct from 'settled'
  or old.provider_observation_version>=9007199254740991
  or new.provider_observation_version is distinct from old.provider_observation_version+1
  or new.provider_observation_operation_id is null
  or new.provider_observation_operation_id is not distinct from old.provider_observation_operation_id then
  raise exception 'Provider observation link must advance exactly once' using errcode='42501';
 end if;
 select * into entry from public.paige_invoice_operations where id=new.provider_observation_operation_id;
 if not found then raise exception 'Original provider observation history unavailable' using errcode='55000';end if;
 perform public._sales_provider_observation_entry(new,entry,old.provider_observation_version,false);
 select billing_lifecycle_version into invoice_version from public.paige_invoices where id=new.invoice_id and tenant_id=new.tenant_id;
 if not found or entry.result->'invoice_version' is distinct from to_jsonb(invoice_version+1) then
  raise exception 'Original invoice observation version unavailable' using errcode='55000';
 end if;
 return new;
end $$;
revoke all on function public._sales_provider_observation_link_guard() from public,anon,authenticated,service_role;
create trigger e04_provider_observation_link_guard before insert or update
 on public.paige_invoice_provider_operations for each row execute function public._sales_provider_observation_link_guard();

create function public.read_sales_invoice_provider_observation_context(_expected_tenant_id uuid,_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare op public.paige_invoice_provider_operations%rowtype;p public.paige_invoice_payments%rowtype;i public.paige_invoices%rowtype;dispatch jsonb;history public.paige_invoice_operations%rowtype;
begin
 perform public._sales_payment_operation_service();
 dispatch:=public.read_sales_invoice_payment_dispatch(_expected_tenant_id,_operation_id);
 op:=jsonb_populate_record(null::public.paige_invoice_provider_operations,dispatch);
 if op.id is distinct from _operation_id or op.tenant_id is distinct from _expected_tenant_id or op.state<>'settled' or op.dispatch_claim_token is null or op.verified_readback is null
  or op.provider<>'stripe' or op.provider_object_id is null then raise exception 'Original settled payment unavailable' using errcode='42501';end if;
 select * into p from public.paige_invoice_payments where id=op.allocation_payment_id and tenant_id=op.tenant_id and invoice_id=op.invoice_id;
 if not found or p.kind<>'receipt' or p.evidence_kind<>'provider_verified' or p.provider_operation_id is distinct from op.id
  or p.amount_cents::bigint<>op.amount_minor or p.currency<>op.currency or p.provider<>op.provider
  or p.merchant_account_id<>op.merchant_account_id or p.provider_environment<>op.environment
  or p.provider_transaction_id is distinct from op.verified_readback->>'provider_transaction_id'
  or p.provider_settlement_id is distinct from op.verified_readback->>'provider_settlement_id' then
  raise exception 'Original provider receipt unavailable' using errcode='42501';end if;
 select * into i from public.paige_invoices where id=op.invoice_id and tenant_id=op.tenant_id;
 if not found or i.contact_id is distinct from op.client_id or i.billing_issued_snapshot_version is distinct from op.issued_snapshot_version
  or lower(i.currency) is distinct from op.currency or not exists(select 1 from public.tenant_stripe_accounts m where m.tenant_id=op.tenant_id
   and m.stripe_account_id=op.merchant_account_id and m.binding_version=op.merchant_binding_version and m.provider_environment=op.environment) then
  raise exception 'Original payment scope unavailable' using errcode='42501';end if;

 if op.provider_observation_version<0 or (op.provider_observation_version=0) is distinct from (op.provider_observation_operation_id is null) then
  raise exception 'Original provider observation history unavailable' using errcode='55000';end if;
 if op.provider_observation_version>0 then
  select * into history from public.paige_invoice_operations where id=op.provider_observation_operation_id;
  if not found then raise exception 'Original provider observation history unavailable' using errcode='55000';end if;
  perform public._sales_provider_observation_entry(op,history,op.provider_observation_version-1,true);
 end if;
 return jsonb_build_object('dispatch',dispatch,
  'settlement',jsonb_build_object('id',p.id,'tenant_id',op.tenant_id,'operation_id',op.id,'provider',op.provider,'merchant_id',op.merchant_account_id,
   'environment',op.environment,'provider_transaction_id',p.provider_transaction_id,'provider_settlement_id',p.provider_settlement_id,
   'amount_minor',op.amount_minor,'currency',op.currency,'state','verified','readback_reference',op.verified_readback->'readback_reference'),
  'observation_version',op.provider_observation_version,'observation_id',op.provider_observation_operation_id);
end $$;
revoke all on function public.read_sales_invoice_provider_observation_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_sales_invoice_provider_observation_context(uuid,uuid) to service_role;

create function public.record_sales_invoice_provider_observation(_expected_tenant_id uuid,_operation_id uuid,_claim_token uuid,
 _expected_observation_version bigint,_snapshot jsonb,_reference text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare op public.paige_invoice_provider_operations%rowtype;i public.paige_invoices%rowtype;prior public.paige_invoice_operations%rowtype;
 context jsonb;snapshot jsonb;source_hash text;identity uuid;command jsonb;result jsonb;current_result jsonb;
begin
 perform public._sales_payment_operation_service();
 if _expected_observation_version is null or _expected_observation_version<0 or _expected_observation_version>9007199254740990
  or coalesce(_reference,'') !~ '^[A-Za-z0-9_-]{1,200}$' then raise exception 'Invalid observation request' using errcode='22023';end if;
 select * into op from public.paige_invoice_provider_operations where tenant_id=_expected_tenant_id and id=_operation_id;
 if not found or _claim_token is null or op.dispatch_claim_token is distinct from _claim_token then
  raise exception 'Original payment unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(op.id::text,81742));
 select * into i from public.paige_invoices where id=op.invoice_id and tenant_id=op.tenant_id for update;
 select * into op from public.paige_invoice_provider_operations where id=_operation_id and tenant_id=_expected_tenant_id for update;
 snapshot:=public._sales_provider_observation_snapshot(_snapshot,op.currency,op.amount_minor);
 if snapshot->>'provider_transaction_id' is distinct from op.verified_readback->>'provider_transaction_id'
  or snapshot->>'provider_settlement_id' is distinct from op.verified_readback->>'provider_settlement_id' then
  raise exception 'Observation does not match original capture' using errcode='22023';end if;
 source_hash:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
 identity:=md5(op.id::text||':provider-observation:'||_expected_observation_version::text||':'||source_hash)::uuid;
 command:=jsonb_build_object('action','invoice.provider_observation','provider_operation_id',op.id,
  'expected_observation_version',_expected_observation_version,'source_hash',source_hash,'snapshot',snapshot,'readback_reference',_reference);
 select * into prior from public.paige_invoice_operations where id=identity;
 if found then
  if prior.tenant_id<>op.tenant_id or prior.invoice_id<>op.invoice_id or prior.actor_user_id<>op.actor_user_id
   or prior.command-'readback_reference' is distinct from command-'readback_reference' then
   raise exception 'Observation identity collision' using errcode='22023';end if;
  perform public._sales_provider_observation_entry(op,prior,_expected_observation_version,true);
  return prior.result||jsonb_build_object('replayed',true,'current_observation_version',op.provider_observation_version,'is_current',op.provider_observation_operation_id=prior.id);
 end if;
 if op.provider_observation_version<>_expected_observation_version then raise exception 'Payment observation changed; read its current source again' using errcode='40001';end if;
 context:=public.read_sales_invoice_provider_observation_context(op.tenant_id,op.id);
 if op.provider_observation_operation_id is not null then
  select * into prior from public.paige_invoice_operations where id=op.provider_observation_operation_id and tenant_id=op.tenant_id and invoice_id=op.invoice_id;
  if not found or prior.command->>'action'<>'invoice.provider_observation' or prior.command->>'provider_operation_id'<>op.id::text then
   raise exception 'Original observation history unavailable' using errcode='55000';end if;
  perform public._sales_provider_observation_entry(op,prior,op.provider_observation_version-1,true);
  if prior.command->'snapshot'=snapshot then
   return prior.result||jsonb_build_object('replayed',true,'current_observation_version',op.provider_observation_version,'is_current',true);
  end if;
 end if;
 if i.billing_lifecycle_version>=9007199254740991 then raise exception 'Invoice observation version unavailable' using errcode='55000';end if;
 result:=jsonb_build_object('state','observed','effect','provider_observation_only','observation_id',identity,'provider_operation_id',op.id,
  'observation_version',_expected_observation_version+1,'source_hash',source_hash,'snapshot',snapshot,'invoice_version',i.billing_lifecycle_version+1,'rail_recorded',true);
 insert into public.paige_invoice_operations(id,tenant_id,invoice_id,actor_user_id,command,result)
 values(identity,op.tenant_id,op.invoice_id,op.actor_user_id,command,result) returning * into prior;
 update public.paige_invoice_provider_operations set provider_observation_version=_expected_observation_version+1,
  provider_observation_operation_id=identity,updated_at=clock_timestamp() where id=op.id returning * into op;
 update public.paige_invoices set billing_lifecycle_version=billing_lifecycle_version+1,updated_at=clock_timestamp() where id=i.id;

 perform public._record_workspace_rail_event(op.tenant_id,null,'capability_run',identity,0,'capability_succeeded',null,
  'sales_payment_reconcile',null,null,null,jsonb_build_object('effect','provider_observation_only','observation_id',identity,
   'provider_operation_id',op.id,'source_hash',source_hash));
 perform public._sales_provider_observation_entry(op,prior,_expected_observation_version,true);
 return result||jsonb_build_object('replayed',false,'current_observation_version',_expected_observation_version+1,'is_current',true);
end $$;
revoke all on function public.record_sales_invoice_provider_observation(uuid,uuid,uuid,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.record_sales_invoice_provider_observation(uuid,uuid,uuid,bigint,jsonb,text) to service_role;
