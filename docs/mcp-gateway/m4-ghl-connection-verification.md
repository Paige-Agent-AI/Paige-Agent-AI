# M4 — the Go High Level connection lane: the provider exists, and the honest path to Paige's hands in the tenant's CRM

> **Status: the provider descriptor is seeded (migration 20270534000000).** Until this milestone
> GHL could not exist in the canonical gateway at all — `create_mcp_connection` refuses an
> unknown provider key (`MCP_BAD_PROVIDER`) and no GHL row was ever seeded. What ships here is
> exactly the descriptor plus the verification path; **zero live GHL execution, no chat tool, no
> Spine capability** — those land only after the first real connection's discovery shows GHL's
> actual tool names. As with M1/M3, the canonical live dispatch stays fail-closed behind the
> owner go (`MCP_GATEWAY_EXECUTE_ENABLED`, default OFF).

## GHL's own requirements (the third unique connection)

1. **The endpoint is the tenant's own MCP server on `services.leadconnectorhq.com`** (the
   Integrations catalogue row names `/mcp/anthropic/v2`; the exact per-tenant path is copied from
   the tenant's GHL MCP settings at connect time — the same per-tenant-endpoint model as Zapier,
   unlike n8n's self-hosted instance).
2. **Two executable auth kinds:**
   - `oauth` — the GHL marketplace-app flow (issuer `marketplace.leadconnectorhq.com`) through
     the same gateway OAuth doors as every provider. The M2 fix governs scope selection:
     challenge scope → protected-resource metadata → omit; a GHL marketplace app's broad scope
     catalogue is never requested by default.
   - `bearer` — a location/company API token presented as the MCP bearer credential (the quick
     path; the token is stored encrypted, shown only as last4, and a disconnect scrubs it).
3. **The governed unit is CRM data, not workflows or actions** — contacts, conversations
   (SMS/email), opportunities, calendars, invoices. Reads carry PII; writes can move real money
   (invoices, message credits). The lane's blast radius is exactly why nothing ships live: the
   chat surface waits for real discovery.

## The connect path (owner-gated, same doors as M1)

```json
{ "action": "create", "facet": "mcp", "provider_key": "gohighlevel",
  "label": "GHL — <location or agency name>", "server_url": "https://services.leadconnectorhq.com/<your-mcp-path>",
  "auth_kind": "bearer", "auth_token": "<ghl-access-token>" }
```

`provider_key` is required (the `gohighlevel` descriptor seeded by migration 20270534000000);
`auth_kind` is `bearer` for an API token or `oauth` to run the `oauth_begin` flow instead of
passing a token. From there the M1 runbook (`m1-execute-verification.md`) applies verbatim:
`verify` (the only writer of connected/healthy — and the step that discovers GHL's real tool
catalogue into `mcp_connection_tools`), `tools` (the catalogue), `approve` (per-tool durable
consent — tenant-admin; pass `args_shape_hash` for consequential tools), `execute` with
`mode:"prepare"` first, then the owner-gated `mode:"execute"`.

**The discovery step is the gate for everything that follows.** GHL's MCP tool names are
provider-owned and may change; the next slice (the governed chat/Spine surface) is declared
from what `verify` actually returns — never from invented names. Until a real connection has
been verified, Paige honestly has no GHL hands.

## What M4 did NOT ship (scope discipline)

- No chat tool, no Spine capability, no execution wiring, no sample data — the registry JSON
  entry (`gohighlevel-mcp`, PARTIAL) names the gap explicitly.
- No changes to the integrations_surface fact vocabulary (that adapter reads
  `channel_connectors`, a different store; GHL joins it when the lane is live).
- Mind/knowledge binding stays out entirely (owner direction 2026-10-02).

## The finish line for this lane (next slice)

First live GHL connection: connect → verify → read the discovered tool catalogue → then declare
the Spine domain + chat tools from the real names (the M3 zapier shape: register what exists),
with every CRM write behind the chat-canonical propose-first approval and the real-money track.
