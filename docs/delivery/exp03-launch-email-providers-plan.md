# Experience 03 — launch email providers: Gmail and iCloud Mail (grounded plan)

Date: 2026-10-13 · Journey Lead: Experience 03 · Owner decision: Gmail and iCloud Mail are public-launch targets; businesses keep the address they already use. Policy preserved: PAIGE-managed tenant email = SendGrid · customer Gmail = Gmail OAuth · customer iCloud Mail = provider-supported IMAP/SMTP · Platform Operator system mail = Resend.

> **SUPERSEDED BY OWNER DIRECTIVE 2026-10-14**: "Platform Operator system mail = Resend" above is kept as written. All PAIGE email — Platform Operator,
> platform transactional and tenant — moves to SendGrid, and Resend is being retired. Customer Gmail (OAuth) and iCloud
> Mail stay optional customer mailboxes, unchanged. The cutover plan is the addendum at the end of this file.

**Status: GROUNDED PLAN, NOT BUILT.** Read-only grounding (four investigators plus an adversarial checker, production SELECT only, no provider calls, no secrets read). Evidence classes: code reading, production read, official provider documentation. Nothing here is authenticated runtime proof.

Full investigator reports are not committed. This file is the reviewed synthesis. Rows marked UNVERIFIED stay unverified until the named proof runs.

---


This was a read-only review at HEAD `47c8d117`; one investigator cited `351ea18b`. S3 has uncommitted work in progress in this tree: `readiness.ts`, the `execute-approval/*` files, the new `lead-reply-approval.ts`, and migration `20271031000100_paige_email_sendgrid_governed_door.sql`. Production was read with SELECT only.

**Bottom line:** Gmail sending already works through the approval path and needs repairs, not a rebuild. Gmail receiving exists as code but no screen reaches it, and it needs Google's restricted-scope review plus a paid annual security assessment (CASA). iCloud cannot run on Supabase at all for sending, because Supabase blocks port 587. The owner's premise that Conversations reads mail through `useConversations.ts` is wrong: that file is dead code, and the live inbox is `ClientsConversations.tsx`.

## 1. Spot-checks

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Send consent asks for `gmail.send` + `userinfo.email`. Inbox consent asks for `gmail.modify` + `gmail.labels` + `userinfo.email`. No screen ever asks for inbox. | CONFIRMED | `gmail-oauth-start/index.ts:135,169-176`. I did not re-run the UI search. |
| 2 | Google classes `gmail.send` as Sensitive. `gmail.modify`, `readonly`, `metadata`, `compose`, `insert` and `mail.google.com` are Restricted. `gmail.labels` is Non-sensitive. | CONFIRMED | Google's Gmail scopes page, fetched today |
| 3 | `gmail.modify` alone allows sending, so one consent can cover send and receive. | CONFIRMED | Google's `users.messages.send` page accepts `mail.google.com`, `gmail.modify`, `gmail.compose` or `gmail.send` |
| 4 | A security assessment is required if restricted data is stored or sent through servers. Reassessment is due at least every 12 months. Review takes "several weeks". | CONFIRMED | Google's restricted-scope verification page |
| 5 | In Testing mode, refresh tokens expire after 7 days. A Gmail-scoped token dies when the user changes password. There is a 100-token cap per account per client. | CONFIRMED | Google's OAuth 2.0 overview page |
| 6 | Supabase blocks outgoing ports 25 and 587. It says nothing about 465. CPU limit 2 s; wall clock 150 s (Free) / 400 s (paid). | CONFIRMED | supabase.com functions limits page |
| 7 | iCloud: IMAP is `imap.mail.me.com:993` (SSL). SMTP is `smtp.mail.me.com:587` (SSL, TLS or STARTTLS). Apple documents no port 465. IMAP username is the name part; SMTP username is the full address. | CONFIRMED | support.apple.com/102525 |
| 8 | The existing SMTP code sends on port 587 with STARTTLS from the edge, so iCloud sending cannot work there. | CONFIRMED for the code, inferred for runtime | `smtp.ts:73` allows 587, and L373-384 sets `tls=false` (STARTTLS). This has never run in production: 0 SMTP connectors. |
| 9 | The Gmail send lane exists in the approval path: `comms-email-command` → adapter → `send-message` → `gmailSend`. | CONFIRMED | `send-message/index.ts:238-277`, `gmail.ts:206-276` |
| 9a | Gmail's `threadId` is dropped. | CONFIRMED | `send-message:277` returns only `provider_message_id` |
| 9b | No `Message-ID` header is set, and `In-Reply-To` is given a provider id instead of an RFC Message-ID. | CONFIRMED | `gmail.ts:224-236` |
| 9c | Only Resend sends can be reconciled. | CONFIRMED | `adapter.ts:179`; `20270597000000:105-111` |
| 10 | Dedup uses a **global** unique index on `provider_message_id`, not one per tenant or mailbox. | CONFIRMED | Production: `UNIQUE (provider_message_id) WHERE NOT NULL` |
| 11 | Mailbox sync imports the whole mailbox, not just known contacts. | CONFIRMED, with limits | Only for connectors with a read scope **and** `inbound_address` (`gmail-mailbox-sync:88`). First run is the last 14 days, up to 200 messages (`sync.ts:9-10`); then all history. No label filter. Metadata and snippet only, never full bodies. `contact_id` is never set (`sync.ts:28-42`). Thread key is `email:{connector}:{addr}` (`sync.ts:72-74`). |
| 12 | `useConversations.ts` asks for a `metadata` column that production doesn't have. | CONFIRMED | `useConversations.ts:92`; production has `meta` and no `metadata` |
| 12a | `useConversations.ts` is reachable from the live app. | **WRONG** (Gmail report) | Solo renders `ClientsHub` only for the `pipe` and `deliv` tabs (`SoloApp.tsx:53`, `workspaceModel.ts:29-30`). The Conversations tab goes to `TenantRelationshipsClientsWorkspace.tsx:39` → `ClientsConversations`. The Conversations report had this right. |
| 13 | The Conversations reply composer and draft "Approve" call `send-message` directly. No `src/` product file calls `comms-email-command`; only `src/__tests__/*` do. | CONFIRMED | `ClientsConversations.tsx:947,1063`; search of `src` |
| 14 | A send-only connect followed by an inbox connect on the same address returns a 409. | CONFIRMED | `mailbox_class` is set only when purpose is `inbox` (`gmail-oauth-callback:254-270`). The `shared_support` conflict is at L298-302. All 8 production rows are `shared_support`. |
| 15 | Gmail connect and disconnect check the global `has_role(admin)`, not the tenant role. Disconnect uses `maybeSingle` per provider. | CONFIRMED | `gmail-oauth-start:105`, `gmail-disconnect:46,61-71` |
| 16 | An SMTP send the server accepted is still recorded `unknown`, so it can never satisfy S3's `provider_accepted` gate. | CONFIRMED | `20270597000000:44-45` |
| 17 | SendGrid is excluded from the approval path. | **STALE** | True on HEAD, but S3's uncommitted work adds `sendgrid` (`readiness.ts` `emailProvidersFor`; migration `20271031000100:171`). Do not plan around it; S3 owns it. |
| 18 | Production: 0 Gmail and 0 SMTP connectors; 8 Resend connectors, all `shared_support`; 0 `mailbox_sync_state` rows; 27 email messages; 0 with a reply header. | CONFIRMED | Production query |
| 19 | The platform owner can read every tenant's personal-mailbox messages. | CONFIRMED | Production `messages_select` starts with `is_platform_owner() OR …`; `messages_service_all` is `true` |
| 20 | Race: if sync imports Gmail's Sent copy before the send is recorded, the recording fails with a duplicate-key error (23505) and the send is stuck as `unknown`. | PLAUSIBLE | The recording step writes `provider_message_id` (`20270597000000:263-271`) under the global index. Not executed. |
| 21 | Fly can reach port 587. Edge IMAP on 993 works. | UNVERIFIED | Proof owed (PR E1 below) |

## 2. Gmail: reuse, repair or missing

| Part | Verdict | Note |
|---|---|---|
| Consent start | REPAIR | Check the tenant's own admin role, not the global role. Let the same user upgrade from send to inbox on the same connector row (today that 409s). Record the granted scopes on every connect. |
| Callback and token storage in Vault | REUSE | Same repairs as above (tenant role, scopes). |
| Token refresh | REUSE | On a revoked grant (`invalid_grant`), set the connector to `status='disabled'` and record "reconnect needed". The sync copy of the token code should use `_shared/gmail.ts` instead of its own duplicate. |
| Disconnect | REPAIR | Take a `connector_id`. For a personal mailbox, require the mailbox owner. Message history is kept. A Vault delete function is owed. |
| Send through the approval path | REUSE + REPAIR | Set a Message-ID and pass Gmail's `threadId`. Record the real `threadId`. Change `pipe_used` from `resend`. A personal mailbox may send only for its own owner (`readiness.ts`; this collides with S3, see section 6). |
| Reconcile a send whose outcome is unknown | MISSING | Needs a Message-ID plus a read scope to search for it (`rfc822msgid:`). Without that, show the send as "needs a person". |
| Reply threading | REPAIR | Store the RFC `Message-ID`, `In-Reply-To` and `References` headers. |
| Sync engine (fetch, cursor, schedule, soft delete) | REUSE | |
| Sync output | REPAIR | Look up contacts (lookup only, never create), use the contact thread key, write through one merge-style function, and decide the privacy filter (section 8). |
| Receive in the UI | MISSING | `settings.tsx:701` shows the mailbox tile as "Unavailable". No screen reads `mailbox_sync_state`. |
| Connection status | REPAIR | A grant revoked at Google still shows "Connected", because the UI checks for status `'revoked'`, which can never be written. |
| Organize door (`comms-mailbox-command`) | REUSE | Labels and trash/untrash require `gmail.modify`. |

## 3. iCloud: what exists and what is missing

**Exists:**
- A generic SMTP send arm: `smtp.ts`, plus the SMTP branch of `send-message`.
- `smtp-connect` and `smtp-disconnect`.
- Readiness already accepts `smtp`.
- Vault storage functions.
- The Fly `paige-browser` host, which is the only compute outside Supabase.

**Missing:**
- **Sending:** port 587 is blocked on Supabase Edge, so a non-edge transport is needed. Fly is the candidate; its 587 access is unproven.
- **Receiving:** there is no IMAP code at all. Searches for `imap`, `imapflow`, `993`, `mail.me.com`, `icloud` and `app-specific` found only CalDAV calendar code and docs.
- **Connector shape:** `smtp-connect` keys one connector per tenant with a tenant-level secret and the `shared_support` class. iCloud is one person's mailbox, so it needs a personal connector with its owner and a per-account secret.
- **Credential check:** the connect test only checks the server is reachable, not that the password works. iCloud should test with an IMAP login and logout.
- **Sync cursor:** `mailbox_sync_state` has no UIDVALIDITY or last-UID fields.
- **Dedup key:** must be namespaced per connector (the global index collides).
- **Send idempotency:** SMTP returns no message id, so PAIGE must set its own Message-ID and read the Sent folder back.
- **Revocation:** an Apple account password change revokes every app-specific password. A login failure must flip the connector to reconnect-required with no retry loop.
- **Bulk-send guard:** Apple allows 1000 messages a day and prohibits bulk mail; nothing excludes iCloud from campaigns today.
- **UI:** `EmailIntegrationConfig.tsx` is not mounted anywhere.

## 4. Google review, CASA and launch timing

| Scope | Verification | Timing |
|---|---|---|
| `gmail.send` | Brand plus sensitive-scope review; no security assessment | About 3–5 business days, plus brand verification (Google's estimate, not a promise) |
| `gmail.modify` | Restricted review **plus CASA** by a Google-approved lab, repeated yearly | "Several weeks" for the review; CASA only starts when Google reaches out. My estimate is 6–12 weeks (UNVERIFIED). |

- **There is no cheaper Gmail scope for background receive.** Every read scope is restricted.
- **CASA cost:** about $675–$5,400 a year, from vendor-published prices only (UNVERIFIED).
- **Before verification, there are two options and both are limited:**
  - **Testing mode:** at most 100 test users, and tokens expire every 7 days, which breaks the 5-minute sync weekly.
  - **Production but unverified:** users see Google's unverified-app warning, and there is a **100-user lifetime cap shared with Calendar**, because Calendar uses the same `GOOGLE_OAUTH_CLIENT_ID`.
- **Risk:** customer Gmail receive is unlikely to be fully verified before roughly late November 2026 to January 2027.
- **Mitigation:** keep the restricted inbox consent on its own OAuth client in its own Google Cloud project, so the send and Calendar approval is not held behind the restricted review. Whether Google would hold it is UNVERIFIED.

## 5. Communications and Conversations integration plan

Contract changes, in order:

1. **Message identity and per-mailbox uniqueness (migration; backend change, owner stop).**
   - Add `rfc_message_id`, `provider_thread_id`, `rfc_references text[]` and IMAP folder/UIDVALIDITY/UID fields to `messages`.
   - Replace the global unique index with indexes per connector: `(connector_id, provider_message_id)` and `(connector_id, rfc_message_id)`, plus a tenant-scoped fallback for rows with no connector.
   - Inventory every lookup that changes first: `handle-inbound-email:388`, `send-message:1645-1660`, `gmail-mailbox-sync:296`, `mark_message_removed_by_provider`.
2. **One writer for synced mail.** A new database function `record_synced_email` that **merges** a row matching on provider id or RFC Message-ID instead of inserting a second one (this closes the race in check 20).
   - It resolves the contact by lookup only (`findClientIdByAddress`) and uses the `contact:{tenant}:{contact}` thread key.
   - Owners: new migration, `gmail-mailbox-sync/index.ts:67,283-297`, `_shared/inbox-intelligence/sync.ts`.
3. **The approval path sets the RFC Message-ID.**
   - `prepare_comms_email_send` stores the Message-ID; each provider arm sets the header (`send-message:238-427`, `gmail.ts`, `smtp.ts:381-392`).
   - SMTP and iCloud: a server acceptance (250) becomes `provider_accepted`, with the Message-ID as the receipt. This unblocks S3's lead-reply gate for iCloud.
   - Owner: a replacement migration, which **must be based on S3's version of `prepare_comms_email_send`**.
4. **Reply context in the approval path.**
   - Add `in_reply_to_message_id` (a `messages.id`) to `contract.ts`. The server resolves the parent message in the same tenant and contact.
   - It derives `In-Reply-To`, `References`, the subject and the Gmail `threadId`, and includes them in the approval fingerprint and the preview card (`comms-email-command`, `PaigeConfirmCard`).
5. **Sending account choice.**
   - A personal mailbox is eligible only when the person acting is its owner.
   - Readiness exposes one state per connector: ready / needs reconnect / disconnected (`readiness.ts`, after S3).
   - Remove the composer's silent fallback to another account (`ClientsConversations.tsx:822-830`).
6. **Conversations sends email through the approval path.**
   - The composer and draft "Approve" email branches (`ClientsConversations.tsx:947,1063`) call `comms-email-command` through the existing `src/pages/admin/conversations/governedSend.ts` (extended; §13 correction 2026-10-13 — it is not new), with the preview card inline.
   - SMS stays on `send-message`.
   - Attachments and scheduling on email show as UNAVAILABLE until the approval path supports them.
7. **Connection lifecycle.**
   - Disconnect by `connector_id` (`gmail-disconnect`, `smtp-disconnect`, and the new iCloud disconnect).
   - A revoked grant or failed login sets status to disabled with a reason; `mailbox_sync_state` is marked stopped; message history is kept.
8. **iCloud transport (backend change, owner stop).**
   - Fly `paige-browser` gets two endpoints: `POST /mail/imap-fetch` (read-only: `EXAMINE`, `BODY.PEEK`) and `POST /mail/smtp-submit` (587, STARTTLS required). They are shared-secret gated, with the iCloud hosts fixed in code.
   - New edge function `icloud-connect` (credential check by IMAP login) and `icloud-mailbox-sync` (scheduled, writes through change 2).
   - `send-message` gets an `icloud` arm that calls Fly.
   - The credential is a per-person Vault entry: `icloud_mail_credentials:{tenant}:{owner}`.
9. **Delivery truth (later).** Show Gmail and SMTP as "accepted, delivery not reported". Parse bounce reports (DSN), and never create a lead from mailer-daemon mail.
10. **Clean-up.** Remove the unreachable `src/solo/useConversations.ts` and `Inbox2` path. They are not a shipped, reachable capability, but the removal is flagged under §58 anyway.

## 6. Launch-critical vs later

**Launch-critical:**
- Gmail send through the approval path.
- Connect, disconnect and status for Gmail with the tenant-role and personal-owner fixes.
- Conversations email going through the approval path (change 6).
- The Message-ID and per-mailbox identity (changes 1–3).
- Gmail receive into contact threads (change 2), running unverified or for pilot users only until the restricted review clears.
- iCloud send and receive (change 8).

**Later:**
- Bounce/DSN parsing and delivery truth.
- Full message bodies (today: snippet only).
- Reconciling Gmail sends with an unknown outcome (until then, "needs a person").
- Email in contact and deal history (`ContactDetail.tsx:139`, `DealDrawer.tsx:79`).
- A Vault delete function.
- Retiring the `paige_conversations` dual-write.
- Labels and organize screens.
- Fixing the sync's `.limit(25)` with no ordering.

## 7. First bounded PRs, ordered around S3

S3 currently owns `readiness.ts`, `comms-email-command`, `execute-approval/*` and the `prepare_comms_email_send` replacement. Nothing below touches those until S3 merges.

| # | Title | Files | What it proves | Size | Depends on |
|---|---|---|---|---|---|
| G1 | Gmail and SMTP connect/disconnect use the tenant's own admin role and disconnect a specific connector | `gmail-oauth-start`, `gmail-oauth-callback`, `gmail-disconnect`, `smtp-connect`, `smtp-disconnect` | An admin in tenant A who is only a member in B is refused in B. With two Gmail rows, the named one disconnects. A personal mailbox can only be disconnected by its owner. | S | none (parallel to S3) |
| G2 | One Gmail connection for send and receive, and revoked grants show honestly | `gmail-oauth-callback` (same user upgrades the same row; scopes always recorded; customer Gmail is personal), `gmail-mailbox-sync` (use `_shared/gmail.ts` tokens; revoked grant → disabled), `useSoloComms.ts` status | Upgrading from send to inbox needs no 409. A revoked grant shows "Reconnect". | S–M | G1 |
| E1 | **Proof only:** iCloud transport reachability | none in the product; results go in the evidence record | Fly reaches 587 (STARTTLS) and 993. Whether an edge function can do a TLS handshake to 993. One authorised login and logout on the test iCloud account. | XS | none |
| M1 | Message identity migration and `record_synced_email` (owner sign-off) | new migration, a SQL test | Same Message-ID in two tenants → two rows. Same message in one mailbox → one row, merged. Race case → merge, never a duplicate-key error. | M | none (does not touch `prepare_*`) |
| G3 | Gmail sync writes canonical rows linked to contacts | `gmail-mailbox-sync`, `sync.ts` | Inbound mail from a known contact lands in the `contact:` thread. Unknown senders follow the owner's privacy ruling. No contact is ever created. | M | M1 |
| D1 | The approval path sets Message-ID, carries reply context and Gmail `threadId`, and SMTP acceptance counts | migration replacing `prepare`/`finalize`, `contract.ts`, `comms-email-command`, `send-message` arms, `gmail.ts`, `smtp.ts` | A reply threads in the recipient's client. The fingerprint covers the reply headers. SMTP acceptance becomes `provider_accepted`. | M–L | **S3 merged**, M1 |
| C1 | Conversations sends email through the approval path | `ClientsConversations.tsx`, existing `conversations/governedSend.ts` (extend), `PaigeConfirmCard` | Composer and draft Approve both go through approval and fingerprint and are recorded in `messages`. No silent account fallback. SMS is unchanged. | M | D1, plus the S3 `readiness.ts` changes (change 5) |
| U1 | Connections screen: Gmail receive and mailbox status | `src/solo/settings.tsx:701,1123`, `useSoloComms.ts` | The owner can connect, see sync status, reconnect and disconnect from a genuinely empty state. | S–M | G2 |
| I1 | Fly mail transport and iCloud connect | `services/paige-browser` `/mail/*`, new `icloud-connect` edge function, connections screen entry | A valid app password connects and creates a personal connector. A bad password is refused with nothing stored. | M | E1, owner approval of the backend change |
| I2 | iCloud receive | new `icloud-mailbox-sync` plus its schedule, cursor columns migration | Bounded 14-day backfill, then incremental. A UIDVALIDITY reset re-windows without duplicates. | M | I1, M1 |
| I3 | iCloud send | `send-message` `icloud` arm, campaign exclusion, daily cap | A send goes through the approval path, `Message-ID` is read back from the Sent folder, and an iCloud campaign send is refused. | S–M | I1, D1 |

## 8. Independent test strategy (Central QA, ANT-52 Solo account)

- **Protected fixtures, owned by the team:**
  - One test Google account, listed as a Testing-mode test user or on a pilot OAuth client.
  - One test iCloud account with two-factor authentication and an app-specific password.
  - Two team-owned recipient mailboxes.
  - No real customer address ever appears in a fixture. Sends to any other recipient are refused by a QA-only allowlist checked in the approval path, or by using contacts whose only email is a team mailbox.
- **Static and unit:**
  - Normalization, dedup keys, contact lookup without creation, and the personal-sender rule.
  - Each test is shown failing against the reinstated defect first (§71.4).
- **SQL proofs (BEGIN…ROLLBACK, then confirmed applied in production after merge):**
  - Cross-tenant identical Message-ID, the merge race, per-connector uniqueness.
  - The `messages_select` personal-mailbox visibility rules.
- **Behavioural, on ANT-52 through the real UI:**
  1. Start from no connector.
  2. Connect Gmail, check status.
  3. Approve a reply from Conversations and check the preview.
  4. Check the recipient receives a threaded reply.
  5. Send an inbound reply from the fixture; it appears in the same contact thread within one sync cycle.
  6. Revoke at Google; the screen shows "Reconnect".
  7. Disconnect; history is kept and sends are refused.
  8. Repeat for iCloud.
  9. Switch accounts; another admin can neither send as nor see the personal mailbox.
- **Tier checks (§51):** Solo, Sub-account, Agency (refused or not applicable), Client and Anonymous (refused).
- **Evidence:** each class reported separately. Authenticated production runs on ANT-52 are the only runtime proof; harness doubles are labelled as such.

## 9. Owner-only provider actions

**Google:**
1. Google Cloud Console, OAuth consent screen:
   - App name, logo, support email, and homepage on the paigeagent.ai domain.
   - `/privacy` linked from the consent screen.
   - Authorized domains.
   - Domain ownership verified in Search Console.
2. **Decide:** a separate Google Cloud project and OAuth client for the restricted inbox scope, or one client.
   - Either way, add the redirect URI `…/auth/gmail/callback` and enable the Gmail API.
   - Install that client's ID and secret if it is separate.
3. Submit for verification:
   - Brand, then `gmail.send` (sensitive) and the Calendar scope.
   - Demo video, unlisted on YouTube, showing the consent screen with the client ID and how each scope is used.
   - A per-scope justification, including why a narrower scope is not enough.
4. Submit `gmail.modify` (restricted). When Google Trust & Safety reaches out:
   - Engage a CASA lab and pay for it (about $675–$5,400 a year, UNVERIFIED).
   - Pass the annual reassessment every year.
5. **Decide the pre-verification posture:** a Testing-mode pilot (7-day reconnects), production-unverified (100-user lifetime cap shared with Calendar), or Gmail send-only at launch.

**Apple:** nothing from the owner. Each user creates their own app-specific password, which requires two-factor authentication.

**PAIGE:**
- Approve the backend changes (M1, I1, I2): migrations, new edge functions, Fly endpoints.
- Install the Fly shared secret and the Vault delete function.
- Accept the Fly wake-ups from scheduled iCloud sync.

**Product rulings still needed:**
- Should personal Gmail/iCloud import all mail or only mail from known contacts?
- Should a personal mailbox ever create leads automatically?
- Should the platform owner keep visibility into tenants' personal mail (the `is_platform_owner()` branch in the `messages` policy)?

**Files:**
- `/home/user/Paige-Agent-AI/supabase/functions/gmail-oauth-start/index.ts`
- `/home/user/Paige-Agent-AI/supabase/functions/gmail-oauth-callback/index.ts`
- `/home/user/Paige-Agent-AI/supabase/functions/gmail-disconnect/index.ts`
- `/home/user/Paige-Agent-AI/supabase/functions/gmail-mailbox-sync/index.ts`
- `/home/user/Paige-Agent-AI/supabase/functions/_shared/inbox-intelligence/sync.ts`
- `/home/user/Paige-Agent-AI/supabase/functions/_shared/gmail.ts`
- `/home/user/Paige-Agent-AI/supabase/functions/_shared/smtp.ts`
- `/home/user/Paige-Agent-AI/supabase/functions/send-message/index.ts`
- `/home/user/Paige-Agent-AI/supabase/functions/_shared/comms-email/readiness.ts` (S3 in flight)
- `/home/user/Paige-Agent-AI/supabase/functions/_shared/comms-email/adapter.ts`
- `/home/user/Paige-Agent-AI/supabase/migrations/20270597000000_comms_email_send.sql`
- `/home/user/Paige-Agent-AI/supabase/migrations/20271031000100_paige_email_sendgrid_governed_door.sql` (S3, uncommitted)
- `/home/user/Paige-Agent-AI/src/pages/admin/ClientsConversations.tsx`
- `/home/user/Paige-Agent-AI/src/components/tenant-relationships/TenantRelationshipsClientsWorkspace.tsx`
- `/home/user/Paige-Agent-AI/src/solo/useConversations.ts` (unreachable)
- `/home/user/Paige-Agent-AI/src/solo/SoloApp.tsx`
- `/home/user/Paige-Agent-AI/src/components/tenant-relationships/workspaceModel.ts`
---

# Addendum 2026-10-13 — owner direction and decision prep

## Owner product decisions (2026-10-13)

1. **Personal mailbox import:** known business contacts only. No whole-mailbox import into CRM Conversations. A broader, explicitly authorised inbox experience may come later with its own consent, privacy controls and retention rules.
2. **Lead creation:** unknown personal senders are never turned into leads automatically. PAIGE may recommend creating one; the owner confirms. Any future automation needs its own governed opt-in policy.
3. **Tenant email privacy:** platform ownership grants no routine access to tenant personal email content. The production `messages_select` platform-owner branch must be corrected before public mailbox onboarding, keeping narrow operational diagnostics and auditable exceptional access.
4. **Gmail scopes:** narrowest scopes that support the intended actions — no `gmail.modify` where read-only suffices.
5. **iCloud:** prove SMTP 587 and IMAP 993 from the proposed Fly environment first; do not assume `paige-browser` is an appropriate mail transport. No new paid infrastructure without separate authorisation.

## Decision prep (read-only research, adversarially checked: 23 claims, 20 confirmed, 0 wrong, 2 partial, 1 unverified)

## (a) Google: one project or two

**Spot checks**
1. **Confirmed.** The inbox consent asks for `gmail.modify` + `gmail.labels` + `userinfo.email`, and the send consent asks for `gmail.send` + `userinfo.email` (`gmail-oauth-start/index.ts:169-176`). Calendar asks for `calendar.events.owned` + `userinfo.email` (`google-calendar-oauth-start/index.ts:118-121`). Every flow sends `include_granted_scopes=true`.
2. **Confirmed.** `gmail-disconnect/index.ts:86` revokes the token at Google. `google-calendar-disconnect` has no revoke call (searched for `revoke`, no hits).
3. **Confirmed.** Google's web-server OAuth page says revocation "removes all OAuth 2.0 scopes previously granted to a project … for all clients registered under that project", and that revoking a combined grant revokes all of its scopes together.
4. **Confirmed.** Google's audience page (answer/15549945) says the 100-user cap is lifetime and cannot be reset. It applies only to requests for "unapproved sensitive or restricted scopes", not to requests asking "only approved" scopes. Testing mode allows 100 test users, and their grants expire after 7 days.
5. **Confirmed.** Google's FAQ (answer/13463817) estimates "10 Business days" for sensitive review and "6 weeks" for restricted, both "not guaranteed". Google charges no assessment fee, and the assessment repeats yearly. The FAQ also does not say a restricted review delays a sensitive approval in the same project, so that point is correctly left UNVERIFIED.
6. **Confirmed.** No code calls the Google Calendar API (searched `calendar/v3` and `googleapis.com/calendar` across `supabase/functions` and `src`, no hits). Production has 1 `staff_calendar_settings` row with 0 Google tokens, 0 Gmail connectors (all 8 connectors are `resend`), and 5 Google sign-in identities.
7. **Confirmed.** The read gate accepts `gmail.readonly` or `gmail.modify`; organizing requires `gmail.modify` (`policy.ts:44-52`). The organize door calls `messages/{id}/modify`, `trash` and `untrash` (`comms-mailbox-command:232,235`), and its refusal says the consent "no longer includes" organization (`:112`).
8. **Confirmed.** The privacy page's "Google API data" section (`Privacy.tsx:91-97`) does not say that Gmail content is sent to AI model providers.

**Correction worth adding.** The plan's REPAIR row ("let the same user upgrade from send to inbox on the same connector row") does not work across two projects. A refresh token only works with the client that issued it. So the connector must record which client issued its token, and an upgrade becomes a new consent in project B. The report notes the client recording, but not that it breaks the plan's upgrade-in-place.

**Summary for the owner**
- **Recommendation: two Google Cloud projects.**
  - **Project A (the existing client):** Calendar and `gmail.send`. These are sensitive scopes, with no security assessment, and review takes about 10 business days.
  - **Project B (new):** the inbox, asking for `gmail.readonly` + `gmail.send` + `userinfo.email`. This is restricted, so it needs Google's review (about 6 weeks) plus the yearly CASA security assessment.
- **The deciding reason.** Google revokes access per project. In one shared project, a Gmail disconnect (our code revokes at Google) also removes the user's Calendar access, and possibly their Google sign-in if that client is in the same project. B's lifetime cap of 100 users then goes only to inbox pilot users.
- **What it costs.** No user is affected today: there are 0 Calendar tokens and 0 Gmail connectors. The work is a second consent screen, a second secret pair, and choosing the client at 5 code places. The connector must also record which client issued its token. Recording it in a new column needs owner approval (§00); deriving it from the consent purpose already in the signed state avoids that.
- **Dropping `gmail.modify` and `gmail.labels`** loses label, archive and trash. That can come back later through incremental consent in project B.
- **Owner actions:**
  1. Choose two projects or one.
  2. Choose the inbox scopes.
  3. Create project B and install its secrets.
  4. Submit A now; submit B, then hire a CASA lab when Google makes contact.
  5. Choose the pilot setup for B: unverified "In production" with Google's warning screen, or Testing mode with a reconnect every 7 days.
  6. Say whether Supabase Auth's Google sign-in client lives in project A.
  7. Add an AI-processing disclosure to `/privacy` before the restricted submission.
- **Money.** Google charges nothing. CASA prices come from vendor pages only (UNVERIFIED), at about $540–$6,000 a year, and replace the plan's "$675–$5,400".

## (b) Canonical QA identity

**Spot checks**
1. **Confirmed.** ANT-21's description says, under "OWNER SUPERSEDING QA ACCOUNT DIRECTIVE — 2026-10-12": "Antonio Cook's existing PAIGE customer account is the official testing account … do not create another QA tenant … No personal-Google account linking or Operator impersonation". The older text ("PC-1 … ONLY default approved", Antonio's account as "a secondary OWNER-controlled alternative") is still in the body, so the stale-text finding stands.
2. **Confirmed.** In production, user `93b0889e…` belongs to two businesses, both standalone with no parent:
   - `36d626be…`: role owner, created 2026-09-13 06:38 UTC, and its only member.
   - `e7f1b157…`: role admin only.
3. **Confirmed.** The user has only a Google sign-in (0 other identities) and no execution-disabled flag. Neither business has `comms_provider_execution_disabled` set. `36d626be` has one active Resend connector and 0 pipelines. So no send-blocking floor applies, as `comms_provider_execution_allowed` shows (`20270602000104:32-58`).
4. **Confirmed.** The PC-1 tenant `bcefc207…` has 0 rows. Its Auth user `0640f8f9…` still exists with 0 memberships.
5. **Confirmed.** Searching for a recipient allowlist finds only `sendgrid-webhook-admin.test.ts`. `test-agency-preview` (`2de8ca80…`) is an agency with 1 member.
6. **Confirmed.** The S2a package names `LIVE_DRIVE_EMAIL` / `LIVE_DRIVE_PASSWORD` or `storageState` (L18-20), says "identifiers stay in ANT-52" (L16), and lists "ids are recorded in ANT-52" (L117). The email plan says "QA-only allowlist" (L178) and "on ANT-52" (L187, L198). The line references the report gives are correct.

**Caveat.** ANT-21 also says "Owner is handling PC-1 deletion; deletion completion is not verified or performed by QA". The orphan Auth user is something to report to the owner, not a QA defect. Small notes: a production read shows `e7f1b157` as standalone with no parent, unlike the history in CLAUDE.md §51. And the ANT-52 comment IDs were not opened.

**Summary for the owner**
- **No conflict.** ANT-21 and ANT-52 name the same account: your existing Solo account, using only the business `36d626be…` that you own. Never select `e7f1b157…`, where you are only an admin and which is a real business.
- **Stale text.** ANT-21 still carries the superseded PC-1 sections and has no register entry for `36d626be`. Per the owner rulings, ANT-21 holds the account register and ANT-52 holds the execution results.
- **Corrections to the S2a package:**
  - Point identifiers at the ANT-21 register.
  - Require the owned standalone business to be selected and verified at startup.
  - Replace the password or exported-session sign-in with ordinary Google sign-in, because the account has no password.
  - Allow one labelled synthetic pipeline, since the account has none.
  - P1 (form notify) must be **Off**: the account has a live sending connection, so any notify address would send real email.
  - Make clear the `.invalid` lead address is backup, not the no-send control.
- **Corrections to the email plan:**
  - The test mailboxes do not exist.
  - The recipient allowlist does not exist and would be new backend work needing your approval (§00).
  - Do not use your own Gmail as the fixture, because sync would import your real mail.
  - Connecting a test mailbox to your real business needs your recorded approval.
  - A second actor needs its own authorisation, with an expiry, revocation and readback.
  - Tier checks: Solo on your account, Agency negatives on `test-agency-preview`, the rest as database-level proofs or UNAVAILABLE.
- **Only you can do these:**
  1. Approve and create 1 Google test account, plus listing it as a test user in Google Cloud.
  2. Approve and create 1 Apple ID with two-factor authentication and an app-specific password.
  3. Approve and create 2 team-owned recipient mailboxes.
  4. Add the ANT-21 register entry.
  5. Decide the orphan PC-1 Auth user.

## (c) iCloud: proving the transport and where it runs

**Spot checks**
1. **Confirmed.** Supabase's limits page says "Outgoing connections to ports `25` and `587` are not allowed." It does not mention 465 or 993. Limits are 2 s of CPU and 150 s / 400 s wall clock.
2. **Confirmed.** Apple's page (102525) gives `imap.mail.me.com:993` (SSL required, TLS as fallback) and `smtp.mail.me.com:587` (SSL required, TLS or STARTTLS as fallback). SMTP needs the full address and an app-specific password. No port 465 is documented.
3. **Confirmed.** Fly pricing: shared-cpu-1x is $2.19/month at 256 MB, $3.69 at 512 MB and $6.70 at 1 GB. A dedicated IPv4 is $2/month and optional (a shared IPv4 is free). Outbound data in North America is $0.02/GB. "New organizations don't have a free tier."
4. **Confirmed.**
   - `services/paige-browser/fly.toml` is the only `fly.toml`: `iad`, 1 GB, scale to zero.
   - The concurrency cap defaults to 3 (`server.js:61`).
   - The egress proxy covers `/browse-public-url` only (`egress-proxy.mjs:13-15`).
   - The service is database-free (README L31-33).
   - The deploy workflow uses `FLY_API_TOKEN`, created with `flyctl auth token` (L16-20, L119).
5. **Confirmed.**
   - `read_channel_secret` and `write_channel_secret` are SECURITY DEFINER with EXECUTE for `service_role` only.
   - `isAuthorizedInternalCaller` is at `systems-check-http.ts:135-143`.
   - `smtp-connect` uses `Deno.connectTls` / `Deno.connect`.
   - Production has 8 connectors, all `resend`.
6. **Confirmed.** The repo has no `api/` folder and `vercel.json` only does rewrites. `exp03-grow-my-business-journey.md:272` says "no Cloudflare account is connected to Paige".
7. **Partly checked.** `cron_token_header()` is EXECUTE for `postgres` only. The edge probe's `net.http_post` call is a production write, so it is correctly an owner stop.
8. **UNVERIFIED (not checked).** That Fly leaves 587 open (only a Fly community thread was cited, not opened) and that `secrets set --stage` reaches a later `fly machine run` machine. The second only matters for step 2b.

**Summary for the owner**
- **Step 1, reachability with no login:**
  - **What runs.** A manually triggered GitHub workflow starts a short-lived Fly machine (256 MB, `iad`, `--rm`, destroyed afterwards) inside a new, empty app `paige-mail-transport` that holds no secrets. It opens `smtp.mail.me.com:587`, upgrades with STARTTLS and lists the login methods, then checks the `imap.mail.me.com:993` TLS greeting. It never logs in and never sends mail.
  - **Cost.** Under $0.001 per run.
  - **What it needs from you:** create the empty app in org `personal`, ideally with a deploy token scoped to that app instead of the existing broad `FLY_API_TOKEN`; approve the sub-cent spend; approve merging the workflow and probe script.
  - **The 993 question from Supabase.** This needs a temporary edge function plus one internal call, which is a new function and a production write. Both are owner stops (§00).
- **Step 2, one login and logout:**
  - **What runs.** One IMAP and SMTP login, then logout, on the team-owned iCloud test account. No message is read and nothing is sent.
  - **What it needs from you:** the account itself, with two-factor authentication and one QA app-specific password, plus approval to store it by name only (Vault or GitHub secrets). Secrets are removed afterwards.
  - **If Apple refuses by IP:** a static outgoing IP from Fly would need pricing and your approval.
- **Where it runs:** a new, dedicated Fly app `paige-mail-transport`. **Reject putting it on `paige-browser`.**
  - **Why not `paige-browser`:** it renders arbitrary public web pages, Fly exposes app secrets to every machine in the app, its shared secret already has three callers, and it has only 3 concurrency slots.
  - **If the edge 993 check passes:** run IMAP sync on Supabase and send-only SMTP 587 on Fly. That costs about $0–1/month, versus about $2.19–3.69/month if Fly also runs the sync.
  - **Why not Vercel or Cloudflare:** neither has functions or an account in use today.
  - **Caveats:** the outgoing host allowlist lives in code only. Supabase's outgoing IPs change, and whether Apple throttles that is UNVERIFIED.
  - **Owner stops:** the new Fly app, edge functions and Vault entries.


---

# Addendum 2026-10-13 — PAIGE Email Cleanup & Unsubscribe Management (owner-approved extension)

**Owner approval (2026-10-13):** cleanup and unsubscribe management is part of the intended PAIGE Email Assistant.
Experience 03 owns implementation. Routine design and implementation decisions inside this scope need no repeated owner
approval. Independent review, exact-head CI, protected authenticated QA and authorization for real external effects
still apply, as does §00: the owner sees the design before UI release. It extends the Gmail/iCloud foundation and is
built only after the mailbox access and approval contracts below exist. It does not interrupt S3, G1 or the foundation PRs.

## What already exists (grounded 2026-10-13)

- `comms-mailbox-command` is the one door for mailbox organization. Kinds: label/unlabel, archive/unarchive,
  trash/untrash, `unsubscribe_propose`, `unsubscribe_send`. Undo is only offered where the action has an exact inverse;
  unsubscribe kinds are recorded as irreversible (`_shared/inbox-intelligence/organize.ts:15-65`).
- `unsubscribe_propose` works. It records the one-click target taken **only** from the message's own recorded
  `List-Unsubscribe` header, never from the request (`comms-mailbox-command/index.ts:117-121`), and accepts only an
  https URL with no userinfo (`organize.ts:76-84`).
- `unsubscribe_send` is **refused with 410** by an earlier owner addendum (6088460092) "until a reviewed safe-transport
  boundary exists" (`comms-mailbox-command/index.ts:56-63`; ANT-42 repeats it). This approval lifts that hold **only**
  through the safe mechanism below.
- The classifier already has a `newsletter` class (`classify.ts:14`), and sync already records `List-Unsubscribe`
  (`gmail-mailbox-sync` metadata headers).

## How it fits the owner's privacy decisions

Owner decision 1 limits CRM Conversations import to known business contacts and reserves "an explicitly authorized
broader inbox experience" for later. Discovering newsletters needs that broader read, so cleanup **is** that experience:

- **Its own opt-in**, per mailbox, by the mailbox owner only: "Let PAIGE find subscriptions in this mailbox". It is off
  by default and revocable. Revoking it deletes the inventory and stops discovery.
- **A private subscription inventory, not CRM records.** One row per sender or list (`List-Id`, From domain), holding
  counts, first and last seen, the unsubscribe methods the headers offer, and the outcome history. It holds no message
  bodies and creates no contacts, leads or Conversations threads. Only the mailbox owner can see it: not other admins,
  and not the platform owner (owner decision 3).
- **Retention:** aggregates are kept while the opt-in is on. Per-message ids used to target archive or label actions
  are kept for a bounded window (30 days proposed).

## The operations — each separate, each through the existing door

| Operation | Mechanism | Scope / transport | Outcome states |
|---|---|---|---|
| Discover | Header-only read (`List-Id`, `List-Unsubscribe`, `List-Unsubscribe-Post`, `Precedence`, From) of recent mail, aggregated per sender | Gmail `gmail.readonly` (project B); iCloud IMAP `BODY.PEEK[HEADER.FIELDS (...)]` | n/a |
| Unsubscribe, one-click | RFC 8058 `POST` with `List-Unsubscribe=One-Click`, **only** when both headers are present, to the header's https target, through the shared SSRF-safe egress (public-IP resolution, no redirects to private ranges, timeout, size cap) | Supabase edge HTTPS; no mailbox scope needed | requested → acknowledged (2xx) / failed / unknown (timeout) |
| Unsubscribe, mailto | A plain message to the header's `mailto:` address, sent **through the governed email door** from the same mailbox, with the approval naming the exact address | `gmail.send` / iCloud SMTP | requested → provider accepted / failed / unknown |
| Unsubscribe, web page only | Never fetched automatically (a GET can confirm or track). Shown to the owner as "open this page to finish" | none | manual |
| Verify | Unsubscribed once no new mail arrives from that list after a grace window (Gmail asks senders to honour within 2 days; PAIGE waits 10) | the discovery read | verified / still arriving |
| Archive / label | Existing door kinds | Gmail `gmail.modify` (incremental consent, only if the owner turns organizing on); iCloud IMAP `MOVE` | done / failed, with undo |
| Filter / block a sender | Gmail: a server-side filter (to trash or skip inbox). iCloud: no server rules API is documented for IMAP, so PAIGE applies the rule during its own sync and says so ("while this mailbox is connected") | Gmail `gmail.settings.basic` (classification to confirm — restricted); iCloud IMAP `MOVE` | done / failed, with undo |

**Bulk:** one approval names the exact list of senders and mechanisms, with a fingerprint and the per-sender idempotency
key. Each item gets its own Rail receipt and outcome. Execution is rate-limited, partial failure is reported per item,
and nothing is retried before it has been reconciled.

**Authority:** these are personal-mailbox actions, so only the mailbox owner may request or approve them. Everything goes
through Spine, Trust and Rail via `comms-mailbox-command` — the one home (§18); no second mailbox door. PAIGE Chat gets
the same door through the existing `gmail_organize` tool family, advertised only when the scope and opt-in exist.

**Surfaces:** a subscription inventory view inside Clients → Conversations, owner-only, plus the same actions in PAIGE
Chat. Design frames go to the owner before UI release.

## Dependency order (after the foundation PRs)

| # | PR | Depends on |
|---|---|---|
| X1 | Cleanup opt-in and private subscription inventory: schema, owner-only RLS, header aggregation in the same sync engine (one engine, two outputs) | G2 (one Gmail connection), M1 (message identity), G3 (sync writer), owner's project-B / scope decision |
| X2 | Safe unsubscribe execution: lift the 410 for one-click POST through SSRF-safe egress and for mailto through the governed door; outcome states; verification sweep | X1, D1 (approval/Message-ID door), S3 merged |
| X3 | Bulk approval and per-item receipts | X2 |
| X4 | Separate organize / filter / block operations with incremental consent (Gmail) and PAIGE-side rules (iCloud) | X1, owner project-B scopes; I2 for iCloud |
| X5 | Subscription inventory view in Conversations and Chat affordances (design → owner → build) | X2, C1 |
| — | iCloud parity for X1–X4 | I1, I2 |

**Experience 05 coordination:** recurring cleanup (a periodic subscription digest, and opt-in automatic unsubscribe for
chosen categories) is governed automation under §67, granted to a process, not a tool. Experience 03 delivers the
manual, approval-gated operations and the outcome records first. Experience 05 owns the recurring and automated layer
on top of the same door.

**Real external effects:** a one-click POST or a mailto unsubscribe is a real effect on a third party. QA runs it only
against team-owned test mailboxes and a team-controlled test list endpoint. No customer mailbox, and no real sender,
until authorized.

---

# Addendum 2026-10-14 — SendGrid-only cutover plan (owner directive 2026-10-14)

**Owner directive (2026-10-14).** All PAIGE email moves to SendGrid, and Resend is retired. This supersedes the
2026-10-13 policy in this file's header ("Platform Operator system mail = Resend"); that line is kept and marked
(§58). The owner named two SendGrid credentials: PAIGE-SENDGRID-MAIL-EXECUTOR (sending) and
PAIGE-SENDGRID-PLATFORM-ADMIN (configuration). Customer Gmail and iCloud Mail stay optional customer mailboxes, as
planned above.

**Status: GROUNDED PLAN. Only P0 (this docs record) is written; it is on branch `claude/stoic-archimedes-pv4r8u-sendgrid-p0-docs` (PR #2152), not yet merged.** Grounded read-only at main
`6428c2ba61959ef302cf69e0dbd64a878ddbb35f` against production project `xygzykjyynhzqytbqnzu`: no edits, sends,
deploys, provider changes or secret values read. Four read-only investigations (code, production, credentials, and
the #2126 governed door) were synthesised and then checked by an independent reviewer; their reports are not
committed. Evidence labels below: "code read", "production read" (SELECT only), "credential read" (code plus the
deployed function list) and "#2126 review". Section numbers refer to this addendum. Nothing here is authenticated
runtime proof.

Spot-checked directly at that commit:
- `send-message/index.ts:1345-1356` contains the comment "Platform default stays Resend" and
  `throw new Error("RESEND_API_KEY missing")`.
- `handle-sendgrid-webhook/index.ts:27-31` acknowledges `unsubscribe` events but does not record them, and names
  suppression as a deferred decision.
- `send-transactional-email/index.ts:265` checks `suppressed_emails`.
- Every document still stating the 2026-10-13 policy was found by search (Section 9).

**Headline:**
- **Production email runs on Resend only.** 8 `channel_connectors`, all `provider='resend'` (6 active, 2 disabled;
  re-read 2026-10-14); 0 SendGrid connectors, 0 SendGrid domains and 0 receipts from either provider.
- **SendGrid exists as code but is inert.** It is wired only for tenant mail, through the governed door from #2126.
- **No SendGrid route exists for operator or platform mail.**
- **Auth email appears to run on a third provider, Lovable** (inference; see Section 1).
- **Volume is tiny,** so a cutover is low-risk. In 90 days there were 22 outbound email `messages` rows (latest
  2026-10-06), and `email_send_log` holds 36 rows ever (latest 2026-09-12).

## 1. Current provider architecture (verified)

| Email category | Provider today | Path | Live? | Evidence |
|---|---|---|---|---|
| Tenant one-to-one email (governed door) | Resend; SendGrid only if a `provider='sendgrid'` connector exists, and none does | `comms-email-command` → `prepare_comms_email_send` → `send-message` | Live: v15 / v95. In 90 days, 19 outbound sent through resend connectors and 3 with no connector | `send-message/index.ts:406-449` (Resend arm), `:1351-1354` ("Platform default stays Resend"), `:348-404` (SendGrid arm); production read query |
| Tenant scheduled sends and campaigns | Resend (via `send-message`) | `comms-scheduled-drain` and `email-campaign-worker` crons (every minute) → `send-message`; `_email_resolve_sender` returns `'managed','provider','resend'` | Live. Only 1 campaign row exists, a `draft` | Cron jobids 8 and 31; code read |
| Automatic "PAIGE Email" sender for every business | Resend | Triggers `trg_tenants_paige_managed_email_connector` and `trg_provision_email_connector` → `provision_paige_managed_email_connector` / `provision_email_connector_on_verify` insert `provider='resend'` | Live: 6 active + 2 disabled rows, all from `mail.paigeagent.ai` | code read; production read |
| Booking confirm / reschedule / cancel / reminders | Resend, called directly | `public-booking:656-731`, `booking-manage:101-160`, `process-booking-notifications:17-92` (cron every 5 min) | Live | code read; cron jobid 1 |
| Plan reminders | Resend, called directly | `plan-reminder-cron/index.ts:20-52` (cron every minute) | Live | cron jobid 3 |
| Client portal and team invites | Resend, called directly | `send-portal-invite/index.ts:17-222` | Live, v1649 | code read |
| Paige skill "draft and email document" | Resend, called directly after approval | `skill-runner/index.ts:486-496` | Live, v138 | code read |
| Paige MCP email tools | Resend, called directly (bypasses the door) | `paige-mcp/index.ts` `send_transactional_email` (:2505-2597), `send_composed_email`, `bulk_send_template_email` (up to 100), `send_btf_template_email` | Deployed v700 | code read |
| Invoice delivery | Resend / Gmail / SMTP; SendGrid is not recognised | `prepare_sales_invoice_*` functions with `provider IN ('resend','gmail','smtp')`; `readiness-reader.ts:15` | Live | code read; #2126 review |
| Platform transactional hub (30+ templates; operator and business sender in one function) | Resend | `send-transactional-email/index.ts:274-336, 688-775` | Deployed v1653. Last `email_send_log` row 2026-09-12 | code read; production read |
| Platform signup welcome, billing receipt, support, operator team invite | Resend (direct API or SDK) | `tenant-signup:33-113`, `send-payment-confirmation-email` (`npm:resend`), `send-support-request` (`esm.sh/resend`), `send-platform-invite:73-80` | Live or deployed | code read |
| Platform Operator corporate email | **No mailbox and no connector exist.** The operator workspace `d1f0a7e2-…` has 0 connectors, 0 `messages` and 0 `email_send_log` rows | n/a | n/a | production read |
| Supabase Auth email (signup, reset) | Lovable (`sendLovableEmail`, `LOVABLE_API_KEY`), through `auth-email-hook` → `enqueue_email`. **The `auth_emails` pgmq queue does not exist.** | `auth-email-hook/index.ts:3,255`; `process-email-queue/index.ts:1,139` (no cron) | Inferred, see note | production read; #2126 review |
| Inbound email into the unified inbox | Resend (Svix-signed relay) | `handle-resend-webhook` relays `email.received` → `handle-inbound-email` | Deployed. 5 inbound in 90 days: 3 through Resend connectors (latest 2026-09-11) and 2 with no connector (latest 2026-07-29) | code read |
| Delivery receipts | Resend receiver + reconcile cron (jobid 19); SendGrid receiver built | `handle-resend-webhook`, `reconcile_resend_receipts()`; `handle-sendgrid-webhook` → `ingest_sendgrid_receipt` | Both receipt tables have **0 rows** | production read |
| Sending-domain setup | Resend Domains API | `manage-tenant-domain/index.ts:22-209` | Deployed v37. The only domain row is `status=failed` | code read; production read |
| Customer Gmail / iCloud mailboxes | Gmail OAuth; SMTP (iCloud uses SMTP) | `gmail-oauth-*`, `smtp-connect`, `gmail-mailbox-sync` (cron jobid 37) | Code is deployed. **0 Gmail or SMTP connectors and 0 `mailbox_sync_state` rows** | production read |

The auth-email row is an inference. It holds only if `auth-email-hook` is the active Send Email hook, which still needs the dashboard check (Section 3).

## 2. Resend dependency inventory

The classes mean:
- **REUSE:** provider-neutral, keep as is.
- **REPAIR:** keep, but route through the governed SendGrid path.
- **REPLACE:** needs a SendGrid equivalent that does not exist yet.
- **REMOVE:** delete.

Tiers are op (operator/platform) and ten (tenant). Paths are under `supabase/functions/` unless they start with `src/`, `docs/` or `scripts/`.

| # | Dependency | Path / object | Live? | Tier | Class | Rationale |
|---|---|---|---|---|---|---|
| 1 | Generic Resend provider, and `buildProvider`'s default to Resend | `_shared/email/providers.ts:59-94, 114-144` | Bundled; `.send()` is never called in production | both | REMOVE | Dead adapter. Its only caller is `branding.ts`, which uses only the branding output (#2126 review). |
| 2 | Branding / From-address resolver | `_shared/email/branding.ts:128,166` | Live | both | REUSE | Provider-neutral. Drop the `provider` field. |
| 3 | `send-message`: Resend arm, key check, fallback sender, `pipe_used='resend'` | `send-message/index.ts:406-449, 1352-1354, 1378, 686/1206/1248/1548` | Live v95 | both | REPAIR | Becomes the one door. Its default must be the governed SendGrid transport, with no Resend fallback. |
| 4 | Channel-adapter contract comments | `_shared/channel-adapters.ts:153-188` | Live | both | REUSE | Only the comments name Resend. |
| 5 | Door readiness list `BASE_EMAIL_PROVIDERS=["resend","gmail","smtp"]` | `_shared/comms-email/readiness.ts:39,42,66,237` | Live | ten | REPAIR | Drop `resend` and always include `sendgrid`. |
| 6 | Reconcile only handles Resend | `_shared/comms-email/adapter.ts:168-179`; DB function `_comms_email_reconcilable` | Live | ten | REPAIR | Needs a SendGrid reconcile path. Whether SendGrid honours `X-Idempotency-Key` is UNVERIFIED (row 3 in Section 3). |
| 7 | Invoice delivery readiness and binding | `sales-invoice-delivery/readiness*.ts`; 4 `prepare/read/list_sales_invoice_*` DB functions | Live | ten | REPAIR | Requires a migration. |
| 8 | Door preparation allows `resend` | DB function `prepare_comms_email_send` | Live | ten | REPAIR | Remove `resend` after cutover. |
| 9 | Managed "PAIGE Email" provisioning (6 functions, 2 triggers, plus UI caller `src/solo/data/useSoloBusinessContext.ts:398`) | DB | Live, 8 rows | ten | REPLACE | Must create governed SendGrid connectors. Blocked by the shared-domain decision (Section 8). |
| 10 | Campaign sender resolution and metering hardcode `resend` | DB `_email_resolve_sender`, `email_campaign_dispatch_record` | Live | ten | REPAIR | Meter by the resolved provider. |
| 11 | Resend receipt pipeline | `handle-resend-webhook/*`; DB `ingest/process/reconcile_resend_receipts`; cron jobid 19; table `resend_receipt_processing` (0 rows); `admin_app_settings` `resend_webhook_secret(s)`; `_shared/webhookSig.ts:57`; `config.toml:213-217`; `paige-spine-contract.yml:90-106,533-534`; `scripts/proof/resend-receipt-*` | Deployed v1042; 0 calls in 24h | both | REMOVE | Superseded by `handle-sendgrid-webhook` and `ingest_sendgrid_receipt`. |
| 12 | Inbound email | `handle-inbound-email/index.ts` (Svix, `RESEND_WEBHOOK_SECRET`) | Deployed v103 | ten | REPLACE | No SendGrid Inbound Parse handler exists. A search for `inbound.parse`/`inbound_parse` found 0 files (code read). |
| 13 | Domain setup through the Resend Domains API; column `tenant_email_domains.resend_domain_id`; UI `EmailDomainsPanel.tsx:38`, `useSoloComms.ts:66,249,293,439`, `EmailIntegrationConfig.tsx:7`; MCP `list_email_domains` | `manage-tenant-domain/index.ts:22-209` | Deployed v37 | ten (and op via MCP) | REPLACE | Needs SendGrid domain authentication under the admin credential. No code calls `/v3/whitelabel` today (credential read). |
| 14 | Resend admin probe (returns the webhook secret) | `resend-admin-probe/index.ts:29-167` | Deployed v21; `verify_jwt false` | op | REMOVE | `comms-sendgrid-scopes` and `comms-sendgrid-webhook-admin` already cover this. |
| 15 | Hand-set flag `paige_config.resend_domain_verified=false`, toggled in `src/pages/admin/PlatformSettings.tsx:254-329` | DB + UI | Live | op | REMOVE | Replace with a derived SendGrid readiness read. |
| 16 | Transactional hub | `send-transactional-email/index.ts:274-336, 688-775` | v1653 | both | REPAIR | Split into a platform-scope route and a tenant-scope route, both on SendGrid. |
| 17 | `RESEND_API_KEY` presence checks gating agreements | `agreement-send/index.ts:96`; `_shared/agreements/notify.ts:28` | Live | ten | REPAIR | Readiness comes from the door, not from an env var being present. |
| 18 | Signup welcome | `tenant-signup/index.ts:33-113` | v1647 | op | REPAIR | Move to the platform route. |
| 19 | Billing receipt | `send-payment-confirmation-email` (`npm:resend`), called from `stripe-webhook:1347` | v68 | op | REPAIR | Fold into the transactional hub. |
| 20 | Support email | `send-support-request` (`esm.sh/resend`) | v59 | op | REPAIR | Move to the platform route. |
| 21 | Operator team invite | `send-platform-invite/index.ts:14,73-80` | v70 | op | REPAIR | Move to the platform route. |
| 22 | Duplicate welcome sender | `send-welcome-email` | v68, no code caller | op | REMOVE | Duplicates the hub's templates. Repoint the skill text in migration `20260831000000`. |
| 23 | One-off welcome backfill | `backfill-welcome` | Deployed, no caller | op | REMOVE | One-time job. |
| 24 | Funding report sent from `onboarding@resend.dev` | `send-funding-report/index.ts:3,25,116` | v56 | ten (opt-in) | REMOVE, or REPAIR if the funding preset needs it | `resend.dev` is Resend's test sender. Owner call, see Section 8 item 9. |
| 25 | Booking emails | `public-booking`, `booking-manage`, `process-booking-notifications`, `_shared/bookingNotify.ts:7` | Live | ten | REPAIR | Route through the door with tenant scope. |
| 26 | Portal invite | `send-portal-invite` | Live | ten | REPAIR | Same as #25. |
| 27 | Plan reminders | `plan-reminder-cron` | Live | ten | REPAIR | Same as #25. |
| 28 | Skill-runner's own transport | `skill-runner/index.ts:486-496` | Live | ten | REPAIR | Call the door instead. |
| 29 | MCP send tools | `paige-mcp/index.ts:3-37, ~1590-1680, 2505-2597, 3511-3581, 4483-4540` | v700 | both | REPAIR, or REMOVE as ungoverned bypasses | `capability-policy.ts:800-830` marks them `external_send`, `paigeHome:false`. |
| 30 | Vocabulary and enums naming `resend` | `skill-forge/index.ts:77`; `paige-spine/domains/integrations_surface.ts:39`; `paige-bridge/index.ts:82`; DB constraint `paige_message_audit.pipe_used` | Live | both | REPAIR | Add `sendgrid` or make provider-neutral. The constraint change needs a migration. |
| 31 | Business-facing "connect Resend" MCP card | `src/solo/settings-integrations-gateway.tsx:103` | In the bundle | ten | REMOVE | Resend is not in the final architecture. |
| 32 | Operator copy "Resend … live" | `src/operator/surfaces/IntegrationsSurface.tsx:70` | In the bundle | op | REPAIR | Correct the copy. |
| 33 | Tests asserting `api.resend.com` | `booking-provider-boundary.test.mjs:35`, `comms-email-provider-boundary.test.mjs`, `comms-email/*.test.ts`, `lead-reply.test.ts`, `src/solo/resend-receipt-handler.test.ts` | CI | n/a | REPAIR | Re-anchor them to SendGrid. They will fail on cutover by design. |
| 34 | Provider-floor CI guard | `scripts/ci/comms-provider-boundary-wiring.mjs:4` | CI | n/a | REUSE | Provider-neutral guard; update its sender list. |
| 35 | Policy documents | Section 9 | n/a | n/a | REPAIR | Mark SUPERSEDED in place (§58). |
| 36 | Lovable auth-email pipeline (not Resend, but a third provider) | `auth-email-hook`, `process-email-queue`, pgmq `transactional_emails` (3 role-invitation messages stuck since 2026-07-10) | Unscheduled | both | REPLACE (owner decision) | Breaks the "one architecture" rule. Detail in Section 3. |

**Env names (names only):**
- `RESEND_API_KEY` is read in 19 function directories plus `_shared` (code read).
- `RESEND_WEBHOOK_SECRET` is named by 3 functions (`handle-inbound-email`, `handle-resend-webhook`, and `resend-admin-probe` in an install hint; see §10 item 6).
- `vault.secrets` has no names matching resend or sendgrid (code and production reads).

## 3. SendGrid credentials: what each one does and can do

**Code-level responsibilities (VERIFIED from code; credential read; `edge-live..origin/main` was empty for `supabase/functions`, so deployed code matched main):**

| Code env name | Role in code | Readers | SendGrid endpoint called |
|---|---|---|---|
| `SENDGRID_MAIL_SEND_API_KEY` | Sending ("Mail Send executor") | `send-message:1355`; `comms-sendgrid-scopes:32`; presence checks only in `comms-email-command:149`, `readiness.ts:238`, `lead-reply.ts:301` | `POST /v3/mail/send` (`send-message:361`); `GET /v3/scopes` (`comms-sendgrid-scopes:37`) |
| `SENDGRID_WEBHOOK_ADMIN_API_KEY` | Scoped webhook administration | `comms-sendgrid-webhook-admin/index.ts:37` only. CI allows it in that one file only (`forbid-sendgrid-admin-key-refs.mjs:15-17`) | Only `GET/POST/PATCH /v3/user/webhooks/event/settings` and `GET …/settings/signed`, enforced by `assertEndpoint` (`sendgrid-webhook-admin.ts:20-26`) |
| `SENDGRID_PLATFORM_ADMIN_API_KEY` | Full-access admin (per the docs) | **None.** CI forbids it everywhere (`forbid-sendgrid-admin-key-refs.mjs:10`) | None |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` | Signature-verification public key, not an API credential | `handle-sendgrid-webhook/index.ts:110` | None (inbound ES256 verification) |

**Mapping to the owner's two credentials:**
- **PAIGE-SENDGRID-MAIL-EXECUTOR → `SENDGRID_MAIL_SEND_API_KEY`.** This is a candidate only. Code comments call that slot the "Mail Send executor".
- **PAIGE-SENDGRID-PLATFORM-ADMIN → ambiguous.** It may be `SENDGRID_PLATFORM_ADMIN_API_KEY`, which nothing reads and CI forbids. Or it may correspond to the narrower `SENDGRID_WEBHOOK_ADMIN_API_KEY`.
- The code has **three** credential slots where the owner's model has **two**.
- `PAIGE[-_]SENDGRID` has **0 hits** in the repo.

**Scope check.** `comms-sendgrid-scopes`:
- runs only for super_admin, through `is_platform_owner` → `is_super_admin`;
- reads only the executor key;
- returns `scopes`, `can_send_mail` and `non_sending_scopes`;
- **does not persist the result and blocks nothing;**
- has no caller.

`docs/brain/config-registry.md:544` says it "records the key's scopes". That is wrong (credential read).

**CI admin-key guard.** It matches substrings in `.ts` files only. Edge secrets are project-wide, so the guard is a source-code rule, not runtime isolation (`paige-mail-sendgrid-integration.md:22-23`).

| Fact | Status | Operator step to verify |
|---|---|---|
| Executor key is installed and its scopes | **UNVERIFIED.** No scope check has been recorded; 0 SendGrid-function requests in the 24h ending 2026-10-13T11:40Z; earlier logs are past retention (credential read) | As super_admin, `GET https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/comms-sendgrid-scopes`, then save the JSON to an evidence file. Or open the SendGrid console → Settings → API Keys → the key's access details. |
| Webhook-admin key is installed | **UNVERIFIED** | As super_admin, `GET …/functions/v1/comms-sendgrid-webhook-admin?action=inspect`. A 503 `…_NOT_CONFIGURED` means it is absent. This proves the key can read settings, not its full scope list. |
| Platform-admin key: existence and scopes | **UNVERIFIED.** No code can check it, and rotation is owed (`paige-mail-sendgrid-integration.md:27-29,96`) | SendGrid console only. |
| Which owner-named key sits under which env name | **UNVERIFIED** | Compare `supabase secrets list --project-ref xygzykjyynhzqytbqnzu` (names and digests only) with the key names in the SendGrid console. |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` is set | **UNVERIFIED** | Send a SendGrid console test event and confirm a row appears in `sendgrid_receipt_processing`. |
| SendGrid honours `X-Idempotency-Key` on `/v3/mail/send` | **UNVERIFIED** | Check SendGrid documentation or support. Until then, treat retries as possibly duplicating a send. |
| Platform domain authentication (DKIM/SPF/link branding) | **UNVERIFIED.** Nothing is recorded; `sg-mail.paigeagent.ai` appears only as a test fixture | SendGrid console → Settings → Sender Authentication, or a DNS lookup of the `s1._domainkey` / `s2._domainkey` / `em####` CNAMEs. |
| `RESEND_API_KEY` is set in production | **UNVERIFIED** | `supabase secrets list` (names only). |
| Supabase Auth custom SMTP and Send Email hook | **UNVERIFIED** | Dashboard → Authentication → SMTP Settings and → Hooks. Or Management API `GET /v1/projects/xygzykjyynhzqytbqnzu/config/auth`, reading `smtp_host`, `hook_send_email_enabled` and `hook_send_email_uri`. |

**Production bindings.** Function version and `verify_jwt` are VERIFIED from the deployed function list (credential read). The "Credential it reads" column is read from the code, not observed in production; whether each secret is installed stays UNVERIFIED:

| Function | Version | verify_jwt | Credential it reads |
|---|---|---|---|
| `send-message` | v95 | false | executor (connector-selected arm) |
| `comms-email-command` | v15 | true | executor (presence check) |
| `growth-process-submission` | v78 | false | executor (presence check) |
| `comms-sendgrid-scopes` | v115 | true | executor |
| `comms-sendgrid-webhook-admin` | v91 | true | webhook-admin |
| `handle-sendgrid-webhook` | v112 | false | public key |

Nothing binds `SENDGRID_PLATFORM_ADMIN_API_KEY`.

## 4. Target architecture: SendGrid only

1. **One SendGrid transport.**
   - Extract `send-message:348-403` into one shared module (proposed name `_shared/email/sendgrid-mail-send.ts`).
   - It accepts only a prepared binding that has been re-read from the database. It never accepts config or a key from the caller.
   - It is the **only** module that sends with the executor credential.
   - A new CI guard forbids `api.sendgrid.com/v3/mail/send` anywhere else, and forbids reading the executor env name's value anywhere else, mirroring the admin-key guard. Named exceptions, each listed in the guard's allowlist: `comms-sendgrid-scopes` (P1's read-only scope check, `GET /v3/scopes` only), and the existing presence-only checks in `comms-email-command`, `_shared/comms-email/readiness.ts` and `growth-process-submission/lead-reply.ts`, which test whether the key is set and never send. P2 may route those presence checks through the transport module instead and drop them from the allowlist.
   - There is **no Resend arm and no default fallback.** An unknown or missing provider fails closed with a named error.
2. **One governed door, with two sender scopes on the binding (`sender_scope: tenant | platform`).**
   - **Tenant scope** keeps the existing chain: `comms-email-command` → `prepare_comms_email_send` (tenant, seat, client recipient, verified-domain sender) → `send-message` → `finalize_comms_email_send`. The managed "PAIGE Email" becomes a SendGrid connector.
   - **Platform scope** gets a service-only entry: a sibling `prepare_platform_email_send` plus a platform route, either a refactored `send-transactional-email` or a new `platform-email-command`.
     - It takes a template id, recipient, reference id and idempotency key.
     - It runs the existing `send-authority.ts` and suppression checks.
     - It writes the same canonical message and binding shape, carrying the same Spine, Trust and Rail evidence.
     - Platform senders live in a registry only the service role can write, managed under super_admin authority (§53), and pinned to operator-owned domains that SendGrid has verified.
     - A platform sender can never be chosen from tenant data. A tenant can never send from a platform domain unless the owner explicitly rules otherwise (Section 8).
   - **Operator corporate email** uses the platform scope, with the §200 operator workspace `d1f0a7e2-…` as the canonical-record owner.
3. **Executor credential separate from the admin credential.**
   - The executor (PAIGE-SENDGRID-MAIL-EXECUTOR) does sending only. Its scopes are checked, the result is persisted as an evidence row, and sending is blocked when `mail.send` is missing or admin scopes are present.
   - The admin credential (PAIGE-SENDGRID-PLATFORM-ADMIN) does configuration only: domain authentication, Event Webhook setup, Inbound Parse setup and suppression-group setup.
   - The admin credential is read in **exactly one** operator-only, super_admin-gated function whose endpoint allowlist follows the `assertEndpoint` pattern. It is never a sending key.
   - This needs an owner ruling to amend the CI guard (Section 8, item 1).
4. **Receipts and webhooks.**
   - There is one signed SendGrid Event Webhook (ES256, `SENDGRID_WEBHOOK_PUBLIC_KEY`).
   - It correlates on the `custom_args` `paige_tenant_id`, `paige_operation_id` and `paige_message_id`, and adds `paige_scope`.
   - It feeds `ingest_sendgrid_receipt`.
   - A SendGrid reconcile cron replaces jobid 19.
   - `_comms_email_reconcilable` becomes SendGrid-aware.
5. **Suppression and unsubscribe.**
   - `unsubscribe`, `group_unsubscribe`, `spamreport` and hard `bounce` events must write the canonical suppression stores: `paige_suppressions` for tenant and campaign mail, `suppressed_emails` for platform mail.
   - Today these events are acknowledged but not recorded (`handle-sendgrid-webhook/index.ts:27-31`). Both send paths already read suppression before sending (`send-message:1250,1434`; `send-transactional-email:265`).
   - Unsubscribe links keep using `email_unsubscribe_tokens`, which has 12 rows.
   - Using SendGrid suppression groups (ASM) is optional and is configured through the admin credential.
6. **Inbound.** Either SendGrid Inbound Parse feeding `handle-inbound-email`, rewritten from Svix to SendGrid verification, or an owner decision that inbound comes only through Gmail/iCloud mailbox sync.
7. **Gmail and iCloud** stay optional customer mailboxes (Gmail OAuth; iCloud over SMTP/IMAP). They are tenant-scoped connectors through the same door with `mailbox_class` ownership (G1), and they are never the platform path.
8. **Auth email** goes through SendGrid via Supabase Auth's Send Email hook calling the platform route, so it gets the same canonical record, suppression check and receipts as every other send. A Supabase custom SMTP relay is **not** the target: it would put a sending key in dashboard settings and bypass the governed door. If the owner ever wants it as a stopgap, it is an explicit exception using its own mail-send-only key, never the executor key. The Lovable pipeline (`auth-email-hook`'s Lovable path, `process-email-queue`, `handle-email-suppression`, `preview-transactional-email`) is then retired (Section 8, item 4).
9. **No Resend anywhere:** no code, no env reads, no connectors, no cron, no webhook secrets, no UI card.

## 5. Gaps that block a safe migration (most serious first)

1. **No platform or operator SendGrid route.** The door requires a tenant, a seat and a client recipient (`prepare_comms_email_send:205,232-235`), so all platform mail would break if Resend were removed today (#2126 review).
2. **Managed tenant sender cannot move to SendGrid as it stands.**
   - The 6 active businesses all send from the shared `mail.paigeagent.ai`.
   - The SendGrid door requires a per-business verified domain that exactly matches the From address, and allows only one claim per domain (`20271031000250:144-146`).
   - Removing Resend without a decision gives each of them `no_email_sender` (#2126 review).
3. **No code verifies a domain with SendGrid.** Nothing calls `/v3/whitelabel`. SendGrid domain facts can be written by the service role only, and no code writes them. A per-business DNS ownership proof is still owed (`20271031000250:35-36`).
4. **Credential model is unresolved.** There are three code slots against two owner credentials. No name mapping exists, and the scope check neither persists its result nor gates sending.
5. **Suppression is not handled for SendGrid events.** Unsubscribe and complaint events are dropped. Turning on SendGrid sending without this sends to people who opted out (legal risk).
6. **Auth email runs on a third provider and may be broken today.** There is no `auth_emails` queue, no cron for `process-email-queue`, and 3 role-invitations have been stuck since 2026-07-10. The auth config is UNVERIFIED.
7. **About 20 direct-to-Resend send sites bypass the door** (Section 2 rows 16-29). Each one is a §37 producer inventory item.
8. **No SendGrid inbound path.**
9. **Receipt and reconcile parity.** There is no SendGrid reconcile cron, and idempotency is UNVERIFIED.
10. **Live sending has never been proven.** There are 0 SendGrid sends or receipts in production, so no authenticated runtime evidence exists for any SendGrid path.
11. **Cron noise (side finding).** About 6,000 401s/day on each of 3 email crons, from `pg_net/0.20.4` callers at other IPs. The likely cause is branch or preview projects calling the production URL, but this is UNVERIFIED. Verify by running `select jobname, command from cron.job` on each branch or project. Resolve it before soak measurements so logs are readable.

## 6. Implementation PRs in dependency order

Every PR follows the same process:
- Flow-by-Flow pre-edit packet.
- Failing-first tests, plus reinstating the defect to show each test bites (§71.4).
- A measured baseline from a `git worktree` of the base commit.
- An independent §39 review of the pushed diff (including the §58 and §66 items).
- CI on the exact head SHA.
- §32 persisted-apply proof for migrations (`schema_migrations` row present and object exists).
- §37 producer and consumer inventory for every contract change.
- §51 per-tier check.
- Updates in the same commit to the master doc §4/§5/§10, `docs/brain/config-registry.md`, `decision-log.md`, the tier matrix and the integration registry.

"Protected end-to-end" means an authenticated live drive on a scoped test tenant through `scripts/live-drive/live-drive.mjs`, or reporting it as **UNVERIFIED** with the reason.

| # | PR | Scope | Files / migrations | Tests / proofs | Owner gate |
|---|---|---|---|---|---|
| P0 | Mark the old policy superseded (docs only) | Mark every record in Section 9 "SUPERSEDED BY OWNER DIRECTIVE 2026-10-14"; log in master §10; correct `config-registry.md:544` ("records" → "returns") and the "allowlist intentionally empty" lines; set registry `sendgrid.tier_eligibility.platform` to eligible, still `PROOF_OWED` | Docs and registry JSON only | Grep proves no unmarked policy line remains | None (docs) |
| P1 | Align the credential model | Code env names reflect the owner's two credentials; persist the executor scope check as an evidence row, and gate sending on it; amend the CI guard to the two-key model (admin key allowed in one operator-only admin function) | `comms-sendgrid-scopes`, `scripts/ci/forbid-sendgrid-admin-key-refs.mjs`, a new evidence table migration, `config-registry.md` | Guard fixtures for both outcomes; scope-gate unit tests; operator runs the scope check and the result is saved | **Owner:** name mapping, 2 vs 3 keys, CI-guard amendment, installing secrets (Section 8, items 1-2) |
| P2 | One SendGrid transport and sender scopes (backend) | Shared transport module; `sender_scope` on the binding; platform sender registry (writes by service role only, super_admin managed); `prepare_platform_email_send`; CI guard limiting `/v3/mail/send` to one module | `_shared/email/sendgrid-mail-send.ts`, `send-message`, migrations (new table, new function, `pipe_used` constraint plus `sendgrid`) | SET ROLE proofs: tenant cannot write platform senders; DEFINER bodies enforce scope (§59); transport rejects unbound calls | Backend change named here: new table, function and constraint |
| P3 | SendGrid domain authentication | Operator-only admin function (admin credential): create, validate and read domain authentication; writes `sendgrid_domain_id/status/verified_at` through the service role; DNS ownership proof; rewrite `manage-tenant-domain` (Resend Domains → SendGrid); repoint UI hooks (`useSoloComms`, `EmailDomainsPanel`, `EmailIntegrationConfig`) and MCP `list_email_domains` | Edge functions, UI, endpoint allowlist | Endpoint-allowlist tests; authenticated drive of the domain flow on a test tenant; platform-domain authentication evidence | **Owner:** platform and tenant sending domains (Section 8, item 3); DNS changes |
| P4 | Receipts, webhooks, suppression | Install the Event Webhook through the admin function; map unsubscribe, spamreport and bounce into `paige_suppressions` / `suppressed_emails`; add a SendGrid reconcile cron; make `_comms_email_reconcilable` SendGrid-aware | `handle-sendgrid-webhook`, migrations, cron | Signed-event fixtures; suppression readback; console test event lands a `sendgrid_receipt_processing` row | Must land **before** any live tenant send |
| P5 | Operator and platform transactional route | Platform scope through P2; refactor `send-transactional-email` to platform scope (its tenant-sender branch moves to the door); fold in `tenant-signup`, `send-payment-confirmation-email`, `send-support-request`, `send-platform-invite`; `agreement-send` / `notify.ts` readiness comes from the door | Those functions, templates, `send-authority.ts` | §37 inventory of every caller in code read; send-authority tests; one authenticated platform send to an operator-owned inbox | **Owner:** live-send authorization; operator From addresses |
| P6 | Tenant managed sender and readiness | Rewrite provisioning (6 functions, 2 triggers) to create SendGrid connectors per the domain decision; readiness lists (`readiness.ts`, invoice readiness and 4 DB functions, `prepare_comms_email_send`, `_email_resolve_sender`, `email_campaign_dispatch_record`); migrate the 6 active tenants | Migrations, `_shared/comms-email/*`, `sales-invoice-delivery/*` | Per-tenant migration proof; `no_email_sender` / `SENDER_VERIFICATION_MISSING` states shown honestly; §51 checks for solo, sub-account and agency | **Owner:** shared vs per-business domain (Section 8, item 3) |
| P7 | Tenant direct senders onto the door | `public-booking`, `booking-manage`, `process-booking-notifications`, `send-portal-invite`, `plan-reminder-cron`, `skill-runner`, `comms-scheduled-drain` / `email-campaign-worker` (already through `send-message`); `paige-mcp` send tools routed or retired | Those functions; `capability-policy.ts` | §37 producer and consumer inventory across 8 caller classes; cron-path tests | None beyond P5/P6 |
| P8 | Auth email and queue | Supabase Auth's Send Email hook → the P5 platform route (no SMTP relay); retire the Lovable pipeline: `auth-email-hook`'s Lovable path, `process-email-queue`, `handle-email-suppression` (a live writer of `suppressed_emails` and `email_send_log` — its suppression duty moves to P4 first), `preview-transactional-email`; decide the 3 stuck pgmq messages | `auth-email-hook`, `process-email-queue`, dashboard configuration | Sign-up and reset drive on a test account; the auth config read pasted as evidence | **Owner:** dashboard change; whether to retire Lovable; the 3 stuck invites (Section 8, items 4, 8) |
| P9 | Inbound | SendGrid Inbound Parse → `handle-inbound-email` (SendGrid verification), or a decision to drop inbound | Edge function, admin-function endpoint, MX DNS | Signed inbound fixture; one live inbound | **Owner:** inbound decision and MX change (Section 8, item 5) |
| P10 | Remove Resend (after soak, Section 7) | Delete the rows marked REMOVE in Section 2 (#1, 11, 14, 15, 22, 23, plus #24 if decided); remove the Resend arms from `send-message` and `readiness.ts`; UI card (#31); copy (#32); re-anchor tests (#33); drop cron 19, the `admin_app_settings` Resend rows and the `resend_domain_id` column; mark the 8 Resend connectors retired | Code, migrations, `config.toml`, `paige-spine-contract.yml`, `scripts/proof/resend-*` | Repo grep for `api\.resend\.com|RESEND_API_KEY|npm:resend|esm\.sh/resend|svix` returns 0 outside history and docs; full suite against a measured baseline | **Owner:** destructive data removal (connector rows, column, settings), revoking the Resend key, Resend DNS removal (Section 8, item 7) |
| P11 | Final docs and registry | Resend registry entry → retired; SendGrid status as earned; master §4/§5/§10; brain; tier matrix | Docs | Section 7 checklist attached | None |

**How the S3 UI and G1 branches fit:**
- **S3 UI** (local branch `exp03-s3-ui-r5`, head `bf551740812f88727bf717fbe50e7d95a4d8becf`, not on main):
  - Rebase onto P2 and P6.
  - Replace the seeded `provider='resend'` fixture and the "PAIGE Email / Resend shared_support" migration comment with SendGrid.
  - Show `no_email_sender`, `SENDER_VERIFICATION_MISSING` and `EMAIL_PROVIDER_NOT_CONFIGURED` honestly.
- **G1** (local branch `exp03-email-g1-r11`; at grounding it was `bf551740812f88727bf717fbe50e7d95a4d8becf` plus 70 uncommitted files, and when this addendum was written its head was `4bc7620325877fbbe57295b221459a73169d7d13`, stacked on the S3 UI head; not on main):
  - Keep the `mailbox_class` / `mailbox_owner_user_id` ownership work and Gmail/SMTP as optional personal mailboxes.
  - Do **not** extend the `resend` entry in the provider list.
  - Rebase onto P6 and re-run the SendGrid door, receipt and sender-integrity SQL tests.
- Both branches are blocked from adding any Resend functionality. The P10 grep guard can be introduced early as a ratchet so the count of Resend references never rises.

## 7. Production verification and rollback, per cutover step

**Rollback principle.** From P2 the shared transport is SendGrid-only. The Resend arm left in `send-message` survives only as the time-limited rollback described here and is deleted in P10. Until P10, the Resend code stays in the tree but unused, so a rollback is a revert commit or switching a connector's provider back, with a **dated expiry of at most 14 days**, logged in master §10. After P10, rollback means reverting the PR. There is never a runtime fallback to Resend.

| Step | Cutover criteria (all must hold) | Verify in production | Rollback trigger → action |
|---|---|---|---|
| P1 credentials | Scope check returns `can_send_mail=true` and no admin scopes; result persisted | Evidence row exists; secret names listed (digests only) | Wrong scopes → do not proceed. Rotate the key in the SendGrid console (owner). |
| P3 domains | Platform domain shows verified in SendGrid; at least one test-tenant domain verified with the facts written | `select sendgrid_status, sendgrid_verified_at is not null from tenant_email_domains`; DNS CNAMEs resolve | Verification fails → leave the domain unverified (the door fails closed); nothing is sent. |
| P4 receipts | Console test event produces a row; an unsubscribe fixture produces a suppression row | `select count(*) from sendgrid_receipt_processing`; suppression readback | No rows → hold P5-P7. |
| P5 platform route | One authorized operator send arrives at an operator-owned inbox; a `delivered` receipt is correlated; canonical record and Rail entry present | Edge log 200 on the route; receipt row; message row | Failure, bounce, or no receipt within 1h → revert P5 (Resend code still present), record in §10. |
| P6/P7 tenant | Test tenant sends through the door end to end; the 6 tenants show either a SendGrid sender or an honest needs-setup state; booking, portal-invite and reminder crons return 200 with SendGrid receipts | Per-tenant connector query; `messages` with `pipe_used='sendgrid'`; cron logs | Receipt error rate above 5%, or any send that skips suppression → flip the affected connectors back for ≤14 days, revert. |
| P8 auth | Sign-up and reset emails arrive on a test account | Auth logs show the email event; Management API config read | Not arriving → revert the dashboard setting to its previous value. |
| P9 inbound | One inbound test message lands in the unified inbox | `messages` inbound row with provider `sendgrid` | Revert MX (owner). |
| Soak | 14 days (N=14 is proposed; the owner sets N) with zero Resend traffic | See checklist | Any Resend hit → find the producer and fix it before P10. |

**Final checklist before Resend is declared retired:**
- [ ] Edge logs: 0 calls to `handle-resend-webhook`, `resend-admin-probe` or `handle-inbound-email` with a Svix signature, over N days.
- [ ] 0 `messages` / `paige_message_audit` rows with `pipe_used='resend'`, or connector provider `resend`, created in the last N days.
- [ ] `select count(*) from channel_connectors where provider='resend' and active` returns 0. All 8 rows are migrated or retired by an owner-approved action.
- [ ] `cron.job` has no `reconcile_resend_receipts`; a SendGrid reconcile job is present and running.
- [ ] Repo grep for `api\.resend\.com|RESEND_API_KEY|RESEND_WEBHOOK_SECRET|npm:resend|esm\.sh/resend|resend\.dev` returns 0 outside docs history; CI guard green.
- [ ] Deployed function list has no `resend-admin-probe`, `handle-resend-webhook`, `send-welcome-email` or `backfill-welcome`; `/edge-drift` reports zero.
- [ ] `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` are absent from `supabase secrets list` (names only; values never read). `admin_app_settings` Resend rows are gone.
- [ ] Resend console: API key revoked, webhooks removed, domains removed. Resend DNS records removed (owner).
- [ ] `tenant_email_domains.resend_domain_id` is dropped (§32 persisted proof); `paige_config.resend_domain_verified` is gone.
- [ ] Supabase Auth email goes through SendGrid (config read pasted); Lovable email path retired.
- [ ] Registry: Resend `RETIRED`; SendGrid status earned with authenticated evidence; master §4/§10 and brain updated in the same PR.

## 8. Decisions only the owner can make

1. **Credential model.**
   - Confirm whether PAIGE-SENDGRID-MAIL-EXECUTOR and PAIGE-SENDGRID-PLATFORM-ADMIN are the SendGrid console key names, and under which Edge secret names they are installed.
   - Decide whether to drop the third slot (`SENDGRID_WEBHOOK_ADMIN_API_KEY`) or keep it as a narrower admin key.
   - Authorize amending the CI guard so the admin credential is readable in one operator-only admin function.
2. **Installing and rotating secrets.** Requires credential authority. Platform-admin key rotation is already owed.
3. **Sender domains and addresses.**
   - The operator and platform domain (for example `paigeagent.ai` vs a subdomain such as `sg-mail.paigeagent.ai`) and the From addresses (`hello@`, `billing@`, `support@`, `team@`, `calendar@`, `notifications@`).
   - For tenant "PAIGE Email": per-business subdomains, or a sanctioned platform-shared tenant sender scope that relaxes today's one-domain-per-business rule.
   - DNS changes.
4. **Auth email.** Point the Supabase Send Email hook at the platform route, and retire the Lovable email pipeline. (A custom-SMTP relay would be an exception to the one-door rule and would need its own mail-send-only key.)
5. **Inbound email.** SendGrid Inbound Parse (MX change), or Gmail/iCloud mailboxes only.
6. **Live-send authorization and timing.** The first real SendGrid sends (external sends, spending money), the cutover window, and the soak length N.
7. **Destructive retirement actions.** Deleting or retiring the 8 Resend connector rows, dropping `resend_domain_id`, deleting the Resend webhook-secret settings, revoking the Resend key, removing Resend DNS records.
8. **The 3 stuck role-invitation messages** (pgmq `transactional_emails`, 2026-07-10). Resend them through the new route, or discard them.
9. **`send-funding-report`.** It sends from `onboarding@resend.dev` under the §2 opt-in funding rules: retire it, or repair it onto the door for the funding preset.

## 9. Documentation to mark "SUPERSEDED BY OWNER DIRECTIVE 2026-10-14"

**Status: applied in cutover P0 (docs only, 2026-10-14)** for every doc record below and the correction-5 records at the
end of this addendum. Code comments, the migration and visible copy are NOT edited in P0 (no code changes); they are
recorded in master §10 and fixed in the PRs named. Line numbers are as of main
`6428c2ba61959ef302cf69e0dbd64a878ddbb35f`, before P0 shifted them.

Mark each line dated and keep the original text (§58/§11):

- `docs/brain/config-registry.md:537`: "tenant email under the 2026-10-13 owner policy; Resend stays the Platform Operator's own email". Also correct `:544` ("records the key's scopes" → returns them) and the surrounding block `:534-553`.
- `docs/brain/decision-log.md:14`: "Owner policy (2026-10-13): … Resend is the Platform Operator's own email." Keep the entry and add the 2026-10-14 entry beneath it.
- `docs/integration-registry/README.md:258`: Resend row, "Platform Operator email under the 2026-10-13 owner policy …". Also `:259`, the SendGrid row ("tenant PAIGE Email (owner policy 2026-10-13)").
- `docs/integration-registry/integration-capability-registry.json:1441` (Resend `business_reason`) and `:1530` (SendGrid `business_reason`: "Resend stays the Platform Operator's own email"). Also SendGrid `tier_eligibility.platform: "ineligible"` (within `:1527-1575`).
- `docs/integration-registry/expense-and-operations-report.md:59`: "Resend | Platform Operator email (owner policy 2026-10-13)".
- `docs/delivery/paige-mail-sendgrid-integration.md:151`: "Resend is the Platform Operator's own email". Also correct `:16,25` ("allowlist intentionally empty"), which is out of date since S7.4 (`:166-170`).
- `docs/delivery/exp03-launch-email-providers-plan.md:3`: "Platform Operator system mail = Resend".
- `docs/architecture/CANONICAL-SYSTEM-ARCHITECTURE-2026-08-08.md:290`: the 2026-10-13 correction note "Resend is the Platform Operator's own email".
- `docs/PAIGE-MASTER-PROJECT-REFERENCE.md`:
  - `:1029`: the "allowlist intentionally empty" / `buildProvider` beside Resend entry (the `SendGridProvider` it describes was later removed in #2126).
  - `:4427`: "The 2026-10-13 SendGrid policy is applied at the governed door".
  - Add a new §10 correction entry recording the reversal.
- `docs/delivery/paige-mail-domain-transport-study.md:65,128`: "Resend is the transport implementation" and "Resend domain provisioning — platform-operator action".
- Code comments that state the policy are not docs, but should be corrected in P2/P6 and marked superseded:
  - `supabase/functions/send-message/index.ts:1351-1354` ("Platform default stays Resend").
  - `supabase/migrations/20271031000100_paige_email_sendgrid_governed_door.sql:4-5` ("Resend stays the Platform Operator's own comms"). Migrations are immutable, so record the supersession in the master §10 entry rather than editing the file.
- `src/operator/surfaces/IntegrationsSurface.tsx:70` (visible copy, "Resend … The platform email adapter"). Fix in P10/P11.

Searches behind this list (§71): `Resend stays`, `Platform default stays Resend`, `Platform Operator.{0,40}Resend`, `Resend (is|stays|=)`, `system mail = Resend`, `owner policy 2026-10-13`. They ran over `*.md`, `*.json`, `*.ts` and `*.sql` at main `6428c2ba61959ef302cf69e0dbd64a878ddbb35f`. `docs/brain/decision-log.md` matched as a binary file and was read with `grep -a`.

---

## 10. Corrections applied after independent review

An independent reviewer (not the author of this plan) found the core accurate and asked for these corrections. All are applied above or listed here.

1. **Auth email** targets the Send Email hook → platform route, not an SMTP relay (Section 4 item 8, P8, Section 8 item 4).
2. **Live producers missed by the first inventory.** Each sends through `send-transactional-email`, which uses Resend, and each joins the P5 producer inventory:
   - cron jobid 25 `solo-beta-welcome-drain` (every 5 min) → `solo-beta-welcome-drainer` v14; its DB function `solo_beta_claim_welcome_delivery` carries a Resend idempotency assumption in its body (fix in P5);
   - cron jobid 15 `security-canary-probe` (hourly, v1232), operator alert email (`security-canary-probe/index.ts:184`);
   - `growth-process-submission` v78 form-submission alert (`index.ts:667-671`; its own comment at `:613` says the template is not registered);
   - `stripe-webhook`, `send-notification` v1665, `notify-team-event` v1642, `notify-approval-event`, `send-admin-invitation` v71, `agency-invite-member` v60, `send-beta-launch-email` v1624, `send-broker-team-invite`, `broker-admin-action`, `broker-auto-approve`, `admin-account-actions`, `invite-affiliate`, `affiliate-application-confirm`, `handle-inbound-webhook`, `refresh-fundability-scores-biannual`, `solo-beta-stripe-webhook`, `src/lib/affiliates/applications.ts`;
   - `affiliate-monthly-statement-cron` calls the hub in code but is not deployed;
   - `send-message` callers that default to Resend: `execute-approval`, `paige-ai-chat`, `sales-invoice-command`.
3. **Lovable pipeline** also includes `handle-email-suppression` v1629 (live suppression writer) and `preview-transactional-email` v1629 (P8).
4. **Database objects that check `provider='resend'`:** `check_solo_setup_managed_email` and `operator_preview_account_deletion` change in P6/P10, or Systems Check and the deletion preview go wrong after cutover.
5. **Copy and docs:** public landing copy `src/components/landing/IntegrationsSection.tsx:32` ("Twilio & Resend"); comments `src/solo/settings.tsx:1062`, `useSoloComms.ts:66,293`; `docs/delivery/paige-mail-multitenant-deliverability-gap.md:11` and `docs/brain/decision-log.md:9` join the Section 9 list.
6. **`RESEND_WEBHOOK_SECRET`** is named by 3 functions, not 2. `resend-admin-probe` (gated by the service-role key or the Vault cron token) returns webhook `secret_values` and `signing_secret` in its response (`:82-83`, `:127`). It is REMOVE, and should go early in P10 or sooner.
7. **Inbound** count corrected to 5 (Section 1).
8. **Section 3** credential column labelled as read from code.
9. **P2/P10:** the Resend arm survives only as the ≤14-day rollback and is deleted in P10.

Still UNVERIFIED (unchanged): which owner-named key is installed under which env name and with what scopes; whether `SENDGRID_WEBHOOK_PUBLIC_KEY` and `RESEND_API_KEY` are set; whether SendGrid honours `X-Idempotency-Key`; platform DKIM; the Supabase Auth SMTP/hook configuration.
