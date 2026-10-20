# UI delivery evidence: EXP00 — Platform Operator company Sales department

## Pre-edit Owner Intent & Experience Contract

OWNER_INTENT: PAIGE Inc's founder opens the Platform Operator and sees the company's own Sales department — a standalone slot with a kanban pipeline, list view, deal creation, and governed stage transitions through the canonical pipeline tables. Campaigns is renamed Marketing (label-only, no Marketing development). The department restructure is the owner's 2026-10-20 directive.

MUST_NOT_HAPPEN: No tenant L2 pipeline data leaks; no Stripe subscription/invoice/receipt manufacturing from a pipeline card; no parallel CRM, pipeline engine or ledger; no "Drawn, not wired" text in a completed surface.

MUST_PRESERVE: The canonical pipeline tables (pipelines, pipeline_stages, deals) — the same governed schema used by tenant Sales, consumed at company L1 scope (tenant_id IS NULL); the existing Campaigns→Marketing views/absence byte-identical (label-only rename); all other operator slots unchanged.

ACCEPTANCE_CRITERIA: The kanban board renders real company pipeline stages with deal cards; creating an opportunity through the dialog inserts a real deal; moving a deal between stages updates its status with governed resolution; the summary band shows truthful open/won/lost counts and values; loading/error/empty states are honest; the Campaigns slot renders identically under its new Marketing label.

Goal: The founder manages PAIGE Inc's own sales pipeline with real opportunities and governed transitions.
Human and feel: Founder/Head of Sales; confident, fast, honest.
Entry and exit: /operator → Sales → Pipeline; click a card for detail; close to return.
System: v3 Operator shell vocabulary (tables, cards, dialogs, focus rings); no new visual system.
Signature: Every figure traces to the operator_sales_workspace RPC; no invented numbers.
Feedback: Board columns show count+value; cards click to detail; moves confirm via data refresh.
Rejecting: Invented stage probabilities; dead create buttons; silent move failures.
Variants: Same surface for all platform admins; role gate fails closed upstream.

| From | Input | To / recovery |
| --- | --- | --- |
| Loading | RPC in flight | "Loading the company pipeline…" |
| Error | RPC denied | role=alert with retry hint |
| Empty | No pipelines | "No company pipeline has been created yet" |
| Empty board | No deals in stage | "No opportunities" |
| Create | Dialog submit | Deal created, data refreshed |
| Move | Detail drawer button | Stage changed, status resolved, data refreshed |
| Search empty | No match | "No opportunities match your search" |

PROTECTED_SEAMS: Affected: one migration (3 RPCs + seed + guard update), operatorIA (sales slot + campaigns label), viewSources, SlotSurfaceBody, SalesDept surface, useSalesWorkspace hook, types.ts, slotGlyphs. Unaffected: every existing operator surface, all tenant pipeline paths, all money paths.

VISUAL_DIRECTION: PASS: The existing v3 vocabulary (table/card/dialog patterns, focus-visible rings, muted/ink color system); kanban columns are native flex containers; no new visual system.

## Frozen candidate proof

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Pre-edit contract and state/transition map above; the owner's 2026-10-20 directive defines the actor-goal flow (manage company sales pipeline with real opportunities).
PAIGE_UI_DESIGN: PASS: Existing v3 vocabulary reused; §13 truth rules enforced (money from RPC only, "—" for zero).
MATERIAL_FLOW_CHANGE: NO: a new slot is added; no existing goal, state, transition, exit or consequence changes for any other surface.
FLOW_PROTOTYPE: NOT_REQUIRED: New view in a new slot.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Platform founder/Head of Sales; open Sales, manage opportunities through governed stages.
VISUAL_DIRECTION: PASS: Existing v3 tone vocabulary.
AUTOMATED_EVIDENCE: PASS: tsc ratchet 0 new; spine 227 PASS; reachability 96/96; operatorIA 10/10.
STATIC_EVIDENCE: PASS: tsc ratchet no new diagnostics; eslint via CI.
RENDERED_EVIDENCE: UNVERIFIED: surface is server-dependent; post-deploy browser verification owed at the authenticated Operator drive.
BEHAVIORAL_EVIDENCE: UNVERIFIED: the live drive (create + move an opportunity) runs post-deploy; the wiring is review-verified (round-1 all axes).
AUTHENTICATED_RUNTIME: UNVERIFIED: real data renders only under a platform-admin session; the owner signs in via the approved IAB handoff.
KEYBOARD_FOCUS: PASS: Table rows carry tabIndex+role+Enter/Space; all buttons/inputs native with focus-visible rings; dialogs have aria-modal.
ZOOM_REFLOW: PASS: Kanban columns flex with overflow-x-auto; list table min-w+scroll; no fixed layout.
REDUCED_MOTION: NOT_APPLICABLE: no motion beyond the busy indicator.
STATE_COVERAGE: PASS: Loading, error, empty-pipeline, empty-stage, search-empty, busy-during-move, create-dialog-validation.
TRUTHFUL_STATE_LABELS: PASS: Money renders from the RPC data only; stage labels from the actual pipeline_stages; "—" for zero-value deals.
SOLO_UI: NO: Platform Operator console.
UNVERIFIED: Authenticated Operator drive (founder evaluation window); post-deploy production readback.

OWNER_INTENT: recorded above.
MUST_NOT_HAPPEN: recorded above.
MUST_PRESERVE: recorded above.
ACCEPTANCE_CRITERIA: recorded above.
MOTION_PURPOSE: NONE.
PROTECTED_SEAMS: recorded above.

INTERNAL_BUILD_IDENTITY: 0a2d676e2bb2edd7e439abf4c3ac107da7680545; deployment=PENDING merge to main then Vercel production; environment=development; migrations=APPLIED(20271113000000_operator_sales_workspace); edge=NOT_APPLICABLE; evidence=this record + CI
RELEASE_CHANNEL: development: internal engineering slice on the Operator console; local/development build environment; no staged rollout.
RELEASE_CLASSIFICATION: internal-only: Operator console capability.
CUSTOMER_RELEASE_IDENTITY: none: internal Operator capability.
RELEASE_NOTE_REQUIRED: no: internal Operator surface.
RELEASE_TRUTH_BOUNDARY: PARTIAL: source + migration + review + CI verified; authenticated Operator drive and production readback PROOF OWED.
RELEASE_RECOVERY: position=forward-fix (additive slot + migration; revert-safe); reference=PR CI + this record.
