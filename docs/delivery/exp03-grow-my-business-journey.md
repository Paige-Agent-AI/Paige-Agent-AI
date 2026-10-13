# Experience 03 — Grow My Business: journey inventory, flow map and delivery plan

Date: 2026-10-12 · Journey Lead: Claude Code (one accountable lead) · Linear: ANT-51 (canonical journey record),
ANT-147 (integration), ANT-15 (Marketing), ANT-45 (Ads), ANT-21 (PC-1 QA) · Shell: SOLO

**Status: CHECKPOINT 1 — inventory and plan. Slice 1 implementation started on branch
`claude/stoic-archimedes-pv4r8u`.** Nothing here is owner-accepted. Every claim below names its evidence; absence
claims name what was searched.

Outcome: an owner tells PAIGE what customers they want and what result they need; PAIGE helps plan the campaign,
prepares the assets and capture path, the owner approves, prospects arrive in the right pipeline with their campaign
attached, follow-up runs under approval, leads move to opportunities and paying customers through Sales, and PAIGE
explains the real results against the goal.

## 1. Grounding (what was read, and when)

- `main` at `6f69e58e` (2026-10-12). Production project `xygzykjyynhzqytbqnzu`, read-only aggregate at 2026-10-12:
  - `campaign_briefs` 1 row (0 `active`); `campaign_brief_asset_links` 0; `growth_form_submissions` 0;
    deals with `source='paige_form'` 0; `growth_public_visits` 0.
  - `deals` attribution columns: `source` only. `clients`: `source`, `mirror_source` only. No campaign column anywhere.
  - Latest migration `20271024100000` (= main; zero drift).
  - `paige_chat_interactive_protocol()` = `{"version": 2, "active": false}` → INT-346 still DRAINING.
- **The journey has never run end to end on production.** No lead has ever been captured by a form.
- Docs read: master reference §0/§4 (INT-298 slices 1–7a)/§5/§7; `docs/product/int342-marketing-convergence.md` §I,
  §J, §N; `docs/delivery/marketing-s3-6-acceptance-package.md`; ANT-147 and ANT-51 (Linear, 2026-10-12).

## 2. Integration boundaries (from ANT-147 / ANT-51, owner records of 2026-10-12)

| Owner | Owns | Experience 03 consumes / hands to |
|---|---|---|
| Experience 01 (Codex lead, ANT-50) | Discovery interview; confirmed business profile in `tenants.brand->'business_brief'` (`get_solo_business_brief`, `save_solo_business_brief`) incl. free-text `goals90Day`, `successDefinition`, `currentPriority` | **Reads** the confirmed profile and declared goals; never writes them |
| Experience 02 (zCod lead, ANT-147) | Unified COO view; goals/targets/markers/variance; Operating Fabric business review (`composeBusinessReview`) | **Supplies** campaign, lead, attribution and conversion evidence through the INT-340 seam; no second goal store |
| Experience 03 (this) | Acquisition and conversion workflow integration | — |
| Sales/Payments (ANT-18/19) | `clients`, `pipelines`, `deals`, agreements, invoices, payments | Leads enter Sales only through existing writers; no new CRM, no deal schema change in slice 1 |
| Marketing (ANT-15) | `campaign_briefs`, asset links, campaign actions, forms/pages/funnels, visits, `marketing.*` metrics | Extended in place |
| Ads (ANT-45) | Paid acquisition desk; provider reads | Read-only reuse of `get_pipeline_lead_funnel`; **no ad spend exists to enable** |
| Conversational Loop (INT-346) | Typed-chat tool admission | **Blocker** for conversation-led execution (owner-reserved) |
| Platform Reach (INT-179, P-ANT-5) | Shared Spine/chat registry | New chat capabilities are raised there for review |

## 3. Capability inventory

WORKING = source shipped and its production objects read back (not authenticated-tested unless said).

| # | Capability | State | Evidence |
|---|---|---|---|
| 1 | Business profile + declared goals (Exp 01) | WORKING (text goals only) | `20261019000000_solo_setup_business_brief.sql:12,61,238` |
| 2 | Structured goal / target / KPI store | **MISSING** — material product decision, owned by Exp 02 | master §5 "Game Plan has missions but no canonical goal, target, or KPI structure"; searched migrations for `goal`, `target`, `kpi`, `business_goals`, `acquisition_goal`: only per-client `client_goals` and `business_missions` |
| 3 | Campaign plan record (objective, audience, offer, budget target, timing, desired outcome, success definition, conversion destination, follow-up path, pipeline) | WORKING | `campaign_briefs`, `20261225000000_solo_campaign_briefs_foundation.sql:16-55`; writer `configure_campaign_brief` (create/update/`transition_brief`/archive) |
| 4 | Campaign brief builder (UI) | WORKING | `src/solo/campaign-desk.tsx` (9-step builder, dossier) |
| 5 | PAIGE drafts/files a brief from chat | PARTIAL → **BLOCKED on typed Solo chat** (INT-346) | Spine `_shared/paige-spine/domains/campaigns.ts`; protocol `active:false` |
| 6 | Messages and creatives (copy, images, documents, email drafts) | WORKING draft-only | `marketing_content`, `draft_marketing_content`, email series tools |
| 7 | Landing pages, funnels, forms (build, publish) | WORKING | `/p/`, `/f/`, `/form/:id` (`src/App.tsx:345-347`); Studio + chat `growth_*` tools |
| 8 | Campaign ↔ asset links | WORKING (UI) / NOT CONNECTED (chat) | `20271020000010`; `src/solo/useCampaignAssets.ts` |
| 9 | Tracking: UTM on submission and visit | WORKING | `src/lib/growth.ts:404-413`; `growth-public-submit/index.ts:140-153` |
| 10 | Visit evidence | WORKING in source; 0 visits; figures MISSING (7b, waits on INT-340) | `20271024100000` |
| 11 | Lead capture → contact | WORKING | `growth-process-submission/index.ts:391-457` → `create_contact` |
| 12 | Lead → opportunity in a pipeline | WORKING (form's route, else default pipeline first open stage) | `growth_attach_submission_deal` (`20270588326001`), `growth_attach_submission_default_deal` (`20271021042001:32-97`) |
| 13 | **Campaign attribution on the lead / opportunity** | **MISSING** | `create_contact` gets `p_source:'paige_form'` only (`growth-process-submission/index.ts:409-425`); deal insert `source='paige_form'` only (`20271021042001:87-89`); the form↔campaign link is read only for the `form.submitted` payload (`20271022100000:50-67`). Today attribution is only rebuilt at read time by `utm_campaign` ↔ `short_ref` text match |
| 14 | Campaign's chosen pipeline used for its leads | **NOT CONNECTED** | `campaign_briefs.pipeline_id` is never read by intake |
| 15 | `form.submitted` → campaign-scoped §67 process | WORKING source / BLOCKED activation (no screen; chat refuses) | `20271022100000`; convergence §N3.4 |
| 16 | Follow-up: governed single email; email series (approval-gated, 500/day) | PARTIAL (email only; SMS sequences MISSING) | `comms-email-command`, `email_sequences*`, `email-campaign-worker` |
| 17 | QA provider floor (no real send from the QA workspace) | WORKING in code / UNVERIFIED for PC-1 | `comms_provider_execution_allowed` (`20270602000104`); ANT-21 says PC-1's protected flags are absent |
| 18 | Appointments (booking) | WORKING / NOT CONNECTED to deals | `public-booking` creates a contact, no deal; `internal_bookings` has no `deal_id` |
| 19 | Opportunity progression (move, win, lose) | WORKING | `configure_tenant_pipeline_core_identity`; crm-command `deal.*` |
| 20 | Lead → paying customer (agreement, invoice, payment) | PARTIAL; merchant onboarding BLOCKED; no automatic customer promotion | `tenant_client_agreements` (no `deal_id`), `paige_invoices.deal_id` never set; master §4 merchant onboarding |
| 21 | Campaign steps (plan/record/judge) | PARTIAL: planned step cannot reach approval | convergence §N3.5 |
| 22 | Marketing metrics (leads, by tag/source, converted to opportunity) | WORKING owner/admin UI; MISSING in chat | `_marketing_metric_bundle`; `BUSINESS_METRIC_KEYS` has 0 `marketing.*` |
| 23 | Lead-to-customer conversion, customers acquired, CAC/CPL/ROAS | **MISSING** (no producer; no spend source) | Sales and Marketing producer key lists |
| 24 | Real ad spend / ad publishing | **MISSING** (not merely gated) | no code creates ad campaigns/budgets; `ads-chat-s32c-acceptance-package.md:169-172` |
| 25 | Approval engine, Trust, Rail, receipts | WORKING — reuse only | `paige_pending_confirmations`, `action-risk.ts`, `record_capability_run`, `execute-approval` |
| 26 | Authenticated QA on PC-1 | **BLOCKED** | ANT-147 2026-10-12: account role, protected flags and credentials must be corrected by Auth/admin first; no runner secret |

## 4. Customer-flow map (actor: SOLO owner unless stated)

| Flow | Goal | Entry → exit | Today | Slice |
|---|---|---|---|---|
| F1 Set acquisition goal | "Who do I want, how many, by when, on what budget" | PAIGE chat / Campaigns › New → campaign plan with desired outcome + success definition | Builder WORKING; chat BLOCKED; no numeric target (2) | S3, S6 |
| F2 Recommend strategy | Strategy grounded in the confirmed profile, offer and past results | profile + offers + campaign history → recommendation | Judgement only; no evidence of past results | S6 |
| F3 Prepare assets + capture path | Messages, creative, page/form, tracked link | brief → Studio/chat drafts → attached to campaign | WORKING (UI); link via chat MISSING | S3 |
| F4 Review and approve | Owner approves campaign + assets before anything goes live | dossier → transition `approved`/`active`; publish | WORKING (owner-set status); step approval BLOCKED (21) | S4 |
| F5 Capture prospect (actor: prospect) | Submit form from campaign link | `/p/` or `/form/:id` → submission → contact → opportunity | WORKING without attribution (13) or campaign pipeline (14) | **S1** |
| F6 Report verified lead | Owner sees the lead, which campaign, how it was attributed, where it sits in Sales | dossier "Recorded outcome" → lead list; PAIGE answer | "Attribution needs a verified source; not available yet." (`campaign-desk.tsx:110`) | **S1** |
| F7 Follow up / book | Authorized follow-up and appointment | `form.submitted` → scoped process → email draft for approval → booking | PARTIAL (15, 16, 18) | S4 |
| F8 Progress to customer | Opportunity → agreement → invoice → paid | Sales contracts | PARTIAL (19, 20) | S5 (Sales-owned writers) |
| F9 Measure + improve | Results vs goal; next best change with evidence | metrics → Exp 02 review → recommendation | PARTIAL (22, 23) | S6 |

Negative paths that every slice proves: a member (non-admin) sees counts, never names; another workspace's campaign
never attributes a lead; an archived campaign is never chosen by a form link; a tag matching several campaigns is
never guessed; a paused/archived workspace starts no process; nothing sends, publishes or spends.

## 5. Missing feature list (to build or hand off)

1. **Campaign attribution stamped at capture** (13) — Experience 03, S1.
2. **Campaign's pipeline used for its unrouted leads** (14) — Experience 03, S1.
3. **"Leads from this campaign" read + dossier view** (F6) — Experience 03, S1.
4. PAIGE chat read of a campaign's leads (`read_campaign_leads`) — Experience 03 builds; Platform Reach reviews
   registration; reachable on typed chat only after INT-346.
5. Chat tools: attach asset to campaign, transition campaign status — S3 (Marketing lane, built by this journey).
6. Governed "prepare for approval" for campaign steps, or truthful copy (§N3.5) — S4.
7. Governed process activation screen (§N3.4) — S4, needs an owner-seen design.
8. Booking → opportunity link — S4, Sales-owned writer change, raised with Sales.
9. Agreement/invoice → deal link and customer promotion on won/paid — S5, Sales/Payments owners.
10. Lead-to-customer conversion and customers-acquired metrics; campaign roll-up — S5/S6 via INT-340.
11. Structured acquisition targets — **owner product decision**, Experience 02 store (see §8).
12. Real ad spend, ad publishing — **owner/provider decision**; not in scope.

## 6. UI/UX implementation plan (Flow-by-Flow, then Impeccable; owner sees the design before production)

- **One home (§18):** the Campaigns dossier in Marketing (`src/solo/campaign-desk.tsx`). No new tab, no new
  surface. The "Recorded outcome" loop stage becomes real when a campaign has attributed leads.
- **Approval coverage (checked 2026-10-12 against the record, not assumed).** The owner approved prototype v2
  on 2026-10-10 (`docs/product/int342-marketing-convergence.md` line 3: "the campaign map" among what it
  covers; record copy `docs/prototypes/int342-marketing-convergence.html`). That campaign map has three
  lanes, Reach → Land → **Brought in** (leads, opportunities with "see them in Sales", "Revenue lives in
  Sales", and a truth label). Reach and Land shipped in MBC 3b; **Brought in was never built**. It is covered
  by the existing approval and is built first (S1d-1). Its approved copy says "leads tagged CB-…" because
  campaign links did not exist yet; with the stamp, the count includes form-linked leads, so the words change
  to stay true, and that change is disclosed in the evidence record.
- **S1d-1 as built (2026-10-12):** the third lane of "What this campaign uses" in the dossier
  (`src/solo/campaign-composition.tsx`, `BroughtIn`): leads credited to this campaign; opportunities with
  "open Sales" (hidden at zero; the approved "see them in Sales" overpromised, as Sales is not filtered to a
  campaign); "Revenue lives in Sales"; a foot line saying how a lead is credited, true for archived campaigns
  and forms that aren't live, and disclosing leads on the campaign's forms that fit another campaign. Launch
  readiness' attribution row now agrees with it. Counts are the server's. A failed
  read offers retry and draws no zero. The Recorded outcome stage reads Partly available. Evidence:
  `docs/evidence/ui-delivery/exp03-s1d1-brought-in.md` (594/594 rendered checks).
- **S1d-2 — the per-lead list — owner-APPROVED 2026-10-12 and BUILT** as the reviewed sheet showed it: collapsed
  under the Brought in counts ("Show the N newest leads"), read-only rows of who, when, how credited, which form
  and stage, the pipeline named once. Names and record ids come only from the server, to owners and admins;
  members and an agency manager working in the sub-account see "A lead" (proof 3b, 3b2). Evidence:
  `docs/evidence/ui-delivery/exp03-s1d2-campaign-leads.md` (1008/1008 rendered checks). The original proposal,
  kept for the record (superseded by the approved collapsed design):
- **S1d-2 proposal — "Leads from this campaign"** inside the dossier, after "Steps and results":
  - headline counts: leads · became opportunities · won · lost (server counts, never computed on screen);
  - each lead: when, how it was attributed in the owner's words ("Came through a form in this campaign",
    "Link tagged for this campaign", "Both"), its pipeline and stage, open/won/lost; owner/admin see names;
  - truthful empty states: no form attached; form attached, no leads yet; leads whose tag matched several
    campaigns are counted as not attributed and said so.
- Container: inline section in the existing dossier (no modal). Loading skeleton, error with retry, member view.
- Audience dashboard is APPROVED-FROZEN (§28) and is not touched.
- The rendered design is shown to the owner (both themes, desktop + phone) before the UI merges (§00).

## 7. Shared integration dependencies

| Dependency | Needed for | State | Unblock owner |
|---|---|---|---|
| INT-346 typed-chat admission | Every conversation-led act (F1, F3, F4, F7 by chat) | DRAINING | Conversational Loop; owner-reserved |
| PC-1 QA account repair + runner credential | Authenticated proof of every flow | BLOCKED | Auth/admin (ANT-21) |
| Platform Reach registry review | New chat tools | Process | INT-179 |
| INT-340 dispatcher allowlist | Visit and conversion figures | Waiting (ANT-23) | Spine & Platform Reach |
| Experience 02 goal store | Target vs actual | Not built; product decision | Owner + Exp 02 lead |
| Sales writers | Booking/agreement/invoice ↔ deal, customer promotion | Not built | Sales/Payments |

## 8. Decisions reported separately (not taken by this lead)

- **Structured acquisition target** (e.g. "10 new clients by 31 Dec, under $X per client"). Today a campaign holds
  this as owner text (`desired_outcome`, `success_definition`, `budget_target`). A numeric target table is named a
  material product decision in master §5 and belongs to Experience 02's goal store. Recommendation: Experience 02
  owns one target record; campaigns reference it.
- **Real ad spend / publishing / provider sends** — not enabled; requires explicit owner authorization.
- **Member visibility of lead names** — withheld (precedent: campaign assets/actions); widening is an owner call.

## 9. First vertical slice (S1): goal → campaign + capture path → approve → synthetic lead → verified, attributed report

What already works and is reused unchanged: brief creation and approval (`configure_campaign_brief`), form build and
publish, asset link, public submit, contact creation, opportunity creation.

What S1 adds:

**S1a — attribution at capture (migration).** `growth_form_submissions` gains `campaign_brief_id` (FK, set null on
delete) and `campaign_attribution`. A `BEFORE INSERT` trigger stamps both from the two definitions the platform
already uses (the same rules, evaluated at insert; differences are listed below):
- `L` = the workspace's non-archived campaigns this form is attached to (`campaign_brief_asset_links`, kind `form`);
- `T` = the workspace's campaigns whose reference equals the link's `utm_campaign`, case-insensitive (as
  `marketing.leads.by_campaign_tag`), archived campaigns included as the metric includes them; a tag that names
  several campaigns names none, as the metric excludes it.
- Exactly one campaign in both → `form_and_tag`; else exactly one in `L` and none in `T` → `form_link`; else none in
  `L` and exactly one in `T` → `campaign_tag`; nothing in either → `none`; anything else → `ambiguous` (no campaign;
  never guessed).
- Covers both writers (`growth-public-submit`, `growth-inbound`) without changing them. The pair is immutable after
  insert: a change, or a clear to nothing while the campaign exists, is refused for every role, including a member
  through the table's own update policy (a §39 review finding, fixed before merge). Only deleting the campaign
  clears it. Rows from before this release keep `NULL` = "not evaluated".
- Where two figures can still differ, by design: the `form.submitted` payload reads the form's links again when the
  contact is pinned (a link changed in between can differ); Analytics' per-campaign figure counts by tag alone,
  including leads saved before this release; a form linked only to an archived campaign credits none by its link,
  while a tag still matches an archived campaign.

**S1b — the campaign's pipeline — SHIPPED 2026-10-12 (migration `20271026100000`, PR #2078 → main `212a2a9b`,
db-live and edge-live `212a2a9b`, production read back; evidence `docs/evidence/ui-delivery/exp03-s1b-campaign-route.md`).** Order: the form's own route; its campaign's pipeline
(first open, non-archived stage) when the form is attached to exactly one non-archived campaign whose pipeline is
the business's own and not archived; the default pipeline; nowhere. One definition (`_growth_form_campaign_route`)
is read by the filing (`growth_attach_submission_default_deal`), the metric (`marketing.forms.unrouted_current`)
and the screens' read (`get_form_campaign_routes`); Overview, Analytics, the form panel and the dossier's pipeline
row say "Campaign: <pipeline> → <stage>". Known consumer left as is: PAIGE's `get_pipeline_lead_funnel` reads one
pipeline (the default unless named), so campaign-pipeline leads are not in its default answer (#2077; the
chat surface is INT-346's). Independent review (FIX-FIRST) and what changed: a change in the dossier (a form attached or removed, a brief
saved, moved or archived) now re-reads the shared Marketing read so every screen follows it; production publishes
none of these tables to realtime (#2079), so a change PAIGE makes in chat shows on the next load. PAIGE's
campaign-brief tools now say that linking a pipeline routes future leads from forms attached only to that campaign.
The dossier sentence is conditional ("while it has an open stage", not for an archived brief). Two consumers left
to their owners: the publish preview's pipeline check (#2080) and the lead-funnel chat read (#2077). By design, the
S1a credit and the S1b destination can differ (the credit reads a lead's tag, the destination never does), and any
non-archived campaign routes, completed ones included (archiving stops it) — both stated in the migration header.
The plan as decided:
**S1b — the campaign's pipeline (its own follow-up PR, decided 2026-10-12).** For a form with no route of its own,
file the lead into its campaign's pipeline (first open stage) when that pipeline can take it; otherwise the default
pipeline exactly as today. Separated from S1a because three shipped consumers state where an unrouted form's leads
go and would become untrue the moment routing changes: `pipelineRouteOf`/`defaultRouteLabel`
(`src/solo/marketing-overview-model.ts:65-118`, Overview and Analytics) and the server's
`marketing.forms.unrouted_current`. The rule will key on the form's single campaign link only (deterministic per
form, so screens can state it), never on a per-lead tag, and ships with those consumers updated (§37). Until then a
lead goes where the form's route or the default pipeline sends it — the same place the screens already say.

**S1c — the read.** `get_campaign_brief_leads(_tenant_id, _brief_id)`: the campaign's attributed leads with their
contact, opportunity, pipeline, stage and status; server counts; member view without names; refuses another
workspace (`42501`). Withholding names from members is a presentation rule of this read, not a security boundary:
the table's existing read policy already lets a member read submissions. Narrowing that is an owner call. An agency
manager acting inside a sub-account reads the member view (`is_tenant_admin` counts only that workspace's own
members), the same as campaign assets.

**S1d — the view** (§6). S1d-1, the approved map's Brought in lane, is built; S1d-2, the per-lead list, was approved by the owner on 2026-10-12 and is built under it.

**S1e — PAIGE's read** `read_campaign_leads` (Spine read, member seat) — registered, raised with Platform Reach,
reachable in typed chat once INT-346 clears.

Synthetic proof: `supabase/tests/campaign_lead_attribution.sql` (rolled back, `database-contract`): a workspace,
a campaign with a pipeline, a form attached to it, a public submission with the campaign's tag → stamped
`form_and_tag` → processed into the campaign's pipeline → the read returns it, a member gets no names, another
workspace is refused, an ambiguous tag stamps nothing. **Authenticated drive on PC-1 is BLOCKED (§7).**

## 11. A Studio form on the business's own website (owner requirement 2026-10-12)

**Requirement.** A Solo owner creates and customises a lead form in Vibe Studio, publishes it, and gets code to
embed it on a website they control. Submissions reach the existing intake with S1a attribution, S1b routing,
tenant isolation and consent records; fields, branding, publish/unpublish, copyable instructions, responsive,
accessible, validated, with plain success and error states. No second forms store, intake, campaign system or
publishing engine.

**Reuse inventory (searched `GrowthFormRenderer`, `GrowthFormEmbed`, `growth-public-submit`, `growth-publish-command`,
`embed.js`, `iframe`, `frame-ancestors`, `X-Frame-Options`, `consent`, `brand`, `studio/*`; read the code below).**

| Piece | Where | State before S2a |
|---|---|---|
| Hosted form page | `/form/:id`, `src/pages/public/GrowthFormRenderer.tsx` (`GrowthFormPage`) | WORKING; full-page layout only |
| In-app embed | `GrowthFormEmbed` (same file) | WORKING inside Paige pages and funnels; not an external embed |
| Public read | `growth_public_form` (anon, active form of a live business) | WORKING; returns no brand or tenant slug |
| Public intake | `growth-public-submit` (origin allow-list `*.paigeagent.ai`, bot trap, rate limits, form-derived tenant) | WORKING; a framed `/form/:id` posts from Paige's origin, so it is accepted; a direct post from another site is refused (correct). `consent_json` is always `{}` |
| Attribution / routing | S1a stamp at insert (form link + `utm_*`), S1b campaign pipeline | WORKING; tag credit needs the host page's tags inside the frame |
| Publish / unpublish | `growth-publish-command` (one door, approvals, readback) and Studio `PublishPanel` | WORKING; "It's live" shows the address only |
| External loader | `public/embed.js` (booking calendars: inline/popup frame, origin-checked height messages) | WORKING for `/book/:slug` only |
| Framing | `vercel.json` sets no `frame-ancestors` / `X-Frame-Options` | any site may frame the app |
| Fields, wording, thank-you | Vibe Studio chat (`growth-form-draft`), stage preview per device, `FormSettings` (routing, notify) | WORKING by conversation (§18/§21: no field-editor buttons) |
| Brand | Studio preview reads `peek_tenant_portal_brand(slug)` | GAP: the live form shows no brand, so preview and live differ |
| Consent | `communications_consents` + `record_communications_consent`, read by the send gates | GAP: forms record none; and the recorder is anon-callable and unscoped (#2087, security) |

**Gaps closed by S2a (no backend change):** `embed.js` learns `data-form` (frames `/form/<id>?embed=1`, forwards
only the page's `utm_*`/`gclid`/`fbclid`, sizes itself, `data-theme` light|dark|auto, and moves the visitor's page
on a success redirect); `/form/:id` gains an embedded card (no page chrome, transparent around it, light unless
asked, its height reported through the shared `useEmbedHeight` the booking page now uses too, no Paige splash);
Studio's publish panel shows "Put it on your website" with Copy code for a live form.

**Status (2026-10-13):** S2a shipped (owner-approved design; PR #2088 → main `7f3217af`; production read back, master §4.0). Authenticated acceptance is with the QA coordinator (ANT-52).

**Later slices:** S2b, the live form carries the business's brand (a public brand field on the form read; the
preview already shows it). S2c, consent: a form's declared consent question writes a consent record through the
public intake for the form's own business, after #2087 closes the recorder and scopes the gates.

### 11a. Sites built elsewhere and served by Cloudflare (owner clarification 2026-10-13)

The owner builds client sites with Genspark agents, and some are served by Cloudflare Pages or Workers. Those sites
are a first-class target for S2a. They are not moved to Vercel or rebuilt in Vibe Studio, and **no Cloudflare
account is connected to Paige.** The installation guide is `docs/guides/put-a-paige-form-on-a-cloudflare-or-genspark-site.md`.

**Grounded first (2026-10-13).**
- Production serves `/form/:id` and `/embed.js` with no `frame-ancestors` and no `X-Frame-Options`, so any site
  may frame the form.
- Its `/assets/*.js` carry `access-control-allow-origin: *`, so the app's scripts load even in a frame with an
  opaque origin.
- The intake accepts answers only from `paigeagent.ai` and its subdomains. The framed form posts from that
  origin, so the host's hosting platform is irrelevant to the intake.

**Compatibility matrix.** Driven by `scripts/live-drive/cloudflare-embed-drive.mjs`: Cloudflare's own Pages runtime
(`wrangler pages dev`, which applies `_headers` as Pages does) and the real app on another origin, with Supabase
stubbed. 80/80 after the independent review's fixes and the owner's button direction.

| Host situation | Result |
|---|---|
| Plain page, desktop and phone (390px) | Works end to end: tags carried, sized, sent from Paige's origin, thank-you fits |
| Code pasted in `<head>` | Works: the form goes to the end of the page (before: invisible in head) |
| Rocket Loader on, copied tag (`data-cfasync="false"`) | Works: one form, in place |
| Rocket Loader on, older tag without `data-cfasync` | Works: one form, in place (Rocket Loader keeps `document.currentScript`) |
| CSP allowing `https://paigeagent.ai` in script-src and frame-src | Works end to end |
| CSP blocking the frame | Link to the form's own page, with the tags; the console names `frame-src` |
| CSP blocking outside scripts | The tag can't run; the no-script frame works end to end |
| Builder "custom HTML" block sandboxed without same-origin | Link to the form; nothing sent (before: invisible in head, and the form could not send). The tab it opens inherits the sandbox, so it shows the form's address with Copy address (before: a blank page) |
| Builder block that lets tabs escape (`allow-popups-to-escape-sandbox`) | The link opens the form's own page with its real origin; works end to end |
| No-script frame inside such a sandbox | "This form opens on its own page", with a link and the address to copy (before: a blank frame) |
| `Content-Security-Policy-Report-Only` | The form stays and works (a report-only policy never blocks) |
| The "Open the form" fallback button, on light and dark sites (owner direction 2026-10-13) | Deep indigo, white text (17.9:1), a white-then-indigo ring so one of its tones always clears 3:1 against any page (measured 15.1:1 on the dark test page, 17.1:1 on the light one); inverted for a dark-look form; 44px; keyboard focus clear of the ring. Before: indigo on a dark site at 1.2:1 against the page (measured), nearly invisible |
| The booking popup button (same style) | Same measurements on light and dark sites; still opens the calendar and closes on Escape |
| Sandbox with same-origin | Works end to end |
| Thank-you redirect | The business's page navigates to the thank-you page |
| Paige's product analytics inside the form on a business's site | Plausible, the page-view event and the Meta Pixel's settings lookup: none (driven). PostHog: off (unit-tested; the harness has no key). Error reporting and Vercel Speed Insights stay on |

**What changed for it:**
- `embed.js`:
  - a widget whose tag sits in `<head>` goes to the end of the page;
  - a frame refused by an enforced CSP becomes a link to the form's own page (a report-only policy is ignored);
  - an opaque-origin page gets a link instead of a frame.
- `main.tsx`: any form page in an opaque origin (framed, or a tab opened from a sandbox, which inherits it) renders
  a small card with the form's address and Copy address, not the app, because every provider reads storage.
- Known limit: browsers report a refused frame by origin, so a policy allowing some Paige addresses and refusing
  others turns every Paige form frame on the page into a link.
- Analytics are skipped when `isFormOnBusinessSite()`.
- Studio:
  - the copied tag carries `data-cfasync="false"`;
  - a "Get a version without a script" option gives the form's frame on its own, and says plainly that it can't
    resize or carry campaign tags.
- Each change is mutation-checked: removing it fails the drive or a unit test.

**Server half, with a real sent answer.** `scripts/live-drive/form-embed-intake-replay.mjs` takes the request a
visitor sent from the Cloudflare site and replays it through the real intake rules (`growth-intake.ts`). It then
runs the real database path on an isolated local clone, rolled back:

- the row growth-public-submit inserts, for the form's own business;
- the S1a stamp `form_and_tag`;
- the processor's filing into the campaign's pipeline (S1b);
- the owner's campaign lead read;
- another business's owner seeing none of it.

9/9. Two mutations of it each fail it.

**Remaining gaps for Genspark-built sites:**
- No real Genspark site has been driven, and neither has Cloudflare's live edge. Rocket Loader is Cloudflare's
  own script, but the harness applies it to the page.
- No signed-in production run yet. S2a is live since 2026-10-13 (owner-approved design; PR #2088 → `7f3217af`,
  production read back in master §4.0). The run is the QA coordinator's, on the designated account (ANT-52), per
  `docs/delivery/exp03-s2a-form-embed-acceptance-package.md`.
- Sites sending `Cross-Origin-Embedder-Policy: require-corp` are untested. The form page does not opt in, so
  such a site would likely block the frame.
- The no-script frame keeps a fixed height and carries no campaign tags.

**Optional, later: a customer-authorized Cloudflare connection (assessment only; nothing built).**

- **Outcome.** With the customer's explicit approval, Paige reads the Pages project, custom domain and zone
  settings that matter to the form. That means `_headers` CSP, Rocket Loader, and the deployment that holds the
  page. Paige then tells the owner exactly what to change, or, on a separate approval per change, makes it.
- **Least privilege.**
  - A customer-created Cloudflare API token scoped to one account and zone, with Account › Cloudflare Pages: Read
    and Zone › Zone Settings: Read.
  - Write scopes only for a named, approved change, never standing.
  - No Global API Key.
- **Custody.** The token is kept server-side through Paige's existing protected credential path, never returned to
  the browser or logged. It is revocable by the customer at Cloudflare, and Paige stops on revocation.
- **Governance.**
  - It needs its own Integration Capability Registry entry before any build (the delivery rule).
  - It runs read-only by default; any write is `confirm` with a Rail receipt; verification reads the setting
    back.
- **Cost.** $0 to Paige (the Cloudflare API is free).
- **Necessary for the first paid Solo customers?** No. The embed and the guide need no connection.
- **Stage:** after S2a ships and a real customer asks.

## 10. Delivery sequence (each independently testable)

| Slice | Deliverable | Proof |
|---|---|---|
| S1 | §9 | DB contract test; unit tests; rendered UI both themes; production readback; PC-1 drive owed |
| S2 | Campaign roll-up into Marketing Analytics + Exp 02 evidence (`marketing.campaign.leads`, `.opportunities`, `.won`) via INT-340 | DB test; Exp 02 consumer handoff |
| S3 | Chat: attach asset, transition campaign, read leads; brief-from-goal grounded in Exp 01 profile *(see §12: the S3 label on this branch was used for lead replies; this deliverable is not built)* | Spine/chat contract tests; INT-346 gate |
| S4 | Follow-up: campaign-scoped process activation screen (owner-seen design) + step prepare-for-approval; booking → opportunity (Sales) | DB tests; rendered design |
| S5 | Opportunity → customer: deal link on agreement/invoice; customer promotion on won/paid (Sales/Payments writers) | Sales contract tests |
| S6 | Results vs goal + evidence-backed recommendation through Exp 02's review | Fabric adapter tests |

Every slice: independent non-author review, exact-head CI, `deploy-migrations` persisted-apply readback, master
reference §4/§5 and tier matrix updated in the same PR, four evidence states kept separate (CODE_COMPLETE, RELEASED,
AUTHENTICATED_WORKFLOW_VERIFIED, OWNER_ACCEPTED).

## 12. S3 "PAIGE works your leads" — backend built, not merged (2026-10-13)

**Naming note (§13).** §10's table plans S3 as "chat: attach asset, transition campaign, read leads". The work built on this branch under the S3 label is a different deliverable: a drafted reply to each new lead, sent only through the governed email door. The chat-tools deliverable is not built by this work, and no slice number is assigned to it here.

**Status.** CODE_COMPLETE on branch `claude/stoic-archimedes-pv4r8u`. Not RELEASED: not merged, and migrations `20271031000000`/`000100`/`000200` are not applied. Not AUTHENTICATED_WORKFLOW_VERIFIED. Not OWNER_ACCEPTED. Full record: master §4.0 (2026-10-13 S3 entry), with the gaps in master §5.

**Flow covered (backend):**
1. A lead submits an opted-in form.
2. `growth-process-submission` files one `owner.lead_followup` draft. Its gates:
   - business account type and open status;
   - the typed email matches the contact;
   - exactly one sender;
   - caps.

   A skip records `lead_reply_skipped_reason`.
3. The worker drafts plain text.
4. The owner approves the exact email, and `comms-email-command` sends it with `approval_id` from an admitted sender. SendGrid counts only while its domain is verified..
5. At `provider_accepted`, the send is recorded on the approval, and the contact and deal history show "handed to the email provider".
6. A signature-verified SendGrid event moves the message forward (delivered / bounced / blocked / dropped / deferred / spam reported).

`execute-approval` and every other approve path cannot mark a send approved without a governed send.

**Not covered, and why:**
- **The reply screen and every UI state.** Owner design approval comes first (§00).
- **A live SendGrid send.** Operator steps are owed (master §5).
- **`client.followup`.** Decline-only; an owner decision is owed.
- **A SendGrid-only business gets no draft.** The drafter does not pass the SendGrid provider list yet.
- **Enterprise forms cannot be opted in.** The setter admits standalone and sub-account only.
- **The full rollout plan.** Gmail and iCloud Mail are planned separately in `exp03-launch-email-providers-plan.md`.
