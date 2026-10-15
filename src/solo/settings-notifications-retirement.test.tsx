import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLocation, useParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsRouteBoundary, SettingsMoveNotice } from "./settings-notifications-retirement";
import { SOLO_SETTINGS_DESTINATIONS } from "./settings-contract";
import { branchBySlug } from "@/lib/routing/tierBranches";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); });
const notice = "Notifications now appear in the area where the work happens.";

async function mount(entries: string[]) {
  const reads = vi.fn();
  function Feature() {
    const location = useLocation();
    const { account } = useParams();
    reads(location.pathname);
    return <><h1>Settings</h1>{location.pathname.includes("/settings/setup") && <SettingsMoveNotice key={account}/>}</>;
  }
  const router = createMemoryRouter([{ path: "/solo/:account/*", element: <SettingsRouteBoundary><Feature/></SettingsRouteBoundary> }], { initialEntries: entries });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => { act(() => root.unmount()); router.dispose(); host.remove(); });
  await act(async () => root.render(<RouterProvider router={router}/>));
  const go = async (target: string | number) => { await act(async () => { if (typeof target === "number") await router.navigate(target); else await router.navigate(target); }); };
  return { router, host, reads, go };
}

describe("retired Solo notification route", () => {
  it("has no notification menu or registered subtab and preserves eight approved Settings destinations", () => {
    const expected = ["setup", "team", "connections", "integrations", "analytics", "security-data", "vault", "billing"];
    expect(SOLO_SETTINGS_DESTINATIONS.map(x => x.key)).toEqual(expected);
    expect(branchBySlug("solo", "settings")?.subtabs?.map(x => x.key)).toEqual(expected);
  });
  it.each(["", "/", "?origin=calendar&returnTo=/solo/other/settings/billing#old"])("replaces a legacy bookmark once, discarding stale state: %s", async suffix => {
    const { router, host, reads, go } = await mount(["/solo/41/settings/team", `/solo/41/settings/notifications${suffix}`]);
    expect(router.state.location.pathname).toBe("/solo/41/settings/setup/business-profile");
    expect(router.state.location.search).toBe("");
    expect(router.state.location.hash).toBe("");
    expect(host.querySelector('[role="status"]')?.textContent).toBe(notice);
    expect(router.state.location.state?.notificationMoveNotice).not.toBe(true);
    expect(reads.mock.calls.some(([path]) => path.includes("notifications"))).toBe(false);
    await go(-1);
    expect(router.state.location.pathname).toBe("/solo/41/settings/team");
    expect(host.textContent).not.toContain(notice);
    await go(1);
    expect(router.state.location.pathname).toBe("/solo/41/settings/setup/business-profile");
    expect(host.textContent).not.toContain(notice);
  });
  it("does not carry acknowledgement across workspace switches or normal Setup arrivals", async () => {
    const { router, host, go } = await mount(["/solo/41/settings/notifications"]);
    await go("/solo/82/settings/setup");
    expect(host.textContent).not.toContain(notice);
    await go("/solo/82/settings/notifications");
    expect(router.state.location.pathname).toBe("/solo/82/settings/setup/business-profile");
    expect(host.textContent).toContain(notice);
    await go("/solo/82/settings/billing");
    await go("/solo/82/settings/setup");
    expect(host.textContent).not.toContain(notice);
  });
  it("leaves source routes and nested Calendar notification settings alone", async () => {
    const { router, host, go } = await mount(["/solo/41/settings/setup"]);
    expect(host.textContent).not.toContain(notice);
    for (const destination of ["team", "connections", "integrations", "analytics/overview", "security-data", "vault", "billing", "connections/notifications"]) {
      await go(`/solo/41/settings/${destination}`);
      expect(router.state.location.pathname).toBe(`/solo/41/settings/${destination}`);
      expect(host.textContent).not.toContain(notice);
    }
  });
});
