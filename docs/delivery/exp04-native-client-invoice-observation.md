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
