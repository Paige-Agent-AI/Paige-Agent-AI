# INT-342 Marketing Department convergence: grounding, recommendation and prototype (first return)

**Status:** APPROVED by the owner on 2026-10-10 ("Much better I can green light what you created"). The approval covers prototype version 2 as built:
- the seven tabs;
- Lead capture re-homed;
- Content retired (option A, as recommended);
- the Overview chain;
- the campaign map;
- the Ads desk;
- the Analytics funnel.

The approved design is frozen (§28) and is now implemented in slices (L).

**Amended by owner ruling, same day ("Keep Content for now"):** all 17 production `marketing_content` rows
have `work_id` null, so none appears in Vibe Studio and retiring Content would hide them. Content stays a tab
until Vibe Studio lists every saved piece, then retires as F describes. The tab strip is therefore eight tabs
for now: Overview · Campaigns · Audience · Content · Social · Email · Ads · Analytics. The ad provider to read first was not ruled; Meta Ads is the recorded default, and it matters only at slice S5.

**Amended by owner ruling, 2026-10-10 (Linear ANT-15): Ads is its own department.** Ads left the Marketing strip and
is now a first-class Solo main-navigation destination directly below Marketing, at `/solo/{account}/ads/{view}`.
Marketing keeps seven tabs: Overview · Campaigns · Audience · Content · Social · Email · Analytics. This supersedes
only the earlier Ads-inside-Marketing placement; the approved desk design and everything else in Marketing are
unchanged. The north star, the Capability Integration & Proof Matrix and the build sequence after the move are in **M**.

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
| Ads | `MarketingAds` (`marketing-planned.tsx:170` at grounding; since S1c `marketing-ads.tsx`) | `marketing_content` where `channel='ad_copy'` | none | ad-copy list + "not yet" list |
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
  RPC that is never called. *(2026-10-12: MBC slice 7a records tenant-scoped visits and wires the funnel-session
  writer — `docs/delivery/public-visit-evidence-contract.md`; the figures are slice 7b.)*
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

**2026-10-11 (MBC slice 2a):** the producer below is built as specified, with two deliberate departures recorded in
`docs/delivery/marketing-metric-server-contract.md`: untagged leads are an item of the source distribution (so it is LIVE,
not PARTIAL), and failed/stalled submissions are one distribution (stalled = waiting more than 15 minutes).

**2026-10-11 (MBC slice 2b):** Analytics consumes four of the keys for owners/admins (leads received, by source tag, by
campaign tag, converted to opportunity), through `parseMetricResult`, for the range and the period before. The browser no
longer computes those figures for an owner; it still draws the trend, outcome ring, capture points and heatmap from its
own read, and a member (refused by the server) keeps the browser's counts. The daily series and the snapshot/email keys
are produced but not yet drawn from the server; that is slice 6's Chat/Live work and later Analytics passes.

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
  *Corrected 2026-10-12 (Experience 03 S1, #2068, once released): each new lead (form submission) carries
  the campaign it came from (`campaign_brief_id`, `campaign_attribution`), and its contact and opportunity are
  reached through the lead. Contacts and deals themselves still carry no campaign; leads saved before the
  release are not evaluated.*
- **Campaign management:** a campaign ↔ asset link and a roll-up metric.
- **Lead routing:** a `form.submitted` §67 trigger and Rail kind.
- **Learning:** every marketing capability has `mindBinding: UNAVAILABLE`.

**What the COO can answer today, from evidence:**
- **Which campaigns are active?** None: 1 draft brief and 1 draft email.
- **Which leads came from which campaign?** Cannot answer (no link, 0 submissions).
  *Corrected 2026-10-12: answerable for leads captured after #2068 is released, through
  `get_campaign_brief_leads`; production still holds 0 submissions.*
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

**Where:** https://claude.ai/artifact/7jwwBxRswrCAPxQiZqc6RG (version 2). The record copy is in `docs/prototypes/`.

**Owner feedback on version 1 (2026-10-10):** the owner flagged repeated titles and asked for more impact: "if someone is already inside of a menu tab that already says 'marketing' then we do not need a banner to repeat the word … Ask yourself does this say WOW! If not then redo it." Version 2 is that redo.

**No page titles.** Each view opens on a one-line live summary, for example "26 leads in the last 30 days, and 11 became opportunities in Sales", with its actions beside it. This also honours the earlier owner ruling of 2026-10-04 ("no header").

**Overview opens on the Marketing chain:** live capture points → leads → routed → opportunities (Sales).
- The break in the chain is lit and fixable in one click. In production today that break is "0 of 4 forms route leads".
- Below the chain:
  - a hoverable 30-day lead-flow chart with its sources;
  - "Needs you", ordered by urgency;
  - a gallery of capture points with miniature previews;
  - recent leads.
- When there are no leads, "Needs you" leads and the chart says zero plainly instead of showing a blank.

**Campaigns:** the list shows each campaign's progress through the seven INT-298 stages. A campaign opens to:
- a stage stepper (solid / half / hollow is what records show);
- a campaign map in three lanes, Reach → Land → Brought in, that flows into leads and opportunities;
- the brief;
- the next step.

**Ads:** a spend-pacing picture keeps actual spend, the provider's budget and the brief's planned budget visibly apart.
- The planned budget is shown as written, never as spend.
- ROAS is withheld with its reason.
- Creative shows how each ad would read.
- States: not connected (with a route to Integrations), connected (proposed), and connected but the read is failing (out of date, reconnect).

**Analytics:** a stepped funnel (lead → tagged → matched to a campaign → opportunity), a source-coverage bar, capture points and channels.
- Every metric is tagged PROPOSED until the marketing producer exists.
- Members see an owners-and-admins access state.

**Old links:** eleven, each resolving with its intent. A form id missing from the current workspace says so, and the brand kit and builders links offer Vibe Studio.

**Also kept from version 1:** PAIGE closed, docked, expanded and overlay; the data states; workspace switch; both themes; reduced motion; the maps view.

**Independent non-author review of version 1.** Every finding is folded into version 2:
- **Two blocking:**
  - The Ads connection leaked across a workspace switch.
  - Values were tagged LIVE that production does not have: the Analytics tiles, the brief budget, and PAIGE's capability panel.
- **Should-fix items:**
  - the wrong brief link in Ads;
  - pause and resume that looked immediate (now "Request pause…");
  - silent old-link loss;
  - mock numbers that contradicted each other;
  - false copy (deals only from routed forms; Meta as the only catalogue entry; Social connection as live);
  - view-only gaps;
  - focusable links and real form controls;
  - focus return to the opener;
  - an uneven Content A/B presentation, now argued in the harness rather than inside the product.

**Product-token findings.** These belong to the existing Solo tokens, not this prototype. They are recorded here for a product-wide fix:
- **Gold text on the `btn-g` fill is 2.72:1 in Mineral,** which fails AA. §11 says gold used as text must use a dark gold. The prototype uses a proposed `--gold-ink` (#7A4E05).
- **`--ink-3` small text is 3.6–4.2:1 in Mineral,** depending on the surface.
- **Gold marks the selected tab and the active rail item,** which §11 reserves for the act or approve moment.

**Rendered proof:**
- A Playwright drive ran 3,732 layout checks.
  - Coverage: four Solo sizes; PAIGE closed, docked and expanded; both themes; production-like and populated data; Content A and B; three ad states; every tab and Ads sub-view; campaign detail; the form panel; every old link; and the workspace switch.
  - Results: 0 overflow and 0 script errors. The only console error is the font host's certificate in this sandbox.
- Key frames were inspected by eye.

**Mocked:** everything populated, every provider value and every write.

## L. Implementation sequence (after owner approval)

1. **S1: Lead capture retires (UI, after approval).** Content retirement waits on Vibe Studio listing every
   saved piece (owner ruling 2026-10-10). Split: **S1a** (shipped first) is Overview, the form panel, the
   compatibility redirects, the routing fix and the Ads copy; **S1b** is Campaigns' map and stepper; **S1c**
   the Ads desk; **S1d** the Analytics funnel UI. **Order amended by owner ruling 2026-10-10** ("I'm not sure
   why we are going back to improve this before we do Ads and Analytics that have no UI/UX at all", then
   "before Campaigns we need to reimagine Content subtab"): **S1d → S1c → S1e (Content reimagined) → S1b**.
   The same day the owner approved the read-only Meta Ads backend after the desk ("Desk now, Meta read
   next"): **S5** below, read only, no write, spend, pause or budget change.
   - **S1d as shipped:** range Week · Month · Quarter (the prototype's Year is left out: the email read serves
     7, 30 or 90 days and a year of leads would mostly overflow the 200-row submissions read); "the last N
     days" instead of "this month" (a rolling window, the same as Overview's); Analytics stays readable by
     members (the prototype showed members an owners-and-admins message; Overview already shows members the
     same lead counts) while the email row tells a member its figures are for owners and admins; the
     campaign-tag list is kept from the earlier Analytics (§58).
   - **S1d shipped** (#1913, 2026-10-10) and, on the owner's word ("Analytics HAS to be more visual than anything
     else we have done"), carries headline figures with sparklines, leads over time, outcome, source and form rings,
     a weekday × hour heatmap and the email rates chart on top of the approved funnel.
   - **S1c as built:** the desk says "Paige can't read an ad account yet" rather than the prototype's "No ad account
     connected", because Meta or Metricool can be connected in Integrations while nothing reads them; the preview
     header reads "Your business" (no tenant-name read added for a mock frame).
   - **S1c shipped** (#1927 → `c710ec3`, 2026-10-10, live on paigeagent.ai).
   - **S1e shipped** (#1931 → `6a285f5`, 2026-10-10, live on paigeagent.ai).
   - **2026-10-11 coordinator command (owner-authorized):** Ads leaves Marketing for its own top-level department
     and a dedicated Ads agent; this plan's Ads desk (S1c) and S5 Meta read now belong to that agent. Marketing
     Analytics drops its Ads channel row and Open Ads (MBC slice 1); paid leads stay attributed by source tag.
     The backend completion slices (metric producer, campaign/asset links, capture events, action contract,
     Chat/Live) follow in that order under INT-298.
   - **S1e as built** (owner ask 2026-10-10, no prototype stage: pre-launch §4, frames shown on delivery): Content
     is a gallery of the saved library, each piece shown as itself (an image its picture, a document its cover from
     its blocks, copy its words, ad copy its headline and call to action), a ring of kinds, published work from Vibe
     Studio, a kind filter in `?kind=` and a wide preview in `?piece=` (Download, Print / Save as PDF through the
     Studio's own renderer, Copy text, draft-first Revise with PAIGE). Video has no preview yet and says so.
   - Overview gains capture points, recent leads and the rebuilt attention list (reading routing columns **or**
     automations, fixing C).
   - One form panel opens from Overview, Campaigns and Analytics via `?form=`.
   - Compatibility redirects cover every old address in E. Content's `humanSurface` stays until Content retires.
   - The Ads desk ships with Creative and the honest not-connected state, and the false Ads copy is fixed.
   - Same PR: tier matrix rows L519/L521, master reference L1220/L1245 and the decision log (§66/§0).
   - Proof: render drive at four sizes, the unit tests, and a live-drive update.
2. **S2: Marketing metric producer (backend, with INT-340).**
   - `_marketing_metric_bundle` with the LIVE and PARTIAL keys from H.
   - Analytics and Overview consume it; browser-side KPIs are removed.
   - Email rates move server-side, coordinated with the email dashboard.
3. **S3: Campaign ↔ asset link (backend, needs owner approval as a new table).** Authorized by the coordinator command
   (owner-authorized, 2026-10-11) and built as MBC slice 3: `campaign_brief_asset_links` and the dossier's Reach and
   Land lanes (`docs/delivery/campaign-asset-links-contract.md`). The roll-up metric per linked piece is still to come.
   - Pages, forms, funnels, email campaigns and series, and ad copy attach to a brief.
   - Campaigns shows real composition.
4. **S4: Capture events.**
   - A `form.submitted` native event and §67 trigger. Built as MBC slice 4a
     (`docs/delivery/form-submitted-event-contract.md`): once per submission matched to a contact, ids and tags only.
   - Wire `growth_funnel_session_upsert`. Built as MBC slice 7a.
   - A tenant-scoped public-route view producer, which reopens Content B. Built as MBC slice 7a
     (`docs/delivery/public-visit-evidence-contract.md`); the figures (visits, visit conversion, funnel step-through)
     are slice 7b through the INT-340 seam.
   - **S4b: Marketing Action contract (coordinator §4 M-A1).** Built as MBC slice 5
     (`docs/delivery/marketing-action-contract.md`): the action stays the bus's `paige_actions` row; a
     `campaign_brief_actions` link names its campaign, tactic, family, dependency, expected result, outcome and
     evaluation; the lifecycle is derived on read. The Campaigns dossier view and Chat/Live tools are slice 6.
   - **S4c: process scope (MBC 6a).** A process on `form.submitted` goes live only for one form, several forms
     or one campaign (`docs/delivery/process-scope-contract.md`).
5. **S5: Ads read (owner provider choice + backend).**
   - Connection, adapter, insight store, `ads.read` key and receipts.
   - Ads writes come later, through M1 and approvals.
6. **S6: Social posting**, when the provider is proven (outside this lane's first slices).

## M. Ads as its own department: north star, Capability Integration & Proof Matrix, sequence

**Owner rulings, 2026-10-10:**
- **Relocation (Linear ANT-15).** Ads leaves Marketing and becomes a first-level destination directly below it.
  The existing desk is rehomed, not rebuilt.
- **Mandatory One-PAIGE integration (permanent North Star).** Every PAIGE department and capability uses the
  one PAIGE operating architecture. Chat and Live consume the same canonical capabilities. **The Ads department
  cannot be called end-to-end operational until the shared capabilities and the Chat/Live paths below are built
  and verified.** The navigation move can ship on its own.

### M1. What moved, and what did not (Phase A, this slice)

**Routing:**
- The registry branch `ads` (`src/lib/routing/tierBranches.ts`) sits directly after `growth` (Marketing). Its five
  views are subtabs: `overview` (default) · `campaigns` · `creative` · `audiences` · `performance`.
- Rail: `SOLO_SHELL_DESTINATIONS` gains `Ads` (Target icon) after `Marketing`
  (`src/components/tenant-shell/tenantShellRoutes.ts`). Visible only in the authenticated Solo menu; the five-home
  tenant menu (sub-account, agency) gains nothing, consistent with Marketing.
- Route owner: `src/solo/AdsWorkspace.tsx`, mounted in `SoloApp.tsx` (`screens.ads`, keyed to the active
  workspace).

**What did not change:**
- The desk itself (`src/solo/marketing-ads.tsx`, `marketing-ads.css`): its reads, read policy, Ask PAIGE prompts
  and not-read states are byte-for-byte the shipped S1c behaviour.
- **Old addresses:** `/solo/{n}/growth/ads[?view=X]` replaces into `/solo/{n}/ads[/X]` before any Marketing reader
  mounts (`legacyAdsRoute`, `src/solo/ads-routing.ts`).
  - Tracking tags (`utm_*`) and the hash travel with it; nothing else does.
  - An unknown view lands on Overview.
  - A `?view=` on the new address lands on that view's path.
- **Links:**
  - Marketing Analytics no longer links to Ads at all: Marketing removed its Ads row and "Open Ads" in #1952 (Marketing-owned file; Ads made no change there).
  - The desk's links out (Integrations, Marketing › Campaigns, Audience, Analytics) point at the owning
    department's canonical address.
  - Nothing else linked to `growth/ads`: searched `growth/ads`, `"ads"`, `'ads'`, `onOpenAds`, `MarketingAds` and
    `Marketing › Ads` across `src` and `supabase/functions`.

**No data, permission, provider, spend or backend change.**

### M2. North star: Ads is paid-acquisition operations

Marketing owns demand-generation strategy, campaign briefs, offers and content. **Ads owns governed paid-media
operations and the deployment of advertising capital.**

The target, which is **not** operational today, is an owner able to say:

> "PAIGE, I have $2,500 for advertising next month. Evaluate the opportunities, recommend channels, prepare the
> campaigns and show me what needs approval."

PAIGE should then, in text or voice:
1. Understand the objective, offer, audience, timeframe and financial limits.
2. Read authorized ad accounts and actual performance.
3. Evaluate acquisition economics from attributed evidence.
4. Recommend a channel mix and allocation with explicit assumptions.
5. Prepare campaigns, ad sets, targeting and creative for inspection.
6. Obtain the financial, publication and policy approvals.
7. Execute approved provider actions through governed capabilities.
8. Verify provider acceptance and the resulting state.
9. Track spend, pacing and results.
10. Recommend adjustments within authorized policy.

**Recommendation authority is never spending authority.**

**Boundaries against duplicate systems:**

| Concern | Owner | What Ads does |
|---|---|---|
| Strategy and briefs | Marketing | Consumes canonical `campaign_briefs`; never a second campaign-definition system |
| Contacts and lead source | CRM (Clients) | Uses existing records where attribution evidence supports the link |
| Opportunities, closed revenue, collections | Sales | Consumes authorized projections; never invents revenue |
| Company accounting and expenses | Finance | Authoritative books stay there. Ads owns provider-reported spend and ad budget operations, reconciled to Finance where supported |
| Creative production | Vibe Studio | Remains the creative environment; Ads consumes campaign-ready creative |
| Conversation | PAIGE Chat and Live | One governed tool loop; no Ads chatbot or Ads action controller |

**What Ads must never create:** its own scheduler, approval engine, budget ledger, provider gateway, metric
warehouse or orchestration.

### M3. Capability Integration & Proof Matrix

**Grounding:** read-only, against `main` `82bd888` on 2026-10-10 (static code and migration read; the production
facts are from G, 2026-10-10).

**Status words:**
- **LIVE:** implemented and in use by the desk or by PAIGE today.
- **PARTIAL:** some of the path exists.
- **UNAVAILABLE:** nothing exists yet for Ads.
- **GATED:** must not be built without an owner or provider gate.

| Layer | Existing canonical contract | Implemented for Ads today | Missing | Owner | Evidence |
|---|---|---|---|---|---|
| Source records | `marketing_content` (channel `ad_copy`): RLS owner/admin, managing agency, platform owner; writer `save_marketing_content`. `campaign_briefs.budget_target` (owner text) via `get_campaign_briefs` / `configure_campaign_brief` | **LIVE (read):** the desk reads ad copy (owners and admins) and quotes a brief's budget as "a plan, never spend" | Ad-account connection, provider campaign / ad set / ad / creative records, dated insights, brief ↔ provider-campaign link. M1-b refuses `campaign_budget_usd` because ad accounts are external ids | vibe-studio (content save), campaign-brief-system (briefs), INT-342 (Ads data model, S5) | `marketing-ads.tsx:33-39,98,142`; `20261225000000_solo_campaign_briefs_foundation.sql:28`; `20270103000000_re2_m1b_scope_caps.sql:42-48` |
| Spine | `_shared/paige-spine/registry.ts` (`PAIGE_SPINE_CAPABILITIES`), capability kit, `paige_action_kinds` | **PARTIAL:** `marketing_content.save` accepts `ad_copy` (maturity PARTIAL); `campaign.*` keys are planning-only | Any `ads.*` key (`ads.read`, and one per write); an ads action kind | Spine Change Request (`docs/architecture/paige-spine-foundation.md:152`); keys proposed by INT-342 | `_shared/paige-spine/domains/marketing_content.ts:28-33`; `domains/campaigns.ts:24,30`; no ads domain in `registry.ts` |
| Harness | One Paige Runtime Harness; departments are domains, never their own Harness | **UNAVAILABLE** for Ads | The Ads path Harness → Spine → Trust → approval/autonomy → adapter → readback → Rail | Master §Harness; INT-342 for the Ads domain | `docs/PAIGE-MASTER-PROJECT-REFERENCE.md:240,256-262`; `docs/delivery/harness-completion-map.md` |
| Orchestration | Action bus (`paige_action_kinds`, `paige_departments`), `delegate_to_subagent`, `_shared/durable-job`, `_shared/paige-orchestration` | **UNAVAILABLE** | Provider sync job, ads action kinds, routing of ads work to a specialist inside the Harness | Durable work program (Master :513) | grep for `ad_copy`, `ads`, `meta_ads`, `ad_spend` and `paid` in those dirs: zero |
| Trust | `_shared/action-risk.ts`, `paige_pending_confirmations`, `auto/confirm/off` lanes, Trust Compass ceiling, M1 grant scope (`ad_account`, `campaign_id`) | **PARTIAL:** the ad-copy save is confirm-gated; drafting is exempt by owner ruling 2026-10-04 | A high-risk class for ads writes, an ads approval type, M1 reserve → confirm → reconcile for spend | Trust / M1 program | `_shared/action-risk.ts:338,614-617`; `20261230000000_re2_execution_substrate.sql:61-66` |
| Rail and receipts | `record_capability_run`, `_shared/capability-record.ts` | **LIVE (ad copy only):** a `content_save` receipt, "Saved your marketing copy" | Receipts for provider sync and every ads write | Receipt/Rail contract owner (`docs/brain/paige-receipt-rail-contract.md`) | `scripts/ci/receipt-coverage-ledger.json:417-421`; `20270548000000_studio_publish_autonomy_catalogue.sql:81` |
| Metrics and evidence | `paige_llm_trace`, `platform_metered_events` (M1 metering), INT-340 evidence bundle | **PARTIAL:** "Leads on your forms" by tracking tag (counts only, in Analytics). Gap: `content-draft` traces carry no tenant (no trace context), so ad-copy drafting skips the per-tenant budget gate | Provider spend, impressions, clicks, CTR, CPL, ROAS producers; ROAS stays withheld until click → lead → deal → payment is linked | INT-340 (metric contract), INT-342 | `content-draft/index.ts:93`; `_shared/model-router.ts:210,261`; `marketing-analytics-model.ts:108-121` |
| Mind | Mind domains (`mind-orb/mindDomains.ts`), `SoloMindWorkspace` | **UNAVAILABLE:** `marketing_content.save` declares `mindBinding: UNAVAILABLE` | An eligibility decision for ads objectives and results as Mind facts (owner-confirmed only) | Mind program | `domains/marketing_content.ts:32`; no ads hits in `SoloMindWorkspace.tsx` |
| Memory | `paige_owner_memory`, `paige_prompt_memory` | **UNAVAILABLE** | Owner-confirmed, source-backed ads learnings only (never raw provider data) | Memory program | no ads hits in `session-memory.ts`, `owner-context.ts`, `paige-context/` |
| Knowledge / Second Brain | Workspace knowledge; repo `docs/brain/` | **PARTIAL:** brand voice from `tenants.brand` feeds ad-copy drafting | Ads playbooks and policy knowledge as tenant-scoped knowledge | Knowledge program | `content-draft/index.ts:70-73` |
| Model / Intelligence Fabric | `_shared/model-router.ts` (`routedChatCompletion`, `callModel`), `_shared/model-fabric.ts` | **LIVE:** ad copy drafts on `internal_first_draft` then a voice polish; the ad_copy guide fixes headline, primary text and CTA | Ads reasoning tasks (allocation, pacing) routed through the fabric with tenant attribution | INT-334 | `content-draft/index.ts:25,90-111` |
| Agent intelligence | `paige_skills`, `paige_subagents` | **PARTIAL:** skill `ad_copy_draft` (draft/confirm). Skill `ad_spend_efficiency` (read-only) exists but has no data source, and is required to say so | A data source for `ad_spend_efficiency`; no ads specialist (the content drafter covers email/SMS/social) | INT-280 (PAIGE Intelligence) | `20260902000000_skills_s2_cat5_marketing_content.sql:87-94`; `20260903000000_skills_s2_cat6_analytics_interpretation.sql:90-96` |
| PAIGE Chat | `paige-ai-chat` governed tool loop; `paige:open` → `handOffPaigePrompt` (prefill only, never sends) | **LIVE:** `draft_marketing_content` (channel `ad_copy`) and `content_save`; the desk's "Ask PAIGE for ad copy" and "Revise with PAIGE" prefill the composer (unchanged by the move) | Any ad-platform tool; a connected generic MCP (Meta Ads, Metricool tiles) does not reach chat | Chat runtime owner; INT-342 for ads tools | `paige-ai-chat/index.ts:6977-7006,13796,14002-14018`; `src/lib/paigePromptHandoff.ts:7-35` |
| PAIGE Live | `paige-live-relay` streams through the same `paige-ai-chat` loop and never executes a spoken approval | **PARTIAL:** Live can draft ad copy (approval-exempt). It cannot redeem the confirm-gated save (confirmation redemption is skipped in Live scope). Live ships closed; INT-346 is DRAINING | Live reaches ads capabilities only when Chat does, through the same keys; a spoken approval path, if ever, is a Live-program decision | INT-346 | `paige-live-relay/index.ts:11-12`; `paige-ai-chat/index.ts:9507,9791-9794` |
| Provider adapters | Integration Capability Registry; `meta` entry PARTIAL (read/draft lane, publish UNAVAILABLE, M1 required for spend) | **UNAVAILABLE:** `meta-get-insights` and siblings are retired stubs (503 `social_capability_unavailable`); Google Ads appears only as a Zapier hint; no Metricool or Google Ads registry entry | One provider-neutral Ads capability contract with per-provider adapters (Meta first, subject to owner-approved scope) | Growth/Social workstream (Meta), INT-342 | `docs/integration-registry/integration-capability-registry.json:1781-1832`; `_shared/socialUnavailable.ts:12-27`; `settings-integrations-gateway.tsx:83,85,108` |

**Truth note:** `src/solo/systems.tsx:16` is a fixture that says "Meta — active, $40/day cap". It is imported only
by `healthmap.tsx`, which nothing imports, so no customer sees it. Searched: imports of `./healthmap`, `./systems`
and `SC_CHECKS`. Delete it in a later cleanup; never revive it.

### M4. The Ads Chat/Live contract (future; unavailable or gated today)

**Shared contract:** Chat and Live call the same `ads.*` Spine capabilities, with the same records, approvals,
receipts and execution authority. Live is a modality over the one loop, never a second implementation
(`docs/doctrine/paige-modality-neutrality.md`).

| Act | Capability (proposed) | Authority | Today |
|---|---|---|---|
| Inspect authorized ad accounts and performance | `ads.read` (sync and query) | Low risk, Rail receipt per sync | UNAVAILABLE (no adapter or store) |
| Reason about objectives and economics | Fabric task over source-backed evidence, through INT-340 metric keys | Read-only | UNAVAILABLE (no provider evidence) |
| Propose a budget and campaigns | Draft records linked to a `campaign_briefs` row | Draft-first; never spend | UNAVAILABLE |
| Obtain approval | Trust high-risk class, ads approval type, M1 reserve | Owner approval; Live never redeems a spoken approval unless the Live program rules otherwise | GATED |
| Execute: activate, pause/resume, budget, targeting, publish | One `ads.*` key per write, provider idempotency, M1 confirm | Approved and bounded; respects provider ad policies, including special categories (credit, housing, employment); never circumvented through targeting, account structure or misclassification | GATED |
| Verify and report | Provider readback, M1 reconcile, Rail receipt, truthful text or voice outcome | What actually happened only | GATED |

**Today's conversational handoffs are preserved:** "Ask PAIGE for ad copy" and "Revise with PAIGE" prefill the
composer, and PAIGE drafts and saves ad copy draft-first. Nothing runs, pauses, pays for or publishes an ad.

### M5. Sequence after the move

Each phase sets direction only. None authorizes provider activation, extra engineering lanes or money movement.

1. **A. First-class department UI.** This slice: relocation, links, redirects, documentation.
2. **B. Read-only paid-platform intelligence.**
   - Meta Ads first, subject to supported API permissions and owner-approved connection scope.
   - Later candidates: Google, LinkedIn, TikTok and YouTube Ads.
   - One provider-neutral contract, separate adapters, tenant-scoped account identity, and dated campaign / ad set
     / ad / creative / insight records.
   - A generic MCP connection is not an authorized Ads capability.
   - This is S5 in L.
3. **C. Performance and attribution.**
   - Provider spend and campaign evidence first, then responsibly attributed CRM leads and Sales outcomes.
   - These stay distinct: owner-planned budget · authorized platform budget · provider-reported spend ·
     provider-reported leads · CRM-attributed leads · confirmed Sales conversions and collected revenue.
   - Unknown values stay unavailable.
4. **D. Governed execution.**
   - Every write is its own `ads.*` capability: Trust approval, bounded Harness execution, M1 spend and budget
     controls, provider idempotency, authoritative readback and a Rail receipt.
5. **E. Bounded autonomous optimization.**
   - Runs only under specifically authorized autonomy policies (§67/§68: granted to a process, decaying, never
     permanent), with budget ceilings, stop and rollback conditions, audit and measured outcomes.

**Operational status of the Ads department (2026-10-10):**
- The new department navigation (menu item, five view addresses, old-link redirect): **PROOF OWED**. Automated
  contracts and a local rendered harness pass; authenticated runtime is **UNVERIFIED** until a signed-in Solo
  session opens it (§32.c). Binding Ledger row `ads.department` = `PROOF_OWED`.
- The desk and its ad-copy handoffs are the same code Marketing shipped; the move changes no read, policy or
  handoff. Their behaviour on the new route is **UNVERIFIED** in an authenticated session. The matrix's LIVE
  cells above describe those existing contracts, not authenticated proof of this route.
- Provider read, attribution, approvals, execution, Chat/Live ads capabilities: **UNAVAILABLE or GATED**.
- **The department is NOT end-to-end operational.**

## N. Marketing Capability Integration & Proof Matrix

Coordinator command 2026-10-12, items 2–3 ("Complete the Marketing Capability Integration & Proof Matrix,
distinguishing source shipped, production verified, authenticated tested and owner accepted"; "identify remaining
genuine feature gaps"). This is Marketing's own matrix; the Ads matrix is §M3 and stays with the Ads department.

**Grounding:** main at the 7a merge (`be8d9278`), 2026-10-12. Production facts are read-only queries (Supabase project
`xygzykjyynhzqytbqnzu`) run at each slice's release and again for this section.

**The four columns:**
- **Source shipped:** merged to `main` (PR → merge commit).
- **Production verified:** the migration is recorded on production and the objects it creates were read back, the
  edge function deployed (the `edge-live` tag at the merge), or the Vercel production deployment READY with the new
  strings in the served bundle. Done by the engineering agent; not re-probed independently unless noted.
- **Authenticated tested:** a real signed-in Solo user drove it on production (§32.c). **No row has this yet**:
  the canonical QA account (PC-1 QA Shared Synthetic, ANT-21) has no runner credential installed. The packet is
  `docs/delivery/marketing-s3-6-acceptance-package.md`.
- **Owner accepted:** the owner accepted the working capability. **No row has this yet.** Where the owner approved a
  *design* (prototype) before it was built, that is said separately, because it is not acceptance of the capability.

### N1. Capabilities

| Capability | Source shipped | Production verified | Authenticated tested | Owner accepted |
|---|---|---|---|---|
| Marketing Overview, Analytics and Content tabs (INT-342 S1a, S1d, S1e) | #1900, #1913, #1931 | Vercel READY (S1a `dpl_D5qp…`, S1d `dpl_GhiL…`, S1e `dpl_F9RE…`) | UNVERIFIED | Designs approved 2026-10-10; capability not yet accepted |
| Analytics owns its figures; Ads moved out (MBC 1) | #1952 → `bb0e98f` | Vercel READY `dpl_5fpJ…` | UNVERIFIED | — |
| Marketing metric producer on the INT-340 seam (MBC 2a) | #1953 → `64a646f` | `20270602000503` recorded; functions and dispatcher branch read back; no grants | UNVERIFIED | — |
| Analytics server figures (MBC 2b) | #1957 → `893c6e2` | Vercel READY `dpl_m26e…` | UNVERIFIED | — |
| Overview server figures and processing health (MBC 2c) | #1966 → `7231c3a` | deployed with 4a | UNVERIFIED | — |
| What a campaign uses: pages, forms, funnels, emails, content (MBC 3) | #1963 → `8d64128` | `20271020000010` recorded; table, functions, trigger, retirement disposition read back | UNVERIFIED | — |
| `form.submitted` on the native event bus (MBC 4a) | #1966 → `7231c3a` | `20271020000030` recorded | UNVERIFIED (ANT-87 asks for: a process matches once; a paused account is refused) | — |
| Marketing Action contract: a step is the bus's own `paige_actions` row (MBC 5) | #2018 → `d0aaeac` | `20271021200000` recorded; table, guard, indexes, functions, kind, disposition read back | UNVERIFIED | — |
| Process scope; a recorded-only step can never read as an accepted result (MBC 6a) | #2038 → `a60d1ffb` | `20271022100000` recorded; four functions, trigger enabled, `campaign_brief_ids` in the payload, NOT_PROVEN refusal, `finish_counts` read, 0 automations affected | UNVERIFIED | — |
| Campaign dossier: Steps and results (MBC 6b) | #2045 → `0c1cbb91` | Vercel `dpl_8KwK…` READY on paigeagent.ai; the served bundle carries the new strings | UNVERIFIED | — |
| PAIGE tools for steps and process scope, Chat and Live (MBC 6c) | #2050 → `16fb9adf` | `20271023100000` recorded; read wrappers authenticated-only; four Autonomy rows, ask first; activity wording; `paige-ai-chat` deployed (`edge-live` = merge) | **UNAVAILABLE on typed Solo chat** while INT-346 is DRAINING (production `paige_chat_interactive_protocol` = version 2, `active: false`, 2026-10-12): every typed turn runs with no tools. Live: UNVERIFIED | — |
| A lead carries the campaign it came from; a campaign reads its leads (Experience 03 S1, `docs/delivery/exp03-grow-my-business-journey.md`) | #2068 | owed at release (`deploy-migrations`, migration `20271025100000`, then read back) | UNVERIFIED (PC-1 blocked, ANT-21) | — |
| Public visit evidence (MBC 7a) | #2064 → `be8d9278` | see N4 | UNVERIFIED (a signed-out visit is part of the packet) | — |
| Email: campaigns, dashboard and editor, chat tools, series (E1, E2, E2b, E3) | #1700, #1704, #1725, #1731 | recorded and read back at release | UNVERIFIED | — |

### N2. One-PAIGE layers (Marketing)

| Layer | What Marketing uses | Status | Gap |
|---|---|---|---|
| Source records | `campaign_briefs`, `campaign_brief_asset_links`, `campaign_brief_actions`, `growth_*`, `growth_public_visits`, email tables | LIVE | — |
| Spine | Domain `marketing_actions` (6c): reads are member seat, writes workspace admin; `campaign.*` brief keys | LIVE in source | Registration was written by Marketing in 6c; P-ANT-5 names Platform Reach as the exclusive shared-registry writer. Raised with Platform Reach (N3, item 6) |
| Harness | The one chat runtime (`paige-ai-chat`); Live is the same runtime | PARTIAL | Typed Solo turns carry no tools while INT-346 is DRAINING (Conversational Loop owner; admission is owner-reserved) |
| Orchestration | The action bus: `file_action`, `marketing.campaign_action` (record-only, needs approval) | PARTIAL | Nothing in the product prepares a planned step for approval (N3, item 5) |
| Trust | `action-risk.ts` (plan, record, judge ordinary; process scope high); four Autonomy rows, ask first | LIVE | — |
| Rail and receipts | `recordCapabilityRun`: one receipt per change, keyed to the change | LIVE | — |
| Metrics and evidence | INT-340 producer: leads, sources, campaigns, opportunities, live and unrouted forms, failed submissions, email | LIVE | Visits, visit conversion and funnel step-through: 7a records the evidence; the figures are 7b (needs INT-340's dispatcher allowlist, Linear ANT-23) |
| Mind / Memory / Knowledge | none | UNAVAILABLE | No eligibility decision for campaign results as Mind facts; owner-confirmed only if ever |
| PAIGE Chat | Six 6c tools; brief tools; email series tools | PARTIAL | Unreachable on typed Solo turns (Harness row) |
| PAIGE Live | The same tools through the same runtime | PARTIAL | The relay never executes a spoken approval, so in Live a write can be proposed; its confirmation is the card, never a spoken yes |
| Provider adapters | Email delivery (managed route) | LIVE for email | No ad, social or analytics provider here (Ads department) |

### N3. Genuine feature gaps (filed in Marketing's lane; nothing widened, nothing activated)

1. **Link an existing action to a campaign.** The writer accepts `link_action` (slice 5) but no screen or chat tool
   sends it. Adding it is a writer-backed screen control and a chat tool; no permission change.
2. **Change a step's dependency.** The writer sets one only when a step is planned or linked (`dependsOnActionId`);
   there is no command to change it later, though the integrity trigger already validates an update. Needs a `set_dependency` command
   in the writer, then a control.
3. **A member's view of a step.** Members already see each step's aim and its result and judgement (once
   finished), but not its title, summary, approval id or error: `get_campaign_brief_actions` withholds those four
   from anyone who is not a workspace admin, on purpose. Showing titles to members is a read-policy decision for the
   owner; it is **not** being widened.
4. **A governed process activation screen.** A process can be switched on only by a direct table update today; chat
   refuses (`automation_set_state` is owner-only and unadvertised) and no screen does it. The scope guard already
   refuses an unscoped form process on every path. The screen needs an owner-approved design (§00) and an audited
   seam; nothing is activated until then.
5. **Moving a planned step to approval.** A planned step (`filed`) reaches approval only when the bus prepares it
   (`advance_action` to `drafted`). The action worker never drafts this record-only kind, and the chat tool
   `action_advance` is for the platform team. So in the product a Solo owner can plan a step but cannot bring it to
   approval or completion. Needs a governed "prepare for approval" path for record-only campaign steps.
   **The shipped copy promises it anyway**, so today it says something untrue:
   - the plan form: "A planned step waits for your approval." (`src/solo/campaign-actions.tsx`);
   - the empty state: "Plan the first one; it waits for your approval.";
   - the remove warning for a planned step: "will still come to you for approval" (`useCampaignActions.ts`);
   - PAIGE's plan receipt: "It comes to you for approval once it is prepared" (migration `20271023100000`);
   - PAIGE's approval card for planning a step: "comes to you for approval once it is prepared"
     (`supabase/functions/paige-ai-chat/index.ts`);
   - the plan tool's description and result, which PAIGE repeats: "comes to the owner for approval once it is
     prepared" (`_shared/paige-spine/registry.ts`, `_shared/campaign-steps-chat.ts`);
   - the action kind's description: "Once prepared it goes to the owner for approval" (migration
     `20271021200000`).
   This is the first Marketing fix after this matrix: either build the prepare-for-approval path or make the copy
   say what happens now. The QA run records the sentences as a finding (packet A4), never as a pass.
6. **Shared registration and admission.**
   - 6c's Spine and chat-tool registration were written in Marketing's lane. P-ANT-5 names Platform Reach (INT-179)
     as the shared registry's exclusive writer, so this is raised with Platform Reach for review rather than left
     silent.
   - Typed-chat admission is the Conversational Loop owner's (INT-346), and owner-reserved.

### N4. MBC 7a at release

- **Source:** PR [#2064](https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/2064) → `be8d9278`. All 12 checks
  green on the final head `6eb90726`, `database-contract` (which runs `supabase/tests/public_visits.sql`) included.
- **Production verified** (read-only, 2026-10-12):
  - `deploy-migrations` and `deploy-edge-functions` succeeded. `db-live` and `edge-live` both point at `be8d9278`,
    so neither migrations nor functions are ahead of production. `growth-public-visit` and `growth-public-submit`
    were deployed.
  - `20271024100000_int298_public_visits` is recorded in `schema_migrations`.
  - `growth_public_visits`: row security on, one policy (`growth_public_visits_tenant_read`), the six check
    constraints, 0 rows. `anon` has no SELECT; `authenticated` has SELECT, no INSERT.
  - `growth_form_submissions.visit_id` exists (uuid).
  - `growth_public_visit_record` and `growth_public_visit_for_submission`: SECURITY DEFINER with an empty
    `search_path`. Only `service_role` can execute them.
  - `growth_funnel_session_upsert`: `anon` and `authenticated` can no longer execute it; `service_role` can.
  - `operator_retirement_disposition('growth_public_visits')` = `delete`.
  - As `anon`, in a rolled-back transaction: reading the table, calling the writer and calling the funnel-session
    writer each fail with `42501`.
  - The deployed function, asked anonymously with requests that are refused before the rate limiter or any write:
    Do Not Track → `200 {recorded:false, reason:"privacy_signal"}`; Global Privacy Control → the same; a foreign
    origin → `403 origin_not_allowed`; a headless user agent → `200 {recorded:false, reason:"automated_agent"}`.
- **Not verified:** a real visit recorded from a real published page, and a submission linked to it. Production
  has 1 published page, 4 active forms, no active funnel and 0 submissions, but every one belongs to a real
  business, and a visit would write into that business's records. So the first recorded visit is left to the
  signed-out half of the acceptance run (packet run D), on the canonical QA account's own form.
