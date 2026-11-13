-- Disposable full-schema database only. Never production, including with ROLLBACK.
-- Exercises original encrypted writers and real authorization; no provider-proof claim.
begin;
create temp table zapier_mcp_assertions(label text);
create function pg_temp.mcp_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'ZAPIER_MCP_PROOF_FAIL: %',label; end if;
 insert into zapier_mcp_assertions values(label);
end $$;
create function pg_temp.mcp_refuses(statement text,expected text,label text) returns void language plpgsql as $$
declare message text;
begin
 begin execute statement; exception when others then get stacked diagnostics message=message_text; end;
 perform pg_temp.mcp_assert(message like '%'||expected||'%',label);
end $$;

insert into auth.users(id,aud,role,email) values
 ('cd100000-0000-4000-8000-000000000001','authenticated','authenticated','test-mcp-owner@tests.invalid'),
 ('cd100000-0000-4000-8000-000000000002','authenticated','authenticated','test-mcp-admin@tests.invalid');
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,features) values
 ('cd100000-0000-4000-8000-000000000010','test-tenant-mcp-existing','test-tenant-mcp-existing','active','standalone','TMA','{}'),
 ('cd100000-0000-4000-8000-000000000011','test-tenant-mcp-new','test-tenant-mcp-new','active','standalone','TMB','{}'),
 ('cd100000-0000-4000-8000-000000000012','test-tenant-mcp-held','test-tenant-mcp-held','active','agency','TMC','{}');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) values
 ('cd100000-0000-4000-8000-000000000010','cd100000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('cd100000-0000-4000-8000-000000000010','cd100000-0000-4000-8000-000000000002','admin','active',false,now()),
 ('cd100000-0000-4000-8000-000000000011','cd100000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('cd100000-0000-4000-8000-000000000012','cd100000-0000-4000-8000-000000000001','owner','active',true,now());
insert into public.profiles(user_id,active_tenant_id) values
 ('cd100000-0000-4000-8000-000000000001','cd100000-0000-4000-8000-000000000010'),
 ('cd100000-0000-4000-8000-000000000002','cd100000-0000-4000-8000-000000000010')
 on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;

create function pg_temp.mcp_begin(t uuid,u uuid,s text) returns void language sql as $$
 select public.begin_tenant_zapier_mcp_oauth(t,u,s,'fixture-verifier','https://app.example/oauth/mcp/callback',
  'https://issuer.example','https://mcp.zapier.com/api/v1/connect','fixture-client',null,array['records.read','records.write']);
$$;
create function pg_temp.mcp_finish(t uuid,u uuid,s text,scopes text[] default array['records.read','records.write'])
returns jsonb language sql as $$
 select public.complete_tenant_zapier_mcp_oauth(t,u,s,'fixture-access','fixture-refresh',
  clock_timestamp()+interval '1 hour',scopes);
$$;

do $proof$
declare
 t uuid:='cd100000-0000-4000-8000-000000000010'; t2 uuid:='cd100000-0000-4000-8000-000000000011';
 held uuid:='cd100000-0000-4000-8000-000000000012'; u uuid:='cd100000-0000-4000-8000-000000000001';
 u2 uuid:='cd100000-0000-4000-8000-000000000002'; g uuid; old_g uuid; claim uuid; r jsonb; f record;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('begin_tenant_zapier_mcp_oauth','consume_tenant_zapier_mcp_oauth',
  'complete_tenant_zapier_mcp_oauth','claim_tenant_zapier_mcp_refresh','finish_tenant_zapier_mcp_refresh',
  'fail_tenant_zapier_mcp_refresh','record_tenant_zapier_mcp_probe','get_tenant_mcp_secret') loop
  perform pg_temp.mcp_assert(not has_function_privilege('anon',f.oid,'execute')
   and not has_function_privilege('authenticated',f.oid,'execute')
   and has_function_privilege('service_role',f.oid,'execute'),'secret RPC ACL '||f.proname);
 end loop;
 perform pg_temp.mcp_assert(not has_table_privilege('authenticated','public.tenant_mcp_oauth_state','select'),'browser cannot read verifier state');
 perform pg_temp.mcp_refuses(format('select pg_temp.mcp_begin(%L,%L,%L)',held,u,'held'),
  'MCP_FORBIDDEN','held Agency does not inherit Solo connection authority');
 perform pg_temp.mcp_begin(t,u,'actor-bound');
 perform pg_temp.mcp_refuses('select public.consume_tenant_mcp_oauth_state(''actor-bound'')',
  'MCP_OAUTH_RESTART_REQUIRED','old consumer cannot bypass initiating-actor binding');
 r:=public.consume_tenant_zapier_mcp_oauth(t,u2,'actor-bound');
 perform pg_temp.mcp_assert(r->>'found'='false','different legitimate admin cannot consume owner state');
 perform pg_temp.mcp_assert((select consumed_at is null from public.tenant_mcp_oauth_state where state='actor-bound'),'wrong actor did not burn state');
 r:=public.consume_tenant_zapier_mcp_oauth(t,u,'actor-bound');
 perform pg_temp.mcp_assert(r->>'found'='true' and r->'requested_scopes'='["records.read","records.write"]'::jsonb,'original consumer returns frozen request scopes');
 perform pg_temp.mcp_assert(public.consume_tenant_zapier_mcp_oauth(t,u,'actor-bound')->>'found'='false','state consumed exactly once');
 perform pg_temp.mcp_refuses(format('select pg_temp.mcp_finish(%L,%L,%L,%L)',t,u,'actor-bound',array['records.admin']),
  'MCP_OAUTH_BAD_REQUEST','callback cannot expand frozen scopes');
 r:=pg_temp.mcp_finish(t,u,'actor-bound',array['records.read']);
 perform pg_temp.mcp_assert(r->>'status'='pending_verification','OAuth grant alone never reports Connected');
 select zapier_generation into g from public.tenant_mcp_connections where tenant_id=t and provider='zapier';
 perform pg_temp.mcp_assert((select oauth_scopes=array['records.read'] and approved_capabilities='[]'::jsonb
  and capability_pins='{}'::jsonb and auth_kind='oauth' from public.tenant_mcp_connections where tenant_id=t and provider='zapier'),
  'original encrypted grant writer stores narrowed grant and resets approvals');
 perform pg_temp.mcp_refuses(format('select pg_temp.mcp_finish(%L,%L,%L)',t,u,'actor-bound'),'MCP_OAUTH_NOT_ACTIVE','final callback cannot replay');
 perform pg_temp.mcp_assert(public.zapier_mcp_read_authorized(t,u,g),'same actor workspace generation can read');
 perform pg_temp.mcp_assert(not public.zapier_mcp_read_authorized(t,u2,g),'different actor cannot disclose result');
 perform pg_temp.mcp_assert(not public.zapier_mcp_read_authorized(t,u,gen_random_uuid()),'stale generation cannot disclose result');
 perform pg_temp.mcp_refuses(format('select public.set_tenant_zapier_mcp_connection(%L,%L,%L,null,null,%L,%L,null,null,null,%L)',
  t,'https://mcp.zapier.com/api/v1/connect','fixture-unbound','https://issuer.example','old-client',u),
  'MCP_OAUTH_RESTART_REQUIRED','old in-flight exchange cannot use unfenced setter');
 perform pg_temp.mcp_refuses(format('select public.rotate_tenant_mcp_tokens(%L,%L,%L)',t,'zapier','fixture-unbound'),
  'MCP_OAUTH_RESTART_REQUIRED','old in-flight refresh cannot use unfenced rotation');
 perform pg_temp.mcp_refuses(format('select public.update_tenant_mcp_probe(%L,%L,%L)',t,'zapier','connected'),
  'MCP_OAUTH_RESTART_REQUIRED','old in-flight probe cannot promote replacement grant');
 perform pg_temp.mcp_refuses(format('select public.set_tenant_mcp_approved_capabilities(%L,%L,%L)', 'zapier',array['read'],t),
  'MCP_OAUTH_RESTART_REQUIRED','old in-flight approval cannot mutate replacement grant');
 perform pg_temp.mcp_refuses(format('select public.clear_tenant_mcp_connection(%L,%L)','zapier',t),
  'MCP_OAUTH_RESTART_REQUIRED','old in-flight disconnect cannot clear replacement grant');
 update public.tenant_mcp_connections set approved_capabilities='["read"]',capability_pins='{"read":"pin-a"}'
  where tenant_id=t and provider='zapier';
 perform pg_temp.mcp_assert(public.zapier_mcp_action_authorized(t,u,g,'read','pin-a'),'original approved pinned action admits current authority');
 update public.tenant_mcp_connections set approved_capabilities='[]' where tenant_id=t and provider='zapier';
 perform pg_temp.mcp_assert(not public.zapier_mcp_action_authorized(t,u,g,'read','pin-a'),'approval removal denies dispatch even without a generation change');

 -- A check and an action compete for exactly one renewal; uncertain claims are not stolen.
 update public.tenant_mcp_connections set access_token_expires_at=clock_timestamp()-interval '1 minute' where tenant_id=t and provider='zapier';
 r:=public.claim_tenant_zapier_mcp_refresh(t,u,g); claim:=(r->>'claim')::uuid;
 perform pg_temp.mcp_assert(r->>'state'='claimed' and claim is not null,'expired original grant yields one renewal claim');
 perform pg_temp.mcp_assert(public.claim_tenant_zapier_mcp_refresh(t,u,g)->>'state'='busy','concurrent renewal cannot replay token');
 update public.tenant_mcp_connections set zapier_refresh_claimed_at=clock_timestamp()-interval '1 minute' where tenant_id=t and provider='zapier';
 perform pg_temp.mcp_assert(public.claim_tenant_zapier_mcp_refresh(t,u,g)->>'state'='reauthorization_required','old unknown claim is never stolen');
 perform pg_temp.mcp_refuses(format('select public.finish_tenant_zapier_mcp_refresh(%L,%L,%L,%L,%L,null,now()+interval ''1 hour'',%L)',
  t,u,g,claim,'fixture-rotated',array['records.admin']),'MCP_OAUTH_BAD_REQUEST','renewal cannot expand granted scopes');
 r:=public.finish_tenant_zapier_mcp_refresh(t,u,g,claim,'fixture-rotated',null,clock_timestamp()+interval '1 hour',array['records.read']);
 perform pg_temp.mcp_assert(r->>'state'='current' and r->'secret'->>'auth_token'='fixture-rotated'
  and r->'secret'->>'refresh_token'='fixture-refresh','rotation stored by original writer and non-rotating refresh retained');
 perform pg_temp.mcp_assert((select zapier_generation=g and zapier_refresh_claim=claim and zapier_refresh_completed_at is not null from public.tenant_mcp_connections where tenant_id=t and provider='zapier'),
  'ordinary renewal retains its completion nonce without a pending renewal');
 perform pg_temp.mcp_assert(public.claim_tenant_zapier_mcp_refresh(t,u,g)->>'state'='current','completed renewal nonce does not block a current grant');
 perform pg_temp.mcp_assert(public.finish_tenant_zapier_mcp_refresh(t,u,g,claim,'fixture-replay',null,null,array['records.read'])->>'state'='changed','finished renewal response cannot replay');
 perform pg_temp.mcp_assert(public.record_tenant_zapier_mcp_probe(t,u,g,'connected',null),'matching real-probe result can be persisted');
 update public.tenant_mcp_connections set access_token_expires_at=clock_timestamp()-interval '1 minute' where tenant_id=t and provider='zapier';
 r:=public.claim_tenant_zapier_mcp_refresh(t,u,g); claim:=(r->>'claim')::uuid;
 r:=public.finish_tenant_zapier_mcp_refresh(t,u,g,claim,'fixture-no-expiry',null,null,array['records.read']);
 perform pg_temp.mcp_assert(r->>'state'='current' and r->'secret'->'expires_at'='null'::jsonb,'missing renewal expiry does not retain expired timestamp');
 perform pg_temp.mcp_assert(public.claim_tenant_zapier_mcp_refresh(t,u,g)->>'state'='current','missing expiry cannot repeatedly consume refresh token');
 -- Exact lost-finish/readback case: narrowing changes generation, but only this
 -- completed nonce may mark the affected grant unavailable before compensation.
 update public.tenant_mcp_connections set access_token_expires_at=clock_timestamp()-interval '1 minute' where tenant_id=t and provider='zapier';
 r:=public.claim_tenant_zapier_mcp_refresh(t,u,g); claim:=(r->>'claim')::uuid;old_g:=g;
 perform public.finish_tenant_zapier_mcp_refresh(t,u,g,claim,'fixture-narrowed',null,clock_timestamp()+interval '1 hour',array[]::text[]);
 select zapier_generation into g from public.tenant_mcp_connections where tenant_id=t and provider='zapier';
 perform pg_temp.mcp_assert(g<>old_g,'narrowed renewal changes generation');
 perform pg_temp.mcp_assert(public.fail_tenant_zapier_mcp_refresh(t,u,old_g,claim),'completed nonce fences failed response across generation change');
 perform pg_temp.mcp_assert((select status='error' and zapier_refresh_claim=claim and zapier_refresh_completed_at is null from public.tenant_mcp_connections where tenant_id=t and provider='zapier'),
  'affected narrowed grant is unavailable before token compensation and cannot auto-refresh again');
 perform pg_temp.mcp_assert(not public.record_tenant_zapier_mcp_probe(t,u,g,'connected',null),'a delayed probe cannot promote the uncertain renewal');
 perform pg_temp.mcp_assert(not public.zapier_mcp_read_authorized(t,u,g),'uncertain renewal cannot admit provider access');

 -- New consent cancels even an exchanging older callback; disconnect cancels all pending flows.
 perform pg_temp.mcp_begin(t,u,'old-callback');
 perform public.consume_tenant_zapier_mcp_oauth(t,u,'old-callback');
 perform pg_temp.mcp_begin(t,u,'new-callback');
 perform pg_temp.mcp_refuses(format('select pg_temp.mcp_finish(%L,%L,%L)',t,u,'old-callback'),'MCP_OAUTH_NOT_ACTIVE','new begin cancels exchanging callback');
 perform public.consume_tenant_zapier_mcp_oauth(t,u,'new-callback');
 old_g:=g;
 perform pg_temp.mcp_finish(t,u,'new-callback');
 select zapier_generation into g from public.tenant_mcp_connections where tenant_id=t and provider='zapier';
 perform pg_temp.mcp_assert(g<>old_g,'reconnect rotates connection identity');
 perform pg_temp.mcp_assert(not public.fail_tenant_zapier_mcp_refresh(t,u,old_g,claim),'old completed nonce cannot mark unrelated reconnect unavailable');
 perform pg_temp.mcp_assert(not public.record_tenant_zapier_mcp_probe(t,u,old_g,'connected',null),'old check cannot promote replacement connection');
 perform pg_temp.mcp_assert(not public.disconnect_tenant_zapier_mcp(t,u,old_g),'stale disconnect cannot clear replacement grant');
 perform pg_temp.mcp_begin(t,u,'disconnect-pending');
 perform pg_temp.mcp_assert(public.disconnect_tenant_zapier_mcp(t,u,g),'current actor can detach current grant');
 perform pg_temp.mcp_assert(public.consume_tenant_zapier_mcp_oauth(t,u,'disconnect-pending')->>'found'='false','disconnect cancels pending callback');
 perform pg_temp.mcp_assert((select server_url_ct is null and auth_token_ct is null and refresh_token_ct is null
  and not enabled and approved_capabilities='[]'::jsonb from public.tenant_mcp_connections where tenant_id=t and provider='zapier'),
  'original disconnect scrubs credentials and approvals');
 perform pg_temp.mcp_assert(not public.zapier_mcp_read_authorized(t,u,g),'disconnect invalidates result disclosure');

 perform pg_temp.mcp_begin(t,u,'workspace-switch');
 perform public.consume_tenant_zapier_mcp_oauth(t,u,'workspace-switch');
 update public.profiles set active_tenant_id=t2 where user_id=u;
 perform pg_temp.mcp_refuses(format('select pg_temp.mcp_finish(%L,%L,%L)',t,u,'workspace-switch'),'MCP_FORBIDDEN','changed active workspace cannot finish original callback');
 update public.profiles set active_tenant_id=t where user_id=u;
 perform pg_temp.mcp_refuses(format('select pg_temp.mcp_finish(%L,%L,%L)',t,u,'workspace-switch'),'MCP_OAUTH_NOT_ACTIVE','switching back cannot resurrect cancelled callback');
 perform pg_temp.mcp_begin(t,u,'membership-revoked');
 perform public.consume_tenant_zapier_mcp_oauth(t,u,'membership-revoked');
 update public.tenant_members set role='member',is_owner=false where tenant_id=t and user_id=u;
 perform pg_temp.mcp_refuses(format('select pg_temp.mcp_finish(%L,%L,%L)',t,u,'membership-revoked'),'MCP_FORBIDDEN','revoked admin cannot finish callback');
 update public.tenant_members set role='owner',is_owner=true where tenant_id=t and user_id=u;

 -- A distinct new eligible Solo takes the same source path without an account allowlist.
 update public.profiles set active_tenant_id=t2 where user_id=u;
 perform pg_temp.mcp_begin(t2,u,'new-solo');
 perform public.consume_tenant_zapier_mcp_oauth(t2,u,'new-solo');
 perform pg_temp.mcp_finish(t2,u,'new-solo');
 perform pg_temp.mcp_assert((select auth_kind='oauth' and status='pending_verification' from public.tenant_mcp_connections where tenant_id=t2 and provider='zapier'),
  'new eligible Solo uses same original writer and honest readiness');
 perform public.set_tenant_n8n_mcp_connection('https://n8n.example/mcp','fixture-n8n');
 perform public.rotate_tenant_mcp_tokens(t2,'n8n','fixture-n8n-rotated');
 perform pg_temp.mcp_assert(public.get_tenant_mcp_secret(t2,'n8n')->>'auth_token'='fixture-n8n-rotated','n8n retains original independent rotation ABI');
end $proof$;
select count(*) as passed_native_zapier_mcp_assertions from zapier_mcp_assertions;
rollback;
