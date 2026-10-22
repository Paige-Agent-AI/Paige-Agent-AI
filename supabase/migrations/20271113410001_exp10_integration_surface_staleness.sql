-- EXP10 PR4 — ALG-12 foundation: probe-staleness derivation + closed error-code carry-through
-- on list_integration_surface.
--
-- WHAT THIS FIXES. The surface's channel half has derived health from recency since
-- 20270116000000 (updated_at older than 7 days = degraded), but the three MCP halves
-- reported a row that SAYS healthy as healthy forever: a connection last probed 30 days
-- ago rendered indistinguishable from one verified a minute ago, and the row's closed
-- error code (the gateway's bounded vocabulary: lookup_failed, provider_reflected_credential,
-- endpoint_load_mismatch, …) never reached the projection — so "why isn't my CRM syncing?"
-- had status words but no REASON to answer from.
--
-- THE CHANGE (additive projection fields + one health derivation, per half):
--   • gateway half — sources `stale` + `last_error_code` from the PHYSICAL row the
--     lineage join already reads (m.status/last_checked_at/last_error_code). The v2
--     reader's projection is deliberately untouched (its UI consumers whitelist fields);
--     the join means no second RPC widens.
--   • legacy half — `stale` from the safe getter's last_probed_at (the getter excludes
--     last_error by design — unbounded provider text — so NO error field is invented here).
--   • n8n API half — `stale` from last_sync_at (its reader exposes no bounded error code).
--   • health: a row whose status says connected/healthy but whose probe is older than
--     7 days (or absent) derives 'degraded' — the SAME rule the channel half has always
--     applied — and carries stale=true so the reason stays distinguishable from a hard error.
--
-- `stale` is defined ONLY for rows claiming connected (a pending row was never verified, so
-- "stale" would restate 'unknown', and a disabled row is disconnected regardless).
-- Consumers: the chat integrations_list tool passes rows through verbatim, so Paige can now
-- answer the failure question from the row's real evidence. The settings-integrations client
-- whitelists fields and drops the additions — no browser change, no UI claim change.
--
-- Proofs: supabase/tests/integrations_surface_sees_mcp.sql (extended in this PR; wired in
-- paige-spine-contract.yml paths + run step).

CREATE OR REPLACE FUNCTION public.list_integration_surface()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _channels jsonb;
  _mcp      jsonb := '[]'::jsonb;
  _legacy   jsonb := '[]'::jsonb;
  _n8napi   jsonb := '[]'::jsonb;
begin
  -- ── Half 1: channel connectors. UNCHANGED. ──────────────────────────────
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
               'status', case
                 when (c->>'enabled')::boolean is not true then 'disabled'
                 when c->>'status' = 'connected'           then 'active'
                 else 'pending'
               end,
               'active',          coalesce((c->>'enabled')::boolean, false),
               'display_name',    c->>'label',
               'from_address',    null,
               'inbound_domain',  null,
               'inbound_address', null,
               'health', case
                 when (c->>'enabled')::boolean is not true       then 'disconnected'
                 when (c->>'configured')::boolean is not true    then 'unconfigured'
                 when c->>'status' = 'error'                     then 'degraded'
                 when c->>'health' = 'needs_attention'           then 'degraded'
                 when c->>'health' = 'healthy'
                    and (m.last_checked_at is null
                         or m.last_checked_at < now() - interval '7 days') then 'degraded'
                 when c->>'health' = 'healthy'                   then 'healthy'
                 else 'unknown'
               end,
               'last_updated',    c->>'last_checked_at',
               'server_host',     c->>'server_url_host',
               'tool_count',      c->>'tool_count',
               'approved_count',  c->>'approved_count',
               -- EXP10 PR4: the row's OWN evidence about recency and its last bounded
               -- refusal code, sourced from the physical row the lineage join already
               -- read (never a second decrypted or widened read).
               'stale',           m.status = 'connected'
                                    and (m.last_checked_at is null
                                         or m.last_checked_at < now() - interval '7 days'),
               'last_error_code', m.last_error_code
             )
           ), '[]'::jsonb)
      into _mcp
      from jsonb_array_elements(public.get_mcp_connections_v2()) as c
      join public.mcp_connections m
        on m.connection_id = (c->>'connection_id')::uuid
     where m.legacy_source is null;
  exception when others then
    raise warning 'list_integration_surface: MCP half unavailable (%): %', sqlstate, sqlerrm;
    _mcp := '[]'::jsonb;
  end;

  -- ── Half 3: legacy connections — always the live store, so always read. ─
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
               'health', case
                 when (v->>'enabled')::boolean is not true then 'disconnected'
                 when not ((v->>'configured')::boolean
                           or (v->>'auth_kind' in ('url','none') and v->>'server_url_host' is not null))
                                                           then 'unconfigured'
                 when v->>'status' = 'error'               then 'degraded'
                 when v->>'status' = 'connected'
                      and (v->>'last_probed_at' is null
                           or (v->>'last_probed_at')::timestamptz < now() - interval '7 days')
                                                           then 'degraded'
                 when v->>'status' = 'connected'           then 'healthy'
                 else 'unknown'
               end,
               'last_updated',    v->>'last_probed_at',
               'server_host',     v->>'server_url_host',
               'tool_count',      v->>'tool_count',
               'approved_count',  jsonb_array_length(coalesce(v->'approved_capabilities','[]'::jsonb)),
               -- EXP10 PR4: recency evidence from the safe getter's own field. No error
               -- field: the getter excludes last_error BY DESIGN (unbounded provider
               -- text) and none is invented here.
               'stale',           v->>'status' = 'connected'
                                    and (v->>'last_probed_at' is null
                                         or (v->>'last_probed_at')::timestamptz < now() - interval '7 days')
             )
           ), '[]'::jsonb)
      into _legacy
      from jsonb_each(public.get_tenant_mcp_connections()) as kv(provider_key, v);
  exception when others then
    raise warning 'list_integration_surface: legacy MCP half unavailable (%): %', sqlstate, sqlerrm;
    _legacy := '[]'::jsonb;
  end;

  -- ── Half 4: the n8n API-key facet — its own live table, its own reader. ─
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
                 'display_name',    coalesce(nullif(btrim(coalesce(v->>'label','')), ''), 'n8n (API)'),
                 'from_address',    null,
                 'inbound_domain',  null,
                 'inbound_address', null,
                 'health', case
                   when (v->>'configured')::boolean is not true then 'unconfigured'
                   when (v->>'status') = 'error'                then 'degraded'
                   when (v->>'status') = 'connected'
                        and (v->>'last_sync_at' is null
                             or (v->>'last_sync_at')::timestamptz < now() - interval '7 days')
                                                                   then 'degraded'
                   when (v->>'status') = 'connected'            then 'healthy'
                   else 'unknown'
                 end,
                 'last_updated',    v->>'last_sync_at',
                 'server_host',     case when v->>'base_url' is not null
                   then split_part(split_part(v->>'base_url', '://', 2), '/', 1) else null end,
                 'tool_count',      v->>'workflow_count',
                 'approved_count',  null,
                 'stale',           (v->>'status') = 'connected'
                                      and (v->>'last_sync_at' is null
                                           or (v->>'last_sync_at')::timestamptz < now() - interval '7 days')
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
$function$;

COMMENT ON FUNCTION public.list_integration_surface() IS
 'EXP10 PR4 (20271113330000): projection now carries per-MCP-row stale (probe older than 7 days on a row claiming connected, the same recency rule the channel half has always applied — such a row derives health degraded WITH stale=true so the reason stays distinguishable) and, on the gateway half only, last_error_code from the physical row (the gateway''s CLOSED refusal vocabulary — never provider prose). The legacy and n8n-API halves add stale only: their readers exclude unbounded error text by design and no error field is invented for them. Additive: the chat integrations_list tool passes rows through so failure questions answer from real evidence; the settings-integrations client whitelists fields and drops the additions.';

-- ── Review P2 hardening: the "closed vocabulary" claim becomes schema-enforced ──
-- The table's own comment always said last_error_code is "closed code; provider error text is
-- NEVER stored raw here" — but nothing enforced it: the probe writer passes the code through,
-- and the TS writer unions were the only guard. This PR projects the column to a model-facing
-- surface, so the boundary is now enforced WHERE the claim lives: a bounded-token shape check
-- (lowercase identifier, 1-64 chars) — prose, whitespace, and provider text are refused at the
-- write, without freezing the exact code list (a new closed code needs no migration).
-- Verified against production before authoring: 0 existing rows violate the shape.
ALTER TABLE public.mcp_connections
  DROP CONSTRAINT IF EXISTS mcp_connections_last_error_code_shape_chk;
ALTER TABLE public.mcp_connections
  ADD CONSTRAINT mcp_connections_last_error_code_shape_chk
  CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$');
