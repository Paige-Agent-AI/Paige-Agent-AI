# UI delivery evidence: vibe-studio-v2b-media-approval

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounded on origin/main a5f646c7b before editing — a paige-media job that needed approval was decided by ANY tenant admin flipping paige_media_jobs.approval_state, with no row in the canonical confirmations store, no fingerprint, no single-use claim and no decline receipt; a second approval channel beside the one canonical gate. Flows: (1) the person who asked approves the spend from the Studio project card or Images & video → the server-issued proposal is claimed once → the job dispatches; (2) another owner/admin sees who asked and declines → the job is cancelled, the proposal retired, one refusal receipt filed; (3) a reload, or a job Paige started from chat, still approves (the fingerprint is fetched from the seam first)
PAIGE_UI_DESIGN: PASS: Impeccable (Operate mode) craft floor read before the UI edit; detector `npx impeccable@4.1.0 detect` exit 0 on MediaApprovalCard.tsx, MediaTools.tsx, StudioSession.tsx, useMediaJobs.ts; gold-discipline lint clean; gold spent only on the requester's Approve (the spend act)
MATERIAL_FLOW_CHANGE: YES: only the person who asked can approve a media job's cost (owner ruling 2026-10-04, "Requester approves, any admin can decline"); other admins lose Approve and keep Decline; Approve now carries the server-issued fingerprint
FLOW_PROTOTYPE: PASS: no new surface or step — the existing approval card keeps its place and actions; the change removes Approve for non-requesters and adds who-asked copy, rendered as before/after frames in both app themes
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo owner/admin working in a Vibe Studio project or Images & video; primary action — the requester approves or declines an estimated spend; any other admin declines
VISUAL_DIRECTION: PASS: unchanged Studio ink world (layout C); the card reuses .vs-approval and the existing button classes; MediaTools keeps its own card language, with the gold tint reserved for the requester's card
AUTOMATED_EVIDENCE: PASS: src/__tests__/media-approval-handler.test.ts (17) runs the REAL paige-media handler against an in-memory store — proposal minted on a blocked submit, approve without/with a wrong fingerprint refused, non-requester approve refused, requester approve claims once and dispatches, replay refused, decline by another admin retires the proposal and files ONE receipt, budget refusal does not spend the approval, expired proposal refused, a job waiting from before v2b gets a proposal on the requester's read, fingerprint shown to the requester only; src/solo/studio/MediaApprovalCard.render.test.tsx (10) and src/solo/vibe.render.test.tsx (+1). Bite proofs: removing the requester check, ignoring the claim, skipping the retire, an unstable receipt run id, same-request redemption, leaking the fingerprint, the origin/main handler, Approve shown to all, the hook dropping or skipping the fingerprint, and MediaTools treating everyone as requester each turn named tests red
STATIC_EVIDENCE: PASS: deno check --no-lock supabase/functions/paige-media/index.ts — same 18 pre-existing errors on origin/main and on this branch (diffed); approval.ts checks clean; tsc ratchet 10/10; eslint clean on changed files
RENDERED_EVIDENCE: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-media-approval/ — before-* (origin/main card, light and dark) and after-* for mine, theirs and theirs-unnamed, light and dark, banner and Images & video section (harness render · not live)
BEHAVIORAL_EVIDENCE: PASS: harness drive (scripts/live-drive/harness/studio-mount/drive-media-approval.mjs) reads each variant's text and buttons — requester: "Approve and make it", "Decline"; another admin: "Decline" only, under "Waiting for Dana Reyes to approve" and "Only they can approve the cost. You can decline it."; the estimate reads "About $0.04 to make" in the UI face with tabular figures (was a raw monospace "Estimated $0.04"); jsdom hook tests prove Approve sends approved_fingerprint and Decline sends reject
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in browser or deployed function here; owed — on prod, one admin submits a premium image in a Studio project, a second admin sees "Waiting for <name> to approve" and Decline only, the requester approves and the job runs, and paige_pending_confirmations shows the row consumed
KEYBOARD_FOCUS: PASS: the card's first control takes focus by keyboard and names its action ("Approve and make it" for the requester, "Decline" for others); buttons disable while a decision is in flight (aria-busy on the card)
ZOOM_REFLOW: PASS: reflow-683x768-theirs.png — at half width (200% zoom equivalent) document overflowX 0 and the card fits its column
REDUCED_MOTION: PASS: the card has no animation (0 running animations under prefers-reduced-motion: reduce)
STATE_COVERAGE: PASS: requester / another admin named / another admin unnamed / viewer not yet known (Decline only) / approving / declining / approval not ready (error line) / declined / approved
TRUTHFUL_STATE_LABELS: PASS: nobody but the requester is offered Approve; the server refuses anyone else regardless of the UI
SOLO_UI: YES: Solo Marketing → Vibe Studio → a project (chat card) and Images & video
SOLO_1536X770_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-media-approval/solo-1536x770-paige-closed.png — structural harness, another admin's view; overflowX 0, card on screen, Decline 68×32
SOLO_1536X770_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-media-approval/solo-1536x770-paige-open.png — structural harness; overflowX 0, card on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame
SOLO_1366X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-media-approval/solo-1366x768-paige-closed.png — structural harness; overflowX 0, card on screen
SOLO_1366X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-media-approval/solo-1366x768-paige-open.png — structural harness; overflowX 0, card on screen
SOLO_1024X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-media-approval/solo-1024x768-paige-closed.png — structural harness; overflowX 0, card on screen
SOLO_1024X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-media-approval/solo-1024x768-paige-open.png — structural harness; overflowX 0, card on screen
SOLO_900X1000_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-media-approval/solo-900x1000-paige-closed.png — structural harness, chat drawer opened; overflowX 0, card on screen
SOLO_900X1000_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v2b-media-approval/solo-900x1000-paige-open.png — structural harness, chat drawer opened; overflowX 0, card on screen
UNVERIFIED: authenticated runtime (above)

OWNER_INTENT: "Fold the extra paige-media approval layer into the canonical authority path rather than keeping stacked competing approval systems." and the 2026-10-04 ruling "Requester approves, any admin can decline"
MUST_NOT_HAPPEN: an admin who did not ask approving the spend; an approval without the server-issued fingerprint; one approval redeemed twice; a declined job's approval redeemed later; the fingerprint reaching anyone but the requester or a model
MUST_PRESERVE: budget, video-cap and platform-spend rechecks at approval; idempotent submit; the 7-day abandonment sweep; existing render receipts; any admin can still decline or cancel
ACCEPTANCE_CRITERIA: requester approves and the job dispatches once; another admin sees who asked and can only decline; a decline is final and filed once
MOTION_PURPOSE: none
PROTECTED_SEAMS: paige_pending_confirmations schema/RLS unchanged (no migration); paige-ai-chat unchanged; paige-media-sweeper and paige-media-webhook unchanged; record_capability_run unchanged

INTERNAL_BUILD_IDENTITY: c165bca3f9c61bf0b97b004bd5e5de2a183e7fa1 (integration branch claude/busy-mccarthy-rvxgq9; first built on a5f646c7be094c644ffa27653e80bf5d9194dcd0); deployment=local; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-media deploys on merge); evidence=docs/evidence/ui-delivery/vibe-studio-v2b-media-approval.md
RELEASE_CHANNEL: development: verified locally; edge deploys through CI on merge (pre-launch merge-on-verified, §4)
RELEASE_CLASSIFICATION: internal-only: no customer release identity
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: no: internal-only governance change
RELEASE_TRUTH_BOUNDARY: PARTIAL: LIVE only after paige-media deploys and the owed authenticated drive
RELEASE_RECOVERY: position=forward-fix, a revert restores the previous approve/reject; reference=deploy-edge-functions on merge

## Scope

- The proposal's tool_name is the media capability key (`vibe_media_image` / `vibe_media_video`), not the chat tool `generate_image`: the chat gate claims `generate_image` rows and executes their stored args as a `generate_image` call, and these args are a job reference (and a video is not a `generate_image` act). The `paige-social` door uses its capability key the same way.
- Not in scope: autonomy-lane resolution for media spend (`resolve_tool_autonomy` / `decideGovernedExecution`); the chat note wording for a Studio image that waits on approval (paige-ai-chat is not edited here).
