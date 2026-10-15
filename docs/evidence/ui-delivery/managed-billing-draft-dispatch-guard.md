# Managed billing draft legacy dispatch guard

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: existing MCP send_invoice flow inspected; reject managed draft before recipient lookup, identity resolution, external send, write or success audit. Actual handler extracted from TypeScript AST and executed with local stubs.
PAIGE_UI_DESIGN: PASS: project overlay read; prior Sales build read its routed references/modules. This prerequisite changes no rendered markup. Owner-intent, protected behavior and release-truth checks apply; visual, geometry and motion modules have no changed interface to inspect.
MATERIAL_FLOW_CHANGE: NO: repairs the existing unavailable managed-draft dispatch boundary; no send control, approval mechanism, issued invoice contract or new user workflow is introduced. Existing legacy success/refusal paths remain.
FLOW_PROTOTYPE: NOT_REQUIRED: non-rendered enforcement repair of the already-approved draft-only Sales boundary; no new interface or interaction shape.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: prevent a caller of legacy send_invoice from emailing an unmanaged payment link for a canonical draft that cannot be issued or sent.
VISUAL_DIRECTION: NOT_APPLICABLE: no layout, tokens, typography, motion or visible control changes.
AUTOMATED_EVIDENCE: PASS: managed-invoice-dispatch.test.ts 15 tests pass; baseline five managed cases failed and ten legacy characterization cases passed before repair. Guard verifies zero contact reads, RPC, provider fetch, writes, address normalization, origin lookup or success audit. Legacy absent/null markers, missing invoice/read error/non-draft, missing email/config/sender and delivery refusal/exception remain covered.
STATIC_EVIDENCE: PASS: test ESLint and git diff --check passed; production patch is limited to internal wildcard read and early non-null marker refusal. TypeScript AST compilation/execution exercises the actual handler. Full Deno function check is UNVERIFIED here.
RENDERED_EVIDENCE: NOT_APPLICABLE: backend-only guard, no rendered source changed.
BEHAVIORAL_EVIDENCE: PASS: actual production send_invoice handler evaluated locally with stubbed database, fetch and audit; managed marker refusal precedes downstream side effects. This is local handler proof, not authenticated MCP or provider runtime proof.
AUTHENTICATED_RUNTIME: UNVERIFIED: no hosted authenticated MCP invocation or production database read was made. No real email/provider/database mutation was performed.
KEYBOARD_FOCUS: NOT_APPLICABLE: no interface changes.
ZOOM_REFLOW: NOT_APPLICABLE: no geometry changes.
REDUCED_MOTION: NOT_APPLICABLE: no motion changes.
STATE_COVERAGE: PASS: managed version and facts markers separately and together, falsy non-null markers, absent/null legacy markers and existing refusal/delivery failure branches executed.
TRUTHFUL_STATE_LABELS: PASS: managed dispatch returns managed_billing_draft_dispatch_unavailable; no claim of connected processor, invoice issuance, delivery or new governed capability.
SOLO_UI: NO: legacy Edge MCP handler prerequisite only; no Solo source changed.
UNVERIFIED: hosted compatibility read, authenticated MCP refusal, deployed Edge identity and provider runtime; these require separate coordinator release proof. This guard does not activate invoice sending or complete billing launch.
INTERNAL_BUILD_IDENTITY: base=17d67766e0ea2720a77bbc7b76cf5248bc1c4737; deployment=none; environment=local; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-mcp guard not deployed); evidence=src/__tests__/managed-invoice-dispatch.test.ts
RELEASE_CHANNEL: development: local isolated worktree, no deployment performed by implementation worker.
RELEASE_CLASSIFICATION: internal-only: safety prerequisite for managed draft storage.
CUSTOMER_RELEASE_IDENTITY: none: guard is not a completed customer billing outcome.
RELEASE_NOTE_REQUIRED: no: internal prerequisite repair.
RELEASE_TRUTH_BOUNDARY: PARTIAL: local actual-handler guard proven; hosted/deployed and authenticated runtime evidence owed.
RELEASE_RECOVERY: position=keep deployed guard before managed storage migration; reference=this record and separate storage PR #1642; do not remove the guard while managed rows exist.

## Routing and collision boundary

CRM/Sales owns managed draft records; Comms owns Resend dispatch. Existing MCP mapping is crm.write; server risk registry classifies billing_send_invoice high. No authority/approval/budget behavior is expanded. No invoice send Spine capability is introduced, no scheduler or receipt stream is added, and managed refusal emits no success audit. Resend Integration Capability Registry entry remains PARTIAL, requiring resolved verified sending identity; this change asserts no connection readiness. Listed is not connected. Sales binding maturity is not promoted.

The coordinator scanned fourteen other open PR file lists and reported no paige-mcp/index.ts overlap. This worker changes only the send handler, this evidence and its actual-handler behavioral test. SQL, UI, hooks, provider credentials and legacy capability activation are excluded. The independent exact-head source review is coordinator-owned and must complete before release. Merge and deploy this guard before the #1642 managed-draft migration.

## Compatibility and proof boundary

The internal select('*') avoids requesting not-yet-existing managed columns before migration. Non-null billing_draft_version OR billing_draft refuses, including malformed falsy marker values. Absent/undefined/null markers preserve legacy behavior. No whole row is returned or logged; response and audit retain explicit legacy fields. Local fixtures model absent-column selection failure but do not prove hosted schema compatibility or outer MCP authentication/authorization. Existing legacy send consistency and provider limitations are preserved, not certified or repaired here.

Supabase changelog.md was fetched and scanned for relevant breaking changes; current select documentation was inspected at https://supabase.com/docs/reference/javascript/select. No new SDK feature, schema or dependency is introduced. Impeccable visual checks are not applicable to this non-rendered repair; the approved Sales design remains unchanged.

Shipped Delivery Log: N/A at worker handoff; branch is not committed, merged or deployed. Coordinator must record exact release identity after merge.
