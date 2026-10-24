# EXP00 — Founder Evaluation Package

**The complete Platform Operator commercial experience, ready for one integrated walkthrough.**

## What to experience (in order)

### 1. The Company Home
Open `/operator` — you are the Platform Operator. The left navigation now shows seven departments: **Fleet, Relationships, Sales, Marketing, Marketplace, Analytics, Settings**.

### 2. Ask PAIGE about your customers
Open the chat (any Operator view). Ask: **"PAIGE, can you tell me about who we have joined so far?"**

You should hear about Acmey Advisory (trial to Nov 17, workspace live, welcome sent after 9 attempts, no card on file — worth watching before renewal) and the test signup (stuck at checkout). Cash is $0, ARR is $0, five legacy accounts correctly identified as internal.

This is the COO conversation — PAIGE answering from real company data, not reciting a stale block or refusing because no tenant is selected.

### 3. Walk through Relationships → Customers
Click a customer row. You should see:
- **Five lifecycle stages**: Paying customer, Active trial, Enrolled, Incomplete checkout, Prospect
- **Activation timeline**: real events from the canonical records (enrolled → checkout → subscription → workspace → welcome → Meet PAIGE)
- **Recovery signals**: if anything needs attention (currently nothing does)
- **Cross-navigation**: "View in Billing →" link

### 4. Walk through Relationships → People
Real company contacts from enrollment data — names, emails, businesses, workspace status. Click a person for their detail drawer with cross-links to Customers and Billing.

### 5. Walk through Relationships → Conversations
Welcome email delivery records (state, attempts, errors, provider receipts) and the transactional send log. This is an outbound records view — inbound replies and live send belong to the governed Communications system.

### 6. Explore Sales
The company's own pipeline with seven stages (Lead → Qualified → Demo → Proposal → Negotiation → Won/Lost).
- **Pipeline view**: kanban board with stage columns
- **Leads view**: early-stage open deals only
- **Activity view**: most recently updated opportunities
- Create a test opportunity, move it between stages, see the governed status resolution

### 7. Check Billing
Settings → Billing shows the company's truthful commercial position: $0.00 collected (no paid invoices yet), one trial subscription, no receivables, five legacy no-Stripe records correctly excluded from revenue.

## What is verified vs. owed

### Verified (live, production-proven)

| Capability | Evidence |
|---|---|
| Customer signup → subscription → workspace | Acmey Advisory: enrolled 10-18, fulfilled after 8-attempt recovery, workspace 9178342 live |
| PAIGE COO answers company questions | Live proof: exact owner question answered from real data (ANT-158 ede912d4) |
| Tenant isolation | Three negatives: no-hint → tenant persona; tenant user → 42501; unauthenticated → 42501 |
| Customers lifecycle | Five stages derived from real enrollment + subscription fields |
| Activation timeline | Six observed stages on the real customer, verified live |
| Exception detection | Full error trail on every failure (webhook retries, welcome delivery) |
| Sales pipeline | Seeded (PPL-SALES, 7 stages), kanban + list + create + move all functional |
| Billing truth | $0.00 collected, trial-vs-paid correctly distinguished |
| People | Company contacts from enrollment + intake data |
| Conversations | Welcome records with states/attempts/errors |
| Idempotency | 8-attempt recovery produced exactly one workspace, one subscription, one welcome |
| Return journey | Same records visible on every revisit |

### Owed / dependent

| Item | Status | Dependency |
|---|---|---|
| EXP01 first-value (Setup → first action → Rail receipt) | PROOF OWED | EXP01's authenticated QA |
| SendGrid delivery events (webhook receipts) | PROOF OWED | Owner sets SENDGRID_WEBHOOK_PUBLIC_KEY |
| Real sales opportunities in the pipeline | Empty (seed only) | First real opportunity creation |
| First paid subscription | $0 collected | Trial converts on Nov 17 (or a new customer signs up) |
| Specialists (MERIT/CURA/VERA/NEXUS) active in conversation | Structural framework only | Each specialist needs its own activation |

## Release log

| PR | Merge SHA | What |
|---|---|---|
| #2385 | `84ec66a29` | SendGrid content-order fix |
| #2382 | `46c7810f3` | O-3 COO briefing (customer book in chat context) |
| #2381 | `a6a2b09e4` | O-1 Customers desk |
| #2394 | `1f3ea9977` | O-2 Billing desk |
| #2398 | `bb856cf4b` | O-4 activation timeline + O-5 recovery signals |
| #2403 | `b70df0d65` | O-3 chat COO (persona force + platform tools) |
| #2406 | `df1c24682` | Chat scope revalidation fix |
| #2408 | `035207288` | Chat dispatch entry fix |
| #2410 | `061bf7b46` | Chat workspace-authority fix |
| #2428 | `1e98f195` | Commercial experience (Sales + People + Conversations + nav) |
| #2446 | `fc88e6ae` | Capability status sync + ALG assessment |
| #2448 | `0cb76386e` | Sales→Customer cross-navigation |
| #2453 | `1eb4d1e66` | Sales Leads/Activity view differentiation |

## Algorithm status (from the ALG assessment, docs/evidence/experience-00/exp00-alg-assessment.md)

| Algorithm | Status |
|---|---|
| ALG-01 Reconciliation | **PRODUCTION-VERIFIED** (8-attempt recovery, zero duplicates) |
| ALG-02 Activation | **PRODUCTION-VERIFIED** (6-stage timeline on real customer) |
| ALG-04 Retention | **IMPLEMENTED** (lifecycle stages + renewal dates, no predictive scoring) |
| ALG-12 Exception detection | **PRODUCTION-VERIFIED** (full error trail on every failure) |
| ALG-13 Next-best-action | **IMPLEMENTED** (COO chat provides grounded suggestions) |

## PO-EXP ownership handoff

The company-side surfaces delivered here will transfer to their permanent owners:

| Surface | Future owner | Notes |
|---|---|---|
| Sales + Pipeline | PO-EXP05 | Preserve the approved Overview→Opportunities→Offers→Terms→Payments→Performance direction |
| Customers + People | PO-EXP08 | The lifecycle stages and contact records are canonical |
| Onboarding/Activation | PO-EXP09 | The O-4 activation timeline reads from canonical records |
| Conversations | PO-EXP10 | Outbound records view; inbound needs the governed Communications architecture |
| Retention/Renewals | PO-EXP12 | The trial countdown and renewal surfacing are in place |
| COO Chat | PO-EXP13 | The platform tools and steering are proven |
| Billing/Finance | PO-EXP14 | The $0.00 truth and trial-vs-paid distinction are canonical |
| Fleet/Tenant admin | PO-EXP19 | Untouched by EXP00 (existing functionality preserved) |

## What to do next

1. **Open `/operator`** and walk through the experience in the order above
2. **Ask PAIGE your question** — she will answer from real company data
3. **Create a sales opportunity** in the Sales department
4. **Tell me what you think** — I'll address revisions

---

*This package covers the complete bounded Platform Operator commercial experience as authorized. EXP01 owns the Meet PAIGE onboarding QA. Marketing development is not in scope.*
