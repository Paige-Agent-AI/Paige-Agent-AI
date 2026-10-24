# EXP10 — Negative-Proof & Evidence Annex (A1–A10 reconciliation)

**Companion to:** `EXP10-EXECUTION-READINESS-AND-ACCEPTANCE.md` (the A1–A10 matrix) and
`EXP10-SOURCE-RECONCILIATION-REGISTER.md`. Grounded against main @ `95c15e9f0` + the seven
merged EXP10 releases (PRs #2614/#2619/#2621/#2639/#2622/#2623/#2624) + #2707 (in flight).
**Standing honesty rule:** BUILD (source on main) ≠ INTEGRATION (wired to live machinery) ≠
PROOF (authenticated evidence). Nothing below upgrades a class without its evidence.

## 1. Negative-proof matrix (case → enforcing seam → pinning proof)

| Case | Enforcing seam (canonical home) | Pinning proof |
|---|---|---|
| Tenant isolation — foreign connection id | gateway verify/approve/execute resolve the caller's tenant server-side; a foreign id is `not_found` (no IDOR) | `_shared/mcp-gateway/verify.ts` gates; pgTAP `mcp_gateway_owner_only_visibility.sql`; `mcp_tool_catalog_tenant_scope.sql` |
| Tenant isolation — member vs owner_only | v2 reader visibility + runner enforcement (`owner_only_forbidden`) | pgTAP `(D)` in `integrations_surface_sees_mcp.sql` (both sides: admin sees, member does not — survives the nested SECURITY DEFINER call) |
| Workspace-switch race | `expected_tenant_id` guard → 409 `tenant_mismatch` on every gateway action | `verify.ts`; panel tests pin `expected_tenant_id` on writes |
| Revoked/disabled credential | loader: `enabled=false` → `connection_disabled`; disconnect clears keys + approvals + tool catalogue | `connection.ts` fail-closed sets; `20270331000000` re-key voids consent (P1(a) reconnect semantics documented) |
| Expired OAuth authorization | loader refuses `access_token_expires_at <= now()` (`connection_unusable`) — never dispatches a dead credential | `connection.ts`; `mcp_gateway_approval_future_expiry.sql` (approval expiry refused) |
| Re-keyed mid-flight (TOCTOU) | config-generation compare-and-write on probes; `config_changed_during_verify` 409 | INT-152 machinery; `verify.ts` 409 branch |
| Re-keyed endpoint vs standing consent | consent bound to endpoint hash → `endpoint_load_mismatch` | `mcp_gateway_durable_endpoint_bound_consent.sql`; `mcp_gateway_endpoint_load_binding.sql`; `mcp_gateway_endpoint_revokes_approvals.sql` |
| Denied/refused provider handshake | closed error vocabulary (`mcp_http_error`/protocol codes) — never provider prose; credential-reflection guard rejects a poisoned catalogue whole | `_shared/mcp-client.ts` (bounded codes, `provider_reflected_credential`); pgTAP `(G2)` proves provider PROSE is refused at the write by the schema CHECK |
| Wrong auth facet | `isHttpMcpFacet` allow-list (REST/api_key → `connection_unusable`); REST facet has its own disjoint writer | `mcp_oauth_refuses_the_rest_facet.sql`; `create_mcp_rest_connection` disjoint lane |
| Timeout | `safeFetch` bounded wall clock (15s default) + bounded bytes; failure is a closed code, never a hang | source-pinned in `mcp-client.ts` (timeoutMs/maxBytes); **unit pin of the timeout path itself: GAP (named, §3)** |
| Rate limit (provider 429) | surfaces as `mcp_http_error` with status — closed, recorded on the row via `mcp_connection_probe` | `mcp-client.ts:242`; **dedicated 429-fixture test: GAP (named, §3)** |
| Lost/uncertain acknowledgment | typed unknown outcomes — NEVER fabricated success; contact lane refuses blind re-save (`MCP_CONTACT_OUTCOME_UNKNOWN`: "the request may have committed — read current settings before another change") | `mcpContactSync.ts` + `useMcpContactSync.test.tsx`; runner's unknown-outcome recording |
| Duplicate operation | `(tenant,provider,label)` unique → `MCP_DUPLICATE_LABEL`; idempotency keys in the durable-job spine; approvals are one-confirmation-per-action | `mcp_gateway_connection_create.sql`; durable-job idempotency contract |
| Reload/readback truth | writes answer with durable readback; UI re-reads from the server, never patches locally; new rows read "Not checked yet" until a probe promotes them | gateway-panel suite (pinned: "the list is re-read from the server"); durable `ack`/`confirmed` states |
| Provider-injected content (prompt injection) | provider payloads fenced as untrusted; catalogues carry identifier-validated names + sanitized labels only | `tools.ts` closed catalogue projection; chat GHL lane projects names/counts only |
| Non-admin write | writer RPCs require `mcp.connections.manage` (tenant admin) — member writes refused | `mcp_gateway_connection_create.sql`; panel "offers no add path to someone who cannot write" |

## 2. A1–A10 status against current evidence

(Statuses as posted in ANT-164's RECEIVING ACK, 2026-10-23 — BUILD/INTEGRATION/PROOF kept
distinct. Summary: **A4, A6 = PROOF-backed by production reads; A1, A5, A7, A10 =
BUILD+INTEGRATION with authenticated drives owed; A2, A3, A8 = owner-participation proofs
pendiing; A9 = owner-gated OFF, never claimed.**)

## 3. Named gaps (honest)

1. **Authenticated drives** (owner on the designated ordinary account): browse-discovery
   (A1), chat "which apps / help me connect" (A4/A7 full proof), a real Slack connect (A2),
   GHL reconnect (A3/A8), disconnect+revoke drive (A10). Source and machinery are deployed;
   these are owner-participation steps, scripted in the acceptance matrix.
2. **Timeout-path unit pin**: `safeFetch`'s timeout is source-pinned; a deterministic
   fake-timer unit test of the timeout branch is owed (candidate follow-up test PR; no
   runtime risk — the closed-code path is exercised by the same branch as transport errors).
3. **429-fixture test**: rate-limit surfacing shares the `mcp_http_error` branch; a
   status-specific fixture would pin the mapping explicitly (same follow-up PR as #2).
4. **ALG-01 receipts evidence**: zero receipts ever (execute OFF) — reconciliation maturity
   stays PARTIAL/UNPROVEN until the owner's go produces real runs (approval row 1 in the ACK).
5. **ALG-13**: deterministic seeds only (remediation prompts via the action bus;
   connect-a-useful-tool via `automation_wired`). No recommendation engine claimed.

## 4. Founder-evaluation packet pointer

The integrated founder packet = this annex + the readiness/acceptance doc (§1 chain inventory,
the 15-minute post-go proof, A1–A10) + the register + the seven/eight PR records. The journey —
discover → connect → operate → monitor → recover → disconnect — is fully built and deployed;
**the only owner-participation steps still owed are the five approval-table rows in the ACK.**
