---
name: paige-visual-immersive-quality
description: Module 2 of the Paige UI Delivery Standard. Hold every visible experience to Paige's premium product bar and to Impeccable's craft floor, with motion that serves a purpose.
---

# Visual & Immersive Quality

This is **module 2 of five** in the Paige UI Delivery Standard. It adds no new source of truth. Read
first:

1. `docs/doctrine/paige-ui-delivery-standard.md` — the
   [Design contract](../../../docs/doctrine/paige-ui-delivery-standard.md#design-contract).
2. `.agents/skills/paige-ui-design/references/paige-quality-gates.md` — "Visual and interaction quality".
3. `docs/design-references/CHEESY-TELLS.md` — the enumerated anti-pattern catalog.
4. `CLAUDE.md` §00 (jurisdiction) and §11 (premium floor).

## Jurisdiction (§00) — read this before anything else

Claude Code has **zero** authority over visual design. This module does not rank options, propose a
treatment, or render a taste verdict. It does two things that are correctness, not taste: (a) verify
the direction CC set under §00 is held to **Impeccable's** craft floor, and (b) verify the
listed quality properties hold as **measurements** (contrast ratios, token usage, state presence,
reduced-motion behavior). What to change about any of them is CC's call, with the owner approving (§00).

## What this module verifies

Against the approved pack and the premium bar:

- information hierarchy; spacing, type, color, tokens, and brand consistency;
- purposeful imagery/graphics; non-generic composition (no generic card grids, empty gradients, fake
  dashboards, ornamental 3D);
- **meaningful motion only** — state-aware, performance-aware, and reduced-motion-safe; no decorative
  motion without a functional purpose; no fake "AI working" theater;
- intentional empty, loading, error, and success states;
- visual density and readability; responsive design; dark/light theme behavior where supported;
- accessibility and contrast (hand keyboard/focus/SR depth to module 3);
- no copied competitor trade dress, UI kit, or marketing copy — study principles, never clone.

## Evidence it requires

- `VISUAL_DIRECTION` — the approved pack/tokens this ported from, and the fidelity check.
- `MOTION_PURPOSE` — for any added/changed motion: what state or relationship it communicates, and its
  reduced-motion behavior. "Decorative, no purpose" fails.

Visuals are checked against **rendered evidence**, never prose. Backward compatibility: `MOTION_PURPOSE`
is recognized by the CI guardrail — validated when present, never required — required only per an
announced cutover.
