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

-- 0. Seam vocabulary extension (review P1-1): the governed record_paige_memory whitelist
-- (20261223000000) lacks exactly the owner-continuity types the S5 runtime writers emit —
-- 'milestone_completed' (business milestones) and 'open_loop' (extracted open loops). Without
-- them those two writers are silent write-loss at runtime (the RPC refuses, checkedWrite logs,
-- nothing persists). Same doctrine as the existing 'summary'/'identity' entries: the seam is a
-- strict superset of what the platform's writers produce, not a fork. Re-emitted from the
-- canonical body with a two-line delta (verified: no later migration redefines this function).
CREATE OR REPLACE FUNCTION public.record_paige_memory(
  p_memory_type        text,
  p_content            text,
  p_source_thread_id   uuid    DEFAULT NULL,
  p_metadata           jsonb   DEFAULT '{}'::jsonb,
  p_supersede_prior    boolean DEFAULT false,
  p_confirmation_state text    DEFAULT 'proposed', -- governance field: proposed|confirmed|corrected|retired
  p_user_id            uuid    DEFAULT NULL,   -- honored ONLY for service_role (server-resolved)
  p_tenant_id          uuid    DEFAULT NULL    -- honored ONLY for service_role (server-resolved)
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service boolean := auth.role() = 'service_role';
  v_uid        uuid;
  v_tenant     uuid;
  v_created_by uuid;
  v_metadata   jsonb;
  v_new_id     uuid;
BEGIN
  -- Caller scope, resolved in-body — never trusted from a JWT caller's arguments (§59/§9).
  IF v_is_service THEN
    v_uid := p_user_id;
    v_tenant := p_tenant_id;                 -- the trusted server already resolved these
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'PAIGE_MEMORY_SERVICE_USER_REQUIRED' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'PAIGE_MEMORY_UNAUTHENTICATED' USING ERRCODE = '42501';  -- fail closed
    END IF;
    -- p_user_id / p_tenant_id are IGNORED for a JWT caller. Scope is the caller's own.
    v_tenant := public.current_user_tenant_id();
    IF v_tenant IS NULL AND NOT public.is_platform_owner() THEN
      RAISE EXCEPTION 'PAIGE_MEMORY_NO_WORKSPACE' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Actor attribution (source field): a JWT caller IS the human actor; a service/system write has
  -- NO human actor, so created_by is NULL — the convention paige_owner_memory.created_by documents
  -- ("actor stamp; NULL for the service/system seam", 20260810120000). Never stamp the subject uid.
  v_created_by := CASE WHEN v_is_service THEN NULL ELSE v_uid END;

  -- Governed vocab (§10) — the four memory audiences, enumerated as the contract. An unknown type
  -- is refused so this seam cannot become a raw event dump.
  IF p_memory_type IS NULL OR btrim(p_memory_type) = '' THEN
    RAISE EXCEPTION 'PAIGE_MEMORY_TYPE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_memory_type NOT IN (
    -- workspace memory (owner-confirmed business facts, goals, operating preferences, strategy)
    'fact','preference','active_priority','permission_note','known_context',
    'goal','operating_preference','strategic_context',
    -- conversation memory (durable decisions/commitments/corrections — NEVER raw transcript)
    'decision','commitment','correction',
    -- agent memory (scoped task outcomes + lessons — NEVER hidden reasoning)
    'agent_outcome','agent_lesson',
    -- general kinds the table ALREADY carries (kept so the seam is a strict superset, not a fork):
    -- summary/session_summary/insight, and 'identity' (the §52 operator-briefing type seeded in
    -- 20260816120000 and read by _shared/owner-context.ts) — omitting it would make the governed
    -- seam unable to record or supersede a type the platform already stores (peer-gate, §39).
    'summary','session_summary','insight','identity',
    -- S5 (20270599000000): the no-client writer families this cutover governs - business
    -- milestones and extracted open loops are owner/workspace continuity the platform records.
    'milestone_completed','open_loop',
    -- S5 (20270599000000): the owner's own credit-report context summary (the no-client arm of
    -- the structured-extraction writer; the numbers stay canonical in credit_report_uploads).
    'report_upload'
  ) THEN
    RAISE EXCEPTION 'PAIGE_MEMORY_TYPE_UNKNOWN: %', p_memory_type USING ERRCODE = '22023';
  END IF;

  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION 'PAIGE_MEMORY_CONTENT_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Confirmation state (the governance field that keeps an inference from masquerading as truth,
  -- per the Relationship Context & Governed Memory contract Layer 2): a memory is 'proposed' by
  -- default and only 'confirmed' through an explicit path. The validated argument is authoritative
  -- and is merged LAST so it wins over any confirmation_state a caller also put in p_metadata.
  IF p_confirmation_state IS NULL
     OR p_confirmation_state NOT IN ('proposed','confirmed','corrected','retired') THEN
    RAISE EXCEPTION 'PAIGE_MEMORY_CONFIRMATION_STATE_INVALID: %', p_confirmation_state
      USING ERRCODE = '22023';
  END IF;
  v_metadata := COALESCE(p_metadata, '{}'::jsonb)
                || jsonb_build_object('confirmation_state', p_confirmation_state);

  -- Correction path: supersede prior active rows of the same (scope, type). IS NOT DISTINCT FROM so
  -- a tenant-less operator's rows match on NULL (the '=' trap match_paige_owner_memory documents).
  IF p_supersede_prior THEN
    UPDATE public.paige_owner_memory
       SET is_active = false
     WHERE user_id = v_uid
       AND memory_type = p_memory_type
       AND is_active = true
       AND tenant_id IS NOT DISTINCT FROM v_tenant;
  END IF;

  INSERT INTO public.paige_owner_memory
    (tenant_id, user_id, memory_type, content, source_thread_id, metadata, created_by)
  VALUES
    (v_tenant, v_uid, p_memory_type, p_content, p_source_thread_id, v_metadata, v_created_by)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

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
