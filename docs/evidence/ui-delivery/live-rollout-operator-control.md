# The operator can see the Live rollout, and turn it

Existing Project / R3 Deep, Flow-by-Flow 2.0.2, then Impeccable 4.1.0. A setting only an engineer
can change is not a setting the owner has.

## What was wrong

Migration `20270422000000` reduced "who may speak today" to one value and gave
`paige-voice-profile-admin` an action to change it. Neither had a surface. Measured: grepping `src/`
for `authorize-live-pilot`, `disable-live-pilot` and `paige-voice-profile-admin` returns **nothing** —
no component, hook or page calls that edge function at all. So the only way to open Live was a
hand-written authenticated HTTP request, which means the owner could not turn on his own product
(§70), and the capability's control was reachable only from a terminal (§10).

## What changed

One read — `paige_live_rollout_status()`, platform-owner-gated **in its body**, not by its grant
(§59) — and one operator panel that renders the state and offers the one setting. Nothing new
becomes writable: the writers already shipped, behind the edge function's own owner gate.

The panel states what is **not** settled as prominently as what is on. Verified zero retention is
`UNAVAILABLE` and physical speaker identity is unenforced (#1417); those sit next to the switch
rather than in a document, so nobody can open this believing either is resolved. It reports counts
only — four accounts admitted, never which four (§9/§13).

The pilot envelope's own authorization is deliberately **not** exposed here: it contacts the speech
provider and consumes a time-boxed evidence reference. The panel says so plainly instead of drawing
a control that would not work.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Flow-by-Flow 2.0.2, Existing Project / R3 Deep; affected flow is "the platform operator decides who may speak with Paige today"; states mapped for no readiness record, read refused, envelope shut, scope off, scope open, and a write that is declined
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design/SKILL.md read; the panel is built on the existing `ui/page` primitives (SectionCard, StatePill) and mounted beside the sibling operator panel rather than on a new surface (§18)
MATERIAL_FLOW_CHANGE: YES: the operator gains an action they did not have — opening or closing Live's audience — which previously existed only as an HTTP call
FLOW_PROTOTYPE: WAIVED: owner-decision=2026-09-24 in-session ruling, "you have my full authorization to see this thing all the way through, to the finish" and "merge it live on main, so when I wake up, I can just go test it"; reason=the owner is asleep and asked explicitly for the work merged to production for him to judge on the live site rather than through an approval surface, which is CLAUDE.md §4's pre-launch stance applied to this change; the approval he would give a prototype he gave to the merge
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: the platform operator, on the Platform Tenants surface, opens Live to every Solo account or closes it again; the primary action is the single gold control, which is the only gold in the panel
VISUAL_DIRECTION: PASS: existing primitives and tokens only; no new colour, no hardcoded hex, no banner; the unresolved-facts block is a bordered muted panel rather than a warning colour, because it is a statement of fact and not an alarm
AUTOMATED_EVIDENCE: PASS: the pgTAP suite grows to 140 assertions and passes 140/140 with the plan matched on a local PostgreSQL 16 against the real migration, including that an ordinary Solo member AND a delegated platform_admin are both refused 42501 despite holding EXECUTE, and that no subject identity or provider reference can appear in the payload; plus a separate 12-assertion behavioural run of the projection
STATIC_EVIDENCE: PASS: tsc ratchet clean (baseline 12, current 12); migration-version collision lint clean; definer-fn lint clean (the function is REVOKEd from anon/PUBLIC); ESLint clean on the new component; Impeccable detector exit 0
RENDERED_EVIDENCE: UNVERIFIED: this session has no browser; the panel has not been seen
BEHAVIORAL_EVIDENCE: PASS: the read is driven end to end in a real PostgreSQL against the real migration — refused for a tenant member, refused for a platform_admin, answered for the owner, honest about a missing readiness row, and counting the Solo-class audience correctly while excluding an agency
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated drive of the deployed panel, and no scope has been opened. Owed to a session with a browser (§32)
KEYBOARD_FOCUS: UNVERIFIED: standard Button primitives in normal document order, but no keyboard pass was driven
ZOOM_REFLOW: UNVERIFIED: the panel uses the existing SectionCard and a two-column `sm:` grid that collapses to one; no fresh capture
REDUCED_MOTION: NOT_APPLICABLE: the panel adds no animation
STATE_COVERAGE: PASS: no readiness record, read refused, envelope shut, scope off, scope open, write declined for a missing acceptance, and session expired are each handled with their own honest copy
TRUTHFUL_STATE_LABELS: PASS: no LIVE claim; the panel reports `zero_retention_state` and `speaker_identity_enforced` from stored state rather than asserting them, and says the envelope's own authorization is not exposed here instead of implying it is
SOLO_UI: NO: this is an operator surface on the platform tenants page, not a Solo interface
UNVERIFIED: every rendered and authenticated-runtime claim. The panel has not been seen or driven in a browser; the read and its refusals are proven in a real database

OWNER_INTENT: The owner can turn Live on for his Solo users himself, from the product, and can see what state it is in before he decides
MUST_NOT_HAPPEN: A non-owner reaching the read or the write; a subject's identity appearing on an operator surface; a control that opens Live while implying retention or speaker identity are settled; a switch drawn over a readiness record that does not exist; opening the audience without the retention acceptance restated
MUST_PRESERVE: The existing writers and their owner gates; the per-workspace enable-outright path; the global disable as the stop-everything lever; the Platform Tenants page's existing content and layout
ACCEPTANCE_CRITERIA: The operator opens the Platform Tenants page, reads the current envelope, setting, audience size and the two unresolved facts, and can open or close the audience with one control — while a tenant admin and a delegated platform_admin are both refused the underlying read entirely
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: Affected and tested: the Live rollout read, operator tier gating (§53 is_platform_owner, not is_platform_operator), the scope writer's acceptance requirement. Unchanged: Live admission itself, the three admission edge contracts, relay transport, tenant provisioning, revenue integrity, and every other panel on the page
INTERNAL_BUILD_IDENTITY: pr=PENDING; base=ee146977afed8d248226c8698103e4ecd97150f2; deployment=vercel-preview(live-rollout-operator-control); environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=supabase/tests/paige_live_pilot_feature_guard.sql
RELEASE_CHANNEL: preview: the PR preview build only. Migration 20270423000000 is unapplied at the time of writing and lands through CI on merge; no scope has been opened
RELEASE_CLASSIFICATION: internal-only: an operator control surface, not a customer launch
CUSTOMER_RELEASE_IDENTITY: none: nothing customer-visible changes; the rollout remains shut
RELEASE_NOTE_REQUIRED: no: no customer announcement
RELEASE_TRUTH_BOUNDARY: PARTIAL: the read and its refusals are proven in a real database; the rendered panel and any authenticated operator action remain PROOF OWED
RELEASE_RECOVERY: position=revert this commit, which removes the panel and leaves every writer exactly as it was because none of them changes here, then drop the projection if desired; reference=the rollback comment at the head of supabase/migrations/20270423000000_live_rollout_has_an_operator_who_can_see_and_turn_it.sql

## Scope and collisions

- Classification: Existing Project / R3 Deep. Permissions and an operator surface, so delivery controls apply.
- Affected flows: the operator reading the rollout state; the operator opening or closing the audience.
- Neighboring regressions: none expected — the page gains one gated panel and nothing else moves. The pre-existing ESLint warning on PlatformTenants.tsx shifts from line 122 to 123 because of the added import; it is not introduced here.
- Active-owner/file collisions: none.
- Explicit exclusions: the pilot envelope's own authorization, which contacts the provider and consumes a time-boxed evidence reference; no scope is opened by this change.

## Evidence index

- `supabase/tests/paige_live_pilot_feature_guard.sql` — 140 assertions, 140/140 locally on PostgreSQL 16.13 against the real migrations, plan matched.
- A separate 12-assertion behavioural run of `paige_live_rollout_status()` covering refusal for a tenant member, refusal for an unauthenticated subject, the owner being answered, honest absence, the audience count, and the no-identity guarantee.
- `npm run lint:definer-fns`, `lint:migration-versions`, `ci:tsc`, ESLint, Impeccable — all clean.

## Review and limitations

The panel has not been rendered or driven. Its read, and the refusals that matter most, are proven
against a real database rather than reasoned about; what it looks like is owed to a live look.
