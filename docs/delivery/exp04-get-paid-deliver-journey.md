# Experience 04 — Get Paid & Deliver My Services: journey inventory, flow map and delivery plan

Date: 2026-10-12 · Journey Lead: Claude Code (one accountable lead) · Records: ANT-51 / ANT-147 · Shell: SOLO

**Status: CHECKPOINT 1 (inventory and plan) + E4-S1 shipped (§11, PR #2074, main `c0a20243`) + E4-S1b time zones shipped (§13, PR #2085, main `4fa99047`) + documented contracts (§12).** Branch `claude/clever-lovelace-r111ru`.
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
| Onboarding after the qualifying event | **EXTEND** | `operations_engagement_handoff` (`20271022000030`, #1992 / #2042) turns a sealed signing plus active terms into one source-linked project with milestones. **It is manual only:** no trigger, no event, no payment condition. It never reads invoices. It is also Solo-only by hard gate (L32), so sub-accounts are refused; that is a §60 parity question for the Operations owner. **Note (2026-10-14): the manual handoff is unreachable today; see §15 F4a.** |
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
  **Note (2026-10-14): that manual handoff is unreachable today; see §15 F4a.**
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
   configured IANA zone. Never UTC, server time or the viewer's browser. If the zone is missing or
   invalid, ask for configuration and withhold definitive overdue claims.
2. The recipient's verified local zone governs when outbound email, SMS and AI calls may go out,
   subject to jurisdiction, consent, quiet hours, preferences and provider rules. Never assume it
   from the owner's location, a phone prefix or a browser. If the location, zone or permission is
   unknown, make no automated contact and ask for verification.

**Grounding (§71).**
- Searched every `public` column named like `%time%zone%` or `%tz%` in production.
- Grepped migrations, `src/` and `supabase/functions` for `timezone`, `time_zone`, `timeZone`,
  `quiet_hours` and `timezone_verified`.
- **Owner side: no zone that only the owner controls existed.**
  - `calendars`, `staff_calendar_settings` and `internal_bookings` default to `America/New_York`,
    so a default can't be told apart from a choice.
  - `profiles.coach_timezone` is a per-person field. `set_coach_fields` lets any tenant admin
    write it for any active member, including an admin of another workspace the owner belongs
    to. `paige-mcp update_coach_profile` writes it with no tenant predicate.
  - The independent review caught this. The first version of this slice read the owner's
    `coach_timezone`; it no longer does.
  - Tenant admins can UPDATE `tenants` directly, so a column there wouldn't be owner-only.
- **Recipient side.**
  - `clients.timezone` and `clients.timezone_verified` come from Communications
    (`20260726210000`). Production: 0 of 16 clients have either set.
  - `clients` has state, city and zip but **no country**.
- **Other paths still on UTC.**
  - The shared pre-send gate falls back to the business zone and then New York for SMS. Filed to
    Communications as **#2083**. The gate is pinned reviewed source and is not edited here.
  - The live Collections workspace and the Sales performance overdue metric compute "today"
    in UTC. Filed to Sales as **#2086**.
  - The ruling applies to those paths too; they are owed, not done.

**What changed.**
- **Migration `20271026200000`.**
  - Adds `public.tenant_business_time_zones`: one row per workspace, RLS on, no direct grants. A
    CHECK allows only `UTC` or an IANA Area/Location name, so abbreviations and fixed-offset or
    legacy names (`EST`, `EST5EDT`, `Etc/GMT+5`) are refused.
  - Adds `public.set_business_time_zone(_expected_tenant_id, _time_zone)`. Only the **active
    owner** of the caller's active workspace may call it.
    - It validates the zone against `pg_timezone_names` when written.
    - Only an explicit null clears it; a blank value is refused.
    - Legacy aliases (`US/Eastern`) are refused in favour of the canonical region name. They do carry
      their region's rules; the point is one comparable spelling.
    - No API role (`anon`, `authenticated`, `service_role`) holds any privilege on the table.
    - It writes one capability receipt.
  - Re-creates `read_client_engagement_status`, otherwise unchanged:
    - it adds `business_time_zone {state, zone}`;
    - state is `configured`, `missing`, or `invalid`. A stored zone that the database can't convert
      (written by a privileged path that bypassed the writer) degrades to `invalid` instead of
      failing the whole read;
    - `as_of_date` is the owner-local date of the read, null unless configured;
    - there is no `pg_timezone_names` scan on read.
- **Composer.** It computes "today" itself from `read_at` and the zone, using the shared IANA
  helper `localDateInZone` (in `_shared/paige-context/snapshot.ts`). Without a usable zone:
  - schedule `due`, invoice `overdue` and `past_due_minor`, `due_to_date`, `behind` and
    `overdue_minor` are all null;
  - `business_time_zone_unset` is raised, and `payment_overdue` and `behind_schedule` are not;
  - contractual due dates and payment timestamps pass through unchanged.
- **`_shared/sales-collections/contact-window.ts`.** The pure recipient-side rule for automated
  collections contact.
  - **Order:** calls blocked → opt-out → DND → consent withdrawn → SMS consent missing →
    recipient zone missing, unverified or not a regional zone → location unverified →
    jurisdiction rules unknown → recipient-local hours.
  - Only verified **US** recipients have encoded hours: 08:00–20:00 local, the pre-send gate's
    quiet window. A test keeps the two equal.
  - The local-time math is two helpers in the shared zone module (`localMinutesInZone`,
    `nextLocalTimeInZone`).
  - **Nothing calls it yet.** Reminders (C-3) aren't built. It is the rule they must pass, proven
    by tests, not an enforced gate.
- **Prototype.** Adds the `nozone` state, which is the state production produces today. The
  panel says "Set your business time zone". Schedule dates aren't split into due and upcoming,
  past due shows "—", and the progress bar shows one "Not paid yet" figure, for screen readers
  too. Task lateness compares timestamps with the read, matching the read's own overdue count.
  Instants are shown on the owner's calendar.

**Evidence.**
- **Database proof: 63/63 PASS.** It covers:
  - no privilege for any API role on the table, and the writer's grants;
  - refusals of an unknown zone (`Mars/Olympus_Mons`, `America/Nowhere`), `EST`, `EST5EDT`,
    `Etc/GMT+5`, `US/Eastern` and a blank value;
  - acceptance of three-level and hyphenated zones;
  - refusals of an owner naming another workspace, an owner of two workspaces naming the
    inactive one, an admin setting or clearing the zone, staff, and an owner who isn't active;
  - an unrecognised stored zone reads as `invalid` and withholds the date;
  - refused writers change nothing;
  - the owner-local date checked in UTC+14 and UTC−11 (at any hour at least one differs from UTC);
  - an admin whose personal profile says Tokyo still gets the business's New York;
  - the foreign workspace's zone is never picked up;
  - missing withholds the date;
  - every change leaves a receipt.
- **Database mutants** (all FAIL the proof):
  - admin can set;
  - UTC date;
  - reads another workspace's zone;
  - no tzdata check on write;
  - no stale-workspace check;
  - no `invalid` fallback on read;
  - blank value clears.
  - Dropping the writer's `status='active'` clause survives. `current_user_tenant_id()` already
    refuses a non-active membership, so the clause is defence in depth and can't be isolated.
- **Parity:** the database's owner-local date equals the composer's own.
- **Owner-zone unit tests (13).** They cover:
  - UTC midnight;
  - both DST change days, and the first midnight after each;
  - Sydney;
  - non-IANA names refused;
  - the same output under four different process zones;
  - missing or invalid withholds every judgement;
  - an unknown state fails closed.
  - Mutants caught: UTC fallback, the viewer's local date, unknown treated as "not late",
    missing flag dropped.
- **Contact-window tests (9).** They cover:
  - one instant across New York, Chicago, Los Angeles and Honolulu, plus three-level and
    hyphenated zones (Indianapolis, New Salem, Port-au-Prince);
  - DST both ways, Arizona, and the 19:59/20:00 boundary;
  - an "EST-verified" recipient refused, so a 20:30 EDT text can't slip through;
  - a US customer in Berlin; GB and JP refused;
  - opt-out, DND, withdrawn consent, and missing SMS consent refused; a collections email with
    no prior opt-in clears;
  - missing, unverified, invalid, offset and non-regional zones refused;
  - calls refused;
  - the window equals the gate's.
  - Mutants caught: unverified zone accepted, New York fallback, opt-out ignored, unknown
    jurisdiction cleared, calls allowed, non-regional zone accepted, email consent made strict,
    third-level zones dropped from the pattern.
- **Pre-send gate:** untouched. An export-only edit first tripped the pinned-source lint and was
  reverted. Smoke 15/15.

**Production (2026-10-13).** Merged as `4fa99047` (#2085). Migration `20271026200000` persisted;
setter and read body md5 equal the repo's (`a0dc183a…`, `9245d6c3…`); EXECUTE `authenticated` only;
table RLS on, no grants, 0 rows. Until an owner sets a zone, this read withholds every invoice and
payment-schedule due/overdue judgement. Delivery-work `overdue` compares two instants and is unaffected;
Collections and the Sales metric still use the UTC date (#2086).

**Still owed.**
- A place in the product for the owner to set the zone. `set_business_time_zone` is the callable
  seam; the control belongs with the panel mount. A Spine/Chat binding so PAIGE can set it on the
  owner's word is also owed.
- A verified country or jurisdiction on the recipient record (#2083), and jurisdiction rules
  beyond the US: state rules, weekends and holidays.
- #2083 (pre-send fallback) and #2086 (Collections and Sales performance on UTC).

## 14. E4-S2 — client standing in chat, and owner time-zone setup (2026-10-13)

**Owner order (2026-10-13).** An authenticated Solo owner can tell PAIGE their business location or
time zone. PAIGE resolves a validated IANA zone, asks the owner to confirm, and the zone is saved through
`set_business_time_zone`, read back, and used for payment due dates. The owner can ask "where does this
client stand?" and get a grounded answer. Explicit guarded admission and an independent security review
are required for any new chat tool. Writes must not bypass INT-346. Acceptance runs on the official QA
account, the owner's existing Solo account (PC-1 superseded), through ordinary customer sign-in.

**Grounding (§71).**
- **INT-346 is still staged in production** (`paige_chat_interactive_rollout.active = false`). Every
  typed Solo turn is interactive (`PaigeAIChat.tsx:1430`), so it runs in conversational mode:
  - only admitted reads are offered;
  - any other tool is refused per call;
  - approvals are refused with 409 `INTERACTIVE_EFFECTS_UNAVAILABLE`.

  A chat-confirmed write therefore cannot run today without changing INT-346. **Decision:** PAIGE resolves
  and checks the zone in chat, and the owner confirms and saves it in Setup. That keeps the owner's own
  confirmed act as the write and leaves INT-346 untouched.
- **Setup had no business time-zone field.** `src/solo/calendar-settings.tsx:133` shows a hard-coded
  label, and no caller of `set_business_time_zone` existed.
- **The live Setup is `SoloBusinessContextSetup`** (`src/solo/settings.tsx:1844`). `SoloSetupView` in
  `settings-setup.tsx` is imported by nothing. An edit made to it first was reverted, and a test now
  proves the section mounts in the live Setup on Business profile only.

**What changed.**
- **Migration `20271029000100`** (renumbered from `20271027000100` so it follows production's newest recorded version; same SQL) adds two reads behind the same owner/admin seat as every Sales read,
  each writing one capability receipt:
  - `read_business_time_zone` returns state, zone, `set_at`, `local_date` and `can_set`.
  - `find_clients_for_status` returns names and status only. `%` and `_` are literal text, an email
    matches only when typed in full, and it returns at most five rows plus a "more" flag.
- **Chat tools**, named for their executors:
  - `read_client_engagement_status` looks the client up by name and reads through the same composer as
    the Engagement seam. Its projection keeps provider-verified, owner-recorded and test money apart,
    prints "not known" or "not added up" instead of zero, and withholds due/overdue judgements without a
    business zone.
  - `read_business_time_zone` reports the setting and checks a proposed zone. It never saves.
  - Both are in the Spine (`client.engagement_status`, `business.time_zone`) and admitted by name to the
    conversational set. The determination is recorded in `docs/delivery/e2-1-readonly-admission-determination.md`.
- **Setup › Business profile › Business time zone.** The owner picks a city, sees the exact zone and its
  local time, confirms, and the control saves and then reads the value back before saying "saved".
  - An admin sees the setting read-only.
  - Matching is by word, so "Denver" never highlights UTC, and each zone is listed once.
  - Focus moves to the confirmation and then to the result.
  - The picker carries the theme.
  - Buttons are visible: the shell's `.paige-solo button` reset flattens Setup buttons, so the override
    is scoped to this section.

**Evidence.**
- **SQL proof:** 94/94 (+31). Twelve mutants are killed (one equivalent mutant is noted).
- **Unit tests:** 27 chat and 12 Setup tests. Twelve mutants are killed.
- **Harness drive** (`scripts/live-drive/setup-business-time-zone-drive.mjs`): every state in both themes
  at the eight Solo frames plus a phone. It also covers pick → confirm → save → read back, the keyboard
  path, the Denver/UTC and duplicate-zone regressions, and the PAIGE composer becoming writable.

**PAIGE Chat "Loading your conversations…" (owner screenshot).** Investigated; filed to the
Conversational Loop lane as #2105.
- It clears when the `paige_chat_threads` list read settles, normally in one round trip.
- Errors stop after 4 attempts (about 7 s of backoff), and chat then opens a new conversation.
- Three paths have no upper bound: a stalled request, the browser being offline, and a hidden tab.
- The harness's permanent "Loading…" was a stub artifact, fixed by gating the stub like the real hook.

**Owed.**
- Authenticated acceptance on the official QA account (`exp04-business-time-zone-acceptance` in
  `scripts/live-drive/flows/solo-governed-flows.mjs`, eight steps), run by the QA lane.
- Saving the zone from chat, once INT-346 is activated, as a confirm-lane capability.
- #2083, #2086 and #2105.


### Release record (2026-10-13)

**Released** to production in PR #2106 → main `6f73ade472d684b0b60fda73b1c0bc9a7511badb` (merged head `d3d792ff`). Exact production readback is in master §4.0.

| Owner can… | State |
|---|---|
| Set the business time zone in Setup › Business profile, confirm the exact zone, and see "saved" only after readback | **Live.** Proven in unit tests and the harness drive (1058/1058); authenticated acceptance owed |
| Ask PAIGE "where does Acme stand?" and get a grounded answer: agreement, installments, verified versus recorded money, outstanding versus genuinely overdue, delivery, next steps | **Live** in conversational turns; authenticated acceptance owed |
| Tell PAIGE where the business is; PAIGE resolves and checks the zone, asks the owner to confirm, and points to Setup | **Live.** PAIGE never claims to have saved it |
| Save the zone from chat | **Unavailable** until INT-346 is activated (separately governed) |
| See due and overdue judged on the business calendar | **Live** once the owner saves a zone; production had 0 configured zones at release |
| Use the Engagement panel | **Unmounted**, pending its own design approval |

**Handoff to the QA lane: authenticated acceptance.**
- **Account and sign-in:** the official Antonio Cook Solo account, by ordinary customer sign-in. Do not use PC-1, Operator access or a new tenant.
- **Flow:** `exp04-business-time-zone-acceptance` in `scripts/live-drive/flows/solo-governed-flows.mjs`.
- **Steps:**
  1. open PAIGE Chat;
  2. the composer becomes usable;
  3. ask to set the time zone ("we're in Chicago");
  4. PAIGE offers `America/Chicago` with its local time and does not claim to save it;
  5. confirm and save in Setup;
  6. "saved and read back" appears;
  7. ask "where does <client> stand?": overdue is now judged on that calendar;
  8. log out and back in: the setting persists.
- **Also check:**
  - verified money is not mixed with owner-recorded money;
  - unknowns are not shown as zero;
  - any action request gets "No business action was run.";
  - the chat composer clears its "Loading your conversations" state (see #2105 if it does not).
- **Safety:** no real payments, messages or provider charges.
---

## 15. Customer Experience Integration Matrix (Engineering 2.0, 2026-10-13)

**The acceptance question for every row:** *can the customer ask PAIGE to do it, see the actual change in the right part of the platform, understand its status, and come back later to verify it?*

**How this was produced.** Four lane mappers (agreements, money, delivery, status and shared components) traced every Experience 04 outcome against `main` at `70ac2547`. A separate adversarial verifier per lane then re-opened every cited line, walked importers to prove each screen is mounted (§71), and repeated the absence greps. Their corrections are folded in below.

**Evidence classes:**
- **Code:** static and mount-chain proof.
- **Production:** read-only aggregates only (counts and catalog metadata, no PII), agent-reported 2026-10-13.
- **Authenticated runtime:** none of these rows has been driven signed in. Every rendered or authenticated claim is **UNVERIFIED** until the QA lane runs (§15.5).

**The two facts that shape the whole matrix:**
1. **Chat can only read while INT-346 is off.** Production has `paige_chat_interactive_rollout.active=false`, and every typed Solo turn is conversational (`PaigeAIChat.tsx:1430`).
   - Only four tools run: `read_business_metric`, `get_business_snapshot`, `read_client_engagement_status`, `read_business_time_zone` (`paige-ai-chat/index.ts:313`).
   - Every Experience 04 *action* tool is withheld from the model, and a call is refused with `CONVERSATIONAL_MODE` (`:10441`). Approvals return `409 INTERACTIVE_EFFECTS_UNAVAILABLE` (`:1224`).
   - So today the owner does F1–F5, wherever a UI path exists, **in the departmental UI**, and uses PAIGE to **read and explain** (F8).
2. **No PAIGE response links to an Experience 04 record yet.** Two chat-to-record mechanisms exist, and both cover CRM only:
   - `PaigeCrmResultCard` renders `record_locator.deep_link` (`exact | surface_only | unavailable`), built by `canonicalAppUrl` (`crm-command/index.ts:380-406`).
   - `approvalOutcome.checkLinks` covers the unconfirmed-approval case (`approvalOutcome.ts:156-205`).
   - `canonicalAppUrl` has no sales, payments, operations or client-standing destination (`_shared/canonical-app-url.ts:21-34`).

### 15.1 Matrix

Status key:
- **LIVE:** works end to end today.
- **PARTIAL:** the UI path works, but chat, link or state is missing.
- **GAP:** no customer path.
- **UNAVAILABLE:** gated by design.

| # | Outcome | Conversation → Spine capability (governed path) | Canonical record | UI component (mounted) | Visible state (server-derived?) | Receipt + reload readback | Status |
|---|---|---|---|---|---|---|---|
| F1a | Terms and the 11-row schedule ($3,500, $500 down, 10 × $300) | "Acme agreed to $3,500, $500 down, $300/month from Nov 1." → `sales_create_commercial_terms` and `sales_save_collection_terms` (high, confirm card) → `execute_sales_collection_command`. **Dark under INT-346.** | `tenant_client_agreements` (+ `collection_terms`/version) | Sales › Agreements (`AgreementEditor`, `sales-ops.tsx:589`), and Sales › Payments › Collections (`CollectionPlanBuilder`, the only screen that authors dated rows) | Draft/Active/Paused/Completed/Cancelled from the row (`sales-ops.tsx:80-87`). "Terms need review" from `terms_current`. Server-derived. | Chat writes `record_capability_run`; the **UI writes no receipt**. Reload re-reads `list_sales_collection_agreements`. A Sales screen that is already open does not refresh after a chat act. | PARTIAL |
| F1b | Agreement drafted **bound to the terms** | "Draft the agreement for those terms." → `agreement_draft` (confirm) → `save_paige_agreement`. Chat always creates it **unbound**; a chat *revise* nulls `commercial_terms_id`/`offer_id`/`document_path` and skips the stale guard (`chat-write.ts:152-158`). | `paige_agreements` | Sales › Agreements (the upload path binds terms) | Signing chips are server-derived | Chat receipt carries **no agreement id** (random runId) | PARTIAL |
| F2a | Send for signature | "Send it to Acme to sign." → `agreement_send` (high, external) → `agreement-send` | `paige_agreements`, signer tokens | `SignatureSender` (`sales-ops.tsx:1175`) | sent/viewed/partially signed/completed/declined from the row | UI send writes no Rail receipt | PARTIAL |
| F2b | Client signs (actor: client) | `/sign/:token` → `sign-agreement` seals server-side | `paige_agreements` (sealed hashes) | `/sign/:token` (`App.tsx:271`). Owner sees `AgreementCompletion`. | Completed only after the seal succeeds | Owner emailed on view/sign/decline (`agreement-activity`). The template's `workspace_url` "Open it in your workspace" slot is **never passed**. | LIVE |
| F2c | Signed terms become **effective** | — no capability. The only writer to `active`, `set_client_agreement_status` (`20270532100000:312-387`), has a client wrapper `setAgreementStatus` (`useSoloCommercialTerms.ts:341`) with **no mounted caller** | `tenant_client_agreements.status` never moves on signing, and nothing mounted can move it | `AgreementCompletion` copy promises a control that is **not mounted**; the writer exists but is unwired (`sales-ops.tsx:1544-1547`) | Read reports "the platform does not record when an agreement takes effect" | — | GAP |
| F3a | Deposit invoice draft | "Invoice Acme the $500 deposit." → `billing_create_invoice` → `sales-invoice-draft-command` (confirm, operator-card fingerprint). **Dark.** | `paige_invoices` (draft) + `paige_invoice_operations` | Sales › Payments › Invoices (`SalesBillingWorkspace` → `useSalesInvoiceDrafts`) | "Draft · not issued" | Chat run receipted; UI save is not | PARTIAL |
| F3b | Issue the invoice | "Issue it." → `sales-invoice-command` publish (one approval store) | immutable snapshot + digest | `InvoiceCommandReview` | approval_required → proposal; "Checking…"; refusal shows server text; "Issued · outstanding". No optimistic state. | Re-read `read_sales_invoice` on complete | PARTIAL |
| F3c | Deliver it to the client | "Email it to Acme." → `sales_invoice.email_send` (high) | `messages` + `meta.sales_invoice_binding` | Clients › Conversations shows the send. The **invoice view shows no delivery state** at all after a send. | Conversation thread only | Provider acceptance `PROOF_OWED` | PARTIAL |
| F3d | Payment request and provider-verified settlement | `payment_request` via `sales-invoice-command` (tenant's own Stripe, Connect direct charge) | `paige_invoice_provider_operations`, `paige_invoice_payments` (provider_verified) | `InvoicePaymentRequests` | Request states named (`customerPaymentRequest.ts:16-29`) | **Stripe TEST settlement UNAVAILABLE.** The customer invoice page strips its token on load, so **a reload or bookmark loses it** (`InvoiceDocument.tsx:20`). | PARTIAL |
| F3e | Owner records money received / corrects it | UI record/reverse via the same door. **Dark in chat.** | `paige_invoice_payments` (manual_recorded) | `InvoiceLifecycleActions` | "Paid · business-recorded" vs provider-confirmed kept separate. **"Record payment" is disabled whenever the request list is still loading or the read failed.** | Re-read on complete | PARTIAL |
| F4a | Kick off delivery from the signed engagement | Owner, in Operations › Delivery → `operations_engagement_handoff` (no chat or Spine capability). Requires active terms **and** `agreement.offer_id = terms.offer_id`; the UI signing path writes `offer_id` NULL. | `plans`, `plan_items` (milestones) + `audit_logs` | `OperationsEngagementHandoff` (mounted via `OperationsDelivery`) | Server-checked eligibility; independent readback | `audit_logs`; reload via `plan_list_operations_scoped` | GAP: **unreachable today**. It requires `active` terms, and nothing mounted sets them (F2c). |
| F4b | "Set up the project and assign the work" in chat | `plan_*` → **legacy unscoped, non-idempotent writers**. Write target mislabelled `tasks`/`plans`. Ordinary risk. **Refused under INT-346.** | `plans`, `plan_items` | Operations › Projects/Work | — | `paige_audit_log` attribution (prod: 0 creates ever) | UNAVAILABLE |
| F4c | Client onboarding checklist / required documents | — | none (`program_document_requests` 0 rows, no caller) | — | — | — | GAP |
| F5a | Track milestones; "how is delivery going for Acme?" | Read via `read_client_engagement_status` (live) | `plan_items` by `contact_id` | Operations › Overview/Work | Overdue compares the `due_at` instant with the browser clock (`OperationsOverview.tsx:16`). That is an instant, not a calendar-date judgement, so the business-zone defect does not apply here. | — | PARTIAL: Operations UI **cannot create client-linked work** (`OperationsWorkCreator` has no client field), so PAIGE says "no delivery recorded" while Operations shows it |
| F5b | Internal review of a deliverable | backend live (#1997/#2015/#2030) | submissions, reviews | `OperationsStaffDeliveryReview` **unmounted** (Operations, #2067) | — | — | GAP |
| F5c | Client accepts through the portal | backend live | releases | `OperationsClientArtifactReview` **unmounted**. 0 clients have `linked_user_id`. | — | — | GAP |
| F6 | Follow up on what's owed | — no due-soon/overdue event, no reminder action in the collections contract | — | Collections register shows **"Past due" from browser UTC** (`CollectionsWorkspace.tsx:37`), contradicting the business-calendar judgement chat uses | — | — | GAP |
| F7 | Client asks "what do I owe?" (actor: client) | — no inbound balance answer | — | Portal has `/app/agreements` and `/app/approvals`; **no billing view** | — | — | GAP |
| F8a | "Where does Acme stand?" | `read_client_engagement_status` + `find_clients_for_status` (admitted read, DEFINER with in-body tenant re-proof; tenant tier only) | terms, signing, invoices by evidence class, payment requests, `plan_items` | **Prose only** in `PaigeAIChat` (`MarkdownMessage`). **No link** to the client or any record; the projection drops `receipt_id`, `signing_id` and the work-item ids it already has. | Step line persists across reload (`turn_trace`), **but a refused/unavailable/needs-input read is persisted as "done"**: the result has no `success:false`, so `toolResultReportsFailure` misses it (`index.ts:332`) | `record_capability_run` per read; the Rail shows a generic "Completed a step for you" | PARTIAL |
| F8b | See the same standing **in the platform** | — | same | **No mounted view.** Engagement panel unmounted (`useClientEngagementStatus` has no importer). Client record shows "Engagement progress · UNAVAILABLE" and hard-coded proof pills. The Collections client name opens the invoice, not the client. | — | — | GAP |
| F8c | Owner sets the business time zone | Setup › Business profile → `set_business_time_zone` (owner only, validated) | `tenant_business_time_zones` (also read by Exp05) | `BusinessTimeZoneSetting` (mounted, `SoloBusinessContextSetup.tsx:1389`) | idle/confirm/saving/saved-after-readback/stale/no-workspace, all server-derived | Save proven by DB readback. **But every Setup page load writes a `read_business_time_zone` receipt, and the Rail credits the owner's own save and loads to "Paige did this for you."** | LIVE (attribution REPAIR) |
| F8d | "We're in Chicago" in chat | `read_business_time_zone` + resolve/check; says it is **not saved** and points to Setup | — | prose + Setup | — | the chat receipt is indistinguishable from a Setup page-load receipt (no channel field) | LIVE as designed; save UNAVAILABLE |

### 15.2 Gap register (REUSE / EXTEND / REPAIR / NEW)

Ordered by how directly the gap blocks the acceptance question **today**: rows reachable now come first, then rows that block INT-346 activation, then the rest.

| P | Gap | Class | Owner lane | Reuse target / evidence |
|---|---|---|---|---|
| 1 | Refused/unavailable client-status reads persist as "done" in the step line | **REPAIR** | Exp04 (coordinate with Exp02: `read_business_metric`/`get_business_snapshot` use the same `{status,message}` shape) | Return `success:false` for non-`available` statuses; do not fork `toolResultReportsFailure` |
| 2 | Chat client-status answer has no link to the client or records | **EXTEND** (shared) | Exp04 + shared chat (Exp01–05) | Generalise `record_locator` / `canonicalAppUrl` with a client destination (`?person=` precedent) and render a read-result link. Do **not** reuse the mutation-worded `PaigeCrmResultCard` unchanged. One shared convention, not a per-experience card. |
| 3 | Setup writes a PAIGE-attributed receipt on every page load; owner saves are credited to PAIGE | **REPAIR** | Exp04 (coordinate Exp05, which reads the same store) | Extend `_workspace_event_display` with human-actor wording (Exp05 wrapper pattern `20271028000000:47-64`); stop receipting the Setup page-load read |
| 4 | Collections "Past due" judges the browser UTC date while chat uses the business calendar | **REPAIR** | Sales (#2086), Exp04 coordinating | Read the business zone through `read_business_time_zone`; withhold when unset, as chat does |
| 5 | Client record shows no commercial/payment/delivery standing | **NEW (mount) + REUSE (read)** | Exp04, **owner design approval required** | Mount the existing `read_client_engagement_status` read on Clients › People through Flow-by-Flow → Impeccable. Reuse `SIGNATURE_STATE`/`AGREEMENT_STATE` vocabulary and `StatePill` (0 Solo users today; the client record forks a hard-coded `ProofPill`). |
| 6 | Operations UI cannot create client-linked work, so chat and UI disagree | **EXTEND** | Operations, Exp04 coordinating | Add the client field the scoped creator already accepts (`operations-work-create.ts:6,33`) |
| 7 | A chat agreement revise destroys the terms binding and skips the stale guard | **REPAIR, blocking INT-346 activation** | Sales/Agreements | `chat-write.ts:152-158` vs `save_paige_agreement` |
| 8 | Chat `plan_*` use legacy unscoped writers; write target mislabelled | **REPAIR, blocking activation** | Operations / Conversational Loop | Route to the scoped writers (`20271020000210`) |
| 9 | Chat receipts for agreements carry no record id; UI acts write no receipt | **EXTEND** | Sales + shared receipts | `record_capability_run` with the record reference; one ledger |
| 10 | Terms never become `active`; `AgreementCompletion` copy promises a control that is not mounted (§13) | **REUSE** (mount the existing `setAgreementStatus` writer, which C-1 names) **+ REPAIR copy**. The effectuation provenance record stays **NEW** per C-1. | Sales (C-1 contract, §12) | `useSoloCommercialTerms.ts:341` (no mounted caller); `20270532100000:312-387` |
| 11 | F2 → F4 handoff blocked twice: UI signing writes `offer_id` NULL, **and** terms never leave `draft` (gap 10), so repairing either alone unblocks nothing | **REPAIR** | Sales/Operations seam | `20270404000000:68`; `20271022000030:42-58` (requires `active` terms and an offer match) |
| 12 | Owner signing emails lack the workspace link | **REUSE** | Sales | Pass the existing `workspace_url` slot |
| 13 | Invoice view shows no delivery state | **EXTEND** | Sales/Comms | Reuse the `governedSend` projection of `meta.sales_invoice_binding` |
| 14 | Customer invoice page cannot be reloaded or bookmarked | **REPAIR** (design decision on token lifetime) | Sales/Payments | `InvoiceDocument.tsx:7,20` |
| 15 | Terms and the dated schedule are split across two screens | **EXTEND** | Sales | Deep-link to `CollectionPlanBuilder initialAgreementId`; no third editor |
| 16 | An open departmental view does not refresh after a chat act | **REUSE** | shared | `paige:turn-settled` (consumed by Marketing) / `paige:catalog-offers-changed` patterns |
| 17 | Due-soon/overdue events, reminder action, outcome taxonomy | **NEW** | Exp04 + Comms + §67 Process Records | REUSE `contact-window.ts` (tested, "NOTHING CALLS THIS YET") and the client-status composer; no second scheduler |
| 18 | Client's own balance question; portal billing view | **EXTEND** | Exp04 + Portal | Sibling of `/app/agreements`; identity-verified |
| 19 | Onboarding checklist; delivery review and acceptance mounts | **NEW / REPAIR mount** | Operations (#2067) | — |
| 20 | Stale Spine `humanSurface` `/sales/terms` (no such tab); agreement-wording third home in `document_generate` (§18) | **REPAIR** | Sales | `sales_collections.ts:22`; `index.ts:7097-7103` |

### 15.3 Shared components (coordinate across Experiences 01–05, do not fork)

| Component | Where | Rule |
|---|---|---|
| Chat → record link | `record_locator` + `canonicalAppUrl` + `PaigeCrmResultCard` (CRM only); `approvalOutcome.checkLinks` (unconfirmed only) | Extend the one locator with new destinations (client, sales, payments, operations) and a read-result rendering. No per-experience link cards. |
| Approval card | `PaigeConfirmCard` / `paige_pending_confirmations` | One gate. Its states come from the server `paige_approval_outcome` frame. |
| Turn step line | `_shared/paige-turn/step-start.ts`, `toolResultReportsFailure`, persisted `turn_trace` | Read tools must report failure through `success:false` so refusals never persist as "done". |
| Execution-state pill | `src/components/ui/page/StatePill.tsx` (55 users, 0 in Solo) | Map proposed / awaiting approval / processing / completed / failed / unavailable onto it instead of local hard-coded pills. |
| Receipts → Rail | `record_capability_run` → `paige_workspace_events` → `get_solo_rail_activity` | One ledger. Each experience extends `_workspace_event_display` (Exp05 pattern). Human acts are never credited to PAIGE. |
| Client standing read | `_shared/client-engagement/status.ts` + `chat.ts` | The single per-client truth. Exp02 review, F6 reminders and F7 answers consume it; they do not re-derive balances. |
| Business time zone | `tenant_business_time_zones` via `read_business_time_zone` | Shared with Exp05. Any date judgement on the business calendar reads it. |
| Departmental views | Sales (`SalesWorkspace`), Operations (`OperationsWorkspace`), Finance (`FinanceWorkspace`, no chat reach), Clients (`TenantRelationshipsClientsWorkspace`) | Outcomes land in these existing homes. No new department surfaces. |

### 15.4 Tier scope (§56/§60)

- The Experience 04 chat reads are offered only when `callerTier==='tenant'` (`paige-ai-chat/index.ts:8198`), so Agency, Enterprise and Operator chats never see them.
- The engagement handoff is Solo-only by hard gate, so sub-accounts are refused; the §60 parity question stays with Operations.
- Neither restriction changes in this record.

### 15.5 Added to the existing authenticated QA case (issue #2119, does not replace it)

On the official Antonio Cook Solo account, after the existing time-zone steps:

1. Ask "where does <client> stand?". Record:
   - whether the answer offers a way to open the client or its invoices (expected today: **none**, per gap 2);
   - which departmental view shows the same facts (expected: Sales › Payments for invoices, Operations for work; the client record shows **none**, per gap 5).
2. Compare overdue in that chat answer with Sales › Payments › Collections "Past due" for the same client (gap 4). Report any disagreement.
3. Ask about a client that is not in this business. The step line must not read as a completed check (gap 1). Reload, and confirm it is still not shown as done.
4. Open Setup › Business profile twice, then open the activity view. Record whether the page loads appear as "Paige did this for you" (gap 3).
5. Ask PAIGE to "send Acme a reminder". It must say no business action was run, and nothing may appear in Sales, Conversations or the Rail.
6. Log out and back in. The chat transcript, its step lines and the saved zone must all be the same as before.

Steps 1–4 are **expected to surface known gaps today**. They record the baseline that the next slice must turn green.

### 15.6 Next slice (proposed): E4-S3 "See it, then verify it"

This slice closes gaps 1–4 for the one outcome that already reaches customers (F8):
- refusals shown honestly;
- a link from the chat answer to the client and its records, through the shared locator;
- correct Rail attribution;
- Collections overdue on the business calendar.

Gap 5, mounting the client standing on the client record, needs an Impeccable design that the owner sees and approves first. It runs as a prototype in parallel. Gaps 7–8 are recorded as **blocking INT-346 activation** for the Conversational Loop owner.

### 15.7 Must-fix prerequisites before consequential Chat activation (owner direction 2026-10-13)

These two defects are dormant today, because INT-346 withholds every action tool. They become live defects the moment consequential Chat actions are admitted. Each is classified as a **prerequisite**: INT-346 must not admit the affected tools until it is fixed and independently reviewed.

| ID | Defect | Class | Owner lane | Exit condition |
|---|---|---|---|---|
| PRE-1 | **Agreement-terms integrity.** A Chat `agreement_draft` revise rewrites a bound draft through `save_paige_agreement` without `_commercial_terms_id`, `_offer_id`, `_body_source` or `_expected_updated_at`. It nulls the terms binding, switches the source to `paige_draft`, nulls `document_path`, and skips the stale-write guard (`chat-write.ts:152-158`; `20270401000000:827-845`). | **REPAIR (prerequisite)** | Sales / Agreements | A Chat revise preserves the binding and fails closed on a stale version, proven by a test that fails on today's code |
| PRE-2 | **Legacy project-writer authorization mismatch.** Chat `plan_create`, `plan_add_milestone`, `plan_assign_task` and `plan_update_item` call the legacy unscoped, non-idempotent writers (`paige-ai-chat/index.ts:16207-16239`), not the scoped writers the Operations UI uses (`20271020000210`, `20271020000020`). Their write target is also mislabelled (`tasks` / `plans` for `plan_items`), so any record link built on it would open the wrong surface. | **REPAIR (prerequisite)** | Operations / Conversational Loop | Chat planning routes through the same scoped writers and authority checks as the UI, with the correct write target, proven by an authority test per tier |

## 16. E4-S3 — "See it, then verify it" (PR alpha, 2026-10-14)

**What this PR is.** The cross-track contract (critique §1) PR-0 + PR-1 + PR-2 as one PR. It closes gap 1 (the step line), gap 2 (chat → record links) and the owner half of gap 3 (Rail attribution of the owner's own time-zone save) for F8 — the one Experience 04 outcome customers can reach today. It does **not** activate anything: INT-346 stays inactive, no action tool is admitted, nothing sends, charges or changes a customer obligation.

### 16.1 What alpha delivers

| Outcome | Change | Where |
|---|---|---|
| **Truthful step line (gap 1)** | `toolResultReportsFailure` reads the closed read envelope through a strict `readEnvelopeStatus` (no `success`/`ok`, a `message`, one of the four statuses). `describeStep` withdraws a `needs_input` or `refused` read (nothing was read; PAIGE's reply asks or refuses) and words `unavailable` as the failure it is, which persists and reloads as "Problem:". A finished read now says "Checked where that client stands" / "Checked your business time zone". No producer changed; `_shared/analytics-metrics/read.ts` (C0b-pinned) is untouched. **Exp02 effect, stated plainly:** the envelope rule is the shared contract posted on Linear ANT-147 (comment `30c1d2fd`, 2026-10-14, item 3), and it also changes how Exp02's `get_business_snapshot` and `read_business_metric` steps render: a `needs_input` or `refused` answer is now withdrawn (no row), and an `unavailable` answer is now an error row. Their wording is untouched — `get_business_snapshot` keeps "Taking stock of your business", and `read_business_metric` keeps the generic label it had before. **Withdrawn pending Exp02:** the `read_business_metric` FINISH case and its START label in `step-start.ts` were Exp02-owned labels with no Exp02 sign-off, so they are not in this PR; Exp02 adds them when it chooses. | `paige-ai-chat/index.ts` (top level) |
| **Chat → record links (gap 2)** | One route home: `_shared/canonical-app-url.ts` gains `sales_agreements`, `sales_invoices`, `sales_collections`, `operations_work`, `business_time_zone` (Solo only) and `resolveCanonicalRecordLink` (exact via a UUID-only focus parameter — `?person=` for a client — inserted before any `#fragment`; surface-only otherwise; null where nothing is mounted). One frame home: `_shared/paige-turn/record-links.ts` (references only: destination, a client id and name; de-duplicated, capped at six). An `available` client-standing read carries `standingRecordLinks` (from the new pure `_shared/client-engagement/labels.ts`); an available time-zone read links to the setting. The read branch strips the links before the tool result reaches the model, emits one `paige_record_links` frame through `emitContent`, and persists `bundle_ref.paige_record_links` (never a path, URL, readback or locator; never replayed into model history). A withheld, superseded or Live-interrupted turn keeps no read links: they went with the discarded frames, so no links-only assistant row is saved. **Deliberate exception:** a turn that fails after an available read (the "I hit a snag" fallback) keeps its read links, as it keeps its other cards, because the read genuinely happened and the links point at the records it read. The chat renders them from the live frame and again on reload, built from the CURRENT account by `src/lib/links/workspaceLinks.ts` (tier via `isSoloStandalone` / `resolveTierKey`; frozen labels) and drawn by the approval card's own `CheckLinks`, moved unchanged, inside one `role="group"` per answer named by its visible lead line ("See it in your workspace") — not one navigation landmark per message. "Open business time zone setting" lands on the setting: `SoloBusinessContextSetup` scrolls the `#business-time-zone` section into view (no animation under reduced motion) and focuses its heading once it renders, and again when the hash changes. | `canonical-app-url.ts`, `record-links.ts`, `labels.ts`, `chat.ts`, `index.ts` (read branch, metadata, emit), `workspaceLinks.ts`, `CheckLinks.tsx`, `PaigeRecordLinks.tsx`, `PaigeAIChat.tsx` |
| **PAIGE's read receipt at the executor (gap 3, PAIGE half — dormant)** | The dispatchers report each governed read that ran (`ctx.onRead(key, serverRecorded)`). The executor writes exactly one service-role `record_capability_run` (key = the tool name, `runId` stable per thread and tool call, `detail.channel='paige_chat'`) only for an `available` answer and only when that SAME read's SQL did not already write its own receipt (a name search's receipt never stands in for the status read's). While the SQL readers still receipt (until PR beta), this never fires — no double receipt. `ClientEngagementStatus.receipt_id` is `string \| null`; the parser accepts a missing or null value and still refuses any other type. No consumer branches on it. | `chat.ts`, `status.ts`, `index.ts` |
| **The owner's save reads as the owner's (gap 3, owner half)** | Migration `20271031004000`: one more link in the display wrapper chain (`_workspace_event_display_before_exp04_owner_attribution`). Only `set_business_time_zone` changes: `actor_type 'owner_staff'`, "Business time zone changed". The three read keys are untouched until PR beta (contract B2). The Solo Rail list labels a recorded person "Person" (`useSoloActivityFeed.byPerson`, `compass.tsx`). | migration, `useSoloActivityFeed.ts`, `compass.tsx` |
| **PR-0 moves** | `labels.ts` (the chat label maps, byte-identical, plus `NOT_RECORDED_TEXT`, `ATTENTION_DESTINATION`, `standingRecordLinks`); `src/solo/sales/agreementVocabulary.ts` (`AGREEMENT_STATE` / `SIGNATURE_STATE` from `sales-ops.tsx`); `src/components/chat/CheckLinks.tsx` (`ApprovalCheckLinks` from `PaigeAIChat.tsx`, classes unchanged — §28). | as named |

**C0b.** The handler edits change all 29 incumbent fingerprints (the pinned identity prefix spans the handler), and `canonical-app-url.ts` is a pinned source. Every base pin was confirmed against `origin/main` before the first re-pin; no incumbent's relative imports changed. The review fixes (interrupt-path link clear, same-read receipt guard, exported focus inserter) moved them again: the alpha pins were first confirmed 29/29 against the pre-fix `index.ts`, every delta was confirmed to sit only in the `identity` component (the single `serve()` `try { const authHeader … }` statement), and they were re-pinned once more. The non-author reviewer must confirm the `index.ts` diff touches only the read branch, the turn metadata, the round-loop capture, the withheld-turn clear and the emit line.

**Impeccable on a touched file.** Adding the "Person" label touched `src/solo/compass.tsx`, so its pre-existing Impeccable findings became this PR's (CI: "touch a file, own its findings"): four notices above the Trust Compass instrument drew a 3px coloured side stripe (the side-tab tell). The stripe is removed; each notice keeps its tinted shield icon, its role and its words. No capability, control or copy changed (§58). It is a wording-neutral visual change, rendered before and after in both themes (evidence record); the owner should still judge it on the live Trust Compass.

**Tier (§56/§60).** The reads are offered when `callerTier==='tenant'`. A child typed `account_type='sub_account'` resolves to `tenant` too (critique A1), so it gets the answer and the references; the client resolver gives it the Clients list only (`/business/{a}/clients/people`, surface-only) and nothing else, because the sub-account tree mounts none of the Sales, Operations or Setup surfaces. A legacy standalone-typed child resolves to `subaccount` and is not offered the reads (handler check). Agency, Enterprise and God/Operator: not offered; the resolver returns nothing for them. Client and Anonymous: no chat tool.

### 16.2 Evidence (kept apart)

- **Automated (unit/render):** step truth, route builder, frame reader, labels, dispatchers, parser, workspace links, the chat's live and reload rendering, the Compass "Person" label — each written failing first and proven to fail on `origin/main`.
- **Handler (node, real `paige-ai-chat` handler, stubbed providers):** `scripts/int346-conversational-handler-check.mjs` E4-S3 scenarios (no-match, unavailable, available client, server-recorded, a search-only receipt, time zone, subaccount tier, superseded turn). Each assertion was falsified by reinstating its defect (§71.4). `scripts/client-memory-authz/check.mjs` 26.10 drives a signed Live read turn interrupted before any answer and asserts no links-only row; that one pins the outcome but does not bite on the link clear alone, because an admitted read already protects the turn and the protected Live path saves nothing (measured). The clear itself is pinned by a unit on the real Live catch block (`n5-client-prompt-denylist.test.ts`: the read links are empty when `assistantTurnMetadata()` runs), which fails when the clear is removed.
- **SQL:** a focused bare-PostgreSQL proof of the wrapper (real base display + real Exp05 link + this migration applied twice): 14/14 PASS, and FAIL without the migration. The full-schema assertions are added to `supabase/tests/exp04_client_engagement_status.sql` (CI `database-contract`); they were **not run here** (no Supabase stack in this environment) — **UNVERIFIED** until CI runs them.
- **Rendered (harness, stubbed providers — not the deployed app):** `record-links-drive.mjs` rendered 24 frames of the real `PaigeAIChat` (the 16-frame Solo matrix, plus phone, sub-account and no-match, in both themes): 0 page errors, no sideways overflow, no gold, link contrast 14.99:1 (light) and 16.45:1 (dark), lead-line contrast 5.47:1 and 7.7:1, link targets at least 28px (48px where a label wraps in the 1024 and 900 docked panels); re-rendered after the review fixes with the row as a named group. `compass-mount/notices-drive.mjs` rendered the Trust Compass notices before and after the side-stripe removal in both themes and at phone width (see the evidence record).
- **Authenticated runtime:** **UNVERIFIED, owed.** No signed-in session ran. Owed: §15.5 steps 1, 3, 4 and 6, plus one sub-account walk (§51.5).

### 16.3 What remains for PR beta (and after) — delivered in §16.4 except where §16.4 says otherwise

- **SQL readers stop receipting** (`read_business_time_zone`, `find_clients_for_status`, `read_client_engagement_status`): recreate them without the receipt, and in the **same migration** recreate this wrapper with the read-key PAIGE wording. Gate: `/edge-drift` shows this PR's `paige-ai-chat` live first, so the executor receipt takes over in the same deploy order (critique §1, risk 2).
- **Collections on the business calendar** (gap 4, C1): "Overdue" / "On hold", the business zone, the Setup hash landing. ~~Gate: PR beta persisted on production.~~ Superseded: the SQL change, Collections and the client record ship as ONE PR (§16.4), so there is no separate gate to wait on; the short window between the frontend going live and the migration applying is described, and checked after merge, in §16.4 "Deploy order".
- **Client standing on the record** (gap 5, Track D): consumes `labels.ts`, `ATTENTION_DESTINATION` and `workspaceLinks.ts`. Built and shipped under the owner's 2026-10-13 authorization (routine design is not held for review); final owner acceptance follows the integrated delivery.
- **Not changed here:** the Spine `client-engagement` domain text still says each read writes one receipt — true until PR beta, which updates it with the SQL. Sales and Operations links are surface-only until those surfaces read a per-record focus parameter (gap 15). Persisted links carry the client's display name (≤ 80 characters) beside the prose that already names them.

### 16.4 PR beta — display reads write nothing; Collections and the client record judge on the business calendar (2026-10-14)

**What this PR is.** Critique §1 PR-3 + PR-4 (C1 only) + PR-5 as one PR, on top of PR alpha (merged as #2129; `edge-live` and `db-live` both at `50c32a605`, read from the remote tags on 2026-10-14). It closes the PAIGE half of gap 3 (Rail attribution), gap 4 for Collections (C1; the Sales metric C2 is a separate Sales-lane PR) and gap 5 (standing on the client record). Nothing is activated: INT-346 stays inactive, no action tool is admitted, nothing sends, charges or changes a customer obligation.

| Outcome | Change | Where |
|---|---|---|
| **A page that only shows a setting or a client writes nothing (gap 3, PR-3)** | Migration `20271031005000` recreates `read_business_time_zone`, `find_clients_for_status` and `read_client_engagement_status` with the same signatures, SECURITY DEFINER, pinned `search_path`, in-body caller checks (`current_user_tenant_id()`, `_sales_invoice_actor`, client-in-tenant, search bounds and LIKE escaping) and responses — minus the `run` id, the `PERFORM record_capability_run` and the `receipt_id` key. Grants re-asserted: `authenticated` only, never `PUBLIC`/`anon`/`service_role`. In the **same migration** the PR-alpha display link is `CREATE OR REPLACE`d (no second rename): PAIGE's two chat reads read "Checked your business time zone" / "Checked where a client stands", credited to PAIGE, "Nothing was changed"; the owner's save stays "Business time zone changed" by Person. `find_clients_for_status` gets no copy — nothing writes that key any more. From this migration on the alpha executor receipt is the only writer: one Rail line per answered chat question, none for a Setup load, a Collections visit or a client-record open. `set_business_time_zone` keeps its receipt and `receipt_id`. | migration, Spine `client-engagement.ts` text, Setup harness stub |
| **Collections "Overdue" on the business calendar (gap 4, C1)** | `businessCalendarDay` / `useBusinessCalendarDay` (`src/solo/data/useBusinessTimeZone.ts`) compute "today" from the saved zone with the composer's own `localDateInZone` — never UTC, never the browser's zone — and re-judge every minute and on return to the tab. Collections renames **"Past due" → "Overdue"** (a wording change, not a removed capability — §58) and judges it with PAIGE's strict `<` on the server's own owed flag (`collection_required`: issued or recorded with a balance), so a draft or void is never overdue, upcoming or outstanding. A late row reads "Overdue · {date}". Without a usable zone both judgements read **"On hold"** — never 0 — with the frozen note said **once**, on the Overdue tile ("Set your business time zone" when the viewer may set it, otherwise "Until the business owner sets the business time zone"; "The saved business time zone isn’t recognised" for an invalid zone — one shared helper, `businessCalendarHeldNote`, also feeds the client record), one status notice and one action (Set / Open the business time zone setting, or Retry when the zone could not be read), and the obligations aside becomes "Open obligations by due date", unclassified. The action opens the one Setup address through `routeLinkTarget` (the shared route map; Sales' own unsaved-entries guard runs first). The coverage line names the calendar in people's words — "Due dates follow your business calendar · Central Time (Chicago) · today Oct 13, 2026." — through the zone-naming helpers Setup already used (`genericName` / `placeName`, moved beside `useBusinessCalendarDay` so there is one home); the register's ISO due-date column is unchanged. If any loaded invoice does not carry the server's owed flag (an older page shape the decoder tolerates), **Outstanding, Overdue and Upcoming are all "On hold"** with "Some invoices don’t say whether they’re still owed" — never $0.00 or 0. It also **counts any older invoice with a legacy status (sent / paid) that it does not judge** — the client record and PAIGE count those (critique C3). | `useBusinessTimeZone.ts`, `CollectionsWorkspace.tsx`, `api.ts`, `collections.css`, `SalesWorkspace.tsx`, `workspaceLinks.ts` |
| **Where the client stands, on the client record (gap 5, PR-5)** | "Where {client} stands" is the first section of the Solo client record (Clients › People › a client), so chat's exact `?person=` link lands on it. It mounts the existing `useClientEngagementStatus` read (now receipt-free) and the shared composer, and shows a four-row ledger — each row names itself, with its state pill on the same line (name left, pill right in the ≈425–455px record pane at 1366–1536, as the record's own section headers do; the state | fact | action columns when the record is full width) and never a pill stacked above the name — **Agreement** (the Sales signature words — "Completed", never "Signed" — kept apart from the engagement's "Terms: Active"), **Money** (paid · verified by the payment provider, recorded by the owner · not provider-verified, outstanding, overdue; test money only on its own line, never summed; payment requests in flight never counted as paid; a total that cannot be added up says why, never $0), **Delivery** (done of total, blocked, overdue, what is next) and **Next steps** (the SAME sentences PAIGE says, at most three, then "Show N more", which reveals the rest in place, and "Ask PAIGE about {client}"). Without the business zone, overdue is "On hold until the business time zone is set" with the one link to the setting (an invalid saved zone reads "On hold: the saved business time zone isn’t recognised" instead), and the held Overdue spans the money grid so the sentence and the link each get a line, the arrow kept on the link's last word. Without the zone no timestamp is printed as a business date: sent, completed and next-due dates read "not shown until the business time zone is set", as PAIGE's chat does (`at()` in `chat.ts`); bare calendar dates still show. States: skeleton on the first read only — "Check again" keeps the last answer on screen at full ink (nothing is dimmed below AA), `aria-busy`, announced as "Checking again…" through a `role="status"` line, with the button disabled, until the new one lands — a teaching empty state ("Nothing commercial is recorded for {client} yet." → "Set up terms"), an owner/admin refusal with no retry, a no-workspace line, and an alert that says nothing is shown as zero, with "Try again" as its one retry (the header's "Check again" is hidden there). Links come only from the shared route map and frozen labels for the Solo tree. Pills are the shared `StatePill`; no gold; links and focus in the indigo violet. The Portal tab's "Engagement progress · UNAVAILABLE" card is **not** changed: it describes the client-visible portal home, which this read does not feed (critique D6, §58). | `ClientStanding.tsx`, `client-standing.css`, `TenantRelationshipsClientsWorkspace.tsx`, `useClientEngagementStatus.ts` (comment) |

**Tier (§56/§60).** `client_standing` is declared for Solo, Sub-account and Enterprise (a §61 exception with `agreement_signing`'s reason: it reads a direct client book) and **mounted only on the Solo client record**. Sub-account and Enterprise are **declared, not mounted** — a sub-account's People view is the legacy table and Enterprise renders the "relationships" variant — a recorded §60 parity gap, pinned by a test. The chat read is reachable from a `sub_account`-typed child (critique A1), which is the same gap seen from the other side. Collections is Solo-only (the sub-account tree mounts no Sales). Agency, God/Operator, Client and Anonymous: N/A.

**Deploy order (§37).** Every consumer already tolerates the missing `receipt_id` (alpha's parser; Setup never read it; the chat dispatcher reads only `matches`/`more`). The edge prerequisite is met: alpha's `paige-ai-chat` is live (`edge-live` = `50c32a605`), so client-standing answers will not fail closed when the migration applies.

**The frontend can go live before the migration applies.** Vercel ships the merge while `deploy-migrations.yml` applies `20271031005000` separately. In that window — or for as long as the migration apply is delayed or fails — the old readers are still in place, so **any Setup visit, Collections visit or client-record open writes an old-style receipt** (`read_business_time_zone` / `read_client_engagement_status`, `detail` without `channel = 'paige_chat'`). Once the migration lands those rows render with the new wording as PAIGE's chat read, which they were not. The ledger is append-only, so they cannot be removed; they are measured and reported instead. **Post-merge readback (owed, §32):** (1) `schema_migrations` contains `20271031005000`; (2) `pg_get_functiondef` of the three readers contains no `record_capability_run`; (3) `SELECT capability_key, count(*) FROM public.paige_workspace_events WHERE source_kind = 'capability_run' AND capability_key IN ('read_business_time_zone','read_client_engagement_status','find_clients_for_status') AND occurred_at >= '<merge time>' AND coalesce(detail->>'channel','') <> 'paige_chat' GROUP BY 1` — any non-zero count means the window was hit, and the count and time range are recorded here as a §13 note.

**Released and read back (2026-10-14).**
- **Merge:** #2136 squash-merged as main `d5a8e6e76` at 04:33:57Z. Remote `edge-live` and `db-live` both moved to `d5a8e6e7`, and the Vercel production deployment `dpl_7b1efHhN…` for that SHA is READY.
- **Production (read-only aggregates):**
  1. `schema_migrations` contains `20271031005000`, now the latest version.
  2. The definitions of `read_business_time_zone`, `find_clients_for_status` and `read_client_engagement_status` contain no `record_capability_run`. Each is still SECURITY DEFINER, executable by `authenticated`, and not by `anon`.
  3. The display wrapper carries the new read wording ("Checked where a client stands") and is not executable by `authenticated`.
  4. The deploy window was **not hit**: 0 rows for those keys with `occurred_at` ≥ the merge time and no `channel = 'paige_chat'`. All-time there is still exactly the 1 historical `read_business_time_zone` row described below.
- **Doc correction (§13):** the query above originally named `created_at`. The table's timestamp is `occurred_at`; the query has been corrected.
- **Still owed:** authenticated runtime on the Solo QA account (issue #2119).

**Historical row (§13).** The single `read_business_time_zone` receipt already on production (2026-10-13, most likely a Setup load, `detail` NULL; production otherwise had 0 rows for these keys and for `set_business_time_zone`, read-only query) now renders as "Checked your business time zone — PAIGE read this setting to answer you in chat." The display wrapper cannot see `detail.channel`, so it assumes the source rather than proving it. The ledger is append-only; it is left as is. A later slice can pass `detail->>'channel'` to the display and use the PAIGE-chat wording only for `paige_chat` rows.

**Deliberate deviation — one link per row on the record.** Contract §2.3 has chat and the record share `standingRecordLinks(status)`, which links a destination only when it holds something (terms or an agreement, invoices). The record instead gives every row its one link to where that fact is kept — Agreement → "Open terms & agreements", Money → "Open invoices" (plus "Open collections" when there is a schedule), Delivery → "Open delivery work" — even when the row is empty, because on a record "where would this live" is the useful answer and the place to add it. The destinations, routes and labels are still the shared ones (`ATTENTION_DESTINATION`, `routeLinkTarget`, the frozen labels); only the "when" rule differs from chat, on purpose.

**Evidence (kept apart).**
- **Automated (unit/render), each written failing first:** `useBusinessTimeZone.calendar.test.ts` (7: both sides of UTC, the date line, DST, every withheld reason, an unknown zone, the viewer's own TZ, the midnight tick; plus 3 for the shared calendar words), `CollectionsWorkspace.business-calendar.test.tsx` (10 failed of 11 before the change; plus 4 for the review fixes — the note said once, an admin's note once, the coverage line in words, an invoice without the owed flag never $0.00), `collections.test.ts` (owed flag), `workspaceLinks.test.ts` (`routeLinkTarget`), `SalesWorkspace.contract.test.tsx`, `tierFeatures.test.ts`, `ClientStanding.test.tsx` (13; plus 7 for the review fixes — name-then-state row order and the narrow-pane areas, "Check again" keeps the last answer, one retry on error, the held Overdue spanning with the arrow on the last word, an invalid zone, timestamps "not shown" without a zone, business dates with one), `TenantRelationshipsClientsWorkspace.test.tsx` (mount, no read without a client, sub-account not mounted). Each review-fix behaviour was also falsified by a mutant that a named test kills (§71.4; ten mutants, all killed).
- **SQL:** a focused bare-PostgreSQL 16 proof (`scratchpad/beta-proof`: the real reader bodies from their newest migrations, the real display chain, alpha's migration, then this migration applied twice): 22/22 PASS; it FAILS without the migration ("a page/record read … writes NO receipt row"), and two mutants (the wording link removed; a receipt reinstated in the client read) each fail a named assertion. The full-schema assertions are added to `supabase/tests/exp04_client_engagement_status.sql` (zero receipts for reads and searches, no `receipt_id`, `pg_get_functiondef` free of `record_capability_run`, the read wording, and an executor-written receipt rendering on the owner's Rail as PAIGE's one read) — **not run here** (no Supabase stack); CI `database-contract` runs them first.
- **Rendered (harness — not the deployed app):** `client-standing-mount/standing-drive.mjs` mounts the real Clients workspace and record (data boundary stubbed) — every state in both themes, phone, and the Solo 8-frame matrix; `sales-collections-business-calendar-drive.mjs` renders the real Sales › Collections for every zone state, both themes, phone and the matrix, plus one frame per theme scrolled to the register's late row. Both re-run last, after the final source edit of the second fix pass: 32/32 and 30/30 (+2 late-row frames) OK. The second pass (independent design re-review) fixed: the empty state is one column again (the action slot is scoped to the ledger row), held Collections values line up across the tiles, dates and the checked time never break inside the value on a phone, "Show N more" replaces a dead "and N more", the re-read no longer dims text below AA and is announced, and the obligations list never claims "none" about invoices it cannot judge. Measured on every frame: AA contrast (lowest 4.69:1 light, 5.73:1 dark on the record; 5.52:1 on Collections), no gold, no sideways overflow, 44px targets on the phone, no page error; on the record every row's name and pill share one line in the 426px pane (1366/1440/1536) and no pill sits above a name at any width (886px and 762px at 1024 and 900); the held Overdue spans the grid with its link on one line and the arrow attached; on Collections the hold note appears once and the coverage line reads "Central Time (Chicago) · today {Mon D, YYYY}". The harness's PAIGE dock is a placeholder that does not reproduce the app's dock narrowing, so PAIGE-open frames are not evidence of the docked layout.
- **Authenticated runtime:** **UNVERIFIED, owed.** No signed-in session ran. Owed on the official Solo QA account: open Setup twice and Collections and a client record — no new Rail row; ask PAIGE where a client stands — one "Checked where a client stands" row by PAIGE; Collections shows "On hold" until the zone is saved, then judges Overdue on the business calendar and agrees with the client record for an unbound invoice (critique risk 1: a terms-bound invoice is judged on the schedule there, on its due date here); plus one sub-account walk (§51.5). Post-merge §32: `schema_migrations` has `20271031005000`, and `pg_get_functiondef` of the three readers has no `record_capability_run`.

**Not changed here — recorded follow-ups.**
- The Sales overdue metric (C2: `get_business_snapshot`, `read_business_metric`, Sales Performance, Finance) still judges overdue on UTC — outcome 4 is **partial** until that Sales-lane PR lands.
- `_sales_invoice_actor`'s row locks on a read (critique B6) are a Sales follow-up.
- **PAIGE's held sentence has the same imprecision the record had.** `ATTENTION_TEXT.business_time_zone_unset` in `_shared/client-engagement/labels.ts` says "The business time zone is not set…" for both a missing and an unrecognised zone (the composer raises the one key for both). The record and Collections now tell the two apart; PAIGE's wording is unchanged here (it is the shared chat label; changing it needs its own key or a reason field). Follow-up.
- **`StatePill` light-theme ink is below AA in the primitive.** Its success and warning words measure 4.36:1 and 4.18:1 on the record's paper surface; this section deepens them locally (`client-standing.css`, a `data-state` override) as a stopgap. The fix belongs in `src/components/ui/page/StatePill.tsx`, with renders of its other users; the local override is removed when it lands. Follow-up.
- **The global resting link colour spends gold.** `[data-pg] a { color: var(--pg-gold-core) }` (`src/index.css:333`) makes every other resting link in the record — and app-wide on pg surfaces — gold, which §11 reserves for the act. This section uses the indigo violet; its neighbours still use gold. Retiring the global rule for the indigo/violet link token, with renders of the affected surfaces, is a follow-up.

## 17. Codex continuation — exact saved-invoice navigation (2026-10-14, LOCAL)

The owner appointed Codex sole E04 implementation lead. Historical evidence and releases #2129 `50c32a605b5359bcf2855de2fc1900248d3bc183`, #2136 `d5a8e6e76a11263d61746d819cdde4c9179ec5d9` and #2138 `6428c2ba61959ef302cf69e0dbd64a878ddbb35f` are preserved. Sections 1–15 are dated inventory; §16 supersedes the old expected link/step/calendar/attribution gaps. This section describes an unreleased continuation candidate, not another released capability.

**Post-merge identity closeout, 2026-10-14 (supersedes this section's LOCAL/unreleased/review-pending checkpoint only).** PR #2142 merged reviewed `d9e180e215b8c29386c4d609e13e5f24826a5583` as `58ae0adcd476611cddba8bb2664d206e91fc0a05`; the trees are identical. Independent nonauthor source/Impeccable review and one docs-only recheck SHIP, all11 exact-head checks and both Vercel statuses SUCCESS. Production Vercel `dpl_DimwQp8LTD6CgLuuthFnY5pF1T9W` READY/exact merge; actual public build `58ae0adcd476611cddba8bb2664d206e91fc0a05-mv88oplf`. Edge38585844377 SUCCESS/`edge-live` exact merge, no migration. Individually retrieved16 packages contain17 relevant shared-module copies:16 match the reviewed/merged tree, including all changed Chat404 modules. `platform-billing-connect` remains ACTIVE v22 with the prior URL module despite successful deployment output; all other files in its four-file package match. Its only URL call uses unchanged `canonicalAppUrl(destination=billing)`; the sole module difference adds invoice focus inside the unused record-link resolver. Retained-source/no-op cause remains UNVERIFIED, not full source parity or actual billing proof. Exact hashes/check identities are in [release readback](../evidence/ui-delivery/exp04-invoice-navigation-release-readback.json), with the canonical Master §4.0 row. This is internal production source evidence; Central QA's existing7-case invoice supplement remains NOT_RUN and full E04 remains incomplete, without a customer release identity or announcement. The later Coordinator14:35 note describes SendGrid-only as the target and Resend retirement as pending actual cutover; the earlier provider routing below is dated history. EXP03 remains Claude Code-owned. No provider cutover or consequential activation is part of this closeout.

**EXTEND — inspect the saved invoice.** The released E4-S3 reference frame, current-account route builder, ClientStanding and Sales inspector are reused. One complete, unambiguous managed invoice (`draft`, `issued`, `void`) carries its UUID; multiple invoices, truncation and legacy sources retain the plural list link. References contain no record contents or arbitrary URL. Existing `read_sales_invoice(_expected_tenant_id,_invoice_id)` and `readInvoiceRecord` resolve the invoice independently of register pagination, filters or recurring-view selection, under caller JWT/current actor/workspace, with exact-ID equality and stale-response masking. The focused state never substitutes the first register row. No automatic editor, issue/send/payment or display receipt is introduced. Existing draft/action/unknown recovery stays mounted until its canonical exit; Back removes only invoice focus and preserves the remaining route.

This closes the source-only invoice-navigation subset of §15's surface-link gap **only after release**. Terms/signing exact hydration, exact Collections plan projection, effective signed economics, governed onboarding, accepted delivery and authorized follow-up remain separate gaps. It does not make F1–F7 conversational execution available.

**Evidence at this checkpoint.** Preserved E4-S3 baseline111 tests, shared references61, standing73, independently executed focused hook/consumer65 and shared C0b53 pass. A 4,080-case independent route differential found only the two expected new SOLO invoice-focus cases. Production build completed locally. Synthetic existing-component/shell browser matrix rendered both themes, four requested SOLO viewport pairs with PAIGE closed/open, phone, missing/refused/foreign/invalid/duplicate/retry and reduced-motion/reflow states. The PAIGE content is an explicit placeholder, so this is shell geometry only, not actual Chat-pane acceptance. Browser review found Back losing keyboard focus to body; one repair/asserted recheck passed. Final affected-flow310/310 tests and production build passed; frozen-head nonauthor review/CI remain owed. Evidence/commands and accurate final results belong in `../evidence/ui-delivery/exp04-exact-invoice-navigation.md`. None of these fixtures proves ordinary customer authentication, Stripe settlement, signatures, sends or service completion.

**Responsible dependencies.** Sales owns PRE-1 canonical agreement revisions (#2140, candidate `11f14c866aeffedd78dab3631fd669783ccd5179`) and separately frozen signed economics/effectuation. The owner-appointed Shared Chat runtime replacement grounds INT-304/#1615 and owns only bounded shared schema/dispatch integration; PRE-2 requires Operations' reviewed scoped writers plus canonical operation identity, unknown-outcome handling, readback and receipts before adoption. Sales/Analytics coordinate overdue_current1.1.0 under the Coordinator's exact-key/version ruling; no second date/financial engine. INT-335 proposal pieces are reused without inventing batch/package approval. Mind/Memory/Knowledge applicability remains a Coordinator/shared-runtime question. INT-346 stays DRAINING; no consequential activation is inferred.

**QA and communications.** Central QA owns existing #2119 and reports3 PASS rows/19 BLOCKED/0 recorded FAIL, representing only two distinct passed observations (entry and Chat readiness), with no E4 prompt/zone save and transport infrastructure blocking further drive. Positive record/overdue cases need an existing approved fixture; no fixture, account or provider change is fabricated. Authenticated end-to-end acceptance and owner product acceptance remain UNVERIFIED. Material progress is posted to owner chat and ANT-51/ANT-147, Coordinator comments are checked before integration/release decisions, and writes are read back. EXP03 remains Claude Code-owned. Latest Coordinator provider policy: operator corporate/system Resend; tenant PAIGE Email governed SendGrid; independently authorized Gmail/iCloud retain their own paths, without fallback/crossover.

## 18. Codex continuation — client released-work review (2026-10-14)

**Current ownership and scope.** Codex is the sole active E04 experience implementation lead under the owner continuation; historical Claude releases remain intact. EXTEND existing external-client `/app/actions`, REUSE native client linkage, Operations discovery/exact reader/domain decision/readback, actual SDK, existing router and Radix. NEW only a bounded tuple/access adapter and ephemeral presenter/context/list. No competing agreement/payment/authorization/receipt/scheduler store. Operations retains sole ownership of its component/helper/tests and staff lane; EXP03 remains Claude Code.

**Actual customer surface.** Released work appears beside existing Action items/activity. Exact selected immutable versions open the unchanged Operations review. The global presenter inside the existing BrowserRouter survives route history outside `/app` while its domain guard retains dirty, confirming, busy and unknown work. Definitive actual actor/link/source loss scrubs the whole instance and nested portal. Transient lookup uncertainty retains the previously authorized immutable view under unchanged actor with honest failed-recheck feedback; every decision still reauthorizes through Operations. A ready access read never discharges the domain guard or proves causation. Verified domain decisions survive metadata refresh failure without retry. See [flow and authority packet](../evidence/exp04-client-delivery-review/flow-and-contract.md).

**Local proof, not customer acceptance.**128 affected tests,34 loopback native cases, full build and official type baseline10/current10 pass. Actual presenter/Operations/Radix/BrowserRouter are exercised over synthetic SDK/shell/records; zero final page errors/external requests. Both themes and1536/1366/1024/900/390/320 widths include keyboard, long content, nested cancellation, actual Back/Forward, stale A-B-A and source recovery. Actual AppNav/Chat, native zoom/mobile OS keyboard, authenticated nonstaff linked-client isolation and durable production reload remain UNVERIFIED. A seeded terminal fresh mount proves only presentation. Independent exact-head source/Impeccable finish review, exact CI, deployment and Central QA remain required. The designated ordinary owner account is not automatically a nonstaff client identity or fixture authority. [UI evidence](../evidence/ui-delivery/exp04-client-delivery-review.md). No customer release identity or whole-E04 completion claim.

**Shared dependencies remain with their owners.** Operations#2149 merged as2ec68dfddedbc3483c878668cd260df17975715e; root adopts the exact domain unchanged. Staff#2067 retains its concrete phone recovery finding/review hold. Sales#2146 overdue1.1.0 is canonical shared business-calendar work; no independent calculation engine. Sales#2140 has the specific Coordinator reconciliation/final-equivalence exception178e174a, not a blanket waiver; the helper is separate from PRE1 effective immutable signed economics. PRE2 proposed Core intake is complete but PROPOSED only; actual archived Core owner/active responsible framework actor and canonical replay/receipt closure remain a before-code dependency. Shared#2143/#1615 ownership/admission holds stay intact. INT-346 remains DRAINING/inactive.

**Communications and QA correction.** Later owner/Coordinator Conversations decisions ANT1479a7fd7af/ANT51fa7b0c31 supersede §17's older provider split: actual customer follow-up converges on existing canonical Conversations/thread/contact/provider/approval outcomes; SendGrid-only is the target, Resend retirement awaits authorized responsible-owner cutover. No send/cutover is authorized by this portal source. Central QA#2119 original3PASS rows/19BLOCKED/0recordedFAIL remains unchanged; client/payment/thread/reload supplements are NOT_RUN. Material progress and dependencies are mirrored to ANT-51 and ANT-147 and Coordinator updates checked there; E04 does not staff the separate proposed auditor or inherit Core/Research work.


### Sole-lead accepted commercial record continuation — 2026-10-15

The owner now places all twelve E04 outcomes with this Codex lead; earlier owner-routing statements above remain historical and do not assign retired agents. Source branch `codex/e04-accepted-commercial-record` extends the existing owner invoice inspection and canonical package with immutable accepted economics, original revision/dated obligations and explicit current-source drift. Full legal wording stays behind the explicit owner read; model output is bounded. Existing signing validation is shared, not duplicated. A read does not activate terms, duplicate invoice principal, collect, notify or complete services. The original high-risk C-1 effectuation/provenance/approval contract remains required. [Bounded source and UI evidence](../evidence/ui-delivery/e04-accepted-commercial-record.md) distinguishes local/native/browser proof from independent review, exact-head CI, release, authenticated QA and final owner acceptance. All twelve outcomes remain incomplete; INT-346 and provider/security gates remain intact. No other agents are involved.
