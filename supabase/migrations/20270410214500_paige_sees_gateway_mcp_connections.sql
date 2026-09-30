-- =============================================================================
-- Paige's connection READ path moves onto the gateway registry.
--
-- THE DEFECT THIS CLOSES. Asked "what am I connected to?", Paige answers from
-- `integrations_list` → public.list_integration_surface(), which read ONLY
-- public.channel_connectors. It touched no MCP table at all, so every MCP
-- connection a tenant owns — Zapier, n8n, any remote MCP server — was invisible
-- to her. Not stale, not partial: absent. She could not name one, could not say
-- whether one was healthy, and could not tell an owner that the thing they just
-- connected in Settings → Integrations exists.
--
-- WHICH REGISTRY, AND WHY IT MATTERS. There are two. The LEGACY one
-- (public.tenant_mcp_connections) is what Paige's tool-invocation path still
-- resolves against today (call-zapier-action/index.ts:98, via
-- get_tenant_mcp_secret). The GATEWAY one (public.mcp_connections) is the newer
-- registry the mcp-gateway edge function owns. This migration points the READ
-- half at the GATEWAY registry. The invocation half is deliberately NOT moved
-- here — it is blocked on an owner flag (MCP_GATEWAY_EXECUTE_ENABLED, default
-- OFF), on a production drift measurement (scripts/sql/mcp-backfill-drift.sql),
-- and on two gateway doors that do not exist yet. Moving the read half without
-- the write half is the safe half, and it is additive.
--
-- §18 — ONE HOME, NOT A FORK. This does NOT re-implement the connection read.
-- public.get_mcp_connections_v2 already owns it and already gets the hard parts
-- right: the owner_only visibility gate, host-only URL projection (never the
-- secret-bearing full URL), and the `configured` predicate including the
-- url/none exemption. Forking that logic into a second query is how the two
-- drift apart and one of them quietly stops hiding owner_only rows. So this
-- CALLS it and maps its rows into the integration-surface shape.
--
-- §9 / §59 — THE SCOPE ARGUMENT, IN FULL. list_integration_surface is SECURITY
-- DEFINER and therefore bypasses RLS, so the body must re-establish scope
-- itself; the grant is never the guard. It does, twice over:
--   * The channel half is unchanged: WHERE cc.tenant_id = current_user_tenant_id().
--   * The MCP half calls get_mcp_connections_v2() with NO tenant argument, so
--     that function resolves the tenant through _mcp_resolve_tenant(NULL,false),
--     which for any real caller (auth.uid() IS NOT NULL) sets the tenant to
--     public.current_user_tenant_id() — byte-for-byte the SAME resolver the
--     channel half uses — and then refuses a non-member outright. The two halves
--     therefore cannot resolve different tenants. No tenant value is accepted
--     from the wire on either half.
--   * owner_only rows stay hidden from an ordinary member: SECURITY DEFINER
--     changes the executing privilege, NOT auth.uid(), so v2's
--     `_full := auth.uid() IS NULL OR is_tenant_admin(...) OR is_platform_owner()`
--     still evaluates against the REAL caller when invoked from in here.
--
-- §58 — WHY THE MCP HALF IS EXCEPTION-WRAPPED, AND WHY THAT IS NOT SWALLOWING.
-- _mcp_resolve_tenant RAISES where this function today returns an empty array:
-- MCP_FORBIDDEN for an authenticated non-member, MCP_NO_TENANT for a
-- service-role caller with no tenant argument (this function takes none). An
-- unguarded call would convert those into a thrown `integrations_list` tool
-- call, regressing the channel_connectors read that works today for everyone.
-- So the MCP half degrades to an empty array — and RAISES A WARNING when it
-- does (§32: a degrade path that logs nothing turns every fault into the same
-- invisible symptom). It never fabricates a connection and never reports an
-- MCP connection it could not read as healthy.
--
-- §13 — WHY THE GATEWAY ALONE WOULD MAKE PAIGE LIE, AND WHAT THIS DOES INSTEAD.
-- The gateway registry was populated by a ONE-TIME backfill (20270319000000
-- §6a, a DO block whose helper is dropped at :576 so it cannot re-run). No
-- trigger projects legacy→gateway afterwards, and the legacy writers are still
-- the sole live write path for Zapier/n8n connections — the repo says so itself
-- in the table comment at 20270319000000:596 ("remain the sole live path until
-- a later cutover"). So a connection made the legacy way AFTER the backfill
-- exists and works, and is simply absent from mcp_connections.
--
-- Reading the gateway alone would therefore hand Paige a list with a hole in
-- it, and a hole in a list is indistinguishable from an absence: asked "am I
-- connected to Zapier?", she would answer no about a connection that is live.
-- That is a worse failure than today's honest silence, because it is confident.
--
-- SO EACH CONNECTION IS READ FROM THE STORE THAT IS ACTUALLY LIVE FOR IT, and
-- the lineage the schema already records is what decides which that is.
--
--   * A gateway row with legacy_source IS NULL was created natively through
--     create_mcp_connection. The gateway IS its live store. Emit it.
--   * A gateway row with legacy_source IS NOT NULL is the one-time backfill's
--     PROJECTION of a legacy row. Its origin is still being written — connect,
--     token rotation, disconnect and probe all UPDATE tenant_mcp_connections and
--     none of them touch mcp_connections — so the projection is stale by
--     construction. Suppress it and emit the legacy row it came from.
--   * A legacy row the backfill never projected is emitted too. That is the
--     gap the first paragraph is about.
--
-- THERE ARE TWO LEGACY STORES, NOT ONE, AND MISSING THAT RE-CREATED THE ORIGINAL
-- BUG (§13). `legacy_source` takes two values: 'tenant_mcp_connections' (the
-- Zapier/n8n-OAuth table) and 'tenant_n8n_connections' (the n8n API-KEY facet,
-- a separate table the backfill projects at 20270319000000 §6b). A first version
-- of this file suppressed EVERY projection while reading back only the first
-- table — so a tenant's live n8n API connection was suppressed and never
-- re-emitted, and Paige would once again have answered that a working connection
-- does not exist. That is precisely the defect this migration exists to fix,
-- re-introduced one table over. Caught in review. Each legacy store now has its
-- own reader, and a projection is suppressed ONLY when the store that replaces
-- it is actually read.
--
-- WHY NOT "GATEWAY WINS", WHICH IS WHAT THIS FILE FIRST DID (§13). Preferring
-- the gateway whenever ANY gateway row shared the provider string looked like
-- §57 "derive from the source of truth", but it applied that rule one layer too
-- high: for a PROJECTED row the gateway is not the source of truth, it is a
-- snapshot of one. A tenant who disconnected Zapier yesterday would have had
-- enabled=false in the live table and enabled=true, status=connected,
-- health=healthy in the frozen projection — and Paige would have reported the
-- dead connection as healthy. That is the same lie as the invisible connection,
-- pointed the other way, and it is worse: silence invites a question, a
-- confident wrong answer does not. Caught in review, not by the author.
--
-- Matching on LINEAGE rather than on the provider string also stops a second
-- error: a tenant may legitimately hold both a legacy Zapier connection and a
-- natively-created gateway one. Those are two real connections and both are
-- listed; collapsing them because they share a provider name would hide one.
--
-- Neither registry's internal name reaches the row: which store answered is an
-- operations concern, measured by scripts/sql/mcp-backfill-drift.sql, not
-- something an owner asking "what am I connected to?" should have to parse.
--
-- §13 — THE HEALTH VOCABULARY GAINS 'unknown', DELIBERATELY. The channel half
-- emits healthy | degraded | disconnected. An MCP connection that no probe has
-- ever touched has health='unknown'; calling that "healthy" is a lie and
-- calling it "degraded" is a false alarm that would send an owner to fix a
-- connection that may be fine. So it reports 'unknown' and the reader labels
-- the freshness. OWED, and named rather than silently skipped: the descriptive
-- factValues in _shared/paige-spine/domains/integrations_surface.ts list
-- health/status/provider/channel value sets that do not yet include 'unknown',
-- 'mcp', or the MCP provider keys. That file is the Platform Reach lane's to
-- edit (spine registration), not this lane's, so it is handed over rather than
-- edited here. Those values are descriptive metadata validated only for
-- non-emptiness by validateSpineRegistry — nothing gates on them at runtime —
-- so this migration is correct and complete without that edit.
-- =============================================================================

create or replace function public.list_integration_surface()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _channels jsonb;
  _mcp      jsonb := '[]'::jsonb;
  _legacy   jsonb := '[]'::jsonb;
  _n8napi   jsonb := '[]'::jsonb;
begin
  -- ── Half 1: channel connectors. UNCHANGED from 20270116000000. ───────────
  select coalesce(jsonb_agg(t), '[]'::jsonb) into _channels from (
    select jsonb_build_object(
             'channel', cc.channel_type,
             'provider', cc.provider,
             'status', cc.status,
             'active', cc.active,
             'display_name', cc.display_name,
             'from_address', cc.from_address,
             'inbound_domain', cc.inbound_domain,
             'inbound_address', cc.inbound_address,
             'health', case
               when cc.active = false or cc.status = 'disabled' then 'disconnected'
               when cc.updated_at < now() - interval '7 days' then 'degraded'
               else 'healthy'
             end,
             'last_updated', cc.updated_at
           ) as t
    from public.channel_connectors cc
    where cc.tenant_id = public.current_user_tenant_id()
  ) s;

  -- ── Half 2: gateway connections the GATEWAY is actually live for. ───────
  begin
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'channel',         'mcp',
               'provider',        c->>'provider_key',
               -- Mapped into the surface's own status vocabulary, not the
               -- gateway's. A turned-off connection is 'disabled' whatever its
               -- last probe said; only a probe-confirmed one is 'active'.
               'status', case
                 when (c->>'enabled')::boolean is not true then 'disabled'
                 when c->>'status' = 'connected'           then 'active'
                 else 'pending'
               end,
               'active',          coalesce((c->>'enabled')::boolean, false),
               'display_name',    c->>'label',
               -- An MCP server is not an inbox: these three carry no meaning
               -- here and are emitted null rather than filled with something
               -- plausible-looking.
               'from_address',    null,
               'inbound_domain',  null,
               'inbound_address', null,
               'health', case
                 when (c->>'enabled')::boolean is not true       then 'disconnected'
                 when (c->>'configured')::boolean is not true    then 'unconfigured'
                 when c->>'status' = 'error'                     then 'degraded'
                 when c->>'health' = 'needs_attention'           then 'degraded'
                 when c->>'health' = 'healthy'                   then 'healthy'
                 else 'unknown'
               end,
               -- observed_at, never presented as "verified now" — carried
               -- through from the gateway row with its truth boundary intact.
               'last_updated',    c->>'last_checked_at',
               -- Host only. v2 already projects this without the path or any
               -- credential material; nothing secret-bearing is added here.
               'server_host',     c->>'server_url_host',
               'tool_count',      c->>'tool_count',
               'approved_count',  c->>'approved_count'
             )
           ), '[]'::jsonb)
      into _mcp
      from jsonb_array_elements(public.get_mcp_connections_v2()) as c
      -- The lineage join classifies a row v2 has ALREADY approved and filtered;
      -- it re-implements none of v2's visibility gate, credential redaction or
      -- `configured` predicate (§18). A projected row is dropped here so its
      -- live legacy origin can speak for it below.
      join public.mcp_connections m
        on m.connection_id = (c->>'connection_id')::uuid
     where m.legacy_source is null;
  exception when others then
    -- Loud, never silent (§32). The channel half still answers; the MCP half
    -- reports nothing rather than guessing.
    raise warning 'list_integration_surface: MCP half unavailable (%): %', sqlstate, sqlerrm;
    _mcp := '[]'::jsonb;
  end;

  -- ── Half 3: legacy connections — always the live store, so always read. ─
  -- Every legacy row is read, with no exclusion, because the legacy table is
  -- the live store for every row in it. Nothing is listed twice: Half 2 already
  -- dropped the projections, so the two halves are disjoint BY LINEAGE rather
  -- than by a provider-name guess. Scoped by the SAME _mcp_resolve_tenant(NULL,
  -- false) as Half 2, and the reader returns host-only + last-4 — no credential
  -- material. Separately guarded so a fault in either registry can never take
  -- the other one down.
  begin
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'channel',         'mcp',
               'provider',        v->>'provider',
               'status', case
                 when (v->>'enabled')::boolean is not true then 'disabled'
                 when v->>'status' = 'connected'           then 'active'
                 else 'pending'
               end,
               'active',          coalesce((v->>'enabled')::boolean, false),
               'display_name',    v->>'label',
               'from_address',    null,
               'inbound_domain',  null,
               'inbound_address', null,
               -- Legacy carries no `health` column, so health is derived from
               -- what a probe actually established. Never invented.
               -- CONFIGURED, WITH THE url/none EXEMPTION THE LEGACY READER LACKS (§13).
               -- get_tenant_mcp_connections computes `configured` from the TOKEN columns
               -- alone, but a URL-auth connection (set_tenant_zapier_mcp_url_connection)
               -- carries its credential inside server_url_ct and is FORBIDDEN from holding
               -- a token at all — tenant_mcp_connections_url_kind_chk (20261016000000:51)
               -- requires auth_token_ct IS NULL for auth_kind='url'. So its `configured`
               -- is false forever, and reading it literally reported a probe-confirmed,
               -- working connection as 'unconfigured'. get_mcp_connections_v2 already
               -- carries exactly this exemption (20270331000000:1065); the legacy reader
               -- does not, and mirroring the wrong one of the two is what caused this.
               -- Caught in review.
               'health', case
                 when (v->>'enabled')::boolean is not true then 'disconnected'
                 when not ((v->>'configured')::boolean
                           or (v->>'auth_kind' in ('url','none') and v->>'server_url_host' is not null))
                                                           then 'unconfigured'
                 when v->>'status' = 'error'               then 'degraded'
                 when v->>'status' = 'connected'           then 'healthy'
                 else 'unknown'
               end,
               'last_updated',    v->>'last_probed_at',
               'server_host',     v->>'server_url_host',
               'tool_count',      v->>'tool_count',
               'approved_count',  jsonb_array_length(coalesce(v->'approved_capabilities','[]'::jsonb))
             )
           ), '[]'::jsonb)
      into _legacy
      from jsonb_each(public.get_tenant_mcp_connections()) as kv(provider_key, v);
  exception when others then
    raise warning 'list_integration_surface: legacy MCP half unavailable (%): %', sqlstate, sqlerrm;
    _legacy := '[]'::jsonb;
  end;

  -- ── Half 4: the n8n API-key facet — its own live table, its own reader. ─
  -- One row per tenant. The reader hands back the FULL decrypted base_url and an
  -- api_key_last4; neither may cross into a model-facing row, so only the HOST is
  -- taken (same split as get_mcp_connections_v2) and the last-4 is dropped
  -- entirely. An absent connection short-circuits to a two-key object with no
  -- `workflow_count`, which is how a real row is told from no row at all.
  begin
    select case
             when public.get_tenant_n8n_connection() ? 'workflow_count' then
               jsonb_build_array(jsonb_build_object(
                 'channel',         'mcp',
                 'provider',        'n8n',
                 'status', case
                   when (v->>'status') = 'unconfigured' then 'disabled'
                   when (v->>'status') = 'connected'    then 'active'
                   else 'pending'
                 end,
                 'active',          (v->>'status') IS DISTINCT FROM 'unconfigured',
                 -- Matches the label the backfill itself defaults to, so the API facet
                 -- is distinguishable from an n8n OAuth connection in the same list.
                 'display_name',    coalesce(nullif(btrim(coalesce(v->>'label','')), ''), 'n8n (API)'),
                 'from_address',    null,
                 'inbound_domain',  null,
                 'inbound_address', null,
                 'health', case
                   when (v->>'configured')::boolean is not true then 'unconfigured'
                   when (v->>'status') = 'error'                then 'degraded'
                   when (v->>'status') = 'connected'            then 'healthy'
                   else 'unknown'
                 end,
                 'last_updated',    v->>'last_sync_at',
                 'server_host',     case when v->>'base_url' is not null
                   then split_part(split_part(v->>'base_url', '://', 2), '/', 1) else null end,
                 'tool_count',      v->>'workflow_count',
                 'approved_count',  null
               ))
             else '[]'::jsonb
           end
      into _n8napi
      from (select public.get_tenant_n8n_connection() as v) q;
  exception when others then
    raise warning 'list_integration_surface: n8n API half unavailable (%): %', sqlstate, sqlerrm;
    _n8napi := '[]'::jsonb;
  end;

  return _channels || _mcp || _legacy || _n8napi;
end;
$$;

revoke all on function public.list_integration_surface() from public, anon;
grant execute on function public.list_integration_surface() to authenticated, service_role;
