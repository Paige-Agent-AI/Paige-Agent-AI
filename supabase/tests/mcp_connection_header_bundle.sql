-- Disposable database only. Synthetic values, never provider credentials or tenant data.
BEGIN;
\ir helpers/mcp_oauth_binding.sql
INSERT INTO auth.users(id) VALUES
 ('10000000-0000-4000-8000-000000000071'), ('10000000-0000-4000-8000-000000000072');
INSERT INTO public.tenants(id,slug,name,status,account_type) VALUES
 ('10000000-0000-4000-8000-000000000073','test-headers-a','Test headers A','active','standalone'),
 ('10000000-0000-4000-8000-000000000074','test-headers-b','Test headers B','active','standalone');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('10000000-0000-4000-8000-000000000073','10000000-0000-4000-8000-000000000071','owner','active',true),
 ('10000000-0000-4000-8000-000000000074','10000000-0000-4000-8000-000000000072','owner','active',true);
CREATE TEMP TABLE header_proof(result jsonb);
GRANT ALL ON header_proof TO authenticated;
SET LOCAL request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated"}';
SET LOCAL ROLE authenticated;
INSERT INTO header_proof SELECT public.create_mcp_connection(
 _provider_key=>'generic-remote', _label=>'Test header bundle',
 _server_url=>'https://server.example/api/mcp/retained-path', _auth_kind=>'bearer',
 _auth_token=>'test-token-not-a-credential',
 _custom_headers=>'{"X-Workspace":"test-private-workspace","X-Region":"us"}');
DO $$ DECLARE r jsonb; BEGIN
 SELECT result INTO r FROM header_proof;
 IF r->>'address_configured' IS DISTINCT FROM 'true' OR r->>'credentials_configured' IS DISTINCT FROM 'true'
    OR r->>'custom_header_count' IS DISTINCT FROM '2' OR r->>'config_generation' IS DISTINCT FROM '1'
 THEN RAISE EXCEPTION 'create acknowledgement missing persisted facts'; END IF;
 IF position('test-private' IN r::text)>0 THEN RAISE EXCEPTION 'create leaked header'; END IF;
 IF has_function_privilege(current_user,'public.get_mcp_connection_secret(uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'authenticated caller can read secret'; END IF;
END $$;
RESET ROLE;
DO $$
DECLARE cid uuid; r jsonb; secret jsonb; generation bigint; state_id uuid; bad jsonb;
 t uuid := '10000000-0000-4000-8000-000000000073';
BEGIN
 SELECT (result->>'connection_id')::uuid INTO cid FROM header_proof;
 secret := public.get_mcp_connection_secret(cid);
 IF secret->>'server_url' <> 'https://server.example/api/mcp/retained-path'
 OR secret->'custom_headers' <> '{"X-Workspace":"test-private-workspace","X-Region":"us"}'::jsonb
 THEN RAISE EXCEPTION 'encrypted round trip lost endpoint or headers'; END IF;
 IF EXISTS(SELECT 1 FROM public.mcp_connections WHERE connection_id=cid AND
   position(convert_to('test-private-workspace','UTF8') IN custom_headers_ct)>0)
 THEN RAISE EXCEPTION 'header stored as plaintext'; END IF;
 r := public.get_mcp_connections_v2();
 IF r->0->>'address_configured' IS DISTINCT FROM 'true' OR r->0->>'custom_header_count' IS DISTINCT FROM '2'
 OR position('test-private' IN r::text)>0 OR position('retained-path' IN r::text)>0
 THEN RAISE EXCEPTION 'safe readback missing facts or leaks private fields'; END IF;
 SELECT config_generation INTO generation FROM public.mcp_connections WHERE connection_id=cid;
 state_id := pg_temp.mcp_oauth_binding(cid,t,auth.uid());
 -- Rejected writes roll back atomically, even after a prior good save.
 FOR bad IN SELECT value FROM jsonb_array_elements('[null,[],{"Authorization":"x"},{"Host":"x"},
   {"X-Key":"one","x-key":"two"},{"X-Key":4},{"X-Key":""},{"X-Key":"bad\nvalue"},
   {"X-Forwarded-Host":"other.example"},{"X-Key":" leading"},{"X-Key":"\u0100"}]') LOOP
   BEGIN
     PERFORM public.set_mcp_connection_endpoint(cid,'https://server.example/other','bearer',
       'test-token-not-a-credential',_custom_headers=>bad);
     RAISE EXCEPTION 'invalid header bundle accepted';
   EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 END LOOP;
 IF (SELECT config_generation FROM public.mcp_connections WHERE connection_id=cid) <> generation
 OR public.get_mcp_connection_secret(cid)->'custom_headers' <> secret->'custom_headers'
 THEN RAISE EXCEPTION 'failed save altered persisted state'; END IF;
 -- Seed through the real probe and approval APIs, not invented granted rows.
 PERFORM public.mcp_connection_probe(cid,'connected','healthy',NULL,
   jsonb_build_array(jsonb_build_object('tool_name','test_read','pin',repeat('a',64))),generation);
 PERFORM public.set_mcp_connection_approval(cid,'test_read',repeat('a',64),t,NULL,NULL,
   public._mcp_endpoint_hash('https://server.example/api/mcp/retained-path'));
 IF NOT EXISTS(SELECT 1 FROM public.mcp_connection_approvals WHERE connection_id=cid)
 THEN RAISE EXCEPTION 'approval precondition missing'; END IF;
 -- A header-only re-key is a new identity even with an unchanged endpoint/token.
 r := public.set_mcp_connection_endpoint(cid,'https://server.example/api/mcp/retained-path','bearer',
   'test-token-not-a-credential',_custom_headers=>'{"X-Workspace":"test-private-replacement"}');
 IF (r->>'config_generation')::bigint <= generation OR r->>'custom_header_count' <> '1'
 THEN RAISE EXCEPTION 'header rotation not fenced or acknowledged'; END IF;
 IF EXISTS(SELECT 1 FROM public.mcp_connection_approvals WHERE connection_id=cid)
 OR EXISTS(SELECT 1 FROM public.mcp_connection_tools WHERE connection_id=cid)
 THEN RAISE EXCEPTION 'header re-key retained stale approvals/tools'; END IF;
 IF public.mcp_connection_probe(cid,'connected','healthy',NULL,NULL,generation)->>'applied' <> 'false'
 THEN RAISE EXCEPTION 'stale probe accepted'; END IF;
 BEGIN
   PERFORM public.complete_mcp_oauth_grant(cid,t,'test-access-not-a-credential',NULL,'https://iss.example.com',
     'client-123',NULL,ARRAY['mcp.read'],NULL,auth.uid(),state_id);
   RAISE EXCEPTION 'stale OAuth completion accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN
   IF SQLERRM <> 'MCP_OAUTH_STALE' THEN RAISE; END IF;
 END;
 -- Another authenticated owner cannot read or replace this tenant's connection.
 PERFORM set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000072","role":"authenticated"}',true);
 IF public.get_mcp_connections_v2() <> '[]'::jsonb THEN RAISE EXCEPTION 'cross-tenant list leak'; END IF;
 BEGIN
   PERFORM public.set_mcp_connection_endpoint(cid,'https://server.example/wrong','none',_custom_headers=>'{}');
   RAISE EXCEPTION 'cross-tenant write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000071","role":"authenticated"}',true);
 -- Moving to OAuth must not silently inherit token-mode headers.
 SELECT config_generation INTO generation FROM public.mcp_connections WHERE connection_id=cid;
 PERFORM public.mcp_connection_probe(cid,'connected','healthy',NULL,
   jsonb_build_array(jsonb_build_object('tool_name','test_read','pin',repeat('a',64))),generation);
 PERFORM public.set_mcp_connection_approval(cid,'test_read',repeat('a',64),t,NULL,NULL,
   public._mcp_endpoint_hash('https://server.example/api/mcp/retained-path'));
 IF NOT EXISTS(SELECT 1 FROM public.mcp_connection_approvals WHERE connection_id=cid)
 THEN RAISE EXCEPTION 'OAuth approval precondition missing'; END IF;
 state_id := pg_temp.mcp_oauth_binding(cid,t,auth.uid());
 BEGIN
   PERFORM public.complete_mcp_oauth_grant(cid,t,'test-access-not-a-credential',NULL,'https://wrong.example.com',
     'client-123',NULL,ARRAY['mcp.read'],NULL,auth.uid(),state_id);
   RAISE EXCEPTION 'mismatched OAuth grant accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 IF NOT EXISTS(SELECT 1 FROM public.mcp_connection_approvals WHERE connection_id=cid)
 THEN RAISE EXCEPTION 'failed OAuth completion destroyed approval'; END IF;
 PERFORM public.complete_mcp_oauth_grant(cid,t,'test-access-not-a-credential',NULL,'https://iss.example.com',
   'client-123',NULL,ARRAY['mcp.read'],NULL,auth.uid(),state_id);
 IF public.get_mcp_connection_secret(cid)->'custom_headers' <> '{}'::jsonb THEN RAISE EXCEPTION 'OAuth inherited token-mode headers'; END IF;
 IF EXISTS(SELECT 1 FROM public.mcp_connection_approvals WHERE connection_id=cid)
 OR EXISTS(SELECT 1 FROM public.mcp_connection_tools WHERE connection_id=cid)
 THEN RAISE EXCEPTION 'OAuth credential replacement retained old consent/catalog'; END IF;
 -- Disconnect clears supplementary ciphertext; repeated disconnect remains idempotent.
 PERFORM public.set_mcp_connection_endpoint(cid,'https://server.example/mcp','bearer',
   'test-token-not-a-credential',_custom_headers=>'{"X-Workspace":"test-private-replacement"}');
 PERFORM public.disconnect_mcp_connection(cid);
 IF EXISTS(SELECT 1 FROM public.mcp_connections WHERE connection_id=cid AND custom_headers_ct IS NOT NULL)
 THEN RAISE EXCEPTION 'disconnect retained supplementary secret'; END IF;
 IF public.disconnect_mcp_connection(cid)->>'already_disabled' <> 'true' THEN RAISE EXCEPTION 'disconnect lost idempotency'; END IF;
 -- Old named/positional callers resolve to ONE function, with empty headers by default.
 PERFORM public.set_mcp_connection_endpoint(cid,'https://server.example/mcp','none');
 IF public.get_mcp_connection_secret(cid)->'custom_headers' <> '{}'::jsonb THEN RAISE EXCEPTION 'legacy caller retained headers'; END IF;
 SELECT config_generation INTO generation FROM public.mcp_connections WHERE connection_id=cid;
 -- Isolate the trigger field comparison: no endpoint/token rewrite can mask a missing comparison.
 UPDATE public.mcp_connections SET custom_headers_ct=public.platform_encrypt('{"X-Region":"us"}') WHERE connection_id=cid;
 IF (SELECT config_generation FROM public.mcp_connections WHERE connection_id=cid) <> generation+1
 THEN RAISE EXCEPTION 'isolated header-only update escaped generation fence'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='set_mcp_connection_endpoint') <> 1
 OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='create_mcp_connection') <> 1
 THEN RAISE EXCEPTION 'ambiguous PostgREST overload'; END IF;
 IF EXISTS(SELECT 1 FROM public.paige_audit_log WHERE target_id=cid AND payload::text LIKE '%test-private%')
 THEN RAISE EXCEPTION 'audit leaked supplementary secret'; END IF;
END $$;
ROLLBACK;
