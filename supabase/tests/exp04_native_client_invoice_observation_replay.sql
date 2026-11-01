-- Only the original isolated full-schema job invokes this, AFTER its synthetic
-- status fixture has rolled back. Historical04's immutable dependency guard
-- correctly refuses the later15 Auth-wrapper source (actual8dd negative proof).
-- Reproduce ONLY its three exact historical dependencies in this DISPOSABLE schema,
-- replay unchanged04 with all eight original checks, then restore the exact
-- final definitions and compare ALL fourteen complete current function records.
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
  'public._client_portal_financial_actor_current(uuid,uuid,uuid)'::regprocedure,
  'public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)'::regprocedure,
  'public.client_portal_assistant_invoices_context(uuid,uuid)'::regprocedure);
create temp table e04_native_invoice_final_wrapper as
 select oid,pg_get_functiondef(oid) as definition,prosrc as body from pg_proc
 where oid in ('public._client_portal_billing_client(uuid)'::regprocedure,
  'public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)'::regprocedure,
  'public._client_portal_invoice_observation_for_client(uuid,uuid)'::regprocedure);
\ir fixtures/exp04_legacy_invoice_query.sql
do $original_compatibility$
declare original text; final_body text; final_definition text; query_body text; step record; current_body text; old_body text;
begin
 select replace(replace(replace(prosrc,'_uid uuid := p_actor_id;','_uid uuid := auth.uid();'),
  'public.is_platform_owner(p_actor_id)','public.is_platform_owner()'),
  'public._client_portal_lock_relationship_for_actor(p_tenant_id,''share'',p_actor_id,p_use_request_business)',
  'public._client_portal_lock_relationship(p_tenant_id, ''share'')')
 into strict original from pg_proc
 where oid='public._client_portal_billing_client_for_actor(uuid,uuid,boolean)'::regprocedure;
 select definition,body into strict final_definition,final_body from e04_native_invoice_final_wrapper
 where oid='public._client_portal_billing_client(uuid)'::regprocedure;
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
 -- Exact historical bodies only; retain the original immutable migration guard.
 SELECT body INTO STRICT current_body FROM e04_native_invoice_final_wrapper WHERE oid='public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)'::regprocedure;
 SELECT prosrc INTO STRICT query_body FROM pg_proc WHERE oid='pg_temp.e04_legacy_invoice_oracle(uuid,uuid,integer,jsonb)'::regprocedure;
 IF md5(current_body)<>'15e147c5da416624ed82e4a5ced5d64f' OR md5(query_body)<>'d86613d312960b0d507898210e7e5197' THEN
  RAISE EXCEPTION 'FAIL: current delegate or frozen original source changed'; END IF;
  FOR step IN SELECT * FROM (VALUES ('  _today date := (now() AT TIME ZONE ''UTC'')::date;','  _today date := p_as_of;'),
('  IF _tenant IS NULL OR _client IS NULL THEN
    RAISE EXCEPTION ''CLIENT_INVOICE_UNAVAILABLE'' USING ERRCODE=''42501'';
  END IF;','  IF _tenant IS NULL OR _client IS NULL THEN
    RAISE EXCEPTION ''CLIENT_INVOICE_UNAVAILABLE'' USING ERRCODE=''42501'';
  END IF;
  IF p_as_of IS NOT NULL AND NOT isfinite(p_as_of) THEN
    RAISE EXCEPTION ''CLIENT_INVOICE_INPUT_INVALID'' USING ERRCODE=''22023'';
  END IF;'),
('      i.billing_issued_at AS issued_at,','      i.billing_issued_at AS issued_at, i.billing_issued_snapshot_version AS issued_snapshot_version,'),
('      ''issued_at'', p.issued_at, ''due_date'', p.due_date,','      ''issued_at'', p.issued_at, ''due_date'', p.due_date,
      ''issued_snapshot_version'', p.issued_snapshot_version,'),
('    ''read_at'', statement_timestamp()','    ''_native_sources'', jsonb_build_object(''as_of_date'',p_as_of,''all_facts_identity'',
      encode(extensions.digest(coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM facts f),''[]''::jsonb)::text,''sha256''),''hex'')),
    ''read_at'', statement_timestamp()')) s(before,after) LOOP
   IF (length(query_body)-length(replace(query_body,step.before,'')))/length(step.before)<>1 THEN
    RAISE EXCEPTION 'FAIL: historical query factoring anchor changed'; END IF;
   query_body:=replace(query_body,step.before,step.after);
  END LOOP;
 IF md5(query_body)<>'a307bf9e57e5b2ad692c74a329e683cd' THEN RAISE EXCEPTION 'FAIL: complete historical query differs'; END IF;
 SELECT definition INTO STRICT final_definition FROM e04_native_invoice_final_wrapper WHERE oid='public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)'::regprocedure;
 EXECUTE replace(final_definition,current_body,query_body);
 SELECT definition,body INTO STRICT final_definition,current_body FROM e04_native_invoice_final_wrapper WHERE oid='public._client_portal_invoice_observation_for_client(uuid,uuid)'::regprocedure;
 old_body:=replace(current_body,'(calendar->>''local_date'')::date,3);','(calendar->>''local_date'')::date);');
 IF md5(current_body)<>'ac2601955788964e062e6ec89db8b350' OR md5(old_body)<>'83f32502da913d873d3454e4fc12671d' THEN
  RAISE EXCEPTION 'FAIL: complete historical observation inverse differs'; END IF;
 EXECUTE replace(final_definition,current_body,old_body);
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
declare changed integer; item record;
begin
 FOR item IN SELECT definition FROM e04_native_invoice_final_wrapper ORDER BY oid LOOP EXECUTE item.definition; END LOOP;
 select count(*) into changed from e04_native_invoice_final_metadata b
 full join (select p.oid,to_jsonb(p) as metadata from pg_proc p
  where p.oid in (select oid from e04_native_invoice_final_metadata)) a using(oid)
 where b.metadata is distinct from a.metadata;
 if changed<>0 or (select count(*) from e04_native_invoice_final_metadata)<>14 then
  raise exception 'FAIL: historical replay did not conserve every final body, OID, ABI, owner, permission and setting';
 end if;
 raise notice 'PASS: historical replay restores all fourteen complete final financial function records';
end $final_source_restoration$;
drop table e04_native_invoice_final_wrapper;
drop table e04_native_invoice_final_metadata;
