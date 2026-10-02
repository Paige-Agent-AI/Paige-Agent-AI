import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TenantCommandCenterCore } from "./TenantCommandCenterCore";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("tenant Command Center core workspace", () => {
  it("renders only connected values or explicit unavailability and preserves the account tree", () => {
    const openPaige = vi.fn();
    const host = document.createElement("div");
    const root = createRoot(host);

    act(() => root.render(
      <MemoryRouter initialEntries={["/solo/1971670/command-center"]}>
        <TenantCommandCenterCore
          accountContext={{ accountName: "First Sterling Capital", accountType: "standalone" }}
          openPaige={openPaige}
          data={{
            greeting: { name: "Antonio", dateLabel: "Tuesday, August 25", summary: "You're all caught up." },
            metrics: [
              { label: "Active contacts", value: "1", state: "LIVE" },
              { label: "Net revenue retention", state: "UNAVAILABLE", note: "No connected read yet" },
            ],
            approvals: [],
            attention: { at_risk_clients: 1, tasks_due: 2 },
            attentionState: "LIVE",
            departments: [{ slug: "ops", name: "Operations", displayOrder: 1, openCount: 3, workingCount: 1, awaitingCount: 1, lastActivityAt: null }],
            departmentState: "LIVE",
            loading: false,
            approve: vi.fn(),
            decline: vi.fn(),
            refresh: vi.fn(),
          }}
        />
      </MemoryRouter>,
    ));

    expect(host.textContent).toContain("Active contacts");
    expect(host.querySelector("[data-tenant-account-name]")?.textContent).toBe("First Sterling Capital");
    expect(host.querySelector("[data-tenant-account-tier]")?.textContent).toBe("Solo");
    expect(host.textContent).not.toContain("Your business");
    expect(host.textContent).toContain("Connected read");
    expect(host.textContent).toContain("Net revenue retention");
    expect(host.textContent).toContain("No connected read yet");
    expect(host.textContent).toContain("Trust Compass authority history");
    expect(host.textContent).toContain("UNAVAILABLE");
    expect(host.textContent).toContain("Attention · LIVE");
    expect(host.textContent).not.toMatch(/Bellweather|Ridgeline|Hartwell|Ledgerly/);
    expect(Array.from(host.querySelectorAll("a")).map((link) => link.getAttribute("href"))).toEqual(
      expect.arrayContaining(["/solo/1971670/clients", "/solo/1971670/calendar", "/solo/1971670/settings"]),
    );

    const command = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Put PAIGE to work"),
    );
    act(() => command?.click());
    expect(openPaige).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it.each([
    ["/solo/42/command-center", "/solo/42/calendar"],
    ["/business/9082725/command-center", "/business/9082725/calendar"],
    ["/agency/1924546/command-center", "/agency/1924546/calendar"],
    [
      "/agency/1924546/sub/9082725/command-center",
      "/agency/1924546/sub/9082725/calendar",
    ],
    ["/enterprise/7/command-center", "/enterprise/7/calendar"],
  ])("keeps Calendar attention links inside the active account tree at %s", (pathname, expectedHref) => {
    const host = document.createElement("div");
    const root = createRoot(host);

    act(() => root.render(
      <MemoryRouter initialEntries={[pathname]}>
        <TenantCommandCenterCore
          accountContext={{ accountName: "Supplied account", accountType: "standalone" }}
          openPaige={vi.fn()}
          data={{
            greeting: { name: "Owner", dateLabel: "Today", summary: "Review today's work." },
            metrics: [],
            approvals: [],
            attention: { tasks_due: 2, upcoming_sessions_7d: 1 },
            attentionState: "LIVE",
            departments: [],
            departmentState: "UNAVAILABLE",
            loading: false,
            approve: vi.fn(),
            decline: vi.fn(),
            refresh: vi.fn(),
          }}
        />
      </MemoryRouter>,
    ));

    const attentionHrefs = Array.from(host.querySelectorAll("a"))
      .filter((link) => /Tasks due|Sessions this week/.test(link.textContent ?? ""))
      .map((link) => link.getAttribute("href"));
    expect(attentionHrefs).toEqual([expectedHref, expectedHref]);
    expect(attentionHrefs).not.toContain("/admin/calendar");
    act(() => root.unmount());
  });

  it("keeps secondary ownership out of Command Center and reuses the live Systems Check", () => {
    const agency = source("src/agency/CommandCenter.tsx");
    const solo = source("src/solo/CommandCenter.tsx");

    expect(agency).toContain("<AgencyCommandCenterCore");
    expect(solo).toContain("<SoloSystemsCheckWorkspace");
    expect(agency).not.toContain('["team", "Team Pulse"');
    expect(agency).not.toContain('["pipe", "Prospect Pipeline"');
    expect(agency).toMatch(/<SystemsCheckTile scope="tenant"\s*\/>/);
    expect(solo).not.toContain("SystemsCheckTile");
  });

  it("propagates one authenticated account context from each route owner into the shared core", () => {
    const agencyOwner = source("src/agency/AgencyApp.tsx");
    const agencyAdapter = source("src/agency/CommandCenter.tsx");
    const soloOwner = source("src/solo/SoloApp.tsx");
    const soloAdapter = source("src/solo/CommandCenter.tsx");

    expect(soloOwner).toContain("resolveTenantAccountContext({accountName:activeTenant?.name,accountType:activeTenant?.account_type,parentTenantId:activeTenant?.parent_tenant_id})");
    expect(soloOwner).toContain("<CommandHub account={urlAccount} accountContext={accountContext}");
    expect(soloOwner).toContain("accountName={accountContext.accountName}");
    expect(soloAdapter).toContain("<SoloSystemsCheckWorkspace accountContext={accountContext} openPaige={openPaige}");
    expect(soloOwner).not.toContain("Your business");

    expect(agencyOwner).toContain("const accountContext = resolveTenantAccountContext(");
    expect(agencyOwner).toContain("<CommandCenter accountContext={accountContext}");
    expect(agencyOwner).toContain("accountName={accountContext.accountName}");
    expect(agencyAdapter).toContain("<AgencyCommandCenterCore accountContext={accountContext}");
    expect(agencyOwner).not.toContain("Your business");
  });

  it.each([
    ["standalone", "Solo"],
    ["sub_account", "Sub-account"],
    ["agency", "Agency Parent"],
    ["enterprise", "Enterprise"],
  ])("renders the shared %s account context as %s in the live DOM", (accountType, label) => {
    const host = document.createElement("div");
    const root = createRoot(host);

    act(() => root.render(
      <MemoryRouter initialEntries={["/solo/42/command-center"]}>
        <TenantCommandCenterCore
          accountContext={{ accountName: "Supplied account", accountType }}
          openPaige={vi.fn()}
          data={{
            greeting: { name: "Owner", dateLabel: "Today", summary: "No queued work." },
            metrics: [],
            approvals: [],
            attentionState: "UNAVAILABLE",
            departments: [],
            departmentState: "UNAVAILABLE",
            loading: false,
            approve: vi.fn(),
            decline: vi.fn(),
            refresh: vi.fn(),
          }}
        />
      </MemoryRouter>,
    ));

    expect(host.querySelector("[data-tenant-account-name]")?.textContent).toBe("Supplied account");
    expect(host.querySelector("[data-tenant-account-tier]")?.textContent).toBe(label);
    act(() => root.unmount());
  });

  it("uses independent workspace scroll regions without document-level sizing", () => {
    const css = source("src/components/tenant-shell/tenant-command-center-core.css");
    expect(css).toContain(".tcc-queue-scroll");
    expect(css).toMatch(/\.tcc-queue-scroll[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.tcc-signal[^}]*overflow-y:\s*auto/s);
    expect(css).not.toContain("100vh");
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
