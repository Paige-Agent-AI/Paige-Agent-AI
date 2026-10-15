# Source contract — `tenant_client_agreements` (Solo Sales)

What the client-agreements store may and may not expose to Spine, Rail or Mind.

**Audience:** whoever registers a Spine capability, Rail projection or Mind evidence block over Solo
Sales agreements. **Author:** the session that built `tenant_client_agreements`. **Status:**
classification only — the capability and its placement belong to Spine item 4 (issue #890).

**Status.** The source is live: migration `20261200000000`, merged `096d6c9d`. Persistence was
confirmed on production (`xygzykjyynhzqytbqnzu`) on 2026-09-03, after the `deploy-migrations` run for
that commit, by reading `supabase_migrations.schema_migrations` directly: `20261200000000` is present
**and is the ledger head**, so there is zero drift. The table, its four functions, three triggers, two
policies and the grant posture were read back the same way. **Authenticated runtime remains OWED** —
the merge commit recorded both as owed and only the persistence half has since been checked. **No Spine capability is registered against it.** That placement decision belongs to the
Spine source-contracts workstream (item 4, Clients / Pipeline / Sales), not to this document — see
issue #890 for why. This file supplies only the part that had to come from the session that built
the table: what is safe to let out of it.

**Revision note (§13).** The first draft of this document was wrong in three ways that an adversarial
read caught before it merged: it classified `price_basis` as safe when it dereferences to an amount
(§3); it omitted four of the table's twenty-seven columns under a sentence claiming total coverage
(§3); and it asserted a client-role hazard that does not exist, while missing the one that does (§4).
Each correction is marked where it lands. The wrong claims are not preserved — this is a safety
boundary, and a reader must not have to work out which half to believe — but they are named here so
the record of what changed is not silent.

---

## 1. What this source is

Where a Solo business records **the commercial agreement it has with one of its own existing
clients** — the arrangement, the negotiated figure, the cadence, the dates, and where in its life the
agreement currently sits.

It is emphatically **not** a billing store. PAIGE is never merchant of record for a tenant's client
revenue; nothing in this table is collected, settled, metered or reconciled by the platform, and no
row here has ever touched a payment provider. A row is a record of *what was agreed*, written by the
business, for the business. Anything that reads it and implies otherwise has broken the money
boundary regardless of how the data is shaped.

The tenant's own surface reads it through `src/solo/useSoloCommercialTerms.ts`. Anything Spine-side must
be a **second derivation over the same source, under its own workspace-wide authority gate** — never
a re-projection of the caller's row-filtered read, for the reason set out in §4. It must never become
a second source of truth.

---

## 2. The constraint, verbatim

> no amounts, client details, payment credentials, or contract terms into Spine, Rail, or Mind

That is the owner's wording and it is the binding rule for this source. What remains permissible is
narrow and deliberate: **readiness, count/status, a source-backed next action, and freshness.**

"Source-backed" is doing real work in that sentence. A next action may only state something the read
actually established — *there are no catalog offers yet, so no agreement can be recorded* — and may
never be a generic suggestion dressed as a finding. If a next action cannot be derived from what was
read, the honest output is no next action, not an invented one.

---

## 3. Column classification

All twenty-seven columns of the shipped table are below. Every one is on exactly one side of this
line; there is no discretionary middle.

### May never cross

| Column | Why |
|---|---|
| `agreed_amount_minor` | an amount |
| `agreed_currency` | pairs with the amount to reconstruct it |
| `price_basis` | **dereferences to an amount — see below** |
| `catalog_price_id` | dereferences to a price |
| `catalog_price_snapshot_minor` | an amount |
| `catalog_price_snapshot_currency` | as above |
| `catalog_price_snapshot_interval` | a contract term |
| `catalog_price_snapshot_kind` | a contract term |
| `catalog_price_snapshot_at` | **its presence is equivalent to an amount, and it dates the deal — see below** |
| `contact_id` | client identity |
| `offer_id` | identifies what a named client bought |
| `id` | the join key that makes a per-row signal expressible at all (§3a) |
| `title` | tenant-authored free text; routinely carries the client's name |
| `notes` | tenant-authored free text; unbounded |
| `billing_interval`, `interval_count`, `installments_total`, `payment_schedule` | contract terms |
| `starts_on`, `renews_on`, `ends_on` | a date range **is** a term; a renewal date is a term with a deadline |
| `created_at` | the date the agreement was recorded — a term |
| `created_by` | identifies a person |

**`price_basis` — corrected; it was previously listed as safe, and it is not.** Its three values are
each a statement about the money. `catalog` is the sharpest: `tca_price_basis_catalog_ck` requires a
catalog-basis row to carry both amounts, and on create the resolver sets `_agreed_amount_minor :=
_snap_minor` — so the agreed figure *is* the list price, and the caller does not get to disagree. The
list price is not private: `GRANT SELECT ON public.tenant_prices TO anon` plus `tpr_public_active_read`
exposes active prices of any `storefront_enabled` tenant **to anonymous visitors**, and
`tpr_members_read` exposes them to every tenant member. So in a workspace with one active offer,
emitting `price_basis: catalog` tells a storefront visitor exactly what that client agreed to pay.
`negotiated` states that the client did *not* pay list — a concession exists, which is a term.
`quote_pending` discloses an open, unpriced negotiation. There is no safe coarsening of this field.

**`catalog_price_snapshot_at` — newly classified.** `tca_snapshot_needs_time_ck` enforces
`(catalog_price_snapshot_minor IS NULL) = (catalog_price_snapshot_at IS NULL)`, so its NULL-ness is
*constraint-equivalent* to the presence of a barred amount — even a derived `has_snapshot: true/false`
discloses it. It is also set to `now()` at the moment the plan was priced and made immutable by
`trg_agreement_snapshot_immutable`, so unlike `updated_at` it is a permanent, per-row timestamp of the
commercial event.

**`title` and `notes` deserve their own line.** They are free text a human types, so no classifier can
bound what they contain — assume every one of them holds a client's name and a price, because in
practice some will. They never cross under any summarisation, truncation or paraphrase.

### May cross

| Column | As what |
|---|---|
| `status` | a closed vocabulary: `draft` · `active` · `paused` · `completed` · `cancelled` |
| `term_kind` | a closed vocabulary — **in aggregate only**, see the caution below |
| `tenant_id` | the caller's own server-resolved workspace, and only that (§3a) |
| `updated_at` | freshness **only when quantized**, see below |
| *(derived)* row counts | as a **band**, never a raw count, and never joined to an identity |

**Caution on `term_kind`.** `one_time` / `recurring` / `installment` / `deposit` / `custom_quote` is
arguably itself a contract term. It is permissible **only** in aggregate — "three recurring agreements
are active" — and never attached to a single row, because a single row plus a term kind plus a count
of one is a description of one named client's contract by another route.

**Why counts are bands, not numbers.** `validateSpineRegistry` fails any capability whose fact key has
no enumerable allow-list, and the resolver rejects at runtime any fact value not on that list. A raw
count is not enumerable, so it is not merely unwise here — it is unregisterable.

**Why `updated_at` must be quantized.** It is not a staleness marker. `tca_set_updated_at` fires
`BEFORE UPDATE`, so it moves on every write including a pure status change — it is an *event*
timestamp. In a workspace with one live agreement, `max(updated_at) FILTER (WHERE status IN
('active','paused'))` is the moment that agreement was activated: the commencement date, which this
document bars as a term. So it may cross only coarsened to a day or week bucket, or reduced to a
boolean staleness flag — never as a raw timestamp. (It is also the optimistic-concurrency token both
writers consume as `_expected_updated_at`; it is a protocol value, not merely metadata.)

### Two rules that the column table alone cannot express

**A count of one is an identity.** In a workspace with one client, every aggregate is that client's
private business restated. Any projection must suppress below a threshold, and the threshold must be
a named number in the implementation rather than a word in this document.

**No differencing.** A consumer must never be handed a value whose *change between two reads* is
itself the signal. A live-agreement band moving `none → a few` says an agreement was signed in that
window; `a few → none` says one was cancelled. A polling consumer accumulates the contract event log
without ever reading a barred column. This is the rule the static cardinality threshold above does
not cover, and it binds at every n, not only at n=1.

---

## 3a. The registration rule — this source may not use the evidence path

**A capability over this source may never be registered with an `evidence` block routed through
`resolveSpineEvidence`.** That path is keyed on one client by construction: it rejects any signal
whose `subject_type` is not `"client"`, rejects any whose `subject_ref` does not match the requested
client, returns `subject_required` when no client ref is supplied, and calls the adapter as
`rpc(adapter, { p_client_ref, … })`. `SpineSignal` itself makes `subject_type`, `subject_ref` and
`source_record_ref` mandatory. There is no aggregate signal shape.

So an engineer who classifies correctly, emits only permitted fields, and registers an `evidence`
block copied from the pipeline domain will produce **one signal per client carrying that client's
status and term kind** — precisely what §3 forbids — and nothing in the pipeline will object, because
nothing in the pipeline knows about aggregation. The rule would be unenforceable at exactly the
moment someone followed this document.

The admissible shape is the tenant-scoped readiness block that deliberately bypasses that machinery,
as `businessContextChatEvidence.ts` and `teamAuthorityChatEvidence.ts` both do and both say so in
terms. No output may carry `subject_ref`, `subject_type`, or any per-agreement identifier — which is
why `id` is barred in §3.

`tenant_id` is the one identifier that may cross, because it is the caller's *own* resolved workspace,
already in their session. It has to: `get_paige_persona_context()` resolves a linked client's
workspace *ahead of* `current_user_tenant_id()`, so a user who is a client of workspace B and a team
member of workspace A holds a conversation scoped to B while a read like this resolves A. Without the
resolved workspace returned alongside the rows, a Chat adapter cannot bind them to the conversation at
all. Both shipped readiness reads already return it.

---

## 4. Authorization facts a resolver inherits

Measured against the migration source.

- **Table grants:** `authenticated` → `SELECT` only; `anon` → nothing. Writes go through
  `save_client_agreement` / `set_client_agreement_status`, both `SECURITY DEFINER`, both executable by
  `authenticated` only, with `anon` and `PUBLIC` revoked. **Unverified caveat (§13):** the migration
  neither grants nor revokes `service_role`, and the table's own threat model assumes that role *can*
  write — it is why `enforce_agreement_tenant_links` exists. Confirm the observed `relacl` before
  relying on "every write goes through the RPCs"; this repo has already shipped tables whose
  default-privilege grant did not fire.
- **Policies:** `tca_tenant_isolation` (RESTRICTIVE / ALL) and `tca_visible_with_its_client`
  (PERMISSIVE / SELECT). Postgres requires every RESTRICTIVE policy to pass *and* at least one
  PERMISSIVE, so agreement visibility is deliberately inherited from the client it belongs to.
- **The platform-owner escape:** `is_platform_owner()` is a disjunct *inside* the restrictive policy,
  so a platform owner is not tenant-gated at all and passes the permissive side too. The surface
  adapter compensates with an explicit `.eq("tenant_id", …)` and explains why; a resolver that omits
  that filter inherits the escape.

Three traps, all of which have already cost time elsewhere in this repo:

**A denied read is byte-identical to an empty one.** `SELECT` is granted to `authenticated` and scope
is enforced by RLS, so a caller outside the policy receives `200` / `[]` / **no error** — exactly what
an empty book returns. A resolver that models authorization as an error channel reports a confident,
false *zero* to the very callers it was meant to refuse. Derive readability from authority; say
*unknown* where you cannot prove *none*.

**A partial read is byte-identical to a complete one.** This is the third state, and it is the one
that produces a false aggregate rather than a false zero. `tca_visible_with_its_client` is an `EXISTS`
over `clients` evaluated under the caller's own RLS, so a **coach** reads a *subset* — not zero, not
all — and "derive readability from authority" does not save you, because a coach genuinely has
authority to read something. A resolver reading under the caller's RLS would report "1 live agreement"
for a workspace holding twelve. **Therefore any workspace-wide aggregate must run `SECURITY DEFINER`
with workspace-wide authority, gated on `is_tenant_admin` of the resolved tenant — never on the
caller's row-filtered read.** The surface adapter documents this same hazard for its own read.

**The gate must be tenant-scoped, not a global role — corrected.** The earlier draft said the risk was
a client-role caller resolving the tenant. *That is not true*: `tenant_role` is
`('owner','admin','coach','member')` with no client member, a portal client is not in `tenant_members`,
and `current_user_tenant_id()` returns NULL for them — the restrictive gate refuses first, as this
table's own migration states. The real hazard is twofold. A plain `member` or `coach` **does** resolve
the tenant and would otherwise receive a workspace-wide commercial aggregate. And `clients_admins_full`
gates on `has_any_role()` against a `user_roles` table that carries no `tenant_id`, so someone who is
admin of *any* tenant and a member of another can read that other tenant's client book — and, through
the `EXISTS`, its agreements. A tenant-agnostic global role therefore both wrongly admits and wrongly
refuses; `is_tenant_admin` on the *resolved* tenant is the only predicate that asks the right question.

**On vocabulary stability.** `status` is closed by CHECK today, but the surface adapter carries a sixth
`unrecognised` member precisely because a later migration can widen it. A `factValues` list of the five
would then make the whole signal fail validation and collapse the capability to `resolver_unavailable`.
That fails closed — an outage, not a leak — but the mapping must be explicit and unmapped values
suppressed, rather than assuming the vocabulary never moves.

---

## 4a. The projection, tier by tier (§51/§56)

`docs/doctrine/tier-matrix.md` (Campaigns → Sales, Slice 2) records what each tier may **read from the
table**. This section records what each tier may receive **from a projection over it**. They are
different questions and their answers differ — a coach may read some rows and must still be refused an
aggregate. Where the two disagree, this section governs anything crossing into Spine, Rail or Mind.

| Tier | Projection outcome | Why |
|---|---|---|
| Platform operator / God | Permitted, via `is_platform_owner()`, matching `get_business_context_readiness` | `is_platform_owner()` is a disjunct *inside* the restrictive policy, so a resolver omitting an explicit tenant filter inherits an ungated read of every workspace. A DEFINER resolver must resolve one tenant and scope to it. |
| Agency (as a tenant) | Its **own** workspace only. **Never an aggregate across its sub-accounts.** | `current_user_tenant_id()` resolves exactly one workspace, and no `clients` policy grants a parent any read of a child's book — so a cross-child aggregate is not merely unbuilt, it is unreachable. Any future capability offering one is a new §9 decision and an owner ruling, not an extension of this contract. |
| Solo tenant | Permitted for owner/admin, gated on `is_tenant_admin` of the **resolved** tenant | The same predicate both writers use, so the read can never reach anyone who could not already have written the record it summarises. |
| Sub-account | Identical to Solo — its own workspace only, isolated from the parent | A sub-account resolves its own `tenant_id`; §51's absolute invariant keeps it a non-manager tier. |
| Plain member / coach | **Refused** — the fixed row set with a reason, never a band | A coach genuinely has authority to read *something*, which is why "derive readability from authority" does not save you (§4). A workspace-wide aggregate needs workspace-wide authority. |
| Client / portal user | **Refused** | Not in `tenant_members`; `current_user_tenant_id()` is NULL for them and the restrictive gate refuses first. |
| Anonymous | **Refused** | `anon` holds nothing on the table and is revoked on both RPCs; any resolver must revoke `anon` likewise. |

A refusal is the fixed row set carrying a reason, never zero rows — a busy workspace and an empty one
must be indistinguishable to a caller who is refused.

---

## 5. What is not decided here

- **Whether a capability should exist at all**, and if so whether it belongs as a new registry entry
  or as an extension of an existing aggregate. `practice_dashboard_metrics` is the obvious candidate —
  it already aggregates pipeline + deals + clients with the tenant server-resolved — but note before
  reaching for it that it gates on nothing more than a tenant resolving, and already emits raw
  `won_value_cents`, `pipeline_value_cents` and `arpc_cents` to any tenant member. Extending it with
  agreements data would breach §4's own `is_tenant_admin` requirement; it would need that gate first.
- **The projection's exact shape** — row set, closed vocabularies, refusal shape, and the suppression
  threshold §3 requires be named. Constrained by §3/§3a above, but authored wherever the capability
  lands.

Neither is withheld for lack of an opinion. They are withheld because `registry.ts` is a single shared
file with one owner, and resolving that seam before building is the part of §18 that actually prevents
the duplication rather than describing it afterwards.

### A worked draft exists, unverified

`docs/delivery/drafts/client-agreements-readiness.draft.sql` holds a drafted read-only resolver
against this source. It is deliberately **not** in `supabase/migrations/` — that directory is applied
to production wholesale by `deploy-migrations.yml` on merge, and this file has not been executed,
proven, or reviewed. It is a starting point for whoever owns the placement, not a proposal to merge.

It reached §4's authorization conclusions independently and agrees with them, and it independently
found the counts-must-be-bands constraint in §3 and the `tenant_id` requirement in §3a. It also
**independently barred `price_basis` as a contract term** — getting right, on its own, the one thing
the first revision of this document got wrong.

Its one conflict with §3 as corrected: it emits a raw `max(a.updated_at)`, and a
`max(a.updated_at) filter (where status in ('active','paused'))`, as `as_of`. The second of those is
exactly the commencement date §3 now bars, so the quantization rule must be applied to it before it
goes anywhere. It is otherwise unreviewed and unexecuted; §3a applies to it in full.
