-- Only the original isolated full-schema job invokes this, AFTER its synthetic
-- status fixture has rolled back. Historical04's immutable dependency guard
-- correctly refuses the later15 Auth-wrapper source (actual8dd negative proof).
-- Reproduce ONLY its original compatible billing body in this DISPOSABLE schema,
-- replay unchanged04 with all eight original checks, then restore the exact
-- final definition and compare ALL twelve complete current function records.
-- Never run this fixture against a hosted/customer database or change a ledger.
create temp table e04_native_invoice_final_metadata as
 select p.oid,to_jsonb(p) as metadata from pg_proc p where p.oid in (
  'public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb)'::regprocedure,
  'public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)'::regprocedure,
  'public.read_business_time_zone(uuid)'::regprocedure,
  'public._business_time_zone_for_tenant(uuid,timestamp with time zone)'::regprocedure,
  'public._client_portal_invoice_observation_for_client(uuid,uuid)'::regprocedure,
  'public.client_portal_invoices(uuid,integer,jsonb)'::regprocedure,
  'public._client_portal_billing_client(uuid)'::regprocedure,
  'public.client_portal_invoices_scoped(uuid,uuid,integer,jsonb)'::regprocedure,
  'public._client_portal_relationship_for_actor(uuid,uuid,boolean)'::regprocedure,
  'public._client_portal_lock_relationship_for_actor(uuid,text,uuid,boolean)'::regprocedure,
  'public._client_portal_billing_client_for_actor(uuid,uuid,boolean)'::regprocedure,
  'public._client_portal_financial_actor_current(uuid,uuid,uuid)'::regprocedure);
create temp table e04_native_invoice_final_wrapper as
 select pg_get_functiondef(oid) as definition,prosrc as body from pg_proc
 where oid='public._client_portal_billing_client(uuid)'::regprocedure;
do $original_compatibility$
declare original text; final_body text; final_definition text;
begin
 select replace(replace(replace(prosrc,'_uid uuid := p_actor_id;','_uid uuid := auth.uid();'),
  'public.is_platform_owner(p_actor_id)','public.is_platform_owner()'),
  'public._client_portal_lock_relationship_for_actor(p_tenant_id,''share'',p_actor_id,p_use_request_business)',
  'public._client_portal_lock_relationship(p_tenant_id, ''share'')')
 into strict original from pg_proc
 where oid='public._client_portal_billing_client_for_actor(uuid,uuid,boolean)'::regprocedure;
 select definition,body into strict final_definition,final_body from e04_native_invoice_final_wrapper;
 if md5(original)<>'7785ae6623f447c23b040d06d3c701a2'
  or md5(final_body)<>'e7e882b76516c67b6a9b5a4e03dce37b'
  or (length(final_definition)-length(replace(final_definition,final_body,'')))/length(final_body)<>1 then
  raise exception 'FAIL: historical replay compatibility source is not the exact original and final wrapper';
 end if;
 execute replace(final_definition,final_body,original);
 if (select md5(prosrc) from pg_proc where oid='public._client_portal_billing_client(uuid)'::regprocedure)
  <>'7785ae6623f447c23b040d06d3c701a2' then
  raise exception 'FAIL: historical replay did not restore its exact original dependency';
 end if;
end $original_compatibility$;
create temp table e04_native_invoice_replay_metadata as
 select p.oid,to_jsonb(p) as metadata from pg_proc p where p.oid in (
  'public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb)'::regprocedure,
  'public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)'::regprocedure,
  'public.read_business_time_zone(uuid)'::regprocedure,
  'public._business_time_zone_for_tenant(uuid,timestamp with time zone)'::regprocedure,
  'public._client_portal_invoice_observation_for_client(uuid,uuid)'::regprocedure,
  'public.client_portal_invoices(uuid,integer,jsonb)'::regprocedure,
  'public._client_portal_billing_client(uuid)'::regprocedure,
  'public.client_portal_invoices_scoped(uuid,uuid,integer,jsonb)'::regprocedure);
\ir ../migrations/20271126010004_e04_native_client_invoice_observation.sql
do $replay$
declare changed integer; zone_source text; helper_source text; original_tail text; original_source text;
 delegate text:=E' RETURN public._business_time_zone_for_tenant(_expected_tenant_id,read_at)||jsonb_build_object(''can_set'',owner);\nEND;\n';
 owner_field text:=E',\n  -- Whether THIS caller may change it (set_business_time_zone is owner-only).\n  ''can_set'',owner';
 return_anchor text:='''local_date'',local_date,''read_at'',read_at)';
begin
 select count(*) into changed from pg_temp.e04_native_invoice_replay_metadata b
  full join (select p.oid,to_jsonb(p) as metadata from pg_proc p
   where p.oid in (select oid from pg_temp.e04_native_invoice_replay_metadata)) a using(oid)
  where b.metadata is distinct from a.metadata;
 if changed<>0 or (select count(*) from pg_temp.e04_native_invoice_replay_metadata)<>8 then
  raise exception 'FAIL: native invoice replay changed a body, OID, ABI, permission or setting';
 end if;
 raise notice 'PASS: whole native invoice replay preserves all eight complete function records';
 select prosrc into strict zone_source from pg_proc where oid='public.read_business_time_zone(uuid)'::regprocedure;
 select prosrc into strict helper_source from pg_proc where oid='public._business_time_zone_for_tenant(uuid,timestamp with time zone)'::regprocedure;
 if strpos(helper_source,' SELECT z.time_zone,z.set_at INTO zone,zone_set_at FROM')=0 then
  raise exception 'FAIL: original factored business calendar anchor missing';
 end if;
 original_tail:=substr(helper_source,strpos(helper_source,' SELECT z.time_zone,z.set_at INTO zone,zone_set_at FROM'));
 if (length(original_tail)-length(replace(original_tail,return_anchor,'')))/length(return_anchor)<>1
  or (length(zone_source)-length(replace(zone_source,delegate,'')))/length(delegate)<>1 then
  raise exception 'FAIL: original calendar whole-inverse anchors differ';
 end if;
 original_tail:=replace(original_tail,return_anchor,'''local_date'',local_date,''read_at'',read_at'||owner_field||')');
 original_source:=replace(zone_source,delegate,original_tail);
 if md5(original_source)<>'4fc91b47874d78ccac6728dcd95eb126' then
  raise exception 'FAIL: whole original calendar, owner authority and output inverse differs';
 end if;
 raise notice 'PASS: native inverse reproduces the entire original business calendar and owner reader';
end $replay$;
drop table e04_native_invoice_replay_metadata;
do $final_source_restoration$
declare changed integer;
begin
 execute (select definition from e04_native_invoice_final_wrapper);
 select count(*) into changed from e04_native_invoice_final_metadata b
 full join (select p.oid,to_jsonb(p) as metadata from pg_proc p
  where p.oid in (select oid from e04_native_invoice_final_metadata)) a using(oid)
 where b.metadata is distinct from a.metadata;
 if changed<>0 or (select count(*) from e04_native_invoice_final_metadata)<>12 then
  raise exception 'FAIL: historical replay did not conserve every final body, OID, ABI, owner, permission and setting';
 end if;
 raise notice 'PASS: historical replay restores all twelve complete final financial function records';
end $final_source_restoration$;
drop table e04_native_invoice_final_wrapper;
drop table e04_native_invoice_final_metadata;
