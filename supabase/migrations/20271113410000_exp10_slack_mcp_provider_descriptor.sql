-- EXP10 PR2 — the Slack provider descriptor for the canonical MCP gateway.
--
-- Slack is the owner-named EXP10 launch provider (directive 2026-10-22: "Help me connect
-- Slack to our Operations") and the EXP08 Team Hub dependency. Until now it could not
-- exist in the canonical gateway: create_mcp_connection requires a curated mcp_providers
-- row (MCP_BAD_PROVIDER on absence). This seeds exactly the descriptor — no connection,
-- no authority, no tool approval, no execution wiring ships here. Same shape as the GHL
-- descriptor migrations (20270534000000 + 20270536000000).
--
-- What is honest about Slack's own requirements (verified against Slack's official MCP
-- documentation, docs.slack.dev/ai/slack-mcp-server, 2026-10-22):
--   • The hosted MCP endpoint is https://mcp.slack.com/mcp speaking MCP Streamable HTTP —
--     the one transport the gateway client implements. No SSE endpoint, no stdio.
--   • Slack MCP does NOT support RFC 7591 Dynamic Client Registration ("We do not support
--     SSE-based connections or Dynamic Client Registration at this time"). The gateway's
--     oauth_begin registerClient step would refuse with registration_failed — so the
--     descriptor advertises ONLY the bearer facet this slice can actually complete: a
--     Slack OAuth USER token (xoxp-…) obtained by the tenant's workspace from their own
--     Slack app (internal or directory-published; Slack prohibits unlisted apps for MCP)
--     with the tool scopes Slack documents (search:read.*, chat:write, channels:history,
--     and per-tool scopes — the token's own scopes govern which MCP tools the server
--     offers, exactly like a GHL PIT).
--   • Re-adding the oauth facet is a one-line descriptor change AFTER the gateway grows a
--     pre-registered-client OAuth variant (RFC 8414 discovery IS supported by Slack; the
--     missing piece is DCR only) and an owner-registered PAIGE Slack app — a later slice.
--   • transports {http}; resource_url_shape '/mcp' (the canonical hosted endpoint path);
--     no required_custom_headers (Authorization bearer carries the credential, unlike
--     GHL's locationId).
--   • default_scopes '{}' — the gateway never requests a scope the resource did not
--     advertise, and the bearer facet requests none.
--
-- Idempotent seed, same shape as the 20270319000000 / 20270534000000 seeds.
INSERT INTO public.mcp_providers
  (provider_key, display_name, is_generic, auth_kinds, transports, account_class, resource_url_shape, default_scopes, notes)
VALUES
  ('slack', 'Slack', false, '{bearer}', '{http}', 'multi', '/mcp', '{}',
   'Slack hosted MCP at https://mcp.slack.com/mcp (Streamable HTTP). VERIFIED path: a Slack OAuth USER token (xoxp) from the tenant''s own Slack app (internal or directory-published — Slack prohibits unlisted apps for MCP) presented as the bearer; the token''s granted scopes govern which MCP tools are offered (search:read.*, chat:write, channels:history, etc.). Slack does NOT support Dynamic Client Registration, so the gateway''s DCR OAuth flow cannot complete for Slack — the oauth facet stays OFF this descriptor until a pre-registered-client variant plus an owner-registered PAIGE Slack app exist. Workspace admin approval governs the MCP client.')
ON CONFLICT (provider_key) DO NOTHING;
