// The growth-hosting-command door's contract — types, refusal codes, preview/summary builders.
// Mirrors _shared/growth-publish-command/contract.ts's role: everything the door and its tests
// share, with ZERO I/O (pure decisions over facts), so the world harness drives the REAL door with
// only the Supabase clients, provider and export builder doubled.

export const HOSTING_ACTIONS = ["deploy", "recover"] as const;
export type HostingAction = (typeof HOSTING_ACTIONS)[number];

export const HOSTING_KEYS: Readonly<Record<HostingAction, string>> = {
  deploy: "growth_hosting_deploy",
  recover: "growth_hosting_recover",
};

export interface HostingCommand {
  action: HostingAction;
  page_id: string;
  approved_fingerprint?: string;
  expected_tenant_id?: string;
}

/** The page facts the door reads (tenant-filtered, by id, from the service-role client). */
export interface HostingReadinessFacts {
  tenantSlug: string | null;
  page: Record<string, unknown> | null;
  /** The existing deployment row for this page, if any (one per page by unique index). */
  existing: Record<string, unknown> | null;
}

/** The export the door deploys — produced by the injected builder (ONE shared implementation). */
export interface HostingExport {
  html: string;
  fileName: string;
  /** The sha256 of the html — the deployment's identity and the verification target. */
  sha256: string;
}

/** The platform's provider configuration; ABSENT means the honest dormant state. */
export interface HostingProviderConfig {
  accountId: string;
  apiToken: string;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Page statuses that may be hosted: only PUBLISHED work has a public truth to copy. */
export function pageIsPublished(page: Record<string, unknown> | null): boolean {
  return !!page && page.status === "published";
}

/** The stable deployment name for a page (one deployment per page, forever). */
export function deploymentName(tenantSlug: string, pageSlug: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "page";
  return `${clean(tenantSlug)}-${clean(pageSlug)}`;
}

export interface HostingCheck {
  label: string;
  ok: boolean;
  blocking: boolean;
}

export interface HostingPreview {
  action: HostingAction;
  page_id: string;
  title: string;
  page_slug: string;
  address: string;
  checks: HostingCheck[];
}

export function buildHostingPreview(
  action: HostingAction,
  facts: HostingReadinessFacts,
  exportBytes: HostingExport | null,
): HostingPreview | null {
  const page = facts.page;
  if (!page) return null;
  const slug = typeof page.slug === "string" ? page.slug : "";
  const name = facts.tenantSlug && slug ? deploymentName(facts.tenantSlug, slug) : null;
  return {
    action,
    page_id: String(page.id),
    title: typeof page.title === "string" ? page.title : "",
    page_slug: slug,
    address: name ? `https://${name}.workers.dev` : "(the page's slug isn't set yet)",
    checks: [
      { label: "the page is published", ok: pageIsPublished(page), blocking: true },
      { label: "the export built from the published version", ok: !!exportBytes, blocking: action === "deploy" },
      ...(action === "recover"
        ? [{ label: "a hosted copy exists", ok: !!facts.existing && facts.existing.status !== "removed" && facts.existing.status !== "removed_unconfirmed", blocking: true }]
        : []),
    ],
  };
}

export function previewReady(preview: HostingPreview): boolean {
  return preview.checks.every((c) => !c.blocking || c.ok);
}

export function previewSummary(preview: HostingPreview): string {
  const verb = preview.action === "deploy" ? "Put a hosted copy of" : "Take down the hosted copy of";
  return `${verb} “${preview.title}” at ${preview.address} — the page itself and its reserved address are untouched.`;
}

/** One-line human refusals, in the door's voice. */
export const HOSTING_REFUSALS = {
  not_enabled: "Hosting isn't switched on yet. Nothing was changed.",
  not_found: "That page isn't in this workspace. Nothing was changed.",
  not_published: "Only a published page can be hosted. Nothing was changed.",
  no_export: "The export couldn't be built from the published version. Nothing was changed.",
  nothing_to_recover: "There's no hosted copy to take down. Nothing was changed.",
} as const;
export type HostingRefusalCode = keyof typeof HOSTING_REFUSALS;

/**
 * The receipt outcome mapping — record_capability_run accepts a fixed vocabulary
 * (capability-record.ts); the door's nuance (verified? confirmed? uncertain?) rides in the
 * receipt's DETAIL, never in an invented outcome word.
 */
export type HostingReceiptOutcome =
  | "capability_succeeded"
  | "capability_failed"
  | "capability_refused"
  | "capability_outcome_unknown";

export function classifyHostingOutcome(
  action: HostingAction,
  input: { deployed?: boolean; verified?: boolean; removed?: boolean; uncertain?: boolean; refused?: string },
): HostingReceiptOutcome {
  if (input.refused) return "capability_refused";
  if (input.uncertain) return "capability_outcome_unknown";
  if (action === "deploy") {
    if (input.deployed && input.verified) return "capability_succeeded";
    if (input.deployed) return "capability_succeeded"; // deployed but unverified — detail carries verified:false; never called live
    return "capability_failed";
  }
  if (input.removed) return "capability_succeeded"; // removed_unconfirmed is caught by `uncertain` above
  return "capability_failed";
}
