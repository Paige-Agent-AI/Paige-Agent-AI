/**
 * WHERE EACH VIEW'S FEATURE ALREADY LIVES — the map from the six-slot IA onto shipped code.
 *
 * The thirteen-branch console is gone as an INTERFACE. Its FEATURES are not: every capability it
 * carried is placed here against one of the thirty-two views, so nothing that shipped disappears
 * because the shell around it changed. This is a mapping with one right answer per feature, not a
 * design question — the pack owns what the console looks like, this file owns where the existing
 * work plugs in.
 *
 * Three kinds of source, and the difference matters at render time:
 *
 *   "bespoke"  a real component that already reads live data — mount it.
 *   "panel"    one or more ported CD panel specs (`getPanelSpec`) that describe the surface's
 *              shape. All 78 of the old tree's leaves have one; they are structure, and their
 *              figures are stand-ins until a read is wired.
 *   none       nothing shipped answers this view. It renders the ABSENCE treatment, which names
 *              what is missing. A header over an empty section is the blank-screen failure this
 *              console has already been rejected for twice; absence is the designed alternative.
 *
 * The old address is recorded on every entry. That is the audit trail for "did anything get
 * dropped" — `viewSources.test.ts` walks the shipped branch registry and fails if a leaf appears
 * in no entry, so a feature cannot go missing silently the way it would have if this were prose.
 */
import type { OperatorSlotId } from "@/operator/ia/operatorIA";

export type ViewSource = {
  /** Component key the shell resolves to a real surface, when one already ships. */
  readonly bespoke?: string;
  /** Ported CD panel-spec keys, in the order they compose down the surface. */
  readonly panels?: readonly string[];
  /** Every old-tree address whose capability this view now carries. The drop-nothing ledger. */
  readonly carries: readonly string[];
};

/** Keyed `${slotId}/${viewSlug}`. */
export const VIEW_SOURCES: Readonly<Record<string, ViewSource>> = {
  // ── Fleet ──────────────────────────────────────────────────────────────────────────────────
  "fleet/systems-check": { bespoke: "SystemsCheckSurface", carries: ["fleet/systems-check"] },
  "fleet/directory": { bespoke: "FleetConsole", carries: ["fleet/tenants", "provisioning/pipeline"] },
  "fleet/history": {
    bespoke: "FleetHistorySurface",
    carries: ["fleet/history", "provisioning/history", "settings/governance/act-as-history"],
  },
  // Owner INT-280 continuation: Mind moves to Fleet; its existing read and source ledger survive.
  "fleet/mind": {
    bespoke: "KnowledgeSurface",
    carries: ["paige/knowledge", "paige/memory", "paige/documents", "paige/playbooks", "paige/research", "paige/sandbox"],
  },

  // ── Relationships ──────────────────────────────────────────────────────────────────────────
  /**
   * BUILD-ORDER Layer 3a — `peopleVals` (4854) · `convoVals` (5300) · `segVals` (6393), ported
   * as ONE group because they share one contract (see `relationshipsContract.ts`).
   *
   * People and Segments previously carried nothing at all, on the reasoning that the old tree
   * had no such branch and inventing one would be fabrication. Half of that still holds — the
   * DATA is not invented, and all three surfaces ship with no rows — but the SHAPE was never
   * ours to withhold: CD drew it, `absence-copy.md` authors the slot's absence in so many words
   * (*"the surfaces exist, the joins behind them do not"*), and BUILD-ORDER's structure-before-
   * data rule makes porting it the finished Layer 3 state rather than a jump ahead of the data.
   *
   * Conversations traded five PORTED SPECS off the RETIRED pack — they rendered `OperatorPanel`
   * with stand-in figures and read nothing — for the console those specs were standing in for.
   * The real operator comms capability (task #22's Twilio seam) is at its own address and is
   * untouched (§58). Their keys stay in `carries`.
   */
  "relationships/people": { bespoke: "PeopleSurface", carries: [] },
  "relationships/conversations": {
    bespoke: "ConversationsSurface",
    carries: ["comms/outbound", "comms/templates", "comms/sent-log", "support/inbox", "support/escalations", "support/response-policy"],
  },
  "relationships/calendar": {
    // The pack's own field (v3 L2547-L2581 / L11204-L11232), ported as CalendarWeekField.
    bespoke: "CalendarWeekField",
    carries: ["calendar/month", "calendar/booking-links", "calendar/settings", "calendar/tasks"],
  },
  "relationships/segments": { bespoke: "SegmentsSurface", carries: [] },

  // ── Campaigns ──────────────────────────────────────────────────────────────────────────────
  /**
   * `campVals` (5159). The old keys were the Growth branch's page/funnel/form builders — a
   * different capability entirely, standing in for the campaign motion because the old tree had
   * nothing else under this address. They stay in `carries` so the builders are not lost track
   * of; they simply never belonged on Active.
   */
  "campaigns/active": {
    bespoke: "CampaignsActive",
    carries: ["growth/pages", "growth/funnels", "growth/forms", "growth/builders"],
  },
  /**
   * BUILD-ORDER Layer 2's second and third priorities, closed by the Layer 3b port.
   *
   * Both views were rendering the RETIRED console's billing panels — `revenue/plans` and
   * `revenue/metering` standing where the catalogue belongs, `revenue/invoices` and
   * `revenue/at-risk` standing where Sales does. Those panels describe platform billing, which
   * is a different product from a tenant's own offerings and closed lines, so the views read
   * plausibly and were about the wrong thing.
   *
   * They are replaced by their v3 builders, not merely removed: `catVals` (5743) and `salesVals`
   * (5848). `carries` keeps naming the old keys — it is the drop-nothing ledger, and what it
   * records is that these views ABSORBED that content, not that they still render it.
   */
  "campaigns/catalog": {
    bespoke: "CatalogSurface",
    carries: ["revenue/plans", "revenue/metering"],
  },
  "campaigns/sales": {
    bespoke: "SalesSurface",
    carries: ["revenue/invoices", "revenue/at-risk"],
  },
  "campaigns/pipeline": { panels: ["fleet/prospects"], carries: ["fleet/prospects"] },
  "campaigns/social": {
    // BUILD-ORDER Layer 3e — v3 `socialVals` (7433–7564), not the retired Growth panels.
    bespoke: "SocialSurface",
    carries: ["growth/social", "growth/brand-kit", "growth/assets"],
  },
  "campaigns/performance": {
    panels: ["analytics/performance", "analytics/marketing"],
    carries: ["analytics/performance", "analytics/marketing"],
  },

  // ── Marketplace ────────────────────────────────────────────────────────────────────────────
  /**
   * BUILD-ORDER Layer 3c — `storeVals` (10054) · `catalogVals` (9434) · `pubsVals` (9540).
   * Submissions already shipped as `SubmissionsQueue`; these are the other three views of the
   * same slot, reading the same vocabulary out of `marketplaceVocabulary.ts` (§18).
   *
   * Each replaces ONE ported spec off the retired pack — `marketplace/discover`,
   * `marketplace/build`, `marketplace/publishers` — which rendered a generic panel and read
   * nothing. Their keys stay in `carries`.
   */
  "marketplace/storefront": { bespoke: "StorefrontSurface", carries: ["marketplace/discover"] },
  "marketplace/catalog": { bespoke: "MarketCatalogSurface", carries: ["marketplace/build"] },
  "marketplace/submissions": {
    // v3 L2281-L2326 + subsVals L9506-L9572, ported as SubmissionsQueue.
    bespoke: "SubmissionsQueue",
    carries: ["marketplace/submissions"],
  },
  "marketplace/publishers": { bespoke: "PublishersSurface", carries: ["marketplace/publishers"] },

  // ── Analytics ──────────────────────────────────────────────────────────────────────────────
  "analytics/fleet": {
    panels: ["analytics/brief", "analytics/revenue", "analytics/forecast"],
    carries: ["analytics/brief", "analytics/revenue", "analytics/forecast"],
  },
  "analytics/relationships": {
    panels: ["analytics/comms", "analytics/support", "analytics/retention"],
    carries: ["analytics/comms", "analytics/support", "analytics/retention"],
  },
  "analytics/campaigns": { panels: ["analytics/product"], carries: ["analytics/product"] },
  "analytics/autonomy": {
    bespoke: "TrustCompass",
    carries: ["analytics/autonomy", "trust-compass/autonomy", "trust-compass/escalations", "trust-compass/dependencies"],
  },
  /**
   * The Platform Operator Command Center's first view (mandate 2026-09-12, Phase 2; map:
   * `docs/delivery/platform-operator-command-center.md`). The pack draws THIS view's content
   * at `paige-ia.js` L268–L294 (ledgerByView + slot ledger) and L496–L508 (four charts) —
   * ported as `PlatformHealthSurface` with real reads behind every figure.
   *
   * §58 — this view previously rendered `FleetTeamPulseSurface`, a RETIRED-pack port
   * (`Super Admin Shell.dc.html` L6593) that the v3 pack draws nowhere, mounted here as a
   * stopgap. It is displaced, not dropped, and `carries` keeps `fleet/team-pulse` as the
   * drop-nothing record of where that content lived.
   *
   * UPDATED 2026-09-23 — the component itself was STRIPPED (§30), and the earlier note here was
   * wrong on the point it rested on. It justified keeping the file on disk "like
   * `OperatorLegacyApp`", but that file does not exist: `src/operator/legacy/` is gone, stripped
   * itself, so the precedent for retention was a file that had already been removed. Unmounting
   * it also moved it into the one cell `lint:pack-lineage` exists to fail — unreachable AND
   * dead-pack — which has no exemption path by design, so the guard was red on main from the
   * moment of the unmount.
   *
   * What is OWED is unchanged and is not the component: the platform roster read
   * (`list_platform_staff()`) is owed to the v3 Settings → Team port (Layer 6 wiring), which is
   * where the pack places platform staff. That read survives at `src/operator/data/useTeamPulse.ts`
   * and is registered in `operator-reachability.mjs`'s EXEMPT map with this reason. The v3 port
   * will draw its own surface; it was never going to reuse the retired pack's.
   */
  "analytics/platform-health": {
    bespoke: "PlatformHealthSurface",
    carries: ["fleet/team-pulse"],
  },

  // ── Settings ───────────────────────────────────────────────────────────────────────────────
  /**
   * v3 `setupVals` L8915–L9086 over `P.SETUP`, ported as `SetupSurface` (BUILD-ORDER Layer 3d).
   * The generic panel's three keys stay in `carries` — the drop-nothing ledger — because the
   * bespoke surface answers all three inside its own catalogue: operator identity is the "Who you
   * are" group, brand kit is `Brand identity — mark, palette, type`, and the model router is
   * reached from `Trust Compass ceiling` and Platform rather than from here.
   */
  "settings/setup": {
    bespoke: "SetupSurface",
    carries: ["settings/setup/operator", "settings/setup/brand-kit", "settings/setup/model-router"],
  },
  "settings/platform": {
    panels: ["settings/setup/feature-flags", "settings/setup/api-mcp"],
    carries: ["settings/setup/feature-flags", "settings/setup/api-mcp"],
  },
  // INT-280 restores the unmounted PlatformIntelligence read capabilities into Settings.
  // The pre-six-slot /admin/platform/intelligence address is redirected in App.tsx.
  "settings/paige-intelligence": { bespoke: "IntelligenceSurface", carries: [] },
  "settings/connections": { bespoke: "ConnectionsSettings", carries: [] },
  "settings/analytics": { bespoke: "AnalyticsSettings", carries: [] },
  "settings/billing": { bespoke: "BillingSettings", carries: [] },
  "settings/integrations": {
    // v3 intVals L7928-L8082 over the L1473-L1538 catalogue, ported as IntegrationsSurface.
    bespoke: "IntegrationsSurface",
    carries: ["settings/integrations/connected", "settings/integrations/health", "settings/integrations/available"],
  },
  /**
   * Owner ruling 2026-08-23. We provision and sell Twilio numbers to tenants and there was no
   * destination for it — the gap that produced this view. No shipped operator surface answers it
   * yet, so it renders the absence that NAMES the capability rather than a plausible-looking
   * empty inventory. It carries no old address because the thirteen-branch console never had one.
   */
  "settings/numbers": { carries: [] },
  "settings/automations": {
    panels: ["automations/library", "automations/runs", "automations/build"],
    carries: ["automations/library", "automations/runs", "automations/build"],
  },
  "settings/alerts": { bespoke: "FleetAlertRulesSurface", carries: ["fleet/alert-rules"] },
  /**
   * v3 `capsVals` L9945–L10052, ported as `CapabilitiesSurface` — and WIRED, which no other
   * Layer 3d surface is. `list_tool_autonomy()` / `set_tool_autonomy()` both ship, so the tools,
   * their modes, the four counts and the write are real rather than waiting for Layer 6.
   */
  "settings/capabilities": {
    bespoke: "CapabilitiesSurface",
    carries: ["settings/setup/capabilities", "paige/skills", "paige/sub-agents", "paige/actions"],
  },
  /**
   * BUILD-ORDER Layer 2, first priority: `settings/vault/vendors` is REMOVED from what this view
   * RENDERS, and stays in `carries`.
   *
   * The ruling: **Vault must not read `business_vendors`.** That table is the funding vertical's
   * credit tracker, which happens to share a word with the platform Vault. The old panel key was
   * how it came back in through the side door — and the failure mode is the dangerous one: it
   * renders plausibly and is wrong, so nothing about the screen says the operator is looking at
   * another product's data.
   *
   * §58: this removes a panel that shipped. It is called out rather than dropped quietly, and
   * the capability is not lost — `carries` is the drop-nothing ledger and still names it, so the
   * v3 port (`vaultVals` 9755, Layer 3d) knows what this view owes. Obligations and Documents
   * keep rendering in the meantime; a view that shows two correct panels is honest, and one that
   * shows a third from the wrong product is not.
   */
  "settings/vault": {
    panels: ["settings/vault/obligations", "settings/vault/documents"],
    carries: ["settings/vault/obligations", "settings/vault/vendors", "settings/vault/documents"],
  },
  "settings/governance": {
    panels: ["settings/governance/approvals", "settings/governance/audit-log", "settings/governance/security"],
    carries: ["settings/governance/approvals", "settings/governance/audit-log", "settings/governance/security"],
  },
  "settings/team": {
    bespoke: "TeamSettings",
    carries: ["settings/team/seats", "settings/team/roles", "paige/team"],
  },
};

/**
 * Old-tree addresses that are deliberately carried by NO view, with the reason.
 *
 * Kept as data rather than dropped from the map, because "we decided this isn't a place" and "we
 * forgot this existed" look identical in an absence. The coverage test reads this list, so
 * retiring something is an edit here and never a silent omission.
 */
export const RETIRED_ADDRESSES: Readonly<Record<string, string>> = {
  // The console IS Paige's surface — the spine holds her, so a rail branch for "chat with Paige"
  // is a place for something that is already everywhere.
  "paige/chat": "the spine is Paige's home in this shell; a branch for her is a duplicate place",
  "paige/workspace": "the console is the workspace; a view inside it named after it is circular",
};

export function viewSource(slotId: OperatorSlotId, viewSlug: string): ViewSource | null {
  return VIEW_SOURCES[`${slotId}/${viewSlug}`] ?? null;
}
