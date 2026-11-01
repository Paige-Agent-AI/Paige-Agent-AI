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

## October 31 C177 — original provider cash evidence and commercial-review boundary

An UNMOUNTED private three-argument overload of the original financial position reuses the
unchanged original ten-field calculation and immutable invoice/provider operation, receipt,
observation and Rail. No new ledger/table, SDK, public grant, provider call, job or event writer.
It retains original captured principal separately from successful/pending refunds, refund cash
debit/recovery, dispute withdrawal/reinstatement, TEST history and exact current observation
identities. A won label without the actual withdrawal/return pair, contradictory lost/return
facts, pending balance, overlapping out-of-range principal or unverified original event work
cannot become a settled net amount. Unknown is explicit/null rather than a fabricated zero.
Historical merchant revocation preserves retained cash evidence without authorizing another
provider action. Original issued document/economics, receipt, legacy seven-field and existing
actual-debt ten-field results stay exact. Refund cash neither forgives nor reasserts debt; the
separate commercial-review flag must be integrated into original public reads/actions/UI before
this is a useful released payment outcome. Explicit commercial disposition is still unbuilt.

The SAME original native provider proof runs with its real original prepare/claim/finalize/
allocation/observation/Work/Rail source and disclosed synthetic Auth/table/provider ports. The
new selected-native phase passes36 checks and2 actual permission-drift controls; all original
provider controls,36 observation controls,54 Work controls and existing real-session races pass.
The first control fails precisely when the new implementation is absent. Setup failures
(reserved output name, fixture schema qualification and non-UTC synthetic timestamp) are
retained and excluded from behavioral proof. Fourteen assertions then pass before the
causal won-with-no-movements failure; the correction passes the whole phase. A separate
transactional installation that ignores cash movements fails the exact refund-principal
assertion. No required assertion was removed. Each owned proof database is dropped and its
exact owned cluster stopped; no external database/provider or real payment was used.

The entire default proof script inverse is byte-exact outside its three optional extensions,
and both original financial projections are unchanged. This is selected-source local evidence,
not full-schema/hosted identity, actual Stripe TEST settlement, signed-in Owner/client result,
current production balance or final acceptance. No new frontend is claimed: C175 rendering
remains14/18 with its retained dark compact keyboard failure and actual font/full-shell/device/
authenticated limits. New fields are NOT mounted in public readers, Chat, Team Hub or Portal.

ALG-01/12 gain only bounded local source/replay/cash-exception support. ALG-02/13 maturity and
production verification are unchanged/unverified. No new Spine/catalogue Live state. Original
event-to-Work-to-observation-to-Rail architecture stays unmounted for this candidate; ordinary
reads do not need another executor. Existing additional Portal producer request remains pending
without a duplicate ping. Next is explicit governed commercial disposition and the paired
original payment/balance/action/customer surfaces, then cumulative exact-head review, required
CI/release/readback and genuine merchant/Owner/client receipt/reload/recovery. O5 is sole primary,
no secondary, all original twelve and integrated founder acceptance remain open.

## October 31 C180–C181 — reviewed financial-decision adapter, not a live writer

The intended usable outcome is an owner reviewing the exact treatment of an original provider
payment, recording an authorized credit or retained debt, and recovering that same durable
operation. This increment implements the closed command, original high/confirm Kit declaration,
server-authored consequence binding and result fence in the existing invoice HTTP door. Its
Spine row remains explicitly UNAVAILABLE, not self-described or Chat-exposed. No native writer,
public financial projection, customer action, ledger, sender, payment engine or activation is
added here. All earlier invoice actions retain their original paths.

Credit requires the owner's explicit positive minor amount, bounded by the future native
original-payment/obligation calculation. A refund failure can still leave the business owing a
refund; neither provider success nor failure chooses a commercial credit. The original invoice,
accepted document, provider cash and internal decision remain separate. Native before/after
debt and refund payable are retained as separate facts; unpaid future installments and a refund
liability may coexist. Unknown prior standing stays null/needs_review, never zero. This corrects
the earlier private no-amount prototype proposal without rewriting its dated evidence.

The existing approval retains the complete closed native review: original client/invoice and
version, original payment and observation/version, prior decision version, exact requested
credit, native balances and source hash. Missing or changed native facts refuse before an
effect. Stored approval facts must match the current native preview, and only those stored
facts enter original invoice governance. The result must name the same operation, invoice,
tenant and expected versions, original receipt identity and explicit internal-only effect.
Incomplete, contradictory, money-movement or notification claims remain outcome_unknown with
the same recoverable operation. An unchanged label also requires genuinely unchanged native
credit/debt/refund facts and a previously recorded decision.

### Applicable orchestration contract

1. Owner requests a financial treatment for an existing provider payment.
2. Entry is the original Sales invoice review; production form mounting is still owed.
3. Original invoice/provider payment/observation and invoice operation journal remain authoritative;
   sales_invoice.record_provider_disposition is declared UNAVAILABLE.
4. Reuse public.execute_sales_invoice_command and the original governed invoice adapter. No second
   Layer C executor is created and no ordinary read is forced through event dispatch.
5. Existing current user, server-resolved tenant and active owner/admin admission remain required;
   actual native revalidation under original locks is still part of the unbuilt writer.
6. High risk always clamps to the existing confirmation gate; auto preference is not approval.
7. Original immutable invoice operation and real record_capability_run/Rail receipt are required;
   the HTTP tests supply disclosed synthetic database/receipt ports, not real Rail evidence.
8. No provider request occurs. Reuse retained original cash reconciliation and same-operation
   readback; native atomic persistence, replay and duplicate prevention remain owed.
9. Stale/missing review refuses; unverified result remains unknown. Recovery may not create a new
   operation or claim payment, signing, client notice or amended signed terms.
10. Display the exact native decision, original receipt and revised standing only after the real
    writer/readback and paired original UI are implemented and verified.

Actual HTTP, command, Kit and result tests first reproduced missing consequence/result fences.
Four later unchanged-result counterexamples failed before their repair, and an unsafe next-version
intent failed before its parser bound. Current focused source proof and exact final counts are
recorded in the owning UI evidence; these are isolated tests, not authenticated financial proof.
Strict checking uses the unchanged repository deno.lock and original pinned SDK graph. An initial
check using the earlier Stripe-only private lock failed for a missing existing SDK entry; no lock,
SDK, permission or assertion was weakened to obtain the canonical check.

The private prototype has thirteen distinct completed interaction cases across two runs, including
original review, keyboard, cancel retention, stale refusal and same-operation unknown recovery.
It used the earlier mocked profile, not the final native contract. Its label and scenario-cleanup
failures remain retained. Production UI and final paired rendering are still owed; C175's separate
fourteen/eighteen layout limitation is unchanged. Functional, visual and authenticated acceptance
must not be combined into a completed outcome claim.

ANT163's October31 additional source-custody clearance for the ORIGINAL client payment-request
financial projection/evidence header is received and acknowledged. Its scope/permission/legacy
and release obligations remain intact; no Portal writer or UI takeover is implied. Next is the
same native financial calculation and original obligation allocation, governed append-only
decision/Rail/recovery, then paired Owner/client presentation and cumulative review/release proof.
ALG-01/12 gain bounded local argument/currentness/result-refusal checks only; ALG-02/13 maturity,
actual merchant TEST settlement, ordinary Owner/client evidence and founder acceptance remain
unverified. Development only; no new PR, exact-head hosted CI, merge, deployment or activation.
O5 remains the sole primary; all twelve original outcomes remain open.

## October 31 C182–C186 — original native decision, accepted allocations and recovery

The INERT candidate now implements the internal financial decision through the ORIGINAL invoice
preview, executor, immutable invoice operation journal, original Rail and result reader. It
extends the existing native financial-position family: unchanged legacy seven/ten-field sources,
one retained-cash source with exact per-payment attribution, then one actual-standing projection
over the original accepted targets and manual-allocation evidence. No additional ledger, payment
processor, approval channel, scheduler, execution store or provider action is introduced.

The source can distinguish retained provider principal, an explicit owner credit, future unpaid
obligations and a separate refund payable. A credit against the original deposit does not silently
pay a future installment. The retained neutral $3,500/$500/ten-$300 source is exercised through
the real original accepted-payload/effectuation readers and native payment doors. A $100 deposit
credit with a failed refund leaves $3,000 in future obligations AND a $100 refund liability. Later
installment cash/credit stays attached to its exact original target. TEST receipts/refund history
never fulfill an actual obligation or acquire a real credit. Original terms, signing record,
issued document and principal remain exact. Fixture signing/provider/identity metadata is
synthetic; these are not genuine signatures, Stripe settlements or customer results.

Unpublished review version2 adds an explicit after-standing state. Resolving one payment while
another needs review is permitted, with unresolved before/after totals retained as null. It does
not invent a final balance or require all decisions to happen in an unsupported batch. The
native approved consequence, original invoice/client/payment/observation and prior decision
versions remain bound to the existing confirmation. Real financial changes append a version;
same-treatment reviews preserve it. Missing/currentness/permission evidence refuses, and a
completion claim requires its original operation and actual Rail receipt. A pre-existing other-
action receipt or success receipt missing its operation is refused before a new financial write.
The generic shared Rail implementation is unchanged; this is not a global Rail concurrency audit.

The new action's result deliberately returns only invoice identity/version in its row, alongside
the exact reviewed financial consequence. A source-review counterexample first demonstrated
that a legacy gross settlement/balance could otherwise accompany the revised standing. The
decoder and native result now reject that mismatch. Paired UI must refresh authoritative current
records rather than treating the receipt as a complete refreshed legacy invoice.

### Actual bounded proof

- The SAME original provider proof retains its entire default source inverse. All original
  prepare/claim/settlement/observation/Work/Rail and real-session controls still execute; cash
  attribution passes39 checks plus2 real ACL-drift controls. The missing attribution first
  failed its exact native assertion before the cash-source repair.
- New financial phase:55 native checks PASS —30 original financial controls,12 accepted-plan
  controls and13 source/authority/result controls. The original30-case block remains byte-exact.
  Actual distinct database sessions prove duplicate recovery and stale competing refusal. An
  explicitly injected post-commit client-observation error recovers one original operation and
  receipt. This is not a network/provider-crash or hosted-authentication claim.
- Seven actual HTTP/contract/Kit/review/result suites pass255 checks. Review-v2 positives first
  failed against the earlier schema. The false unchanged-result, unsafe next-version and stale
  legacy-row counterexamples are retained from their respective earlier runs.
- Three actual retained native commands/results, including the unresolved multi-payment result,
  traverse the production decoder in14 read-only checks with zero provider/action calls.
  Scoped lint, strict unchanged frozen/cached Deno graph and whitespace checks pass.

Retained initial failures include SQL CASE parsing, a proof observer incorrectly reading a
protected table (replaced with the ORIGINAL authorized context RPC, with no grant change), the
qualified history-field repair after a recorded decision, the proof's raw-newline transport
(fixed by reading the exact definition as JSON, without a source normalizer), and an async read
in the private decoder bridge. The pre-existing receipt-identity control genuinely failed before
the new writer fence. No required assertion or permission was loosened. Each owned database is
removed by the original runner and the exact owned loopback cluster stops. Logs are unique per
attempt; older current-status JSON snapshots can be superseded and are not falsely claimed as
separately retained bytes. These are selected-schema proofs with disclosed reduced table/Auth/
signing/provider ports, not full-schema, managed Preview, provider or customer acceptance.

### Remaining O5 release holds

The native source remains INERT/unversioned and the Spine capability remains UNAVAILABLE. No
new public customer financial contract or production form is mounted. Before a useful release:

1. Integrate the same actual-standing source into original invoice/payment-request prepare,
   claim, allocation and read paths, including correct original accepted-target selection. Do
   not activate this decision alongside a legacy gross-balance writer, paid label or checkout.
   Full/unassigned or revised provider allocations require an explicit governed original-target
   assignment; never invent FIFO, an automatic cross-installment offset or a second ledger.
2. Finish original Owner/Collections/Chat and CLEARED EXP09 financial producer/consumer spans,
   version negotiation, truthful paid/credited/refund/unknown states and original record links.
   Native principal retained is not bank cash, fee accounting or a payment-completion claim.
3. Mount the final exact-consequence form and receipt/reload/reopen/recovery flow, then inspect
   the real desktop/narrow/full-shell/keyboard/accessibility states. Earlier prototype13 and
   compact-shell14/18 evidence is historical, not the new version2 production UI.
4. Complete cumulative exact-head review, required full-schema/CI, ordered compatible carrier,
   normal release/readback and authorized actual merchant TEST plus ordinary Owner/client proof.

The original additional Portal payment-request projection/header window is clear, with its
existing permission/legacy/source boundaries preserved. No Portal, Work, shared host, provider
custody or admission ownership is taken. This native integration uses the established governed
invoice pathway; it does not create or activate another Layer C executor. Actual Chat/Live/
Team Hub execution remains subject to its existing admission and availability gates.
ALG-01/12 gain bounded native reconciliation/exception/recovery support only; ALG-02/13 maturity
and genuine provider/customer verification are unchanged. Functional source is PARTIAL/local;
Visual/Experiential remain incomplete; Founder Acceptance is OPEN. O5 sole primary, no secondary,
all twelve original outcomes and the full professional Agreements destination remain required.

## October 31 C187 — original payment writers use actual collectibility

O5 remains the sole current outcome, within the original twelve. Development only:
the companion source is INERT/unversioned, with no new PR, hosted CI, merge, native
carrier, deployment, activation or customer acceptance. No payment, signature,
provider request, customer message, account or permission was changed.

The original prepare, claim and verified-allocation writers now read the SAME
canonical actual position under their original locks. Their original actor,
merchant, authority, operation identity, immutable receipt, replay and Rail gates
remain. The original service selector returns its exact six-field DTO with the
current actual amount for the exact accepted target. The private accepted-source
helper has one source-only mode; the old two-argument mode retains its whole
legacy payload. This avoids both recursion and treating historical gross captures
as current retained principal. No second obligation or financial store is created.

The failing-first original writer refused a genuine $100 re-collection after a
$100 refund on a $300 installment because its legacy target remaining was zero.
The repaired original path prepares, claims and records that exact $100 once.
The original installment is then satisfied without recreating its obligation;
the separate $100 deposit refund payable and $2,400 future debt remain distinct.
A same-invoice $3,500 TEST capture followed by $3,500 LIVE evidence leaves actual
principal outstanding at zero, with TEST still separate. These are synthetic
provider/signing/identity fixtures, not actual settlements or signatures.

An additional native integration control exposed the original unresolved-request
fence blocking a verified observation on an earlier settled payment. The ORIGINAL
observation now records its original Rail before its invoice-version advance in
the same atomic transaction. The ORIGINAL mutation guard permits only that exact
observation-only advance, checked against its protected journal, current original
payment and actual Rail. It still refuses unrelated invoice-state/version and
manual-receipt changes; no bypass flag or grant was added. The changed source
cannot claim a prepared request; original undispatched cancellation and replay
then unblock review. A failed original Rail rolls back observation, pointer,
journal and invoice version together.

Fresh SAME-parent native run: original financial55, cash39 plus2 ACL controls,
and new collectibility23 PASS. Candidate reapplication and nine original function
metadata/OID/ACL/arguments are checked; unreviewed new requests, stale targets,
foreign workspace, duplicate allocation and authority drift refuse. Owned
disposable database count returned to zero and the exact owned cluster stopped.
Node syntax, scoped lint and whitespace checks pass. Prior native/SQL guard
parsing, SQL-text generation, blocked-observation, refusal-wording and
serialization-order failures are retained; the last two were test defects fixed
with exact per-case refusal expectations and whole structural DTO equality.

Separate AUTHOR-REVIEW / LOWER ASSURANCE inspected the frozen source differences,
contracts, guards and negative controls. No non-author or full-schema review is
claimed. The private native overloads retain raw compatibility facts; public
financial DTOs must explicitly project actual debt/refund/credit and must never
display raw gross remaining as current debt. No fresh rendered evidence exists.

Remaining release holds, SAME O5: canonical manual/explicit provider-target
assignment and revision; source-backed current financial context in the original
payment-review adapter; automatic original undispatched recovery; paired Owner,
Collections, Chat and cleared Portal projections/UI and final rendered/focus
proof; full native/schema/order compatibility, exact-head review/CI and ordinary
release/readback. Genuine correct-merchant TEST and ordinary Owner/client
receipt/reload/reopen/recovery plus founder acceptance remain UNVERIFIED/OPEN.
The pending detailed-publication question is unchanged. ALG01/12 have bounded
local reconciliation/exception support only; ALG02/13 maturity is unchanged.

Lesson retained in this original delivery record: use literal function replacers
when transforming SQL source; replacement-string dollar syntax can corrupt SQL
regular expressions. Compare parsed transport objects structurally, preserving
closed keys and exact values, rather than relying on JSON key order.

## October31 C188 — actual payment review context and undispatched recovery

The ORIGINAL service-only payment-obligation reader now supports an explicit
financial-version3 envelope inside its existing reference argument. Its endpoint,
arguments, owner, permissions, original actor checks and invoice lock remain;
the legacy six-field selector path remains. The closed13-field new result carries
canonical actual debt, separate refund payable, source hash and optional exact
accepted target. Draft, void, unknown, foreign or ungranted sources refuse.

The real payment-review adapter consumes that result and compares the original
invoice/customer/tenant/version/snapshot/status/currency before provider readiness.
It has no legacy gross-balance fallback and never subtracts a refund payable from
future debt. It keeps the original exact command, fingerprint, high/confirm gate,
native writer and provider adapter. This is transport/integration over the SAME
native calculation, not another financial engine or read authority.

A stale claim can now use the ORIGINAL undispatched-cancellation door. Before
closing anything, the adapter reads and validates the original actor, tenant,
operation, immutable command and prepared state; the native cancellation repeats
its locked no-dispatch fence. Ambiguous acknowledgement remains unknown under
the same identity and later readback recovers the original result. A dispatched
or uncertain provider request retains GET-only reconciliation; no automatic new
provider request, external cancellation, Work item or payment is introduced.

Native verification exposed incomplete later provider facts being accepted:
omitting a previously verified refund could otherwise restore captured principal.
The ORIGINAL observation writer now refuses missing known refund/dispute identities.
An explicit owner financial decision also requires current observation evidence
after a source change. A legitimate failed-refund reversal remains reviewable;
an omitted fact is unavailable evidence. The original receipt-failure control was
updated to use a legitimate reversal retaining the original identity, so it still
reaches the original Rail failure and proves whole-transaction rollback. The
first missing-exception failure is retained, not relabeled as a pass.

Fresh native proof: original financial55 and cash39/2 ACL run before the companion,
then companion39 (original23 plus16 financial-context controls) PASS in the SAME
owned disposable runner. The old six-field path, new closed context, current
Owner/Admin boundaries, revoked/member/foreign/void/unknown refusals, source
completeness, original metadata and replay are covered. Two actual native contexts
pass8 strict production-decoder bridge checks with only exact-file read permission;
no network/provider/identity action is allowed by that bridge. These remain
reduced-schema/synthetic identity, signing and provider inputs, not acceptance.

The original Sales provider CI configuration passes529 tests, including38
production-adapter cases with synthetic ports. The final original root runner
separately passes411 related contracts and endpoint checks. Initial root-runner
attempts found zero domain tests and are
INVALID as behavioral evidence. The temporary test-path move was undone after
locating the EXISTING domain CI job; final workflow/config/path are preserved.
The larger check also found an inherited six-action expectation after the new
seventh internal declaration. Its corrected test preserves all governance checks
and explicitly requires the new declaration to remain UNAVAILABLE with no Chat
tool. No required test or execution restriction was removed.

Catalog-only production readback found the new observation writer and actual
position absent, with zero observation columns. This corroborates the INERT source
boundary; it reads no customer/provider rows and proves no settlement or adoption.
Strict unchanged frozen/cached Deno graph and scoped lint pass. Exact source/review
receipts retain the original source, failures and final verified identities.

Functional: PARTIAL/local backend integration. Visual: no fresh rendered claim;
the old prototype and compact-shell keyboard/final-contract limits remain open.
Experiential: source-verified review/recovery, not signed-in customer operation.
Acceptance: UNVERIFIED/OPEN, with no new PR, hosted CI, main merge, versioned native
carrier, deployment or activation. Same O5 only, all twelve original outcomes and
one final integrated founder evaluation remain. ALG01/12 have bounded local
reconciliation/exception support; ALG02/13 maturity is unchanged.

Next: original manual and explicit provider-target assignment/revision; minimized
actual financial reads and paired Owner/Collections/Chat/cleared Portal UI; final
rendered/focus proof, combined schema/order/CI/release/readback, genuine correct-
merchant TEST and ordinary Owner/client receipts/reload/reopen/recovery. Preserve
every remaining original O5 financial-action requirement. The current native and
adapter checkpoint is not completion of payment processing or the Experience.

## November1 C189 — original human receipt and correction, actual financial position

INERT / LOCAL ONLY. Reuse the same original manual record/reversal command, native
approval/actor/tenant/invoice locks, immutable payment/operation rows and Rail.
The original target validator now uses the SAME current actual-position helper
as provider request eligibility. Its exact accepted signing/version/digest/date/
amount selector is retained. No new obligation, allocation ledger, provider call
or calculation engine is introduced; the existing human cash cap is preserved.

The original preview chain is composed from its real schema3 lifecycle, settings
and payment-breakdown wrappers. Review shows current debt and a separate refund
payable, without an unsupported projected-after balance. Unknown financial facts
prevent a new receipt; a genuine human-record correction remains available while
unrelated provider evidence is unresolved and does not resolve that uncertainty.
Human-recorded payments retain their provenance and do not become verified funds.

The same original executor and receipt reader now require the exact original
actor/action/source identity and actual success Rail. Missing, suppressed or
colliding receipts cannot complete/recover a successful manual act; failure
rolls back invoice version, payment and journal together. No new receipt store,
permission, retry engine or authorization path is created. All five modified
functions retain exact OID, arguments, owner, ACL, definer and runtime metadata.

Actual isolated verification:27 new native controls PASS after the original
financial55, cash39 plus2 ACL controls and collectibility/context39 in the SAME
original disposable runner. The original gross-allocation failure and original
suppressed-Rail success were genuinely reproduced before repair, with the latter
rolled back. The first Windows line-ending observation failure and second native
summary-format assertion mismatch are retained, not labeled product failures or
passes. Final amounts and original outputs were inspected; original default
runner inverse is byte-exact. Syntax, scoped lint and whitespace PASS. Owned
cluster STOPPED/DB0; no hosted customer, provider or business effect.

Synthetic example: current debt220000 minor units plus separate refund10000;
record10000 against the refunded original installment produces debt210000 and
refund10000; full human correction returns debt220000/refund10000. Later credit,
failed-refund reversal, unknown-source abstention, recovery and real two-session
no-duplicate checks retain original identities and provider receipts. These are
reduced-schema/synthetic identity/signing/provider facts, not customer acceptance.

Functional: PARTIAL/local. Visual: no new render. Experiential: source-verified
review/record/correction/recovery only. The legacy result-row projection is
explicitly NOT final actual-financial presentation and remains a paired reader/UI
release hold. Explicit provider/manual target assignment and revision, combined
full-schema carrier/order/CI/release/readback, correct-merchant TEST, ordinary
Owner/client both-surface result/reload/reopen/recovery and final founder proof
remain. No PR/hosted CI/main merge/deployment/activation or availability promotion.
Separate final review is AUTHOR-REVIEW / LOWER ASSURANCE, never non-author.

Same sole EXP04/MERIT, O5 primary only/no secondary, all12 original outcomes open.
Current ANT161 R2/North Star/Bootstrap/register/Algorithms incorporated through
original ANT51/888d2b9e. ALG01/12 have bounded source reconciliation/exception
coverage; ALG13 useful-result evaluation and ALG02 activation remain unverified
or sequenced. Named E05/E13 R2 Planning native admission/publication/history
prerequisite is acknowledged in ANT51/526d86af and9bb86c94; original stage/post/
read contracts and actual missing source-version proof were returned, without
Memory-to-Work permission inference, shared source takeover or activation.

Final staging additionally caught a trailing blank at the new SQL file EOF; it
was corrected before adoption. The original failed whitespace result is retained;
no function body, authority, algorithm or test assertion changed for that repair.
