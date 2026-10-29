-- Only the original isolated full-schema job invokes this, AFTER its synthetic
-- status fixture has rolled back. Reapply the actual unchanged migration and
-- verify every original/new ABI, source, owner, grant and setting remains exact.
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
