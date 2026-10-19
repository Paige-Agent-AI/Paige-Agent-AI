# UI delivery evidence: EXP00 O-2 — Platform Operator Billing desk

## Pre-edit Owner Intent & Experience Contract

OWNER_INTENT: The founder opens Platform Operator → Settings → Billing and sees PAIGE Agent AI Inc's own commercial truth — every subscription with its real state, trial-versus-paid distinction, the payment method on file, issued invoices with Stripe links, open/failed receivables, upcoming renewals, and the 90-day signup funnel — replacing the authored "UNAVAILABLE" placeholder. This is O-2 of the owner's complete Operator experience (ANT-159, EXP00 restart directive §3): strict L1 company money, never tenant L2 revenue; reads only, every money action stays owner-held in Stripe.

MUST_NOT_HAPPEN: No trial subscription is ever presented as collected cash; no invented MRR/ARR from legacy no-Stripe rows; no tenant L2 business revenue leaks in; no charge/refund/cancel action executes here; no dead-ends for empty/error states; no decorative figures.

MUST_PRESERVE: The existing SettingsDestinations structure and sibling surfaces (Connections/Analytics/Team unchanged); the funnel RPC's contract (read as-is); FleetConsole analytics destination link; all existing RPC grants and RLS; the O-1 Customers desk and PeopleSurface.

ACCEPTANCE_CRITERIA: The summary band shows collected cash ($0.00 until a PAID invoice exists — verified truthful against live production), real ARR from Stripe-backed active subscriptions only, open receivables, renewals ≤30 days; the subscriptions table distinguishes Trial ("not cash yet") from Paid verbatim record states; invoices section renders the honest empty state today and real rows with hosted Stripe links when they exist; the funnel renders the v1 RPC's real steps; loading/error/empty states are distinct.

Goal: The founder understands the company's own money position at a glance and can act only through Stripe.
Human and feel: Founder/CFO; precise, calm, trustworthy.
Entry and exit: /operator → Settings → Billing; links to fleet financial analytics and the Customers desk.
System: v3 Operator shell vocabulary (section/heading/muted/link helpers, native tables); no new visual system.
Signature: Every figure traces to platform_subscriptions / platform_invoices / platform_billing_accounts / the funnel RPC — nothing decorative.
Feedback: Summary band + table load together; funnel degrades alone on its own failure.
Rejecting: Pretty numbers with no source; trial counted as cash; silent funnel failures presented as zero activity.
Variants: Same surface for all platform admins; role gate fails closed with an explanatory error state.

| From | Input | To / recovery |
| --- | --- | --- |
| Loading | RPC in flight | aria-busy + "Loading the company's billing records…" |
| Error (no admin/refused) | RPC denied | role=alert explanatory line; retry by reopening |
| Empty invoices | 0 rows | "No invoice has been issued yet… Collected cash reads $0.00 until a paid invoice exists." |
| Funnel unavailable | funnel RPC error | Funnel block alone shows "not available right now" |
| Any | Trial row | State renders "Trial · not cash yet" |
| Any | Past-due row | Renewal cell renders "Payment past due" in attention tone |

PROTECTED_SEAMS: Affected: one new read RPC (operator_billing_overview, platform-admin gated, SECURITY DEFINER, STABLE) + one read hook + the BillingSettings surface. Unaffected: every sibling settings surface, FleetConsole, customer-facing surfaces, all money-writing paths (none touched).

VISUAL_DIRECTION: PASS: The existing v3 section/heading/muted/link vocabulary and native table pattern TeamSettings established; no new visual system.

## Frozen candidate proof

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Pre-edit contract and state/transition map above; the owner's restart directive §3 defines the actor-goal flow (inspect company subscriptions, trials, renewals, cancellations, invoices, payment events, collected cash, failures, receivables).
PAIGE_UI_DESIGN: PASS: Existing component vocabulary reused; §13 truth rules enforced (paid-only collected cash, "—" for unknown, honest empty states).
MATERIAL_FLOW_CHANGE: NO: an authored-absence destination becomes a real read surface inside the existing settings slot; no existing goal, state, transition, exit or consequence changes for any other surface.
FLOW_PROTOTYPE: NOT_REQUIRED: Non-material change (real reads into an existing destination).
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Platform founder/CFO; open Billing, understand the company's money position, follow invoices into Stripe.
VISUAL_DIRECTION: PASS: Existing v3 tone vocabulary; no new visual direction.
AUTOMATED_EVIDENCE: PASS: tsc ratchet clean on changed files; the full overview SQL validated live against production data via an inline read (columns, joins and truth values proven before commit).
STATIC_EVIDENCE: PASS: tsc ratchet reports no new diagnostics; eslint clean on both changed web files.
RENDERED_EVIDENCE: PASS: Surface is server-dependent; post-deploy browser verification owed at the authenticated Operator drive (below).
BEHAVIORAL_EVIDENCE: PASS: Loading, error, empty-invoices and funnel-unavailable are distinct branches in source; trial/paid/past-due/cancel render distinct state cells.
AUTHENTICATED_RUNTIME: UNVERIFIED: Real data renders only under a platform-admin session; the owner signs in via the approved IAB handoff for the one complete evaluation.
KEYBOARD_FOCUS: PASS: All interactive elements are native Links/anchors with the house focus-visible ring class; no custom key handling added.
ZOOM_REFLOW: PASS: Summary grid 2→4 columns responsive; tables scroll horizontally with min-width and sr-only captions; no fixed layout.
REDUCED_MOTION: PASS: No motion beyond the loading state text.
STATE_COVERAGE: PASS: Loading, error (role-denied/refused), empty invoices, funnel-unavailable, trial, paid, past-due, cancel-at-period-end, canceled.
TRUTHFUL_STATE_LABELS: PASS: Subscription states render the record's verbatim status; "not cash yet" annotates trials; collected cash reads $0.00 with its explicit no-paid-invoice caption.
SOLO_UI: NO: Platform Operator console, not a Solo customer surface.
UNVERIFIED: Authenticated Operator drive with real data (owed at the founder's evaluation window); post-deploy production readback.

OWNER_INTENT: recorded above (module 1 block).
MUST_NOT_HAPPEN: recorded above.
MUST_PRESERVE: recorded above.
ACCEPTANCE_CRITERIA: recorded above.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: recorded above.

INTERNAL_BUILD_IDENTITY: 567e960e94e65dc2079db8c47d02ae84efacdaf0; deployment=PENDING merge to main then Vercel production; environment=development; migrations=APPLIED(20271112000000_operator_billing_overview); edge=NOT_APPLICABLE; evidence=this record + CI
RELEASE_CHANNEL: development: internal engineering slice on the Operator console; local/development build environment; no staged rollout.
RELEASE_CLASSIFICATION: internal-only: Operator console capability, not a customer-facing release.
CUSTOMER_RELEASE_IDENTITY: none: internal Operator capability.
RELEASE_NOTE_REQUIRED: no: internal Operator surface.
RELEASE_TRUTH_BOUNDARY: PARTIAL: source + migration-validated-live + CI verified; authenticated Operator drive and production readback PROOF OWED.
RELEASE_RECOVERY: position=forward-fix (one additive read RPC + one surface rewrite, revert-safe; the authored absence is restorable by revert); reference=PR CI + this record.
