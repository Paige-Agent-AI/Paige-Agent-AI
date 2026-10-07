# INT-340 Settings Analytics implementation

SHELL: SOLO. FLOW-BY-FLOW: APPLIED. IMPECCABLE: APPLIED. Owner prototype approved; implementation authorized. This record does not claim production delivery.

## Approved ownership

Solo retires the visible top-level Analytics destination. Settings places Analytics after Integrations and before Security & data. Internal addresses are `/solo/:account/settings/analytics/{overview,business-health,operations,team,ai-usage,data-health}` using the existing tier routing and Settings scroll host.

Overview summarizes and navigates through distinct client-lifecycle, systems-check, team-role, recorded-AI-request and named coverage views. Detailed destinations inspect canonical measurements and evidence. Operations links into the existing Systems Check evidence and workflow configuration owners. Team measurement links to Team management. Marketing and Sales retain their performance surfaces and formulas; Settings provides owner links without their KPI grids.

## Measurement truth

The UI uses the shared seven-argument metric issuer from the separate foundation slice. The authenticated server remains the source of identity, membership, scope, definitions, calculation, coverage and evidence. Frontend work formats returned values and plots returned distributions/series.

Workspace/actor/range changes synchronously hide old values and cancel acceptance of late responses. Refused, malformed or foreign responses render read failure with refresh; there is no broad fallback. Loading uses geometry-preserving skeletons and reduced-motion support. `UNAVAILABLE` has null values and explanations; `PARTIAL` remains labeled incomplete.

Recorded AI requests have UTC day columns and an accessible selected-day value readout. No fabricated live feed, period comparison, historical snapshot or provider billing total is introduced. Evidence discloses the definition, formula/version, UTC interval, as-of, freshness, coverage, sources, caveats and opaque reference.

## Compatibility

| Historical Solo route | Canonical destination |
|---|---|
| `analytics/money` | Sales / Performance |
| `analytics/market-watch` | Marketing / Analytics |
| `analytics/profitability` | Settings / Analytics / Business Health |
| `analytics/retention` | Settings / Analytics / Business Health |
| `analytics/brief` | Command Center / Business Game Plan |
| `analytics/decisions` | Command Center / Business Game Plan |
| Bare or unknown `analytics/*` | Settings / Analytics / Overview |

Compatibility redirects replace browser history and retain only supported range intent. Settings maps legacy last-30-days to its equivalent rolling month; legacy calendar-quarter/YTD is not represented as a rolling interval. Foreign identifiers and old evidence references are discarded. Agency, Enterprise, Sub-account and operator Analytics routes are not relocated.

## Verification

- Focused consumer, workspace-switch/refusal, compatibility, tier routing, Settings contract, shell and scroll tests: 155 PASS.
- TypeScript ratchet: no new errors; existing baseline 10/current 10.
- Scoped implementation lint: PASS.
- Local application build: PASS before final presentation corrections; exact-head hosted build remains required.
- Chrome 154 synthetic component harness: required four viewport sizes with PAIGE closed/open; no host horizontal overflow; navigation reachable and keyboard End reaches bottom.
- Additional phone-size and 200% CSS-zoom checks: no host horizontal overflow. CSS zoom does not substitute for browser zoom acceptance.
- Final interactions: visible chart columns, selected-day value changes, explicit UTC evidence and named coverage link focus: PASS.
- Independent non-author UI reviewer `/root/overview_review`: SHIP, bounded to implemented presentation and guarded consumer source. Chart visibility, selected readout, named coverage, UTC timestamps and failed-read targeting findings resolved.

All rendered figures are synthetic fixtures in a dev-only harness, not customer records or proof of production population. Fixture transport is not in the production application graph.

## Release and remaining acceptance

This UI slice depends on the versioned metric/evidence foundation. Exact-head hosted CI, authenticated owner/admin positive proof, member/foreign-scope negatives, full copied-link/back-forward checks in the authenticated Solo app, production persistence and owner-account verification remain owed.

INT-339/#1811 is deployed with postdeployment database privacy assertions PASS. Signed-in transport proof and explicit privacy clearance remain pending. #1806 remains held.

Platform Reach owns the shared governed metric reader and Chat registration. Typed Chat and Live must use the same authenticated metric/evidence call; those integrations and their proof remain owed. No separate Settings Chat calculator or voice path is introduced. The shared consumer contract records the INT-343 layer impacts.

## Operations diagnostics follow-through

The approved Operations detail now includes two evidence-backed diagnostic result families: recent recorded workflow activity and current system exceptions. The server projects at most 20 safe rows, preserving the canonical workflow statuses and Systems Check severity/check key. Raw errors, payloads, prompts, URLs and identities are excluded. Capped and incomplete source coverage remains partial; missing sources remain unavailable. Every returned and excluded versioned fact participates in the evidence revision.

Independent non-author SQL source review passed. Consumer review findings about value-shape/semantics substitution and ambiguous local timestamps were repaired and re-reviewed PASS; 15 parser tests passed after those fixes. The updated contract has 22 Settings keys. Chrome synthetic diagnostic rendering passed all eight required viewport/PAIGE combinations, including visible activity, partial state, named exceptions, navigation reachability, no horizontal overflow and End-key reachability. These are local fixture checks, not authenticated production proof.

The preceding UI head e89c304c passed all 656 full-suite test files, typecheck and build, but the final Solo parity guard found its old navigation snapshot/doctrine. Those records now describe the approved Settings placement and preserve the guard itself. Exact current hosted checks remain required.