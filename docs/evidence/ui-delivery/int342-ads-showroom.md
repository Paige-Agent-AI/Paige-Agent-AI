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
  also has "Copy tracking tag", which copies `utm_content=<content id>` with one line on how leads get
  credited.
- **The shared funnel (pipeline-lead-funnel.tsx).** It appears in Ads › Overview, below the showroom,
  and in Marketing › Analytics, after "From lead to opportunity". It has:
  - a pipeline picker: the default first, searchable when there are more than five, and it opens above
    the button when the space below is short;
  - deals by stage, drawn as centred bars, with won stages in green and lost stages muted;
  - a campaign table and an ad table: leads, open, won and lost. Ad rows show the picture's thumbnail
    and title; a tag with no name in the library reads "Library picture …abcd".

  The figures come from `get_pipeline_lead_funnel`. When that read is missing or fails, the panel
  counts the same shape from records it holds. That fallback is `deriveLeadFunnel` in ads-model.ts,
  using the submissions with their utm tags and the workspace's deals. It says so: "The server count
  isn’t available yet…" or "couldn’t load…". Ads reads only the Sales pipelines (`useSoloCampaigns`
  scope "pipeline"), never Marketing's whole read.
- **Members.** Members see samples only, with no upload and no feature control. The library's RLS is
  admin-only, and the page says so.
- **The "Your channels" shelf** is unchanged and still honest: "Import isn’t available yet" or "Not
  available".

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
- `marketing-funnel-dark.png`: the same funnel in Marketing › Analytics.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding read the approved showroom (c892bd2b8), the Ads desk (marketing-ads.tsx, AdsWorkspace.tsx), the library read pattern (marketing-content.tsx), the upload seam (studio.ts uploadToLibrary, growth-assets to marketing_content), useSoloCampaigns (pipeline workspace, submissions utm_json) and Marketing Analytics. Actor-goal flows: an owner sees their own pictures placed and ranked; features one; uploads one; copies a picture's tag; reads leads by stage for any pipeline, in Ads and in Marketing; a member sees samples only
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode, extending the owner-approved showroom (no new visual world). Solo tokens only; no gold (nothing here approves, spends or publishes). Native select and checkbox are not used: the picker is a listbox in a portal, and the feature switch is a toggle button with aria-pressed. One motion: the stage bars ease by transform when the pipeline or period changes, off under reduced motion
MATERIAL_FLOW_CHANGE: YES: the showroom's pictures come from the business's library ranked by feature and performance; upload, feature and copy-tag become working acts; a pipeline funnel is added to Ads Overview and Marketing Analytics
FLOW_PROTOTYPE: PASS: the owner approved the showroom design on 2026-10-11 and ruled on the data behind it the same day; this delivers that approved design wired to real data
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner or admin sees their own ads where they would run, chooses which ones stand there, adds new ones, and sees which campaigns and ads bring leads that become won deals on their Sales pipelines
VISUAL_DIRECTION: PASS: the approved showroom composition, motion and samples are unchanged. Own pictures take the placements, with a violet chip naming the reason. The funnel uses centred bars per stage (the pipeline's own shape) beside a campaign table, over a full-width ad table, inside the desk's card language
AUTOMATED_EVIDENCE: PASS: on 67d1e2a27. ads-model.test.ts: 13 tests (parse contract shape and reject others; records derivation per stage, window, campaign, ad; default-first picker; ranking incl. featured order, performers by won then leads, unsafe URL excluded, just-added first). marketing-ads.render.test.tsx: 25 tests, 14 new (ranking order rendered; fewer pictures leave samples; member sees samples and no controls; server funnel tables with picture names; records fallback with its note and no second missing-function call; picker default-first and period window; empty pipeline state; optimistic feature kept; limit and missing-seam rollbacks; 6-featured disables the rest; copy tag; upload flow incl. fresh upload first; failed upload message). marketing-analytics-funnel.render.test.tsx: 5 tests (server read, records fallback with utm_content, failed read named with floors, library-picture tag naming, no-pipeline state). AdsWorkspace.route.test.tsx 10 and growth2 suites pass. Tests bite: 8 deliberate mutations (rank order, no rollback, no fallback, member sees upload, upload not re-read, Marketing drops the ad tag, default not first, sample chip on own media) each turned at least one suite red; all restored. Whole src/solo directory on 67d1e2a27: 249 files passed, 2 skipped; 3520 tests passed, 3 skipped, 0 failed
STATIC_EVIDENCE: PASS: tsc ratchet baseline 10, current 10. eslint on the changed files: 0 errors, 8 warnings (6 pre-existing react-refresh and exhaustive-deps warnings in growth2.tsx, marketing-ads.tsx and the harness main.tsx; 2 new react-refresh warnings for the exported sinceFor and useLeadFunnel beside the panel components). impeccable@4.1.0 detect on the changed UI files exits 0 (it caught a width transition on the stage bars, fixed to transform). The full `detect src` exits 2 with 69 findings, none in a changed file. The Solo parity guard passes SP1–SP5. tier-feature lint passes. The gold lint's one finding is pre-existing (BusinessCreditDashboard.tsx)
RENDERED_EVIDENCE: PASS: on the committed tree, ads-department-drive passed 221/221. It ran the real shell at 1536x770, 1366x768, 1024x768 and 900x1000, in both themes, with the rail open and folded. Every frame asserts: the feed shows the featured picture, the story the top performer ("3 won · 11 leads"), the display banner (where the container shows it) the next performer; each image actually loaded; the search ad carries the saved copy; and the funnel draws the default pipeline from the server read with five stages
BEHAVIORAL_EVIDENCE: PASS: the drive, in both themes, feature in Creative moves the picture to the first placement; uploading a file files it and it stands in the first placement as "Just added"; choosing Retainers in the picker redraws the funnel; with the function missing (?funnel=missing) the records fallback draws with its note; Marketing › Analytics draws the same funnel; a member sees four samples and no upload. Harness only: the RPCs answer from fixtures
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the four backend RPCs are being built in parallel and are not deployed, so the live page would show the records fallback and "Featuring isn’t available yet" until they are
KEYBOARD_FOCUS: PASS: the picker button opens a listbox that takes focus (or its search box when there are more than five pipelines); ArrowUp, ArrowDown, Home, End and Enter choose, and Escape closes and returns focus to the button. Feature, copy-tag and upload are buttons with a violet focus ring; the file input is reached through its labelled button
ZOOM_REFLOW: PASS: the funnel's container query stacks it at 760px of content (funnel, then campaigns, then ads); the showroom keeps its approved reflow (the display banner drops below 1080px of content, so the third-ranked picture is seen in Creative there); the picker's list is capped to the viewport and flips upward near the bottom. No sideways overflow at any drive size
REDUCED_MOTION: PASS: the showroom's one authored settle is the approved one, off under reduced motion; the funnel bars' transform transition is inside prefers-reduced-motion: no-preference. Videos never autoplay
STATE_COVERAGE: PASS: loading (skeletons for pictures, pipelines and counts), empty (no pictures: samples and the upload; no pipeline: where leads will land; no stages; no tagged leads: how to tag), error (pictures failed with retry; counts failed with retry; pipelines failed), member (samples, no controls), fallback (server count missing or failed, said in words), limit (6 featured), upload failure (the seam's own size or type message, "nothing was saved")
TRUTHFUL_STATE_LABELS: PASS: no provider figure appears; "performing" means only leads and won deals from tagged links; sample art is labelled "Sample"; fallback figures say they come from the records read here, with floors marked "+" when the read is capped; featuring that isn't deployed says "isn’t available yet"; the channel shelf still says import isn't available
SOLO_UI: YES: /solo/{account}/ads/overview, /solo/{account}/ads/creative, /solo/{account}/growth/analytics

SOLO_1536X770_PAIGE_CLOSED: PASS: showroom and funnel, both themes, rail open and folded, own pictures ranked, overflow 0 (ads-department-drive)
SOLO_1536X770_PAIGE_OPEN: PASS: DRIVE_TABS=ads,analytics marketing-views-drive passed 640/640 on 67d1e2a27, Ads and Analytics at docked and expanded PAIGE widths, overflow 0. That harness carries no pipelines, so its funnel shows the no-pipeline state; the populated funnel's reflow is the 760px container query proven at 900 and 1024
SOLO_1366X768_PAIGE_CLOSED: PASS: showroom and funnel, both themes, rail open and folded, overflow 0; all flows ran at this size (ads-department-drive)
SOLO_1366X768_PAIGE_OPEN: PASS: marketing-views-drive (ads, analytics) at docked and expanded PAIGE widths, overflow 0, 640/640; same harness caveat as at 1536
SOLO_1024X768_PAIGE_CLOSED: PASS: showroom (display banner hidden by the approved reflow) and funnel, both themes, overflow 0 (ads-department-drive)
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: showroom stacked and the funnel stacked, both themes, overflow 0 (ads-department-drive)
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: the showroom shows the business's own ads, ones the owner features first and best performers next, with samples only where nothing real exists; Ads and Marketing read leads by stage on the same Sales pipelines, per campaign and per ad, from one server read
MUST_NOT_HAPPEN: one fixed picture for everyone; a sample mistaken for the owner's ad; a fabricated metric or any provider figure; publishing, spending, or reading an ad account; a second upload path; a member given upload or feature controls; a tenant-specific branch
MUST_PRESERVE: the approved showroom look and the channel shelf; the department strip (unchanged); saved ad copy previews and every existing desk state; the five Ads addresses; Marketing Analytics' existing panels; Ads never mounting Marketing's whole read
ACCEPTANCE_CRITERIA: once the four RPCs are deployed, an owner on the live app sees their featured picture in the feed placement and their best-performing tagged picture in the story, can feature, upload and copy a tag, and sees deals by stage with campaign and ad rows for any of their pipelines in Ads and in Marketing
MOTION_PURPOSE: the approved settle of the showroom's placements (unchanged); stage bars ease to their new length when the pipeline or period changes, so the change is legible
PROTECTED_SEAMS: tested: the Ads route and its read policy (AdsWorkspace.route.test; the guard that Marketing's full read never mounts on an Ads address now allows only scope "pipeline"), the desk (marketing-ads.render.test), Marketing's hub (growth2 suites; its funnel read is stubbed there and proven in marketing-analytics-funnel.render.test), useSoloCampaigns (one optional field added, trackingContent from utm_content)

INTERNAL_BUILD_IDENTITY: 67d1e2a27887d852837ccaef5d92eda8420629c9 (the tested tree: showroom, funnel, upload, feature, tests and harness, over main a094a618b; the suites and the drive ran on it); the next commit adds only this record and its frames; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; the four RPCs belong to the parallel backend slice; evidence=scripts/live-drive/ads-department-drive.mjs
RELEASE_CHANNEL: development: verified locally against the harness; not pushed
RELEASE_CLASSIFICATION: internal-only: a Solo Ads and Marketing UI change that codes against four contracted RPCs not yet deployed
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: the UI ships degraded-honest until get_pipeline_lead_funnel and set_ad_creative_featured are deployed (records fallback; featuring "isn’t available yet"); authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c), with no tenant login in this session. The four RPCs (get_pipeline_lead_funnel, set_ad_creative_featured, and the two default-deal attachers) are not deployed. This UI is coded to their contract and was exercised only against harness fixtures, so the real server answer's shape is unproven until a live read. The populated funnel was not driven with PAIGE expanded (that harness has no pipelines). The approved sample art reads two chart tokens (--chart-5, --chart-6) that Solo does not define as colours, so two of its compositions render darker than their gradient intends; this is left as approved (§28) and flagged to the owner.
