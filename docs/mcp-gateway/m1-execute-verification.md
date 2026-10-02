# M1 — n8n end-to-end execute verification (connect → verify → discover → approve → execute → receipt)

> **Status: the source-level contract is PINNED and CI-enforced** (`src/__tests__/mcp-execute-e2e-contract.test.ts`).
> The live dispatch is **fail-closed behind the owner go** (`MCP_GATEWAY_EXECUTE_ENABLED`, default OFF) —
> this runbook is the owner's procedure for the one-time live proof when you choose to run it. Nothing in
> the M1 merge shipped a live external effect.

## What is already proven (CI, every run)

The contract test pins the wiring of the full path at the source level:

- the gateway exposes all four governed actions (`verify`, `oauth_begin`, `approve`, `execute`) plus `tools`;
- `mode:"execute"` refuses `execute_not_enabled` **before any dep is built or provider is contacted**;
- health promotion writes only through the service-role `mcp_connection_probe` RPC (never a direct
  table write), generation-bound (INT-152 compare-and-write);
- the execute path composes the SSRF-guarded loader (`makeRpcConnectionLoader`), the durable consent
  verifier (`makeRpcApprovalVerifier`), and the canonical Rail receipt (`makeCanonicalRailReceipt`);
- the n8n Spine domain declares the governed workflow capabilities and the registry composes them.

What CI cannot prove is a real `tools/call` against a live provider — there is no n8n instance in CI,
which is exactly why the dispatch is owner-gated (§33: wire the path live and verifiable, keep the
consequential behavior behind the owner's own switch).

## The live proof procedure (owner-gated)

**Prerequisites.**

1. An n8n instance reachable at a **public HTTPS endpoint** (the SSRF write guard refuses
   `localhost`, private IPs, `*.internal`, non-TLS), with an API key (REST facet) — or an n8n MCP
   endpoint with its auth.
2. Your authenticated session (the gateway requires the caller's `Authorization` JWT; every
   authority gate resolves through the RLS-scoped caller client).
3. The edge function secret `MCP_GATEWAY_EXECUTE_ENABLED` — **leave it unset for steps 1–5.**
   It is only needed at step 6.

All requests are `POST` to `https://<project>.supabase.co/functions/v1/mcp-gateway` with the
session's `Authorization: Bearer <jwt>` header. Bodies are JSON. Substitute `<CONNECTION_ID>` after
step 1.

### Step 1 — connect

```json
{ "action": "create", "facet": "rest", "label": "n8n primary", "base_url": "https://<n8n-host>", "api_key": "<n8n-api-key>" }
```

(The `rest` facet pins `provider_key='n8n'` server-side via `create_mcp_rest_connection`; the `mcp`
facet variant uses `server_url` + `auth_kind` via `create_mcp_connection`.) Expect
`{ "connection_id": "<uuid>", "status": "pending_verification", "auth_token_last4": "…" }` —
**no secret is ever echoed beyond last4.**

### Step 2 — verify (the only writer of connected/healthy)

```json
{ "action": "verify", "connection_id": "<CONNECTION_ID>" }
```

Expect `{ "ok": true, "status": "connected", "health": "healthy", "tool_count": N }`. This runs the
read-only MCP handshake (initialize + `tools/list`, never a `tools/call`) and persists the verified
tool catalog. If the tool count is 0 or the status is `error`, fix the n8n side before continuing —
**an unverified tool cannot be approved.**

### Step 3 — discover the catalog

```json
{ "action": "tools", "connection_id": "<CONNECTION_ID>" }
```

Any tenant member may list; pick a **read-class** tool for the first live execute (for n8n REST,
`n8n_list_workflows`-class reads are the right first target — observable, reversible, cheap).

### Step 4 — approve (per-tool durable consent; tenant-admin)

```json
{ "action": "approve", "connection_id": "<CONNECTION_ID>", "tool_name": "<TOOL_NAME>" }
```

The edge resolves the live-verified tool pin and the current endpoint hash server-side (neither is
client-visible) and records the durable, endpoint-bound approval. Optional hardening fields:
`expected_endpoint_hash`, `args_shape_hash`, `expires_at`. Expect `{ "ok": true, "approved": true }`.

### Step 5 — prepare (no provider contact; gate still OFF)

```json
{ "action": "execute", "connection_id": "<CONNECTION_ID>", "tool_name": "<TOOL_NAME>", "args": {}, "mode": "prepare" }
```

Expect `{ "outcome": "prepared", "code": null, "run_id": "…", "recorded": null }`. `prepare` proves
the full pre-dispatch chain — loader, authority, consent, capability resolution — without contacting
n8n. If prepare refuses here, **do not proceed**; the refusal code (`approval_required`,
`contract_changed`, `not_found`, …) says which link is missing.

### Step 6 — execute (flip the owner go)

Set `MCP_GATEWAY_EXECUTE_ENABLED=true` on the `mcp-gateway` function (Supabase dashboard → Edge
Functions → mcp-gateway → Secrets, or `supabase secrets set`), then repeat step 5 with
`"mode": "execute"`.

Expect `{ "outcome": "read_observed", "code": null, "run_id": "…", "recorded": true }` for a read
tool (`"executed"` for a mutation). Then:

- **observe the Rail**: the run files one canonical row via `record_capability_run`
  (`capability_succeeded` / `capability_failed` / `capability_refused` / `capability_outcome_unknown`)
  — this is the owner-visible truth in the workspace events feed;
- **`recorded: false`** means the outcome happened but the Rail row is owed — investigate, don't
  retry blind;
- **`outcome: "outcome_unknown"`** means the dispatch landed but the landing is uncertain —
  **check the provider side before running again**; a blind retry could double-apply an effect
  (this is why it returns HTTP 200, not 5xx).

### Step 7 — close the gate

`supabase secrets unset MCP_GATEWAY_EXECUTE_ENABLED` (or set to `false`) once the proof is recorded.
Leaving it on is a standing decision to allow live consequential dispatch — make it deliberately
when the governed-execute UI (later milestone) ships, not by accident today.

## What a refusal means (closed vocabulary)

| body | meaning |
|---|---|
| `execute_not_enabled` | the owner go is OFF — the gate held; nothing was dispatched |
| `not_found` | you cannot prove you own this connection (uniform for foreign/disabled/unusable — no cross-tenant oracle) |
| `tenant_mismatch` | your session switched workspaces after launch (409) |
| `approval_required` | no durable approval for this (connection, tool) — do step 4 |
| `contract_changed` / `no_longer_offered` | the tool changed since verification — re-verify, re-approve |
| `provider_unavailable` / `tool_error` | n8n side (502); the body carries the closed code, never provider prose |
