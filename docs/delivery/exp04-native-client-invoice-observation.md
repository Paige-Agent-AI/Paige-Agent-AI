# EXP04 O11 — original native invoice source observation

Status: source implemented locally; full-schema financial behavior, final review, exact-head CI, release and customer acceptance remain owed. Same original ANT-51 O1–O12 assignment and ANT-163 producer contract; not a new capability lane. No Portal or Chat mount in this increment.

## One query and one business calendar

The existing private four-argument invoice core becomes an exact compatible delegate to the same query with an explicit fifth internal date argument. The financial query is transformed from its guarded native body, not copied into another permanent query. Full inverses must reproduce the original private body d86613d312960b0d507898210e7e5197 and earlier public body28df84d29fcde1e64bb09153f4d3e77b. Original caller-JWT resolver7785, scoped wrappera13e, public wrapper91f0, defaults and grants stay unchanged.

The old four-argument/public paths retain their original UTC date and entire public JSON. Only the native path uses the configured business date. It factors the SAME read_business_time_zone logic into a private invoker helper; the original owner/admin reader retains its OID, authority, owner-only can_set meaning, response and no-receipt behavior. The whole calendar/authority inverse must reproduce4fc91b47874d78ccac6728dcd95eb126. No second calendar setting, date engine, ledger, payment allocation or receipt store.

The CLI-created, UNAPPLIED forward is20271126010004, above the observed production frontier26000000. Earlier proposed80006 was never built or applied. Applied80004/80005 and their historical Preview files remain unchanged.

## Private source ABI

- _client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date): the ONE original query. Original balances/counts/ordering/validation/provider/manual/test facts remain; internal output adds each original issued snapshot version and a SHA256 identity over ALL original facts, including rows outside the returned page.
- _business_time_zone_for_tenant(uuid,timestamptz): original configured zone and conversion, at an explicit finite observation time. Missing and invalid settings stay explicit; neither becomes UTC. No caller preference or invented date.
- _client_portal_invoice_observation_for_client(uuid,uuid): private resolved business/client inputs, actual client-in-business check, fixed limit5/cursorNULL. Returns schema_version1, tenant_id, client_id, query, calendar, facts, observation_identity and read_at. The identity binds the original records/query/calendar/facts, excluding only volatile read timestamps.

All three are volatile invoker functions, postgres-owned, empty search_path, explicit inputs/no defaults, no PUBLIC/anon/authenticated/service_role execution grant. They confer NO requester authority. The existing four-argument core remains private with its original ABI and ACL.

An unknown calendar does not erase balances or invent an overdue answer. A positive outstanding dated invoice has past_due:null without an as-of date; paid, voided or undated records keep their original non-overdue meaning. All-page totals, counts, has_more and next_cursor remain canonical. A limited page never establishes the globally next payment.

## Authorization and orchestration boundary

The eventual entry is an authorized customer's original private Portal/CURA context. No new public Spine registration or model tool is exposed here. The new customer path remains UNAVAILABLE until the paired native consumer is integrated; existing Billing remains the original legitimate governed path.

The original E09 accepted-requester/current-business/client relationship, begin/context/terminal/private-history and final-publication chain is the only intended consumer. It must prove current authority, original source identity, writer/relationship lock ordering, revocation, interruption, unknown-outcome and reload behavior before admitting these facts to a new model answer. A versioned read alone is NOT safe final publication or an executed commercial action.

This is an ordinary stored-source read: no Layer C action, human approval, durable job or scheduler is needed. No Stripe call, charge, signing, external send or provider activation occurs. Original invoices/payments are the durable business records; original conversation/turn/Rail contracts own any later result. No new execution architecture or competing receipt.

## Verification and release boundary

Initial exact test-only head0a91d5cef718fd3debdb742374a5d8fd5c581f44 genuinely failed the new missing-five-argument assertion AFTER original EXP04 status assertions passed: native job123522160285/run40895164670. The failing result is retained; no source check was weakened.

Bounded local PostgreSQL16 catalogue proof passes: actual migration compilation, exact four-argument/public metadata, whole original financial/calendar inverses, all eight function records across replay, and six hostile source/permission controls. The existing five incumbent source bodies were hash-verified against production and loaded into a DISPOSABLE metadata-only database with body validation off only during incumbent bootstrap; validation was on for ALL new source. No Auth/domain tables or real financial behavior were available there. Thus this proves source/catalogue compatibility, NOT full-schema money, customer authorization or acceptance. An initial missing client-side terminator was an excluded fixture setup failure; its database was dropped. Every final disposable database was dropped.

The original full-schema rollback fixture retains every incumbent assertion and adds real native date/DST/missing-invalid/version/balance/cursor/API-denial controls, a temporary frozen original-query oracle, and an off-page identity counterfactual. The metadata extension retains the entire original query hash and authority pins. Replay reuses the actual migration only AFTER the synthetic fixture has rolled back.

Implementation4f716faa reached the new full-schema controls: private metadata, whole original query inverse, complete legacy JSON at sizes1/5/40 and cursor PASS. Required native job123552990137/run40903814569 then FAILED at the new off-page fixture's set_config(session_replication_role) inside a DO block. The later date/identity/role/replay controls were NOT_RUN; this is not a complete financial pass. Repair ONLY that test setup to use the SAME standalone SET LOCAL convention as the incumbent fixture, retaining all three causal change/restoration assertions and restoring triggers before every source read. No parameter grant, checker/CI weakening or product/migration edit. The already-applied native26010004 stays byte-exact. Renewed exact-head full-schema checks remain required.

Managed Previeweuowxrtjupbpbgllyhaw at4f716faa is genuinely SUCCESS: native26010004 ONCE/frontier26010004, all8 expected source bodies/owners/settings/ACLs/defaults read back, Auth0/Clients0. New3 helpers remain private invokers; no API/service grant. Healthy Preview metadata is separate from the failed financial test and is never substituted for customer proof.

Native1d4 job123565771267/run40907392432 confirms the protected-setting repair: standalone SET/UPDATE1/SET all succeed. The off-page comparison then FAILED because its before/after are now separate statements and the ORIGINAL read_at uses statement_timestamp. Correct that test expectation only: financial/page/cursor comparison excludes precisely read_at and the deliberately changed native identity; restoration excludes only read_at and still requires the entire original source identity. Legacy complete-JSON oracle comparisons remain exact inside their original single statement. No amount, record, cursor, version, calendar or source-identity predicate is removed. This is a fixture timestamp correction, not a product function repair or complete financial pass; renewed exact-head proof is required.

Full-schema Preview, exact final-head review and required checks, normal production deployment and native readback remain mandatory. No edit of an applied Preview migration is allowed; a later functional correction requires a reviewed forward.

Functional: local source and bounded catalogue proof only. Visual/experiential: no changed mounted UI; public Billing contract remains compatible, original Portal integration and both-chat/reload proof owed. ALG01/12 source identity/refusal support only, ALG02 incomplete, ALG13 unverified; no maturity/catalogue promotion. Founder acceptance NOT_READY; all twelve original outcomes remain required.

## October 31 C166 — O5 actual-receivable integration candidate

The preceding dated implementation and failed-run records remain historical. The current primary
outcome is **O5 Payment processing**, with no secondary outcome; all twelve original ANT-51 outcomes
remain required. O11's original client financial query is a dependency of that same outcome.

Production metadata was read without invoking a customer function or reading payment rows. The
frontier remains `20271126080007`. Original private facts body `a307bf9e57e5b2ad692c74a329e683cd`
and the original calendar entry `49a0aa9466e6e7a377bfce8c2c1dbca1` exist with their original
owner/settings/ACLs. This does not establish authenticated financial behavior. No candidate below
is deployed and no new forward migration has been created. Reserved `20271126170004` remains after
the actual lower E08, E13 and E05 source chain.

The candidate reuses one canonical native financial position. Its original seven-column adapter
retains legacy TEST-inclusive values, while explicit actual-receivable and LIVE fields exclude
TEST. The original invoice getter supplies those native values to the existing owner workspace,
register and record inspection; original receipts retain their stored environment. Unqualified
legacy provider evidence is displayed as unverified rather than promoted to live collection.
These reads do not create a payment, correction, credit, refund or financial approval.

The client query follows the same compatibility rule. Existing schema 1 means legacy UTC and
schema 2 already means business-calendar-aware data. Neither can silently acquire new monetary
semantics. The proposed schema 3 declares `payment_evidence_version: 2`; its remaining amount is
actual business receivable and its provider total is LIVE, with TEST retained separately. One
extended private query serves an exact old-caller adapter. Whole-query inverse and native
complete-payload comparisons retain the original identity, due dates, cursor, source digest,
counts, minimization and old monetary meanings. No second query engine or ledger is introduced.

The same existing scoped public entry may negotiate only the representation through
`X-PAIGE-Invoice-Evidence-Version: 2`. Original caller/business/client resolution runs first;
the header grants no authority. Missing opt-in retains schema 2. Unsupported or malformed opt-in
is refused. The SDK retains the same RPC arguments, captured authorization, business header,
relationship, currentness and refusal checks, with no fallback to an unscoped read. New private
functions reject unexpected non-owner execution grants; existing service execution on the owner
invoice getter and authenticated execution on the original public entry remain unchanged.

EXP09's original ANT-163 handoff returned only the named financial projection/parser/helper/test
window. Its additional financial-version continuation fence is requested separately: a deployment
between pages must not blend legacy simulated and actual-receivable rows. Original pagination,
identity, frame and calendar controllers have **not** been edited under an assumed wider lease.
This source-window acknowledgment is separate from implemented delivery or customer acceptance.

Current bounded evidence is 13 native position controls, 17 original invoice-getter controls,
18 original client-query controls, replay/rollback and exact original-source restoration, plus
actual original-entry metadata retention. Unexpected default function-grant negatives refuse
atomically. Five actual native invoice outputs passed the actual owner parser. The five focused
Portal suites pass 77 tests, including retained legacy, relationship, calendar, refusal and
stale-context assertions; owner suites previously passed 121 tests in five files. Scoped lint
passes. These are selected-schema/native and source proofs, not full-schema authenticated RPC,
Stripe settlement or customer acceptance. The 512/1024 MiB app-wide compiler attempts failed heap
limits before diagnostics and are not typecheck passes.

Original owner components have 19 local rendered cases across eight widths and both themes,
with four inspected frames, review/cancel, retained input, focus return, denial and read-error
recovery. Those renders use explicit synthetic ports; they do not prove the Portal's new native
representation, production persistence, native zoom, assistive technology, current roles or
provider operation. No whole-Experience premium finish or founder acceptance is claimed.

The remaining O5 implementation includes mode-correct guarded requests and accepted-obligation
allocation, every actual Owner/Finance/Collections/client consumer, provider adjustment and
uncertain-outcome reconciliation, original durable work/Rail receipts, and authorized useful
results with reload/reopen/recovery. TEST merchant readiness is an existing connection/custody
prerequisite; it is not permission to use a different live merchant or activate a provider.

Provider-reference review confirms that refund status, failed-refund reversal evidence and
dispute balance transactions must be handled distinctly. The existing immutable provider receipt
constraints admit receipts, while the original manual correction allows one reversal of its
original receipt. They cannot be weakened into an unreviewed partial-refund mechanism. Refund
allocation and any credit/reduction of accepted debt must extend the original invoice operations,
financial writers and approval path while retaining the signed principal and original provider
evidence. A cash observation alone is not a commercial amendment or debt forgiveness. Supporting
references: [Refund object](https://docs.stripe.com/api/refunds/object),
[Dispute object](https://docs.stripe.com/api/disputes/object),
[credit-note distinction](https://docs.stripe.com/invoicing/dashboard/credit-notes).

Orchestration remains explicit: ordinary original invoice reads use the established scoped
reader/`sales_invoice.read` path without a new Layer C act; consequential financial requests and
corrections retain their existing Trust/Harness approval and writer paths. The previously shipped
provider-observation continuation remains unmounted until its original native carrier, currentness,
reconciliation and release gates are satisfied. ALG-01/12 remain bounded local partial support,
ALG-13 unverified and ALG-02 sequenced; no catalogue or maturity promotion. Exact review, CI,
ordered native/web/Edge release/readback, ordinary owner/client/provider proof and final integrated
founder acceptance remain open.

## October 31 C168 — original invoice document read continuity

O5 remains the only primary outcome. The existing document collector now treats the original
invoice identity, frozen document, financial representation, native totals and ledger metadata
as one snapshot across its pages. It ignores only page rows, per-page completeness and the
original continuation controls when comparing snapshots; JSON object-key order has no meaning.
It does not recompute money, choose a new reader, change authority or silently restart a read.

The same collector refuses contradictory counts, premature completion, empty continuations,
repeated/cyclic server cursors and interrupted reads. The existing ten-page/1000-record cap still
returns an explicitly incomplete history. Genuine empty history and ordinary scoped pagination
remain supported. The original RPC name, captured arguments and server cursor are retained.
No document renderer, frozen agreement/invoice, payment writer or Portal controller is replaced.

The original collector reproduced fourteen new financial/identity/interruption counterexamples
before the repair; a second bounded pass reproduced ten paging failures. Final focused evidence
is 75 passing tests in four original suites, including the original owner, bearer and Portal
read paths into both existing document renderers, and refusal before producing a mixed-invoice
artifact. The collector passes strict Deno checking. These are controlled source/pipeline tests,
not authenticated RPC, current provider, production document/download or customer acceptance.
Existing legacy TEST presentation controls are retained; this does not mount the proposed new
actual-receivable representation in the document renderer.

Native metadata also confirms that the original prepare/claim writers already use
`_sales_invoice_read` under their existing authorization, locks and currentness checks; reuse
those writers. The original ledger wrapper omits the remaining balance when it copies provider
truth, while its predecessor's running totals include TEST. Correct explicit representation and
compatibility in that original ledger and renderer before adopting the new financial projection.
EXP09's additional continuation/PaymentPanel financial window remains requested, not assumed.
No new forward migration, provider call, approval, customer action or capability activation occurred.

## October 31 C169 — native financial history into the original documents

The test-only ledger candidate extends the original four-argument private wrapper. Its predecessor's
document lock, order, invoice/version/cursor checks and original source body remain intact. No new
ledger or renderer is created. Missing representation opt-in retains the complete legacy payload,
even after the owner getter adopts actual balances. Explicit evidence version 2 adds native actual
receipt/reversal totals and running amounts, retains the original gross history, and copies current
balances from the canonical invoice read. Receipt identity, evidence class and TEST/LIVE environment
remain original. The header is a format selection, never actor or payment authority.

The existing document collector requests that format through the incumbent SDK's per-read header,
retaining its original RPC, arguments and server cursor. An older transport/server still yields the
legacy response. Only the native response marker establishes the new semantics. The original
renderer accepts both representations; it validates the native financial facts, displays native
running balances, separates TEST from actual payments, retains full manual-correction history and
refuses contradictions. A real full payment can be settled despite historical TEST evidence. Voided
new-format documents retain history while explaining that the voided invoice is not currently owed.
Neither a TEST receipt nor a requested checkout becomes a real payment claim.

Bounded native evidence now includes the original 13 position controls, 17 getter controls and
20 original ledger controls. Ten complete/partial legacy payloads remain exact, as do original
wrapper metadata and predecessor source. Empty history, three-page reconstruction, stale cursor,
foreign invoice, malformed/future header, full LIVE settlement with retained TEST history,
no-money-write, replay and rollback controls pass.
All owned disposable databases were dropped and the owned local cluster stopped. The first
restricted-loopback attempt executed no native assertions; the owned process was subsequently
observed stopped. A later added empty-history control initially omitted its explicit version opt-in;
that fixture failure was corrected without changing product SQL or weakening the assertion.

The new document cases first reproduced 17 failures with seven negative controls passing. Final
focused evidence is 104 passing tests in five original/new document suites, 12 incumbent delivery
tests under their canonical delivery configuration, and 11 actual handler tests with network seams
stubbed. A first default-config attempt did not select the delivery suite; it is not counted as
delivery evidence. Strict Deno checks of both original document helpers, scoped lint and diff checks
pass. App-wide compiler, full-schema API/role and exact-head hosted checks remain owed.

Five actual selected-native ledger outputs flow through the actual collector and renderer into an
isolated browser: ten desktop/narrow cases, four inspected frames, both existing frozen formats,
correct native final amounts, no root overflow, no browser errors and no network requests. Narrow
tables that need horizontal space accept keyboard focus and scroll. Existing document typography,
palette, document content and layout are retained under Impeccable's refinement/craft-floor checks.
The initial restricted headless launch failed before rendering; the same isolated offline proof then
completed normally. Native zoom, assistive technology, actual PDF output, authenticated download,
genuine provider evidence and durable customer reload/reopen are not established by those renders.

These candidates remain local and unmounted. No forward migration was created/applied, no sender
or provider was activated, and no financial or customer action occurred. EXP09's broader financial
continuation/PaymentPanel window remains pending and untouched. Native actual/legacy history must
still compose with accepted-obligation allocation, provider-adjustment/disposition, every affected
financial consumer, ordered release/readback and correct merchant/Owner/client proof. O5 is the
sole primary; all twelve original outcomes and integrated founder acceptance remain open.

## October 31 C170–C171 — actual accepted obligations and original manual correction

The original accepted-obligation API already describes actual commercial debt. A presence-only
TEST hold was compensating for its final comparison with the legacy TEST-inclusive balance.
The test-only candidate now reads the same canonical actual position for that comparison;
retained TEST history neither fulfills nor hides the original signed schedule. No second API,
format, schedule, financial calculator or command is added. The same original manual executor
uses that position for receipt eligibility and refuses a corrupt negative actual position.
Its actor, approval, invoice/source locks, replay, receipt, correction and Rail statements remain.
All original immutable migrations are preserved. The candidate is NOT a native forward or release.

The original native proof first runs all 93 incumbent controls unchanged, then the optional
`--manual-allocations --actual-receivable` extension. Three causal baseline controls reproduce
the old TEST hold, false legacy settlement and refusal of a genuine manual receipt. Final
evidence is 139 passing controls: 93 original plus 46 additional, including those counterexamples.
Actual original native receipt/assignment/replay/full-correction paths, current invoice revisions,
revoked/unassigned authority, missing approval, stale targets, consent/effectuation, overpayment,
corrupt history and two further three-session authority-lock cases are exercised. TEST receipt
and operation identities remain unchanged and singular. The single original principal remains.
Whole function metadata and the original public reader/actor/governance/dispatch sources are
conserved; replay and hostile widened-grant/changed-security guards pass. The uniquely owned
disposable database was removed and the owned local cluster stopped, with zero databases left.

Three real selected-native Owner payloads now traverse the original package/accepted-agreement
read graph. Only the earlier explicitly synthetic two-argument result port is retired inside
this disposable fixture; immutable original getter/validators/package source and its three
original reader patches are loaded. The getter predecessor remains body
`1d5f5ed876cc95722dc0ef72cb1090f6`; the complete original package body matches the actual catalog
`d909de5729a47809119455d54952a5ef` with its authenticated-only entry grant. No package stub is
substituted. `--actual-samples` emits only this neutral synthetic test output for downstream proof.

Those native payloads also pass the unchanged original TypeScript retained-source decoder:
all eleven exact obligations remain available at 338000 minor units owed, 308000 after the
30000 manual receipt, and 338000 after its full original correction. Twenty-two controlled
checks cover the three exact payloads, single original RPC/arguments, stale version, foreign
workspace, changed/missing signed obligation and backend error; network/provider calls are zero.
The two incumbent decoder/accepted-plan UI suites separately pass all 106 tests. Neither result
establishes hosted authentication, a genuine provider payment, a full-schema Rail receipt, a
rendered new customer path or customer acceptance.

Earlier failed attempts are retained: an incorrect four-argument governance metadata lookup
was corrected to the original five-argument signature; the stronger Owner probe exposed the
missing original package dependency in the reduced fixture. A private decoder harness initially
omitted the real `structuredClone` global and correctly refused; adding that environment global
and comparing complete canonical facts resolved it without changing product code or assertions.
The earlier 130-pass native run lacked the stronger public Owner probes and remains supporting
evidence only. No failed result is relabeled as production success.

Owner's complete-working-Experience amendment is incorporated additively: original goal/context,
editable plan/artifact, governed execution, original result/readback, both-chat durable continuation,
recovery and grounded algorithm evaluation remain acceptance criteria for every applicable O1–O12.
For O5, deterministic original position/allocation/replay checks support ALG-01/ALG-12 only within
these bounded tests; genuine provider reconciliation and exception recovery remain unverified.
ALG-02 activation and ALG-13 next-step quality are not established here. No new agent, native
version, provider activation, signature, charge, message or ordinary-account action occurred.
Next remains SAME O5: integrate provider adjustments and explicit commercial disposition with
the original receipts/obligations/consumers, ordered independent review and exact-head release,
then correct-merchant and authorized Owner/client result/reload/reopen/recovery proof. The full
twelve-outcome Experience is STILL CODING; no outcome or founder acceptance is claimed.

## October 31 C172 — refund/dispute signals into original verification work

The current live event adapter only locates per-payment work through event metadata or the
existing balance-available path. Refund/dispute snapshot objects do not reliably carry the
original payment-intent metadata. A new UNMOUNTED export in that SAME adapter handles only the
ten explicitly supported refund/dispute snapshot signals. The existing verified-signature
ingress remains mandatory and unchanged. It passes only bounded event/type/account/environment/
charge references to a service-only candidate in the original observation-work fixture. Native
scope resolves the original settled operation and receipt, validates the current merchant through
the existing context, and delegates to the SAME original event-occurrence writer. No caller amount,
status, tenant metadata or object contents become payment evidence or financial authority.

An unrelated merchant remains another domain. A known original payment with retired merchant
authority remains an explicit scope refusal, rather than being silently discarded as unrelated.
A known merchant whose original captured payment is
not yet linked remains verification-pending/retryable; no payment or occurrence is invented. The
same event/charge can register after the ORIGINAL allocator establishes capture. Registration
returns only that the original occurrence exists, including replay of blocked/terminal work;
it does not mean observation completed, a refund occurred, debt changed or work will run again.
There is no provider call, new scheduler, second queue, new settlement dispatch or provider-effect
API. The existing live router, endpoint, configuration and immutable migrations are untouched.

Evidence: all 503 tests in the 19 original payment suites pass; the existing event-adapter suite
now has 35 tests, including its five incumbent cases. The actual original native provider proof
also passes with the candidate installed before incumbent lifecycle cases: 36 original observation
controls, all 39 incumbent event-work controls plus 15 appended ingress controls, the pre-capture
pending/post-capture registration case, original two-session observation cases and event-work race.
The original missing-link-guard and missing-merchant-binding causal failures still occur at their
specific unchanged assertions and roll back. Original payment, financial balance and terminal
settlement work are conserved. All five native proof source pins match the executed source.
The owned disposable database was removed and owned local cluster stopped, with zero left.

The added merchant-replacement case also has a causal control: reintroducing an early
"other domain" return causes that exact retained-scope assertion to fail. The test restores
the original resolver byte-for-byte after rollback. A first control injection lacked the
terminating SQL separator and failed with a syntax error; that is INVALID as causal proof.
The separator was fixed without changing product logic or the expected assertion, and the
final full native run proves both the specific causal failure and all 54 positive controls.

Complete original-source inverses are exact for all five changed implementation/test files after
removing only this bounded extension and restoring the prior total-count expectation. The complete
incumbent 39-control count guard remains before the appended block. Strict Deno checking uses the
same cached/pinned Stripe SDK and frozen original server lock, which remains byte-exact; scoped
lint, syntax and diff checks pass. This narrow server graph does not substitute for the owed full
application compiler or exact-head hosted release checks.

The first native extension run correctly rejected a synthetic event ID derived from a name with
underscores. Only the fixture ID was corrected; native production-format validation and all
assertions remain. Earlier Deno attempts used the wrong command path/default dependency cache,
then tried to include unrelated frontend-package workspace metadata in the old server-only lock.
Those failures remain retained. Reusing the original explicit server cache/lock and excluding
frontend package discovery completed the unchanged narrow check without rewriting a lock or
upgrading dependencies. The final original-source inverse probe and executed source pins pass.

Provider semantics were rechecked against the official [event types](https://docs.stripe.com/api/events/types),
[refund object](https://docs.stripe.com/api/refunds/object),
[dispute object](https://docs.stripe.com/api/disputes/object), and
[credit-note documentation](https://docs.stripe.com/invoicing/dashboard/credit-notes).
Refunds, failed-refund reversals, dispute withdrawals/reinstatements and commercial credits are
distinct records/effects. A credit note can reduce an invoice without recording a payment. Our
existing inline Checkout and canonical PAIGE invoice do not establish a Stripe Billing invoice;
using Stripe Billing credit-note APIs as a replacement PAIGE ledger is not an integration plan.
Explicit canonical commercial disposition, actual cash adjustment/allocation, uncertainty and
customer-visible balances/history still need implementation and integrated proof. No automatic
debt forgiveness, actual refund, dispute decision, signed-term change or payment is inferred here.

ALG-01 has bounded deterministic event identity/replay/original-source support in these tests;
ALG-12 has bounded unknown/unlinked/role/scope refusal and recovery support. Neither is a genuine
signed provider event or production reconciliation proof. ALG-02 onboarding and ALG-13 next-step
quality are not established. The same full twelve-outcome assignment and complete-working-
Experience amendment remain required; O5 is still the only primary and is NOT accepted.

Coordination limitation: automatic approval review rejected the detailed source/release update
to Linear. A concise outcome/acceptance-limits summary and amendment ACK were successfully posted
in original ANT-51, ANT-147 and ANT-163. ANT-161 also refuses new replies at its 2000-comment quota;
no history was deleted. Detailed evidence stays local, no raw-source upload/alternate encoding or
rerouting occurred. A concrete limited technical checkpoint is prepared for explicit publication
authorization; the existing canonical tracker notes have not been overwritten or claimed updated.

## October 31 C173 — original customer financial continuity

The explicit E09 financial-only source window is received in original ANT163/973f705f and
incorporated in22775573. The existing invoice hook retains the native representation even on
an empty page, clears it with the original data, and uses the SAME calendar-rollover fresh-read
path before appending a different representation. Original client/Auth/frame/relationship epochs,
calendar/cursor/limit and transport/refusal remain intact. No broader Portal source is assumed.

The original per-invoice decoder retains explicit native actual-debt evidence and refuses an
unsupported marker or missing/malformed required TEST fact, while unversioned legacy behavior
is preserved. The original PaymentPanel uses actual native invoice debt; a legacy or stale
payment read cannot override it, expose a mismatched link or mark it paid. Genuine full LIVE
settlement remains paid even with historical TEST evidence. The original list refresh and
deliberate retry reconcile compatible current reads; no new polling, payment or sender exists.

Focused tests first reproduced22 failures in55 cases. The repaired focused selection passes55;
the fresh broader exact eight-suite selection passes149, including original denials/recovery.
The prior138 result is an overlapping earlier selection, not additional acceptance. Scoped
lint and whitespace checks pass. Original native core13/getter17/ledger20 controls pass again,
with the original full-LIVE-plus-TEST case captured before rollback. All original source/metadata,
replay and cleanup controls remain. The owned disposable database was dropped and local cluster
stopped. This is selected-source native proof, not full-schema/API/Auth/provider evidence.

Selected-native outputs feed the actual invoice hook/page, original navigation and frozen
renderer through the existing customer-mount harness with explicitly synthetic identity and
transport. Sixteen financial/theme/desktop/narrow cases show correct native amounts, no false
TEST settlement, no outer overflow, page errors or outside requests. Four frames were personally
inspected; a bounded two-case confirmation additionally retains the original mismatch/error
before Enter-driven same-read recovery. Warning contrast measures5.43:1 light/7.27:1 dark.
The light confirmation focus-shadow capture is transparent, so visible focus is UNVERIFIED;
programmatic focus/44px target/Enter recovery do not establish full keyboard acceptance.

The original harness files and protected layout/navigation remain unchanged. Synthetic Auth,
the PAIGE placeholder, missing old menu-fixture Payments entry, controlled document transport
and zero provider calls are explicit limits, not signed-in/customer proof. Full-shell viewport
modes, complete Tab/zoom/device/AT, actual PDF/provider/Owner/client receipts/reload/reopen remain
owed. Detailed evidence and failures are recorded in
[the original UI evidence directory](../evidence/ui-delivery/exp04-client-invoice-financial-continuity.md).

The original native per-invoice payment-request projection remains a distinct requested
financial source window in ANT163/d70ae74a, not implicitly cleared by the UI return. No producer
SQL/header change, forward migration, push, PR, reviewed exact head, hosted CI, merge, deployment,
activation or actual financial action is claimed by this increment. SAME O5 remains primary;
remaining original balance consumers, explicit refund/credit/dispute disposition, native producer,
ordered release and genuine authorized proof still need completion. ALG-01/12 support is bounded
to deterministic original currentness/replay/refusal checks; ALG-02/13 and full12/founder remain
open. Safe concise original Linear reporting continues; detailed export permission and canonical
tracker-note updates remain separately pending, with no alternate export or quota workaround.

## October 31 C175 — original Collections financial consumers, same O5

Collections still projected TEST-inclusive remaining debt even after the invoice read candidate
used actual debt. The existing public register now has an unversioned, UNMOUNTED candidate that
reuses the SAME actual financial position under the existing evidence2 header. The whole original
actor/snapshot/cursor predecessor is unchanged. No header preserves whole legacy invoice/receipt
rows. The original public ABI, owner, security, volatility, search path and authenticated-only ACL
remain. New actual rows carry explicit representation and TEST/environment facts; no new amount
calculation, financial write, provider action, sender, scheduler or permission exists.

The original API, hook, detail, receipt trails and export consume those facts. Malformed/future
or mismatched row/page evidence is refused. Empty pages retain their representation, initial
invoice/receipt modes must agree, and a paging rollover invokes the same original refresh before
append. Failed refresh uses original recoverable state/retry. CSV returns no blended result and
retains native TEST/environment fields. Original date, approval, import, manual receipt/correction,
dirty-form and navigation behavior is preserved. This is O5 debt integration, not a second O9
follow-up workstream or completion of that outcome.

The entire original native performance proof runs first:77 original controls PASS, followed by49
appended Collections controls. Current production wrapper/predecessor/legacy7 source pins match;
legacy payloads/security metadata, deterministic replay, role/tenant/cursor/header refusal and
rollback hold. The first failing-source run reproduces20000 displayed remaining versus30000
genuinely owed after TEST history. All original proof/default-report bytes are conserved outside
the optional extension; existing metric bundles remain exact and their separate adoption is owed.
The reduced scaffold's omitted original receipt display fields are explicitly filled before
capturing, without changing amounts/identities. This is selected-source native proof, not full
schema, hosted identity or genuine provider evidence. Owned databases were dropped/cluster stopped.

Those actual native full invoice/receipt payloads traverse the actual SDK/header/export in24
checks with zero network calls. All148 tests in11 Collections suites pass. Causal first runs
retain SDK20 failures/2 passing, hook5/3 and UI3/5; selections overlap and are not summed.
Scoped seven-file lint and whitespace pass. Focused actual API/hook compiler graph672 files uses
original project options and returns baseline0/candidate0 diagnostics. Full UI/app/build and
hosted exact-head checks remain owed.

The source-equivalent pre-implementation original harness traverses desktop light/narrow dark
register/receipts/detail/Escape with native30000 actual debt and separate10000 TEST; three frames
were inspected. Whole proposed two-file executable UI is byte-exact to final source, with no CSS,
layout/action or original harness change. Its final strict offline assertion fails on intercepted
Google Fonts CSS, so actual font loading remains unverified. A wider final-source run completes
five light shell-width/open/closed modes but encounters the intentional compact PAIGE modal.
One confirmation stops because Fold names both backdrop/header. No forced click or shared-shell
change occurs; full matrix, focus/zoom/AT/device and real Chat are not PASS. The first failure JSON
was overwritten by confirmation and some image paths reused; earlier bytes are not claimed retained.
The execution/read transcript and explicit current exclusions remain in the
[original UI evidence record](../evidence/ui-delivery/exp04-collections-financial-continuity.md).

Source/render/native/SDK evidence is still local and unmounted. No native forward/version,
publication, review clearance, exact-head CI, merge, deployment, activation or authenticated
financial result is inferred. Original Chat Collections representation adoption, other remaining
financial consumers, actual refunds/disputes and explicit commercial disposition still need
integration before O5 acceptance. Existing additional Portal projection request remains pending,
without a duplicate ping. ALG-01/12 have only bounded deterministic currentness/replay/refusal
support; ALG-02/13 and all12/founder stay open. Concise original Linear records are updated while
detailed publication/canonical tracker-note changes remain separately pending, without a bypass.

## October 31 C176 — same financial meaning in the original conversational reader

The original E04 read adapter now requests evidence2 through its existing authenticated caller
builder and original read_sales_collections call/arguments/read receipt. It returns closed actual
provider/manual/TEST fields and the native collection flag only after validating explicit source
version, tenant, currency, canonical balance and original invoice reference. Malformed/future,
mixed, coerced or contradictory facts are refused rather than entering model context. Older
unversioned output stays compatible with an explicit TEST/actual-debt caveat. Agreement context,
all original tool declarations and the complete mutation/approval/operation/result/error tail
are conserved; no new tool, risk, permission, caller identity, native writer or shared admission.

Current GitHub main's original adapter was byte-exact before editing. Production
catalogue confirms original read_sales_collections9a6d9c20/postgres/definer/volatile/original
search path/authenticated-only entry, without customer invocation. Same capability and domain
adapter are used where an existing host actually admits them; this is not proof of MERIT's
actual Team Hub/Chat availability or permission to modify E08/E01 admission.

All107 tests in five original/new Chat/commercial-context suites pass, plus24 actual selected-
native-value projector checks with zero network/provider/action calls. The bridge's enclosing
read receipt/tenant metadata is synthetic, so it does not establish real Rail or signed-in Chat.
Strict original cached/frozen Deno graph and scoped lint pass. The whole original mutation tail
and declaration/summary prefix inverse is exact. Initial causal failures, the corrected literal
word-order assertion and array test fixture, and the private loader's original builtin refusal
remain documented in the [existing Collections UI evidence](../evidence/ui-delivery/exp04-collections-financial-continuity.md).

No new visual cycle, markup, shared host, provider effect, native carrier, source publication,
CI/merge/deployment/activation or customer acceptance is claimed. C175's expanded-layout limits
still apply. The full12 remain open with O5 sole primary. Next is original provider refund/
reversal/dispute and explicit commercial disposition, remaining paired producer/consumer paths,
then cumulative review, exact-head release and actual merchant/Owner/client receipt/reload proof.
