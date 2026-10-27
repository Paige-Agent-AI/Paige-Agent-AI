# UI delivery evidence: exp07-publish-repairs (independent-review repairs to the publish affordance + door)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the independent non-author review of #2895/#2922/#2924 (fresh reviewer, no author context) returned one P1 and two P2s; this PR repairs all three. (F1) P1 — the shipped approve call sent only the fingerprint; the REAL door requires the piece and channel on every publish action and answered 400 to every real approval, so the shipped flow could not publish (the drive's permissive stub had masked it). The approve call now carries the piece, the channel from the door's own preview, and the caption; the harness stub now enforces the REAL door's body contract so this class of drift fails the drive. (F2) P2 — an approve presenting a proposal's fingerprint while naming a different channel in its body passed the pre-claim checks on the wrong target and executed the claimed args; the door now refuses CLAIM_MISMATCH unless the claimed content_id and platform equal the request's. (F3) P2 — two live approvals with different fingerprints (owner + a second admin, two tabs) could both pass the reconcile gate and both post, and a crashed attempt left at publishing never blocked a retry; the door now refuses while any approved or in-flight row stands for the same piece+channel (the proposal stays allowed; the approve is refused). (F4) the dead decline fallback (a condition that could never fire) is removed — a decline the door could not record renders the door's own failure sentence.
PAIGE_UI_DESIGN: PASS: read .agents/skills/paige-ui-design/SKILL.md; impeccable 4.1.0 detect over the changed files exit 0; no new visual direction — the panel's states are unchanged, only the requests it sends and the sentences it can render.
MATERIAL_FLOW_CHANGE: NO: same flow, same states, same door; this repairs what the flow sends and adds two door-side refusals that were always the design's claim.
FLOW_PROTOTYPE: NOT_REQUIRED: no material flow change; the repaired approve flow is the approved prototype from exp07-publish.md with its request fixed to the door's real contract.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: unchanged from exp07-publish.md — approve the door's exact preview and post once; the repair makes that action actually reach the door.
VISUAL_DIRECTION: PASS: unchanged; no new styles.
AUTOMATED_EVIDENCE: PASS: the door suite grows to 18 (the governance double now returns the PROPOSAL's stored args on claim, as the real module does — the drift that let the mismatch ship; the world's PostgREST double now filters .in() and exposes .limit()); new tests: claim/request mismatch refused with the provider never called; an in-flight row blocks the approve while the proposal still answers 202; the exact UI approve body shape executes and publishes. The harness stub refuses a fingerprint-only approve exactly as the real door does. Drive re-run 82/82 on the repaired UI against the hardened stub.
STATIC_EVIDENCE: PASS: eslint clean on changed files; the ci:tsc ratchet is the PR gate; no migration (the two SQL P3s — the reconcile gate's silent FALSE without a tenant, and the receipt ordering tiebreaker — are recorded as owed for the media-library migration, not silently dropped).
RENDERED_EVIDENCE: PASS: docs/evidence/ui-delivery/assets/exp07-publish/ (visuals unchanged — the repair is in what the panel sends); the drive JSON re-recorded under the hardened stub.
BEHAVIORAL_EVIDENCE: PASS: drive 82/82 post-repair; the full governed flow (prepare, the door's preview, approve, published with link) passes against a stub that now enforces the real door's approve contract.
AUTHENTICATED_RUNTIME: UNVERIFIED: harness only; the authenticated live drive (a real owner with a real connected channel) remains the row-10 customer proof owed.
KEYBOARD_FOCUS: PASS: unchanged interactives; native buttons and links only.
ZOOM_REFLOW: UNVERIFIED: unchanged from exp07-publish.md (overflowX=0 at four viewports measured there).
REDUCED_MOTION: PASS: no motion.
STATE_COVERAGE: PASS: the two new refusal codes (CLAIM_MISMATCH and the broadened in-flight refusal) are covered by the door suite; every prior state unchanged.
TRUTHFUL_STATE_LABELS: PASS: the new refusals carry their own written sentences; no state invents an outcome the door did not receipt.
SOLO_UI: YES: src/solo/publish-piece.tsx (the Content tab's publish panel inside Solo).
SOLO_1536X770_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-1536x770-paige-closed.png (unchanged visuals; the flow behind them repaired)
SOLO_1536X770_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-1536x770-paige-open.png (unchanged)
SOLO_1366X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-1366x768-paige-closed.png (unchanged)
SOLO_1366X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-1366x768-paige-open.png (unchanged)
SOLO_1024X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-1024x768-paige-closed.png (unchanged)
SOLO_1024X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-1024x768-paige-open.png (unchanged)
SOLO_900X1000_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-900x1000-paige-closed.png (unchanged)
SOLO_900X1000_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/exp07-publish/solo-900x1000-paige-open.png (unchanged)
UNVERIFIED: the authenticated live drive (the standing row-10 proof owed); the two SQL P3s named above; the stream adapter's raw fetch timeout (review P3, noted for the media slice)
OWNER_INTENT: the owner's continuation command — obtain independent non-author review of #2895/#2922/#2924 and repair genuine findings; all P1 and P2 findings are repaired with the tests that would have caught each.
MUST_NOT_HAPPEN: an approve that executes different args than the proposal previewed; two concurrent approvals both posting; a crashed attempt leaving the retry gate open; a UI request shape the real door refuses.
MUST_PRESERVE: the door's server-authored preview, single-use claim, forward-only receipt walk and truthful terminals; every rendered sentence remaining the door's own.
ACCEPTANCE_CRITERIA: the shipped approve call reaches the real door and executes the exact previewed post once; mismatches and in-flight duplicates are refused with written sentences; the drive catches a fingerprint-only approve regression.
MOTION_PURPOSE: NONE: no motion.
PROTECTED_SEAMS: tested — claim/request binding (new), the in-flight guard (new), the UI approve body contract (stub-enforced and door-tested); unchanged — the governance seam, the receipt store's RPCs, the containment pins.
INTERNAL_BUILD_IDENTITY: 92ea608d3fbc6b110217aad774c2d0ad4cda2b81 (92ea608d3, branch exp07-review-repairs on main 691ce69a9); deployment=local-vite-harness; environment=local; migrations=NOT_APPLICABLE; edge=PROOF_OWED(stream-media-read unchanged by this PR); evidence=docs/evidence/ui-delivery/exp07-publish-repairs.md
RELEASE_CHANNEL: development: local harness only; not merged or deployed
RELEASE_CLASSIFICATION: internal-only: review repairs to an internal-only surface
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the repaired approve flow is live only after merge and the frontend deploy; the authenticated owner drive remains the customer proof
RELEASE_RECOVERY: position=revert-frontend-and-edge (a revert restores the prior door and panel with no data or schema to unwind); reference=this record and the deploy of the revert

## Scope

- **Added:** three door tests (claim mismatch, in-flight block, UI body shape); the stub's door-shaped approve validation; this record.
- **Changed:** supabase/functions/_shared/social-publish-command/door.ts (claim/request binding check + in-flight guard); src/solo/publish-piece.tsx (approve sends the full contract; dead decline fallback removed); the door world/test doubles (proposal-args memory on claim, .in() and .limit() filtering, tables exposure).
- **Deleted:** nothing.
- **Honest gaps:** the two SQL P3s (gate tenant-consistency, receipt ordering tiebreaker) and the adapter fetch timeout are recorded for the next migration-bearing slice; no per-tenant unique index yet (the door-side guard closes the duplicate window; the index lands with the media-library migration).
