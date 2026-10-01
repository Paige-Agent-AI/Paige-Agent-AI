# UI delivery evidence: the signer sees the uploaded document (A2)

Production grounding (2026-10-01): the byte-serving seam already existed — `agreement-document`
streams the exact frozen presented bytes of an open agreement to its signing token — but the
signing page never called it. An uploaded document (`document_path`, no `document_body`) rendered
a placeholder telling the signer to ask the business to resend the agreement as text, and the
scroll-measured read gate had nothing to measure. This slice renders the document itself and
makes the attestation honest.

UI_DELIVERY_EVIDENCE_VERSION: 1
SOLO_UI: NO: the changed surface is the public signer-facing signing page (src/pages/sign), not a Solo shell path; no Solo visual system, token or layout changed
FLOW_BY_FLOW: WAIVED: owner-decision=INT-083 go-live ruling 2026-09-20; reason=the Flow-by-Flow skill is not installed at the account level in this environment, whose account-level skill directory holds impeccable alone, so a flow-by-flow pass is genuinely unavailable here; the affected flow is grounded from source in STATIC_EVIDENCE
PAIGE_UI_DESIGN: PASS: the repository paige-ui-design skill body and its routed references were read completely; the existing signing page's visual system is preserved — the viewer occupies the existing document slot and the note lines inherit the body's leading
IMPECCABLE: PASS: the installed Impeccable skill context ran against the signing page and the craft floor was read before any edit; the change is a scoped refinement on incumbent authority — existing tokens, existing slot, no new visual system
MATERIAL_FLOW_CHANGE: YES: a signer of an uploaded document now reads the actual document in the page (previously an instruction to request a resend), and a new fail-closed state exists — signing stays locked while the document cannot be shown
FLOW_PROTOTYPE: WAIVED: owner-decision=the completion-lane assignment 2026-10-01 package A2; reason=the assignment fixes the flow verbatim (the signer opens the actual uploaded document; attestation language is truthful; no fabricated measured-reading percentage), and the failing-first suite pins the fetch, the viewer, the fail-closed gate and the attestation
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a signer opens their signing link, reads the actual uploaded document in the page, and signs at the bottom only after the document has been shown
VISUAL_DIRECTION: PASS: the existing signing page presentation, palette and typography are unchanged; the viewer fills the document slot and inherits its frame
AUTOMATED_EVIDENCE: PASS: the suite failed 3 of 5 on unchanged main and passes 5 of 5 — the token-door fetch, the viewer in the slot, the unreachable resend placeholder, the fail-closed gate with its honest failure line, and the attestation copy, each pinned to its wiring
STATIC_EVIDENCE: PASS: the page fetches agreement-document with the signer's own token when the row carries an uploaded document; only a non-empty Blob becomes a viewer; the read gate's two honest modes are pinned — a text body by measured scroll with its percentage, an uploaded document solely by the viewer actually showing it; no percentage is claimed over a PDF the product cannot measure; object URLs are revoked on replacement and unmount; TypeScript reports zero errors in the page
RENDERED_EVIDENCE: UNVERIFIED: the rendered page with a real PDF in the viewer across browsers and viewports is owed to the authenticated round; the layout uses the existing slot's frame with a min-height floor so the PDF cannot collapse
BEHAVIORAL_EVIDENCE: PASS: source-level wiring pins for the fetch, the blob-only acceptance, the fail-closed gate and the mode-specific attestation; the canary proves the text-body path and its measured gate remain byte-preserved
AUTHENTICATED_RUNTIME: UNVERIFIED: an owner sends an uploaded agreement and the signer opens the actual document on a real link, owed after merge
KEYBOARD_FOCUS: PASS: the document region keeps its keyboard focus role; the viewer is a focusable document region with an aria-label naming what it is and what it enables
ZOOM_REFLOW: NOT_APPLICABLE: no layout geometry changed beyond the existing slot's content
REDUCED_MOTION: NOT_APPLICABLE: no motion was added or changed
STATE_COVERAGE: PASS: covered states are loading, shown with signing unlocked, failure with signing locked and an honest line, text-body rows unchanged with their measured gate, and empty rows unaffected
TRUTHFUL_STATE_LABELS: PASS: the percentage indicator belongs exclusively to the measured text scroll; the uploaded-document branch says the document is shown, opening, or unavailable, and the attestation is the signer's own review choice — no fabricated reading measurement
UNVERIFIED: the deployed frontend and one authenticated signer round opening a real uploaded document remain unverified until post-merge acceptance
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: the signing page is outside the Solo shell surfaces
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: the signing page is outside the Solo shell surfaces
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: the signing page is outside the Solo shell surfaces
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: the signing page is outside the Solo shell surfaces
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: the signing page is outside the Solo shell surfaces
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: the signing page is outside the Solo shell surfaces
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: the signing page is outside the Solo shell surfaces
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: the signing page is outside the Solo shell surfaces
OWNER_INTENT: the signer receives and signs the actual uploaded document, per the completion-lane assignment's package A2 correction
MUST_NOT_HAPPEN: no signed-URL handoff; no signing enabled while the document cannot be shown; no fabricated reading percentage; no second document store; no customer content in committed evidence
MUST_PRESERVE: the token-door's one-refusal posture and rate limits; the frozen bytes as the signing record's truth; the text-body path and its measured gate byte-for-byte; the existing page presentation
ACCEPTANCE_CRITERIA: an uploaded agreement's signing link shows the actual document; signing unlocks only once it has been shown; a load failure locks signing with an honest line; text agreements behave exactly as before; the attestation for uploaded documents claims review, never measurement
MOTION_PURPOSE: NONE: no motion was added or changed
PROTECTED_SEAMS: affected and tested = the signing page's document slot, its read gate and its document fetch; explicitly unaffected = the agreement-document edge, the signing guard, the seal path, and every owner-side agreements surface
RELEASE_NOTE_REQUIRED: NO: bounded presentation repair on the existing signing flow
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the wiring pins and suite are proven offline; the authenticated signer round and deployed frontend are not yet proven
RELEASE_RECOVERY: position=revert this bounded slice if the signing page regresses for text agreements or the viewer misbehaves, restoring the prior slot from the merge parent before any forward fix; reference=#1399

INTERNAL_BUILD_IDENTITY: product=380670c59846f6c05018f54dd2265e83fa43882f; current-main-sync=380670c59846f6c05018f54dd2265e83fa43882f; base=b8cb2065c; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE(agreement-document already deployed; the change is frontend only); evidence=failing-first-wiring-pins-and-impeccable-context
RELEASE_CHANNEL: development: exact product-code head on the draft branch; production promotion remains merge automation only
RELEASE_CLASSIFICATION: patch: the signer's document becomes visible on the existing signing flow
CUSTOMER_RELEASE_IDENTITY: none: no owner-approved customer release identity was assigned to this bounded repair
