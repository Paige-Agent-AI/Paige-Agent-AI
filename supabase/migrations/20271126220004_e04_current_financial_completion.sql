-- EXP04 O5 native prerequisite: ONE canonical current financial lifecycle.
-- Ordinary forward DDL only. No provider call, charge, signing, message, activation,
-- customer-data backfill, new ledger, scheduler, approval engine or grant expansion.
-- Source25 original identities/ACL before; source51 exact identities/ACL after.
-- Replay is safely refused; normal applied migration history skips this file.
-- Historical INERT/test-only comments below describe preserved source fragments,
-- now carried here atomically. The fixture files remain unmounted proof sources.
-- Requires all original lower20/21 migrations; native readback precedes current3 consumers.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
DO $e04_before$
DECLARE wanted jsonb;actual jsonb;
BEGIN
 FOR wanted IN SELECT value FROM pg_catalog.jsonb_array_elements('[{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"a307bf9e57e5b2ad692c74a329e683cd","leakproof":false,"signature":"_client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_tenant","_client","p_limit","p_after","p_as_of"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"0a70d5ed7b157fa68472bbf24785be1a","leakproof":false,"signature":"_client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_tenant","_client","p_limit","p_after"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"8a348d0712cd814427ff05cab0a090bd","leakproof":false,"signature":"_preview_sales_invoice_before_provider(uuid,uuid,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor_user_id","_expected_tenant_id","_command"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"73c5a267f0e82184af5175f2a2ea5337","leakproof":false,"signature":"_sales_invoice_accepted_obligations(paige_invoices,uuid)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_invoice","_signing_id"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"TABLE(invoice_id uuid, amount_minor bigint, allocated_minor numeric, remaining_minor numeric, manual_minor numeric, provider_minor numeric, test_provider_minor numeric)","strict":false,"definer":true,"defaults":"NULL::uuid","parallel":"u","settings":["search_path=\"\""],"body_hash":"8c69e94f10a5115c7af42b8781b4fd41","leakproof":false,"signature":"_sales_invoice_balance_rows(uuid,uuid)","volatility":"s","returns_set":true,"default_count":1,"argument_names":["_tenant","_invoice","invoice_id","amount_minor","allocated_minor","remaining_minor","manual_minor","provider_minor","test_provider_minor"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"327e4883b78725137137e1ad7349ba20","leakproof":false,"signature":"_sales_invoice_payment_ledger(uuid,uuid,integer,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_tenant","_invoice","_limit","_cursor"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"228a194ceec12380fd8ce5f5aec5cc57","leakproof":false,"signature":"_sales_invoice_payment_projection(uuid,uuid,uuid,bigint)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_tenant","_invoice","_operation","_remaining"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"trigger","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"6036f48c4bfd0c46fd20803be0e29070","leakproof":false,"signature":"_sales_invoice_payment_request_mutation_guard()","volatility":"v","returns_set":false,"default_count":0,"argument_names":null},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"c60acebbbb08b7bd7d1a9b23a47f595d","leakproof":false,"signature":"_sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor_user_id","_expected_tenant_id","_operation_id","_command","_governance"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"88a9d11a25e67257e215999a18092e2c","leakproof":false,"signature":"_sales_invoice_prior_preview(uuid,uuid,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor_user_id","_expected_tenant_id","_command"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":"50","parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"c1fec742f8ff2a3753b58a9800ce5fab","leakproof":false,"signature":"_sales_invoice_read(uuid,uuid,integer)","volatility":"v","returns_set":false,"default_count":1,"argument_names":["_tenant","_invoice","_payment_limit"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"void","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"1de192b462e93708741b3933c15b0b8b","leakproof":false,"signature":"_sales_invoice_require_accepted_obligation(paige_invoices,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_invoice","_command"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"void","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"e176660d985e862db589fc11d9c2d4fa","leakproof":false,"signature":"_sales_invoice_require_manual_allocations(paige_invoices,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_invoice","_command"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"d68a90d2773bbb1700fb29c89966229e","leakproof":false,"signature":"allocate_verified_sales_invoice_payment(uuid,uuid,uuid,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_expected_tenant_id","_operation_id","_claim_token","_readback"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"6a542fbff334c53d43c4fe6d734d138c","leakproof":false,"signature":"claim_sales_invoice_payment_request(uuid,uuid,uuid)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_expected_tenant_id","_operation_id","_claim_token"]},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":"NULL::uuid","parallel":"u","settings":["search_path=public, pg_temp"],"body_hash":"e59ce09de1660f47341787a89b7269ec","leakproof":false,"signature":"client_portal_invoice_payment_request(uuid,uuid)","volatility":"v","returns_set":false,"default_count":1,"argument_names":["p_invoice_id","p_tenant_id"]},{"acl":"{postgres=X/postgres,authenticated=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":"20, NULL::jsonb","parallel":"u","settings":["search_path=\"\""],"body_hash":"49a0aa9466e6e7a377bfce8c2c1dbca1","leakproof":false,"signature":"client_portal_invoices_calendar_scoped(uuid,uuid,integer,jsonb)","volatility":"v","returns_set":false,"default_count":2,"argument_names":["p_tenant_id","p_expected_client_id","p_limit","p_after"]},{"acl":"{postgres=X/postgres,authenticated=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":"''invoice''::text, 50, NULL::jsonb","parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"237a5e1937e63af991a8dcb99d594f35","leakproof":false,"signature":"list_sales_collection_register(uuid,text,integer,jsonb)","volatility":"v","returns_set":false,"default_count":3,"argument_names":["_expected_tenant_id","_entity","_limit","_cursor"]},{"acl":"{postgres=X/postgres,authenticated=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":"50, NULL::uuid","parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"84ba97fe6eeef437e18785239febecc8","leakproof":false,"signature":"list_sales_invoices(uuid,integer,uuid)","volatility":"v","returns_set":false,"default_count":2,"argument_names":["_expected_tenant_id","_limit","_before_id"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"8bae7da7b9efc5c5ed21615b57df51ff","leakproof":false,"signature":"prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor_user_id","_expected_tenant_id","_operation_id","_command","_governance"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"fa82176ce57fba9b1b9d82080ce07bc0","leakproof":false,"signature":"read_public_sales_invoice_payment_request(text)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_token_hash"]},{"acl":"{postgres=X/postgres,authenticated=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"93e839bcda9a3b8f311d88ec233c3522","leakproof":false,"signature":"read_sales_accepted_invoice_obligations(uuid,uuid,uuid)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_expected_tenant_id","_invoice_id","_agreement_id"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"94fd1e3deb3547b4bb72388b2a0549e9","leakproof":false,"signature":"read_sales_invoice_command_result(uuid,uuid,uuid,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor_user_id","_expected_tenant_id","_operation_id","_command"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"662fc0645d50fa24d3a0626d22598e51","leakproof":false,"signature":"read_sales_invoice_payment_obligation(uuid,uuid,uuid,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor_user_id","_expected_tenant_id","_invoice_id","_reference"]},{"acl":"{postgres=X/postgres,authenticated=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"ed189024d3239ef3899dcc888141cb62","leakproof":false,"signature":"read_sales_invoice(uuid,uuid)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_expected_tenant_id","_invoice_id"]}]'::jsonb) LOOP
  actual:=NULL;
  SELECT jsonb_build_object('signature',wanted->>'signature','body_hash',pg_catalog.md5(p.prosrc),
 'owner',pg_catalog.pg_get_userbyid(p.proowner),'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,
 'strict',p.proisstrict,'leakproof',p.proleakproof,'result',pg_catalog.pg_get_function_result(p.oid),'returns_set',p.proretset,
 'defaults',pg_catalog.pg_get_expr(p.proargdefaults,0),'default_count',p.pronargdefaults,
 'argument_names',p.proargnames,'settings',p.proconfig,'acl',p.proacl::text)
 INTO actual FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.'||(wanted->>'signature'));
  IF actual IS DISTINCT FROM wanted THEN
   RAISE EXCEPTION 'Original E04 financial before source/authority changed: %',wanted->>'signature' USING ERRCODE='23514';
  END IF;
 END LOOP;
 FOR wanted IN SELECT value FROM pg_catalog.jsonb_array_elements('["_client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)","_sales_invoice_accepted_obligations(paige_invoices,uuid,integer)","_sales_invoice_collectible_balance(paige_invoices)","_sales_invoice_financial_position_rows(uuid,uuid)","_sales_invoice_financial_position_rows(uuid,uuid,integer)","_sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)","_sales_invoice_financial_read_version()","_sales_invoice_provider_disposition_command(jsonb)","_sales_invoice_provider_disposition_history(paige_invoices,jsonb)","_sales_invoice_provider_disposition_receipt(paige_invoice_operations)","_sales_invoice_provider_disposition_review(uuid,uuid,jsonb)","_sales_invoice_read(uuid,uuid,integer,integer)","_sales_invoice_record_provider_disposition(uuid,uuid,uuid,jsonb,jsonb)","_sales_provider_observation_balance(jsonb,bigint,text)","_sales_provider_observation_entry(paige_invoice_provider_operations,paige_invoice_operations,bigint,boolean)","_sales_provider_observation_link_guard()","_sales_provider_observation_snapshot(jsonb,text,bigint)","_sales_provider_observation_time(jsonb)","_sales_provider_observation_work_payload(uuid,text)","_sales_provider_observation_work_scope(paige_durable_work)","claim_sales_provider_observation_work(integer)","complete_sales_provider_observation_work(uuid,uuid,text,integer,bigint,jsonb)","read_sales_invoice_provider_observation_context(uuid,uuid)","read_sales_provider_observation_work_context(uuid,uuid,text,integer)","record_sales_invoice_provider_observation(uuid,uuid,uuid,bigint,jsonb,text)","register_sales_provider_observation_event(text,text,text,text,text)","register_sales_provider_observation_work(uuid,uuid,text,text,text,text)"]'::jsonb) LOOP
  IF pg_catalog.to_regprocedure('public.'||(wanted#>>'{}')) IS NOT NULL THEN
   RAISE EXCEPTION 'E04 financial forward already present or partial; reconcile normal migration history' USING ERRCODE='23514';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.paige_invoice_provider_operations'::regclass
  AND attname IN('provider_observation_version','provider_observation_operation_id') AND NOT attisdropped)
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.paige_invoice_provider_operations'::regclass AND tgname='e04_provider_observation_link_guard')
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.paige_invoice_provider_operations'::regclass AND conname='e04_provider_observation_pointer_check') THEN
  RAISE EXCEPTION 'E04 original provider observation schema already present; reconcile before applying' USING ERRCODE='23514';END IF;
 -- An earlier unbound journal must not be silently assigned observation0.
 IF EXISTS(SELECT 1 FROM public.paige_invoice_operations
  WHERE command->>'action' IN('invoice.provider_observation','invoice.record_provider_disposition')) THEN
  RAISE EXCEPTION 'Existing original financial observation history requires reconciliation before this forward' USING ERRCODE='23514';END IF;
END $e04_before$;

-- BEGIN ORIGINAL SOURCE exp04_provider_observation.sql
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
-- END ORIGINAL SOURCE exp04_provider_observation.sql

-- BEGIN ORIGINAL SOURCE exp04_provider_observation_work.sql
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

-- Unmounted verified-ingress candidate. Event payloads supply only a bounded
-- signal/reference; the ORIGINAL settled operation/receipt and current merchant
-- resolve all scope. A not-yet-linked event stays retryable, never acknowledged
-- as a financial result. No caller-supplied tenant, amount, status or authority.
create function public.register_sales_provider_observation_event(_event_id text,_event_type text,
 _merchant_account_id text,_environment text,_provider_transaction_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare op public.paige_invoice_provider_operations%rowtype;matches bigint;work jsonb;
begin
 perform public._sales_payment_operation_service();
 if coalesce(_event_id,'')!~'^evt_[A-Za-z0-9]{1,124}$'
  or coalesce(_event_type,'') not in ('charge.refunded','charge.refund.updated','refund.created','refund.updated','refund.failed',
   'charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated')
  or coalesce(_merchant_account_id,'')!~'^acct_[A-Za-z0-9]{1,123}$'
  or coalesce(_environment,'') not in ('test','live')
  or coalesce(_provider_transaction_id,'')!~'^ch_[A-Za-z0-9]{1,125}$' then
  raise exception 'Original provider event unavailable' using errcode='22023';
 end if;
 select count(*) into matches from public.paige_invoice_provider_operations p
  where p.provider='stripe' and p.merchant_account_id=_merchant_account_id and p.environment=_environment
   and p.state='settled' and p.verified_readback->>'provider_transaction_id'=_provider_transaction_id;
 if matches=0 then
  if not exists(select 1 from public.tenant_stripe_accounts m
   where m.stripe_account_id=_merchant_account_id and m.provider_environment=_environment) then
   return jsonb_build_object('state','other_domain');
  end if;
  return jsonb_build_object('state','verification_pending');
 end if;
 if matches<>1 then raise exception 'Original provider event scope ambiguous' using errcode='42501';end if;
 select * into strict op from public.paige_invoice_provider_operations p
  where p.provider='stripe' and p.merchant_account_id=_merchant_account_id and p.environment=_environment
   and p.state='settled' and p.verified_readback->>'provider_transaction_id'=_provider_transaction_id;
 -- A known original payment with a retired merchant remains a scope refusal
 -- from the ORIGINAL context, never silently acknowledged as another domain.
 work:=public.register_sales_provider_observation_work(op.tenant_id,op.id,_event_id,_merchant_account_id,_environment,_provider_transaction_id);
 return jsonb_build_object('state','registered','work',work);
end $$;
revoke all on function public.register_sales_provider_observation_event(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.register_sales_provider_observation_event(text,text,text,text,text) to service_role;

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
-- END ORIGINAL SOURCE exp04_provider_observation_work.sql

-- BEGIN ORIGINAL SOURCE exp04_invoice_financial_position.sql
-- EXP04 O5 test-only financial-position candidate; NOT a versioned migration.
-- Factor the ORIGINAL single Sales balance calculation, retaining its seven-column
-- compatibility projection. Receivable fields never count TEST verification as
-- customer cash. Manual-recorded and provider-verified evidence remain separate.
-- No provider call, financial write, credit authority or production mount.
CREATE OR REPLACE FUNCTION public._sales_invoice_financial_position_rows(_tenant uuid,_invoice uuid DEFAULT NULL)
RETURNS TABLE(invoice_id uuid,amount_minor bigint,allocated_minor numeric,
 remaining_minor numeric,manual_minor numeric,provider_minor numeric,test_provider_minor numeric,
 receivable_allocated_minor numeric,receivable_remaining_minor numeric,live_provider_minor numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT b.*,b.allocated_minor-b.test_provider_minor,b.remaining_minor+b.test_provider_minor,b.provider_minor-b.test_provider_minor
 FROM (
  SELECT i.id AS invoice_id,i.amount_total_cents::bigint AS amount_minor,coalesce(p.allocated,0) AS allocated_minor,
   i.amount_total_cents-coalesce(p.allocated,0) AS remaining_minor,coalesce(p.manual,0) AS manual_minor,
   coalesce(p.verified,0) AS provider_minor,coalesce(p.test_verified,0) AS test_provider_minor
  FROM public.paige_invoices i
  LEFT JOIN LATERAL (
   SELECT sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) allocated,
    sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) FILTER(WHERE evidence_kind='manual_recorded') manual,
    sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) FILTER(WHERE evidence_kind='provider_verified') verified,
    sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END) FILTER(WHERE evidence_kind='provider_verified' AND provider_environment='test') test_verified
   FROM public.paige_invoice_payments WHERE tenant_id=_tenant AND invoice_id=i.id
  ) p ON true WHERE i.tenant_id=_tenant AND (_invoice IS NULL OR i.id=_invoice)
 ) b;
$$;
REVOKE ALL ON FUNCTION public._sales_invoice_financial_position_rows(uuid,uuid) FROM PUBLIC;
DO $private_acl$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public._sales_invoice_financial_position_rows(uuid,uuid)'::regprocedure
   AND (a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
  RAISE EXCEPTION 'Private financial position permission drift' USING ERRCODE='23514';
 END IF;
END $private_acl$;

-- Compatibility is a projection of the SAME calculation, not a second balance
-- engine. Existing provider_minor includes TEST; existing Finance readers that
-- subtract test_provider_minor retain their exact contract until adoption.
CREATE OR REPLACE FUNCTION public._sales_invoice_balance_rows(_tenant uuid,_invoice uuid DEFAULT NULL)
RETURNS TABLE(invoice_id uuid,amount_minor bigint,allocated_minor numeric,
 remaining_minor numeric,manual_minor numeric,provider_minor numeric,test_provider_minor numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT b.invoice_id,b.amount_minor,b.allocated_minor,b.remaining_minor,b.manual_minor,b.provider_minor,b.test_provider_minor
 FROM public._sales_invoice_financial_position_rows(_tenant,_invoice) b;
$$;
REVOKE ALL ON FUNCTION public._sales_invoice_balance_rows(uuid,uuid) FROM PUBLIC;
-- END ORIGINAL SOURCE exp04_invoice_financial_position.sql

-- BEGIN ORIGINAL SOURCE exp04_invoice_provider_cash_position.sql
-- UNMOUNTED O5 candidate. Extend the ONE canonical financial position with
-- retained provider facts; original two-argument/legacy balance contracts stay exact.
-- No ledger, credit, refund, charge, collection decision, job or event is written.
CREATE FUNCTION public._sales_invoice_financial_position_rows(
 _tenant uuid,_invoice uuid,_evidence_version integer
) RETURNS TABLE(invoice_id uuid,financial_position jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE base record; payment public.paige_invoice_payments%rowtype;
 op public.paige_invoice_provider_operations%rowtype; entry public.paige_invoice_operations%rowtype;
 snapshot jsonb; item jsonb; movement jsonb; sources jsonb;
 refunded numeric; refund_pending numeric; refund_delta numeric; dispute_debit numeric; dispute_credit numeric;
 test_adjustments integer; pending boolean; review boolean; observed_net numeric;
 payment_refunded numeric; payment_refund_pending numeric; payment_refund_delta numeric;
 payment_dispute_debit numeric; payment_dispute_credit numeric; payment_test_adjustments integer;
 payment_pending boolean; payment_review boolean; payment_net numeric; positions jsonb;
BEGIN
 IF _tenant IS NULL OR _evidence_version IS DISTINCT FROM 3 THEN
  RAISE EXCEPTION 'Financial evidence version unavailable' USING ERRCODE='22023';
 END IF;
 FOR base IN SELECT b.* FROM public._sales_invoice_financial_position_rows(_tenant,_invoice) b LOOP
  refunded:=0;refund_pending:=0;refund_delta:=0;dispute_debit:=0;dispute_credit:=0;
  test_adjustments:=0;pending:=false;review:=false;sources:='[]'::jsonb;positions:='[]'::jsonb;
  FOR payment IN SELECT p.* FROM public.paige_invoice_payments p
   WHERE p.tenant_id=_tenant AND p.invoice_id=base.invoice_id AND p.evidence_kind='provider_verified'
   ORDER BY p.id LOOP
   payment_refunded:=0;payment_refund_pending:=0;payment_refund_delta:=0;
   payment_dispute_debit:=0;payment_dispute_credit:=0;payment_test_adjustments:=0;
   payment_pending:=false;payment_review:=false;
   SELECT p.* INTO op FROM public.paige_invoice_provider_operations p WHERE p.id=payment.provider_operation_id;
   IF NOT FOUND OR payment.kind IS DISTINCT FROM 'receipt' OR op.state IS DISTINCT FROM 'settled'
    OR op.tenant_id IS DISTINCT FROM _tenant OR op.invoice_id IS DISTINCT FROM base.invoice_id
    OR op.actor_user_id IS DISTINCT FROM payment.actor_user_id
    OR op.allocation_payment_id IS DISTINCT FROM payment.id OR op.amount_minor IS DISTINCT FROM payment.amount_cents::bigint
    OR op.currency IS DISTINCT FROM payment.currency OR op.provider IS DISTINCT FROM payment.provider
    OR op.merchant_account_id IS DISTINCT FROM payment.merchant_account_id
    OR op.environment IS DISTINCT FROM payment.provider_environment OR op.environment NOT IN('live','test')
    OR op.verified_readback->>'provider_transaction_id' IS DISTINCT FROM payment.provider_transaction_id
    OR op.verified_readback->>'provider_settlement_id' IS DISTINCT FROM payment.provider_settlement_id
    OR op.provider_observation_version IS NULL OR op.provider_observation_version<0
    OR (op.provider_observation_version=0) IS DISTINCT FROM (op.provider_observation_operation_id IS NULL) THEN
    RAISE EXCEPTION 'Original financial source unavailable' USING ERRCODE='55000';
   END IF;
   -- A read of retained history does not require the old merchant to remain
   -- connected. This grants no authority for a NEW provider request.
   IF op.provider_observation_version>0 THEN
    SELECT e.* INTO entry FROM public.paige_invoice_operations e WHERE e.id=op.provider_observation_operation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Original financial source unavailable' USING ERRCODE='55000'; END IF;
    snapshot:=public._sales_provider_observation_entry(op,entry,op.provider_observation_version-1,true);
    sources:=sources||jsonb_build_array(jsonb_build_object('provider_operation_id',op.id,
     'observation_id',entry.id,'observation_version',op.provider_observation_version,'environment',op.environment));
    IF op.environment='test' THEN
     payment_test_adjustments:=jsonb_array_length(snapshot->'refunds')+jsonb_array_length(snapshot->'disputes');
    ELSE
     payment_review:=jsonb_array_length(snapshot->'refunds')>0 OR jsonb_array_length(snapshot->'disputes')>0;
     FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'refunds') LOOP
      IF item->>'status'='succeeded' THEN payment_refunded:=payment_refunded+(item->>'amount_minor')::numeric; END IF;
      IF item->>'status' IN('pending','requires_action') THEN
       payment_refund_pending:=payment_refund_pending+(item->>'amount_minor')::numeric;payment_pending:=true;
      END IF;
      FOR movement IN SELECT value FROM jsonb_array_elements(jsonb_build_array(item->'balance_transaction',item->'failure_balance_transaction')) WHERE value<>'null'::jsonb LOOP
       payment_refund_delta:=payment_refund_delta+(movement->>'amount_minor')::numeric;
       payment_pending:=payment_pending OR movement->>'status'<>'available';
      END LOOP;
     END LOOP;
     FOR item IN SELECT value FROM jsonb_array_elements(snapshot->'disputes') LOOP
      FOR movement IN SELECT value FROM jsonb_array_elements(item->'balance_transactions') LOOP
       IF (movement->>'amount_minor')::numeric<0 THEN payment_dispute_debit:=payment_dispute_debit-(movement->>'amount_minor')::numeric;
       ELSE payment_dispute_credit:=payment_dispute_credit+(movement->>'amount_minor')::numeric; END IF;
       payment_pending:=payment_pending OR movement->>'status'<>'available';
      END LOOP;
      -- A decision label is not money-movement evidence. An open or incompletely
      -- evidenced formal dispute stays unresolved, including won without return.
      payment_pending:=payment_pending OR item->>'status' IN('needs_response','under_review')
       OR (item->>'status'='lost' AND (jsonb_array_length(item->'balance_transactions')<>1
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(item->'balance_transactions') m WHERE (m->>'amount_minor')::numeric<0)))
       OR (item->>'status'='won' AND
        (jsonb_array_length(item->'balance_transactions')<>2 OR
         (SELECT coalesce(sum((m->>'amount_minor')::numeric),0) FROM jsonb_array_elements(item->'balance_transactions') m)<>0));
     END LOOP;
    END IF;
   END IF;
   IF op.environment='live' AND EXISTS(SELECT 1 FROM public.paige_durable_work w
    WHERE w.tenant_id=_tenant AND w.work_kind='sales_provider_observation'
     AND w.request_payload->>'operation_id'=op.id::text AND w.status<>'succeeded') THEN
    payment_pending:=true;payment_review:=true;
   END IF;
   payment_net:=payment.amount_cents::numeric+payment_refund_delta-payment_dispute_debit+payment_dispute_credit;
   IF payment_net<0 OR payment_net>payment.amount_cents THEN
    payment_net:=NULL;payment_pending:=true;payment_review:=true;
   END IF;
   positions:=positions||jsonb_build_array(jsonb_build_object('provider_operation_id',op.id,'receipt_id',payment.id,
    'environment',op.environment,'captured_minor',CASE WHEN op.environment='live' THEN payment.amount_cents ELSE 0 END,
    'test_captured_minor',CASE WHEN op.environment='test' THEN payment.amount_cents ELSE 0 END,
    'observed_minor',CASE WHEN op.environment='live' THEN payment_net ELSE 0 END,
    'retained_minor',CASE WHEN op.environment='test' THEN 0 WHEN payment_pending THEN NULL ELSE payment_net END,
    'returned_minor',CASE WHEN op.environment='test' THEN 0 WHEN payment_pending THEN NULL ELSE payment.amount_cents-payment_net END,
    'verification_pending',payment_pending,'commercial_review_required',payment_review,
    'observation_id',op.provider_observation_operation_id,'observation_version',op.provider_observation_version,
    'obligation',op.command->'obligation'));
   refunded:=refunded+payment_refunded;refund_pending:=refund_pending+payment_refund_pending;
   refund_delta:=refund_delta+payment_refund_delta;dispute_debit:=dispute_debit+payment_dispute_debit;
   dispute_credit:=dispute_credit+payment_dispute_credit;test_adjustments:=test_adjustments+payment_test_adjustments;
   pending:=pending OR payment_pending;review:=review OR payment_review;
  END LOOP;
  observed_net:=base.live_provider_minor+refund_delta-dispute_debit+dispute_credit;
  IF observed_net<0 OR observed_net>base.live_provider_minor THEN
   observed_net:=NULL;pending:=true;review:=true;
  END IF;
  invoice_id:=base.invoice_id;
  financial_position:=to_jsonb(base)||jsonb_build_object('financial_evidence_version',3,
   'provider_refunded_minor',refunded,'provider_refund_pending_minor',refund_pending,
   'provider_refund_cash_delta_minor',refund_delta,'provider_dispute_debited_minor',dispute_debit,
   'provider_dispute_reinstated_minor',dispute_credit,'provider_observed_net_minor',observed_net,
   'provider_settled_net_minor',CASE WHEN pending THEN NULL ELSE observed_net END,
   'provider_verification_pending',pending,'commercial_review_required',review,
   'test_adjustment_count',test_adjustments,'provider_observation_sources',sources,'provider_payment_positions',positions);
  RETURN NEXT;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_financial_position_rows(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
DO $private_acl$
BEGIN
 IF (SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public._sales_invoice_financial_position_rows(uuid,uuid,integer)'::regprocedure
   AND a.grantee=p.proowner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)<>1
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public._sales_invoice_financial_position_rows(uuid,uuid,integer)'::regprocedure
   AND (a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
  RAISE EXCEPTION 'Private financial evidence permission drift' USING ERRCODE='23514';
 END IF;
END $private_acl$;
-- END ORIGINAL SOURCE exp04_invoice_provider_cash_position.sql

-- BEGIN ORIGINAL SOURCE exp04_invoice_actual_obligations.sql
-- EXP04 O5 test-only actual accepted obligations/manual writer repair. NOT a forward migration.
-- Reuse the original functions, commands, signed evidence, locks, receipt history,
-- approval, actor and Rail. Caller owns the rollback transaction.
DO $actual_guard$
DECLARE r record; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 FOR r IN SELECT * FROM (VALUES
('public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)','73c5a267f0e82184af5175f2a2ea5337','4f52d722c9b965de563aa307e94e0f31',false,'search_path=""',ARRAY['_invoice','_signing_id']),
('public._sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)','c60acebbbb08b7bd7d1a9b23a47f595d','72ff0f531dced2bcec5d675f7d09a97c',true,'search_path=pg_catalog, public',ARRAY['_actor_user_id','_expected_tenant_id','_operation_id','_command','_governance'])
 ) s(signature,before_hash,after_hash,definer,setting,args) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(r.signature);
  IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN (r.before_hash,r.after_hash)
   OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef IS DISTINCT FROM r.definer
   OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0
   OR p.prorettype<>'jsonb'::regtype OR p.proconfig IS DISTINCT FROM ARRAY[r.setting]
   OR p.proargnames IS DISTINCT FROM r.args OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
   RAISE EXCEPTION 'Original invoice financial source/authority changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
 END LOOP;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_financial_position_rows(uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>'79b52a906a3ee48a254461d176f17f23' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'s' OR p.proparallel<>'u' OR p.pronargdefaults<>1 OR p.prorettype<>'record'::regtype
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
  OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_invoice','invoice_id','amount_minor','allocated_minor','remaining_minor','manual_minor','provider_minor','test_provider_minor','receivable_allocated_minor','receivable_remaining_minor','live_provider_minor'] THEN
  RAISE EXCEPTION 'Canonical actual invoice position unavailable; reconcile before applying' USING ERRCODE='23514';
 END IF;
END $actual_guard$;

CREATE OR REPLACE FUNCTION public._sales_invoice_accepted_obligations(_invoice paige_invoices, _signing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE signing public.paige_agreements%ROWTYPE; terms public.tenant_client_agreements%ROWTYPE;
 payload jsonb; effective jsonb; base jsonb; obligations jsonb:='[]'::jsonb;
 obligation jsonb; v_reference jsonb; balance record; sequence bigint; scheduled bigint;
 allocated numeric; allocated_total numeric:=0; scheduled_total bigint:=0; manual_allocations jsonb; manual_allocated numeric;
BEGIN
 IF _invoice.id IS NULL OR _invoice.tenant_id IS NULL OR _invoice.contact_id IS NULL OR _signing_id IS NULL THEN
  RAISE EXCEPTION 'Accepted invoice source unavailable' USING ERRCODE='22023';
 END IF;
 base:=pg_catalog.jsonb_build_object('schema_version',1,'tenant_id',_invoice.tenant_id,
  'client_id',_invoice.contact_id,'invoice_id',_invoice.id,
  'invoice_version',_invoice.billing_lifecycle_version,'invoice_draft_version',_invoice.billing_draft_version,
  'issued_snapshot_version',_invoice.billing_issued_snapshot_version,'obligations','[]'::jsonb);
 IF _invoice.status IS DISTINCT FROM 'issued' OR _invoice.billing_issued_snapshot_version IS NULL
  OR _invoice.billing_issued_at IS NULL OR _invoice.billing_document IS NULL THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','invoice_not_issued');
 END IF;
 SELECT * INTO signing FROM public.paige_agreements WHERE id=_signing_id
  AND tenant_id=_invoice.tenant_id AND contact_id=_invoice.contact_id FOR SHARE;
 IF NOT FOUND THEN RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_unavailable'); END IF;
 SELECT * INTO terms FROM public.tenant_client_agreements WHERE id=signing.commercial_terms_id
  AND tenant_id=_invoice.tenant_id AND contact_id=_invoice.contact_id FOR SHARE;
 IF NOT FOUND THEN RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_unavailable'); END IF;
 IF terms.status IS DISTINCT FROM 'active' THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','commercial_terms_inactive');
 END IF;
 -- These original helpers alone own consent, exact accepted payload/economics,
 -- effectuation-operation and Rail provenance. Do not copy their evidence joins.
 payload:=public._paige_accepted_commercial_payload(signing);
 effective:=public._sales_collection_accepted_total_evidence(terms);
 IF payload IS NULL OR effective IS NULL
  OR payload->'schema_version' IS DISTINCT FROM '2'::jsonb
  OR terms.effective_signing_id IS DISTINCT FROM signing.id
  OR _invoice.billing_draft#>>'{agreement_snapshot,id}' IS DISTINCT FROM signing.id::text
  OR _invoice.billing_draft#>>'{commercial_terms_reference,id}' IS DISTINCT FROM terms.id::text
  OR payload#>>'{source,invoice_id}' IS DISTINCT FROM _invoice.id::text
  OR payload#>'{source,invoice_draft_version}' IS DISTINCT FROM pg_catalog.to_jsonb(_invoice.billing_draft_version)
  OR payload#>>'{source,client_id}' IS DISTINCT FROM _invoice.contact_id::text
  OR payload#>>'{source,tenant_id}' IS DISTINCT FROM _invoice.tenant_id::text
  OR payload#>>'{source,agreement_id}' IS DISTINCT FROM signing.id::text
  OR payload#>>'{source,terms_id}' IS DISTINCT FROM terms.id::text
  OR payload#>'{source,terms_version}' IS DISTINCT FROM pg_catalog.to_jsonb(terms.effective_terms_version)
  OR signing.commercial_presentation->>'payload_digest' IS DISTINCT FROM terms.effective_source_digest
  OR payload->>'currency' IS DISTINCT FROM pg_catalog.lower(_invoice.currency)
  OR payload->'principal_minor' IS DISTINCT FROM pg_catalog.to_jsonb(_invoice.amount_total_cents)
  OR pg_catalog.jsonb_typeof(payload->'obligations') IS DISTINCT FROM 'array'
  OR pg_catalog.jsonb_array_length(payload->'obligations') NOT BETWEEN 1 AND 240 THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_changed');
 END IF;
 SELECT * INTO STRICT balance FROM public._sales_invoice_financial_position_rows(_invoice.tenant_id,_invoice.id);
 -- Original allocation evidence below is LIVE or explicitly business-recorded.
 -- TEST never enters actual receivable, cannot fulfill an obligation and need not
 -- hide the customer's still-outstanding accepted payment plan.
 manual_allocations:=public._sales_invoice_manual_allocations(_invoice);
 IF manual_allocations IS NULL THEN RETURN base||pg_catalog.jsonb_build_object('state','held','reason','allocation_required'); END IF;
 FOR obligation,sequence IN SELECT value,ordinality FROM pg_catalog.jsonb_array_elements(payload->'obligations') WITH ORDINALITY LOOP
  IF obligation->'sequence' IS DISTINCT FROM pg_catalog.to_jsonb(sequence)
   OR pg_catalog.jsonb_typeof(obligation->'amount_cents') IS DISTINCT FROM 'number'
   OR coalesce(obligation->>'amount_cents','') !~ '^(0|[1-9][0-9]{0,9})$'
   OR (obligation->>'amount_cents')::bigint>2147483647
   OR obligation->>'currency' IS DISTINCT FROM payload->>'currency'
   OR coalesce(obligation->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_changed');
  END IF;
  scheduled:=(obligation->>'amount_cents')::bigint;
  scheduled_total:=scheduled_total+scheduled;
  v_reference:=pg_catalog.jsonb_build_object('commercial_terms_id',terms.id,'signing_id',signing.id,
   'signing_version',signing.version,'terms_version',terms.effective_terms_version,'sequence',sequence);
  -- Only an original receipt linked to the exact immutable settled provider
  -- operation can allocate this target here. No FIFO, pending checkout or guessed
  -- manual receipt assignment. Explicit business-recorded allocations below use
  -- the SAME original immutable operation/receipt; absence stays unassigned.
  SELECT coalesce(pg_catalog.sum(payment.amount_cents),0) INTO allocated
   FROM public.paige_invoice_payments payment
   JOIN public.paige_invoice_provider_operations operation ON operation.id=payment.provider_operation_id
    AND operation.tenant_id=payment.tenant_id AND operation.invoice_id=payment.invoice_id
   WHERE payment.tenant_id=_invoice.tenant_id AND payment.invoice_id=_invoice.id
    AND payment.kind='receipt' AND payment.evidence_kind='provider_verified'
    AND payment.provider_environment='live' AND operation.environment='live'
    AND operation.state='settled' AND operation.allocation_payment_id=payment.id
    AND operation.client_id=_invoice.contact_id AND operation.amount_minor=payment.amount_cents
    AND payment.currency=operation.currency AND payment.provider=operation.provider
    AND operation.currency=payload->>'currency' AND operation.verified_readback IS NOT NULL
    AND operation.command->>'action'='invoice.payment_request'
    AND operation.command#>'{obligation,reference}'=v_reference
    AND operation.command#>>'{obligation,source_digest}'=terms.effective_source_digest
    AND operation.command#>>'{obligation,due_date}'=obligation->>'due_date'
    AND operation.command#>'{obligation,scheduled_minor}'=pg_catalog.to_jsonb(scheduled)
    AND operation.command#>'{obligation,remaining_minor}'=pg_catalog.to_jsonb(operation.amount_minor);
  SELECT coalesce(pg_catalog.sum((a.value->>'amount_cents')::bigint),0) INTO manual_allocated
   FROM pg_catalog.jsonb_array_elements(manual_allocations) a
   WHERE a.value#>'{obligation,reference}'=v_reference
    AND a.value#>>'{obligation,source_digest}'=terms.effective_source_digest
    AND a.value#>>'{obligation,due_date}'=obligation->>'due_date'
    AND a.value#>'{obligation,scheduled_minor}'=pg_catalog.to_jsonb(scheduled);
  allocated:=allocated+manual_allocated;
  IF allocated<0 OR allocated>scheduled THEN
   RETURN base||pg_catalog.jsonb_build_object('state','held','reason','allocation_conflict');
  END IF;
  allocated_total:=allocated_total+allocated;
  IF scheduled>0 THEN
   obligations:=obligations||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'reference',v_reference,'source_digest',terms.effective_source_digest,'due_date',obligation->>'due_date',
    'scheduled_minor',scheduled,'remaining_minor',scheduled-allocated));
  END IF;
 END LOOP;
 IF scheduled_total IS DISTINCT FROM _invoice.amount_total_cents::bigint THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_changed');
 END IF;
 IF allocated_total IS DISTINCT FROM balance.receivable_allocated_minor THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','allocation_required');
 END IF;
 RETURN base||pg_catalog.jsonb_build_object('state','available','obligations',obligations);
END $function$;

CREATE OR REPLACE FUNCTION public._sales_invoice_prior_execute(_actor_user_id uuid, _expected_tenant_id uuid, _operation_id uuid, _command jsonb, _governance jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.paige_invoices%ROWTYPE; receipt public.paige_invoice_payments%ROWTYPE; result jsonb; prior jsonb;
  action text:=_command->>'action'; tool text; amount bigint; received bigint; document jsonb; client jsonb; tenant jsonb;
  grant_id uuid; expiry timestamptz; hash text; scope text; allowed text[]; expected bigint;
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  IF _operation_id IS NULL OR jsonb_typeof(_command) IS DISTINCT FROM 'object' OR octet_length(_command::text)>(CASE WHEN action='invoice.record_manual_payment' AND _command ? 'allocations' THEN 131072 ELSE 8000 END) THEN
    RAISE EXCEPTION 'Invalid invoice command' USING ERRCODE='22023'; END IF;
  tool:=CASE action WHEN 'invoice.publish' THEN 'sales_publish_invoice' WHEN 'invoice.record_manual_payment' THEN 'sales_record_manual_payment'
    WHEN 'invoice.reverse_manual_payment' THEN 'sales_reverse_manual_payment' WHEN 'invoice.void' THEN 'sales_void_invoice'
    WHEN 'invoice.link_create' THEN 'sales_create_invoice_link' END;
  IF tool IS NULL THEN RAISE EXCEPTION 'Unknown invoice action' USING ERRCODE='22023'; END IF;
  PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,action,tool,_governance);
  allowed:=ARRAY['action','invoice_id','expected_version','template'];
  IF action='invoice.record_manual_payment' THEN allowed:=allowed||ARRAY['amount_cents','currency','method','received_at','reference','notes','allocations'];
  ELSIF action='invoice.reverse_manual_payment' THEN allowed:=allowed||ARRAY['payment_id','reason'];
  ELSIF action='invoice.void' THEN allowed:=allowed||ARRAY['reason'];
  ELSIF action='invoice.link_create' THEN allowed:=allowed||ARRAY['expires_in_days','grant_scope','delivery_operation_id']; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE NOT(k=ANY(allowed)))
    OR coalesce(_command->>'expected_version','') !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'Invalid invoice fields' USING ERRCODE='22023'; END IF;
  expected:=(_command->>'expected_version')::bigint;
  PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,81742));
  prior:=public.read_sales_invoice_command_result(_actor_user_id,_expected_tenant_id,_operation_id,_command);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF EXISTS(SELECT 1 FROM public.messages WHERE meta#>>'{sales_invoice_binding,operation_id}'=_operation_id::text) THEN
    RAISE EXCEPTION 'Operation already belongs to invoice delivery' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id AND billing_draft_version IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  IF coalesce(r.billing_lifecycle_version,r.billing_draft_version)<>expected THEN RAISE EXCEPTION 'Invoice version conflict' USING ERRCODE='40001'; END IF;
  IF action='invoice.publish' THEN
    IF r.status<>'draft' OR r.billing_issued_at IS NOT NULL OR r.amount_total_cents<1 OR lower(r.currency)<>'usd'
      OR (r.billing_draft->'schema_version' IS DISTINCT FROM '2'::jsonb AND r.billing_draft->'schema_version' IS DISTINCT FROM '3'::jsonb) OR nullif(r.billing_draft->>'due_date','') IS NULL THEN RAISE EXCEPTION 'Complete this draft before publication' USING ERRCODE='22023'; END IF;
    IF jsonb_array_length(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb))<1 OR r.billing_draft->>'processor_intent' IS NOT NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb)) m
      WHERE m NOT IN ('zelle','cash','wire','check','bank_transfer','other')) THEN
      RAISE EXCEPTION 'Online merchant issuance is unavailable; choose off-platform methods' USING ERRCODE='22023'; END IF;
    SELECT to_jsonb(c) INTO client FROM public.clients c WHERE id=r.contact_id AND tenant_id=_expected_tenant_id;
    SELECT to_jsonb(t) INTO tenant FROM public.tenants t WHERE id=_expected_tenant_id;
    document:=jsonb_build_object('renderer_version','paige-invoice-html-v1','invoice_number',r.invoice_number,'published_at',now(),
      'issuer_name',coalesce(nullif(tenant->>'name',''),nullif(tenant->>'business_name',''),'Business'),
      'client_name',coalesce(nullif(client->>'entity_name',''),nullif(trim(coalesce(client->>'first_name','')||' '||coalesce(client->>'last_name','')),''),'Client'),
      'snapshot',r.billing_draft,'total_cents',r.amount_total_cents,'currency','usd');
    UPDATE public.paige_invoices SET status='issued',billing_lifecycle_version=expected+1,billing_issued_snapshot_version=billing_draft_version,
      billing_issued_at=now(),billing_issued_by=_actor_user_id,billing_document=document,
      billing_document_digest=encode(extensions.digest(convert_to(document::text,'UTF8'),'sha256'),'hex') WHERE id=r.id;
  ELSE
    IF r.status<>'issued' THEN RAISE EXCEPTION 'Invoice is not active' USING ERRCODE='22023'; END IF;
    SELECT b.receivable_allocated_minor INTO STRICT received
      FROM public._sales_invoice_financial_position_rows(_expected_tenant_id,r.id) b;
    IF action='invoice.record_manual_payment' THEN
      IF coalesce(_command->>'amount_cents','') !~ '^[1-9][0-9]{0,9}$' OR _command->>'currency' IS DISTINCT FROM 'usd'
        OR coalesce(_command->>'method','') NOT IN ('zelle','cash','wire','check','bank_transfer','other')
        OR nullif(_command->>'received_at','') IS NULL OR length(_command->>'reference')>200 OR length(_command->>'notes')>2000 THEN
        RAISE EXCEPTION 'Check payment amount, method, currency and date' USING ERRCODE='22023'; END IF;
      amount:=(_command->>'amount_cents')::bigint;
      IF amount>2147483647 OR received<0 OR received+amount>r.amount_total_cents THEN RAISE EXCEPTION 'Payment exceeds outstanding balance' USING ERRCODE='22023'; END IF;
      IF (_command->>'received_at')::timestamptz>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Received date cannot be in the future' USING ERRCODE='22023'; END IF;
      PERFORM public._sales_invoice_require_manual_allocations(r,_command);
      INSERT INTO public.paige_invoice_payments(id,tenant_id,invoice_id,actor_user_id,kind,amount_cents,currency,method,received_at,reference,notes)
        VALUES(_operation_id,_expected_tenant_id,r.id,_actor_user_id,'receipt',amount,'usd',_command->>'method',(_command->>'received_at')::timestamptz,_command->>'reference',_command->>'notes');
    ELSIF action='invoice.reverse_manual_payment' THEN
      IF coalesce(length(trim(_command->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Explain the correction' USING ERRCODE='22023'; END IF;
      SELECT * INTO receipt FROM public.paige_invoice_payments WHERE id=(_command->>'payment_id')::uuid AND tenant_id=_expected_tenant_id AND invoice_id=r.id AND kind='receipt';
      IF NOT FOUND OR EXISTS(SELECT 1 FROM public.paige_invoice_payments WHERE reverses_payment_id=receipt.id) THEN
        RAISE EXCEPTION 'Receipt unavailable or already reversed' USING ERRCODE='22023'; END IF;
      IF receipt.evidence_kind IS DISTINCT FROM 'manual_recorded' OR receipt.provider_operation_id IS NOT NULL OR receipt.provider_environment IS NOT NULL THEN
        RAISE EXCEPTION 'Provider payments require their original provider reconciliation; manual correction cannot reverse them' USING ERRCODE='22023'; END IF;
      INSERT INTO public.paige_invoice_payments(id,tenant_id,invoice_id,actor_user_id,kind,amount_cents,currency,method,received_at,reverses_payment_id,reason)
        VALUES(_operation_id,_expected_tenant_id,r.id,_actor_user_id,'reversal',receipt.amount_cents,receipt.currency,receipt.method,receipt.received_at,receipt.id,_command->>'reason');
    ELSIF action='invoice.void' THEN
      IF coalesce(length(trim(_command->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Explain why this invoice is void' USING ERRCODE='22023'; END IF;
      UPDATE public.paige_invoices SET status='void' WHERE id=r.id;
      UPDATE public.paige_invoice_access_grants SET revoked_at=now() WHERE invoice_id=r.id AND revoked_at IS NULL;
    ELSIF action='invoice.link_create' THEN
      IF coalesce(_command->>'expires_in_days','') !~ '^[1-9][0-9]?$' OR (_command->>'expires_in_days')::integer>30 THEN
        RAISE EXCEPTION 'Link expiry must be between one and 30 days' USING ERRCODE='22023'; END IF;
      scope:=coalesce(_command->>'grant_scope','share');
      IF scope<>'share' OR _command ? 'delivery_operation_id' THEN RAISE EXCEPTION 'Delivery grants use the governed sender' USING ERRCODE='22023'; END IF;
      hash:=_governance#>>'{generated_link,token_hash}';grant_id:=(_governance#>>'{generated_link,grant_id}')::uuid;
      IF coalesce(hash,'') !~ '^[0-9a-f]{64}$' OR grant_id IS NULL THEN RAISE EXCEPTION 'Trusted link material required' USING ERRCODE='42501'; END IF;
      expiry:=now()+make_interval(days=(_command->>'expires_in_days')::integer);
      UPDATE public.paige_invoice_access_grants SET revoked_at=now() WHERE tenant_id=_expected_tenant_id AND invoice_id=r.id AND scope='share' AND revoked_at IS NULL;
      INSERT INTO public.paige_invoice_access_grants(id,tenant_id,invoice_id,issued_snapshot_version,scope,token_hash,expires_at,actor_user_id)
        VALUES(grant_id,_expected_tenant_id,r.id,r.billing_issued_snapshot_version,'share',hash,expiry,_actor_user_id);
    END IF;
    UPDATE public.paige_invoices SET billing_lifecycle_version=expected+1 WHERE id=r.id;
  END IF;
  PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,tool,'capability_succeeded',_operation_id,NULL);
  result:=jsonb_build_object('ok',true,'row',public._sales_invoice_read(_expected_tenant_id,r.id),'operation',jsonb_build_object('id',_operation_id,'action',action));
  IF action='invoice.link_create' THEN result:=result||jsonb_build_object('link',jsonb_build_object('grant_id',grant_id,'expires_at',expiry,'token_returned',false,'link_recovery_required',true)); END IF;
  INSERT INTO public.paige_invoice_operations(id,tenant_id,invoice_id,actor_user_id,command,result) VALUES(_operation_id,_expected_tenant_id,r.id,_actor_user_id,_command,result);
  RETURN result;
END $function$;
-- END ORIGINAL SOURCE exp04_invoice_actual_obligations.sql

-- BEGIN ORIGINAL SOURCE exp04_invoice_provider_disposition.sql
-- INERT O5 source candidate. Caller owns the disposable transaction.
-- Extend original invoice position/command/journal/Rail. No new financial store,
-- provider request, approval authority, schedule, signed amendment or public grant.
DO $original_position_source$
DECLARE r record;p pg_proc%ROWTYPE;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('public._sales_invoice_financial_position_rows(uuid,uuid)','79b52a906a3ee48a254461d176f17f23',1,ARRAY['_tenant','_invoice','invoice_id','amount_minor','allocated_minor','remaining_minor','manual_minor','provider_minor','test_provider_minor','receivable_allocated_minor','receivable_remaining_minor','live_provider_minor']),
 ('public._sales_invoice_financial_position_rows(uuid,uuid,integer)','a7ed0b1ba940c0e5b70b8cf0742356bb',0,ARRAY['_tenant','_invoice','_evidence_version','invoice_id','financial_position'])
 ) x(signature,body_md5,defaults,args) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
  IF NOT FOUND OR md5(p.prosrc)<>r.body_md5 OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict
   OR p.proleakproof OR p.provolatile<>'s' OR p.proparallel<>'u' OR p.pronargdefaults<>r.defaults
   OR p.prorettype<>'record'::regtype OR p.proargnames IS DISTINCT FROM r.args
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
   RAISE EXCEPTION 'Original invoice position source changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $original_position_source$;

DO $accepted_position_source$
DECLARE p pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)');
 IF NOT FOUND OR md5(p.prosrc)<>'4f52d722c9b965de563aa307e94e0f31' OR pg_get_userbyid(p.proowner)<>'postgres'
  OR p.prosecdef OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0
  OR p.prorettype<>'jsonb'::regtype OR p.proargnames IS DISTINCT FROM ARRAY['_invoice','_signing_id']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
  RAISE EXCEPTION 'Original accepted invoice source changed; reconcile before applying' USING ERRCODE='23514';END IF;
END $accepted_position_source$;

DO $private_source_guard$
DECLARE r record;p pg_proc%ROWTYPE;
BEGIN
 FOR r IN SELECT * FROM (VALUES
('public._sales_invoice_provider_disposition_command(jsonb)','0ea6025702c9694ce9280593e1b606d0','void',ARRAY['_command']),
('public._sales_invoice_provider_disposition_history(public.paige_invoices,jsonb)','702541a74b3d130273b0bbf31cc8b158','jsonb',ARRAY['_invoice','_payment']),
('public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)','fd0ec0aabf95d46b8f052af027cbf6ce','record',ARRAY['_tenant','_invoice','_evidence_version','_proposal','invoice_id','financial_position']),
('public._sales_invoice_provider_disposition_review(uuid,uuid,jsonb)','656219ca9ff0d7159c4f367de38f7fa1','jsonb',ARRAY['_actor','_tenant','_command']),
('public._sales_invoice_provider_disposition_receipt(public.paige_invoice_operations)','0569823560c5827a32010ef9572c20ba','void',ARRAY['_entry']),
('public._sales_invoice_record_provider_disposition(uuid,uuid,uuid,jsonb,jsonb)','fbfa85be667382e21f24019f589a12af','jsonb',ARRAY['_actor','_tenant','_operation','_command','_governance'])
 ) x(signature,body_md5,result_type,args) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
  IF FOUND AND (md5(p.prosrc)<>r.body_md5 OR pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef OR p.proisstrict
   OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0
   OR p.prorettype<>r.result_type::regtype OR p.proargnames IS DISTINCT FROM r.args
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}') THEN
   RAISE EXCEPTION 'Private invoice financial source changed; reconcile before applying' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $private_source_guard$;

CREATE OR REPLACE FUNCTION public._sales_invoice_provider_disposition_command(_command jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE credit boolean; key text;
BEGIN
 credit:=_command->>'decision'='credit_returned_principal';
 IF jsonb_typeof(_command) IS DISTINCT FROM 'object'
  OR _command->>'action' IS DISTINCT FROM 'invoice.record_provider_disposition'
  OR coalesce(_command->>'decision','') NOT IN('balance_due','credit_returned_principal')
  OR (SELECT count(*) FROM jsonb_object_keys(_command))<>(CASE WHEN credit THEN 10 ELSE 9 END)
  OR _command-ARRAY['action','invoice_id','expected_version','provider_operation_id','observation_id',
    'observation_version','expected_disposition_version','decision','reason',CASE WHEN credit THEN 'credit_minor' ELSE 'decision' END]<>'{}'::jsonb
  OR jsonb_typeof(_command->'reason') IS DISTINCT FROM 'string'
  OR length(btrim(_command->>'reason'))<1 OR length(_command->>'reason')>500 THEN
  RAISE EXCEPTION 'Invalid invoice financial decision' USING ERRCODE='22023';
 END IF;
 FOREACH key IN ARRAY ARRAY['invoice_id','provider_operation_id','observation_id'] LOOP
  IF jsonb_typeof(_command->key) IS DISTINCT FROM 'string'
   OR coalesce(_command->>key,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'Invalid invoice financial decision' USING ERRCODE='22023';END IF;
 END LOOP;
 FOREACH key IN ARRAY ARRAY['expected_version','observation_version','expected_disposition_version'] LOOP
  IF jsonb_typeof(_command->key) IS DISTINCT FROM 'number' OR coalesce(_command->>key,'') !~ '^(0|[1-9][0-9]{0,15})$'
   OR (_command->>key)::bigint>9007199254740990
   OR (key<>'expected_disposition_version' AND (_command->>key)::bigint<1) THEN
   RAISE EXCEPTION 'Invalid invoice financial decision' USING ERRCODE='22023';END IF;
 END LOOP;
 IF credit AND (jsonb_typeof(_command->'credit_minor') IS DISTINCT FROM 'number'
  OR coalesce(_command->>'credit_minor','') !~ '^[1-9][0-9]{0,9}$'
  OR (_command->>'credit_minor')::bigint>2147483647) THEN
  RAISE EXCEPTION 'Invalid invoice financial decision' USING ERRCODE='22023';END IF;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_provider_disposition_command(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Original immutable operation history is the only credit/disposition record.
-- A later provider event never silently discards the retained owner decision.
CREATE OR REPLACE FUNCTION public._sales_invoice_provider_disposition_history(_invoice public.paige_invoices,_payment jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE entry public.paige_invoice_operations%ROWTYPE; op public.paige_invoice_provider_operations%ROWTYPE;
 observation public.paige_invoice_operations%ROWTYPE; profile jsonb; result jsonb; command jsonb;
 version bigint:=0; credit bigint:=0; next_credit bigint; next_version bigint; invoice_version bigint;
 last_id uuid; last_observation uuid; last_observation_version bigint; unchanged boolean; key text;
BEGIN
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=(_payment->>'provider_operation_id')::uuid
  AND tenant_id=_invoice.tenant_id AND invoice_id=_invoice.id AND state='settled' AND environment='live';
 IF NOT FOUND OR op.client_id IS DISTINCT FROM _invoice.contact_id OR op.currency IS DISTINCT FROM lower(_invoice.currency)
  OR _payment->'captured_minor' IS DISTINCT FROM to_jsonb(op.amount_minor) THEN
  RAISE EXCEPTION 'Original financial payment unavailable' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM public.paige_invoice_operations e
  WHERE e.command->>'action'='invoice.record_provider_disposition' AND e.command->>'provider_operation_id'=op.id::text
   AND (jsonb_typeof(e.result->'disposition_version') IS DISTINCT FROM 'number'
    OR coalesce(e.result->>'disposition_version','') !~ '^[1-9][0-9]{0,15}$'
    OR (e.result->>'disposition_version')::bigint>9007199254740991)) THEN
  RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
 FOR entry IN SELECT e.* FROM public.paige_invoice_operations e
  WHERE e.command->>'action'='invoice.record_provider_disposition' AND e.command->>'provider_operation_id'=op.id::text
  ORDER BY (e.result->>'disposition_version')::bigint,e.result->>'outcome',e.id LOOP
  command:=entry.command;result:=entry.result;profile:=result->'provider_disposition_review';
  BEGIN PERFORM public._sales_invoice_provider_disposition_command(command);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END;
  unchanged:=result->>'outcome'='financial_decision_unchanged';
  next_version:=version+CASE WHEN unchanged THEN 0 ELSE 1 END;
  next_credit:=CASE WHEN command->>'decision'='balance_due' THEN 0 ELSE (command->>'credit_minor')::bigint END;
  invoice_version:=(command->>'expected_version')::bigint+CASE WHEN unchanged THEN 0 ELSE 1 END;
  IF entry.tenant_id IS DISTINCT FROM _invoice.tenant_id OR entry.invoice_id IS DISTINCT FROM _invoice.id OR entry.actor_user_id IS NULL
   OR command->'invoice_id' IS DISTINCT FROM to_jsonb(_invoice.id)
   OR command->'expected_disposition_version' IS DISTINCT FROM to_jsonb(version)
   OR jsonb_typeof(result) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(result))<>12
   OR result-ARRAY['ok','outcome','effect','payment_moved','customer_notified','rail_recorded','receipt_id','operation',
     'provider_disposition_review','disposition_version','invoice_version','row']<>'{}'::jsonb
   OR result->'ok' IS DISTINCT FROM 'true'::jsonb OR result->'payment_moved' IS DISTINCT FROM 'false'::jsonb
   OR result->'customer_notified' IS DISTINCT FROM 'false'::jsonb OR result->'rail_recorded' IS DISTINCT FROM 'true'::jsonb
   OR result->>'effect' IS DISTINCT FROM 'internal_financial_disposition_only'
   OR coalesce(result->>'outcome','') NOT IN('financial_decision_recorded','financial_decision_unchanged')
   OR result->'operation' IS DISTINCT FROM jsonb_build_object('id',entry.id,'action',command->>'action')
   OR result->'disposition_version' IS DISTINCT FROM to_jsonb(next_version)
   OR result->'invoice_version' IS DISTINCT FROM to_jsonb(invoice_version)
   OR jsonb_typeof(result->'row') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(result->'row'))<>3
   OR result#>'{row,id}' IS DISTINCT FROM to_jsonb(_invoice.id) OR result#>'{row,tenant_id}' IS DISTINCT FROM to_jsonb(_invoice.tenant_id)
   OR result#>'{row,version}' IS DISTINCT FROM to_jsonb(invoice_version)
   OR invoice_version>_invoice.billing_lifecycle_version OR next_credit>op.amount_minor
   OR (unchanged AND (version=0 OR credit<>next_credit))
   OR jsonb_typeof(profile) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(profile))<>25
   OR profile-ARRAY['review_version','financial_evidence_version','effect','invoice_id','invoice_version','client_id','client_name',
    'currency','provider_operation_id','observation_id','observation_version','disposition_version','decision','captured_minor',
    'retained_minor','returned_minor','credit_before_minor','credit_after_minor','standing_before','outstanding_before_minor',
    'outstanding_after_minor','refund_payable_before_minor','refund_payable_after_minor','standing_after','source_hash']<>'{}'::jsonb
   OR profile->'review_version' IS DISTINCT FROM '2'::jsonb OR profile->'financial_evidence_version' IS DISTINCT FROM '3'::jsonb
   OR profile->>'effect' IS DISTINCT FROM 'internal_financial_disposition_only'
   OR profile->'invoice_id' IS DISTINCT FROM to_jsonb(_invoice.id) OR profile->'invoice_version' IS DISTINCT FROM command->'expected_version'
   OR profile->'client_id' IS DISTINCT FROM to_jsonb(_invoice.contact_id) OR profile->>'currency' IS DISTINCT FROM op.currency
   OR jsonb_typeof(profile->'client_name') IS DISTINCT FROM 'string' OR length(btrim(profile->>'client_name'))<1 OR length(profile->>'client_name')>500
   OR profile->'provider_operation_id' IS DISTINCT FROM to_jsonb(op.id)
   OR profile->'observation_id' IS DISTINCT FROM command->'observation_id' OR profile->'observation_version' IS DISTINCT FROM command->'observation_version'
   OR profile->'disposition_version' IS DISTINCT FROM to_jsonb(version) OR profile->'decision' IS DISTINCT FROM command->'decision'
   OR profile->'captured_minor' IS DISTINCT FROM to_jsonb(op.amount_minor)
   OR profile->'credit_before_minor' IS DISTINCT FROM to_jsonb(credit) OR profile->'credit_after_minor' IS DISTINCT FROM to_jsonb(next_credit)
   OR coalesce(profile->>'source_hash','') !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
  FOREACH key IN ARRAY ARRAY['retained_minor','returned_minor'] LOOP
   IF jsonb_typeof(profile->key) IS DISTINCT FROM 'number' OR coalesce(profile->>key,'') !~ '^(0|[1-9][0-9]{0,9})$'
    OR (profile->>key)::bigint>op.amount_minor THEN
    RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
  END LOOP;
  IF (profile->>'retained_minor')::bigint+(profile->>'returned_minor')::bigint<>op.amount_minor THEN
   RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
  FOREACH key IN ARRAY ARRAY['before','after'] LOOP
   IF profile->>('standing_'||key)='needs_review' THEN
    IF profile->('outstanding_'||key||'_minor') IS DISTINCT FROM 'null'::jsonb
     OR profile->('refund_payable_'||key||'_minor') IS DISTINCT FROM 'null'::jsonb THEN
     RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
   ELSIF profile->>('standing_'||key)='recorded' THEN
    IF jsonb_typeof(profile->('outstanding_'||key||'_minor')) IS DISTINCT FROM 'number'
     OR coalesce(profile->>('outstanding_'||key||'_minor'),'') !~ '^(0|[1-9][0-9]{0,9})$'
     OR (profile->>('outstanding_'||key||'_minor'))::bigint>2147483647
     OR jsonb_typeof(profile->('refund_payable_'||key||'_minor')) IS DISTINCT FROM 'number'
     OR coalesce(profile->>('refund_payable_'||key||'_minor'),'') !~ '^(0|[1-9][0-9]{0,9})$'
     OR (profile->>('refund_payable_'||key||'_minor'))::bigint>2147483647 THEN
     RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
   ELSE RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
  END LOOP;
  IF unchanged AND (profile->'standing_before' IS DISTINCT FROM profile->'standing_after'
   OR profile->'outstanding_before_minor' IS DISTINCT FROM profile->'outstanding_after_minor'
   OR profile->'refund_payable_before_minor' IS DISTINCT FROM profile->'refund_payable_after_minor') THEN
   RAISE EXCEPTION 'Original financial decision history unavailable' USING ERRCODE='55000';END IF;
  SELECT e.* INTO observation FROM public.paige_invoice_operations e WHERE e.id=(entry.command->>'observation_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original financial decision source unavailable' USING ERRCODE='55000';END IF;
  PERFORM public._sales_provider_observation_entry(op,observation,(command->>'observation_version')::bigint-1,true);
  IF NOT EXISTS(SELECT 1 FROM public.paige_workspace_events e WHERE e.id::text=result->>'receipt_id'
   AND e.tenant_id=entry.tenant_id AND e.actor_id=entry.actor_user_id AND e.source_kind='capability_run'
   AND e.source_id=entry.id AND e.source_revision=0 AND e.outcome='capability_succeeded'
   AND e.capability_key='sales_record_provider_disposition' AND e.actor_agent_slug IS NULL) THEN
   RAISE EXCEPTION 'Original financial decision receipt unavailable' USING ERRCODE='55000';END IF;
  IF NOT unchanged THEN
   version:=next_version;credit:=next_credit;last_id:=entry.id;
   last_observation:=(command->>'observation_id')::uuid;last_observation_version:=(command->>'observation_version')::bigint;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('version',version,'credit_minor',credit,'decision_operation_id',last_id,
  'observation_id',last_observation,'observation_version',last_observation_version);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_provider_disposition_history(public.paige_invoices,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- One canonical native calculation, extended with original accepted targets.
-- The three-argument overload owns cash evidence; legacy seven/ten-field APIs
-- stay untouched. The optional proposal is read-only, never a recorded credit.
CREATE OR REPLACE FUNCTION public._sales_invoice_financial_position_rows(_tenant uuid,_invoice uuid,_evidence_version integer,_proposal jsonb)
RETURNS TABLE(invoice_id uuid,financial_position jsonb)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE invoice public.paige_invoices%ROWTYPE; source jsonb; payment_position jsonb; history jsonb;
 positions jsonb; histories jsonb; original_histories jsonb; accepted jsonb; targets jsonb; target jsonb;
 matched jsonb; gross numeric; retained numeric; credits numeric; manual numeric; scheduled numeric;
 outstanding numeric:=0;refund_payable numeric:=0;total_credit numeric:=0;total_gross numeric:=0;
 known boolean:=true; proposed boolean:=false; has_plan boolean; source_hash text; projected jsonb:='[]';
BEGIN
 IF _tenant IS NULL OR _invoice IS NULL OR _evidence_version IS DISTINCT FROM 3 THEN
  RAISE EXCEPTION 'Financial evidence version unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO invoice FROM public.paige_invoices i WHERE i.id=_invoice AND i.tenant_id=_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501';END IF;
 SELECT b.financial_position INTO STRICT source FROM public._sales_invoice_financial_position_rows(_tenant,_invoice,3) b;
 positions:=source->'provider_payment_positions';histories:='[]';original_histories:='[]';
 IF jsonb_typeof(positions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Original payment positions unavailable' USING ERRCODE='55000';END IF;
 IF _proposal IS NOT NULL THEN
  PERFORM public._sales_invoice_provider_disposition_command(_proposal);
  IF _proposal->'invoice_id' IS DISTINCT FROM to_jsonb(_invoice)
   OR _proposal->'expected_version' IS DISTINCT FROM to_jsonb(invoice.billing_lifecycle_version) THEN
   RAISE EXCEPTION 'Invoice financial source changed' USING ERRCODE='40001';END IF;
 END IF;
 FOR payment_position IN SELECT value FROM jsonb_array_elements(positions) WHERE value->>'environment'='live' LOOP
  history:=public._sales_invoice_provider_disposition_history(invoice,payment_position);
  original_histories:=original_histories||jsonb_build_array(payment_position||jsonb_build_object('financial_decision',history));
  IF _proposal IS NOT NULL AND payment_position->'provider_operation_id'=_proposal->'provider_operation_id' THEN
   IF payment_position->'verification_pending' IS DISTINCT FROM 'false'::jsonb OR payment_position->'retained_minor'='null'::jsonb THEN
    RAISE EXCEPTION 'Original payment verification pending' USING ERRCODE='55000';END IF;
   IF payment_position->'observation_id' IS DISTINCT FROM _proposal->'observation_id'
    OR payment_position->'observation_version' IS DISTINCT FROM _proposal->'observation_version'
    OR history->'version' IS DISTINCT FROM _proposal->'expected_disposition_version' THEN
    RAISE EXCEPTION 'Original payment decision source changed' USING ERRCODE='40001';END IF;
   IF _proposal->>'decision'='credit_returned_principal' AND (_proposal->>'credit_minor')::bigint>(payment_position->>'captured_minor')::bigint THEN
    RAISE EXCEPTION 'Credit exceeds original captured principal' USING ERRCODE='22023';END IF;
   history:=history||jsonb_build_object('credit_minor',CASE WHEN _proposal->>'decision'='balance_due' THEN 0 ELSE (_proposal->>'credit_minor')::bigint END,
    'observation_id',_proposal->'observation_id','observation_version',_proposal->'observation_version');
   proposed:=true;
  END IF;
  known:=known AND payment_position->'verification_pending'='false'::jsonb
   AND (payment_position->'commercial_review_required'='false'::jsonb OR
    (history->'observation_id'=payment_position->'observation_id' AND history->'observation_version'=payment_position->'observation_version'));
  histories:=histories||jsonb_build_array(payment_position||jsonb_build_object('financial_decision',history));
 END LOOP;
 IF _proposal IS NOT NULL AND NOT proposed THEN RAISE EXCEPTION 'Original LIVE payment unavailable' USING ERRCODE='42501';END IF;
 has_plan:=invoice.billing_draft#>'{agreement_snapshot,id}' IS NOT NULL OR invoice.billing_draft#>'{commercial_terms_reference,id}' IS NOT NULL;
 IF has_plan THEN
  IF coalesce(invoice.billing_draft#>>'{agreement_snapshot,id}','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'Original accepted obligation unavailable' USING ERRCODE='55000';END IF;
  accepted:=public._sales_invoice_accepted_obligations(invoice,(invoice.billing_draft#>>'{agreement_snapshot,id}')::uuid);
  IF accepted->>'state' IS DISTINCT FROM 'available' THEN
   RETURN QUERY SELECT _invoice,source||jsonb_build_object('financial_standing','allocation_required','actual_outstanding_minor',NULL,
    'refund_payable_minor',NULL,'credit_minor',NULL,'obligations','[]'::jsonb,'accepted_source_state',accepted->>'reason');RETURN;
  END IF;
  targets:=accepted->'obligations';
 ELSE
  targets:=jsonb_build_array(jsonb_build_object('reference',NULL,'scheduled_minor',invoice.amount_total_cents,
   'remaining_minor',source->'receivable_remaining_minor'));
 END IF;
 FOR target IN SELECT value FROM jsonb_array_elements(targets) LOOP
  scheduled:=(target->>'scheduled_minor')::numeric;gross:=0;retained:=0;credits:=0;
  FOR payment_position IN SELECT value FROM jsonb_array_elements(histories) LOOP
   IF NOT has_plan OR (payment_position#>'{obligation,reference}'=target->'reference'
    AND payment_position#>'{obligation,source_digest}'=target->'source_digest'
    AND payment_position#>'{obligation,due_date}'=target->'due_date'
    AND payment_position#>'{obligation,scheduled_minor}'=target->'scheduled_minor') THEN
    gross:=gross+(payment_position->>'captured_minor')::numeric;
    retained:=retained+coalesce((payment_position->>'retained_minor')::numeric,0);
    credits:=credits+(payment_position#>>'{financial_decision,credit_minor}')::numeric;
   END IF;
  END LOOP;
  total_gross:=total_gross+gross;
  manual:=scheduled-(target->>'remaining_minor')::numeric-gross;
  IF manual<0 OR credits<0 OR credits>scheduled THEN
   RAISE EXCEPTION 'Original obligation allocation conflict' USING ERRCODE='55000';END IF;
  outstanding:=outstanding+greatest(scheduled-credits-manual-retained,0);
  refund_payable:=refund_payable+greatest(manual+retained-(scheduled-credits),0);
  total_credit:=total_credit+credits;
  projected:=projected||jsonb_build_array(target||jsonb_build_object('credit_minor',credits,'actual_allocated_minor',CASE WHEN known THEN manual+retained END,
   'actual_outstanding_minor',CASE WHEN known THEN greatest(scheduled-credits-manual-retained,0) END,
   'refund_payable_minor',CASE WHEN known THEN greatest(manual+retained-(scheduled-credits),0) END));
 END LOOP;
 IF total_gross IS DISTINCT FROM (source->>'live_provider_minor')::numeric THEN
  RAISE EXCEPTION 'Original obligation allocation required' USING ERRCODE='55000';END IF;
 source_hash:=encode(sha256(convert_to(jsonb_build_object('invoice_id',invoice.id,'invoice_version',invoice.billing_lifecycle_version,
  'client_id',invoice.contact_id,'document_digest',invoice.billing_document_digest,'source',source,
  'original_payment_decisions',original_histories,'accepted_obligations',targets)::text,'UTF8')),'hex');
 RETURN QUERY SELECT _invoice,source||jsonb_build_object('financial_standing',CASE WHEN known THEN 'recorded' ELSE 'needs_review' END,
  'actual_outstanding_minor',CASE WHEN known THEN outstanding END,'refund_payable_minor',CASE WHEN known THEN refund_payable END,
  'credit_minor',total_credit,'obligations',projected,'provider_decisions',histories,'original_payment_decisions',original_histories,
  'financial_source_hash',source_hash);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._sales_invoice_provider_disposition_review(_actor uuid,_tenant uuid,_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE invoice public.paige_invoices%ROWTYPE; before_state jsonb; after_state jsonb; payment_position jsonb;
 history jsonb; client_name text; profile jsonb;
BEGIN
 PERFORM public._sales_invoice_provider_disposition_command(_command);
 PERFORM public._sales_invoice_actor(_actor,_tenant);
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_tenant FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501';END IF;
 IF invoice.status IS DISTINCT FROM 'issued' OR lower(invoice.currency) IS DISTINCT FROM 'usd'
  OR invoice.billing_issued_snapshot_version IS NULL OR invoice.billing_document IS NULL
  OR invoice.billing_lifecycle_version IS DISTINCT FROM (_command->>'expected_version')::bigint THEN
  RAISE EXCEPTION 'Invoice financial source changed' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM public.paige_invoice_provider_operations p WHERE p.tenant_id=_tenant AND p.invoice_id=invoice.id
  AND p.environment='live' AND p.state IN('prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown')) THEN
  RAISE EXCEPTION 'Resolve the original pending payment request before changing its financial treatment' USING ERRCODE='55000';END IF;
 SELECT b.financial_position INTO STRICT before_state FROM public._sales_invoice_financial_position_rows(_tenant,invoice.id,3,NULL::jsonb) b;
 SELECT b.financial_position INTO STRICT after_state FROM public._sales_invoice_financial_position_rows(_tenant,invoice.id,3,_command) b;
 IF before_state->>'financial_standing'='allocation_required' OR after_state->>'financial_standing'='allocation_required' THEN
  RAISE EXCEPTION 'Original accepted payment allocation required' USING ERRCODE='55000';END IF;
 SELECT value INTO payment_position FROM jsonb_array_elements(before_state->'original_payment_decisions')
  WHERE value->'provider_operation_id'=_command->'provider_operation_id';
 IF NOT FOUND THEN RAISE EXCEPTION 'Original LIVE payment unavailable' USING ERRCODE='42501';END IF;
 history:=payment_position->'financial_decision';
 client_name:=public._sales_collection_client_name(_tenant,invoice.contact_id);
 IF client_name IS NULL OR length(btrim(client_name))<1 OR length(client_name)>500 THEN
  RAISE EXCEPTION 'Original financial client unavailable' USING ERRCODE='55000';END IF;
 profile:=jsonb_build_object('review_version',2,'financial_evidence_version',3,'effect','internal_financial_disposition_only',
  'invoice_id',invoice.id,'invoice_version',invoice.billing_lifecycle_version,'client_id',invoice.contact_id,'client_name',client_name,'currency','usd',
  'provider_operation_id',_command->'provider_operation_id','observation_id',_command->'observation_id','observation_version',_command->'observation_version',
  'disposition_version',history->'version','decision',_command->'decision','captured_minor',payment_position->'captured_minor',
  'retained_minor',payment_position->'retained_minor','returned_minor',payment_position->'returned_minor',
  'credit_before_minor',history->'credit_minor','credit_after_minor',CASE WHEN _command->>'decision'='balance_due' THEN 0 ELSE (_command->>'credit_minor')::bigint END,
  'standing_before',before_state->'financial_standing','outstanding_before_minor',before_state->'actual_outstanding_minor',
  'refund_payable_before_minor',before_state->'refund_payable_minor','standing_after',after_state->'financial_standing',
  'outstanding_after_minor',after_state->'actual_outstanding_minor','refund_payable_after_minor',after_state->'refund_payable_minor',
  'source_hash',before_state->'financial_source_hash');
 RETURN jsonb_build_object('eligible',true,'invoice_number',invoice.invoice_number,'currency','usd','provider_disposition',profile,
  'summary','Record the reviewed internal credit or debt decision. This does not move money, amend signed terms or notify the client.');
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_provider_disposition_review(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._sales_invoice_provider_disposition_receipt(_entry public.paige_invoice_operations)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE invoice public.paige_invoices%ROWTYPE; cash jsonb; payment_position jsonb;
BEGIN
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=_entry.invoice_id AND tenant_id=_entry.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original financial invoice unavailable' USING ERRCODE='55000';END IF;
 SELECT b.financial_position INTO STRICT cash FROM public._sales_invoice_financial_position_rows(_entry.tenant_id,_entry.invoice_id,3) b;
 SELECT value INTO payment_position FROM jsonb_array_elements(cash->'provider_payment_positions')
  WHERE value->'provider_operation_id'=_entry.command->'provider_operation_id' AND value->>'environment'='live';
 IF NOT FOUND THEN RAISE EXCEPTION 'Original financial payment unavailable' USING ERRCODE='55000';END IF;
 PERFORM public._sales_invoice_provider_disposition_history(invoice,payment_position);
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_provider_disposition_receipt(public.paige_invoice_operations) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._sales_invoice_record_provider_disposition(_actor uuid,_tenant uuid,_operation uuid,_command jsonb,_governance jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE invoice public.paige_invoices%ROWTYPE; prior jsonb; preview jsonb; profile jsonb; source jsonb; payment_position jsonb;
 history jsonb; unchanged boolean; receipt_id uuid; result jsonb; next_version bigint; next_disposition bigint;
BEGIN
 PERFORM public._sales_payment_operation_service();
 PERFORM public._sales_invoice_actor(_actor,_tenant);
 PERFORM public._sales_invoice_provider_disposition_command(_command);
 PERFORM public._sales_invoice_governance(_actor,_tenant,'invoice.record_provider_disposition','sales_record_provider_disposition',_governance);
 IF _operation IS NULL THEN RAISE EXCEPTION 'Invalid invoice operation' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation::text,81742));
 prior:=public.read_sales_invoice_command_result(_actor,_tenant,_operation,_command);
 IF prior IS NOT NULL THEN RETURN prior;END IF;
 IF EXISTS(SELECT 1 FROM public.messages m WHERE m.meta#>>'{sales_invoice_binding,operation_id}'=_operation::text)
  OR EXISTS(SELECT 1 FROM public.paige_invoice_provider_operations p WHERE p.id=_operation)
  OR EXISTS(SELECT 1 FROM public.paige_durable_work w WHERE w.id=_operation) THEN
  RAISE EXCEPTION 'Operation already belongs to another action' USING ERRCODE='22023';END IF;
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_tenant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501';END IF;
 -- All original provider-observation writers lock invoice before the payment row.
 -- Never take their provider-operation advisory lock after holding the invoice.
 preview:=public._sales_invoice_provider_disposition_review(_actor,_tenant,_command);
 profile:=preview->'provider_disposition';
 IF _governance->'approved_financial_review' IS DISTINCT FROM profile THEN
  RAISE EXCEPTION 'Approved financial consequence changed; review again' USING ERRCODE='40001';END IF;
 SELECT b.financial_position INTO STRICT source FROM public._sales_invoice_financial_position_rows(_tenant,invoice.id,3,NULL::jsonb) b;
 SELECT value INTO payment_position FROM jsonb_array_elements(source->'original_payment_decisions')
  WHERE value->'provider_operation_id'=_command->'provider_operation_id';
 history:=payment_position->'financial_decision';
 -- Recheck the original receipt namespace after invoice/accepted-source waits.
 -- A prior success without its immutable operation is an integrity exception,
 -- never a receipt to borrow for another write. Exact completed replay returned
 -- above; same-action failed attempts may retain their original failure history.
 IF EXISTS(SELECT 1 FROM public.paige_workspace_events e WHERE e.tenant_id=_tenant
  AND e.source_kind='capability_run' AND e.source_id=_operation
  AND (e.capability_key IS DISTINCT FROM 'sales_record_provider_disposition'
   OR e.actor_id IS DISTINCT FROM _actor OR e.source_revision IS DISTINCT FROM 0 OR e.outcome='capability_succeeded')) THEN
  RAISE EXCEPTION 'Operation already belongs to another action' USING ERRCODE='22023';END IF;
 unchanged:=(history->>'version')::bigint>0 AND history->'credit_minor'=profile->'credit_after_minor'
  AND history->'observation_id'=_command->'observation_id' AND history->'observation_version'=_command->'observation_version';
 next_version:=invoice.billing_lifecycle_version+CASE WHEN unchanged THEN 0 ELSE 1 END;
 next_disposition:=(_command->>'expected_disposition_version')::bigint+CASE WHEN unchanged THEN 0 ELSE 1 END;
 IF NOT unchanged THEN
  UPDATE public.paige_invoices SET billing_lifecycle_version=next_version,updated_at=clock_timestamp() WHERE id=invoice.id;
 END IF;
 PERFORM public.record_capability_run(_tenant,_actor,'sales_record_provider_disposition','capability_succeeded',_operation,NULL);
 SELECT e.id INTO receipt_id FROM public.paige_workspace_events e WHERE e.tenant_id=_tenant AND e.actor_id=_actor
  AND e.source_kind='capability_run' AND e.source_id=_operation AND e.source_revision=0 AND e.outcome='capability_succeeded'
  AND e.capability_key='sales_record_provider_disposition' AND e.actor_agent_slug IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Financial decision receipt unavailable' USING ERRCODE='55000';END IF;
 result:=jsonb_build_object('ok',true,'outcome',CASE WHEN unchanged THEN 'financial_decision_unchanged' ELSE 'financial_decision_recorded' END,
  'effect','internal_financial_disposition_only','payment_moved',false,'customer_notified',false,'rail_recorded',true,'receipt_id',receipt_id,
  'operation',jsonb_build_object('id',_operation,'action','invoice.record_provider_disposition'),'provider_disposition_review',profile,
  'disposition_version',next_disposition,'invoice_version',next_version,
  'row',jsonb_build_object('id',invoice.id,'tenant_id',_tenant,'version',next_version));
 INSERT INTO public.paige_invoice_operations(id,tenant_id,invoice_id,actor_user_id,command,result)
  VALUES(_operation,_tenant,invoice.id,_actor,_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_record_provider_disposition(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Insert only new-action delegation into the ORIGINAL entry bodies. Every
-- previous byte, OID, argument, owner, volatility, search path and ACL remains.
DO $original_doors$
DECLARE r record;p pg_proc%ROWTYPE;original_body text;candidate text;definition text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('public.preview_sales_invoice_command(uuid,uuid,jsonb)','9ecfe85e6d8638082ee14f9b13acff47',
  E'BEGIN\n result:=public._preview_sales_invoice_before_provider',
  E'BEGIN\n IF _command->>''action''=''invoice.record_provider_disposition'' THEN\n  RETURN public._sales_invoice_provider_disposition_review(_actor_user_id,_expected_tenant_id,_command);\n END IF;\n result:=public._preview_sales_invoice_before_provider',
  ARRAY['_actor_user_id','_expected_tenant_id','_command']),
 ('public.execute_sales_invoice_command(uuid,uuid,uuid,jsonb,jsonb)','b4da1d303e969a5bb33d89cd60103375',
  E'BEGIN\n IF _command->>''action'' IS DISTINCT FROM ''invoice.settings_update'' THEN',
  E'BEGIN\n IF _command->>''action''=''invoice.record_provider_disposition'' THEN\n  RETURN public._sales_invoice_record_provider_disposition(_actor_user_id,_expected_tenant_id,_operation_id,_command,_governance);\n END IF;\n IF _command->>''action'' IS DISTINCT FROM ''invoice.settings_update'' THEN',
  ARRAY['_actor_user_id','_expected_tenant_id','_operation_id','_command','_governance']),
 ('public.read_sales_invoice_command_result(uuid,uuid,uuid,jsonb)','94fd1e3deb3547b4bb72388b2a0549e9',
  E'  RETURN op.result;',
  E'  IF op.command->>''action''=''invoice.record_provider_disposition'' THEN\n   PERFORM public._sales_invoice_provider_disposition_receipt(op);\n  END IF;\n  RETURN op.result;',
  ARRAY['_actor_user_id','_expected_tenant_id','_operation_id','_command'])
 ) x(signature,body_md5,anchor,extension,args) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
  IF NOT FOUND OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
   OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] OR p.proargnames IS DISTINCT FROM r.args
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
   RAISE EXCEPTION 'Original invoice financial door changed; reconcile before applying' USING ERRCODE='23514';END IF;
  original_body:=p.prosrc;
  IF strpos(original_body,r.extension)>0 THEN original_body:=replace(original_body,r.extension,r.anchor);END IF;
  IF md5(original_body)<>r.body_md5 OR array_length(string_to_array(original_body,r.anchor),1)<>2 THEN
   RAISE EXCEPTION 'Original invoice financial door changed; reconcile before applying' USING ERRCODE='23514';END IF;
  candidate:=replace(original_body,r.anchor,r.extension);
  IF replace(candidate,r.extension,r.anchor) IS DISTINCT FROM original_body THEN
   RAISE EXCEPTION 'Original invoice source inverse mismatch' USING ERRCODE='23514';END IF;
  IF p.prosrc IS DISTINCT FROM candidate THEN
   definition:=pg_get_functiondef(p.oid);
   IF array_length(string_to_array(definition,p.prosrc),1)<>2 THEN
    RAISE EXCEPTION 'Original invoice definition boundary changed' USING ERRCODE='23514';END IF;
   EXECUTE replace(definition,p.prosrc,candidate);
  END IF;
 END LOOP;
END $original_doors$;
-- END ORIGINAL SOURCE exp04_invoice_provider_disposition.sql

-- BEGIN ORIGINAL SOURCE exp04_invoice_financial_collectibility.sql
-- INERT O5 companion: original accepted source and original payment writer checks.
-- Not a migration/activation. No receipt/history/provider/approval/tenant rewrite.
DO $original_consumers$
DECLARE r record;p pg_proc%ROWTYPE;
BEGIN
 FOR r IN SELECT * FROM (VALUES
('public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)','4f52d722c9b965de563aa307e94e0f31','60f37a887ee106ef7761260fdeb6b637',false,'search_path=""'),
('public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)','fd0ec0aabf95d46b8f052af027cbf6ce','bdb0960fa3d88b21cca90b79636dc7e1',false,'search_path=""'),
('public._sales_invoice_require_accepted_obligation(public.paige_invoices,jsonb)','1de192b462e93708741b3933c15b0b8b','e07fdfc39975c26c2ec07f0ac290ba2c',false,'search_path=""'),
('public.prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb)','8bae7da7b9efc5c5ed21615b57df51ff','efefcdbf889d8524bd2b2440c4b8e055',true,'search_path=pg_catalog, public'),
('public.claim_sales_invoice_payment_request(uuid,uuid,uuid)','6a542fbff334c53d43c4fe6d734d138c','316accdf44a20806402c40cf690f0b14',true,'search_path=pg_catalog, public'),
('public.allocate_verified_sales_invoice_payment(uuid,uuid,uuid,jsonb)','d68a90d2773bbb1700fb29c89966229e','17310e2c68bc386ecbc0f2850476006d',true,'search_path=pg_catalog, public')
,
('public.read_sales_invoice_payment_obligation(uuid,uuid,uuid,jsonb)','662fc0645d50fa24d3a0626d22598e51','04bfed78729d469de33c16c820358859',true,'search_path=""')
,
('public._sales_invoice_payment_request_mutation_guard()','6036f48c4bfd0c46fd20803be0e29070','ccbc654b650c3a096ae9779646448a5f',true,'search_path=pg_catalog, public'),
('public.record_sales_invoice_provider_observation(uuid,uuid,uuid,bigint,jsonb,text)','d32856b434999f944b88a1499124c913','950fdbc386da780ae6ccefa89d0a0043',true,'search_path=""')
 ) x(signature,before_hash,after_hash,definer,setting) LOOP
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
 IF NOT FOUND OR md5(p.prosrc) NOT IN (r.before_hash,r.after_hash)
  OR pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef IS DISTINCT FROM r.definer
  OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u'
  OR p.pronargdefaults<>0 OR p.proconfig IS DISTINCT FROM ARRAY[r.setting]
  OR p.proargnames IS DISTINCT FROM (CASE r.signature
 WHEN 'public._sales_invoice_accepted_obligations(public.paige_invoices,uuid)' THEN ARRAY['_invoice','_signing_id']
 WHEN 'public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)' THEN ARRAY['_tenant','_invoice','_evidence_version','_proposal','invoice_id','financial_position']
 WHEN 'public._sales_invoice_require_accepted_obligation(public.paige_invoices,jsonb)' THEN ARRAY['_invoice','_command']
 WHEN 'public.prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb)' THEN ARRAY['_actor_user_id','_expected_tenant_id','_operation_id','_command','_governance']
 WHEN 'public.claim_sales_invoice_payment_request(uuid,uuid,uuid)' THEN ARRAY['_expected_tenant_id','_operation_id','_claim_token']
 WHEN 'public.allocate_verified_sales_invoice_payment(uuid,uuid,uuid,jsonb)' THEN ARRAY['_expected_tenant_id','_operation_id','_claim_token','_readback']
 WHEN 'public.read_sales_invoice_payment_obligation(uuid,uuid,uuid,jsonb)' THEN ARRAY['_actor_user_id','_expected_tenant_id','_invoice_id','_reference']
 WHEN 'public.record_sales_invoice_provider_observation(uuid,uuid,uuid,bigint,jsonb,text)' THEN ARRAY['_expected_tenant_id','_operation_id','_claim_token','_expected_observation_version','_snapshot','_reference'] END)
  OR p.proacl::text IS DISTINCT FROM (CASE WHEN r.signature='public._sales_invoice_payment_request_mutation_guard()' THEN '{postgres=X/postgres}' WHEN r.definer THEN '{postgres=X/postgres,service_role=X/postgres}' ELSE '{postgres=X/postgres}' END) THEN
  RAISE EXCEPTION 'Original financial consumer source/authority changed; reconcile before applying' USING ERRCODE='23514';
 END IF;
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
('public._sales_invoice_accepted_obligations(public.paige_invoices,uuid,integer)','56ae7991f59c2d40d5a6bea5fae562ad'),
('public._sales_invoice_collectible_balance(public.paige_invoices)','97ad63a1e9284ae38d8fade870f1c119')
 ) x(signature,body_hash) LOOP
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
 IF FOUND AND (md5(p.prosrc)<>r.body_hash OR pg_get_userbyid(p.proowner)<>'postgres'
  OR p.prosecdef OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u'
  OR p.pronargdefaults<>0 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  OR p.proretset OR p.proallargtypes IS NOT NULL OR p.proargmodes IS NOT NULL
  OR p.proargnames IS DISTINCT FROM (CASE r.signature WHEN 'public._sales_invoice_accepted_obligations(public.paige_invoices,uuid,integer)' THEN ARRAY['_invoice','_signing_id','_evidence_version'] ELSE ARRAY['_invoice'] END)
  OR p.prorettype IS DISTINCT FROM (CASE r.signature WHEN 'public._sales_invoice_accepted_obligations(public.paige_invoices,uuid,integer)' THEN 'jsonb'::regtype ELSE 'bigint'::regtype END)
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Private financial consumer source/authority changed; reconcile before applying' USING ERRCODE='23514';
 END IF;
 END LOOP;
END $original_consumers$;

CREATE OR REPLACE FUNCTION public._sales_invoice_accepted_obligations(_invoice paige_invoices, _signing_id uuid, _evidence_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE signing public.paige_agreements%ROWTYPE; terms public.tenant_client_agreements%ROWTYPE;
 payload jsonb; effective jsonb; base jsonb; obligations jsonb:='[]'::jsonb;
 obligation jsonb; v_reference jsonb; balance record; sequence bigint; scheduled bigint;
 allocated numeric; allocated_total numeric:=0; scheduled_total bigint:=0; manual_allocations jsonb; manual_allocated numeric;
BEGIN
 IF _evidence_version IS NULL OR _evidence_version NOT IN (1,3) THEN
  RAISE EXCEPTION 'Accepted obligation source version unavailable' USING ERRCODE='22023';END IF;
 IF _invoice.id IS NULL OR _invoice.tenant_id IS NULL OR _invoice.contact_id IS NULL OR _signing_id IS NULL THEN
  RAISE EXCEPTION 'Accepted invoice source unavailable' USING ERRCODE='22023';
 END IF;
 base:=pg_catalog.jsonb_build_object('schema_version',1,'tenant_id',_invoice.tenant_id,
  'client_id',_invoice.contact_id,'invoice_id',_invoice.id,
  'invoice_version',_invoice.billing_lifecycle_version,'invoice_draft_version',_invoice.billing_draft_version,
  'issued_snapshot_version',_invoice.billing_issued_snapshot_version,'obligations','[]'::jsonb);
 IF _invoice.status IS DISTINCT FROM 'issued' OR _invoice.billing_issued_snapshot_version IS NULL
  OR _invoice.billing_issued_at IS NULL OR _invoice.billing_document IS NULL THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','invoice_not_issued');
 END IF;
 SELECT * INTO signing FROM public.paige_agreements WHERE id=_signing_id
  AND tenant_id=_invoice.tenant_id AND contact_id=_invoice.contact_id FOR SHARE;
 IF NOT FOUND THEN RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_unavailable'); END IF;
 SELECT * INTO terms FROM public.tenant_client_agreements WHERE id=signing.commercial_terms_id
  AND tenant_id=_invoice.tenant_id AND contact_id=_invoice.contact_id FOR SHARE;
 IF NOT FOUND THEN RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_unavailable'); END IF;
 IF terms.status IS DISTINCT FROM 'active' THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','commercial_terms_inactive');
 END IF;
 -- These original helpers alone own consent, exact accepted payload/economics,
 -- effectuation-operation and Rail provenance. Do not copy their evidence joins.
 payload:=public._paige_accepted_commercial_payload(signing);
 effective:=public._sales_collection_accepted_total_evidence(terms);
 IF payload IS NULL OR effective IS NULL
  OR payload->'schema_version' IS DISTINCT FROM '2'::jsonb
  OR terms.effective_signing_id IS DISTINCT FROM signing.id
  OR _invoice.billing_draft#>>'{agreement_snapshot,id}' IS DISTINCT FROM signing.id::text
  OR _invoice.billing_draft#>>'{commercial_terms_reference,id}' IS DISTINCT FROM terms.id::text
  OR payload#>>'{source,invoice_id}' IS DISTINCT FROM _invoice.id::text
  OR payload#>'{source,invoice_draft_version}' IS DISTINCT FROM pg_catalog.to_jsonb(_invoice.billing_draft_version)
  OR payload#>>'{source,client_id}' IS DISTINCT FROM _invoice.contact_id::text
  OR payload#>>'{source,tenant_id}' IS DISTINCT FROM _invoice.tenant_id::text
  OR payload#>>'{source,agreement_id}' IS DISTINCT FROM signing.id::text
  OR payload#>>'{source,terms_id}' IS DISTINCT FROM terms.id::text
  OR payload#>'{source,terms_version}' IS DISTINCT FROM pg_catalog.to_jsonb(terms.effective_terms_version)
  OR signing.commercial_presentation->>'payload_digest' IS DISTINCT FROM terms.effective_source_digest
  OR payload->>'currency' IS DISTINCT FROM pg_catalog.lower(_invoice.currency)
  OR payload->'principal_minor' IS DISTINCT FROM pg_catalog.to_jsonb(_invoice.amount_total_cents)
  OR pg_catalog.jsonb_typeof(payload->'obligations') IS DISTINCT FROM 'array'
  OR pg_catalog.jsonb_array_length(payload->'obligations') NOT BETWEEN 1 AND 240 THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_changed');
 END IF;
 IF _evidence_version=1 THEN
 SELECT * INTO STRICT balance FROM public._sales_invoice_financial_position_rows(_invoice.tenant_id,_invoice.id);
 -- Original allocation evidence below is LIVE or explicitly business-recorded.
 -- TEST never enters actual receivable, cannot fulfill an obligation and need not
 -- hide the customer's still-outstanding accepted payment plan.
 manual_allocations:=public._sales_invoice_manual_allocations(_invoice);
 IF manual_allocations IS NULL THEN RETURN base||pg_catalog.jsonb_build_object('state','held','reason','allocation_required'); END IF;
 END IF;
 FOR obligation,sequence IN SELECT value,ordinality FROM pg_catalog.jsonb_array_elements(payload->'obligations') WITH ORDINALITY LOOP
  IF obligation->'sequence' IS DISTINCT FROM pg_catalog.to_jsonb(sequence)
   OR pg_catalog.jsonb_typeof(obligation->'amount_cents') IS DISTINCT FROM 'number'
   OR coalesce(obligation->>'amount_cents','') !~ '^(0|[1-9][0-9]{0,9})$'
   OR (obligation->>'amount_cents')::bigint>2147483647
   OR obligation->>'currency' IS DISTINCT FROM payload->>'currency'
   OR coalesce(obligation->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_changed');
  END IF;
  scheduled:=(obligation->>'amount_cents')::bigint;
  scheduled_total:=scheduled_total+scheduled;
  v_reference:=pg_catalog.jsonb_build_object('commercial_terms_id',terms.id,'signing_id',signing.id,
   'signing_version',signing.version,'terms_version',terms.effective_terms_version,'sequence',sequence);
  -- Only an original receipt linked to the exact immutable settled provider
  -- operation can allocate this target here. No FIFO, pending checkout or guessed
  -- manual receipt assignment. Explicit business-recorded allocations below use
  -- the SAME original immutable operation/receipt; absence stays unassigned.
  IF _evidence_version=3 THEN allocated:=0; ELSE
  SELECT coalesce(pg_catalog.sum(payment.amount_cents),0) INTO allocated
   FROM public.paige_invoice_payments payment
   JOIN public.paige_invoice_provider_operations operation ON operation.id=payment.provider_operation_id
    AND operation.tenant_id=payment.tenant_id AND operation.invoice_id=payment.invoice_id
   WHERE payment.tenant_id=_invoice.tenant_id AND payment.invoice_id=_invoice.id
    AND payment.kind='receipt' AND payment.evidence_kind='provider_verified'
    AND payment.provider_environment='live' AND operation.environment='live'
    AND operation.state='settled' AND operation.allocation_payment_id=payment.id
    AND operation.client_id=_invoice.contact_id AND operation.amount_minor=payment.amount_cents
    AND payment.currency=operation.currency AND payment.provider=operation.provider
    AND operation.currency=payload->>'currency' AND operation.verified_readback IS NOT NULL
    AND operation.command->>'action'='invoice.payment_request'
    AND operation.command#>'{obligation,reference}'=v_reference
    AND operation.command#>>'{obligation,source_digest}'=terms.effective_source_digest
    AND operation.command#>>'{obligation,due_date}'=obligation->>'due_date'
    AND operation.command#>'{obligation,scheduled_minor}'=pg_catalog.to_jsonb(scheduled)
    AND operation.command#>'{obligation,remaining_minor}'=pg_catalog.to_jsonb(operation.amount_minor);
  SELECT coalesce(pg_catalog.sum((a.value->>'amount_cents')::bigint),0) INTO manual_allocated
   FROM pg_catalog.jsonb_array_elements(manual_allocations) a
   WHERE a.value#>'{obligation,reference}'=v_reference
    AND a.value#>>'{obligation,source_digest}'=terms.effective_source_digest
    AND a.value#>>'{obligation,due_date}'=obligation->>'due_date'
    AND a.value#>'{obligation,scheduled_minor}'=pg_catalog.to_jsonb(scheduled);
  allocated:=allocated+manual_allocated;
  IF allocated<0 OR allocated>scheduled THEN
   RETURN base||pg_catalog.jsonb_build_object('state','held','reason','allocation_conflict');
  END IF;
  allocated_total:=allocated_total+allocated;
  END IF;
  IF scheduled>0 THEN
   obligations:=obligations||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'reference',v_reference,'source_digest',terms.effective_source_digest,'due_date',obligation->>'due_date',
    'scheduled_minor',scheduled,'remaining_minor',scheduled-allocated));
  END IF;
 END LOOP;
 IF scheduled_total IS DISTINCT FROM _invoice.amount_total_cents::bigint THEN
  RETURN base||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_changed');
 END IF;
 IF _evidence_version=1 THEN
  IF allocated_total IS DISTINCT FROM balance.receivable_allocated_minor THEN
   RETURN base||pg_catalog.jsonb_build_object('state','held','reason','allocation_required');
  END IF;
 END IF;
 RETURN base||pg_catalog.jsonb_build_object('state','available','obligations',obligations)
  ||CASE WHEN _evidence_version=3 THEN pg_catalog.jsonb_build_object('financial_source_only',true) ELSE '{}'::jsonb END;
END $function$;
REVOKE ALL ON FUNCTION public._sales_invoice_accepted_obligations(public.paige_invoices,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._sales_invoice_collectible_balance(_invoice public.paige_invoices)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $collectible$
DECLARE position jsonb; amount bigint;
BEGIN
 SELECT b.financial_position INTO STRICT position
 FROM public._sales_invoice_financial_position_rows(_invoice.tenant_id,_invoice.id,3,NULL::jsonb) b;
 IF position->>'financial_standing' IS DISTINCT FROM 'recorded'
  OR jsonb_typeof(position->'actual_outstanding_minor') IS DISTINCT FROM 'number'
  OR coalesce(position->>'actual_outstanding_minor','') !~ '^(0|[1-9][0-9]{0,9})$' THEN
  RAISE EXCEPTION 'Original invoice financial verification required before a payment request' USING ERRCODE='40001';END IF;
 amount:=(position->>'actual_outstanding_minor')::bigint;
 IF amount>2147483647 THEN RAISE EXCEPTION 'Original invoice financial amount unavailable' USING ERRCODE='55000';END IF;
 RETURN amount;
END $collectible$;
REVOKE ALL ON FUNCTION public._sales_invoice_collectible_balance(public.paige_invoices) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._sales_invoice_accepted_obligations(_invoice paige_invoices, _signing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 RETURN public._sales_invoice_accepted_obligations(_invoice,_signing_id,1);
END $function$;

CREATE OR REPLACE FUNCTION public._sales_invoice_financial_position_rows(_tenant uuid,_invoice uuid,_evidence_version integer,_proposal jsonb)
RETURNS TABLE(invoice_id uuid,financial_position jsonb)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE invoice public.paige_invoices%ROWTYPE; source jsonb; payment_position jsonb; history jsonb;
 positions jsonb; histories jsonb; original_histories jsonb; accepted jsonb; targets jsonb; target jsonb;
 matched jsonb; gross numeric; retained numeric; credits numeric; manual numeric; scheduled numeric;
 outstanding numeric:=0;refund_payable numeric:=0;total_credit numeric:=0;total_gross numeric:=0;
 known boolean:=true; proposed boolean:=false; has_plan boolean; source_hash text; projected jsonb:='[]'; manual_allocations jsonb; total_manual numeric:=0;
BEGIN
 IF _tenant IS NULL OR _invoice IS NULL OR _evidence_version IS DISTINCT FROM 3 THEN
  RAISE EXCEPTION 'Financial evidence version unavailable' USING ERRCODE='22023';END IF;
 SELECT * INTO invoice FROM public.paige_invoices i WHERE i.id=_invoice AND i.tenant_id=_tenant;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501';END IF;
 SELECT b.financial_position INTO STRICT source FROM public._sales_invoice_financial_position_rows(_tenant,_invoice,3) b;
 positions:=source->'provider_payment_positions';histories:='[]';original_histories:='[]';
 IF jsonb_typeof(positions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Original payment positions unavailable' USING ERRCODE='55000';END IF;
 IF _proposal IS NOT NULL THEN
  PERFORM public._sales_invoice_provider_disposition_command(_proposal);
  IF _proposal->'invoice_id' IS DISTINCT FROM to_jsonb(_invoice)
   OR _proposal->'expected_version' IS DISTINCT FROM to_jsonb(invoice.billing_lifecycle_version) THEN
   RAISE EXCEPTION 'Invoice financial source changed' USING ERRCODE='40001';END IF;
 END IF;
 FOR payment_position IN SELECT value FROM jsonb_array_elements(positions) WHERE value->>'environment'='live' LOOP
  history:=public._sales_invoice_provider_disposition_history(invoice,payment_position);
  original_histories:=original_histories||jsonb_build_array(payment_position||jsonb_build_object('financial_decision',history));
  IF _proposal IS NOT NULL AND payment_position->'provider_operation_id'=_proposal->'provider_operation_id' THEN
   IF payment_position->'verification_pending' IS DISTINCT FROM 'false'::jsonb OR payment_position->'retained_minor'='null'::jsonb THEN
    RAISE EXCEPTION 'Original payment verification pending' USING ERRCODE='55000';END IF;
   IF payment_position->'observation_id' IS DISTINCT FROM _proposal->'observation_id'
    OR payment_position->'observation_version' IS DISTINCT FROM _proposal->'observation_version'
    OR history->'version' IS DISTINCT FROM _proposal->'expected_disposition_version' THEN
    RAISE EXCEPTION 'Original payment decision source changed' USING ERRCODE='40001';END IF;
   IF _proposal->>'decision'='credit_returned_principal' AND (_proposal->>'credit_minor')::bigint>(payment_position->>'captured_minor')::bigint THEN
    RAISE EXCEPTION 'Credit exceeds original captured principal' USING ERRCODE='22023';END IF;
   history:=history||jsonb_build_object('credit_minor',CASE WHEN _proposal->>'decision'='balance_due' THEN 0 ELSE (_proposal->>'credit_minor')::bigint END,
    'observation_id',_proposal->'observation_id','observation_version',_proposal->'observation_version');
   proposed:=true;
  END IF;
  known:=known AND payment_position->'verification_pending'='false'::jsonb
   AND ((history->'version'='0'::jsonb AND payment_position->'commercial_review_required'='false'::jsonb) OR
    (history->'observation_id'=payment_position->'observation_id' AND history->'observation_version'=payment_position->'observation_version'));
  histories:=histories||jsonb_build_array(payment_position||jsonb_build_object('financial_decision',history));
 END LOOP;
 IF _proposal IS NOT NULL AND NOT proposed THEN RAISE EXCEPTION 'Original LIVE payment unavailable' USING ERRCODE='42501';END IF;
 has_plan:=invoice.billing_draft#>'{agreement_snapshot,id}' IS NOT NULL OR invoice.billing_draft#>'{commercial_terms_reference,id}' IS NOT NULL;
 IF has_plan THEN
  IF coalesce(invoice.billing_draft#>>'{agreement_snapshot,id}','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'Original accepted obligation unavailable' USING ERRCODE='55000';END IF;
  accepted:=public._sales_invoice_accepted_obligations(invoice,(invoice.billing_draft#>>'{agreement_snapshot,id}')::uuid,3);
  IF accepted->>'state' IS DISTINCT FROM 'available' THEN
   RETURN QUERY SELECT _invoice,source||jsonb_build_object('financial_standing','allocation_required','actual_outstanding_minor',NULL,
    'refund_payable_minor',NULL,'credit_minor',NULL,'obligations','[]'::jsonb,'accepted_source_state',accepted->>'reason');RETURN;
  END IF;
  targets:=accepted->'obligations';
  manual_allocations:=public._sales_invoice_manual_allocations(invoice);
  IF manual_allocations IS NULL THEN RAISE EXCEPTION 'Original manual allocation required' USING ERRCODE='55000';END IF;
 ELSE
  targets:=jsonb_build_array(jsonb_build_object('reference',NULL,'scheduled_minor',invoice.amount_total_cents,
   'remaining_minor',source->'receivable_remaining_minor'));
 END IF;
 FOR target IN SELECT value FROM jsonb_array_elements(targets) LOOP
  scheduled:=(target->>'scheduled_minor')::numeric;gross:=0;retained:=0;credits:=0;
  FOR payment_position IN SELECT value FROM jsonb_array_elements(histories) LOOP
   IF NOT has_plan OR (payment_position#>'{obligation,reference}'=target->'reference'
    AND payment_position#>'{obligation,source_digest}'=target->'source_digest'
    AND payment_position#>'{obligation,due_date}'=target->'due_date'
    AND payment_position#>'{obligation,scheduled_minor}'=target->'scheduled_minor') THEN
    gross:=gross+(payment_position->>'captured_minor')::numeric;
    retained:=retained+coalesce((payment_position->>'retained_minor')::numeric,0);
    credits:=credits+(payment_position#>>'{financial_decision,credit_minor}')::numeric;
   END IF;
  END LOOP;
  total_gross:=total_gross+gross;
  IF has_plan THEN
   SELECT coalesce(sum((a.value->>'amount_cents')::numeric),0) INTO manual FROM jsonb_array_elements(manual_allocations) a
    WHERE a.value#>'{obligation,reference}'=target->'reference'
     AND a.value#>'{obligation,source_digest}'=target->'source_digest'
     AND a.value#>'{obligation,due_date}'=target->'due_date'
     AND a.value#>'{obligation,scheduled_minor}'=target->'scheduled_minor';
  ELSE manual:=(source->>'manual_minor')::numeric;END IF;
  total_manual:=total_manual+manual;
  IF manual<0 OR credits<0 OR credits>scheduled THEN
   RAISE EXCEPTION 'Original obligation allocation conflict' USING ERRCODE='55000';END IF;
  outstanding:=outstanding+greatest(scheduled-credits-manual-retained,0);
  refund_payable:=refund_payable+greatest(manual+retained-(scheduled-credits),0);
  total_credit:=total_credit+credits;
  projected:=projected||jsonb_build_array(target||jsonb_build_object('credit_minor',credits,'actual_allocated_minor',CASE WHEN known THEN manual+retained END,
   'actual_outstanding_minor',CASE WHEN known THEN greatest(scheduled-credits-manual-retained,0) END,
   'refund_payable_minor',CASE WHEN known THEN greatest(manual+retained-(scheduled-credits),0) END));
 END LOOP;
 IF total_gross IS DISTINCT FROM (source->>'live_provider_minor')::numeric
  OR total_manual IS DISTINCT FROM (source->>'manual_minor')::numeric THEN
  RAISE EXCEPTION 'Original obligation allocation required' USING ERRCODE='55000';END IF;
 source_hash:=encode(sha256(convert_to(jsonb_build_object('invoice_id',invoice.id,'invoice_version',invoice.billing_lifecycle_version,
  'client_id',invoice.contact_id,'document_digest',invoice.billing_document_digest,'source',source,
  'original_payment_decisions',original_histories,'accepted_obligations',targets,'manual_allocations',manual_allocations)::text,'UTF8')),'hex');
 RETURN QUERY SELECT _invoice,source||jsonb_build_object('financial_standing',CASE WHEN known THEN 'recorded' ELSE 'needs_review' END,
  'actual_outstanding_minor',CASE WHEN known THEN outstanding END,'refund_payable_minor',CASE WHEN known THEN refund_payable END,
  'credit_minor',total_credit,'obligations',projected,'provider_decisions',histories,'original_payment_decisions',original_histories,
  'financial_source_hash',source_hash);
END $$;

CREATE OR REPLACE FUNCTION public._sales_invoice_require_accepted_obligation(
 _invoice public.paige_invoices,_command jsonb
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $target$
DECLARE observation jsonb; obligation jsonb;
BEGIN
 -- Existing unbound full/partial/deposit/installment requests retain their contract.
 IF NOT (_command ? 'obligation') THEN RETURN; END IF;
 IF pg_catalog.jsonb_typeof(_command->'obligation') IS DISTINCT FROM 'object'
  OR coalesce(_command->>'purpose','') NOT IN ('deposit','installment')
  OR coalesce(_command#>>'{obligation,reference,signing_id}','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RAISE EXCEPTION 'Invalid accepted payment obligation' USING ERRCODE='22023';
 END IF;
 IF _command->>'invoice_id' IS DISTINCT FROM _invoice.id::text
  OR _command->>'client_id' IS DISTINCT FROM _invoice.contact_id::text
  OR _command->'expected_version' IS DISTINCT FROM pg_catalog.to_jsonb(_invoice.billing_lifecycle_version)
  OR _command->'issued_snapshot_version' IS DISTINCT FROM pg_catalog.to_jsonb(_invoice.billing_issued_snapshot_version)
  OR _command->>'currency' IS DISTINCT FROM pg_catalog.lower(_invoice.currency) THEN
  RAISE EXCEPTION 'Accepted payment obligation changed; review again' USING ERRCODE='40001';
 END IF;
 SELECT b.financial_position INTO STRICT observation FROM public._sales_invoice_financial_position_rows(_invoice.tenant_id,_invoice.id,3,NULL::jsonb) b;
 IF observation->>'financial_standing' IS DISTINCT FROM 'recorded' THEN
  RAISE EXCEPTION 'Accepted payment obligation unavailable; review again' USING ERRCODE='40001';
 END IF;
 SELECT pg_catalog.jsonb_build_object('reference',item.value->'reference','source_digest',item.value->'source_digest',
  'due_date',item.value->'due_date','scheduled_minor',item.value->'scheduled_minor','remaining_minor',item.value->'actual_outstanding_minor')
 INTO obligation FROM pg_catalog.jsonb_array_elements(observation->'obligations') item
 WHERE pg_catalog.jsonb_build_object('reference',item.value->'reference','source_digest',item.value->'source_digest',
  'due_date',item.value->'due_date','scheduled_minor',item.value->'scheduled_minor','remaining_minor',item.value->'actual_outstanding_minor')=_command->'obligation';
 IF NOT FOUND OR obligation->'remaining_minor' IS DISTINCT FROM _command->'amount_minor'
  OR (obligation->>'remaining_minor')::bigint<=0 THEN
  RAISE EXCEPTION 'Accepted payment obligation changed; review again' USING ERRCODE='40001';
 END IF;
 IF _command->>'purpose'='deposit' AND obligation#>'{reference,sequence}' IS DISTINCT FROM '1'::jsonb THEN
  RAISE EXCEPTION 'Only the initial accepted obligation can be a deposit' USING ERRCODE='22023';
 END IF;
END $target$;

CREATE OR REPLACE FUNCTION public.prepare_sales_invoice_payment_request(_actor_user_id uuid, _expected_tenant_id uuid, _operation_id uuid, _command jsonb, _governance jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.paige_invoices%ROWTYPE; m public.tenant_stripe_accounts%ROWTYPE; op public.paige_invoice_provider_operations%ROWTYPE; balance bigint;
BEGIN
 PERFORM public._sales_payment_operation_service();
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF _operation_id IS NULL OR jsonb_typeof(_command) IS DISTINCT FROM 'object' OR octet_length(_command::text)>4000
  OR (SELECT count(*) FROM jsonb_object_keys(_command))<>(CASE WHEN _command ? 'obligation' THEN 13 ELSE 12 END)
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE k NOT IN ('action','invoice_id','client_id','expected_version','issued_snapshot_version','provider','merchant_account_id','merchant_binding_version','environment','amount_minor','currency','purpose','obligation'))
  OR _command->>'action' IS DISTINCT FROM 'invoice.payment_request'
  OR coalesce(_command->>'amount_minor','') !~ '^[1-9][0-9]{0,9}$'
  OR (_command->>'amount_minor')::bigint>2147483647
  OR _command->>'purpose' NOT IN ('full','partial','deposit','installment') THEN
  RAISE EXCEPTION 'Invalid payment request' USING ERRCODE='22023';
 END IF;
 -- Same canonical command lock/order as execute_sales_invoice_command: actor, operation, invoice.
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,81742));
 -- A common invoice lock serializes preparation, receipts, voiding and dispatch claims.
 SELECT * INTO r FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id;
 IF FOUND THEN
  IF op.tenant_id IS DISTINCT FROM _expected_tenant_id THEN
   RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
  IF op.actor_user_id IS DISTINCT FROM _actor_user_id OR op.command IS DISTINCT FROM _command THEN
   RAISE EXCEPTION 'Payment operation reused with different input' USING ERRCODE='22023';
  END IF;
  RETURN to_jsonb(op)-'dispatch_claim_token';
 END IF;
 IF EXISTS(SELECT 1 FROM public.paige_invoice_operations WHERE id=_operation_id) THEN
  RAISE EXCEPTION 'Operation belongs to another invoice action' USING ERRCODE='22023';
 END IF;
 PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,'invoice.payment_request','sales_create_payment_request',_governance);
 IF public.resolve_tool_autonomy(_expected_tenant_id,'sales_create_payment_request')='off' THEN
  RAISE EXCEPTION 'Payment request authority unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.clients WHERE id=r.contact_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND OR r.contact_id IS DISTINCT FROM (_command->>'client_id')::uuid THEN
  RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 IF r.status<>'issued' OR r.billing_issued_at IS NULL OR r.billing_document IS NULL
  OR r.billing_lifecycle_version IS DISTINCT FROM (_command->>'expected_version')::bigint
  OR r.billing_issued_snapshot_version IS DISTINCT FROM (_command->>'issued_snapshot_version')::bigint THEN
  RAISE EXCEPTION 'Invoice changed or unavailable for payment' USING ERRCODE='40001'; END IF;
 balance:=public._sales_invoice_collectible_balance(r);
 IF lower(r.currency) IS DISTINCT FROM _command->>'currency' OR (_command->>'amount_minor')::bigint>balance OR balance<=0
  OR (_command->>'purpose'='full' AND (_command->>'amount_minor')::bigint<>balance) THEN
  RAISE EXCEPTION 'Payment amount or currency unavailable' USING ERRCODE='22023'; END IF;
 PERFORM public._sales_invoice_require_accepted_obligation(r,_command);
 -- PayPal must acquire its own proven merchant binding before this adapter is activated.
 IF _command->>'provider' IS DISTINCT FROM 'stripe' THEN RAISE EXCEPTION 'Payment provider unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.tenant_stripe_accounts WHERE tenant_id=_expected_tenant_id FOR UPDATE;
 IF NOT FOUND OR m.stripe_account_id IS DISTINCT FROM _command->>'merchant_account_id'
  OR m.binding_version IS DISTINCT FROM (_command->>'merchant_binding_version')::bigint
  OR m.provider_environment IS DISTINCT FROM _command->>'environment'
  OR NOT coalesce(m.charges_enabled AND m.payouts_enabled AND m.details_submitted AND m.sales_payment_permission,false)
  OR m.sales_readback_at IS NULL OR m.sales_readback_at<clock_timestamp()-interval '5 minutes' THEN
  RAISE EXCEPTION 'Payment merchant unavailable; refresh readiness' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.paige_invoice_provider_operations WHERE tenant_id=_expected_tenant_id AND invoice_id=r.id
  AND state IN ('prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown')) THEN
  RAISE EXCEPTION 'Payment request already in progress; reconcile it first' USING ERRCODE='55000'; END IF;
 INSERT INTO public.paige_invoice_provider_operations(id,tenant_id,invoice_id,client_id,actor_user_id,invoice_version,issued_snapshot_version,
  provider,merchant_account_id,merchant_binding_version,environment,amount_minor,currency,purpose,command,authority_fingerprint,idempotency_key)
 VALUES(_operation_id,_expected_tenant_id,r.id,r.contact_id,_actor_user_id,r.billing_lifecycle_version,r.billing_issued_snapshot_version,
  'stripe',m.stripe_account_id,m.binding_version,m.provider_environment,(_command->>'amount_minor')::bigint,lower(r.currency),_command->>'purpose',
  _command,_governance->>'approved_fingerprint','sales-payment-'||_operation_id::text) RETURNING * INTO op;
 -- This proves preparation only, not provider acceptance, a charge or settlement.
 PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,'sales_prepare_payment_request','capability_succeeded',md5(_operation_id::text||':prepared')::uuid,NULL);
 RETURN to_jsonb(op)-'dispatch_claim_token';
END $function$;

CREATE OR REPLACE FUNCTION public.claim_sales_invoice_payment_request(_expected_tenant_id uuid, _operation_id uuid, _claim_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE; r public.paige_invoices%ROWTYPE; m public.tenant_stripe_accounts%ROWTYPE; balance bigint;
BEGIN
 PERFORM public._sales_payment_operation_service();
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id;
 IF NOT FOUND OR _claim_token IS NULL THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public._sales_invoice_actor(op.actor_user_id,_expected_tenant_id);
 IF public.resolve_tool_autonomy(_expected_tenant_id,'sales_create_payment_request')='off' THEN
  RAISE EXCEPTION 'Payment request authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.paige_invoices WHERE id=op.invoice_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.paige_invoices WHERE id=op.invoice_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 IF op.state<>'prepared' THEN RAISE EXCEPTION 'Payment dispatch already claimed; reconcile existing operation' USING ERRCODE='55000'; END IF;
 SELECT * INTO m FROM public.tenant_stripe_accounts WHERE tenant_id=_expected_tenant_id FOR UPDATE;
 IF NOT FOUND OR m.stripe_account_id IS DISTINCT FROM op.merchant_account_id OR m.binding_version IS DISTINCT FROM op.merchant_binding_version
  OR m.provider_environment IS DISTINCT FROM op.environment OR NOT coalesce(m.charges_enabled AND m.payouts_enabled AND m.details_submitted AND m.sales_payment_permission,false)
  OR m.sales_readback_at IS NULL OR m.sales_readback_at<clock_timestamp()-interval '5 minutes' THEN
  RAISE EXCEPTION 'Payment merchant unavailable; refresh readiness' USING ERRCODE='42501'; END IF;
 balance:=public._sales_invoice_collectible_balance(r);
 PERFORM 1 FROM public.clients WHERE id=op.client_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 IF r.status<>'issued' OR r.contact_id IS DISTINCT FROM op.client_id OR r.billing_lifecycle_version IS DISTINCT FROM op.invoice_version
  OR r.billing_issued_snapshot_version IS DISTINCT FROM op.issued_snapshot_version OR lower(r.currency) IS DISTINCT FROM op.currency
  OR balance<op.amount_minor THEN RAISE EXCEPTION 'Invoice changed or unavailable for payment' USING ERRCODE='40001'; END IF;
 PERFORM public._sales_invoice_require_accepted_obligation(r,op.command);
 UPDATE public.paige_invoice_provider_operations SET state='dispatching',dispatch_claim_token=_claim_token,dispatch_started_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE id=op.id RETURNING * INTO op;
 PERFORM public.record_capability_run(_expected_tenant_id,op.actor_user_id,'sales_dispatch_payment_request','capability_succeeded',md5(op.id::text||':dispatching')::uuid,NULL);
 -- Server-only response. The claim token must never be forwarded to model/customer callers.
 RETURN to_jsonb(op);
END $function$;

CREATE OR REPLACE FUNCTION public.allocate_verified_sales_invoice_payment(_expected_tenant_id uuid,_operation_id uuid,_claim_token uuid,_readback jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE; invoice public.paige_invoices%ROWTYPE; merchant public.tenant_stripe_accounts%ROWTYPE;
 received_at timestamptz; remaining bigint; allocation uuid; verified_at timestamptz:=clock_timestamp();
BEGIN
 PERFORM public._sales_payment_operation_service();
 IF jsonb_typeof(_readback) IS DISTINCT FROM 'object' OR octet_length(_readback::text)>8000 OR (SELECT count(*) FROM jsonb_object_keys(_readback))<>15
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(_readback) k WHERE k NOT IN ('provider','merchant_account_id','environment','provider_object_id','provider_transaction_id','provider_settlement_id','amount_minor','currency','status','readback_reference','invoice_id','client_id','invoice_version','issued_snapshot_version','provider_received_at'))
  OR _readback->>'status' IS DISTINCT FROM 'verified' OR coalesce(_readback->>'provider_transaction_id','') !~ '^[A-Za-z0-9_-]{1,128}$'
  OR coalesce(_readback->>'provider_settlement_id','') !~ '^[A-Za-z0-9_-]{1,128}$' OR coalesce(_readback->>'readback_reference','') !~ '^[A-Za-z0-9_-]{1,200}$'
  OR coalesce(_readback->>'provider_received_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$' THEN
  RAISE EXCEPTION 'Invalid verified provider readback' USING ERRCODE='22023'; END IF;
 received_at:=(_readback->>'provider_received_at')::timestamptz;
 IF received_at>verified_at OR received_at<'1900-01-01'::timestamptz THEN RAISE EXCEPTION 'Invalid provider payment time' USING ERRCODE='22023'; END IF;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id;
 IF NOT FOUND OR _claim_token IS NULL OR op.dispatch_claim_token IS DISTINCT FROM _claim_token THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(op.id::text,81742));
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=op.invoice_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE id=_operation_id AND tenant_id=_expected_tenant_id FOR UPDATE;
 IF _readback->>'provider' IS DISTINCT FROM op.provider OR _readback->>'merchant_account_id' IS DISTINCT FROM op.merchant_account_id
  OR _readback->>'environment' IS DISTINCT FROM op.environment OR _readback->>'invoice_id' IS DISTINCT FROM op.invoice_id::text
  OR _readback->>'client_id' IS DISTINCT FROM op.client_id::text OR _readback->'invoice_version' IS DISTINCT FROM to_jsonb(op.invoice_version)
  OR _readback->'issued_snapshot_version' IS DISTINCT FROM to_jsonb(op.issued_snapshot_version)
  OR _readback->'amount_minor' IS DISTINCT FROM to_jsonb(op.amount_minor) OR _readback->>'currency' IS DISTINCT FROM op.currency
  OR coalesce(_readback->>'provider_object_id','') !~ '^[A-Za-z0-9_-]{1,128}$'
  OR (op.provider_object_id IS NOT NULL AND _readback->>'provider_object_id' IS DISTINCT FROM op.provider_object_id) THEN
  RAISE EXCEPTION 'Verified provider readback does not match operation' USING ERRCODE='22023'; END IF;
 IF op.state='settled' THEN
  -- Request IDs may change on a subsequent authenticated GET; the immutable transaction facts may not.
  IF (op.verified_readback-'readback_reference') IS DISTINCT FROM (_readback-'readback_reference') THEN
   RAISE EXCEPTION 'Verified settlement conflicts with existing allocation' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('operation_id',op.id,'state','settled','allocation_payment_id',op.allocation_payment_id,'replayed',true,
   'row',public._sales_invoice_read(_expected_tenant_id,op.invoice_id));
 END IF;
 IF op.state NOT IN ('dispatching','provider_accepted','customer_action_required','outcome_unknown') THEN RAISE EXCEPTION 'Payment request cannot settle in current state' USING ERRCODE='55000'; END IF;
 IF op.provider='stripe' THEN
  SELECT * INTO merchant FROM public.tenant_stripe_accounts WHERE tenant_id=_expected_tenant_id FOR SHARE;
  IF NOT FOUND OR merchant.stripe_account_id IS DISTINCT FROM op.merchant_account_id OR merchant.binding_version IS DISTINCT FROM op.merchant_binding_version
   OR merchant.provider_environment IS DISTINCT FROM op.environment THEN RAISE EXCEPTION 'Payment merchant binding changed; reconcile identity first' USING ERRCODE='42501'; END IF;
 ELSE
  -- PayPal's permission/readback binding must be integrated before allocation may be activated.
  RAISE EXCEPTION 'Payment merchant reconciliation unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.clients WHERE id=op.client_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND OR invoice.contact_id IS DISTINCT FROM op.client_id THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 IF invoice.status<>'issued' OR invoice.billing_lifecycle_version IS DISTINCT FROM op.invoice_version
  OR invoice.billing_issued_snapshot_version IS DISTINCT FROM op.issued_snapshot_version OR lower(invoice.currency) IS DISTINCT FROM op.currency THEN
  RAISE EXCEPTION 'Invoice changed before verified allocation' USING ERRCODE='40001'; END IF;
 remaining:=public._sales_invoice_collectible_balance(invoice);
 IF remaining<op.amount_minor THEN RAISE EXCEPTION 'Verified payment exceeds outstanding balance' USING ERRCODE='22023'; END IF;
 PERFORM public._sales_invoice_require_accepted_obligation(invoice,op.command);
 allocation:=md5(op.id::text||':allocation')::uuid;
 -- The fence closes only within this transaction. Receipt/version/Rail failure restores it.
 UPDATE public.paige_invoice_provider_operations SET state='settled',provider_object_id=_readback->>'provider_object_id',provider_status='verified',
  verified_readback=_readback,settled_at=received_at,allocation_payment_id=allocation,updated_at=verified_at WHERE id=op.id;
 INSERT INTO public.paige_invoice_payments(id,tenant_id,invoice_id,actor_user_id,kind,amount_cents,currency,method,received_at,evidence_kind,
  provider_operation_id,provider,merchant_account_id,provider_environment,provider_transaction_id,provider_settlement_id,provider_verified_at)
 VALUES(allocation,_expected_tenant_id,invoice.id,op.actor_user_id,'receipt',op.amount_minor::integer,op.currency,op.provider,received_at,'provider_verified',
  op.id,op.provider,op.merchant_account_id,op.environment,_readback->>'provider_transaction_id',_readback->>'provider_settlement_id',verified_at);
 UPDATE public.paige_invoices SET billing_lifecycle_version=billing_lifecycle_version+1,updated_at=verified_at WHERE id=invoice.id AND tenant_id=_expected_tenant_id;
 -- Provider reconciliation is a system fact, not a fresh act by the original owner.
 -- Keep that author on the immutable operation/receipt; use the canonical private
 -- writer only inside this narrow service-only SECURITY DEFINER transaction.
 PERFORM public._record_workspace_rail_event(_expected_tenant_id,NULL,'capability_run',md5(op.id::text||':settlement')::uuid,0,'capability_succeeded',NULL,'sales_verify_payment_settlement');
 PERFORM public._record_workspace_rail_event(_expected_tenant_id,NULL,'capability_run',allocation,0,'capability_succeeded',NULL,'sales_allocate_payment');
 PERFORM public.settle_sales_payment_reconciliation_work(_expected_tenant_id,op.id);
 RETURN jsonb_build_object('operation_id',op.id,'state','settled','allocation_payment_id',allocation,'replayed',false,'row',public._sales_invoice_read(_expected_tenant_id,invoice.id));
END $$;

CREATE OR REPLACE FUNCTION public.read_sales_invoice_payment_obligation(
 _actor_user_id uuid,_expected_tenant_id uuid,_invoice_id uuid,_reference jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $payment_read$
DECLARE invoice public.paige_invoices%ROWTYPE; observation jsonb; obligation jsonb; selector jsonb;
 financial_mode boolean:=coalesce(_reference ? 'financial_evidence_version',false);
BEGIN
 PERFORM public._sales_payment_operation_service();
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF financial_mode THEN
  IF pg_catalog.jsonb_typeof(_reference) IS DISTINCT FROM 'object' OR pg_catalog.octet_length(_reference::text)>4000
   OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(_reference))<>2
   OR _reference-ARRAY['financial_evidence_version','reference']<>'{}'::jsonb
   OR _reference->'financial_evidence_version' IS DISTINCT FROM '3'::jsonb THEN
   RAISE EXCEPTION 'Invalid payment financial context request' USING ERRCODE='22023';END IF;
  selector:=CASE WHEN _reference->'reference'='null'::jsonb THEN NULL ELSE _reference->'reference' END;
 ELSE selector:=_reference;END IF;
 IF (NOT financial_mode OR selector IS NOT NULL) AND (pg_catalog.jsonb_typeof(selector) IS DISTINCT FROM 'object'
  OR coalesce(selector->>'signing_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
  RAISE EXCEPTION 'Invalid accepted payment selector' USING ERRCODE='22023';
 END IF;
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=_invoice_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 IF financial_mode AND (invoice.status IS DISTINCT FROM 'issued' OR invoice.billing_issued_snapshot_version IS NULL
  OR invoice.billing_issued_at IS NULL OR invoice.billing_document IS NULL) THEN
  RAISE EXCEPTION 'Invoice changed or unavailable for payment' USING ERRCODE='40001';END IF;
 SELECT b.financial_position INTO STRICT observation FROM public._sales_invoice_financial_position_rows(invoice.tenant_id,invoice.id,3,NULL::jsonb) b;
 IF observation->>'financial_standing' IS DISTINCT FROM 'recorded' THEN
  RAISE EXCEPTION 'Accepted payment obligation unavailable; review again' USING ERRCODE='40001';
 END IF;
 IF selector IS NOT NULL THEN
 SELECT pg_catalog.jsonb_build_object('reference',item.value->'reference','source_digest',item.value->'source_digest',
  'due_date',item.value->'due_date','scheduled_minor',item.value->'scheduled_minor','remaining_minor',item.value->'actual_outstanding_minor')
 INTO obligation FROM pg_catalog.jsonb_array_elements(observation->'obligations') item
  WHERE item.value->'reference'=selector;
 IF NOT FOUND THEN RAISE EXCEPTION 'Accepted payment obligation changed; review again' USING ERRCODE='40001'; END IF;
 END IF;
 PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
 IF financial_mode THEN
  RETURN pg_catalog.jsonb_build_object('financial_evidence_version',3,'tenant_id',invoice.tenant_id,'client_id',invoice.contact_id,
   'invoice_id',invoice.id,'invoice_version',invoice.billing_lifecycle_version,'issued_snapshot_version',invoice.billing_issued_snapshot_version,
   'status',invoice.status,'currency',pg_catalog.lower(invoice.currency),'financial_standing',observation->'financial_standing',
   'actual_outstanding_minor',observation->'actual_outstanding_minor','refund_payable_minor',observation->'refund_payable_minor',
   'source_hash',observation->'financial_source_hash','obligation',obligation);
 END IF;
 RETURN pg_catalog.jsonb_build_object('tenant_id',invoice.tenant_id,'client_id',invoice.contact_id,
  'invoice_id',invoice.id,'invoice_version',invoice.billing_lifecycle_version,
  'issued_snapshot_version',invoice.billing_issued_snapshot_version,'obligation',obligation);
END $payment_read$;

CREATE OR REPLACE FUNCTION public._sales_invoice_payment_request_mutation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid; invoice uuid; payment public.paige_invoice_provider_operations%ROWTYPE; observation public.paige_invoice_operations%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='paige_invoice_payments' THEN
  tenant:=NEW.tenant_id; invoice:=NEW.invoice_id;
  PERFORM 1 FROM public.paige_invoices WHERE id=invoice AND tenant_id=tenant FOR UPDATE;
 ELSE
  IF TG_OP='UPDATE' AND ROW(NEW.billing_lifecycle_version,NEW.status) IS NOT DISTINCT FROM ROW(OLD.billing_lifecycle_version,OLD.status) THEN RETURN NEW; END IF;
  tenant:=OLD.tenant_id; invoice:=OLD.id;
 END IF;
 IF EXISTS(SELECT 1 FROM public.paige_invoice_provider_operations WHERE tenant_id=tenant AND invoice_id=invoice
  AND state IN ('prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown')) THEN
  -- A real provider observation must remain recordable while a later request
  -- is pending. Only its exact invoice-version advance is exempt; no receipt,
  -- state, signed document, customer or economic write passes this branch.
  IF TG_TABLE_NAME='paige_invoices' AND TG_OP='UPDATE' THEN
   IF NEW.billing_lifecycle_version=OLD.billing_lifecycle_version+1
   AND (to_jsonb(NEW)-ARRAY['billing_lifecycle_version','updated_at'])
    IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['billing_lifecycle_version','updated_at']) THEN
   PERFORM public._sales_payment_operation_service();
   FOR payment IN SELECT p.* FROM public.paige_invoice_provider_operations p
    JOIN public.paige_invoice_operations e ON e.id=p.provider_observation_operation_id
     AND e.tenant_id=p.tenant_id AND e.invoice_id=p.invoice_id
    WHERE p.tenant_id=tenant AND p.invoice_id=invoice AND p.state='settled'
     AND p.provider_observation_version>0
     AND e.result->'invoice_version'=to_jsonb(NEW.billing_lifecycle_version) LOOP
    SELECT * INTO STRICT observation FROM public.paige_invoice_operations e WHERE e.id=payment.provider_observation_operation_id;
    PERFORM public._sales_provider_observation_entry(payment,observation,payment.provider_observation_version-1,true);
    RETURN NEW;
   END LOOP;
   END IF;
  END IF;
  RAISE EXCEPTION 'Payment request is unresolved. Reconcile or expire it before changing invoice payments or state.' USING ERRCODE='P5501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.record_sales_invoice_provider_observation(_expected_tenant_id uuid,_operation_id uuid,_claim_token uuid,
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
  -- A complete readback cannot silently discard a previously verified refund
  -- or dispute. Missing facts are unavailable evidence, never restored cash.
  if exists(select 1 from jsonb_array_elements(prior.command#>'{snapshot,refunds}') old_fact
    where not exists(select 1 from jsonb_array_elements(snapshot->'refunds') current_fact
     where current_fact.value->'id'=old_fact.value->'id'))
   or exists(select 1 from jsonb_array_elements(prior.command#>'{snapshot,disputes}') old_fact
    where not exists(select 1 from jsonb_array_elements(snapshot->'disputes') current_fact
     where current_fact.value->'id'=old_fact.value->'id')) then
   raise exception 'Provider observation incomplete; reconcile the original verified history' using errcode='55000';end if;
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

 perform public._record_workspace_rail_event(op.tenant_id,null,'capability_run',identity,0,'capability_succeeded',null,
  'sales_payment_reconcile',null,null,null,jsonb_build_object('effect','provider_observation_only','observation_id',identity,
   'provider_operation_id',op.id,'source_hash',source_hash));
 update public.paige_invoices set billing_lifecycle_version=billing_lifecycle_version+1,updated_at=clock_timestamp() where id=i.id;
 perform public._sales_provider_observation_entry(op,prior,_expected_observation_version,true);
 return result||jsonb_build_object('replayed',false,'current_observation_version',_expected_observation_version+1,'is_current',true);
end $$;
-- END ORIGINAL SOURCE exp04_invoice_financial_collectibility.sql

-- BEGIN ORIGINAL SOURCE exp04_invoice_manual_financial_write.sql
-- INERT O5 companion. Original manual record/correction/target/preview/receipt only.

-- Depends on the existing actual-position and collectibility candidates. No provider

-- call, second balance, receipt store, permission grant or production activation.

DO $manual_source$

DECLARE r record;p pg_proc%ROWTYPE;

BEGIN

 FOR r IN SELECT * FROM (VALUES

('public._sales_invoice_require_manual_allocations(public.paige_invoices,jsonb)','e176660d985e862db589fc11d9c2d4fa','59e7d7273b26ddd8487a649f302c525e',false,'void','search_path=""','{postgres=X/postgres}',ARRAY['_invoice','_command']),
('public._sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)','72ff0f531dced2bcec5d675f7d09a97c','32d720cfc173d16bef0564abbf26d6f2',true,'jsonb','search_path=pg_catalog, public','{postgres=X/postgres}',ARRAY['_actor_user_id','_expected_tenant_id','_operation_id','_command','_governance']),
('public._sales_invoice_prior_preview(uuid,uuid,jsonb)','88a9d11a25e67257e215999a18092e2c','cae753fff111f8b5697abf86350328ea',true,'jsonb','search_path=pg_catalog, public','{postgres=X/postgres}',ARRAY['_actor_user_id','_expected_tenant_id','_command']),
('public._preview_sales_invoice_before_provider(uuid,uuid,jsonb)','8a348d0712cd814427ff05cab0a090bd','0984be5b78c147cd16a3c3319f27531a',true,'jsonb','search_path=pg_catalog, public','{postgres=X/postgres}',ARRAY['_actor_user_id','_expected_tenant_id','_command']),
('public.read_sales_invoice_command_result(uuid,uuid,uuid,jsonb)','8bed0f4bf7912e11e8e3f5bb820b2d93','56ec1895857826f62c786f6f7287fdd9',true,'jsonb','search_path=pg_catalog, public','{postgres=X/postgres,service_role=X/postgres}',ARRAY['_actor_user_id','_expected_tenant_id','_operation_id','_command'])

 ) x(signature,before_hash,after_hash,definer,result_type,setting,acl,args) LOOP

 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);

 IF NOT FOUND OR md5(p.prosrc) NOT IN(r.before_hash,r.after_hash) OR pg_get_userbyid(p.proowner)<>'postgres'

  OR p.prosecdef IS DISTINCT FROM r.definer OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u'

  OR p.pronargdefaults<>0 OR p.prorettype IS DISTINCT FROM to_regtype(r.result_type) OR p.proretset

  OR p.proconfig IS DISTINCT FROM ARRAY[r.setting] OR p.proacl::text IS DISTINCT FROM r.acl OR p.proargnames IS DISTINCT FROM r.args THEN

  RAISE EXCEPTION 'Original manual financial source/authority changed; reconcile before applying' USING ERRCODE='23514';END IF;

 END LOOP;

 FOR r IN SELECT * FROM (VALUES

 ('public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)','bdb0960fa3d88b21cca90b79636dc7e1'),

 ('public._sales_invoice_collectible_balance(public.paige_invoices)','97ad63a1e9284ae38d8fade870f1c119')

 ) x(signature,body_hash) LOOP

 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);

 IF NOT FOUND OR md5(p.prosrc)<>r.body_hash OR pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef OR p.proisstrict

  OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0

  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN

  RAISE EXCEPTION 'Original actual financial dependency changed; reconcile before applying' USING ERRCODE='23514';END IF;

 END LOOP;

END $manual_source$;



CREATE OR REPLACE FUNCTION public._sales_invoice_require_manual_allocations(_invoice public.paige_invoices,_command jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $require$
DECLARE allocations jsonb; observation jsonb; item jsonb;
BEGIN
 allocations:=public._sales_invoice_manual_allocation_intent(_command);
 IF allocations IS NULL THEN RETURN; END IF;
 IF _command->>'invoice_id' IS DISTINCT FROM _invoice.id::text
  OR _command->'expected_version' IS DISTINCT FROM pg_catalog.to_jsonb(_invoice.billing_lifecycle_version)
  OR _command->>'currency' IS DISTINCT FROM pg_catalog.lower(_invoice.currency) THEN
  RAISE EXCEPTION 'Accepted payment allocation changed; review again' USING ERRCODE='40001'; END IF;
 SELECT b.financial_position INTO STRICT observation FROM public._sales_invoice_financial_position_rows(_invoice.tenant_id,_invoice.id,3,NULL::jsonb) b;
 IF observation->>'financial_standing' IS DISTINCT FROM 'recorded' THEN
  RAISE EXCEPTION 'Accepted payment allocation unavailable; inspect original receipts' USING ERRCODE='40001'; END IF;
 FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(allocations) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(observation->'obligations') o WHERE pg_catalog.jsonb_build_object('reference',o.value->'reference','source_digest',o.value->'source_digest','due_date',o.value->'due_date','scheduled_minor',o.value->'scheduled_minor','remaining_minor',o.value->'actual_outstanding_minor')=item->'obligation') THEN
   RAISE EXCEPTION 'Accepted payment allocation changed; review again' USING ERRCODE='40001'; END IF;
 END LOOP;
END $require$;

CREATE OR REPLACE FUNCTION public._sales_invoice_prior_execute(_actor_user_id uuid, _expected_tenant_id uuid, _operation_id uuid, _command jsonb, _governance jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.paige_invoices%ROWTYPE; receipt public.paige_invoice_payments%ROWTYPE; result jsonb; prior jsonb;
  action text:=_command->>'action'; tool text; amount bigint; received bigint; document jsonb; client jsonb; tenant jsonb;
  grant_id uuid; expiry timestamptz; hash text; scope text; allowed text[]; expected bigint;
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  IF _operation_id IS NULL OR jsonb_typeof(_command) IS DISTINCT FROM 'object' OR octet_length(_command::text)>(CASE WHEN action='invoice.record_manual_payment' AND _command ? 'allocations' THEN 131072 ELSE 8000 END) THEN
    RAISE EXCEPTION 'Invalid invoice command' USING ERRCODE='22023'; END IF;
  tool:=CASE action WHEN 'invoice.publish' THEN 'sales_publish_invoice' WHEN 'invoice.record_manual_payment' THEN 'sales_record_manual_payment'
    WHEN 'invoice.reverse_manual_payment' THEN 'sales_reverse_manual_payment' WHEN 'invoice.void' THEN 'sales_void_invoice'
    WHEN 'invoice.link_create' THEN 'sales_create_invoice_link' END;
  IF tool IS NULL THEN RAISE EXCEPTION 'Unknown invoice action' USING ERRCODE='22023'; END IF;
  PERFORM public._sales_invoice_governance(_actor_user_id,_expected_tenant_id,action,tool,_governance);
  allowed:=ARRAY['action','invoice_id','expected_version','template'];
  IF action='invoice.record_manual_payment' THEN allowed:=allowed||ARRAY['amount_cents','currency','method','received_at','reference','notes','allocations'];
  ELSIF action='invoice.reverse_manual_payment' THEN allowed:=allowed||ARRAY['payment_id','reason'];
  ELSIF action='invoice.void' THEN allowed:=allowed||ARRAY['reason'];
  ELSIF action='invoice.link_create' THEN allowed:=allowed||ARRAY['expires_in_days','grant_scope','delivery_operation_id']; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(_command) k WHERE NOT(k=ANY(allowed)))
    OR coalesce(_command->>'expected_version','') !~ '^[1-9][0-9]{0,17}$' THEN RAISE EXCEPTION 'Invalid invoice fields' USING ERRCODE='22023'; END IF;
  expected:=(_command->>'expected_version')::bigint;
  PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,81742));
  prior:=public.read_sales_invoice_command_result(_actor_user_id,_expected_tenant_id,_operation_id,_command);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF EXISTS(SELECT 1 FROM public.messages WHERE meta#>>'{sales_invoice_binding,operation_id}'=_operation_id::text) THEN
    RAISE EXCEPTION 'Operation already belongs to invoice delivery' USING ERRCODE='22023'; END IF;
  IF action IN ('invoice.record_manual_payment','invoice.reverse_manual_payment') AND EXISTS(
   SELECT 1 FROM public.paige_workspace_events e WHERE e.tenant_id=_expected_tenant_id AND e.source_kind='capability_run'
    AND e.source_id=_operation_id AND (e.actor_id IS DISTINCT FROM _actor_user_id OR e.capability_key IS DISTINCT FROM tool
     OR e.source_revision IS DISTINCT FROM 0 OR e.outcome='capability_succeeded')) THEN
   RAISE EXCEPTION 'Operation already belongs to another action' USING ERRCODE='22023';END IF;
  SELECT * INTO r FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id AND billing_draft_version IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  IF coalesce(r.billing_lifecycle_version,r.billing_draft_version)<>expected THEN RAISE EXCEPTION 'Invoice version conflict' USING ERRCODE='40001'; END IF;
  IF action='invoice.publish' THEN
    IF r.status<>'draft' OR r.billing_issued_at IS NOT NULL OR r.amount_total_cents<1 OR lower(r.currency)<>'usd'
      OR (r.billing_draft->'schema_version' IS DISTINCT FROM '2'::jsonb AND r.billing_draft->'schema_version' IS DISTINCT FROM '3'::jsonb) OR nullif(r.billing_draft->>'due_date','') IS NULL THEN RAISE EXCEPTION 'Complete this draft before publication' USING ERRCODE='22023'; END IF;
    IF jsonb_array_length(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb))<1 OR r.billing_draft->>'processor_intent' IS NOT NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb)) m
      WHERE m NOT IN ('zelle','cash','wire','check','bank_transfer','other')) THEN
      RAISE EXCEPTION 'Online merchant issuance is unavailable; choose off-platform methods' USING ERRCODE='22023'; END IF;
    SELECT to_jsonb(c) INTO client FROM public.clients c WHERE id=r.contact_id AND tenant_id=_expected_tenant_id;
    SELECT to_jsonb(t) INTO tenant FROM public.tenants t WHERE id=_expected_tenant_id;
    document:=jsonb_build_object('renderer_version','paige-invoice-html-v1','invoice_number',r.invoice_number,'published_at',now(),
      'issuer_name',coalesce(nullif(tenant->>'name',''),nullif(tenant->>'business_name',''),'Business'),
      'client_name',coalesce(nullif(client->>'entity_name',''),nullif(trim(coalesce(client->>'first_name','')||' '||coalesce(client->>'last_name','')),''),'Client'),
      'snapshot',r.billing_draft,'total_cents',r.amount_total_cents,'currency','usd');
    UPDATE public.paige_invoices SET status='issued',billing_lifecycle_version=expected+1,billing_issued_snapshot_version=billing_draft_version,
      billing_issued_at=now(),billing_issued_by=_actor_user_id,billing_document=document,
      billing_document_digest=encode(extensions.digest(convert_to(document::text,'UTF8'),'sha256'),'hex') WHERE id=r.id;
  ELSE
    IF r.status<>'issued' THEN RAISE EXCEPTION 'Invoice is not active' USING ERRCODE='22023'; END IF;
    IF action='invoice.record_manual_payment' THEN
      IF coalesce(_command->>'amount_cents','') !~ '^[1-9][0-9]{0,9}$' OR _command->>'currency' IS DISTINCT FROM 'usd'
        OR coalesce(_command->>'method','') NOT IN ('zelle','cash','wire','check','bank_transfer','other')
        OR nullif(_command->>'received_at','') IS NULL OR length(_command->>'reference')>200 OR length(_command->>'notes')>2000 THEN
        RAISE EXCEPTION 'Check payment amount, method, currency and date' USING ERRCODE='22023'; END IF;
      amount:=(_command->>'amount_cents')::bigint;
      IF amount>2147483647 OR amount>public._sales_invoice_collectible_balance(r) THEN RAISE EXCEPTION 'Payment exceeds outstanding balance' USING ERRCODE='22023'; END IF;
      IF (_command->>'received_at')::timestamptz>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Received date cannot be in the future' USING ERRCODE='22023'; END IF;
      PERFORM public._sales_invoice_require_manual_allocations(r,_command);
      INSERT INTO public.paige_invoice_payments(id,tenant_id,invoice_id,actor_user_id,kind,amount_cents,currency,method,received_at,reference,notes)
        VALUES(_operation_id,_expected_tenant_id,r.id,_actor_user_id,'receipt',amount,'usd',_command->>'method',(_command->>'received_at')::timestamptz,_command->>'reference',_command->>'notes');
    ELSIF action='invoice.reverse_manual_payment' THEN
      IF coalesce(length(trim(_command->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Explain the correction' USING ERRCODE='22023'; END IF;
      SELECT * INTO receipt FROM public.paige_invoice_payments WHERE id=(_command->>'payment_id')::uuid AND tenant_id=_expected_tenant_id AND invoice_id=r.id AND kind='receipt';
      IF NOT FOUND OR EXISTS(SELECT 1 FROM public.paige_invoice_payments WHERE reverses_payment_id=receipt.id) THEN
        RAISE EXCEPTION 'Receipt unavailable or already reversed' USING ERRCODE='22023'; END IF;
      IF receipt.evidence_kind IS DISTINCT FROM 'manual_recorded' OR receipt.provider_operation_id IS NOT NULL OR receipt.provider_environment IS NOT NULL THEN
        RAISE EXCEPTION 'Provider payments require their original provider reconciliation; manual correction cannot reverse them' USING ERRCODE='22023'; END IF;
      INSERT INTO public.paige_invoice_payments(id,tenant_id,invoice_id,actor_user_id,kind,amount_cents,currency,method,received_at,reverses_payment_id,reason)
        VALUES(_operation_id,_expected_tenant_id,r.id,_actor_user_id,'reversal',receipt.amount_cents,receipt.currency,receipt.method,receipt.received_at,receipt.id,_command->>'reason');
    ELSIF action='invoice.void' THEN
      IF coalesce(length(trim(_command->>'reason')),0) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Explain why this invoice is void' USING ERRCODE='22023'; END IF;
      UPDATE public.paige_invoices SET status='void' WHERE id=r.id;
      UPDATE public.paige_invoice_access_grants SET revoked_at=now() WHERE invoice_id=r.id AND revoked_at IS NULL;
    ELSIF action='invoice.link_create' THEN
      IF coalesce(_command->>'expires_in_days','') !~ '^[1-9][0-9]?$' OR (_command->>'expires_in_days')::integer>30 THEN
        RAISE EXCEPTION 'Link expiry must be between one and 30 days' USING ERRCODE='22023'; END IF;
      scope:=coalesce(_command->>'grant_scope','share');
      IF scope<>'share' OR _command ? 'delivery_operation_id' THEN RAISE EXCEPTION 'Delivery grants use the governed sender' USING ERRCODE='22023'; END IF;
      hash:=_governance#>>'{generated_link,token_hash}';grant_id:=(_governance#>>'{generated_link,grant_id}')::uuid;
      IF coalesce(hash,'') !~ '^[0-9a-f]{64}$' OR grant_id IS NULL THEN RAISE EXCEPTION 'Trusted link material required' USING ERRCODE='42501'; END IF;
      expiry:=now()+make_interval(days=(_command->>'expires_in_days')::integer);
      UPDATE public.paige_invoice_access_grants SET revoked_at=now() WHERE tenant_id=_expected_tenant_id AND invoice_id=r.id AND scope='share' AND revoked_at IS NULL;
      INSERT INTO public.paige_invoice_access_grants(id,tenant_id,invoice_id,issued_snapshot_version,scope,token_hash,expires_at,actor_user_id)
        VALUES(grant_id,_expected_tenant_id,r.id,r.billing_issued_snapshot_version,'share',hash,expiry,_actor_user_id);
    END IF;
    UPDATE public.paige_invoices SET billing_lifecycle_version=expected+1 WHERE id=r.id;
  END IF;
  PERFORM public.record_capability_run(_expected_tenant_id,_actor_user_id,tool,'capability_succeeded',_operation_id,NULL);
  IF action IN ('invoice.record_manual_payment','invoice.reverse_manual_payment') AND NOT EXISTS(
   SELECT 1 FROM public.paige_workspace_events e WHERE e.tenant_id=_expected_tenant_id AND e.actor_id=_actor_user_id
    AND e.source_kind='capability_run' AND e.source_id=_operation_id AND e.source_revision=0
    AND e.outcome='capability_succeeded' AND e.capability_key=tool) THEN
   RAISE EXCEPTION 'Original manual invoice receipt unavailable' USING ERRCODE='55000';END IF;
  result:=jsonb_build_object('ok',true,'row',public._sales_invoice_read(_expected_tenant_id,r.id),'operation',jsonb_build_object('id',_operation_id,'action',action));
  IF action='invoice.link_create' THEN result:=result||jsonb_build_object('link',jsonb_build_object('grant_id',grant_id,'expires_at',expiry,'token_returned',false,'link_recovery_required',true)); END IF;
  INSERT INTO public.paige_invoice_operations(id,tenant_id,invoice_id,actor_user_id,command,result) VALUES(_operation_id,_expected_tenant_id,r.id,_actor_user_id,_command,result);
  RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public._sales_invoice_prior_preview(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.paige_invoices%ROWTYPE; facts jsonb; eligible boolean:=false; summary text; receipt public.paige_invoice_payments%ROWTYPE; amount bigint; financial jsonb;
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  SELECT * INTO r FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id AND billing_draft_version IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
  IF coalesce(r.billing_lifecycle_version,r.billing_draft_version) IS DISTINCT FROM (_command->>'expected_version')::bigint
    THEN RAISE EXCEPTION 'Invoice version conflict' USING ERRCODE='40001'; END IF;
  facts:=public._sales_invoice_read(_expected_tenant_id,r.id);
  IF _command->>'action' IN ('invoice.record_manual_payment','invoice.reverse_manual_payment') AND r.status='issued' THEN
   BEGIN
    SELECT b.financial_position INTO STRICT financial FROM public._sales_invoice_financial_position_rows(_expected_tenant_id,r.id,3,NULL::jsonb) b;
   EXCEPTION WHEN SQLSTATE '55000' THEN financial:=NULL;
   END;
   facts:=facts||jsonb_build_object('remaining_cents',CASE WHEN financial->>'financial_standing'='recorded' THEN financial->'actual_outstanding_minor' END);
  END IF;
  CASE _command->>'action'
  WHEN 'invoice.publish' THEN
    eligible:=r.status='draft' AND r.billing_draft->'schema_version' IN ('2'::jsonb,'3'::jsonb) AND r.amount_total_cents>0
      AND nullif(r.billing_draft->>'due_date','') IS NOT NULL AND r.billing_draft->>'processor_intent' IS NULL
      AND jsonb_array_length(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb))>0
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(r.billing_draft->'payment_method_intents','[]'::jsonb)) m WHERE m NOT IN ('zelle','cash','wire','check','bank_transfer','other'));
    summary:='Publish the saved invoice as a frozen off-platform obligation. No email, online charge or payment receipt is created.';
  WHEN 'invoice.record_manual_payment' THEN
    IF coalesce(_command->>'amount_cents','') ~ '^[1-9][0-9]{0,9}$' THEN amount:=(_command->>'amount_cents')::bigint; END IF;
    eligible:=r.status='issued' AND financial->>'financial_standing'='recorded' AND amount>0 AND amount<=2147483647 AND amount<=(facts->>'remaining_cents')::bigint AND _command->>'currency'='usd'
      AND coalesce(_command->>'method','') IN ('zelle','cash','wire','check','bank_transfer','other');
    summary:='Review the reported human receipt against current payment evidence and original assignments.';
  WHEN 'invoice.reverse_manual_payment' THEN
    SELECT * INTO receipt FROM public.paige_invoice_payments WHERE id=(_command->>'payment_id')::uuid AND invoice_id=r.id AND tenant_id=_expected_tenant_id AND kind='receipt';
    eligible:=FOUND AND r.status='issued' AND coalesce(length(trim(_command->>'reason')),0) BETWEEN 1 AND 500
      AND NOT EXISTS(SELECT 1 FROM public.paige_invoice_payments WHERE reverses_payment_id=receipt.id);
    summary:='Append a correction reversing '||coalesce(receipt.amount_cents::text,'the unavailable receipt')||' USD cents. Original receipt remains in history; no money is refunded.';
  WHEN 'invoice.void' THEN
    eligible:=r.status='issued' AND coalesce(length(trim(_command->>'reason')),0) BETWEEN 1 AND 500;
    summary:='Void this obligation and revoke its customer links. Existing human-recorded receipts remain visible; this does not refund a payment.';
  WHEN 'invoice.link_create' THEN
    eligible:=r.status='issued' AND coalesce(_command->>'expires_in_days','') ~ '^[1-9][0-9]?$'
      AND (_command->>'expires_in_days')::integer<=30 AND coalesce(_command->>'grant_scope','share')='share';
    summary:='Create an expiring customer-access link. Previous share links are revoked; delivery links remain independent. No email is sent.';
  ELSE RAISE EXCEPTION 'Unknown invoice action' USING ERRCODE='22023';
  END CASE;
  RETURN (CASE WHEN _command->>'action' IN ('invoice.record_manual_payment','invoice.reverse_manual_payment') THEN
    jsonb_build_object('manual_financial',jsonb_build_object('financial_evidence_version',3,'financial_standing',CASE WHEN financial->>'financial_standing'='recorded' THEN 'recorded' ELSE 'needs_review' END,'refund_payable_minor',financial->'refund_payable_minor')) ELSE '{}'::jsonb END)||jsonb_build_object('invoice_id',r.id,'invoice_number',r.invoice_number,'version',facts->'version','issued_snapshot_version',r.billing_issued_snapshot_version,
    'document_input_digest',r.billing_document_digest,'amount_cents',r.amount_total_cents,'remaining_cents',facts->'remaining_cents',
    'currency',lower(r.currency),'status',r.status,'action',_command->>'action','eligible',coalesce(eligible,false),'summary',summary);
END $$;

CREATE OR REPLACE FUNCTION public._preview_sales_invoice_before_provider(_actor_user_id uuid,_expected_tenant_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; invoice public.paige_invoices%ROWTYPE; receipt public.paige_invoice_payments%ROWTYPE; amount bigint; balance bigint; date_label text; method_label text; invoice_label text; current_label text; financial jsonb;
BEGIN
 result:=public._sales_invoice_preview_before_payment_breakdown(_actor_user_id,_expected_tenant_id,_command);
 IF _command->>'action' IN ('invoice.record_manual_payment','invoice.reverse_manual_payment') THEN
  SELECT * INTO invoice FROM public.paige_invoices WHERE id=(_command->>'invoice_id')::uuid AND tenant_id=_expected_tenant_id;
  balance:=(result->>'remaining_cents')::bigint;financial:=result->'manual_financial';
  current_label:=CASE WHEN financial->>'financial_standing'='recorded' THEN
   format('Current outstanding: $%s USD.',to_char(balance::numeric/100,'FM999999999999990.00'))
   ||CASE WHEN (financial->>'refund_payable_minor')::bigint>0 THEN
    format(' A separate $%s USD refund is owed.',to_char((financial->>'refund_payable_minor')::numeric/100,'FM999999999999990.00')) ELSE '' END
   ELSE 'The current balance needs payment evidence and assignment verification.' END;
  IF result->>'eligible' IS DISTINCT FROM 'true' THEN
   RETURN result||jsonb_build_object('summary',current_label||' Review this invoice before recording or correcting a receipt.');END IF;
  invoice_label:=CASE WHEN invoice.invoice_number LIKE 'DRAFT-%' THEN 'previously issued invoice' ELSE 'invoice '||invoice.invoice_number END;
  IF _command->>'action'='invoice.record_manual_payment' THEN
   amount:=(_command->>'amount_cents')::bigint; date_label:=to_char((_command->>'received_at')::timestamptz AT TIME ZONE 'UTC','FMMonth DD, YYYY')||' (UTC)';
   method_label:=initcap(replace(_command->>'method','_',' '));
   result:=jsonb_set(result,'{summary}',to_jsonb(format('Record $%s USD received by %s on %s for %s. %s This is a human-recorded payment, without provider verification or money movement.',
    to_char(amount::numeric/100,'FM999999999999990.00'),method_label,date_label,invoice_label,current_label)));
  ELSE
   SELECT * INTO receipt FROM public.paige_invoice_payments WHERE id=(_command->>'payment_id')::uuid AND tenant_id=_expected_tenant_id AND invoice_id=invoice.id;
   result:=jsonb_set(result,'{summary}',to_jsonb(format('Reverse the recorded $%s USD payment for %s. %s This corrects the business record without refunding or transferring money.',
    to_char(receipt.amount_cents::numeric/100,'FM999999999999990.00'),invoice_label,current_label)));
  END IF;
 END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.read_sales_invoice_command_result(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_operations%ROWTYPE; invoice public.paige_invoices%ROWTYPE; payment public.paige_invoice_payments%ROWTYPE;
BEGIN
  PERFORM public._sales_invoice_actor(_actor_user_id,_expected_tenant_id);
  SELECT * INTO op FROM public.paige_invoice_operations WHERE id=_operation_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF op.actor_user_id IS DISTINCT FROM _actor_user_id OR op.tenant_id IS DISTINCT FROM _expected_tenant_id OR op.command IS DISTINCT FROM _command
    THEN RAISE EXCEPTION 'Operation reused with different input' USING ERRCODE='22023'; END IF;
  IF op.command->>'action'='invoice.record_provider_disposition' THEN
   PERFORM public._sales_invoice_provider_disposition_receipt(op);
  END IF;
  IF op.command->>'action' IN ('invoice.record_manual_payment','invoice.reverse_manual_payment') THEN
   IF op.result->'ok' IS DISTINCT FROM 'true'::jsonb OR op.result#>>'{operation,id}' IS DISTINCT FROM op.id::text
    OR op.result#>>'{operation,action}' IS DISTINCT FROM op.command->>'action' OR NOT EXISTS(
     SELECT 1 FROM public.paige_workspace_events e WHERE e.tenant_id=op.tenant_id AND e.actor_id=op.actor_user_id
      AND e.source_kind='capability_run' AND e.source_id=op.id AND e.source_revision=0 AND e.outcome='capability_succeeded'
      AND e.capability_key=(CASE op.command->>'action' WHEN 'invoice.record_manual_payment' THEN 'sales_record_manual_payment' ELSE 'sales_reverse_manual_payment' END)) THEN
    RAISE EXCEPTION 'Original manual invoice receipt unavailable' USING ERRCODE='55000';END IF;
   SELECT * INTO invoice FROM public.paige_invoices i WHERE i.id=op.invoice_id AND i.tenant_id=op.tenant_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Original manual invoice receipt unavailable' USING ERRCODE='55000';END IF;
   SELECT * INTO payment FROM public.paige_invoice_payments p WHERE p.id=op.id AND p.invoice_id=op.invoice_id
    AND p.tenant_id=op.tenant_id AND p.actor_user_id=op.actor_user_id AND p.evidence_kind='manual_recorded'
    AND p.provider_operation_id IS NULL AND p.provider_environment IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'Original manual invoice receipt unavailable' USING ERRCODE='55000';END IF;
   IF op.command->>'action'='invoice.record_manual_payment' THEN
    PERFORM public._sales_invoice_manual_receipt_allocations(invoice,payment);
   ELSIF payment.kind IS DISTINCT FROM 'reversal' OR payment.reverses_payment_id IS DISTINCT FROM (op.command->>'payment_id')::uuid
    OR NOT EXISTS(SELECT 1 FROM public.paige_invoice_payments p WHERE p.id=payment.reverses_payment_id AND p.tenant_id=payment.tenant_id
     AND p.invoice_id=payment.invoice_id AND p.kind='receipt' AND p.evidence_kind='manual_recorded' AND p.provider_operation_id IS NULL
     AND p.provider_environment IS NULL AND p.amount_cents=payment.amount_cents AND p.currency=payment.currency) THEN
    RAISE EXCEPTION 'Original manual invoice receipt unavailable' USING ERRCODE='55000';END IF;
  END IF;
  RETURN op.result;
END $$;
-- END ORIGINAL SOURCE exp04_invoice_manual_financial_write.sql

-- BEGIN ORIGINAL SOURCE exp04_invoice_actual_financial_read.sql
-- INERT O5 paired-read companion; not a versioned migration or activation.
-- Same original read/list/actor/tenant/history, explicit representation only.
DO $private_source$ DECLARE r record;p pg_proc%ROWTYPE;BEGIN
 FOR r IN SELECT * FROM(VALUES
 ('public._sales_invoice_financial_read_version()','6299914dc1e7aab1013afd60bd726d70',ARRAY[]::text[],'integer'),
 ('public._sales_invoice_read(uuid,uuid,integer,integer)','9add10afcf85dfbec91f1268248dbb58',ARRAY['_tenant','_invoice','_payment_limit','_financial_version'],'jsonb')
 )x(signature,body_hash,args,result_type) LOOP
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
 IF FOUND AND (md5(p.prosrc)<>r.body_hash OR pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
  OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0
  OR p.proretset OR p.prorettype IS DISTINCT FROM to_regtype(r.result_type)
  OR coalesce(p.proargnames,ARRAY[]::text[]) IS DISTINCT FROM r.args) THEN
  RAISE EXCEPTION 'Original private financial read requires reconciliation' USING ERRCODE='23514';END IF;
 END LOOP;
END $private_source$;
DO $source$ DECLARE r record;p pg_proc%ROWTYPE;BEGIN
 FOR r IN SELECT * FROM(VALUES ('public.read_sales_invoice(uuid,uuid)','ed189024d3239ef3899dcc888141cb62','fbd612d884e351f6f860802139d6ab80','{postgres=X/postgres,authenticated=X/postgres}'),('public.list_sales_invoices(uuid,integer,uuid)','84ba97fe6eeef437e18785239febecc8','f392e57d33a2dcdf5158cb42a80ded84','{postgres=X/postgres,authenticated=X/postgres}'))x(signature,prior,current,acl) LOOP
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
 IF NOT FOUND OR md5(p.prosrc) NOT IN(r.prior,r.current) OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] OR p.proacl::text IS DISTINCT FROM r.acl
  OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.prorettype<>'jsonb'::regtype
  OR p.proargnames IS DISTINCT FROM (CASE WHEN r.signature='public.read_sales_invoice(uuid,uuid)'
    THEN ARRAY['_expected_tenant_id','_invoice_id'] ELSE ARRAY['_expected_tenant_id','_limit','_before_id'] END)
  OR p.pronargdefaults IS DISTINCT FROM (CASE WHEN r.signature='public.read_sales_invoice(uuid,uuid)' THEN 0 ELSE 2 END)
  OR (r.signature='public.list_sales_invoices(uuid,integer,uuid)' AND pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM '50, NULL::uuid') THEN
  RAISE EXCEPTION 'Original invoice financial read source/authority changed' USING ERRCODE='23514';END IF;END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)') AND md5(prosrc)='bdb0960fa3d88b21cca90b79636dc7e1' AND NOT prosecdef AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original actual position requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;
CREATE OR REPLACE FUNCTION public._sales_invoice_financial_read_version() RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
DECLARE headers jsonb;version text;
BEGIN
 BEGIN headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid invoice financial representation' USING ERRCODE='22023';END;
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid invoice financial representation' USING ERRCODE='22023';END IF;
 IF NOT(headers ? 'x-paige-invoice-evidence-version') THEN RETURN NULL;END IF;
 version:=headers->>'x-paige-invoice-evidence-version';
 IF jsonb_typeof(headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string' OR version NOT IN ('2','3') THEN
  RAISE EXCEPTION 'Invalid invoice financial representation' USING ERRCODE='22023';END IF;
 RETURN version::integer;
END $function$;
CREATE OR REPLACE FUNCTION public._sales_invoice_read(_tenant uuid,_invoice uuid,_payment_limit integer,_financial_version integer) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
DECLARE invoice public.paige_invoices%ROWTYPE;result jsonb;balance record;financial jsonb;summary jsonb;payments jsonb;standing text;
BEGIN
 IF (_financial_version IS NULL OR _financial_version NOT IN (0,3)) OR _payment_limit IS NULL OR _payment_limit NOT BETWEEN 0 AND 50 THEN
  RAISE EXCEPTION 'Invoice financial representation unavailable' USING ERRCODE='22023';END IF;
 -- The ORIGINAL public entry has already locked/re-proved the current actor.
 -- This original invoice lock keeps version, cash, decisions and history coherent.
 SELECT * INTO invoice FROM public.paige_invoices i WHERE i.id=_invoice AND i.tenant_id=_tenant FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501';END IF;
 result:=public._sales_invoice_read(_tenant,_invoice,_payment_limit);
 SELECT * INTO STRICT balance FROM public._sales_invoice_financial_position_rows(_tenant,_invoice);
 IF invoice.status='issued' THEN
  BEGIN SELECT b.financial_position INTO STRICT financial FROM public._sales_invoice_financial_position_rows(_tenant,_invoice,3,NULL::jsonb)b;
  EXCEPTION WHEN SQLSTATE '55000' THEN financial:=NULL;END;
  standing:=coalesce(financial->>'financial_standing','unavailable');
  IF standing NOT IN ('recorded','needs_review','allocation_required','unavailable') THEN RAISE EXCEPTION 'Financial standing unavailable' USING ERRCODE='55000';END IF;
 ELSE standing:='not_applicable';END IF;
 summary:=jsonb_build_object('schema_version',3,'invoice_id',invoice.id,'invoice_version',coalesce(invoice.billing_lifecycle_version,invoice.billing_draft_version),
  'currency',lower(invoice.currency),'standing',standing,
  'outstanding_minor',CASE WHEN standing='recorded' THEN financial->'actual_outstanding_minor' END,
  'refund_payable_minor',CASE WHEN standing='recorded' THEN financial->'refund_payable_minor' END,
  'credit_minor',CASE WHEN standing='recorded' THEN financial->'credit_minor' END,
  'manual_recorded_minor',balance.manual_minor,'provider_confirmed_minor',balance.live_provider_minor,
  'provider_net_minor',CASE WHEN standing='recorded' THEN financial->'provider_settled_net_minor' END,
  'test_provider_minor',balance.test_provider_minor,
  'source_hash',CASE WHEN standing IN ('recorded','needs_review','allocation_required') THEN financial->'financial_source_hash' END);
 IF _financial_version=0 THEN
  IF invoice.status='issued' AND (standing IS DISTINCT FROM 'recorded'
   OR summary->'outstanding_minor' IS DISTINCT FROM result->'remaining_cents'
   OR summary->'refund_payable_minor' IS DISTINCT FROM '0'::jsonb OR summary->'credit_minor' IS DISTINCT FROM '0'::jsonb) THEN
   RAISE EXCEPTION 'Invoice financial representation changed; reload the current financial view' USING ERRCODE='40001';END IF;
  RETURN result;
 END IF;
 SELECT coalesce(jsonb_agg(row.value||jsonb_build_object('evidence_kind',p.evidence_kind,'provider',p.provider,
  'provider_verified_at',p.provider_verified_at,'provider_environment',CASE WHEN p.evidence_kind='provider_verified' THEN p.provider_environment END,
  'financial_review',CASE WHEN p.evidence_kind='provider_verified' AND p.provider_environment='live' THEN
   (SELECT jsonb_build_object('provider_operation_id',d.value->'provider_operation_id',
    'observation_id',d.value->'observation_id','observation_version',d.value->'observation_version',
    'disposition_version',d.value#>'{financial_decision,version}','captured_minor',d.value->'captured_minor',
    'retained_minor',d.value->'retained_minor','returned_minor',d.value->'returned_minor',
    'verification_pending',d.value->'verification_pending','commercial_review_required',d.value->'commercial_review_required',
    'credit_minor',d.value#>'{financial_decision,credit_minor}','decision_operation_id',d.value#>'{financial_decision,decision_operation_id}',
    'decision_current',coalesce((d.value#>>'{financial_decision,version}')::bigint>0
      AND d.value#>'{financial_decision,observation_id}'=d.value->'observation_id'
      AND d.value#>'{financial_decision,observation_version}'=d.value->'observation_version',false))
    FROM jsonb_array_elements(coalesce(financial->'provider_decisions','[]'::jsonb))d(value)
    WHERE d.value->>'provider_operation_id'=p.provider_operation_id::text) END,
  'provenance',CASE WHEN p.evidence_kind='provider_verified' THEN 'provider_verified' WHEN p.import_provenance IS NOT NULL THEN 'owner_imported_unverified' ELSE 'human_recorded' END)
  ORDER BY row.ordinality),'[]'::jsonb) INTO payments FROM jsonb_array_elements(result->'payments') WITH ORDINALITY row(value,ordinality)
 JOIN public.paige_invoice_payments p ON p.id=(row.value->>'id')::uuid AND p.tenant_id=_tenant AND p.invoice_id=_invoice;
 RETURN result||jsonb_build_object('payment_evidence_version',2,'financial_evidence_version',3,'financial_summary',summary,
  'manual_recorded_cents',balance.manual_minor,'provider_verified_cents',balance.live_provider_minor,
  'test_provider_verified_cents',balance.test_provider_minor,'allocated_cents',balance.receivable_allocated_minor,
  'remaining_cents',balance.receivable_remaining_minor,'payments',payments);
END $function$;
CREATE OR REPLACE FUNCTION public.read_sales_invoice(_expected_tenant_id uuid,_invoice_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE mode integer;
BEGIN
 IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501';END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 mode:=public._sales_invoice_financial_read_version();
 RETURN public._sales_invoice_read(_expected_tenant_id,_invoice_id,50,CASE WHEN mode=3 THEN 3 ELSE 0 END);
END $function$;
CREATE OR REPLACE FUNCTION public.list_sales_invoices(_expected_tenant_id uuid,_limit integer DEFAULT 50,_before_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE rows jsonb;ids uuid[];more boolean;mode integer;
BEGIN
 IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501';END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid invoice page' USING ERRCODE='22023';END IF;
 mode:=public._sales_invoice_financial_read_version();
 SELECT array_agg(id ORDER BY id DESC) INTO ids FROM(SELECT id FROM public.paige_invoices WHERE tenant_id=_expected_tenant_id
  AND billing_draft_version IS NOT NULL AND (_before_id IS NULL OR id<_before_id) ORDER BY id DESC LIMIT _limit+1)q;
 more:=coalesce(array_length(ids,1),0)>_limit;
 IF mode=3 THEN
  SELECT coalesce(jsonb_agg(public._sales_invoice_read(_expected_tenant_id,id,0,3) ORDER BY id DESC),'[]'::jsonb) INTO rows FROM unnest(ids[1:_limit])id;
 ELSE
  SELECT coalesce(jsonb_agg(public._sales_invoice_read(_expected_tenant_id,id,0,0) ORDER BY id DESC),'[]'::jsonb) INTO rows FROM unnest(ids[1:_limit])id;
 END IF;
 RETURN jsonb_build_object('rows',rows,'has_more',more,'next_cursor',CASE WHEN more THEN ids[_limit] ELSE NULL END)||CASE WHEN mode=3 THEN jsonb_build_object('financial_evidence_version',3) ELSE '{}'::jsonb END;
END $function$;
REVOKE ALL ON FUNCTION public._sales_invoice_financial_read_version(),public._sales_invoice_read(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
-- END ORIGINAL SOURCE exp04_invoice_actual_financial_read.sql

-- BEGIN ORIGINAL SOURCE exp04_invoice_actual_accepted_read.sql
DO $source$ DECLARE p pg_catalog.pg_proc%ROWTYPE;BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.read_sales_accepted_invoice_obligations(uuid,uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN ('93e839bcda9a3b8f311d88ec233c3522','643d1d0eeb54e8505ab86d67a0120f27')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
  OR p.proargnames IS DISTINCT FROM ARRAY['_expected_tenant_id','_invoice_id','_agreement_id']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
  RAISE EXCEPTION 'Original accepted-payment read source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_financial_read_version()')
  AND pg_catalog.md5(prosrc)='6299914dc1e7aab1013afd60bd726d70' AND NOT prosecdef AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)')
  AND pg_catalog.md5(prosrc)='bdb0960fa3d88b21cca90b79636dc7e1' AND NOT prosecdef AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_accepted_obligations(public.paige_invoices,uuid,integer)')
  AND pg_catalog.md5(prosrc)='56ae7991f59c2d40d5a6bea5fae562ad' AND NOT prosecdef AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial sources require reconciliation' USING ERRCODE='23514';END IF;
END $source$;

-- INERT O5 current accepted-target reader; not a versioned migration/activation.
-- Reuse exact signed terms and the original native actual-position engine.
CREATE OR REPLACE FUNCTION public.read_sales_accepted_invoice_obligations(
 _expected_tenant_id uuid,_invoice_id uuid,_agreement_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $read$
DECLARE original jsonb;observation jsonb;invoice public.paige_invoices%ROWTYPE;
 mode integer;financial jsonb;targets jsonb;unsafe_legacy boolean:=false;reason text;
BEGIN
 original:=public.read_sales_accepted_agreement(_expected_tenant_id,_invoice_id,_agreement_id);
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=_invoice_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Commercial agreement unavailable' USING ERRCODE='42501';END IF;
 mode:=public._sales_invoice_financial_read_version();
 IF mode=3 THEN
  -- This existing overload attests immutable accepted source ONLY. Its amounts
  -- must never be shown as current debt or independently allocated here.
  observation:=public._sales_invoice_accepted_obligations(invoice,_agreement_id,3)-'financial_source_only';
  observation:=observation||pg_catalog.jsonb_build_object('schema_version',2,'financial_evidence_version',3);
 ELSE observation:=public._sales_invoice_accepted_obligations(invoice,_agreement_id);END IF;
 IF original->>'state' IS DISTINCT FROM 'recorded' THEN
  observation:=observation||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_unavailable','obligations','[]'::jsonb);
 ELSIF observation->>'state'='available' THEN
  BEGIN SELECT p.financial_position INTO STRICT financial
   FROM public._sales_invoice_financial_position_rows(_expected_tenant_id,_invoice_id,3,NULL::jsonb)p;
  EXCEPTION WHEN SQLSTATE '55000' THEN financial:=NULL;END;
  IF financial->>'financial_standing'='recorded' AND pg_catalog.jsonb_typeof(financial->'obligations')='array' THEN
   -- Copy authoritative per-original-target debt, with original reference,
   -- accepted document digest, schedule, date and order. No arithmetic or FIFO.
   SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'reference',r.value->'reference','source_digest',r.value->'source_digest','due_date',r.value->'due_date',
    'scheduled_minor',r.value->'scheduled_minor','remaining_minor',r.value->'actual_outstanding_minor')
    ORDER BY r.ordinality),'[]'::jsonb) INTO targets
    FROM pg_catalog.jsonb_array_elements(financial->'obligations') WITH ORDINALITY r(value,ordinality);
   IF mode=3 THEN observation:=observation||pg_catalog.jsonb_build_object('obligations',targets);
   ELSE unsafe_legacy:=targets IS DISTINCT FROM observation->'obligations';END IF;
  ELSIF mode=3 THEN
   reason:=CASE financial->>'financial_standing' WHEN 'needs_review' THEN 'financial_review_required'
     WHEN 'allocation_required' THEN 'allocation_required' ELSE 'financial_evidence_unavailable' END;
   observation:=observation||pg_catalog.jsonb_build_object('state','held','reason',reason,'obligations','[]'::jsonb);
  ELSE unsafe_legacy:=true;END IF;
 END IF;
 -- Preserve the original post-wait current actor/workspace admission.
 IF auth.uid() IS NULL OR public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
  RAISE EXCEPTION 'Commercial agreement unavailable' USING ERRCODE='42501';END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 IF unsafe_legacy THEN RAISE EXCEPTION 'Accepted payment amounts changed; reload the current financial view' USING ERRCODE='40001';END IF;
 RETURN original||pg_catalog.jsonb_build_object('payment_obligations',observation);
END $read$;
-- END ORIGINAL SOURCE exp04_invoice_actual_accepted_read.sql

-- BEGIN ORIGINAL SOURCE exp04_collections_actual_financial_read.sql
DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.list_sales_collection_register(uuid,text,integer,jsonb)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('237a5e1937e63af991a8dcb99d594f35','9be5a7171a601dca5940d2f15bcd1104','d78b32cd02cb348e7e7811f9ca7c4cb3')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>3 OR p.prorettype<>'jsonb'::regtype
  OR pg_catalog.pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM '''invoice''::text, 50, NULL::jsonb'
  OR p.proargnames IS DISTINCT FROM ARRAY['_expected_tenant_id','_entity','_limit','_cursor']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
  RAISE EXCEPTION 'Original Collections read source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_read(uuid,uuid,integer,integer)')
  AND pg_catalog.md5(prosrc)='9add10afcf85dfbec91f1268248dbb58' AND pg_catalog.pg_get_userbyid(proowner)='postgres' AND NOT prosecdef
  AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u' AND NOT proretset
  AND prorettype='jsonb'::regtype AND pronargdefaults=0 AND proargnames=ARRAY['_tenant','_invoice','_payment_limit','_financial_version']
  AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current invoice source requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

-- INERT O5 original Collections projection; not a versioned native carrier.
-- Original actor/snapshot/cursor delegate remains authority. No financial write.
-- Explicit3 reuses the SAME current invoice summary, never receipt subtraction.
CREATE OR REPLACE FUNCTION public.list_sales_collection_register(
 _expected_tenant_id uuid,_entity text DEFAULT 'invoice',_limit integer DEFAULT 50,_cursor jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $read$
DECLARE result jsonb;rows jsonb;headers jsonb;actual boolean;current_financial boolean;unsafe_legacy boolean;unknown_historical_provider boolean;
BEGIN
 result:=public._list_sales_collection_register_before_provider(_expected_tenant_id,_entity,_limit,_cursor);
 BEGIN headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Invalid invoice financial representation' USING ERRCODE='22023';END;
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' OR (headers ? 'x-paige-invoice-evidence-version' AND
  (jsonb_typeof(headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string'
   OR headers->>'x-paige-invoice-evidence-version' NOT IN('2','3'))) THEN
  RAISE EXCEPTION 'Invalid invoice financial representation' USING ERRCODE='22023';END IF;
 actual:=coalesce(headers->>'x-paige-invoice-evidence-version' IN('2','3'),false);
 current_financial:=coalesce(headers->>'x-paige-invoice-evidence-version'='3',false);
 IF _entity='invoice' THEN
  WITH projected AS MATERIALIZED (
   SELECT r.value,r.ordinality,b.*,CASE WHEN r.value->>'record_kind'='managed'
    THEN public._sales_invoice_read(_expected_tenant_id,(r.value->>'id')::uuid,0,3)->'financial_summary' END AS financial
   FROM jsonb_array_elements(result->'rows') WITH ORDINALITY r(value,ordinality)
   CROSS JOIN LATERAL public._sales_invoice_financial_position_rows(_expected_tenant_id,(r.value->>'id')::uuid)b
  )
  SELECT coalesce(jsonb_agg(p.value||jsonb_build_object(
   'manual_recorded_cents',p.manual_minor,
   'provider_verified_cents',CASE WHEN actual THEN p.live_provider_minor ELSE p.provider_minor END,
   'remaining_cents',CASE WHEN current_financial AND p.financial IS NOT NULL THEN (p.financial->>'outstanding_minor')::numeric WHEN actual THEN p.receivable_remaining_minor ELSE p.remaining_minor END,
   'collection_required',CASE WHEN current_financial AND p.financial IS NOT NULL THEN
    CASE WHEN p.value->>'status'<>'issued' THEN false WHEN p.financial->>'standing'='recorded' THEN (p.financial->>'outstanding_minor')::numeric>0 ELSE NULL END
    ELSE (CASE WHEN actual THEN p.receivable_remaining_minor ELSE p.remaining_minor END)>0 AND p.value->>'status' IN('issued','recorded') END)
   ||CASE WHEN actual THEN jsonb_build_object('payment_evidence_version',2,'allocated_cents',p.receivable_allocated_minor,'test_provider_verified_cents',p.test_provider_minor) ELSE '{}'::jsonb END
   ||CASE WHEN current_financial AND p.financial IS NOT NULL THEN jsonb_build_object('financial_evidence_version',3,'financial_summary',p.financial) ELSE '{}'::jsonb END
   ORDER BY p.ordinality),'[]'::jsonb),
   coalesce(bool_or(NOT current_financial AND p.financial IS NOT NULL AND p.value->>'status'='issued'
    AND (p.financial->>'standing' IS DISTINCT FROM 'recorded'
     OR (p.financial->>'outstanding_minor')::numeric IS DISTINCT FROM (CASE WHEN actual THEN p.receivable_remaining_minor ELSE p.remaining_minor END)
     OR (p.financial->>'refund_payable_minor')::numeric IS DISTINCT FROM 0::numeric
     OR (p.financial->>'credit_minor')::numeric IS DISTINCT FROM 0::numeric)),false),
   coalesce(bool_or(current_financial AND p.value->>'record_kind'<>'managed' AND p.provider_minor>0),false)
   INTO rows,unsafe_legacy,unknown_historical_provider FROM projected p;
  IF unsafe_legacy THEN
   RAISE EXCEPTION 'Collections amounts changed; reload the current financial view' USING ERRCODE='40001';END IF;
  IF unknown_historical_provider THEN
   RAISE EXCEPTION 'Historical provider financial evidence requires reconciliation' USING ERRCODE='55000';END IF;
 ELSE
  SELECT coalesce(jsonb_agg(r.value
   ||CASE WHEN p.evidence_kind='provider_verified' THEN jsonb_build_object('provenance','provider_verified','provider',p.provider) ELSE '{}'::jsonb END
   ||CASE WHEN actual THEN jsonb_build_object('payment_evidence_version',2,'provider_environment',CASE WHEN p.evidence_kind='provider_verified' THEN p.provider_environment END) ELSE '{}'::jsonb END
   ORDER BY r.ordinality),'[]'::jsonb) INTO rows
   FROM jsonb_array_elements(result->'rows') WITH ORDINALITY r(value,ordinality)
   LEFT JOIN public.paige_invoice_payments p ON p.tenant_id=_expected_tenant_id AND p.id=(r.value->>'id')::uuid;
 END IF;
 RETURN result||jsonb_build_object('rows',rows,'balance_basis','canonical_receipt_allocations')
  ||CASE WHEN actual THEN jsonb_build_object('payment_evidence_version',2) ELSE '{}'::jsonb END
  ||CASE WHEN current_financial THEN jsonb_build_object('financial_evidence_version',3) ELSE '{}'::jsonb END;
END $read$;
-- END ORIGINAL SOURCE exp04_collections_actual_financial_read.sql

-- BEGIN ORIGINAL SOURCE exp04_client_invoice_financial_facts.sql
-- EXP04 O5 selected-schema candidate ONLY; not a deployed forward.
-- ONE original query, exact old five-argument caller adapter, closed native
-- real-receivable representation. No public grant, resolver, role or writer change.
-- Original source body md5 a307bf9e57e5b2ad692c74a329e683cd.
CREATE OR REPLACE FUNCTION public._client_portal_invoice_facts_for_client(_tenant uuid, _client uuid, p_limit integer, p_after jsonb, p_as_of date, p_payment_evidence_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  _after_at timestamptz;
  _after_id uuid;
  _today date := p_as_of;
  _result jsonb;
BEGIN
  IF p_payment_evidence_version IS NULL OR p_payment_evidence_version NOT IN (1,2) THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  IF _tenant IS NULL OR _client IS NULL THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  IF p_as_of IS NOT NULL AND NOT isfinite(p_as_of) THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 40 THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_after IS NOT NULL THEN
    IF jsonb_typeof(p_after) IS DISTINCT FROM 'object' OR NOT (p_after ?& ARRAY['issued_at','id'])
       OR (p_after - ARRAY['issued_at','id']) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE = '22023';
    END IF;
    BEGIN
      _after_at := (p_after->>'issued_at')::timestamptz;
      _after_id := (p_after->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE = '22023';
    END;
    IF _after_at IS NULL OR NOT isfinite(_after_at) OR _after_id IS NULL THEN
      RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- One statement snapshot: the page, every-page totals and counts agree.
  WITH facts AS MATERIALIZED (
    SELECT i.id, i.invoice_number, i.status, lower(i.currency) AS currency, i.due_date,
      i.billing_issued_at AS issued_at, i.billing_issued_snapshot_version AS issued_snapshot_version,
      b.amount_minor,
      CASE WHEN p_payment_evidence_version=2 THEN b.receivable_remaining_minor ELSE b.remaining_minor END AS remaining_minor,
      b.manual_minor,
      CASE WHEN p_payment_evidence_version=2 THEN b.live_provider_minor ELSE b.provider_minor END AS provider_minor,
      b.test_provider_minor
    FROM public.paige_invoices i
    CROSS JOIN LATERAL public._sales_invoice_financial_position_rows(_tenant, i.id) b
    WHERE i.tenant_id = _tenant AND i.contact_id = _client
      AND i.status IN ('issued','void')
      AND i.billing_issued_snapshot_version IS NOT NULL AND i.billing_document IS NOT NULL
  ), candidates AS (
    SELECT * FROM facts WHERE p_after IS NULL OR (issued_at, id) < (_after_at, _after_id)
    ORDER BY issued_at DESC, id DESC LIMIT p_limit + 1
  ), page AS (
    SELECT * FROM candidates ORDER BY issued_at DESC, id DESC LIMIT p_limit
  ), latest_request AS (
    -- The business's most recent payment request per issued page invoice; the URL never leaves here.
    SELECT p.id, (
      SELECT (public._sales_invoice_payment_projection(_tenant, p.id, op.id, p.remaining_minor::bigint)->>'provider_url') IS NOT NULL
      FROM public.paige_invoice_provider_operations op
      WHERE op.tenant_id = _tenant AND op.invoice_id = p.id
      ORDER BY op.created_at DESC, op.id DESC LIMIT 1) AS payable
    FROM page p WHERE p.status = 'issued'
  ), projected AS (
    SELECT p.id, p.issued_at, jsonb_build_object(
      'id', p.id, 'invoice_number', p.invoice_number, 'status', p.status, 'currency', p.currency,
      'issued_at', p.issued_at, 'due_date', p.due_date,
      'issued_snapshot_version', p.issued_snapshot_version,
      'amount_minor', p.amount_minor::text, 'remaining_minor', p.remaining_minor::text,
      'provider_verified_minor', p.provider_minor::text, 'manual_recorded_minor', p.manual_minor::text,
      'test_provider_minor', p.test_provider_minor::text,
      'payable', coalesce(r.payable, false),
      'past_due', p.status = 'issued' AND p.remaining_minor > 0 AND p.due_date IS NOT NULL AND p.due_date < _today) AS value
    FROM page p LEFT JOIN latest_request r ON r.id = p.id
  ), amounts AS (
    SELECT currency, sum(remaining_minor) AS remaining_minor, sum(provider_minor) AS provider_minor,
      sum(manual_minor) AS manual_minor, sum(test_provider_minor) AS test_provider_minor
    FROM facts WHERE status <> 'void' GROUP BY currency
  )
  SELECT jsonb_build_object(
    'schema_version', 1,
    'tenant_id', _tenant,
    'business_name', (SELECT t.name FROM public.tenants t WHERE t.id = _tenant),
    'invoices', coalesce((SELECT jsonb_agg(value ORDER BY issued_at DESC, id DESC) FROM projected), '[]'::jsonb),
    'invoice_count', (SELECT count(*) FROM facts),
    'has_more', (SELECT count(*) FROM candidates) > p_limit,
    'next_cursor', CASE WHEN (SELECT count(*) FROM candidates) > p_limit THEN
      (SELECT jsonb_build_object('issued_at', issued_at, 'id', id) FROM page ORDER BY issued_at, id LIMIT 1) END,
    'balances', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'currency', currency, 'remaining_minor', remaining_minor::text,
      'provider_verified_minor', provider_minor::text, 'manual_recorded_minor', manual_minor::text,
      'test_provider_minor', test_provider_minor::text) ORDER BY currency) FROM amounts), '[]'::jsonb),
    'open_count', (SELECT count(*) FROM facts WHERE status = 'issued' AND remaining_minor > 0),
    '_native_sources', jsonb_build_object('as_of_date',p_as_of,'all_facts_identity',
      encode(extensions.digest(coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM facts f),'[]'::jsonb)::text,'sha256'),'hex')),
    'read_at', statement_timestamp()
  ) INTO _result;
  RETURN _result || CASE WHEN p_payment_evidence_version=2
    THEN jsonb_build_object('payment_evidence_version',2) ELSE '{}'::jsonb END;
END;
$function$;

REVOKE ALL ON FUNCTION public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer) FROM PUBLIC;
DO $private_acl$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)'::regprocedure
   AND (a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
  RAISE EXCEPTION 'Private client financial query permission drift' USING ERRCODE='23514';
 END IF;
END $private_acl$;

CREATE OR REPLACE FUNCTION public._client_portal_invoice_facts_for_client(_tenant uuid, _client uuid, p_limit integer, p_after jsonb, p_as_of date)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RETURN public._client_portal_invoice_facts_for_client(_tenant,_client,p_limit,p_after,p_as_of,1);
END;
$$;
REVOKE ALL ON FUNCTION public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date) FROM PUBLIC;
-- END ORIGINAL SOURCE exp04_client_invoice_financial_facts.sql

-- BEGIN ORIGINAL SOURCE exp04_client_invoice_actual_financial_facts.sql
-- INERT original E04 O5 client financial projection; not a versioned release.
-- Extends the SAME private query. No public endpoint, actor/relationship, writer,
-- provider, grant, calendar, cursor or document authority change.
DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('eba917a1ba725cd71a3b5de01f30affb','1a622edb93cf9041638be41b615020c4')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
  OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_client','p_limit','p_after','p_as_of','p_payment_evidence_version']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
  RAISE EXCEPTION 'Original client financial projection source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_read(uuid,uuid,integer,integer)')
  AND pg_catalog.md5(prosrc)='9add10afcf85dfbec91f1268248dbb58' AND pg_catalog.pg_get_userbyid(proowner)='postgres'
  AND NOT prosecdef AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u' AND NOT proretset
  AND prorettype='jsonb'::regtype AND pronargdefaults=0 AND proargnames=ARRAY['_tenant','_invoice','_payment_limit','_financial_version']
  AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial reader requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

CREATE OR REPLACE FUNCTION public._client_portal_invoice_facts_for_client(_tenant uuid, _client uuid, p_limit integer, p_after jsonb, p_as_of date, p_payment_evidence_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  _after_at timestamptz;
  _after_id uuid;
  _today date := p_as_of;
  _result jsonb;
  _current_coherent boolean;
  _legacy_unsafe boolean;
BEGIN
  IF p_payment_evidence_version IS NULL OR p_payment_evidence_version NOT IN (1,2,3) THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  IF _tenant IS NULL OR _client IS NULL THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  IF p_as_of IS NOT NULL AND NOT isfinite(p_as_of) THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 40 THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_after IS NOT NULL THEN
    IF jsonb_typeof(p_after) IS DISTINCT FROM 'object' OR NOT (p_after ?& ARRAY['issued_at','id'])
       OR (p_after - ARRAY['issued_at','id']) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE = '22023';
    END IF;
    BEGIN
      _after_at := (p_after->>'issued_at')::timestamptz;
      _after_id := (p_after->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE = '22023';
    END;
    IF _after_at IS NULL OR NOT isfinite(_after_at) OR _after_id IS NULL THEN
      RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- SAME original query and authoritative current reader. The reader retains
  -- invoice and accepted-source locks; compare its current identity and gross
  -- facts with the original query snapshot before any result leaves this function.
  WITH source AS MATERIALIZED (
    SELECT i.id,i.invoice_number,i.status,i.currency,i.due_date,i.billing_issued_at,
      i.billing_issued_snapshot_version,coalesce(i.billing_lifecycle_version,i.billing_draft_version) AS source_version,
      public._sales_invoice_read(_tenant,i.id,0,3)->'financial_summary' AS financial
    FROM public.paige_invoices i
    WHERE i.tenant_id=_tenant AND i.contact_id=_client
      AND i.status IN ('issued','void')
      AND i.billing_issued_snapshot_version IS NOT NULL AND i.billing_document IS NOT NULL
  ), facts AS MATERIALIZED (
    SELECT i.id, i.invoice_number, i.status, lower(i.currency) AS currency, i.due_date,
      i.billing_issued_at AS issued_at, i.billing_issued_snapshot_version AS issued_snapshot_version,
      b.amount_minor,
      CASE WHEN p_payment_evidence_version=3 THEN (i.financial->>'outstanding_minor')::numeric
        WHEN p_payment_evidence_version=2 THEN b.receivable_remaining_minor ELSE b.remaining_minor END AS remaining_minor,
      b.manual_minor,
      CASE WHEN p_payment_evidence_version IN (2,3) THEN b.live_provider_minor ELSE b.provider_minor END AS provider_minor,
      b.test_provider_minor,i.financial,
      coalesce(i.financial->'invoice_id'=to_jsonb(i.id)
        AND i.financial->'invoice_version'=to_jsonb(i.source_version)
        AND i.financial->>'currency'=lower(i.currency)
        AND i.financial->'manual_recorded_minor'=to_jsonb(b.manual_minor)
        AND i.financial->'provider_confirmed_minor'=to_jsonb(b.live_provider_minor)
        AND i.financial->'test_provider_minor'=to_jsonb(b.test_provider_minor)
        AND ((i.status='issued' AND i.financial->>'standing'<>'not_applicable')
          OR (i.status='void' AND i.financial->>'standing'='not_applicable')),false) AS financial_coherent
    FROM source i
    CROSS JOIN LATERAL public._sales_invoice_financial_position_rows(_tenant, i.id) b
  ), candidates AS (
    SELECT * FROM facts WHERE p_after IS NULL OR (issued_at, id) < (_after_at, _after_id)
    ORDER BY issued_at DESC, id DESC LIMIT p_limit + 1
  ), page AS (
    SELECT * FROM candidates ORDER BY issued_at DESC, id DESC LIMIT p_limit
  ), latest_request AS (
    -- The business's most recent payment request per issued page invoice; the URL never leaves here.
    SELECT p.id, (
      SELECT (public._sales_invoice_payment_projection(_tenant, p.id, op.id, p.remaining_minor::bigint)->>'provider_url') IS NOT NULL
      FROM public.paige_invoice_provider_operations op
      WHERE op.tenant_id = _tenant AND op.invoice_id = p.id
      ORDER BY op.created_at DESC, op.id DESC LIMIT 1) AS payable
    FROM page p WHERE p.status = 'issued' AND (p_payment_evidence_version<>3 OR (p.financial->>'standing'='recorded' AND p.remaining_minor>0))
  ), projected AS (
    SELECT p.id, p.issued_at, jsonb_build_object(
      'id', p.id, 'invoice_number', p.invoice_number, 'status', p.status, 'currency', p.currency,
      'issued_at', p.issued_at, 'due_date', p.due_date,
      'issued_snapshot_version', p.issued_snapshot_version,
      'amount_minor', p.amount_minor::text, 'remaining_minor', p.remaining_minor::text,
      'provider_verified_minor', p.provider_minor::text, 'manual_recorded_minor', p.manual_minor::text,
      'test_provider_minor', p.test_provider_minor::text,
      'payable', coalesce(r.payable, false),
      'past_due', CASE WHEN p_payment_evidence_version=3 AND p.status='issued'
        AND p.financial->>'standing'<>'recorded' THEN NULL
        ELSE p.status='issued' AND p.remaining_minor>0 AND p.due_date IS NOT NULL AND p.due_date<_today END)
      ||CASE WHEN p_payment_evidence_version=3 THEN jsonb_build_object(
        'financial_standing',p.financial->'standing',
        'financial_revision',p.financial->'source_hash',
        'refund_payable_minor',p.financial->>'refund_payable_minor',
        'credit_minor',p.financial->>'credit_minor','provider_net_minor',p.financial->>'provider_net_minor') ELSE '{}'::jsonb END AS value
    FROM page p LEFT JOIN latest_request r ON r.id = p.id
  ), amounts AS (
    SELECT currency,CASE WHEN p_payment_evidence_version<>3 OR bool_and(financial->>'standing'='recorded')
        THEN sum(remaining_minor) END AS remaining_minor,sum(provider_minor) AS provider_minor,
      sum(manual_minor) AS manual_minor,sum(test_provider_minor) AS test_provider_minor,
      CASE WHEN bool_and(financial->>'standing'='recorded') THEN 'recorded' ELSE 'needs_review' END AS financial_standing,
      CASE WHEN bool_and(financial->>'standing'='recorded') THEN sum((financial->>'refund_payable_minor')::numeric) END AS refund_payable_minor,
      CASE WHEN bool_and(financial->>'standing'='recorded') THEN sum((financial->>'credit_minor')::numeric) END AS credit_minor,
      CASE WHEN bool_and(financial->>'standing'='recorded') THEN sum((financial->>'provider_net_minor')::numeric) END AS provider_net_minor
    FROM facts WHERE status <> 'void' GROUP BY currency
  )
  SELECT jsonb_build_object(
    'schema_version', 1,
    'tenant_id', _tenant,
    'business_name', (SELECT t.name FROM public.tenants t WHERE t.id = _tenant),
    'invoices', coalesce((SELECT jsonb_agg(value ORDER BY issued_at DESC, id DESC) FROM projected), '[]'::jsonb),
    'invoice_count', (SELECT count(*) FROM facts),
    'has_more', (SELECT count(*) FROM candidates) > p_limit,
    'next_cursor', CASE WHEN (SELECT count(*) FROM candidates) > p_limit THEN
      (SELECT jsonb_build_object('issued_at', issued_at, 'id', id) FROM page ORDER BY issued_at, id LIMIT 1) END,
    'balances', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'currency', currency, 'remaining_minor', remaining_minor::text,
      'provider_verified_minor', provider_minor::text, 'manual_recorded_minor', manual_minor::text,
      'test_provider_minor', test_provider_minor::text)
      ||CASE WHEN p_payment_evidence_version=3 THEN jsonb_build_object('financial_standing',financial_standing,
        'refund_payable_minor',refund_payable_minor::text,'credit_minor',credit_minor::text,
        'provider_net_minor',provider_net_minor::text) ELSE '{}'::jsonb END ORDER BY currency) FROM amounts), '[]'::jsonb),
    'open_count',CASE WHEN p_payment_evidence_version=3 AND EXISTS(
      SELECT 1 FROM facts WHERE status='issued' AND financial->>'standing'<>'recorded') THEN NULL
      ELSE (SELECT count(*) FROM facts WHERE status='issued' AND remaining_minor>0) END,
    '_native_sources', jsonb_build_object('as_of_date',p_as_of,'all_facts_identity',
      encode(extensions.digest(coalesce((SELECT jsonb_agg(CASE WHEN p_payment_evidence_version=3 THEN to_jsonb(f)-'financial_coherent'
        ELSE to_jsonb(f)-'financial'-'financial_coherent' END ORDER BY f.id) FROM facts f),'[]'::jsonb)::text,'sha256'),'hex')),
    'read_at', statement_timestamp()
  ),coalesce((SELECT bool_and(financial_coherent) FROM facts),true),
    coalesce((SELECT bool_or(status='issued' AND (financial->>'standing' IS DISTINCT FROM 'recorded'
      OR financial->'outstanding_minor' IS DISTINCT FROM to_jsonb(remaining_minor)
      OR financial->'refund_payable_minor' IS DISTINCT FROM '0'::jsonb
      OR financial->'credit_minor' IS DISTINCT FROM '0'::jsonb)) FROM facts),false)
    INTO _result,_current_coherent,_legacy_unsafe;
  IF NOT _current_coherent THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_SOURCE_CHANGED' USING ERRCODE='40001';END IF;
  IF p_payment_evidence_version<>3 AND _legacy_unsafe THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_FINANCIAL_VIEW_CHANGED' USING ERRCODE='40001';END IF;
  RETURN _result||CASE WHEN p_payment_evidence_version IN(2,3)
    THEN jsonb_build_object('payment_evidence_version',2) ELSE '{}'::jsonb END
    ||CASE WHEN p_payment_evidence_version=3 THEN jsonb_build_object('financial_evidence_version',3) ELSE '{}'::jsonb END;
END;
$function$;

REVOKE ALL ON FUNCTION public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer) FROM PUBLIC;
DO $private_acl$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  WHERE p.oid='public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)'::regprocedure
   AND (a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
  RAISE EXCEPTION 'Private client financial query permission drift' USING ERRCODE='23514';
 END IF;
END $private_acl$;
-- END ORIGINAL SOURCE exp04_client_invoice_actual_financial_facts.sql

-- BEGIN ORIGINAL SOURCE exp04_client_invoice_financial_transport.sql
-- EXP04 O5 test-only original scoped transport extension; NOT a deployed forward.
-- SAME function identity/defaults/owner/ACL/resolver/calendar and exact client scope.
-- Header selects only a closed financial representation. No new grant or API.
CREATE OR REPLACE FUNCTION public.client_portal_invoices_calendar_scoped(p_tenant_id uuid, p_expected_client_id uuid, p_limit integer DEFAULT 20, p_after jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE calendar jsonb; facts jsonb; headers jsonb; evidence_version text;
BEGIN
 IF p_tenant_id IS NULL OR p_expected_client_id IS NULL
  OR public._client_portal_billing_client(p_tenant_id) IS DISTINCT FROM p_expected_client_id THEN
  RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 -- The SAME original Auth/tenant/client financial resolver holds its locks.
 -- Original native calendar and query are the only source of dates and money.
 calendar:=public._business_time_zone_for_tenant(p_tenant_id,statement_timestamp());
 -- Representation choice never grants authority: the SAME original resolver above
 -- already bound this caller to the exact business/customer under its locks.
 headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';
 END IF;
 IF headers ? 'x-paige-invoice-evidence-version' AND
  (jsonb_typeof(headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string'
   OR headers->>'x-paige-invoice-evidence-version'<>'2') THEN
  RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';
 END IF;
 evidence_version:=headers->>'x-paige-invoice-evidence-version';
 IF evidence_version='2' THEN
  facts:=public._client_portal_invoice_facts_for_client(p_tenant_id,p_expected_client_id,p_limit,p_after,(calendar->>'local_date')::date,2);
 ELSE
  facts:=public._client_portal_invoice_facts_for_client(p_tenant_id,p_expected_client_id,p_limit,p_after,(calendar->>'local_date')::date);
 END IF;
 RETURN (facts-'_native_sources')||jsonb_build_object('schema_version',CASE WHEN evidence_version='2' THEN 3 ELSE 2 END,'calendar',
  jsonb_build_object('state',calendar->'state','zone',calendar->'zone','local_date',calendar->'local_date'));
END $function$;
-- END ORIGINAL SOURCE exp04_client_invoice_financial_transport.sql

-- BEGIN ORIGINAL SOURCE exp04_client_invoice_actual_financial_transport.sql
-- INERT original client financial transport extension, not a native release.
-- SAME original resolver, actor/client/invoice permissions, calendar and API.
DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.client_portal_invoices_calendar_scoped(uuid,uuid,integer,jsonb)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('d283924a7763abeeb27a85960dcfa5ec','a79ff5475d861a26f92c578effb73060')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>2 OR p.prorettype<>'jsonb'::regtype
  OR pg_catalog.pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM '20, NULL::jsonb'
  OR p.proargnames IS DISTINCT FROM ARRAY['p_tenant_id','p_expected_client_id','p_limit','p_after']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
  RAISE EXCEPTION 'Original client financial transport source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)')
  AND pg_catalog.md5(prosrc)='1a622edb93cf9041638be41b615020c4' AND pg_catalog.pg_get_userbyid(proowner)='postgres'
  AND NOT prosecdef AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u' AND NOT proretset
  AND prorettype='jsonb'::regtype AND pronargdefaults=0
  AND proargnames=ARRAY['_tenant','_client','p_limit','p_after','p_as_of','p_payment_evidence_version']
  AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current client financial query requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

CREATE OR REPLACE FUNCTION public.client_portal_invoices_calendar_scoped(p_tenant_id uuid, p_expected_client_id uuid, p_limit integer DEFAULT 20, p_after jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE calendar jsonb; facts jsonb; headers jsonb; evidence_version text;
BEGIN
 IF p_tenant_id IS NULL OR p_expected_client_id IS NULL
  OR public._client_portal_billing_client(p_tenant_id) IS DISTINCT FROM p_expected_client_id THEN
  RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 -- The SAME original Auth/tenant/client financial resolver holds its locks.
 -- Original native calendar and query are the only source of dates and money.
 calendar:=public._business_time_zone_for_tenant(p_tenant_id,statement_timestamp());
 -- Representation choice never grants authority: the SAME original resolver above
 -- already bound this caller to the exact business/customer under its locks.
 headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';
 END IF;
 IF headers ? 'x-paige-invoice-evidence-version' AND
  (jsonb_typeof(headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string'
   OR headers->>'x-paige-invoice-evidence-version' NOT IN('2','3')) THEN
  RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';
 END IF;
 evidence_version:=headers->>'x-paige-invoice-evidence-version';
 IF evidence_version IN('2','3') THEN
  facts:=public._client_portal_invoice_facts_for_client(p_tenant_id,p_expected_client_id,p_limit,p_after,(calendar->>'local_date')::date,evidence_version::integer);
 ELSE
  facts:=public._client_portal_invoice_facts_for_client(p_tenant_id,p_expected_client_id,p_limit,p_after,(calendar->>'local_date')::date);
 END IF;
 RETURN (facts-'_native_sources')||jsonb_build_object('schema_version',CASE WHEN evidence_version='3' THEN 4 WHEN evidence_version='2' THEN 3 ELSE 2 END,'calendar',
  jsonb_build_object('state',calendar->'state','zone',calendar->'zone','local_date',calendar->'local_date'))
  ||CASE WHEN evidence_version='3' THEN jsonb_build_object('financial_revision',facts#>'{_native_sources,all_facts_identity}') ELSE '{}'::jsonb END;
END $function$;
-- END ORIGINAL SOURCE exp04_client_invoice_actual_financial_transport.sql

-- BEGIN ORIGINAL SOURCE exp04_client_invoice_actual_payment_read.sql
-- INERT E04 O5 ORIGINAL customer payment-request financial projection.
-- No resolver/actor/client/invoice lock, public ABI, provider, grant or write change.
DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.client_portal_invoice_payment_request(uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('e59ce09de1660f47341787a89b7269ec','5addaaad6dbb3186f3b5ff67457ee009')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>1 OR p.prorettype<>'jsonb'::regtype
  OR pg_catalog.pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM 'NULL::uuid'
  OR p.proargnames IS DISTINCT FROM ARRAY['p_invoice_id','p_tenant_id']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
  RAISE EXCEPTION 'Original customer payment projection source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_read(uuid,uuid,integer,integer)')
  AND pg_catalog.md5(prosrc)='9add10afcf85dfbec91f1268248dbb58' AND pg_catalog.pg_get_userbyid(proowner)='postgres'
  AND NOT prosecdef AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u' AND NOT proretset
  AND prorettype='jsonb'::regtype AND pronargdefaults=0 AND proargnames=ARRAY['_tenant','_invoice','_payment_limit','_financial_version']
  AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial reader requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

CREATE OR REPLACE FUNCTION public.client_portal_invoice_payment_request(p_invoice_id uuid, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _client uuid;
  _tenant uuid;
  _number text;
  _remaining numeric;
  _test numeric;
  _op_id uuid;
  _op_environment text;
  _request jsonb;
  _headers jsonb;
  _evidence_version text;
  _financial jsonb;
BEGIN
  _client := public._client_portal_billing_client(p_tenant_id);
  IF _client IS NULL THEN RETURN NULL; END IF;
  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client;
  SELECT i.invoice_number INTO _number FROM public.paige_invoices i
  WHERE i.id = p_invoice_id AND i.tenant_id = _tenant AND i.contact_id = _client AND i.status = 'issued'
    AND i.billing_issued_snapshot_version IS NOT NULL AND i.billing_document IS NOT NULL
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLIENT_INVOICE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;

  -- Original resolver and invoice lock above precede representation parsing.
  BEGIN _headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';END;
  IF jsonb_typeof(_headers) IS DISTINCT FROM 'object' OR (_headers ? 'x-paige-invoice-evidence-version' AND
    (jsonb_typeof(_headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string'
      OR _headers->>'x-paige-invoice-evidence-version' NOT IN('2','3'))) THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_INPUT_INVALID' USING ERRCODE='22023';END IF;
  _evidence_version:=_headers->>'x-paige-invoice-evidence-version';
  SELECT b.remaining_minor,b.test_provider_minor INTO _remaining,_test
    FROM public._sales_invoice_balance_rows(_tenant,p_invoice_id)b;
  IF _evidence_version IN('2','3') THEN
    SELECT b.receivable_remaining_minor,b.test_provider_minor INTO _remaining,_test
      FROM public._sales_invoice_financial_position_rows(_tenant,p_invoice_id)b;
  END IF;
  _financial:=public._sales_invoice_read(_tenant,p_invoice_id,0,3)->'financial_summary';
  IF _evidence_version='3' THEN
    _remaining:=(_financial->>'outstanding_minor')::numeric;
  ELSIF _financial->>'standing' IS DISTINCT FROM 'recorded'
    OR _financial->'outstanding_minor' IS DISTINCT FROM to_jsonb(_remaining)
    OR _financial->'refund_payable_minor' IS DISTINCT FROM '0'::jsonb
    OR _financial->'credit_minor' IS DISTINCT FROM '0'::jsonb THEN
    RAISE EXCEPTION 'CLIENT_INVOICE_FINANCIAL_VIEW_CHANGED' USING ERRCODE='40001';
  END IF;
  SELECT op.id, op.environment INTO _op_id, _op_environment
  FROM public.paige_invoice_provider_operations op
  WHERE op.tenant_id = _tenant AND op.invoice_id = p_invoice_id
  ORDER BY op.created_at DESC, op.id DESC LIMIT 1;
  IF _op_id IS NOT NULL AND (_evidence_version IS DISTINCT FROM '3' OR (_financial->>'standing'='recorded' AND _remaining>0)) THEN
    _request := public._sales_invoice_payment_projection(_tenant, p_invoice_id, _op_id, _remaining::bigint)
      || jsonb_build_object('environment', _op_environment);
  END IF;
  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', _number,
    'remaining_cents', _remaining::bigint, 'test_provider_cents', coalesce(_test, 0)::bigint,
    'payment_request',_request)
    ||CASE WHEN _evidence_version IN('2','3') THEN jsonb_build_object('payment_evidence_version',2) ELSE '{}'::jsonb END
    ||CASE WHEN _evidence_version='3' THEN jsonb_build_object('financial_evidence_version',3,
      'financial_revision',_financial->'source_hash','financial_standing',_financial->'standing','refund_payable_minor',_financial->'refund_payable_minor',
      'credit_minor',_financial->'credit_minor','provider_net_minor',_financial->'provider_net_minor') ELSE '{}'::jsonb END;
END;
$$;
-- END ORIGINAL SOURCE exp04_client_invoice_actual_payment_read.sql

-- BEGIN ORIGINAL SOURCE exp04_invoice_current_payment_projection.sql
-- INERT E04 O5 canonical checkout-link currentness repair, not a release.
-- SAME original projection/shape/permissions, same financial and target engines.
DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_payment_projection(uuid,uuid,uuid,bigint)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('228a194ceec12380fd8ce5f5aec5cc57','9577250340dcf99070b466bb40bef3a7')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
  OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_invoice','_operation','_remaining']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
  RAISE EXCEPTION 'Original payment-link projection source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)')
  AND pg_catalog.md5(prosrc)='bdb0960fa3d88b21cca90b79636dc7e1' AND pg_catalog.pg_get_userbyid(proowner)='postgres'
  AND NOT prosecdef AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u'
  AND proretset AND prorettype='record'::regtype AND pronargdefaults=0
  AND proargnames=ARRAY['_tenant','_invoice','_evidence_version','_proposal','invoice_id','financial_position']
  AND proallargtypes=ARRAY['uuid'::regtype::oid,'uuid'::regtype::oid,'integer'::regtype::oid,'jsonb'::regtype::oid,'uuid'::regtype::oid,'jsonb'::regtype::oid]
  AND proargmodes=ARRAY['i','i','i','i','t','t']::"char"[]
  AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_require_accepted_obligation(public.paige_invoices,jsonb)')
  AND pg_catalog.md5(prosrc)='e07fdfc39975c26c2ec07f0ac290ba2c' AND pg_catalog.pg_get_userbyid(proowner)='postgres'
  AND NOT prosecdef AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u'
  AND NOT proretset AND prorettype='void'::regtype AND pronargdefaults=0
  AND proargnames=ARRAY['_invoice','_command'] AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial target requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

CREATE OR REPLACE FUNCTION public._sales_invoice_payment_projection(_tenant uuid,_invoice uuid,_operation uuid,_remaining bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.paige_invoice_provider_operations%ROWTYPE; invoice public.paige_invoices%ROWTYPE; usable boolean; financial jsonb;
BEGIN
 SELECT * INTO invoice FROM public.paige_invoices WHERE tenant_id=_tenant AND id=_invoice FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO op FROM public.paige_invoice_provider_operations WHERE tenant_id=_tenant AND invoice_id=_invoice AND id=_operation;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation unavailable' USING ERRCODE='42501'; END IF;
 usable:=op.provider='stripe' AND op.state='customer_action_required' AND op.expires_at IS NOT NULL AND op.expires_at>clock_timestamp()
  AND invoice.status='issued' AND op.invoice_version=coalesce(invoice.billing_lifecycle_version,invoice.billing_draft_version)
  AND op.issued_snapshot_version=invoice.billing_issued_snapshot_version AND op.client_id=invoice.contact_id
  AND op.currency=lower(invoice.currency) AND _remaining>0 AND op.amount_minor<=_remaining
  AND op.provider_url ~ '^https://checkout[.]stripe[.]com/c/pay/[A-Za-z0-9_?=&%#./:+-]+$'
  AND EXISTS(SELECT 1 FROM public.tenant_stripe_accounts merchant WHERE merchant.tenant_id=_tenant
   AND merchant.stripe_account_id=op.merchant_account_id AND merchant.binding_version=op.merchant_binding_version
   AND merchant.provider_environment=op.environment AND merchant.charges_enabled AND merchant.sales_payment_permission);
 -- Reuse the canonical current position and accepted-target admission. This is
 -- a READ refusal only: no approval consumption, provider cancellation or charge.
 IF usable THEN
  BEGIN
   SELECT b.financial_position INTO STRICT financial
    FROM public._sales_invoice_financial_position_rows(_tenant,_invoice,3,NULL::jsonb)b;
   usable:=financial->>'financial_standing'='recorded'
    AND op.amount_minor<=(financial->>'actual_outstanding_minor')::numeric;
   IF usable THEN PERFORM public._sales_invoice_require_accepted_obligation(invoice,op.command);END IF;
  EXCEPTION WHEN SQLSTATE '40001' OR SQLSTATE '55000' OR SQLSTATE '22023' THEN
   usable:=false;
  END;
 END IF;
 RETURN jsonb_build_object('amount_minor',op.amount_minor,'currency',op.currency,'state',op.state,
  'provider_url',CASE WHEN usable THEN op.provider_url ELSE NULL END,'expires_at',op.expires_at);
END $$;
-- END ORIGINAL SOURCE exp04_invoice_current_payment_projection.sql

-- BEGIN ORIGINAL SOURCE exp04_invoice_actual_financial_ledger.sql
-- INERT original O5 ledger/document current-financial projection, not a release.
-- SAME immutable history, frozen document, native summary and outer authority.
-- No new ledger, provider call, grant, mutation or financial calculation.
DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('327e4883b78725137137e1ad7349ba20','7484b4ef971f0e84eac8c5967a84103b','0b74d9b00e40b43a536ceb3b5a884c8a')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
  OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_invoice','_limit','_cursor']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
  RAISE EXCEPTION 'Original invoice ledger source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_read(uuid,uuid,integer,integer)')
  AND pg_catalog.md5(prosrc)='9add10afcf85dfbec91f1268248dbb58' AND pg_catalog.pg_get_userbyid(proowner)='postgres'
  AND NOT prosecdef AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u' AND NOT proretset
  AND prorettype='jsonb'::regtype AND pronargdefaults=0 AND proargnames=ARRAY['_tenant','_invoice','_payment_limit','_financial_version']
  AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial reader requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

CREATE OR REPLACE FUNCTION public._sales_invoice_payment_ledger(_tenant uuid,_invoice uuid,_limit integer,_cursor jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; truth jsonb; rows jsonb; balance record; headers jsonb;
 actual boolean; test_receipts numeric; test_reversals numeric; financial jsonb; evidence_version text;
BEGIN
 result:=public._sales_invoice_payment_ledger_before_provider(_tenant,_invoice,_limit,_cursor);
 headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' OR
  (headers ? 'x-paige-invoice-evidence-version' AND
   (jsonb_typeof(headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string'
    OR headers->>'x-paige-invoice-evidence-version' NOT IN('2','3'))) THEN
  RAISE EXCEPTION 'Invoice evidence representation unavailable' USING ERRCODE='22023';
 END IF;
 evidence_version:=headers->>'x-paige-invoice-evidence-version';
 actual:=evidence_version IN('2','3');
 IF actual IS NOT TRUE THEN
  -- Reuse the SAME canonical seven-column compatibility projection. The owner
  -- getter may already serve evidence2; it must not silently change old ledgers.
  SELECT * INTO STRICT balance FROM public._sales_invoice_balance_rows(_tenant,_invoice);
  truth:=public._sales_invoice_read_before_provider(_tenant,_invoice,0);
  truth:=truth||jsonb_build_object('manual_recorded_cents',balance.manual_minor,
   'provider_verified_cents',balance.provider_minor,'allocated_cents',balance.allocated_minor,
   'settlement',CASE WHEN truth->>'status'='void' THEN 'void'
    WHEN balance.provider_minor>0 AND balance.manual_minor>0 AND balance.remaining_minor=0 THEN 'mixed_recorded_settled'
    WHEN balance.provider_minor>0 AND balance.remaining_minor=0 THEN 'provider_verified_settled'
    WHEN balance.provider_minor>0 AND balance.manual_minor>0 THEN 'mixed_recorded_partial'
    WHEN balance.provider_minor>0 THEN 'provider_verified_partial' ELSE truth->>'settlement' END);
  SELECT coalesce(jsonb_agg(row.value||CASE WHEN p.evidence_kind='provider_verified' THEN jsonb_build_object(
   'provenance','provider_verified','provider',p.provider,'provider_operation_id',p.provider_operation_id,
   'provider_verified_at',p.provider_verified_at) ELSE '{}'::jsonb END ORDER BY row.ordinality),'[]'::jsonb)
  INTO rows FROM jsonb_array_elements(result->'payment_ledger'->'rows') WITH ORDINALITY row(value,ordinality)
  LEFT JOIN public.paige_invoice_payments p ON p.id=(row.value->>'id')::uuid AND p.tenant_id=_tenant AND p.invoice_id=_invoice;
  financial:=public._sales_invoice_read(_tenant,_invoice,0,3)->'financial_summary';
  IF result->>'status'<>'void' AND (financial->>'standing' IS DISTINCT FROM 'recorded'
   OR financial->'outstanding_minor' IS DISTINCT FROM result->'remaining_cents'
   OR financial->'refund_payable_minor' IS DISTINCT FROM '0'::jsonb
   OR financial->'credit_minor' IS DISTINCT FROM '0'::jsonb) THEN
   RAISE EXCEPTION 'Invoice ledger financial representation changed; reload' USING ERRCODE='40001';END IF;
  RETURN jsonb_set(result||jsonb_build_object('manual_recorded_cents',truth->'manual_recorded_cents',
   'provider_verified_cents',truth->'provider_verified_cents','allocated_cents',truth->'allocated_cents',
   'settlement',truth->'settlement'),'{payment_ledger,rows}',rows);
 END IF;

 truth:=public._sales_invoice_read(_tenant,_invoice,0);
 SELECT * INTO STRICT balance FROM public._sales_invoice_financial_position_rows(_tenant,_invoice);
 -- The preserved three-argument getter is historical. Copy actual evidence from
 -- the SAME canonical native position without changing that getter's contract.
 truth:=truth||jsonb_build_object('manual_recorded_cents',balance.manual_minor,
  'provider_verified_cents',balance.live_provider_minor,'test_provider_verified_cents',balance.test_provider_minor,
  'allocated_cents',balance.receivable_allocated_minor,'remaining_cents',balance.receivable_remaining_minor,'settlement',CASE WHEN result->>'status'='void' THEN 'void'
   WHEN balance.live_provider_minor>0 AND balance.manual_minor>0 AND balance.receivable_remaining_minor=0 THEN 'mixed_recorded_settled'
   WHEN balance.live_provider_minor>0 AND balance.receivable_remaining_minor=0 THEN 'provider_verified_settled'
   WHEN balance.live_provider_minor>0 AND balance.manual_minor>0 THEN 'mixed_recorded_partial'
   WHEN balance.live_provider_minor>0 THEN 'provider_verified_partial'
   WHEN balance.manual_minor>0 AND balance.receivable_remaining_minor=0 THEN 'manually_recorded_settled'
   WHEN balance.manual_minor>0 THEN 'manually_recorded_partial' ELSE 'unpaid' END);
 -- Extend the incumbent native history with its TEST component under EXACTLY
 -- the original ordering. The original running amounts and gross totals stay
 -- inspectable; no browser infers debt from a partial page or a test receipt.
 WITH classified AS (
  SELECT p.*,CASE WHEN evidence_kind='provider_verified' AND provider_environment='test'
   THEN CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END ELSE 0 END AS test_delta,
   CASE WHEN evidence_kind='provider_verified' AND provider_environment='test' AND kind='receipt' THEN amount_cents ELSE 0 END AS test_receipt,
   CASE WHEN evidence_kind='provider_verified' AND provider_environment='test' AND kind='reversal' THEN amount_cents ELSE 0 END AS test_reversal
  FROM public.paige_invoice_payments p WHERE tenant_id=_tenant AND invoice_id=_invoice
 ), ordered AS (
  SELECT p.*,sum(test_delta) OVER (ORDER BY created_at,CASE WHEN kind='receipt' THEN 0 ELSE 1 END,id
   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS test_running FROM classified p
 )
 SELECT (SELECT coalesce(sum(test_receipt),0) FROM ordered),
  (SELECT coalesce(sum(test_reversal),0) FROM ordered),
  (SELECT coalesce(jsonb_agg(row.value||jsonb_build_object('evidence_kind',p.evidence_kind,
    'provider_environment',CASE WHEN p.evidence_kind='provider_verified' THEN p.provider_environment END,
    'receivable_running_received_cents',(row.value->>'running_received_cents')::numeric-p.test_running,
    'receivable_running_remaining_cents',(row.value->>'running_remaining_cents')::numeric+p.test_running)
   ||CASE WHEN p.evidence_kind='provider_verified' THEN jsonb_build_object('provenance','provider_verified',
    'provider',p.provider,'provider_operation_id',p.provider_operation_id,'provider_verified_at',p.provider_verified_at)
    ELSE '{}'::jsonb END ORDER BY row.ordinality),'[]'::jsonb)
   FROM jsonb_array_elements(result->'payment_ledger'->'rows') WITH ORDINALITY row(value,ordinality)
   JOIN ordered p ON p.id=(row.value->>'id')::uuid)
 INTO test_receipts,test_reversals,rows;
 result:=jsonb_set(result,'{payment_ledger}',(result->'payment_ledger')||jsonb_build_object(
  'rows',rows,'receivable_receipt_total_cents',(result#>>'{payment_ledger,receipt_total_cents}')::numeric-test_receipts,
  'receivable_reversal_total_cents',(result#>>'{payment_ledger,reversal_total_cents}')::numeric-test_reversals));
 result:=result||jsonb_build_object('payment_evidence_version',2,
  'manual_recorded_cents',truth->'manual_recorded_cents','provider_verified_cents',truth->'provider_verified_cents',
  'test_provider_verified_cents',truth->'test_provider_verified_cents','allocated_cents',truth->'allocated_cents',
  'remaining_cents',truth->'remaining_cents','settlement',truth->'settlement');
 financial:=public._sales_invoice_read(_tenant,_invoice,0,3)->'financial_summary';
 IF financial->'invoice_id' IS DISTINCT FROM to_jsonb(_invoice)
  OR financial->'invoice_version' IS DISTINCT FROM result->'version'
  OR financial->'manual_recorded_minor' IS DISTINCT FROM result->'manual_recorded_cents'
  OR financial->'provider_confirmed_minor' IS DISTINCT FROM result->'provider_verified_cents'
  OR financial->'test_provider_minor' IS DISTINCT FROM result->'test_provider_verified_cents' THEN
  RAISE EXCEPTION 'Invoice ledger financial source changed; reload' USING ERRCODE='40001';END IF;
 IF evidence_version='3' THEN
  RETURN result||jsonb_build_object('financial_evidence_version',3,'financial_summary',financial,
   'currency',financial->'currency','remaining_cents',financial->'outstanding_minor',
   'settlement',CASE WHEN result->>'status'='void' THEN 'void'
    WHEN financial->>'standing'<>'recorded' THEN 'verification_pending'
    WHEN (financial->>'outstanding_minor')::numeric=0 THEN 'no_amount_due' ELSE 'outstanding' END);
 END IF;
 IF result->>'status'<>'void' AND (financial->>'standing' IS DISTINCT FROM 'recorded'
  OR financial->'outstanding_minor' IS DISTINCT FROM result->'remaining_cents'
  OR financial->'refund_payable_minor' IS DISTINCT FROM '0'::jsonb
  OR financial->'credit_minor' IS DISTINCT FROM '0'::jsonb) THEN
  RAISE EXCEPTION 'Invoice ledger financial representation changed; reload' USING ERRCODE='40001';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) FROM PUBLIC;
-- END ORIGINAL SOURCE exp04_invoice_actual_financial_ledger.sql

-- BEGIN ORIGINAL SOURCE exp04_invoice_actual_public_payment_read.sql
-- INERT original public bearer payment-request financial representation.
-- Original token/expiry/revocation/invoice-version locks and service-only ACL unchanged.
DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.read_public_sales_invoice_payment_request(text)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('fa82176ce57fba9b1b9d82080ce07bc0','b7b62fe3131bea45818bfd99ccc9c01d')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
  OR p.proargnames IS DISTINCT FROM ARRAY['_token_hash'] OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
  RAISE EXCEPTION 'Original bearer payment source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_read(uuid,uuid,integer,integer)')
  AND pg_catalog.md5(prosrc)='9add10afcf85dfbec91f1268248dbb58'
  AND pg_catalog.pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial reader requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

CREATE OR REPLACE FUNCTION public.read_public_sales_invoice_payment_request(_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE truth jsonb; grant_row public.paige_invoice_access_grants%ROWTYPE; invoice public.paige_invoices%ROWTYPE; op_id uuid; request jsonb; headers jsonb; evidence_version text; financial jsonb; environment text;
BEGIN
 -- Preserve the existing bearer contract: no alternate grant or identity store.
 truth:=public.read_public_sales_invoice(_token_hash);
 IF truth IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO grant_row FROM public.paige_invoice_access_grants WHERE token_hash=_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO invoice FROM public.paige_invoices WHERE tenant_id=grant_row.tenant_id AND id=grant_row.invoice_id
  AND status='issued' AND billing_issued_snapshot_version=grant_row.issued_snapshot_version FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Representation never grants authority; original bearer and invoice locks precede it.
 headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' OR (headers ? 'x-paige-invoice-evidence-version' AND
  (jsonb_typeof(headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string'
    OR headers->>'x-paige-invoice-evidence-version' NOT IN('2','3'))) THEN
  RAISE EXCEPTION 'Invoice payment representation unavailable' USING ERRCODE='22023';END IF;
 evidence_version:=headers->>'x-paige-invoice-evidence-version';
 truth:=public._sales_invoice_read(invoice.tenant_id,invoice.id,0);
 financial:=public._sales_invoice_read(invoice.tenant_id,invoice.id,0,3)->'financial_summary';
 IF evidence_version='3' THEN
  truth:=truth||jsonb_build_object('remaining_cents',financial->'outstanding_minor');
 ELSIF financial->>'standing' IS DISTINCT FROM 'recorded'
  OR financial->'outstanding_minor' IS DISTINCT FROM truth->'remaining_cents'
  OR financial->'refund_payable_minor' IS DISTINCT FROM '0'::jsonb
  OR financial->'credit_minor' IS DISTINCT FROM '0'::jsonb THEN
  RAISE EXCEPTION 'Invoice financial representation changed' USING ERRCODE='40001';END IF;
 SELECT id,public.paige_invoice_provider_operations.environment INTO op_id,environment FROM public.paige_invoice_provider_operations WHERE tenant_id=invoice.tenant_id AND invoice_id=invoice.id ORDER BY created_at DESC,id DESC LIMIT 1;
 IF FOUND AND (evidence_version IS DISTINCT FROM '3' OR (financial->>'standing'='recorded' AND (truth->>'remaining_cents')::bigint>0)) THEN
  request:=public._sales_invoice_payment_projection(invoice.tenant_id,invoice.id,op_id,(truth->>'remaining_cents')::bigint);
  IF evidence_version='3' THEN request:=request||jsonb_build_object('environment',environment);END IF;
 END IF;
 RETURN jsonb_build_object('invoice_number',invoice.invoice_number,'remaining_cents',truth->'remaining_cents','payment_request',request)
  ||CASE WHEN evidence_version='3' THEN jsonb_build_object(
    'invoice_id',invoice.id,'invoice_version',invoice.billing_lifecycle_version,'currency',financial->'currency',
    'payment_evidence_version',2,'financial_evidence_version',3,'financial_summary',financial) ELSE '{}'::jsonb END;
END $function$
;
-- END ORIGINAL SOURCE exp04_invoice_actual_public_payment_read.sql

DO $e04_after$
DECLARE wanted jsonb;actual jsonb;
BEGIN
 FOR wanted IN SELECT value FROM pg_catalog.jsonb_array_elements('[{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"15e147c5da416624ed82e4a5ced5d64f","leakproof":false,"signature":"_client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_tenant","_client","p_limit","p_after","p_as_of"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"1a622edb93cf9041638be41b615020c4","leakproof":false,"signature":"_client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_tenant","_client","p_limit","p_after","p_as_of","p_payment_evidence_version"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"0984be5b78c147cd16a3c3319f27531a","leakproof":false,"signature":"_preview_sales_invoice_before_provider(uuid,uuid,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor_user_id","_expected_tenant_id","_command"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"60f37a887ee106ef7761260fdeb6b637","leakproof":false,"signature":"_sales_invoice_accepted_obligations(paige_invoices,uuid)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_invoice","_signing_id"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"56ae7991f59c2d40d5a6bea5fae562ad","leakproof":false,"signature":"_sales_invoice_accepted_obligations(paige_invoices,uuid,integer)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_invoice","_signing_id","_evidence_version"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"TABLE(invoice_id uuid, amount_minor bigint, allocated_minor numeric, remaining_minor numeric, manual_minor numeric, provider_minor numeric, test_provider_minor numeric)","strict":false,"definer":true,"defaults":"NULL::uuid","parallel":"u","settings":["search_path=\"\""],"body_hash":"b3b441de27b0ccc994e3c5ed2482458c","leakproof":false,"signature":"_sales_invoice_balance_rows(uuid,uuid)","volatility":"s","returns_set":true,"default_count":1,"argument_names":["_tenant","_invoice","invoice_id","amount_minor","allocated_minor","remaining_minor","manual_minor","provider_minor","test_provider_minor"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"bigint","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"97ad63a1e9284ae38d8fade870f1c119","leakproof":false,"signature":"_sales_invoice_collectible_balance(paige_invoices)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_invoice"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"TABLE(invoice_id uuid, amount_minor bigint, allocated_minor numeric, remaining_minor numeric, manual_minor numeric, provider_minor numeric, test_provider_minor numeric, receivable_allocated_minor numeric, receivable_remaining_minor numeric, live_provider_minor numeric)","strict":false,"definer":true,"defaults":"NULL::uuid","parallel":"u","settings":["search_path=\"\""],"body_hash":"79b52a906a3ee48a254461d176f17f23","leakproof":false,"signature":"_sales_invoice_financial_position_rows(uuid,uuid)","volatility":"s","returns_set":true,"default_count":1,"argument_names":["_tenant","_invoice","invoice_id","amount_minor","allocated_minor","remaining_minor","manual_minor","provider_minor","test_provider_minor","receivable_allocated_minor","receivable_remaining_minor","live_provider_minor"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"TABLE(invoice_id uuid, financial_position jsonb)","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"a7ed0b1ba940c0e5b70b8cf0742356bb","leakproof":false,"signature":"_sales_invoice_financial_position_rows(uuid,uuid,integer)","volatility":"s","returns_set":true,"default_count":0,"argument_names":["_tenant","_invoice","_evidence_version","invoice_id","financial_position"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"TABLE(invoice_id uuid, financial_position jsonb)","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"bdb0960fa3d88b21cca90b79636dc7e1","leakproof":false,"signature":"_sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)","volatility":"v","returns_set":true,"default_count":0,"argument_names":["_tenant","_invoice","_evidence_version","_proposal","invoice_id","financial_position"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"integer","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"6299914dc1e7aab1013afd60bd726d70","leakproof":false,"signature":"_sales_invoice_financial_read_version()","volatility":"v","returns_set":false,"default_count":0,"argument_names":null},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"0b74d9b00e40b43a536ceb3b5a884c8a","leakproof":false,"signature":"_sales_invoice_payment_ledger(uuid,uuid,integer,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_tenant","_invoice","_limit","_cursor"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"9577250340dcf99070b466bb40bef3a7","leakproof":false,"signature":"_sales_invoice_payment_projection(uuid,uuid,uuid,bigint)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_tenant","_invoice","_operation","_remaining"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"trigger","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"ccbc654b650c3a096ae9779646448a5f","leakproof":false,"signature":"_sales_invoice_payment_request_mutation_guard()","volatility":"v","returns_set":false,"default_count":0,"argument_names":null},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"32d720cfc173d16bef0564abbf26d6f2","leakproof":false,"signature":"_sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor_user_id","_expected_tenant_id","_operation_id","_command","_governance"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"cae753fff111f8b5697abf86350328ea","leakproof":false,"signature":"_sales_invoice_prior_preview(uuid,uuid,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor_user_id","_expected_tenant_id","_command"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"void","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"0ea6025702c9694ce9280593e1b606d0","leakproof":false,"signature":"_sales_invoice_provider_disposition_command(jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_command"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"702541a74b3d130273b0bbf31cc8b158","leakproof":false,"signature":"_sales_invoice_provider_disposition_history(paige_invoices,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_invoice","_payment"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"void","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"0569823560c5827a32010ef9572c20ba","leakproof":false,"signature":"_sales_invoice_provider_disposition_receipt(paige_invoice_operations)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_entry"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"656219ca9ff0d7159c4f367de38f7fa1","leakproof":false,"signature":"_sales_invoice_provider_disposition_review(uuid,uuid,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor","_tenant","_command"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":"50","parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"c1fec742f8ff2a3753b58a9800ce5fab","leakproof":false,"signature":"_sales_invoice_read(uuid,uuid,integer)","volatility":"v","returns_set":false,"default_count":1,"argument_names":["_tenant","_invoice","_payment_limit"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"9add10afcf85dfbec91f1268248dbb58","leakproof":false,"signature":"_sales_invoice_read(uuid,uuid,integer,integer)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_tenant","_invoice","_payment_limit","_financial_version"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"fbfa85be667382e21f24019f589a12af","leakproof":false,"signature":"_sales_invoice_record_provider_disposition(uuid,uuid,uuid,jsonb,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor","_tenant","_operation","_command","_governance"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"void","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"e07fdfc39975c26c2ec07f0ac290ba2c","leakproof":false,"signature":"_sales_invoice_require_accepted_obligation(paige_invoices,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_invoice","_command"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"void","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"59e7d7273b26ddd8487a649f302c525e","leakproof":false,"signature":"_sales_invoice_require_manual_allocations(paige_invoices,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_invoice","_command"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"text","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"be291085dc32f328c88098b7ffe32b21","leakproof":false,"signature":"_sales_provider_observation_balance(jsonb,bigint,text)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_value","_amount","_currency"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"7dc2ab9583e32a7584aa5b7abcf5e565","leakproof":false,"signature":"_sales_provider_observation_entry(paige_invoice_provider_operations,paige_invoice_operations,bigint,boolean)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_operation","_entry","_expected","_require_rail"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"trigger","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"078708cd506402a81693cbefd4bf214e","leakproof":false,"signature":"_sales_provider_observation_link_guard()","volatility":"v","returns_set":false,"default_count":0,"argument_names":null},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"88288fcf1a5a929afe60bd62ca90ddee","leakproof":false,"signature":"_sales_provider_observation_snapshot(jsonb,text,bigint)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_value","_currency","_gross"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"timestamp with time zone","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"485a4f4fe9a5eb888410d53fcb90e1cb","leakproof":false,"signature":"_sales_provider_observation_time(jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_value"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"b5255e2e7aa06b0e39e2a630cf664678","leakproof":false,"signature":"_sales_provider_observation_work_payload(uuid,text)","volatility":"s","returns_set":false,"default_count":0,"argument_names":["_operation","_event"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"paige_invoice_provider_operations","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"45c16980d4a18c70c25a5203d40c56c0","leakproof":false,"signature":"_sales_provider_observation_work_scope(paige_durable_work)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_work"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"17310e2c68bc386ecbc0f2850476006d","leakproof":false,"signature":"allocate_verified_sales_invoice_payment(uuid,uuid,uuid,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_expected_tenant_id","_operation_id","_claim_token","_readback"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"316accdf44a20806402c40cf690f0b14","leakproof":false,"signature":"claim_sales_invoice_payment_request(uuid,uuid,uuid)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_expected_tenant_id","_operation_id","_claim_token"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":"3","parallel":"u","settings":["search_path=\"\""],"body_hash":"e57aa6c031eacd6a5ed8987c651ae3d0","leakproof":false,"signature":"claim_sales_provider_observation_work(integer)","volatility":"v","returns_set":false,"default_count":1,"argument_names":["_limit"]},{"acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":"NULL::uuid","parallel":"u","settings":["search_path=public, pg_temp"],"body_hash":"5addaaad6dbb3186f3b5ff67457ee009","leakproof":false,"signature":"client_portal_invoice_payment_request(uuid,uuid)","volatility":"v","returns_set":false,"default_count":1,"argument_names":["p_invoice_id","p_tenant_id"]},{"acl":"{postgres=X/postgres,authenticated=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":"20, NULL::jsonb","parallel":"u","settings":["search_path=\"\""],"body_hash":"a79ff5475d861a26f92c578effb73060","leakproof":false,"signature":"client_portal_invoices_calendar_scoped(uuid,uuid,integer,jsonb)","volatility":"v","returns_set":false,"default_count":2,"argument_names":["p_tenant_id","p_expected_client_id","p_limit","p_after"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"47f8720b61d72619e94208ed845499f5","leakproof":false,"signature":"complete_sales_provider_observation_work(uuid,uuid,text,integer,bigint,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_expected_tenant_id","_work_id","_server_idempotency_key","_attempt_count","_expected_observation_version","_snapshot"]},{"acl":"{postgres=X/postgres,authenticated=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":"''invoice''::text, 50, NULL::jsonb","parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"d78b32cd02cb348e7e7811f9ca7c4cb3","leakproof":false,"signature":"list_sales_collection_register(uuid,text,integer,jsonb)","volatility":"v","returns_set":false,"default_count":3,"argument_names":["_expected_tenant_id","_entity","_limit","_cursor"]},{"acl":"{postgres=X/postgres,authenticated=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":"50, NULL::uuid","parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"f392e57d33a2dcdf5158cb42a80ded84","leakproof":false,"signature":"list_sales_invoices(uuid,integer,uuid)","volatility":"v","returns_set":false,"default_count":2,"argument_names":["_expected_tenant_id","_limit","_before_id"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"efefcdbf889d8524bd2b2440c4b8e055","leakproof":false,"signature":"prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor_user_id","_expected_tenant_id","_operation_id","_command","_governance"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"b7b62fe3131bea45818bfd99ccc9c01d","leakproof":false,"signature":"read_public_sales_invoice_payment_request(text)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_token_hash"]},{"acl":"{postgres=X/postgres,authenticated=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"643d1d0eeb54e8505ab86d67a0120f27","leakproof":false,"signature":"read_sales_accepted_invoice_obligations(uuid,uuid,uuid)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_expected_tenant_id","_invoice_id","_agreement_id"]},{"acl":"{postgres=X/postgres,authenticated=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"fbd612d884e351f6f860802139d6ab80","leakproof":false,"signature":"read_sales_invoice(uuid,uuid)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_expected_tenant_id","_invoice_id"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=pg_catalog, public"],"body_hash":"56ec1895857826f62c786f6f7287fdd9","leakproof":false,"signature":"read_sales_invoice_command_result(uuid,uuid,uuid,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor_user_id","_expected_tenant_id","_operation_id","_command"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"04bfed78729d469de33c16c820358859","leakproof":false,"signature":"read_sales_invoice_payment_obligation(uuid,uuid,uuid,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_actor_user_id","_expected_tenant_id","_invoice_id","_reference"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"cdda3983c717bae79bb80af71c0a5c54","leakproof":false,"signature":"read_sales_invoice_provider_observation_context(uuid,uuid)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_expected_tenant_id","_operation_id"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"0d9157ce406491659453729f042578a2","leakproof":false,"signature":"read_sales_provider_observation_work_context(uuid,uuid,text,integer)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_expected_tenant_id","_work_id","_server_idempotency_key","_attempt_count"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"950fdbc386da780ae6ccefa89d0a0043","leakproof":false,"signature":"record_sales_invoice_provider_observation(uuid,uuid,uuid,bigint,jsonb,text)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_expected_tenant_id","_operation_id","_claim_token","_expected_observation_version","_snapshot","_reference"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"cd09b6bad67b955e6e8b26f01df2fdf2","leakproof":false,"signature":"register_sales_provider_observation_event(text,text,text,text,text)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_event_id","_event_type","_merchant_account_id","_environment","_provider_transaction_id"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":true,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"2f771a4ab5ff3c24f410296de504a75d","leakproof":false,"signature":"register_sales_provider_observation_work(uuid,uuid,text,text,text,text)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_expected_tenant_id","_operation_id","_event_id","_merchant_account_id","_environment","_provider_transaction_id"]},{"acl":"{postgres=X/postgres}","owner":"postgres","result":"jsonb","strict":false,"definer":false,"defaults":null,"parallel":"u","settings":["search_path=\"\""],"body_hash":"0a70d5ed7b157fa68472bbf24785be1a","leakproof":false,"signature":"_client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb)","volatility":"v","returns_set":false,"default_count":0,"argument_names":["_tenant","_client","p_limit","p_after"]}]'::jsonb) LOOP
  actual:=NULL;
  SELECT jsonb_build_object('signature',wanted->>'signature','body_hash',pg_catalog.md5(p.prosrc),
 'owner',pg_catalog.pg_get_userbyid(p.proowner),'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,
 'strict',p.proisstrict,'leakproof',p.proleakproof,'result',pg_catalog.pg_get_function_result(p.oid),'returns_set',p.proretset,
 'defaults',pg_catalog.pg_get_expr(p.proargdefaults,0),'default_count',p.pronargdefaults,
 'argument_names',p.proargnames,'settings',p.proconfig,'acl',p.proacl::text)
 INTO actual FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure('public.'||(wanted->>'signature'));
  IF actual IS DISTINCT FROM wanted THEN
   RAISE EXCEPTION 'Original E04 financial after source/authority changed: %',wanted->>'signature' USING ERRCODE='23514';
  END IF;
 END LOOP;

END $e04_after$;
COMMIT;
