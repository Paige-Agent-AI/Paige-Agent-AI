-- Disposable database proof only. Never run against production, even with ROLLBACK.
-- Author-created test records do not represent provider or authenticated production proof.
BEGIN;
\ir helpers/mcp_oauth_binding.sql
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('10000000-0000-4000-8000-000000000011','authenticated','authenticated','test-owner@tests.invalid');
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('10000000-0000-4000-8000-000000000012','test-tenant-oauth-binding','test-tenant-oauth-binding','active','standalone','TST','{}');
INSERT INTO public.tenant_members (tenant_id,user_id,role,status,is_owner,joined_at) VALUES
  ('10000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000011','owner','active',true,now());

CREATE FUNCTION pg_temp.assert_grant_refused(_cid uuid, _tid uuid, _actor uuid, _sid uuid, _reason text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE _error text;
BEGIN
  BEGIN
    PERFORM public.complete_mcp_oauth_grant(_cid,_tid,'test-access-not-a-credential',NULL,
      'https://iss.example.com','client-123',NULL,ARRAY['mcp.read'],NULL,_actor,_sid);
  EXCEPTION WHEN OTHERS THEN _error := SQLERRM;
  END;
  IF _error IS NULL OR _error NOT LIKE _reason || '%' THEN
    RAISE EXCEPTION 'expected OAuth refusal %, got %', _reason, _error;
  END IF;
END;
$$;

DO $$
DECLARE
  _actor uuid := '10000000-0000-4000-8000-000000000011';
  _tenant uuid := '10000000-0000-4000-8000-000000000012';
  _cid uuid; _sid uuid; _state text; _r jsonb; _count integer; _generation bigint; _tier text;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  _cid := (public.create_mcp_connection('generic-remote','test-oauth-binding','https://provider.example/mcp','none')->>'connection_id')::uuid;
  SELECT count(*) INTO _count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('begin_mcp_oauth','consume_mcp_oauth_state','complete_mcp_oauth_grant');
  IF _count <> 3 THEN RAISE EXCEPTION 'old OAuth overload bypass remains'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('begin_mcp_oauth','consume_mcp_oauth_state','complete_mcp_oauth_grant')
      AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))) THEN
    RAISE EXCEPTION 'browser role may call secret OAuth contract';
  END IF;
  PERFORM pg_temp.assert_grant_refused(_cid,_tenant,_actor,NULL,'MCP_FORBIDDEN');

  _sid := pg_temp.mcp_oauth_binding(_cid,_tenant,_actor);
  SELECT state INTO _state FROM public.mcp_connection_oauth_state WHERE id=_sid;
  IF (SELECT return_destination FROM public.mcp_connection_oauth_state WHERE id=_sid) IS DISTINCT FROM 'integrations' THEN
    RAISE EXCEPTION 'return destination was not fixed by server'; END IF;
  IF public.consume_mcp_oauth_state(_state,'exchange')->>'found' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'state replay accepted'; END IF;
  -- A new begin invalidates even an already-consumed exchange.
  _r := to_jsonb(pg_temp.mcp_oauth_binding(_cid,_tenant,_actor));
  PERFORM pg_temp.assert_grant_refused(_cid,_tenant,_actor,_sid,'MCP_OAUTH_STALE');

  -- Cancellation is terminal: not merely consumed and thus grantable.
  SELECT config_generation INTO _generation FROM public.mcp_connections WHERE connection_id=_cid;
  PERFORM public.begin_mcp_oauth(_cid,_tenant,'test-cancel','test-verifier','https://callback.example/oauth',
    'https://iss.example.com','https://resource.example/mcp','client-123',NULL,_actor,_generation,ARRAY['mcp.read']);
  _r := public.consume_mcp_oauth_state('test-cancel','cancel');
  IF _r->>'found' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'valid cancellation lost return context'; END IF;
  PERFORM pg_temp.assert_grant_refused(_cid,_tenant,_actor,(_r->>'state_id')::uuid,'MCP_OAUTH_STALE');

  _sid := pg_temp.mcp_oauth_binding(_cid,_tenant,_actor);
  UPDATE public.mcp_connections SET enabled=false WHERE connection_id=_cid;
  PERFORM pg_temp.assert_grant_refused(_cid,_tenant,_actor,_sid,'MCP_OAUTH_STALE');
  UPDATE public.mcp_connections SET enabled=true WHERE connection_id=_cid;
  UPDATE public.mcp_connections SET auth_token_ct=public.platform_encrypt('rotated-test-credential') WHERE connection_id=_cid;
  PERFORM pg_temp.assert_grant_refused(_cid,_tenant,_actor,_sid,'MCP_OAUTH_STALE');

  _sid := pg_temp.mcp_oauth_binding(_cid,_tenant,_actor);
  UPDATE public.tenant_members SET role='member', is_owner=false WHERE tenant_id=_tenant AND user_id=_actor;
  PERFORM pg_temp.assert_grant_refused(_cid,_tenant,_actor,_sid,'MCP_FORBIDDEN');
  UPDATE public.tenant_members SET role='owner', is_owner=true WHERE tenant_id=_tenant AND user_id=_actor;
  UPDATE public.mcp_connection_oauth_state SET expires_at=clock_timestamp()-interval '1 second' WHERE id=_sid;
  PERFORM pg_temp.assert_grant_refused(_cid,_tenant,_actor,_sid,'MCP_OAUTH_STALE');

  _sid := pg_temp.mcp_oauth_binding(_cid,_tenant,_actor);
  _r := public.complete_mcp_oauth_grant(_cid,_tenant,'test-access-not-a-credential',NULL,
    'https://iss.example.com','client-123',NULL,ARRAY['mcp.read'],NULL,_actor,_sid);
  IF _r->>'status' IS DISTINCT FROM 'pending_verification' THEN RAISE EXCEPTION 'grant invented readiness'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_connection_oauth_state WHERE id=_sid AND completed_at IS NOT NULL AND NOT completion_allowed) THEN
    RAISE EXCEPTION 'grant did not atomically finish consent'; END IF;
  PERFORM pg_temp.assert_grant_refused(_cid,_tenant,_actor,_sid,'MCP_OAUTH_STALE');

  -- Retention removes only obsolete state, never the new flow.
  UPDATE public.mcp_connection_oauth_state SET expires_at=clock_timestamp()-interval '2 hours' WHERE id=_sid;
  PERFORM pg_temp.mcp_oauth_binding(_cid,_tenant,_actor);
  IF EXISTS (SELECT 1 FROM public.mcp_connection_oauth_state WHERE id=_sid) THEN RAISE EXCEPTION 'expired secret state retained'; END IF;

  -- Existing shared API tier routes are preserved, not reclassified as Solo.
  FOREACH _tier IN ARRAY ARRAY['standalone','agency','sub_account'] LOOP
    UPDATE public.tenants SET account_type=_tier WHERE id=_tenant;
    _sid := pg_temp.mcp_oauth_binding(_cid,_tenant,_actor);
    IF (SELECT return_destination FROM public.mcp_connection_oauth_state WHERE id=_sid)
       IS DISTINCT FROM (CASE WHEN _tier='standalone' THEN 'integrations' ELSE 'connections' END) THEN
      RAISE EXCEPTION 'incorrect server-owned destination for %', _tier;
    END IF;
  END LOOP;
  UPDATE public.tenants SET account_type='standalone' WHERE id=_tenant;
  SELECT config_generation INTO _generation FROM public.mcp_connections WHERE connection_id=_cid;
  PERFORM public.begin_mcp_oauth(_cid,_tenant,'test-invalid-pair','test-verifier','https://callback.example/oauth',
    'https://iss.example.com','https://resource.example/mcp','client-123',NULL,_actor,_generation,ARRAY['mcp.read']);
  UPDATE public.mcp_connection_oauth_state SET return_destination='connections' WHERE state='test-invalid-pair';
  IF public.consume_mcp_oauth_state('test-invalid-pair','exchange')->>'found' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'invalid stored tier/destination pair accepted';
  END IF;
END;
$$;
ROLLBACK;
