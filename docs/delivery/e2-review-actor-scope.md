# EXP02 contextual review prerequisite — actor-scoped prepared reads

Owner October21 contextual review refinement, original ANT-13819 outcomes. This
small prerequisite extends the existing prepared-work hook for an opt-in caller
identity assertion. It adds no second reader, query family, suggestion registry,
work queue, authorization grant or data store. Existing callers retain their
current behavior until they opt in. No new customer UI or capability is activated.

## Pre-edit capability routing

1. Outcome: a future contextual review must never show the previous actor's loaded
   work while the same workspace resolves under a new actor.
2. Domain: EXP02 owns `useSoloPendingActions` and its existing owning tests. EXP01
   retains Chat/Live; domain writers remain their original Experiences. Original
   source reservations and prototype direction are in ANT-138/161/50.
3. Harness/Gateway: original caller-authenticated Supabase/RLS read of `paige_actions`;
   no Harness or execution-layer change. The optional actor is a UI assertion only.
4. Spine: this prerequisite registers no capability. Existing original UI read is
   tenant-scoped native prepared work; future Mission mutations retain registered
   `business_mission.create/revise/transition/targets` and their canonical gates.
   New generic prepared-action execution is UNAVAILABLE in this prerequisite.
5. Provider: none. Same native select, columns, exact count, filters, preview cap and
   ordering. No connection, model, spending, provider readiness or credentials.
6. Authority: read-only; no MUTATION_VERB, approval, budget or autonomy change.
   Actor assertion is never forwarded as identity or used to widen RLS.
7. Durable work/event: none. No job, scheduler, event, worker or transcript store.
8. Readback/receipt: original prepared rows remain authoritative; no work is
   completed and no new Rail receipt is created by this UI-scoped read.
9. Surface: no new mounted UI consumer yet. Original Business Game Plan and
   `paige.workspace` remain partial; Binding Ledger readiness is unchanged.
10. Proof: preserve original tenant query/count/mapper negatives; add explicit
    unresolved-actor no-read and same-workspace actor-switch/late-result masking.
    Hosted exact-head CI/review and safe release/readback remain gates. Native
    contextual UI and authenticated account/role/isolation acceptance remain owed.

## Dependency order and prototype boundary

First release this default-preserving identity binding. Then reuse its actual
prepared-work result in the existing Game Plan review projection/Decision Desk.
Finally connect the shared optional lower-composer affordance, preserving the
canonical Chat anchored-transcript controller and original EXP01 source boundaries.
No pending record becomes an executable action merely by entering a suggestion.

The local throwaway prototype selected an adjacent wide-screen overview and a
readable sheet at the original shell's1080px overlay boundary. It preserves Chat
draft/nonzero scroll/focus under simulated review/dirty-save/return, separates
source kinds and uncertain results, and uses original PAIGE shell/tokens/font.
Those are mock interaction observations, not actual Chat/RLS/provider acceptance.

Functional: the original source fails both new actor cases (2 FAIL /9 PASS);
the corrected source passes70 cases across the pending-work, Game Plan and
Executive owning suites. ESLint for both changed leaves and release-governance/
whitespace checks pass. Hosted exact-head CI and release remain gates. These
are source tests, not real actor/RLS acceptance. Visual: no new mounted interface in this slice.
Experiential: future consumer integration remains owed. Founder Acceptance: pending
the complete19-outcome/nine-capability Experience. Algorithm Support: no scoring,
prediction or new ALG03/13 implementation. Orchestration Contract: N/A, analytical
read only; no authorization, writer, execution identity or new Rail receipt.
Capabilities readiness: unchanged; no Live promotion from an unused API extension.

Source base:31bb0a91e0e2163fda0aab8a385636297b356d96. No schema/Edge/provider activation.
