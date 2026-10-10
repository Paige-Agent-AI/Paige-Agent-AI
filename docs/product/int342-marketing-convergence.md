# INT-342 Marketing Department convergence: grounding, recommendation and prototype (first return)

**Status:** grounding and prototype are done. No product UI has changed. Tab and navigation changes wait for the
owner's prototype approval, which is the coordinator's explicit gate for this work.

**Prototype:** https://claude.ai/artifact/7jwwBxRswrCAPxQiZqc6RG. The record copy is
`docs/prototypes/int342-marketing-convergence.html`.

**Parent:** INT-298 (`docs/product/solo-marketing-ia-proposal.md` §"Next phase"). **Partners:** INT-340 (shared
metric contract) and INT-341 (Sales performance).

**Evidence classes used below:**
- Static: code read at `c9a39d274`.
- Production: read-only SELECTs on `xygzykjyynhzqytbqnzu`, 2026-10-10.
- Rendered: a Playwright drive of the prototype.

No authenticated runtime was driven in this phase.

North star: *Vibe creates. Marketing coordinates. Channels execute. Analytics measures. Sales receives the
qualified handoff. Rail proves what happened. PAIGE works across the whole chain.*

## A. Current main

- `origin/main` = `c9a39d274` (2026-10-10).
- Grounding began at `761192cae`. The 192 commits between the two touch no Marketing file. The only Solo
  change is that `SoloApp.tsx` retired the top-level Analytics route through `soloAnalyticsCompatibility`
  (`src/solo/analytics-routing.ts`). That function sends `analytics/market-watch` to `growth/analytics`, and that
  address must keep working.

## B. E3c acceptance and the four E3 debts

- **E3c:** MERGED and DEPLOYED (#1767, `19de5675c`, migration `20270595000000`; verified on production).
- **Signed-in production acceptance:** still `UNVERIFIED`. This session has no tenant login
  (`LIVE_DRIVE_EMAIL`/`LIVE_DRIVE_PASSWORD` are unset). It does not block INT-342. The ten-step drive is still
  owed: ask → missing links/prices named → series in chat → draft in Automations → file → person approves →
  new contact gets email 1 → Pause → Stop confirm → Start a copy.
- **The four debts, ranked:**
  1. Pause/resume uses up durable-work attempts, so a series can go silent.
  2. A bulk import can use the whole daily allowance.
  3. A departed approver stalls a running series.
  4. The cost of claiming due sends grows with series size.

  None became launch-critical. INT-342 does not touch the series runtime. Debt 1 is still the most likely to
  hurt a real owner.
- **Deployment order:** routed, not solved here (task card "Order edge-function deploys after migrations").
  `deploy-edge-functions.yml` has no `needs:` or `db-live` check, so on a mixed merge functions can go live
  before their migration. That happened on E3c.

## C. Current Marketing inventory (Solo)

**How the shell loads:** `App.tsx:313` → `SoloApp` → `GrowthHub` (`growth2.tsx:637`) → `MarketingWorkspace`.
Routes are `tierBranches.ts:189-213` (`/solo/:account/growth/<tab>`). Most tabs share one read,
`useSoloCampaigns`:
- `growth_pages`, `growth_funnels`, `growth_forms`;
- the latest 200 submissions;
- `get_pipeline_routing_evidence`;
- `get_pipeline_workspace`.

| Tab | Component | Reads | Writes | Job |
|---|---|---|---|---|
| Overview | `MarketingOverview` + `marketing-overview-model.ts` | campaigns read + `get_campaign_briefs` | none (links) | KPIs, leads over time, source donut, top capture points, "Needs your attention", next step |
| Campaigns | `campaign-desk.tsx` | `get_campaign_briefs`, offers | `configure_campaign_brief` | 7-stage loop per brief |
| Audience | `marketing-audience.tsx` | `clients`, `client_contact_methods` | none | reach dashboard (§28: preserve) |
| Content | `MarketingContent` (`marketing-planned.tsx`) | `marketing_content` (newest 60, admin) | none | draft library list |
| Social | `social-command.tsx` | `get_social_presence_evidence` | `record_social_handles` | handles only |
| Email | `marketing-email*.tsx` | E1–E3c reads | campaigns, series, approvals | live |
| Ads | `MarketingAds` (`marketing-planned.tsx:170`) | `marketing_content` where `channel='ad_copy'` | none | ad-copy list + "not yet" list |
| Lead capture | `LeadCapture` (`growth2.tsx:510`) + `form-intake.tsx` | campaigns read; intake panel | `growth_form_set_intake` | capture points, routing, paged submissions, recent submissions, contact/deal links |
| Analytics | `MarketingAnalytics` (`growth2.tsx:548`) | last 200 submissions, briefs | none | 4 stats, leads by `utm_source`, by `utm_campaign` matched to `short_ref` |

**Production (2026-10-10):**

| Record | Count |
|---|---|
| Pages | 8 (1 published) |
| Funnels | 0 |
| Forms | 5 (4 active, **0 routed**) |
| Submissions | **0** |
| Funnel sessions | 0 |
| Form automations | 0 |
| `marketing_content` | 17, all drafts, channel null everywhere |
| Campaign briefs | 1 (draft) |
| Social posts | 0 |
| Email campaigns | 1 (draft) |
| Deals | 3 (open) |

Four businesses have any marketing record.

**Confirmed defect (static): a form routed in the intake panel still shows "Not routed".**
- `routingConfigured` comes only from `growth_form_automations` rows (`useSoloCampaigns.ts:737-761`). The forms
  read selects `id,slug,name,status,updated_at` (`:670`).
- `growth_form_set_intake` writes the `growth_forms` routing columns. It only touches automation rows that
  already exist (`20270518000000_public_form_intake.sql:183-209`).

The rebuilt attention list must read both, so this is fixed in slice 1 below.

## D. Recommended final IA

**Overview · Campaigns · Audience · Social · Email · Ads · Analytics** (seven tabs).
- Lead capture retires (E).
- Content retires (F, option A).
- Vibe Studio stays the only creator and remains the launcher in the tab strip.

The split: Overview is the operational summary and attention; Analytics is measurement and diagnosis;
Campaigns is the operating object; and the channels (Email, Social, Ads) own their controls. Sales owns the
opportunity, and Clients owns the person.

## E. Lead capture re-home map

| Job today | New home | Old address kept alive |
|---|---|---|
| Capture points list and filter | Overview › Capture points | `growth/lead-capture[?type=]`, `growth/catalog?type=` → Overview, capture section, filter kept |
| Routing editor (pipeline, stage, alert email) | **One form panel**: the existing `FormIntakePanel` as a drawer, opened from Overview, Campaigns and Analytics. It is addressed by `?form=<id>` on `growth/overview`. Vibe Studio's `FormSettings` already calls the same `useFormIntake().save`, so it stays the authoring-time entry to the same seam. | `growth/lead-capture?form=<id>` → Overview with the panel open |
| Paged submissions with answers | Form panel › Submissions | — |
| Recent submissions | Overview › Recent leads | — |
| Open contact / open deal | Same links; Sales owns the deal (no second viewer) | `growth/pipeline?deal=` compatibility unchanged |
| Unrouted / failed / unpublished attention | Overview › Needs your attention (fix the routed signal, C) | — |
| Source and campaign tags | Analytics › Acquisition, through INT-340 (H) | `growth/performance`, `analytics/market-watch` → `growth/analytics` |
| A campaign's pages and forms | Campaigns › campaign › "Pages, forms, emails and ads" | — |
| brand-kit / builders / pages / funnels / forms aliases | Overview › Capture points with a one-line notice | all five aliases |

- **Inbound links to rewrite:** 11 sites inside `growth2.tsx`, plus `tierBranches.ts:208` and three live-drive
  scripts with their harness.
- **Outbound URLs:** no edge function, email or notification builds a Lead capture URL. The PAIGE Spine growth
  domains use bare `/solo/:account/growth`.
- **Gap to name, not fix here:** Vibe Studio has no address for a single draft (`vibe.tsx:33`, overlay only).
  "Finish in Vibe" therefore lands on Studio's home.

## F. Content decision: **A, retire**

**Evidence:**
- **No live owned-media to show:** all 17 `marketing_content` rows are drafts, `channel` is null on every row, none
  has `published_at`, and none carries metrics.
- **No visit or engagement data:** no tenant-scoped page-view producer exists, and the public renderers record
  nothing. `analytics_events` has no `tenant_id` and 0 `page_view` rows. `growth_funnel_sessions` has a writer
  RPC that is never called.
- **Mostly dashes:** Option B ("Web & content") can fill only status, date, link and leads per item. Visits,
  unique visitors, conversion, search, engagement and campaign would all be dashes, and blogs, resources and
  videos have no record at all.

**Where its pieces go:**
- Saved drafts open where they are made (Vibe Studio).
- Ad copy moves to Ads › Creative.
- Published pages and forms are on Overview › Capture points.
- `growth/content` → Overview with a notice.
- PAIGE's saved-content `humanSurface` (`_shared/paige-spine/domains/marketing_content.ts:29,48`) is repointed
  in the same slice.

**When to revisit B:** once public routes record tenant-scoped visits (G/J). B is in the prototype for
comparison.

## G. Ads plan: a paid-acquisition desk that tells the truth

**Readiness (full matrix in the prototype's maps view):**
- **No provider is connected, read or written for any business.** Production shows 0 ad connections, 0
  `ad_copy` drafts, `meta_ads_features_enabled=false`, no `ads.*` Spine key, no ads Trust class, no ads approval
  type, no Rail producer, and no spend or budget store.
- **Meta Ads and Metricool:** each has only a generic-MCP catalogue tile (`settings-integrations-gateway.tsx:83,85`).
  A connected generic MCP does not reach PAIGE chat, which dispatches only GHL, Zapier and n8n
  (`paige-ai-chat/index.ts:14677-14740`).
- **Google Ads:** reachable only through a Zapier hint.
- **YouTube, LinkedIn and TikTok Ads:** nothing.
- **Shipped copy is false today:** `marketing-planned.tsx:180` says connecting an ad platform "gives PAIGE tools
  for it in chat". Fix it in slice 1.

**Data model to add (backend; this stops at the owner gate):**
- A per-business ad-account connection, holding provider, external account id and display name.
- A provider read adapter for campaigns, ad sets, ads and creative, plus daily insights (spend, impressions,
  reach, clicks, provider-reported results) stored with `as_of`.
- A link between a provider campaign and a `campaign_briefs` row.
- **Money stays separate:** brief target (owner text, never spend), provider budget, and actual spend (provider
  report). Platform billing and Sales revenue are never read here.

**Authority:**
- Reads are low risk: an `ads.read` Spine key with a Rail receipt for each sync.
- **Every write** (activate, pause/resume, budget, create campaign or ad, targeting, publish) needs its own
  `ads.*` key, a Trust/risk class (high), an approval type, the M1 money controls for spend (reserve → confirm →
  reconcile → receipt), provider readback before reporting, and a Rail receipt.
- No provider write may bypass Harness → Spine → Trust → approval/autonomy → adapter → readback → Rail.

**Metrics:**
- Spend, impressions, clicks and CTR come from the provider.
- CPL = provider spend ÷ provider-reported leads, labelled as provider-reported.
- "Leads on your forms" = submissions whose tracking tag matches (PARTIAL).
- **ROAS is withheld** until click → lead → deal → payment is linked.

**UI** (prototype): a desk with Overview · Campaigns · Creative · Audiences · Performance and a provider
identity strip.
- Not connected: Creative works and everything else says what is missing.
- Connected: a proposed state, every value MOCK. Writes appear as approval-gated and unbuilt.

**PAIGE:** drafts and saves ad copy today. When a provider read exists she reads ads, and she never executes a
write.

**Owner decision:** which provider first. Meta is the only one with a catalogue entry.

## H. Marketing Analytics and INT-340

INT-340 is live: `issue_analytics_evidence_bundle` → `_analytics_metric_produce` (33 keys; `sales.*`,
`business.*`, `operations.*`, `team.*`, `ai.*`). There is **no `marketing.*` producer**.

**Plan:**
- Marketing adds a private `_marketing_metric_bundle` with its own allowlist.
- The dispatcher branch is an INT-340-owned seam. Coordinate with its owner as Sales did
  (`docs/delivery/sales-performance-server-contract.md`).
- Surfaces consume the result through `parseMetricResult`, and the browser stops computing KPIs.

**Proposed definitions:**

| Key | Source | Class |
|---|---|---|
| `marketing.leads.received` | `growth_form_submissions.created_at` | LIVE |
| `marketing.leads.daily` | same | LIVE |
| `marketing.capture_points.published_current` | forms active, pages published, funnels active | LIVE |
| `marketing.forms.unrouted_current` | form routing columns **or** an enabled automation | LIVE |
| `marketing.submissions.failed_current` | `processing_state` (the stale-claim threshold needs a definition) | LIVE |
| `marketing.leads.by_utm_source` | `utm_json.utm_source`; untagged disclosed | PARTIAL |
| `marketing.leads.by_campaign_tag` | `utm_campaign` ↔ `short_ref` text match | PARTIAL |
| `marketing.leads.converted_to_opportunity` | `submissions.deal_id`; outcomes stay in Sales | LIVE |
| `marketing.email.{sent,opened,clicked}` | `email_campaign_recipients`; rates over tracked sends, server-side | LIVE |

**UNAVAILABLE, each with its missing producer:** qualified leads (no definition), page views and conversion
rate, funnel step-through, social reach and engagement, ad spend, CPL, CAC and ROAS.

**Boundary flags for INT-340/341:**
- `read_email_marketing_dashboard` counts `deal_created`/`invoice_paid` conversions by reading Sales tables.
- Email open and click rates are computed in the browser (`marketing-email-model.ts:37-60`).
- Settings Analytics (`settings-analytics.tsx`, `_settings_analytics_metric_bundle`) is not touched.

**§13 correction:** `solo-marketing-ia-proposal.md` §6 says production never wrote an `analytics_evidence_reference`
row. That is stale: there were 620 rows on 2026-10-10, none of them marketing.

## I. PAIGE as Marketing COO (gap matrix)

L = LIVE · P = PARTIAL · U = UNAVAILABLE. A dash means the column doesn't apply.

| Function | Observe | Analyze | Recommend | Draft | File | Execute | Verify | Measure | Learn |
|---|---|---|---|---|---|---|---|---|---|
| Strategy | P | P | P | L | P | U | L | U | U |
| Campaign management | P | U | P | P | P | U | P | U | U |
| Audience | L | P | P | L | L | P | L | U | U |
| Owned web / published | L | U | P | L | L | L | L | U | U |
| Social | P | U | P | P | U | U | U | U | U |
| Email | L | P | P | L | L | P | L | P | U |
| Ads | U | U | P | P | U | U | U | U | U |
| Lead capture / routing | P | U | P | L | L | P | P | U | U |
| Attribution / analytics | P | U | U | — | — | — | — | U | U |
| SEO / discovery | U | U | P | P | — | P | U | U | U |
| Lifecycle / nurture | L | P | P | L | L | P | L | P | U |
| Partnerships / affiliates | P | U | P | U | U | U | U | U | U |
| PR / earned media | U | U | P | P | U | U | U | U | U |
| Events | P | U | P | P | P | U | U | U | U |
| Experiments / A-B | U | U | P | U | U | U | U | U | U |
| Sales handoff | L | P | P | L | L | L | L | U | U |

**Missing, by gap:**
- **Ads:** everything — source, writer, provider, event producer, Spine key, Trust class, approval, Rail receipt,
  readback, metric and UI.
- **Social execute and measure:** a proven provider, a posting Spine key, a receipt, readback and a metric.
- **Attribution:** a campaign key on assets, contacts and deals; `form.submitted`, `page.viewed` and
  `email.opened/clicked/replied` event producers; and a marketing metric producer.
- **Campaign management:** a campaign ↔ asset link and a roll-up metric.
- **Lead routing:** a `form.submitted` §67 trigger and Rail kind.
- **Learning:** every marketing capability has `mindBinding: UNAVAILABLE`.

**What the COO can answer today, from evidence:**
- **Which campaigns are active?** None: 1 draft brief and 1 draft email.
- **Which leads came from which campaign?** Cannot answer (no link, 0 submissions).
- **Which channel produces qualified leads?** Cannot answer.
- **What is our CPL?** Cannot answer (no spend).
- **Which page converts best?** Cannot answer (no visits).
- **Which emails drive replies or bookings?** Cannot answer (0 recipients; engagement is not returned to PAIGE).
- **What should we do next?** Judgement only.

## J. Spine, Rail and event gap map

**What exists:**
- Spine keys `campaign.*` (planning only: "never campaign launch, publish, spend"), `email_campaigns.*` (7),
  `growth_page|form|funnel.save/publish/unpublish`, `marketing_content.save`, and `social.presence` (read).
  Every one is maturity PARTIAL.
- Receipts flow through `record_capability_run` → `paige_workspace_events`.

**What is missing:**
- Spine keys: `ads.*`, `social.publish|schedule`, `marketing.analytics.read`, `seo.*`, experiment keys, and a
  campaign-level execution key.
- `paige_client_events` kinds: `form.submitted`, `page.viewed`, `email.opened|clicked|replied`, `campaign.*`.
- §67 triggers: `form.submitted`, `booking.*`, `email.*`. Only `contact.created` and `pipeline.stage_changed` are
  live.

**Production (90 days):** no Rail event has ever been recorded for `campaign_brief_*`, `email_campaign*`,
`email_series*`, `content_save` or `growth_*_publish`.

**Anomaly to follow up:** one `campaign_briefs` row exists with no `campaign_brief_create` receipt, which suggests
the UI save path writes no receipt.

**Side finding (outside scope):** the production GHL connection is stored as `provider_key='generic-remote'`.
Chat looks for `provider_key==="gohighlevel"` (`paige-ai-chat/index.ts:14688-14691`) and may not find it.

## K. Prototype

**Where:** https://claude.ai/artifact/7jwwBxRswrCAPxQiZqc6RG (record copy in `docs/prototypes/`).

**What it covers:**
- the seven-tab strip with no Lead capture;
- Content A and B;
- the Ads desk, not connected and connected (proposed);
- the Overview cockpit, with attention, capture points and recent leads;
- the single form panel (routing plus paged submissions, focus trap, Escape, focus return);
- campaign composition, with the chain status and the proposed asset link;
- Analytics through the INT-340 contract;
- ten old links resolved with intent;
- PAIGE closed, docked, expanded and overlay;
- data states: like production today (empty and unrouted), populated (MOCK), loading, read error and
  member view-only;
- workspace switch, which drops the open panel and stale data;
- both themes and reduced motion;
- the maps view: re-home map, Ads matrix, COO matrix and metric definitions.

**Rendered proof:** a Playwright drive ran 2,531 layout checks. It covered four Solo sizes, three PAIGE modes,
two themes, two data states, Content A and B, both ad states, every tab and Ads sub-view, campaign detail, the
panel, every old link and the workspace switch. Results: 0 overflow and 0 script errors (the only console error
is the font host's certificate in this sandbox).

**Mocked:** everything populated, every provider value and every write.

## L. Implementation sequence (after owner approval)

1. **S1: Lead capture and Content retire (UI, after approval).**
   - Overview gains capture points, recent leads and the rebuilt attention list (reading routing columns **or**
     automations, fixing C).
   - One form panel opens from Overview, Campaigns and Analytics via `?form=`.
   - Compatibility redirects cover every old address in E/F, and Content's `humanSurface` is repointed.
   - The Ads desk ships with Creative and the honest not-connected state, and the false Ads copy is fixed.
   - Same PR: tier matrix rows L519/L521, master reference L1220/L1245 and the decision log (§66/§0).
   - Proof: render drive at four sizes, the unit tests, and a live-drive update.
2. **S2: Marketing metric producer (backend, with INT-340).**
   - `_marketing_metric_bundle` with the LIVE and PARTIAL keys from H.
   - Analytics and Overview consume it; browser-side KPIs are removed.
   - Email rates move server-side, coordinated with the email dashboard.
3. **S3: Campaign ↔ asset link (backend, needs owner approval as a new table).**
   - Pages, forms, funnels, email campaigns and series, and ad copy attach to a brief.
   - Campaigns shows real composition.
4. **S4: Capture events.**
   - A `form.submitted` native event and §67 trigger.
   - Wire `growth_funnel_session_upsert`.
   - A tenant-scoped public-route view producer, which reopens Content B.
5. **S5: Ads read (owner provider choice + backend).**
   - Connection, adapter, insight store, `ads.read` key and receipts.
   - Ads writes come later, through M1 and approvals.
6. **S6: Social posting**, when the provider is proven (outside this lane's first slices).
