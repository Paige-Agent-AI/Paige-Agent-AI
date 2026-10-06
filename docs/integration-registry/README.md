# Integration Capability Registry — the provider-governance & delivery-record contract

**Read this before you propose, implement, open a PR for, or change ANY provider integration** — a
third-party API, connector, OAuth scope, Marketplace service, MCP tool over a provider, or
external-execution worker. **Before merge, update the relevant entry** with the actual capability,
authority, proof, limitations, and next owner (the delivery rule, below).

Grounded 2026-09-06 against `origin/main` `c69a13362f8dd412d1f4fbcd4f82c91a033c844f`.

## What this is

The **single, machine-readable + human-readable catalogue and taxonomy** of every third-party
provider, API, connector, Marketplace service, and external-execution platform Paige may use, and how
each is **governed** — its authority lane, its Rail/Mind/Memory boundary, its M1 metering dependency,
its canonical provider receipt, and its honest delivery status.

The authoritative machine-readable form is **`integration-capability-registry.json`** (this
directory). This README is its human-readable companion. **The JSON is the source of truth for full
per-provider detail;** CI (`lint:integration-registry`) validates the JSON only — the summary table
below is a hand-maintained companion that must be updated alongside the JSON (§BRAIN.3).

**This is a product-governance and delivery record — NOT a provider-integration build.** It does not
install providers, request credentials, call external APIs, create OAuth clients, or ship provider
functionality. It records what the platform has decided about each provider and what is true today.

## The cardinal rule

> **Listing a provider here NEVER means it is connected, available, or autonomous.** A registry entry
> is a governance declaration, not a live capability. Connection is a per-tenant authorization fact;
> availability is a `getTierFeatureSet()`/RLS fact; autonomy is a `resolve_tool_autonomy()`/Trust
> Compass fact. This document decides none of them (rules R1, R6, R8).

## What this is NOT — and the names it must not be confused with (§18)

- **Not a fork of existing docs.** It is the *provider-axis unifying index*. Each entry cites its
  grounding source. It cites — never restates:
  - `docs/brain/config-registry.md` — the env-var-NAMES/IDs **wiring** inventory (this doc is the
    capability/authority/governance axis on top).
  - `docs/product/provider-result-contract.md` — the **runtime per-tenant connection-state** seam a
    provider workstream publishes into Systems Check (its eight-word vocabulary — `NOT CONNECTED /
    PENDING PROVIDER / LIVE / PROOF OWED / NEEDS ATTENTION / PAUSED / UNAVAILABLE` + the `suspended`
    hole — is a **different** vocabulary from this registry's six delivery states, and the two are
    deliberately kept apart).
  - `docs/binding-ledger/surface-binding-ledger.json` — how each **surface** binds to Paige (this doc
    is the **provider** axis).
  - `docs/architecture/MARKETPLACE-DATA-MODEL.md` — the `marketplace_items` (global metadata) /
    `marketplace_installs` (only per-tenant state) data model rule R4 rests on.
  - `outputs/paige-at-cowork/09-paige-capability-system.md` — the owner-locked capability matrix by
    capability **area** (this doc is the same governance by **provider**).
- **Not the Spine "capability registry."** `supabase/functions/_shared/paige-spine/registry.ts` is a
  runtime object (Spine domain declarations). Unrelated.
- **Not the code-level "Integration Registry, slice 1."** Migration `20261005000000` is the
  provider-scoped `tenant_mcp_connections` table (n8n + Zapier) holding **per-tenant connection
  state**. That is runtime state; this doc is the governance record above it.
- **Not authorization, and not a design record.** An entry is an observation about the contract, never
  permission to build, and holds zero opinion about how any surface looks (§00).

### Self-Knowledge & Migration Advisor consumer boundary

The owner-approved advisor consumes this provider-axis registry together with live, server-resolved
tenant provider/connection results; it does not duplicate or mutate this catalogue. A comparison-only
external product does not become a registry entry merely because Paige researches it. A listed or
globally delivered provider is never inferred to be installed, tenant-connected, eligible,
authorized, proven, or released.

Migration advice preserves, as separate cited fields, provider delivery status, per-tenant connection
state, tier eligibility, authority lane, provider/model route, budget/cost evidence, limitations,
proof, source revision/freshness, and release identity. External comparison claims require a source
URL, publisher, checked-as-of date, applicable plan/edition/region, and re-verification boundary; they
cannot override verified Paige or tenant truth. This architecture decision changes no provider entry
or state in `integration-capability-registry.json`.

## The six delivery states (the task-mandated vocabulary)

| State | Meaning |
|---|---|
| `LIVE` | delivered and proven usable for its declared authority lane — the integration's DELIVERY state, never a claim any tenant connected it or that Paige may act autonomously |
| `PARTIAL` | some of it is real; the exact remaining gap is named |
| `PROPOSED` | an approved/drafted DIRECTION exists; nothing is built |
| `UNAVAILABLE` | the contract/substrate does not exist, or the provider is not wired at all |
| `DEFERRED` | deliberately sequenced for a later slice |
| `PROOF_OWED` | implemented and reachable in code, but authenticated end-to-end runtime proof (§32.c) is absent — never report as LIVE |

## The five authority lanes (§16 / §67, shared with the binding ledger)

`read` · `draft` · `auto` · `confirm` · `prohibited`. An entry declares the highest lane it currently
supports. **Role/authority is separate from tier** (R6): tier eligibility says who an integration is
*for*; the authority lane + `resolve_tool_autonomy` + RLS say who may *act*. **Admin is a role, never
a URL and never a tier** (§53/§65).

## Tier eligibility (Platform · Solo · future Agency · future Enterprise)

A **governance declaration** of who each integration is for. Actual runtime availability is enforced
by `src/lib/tier/tierFeatures.ts` (§60) and RLS — never by this document (§65, the name is not the
authority). `solo` covers Standalone Solo and Sub-account (same base feature set, §60). Distribution
follows tier-matrix §61 default unless an owner exception is recorded. Values: `eligible` /
`ineligible` / `resell` / `deferred` / `na`.

## The taxonomy (stable — extended only by owner ruling)

1. **Productivity / documents** — Google Workspace, Microsoft 365, doc tools. (Native Paige artifacts
   are NOT here — R5.)
2. **Finance / accounting / payments** — Stripe, QuickBooks, Plaid, and opt-in finance-vertical
   providers (§2/§194, §38 bind).
3. **CRM / calendar / communications** — external CRM, calendar, telephony, email, messaging.
4. **Marketing / ads / social / public presence / analytics** — ad platforms, social publishing,
   analytics/observability.
5. **Files / contracts / Vault** — e-signature, contracts, file intake, Vault OCR/DLP seam.
6. **Marketplace / MCP / automation specialists** — the Platform Marketplace, the MCP door, n8n,
   Zapier, browser/sandbox execution, sub-agent specialists.

## The nine governing rules (full text in the JSON `rules`)

- **R1** Listed ≠ connected/available/autonomous.
- **R2** Honest status only — design/prototype never exceeds `PROPOSED`; code without runtime proof is
  `PROOF_OWED`, never `LIVE`.
- **R3** No secrets — names, IDs, scopes, behaviour only.
- **R4** Platform Marketplace entries are **global capability metadata only** — never tenant
  credentials, usage, private client material, purchases, or billing (`marketplace_installs`, the only
  per-tenant state, is out of scope).
- **R5** Private Paige artifacts require no external provider; **native** Google Workspace / Microsoft
  365 creation requires **that tenant's** explicit connected-provider authorization.
- **R6** Role/authority is separate from tier; Admin is a role, never a URL or tier.
- **R7** Workers (n8n / Zapier / MCP / provider APIs / browser) run **under** Paige's authority, never
  a bypass (door-blindness).
- **R8** Every consequential external effect owes a canonical provider receipt, a Rail outcome, and a
  declared cost-track dependency. For any effect that moves **real money** (purchase, payment, ad spend,
  bookkeeping effect, financial obligation, or other real external spend) the dependency is **M1
  real-money spend control** (§10) — **never** satisfied by internal LLM-token metering (owner ruling
  2026-09-06).
- **R9** §2 finance is never a platform default; credit is monitoring-only, never repair (§194).
- **R10** Provider API fees are recorded **separately** from customer money movement
  (`expense_and_operations`). Paige is never merchant of record and never silently charges a tenant's
  provider account (§38). The expense layer makes operating **cost + ownership** visible; M1 real-money
  spend control governs external spend **authority + caps**. Never invent a price, assume a free plan,
  or turn an unknown commercial term into a number — record the official source URL + a checked-as-of
  date; custom/enterprise is recorded honestly (§13).

## The delivery rule (MANDATORY — §0 / §66 / §BRAIN.3)

> **Before** proposing, implementing, opening a PR for, or changing any provider integration, the
> agent **reads the relevant registry entry** (or records that none exists yet). **Before merge**, the
> same PR **creates or updates that entry** — actual capability, authority lane, proof (or
> `PROOF_OWED`), limitations, next owner — **in the same commit**. Shipping the integration change
> without the registry update is §13/§66 drift.

Enforced by: this README + the JSON, `docs/brain/README.md` (index + read-first table),
`docs/PAIGE-MASTER-PROJECT-REFERENCE.md` §3/§4, `.claude/skills/second-brain/SKILL.md` (read table),
and the structural guard `scripts/ci/integration-registry-lint.mjs`
(`npm run lint:integration-registry`).

## API Expense & Operations Layer (v1.1) — cost, ownership, and the "M1" disambiguation

Every provider (and every Public Presence roadmap item) carries an `expense_and_operations` block
making **operating cost + ownership** visible, separate from customer money movement (R10/§38). The
human-readable, 4-section derived view is **[`expense-and-operations-report.md`](./expense-and-operations-report.md)**:
(1) current platform operating dependencies · (2) tenant-authorized integrations · (3) future
Agency/Enterprise capabilities · (4) the Public Presence roadmap (approved order). The JSON is the
source of truth; the report is a hand-maintained companion (§BRAIN.3).

**The "M1" disambiguation (owner ruling 2026-09-06) — `cost_tracks` in the JSON.** "M1" unqualified is
prohibited. Two distinct tracks:

- **Internal LLM-cost metering** — operating-cost *visibility* for model/token usage
  (`paige_llm_trace → platform_metered_events`, §8.4). Not authority to spend money.
- **M1 real-money spend control** — the external-provider spend backbone (currency-aware caps, atomic
  reserve/adjust/release, provider-confirmed actuals, reconciliation, receipts, Rail; §10). **Required**
  for any provider that can create purchases, payments, ad spend, bookkeeping effects, financial
  obligations, or other real external spend — **never** satisfied by LLM-token metering.

Each entry declares `money_movement.m1_dependency_track`; the guard **fails CI** if a provider whose
`can_move_real_money=true` uses anything but `m1_real_money_spend_control`. The 8 real-money-spend
providers today: **Stripe, QuickBooks, Twilio, Meta (ads), DocuSign, Platform Marketplace (paid
install), n8n, Zapier** (plus roadmap ad/subscription paths). **Honesty stance:** this planning slice
did not verify live vendor prices — every `pricing_checked_as_of` is null with the official source URL
recorded for a human/next-owner to verify; no price is invented, no free plan assumed, custom/
enterprise recorded honestly (§13).

## The structural guard (CI-safe, concise — clones `lint:binding-ledger`)

`scripts/ci/integration-registry-lint.mjs` fails CI when the JSON is structurally incomplete or
dishonest: a missing top-level section (incl. `cost_tracks`, `expense_and_operations_schema`,
`public_presence_roadmap`); a provider missing a required field or its `expense_and_operations` block;
an unknown status / authority lane / taxonomy id / tier value / cost-responsibility / pricing-model /
cost-driver / M1-track; a duplicate id; a `LIVE` entry without a real canonical provider receipt; a
`marketplace_metadata_only` entry that carries per-tenant credential/usage/purchase/billing data (R4);
a taxonomy group with no catalogued provider; a **real-money-moving provider whose M1 track is not
`m1_real_money_spend_control`** (owner ruling); an **unqualified "M1"** in a base `m1_dependency`; a
**date-stamped price with no official source**; a malformed `public_presence_roadmap` item; a
**runtime-claiming provider (LIVE/PARTIAL/PROOF_OWED) missing `code_anchors`** or an **unbuilt provider
(UNAVAILABLE/DEFERRED/PROPOSED) that declares them**; or a **cited `code_anchors` path that does not exist
on disk** (the dead-anchor resolve `findDeadCodeAnchors`, run in `main`, mirrors binding-ledger's own
anchor check — §18). Each anchor's `role` is a **controlled, lint-enforced vocabulary** — `provider_adapter` ·
`callback_readback` · `fail_closed_containment` · `proven_runtime` (the last reserved for genuine §32.c
runtime proof; none today) — so a code anchor proves only that a code PATH EXISTS, never that the provider
works or is LIVE. It is regex/JSON-only and dependency-free, with a `--self-test` (42 mutations + a
dead-anchor resolver + glob-matcher proof). It is a **tripwire** for the
honesty invariants, not a semantic parser — whether a lane mapping or a cost figure is materially
correct stays a human §5/§39 responsibility.

## Honest platform position (grounding SHA)

- **No provider is autonomous, and few are `LIVE`.** The two `LIVE` entries are the **Platform
  Marketplace** surface (install mechanics shipped) and the **inbound MCP door** (the governed decision
  is live — and it *refuses* every mutation). LIVE there is a delivery fact, not a Paige-autonomy fact.
- The communications/scheduling/social/automation providers (Twilio, Google Calendar, Resend, Meta,
  n8n, Zapier) are `PARTIAL` with named gaps; accounting/e-sign (QuickBooks, DocuSign) are
  `PROOF_OWED`; Microsoft 365 is `DEFERRED`; HubSpot / Vapi are `UNAVAILABLE`; Browserbase is `PROPOSED` (owner-ruled 2026-09-07 as the replaceable bootstrap browser-worker runtime for the Paige-owned Secure Browser, behind a provider-neutral internal contract — desk review 2026-09-07 = **CONDITIONAL GO** with seven owner-side vendor gates before credentialed wiring; `BROWSERBASE_API_KEY` present as an Edge secret = infra readiness only, not wired, not live); the Vault
  OCR/DLP seam is `PROPOSED`.
- **Coverage is honest, not complete.** The catalogued providers span all six taxonomy groups and all
  six status words. Every other WIRED provider (per master §4) is named in
  `uncatalogued_wired_providers` so nothing is hidden; the delivery rule requires the next PR touching
  one to promote it to a full entry. Pure delivery infrastructure (Supabase, Vercel, the LLM router,
  Voyage, GitHub) is listed in `excluded_delivery_infrastructure` and governed by `config-registry.md`,
  not here (§18).

## Grounding note — "Marketplace Brain decision" (§13 honesty)

The task brief named a *"Marketplace Brain decision"* as a grounding input. A repo-wide search finds
**no artifact recorded under that phrase**. The registry's Marketplace rule (R4) is instead grounded
in `docs/architecture/MARKETPLACE-DATA-MODEL.md` (the metadata-only data model) and the master-ref
Marketplace facts. If a "Marketplace Brain" ruling exists by another name, it should be linked here in
the next update — recorded as unresolved rather than invented (§BRAIN.2).

## How to keep it true (§BRAIN.3 / §66)

Any PR that adds, changes, or removes a provider integration — or changes a provider's
scope/authority/receipt/Rail-Mind-Memory posture, or lands an owner ruling about one — **updates the
relevant `integration-capability-registry.json` entry in the same commit**, updates this README's
summary table, and re-runs `npm run lint:integration-registry`. Record the honest state — never imply a
provider is connected/available/autonomous because it is listed (R1). A runtime-claiming entry
(LIVE/PARTIAL/PROOF_OWED) MUST carry `code_anchors` citing the real adapter/entry-point code that backs
it; a rename, move, or deletion of that code updates the anchors in the **same** commit, or the
dead-anchor resolve fails CI (an entry may not claim a built runtime while pointing at code that no
longer exists).

## Per-provider summary (the JSON is the source of truth)

| Provider | Group | Status | Highest lane | Gap / next slice |
|---|---|---|---|---|
| Google Workspace | productivity/documents | `PARTIAL` | confirm | native Drive doc create needs per-tenant OAuth + receipt/Rail proof |
| Google Search Console | marketing/public presence | `UNAVAILABLE` | prohibited | platform OAuth + tenant verified-site source and authenticated read proof required |
| Google Business Profile | marketing/public presence | `UNAVAILABLE` | prohibited | Google project approval + tenant consent/location selection + receipts/readback required |
| Microsoft 365 / Outlook | productivity/documents | `DEFERRED` | prohibited | not wired; sequenced after Google parity |
| Stripe | finance/accounting/payments | `PARTIAL` | confirm | shared Sales direct-charge request/readback/allocation implemented; authenticated provider/production acceptance and PayPal parity owed; Billing separate |
| QuickBooks | finance/accounting/payments | `PROOF_OWED` | confirm | catalogue real capability; governed read proof |
| Plaid | finance/accounting/payments | `PARTIAL` | read | Funding & Coaching Tools package + per-tenant Financial connection; safe-read boundary (§2/§194) |
| SmartCredit | finance/accounting/payments | `PROOF_OWED` | read | Funding & Coaching Tools package-gated; dormant (0 producers); entitlement+connection fail-closed gate OWED (§2/§194) |
| Nav.com (business credit) | finance/accounting/payments | `PROOF_OWED` | read | Funding & Coaching Tools package-gated; live producer (BusinessCreditAdmin) makes the OWED entitlement+connection gate load-bearing (§2/§194) |
| Business verification (multi-source) | finance/accounting/payments | `PARTIAL` | read | Funding & Coaching Tools package-gated; OpenCorporates/SEC direct + SoS via Firecrawl real; D&B/LexisNexis/TU/Array are inert stubs; package-entitlement gate OWED (§2/§194) |
| Twilio | CRM/calendar/communications | `PARTIAL` | confirm | per-tenant A2P go-live; vanity/premium number search |
| Google Calendar | CRM/calendar/communications | `PARTIAL` | confirm | FU-3 Rail contract; attribution truthfulness (#786) |
| Resend | CRM/calendar/communications | `PARTIAL` | confirm | per-tenant sending identity; send receipt on Rail |
| HubSpot | CRM/calendar/communications | `UNAVAILABLE` | prohibited | not wired; native CRM is default |
| ElevenLabs (optional Paige voice I/O) | CRM/calendar/communications | `PROOF_OWED` | read | transport disabled; owner-only metadata inspection in development cannot substitute for account scopes, voice, retention, quota, concurrency and cost proof |
| Vapi (voice AI telephony) | CRM/calendar/communications | `UNAVAILABLE` | prohibited | not wired; provider-hosted agents cannot own Paige reasoning or actions |
| Meta (FB + IG) | marketing/ads/social/analytics | `PARTIAL` | draft | declared handles only; tenant-safe schema is deployed, but provider selection/OAuth/test-account authority and all runtime connection/publish proof remain owed |
| PostHog | marketing/ads/social/analytics | `PARTIAL` | read | operator-scoped analytics only |
| DocuSign | files/contracts/Vault | `PROOF_OWED` | confirm | Sales R2 rendered-prototype approval; governed send |
| Vault OCR/DLP seam | files/contracts/Vault | `PROPOSED` | prohibited | Phase 7 inspected-fact promotion |
| Platform Marketplace | marketplace/MCP/automation | `LIVE` | confirm | bind safe install-state to Paige (metadata only — R4) |
| Paige MCP door | marketplace/MCP/automation | `LIVE` | read | #47 approval channel; 13 unscoped reads (#46) |
| n8n | marketplace/MCP/automation | `PARTIAL` | confirm | decideGovernedExecution wiring; first Rail row |
| Zapier (MCP) | marketplace/MCP/automation | `PARTIAL` | confirm | unify risk gate across regimes |
| Custom remote MCP | marketplace/MCP/automation | `PARTIAL` | confirm | encrypted headers and shared form shipped; authenticated proof owed. Incoming-contact binding/drawer merged in #1595; owner/sender proof remains owed. Candidate OAuth correction selects challenge scopes, then resource scopes, otherwise omits scope; never the authorization-server-wide catalogue. Provider acceptance and governed outbound execution remain unproven. See `../evidence/ui-delivery/mcp-oauth-resource-scopes.md` and `../delivery/mcp-contact-binding.md`. |
| Browserbase | marketplace/MCP/automation | `PROPOSED` | prohibited | Secure Browser bootstrap browser-**worker** runtime (replaceable, behind a provider-neutral internal contract); review 2026-09-07 = **CONDITIONAL GO**, 7 vendor gates before wiring |
| Paige browser + Firecrawl | marketplace/MCP/automation | `PARTIAL` | draft | G5/read-only egress deployed in #1042; DNS-rebinding + SSRF reconciliation and §32.c authenticated drive remain |
