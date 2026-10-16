# Contact work through canonical relationships

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: ordinary Chat contact summary -> server-resolved client reference -> verified contact -> native deal-linked CRM tasks and caller-RLS direct-contact Planning items -> original source/status/version facts.
PAIGE_UI_DESIGN: PASS: existing visible-flow and protected-behavior guidance applied; backend summary repair only, with no interface, style, controls, navigation or motion changes.
MATERIAL_FLOW_CHANGE: NO: restore truthful work evidence behind the existing contact-summary tool and argument contract; no new workflow, capability, task writer or authority.
FLOW_PROTOTYPE: NOT_REQUIRED: existing Chat contact-summary flow is repaired without introducing controls, states, actions or task creation behavior.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: eligible SOLO customers ask about a contact and see genuinely related, currently visible work without unrelated company/assignee tasks being attributed to that contact.
VISUAL_DIRECTION: PASS: existing Chat presentation retained; separate native source identities/statuses avoid misrepresenting Planning items as CRM tasks.
AUTOMATED_EVIDENCE: PASS: 22 actual-handler cases, 54 C0b binding/negative controls, and 57 focused Vitest tests across six files; fixture database boundary is explicit.
STATIC_EVIDENCE: PASS: focused lint, Node syntax, whitespace and inspected scoped source diff; generic protected fingerprints, extractor, capability metadata, CI and migrations unchanged.
RENDERED_EVIDENCE: UNVERIFIED: backend-only candidate; no production browser or viewport evidence collected in this isolated task.
BEHAVIORAL_EVIDENCE: PASS: actual Request, unchanged Chat handler/Gateway and model tool-result projection exercised against the existing recording SDK boundary; source fixtures do not prove native database RLS or PostgREST runtime.
AUTHENTICATED_RUNTIME: UNVERIFIED: ordinary authenticated paired SOLO contact-work reads and native records/receipts require the integrated release; no production calls here.
KEYBOARD_FOCUS: NOT_APPLICABLE: existing Chat controls and focus behavior unchanged.
ZOOM_REFLOW: NOT_APPLICABLE: no layout or visual component change.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: native deal linkage, direct-contact Planning linkage, company/assignee non-attribution, foreign tenant/parent/contact, missing/legacy versions, missing contact/reference, role/workspace refusal, mid-read scope change, child-query errors and bounded/truncated results.
TRUTHFUL_STATE_LABELS: PASS: errors refuse the summary instead of returning successful empty work; has-more flags name truncation; direct native CRM contact linking stays unavailable; Planning visibility is caller_rls.
SOLO_UI: YES: the composed CRM outcome also corrects the existing SOLO People and confirmation card; the summary read itself changes no geometry
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no authenticated composed-candidate viewport certification
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no authenticated composed-candidate viewport certification
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no authenticated composed-candidate viewport certification
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no authenticated composed-candidate viewport certification
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no authenticated composed-candidate viewport certification
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no authenticated composed-candidate viewport certification
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no authenticated composed-candidate viewport certification
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no authenticated composed-candidate viewport certification
UNVERIFIED: native PostgREST join and caller-RLS runtime, authenticated Planning creation/readback, paired production Chat/Live, deployment, full 18/50 dispositions and owner acceptance.
OWNER_INTENT: restore actual contact-related business work through existing CRM/Planning architecture for every eligible current and future SOLO account.
MUST_NOT_HAPPEN: equating business IDs with contact IDs, inventing company-to-contact attribution, using service-role Planning reads, collapsing two native identities, claiming empty/success after a failed query, or creating replacement records/stores.
MUST_PRESERVE: tool key/client_ref argument, server actor/tenant authority, canonical domain writers, exact approvals, native task version/risk/replay/receipt contracts, unsupported direct CRM contact-link refusal and other Chat branches.
ACCEPTANCE_CRITERIA: a contact summary shows actual same-tenant deal-linked CRM tasks and directly linked caller-visible Planning work with original IDs/statuses/versions; unrelated/foreign records are excluded; failures and truncation are explicit; real records and authenticated QA remain required.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: contact reference resolution, verified contact parent, task/deal/contact join and tenant pins, caller-JWT Planning SELECT, native status/version projections, bounded reads, source purity, child-error refusal and final workspace recheck.
INTERNAL_BUILD_IDENTITY: 8232051a66d5a26446a8ae6dd139743debd0c808 main base; candidate=local commit accompanying this record; deployment=NOT_APPLICABLE; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(reviewed integrated Chat release); evidence=docs/evidence/ui-delivery/ant21-contact-work-summary.md
RELEASE_CHANNEL: development: isolated candidate; root lead owns composition with the separately frozen task-management release.
RELEASE_CLASSIFICATION: patch: repair incorrect contact work attribution and omitted existing Planning work.
CUSTOMER_RELEASE_IDENTITY: none: no customer release or owner acceptance claimed.
RELEASE_NOTE_REQUIRED: no: local source slice; integrated customer wording must match actual released outcome.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: native database/RLS and authenticated contact-linked work behavior, release and customer acceptance; only source/fixture evidence passes here.
RELEASE_RECOVERY: position=forward-fix or revert this summary/explicit binding-proof change together without domain record or approval data changes; reference=bounded candidate diff against 8232051a66d5a26446a8ae6dd139743debd0c808.

## Existing contracts and scope

- `tasks.biz_id` references `businesses.id`, and `tasks.deal_id` references `deals.id`;
  `deals.contact_client_id` is the native contact relationship. Generated database types and
  the original schema/FK migrations agree. Direct `task.create.patch.contact_id` remains
  explicitly refused by the existing reversible CRM executor with `CRM_TASK_CONTACT_LINK_UNAVAILABLE`.
- `plan_items.contact_id` already references `clients.id`. `plan_assign_task` and
  `plan_set_reminder` already stamp it; `ContactPlanningPanel`, `usePlanList`, Operations and
  `read_client_engagement_status` already consume this native work. Authenticated SELECT grants
  and `plan_items_read` RLS already exist (including the 20270503 policy correction).
- The repaired summary queries native CRM tasks through the real deal FK inner join, with
  task tenant, deal tenant and deal contact pins. This query is independent of the first 20
  displayed deals. Planning uses the original caller-JWT client with explicit tenant/contact
  pins and existing RLS. Separate `open_tasks` and `planning_work` retain native source, record
  kind, status and raw version fields. Company and assignee relationships confer no contact attribution.
- The contact is verified before child reads. Closed projections avoid metadata. Work reads use
  a 21-row sentinel to return 20 rows and explicit has-more flags; deals also report truncation.
  Activities retain verified contact-deal parents with joined tenant/contact predicates;
  communication history gains an explicit tenant pin. Every child-query error refuses the
  summary, and a final caller-JWT workspace check rejects a scope change during the read.
- Shared code applies to every eligible existing/future SOLO account. No per-account condition,
  provisioning, schema, policy, grant, role, credential, provider or historical-record mutation.
  Existing legitimate RLS visibility/configuration differences remain intact. The original
  18-capability and 50-parity registers are preserved; no authenticated row closes from fixtures.

## Verification and source-contract proposal

The actual baseline request returned the unrelated task whose `biz_id` happened to equal the
contact ID, while omitting the genuinely deal-linked task. The new actual-handler assertion failed
on that exact ID mismatch before product source changed. After repair:

- `node --import ./scripts/client-memory-authz/register.mjs scripts/crm-contact-work-summary-check.mjs`
  passes 22 cases with no external egress or business action dispatch. Its real selected columns,
  relation/tenant/status filters, caller SDK kind and subsequent model tool-result are inspected.
- `node --test scripts/ci/c0b-crm-read-binding.test.mjs` passes 54 controls. The old explicitly
  incorrect `tasks.biz_id=id` proof is replaced by task/deal/contact tenant predicates, exact
  bounded/native projections, caller-JWT Planning identity, resolved contact/parent bindings,
  mandatory error handling and final workspace checks. Adversarial mutations remove each
  protection or substitute service authority, arguments, effects, versions or relationship scope.
  Other CRM tools keep their existing read/purity checks. This is an explicit reviewable contract
  proposal, not automatic fingerprint renewal or permission to run an action.
- Six focused Vitest files pass 57 tests: the actual-handler wrapper, CRM edge/native command
  contracts, CRM Pipeline registration, ClientStanding and Operations CRM reader.
- Focused ESLint, Node syntax and `git diff --check` pass. No SQL fixture or live database was
  run by this isolated lane; SDK fixtures prove emitted queries/routing, not native RLS enforcement.

Supabase [join documentation](https://supabase.com/docs/guides/database/joins-and-nesting) and
[RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) were checked
alongside the current changelog and existing schema. Documentation is not runtime evidence.

## Remaining release and native proof

Root lead must independently review this immutable source/proof proposal, compose after task
PR2236, renew only the reviewed generic source fingerprints/dependencies, run exact-head CI,
merge/deploy/read back production, and verify native PostgREST relation shape and actual
caller-RLS Planning reads under ordinary authorized sessions. Authenticated creation/readback
through the existing `plan_assign_task` contact path, genuine CRM deal/task records, refusal,
reload/recovery/receipts, paired isolation and Live remain separate required outcomes. No new
direct CRM contact FK or writer extension is implemented or claimed by this read repair.

## Lead composition and release boundary — 2026-10-16

The coherent CRM outcome candidate starts from task-management head94cad381209ebe5ae1d5323ec027f7e3bc71dd75 (PR2236; its release is independently gated). It combines the separately NON-AUTHOR-reviewed contact summary178e7adb, declined-approval context/CRM refusal64d9310b, People owner/freshness665ff5ed, question continuation8688aee5 and deal-create owner contractc1b2759c. Each original evidence record and actual-source regression is retained. No review is described as a human approval.

After those source reviews, the lead renewed only29 dispatch fingerprint string scalars. The unchanged extractor includes the complete request-handler ancestry, so all29 incumbents detect these bounded changes. A private before/after receipt verifies every scalar and byte-equality of the masked guard. Frozen capability metadata, SOURCES/ANCESTRY_SOURCES, extractors, existing negative controls, native SQL, roles, provider authority and INT346 retirement/activation remain unchanged. The specific contact-summary AST contract is separately tightened by its original reviewed delta; all54 controls, plus all59 incumbent controls, pass in the combined source. Spine guard214 also passes.

The new actual answer-continuation and contact-summary fixtures run in the existing INT336 CI step. Native answer/claim/settlement tests use a fresh disposable loopback int336_test_answer_admission database on the existing task-owned PostgreSQL cluster. The existing isolated worker-retirement real-window proof is retained unchanged. Its400-second bound is never shortened or inferred from a deployment. The new CI fixture does not touch production or release flags.

Root independently passed17 combined actual answer-handler checks plus9 history controls and22 combined contact-summary handler cases. An initial summary command used the Knowledge loader rather than the documented client-memory loader and failed before loading serve(); the corrected documented command passes. That environment mistake is not product proof. Root's deal catalogue type check initially identified two new assertion property-access errors; the assertions now inspect the same complete object contract and the ratchet passes with no new diagnostics (baseline10/current8). The final deal source was separately reviewed with68 tests, nine actual native-handler validation cases and all32 serialized tool schemas compiled; no real execution was attempted by the reviewer.

Immutable final composition review, exact-head hosted CI, merge/source readback, ordinary protected contact ownership freshness, exact deal/contact/create/assignment and question continuation, cancellation wording and durable reload remain owed. Native PostgREST/RLS and actual business results cannot be inferred from the recording SDK. Live and owner product acceptance are separate. The original18/50 registers and all existing/future eligible SOLO scope remain intact.
