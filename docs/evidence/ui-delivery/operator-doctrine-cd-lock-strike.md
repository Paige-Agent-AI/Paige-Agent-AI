# UI delivery evidence: operator-doctrine-cd-lock-strike

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full (orchestration, delivery, audit, build, review, verification); mode Refactor (doctrine and comments only), Quick depth; affected flow is a builder session reading src/operator guidance before any operator console change; Platform Operator milestone slice 1 of 5, approved by the coordinator 2026-09-27
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md read with UPSTREAM.md, vendor frontend-design SKILL.md, accessibility checklist, paige-quality-gates.md and review-and-testing.md; change touches comments in two recognized UI TypeScript files and the nested operator CLAUDE.md, with no rendered, token, copy or behavior change
MATERIAL_FLOW_CHANGE: NO: comments and nested doctrine only; no runtime string, control, state, route or consequence changes for any user
FLOW_PROTOTYPE: NOT_REQUIRED: nothing any user sees or does changes
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is any agent session working under src/operator; purpose is to stop the nested doctrine from instructing builders that the Claude Design pack is frozen authority, which root CLAUDE.md section 00 voided on 2026-09-22
VISUAL_DIRECTION: NOT_APPLICABLE: no markup, style, token or copy change
AUTOMATED_EVIDENCE: PASS: npx vitest run src/operator/ia/operatorIA.test.ts and src/operator/shell — unchanged behavior, see Evidence index
STATIC_EVIDENCE: PASS: comment-only diff in operatorIA.ts and SlotSurfaceBody.tsx (git diff shows no non-comment line changed); eslint on both files clean of new findings; tsc unaffected by comments
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered output changes
BEHAVIORAL_EVIDENCE: NOT_APPLICABLE: no behavior changes
AUTHENTICATED_RUNTIME: NOT_APPLICABLE: no runtime path changes
KEYBOARD_FOCUS: NOT_APPLICABLE: no control, focus or keyboard behavior changes
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: NOT_APPLICABLE: no state changes
TRUTHFUL_STATE_LABELS: PASS: no capability label changes; the nested doctrine now states the pack is reference, matching root section 00
SOLO_UI: NO: Platform Operator console guidance only
UNVERIFIED: none: this slice changes no behavior; its proof boundary is the diff itself (comments and nested doctrine), inspected line by line

OWNER_INTENT: coordinator ruling 2026-09-27, Platform Operator milestone slice 1: strike the voided Claude Design lock lines in src/operator/CLAUDE.md and the two code comments, docs only, so a builder reading the file does not build to a frozen pack
MUST_NOT_HAPPEN: any product behavior change; loss of the engineering lessons this console paid for (the four failure modes, values-are-data, the drive tool, pack:keys)
MUST_PRESERVE: the §00 block already in the file, the pack location and supersession facts, the six-slot IA rule and its owner-ruling requirement, the four failure modes, dev-loop and pack:keys tooling guidance, §13/§11/§23/§9/§58 constraints
ACCEPTANCE_CRITERIA: no line in src/operator/CLAUDE.md, operatorIA.ts header or SlotSurfaceBody.tsx elevation comment assigns interface authority to Claude Design; a §58 record in the file names what was struck and why
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: NONE_AFFECTED: comments and nested doctrine only; operatorIA.test.ts still pins the IA module to paige-ia.js and passes unchanged

INTERNAL_BUILD_IDENTITY: 915f657ecf9627c78be75d25d0db9be0d4d4ff26; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=915f657 is the last commit carrying the doctrine and comment change (210ce78 strikes the operator doctrine and comments, 915f657 aligns AGENTS.md); commits after it change only this record; reviewed by Codex on 210ce78 and 915f657
RELEASE_CHANNEL: development: pre-merge branch build; comments and doctrine do not alter the shipped bundle's behavior
RELEASE_CLASSIFICATION: internal-only: agent doctrine and code comments
CUSTOMER_RELEASE_IDENTITY: none: internal-only doctrine change, no customer release
RELEASE_NOTE_REQUIRED: NO: internal-only, no visible change
RELEASE_TRUTH_BOUNDARY: LIVE: nothing customer-facing is claimed; the doctrine text is the whole deliverable
RELEASE_RECOVERY: position=revert the commit; reference=git revert of this PR's merge commit

## Scope and collisions

- Classification: doctrine/comment strike, Platform Operator milestone slice 1.
- Affected flows: an agent session reading operator guidance before editing the console.
- Neighboring regressions: none; no code path changes.
- Active-owner/file collisions: none known on these three files.
- Explicit exclusions: other operator files still cite "Ruling F (Claude Design)" in comments (IntegrationsSurface, ComposeOutbound, FleetAlertRulesSurface); these are outside the approved slice and are routed at settlement rather than edited here. AGENTS.md line 77 ("faithfully port the approved Claude Design pack") was first excluded too, but the Codex review on 210ce78 (P1) showed it directly contradicts the struck operator doctrine, so it is aligned to §00 in this PR.

## User job and state map

Not applicable to an end user. The builder's job: read `src/operator/CLAUDE.md` and learn what binds operator work. Before: THE LOCK, PACK-FIRST and "ask CD" instructions contradicted root §00. After: §00 governs; the pack is reference evidence; the engineering lessons remain.

## Evidence index

- `git diff origin/main -- src/operator/ia/operatorIA.ts src/operator/shell/SlotSurfaceBody.tsx`: only lines inside the leading `/** */` blocks change.
- `grep -n "Claude Design\|\bCD\b" src/operator/CLAUDE.md`: remaining hits are the §58 record, the pre-existing §00 reversal note, and factual history (pack inventory, the reference render's filename).
- `npx vitest run src/operator/ia/operatorIA.test.ts`: passes (IA module still matches `paige-ia.js`).

## Review and limitations

Self-reviewed line by line, plus Codex review: on 210ce78 one P1 (AGENTS.md line 77 contradicted the struck doctrine) — fixed in 915f657 by aligning AGENTS.md to §00; on 915f657 one P1 (this record's build identity named the parent commit) and one P2 (this section still listed AGENTS.md as out of scope) — both fixed in this record. Remaining Claude Design authority phrasing is only in the three operator component comments named above, recorded as out of slice scope.
