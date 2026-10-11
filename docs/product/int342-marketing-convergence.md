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

**2026-10-11 (MBC slice 2a):** the producer below is built as specified, with two deliberate departures recorded in
`docs/delivery/marketing-metric-server-contract.md`: untagged leads are an item of the source distribution (so it is LIVE,
not PARTIAL), and failed/stalled submissions are one distribution (stalled = waiting more than 15 minutes).

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
- Navigation, desk and conversational ad-copy handoffs: **LIVE**.
- Provider read, attribution, approvals, execution, Chat/Live ads capabilities: **UNAVAILABLE or GATED**.
- **The department is NOT end-to-end operational.**
