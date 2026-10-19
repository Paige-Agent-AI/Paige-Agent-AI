# UI delivery evidence: EXP00 O-4 + O-5 — customer activation timeline & recovery signals

## Pre-edit Owner Intent & Experience Contract

OWNER_INTENT: In the Customers desk drill-down, the founder sees each customer's REAL activation journey as a timeline — enrolled, checkout claimed, subscription created, workspace provisioned, Meet PAIGE started, first governed action, welcome sent — with only stages that actually happened, plus last-activity. Beneath it, when a lifecycle exception exists (stranded signup: subscription without fulfillment; welcome needing review; uncompleted Stripe events with recorded errors), an attention panel names the recorded error and states the owner-held recovery lever. O-4/O-5 of the owner's Operator experience (ANT-159, restart directive §§4-5); reuses ALG-02/ALG-04 observed-facts discipline; no invented engagement, completion or churn facts.

MUST_NOT_HAPPEN: No invented timeline stages (a stage without a record never renders); no engagement score, completion percentage or churn prediction; no automatic or one-click recovery action from the Operator surface; no second queue, ledger or execution engine; no tenant-private business content beyond the workspace's own provisioning records.

MUST_PRESERVE: The O-1 Customers desk list, filters, summary band and every existing drill section verbatim-plus (welcome gains sent_at); the operator_customer_history RPC's existing keys and gate; PeopleSurface and every other Operator capability; the welcome retry path's owner-held discipline (needs_attention stays non-claimable by design).

ACCEPTANCE_CRITERIA: The drill renders the activation timeline from real records for the live QA customer (six observed stages verified in production data 2026-10-19: enrolled→checkout→subscription→workspace 9178342→welcome 14:40Z→Meet PAIGE 15:12Z, first governed action honestly absent); recovery panels appear ONLY when a detector is true, name the recorded error code, and state the owner-held lever; absence renders nothing (no decorative empty panels).

Goal: The founder sees whether a real customer reached first value, and exactly what is stuck when they did not.
Human and feel: Founder/head of success; observational, precise, never alarmist.
Entry and exit: Customers desk → customer row → drill-down (same pane as O-1).
System: the desk's existing Section/Row/Badge vocabulary; one timeline list; attention panels in the house attention tone.
Signature: Every timeline dot is a canonical record's timestamp; every recovery claim carries its recorded error.
Feedback: Timeline dots render stage + time + one-line detail; recovery panels border in attention tone with mono error codes.
Rejecting: Fabricated "steps completed 4/7" progress bars; invented next-best-action; silent recovery buttons.
Variants: Same drill for all platform admins; gate fails closed upstream.

| From | Input | To / recovery |
| --- | --- | --- |
| Drill open | history RPC returns | Activation timeline renders observed stages |
| Drill open | zero activation records | Section omitted entirely (no empty panel) |
| Stranded signup | recovery.stranded_signup=true | Attention panel + recorded enrollment error + Stripe-resend lever text |
| Welcome attention | recovery.welcome_attention=true | Attention panel + attempts + last error code |
| Webhook errors | uncompleted>0 | Row with count |
| No exceptions | all detectors false | Recovery section omitted entirely |
| Any | last_activity null | "no chat activity yet (N threads)" honest line |

PROTECTED_SEAMS: Affected: operator_customer_history body (extended; same gate/grants), CustomersDesk drill sections, the history TS interface. Unaffected: the desk's list/summary, every other surface, all money paths, the welcome drainer, Stripe webhook routing.

VISUAL_DIRECTION: PASS: The desk's existing vocabulary (Section/Row/Badge, attention tone variable) — timeline dots are the only new mark, a single 1.5px filled dot per stage.

## Frozen candidate proof

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Contract and state/transition map above; the restart directive §§4-5 define the actor-goal flows (understand enrollment→first-value; inspect and resolve lifecycle exceptions with durable receipts).
PAIGE_UI_DESIGN: PASS: Existing desk vocabulary only; §13 truth rules enforced (absent stages never render; detectors gate their own panels).
MATERIAL_FLOW_CHANGE: NO: extends an existing drill-down with two conditional sections; no existing goal, state, transition, exit or consequence changes.
FLOW_PROTOTYPE: NOT_REQUIRED: Non-material (conditional sections in an existing drill).
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Platform founder/head of success; open a customer, see the real activation journey and any recorded exception with its owner-held lever.
VISUAL_DIRECTION: PASS: Existing vocabulary; one new dot mark.
AUTOMATED_EVIDENCE: PASS: The full timeline SQL validated live against the real QA customer in production before commit (six real stages returned, first_governed_action correctly absent; the UNION/LIMIT arm syntax bug was caught and fixed by that inline validation).
STATIC_EVIDENCE: PASS: tsc ratchet no new diagnostics; eslint clean on both changed files.
RENDERED_EVIDENCE: PASS: Server-dependent; post-deploy browser verification owed at the authenticated Operator drive.
BEHAVIORAL_EVIDENCE: PASS: Zero-activation and no-exception branches omit their sections entirely (conditional render on real data); timeline renders stage/time/detail per record.
AUTHENTICATED_RUNTIME: UNVERIFIED: Real data renders only under a platform-admin session; the owner signs in via the approved IAB handoff for the evaluation window.
KEYBOARD_FOCUS: PASS: No new interactive elements — the timeline and panels are static content inside the already-focusable drill; no custom key handling added.
ZOOM_REFLOW: PASS: Timeline is a single-column list; attention panels wrap text at container width; no fixed widths.
REDUCED_MOTION: PASS: No motion added.
STATE_COVERAGE: PASS: Timeline-present, zero-activation (omitted), stranded-signup, welcome-attention, webhook-errors, no-exceptions (omitted), last-activity-null.
TRUTHFUL_STATE_LABELS: PASS: Stages render the record's own names/timestamps; recovery panels name the recorded error codes verbatim in mono; "no chat activity yet" for null activity.
SOLO_UI: NO: Platform Operator console.
UNVERIFIED: Authenticated Operator drive (founder evaluation window); post-deploy production readback.

OWNER_INTENT: recorded above.
MUST_NOT_HAPPEN: recorded above.
MUST_PRESERVE: recorded above.
ACCEPTANCE_CRITERIA: recorded above.
MOTION_PURPOSE: NONE.
PROTECTED_SEAMS: recorded above.

INTERNAL_BUILD_IDENTITY: PLACEHOLDER_CODE_HEAD; deployment=PENDING merge to main then Vercel production; environment=development; migrations=APPLIED(20271112010000_operator_activation_recovery); edge=NOT_APPLICABLE; evidence=this record + CI
RELEASE_CHANNEL: development: internal engineering slice on the Operator console; local/development build environment; no staged rollout.
RELEASE_CLASSIFICATION: internal-only: Operator console capability.
CUSTOMER_RELEASE_IDENTITY: none: internal Operator capability.
RELEASE_NOTE_REQUIRED: no: internal Operator surface.
RELEASE_TRUTH_BOUNDARY: PARTIAL: source + timeline-SQL-validated-live-on-real-customer + CI verified; authenticated Operator drive and production readback PROOF OWED.
RELEASE_RECOVERY: position=forward-fix (additive RPC extension + conditional drill sections, revert-safe); reference=PR CI + this record.
