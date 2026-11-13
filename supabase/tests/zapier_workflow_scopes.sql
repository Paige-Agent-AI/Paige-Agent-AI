-- Rollback-only local native proof. The runner supplies the captured original
-- Zapier functions/tables and synthetic auth ports; this is not live OAuth proof.
begin;
create temp table zapier_scope_assertions(label text);
create function pg_temp.zapier_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'ZAPIER_SCOPE_PROOF_FAIL: %',label; end if;
 insert into zapier_scope_assertions values(label);
end $$;
create function pg_temp.zapier_refuses(statement text,expected text,label text) returns void language plpgsql as $$
declare message text;
begin
 begin execute statement; exception when others then get stacked diagnostics message=message_text; end;
 perform pg_temp.zapier_assert(message like '%'||expected||'%',label);
end $$;
insert into auth.users(id) values('ad050000-0000-4000-8000-000000000001'),('ad050000-0000-4000-8000-000000000002');
insert into public.tenants(id,status,account_type) values
 ('ad050000-0000-4000-8000-000000000010','active','standalone'),
 ('ad050000-0000-4000-8000-000000000011','active','standalone'),
 ('ad050000-0000-4000-8000-000000000012','active','agency');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner) values
 ('ad050000-0000-4000-8000-000000000010','ad050000-0000-4000-8000-000000000001','owner','active',true),
 ('ad050000-0000-4000-8000-000000000011','ad050000-0000-4000-8000-000000000002','owner','active',true),
 ('ad050000-0000-4000-8000-000000000012','ad050000-0000-4000-8000-000000000001','owner','active',true);
create function pg_temp.zapier_test_grant(t uuid,u uuid,scope text[],attempt uuid default null,generation uuid default null)
returns void language sql as $$ select public.zapier_api_store_grant(t,u,'fixture-access','fixture-refresh',clock_timestamp()+interval '1 hour',scope,attempt,generation) $$;
do $proof$
declare
 t uuid:='ad050000-0000-4000-8000-000000000010'; u uuid:='ad050000-0000-4000-8000-000000000001';
 t2 uuid:='ad050000-0000-4000-8000-000000000011'; u2 uuid:='ad050000-0000-4000-8000-000000000002';
 held uuid:='ad050000-0000-4000-8000-000000000012'; a uuid; old_attempt uuid; g uuid;
 ro text[]:=array['profile','zap:account:all']; wm text[]:=private.zapier_api_requested_scopes('workflow_management');
 count_before int;
begin
 perform pg_temp.zapier_assert(not has_function_privilege('authenticated','public.zapier_api_store_grant(uuid,uuid,text,text,timestamptz,text[],uuid,uuid)','execute'),'ordinary actor cannot store a grant');
 perform pg_temp.zapier_assert(not has_function_privilege('anon','public.zapier_api_begin_scoped_oauth(uuid,uuid,text,text)','execute'),'anonymous cannot begin scoped OAuth');
 perform pg_temp.zapier_assert(not has_function_privilege('authenticated','public.zapier_api_begin_scoped_oauth(uuid,uuid,text,text)','execute'),'ordinary actor cannot forge server OAuth');
 perform pg_temp.zapier_assert(has_function_privilege('service_role','public.zapier_api_begin_scoped_oauth(uuid,uuid,text,text)','execute'),'original service can begin scoped OAuth');
 perform pg_temp.zapier_assert(not has_table_privilege('authenticated','public.tenant_zapier_api_connections','select'),'ordinary actor cannot select tokens');
 perform pg_temp.zapier_refuses(format('select public.zapier_api_begin_scoped_oauth(%L,%L,%L,%L)',t,u,repeat('a',32),'unrestricted'),'ZAPIER_PERMISSION_PROFILE_INVALID','unsupported scope profile refused');
 perform pg_temp.zapier_refuses(format('select public.zapier_api_begin_scoped_oauth(%L,%L,%L,%L)',t,u2,repeat('b',32),'workflow_management'),'ZAPIER_OAUTH_FORBIDDEN','foreign actor refused');
 perform pg_temp.zapier_refuses(format('select public.zapier_api_begin_scoped_oauth(%L,%L,%L,%L)',held,u,repeat('c',32),'workflow_management'),'ZAPIER_SOLO_OWNER_REQUIRED','held Agency cannot request management');
 -- Original three-argument callers retain the original read-only profile.
 a:=public.zapier_api_begin_oauth(t,u,repeat('d',32));
 perform pg_temp.zapier_assert((select requested_scopes=ro from public.tenant_zapier_api_oauth_attempts where id=a),'old begin keeps read-only scope');
 update public.tenant_zapier_api_oauth_attempts set status='exchanging' where id=a;
 perform pg_temp.zapier_refuses(format('select pg_temp.zapier_test_grant(%L,%L,%L,%L)',t,u,wm,a),'ZAPIER_GRANT_SCOPE_CHANGED','callback cannot upgrade original read-only consent');
 perform pg_temp.zapier_test_grant(t,u,ro,a);
 perform pg_temp.zapier_assert((select oauth_scopes=ro from public.tenant_zapier_api_connections where tenant_id=t),'original read-only connection stored');
 perform pg_temp.zapier_refuses(format('select pg_temp.zapier_test_grant(%L,%L,%L,%L)',t,u,ro,a),'ZAPIER_OAUTH_NOT_ACTIVE','completed callback cannot replay');
 select generation into g from public.tenant_zapier_api_connections where tenant_id=t;
 perform pg_temp.zapier_refuses(format('select pg_temp.zapier_test_grant(%L,%L,%L,null,%L)',t,u,wm,g),'ZAPIER_GRANT_SCOPE_CHANGED','refresh cannot upgrade original scope');
 perform pg_temp.zapier_test_grant(t,u,ro,null,g);
 perform pg_temp.zapier_refuses(format('select pg_temp.zapier_test_grant(%L,%L,%L,null,%L)',t,u,ro,g),'ZAPIER_GRANT_STALE','old generation refresh refused');
 perform pg_temp.zapier_refuses(format('select pg_temp.zapier_test_grant(%L,%L,%L)',t,u,wm),'ZAPIER_GRANT_INVALID','unbound direct grant refused');
 old_attempt:=public.zapier_api_begin_scoped_oauth(t,u,repeat('e',32),'workflow_management');
 a:=public.zapier_api_begin_scoped_oauth(t,u,repeat('f',32),'workflow_management');
 perform pg_temp.zapier_assert((select status='cancelled' from public.tenant_zapier_api_oauth_attempts where id=old_attempt),'new authorization cancels previous original attempt');
 update public.tenant_zapier_api_oauth_attempts set status='exchanging' where id=a;
 perform pg_temp.zapier_refuses(format('select pg_temp.zapier_test_grant(%L,%L,%L,%L)',t2,u2,wm,a),'ZAPIER_OAUTH_NOT_ACTIVE','foreign tenant cannot finish attempt');
 perform pg_temp.zapier_refuses(format('select pg_temp.zapier_test_grant(%L,%L,%L,%L)',t,u,wm||array['zap:all'],a),'ZAPIER_GRANT_SCOPE_CHANGED','expanded provider grant refused');
 perform pg_temp.zapier_refuses(format('select pg_temp.zapier_test_grant(%L,%L,%L,%L)',t,u,wm[1:7],a),'ZAPIER_GRANT_SCOPE_CHANGED','partial provider grant refused');
 perform pg_temp.zapier_test_grant(t,u,wm,a);
 perform pg_temp.zapier_assert((select oauth_scopes=wm from public.tenant_zapier_api_connections where tenant_id=t),'separately consented management scope stored');
 -- Equivalent new and existing SOLO owners take the exact same path.
 a:=public.zapier_api_begin_scoped_oauth(t2,u2,repeat('g',32),'workflow_management');
 update public.tenant_zapier_api_oauth_attempts set status='exchanging' where id=a;
 perform pg_temp.zapier_test_grant(t2,u2,wm,a);
 perform pg_temp.zapier_assert((select oauth_scopes=wm from public.tenant_zapier_api_connections where tenant_id=t2),'new eligible SOLO owner receives identical scope');
 perform set_config('test.actor',u::text,true); perform set_config('test.tenant',t::text,true);
 select generation into g from public.tenant_zapier_api_connections where tenant_id=t;
 perform pg_temp.zapier_assert(public.zapier_api_workflow_read_authorized(t,u,g,'zap'),'same native snapshot admits owner and current scoped grant');
 perform pg_temp.zapier_assert(not public.zapier_api_workflow_read_authorized(t,u2,g,'zap'),'different actor cannot use owner grant');
 perform pg_temp.zapier_assert(not public.zapier_api_workflow_read_authorized(t2,u,g,'zap'),'different tenant cannot use original grant');
 perform pg_temp.zapier_assert(not public.zapier_api_workflow_read_authorized(t,u,gen_random_uuid(),'zap'),'changed generation cannot disclose a result');
 perform pg_temp.zapier_assert(not public.zapier_api_workflow_read_authorized(t,u,g,'zap:write'),'read admission never authorizes writes');
 update public.tenant_zapier_api_connections set access_token_expires_at=clock_timestamp()-interval '1 second' where tenant_id=t;
 perform pg_temp.zapier_assert(not public.zapier_api_workflow_read_authorized(t,u,g,'zap'),'expired original grant cannot disclose result');
 update public.tenant_zapier_api_connections set access_token_expires_at=clock_timestamp()+interval '1 hour' where tenant_id=t;
 a:=public.zapier_api_begin_scoped_oauth(t,u,repeat('h',32),'workflow_management');
 update public.tenant_zapier_api_oauth_attempts set status='exchanging' where id=a;
 update public.tenant_members set is_owner=false where tenant_id=t and user_id=u;
 perform pg_temp.zapier_assert(not public.zapier_api_workflow_read_authorized(t,u,g,'zap'),'revoked owner cannot disclose result');
 perform pg_temp.zapier_refuses(format('select pg_temp.zapier_test_grant(%L,%L,%L,%L)',t,u,wm,a),'ZAPIER_GRANT_FORBIDDEN','revoked owner cannot complete grant');
 update public.tenant_members set is_owner=true where tenant_id=t and user_id=u;
 update public.tenants set archived_at=clock_timestamp() where id=t;
 perform pg_temp.zapier_refuses(format('select pg_temp.zapier_test_grant(%L,%L,%L,%L)',t,u,wm,a),'ZAPIER_SOLO_OWNER_REQUIRED','archived business cannot finish management');
 update public.tenants set archived_at=null where id=t;
 update public.tenant_zapier_api_oauth_attempts set expires_at=clock_timestamp()-interval '1 second' where id=a;
 perform pg_temp.zapier_refuses(format('select pg_temp.zapier_test_grant(%L,%L,%L,%L)',t,u,wm,a),'ZAPIER_OAUTH_NOT_ACTIVE','expired attempt cannot finish');
 select count(*) into count_before from public.tenant_zapier_api_connections;
 perform pg_temp.zapier_assert(count_before=2,'negative paths create no additional connection');
end $proof$;
select count(*) as passed_native_scope_assertions from zapier_scope_assertions;
rollback;
