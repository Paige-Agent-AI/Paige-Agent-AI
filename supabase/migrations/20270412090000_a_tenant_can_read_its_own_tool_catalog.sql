-- =============================================================================
-- Door 1: a tenant can read the ACTIONS its own connected tool offers.
--
-- THE GAP. The gateway's `approve` action takes a `tool_name`, but nothing could
-- tell an owner which tool names exist. `mcp_connection_tools` and
-- `mcp_connection_approvals` both carry an `is_platform_owner()`-only RLS policy
-- FOR ALL, no function returned a per-tool list to a tenant (verified against
-- prod `pg_proc.prosrc`: eight functions touch either table — v2 counts them,
-- three clear them, the prober writes them, none lists them), and `verify`
-- returns `tool_count` as a NUMBER. So the per-action approve surface could not
-- be built honestly: it would have rendered an empty list, which reads as "this
-- tool offers nothing". The surface says so plainly today; this replaces the
-- apology with the list.
--
-- WHY THIS DOES **NOT** COPY get_mcp_connections_v2, which was the obvious move
-- and is WRONG. v2's tenant isolation does not live in `_mcp_resolve_tenant`; it
-- lives in its `WHERE c.tenant_id = _tenant` LIST filter (20270331000000:1082).
-- `_mcp_resolve_tenant` scopes the CALLER — it answers "which tenant is this
-- caller in", takes no connection_id, and asserts nothing about one. A body that
-- resolves the tenant and then selects `FROM mcp_connection_tools WHERE
-- connection_id = _connection_id` computes `_tenant` and DISCARDS it. Because
-- SECURITY DEFINER runs as the owner, the owner-only policies at
-- 20270319000000:162 and :175 are bypassed, and any authenticated member of any
-- tenant reads any connection's full catalogue and approval state.
-- The correct precedent is the WRITERS, which bind the row:
-- set_mcp_connection_approval (20270323000000:129-132), disconnect_mcp_connection,
-- set_mcp_connection_endpoint.
--
-- THE BIND, AND THE NULL TRAP IT AVOIDS. The tenant predicate is INSIDE the
-- lookup, and the child read keys off the PROVEN row, never the parameter. The
-- writers use `WHERE connection_id = _id` then `IF _conn.tenant_id <> _tenant`;
-- copying only that second half is a live trap, because on no match
-- `_conn.tenant_id` is NULL, `NULL <> _tenant` is NULL rather than TRUE, and the
-- guard falls through. Selecting on both columns makes a foreign row simply not
-- selected, leaving one refusal test that cannot be fooled by a NULL.
--
-- owner_only IS RE-CHECKED IN-BODY. Binding the tenant alone is not enough: an
-- ordinary member could then enumerate the tool names, apps, action types and
-- effects of an `owner_only` connection — a strictly NEW disclosure, since v2
-- hands that member no row for it at all. The same `_full` predicate is applied
-- here, after the row is bound.
--
-- ONE REFUSAL FOR THREE CASES — no existence oracle. Unknown id, foreign tenant,
-- and owner_only-without-admin all raise the SAME MCP_FORBIDDEN with the same
-- SQLSTATE and the same text. This seam already pays for that uniformity and
-- says why twice (20270331000000:274 and :1025). It matters MORE here than for a
-- writer, because of the next paragraph.
--
-- WHY AN EMPTY ARRAY MAY NOT ALSO MEAN "NOT YOURS". `[]` is a legitimate,
-- COMMON answer: a real in-tenant connection whose catalogue has never been
-- probed has no tool rows. Measured on prod while writing this: 4 connections,
-- 0 tool rows, 0 approval rows — so `[]` is the answer for every connection that
-- exists today, until a `verify` succeeds. Overloading `[]` with "you may not
-- see this" would put two opposite meanings in one signal, which is the exact
-- defect class this slice's review rounds kept finding. So: refusal means
-- cannot-see, `[]` means connected-but-not-yet-read, and the surface can tell
-- the owner which is true.
--
-- WHAT DOES NOT CROSS, AND WHY (§9). The precedent is written on the sibling
-- read at 20261008000000:194-198 — "the COUNT, not the digests … the hashes
-- themselves are verification material, not product state."
--   · `pin`, `schema_hash`, `authority_hash` — internal integrity machinery with
--     no owner-facing meaning. `authority_hash` is merely the digest of {app,
--     action_type, effects}, all three of which ARE returned in the clear.
--     `approve` reads the pin server-side (mcp-gateway/index.ts:91-100, whose own
--     comment says it is "neither client-visible"); no client has ever sent one.
--   · `endpoint_hash` — THE HARDEST DROP, and the one most likely to have been
--     shipped by accident. It is `sha256('mcp-endpoint/v1|' || server_url)` over
--     the FULL DECRYPTED URL (20270323000000:71-78), unsalted, deterministic,
--     with its construction published in this repo. For `auth_kind IN
--     ('url','none')` the credential lives INSIDE that URL. Its own generator
--     `_mcp_endpoint_hash` is REVOKEd from `authenticated` and granted to
--     `service_role` only (20270323000000:297-298) — returning its output to a
--     tenant would hand back the result of a function the platform deliberately
--     denies them.
--   · `args_shape_hash` — same class; a digest of argument key names, server
--     verification material.
--   · `approved_by` — a bare uuid is not useful, and it can be a PLATFORM
--     OPERATOR's uuid, which must not leak into a tenant surface (§9/§53). The
--     boolean `approved_by_you` carries the only part an owner needs.
-- Approval DRIFT is returned as a server-computed boolean rather than by handing
-- the client both pins to subtract. Drift is a verdict, not client arithmetic.
--
-- tool_name IS FILTERED, NOT TRUSTED. `mcp_connection_tools` has a PK and NO
-- CHECK on any column (verified on prod); the writer only bounds length. A name
-- that is not a clean identifier is the injection surface, not a tool, so rows
-- failing the grammar are DROPPED — the same rule, and the same grammar, as
-- `toSafeCapabilities` (_shared/mcp-gateway/capability-summary.ts) and as
-- `approve`'s own `bad_tool_name` guard. A tool this refuses could never have
-- been approved anyway.
--
-- GRANTED TO `authenticated` ONLY — deliberately NOT service_role, which is
-- where v2's shape would have been actively dangerous to copy. v2 sets
-- `_full := auth.uid() IS NULL OR …`, treating a NULL actor as maximally
-- trusted, AND is granted to service_role. The gateway edge builds a
-- service-role client in several branches; with both of those copied, any such
-- branch could read the owner_only catalogue of ANY tenant named in a request
-- body, with zero caller authority — the §59 "the grant is never the guard"
-- shape and the caller-supplied-tenant shape at once. There is therefore no
-- `auth.uid() IS NULL` clause in `_full` below: with an authenticated-only
-- grant, a NULL actor is not a legitimate caller here. A headless reader, if one
-- is ever needed, is a separate function with an explicit reason.
--
-- SECURITY DEFINER IS REQUIRED, not incidental. Both child tables are
-- owner-only, and `_mcp_resolve_tenant` is itself REVOKEd from `authenticated`.
-- Converted to INVOKER by a later §59 sweep this would both fail to execute and
-- return zero rows. The COMMENT says so, so the sweep does not "correct" it.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_mcp_connection_tools(
  _connection_id uuid,
  _tenant_id     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tenant uuid;
  _conn   public.mcp_connections%ROWTYPE;
  _full   boolean;
  _live_endpoint_hash text;
  _out    jsonb;
BEGIN
  -- Scopes the CALLER (raises MCP_FORBIDDEN for a non-member, and ignores a
  -- caller-supplied tenant unless the caller is a platform owner). It does NOT
  -- scope the row — that is the next statement's job.
  _tenant := public._mcp_resolve_tenant(_tenant_id, false);

  -- Admin standing is NOT required to READ: v2 already discloses tool_count and
  -- approved_count to an ordinary member, and this is the per-row expansion of
  -- those two integers. The WRITE (set_mcp_connection_approval) stays admin-only.
  _full := public.is_tenant_admin(_tenant) OR public.is_platform_owner();

  -- THE BIND. Both predicates inside the lookup, so a foreign row is never
  -- selected and the NULL-comparison trap cannot arise.
  SELECT c.* INTO _conn
    FROM public.mcp_connections c
   WHERE c.connection_id = _connection_id
     AND c.tenant_id     = _tenant;

  -- One refusal, three causes: unknown, foreign, or owner_only without standing.
  IF _conn.connection_id IS NULL
     OR (_conn.visibility = 'owner_only' AND NOT _full) THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN: connection not in tenant' USING ERRCODE = '42501';
  END IF;

  -- The connection's CURRENT endpoint identity, computed ONCE for the whole
  -- catalogue rather than per row. This is the input to the endpoint-binding
  -- checks below; it never crosses the wire (see the header — it is an unsalted
  -- sha256 over the full decrypted url, and its generator is revoked from
  -- `authenticated` precisely so a tenant cannot mint one). NULL when the row
  -- carries no endpoint, which is itself one of the blocking reasons.
  _live_endpoint_hash := CASE
    WHEN _conn.server_url_ct IS NULL THEN NULL
    ELSE public._mcp_endpoint_hash(public.platform_decrypt(_conn.server_url_ct))
  END;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.tool_name), '[]'::jsonb)
    INTO _out
    FROM (
      SELECT
        t.tool_name,
        t.app,
        t.action_type,
        t.effects,
        -- observed, never "verified now" — the reader labels freshness (§13).
        t.discovered_at AS observed_at,
        (a.tool_name IS NOT NULL)                             AS approved,
        a.approved_at,
        a.expires_at,
        -- Expiry is judged on the SERVER clock, here, rather than handing the
        -- browser a timestamp to compare against its own (the clock mismatch
        -- this slice's approval-lifetime floor exists to absorb).
        (a.tool_name IS NOT NULL
           AND a.expires_at IS NOT NULL
           AND a.expires_at <= now())                         AS approval_expired,
        -- Consent is pinned to the tool's verified fingerprint. If the tool has
        -- changed since approval the consent no longer covers it. The VERDICT
        -- crosses; neither pin does.
        (a.tool_name IS NOT NULL
           AND a.pin IS DISTINCT FROM t.pin)                  AS approval_stale,
        (a.approved_by IS NOT NULL AND a.approved_by = auth.uid()) AS approved_by_you,
        -- ── WHY THIS FIELD EXISTS, AND WHY THE TWO ABOVE ARE NOT ENOUGH ──────
        -- `approved` here means only "an approval row exists". The function that
        -- actually decides whether Paige may run something,
        -- verify_mcp_connection_approval, refuses on SEVEN conditions, and until
        -- this field was added this read modelled TWO of them. So a row could
        -- come back approved, unexpired and unstale — and the runner would still
        -- decline it, because the approval was never bound to an endpoint, or the
        -- endpoint moved underneath it, or the connection has no endpoint at all.
        -- A surface built on that renders "You approved this" over consent that
        -- authorises nothing, which is the exact false-green the whole list was
        -- built to end.
        --
        -- THE ORDER BELOW MIRRORS THE VERIFIER'S OWN ORDER, so the reason this
        -- read gives is the reason the runner would give.
        --
        -- TWO of the verifier's conditions are deliberately NOT modelled, because
        -- they are not knowable from a catalogue:
        --   · endpoint_load_mismatch — compares the approval against the endpoint
        --     a RUNNER LOADED for a specific dispatch. There is no dispatch here,
        --     and inventing a loaded hash to pass in would fabricate the very
        --     input that guard exists to check.
        --   · action_shape_changed — depends on the arguments of a future call.
        -- So a NULL here means "nothing we can see from a catalogue blocks this",
        -- never "this is guaranteed to run". The runner re-checks at dispatch
        -- against the endpoint it actually loads, and the surface says so.
        CASE
          WHEN a.tool_name IS NULL                       THEN NULL
          WHEN _conn.server_url_ct IS NULL               THEN 'endpoint_missing'
          WHEN a.pin IS DISTINCT FROM t.pin              THEN 'contract_changed'
          WHEN a.endpoint_hash IS NULL                   THEN 'approval_not_endpoint_bound'
          WHEN a.endpoint_hash IS DISTINCT FROM _live_endpoint_hash
                                                         THEN 'endpoint_changed'
          WHEN a.expires_at IS NOT NULL
               AND a.expires_at <= now()                 THEN 'approval_expired'
          ELSE NULL
        END                                                   AS approval_blocked_reason
        FROM public.mcp_connection_tools t
        LEFT JOIN public.mcp_connection_approvals a
               ON a.connection_id = t.connection_id
              AND a.tool_name     = t.tool_name
       -- The PROVEN row, never the parameter.
       WHERE t.connection_id = _conn.connection_id
         -- Not trusted: no CHECK exists on this column. A non-identifier name is
         -- the injection surface, not a tool, and could never have been approved.
         AND t.tool_name ~ '^[A-Za-z0-9_.:-]{1,64}$'
    ) x;

  RETURN _out;
END;
$$;

REVOKE ALL  ON FUNCTION public.get_mcp_connection_tools(uuid, uuid) FROM PUBLIC, anon;
-- authenticated ONLY. See the header: granting service_role here would recreate
-- the caller-supplied-tenant shape the writers deliberately refuse.
GRANT EXECUTE ON FUNCTION public.get_mcp_connection_tools(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_mcp_connection_tools(uuid, uuid) IS
  'Door 1: the per-tool catalogue of ONE gateway connection, scoped to the caller''s own tenant, so the per-action approve surface can name real actions instead of rendering an empty list. SECURITY DEFINER IS REQUIRED AND MUST NOT BE "CORRECTED" TO INVOKER: mcp_connection_tools and mcp_connection_approvals are both is_platform_owner()-only FOR ALL, and _mcp_resolve_tenant is itself REVOKEd from authenticated, so an invoker-rights version would fail to execute AND return zero rows. Scope is enforced IN-BODY (§59, the grant is never the guard) and binds the ROW, not merely the caller: _mcp_resolve_tenant answers "which tenant is this caller in" and asserts nothing about a connection_id, so the tenant predicate sits inside the connection lookup and the child read keys off the proven row. Both predicates are in the WHERE so a foreign row is never selected and the writers'' `_conn.tenant_id <> _tenant` NULL trap cannot arise. owner_only is re-checked in-body, because binding the tenant alone would let an ordinary member enumerate a connection v2 hides from them entirely. Unknown id, foreign tenant and owner_only-without-standing raise ONE identical MCP_FORBIDDEN (42501) — no existence oracle — and an empty array therefore means only "connected, catalogue not yet probed", which is the live state of every connection until a verify succeeds. Membership suffices to READ (v2 already discloses tool_count/approved_count to a member); the WRITE stays admin-only via set_mcp_connection_approval. NO credential or verification material crosses: pin, schema_hash, authority_hash, endpoint_hash and args_shape_hash are all withheld — endpoint_hash especially, being an unsalted sha256 over the FULL DECRYPTED url whose own generator _mcp_endpoint_hash is revoked from authenticated — and approved_by is reduced to a boolean so a platform operator''s uuid cannot leak into a tenant surface. Staleness and expiry cross as server-computed verdicts rather than as pins for the client to subtract, and `approval_blocked_reason` carries the FIVE catalogue-knowable reasons verify_mcp_connection_approval would refuse on — endpoint_missing, contract_changed, approval_not_endpoint_bound, endpoint_changed, approval_expired — in that function''s own order, because "an approval row exists" is a strictly weaker predicate than "the runner will authorize this" and a surface built on the weaker one tells an owner they are covered when they are not. Its two remaining conditions are not modelled and must not be: endpoint_load_mismatch is about a dispatch this read does not make, and action_shape_changed depends on a future call''s arguments; a NULL therefore means "nothing a catalogue can see blocks this", never a guarantee. Tool names failing the identifier grammar are dropped, not sanitized, matching toSafeCapabilities and approve''s bad_tool_name guard.';
