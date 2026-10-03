/**
 * Systems Check — the nine operating areas, and where each real check belongs.
 *
 * WHY THIS FILE EXISTS. The surface used to group findings by the registry's `domain` column and
 * title-case it, which is why a business owner was shown "Data Product" and "Payments Ops" — our
 * engineering vocabulary, rendered verbatim. The owner ruled the surface speaks in plain business
 * language, so the grouping is authored here rather than derived from a database enum.
 *
 * IT IS A LABELLING LAYER AND NOTHING ELSE. It changes no status, invents no signal, and grants
 * nothing. Every status still comes from the finding the runner actually wrote.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────
 * READ THIS IF YOU ARE WIRING PAIGE'S TEAM, THE MIND, OR SECURITY. It is your first task there.
 * ───────────────────────────────────────────────────────────────────────────────────────────
 *
 * Three of the nine areas carry `coveredBy: []` and render the status word **NOT CHECKED**:
 * `team`, `mind`, `security`. That word is OWNER-RATIFIED (2026-09-05) and it means exactly one
 * thing: **no check has ever looked at this area.** It does NOT mean something is wrong, and it
 * does NOT mean we looked and could not tell — that is `UNAVAILABLE`, which is a different
 * promise. An absent check is never evidence of a fault, and the surface must never imply it is.
 *
 * SO: when you build the backend for one of those three areas, wiring the feature is only half
 * the job. Until you also give it a check, the owner's console keeps saying NOT CHECKED about
 * something you have just finished building — which is now a lie, and a quiet one, because
 * nothing will fail and no test will complain.
 *
 * The whole job, in order:
 *   1. Add the check to `paige_systems_check_registry` (scope='tenant', enabled_by_default=true).
 *   2. Add its runner under `supabase/functions/_shared/systems-check-runners/`, reading ONLY
 *      tenant-scoped data with an explicit `tenant_id` — the scan runs as service-role with no
 *      user identity, so anything resolving the tenant from `current_user_tenant_id()` will raise.
 *      (That exact mistake is why the revenue check answered nothing for months.)
 *   3. Add the check id to `SystemsCheckId` and to `CHECK_DESTINATIONS` below, with a plain-English
 *      title and a real next action — `systems-check-destinations.contract.test.ts` will fail if
 *      the destination does not resolve to a real route.
 *   4. Move the id into this area's `coveredBy` and DELETE its `uncovered` string. The area then
 *      derives its status from the finding, like the other six.
 *
 * `coveredBy: []` is a deliberate, load-bearing value — do not "fix" it by inventing a mapping to
 * a check that does not grade that area. An area mapped to the wrong check is worse than one
 * honestly marked NOT CHECKED.
 *
 * Check ids, priorities and severities verified against production
 * (`paige_systems_check_registry` where scope='tenant', 2026-09-05). All ten are enabled by
 * default. Adding a check to the registry without adding it here leaves it in `unassigned`, which
 * the surface renders in its own group rather than dropping — a missing map entry must never make
 * a real finding invisible.
 */

/** The ten tenant check ids, as seeded. */
export type SystemsCheckId =
  | "comms_configured"
  | "website_connected"
  | "social_accounts_connected"
  | "automation_wired"
  | "company_info_populated"
  | "crm_has_customers"
  | "sales_pipeline_configured"
  | "revenue_tracking_configured"
  | "payment_processor_connected"
  | "payment_method_options";

export interface AreaDefinition {
  id: string;
  /** The owner's words, not the registry's. */
  name: string;
  /** One line of what this area covers, in the same register. */
  scope: string;
  /**
   * A short subject phrase for the operating brief's plain-English lead ("{briefLabel} is ready").
   * The full `name` is a heading; this is how the area is named inside a running sentence. Kept
   * here in the label home rather than derived in the surface (§18).
   */
  briefLabel: string;
  /** Check ids graded in this area. Empty is a real, honest answer — see the header. */
  coveredBy: SystemsCheckId[];
  /**
   * What the surface says when NO check covers this area. Required wherever `coveredBy` is empty,
   * so an uncovered area can never render as a silent blank.
   */
  uncovered?: string;
}

/** The nine areas, in the order the owner set them. */
export const SYSTEMS_CHECK_AREAS: AreaDefinition[] = [
  {
    id: "identity",
    name: "Business setup and identity",
    scope: "Who your business is, and the details Paige is allowed to state as fact.",
    briefLabel: "Your business setup",
    coveredBy: ["company_info_populated", "website_connected"],
  },
  {
    id: "people",
    name: "People and CRM",
    scope: "The people on your books and whether anything can reach them.",
    briefLabel: "Your client list",
    coveredBy: ["crm_has_customers"],
  },
  {
    id: "sales",
    name: "Sales and commercial operations",
    scope: "What you sell, how work is tracked, and how you get paid.",
    briefLabel: "Sales",
    coveredBy: [
      "sales_pipeline_configured",
      "revenue_tracking_configured",
      "payment_processor_connected",
      "payment_method_options",
    ],
  },
  {
    id: "comms",
    name: "Email, phone and SMS readiness",
    scope: "Whether a message you send actually leaves this workspace.",
    briefLabel: "Email and messaging",
    coveredBy: ["comms_configured"],
  },
  {
    id: "campaigns",
    name: "Marketing, social and advertising",
    scope: "What you have live, and where new enquiries come from.",
    briefLabel: "Marketing",
    coveredBy: ["social_accounts_connected"],
  },
  {
    id: "integrations",
    name: "Integrations and automations",
    scope: "The outside tools connected here, and what Paige may run in them.",
    briefLabel: "Your automations",
    coveredBy: ["automation_wired"],
  },
  {
    // NOT CHECKED — no check grades this yet. Wiring this area? See the header block
    // at the top of this file: the check is step 1, not an afterthought.
    id: "team",
    name: "Paige's team and delegated work",
    scope: "What Paige is holding for you, and how much she may do on her own.",
    briefLabel: "Paige's team",
    coveredBy: [],
    uncovered:
      "No setup check grades this yet. What is shown comes straight from the work Paige is actually holding.",
  },
  {
    // NOT CHECKED — no check grades this yet. Wiring this area? See the header block
    // at the top of this file: the check is step 1, not an afterthought.
    id: "mind",
    name: "Business knowledge — the Mind",
    scope: "What Paige knows about your business, and what she can search.",
    briefLabel: "Business knowledge",
    coveredBy: [],
    uncovered:
      "No setup check grades this yet. Open Mind to see what she actually holds.",
  },
  {
    // NOT CHECKED — no check grades this yet. Wiring this area? See the header block
    // at the top of this file: the check is step 1, not an afterthought.
    id: "security",
    name: "Security, permissions and governance",
    scope: "Who can get in here, and what Paige is allowed to do on her own.",
    briefLabel: "Security",
    coveredBy: [],
    uncovered:
      "No setup check grades this yet. Access and permissions are shown in Settings, and Paige's limits in Trust Compass.",
  },
];

export interface CheckDestination {
  /** The area this check is reported under. */
  area: string;
  /**
   * What the owner reads, in their words rather than the registry's.
   *
   * The seeded `check_name` values are engineering vocabulary — "Comms configured across the
   * board", "Company info populated", "Customers present in CRM"; the word "configured" appears in
   * four of the ten. Correcting the registry itself is a separate data change; until it lands the
   * surface must not render those, so the plain title is authored here.
   *
   * A finding whose check_id is not in this map falls back to the registry name rather than
   * disappearing — an unmapped check must stay visible even if it reads badly.
   */
  title: string;
  /** What the button says. Plain, and it names where it goes. */
  label: string;
  /**
   * Builds the real path. Every one was verified against `src/lib/routing/tierBranches.ts`.
   *
   * This matters more than it looks: `/solo/*` is a splat with no catch-all, so an unknown branch
   * silently renders Command Center with the wrong URL still in the address bar. A mistyped
   * destination does NOT 404 — it looks like it worked. Change nothing here without re-checking
   * the route registry.
   */
  path: (account: string) => string;
  /**
   * Stated when the destination exists but cannot finish the job. Rendered next to the action so
   * the owner is not sent somewhere that quietly cannot help.
   */
  caveat?: string;
}

const acct = (account: string) => encodeURIComponent(account);

export const CHECK_DESTINATIONS: Record<SystemsCheckId, CheckDestination> = {
  company_info_populated: {
    title: "Your business details are on file",
    area: "identity",
    label: "Setup › Business profile",
    path: (a) => `/solo/${acct(a)}/settings/setup/business-profile`,
  },
  website_connected: {
    title: "Your website is on record",
    area: "identity",
    label: "Setup › Business profile",
    path: (a) => `/solo/${acct(a)}/settings/setup/business-profile`,
  },
  crm_has_customers: {
    title: "You have people on your books",
    area: "people",
    label: "Clients › People",
    path: (a) => `/solo/${acct(a)}/clients/people`,
  },
  sales_pipeline_configured: {
    title: "Your pipeline stages are set up",
    area: "sales",
    label: "Marketing › Pipeline",
    path: (a) => `/solo/${acct(a)}/growth/pipeline`,
  },
  revenue_tracking_configured: {
    title: "Revenue tracking is set up",
    area: "sales",
    // Stages are authored on Pipeline, not Sales. Sales is where the revenue SHOWS; sending someone
    // there to add a closing stage sends them to the result rather than to the fix.
    label: "Marketing › Pipeline",
    path: (a) => `/solo/${acct(a)}/growth/pipeline`,
    // NARROWED 2026-09-05, not removed, and the distinction is the whole point.
    //
    // It used to say the closing role could not be set "on that page or by Paige yet" — both halves
    // true: the governed RPC inserted a hardcoded 'open', and the `pipeline_configure` tool had no
    // field for it. Migration 20261205000000 retired the second half only. PAIGE can now set it on
    // request; `growth2.tsx` still contains zero references to stage_type, and that control is
    // Claude Design's to draw (§00).
    //
    // So the caveat stays and tells the owner the one route that WORKS. Deleting it outright would
    // have sent him to a page that still cannot finish the job this check names — the §70 failure
    // the caveat exists to prevent — and the check would have looked helped without being.
    caveat:
      "Ask Paige to mark a stage as closing and she will. That page cannot set it yet, so the button below will not finish this one on its own.",
  },
  payment_processor_connected: {
    title: "You can take payment",
    area: "sales",
    label: "Marketing › Sales",
    path: (a) => `/solo/${acct(a)}/growth/sales`,
  },
  payment_method_options: {
    title: "The ways you accept payment are written down",
    area: "sales",
    label: "Marketing › Sales",
    path: (a) => `/solo/${acct(a)}/growth/sales`,
  },
  comms_configured: {
    title: "Email, phone and texting are ready",
    // A query segment, not a path. Written as `/settings/connections/communications` it lands on
    // the default segment instead — silently, per the splat note above.
    area: "comms",
    label: "Connections › Communications",
    path: (a) => `/solo/${acct(a)}/settings/connections?segment=communications`,
  },
  social_accounts_connected: {
    title: "Your social accounts are on record",
    area: "campaigns",
    label: "Marketing › Social",
    path: (a) => `/solo/${acct(a)}/growth/social`,
    // The caveat that stood here until 2026-09-05 said this page "has no way to connect an account
    // yet, so this cannot be finished there today." It was true, and it is not any more: Campaigns
    // › Social now records the accounts a business posts from, through
    // public.record_social_handles — the first writer tenants.features->social_handles has had, and
    // the field this check reads. What the page still cannot do is CONNECT an account for
    // publishing, which this check has never asked for: it is a §38 capture-only check by owner
    // ruling (see the registry row in 20260816000000_systems_check_layer1.sql).
    caveat:
      "Recording the accounts is what this check asks for, and you can do that here. You cannot connect an account for publishing yet — that is a separate capability.",
  },
  automation_wired: {
    title: "An outside automation tool is connected",
    // The `automations` BRANCH is declared but redirects away and renders nothing; the working
    // destination is the leaf under Settings › Integrations.
    area: "integrations",
    label: "Settings › Integrations › Automations",
    path: (a) => `/solo/${acct(a)}/settings/integrations/automations`,
  },
};

/** The area a check belongs to, or null when the registry has grown past this map. */
export function areaForCheck(checkId: string | null | undefined): string | null {
  if (!checkId) return null;
  return CHECK_DESTINATIONS[checkId as SystemsCheckId]?.area ?? null;
}

export function destinationForCheck(checkId: string | null | undefined): CheckDestination | null {
  if (!checkId) return null;
  return CHECK_DESTINATIONS[checkId as SystemsCheckId] ?? null;
}
