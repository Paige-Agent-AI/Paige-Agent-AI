/**
 * URL ⇄ IA. The one place an operator address becomes a slot and a view (§18).
 *
 * The console is URL-DRIVEN, not state-driven: `/operator/{slot}/{view}` resolves against
 * `OPERATOR_SLOTS` on every render, so there is no local tab state to drift out of sync with
 * the address bar — which is what keeps all thirty-two views deep-linkable and Paige-addressable
 * (§10/§65).
 *
 * TWO FAILURES, KEPT APART — this distinction is carried forward from the shell this replaces,
 * where it was the one genuinely load-bearing idea in the resolver:
 *   • An UNKNOWN SLOT is a dead address. It renders a 404 that names it. It does NOT silently
 *     redirect to Fleet — a redirect throws away the address the operator (or an agent, or a
 *     shared link) actually asked for, and hides the fact that it was wrong.
 *   • A KNOWN slot with an unknown VIEW is a stale address. Its slot is real and its default
 *     view is the honest answer, so the caller canonicalises the URL rather than rendering one
 *     view while the address bar names another.
 *
 * Rule 6: every catalogue read here is guarded. A slot carrying no views resolves `view: null`
 * rather than indexing into an empty array.
 */
import { findSlot, viewSlug, type OperatorSlot } from "@/operator/ia/operatorIA";
import { SETTINGS_MENU, settingsGroupForView } from "@/operator/ia/settingsIA";

export type OperatorAddress =
  | { readonly kind: "unknown"; readonly section: string }
  | {
      readonly kind: "resolved";
      readonly slot: OperatorSlot;
      /** The view's name as the design spells it — shown, never a slug. Null if the slot has none. */
      readonly view: string | null;
      /** A view slug was supplied and matched nothing: the URL contradicts the surface. */
      readonly stale: boolean;
    };

/** `/operator/{slot}` — a slot's own address, which resolves to its first view. */
export function slotPath(slotId: string): string {
  return `/operator/${slotId}`;
}

/** `/operator/{slot}/{view}` — the canonical address of one view. */
export function viewPath(slotId: string, view: string): string {
  if (slotId === "settings") {
    const group = settingsGroupForView(view);
    if (group) return `/operator/settings/${group.slug}${view === group.views[0] ? "" : `/${viewSlug(view)}`}`;
  }
  return `/operator/${slotId}/${viewSlug(view)}`;
}

/** The address of what is actually on screen, for the URL bar, a share, or a hand-off to Paige. */
export function canonicalPath(address: OperatorAddress): string {
  if (address.kind === "unknown") return `/operator/${address.section}`;
  return address.view ? viewPath(address.slot.id, address.view) : slotPath(address.slot.id);
}

export function resolveOperatorAddress(
  section: string | undefined,
  splat: string,
): OperatorAddress {
  // Preserve the old Operator Intelligence bookmark under the existing guarded shell.
  if (section === "platform" && splat.replace(/\/$/, "") === "intelligence") {
    return { kind: "resolved", slot: findSlot("settings")!, view: "PAIGE Intelligence", stale: true };
  }
  // Both generations of the Settings Mind bookmark follow the owner-approved Fleet move.
  if (section === "settings" && ["mind", "paige-intelligence/mind"].includes(splat.replace(/\/$/, ""))) {
    return { kind: "resolved", slot: findSlot("fleet")!, view: "Mind", stale: true };
  }
  const slot = findSlot(section);
  if (!slot) return { kind: "unknown", section: section ?? "" };

  const [requested] = splat.split("/").filter(Boolean);
  const views = slot.views ?? [];
  if (views.length === 0) return { kind: "resolved", slot, view: null, stale: false };
  if (slot.id === "settings") {
    const segments = splat.split("/").filter(Boolean);
    const group = SETTINGS_MENU.find((g) => g.slug === requested);
    const legacyView = views.find((v) => viewSlug(v) === requested);
    const selected = group ? group.views.find((v) => viewSlug(v) === segments[1]) ?? group.views[0] : legacyView ?? "Setup";
    const path = viewPath("settings", selected);
    return { kind: "resolved", slot, view: selected, stale: Boolean(requested) && `/operator/settings/${segments.join("/")}` !== path };
  }

  const matched = requested ? views.find((v) => viewSlug(v) === requested) : undefined;
  const view = matched ?? views[0];
  return { kind: "resolved", slot, view, stale: Boolean(requested) && !matched };
}
