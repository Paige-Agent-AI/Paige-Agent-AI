-- The GHL provider-descriptor corrections (owner direction 2026-10-03: "perfect the GHL MCP
-- connection — double-check their requirements and compare to what we have built").
--
-- THE COMPARISON, grounded on GHL's own official setup article (help.gohighlevel.com
-- 155000005741): the HighLevel MCP server's REAL requirements are (1) the GENERIC endpoint
-- https://services.leadconnectorhq.com/mcp/, (2) a Private Integration Token as the bearer
-- credential (created in the sub-account: Settings → Private Integrations, scopes chosen
-- there), (3) a locationId HEADER alongside the token, and (4) NO OAuth — the article says
-- OAuth "is planned for a future release". Our runtime ALREADY supports every one of these
-- (bearer is MCP-executable in the loader; custom_headers are encrypted, grammar-checked,
-- non-reserved, and forwarded on every MCP call). What was wrong was the DESCRIPTOR: it
-- advertised an oauth facet GHL does not offer — the door the owner tried, which dead-ended
-- in GHL's own lc-mcp marketplace consent with their Invalid-scope(s) bug (their metadata
-- over-advertises the 8 newest scopes their consent rejects).
--
-- This migration corrects the descriptor to the honest shape: bearer only, the generic
-- endpoint path, notes naming the PIT + locationId-header requirement. If GHL ships MCP
-- OAuth later, re-adding the facet is a one-line change with their flow verified against
-- the runbook first.
UPDATE public.mcp_providers
SET auth_kinds = '{bearer}',
    resource_url_shape = '/mcp/',
    notes = 'Go High Level (LeadConnector) MCP — the GENERIC endpoint https://services.leadconnectorhq.com/mcp/ (GHL''s own setup article; the client-specific /mcp/<client>/v2 variants are shaped for named AI clients). Auth is a Private Integration Token as the MCP bearer (sub-account → Settings → Private Integrations → Create New Integration, scopes chosen there) PLUS a locationId custom header on the connection. OAuth is NOT offered for MCP today (GHL article: "planned for a future release") — the facet was removed from this descriptor for honesty; re-add only when GHL ships it. CRM lane: contacts, conversations, opportunities, calendars.'
WHERE provider_key = 'gohighlevel';
