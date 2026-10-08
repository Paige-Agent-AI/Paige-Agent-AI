# INT-311 / #1843 — manual commercial conditions

## Owner contract and routing

Owner directive, 2026-10-08: complete the incumbent Solo invoice/terms interface, then verify the commercial package and prepare isolated Stripe TEST acceptance. UI FIRST. One canonical Solo shell; platform operator is out of scope. Existing invoice editor, navigation, draft/review/save/recovery, issued immutability and payment records are preserved. This completes the expressly approved flow; it does not introduce a new editor, action or approval interaction. The owner specifically limited new prototype gating to material unapproved flows.

Grounded main: `d85d5e607ae924646bf48420b214e643c47b1dd6`. #1846 and #1848 are delivered foundations, not reopened contracts. No migration is added. Open address-lookup #1657 and docs #1825 do not overlap these product files. Startup charter, Coordinator Bootstrap, root AGENTS, Sales contracts, Flow-by-Flow, PAIGE UI Design and Impeccable were read. Existing tokens and editor geometry are the visual authority.

Sales owns invoice conditions and this interface. The exact capabilities remain `sales_invoice.draft_create`, `sales_invoice.draft_revise` and `sales_invoice.commercial_package_read`. Saving uses the incumbent authenticated `save_sales_billing_draft` writer, expected tenant/version and stable operation identity. Inspection uses the existing caller-JWT package RPC and validator. Readback, invoice operation receipts and Rail remain canonical. Draft saving is not issuance, delivery, mandate consent or payment authority. Existing constituent action approvals remain unchanged; INT-335 owns package-wide authority. No new Harness, executor, scheduler, provider door or continuation exists.

## Affected flow

Owner/admin opens an existing/new draft → selects canonical client and item/offer → records separate tax and fee treatment → chooses exact or percentage deposit using supported invoice schemas → validates and reviews → saves through the current writer → reopens persisted draft → inspects current canonical package before separately governed issuance/payment actions.

Unknown remains unknown and savable, with unresolved package facts. Affirmative treatment requires recorded source/policy. Recorded charges annotate amounts already included in existing invoice lines; they never add debt. Shared canonical validation enforces currency, bounds, duplicate line identity and combined included amounts. Changed lines cannot silently reuse unchanged recorded annotations. Invalid input is retained for correction. Frozen/unknown saves retain their original operation and input; permission loss and workspace changes retain existing fences. Issued invoices remain immutable.

New manual drafts can choose fixed USD deposit using existing schema 3: principal 350000, deposit 50000, remainder 300000. This does not create or satisfy installment obligations. The existing terms/schedule reader supplies recorded dates and amounts. The UI does not calculate a second schedule or balance.

Package inspection is read-only. It presents canonical principal, initial obligation, scheduled remainder, outstanding balance, agreement/terms versions, recorded obligations and missing/conflict explanations. Historical signed economics remain UNVERIFIED; matching mutable terms cannot clear that Agreements-owned source-evidence gap. A package read grants no authority.

The pure package projection was separated unchanged from server capability declarations so the browser can consume the same parser/read function without importing server-only machinery. Existing server import paths reexport the same function. No business formula, RPC, capability declaration or source-version semantics changed.

## Proof boundaries

Final local focused package/UI checks pass; production build and type ratchet pass (10 inherited diagnostics, zero new). Impeccable detector exits 0. The initial full Windows run reported 47 failures while the package import/test seam was being repaired. The final changed-risk focused suite passes. All 18 unrelated failing files were then rerun with two workers on both this candidate and clean exact main: both report the same 32 failures / 400 passes across the same 10 failing files. Failure names compare identically. The other initial failures were resource-sensitive timeouts that pass in the bounded recheck. Required hosted exact-head regression remains the release gate; nothing is waived.

Baseline failing file families: confirmation-gate wiring, contact-method edge, CRM schema, specialist authority/resource/dispatch fixtures, legacy contact retirement, public-form source scan, visual-critique payload cap and stream-emitter source scan. They contain Windows shell/path or existing fixture expectations; no affected product file overlaps this Sales UI diff. Evidence was compared against `d85d5e607ae924646bf48420b214e643c47b1dd6`. These are parked unrelated baseline/environment findings, not a justification to ignore hosted CI.

Automated fixtures and local rendered components are not authenticated owner acceptance. Secure synthetic QA provisioning remains #1832 / Identity-owned. INT-346 remains inactive/DRAINING; consequential Chat acceptance is not attempted. INT-335 remains Trust/C4-owned. No business/provider mutation has been used to prove deployment.

Stripe readiness refresh: zero TEST bindings, zero connected merchants and zero provider operations observed. An unresolved LIVE binding is not a TEST merchant. Existing request/reconciliation/allocation contracts are reused. Provider/setup owner must supply an authorized isolated TEST runtime, synthetic Solo owner/admin, tenant-owned connected TEST merchant and TEST connected-account webhook configuration through secure channels. Production LIVE keys and signing secrets must remain unchanged. No account creation, onboarding, payment request or transaction was performed.

## Verified release identity — 2026-10-08

- Product PR #1860: reviewed exact head `119fb767f21c513eeb4ff25a24148bfae710d730`; main squash `bc5955acd955ad23045e65515fae89497ef371e6`. Main reconciled through #1859; later #1861 was docs-only, zero overlap, independently checked. Independent NON-AUTHOR review COMPLETE / SHIP, including reconciliation recheck; PR comments `6066602203` and `6066644853`. No unresolved review thread.
- All eleven exact-head hosted checks and both Vercel statuses SUCCESS. Hosted full regression: 10156 tests / 674 files PASS; provider contract family 319 tests and invoice-delivery family 69 tests PASS. Author focused 84 / reviewer independently 101 PASS. TypeScript and affected Deno ratchets, build, Impeccable, database-contract, channel/Collections SQL and UI-evidence gates PASS. No inherited Windows failure was waived to merge.
- Production channel: Vercel `dpl_Bdyb9r7e1m4Q2NsmeHvPWYMW1Zg9` READY at exact product merge, canonical project, `paigeagent.ai` and `app.paigeagent.ai` aliases. Public static-source readback followed the bootstrap to `/assets/SoloEntry-DNjjtdo7.js`; package-inspection and deposit-basis controls are present. This proves deployed source, not authenticated interaction.
- Edge deployment run `37828150169` SUCCESS. Production `paige-ai-chat` ACTIVE v366, bundle SHA-256 `bac26b6014d6052980836bb810daa903724350e720cc7071f363cf5a027a9da3`; `sales-invoice-command` ACTIVE v48, bundle SHA-256 `5056100714f2e12dbd4e3e58cc2d663bc296ee64f07a1730ad16d0a00abad42f`. Both changed package modules exactly match merged source in both bundles. No new migration; existing `20270601000009` remains the persisted foundation.
- Strongest state: MERGED + DEPLOYED SOURCE VERIFIED. Authenticated owner/admin save/reload, real foreign-tenant UI negatives, browser zoom, historical signed economics, consequential PAIGE continuation and Stripe TEST payment remain PROOF OWED. Secure synthetic QA #1832 remains NOT READY. Isolated TEST runtime/merchant/webhook authority must be supplied by existing Identity/QA and provider/setup owners; LIVE credentials remain unchanged. No provider operation, account creation, external send or money movement occurred.
- No customer release name/version or announcement. Recovery is a reviewed bounded frontend/import forward fix or revert; immutable issued records and canonical payment history are unchanged. INT-311 / #1843 / Commercial Golden Path remain open.

## COO integration

| Connection | Classification for this slice | Owner / boundary |
|---|---|---|
| Client/offer → invoice draft conditions | PARTIAL: implemented canonical consumer; authenticated manual proof owed | Sales / Clients / Catalog |
| Agreement/terms → recorded package schedule | PARTIAL: canonical reader; historical signed economics UNVERIFIED | Sales / Agreements |
| Invoice → provider settlement → allocation/balance | UNVERIFIED for actual TEST transaction | Sales / provider setup |
| Balance → Collections and Sales metrics | Existing canonical consumers preserved; no formula change | Sales |
| Spine and constituent Trust/Rail | Existing contracts reused; no new authority | Sales / Trust/C4 |
| Harness/orchestration/events follow-through | No new job/event required by draft entry; broader execution PARTIAL | Shared owners |
| Operating Fabric commercial snapshot | Future consumer; cross-domain live composition UNVERIFIED | Operating Fabric |
| Chat/Live consequential continuation | UNAVAILABLE while INT-346 is DRAINING | Conversational Loop/security |
| Shared metric Chat/Live reach | Separate shared consumer ownership | Platform Reach |
| Delivery/retention and Agent Intelligence | Future verified-outcome consumers; no fabricated attribution | Respective domain owners |
| Memory/Knowledge | NONE for mutable money or KPI truth | Shared owners |

Marketing source → opportunity/client/offer stays upstream. Agreement/obligation → delivery commitment and verified invoice/collection → operating review stays downstream. This interface changes no cross-department authority or record ownership. External QA, signed-economics and provider prerequisites are parked, not replaced with Sales-owned systems.
