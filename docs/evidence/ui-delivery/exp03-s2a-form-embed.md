# UI delivery evidence: Experience 03 S2a — put a Studio form on your own website

Experience 03 (Grow My Business), journey record `docs/delivery/exp03-grow-my-business-journey.md` §11 (S2a).
Owner requirement 2026-10-12: a Solo owner creates and customises a lead form in Vibe Studio, publishes it and
gets code to embed it on a website they control; submissions reach the existing intake with S1a attribution,
S1b routing and tenant isolation. No backend change in this slice.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: pre-edit packet is the journey record §11 (flow F2b "a lead form on my own website": actor Solo owner/admin in Vibe Studio, then a visitor on the business's own site; entry Studio › a form › Publish / Live · Manage; exit an answer filed by the existing intake); states: draft (no code), just published, live (reopened), copied, copy refused, embedded loading/ready/sent/refused/offline/redirect, chosen dark, default light
PAIGE_UI_DESIGN: PASS: read .agents/skills/paige-ui-design/SKILL.md and Impeccable (Operate mode, a section inside the existing publish panel; the visitor-facing card is the incumbent public form) and reference/craft-floor.md before the first UI edit
MATERIAL_FLOW_CHANGE: YES: a live form's publish panel gains "Put it on your website" (the code, Copy code, where to paste it, what unpublishing does), and the public form gains an embedded presentation on another website
FLOW_PROTOTYPE: PENDING: the rendered design (Studio panel at four viewports in both themes, and the form on a business's site at desktop and phone, light and dark) was sent to the owner on 2026-10-13; the owner approved the requirement on 2026-10-12, not this design, so this record waits for that ruling and the PR is not merged until it lands
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an owner who has published a form copies one line of code and pastes it into their site; the primary act stays Publish (gold); Copy code is a quiet button
VISUAL_DIRECTION: PASS: the Studio's own --vs-* tokens; a code well on --vs-violet-soft under a hairline; no gold on Copy; the embedded card uses the app's card tokens, transparent around it so the business's page shows; light by default, dark or auto on request (data-theme)
AUTOMATED_EVIDENCE: PASS: src/solo/studio/EmbedCode.test.tsx (6: the exact tag, escaping a hostile form name, no label without a name, copy and where to paste, the browser refusing the clipboard selects the code, what unpublishing does); studio.render.test.tsx (no code for a draft, the exact tag after publishing, kept for a live form, none for a funnel); GrowthFormRenderer.test.tsx (4 embedded: compact card through the public seams, taken offline, the hosted page unchanged, Continue aimed at the whole page); useEmbedHeight.test.ts (2: theme only for an embedded form, light by default)
STATIC_EVIDENCE: PASS: eslint and tsc report nothing in the changed files; lint:skeleton OK (index.html #root unchanged)
RENDERED_EVIDENCE: PASS: scripts/live-drive/harness/studio-mount/drive-embed-code.mjs (real Studio, stubbed door): 80/80, four viewports x two themes x (publish then It's live, live then copy); scripts/live-drive/form-embed-drive.mjs (the REAL app on one origin, a business's site on another, only Supabase stubbed and every other call blocked): 70/70; mutation-checked: forwarding every host parameter, dropping the redirect hand-off, dropping the height report, and a frame colour scheme that paints a box behind a dark card each fail it; frames in scripts/live-drive/artifacts/studio-embed-code and form-embed (gitignored)
BEHAVIORAL_EVIDENCE: PASS: across origins the drive pastes the exact Studio code into a separate site, then: the frame carries only the page's campaign tags (utm_*, gclid, fbclid; another parameter is dropped); it sizes itself with no inner scrollbar and adds no sideways scroll at 390px; Tab reaches the first question; a required question blocks sending; the answers reach growth-public-submit from Paige's own origin with the form id, the campaign tags and the bot trap, never a business id; the success card fits; a refused send says so; an unpublished form says it isn't available; a success redirect moves the visitor's whole page; the booking calendar's tag still frames its own page
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in production drive (PC-1, ANT-21); no real website has embedded a form yet
KEYBOARD_FOCUS: PASS: Copy code follows the code well in Tab order with a visible ring and works with Enter; on the business's site Tab enters the frame at the first question
ZOOM_REFLOW: PASS: the panel scrolls inside itself at short viewports and the code wraps; the embedded form fits 390px with no sideways scroll on the host page
REDUCED_MOTION: PASS: no new motion; the frame's height transition is the booking loader's, unchanged
STATE_COVERAGE: PASS: draft (no code), It's live (code), live reopened (code), copied, clipboard refused (code selected, told to copy), funnel (no code); embedded: loading (no Paige splash), ready, sent, refused, taken offline, redirect, owner-chosen dark, default light for a dark-system visitor
TRUTHFUL_STATE_LABELS: PASS: the panel promises only what the code does ("answers come into Paige exactly as they do on the form's own page"); the code is shown only for a live form; unpublishing is said to show "isn't available" on the site, and the drive proves it; no consent or brand claim is made (both are later slices: consent waits on #2087, the live form's brand on a public read)
SOLO_UI: YES: Vibe Studio › Publish panel (src/solo/studio/PublishPanel.tsx, EmbedCode.tsx) and the public form at /form/:id (src/pages/public/GrowthFormRenderer.tsx), public/embed.js, index.html (tenant-facing splash)
UNVERIFIED: a signed-in production drive; a real business website; consent records (#2087); the business's brand on the live form

SOLO_1536X770_PAIGE_CLOSED: PASS: light/dark-1536x770-its-live.png and -live-copied.png (the Studio is full screen; the PAIGE dock sits under it), panel on screen, contrast >= 4.5:1
SOLO_1536X770_PAIGE_OPEN: PASS: the same frames; the Studio overlay covers the dock, so open and closed render identically
SOLO_1366X768_PAIGE_CLOSED: PASS: light/dark-1366x768-its-live.png and -live-copied.png, panel on screen, contrast >= 4.5:1
SOLO_1366X768_PAIGE_OPEN: PASS: the same frames; the Studio overlay covers the dock
SOLO_1024X768_PAIGE_CLOSED: PASS: light/dark-1024x768-its-live.png and -live-copied.png, panel on screen, contrast >= 4.5:1
SOLO_1024X768_PAIGE_OPEN: PASS: the same frames; the Studio overlay covers the dock
SOLO_900X1000_PAIGE_CLOSED: PASS: light/dark-900x1000-its-live.png and -live-copied.png, panel on screen, contrast >= 4.5:1
SOLO_900X1000_PAIGE_OPEN: PASS: the same frames; the Studio overlay covers the dock

OWNER_INTENT: "A SOLO business owner must be able to create and customize a lead-capture form within Vibe Studio, publish it and obtain code to embed the form on an external website they control" (owner, 2026-10-12)
MUST_NOT_HAPPEN: a second forms store, intake, campaign system or publishing engine; answers posted from the business's origin or carrying a business id; a host page's other parameters forwarded; a Paige splash on a business's site; a dark box the owner didn't choose; the owner's stored theme changed by a visitor; the booking embed changed
MUST_PRESERVE: the booking embed (data-slug), the hosted /form/:id page, the publish door and its approvals, the form inside pages and funnels (GrowthFormEmbed), growth-public-submit's origin allow-list and bot trap
ACCEPTANCE_CRITERIA: an owner publishes a form in Studio, presses Copy code, pastes the tag on their site; a visitor from a tagged link fills it in; the answer is filed by the existing intake (credited to the campaign by S1a, routed by S1b) and the visitor sees the form's thank-you
MOTION_PURPOSE: NONE: no new motion
PROTECTED_SEAMS: booking embed check in form-embed-drive; GrowthFormRenderer and Studio tests unchanged and passing; BookingPage moved onto the shared height hook with the same message

INTERNAL_BUILD_IDENTITY: a66fc8268ccef625c5b47c9efe1f9a43b69a7b39; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=scripts/live-drive/form-embed-drive.mjs
RELEASE_CHANNEL: development: production on merge after the owner's design ruling
RELEASE_CLASSIFICATION: internal-only: inside an unreleased journey; a customer version is earned by Experience 03 as a whole
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version until Experience 03 earns one
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers; announced with the journey
RELEASE_TRUTH_BOUNDARY: PARTIAL: embed code and embedded form built and driven across origins; consent records and the live form's brand are later slices
RELEASE_RECOVERY: position=revert the UI files and public/embed.js (the booking path is unchanged); reference=this record
