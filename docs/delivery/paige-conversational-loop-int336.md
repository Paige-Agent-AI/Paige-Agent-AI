# INT-336 — typed Chat interruptibility

SHELL: SOLO
Parent: INT-304 — Conversational Loop
Grounding: origin/main 6b6bef5091507e5b7946984506e75cfb3ebd5401, fetched 2026-10-06.
Flow-by-Flow: applied (repair, Deep, web); Impeccable: applied (Operate, incumbent refinement, harden).
Owner approved the interaction and explicitly waived further prototype review on 2026-10-06. Local deterministic prototype: outputs/int-336-interaction-prototype.html in the coordinator chat. No provider effects.

OWNER_INTENT: An owner on canonical Solo Chat can type continuously while PAIGE works and send a new canonical instruction that supersedes the old interactive response.
MUST_NOT_HAPPEN: Two interactive executors; stale answer tails; duplicate effects; treating interruption as rollback/failure; cancelling durable work; prose approval; automatic unbound ASK_USER answer; lost drafts or focus/scroll seizure; scope leakage.
MUST_PRESERVE: Existing canonical thread, request fence, C4 state, exact approval fingerprints, explicit answer binding, readback and uncertainty, durable work, all scope hydration fences, Shift+Enter/IME, shell tokens and transcript scroll owner.
ACCEPTANCE_CRITERIA: Owner F1–F14 across long/fresh threads, rapid followups, completed/unknown effects, approvals, ASK_USER, durable jobs, workspace/thread switches/reload; desktop/mobile authenticated production proof.

## Pre-edit capability routing
1. Outcome: continuous typing and Send-to-interrupt on a resolved Solo conversation.
2. Domain: Conversational Loop / Chat Experience, INT-336; C4d/C4e, C5, model router and intelligence fabric stay separate.
3. Harness: existing Chat governed execution (Layer A PARTIAL per completion map); canonical thread execution exclusivity absent in grounded source, extended here rather than bypassed.
4. Spine: no new domain.capability; interactive lifecycle is not a business action. Existing tools retain their registered capability keys and authority.
5. Provider: no new connection or provider authority. Existing model/tool adapters remain; authentic model proof required.
6. Authority: lifecycle supersession grants no MUTATION_VERB, approval, budget or autonomy. Existing action-risk/Trust Compass and one-approval gate remain.
7. Durable: no new scheduler/job. paige_durable_work jobs remain independent.
8. Receipt: existing capability-specific readback/receipts and canonical turn_state interruption record, never fabricated rollback.
9. Surface: canonical PAIGE Chat; no ledger maturity promotion from tests or deployment.
10. Proof: automated/static/rendered/interactive/authenticated/provider/deployment claims separate; production unverified until driven.

## Regression boundaries
Affected: scope/user/tenant/client/mission isolation; thread hydration; stream identity/scroll/popout; approval/C4 answer binding; tool boundaries/canonical writes/readback/receipts; durable-work independence; keyboard/focus/mobile geometry; provider uncertainty.
Unaffected: entitlement/signup/paywall/billing/provisioning logic; Secure Browser/Vault permissions; domain provider contracts; Live voice runtime (reference only); shell routing/navigation.

## Initial independent non-author finding
BLOCKER: client fence aborts fetch/UI delivery but paige-ai-chat does not stop model/tool rounds. A client-only unlock permits competing server executors. Extend canonical thread authority to accept the newest instruction and serialize interactive dispatch; settle dispatched effects before handing off. No timeout-stealing uncertain executor.

## Evidence boundary
No implementation, CI, merge, deployment or production claim is earned by this packet. Browser CUA initialization failed: trusted Node process exited unexpectedly. Shell sandbox startup failed apply deny-read ACLs; read-only and authorized commands outside sandbox work. Production UI proof remains UNVERIFIED until browser runtime is restored or another supported authenticated path is available.
