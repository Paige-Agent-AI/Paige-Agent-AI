# API Expense & Operations Report — the operating-cost & ownership view

**Derived from `integration-capability-registry.json` (`expense_and_operations` blocks). The JSON is the
source of truth; this report is a hand-maintained companion and must be updated with it (§BRAIN.3).**
Grounded 2026-09-06 against `origin/main`.

**Live voice continuation, 2026-09-08:** owner authorizes use of the existing provider entitlement,
not purchase/upgrade, new payment method or legal acceptance. Read-only account metadata inspection
is in development in existing Voice Profile administration; it makes no billable speech request and
sets no price, quota, retention or transport flag. Actual account/scopes/voice/retention and bounded
session cost/concurrency proof remain required; provider-backed live audio stays unavailable.

## What this is (and is NOT)

This is the operating-cost + ownership view of the Integration Capability Registry — who bears each
provider's cost, how it is priced, and how its spend is governed. It is a **planning/governance
record**, not a billing system and not a live price database.

- **No secrets.** Names, IDs, scopes, ownership and behaviour only — never a credential, token, or raw
  payload (R3).
- **No invented prices (§13/R10).** Prices/quotas/terms are mutable. Each entry records the **official
  source URL** and a **checked-as-of date**. `checked-as-of` is **null across the board** here because
  this planning slice did **not** verify live vendor prices — a human/next-owner sets the date when
  they verify at the source. Custom/enterprise pricing is recorded as `enterprise_contract`/`unknown`
  with **no fabricated figure**; a free public tool is recorded as `free_quota` only where it is a
  documented no-fee tool, still flagged unverified.
- **Provider API fees are separate from customer money movement (R10/§38).** Paige Agent AI is never
  merchant of record and never silently charges a tenant's provider account. This layer makes operating
  **cost + ownership** visible; **M1 real-money spend control** governs external spend **authority + caps**.

## The two cost tracks (the "M1" disambiguation — owner ruling 2026-09-06)

"M1" unqualified is prohibited. Every provider names which track it depends on:

- **Internal LLM-cost metering** — operating-cost *visibility* for model/token usage
  (`paige_llm_trace → platform_metered_events`, autonomy-architecture §8.4). NOT authority to spend
  external money.
- **M1 real-money spend control** — the backbone for **external provider spend**: currency-aware caps,
  atomic reserve/adjust/release, provider-confirmed actuals, reconciliation, complete receipts, Rail
  evidence (RE-2 M1-a/M1-b, §10). **Required** for any provider that can create purchases, payments, ad
  spend, bookkeeping effects, financial obligations, or other real external spend — and **never**
  satisfied by LLM-token metering.

The **8 real-money-spend providers** (their `money_movement.m1_dependency_track =
m1_real_money_spend_control`, CI-enforced): **Stripe, QuickBooks, Twilio, Meta (ad spend), DocuSign,
Platform Marketplace (paid install), n8n, Zapier** — plus, on the roadmap, **Yelp Ads, LinkedIn Ads,
Facebook/Meta ads, and the directory-network subscription**.

---

## 1. Current platform operating dependencies

Services the platform itself pays for and relies on today (`cost_responsibility = platform_paid`, or
`shared`). Credentials/secrets live in `config-registry.md` (names only) — never here.

| Provider | What it does | Pricing model | Cost driver | Real-money track? | Status | Official source (checked-as-of) |
|---|---|---|---|---|---|---|
| **Twilio** | Telephony/SMS/A2P (platform holds master acct + subaccounts) | metered_usage | messages · minutes · numbers | **Yes** (M1 real-money; volume via M1-b) | PARTIAL | twilio.com/pricing (unverified) |
| **Resend** | Platform/tenant email delivery | metered_usage | messages | No (operating cost; M1-b volume caps) | PARTIAL | resend.com/pricing (unverified) |
| **PostHog** | Operator product analytics | free_quota | events · storage | No | PARTIAL | posthog.com/pricing (unverified) |
| **Platform Marketplace** | Capability Store (paid installs on a Paige-held rail) | per_action | transactions | **Yes** (M1 real-money; §38-clean own rail) | LIVE | stripe.com/pricing (unverified) |
| **Paige MCP door** | Governed inbound MCP chokepoint (platform compute) | free_quota (internal) | api_calls | No | LIVE | internal — no vendor |
| **Paige browser + Firecrawl** | Bounded web research (Fly service + crawl) | metered_usage | api_calls · minutes | No (operating cost; LLM synthesis on the LLM track) | PARTIAL | firecrawl.dev/pricing (unverified) |
| **Stripe** | Paige's own revenue rails (subs, Marketplace, metered) | per_action | transactions | **Yes** (M1 real-money) | PARTIAL | stripe.com/pricing (unverified) |

**Also platform-paid delivery infrastructure** (governed by `config-registry.md`, out of the
capability registry per §18): **Supabase · Vercel · the LLM router (Anthropic/OpenAI/Gemini/Groq/
Featherless/Replicate/Ideogram/Meshy) · Voyage · GitHub.** The LLM router's model spend is the
**internal LLM-cost metering** track — operating-cost visibility, never a real-money spend act.

> Honest note: Twilio is **platform_paid today**; the intended model is L3 metered **pass-through** to
> the tenant (money-spine), not yet billed. Recorded as `platform_paid` with the pass-through intent in
> its entry.

---

## 2. Tenant-authorized integrations

Tools a **Solo business connects for its own work**, billed to the **tenant's own account**
(`cost_responsibility = tenant_direct`; Plaid is `undecided`, opt-in finance lane). Paige never
becomes merchant of record for these (§38).

| Provider | What it does | Pricing model | Cost driver | Real-money track? | Status | Official source (checked-as-of) |
|---|---|---|---|---|---|---|
| **Google Workspace** (Drive/Docs) | Read context + create native docs in the tenant's Drive | free_quota | api_calls · storage | No | PARTIAL | developers.google.com/drive…/limits (unverified) |
| **Google Calendar** | Availability + booking on the tenant's calendar | free_quota | api_calls | No | PARTIAL | developers.google.com/calendar…/quota (unverified) |
| **QuickBooks** | Accounting/bookkeeping | fixed_subscription | api_calls · transactions | **Yes** (M1 real-money — obligations) | PROOF_OWED | quickbooks.intuit.com/pricing (unverified) |
| **DocuSign** | E-signature / contracts | per_seat | documents · seats | **Yes** (M1 real-money — obligations + envelope fee) | PROOF_OWED | docusign.com/pricing (unverified) |
| **Meta** (FB + IG) | Social presence + ads | per_action | ad_spend · api_calls | **Yes** (M1 real-money for ad spend) | PARTIAL | developers.facebook.com…/rate-limiting (unverified) |
| **n8n** | Automation worker (tenant's own instance) | fixed_subscription | api_calls · transactions | **Yes** (M1 real-money — can trigger downstream spend) | PARTIAL | n8n.io/pricing (unverified) |
| **Zapier** | Automation worker (9,000+ apps) | fixed_subscription | transactions · api_calls | **Yes** (M1 real-money — can trigger downstream spend) | PARTIAL | zapier.com/pricing (unverified) |
| **Plaid** | Banking-data context (opt-in, §2/§194) | metered_usage | api_calls · transactions | No (read-only; **Transfer product out of scope**) | PARTIAL | plaid.com/pricing (unverified) |
| **HubSpot** | External CRM (not wired) | unknown | api_calls · seats | No | UNAVAILABLE | hubspot.com/pricing (unverified) |

---

## 3. Future Agency / Enterprise capabilities

**Clearly future — not available today.** The Agency and Enterprise tiers are not live (only Platform
and Solo/Sub-account are). Per tier-matrix §61, most providers show `agency_future = resell` (an agency
**resells** the capability to its sub-accounts via the Marketplace rather than operator-using it) and
`enterprise_future = eligible` (hybrid Solo∪Agency). Tier eligibility is a **governance declaration** of
who a provider is *for* — actual availability is enforced by `getTierFeatureSet()`/RLS, never by this
report (§60/§65).

- **Agency (future):** resells the tenant-authorized integrations above to sub-accounts; no
  agency-operator-only provider exists today.
- **Enterprise (future):** hybrid — the Solo set plus agency resell; per-tenant negotiated terms would
  be `enterprise_contract` pricing, recorded honestly with no fabricated figure when it exists.
- **Deferred / proposed providers (future, not built):** **Microsoft 365** (DEFERRED — after Google
  parity), **Browserbase** (UNAVAILABLE — sandbox substrate first), **Business Vault OCR/DLP**
  (PROPOSED — Phase 7), **Vapi** (UNAVAILABLE — Twilio + ElevenLabs cover voice today).

No Agency/Enterprise provider capability is presented as available. When those tiers open, each
provider's `tier_eligibility` + `expense_and_operations` is revisited in the same PR (delivery rule).

---

## 4. Public Presence roadmap (approved order)

The approved-order plan for public-presence providers. **All are PROPOSED — an approved direction, not
available capability (R1) — except item 6 (Facebook/Meta), which is the Public Presence lens of the
already-catalogued `meta` provider and carries its `PARTIAL` status (declared handles captured; per-tenant
publishing/ads still owed).** Most webmaster/business tools are documented no-fee within quota but require
app approval / partner access; the advertising paths (Yelp Ads, Meta/Facebook ads, LinkedIn ads, directory
subscriptions) carry **real ad/subscription spend → M1 real-money spend control**. This is the home the
Public Presence slice's owed entry points to; authoring each as a full catalogued provider entry is a
tracked follow-up.

| # | Provider | API/product | Cost responsibility | Pricing model | Real-money track? | Status |
|---|---|---|---|---|---|---|
| 1 | **Google Search Console** | Search Console API | tenant_direct | free_quota | No | PROPOSED |
| 2 | **Google Business Profile** | Business Profile APIs | tenant_direct | free_quota (API access approval) | No | PROPOSED |
| 3 | **Bing Webmaster Tools** | Bing Webmaster API | tenant_direct | free_quota | No | PROPOSED |
| 4 | **Apple Business Connect** | Business Connect | tenant_direct | free_quota (programmatic access limited) | No | PROPOSED |
| 5 | **Yelp** | Fusion API + Yelp Ads | tenant_direct | metered_usage + ad spend | **Yes** (Yelp Ads → M1 real-money) | PROPOSED |
| 6 | **Facebook (Meta)** | Page + Marketing API | tenant_direct | per_action | **Yes** (ad spend → M1 real-money) | PARTIAL (see `meta`) |
| 7 | **LinkedIn** | Marketing / Pages API | tenant_direct | per_action (partner-access-gated) | **Yes** (LinkedIn Ads → M1 real-money) | PROPOSED |
| 8 | **Directory network** | Aggregator (not selected) | undecided | per_location | **Yes** (per-location subscription → M1 real-money) | PROPOSED |

Official sources + full per-item detail (access prerequisites, quotas, receipts, pause/revoke) are in
the JSON `public_presence_roadmap`.

---

## Operator generated-audio cache disposition

The existing ElevenLabs entry references the generated-audio Storage substrate. Eligible private cache can be removed through the canonical account-retirement journal and Storage API after Admin/Owner confirmation; platform/foreign audio, independent documents, provider-side retention and backups are separate. Controlled local proof passes; production byte absence and authenticated Owner use are PROOF OWED. No ElevenLabs call, new credential, provider spending or price change is introduced. The separate Supabase infrastructure catalogue entry remains a recorded documentation gap, not a new connection or authority.

## How to keep this report true (§BRAIN.3 / §66)

Any PR that adds/changes a provider's cost responsibility, pricing model, cost driver, money-movement/
M1 track, or roadmap position updates the provider's `expense_and_operations` block in
`integration-capability-registry.json` **and** this report's table in the same commit, and re-runs
`npm run lint:integration-registry`. Never record a price without its official source + a real
checked-as-of date; never assume a free plan; record custom/enterprise honestly (§13/R10).
