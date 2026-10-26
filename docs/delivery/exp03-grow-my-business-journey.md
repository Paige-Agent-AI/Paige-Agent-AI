# Experience 03 — Grow My Business: journey inventory, flow map and delivery plan

Date: 2026-10-12 · Journey Lead at authoring: Claude Code (one accountable lead) · Linear: ANT-51 (canonical journey
record at authoring; now with active EXP04 — historical EXP03 references preserved, not taken over), ANT-147
(integration), ANT-15 (Marketing), ANT-45 (Ads), ANT-21 (historical PC-1 QA) · Shell: SOLO

**Current state — 2026-10-26: the owner moved the remaining EXP03 assignment to ONE Claude Code successor lead,
replacing the zCod lead (zCod credits exhausted). This is not parallel staffing. The successor's ACK, full
mapped-row matrix and next deliverable are in §14.** The zCod staffing named below is historical. Its branches,
PRs, reviews and evidence are preserved.

**Superseded 2026-10-26 (kept as history) — 2026-10-23: ONE zCod EXP03 resumption owner-authorized; old staffing/PC-1 snapshots historical;
full roadmap/mapped matrix retained; ACK/start/source/customer release separately evidenced.** The sections below
are the original 2026-10-12/13 record, preserved as history with two superseded facts named: the INT-346 typed-chat
blocker (production `paige_chat_interactive_protocol()` is active v2 as of 2026-10-23) and PC-1 (retired; the
owner's designated ordinary SOLO account is the engineering testing account). S3's backend merged as #2126
(f2e2a0af6) — §12's "not merged" lines are historical. Receiving ACK: ANT-161 comment 25d0cb99 (2026-10-23).
Current leases coordinate in ANT-161 (E03 #2172 preserved). **2026-10-23 first live F5→F6 reproduction: see §13 —
the chain works end to end on the designated account; the first production form submissions on record (0-ever
verified beforehand), with attribution and routing exercised for the first time as a direct consequence.**

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
| 21 | Campaign steps (plan/record/judge/prepare-to-approval) | WORKING | `20271115010000` (S4a, PR #2889 `c0d1c7281`; convergence §N3.5 closed) |
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
| F8 Progress to customer | Opportunity → agreement → invoice → paid | Sales contracts | PARTIAL — the read side shipped (F8 PR #2917 `4422cb02d`: recipient, invoice counts, close date read from Sales' own records; agreement/booked-call linkage absent and said so); the writers remain Sales-owned (19, 20) | S5 (Sales-owned writers) |
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
6. ~~Governed "prepare for approval" for campaign steps, or truthful copy (§N3.5)~~ — **SHIPPED as S4a** (PR #2889, `c0d1c7281`, 2026-10-26: `prepare_action` through the existing writer delegating to the action bus; the dossier gains the Prepare control and three truthful copy repairs; three review/CI rounds hardened the pgTAP; migration applied + read back in production).
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

**S1e — PAIGE's read** `read_campaign_leads` (Spine read, member seat) — **NOT BUILT.** *§13 correction 2026-10-13:
an earlier version of this line said "registered". Searched `read_campaign_leads`, `readCampaignLeads`, `campaign_leads`,
`leads_by_campaign`, `campaign.leads` and `campaign-leads` across `supabase/functions` and `src`: the only hits are the UI
hook `src/solo/useCampaignLeads.ts` and its test. There is no Spine capability and no chat tool.* It stays planned:
once built it is raised with Platform Reach, and it is reachable in typed chat only after INT-346 clears.

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

## 12. S3 "PAIGE works your leads" — backend built, not merged (2026-10-13; updated for review round 4)

**Naming note (§13).** §10's table plans S3 as "chat: attach asset, transition campaign, read leads". The work built on this branch under the S3 label is a different deliverable: a drafted reply to each new lead, sent only through the governed email door. The chat-tools deliverable is not built by this work, and no slice number is assigned to it here.

**Status.** CODE_COMPLETE on branch `claude/stoic-archimedes-pv4r8u`. Not RELEASED: not merged, and migrations `20271031000000`/`000100`/`000200`/`000250` are not applied. Not AUTHENTICATED_WORKFLOW_VERIFIED. Not OWNER_ACCEPTED. Full record: master §4.0 (2026-10-13 S3 entry), with the gaps in master §5.

**Flow covered (backend):**
1. A lead submits an opted-in form.
2. `growth-process-submission` files one `owner.lead_followup` draft. Its gates:
   - business account type (standalone, sub-account or enterprise) and open status;
   - the typed email matches the contact;
   - exactly one sender, counted with the email door's provider list (SendGrid included);
   - caps.

   A skip records `lead_reply_skipped_reason`.
3. The worker drafts plain text.
4. The owner approves the exact email, and `comms-email-command` sends it with `approval_id` from an admitted sender. SendGrid counts only while its domain is verified. The approval is stored on the send, and only one live send per approval is allowed.
5. At `provider_accepted`, the send is recorded on the approval (only a send prepared for that approval), and the contact and deal history show "handed to the email provider". The history row carries no client user, so it is never shown in the client's portal.
6. A signature-verified SendGrid event moves the message forward (delivered / bounced / blocked / dropped / deferred / spam reported). A send whose outcome was unknown settles only when all three correlation claims and the recipient match.

`execute-approval` and every other approve path cannot mark a send approved without a governed send prepared for that approval. Every other send kind (for example `client.followup`) is decline-only at the database. `send-message` refuses any SendGrid send that is not the email door's.

**Not covered, and why:**
- **The reply screen and every UI state.** Owner design approval comes first (§00).
- **A live SendGrid send.** Operator steps are owed (master §5).
- **`client.followup`.** Decline-only at `execute-approval` and at the database; an owner decision is owed.
- **A per-business DNS proof of domain ownership** before any automated SendGrid verification writer ships.
- **Before merge:** the door proof's fixtures share one SendGrid domain id, which `000250`'s unique index refuses when CI applies it first (master §5, item 0).

Closed in round 4: a SendGrid-only business now gets a draft, and enterprise forms can be opted in.
- **The full rollout plan.** Gmail and iCloud Mail are planned separately in `exp03-launch-email-providers-plan.md`.

---

## Customer Experience Integration Matrix (Engineering 2.0 standard, 2026-10-13)

**The acceptance question:** can the customer ask PAIGE to accomplish something, see the actual change in the correct part
of the platform, understand its status, and return later to verify the result?

**Answer today: no, for all 15 Experience 03 outcomes.** Every outcome is missing at least one link: the conversation, the
screen, the visible state, or the readback. This table is the work list that closes those gaps, classified REUSE /
EXTEND / REPAIR / NEW per link.

**How this was grounded:** read-only traces of code and routes, with mount paths traced from `SoloApp`, plus SELECT-only
production reads, at branch head `a3cc2aa0`. An adversarial checker then tested 22 load-bearing claims: 21 confirmed,
0 wrong, 1 corrected. Production is empty for this journey (0 form submissions, 0 campaign asset links, 0 Gmail
connectors). S3 is not deployed. No row below has an authenticated drive yet; that is owed through ANT-52 on the
Antonio Cook Solo account.

### The matrix

| # | Outcome | Conversation | Spine capability / governed path | Canonical records | UI component (route) | Visible states | Verified receipt / readback | Gaps (per link) |
|---|---|---|---|---|---|---|---|---|
| O1 | Bring in leads for a campaign | `growth_form_save` / `growth_form_publish`; neither takes a campaign | `growth_form.save` / `.publish` (high, confirm) → `growth-public-submit` → stamp trigger → `growth-process-submission` | `growth_forms`, `growth_form_submissions.campaign_brief_id`, `clients`, `deals`, `campaign_brief_asset_links` | Dossier › "What this campaign uses" › Brought in (`/solo/:n/growth/campaigns`) | Being filed / Couldn't be filed / stage / Won / Lost (`processing_state`, `deals.status`) | Submission row is server-read. A Rail event is written only if an automation asks for it. Production has 0 rows. | Conversation **NEW** · Spine **REUSE** · Records **REUSE** · UI **REUSE** · States **REUSE** · Receipt **EXTEND** |
| O2 | Show the leads this campaign brought in | None. `get_pipeline_lead_funnel` groups by raw `utm_campaign` text (#2077) | `get_campaign_brief_leads` (DEFINER, own workspace), called by the UI only | `growth_form_submissions` ⨝ `deals`, `pipelines`, `pipeline_stages`, `clients`, `growth_forms` | Same Brought in block | Counts; per-row status; error with retry; truncation note | Re-read from the server on open and on reload. No realtime (#2079). | Conversation **NEW** (S1e) · Spine **NEW** · Chat and UI read the same record: **REPAIR** · UI **REUSE** · Lead → contact/opportunity link **NEW** · `?brief=<id>` deep link **NEW** |
| O3 | Put this form on my website | `growth_form_publish` (gives the link); no embed code in chat | `growth-publish-command` door (one approval, readback, receipt) | `growth_forms.status`, `growth_form_submissions`, `deals` | Studio PublishPanel › EmbedCode; public `/form/:id`; `embed.js` | preparing / blocked / refused / off / "It's live"; copied / failed | Door receipt. Production has 0 publish receipts and 0 submissions. | Conversation **EXTEND** (embed code **NEW**) · Spine **REUSE** · UI **REUSE** · Receipt **REUSE**, not yet proven in production |
| O4 | Create a brief / attach a form to it | `campaign_brief_create`, `_revise`, `_list` are live; no attach tool | `campaign.create` / `.revise` → `configure_campaign_brief`; attach is `configure_campaign_brief_assets`, called by the UI only | `campaign_briefs`, `campaign_brief_command_results`, `campaign_brief_asset_links`, `audit_logs` | Campaign desk and Dossier attach picker (`useCampaignAssets`) | Saved / "doesn't show it yet" / "couldn't be confirmed"; error with retry | Brief by chat: Rail receipt. Brief by UI and attach: `audit_logs` only, re-read from the server. | Brief chat **REUSE** · Attach chat **NEW** · Attach Rail receipt **EXTEND** · Spine screen address **REPAIR** · Chat → dossier deep link **NEW** |
| O5 | Turn on "draft replies to new leads" for a form | None | `growth_form_set_intake` with 6 arguments exists on the branch only; no Spine capability | `growth_forms.lead_reply_enabled` (not in production), `audit_logs` | Form Settings / Catalog form panel (mounted); no toggle | None | The hook does not map the flag back, so a reload can't show it | Conversation **NEW** · Spine **EXTEND** · Records **REUSE**, branch only · UI **NEW** · States **NEW** · Readback **EXTEND** |
| O6 | New lead → PAIGE drafts → owner sees it pending | System-triggered | `fileLeadReply` → `file_action(owner.lead_followup)` → worker → `paige_pending_approvals` (confirm) | `paige_actions`, `paige_pending_approvals`, `growth_form_submissions.lead_reply_skipped_reason` | Game Plan rail (`/solo/:n/command-center/business-game-plan`); Systems Check | Awaiting approval only; category shows raw (`owner.lead followup`) | `paige_approval_queue_v`, re-read on refresh | Spine **REUSE**, branch only · UI **REUSE** · States **EXTEND** (no processing / skipped / failed) · Edit/View link **REPAIR** (B2) |
| O7 | Review and edit From / To / Subject / body → approve → governed send | No reply screen | `comms-email-command` with `approval_id`; `execute-approval` returns 409 `send_requires_review` | `messages.meta.comms_email_binding`, `communication_log` (`user_id` NULL), `deal_activities`, Rail | No screen calls this door; Conversations (`/solo/:n/clients/conversations`) | sent, delivered and read all show "Sent"; Failed; unconfirmed | History readers filter by `user_id`, so these rows never appear | UI **NEW** · States **EXTEND** · History readback **REPAIR** · Approval ↔ conversation link **NEW** |
| O8 | Legacy `client.followup` approvals (decline only) | n/a | `execute-approval` 409 `decline_only` plus a database guard | `paige_pending_approvals` (125 pending; 6 approved but never executed) | ApprovalRow / Systems Check | After deploy: a generic non-2xx toast, and Approve stays enabled | The row stays pending (server truth) | States **REPAIR** (B6) · Decline **REUSE** |
| O9 | "Reply to this lead" typed in PAIGE Chat | `comms_send_email` (live; 6 production sends) | `comms.email_send` → door; no `approval_id` | `messages`, Rail (0 of 6 carry `approval_id`) | PaigeConfirmCard | pending / working / done / failed / unconfirmed | Result strips ids, so chat and UI share no record | Conversation **EXTEND** (bind `approval_id`, or a duplicate send is possible) · Chat ↔ UI ids **EXTEND** (reuse the `PaigeCrmResultCard` record link) · Deep link **NEW** |
| O10 | Connect my Gmail | None | `gmail-oauth-start` / callback (human only); no Spine capability | `channel_connectors`, Vault, `audit_logs` | Settings › Connections › Connected sending account (mounted); mailbox tile is Unavailable | Connected / Not connected; a grant revoked at Google still shows Connected | `audit_logs` only; card re-reads from the server | Conversation **NEW** · UI **REUSE**, tile **REPAIR** · States **REPAIR** · Receipt **EXTEND** · Chat status screen address **EXTEND** (E4) |
| O11 | Show me emails from my clients | `inbox_list`, `read_message_content` | `comms.messages_read` / `.message_content_read`; 5-minute sync cron | `messages`, `threads`, `mailbox_sync_state`; no `contact_id` | Conversations (mounted) | received / sent; no sync, last-synced or reconnect state | `mailbox_sync_state` has 0 UI readers | Conversation **REUSE** · Inbox consent **NEW** (E6) · Contact link **REPAIR** · Sync state **NEW** · Deep link **NEW** |
| O12 | Reply from my Gmail | `comms_send_email` | Door for chat; the composer bypasses it (E2) | `messages` plus binding; no RFC Message-ID or Gmail `threadId` | Conversations composer | Chat card states; inbox binding states; composer shows a toast only | The direct path writes no receipt | Chat **REUSE** · Composer **REPAIR** · Thread ids **REPAIR** · Chat ids **EXTEND** |
| O13 | Connect my iCloud Mail | None | `smtp-connect` (tenant-level; port 587 blocked); no IMAP | `channel_connectors` (smtp) | `EmailIntegrationConfig` is unmounted (E3) | None | None | All links **NEW** or **REPAIR** |
| O14 | Clean up newsletters / unsubscribe | `gmail_organize` (no unsubscribe send) | `comms.gmail_organize` → `comms-mailbox-command` (confirm); `unsubscribe_send` returns 410 | `messages.meta.unsubscribe_proposed_at`, `message_labels` | No screen shows any of this | Chat card only | Rail via `record_capability_run`; nothing in the UI to reload | Spine **REUSE** · Send **NEW** · UI **NEW** · Review / correct **NEW** |
| O15 | Disconnect my Gmail | None | `gmail-disconnect` (global admin role, `.maybeSingle()`, no `connector_id`) | `channel_connectors`, Vault, `audit_logs` | Disconnect button with confirm (mounted) | Disconnecting… / Disconnected / error | `audit_logs` only; card reloads from the server | Conversation **NEW** · Spine **REPAIR** (E5) · UI **REUSE** · Sync-stopped state **NEW** · Rail **EXTEND** |

### Shared components to coordinate with Experiences 01–05
These extend what already exists; none of them is a new system.
- **`ApprovalRow` and `useCommandCenter` (approve/decline).** Shared with Exp 01 (Command Center) and Exp 02 (Clients). Work needed: the `reason_code` rendering and replacing `/choose-account` with a link to the record.
- **`PaigeConfirmCard` and the `PaigeCrmResultCard` record-link pattern.** Shared with all experiences, since every chat write needs chat and UI to name the same record.
- **The Rail (`record_capability_run` → `_record_workspace_rail_event`).** Shared with Exp 01 and Exp 04 (Sales); its `sales_publish_invoice` receipt is the only publish receipt on record. Attach, Gmail connect/disconnect and UI-made briefs should add Rail receipts here.
- **`ClientsConversations` and `governedSend.ts`.** Shared with Exp 02. Work needed: route the composer through the approval door, and add a link between approval and conversation.
- **Contact history (`communication_log` read by `contact_id`).** Shared with Exp 02's contact and journey screens and Exp 04's deal drawer.
- **The `?brief=<id>` deep link on `growth/campaigns`.** Shared with Exp 04 (Sales ↔ campaign).
- **Settings › Connections (`useSoloComms`, `GoogleSendingAccountPanel`).** Shared with Exp 05 (setup/integrations) and the calendar connection work.
- **The Spine's `humanSurface` registry.** Shared with all experiences. Add one check that every `humanSurface` resolves to a mounted route.

### Authenticated QA checks to add
These are additions to the S2a acceptance package and ANT-52; no prior test is replaced.
1. **O4:** ask in chat to create a brief, then open `growth/campaigns`. The same brief name appears, and after a reload the brief is still there with a Rail receipt.
2. **O1/O2:** publish a form linked to a brief and submit it from `/form/:id`. The dossier's Brought in count rises, shows the server's status, and survives a reload.
3. **O2:** dossier with zero leads versus a failed load. A load error shows retry, never "0".
4. **O3:** after publishing, the panel shows "It's live" only once the door returns the form's address. Copying the embed code works, and the no-script version submits.
5. **O6:** a lead on a form opted in to lead replies appears in the Game Plan rail as awaiting approval. Edit/View opens the record, not `/choose-account`.
6. **O8:** approving a `client.followup` shows a plain decline-only explanation (not a raw non-2xx message), and the row stays pending after a reload.
7. **O9:** a chat reply to a lead with a pending approval settles that approval (no second send), and the thread appears in Conversations after a reload.
8. **O10/O15:** connect, then disconnect, Gmail. After each reload the card matches the server, and an `audit_logs` row exists.
9. **O11:** once inbox consent exists, a synced message appears under the right contact, and the sync state is visible.
10. **Everywhere:** every `humanSurface` the chat names opens a mounted route for a Solo account.

### §13 corrections recorded with this matrix

1. **S1e:** `read_campaign_leads` was recorded as "registered". It is not built (corrected above).
2. **Campaign screen address:** the Spine campaign capabilities give the screen as `/solo/:account/campaigns`
   (`_shared/paige-spine/domains/campaigns.ts:22,28,34`). The real route is `/solo/:account/growth/campaigns`. This is a
   REPAIR, scheduled with O4.
3. **`useSoloProposals` and `useSoloActions`:** master §5 listed `useSoloProposals` among the live 409 consumers.
   Nothing imports either hook.
4. **`governedSend.ts`:** the email plan called it new. It already exists at
   `src/pages/admin/conversations/governedSend.ts`, so C1 extends it.

**Sequencing:** the gaps fold into the existing slice plan rather than a new one.
- **S3 UI (after owner design approval):** O5–O8.
- **Chat and deep-link work, with Platform Reach:** O1, O2 and O4 (S1e, the attach tool, `?brief=<id>`).
- **G1, then G2, M1, G3, D1, C1, U1:** O9–O12 and O15.
- **I1–I3:** O13.
- **MB-8 (ANT-156):** O14.

## 13. Reproduction 2026-10-23 — the first live end-to-end exercise of F5→F6 (zCod resumption, sequencing step 1)

The journey had never run end to end on production (Integration Matrix O3: "Production has 0 publish receipts and
0 submissions"; read-only aggregate re-verified 2026-10-23: 0 `growth_form_submissions`, 0
`campaign_brief_asset_links`, 0 form-sourced deals/clients). This drive exercised the real path on
the owner's designated ordinary SOLO account (tenant `36d626be`, account 3062585; PC-1 retired) under no-send
safeguards, and **the F5→F6 chain works live.** Read-only evidence below; drive reported on ANT-161.

**Fixture (canonical writers only; disclosed):** brief **CB-20DEBF** "EXP03 QA — journey reproduction" created via
`configure_campaign_brief` with its pipeline set to the account's QA pipeline (PPL-VB42S, one open stage "QA
lead"); form **`exp03-qa-repro`** created via `growth_form_upsert` (auto_create_contact, no form-level route, no
notify_email, lead_reply off); **publish executed through the door's internal executor** (`public.growth_form_publish`
as service role) because the interactive approval door cannot be driven without a browser session — the RPC's ACL
is deliberately `{postgres, service_role}` (the one-door design), which the drive confirmed by refusal first;
the approval door itself stays covered by its existing contract suites. Form attached to the brief via
`configure_campaign_brief_assets` — the first `campaign_brief_asset_links` row in production (the same read-only
aggregate read 0 rows in this table before the attach).

**F5 (the prospect):** two real submissions through the live `growth-public-submit` endpoint (allowed origin,
empty bot trap, human timing, `utm_campaign=CB-20DEBF`) — the first `growth_form_submissions` rows in production
history (`ea1e6338`, then duplicate-evidence `3bdf871b`).

**What was verified live:**
- **S1a stamp:** both submissions stamped `campaign_attribution='form_and_tag'`, `campaign_brief_id` set (link + tag
  matched — the strongest class).
- **Processing:** trigger → processor → `processing_state='done'`; contact created (`source='paige_form'`) with the
  mapped email — a synthetic `test.invalid` address, so no real person's data entered production or the retained
  fixture.
- **S1b precedence:** the deal filed into the **campaign's** pipeline and its first open stage (not the default
  pipeline) — `_growth_form_campaign_route` order proven live: no form route → campaign route.
- **F6 owner read:** `get_campaign_brief_leads` returns the lead with truthful counts (1 lead / 1 open), contact
  name, pipeline and stage names, attribution, `processing_state`.
- **Duplicate handling:** the second submission created NO second contact and NO second deal (email dedupe; same
  contact re-read).
- **Foreign-tenant negative:** another workspace owner's claims reading this brief → `CAMPAIGN_BRIEF_FORBIDDEN`
  (refused; zero rows).
- **No-send safeguard:** zero `messages` rows for the contact; no lead-reply draft; the form carries no alert
  address. $0 spend, no provider effects.

**Seam found (design-confirmed, not a defect):** authenticated SQL cannot publish a form directly — the customer
publish path is the approval door (Chat tool or Studio panel → `growth-publish-command`). OWED: an authenticated
browser drive of that door (owner or QA session), plus the member no-names view and ambiguous-tag cases live
(today covered by the CI pgTAP suite `campaign_lead_attribution.sql`, not live-driven; the account has no second
member). Visit linkage (`growth-public-visit`) was not exercised live.

**Fixture retention:** brief CB-20DEBF, its form and the two submissions stay on the designated account as the
standing QA fixture for the next slices (S1e chat read, S2 roll-up, S3 reply UI) — clearly named, zero-cost,
no-send.

## 14. Successor lead checkpoint — 2026-10-26 (Claude Code, replacing the zCod lead)

**Identity.** One Claude Code session (cloud). Branch `claude/great-heisenberg-u7kyd9` cut from main `ae12ff14`
(main was `e8197859` at start; it became `ae12ff14` when #2923 merged). The zCod lane is superseded for new
implementation, and its branches, PRs, reviews and evidence are preserved. The predecessor's local
`exp03-f8-records` checkout was not touched.

**Scope ACK.** The successor accepts the complete assignment:
- F1–F9, S1–S6 and WEB01–14;
- every mapped original alias (annex below, by Map row);
- the CRM, Communications, Marketing, Ads, AI Sales and Appointment Setter experience;
- the owner's full email/newsletter/mailbox mandate (SendGrid, tenant PAIGE Email, custom domains, Gmail,
  iCloud), and the webinar chain;
- the owner's whole-matrix reconciliation (ANT-87 `d16287be`).

It does not narrow any of them. NEXUS stays the existing product specialist under PAIGE. No new agent or runtime.

**Grounded at start (artifacts, not beliefs).**
- Production `schema_migrations` frontier is `20271116010202`. The E02 `010102`/`010202` pair is applied; E09's
  `10309` is next by agreement (ANT-161 `0b9dc19f`, `843d3f3e`). EXP03 needs no migration for its next
  deliverable.
- The live `get_campaign_brief_leads` carries the F8 fields.
- Production has 1 `email_campaigns` row, 0 recipients and 0 sends ever (read-only, 2026-10-26).
- Open EXP03 PRs at start: #2923, #2131, #2152. No other EXP03 branch has unmerged work in flight.
- **Inaccessible, stated exactly:**
  - The Drive connector returns the Delivery Evidence Register only as a sampled table summary. Sheet
    cells, Map K:AB, WEB rows and Assignment Locks cannot be read or written cell by cell from this session.
    The Map and Locks rows are therefore **not updated by this checkpoint**. This section is the source-side
    record until a session with Sheets cell access (or the Coordinator) transcribes it.
  - Linear ANT-87/ANT-161 read normally.

### 14.1 Inherited PR dispositions

| PR | Disposition |
|---|---|
| [#2923](https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/2923) F8 records | Reviewed **NON-AUTHOR** on exact head `4b00bc0`. The production claim was re-read: `20271116010000` is applied and the live read carries the F8 fields. All required checks were SUCCESS (Preview SKIP for a docs-only change). **Merged** `ae12ff14`. Receipt: [#2923 comment](https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/2923#issuecomment-6425223336). It closes the #2917 row, so it is not logged recursively. |
| [#2131](https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/2131) S3 backend closeout | **Not merged; reconciliation owed.** Its base is `5c90859` (2026-10-14), 12 days stale. Its content is still absent from main: master §4.0 has no `f2e2a0af6` release row, and master line ~3828 still reads "NOT merged or live". The successor will port only facts it re-verifies on current main into a fresh records PR, then close #2131 as superseded with a link. It will not merge the stale branch blind. |
| [#2152](https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/2152) SendGrid-only directive (2026-10-14) | **Not merged; reconciliation owed.** The owner's 2026-10-14 ruling (SendGrid replaces Resend for platform, tenant PAIGE Email and campaigns) is still unrecorded on main. Current source still sends managed campaign mail as `provider:'resend'` (`_email_resolve_sender`). The same fresh-records approach as #2131 applies: re-verify the inventory against current source and official provider docs, then supersede. |

### 14.2 Next coherent safe deliverable — started and proven in this checkpoint

**Email campaign lifecycle negatives** (`supabase/tests/email_campaign_lifecycle.sql`, 86 assertions, rolled
back, synthetic test tenants). It runs in the required `database-contract` job (`paige-spine-contract.yml`)
through `supabase test db`, and `src/__tests__/email-campaign-lifecycle.test.ts` pins that wiring and the plan count.

Before it, no database-contract suite drove the campaign lifecycle. The E09 suite covers portal audience and
Updates consent only. The new suite proves, through the real seams:
- a saved draft reopens as saved;
- members and another business are refused (campaigns, versions and recipients unreadable to them);
- a filed version is frozen;
- a stale approval (version replaced, or hash mismatch) and a generic queue approve are refused;
- approval needs a signed-in owner or admin: an admin seat approves, and a call with no signed-in person is
  refused by the function body (`not_signed_in`), not only by the grant;
- PAIGE's filing waits for a person: she replays her own filing and cannot take over an owner's filing.
  The database does not stop a JWT-bearing caller from approving; what keeps PAIGE from approving is that
  approve is not one of her registered capabilities (`_shared/paige-spine/domains/email_campaigns.ts`);
- decline from the seam and the owner's own RLS-scoped decline from the approvals queue both return a draft;
- suppressed and opted-out people are excluded at plan, and both are re-checked at send after approval;
- an expired lease becomes `outcome_unknown` and is never handed out again;
- a duplicate record is refused;
- cancel mid-send refuses the leased hand-off, and a held-back (deferred) send under the cancelled campaign is
  never claimed again;
- settle reads the rows;
- a resend never re-plans anyone sent or outcome-unknown.

**Evidence, by class:**
- **Automated (local, replayed schema):** the full 1,479-migration replay on Supabase CLI 2.109.1 (CI's
  version) passes 86/86 via `supabase test db`, six repeated runs (recipient ids are random; the suite
  does not depend on their order).
- **Mutation proof (§71.4):** ten defects were reinstated one at a time, and each turned specific assertions
  red. The restored baseline is 86/86.
  - M1: the send-time suppression re-check removed.
  - M2: an expired lease returned to planned.
  - M3: the approve skips both hash checks.
  - M4: a record accepts a repeat.
  - M5: a resend ignores who was reached.
  - M6: the approval-guard trigger disabled.
  - M7: the frozen-version trigger disabled.
  - M8: the queue-decline withdrawal trigger disabled.
  - M9: the claim ignores campaign status (found by the independent review: the first version's
    "never claimed again" assertion could not fail, because nothing was left planned).
  - M10: the approve body no longer requires a signed-in person (the first version asserted the grant's
    refusal instead of the body's).
  - The first M1 and M3 mutants were operator-precedence no-ops and were corrected before counting.
  - One finding: removing only the re-derived hash comparison is masked by the stored-hash comparison. That is
    defense in depth, not a gap.
- **Not reached:** CI on the exact head (pending), production grants (CI reproduces them; the local run did
  not), any provider send, authenticated customer drive and founder evaluation.

**Independent review:** a separate reviewer agent, given the code rather than my conclusions, found 2 MAJOR
and 9 MINOR issues, all in the proof and this record, none in product code. All were fixed in this PR: a
vacuous cancelled-claim check, a grant-dependent signed-in check, a NULL-able hand-off id, an error-tolerant
`isnt`, a superuser stand-in for the queue decline, header overclaims, campaign-scoped claim assertions, and
vitest counting, comment matching and address checks.

**No defect was found** in the lifecycle seams, so no product change ships with this proof.

### 14.3 Original matrix — retained, with successor classification

**Legend:**
- **WORKING (source)** — shipped source with production objects. Authenticated customer proof is still owed
  unless stated.
- **PARTIAL** — a named subset works.
- **MISSING** — searched and absent; the terms searched are listed.
- **DECISION** — needs an owner/provider decision.
- **HELD** — waits on another owner's producer.
- **UNVERIFIED** — not yet grounded by the successor. Kept as an open row, never closed by inference.

No row is closed by a group label.

**F1–F9 / S1–S6 (this document's §4/§10, current state).**
- **F1** Set acquisition goal: WORKING. The builder works and chat `campaign.create`/`.revise` are registered.
  Typed chat is active v2 (2026-10-23). The structured numeric target is E02's store: DECISION (§8).
- **F2** Recommend strategy: PARTIAL, judgement only. S6 is owed.
- **F3** Assets + capture: WORKING. Studio/forms/S2a embed, and the UI attach works. Chat attach is MISSING
  (O4).
- **F4** Approve: WORKING. S4a `prepare_action` (#2889). S4b process activation needs an owner-seen design:
  DECISION.
- **F5–F6** Capture + attributed report: WORKING and live-reproduced (§13). S1e chat read (#2774).
  Authenticated owner drive is owed.
- **F7** Follow-up / book: PARTIAL. The S3 backend is live but inert. The approval-row remainder shipped
  (#2846). The reply screen is owed (owner design). Booking→deal is NOT CONNECTED (E05 writer, E04
  `2e30b7f5` constraint).
- **F8** To customer: PARTIAL. The read side shipped (#2917, records #2923). The agreement/invoice/booking
  link writers are Sales/E04/E05: HELD.
- **F9** Measure: PARTIAL. S2 credited counts reach the COO review (#2801). CAC/ROAS is UNAVAILABLE (no
  spend source).
- **WEB01–14:** retained unchanged. The rows are not readable cell by cell here (see Grounded), so per-row
  reconciliation is owed.

**Mapped annex (by Map row → original ID).** Evidence names the source seam. "Searched" lists the terms
grepped across `supabase/functions` and `src`.

| Map row | Original ID | State | Evidence / gap · owner |
|---|---|---|---|
| 64 | CAP-063 Ad Copy Draft | PARTIAL | `draft_marketing_content` is draft-only. An ad-format draft is UNVERIFIED. No ad launch (DECISION) |
| 67 | CAP-066 Campaign Plan | WORKING | `campaign_briefs`/`configure_campaign_brief`; Spine `campaign.create/revise/list/leads` |
| 69 | CAP-068 Email Newsletter Draft | WORKING (draft) | `email_campaign_draft` (kind `newsletter`), consent gate; lifecycle proven §14.2; live delivery DISABLED |
| 70 | CAP-069 Email Sequence Design | WORKING (draft) | `email_series_draft` (E3c), approval human-only; sends disabled; recurrence HELD |
| 71 | CAP-070 Landing Page Copy | WORKING | Studio page generation (E06/E07 shared publisher); copy embedded per §19 |
| 129 | FLOW:CRM | PARTIAL | `crm-command` contact/company/deal/task actions + chat `crm_*` tools; per-row below |
| 130 | FLOW:COMMS | PARTIAL | governed email door, Conversations, `send-sms`, calling setup, Gmail read/organize; live SendGrid disabled |
| 131 | FLOW:MARKETING | PARTIAL | F1–F9 above |
| 195 | 2 Contact creation | WORKING | `crm_create_contact`, `contact.create`, form intake → `create_contact` |
| 198 | 5 Business email sending | PARTIAL | `comms.email_send` door; Accepted≠Delivered (#2796); SendGrid events pending the webhook-admin credential (DECISION) |
| 200 | 7 Follow-up creation | PARTIAL | `crm_create_task`; S3 `owner.lead_followup` draft (inert until opted in) |
| 202 | 9 Contact editing | WORKING | `crm_update_contact`, `update_contact` |
| 203 | 10 Contact assignment | WORKING | `contact.assign_owner` / `assign_coach` |
| 204 | 11 Deal creation | WORKING | `deal.create`; intake files deals (S1b) |
| 205 | 12 Deal/contact association | PARTIAL | `deal.assign_contact`. Booking↔deal NOT CONNECTED (E05/E04, HELD) |
| 233–235 | Contacts manual UI (15, 16) | UNVERIFIED | Clients surface (E02/CRM-owned). EXP03 consumes it; drive owed |
| 236–238 | Contact creation in Chat (17, 18) | WORKING (source) | `crm_create_contact`; authenticated chat drive owed |
| 248–250 | Conversations (25, 26) | PARTIAL | form inquiries join (#2172); composer bypasses the door (O12) — REPAIR owed |
| 251–253 | Marketing (27, 28) | PARTIAL | F1–F9 |
| 254–256 | Ads (29, 30) | PARTIAL | `ads.lead_funnel` read only; launch/spend MISSING (DECISION) |
| 338 | PCO-CRM-001 Find contact | WORKING | `crm_search_contacts` |
| 339 | PCO-CRM-002 Create contact | WORKING | as row 195 |
| 340 | PCO-CRM-003 Update details | WORKING | as row 202 |
| 341 | PCO-CRM-004 Merge duplicates | PARTIAL | governed merge lineage (`20270204000000`, `20270320000000`); the owner-facing merge flow is UNVERIFIED |
| 342 | PCO-CRM-005 Assign ownership | WORKING | as row 203 |
| 343 | PCO-CRM-006 Tag and segment | PARTIAL | `email_segment_save` + rule keys; the contact tag writer is UNVERIFIED |
| 344 | PCO-CRM-007 Customer timeline | PARTIAL | `crm_clients.client_rail`, `crm_get_contact_summary`; completeness UNVERIFIED |
| 345 | PCO-CRM-008 Qualify lead | MISSING | no evidence-based qualifier; ALG-05 not verified |
| 346 | PCO-CRM-009 Score lead | MISSING | ALG-05 gap |
| 347 | PCO-CRM-010 Create opportunity | WORKING | as row 204 |
| 348 | PCO-CRM-011 Move stage | WORKING | `deal.move`, `crm_update_pipeline_stage` |
| 349 | PCO-CRM-012 Link deal | PARTIAL | `deal.assign_contact`, `company.create`; deal↔company link UNVERIFIED |
| 350 | PCO-CRM-013 Stale opportunities | UNVERIFIED | `crm_pipeline_summary` may cover it |
| 351 | PCO-CRM-014 Prepare follow-up | PARTIAL | S3 reply draft |
| 352 | PCO-CRM-015 Schedule follow-up | PARTIAL | task with due date; scheduler is E05 |
| 353 | PCO-CRM-016 Churn risk | UNVERIFIED | E02 consumer |
| 354 | PCO-CRM-017 Close won/lost + reason | PARTIAL | `deal.close`; reason capture UNVERIFIED |
| 355 | PCO-CRM-018 Account commitments | UNVERIFIED | E04/E05 sources |
| 356 | PCO-COMMS-001 Unread business inbox | PARTIAL | `inbox_list`, `comms.message_content_read`; sync state UI MISSING (O11) |
| 357 | PCO-COMMS-002 Private mailbox | PARTIAL | Gmail personal read/organize (#1880), mailbox-owner-private |
| 358 | PCO-COMMS-003 Find thread | PARTIAL | `inbox_list` |
| 359 | PCO-COMMS-004 Draft reply | PARTIAL | chat draft; S3 reply draft; reply screen owed |
| 360 | PCO-COMMS-005 Review recipient/sender | PARTIAL | confirm card + door binding; reply-screen states (O7) owed |
| 361 | PCO-COMMS-006 Send approved email | PARTIAL | door in code; SendGrid live DISABLED; campaign path proven §14.2 (no send) |
| 362 | PCO-COMMS-007 Delivery outcome | PARTIAL | #2796 labels; provider events DECISION (credential) |
| 363 | PCO-COMMS-008 Gmail OAuth | PARTIAL | `gmail-oauth-start/callback`; revoked grant still shows Connected (O10 REPAIR); send scopes DECISION |
| 364 | PCO-COMMS-009 iCloud Mail | MISSING | no IMAP; SMTP 587 blocked; `EmailIntegrationConfig` unmounted (O13). E10 + DECISION |
| 365 | PCO-COMMS-010 Tenant PAIGE Email | PARTIAL | SendGrid door + sender integrity source; auto-provisioned mailbox MISSING (DECISION: domain/provider/cost) |
| 366 | PCO-COMMS-011 SMS to consenting contact | PARTIAL | `send-sms`, `paige_suppressions`; per-tenant A2P is E10; EXP03 consent wiring UNVERIFIED |
| 367 | PCO-COMMS-012 Business phone line | UNVERIFIED | `provision-tenant-twilio`, `voice-twiml` exist; Live/E10 lane |
| 368 | PCO-COMMS-013 Transfer call | MISSING | searched `call_transfer`, `transfer_call`, `warm_transfer`: 0 |
| 369 | PCO-COMMS-014 Outbound call | MISSING | searched `outbound_call`, `place_call`, `start_call`: 0; `voice-access-token` role UNVERIFIED |
| 370 | PCO-COMMS-015 Opt-outs/suppress | PARTIAL | campaign plan + send suppression proven §14.2; SMS STOP (`handle-inbound-sms`) UNVERIFIED |
| 371 | PCO-COMMS-016 Multi-contact outreach | PARTIAL | campaign lifecycle proven §14.2; sends disabled |
| 372 | PCO-COMMS-017 Attachments | UNVERIFIED | the door forwards attachments; safety scanning UNVERIFIED |
| 373 | PCO-COMMS-018 Sensitive escalation | UNVERIFIED | `comms.support_cases_read` (E09) |
| 374 | PCO-COMMS-019 Response times | MISSING | no producer found; E02/E09 |
| 375 | PCO-COMMS-020 Voice-call outcomes | UNVERIFIED | Live lane |
| 376 | PCO-MKT-001 Brief | WORKING | row 67 |
| 377 | PCO-MKT-002 Audience segment | WORKING | segments + preview; exclusion proven §14.2 |
| 378 | PCO-MKT-003 Capture form | WORKING | `growth_form.save` |
| 379 | PCO-MKT-004 Publish funnel | WORKING | `growth_form.publish` door; S2a embed |
| 380 | PCO-MKT-005 Attribution | WORKING | S1a stamp, live-reproduced (§13) |
| 381 | PCO-MKT-006 Welcome sequence | WORKING (draft) | `email_series_draft` kind `welcome` |
| 382 | PCO-MKT-007 Automated nurture | PARTIAL | series engine; S4b activation design owed (DECISION); recurrence HELD |
| 389 | PCO-MKT-014 Paid ads performance | MISSING | no in-product spend producer; E10 provider |
| 390 | PCO-MKT-015 Ad-launch proposal | MISSING | DECISION |
| 391 | PCO-MKT-016 Approve/pause ad | MISSING | DECISION |
| 392 | PCO-MKT-017 Compare acquisition | PARTIAL | #2801 credited counts; CAC/ROAS UNAVAILABLE |
| 393 | PCO-MKT-018 Experiments | UNVERIFIED | not grounded |
| 395 | PCO-MKT-020 Webinar promotion | PARTIAL / HELD | grounding `99923e05` (dated); attendance producer unnamed |
| 529 | PCO-LIVE-014 Phone-to-human | MISSING | transfer absent (row 368) |
| 530 | PCO-LIVE-015 Inbound business call | UNVERIFIED | `twilio-inbound-webhook`, `voice-twiml` |
| 531 | PCO-LIVE-016 Post-call update | UNVERIFIED | not grounded |
| 532 | PCO-LIVE-017 Recording consent | MISSING | searched `call_recording`, `recording_consent`: 0 |
| 533 | PCO-LIVE-018 Outbound voice spend | UNVERIFIED | `paige_voice_budget_control` (scope to confirm) |
| 552 | PCO-CUSTOMER-001 Answer lead question | UNVERIFIED | E09 CURA / site chat |
| 553 | PCO-CUSTOMER-002 Qualify caller | MISSING | no voice qualifier |
| 554 | PCO-CUSTOMER-003 Book caller | PARTIAL | `public-booking` creates a contact, no deal; voice booking MISSING |
| 584 | PCO-COMMERCE-005 Abandoned checkout | MISSING | searched `abandoned_checkout`, `checkout_abandon`: 0; checkout is E04 |
| 585 | PCO-COMMERCE-006 Retention offer | MISSING | searched `retention_offer`, `winback`: 0; `reengagement` campaign kind exists |
| 597 | J03 Lead → booked appointment | PARTIAL | booking→deal HELD (E05/E04) |
| 604 | J10 Correct CRM data | PARTIAL | `crm_update_contact`; authenticated drive owed |
| 607 | J13 Gmail/iCloud workflow | PARTIAL | Gmail read/organize; iCloud MISSING |
| 608 | J14 Inbound phone lead | UNVERIFIED | Live lane |
| 612 | J18 Ad campaign closed loop | MISSING | no launch/spend |

**Appended email subcases (owner mandate; original IDs untouched):**
- **E-1 to E-9 (campaign lifecycle):** draft save/reopen, member/foreign refusal, freeze, stale refusal,
  owner-or-admin-only approve, PAIGE's filing waits for a person, decline, suppression and opt-out at plan and
  send, unknown/duplicate/cancel/resend.
  WORKING (source) and proven §14.2. No live send.
- **E-10 SendGrid account integration:**
  - PARTIAL: the door, receipts and sender integrity are live but inert.
  - DECISION: the scoped webhook-admin credential.
  - The Resend→SendGrid managed-sender cutover is #2152 reconciliation.
- **E-11 Auto-provisioned tenant mailbox:** MISSING. Decision package owed: domain strategy, provider,
  per-mailbox cost, sender vs alias vs full mailbox.
- **E-12 Custom domain:** existing-mailbox connection and new-mailbox provisioning are both MISSING (E10 + E06
  DNS). No silent MX/SPF/DKIM/DMARC change.
- **E-13 Gmail send/manage scopes:** DECISION (consent/app review). Read/organize is shipped.
- **E-14 iCloud Mail:** MISSING. Current Apple authentication/transport requirements need re-grounding from
  official docs with E10.
- **E-15 Inbound replies → Conversations:** PARTIAL (the form-inquiry path ships). Campaign-reply threading is
  UNVERIFIED.
- **E-16 Attribution of email to outcomes (E02):** PARTIAL. Opens/clicks are bounded signals only.

**Algorithm support (canonical IDs, actual maturity):**
- **ALG-05** lead prioritization: **NO VERIFIED SUPPORTING ALGORITHM IDENTIFIED — GAP OR VERIFICATION OWED.**
- **ALG-09** attribution/acquisition:
  - PARTIAL. Signals: form link + `utm_campaign`.
  - Logic: the deterministic S1a rule (`form_and_tag` / `form_link` / `campaign_tag` / `ambiguous`, never
    guessed).
  - Output: a stamped lead, live-reproduced.
  - The spend/conversion side is MISSING, so it is not paid optimization.
- **ALG-10** communication timing/channel:
  - PARTIAL. Signals: consent, suppression, opt-out, the daily cap and the `deferred` pre-send hold.
  - Logic: eligibility at plan and re-check at send, proven §14.2.
  - Timing/channel selection: **NO VERIFIED SUPPORTING ALGORITHM IDENTIFIED — GAP OR VERIFICATION OWED.**
- **ALG-01/08/11/12/13:** apply only where wiring is shown. None is newly claimed here.

### 14.4 Held effects — decision table (independent work continues)

| Effect | Actor / authority | Exact ask | Cost / effect | Rollback | Work that continues meanwhile |
|---|---|---|---|---|---|
| SendGrid provider events + first real send | Owner supplies the scoped webhook-admin credential; an admin runs the broker prepare (no key in chat or docs) | The credential scope as in the S7.4 package | No new spend beyond the standing account; enables delivery evidence | The existing disabled/enabled boundary | Lifecycle proofs, reply UI, Conversations REPAIR (O12) |
| Managed sender Resend→SendGrid | Owner ruling 2026-10-14 (#2152) recorded; engineering cutover | Confirm the P1–P11 order after re-grounding | Provider switch for platform/tenant mail | Resend ≤14 days per step (per #2152) | Re-grounding the inventory on current source |
| Tenant PAIGE Email mailbox | Owner: domain, provider, per-mailbox cost | A decision package (to be prepared) | Spend + DNS | Not provisioned until approved | Sender vs mailbox labels stay truthful |
| Gmail send/manage scopes, iCloud transport | Owner + E10 (consent/app review) | Scope list per operation | Provider review; no spend | Revoke/disconnect | Gmail O10/O15 REPAIRs |
| Ad launch/spend | Owner, per launch | Budget, account, campaign | Real spend | Pause | Proposal/approval design only |
| S4b process activation, S3 reply screen | Owner sees the design (§00) | A rendered prototype | None | Not activated | Source/backend negatives |

### 14.5 SendGrid delivery reporting — connected 2026-10-26; one door defect found and fixed

- **Owner action.** The owner configured SendGrid's Event Webhook by hand: enabled, signed, every event,
  pointed at `handle-sendgrid-webhook`. They installed `SENDGRID_WEBHOOK_PUBLIC_KEY`. The scoped admin key
  is not set (the broker reported 503 to the operator) and is not needed while the webhook is configured by
  hand.
- **Proof.** An unsigned probe changed from 503 `webhook_not_configured` to 401 `invalid_signature`.
  SendGrid's "Test Your Integration" events reached the door and passed the signature check, at
  20:16–20:17 UTC.
- **Defect.** Every test event was quarantined (503). Real `sg_event_id`s are URL-safe base64 with `=`
  padding (SendGrid's own examples, e.g. `6g4ZI7SA-xmRDv57GoPIPw==`). The door's check and
  `ingest_sendgrid_receipt` both refused `=`. On the real function the padded id is `invalid`, the
  normalized id is `processed`, and a redelivery is `duplicate`.
- **Fix.** The door drops the padding before forming the receipt id. Padding is fixed by length, so
  identity stays one-to-one and stable across redeliveries. No migration is needed.
- **Open, tracked:**
  - Delayed or asynchronous bounces carry no `sg_message_id`, so they are quarantined. That holds their
    batch for SendGrid's 24-hour retry window.
  - `unsubscribe` events are acknowledged but not recorded. **Closed by the owner, 2026-10-26:** SendGrid
    Subscription Tracking is OFF, so SendGrid neither adds its own unsubscribe link nor suppresses on it;
    Paige's consent and suppression stay the only record.
  - SendGrid's Google Analytics link tracking could have rewritten the UTM tags Paige attributes campaigns
    by. **Closed by the owner, 2026-10-26:** Google Analytics tracking is OFF.
  - Campaigns still send managed mail through Resend. The SendGrid-only cutover the owner re-confirmed on
    2026-10-26 is the next email deliverable (§14.6).
- **Merged and deployed:** #2937 (`146cf565`); `deploy-edge-functions` run #864 succeeded at 21:21 UTC.
  **Owed:** a re-run of SendGrid's "Test Your Integration" and a production log readback of 200s.

### 14.6 Campaign email on SendGrid — the lane, built inert (2026-10-26)

**Grounded on production first (read-only, 2026-10-26):** 1 campaign, 0 recipients sent; 9 email
connectors, all `resend` (7 active); 1 `tenant_email_domains` row, 0 SendGrid-verified. Campaign
delivery analytics today come from Resend receipts only (`process_resend_receipt` writes
`email_campaign_recipients.*_at`); SendGrid receipts correlated only to governed replies. **Moving
campaigns to SendGrid before this lane would have erased campaign analytics for every business** (§58).

**Owner input (2026-10-26):** AWS is also available ("green light to use it"). Not used: nothing in the
repo uses AWS (searched `amazonaws`, `SES`, `sesv2`, `aws_ses`, `AWS_ACCESS_KEY` across
`supabase/functions`, `src`, the config registry — absent), while the SendGrid door, signed webhook and
receipt journal are built and connected. SES remains a later cost option, not a blocker.

**Built (migration `20271116020000`, `send-message`):**
1. A campaign may name a SendGrid sender only when its domain is SendGrid-verified for that business
   (`_email_resolve_sender`, the one sender resolver for draft, approval and claim). It is PAIGE-paid.
2. `email_campaign_sendgrid_admit` — send-message's only new SendGrid admission (security H2 otherwise
   unchanged): the recipient the dispatcher leased right now, its own address, the campaign's approved
   connector, still SendGrid, still verified for this business. The send carries
   `paige_tenant_id` + the recipient id as `paige_operation_id`/`paige_message_id`.
3. SendGrid events land on the recipient row (delivered/opened/clicked/bounced/complained, first time
   wins) only when the provider id, all three claims and the address match a SendGrid-sent recipient.
   Hard bounce and complaint suppress; a `blocked` bounce counts as bounced and suppresses nobody. An
   event for a recipient still being handed over is redelivered; one for a recipient recorded sent
   without an `X-Message-Id` supplies the id. A thrown/5xx SendGrid answer is `outcome_unknown`, so it is
   never sent twice (SendGrid has no idempotent replay).
4. A sent campaign email is metered under the provider that sent it.

**Evidence (local, full replay):** `email_campaign_sendgrid_lane.sql` 70/70; 11 mutants of the
migration each fail it; the governed-reply receipt proof (91 assertions) now replays this migration
after 20271031000200, so it runs against the new ingest in CI; lifecycle 86/86, E09 audience 84/84,
the psql receipt/door/integrity/marketing/domain proofs pass; `send-message-campaign-sendgrid.test.ts`
7/7 (3 fail on the old send-message; 2 mutants caught); `deno check send-message` clean on base and
head; the PAIGE Spine registry lint and its self-test pass with the `send-message` source digest
renewed (old digest reproduced from main first).

**Independent review (§39, author-dispatched, lower assurance): no blocker.** Fixed: a complaint or hard
bounce about an `outcome_unknown` send still suppresses the address (without moving totals); the
governed-reply proof now exercises the new ingest; campaign sends ask SendGrid to track opens and clicks
per message; untested refusals (signed-in subject under the service role, connector switched off, From
changed, expired lease, cancelled campaign) and an untyped bounce are now proven. Left as tracked, by
choice: `dropped` events stay journal-only (SendGrid drops to its own lists; no column); an unconfirmed
send's audit row reads `failed` (the audit `status` vocabulary has no unknown) while the campaign row
reads `outcome_unknown`; the admission is not single-use (only the service role can ask, and the worker
begins each recipient once).

**Still not live, by design.** No business has a SendGrid sender. Next, in order: (a) Paige's own
managed sender on SendGrid — needs the authenticated SendGrid domain from the owner; (b) a business
verifying its own domain in SendGrid (no automated writer exists; needs a domain-authentication-scoped
key and a per-business DNS ownership proof); (c) the owner signs off the first live campaign test send.
Tracked, not built: settling an `outcome_unknown` recipient from a later SendGrid event (it would change
a finished campaign's totals — an owner call); recording `dropped` events (no column).

**States kept separate:** source · review · exact CI · merge · deploy · configured · connected · activated ·
authenticated · founder. This checkpoint reaches **source + local automated proof** for §14.2 and **merge**
for #2923. Nothing else is claimed.
