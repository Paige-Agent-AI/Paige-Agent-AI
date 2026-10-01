# UI delivery evidence: Paige pipeline create/archive completion

Inventory finding (2026-10-01): the governed pipeline path is complete — the configure
command envelope with idempotency cache and version guards, admin authority at the shared
core, and the preview → owner confirmation → token flow for archive where archive never
inherits auto mode and hard delete is unavailable. Two pieces were missing: the legacy
direct-RPC tools survived as dead handlers after their action-risk classifications were
removed (a second, ungoverned execution path, and the likely origin of the tenant's
duplicate same-name pipelines), and nothing anywhere was intentional about same-name
creation — the governed create inserted silently.

UI_DELIVERY_EVIDENCE_VERSION: 1
SOLO_UI: NO: this diff changes the chat function, two migrations, a CI registry and a test; the autonomy settings surface loses two toggles that governed nothing; no shell, page, Chat component or rendered control changes
FLOW_BY_FLOW: WAIVED: owner-decision=INT-083 go-live ruling 2026-09-20; reason=the Flow-by-Flow skill is not installed at the account level in this environment, whose account-level skill directory holds impeccable alone, so a flow-by-flow pass is genuinely unavailable here; the affected seam is grounded from source in STATIC_EVIDENCE
PAIGE_UI_DESIGN: PASS: the repository paige-ui-design skill body and its routed references were read completely; no visual design, component, copy, geometry, motion, focus, action, state or exit changes
IMPECCABLE: PASS: the installed Impeccable skill and its craft floor were read; no UI artifact is in scope
MATERIAL_FLOW_CHANGE: YES: pipeline creation gains a new refusal state — an active pipeline already carrying the exact name refuses and asks, and proceeds only when the operator explicitly chooses a second pipeline with that exact name; the legacy direct creation path is removed
FLOW_PROTOTYPE: WAIVED: owner-decision=CRM/Deal-Enrollment repair-train assignment 2026-10-01 stage 4; reason=the assignment specifies intentional handling of same-name pipelines with duplicate detection and an honest ask, and the failing-first suite pins the refusal, the explicit override and the retired legacy path end to end
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner asks Paige to set up a pipeline; when an active pipeline already carries that exact name Paige shows every same-name match with its reference and asks, and creates only on an explicit choice
VISUAL_DIRECTION: PASS: no rendered surface, token or layout changed
AUTOMATED_EVIDENCE: PASS: the governance suite failed 6 of 9 on unchanged main and passes 9 of 9; the stored-proposal and adoption suites stay green (39 of 39 across the three); tool-catalogue, migration-version and definer-fn guards pass after the shadow baseline shed the two retired phantom rows and the canonical removal migration carried its removal-ok lines
STATIC_EVIDENCE: PASS: the legacy handlers, dispatch entries, labels, card cases, verb phrases and rail maps are gone from the chat function together with their direct RPC calls; the autonomy catalogue drops both rows by the canonical removal migration; the shared core gains PIPELINE_NAME_EXISTS — an exception, so nothing idempotency-caches under the refused key — raised when an active pipeline carries the exact name and the command does not explicitly carry allowSameName, naming the catalogue read and the owner choice; the governed archive contract is pinned unchanged (preview token, exact reference, confirmation, never auto, no hard delete); TypeScript reports zero errors in touched files
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered surface changed; the autonomy settings surface loses two switches that governed nothing
BEHAVIORAL_EVIDENCE: PASS: source-level pins prove the retirement at every site class, the refusal and its explicit override in the core migration, and the intact archive flow; the non-vacuous canaries prove the governed tools remain
AUTHENTICATED_RUNTIME: UNVERIFIED: the remaining behavior is a live same-name create refusing with the matches shown and an explicit-choice create succeeding, owed on a real workspace after merge
KEYBOARD_FOCUS: NOT_APPLICABLE: no control or focus path changed
ZOOM_REFLOW: NOT_APPLICABLE: no layout, content geometry or responsive behavior changed
REDUCED_MOTION: NOT_APPLICABLE: no motion or reduced-motion behavior changed
STATE_COVERAGE: PASS: covered states are same-name refusal with matches, explicit allowSameName create, first-name create unchanged, archived same-name not blocking, the legacy path removed at every site, and the archive contract unchanged
TRUTHFUL_STATE_LABELS: PASS: the refusal states the existing matches and the explicit choice in owner language; the autonomy settings surface carries zero switches for removed tools
UNVERIFIED: the deployed Edge bundle and migration lineage, and one authenticated same-name refusal plus explicit-choice create on a real workspace, remain unverified until post-merge production acceptance
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered surface changed
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered surface changed
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered surface changed
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered surface changed
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: no rendered surface changed
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no rendered surface changed
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no rendered surface changed
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no rendered surface changed
OWNER_INTENT: Paige creates and archives pipelines through the governed seams with intentional same-name handling, per the repair-train assignment stage 4
MUST_NOT_HAPPEN: no second execution path reintroduced; no hard delete; no archive without preview and confirmation; no silent same-name duplicate; no customer content in committed evidence
MUST_PRESERVE: the governed configure command envelope, idempotency cache, version guards, admin authority at the shared core, the preview → confirmation → token archive flow, archive never auto, and the catalogue duplicate-honesty
ACCEPTANCE_CRITERIA: creation routes only through the governed command; an active exact-name match refuses and asks with references; an explicit allowSameName choice creates; archived names do not block; archive keeps its preview, confirmation and version protection; the autonomy settings surface carries no dead switches
MOTION_PURPOSE: NONE: no motion was added or changed
PROTECTED_SEAMS: affected and tested = the chat legacy retirement sites, the shared pipeline core's create branch, the autonomy catalogue declaration and its shadow registry; explicitly unaffected = the archive flow, deal tools, the governed CRM door, Mind/Memory and Knowledge
RELEASE_NOTE_REQUIRED: NO: bounded retirement and intentional-refusal addition on the governed path
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the failing-first retirement and refusal pins, the registry guards and the migration re-emit fidelity are proven offline; authenticated production behavior and deployed lineage are not yet proven
RELEASE_RECOVERY: position=revert this bounded change if governed creation or the settings surface regresses, restoring the legacy handlers and catalogue rows from the merge parent before any forward fix; reference=PR-PIPELINE-CREATE-ARCHIVE

INTERNAL_BUILD_IDENTITY: product=e1f5845d6b3e68308fff0bdae77b9b32c3d959f6; current-main-sync=030e31b8ff886136bb2143685e35cbf87a7b18c1; base=030e31b8ff886136bb2143685e35cbf87a7b18c1; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20270530000000_pipeline_create_same_name_guard and 20270530010000_catalogue_drops_legacy_pipeline_tools after merge); edge=PROOF_OWED(paige-ai-chat automated deployment after merge); evidence=failing-first-registry-guards-and-reemit-fidelity
RELEASE_CHANNEL: development: exact product-code head on the draft branch; production promotion remains merge automation only
RELEASE_CLASSIFICATION: patch: retirement of a dead ungoverned path plus an intentional-refusal guard on the governed create
CUSTOMER_RELEASE_IDENTITY: none: no owner-approved customer release identity was assigned to this bounded repair
