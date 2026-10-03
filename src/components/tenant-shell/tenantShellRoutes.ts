import {
  BarChart3,
  ChartNoAxesCombined,
  Megaphone,
  Store,
  Settings,
  Sparkles,
  Users,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

type TenantDestination =
  | "command"
  | "clients"
  | "campaigns"
  | "sales"
  | "marketplace"
  | "analytics"
  | "studio"
  | "insights"
  | "settings";
type TenantBranch = TenantDestination | "calendar";

export interface TenantShellDestination {
  id: TenantDestination;
  label: string;
  href: string;
  icon: LucideIcon;
  aliases: string[];
}

type TenantRouteRoot = "agency" | "business" | "enterprise" | "solo";

export interface TenantAccountContext {
  accountName?: string | null;
  accountType?: string | null;
  parentTenantId?: string | null;
}

export interface ResolvedTenantAccountContext {
  accountName: string;
  accountType: string | null;
  accountTypeLabel: string;
}

const TENANT_ROUTE_PATTERN = /^\/(agency|business|enterprise|solo)\/([^/]+)/;
const AGENCY_ACTING_CHILD_ROUTE_PATTERN = /^\/agency\/([^/]+)\/sub\/(\d+)(?:\/|$)/;

const TENANT_BRANCHES: Record<TenantBranch, { slug: string; aliases: string[] }> = {
  command: { slug: "command-center", aliases: ["paige", "trust-compass", "automations"] },
  clients: { slug: "clients", aliases: ["client-support", "billing"] },
  calendar: { slug: "calendar", aliases: [] },
  campaigns: { slug: "growth", aliases: [] },
  sales: { slug: "sales", aliases: [] },
  marketplace: { slug: "marketplace", aliases: [] },
  analytics: { slug: "analytics", aliases: [] },
  studio: { slug: "growth", aliases: [] },
  insights: { slug: "analytics", aliases: [] },
  settings: { slug: "setup", aliases: ["marketplace", "business-vault", "integrations", "team"] },
};

const SOLO_SETTINGS_BRANCH = {
  slug: "settings",
  aliases: ["setup", "business-vault", "integrations", "team"],
};

/** Translate internal account_type values into the owner-locked tenant-facing taxonomy. */
export function tenantAccountTypeLabel(accountType?: string | null): string {
  switch (accountType?.trim().toLowerCase()) {
    case "standalone":
      return "Solo";
    case "sub_account":
      return "Sub-account";
    case "agency":
      return "Agency Parent";
    case "enterprise":
      return "Enterprise";
    default:
      return accountType?.split("_").join(" ") || "Account";
  }
}

/**
 * Present authenticated account context atomically. The route account number is
 * intentionally not accepted here: a URL is an address, never tenant authority.
 */
export function resolveTenantAccountContext(
  context?: TenantAccountContext | null,
): ResolvedTenantAccountContext {
  const accountName = context?.accountName?.trim() || "Your workspace";
  const accountType = context?.parentTenantId
    ? "sub_account"
    : context?.accountType?.trim().toLowerCase() || null;

  return {
    accountName,
    accountType,
    accountTypeLabel: tenantAccountTypeLabel(accountType),
  };
}

/**
 * The tenant platform's five global destinations. Calendar remains mounted at its
 * canonical route, but its visible owner is the Clients or Relationships surface.
 */
export const TENANT_SHELL_DESTINATIONS: TenantShellDestination[] = [
  { id: "command", label: "Command Center", href: "", icon: Sparkles, aliases: [""] },
  {
    id: "clients",
    label: "Clients",
    href: "",
    icon: Users,
    aliases: ["", "", "", ""],
  },
  {
    id: "studio",
    label: "Studio",
    href: "",
    icon: WandSparkles,
    aliases: ["", ""],
  },
  {
    id: "insights",
    label: "Insights",
    href: "",
    icon: BarChart3,
    aliases: [""],
  },
  {
    id: "settings",
    label: "Settings",
    href: "",
    icon: Settings,
    aliases: [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
  },
];

/** Solo's approved durable work homes. Existing route owners remain unchanged. */
const SOLO_SHELL_DESTINATIONS: TenantShellDestination[] = [
  { id: "command", label: "Command Center", href: "", icon: Sparkles, aliases: [""] },
  {
    id: "clients",
    label: "Clients",
    href: "",
    icon: Users,
    aliases: ["", "", "", ""],
  },
  { id: "campaigns", label: "Marketing", href: "", icon: Megaphone, aliases: [] },
  { id: "sales", label: "Sales", href: "", icon: ChartNoAxesCombined, aliases: [] },
  { id: "marketplace", label: "Marketplace", href: "", icon: Store, aliases: [] },
  { id: "analytics", label: "Analytics", href: "", icon: BarChart3, aliases: [] },
  {
    id: "settings",
    label: "Settings",
    href: "",
    icon: Settings,
    aliases: ["", "", ""],
  },
];

/**
 * Resolve only the address prefix owned by the current tenant route. Identity
 * and authorization remain server-derived in the route owner; this helper
 * preserves an already-confirmed acting-child address when building links.
 */
export function tenantRoutePrefixForPath(pathname: string): string | null {
  const actingChildMatch = pathname.match(AGENCY_ACTING_CHILD_ROUTE_PATTERN);
  if (actingChildMatch) {
    const [, parentAccount, childAccount] = actingChildMatch;
    return `/agency/${parentAccount}/sub/${childAccount}`;
  }

  const tenantMatch = pathname.match(TENANT_ROUTE_PATTERN);
  if (!tenantMatch) return null;

  const [, routeRoot, account] = tenantMatch as [string, TenantRouteRoot, string];
  return `/${routeRoot}/${account}`;
}

/** Build the canonical Calendar address without making Calendar a visible shell home. */
export function tenantCalendarHrefForPath(pathname: string): string {
  const root = tenantRoutePrefixForPath(pathname);
  return root ? `${root}/${TENANT_BRANCHES.calendar.slug}` : "/choose-account";
}

/** Keep visible shell homes inside the route tree that owns the active account. */
export function tenantShellDestinationsForPath(
  pathname: string,
  accountType?: string | null,
): TenantShellDestination[] {
  const root = tenantRoutePrefixForPath(pathname);
  const relationshipLabel = ["agency", "enterprise"].includes(accountType?.trim().toLowerCase() ?? "")
    ? "Relationships"
    : "Clients";
  const isAuthenticatedSolo = root?.startsWith("/solo/")
    && accountType?.trim().toLowerCase() === "standalone";
  const registry = isAuthenticatedSolo ? SOLO_SHELL_DESTINATIONS : TENANT_SHELL_DESTINATIONS;
  const destinations = registry.map((destination) =>
    destination.id === "clients" ? { ...destination, label: relationshipLabel } : destination,
  );
  if (!root) return destinations.map((destination) => ({
    ...destination,
    href: "/choose-account",
    aliases: [],
  }));

  return destinations.map((destination) => {
    const branch = destination.id === "settings" && root.startsWith("/solo/")
      ? SOLO_SETTINGS_BRANCH
      : TENANT_BRANCHES[destination.id];
    return {
      ...destination,
      href: `${root}/${branch.slug}`,
      aliases: branch.aliases.map((slug) => `${root}/${slug}`),
    };
  });
}

function pathMatches(pathname: string, href: string): boolean {
  if (!href) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function resolveTenantShellDestination(
  pathname: string,
  accountType?: string | null,
): TenantShellDestination {
  const destinations = tenantShellDestinationsForPath(pathname, accountType);
  const clientsDestination = destinations.find(({ id }) => id === "clients") ?? destinations[0];
  const tenantRoot = tenantRoutePrefixForPath(pathname);
  const canonicalCalendarHref = tenantCalendarHrefForPath(pathname);
  const isCalendarAddress = tenantRoot
    ? pathMatches(pathname, canonicalCalendarHref)
    : false;

  if (isCalendarAddress) return clientsDestination;

  return (
    destinations.find(
      (destination) =>
        pathMatches(pathname, destination.href) ||
        destination.aliases.some((alias) => pathMatches(pathname, alias)),
    ) ?? destinations[0]
  );
}
