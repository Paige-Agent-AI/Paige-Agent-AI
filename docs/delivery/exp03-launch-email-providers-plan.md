# Experience 03 — launch email providers: Gmail and iCloud Mail (grounded plan)

Date: 2026-10-13 · Journey Lead: Experience 03 · Owner decision: Gmail and iCloud Mail are public-launch targets; businesses keep the address they already use. Policy preserved: PAIGE-managed tenant email = SendGrid · customer Gmail = Gmail OAuth · customer iCloud Mail = provider-supported IMAP/SMTP · Platform Operator system mail = Resend.

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
   - The composer and draft "Approve" email branches (`ClientsConversations.tsx:947,1063`) call `comms-email-command` through a new `conversations/governedSend.ts`, with the preview card inline.
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
| C1 | Conversations sends email through the approval path | `ClientsConversations.tsx`, new `conversations/governedSend.ts`, `PaigeConfirmCard` | Composer and draft Approve both go through approval and fingerprint and are recorded in `messages`. No silent account fallback. SMS is unchanged. | M | D1, plus the S3 `readiness.ts` changes (change 5) |
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