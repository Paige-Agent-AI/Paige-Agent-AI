-- Test-only setup through the real begin/consume contract. The caller owns its test transaction.
CREATE OR REPLACE FUNCTION pg_temp.mcp_oauth_binding(_cid uuid, _tenant uuid, _actor uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _state text := gen_random_uuid()::text; _generation bigint; _result jsonb;
BEGIN
  SELECT config_generation INTO _generation FROM public.mcp_connections WHERE connection_id = _cid;
  PERFORM public.begin_mcp_oauth(_cid, _tenant, _state, 'test-verifier-not-a-credential',
    'https://callback.example/oauth', 'https://iss.example.com', 'https://resource.example/mcp',
    'client-123', NULL, _actor, _generation, ARRAY['mcp.read','mcp.write']);
  _result := public.consume_mcp_oauth_state(_state, 'exchange');
  IF _result->>'found' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'test OAuth binding failed'; END IF;
  RETURN (_result->>'state_id')::uuid;
END;
$$;
