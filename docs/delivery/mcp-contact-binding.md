# Incoming contacts: fixed-business contract (draft, not released)

## Identity and owner intent

Repository: Paige-Agent-AI/Paige-Agent-AI. Base: `cfcdc62001e677816dba4a4c915788ed117a65ff`, tree `81795d8c14f5508f21d03152c9f2a9dfe9e7270d`. Branch: `codex/mcp-contact-binding`. Exact review head is recorded in the PR; no deployment or customer release is claimed.

Owner ruling, 2026-09-30: incoming contact sync is required; provider data must land in its connection's business, independent of the person's open workspace. This draft implements the transactional boundary first. It is NOT the completed owner journey or the completed MCP objective.

## Affected flows and collisions (pre-edit gate, refreshed before publication)

### Owner-approved UI continuation, 2026-09-30

The owner approved the read-only incoming-contact prototype with “You have my approval.”
Approved artifact SHA-256: `DEC245DA605622F2DCD2F7744C3F8C8444F50D9B2483800052100A909ACB5703`
(33,906 bytes; `outputs/mcp-incoming-contacts-flow-prototype.html` in the task's artifact directory,
outside the product checkout). This is design/function approval, not production acceptance.

Fresh pre-edit recheck: main remains `cfcdc62001e677816dba4a4c915788ed117a65ff`; draft #1595
remains `7c86a3107f7f4863158a73ee16e2b8c53b1b7465`. All 51 open PR heads/file sets enumerated.
Settings UI/config-doc overlaps are the expressly parked #917/#754/#574; bridge overlap is parked
#585. The new UI/hook files have no active collision. #673 owns shared Connections harness
transport: it is consumed unchanged, not edited. A separate test-only alias layers the incoming
transport on the existing real Settings/shell mount. No product shell, Calendar or Connections
file is changed. #1591's earlier migration and #1536's tenant-context dependency remain live.

Affected owner flows (this subsection supersedes the earlier UI-not-implemented snapshot below):

- Enter an existing Integrations drawer or add an incoming-only canonical connection. Read
  its current grant and business; never derive scope from the route or a provider name.
- Enable create/update with a dedicated owner-entered credential and explicit consent. Read
  the same committed generation afresh before saying Saved; no outbound approval follows.
- Replace/revoke using expected-generation comparison. Preserve contacts and outbound approvals;
  warn that the old incoming credential stops working and the sender must be updated manually.
- Failed reads remain unavailable, not off. Configured-but-inactive permission stays distinct
  from effective access. Legacy writer refusal is explicit; no provider-name legacy inference.
- Dirty cancel/close supports keep/discard. Close during a request does not claim server
  cancellation; unresolved writes survive drawer reopening. Unknown creation never auto-retries.
- Account/user/loading changes synchronously remount the scoped section; secret drafts disappear
  and stale read/write completions are rejected. The server still owns authorization and binding.
- Sender setup exposes only safe connection reference/version and request placeholders. It sends
  nothing, reads no secret, and warns against unreviewed existing-source identity migration.

Routing answers: (1) outcome is incoming contact connectivity; (2) Integrations owns configuration,
Clients owns contacts; (3) existing Harness tenant/capability resolution, no new authority engine;
(4) Spine chat-import capability remains UNAVAILABLE, not invented; (5) generic-remote-mcp canonical
registry, n8n specialized; (6) authenticated `mcp.connections.manage` plus explicit bounded incoming
grant, no budget or model execution authority; (7) existing receipt transaction, no new job bus;
(8) safe generation/readback, never credential/payload; (9) existing Integrations drawer, binding
ledger remains with its active owner; (10) authenticated owner configuration and owner-run sender
proof are owed separately from local mock/browser/disposable-database evidence.

Flow-by-Flow requires the complete state/exit proof before a green draft. Impeccable and the Paige
UI standard constrain the extension to incumbent Mineral/Obsidian tokens, compact 432px drawer,
one visible scroll owner, focus return, reduced motion, and exactly one existing PAIGE workspace.
No prototype fixture logic is ported as product data. Migration content remains unchanged.

1. **Configure:** authenticated Solo owner/admin enters Integrations for their server-resolved business and enables incoming contact create/update on its canonical connection. Expected-generation comparison refuses stale saves. Safe readback exposes grant/credential presence, never a secret. A new incoming-only record has no invented outbound endpoint. Owner-facing controls are implemented in this draft; local rendered proof is separate from authenticated production acceptance, which remains BLOCKED.
2. **Receive:** an external sender presents its per-connection credential, connection reference, generation, stable event UUID, external contact ID and source timestamp. Neither target business nor owner may come from the request. Contact, addresses, optional assignment, external identity and safe receipt commit together. Same event/payload replays the existing receipt; changed content under that ID is refused. Older source data is refused. A lost acknowledgement retries the same event, never a fresh event to guess success.
3. **Revoke/rotate/disconnect:** owner updates the generation under a row lock. Waiting writers re-check the committed credential/grant; old credentials cannot write. Grantor suspension/demotion also refuses new events. Re-enabling a connection does not restore a cleared incoming grant.
4. **Switch/leave/retry:** an owner's active business is never the ingestion target. Wrong-business configuration calls fail. Dirty cancellation requires keep/discard, clears discarded credentials, and does not dispatch a write. Account changes discard the old drawer and reject late completions. Unconfirmed saves require a fresh read and a deliberate new attempt against the current generation, never automatic resubmission. Unconfirmed creation requires record inspection and explicit separate-source intent before another creation. Paige read/import from MCP through the shared governed tool path is still owed; this inbound sender contract is not a shortcut for Paige to grant herself authority.

Dependency/regression map: existing canonical `mcp_connections`, management capability/resolver, contact-method validators/writers and tenant constraints, assignment stamping/RLS, existing MCP receipt stream, bridge router/rate limiter, real PostgreSQL proof runner and existing Linux database-contract entrypoint. No second tenant lookup, connection store, scheduler, secret store, receipt stream, chat workspace, memory or authority engine.

Collision audit enumerated all 50 open PR heads/files. #585 is owner-parked, not incorporated. Contact-method work is already on this base. #1536 remains a live tenant-context dependency; re-run switching proof if it lands. #1591 owns pending migration `20270521000000_operator_authority_in_company_workspaces.sql`; this draft's timestamp follows it. #1591/#1556 workflow files, #1044 binding ledger and #1568 master-reference closeout are untouched. Settings shell, Communications/Calendar, Marketplace, other tiers and provider execution remain untouched.

## Capability routing

- Outcome/domain: Integrations supplies safe incoming connectivity; canonical Clients owns contact/address/assignment records.
- Shared Harness: existing tenant/capability resolution and receipt machinery. No new Action Bus or confirmation path. Owner configuration grants a bounded external-sender operation; it does not grant Paige arbitrary write authority.
- Spine: incoming-contact capability key is UNAVAILABLE; no fabricated registration or chat reach claim.
- Provider: `generic-remote-mcp` entry updated. Provider tiles are conveniences; no vendor branch. n8n remains specialized.
- Authority: `mcp.connections.manage` for human grant/rotation/revocation; service-only incoming writer validates the connection-specific credential, generation and live grantor capability. No billing/spend authorization.
- Durability: one PostgreSQL transaction and existing receipt idempotency; no new job queue. Governed outbound work/leases/reconciliation remain separate unfinished objective work.
- Readback: committed contact ID/action plus replay bit, safe optional-phone warning. Raw contact data/credential never enters the receipt. No new Rail publication is claimed.
- Visible surface/binding ledger: the existing Integrations drawer owns the approved incoming configuration path; no new shell, store, or row-state upgrade. Actual authenticated/runtime proof is still owed, not inferred from database or synthetic-browser tests. The binding ledger remains with its active owner.

## Contract and deletions

Migration `20270522000000_mcp_connection_contact_binding.sql` adds canonical connection grant metadata, a tenant-constrained external-contact relationship, idempotent receipt index, lifecycle trigger and four explicit RPCs. No backfill, provider call, automatic credential issuance, tenant configuration or existing grant occurs during apply.

Deleted: owner-email/active-workspace destination resolution for `upsert_contact_mirror`; global-key fallback for that verb; cross-business assignee lookup in that branch; multi-request partial contact/address/assignment writes; duplicate contact validation in the router. Existing bridge ingress cap is shared, not removed. Unrelated legacy verbs remain unchanged and are not certified by this work.

The `ghl_contact_id` input is only a compatibility spelling of external_id, not vendor-specific routing. No existing legacy external ID is silently assigned to a connection. Legacy sender transition, including contacts whose email changed, must be reconciled with the owner before cutover; an email match alone is not proof of source identity.

## Backend proof history and limitations

- Failing-first: missing `create_mcp_inbound_connection` on the baseline (SQLSTATE 42883, exit 1); missing-name adapter test failed before its fix; restored legacy mirror constraint fails with SQLSTATE 23514.
- Disposable PostgreSQL: `node scripts/proof/mcp-oauth-database.mjs`, 15 proof groups PASS. Real canonical permission helpers, address writers/table constraints, provenance constraint, stamping trigger and assignment policy are used; unrelated dependency shapes remain minimal, NOT a full production schema replay.
- SQL proves actual resolver business B while sync commits business A, same-business assignment manageability, cross-business denial, partial-name/address preservation, event replay/conflict/stale source, atomic rollback on forced assignment failure, and real two-session replay/revocation barriers.
- Focused Vitest: contact methods, contact Request/Response adapter, existing gateway UI and tenant hook suites; final counts recorded in PR. HTTP tests use a mocked RPC and are not database execution evidence.
- TypeScript ratchet: existing baseline/current 12/12 before final verification; no baseline rewrite. Production frontend build PASS, 5185 modules. Whole bridge-file lint retains five independently compared pre-existing errors; newly changed adapter/test code lint passes. No dependency upgrade is absorbed.
- Independent non-writer review found provenance constraint and assignment-tenant defects; both fixed with executed proofs. It also identified owner/sender cutover as a release blocker and missing rate limiting as a regression; cap restored and refusal tested. Final immutable-head review is still required.
- Local transcripts: `outputs/mcp-oauth-database/run-ZSiiFn` (15 PASS), `run-T518lq` (expected negative control), `run-sQfCE1` (baseline refusal). Successful and failed runners verify their owned database port stops. These contain only synthetic disposable data and are not product records.
- Linux exact-head full-schema CI, preview, authenticated owner setup/revoke, real sender cutover, production sync and shared-governed Paige import are UNVERIFIED. No real account, provider or production write was exercised.

### Fresh release recheck and database-proof correction (2026-09-30)

At `485a83cb46ef76b4eb9a445a94aad115d914c718`, Linux `verify`, Security Audit,
migration lint, Spine contract, web-fetch smoke and Supabase Preview passed. The
database-contract job failed at `mcp_connection_contact_binding.sql:52`: the fixture
changed an existing profile's active business before granting membership there.
The canonical `guard_active_tenant_membership` correctly refused it (42501).
Image-pull throttling earlier in the job recovered; it was not the failing step.

The disposable runner now loads the real membership guard and trigger. An existing
profile in the initial business reproduces Linux's UPDATE path. Failing-first run
`outputs/mcp-oauth-database/run-N9Hypz` reproduced 42501 and stopped its owned server.
The corrected fixture first proves an unauthorized switch is rejected, then adds
real membership and switches. `run-4VtmPZ` passed all 15 PostgreSQL groups, including
fixed-business ingestion and concurrent replay/revocation. No production guard,
migration, provider or workflow was changed. Fresh Linux proof is still required.

The recheck enumerated 51 open PR heads/files. Direct overlaps remain only the
owner-parked #917/#754/#574 config documentation and #585 bridge router. #1591 is
still open at `a958a41ca38e7ffe4c3c318a80c9de82080d1c52`; its earlier migration is
not recorded in production. Main remains `cfcdc62001e677816dba4a4c915788ed117a65ff`.
At that historical checkpoint, owner setup/prototype and sender transition were
missing, so the UI evidence guard correctly failed. The prototype has since been
approved and the owner UI implemented; current evidence is recorded separately in
docs/evidence/ui-delivery/mcp-contact-binding.md. Authorization does not turn missing
authenticated configuration or sender-transition evidence into a pass.

## Release hold and migration authorization

Keep DRAFT. Do not deploy the bridge replacement without a working authenticated owner configuration path and prepared sender transition. Schema authorization alone does not waive this hold or grant production data/configuration writes.

Production's newest applied migration was read live as `20270520000000_mcp_connection_header_bundle` on 2026-09-30. Pending #1591 has `20270521000000`; sequencing must preserve it before this draft's `20270522000000`. Refresh open migrations and production ledger immediately before any release. Never use `--include-all` or renumber another lane.

Reversibility: additive schema before use can be removed by a separately reviewed/named rollback, but no rollback is supplied or authorized. After contact events exist, deleting the map/receipt history is not a safe lossless rollback; retain evidence, revoke incoming grants through the normal authorized path and forward-fix. Never revert the bridge to active-workspace/global-key contact routing. The exact migration SHA-256 and source PR are supplied in the owner authorization package, not inferred from this document.

Shipped Delivery Log: N/A — this draft has not reached main. Binding ledger/master-reference files remain with their active owners. No Register is written. Remaining legacy naming and unrelated bridge attribution debt are separate routed findings, not absorbed here.
