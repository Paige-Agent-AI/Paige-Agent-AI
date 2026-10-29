-- Full-schema metadata/API isolation proof. No customer or provider data.
-- Retain all171 original Portal controls and the whole original query/authority
-- pins. A five-argument move must reproduce the entire original financial body.
begin;
create function pg_temp.e04_core_check(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.e04_core_refused(stmt text,label text) returns void language plpgsql as $$
begin begin execute stmt; exception when insufficient_privilege then raise notice 'PASS: %',label; return; end;
 raise exception 'FAIL: % accepted',label; end $$;
do $identity$ declare core pg_catalog.pg_proc%rowtype; wrapper pg_catalog.pg_proc%rowtype; original text; query_body text; step record;
 declarations text:=E'  _client uuid;\n  _tenant uuid;\n';
 resolver text:=E'  _client := public._client_portal_billing_client(p_tenant_id);\n  IF _client IS NULL THEN RETURN NULL; END IF;\n  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client;';
 null_guard text:=E'  IF _tenant IS NULL OR _client IS NULL THEN\n    RAISE EXCEPTION ''CLIENT_INVOICE_UNAVAILABLE'' USING ERRCODE=''42501'';\n  END IF;';
begin
 select * into strict core from pg_catalog.pg_proc where oid='public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb)'::regprocedure;
 select * into strict wrapper from pg_catalog.pg_proc where oid='public.client_portal_invoices(uuid,integer,jsonb)'::regprocedure;
 query_body:=core.prosrc;
 if to_regprocedure('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)') is not null then
  perform pg_temp.e04_core_check(md5(core.prosrc)='0a70d5ed7b157fa68472bbf24785be1a','exact compatible four-argument financial delegate');
  select prosrc into strict query_body from pg_proc where oid='public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)'::regprocedure;
  perform pg_temp.e04_core_check(md5(query_body)='a307bf9e57e5b2ad692c74a329e683cd','exact native financial source before whole inverse');
  for step in select * from (values ('  _today date := (now() AT TIME ZONE ''UTC'')::date;','  _today date := p_as_of;'),
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
    ''read_at'', statement_timestamp()')) s(before,after) loop
   perform pg_temp.e04_core_check((length(query_body)-length(replace(query_body,step.after,'')))/length(step.after)=1,
    'native financial inverse has one exact anchor');
   query_body:=replace(query_body,step.after,step.before);
  end loop;
 end if;
 perform pg_temp.e04_core_check(pg_catalog.md5(query_body)='d86613d312960b0d507898210e7e5197','exact entire original financial query and validation');
 perform pg_temp.e04_core_check(pg_catalog.md5(wrapper.prosrc)='91f0344a6231205da5763af3755f0ad3','public wrapper only resolves original scope and delegates');
 original:=pg_catalog.replace(query_body,E'\nDECLARE\n',E'\nDECLARE\n'||declarations);
 original:=pg_catalog.replace(original,null_guard,resolver);
 perform pg_temp.e04_core_check(pg_catalog.md5(original)='28df84d29fcde1e64bb09153f4d3e77b','complete inverse reproduces the entire original financial query and validation');
 perform pg_temp.e04_core_check(not core.prosecdef and core.provolatile='v' and core.proconfig=array['search_path=""']::text[] and pg_catalog.pg_get_userbyid(core.proowner)='postgres','private invoker has canonical owner and closed search path');
 perform pg_temp.e04_core_check(core.proacl is not null and not exists(select 1 from pg_catalog.aclexplode(core.proacl) a where a.grantee<>core.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable),'only the original database owner may execute the financial core');
 perform pg_temp.e04_core_check(wrapper.prosecdef and wrapper.provolatile='v' and wrapper.proconfig=array['search_path=public, pg_temp']::text[] and wrapper.pronargdefaults=3 and wrapper.proargnames=array['p_tenant_id','p_limit','p_after']::text[],'original public ABI defaults and authority retained');
 perform pg_temp.e04_core_check((select pg_catalog.md5(prosrc)='7785ae6623f447c23b040d06d3c701a2' from pg_catalog.pg_proc where oid='public._client_portal_billing_client(uuid)'::regprocedure),'original JWT/role/revocation/SHARE-lock resolver is unchanged');
 perform pg_temp.e04_core_check((select pg_catalog.md5(prosrc)='a13ec7e7ebd4985091aba7381e851a87' from pg_catalog.pg_proc where oid='public.client_portal_invoices_scoped(uuid,uuid,integer,jsonb)'::regprocedure),'original expected-client wrapper remains unchanged');
end $identity$;
do $$begin execute format('grant usage on schema %I to anon,authenticated,service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
grant execute on function pg_temp.e04_core_refused(text,text) to anon,authenticated,service_role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
set local role anon;
select pg_temp.e04_core_refused('select public._client_portal_invoice_facts_for_client(null,null,20,null)','anonymous core access refused');
select pg_temp.e04_core_refused('select public.client_portal_invoices()','anonymous original wrapper access refused');
reset role;
set local role authenticated;
select pg_temp.e04_core_refused('select public._client_portal_invoice_facts_for_client(null,null,20,null)','authenticated core access refused before any locator is interpreted');
select pg_temp.e04_core_refused('select public.client_portal_invoices()','unsigned public caller still refused by original auth resolver');
reset role;
set local role service_role;
select pg_temp.e04_core_refused('select public._client_portal_invoice_facts_for_client(null,null,20,null)','service-role core access is not introduced');
select pg_temp.e04_core_refused('select public.client_portal_invoices()','existing service wrapper grant never substitutes for actual caller identity');
reset role;
select pg_temp.e04_core_refused('select public._client_portal_invoice_facts_for_client(null,null,20,null)','private owner call still requires explicit resolved locator inputs');
select 'EXP04_PRIVATE_INVOICE_CORE_PASS' as result;
rollback;
