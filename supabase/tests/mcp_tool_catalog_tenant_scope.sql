-- ============================================================================
-- get_mcp_connection_tools: a tenant reads its OWN tool catalogue, and nothing else.
--
-- WHY THIS FILE EXISTS, precisely. The obvious way to build this read — mirror
-- `get_mcp_connections_v2`, which is the neighbouring tenant-scoped read — is
-- WRONG, and wrong in a way that compiles, passes a smoke test, and leaks every
-- tenant's data to every other tenant. v2's isolation is not in
-- `_mcp_resolve_tenant`; it is in v2's `WHERE c.tenant_id = _tenant` LIST filter.
-- `_mcp_resolve_tenant` scopes the CALLER — it takes no connection_id and
-- asserts nothing about one. A by-id read that resolves the tenant and then
-- selects `WHERE connection_id = $1` computes the tenant and discards it, and
-- because SECURITY DEFINER bypasses the owner-only RLS on both child tables, any
-- member of any tenant then reads any connection's catalogue.
--
-- That was demonstrated, not theorised: with the tenant predicate removed from
-- the lookup, a tenant-A member reading a tenant-B connection returned
-- `[{"app":"BApp","tool_name":"b_tool",...}]`. Assertion B below is the one that
-- fails if anyone ever "simplifies" the bind again.
--
-- The other three things this pins, each of which has a specific failure mode:
--   C  owner_only is re-checked AFTER the row is bound. Binding the tenant alone
--      lets an ordinary member enumerate the tools of a connection v2 hides from
--      them completely — a strictly NEW disclosure.
--   D  unknown id, foreign tenant and owner_only-without-standing raise ONE
--      identical error. A distinguishable refusal is an existence oracle, and
--      this seam already pays for uniformity elsewhere.
--   E  an empty array means "connected, catalogue not probed yet" and NOTHING
--      else. This is not hypothetical: prod carries 4 connections and 0 tool
--      rows, so `[]` is the live answer for every connection until a verify
--      succeeds. If a refusal ever collapses into `[]`, the surface can no
--      longer tell an owner which of the two is true.
--   F  no credential or verification material crosses — checked by VALUE, not
--      just by key name, so a rename cannot defeat it. `endpoint_hash` is the
--      one that matters most: an unsalted sha256 over the FULL DECRYPTED url,
--      whose own generator is revoked from `authenticated`.
--   G  a tool_name that is not a clean identifier is DROPPED. There is no CHECK
--      on that column; the writer only bounds length.
--
-- Synthetic fixtures only; self-contained; ROLLS BACK. Any RAISE = fail
-- (ON_ERROR_STOP); reaching the terminal notice = pass.
--
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/mcp_tool_catalog_tenant_scope.sql "$DB_URL"
-- ============================================================================
BEGIN;

-- ── Actors ──────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('c7a00000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'tc-a-member@tests.invalid'),
  ('c7a00000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'tc-a-admin@tests.invalid'),
  ('c7a00000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'tc-b-member@tests.invalid');

-- `slug` is NOT NULL. Omitting it made this fixture unrunnable, which the first
-- real execution of this file against Postgres is what surfaced — a test nobody
-- had run is a test that proves nothing, however carefully it was written.
INSERT INTO public.tenants (id, name, slug) VALUES
  ('c7a00000-0000-4000-8000-00000000000a', 'Tool catalog tenant A', 'tool-catalog-tenant-a'),
  ('c7a00000-0000-4000-8000-00000000000b', 'Tool catalog tenant B', 'tool-catalog-tenant-b');

INSERT INTO public.tenant_members (tenant_id, user_id, role, status) VALUES
  ('c7a00000-0000-4000-8000-00000000000a', 'c7a00000-0000-4000-8000-0000000000a1', 'member', 'active'),
  ('c7a00000-0000-4000-8000-00000000000a', 'c7a00000-0000-4000-8000-0000000000a2', 'admin',  'active'),
  ('c7a00000-0000-4000-8000-00000000000b', 'c7a00000-0000-4000-8000-0000000000b1', 'member', 'active');

-- ── Connections: one ordinary, one owner_only, one never probed, one foreign ──
INSERT INTO public.mcp_connections
  (connection_id, tenant_id, provider_key, label, transport, auth_kind, visibility, enabled, status, health)
VALUES
  ('c7a00000-0000-4000-8000-0000000000c1', 'c7a00000-0000-4000-8000-00000000000a', 'generic-remote', 'A ordinary',  'http', 'none', 'tenant',     true, 'connected', 'healthy'),
  ('c7a00000-0000-4000-8000-0000000000c2', 'c7a00000-0000-4000-8000-00000000000a', 'generic-remote', 'A owner-only','http', 'none', 'owner_only', true, 'connected', 'healthy'),
  ('c7a00000-0000-4000-8000-0000000000c3', 'c7a00000-0000-4000-8000-00000000000a', 'generic-remote', 'A unprobed',  'http', 'none', 'tenant',     true, 'connected', 'unknown'),
  ('c7a00000-0000-4000-8000-0000000000c4', 'c7a00000-0000-4000-8000-00000000000a', 'generic-remote', 'A no endpoint','http','none', 'tenant',     true, 'connected', 'healthy'),
  ('c7a00000-0000-4000-8000-0000000000c9', 'c7a00000-0000-4000-8000-00000000000b', 'generic-remote', 'B ordinary',  'http', 'none', 'tenant',     true, 'connected', 'healthy');

-- `platform_encrypt` RAISES when `platform_column_key` is not seeded, and a fresh
-- CI stack has no reason to hold one — so without this the test would fail for an
-- environmental reason and look like a real defect. Seeded inside the aborted
-- transaction, and a no-op wherever a key already exists (encrypt and decrypt read
-- the same row, so either value round-trips).
INSERT INTO public._internal_secrets (key, value)
VALUES ('platform_column_key', 'mcp-tool-catalogue-test-key-not-a-real-secret')
ON CONFLICT (key) DO NOTHING;

-- c1 carries a REAL encrypted endpoint. Without one every approval on it reports
-- `endpoint_missing`, which is precisely the defect this fixture set now proves:
-- the first draft of these connections had no `server_url_ct` at all, so every
-- assertion below about a live approval was passing over consent the runner would
-- have declined. c4 deliberately keeps NO endpoint, so that state is covered too.
UPDATE public.mcp_connections
   SET server_url_ct = public.platform_encrypt('https://a.example.invalid/mcp')
 WHERE connection_id = 'c7a00000-0000-4000-8000-0000000000c1';

-- Distinctive, searchable secret values so assertion F can check by VALUE.
INSERT INTO public.mcp_connection_tools
  (connection_id, tool_name, schema_hash, authority_hash, pin, app, action_type, effects)
VALUES
  ('c7a00000-0000-4000-8000-0000000000c1', 'send_email',    repeat('11',32), repeat('22',32), repeat('33',32), 'Gmail', 'email.send',   ARRAY['send']),
  ('c7a00000-0000-4000-8000-0000000000c1', 'list_contacts', repeat('44',32), repeat('55',32), repeat('66',32), 'Gmail', 'contact.list', ARRAY['read']),
  -- G: not a clean identifier. Must be dropped, never sanitized in place.
  ('c7a00000-0000-4000-8000-0000000000c1', '<script>x</script>', repeat('77',32), repeat('88',32), repeat('99',32), 'Evil', 'x', ARRAY['read']),
  ('c7a00000-0000-4000-8000-0000000000c2', 'secret_tool',   repeat('aa',32), repeat('bb',32), repeat('cc',32), 'Vault', 'x',  ARRAY['read']),
  ('c7a00000-0000-4000-8000-0000000000c9', 'b_tool',        repeat('dd',32), repeat('ee',32), repeat('ff',32), 'BApp',  'x',  ARRAY['read']),
  -- The three states that separate "an approval row exists" from "the runner will
  -- authorize this". Each one used to come back indistinguishable from a good one.
  ('c7a00000-0000-4000-8000-0000000000c1', 'clean_tool',    repeat('a1',32), repeat('a2',32), repeat('a3',32), 'Gmail', 'x',  ARRAY['read']),
  ('c7a00000-0000-4000-8000-0000000000c1', 'unbound_tool',  repeat('b1',32), repeat('b2',32), repeat('b3',32), 'Gmail', 'x',  ARRAY['read']),
  ('c7a00000-0000-4000-8000-0000000000c1', 'moved_tool',    repeat('c1',32), repeat('c2',32), repeat('c3',32), 'Gmail', 'x',  ARRAY['read']),
  ('c7a00000-0000-4000-8000-0000000000c4', 'homeless_tool', repeat('d1',32), repeat('d2',32), repeat('d3',32), 'Gmail', 'x',  ARRAY['read']);

-- One approval whose pin has DRIFTED from the tool (stale), one already EXPIRED.
-- `trg_mcp_reject_past_approval_expiry` fires BEFORE INSERT OR UPDATE and refuses
-- an expiry already in the past, so an expired approval cannot be written through
-- the front door at all — which is correct for the WRITE path and made the fixture
-- below impossible to insert. (That is not a hypothetical: it is why this file
-- could not run until it was executed against Postgres for the first time.) The
-- state itself is entirely natural — it is what every approval becomes when its
-- window passes — and it is the READ path under test here, so the guard is lifted
-- for the insert and restored immediately, inside a transaction that rolls back.
ALTER TABLE public.mcp_connection_approvals DISABLE TRIGGER trg_mcp_reject_past_approval_expiry;

INSERT INTO public.mcp_connection_approvals
  (connection_id, tool_name, pin, approved_by, endpoint_hash, args_shape_hash, expires_at)
VALUES
  ('c7a00000-0000-4000-8000-0000000000c1', 'send_email',    repeat('00',32), 'c7a00000-0000-4000-8000-0000000000a2', public._mcp_endpoint_hash('https://a.example.invalid/mcp'), repeat('cd',32), now() + interval '1 day'),
  ('c7a00000-0000-4000-8000-0000000000c1', 'list_contacts', repeat('66',32), 'c7a00000-0000-4000-8000-0000000000a2', public._mcp_endpoint_hash('https://a.example.invalid/mcp'), repeat('cd',32), now() - interval '1 hour'),
  -- pin matches, endpoint matches, unexpired, endpoint-bound: the ONLY shape that
  -- may report no blocking reason.
  ('c7a00000-0000-4000-8000-0000000000c1', 'clean_tool',    repeat('a3',32), 'c7a00000-0000-4000-8000-0000000000a2', public._mcp_endpoint_hash('https://a.example.invalid/mcp'), NULL, now() + interval '1 day'),
  -- A pre-Phase-C approval carrying no endpoint binding. The runner fails this
  -- CLOSED; before `approval_blocked_reason` the catalogue reported it as good.
  ('c7a00000-0000-4000-8000-0000000000c1', 'unbound_tool',  repeat('b3',32), 'c7a00000-0000-4000-8000-0000000000a2', NULL, NULL, now() + interval '1 day'),
  -- Bound to an endpoint that is no longer this connection's.
  ('c7a00000-0000-4000-8000-0000000000c1', 'moved_tool',    repeat('c3',32), 'c7a00000-0000-4000-8000-0000000000a2', public._mcp_endpoint_hash('https://somewhere-else.example.invalid/mcp'), NULL, now() + interval '1 day'),
  -- Perfect in every way except that its connection has no endpoint at all.
  ('c7a00000-0000-4000-8000-0000000000c4', 'homeless_tool', repeat('d3',32), 'c7a00000-0000-4000-8000-0000000000a2', public._mcp_endpoint_hash('https://a.example.invalid/mcp'), NULL, now() + interval '1 day');

ALTER TABLE public.mcp_connection_approvals ENABLE TRIGGER trg_mcp_reject_past_approval_expiry;

DO $$
DECLARE
  _v jsonb;
  _n int;
  _errs text[] := ARRAY[]::text[];
  _msgs text[] := ARRAY[]::text[];
  _m text;
  -- Resolved while this block is still `postgres`. `_mcp_endpoint_hash` is REVOKEd
  -- from `authenticated`, so calling it after the role switch below fails with
  -- `permission denied` — which is the revoke working, not a test problem, and is
  -- exactly what a tenant is prevented from doing. The expected VALUES are captured
  -- here so assertion F can still check for them once impersonation starts.
  _hash_live text;
  _hash_moved text;
BEGIN
  _hash_live  := public._mcp_endpoint_hash('https://a.example.invalid/mcp');
  _hash_moved := public._mcp_endpoint_hash('https://somewhere-else.example.invalid/mcp');
  -- ── (A) grant surface: authenticated only, never anon, never service_role ──
  IF has_function_privilege('anon', 'public.get_mcp_connection_tools(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '(A) anon can EXECUTE the tool catalogue read';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_mcp_connection_tools(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '(A) authenticated CANNOT execute it — the surface is unreachable';
  END IF;
  IF has_function_privilege('service_role', 'public.get_mcp_connection_tools(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '(A) service_role was granted EXECUTE. A headless caller resolves its tenant from the REQUEST BODY, so this reintroduces the caller-supplied-tenant shape the writers refuse.';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='get_mcp_connection_tools') THEN
    RAISE EXCEPTION '(A) not SECURITY DEFINER — both child tables are owner-only, so it would return nothing';
  END IF;

  -- ── caller: ORDINARY MEMBER of tenant A ──────────────────────────────────
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"c7a00000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

  -- (B) own connection: readable.
  _v := public.get_mcp_connection_tools('c7a00000-0000-4000-8000-0000000000c1');
  IF jsonb_array_length(_v) <> 5 THEN
    _errs := _errs || format('(B) expected 5 clean tools on the member''s own connection, got %s: %s', jsonb_array_length(_v), _v);
  END IF;

  -- (G) the injection-shaped name was dropped, not sanitized.
  IF _v::text ~* 'script|alert' THEN
    _errs := _errs || '(G) a tool_name that is not an identifier survived into the payload';
  END IF;

  -- (F) nothing withheld may cross — by KEY and by VALUE.
  IF _v::text ~ '"pin"|"schema_hash"|"authority_hash"|"endpoint_hash"|"args_shape_hash"|"approved_by"' THEN
    _errs := _errs || '(F) a withheld KEY crossed to the tenant';
  END IF;
  IF _v::text LIKE '%'||repeat('33',32)||'%' THEN _errs := _errs || '(F) the tool pin VALUE crossed'; END IF;
  IF _v::text LIKE '%'||repeat('11',32)||'%' THEN _errs := _errs || '(F) schema_hash VALUE crossed'; END IF;
  -- Checked against the REAL hash the fixtures now carry. It used to check a
  -- made-up constant, which stopped meaning anything the moment the approvals
  -- started holding genuine endpoint hashes — a test that passes because it is
  -- looking for something nothing produces.
  IF _v::text LIKE '%'||_hash_live||'%' THEN
    _errs := _errs || '(F) endpoint_hash VALUE crossed — an unsalted sha256 over the FULL decrypted url, whose generator is revoked from authenticated';
  END IF;
  IF _v::text LIKE '%'||_hash_moved||'%' THEN
    _errs := _errs || '(F) a STALE endpoint_hash crossed — the moved-endpoint approval''s binding must stay server-side too';
  END IF;
  IF _v::text LIKE '%c7a00000-0000-4000-8000-0000000000a2%' THEN
    _errs := _errs || '(F) the approver uuid crossed — it can be a platform operator''s';
  END IF;

  -- server-computed verdicts, not client arithmetic. Addressed BY NAME rather than
  -- by index, because an index-addressed assertion silently re-points at a
  -- different tool the moment a row is added — which is how a green suite starts
  -- checking something other than what it says it checks.
  IF (_v->0->>'tool_name') <> 'clean_tool' THEN _errs := _errs || format('(B) rows not ordered by tool_name, first is %s', _v->0->>'tool_name'); END IF;
  IF (SELECT e->>'approval_expired' FROM jsonb_array_elements(_v) e WHERE e->>'tool_name'='list_contacts') <> 'true'
    THEN _errs := _errs || '(B) an expired approval was not flagged expired'; END IF;
  IF (SELECT e->>'approval_stale' FROM jsonb_array_elements(_v) e WHERE e->>'tool_name'='send_email') <> 'true'
    THEN _errs := _errs || '(B) a drifted pin was not flagged stale'; END IF;
  IF (SELECT e->>'approval_expired' FROM jsonb_array_elements(_v) e WHERE e->>'tool_name'='send_email') <> 'false'
    THEN _errs := _errs || '(B) a live approval was wrongly flagged expired'; END IF;

  -- ── (H) "approved" IS WEAKER THAN "the runner will authorize this" ─────────
  -- verify_mcp_connection_approval refuses on seven conditions. This read models
  -- the five a catalogue can see, in that function's own order. Before it did,
  -- every row below came back approved/unexpired/unstale and the surface said
  -- "You approved this" over consent the runner would decline.
  IF (SELECT e->>'approval_blocked_reason' FROM jsonb_array_elements(_v) e WHERE e->>'tool_name'='clean_tool') IS NOT NULL THEN
    _errs := _errs || format('(H) a pin-matching, endpoint-bound, unexpired approval must report NO blocking reason, got %s',
      (SELECT e->>'approval_blocked_reason' FROM jsonb_array_elements(_v) e WHERE e->>'tool_name'='clean_tool'));
  END IF;
  IF (SELECT e->>'approval_blocked_reason' FROM jsonb_array_elements(_v) e WHERE e->>'tool_name'='unbound_tool') <> 'approval_not_endpoint_bound' THEN
    _errs := _errs || '(H) an approval with NO endpoint binding was not reported as unbound — the runner fails it closed';
  END IF;
  IF (SELECT e->>'approval_blocked_reason' FROM jsonb_array_elements(_v) e WHERE e->>'tool_name'='moved_tool') <> 'endpoint_changed' THEN
    _errs := _errs || '(H) an approval bound to a DIFFERENT endpoint was not reported as moved';
  END IF;
  IF (SELECT e->>'approval_blocked_reason' FROM jsonb_array_elements(_v) e WHERE e->>'tool_name'='send_email') <> 'contract_changed' THEN
    _errs := _errs || '(H) a drifted pin must block, and must say contract_changed — the verifier''s own word';
  END IF;
  IF (SELECT e->>'approval_blocked_reason' FROM jsonb_array_elements(_v) e WHERE e->>'tool_name'='list_contacts') <> 'approval_expired' THEN
    _errs := _errs || '(H) an expired approval must block';
  END IF;
  -- An UNAPPROVED action has no approval to block. NULL here must mean "nothing
  -- blocks the consent", never "there is no consent" — `approved` carries that.
  IF (SELECT e->>'approval_blocked_reason' FROM jsonb_array_elements(_v) e WHERE e->>'tool_name'='unbound_tool') IS NULL
     AND (SELECT e->>'approved' FROM jsonb_array_elements(_v) e WHERE e->>'tool_name'='unbound_tool') = 'true' THEN
    _errs := _errs || '(H) an approved-but-unusable row reported no reason';
  END IF;

  -- (H2) a connection with NO endpoint blocks every approval on it, whatever the
  -- approval itself looks like. Its own read, because it is a different row.
  _v := public.get_mcp_connection_tools('c7a00000-0000-4000-8000-0000000000c4');
  IF (SELECT e->>'approval_blocked_reason' FROM jsonb_array_elements(_v) e WHERE e->>'tool_name'='homeless_tool') <> 'endpoint_missing' THEN
    _errs := _errs || format('(H2) an approval on an endpoint-less connection must report endpoint_missing, got %s', _v);
  END IF;
  -- And the hash still must not cross, on this path too.
  IF _v::text ~ '"endpoint_hash"|"pin"' THEN _errs := _errs || '(H2) a withheld key crossed on the endpoint-less path'; END IF;

  -- (E) own connection, never probed: EMPTY, and emphatically not a refusal.
  _v := public.get_mcp_connection_tools('c7a00000-0000-4000-8000-0000000000c3');
  IF _v <> '[]'::jsonb THEN
    _errs := _errs || format('(E) an unprobed connection must answer [] , got %s', _v);
  END IF;

  -- ── the three refusals. Collect each message; they must be IDENTICAL. ─────
  BEGIN
    _v := public.get_mcp_connection_tools('c7a00000-0000-4000-8000-0000000000c9');  -- foreign tenant
    _errs := _errs || format('(B) CROSS-TENANT LEAK: a tenant-A member read tenant B''s catalogue: %s', _v);
  EXCEPTION WHEN OTHERS THEN _msgs := _msgs || SQLERRM; END;

  BEGIN
    _v := public.get_mcp_connection_tools('c7a00000-0000-4000-8000-0000000000c2');  -- owner_only, member
    _errs := _errs || format('(C) an ordinary member enumerated an owner_only connection''s tools: %s', _v);
  EXCEPTION WHEN OTHERS THEN _msgs := _msgs || SQLERRM; END;

  BEGIN
    _v := public.get_mcp_connection_tools('c7a00000-0000-4000-8000-0000000000ff');  -- unknown id
    _errs := _errs || format('(D) an unknown connection_id did not refuse: %s', _v);
  EXCEPTION WHEN OTHERS THEN _msgs := _msgs || SQLERRM; END;

  IF array_length(_msgs,1) IS DISTINCT FROM 3 THEN
    _errs := _errs || format('(D) expected 3 refusals, captured %s', coalesce(array_length(_msgs,1),0));
  ELSE
    FOREACH _m IN ARRAY _msgs LOOP
      IF _m IS DISTINCT FROM _msgs[1] THEN
        _errs := _errs || format('(D) EXISTENCE ORACLE: the refusals differ — %s vs %s. Unknown, foreign and owner_only must be indistinguishable.', _msgs[1], _m);
      END IF;
    END LOOP;
  END IF;

  -- ── caller: tenant A ADMIN ───────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    '{"sub":"c7a00000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

  -- (C) standing opens owner_only …
  _v := public.get_mcp_connection_tools('c7a00000-0000-4000-8000-0000000000c2');
  IF jsonb_array_length(_v) <> 1 THEN
    _errs := _errs || format('(C) a tenant admin must see the owner_only connection''s tools, got %s', _v);
  END IF;

  -- … but standing is NOT a passport across tenants.
  BEGIN
    _v := public.get_mcp_connection_tools('c7a00000-0000-4000-8000-0000000000c9');
    _errs := _errs || format('(B) a tenant-A ADMIN read tenant B''s catalogue: %s', _v);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- ── caller: a member of tenant B — the mirror of (B) ─────────────────────
  PERFORM set_config('request.jwt.claims',
    '{"sub":"c7a00000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
  BEGIN
    _v := public.get_mcp_connection_tools('c7a00000-0000-4000-8000-0000000000c1');
    _errs := _errs || format('(B) a tenant-B member read tenant A''s catalogue: %s', _v);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('role', 'postgres', true);

  IF array_length(_errs,1) IS NOT NULL THEN
    RAISE EXCEPTION 'get_mcp_connection_tools FAILURES: %', array_to_string(_errs, E'\n  - ');
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'MCP_TOOL_CATALOG_TENANT_SCOPE_PROVEN'; END $$;

ROLLBACK;
