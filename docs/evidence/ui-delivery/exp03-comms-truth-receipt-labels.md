# UI delivery evidence: exp03-comms-truth-receipt-labels

Communications truth (the owner's resumption directive item 2, the O7 matrix states-gap): a settled governed email in Conversations no longer reads as plain "Sent". Only the provider's own delivered event says **Delivered**; a `sent`/`read` marker on a provider-accepted operation says **Accepted** (the email service took the message, delivery not confirmed). Failed, blocked, unknown/unconfirmed and queued states are preserved exactly as they were — this change touches only the settled sent/read/delivered branch of the status pill.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: WAIVED: owner-decision=AGENTS.md mandatory routing with the #1280 waiver grammar; reason=the Flow-by-Flow skill is not installed in this agent environment, and the incumbent-surface grounding below carries the flow reading instead
PAIGE_UI_DESIGN: PASS: Impeccable skill read fully this session (S1e context run carried PRODUCT.md and DESIGN.md) — craft-floor applied to this delta: refinement-preserves (one word changes on an existing pill — no layout, no new chrome, no motion), states (every existing pill state unchanged — blocked Not sent, failed Failed, queued Queued, sending, not sent, couldn't-confirm all byte-identical), copy (the words are the product truth this PR exists to deliver — Accepted names what happened without claiming delivery), no craft-floor ban triggered
MATERIAL_FLOW_CHANGE: NO: no new flow, state, transition or exit — the label on one existing settled state becomes truthful (Sent to Accepted or Delivered where the governed evidence supports it)
FLOW_PROTOTYPE: NOT_APPLICABLE: MATERIAL_FLOW_CHANGE is NO
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: the Solo owner scanning a conversation sees, per message, what is actually known — a governed reply the email service accepted reads Accepted, one the recipient's server took reads Delivered, and only a message with no governed receipt evidence keeps the plain Sent pill
VISUAL_DIRECTION: PASS: incumbent design system unchanged — the same StatePill component and success state render the truer word
AUTOMATED_EVIDENCE: PASS: 54 tests green in the touched suite (53 passed, 1 incumbent skip) — four new inbox-drive tests (a canonical provider receipt stays truthful after settling for delivered, sent and read — each asserting the exact word and the absence of the stronger claim) plus a plain-Sent negative for an unbound send, a settled-but-NOT-accepted negative, and an inbound-read-is-never-a-receipt negative, and a unit describe on the label helper (the only Delivered is provider-accepted plus status delivered — non-accepted, unbound, other-status and inbound rows all read null)
STATIC_EVIDENCE: PASS: the helper reads only the six bounded scalar JSON paths the state machine already reads (GOVERNED_SEND_COLS) — no new meta path, no provider payload, no command body — and the pill change is one branch of messageStatusPill with the fallback preserved
RENDERED_EVIDENCE: UNVERIFIED: no browser session in this environment — the pill is the incumbent StatePill rendering a different word, behaviorally pinned by the inbox-drive tests, with the browser matrix owed below
BEHAVIORAL_EVIDENCE: PASS: the inbox-drive tests mount the real Conversations surface through the shared harness and assert the rendered words per state, including the negatives (no Accepted without an accepted operation, no Delivered without the provider's delivered event, no relabelling of inbound reads)
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in browser session — a live owner view of a conversation with a provider-accepted reply is owed at the next authenticated pass (production provider-receipt verification additionally rides on the owner-held SendGrid webhook-admin key)
KEYBOARD_FOCUS: NOT_APPLICABLE: a text label change on an existing non-interactive pill — no focus surface touched
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: settled governed sent, read and delivered covered positively — unbound sent, settled-but-not-accepted, and inbound read covered negatively — failed, blocked, queued, sending, not sent and unconfirmed unchanged and covered by the pre-existing suites in the same file
TRUTHFUL_STATE_LABELS: PASS: this IS the truthful-state-labels fix — the O7 matrix gap (sent, delivered and read all showed Sent) closes for governed emails, with the label derived from the same bounded canonical projection the state machine reads
SOLO_UI: YES: the four-viewport Solo bar is owed with the rendered/browser pass above — no responsive surface changed in this delta
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
UNVERIFIED: the rendered/browser matrix including the four Solo viewports, the authenticated owner view of a conversation with governed receipts, and production provider-receipt verification (owner-held SendGrid webhook-admin key dependency) — none claimed complete by this record

OWNER_INTENT: The owner's resumption directive names this exactly — "distinguish provider Accepted from actual Delivered, failed and unknown." Target actor: the Solo owner reading a conversation. Required outcome: the pill states only what the evidence supports.
MUST_NOT_HAPPEN: No state may claim delivery without the provider's delivered event — no relabelling of inbound messages or unbound sends — no change to failed, blocked, queued, sending, not-sent or unconfirmed states — no new meta path or provider payload read — no resend affordance added
MUST_PRESERVE: Every existing pill state and its copy — the bounded GOVERNED_SEND_COLS projection — the governed state machine and its time bounds — the approval/draft rules — the LeadReplyDrafts recorded-status readback
ACCEPTANCE_CRITERIA: A signed-in owner opens a conversation containing a provider-accepted governed reply — the reply's pill reads Accepted — after the provider's delivered event lands the same pill reads Delivered — an ordinary sent email still reads Sent — a failed send still reads Failed with its error — the couldn't-confirm state still says don't resend
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: affected: truthful state labels (the label derives from the same bounded projection the state machine reads — a read marker is never delivery evidence) — unaffected: the publish door, intake, approval engine, Rail, the send path itself (no send behavior changes), Memory and Mind, and every non-settled pill state

INTERNAL_BUILD_IDENTITY: pending-commit; deployment=local-and-PR-preview; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp03-comms-truth-receipt-labels.md
RELEASE_CHANNEL: development: source release, no activation
RELEASE_CLASSIFICATION: internal-only: one truthful label on an internal surface, no coherent owner-visible customer outcome boundary crossed
CUSTOMER_RELEASE_IDENTITY: none: acceptance and release authority not established
RELEASE_NOTE_REQUIRED: no: no customer release at this increment
RELEASE_TRUTH_BOUNDARY: PROOF OWED: local source, behavioral and suite proof complete — the rendered matrix, authenticated runtime and founder acceptance remain separately owed
RELEASE_RECOVERY: position=reviewed forward release on green CI with normal deployment readback and no rollback-specific machinery beyond the standing release-governance policy; reference=docs/doctrine/release-governance-and-customer-update-policy.md
