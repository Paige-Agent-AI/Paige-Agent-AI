# UI delivery evidence: EXP10 PR14 — the rate-limit copy line in the connection write/probe message map

Covers THIS branch's only src/solo delta: one added case in `mcpWriteMessage`
(src/solo/data/useMcpConnection.ts) so a probe that returns the new closed code
`http_rate_limited` tells the owner the true remediation — "It is saved; wait a moment and
check again — reconnecting will not help" — instead of falling to the generic default
("the server could not be reached"), which is the exact conflation this PR removes everywhere
else. Nothing renders differently except that one sentence; the map's incumbent idiom
("…It is saved but not working.") is preserved.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the affected flow is the existing save-connection → probe → message line; this delta adds one honest message for one new probe outcome, nothing else.
PAIGE_UI_DESIGN: PASS: Impeccable context + craft-floor loaded this session (standing EXP10 discipline); zero component, token or layout bytes change — the incumbent one-line message idiom is followed verbatim in tense and structure.
MATERIAL_FLOW_CHANGE: NO: same single message line renders, now with a truthful sentence for a case that previously borrowed the could-not-be-reached text.
FLOW_PROTOTYPE: NOT_REQUIRED: non-material; no flow change to prototype.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a workspace admin whose provider is rate-limiting sees "wait and check again," not an instruction to reconnect or a false claim the server was unreachable.
VISUAL_DIRECTION: PASS: the incumbent message-line style; no new visual elements.
AUTOMATED_EVIDENCE: PASS: the closed code and its server-side copy are pinned by the new Deno suite (mcp-timeout-ratelimit.test.ts, 8 tests, CI step beside the connections_healthy runner's); this message map has no existing test enumeration (verified — mcpWriteMessage has no test file), and the map's default branch remains the fallback for unknown codes.
STATIC_EVIDENCE: PASS: ts.transpileModule clean on the edited file; the map remains a total function over strings via its default arm.
RENDERED_EVIDENCE: NOT_APPLICABLE: the sentence renders in the existing message line the prior records already evidenced; no new rendering structure.
BEHAVIORAL_EVIDENCE: NOT_APPLICABLE: no interaction change; the map is a pure string function.
AUTHENTICATED_RUNTIME: NOT_APPLICABLE: no authenticated surface is touched beyond the existing message line's content.
KEYBOARD_FOCUS: NOT_APPLICABLE: no focusable change.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: the new case covers exactly one new closed code; every other code's message is byte-identical; unknown codes still hit the default.
TRUTHFUL_STATE_LABELS: PASS: the sentence states the actual condition (rate-limited, temporary, saved) and rules out the wrong remedy — the same truth split the PR ships server-side.
SOLO_UI: YES: src/solo/data/useMcpConnection.ts serves the Solo settings Integrations surfaces; the change is one message string in the existing map.
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no rendering structure changes; the message line's viewport behavior is the incumbent's.
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: same.
UNVERIFIED: verified on the exact tree: the Deno suite (server-side half of this truth split) and the registry/spine self-tests; no rendered capture is claimed for a one-string delta whose rendering structure prior records evidenced.
OWNER_INTENT: owner directives 2026-10-25/26 — truthful denied/unavailable/partially-configured outcomes with the honest remedy per state; the AWS ruling named this timeout/429 pin as the justified improvement.
MUST_NOT_HAPPEN: a rate-limited provider must never read as unreachable or credential-rejected; the map's default must stay reachable for unknown codes; no credential or provider prose in the message.
MUST_PRESERVE: every existing case's message byte-identical; the write-vs-probe kind distinction in the default arm.
ACCEPTANCE_CRITERIA: an admin connecting against a rate-limiting provider reads one sentence naming the condition and the remedy that works.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: the map is presentation-only; the probe/write seams are untouched.

INTERNAL_BUILD_IDENTITY: 562bf1903cbff8f9c521f91ce15972ff96645a95 (exp10-pr14-ratelimit-code changeset on origin/main); deployment=vercel-preview-per-push; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp10-ratelimit-copy-line.md
RELEASE_CHANNEL: preview: unmerged branch; Vercel preview deploys per push only
RELEASE_CLASSIFICATION: internal-only: one honest message string in an existing error map; no customer release identity until the provider surfaces it in an authenticated drive
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only until an authenticated connect drive exercises the line
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the line ships on merge; an authenticated rate-limited connect remains owed with the broader A2 proof
RELEASE_RECOVERY: position=revert-restores-the-prior-default-message; reference=this record plus the revert commit
