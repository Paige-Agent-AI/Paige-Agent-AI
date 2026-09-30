# Canonical MCP supplementary credential bundle

2026-09-29. Base: `9d2dd0cc4a6fdc3cae1fef15e1def0cea8eb029f`.
Branch: `codex/mcp-connection-header-bundle`. Exact published head/checks belong to the PR record.
This is a bounded backend contract slice, **not delivery of the owner-facing connection journey**.
No production migration, merge, provider call, credential handling or customer-data write occurred.

## Affected flow and collision packet

Solo owner enters Settings → Integrations from a preset or custom-server entry. The approved journey
is explicit authentication → persist → safe readback → check/discover → individual approval/revoke →
governed use. This slice extends only canonical persistence/transport/readback and credential lifecycle.
The UI consolidation, OAuth entry behavior and authenticated end-to-end proof remain owed.

The existing `mcp_connections` encrypted bundle, server-resolved tenant/manage capability, writers,
service-only loader, transport, probe generation and approval records remain the single authority.
No new secret store, tenant resolver, worker, approval store or PAIGE workspace is created.
Rejected saves preserve the old record; re-key invalidates old tools/approvals; disconnect scrubs
headers; stale probe/OAuth completion refuses. Browser cancellation, focus and account switching
are unchanged; existing rendered/tenant regressions are supporting proof, not authenticated proof.

Before editing, all 56 open PR heads and changed-file sets were enumerated. No active MCP contract
file collision was found. Parked #917/#754/#574 remain untouched. #1536 remains the live tenant-context
dependency and requires renewed switching proof after it lands. Shared settings CSS, shell, calendar,
contacts, chat and workflow implementations are untouched. No workflow/configuration edit.

## Contract and deletions

- Add `custom_headers_ct` to the existing encrypted connection, not plaintext provider state.
- Validate at SQL writes and transport: at most 16 entries; name ≤64 ASCII token characters;
  value 1–4096 printable ASCII characters without outer whitespace; total ≤16384 bytes.
  Reject case-insensitive duplicates, primary-auth collisions, protocol/routing/session overrides.
- Server-only loader decrypts; every handshake, discovery, call and session cleanup uses the bundle.
- Readback/acknowledgement adds address/credential presence, header count and persisted generation.
  No endpoint path, header name/value or token is added to browser-readable metadata.
- Header identity changes bump configuration generation. Re-key clears tools/approvals;
  explicit OAuth completion also clears old consent/catalog atomically after validation.
  Automatic OAuth refresh is not changed by this slice.
- **Deleted:** old create/set SQL overloads; one replacement signature per operation retains old
  callers via a defaulted trailing JSONB argument. No wrapper/parallel writer remains.
- Legacy Zapier execution is **not deleted here**: parity and governed production proof precede
  that separately required cutover. Provider-name OAuth routing and duplicate forms remain next.

## Executed evidence

| Evidence | Result | Boundary |
|---|---|---|
| Failing-first transport | PASS | New tests failed because headers disappeared and malformed bundles were accepted. `outputs/header-transport-red.txt`. |
| Failing-first SQL | PASS | Existing writer rejected `_custom_headers` with SQLSTATE 42883. `outputs/header-database-red.txt`. |
| Failing-first reflection | PASS | Two added reflection cases failed before correction. `outputs/header-gateway-red.txt`. |
| Transport | PASS | `npm run smoke:mcp-transport`: 104 assertions, exit 0; local socket server, no external provider. |
| Gateway/callback | PASS | `npm run smoke:mcp-gateway`: 384 assertions + 11 callback cases, exit 0. |
| Egress/OAuth | PASS | `smoke:mcp-egress`: 88; `smoke:mcp-oauth`: 63; exit 0. |
| Existing rendered/tenant regressions | PASS | Eight Integrations/MCP test files, 229 tests, exit 0. jsdom, not authenticated browser. |
| Disposable database | PASS | `node scripts/proof/mcp-oauth-database.mjs`: 11 groups, actual canonical crypto/writers/roles, original create/set/OAuth SQL suites plus new header contract, concurrent callbacks, exit 0. |
| Database cleanup | PASS | `outputs/mcp-oauth-database/run-UMohi3/report.json`: `stopped:true`; loopback port closed. Minimal unrelated schema, not full Supabase replay. |
| Deno | PASS | `deno@2.9.6 check --allow-import --node-modules-dir=none` on gateway and callback, exit 0. Initial unavailable npm version was a tool setup failure, not a code result. |
| TypeScript ratchet | PASS | `npm run ci:tsc`: baseline 12/current 12, no new diagnostics. |
| Build | PASS | `npm run build`, exit 0; inherited large-chunk warnings. |
| Registry/migration/authority lints | PASS | integration registry, migration versions, DEFINER ACLs and managed-schema ownership pass. |
| Broad changed-file ESLint | FAIL | Five inherited `no-explicit-any` findings; same five reproduced with `git show origin/main:<file>` piped into ESLint. No new findings; not waived. |
| Dependency audit | FAIL | Five inherited advisories: 1 high, 4 moderate. No package/lock change. Existing four recorded at #1565; undici 7.29.0 / GHSA-3wwx-pv8p-q78v filed separately as #1587. No upgrade absorbed. |
| Full Windows suite | FAIL | 6070 pass / 9 fail. Four load-sensitive timeouts pass on isolated rerun (41 tests / 3 files); five Unix-command/POSIX-path test failures filed as #1588. All affected test/product files unchanged from base. No claim of a fresh full baseline run. |
| Exact-head CI / preview | UNVERIFIED | Fresh results must be read from the published head; local proof is not a substitute. |
| Owner browser / provider / production | UNVERIFIED | No real Solo account opened, changed or probed; no external OAuth consent or execution exercised. |

The SQL tests prove encrypted roundtrip, safe readback, failed-write rollback, cross-tenant refusal,
approval invalidation, header-only generation fencing, stale probe/OAuth rejection, explicit OAuth
replacement, disconnect clearing and old-caller compatibility. Native Linux database CI reaches the
new contract through its existing `mcp_gateway_connection_create.sql` entry; no workflow fork added.

## Independent adversarial review

Reviewer `credential_contract_review` is a separate agent and **did not write the implementation**.
Two MAJOR findings were fixed: literal punctuated short-value reflection and OAuth credential
replacement retaining old consent. Re-review found no remaining BLOCKER/MAJOR in the credential
diff. Reviewer inspected source and execution artifacts, not an independently rerun provider session.
Automatic Codex review is not claimed and is not a gate.

Reflection filtering is defense in depth, not a guarantee against encoded/covert exfiltration.
Short configuration values use literal boundary matching to avoid rejecting `customers` because
of a region value `us`. No raw provider output is newly made customer/model-visible.

## Named migration authorization required

`20270520000000_mcp_connection_header_bundle.sql`

SHA-256: `E5E7DF64108A9AA4183C886991E3F0B6B876A2173D33A62A39968AD8320F40B1`.

Production newest applied version read live on 2026-09-29: `20270518000000_public_form_intake`.
Re-read the full pending set immediately before any eventual authorized merge; this snapshot is
not authorization and must not be reused after drift.

Reversibility: function definitions/signatures can be restored, but dropping the new column after
owners save headers destroys those values. Therefore rollback is **not data-reversible** without
an encrypted backup/re-entry; forward correction is preferred and production changes require the
owner's named written approval. No production application is authorized by this document.

## Remaining finish-line work

One shared owner-facing preset/custom form; explicit auth choices; honest save/readback/check;
OAuth new-tab/cancel/retry proof; individual approval/revoke usability; authenticated account-switch
proof; shared governed outbound execution with durable work/idempotency/leases/readback/reconciliation
and sanitized Rail; canonical parity; legacy Zapier deletion; all-Solo production proof.
No completion, production acceptance or final settlement is claimed.
