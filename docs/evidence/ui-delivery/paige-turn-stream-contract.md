# UI delivery evidence: paige-turn stream contract (conversational loop C1)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: docs/delivery/paige-conversational-loop-c1.md holds the pre-edit packet (actor-goal flows: ask PAIGE in Studio, Operator and portal chat and read the reply; send and greeting; every stream exit), the regression map and the As built section. The consumer migration was traced flow by flow against each consumer's prior branch order.
PAIGE_UI_DESIGN: PASS: the paige-ui-design router (.claude/skills) and the canonical .agents/skills/paige-ui-design/SKILL.md, references/paige-quality-gates.md and references/review-and-testing.md were read; no visual direction is involved — the two UI files change only their SSE read loop (the shared parser src/lib/paige-stream), nothing renders the new paige_turn frame, and every frame that did render renders the same. The visible living response is C3, which keeps its Impeccable and prototype gate.
MATERIAL_FLOW_CHANGE: NO: every migrated consumer renders the same frames in the same order as before. The paige_turn frame is dropped without render. The only behavioural deltas are the two sanctioned parser fixes from the packet and the flush of a final unterminated SSE line, which real streams never send.
FLOW_PROTOTYPE: NOT_REQUIRED: no flow change and nothing visible changes; there is nothing to prototype until C3 renders the turn state.
PURPOSE_AUDIENCE_PRIMARY_ACTION: NOT_APPLICABLE: no surface changes; the primary action on each chat surface (send a message, read the reply) is unchanged.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual change.
AUTOMATED_EVIDENCE: PASS: characterization suites src/solo/studio/useStudioChat.stream.test.tsx, src/operator/data/useOperatorChat.stream.test.tsx and src/components/app/PaigeChat.stream.test.tsx (send and greeting) pin the old behaviour on the new parser; src/lib/paige-stream tests (39); paige-turn-reducer; n5. Vitest 62 files 1099/1099; test:knowledge-scope 418/0; test:client-memory-authz 553/0.
STATIC_EVIDENCE: PASS: eslint 0 errors on changed src (2 pre-existing warnings in PaigeChat.tsx); ci:tsc 10 at baseline 10; deno check paige-ai-chat 11 errors, the same codes as origin/main; capability-declaration and chat-tool-registry lints pass.
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered output changes; the frame is not rendered by any consumer.
BEHAVIORAL_EVIDENCE: PASS: characterization tests drive each consumer with recorded stream shapes (content, cards, done, malformed lines, aborts) and assert identical state transitions before and after the migration; mutation proofs listed in the packet.
AUTHENTICATED_RUNTIME: UNVERIFIED: this lane has no authenticated session. An owner chat on Studio, Operator and portal after deploy is owed to confirm replies stream exactly as before.
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive element changes.
ZOOM_REFLOW: NOT_APPLICABLE: no layout changes.
REDUCED_MOTION: NOT_APPLICABLE: no motion changes.
STATE_COVERAGE: PASS: streaming, done, abort, error, malformed line and greeting paths are each pinned on every migrated consumer.
TRUTHFUL_STATE_LABELS: NOT_APPLICABLE: no label renders the turn state in this slice.
SOLO_UI: YES: useStudioChat (the Vibe Studio chat hook under src/solo/studio) changes only its stream read loop; no Solo layout, geometry or rendered state changes.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (the hook's read loop only, pinned by useStudioChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (the hook's read loop only, pinned by useStudioChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (the hook's read loop only, pinned by useStudioChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (the hook's read loop only, pinned by useStudioChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (the hook's read loop only, pinned by useStudioChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (the hook's read loop only, pinned by useStudioChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (the hook's read loop only, pinned by useStudioChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (the hook's read loop only, pinned by useStudioChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
UNVERIFIED: the authenticated production drive of each chat surface after deploy and a production stream sample showing paige_turn frames; every static and behavioural claim above is proven by the recorded suites at this head.
OWNER_INTENT: owner-approved conversational-loop sequence (C0a to C6, 2026-10-04): C1 gives every turn a truthful started and ended signal that the client can read through one shared parser, so the later living response (C3) renders from facts rather than guesses.
MUST_NOT_HAPPEN: no change to what any chat surface shows; no prose, ids or evidence in the turn frame; no FINAL claimed for a turn that did not answer, beyond the documented provisional window; no change to PaigeAIChat or usePaigeThreads in this slice.
MUST_PRESERVE: each consumer's branch order, done handling, content handling and dedup; the bundle_ref keys every reader picks by name; the persist gate; assistantTurnMetadata.
ACCEPTANCE_CRITERIA: an owner chatting in Studio, Operator and the portal sees replies, cards and greetings exactly as before; the stream carries one started and one terminal paige_turn frame; the assistant turn row carries bundle_ref.turn_state.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: the chat SSE contract (existing frames unchanged, two frames added and ignored), bundle_ref schema (additive keys only), describeStep vocabulary (unchanged); NONE_AFFECTED otherwise.
INTERNAL_BUILD_IDENTITY: 667ce17f871d03d7b7d6b6e1627f24fed3d52459; deployment=none-pre-merge; environment=local development candidate; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-ai-chat changes and CI deploys it on merge); evidence=PR #1710
RELEASE_CHANNEL: development: pre-merge candidate; production via merge to main per the pre-launch stance.
RELEASE_CLASSIFICATION: internal-only: a stream and record contract with no visible surface.
CUSTOMER_RELEASE_IDENTITY: none: no customer-visible capability in this slice.
RELEASE_NOTE_REQUIRED: no: nothing visible changes.
RELEASE_TRUTH_BOUNDARY: PARTIAL: the contract and parser behaviour are proven by tests and both harnesses; a production stream sample and the authenticated owner drive are PROOF OWED.
RELEASE_RECOVERY: position=forward-fix or revert the squash, after which CI redeploys paige-ai-chat, with no data conversion since bundle_ref gains additive keys on new turns only; reference=PR #1710 and docs/delivery/paige-conversational-loop-c1.md

## Scope and collisions

- Classification: internal stream contract plus a client parser consolidation; no visible change.
- Affected flows: send and receive in Studio chat, Operator chat and portal chat (send and greeting).
- Neighboring regressions: the #1701 research card frames (still emitted and persisted; deep-research-inline tests pass).
- Active-owner/file collisions: PaigeAIChat.tsx and usePaigeThreads.ts deliberately untouched (C1b).
- Explicit exclusions: any rendering of the turn state (C3).

## User job and state map

The person sends a message and reads PAIGE's reply. Nothing about that changes. The stream gains a `paige_turn` started frame and one terminal frame, which every consumer ignores.

## Evidence index

See AUTOMATED_EVIDENCE and the packet's As built section for the exact suites, harness case ids and mutation table.

## Review and limitations

Three review rounds by an independent adversarial verifier and a compliance officer; every finding is fixed or recorded under the packet's Known gaps. Authenticated runtime is UNVERIFIED.
