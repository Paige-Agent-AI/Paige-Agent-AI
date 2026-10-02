# M3 — the Zapier governed lane: what exists, what is pinned, and the live-proof path

> **Status: the Spine now sees the Zapier surface.** This milestone registers the two LIVE chat
> tools as governed capabilities (CI-enforced by `src/__tests__/mcp-zapier-governed-lane.test.ts`)
> and documents Zapier's own connection requirements. As with M1, the canonical live dispatch is
> fail-closed behind the owner go (`MCP_GATEWAY_EXECUTE_ENABLED`, default OFF) — nothing in the
> merge shipped a live external effect.

## Zapier's own requirements (why it is its own connection)

Zapier is not n8n. Three things make its lane distinct, and the gateway already models all three:

1. **The endpoint is per-workspace.** A tenant's Zapier MCP server is their own dedicated
   endpoint on `mcp.zapier.com` (created in Zapier's MCP UI, where the tenant also chooses WHICH
   of their Zaps/actions are exposed). Tool discovery therefore returns the tenant's OWN enabled
   actions — never a global catalogue — and `zapier_list_actions` is the honest per-tenant truth.
2. **Two auth kinds, both executable.** The provider descriptor seeds `auth_kind ∈ {oauth, url}`:
   - `url` — Zapier's native model: the MCP URL itself carries the credential. The writer stores
     it encrypted, a disconnect SCRUBS it (a url-connection's secret lives inside its endpoint —
     the disabled shell must not keep it), and the loader treats it as MCP-executable.
   - `oauth` — OAuth 2.1 (DCR + PKCE) through the same gateway flow as every provider, with the
     M2 fix selecting scopes from the PROTECTED RESOURCE (challenge → resource metadata → omit),
     never the authorization server's broad catalogue.
3. **The consequential act is an ACTION, not a workflow.** n8n's governed unit is a workflow
   (create/activate/run); Zapier's is a single action in some other app (send the Slack message,
   add the Sheets row). Its blast radius is the whole 9,000+-app catalogue, which is why the
   Spine classifies `zapier_run_action` as `external_effect` / `high` risk behind the
   chat-canonical propose-first approval — the operator approves THE SPECIFIC ACTION, and the
   discovery tool must run first to resolve the exact tool name.

## What is already LIVE (the chat lane)

Both tools are in the paige-ai-chat manifest and dispatch through the governed
`call-zapier-action` lane (per-tenant credentials decrypted server-side only, SSRF-guarded,
provider prose never returned, outcome projection filed to the owner-visible feed):

- **`zapier_list_actions`** (read-only) — a real MCP `tools/list` provider call that records its
  success or failure honestly, and answers `not_connected` when no Zapier is connected.
- **`zapier_run_action`** (external effect) — proposes first under the autonomy policy; runs the
  approved action; reports what Zapier returned, never a hoped-for outcome.

The closed refusal vocabulary an operator can actually see (kept closed by the M3 contract):
`not_connected` / `connection_disabled` / `discovery_unavailable` / `reauthorization_required` —
an unreachable Zapier is never misreported as an approval problem.

## The canonical gateway path (provider-agnostic, M1-pinned)

The `mcp_connections` registry serves Zapier through the same governed doors as n8n — connect →
verify → tools → approve → execute → receipt. The connect body differs only in the provider key
and the URL-shaped credential:

```json
{ "action": "create", "facet": "mcp", "provider_key": "zapier", "label": "Zapier MCP",
  "server_url": "https://mcp.zapier.com/<your-workspace-path>", "auth_kind": "url" }
```

> The `server_url` is the tenant's OWN Zapier MCP endpoint copied from Zapier's MCP settings —
> it embeds the credential, is stored encrypted, and is never echoed back beyond the host. For
> the OAuth facet, create the connection and run the `oauth_begin` action instead of passing a
> URL credential.

From there the M1 runbook (`m1-execute-verification.md`) applies verbatim: `verify` (the only
writer of connected/healthy; discovers the tenant's enabled actions), `tools` (the catalogue),
`approve` (per-tool durable consent — tenant-admin), `execute` with `mode:"prepare"` first, and
the owner-gated `mode:"execute"` last. An approval *may* bind an args shape (the optional
`args_shape_hash` hardening field from the M1 runbook); when it does, a different shape needs its
own consent — pass it for consequential actions. The Rail receipt, the `recorded` truth semantics,
and the uniform `not_found` collapse are all the same provider-agnostic machinery.

## What M3 did NOT change (scope discipline)

- No new chat tool, executor, store, migration, or authority — the two tools were already live;
  the Spine registered them (the same adoption shape the calendar presets took).
- The legacy `call-zapier-action` lane and the canonical gateway remain two doors to the same
  provider until the cutover the gateway migration already names ("tenant_mcp_connections …
  remain the sole LIVE path until a later cutover") — both are now Spine-visible and pinned.
- Mind/knowledge binding stays `UNAVAILABLE` by design until the Knowledge lane lands (owner
  direction 2026-10-02).
