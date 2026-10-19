# UI delivery evidence: EXP00 O-3 — Platform Operator conversational COO (company tools + persona fix)

## Pre-edit Owner Intent & Experience Contract

OWNER_INTENT: The owner asked PAIGE from the genuine Platform Operator account "Paige can you tell me about who we have joined so far?" and received tenant-CRM prioritization, a "tenant not resolved" error, and customer claims contradicting verified production records. PAIGE must answer company questions — who joined, trials, provisioned workspaces, onboarding, welcome emails, collected cash, attention — as PAIGE Inc's COO, from the SAME canonical records the Customers desk and Billing read, agreeing with them everywhere.

MUST_NOT_HAPPEN: No fake tenant assignment or tenant-isolation bypass; no client flag that elevates authority; no second chat engine, queue or ledger; no invented figures or absence claims from tenant-tool refusals; no tenant-private L2 business data exposed to the operator path beyond the company's own customer lifecycle records.

MUST_PRESERVE: The single paige-ai-chat engine and every existing persona (tenant, client, customer portal); every existing dispatch branch, guard and fingerprint (renewed as a set per the C0b convention); the §52 operator briefing architecture; the Solo app's chat behavior (surface hint sent ONLY by the operator console).

ACCEPTANCE_CRITERIA: On an operator-console turn the persona is PAIGE Inc (tenant-less) for a verified platform operator — reproduced live: the exact owner question previously produced a tenant-persona answer; after the fix the same question is answered from the real company book (1 customer, Acmey Advisory, trial to 2026-11-17, workspace provisioned, welcome sent, $0.00 collected) via the two new read tools; a non-operator sending the surface hint is ignored; steering forbids reading tenant-tool refusals as absence.

Goal: PAIGE acts as the real COO of PAIGE Agent AI Inc in conversation.
Human and feel: Company COO; grounded, current, never guessing.
Entry and exit: Operator console chat (any operator view) — no UI navigation change.
System: the existing engine; two read tools dispatched to the existing platform-admin-gated SQL RPCs.
Signature: every company figure in chat traces to the same RPCs the desks read.
Feedback: tool answers stream through the existing spine; refusals name their reason.
Rejecting: reciting a stale context block; refusing company questions; tenant-CRM answers on the platform account.
Variants: operators only; non-operators never see the platform persona.

| From | Input | To / recovery |
| --- | --- | --- |
| Operator console turn | surface hint + verified operator | Platform persona (tenant-less) + briefing + steering + company tools |
| Company question | tool call | platform_customer_overview / platform_commercial_summary via caller-JWT RPC |
| Non-operator sends hint | gate false | Hint ignored; persona exactly as resolved |
| RPC refused (not admin) | DB gate | Honest company_read_failed; no data |
| Tenant question in operator console | CRM tools | Their refusal is expected; steering forbids absence claims |

PROTECTED_SEAMS: Affected: paige-ai-chat request schema (one literal), persona force, one steering splice, two conditional tool defs + one dispatch branch, c0b fingerprint renewal, spine domain adapter + registry (2 read capabilities, public.* executors), useOperatorChat body (one field). Unaffected: every existing tool branch and persona path; tenant isolation; the briefing block itself.

VISUAL_DIRECTION: NOT_APPLICABLE: no visual change — the operator console's existing chat surface renders the answers; this is the conversational layer beneath it.

## Frozen candidate proof

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Pre-edit contract and state/transition map above; the owner's defect report (2026-10-19) defines the actor-goal flow; reproduction evidence captured before the fix (fixture platform_admin asked the exact question and received a tenant-persona answer).
PAIGE_UI_DESIGN: PASS: No new visual system; the existing spine renders tool-driven answers.
MATERIAL_FLOW_CHANGE: NO: conversational source and persona routing beneath an unchanged surface; no existing goal, state, transition, exit or consequence changes for any other caller.
FLOW_PROTOTYPE: NOT_REQUIRED: Non-material (engine-layer fix).
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Platform Operator; ask company questions; receive grounded company answers.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual change.
AUTOMATED_EVIDENCE: PASS: spine self-test + full lint PASS (227 capability) with the two new read capabilities against their SQL executors; the 29 C0b dispatch fingerprints renewed with base-reproduction proof; deno diagnostics 9→9 (no new); affected suites 40/40.
STATIC_EVIDENCE: PASS: tsc ratchet no new errors; eslint via CI.
RENDERED_EVIDENCE: PASS: live reproduction harness is the probe (fixture JWT + exact question); post-deploy live re-verification owed below.
BEHAVIORAL_EVIDENCE: PASS: the operator branch, hint gate, tool admission and refusal paths are distinct code paths; the negative case (non-operator hint ignored) is structural (flag stays false).
AUTHENTICATED_RUNTIME: UNVERIFIED: post-deploy live re-probe of the exact question (platform_admin fixture) plus the owner's own console re-ask at the evaluation window.
KEYBOARD_FOCUS: NOT_APPLICABLE: no new interactive elements.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change.
REDUCED_MOTION: NOT_APPLICABLE: no motion.
STATE_COVERAGE: PASS: operator turn, non-operator hint (ignored), RPC refusal, tenant-tool refusal steering.
TRUTHFUL_STATE_LABELS: PASS: refusal copy names platform_operator_only / company_read_failed verbatim; steering forbids absence claims from refusals.
SOLO_UI: NO: Platform Operator conversational layer.
UNVERIFIED: Post-deploy live re-probe and the owner's console re-ask at the evaluation window.

OWNER_INTENT: recorded above.
MUST_NOT_HAPPEN: recorded above.
MUST_PRESERVE: recorded above.
ACCEPTANCE_CRITERIA: recorded above.
MOTION_PURPOSE: NONE.
PROTECTED_SEAMS: recorded above.

INTERNAL_BUILD_IDENTITY: 386e0093c8bed7dfbf654c891b537fef90762d11; deployment=PENDING merge to main then edge deploy; environment=development; migrations=NONE (consumes existing operator_commercial_customers + operator_billing_overview); edge=paige-ai-chat; evidence=this record + CI
RELEASE_CHANNEL: development: internal engineering slice; local/development build environment; no staged rollout.
RELEASE_CLASSIFICATION: internal-only: Operator conversational capability.
CUSTOMER_RELEASE_IDENTITY: none: internal Operator capability.
RELEASE_NOTE_REQUIRED: no: internal Operator surface.
RELEASE_TRUTH_BOUNDARY: PARTIAL: source + lint + fingerprints + suites verified; post-deploy live re-probe and owner console re-ask PROOF OWED.
RELEASE_RECOVERY: position=forward-fix (additive persona branch + two read tools; revert-safe); reference=PR CI + this record.
