# UI delivery evidence: EXP03 replies to PAIGE's managed senders reach the inbox again (SendGrid Inbound Parse)

The commit range carries a `Visible-Flow-Impact: yes` trailer. The trailers come from the already-merged #2966 commits, recorded as history by an "ours" merge. The change itself is real: this is an edge-function change with no UI file changed, and it alters what owners see in one way.

- **Client replies appear in Clients → Conversations again.** When a client replies to an email sent from a business's managed `<slug>@mail.paigeagent.ai` address, the reply lands as an inbound message in that business's conversation thread, with a Paige draft reply filed for approval. This stopped working when Resend was emptied on 2026-10-26. The flow returns once the owner sets `SENDGRID_INBOUND_PARSE_SECRET` and the SendGrid Inbound Parse host; until then the receiver refuses every post and nothing changes on screen.
- **A reply whose sender cannot be authenticated** (no aligned SPF or DKIM pass) is stored in a separate `email-unverified:` thread. Nothing links it to a contact, and Paige drafts no reply to it.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow packet in PR #2976. Actors: a client replying to a business's email, and the business owner reading the inbox. Goal: the reply appears in that business's thread with a Paige draft reply. Central act: the SendGrid Inbound Parse POST reaching `handle-inbound-email`. Exits mapped: not configured (503), bad proof (401), unmatched, inactive or wildcard recipient (skip), lookup or insert failure (503 so SendGrid retries), duplicate (dedup and re-file a missing draft), unauthenticated sender (stored, no contact, no draft), oversize (413).
PAIGE_UI_DESIGN: PASS: paige-ui-design router read. No visual surface, pack, token or layout is added or changed. Inbound rows render through the existing Conversations thread and message components.
MATERIAL_FLOW_CHANGE: NO: no screen, state, transition or exit is added or removed in the interface. The inbound email message row and the draft-reply approval already exist; this restores the backend path that fills them. The `email-unverified:` thread is an ordinary thread key rendered by the existing list.
FLOW_PROTOTYPE: NOT_REQUIRED: no interface state, copy or transition changes. Not a convenience skip: the change is the receiver feeding existing states.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is every Solo or Sub-account business with a managed PAIGE sender (7 active on production, read-only query). Primary action: the client's reply reaches the business. Purpose: restore two-way email after Resend's removal without letting any business receive another business's mail.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual surface changed
AUTOMATED_EVIDENCE: PASS: `npm run test:inbound-email` 29/29 drives the real `handle-inbound-email` entry point against a fake database. Against the pre-review code 16/29 fail (all 13 review-fix tests fail first); against origin/main the 12 SendGrid-arm tests fail and the 2 Resend tests pass on both sides. Mutants caught: wildcard escaping removed, business scope dropped from the idempotency key, routing on the header To, connector and contact lookup errors swallowed, the streamed size cap removed, the paigeagent.ai domain fallback re-enabled. Also `node --test scripts/ci/c0b-*.test.mjs` 249/249; `npm run test:sendgrid-webhook` 9/9; vitest `contact-methods-edge` 69/69.
STATIC_EVIDENCE: PASS: comms-provider-boundary-wiring PASS; paige-spine-registry-lint PASS (244); receipt-coverage-lint PASS (202, unchanged); tsc ratchet no new errors; eslint clean on the touched files; c0b pins for `channel-adapters.ts` and `contact-methods.ts` renewed with dated AUTHOR-REVIEW notes (old digests reproduced first). CI's deno-check ratchet runs on the PR; local deno 2.1.4 crashed, so it was not run locally.
RENDERED_EVIDENCE: NOT_APPLICABLE: no visual surface is rendered or changed. Inbound rows use the existing thread components.
BEHAVIORAL_EVIDENCE: PASS: handler tests post real multipart bodies to the function. Observed: one row for the resolved business, plus its contact and draft-reply action; one row per business when two businesses are addressed, each holding only its own recipients; the same Message-ID twice gives one row and re-files a missing draft; an unauthenticated sender gives a row with no contact and no draft; attachment-only replies are stored; unknown, inactive and wildcard recipients are skipped. An independent adversarial review reproduced the domain-capture HIGH, multi-recipient leak and attachment drop before the fixes. A re-review of the fix commit is running on the PR.
AUTHENTICATED_RUNTIME: UNVERIFIED: no real SendGrid Inbound Parse post has reached the deployed function. Owed after merge: the owner sets the secret and the Inbound Parse host, then one real reply to a managed address is observed in Conversations.
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive visual surface changed
ZOOM_REFLOW: NOT_APPLICABLE: no visual surface changed
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: each state is covered by a test:
- not configured (503, nothing processed)
- bad or missing proof (401)
- received and stored, with contact and draft
- received from an unauthenticated sender (stored, no contact, no draft)
- duplicate (deduped; a missing draft is re-filed)
- skipped recipient
- transient failure (503, retried by SendGrid)
- oversize (413)
TRUTHFUL_STATE_LABELS: PASS: a reply is acknowledged to SendGrid only after it is stored or deliberately skipped. A sender that could not be authenticated is marked `sender_unauthenticated` and never threaded into a real client's conversation. Attachments the receiver cannot store are described in meta, never claimed as stored. Truncated bodies are flagged `body_truncated`.
SOLO_UI: NO: no Solo interface file changed; backend receiver only
UNVERIFIED: real SendGrid Inbound Parse delivery to the deployed function, because the owner has not yet set SENDGRID_INBOUND_PARSE_SECRET or the Inbound Parse host; whether SendGrid forwards URL credentials as Basic auth through the Supabase gateway; the dkim field format with several signatures; non-UTF-8 charset decoding; attachment storage is unavailable (no storage contract)

OWNER_INTENT: the owner (Antonio, 2026-10-26) ruled every PAIGE email moves to SendGrid. Required outcome here: client replies to PAIGE-sent email reach the right business, never another business, with no lost or duplicated messages.
MUST_NOT_HAPPEN: one business receiving another business's mail; a forged sender threaded into a real client's conversation with a draft reply; a reply acknowledged and then lost; a duplicate message on SendGrid's retry; the secret logged
MUST_PRESERVE: the Resend inbound path's behaviour (order, lenient lookups, responses); `findClientIdByAddress` behaviour for its other callers; the unqualified channel-adapter keys; the messages idempotency index
ACCEPTANCE_CRITERIA: after setup, a client's reply to `<slug>@mail.paigeagent.ai` appears once in that business's Conversations thread with a Paige draft for approval
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: tenant resolution from the envelope recipient against `channel_connectors.inbound_address` (tested); `uq_messages_provider_message_id` with a business-scoped key (tested); the draft-reply action filing (tested); the Resend arm (2 tests pass before and after)

<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: ef896c333c834399f566c5e1e907d59e5ddc5b39; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(handle-inbound-email deploys on merge via deploy-edge-functions); evidence=PR-2976-checks-and-the-tests-listed-above
RELEASE_CHANNEL: development: code on the PR #2976 branch; the function deploys to production on merge via deploy-edge-functions (pre-launch §4 stance)
RELEASE_CLASSIFICATION: patch: restores inbound email replies on the new provider; no new capability
CUSTOMER_RELEASE_IDENTITY: none: internal provider move, no owner-decided customer release
RELEASE_NOTE_REQUIRED: NO: replies that had stopped arriving arrive again
RELEASE_TRUTH_BOUNDARY: PARTIAL: receiver LIVE after deploy and inert until the owner sets the secret and the Inbound Parse host; real inbound delivery PROOF OWED; attachment storage and signed Inbound Parse UNAVAILABLE
RELEASE_RECOVERY: position=forward-fix only — unsetting the SENDGRID_INBOUND_PARSE_SECRET edge secret disables the receiver (503) without a code change; reference=PR #2976 and docs/brain/config-registry.md

## Scope and collisions

- Classification: backend edge-function change with a visible-flow impact; no UI source file changed.
- Affected flows: client replies to managed PAIGE senders landing in Clients → Conversations, with Paige's draft reply.
- Neighbouring regressions: the Resend inbound path is unchanged (tests on both sides). Other callers of `findClientIdByAddress` keep their behaviour. Unqualified channel-adapter keys are unchanged.
- Active-owner/file collisions: none; built on origin/main `2a0a982d`.
- Explicit exclusions: storing attachments (no storage contract); signed Inbound Parse (no specification found); restricting `inbound_domain` writes in the database (a follow-up needing a migration and owner sign-off).

## Evidence index

- `npm run test:inbound-email`: 29 passed.
- `node --test scripts/ci/c0b-*.test.mjs`: 249 passed.
- `npm run test:sendgrid-webhook`: 9 passed.
- `node scripts/ci/comms-provider-boundary-wiring.mjs`: PASS.
- `node scripts/ci/receipt-coverage-lint.mjs`: PASS.
- Independent adversarial review of `5134fc4ec`: 1 HIGH, 4 MEDIUM and 6 LOW findings, all fixed in `ef896c333`.
- Redacted: no secrets or customer data in this record.

## Review and limitations

Headless handler proof only. No real SendGrid post has reached the deployed function. Unverified: whether SendGrid forwards credentials in the URL as Basic auth (the `?t=` form avoids the question but logs the secret in request URLs), the `dkim` field format when there are several signatures, and decoding of non-UTF-8 charsets.
