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

## Preserved boundaries

- INT-346 stays DRAINING; #1822 remains the separate activation hard stop; nothing in E2-1
  touches the rollout row or the admission machinery.
- The authenticated drive (typed Solo owner asks, snapshot answers from real data) is owed
  on `pc-1-qa-shared-synthetic` after admission, per the established QA gates.
