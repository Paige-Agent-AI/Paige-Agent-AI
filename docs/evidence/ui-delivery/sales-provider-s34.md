# INT-311 S3/S4 — truthful customer-payment experience

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: docs/delivery/sales-provider-s34.md maps canonical request, authority, provider, readback, allocation, recovery and consumers.
PAIGE_UI_DESIGN: PASS: routed Solo payment/drawer doctrine read before UI integration; existing Sales typography, ivory/indigo tokens, buttons and invoice workspace preserved.
MATERIAL_FLOW_CHANGE: YES: manual request caller and read-only customer payment surface invoke the canonical provider operation.
FLOW_PROTOTYPE: PASS: docs/prototypes/sales-payment-flow.html, illustrative only; owner 2026-10-05 standing S3/S4 authorization permits productive integration without another prototype gate.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: tenant owner requests an exact full/partial invoice payment, customer uses provider-hosted credential collection, both inspect truthful confirmation and balance.
VISUAL_DIRECTION: PASS: inherited direction; PAIGE Operate commercial drawer; calm financial hierarchy, violet primary act, distinct amounts, restrained depth, no new shell/navigation/brand direction.
QUALITY_BAR: Financial clarity and recovery before decoration. Invoice, requested amount, customer, provider/merchant and environment are explicit at approval. Request/accepted/unknown/settled and remaining balance must remain distinct. No card capture, credentials, raw errors or false success. Laptop/mobile controls wrap and remain reachable.
FORM_SEED: Invoice obligation -> payment request -> exact Trust review -> hosted customer action -> provider checking -> confirmed partial/full allocation or same-operation recovery. Manual/off-platform receipt remains a distinct provenance class.
COMP_STATE_PACKET: Illustrative comp documents prepare/review/action/processing/unknown/partial/zero/refused/expired/unavailable. Integrated actual-component captures supersede it for current layout; no exact owner approval claim for S3/S4.
DIFF_PACKET: Existing InvoiceLifecycleActions/InvoiceCommandReview gained canonical payment request caller and separate provider totals; existing public InvoiceDocument gained read-only hosted action; new neutral PaymentReturn never claims payment.
AUTOMATED_EVIDENCE: PASS: provider suite173 tests/10 files; PostgreSQL locks/isolation/rollback/late-exhausted readback proof; focused UI approval/missing-facts/recovery/rejected-read checks.
STATIC_EVIDENCE: PASS: TypeScript ratchet passes with baseline10/current10 after PromiseLike repair; preceding production build passed. Deno payment command/webhook/recovery checks pass.
RENDERED_EVIDENCE: PASS: internal synthetic component rendering; actual components, synthetic RPC/authority responses in local Vite fixture; desktop1366x768 and mobile390x844 scrollWidth equals viewport. Captures in sales-provider-s34-assets include payment review, unknown/exhaustion, provider-accepted, confirmed partial, and public customer controls. These exclude full production drawer geometry and authenticated provider execution.
IMPECCABLE_FINISH_REVIEW: SHIP: independent review at f2a5891b75af60ed3355b15944508c1f48847d03 resolved eight material findings in internally rendered actual components. Full production parent geometry remains UNVERIFIED.
AUTHENTICATED_RUNTIME: UNVERIFIED: no two-tenant authenticated/provider acceptance claimed.
KEYBOARD_FOCUS: UNVERIFIED: full shell matrix outstanding; visible discard, unknown-review Close and public-control focus captured; full authenticated shell keyboard matrix remains UNVERIFIED.
ZOOM_REFLOW: UNVERIFIED: full Solo shell reflow/zoom pending.
TRUTHFUL_STATE_LABELS: PASS: Request != payment; provider acceptance != settlement; redirect != allocation. Manual receipt != provider-confirmed settlement.
MUST_PRESERVE: One invoice ledger, canonical Trust/Spine/Rail, tenant merchant direct charges, no PAIGE fee, manual UI and shared capability parity, Billing separation.
UNVERIFIED: real providers, PayPal parity, production persistence/deployment, generic authenticated acceptance, full parent geometry, C4 resume integration, final exact-head review/CI. S4 remains OPEN.

BEHAVIORAL_EVIDENCE: PASS: focused actual-component tests cover exact approval, missing facts, rejected read, visible abandonment confirmation, same-operation recovery and public no-mutation controls. Provider/authenticated acceptance excluded.
REDUCED_MOTION: UNVERIFIED: full Solo shell reduced-motion rendering not exercised; existing controls and typography retained.
STATE_COVERAGE: UNVERIFIED: actual provider state transitions await sandbox merchant acceptance; internal component captures exercise prepare, approval, processing, partial confirmation, unknown recovery, retry, discard, empty and expired-link presentations.
SOLO_UI: YES: existing Sales invoice actions and public invoice controls; no new shell or navigation.
INTERNAL_BUILD_IDENTITY: sha=f2a5891b75af60ed3355b15944508c1f48847d03; deployment=local-vite-5268; environment=local; migrations=PROOF_OWED(production persistence after required CI and merge); edge=PROOF_OWED(production deployment after required CI and merge); evidence=docs/evidence/ui-delivery/sales-provider-s34-assets
RELEASE_CHANNEL: development: internal actual-component fixture and reviewed substrate; production release not claimed.
RELEASE_CLASSIFICATION: internal-only: draft governed payment substrate pending provider and authenticated acceptance.
CUSTOMER_RELEASE_IDENTITY: none: no customer release accepted at this checkpoint.
RELEASE_NOTE_REQUIRED: NO: internal draft checkpoint only; customer-visible release requires later truthful release record.
RELEASE_TRUTH_BOUNDARY: PARTIAL: implemented and reviewed internally; CI-green, merged, deployed, production persisted and authenticated acceptance not established by this packet.
RELEASE_RECOVERY: position=hold draft until required CI and provider acceptance; reference=docs/delivery/sales-provider-s34.md
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: full authenticated parent Solo shell geometry is not established by the component fixture.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: full authenticated parent Solo shell geometry is not established by the component fixture.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: full authenticated parent Solo shell geometry is not established by the component fixture.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: full authenticated parent Solo shell geometry is not established by the component fixture.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: full authenticated parent Solo shell geometry is not established by the component fixture.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: full authenticated parent Solo shell geometry is not established by the component fixture.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: full authenticated parent Solo shell geometry is not established by the component fixture.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: full authenticated parent Solo shell geometry is not established by the component fixture.
