import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_SLOTS } from "@/operator/ia/operatorIA";
import { branchBySlug, subtabPath } from "@/lib/routing/tierBranches";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { TenantSystemsCheckSecondaryView } from "./TenantSystemsCheckSecondaryView";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const useSystemsCheck = vi.fn();
const tenantHarness = vi.hoisted(() => ({
  activeTenantId: "account-a" as string | null,
  activeUserId: "user-a" as string | null,
  // Fields useTierFeatures reads (via useTenantContext) to resolve the tier. Default to a
  // Solo standalone so every existing test keeps the full four-tab Command Center.
  activeTenant: { account_type: "standalone", parent_tenant_id: null } as
    | { account_type: string | null; parent_tenant_id: string | null }
    | null,
  isPlatformStaff: false,
  loading: false,
}));

vi.mock("@/hooks/useSystemsCheck", () => ({
  useSystemsCheck: (...args: unknown[]) => useSystemsCheck(...args),
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => tenantHarness,
}));
vi.mock("@/solo/SoloSystemsCheckWorkspace", () => ({
  SoloSystemsCheckWorkspace: () => <div>Canonical Solo Systems Check</div>,
}));
vi.mock("@/solo/SoloMindWorkspace", () => ({
  SoloMindWorkspace: () => <div>Canonical Solo Mind</div>,
}));
vi.mock("@/solo/SoloGamePlanWorkspace", () => ({
  SoloGamePlanWorkspace: () => <div>Canonical Solo Game Plan</div>,
}));

import { CommandHub } from "@/solo/CommandCenter";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function RouteHarness({ tier }: { tier: "agency" | "sub_account" }) {
  const [tab, setTab] = useSubtabRoute(tier, "command-center", "main");
  const location = useLocation();
  return (
    <div>
      <output data-tab>{tab}</output>
      <output data-path>{location.pathname}</output>
      <button type="button" onClick={() => setTab("history")}>History</button>
    </div>
  );
}

function ActAsSubtabHarness() {
  const [tab, setTab] = useSubtabRoute("agency", "command-center", "main");
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  return (
    <div>
      <output data-tab>{tab}</output>
      <output data-path>{location.pathname}</output>
      <button type="button" onClick={() => setTab("history")}>History</button>
      <button type="button" onClick={() => navigate(`/agency/${params.account}/sub/9001002/command-center`)}>
        Command Center root
      </button>
    </div>
  );
}

const latestRun = {
  id: "run-latest",
  started_at: "2026-08-25T12:00:00.000Z",
  completed_at: "2026-08-25T12:01:00.000Z",
  check_count: 1,
  pass_count: 1,
  fail_count: 0,
};

const latestFinding = {
  id: "finding-latest",
  run_id: "run-latest",
  check_id: "domain_ssl",
  status: "pass",
  severity_at_finding: "high",
  evidence: null,
  paige_interpretation: null,
  paige_drafted_fix: null,
  department_id: null,
  resolved_at: null,
  resolution: null,
  resolution_action_id: null,
  created_at: "2026-08-25T12:00:00.000Z",
  check_name: "Domain and SSL health",
  domain: "infrastructure",
  priority: 1,
};

describe("tenant Command Center secondary tabs", () => {
  beforeEach(() => {
    useSystemsCheck.mockReset();
    useSystemsCheck.mockReturnValue({
      run: latestRun,
      findings: [
        { ...latestFinding, id: "stale", run_id: "run-older", check_name: "Stale prior-run check" },
        latestFinding,
      ],
      loading: false,
      isError: false,
      scanPending: false,
      refresh: vi.fn(),
    });
  });

  it("preserves tenant owners and the owner-approved Fleet menu while Solo leads with Business Game Plan, Systems Check and Mind", () => {
    expect(OPERATOR_SLOTS.find((slot) => slot.id === "fleet")).toMatchObject({
      label: "Fleet",
      views: ["Overview", "Systems check", "Directory", "History", "Mind"],
    });

    for (const tier of ["sub_account", "agency", "enterprise"] as const) {
      const command = branchBySlug(tier, "command-center");
      expect(command?.label).toBe("Command Center");
      expect(command?.subtabs?.filter((tab) => !tab.hidden).map((tab) => tab.label)).toEqual([
        "Systems Check",
        "Directory",
        "History",
      ]);
      expect(command?.subtabs?.[0]).toMatchObject({ label: "Command Center", hidden: true });
    }

    const solo = branchBySlug("solo", "command-center");
    // Trust Compass became Command Center's third sub-tab (owner-ruled 2026-09-05):
    // Business Game Plan → Systems Check → Trust Compass → Mind (Game Plan not built yet).
    expect(solo?.subtabs?.map((tab) => tab.label)).toEqual([
      "Business Game Plan", "Systems Check", "Trust Compass", "Mind",
    ]);
    expect(solo?.subtabs?.[0]).toMatchObject({ slug: "business-game-plan", key: "plan" });
  });

  it.each([
    ["src/solo/CommandCenter.tsx", ["Business Game Plan", "Systems Check", "Trust Compass", "Mind"]],
    ["src/agency/CommandCenter.tsx", ["Systems Check", "Directory", "History"]],
  ])("renders the ruled secondary labels in %s", (path, labels) => {
    const screen = source(path);
    for (const label of labels) expect(screen).toContain(`"${label}"`);
    expect(screen).not.toMatch(/\["(?:home|main)",\s*"Command Center"/);
    expect(screen).not.toContain("Team Pulse");
    expect(screen).not.toContain("Prospect Pipeline");
  });

  it("renders only the latest tenant snapshot in Directory and never mixes earlier findings", () => {
    const html = renderToStaticMarkup(<TenantSystemsCheckSecondaryView view="directory" />);
    expect(html).toContain("Directory");
    expect(html).toContain("Systems Check · PARTIAL");
    expect(html).toContain("Domain and SSL health");
    expect(html).toContain("Passing");
    expect(html).not.toContain("Stale prior-run check");
    expect(html).not.toContain("Fleet");
    expect(useSystemsCheck).toHaveBeenCalledTimes(1);
    expect(useSystemsCheck).toHaveBeenCalledWith("tenant");
  });

  it("renders only the latest persisted run and labels earlier history unavailable", () => {
    const html = renderToStaticMarkup(<TenantSystemsCheckSecondaryView view="history" />);
    expect(html).toContain("History");
    expect(html).toContain("Latest persisted run · PARTIAL");
    expect(html).toContain("Full run history is not connected here yet.");
    expect(html).toContain("Earlier runs remain unavailable here.");
    expect(html).not.toContain("Fleet");
  });

  it.each([
    [{ run: null, findings: [], loading: true, isError: false, scanPending: false }, "Loading the tenant-scoped snapshot", "LOADING"],
    [{ run: null, findings: [], loading: false, isError: true, scanPending: false }, "No account status is being inferred", "UNAVAILABLE"],
    [{ run: null, findings: [], loading: false, isError: false, scanPending: true }, "No persisted snapshot is available yet", "UNAVAILABLE"],
    [{ run: null, findings: [], loading: false, isError: false, scanPending: false }, "No check directory is available yet", "UNAVAILABLE"],
  ])("keeps Directory honest for unresolved and unavailable states", (state, message, proof) => {
    useSystemsCheck.mockReturnValue({ ...state, refresh: vi.fn() });
    const html = renderToStaticMarkup(<TenantSystemsCheckSecondaryView view="directory" />);
    expect(html).toContain(message);
    expect(html).toContain(`Systems Check · ${proof}`);
    expect(html).not.toContain("Passing");
  });

  it("makes the Solo root land on Business Game Plan while Agency keeps its Core owner", () => {
    const solo = source("src/solo/CommandCenter.tsx");
    const agency = source("src/agency/CommandCenter.tsx");
    expect(solo).toContain('useSubtabRoute("solo", "command-center", "plan")');
    expect(solo).not.toContain('tab === "home"');
    expect(solo).not.toContain("SystemsCheckTile");
    expect(solo).toContain("SoloSystemsCheckWorkspace");
    expect(solo).toContain("SoloMindWorkspace");
    expect(solo).not.toContain("TenantSystemsCheckSecondaryView");
    expect(solo).toContain('background: "var(--pg-spine)"');
    expect(solo).not.toContain("<SubTabs");
    expect(agency).toContain('isAgency ? "agency" : "sub_account"');
    expect(agency).toContain('currentTab === "main"');
    expect(agency).toContain('<SystemsCheckTile scope="tenant"');
    expect(source("src/components/tenant-shell/TenantSystemsCheckSecondaryView.tsx")).not.toMatch(/PaigePanel|PaigeWorkspace/);
  });

  it("keeps the Solo strip compact and theme-continuous instead of a white band", () => {
    const solo = source("src/solo/CommandCenter.tsx");
    expect(solo).toContain('aria-label="Command Center sections"');
    expect(solo).toContain('background: "var(--pg-spine)"');
    expect(solo).toContain('borderBottom: "1px solid var(--pg-line)"');
    expect(solo).not.toMatch(/background:\s*["'](?:#fff|white|var\(--surface\))["']/i);
  });

  it("keys the canonical Solo workspace and Mind preference by authenticated user and account", () => {
    const solo = source("src/solo/CommandCenter.tsx");
    expect(solo).toContain('key={activeTenantId ?? "unresolved"}');
    expect(solo).toContain("const { activeTenantId, activeUserId } = useTenantContext()");
    expect(solo).toContain('key={`${activeUserId ?? "resolving"}:${activeTenantId}`}');
    expect(solo).toContain("preferenceScope={activeUserId ? { userId: activeUserId, tenantId: activeTenantId } : null}");
  });

  it.each([
    ["agency", "/agency/8001001/command-center/directory", "/agency/8001001/command-center/history"],
    ["sub_account", "/business/9001002/command-center/directory", "/business/9001002/command-center/history"],
  ] as const)("keeps the %s account tree across secondary routes", (tier, entry, expected) => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path={tier === "agency" ? "/agency/:account/*" : "/business/:account/*"} element={<RouteHarness tier={tier} />} />
        </Routes>
      </MemoryRouter>,
    ));

    expect(host.querySelector("[data-tab]")?.textContent).toBe("directory");
    act(() => host.querySelector("button")?.click());
    expect(host.querySelector("[data-tab]")?.textContent).toBe("history");
    expect(host.querySelector("[data-path]")?.textContent).toBe(expected);
    act(() => root.unmount());
  });

  it("preserves the authenticated Agency Parent acting-as prefix and restores Core at the root", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(
      <MemoryRouter initialEntries={["/agency/8001001/sub/9001002/command-center/directory"]}>
        <Routes>
          <Route path="/agency/:account/*" element={<ActAsSubtabHarness />} />
        </Routes>
      </MemoryRouter>,
    ));

    expect(host.querySelector("[data-tab]")?.textContent).toBe("directory");
    act(() => host.querySelectorAll("button")[0]?.click());
    expect(host.querySelector("[data-tab]")?.textContent).toBe("history");
    expect(host.querySelector("[data-path]")?.textContent).toBe(
      "/agency/8001001/sub/9001002/command-center/history",
    );
    act(() => host.querySelectorAll("button")[1]?.click());
    expect(host.querySelector("[data-tab]")?.textContent).toBe("main");
    act(() => root.unmount());
  });

  it("keeps Solo and Enterprise route construction in their existing account trees", () => {
    expect(subtabPath("solo", "7001001", "command-center", "mind")).toBe(
      "/solo/7001001/command-center/mind",
    );
    expect(subtabPath("enterprise", "6001001", "command-center", "history")).toBe(
      "/enterprise/6001001/command-center/history",
    );
  });

  it.each([
    "/solo/7001001/command-center/directory",
    "/solo/7001001/command-center/history",
  ])("resolves the retired Solo compatibility entry %s to Mind without retaining a tab", (entry) => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/solo/:account/*"
            element={<><CommandHub accountContext={null} openPaige={vi.fn()} /><LocationProbe /></>}
          />
        </Routes>
      </MemoryRouter>,
    ));
    expect(host.textContent).toContain("Canonical Solo Mind");
    expect(host.textContent).not.toContain("Directory");
    expect(host.textContent).not.toContain("History");
    expect(host.textContent).toContain("Previous record address opened in Mind.");
    expect(host.querySelector("[data-location]")?.textContent).toBe(
      "/solo/7001001/command-center/mind",
    );
    act(() => root.unmount());
  });

  it("keeps the active Solo tab perceivable in forced colors and omits stale panel relationships", () => {
    const solo = source("src/solo/CommandCenter.tsx");
    const css = source("src/solo/solo-mind-workspace.css");
    expect(solo).toContain('aria-current={active ? "page" : undefined}');
    expect(solo).toContain('aria-controls={active ? `command-panel-${key}` : undefined}');
    expect(css).toContain('[role="tab"][aria-selected="true"]');
    expect(css).toContain("Highlight");
  });

  it.each([
    "/solo/7001001/command-center",
    "/solo/7001001/command-center/overview",
  ])("resolves the Solo compatibility entry %s to the canonical Business Game Plan landing", (entry) => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/solo/:account/*"
            element={<><CommandHub accountContext={null} openPaige={vi.fn()} /><LocationProbe /></>}
          />
        </Routes>
      </MemoryRouter>,
    ));
    expect(host.textContent).toContain("Canonical Solo Game Plan");
    expect(host.querySelector("[data-location]")?.textContent).toBe(
      "/solo/7001001/command-center/business-game-plan",
    );
    act(() => root.unmount());
  });

  // §60 Solo-only gate for the Trust Compass sub-tab (owner ruling 2026-09-06 — "no subaccount
  // delivery without explicit release"). The Command Center shell stays universal; only this
  // sub-tab is gated OFF sub-accounts until an explicit release.
  it("shows the Trust Compass sub-tab for a Solo workspace", () => {
    tenantHarness.activeTenant = { account_type: "standalone", parent_tenant_id: null };
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(
      <MemoryRouter initialEntries={["/solo/7001001/command-center/business-game-plan"]}>
        <Routes>
          <Route path="/solo/:account/*" element={<CommandHub accountContext={null} openPaige={vi.fn()} />} />
        </Routes>
      </MemoryRouter>,
    ));
    const tabs = [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent ?? "");
    expect(tabs.some((t) => /Trust Compass/.test(t))).toBe(true);
    act(() => root.unmount());
  });

  it("HIDES the Trust Compass sub-tab for a sub-account and redirects its URL to the default landing (§60, owner ruling 2026-09-06)", () => {
    tenantHarness.activeTenant = { account_type: "sub_account", parent_tenant_id: "parent-x" };
    try {
      // 1) The tab is gone from the strip — but the shell and its other sub-tabs remain.
      const host = document.createElement("div");
      const root = createRoot(host);
      act(() => root.render(
        <MemoryRouter initialEntries={["/solo/7001001/command-center/business-game-plan"]}>
          <Routes>
            <Route path="/solo/:account/*" element={<CommandHub accountContext={null} openPaige={vi.fn()} />} />
          </Routes>
        </MemoryRouter>,
      ));
      const tabs = [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent ?? "");
      expect(tabs.some((t) => /Trust Compass/.test(t))).toBe(false);
      expect(tabs.some((t) => /Systems Check/.test(t))).toBe(true); // one sub-tab gated, not the shell
      act(() => root.unmount());

      // 2) A sub-account that lands on the gated compass URL (a legacy redirect or shared link) is
      //    bounced to Business Game Plan and never renders the compass panel.
      const host2 = document.createElement("div");
      const root2 = createRoot(host2);
      act(() => root2.render(
        <MemoryRouter initialEntries={["/solo/7001001/command-center/trust-compass"]}>
          <Routes>
            <Route path="/solo/:account/*" element={<><CommandHub accountContext={null} openPaige={vi.fn()} /><LocationProbe /></>} />
          </Routes>
        </MemoryRouter>,
      ));
      expect(host2.querySelector("[data-location]")?.textContent).toBe("/solo/7001001/command-center/business-game-plan");
      expect(host2.textContent).toContain("Canonical Solo Game Plan");
      act(() => root2.unmount());
    } finally {
      tenantHarness.activeTenant = { account_type: "standalone", parent_tenant_id: null };
    }
  });
});

function LocationProbe() {
  const location = useLocation();
  return <output data-location>{location.pathname}</output>;
}

