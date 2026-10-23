# EXP10 — Governed-Execution Readiness & Owner Acceptance Matrix

**Status of this document:** readiness packaging for the owner's decisions and ONE complete
Experience evaluation. Nothing here flips a flag or claims an unproven runtime.
**Companion register:** `EXP10-SOURCE-RECONCILIATION-REGISTER.md` (PR1, merged `c10355ba4`).
**Linear:** ANT-164.

---

## 1. Governed execution — what is built, what the owner's "go" is

The canonical MCP gateway ships the complete governed execution chain (deployed, verified by
source + CI, **never exercised live**: zero `mcp_connection_approvals` and zero
`mcp_connection_receipts` rows exist — production truth 2026-10-22):

| Link | Home | State |
|---|---|---|
| Connection + encrypted credential | `mcp_connections` + service-role-only decrypt | live (n8n + Zapier MCP on one tenant; Slack + GHL now connectable) |
| Read-only verification | gateway `verify` (SSRF-guarded handshake, credential-reflection guard, config-generation CAS) | live |
| Tool catalogue + pins | `mcp_connection_tools` (36 probed tools cached) | live |
| Per-tool durable approval | gateway `approve` → `mcp_connection_approvals` + `set_mcp_connection_approval` RPC (expiry, endpoint-hash binding) | built; **0 uses** |
| Governed execution | gateway `execute` → runner (consent verifier, canonical connection loader, owner_only enforcement) | built; **gated OFF** |
| The owner go | env `MCP_GATEWAY_EXECUTE_ENABLED=true` on `mcp-gateway` | **owner decision** — never self-flipped |
| Durable receipt | `record_mcp_connection_receipt` → `mcp_connection_receipts` + Rail | built; **0 rows** |
| Layer C orchestration | `_shared/paige-orchestration/` (adapters incl. n8n + native, approve-executor, dispatch-claim, outcomes) | deployed (`paige-orchestrator` v117, `execute-approval` v170, `paige-action-worker` v91) |

**Post-go acceptance sequence (the owner's 15-minute proof):**
1. On the connected n8n (or new Slack) connection: load tools → approve ONE read-only tool
   (e.g. an n8n workflow list or a Slack channel read) with a bounded expiry.
2. Through Chat (or the panel): attempt the action — expect the governed prepare/confirm card,
   then execute.
3. Verify the receipt: `mcp_connection_receipts` row + Rail outcome + provider's own response
   id in the closed outcome vocabulary.
4. Negative proofs (already enforced, worth re-seeing live): foreign-tenant tool id →
   `not_found`; unapproved tool → consent refusal; member on an owner_only connection →
   `owner_only_forbidden`; expired approval → refusal; disconnect → every path refuses.

**Known execution-side truths:** uncertain provider outcomes surface as typed unknown states
(never fabricated success); irreversible actions are never blindly retried; per-tool approvals
are the durable consent (a connection alone never authorizes an action).

## 2. Capabilities catalogue — synchronization state (§11)

- `integrations.list` / `integrations.health` (chat: `integrations_list`) — PARTIAL, honest;
  PR4 makes the rows evidence-bearing (stale + closed error codes).
- `integrations.n8n_run_workflow` — registered, connection-gated (absent ⇒ needs_setup);
  live lane decides only after the execute go.
- `integrations.ghl_list_actions` / `ghl_run_action` — chatBinding LIVE for reads; run is
  propose-first + gateway-gated; honestly `not_connected` today (no GHL connection exists).
- **Slack (new)**: connectable through the gateway (PR2, PROOF_OWED until a real workspace
  connects + verifies); NOT a chat capability until tools are approved post-go — the catalogue
  must not claim it.
- No catalogue entry was marked Live by implementation alone (§11 rule); the owner's §13
  evaluation package below is the acceptance evidence.

## 3. Owner acceptance matrix (§14) — representative, provider classes covered

Positive = the owner does it on his own workspace; Negative = expected honest refusals.
§2's ten customer questions map to rows A1–A10.

| # | Class / provider | Positive case | Negative case |
|---|---|---|---|
| A1 | Discovery | "PAIGE, connect the applications I use" → guided, categorized catalogue (Slack/HighLevel·LeadConnector/n8n/Zapier + 60 MCP servers) with honest states | An unavailable provider (Teams/Make) shows Coming Soon + the real prerequisite, never a fake Connect |
| A2 | Connect (Slack) | Gateway panel Slack tile → form prefilled (endpoint, bearer) → paste internal-app user token → save → durable readback → Verify → tools listed | Wrong-scope token → provider refusal lands as closed error, health needs_attention, no fake success |
| A3 | Connect (GHL/LeadConnector) | HighLevel · LeadConnector tile → PIT + locationId header (enforced) → verify → tool catalogue; location-vs-company scope stated in copy | Missing locationId header → refused at the connection write; company token scope explained |
| A4 | "Which apps are connected?" | Chat `integrations_list` answers from channel + legacy + gateway rows (real statuses, hosts, counts) | Foreign tenant's connection is invisible (not_found class); member vs owner_only honored |
| A5 | "What can PAIGE do with X?" | Approved tool catalogue per connection (names, not just counts); unapproved named for the operator to grant | No connection ⇒ honest not_connected + the connect path, never implied access |
| A6 | "Why isn't my CRM syncing?" | Row evidence: stale=true (probe >7d) or closed last_error_code narrated by chat (PR4) | No invented diagnosis; unknown stays unknown |
| A7 | "Help me connect Slack to Operations" | Chat guides to the real tile + prerequisites (capability_status + steering) | Never claims to connect FOR the owner (no chat-side credential intake) |
| A8 | "Check LeadConnector opportunities" | With a connected GHL: `ghl_list_actions` lists opportunities_* tools (approved/unapproved split) | No connection ⇒ exact not_connected + connect path (pinned in chat source) |
| A9 | "Run this authorized n8n workflow" | Post-go: governed approve → prepare → execute → receipt + provider execution id readback | Pre-go: honest gate refusal naming the owner go; unapproved tool: consent refusal; never blind retry |
| A10 | "Disconnect and revoke" | Turn-off vs delete (keys + approvals cleared) + provider-side revocation step named (PR5) | Non-admin cannot write; revoked-then-use refuses |

**Cross-cutting security cases (enforced by existing seams, re-verifiable live):** tenant
isolation (server-derived tenant at every seam), SSRF guard (https-only, no redirects, public
hosts), credential-reflection guard, secrets never in logs/chat/errors (safe getters return
host + last-4 only), webhook signatures (per-provider lanes), prompt-injection fencing.

## 4. What remains after this package (honest)

- The owner's execute go + post-go proof (§1) — **owner decision**.
- A real Slack workspace connect + verify (PROOF_OWED closes it).
- GHL reconnect acceptance (registry `next_slice` names the steps).
- Scheduled re-probe loop + alerting (ALG-12 remainder), ALG-13 recommendations from real
  connection state (post-acceptance slice).
- Make.com Layer C adapter + Teams AAD app (owner/provider-gated; honest Coming Soon).
