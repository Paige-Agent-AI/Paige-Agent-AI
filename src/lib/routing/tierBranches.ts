/**
 * TIER_BRANCHES — the canonical route-tree registry (§65 §13, owner-locked 2026-08-17).
 *
 * ONE declarative source of truth for "which branches (deep-linkable tabs) each account
 * type has." This is the §10 config-as-data spine: adding a branch is a data row here,
 * never per-tier React. It drives BOTH the nav rail and the URL router (§18 one home) so
 * they can never drift; and it is Paige-readable (§52/§159 — "what branches exist on my
 * tenant?" answers by reading this registry for the tier).
 *
 * The registry is DATA only (slug · key · label · order). It deliberately imports NO React
 * components — each shell keeps its own `screens` map (key → component); the shell reads the
 * URL's branch slug → resolves the branch here → renders `screens[branch.key]`. That keeps
 * this file a pure, decoupled config the agent can reason over.
 *
 * Doctrine encoded here (do not "simplify" away):
 *   • §11c / §60 — a Sub-account inherits the SOLO tree, NOT the Agency tree (Solo ≡
 *     Sub-account except billing). So `sub_account` and `solo` share `SOLO_BRANCHES`; only the
 *     ROOT prefix differs (`/business` vs `/solo`, §3 shared shell, §65 mental-model label).
 *   • §3 / §61 — Enterprise = Agency baseline + tier-customization branches (same shell, extra
 *     branches, never a fork).
 *   • §65 — the URL slug is the human mental-model word (`trust-compass`); the internal `key`
 *     (`compass`) is the shell's own id. Slug ≠ key by design.
 *   • Full tree map + the ten locked design rulings: `docs/doctrine/route-and-url-taxonomy.md`
 *     §10–§15.
 */

/** Tier identity for routing. Mirrors `resolveTierKey` (src/lib/tier/tierFeatures.ts) plus operator. */
export type RouteTierKey =
  | "operator"
  | "agency"
  | "enterprise"
  | "solo"
  | "sub_account";

/** One deep-linkable SUB-tab within a branch (the 2nd nav level, §65 3-level tree). */
export interface SubTab {
  /** URL segment `/agency/{n}/{branch}/{slug}` — human mental-model word, url-safe. */
  slug: string;
  /** Previously shipped URL segments that resolve to this canonical subtab. */
  aliases?: string[];
  /** Rail glyph, where the tier's design gives one (the operator settings back-menu). */
  glyph?: string;
  /** The screen's internal sub-tab id (its `useState` value). May differ from slug. */
  key: string;
  /** Sub-tab label. */
  label: string;
  /** Addressable branch-root view owned by the parent destination, not its visible strip. */
  hidden?: boolean;
  /**
   * OPTIONAL third level — used only by the OPERATOR tree's `settings` branch, because the
   * design nests settings one level deeper (`/operator/settings/governance/audit-log`).
   * Additive: every tenant tier leaves this undefined and is unaffected.
   */
  subtabs?: SubTab[];
}

/** One deep-linkable branch (a tab that is a real URL segment). Pure data. */
export interface Branch {
  /** URL segment — the human mental-model word (§65). Lowercase, url-safe. */
  slug: string;
  /** The shell's internal screen id (its `screens[key]` map). May differ from slug. */
  key: string;
  /** Nav label. */
  label: string;
  /** Which nav group the rail renders it under. */
  /**
   * Which nav group the rail renders it under. `main`/`platform` are the tenant-tier groups;
   * `fleet`/`business`/`settings` are the operator tree's (§65 operator pack) — a `settings`
   * branch auto-opens the back menu. Additive union: no existing value changed.
   */
  group: "main" | "platform" | "fleet" | "business" | "settings";
  /**
   * The rail glyph, for tiers whose design carries one. Claude Design's operator rail sets a
   * distinct mark per branch, and the rail reads as a bare list of words without them. Optional
   * and additive: the tenant tiers leave it undefined and render exactly as before.
   */
  glyph?: string;
  /**
   * Optional 2nd-level sub-tabs (§65 3-level tree, owner 2026-08-17). `subtabs[0]` is the
   * DEFAULT — rendered at the bare `/agency/{n}/{branch}` URL (no 3rd segment). A branch
   * with no sub-tabs (Trust Compass in sub/solo mode, Client Support, Integrations) omits
   * this. Slugs verified against the live agency screens (`src/agency/*.tsx`); the screen's
   * internal `useState` sub-tab converts to reading the 3rd URL segment in the per-screen
   * implementation slices (task #172).
   */
  subtabs?: SubTab[];
}

/** A tier's tree: its URL root prefix + its ordered branch set. */
export interface TierTree {
  /** URL prefix, e.g. "/agency". The account segment + branch follow: `${root}/{account}/{slug}`. */
  root: string;
  /** Ordered branches (nav + route order). branches[0] is the default branch. */
  branches: Branch[];
  /**
   * Does this tier's URL carry an account segment? Tenant tiers do
   * (`/agency/{account}/{branch}`); the OPERATOR is tenant-less, so its paths are
   * `/operator/{branch}/{subtab}` with no account (§65 matrix row 1). Defaults to true.
   */
  accountSegment?: boolean;
}

/**
 * SOLO_BRANCHES — the Solo tree (13). Shared by `solo` AND `sub_account` (§11c/§60).
 * Keys match `src/solo/SoloApp.tsx`'s `screens` registry.
 *
 * Sub-tabs verified screen-by-screen against the Solo screen SOURCE (47 across 9
 * branches) — a source read, not a browser drive; the §32.c live-drive is owed separately.
 * `tierBranches.test.ts` enforces this by parsing each screen's rendered strip, so the pairing
 * can't silently drift. Solo's internal sub-tab keys remain screen-owned (`pipe`/`sch`/
 * `ov`/`mkt`/`dir`/`biz`…) and deliberately DIFFER from the agency keys for the same mental-model
 * slug — the two tiers are separate shells with separate `useState` vocabularies. Do NOT
 * "normalize" a Solo key to match its agency twin: the key is what the screen actually switches
 * on, so an aligned-looking key produces a dead route (locked by test, §13).
 */
export const SOLO_BRANCHES: Branch[] = [
  {
    slug: "command-center", key: "home", label: "Command Center", group: "main",
    // Business Game Plan is the default Command Center landing (owner-approved 2026-09-05).
    // subtabs[0] is the default the bare `/command-center` renders; the former `overview`
    // address is a compatibility alias of this new default owner (moved off Systems Check).
    // Trust Compass takes position 3 (between Systems Check and Mind) in the intended final
    // order — but ONLY when its owner ships a real Command Center sub-tab. It is deliberately
    // NOT declared here as a dead/placeholder tab (owner ruling 2026-09-05; four-surfaces §4).
    subtabs: [
      { slug: "business-game-plan", aliases: ["overview"], key: "plan", label: "Business Game Plan" },
      { slug: "systems-check", key: "sys", label: "Systems Check" },
      // Trust Compass is the third Command Center surface (owner-ruled 2026-09-05):
      // Business Game Plan → Systems Check → Trust Compass → Mind.
      { slug: "trust-compass", key: "compass", label: "Trust Compass" },
      { slug: "mind", aliases: ["directory", "history"], key: "mind", label: "Mind" },
    ],
  },
  {
    slug: "paige", key: "paige", label: "Paige", group: "main",
    // Source: src/solo/SoloPaigeWorkspace.tsx. Solo intentionally exposes the
    // customer-facing Chat, Knowledge, Helpers, and Capabilities contract only.
    subtabs: [
      { slug: "chat", key: "chat", label: "Chat" },
      { slug: "knowledge", key: "knowledge", label: "Knowledge" },
      { slug: "helpers", key: "helpers", label: "Helpers" },
      { slug: "capabilities", key: "capabilities", label: "Capabilities" },
    ],
  },
  // Trust Compass moved INTO Command Center as its third sub-tab (owner-ruled 2026-09-05); it is no
  // longer a top-level Solo branch. The legacy address `/solo/{account}/trust-compass` stays alive
  // via a `replace` redirect in SoloApp.tsx into the canonical Command Center path, so old links do
  // not break (§58). No duplicate top-level surface remains.
  {
    slug: "automations", key: "auto", label: "Automations", group: "main",
    // Source: src/solo/automations-build.tsx.
    subtabs: [
      { slug: "library", key: "lib", label: "Automations" },
      { slug: "runs", key: "runs", label: "Runs" },
      { slug: "build", key: "build", label: "Build" },
    ],
  },
  {
    slug: "clients", key: "clients", label: "Clients", group: "main",
    // Owner-approved relationship workspace. Pipeline remains under Campaigns. Delivery is
    // preserved in its legacy implementation but is not a Clients subtab. Hidden compatibility
    // entries keep previously copied URLs resolvable without presenting them as current IA.
    subtabs: [
      { slug: "people", key: "people", label: "People" },
      { slug: "conversations", key: "conversations", label: "Conversations" },
      { slug: "calendar", key: "calendar", label: "Calendar" },
      { slug: "portal", aliases: ["client-portal"], key: "portal", label: "Portal" },
      { slug: "pipeline", key: "pipe", label: "Pipeline", hidden: true },
      { slug: "delivery", key: "deliv", label: "Delivery", hidden: true },
    ],
  },
  {
    slug: "calendar", key: "cal", label: "Calendar", group: "main",
    // One canonical Calendar owner. Legacy slugs remain aliases so copied links
    // resolve without preserving the retired fixture IA.
    subtabs: [
      { slug: "week", aliases: ["calendar", "schedule"], key: "calendar", label: "Calendar" },
      { slug: "agenda", aliases: ["requests"], key: "agenda", label: "Agenda" },
      { slug: "tasks", key: "tasks", label: "Tasks" },
      { slug: "booking-pages", aliases: ["booking-links", "routing"], key: "booking", label: "Booking pages" },
      { slug: "availability", key: "availability", label: "Availability" },
      { slug: "connections", aliases: ["settings"], key: "connections", label: "Connections" },
    ],
  },
  {
    slug: "growth", key: "growth", label: "Marketing", group: "main",
    // Marketing is the department (owner ruling 2026-10-03, docs/product/solo-marketing-ia-proposal.md).
    // Campaigns is one function inside it. Vibe Studio stays the only creative owner and opens
    // through its existing side action; Lead capture measures how published Vibe work is USED.
    // The slug stays `growth` until the canonical-URL slice (S5) so no copied link breaks.
    //
    // Commercial entries stay hidden for intent-preserving compatibility redirects into Sales.
    // Retired creative slugs still resolve to the compatibility landing, which now points at
    // Lead capture instead of Catalog.
    subtabs: [
      { slug: "overview", key: "overview", label: "Overview" },
      { slug: "campaigns", aliases: ["active"], key: "campaigns", label: "Campaigns" },
      { slug: "lead-capture", aliases: ["brand-kit", "pages", "funnels", "forms", "builders"], key: "capture", label: "Lead capture" },
      { slug: "social", key: "social", label: "Social" },
      { slug: "analytics", aliases: ["performance"], key: "analytics", label: "Analytics" },
      { slug: "catalog", key: "catalog", label: "Offers", hidden: true },
      { slug: "sales", key: "sales", label: "Sales", hidden: true },
      { slug: "pipeline", key: "pipeline", label: "Pipeline", hidden: true },
    ],
  },
  {
    slug: "sales", key: "sales", label: "Sales", group: "main",
    subtabs: [
      { slug: "overview", key: "overview", label: "Overview" },
      { slug: "opportunities", key: "opportunities", label: "Opportunities" },
      { slug: "pipeline", key: "pipeline", label: "Pipeline" },
      { slug: "offers", key: "offers", label: "Offers" },
      { slug: "agreements", key: "agreements", label: "Terms & Agreements" },
      { slug: "payments", key: "payments", label: "Payments" },
      { slug: "performance", key: "performance", label: "Performance" },
    ],
  },
  {
    slug: "analytics", key: "analytics", label: "Analytics", group: "main",
    // Source: src/solo/analytics2.tsx.
    subtabs: [
      { slug: "brief", key: "brief", label: "Brief" },
      { slug: "money", key: "money", label: "Sales funnel" },
      { slug: "profitability", key: "profit", label: "Revenue & profit" },
      { slug: "retention", key: "ret", label: "Retention" },
      { slug: "market-watch", key: "mkt", label: "Acquisition" },
      { slug: "decisions", key: "dec", label: "Decisions" },
    ],
  },
  {
    slug: "marketplace", key: "market", label: "Marketplace", group: "platform",
    // Source: src/solo/marketplace.tsx — FOUR only. Curated + Publish are agency-only
    // (a Solo tenant consumes the marketplace, it does not curate or publish to a book).
    subtabs: [
      { slug: "today", key: "today", label: "Today" },
      { slug: "browse", key: "browse", label: "Browse" },
      { slug: "installed", key: "installed", label: "Installed" },
      { slug: "updates", key: "updates", label: "Updates" },
    ],
  },
  {
    slug: "settings", key: "settings", label: "Settings", group: "platform",
    // Owner-locked Solo Settings taxonomy. Previously shipped Setup, Team, Integrations,
    // and Business Vault paths are compatibility redirects in SoloApp, never parallel owners.
    subtabs: [
      { slug: "setup", key: "setup", label: "Setup" },
      { slug: "team", key: "team", label: "Team" },
      { slug: "connections", key: "connections", label: "Connections" },
      { slug: "integrations", key: "integrations", label: "Integrations" },
      { slug: "security-data", key: "security-data", label: "Security & data" },
      { slug: "vault", key: "vault", label: "Vault" },
      { slug: "billing", key: "billing", label: "Billing" },
    ],
  },
];

/**
 * AGENCY_BRANCHES — the Agency tree (15). Keys match `src/agency/AgencyApp.tsx`'s `screens`.
 * Superset of Solo with the manager-tier branches (Client Support + Billing over a book of
 * sub-accounts). Enterprise extends this (§3/§61).
 */
export const AGENCY_BRANCHES: Branch[] = [
  {
    slug: "command-center", key: "command", label: "Command Center", group: "main",
    // `main` remains the addressable branch root. The visible tenant strip is consistent
    // across Agency Parent, Sub-account, and Enterprise contexts.
    subtabs: [
      { slug: "overview", key: "main", label: "Command Center", hidden: true },
      { slug: "systems-check", key: "systems", label: "Systems Check" },
      { slug: "directory", key: "directory", label: "Directory" },
      { slug: "history", key: "history", label: "History" },
    ],
  },
  {
    slug: "paige", key: "paige", label: "Paige", group: "main",
    subtabs: [
      { slug: "chat", key: "chat", label: "Chat" },
      { slug: "knowledge", key: "knowledge", label: "Knowledge" },
      { slug: "sub-agents", key: "agents", label: "Sub-Agents" },
      { slug: "actions", key: "actions", label: "Actions" },
      { slug: "skills", key: "skills", label: "Skills" },
      { slug: "paige-team", key: "pteam", label: "Paige Team" },
    ],
  },
  {
    slug: "trust-compass", key: "compass", label: "Trust Compass", group: "main",
    // SCOPE switch, AGENCY-ONLY (hidden in sub/solo). Not destination tabs — flags which
    // book the compass shows. Sub/solo Trust Compass has NO sub-tabs.
    subtabs: [
      { slug: "agency", key: "agency", label: "Agency" },
      { slug: "book", key: "book", label: "Book" },
      { slug: "per-sub-account", key: "sub", label: "Per sub-account" },
    ],
  },
  {
    slug: "automations", key: "autos", label: "Automations", group: "main",
    subtabs: [
      { slug: "library", key: "library", label: "Automations" },
      { slug: "runs", key: "runs", label: "Runs" },
      { slug: "build", key: "build", label: "Build" },
    ],
  },
  {
    slug: "clients", key: "fleet", label: "Relationships", group: "main",
    // Agency Parent and Enterprise own Relationships. Portal is addressable only for a
    // server-confirmed acting child and remains hidden from parent navigation.
    subtabs: [
      { slug: "people", key: "people", label: "People" },
      { slug: "conversations", key: "conversations", label: "Conversations" },
      { slug: "calendar", key: "calendar", label: "Calendar" },
      { slug: "segments", key: "segments", label: "Segments" },
      { slug: "portal", key: "portal", label: "Portal", hidden: true },
      { slug: "sub-accounts", key: "directory", label: "Sub-accounts", hidden: true },
      { slug: "pipelines", key: "pipes", label: "Pipelines", hidden: true },
    ],
  },
  {
    slug: "calendar", key: "calendar", label: "Calendar", group: "main",
    subtabs: [
      { slug: "week", aliases: ["calendar", "schedule"], key: "calendar", label: "Calendar" },
      { slug: "agenda", aliases: ["requests"], key: "agenda", label: "Agenda" },
      { slug: "tasks", key: "tasks", label: "Tasks" },
      { slug: "booking-pages", aliases: ["booking-links"], key: "booking", label: "Booking pages" },
      { slug: "availability", key: "availability", label: "Availability" },
      { slug: "connections", aliases: ["settings"], key: "connections", label: "Connections" },
    ],
  },
  // Client Support has NO sub-tabs (single ticket surface + status filter chips).
  { slug: "client-support", key: "support", label: "Client Support", group: "main" },
  {
    slug: "growth", key: "growth", label: "Growth", group: "main",
    // Vibe Studio is NOT a sub-tab — a full-screen overlay opened from the header; not deep-linkable here.
    subtabs: [
      { slug: "overview", key: "overview", label: "Overview" },
      { slug: "brand-kit", key: "brand", label: "Brand Kit" },
      { slug: "social", key: "social", label: "Social" },
      { slug: "pages", key: "pages", label: "Pages" },
      { slug: "funnels", key: "funnels", label: "Funnels" },
      { slug: "forms", key: "forms", label: "Forms" },
      { slug: "builders", key: "builders", label: "Builders" },
    ],
  },
  {
    slug: "analytics", key: "analytics", label: "Analytics", group: "main",
    subtabs: [
      { slug: "brief", key: "brief", label: "Brief" },
      { slug: "money", key: "money", label: "The money" },
      { slug: "profitability", key: "profit", label: "Profitability" },
      { slug: "retention", key: "retain", label: "Retention" },
      { slug: "decisions", key: "decide", label: "Decisions" },
      { slug: "market-watch", key: "market", label: "Market watch" },
    ],
  },
  {
    slug: "billing", key: "billing", label: "Billing", group: "main",
    // Sub-account mode: invoices relabels "Invoices" + revenue is dropped.
    subtabs: [
      { slug: "sub-account-billing", key: "invoices", label: "Sub-account billing" },
      { slug: "revenue", key: "revenue", label: "Revenue" },
      { slug: "your-plan", key: "plan", label: "Your plan" },
    ],
  },
  {
    slug: "marketplace", key: "market", label: "Marketplace", group: "platform",
    // Sub-account mode: only today/browse/installed/updates (curated + publish are agency-only).
    subtabs: [
      { slug: "today", key: "today", label: "Today" },
      { slug: "browse", key: "browse", label: "Browse" },
      { slug: "installed", key: "installed", label: "Installed" },
      { slug: "updates", key: "updates", label: "Updates" },
      { slug: "curated", key: "curated", label: "Curated" },
      { slug: "publish", key: "publish", label: "Publish" },
    ],
  },
  {
    slug: "business-vault", key: "vault", label: "Business Vault", group: "platform",
    subtabs: [
      { slug: "vault", key: "vault", label: "Vault" },
      { slug: "registry", key: "registry", label: "Registry" },
      { slug: "renewals", key: "renewals", label: "Renewals" },
      { slug: "vendors", key: "vendors", label: "Vendors" },
    ],
  },
  // The AGENCY Integrations screen is a STUB today (placeholder card, no content / no
  // sub-tabs). §13 per-tier accuracy: this is true of the agency screen ONLY — Solo's
  // Integrations (src/solo/integrations.tsx) is fully built and DOES carry three sub-tabs
  // (Catalog · Web Automator · Activity), declared on SOLO_BRANCHES above.
  { slug: "integrations", key: "integrations", label: "Integrations", group: "platform" },
  {
    slug: "team", key: "team", label: "Team", group: "platform",
    subtabs: [
      { slug: "roster", key: "roster", label: "Roster" },
      { slug: "directory", key: "directory", label: "Directory" },
      { slug: "roles-invites", key: "roles", label: "Roles & invites" },
      { slug: "workload", key: "workload", label: "Workload" },
      { slug: "performance", key: "performance", label: "Performance" },
      { slug: "activity", key: "activity", label: "Activity" },
    ],
  },
  {
    slug: "setup", key: "setup", label: "Setup", group: "platform",
    subtabs: [
      { slug: "business", key: "business", label: "Business" },
      { slug: "presence", key: "presence", label: "Presence" },
      { slug: "owner", key: "owner", label: "Owner" },
      { slug: "contacts", key: "contacts", label: "Contacts" },
      { slug: "people", key: "people", label: "People" },
      { slug: "banking", key: "banking", label: "Banking" },
      { slug: "comms-data", key: "comms", label: "Comms & data" },
    ],
  },
];

/**
 * Direct Sub-account compatibility tree. It keeps the shared AgencyApp screen keys while
 * presenting the owner-approved Clients matrix. The route is an address only; AgencyApp's
 * server-resolved tenant context remains the authority for every read.
 */
export const SUB_ACCOUNT_BRANCHES: Branch[] = AGENCY_BRANCHES.map((branch) =>
  branch.slug === "clients"
    ? {
        ...branch,
        label: "Clients",
        subtabs: [
          { slug: "people", key: "people", label: "People" },
          { slug: "conversations", key: "conversations", label: "Conversations" },
          { slug: "calendar", key: "calendar", label: "Calendar" },
          { slug: "portal", key: "portal", label: "Portal" },
          { slug: "segments", key: "segments", label: "Segments", hidden: true },
          { slug: "sub-accounts", key: "directory", label: "Sub-accounts", hidden: true },
          { slug: "pipelines", key: "pipes", label: "Pipelines", hidden: true },
        ],
      }
    : branch,
);

/**
 * OPERATOR_BRANCHES — the Platform Operator (God-tier) tree. **17 branches / 78 sub-tabs.**
 *
 * AUTHORED from Claude Design's Super Admin pack (`paige-routes.js`, the pack's own canonical
 * registry) — GENERATED by executing that file, not hand-transcribed, so the mapping is exact:
 *   design `section` → `slug` · `view` → `key` · `label` → `label` · `group` → `group`
 *   design `sub` → subtab `slug` · `tab` → subtab `key` · `subLabel` → subtab `label`
 * A design route with an empty `sub` is that section's DEFAULT tab and is emitted as
 * `subtabs[0]`, matching this file's existing convention (bare branch path renders subtabs[0]).
 *
 * The five `settings/*` slugs keep their compound form deliberately: the pack nests settings one
 * level deeper (`/operator/settings/governance/audit-log`), and preserving that here keeps ONE
 * registry (§18) rather than forking a second settings tree. `group: "settings"` is what tells
 * the shell to auto-open the back menu.
 *
 * §13 SCOPE HONESTY: this is the ROUTE SUBSTRATE ONLY. Authoring a branch here does NOT mean a
 * surface exists — most of these 78 tabs are not built yet. This registry is the addressing
 * contract the later per-surface slices land against; do not read it as a claim of shipped UI.
 */
export const OPERATOR_BRANCHES: Branch[] = [
  {
    slug: "fleet", key: "fleet", label: "Fleet Console", group: "fleet", glyph: "◎",
    subtabs: [
      { slug: "systems-check", key: "main", label: "Systems Check" },
      { slug: "tenants", key: "console", label: "Tenants" },
      { slug: "history", key: "hist", label: "History" },
      { slug: "alert-rules", key: "rules", label: "Alert rules" },
      { slug: "team-pulse", key: "pulse", label: "Team Pulse" },
      { slug: "prospects", key: "pipe", label: "Prospect Pipeline" },
    ],
  },
  {
    slug: "paige", key: "workspace", label: "Paige", group: "fleet", glyph: "✦",
    subtabs: [
      { slug: "chat", key: "main", label: "Chat" },
      { slug: "knowledge", key: "know", label: "Knowledge" },
      { slug: "sandbox", key: "sandbox", label: "Sandbox" },
      { slug: "research", key: "research", label: "Research" },
      { slug: "memory", key: "memory", label: "Memory" },
      { slug: "documents", key: "docs", label: "Documents" },
      { slug: "playbooks", key: "plays", label: "Playbooks" },
      { slug: "sub-agents", key: "agents", label: "Sub-agents" },
      { slug: "actions", key: "actions", label: "Actions" },
      { slug: "skills", key: "skills", label: "Skills" },
      { slug: "team", key: "wteam", label: "Team" },
    ],
  },
  {
    slug: "trust-compass", key: "compass", label: "Trust Compass", group: "fleet", glyph: "◈",
    subtabs: [
      { slug: "autonomy", key: "main", label: "Autonomy" },
      { slug: "escalations", key: "esc", label: "Escalations" },
      { slug: "dependencies", key: "deps", label: "Dependencies" },
    ],
  },
  {
    slug: "calendar", key: "calendar", label: "Calendar", group: "fleet", glyph: "▦",
    subtabs: [
      { slug: "month", key: "main", label: "Month" },
      { slug: "booking-links", key: "links", label: "Booking links" },
      { slug: "settings", key: "avail", label: "Settings" },
      { slug: "tasks", key: "tasks", label: "Tasks" },
    ],
  },
  {
    slug: "marketplace", key: "market", label: "Marketplace", group: "fleet", glyph: "⌗",
    subtabs: [
      { slug: "discover", key: "main", label: "Discover" },
      { slug: "build", key: "build", label: "Build" },
      { slug: "submissions", key: "subs", label: "Submissions" },
      { slug: "publishers", key: "pubs", label: "Publishers" },
    ],
  },
  {
    slug: "growth", key: "growth", label: "Marketing", group: "fleet", glyph: "◈",
    subtabs: [
      { slug: "brand-kit", key: "main", label: "Brand Kit" },
      { slug: "social", key: "social", label: "Social" },
      { slug: "pages", key: "pages", label: "Pages" },
      { slug: "funnels", key: "funnels", label: "Funnels" },
      { slug: "forms", key: "forms", label: "Forms" },
      { slug: "assets", key: "assets", label: "Assets" },
      { slug: "builders", key: "builders", label: "Builders" },
    ],
  },
  {
    slug: "automations", key: "autos", label: "Automations", group: "fleet", glyph: "⊞",
    subtabs: [
      { slug: "library", key: "main", label: "Library" },
      { slug: "runs", key: "runs", label: "Runs" },
      { slug: "build", key: "build", label: "Build" },
    ],
  },
  {
    slug: "analytics", key: "analytics", label: "Analytics", group: "fleet", glyph: "▤",
    subtabs: [
      { slug: "brief", key: "main", label: "Brief" },
      { slug: "revenue", key: "rev", label: "Revenue" },
      { slug: "support", key: "sup", label: "Support" },
      { slug: "retention", key: "ret", label: "Retention" },
      { slug: "product", key: "product", label: "Product" },
      { slug: "autonomy", key: "auto", label: "Autonomy" },
      { slug: "marketing", key: "mkt", label: "Marketing" },
      { slug: "comms", key: "comms", label: "Comms" },
      { slug: "forecast", key: "fc", label: "Forecast" },
      { slug: "performance", key: "perf", label: "Performance" },
    ],
  },
  {
    slug: "revenue", key: "revenue", label: "Revenue", group: "fleet", glyph: "◈",
    subtabs: [
      { slug: "plans", key: "main", label: "Plans" },
      { slug: "metering", key: "meters", label: "Metering" },
      { slug: "invoices", key: "inv", label: "Invoices" },
      { slug: "at-risk", key: "risk", label: "At risk" },
    ],
  },
  {
    slug: "support", key: "support", label: "Platform Support", group: "business", glyph: "◫",
    subtabs: [
      { slug: "inbox", key: "main", label: "Inbox" },
      { slug: "escalations", key: "esc", label: "Escalations" },
      { slug: "response-policy", key: "policy", label: "Response policy" },
    ],
  },
  {
    slug: "comms", key: "comms", label: "Comms", group: "business", glyph: "✉",
    subtabs: [
      { slug: "outbound", key: "main", label: "Outbound" },
      { slug: "templates", key: "tpl", label: "Templates" },
      { slug: "sent-log", key: "log", label: "Sent log" },
    ],
  },
  {
    slug: "provisioning", key: "provisioning", label: "Provisioning", group: "business", glyph: "⟳",
    subtabs: [
      { slug: "pipeline", key: "main", label: "Pipeline" },
      { slug: "history", key: "hist", label: "History" },
    ],
  },
  {
    slug: "settings", key: "settings", label: "Settings", group: "settings",
    subtabs: [
      {
        slug: "setup", glyph: "◈", key: "config", label: "Setup",
        subtabs: [
          { slug: "operator", key: "main", label: "Operator" },
          { slug: "brand-kit", key: "brand", label: "Brand kit" },
          { slug: "model-router", key: "router", label: "Model router" },
          { slug: "capabilities", key: "caps", label: "Capabilities" },
          { slug: "feature-flags", key: "flags", label: "Feature flags" },
          { slug: "api-mcp", key: "api", label: "API & MCP" },
        ],
      },
      {
        slug: "integrations", glyph: "⚯", key: "integrations", label: "Integrations",
        subtabs: [
          { slug: "connected", key: "main", label: "Connected" },
          { slug: "health", key: "health", label: "Health" },
          { slug: "available", key: "avail", label: "Available" },
        ],
      },
      {
        slug: "team", glyph: "◍", key: "team", label: "Platform Team",
        subtabs: [
          { slug: "seats", key: "main", label: "Seats" },
          { slug: "roles", key: "roles", label: "Roles" },
        ],
      },
      {
        slug: "vault", glyph: "▣", key: "vault", label: "Platform Vault",
        subtabs: [
          { slug: "obligations", key: "main", label: "Obligations" },
          { slug: "vendors", key: "vendors", label: "Vendors" },
          { slug: "documents", key: "docs", label: "Documents" },
        ],
      },
      {
        slug: "governance", glyph: "⛉", key: "governance", label: "Governance",
        subtabs: [
          { slug: "approvals", key: "main", label: "Approvals" },
          { slug: "audit-log", key: "audit", label: "Audit log" },
          { slug: "act-as-history", key: "actas", label: "Act-as history" },
          { slug: "security", key: "security", label: "Security" },
        ],
      },
    ],
  },
];

/**
 * ENTERPRISE_EXTRA — Enterprise-only customization branches on top of the Agency baseline
 * (§3/§61). None defined yet (Enterprise = Agency baseline until a negotiated customization is
 * authored); the array exists so the extension point is explicit, not a fork.
 */
export const ENTERPRISE_EXTRA: Branch[] = [];

/** The tier → tree map. The one home (§18) every router + rail + agent reads. */
export const TIER_TREES: Record<RouteTierKey, TierTree> = {
  // §65 matrix row 1 — the operator is tenant-less, so no account segment.
  operator: { root: "/operator", branches: OPERATOR_BRANCHES, accountSegment: false },
  agency: { root: "/agency", branches: AGENCY_BRANCHES },
  // §3/§61 — same agency shell + Enterprise customizations, distinct root/label.
  enterprise: { root: "/enterprise", branches: [...AGENCY_BRANCHES, ...ENTERPRISE_EXTRA] },
  solo: { root: "/solo", branches: SOLO_BRANCHES },
  // §65 R3c-i CORRECTION (2026-08-18, §13 honest): this used to point at
  // SOLO_BRANCHES per the §11c/§60 doctrine ("sub-account inherits the Solo
  // tree"), but sub_account renders LIVE via `AgencyApp mode="subaccount"`
  // (Admin.tsx Gate B) — which shares AGENCY_BRANCHES' key set (screens:
  // command/paige/compass/autos/fleet/calendar/support/growth/analytics/
  // billing/market/vault/integrations/team/setup), NOT SoloApp.tsx's screens
  // map (home/clients/auto/cal, no support/billing) that SOLO_BRANCHES was
  // authored against. Pointing this at SOLO_BRANCHES would have produced dead
  // routes/404s the moment branch-level URLs shipped — no prior regression,
  // since sub_account never had branch-level URLs before this slice. The
  // §11c/§60 doctrine (Solo ≡ Sub-account, one shared shell) is the TARGET
  // once /business mounts SoloApp instead (owner-sequenced as a later slice,
  // after Solo's own URL conversion) — until then this points at what the
  // shell actually renders.
  //
  // ⚠ WHEN THAT SLICE FIRES, READ THIS FIRST (§39 peer-gate, PR #533). All 11
  // Solo screens hardcode `useSubtabRoute("solo", …)` — safe today because
  // SoloApp only ever mounts at /solo/*, but the moment /business mounts it,
  // every sub-tab click by a sub-account owner builds a /solo/{n}/… path and
  // silently throws them out of the /business tree — 55 routes at once. The
  // agency screens already model the fix: `useSubtabRoute(isAgency ? "agency"
  // : "sub_account", …)`. Thread the tier through SoloApp the same way BEFORE
  // mounting it at /business; it was left hardcoded here only because there is
  // no second mount to parameterize against yet.
  sub_account: { root: "/business", branches: SUB_ACCOUNT_BRANCHES },
};

/** The tree for a tier. */
export function treeForTier(tier: RouteTierKey): TierTree {
  return TIER_TREES[tier];
}

/** The default (first) branch slug for a tier — where `${root}/{account}` (no branch) lands. */
export function defaultBranchSlug(tier: RouteTierKey): string {
  return TIER_TREES[tier].branches[0]?.slug ?? "command-center";
}

/** Resolve a URL slug → its branch for a tier (null if the slug isn't a branch of that tier). */
export function branchBySlug(tier: RouteTierKey, slug: string): Branch | null {
  return TIER_TREES[tier].branches.find((b) => b.slug === slug) ?? null;
}

/** Resolve an internal screen key → its branch for a tier (for state→URL migration call sites). */
export function branchByKey(tier: RouteTierKey, key: string): Branch | null {
  return TIER_TREES[tier].branches.find((b) => b.key === key) ?? null;
}

/** Build the canonical path for a branch: `${root}/{account}/{slug}`. */
export function branchPath(tier: RouteTierKey, account: string, slug: string): string {
  const tree = TIER_TREES[tier];
  // Account-less tiers (operator) ignore `account` entirely — callers may pass "".
  if (tree.accountSegment === false) return `${tree.root}/${slug}`;
  return `${tree.root}/${account}/${slug}`;
}

/** The default (first) sub-tab slug for a branch, or null if the branch has no sub-tabs. */
export function defaultSubtabSlug(tier: RouteTierKey, branchSlug: string): string | null {
  return branchBySlug(tier, branchSlug)?.subtabs?.[0]?.slug ?? null;
}

/** Resolve a sub-tab URL slug → its SubTab within a branch (null if not a sub-tab). */
export function subtabBySlug(tier: RouteTierKey, branchSlug: string, subSlug: string): SubTab | null {
  return branchBySlug(tier, branchSlug)?.subtabs?.find((s) => s.slug === subSlug || s.aliases?.includes(subSlug)) ?? null;
}

/** Resolve a screen's internal sub-tab key → its SubTab (for state→URL migration sites). */
export function subtabByKey(tier: RouteTierKey, branchSlug: string, key: string): SubTab | null {
  return branchBySlug(tier, branchSlug)?.subtabs?.find((s) => s.key === key) ?? null;
}

/** Build the canonical 3-level path: `${root}/{account}/{branchSlug}/{subSlug}`. */
/**
 * Resolve a THIRD-level slug (operator settings only): `/operator/settings/{group}/{tab}`.
 * Returns null for tiers/branches with no third level, which is every tenant tier.
 */
export function leafBySlug(
  tier: RouteTierKey, branchSlug: string, subSlug: string, leafSlug: string,
): SubTab | null {
  return subtabBySlug(tier, branchSlug, subSlug)?.subtabs?.find((l) => l.slug === leafSlug) ?? null;
}

/** The default (first) third-level slug under a sub-tab, or null if it has no third level. */
export function defaultLeafSlug(tier: RouteTierKey, branchSlug: string, subSlug: string): string | null {
  return subtabBySlug(tier, branchSlug, subSlug)?.subtabs?.[0]?.slug ?? null;
}

/** Build a third-level path. Account-less tiers (operator) omit the account segment. */
export function leafPath(
  tier: RouteTierKey, account: string, branchSlug: string, subSlug: string, leafSlug: string,
): string {
  const tree = TIER_TREES[tier];
  const base = tree.accountSegment === false ? tree.root : `${tree.root}/${account}`;
  return `${base}/${branchSlug}/${subSlug}/${leafSlug}`;
}

export function subtabPath(tier: RouteTierKey, account: string, branchSlug: string, subSlug: string): string {
  const tree = TIER_TREES[tier];
  if (tree.accountSegment === false) return `${tree.root}/${branchSlug}/${subSlug}`;
  return `${tree.root}/${account}/${branchSlug}/${subSlug}`;
}
