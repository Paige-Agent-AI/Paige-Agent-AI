/**
 * The operator console's information architecture — six slots, thirty-two views.
 *
 * This mirrors the v3 reference pack's `P.PLACES` + `P.DEST` (see
 * `docs/design-references/cd-packs/super-admin-shell-v3/paige-ia.js`). A Vite bundle cannot import
 * a design artifact at runtime, so the IA ships as this module and a test pins the two together:
 * a deliberate IA change updates both in the same PR. The pack is reference, not authority — root
 * `CLAUDE.md` §00 (owner, 2026-09-22): CC owns the interface under Impeccable; the owner approves.
 *
 * SIX SLOTS, NOT SEVEN. Ruled three times during design: a rail slot is a body of work with its own
 * objects and its own performance. Everything else is a view, a summoned surface, or a mechanism.
 * Sequences folded into Active; Follow-ups became an automation; Field became Marketplace with
 * Calendar moving to Relationships. **Do not add a slot without an owner ruling.**
 *
 * ABSENCE COPY. The absence strings below came from the pack's `docs/handoff/absence-copy.md`.
 * Each does a specific job, worth knowing before anyone "tidies" them. Relationships distinguishes
 * DRAWN from WIRED, because an operator seeing an empty slot assumes the question is still open —
 * this says the decision is closed and only the seam is missing, so nobody re-opens it. Campaigns
 * names the tables so the slot is not rebuilt from scratch, AND names the missing seam so nobody
 * finds `utm_campaign` on `analytics_events`, assumes the join exists, and hits it at the join.
 *
 * SUB-TAB COUNT IS NOT SLOT PRESSURE. The thirteen-branch tree this replaces carried 83 sub-tabs.
 * That is not an argument for more slots — every homeless sub-tab is a view, a summoned surface, or
 * a mechanism that was never a place. Anything without a slot is reached through the command
 * palette: a capability opens its own surface and retires when you close it, and none holds a place
 * in the rail.
 */

export type OperatorSlotId =
  | "fleet" | "relationships" | "campaigns" | "marketplace" | "analytics" | "settings";

export type OperatorSlot = {
  readonly id: OperatorSlotId;
  readonly label: string;
  /** View names exactly as the pack spells them — they are shown, not slugs. */
  readonly views: readonly string[];
  /**
   * A slot with no built destination yet. Renders the pack's ABSENCE treatment
   * (`hasAbsence`/`absenceTitle`/`absenceBody`) rather than an invented empty state — absence is
   * already designed, and §13 governs the copy: say what is missing and why.
   */
  readonly absence?: { readonly title: string; readonly body: string };
};

export const OPERATOR_SLOTS: readonly OperatorSlot[] = [
  {
    id: "fleet",
    label: "Fleet",
    views: ["Overview", "Systems check", "Directory", "History", "Mind"],
  },
  {
    id: "relationships",
    label: "Relationships",
    views: ["People", "Conversations", "Calendar", "Segments"],
    absence: {
      title: "Drawn, not wired",
      body: "People, Conversations, Segments and Calendar are specified and their contract is fixed. None of the four reads live data yet: the surfaces exist, the joins behind them do not. Nothing here is waiting on a decision — only on the wiring.",
    },
  },
  {
    id: "campaigns",
    label: "Campaigns",
    views: ["Active", "Catalog", "Sales", "Pipeline", "Social", "Performance"],
    absence: {
      title: "Substrate exists \u00b7 one seam missing",
      body: "Catalog and Sales sit on tables that already ship — tenant_products, tenant_prices, tenant_orders — so this slot is a wiring job rather than a build. One seam is genuinely absent: an order cannot name a campaign. utm_campaign lives on analytics_events and referral_clicks, never on the order, so send → click → order does not join. Until it does, attribution is recorded by hand and Sales reads without it.",
    },
  },
  {
    id: "marketplace",
    label: "Marketplace",
    views: ["Storefront", "Catalog", "Submissions", "Publishers"],
  },
  {
    id: "analytics",
    label: "Analytics",
    views: ["Fleet", "Relationships", "Campaigns", "Autonomy", "Platform health"],
  },
  {
    id: "settings",
    label: "Settings",
    /**
     * ELEVEN views, not ten. "Numbers" was added by owner ruling (2026-08-23) when the Twilio
     * number inventory turned out to have no destination anywhere in the IA.
     *
     * It is deliberately NOT under Integrations: that is a CONNECTION surface, and an inventory
     * of provisioned numbers with assignment and billing is not a connection. Settings is where
     * platform-owned inventory lives — Vault holds obligations, Team holds seats, Numbers holds
     * numbers. Adding a view inside an existing slot is a view decision; it is not an IA change
     * and it does not touch the six-slot ruling.
     */
    views: [
      "Setup", "Platform", "Integrations", "Numbers", "PAIGE Intelligence", "Automations",
      "Alerts", "Capabilities", "Vault", "Governance", "Team",
      // Owner's Settings sub-main menu adds these destinations; existing leaves stay addressable.
      "Connections", "Analytics", "Billing",
    ],
  },
] as const;

/** Total views across every slot — 32 in the pack. Derived, never typed beside the list (rule 3). */
export const OPERATOR_VIEW_COUNT = OPERATOR_SLOTS.reduce((n, s) => n + s.views.length, 0);

/**
 * Guarded lookup. One bad key must not blank the shell — the pack's own rule 6, learned when a
 * missing catalogue entry took down every surface rather than one row.
 */
export function findSlot(id: string | undefined): OperatorSlot | null {
  if (!id) return null;
  return OPERATOR_SLOTS.find((s) => s.id === id) ?? null;
}

/** A slug the router can carry, from a view name the design spells for a human. */
export function viewSlug(view: string): string {
  return view.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
