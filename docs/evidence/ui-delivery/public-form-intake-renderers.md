# UI delivery evidence: public forms read and submit through the governed door (PR 2a)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: frame before edits — mode Repair, depth Standard, actor Anonymous visitor on /form/:id, a landing-page form embed (/p/:tenantSlug/:pageSlug) and a funnel form step (/f/:tenantSlug/:funnelSlug); flows: open form → answer → submit → thank-you, redirect, download or next funnel step; failing-first tests written and shown red against main before the change
PAIGE_UI_DESIGN: PASS: Impeccable craft floor applied to the states this change adds (specific, plain-language refusal copy; nothing new drawn); the form's existing layout and styles are unchanged and out of scope
MATERIAL_FLOW_CHANGE: NO: the visible form is unchanged; what changes is where it reads from and posts to (growth_public_form and growth-public-submit, shipped in #1573), plus clearer refusal messages
FLOW_PROTOTYPE: NOT_REQUIRED: no new or changed screen; the same form now works for visitors again instead of failing on read and insert
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: an anonymous visitor submits a business's public form; primary action is the form's submit button
VISUAL_DIRECTION: PASS: unchanged existing form styling; the bot-trap field is off-screen, aria-hidden and out of the tab order
AUTOMATED_EVIDENCE: PASS: npx vitest run src/pages/public/GrowthFormRenderer.test.tsx src/pages/public/GrowthFunnelRenderer.test.tsx src/__tests__/public-form-intake-contract.test.ts — 21/21 passed; the first 10 fail against main's renderer and helpers, and the 8 behaviour tests added after independent review (trimmed and blank answers, space-only required field, deduplicated field names, non-retryable refusal, the renamed bot trap, embed loading and not-available, funnel not-ready step) fail against the pre-review commit ded7e0d1e — each reinstated to prove the tests bite
STATIC_EVIDENCE: PASS: npx tsc --noEmit -p tsconfig.app.json clean for the changed files; npx eslint on every changed file clean (the renderer's five pre-existing any types replaced with a typed Answer)
RENDERED_EVIDENCE: PASS: docs/evidence/ui-delivery/assets/public-form-intake/form-1280-filled.png, docs/evidence/ui-delivery/assets/public-form-intake/form-1280-invalid.png, docs/evidence/ui-delivery/assets/public-form-intake/form-1280-limited.png, docs/evidence/ui-delivery/assets/public-form-intake/form-1280-sent.png, docs/evidence/ui-delivery/assets/public-form-intake/form-390-filled.png, docs/evidence/ui-delivery/assets/public-form-intake/form-390-sent.png — the real page on a local Vite build in Chromium, with the read and submit endpoints answered by Playwright (a synthetic form; no business's real form is shown)
BEHAVIORAL_EVIDENCE: PASS: Playwright drive at 1280 and 390 px — the submit request carried form_id, the answers, hp "" and elapsed_ms 1601 and no tenant_id; a 422 named the refused field by its label; a 429 asked the visitor to wait; a 200 with a submission id showed the form's own thank-you; no horizontal overflow and no page errors in any state
AUTHENTICATED_RUNTIME: NOT_APPLICABLE: the surface is signed-out and public; production proof of a real submission is PR 3
KEYBOARD_FOCUS: PASS: the bot-trap input has tabIndex -1 inside an aria-hidden wrapper, so tab order is unchanged: fields in order, then the submit button
ZOOM_REFLOW: PASS: 390 px renders without horizontal scroll
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: /form/:id — loading, not available, filled, refused answer (422), nothing answered (422 no_answers), page refused (400/403/413, no retry offered), rate limited (429), unavailable (404), failed (500 or no submission id), thank-you; funnel form step — its own skeleton while loading and the funnel's 'This step isn't ready yet' step with Continue when the form is not live; landing-page embed — renders nothing while loading or when missing, as on main; redirect and download precedence and funnel onComplete are unchanged
TRUTHFUL_STATE_LABELS: PASS: success is shown only when a submission id comes back; a bot-trap 200 without an id is treated as failure, and the page waits 1.6 s before sending so a fast real visitor is never mistaken for a bot
SOLO_UI: NO: public signed-out renderers only; no src/solo or tenant-shell change
UNVERIFIED: a real submission on production (PR 3); Vercel preview hosts are refused by the endpoint's origin rule by design, so the change can only be exercised end to end on paigeagent.ai

OWNER_INTENT: public forms work for every business — a visitor's submission lands, protected against bots and abuse
MUST_NOT_HAPPEN: no business id or internal field sent from the browser; no success shown for a submission that was not saved; no new visible friction for a real visitor
MUST_PRESERVE: redirect_url, download_url and funnel onComplete behaviour after a successful submit; the form's layout and fields; landing-page and funnel embeds
ACCEPTANCE_CRITERIA: a visitor fills a live form and sees the business's thank-you only after the server has saved it; a refused answer names the field
PROTECTED_SEAMS: GrowthBlocks embedded_form (tenant and slug path) and funnel form steps (form id path) both go through GrowthFormEmbed; the Studio preview components also use it but are not routed anywhere today (nothing imports pages/admin/VibeStudio, CampaignsHub or StudioHome); the Solo catalog "Open published" link to /form/:id is unchanged

INTERNAL_BUILD_IDENTITY: 73720b4e291a4b38241ef0a33d2269a85d03e5ce; deployment=local-vite-dev-server; environment=local; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/assets/public-form-intake
RELEASE_CHANNEL: development: verified on a local build before merge; production deploy follows the merge to main through Vercel
RELEASE_CLASSIFICATION: internal-only: pre-launch repair of public forms with no customer release identity
CUSTOMER_RELEASE_IDENTITY: none: pre-launch, no customer release is being published
RELEASE_NOTE_REQUIRED: NO: internal-only pre-launch work with no customers onboarded
RELEASE_TRUTH_BOUNDARY: PARTIAL: the renderers move to the governed door on merge; a real production submission is PR 3
RELEASE_RECOVERY: position=revert the PR merge commit on main; reference=https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/1573

## Scope and collisions

- Classification: public signed-out surfaces (Anonymous tier).
- Affected flows: /form/:id, landing-page form embeds, funnel form steps.
- Deleted: `submitGrowthForm`'s direct insert into `growth_form_submissions`; the renderers' direct `growth_forms` reads; the funnel step's double lookup (id, then business and slug); the bot trap's autofill-prone `website` field name.
- Independent review (a separate agent that did not write this code) found no blockers; its four should-fix findings (funnel step with no loading or way on, autofill-prone trap name, space-only answers refused, an evadable source guard) and the retry-message nit are fixed in this PR. Recorded, not fixed: the stored referrer is now the request's Referer header (no consumer reads it); a 422 on an earlier step of a multi-step form does not jump back to it.
- Not in this slice: the owner's intake settings and captured-answers view (PR 2b, shown to the owner before it is built).
