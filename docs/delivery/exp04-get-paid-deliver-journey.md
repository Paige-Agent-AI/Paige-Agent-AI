# Experience 04 — Get Paid & Deliver My Services: journey inventory, flow map and delivery plan

Date: 2026-10-12 · Journey Lead: Claude Code (one accountable lead) · Records: ANT-51 / ANT-147 · Shell: SOLO

**Status: CHECKPOINT 1 (inventory and plan) + E4-S1 shipped (§11, PR #2074, main `c0a20243`) + E4-S1b time zones (§13) + documented contracts (§12).** Branch `claude/clever-lovelace-r111ru`.
Nothing here is owner-accepted or customer-released. Every claim names its evidence. Every absence claim
names what was searched. Production evidence comes from read-only aggregate SELECTs; no identifiers or
values were read.

**The outcome.** An owner says:

> *"PAIGE, I signed a new consulting client for $3,500. They're putting $500 down and paying $300 each month.
> Prepare their agreement, arrange the payments, onboard them, assign the work, and follow up on their
> outstanding payments until everything is completed."*

PAIGE then does the following:
- coordinates agreement → terms → deposit → onboarding → delivery → collections;
- asks for each approval the doctrine requires;
- records what actually happened;
- answers *"what's the status of this client, what have they paid, what do they still owe, and is their work
  on schedule?"* from the authoritative records.

---

## 1. Grounding: what was read, and production reality

- `main` at `fac93272` (2026-10-12). Production `xygzykjyynhzqytbqnzu`. Migration ledger head is `20271025000100`.
- Docs read:
  - `docs/brain/README.md`
  - `.claude/skills/second-brain/SKILL.md`
  - master reference §0 / §4 / §5
  - Sales: `sales-agreements-source-contract`, `sales-commercial-*`, `sales-collection-context-s2`,
    `solo-sales-*`, `sales-provider-s1/s34`, `sales-golden-balance-proof`, `sales-merchant-*`
  - Operations: every `operations-*` packet and production record
  - Communications: `comms-qa-provider-boundary`, `paige-mail-*`
  - Doctrine: `one-approval-gate.md`, `autonomy-architecture.md`, `paige-modality-neutrality.md`
  - PAIGE runtime: `paige-spine-and-rail-state.md`, `paige-operating-fabric-contract.md`
  - QA: `pc1-*`, `solo-test-tenant-spec.md`
  - Registries: the Integration Capability Registry and the config registry
  - Issue #1832 in full
  - `docs/delivery/exp03-grow-my-business-journey.md` (PR #2068)
- Five independent read-only research lanes ran: Sales agreements · Payments/collections · Operations ·
  Communications/consent · PAIGE reach/boundaries/QA. The lead then re-checked the load-bearing claims directly:
  - the deposit-count rule: `20270547000000_sales_collections.sql:108`;
  - the handoff eligibility: `20271022000030_operations_engagement_handoff.sql:32–60`;
  - the QA floor and INT-346 state, on prod;
  - the legacy invoice sender, in source.

**This journey has never run on production.** Read-only aggregates, 2026-10-12:

| Record | Prod count |
|---|---|
| `tenant_client_agreements` (commercial terms) | **0** |
| `paige_agreements` (signing documents) | **0** |
| `paige_invoices` | 1 (`issued`) |
| `paige_invoice_payments` | 2, both `manual_recorded` (0 provider-verified) |
| `paige_invoice_provider_operations` | **0** (no hosted payment ever dispatched) |
| `tenant_stripe_accounts` | 1 LIVE reservation, onboarding incomplete, charges disabled |
| `plans` | **0** |
| `plan_items` | 3 (reminders) |
| `operations_delivery_submissions` / `_client_releases` | 0 / 0 |
| Clients with a linked portal login | **0** |
| `paige_automations` (§67 processes) | **0** |
| `messages`, last 30 days | 8 email out, 1 voice out, **0 SMS ever** |
| `tenant_a2p_registrations` | 1, `pending` |

**Two platform-wide blockers sit outside this journey's ownership:**

1. **INT-346 is DRAINING.** `paige_chat_interactive_protocol()` returns `{"version":2,"active":false}`
   (read 2026-10-12). Typed Solo Chat turns run with no tools. PAIGE can talk but cannot read or act through a
   tool. Activation is owner-reserved (Conversational Loop, #1822 / #1837).
2. **PC-1 QA Shared Synthetic is not ready.** Tenant `bcefc207…` is standalone, top-level, active, with one
   owner and zero business data. As read on 2026-10-12, its `comms_provider_execution_disabled` is still
   `false` and the protected Auth marker is absent. No runner credential is installed. These are already recorded
   in #1832 (comment 6128513899) and ANT-21. **No provider-capable step may run against PC-1 until that floor is
   set.**

---

## 2. Capability inventory: REUSE / EXTEND / REPAIR / NEW

### 2a. Commercial agreement

| Requirement | Class | Evidence |
|---|---|---|
| Read accepted offer, customer and terms | **EXTEND** | Terms in `tenant_client_agreements` link to `clients` and `tenant_products`. Read through `read_sales_collections` and `read_sales_commercial_package` (`20270598000001`, #1795). There is no `deal_id` on either agreement table, so a won deal cannot resolve to its terms (`solo-client-deal-integrity.md:60`; Exp 03 plan row 20 raises the same seam). |
| Prepare the agreement | **REUSE + EXTEND** | `paige_agreements` + `save_paige_agreement` (`20270401000000:741`) accept `_commercial_terms_id` / `_offer_id`. **But** the Chat tool `agreement_draft` exposes only `contactId, title, bodyMarkdown, agreementId` (`_shared/paige-spine/domains/agreement.ts:87`), so an agreement PAIGE drafts is never bound to the terms. The manual UI is upload-only (`sales-ops.tsx:690–713`). Templates are unused. |
| Route for approval / signature | **REUSE** | Native e-sign. `agreement-send` freezes, hashes, mints signer tokens, emails, and moves `draft → sent`. `/sign/:token` → `sign-agreement` seals. Chat `agreement_send` is high risk and needs an approval card. The Solo "Send for signature" action is in place (`sales-ops.tsx:1255`). Legacy DocuSign has 0 envelopes and a documented §9 weakness; do not use it. |
| Distinguish draft / sent / signed / **effective** | **NEW (effective)** | Signing status values: `draft, sent, viewed, partially_signed, completed, declined, voided, expired`. Terms status values: `draft, active, paused, completed, cancelled`. **Nothing links them.** No trigger, no column and no function moves terms when signing completes. Signing does not freeze the agreed amounts: `signed_terms_compatibility = unverified_no_frozen_commercial_snapshot`, tracked in #1843 (INT-311 P1-B). |
| $3,500 / $500 down / $300 monthly | **REUSE (with constraint)** | `kind='deposit'` must have exactly 2 rows (`20270547000000:108`). So "deposit + 10 × $300" must be stored as `custom` with 11 dated rows that sum to 350000. The repayment preview (`_shared/sales-collections/repayment-read.ts`) and INT-311 proof already walk 350000 / 50000 / 10 × 30000 on synthetic data. It needs real dates, so a missing start date becomes **one question back to the owner, never a guess**. USD only. |

### 2b. Payments

| Requirement | Class | Evidence |
|---|---|---|
| Deposit invoice | **REUSE** | `save_sales_billing_draft` with exact fixed deposit (`20270571000000:98–112`), bound to terms through `commercial_terms_reference` (`20270601000013`, #1872). |
| Installment schedule → receivables | **EXTEND / NEW** | The schedule is recorded and previewed only. Missing pieces: per-due-date obligation, per-installment invoice, mandate and scheduler. `sales-provider-s34.md` §Remaining step 5 lists "due-obligation/receivable lifecycle" as owed (Sales/Payments). |
| Invoices | **REUSE** | `draft → issued` with an immutable snapshot and digest (`20270543000000`). PDF and governed delivery through `sales-invoice-delivery`. |
| Balance | **REUSE** | One owner: `_sales_invoice_balance_rows` (`20270601000002:6–20`). The collectible register is `list_sales_collection_register` (UI-only; no Chat read). |
| States expected/attempted/pending/succeeded/failed | **REUSE** | `paige_invoice_provider_operations.state` (`20270597000001:21,348`). |
| Refunded / disputed | **NEW** | Provider reversal and dispute ("S5") are not built. `stripe-webhook` `charge.refunded` only touches platform tiers (`stripe-webhook/index.ts:1727`). |
| Reconcile against provider evidence | **REUSE** | A signed webhook only locates the operation. A fresh account-scoped GET decides the result. `allocate_verified_sales_invoice_payment` writes it, with a receipt guard and a unique settlement index. |
| "Issued ≠ received" | **REUSE, structural** | Issue never writes a payment. `evidence_kind` separates `manual_recorded` from `provider_verified`. Readers label the classes. |
| Stripe posture (§38) | **REUSE** | Connect direct charges on the tenant's account, application fee 0, `transfer_data` refused (`_shared/sales-payments/stripe-hosted.ts:33,76,90–93`). **The environment is derived from the platform key prefix, which is LIVE.** A Stripe TEST settlement needs a separate test configuration and is `UNAVAILABLE` today. |
| One canonical ledger | — | `paige_invoices` (obligation) · `paige_invoice_payments` (append-only receipts) · `paige_invoice_provider_operations` (async facts). **Do not touch or duplicate:** `paige_payment_authorizations`, storefront `tenant_orders`, `platform_*`, or the legacy `stripe_invoice_id` columns. The `paige-mcp` `send_invoice` tool is contained in E4-S1 (#2072, §11); `create_invoice`'s remaining issues stay with Sales/Communications under #2072. |

### 2c. Onboarding and delivery

| Requirement | Class | Evidence |
|---|---|---|
| Onboarding after the qualifying event | **EXTEND** | `operations_engagement_handoff` (`20271022000030`, #1992 / #2042) turns a sealed signing plus active terms into one source-linked project with milestones. **It is manual only:** no trigger, no event, no payment condition. It never reads invoices. It is also Solo-only by hard gate (L32), so sub-accounts are refused; that is a §60 parity question for the Operations owner. |
| Client onboarding checklist / required documents | **NEW** | `clients.onboarding_stage` exists, but only the portal service-agreement path sets it. No checklist object exists. `program_document_requests` exists with 0 rows and no UI; `btf_document_requests` is funding-vertical and off-limits as a default (§2). |
| Create and assign work, milestones | **REUSE** | `plan_create_scoped`, `plan_add_milestone_scoped` (#1982), `plan_assign_task_scoped` (#1972), versioned updates (#1922); mounted in `OperationsWorkspace`. **Chat `plan_*` tools call the older unscoped, non-idempotent writers** (`paige-ai-chat/index.ts:16145+`, `planning_writes.ts` maturity PARTIAL). |
| Internal review / client acceptance | **REUSE backend, REPAIR mount** | Submissions, review, reviewer recovery and discovery, and the client release lifecycle are applied (#1997, #2015, #2030, #2053, #2060). **The staff and client UIs are unmounted**; Operations is actively on it (#2067). Client acceptance needs `clients.linked_user_id`, and **0 clients have one**. |
| Completed vs overdue | **REUSE (client-side), EXTEND** | `OperationsOverview.tsx:16` computes overdue in the browser. The Fabric `operations` adapter reports Systems Check findings, not delivery work. |

### 2d. Collections communications

| Channel / need | Class | Evidence |
|---|---|---|
| Email | **REUSE** | One door: `send-message`. Invoice email goes through `sales_invoice.email_send` (high → confirm) and needs the tenant's own connector. No platform-sender fallback. Provider acceptance is `PROOF_OWED`. |
| SMS | **REUSE + blocked** | Same door, tenant Twilio subaccounts. Readiness needs A2P `approved`; prod has 1 registration, `pending`. There is no standalone `comms.sms_send`; invoice SMS rides inside `sales_invoice.email_send`. |
| AI outbound call | **NEW (largest gap)** | `voice-twiml` is a human softphone. No AI caller, no machine detection, no voicemail. Vapi is `UNAVAILABLE` / lane `prohibited`. §46 forbids provider-hosted agents. **The outbound dial imports only `normalizePhone` from the pre-send pipeline: no consent, suppression or calling-hours check** (`voice-twiml/index.ts:40`). Any AI call path must sit behind the gate. |
| Inbound payment-status inquiry | **EXTEND** | Inbound SMS, email and voice exist. A hash-only invoice access grant link exists. **No identity-verified automated "what do I owe?" answer.** |
| Consent / opt-out / quiet hours | **REUSE + REPAIR** | `_shared/pre-send-pipeline.ts`, in order: DND → `paige_suppressions` → `paige_consent_events` (default-deny for SMS) → auto-send DND → TCPA quiet hours 20:00–08:00 for SMS. STOP and START are ingested. **Gaps:** <br>• when the client time zone is unknown, quiet hours falls back to `America/New_York` (`:38`); <br>• the legacy `communications_consents` store is still written; <br>• there is no transactional/collections consent topic; <br>• voice bypasses the gate. |
| Follow-up sequence engine | **EXTEND** | §67 Process Records (`paige_automations` / `_acts` / `_triggers`, `paige-native-event-dispatch`, fire-once ledgers, 5-min sweeper). **There is no time-based trigger and no `invoice.due_soon` / `invoice.overdue` / `payment.received` event.** External acts stop at `approval_pending`. Delays reuse `messages.scheduled_for` + `comms-scheduled-drain`. **Do not use** the marketing `email_sequences` engine, and do not build a collections scheduler: `sales_collections.ts:6` says it is not one. |
| Outcome taxonomy | **NEW (backend)** | Promise to pay, dispute, failed attempt, answered, voicemail: **none exist.** `twilio-status-callback/call-status.ts:22–26` folds busy and no-answer into `failed`, and completed into `delivered`. |
| Approval and receipts | **REUSE** | One gate: `_shared/action-risk.ts` + `paige_pending_confirmations` (fingerprinted, single consume). Receipts: `record_capability_run` → Rail. An `auto` grant can never cover an external send (§67 / action-bus CHECK). `send-message` also honours `paige_pending_approvals` (L1751–1786), a second store, UNVERIFIED against the one-gate rule. |

### 2e. The status question

**No per-client "paid / owed / on schedule" read exists.** Searched:
- `composeBusinessReview` / `snapshot.ts` (business-wide, period-based, not wired to a turn);
- `crm_get_contact_summary` (deals, activities, tasks; no invoices or agreements);
- `get_client_rail`;
- `read_sales_collections`;
- the Chat tool list (95 inline tools);
- the Spine registry.

Finance has zero Chat reach: `finance_reads.ts` is "candidate declarations only".

---

## 3. Flow map (actor-goal flows)

Primary actor is the Solo owner (or an authorized admin), unless noted.

| ID | Flow | Trigger | Success outcome | Depends on |
|---|---|---|---|---|
| F1 | **Set up the engagement** | The owner's sentence (Chat/Live), or "New engagement" on the client | Terms saved (draft → active) with an 11-row schedule. Agreement drafted **bound to those terms**. Owner approves. | Sales terms + agreement writers; Exp 03 deal hand-in |
| F2 | **Get it signed** | Owner approves send | Client signs; document sealed; terms become **effective** against the signed version | F1; native e-sign |
| F3 | **Collect the deposit** | Effective, or owner instruction | Deposit invoice issued; payment request on the tenant's own Stripe; settlement provider-verified, or owner-recorded and labelled | F2; merchant readiness |
| F4 | **Kick off onboarding and delivery** | Qualifying event (effective + deposit settled) | PAIGE offers the existing handoff. Owner approves. Project, milestones, assignees and onboarding checklist are created. | F2, F3; Operations handoff |
| F5 | **Deliver and get acceptance** | Work progresses | Milestones done, internal review passed, client accepts through their portal | F4; Operations delivery (mount owed) |
| F6 | **Follow up on what's owed** | Due-soon, missed or overdue obligation | Owner's permitted sequence runs under approval. Outcomes are recorded. It stops on paid, dispute, opt-out or promise. | F3; obligation lifecycle; Comms; §67 time triggers |
| F7 | **Answer the client's own status question** (actor: the client) | Inbound SMS/email/portal | Identity verified, then a truthful balance and next due date; otherwise a handoff to the owner | Obligation read; inbound channels |
| F8 | **Know where this client stands** | *"What's the status of this client…?"* | One truthful answer, from authoritative records, with evidence classes | All of the above as read-only sources |

Notifications, analytics, receipts and Rail are shared systems inside these flows, not flows of their own.

---

## 4. Proposed UI/UX and conversation flow (for prototype; not yet approved)

Per §00, Flow-by-Flow decides *what*, Impeccable decides *how*, and the owner sees a rendered design before it
ships. Below is the interaction architecture. The visual design comes as a `flow-prototype` frame for slice 1, not
as prose.

**Conversation (primary entry).** PAIGE answers the owner's sentence with **one Engagement Plan card**. She does not
reply with a wall of text and does not ask ten questions.

1. She resolves what she can:
   - the client, from CRM;
   - the offer, from Sales offers;
   - the total, deposit and installment amounts, from the sentence.
2. She asks **only what she cannot know**, in one grouped question. Example: "When should the first $300 monthly
   payment be due — the 1st of next month?"
3. The card shows, in plain language:
   - client · offer · **$3,500 total** · **$500 due at signing** · **10 × $300 monthly from {date}** · the
     schedule sums to the total (checked, not assumed);
   - the agreement (template + terms bound);
   - the onboarding checklist and the delivery project with milestones;
   - the follow-up policy (§4 below).
4. Approval follows the one-approval gate:
   - every consequential step (send agreement, issue invoice, request payment, send a reminder) is its own
     fingerprinted confirmation;
   - whole-package approval belongs to **INT-335**; this journey consumes it and never builds a second approval
     channel.
5. While INT-346 is draining, the same card and steps are reachable from the client record (below). Chat reaches
   them the day tools are admitted, through the same seams.

**Client record → Engagement panel (one home, §18).**
- The panel is one surface: a five-stage horizontal stepper.
  - **Agreement**: draft / sent / signed / effective.
  - **Payments**: progress against the agreed schedule (paid, due and unpaid, not due yet) and the schedule
    itself. **Superseded by E4-S1 (§11):** rows carry no paid/received chip, because which payment covers which
    instalment is not recorded (`installment_allocation`). Payment states live on invoices. Disputes are shown
    as not tracked. Totals show **paid (by evidence class) / still owed / past due**.
  - **Onboarding**: the checklist with owner/client responsibility.
  - **Delivery**: milestones, on track / overdue.
  - **Follow-ups**: next planned touch, the last outcome, and paused-because.
- It opens from the Clients › People record. Sales › Collections deep-links to the same panel; it is never rebuilt
  twice.
- Container: a drawer over the client list. The work is medium-length and benefits from keeping list context. On
  phones it becomes a full-height sheet.
- Gold is spent only on the single next act ("Send for signature", "Approve reminder").

**Follow-up policy (a §67 process the owner can read as sentences).** It is shown as an editable rule list:
- "Email a friendly reminder **3 days before** each payment is due."
- "If a payment is missed, text a reminder **1 day after**." Unavailable until SMS is approved for your number;
  shown honestly as unavailable.
- "If still unpaid **7 days after**, schedule a call." Shown as `UNAVAILABLE` until AI calling is built and
  separately authorized.
- "Stop when paid, disputed, opted out, or when they promise a date (resume after it)."

Each send is drafted by PAIGE and approved by the owner (draft-first, §36). Nothing reaches a client without a
human yes in this MVP; see §6.

---

## 5. First smallest complete vertical slice — E4-S1 "Where this client stands"

**Why this first.**
- It answers the outcome question (F8) end to end, client to persistence, on records that already exist.
- It is read-only, so it carries no money, send or provider risk and is provable now with rolled-back SQL on
  synthetic data.
- It becomes the **reconciliation oracle** every later slice depends on. F6 decides whether to stop following up from
  this read, and F4 decides "deposit settled" from it.
- Building writers first would leave PAIGE unable to report truthfully on what they did.

**Scope.**
1. **One governed read**, `client_engagement.status`, for a single contact in the caller's current workspace
   (owner/admin; §59 in-body scope; foreign tenant and client role denied). It composes the existing domain
   readers and never re-derives them:
   - signing state (`paige_agreement_overview`);
   - active/draft terms and the dated schedule (the Sales collections reader);
   - invoices and balance (`_sales_invoice_balance_rows`), with received amounts **split by evidence class**:
     verified by provider vs recorded by owner;
   - Operations work for the contact (milestones/tasks: open · done · overdue · next due).
2. **Schedule position, honest by construction.**
   - "Due to date" is the sum of schedule rows with `due_date ≤ today`.
   - Behind/ahead is due-to-date minus received.
   - The next due row is reported.
   - It does **not** fabricate a per-installment allocation the ledger never made, and says so.
   - Absent terms, absent dates or stale versions come back as named states, never zeros.
3. **Receipt.** An atomic `record_capability_run` read receipt, fail-closed (the S2 pattern).
4. **Spine + Chat registration** through Platform Reach (INT-179) review. It is dark in typed Chat until INT-346
   admits tools; reachable through the same seam from day one.
5. **UI.** The Engagement panel in read-only form (Agreement · Payments · Delivery stages). Prototype first; the
   rendered frames go to the owner.
6. **Proof.** SQL rollback proof on two synthetic tenants walking the $3,500 scenario at five points:
   - nothing paid;
   - deposit owner-recorded;
   - deposit provider-verified (fixture);
   - month 2 missed;
   - fully paid.

   Plus wrong-role, foreign-tenant and client-role refusals, and a test that fails on purpose when an evidence class
   is merged (§71.4). It ends with an independent non-author review, exact-head CI, CI-deployed migration and edge,
   and a persisted readback.

**Out of scope for S1:** any write, send, payment request or new table.

**Next slices, in dependency order (each separately reviewed):**
- **S2 Effective:**
  - bind `agreement_draft` to terms/offer;
  - on signing `completed`, propose terms → effective against the sealed version;
  - coordinate with #1843 for the frozen snapshot.
- **S3 Deposit and kickoff:**
  - deposit invoice from terms;
  - "deposit settled" from S1;
  - PAIGE *offers* the existing Operations handoff;
  - onboarding checklist (tenant-authored, Playbook-driven).
- **S4 Obligations and time events:**
  - per-installment obligations or invoices (Sales/Payments design);
  - `invoice.due_soon` / `invoice.overdue` / `payment.received` native events for §67.
- **S5 Governed follow-up:**
  - email reminder process (draft → approve → send through the gate);
  - outcome records (promise · dispute · failed · opted out · paid);
  - suppression;
  - SMS once A2P is approved.
- **S6 Inbound status answers:** identity-verified.
- **S7 AI calling:** only after legal review and owner authorization (§6).

---

## 6. Payment, consent, communications and authorization safety matrix

| Action | Who may | Gate | Provider effect | Evidence written | Stop / suppress |
|---|---|---|---|---|---|
| Read engagement status | Owner/admin of the current workspace | In-body scope (§59), no foreign tenant, no client role | None | Read receipt | — |
| Save / activate terms | Owner/admin | `sales_create_commercial_terms` high → confirm | None | Terms version + receipt | Activation needs `starts_on`; one active per client per offer |
| Draft agreement | Owner/admin | Ordinary → confirm in Chat | None | Draft + receipt | — |
| Send for signature | Owner/admin | High → confirm card; provider floor; pre-send gate | Email to client | Frozen hash, signer tokens, Rail | Suppressed or DND recipient refuses |
| Terms → effective (S2) | System proposes, owner confirms (ASSUMED) | Signing `completed` + sealed hashes + bound terms version | None | Transition + receipt | Version mismatch: refuse and ask |
| Issue invoice | Owner/admin | High → confirm | None | Immutable snapshot + digest | — |
| Payment request | Owner/admin | High → confirm; merchant readiness read back from Stripe | Hosted Checkout on the **tenant's** account; fee 0 | Provider operation | **Real money disabled unless separately authorized.** TEST is UNAVAILABLE until a test config exists. |
| Record a payment by hand | Owner/admin | High → confirm | None | `manual_recorded` and labelled so; **never** called verified | — |
| Settlement | Provider only | Signed webhook + fresh GET | — | `provider_verified` allocation | Unknown outcome: reconcile; never assume |
| Refund / dispute (S5+) | Provider-evidenced | NEW | — | NEW reversal / dispute records | **Dispute pauses all collections** |
| Email reminder (S5) | Drafted by PAIGE, sent on owner yes | Confirm per send (an `auto` grant may never cover an external send, §67); provider floor; DND; suppression; email consent where enforced | Email | Message + outcome + Rail | Stops when balance is 0, disputed, opted out, a promise is active, or paused |
| SMS reminder (S5) | Same | Same + A2P approved + SMS consent (default-deny) + quiet hours 08:00–20:00 **recipient local; unknown time zone holds, fail-closed (proposed repair to the New York fallback)** | SMS | Same | STOP sets suppression (exists) |
| AI outbound call (S7) | **Not authorized** | NEW. Needs: prior express consent for an artificial voice (the FCC's 2024 ruling treats AI voices as "artificial" under TCPA); calling-hours rule; DNC/suppression; AI and recording disclosures (two-party-consent states); a Paige-owned brain (§46 forbids hosted agents); legal review of first-party collection law in the client's state | Call | NEW call outcome records (answered / voicemail / no answer / promise / dispute) | **STOP boundary: legal acceptance + owner authorization** |
| Inbound status answer (S6) | The client | Verified identity (portal login or one-time code) before any balance; otherwise "I'll have {owner} reach you" | Reply | Message + Rail | Unverified sender: refuse to disclose |
| Any provider-capable test | — | PC-1 floor must be `true` first (#1832) | None in QA | — | **No real money, calls, SMS or customer email in this programme without separate approval.** |

*Legal note: this matrix is an engineering control list, not legal advice. AI calling and SMS collections need
qualified legal review before activation.*

---

## 7. Integration boundaries with Experiences 01–03

| Owner | Owns | Experience 04 relationship |
|---|---|---|
| Exp 01 (ANT-50) | Discovery and the business brief | **Reads** offer and business context only |
| Exp 02 (ANT-147) | COO view, `composeBusinessReview`, `get_business_snapshot` (#2040) | **Feeds** paid/owed/delivery evidence through the Fabric adapters. The per-client read (S1) is client-scoped; the business-wide roll-up stays Exp 02's. **No second snapshot.** |
| Exp 03 (ANT-51, #2068) | Acquisition → conversion | **Hand-in:** a won deal or accepted offer. The deal → terms bridge (no `deal_id` on terms; `paige_invoices.deal_id` never set) is a **shared seam**, coordinated on #2068 before either side writes it. |
| Sales/Payments (ANT-18/19) | Terms, agreements, invoices, payments, collections reads | Obligation lifecycle (S4) and S5 refund/dispute are Sales-owned designs. Experience 04 integrates them and does not fork them. |
| Operations (active, #2067) | Plans, handoff, delivery, review, client release | S3 consumes the handoff. The mount of staff/client review is Operations'. **The Solo-only sub-account refusal is for the Operations owner to decide under §60/§61.** |
| Communications (#1140) | `send-message`, pre-send gate, consent, Twilio, voice | S5–S7 repairs to the gate (voice, time zone, consent topic) are Comms-owned changes, raised there. |
| Platform Reach (INT-179) | Spine registry + chat registration | Every new capability goes through its review. |
| Conversational Loop (INT-346 / #1822 / #1837) and INT-335 | Tool admission; package approval | **Blockers** for the conversation-led path; owner-reserved. |
| QA (ANT-21 / #1832) | PC-1 and the runner | Single test business; not ready. |

This branch is separate from the Experience 03 branch and worktree.

---

## 7a. Specialist support required

- **Sales/Payments:** obligation lifecycle, `deposit + N` terms kind, S5 refunds/disputes.
- **Operations:** handoff trigger, mounts, sub-account parity.
- **Communications:** voice behind the gate, time zone, collections consent topic, A2P.
- **Platform Reach:** S1 capability review.
- **Conversational Loop / INT-335.**
- **QA** for PC-1.
- **Qualified legal review** before S5 SMS and S7 calling.
- **In-session team for each slice:** a builder, an adversarial verifier, and a compliance officer (§1/§5/§39). The
  verifier and compliance officer never author.

---

## 8. Release and authenticated acceptance plan

Every slice runs this sequence:

1. Pre-edit packet.
2. Failing-first tests.
3. Rolled-back SQL proof as `authenticated` with synthetic claims. Labelled *database-level, not authenticated
   runtime*.
4. Independent non-author review.
5. Exact-head CI.
6. Merge.
7. CI-deployed migrations and edge, with persisted readback (§32) and `/edge-drift` zero.
8. Master §4.0 row and Brain update in the same change.

Release channel is `production`. Customer release identity: none until the full journey earns one. Owner review
happens on the live site (§4 pre-launch).

**Authenticated acceptance (all `UNVERIFIED` until PC-1 is ready):** one scripted PC-1 drive per slice, through
`scripts/live-drive`:
- seed the synthetic client and offer through the domain APIs;
- walk the $3,500 scenario;
- check every number in the Engagement panel against SQL readback;
- run the denial cases.

**Provider legs stay off.** Stripe TEST settlement, real email or SMS, and calls each need their own authorization and
the PC-1 floor set to `true`.

---

## 9. Open decisions

Each has a recommendation. They are reversible unless marked.

| # | Decision | Recommendation | Status |
|---|---|---|---|
| D1 | Does signing completion make terms effective by itself? | Yes, **only** when the signed document is bound to that exact terms version. Otherwise PAIGE asks the owner. | ASSUMED |
| D2 | What qualifies onboarding kickoff? | Effective + deposit received, with any evidence class shown honestly. PAIGE offers; the owner approves. | ASSUMED |
| D3 | May reminders ever send without a per-send yes? | **No**, for this MVP: draft-first, one-tap approve. Revisit under §68 attestation. | ASSUMED (doctrine-aligned) |
| D4 | AI calling | Not before legal review + owner authorization. | **STOP — owner/legal** |
| D5 | Sub-accounts in the Operations handoff | §61 default says Sub-account YES. Routed to the Operations owner. | Routed |

## 10. Findings outside this journey's scope

- **#2072**: legacy `paige-mcp` `send_invoice` emails a client outside the lifecycle, the provider floor and the
  pre-send gate, and falls back to a link with no route.
- **#1832 (already recorded)**: PC-1 provider floor and protected marker absent.
- **Already recorded in `docs/audits/b-iv-38-connect-posture-2026-07-26.md`:** the dormant storefront destination-charge
  path (§38).
- Voice outbound bypass of the pre-send gate, quiet-hours time-zone fallback, and the dual consent stores are design
  inputs for S5–S7 and are raised with Communications when those slices start. They are not separate defects of
  current behaviour: the human softphone is the only dialer today.

---

## 11. E4-S1 delivery record — "Where this client stands" (2026-10-12)

**What shipped on this branch (not yet merged; not live).**
- Migration `20271026000100_exp04_client_engagement_status_read.sql` adds
  `public.read_client_engagement_status(_expected_tenant_id uuid, _contact_id uuid)`. It is
  SECURITY DEFINER with `search_path` pinned, granted to `authenticated` only (never `anon` or
  `service_role`).
- **Caller scope comes from the session.** The function requires
  `current_user_tenant_id() = _expected_tenant_id`, and it reuses the Sales gate
  `_sales_invoice_actor`: the caller must be an active owner or admin, with that workspace as
  their active workspace. A client from another tenant is refused exactly like an unauthorized one.
- **It composes canonical owners only:**
  - commercial terms come from `tenant_client_agreements`;
  - signing lifecycle comes from `paige_agreements` (body, document path and storage keys never
    leave the database);
  - balances come from `_sales_invoice_balance_rows`, split into manual, provider-live and
    provider-test amounts;
  - open, failed and expired payment requests come from `paige_invoice_provider_operations`;
  - delivery work comes from `plan_items` milestones and tasks (reminders are excluded).
- It adds no table, ledger, store, scheduler or provider call. Its single write is the canonical
  `record_capability_run` receipt, which carries no name or amount.
- Composer: `supabase/functions/_shared/client-engagement/status.ts`. It reuses the canonical
  Collections schedule model (`previewCollectionSchedule`) and holds these invariants:
  - verified (live), recorded by the owner, and test-environment money are kept apart, and test
    money never reduces what is owed;
  - the agreed schedule is kept apart from invoices: `not_yet_invoiced` and `behind_schedule`
    count only invoices that reference the terms;
  - an invoice bound to the terms carries the whole agreed amount (the Sales writer refuses
    anything else), so what is past due on it is taken from the schedule, never from its whole
    balance against its first due date. Two billed invoices bound to the same terms withhold the
    terms figures and raise `terms_invoiced_more_than_once`;
  - in-flight or unknown payment requests are never treated as received;
  - unrecorded facts (disputes, refunds, an "effective" transition, installment allocation) are
    declared as not recorded, never zeroed;
  - unreadable or stale terms withhold the schedule figures; mixed currencies or a truncated
    invoice or terms list withhold **every** money total (invoiced, received, outstanding, past due,
    in progress, behind), never a sum of unlike units or a lower bound shown as a total;
  - a payment request still being prepared is not "in progress", and requests on invoices that
    are paid, void or draft are not counted.
- Data seam: `src/solo/engagement/useClientEngagementStatus.ts`. It is **not mounted** in any
  shell; the Engagement panel waits on the owner's UI review (prototype in
  `assets/exp04-engagement/`). The server's own refusal (42501) becomes a `refused` state, a
  person with no active workspace gets `no_workspace`, and malformed answers log their internal
  code and show only "could not be read".
- **Known limit at E4-S1 merge, resolved by E4-S1b (§13):** "today" was the UTC date. It is now the
  business owner's configured time zone; without one, due and overdue judgements are withheld.

**Correction recorded (§13).** The first version of this slice (`cee47dd7`) proved itself against
a ledger the Sales writer cannot produce: three instalment-sized invoices each naming the $3,500
terms. `_sales_validate_invoice_terms_reference` refuses that (22023); a bound invoice must carry
the whole agreed amount with the deposit as its amount due now. On that real shape the first
composer reported the whole remaining contract as past due ($3,000 instead of $200). The
independent adversarial reviewer found it. The fixture is now writer-legal, the proof checks the
bound invoice against the writer's own validator and checks that the instalment shape is
refused, and past due comes from the schedule. Mutant: restoring the old arithmetic fails
parity ("past due comes from the schedule on the contract invoice, not its whole balance").

**Why a new read instead of the two the plan named (§18).** §5 planned to reuse
`paige_agreement_overview` and the Sales collections reader. `read_sales_collections` is
tenant-wide (no per-client scope) and `paige_agreement_overview` does not carry
`commercial_terms_id`, so neither can answer for one client against one set of terms. The new
read composes the same owners directly. The sealed-signing predicate is the one shared
duplication; folding it into one helper is a follow-up.

**Tier decision (§56/§61) for this read.**

| Tier | Result | Why |
|---|---|---|
| God / Super Admin | Refused unless an active owner/admin member of that workspace | No cross-tenant client read; operators act inside a workspace |
| Agency (own surface) | Refused for sub-account clients | Agencies resell; they do not run a sub-account's client book |
| Solo | Owner/admin: reads | The operator running the business |
| Sub-account | Owner/admin: reads | Same as Solo (§60) |
| Enterprise | Owner/admin of the workspace: reads | Operator use |
| Client / Anonymous | Refused (proved) | Not this surface; the client portal is a separate projection |

No tier-matrix change in this slice: nothing is mounted. The mount slice gates through
`getTierFeatureSet()`/`hasFeature()` (§60) and updates the matrix in the same commit (§66).

**Producer inventory for the `send_invoice` containment (§37).** In-repo references:
`supabase/functions/paige-mcp/index.ts` (the handler and its scope map),
`_shared/paige-mcp/capability-policy.ts`, `_shared/paige-mcp/action-risk.ts`, and the tests
(`managed-invoice-dispatch.test.ts`, `mcp-governed-door.test.ts`). No skill seed, n8n workflow,
cron, trigger or front-end caller names it. External MCP clients now receive
`legacy_invoice_send_retired`, which is the intended refusal.

**Evidence, by class.**

| Class | Evidence | Result |
|---|---|---|
| Database, full schema, rolled back | `supabase/tests/exp04_client_engagement_status.sql` on a fresh local stack (1,278 migrations applied by `supabase start` 2.109.1) | **36/36 PASS**. The bound fixture invoice passes the Sales writer's own terms validator, and the instalment-sized shape is refused (22023). 8 scope refusals: staff member, client-portal user, foreign owner ×2, anon, foreign client, foreign workspace, stale workspace after a switch. Every invoice balance equals an independent sum over `paige_invoice_payments` by evidence class. Signing body and keys never leave. Exactly one receipt, with no name or amount. |
| Source parity (database → composer) | `scripts/proof/exp04-client-status-parity.mjs` composes the owner's actual read and checks it against hand-worked ledger values | **PASS** (17 money fields, 4 invoices, per-invoice past due, agreement, work) |
| Tests bite (§71.4) | Mutant 1 removes the owner/admin gate; mutant 2 folds test money into live; mutant 3 restores whole-balance past due; composer mutants remove each new guard (withholding on truncation/mixed currency, terms-list truncation, signed-over-amendment, double-bound terms, negative receipts, prepared ≠ in progress, requests on paid invoices); hook mutants drop the refusal mapping and the error wrapping | Every mutant FAILS its test; real code restored: PASS |
| Composer unit | `src/__tests__/exp04-client-engagement-status.test.ts` over the captured real read | **15/15 PASS** |
| Read seam unit | `src/__tests__/exp04-client-status-read.test.ts` (RPC mocked) | **5/5 PASS**: composes, 42501 → refused, other errors → unreadable, internal code never shown, scope mismatch refused |
| CI | Both proofs added to `paige-spine-contract › database-contract` | Pending on the PR's exact head |
| Authenticated runtime | — | **UNVERIFIED**: PC-1 not ready (#1832); typed Chat tools are off (INT-346) |

**#2072 containment (same branch).** `paige-mcp` `send_invoice` now refuses
(`legacy_invoice_send_retired`) before any read, provider call, write or audit. The original
defect was worse than first filed: the handler read the invoice **by id alone with the service
role**, with no workspace check, and wrote caller text unescaped into the customer email. The
existing test that required legacy sending to succeed is rewritten to require zero effects; it
fails 7/7 against the old handler and passes 7/7 against the contained one. §58 call-out: this
removes a shipped capability, as directed by the owner on 2026-10-12 ("contain the legacy send
path before any real customer invoice sending"). The governed replacement is
`sales-invoice-delivery`.

**Not in E4-S1 (named, not hidden):**
- Spine/Chat registration of `client_engagement.status`, so PAIGE can answer the status question
  in chat. It follows the #2075 ship-dark pattern and needs Platform Reach review; it is dark
  while INT-346 drains.
- Mounting the panel. This waits on owner UI approval.
- The Fabric business-review roll-up, which is Experience 02's.

## 12. Contracts — documented, NOT activated

None of these transitions or communications runs until (a) the named backend change ships with
its own proof, and (b) the owner authorizes activation. Each contract reuses the one approval
gate (`paige_pending_confirmations`), and records a `record_capability_run` receipt and Rail
event.

### C-1 Signed-agreement effectuation (terms become effective)
- **Trigger:** a `paige_agreements` row reaches `completed` with `sealed_storage_key`,
  `content_sha256` and `sealed_sha256` present.
- **Preconditions, all checked at execution:**
  - same tenant, contact and offer on the signing and the terms;
  - `commercial_terms_id` is not null;
  - terms status is `draft` or `active`;
  - **the terms version that was signed equals the current terms version.**
- **The last precondition cannot be evaluated today.** Signing records no frozen commercial
  snapshot (`signed_terms_compatibility = unverified_no_frozen_commercial_snapshot`; owned by
  #1843). Until #1843 lands, effectuation **refuses** with `signed_terms_compatibility_unverified`
  and PAIGE asks the owner to confirm the terms by hand.
- **Effect:** terms `draft → active` through the existing writer `set_client_agreement_status`,
  plus effective provenance.
- **Backend change, named:** an effective-provenance record (`effective_signing_id`,
  `effective_terms_version`, `effective_at`) on the terms row or a Sales event. No such column
  exists today. This is a new migration, Sales-owned.
- **Authority:** PAIGE proposes. The owner approves one card fingerprinting signing id + version +
  terms id + terms version. It is classified **high**. It is never `auto`: the first activation of
  commercial terms is a commercial commitment.
- **Idempotency:** per (signing id, terms version). A replay returns the original result.
- **Never:** issues an invoice, requests payment or starts onboarding. Those are separate,
  separately approved acts.
- **How it is noticed:** there is no signing-completed event today. Until one exists, PAIGE
  proposes effectuation when the E4-S1 read shows a sealed signing for terms still in `draft`; the
  read itself never writes the proposal (see C-3).
- **Terms already `active`:** effectuation records provenance only and changes no status. If the
  active terms version differs from the signed one, it refuses with
  `signed_terms_compatibility_unverified` exactly as above.
- **A signing voided or declined after effectuation:** nothing is reversed automatically. The
  status read shows the conflict, and PAIGE proposes `active → paused` for the owner to approve.
- **A stale card:** the card's fingerprint is re-checked at execution. Any change to the signing
  or terms version refuses the card and a fresh one is proposed.
- **Bounds:** §67 — never `auto`. §38 — no money moves.

### C-2 Deposit-qualified onboarding (kickoff offer)
- **Qualifying event, evaluated from the E4-S1 read and nothing else:**
  - C-1 effectuation is recorded;
  - **and** the deposit is satisfied: real receipts against the terms
    (`received_against_terms`, provider-verified LIVE plus recorded by the owner) are at least the
    first schedule row's amount, with the evidence class shown on the offer. This is computable
    from the read because the Sales writer puts the deposit on the one invoice bound to the terms
    as its amount due now; no instalment allocation is needed or claimed.
- **Never qualifies:** test-environment money, in-flight or unknown payment requests, a draft or
  void invoice, an unbound invoice.
- **Effect:** PAIGE *offers* the existing `operations_engagement_handoff`. It does not create its
  own project. The owner approves the handoff card, and the handoff stays the single Operations
  writer, idempotent by request id.
- **The owner's own manual handoff is unchanged.** It does not require the deposit, because that
  is the owner's call.
- **Onboarding checklist:** NEW, tenant-authored (Playbook). It is never the retired funding steps
  (§2). It is a separate later slice.
- **Routed to Operations:** the handoff's Solo-only gate refuses sub-accounts (§60/§61 parity).
- **A qualifying receipt later reversed:** an offer not yet accepted is withdrawn. A handoff
  already made is not undone; PAIGE tells the owner the deposit no longer stands and leaves the
  decision to them.
- **C-1 provenance later withdrawn:** the same — no automatic unwinding, an explicit owner choice.
- **Bounds:** §67 — never `auto`. §38 — no money moves.

### C-3 Ask-first payment reminders
- **Source of truth:** the E4-S1 read: outstanding, overdue, due dates, open payment requests.
- **Never propose a reminder when:**
  - the invoice's outstanding is 0;
  - a LIVE payment request on that invoice is in flight or has an unknown outcome;
  - the pre-send gate would block (DND, `paige_suppressions`, missing consent, quiet hours for SMS);
  - the Collections contact window (`_shared/sales-collections/contact-window.ts`, §13) does not
    clear it: the recipient's zone or location is not verified, the jurisdiction's rules are not
    encoded, permission is missing or withdrawn, or it is outside the recipient's local hours;
  - the owner paused follow-ups for the client;
  - **a dispute or promise to pay is recorded.**
- **Disputes and promises are not recorded today.** NEW backend: a collection-outcome record
  (promise / dispute / failed contact / opted out / answered / voicemail), Sales/Comms-owned.
  Until it exists, any client reply on the invoice thread pauses further proposals for that
  invoice until the owner resumes.
- **Channel order:**
  - email first, through the governed `sales_invoice.email_send` (high → confirm);
  - SMS only after the tenant's A2P registration is `approved` and SMS consent is recorded;
  - **AI calls are not authorized** (legal review + owner authorization, §6 STOP).
- **Ask-first, always:**
  - PAIGE drafts each reminder.
  - One confirmation card fingerprints recipient, invoice, amount due and the exact content. Any
    change makes a new card.
  - The owner approves, then the governed delivery sends.
  - Never `auto`: §67, an external send is never covered by an `auto` grant.
- **Timing:** owner policy, for example 3 days before due and 1 day after a miss. The policy is a
  §67 process.
  - **Two clocks, never mixed (owner rulings 2026-10-12):**
    - *which day* an invoice is due or late is the BUSINESS OWNER's configured zone;
    - *what hour* a reminder may reach someone is the RECIPIENT's verified zone.
    A reminder for an invoice that became late on the owner's calendar still waits for the
    recipient's local hours. The recipient's zone is never taken from the owner, a phone prefix
    or a browser.
  - **Backend change, named:** time-based native events `invoice.due_soon`, `invoice.overdue` and
    `payment.received` for `paige-native-event-dispatch`.
  - Until they exist, the panel only *shows* which invoices a reminder would be proposed for.
    Showing writes nothing: no `paige_pending_confirmations` row is created until the owner asks
    PAIGE to draft one. There is no scheduler.
- **Limits:** at most one pending reminder card per invoice, and at most one sent reminder per
  invoice per policy step. A bounce or an invalid address stops further proposals on that
  channel until the owner fixes the address.
- **Pay links in a reminder** follow §38: a link only to the tenant's own connected account
  (direct charge), never a Paige-held charge. Without one, the reminder carries no link.
- **Truth after sending:** provider acceptance is not delivery, and delivery is not payment. The
  status read changes only when the ledger does.

## 13. E4-S1b — the two time zones (2026-10-12)

**Owner rulings (ANT-51 / ANT-147).**
1. Payment due-date, upcoming and overdue classifications use the authenticated business owner's
   configured IANA zone. Never UTC, server time or the viewer's browser. Missing or invalid means
   ask for configuration and withhold definitive overdue claims.
2. The recipient's verified local zone governs outbound email, SMS and AI call timing, subject to
   jurisdiction, consent, quiet hours, preferences and provider rules. Never assumed from the
   owner's location, a phone prefix or a browser. Unknown location, zone or permission means no
   automated contact and a request to verify.

**Grounding (§71).**
- Searched every `public` column named like `%time%zone%` / `%tz%` in production, and grepped
  migrations, `src/` and `supabase/functions` for `timezone`, `time_zone`, `timeZone`,
  `quiet_hours`, `timezone_verified`.
- **Owner side.** The only zone a person sets for themselves is `profiles.coach_timezone` (written
  by `set_coach_fields`, own record or tenant admin). `calendars`, `staff_calendar_settings` and
  `internal_bookings` default to `America/New_York`, so a default is indistinguishable from a
  choice and is not used. Production: 0 of 21 profiles have it set.
- **Recipient side.** `clients.timezone` + `clients.timezone_verified` (Communications,
  `20260726210000`). Production: 0 of 16 set or verified. `clients` has state/city/zip but **no
  country**, so no recipient's jurisdiction can be verified today.
- **Shared gate.** `_shared/pre-send-pipeline.ts` falls back to the business's quiet-hours zone
  and then New York for SMS. Filed to Communications as **#2083**; not changed here.

**What changed.**
- Migration `20271026200000` re-creates `read_client_engagement_status` with everything else
  verbatim. It adds `business_time_zone {state, zone}`, resolved from the workspace's active owners
  (not the caller):
  - `configured`: exactly one distinct zone, and it is in `pg_timezone_names`;
  - `missing`: no owner has one;
  - `ambiguous`: owners disagree;
  - `invalid`: the one zone is unknown.
  `as_of_date` is the owner-local date of the read, null unless configured.
- The composer computes "today" itself from `read_at` and the zone, through the shared IANA helper
  `localDateInZone` (added to `_shared/paige-context/snapshot.ts`, one validator for both uses).
  Without a usable zone:
  - schedule rows' `due`, invoices' `overdue`/`past_due_minor` and `due_to_date`/`behind`/
    `overdue_minor` are null;
  - `business_time_zone_unset` is raised.
  Contractual due dates and payment timestamps pass through unchanged.
- `_shared/sales-collections/contact-window.ts` is the pure recipient-side decision for automated
  collections contact. It reuses the pre-send gate's own window math, now exported with no
  behaviour change.
  - **Order:** calls blocked → opt-out → DND → consent withdrawn → SMS consent missing → recipient
    zone unverified or invalid → location unverified → jurisdiction rules unknown → recipient-local
    hours.
  - Only verified **US** recipients have encoded hours: 08:00–20:00 local, the gate's quiet window.
    Every other jurisdiction is refused until its rules are added deliberately.

**Evidence.**
- **Database proof:** 42/42 PASS. It covers:
  - the owner zone is reported;
  - the owner-local date, checked in UTC+14 and UTC−12, where at any hour one of them differs
    from UTC;
  - an admin configured in Tokyo still gets the owner's New York zone;
  - missing, invalid and ambiguous all withhold the date.
  - Mutant (UTC date): FAILS.
- **Parity:** the database's owner-local date equals the composer's own.
- **Owner-zone unit tests (13):**
  - UTC midnight boundary;
  - the spring-forward and fall-back days and the first midnight after each;
  - Sydney's daylight-saving exit;
  - non-IANA names refused;
  - identical output with the process zone set to Kiritimati, Pago Pago, Kolkata and Los Angeles;
  - missing, ambiguous and invalid withhold every judgement.
  - Mutants caught: UTC fallback, the viewer's local date, unknown treated as "not late", and the
    missing flag dropped.
- **Contact-window tests (8):**
  - one instant across New York, Chicago, Los Angeles and Honolulu;
  - DST both ways plus Arizona;
  - 19:59/20:00 boundaries;
  - a US customer in Berlin;
  - GB and JP refused;
  - opt-out, DND, withdrawn and missing consent;
  - missing, unverified, invalid and offset zones;
  - calls refused.
  - Mutants caught: unverified zone accepted, New York fallback, opt-out ignored, unknown
    jurisdiction cleared, calls allowed.
- **Pre-send smoke:** 15/15 unchanged.

**Still owed.**
- A way for the owner to set their time zone in the product. `set_coach_fields` writes it, but it
  also rewrites capacity, so a dedicated "my time zone" control belongs with the panel mount.
- A verified country or jurisdiction on the recipient record (#2083).
- Per-jurisdiction rules beyond the US.
- The engagement panel's "set your time zone" state, which goes into the mount slice and the
  owner's UI review.

