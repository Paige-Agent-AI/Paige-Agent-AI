-- M4 of the MCP lane — the Go High Level provider descriptor.
--
-- GHL is the third of the owner's three providers (n8n, Zapier, GHL — "reignite our MCP
-- connections… separate unique connections… each has their own particular requirements").
-- Until now it could not exist in the canonical gateway at all: create_mcp_connection
-- requires a curated mcp_providers row (MCP_BAD_PROVIDER on absence), and no GHL row was
-- ever seeded. This seeds exactly the descriptor — no connection, no authority, no tool,
-- no execution wiring ships here.
--
-- What is honest about GHL's own requirements (the descriptor encodes them):
--   • The MCP endpoint lives on services.leadconnectorhq.com (the Integrations catalogue
--     row names /mcp/anthropic/v2); the exact per-tenant path is copied from the tenant's
--     own GHL MCP settings at connect time, exactly like Zapier's per-workspace endpoint.
--   • TWO executable auth kinds, both MCP-executable in the gateway loader:
--     - oauth  — the GHL marketplace app flow (issuer marketplace.leadconnectorhq.com),
--                through the same gateway OAuth path as every provider, with the M2 fix
--                selecting scopes from the protected resource (challenge → metadata → omit).
--     - bearer — a location/company API token presented as the MCP bearer credential.
--   • transports {http}: the client speaks MCP Streamable HTTP (the one transport the
--     client implements); sse/stdio remain non-executable facets by the loader's allowlist.
--   • default_scopes stays empty '{}': GHL's scope catalogue is the marketplace app's own
--     concern; the gateway never requests a scope the resource did not advertise (M2).
--   • resource_url_shape NULL: no invented path suffix — the endpoint is the tenant's real
--     one, SSRF-guarded at write time by the same _mcp_endpoint_write_safe as every facet.
--
-- Idempotent seed, same shape as the 20270319000000 seeds (ON CONFLICT DO NOTHING).
INSERT INTO public.mcp_providers
  (provider_key, display_name, is_generic, auth_kinds, transports, account_class, resource_url_shape, default_scopes, notes)
VALUES
  ('gohighlevel', 'Go High Level', false, '{oauth,bearer}', '{http}', 'multi', NULL, '{}',
   'Go High Level (LeadConnector) MCP on services.leadconnectorhq.com — the tenant''s own MCP endpoint from GHL settings. OAuth via the GHL marketplace app (marketplace.leadconnectorhq.com) or a location/company API token as the MCP bearer. CRM lane: contacts, conversations, opportunities, calendars.')
ON CONFLICT (provider_key) DO NOTHING;
