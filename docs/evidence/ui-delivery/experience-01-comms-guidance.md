# UI delivery evidence: E01 communications guidance and secure handoff

**2026-10-17 zCod E01 lead slice.** Adds a new owner guidance question ("How should we reach you?", third in display order ahead of the first-action prompt) to the existing interview next-steps pattern and a fourth secure handoff destination (Communications → the Setup People & email subtab that owns the owner's email preferences), extending released #2258 guidance/secure-return mechanics to the communications outcome the October-16 owner directive added. No new store, registry, permission, executor or chat write path; navigation and editable prompts only.

UI_DELIVERY_EVIDENCE_VERSION: 1

## Owner Intent & Experience Contract

OWNER_INTENT: An ordinary SOLO owner, from their confirmed business profile, asks PAIGE how communications are controlled — what PAIGE sends the owner by email, and how the business's own channels (email, calendar, calling) get connected — and reaches the real preference/connection controls through secure native navigation, returning to the same private interview thread.

MUST_NOT_HAPPEN: no chat write of any preference or connection; no secrets in Chat; no capability/eligibility claim from a navigation click; no new confirm channel, store or execution path; the prompt never sends itself.

MUST_PRESERVE: incumbent three prompts and three handoffs byte-for-byte in behavior; unknown-save handoff withholding; workspace/account fencing; the existing People & email preference surface unchanged (its own save/readback contract owns persistence); #2277 live-relay timing seams; all Setup canonical writers.

ACCEPTANCE_CRITERIA: the fourth prompt appears with the other three (panel + Chat slash chips from the one shared contract) only when a confirmed priority exists; the Communications handoff navigates to the Setup people-email subtab carrying only the thread pointer; the existing surface-level "Return to interview" link serves the return; nothing else in the panel changes.

## Capability routing — pre-edit

1. Outcome: owner understands and reaches communication controls — E01 orchestration, no new capability.
2. Domain owner: comms domain (read/admission contracts untouched); E01 owns this consumer flow.
3. Harness: none new; existing Settings surfaces only.
4. Spine capability: none read or written by this slice; honest UNAVAILABLE for any chat-side preference write (no such capability exists and none is created).
5. Providers: none; connection prerequisites stay in the Integration Registry and native owner interfaces.
6. Approval/risk: navigation only (read_only class); a prompt is an editable draft, never execution authorization.
7. Events/jobs: none.
8. Readback: the native People & email surface's own save/readback contract; Chat claims nothing.
9. Visible surfaces: existing interview next-steps section + Chat chips + Setup people-email subtab (landed destination of the retired notifications page, #1090).
10. Required proof: rendered native frames (this record), component regressions, exact-head CI, then ordinary-owner authenticated cases under the single owner window.

## Flow and state map (additive row)

| From | Trigger | Guard | Result and recovery |
|---|---|---|---|
| Interview | Select "How should we reach you?" | Confirmed priority; panel ready; no open edit; save outcome known | Editable composer draft via the existing handoff; never auto-sends; focus moves to composer |
| Interview | Open Communications | Current workspace account; same fencing as the other three destinations | Native Setup people-email subtab with thread pointer only; existing surface "Return to interview" link; no write of any kind |

FLOW_BY_FLOW: PASS: additive rows above extend the released #2258 flow table; every other row unchanged.
PAIGE_UI_DESIGN: PASS: refinement of the incumbent surface (Impeccable context loaded for this target; paige-ui-design modules read; existing tokens, geometry and note copy extended, no new visual world).
MATERIAL_FLOW_CHANGE: YES: a new handoff destination and a new guidance question are new flow exits.
FLOW_PROTOTYPE: PASS: the temporary isolated harness (vite + synthetic context stubs matching the committed vitest fixtures) exercised the real component pre-commit: closed/open at four viewports × two themes, prompt handoff, handoff navigation path, and the 320px keyboard trail; receipts in ../experience-01-foundation/comms-guidance-2026-10-17/ (native-integrity.json binds 7 source blobs and 18 frames). No real model/provider/Auth/write effect. One correction pass fixed the note copy; no further round needed.

## Prototype and evidence boundary

PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an ordinary SOLO owner asks how communications are controlled and reaches the real preference/connection controls without leaving their private interview behind; the panel and Chat chips serve the same one action.
VISUAL_DIRECTION: PASS: inherit the incumbent immersive panel; the fourth button wraps in the existing flex row; no new styles added (existing .sbi-actions + container-query 44px control floor cover it).
MOTION_PURPOSE: NONE: no motion added or changed; captures taken with reduced-motion.
AUTOMATED_EVIDENCE: PASS: 26/26 navigation+interview suites including the two new cases (communications path lands on setup/people-email with the thread pointer and rejects foreign accounts; the comms prompt hands off as an editable draft and never sends); 94/94 across the four-file Solo interview family; 11/11 onboarding workspace chips consumer.
STATIC_EVIDENCE: PASS: scoped ESLint clean on the three changed source files; type ratchet unchanged from main baseline; full production build passes.
RENDERED_EVIDENCE: PASS: 16 closed/open frames at 1536×770, 1366×768, 1024×768, 900×1000 in dark and light, plus a 320×720 keyboard frame; every PNG dimension independently verified from its IHDR (no crop/resize); DOM assertions bind the four prompts, four handoffs and the updated note; synthetic transport only.
BEHAVIORAL_EVIDENCE: PASS: the Communications handoff navigates through the same interviewConnectionPath guard family (no write RPC issued in any capture/test); the Setup surface's existing owner-scoped "Return to interview" serves the return on every subtab.
AUTHENTICATED_RUNTIME: UNVERIFIED: ordinary owner cases outstanding; folds into the single owner window with the original 23 cases.
RELEASE_CHANNEL: development: local/development build environment only — isolated harness captures and suites; no extension release, activation or hosted deployment.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: this slice is guidance and navigation; it is not a changed preference, a connection, or any communications capability claim.

KEYBOARD_FOCUS: PASS: 320×720 native trail walks Open Setup → per-field Correct/Add → Reload/Skip/Pause in incumbent order (recorded in comms-320-dark-keyboard.json); the prompt/handoff buttons remain reachable after the facts list per incumbent tab order; physical mobile keyboard and assistive technology remain UNVERIFIED.
ZOOM_REFLOW: UNVERIFIED: 320px reflow clean in capture; actual 200% browser zoom not proved.
REDUCED_MOTION: PASS: all captures with reduced-motion enabled; slice adds no animation.
STATE_COVERAGE: PASS: closed (next-steps hidden by design), open (full section), unknown-save and open-edit withholding covered by the extended component suites; foreign/denied states covered by the navigation suite.
TRUTHFUL_STATE_LABELS: PASS: the note states opening a page makes no connection or business change; the prompt asks PAIGE to check actual connection status rather than claiming any.
SOLO_UI: YES: existing SOLO PAIGE interview panel and Chat chips; one shared implementation for every eligible current/future SOLO account.
SOLO_1536X770_PAIGE_CLOSED: PASS: comms-1536x770-dark-closed.png (and light pair); exact IHDR dimensions; synthetic, not authenticated.
SOLO_1536X770_PAIGE_OPEN: PASS: comms-1536x770-dark-open.png shows the full next-steps section with all four prompts and four handoffs; exact IHDR dimensions; synthetic, not authenticated.
SOLO_1366X768_PAIGE_CLOSED: PASS: comms-1366x768-dark-closed.png; exact IHDR dimensions; synthetic, not authenticated.
SOLO_1366X768_PAIGE_OPEN: PASS: comms-1366x768-dark-open.png; exact IHDR dimensions; synthetic, not authenticated.
SOLO_1024X768_PAIGE_CLOSED: PASS: comms-1024x768-dark-closed.png; exact IHDR dimensions; synthetic, not authenticated.
SOLO_1024X768_PAIGE_OPEN: PASS: comms-1024x768-dark-open.png; exact IHDR dimensions; synthetic, not authenticated.
SOLO_900X1000_PAIGE_CLOSED: PASS: comms-900x1000-dark-closed.png; exact IHDR dimensions; synthetic, not authenticated.
SOLO_900X1000_PAIGE_OPEN: PASS: comms-900x1000-dark-open.png; exact IHDR dimensions; synthetic, not authenticated.
UNVERIFIED: authenticated owner behavior, physical mobile keyboard, assistive-technology use, 200% browser zoom, real chat-model responses to the new prompt, and any preference change (none is claimed). Original 23 cases unchanged; folds into the single owner window.

INTERNAL_BUILD_IDENTITY: 0b27f8a26a57efc96cfacd4cbc801f5c31fc4ca2; deployment=NOT_DEPLOYED; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record plus the native integrity receipt and suites listed here.
RELEASE_CLASSIFICATION: internal-only: development slice with no customer announcement.
CUSTOMER_RELEASE_IDENTITY: none: full outcome and authenticated evidence remain incomplete.
RELEASE_NOTE_REQUIRED: no: no customer release identity or publication decision.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: guidance and navigation only — not an executed preference change, connection, or communications capability.
RELEASE_RECOVERY: position=ordinary reviewed source revert of the five-file slice with no database, provider or configuration effect; reference=docs/evidence/ui-delivery/experience-01-comms-guidance.md.

## Customer experience integration matrix — additive

| Link | State | Evidence |
|---|---|---|
| Conversation → "How should we reach you?" prompt | PASS (synthetic; authenticated owed) | DOM assertions + 26/26 suites |
| Spine capability | N/A by design (no write path created) | routing §4 |
| Backend record | none touched | no RPC in captures/tests |
| UI component | existing People & email subtab, unchanged | landing destination of retired notifications page |
| Visible state | existing preference controls with their own states | settings-people-email-preferences.tsx untouched |
| Verified receipt + reload | owned by the existing surface's contract | unchanged |
