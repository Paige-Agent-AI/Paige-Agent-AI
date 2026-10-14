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

S3 currently owns `readiness.ts`, `comms-email-command`, `execute-approval/*` and the `prepare_comms_email_send` replacement. Nothing below touches those until S3 merges. *(S3's backend merged 2026-10-14 as #2126 → `f2e2a0af6`; G1 is rebased onto it.)*

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
