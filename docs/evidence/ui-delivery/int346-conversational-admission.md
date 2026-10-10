# INT-346: conversational admission while the interactive rollout is staged

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the ordinary typed-message flow is the repaired flow — send a message in Solo Chat, receive a streamed answer on the same thread, follow up in the same thread; while the version-2 rollout is staged every such turn runs without actions, says so in the composer notice, and approval cards are refused truthfully without consumption
PAIGE_UI_DESIGN: PASS: established Chat surface retained; the one new affordance reuses the incumbent inline status block pattern verbatim from the same file
MATERIAL_FLOW_CHANGE: NO: restores the shipped typed-conversation flow under a bounded server-enforced degraded mode; introduces no new user flow beyond a truthful status line
FLOW_PROTOTYPE: NOT_REQUIRED: outage restoration within the shipped conversation flow; no new surface designed
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo owner types a question; PAIGE answers in words on the same thread and states plainly that actions cannot run until the platform update finishes
VISUAL_DIRECTION: PASS: incumbent Solo Chat design; the notice copies the existing muted inline status styling with no new color, spacing language or motion
AUTOMATED_EVIDENCE: PASS: new scripts/int346-conversational-handler-check.mjs drives the real handler with the exact browser payload (eight legs incl. failing-first 503 reproduction before the fix, adversarial provider tool call, approval refusal, interruption) and scripts/int346-conversational-db-check.mjs proves the admission contract plus both reviewed race boundaries on real PostgreSQL 16; the int336/int346 handler, database and rollout families and the spine registry self-test all rerun green; the 29 frozen incumbent dispatch fingerprints are recomputed so the new dispatch-corridor refusal is itself pinned by the spine contract
STATIC_EVIDENCE: PASS: migration lint 0 warnings; Deno edge ratchet base 9 head 9 with no new diagnostics; tsc ratchet baseline 10 current 10; eslint clean on changed client files; vitest composerScope 46/46 incl. the new notice pin
RENDERED_EVIDENCE: UNVERIFIED: jsdom component proof only; no signed-in browser screenshot claimed before deployment
BEHAVIORAL_EVIDENCE: PASS: real handler against recorded doubles — message accepted while DRAINING with zero tools offered, unoffered tool call refused at dispatch, no executor claim, one server-issued FINAL receipt, replay idempotent, broken stream settles INTERRUPTED with the partial answer; actual SQL on isolated PostgreSQL — conversational settle without executor preserves a stale claim, forged and foreign settlements refused, activation still drain-gated, ACTIVE retires the class
AUTHENTICATED_RUNTIME: UNVERIFIED: a signed-in Solo account sending a real message in production remains the owed runtime proof; no synthetic claim substitutes for it here
KEYBOARD_FOCUS: UNVERIFIED: no focus-order edit; signed-in keyboard regression still owed
ZOOM_REFLOW: UNVERIFIED: no geometry edit beyond one inline status line; signed-in viewport regression still owed
REDUCED_MOTION: NOT_APPLICABLE: the change introduces no motion
STATE_COVERAGE: PASS: staged and active protocol states, broken rollout metadata, duplicate and superseded replays, foreign thread and actor, approval-bearing request, adversarial provider tool call, dangling provider stream, stale pre-rollout executor claim, direct column write attempt
TRUTHFUL_STATE_LABELS: PASS: the notice states exactly what the server enforces; PAIGE is instructed never to claim an action ran; an unfinished answer records INTERRUPTED, never FINAL; the approval refusal says the decision was not consumed
SOLO_UI: NO: changed UI file is the shared dashboard chat component, not a src/solo path; the server enforcement covers every current and future Solo shell identically
UNVERIFIED: hosted checks on the final head, merge, deploy and authenticated production verification are ahead at candidate preparation; independent non-author security review of the candidate is COMPLETE (no blocking finding; both review findings dispositioned below)
OWNER_INTENT: restore ordinary typed Chat safely while the version-2 activation waits on the provider cessation packet (#1822); never bypass or weaken the interactive security authority.
MUST_NOT_HAPPEN: no consequential tool execution, approval consumption, external write, legacy executor acquisition, untrusted settlement or replayed action through the degraded mode.
MUST_PRESERVE: INT-346 server-issued receipts and the activation gate, INT-336 fencing and supersession, the unknown-effect brake, OpenAI-first Model Fabric routing, tenant/actor/thread scope checks, truthful interrupted and unavailable states.
ACCEPTANCE_CRITERIA: an authenticated Solo user sends an ordinary message and receives a completed streamed answer on the same thread with follow-up intact; no effectful capability is available or advertised; the exact browser payload can never again be refused 503 solely because the rollout is staged.
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: paige_chat_interactive_begin_v2 admission class, paige_chat_interactive_settle executor binding, paige_chat_interactive_columns_guard, paige_chat_interactive_activate drain gate; Spine catalog, approval doors, Model Fabric and receipt/Rail contracts untouched.
INTERNAL_BUILD_IDENTITY: 302bca9799d29a0bebf3b6071f3cce264a2ec811 (candidate head on branch int346-hotfix; exact head recorded in the PR); deployment=PROOF_OWED(not merged); environment=development; migrations=PROOF_OWED(candidate migration 20270602000301_int346_conversational_admission not applied); edge=PROOF_OWED(candidate paige-ai-chat not deployed); evidence=this record plus scripts/int346-conversational-handler-check.mjs and scripts/int346-conversational-db-check.mjs
RELEASE_CHANNEL: development: candidate only; production identity recorded after actual deployment
RELEASE_CLASSIFICATION: patch: core-product outage restoration with a bounded degraded mode
CUSTOMER_RELEASE_IDENTITY: none: routine repair does not create a named customer release
RELEASE_NOTE_REQUIRED: no: no customer announcement
RELEASE_TRUTH_BOUNDARY: PARTIAL: workspace and isolated databases; production deploy, activation and authenticated owner acceptance PROOF OWED
RELEASE_RECOVERY: position=forward-fix; reference=if the degraded mode misbehaves the protocol gate can refuse messages again by reverting this patch; never activate the rollout to work around it

## Scope, routing and collisions

Chat execution portfolio family; the single canonical Solo Chat surface, its server functions and the existing interactive protocol. No new chat backend, execution engine, approval system, receipt store, conversation database, provider router, model configuration layer or tenant authority — the change extends the existing begin/settle functions with one admission class and reuses the existing settlement, lifetime and stream machinery unchanged. Model Fabric, Spine catalog, autonomy lanes and Rail receipts have no changed claim.

Fresh main was a164649e05c5dfdee73bb5432775950c1580a1ff (the owner's stated verified head). Migration version 20270602000301 clears main's newest (20270602000203), production's applied frontier and both open-PR claims at 20270602000204 (#1897/#1893) — rechecked immediately before merge per standing order. The prior Conversational Loop agent's work is all merged (#1823 c43eeec24, #1835 bbf721c95, #1859, #1862, #1871, #1874, #1877, #1878); no unmerged chat branch was found; nothing was overwritten.

## Why PATH A (activation) is not this patch

The live rollout row reads active=false with no edge head, no drain digest and zero held executors (read-only readback 2026-10-10). Activation still requires the positively verified provider cessation packet this issue's review authority defined: per-execution authoritative Shutdown records for the pre-rollout generations (including v358) or a control-plane attestation. Those records aged out of the 24h bounded log window before capture (2026-10-08 coordinator note), and the review authority explicitly ruled elapsed runtime bounds, log silence, a newer deployment and empty executor rows insufficient. A Supabase control-plane attestation remains an external owner/provider action; this patch neither fabricates a drain digest nor flips the rollout boolean. The conversational admission disappears automatically once activation lands, so PATH A and PATH B compose rather than compete.

## Repair shape and safety boundaries

While version 2 is staged, the gate admits an ordinary typed message as a conversational turn: begin records the admission class server-side (interactive_admission, guarded like every interactive column), the turn acquires no executor, the model is offered zero tools (the whole 187-tool list is withheld before exposure, projection and manifest derive from the empty list), dispatch refuses any tool call a provider emits anyway, approvals are refused before acceptance with nothing consumed, and settlement is still a server-issued receipt through paige_chat_interactive_settle — the same sole terminal writer, now also permitting a receipt for the current conversational admission when no executor was ever held, while a stale pre-rollout claim on another intent is preserved and still blocks activation. Broken rollout metadata (missing RPC, wrong version, null row) still fails closed with 503 for every kind. Stop and status keep their always-available contracts. Once ACTIVE, begin refuses conversational admissions and effectful work resumes exactly as #1823 designed; a conversational intent that is no longer the thread's current admission cannot use the relaxed settle branch.

Client: the server announces `paige_mode: conversational` as an additive stream frame; the chat shows the incumbent-style status line; an approval-bearing request that is refused maps to the honest "Actions are paused" title with the server's reason; nothing about enforcement lives client-side.

The race where activation lands between the protocol read and begin resolves to a refused begin (INTERACTIVE_PROTOCOL_REQUIRED) surfaced as the standard acceptance-boundary unknown — truthful, retryable, no security impact. Deploy-order window: if the Edge candidate runs before the migration, begin's p_effectful argument is unknown to the old function and the request fails closed as acceptance-unknown until both deploys land; migrations and Edge both deploy on merge.

## Independent non-author review (2026-10-10)

A fresh-context read-only reviewer drove the actual handler and an isolated PostgreSQL 16 cluster, independently reproduced the failing-first 503 at the base, and attacked the five claim areas with its own SQL probes. Verdict: no blocking finding. Two findings, both dispositioned:

1. The relaxed settle branch is bounded by "still the thread's CURRENT conversational admission", not by the rollout row: an activation racing an in-flight conversational turn lets that one turn settle truthfully afterward (service-role only; no new conversational admission can exist once ACTIVE). Disposition: accepted and PINNED as a DB-check case with the boundary documented in the migration; not cleared in activate, because clearing it would turn the benign one-turn race into a failed turn while protecting nothing a client can reach.
2. A Stop-superseded conversational turn records no receipt (fail-closed; the transcript shows the user turn without a reply) and Stop previously left a stale admission value. Disposition: Stop now clears the admission class with the latest intent (hygiene, no semantic change — the stopped intent was already unsettleable), the refusal is pinned by a DB-check case, and the no-record outcome is recorded here as a known limit of the degraded mode only: an effectful superseded executor may still finish its receipt, a stopped degraded turn may not.

Reviewer-recorded residual risks carried forward: the dormant still-current settle window above; concurrent distinct-intent conversational turns interleave with first-settle-wins (non-effectful, composer-fenced); a degraded turn with an attachment still performs ingestion-side reads/writes (not governed actions).

## Spine corridor fingerprints

The conversational dispatch refusal sits in the executeToolCalls corridor the C0b incumbent contract freezes, so the guard correctly tripped (all 29 incumbent fingerprints changed). The fingerprints were recomputed with the validator's own extractor over the changed source and reviewed in the fix round — which means the refusal is now itself frozen into every incumbent tool's contract: removing or weakening it trips the spine lint.
