---
name: paige-owner-intent-fidelity
description: Module 1 of the Paige UI Delivery Standard. Require a written Owner Intent & Experience Contract — including what must NOT happen and what must be preserved — before any customer-visible or behaviorally significant change, and compare the delivered result against it before calling the work done.
---

# Owner Intent Fidelity

This is **module 1 of five** in the Paige UI Delivery Standard. It adds no new source of truth. Read
first, in order:

1. `docs/doctrine/paige-ui-delivery-standard.md` — the canonical standard (this module governs its
   [Design contract](../../../docs/doctrine/paige-ui-delivery-standard.md#design-contract), extended).
2. `.agents/skills/paige-ui-design/references/paige-quality-gates.md` — "Job and direction".
3. `CLAUDE.md` §70.2 (the Owner-Intent gate) and §70/§70.1.

It exists because a change can be technically correct, pass every test, and still violate what the
owner actually asked for. That is the failure this module stops — before the first edit, not after.

## The Owner Intent & Experience Contract (pre-edit, mandatory)

Before editing for any customer-visible or behaviorally significant change, state the contract. Record
it in the change's evidence record (`docs/evidence/ui-delivery/*.md`) under these fields:

- `OWNER_INTENT` — exact owner objective; target actor and user job; primary outcome; required
  experience; the visual direction CC decides under §00 (Flow-by-Flow, then Impeccable), citing any prior pack as reference (§18/§30) rather than as an authority above it;
  required interaction behavior; required platform/domain behavior.
- `MUST_NOT_HAPPEN` — **mandatory.** The outcomes, regressions, and side effects that would mean the
  change failed even if it "works": what it must not break, remove, hide, reword, reframe, or charge.
- `MUST_PRESERVE` — **mandatory.** The existing behavior, visuals, interactions, and protected seams
  that must remain unchanged (hand the named seams to module 4, `paige-protected-behavior-regression`).
- `ACCEPTANCE_CRITERIA` — the testable conditions a human must be able to complete on the real
  platform for the change to count as done (feeds module 5, `paige-release-acceptance-evidence`).

Also carry forward to the record: accessibility and responsive expectations (module 3), truth
boundaries (module 5), design-approval status, and go-live-approval status.

## The gate

- No implementation begins until the contract is stated. A missing `MUST_NOT_HAPPEN` or
  `MUST_PRESERVE` is an incomplete contract, not an optional field.
- Before calling the work done, compare the delivered, rendered/driven result against the contract.
  A mismatch is a delivery defect even when lint and tests are green.
- Never silently reinterpret, narrow, or genericize owner direction. Reference imagery, color, motion,
  layout, language, and feel named by the owner are acceptance requirements, not suggestions.
- This module records and ports owner/Claude-Design intent; it holds **zero** visual-design authority
  (§00). It checks fidelity to the approved direction; it never invents or overrides it.

Backward compatibility: the `OWNER_INTENT` / `MUST_NOT_HAPPEN` / `MUST_PRESERVE` / `ACCEPTANCE_CRITERIA`
fields are recognized by the CI guardrail — validated when present, never required — so a record that
omits them still passes; they become required only per an announced cutover — see the standard's
"Backward compatibility" note.
