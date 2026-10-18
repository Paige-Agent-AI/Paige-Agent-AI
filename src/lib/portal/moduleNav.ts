import type { LucideIcon } from "lucide-react";
import type { PortalModuleOverlay } from "@/hooks/useClientPortalConfig";
import { PORTAL_MENU_ENTRIES } from "./portalMenu";

// ---------------------------------------------------------------------------
// Client-portal nav — the flat catalog helpers, kept for their existing callers.
// ---------------------------------------------------------------------------
// E09 Slice M: the customer menu is assembled by assemblePortalNav() in ./portalMenu, the ONE registry of
// portal destinations (floors, groups, fixed entries, the tenant overlay incl. labels). AppNav, the owner's
// menu editor and PortalStudio's "View as client" all call it. These flat helpers remain for callers that
// only ask "which catalog keys route anywhere" (Messages' Resources hint, the owner dashboard's module
// list); their route map is DERIVED from the registry so the two can never disagree (§18).
//
// The funding-vertical surfaces are routable ONLY for a tenant whose OPT-IN funding Playbook lists those
// keys (§2 clarification, 2026-07-09) — they are absent from every coaching-generic preset.

/**
 * A catalog key renders ONLY if it maps to a live route. Derived from PORTAL_MENU_ENTRIES: every live entry a
 * Playbook catalog can place (Messages is fixed chrome, Planning is staff-only; neither is a catalog key, and
 * a non-live entry such as Payments has no page yet).
 */
export const MODULE_ROUTES: Record<string, { href: string; icon: LucideIcon }> = Object.fromEntries(
  PORTAL_MENU_ENTRIES
    .filter((e) => e.live && e.key !== "messages" && e.floor !== "staff")
    .map((e) => [e.key, { href: e.route, icon: e.icon }]),
);

/** A catalog module resolved to a real route, carrying its authored position. */
export interface PortalCatalogItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  catalogIndex: number;
}

/** A resolved, overlay-applied nav entry ready to render. */
export interface PortalNavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

/**
 * The MODULE CATALOG + default order: the Playbook's portal.modules filtered to
 * those with a real route. A module the app can't route to is dropped rather
 * than shipped as a dangling link (§13). Each item keeps its catalog index so
 * the overlay can reorder/hide without ever inventing a key.
 */
export function catalogRoutableItems(modules: { key: string; label: string }[]): PortalCatalogItem[] {
  return modules
    .map((m, idx): PortalCatalogItem | null => {
      const route = MODULE_ROUTES[m.key];
      return route
        ? { key: m.key, catalogIndex: idx, label: m.label, href: route.href, icon: route.icon }
        : null;
    })
    .filter((item): item is PortalCatalogItem => item !== null);
}

/**
 * Apply the tenant PRESENTATION OVERLAY over the catalog. Purely subtractive /
 * reordering and FAIL-OPEN: an absent/empty/malformed overlay yields byte-for-
 * byte the catalog order.
 *   - visible:false  → key is hidden.
 *   - order (number) → key sorts by it; keys without an order keep their catalog
 *                      position (effectiveOrder falls back to catalogIndex, with
 *                      catalogIndex as a stable tiebreak).
 *   - catalog key absent from overlay → stays VISIBLE in original order.
 *   - overlay key absent from catalog → ignored (we only iterate the catalog),
 *                                       so the overlay can never create a link.
 */
export function applyPortalOverlay(
  catalog: PortalCatalogItem[],
  overlay: PortalModuleOverlay[] | undefined,
): PortalNavItem[] {
  const overlayByKey = new Map<string, { visible?: boolean; order?: number }>();
  if (Array.isArray(overlay)) {
    for (const o of overlay) {
      if (o && typeof o.key === "string") overlayByKey.set(o.key, o);
    }
  }
  return catalog
    .filter((item) => overlayByKey.get(item.key)?.visible !== false)
    .sort((a, b) => {
      const ao = overlayByKey.get(a.key)?.order;
      const bo = overlayByKey.get(b.key)?.order;
      const aEff = typeof ao === "number" && Number.isFinite(ao) ? ao : a.catalogIndex;
      const bEff = typeof bo === "number" && Number.isFinite(bo) ? bo : b.catalogIndex;
      return aEff !== bEff ? aEff - bEff : a.catalogIndex - b.catalogIndex;
    })
    .map(({ key, label, href, icon }): PortalNavItem => ({ key, label, href, icon }));
}
