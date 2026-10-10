# UI delivery evidence: INT-342 S1e — Solo Marketing › Content reimagined as a gallery of the work itself

On 2026-10-10 the owner, looking at the old Content tab (a library count, a published counter, a text list and
"By kind" bars), asked: "before Campaigns we need to reimagine Content subtab". The same day, on Analytics: "I
would like to see some graphs and some circle charts". This record covers slice S1e (plan
`docs/product/int342-marketing-convergence.md`). Frames: `DRIVE_TABS=content node scripts/live-drive/marketing-views-drive.mjs`;
key frames in `assets/int342-s1e-marketing-content/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding against the old Content tab (marketing-planned.tsx), production (read-only: 17 marketing_content rows, 10 images with a public image_url across 3 businesses and 7 documents in the Studio's block JSON, average 3.8 KB, no copy rows yet), the Studio's document renderer (loadDocument + DocumentPreview, already used by the chat artifact card and the Solo Studio stage), the shared detail drawer (growth2.tsx) and PAIGE's content_save seam (humanSurface /solo/:account/growth/content). Flows: open Content by tab and deep link; filter by kind and keep it in the address; open a piece from its card or its address (including one older than the newest 60); preview an image and download it or open it full size; read a document and print or save it as PDF; read copy and copy its text; ask PAIGE to revise a piece; ask PAIGE for new content; open Vibe Studio and published work; member (library is for owners and admins); read failure and retry; empty library; a broken picture or unreadable document; workspace switch mid-read
PAIGE_UI_DESIGN: PASS: REVIEW_PENDING
MATERIAL_FLOW_CHANGE: YES: the Content tab moves from a count, a text list and kind bars to a gallery with a kind ring and a preview; every earlier part remains (library count in the summary and ring, published and not-published counts, the list as the gallery, kinds as the ring and filter, Published work, the posting and calendar note)
FLOW_PROTOTYPE: PASS: no prototype stage for this slice: pre-launch shipping stance (CLAUDE.md §4, §69 pre-launch override), frames shown to the owner on delivery; the owner-approved prototype v2 (https://claude.ai/artifact/7jwwBxRswrCAPxQiZqc6RG) recommended retiring Content and the owner ruled to keep it, then to reimagine it (docs/brain/decision-log.md 2026-10-10)
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner sees everything PAIGE has made for the business as the work itself, finds a piece by kind, opens it and gets it out (download, print or save as PDF, copy) or asks PAIGE to revise it; nothing on the page posts, sends or publishes
VISUAL_DIRECTION: PASS: Solo tokens only (no hex in src/solo/marketing-content.css), Overview's card, head, summary and ring styles, container query at 900px, both themes; no gold (nothing here spends or publishes)
AUTOMATED_EVIDENCE: PASS: marketing-content.render.test.tsx 12 tests (each piece drawn as itself, prompt titles cut at a word; the server-side kind filter for one kind and for copy; an image preview with its full request, a download that names the file and one that fails and says so, a draft-first revise; a document drawn by the Studio renderer and copy with Copy text; a linked piece older than the newest read, and one that is gone; a broken picture and an unreadable document; loading, failure with retry and empty; published work never shown as zero before it is read; a capped read shown as the newest pieces; a member never reads the library; a stale answer dropped on workspace switch); marketing-content-model.test.ts 6 tests; growth2.render.test.tsx gains the ?kind= / ?piece= address test; growth2.contract re-pointed at the drawer's new home. Shown to fail with each defect reinstated: no server kind filter, the full request hidden, a failed download claimed. Every Solo test, the chat artifact card and the Studio: 3266 across 225 files pass
STATIC_EVIDENCE: PASS: tsc 10 errors on the change and 10 on the base (none in changed files); eslint 0 errors on changed files (2 warnings in marketing-planned.tsx, present before); impeccable@4.1.0 detect exit 0 on the new UI files after removing the accent bar it flagged
RENDERED_EVIDENCE: PASS: DRIVE_TABS=content 368/368: Content at 4 viewports x 3 PAIGE postures x 2 themes plus every tab's states and the flows, asserting eleven pieces drawn as themselves (three pictures that load, two document covers, six pieces of copy), the ring, published work and no missing-piece fallbacks, and that new small text meets 4.5:1. The first run caught the preview drawer at 440px instead of wide (a CSS order fight, fixed); looking at the frames caught copy cards cut mid-line, square and tall pictures cropped, and ad copy shown with its labels (all fixed)
BEHAVIORAL_EVIDENCE: PASS: the drive opens a document with a real click and finds it drawn by the Studio renderer with Print / Save as PDF in a wide panel, closes it with Escape, opens an image full size with Download, Open full size and Revise with PAIGE, and filters to Documents; the render tests drive every act
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the harness stubs the library read with local pictures; production holds 10 images and 7 documents today
KEYBOARD_FOCUS: PASS: cards, filters, ring keys and every act are native buttons or links with the shared focus ring; the preview traps focus, closes on Escape and returns focus to the card
ZOOM_REFLOW: PASS: the ring and published pair stacks below 900px, the gallery reflows from five columns to one, the preview is min(880px, 96vw)
REDUCED_MOTION: PASS: the card lift is transform-only and off under reduced motion; skeletons follow the shared reduced-motion rule
STATE_COVERAGE: PASS: loading (skeletons), read failed (retry), empty library (ask PAIGE), member (told the library is for owners and admins, published counts still shown), a kind with nothing saved (show everything), capped read (newest 60, marked +), a picture that won't load, a document that can't be read, a piece no longer in the library, video (no preview, says so), workspace switch mid-read (stale answer dropped)
TRUTHFUL_STATE_LABELS: PASS: nothing claims a piece was posted or sent; Draft or Published is the row's own status; counts from a full read are marked as the newest 60; "Downloaded." only after the file was fetched; a failed download says so and points to Open full size
SOLO_UI: YES: Solo Marketing, /solo/{account}/growth/content

SOLO_1536X770_PAIGE_CLOSED: PASS: Content both themes, overflow 0 (DRIVE_TABS=content)
SOLO_1536X770_PAIGE_OPEN: PASS: docked and expanded, overflow 0 (DRIVE_TABS=content)
SOLO_1366X768_PAIGE_CLOSED: PASS: overflow 0 (DRIVE_TABS=content)
SOLO_1366X768_PAIGE_OPEN: PASS: docked and expanded, overflow 0 (DRIVE_TABS=content)
SOLO_1024X768_PAIGE_CLOSED: PASS: overflow 0 (DRIVE_TABS=content)
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: overflow 0 (DRIVE_TABS=content)
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: Content is reimagined into something visual that shows the work itself, before Campaigns
MUST_NOT_HAPPEN: a piece shown as something it isn't; an invented preview; a capped count shown as a total; a member shown the library; anything posted, sent or published; a download claimed that didn't happen
MUST_PRESERVE: the saved library for owners and admins, published and not-published counts, Published work, Ask PAIGE for content, Vibe Studio; the Studio canvas and the chat card reading documents the same way; every other user of the detail drawer (Overview's form panel, Sales, Catalog)
ACCEPTANCE_CRITERIA: on the live app a Solo owner opens Marketing › Content, sees their images and documents as themselves, filters to Documents, opens one and saves it as PDF, opens an image and downloads it
MOTION_PURPOSE: a small lift on hover marks a card as openable; off under reduced motion
PROTECTED_SEAMS: tested - tab registry and order (growth2, sales-ops contract), the drawer's focus trap and Escape (growth2 contract), the library read policy (useLibraryAccess), the document parser (marketing-content-model tests through parseStudioDocument; loadDocument now calls it). Unaffected and named - Overview, Campaigns, Audience, Social, Email, Ads, Analytics, Vibe Studio, the chat artifact card

INTERNAL_BUILD_IDENTITY: 164dcf455; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the pre-launch stance (CLAUDE.md §4)
RELEASE_CLASSIFICATION: internal-only: a Solo Marketing view over existing records, no backend change
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: reads only existing data; authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit - frontend only, no migration or edge change; reference=git revert of this PR's merge
UNVERIFIED: authenticated production runtime (§32.c): Content against a real Solo account; no tenant login exists in this session.
