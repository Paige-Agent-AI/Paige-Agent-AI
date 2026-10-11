# PAIGE Mail — SendGrid Integration (ANT-43/S7), Slice 1: Bounded Send Adapter

**Date:** 2026-10-10. **Status:** source integration; **activates nothing** — no customer sends,
no transport switch (platform default remains Resend), no webhook configured, no DNS/purchase/IP
changes. Branding unchanged: tenants see **PAIGE Email**; SendGrid is an invisible backend; Resend
remains available for Platform Operator communications.

## Source integration matrix

| Surface | State | Where |
|---|---|---|
| `EmailProvider` seam | `SendGridProvider implements EmailProvider` (Mail Send v3, Bearer, 202 contract, `X-Message-Id` as the durable id) + `buildProvider` case; missing executor key → `UnimplementedProvider` (honest readiness, no crash) | `_shared/email/providers.ts` |
| Canonical send door | `send-message` gains a `sendgrid` dispatch arm, selected ONLY by `connectorRow.provider === "sendgrid"`; key is ALWAYS the platform executor secret `SENDGRID_MAIL_SEND_API_KEY` (or a namespaced `TENANT_EMAIL_KEY_*` tenant key); List-Unsubscribe + In-Reply-To headers preserved; `provider_message_id` = `X-Message-Id` | `send-message/index.ts` |
| Signature verification | Canonical ES256 verifier `verifySendgridEvent` (SPKI PEM public key, DER→P-1363 conversion, fail-closed reasons) with 2 deno tests | `_shared/webhookSig.ts` |
| Scopes self-check | `comms-sendgrid-scopes` — operator-gated (JWT + `is_platform_owner`), GET `/v3/scopes` with the EXECUTOR key only, returns scopes + `can_send_mail`/`non_sending_scopes`; never the key; no send capability | `comms-sendgrid-scopes/index.ts` |
| Admin-key guard | CI step forbids `SENDGRID_PLATFORM_ADMIN_API_KEY` references in ALL function code (allowlist intentionally empty) | `scripts/ci/forbid-sendgrid-admin-key-refs.mjs` + ci.yml |
| Gate preservation | Provider selection cannot bypass tenant authorization, Marketplace eligibility, content policy, approval or quotas: the arm sits INSIDE the canonical door after the capability gate, action-risk/one-approval-gate, and `comms_provider_execution_allowed` — no new authority, no second dispatch system | `send-message` + `comms-email/adapter.ts` (unchanged) |
| Delivery events | **Not in this slice** (next sub-slice): the ES256 verifier is ready; the event door cannot activate until the owner configures the SendGrid Event Webhook (verification key via env), and inbound-provider verification stays separate | — |

## Operator-secret isolation & rotation plan (security requirement)

The full-access admin key (`SENDGRID_PLATFORM_ADMIN_API_KEY`) currently lives in shared project
Edge secrets — readable by ANY deployed function. Smallest safe plan, in order:

1. **Now (shipped in this slice):** CI-enforced zero-reference guard — no function reads it; the
   allowlist is empty until operator tooling exists.
2. **Owner action (rotation):** rotate the admin key in the SendGrid console once this guard is
   deployed, closing the historical exposure window; the new value is installed only when
   operator-only tooling exists to use it.
3. **Before any production administrative operation:** build the operator admin function
   (platform-operator-gated, the allowlist's first and only entry), and prefer moving the admin
   credential out of shared project secrets entirely (dedicated operator-only secret surface or
   separate operator project) so isolation is structural, not conventional.

## Tested behavior (synthetic only)

`buildProvider` resolves sendgrid + correct Mail Send v3 shape (202 → `X-Message-Id` id);
non-202 surfaces `sendgrid_<status>` truthfully; unknown providers fail safe to Resend;
ES256 verifier accepts a correctly-signed DER request and rejects tampered bodies, wrong keys,
malformed base64, malformed DER, and unconfigured keys — 5 webhookSig tests + 3 provider tests,
all mocked (no network, no real credentials; the test key value is synthetic).

## Remaining acceptance requirements (precise)

1. Owner invokes `comms-sendgrid-scopes` (or the check is scheduled) to record the executor key's
   ACTUAL scopes — until then, entitlement is UNVERIFIED (documented capability only).
2. SendGrid Event Webhook configuration (owner console action) + `SENDGRID_WEBHOOK_PUBLIC_KEY`
   env + the receipt-door sub-slice shipping.
3. Any live send remains gated on the separately verified test identity/conssent/provider-policy/
   INT-346 authority — unchanged.
4. `sg-mail.paigeagent.ai` connector wiring (product usage, owner decision when to trial).
5. Admin-key rotation (plan step 2 above).
