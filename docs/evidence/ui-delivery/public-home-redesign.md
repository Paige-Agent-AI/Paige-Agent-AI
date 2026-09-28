# UI delivery evidence: public home redesign (Lane D, route `/`)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: pre-edit packet returned before the first edit on this branch — mode Build, depth Standard, actor Anonymous visitor (client-service business owner), flows: land → understand the COO offer → see what works today vs in build → start the Solo trial or log in; regression map covered the enrollment seams in src/marketing/siteLinks.ts
PAIGE_UI_DESIGN: PASS: Impeccable SKILL.md, reference/animate.md and reference/craft-floor.md read before UI edits; direction contract in .impeccable/surfaces/src-pages-paigehome-tsx.md; product record PRODUCT.md
MATERIAL_FLOW_CHANGE: YES: the public front door is rebuilt — new positioning, capability map, stack calculator, command-typed headline and close; the trial, login and pricing destinations are unchanged
FLOW_PROTOTYPE: PASS: rendered approval frame https://claude.ai/artifact/Cyww2bcHtDVKqHCep7jTZJ (versions 1–5); owner approval Antonio Cook in session 2026-09-28 ("Yep, I love it. Let's go with a Twilight")
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: tells an owner of a client-service business that Paige is an AI chief operating officer, shows honestly what she does today, primary action Start your 30-day trial (Solo signup), secondary Log in; see PRODUCT.md
VISUAL_DIRECTION: PASS: Twilight tokens in src/marketing/site.css (owner-chosen over Midnight and Indigo), Schibsted Grotesk + Newsreader italic accents self-hosted under public/fonts, champagne on the act, the Command Mark as cursor (src/marketing/Command.tsx)
AUTOMATED_EVIDENCE: PASS: npx vitest run src/lib/auth/soloBetaAcquisition.test.ts — 7/7 passed (copy pins: no beta, no invented testimonials, honesty lines present); Impeccable detector on src/marketing and src/pages/PaigeHome.tsx returned no findings
STATIC_EVIDENCE: PASS: npx tsc --noEmit -p tsconfig.app.json clean for src/marketing and src/pages/PaigeHome.tsx; npx eslint src/marketing src/pages/PaigeHome.tsx clean; token contrast computed: ink 12.98–17.08:1, ink-2 8.54–11.23:1, ink-3 5.35–7.04:1, champagne ink 9.3–12.23:1, CTA text on champagne 11.11:1, mark resting grey 3.49–4.38:1
RENDERED_EVIDENCE: PASS: docs/evidence/ui-delivery/public-home-1440x900-hero.png, docs/evidence/ui-delivery/public-home-1440x900-map.png, docs/evidence/ui-delivery/public-home-1440x900-close.png, docs/evidence/ui-delivery/public-home-390x844-hero.png, docs/evidence/ui-delivery/public-home-390x844-map.png, docs/evidence/ui-delivery/public-home-390x844-close.png (Chromium, local dev server, Twilight, the only theme)
BEHAVIORAL_EVIDENCE: PASS: Playwright drives at 320, 375, 390, 414 and 1440 px — no horizontal overflow; hero headline typed by the mark once and settled; close runs three commands and lands on "Run everything" on one line at every width; mark cursor holds full scale while typing; each heading's accessible name read once (getByRole heading "Paige is your AI chief operating officer." and "Run everything." each count 1); every data-reveal section reveals on scroll including the tall capability map on phones
AUTHENTICATED_RUNTIME: NOT_APPLICABLE: the page is the signed-out public surface; it reads no tenant data and calls no RPC — its acts are links into the unchanged /auth and /pricing routes
KEYBOARD_FOCUS: PASS: skip link to #main, header links, Log in, Hire Paige, hero CTAs, calculator inputs, Pause and the menu sheet reachable by Tab with the indigo focus ring; menu sheet closes on Escape and returns focus to its toggle
ZOOM_REFLOW: PASS: 320 px viewport (equivalent to 400% zoom at 1280) renders without horizontal scroll; the close line is sized so its longest command fits at 320 px
REDUCED_MOTION: PASS: with prefers-reduced-motion the hero headline and close render finished with the mark at rest, the illustration holds its decision frame, reveals are off and every section is present; verified in Playwright with reducedMotion reduce
STATE_COVERAGE: PASS: first load, typing, settled, reduced motion, no IntersectionObserver fallback (close plays immediately), paused illustration (Pause also stops the hero light), calculator empty and filled, mobile menu open and closed
TRUTHFUL_STATE_LABELS: PASS: every capability claim renders from src/marketing/capabilities.ts with Works today or In build in words; illustrations carry an Illustrative label; the specialist team, inbox reading, secure browser, social publishing, images, MCP actions and payments are marked in build
SOLO_UI: NO: this is the anonymous public marketing page at route /, not the Solo tenant shell; no src/solo or tenant-shell file changes
UNVERIFIED: production render of route / on the live domain after merge is proven in the post-deploy check and appended to this record; the remaining public pages ship as follow-up PRs

OWNER_INTENT: Antonio Cook wants the public site to present Paige as an AI chief operating officer for client-service businesses — her whole range, told honestly — in a Twilight palette, with the Command Mark visibly producing the words on the page
MUST_NOT_HAPPEN: login or Solo enrollment must not break; no capability may be described as working before it works; no invented testimonials, stats or the word beta; no finance wording; no pop-culture marks
MUST_PRESERVE: trial link appUrl(soloBetaSignupPath()) to /auth?mode=signup&plan=solo&billing=monthly, login link appUrl("/auth"), plan link appUrl("/pricing"); the app shell and every tenant surface untouched (styles scoped to .pa-site)
ACCEPTANCE_CRITERIA: a signed-out visitor on phone or desktop reads the offer, sees what works today, and reaches Solo signup or login from the hero, the header and the close in one tap
MOTION_PURPOSE: the Command Mark types the hero headline and the closing run of commands so Paige is seen producing the work; accent words swipe up once their heading lands; the hero loop shows one reply written in the owner's voice; all of it holds still under reduced motion
PROTECTED_SEAMS: enrollment links tested (Playwright render script clicks Hire Paige and Start your 30-day trial to /auth?mode=signup); unaffected and named — /auth, /pricing, /welcome, the Solo shell and the operator shell (no files changed there)

INTERNAL_BUILD_IDENTITY: ba4645767b7147490d33d44456703f8a9e7de5d5; deployment=local-vite-dev-server; environment=local; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/public-home-1440x900-hero.png
RELEASE_CHANNEL: development: verified on a local build before merge; production deploy follows the merge to main through Vercel
RELEASE_CLASSIFICATION: internal-only: pre-launch public page redesign with no customer release identity
CUSTOMER_RELEASE_IDENTITY: none: pre-launch marketing page, no customer release is being published
RELEASE_NOTE_REQUIRED: NO: internal-only pre-launch work with no customers onboarded
RELEASE_TRUTH_BOUNDARY: PARTIAL: route / redesign is verified locally and ships on merge; the other public pages (Product, Pricing restyle, Trust, About, Agency waitlist, FAQ, Contact, Resources, 404, Terms and Privacy) are not part of this change
RELEASE_RECOVERY: position=revert the PR merge commit on main, which restores the previous home page; reference=https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/1561

## Scope and collisions

- Classification: public marketing surface, Anonymous tier only.
- Affected flows: landing → understand → trial signup or login.
- Neighboring regressions: the /pricing and /about pages still use the previous design until their own PRs.
- Active-owner/file collisions: none; src/marketing is new and owned by this lane.
- Explicit exclusions: authentication, the platform shell, data models and application code.

## Evidence index

Local Vite dev server, Chromium from /opt/pw-browsers, signed out, 2026-09-28. Screenshots listed in RENDERED_EVIDENCE.

## Review and limitations

- Adversarial review of the command typing found four defects (the cursor restarting its bloom, the close wrapping on phones, doubled heading text, the dead word pause), all fixed in 64e865e.
- Compliance review found internal jargon in two capability rows and the plan list, a duplicated link name, a trust line that needed "by default", and no pause for the hero light; all fixed. Its gold-discipline notes on the hero's ambient light, the mark's glow and the beat marker are raised with the owner rather than changed, because the owner approved the frame as rendered.
- Independent verifier (full PR): no merge blockers; login and signup targets match main, vite build
  succeeds, no style leakage. Fixed its findings: duplicate description/canonical (index.html static tags
  said "beta"; now updated and Helmet-managed), a keyboard-unreachable week scroller, a Pause button
  announcing its state twice, and unscoped motion selectors.
- §58: the previous home page's 3D PaigeScene background, the ?intro cinematic sequence and the
  #hero/#workspace/#day/#proof anchors are removed with the redesign, under the owner's grant of full
  redesign authority for the public site (Lane D addendum). Old deep links land at the top of the page.
- Pricing and About still use the previous design; they are the next PRs.
