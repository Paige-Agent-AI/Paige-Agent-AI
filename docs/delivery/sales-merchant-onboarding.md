# INT-311 — canonical Solo merchant entry

SHELL: SOLO
FLOW-BY-FLOW: APPLIED
IMPECCABLE: APPLIED

## Scope and pre-edit grounding

Base main: `6b6bef5091507e5b7946984506e75cfb3ebd5401`. #1799 docs-only closeout merged at that SHA from `8f10ff85da89801bbbdba3fa4fd298965f05a546`; independent review SHIP and required checks green. Ready transition was denied by GitHub app permissions; normal authorized merge succeeded. No product change in #1799.

Merchant setup is a human owner/admin Settings action, consumed later by existing Sales payment capabilities. Canonical source: `tenant_stripe_accounts`; provider backend: existing `tenant-stripe-connect`; authority: existing actor/service guards and active workspace; evidence: existing Rail contract; persistence: same merchant row with immutable onboarding reservation and one dispatch claim. No new approval/channel/ledger/scheduler/CRM/provider gateway. No charge, application fee, destination charge, platform billing change or model card data.

The new entry reuses Solo Settings Integrations. `status` reads scoped stored facts only; `refresh_status` asks Stripe for fresh facts or GET-reconciles an uncertain reservation; explicit `start_onboarding` creates at most one claimed account and returns a provider-hosted link. Wrong workspace/environment/version/role refuses. Provider return does not prove readiness. Readback success plus Rail persists atomically; failed receipt rolls it back. Runtime provider secrets and private requirements never enter the browser projection.

Migration version `20270600000000` was selected above main `20270599000000` and open PR #1801 `20270599000001`, subject to fresh collision check at push. It extends existing merchant binding, no financial history backfill or balance mutation.

## Required capability-routing answers

1. User job: connect business-owned merchant account, inspect TEST/LIVE and current payment readiness, recover incomplete/unknown setup.
2. Portfolio: Sales/Payments consumes merchant identity; Settings Integrations owns this human entry; platform Billing remains distinct.
3. Domain owner: existing tenant merchant binding. Customer identity still Clients; receivable still invoice; payments still canonical invoice payments.
4. Spine: existing governed payment capability later consumes this binding. New merchant-onboarding agent capability is N/A; no listed tool is invented.
5. Trust: owner/admin setup path only; setup grants no authority to publish/send/request/charge an invoice. Package-wide approval remains INT-335.
6. Rail: existing merchant binding/readback receipts, same transaction; no premature “sent” receipt for a reservation that has not dispatched.
7. Durable work/schedule: N/A for this bounded manual setup. Pending identity lives in existing binding, not a new workflow/continuation system.
8. Provider registry: Stripe remains PARTIAL; per-tenant test/live binding, no fallback to a platform or dogfood merchant. PayPal remains readback-only.
9. Safe read/model: closed UI projection. No merchant secret, private requirements, raw error body or PAN/CVV. No Chat routing edit.
10. Completion boundary: implementation/review/CI/deployment can be proven separately; controlled TEST merchant onboarding and real settlement/allocation remain required authenticated proof.

## Current remaining Sales program

- S2: canonical package reader and Chat binding shipped; exact commercial assembly, missing-fact dialogue and authenticated two-tenant composition still open. Use shared C4; no Sales continuation. Individual exact approvals remain until INT-335 resolves shared composition.
- Stripe: existing direct-charge request/reconciliation/allocation substrate shipped; production read-only count on 2026-10-06: zero merchant bindings, zero provider operations. No test payment. This slice creates the safe owner entry, not acceptance.
- PayPal: #1793 readback only. Seller authorization, hosted execution, signed events, settlement/allocation and sandbox acceptance still owed. No second PayPal ledger.
- Recurring: terms/schedules remain commercial schedules, not active mandates. Finite installment progression and open-ended subscription must remain distinct; consent and canonical durable scheduling required before unattended collection.
- Collections: canonical balances include provider allocations (#1792); governed follow-up/outcome/shared C4 WAIT_WORK composition still owed. Shared Communications owns sending; no Sales sender or scheduler.
- Modality/Fabric: UI/Chat/Voice/Automation must consume the same capability state; no separate balances, context fabric or authority.

## Checks and reproducibility

- UI: `node node_modules/vitest/vitest.mjs run src/solo/data/useStripeMerchant.test.tsx src/solo/settings-integrations-stripe.test.tsx src/solo/settings-integrations.test.tsx` — 77 PASS.
- Payment contracts: `node node_modules/vitest/vitest.mjs run --config supabase/functions/_shared/sales-payments/vitest.config.ts`.
- Real PostgreSQL: `node scripts/sql/sales-merchant-onboarding-proof.mjs` — disposable own local cluster with real actor/service/Rail guards and concurrent reservations; never production credentials.
- Geometry/interaction: Vite config `scripts/live-drive/harness/integrations-mount/vite.config.ts`, then `node scripts/live-drive/sales-merchant-drive.mjs` — 29 cases, actual components with synthetic transport. Committed artifacts under `docs/evidence/ui-delivery/sales-merchant-onboarding/`.
- TypeScript ratchet and production build PASS; migration/definer lints PASS. CI/final exact-head review and production identities recorded after candidate delivery.

UI evidence: [merchant onboarding](../evidence/ui-delivery/sales-merchant-onboarding.md). Independent review findings and their repairs are recorded there. No customer release version; internal partial foundation only.

## External setup

One controlled Stripe TEST merchant is needed through this canonical owner UI after deployment. Keys stay in approved provider/secret configuration; never Chat, GitHub, screenshots or fixtures. Current key environment is displayed honestly; LIVE must not be used for TEST acceptance. If secure TEST provider configuration is unavailable, provider acceptance remains PROOF OWED and the lane continues other unblocked domain work.

PayPal sandbox seller/partner access may require owner action later; credentials are not requested in Chat. No additional tenant merchant accounts are needed merely to prove isolation; use generic second-tenant auth/DB negatives.
