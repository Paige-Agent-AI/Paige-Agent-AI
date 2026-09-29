# UI delivery evidence: close the open transactional-email relay

Four UI files change.
- **Support ticket:** the confirmation request names the ticket and nothing else. The server sends it to the address the person signs in with. Sign-up does not verify that address, so the email carries no text the person wrote: only the generated ticket number, category and priority.
- **Invite member:** the dialog stops sending a template name. The server always sends the role invitation.
- **Broker clients and broker session:** these stop asking the platform to email a broker's client.
  - A broker profile is self-serve today, and so is the `broker` role (a tenant owner can grant it). Nothing on production separates a platform-approved broker from a self-made one, so platform-domain mail on a broker's say-so is an open relay with a different name.
  - Adding a client now tells the broker to share their own invite link. The row's "Resend" becomes "Copy invite link".
  - The session summary's "Share with client" becomes "Copy summary". Nothing on the platform can deliver it: the in-app card it wrote is refused by the database (no insert policy, and neither its channel nor its status is allowed), and the email it sent was the client invite, which never carried the summary. The dialog now says to copy it and send it yourself.
- **Lint:** a pre-existing `catch (err: any)` becomes `unknown` where the changed-file lint requires it.

**§58 — capabilities removed, flagged explicitly.** The platform no longer sends broker-client invite email from the browser, and the broker session's "Share with client" is now "Copy summary".
- Production today has 0 broker profiles, 0 holders of the `broker` role and 0 client relationships, and the broker onboarding functions are not deployed. So no working broker loses anything.
- It comes back when broker approval can only be granted by an operator. That needs a migration, which is proposed for authorization and not applied.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: discovery-first producer inventory of every caller of send-transactional-email (browser call sites, edge callers, migrations) with each caller's authentication, recorded in PR body; actor=platform internal callers, signed-in operators, signed-in people filing support tickets, tenant admins inviting staff, anonymous affiliate applicants; goal="only legitimate callers can make the platform send email"
PAIGE_UI_DESIGN: PASS: paige-ui-design router considered; no layout, token, motion or component change — two button labels and actions (broker clients Resend -> Copy invite link; broker session Share with client -> Copy summary), the broker toasts and one dialog description change wording to stay truthful about what the platform sends
MATERIAL_FLOW_CHANGE: NO: no screen, state, transition or exit is added or removed; two existing buttons change label and action to a clipboard copy (broker clients Resend -> Copy invite link, broker session Share with client -> Copy summary), and the add-client toast and summary dialog description change wording; the support, invite-member and affiliate pages keep every surface; the removed platform email and dead in-app share are flagged separately under section 58
FLOW_PROTOTYPE: NOT_REQUIRED: no new surface or interface flow to prototype; a relabelled row action and toast wording on an existing table, driven by a security fix
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience = the pages that trigger platform email (support ticket, invite member, broker clients, broker session, affiliate apply); purpose = stop anyone holding the public publishable key, or a self-made account, from sending mail from the platform's verified domain; a broker's primary action (get a client signed up on the broker rate) is kept through their own invite link
VISUAL_DIRECTION: NOT_APPLICABLE: no visual direction change; existing button and toast components carry new wording
AUTOMATED_EVIDENCE: PASS: supabase/functions/_shared/email/send-authority.test.ts 9/9 (no token and the publishable key refused for every template; internal passes; unlisted templates incl. broker-client-invite and prototype names refused for a signed-in person; a ticket confirmation needs a ticket the caller filed, is capped per person and platform-wide, goes to the sign-in address and carries only the format-checked ticket number, category and priority; operator templates need an operator; a tenant-chosen From name is a plain short label or nothing) — nine mutations reinstated, each caught; src/__tests__/transactional-email-relay-closed.test.ts 18/18, 4 of the newest failing against the previous commit; full vitest 6031 passed vs 6013 on main
STATIC_EVIDENCE: PASS: deno check clean on send-transactional-email, affiliate-application-confirm, notify-approval-event, agreement-send, send-beta-launch-email, send-admin-invitation; tsc ratchet 12 to 12; eslint clean on the changed src files; gold/impeccable report only files this change does not touch
RENDERED_EVIDENCE: UNVERIFIED: the two relabelled broker buttons, the broker toasts and the summary dialog description were not rendered in this session; their wording is pinned in source only; broker pages have no production users (0 brokers)
BEHAVIORAL_EVIDENCE: PASS: decision behavior proven headless (send-authority.test.ts); production baseline recorded before the change — the live sender answered a publishable-key request with 404 template-not-found (it reached the body), and no-token with 401 from the gateway
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in session is available to this headless session, so the in-browser support confirmation, staff invite and broker copy-link are not driven; the unauthenticated and publishable-key refusals are probed against the deployed function after merge
KEYBOARD_FOCUS: NOT_APPLICABLE: the relabelled control is the same Button component in the same position
ZOOM_REFLOW: NOT_APPLICABLE: no visual surface changed
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: server outcomes covered — 401 no token or publishable key, 403 template not user-sendable, 403 ticket not yours, 429 rate limited (per person and platform-wide), 403 not an operator, sent to a server-bound recipient; both copy actions cover clipboard success and refusal (the text is shown or left selectable instead)
TRUTHFUL_STATE_LABELS: PASS: the broker add-client toast no longer claims an invite was sent; the old Resend toast claimed success even when the server refused (invoke does not throw on an error response) and is gone; the old Share toast claimed delivery while its in-app insert was always refused by the database and its email never carried the summary — it is replaced by Copy summary; the dialog no longer promises delivery
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
