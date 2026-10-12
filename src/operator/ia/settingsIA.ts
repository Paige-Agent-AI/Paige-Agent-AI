/** Owner ruling 2026-10-10: a Settings sub-main menu, with existing views retained as tabs. */
export const SETTINGS_MENU = [
  { label: "Setup", slug: "setup", icon: "setup", views: ["Setup", "Platform", "Automations"] },
  { label: "Team", slug: "team", icon: "team", views: ["Team"] },
  { label: "Connections", slug: "connections", icon: "connections", views: ["Connections", "Numbers"] },
  { label: "Integrations", slug: "integrations", icon: "integrations", views: ["Integrations"] },
  { label: "Analytics", slug: "analytics", icon: "analytics", views: ["Analytics", "Alerts"] },
  { label: "Security & data", slug: "security-data", icon: "security", views: ["Governance", "Capabilities"] },
  { label: "Vault", slug: "vault", icon: "vault", views: ["Vault"] },
  { label: "Billing", slug: "billing", icon: "billing", views: ["Billing"] },
  { label: "PAIGE Intelligence", slug: "paige-intelligence", icon: "intelligence", views: ["PAIGE Intelligence"] },
] as const;
export const settingsGroupForView = (view: string | null) => SETTINGS_MENU.find((group) => group.views.some((v) => v === view));
