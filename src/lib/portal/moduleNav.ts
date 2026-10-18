import type { LucideIcon } from "lucide-react";
import {
  Home, BookOpen, ListChecks, ClipboardList, FileText,
  CreditCard, Landmark, Compass, Wallet, Building2, FileSignature, Handshake, CalendarClock,
} from "lucide-react";
import type { PortalModuleOverlay } from "@/hooks/useClientPortalConfig";

// ---------------------------------------------------------------------------
// Client-portal nav — the ONE source of truth for how the Playbook module
// CATALOG + the tenant PRESENTATION OVERLAY resolve into the /app nav (§9/§10).
// ---------------------------------------------------------------------------
// AppNav (the live client chrome) and Client Portal's "View as Client" preview
// both compute their tab list from these helpers, so the preview can never drift
// from what a client actually sees (§13 — no fork, one merge rule).
//
// The funding-vertical surfaces below are routable ONLY for a tenant whose
// OPT-IN funding Playbook lists those keys (§2 clarification, 2026-07-09) — they
// are absent from every coaching-generic / fitness / agency / consulting preset,
// so a non-funding client never sees a funding tab.

/** A module key renders in the portal ONLY if it maps to a route that exists. */
export const MODULE_ROUTES: Record<string, { href: string; icon: LucideIcon }> = {
  home: { href: "/app", icon: Home },
  learn: { href: "/app/learn", icon: BookOpen },
  resources: { href: "/app/learn", icon: BookOpen },
  approvals: { href: "/app/approvals", icon: ListChecks },
  actions: { href: "/app/actions", icon: ClipboardList },
  documents: { href: "/app/documents", icon: FileText },
  // E09 Slice 2 — the customer's own sessions. Every default/coaching/consultant Playbook already
  // lists `sessions`, so this key is what turns that catalog entry into a link (and lets the
  // presentation overlay hide or reorder it). AppNav still shows it only to a single-business
  // customer; the page re-resolves the relationship server-side.
  sessions: { href: "/app/sessions", icon: CalendarClock },
  // Funding-vertical surfaces — keys match the /app route paths in App.tsx.
  // Gated by the funding Playbook's portal.modules (opt-in preset), never shown
  // to a coaching-generic tenant.
  credit: { href: "/app/credit", icon: CreditCard },
  funding: { href: "/app/funding", icon: Landmark },
  "funding-journey": { href: "/app/funding-journey", icon: Compass },
  "financial-profile": { href: "/app/financial-profile", icon: Wallet },
  business: { href: "/app/business", icon: Building2 },
  agreements: { href: "/app/agreements", icon: FileSignature },
  affiliate: { href: "/app/affiliate", icon: Handshake },
  // Defensive aliases: the Playbook editor's slugify() emits underscores
  // ("Funding Journey" → "funding_journey"), so a tenant who authors these
  // modules by hand still routes to the same funding surfaces.
  funding_journey: { href: "/app/funding-journey", icon: Compass },
  financial_profile: { href: "/app/financial-profile", icon: Wallet },
  // NOTE: 'planning' is intentionally NOT here. plan_list is tenant-member
  // scoped (a client gets PLAN_FORBIDDEN), so Planning must never be added to a
  // client's Playbook module list — it's surfaced via the staff-only fallback
  // in AppNav instead (§9 keeps the client seam clean).
};

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
