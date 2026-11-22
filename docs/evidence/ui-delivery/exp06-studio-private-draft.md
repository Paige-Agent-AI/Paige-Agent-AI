# EXP06 Studio private draft

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: The owner opens an original Solo Studio project, selects its business when missing, sees a generated preview, approves the private draft, and reopens that page and version.
PAIGE_UI_DESIGN: PASS: The existing Studio context selector, compact disclosure, and canvas layout carry the previously authored design into the original project screen.
MATERIAL_FLOW_CHANGE: YES: A project without saved context now asks for a brand before its first build. Its existing pages and timeline stay readable.
FLOW_PROTOTYPE: UNVERIFIED: Earlier synthetic browser frames cover the context selector. This exact integration still needs the browser drive.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: A signed-in Solo owner can approve the generated page and come back to the same private draft.
VISUAL_DIRECTION: PASS: Existing Studio ink palette, typography, stage, chat, timeline, and context disclosure. The context and transcript each have a bounded scroll area.
AUTOMATED_EVIDENCE: PASS: Focused React and Edge adapter tests exercise original project context, preview binding, refusal, one native save, read-only reconciliation, scope, and retained form identity. Exact-head workflow evidence accompanies the PR.
STATIC_EVIDENCE: PASS: Source review can trace the same validated generated blocks through the existing confirmation fingerprint and native writer. The non-Studio save branch is conserved.
RENDERED_EVIDENCE: UNVERIFIED: Exact integration browser geometry is pending.
BEHAVIORAL_EVIDENCE: UNVERIFIED: Component interaction tests passed. The authenticated original path remains pending.
AUTHENTICATED_RUNTIME: UNVERIFIED: Verify private save, reload and reopen after both Edge and app release readback.
KEYBOARD_FOCUS: UNVERIFIED: The context control uses a disclosure and native buttons. Verify actual focus and reachability in the signed-in window.
ZOOM_REFLOW: UNVERIFIED: Check the exact deployed project at narrow viewport and browser zoom.
REDUCED_MOTION: UNVERIFIED: Confirm the existing Studio motion preferences on the deployed screen.
STATE_COVERAGE: PASS: Focused tests cover explicit context choice in an older project, existing project loading, exact approved content, scope refusal and unknown save reconciliation.
TRUTHFUL_STATE_LABELS: PASS: An unsaved preview remains a draft for review. Only the native page and version readback supplies the saved result.
SOLO_UI: YES: Original Solo Vibe Studio project.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: Exact integration browser capture is pending.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: Exact integration browser capture is pending.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: Exact integration browser capture is pending.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: Exact integration browser capture is pending.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: Exact integration browser capture is pending.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: Exact integration browser capture is pending.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: Exact integration browser capture is pending.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: Exact integration browser capture is pending.
UNVERIFIED: Production release, authenticated private save and reload, and exact integration browser geometry.

OWNER_INTENT: Finish Studio page generation and approved private save and reopen for the original Solo project.
MUST_NOT_HAPPEN: A model-supplied replacement for approved blocks, a second draft after an uncertain response, cross-workspace reads or writes, or an automatic publication.
MUST_PRESERVE: Existing workspace role checks, original project and page lineage, saved conversion, approval card, native version history, and working copies.
ACCEPTANCE_CRITERIA: Generate a private landing page, approve the preview, read the original page and version, reload, and reopen the same page with the approved content and no duplicate.
MOTION_PURPOSE: NONE: Existing Studio motion continues.
PROTECTED_SEAMS: Studio workspace isolation, project context, approval, draft persistence, original manifest, version, stage, and mobile chat layout are in scope. Authentication, signup, billing, Live audio, Vault, and external provider actions retain their existing paths.

INTERNAL_BUILD_IDENTITY: 5894054007a8ef208b88b35b61c5a8f35ba8e4bf; deployment=local source candidate; environment=local; migrations=NOT_APPLICABLE; edge=PROOF_OWED(official Edge deployment and source receipt); evidence=ANT-162 Studio private draft handoff and focused Vitest suites
RELEASE_CHANNEL: development: Local candidate against the released #3358 database foundation.
RELEASE_CLASSIFICATION: patch: Studio preview and private draft persistence.
CUSTOMER_RELEASE_IDENTITY: none: Internal Studio repair awaiting authenticated use.
RELEASE_NOTE_REQUIRED: no: This increment has no customer announcement.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Redeployed Edge and app with signed-in private approval, original page save, and reopen.
RELEASE_RECOVERY: position=Restore the prior verified PAIGE Cloud image and corresponding certified Edge source if release recovery is required. Reopen the original project to check an unconfirmed save.; reference=https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/3358#issuecomment-7073157836

The existing App and Edge handlers use the immutable [#3358 database foundation](https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/3358#issuecomment-7073157836). The [EXP01 handoff](https://linear.app/paigeagentai/issue/ANT-147#comment-5e54cd31-eceb-401f-9065-e417fbcca877) identifies the exact protected Chat changes. The [owning Linear record](https://linear.app/paigeagentai/issue/ANT-162#comment-147a1b7c-a878-41ed-916e-370556814a19) carries release and private live proof.
