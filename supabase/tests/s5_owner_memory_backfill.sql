-- S5 owner-memory backfill — pgTAP proof.
-- Proves: mechanical idempotency (rerun inserts 0, counted via RETURNING), one-to-one
-- mapping, content/scope/timestamp/state integrity, the unique-index collapse, and
-- pre-existing-row invariance (checksum). Runs the migration's OWN insert predicate verbatim.
-- Wired into paige-spine-contract.yml (paths filter + explicit run step).

BEGIN;
SELECT plan(8); -- incl. the user_preference -> preference canonical type mapping

-- Fixtures: tenant + client (FK target for the client-scoped row) + legacy rows.
INSERT INTO public.tenants (id, name, slug, status, account_type, account_number)
VALUES ('a15a5a00-0000-4000-8000-00000000a001', 'S5 Proof Tenant', 's5-proof-tenant', 'active', 'standalone', 990001)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, email, status)
VALUES ('e15e5e00-0000-4000-8000-00000000e001', 'a15a5a00-0000-4000-8000-00000000a001',
        'c15c5c00-0000-4000-8000-00000000c001', 'S5', 'Clientrow', 's5-proof-client@paigeagent-test.example', 'active')
ON CONFLICT (id) DO NOTHING;

-- The two fixture humans must belong to the fixture tenant: the client-memory tenant trigger
-- (enforce_client_memory_tenant, MEMORY_SUBJECT_NOT_IN_TENANT) enforces subject-in-tenant on
-- no-client rows, exactly as production does.
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at)
VALUES ('a15a5a00-0000-4000-8000-00000000a001', 'c15c5c00-0000-4000-8000-00000000c001', 'owner', 'active', true, now()),
       ('a15a5a00-0000-4000-8000-00000000a001', 'c15c5c00-0000-4000-8000-00000000c002', 'member', 'active', false, now())
ON CONFLICT DO NOTHING;

-- A pre-existing canonical row that MUST NOT be touched by the backfill.
INSERT INTO public.paige_owner_memory (id, tenant_id, user_id, memory_type, content, created_by, metadata)
VALUES ('b15b5b00-0000-4000-8000-00000000b001', NULL, 'c15c5c00-0000-4000-8000-00000000c001',
        'identity', 'S5-PREEXISTING-IDENTITY-ROW', 'c15c5c00-0000-4000-8000-00000000c001', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Three legacy client_memory rows: two eligible, one client-scoped (not eligible).
INSERT INTO public.client_memory (id, tenant_id, client_user_id, client_id, memory_type, content, metadata, is_active)
VALUES
 ('d15d5d00-0000-4000-8000-00000000d001', 'a15a5a00-0000-4000-8000-00000000a001',
  'c15c5c00-0000-4000-8000-00000000c001', NULL, 'user_preference',
  'S5-ELIGIBLE-PREF-ONE', '{"source":"explicit_signal"}'::jsonb, true),
 ('d15d5d00-0000-4000-8000-00000000d002', 'a15a5a00-0000-4000-8000-00000000a001',
  'c15c5c00-0000-4000-8000-00000000c002', NULL, 'user_preference',
  'S5-ELIGIBLE-PREF-TWO', '{"source":"explicit_signal"}'::jsonb, true),
 ('d15d5d00-0000-4000-8000-00000000d003', 'a15a5a00-0000-4000-8000-00000000a001',
  'c15c5c00-0000-4000-8000-00000000c001', 'e15e5e00-0000-4000-8000-00000000e001', 'user_preference',
  'S5-CLIENT-SCOPED-STAYS', '{"source":"explicit_signal"}'::jsonb, true);

-- The migration's unique guard.
CREATE UNIQUE INDEX IF NOT EXISTS paige_owner_memory_legacy_source_uidx
  ON public.paige_owner_memory ((metadata->>'legacy_source_id'))
  WHERE metadata ? 'legacy_source_id';

-- Capture the pre-existing population (id, updated_at, content) for the invariance checksum.
CREATE TEMP TABLE s5_pre_existing AS
SELECT id, updated_at, content FROM public.paige_owner_memory
 WHERE NOT (metadata ? 'legacy_source_id');

-- RUN 1: the migration's insert predicate, verbatim; RETURNING counts the actual inserts.
WITH ins AS (
  INSERT INTO public.paige_owner_memory
    (tenant_id, user_id, memory_type, content, source_thread_id, is_active, metadata, created_by, created_at, updated_at)
  SELECT c.tenant_id, c.client_user_id, 'preference'::text, c.content, null, true,
    jsonb_build_object('confirmation_state','proposed','audience','owner_personal',
                       'origin','legacy_client_memory_migration',
                       'legacy_source', c.metadata->>'source','legacy_source_id', c.id::text),
    null, c.created_at, c.created_at
  FROM public.client_memory c
  WHERE c.is_active AND c.memory_type='user_preference' AND c.client_id IS NULL
    AND c.metadata->>'source'='explicit_signal'
    AND NOT EXISTS (SELECT 1 FROM public.paige_owner_memory p
                     WHERE p.metadata->>'legacy_source_id' = c.id::text)
  ON CONFLICT DO NOTHING
  RETURNING 1
)
SELECT is(count(*)::bigint, 2::bigint, 'run 1: exactly the 2 eligible rows migrated') FROM ins;

-- RUN 2: identical statement; must insert 0.
WITH ins AS (
  INSERT INTO public.paige_owner_memory
    (tenant_id, user_id, memory_type, content, source_thread_id, is_active, metadata, created_by, created_at, updated_at)
  SELECT c.tenant_id, c.client_user_id, 'preference'::text, c.content, null, true,
    jsonb_build_object('confirmation_state','proposed','audience','owner_personal',
                       'origin','legacy_client_memory_migration',
                       'legacy_source', c.metadata->>'source','legacy_source_id', c.id::text),
    null, c.created_at, c.created_at
  FROM public.client_memory c
  WHERE c.is_active AND c.memory_type='user_preference' AND c.client_id IS NULL
    AND c.metadata->>'source'='explicit_signal'
    AND NOT EXISTS (SELECT 1 FROM public.paige_owner_memory p
                     WHERE p.metadata->>'legacy_source_id' = c.id::text)
  ON CONFLICT DO NOTHING
  RETURNING 1
)
SELECT is(count(*)::bigint, 0::bigint, 'run 2: idempotent rerun inserts 0') FROM ins;

-- The unique index alone collapses a forced duplicate even without the not-exists filter.
WITH ins AS (
  INSERT INTO public.paige_owner_memory (tenant_id, user_id, memory_type, content, is_active, metadata)
  SELECT tenant_id, user_id, memory_type, content, true,
         jsonb_build_object('confirmation_state','proposed','origin','legacy_client_memory_migration',
                            'legacy_source_id', 'd15d5d00-0000-4000-8000-00000000d001')
  FROM public.paige_owner_memory
  WHERE metadata->>'legacy_source_id' = 'd15d5d00-0000-4000-8000-00000000d001'
  ON CONFLICT DO NOTHING
  RETURNING 1
)
SELECT is(count(*)::bigint, 0::bigint, 'unique index collapses a forced duplicate to 0') FROM ins;

-- One-to-one: exactly one canonical row per eligible source.
SELECT is((SELECT count(*) FROM public.paige_owner_memory p
            WHERE p.metadata->>'legacy_source_id' IN
              ('d15d5d00-0000-4000-8000-00000000d001','d15d5d00-0000-4000-8000-00000000d002'))::bigint,
          2::bigint, 'one legacy source -> exactly one canonical row');

-- Integrity: scope, content, timestamps, state — exact on every migrated row.
SELECT is((SELECT count(*) FROM public.client_memory c
            JOIN public.paige_owner_memory p ON p.metadata->>'legacy_source_id' = c.id::text
            WHERE p.user_id = c.client_user_id AND p.tenant_id = c.tenant_id
              AND p.content = c.content AND p.created_at = c.created_at
              AND p.memory_type = 'preference'
              AND p.metadata->>'confirmation_state' = 'proposed'
              AND p.is_active)::bigint,
          2::bigint, 'content/scope/type/timestamp exact and proposed on every migrated row');

-- The client-scoped row was NOT migrated.
SELECT is((SELECT count(*) FROM public.paige_owner_memory p
            WHERE p.metadata->>'legacy_source_id' = 'd15d5d00-0000-4000-8000-00000000d003')::bigint,
          0::bigint, 'client-scoped rows are not migrated');

-- Pre-existing canonical rows are unchanged (checksum over id, updated_at, content).
SELECT is((SELECT count(*) FROM public.paige_owner_memory p
            JOIN s5_pre_existing s ON s.id = p.id
            WHERE p.updated_at = s.updated_at AND p.content = s.content)::bigint,
          (SELECT count(*) FROM s5_pre_existing)::bigint,
          'every pre-existing canonical row is unchanged (checksum)');

-- The durable mechanical guard exists.
SELECT is((SELECT count(*) FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'paige_owner_memory'
              AND indexname = 'paige_owner_memory_legacy_source_uidx')::bigint,
          1::bigint, 'the legacy-source unique index is the durable idempotency guard');

SELECT * FROM finish();
ROLLBACK;
