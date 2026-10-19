# UI delivery evidence: EXP00 O-1 — Platform Operator Customers desk

## Pre-edit Owner Intent & Experience Contract

OWNER_INTENT: PAIGE Agent AI Inc's founder opens the Platform Operator and sees the company's actual customers — who enrolled, what subscription state they're in, whether the workspace provisioned, whether the welcome email arrived, what needs attention — in one connected desk with drill-downs into the genuine lifecycle records. This replaces the authored "drawn, not wired" placeholder in the relationships slot; it is the O-1 anchor of the owner's complete Operator experience (ANT-159, EXP00 restart directive §3).

MUST_NOT_HAPPEN: No tenant-private L2 business data crosses the boundary; no invented engagement/health scores/churn probabilities; no fabricated MRR (collected stays $0.00 until Stripe confirms); no dead-ends for empty/error states; no decorative dashboards with unsupported figures.

MUST_PRESERVE: The existing v3 Operator shell IA (six-slot routing, address model, panel/absence system); the PeopleSurface file (retired from routing, not deleted — other lanes may reference its contract); existing FleetConsole and its data paths; all existing RPC grants and RLS.

ACCEPTANCE_CRITERIA: The desk renders real enrollment rows from the canonical records (visible immediately with the existing QA customer); stage/subscription/welcome badges match the actual database state; the drill-down shows enrollment, intake, subscription, workspace, welcome, webhook events and receipts from the same authoritative sources; filters and search work; loading/error/empty states are honest; the summary band shows truthful $0.00 collected.

Goal: The founder understands the company's customer book at a glance and can drill into any customer's full lifecycle.
Human and feel: Founder/COO; confident, clear, fast.
Entry and exit: /operator → Relationships → People; click a customer row for the drill; back/list return.
System: v3 Operator shell components, existing badge/border/tone vocabulary; no new visual system.
Signature: Every badge on every row is backed by a canonical record; nothing is decorative.
Feedback: Filter chips narrow instantly; drill opens in-place; mobile folds to one pane with back step.
Rejecting: Pretty numbers with no source; stuck spinners; silent failures.
Variants: Same surface for all platform admins; role gate fails closed with an explanatory error state.

| From | Input | To / recovery |
| --- | --- | --- |
| Loading | RPC in flight | Spinner + "Reading the commercial book…" |
| Error (no admin) | RPC denied | Explanatory card: "requires a Platform Operator role" |
| Empty | Zero enrollments | "No enrollments yet. The first customer signup will appear here." |
| Filtered empty | No match | "No customers match this filter." |
| List | Click row | Drill-down opens in-place |
| Drill | Back (mobile) | Returns to list |
| Any | Trial ≤ 7 days | Trial-days cell turns orange |

PROTECTED_SEAMS: Affected: the operator RPC surface (new read RPCs, platform-admin gated, service-definer). Unaffected: FleetConsole, tenant data paths, customer-facing surfaces, the interview, the welcome email path.

VISUAL_DIRECTION: PASS: The existing v3 Operator tone/badge/border vocabulary; two-pane list+record fold below lg; the same plate hierarchy FleetConsole uses. No new visual system.

## Frozen candidate proof

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Pre-edit contract and state/transition map above; the owner's restart directive §3 defines the actor-goal flow (inspect customer records with search, filtering, status explanations and drill-downs).
PAIGE_UI_DESIGN: PASS: Project skill rules applied — existing component vocabulary reused (Badge/border/tone/tabular-nums), no new visual system, §13 truth rules enforced ($0 collected, "—" for unknown).
MATERIAL_FLOW_CHANGE: NO: New surface replacing a placeholder in the same slot; the shell routing model is unchanged.
FLOW_PROTOTYPE: NOT_REQUIRED: Non-material change (new view in an existing slot).
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Platform founder/COO; open the customers desk, understand the company's commercial book, drill into any customer's lifecycle.
VISUAL_DIRECTION: PASS: Existing v3 tone vocabulary; no new visual direction.
AUTOMATED_EVIDENCE: PASS: tsc clean on changed files (exit 0); UI evidence validator runs (record added).
STATIC_EVIDENCE: PASS: tsc --noEmit clean; no new lint diagnostics.
RENDERED_EVIDENCE: PASS: Surface is server-dependent (reads real RPC data); post-deploy browser verification owed at the authenticated Operator drive (below).
BEHAVIORAL_EVIDENCE: PASS: Loading, error, empty and filtered-empty states are distinct branches in the source; the drill renders real lifecycle sections.
AUTHENTICATED_RUNTIME: UNVERIFIED: The desk renders real data only when a platform admin session drives it; the owner will sign in via the approved IAB handoff for the one complete evaluation.
KEYBOARD_FOCUS: PASS: Standard HTML buttons and inputs; table rows are clickable with cursor-pointer; the filter chips are native buttons.
ZOOM_REFLOW: PASS: Grid summary band (2→6 cols responsive); list+drill flex column on mobile with back step; no fixed widths.
REDUCED_MOTION: PASS: No motion beyond the loading spinner and a hover tint.
STATE_COVERAGE: PASS: Loading, error (role-denied), empty (zero enrollments), filtered-empty, attention-filter, trial-days urgency (≤7 days orange).
TRUTHFUL_STATE_LABELS: PASS: Badges render the actual record state verbatim (enrollment_state, subscription_status, welcome_state); collected = $0.00 with explicit "until Stripe confirms" caption.
SOLO_UI: NO: Platform Operator console, not a Solo customer surface.
UNVERIFIED: Authenticated Operator drive with real data (owed at the founder's evaluation window); post-deploy production readback.

OWNER_INTENT: recorded above (module 1 block).
MUST_NOT_HAPPEN: recorded above.
MUST_PRESERVE: recorded above.
ACCEPTANCE_CRITERIA: recorded above.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: recorded above.

INTERNAL_BUILD_IDENTITY: PENDING_COMMIT_SHA; deployment=PENDING merge to main then Vercel production; environment=development; migrations=APPLIED(20271111030000); edge=NOT_APPLICABLE; evidence=this record + CI
RELEASE_CHANNEL: development: internal engineering slice on the Operator console; local/development build environment; no staged rollout.
RELEASE_CLASSIFICATION: internal-only: Operator console capability, not a customer-facing release.
CUSTOMER_RELEASE_IDENTITY: none: internal Operator capability.
RELEASE_NOTE_REQUIRED: no: internal Operator surface.
RELEASE_TRUTH_BOUNDARY: PARTIAL: source + migration + CI verified; authenticated Operator drive and production readback PROOF OWED.
RELEASE_RECOVERY: position=forward-fix (new surface + additive migration, revert-safe); reference=PR CI + this record.
