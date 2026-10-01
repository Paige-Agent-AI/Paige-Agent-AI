# UI delivery evidence: remote MCP resource-scoped OAuth

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: affected-flow and collision packet below; existing-flow correctness repair, not a new connector.
PAIGE_UI_DESIGN: PASS: project skill, upstream design references, accessibility and five Experience-Quality modules read; existing interface preserved.
MATERIAL_FLOW_CHANGE: NO: repairs permission selection inside the existing explicit OAuth flow; no new screen, goal, confirmation, authentication choice or navigation.
FLOW_PROTOTYPE: NOT_REQUIRED: ordinary correctness repair within the owner-approved shared connection journey; no new interaction design.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner explicitly chooses OAuth for a remote MCP connection and receives resource-specific consent, not unrelated authorization-server permissions.
VISUAL_DIRECTION: PASS: incumbent Mineral/Obsidian drawer, typography, controls and scroll tokens unchanged; Impeccable audit applied to regression evidence only.
AUTOMATED_EVIDENCE: PASS: OAuth smoke 84; gateway smoke 392 plus 11 callback cases; transport 104; n8n SSRF 33; registry smoke 19; shared-form tests 115 and account-fencing tests 36.
STATIC_EVIDENCE: PARTIAL: production build passes; TypeScript ratchet passes with 12 inherited errors; changed-file ESLint reports two inherited explicit-any errors in untouched gateway dependency types. Exact-head remote checks required separately.
RENDERED_EVIDENCE: PASS: local structural-rendered report scripts/live-drive/artifacts/shared-mcp/report.json; 16 frame/theme/dock geometry variants. Real SoloSettings, synthetic transport, reconstructed shell and placeholder dock, not authenticated runtime.
BEHAVIORAL_EVIDENCE: PASS: 258 local browser assertions cover explicit auth, save/readback, failed-save recovery, OAuth retry, cancellation, focus, scroll and cleanup. This does not prove a provider accepts consent.
AUTHENTICATED_RUNTIME: UNVERIFIED: no real owner account or provider consent exercised; live save, token/header check, OAuth acceptance and execution require owner-performed proof.
KEYBOARD_FOCUS: PASS: structural drive verifies saved-confirmation focus, discard return, Escape, scroll keyboard input and reachable controls; assistive technology unverified.
ZOOM_REFLOW: UNVERIFIED: four viewport sizes exercised at DPR 1; 200 percent browser zoom not exercised.
REDUCED_MOTION: PASS: structural browser context uses reduced-motion preference; no production motion changed.
STATE_COVERAGE: PASS: local explicit-auth, unsaved cancel, persisted readback, failed save and retry, empty discovered catalogue and OAuth retry; automated tenant fencing, permissions and stale-generation paths retained.
TRUTHFUL_STATE_LABELS: PASS: registry remains PARTIAL; no successful provider check, owner approval or useful execution inferred from metadata or test data.
SOLO_UI: YES: Settings Integrations canonical shared connection drawer; no product UI source change.
UNVERIFIED: hosted preview, authenticated owner/runtime and account switching, live provider permission acceptance, real PAIGE/shell behavior, physical touch, assistive technology, browser zoom and production deployment. Structural tests cannot satisfy these claims.

OWNER_INTENT: Any Solo owner can connect a preset or custom server through the same explicit-auth journey; discovered tools still require individual approval and governed execution. This narrow slice repairs OAuth permission selection only.
MUST_NOT_HAPPEN: No provider-specific scope whitelist; no connection equals permission assumption; no provider action during render; no account authority derived from a URL; no credential or raw provider payload in evidence.
MUST_PRESERVE: Existing full endpoint, encrypted credentials/PKCE, owner/session/tenant/generation binding, callback return, token/header/none paths, approval invalidation, n8n specialized ownership, one PAIGE workspace and Settings taxonomy.
ACCEPTANCE_CRITERIA: Challenge scopes win; absent challenge scopes use resource scopes; absent both omits scope including inherited query scope. Registration, state and consent agree. Malformed/ambiguous metadata and wrong resource identity fail before registration. Streaming GET headers do not hang.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: Canonical OAuth start and shared SSRF fetch are affected and tested; callback scope/tenant binding consumed unchanged; chat, Connections, Calendar, billing, Rail/Action execution and tenant-context implementation untouched.

INTERNAL_BUILD_IDENTITY: 863f81c2b9fe1803323a6994595d62651b630d5c; deployment=none; environment=local development candidate on codex/mcp-oauth-resource-scopes; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record and exact candidate head/tree in PR. SHA identifies initial grounding baseline, not an executed production revision.
RELEASE_CHANNEL: development: local candidate only; no deployment performed.
RELEASE_CLASSIFICATION: patch: generic OAuth correctness repair, not delivery of the full MCP capability.
CUSTOMER_RELEASE_IDENTITY: none: authenticated outcome not established; no customer release version assigned.
RELEASE_NOTE_REQUIRED: no: internal candidate evidence, not customer-publication authority.
RELEASE_TRUTH_BOUNDARY: PARTIAL: canonical client selection repaired locally. PROOF OWED: real provider acceptance, owner permissions, authenticated account isolation and useful outbound execution. No LIVE claim.
RELEASE_RECOVERY: position=forward-fix or revert this isolated code patch before any further release; reference=this record; no migration or data conversion to undo.

SOLO_1536X770_PAIGE_CLOSED: PASS: 1536x770-light-closed-form.png and dark equivalent; structural drawer geometry, reachability and no document overflow.
SOLO_1536X770_PAIGE_OPEN: PASS: 1536x770-light-open-form.png and dark equivalent; placeholder dock geometry only, not real PAIGE runtime.
SOLO_1366X768_PAIGE_CLOSED: PASS: 1366x768-light-closed-form.png and dark equivalent; structural drawer geometry and scroll controls.
SOLO_1366X768_PAIGE_OPEN: PASS: 1366x768-light-open-form.png and dark equivalent; placeholder dock geometry and no horizontal overflow.
SOLO_1024X768_PAIGE_CLOSED: PASS: 1024x768-light-closed-form.png and dark equivalent; structural keyboard/scroll reachability.
SOLO_1024X768_PAIGE_OPEN: PASS: 1024x768-light-open-form.png and dark equivalent; placeholder dock geometry and reachable primary action.
SOLO_900X1000_PAIGE_CLOSED: PASS: 900x1000-light-closed-form.png and dark equivalent; structural no document overflow.
SOLO_900X1000_PAIGE_OPEN: PASS: 900x1000-light-open-form.png and dark equivalent; placeholder dock geometry, form fit and reachable save.

## Affected flow, ownership and collision packet

- Actor/entry: authenticated Solo owner/admin enters Settings -> Integrations, saves/reopens a preset or custom remote server and explicitly selects OAuth. A URL alone does not choose OAuth.
- Trigger/transition: canonical gateway resolves tenant/session and checks connection generation; guarded endpoint headers and resource metadata select permissions; registration and existing PKCE state bind the same set; provider consent returns through the existing callback. Owner cancellation or provider refusal is not success.
- Exit/retry: existing Integrations return, expiry and retry controls remain. Token, token-plus-headers and no-auth connections remain separate explicit choices. Account change clears/fences state through existing hooks and server checks, not new identity machinery.
- Scroll/focus: existing drawer scroll owner; no shell/navigation/CSS changes. Browser driver now waits for DOMContentLoaded plus actual control locators rather than global network idleness; HMR/font traffic previously caused a 30-second pre-interaction timeout. Assertions and success/failure port cleanup are retained.
- Domain: Integrations. Harness discovery/approval foundations exist but full governed execution is PARTIAL. Spine `integrations.list` and `integrations.health` still read broad channel connectors, so canonical health parity is UNVERIFIED and not claimed here. No Spine tool is added.
- Registry: `generic-remote-mcp` stays PARTIAL. Binding Ledger Integrations status is not promoted. This slice extends neither durable jobs nor Rail; connection alone grants no tool execution. Existing owner-only OAuth initiation and shared action approval gates remain.
- Collision gate: all 51 open PR file lists inspected before editing. No active overlap in this patch; config-registry overlap is only owner-parked #917/#754/#574. #1536 remains a live tenant-context dependency; #1599/#1600 own shared chat, #1044 shares the binding ledger and #1568 owns master-reference closeout. Those surfaces are untouched. Main advanced to 07c802308dfb8f0e8d2c82ff2e6e09bca9b48ca1 through #1598 with no patch overlap; refresh required before exact-head checks.
- Exclusions: no provider/owner-account probes, credentials, tenant data/config, database changes, migrations, chat execution changes, new stores, vendor branch, Connections/Calendar or unrelated cleanup.

## Root causes and deletions

The gateway requested the authorization server's broad `scopes_supported`, which may describe unrelated APIs. It now selects the Bearer challenge scope, otherwise protected-resource metadata, otherwise omits the parameter. Dynamic client registration, consent and encrypted pending state agree. It does not silently remove provider-advertised scopes merely because a provider rejects them.

Deleted: authorization-server-wide scope selection from canonical registration/state/consent; inherited authorization-endpoint query scope when omission is required; browser harness dependency on network-idle readiness. No legacy provider execution is deleted in this PR; that still requires proven canonical parity.

Independent review found three issues in the first candidate: an open SSE body could hang the header probe; advertised metadata could nominate another token audience; an authorization endpoint's existing scope query survived omission. Failing-first tests reproduced each; header-only abort/cancel, strict requested-resource identity and scope-query removal correct them. No third-party credentials are sent on discovery.

## Evidence index and limits

Commands (local exit 0 unless explicitly noted):

- `node scripts/mcp-oauth-smoke.mjs` — 84 assertions; includes wrong/missing resource, ambiguous/duplicate challenges, malformed scopes, root fallback, SSE and inherited scope-query cases.
- `node scripts/mcp-gateway-smoke.mjs` — 392 gateway assertions and 11 callback cases; actual handler through injected database/HTTP ports, not a provider deployment.
- `node scripts/mcp-transport-smoke.mjs` — 104; `node scripts/paige-n8n-ssrf-smoke.mjs` — 33; `node scripts/mcp-registry-provider-smoke.mjs` — 19.
- `npx vitest run src/solo/settings-integrations-gateway.test.tsx` — 115; `npx vitest run src/solo/data/useMcpGateway.tenant.test.tsx` — 36. No real-account fixtures added.
- `node scripts/live-drive/integrations-signin-render.mjs` — 258 PASS; screenshots/report under `scripts/live-drive/artifacts/shared-mcp/`; server port 5417 released after success. Harness cleanup uses its existing finally path; this patch does not change server ownership.
- `npm run ci:tsc` — 12 baseline / 12 current errors, no additions. `npm run build` — PASS, existing chunk warnings.
- Changed-file ESLint — FAIL on two inherited `no-explicit-any` findings in gateway OAuth dependency types; no new finding. Do not describe full lint as green.

Local artifacts/transcripts reside in `outputs/mcp-oauth-resource-scopes/`; they are not committed customer data. MCP HTTP smoke tests substitute DNS/transport to deterministic local servers. The browser mounts real SoloSettings and styles with synthetic tenant/network state and a reconstructed shell/dock, not the real authenticated shell chain. Therefore its four-view/eight-theme/open-state results prove structural regression only. No real owner connection was checked, re-keyed, disconnected or changed.

Impeccable source: https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md. Applied incumbent-preservation, focus/keyboard, reduced-motion and form-fit checks; no UI design edits. Native touch, screen reader and real dock are UNVERIFIED.

## Review and remaining outcome

Independent adversarial reviewer instances did not write the code. The initial review's three MAJOR findings were repaired and tested; a fresh review reported no new findings on the six-file implementation/test patch. The exact committed head and documentation require the final reviewer identity check recorded in the PR. Automatic Codex review is not counted as a pass or a gate.

Public provider metadata can itself advertise scopes its registration rejects. This generic correction alone is NOT proof that the reported LeadConnector consent error is fixed. Owner-approved credential/header connection, real consent, server-returned tool catalogue, individual revocation, governed useful execution, correct-business readback and duplicate-safe retries remain end-to-end proof obligations.

Shipped Delivery Log: N/A for this candidate; not merged. No deployment or production acceptance claimed.
