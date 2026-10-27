-- get_mcp_connections_v2 carries the CLOSED error code (EXP10 PR15): the owning tenant's
-- drawer can say WHY a connection failed without any provider prose crossing.
-- Disposable database only. Synthetic values, never provider credentials or tenant data.
--
-- WHY THIS FILE EXISTS. The surface's chip says "Couldn't reach it" but could not say why —
-- and the PR14 http_rate_limited split (wait, never reconnect) was invisible on the very
-- screen an owner opens when something breaks. The code is the table's CLOSED refusal
-- vocabulary (mcp_connections_last_error_code_shape_chk refuses prose at the WRITE), so
-- exposing it leaks no third-party content. Pinned directions:
--   (A) an errored probe's code reaches the tenant's own list read, verbatim;
--   (B) every listed value carries the closed shape — prose cannot ride this field;
--   (C) the shape CHECK refuses prose at the write (the boundary (A)/(B) rest on);
--   (D) a foreign tenant's list never carries this tenant's row.
--
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/mcp_connection_error_code_readback.sql "$DB_URL"

BEGIN;
\set ON_ERROR_STOP on

INSERT INTO auth.users(id) VALUES
 ('30000000-0000-4000-8000-000000000081'), ('30000000-0000-4000-8000-000000000082');
INSERT INTO public.tenants(id,slug,name,status,account_type) VALUES
 ('30000000-0000-4000-8000-000000000083','test-errcode-a','Test errcode A','active','standalone'),
 ('30000000-0000-4000-8000-000000000084','test-errcode-b','Test errcode B','active','standalone');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('30000000-0000-4000-8000-000000000083','30000000-0000-4000-8000-000000000081','owner','active',true),
 ('30000000-0000-4000-8000-000000000084','30000000-0000-4000-8000-000000000082','owner','active',true);
CREATE TEMP TABLE errcode_proof(result jsonb);
GRANT ALL ON errcode_proof TO authenticated;

-- Create the connection as the owner, through the REAL writer.
SET LOCAL request.jwt.claims='{"sub":"30000000-0000-4000-8000-000000000081","role":"authenticated"}';
SET LOCAL ROLE authenticated;
INSERT INTO errcode_proof SELECT public.create_mcp_connection(
 _provider_key=>'generic-remote', _label=>'Test error code readback',
 _server_url=>'https://server.example/api/mcp', _auth_kind=>'bearer',
 _auth_token=>'test-token-not-a-credential');
RESET ROLE;

-- ── (A)+(B) the probe's closed code reaches the owner's list, and everything listed is closed-shaped ──
SET LOCAL request.jwt.claims='{"sub":"30000000-0000-4000-8000-000000000081","role":"authenticated"}';
DO $$
DECLARE cid uuid; generation bigint; code text; r jsonb;
BEGIN
  SELECT (result->>'connection_id')::uuid INTO cid FROM errcode_proof;
  SELECT config_generation INTO generation FROM public.mcp_connections WHERE connection_id = cid;
  IF cid IS NULL OR generation IS NULL THEN RAISE EXCEPTION '(0) fixture write failed'; END IF;

  -- The service-role probe is the only writer of status/health/error_code; it is what the
  -- gateway's verify action runs. An errored probe with the PR14 closed code:
  PERFORM public.mcp_connection_probe(cid, 'error', 'needs_attention', 'http_rate_limited',
    NULL, generation);

  -- (A) the owner's own list read carries it verbatim.
  SELECT value->>'last_error_code' INTO code
    FROM jsonb_array_elements(public.get_mcp_connections_v2()) value
   WHERE value->>'connection_id' = cid::text;
  IF code IS DISTINCT FROM 'http_rate_limited' THEN
    RAISE EXCEPTION '(A) the list read must carry the probe''s closed code verbatim, got %', code;
  END IF;

  -- (B) whatever else is listed, every non-null code value is closed-shaped.
  FOR code IN
    SELECT value->>'last_error_code'
      FROM jsonb_array_elements(public.get_mcp_connections_v2()) value
     WHERE value->>'last_error_code' IS NOT NULL
  LOOP
    IF code !~ '^[a-z0-9_]{1,64}$' THEN
      RAISE EXCEPTION '(B) a non-closed value crossed the list read: %', code;
    END IF;
  END LOOP;
END $$;

-- ── (C) the write-side CHECK refuses prose (the boundary (A)/(B) rest on) ──────────────────
DO $$
DECLARE cid uuid; generation bigint;
BEGIN
  SELECT (result->>'connection_id')::uuid INTO cid FROM errcode_proof;
  SELECT config_generation INTO generation FROM public.mcp_connections WHERE connection_id = cid;
  BEGIN
    PERFORM public.mcp_connection_probe(cid, 'error', 'needs_attention',
      'provider said: check your key!!!', NULL, generation);
    RAISE EXCEPTION '(C) a prose error code was accepted by the probe write';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- ── (D) a foreign tenant's list never carries this row ────────────────────────────────────
SET LOCAL request.jwt.claims='{"sub":"30000000-0000-4000-8000-000000000082","role":"authenticated"}';
DO $$
DECLARE cid uuid;
BEGIN
  SELECT (result->>'connection_id')::uuid INTO cid FROM errcode_proof;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_mcp_connections_v2()) value
              WHERE value->>'connection_id' = cid::text) THEN
    RAISE EXCEPTION '(D) a foreign tenant read this connection';
  END IF;
END $$;

ROLLBACK;
