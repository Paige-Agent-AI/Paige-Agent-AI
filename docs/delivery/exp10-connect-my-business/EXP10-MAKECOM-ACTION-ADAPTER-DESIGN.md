# EXP10 — Make.com Layer C ActionAdapter design (slice 1: verified facts + design)

Status: DESIGN (nothing built; registry row stays PROPOSED per the status vocabulary — a design
does not promote). This is the `next_slice` the registry row named: *verify Make API v2
scenario/execution operations + OAuth shape; then design the ActionAdapter against the
n8n-adapter precedent.* All provider facts below were verified against the official Make
developer documentation on 2026-10-27 (sources at the end); nothing is invented.

## 1. Verified provider facts (the adapter's raw material)

**Run.** `POST {base}/scenarios/{scenarioId}/run` — base is one of `eu1/eu2/us1/us2.make.com/api/v2`
(plus `eu1/us1.make.celonis.com` variants). Auth: `Authorization: Bearer <jwt>`; the endpoint
accepts a token carrying any of `scenarios:read | scenarios:write | scenarios:run` (we will
request exactly `scenarios:run scenarios:read` — `read` is also what every readback endpoint
below requires; `write` is not needed and will not be requested). Body: `data` (the scenario's
declared inputs), `responsive` (if true, waits ≤40s and returns `status` 1/2/3 + `executionId`;
on the 40s timeout the execution STILL proceeds and the error is returned), `callbackUrl`
(completion webhook carrying `executionId` + `statusUrl`; skipped when the run finishes inside
the responsive window). Default mode is queued: the response carries `executionId` only.
The scenario must be ACTIVE. `429`/`IM310` = org paused for exceeded operations/data-transfer
(no execution starts); `SC429`-class = no execution slot free.

**Readback (the part n8n never had).** `GET {base}/scenarios/{scenarioId}/executions/{executionId}`
→ `status: RUNNING | SUCCESS | WARNING | ERROR | PAUSED` (PAUSED carries `interruptReason`
`sleep|hitl`, `resumeAt`, `interruptModuleId` — `hitl` means the scenario is waiting for a
HUMAN decision), `outputs` (shape depends on scenario config), `error{name,message,causeModule}`.
Scope `scenarios:read`. There is also `POST …/executions/{id}/stop` (`scenarios:run`) — recovery
lever for a runaway execution. Organization request limits do NOT apply to the run endpoint.

**Auth (tenant-owned OAuth, confidential client).** Authorization
`GET https://www.make.com/oauth/v2/authorize`, token `POST https://www.make.com/oauth/v2/token`;
authorization-code + refresh-token grant; access token is a 1-hour Bearer JWT; refresh via the
same token endpoint. **There is NO self-service client registration:** an OAuth 2.0 client must
be requested from Make via their form (`https://f.make.com/oauth`), reviewed within **10 business
days**. Personal API tokens exist as an alternative auth — both methods are scope-governed (a
token selects its scopes at creation; only an unrestricted token spans the org), so breadth is
a configuration choice, not inherent to tokens. NOT the design path; noted as fallback only.

## 2. The design (against the n8n-adapter precedent)

**Same contract, better provider.** `make-adapter.ts` implements the Layer C `ActionAdapter`
exactly as `n8n-adapter.ts` does: `dispatch` + `readback` over the shared `DispatchInput` /
`DispatchResult` types, registered for the Make act kinds. Make is strictly easier than n8n
because a real execution-status endpoint exists (n8n had to poll the execution record for node
errors; Make hands us a status enum):

| Provider answer | DispatchResult mapping |
|---|---|
| run 2xx (queued or responsive) | `accepted_for_execution`, providerRef = `executionId`. NEVER `executed` on a 2xx fire — the status endpoint is the only authority (responsive `status` is recorded in `detail`, not trusted as final). |
| executions/{id} `SUCCESS` | `executed` |
| `WARNING` | `executed` with the warning recorded in `detail` — a warning is not a failure and must not read as one |
| `ERROR` | `failed` (carry `error.name` + `causeModule.appName` — closed, non-prose fields) |
| `RUNNING` | `ambiguous` (re-poll; never re-fire) |
| `PAUSED` (`hitl` or `sleep`) | `ambiguous` with `interruptReason` in detail — a `hitl` pause is a human-decision wait; blind re-fire is the one forbidden move in both directions |
| execution not found / transport error | `ambiguous` (cannot confirm — never a blind re-fire that could double-run) |
| pre-fire: not connected, scenario missing/inactive, bad args | terminal `failed` |
| `IM310` (org paused) | terminal `failed` with the honest code — a retry cannot un-pause the org |
| slot exhaustion (SC429-class) / 5xx | `ambiguous` (retryable later; no execution started or unknown) |

**Correlation.** The act's correlation ref is stamped into `data.__paige_correlation` (same
convention as the n8n payload stamp) so a scenario can echo it; the poll binding is the
`executionId` → provider_ref, coalesced by the existing monotonic RPC.

**Network seam.** ONE shared `_shared/make-run.ts` (the `n8n-run.ts` pattern): resolves the
tenant's connection internally (service-role, explicit tenant), refreshes the 1-hour token
server-side (refresh token never leaves the seam), enforces the **fixed base-URL allowlist**
(`eu1/eu2/us1/us2.make.com` + the two celonis hosts — stricter than the generic SSRF rule
because the set is closed), and rides `safeFetch` (deadline now covers DNS — PR14). No forked
client; `paige-make`-style surfaces, if ever needed, drive the same seam.

**Connection storage.** A tenant-owned connection row (Make base domain + OAuth tokens,
platform-encrypted, `config_generation` fencing on re-key) following the gateway's storage
discipline. Make is REST, not MCP — `mcp_providers` is explicitly NOT the path (the registry
row already says so); the orchestration-layer adapter is. Scope request is exactly
`scenarios:run scenarios:read`; `scenarios:write` is never requested.

**Governance (unchanged).** The Make act kinds ride the existing action-risk classes (an
automation run = HIGH, like `n8n_run_workflow`); the auto-lane clamps to propose/approval and
this adapter is only reachable from a human-approved `execute` decision. The `stop` lever maps
to a recovery action, not an auto-behavior.

## 3. What is NOT in this slice, and the one external dependency

Nothing here is built, connected, or claimed runnable. The single **owner-held dependency**
before any implementation PR: the **Make OAuth client registration** (form submission,
≤10-business-day review) — the same class of prerequisite as Teams AAD, and it gates even a
staging connect. Implementation order once the client exists: (1) `_shared/make-run.ts` seam +
unit tests with a mocked transport; (2) `make-adapter.ts` + the pure mapping table's tests
(the n8n adapter's test file is the template); (3) connection surface + registry promotion to
PROOF_OWED with code anchors; (4) authenticated drive against a real tenant scenario.

## Sources (fetched 2026-10-27)

- `developers.make.com/api-documentation/api-reference/scenarios.md` (run endpoint, scopes, responsive/callback semantics)
- `developers.make.com/api-documentation/api-reference/scenarios/logs.md` (execution status/outputs/stop endpoints, `scenarios:read`)
- `developers.make.com/api-documentation/authentication/requesting-an-oauth-2.0-client.md` (client registration form + 10-day review)
- `developers.make.com/api-documentation/authentication/oauth-flow/authorization-code-flow-with-refresh-token-confidential-clients.md` (authorize/token URLs, 1h JWT, refresh grant)
