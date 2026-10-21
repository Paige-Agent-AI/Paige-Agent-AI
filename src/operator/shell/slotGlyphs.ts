/**
 * The rail's glyphs. Six from the pack's `P.PLACES` path data
 * (`docs/design-references/cd-packs/super-admin-shell-v3/paige-ia.js`, L8-L15).
 *
 * They live HERE rather than in `ia/operatorIA.ts` because that module is the six-slot
 * CONTRACT — six slots, thirty-two views, tested against the pack — and it is not ours to add
 * fields to. A glyph is chrome for one shell; the contract is the IA. Same source of truth,
 * two consumers.
 *
 * Rule 6 (guard every catalogue lookup): `slotGlyph` returns null for a key it does not hold,
 * so an unknown slot renders a row without a mark rather than blanking the rail.
 */
import type { OperatorSlotId } from "@/operator/ia/operatorIA";

const GLYPHS: Readonly<Record<OperatorSlotId, string>> = {
  fleet:
    "M2 8a6 2.9 0 1 0 12 0a6 2.9 0 1 0-12 0 M6.4 8a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0",
  relationships:
    "M4.2 4.6a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0 M9.6 11.4a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0 M6.6 6.6l4.4 3.6 M2 13.4c0-2 1.6-3.2 4-3.2",
  sales: "M2 12.5L6.2 8.3l2.5 2.5L13.4 6 M13.4 6v3.2 M13.4 6h-3.2",
  campaigns: "M2.6 6.4h3.2L11 3.2v9.6L5.8 9.6H2.6z M13.2 5.6a3.4 3.4 0 0 1 0 4.8",
  marketplace: "M2.6 6.2h10.8l-1 7H3.6z M5.4 6.2V4.4a2.6 2.6 0 0 1 5.2 0v1.8",
  analytics: "M2.5 13.4V9.2 M6.2 13.4V4.6 M9.8 13.4V7 M13.4 13.4V2.6",
  settings:
    "M6.2 8a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0 M8 2.2v2 M8 11.8v2 M2.2 8h2 M11.8 8h2 M4 4l1.4 1.4 M10.6 10.6L12 12",
};

export function slotGlyph(id: string): string | null {
  return (GLYPHS as Record<string, string | undefined>)[id] ?? null;
}
