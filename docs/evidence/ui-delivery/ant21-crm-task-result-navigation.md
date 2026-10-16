# Native CRM task result navigation

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: native task result or uncertain-action check -> shared SOLO task destination -> existing Operations Work -> original operations_crm_work_read/public.tasks; legacy literal task URLs use one compatibility redirect.
PAIGE_UI_DESIGN: PASS: project routing, existing-interface and protected-behavior guidance applied; Impeccable context and detector run; no replacement surface or visual styling.
MATERIAL_FLOW_CHANGE: NO: repair the incorrect destination of an existing task-result/recovery action; preserve the intended task-inspection job, existing Work UI, controls, confirmations and consequences.
FLOW_PROTOTYPE: NOT_REQUIRED: no new task workflow, editor, control or task-focus route; restore existing links to their already-mounted native owner.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: eligible SOLO customers can follow the result or recovery link to the existing task list, including tasks created by the canonical CRM writer.
VISUAL_DIRECTION: PASS: preserve existing Operations, Calendar, Chat and approval design; no token, typography, layout, focus-control or motion changes.
AUTOMATED_EVIDENCE: PASS: 24 actual native CRM handler checks and 167 focused Vitest tests across 12 files; new task URLs, frontend parity, legacy router replace, cached replay and other-tier vectors covered.
STATIC_EVIDENCE: PASS: focused ESLint, Node syntax, whitespace and Impeccable detector checks; only SOLO task destinations and SOLO task locator metadata change.
RENDERED_EVIDENCE: UNVERIFIED: this isolated repair has protected handler/React-router tests only; production screenshots and required viewport drives remain integrated-release proof.
BEHAVIORAL_EVIDENCE: PASS: real native handler and real adapter/MemoryRouter exercised against protected module-boundary fixtures; fixtures do not establish authenticated production persistence or browser geometry.
AUTHENTICATED_RUNTIME: UNVERIFIED: root lead must open the deployed task result under an ordinary authorized SOLO session, reload and inspect the actual task/receipt; Chat-only proof cannot close Live.
KEYBOARD_FOCUS: UNVERIFIED: existing link and Work keyboard controls unchanged; live keyboard navigation/focus proof remains owed.
ZOOM_REFLOW: UNVERIFIED: no geometry or styling change; live zoom and viewport checks remain owed.
REDUCED_MOTION: NOT_APPLICABLE: no added or changed motion; existing route/Work motion preserved.
STATE_COVERAGE: PASS: fresh and cached native task result, uncertain recovery link, old literal URL and trailing slash, replace navigation, role/workspace/token refusal, calendar-owned views, agency/sub-account/operator compatibility and Planning source-query regressions.
TRUTHFUL_STATE_LABELS: PASS: native task links remain surface_only with null deep_link; no invented task query or claim of exact record focus; approval and execution outcomes remain authoritative.
SOLO_UI: YES: existing Chat task check links and legacy SOLO Calendar-task compatibility navigation to Operations Work.
UNVERIFIED: ordinary authenticated production record/receipt navigation, native database persistence, rendered responsive/accessibility proof, Live, final exact-head CI/deployment and owner acceptance.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no authenticated browser/render pass in this isolated source work.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no authenticated browser/render pass in this isolated source work.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no authenticated browser/render pass in this isolated source work.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no authenticated browser/render pass in this isolated source work.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no authenticated browser/render pass in this isolated source work.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no authenticated browser/render pass in this isolated source work.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no authenticated browser/render pass in this isolated source work.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no authenticated browser/render pass in this isolated source work.
OWNER_INTENT: PAIGE creates the authorized task and the customer can find its genuine canonical record through the shared SOLO shell.
MUST_NOT_HAPPEN: routing CRM tasks into an appointments-only Calendar, inventing task-ID focus, mutating domain records during navigation, weakening authorization or changing other tiers.
MUST_PRESERVE: canonical Calendar, Clients-owned Calendar views, existing Planning weeklySource/item focus, native public.tasks writer/readback, actor/tenant checks, exact approvals, risk, replay and receipts.
ACCEPTANCE_CRITERIA: follow a fresh or recovered task result to SOLO Operations Work; old calendar/tasks links land there without a redirect loop; task records remain independently authenticated; other calendar/tier routes retain behavior.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: shared canonical destinations, frontend recovery-link parity, native CRM fresh/cached result locators, scoped approvals and refusal paths, legacy route ownership and Planning query guard; no provider, job, migration or writer changes.
INTERNAL_BUILD_IDENTITY: 0ee4378fd0346d23e0b6c234fa38a8da37a1a4a7 reviewed-summary base; candidate=local commit accompanying this record; deployment=NOT_APPLICABLE; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(reviewed integrated crm-command and dependent source release); evidence=docs/evidence/ui-delivery/ant21-crm-task-result-navigation.md
RELEASE_CHANNEL: development: isolated source/tests only; integrated release gates and production authority remain with root lead.
RELEASE_CLASSIFICATION: patch: repair existing native task result/recovery navigation.
CUSTOMER_RELEASE_IDENTITY: none: no production release or product acceptance claimed.
RELEASE_NOTE_REQUIRED: no: local repair; integrated customer wording must match actual deployed outcome.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: source and protected fixture routing pass; real task persistence, authenticated navigation, rendered UI, Live and owner acceptance remain unverified.
RELEASE_RECOVERY: position=forward-fix or revert route/metadata/alias expression together without altering domain records or approvals; reference=bounded diff after 0ee4378fd0346d23e0b6c234fa38a8da37a1a4a7.

## Root cause, ownership and universal scope

The canonical SOLO `tasks` address and Chat's recovery link still emitted `calendar/tasks`.
The Calendar adapter redirected that legacy address to Clients Calendar, whose SOLO owner displays
appointments. Native CRM tasks are already shown by `OperationsWork` via `useOperationsCrmWork`
and the existing `operations_crm_work_read` function over original `public.tasks` records
(`20271020000250_operations_native_crm_work_read.sql`). No writer, mirror store or scheduler is added.

The shared canonical SOLO/standalone task address now targets `operations/work`. Native SOLO
CRM task locators identify `surface=operations`, `tab=work`, with `deep_link=null` and
`deep_link_status=surface_only`. Cached success uses the same result presenter without another
execution or approval. Only the exact old SOLO `/calendar/tasks` alias (and trailing slash) redirects
to Work. Existing calendar-owned views and other account trees retain their routing. No Planning
`weeklySource`/`item` behavior changes and no `?task=` focus parameter is introduced.

This applies to all eligible existing and future SOLO accounts through shared code and standard
account-address resolution. Addresses confer no authority: existing shell/session and native RLS
contracts remain responsible for tenant isolation. No provisioning, entitlement, role, credential,
provider, migration or historical-record changes are needed. Neutral fixture accounts are regression
vectors, not a customer allowlist or authenticated proof. The 18/50 registers are preserved and
no authenticated acceptance row is closed by these fixtures.

## Failing-first and verification

- Actual native handler first returned `surface=command-center`, `tab=tasks`, and the old
  `calendar/tasks` URL; the new exact locator expectation failed before the source repair.
- Before repair, targeted URL/recovery/router tests produced 5 expected failures: SOLO and
  standalone canonical paths, frontend recovery path, and two legacy alias redirects.
- After repair, the existing served-handler harness passes 24 checks, including fresh result,
  cached replay with zero writes, actor/workspace/token negatives and unchanged agency/sub-account
  task locator metadata. Its SQL responses are fixtures; no production record is claimed.
- Focused Vitest passes 12 files / 167 tests: canonical-app-url, approvalOutcome,
  TenantCanonicalCalendarWorkspace behavior and contract, crm-command edge contract, CRM approval
  door wiring/resolution/Chat adoption, OperationsRoute, useOperationsCrmWork, OperationsWork and
  operations-weekly-source. The router aliases use replace and mount the Work route; normal
  Calendar/Clients routes and Planning focus/dirty-navigation protection pass.
- Focused ESLint, Node syntax, `git diff --check` and Impeccable detector pass. Impeccable's
  unrelated stale design sidecar and available skill update are not modified by this repair.

## Remaining integration gates

Distinct in-project NON-AUTHOR review of immutable b1d80a775d2969f8d8847268ba25e75db3199d67
passed with no material findings. The reviewer independently reran24 actual-handler checks and167
focused tests. Integration renews only the reviewed canonical-app-url source AST digest scalar;
extractor, contracts, metadata and negative controls remain unchanged. The actual-handler command
is added to the existing INT336 CI step. These integrated changes require a final composition
review and exact-head green CI; no production or authenticated navigation result is inferred.
Fresh integrated59 restrictive incumbent controls and214-capability Spine guard PASS. Only the
one reviewed dependency digest scalar changed; no adapter fingerprint, extractor or metadata edit.

Independent Review of the immutable candidate, exact integrated-head CI, reviewed source/dependency
proof renewal, merge, web/Edge deployment and authoritative readback, ordinary authenticated
task/receipt/reload/navigation QA, required responsive checks, Live verification and owner acceptance.
No push, PR, production call, provider action, CI metadata edit or unrelated branch edit occurs here.
