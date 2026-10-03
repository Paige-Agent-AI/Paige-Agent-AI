# M4 — the Go High Level connection lane: the provider exists, and the honest path to Paige's hands in the tenant's CRM

> **Status: corrected 2026-10-03 after grounding GHL's own official setup article.** The
> provider descriptor is live (migration 20270534000000 seeded it; 20270536000000 corrected
> it to GHL's real requirements). **Zero live GHL execution, no chat tool, no Spine
> capability** — those land only after the first real connection's discovery shows GHL's
> actual tool names. The canonical live dispatch stays fail-closed behind the owner go
> (`MCP_GATEWAY_EXECUTE_ENABLED`, default OFF).

## GHL's real requirements (from their official setup article, verified 2026-10-03)

1. **The endpoint is the GENERIC one: `https://services.leadconnectorhq.com/mcp/`.** The
   client-shaped variants (`/mcp/anthropic/v2`, `/mcp/openai/v2/`, `/mcp/muse/v2`) exist for
   named AI clients; a custom MCP application — ours — uses the generic endpoint.
2. **Auth is a Private Integration Token (PIT), NOT OAuth.** Create it in the sub-account:
   Settings → Private Integrations → Create New Integration → pick the scopes → copy the
   token. GHL's own article says OAuth "is planned for a future release" — **it is not
   offered for MCP today.**
3. **A `locationId` header rides alongside the bearer token** on every MCP call — the id of
   the sub-account the PIT belongs to.
4. **Scopes are chosen at PIT creation, on GHL's side** (Contacts, Conversations,
   Opportunities, Calendars, Payments, and view-scopes are their suggested set). Nothing
   extra is needed from us.

### What our build already supports (verified in code, no changes needed)

- `auth_kind: "bearer"` is MCP-executable in the canonical loader.
- **Custom headers ride encrypted end-to-end**: stored in the connection's encrypted
  header bundle, grammar-checked, rejected only if they collide with the transport's
  reserved names (`locationId` does not), and forwarded on every MCP call the session
  makes — exactly the `locationId` requirement.
- The verify path (read-only handshake) and per-tool approval apply to any endpoint.

### The correction (what was wrong)

The original descriptor advertised an **oauth facet GHL does not offer**. The owner's OAuth
attempt (2026-10-02) went through GHL's own `lc-mcp` marketplace app — a different surface
from the official MCP path — and died at their consent with `Invalid scope(s)`: their
resource metadata advertises ~180 scopes while their consent rejects the 8 newest
(`emails/templates.*`, `emails/campaigns.*`, `emails/stats.*`, `files.readonly`,
`socialplanner/comments.*`). That is GHL's app-side inconsistency, on a door we should
never have pointed at. The descriptor is now bearer-only (migration 20270536000000); if GHL
ships MCP OAuth later, re-adding the facet is a one-line change verified against this
runbook first.

## The connect path (works today through the Integrations drawer)

In the drawer: paste **Server URL** `https://services.leadconnectorhq.com/mcp/`, choose
**Headers** authentication, credential header stays `Authorization` (the drawer sends it as
a Bearer), token = **the PIT**, then **Add header** → name `locationId`, value = your
sub-account's location id. Save, then Check — the verify handshake discovers GHL's real
tool catalogue (`search`, `fetch`, `search_operations`, `describe_operation`,
`execute_operation`, `list_locations` per their docs) into the connection's tool list.

The API equivalent (the runbook's canonical body):

```json
{ "action": "create", "facet": "mcp", "provider_key": "gohighlevel",
  "label": "GHL — <location name>", "server_url": "https://services.leadconnectorhq.com/mcp/",
  "auth_kind": "bearer", "auth_token": "<private-integration-token>",
  "custom_headers": { "locationId": "<your-location-id>" } }
```

From there the M1 runbook (`m1-execute-verification.md`) applies verbatim: `verify` (the
only writer of connected/healthy — and the step that proves the PIT + locationId pair
against the real endpoint), `tools` (the catalogue), `approve` per tool (pass
`args_shape_hash` for the consequential ones), `execute` with `mode:"prepare"` first, then
the owner-gated `mode:"execute"`.

**Discovery is the gate for everything that follows.** The next slice (the governed
chat/Spine surface) is declared from what `verify` actually returns — never from invented
names. Until a real connection has been verified, Paige honestly has no GHL hands.

## What M4 did NOT ship (scope discipline)

- No chat tool, no Spine capability, no execution wiring, no sample data — the registry JSON
  entry (`gohighlevel-mcp`, PARTIAL) names the gap explicitly.
- Mind/knowledge binding stays out entirely (parked per owner direction; the integrations
  Mind projection covers connection STATE once a GHL row exists).

## The finish line for this lane (next slice)

First live GHL connection: connect (PIT + locationId) → verify → read the discovered tool
catalogue → then declare the Spine domain + chat tools from the real names (the M3 zapier
shape: register what exists), with every CRM write behind the chat-canonical propose-first
approval and the real-money track.
