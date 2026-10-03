# Solo Marketing IA: research, ownership map and proposal (first return to owner)

**Status:** PROPOSAL, awaiting owner review. No production code changed.
**Owner direction:** 2026-10-03, "Paige Solo — Marketing IA research + reorganization handoff".
**Grounded at:** `main` = `3fa9834` (2026-10-03), branch `claude/gifted-bell-qfezxb`.
**Prototype:** `docs/prototypes/solo-marketing-ia.html`, reproducible frames via
`node docs/prototypes/solo-marketing-ia.drive.mjs` (writes to the gitignored
`scripts/live-drive/artifacts/solo-marketing-ia/`).

Evidence classes in this document are labelled as in `docs/doctrine/paige-ui-delivery-standard.md`.
Everything here is **static** (source read), **production read-only query** (named), or **rendered
prototype**. Nothing is authenticated-runtime evidence.

---

## 1. Research synthesis

Products checked from their own help centres (2026-10-03): HubSpot, HighLevel, Klaviyo, Salesforce
Account Engagement / Marketing Cloud Next, Mailchimp, ActiveCampaign, Kajabi, Keap, Kit, Systeme.io,
Zoho Marketing Plus. Items only found in secondary sources are marked so in the working notes.

| Question | What the market does | What it means for Paige |
|---|---|---|
| Is "Campaigns" the department? | No product treats it that way. A campaign is either a single send (Klaviyo, Mailchimp, ActiveCampaign, HighLevel, Kajabi) or an umbrella initiative object that groups assets, budget, calendar and attribution (HubSpot Campaigns / Marketing Studio, Salesforce Campaign object, Zoho Marketing Planner). | Paige's `campaign_briefs` is already the umbrella-object model. It becomes one tab inside Marketing. |
| Where do Sales, deals and pipeline live? | Always separate from Marketing (HubSpot Sales/CRM, HighLevel Opportunities, ActiveCampaign Deals, Keap Pipeline, Salesforce Sales Cloud). | Confirms the owner ruling. |
| Where do offers and products live? | In commerce/sales areas (HubSpot Revenue/CRM products, HighLevel Payments › Products, Kajabi Sales › Offers, Kit Earn). Klaviyo is the exception: its catalogue is email data. | Offers belong to Sales. Campaigns refers to an offer; it doesn't own one. |
| Where do audiences and segments live? | In CRM-backed products they sit under Contacts/CRM and Marketing borrows them (HubSpot CRM › Segments, HighLevel Smart Lists, ActiveCampaign Contacts › Segments, Kajabi Contacts). Only marketing-only tools with no CRM (Klaviyo, Mailchimp, Kit) make Audience a marketing-owned area. | Paige has a CRM (Clients). Reusable segments belong to Clients; Marketing uses them. |
| Is Content separate from Social? | Yes, everywhere. "Content" means the website/CMS or an asset library. The marketing calendar sits on the campaign object (HubSpot Campaigns › Calendar) or inside the social tool. | Paige's asset library is Vibe Studio; the calendar belongs to Campaigns. A separate Content tab would duplicate both. |
| Are Email and Social separate tabs? | Yes, in every SMB product checked. | Separate tabs, once each has real data behind it. |
| Are forms and lead capture marketing tools? | Split decision: HubSpot, Klaviyo, Kit and Kajabi say yes; HighLevel (Sites) and ActiveCampaign (Website) file them with the website. | For Paige, Vibe already owns creation, so Marketing owns the *use* of a form: submissions, routing and source. |
| Where does attribution live? | In company-wide Reporting (HubSpot Reporting, ActiveCampaign Reports, HighLevel Reporting), with copies on the contact record and the campaign object. HubSpot also links "Marketing analytics" from the Marketing menu. | Marketing gets an operational analytics tab scoped to leads and sources. Cross-domain intelligence is a separate, later job. |

**Consensus:** Marketing is a set of channel tools plus a campaign object, never a dashboard department.
Sales, offers and CRM segments live elsewhere. Attribution is reporting that marketing reads.

## 2. Current-state source and ownership map

Source: `src/lib/routing/tierBranches.ts:185-211`, `src/solo/growth2.tsx:121-472`,
`src/solo/useSoloCampaigns.ts:625-683`, `src/solo/analytics2.tsx:30-276`.

| Current surface | Real component | Underlying source | Canonical owner | New destination | Addresses to keep alive | Active lane collision |
|---|---|---|---|---|---|---|
| Campaigns › Overview | `CampaignOverview` (`campaign-desk.tsx:183`) | `campaign_briefs` via `get_campaign_briefs` / `configure_campaign_brief` | Marketing | Marketing › Campaigns (portfolio + calendar). A new Marketing › Overview reads the same sources. | `growth/overview`, `growth/active` | none |
| Campaigns › Catalog › Offers | `CatalogOffers` (`catalog-offers.tsx:535`) | `tenant_products`, `tenant_prices`, `save_solo_offer`, `set_solo_offer_status` | Sales | Sales › Offers | `growth/catalog` (bare), `?origin=sales&resume=terms` | **Sales PR #1668** edits `catalog-offers.tsx` |
| Campaigns › Catalog › Published assets | inline, `growth2.tsx:151-157` | `growth_pages`, `growth_funnels`, `growth_forms` (Vibe-authored) | Vibe creates; Marketing measures use | Marketing › Lead capture | `growth/catalog?type=page\|funnel\|form`; `growth/{pages,funnels,forms,builders,brand-kit}` | Vibe Studio UI ("layout C") is the next Vibe PR |
| Catalog form drawer › intake | `FormIntakePanel` (`form-intake.tsx:44`) | `growth_form_set_intake`, `growth_form_submissions` | Marketing (routing); Sales (the resulting deal) | Marketing › Lead capture › Routing | — | Public-form intake part 3/3 is not on `main` |
| Campaigns › Sales | `SalesOps` (`sales-ops.tsx:1722`) | `tenant_client_agreements`, `paige_invoices` drafts, `tenant_orders`, `paige_agreements` | Sales | Top-level Sales (built by the Sales lane) | `growth/sales[?view=…&resume=terms]` | Active Sales lane (#1657, #1668; daily merges) |
| Campaigns › Pipeline | `PipelineCommandDesk` (`PipelineCommandDesk.tsx:173`) | `deals`, `pipelines`, `pipeline_stages` via `get_pipeline_workspace` | Sales | Sales › Pipeline | `growth/pipeline[?deal=]`, `clients/pipeline` | Active Sales lane |
| Campaigns › Social | `SocialCommand` (`social-command.tsx:605`) | `get_social_presence_evidence`, `record_social_handles` | Marketing | Marketing › Social, unchanged | `growth/social` | none |
| Campaigns › Performance | inline static cards (`growth2.tsx:332-334`) | `artifacts.length` only | Marketing | Marketing › Analytics | `growth/performance` | none |
| Analytics › Sales funnel | `FunnelVisual` + `useAnalyticsEvidence` | `issue_analytics_evidence_bundle` / `resolve_analytics_evidence_reference` (`20261004000000_analytics_evidence_bundle.sql`) | Sales | Sales performance | `analytics/money` | Sales lane must accept the evidence client |
| Analytics › Acquisition | static | none | Marketing | Marketing › Analytics | `analytics/market-watch` | none |
| Analytics › Revenue & profit | static | none | future Finance / BI | retired, no destination yet | `analytics/profitability` | none |
| Analytics › Retention | static | none | Clients / future BI | retired | `analytics/retention` | none |
| Analytics › Brief, Decisions | static | none | Command Center / PAIGE | retired | `analytics`, `analytics/brief`, `analytics/decisions` | none |

**Production read-only facts (2026-10-03, project `xygzykjyynhzqytbqnzu`):**
- These rows exist: `campaign_briefs` 1, `growth_forms` 4, `growth_pages` 6, `marketing_content` 17, `tenant_products` 2.
- These tables are empty: `growth_form_submissions`, `growth_funnels`, `paige_social_posts`, `paige_social_connections`, `analytics_evidence_reference`.
- No `public` table matches segment, audience, broadcast, newsletter, utm, attribution, ads or lead.
- `growth_form_submissions` already carries `source`, `utm_json`, `referrer` and `deal_id`. That is the real basis for marketing attribution (by the link a lead submitted from; earlier visits are not recorded) and the hand-off to Sales.

## 3. Proposed Solo main menu

| Today (`tenantShellRoutes.ts:148-167`) | Proposed |
|---|---|
| Command Center · Clients · Campaigns · Marketplace · Analytics · Settings | Command Center · Clients · **Marketing** · **Sales** · Marketplace · Settings |

The menu still has six items. Marketing takes Campaigns' slot. Sales is the Sales lane's to add, and
Analytics leaves the menu. Paige, Automations and Calendar keep their current homes.

**Alternative, for your call:** order the menu by the north-star flow (Command Center · Marketing ·
Sales · Clients · …). It reads as the business's flow but moves Clients, whose position is pinned
by `TenantCommandCenterShell.ownership.test.tsx`. I recommend the minimal move.

## 4. Marketing subtabs

**Recommended for the first release (5):** Overview · Campaigns · Lead capture · Social · Analytics.

| Tab | Job | Real data behind it | Truth limits shown in the UI |
|---|---|---|---|
| Overview | The department brief: what's running, what's stuck, what came in, the one next move. | briefs (owner-written), published capture points, submissions, recorded social handles | Cost per lead, email reach and ads reach are shown as unavailable, never as zero |
| Campaigns | The existing Campaign Command Desk: portfolio, brief builder, dossier, campaign loop, plus a calendar view | `campaign_briefs` | Calendar placement uses brief timing text, not scheduled dates |
| Lead capture | Every published form, page and funnel, its submissions, and where they route | `growth_forms`, `growth_pages`, `growth_funnels`, `growth_form_submissions`, `growth_form_set_intake` | Drafts are listed as "not collecting until published". Creation and editing stay in Vibe Studio. |
| Social | Today's Social Command, moved as is | `get_social_presence_evidence` | Publishing and scheduling stay unavailable (no live provider connection) |
| Analytics | Leads by source (the link they submitted from), source coverage, hand-off to Sales, per-campaign matching through tracking tags | `growth_form_submissions.source / utm_json / deal_id` | Conversion rate, CPL, CAC and multi-touch attribution are unavailable; each card says what is missing |

**Not recommended as tabs now (shown in the prototype under "Full candidate (9)" so you can judge):**

| Candidate | Recommendation | Why | What would make it real |
|---|---|---|---|
| Audience | Reusable segments live in **Clients**; Marketing references them. | Market consensus for CRM-backed products; avoids a second people store. Today there is no segment table anywhere, and Agency's Segments tab is fixture-only (`src/agency/fixtures.ts`). | A segment-definition table + RPC owned by Clients. **Backend change: needs your go.** |
| Content | Fold into Campaigns (calendar view) and Vibe Studio (assets). | The calendar belongs on the campaign object; Vibe is the asset library. | A start date on `campaign_briefs` makes the calendar exact. **Backend change (small).** |
| Email | Not yet. | `email_templates` / `email_send_log` are transactional. There is no broadcast or sequence record, audience, or marketing send path. | A broadcast record + approval-gated send seam, reusing `tenant_email_identities` and the existing unsubscribe/suppression tables. **Backend change, and sending spends money: owner decision.** |
| Ads | Not yet. | No tenant ad-account connection, campaign or spend record. | Tenant Meta/Google ad-account connection + spend ingestion. **Backend change + provider choice.** Spend also unlocks CPL/CAC. |

**Measured fit (rendered prototype, 336 frames, `fit-table.json`):** five tabs never scroll the strip
except at the narrowest PAIGE-expanded column (503px: 48px; 422px: 129px, with the selected tab
always kept in view). Nine tabs scroll at every PAIGE-docked width (379px of hidden tabs at 1366
docked) and even at 1024 and 900 with PAIGE closed. On a 1366 laptop with PAIGE open, four of nine
tabs would be off-screen at all times. The prototype approximates the shell's rail width (232px), so
real columns differ by about 17px. The conclusion doesn't depend on that.

## 5. Sales hand-off boundary

**The Sales lane owns:** the top-level Sales branch and everything in it: Sales command and
overview, Agreements (commercial terms), billing and invoice drafts, payments and recurring, Offers
(`tenant_products`), Pipeline (deals, stages, routing evidence), and Sales performance (including
the live sales-funnel evidence client).

**Marketing never writes a Sales object.** The contract between the two:

| Direction | What passes | Where it already lives |
|---|---|---|
| Marketing → Sales | lead source, referrer, tracking tags, and which form/page captured them | `growth_form_submissions.source`, `utm_json`, `referrer`, `form_id` |
| Marketing → Sales | which campaign a deal came from | campaign tracking tag in `utm_json`, matched to `campaign_briefs.short_ref`. **There is no `campaign_id` on deals; adding one is a backend change and needs your go.** |
| Marketing → Sales | where a form routes (pipeline, stage) | `growth_forms.pipeline_id / stage_id` via `growth_form_set_intake` (Marketing sets it; Sales owns the deal it creates) |
| Sales → Marketing (read-only) | whether a lead became an opportunity, and its outcome | `growth_form_submissions.deal_id`; outcome read from Sales' own reads, never recomputed |
| Campaigns → Sales (reference) | the offer a campaign promotes | `campaign_briefs.offer_id` → `tenant_products.id` |

**Shared files both lanes touch, and who edits what:**

| File | Sales lane | Marketing lane |
|---|---|---|
| `src/lib/routing/tierBranches.ts` | adds the `sales` branch | relabels `growth`, removes `sales`/`pipeline`/`catalog` subtabs, adds aliases |
| `src/components/tenant-shell/tenantShellRoutes.ts` | adds the Sales rail entry | renames Campaigns → Marketing, removes Analytics |
| `src/solo/growth2.tsx` | stops being mounted here once Sales has a home | becomes the Marketing hub |
| `src/solo/systems-check-areas.ts` | re-points `/growth/sales` and `/growth/pipeline` checks to Sales | re-points `/growth/social` |
| `supabase/functions/_shared/canonical-app-url.ts`, `crm-command`, `approvalOutcome.ts`, `ContactDealsSection.tsx` | pipeline/deal links | none |

To avoid both lanes editing `tierBranches.ts` and `growth2.tsx` at the same time, Slice 3 below
waits for the Sales branch to land.

## 6. Solo Analytics retirement and re-home

Only one of the six lenses reads real data today: the Sales funnel (`analytics2.tsx:268-272`; it
fetches evidence only when the `money` lens is open). The other five render fixed empty frames.
Production has never written an `analytics_evidence_reference` row.

| Lens | Live? | Goes to | Address handling |
|---|---|---|---|
| Sales funnel | yes (server-issued, versioned bundle) | Sales › Performance, through the **existing** `useAnalyticsEvidence` client | `analytics/money` → Sales performance (once it exists; until then the Analytics branch stays) |
| Acquisition | no | Marketing › Analytics | `analytics/market-watch` → `marketing analytics` |
| Revenue & profit | no | future Finance / Business Intelligence | `analytics/profitability` → Command Center, with a one-line "moved" notice |
| Retention | no | Clients / future BI | `analytics/retention` → Clients |
| Brief | no | Command Center | `analytics`, `analytics/brief` → Command Center |
| Decisions | no | Command Center / PAIGE | `analytics/decisions` → Command Center |

**Kept, not deleted:** `analytics_evidence_reference`, `analytics_sales_funnel_evidence_bundle`,
`issue_analytics_evidence_bundle`, `resolve_analytics_evidence_reference`, their SQL test
`supabase/tests/analytics_evidence_bundle.sql`, and `src/solo/data/useAnalyticsEvidence.ts`
(bundle validation, coverage, freshness, truth-state coupling, opaque references, revalidation).
**Agency analytics** (`AGENCY_BRANCHES` analytics, `src/agency/analytics.tsx`) is a separate tree
and is not touched.

## 7. Platform Operator Analytics: non-impact, and a correction

**§13 correction.** The handoff names `/admin/platform/analytics`. That route does not exist on
`main`. Checked:
- `admin/platform/analytics` across `src/` and `docs/`: the only hit is a stale architecture doc (`docs/architecture/CANONICAL-SYSTEM-ARCHITECTURE-2026-08-08.md:133`), which cites `src/pages/Admin.tsx`.
- That file is gone, and `src/App.tsx` declares no `/admin` route.
- `src/pages/admin/platform/PlatformAnalyticsAdmin.tsx` exists but nothing imports it.

The live operator analytics is **`/operator/analytics/{view}`**:
- route: `App.tsx:234` → `OperatorEntry` → `OperatorApp`
- tree: `OPERATOR_BRANCHES` analytics, ten views (`tierBranches.ts:513-526`)
- slot: `operatorIA.ts:73-76`

**Why the Solo change cannot reach it:**
- The Solo and operator surfaces share only `tierBranches.ts`, and each reads a different array.
- No operator file imports `analytics2.tsx` or `useAnalyticsEvidence`.

**Proof owed in the implementation PR (not yet run):**
1. A route test that the operator analytics tree and its ten views are byte-identical before and after.
2. A test that `/operator/analytics/platform-health` still resolves.

Neither exists today: no route-level test for `/operator/analytics/*` was found.

## 8. Legacy route and redirect map

Every old address resolves through a deliberate `replace` redirect. `SoloApp` already does this for
`trust-compass`, and `growth2` does it for `active`. Final canonical root: `/solo/{account}/marketing/…`.

| Old address | Stage 1 (labels change, slug stays `growth`) | Final (slug `marketing`) |
|---|---|---|
| `/solo/{a}/growth` | Marketing › Overview | `/solo/{a}/marketing` |
| `growth/overview` | Marketing › Overview (the new department brief; as built in S2) | `marketing/overview` |
| `growth/active` | Marketing › Campaigns (the desk moves) | `marketing/campaigns` |
| `growth/catalog?type=page\|funnel\|form`, `growth/{pages,funnels,forms,builders,brand-kit}` | Marketing › Lead capture | `marketing/lead-capture` |
| `growth/catalog` (offers), `?origin=sales&resume=terms` | stays until Sales has Offers | `sales/offers` (Sales lane's slug) |
| `growth/sales[?view=…]` | stays until Sales lands | `sales/…` with `view` preserved |
| `growth/pipeline[?deal=]`, `clients/pipeline` | stays until Sales lands | `sales/pipeline[?deal=]` |
| `growth/social` | Marketing › Social | `marketing/social` |
| `growth/performance` | Marketing › Analytics | `marketing/analytics` |
| `analytics/market-watch` | Marketing › Analytics | `marketing/analytics` |
| `analytics/money` | stays until Sales performance lands | Sales performance |
| `analytics`, `analytics/{brief,decisions,profitability}` | stays until Slice 4 | Command Center (with a notice) |
| `analytics/retention` | stays until Slice 4 | Clients |

Server-side links must move with their slices:
- `_shared/canonical-app-url.ts:72`
- `crm-command/index.ts:365-389`
- `paige-mcp` `create_deal`
- Spine `humanSurface` metadata. Two values already point at routes that don't exist (`/solo/:account/campaigns`, `/solo/:account/sales`).

`tierBranches` has subtab aliases but **no branch-level aliases**, so the final slug rename needs
either a `Branch.aliases` field or a `SoloApp` redirect. The `trust-compass` precedent uses the
redirect.

## 9. Collision check (2026-10-03)

| Item | Touches | Impact |
|---|---|---|
| PR #1668 `sales/catalog-search` (open) | `catalog-offers.tsx`, its CSS and contract test | Confirms Offers is Sales territory. Marketing must not edit `catalog-offers.*`. |
| PR #1657 `sales/address-lookup` (draft) | `src/solo/sales/addressLookup.ts`, new edge fn | none |
| Sales merges #1639–#1666 (this week) | `sales-ops.tsx`, `src/solo/sales/*` | none, as long as Marketing leaves those files alone |
| #1658 Vibe Studio publish lifecycle (merged) | growth tables, Studio RPCs | Lead capture reads its `status` / `published_at` rules (page `published`; funnel and form `active`) |
| PR #1403 `claude/analytics-solo-lane` (draft, stale since 09-24) | docs + a proposed metric dictionary | It assumes Solo Analytics stays a destination. Its owner should know the surface is retiring; the metric dictionary is reusable for Marketing and Sales analytics. |
| Sub-account (`/business`) | renders `AgencyApp mode="subaccount"` on `SUB_ACCOUNT_BRANCHES` (`tierBranches.ts:624-645`), not the Solo tree | **This change reaches Solo only.** Sub-accounts keep "Growth" until the planned `/business` → SoloApp migration. See decision D4. |

## 10. Prototype

`docs/prototypes/solo-marketing-ia.html` is one self-contained, read-only file built on the real
Solo tokens (`solo-tokens.css`) and the real Campaigns tab-strip geometry (`solo-campaigns.css`).

Review controls:
- **Product / Ownership map:** switches between the product frames and the full ownership table.
- **Recommended (5) / Full candidate (9):** the proposed tab set, or all nine handoff tabs.
- **State:** Populated · First use · Loading · Read error · Read-only member.
- **Viewport:** the four Solo sizes.
- **PAIGE:** Closed · Docked · Expanded.
- **Mineral / Obsidian:** the two themes.
- **Source notes on/off:** each value carries a dashed note naming its source (live read, owner brief, unavailable, mock). The notes are review annotations, not product UI. The product will use the plain-words truth vocabulary that `growth2.tsx` already enforces.

**Rendered evidence:** `node docs/prototypes/solo-marketing-ia.drive.mjs` measured **336/336 frames
with zero horizontal overflow and the selected tab always in view**. That is 2 tab sets × 2 themes
× 4 viewports × 3 PAIGE states × every tab. It also took state frames and checked keyboard
ArrowRight between tabs.

**Not proven by the prototype:** real data, real permissions, authenticated runtime. Those belong to
the implementation slices.

## 11. Recommended slices and PR sequence

| Slice | Lane | What ships | Gate |
|---|---|---|---|
| S1 (this PR) | Marketing | This proposal, the prototype and its drive, and the master-doc §13 correction. Docs only. | Owner review of IA |
| S2 Marketing in place | Marketing | Branch label Campaigns → Marketing (slug stays `growth`); rail label. New Overview built from existing reads. The desk moves to a Campaigns tab, with a calendar view on brief timing. Lead capture takes Catalog's published-assets half and the intake drawer. Performance becomes Analytics (source from the tracking tags on the submitting link). Social is unchanged. **Sales, Pipeline and Catalog (Offers only) stay visible and working** until S3, so nothing becomes unreachable (§58). Also fix the "Open Studio" buttons in the desk, which appear to do nothing (`growth2.tsx:434` dispatches without the launcher the listener requires; inferred from source, not reproduced). | Owner approval of S1; CI; UI evidence record; §39 peer read |
| S3 Sales extraction | **Sales lane builds Sales**; Marketing removes | After the Sales lane lands its top-level branch (with Offers, Pipeline, Sales performance), Marketing removes those three tabs and adds `replace` redirects. Systems Check destinations and server deep links move with it. | Sales destination **live in production**, verified on the live site, not merely merged (owner ruling 2026-10-03: "Wait until Sales go live") |
| S4 Analytics retirement | Marketing | Remove the Solo `analytics` branch and rail entry; add redirects per §6. Evidence infrastructure stays. Operator-analytics guard tests (§7) ship here. | S3 merged (Sales performance hosts the funnel) |
| S5 Canonical URLs | Marketing | Slug `growth` → `marketing` with branch-level alias support, subtab slugs `campaigns`, `lead-capture`, `social`, `analytics`. All old addresses redirect. | S2–S4 stable |
| Later, each needs your go | Clients / Marketing | Segments (Clients), dated briefs, Email broadcasts, Ads connection, campaign id on deals | Backend changes and spend decisions |

## Decisions for the owner (one gate)

- **D1.** Ship Marketing with **5 tabs** (Overview · Campaigns · Lead capture · Social · Analytics) and hold Audience, Content, Email and Ads until real data exists? *Recommended: yes.*
- **D2.** Menu order: minimal move (Command Center · Clients · Marketing · Sales · …) or flow order (Command Center · Marketing · Sales · Clients · …)? *Recommended: minimal move.*
- **D3.** Offers belong to Sales (the Sales lane already treats them that way in #1668). *Recommended: confirm.*
- **D4.** Sub-accounts run on the Agency tree today and still say "Growth". Should this lane also bring sub-accounts along now, or leave them for the planned `/business` → Solo-shell migration? *Recommended: leave them; record the gap.*
- **D5.** Revenue & profit, Retention, Brief and Decisions retire with no live replacement. None of them shows data today. *Recommended: retire, with a "moved" notice on the old address.*

## Found while grounding (not fixed here)

- **Overview "Open Studio" buttons appear to be dead.** `campaign-desk.tsx` calls 43, 151, 457, 552 and 701 dispatch with an empty detail, and `SoloApp.tsx:284-287` ignores that. Folded into S2. Inferred from source; not reproduced in a browser.
- **Raw truth labels in the desk.** `campaign-desk.tsx` still renders raw `LIVE/PARTIAL/UNAVAILABLE` labels, against the plain-words ruling at `growth2.tsx:50-53`. The contract test only scans `growth2.tsx`. Folded into S2.
- **Stale master-doc description.** The master doc's Sales Command Desk row (around L1801–1859) describes four views. The code now has Overview / Payments / Invoices / Recurring / Agreements. This is the Sales lane's record to update.
- **Missing tier-matrix rows.** The tier matrix has no ledger rows for Sales billing drafts (#1642/#1647/#1659) or for Solo Analytics.

---

## Owner decisions (ruled 2026-10-03)

All five recommendations were approved as written:
- **D1** five Marketing tabs.
- **D2** minimal menu move.
- **D3** Offers belong to Sales.
- **D4** sub-accounts are left for the `/business` → Solo-shell migration and recorded as a gap.
- **D5** the four empty Analytics lenses retire with a "moved" notice.

Slice S2 ("Marketing in place") is the first implementation.

## Next phase: Marketing execution architecture (INT-298), after S2–S5

The owner set the backend direction on 2026-10-03 and preserved it as **INT-298**. It is recorded
here so the backend phase starts from it rather than reconstructing it. **It authorizes no schema,
table or capability now.** Its first slice (M-A1) is discovery: a gap map, returned before any schema.

**The chain:**
Strategy → Campaign → Tactic → Marketing Action → Orchestrator → Harness Run → Spine (capabilities) →
Trust / Approval (autonomy) → Execution (provider / domain) → Rail and receipts (proof) → Domain outcome
(Lead capture · Sales · Payment · Clients) → Mind (situational interpretation) → Agent Intelligence
(evaluate · detect patterns · experiment · recommend) → Knowledge (only promoted, durable playbooks) →
the next Strategy / Tactic / Action.

**Who owns what:**
- **Marketing** decides the strategy. Campaigns organize the initiative, tactics choose the play, and actions describe the work.
- **Orchestration** decomposes the work and orders it by dependency.
- **The Harness** governs each unit of work as a bounded run. Each run carries: intent, context, role, inputs, the capabilities resolved from the Spine, authority from Trust Compass and approvals, constraints, a computational and business budget, success criteria, evidence requirements, an evaluation, and a hand-off.
- **Spine, approvals, Rail, Knowledge, Mind and Agent Intelligence** stay the canonical machinery. Marketing never builds a second executor, approval queue, receipt system, provider gateway, memory or analytics truth.
- **Roles.** "Media Outreach", "Distribution" and similar are roles instantiated through the one Harness, not separately built agents (CLAUDE.md §14). They own no Brain, memory, authority, job system or tool access of their own.

**Grounding already on `main` (2026-10-03):**
- The Paige Runtime Harness is approved architecture, recorded as PARTIAL and distributed (master reference, "Paige Runtime Harness", 2026-09-08). Its canonical path ends in Spine authority, then verified readback, then receipt and Rail.
- `campaign_briefs` already carries `mission_id`, which links to the business-mission substrate (`20260905221203_business_mission_foundation.sql`). Durable tasking (`20260811120000_wave4_4a3_durable_tasking_compaction.sql`) and durable jobs also exist.
- The talent registry (`paige_subagents`) and the department/action-kind registry (`20260720153024_paige_subagents_talent.sql`, `20260720200830_org_departments_action_kinds.sql`) exist.
- Existing contracts in the brain that M-A1 starts from:
  - `docs/brain/paige-durable-job-contract.md`
  - `docs/brain/paige-receipt-rail-contract.md`
  - `docs/brain/paige-spine-and-rail-state.md`
  - `docs/brain/paige-router-budget-contract.md` (computational budget)
- **M-A1 must map all of these before proposing anything new.**
- A "durable work envelope" migration exists only on an unmerged branch, not on `main`. Its status must be resolved in M-A1 rather than assumed.

**One doctrine fit to carry forward:** CLAUDE.md §67 grants autonomy to a repeatable *process*, never to a
tool. A Marketing **Tactic** (for example "Podcast circuit", or "webinar follow-up within 24 hours") is
exactly that unit. The Trust Compass grant naturally attaches at the Tactic, while each Action inside it
still passes the per-capability floor and the account ceiling: `min(grant, floor, ceiling)`.

**How S2 stays compatible:**
- Overview's "Needs attention", "Channels" and "Campaigns in progress" are the slots where approvals, scheduled actions and outcomes will appear once real action and Rail state exist.
- Campaigns remains the one home for the brief, and the brief already links offer, pipeline and mission.
- Lead capture and Analytics read only canonical records.
- Nothing in S2 invents action, schedule or outcome state.
