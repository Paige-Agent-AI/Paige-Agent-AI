# UI delivery evidence: chat program-tool retirement — enrollment is the governed deal at the Enrolled stage

Production grounding (2026-09-30, read-only): the legacy `programs` and
`program_enrollments` tables have never held a row for any tenant. Every
`program_enroll` invocation therefore raised `ENROLL_PROGRAM_NOT_IN_TENANT`
after the operator's approval had already been consumed, which the chat
narrated as an ambiguous outcome. This retirement removes the dead tools and
redirects the enrollment vocabulary to the existing governed `deal_create`
path. No interface source, layout, copy, control, state, action, transition or
exit changes.

UI_DELIVERY_EVIDENCE_VERSION: 1
SOLO_UI: YES: the recognized UI data map src/solo/data/capabilityTools.ts changed (one knob entry removed); no rendered component, layout or copy changed
FLOW_BY_FLOW: WAIVED: owner-decision=INT-083 go-live ruling 2026-09-20; reason=the Flow-by-Flow skill is not installed at the account level in this environment, whose account-level skill directory holds impeccable alone, so a flow-by-flow pass is genuinely unavailable here; the affected-flow packet is grounded from source in STATIC_EVIDENCE
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design/SKILL.md and its routed references were read completely; no visual design, component, copy, geometry, motion, focus, action, state or exit changes — the sole UI-recognized file in this diff is the data map src/solo/data/capabilityTools.ts, which loses one knob entry fronting the retired tool
IMPECCABLE: PASS: the installed Impeccable skill and its craft floor were read; no UI artifact is in scope and every rendered control and wording is unchanged
MATERIAL_FLOW_CHANGE: NO: a chat tool wired to a permanently empty legacy table is removed and its vocabulary redirected to the existing governed deal path; no working user goal, choice, step, state, transition, confirmation, exit, recovery path or side effect changes
FLOW_PROTOTYPE: NOT_REQUIRED: bounded retirement of a never-functional tool plus prompt-contract copy; the enrollment journey already exists as the governed deal path with its existing approval card
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner asks Paige to enroll a client in a program; Paige resolves the program's pipeline by exact reference from a current read, proposes the governed deal at the Enrolled stage, and the owner approves the existing confirmation card or holds standing authority
VISUAL_DIRECTION: PASS: the canonical Solo shell, PAIGE Chat composer, confirmation card, Trust Compass and existing tokens/layout/copy remain untouched
AUTOMATED_EVIDENCE: PASS: the retirement suite failed 10 of 11 tests on unchanged main and passes 11 of 11 after the change (the eleventh is the non-vacuous canary proving the governed deal tools remain declared); crm-command-chat-adoption passes 22 of 22; the chat-tool-registry, capability-declaration and receipt-coverage guards each pass after their baselines were updated in the same commit
STATIC_EVIDENCE: PASS: production read-back showed zero rows in programs and program_enrollments across every tenant and a consumed program_enroll confirmation with no enrollment row; the retired tool is absent from the chat manifest, dispatch, handler, card text, verb phrases, rail sets and subject maps; removing the action-risk classification is the fail-closed reintroduction guard because an unclassified tool is refused at dispatch; TypeScript reports zero errors in touched files
OWNER_INTENT: retire a dead capability honestly and route enrollment through the one governed path the platform already proves, per the owner's Spine architecture ruling of 2026-09-30
MUST_NOT_HAPPEN: no new chat-side execution logic; no tenant-specific branch; no approval bypass or lane change; no production data write during pre-merge proof; no customer content in committed evidence
MUST_PRESERVE: the governed deal.create door, its approval cards, autonomy lanes, canonical readback and Rail receipts; the duplicate-name honesty rule (show every same-name pipeline with its reference and ask); every existing Solo visual and wording
ACCEPTANCE_CRITERIA: the model surface exposes no program_enroll or program_list; classifyAction refuses the retired name; the Solo capability map carries no knob for it; the operator prompt teaches enrollment as the governed deal at the Enrolled stage with the ask-when-duplicated refusal; all four registry guards pass on the updated baselines
MOTION_PURPOSE: NONE: no motion was added or changed
PROTECTED_SEAMS: affected and tested = chat tool manifest, dispatch and handler chains, action-risk classification, Solo capability map, CI tool registries; explicitly unaffected = the governed CRM command door, deal executors, approval machinery, autonomy resolution, UI components, navigation, billing, providers, Mind/Memory and outbound communications

SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered surface changed in this retirement; the recognized UI file in the diff is a data-map entry removal
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered surface changed in this retirement; the recognized UI file in the diff is a data-map entry removal
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: no rendered surface changed in this retirement; the recognized UI file in the diff is a data-map entry removal
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: no rendered surface changed in this retirement; the recognized UI file in the diff is a data-map entry removal
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: no rendered surface changed in this retirement; the recognized UI file in the diff is a data-map entry removal
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no rendered surface changed in this retirement; the recognized UI file in the diff is a data-map entry removal
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: no rendered surface changed in this retirement; the recognized UI file in the diff is a data-map entry removal
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: no rendered surface changed in this retirement; the recognized UI file in the diff is a data-map entry removal

INTERNAL_BUILD_IDENTITY: product=bf827b7e517750a521b88d30cb38aad5b992aa03; current-main-sync=863f81c2b9fe1803323a6994595d62651b630d5c; base=863f81c2b9fe1803323a6994595d62651b630d5c; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-ai-chat automated deployment after merge); evidence=retirement-focused-failing-first-and-production-readback
TRUTHFUL_STATE_LABELS: PASS: no visible label changed; removing the retired tool's capability-map entry leaves every remaining knob fronting a live classified action, and the enrollment vocabulary points at the governed deal path whose pre-release behavior stays labeled by its own record
UNVERIFIED: the merged Edge deployment identity and one authenticated enrollment round that proposes the governed deal at the Enrolled stage remain unverified until post-merge production acceptance
RELEASE_NOTE_REQUIRED: NO: bounded tool retirement and vocabulary redirect with no new workflow, interface, action or customer instruction
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the failing-first retirement suite, adoption suite and four registry guards are proven offline; authenticated production behavior and deployed bundle lineage are not yet proven
RELEASE_RECOVERY: position=revert this bounded retirement if any registry guard or the chat surface regresses, then restore the prior tool wiring from the merge parent before any forward fix; reference=PR-1598

RELEASE_CHANNEL: development: exact product-code head on the draft branch; production promotion remains merge automation only
RELEASE_CLASSIFICATION: patch: removes dead plumbing and redirects vocabulary to the existing governed path without a new workflow or interface
CUSTOMER_RELEASE_IDENTITY: none: no owner-approved customer release identity was assigned to this bounded retirement
