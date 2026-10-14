# PAIGE Mail — SendGrid Integration (ANT-43/S7), Slice 1: Bounded Send Adapter

**Date:** 2026-10-10. **Status:** source integration; **activates nothing** — no customer sends,
no transport switch (platform default remains Resend), no webhook configured, no DNS/purchase/IP
changes. Branding unchanged: tenants see **PAIGE Email**; SendGrid is an invisible backend; Resend
remains available for Platform Operator communications.

> **SUPERSEDED BY OWNER DIRECTIVE 2026-10-14**: SendGrid is the one email provider for all PAIGE email, and Resend is being retired.
> "Platform default remains Resend" and "Resend remains available for Platform Operator communications" above are kept
> as written for the 2026-10-10 record. Plan: `docs/delivery/exp03-launch-email-providers-plan.md` (addendum "SendGrid-only cutover plan").

## Source integration matrix

| Surface | State | Where |
|---|---|---|
| `EmailProvider` seam | **Removed (Experience 03 round-4 security LOW-3).** The `SendGridProvider` adapter read the platform key on a tenant-controlled `email_provider` with no domain check; `buildProvider` now resolves `sendgrid` to `UnimplementedProvider` (refuses, never falls back to another provider). SendGrid sends only through the governed door below. | `_shared/email/providers.ts` |
| Canonical send door | `send-message` gains a `sendgrid` dispatch arm, selected ONLY by `connectorRow.provider === "sendgrid"`; key is ALWAYS the platform executor secret `SENDGRID_MAIL_SEND_API_KEY` (the `buildProvider` seam separately honors namespaced `TENANT_EMAIL_KEY_*` tenant keys); List-Unsubscribe + In-Reply-To headers preserved; `provider_message_id` = `X-Message-Id` | `send-message/index.ts` |
| Signature verification | Canonical ES256 verifier `verifySendgridEvent` (SPKI PEM public key, DER→P-1363 conversion, fail-closed reasons) with 2 deno tests | `_shared/webhookSig.ts` |
| Scopes self-check | `comms-sendgrid-scopes` — operator-gated (JWT + `is_platform_owner`), GET `/v3/scopes` with the EXECUTOR key only, returns scopes + `can_send_mail`/`non_sending_scopes`; never the key; no send capability | `comms-sendgrid-scopes/index.ts` |
| Admin-key guard | CI step forbids `SENDGRID_PLATFORM_ADMIN_API_KEY` references in ALL function code (allowlist intentionally empty) *(out of date since S7.4, 2026-10-12, corrected 2026-10-14: the guard is per-(file, key) and allows exactly `comms-sendgrid-webhook-admin/index.ts` → `SENDGRID_WEBHOOK_ADMIN_API_KEY`; the full-access key stays forbidden everywhere. See the S7.4 section below)* | `scripts/ci/forbid-sendgrid-admin-key-refs.mjs` + ci.yml |
| Gate preservation | Provider selection cannot bypass tenant authorization, Marketplace eligibility, content policy, approval or quotas: the arm sits INSIDE the canonical door after the capability gate, action-risk/one-approval-gate, and `comms_provider_execution_allowed` — no new authority, no second dispatch system | `send-message` + `comms-email/adapter.ts` (unchanged) |
| Delivery events | **Not in this slice** (next sub-slice): the ES256 verifier is ready; the event door cannot activate until the owner configures the SendGrid Event Webhook (verification key via env), and inbound-provider verification stays separate | — |

## Operator-secret isolation & rotation plan (security requirement)

The full-access admin key (`SENDGRID_PLATFORM_ADMIN_API_KEY`) currently lives in shared project
Edge secrets — readable by ANY deployed function. Smallest safe plan, in order:

1. **Now (shipped in this slice):** CI-enforced zero-reference guard — no function reads it; the
   allowlist is empty until operator tooling exists. *(Corrected 2026-10-14: the allowlist gained its one entry in
   S7.4 — the operator broker, scoped key only. The full-access key is still read by nothing. Under the owner's
   2026-10-14 two-credential model, PAIGE-SENDGRID-PLATFORM-ADMIN would be read in one operator-only admin function,
   which needs an owner ruling to amend this guard — cutover P1.)*
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
malformed base64, malformed DER, and unconfigured keys — 2 new webhookSig test functions (6 assertions; suite totals 15) + 3 provider tests,
all mocked (no network, no real credentials; the test key value is synthetic).

## ANT-148 corrections (2026-10-12)

Two P1s corrected before any owner configuration: (1) the canonical verifier now
signs **timestamp + raw body** per the official Twilio protocol (the timestamp
header is part of the signed content — body-only verification accepted replayed
bodies); (2) the acknowledgment contract — HTTP 200 only when every recognized
event is durably committed, already committed, or ignored by mapping; RPC
errors, thrown calls, and `pending` results return **503 retriable**; batches
over 1000 refused 413; event identities are batch-index-stamped so same-second
distinct events never collapse while identical redeliveries dedup. `unsubscribe`
is acknowledged and NOT recorded (no canonical unsubscribed receipt status;
suppression/complaint propagation is an explicit deferred decision until tenant
routing — the resend path writes `paige_suppressions` from resolved campaign
context the SendGrid receipt path does not yet have). Actual-handler regression
suite: `src/solo/sendgrid-webhook-handler.test.ts` (11 cases: the ack matrix,
partial batches, oversized, tampered/absent timestamp, unsigned, unconfigured).

## Revised owner-console acceptance procedure (post-ANT-148)

**Preferred: automated configuration** (owner continuity ruling 2026-10-12).
The platform manages Event Webhooks through SendGrid's v3 API from an
operator-only function — inspecting existing settings first (reuse, never
duplicate), preparing the webhook with signature enabled in a disabled state,
and surfacing the verification public key for `SENDGRID_WEBHOOK_PUBLIC_KEY`.
**Credential requirement (the one escalation):** this needs a SendGrid API key
with webhook-management scopes. The Mail Send executor key must NOT be used
(it cannot manage webhooks) and the full-access admin key must NOT be exposed
to Edge functions. The single owner action: create a **scoped key**
(webhook read/write only) in the SendGrid console and install it as
`SENDGRID_WEBHOOK_ADMIN_API_KEY` — the automation function is its only reader
and the full-access key stays untouched (and remains owed rotation on its own
track). Until that key exists, the manual sequence below remains valid.

Manual sequence (fallback): Settings → Mail Settings → Event Webhook →
Post URL `https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/handle-sendgrid-webhook`,
HTTP auth None, Signed events ON, deliver the ECDSA public key PEM as
`SENDGRID_WEBHOOK_PUBLIC_KEY`, select delivered/deferred/open/click/bounce/
dropped/spamreport (unsubscribe acknowledged-unrecorded; processed unmapped).
**Acceptance truth:** SendGrid's console *Send test event* is synthetic — it
proves signed connectivity only, NEVER correlation with a real sent message.
Correlation proof requires an actual authorized send recording `X-Message-Id`
and a subsequent event whose `sg_message_id` first segment equals it — that
round-trip remains separately authorized.

## Remaining acceptance requirements (precise)

1. Owner invokes `comms-sendgrid-scopes` (or the check is scheduled) to record the executor key's
   ACTUAL scopes — until then, entitlement is UNVERIFIED (documented capability only).
2. SendGrid Event Webhook configuration (owner console action) + `SENDGRID_WEBHOOK_PUBLIC_KEY`
   env + the receipt-door sub-slice shipping.
3. Any live send remains gated on the separately verified test identity/conssent/provider-policy/
   INT-346 authority — unchanged.
4. `sg-mail.paigeagent.ai` connector wiring (product usage, owner decision when to trial).
5. Admin-key rotation (plan step 2 above).


## S7.3 (ANT-78, 2026-10-12): stable provider identity, retry-safe freshness, operator automation

**Event identity (P2 closed):** the receipt identity is now the provider's own
`sg_event_id` (`sg:<sg_event_id>`) — stable across redeliveries regardless of
batch composition or ordering, so dedup no longer depends on array position.
Journal-level verification needs NO migration (the RPC is identity-agnostic and
its id regex accepts the provider shape). Failing-first suite (14 cases)
proves: identical redelivery recorded once; reordered / differently-batched
redelivery idempotent; two legitimate same-second events for one message both
persist; and the QUARANTINE POLICY — recognized events missing or carrying a
malformed `sg_event_id` or `sg_message_id` are never silently ignored nor
misrepresented as accounted-for: they fail the batch retriable (503) with a
loud `quarantined_event` log, so the trail exists in provider and our logs.

**Signature freshness vs 24h retries (verified, no loosening):** provider
documentation and community-verified behavior confirm retries generate a FRESH
timestamp and recomputed signature per delivery attempt — a temporary 503 can
never cause later legitimate retries to fail as expired. The 5-minute window
stays exactly as-is (its purpose is bounding captured-triple replay, which
fresh-signature retries do not affect). No security-policy tradeoff required.

**Operator automation (built, mocked-verified):** the broker
(`_shared/comms-email/sendgrid-webhook-admin.ts` + operator-gated
`comms-sendgrid-webhook-admin` function — the CI guard forbids BOTH admin
key names everywhere else in function code, and the broker is the scoped
key's only reader) implements the owner's automated workflow: inspect
the existing webhook; REUSE it when it already points at the approved PAIGE
receiver (never duplicating); refuse to repoint a webhook aimed elsewhere;
otherwise PATCH/POST with the approved receiver + signature verification ON
and delivery DISABLED; fetch the ECDSA public key and return it once for
installation as `SENDGRID_WEBHOOK_PUBLIC_KEY`. Only the four SendGrid
settings endpoints are callable; arbitrary destination URLs are refused
pre-fetch; the credential never crosses logs or responses. 7 mocked tests.

**Exact credential scopes (verified against the API reference):** the
settings endpoints (GET/POST/PATCH `/v3/user/webhooks/event/settings` and GET
`/v3/user/webhooks/event/settings/signed`) are covered by
`user.webhooks.event.settings.read` + `user.webhooks.event.settings.write`.
Caveat stated precisely: Twilio's scope table annotates these two scopes for
settings read/update; whether a restricted key may CREATE (POST) a first
webhook and read the signed key is not separately annotated — the broker
reports a 403 truthfully if either is blocked, and the secure alternative is
adding that one missing scope, never a Full Access credential. The single
owner action remains: create the scoped key and install it as
`SENDGRID_WEBHOOK_ADMIN_API_KEY`.

**Still reserved (unchanged):** enabling real delivery, tenant SendGrid
routing, real sends/paid tests, treating synthetic test events as delivery
evidence, INT-346 activation. Unsubscribe/suppression protections preserved
ahead of any customer-facing routing.

**Update 2026-10-13 (Experience 03 S3, branch `claude/stoic-archimedes-pv4r8u`, not merged when recorded).**
Owner policy: a business's PAIGE Email sends through SendGrid, and Resend is the Platform Operator's own email.
**SUPERSEDED BY OWNER DIRECTIVE 2026-10-14** (sentence above kept as written): Resend is no longer the Platform Operator's email; all PAIGE email moves to
SendGrid and Resend is being retired. Plan: `docs/delivery/exp03-launch-email-providers-plan.md` (addendum "SendGrid-only cutover plan").
S3 builds tenant SendGrid routing at the governed one-to-one door (`20271031000100`): verification facts on
`tenant_email_domains` that only the service role may write, and admission at prepare and again at send time.
It also builds the correlated, forward-only application of verified Event Webhook events to governed
messages (`20271031000200`). Nothing is activated: there is no live send, no configured webhook and no
verified domain. The operator steps are in master §5.
Review round 4 adds `20271031000250` and closes `send-message`'s second path: a SendGrid connector sends only
for the email door's prepared operation (`paige_email_requires_governed_send` otherwise), only the service role
may create or change a SendGrid connector, and one SendGrid-verified claim is allowed per domain across
businesses. A send whose outcome is unknown settles from a webhook event only when all three `custom_args`
claims and the recipient match. A per-business DNS proof of domain ownership is still owed.


## S7.4 (ANT-78 closeout, 2026-10-12): broker hardening + credential setup package

**P3 hardening shipped:** the CI guard is now per-(file, key) — the operator
broker is the only file that may reference ANY SendGrid administrative
credential, and it may reference ONLY the scoped `SENDGRID_WEBHOOK_ADMIN_API_KEY`;
a swap to full access inside the broker itself now fails CI (verified by a
four-way probe matrix: full-access-in/scoped-in/scoped-out/full-access-out).
The reuse-PATCH branch (existing approved-receiver webhooks that are unsigned
or delivering get PATCHed into the prepared state) is pinned by two new
mocked tests; the broker suite is 9/9.

### Owner credential setup package (minimum privilege)

1. In the SendGrid console: Settings → API Keys → Create API Key, **Restricted
   Access**, granting exactly:
   - `User → Webhooks → Event Webhook Settings → Read`
   - `User → Webhooks → Event Webhook Settings → Write`
   (`user.webhooks.event.settings.read` / `.write`.)
2. Install the value as the Supabase Edge secret
   `SENDGRID_WEBHOOK_ADMIN_API_KEY` (Edge Functions secrets UI or CLI — same
   path as the existing SendGrid secrets; never commit, never log).
3. **Documented uncertainty:** whether a restricted key may CREATE the first
   webhook (POST) and read the signed public key is not separately annotated
   in the provider's scope tables. If either is blocked, the broker returns a
   truthful 403 report (`sendgrid_403:…`) — the safe alternative is adding
   exactly the missing scope in the console, NEVER a Full Access key.

### Secret install / verify / revoke procedures (no credential exposure)

- **Install:** the secret lands in the Edge secret store; the CI guard
  permits its reference only in the broker function. Verification is
  behavioral: `GET /functions/v1/comms-sendgrid-webhook-admin` with the
  Platform Operator login → 200 with truthful settings (401/403/503
  otherwise; no key material ever appears in responses or logs).
- **Verify webhook config:** `POST` `{"action":"prepare"}` as operator — the
  response reports `action` (reused/patched/created), the resulting
  enabled/signing/url state, and the ECDSA public key ONCE. Install that PEM
  as `SENDGRID_WEBHOOK_PUBLIC_KEY`; the receipt door then leaves its 503
  fail-closed state.
- **Revoke:** delete the SendGrid key in the console and remove the Edge
  secret. The broker then reports 503 NOT_CONFIGURED; the receipt door
  continues to fail closed until a replacement key+PEM are installed.
  Revocation never affects Resend transport or any tenant surface.

### Signed-connectivity acceptance matrix (delivery stays DISABLED throughout)

| Step | Action | Pass | Fail |
|---|---|---|---|
| 1 | Broker `GET` (operator) | 200 truthful settings | any other status |
| 2 | Broker `prepare` (operator) | action + signed:true + enabled:false + PEM returned | 403 → add missing scope (documented above); anything else → report |
| 3 | Install PEM; door unauthenticated POST | 503 → 401 (fail-closed on signature, key live) | still 503 (key not installed) |
| 4 | SendGrid console *Send test event* (delivery disabled — the test posts directly) | door log shows signature-verified receipt attempt with truthful mapping/quarantine counts | 401 in door logs = key/PEM mismatch |
| 5 | Unsigned curl POST to the door | 401 | anything else |
| 6 | Re-check settings via broker | enabled:false + signed:true | — |

**Rollback (to pre-configuration state):** broker shows settings; if a
webhook was created/patched by prepare, PATCH it back or delete it in the
console (or revoke the scoped key entirely — the door 503s fail-closed).
No data migration, no tenant surface, no Resend path is touched by any step
above; the journal remains empty until real delivery is enabled (reserved).

**Separation maintained:** webhook administration (scoped key, broker only) /
Mail Send (executor key, send door only) / tenant routing (connector-gated,
unwired) / suppression enforcement (deferred decision, documented) / live
provider effects (all reserved). The single owner-reserved action remains:
provision the scoped key as `SENDGRID_WEBHOOK_ADMIN_API_KEY` (console test
events are connectivity-only, never delivery evidence).
