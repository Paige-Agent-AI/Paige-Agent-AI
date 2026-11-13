# EXP10 — Integrations consistent redesign: BUILD SPEC (owner-approved direction, 2026-11-04)

**Owner approval (chat, 2026-11-04):** "I like the direction you are going" + binding condition:
**"I do not want to lose the logos, colors, and quality of the designs that we have — or we can
improve them."** Mockup presented and approved:
`~/.zcode/v2/visualizations/bee68b17046fb6b8aad3e2eb09cebba255d93771ad71ab2a413442aee86382e7/integrations-consistent-design.html`

## The approved design (five rules)

1. **Four action tabs** replace the business-category chips and every group section:
   `Live now` · `Sign in` · `Token & API keys` · `Coming later`. Default tab: `Sign in`.
2. **The standalone MCP section is REMOVED from the page.** No "MCP Connections"/Automation wall.
   MCP appears ONLY inside a provider's panel as its `Paige tools (MCP)` facet tab, when that
   provider has one. (Owner: "get rid of this entire section that says MCP Connections and then
   only show MCP connection on each respective connection if we have it available.")
3. **Uniform cards**: logo, name, one status line, one type chip (`Sign in` / `Token` / `API key`
   / `MCP`). A provider with two ways to connect renders TWO single-purpose cards (n8n: "API key"
   card on Token tab + "Paige tools" card on Sign-in tab — both open the SAME n8n drawer, first
   tab preselected by the card's facet). NEVER a dual-state card.
4. **Uniform panels**: every provider panel keeps the incumbent drawer chrome; providers with >1
   type get the SAME facet-tab row in the SAME order (`API key`, `Paige tools (MCP)`); single-type
   providers show that one form in the provider's own words (HighLevel = "Private Integration
   Token" + locationId). **Panels always open to the FIRST tab** — never to the saved account's
   state (owner: "each one should open to each option tab not to what's currently selected in my
   saved account… for EVERY solo account"). Same footer line everywhere: "What Paige may run is
   approved separately — per action."
5. **"Add another tool"** = ONE quiet button in the page header (not a section) opening the
   existing MCP catalogue drawer (the 70-server browser + Any-MCP-server entry + ConnectionForm).

### Preservation rule (binding, owner 2026-11-04)
Real provider logos via the existing `IntegrationLogo` components and each provider's real brand
colors/letter-marks (Slack aubergine #4A154B, Teams #5059C9, etc. — the PR9 system), the
incumbent Mineral/Obsidian `--pg-*` tokens and violet focus, and current typographic quality all
carry INTO the new layout. The mockup's generic two-letter marks were placeholders only.
Improvements welcome; regressions forbidden. Impeccable: refinement mode, incumbent world kept.

## Concrete build (PR-B, branches off main AFTER PR-A #3272 merges)

**File 1: `src/solo/settings-integrations.tsx`** (bulk of the work)
- Replace `CatalogueCategory` chips + `GROUPS`/`GROUP_OF`/`groupsShown` machinery with
  `TypeTab = "live" | "signin" | "token" | "later"` + `TYPE_TABS` (labels/blurbs per mockup).
- Tile model: one card per (provider × connection-type); type chip on every card.
  - Sign in tab: 10 social platforms (existing SocialDrawer) + Stripe.
  - Token tab: HighLevel (NEW first-class card — see File 2), Slack (existing SlackDrawer), n8n
    API-key card, Zapier API-key card, + the "Add another tool" entry.
  - Live now: derived list — social connections, Stripe ready, n8n API ok, Zapier API ok, and
    every MCP row rendered as that provider's card with its real state (usable rows only), each
    opening its panel. Honest empty state.
  - Coming later: the seven not-connectable rows with their honest notes as chips.
- n8n/Zapier facet cards open the EXISTING drawers (N8nDrawer `initialMcp` for the tools card;
  ZapierDrawer for both). HighLevel opens a `PresetConnectionDrawer` (SlackDrawer generalized:
  same chrome, `preset={GHL_MCP_PRESET}`).
- Delete the `IntegrationsGatewaySection` wall invocation; the OAuth-return effects and
  `openLegacy` routing stay (re-targeted: social → Sign-in tab; mcp return → keep drawer, set
  tab to the tool's home).
- Panel-first-tab rule: N8nDrawer default `initialMcp=false` unless the Sign-in-facet card
  explicitly passes it (card context decides, never connection state).

**File 2: `src/solo/settings-integrations-gateway.tsx`** (small)
- Export `GHL_MCP_PRESET` (label "HighLevel · LeadConnector", url
  `https://services.leadconnectorhq.com/mcp/`, providerKey `gohighlevel`, auth `"headers"`,
  requiredHeaders `["locationId"]`).
- `IntegrationsGatewaySection` gains `compact?: boolean` (or split a small `McpAddButton`
  export): renders the catalogue/add drawers + ONE quiet "Add another tool" trigger instead of
  the wall grid. The wall grid itself is no longer rendered anywhere.
- Generalize `SlackDrawer` → `PresetConnectionDrawer({ preset, title, tagline, mark })` with
  Slack as instance one and HighLevel instance two (same focus/dirty/Escape chrome).

**CSS** (`settings-integrations.css`): tab bar in the incumbent `ig-bar` idiom; chips reuse
`ig-chip`; type-tab styling follows the mockup's proportions but in `--pg-*` tokens.

**Tests**: `settings-integrations.test.tsx` — rewrite category/group assertions to the four
tabs; pin: uniform card anatomy (one state line + one chip), n8n two facet cards open the same
drawer on the right first tab, HighLevel card → PresetConnectionDrawer with locked PIT contract,
Live-now derivation truth (only real connections listed; honest empty state), Coming-later
notes. Gateway tests unchanged (already green from PR-A + fixes).

**Evidence**: new `docs/evidence/ui-delivery/exp10-integrations-consistent-tabs.md` following
the PR-A record's shape; rendered capture still OWED/named unless a local browser pass is added.

## Sequencing state at time of writing (2026-11-04)
- PR-A #3272 (duplicate-guard + HighLevel lock both doors + honest chips + plain eyebrow) is
  PUSHED with CI auto-triggered; independent review returned FIX-FIRST and ALL findings (P1
  chip scoping, P2 approvals-banner + locationId on finish/rekey doors, P3 wording/helper/
  name-note) are APPLIED IN THE WORKTREE, UNCOMMITTED — the host shell (Git Bash) failed
  platform-side ("Top-level not found: C:\Program Files\Git\bin" on every command) before the
  commit could run. On shell recovery: commit the two gateway files → push → confirm CI →
  squash-merge exact head → confirm Vercel main deploy → owner connects HighLevel/Slack.
- THEN branch PR-B off fresh main and execute this spec.
