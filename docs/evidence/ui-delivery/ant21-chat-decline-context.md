# Respect the owner's existing Not now choice

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: prior Chat proposal -> owner Not now -> existing scoped confirmation consumption -> trusted current-turn reply context -> canonical terminal with the same answer shown on the wire.
PAIGE_UI_DESIGN: PASS: existing visible-flow/protected-behavior guidance applied; server reply-context repair without interface, navigation, controls, layout, styling or motion changes.
MATERIAL_FLOW_CHANGE: NO: restore truthful behavior of the existing decline interaction and its existing failed-cancellation mutation brake; no new flow, action, approval or authority.
FLOW_PROTOTYPE: NOT_REQUIRED: existing Not now interaction repaired without introducing controls or workflow states.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: eligible SOLO customers decline an approval once and receive a reply that recognizes their choice.
VISUAL_DIRECTION: PASS: existing Chat/card presentation retained; no rendered visual change claimed.
AUTOMATED_EVIDENCE: PASS: actual Chat plus actual CRM handler harness passes 1045 checks, including new first-provider/system-context, continuation, canonical-history, cancellation, stale-approval and failed-cancellation AUTO/confirm negatives; focused regression results below.
STATIC_EVIDENCE: PASS: bounded source diff, syntax and whitespace checks; handler ESLint diagnostics remain identical to its 398-error inherited baseline ignoring line shifts; no new diagnostics. Protected fingerprints, extractors, metadata and CI remain untouched for lead review/renewal.
RENDERED_EVIDENCE: UNVERIFIED: isolated server repair; no production browser, provider-generated reply or viewport proof collected here.
BEHAVIORAL_EVIDENCE: PASS: actual ordinary interactive Request with server-loaded prior approval history, actual Gateway/Chat/CRM handlers, original confirmation-store comparisons and native terminal call exercised at the recording SDK/model boundary.
AUTHENTICATED_RUNTIME: UNVERIFIED: integrated production release and ordinary authenticated paired SOLO decline/reload checks are still required.
KEYBOARD_FOCUS: NOT_APPLICABLE: existing controls and focus handling unchanged.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: matched decline, unmatched token, failed cancellation under confirm and auto, adversarial CRM tool request, read-only continuation, exact prior proposal history, stale re-Approve/replay, ordinary approval controls and scoped CRM refusal regressions.
TRUTHFUL_STATE_LABELS: PASS: acknowledges the choice without promoting a no-error cancellation pass into matched consumption, completed cancellation, non-execution or unchanged-record proof; failed verification remains explicit.
SOLO_UI: NO: shared server conversation-context and canonical CRM door guard only; existing SOLO shell components unchanged.
UNVERIFIED: production behavior, live provider wording, authenticated paired accounts, Live-specific behavior, full 18/50 disposition and final owner acceptance.
OWNER_INTENT: restore usable governed business actions for every eligible current and future SOLO business while respecting a person's decision not to proceed.
MUST_NOT_HAPPEN: asking the person to make the same decline again, treating cancellation-pass success as matched native evidence, re-proposing without new instruction, or dispatching CRM work after failed decline persistence.
MUST_PRESERVE: canonical confirmation selection/consumption, exact stored approval, actor/tenant scope, INT-346 admission/execution/settlement, native writers, duplicate prevention, canonical results, receipts, replay and no positive approval resume on pure decline.
ACCEPTANCE_CRITERIA: first reply and continuation know that the owner already chose Not now; confirmation consumption remains authoritative; failed recording prevents CRM dispatch under confirm and auto; no false outcome claim or positive resume is synthesized; production reply and reload must be verified after release.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: existing scoped cancellation pass, canonical history, first conversational provider request and inherited continuation messages, existing CRM door mutation brake, active workspace recheck, native stored-command approval and terminal persistence.
INTERNAL_BUILD_IDENTITY: 8232051a66d5a26446a8ae6dd139743debd0c808 main base; candidate=local commit accompanying this record; deployment=NOT_APPLICABLE; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(reviewed integrated Chat release); evidence=docs/evidence/ui-delivery/ant21-chat-decline-context.md
RELEASE_CHANNEL: development: isolated candidate; restoration lead owns composition after the separately frozen task-management release.
RELEASE_CLASSIFICATION: patch: truthful decline reply plus restoration of the existing cancellation/workspace brake before the canonical CRM door.
CUSTOMER_RELEASE_IDENTITY: none: no release, activation, authenticated outcome or owner acceptance claimed.
RELEASE_NOTE_REQUIRED: no: isolated source candidate; customer release wording must follow actual integrated production behavior.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: live provider wording, native production records/receipts and paired authenticated Chat/Live outcomes; source/model/SDK fixtures do not close customer acceptance.
RELEASE_RECOVERY: position=forward-fix or revert this bounded context and CRM admission-brake repair together without altering stored confirmations or business records; reference=bounded candidate diff against 8232051a66d5a26446a8ae6dd139743debd0c808.

## Actual cause and bounded repair

The existing pure-decline path consumes matching confirmations and skips approval resume, but the
first reply provider saw only ordinary decline prose beside canonical historical `approval_required`
receipts. Nothing with server authority stated that the owner had already made that choice. The
existing real-Chat/real-CRM test compounded the blind spot by sending approval prose for a decline
and discarding the resulting answer.

The repair adds a server-authored note to `aiMessages` before the first conversational provider
dispatch. Existing continuation messages inherit it. The note is limited to this turn's declined
cards, grants no permission and does not alter historical receipts. A cancellation pass returning
true can have matched no rows, so neither that boolean nor this note asserts native completion or
absence of earlier effects. The error case acknowledges the choice and explicitly retains uncertainty.

The new adversarial failed-recording fixture also exposed a real adjacent gap: the canonical CRM
door ran before the legacy mutation gate without the cancellation/workspace check already present
on the other native action doors. The bounded extension restores that same check before CRM
normalization or dispatch. A refusal is marked `refused_before_run` and `not_applied`, because the
native CRM handler has not been invoked. No permission evaluator, confirmation engine or domain
writer is added or changed. This material guard change requires distinct security review.

## Failing-first and regression evidence

- Before the reply-context change, the extended actual-handler harness had 1039 passing checks
  and five expected failures: no first-provider decline note, no inherited continuation note,
  no matched-row uncertainty instruction, no unmatched-token context and no recording-error context.
- Before the CRM guard extension, the actual failed-cancellation/adversarial-model fixture failed
  in both confirm and auto lanes. In the local fixture, confirm reached the native door once;
  auto reached it and committed one native execution/result. These are synthetic handler-boundary
  records, not proof of any production occurrence.
- After both repairs, the full existing actual-handler harness passes **1045 checks**. Failed
  cancellation dispatches no CRM request, executes/commits nothing, creates no new proposal/result,
  and creates no positive approval resume under both lanes. Ordinary read receipts remain valid.
- The matched-decline scenario uses the real browser interactive shape, an actual server-loaded
  prior user/proposal transcript, the existing consumption compare-and-set and native settlement.
  It checks first-provider system authority, tool-loop inheritance, absence of native CRM writes,
  terminal/wire answer equality, no history rewriting and both stale re-Approve controls.
- The model and database boundary are scripted. These checks prove supplied context and executable
  control flow; they do not prove an actual provider obeys the instruction or native database RLS.
- Final focused Vitest run passes **211 tests in eight files**: stored-proposal execution,
  approval outcome/resolution, native CRM door wiring, confirmation containment, tool confirmation,
  existing Chat approval recovery and confirmation-card reporting. Windows uses the installed
  Git `usr/bin` on PATH for the incumbent test's existing `grep` subprocess. An earlier run without
  that executable was an environment failure, not a passing check.
- Existing actual-handler `int346-conversational-handler-check.mjs` and default two-tool interruption
  check pass. All seven CRM scope vectors and all four CRM acknowledgement outcomes in
  `int336-two-tool-check.mjs` pass after the new guard: same/flipped workspace with ordinary/pinned
  requests, null scope, refused membership, native null tenant, success, malformed, contradictory
  and refused acknowledgements. These checks do not activate production.
- Harness ESLint, Node syntax, whitespace and UI-evidence validation pass. Whole-handler ESLint
  remains at its exact inherited **398 errors**, with identical diagnostic identities/columns
  after allowing the insertion's line-number shift. No unrelated lint cleanup was performed.

[Impeccable](https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md)
clarity and protected-state checks were applied proportionally: one already-made choice, no
repeated approval prompt, no false success, explicit uncertainty and retained existing controls.
Layout, keyboard, responsive and motion work is outside this backend-only change; rendered QA
and real provider wording remain unverified.

## Scope and release proof still owed

The shared code applies to all eligible existing and future SOLO businesses, with no account-name
or ID branches and no provisioning, schema, entitlement, role, credential, connection or provider
changes. Existing legitimate role/configuration restrictions remain. The original 18 historical
capability and 50 parity registers are preserved; no authenticated row closes from this source slice.

The lead must obtain distinct review of the exact composed context/guard change, renew only reviewed
source dependencies, pass final-head CI, release and read back production. Ordinary authenticated
QA must decline an exact protected proposal, confirm original record/result state and consumed
confirmation, inspect the reply, reload and attempt stale re-Approve safely. Live remains a separate
proof requirement. Owner product acceptance follows the technically verified release.
