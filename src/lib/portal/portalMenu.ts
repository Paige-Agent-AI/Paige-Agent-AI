import type { LucideIcon } from "lucide-react";
import {
  Home, MessageCircle, LineChart, ListChecks, ClipboardList, CalendarClock, FileText, FileSignature, CreditCard, BookOpen,
  Landmark, Compass, Wallet, Building2, Handshake,
} from "lucide-react";
import type { PortalModuleOverlay } from "@/hooks/useClientPortalConfig";

// ---------------------------------------------------------------------------
// E09 Slice M — the customer portal menu: ONE registry and ONE assembly (§18).
// ---------------------------------------------------------------------------
// AppNav (the live customer chrome), the owner's "Customer portal menu" editor and its "What your clients
// see" preview, and PortalStudio's "View as client" all call assemblePortalNav(), so none of them can drift
// from what a customer actually sees (§13).
//
// Three inputs decide the menu, and the order of authority matters:
//   1. FLOORS (hard rules). Who may ever see an entry: a customer of one business, anyone who is not staff,
//      anyone whose business brand resolved, staff only. The tenant overlay can never reveal past a floor.
//   2. The Playbook CATALOG (`portal.modules`). Catalog-only entries — the funding preset's keys, Approvals,
//      Agreements, Resources — render only when the catalog lists them (§2: funding wording is a chosen
//      opt-in, never a default). The catalog also supplies an entry's default name.
//   3. The tenant OVERLAY (`portal_config.modules`): hide, rename, reorder. Purely presentational: unknown
//      keys are inert, so the overlay can never create a link, and a fixed entry ignores it entirely.
//
// Owner ruling (2026-10-18): Home and Messages are fixed at the top; Get help, Account, Settings and Sign
// out are fixed at the bottom (rendered by AppNav, not by this registry). Everything else is grouped —
// "Your work", "Paperwork", "Learn" — in a fixed group order, configurable within its group.
//
// `live` is the route gate: an entry whose page does not exist yet never renders and is never offered in
// the editor (no "Coming soon" — §70.1). Slices 5 and A flip `billing` / move `agreements` here.

export type PortalMenuGroupId = "work" | "paperwork" | "learn";
export type PortalMenuSlot = "top" | PortalMenuGroupId;
/** Who may ever see the entry. The overlay can never reveal past it. */
export type PortalMenuFloor = "everyone" | "customer" | "not_staff" | "brand" | "staff";

export interface PortalMenuEntry {
  key: string;
  defaultLabel: string;
  route: string;
  icon: LucideIcon;
  group: PortalMenuSlot;
  /** Fixed entries cannot be hidden, renamed or reordered. */
  fixed: boolean;
  floor: PortalMenuFloor;
  /** False until the page behind `route` exists. A non-live entry never renders. */
  live: boolean;
  /** "shown": present unless hidden. "catalog": present only when the Playbook catalog lists the key. */
  defaultVisibility: "shown" | "catalog";
  /** Catalog-only extras sort after the group's core entries, in the catalog's own order. */
  catalogOrdered?: boolean;
  /** Sorts after everything else in its group (staff Planning, as before Slice M). */
  trailing?: boolean;
  /** When false, the registry's default name wins over the catalog's (the owner ruled "Payments", not "Billing"). */
  catalogLabel?: boolean;
  /** One line under the name in a desktop group menu. */
  description?: string;
  /** A quiet note beside the row in the owner's editor. */
  editorHint?: string;
}

export const PORTAL_MENU_GROUPS: readonly { id: PortalMenuGroupId; label: string }[] = [
  { id: "work", label: "Your work" },
  { id: "paperwork", label: "Paperwork" },
  { id: "learn", label: "Learn" },
];

const entry = (e: Omit<PortalMenuEntry, "fixed" | "live" | "defaultVisibility"> & Partial<Pick<PortalMenuEntry, "fixed" | "live" | "defaultVisibility">>): PortalMenuEntry =>
  ({ fixed: false, live: true, defaultVisibility: "catalog", ...e });

/** Registry order is the default order within each group. */
export const PORTAL_MENU_ENTRIES: readonly PortalMenuEntry[] = [
  entry({ key: "home", defaultLabel: "Home", route: "/app", icon: Home, group: "top", fixed: true, floor: "everyone", defaultVisibility: "shown" }),
  // The customer's conversation with their business (E09 Slice 1). Fixed by owner ruling 2026-10-18.
  entry({ key: "messages", defaultLabel: "Messages", route: "/app/messages", icon: MessageCircle, group: "top", fixed: true, floor: "customer", defaultVisibility: "shown", catalogLabel: false }),

  // ── Your work ──
  entry({ key: "progress", defaultLabel: "Progress", route: "/app/progress", icon: LineChart, group: "work", floor: "customer", defaultVisibility: "shown", description: "Work shared with you" }),
  // The customer's side of the two-way action bus (§8): every client who is not staff.
  entry({ key: "actions", defaultLabel: "Action items", route: "/app/actions", icon: ClipboardList, group: "work", floor: "not_staff", defaultVisibility: "shown", description: "What's waiting on you" }),
  entry({ key: "sessions", defaultLabel: "Sessions", route: "/app/sessions", icon: CalendarClock, group: "work", floor: "customer", defaultVisibility: "shown", description: "Your booked times" }),
  entry({ key: "approvals", defaultLabel: "Approvals", route: "/app/approvals", icon: ListChecks, group: "work", floor: "everyone", catalogOrdered: true }),
  // Funding-vertical surfaces: routable ONLY for a tenant whose OPT-IN funding Playbook lists them (§2).
  entry({ key: "funding-journey", defaultLabel: "Funding Journey", route: "/app/funding-journey", icon: Compass, group: "work", floor: "everyone", catalogOrdered: true }),
  entry({ key: "funding_journey", defaultLabel: "Funding Journey", route: "/app/funding-journey", icon: Compass, group: "work", floor: "everyone", catalogOrdered: true }),
  entry({ key: "credit", defaultLabel: "Credit", route: "/app/credit", icon: CreditCard, group: "work", floor: "everyone", catalogOrdered: true }),
  entry({ key: "funding", defaultLabel: "Funding", route: "/app/funding", icon: Landmark, group: "work", floor: "everyone", catalogOrdered: true }),
  entry({ key: "financial-profile", defaultLabel: "Financial Profile", route: "/app/financial-profile", icon: Wallet, group: "work", floor: "everyone", catalogOrdered: true }),
  entry({ key: "financial_profile", defaultLabel: "Financial Profile", route: "/app/financial-profile", icon: Wallet, group: "work", floor: "everyone", catalogOrdered: true }),
  entry({ key: "business", defaultLabel: "Business", route: "/app/business", icon: Building2, group: "work", floor: "everyone", catalogOrdered: true }),
  entry({ key: "affiliate", defaultLabel: "Affiliate", route: "/app/affiliate", icon: Handshake, group: "work", floor: "everyone", catalogOrdered: true }),
  // Staff only: the Task Manager. plan_list is tenant-member scoped, so a client can never use it (§9).
  entry({ key: "planning", defaultLabel: "Planning", route: "/app/planning", icon: CalendarClock, group: "work", fixed: true, floor: "staff", defaultVisibility: "shown", trailing: true }),

  // ── Paperwork ──
  // Available to anyone whose business brand resolved, even when an older Playbook predates the key.
  entry({ key: "documents", defaultLabel: "Documents", route: "/app/documents", icon: FileText, group: "paperwork", floor: "brand", defaultVisibility: "shown", description: "Files shared with you" }),
  // Today this route is the platform-terms page (MyAgreements), shown only when the catalog lists it, exactly
  // as before Slice M. Slice A points it at the customer's Sales Agreements and changes its default.
  entry({ key: "agreements", defaultLabel: "Agreements", route: "/app/agreements", icon: FileSignature, group: "paperwork", floor: "everyone", description: "Agreements on record" }),
  // Slice 5 builds /app/billing; until then this never renders and is never offered (live:false).
  entry({ key: "billing", defaultLabel: "Payments", route: "/app/billing", icon: CreditCard, group: "paperwork", floor: "customer", live: false, catalogLabel: false, description: "Invoices and receipts", editorHint: "Hide if you bill outside Paige" }),

  // ── Learn ──
  entry({ key: "resources", defaultLabel: "Resources", route: "/app/learn", icon: BookOpen, group: "learn", floor: "everyone", catalogOrdered: true }),
  entry({ key: "learn", defaultLabel: "Resources", route: "/app/learn", icon: BookOpen, group: "learn", floor: "everyone", catalogOrdered: true }),
];

/** The keys an owner (or Paige, through client.portal_menu_configure) may hide, rename or reorder. */
export const PORTAL_MENU_CONFIGURABLE_KEYS: readonly string[] = PORTAL_MENU_ENTRIES
  .filter((e) => !e.fixed && e.floor !== "staff").map((e) => e.key);

/** What decides the floors for the person looking at the menu. */
export interface PortalViewer {
  /** Signed-in staff of the active workspace (DashboardMode isAdmin). */
  isStaff: boolean;
  /** A customer of exactly one business, relationship resolved server-side. */
  isCustomer: boolean;
  /** The business brand resolved for this viewer. */
  brandResolved: boolean;
}

/** The viewer the owner's previews render for: a signed-in customer of this one business. */
export const PORTAL_CUSTOMER_PREVIEW_VIEWER: PortalViewer = Object.freeze({ isStaff: false, isCustomer: true, brandResolved: true });

export interface PortalNavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  description?: string;
}

export interface PortalNavSection {
  id: PortalMenuSlot;
  /** null for the fixed top entries; the group's name otherwise. */
  label: string | null;
  items: PortalNavItem[];
}

export interface AssemblePortalNavInput {
  catalog: readonly { key: string; label: string }[];
  overlay?: readonly PortalModuleOverlay[];
  viewer: PortalViewer;
}

const floorAllows = (floor: PortalMenuFloor, v: PortalViewer) =>
  floor === "everyone" ? true
    : floor === "customer" ? v.isCustomer
      : floor === "not_staff" ? !v.isStaff
        : floor === "brand" ? v.brandResolved
          : v.isStaff;

const LABEL_MAX = 40;
const cleanLabel = (label: unknown) => {
  if (typeof label !== "string") return null;
  const t = label.trim().slice(0, LABEL_MAX);
  return t ? t : null;
};

/** The name an entry shows when the overlay does not rename it: the catalog's, else the registry's. */
export function defaultPortalMenuLabel(e: PortalMenuEntry, catalog: readonly { key: string; label: string }[]): string {
  if (e.catalogLabel === false) return e.defaultLabel;
  const fromCatalog = catalog.find((m) => m.key === e.key)?.label;
  return cleanLabel(fromCatalog) ?? e.defaultLabel;
}

/** Whether the entry can show for this catalog at all (live, and listed when it is catalog-only). */
const offered = (e: PortalMenuEntry, catalogKeys: Set<string>) =>
  e.live && (e.defaultVisibility === "shown" || catalogKeys.has(e.key));

interface Ranked { e: PortalMenuEntry; pos: number; label: string; hidden: boolean }

function rank(input: AssemblePortalNavInput, includeHidden: boolean): Map<PortalMenuSlot, Ranked[]> {
  const catalog = Array.isArray(input.catalog) ? input.catalog : [];
  const catalogKeys = new Set(catalog.map((m) => m?.key).filter((k): k is string => typeof k === "string"));
  const overlayByKey = new Map<string, PortalModuleOverlay>();
  for (const o of Array.isArray(input.overlay) ? input.overlay : []) {
    if (o && typeof o.key === "string") overlayByKey.set(o.key, o);
  }
  const out = new Map<PortalMenuSlot, Ranked[]>();
  const slots: PortalMenuSlot[] = ["top", ...PORTAL_MENU_GROUPS.map((g) => g.id)];
  for (const slot of slots) {
    const inSlot = PORTAL_MENU_ENTRIES.filter((e) => e.group === slot);
    const ranked: Ranked[] = [];
    inSlot.forEach((e, registryIndex) => {
      if (!floorAllows(e.floor, input.viewer) || !offered(e, catalogKeys)) return;
      const o = e.fixed ? undefined : overlayByKey.get(e.key);
      const hidden = o?.visible === false;
      if (hidden && !includeHidden) return;
      const base = e.trailing ? 2000 + registryIndex : e.catalogOrdered ? 1000 + catalog.findIndex((m) => m.key === e.key) : registryIndex;
      const pos = typeof o?.order === "number" && Number.isFinite(o.order) ? o.order : base;
      ranked.push({ e, pos, label: cleanLabel(o?.label) ?? defaultPortalMenuLabel(e, catalog), hidden });
    });
    // Stable: equal positions keep registry order.
    ranked.sort((a, b) => (a.pos !== b.pos ? a.pos - b.pos : inSlot.indexOf(a.e) - inSlot.indexOf(b.e)));
    out.set(slot, ranked);
  }
  return out;
}

/**
 * The customer portal menu for one viewer: the fixed top entries, then each group that has anything to
 * show, in the ruled group order. Two keys that share a route (learn/resources, the funding aliases) render
 * once — the first in order wins.
 */
export function assemblePortalNav(input: AssemblePortalNavInput): PortalNavSection[] {
  const ranked = rank(input, false);
  const seen = new Set<string>();
  const sections: PortalNavSection[] = [];
  const toItems = (list: Ranked[]) => list.flatMap(({ e, label }): PortalNavItem[] => {
    if (seen.has(e.route)) return [];
    seen.add(e.route);
    return [{ key: e.key, label, href: e.route, icon: e.icon, ...(e.description ? { description: e.description } : {}) }];
  });
  sections.push({ id: "top", label: null, items: toItems(ranked.get("top") ?? []) });
  for (const g of PORTAL_MENU_GROUPS) {
    const items = toItems(ranked.get(g.id) ?? []);
    if (items.length) sections.push({ id: g.id, label: g.label, items });
  }
  return sections;
}

export const flattenPortalNav = (sections: readonly PortalNavSection[]): PortalNavItem[] => sections.flatMap((s) => s.items);

/** One configurable row in the owner's editor, in the order the customer would see it. */
export interface PortalMenuEditorEntry {
  key: string;
  group: PortalMenuGroupId;
  /** The name shown when the owner sets none (catalog name, else registry default). */
  defaultLabel: string;
  icon: LucideIcon;
  editorHint?: string;
}

/**
 * The rows an owner can configure for this catalog: every configurable, live entry a customer of one
 * business could see — core entries always, catalog-only entries only when the catalog lists them (§2),
 * and never one whose route is not live. Route aliases appear once.
 */
export function portalMenuEditorEntries(catalog: readonly { key: string; label: string }[]): PortalMenuEditorEntry[] {
  const ranked = rank({ catalog, viewer: PORTAL_CUSTOMER_PREVIEW_VIEWER }, true);
  const seen = new Set<string>();
  const out: PortalMenuEditorEntry[] = [];
  for (const g of PORTAL_MENU_GROUPS) {
    for (const { e } of ranked.get(g.id) ?? []) {
      if (e.fixed || seen.has(e.route)) continue;
      seen.add(e.route);
      out.push({ key: e.key, group: g.id, defaultLabel: defaultPortalMenuLabel(e, catalog), icon: e.icon, ...(e.editorHint ? { editorHint: e.editorHint } : {}) });
    }
  }
  return out;
}

/** The fixed entries a customer of one business always has at the top. */
export const PORTAL_MENU_FIXED_TOP: readonly PortalMenuEntry[] = PORTAL_MENU_ENTRIES.filter((e) => e.group === "top" && e.fixed);
