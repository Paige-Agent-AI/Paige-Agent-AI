# UI delivery evidence: security #2087 + #2090 — consent written only by the server; stored links must be web addresses

A security fix with three UI files in its diff and no visual change. The hosted form follows or renders a
stored redirect/download link only when it is an absolute http(s) address. The affiliate form records the
applicant's optional preferences through the server instead of the browser. The unrouted `PublicSignup`
page loses its browser consent call. Safe links render exactly as before.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounded pre-edit frame in PR #2099 (actors: an anonymous/signed-in attacker, a form or booking owner, a visitor submitting a form, an affiliate applicant; flows: write consent, decide a send, save a form/booking link, follow it after submit); production read-only facts recorded in the PR and migration header
PAIGE_UI_DESIGN: PASS: paige-ui-design router read; no visual direction applies — the change removes unsafe output and moves a write server-side, adding no surface, token, layout or motion
MATERIAL_FLOW_CHANGE: NO: every visitor and owner flow keeps its surfaces, states, transitions and exits; an unsafe stored link (none exists in production) is no longer followed or rendered, and saving one is refused with a message in the existing save-error slot
FLOW_PROTOTYPE: NOT_REQUIRED: no surface or interface-flow change to prototype; the visible outcome for every legitimate link is identical
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience = form visitors, form/booking owners, affiliate applicants; primary action unchanged (submit, then continue or download); purpose = no script runs on Paige's origin from a stored link, and no browser writes consent
VISUAL_DIRECTION: NOT_APPLICABLE: no visual surface changed; no pack, tokens, layout or motion involved
AUTOMATED_EVIDENCE: PASS: src/pages/public/GrowthFormRenderer.test.tsx (javascript:/data: redirect and download neither followed nor rendered, including the immediate-redirect branch; https links followed and rendered) and src/lib/safe-web-url.test.ts — removing either guard fails them; src/pages/a2p-sms-runtime.test.ts; supabase/functions/_shared/tenant-consent.test.ts 7/7; supabase/tests/security_consent_and_form_links.sql PASS on an isolated clone (mutation-checked); full vitest 0 failures vs main
STATIC_EVIDENCE: PASS: tsc 10 errors, identical to main and none in touched files; eslint clean on touched files; lint:definer-fns, lint:views, lint:rail-grants, lint:migration-versions, lint:write-targets, lint:governed-execution, lint:action-risk, spine self-test PASS
RENDERED_EVIDENCE: NOT_APPLICABLE: no visual change; markup for an http(s) link is identical, and an unsafe link is omitted rather than restyled
BEHAVIORAL_EVIDENCE: PASS: jsdom drive of the real hosted form — submit with a javascript: redirect stays on the success message without navigating; submit with an https redirect navigates to it; the success state renders the https Continue and Download links and omits unsafe ones
AUTHENTICATED_RUNTIME: UNVERIFIED: PC-1 (the approved synthetic QA business) is not ready (#1832), so no authenticated drive on the live platform; the post-merge production readback covers grants, policies, triggers and the deployed edge functions
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive element added or changed
ZOOM_REFLOW: NOT_APPLICABLE: no layout changed
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: success with no link, with a safe redirect, with a safe download, with unsafe redirect/download (omitted), refused save (message) — each covered by the tests above
TRUTHFUL_STATE_LABELS: PASS: the affiliate form's optional preferences are still recorded (server-side, bound to the stored application) so its checkboxes stay truthful; the unrouted PublicSignup page's email checkbox now records nothing and is tracked in #2095
SOLO_UI: NO: no src/solo path changed; the hosted public form, the public affiliate form and an unrouted page
UNVERIFIED: the authenticated live drive (PC-1 not ready); everything else is proven at the boundaries above

OWNER_INTENT: owner priority "SECURITY PRIORITY — CROSS-TENANT CONSENT AND FORM REDIRECTS": consent provenance that cannot be forged, tenant-scoped fail-closed enforcement, authoritative URL validation before a form is saved or published, browser defence in depth preserved
MUST_NOT_HAPPEN: a legitimate https redirect or download stops working; a form or booking save that held a valid link starts failing; the affiliate form loses its preference recording; the hosted or embedded intake changes
MUST_PRESERVE: growth-public-submit intake and attribution; Studio's form writer (growth_form_upsert); the booking redirect guard in BookingPage; the affiliate confirmation email path
ACCEPTANCE_CRITERIA: an owner saving a form or booking link without https:// sees a message saying what to fix; a visitor submitting a form with a safe redirect lands on it; no stored javascript:/data: link is ever followed or rendered
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: tested — GrowthFormRenderer submit/success (renderer tests), growth_form_upsert and calendars writes (DB proof), affiliate-application-confirm (contract test src/__tests__/transactional-email-relay-closed.test.ts); unaffected — growth-public-submit, embed loader (#2088), BookingPage

<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: 473c9fd6853b5e47ce7a91d079d0521472d1ce7c; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20271027100000 applies on merge via deploy-migrations and its schema_migrations row, grants, policies and triggers are read back on production after that); edge=PROOF_OWED(dispatch-stage-automation, affiliate-application-confirm, paige-operator-sms-send deploy on merge via deploy-edge-functions); evidence=PR-2099
RELEASE_CHANNEL: development: PR #2099 branch claude/stoic-archimedes-pv4r8u-security; production on merge via the deploy pipelines
RELEASE_CLASSIFICATION: internal-only: a security correction with no customer-visible change for legitimate data
CUSTOMER_RELEASE_IDENTITY: none: internal security correction, no owner-decided customer release
RELEASE_NOTE_REQUIRED: NO: no customer-visible surface change for legitimate links or flows
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the migration and three edge functions are not yet applied; once merged, LIVE only after the production readback of grants, policies, triggers and deployed function versions
RELEASE_RECOVERY: position=forward-fix by a follow-up migration that CREATE OR REPLACEs the changed functions, policies and triggers, because a git revert does not reverse applied SQL and restoring the prior grants would reopen the consent forgery; the migration writes no data, so nothing needs restoring; reference=PR #2099 and migration 20271027100000_security_consent_provenance_and_form_links

## Scope and collisions

- Classification: security fix; database + edge + three UI files with no visual change.
- Affected flows: consent writes and send gates; saving and following form/booking links; affiliate application submit.
- Neighboring regressions: none found — full vitest 0 failures vs main; §37 producer inventory in the PR.
- Active-owner/file collisions: #2088 (S2a embed, same owner) also edits GrowthFormRenderer.tsx; it is rebased onto this change and reuses `safeWebUrl` (§18, one helper).
- Explicit exclusions: page button links (#2097), signup phone ownership (#2094), the stage-automation trigger (#2098).

## User job and state map

A visitor submits a form and lands on the owner's thank-you page or downloads a file; an owner sets those links
in Studio or the booking editor. States: no link · safe redirect · safe download · unsafe link (omitted) ·
refused save (message in the existing error slot). No new scroll owner.

## Evidence index

- `npx vitest run src/pages/public/GrowthFormRenderer.test.tsx src/lib/safe-web-url.test.ts src/pages/a2p-sms-runtime.test.ts` — pass; mutation: guard removed → fails.
- `node --test supabase/functions/_shared/tenant-consent.test.ts` — 7/7.
- `psql -f supabase/tests/security_consent_and_form_links.sql` on the isolated local clone after reproducing production's grant drift — PASS; each single mutation of the migration fails it.
- Full vitest: main 12232 pass / branch 12258 pass, 0 failures each.
- No secrets or customer data in this record.

## Review and limitations

Independent non-author review (§39) on the first commit: SHIP with two should-fix findings (signup evidence for
typed numbers; tenant-ledger policies keyed on the global admin role) and one test gap; all fixed, plus the
browser-writable phone-verification flag found while answering the first. Remaining: the authenticated live drive
(PC-1) and the post-merge production readback.
