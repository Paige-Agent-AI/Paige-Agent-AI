# Gmail connection authority and atomic native persistence

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: preserve the existing Connections consent/return/disconnect flow; intended outcome and failing-first handler packet preceded product edits.
PAIGE_UI_DESIGN: PASS: retain Settings Connections Google control, person-chosen consent navigation, return page, status and disconnect presentation.
MATERIAL_FLOW_CHANGE: NO: repair the approved existing owner/admin connection contract; no new screen, provider, consent scope, inbox activation or customer choice.
FLOW_PROTOTYPE: NOT_REQUIRED: retain the approved existing connection flow, controls, geometry and exits.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: eligible existing and future SOLO workspace owners/admins manage Google through canonical server authority and native records.
VISUAL_DIRECTION: PASS: existing Settings/Connections; no visual/layout change.
AUTOMATED_EVIDENCE: PASS: 150 tests in five focused suites:82 actual-handler,32 actual-hook,26 mounted callback,10 incumbent OAuth return controls;34 actual PostgreSQL transaction checks. Earlier119 combined regressions overlap an earlier handler/hook checkpoint plus incumbent Connections/resolver/title-role controls; do not add the counts.
STATIC_EVIDENCE: PASS: native Deno4files, scoped ESLint9files, Spine214, SOLO SP1-SP5/negative controls, migration-version and whitespace checks; final committed UI grammar is recorded below. Full-app typecheck is not claimed green; the earlier checkpoint had seven diagnostics outside changed files without a fresh base comparison.
RENDERED_EVIDENCE: UNVERIFIED: no new pixels captured; incumbent Connections components exercised with synthetic data.
BEHAVIORAL_EVIDENCE: PASS: actual HTTP handlers/hook with neutral SDK/provider ports, plus real local PostgreSQL functions, actual canonical permission helpers and incumbent Vault bridge with fixture cryptography.
AUTHENTICATED_RUNTIME: UNVERIFIED: no live OAuth exchange, connection/disconnection or ordinary production customer drive.
KEYBOARD_FOCUS: NOT_APPLICABLE: no focus/input/presentation change.
ZOOM_REFLOW: NOT_APPLICABLE: no geometry/responsive change.
REDUCED_MOTION: NOT_APPLICABLE: no motion introduced.
STATE_COVERAGE: PASS: eligible owner/admin without global title; forbidden/missing/revoked roles; changed actor/workspace; invalid/expired/wrong-user/origin state; provider/config refusal; private/shared/foreign conflicts; partial/lost acknowledgements; audit failure; transactional rollback; actual concurrent collision/revocation; stale native disconnect; A-B-A/unmounted UI results.
TRUTHFUL_STATE_LABELS: PASS: provider consent, native persistence, audit confirmation and optional external revocation stay distinct. No native retry or 'nothing happened' claim after an uncertain acknowledgement.
SOLO_UI: YES: shared implementation for every eligible current/future SOLO account; no reference-account special case.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no authenticated connection viewport drive.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no authenticated connection viewport drive.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no authenticated connection viewport drive.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no authenticated connection viewport drive.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no authenticated connection viewport drive.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no authenticated connection viewport drive.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no authenticated connection viewport drive.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no authenticated connection viewport drive.
UNVERIFIED: Independent Review, exact-head hosted CI/full-schema Preview, deployed SQL/Edge parity, Google readiness/consent, paired ordinary customer QA, provider outcome, Live and owner acceptance.
OWNER_INTENT: restore complete governed Communications for eligible SOLO accounts using existing domain systems, truthful readiness and tenant isolation.
MUST_NOT_HAPPEN: no global title instead of tenant authority; no silent workspace fallback, stale consent URL, private credential overwrite, role fix, new scope, secret exposure, provider activation or send.
MUST_PRESERVE: canonical tenant-admin RPC/company exception; signed OAuth identity/workspace/origin/time/nonce; Google single-use code; existing Vault/connector/private-mailbox/provider-floor/audit contracts; full18/50 restoration scope.
ACCEPTANCE_CRITERIA: eligible owner/admin reaches the existing consent flow; native authority/privacy and credential+connector changes commit together; stale/forbidden/unknown results stay truthful; real production/provider proof remains separate.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: three Gmail handlers, canonical-RPC adapter, existing SOLO hook/callback reader, tests, one forward transaction over existing connector/Vault. Chat, Spine, configuration, production credentials, other providers and global source fingerprints are untouched.
INTERNAL_BUILD_IDENTITY: base=5590651737a50fe4cbea6572e228d9b9bcc73efa; branch=fix/ant21-gmail-workspace-authority; deployment=NOT_APPLICABLE; environment=development; migrations=PROOF_OWED(20271108200000 before endpoint release); edge=PROOF_OWED(native-first Gmail deployment and source readback); evidence=docs/evidence/ui-delivery/ant21-gmail-workspace-authority.md
RELEASE_CHANNEL: development: isolated source only.
RELEASE_CLASSIFICATION: patch: repair existing Google connection authority, native persistence and truthful recovery.
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or production release.
RELEASE_NOTE_REQUIRED: no: lead owns guarded release evidence.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: source/fixture success is not Google readiness, hosted connection/send or customer acceptance.
RELEASE_RECOVERY: position=reviewed forward fix or source revert without deleting connector/credential history; reference=isolated candidate based on5590651737a50fe4cbea6572e228d9b9bcc73efa

## Grounding and failing-first proof

The ordinary flow starts at `/solo/:account/settings/connections`. Settings evaluates
`is_current_user_tenant_admin()`, but all three native Gmail doors required global `has_role(admin)`.
The actual main559 handler refused an owner without that title; its otherwise identical global-role
control returned the local consent URL. Before product edits: **31FAIL/12PASS**. The hook's explicit
workspace/lifecycle tests then failed **14/14** before its change. Later review found credential
storage preceding private/shared/collision validation; **six actual-handler tests failed first** and
then passed with zero persistence on those deterministic refusal paths. All ports/data are neutral.
The exact old callback page then failed20/26 mounted tests (including one uncaught transport
rejection); the repaired reader passes all26. Six further disconnect-reader tests failed before
requiring explicit native completion facts and handling lost acknowledgement as unknown.

Edge checkpoints reuse fresh `Auth.getUser`, `current_user_tenant_id` and `is_tenant_admin_as`, with
expected-tenant guards and no account predicates. Separate reads are observations, not atomic
snapshots/future leases. Callback signed workspace must equal current authority; no primary-workspace
fallback. Existing signed nonce and ten-minute expiry remain; no durable nonce ledger/exactly-once
OAuth claim. The replay test covers mocked Google refusal of an already-used code only.

## Native transaction boundary

Forward migration200000 was CLI-scaffolded using installed2.109.1 and renamed locally to the lead's
reserved version above170000/180000/190000. It adds no table, role, backfill, provider or permission
model. `provision_gmail_connection` and `disconnect_gmail_connection` are service-only. Their private
actor adapter follows incumbent `_comms_email_actor` live-user/tenant/profile lock pattern and delegates
permission to existing `is_tenant_admin_as`, holding its membership/global-role sources. The existing
company exception is preserved and tested as source compatibility, not a product-tier comparison.

Provision serializes the normalized global email/address key and locks an existing connector. Its
privacy/collision/current-authority validation, existing `write_channel_secret` and connector write
are one transaction with actual returned-row checks. Concurrent personal-owner and other-provider
collisions cannot leave a losing credential overwrite. Disconnect validates exact connector version,
privacy and tenant/account Vault namespace, and atomically tombstones/disables. No direct Edge
credential/connector writer remains. Google consent/exchange/revocation is external and cannot be
rolled back by PostgreSQL. Optional revoke runs after confirmed local disconnect, with acknowledgement
reported separately; provider restriction never prevents a permitted local disconnect.

An actual PostgreSQL failing-first control found a changed email address with the same Google
account could otherwise address a second connector while replacing the original stable Vault key.
Both native doors now also serialize that stable identity; provisioning refuses another connector
referencing it and disconnect refuses an ambiguous legacy shared credential. Sequential and actual
two-session controls preserve the original private key. This does not migrate or delete historical
duplicate rows, invent an assignment model, or promise email-address renaming support.

Native lost acknowledgement remains unknown, is never retried here, and does not imply absence.
Known saved results remain saved if a later audit acknowledgement or scope check fails; private
details are withheld and original-workspace inspection is required. Audit is nonblocking and its
confirmation is separate. Edge/UI epochs retire stale/changed-user/A-B-A/unmounted results. The
existing callback page now uses the incumbent error-body reader for actual non2xx bodies and keeps
verified saved-but-withheld, unknown, refusal and success states distinct. No private result, toast
or redirect is released from former invocation effects; one in-memory consent invocation survives
StrictMode effect replay. It is not a durable nonce store, an automatic retry or an execution lease.
Legacy valid success and the allowlisted recorded return destination remain supported. Missing or
contradictory disconnect acknowledgements cannot become a successful UI claim.

## Proof, compatibility and remaining scope

- `node node_modules/vitest/vitest.mjs run src/lib/gmail-workspace-authority.contract.test.ts src/solo/data/useSoloComms.gmail-scope.test.tsx src/pages/GmailCallback.result.test.tsx src/__tests__/oauth-return-to-integrations.test.ts src/__tests__/oauth-return-strictmode.test.tsx`: **150PASS**, five suites. Neutral provider/SDK ports only.
- `OPERATOR_PROOF_PSQL=<installed psql> node scripts/proof/gmail-connection-postgres.mjs 65461`: **34PASS** on owned loopback PostgreSQL16, including actual two-session races and migration replay twice. The incumbent generic proof adapter is reused. Vault encryption is a fixture stand-in; actual bridge/body and SQL transaction semantics run. Full production schema/provider remain UNVERIFIED.
- Native Deno4file check PASS; scoped lint9files PASS; Spine214PASS; SOLO guard/all mutation controls PASS;1314 migration versions/no reuse; whitespace/syntax checks PASS. Earlier app `tsc` reported seven diagnostics in unchanged paths; the final full-app rerun was stopped after remaining long-running without diagnostics, not a PASS. No fresh base comparison or type-waiver claimed. Hosted required checks remain binding. The exact owned PostgreSQL65461 cluster was stopped and `pg_ctl status` confirms no server running.

The [installed Impeccable checks](https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md)
retain existing hierarchy, layout, semantic status and human-readable feedback. The mounted tests
exercise response/lifecycle behavior; they do not substitute for rendered viewport, physical focus,
real provider or authenticated customer evidence. `settings.connections` remains the incumbent
Binding Ledger surface. This is its existing explicit person-driven OAuth plumbing, not a new Chat
capability; governed email still uses `comms.email_send`. The current integration registry's
`google-workspace` entry describes Drive/Docs/Calendar, not a proven Gmail connection. A precise
Gmail connection/readiness anchor update in that existing registry remains a release-documentation
dependency for the lead; this slice does not invent or duplicate a provider registry.

Legacy callers omitting expected tenant retain server-derived scope; SOLO supplies it explicitly.
Backend inbox consent already exists; this does not activate its missing UI binding. Apple/iCloud
inbound management, platform/tenant SendGrid/domain cutover, SMTP/Twilio role siblings and actual
A2P/provider acceptance remain separate. Multiple existing Gmail connectors still require explicit
selection in the current UI/native preview; an ambiguous read fails closed. No capability/50-row
closure, new-account manual drive, Live completion, owner acceptance, provider send or production
credential change is claimed.
