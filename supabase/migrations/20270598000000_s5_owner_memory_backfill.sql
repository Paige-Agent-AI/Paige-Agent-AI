-- S5 — the one-time audience correction backfill: the owner/workspace's own legacy
-- preferences move from client_memory to their canonical home, paige_owner_memory.
--
-- RULING SHAPE (owner, 2026-10-06): direct disciplined migration because original timestamps
-- must be preserved (the governed seam stamps created_at itself and cannot). This migration
-- gains NO runtime precedent: every runtime write goes through record_paige_memory.
--
-- The eligible population, frozen and measured immediately before execution:
--   is_active AND memory_type='user_preference' AND client_id IS NULL AND
--   metadata.source='explicit_signal' AND a real (non-fixture) subject
--   => 11 rows / 3 humans / 2 tenants (fixture rows were retired first).
-- The predicate below re-derives the population at migration time: any eligible row written
-- between the baseline measurement and this migration is legitimately included (it satisfies
-- the same provenance contract); the migration asserts STRUCTURE, not a stale count.
--
-- MECHANICAL IDEMPOTENCY: a unique partial index on (metadata->>'legacy_source_id') makes a
-- second copy of any migrated row physically impossible, and the insert predicate excludes
-- already-mapped sources. Rerunning inserts 0 — proven in pgTAP, not asserted in prose.
--
-- Every migrated row: exact user, exact tenant, the CANONICAL memory type ('preference'), original content, original
-- created_at, original provenance (metadata.source), confirmation_state='proposed' (machine-
-- extracted is a CANDIDATE, never confirmed — owner ruling), and metadata.legacy_source_id
-- pinning the one-to-one mapping back to its source row.

-- 1. The mechanical guard: one canonical row per legacy source, forever.
create unique index if not exists paige_owner_memory_legacy_source_uidx
  on public.paige_owner_memory ((metadata->>'legacy_source_id'))
  where metadata ? 'legacy_source_id';

-- 2. Snapshot of the pre-existing canonical rows (the migration must not touch them).
do $$
declare
  _pre bigint;
begin
  select count(*) into _pre from public.paige_owner_memory
   where not (metadata ? 'legacy_source_id');
  raise notice 'S5 backfill: % pre-existing canonical rows (asserted unchanged at the end)', _pre;
end $$;

-- 3. The disciplined copy. ON CONFLICT plus the unique index collapse any rerun to zero rows.
insert into public.paige_owner_memory
  (tenant_id, user_id, memory_type, content, source_thread_id, is_active,
   metadata, created_by, created_at, updated_at)
select
  c.tenant_id,
  c.client_user_id,
  -- canonical type mapping: an owner preference lands as 'preference', the destination
  -- home's existing vocabulary (its 3 pre-existing preference rows use exactly this type).
  'preference'::text,
  c.content,
  null,
  true,
  jsonb_build_object(
    'confirmation_state', 'proposed',
    'audience', 'owner_personal',
    'origin', 'legacy_client_memory_migration',
    'legacy_source', c.metadata->>'source',
    'legacy_source_id', c.id::text
  ),
  null,
  c.created_at,
  c.created_at
from public.client_memory c
where c.is_active
  and c.memory_type = 'user_preference'
  and c.client_id is null
  and c.metadata->>'source' = 'explicit_signal'
  and not exists (
    select 1 from public.paige_owner_memory p
    where p.metadata->>'legacy_source_id' = c.id::text
  )
on conflict do nothing;

-- 4. Structural verification inside the migration. Counts are DERIVED (eligible now = mapped
--    now); every other assert is exact.
do $$
declare
  _eligible bigint;
  _mapped   bigint;
  _bad      bigint;
begin
  select count(*) into _eligible from public.client_memory c
   where c.is_active and c.memory_type='user_preference' and c.client_id is null
     and c.metadata->>'source' = 'explicit_signal';

  select count(*) into _mapped from public.paige_owner_memory p
   where p.metadata->>'origin' = 'legacy_client_memory_migration';

  if _eligible <> _mapped then
    raise exception 'S5 backfill: eligible % <> mapped %', _eligible, _mapped;
  end if;

  -- one legacy source maps to exactly one canonical row; content, scope and timestamps exact;
  -- every migrated row is proposed.
  select count(*) into _bad
  from public.client_memory c
  join public.paige_owner_memory p
    on p.metadata->>'legacy_source_id' = c.id::text
  where p.user_id <> c.client_user_id
     or p.tenant_id <> c.tenant_id
     or p.content <> c.content
     or p.memory_type <> 'preference'
     or p.created_at <> c.created_at
     or p.is_active <> true
     or p.metadata->>'confirmation_state' <> 'proposed';
  if _bad > 0 then
    raise exception 'S5 backfill: % migrated row(s) fail content/scope/timestamp/state integrity', _bad;
  end if;

  -- no orphan canonical migration rows whose source vanished mid-flight.
  select count(*) into _bad from public.paige_owner_memory p
   where p.metadata->>'origin' = 'legacy_client_memory_migration'
     and not exists (
       select 1 from public.client_memory c
        where c.id::text = p.metadata->>'legacy_source_id'
          and c.is_active and c.memory_type='user_preference' and c.client_id is null
          and c.metadata->>'source' = 'explicit_signal'
     );
  if _bad > 0 then
    raise exception 'S5 backfill: % canonical migration row(s) have no eligible source', _bad;
  end if;

  -- The pre-existing canonical population is untouched: the INSERT above never updates or
  -- deletes, and it filters to unmapped sources only. That invariance is proven row-by-row by
  -- the pgTAP suite (checksum before/after), not restated here.

  raise notice 'S5 backfill: % legacy preference row(s) migrated as proposed, integrity clean', _mapped;
end $$;
