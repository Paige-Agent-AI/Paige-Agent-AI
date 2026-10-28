-- Full-schema metadata/API isolation proof. No customer or provider data.
-- The original171 Portal payment assertions remain unchanged in their own job.
begin;
create function pg_temp.e04_core_check(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.e04_core_refused(stmt text,label text) returns void language plpgsql as $$
begin begin execute stmt; exception when insufficient_privilege then raise notice 'PASS: %',label; return; end;
 raise exception 'FAIL: % accepted',label; end $$;
do $identity$ declare core pg_catalog.pg_proc%rowtype; wrapper pg_catalog.pg_proc%rowtype; original text;
 declarations text:=E'  _client uuid;\n  _tenant uuid;\n';
 resolver text:=E'  _client := public._client_portal_billing_client(p_tenant_id);\n  IF _client IS NULL THEN RETURN NULL; END IF;\n  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client;';
 null_guard text:=E'  IF _tenant IS NULL OR _client IS NULL THEN\n    RAISE EXCEPTION ''CLIENT_INVOICE_UNAVAILABLE'' USING ERRCODE=''42501'';\n  END IF;';
begin
 select * into strict core from pg_catalog.pg_proc where oid='public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb)'::regprocedure;
 select * into strict wrapper from pg_catalog.pg_proc where oid='public.client_portal_invoices(uuid,integer,jsonb)'::regprocedure;
 perform pg_temp.e04_core_check(pg_catalog.md5(core.prosrc)='d86613d312960b0d507898210e7e5197','exact original financial core body');
 perform pg_temp.e04_core_check(pg_catalog.md5(wrapper.prosrc)='91f0344a6231205da5763af3755f0ad3','public wrapper only resolves original scope and delegates');
 original:=pg_catalog.replace(core.prosrc,E'\nDECLARE\n',E'\nDECLARE\n'||declarations);
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
