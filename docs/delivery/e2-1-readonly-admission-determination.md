# E2-1 — read-only admission determination for `get_business_snapshot` (ANT-23)

**Status:** DETERMINATION RETURNED — no activation taken. E2-1 itself needs no admission
(ships dark); this document records whether admitting the tool later falls INSIDE the
owner-approved ANT-23 read-only Metric/Evidence admission class, and the exact difference
if it does not.

**SHELL:** SOLO. **Lane:** Experience 02 (Run My Business), ANT-147 / ANT-138.
**Date:** 2026-10-12. **Artefact under determination:** PR #2075 (head `5867a0055`).

## What ANT-23 approved (as recorded)

Per the owner's continuation directive (2026-10-12): ANT-23 "already records owner approval
for a narrowly scoped read-only Metric/Evidence admission class during INT-346 DRAINING."
The class design (R0, `docs/delivery/paige-conversational-loop-r0.md`, #1837 disposition)
is: during DRAINING, a conversational turn may be admitted with **only read-classified
tools**, per-call dispatch under a **read guard**, **no executor claim, no approvals, no
settlement** beyond the existing conversational FINAL receipt — implementable without
touching the effectful protocol or the activation gate. The **Platform Reach lane owns the
capability**; it is **not implemented on main** (verified 2026-10-12: conversational turns
splice the entire tool list, `paige-ai-chat/index.ts` conversational mode).

The exact ANT-23 wording on Linear was not readable from the authoring session (no Linear
tool access); this determination therefore analyzes both plausible wordings and names the
one fact that separates them. It does not reopen the approval.

## Permission and security matrix — `get_business_snapshot`

| Dimension | Value | Enforced where |
|---|---|---|
| Classification | `read` (Spine) / `effect: read` (kit) | registry + kit declaration; `action-risk` policy classifies it read_only |
| Risk / approval | `read_only` / `approval: none` / `actionRiskKey: null` | Spine action block; no approval card exists for this tool |
| Seat authority | **owner/admin only** (`seatAuthority: workspace-admin`) — owner ruling 2026-10-12: full COO snapshots stay owner/admin-only | Spine declaration **and** the INT-340 issuer's in-body check (`_analytics_metric_authorized`: active owner/admin membership), re-proved on every metric read |
| Tenant scope | Server-resolved (`current_user_tenant_id`), observed before AND after composing; a switch voids every domain | composer (`business-review.ts`) + issuer; model args cannot name a tenant |
| Data path | Every figure is an `issue_analytics_evidence_bundle` / `resolve_analytics_evidence_reference` read on the **caller's own JWT session**; no chat-only query, no service-role client in the path | corridor passes `supabaseClient` (caller JWT) only; verified by the independent review |
| Writes caused | None by the tool. The issuer's own bookkeeping write (short-lived evidence reference + revocation of the caller's previous reference per metric/range) is the fabric's explicit read-only carve-out (F2a ruling) | issuer; no Rail receipt is written (no recorder registered) |
| Model-controlled input | `period` (enum), `custom_start`/`custom_end` (strictly parsed, bounded, not inverted/future/too-long), `focus` (≤6, domain vocabulary only). Unknown keys refused. **Timezone comes from the turn request, not the model** | `business-review-chat.ts` parser + `snapshot.ts` period resolver |
| Output | The composer's bounded projection (≤6000 chars); evidence references never enter it; a refused/partial/unavailable read is never a zero; currencies never summed | `projectOperatingSnapshot` |
| Effects on the #1899 zero-tool contract | None until admitted — under INT-346 the tool is withheld with all others | conversational-mode splice precedes every offer |

**Independent security review:** the exact-head non-author review of PR #2075 (record on
the PR, verdict SHIP) audited tenant isolation, caller-JWT discipline, arg-injection
surface, output bounding and error-text containment for this wiring — CLEAN on that axis,
with the sequencing/wording P3s fixed at `5867a0055`.

## Determination

**Reading A — the approval is seam-scoped** ("read-only Metric/Evidence reads through the
INT-340 issuer, under a read guard, during DRAINING"): the snapshot **qualifies without
expansion**. Every underlying read is exactly such an issuer read under the same
authority; the tool adds no source, no write path (beyond the issuer's carved-out
bookkeeping), no approval surface, no executor claim, and no settlement change. The data
exposed by one call is the composition of reads the approved class already admits
individually, minus evidence references (which never leave the composer).

**Reading B — the approval is tool-enumerated** (it names `read_business_metric` only):
admitting `get_business_snapshot` is then a **material extension**, and the precise
difference is:

1. **One additional model-facing read-only tool.** Same seam, same seat authority
   (owner/admin), same read-guard discipline, serial with `read_business_metric` in the
   corridor.
2. **Breadth per call:** one call composes ~12–20 issuer reads across every live domain
   (a whole-business briefing) instead of one metric. The per-call information is the
   union of N approved single-metric calls; no new kind of data.
3. **Derived judgment text:** the projection includes the fabric's risk/attention wording
   ("act now"/"watch" reasons) — read-only derived text over the same figures, produced by
   the composer's rules, not by the model.
4. Nothing else changes: no approvals, no effects, no provider, no new authority.

**Disposition:** E2-1 takes no action on either reading (dark). When Platform Reach
implements the ANT-23 class, `get_business_snapshot` is admitted **only after** this
determination is confirmed against ANT-23's actual wording: under Reading A, documented
here as within scope; under Reading B, the four-point difference above is returned for
owner approval — never activated silently.

## Resolution (2026-10-12, E2-2)

The owner's continuation directive records that ANT-23's read-only policy covers this
access and delegates the activation authority: "The owner has already delegated authority
for the guarded conversational access required by Experience 02. ANT-23's read-only
policy and your activation authority are recorded." The reading is therefore resolved in
the seam-scoped sense: `get_business_snapshot` is admitted alongside `read_business_metric`
in the conversational read set, under the matrix above. E2-2 implements the class as
designed (narrowed offer + per-call guard; approvals, executor claims, settlement and the
activation gate untouched); the independent security review ran on the E2-2 PR.

## E4-S2 admission (2026-10-13, Experience 04)

**Authority.** The Experience 04 E4-S2 continuation (ANT-51 / ANT-147) directs: *"Obtain explicit
guarded admission and independent security review for any newly exposed Chat tool. The existing
read-only admission list must not be silently expanded."* This section is that explicit record. The
admission is conditional on the independent security review recorded below. Until that review
returns SHIP, the set is not merged.

**What is admitted.** Two tools, added to `CONVERSATIONAL_ADMITTED_READ_TOOLS` by name. The test
pins the literal, so any further name fails CI:

| Tool | Executor | Seat | Writes | What reaches the model |
|---|---|---|---|---|
| `read_client_engagement_status` | `public.find_clients_for_status`, then `public.read_client_engagement_status` | owner/admin of the active workspace (`_sales_invoice_actor`, in each body) | one capability receipt per call; no business data | a bounded projection of one client: agreement, installments, money by evidence class, invoices, delivery work, attention |
| `read_business_time_zone` | `public.read_business_time_zone` | the same | one capability receipt per call | the configured zone (or missing/invalid), and whether this person may change it; an optional zone **check**, never a save |

**How it differs from the E2-2 pair.**
1. **New data class: per-client records.** The E2-2 reads aggregate business metrics. These read one
   named client's agreement, invoices and work. The seat is the same owner/admin seat that already
   sees this in Sales. Client names come from the established picker helper. No email, phone, note,
   document body or storage key leaves the database.
2. **A lookup by name.** `find_clients_for_status` takes owner-typed text. It treats `%` and `_` as
   literal text, matches an email only when it is typed in full (a fragment never enumerates
   addresses), returns at most five rows with a "more" flag, and is scoped to the active workspace.
3. **Write adjacency.** `read_business_time_zone` sits beside an owner-only writer. The chat tool cannot
   reach the writer: it calls the read only, takes no `save` argument (an extra key is refused before
   any call), and its result tells the model it cannot save. Saving happens only in Setup, by the owner,
   through `set_business_time_zone`, followed by a readback.
4. **Receipts.** Each read writes one `record_capability_run` row, as `read_client_engagement_status`
   has since E4-S1. No other state changes.

**What does not change.** Actions, approvals, executor claims, settlement and the INT-346 activation
gate stay exactly as E2-2 left them. Live reaches the same two reads through the ordinary tenant tool
list, under the existing Live refusal of approvals.

**Independent security review — SHIP (2026-10-13), non-author reviewer, commit `73eb3e25`.** No P1 or
P2 findings. Measured on a local database in rollback-only transactions with the migration
re-applied:
- **Tenant isolation.** An owner of business A asking for business B is refused (42501). So is a
  member who is not an owner or admin; anon and `service_role` are denied. An admin is allowed, with
  `can_set=false`. A foreign `client_id` is refused by the already-merged status read. A persona whose
  tenant differs from the profile's active tenant fails closed.
- **No write path from chat.** Only `record_capability_run` receipts are written. `proposed_zone` is
  checked in TypeScript and never reaches `set_business_time_zone`. The per-call guard still refuses
  every tool outside the four admitted names.
- **Lookup.** `%%` and `__` match nothing, and `%_` matches only a literal `%_`. An email fragment
  matches nothing. Results carry no email, phone or notes.
- **Grants.** Both functions are `SECURITY DEFINER` with `search_path=pg_catalog,public`, and
  executable by `postgres` and `authenticated` only.
- **Fingerprints.** For all 29 incumbent tools the pre-hash input diff is identical: 0 lines removed,
  10 added. Those 10 lines are the tool-list push and the appended branch. No incumbent body changed.

**P3 notes:**
1. **Fixed before merge.** Client names appeared in the instruction field on the "several clients
   match" path. They now travel only in the labelled data projection, quoted.
2. **Accepted, recorded.** `_sales_invoice_actor` takes `FOR UPDATE` row locks on every read. This is
   the existing Sales pattern.
3. **Accepted, recorded.** The tenant-bounded `ILIKE` search is unindexed.

**Adversarial verifier — no blocker; 5 major, 7 minor.** All 5 majors were fixed before merge:
- per-invoice currency;
- record text quoted onto one line, so a name cannot forge a figure;
- dates in the business zone, and withheld when the zone is unset;
- a save answered after a workspace switch stays silent;
- tests added to catch the surviving mutants.

Minors fixed: the unknown-`client_id` wording, a negative "behind" printed as "ahead", a note for
invoices not listed, the work-deadline note, and the no-workspace state. One minor is recorded as
pre-existing and out of scope: `get_business_snapshot` still judges overdue receivables on the
device zone, with UTC as fallback.

**Authenticated acceptance.** PC-1 is superseded. Acceptance runs on the owner-designated SOLO
customer account, by ordinary sign-in through the QA lane (flow
`exp04-business-time-zone-acceptance`). Operator access is never customer authentication.

## Preserved boundaries

- INT-346 stays DRAINING; #1822 remains the separate activation hard stop; nothing in E2-1
  touches the rollout row or the admission machinery.
- The authenticated drive (typed Solo owner asks, snapshot answers from real data) is owed
  on `pc-1-qa-shared-synthetic` after admission, per the established QA gates.
