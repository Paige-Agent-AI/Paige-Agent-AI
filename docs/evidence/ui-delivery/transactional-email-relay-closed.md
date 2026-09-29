# UI delivery evidence: close the open transactional-email relay

Four UI files change.
- **Support ticket:** the confirmation request names the ticket and nothing else. The server sends it to the address the person signs in with. Sign-up does not verify that address, so the email carries no text the person wrote: only the generated ticket number, category and priority.
- **Invite member:** the dialog stops sending a template name. The server always sends the role invitation.
- **Broker clients and broker session:** these stop asking the platform to email a broker's client.
  - A broker profile is self-serve today, and so is the `broker` role (a tenant owner can grant it). Nothing on production separates a platform-approved broker from a self-made one, so platform-domain mail on a broker's say-so is an open relay with a different name.
  - Adding a client now tells the broker to share their own invite link. The row's "Resend" becomes "Copy invite link".
  - Sharing a session summary now says truthfully where it went. The old email used the invite template, which never carried the summary.
  - The summary is marked shared only once the in-app card is actually written. A client with no account gets "Not shared yet", and the summary stays open so the broker can copy it.
  - The summary dialog no longer promises email.
- **Lint:** a pre-existing `catch (err: any)` becomes `unknown` where the changed-file lint requires it.

**§58 — a capability removed, flagged explicitly.** The platform no longer sends broker-client invite email from the browser.
- Production today has 0 broker profiles, 0 holders of the `broker` role and 0 client relationships, and the broker onboarding functions are not deployed. So no working broker loses anything.
- It comes back when broker approval can only be granted by an operator. That needs a migration, which is proposed for authorization and not applied.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: discovery-first producer inventory of every caller of send-transactional-email (browser call sites, edge callers, migrations) with each caller's authentication, recorded in PR body; actor=platform internal callers, signed-in operators, signed-in people filing support tickets, tenant admins inviting staff, anonymous affiliate applicants; goal="only legitimate callers can make the platform send email"
PAIGE_UI_DESIGN: PASS: paige-ui-design router considered; no layout, token, motion or component change — one button label on the broker clients row, the broker toasts and one dialog description change wording to stay truthful about what the platform sends
MATERIAL_FLOW_CHANGE: NO: no screen, state, transition or exit is added or removed; on the broker clients row one button changes label and action (Resend -> Copy invite link), the add-client and share-summary toasts and the summary dialog description change wording, and share-summary no longer closes its dialog for a client who has no account; the support, invite-member and affiliate pages keep every surface and toast; the removed platform email is flagged separately under section 58
FLOW_PROTOTYPE: NOT_REQUIRED: no new surface or interface flow to prototype; a relabelled row action and toast wording on an existing table, driven by a security fix
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience = the pages that trigger platform email (support ticket, invite member, broker clients, broker session, affiliate apply); purpose = stop anyone holding the public publishable key, or a self-made account, from sending mail from the platform's verified domain; a broker's primary action (get a client signed up on the broker rate) is kept through their own invite link
VISUAL_DIRECTION: NOT_APPLICABLE: no visual direction change; existing button and toast components carry new wording
AUTOMATED_EVIDENCE: PASS: supabase/functions/_shared/email/send-authority.test.ts 8/8 (no token and the publishable key refused for every template; internal passes; unlisted templates incl. broker-client-invite and prototype names like constructor refused for a signed-in person; a ticket confirmation needs a ticket the caller filed, is capped per person and platform-wide, goes to the sign-in address and carries only the format-checked ticket number, category and priority; operator templates need an operator) — eight mutations reinstated, each caught; src/__tests__/transactional-email-relay-closed.test.ts 17/17, 4 of the newest failing against the previous commit; full vitest 6030 passed vs 6013 on main
STATIC_EVIDENCE: PASS: deno check clean on send-transactional-email, affiliate-application-confirm, notify-approval-event, agreement-send, send-beta-launch-email, send-admin-invitation; tsc ratchet 12 to 12; eslint clean on the changed src files; gold/impeccable report only files this change does not touch
RENDERED_EVIDENCE: UNVERIFIED: the broker clients row label, the broker toasts and the summary dialog description were not rendered in this session; their wording is pinned in source only; broker pages have no production users (0 brokers)
BEHAVIORAL_EVIDENCE: PASS: decision behavior proven headless (send-authority.test.ts); production baseline recorded before the change — the live sender answered a publishable-key request with 404 template-not-found (it reached the body), and no-token with 401 from the gateway
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in session is available to this headless session, so the in-browser support confirmation, staff invite and broker copy-link are not driven; the unauthenticated and publishable-key refusals are probed against the deployed function after merge
KEYBOARD_FOCUS: NOT_APPLICABLE: the relabelled control is the same Button component in the same position
ZOOM_REFLOW: NOT_APPLICABLE: no visual surface changed
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: server outcomes covered — 401 no token or publishable key, 403 template not user-sendable, 403 ticket not yours, 429 rate limited (per person and platform-wide), 403 not an operator, sent to a server-bound recipient; copy-link covers clipboard success and refusal (the link is shown instead); share-summary covers delivered, card write failed, and client with no account
TRUTHFUL_STATE_LABELS: PASS: the broker add-client toast no longer claims an invite was sent; the old Resend toast claimed success even when the server refused (invoke does not throw on an error response) and is gone; share-summary says Summary shared only after the in-app card insert succeeds, and says Not shared yet for a client with no account; the dialog no longer promises email
SOLO_UI: NO: the touched pages are support (all accounts) and the broker vertical; no src/solo, tenant-shell, growth, or public-site path changed
UNVERIFIED: the authenticated in-browser flows on production (support confirmation, staff invite, broker copy-link) and the rendered broker wording; the live publishable-key and no-token refusals are proven after deploy against the deployed function

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
- Affected flows: support ticket confirmation, staff invitation, operator support/feature/affiliate replies, broker client invite and session summary, anonymous affiliate application confirmation, agreement signature request.
- Neighboring regressions: every edge caller that sends the service key is unaffected (producer inventory in the PR body).
- Active-owner/file collisions: none of the touched files is open in another PR at time of writing.
- Explicit exclusions: broker-auto-approve and send-broker-team-invite (not deployed to production); the broker-role grant paths (a migration, proposed not applied); the funding report's callers and sandbox sender (parked by ruling).

## User job and state map

Purpose: the platform sends email only for legitimate callers. The server, not the page, decides the recipient and the words. The broker invite moves from a platform email to the broker's own link. No scroll owner changes.

## Evidence index

- `deno test … supabase/functions/_shared/email/send-authority.test.ts` → 7 passed; `npx vitest run src/__tests__/transactional-email-relay-closed.test.ts` → 14 passed.
- Production baseline (2026-09-29, before merge): POST send-transactional-email with the publishable key and a nonexistent template → 404 template-not-found; with no token → 401.
- Redacted: no secrets or customer data in this record.
