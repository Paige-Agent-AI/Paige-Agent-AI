# Approval row â€” exact review and truthful outcomes

## Pre-edit Owner Intent & Experience Contract

OWNER_INTENT: Restore the existing approval row so every eligible SOLO owner can inspect the full held task and deliberately approve the canonical stored action. Show the actual endpoint outcome, not a success animation inferred from missing data. This is the lead's bounded continuation of ANT-21/ANT-147/ANT-52; the owner's Build -> Verify -> Ship -> Owner Test directive authorizes routine implementation. No provider or production action is part of this slice.

MUST_NOT_HAPPEN: Empty, malformed, wrong-ID, accepted, queued, scheduled, in-progress or unknown replies cannot mean an executed effect. No automatic replay, stale-workspace acknowledgement, duplicate click, raw metadata/secrets, fake editor, new executor or authority body arguments. Preserve pending/uncertain inspection and safe exits.

MUST_PRESERVE: Existing execute-approval endpoint and server controls, native immutable owner.task held arguments/display, tenant/role/approval policy, direct RLS decline with reason, other legitimate approval categories, current pending queue, existing row primitives/tokens and parent refresh. No SQL, service ACL, hook permissions, provider flags, Settings source or Chat tools change.

ACCEPTANCE_CRITERIA: Actual component fixtures prove exact-ID explicit executed acknowledgement, distinct scheduled/queued/acknowledged/already/in-progress/refused/unknown reports, one-flight and scope/actor/auth/unmount/late-response fences, complete canonical task title/description, real inline View/Close, decline reason/cancel/exact readback, and no retries from Refresh status. Root owns rendered eight-viewports, authenticated SOLO execution and release.

Goal: Review one held action, approve once and inspect its truthful result.
Human and feel: Ordinary workspace owner; precise and calm.
Entry and exit: Incumbent approval row; inline View/Close and decline Cancel return to source.
System: Operate mode, existing Button/Badge/Textarea, tokens and compact row; complete wrapping content.
Signature: Exact held task remains readable beside its reported outcome.
Feedback: Status text; no added animation or haptics and no automatic collapse.
Rejecting: Success inferred from silence; dead account-choice link and fake editing.
Variants: Same tenant-neutral row for existing categories; server retains authority.

| From | Input | To / recovery |
| --- | --- | --- |
| Pending | View / Close / Escape | Inline full safe draft fields / return focus; no mutation |
| Pending | Approve with current scope | One bounded request with approval_id only |
| Busy | Repeated Approve / Decline | Disabled; no additional request |
| Response | Explicit exact-ID protocol | Executed, scheduled, queued, acknowledged, already handled or in-progress as reported |
| Response | Missing/malformed/foreign/lost | Unknown; inspect/refresh, never replay |
| Any async | Workspace/auth/unmount | Invalidate local intent; suppress late mutation/acknowledgement |
| Pending | Decline / Cancel | Reason required; cancel zero writes; confirmed exact RLS returned row or unknown |
| Reported | Refresh status | Existing parent read only; no approval replay |

PROTECTED_SEAMS: Affected: tenant/workspace/auth context, approval decision, canonical result acknowledgement, async/replay recovery and accessible row controls; focused component tests required. Unaffected: subscription/signup/provisioning, Spine/native writers and receipts, Chat transcript/Live, Vault/credentials, providers, scheduling and shell geometry source. Canonical shared row applies to future accounts; test identities are neutral and do not branch source.

VISUAL_DIRECTION: PASS: Existing Operate row and token vocabulary; inline disclosure preserves context. Root composes the eight required SOLO viewport/PAIGE combinations. No new visual system or raster.
MOTION_PURPOSE: No new motion. Remove unconfirmed success/collapse animation; status remains visible. Native browser focus and reduced-motion proof remain separated.

## Proof and release boundary

Implementation, local zero-network prototype, focused tests and final proof receipt will be appended before freeze. Independent Review, exact-head CI, production deployment/readback, authenticated customer effects, Live and owner acceptance are UNVERIFIED until the lead completes those legs. No claim of LIVE functionality from this candidate. Existing native migration/endpoint prerequisites remain binding.

## Frozen candidate proof

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Pre-edit contract and state/transition map above; actual component failing-first regression and final source implementation through the existing endpoint.
PAIGE_UI_DESIGN: PASS: Repository router, all five modules, vendored accessibility references and Impeccable Operate/audit/craft-floor read. Incumbent design direction preserved; no new design system.
MATERIAL_FLOW_CHANGE: YES: Replace dead View/Edit exit, make full held task reviewable, and distinguish execution/acceptance/unknown rather than collapsing on missing acknowledgement.
FLOW_PROTOTYPE: PASS: Local throwaway work/approval-prototype.html and work/approval-prototype-result.json, driven before product edits. Eight deterministic outcomes, zero HTTP/real effects, Cancel/Escape focus, no refresh replay, 1366px/390px screenshots inspected. This follows the lead's bounded requested inline flow and the owner's explicit prelaunch implementation/release direction; authenticated product acceptance remains after release.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Current ordinary workspace owner reviews the exact held action, approves once, inspects its actual outcome and deliberately refreshes through the existing queue.
AUTOMATED_EVIDENCE: PASS: Final four-suite run 82 tests PASS (47 actual ApprovalRow component, 6 incumbent GamePlan embedding, 21 incumbent Chat outcome, 8 incumbent bound Chat approval). work/approval-regression-final.log. Earlier implemented 44 PASS in approval-quality-run.log. Failing-first old component 33 FAIL/1 PASS plus one uncaught transport rejection; approval-failing-first.log. No provider, native SQL or authenticated claims from these fixture ports.
STATIC_EVIDENCE: PASS: Four changed TSX files scoped ESLint zero findings (approval-eslint-final.log, exit 0); git diff --check; actual TypeScript ES2020/React-JSX syntax/transpile zero diagnostics and exact source hashes (approval-static-proof.json). Impeccable detector exit 0/zero anti-patterns, one preserved existing 10px type advisory (approval-impeccable.log). Full application typecheck/build and exact-head CI remain UNVERIFIED and belong to the integrating lead.
RENDERED_EVIDENCE: UNVERIFIED: Local synthetic prototype desktop/mobile screenshots exist; actual styled component/full shell eight-viewports remain for root's composed release and are not proven by jsdom.
BEHAVIORAL_EVIDENCE: PASS: Actual component fixture clicks, Cancel/Escape focus, exact request ID, one-flight, current auth/tenant, delayed/lost responses, deadlines, safe decline readback and fresh canonical row/manual retry. Native/provider/browser-authenticated behavior is separate.
AUTHENTICATED_RUNTIME: UNVERIFIED: No customer request, database mutation or provider effect was performed by this implementation task.
KEYBOARD_FOCUS: PASS: Actual DOM fixture View/Close/Escape and decline Cancel restore source focus. Styled keyboard visibility and assistive technology remain UNVERIFIED for root's browser proof.
ZOOM_REFLOW: UNVERIFIED: Root must drive the composed actual shell; prototype narrow-width proof does not establish production reflow.
REDUCED_MOTION: UNVERIFIED: No added animation, and optimistic success/collapse is removed. Prototype reduced-motion media was exercised; actual styled host remains owed.
STATE_COVERAGE: PASS: Executed, scheduled, queued, acknowledged, already handled, in-progress, refused, failed, unknown, malformed/wrong identity, transport exception, double click, current actor/workspace, impersonation, StrictMode, auth invalidation, timeout, unmount, full detail, decline cancel and exact returned decline identity/status/reason.
TRUTHFUL_STATE_LABELS: PASS: Explicit matching endpoint protocol required; native executed additionally requires act_outcome=executed. No accepted/in-progress/unknown collapse. Refresh performs only incumbent parent read; no automatic replay. Reports remain until a fresh parent row is read. Auth/context invalidation requires a fresh row and never silently re-enables the stale intent.
SOLO_UI: YES: Existing shared approval row and Business Game Plan approval strip. Applies to every equivalent existing/future SOLO account; neutral fixtures and no tenant-specific source. Existing null-workspace callers retain their server authorization rather than acquiring a new browser role.
UNVERIFIED: Final combined finish review, full app CI/release and native prerequisites, assistive technology, authenticated positive/negative customer execution, canonical records/receipts, cross-browser, hydrated interactions and Live, provider readiness and owner acceptance. Bounded native geometry/keyboard proof is supplied below.

SOLO_1536X770_PAIGE_CLOSED: PASS: Exact native PNG/viewport, both themes and four outcome states within88-layout packet; full357-character task and current SoloApp inner frame. Intentional narrow PAIGE overlay cases are explicitly excluded from unobscured-control claims.
SOLO_1536X770_PAIGE_OPEN: PASS: Exact native PNG/viewport, both themes and four outcome states within88-layout packet; full357-character task and current SoloApp inner frame. Intentional narrow PAIGE overlay cases are explicitly excluded from unobscured-control claims.
SOLO_1366X768_PAIGE_CLOSED: PASS: Exact native PNG/viewport, both themes and four outcome states within88-layout packet; full357-character task and current SoloApp inner frame. Intentional narrow PAIGE overlay cases are explicitly excluded from unobscured-control claims.
SOLO_1366X768_PAIGE_OPEN: PASS: Exact native PNG/viewport, both themes and four outcome states within88-layout packet; full357-character task and current SoloApp inner frame. Intentional narrow PAIGE overlay cases are explicitly excluded from unobscured-control claims.
SOLO_1024X768_PAIGE_CLOSED: PASS: Exact native PNG/viewport, both themes and four outcome states within88-layout packet; full357-character task and current SoloApp inner frame. Intentional narrow PAIGE overlay cases are explicitly excluded from unobscured-control claims.
SOLO_1024X768_PAIGE_OPEN: PASS: Exact native PNG/viewport, both themes and four outcome states within88-layout packet; full357-character task and current SoloApp inner frame. Intentional narrow PAIGE overlay cases are explicitly excluded from unobscured-control claims.
SOLO_900X1000_PAIGE_CLOSED: PASS: Exact native PNG/viewport, both themes and four outcome states within88-layout packet; full357-character task and current SoloApp inner frame. Intentional narrow PAIGE overlay cases are explicitly excluded from unobscured-control claims.
SOLO_900X1000_PAIGE_OPEN: PASS: Exact native PNG/viewport, both themes and four outcome states within88-layout packet; full357-character task and current SoloApp inner frame. Intentional narrow PAIGE overlay cases are explicitly excluded from unobscured-control claims.

INTERNAL_BUILD_IDENTITY: base=8a112dc6ab1b84daeefb3e2d4d1408c916184d7e; exact candidate commit=Git; deployment=none; environment=local; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record and ignored work proof logs.
RELEASE_CHANNEL: development: candidate only; root owns review/CI/merge/deployment; no activation or customer release performed.
RELEASE_CLASSIFICATION: patch: existing approval review and outcome truth regression.
CUSTOMER_RELEASE_IDENTITY: none: unpublished scoped candidate, no new version or customer announcement.
RELEASE_NOTE_REQUIRED: no: lead includes coherent production outcome after real release proof; no announcement from fixture completion.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: source and synthetic fixture proof only; actual customer/Live outcome is UNVERIFIED.
RELEASE_RECOVERY: position=source-only forward fix or exact candidate revert; reference=this record; no stored data, native migration, provider configuration or historical receipt altered.

### Scope and integration boundaries

Only ApprovalRow, GamePlan copy, their focused tests and this record change. Parent's Settings mount/CSS, Chat draft schema, native migrations and endpoint sources remain untouched. Decline continues the original tenant RLS writer and adds pending/id/tenant CAS plus selected canonical decision evidence; it does not grant a permission or change a server gate. Full task display uses only held native title/description plus existing safe draft subject/body/preview, never raw metadata.

The incumbent realtime parent can remove a record after its canonical pending status changes. This slice does not add a parallel outcome store or change that hook. In-progress and uncertain pending records are never locally collapsed or automatically replayed. The native canonical execution ledger/domain receipt remains the durable execution authority.

The sandbox browser launch failed before opening a prototype; the authorized isolated headless run subsequently passed all local prototype checks. An initial sandbox test rerun stalled before assertions and was stopped; the later authorized isolated run completed, followed by the final 82-PASS campaign. No setup failure is counted as a product test result.


## Final composed consumer and bounded responsive repair — 2026-10-17

This continuation supersedes only the bounded render fields above. Actual root-composed ApprovalRow/GamePlan source988f77dd60b907571bfb308987fc423fe5d9b0e9 is exercised by new renderer7a48698769911289fb4c901cbda74738d4559262 through real CommandHub, SoloGamePlanWorkspace, GamePlanApprovals, ApprovalRow, usePendingApprovals and QueryClient. Only explicit backend/identity/unrelated Chat ports are synthetic. Actual11 React tests PASS/no skips include exact native acknowledgement versus null/foreign/missing outcome/refusal, full357-character task, View/Close/Escape focus, decline Cancel zero effects, one in-flight decision, stale-auth acknowledgement fencing, no refresh replay, actor preflight refusal and the existing exact pending-row decline writer. They do not prove RLS or real execution.

First captures missing the incumbent SoloApp namespace/theme/flex/screen-host frame are INVALID and preserved. Correct-frame first captures then confirmed two real existing responsive defects:390px header414px/subtitle48.61px wide, and stacked min-height-zero grid tracks overlapping. Root-authored25c357b359165810efbba06eba8b289efe3489f8 consolidates the incumbent1050px stacked breakpoint, uses natural content tracks/column heights with the existing field scroll owner, and places the small-screen header in one column. No role, authority, endpoint, data, writer or global/body scrolling change. Distinct renderer-author source inspection and the original four-case native confirmation PASS: header138px, subtitle290.40px, work field411.55px, stacked separation14px.

Native Chrome validates88 exact-size layout PNGs and6 additional keyboard/readability PNGs, all nonblank/opaque;13 source hashes, HTML/native identities and image hashes agree. All88 retain full title and font/theme/inner frame;54 stacked cases have zero overlap and all cases have zero horizontal overflow. Five native focus checks and separate ArrowUp readback verify mobile unknown status/Refresh, mobile Cancel, desktop Close details and DPR2 equivalent reflow controls. At768x384 CSS the78px field requires vertical keyboard scrolling; status and Refresh are each reachable, not simultaneously fully visible. This is explicitly not literal browser zoom. Twenty-four narrow PAIGE overlays intentionally cover underlying approval controls; they are not counted as unobscured. Body/main scroll remains0; the incumbent field/rail own scrolling. Reduced-motion CSS reports0s; hydrated motion is not proven.

Inherited form/quality reference: existing Command Center/Game Plan working rows, Schibsted, Mineral/Obsidian, existing primitives and safe inline action review. Installed Impeccable4.3.1 reference/new-work.md section3 directs existing-surface extensions to inherit their world/composition without a concept tournament. No seed, generated comp, new identity or product raster is invented; existing comp preference and DESIGN.md/.impeccable/design.json are preserved. Final distinct finish review is separately recorded after inspection.

[Campaign and exclusions](approval-outcomes/campaign-summary.json), [native matrix](approval-outcomes/native-summary.json), [keyboard](approval-outcomes/keyboard-final.json), [reflow readability](approval-outcomes/reflow-readability.json), [scroll owner](approval-outcomes/scroll-final.json), [unchanged selected exports](approval-outcomes/export-integrity.json). Selected actual native captures: [desktop](approval-outcomes/approval-light-1536x770-closed-review.png), [dark with PAIGE](approval-outcomes/approval-dark-1366x768-open-refused.png), [mobile unknown/Refresh](approval-outcomes/keyboard-mobile-unknown-refresh.png), [decline Cancel](approval-outcomes/keyboard-mobile-decline-cancel.png), [reflow Close](approval-outcomes/keyboard-reflow-details-close.png), [original overlap FAIL](approval-outcomes/frame-mobile-focused-overlap.png). Full94-image packet remains locally under work/approval-outcomes-render; selected sanitized neutral-fixture originals are copied byte-for-byte, without real account data.

Source tests and static browser pages do not establish hydrated customer behavior, live authority/RLS, actual domain records/receipts, deployment, paired cohorts/new-account runtime, cross-browser, Live or owner acceptance. Those remain PROOF OWED. Earlier pre-edit scope statements above describe the original approval-only slice; this root integration additionally includes the narrowly reviewed responsive correction and test/evidence artifacts, with other native/Chat/Settings changes separately owned in the same restoration program. No actual customer automation has been armed by these fixtures.
