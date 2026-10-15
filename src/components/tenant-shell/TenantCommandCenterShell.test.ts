import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TENANT_SHELL_DESTINATIONS,
  resolveTenantAccountContext,
  resolveTenantShellDestination,
  tenantAccountTypeLabel,
  tenantShellDestinationsForPath,
} from "./tenantShellRoutes";

describe("tenant Command Center shell routing", () => {
  it("removes PAIGE materialization transforms when reduced motion is active", () => {
    const css = readFileSync(resolve("src/components/tenant-shell/tenant-command-center-shell.css"), "utf8");

    expect(css).toMatch(/\[data-tenant-shell\]\[data-reduced-motion="true"\] \.tcs-paige\s*\{[^}]*animation:\s*none/);
  });

  it("exposes the ruled five tenant destinations and keeps Calendar under Clients or Relationships", () => {
    expect(TENANT_SHELL_DESTINATIONS.map(({ label }) => label)).toEqual([
      "Command Center",
      "Clients",
      "Studio",
      "Insights",
      "Settings",
    ]);
    expect(TENANT_SHELL_DESTINATIONS.map(({ id }) => id)).not.toContain("calendar");
    expect(TENANT_SHELL_DESTINATIONS.some(({ label }) => label === "Fleet")).toBe(false);
  });

  it("puts Operations below Command Center and preserves Finance below Sales", () => {
    const destinations = tenantShellDestinationsForPath("/solo/42/command-center", "standalone");

    expect(destinations.map(({ label }) => label)).toEqual([
      "Command Center",
      "Operations",
      "Clients",
      "Marketing",
      "Ads",
      "Sales",
      "Finance",
      "Marketplace",
      "Settings",
    ]);
    expect(destinations.map(({ id, href }) => [id, href])).toEqual([
      ["command", "/solo/42/command-center"],
      ["operations", "/solo/42/operations"],
      ["clients", "/solo/42/clients"],
      ["campaigns", "/solo/42/growth"],
      ["ads", "/solo/42/ads"],
      ["sales", "/solo/42/sales"],
      ["finance", "/solo/42/finance"],
      ["marketplace", "/solo/42/marketplace"],
      ["settings", "/solo/42/settings"],
    ]);
    expect(destinations.some(({ label }) => label === "Studio")).toBe(false);
    expect(destinations.some(({ label }) => label === "Calendar")).toBe(false);
  });

  it("does not grant the Solo menu from a URL without authenticated Solo context", () => {
    expect(tenantShellDestinationsForPath("/solo/42/command-center").map(({ label }) => label)).toEqual([
      "Command Center",
      "Clients",
      "Studio",
      "Insights",
      "Settings",
    ]);
  });

  it.each([
    ["/agency/1924546/clients", "agency", "Relationships"],
    ["/agency/7000001/clients", "enterprise", "Relationships"],
    ["/solo/42/clients", "standalone", "Clients"],
    ["/business/9082725/clients", "sub_account", "Clients"],
    ["/agency/1924546/sub/9082725/clients", "sub_account", "Clients"],
  ])("presents the approved relationship home at %s", (pathname, accountType, expected) => {
    const destinations = tenantShellDestinationsForPath(pathname, accountType);
    expect(destinations.find(({ id }) => id === "clients")?.label).toBe(expected);
  });

  it.each([
    ["standalone", "Solo"],
    ["sub_account", "Sub-account"],
    ["agency", "Agency Parent"],
    ["enterprise", "Enterprise"],
  ])("renders the internal %s account type as %s", (accountType, label) => {
    expect(tenantAccountTypeLabel(accountType)).toBe(label);
  });

  it("preserves a supplied authenticated account name instead of asserting a generic business", () => {
    expect(resolveTenantAccountContext({
      accountName: "First Sterling Capital",
      accountType: "standalone",
    })).toEqual({
      accountName: "First Sterling Capital",
      accountType: "standalone",
      accountTypeLabel: "Solo",
    });
  });

  it.each([
    ["standalone", "Solo"],
    ["sub_account", "Sub-account"],
    ["agency", "Agency Parent"],
    ["enterprise", "Enterprise"],
  ])("resolves the shared %s account context as %s", (accountType, accountTypeLabel) => {
    expect(resolveTenantAccountContext({ accountName: "Supplied account", accountType })).toEqual({
      accountName: "Supplied account",
      accountType,
      accountTypeLabel,
    });
  });

  it.each([undefined, null, "", "   "])(
    "uses an honest neutral fallback for missing optional account name %s",
    (accountName) => {
      expect(resolveTenantAccountContext({ accountName, accountType: null })).toEqual({
        accountName: "Your workspace",
        accountType: null,
        accountTypeLabel: "Account",
      });
    },
  );

  it("classifies a parented legacy standalone tenant as Sub-account", () => {
    expect(resolveTenantAccountContext({
      accountName: "Supplied child account",
      accountType: "standalone",
      parentTenantId: "authenticated-parent-id",
    })).toEqual({
      accountName: "Supplied child account",
      accountType: "sub_account",
      accountTypeLabel: "Sub-account",
    });
  });

  it("does not relabel a top-level standalone tenant from route mode alone", () => {
    expect(resolveTenantAccountContext({
      accountName: "Supplied solo account",
      accountType: "standalone",
      parentTenantId: null,
    }).accountTypeLabel).toBe("Solo");
  });

  it("keeps a missing Business-route tenant neutral instead of inferring identity from the URL", () => {
    expect(resolveTenantAccountContext(null)).toEqual({
      accountName: "Your workspace",
      accountType: null,
      accountTypeLabel: "Account",
    });
  });

  it("keeps Delivery and canonical Calendar addresses under Clients ownership", () => {
    expect(resolveTenantShellDestination("/solo/123/clients/delivery").id).toBe("clients");
    expect(resolveTenantShellDestination("/solo/123/calendar").id).toBe("clients");
    expect(resolveTenantShellDestination("/solo/123/client-support").id).toBe("clients");
    expect(resolveTenantShellDestination("/solo/123/calendar").id).toBe("clients");
    expect(resolveTenantShellDestination("/solo/123/client-support").id).toBe("clients");
  });

  it("keeps the client relationship surfaces under Clients", () => {
    expect(resolveTenantShellDestination("/solo/123/clients/conversations").id).toBe("clients");
    expect(resolveTenantShellDestination("/solo/123/clients/pipeline").id).toBe("clients");
    expect(resolveTenantShellDestination("/solo/123/clients/example").id).toBe("clients");
  });

  it("maps the remaining canonical live routes without inventing pages", () => {
    expect(resolveTenantShellDestination("/solo/123/command-center").id).toBe("command");
    expect(resolveTenantShellDestination("/agency/123/growth/new").id).toBe("studio");
    expect(resolveTenantShellDestination("/solo/123/analytics").id).toBe("insights");
    expect(resolveTenantShellDestination("/solo/123/settings/integrations").id).toBe("settings");
  });

  it.each([
    ["/business/9082725/command-center", "/business/9082725"],
    ["/agency/1924546/command-center", "/agency/1924546"],
    ["/agency/1924546/sub/9082725/command-center", "/agency/1924546/sub/9082725"],
    ["/enterprise/7/command-center", "/enterprise/7"],
  ])("keeps all five visible destinations inside the current account tree: %s", (pathname, routePrefix) => {
    const destinations = tenantShellDestinationsForPath(pathname);
    expect(destinations).toHaveLength(5);
    expect(destinations.map(({ id, href }) => [id, href])).toEqual([
      ["command", `${routePrefix}/command-center`],
      ["clients", `${routePrefix}/clients`],
      ["studio", `${routePrefix}/growth`],
      ["insights", `${routePrefix}/analytics`],
      ["settings", pathname.startsWith("/solo/") ? `${routePrefix}/settings` : `${routePrefix}/setup`],
    ]);
    expect(destinations.every(({ label }) => label !== "Fleet")).toBe(true);
  });

  it("keeps existing Solo capability addresses while presenting the approved labels", () => {
    expect(resolveTenantShellDestination("/solo/42/growth", "standalone")).toMatchObject({
      id: "campaigns",
      label: "Marketing",
      href: "/solo/42/growth",
    });
    // Ads is its own department below Marketing (owner ruling 2026-10-10): its address lights Ads,
    // never Marketing, and Marketing's own addresses never light Ads.
    expect(resolveTenantShellDestination("/solo/42/ads/creative", "standalone")).toMatchObject({
      id: "ads",
      label: "Ads",
      href: "/solo/42/ads",
    });
    expect(resolveTenantShellDestination("/solo/42/growth/analytics", "standalone").id).toBe("campaigns");
    // Ads is a Solo department only: the five-home tenant menu (sub-account, agency) gains nothing.
    expect(tenantShellDestinationsForPath("/business/42/command-center", "sub_account").some(({ id }) => id === "ads")).toBe(false);
    expect(tenantShellDestinationsForPath("/solo/42/command-center").some(({ id }) => id === "ads")).toBe(false);
    expect(resolveTenantShellDestination("/solo/42/marketplace", "standalone")).toMatchObject({
      id: "marketplace",
      label: "Marketplace",
      href: "/solo/42/marketplace",
    });
    expect(resolveTenantShellDestination("/solo/42/settings/analytics/overview", "standalone")).toMatchObject({
      id: "settings",
      label: "Settings",
      href: "/solo/42/settings",
    });
  });

  it.each([
    ["agency", "command", "command-center"],
    ["agency", "clients", "clients"],
    ["agency", "studio", "growth"],
    ["agency", "insights", "analytics"],
    ["agency", "settings", "setup"],
  ])("keeps %s acting-child %s navigation active inside the actor-namespaced tree", (root, destination, slug) => {
    expect(resolveTenantShellDestination(`/${root}/1924546/sub/9082725/${slug}`).id).toBe(destination);
  });

  it.each([
    ["/solo/42/calendar/agenda", "standalone", "Clients"],
    ["/business/9082725/calendar/availability", "sub_account", "Clients"],
    ["/agency/1924546/calendar/tasks", "agency", "Relationships"],
    ["/agency/1924546/sub/9082725/calendar/connections", "sub_account", "Clients"],
    ["/enterprise/7/calendar/booking-pages", "enterprise", "Relationships"],
  ])("keeps direct Calendar address %s visible through its relationship owner", (pathname, accountType, label) => {
    const destination = resolveTenantShellDestination(pathname, accountType);
    expect(destination.id).toBe("clients");
    expect(destination.label).toBe(label);
  });

  it("folds legacy tenant branches into one of the five visible capability homes", () => {
    expect(resolveTenantShellDestination("/business/9082725/paige").id).toBe("command");
    expect(resolveTenantShellDestination("/business/9082725/client-support").id).toBe("clients");
    expect(resolveTenantShellDestination("/business/9082725/business-vault").id).toBe("settings");
  });

  it("uses the canonical Solo Settings address without changing another tenant tier", () => {
    expect(
      tenantShellDestinationsForPath("/solo/42/settings", "standalone")
        .find(({ id }) => id === "settings")?.href,
    ).toBe("/solo/42/settings");
    expect(
      tenantShellDestinationsForPath("/business/9082725/setup", "sub_account")
        .find(({ id }) => id === "settings")?.href,
    ).toBe("/business/9082725/setup");
  });

  it.each([
    "/solo/42/settings/setup",
    "/solo/42/settings/team",
    "/solo/42/settings/connections",
    "/solo/42/setup",
    "/solo/42/team",
    "/solo/42/integrations",
    "/solo/42/business-vault",
  ])("keeps %s inside the single Solo Settings owner", (pathname) => {
    expect(resolveTenantShellDestination(pathname, "standalone").id).toBe("settings");
  });
});
