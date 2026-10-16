# Native reminder claim and interrupted-delivery safety

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: existing scheduled-reminder flow; native Planning record → Vault-authenticated worker → existing notifications/provider boundary. Same-domain worker correction; no replacement scheduler, store, approval or receipt engine.
PAIGE_UI_DESIGN: PASS: project UI skill and routed protected-behavior/release requirements applied; no interface, tokens, controls, layout, copy or navigation changed.
MATERIAL_FLOW_CHANGE: NO: restore existing cancel/snooze intent and uncertainty handling inside the incumbent worker; no new customer journey or execution authority.
FLOW_PROTOTYPE: NOT_REQUIRED: logic-only correction to the existing worker, no new or materially changed interface flow.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a business member cancels or postpones scheduled work; an old due snapshot must not deliver it or overwrite its new state.
VISUAL_DIRECTION: NOT_APPLICABLE: no UI source or presentation change.
AUTOMATED_EVIDENCE: PASS: actual full worker callback executes through protected data ports;22 worker/config tests plus31 existing Chat Planning tests pass. Original13-case run retained with9 failures; three additional malformed-claim cases were red before the acknowledgement check. The release-setting control failed before explicit incumbent authentication configuration was added.
STATIC_EVIDENCE: UNVERIFIED: scoped ESLint and whitespace pass; final-head hosted checks and deployment remain required.
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered interface or geometry changed; no screenshot or visual-runtime claim.
BEHAVIORAL_EVIDENCE: PASS: protected actual-source controls cover two neutral tenant contexts, normal delivery, cancellation/completion, snooze/version/scope changes, authorization refusal, uncertain writes, conditional cleanup, reader outages and provider refusal. These are synthetic data ports, not real PostgreSQL/HTTP/browser acceptance.
AUTHENTICATED_RUNTIME: UNVERIFIED: no production schedule, notification, external communication or provider action executed. Ordinary protected domain and paired SOLO acceptance remain owed.
KEYBOARD_FOCUS: NOT_APPLICABLE: no controls or focus behavior changed.
ZOOM_REFLOW: NOT_APPLICABLE: no layout or responsive change.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: source-level ordinary due work, stale/refused claim, confirmed database refusal, ambiguous dispatch, changed successor and unavailable member read; deployed and authenticated states remain unverified.
TRUTHFUL_STATE_LABELS: PASS: malformed claim replies cannot authorize dispatch; ambiguous notification writes retain their claim and expose outcome_unknown. No provider delivery, full recovery or customer acceptance is claimed.
SOLO_UI: NO: backend-only worker; applies to every eligible existing/future SOLO account through shared code, no account selectors or interface fork.
UNVERIFIED: exact-head CI, source review, deployed source, genuine domain records, PostgreSQL concurrency/transport behavior, authenticated customer/isolation/recovery and owner acceptance remain required. This does not complete the18-capability/50-row restoration.
OWNER_INTENT: Owner P0 restoration and October15 Universal SOLO Product Coverage directive in ANT-21/ANT-147; preserve native records, authorization and truthful execution for all eligible accounts.
MUST_NOT_HAPPEN: A canceled/revised snapshot delivers; an ambiguous INSERT is automatically replayed; an old cleanup/metadata write clears a successor; a reader outage is called an empty team; provider execution is enabled to pass QA.
MUST_PRESERVE: Native Planning RPCs and scheduling consent, plan_items/notifications, Vault verify_cron_token, existing JWTfalse configuration, Comms provider gate, sender/API configuration and all INT346/role/release restrictions.
ACCEPTANCE_CRITERIA: Confirm normal protected reminder records persist and deliver once; cancel/snooze before claim prevents dispatch; unknown notification outcome remains held without a duplicate; new schedules survive stale cleanup. Verify ordinary customer behavior and record readback separately before closing the defect/capability.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: Native conditional record/version claim, single-statement refusal classification and cleanup ownership tested in actual-source fixtures; roles, provider boundary, Chat admission, stored approvals and Spine declarations unchanged.
INTERNAL_BUILD_IDENTITY: 489f830377e6c51050d10ff7b7278e7af3298084 grounded main; exact candidate head recorded in PR; deployment=NOT_DEPLOYED; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(plan-reminder-cron candidate not deployed); evidence=this record and src/__tests__/planning-reminder-worker.test.ts
RELEASE_CHANNEL: development: candidate source only; ordinary reviewed production release/readback required.
RELEASE_CLASSIFICATION: patch: native reminder concurrency and uncertainty correction.
CUSTOMER_RELEASE_IDENTITY: none: bounded restoration increment does not establish a complete customer outcome.
RELEASE_NOTE_REQUIRED: no: no customer publication or announcement.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: production source and authenticated records/recovery; full secure Chat activation remains separately held.
RELEASE_RECOVERY: position=reviewed forward correction preserving held claims; reference=original notification/Planning readback before any retry, never clear claims by elapsed time or weaken provider/auth gates.

## Scope, contracts and source collisions

The BUG lead owns this bounded worker/test change. Before edits, deployed `plan-reminder-cron`68/existingJWTfalse and both packaged files matched main exactly. Production metadata confirms `plan_items.updated_at` is NOT NULL; no new schema, tenant backfill or provisioning variation is required. Existing Planning producers remain the writers. Operations PRs2189/2161/2153 file inventories have no overlapping worker or approval-outcome edit. Shared-framework, Portal and E1 source remain untouched.

The worker rechecks tenant, item type, native record version, nonterminal status and due time in its original conditional UPDATE. Its native acknowledgement must identify the same record and a usable server version. Every subsequent plan-state/metadata write matches that acknowledged claim. Known pre-dispatch failure or an answered single INSERT refusal may release only the unchanged claim; an ambiguous/thrown notification response cannot invite a blind repeat. A member-reader error remains an error rather than canceling work as undeliverable.

`databaseAnswered` is the existing shared classifier, not another permission or outcome system. No capability registration, action-risk class, scheduler cadence, provider implementation, credential or activation changed. Existing sender code and platform/tenant configuration remain authoritative; SendGrid intent is preserved without introducing new provider wiring.

## Proof boundary and remaining work

Fixtures execute the incumbent module and real shared refusal classifier with synthetic records and an egress-denying port. They do not prove real SQL locking, caller RLS, actual business records, provider readiness, worker cessation, durable Rail or full original-operation recovery. An ambiguous notification may already exist: preserve its claim and inspect authoritative records before further work. No new automatic reconciliation/lease-stealing mechanism is introduced. Real positive/negative/reload/isolation and delivery readback, all18 historical outcomes/all50 parity dispositions and owner product acceptance remain open.

Initial hosted head93209a80b retained two failures: the evidence schema requires an explicit PROOF_OWED edge state, and the existing provider-boundary fixture omitted the native version now required by the real worker. The fixture now supplies and acknowledges that version and the real shared classifier; every original provider payload, refusal and duplicate assertion is retained. No product condition or security check is relaxed. Local type ratchet PASS:10 baseline diagnostics/8 current, no new errors.

Pre-release deployment inspection also found no plan-reminder-cron table in config.toml despite current production68/existingJWTfalse. The existing CLI workflow reads authentication settings from that file. A failing-first release control now requires the explicit incumbent setting; the added table preserves Vault-only cron authentication rather than changing production authority. Unauthorized and failed Vault checks still return401 before records/provider access. No other function, trigger cadence, token or connection is changed. Supplemental11/11 isolated PostgreSQL controls use claim/cleanup predicates extracted from the exact worker AST, including two-session competing claims and cancellation-lock revalidation; this is a minimal native-equivalent trigger/table fixture, not full schema/PostgREST/RLS/customer proof. The fixture cluster was stopped; initial sandbox connection refusal retained.
