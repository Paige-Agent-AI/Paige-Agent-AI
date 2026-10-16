import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tenantId: "tenant-a" as string | null,
  loading: false,
  accountLoading: false,
  mounts: [] as string[],
  unmounts: [] as string[],
}));

vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({
    activeTenantId: harness.tenantId,
    loading: harness.loading,
    accountContextLoading: harness.accountLoading,
  }),
}));

vi.mock("@/pages/admin/CalendarAdmin", () => ({
  default: function CalendarAdminMock({ activeTenantId, activeTab, onTabChange, connectionsHref, openPaige, soloSettings }: {
    activeTenantId: string;
    activeTab: string;
    onTabChange: (tab: string) => void;
    connectionsHref: string;
    openPaige?: () => void;
    soloSettings?: boolean;
  }) {
    React.useEffect(() => {
      harness.mounts.push(activeTenantId);
      return () => { harness.unmounts.push(activeTenantId); };
    }, [activeTenantId]);
    return (
      <section
        data-calendar-admin
        data-tenant={activeTenantId}
        data-tab={activeTab}
        data-connections={connectionsHref}
        data-solo-settings={String(Boolean(soloSettings))}
      >
        <button type="button" onClick={() => onTabChange("booking")}>Booking pages</button>
        {openPaige && <button type="button" data-ask-paige onClick={openPaige}>Ask PAIGE</button>}
      </section>
    );
  },
}));

// Solo no longer mounts CalendarAdmin. It mounts the Solo-native surface, which
// carries NO tab strip of its own — that was the point of the change: the Clients
// strip already names the view, so a second one nested inside it is the defect.
vi.mock("./SoloCalendarWorkspace", () => ({
  SoloCalendarWorkspace: function SoloCalendarMock({ activeTenantId, connectionsHref, openPaige }: {
    activeTenantId: string;
    connectionsHref: string;
    openPaige?: () => void;
  }) {
    React.useEffect(() => {
      harness.mounts.push(activeTenantId);
      return () => { harness.unmounts.push(activeTenantId); };
    }, [activeTenantId]);
    return (
      <section data-solo-calendar-mock data-tenant={activeTenantId} data-connections={connectionsHref}>
        {openPaige && <button type="button" data-ask-paige onClick={openPaige}>Ask PAIGE</button>}
      </section>
    );
  },
}));

import { TenantCanonicalCalendarWorkspace } from "./TenantCanonicalCalendarWorkspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function LocationProbe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return <output data-path={`${location.pathname}${location.search}`} data-navigation={navigationType} />;
}

let container: HTMLDivElement;
let root: Root;

function mount(path: string, tier: "solo" | "agency", openPaige?: () => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path="/solo/:account/operations/work" element={<section data-native-work />} />
          <Route path="*" element={<TenantCanonicalCalendarWorkspace tier={tier} openPaige={openPaige} />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  harness.tenantId = "tenant-a";
  harness.loading = false;
  harness.accountLoading = false;
  harness.mounts = [];
  harness.unmounts = [];
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe("TenantCanonicalCalendarWorkspace", () => {
  it.each(["/solo/101/calendar/tasks", "/solo/202/calendar/tasks/"])("redirects the legacy task result %s to native Operations work", path => {
    mount(path, "solo");
    expect(container.querySelector("[data-path]")?.getAttribute("data-path"))
      .toBe(`${path.split("/calendar/")[0]}/operations/work`);
    expect(container.querySelector("[data-native-work]")).not.toBeNull();
    expect(container.querySelector("[data-navigation]")?.getAttribute("data-navigation")).toBe("REPLACE");
    expect(container.querySelector("[data-solo-calendar-mock]")).toBeNull();
    expect(container.querySelector("[data-calendar-admin]")).toBeNull();
  });

  it.each([
    ["/solo/101/calendar/week", "/solo/101/clients/calendar?calendarView=calendar"],
    ["/solo/101/calendar/agenda", "/solo/101/clients/calendar?calendarView=agenda"],
    ["/solo/101/clients/calendar?calendarView=tasks", "/solo/101/clients/calendar?calendarView=tasks"],
  ])("preserves the calendar-owned destination %s", (path, expected) => {
    mount(path, "solo");
    expect(container.querySelector("[data-path]")?.getAttribute("data-path")).toBe(expected);
    expect(container.querySelector("[data-solo-calendar-mock]")).not.toBeNull();
    expect(container.querySelector("[data-native-work]")).toBeNull();
  });

  it("does not redirect a direct sub-account task calendar to Solo Operations", () => {
    mount("/business/303/calendar/tasks", "agency");
    expect(container.querySelector("[data-path]")?.getAttribute("data-path")).toBe("/business/303/calendar/tasks");
    expect(container.querySelector("[data-calendar-admin]")?.getAttribute("data-tab")).toBe("tasks");
    expect(container.querySelector("[data-native-work]")).toBeNull();
  });

  it("withholds the canonical owner until server-resolved account context exists", () => {
    harness.tenantId = null;
    harness.accountLoading = true;
    mount("/solo/101/calendar", "solo");

    expect(container.querySelector("[data-calendar-admin]")).toBeNull();
    expect(container.textContent).toContain("Resolving Calendar");
    expect(harness.mounts).toEqual([]);
  });

  it.each([
    ["Agency Parent", "/agency/202/calendar/tasks", "agency", "tenant-agency", "/agency/202/integrations"],
    ["acting Sub-account", "/agency/202/sub/303/calendar/availability", "agency", "tenant-child", "/agency/202/sub/303/integrations"],
    ["direct Sub-account", "/business/303/calendar/connections", "agency", "tenant-direct", "/business/303/integrations"],
    ["Enterprise compatibility", "/agency/404/calendar/booking-pages", "agency", "tenant-enterprise", "/agency/404/integrations"],
  ] as const)("preserves the %s account tree", (_label, path, tier, tenantId, connectionsHref) => {
    harness.tenantId = tenantId;
    mount(path, tier);

    const calendar = container.querySelector("[data-calendar-admin]");
    expect(calendar?.getAttribute("data-tenant")).toBe(tenantId);
    expect(calendar?.getAttribute("data-connections")).toBe(connectionsHref);
    expect(calendar?.getAttribute("data-tab")).toBe(path.split("/").at(-1)?.replace("booking-pages", "booking"));
  });

  it("preserves the Solo account tree on the Solo-native owner", () => {
    harness.tenantId = "tenant-solo";
    mount("/solo/101/calendar/agenda", "solo");

    const calendar = container.querySelector("[data-solo-calendar-mock]");
    expect(calendar?.getAttribute("data-tenant")).toBe("tenant-solo");
    // CHANGED, owner-ruled 2026-08-30: Solo now addresses the real settings home
    // rather than the legacy /integrations redirect, and carries the return
    // contract Settings already validates so the trip back is one click.
    expect(calendar?.getAttribute("data-connections")).toBe(
      "/solo/101/settings/connections?origin=calendar&returnTo=%2Fsolo%2F101%2Fclients%2Fcalendar",
    );
    // Solo carries no nested tab strip — asserting its ABSENCE is the contract.
    expect(container.querySelector("[data-calendar-admin]")).toBeNull();
  });

  it("navigates tabs within the exact acting-child tree", () => {
    harness.tenantId = "tenant-child";
    mount("/agency/202/sub/303/calendar", "agency");

    act(() => {
      (container.querySelector("button") as HTMLButtonElement).click();
    });

    expect(container.querySelector("[data-path]")?.getAttribute("data-path")).toBe(
      "/agency/202/sub/303/calendar/booking-pages",
    );
  });

  it("routes Calendar Ask PAIGE actions into the one shell-owned workspace", () => {
    const openPaige = vi.fn();
    mount("/solo/101/calendar", "solo", openPaige);

    act(() => {
      (container.querySelector("[data-ask-paige]") as HTMLButtonElement).click();
    });

    expect(openPaige).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("[data-solo-calendar-mock]")).toHaveLength(1);
  });

  it("routes Solo compatibility addresses into the Clients-owned Calendar and resolves Settings", () => {
    mount("/solo/101/calendar/settings", "solo");

    expect(container.querySelector("[data-path]")?.getAttribute("data-path")).toBe(
      "/solo/101/clients/calendar?calendarView=settings",
    );
    // The legacy address still redirects into the Clients-owned Calendar — that
    // route logic is untouched. What it renders there is now the Solo-native owner,
    // which has no separate Settings TAB: settings are a rail group inside it.
    expect(container.querySelector("[data-solo-calendar-mock]")).not.toBeNull();
    expect(container.querySelector("[data-calendar-admin]")).toBeNull();
  });

  it("remounts the canonical owner when authenticated tenant scope changes", () => {
    mount("/solo/101/calendar", "solo");
    expect(harness.mounts).toEqual(["tenant-a"]);

    harness.tenantId = "tenant-b";
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/solo/101/calendar"]}>
          <Routes><Route path="*" element={<TenantCanonicalCalendarWorkspace tier="solo" />} /></Routes>
        </MemoryRouter>,
      );
    });

    expect(harness.unmounts).toContain("tenant-a");
    expect(harness.mounts).toContain("tenant-b");
    expect(container.querySelector("[data-solo-calendar-mock]")?.getAttribute("data-tenant")).toBe("tenant-b");
  });
});
