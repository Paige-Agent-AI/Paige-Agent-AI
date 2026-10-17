# Gmail connection authority and atomic native persistence

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: preserve the existing Connections consent/return/disconnect flow; intended outcome and failing-first handler packet preceded product edits.
PAIGE_UI_DESIGN: PASS: retain Settings Connections Google control, person-chosen consent navigation, return page, status and disconnect presentation.
MATERIAL_FLOW_CHANGE: NO: repair the approved existing owner/admin connection contract; no new screen, provider, consent scope, inbox activation or customer choice.
FLOW_PROTOTYPE: NOT_REQUIRED: retain the approved existing connection flow, controls, geometry and exits.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: eligible existing and future SOLO workspace owners/admins manage Google through canonical server authority and native records.
VISUAL_DIRECTION: PASS: existing Settings/Connections; no visual/layout change.
AUTOMATED_EVIDENCE: PASS: 150 tests in five focused suites:82 actual-handler,32 actual-hook,26 mounted callback,10 incumbent OAuth return controls;55 actual PostgreSQL checks after the schema/canonical-fallback correction. The earlier34-check fixture and119 combined regressions retain their dated limits below; do not add overlapping counts.
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
UNVERIFIED: final composed documentation review, exact-head hosted CI/full-schema Preview, deployed SQL/Edge parity, Google readiness/consent, paired ordinary customer QA, provider outcome, Live and owner acceptance. Runtime/native source163090bc8 has the distinct NON-AUTHOR review recorded below; this does not assert review of subsequent documentation edits.
OWNER_INTENT: restore complete governed Communications for eligible SOLO accounts using existing domain systems, truthful readiness and tenant isolation.
MUST_NOT_HAPPEN: no global title instead of tenant authority; no caller-supplied or alternate signed workspace overriding canonical server scope, stale consent URL, private credential overwrite, role fix, new scope, secret exposure, provider activation or send. Preserve the canonical server's valid-profile/earliest-active-membership fallback for eligible existing and future accounts.
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
snapshots/future leases. Callback signed workspace must equal current canonical authority; never choose
an alternate caller or signed workspace after that comparison fails. This preserves the server resolver's
valid-profile/earliest-active-membership fallback. Existing signed nonce and ten-minute expiry remain; no durable nonce ledger/exactly-once
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
`google-workspace` entry describes Drive/Docs/Calendar, not a proven Gmail connection. The separate
`gmail` entry in that same existing registry now records the real connection/transport anchors,
scopes, native-first release dependency and PROOF_OWED provider boundary; its README and operating
report carry matching summaries. No provider registry is duplicated and no status becomes LIVE.

Legacy callers omitting expected tenant retain server-derived scope; SOLO supplies it explicitly.
Backend inbox consent already exists; this does not activate its missing UI binding. Apple/iCloud
inbound management, platform/tenant SendGrid/domain cutover, SMTP/Twilio role siblings and actual
A2P/provider acceptance remain separate. Multiple existing Gmail connectors still require explicit
selection in the current UI/native preview; an ambiguous read fails closed. No capability/50-row
closure, new-account manual drive, Live completion, owner acceptance, provider send or production
credential change is claimed.

## Independent runtime/native source review

The distinct `gmail_native_review` agent inspected the complete twelve-file change at exact
`36c24022f6c311226a677fc5177bea73c46e1388` against base
`5590651737a50fe4cbea6572e228d9b9bcc73efa`: **NON-AUTHOR Review PASS, no material findings**.
Freshly reran the five focused suites above (**150/150 PASS**) and the actual PostgreSQL proof
on a new owned loopback cluster on port 65466 (**34/34 PASS**), including real two-session collisions and
revocation, service-only ACLs, rollback, stable credential identity and stale disconnect versions.
The first Windows launcher was cancelled before native tests ran; the corrected launch ran the
proof and stopped that exact cluster, with `pg_ctl status` confirming no server running. No failed
attempt is counted as PASS. Vault cryptography remains a stand-in; no hosted schema, Google call,
credential, ordinary-account consent or provider outcome was exercised. Full-app typecheck and
hosted release checks are not certified by this review.

The same reviewer subsequently authored only the existing integration registry/README/operating
report and this evidence correction. Those documentation edits need their own final composed
review; they do not inherit NON-AUTHOR assurance from the runtime/native review above. Registry
validation checks 33 providers/all six taxonomy groups/117 resolving anchors; its existing 42
honesty/structure mutation controls and dead-anchor/glob controls pass. Other provider entries,
their eligibility/authority and pricing facts are preserved; no production state is changed.

## Required CI integration

The root integration adds the existing 34-check native proof to the existing required
`comms-provider-boundary` job, using that job's isolated loopback PostgreSQL service on port5432.
The incumbent fixture rejects that port outside CI, creates a uniquely named disposable database
and does not accept a remote URL or credentials. No new job, provider call or schema engine is
introduced. Hosted execution of this new named step remains PROOF OWED until its exact-head run
passes; local34 and source wiring alone do not supply that result. The150 focused tests continue
through the incumbent Vitest collection.


## Reviewed Planning/current-main composition — 2026-10-17 UTC

Automatic merges `e4ae0da07` and `40ded6a5389f51b0abf7bbf72eb2d4ccf03bb592` incorporate independently reviewed Planning `c0e14968f5460cde8c9d60bfb477cde62819ab70` and released main `dd27f5a5a47b0e19d1a1ad8967be2538e1f93669`; no manual conflict resolution or protected scalar renewal. Planning is now the unchanged unapplied191000 migration after applied Portal190000, with Gmail200000 retained afterward. Gmail SQL remains byte-identical to reviewed `9d41b07bb327e4d93a7544b0347fcabffaf1f090`, SHA256 `c1d753d88caf47720166346e68e076b564e53acfc164a2ac20c89664542f6b46`; Gmail runtime/tests and the original approval/privacy/unknown-result controls are preserved. Chat and the entire C0b guard equal reviewed Planning c0e; there are zero new dispatch or SOURCE proposals. Released main E01 ElevenLabs/TTS, Model/Claude/cache, recovery, Research and Portal source remain intact. Registry composition preserves the reviewed Gmail/Google Workspace entries and all other main provider entries, including ElevenLabs; no readiness claim is raised.

Fresh proof: **34 native PostgreSQL transaction/race checks PASS** (migration replay twice, actual two-session collision/revocation/refusal/rollback, fixture Vault crypto); **150 tests/five original actual-handler/hook/callback/OAuth suites PASS**; **1321 migration versions/no reuse**, registry33 providers/117 resolving anchors and42 honesty/structure mutations/dead-anchor/glob controls PASS. All commands exit0. Fresh owned PostgreSQL16 listened only on127.0.0.1:65468 and stopped, exit0. No provider request, credential, production connection, customer mutation, browser capture or actual authenticated QA ran. Private native log SHA256 `13f7d0e12f4739a0be3e96c6ac415c6de4a6d113158e1c0ff47e4029d6457ac7`; focused log `5393d3b0e5d4171083294eece8a6a1566242300aef968c327c4291ae8c1ca186`, under `work/gmail-composition-20261017`.

Distinct exact-head composition review and fresh hosted CI, native-first production200000/source readback, actual ordinary Google consent/connection/revocation, governed send/provider outcomes, separate inbox binding, paired authenticated SOLO/Live and owner acceptance remain **PROOF OWED**. This is source-safe release preparation for every eligible existing/future SOLO account, not account-specific activation or18/50 completion. No push/production release is claimed here; Section4.0 Shipped Log remains N/A until merge. Dated source/proof histories above are unchanged.


## Material schema and canonical-fallback repair — 2026-10-17 UTC

Fresh review findings4300025081/4300025089 are real in prior84673e5b, which remains unreleasable. Its earlier34-check native fixture incorrectly modelled production mailbox_scopes as text[] and refused a missing profile. Those genuine fixture passes did not establish the actual production-schema/canonical-fallback contract. Source correction `163090bc8f0c1e98d313cd9cb5a4716bada78630` changes only the still-unapplied200000 migration and incumbent native proof; this evidence is its docs-only successor. No existing endpoint, provider scope, frontend, public ABI, grant, C0b scalar, shared Chat/Spine or other lane source is changed.

Read-only production metadata captured2026-10-17T02:54:56.268Z confirms mailbox_scopes JSONB NOT NULL DEFAULT[]; nullable timestamptz joined_at; default READ COMMITTED; server17.6; and the exact current_user_tenant_id definition from20260714144656. Private source packet SHA256 `28115b782dbfc21359f87f7139b92420029e30e9b6c0c49e82ba32ddfd535e16` contains schema/function metadata only, no customer rows or secrets. Native fixture is explicitly PostgreSQL16 with selected actual functions and fixture Auth/agency/Vault ports; it is not hosted17/full-schema/provider proof.

Failing-first actual PostgreSQL evidence: original846 migration with the actual JSONB fixture failed42804 on an ordinary save (`before-jsonb.log`, SHA256 `3224ee72826d0d1feedef0f2deec9a464a68d04ebb2c267d93f1808d687712e4`). After only JSONB conversion, fresh/reconnect/nonempty/null/empty scope controls passed, then actual authenticated-role canonical resolution returned the fallback tenant while old native code refused42501 (`before-fallback.log`, SHA256 `caa81e3be580e3ff3f9066a8cfbe3bbe76d4d25bd59c56aa578f654b1e9b9b71`). Both failed clusters were stopped; failures are retained without claiming a production attempt. Private pre-fallback SQL/proof snapshots remain beside those logs.

The existing insert, update and authoritative readback now use to_jsonb(coalesce(_granted_scopes,ARRAY[]::text[])), preserving the service-only text[] input ABI and canonical JSON array storage. The private actor guard mirrors the exact valid-profile/earliest-active-membership COALESCE rule for the already-authenticated actor parameter. It never changes auth.uid/JWT claims or creates a public actor resolver. Existing live-user, target-business, profile, membership and role source locks remain; existing actor memberships lock in stable tenant-ID order before resolution. Canonical is_tenant_admin_as remains the final permission gate, including only its original company-workspace exception. Scope selection alone never grants customer authority.

The same guard re-reads canonical scope after advisory/connector waits immediately before Vault and connector writes. Existing source-row revocation/changes remain serialized. Missing/new profile and membership rows are statement-snapshot changes, not a global workspace freeze: a new earlier membership committed before the recheck refuses the stale target; an overlapping insertion after admitted writes may linearize afterward. Actual interleavings prove both and keep all connector/Vault effects in the original authorized tenant. Existing Edge pre/post canonical checks withhold later changed-workspace results; native proof does not claim those browser checks were authenticated. No broad table lock, stronger isolation setting, automatic retry, cross-tenant credential effect or blanket future-authority guarantee is introduced. [PostgreSQL snapshot semantics](https://www.postgresql.org/docs/16/transaction-iso.html) and [row locks](https://www.postgresql.org/docs/16/explicit-locking.html) support that bounded contract; the actual tests below establish the exercised schedules.

Final **55 actual PostgreSQL checks PASS**, exit0: real JSONB fresh/reconnect/nonempty/null/empty scopes; native insert and reconnect readback-failure rollback of both connector and credential; actual canonical null/missing/invalid/valid profile and earliest-active/revoked-first/no-member/member-only behavior; explicit platform-role/customer refusal; source/advisory waits, revocation/order changes, earlier-membership/profile insertions and permitted overlapping snapshots; original foreign/private/shared/stale conflicts, replay/ACL, company-source exception and disconnect/rollback controls. Final log SHA256 `41d132ce28ca5075691ab269edfb57b812dcd1c7753b1a23590d03ea2895bbde`, under `work/gmail-material-findings-20261017`; owned fresh loopback65468 PostgreSQL was stopped. New200000 SQL SHA256 `f4be55eb9b779524db9a349933d17f14f6f7cbaf70120f5dc031e07a40daff78` supersedes the defective unapplied c1d753 body, never an applied migration.

The original **150 tests/five handler/hook/callback/OAuth suites PASS**, exit0, after the native correction. Native-proof scoped ESLint, syntax, whitespace and migration1321/no reused version PASS. Existing Planning191000 order, shared tenant-neutral implementation and canonical provisioning contracts remain; eligibility differences still follow actual role, workspace, tenant status, consent and provider readiness. This repair applies to every eligible existing/future SOLO account, with no account IDs or replacement tenants added. Root separately inspected source/native proof at exact `163090bc8f0c1e98d313cd9cb5a4716bada78630`: **NON-AUTHOR source review PASS, no material finding**; the implementing agent's own checks are author validation. Final documentation/composition review and fresh required CI/full-schema checks remain owed before push/release. Production200000 application/source readback, actual Google/ordinary paired SOLO/new-account/Live and owner acceptance remain **UNVERIFIED**. No production DDL, provider, secret, consent, email or customer-record action occurred. Core/human must later compose this reviewed200000 successor before release; their worktrees were not edited. All18/50 program scope remains intact; Section4.0 Shipped Log is N/A until merge.
