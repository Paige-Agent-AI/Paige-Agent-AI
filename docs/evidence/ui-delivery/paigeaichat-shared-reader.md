# UI delivery evidence: PaigeAIChat on the shared stream reader (conversational loop C1b)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: docs/delivery/paige-conversational-loop-c1.md section "C1b as built" — actor-goal flows traced for the dashboard chat (send, stream, cards, approval resume, client-scope refusal, Live voice, incomplete-turn rollback); 31 characterization tests pinned the old loop before the edit.
PAIGE_UI_DESIGN: PASS: the paige-ui-design router and .agents/skills/paige-ui-design/SKILL.md, references/paige-quality-gates.md and references/review-and-testing.md were read; no visual direction is involved — PaigeAIChat changes only its SSE read loop (the shared reader src/lib/paige-stream), every frame renders exactly as before, and the paige_turn frame is dropped.
MATERIAL_FLOW_CHANGE: NO: every frame PaigeAIChat handles produces the same state in the same order, including the incomplete-turn timing after a malformed line (preserved by the reader's additive malformed:"drain" option). Deviations only on inputs the server never sends: a final unterminated line is delivered; non-string content is ignored.
FLOW_PROTOTYPE: NOT_REQUIRED: no flow change and nothing visible changes; there is nothing to prototype until C3 renders the turn state.
PURPOSE_AUDIENCE_PRIMARY_ACTION: NOT_APPLICABLE: no surface changes; the primary action on each chat surface (send a message, read the reply) is unchanged.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual change.
AUTOMATED_EVIDENCE: PASS: src/components/dashboard/PaigeAIChat.stream.test.tsx 31 tests (30/31 on the unmodified file; the one difference is the sanctioned non-string content case), src/lib/paige-stream 42, every test file mentioning PaigeAIChat plus the four stream suites: 440 passed, 1 skipped.
STATIC_EVIDENCE: PASS: eslint clean on changed files; ci:tsc 10 at baseline 10; no edge or migration change.
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered output changes; the frame is not rendered by any consumer.
BEHAVIORAL_EVIDENCE: PASS: the characterization suite drives the real component with recorded stream shapes (framing, cards, approvals, CRM, research, artifacts, proposal, client scope, compaction, Live voice, malformed and throwing frames with their body-end timing); mutation proofs in the packet.
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in session in this lane. Owed after deploy: an owner chat on the main PaigeAIChat surfaces (/solo, /agency, /business), Studio, Operator and the portal, confirming replies, cards, approvals and greetings stream as before.
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive element changes.
ZOOM_REFLOW: NOT_APPLICABLE: no layout changes.
REDUCED_MOTION: NOT_APPLICABLE: no motion changes.
STATE_COVERAGE: PASS: streaming, done, body-end without done, malformed line, throwing frame, approval turn dropped, client-scope permission vs non-permission refusal, Live signed output, done, error and interruption — each pinned.
TRUTHFUL_STATE_LABELS: NOT_APPLICABLE: no label renders the turn state in this slice.
SOLO_UI: YES: PaigeAIChat is mounted on the Solo PAIGE workspace (SoloPaigeWorkspace); only its stream read loop changes; no Solo layout, geometry or rendered state changes.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (PaigeAIChat's read loop only, pinned by PaigeAIChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (PaigeAIChat's read loop only, pinned by PaigeAIChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (PaigeAIChat's read loop only, pinned by PaigeAIChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (PaigeAIChat's read loop only, pinned by PaigeAIChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (PaigeAIChat's read loop only, pinned by PaigeAIChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (PaigeAIChat's read loop only, pinned by PaigeAIChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (PaigeAIChat's read loop only, pinned by PaigeAIChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no browser in this session. No geometry, layout, container or rendered state changed (PaigeAIChat's read loop only, pinned by PaigeAIChat.stream.test.tsx), so no reflow is expected; the claim is nonetheless unproven and owed to a browser-capable session.
UNVERIFIED: the authenticated drive of all four chat surfaces after deploy; every static and behavioural claim above is proven by the recorded suites at this head.
OWNER_INTENT: owner response after C1 (2026-10-04): move PaigeAIChat onto the shared reader, preserving all existing content, approval cards, research cards, CRM results, greeting behaviour and saved-thread semantics; do not alter product behaviour simply to complete reader convergence.
MUST_NOT_HAPPEN: no visible or timing change on any frame the server sends; no card lost or reordered; no change to thread saving, approvals, client-scope refusal or Live voice; no early rollback after a malformed line.
MUST_PRESERVE: PaigeAIChat's branch order and every per-frame check (confirm summary, receipt_recorded===true, artifact id/type, findings array, permission vs unknown refusal); the post-loop streamDone/outcome/rollback/live-interrupted branches; ticket guards; the other three consumers' behaviour.
ACCEPTANCE_CRITERIA: an owner chatting in the main PAIGE chat sees replies, cards, approvals, research, CRM results, artifacts and document proposals exactly as before; all four chat surfaces read through src/lib/paige-stream.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: the chat SSE contract (unchanged), the other three consumers (their characterization suites green), the shared reader (additive raw variant and drain option only); NONE_AFFECTED otherwise.
INTERNAL_BUILD_IDENTITY: base 2441d0697b6b1de6063170f4bf402f6ed8dec827 (the C1b commit sits on it); deployment=none-pre-merge; environment=local development candidate; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record
RELEASE_CHANNEL: development: pre-merge candidate; production via merge to main per the pre-launch stance.
RELEASE_CLASSIFICATION: internal-only: a client stream-reader consolidation with no visible change.
CUSTOMER_RELEASE_IDENTITY: none: no customer-visible change.
RELEASE_NOTE_REQUIRED: no: nothing visible changes.
RELEASE_TRUTH_BOUNDARY: PARTIAL: behaviour preservation is proven by characterization tests against the old file and mutation proofs; the authenticated four-surface drive is PROOF OWED.
RELEASE_RECOVERY: position=forward-fix or revert the squash (frontend only, Vercel rebuilds on merge) with no data conversion; reference=docs/delivery/paige-conversational-loop-c1.md C1b as built

## Scope and collisions

- Classification: client stream-reader consolidation; no visible change.
- Affected flows: the dashboard PAIGE chat (send, stream, cards, approval resume, client-scope refusal, Live voice).
- Neighboring regressions: Studio, Operator and portal consumers of the shared reader (suites green).
- Active-owner/file collisions: none.
- Explicit exclusions: rendering the turn state (C3).

## User job and state map

The person sends a message and reads PAIGE's reply with its cards. Nothing about that changes.

## Evidence index

See AUTOMATED_EVIDENCE and the packet's "C1b as built" section.

## Review and limitations

Independent adversarial verifier (SHIP) and compliance officer; their one ruling item (malformed-line timing) was closed by preserving the old timing exactly. Authenticated runtime is UNVERIFIED.
