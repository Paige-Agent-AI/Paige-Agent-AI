# Solo metric dictionary and economic model — PROPOSAL

**Status: PROPOSED. Nothing depends on it. No code, no schema, no surface reads from this yet.**

Phase 1 of the Analytics & Operating Intelligence lane, Solo shell only. The owner confirms every
definition before anything is built on it — that is the point of writing them down before writing
code. Where a word has more than one defensible meaning, this document does not pick one quietly;
it names the choice, recommends an answer, and says what breaks if the other is chosen.

Grounded against `origin/main` `7ebdd9fe`. Every claim below carries a `file:line` or a migration
name. **This session has no database access**, so nothing here asserts what data exists on
production — only what the schema and the code permit. Questions that need a query are collected
in §8 rather than guessed at.

---

## 1. The economic model — what a Solo business actually is, in this schema

A Solo operator is one person selling services to clients. The schema models that as a chain, and
the single most important fact about the chain is that **only one link in it proves money moved.**

```
  offer            deal              agreement            invoice           order
  ─────            ────              ─────────            ───────           ─────
  tenant_products  deals             tenant_client_       paige_invoices    tenant_orders
  tenant_prices    .value_cents      agreements                             status='complete'
                                     .agreed_amount_minor
  ─────────────────────────────────────────────────────────────────────────────────────
  LIST PRICE       ESTIMATED         COMMITTED            BILLED            COLLECTED
  (supply, not     (operator typed   (signed, not         (sent, never      (Stripe confirmed
   demand)          a guess)          paid)                marked paid)      payment_status=paid)
```

- **ESTIMATED** — `deals.value_cents` (`20260627022609:101`). An operator-entered number. Nothing
  about it proves a client agreed, let alone paid.
- **COMMITTED** — `tenant_client_agreements.agreed_amount_minor` (`20261200000000:85`). A real
  commitment with a real counterparty, still not money received.
- **BILLED** — `paige_invoices.amount_total_cents` (`20260629204156:11`).
- **COLLECTED** — `tenant_orders` with `status='complete'`, written **only** at
  `supabase/functions/stripe-webhook/index.ts:548-556`, gated at `:542` on
  `session.payment_status === "paid"`.

**The proposal's central rule: the word "revenue" is reserved for COLLECTED.** The other three
links get their own words — pipeline value, committed value, billed value — and no surface is
allowed to call any of them revenue. This is not pedantry; §3 below shows the product already
breaks this rule today, on a live Solo surface.

### What this model cannot express, structurally

**The cost side exists, but it does not live on this chain.** The chain above is Paige's own
record of a Solo business, and nothing in it carries a cost: `paige_skill_runs.cost_cents`
(`20260630013855:67`) and `browser_use_sessions.cost_cents` (`:263`) are Paige's AI-operation costs,
the platform's, not the tenant's.

Cost arrives instead through an **integration**: `public.quickbooks_financials`
(`20260420201025:56-83`) carries `total_expenses`, `cogs`, `gross_profit`, `gross_margin_percent`,
`operating_expenses` and `net_income`. That changes profit from *absent* to *conditional* — and the
condition is not only "is QuickBooks connected." **That table has no `tenant_id`**; it is keyed on
`user_id` and `business_id` (`:58-59`). Every other metric in this document scopes by tenant, so
admitting this one means establishing its §9 scoping first, deliberately, rather than assuming the
owner's user id is a safe proxy for their tenant.

> **Corrected after the peer gate (§9).** The first draft of this paragraph said margin was
> *"not computable. Not 'hard' — absent."* That was wrong, and wrong in the specific way this lane
> exists to catch: a confident absence claim that one grep would have falsified. `quickbooks_financials`
> was in my own grounding data at the time I wrote it.

---

## 2. The four live defects grounding found — these are in the product now

These are not proposals. They are existing Solo surfaces displaying numbers that do not mean what
their labels say. They are recorded here because a dictionary that does not name them would be
ratifying them.

### L-1 — The Command Center labels an estimate "Revenue this period"

`src/solo/data/useCommandCenter.ts:163` renders `won_value_cents` under the label
**"Revenue this period"**. `won_value_cents` is computed at
`supabase/migrations/20260713152601_tier_dashboard_metrics.sql:38-40` as `sum(d.value_cents)`
for deals whose stage has `stage_type='won'`, filtered
`AND d.actual_close_date IS NOT NULL AND d.actual_close_date >= since_date`.

**Be precise about which half of the label is wrong.** Those filters mean the figure genuinely *is*
period-scoped, so *"this period"* is defensible. What is not defensible is *"Revenue."* The number
is a sum of operator-typed estimates on deals someone dragged into a "Won" column; no payment, no
invoice, no agreement is consulted. Under the model in §1 this is ESTIMATED displayed as COLLECTED
— the exact substitution the model exists to prevent.

The shipped Sales surface already refuses that substitution, in its own words
(`src/solo/sales/deriveSalesCommand.ts:17-18`): *"'Actual received' is NOT derived here at all.
There is no connected payment source and `tenant_orders` is never summed into revenue; the surface
renders it unavailable."* Command Center and Sales currently disagree about what revenue means.

**Sales is right about the discipline, and M-2 does not reverse it — but the difference is the
owner's to rule on, not mine (D-9).** Sales refuses to *derive* received money because there is no
connected payment source, and renders it unavailable rather than substituting an estimate. M-2 keeps
that discipline exactly and adds one thing: where a Stripe-confirmed order does exist, that is
received money and may be summed; where none exists the metric is `UNAVAILABLE` — never zero, never
an estimate. That narrows the September rule's scope rather than contradicting its principle, but it
does revise an owner build-acceptance criterion dated 2026-09-05, so it goes to the owner as a
decision instead of being assumed.

### L-2 — "Active clients" counts cold leads, because `status` defaults to active

`clients.status` allows `'pending','active','inactive','archived'` (`20260423012456:4-6`) and
**defaults to `'active'`** (`20260411060930:15`). `create_contact` hardcodes `'active'` on every
insert (`20261020010000_client_identity_contract.sql`), regardless of whether the person is a
client or a name someone just typed in.

So `active_clients` (`20260713152601:36`) counts rows whose status is exactly `'active'` — it does
exclude `'pending'`, `'inactive'` and `'archived'` — but because the default lands almost every new
row on `'active'`, a cold lead captured from a form is counted as an "active client." Meanwhile
`clients.lifecycle_stage` carries the values that actually mean something (`20260630200554:26-38`)
and is not consulted by this metric.

### L-3 — ARPC divides a period figure by a point-in-time count, over an inflated denominator

`arpc_cents` (`20260713152601:55`) is `round(v_won_alltime::numeric / v_active)::bigint` — **all-time** won value
over the **current** active-client count. Two different time bases in one division, and the
denominator is L-2's inflated count. The number is not wrong by a little; it has no coherent
meaning.

> **Correction: it is not on any screen, and I said it was.** Its only render site is
> `src/pages/admin/PracticeOverview.tsx:133`, and that module has **zero importers** — a repo-wide
> search finds only prose mentions in comments — with the repo's own
> `docs/delivery/solo-completion-matrix.json` classifying it `orphaned_dead_code`, "the unrouted
> PracticeOverview page". So L-3 is a latent defect in unreachable code, not a live one. I reported
> it as live after finding the render call and not checking whether anything routes to it — the same
> find-the-code-and-assume-the-reach error as the stale citations in §9. Caught by the peer gate,
> not by me.
>
> Two consequences. The hint removal below stopped nothing a user could see, and is cleanup rather
> than a fix. And the same two false labels also sit in that file's `KPI_META` (`:117`, `:129`),
> where they are equally unreachable and equally not worth spending on.

### L-4 — The empty funnel shows stage names the tenant never created

When the bundle is `UNAVAILABLE` or has no stages, `src/solo/analytics2.tsx:150` falls through
to a hardcoded list — `["Qualified lead", "Proposal", "Commitment", "Confirmed outcome"]` — and
renders those four as the tenant's funnel.

**Stated precisely, because it is easy to overstate:** no number is fabricated. Each stage shows
*"No proved count"*, the watermark reads *"no implied volume or conversion"*, and the `aria-label`
says the same. The defect is that a brand-new Solo owner is shown a funnel whose **stage names are
not theirs**, with nothing telling them what to do about it. Under §5 this is exactly where an
`UNCONFIGURED` state belongs.

**Recommendation:** L-1 through L-4 are small, local, Solo-scoped, and need no database access to
fix. I propose fixing them in Phase 2 alongside the collection work rather than waiting for the
full dictionary to be built, because each one is currently telling a Solo owner something untrue.

---

## 3. The dictionary — proposed metrics

Each carries the full spec the assignment requires. **Class** is the §1 chain position and is part
of the metric's identity, not a note about it.

### M-1 · `sales_funnel.created_deals_by_current_stage` — SHIPPED, v1.0.0, unchanged

| | |
|---|---|
| **Business definition** | Of the deals this workspace created in the period, where does each one stand right now? |
| **Class** | ESTIMATED (count, not value) |
| **Numerator / denominator** | A count per stage. Not a ratio. **Explicitly not a conversion rate.** |
| **Included** | Deals with `tenant_id` = active account, `created_at` in `[start, end)`, in the tenant's single `is_default=true` pipeline |
| **Excluded** | Deals in a non-default pipeline; deals whose stage is missing, unscoped, or belongs to another pipeline (both already counted and reported as exclusions) |
| **Time basis** | `deals.created_at` — when the deal was made, not when it moved |
| **Currency / entity** | None — a count. Entity: the active tenant |
| **Source of record** | `public.analytics_sales_funnel_evidence_bundle` (`20261004000000:40-238`) |
| **Minimum data quality** | Exactly one default pipeline with ≥1 stage, else `UNAVAILABLE` (`:151-155`) |
| **Owner** | The tenant's pipeline configuration |
| **Target / threshold** | None. A distribution, not a goal |
| **Actual / forecast / estimate** | Actual count of records |

It is honest about its own limit in its own words (`:231`): *"Stage counts use each deal record's
current stage at queried time; they are not historical stage-entry counts."* Keep that. It is the
model for every caveat below.

### M-2 · `money.collected_value` — PROPOSED · **the only metric that may be called revenue**

| | |
|---|---|
| **Business definition** | Money this workspace has actually received through its storefront in the period |
| **Class** | **COLLECTED** |
| **Numerator** | `SUM(tenant_orders.amount_total)` where `status='complete'` |
| **Denominator** | None |
| **Included** | Orders Stripe confirmed as paid — the only rows in the schema with that guarantee |
| **Excluded** | Every other order status; all deals, agreements and invoices regardless of state |
| **Time basis** | `created_at`. **Open decision D-2** — this is session-create time, not payment time |
| **Currency / entity** | Per currency, never summed across. Entity: the active tenant |
| **Source of record** | `public.tenant_orders` (`20260629182422:146-163`) |
| **Minimum data quality** | A connected Stripe account. Without one this is honestly `UNAVAILABLE`, not zero |
| **Owner** | The tenant's storefront configuration |
| **Target / threshold** | Owner-set. Proposed default: none until a baseline exists |
| **Actual / forecast / estimate** | **Actual.** The only one in this document |

**Honest bound:** this covers storefront sales only. A Solo operator invoicing by bank transfer
has collected money this metric cannot see, and the metric must say so rather than imply their
revenue is zero.

### M-3 · `pipeline.open_value` — PROPOSED

| | |
|---|---|
| **Business definition** | What the operator estimates their live opportunities are worth |
| **Class** | **ESTIMATED** |
| **Numerator** | `SUM(deals.value_cents)` where the deal's stage has `stage_type='open'` |
| **Included / excluded** | Open stages only; archived stages excluded — note `20260713152601:49-54` does **not** filter `archived_at IS NULL`, which is a defect to fix, not a definition to copy |
| **Time basis** | Point-in-time. No date filter — this is a snapshot of now |
| **Currency / entity** | Per currency. **`deals.currency` exists and is currently discarded** (`:38-40` sums `value_cents` across all rows) — open decision D-3 |
| **Source of record** | `public.deals` + `public.pipeline_stages` |
| **Minimum data quality** | ≥1 open stage defined |
| **Target / threshold** | Owner-set |
| **Actual / forecast / estimate** | **Estimate, operator-entered.** Must be labelled as such on every surface |

### M-4 · `pipeline.won_value` — PROPOSED (this is what L-1 currently mislabels)

Same shape as M-3, filtered to `stage_type='won'` and dated by `actual_close_date`.
**Class: ESTIMATED.** Proposed surface label: *"Won (estimated value)"*, never *"Revenue."*

**Open decision D-4:** two definitions of "won" coexist and can disagree —
`d.status = 'won'` (used by `contact_deal_rollup`, `20260627024041:34`) versus
`pipeline_stages.stage_type='won'` (used by `practice_dashboard_metrics`). Migration
`20261204000000_closing_a_deal_on_the_solo_board_records_it.sql` records that the governed Solo
board historically set **neither** `status` nor `actual_close_date` on a won move, so deals closed
before it are in a won stage with no close date and drop out of any dated figure.

### M-5 · `agreements.committed_value` — PROPOSED

| | |
|---|---|
| **Business definition** | What clients have actually agreed to pay, across live agreements |
| **Class** | **COMMITTED** |
| **Numerator** | `SUM(agreed_amount_minor)` on `status='active'` agreements, grouped by **`agreed_currency` AND `term_kind`** — never one figure. A monthly-equivalent recurring amount is a rate and a one-time fee is an amount; adding them is the same error this document levels at ARPC |
| **Time basis** | Point-in-time |
| **Source of record** | `public.tenant_client_agreements` (`20261200000000:85-86`) |
| **Recurring convention** | **Monthly-equivalent, not annualised.** This is the already-shipped choice, documented at `src/solo/sales/deriveSalesCommand.ts:14-16`: *"Recurring is reported as a monthly-equivalent, NOT annualized into a single contracted figure it does not prove."* Adopting it rather than inventing a second convention (§18) |
| **Actual / forecast / estimate** | Committed — a real counterparty commitment, not received money |

**Honest bound:** `term_kind` spans five values — `one_time`, `recurring`, `installment`, `deposit`
and `custom_quote` (`20261200000000:68-69`). They are not commensurable, and `custom_quote` may carry
no settled amount at all, so the metric reports a row per term kind per currency and refuses to emit
a single "contracted value" total.

### M-6 · `book.contacts_by_lifecycle` — PROPOSED (replaces the L-2 trap)

| | |
|---|---|
| **Business definition** | How many people are in the book, and where each stands |
| **Class** | Count |
| **Numerator** | `count(*)` grouped by `clients.lifecycle_stage` |
| **Included / excluded** | Every row carrying a `lifecycle_stage`. **A tension D-1 must resolve:** the natural exclusion is "not archived", but `clients` has no `archived_at` — archived-ness lives only in `clients.status`, the column L-2 shows is unreliable and which this metric otherwise avoids. Either it reads `status` solely to exclude `'archived'` and says so, or archived contacts are counted. It must not silently do neither |
| **Time basis** | Point-in-time, plus a created-in-period variant on `created_at` |
| **Source of record** | `public.clients`, `lifecycle_stage` CHECK at `20260630200554:26-39` |
| **Owner** | Open decision D-1 — the lead/client boundary is not declared anywhere |

### M-7 · `outcomes.by_type` — PROPOSED

`pipeline_deal_outcomes` grouped by `outcome_type` (`20261224000001:9-12`). Three rules, each
closing a way this metric could quietly lie:

1. **Deduplicate to one row per deal.** The table is append-only with no uniqueness, so a deal
   closed, reopened and re-closed leaves three rows and a naive count triples it.
2. **Pick that row by `created_at`, not `outcome_date`.** `outcome_date` is caller-supplied and can
   be backdated, so ordering by it can make an older correction outrank the newer one. `created_at`
   is the order the records were actually written. Report *by* `outcome_date` — that is the business
   date — but *choose* by `created_at`.
3. **`reopened` is a transition, not an outcome.** Counting it alongside won/lost/not_fit puts a
   "this deal came back" event in the same column as "this deal ended", which no one reading an
   outcomes chart would expect. It is excluded from the counts and reported separately if at all.

### M-8 · `work.capability_runs` — PROPOSED (the operating-intelligence metric)

What Paige actually did for this workspace in the period, by capability and result. This is the
one metric in the dictionary that measures the product rather than the business, and it is the
honest seed of "operating intelligence." Source and exact shape are pending the day-one track's
return; specified in the Phase 2 slice rather than asserted here.

---

## 4. What can and cannot be built, per lens

> **This section was rewritten after the peer gate (§9).** Its first draft marked four lenses
> NOT BUILDABLE, and four of those verdicts were wrong. The pattern is worth naming because it is
> the failure mode this whole lane exists to prevent: I checked the obvious table, found the column
> missing, and generalised from *"this table does not have it"* to *"the platform does not have
> it"* — without following a foreign key or checking a sibling integration. Three of the four
> refutations came out of my own grounding data, which had already listed the tables I then claimed
> did not exist.

| Lens | Verdict | Where it actually stands |
|---|---|---|
| `money` | **Shipped — with a caveat that matters** | M-1 is live, but it explicitly disclaims being money: `20261004000000:232` — *"Counts are records, not revenue, conversion, attribution, benchmark, or outcome claims."* The actual money metric (M-2) is unbuilt. Calling this lens "done" would repeat §2's substitution at the lens level |
| `brief` | **Buildable** | Composable from M-1 to M-8 |
| `profit` | **Conditionally buildable** | `public.quickbooks_financials` (`20260420201025:56-83`) carries a full P&L: `total_expenses`, `cogs`, `gross_profit`, `gross_margin_percent`, `operating_expenses`, `net_income`, plus `accounts_receivable` and `cash_runway_months`. **Two real conditions, not one:** it requires a connected QuickBooks, and — the part that needs design attention — **it has no `tenant_id`.** It is keyed on `user_id` and `business_id` (`:58-59`), a different scoping model from every other metric here, so §9 scoping has to be established before a single figure is read |
| `ret` | **Partially buildable — over agreements, not over the contact book** | `tenant_client_agreements` carries `starts_on`, `renews_on` and `ends_on` (`20261200000000:101-103`) plus `'completed'`/`'cancelled'` states (`:114-115`) — a real cohort boundary and a real end event, on the table this document already uses for M-5. What does **not** exist is retention over the whole contact book: `clients` has no end date, and `lifecycle_stage` carries `'client_churned'` (`20260630200554:35`) as a **state, not a dated event** — you can count who is churned now, never how many churned in a period |
| `mkt` | **Partially buildable — for form-originated contacts** | The attribution does not need copying forward, because the row holding it already points at both: `growth_form_submissions.contact_id` is an FK to `public.clients` (`20260630004505:134`), with `utm_json` at `:139` and `referrer` at `:140`, all tenant-scoped (`:133`). So UTM is one join from a contact. **Coverage is partial by construction** — only contacts that arrived through a Paige form carry it — which is exactly what the contract's `PARTIAL` state and its exclusion counts exist to express. Caveat: `deal_id` (`:135`) is a bare `uuid` with **no foreign key**, so the deal-side join is unenforced |
| `dec` | **Blocked, not absent** | Needs the governed runtime binding Phase 4 waits on from the Platform Reach Lane. The lens already marks only Human/Read/Page live (`analytics2.tsx:222`) |

### Also revised: MRR/ARR is buildable

The first draft said `tenant_service_subscriptions` "has no amount column at all." The table does
carry `application_fee_amount` (`20260702005950:121`) — though that is *Paige's* cut, not the
subscription price, so the original instinct was pointing at something real. The price itself is one
hop away: `price_id` (`:114`) references `tenant_prices`, which supplies `unit_amount`, `currency`,
`billing_interval` and `interval_count` (`20260629182422:102-105`), and the subscription carries its
own `billing_period` (`:116`).

So MRR **is** schema-permitted. Three caveats belong in the definition rather than in a refusal.
`tenant_prices.unit_amount` is the **list** price, not necessarily what this client pays.
`price_id` is `ON DELETE SET NULL`, so a deleted price silently orphans a subscription's amount and
drops it from the sum. And **there are two cadence sources with no declared precedence** — the
subscription's own `billing_period` (`20260702005950:116`, free text with no CHECK) and the price's
`billing_interval` / `interval_count` (`20260629182422:104-105`, CHECK-constrained). Normalising to
a monthly figure requires choosing one, and the constrained pair is the defensible choice; that is
part of D-6 rather than an implementation detail.

### What genuinely remains unbuildable

Stated narrowly this time, with the search that supports each.

- **Refunds and chargebacks netted out of a revenue figure.** `tenant_orders.status` permits
  `'refunded'` (`20260629182422:158`) but no shipped code writes it; the `charge.refunded` handler at
  `supabase/functions/stripe-webhook/index.ts:571` does not touch `tenant_orders`.
- **Accounts receivable from Paige's own invoices.** `paige_invoices.paid_at` is never written and
  `'paid'` is never set, so "outstanding" means "ever sent." (Note: `quickbooks_financials` does
  carry `accounts_receivable`, so AR is available on the same conditional footing as `profit`.)
- **Lifetime value grounded in money actually received.** `tenant_orders` has no contact FK at all —
  it identifies the buyer by free-text `customer_email` / `customer_name` (`20260629182422:154-155`),
  so collected money cannot be attributed to a client record.
- **Conversion rate between stages.** No stage-entry history exists anywhere: `lifecycle_stage` is a
  single mutable value with no transition log, and the funnel bundle says so itself
  (`20261004000000:231`).

## 5. Day-one behaviour — the owner's standing requirement

*A newly created Solo account must have working analytics from the moment it is populated.*

**A new Solo account gets no pipeline and no stages.** `20260915000000_remove_starter_auto_provisioner.sql:26-42`
drops the `trg_tenants_seed_starter_business` trigger, unschedules the `starter-provisioning-drain`
cron job, and drops both `seed_starter_business` and `trg_seed_starter_business`. It was removed
deliberately, on an owner ruling recorded in the migration header at `:3-6`:

> *"NEVER MAKE ANYONE DEFAULT TO ANYTHING; the platform must NOT auto-build a business the tenant
> didn't ask for. EVERYONE goes through Setup and chooses (playbook/pipeline/calendar)."*

So the chain is: no pipeline at provisioning → `_default_pipeline_count = 0` → **`UNAVAILABLE`**
(`20261004000000:151-155`). The one live metric is unavailable for every new Solo account until its
owner builds a pipeline by hand in Setup.

> **Correction, recorded rather than quietly fixed (§13).** An earlier draft of this section stated
> the opposite — that a new tenant is seeded a default pipeline asynchronously by a trigger and a
> cron drain. That was true of `20260711180000_starter_business_provisioner.sql` and false of the
> current schema, because the later migration above removed it. The error was reading a July
> migration and not checking whether a September one repealed it.

### The requirement and the 2026-08-16 ruling do not actually conflict

They appear to: *working analytics from the moment it is populated* against *never make anyone
default to anything*. The resolution is in the requirement's own wording — **from the moment it is
populated.** An empty account has nothing to measure, and manufacturing something to show is the
behaviour this whole lane exists to end. What the account needs is for the product to say so
properly:

- **Before the tenant builds a pipeline** — a designed state that says *you have not set this up
  yet, here is the one step*. Today this is `UNAVAILABLE`, which means *cannot be measured* and
  reads as broken.
- **The moment they build a pipeline WITH STAGES and a first deal** — `LIVE`, immediately. No
  seeding, no backfill, nothing to wait for. Deal count is not part of the truth-state expression
  (`20261004000000:151-155`), so a tenant with a staged pipeline and zero deals returns `LIVE` with
  honest zeroes — and `'stages'` at `:228` returns their real stage labels at count 0, not a blank
  grid.

**There is a third state between those two, and it is the one most likely to be hit.** A pipeline
with *no stages* is a first-class, deliberate outcome of Setup:
`20260831224500_solo_pipeline_governed_management.sql:139-148` creates a `'draft'` pipeline with
only the stages supplied, reporting *"Blank pipeline created as a draft. Add at least one named
stage before activation."* Because the truth-state expression fails on `_stage_definition_count = 0`
exactly as hard as on no pipeline at all, **a tenant who has done real setup work still sees
`UNAVAILABLE`.** That is the worst version of this problem: they did the thing, and the product
still tells them their analytics cannot be measured.

The lifecycle gate itself is fine — it admits `trial|active|past_due` (`20261004000000:329-332`)
and `tenants.status` defaults to `'trial'` (`20260629175341:32`), so a new account passes it.

> **Corrected after the peer gate (§9) — and this is the same mistake twice.** This paragraph
> originally claimed `create_pipeline_with_stages` falls back to five default stages when handed
> `'[]'`. That fallback was **removed** by `20260831224500:66`, under the comment *"Stop the legacy
> creator from silently substituting a fixed sales taxonomy."* An empty array is now accepted and
> yields a stageless draft. So for the second time in one document I cited a July migration for
> behaviour a later one had repealed — eleven lines below a correction block about doing exactly
> that. A rule that fails twice is not a rule, so it is now enforced by
> `scripts/ci/doc-citation-lint.mjs` (§9) instead of by my attention.

**Proposal: a fourth truth state, `UNCONFIGURED`.** `UNAVAILABLE` currently does the work of two
different sentences — *this cannot be measured* and *you have not set this up yet* — and a new
account deserves the second, with the next action named. This is a coverage-layer addition, not a
new contract, and it satisfies both owner rulings instead of trading one against the other.

## 6. Decisions — ruled 2026-09-24, except D-1

Eight of nine are ruled. Recommendations that were accepted are recorded as accepted; the four the
coordinator amended are recorded **as amended, not as proposed**, because the amendment is the
ruling.

| # | Status | The ruling |
|---|---|---|
| **D-1** | **HELD — the owner is answering directly** | No metric whose definition depends on the lead-versus-client boundary proceeds until it lands. A **fifth candidate** was added by the coordinator and is recorded here as a candidate, not a recommendation: derive client status from a **signed agreement or a confirmed payment** — a fact the system can prove and point at, rather than a state someone typed. It cannot drift and cannot be inflated by a quickly-entered lead. It is also stricter than how most owners describe their book, which is precisely why it is the owner's call |
| **D-2** | Approved, amended | Use the checkout date and **say on screen that it is the checkout date**. The paid-at gap is filed with its consequence named: at a month boundary a sale lands in the wrong month, and the first tenant reconciling against a bank statement finds the mismatch and stops trusting every number on the page. A trust defect with a delayed fuse, not a nice-to-have |
| **D-3** | **Approved as proposed** | Never sum across currencies — one line per currency. The current code adds dollars and euros into one figure, which is a **live wrong number, not a future risk**. A single converted total needs a rate and a rate date; that is its own policy decision and is parked |
| **D-4** | Approved, amended | The board column (`stage_type='won'`) wins. The backfill is approved **in principle only**: it is a production data write, and it requires a dry-run count of affected deals plus the owner's explicit authorization before anything runs. **No exceptions.** See §10 — this session cannot produce that count |
| **D-5** | Approved, amended | Net headline, gross beside it. The caveat becomes the rule: it **cannot be labelled "what you receive"**, because the processor fee is invisible to the system and the true figure is lower. Label it **after-platform-fee** and let the confidence model carry the incompleteness — the spec's "provable but incomplete" case |
| **D-6** | **Approved as proposed** | Recurring reported monthly, never annualised, adopting the Sales convention. One home (§18) — do not invent a second convention two screens apart |
| **D-7** | **Approved as proposed** | A tenant setting defaulting to 21 days — and it **enters the dictionary with an owner and a threshold like every other metric**, not as a constant in a file |
| **D-8** | **Amended — split** | Computing the right number is Phase 2. **Stopping the wrong one is now.** The surface already implements an honest way to say nothing; suppressing or relabelling a false figure costs nothing, needs no dictionary entry and no evidence layer. Under §13 that does not wait for a phase. Executed — see §10 |
| **D-9** | Approved, **definition widened** | Yes, narrowly — but defined as **confirmed payment from an evidenced source**, not confirmed *Stripe* payment. Stripe is the first writer into that definition, not the definition itself. §38 holds that Paige never holds tenant client money and the tenant brings their own processor, so a tenant taking checks, bank transfers or QuickBooks invoices must be able to reach a complete revenue view. Baking the processor into the definition makes every one of those tenants see zero permanently. This matters more at definition time than at table time |

**M-2 is restated under the D-9 amendment.** Its source of record is no longer "`tenant_orders`" but
**"any evidenced confirmation of payment received"**, of which `tenant_orders` at `status='complete'`
is the first and currently only implementation. A second writer — a reconciled bank transfer, a
QuickBooks-confirmed invoice, a different processor's webhook — enters the same metric rather than
needing a second one.

## 7. What Phase 2 does with this, once confirmed

1. Lift the payload shape out of the pinned plpgsql body into a **metric definition table**, and
   make `sales_funnel.created_deals_by_current_stage` its first row (§18 — extend the one contract, never
   build a second beside it). The `metric_id` CHECK at `20261004000000:18` and the hardcoded
   metric gate at `:323` (`OR p_metric_id IS DISTINCT FROM 'sales_funnel.created_deals_by_current_stage'`)
   are what make a second metric a schema change today. **The prefix is `sales_funnel.`, not
   `funnel.`** — the CHECK permits exactly one literal, so the definition table must be seeded with
   the shipped string or every insert fails 23514. (`:325` is the range-key whitelist, a different
   gate; relaxing it admits nothing new.)
2. Add `UNCONFIGURED` to the coverage layer, and give it the next action (§5), so a new
   account is guided rather than told its analytics cannot be measured.
3. Fix L-1, L-2, L-3, L-4.
4. Consolidate the capture readers onto one pipe, per the original Phase 2 assignment.

---

## 8. Questions that need database access

Unanswerable from this session; collected rather than guessed.

1. Do any Solo tenants currently have **two** `is_default=true` pipelines, or none? Both yield
   `UNAVAILABLE`, and the seeding guard in §5 makes "none" reachable.
2. How many deals carry a `currency` other than the tenant's primary — i.e. is D-3 theoretical or live?
3. Has any `tenant_orders` row ever reached `status='complete'`? If not, M-2 is correct but has
   never produced a non-zero figure, which changes how it should be introduced.
4. How many deals sit in a won stage with `actual_close_date IS NULL` (the pre-`20261204000000`
   population that D-4 turns on)?
5. How many existing Solo tenants have **zero** pipelines — i.e. how many are sitting on
   `UNAVAILABLE` right now because they were created after the auto-provisioner was removed?
   This decides whether §5 is a new-account edge case or the current majority experience.
6. For tenants that do have pipelines, how many were created before `20260915000000` (and so were
   auto-seeded) versus built by hand in Setup afterwards?
7. Does any Solo tenant have a live QuickBooks connection with `quickbooks_financials` rows? This
   decides whether the `profit` lens is conditionally live or conditionally empty, and it is the
   difference between shipping a lens and shipping a prompt to connect an integration.
8. What fraction of a Solo tenant's contacts arrived through a `growth_form_submissions` row? That
   fraction **is** the `mkt` lens's coverage number, and it has to be shown next to any acquisition
   figure rather than assumed high.
9. How many `tenant_service_subscriptions` rows are `status='active'` with a non-null `price_id`?
   Rows with a null `price_id` carry no amount and would silently drop out of an MRR sum.

---

## 9. What the peer gate changed, and the check that now enforces it

Three independent adversarial lenses read this document against the code under the §39 peer gate,
before it was proposed. Between them they opened **90 citations and confirmed 66**. Verdicts:
**FIX_FIRST**, **BLOCK**, **FIX_FIRST**. Every finding I re-verified against the actual lines was
correct, and I re-verified all of the consequential ones rather than accepting them.

**What survived unchanged**, which matters as much as what did not: the economic model in §1 — the
`tenant_orders` COLLECTED anchor, its `payment_status === "paid"` gate, and the fact that it is the
only writer of `status='complete'` — plus the `useCommandCenter.ts:163` mislabel, the truth-state
expression, and the zero-deal `LIVE` trace. The third lens independently checked
`paige_bank_transactions` as a possible counterexample to §1 and found it is not one: it hangs off a
connection whose `contact_id` references `clients`, so it proves a tenant's *client's* receipts, not
the tenant's own.

**What they caught:**

| Class | Count | Example |
|---|---|---|
| Wrong lens verdict | 4 | `mkt` marked NOT BUILDABLE; the attribution row holds an FK to `clients` |
| Stale citation — a later migration repealed it | 2 | `create_pipeline_with_stages` default stages, removed by `20260831224500:66` |
| Internal contradiction | 2 | L-1 endorsed a rule M-2 then broke; M-6 banned the column it needed |
| Wrong metric identity | 1 | `funnel.` where the shipped CHECK permits only `sales_funnel.` |
| Incommensurable sum | 2 | M-5 added a monthly rate to a one-time amount — ARPC's own error |
| Off-by-one or wrong-range citation | 10 | `amount_total_cents` cited at `:15`, which is `memo text` |

### The pattern, and why prose was not enough

Two distinct failure modes, and only one of them is carelessness.

**The absence claims** — every wrong lens verdict was *"no such table exists"*, and three of four
were refuted by tables listed in my own grounding data. The evidence was in hand; the leap from
*this table lacks the column* to *the platform lacks the capability* is what failed.

**The stale citations are worse, because they are invisible to careful reading.** Migrations are
append-only, so a repealed `create or replace function` still greps cleanly and still reads
correctly at the line cited. I made this exact mistake twice — the starter auto-provisioner
(`20260711180000`, dropped by `20260915000000`) and the default-stage fallback
(`20260710200000`, replaced by `20260831224500`) — the second time **eleven lines below a correction
block about the first.** Attention had already failed twice.

So it is now a check the build runs: **`scripts/ci/doc-citation-lint.mjs`**, wired as
`npm run lint:doc-citations` and into `.github/workflows/ci.yml` beside the sibling guards. It
verifies that every `file:line` claim resolves, and — the part that matters — walks back from the
cited line to its enclosing `create function` / `create table` and **fails if any later migration
redefines or drops that identifier.** Both real defects reproduce as failures against it; a version
that only checked the declaration line passed on both, which is why it walks backward.

One place a lens itself overstated, verified rather than relayed: the citations lens reported the
empty-funnel fallback renders "four invented values." It renders four invented **labels**, each
showing *"No proved count"* under a watermark reading *"no implied volume or conversion."* No number
is fabricated, and L-4 is written to the accurate version.

---

## 10. D-8 executed — what was stopped, and what was not

The coordinator split D-8: computing the right number is Phase 2, stopping the wrong one is now.
This section is the honest accounting of which is which.

### Stopped, on a live Solo surface

| Was | Is | Why the old one was false |
|---|---|---|
| `"Revenue this period"` | **`"Won this period (estimated)"`** | The value is `sum(d.value_cents)` over won-stage deals dated by `actual_close_date`. The period half was accurate; the word *Revenue* asserted money received, which the figure cannot prove |
| `"Active clients"` | **`"Active contacts"`** | The value counts `clients` rows with `status='active'`, and that column defaults to `'active'` while `create_contact` hardcodes it — so a row created as a lead is counted. One word, and deliberately no attempt at a better definition, because D-1 is held |
| `"N clients at risk"` ×4 | **`"N contacts at risk"`** | The same false noun over the same population — `at_risk_clients` counts `clients` rows with `status='active'` that have had no contact in 21 days. One is the greeting in `useCommandCenter.ts`; the other three are in `useSoloGamePlan.ts` (`:522`, `:718`, `:896`) — a chip and two evidence lines rendered **beside** it. Renaming only the greeting would have left a chip reading "clients at risk" next to a greeting reading "contacts at risk", which is worse than either extreme. D-7 rules the at-risk *threshold* into the dictionary as Phase 2 work; only the label moved here |
| Four invented funnel stages | An honest empty state | `analytics2.tsx` rendered `"Qualified lead" / "Proposal" / "Commitment" / "Confirmed outcome"` for tenants who created none. **No number was fabricated** — each read *"No proved count"* — so the defect was the invented **names**, and the fix is proportionate to that |

### Cleanup, not a fix — say so plainly

The ARPC hint was removed from `PracticeOverview.tsx`, and **that file is unreachable** (§2, L-3).
No figure a user can see was stopped by that edit. It is recorded as cleanup rather than counted as
one of the four.

### Found, and deliberately NOT changed

- **`src/agency/data/useAgencyMetrics.ts:139,141` still emits `"Revenue this period"` and
  `"Active clients"`** from the same `practice_dashboard_metrics` own-book values, on a **live**
  agency surface. This is a genuine tension and it is the coordinator's to resolve, not mine: the
  agency tier is explicitly parked, while §13 and the D-8 ruling say a false assertion does not wait
  for a phase. The fix is the identical two string swaps already approved. **Flagged, not taken.**
- **`PracticeOverview.tsx:117,129`** carry the same two labels. Unreachable, so not worth spending
  on; recorded so nobody rediscovers them.
- **The relabelled won figure is still formatted with a hardcoded `$`** (`useCommandCenter.ts`'s
  `usd()` pins `currency: "USD"`) over a sum that ignores `deals.currency`. D-3 has now ruled that
  summing across currencies is a live wrong number — so this is a **ruled** defect, and closing it
  needs the per-currency grouping that is Phase 2 compute work. `(estimated)` does not cover it.

### Capabilities removed, made visible (§58)

- The `"$X avg / client"` hint on `PracticeOverview` — gone, nothing replaces it, unreachable anyway.
- The four-stage cylinder silhouette **in the unproved state only**. The proved branch still renders
  it from server-issued stages, so the funnel visual is not gone from the surface — only from the
  state where it was drawn without evidence.
- **Four keyboard tab stops.** Each placeholder stage carried `tabIndex={0}`; the replacement is
  static text. A real interaction change, recorded because what those stops announced were the
  invented names.

### Evidence, separated by class

- **Automated** — `npx vitest run` over the three affected files: **3 passed, 52 tests, exit 0**.
  The failing assertion was inverted rather than deleted: `analytics2.render.test.tsx` had pinned
  the invented placeholder in place by counting four of them, and now asserts their absence by name.
- **Static** — `npx tsc --noEmit -p tsconfig.app.json`: pre-existing errors only, proven by reverting
  the edited files and diffing the output byte-for-byte; zero errors in any edited file.
  `lint:doc-citations` and its self-test pass.
- **Rendered / interactive / authenticated-runtime — `UNVERIFIED`.** This session has no
  browser-driving capability, so the four Solo viewports PAIGE-open and closed were **not** driven.
  Module 3's geometry proof is genuinely owed to a capable session, and is not claimed here. The
  change is copy plus suppression with no layout, token, colour or motion change, but that is an
  argument for low risk, not a substitute for the proof.
- **Protected seams** — the adversarial verifier declared all fifteen: two affected (responsive shell
  geometry, accessibility), thirteen explicitly not-affected. The two affected are the analytics2
  empty state changing from a four-item flex row to a single centred message, and its accessible
  name, which was verified accurate.

---

## 11. Definitions for the money-received ledger (answered 2026-09-24)

The Sales lane owns the ledger and produces the fact; this lane defines and measures it. These five
answers were requested before a migration exists, so that the ledger's shape is constrained by the
definition rather than the definition being retrofitted to a table. **They interlock — read them
together.**

Two were already ruled and are restated here so the ledger's authors can cite one document. Three
are new.

### 11.1 Revenue means RECEIVED — already ruled (D-9)

Invoiced is **billed**; contracted is **committed**; neither is revenue. That is §1's economic model
and the D-9 amendment: revenue is *confirmed payment from an evidenced source*. Three tiles on the
Sales desk implying three different answers is the defect, not the open question.

**Consequence for the ledger: it stores no field called revenue.** It stores payment facts. Revenue
is what a metric composes from them — like currency conversion and like net-of-fee, all three are
read-time compositions and none is a stored value.

### 11.2 Net of refunds, and the refund owns its own date — NEW

Not previously ruled, because refunds were unbuildable: `tenant_orders.status` permits `'refunded'`
(`20260629182422:158`) and nothing writes it.

**A refund is its own dated entry, never a mutation of the original.** Same principle as the
store-the-original currency rule, for the same reason: a refund that retro-changes a closed month
silently changes every report ever run against that month. The tenant who reconciled March against
their bank in April finds a different March in May — the D-2 trust defect arriving by a second route.

**The cost, stated rather than hidden.** "March revenue" and "what March eventually turned out to be
worth" become different questions. That is correct — it matches the bank statement, which is the
document the owner will check us against — but a period total is only final in the sense that cash
is final, so any figure presented as a closed period must be labelled *as of* a date.

### 11.3 Unattributed money counts as revenue; it enters no breakdown — NEW

The money arrived. Refusing to count it understates what the business took in, and the owner's bank
would disagree with us: **excluding real money is as much a lie as inventing it.**

But it enters **no** per-client, per-offer or per-campaign figure, because attributing it would be
inventing the link. Every breakdown discloses the excluded amount — which is exactly the
`coverage` / `exclusions` shape `analytics_sales_funnel_evidence_bundle` already emits
(`20261004000000:203-215`), so this reuses machinery rather than adding any (§18).

**Attribution and evidence class are orthogonal axes, never one spectrum.** A provider can confirm a
payment while we still have no idea which offer it was for. Two columns.

### 11.4 Only source-confirmed money enters the headline; tenant-asserted is still recorded — NEW

Partly ruled by D-9's *evidenced source*. The Sales desk already prints the promise *"Actual
received stays empty until a real source proves it"* — an owner-approved capability, so §58 says it
is not quietly broken.

**The trap to avoid:** §38 says tenants bring their own processor. A tenant taking checks has no
source that can confirm, so a strict source-confirmed-only rule leaves them permanently at zero —
the exact failure D-9's widening exists to prevent.

So `evidence_class` is a **column on the fact, not a filter at read time**, because *who says so* is
part of what happened. Source-confirmed feeds the headline. Tenant-asserted is recorded, shown
beside it, labelled, and **never merged into it**.

### 11.5 Per-currency — already ruled (D-3), plus one addition

Never summed across currencies. The coordinator's standing ruling holds and is not this lane's to
revisit: the ledger stores the original amount and currency always, and conversion happens at read
time against a recorded rate, because a converted figure written into the row destroys the original
irreversibly.

**One addition, same immutability principle: convert at the PAYMENT-DATE rate, not today's.**
Converting at today's rate makes a closed month's total drift every day — the problem the
store-the-original rule just solved, rebuilt one layer up. The rate and its date belong on the
figure, visible, not buried in the query.

### 11.6 What these answers constrain in the ledger's shape

Stated as constraints, not as a schema — the table is Sales-owned.

- **Append-only.** No `UPDATE` of amount, currency or date. A correction is a new reversing entry.
- `amount_minor` + `currency` — original, never overwritten, never converted in place.
- `occurred_at` — when the money moved. **This owns the period** (11.2).
- `entry_type` — payment / refund / chargeback / adjustment, so a reversal is a row (11.2).
- `reverses_entry_id` — nullable; a reversal points at what it reverses.
- `evidence_class` — NOT NULL, with `source_ref` null only when tenant-asserted (11.4).
- `attributed_terms_id` — nullable, and **null is a first-class state, not an error** (11.3).
- `tenant_id` — NOT NULL.
- **No stored `net`.** Net of platform fee (D-5) and net of refunds (11.2) compose at read time, as
  currency does, for the same reason.

### 11.7 Deliberately not ruled here

- **Whether a chargeback is a distinct `entry_type` from a refund.** The recommendation is yes —
  they are different facts with different costs and different reversibility — but that is provider
  semantics and Sales owns it.
- **Which FX source supplies the conversion rate.** Procurement under §38, not a definition.

### 11.8 None of this is blocked by D-1

The ledger keys attribution to **commercial terms**, not to a client classification, so it can be
built while the lead-versus-client boundary is still held. Only a *per-client* breakdown waits on
D-1 — and that is a metric, not the ledger's shape.

