/**
 * Canonical externally emitted Paige application destinations.
 *
 * This module is deliberately pure: email, SMS, Stripe, OAuth, webhook, MCP,
 * cron, and frontend producers can share the same fail-closed route contract.
 * A route is an address, never authorization; the mounted shell still resolves
 * the session and tenant server-side.
 */

export const PAIGE_APP_ORIGIN = "https://paigeagent.ai";

export type CanonicalActor = "operator" | "account";
export type CanonicalTier =
  | "operator"
  | "solo"
  | "standalone"
  | "sub_account"
  | "agency"
  | "enterprise";

export type CanonicalDestination =
  | "home"
  | "billing"
  | "approvals"
  | "security"
  | "settings"
  | "connections"
  | "integrations"
  | "tasks"
  | "calendar"
  | "contacts"
  | "pipeline"
  | "executive"
  | "finance"
  | "sales_pipeline"
  | "systems_check"
  | "business_game_plan"
  | "trust_compass"
  | "mind"
  | "marketplace"
  | "marketplace_submissions"
  // Experience 04 E4-S3: where a read PAIGE answered from can be checked. Solo only — the other
  // trees mount no such surface, so these resolve to null there and fail closed.
  | "sales_agreements"
  | "sales_invoices"
  | "sales_collections"
  | "operations_work"
  | "business_time_zone";

export interface CanonicalAppRouteInput {
  actor: CanonicalActor;
  tier: CanonicalTier;
  account?: string | number | null;
  destination: CanonicalDestination;
}

type MountedTier = "operator" | "solo" | "sub_account" | "agency";

const ROUTES: Record<MountedTier, Partial<Record<CanonicalDestination, string>>> = {
  operator: {
    home: "/operator/fleet/systems-check",
    approvals: "/operator/settings/governance/approvals",
    security: "/operator/settings/governance/security",
    settings: "/operator/settings/setup/operator",
    connections: "/operator/settings/integrations/connected",
    integrations: "/operator/settings/integrations/connected",
    tasks: "/operator/calendar/tasks",
    calendar: "/operator/calendar/month",
    pipeline: "/operator/fleet/prospects",
    marketplace: "/operator/marketplace/discover",
    marketplace_submissions: "/operator/marketplace/submissions",
  },
  solo: {
    // E2-6 owner direction: Executive is the landing; the four incumbent surfaces remain deep links.
    home: "/solo/{account}/command-center/executive",
    executive: "/solo/{account}/command-center/executive",
    finance: "/solo/{account}/finance",
    sales_pipeline: "/solo/{account}/sales/opportunities?view=board",
    systems_check: "/solo/{account}/command-center/systems-check",
    business_game_plan: "/solo/{account}/command-center/business-game-plan",
    trust_compass: "/solo/{account}/command-center/trust-compass",
    mind: "/solo/{account}/command-center/mind",
    billing: "/solo/{account}/settings/billing",
    security: "/solo/{account}/settings/security-data",
    settings: "/solo/{account}/settings/setup",
    connections: "/solo/{account}/settings/connections",
    integrations: "/solo/{account}/settings/integrations",
    tasks: "/solo/{account}/calendar/tasks",
    calendar: "/solo/{account}/calendar/week",
    contacts: "/solo/{account}/clients/people",
    pipeline: "/solo/{account}/growth/pipeline",
    marketplace: "/solo/{account}/marketplace/browse",
    sales_agreements: "/solo/{account}/sales/agreements",
    sales_invoices: "/solo/{account}/sales/payments?view=invoices",
    sales_collections: "/solo/{account}/sales/payments?view=collections",
    operations_work: "/solo/{account}/operations/work",
    business_time_zone: "/solo/{account}/settings/setup/business-profile#business-time-zone",
  },
  sub_account: {
    home: "/business/{account}/command-center/overview",
    billing: "/business/{account}/billing/your-plan",
    settings: "/business/{account}/setup/business",
    connections: "/business/{account}/calendar/connections",
    tasks: "/business/{account}/calendar/tasks",
    calendar: "/business/{account}/calendar/week",
    contacts: "/business/{account}/clients/people",
    pipeline: "/business/{account}/clients/pipelines",
    marketplace: "/business/{account}/marketplace/browse",
  },
  agency: {
    home: "/agency/{account}/command-center/overview",
    billing: "/agency/{account}/billing/your-plan",
    settings: "/agency/{account}/setup/business",
    connections: "/agency/{account}/calendar/connections",
    tasks: "/agency/{account}/calendar/tasks",
    calendar: "/agency/{account}/calendar/week",
    contacts: "/agency/{account}/clients/people",
    pipeline: "/agency/{account}/clients/pipelines",
    marketplace: "/agency/{account}/marketplace/browse",
  },
};

function mountedTier(tier: CanonicalTier): MountedTier | null {
  if (tier === "standalone") return "solo";
  if (tier === "operator" || tier === "solo" || tier === "sub_account" || tier === "agency") {
    return tier;
  }
  // Enterprise exists in taxonomy but is not mounted. Never mint a dead address.
  return null;
}

function safeAccount(account: string | number | null | undefined): string | null {
  const value = String(account ?? "").trim();
  return /^\d{1,20}$/.test(value) ? value : null;
}

export function resolveCanonicalAppPath(input: CanonicalAppRouteInput): string | null {
  const tier = mountedTier(input.tier);
  if (!tier) return null;

  if ((input.actor === "operator") !== (tier === "operator")) return null;

  const template = ROUTES[tier][input.destination];
  if (!template) return null;
  if (tier === "operator") return template;

  const account = safeAccount(input.account);
  return account ? template.replace("{account}", account) : null;
}

export function canonicalAppUrl(input: CanonicalAppRouteInput): string | null {
  const path = resolveCanonicalAppPath(input);
  return path ? `${PAIGE_APP_ORIGIN}${path}` : null;
}

/**
 * A link to a record, from a REFERENCE (a destination and an optional record id).
 *
 * `exact` when the mounted surface reads a focus parameter for that record and the id is a UUID;
 * `surface_only` when the link opens the surface (a list) the record lives on; null where nothing is
 * mounted. The same `exact | surface_only` vocabulary as crm-command's `record_locator`. The focus
 * parameter is inserted BEFORE any `#fragment`, joined with `&` when the path already has a query.
 * The address is never authority: the surface re-reads the record under its own session and RLS.
 */
export type CanonicalRecordLink = { path: string; status: "exact" | "surface_only" };

/** The focus parameters the mounted surfaces already read (UUIDs only). */
const RECORD_FOCUS: Record<MountedTier, Partial<Record<CanonicalDestination, string>>> = {
  operator: {},
  solo: { contacts: "person", pipeline: "deal", sales_invoices: "invoice" },
  sub_account: {},
  agency: {},
};

const RECORD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The focus inserter: the query goes BEFORE any `#fragment`, joined with `&` when one exists.
 *  Exported so its two branches are tested directly (no mounted destination has both today). */
export function withQuery(path: string, key: string, value: string): string {
  const hash = path.indexOf("#");
  const base = hash < 0 ? path : path.slice(0, hash);
  const fragment = hash < 0 ? "" : path.slice(hash);
  return `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}${fragment}`;
}

export function resolveCanonicalRecordLink(
  input: CanonicalAppRouteInput & { recordId?: string | null },
): CanonicalRecordLink | null {
  const path = resolveCanonicalAppPath(input);
  if (!path) return null;
  const tier = mountedTier(input.tier);
  const focus = tier ? RECORD_FOCUS[tier][input.destination] : undefined;
  const id = typeof input.recordId === "string" ? input.recordId.trim() : "";
  if (focus && RECORD_UUID.test(id)) return { path: withQuery(path, focus, id), status: "exact" };
  return { path, status: "surface_only" };
}
