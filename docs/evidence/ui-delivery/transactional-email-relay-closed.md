# UI delivery evidence: close the open transactional-email relay

Three UI files change, and none of them changes what a person sees. They change the body of a request the page already made:
- The broker invite and session-summary calls name the client relationship, not an address.
- The support-ticket confirmation stops naming its own recipient.
- A pre-existing `catch (err: any)` becomes `unknown` in two of them, which the changed-file lint requires.

The substance is server-side. The email sender now decides authority in-body.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: discovery-first producer inventory of every caller of send-transactional-email (8 browser call sites, 19 edge callers, 5 migrations) with each caller's authentication, recorded in PR body; actor=platform internal callers, signed-in operators, brokers and Solo users, anonymous affiliate applicants; goal="only legitimate callers can make the platform send email"
PAIGE_UI_DESIGN: PASS: paige-ui-design router considered; no visual surface, token, layout, copy or motion changes — only request payloads and a typed catch, so there is no visual delivery to design
MATERIAL_FLOW_CHANGE: NO: every touched page keeps its surfaces, states, transitions, toasts and exits; the server now binds the recipient the page used to pass, with no new or altered visual state
FLOW_PROTOTYPE: NOT_REQUIRED: no visual surface or interface-flow change to prototype (request payload and server authorization only); not a convenience skip
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience = the pages that trigger platform email (support ticket, broker clients, broker session, affiliate apply); primary action unchanged; purpose = stop anyone holding the public publishable key from sending email from the platform's verified domain
VISUAL_DIRECTION: NOT_APPLICABLE: no visual surface changed; no pack, tokens, layout, or motion involved
AUTOMATED_EVIDENCE: PASS: supabase/functions/_shared/email/send-authority.test.ts 7/7 (no token and publishable key refused for every template incl. user ones; internal passes; unlisted template refused for a signed-in person; self template bound to own address; operator template needs an operator; broker invite bound to a visible relationship) — each falsified by reinstating a defect; src/__tests__/transactional-email-relay-closed.test.ts 10/10, failing against the main-branch version of each of the 7 touched files; full vitest 6023 passed vs 6013 on main (+10 new)
STATIC_EVIDENCE: PASS: deno check clean on send-transactional-email, affiliate-application-confirm, notify-approval-event, agreement-send; send-notification carries 3 pre-existing errors, identical count on main; tsc ratchet 12 to 12; eslint and gold-discipline clean on the changed src files
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered output changes; the touched components render the same markup
BEHAVIORAL_EVIDENCE: PASS: decision behavior proven headless (send-authority.test.ts); production baseline recorded before the change — the live sender answered a publishable-key request with 404 template-not-found (it reached the body), and no-token with 401 from the gateway
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in operator, broker or Solo session is available to this headless session, so the in-browser send from each touched page is not driven; affected claims are the three touched pages' sends
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive surface changed
ZOOM_REFLOW: NOT_APPLICABLE: no visual surface changed
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: server outcomes covered — refused (401 no token or publishable key, 403 template not user-sendable, 403 not an operator, 403 relationship not visible), sent to a server-bound recipient; the pages already treat the send as best-effort and non-blocking
TRUTHFUL_STATE_LABELS: PASS: the broker page's toast still says an invite was sent to the address it shows; that address is the relationship's client_email, which is now exactly where the server sends
SOLO_UI: NO: the touched pages are support (all accounts) and the broker vertical; no src/solo, tenant-shell, growth, or public-site path changed
UNVERIFIED: the authenticated in-browser send from each of the three touched pages on production (no signed-in session in this environment); the live publishable-key and no-token refusals are proven after deploy against the deployed function

<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: 4034180e98fbca6c017a2ab6f68d2ead9466ab7a; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(edge-deploy-on-merge-send-transactional-email-and-callers); evidence=send-authority.test.ts-and-transactional-email-relay-closed.test.ts
RELEASE_CHANNEL: development: code on branch claude/beautiful-clarke-v4prfx; the edge functions deploy to production on merge via deploy-edge-functions
RELEASE_CLASSIFICATION: internal-only: a security fix to the platform's email sender with no customer-visible surface change
CUSTOMER_RELEASE_IDENTITY: none: internal security fix, no owner-decided customer release
RELEASE_NOTE_REQUIRED: NO: internal security hardening with no customer-visible surface change
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the in-body authority decision, the internal-only gates on send-notification and notify-approval-event, and the bounded affiliate confirmation are proven in CI; the live refusal of no-token and publishable-key requests is owed to the post-deploy probe
RELEASE_RECOVERY: position=revert the PR merge commit — the sender returns to gateway-only authorization and the callers to their previous payloads; reference=git revert of the PR merge commit on branch claude/beautiful-clarke-v4prfx

## Scope and collisions

- Classification: security fix to a shared backend send surface, with request-payload changes in three UI files.
- Affected flows: support ticket confirmation (self), operator support/feature/affiliate replies, broker client invite and session summary, anonymous affiliate application confirmation, agreement signature request.
- Neighboring regressions: every edge caller that sends the service key is unaffected (producer inventory in the PR body).
- Active-owner/file collisions: none of the touched files is open in another PR at time of writing.
- Explicit exclusions: broker-auto-approve (not deployed to production); the funding report's callers and sandbox sender (parked by ruling).

## User job and state map

Purpose: the platform sends email only for legitimate callers. Audience and primary actions are unchanged on every touched page; the only difference is that the server, not the page, decides the recipient. No scroll owner changes.

## Evidence index

- `deno test … supabase/functions/_shared/email/send-authority.test.ts` → 7 passed; `npx vitest run src/__tests__/transactional-email-relay-closed.test.ts` → 10 passed.
- Production baseline (2026-09-29, before merge): POST send-transactional-email with the publishable key and a nonexistent template → 404 template-not-found; with no token → 401.
- Redacted: no secrets or customer data in this record.
