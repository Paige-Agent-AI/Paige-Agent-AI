# UI delivery evidence: Ads showroom with the business's own pictures, and the shared pipeline lead funnel

Owner rulings, 2026-10-11:

1. The Ads › Overview showroom is approved: ad placements on a stage, plus a "Your channels" shelf. But
   the pictures must be the business's own ads, not one fixed image that everyone sees. The owner's
   featured pictures come first, then the best performers. Fixed sample art, labelled "Sample", only
   fills empty slots.
2. Sales pipelines are a lead's lifecycle, and Marketing, Sales and Ads read the same pipelines and
   stages.
3. Ads and Marketing count leads by pipeline stage, per campaign (utm_campaign) and per ad
   (utm_content), through one server read.

**What changed.**
- **Showroom (Ads › Overview).** The approved showroom keeps its look. Its placements now take the
  business's own pictures and videos (marketing_content, kind image|video) in this order:
  - featured by the owner, newest feature first;
  - then those whose tracking tag brought the most won deals, then the most leads, on the chosen
    pipeline and period (from the funnel's ad rows);
  - then the newest.

  Each placement's chip says why its picture is there: "Featured", "3 won · 11 leads", "Newest". The
  intro says plainly what ranks the pictures and names the pipeline. The first saved ad copy still
  fills the words.
- **Upload.** "Add a picture or video" is now a working upload for owners and admins. It goes through
  the one library seam, `uploadToLibrary` (studio.ts), so there is no second upload path. A picture
  uploaded during this visit takes the first placement, labelled "Just added". The notice says it
  stays there only if featured, and offers "Feature it".
- **Creative.** A new "Pictures and videos" section lists the library. Each card has "Feature in
  showroom", which calls `set_ad_creative_featured`. The switch changes at once and is undone if the
  save fails. The section shows "N of 6 featured", and the switch is disabled at the limit. Each card
  also had "Copy tracking tag"; it is now "Copy tagged link", with "Copy tag only" as the secondary
  choice (see the revision below).
- **The shared funnel (pipeline-lead-funnel.tsx).** It appears in Ads › Overview, below the showroom,
  and in Marketing › Analytics, after "From lead to opportunity". It has:
  - a pipeline picker: the default first, searchable when there are more than five, and it opens above
    the button when the space below is short;
  - deals by stage, drawn as centred bars, with won stages in green and lost stages muted;
  - a campaign table and an ad table: leads, open, won and lost. Ad rows show the picture's thumbnail
    and title; a tag with no name in the library reads "Library picture …abcd".

  The figures come from `get_pipeline_lead_funnel`. Only while that read is not deployed does the panel
  count the same shape from records it holds. That fallback is `deriveLeadFunnel` in ads-model.ts,
  using the submissions with their utm tags and the workspace's deals, and it says so: "The server
  count isn’t available yet…". A server read that fails shows "These counts couldn’t load" with Try
  again, never browser-worked counts (review revision). The window is Marketing's one "last N days"
  (`submissionsInPeriod`), so the funnel and the page's headline counts cover the same leads. Ads reads only the Sales pipelines (`useSoloCampaigns`
  scope "pipeline"), never Marketing's whole read.
- **Members.** Members see samples only, with no upload and no feature control. The library's RLS is
  admin-only, and the page says so.
- **The "Your channels" shelf** is unchanged and still honest: "Import isn’t available yet" or "Not
  available".

**Revision after the backend's contract v2 (commit 4835cbc20 on ads-intake-backend).** The integrator's
decisions, each delivered and tested:
1. **Ad rows.** The server now returns one row per ad, with `content_id`, `kind` and `image_url` when the
   tag is one of the business's own pictures. `parseLeadFunnel` reads that shape from the captured real
   answer (`src/solo/__fixtures__/lead-funnel.contract.json`, the §37 consumer check, exact counts
   asserted). Rows are keyed by ad (case-folded, so one key is never drawn twice). The showroom ranks
   performers by `content_id`, falling back to the tag. The records fallback counts the server's way:
   keys case-folded in their newest spelling, open/won/lost by last touch.
2. **The functions ship first, but the page asks once** (`ads-intake-capability.ts`): one funnel read
   for a null pipeline, which a deployed function refuses (42501) and a missing one cannot find
   (PGRST202). Any later "function not found" from either RPC counts too. When they are missing, "Feature
   in showroom", the featured count and "Feature it" are withdrawn, and the no-pipeline copy stops
   claiming a form's lead starts in a pipeline.
3. **Members.** The funnel is owners' and admins' (and an agency working in the business). A member, or
   anyone the server refuses, sees a short note, "Campaign results are for owners and admins", never
   zeros and never the records fallback. Ads asks the server nothing for a member. The showroom still
   shows its samples.
4. **Stages are current.** They are headed "Deals in each stage now". `leads.unfiled` is named: "N leads
   in the last 90 days didn’t reach a pipeline, counting any still being filed", with "See where your
   forms send leads" (Marketing › Overview, forms filter).
5. **Floors and loading.** A capped records count marks the showroom badges with "+", as the tables do.
   While another pipeline or period loads, the funnel keeps its figures, dimmed and marked "Updating…",
   and the showroom keeps its ranking instead of reshuffling.
6. **Marketing › Analytics footer:** "Won counts below are read from your Sales pipelines; deal value
   and revenue stay in Sales."
7. **"Copy tagged link"** is Creative's primary act per picture. It opens a chooser under the picture's
   row: one of the business's live pages, funnels or forms (from the same `useSoloCampaigns` read
   Marketing uses, mounted only while choosing), an optional campaign tag, and the full link shown as
   it will be copied. `taggedLink` keeps an existing query, replaces an existing utm_content or
   utm_campaign, and keeps the #fragment last. "Copy tag only" stays as the secondary choice.
8. **Live regions** stay mounted when empty (no `display:none`), so the first outcome is announced.

**Revision: forms with no route of their own land in the default pipeline (owner ruling 2026-10-11).**
The backend (migration 20271021042001, merged here from claude/upbeat-wright-j7m867) files the leads of a
form with no deal route of its own into the business's default pipeline, first open stage
(`growth_attach_submission_default_deal`), and `marketing.forms.unrouted_current` counts such a form as
routed while that pipeline can take a lead. The client rule did not know this, so Marketing told the owner
those leads went nowhere. Now:
1. **One rule** (marketing-overview-model.ts): `defaultPipelineTarget` picks what the server picks (the
   oldest non-archived default pipeline, then its first non-archived open stage by order);
   `defaultPipelineReady` is the server's `default_ready`; `pipelineRouteOf(form, ready)` answers own,
   default or none; `sendsToPipeline(form, ready = false)` keeps its old meaning for any caller that does
   not pass readiness.
2. **Marketing › Overview.** A default-routed form counts toward "Forms that route leads", gets no "Route
   it" and no "Needs you" item, and its capture card reads "Client work (default) → New enquiry" (the real
   pipeline and stage names). The summary sentence follows the same count; the Ask PAIGE prompt names the
   default pipeline and how many forms file into it. A form with no usable default keeps its honest
   wording, now ending "Setting a default pipeline in Sales would catch them" (or "Your default pipeline in
   Sales has no open stage to take them").
3. **The form panel** says "<Pipeline> (default) → <stage>. With no route of its own, this form files its
   leads in your default pipeline. Set a route below to send them to a specific pipeline instead." (or, for
   a form whose own route is skipped under an automation, what to change in Vibe Studio), plus "Each lead
   is also emailed to you." for an alert form. The route editor is unchanged.
4. **Marketing › Analytics** gives a form the same answer: a new "default" route state, worded with the
   default pipeline's name and not marked as a warning.
5. **Honest when undeployed.** All three only listen to the ads-intake question (no read of their own): if
   this page load learned the functions are missing, no form is said to land in the default pipeline and
   none is offered as the fix. A missing workspace is treated as no default.

**Frames** (`node scripts/live-drive/ads-department-drive.mjs`: the real shell, the real Ads route and
Marketing hub, fixture media, pipelines and server answers). Key frames are in
`assets/int342-ads-showroom/`:
- `showroom-1536-light.png`, `showroom-1366-dark.png`, `showroom-1024-light.png`,
  `showroom-900-dark.png`: the showroom at each size;
- `funnel-1536-light.png`, `funnel-900-dark.png`: the funnel from the server read;
- `funnel-fallback-light.png`: the records fallback when the function is missing;
- `showroom-member-dark.png`: a member's view;
- `showroom-uploaded-light.png`: an upload standing in the first placement;
- `creative-featured-light.png`: the feature switch on;
- `creative-tagged-link-light.png`: the tagged-link chooser, a form chosen, a campaign tag typed;
- `creative-unavailable-dark.png`: Creative with the ads-intake functions missing (no feature switch);
- `funnel-member-dark.png`: a member's note in place of the counts;
- `marketing-funnel-dark.png`: the same funnel in Marketing › Analytics.

The default-pipeline revision changes words and counts on existing rows, cards and the panel, with no new
layout; it has no new frames. It is proven by render tests (below), not by a drive.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding read the approved showroom (c892bd2b8), the Ads desk (marketing-ads.tsx, AdsWorkspace.tsx), the library read pattern (marketing-content.tsx), the upload seam (studio.ts uploadToLibrary), useSoloCampaigns (pipeline workspace, live pages and forms with their public links, submissions utm_json), Marketing Analytics, and, for this revision, the backend's contract v2 (migration 20271021042001 on ads-intake-backend 4835cbc20: the funnel body and COMMENT, set_ad_creative_featured's refusals, and the captured real answer). The default-pipeline revision read the merged migration 20271021042001 (growth_attach_submission_default_deal's pick and refusals, the default_ready rule in marketing.forms.unrouted_current) and growth-process-submission's appendDefaultIntake (any form whose plan runs no pipeline_attach gets the default step, alert-only and automation-only forms included). Actor-goal flows: an owner sees their own pictures placed and ranked; features one; uploads one; copies a tagged link to a live page or form (or the tag only); reads leads by stage for any pipeline, in Ads and in Marketing, and sees which leads reached no pipeline; a member sees samples and a note, never counts
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode, extending the owner-approved showroom (no new visual world). Solo tokens only; no gold (nothing here approves, spends or publishes). Native select and checkbox are not used: the picker is a listbox in a portal, and the feature switch is a toggle button with aria-pressed. One motion: the stage bars ease by transform when the pipeline or period changes, off under reduced motion
MATERIAL_FLOW_CHANGE: YES: the showroom's pictures come from the business's library ranked by feature and performance; upload, feature and copy-tagged-link are working acts; a pipeline funnel is added to Ads Overview and Marketing Analytics, owners and admins only
FLOW_PROTOTYPE: PASS: the owner approved the showroom design on 2026-10-11 and ruled on the data behind it the same day; this delivers that approved design wired to real data
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner or admin sees their own ads where they would run, chooses which ones stand there, adds new ones, and sees which campaigns and ads bring leads that become won deals on their Sales pipelines
VISUAL_DIRECTION: PASS: the approved showroom composition, motion and samples are unchanged. Own pictures take the placements, with a violet chip naming the reason. The funnel uses centred bars per stage (the pipeline's own shape) beside a campaign table, over a full-width ad table, inside the desk's card language
AUTOMATED_EVIDENCE: PASS: review revision (independent review of 4d878f0a9, SHIP with two MEDIUM items fixed here): a failed server read no longer falls back to records (marketing-analytics-funnel.render.test.tsx replaces the failed-with-floors test with "a failed server read shows as failed with Try again" plus a floors test under the not-deployed fallback); the window uses submissionsInPeriod (the Ads and Analytics tests assert p_since equals that period start, replacing a UTC-midnight check); visible copy drops raw utm_ names outside the literal value copied; the search placement shows yourwebsite.com instead of a domain made from the business name; the hover lift is guarded by reduced motion. Tests bite: the fallback restored turned 1 red; the old UTC window restored turned 2 red; all restored. Focused suites 168/168. Then default-pipeline revision, on its commit: marketing-overview-model.test.ts adds 3 tests (ready only with a non-archived default and a non-archived open stage: null, none, archived pipeline, archived stage, only won/lost stages, another pipeline's stage, draft default; the oldest default and its first open stage by order; own, default and none for four form shapes, and sendsToPipeline's old default); marketing-analytics-model.test.ts adds 2 (the "default" state, and the old states without readiness); growth2.render.test.tsx adds 3 (a default-routed form across the chain, Needs you, the capture card, the panel and Analytics; a default whose only open stage is archived keeps the old copy with the fix named; capability missing claims no default) and updates 4 Needs-you expectations for the appended fix. Tests bite: the old rule reinstated (no default route) turned 3 red; the archived-stage check dropped turned 2 red; the capability gate removed turned 1 red; all restored. Whole src/solo measured in separate worktrees: base 3e1ace5cc 252 files passed, 2 skipped, 3589 tests passed, 3 skipped; head 3597 passed, 3 skipped, 0 failed. Earlier, on 37b5f9947. ads-model.test.ts 22 tests, among them the contract v2 fixture read with exact counts (pipeline, current stages, leads total 11 / tagged 9 / untagged 2 / unfiled 4, the three campaigns with last-touch outcomes and stage spread, six ad rows in server order with the one matched picture), a showroom ranked by content_id from that fixture, last-touch and case-folded records derivation, one ad under two campaigns kept as one row, duplicate keys merged on parse, and taggedLink (query kept, utm replaced, #fragment last, non-http refused). marketing-ads.render.test.tsx 35 tests, among them: capability present and missing (no feature control, no featured count; tagging still offered), no-pipeline copy in both states, member note with nothing read and no zeros, "Deals in each stage now" and the unfiled line with its routing link, stale figures and unchanged showroom while another window loads, "+" badges from a capped read, one row per ad with no duplicate-key warning, archived refusal, withdrawal after a PGRST202 from featuring, the tagged-link chooser (destinations, radio keys, campaign tag, exact URL copied, focus returned) and its empty state, "Copy tag only", live regions mounted when empty. marketing-analytics-funnel.render.test.tsx 7 tests (server read with unfiled and routing link, the reworded footer, a server-matched picture drawn with its thumbnail, a refusal shown as the note, a failed read with floors, no-pipeline copy by capability). Test doubles for the capability question were added to growth2.render.test.tsx and sales-ops.contract.test.tsx, which render the funnel's empty state and forbid network. Tests bite: 11 deliberate mutations (every touch instead of last, unfiled dropped, duplicate ad keys kept, feature shown when missing, no-pipeline copy ignoring the answer, refusal falling back, figures cleared while loading, badges without "+", live region hidden, tagged link dropping query and fragment, member funnel read) each turned a suite red; all restored. Whole src/solo, measured on both trees in separate worktrees: base 793dc2ae5 249 files passed, 2 skipped, 3520 tests passed, 3 skipped; head 37b5f9947 249 files passed, 2 skipped, 3541 tests passed, 3 skipped, 0 failed
STATIC_EVIDENCE: PASS: default-pipeline revision: tsc ratchet baseline 10, current 10; eslint on the 8 changed files 0 errors, 5 warnings, all pre-existing (react-refresh/only-export-components at marketing-overview.tsx 26 and 74 and growth2.tsx 37, and growth2.tsx's two exhaustive-deps); Solo parity guard PASS (SP1–SP5). Earlier, on 37b5f9947. tsc ratchet baseline 10, current 10 (it first caught one new TS2339 in a test, fixed before commit). eslint on the 16 changed source, test and harness files: 0 errors, 7 warnings, all react-refresh/only-export-components or the two pre-existing exhaustive-deps warnings in growth2.tsx. impeccable@4.1.0 detect on the changed UI files exits 0 with no findings. Solo parity guard PASS (SP1–SP5; its SP4 first flagged a nil-UUID literal in the capability probe, replaced by a null pipeline id). tier-feature lint passes. The gold lint's one finding is pre-existing (BusinessCreditDashboard.tsx)
RENDERED_EVIDENCE: PASS: on 37b5f9947, ads-department-drive passed 245/245. It ran the real shell at 1536x770, 1366x768, 1024x768 and 900x1000, in both themes, with the rail open and folded. Every frame asserts: the feed shows the featured picture, the story the top performer ("3 won · 11 leads", matched by content_id), the display banner (where the container shows it) the next performer; each image actually loaded; the search ad carries the saved copy; the funnel draws the default pipeline from the server read with five stages under "Deals in each stage now", and names "3 leads in the last 90 days didn’t reach a pipeline"
BEHAVIORAL_EVIDENCE: PASS: the drive, in both themes: a member sees four samples, no upload, and the "Campaign results are for owners and admins" note with no stages; feature in Creative moves the picture to the first placement; Copy tagged link chooses the second live destination, takes the campaign tag "Spring Promo", and the clipboard holds exactly the shown link with utm_content=<the picture's id> and utm_campaign=Spring Promo, the copy is announced and the chooser closes; with the functions missing (?funnel=missing) Creative shows no feature switch and four tagged-link buttons; uploading files a picture into the first placement as "Just added"; choosing Retainers redraws the funnel; with the read missing the records fallback draws with its note; Marketing › Analytics draws the same funnel. Harness only: the RPCs answer from fixtures in the contract v2 shape
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the backend migration (20271021042001) is reported live by the integrator but was not checked from here; the page was exercised only against the captured contract answer and harness fixtures
KEYBOARD_FOCUS: PASS: the picker button opens a listbox that takes focus (or its search box when there are more than five pipelines); ArrowUp, ArrowDown, Home, End and Enter choose, and Escape closes and returns focus to the button. "Copy tagged link" is a button with aria-expanded and aria-controls; its chooser takes focus on the chosen destination, the destinations are a radio group moved by the arrow keys, Home and End, Escape or Cancel closes it, and a copy returns focus to the opening button. Feature, copy-tag and upload are buttons with a violet focus ring; the file input is reached through its labelled button
ZOOM_REFLOW: PASS: the funnel's container query stacks it at 760px of content (funnel, then campaigns, then ads); the showroom keeps its approved reflow (the display banner drops below 1080px of content, so the third-ranked picture is seen in Creative there); the picker's list is capped to the viewport and flips upward near the bottom. No sideways overflow at any drive size
REDUCED_MOTION: PASS: the showroom's one authored settle is the approved one, off under reduced motion; the hover lift (transform and its transition) applies only under prefers-reduced-motion: no-preference, and reduced-motion users keep the shadow highlight; the funnel bars' transform transition is inside prefers-reduced-motion: no-preference. Videos never autoplay
STATE_COVERAGE: PASS: loading (skeletons for pictures, pipelines, counts, and the live pages in the chooser), updating (last figures dimmed and marked "Updating…", showroom ranking kept), empty (no pictures; no pipeline, worded by whether the ads-intake functions are deployed; no stages; no tagged leads; nothing live to link to), unfiled leads named, error (pictures, counts, pipelines, live pages, each with a retry), member or refused (a note in place of the counts), functions missing (feature controls withdrawn), fallback (server count not deployed, said in words; a failed server read is the error state with a retry), limit (6 featured), archived (refused in words), upload failure (the seam's own message, "nothing was saved")
TRUTHFUL_STATE_LABELS: PASS: no provider figure appears; "performing" means only leads and won deals from tagged links, each deal counted once under its last tagged lead (the footnote says so); stages say they are deals now; sample art is labelled "Sample"; fallback figures say they come from the records read here, with floors marked "+" in tables and showroom badges and "At least" in sentences; nothing that cannot succeed is offered once the functions are known missing, and the empty-pipeline copy claims routing only when they are deployed; members are told the counts are for owners and admins rather than shown zeros; the channel shelf still says import isn't available
SOLO_UI: YES: /solo/{account}/ads/overview, /solo/{account}/ads/creative, /solo/{account}/growth/analytics

SOLO_1536X770_PAIGE_CLOSED: PASS: showroom and funnel, both themes, rail open and folded, own pictures ranked, overflow 0 (ads-department-drive 245/245 on 37b5f9947)
SOLO_1536X770_PAIGE_OPEN: PASS: DRIVE_TABS=ads,analytics marketing-views-drive passed 640/640 on 37b5f9947, Ads and Analytics at docked and expanded PAIGE widths, overflow 0. That harness carries no pipelines, so its funnel shows the no-pipeline state; the populated funnel's reflow is the 760px container query proven at 900 and 1024
SOLO_1366X768_PAIGE_CLOSED: PASS: showroom and funnel, both themes, rail open and folded, overflow 0; all flows ran at this size (ads-department-drive on 37b5f9947)
SOLO_1366X768_PAIGE_OPEN: PASS: marketing-views-drive (ads, analytics) at docked and expanded PAIGE widths, overflow 0, 640/640 on 37b5f9947; same harness caveat as at 1536
SOLO_1024X768_PAIGE_CLOSED: PASS: showroom (display banner hidden by the approved reflow) and funnel, both themes, overflow 0 (ads-department-drive)
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: showroom stacked and the funnel stacked, both themes, overflow 0 (ads-department-drive)
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: the showroom shows the business's own ads, ones the owner features first and best performers next, with samples only where nothing real exists; Ads and Marketing read leads by stage on the same Sales pipelines, per campaign and per ad, from one server read
MUST_NOT_HAPPEN: one fixed picture for everyone; a sample mistaken for the owner's ad; a fabricated metric or any provider figure; publishing, spending, or reading an ad account; a second upload path; a member given upload or feature controls; a tenant-specific branch
MUST_PRESERVE: the approved showroom look and the channel shelf; the department strip (unchanged); saved ad copy previews and every existing desk state; the five Ads addresses; Marketing Analytics' existing panels; Ads never mounting Marketing's whole read
ACCEPTANCE_CRITERIA: once migration 20271021042001 is applied, an owner on the live app sees their featured picture in the feed placement and their best-performing tagged picture in the story, can feature, upload, copy a tagged link to a live page or form, and sees current deals by stage, the leads that reached no pipeline, and campaign and ad rows for any of their pipelines in Ads and in Marketing; a member sees a note instead of counts
MOTION_PURPOSE: the approved settle of the showroom's placements (unchanged); stage bars ease to their new length when the pipeline or period changes, so the change is legible
PROTECTED_SEAMS: tested: the Ads route and its read policy (AdsWorkspace.route.test; Ads Overview mounts only scope "pipeline", and the full Marketing read mounts only while the tagged-link chooser is open), the desk (marketing-ads.render.test), Marketing's hub (growth2 suites with a capability double; its funnel read is proven in marketing-analytics-funnel.render.test), sales-ops contract suite (capability double), useSoloCampaigns (unchanged)

INTERNAL_BUILD_IDENTITY: 37b5f99476db3d6c0ec00828ccb4a6657995bcb8 (tree 6d559a6961e3341f34e2aef16da1760a0787817e: the revision's code, tests, fixture and harness over 793dc2ae5; the whole src/solo suite, the lints and both drives ran on it); the next commit adds only this record's update and its refreshed frames; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; the backend contract is ads-intake-backend 4835cbc20, not applied; evidence=scripts/live-drive/ads-department-drive.mjs
RELEASE_CHANNEL: development: verified locally against the harness; not pushed
RELEASE_CLASSIFICATION: internal-only: a Solo Ads and Marketing UI change coded against the contract v2 RPCs, which ship first
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: the backend shipped first (#1998, main 9e02045; migration 20271021042001 confirmed on prod with its four functions and grants); if it were ever absent, the page learns the functions are missing and withdraws featuring, uses the records fallback, and does not claim default routing; authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c), with no tenant login in this session. The backend migration is applied on prod (read-only readback after #1998), but no signed-in live read was made here, so the real answer is proven only through the captured contract fixture; the null-id capability question is proven against the migration's body (a null id finds no pipeline and is refused) and the harness, not a live PostgREST call. The populated funnel was not driven with PAIGE expanded (that harness has no pipelines). The default-pipeline wording (Overview, the form panel, Analytics) is proven by jsdom render tests only: no drive or frame, and no live check that a real form with no route lands where its card says. The approved sample art reads two chart tokens (--chart-5, --chart-6) that Solo does not define as colours; left as approved (§28) and flagged to the owner. Deferred from review (LOW): the showroom draws from the 48 most recently touched pictures, so an older top performer outside them cannot take a placement and a just-unfeatured picture reads as newest; building performing picks from the funnel's own picture rows is a follow-up.
