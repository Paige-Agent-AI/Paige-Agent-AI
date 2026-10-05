-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- match_paige_memory — memory about a person is recalled only in the workspace it was written in
-- (INT-326, §9/§51/§59).
--
-- WHY. Every `client_memory` row carries a NOT NULL, immutable `tenant_id`
-- (20270428000000_client_memory_tenant_scope.sql): a row naming a client takes that client's
-- tenant, a row about the caller takes the caller's active tenant. The WRITE side is scoped. The
-- READ side was not: the user branch of this function keyed on `cm.client_user_id` alone, so a
-- person who works in two workspaces had a preference written in workspace A recalled into a
-- conversation in workspace B. Production had exactly one such row when this was grounded
-- (2026-10-05; 11 rows total, 2 users with more than one workspace, 1 of them with memory).
--
-- THE CHANGE.
--   • A seventh parameter, `_target_tenant_id uuid DEFAULT NULL`, names the workspace the recall is
--     for. The six existing parameter names are kept, so the caller's named-argument call resolves.
--     The old 6-argument function is DROPPED rather than overloaded: two overloads would leave the
--     unscoped one callable, and a 6-argument named call would become ambiguous.
--   • USER branch: `cm.client_user_id = _target_user_id AND cm.client_id IS NULL AND cm.tenant_id =
--     _scope`. `client_id IS NULL` keeps rows written ABOUT a client by a staff actor (paige-mcp and
--     the field-ingestion tab write `client_user_id = <actor>`) out of that actor's own recall.
--   • Service role (Paige's server): the user branch needs a non-null `_target_tenant_id`; the
--     server passes the caller's active tenant, the same value its writers stamp. With no tenant the
--     user branch is off — the column is NOT NULL, so "tenant IS NULL" is an empty set anyway.
--   • JWT caller: `_scope` is `current_user_tenant_id()`. Passing a different tenant is refused
--     ('Unauthorized') unless the caller is a platform operator (§53), who may scope to it. A
--     caller allowed to read the person but with no workspace (an operator at rest, a portal client
--     with no membership) gets the EMPTY set, not an error; a forged target still raises.
--   • Behaviour change for direct JWT callers (no runtime producer exists; the sole runtime caller is
--     the service role): an operator now reaches a person's own rows only by naming the workspace.
--   • CLIENT branch: unchanged. `can_access_contact` / the server's own authorization resolve THAT
--     client's tenant, and the trigger pins every client-keyed row to the client's tenant.
--   • The `chat_message_embeddings` UNION branch is REMOVED. That table has 0 rows ever, no writer
--     anywhere in the repo, no tenant column, and its parent `chat_messages` has no tenant either —
--     there is no provable workspace to filter on. Its client disjunct compared an auth-uid column
--     to a clients.id and could never match. `_message_count` stays in the signature (ignored) so
--     callers do not break. The return shape (`source` column included) is unchanged.
--   • Everything else is kept as it was: the §59 in-body guard ordering, the forged-id closure, the
--     global-role trap closure, the threshold clamp [0,1] and the count clamp [0,50], 'Unauthorized'
--     carrying no data.
--
-- search_path stays `public, extensions` (20261029000000 — omitting `extensions` breaks `<=>`).
-- Grants: never anon/PUBLIC; authenticated + service_role, re-declared for the new signature.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.match_paige_memory(extensions.vector, uuid, uuid, double precision, integer, integer);

CREATE OR REPLACE FUNCTION public.match_paige_memory(
  _query_embedding extensions.vector,
  _target_user_id uuid,
  _target_client_id uuid DEFAULT NULL::uuid,
  _match_threshold double precision DEFAULT 0.7,
  _memory_count integer DEFAULT 5,
  _message_count integer DEFAULT 5,
  _target_tenant_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(source text, id uuid, memory_type text, content text, similarity double precision, created_at timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _is_service boolean := COALESCE(auth.role() = 'service_role', false);
  _scope uuid := NULL;
  -- `_user_ok`: the caller may read THIS PERSON's memory at all (identity authority).
  -- `_may_user`: …and there is a workspace to read it in. The split keeps two answers apart:
  -- a forged target is refused ('Unauthorized'); an allowed person with no workspace gets nothing.
  _user_ok boolean := false;
  _may_user boolean := false;
  _may_client boolean := false;
  -- Bound every search parameter that could widen disclosure (§13).
  _threshold double precision := LEAST(GREATEST(COALESCE(_match_threshold, 0.7), 0.0), 1.0);
  _mem_count integer := LEAST(GREATEST(COALESCE(_memory_count, 5), 0), 50);
BEGIN
  -- A caller with neither a resolved identity nor the trusted service role has no basis for access.
  IF _caller IS NULL AND NOT _is_service THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _is_service THEN
    -- Paige's server resolved caller->target scope UPSTREAM (paige-ai-chat proves JWT tenant
    -- equality / operator access for a client, and reads the caller's active tenant through the
    -- caller's own session for the workspace). Trusted to pass server-derived ids.
    _scope := _target_tenant_id;
    _user_ok := (_target_user_id IS NOT NULL);
    _may_client := (_target_client_id IS NOT NULL);
  ELSE
    -- Authenticated caller: the workspace is the caller's own active one, never a passed value,
    -- unless the caller is a platform operator (§53, the sanctioned cross-tenant reader).
    _scope := public.current_user_tenant_id();
    IF _target_tenant_id IS NOT NULL AND _target_tenant_id IS DISTINCT FROM _scope THEN
      IF public.is_platform_operator() THEN
        _scope := _target_tenant_id;
      ELSE
        RAISE EXCEPTION 'Unauthorized';
      END IF;
    END IF;
    -- USER-keyed rows: SELF and platform operator only (§39 Finding 1 — a per-user staff grant
    -- cannot be made tenant-safe).
    _user_ok := _target_user_id IS NOT NULL AND (
         _caller = _target_user_id
      OR public.is_platform_operator()
    );
    -- CLIENT-keyed rows: the canonical resource-scoped helper resolves THAT contact's own tenant.
    -- can_access_contact(caller, <an auth uid>) is FALSE, so a forged id never self-authorizes.
    _may_client := _target_client_id IS NOT NULL
                   AND public.can_access_contact(_caller, _target_client_id);
  END IF;

  -- Refuse before returning any content or metadata; the message carries no data (§13).
  IF NOT _user_ok AND NOT _may_client THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- A person's own memory is read only inside one workspace. No workspace, no user-branch rows:
  -- `tenant_id` is NOT NULL, so "tenant IS NULL" is an empty set and nothing is lost.
  _may_user := _user_ok AND _scope IS NOT NULL;

  RETURN QUERY
    SELECT
      'memory'::text AS source,
      cm.id,
      cm.memory_type,
      cm.content,
      1 - (cm.embedding <=> _query_embedding) AS similarity,
      cm.created_at
    FROM public.client_memory cm
    WHERE cm.is_active = true
      AND cm.embedding IS NOT NULL
      AND (
        (_may_user AND cm.client_user_id = _target_user_id AND cm.client_id IS NULL AND cm.tenant_id = _scope)
        OR (_may_client AND cm.client_id = _target_client_id)
      )
      AND 1 - (cm.embedding <=> _query_embedding) >= _threshold
    ORDER BY cm.embedding <=> _query_embedding
    LIMIT _mem_count;
END;
$function$;

-- Deterministic, §59-lint-clean grant end-state: never anon/PUBLIC; the two real callers only.
REVOKE ALL ON FUNCTION public.match_paige_memory(extensions.vector, uuid, uuid, double precision, integer, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_paige_memory(extensions.vector, uuid, uuid, double precision, integer, integer, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.match_paige_memory(extensions.vector, uuid, uuid, double precision, integer, integer, uuid) TO authenticated, service_role;
