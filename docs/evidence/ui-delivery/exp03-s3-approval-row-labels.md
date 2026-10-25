# UI delivery evidence: exp03-s3-approval-row-labels

S3 UI remainder (journey §12's O6/O8 gaps): the shared approval row now labels the reply families with words an owner reads — **Lead reply**, **Follow-up reply**, **Follow-up email** — instead of the raw queue key (`owner.lead_followup` rendered as "Owner.lead Followup"), and a legacy `client.followup` row explains plainly that it **can only be declined here** while replies Paige writes now are reviewed and approved in Conversations. O5 (the intake toggle's reload state) and O7 (the reply review screen) already shipped with #2172; this closes the remaining approval-row gaps.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: WAIVED: owner-decision=AGENTS.md mandatory routing with the #1280 waiver grammar; reason=the Flow-by-Flow skill is not installed in this agent environment, and the incumbent-surface grounding below carries the flow reading instead
PAIGE_UI_DESIGN: PASS: Impeccable skill read fully this session — craft-floor applied: refinement-preserves (a label map and one muted sentence on the incumbent row — no layout, chrome or motion change), copy names what the thing is and what its limit is (the decline-only sentence states the constraint and where the real path lives, per the craft floor's copy rule), no craft-floor ban triggered
MATERIAL_FLOW_CHANGE: NO: no new flow, state, transition or exit — existing rows render truthful words
FLOW_PROTOTYPE: NOT_REQUIRED: MATERIAL_FLOW_CHANGE is NO and no flow shape changed
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: the Solo owner scanning their approval queue sees "Lead reply" and understands what awaits review; a legacy row says plainly it can only be declined and where new replies are approved
VISUAL_DIRECTION: PASS: incumbent design system unchanged — the same chip and muted-note patterns
AUTOMATED_EVIDENCE: PASS: 63 tests green in the row suite — three new label cases (one per family, each asserting the friendly word present and the raw-key-with-space absent), the decline-only explanation case (note present, Approve absent), and the negative (a governed lead reply carries no decline-only note), beside the 58 incumbent cases including the three routing pins
STATIC_EVIDENCE: PASS: the label map is a three-entry Record keyed by exact category strings with the incumbent fallback for every other category — the decline-only note is gated to `client.followup` only
RENDERED_EVIDENCE: UNVERIFIED: no browser session in this environment — the row is the incumbent component rendering different words, behaviorally pinned by the suite, with the browser matrix owed below
BEHAVIORAL_EVIDENCE: PASS: the suite mounts the real ApprovalRow in the router and asserts the rendered words per family including the negatives
AUTHENTICATED_RUNTIME: UNVERIFIED: a signed-in owner view of a live approval queue with a lead reply is owed at the next authenticated pass
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive element added or changed
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: all three reply families covered positively and the legacy-vs-governed distinction covered both ways — the routing/decline behavior itself is unchanged and pinned by the incumbent tests
TRUTHFUL_STATE_LABELS: PASS: this IS the truthful-label fix for the approval queue — the raw queue key never reaches the owner, and the legacy row states its real limit instead of silently lacking an Approve button
SOLO_UI: YES: the four-viewport Solo bar is owed with the rendered/browser pass above — no responsive surface changed in this delta
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no browser campaign in this environment, no layout change in this delta
UNVERIFIED: the rendered/browser matrix including the four Solo viewports, the authenticated owner queue view, and founder acceptance — none claimed complete by this record

OWNER_INTENT: The journey's O6/O8 acceptance rows: the category must never show raw, and a legacy decline-only approval needs a plain explanation — not a raw non-2xx message and not a silent missing button.
MUST_NOT_HAPPEN: No raw queue key rendered to the owner — no Approve affordance on any followup row — no behavior change to approve, decline, routing or reporting — no new flow or control
MUST_PRESERVE: The FollowupReviewLink deep link and its copy — the decline flow with rationale — every incumbent report/state — the department-specialist line
ACCEPTANCE_CRITERIA: A signed-in owner's queue shows "Lead reply" on a lead-reply row — a legacy follow-up row shows the decline-only sentence and no Approve button — a governed lead reply shows no decline-only note — View and Decline behave exactly as before
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: affected: truthful state labels — unaffected: the approval execution path, the decline writers, the Conversations routing, Rail, the governed email door

INTERNAL_BUILD_IDENTITY: 03ac00959e0b8389e2f9b89d82989ef1b6e54a79; deployment=local-and-PR-preview; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp03-s3-approval-row-labels.md
RELEASE_CHANNEL: development: source release, no activation
RELEASE_CLASSIFICATION: internal-only: truthful labels on an internal surface, no coherent owner-visible customer outcome boundary crossed
CUSTOMER_RELEASE_IDENTITY: none: acceptance and release authority not established
RELEASE_NOTE_REQUIRED: no: no customer release at this increment
RELEASE_TRUTH_BOUNDARY: PROOF OWED: local source and behavioral proof complete — the rendered matrix, authenticated runtime and founder acceptance remain separately owed
RELEASE_RECOVERY: position=reviewed forward release on green CI with normal deployment readback and no rollback-specific machinery beyond the standing release-governance policy; reference=docs/doctrine/release-governance-and-customer-update-policy.md
