import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {beforeEach, afterEach, expect, it, vi} from "vitest";
const f = vi.hoisted(() => ({state: {} as Record<string, unknown>, reload: vi.fn(), more: vi.fn(), signOut: vi.fn(), target: vi.fn()}));
vi.mock("@/hooks/useClientPortalRelationshipChoices", () => ({useClientPortalRelationshipChoices: () => ({...f.state, reload: f.reload, loadMore: f.more})}));
vi.mock("@/lib/auth/signOut", () => ({performSignOut: (...args: unknown[]) => f.signOut(...args), customerSignOutTarget: () => f.target()}));
import {CustomerBusinessChoice} from "./CustomerBusinessChoice";
const a = "e0915000-0000-0000-0000-000000000001", b = "e0915000-0000-0000-0000-000000000002";
const row = (id = a) => ({clientId: id, tenantId: id, businessName: id === a ? "Northwind Studio" : "Harbor Lane", logoUrl: null, logoDarkUrl: null});
let root: Root, host: HTMLDivElement;
const render = () => act(async () => root.render(<CustomerBusinessChoice actor={a}/>));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {vi.clearAllMocks(); f.state = {phase: "ready", rows: [row()], more: false, loadingMore: false, addedId: null};
  f.target.mockResolvedValue("/"); f.signOut.mockResolvedValue(false); host = document.createElement("div"); document.body.append(host); root = createRoot(host);});
afterEach(() => {act(() => root.unmount()); host.remove();});
it("opens a native full-navigation entry and grants no frame from the row itself", async () => {
  await render(); const link = host.querySelector("ul a")!; expect(link.getAttribute("href")).toBe(`/app?business=${a}`);
  expect(link.textContent).toContain("Northwind Studio"); expect(host.textContent).not.toMatch(/invoice|Private|PAIGE/);
});
it.each(["loading", "error"])("withholds all old choice links during %s", async phase => {
  f.state.phase = phase; await render(); expect(host.querySelector("ul a")).toBeNull();
  if (phase === "error") {await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Try again")!.click()); expect(f.reload).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(host.querySelector("h1"));}
  else expect(host.querySelector('[role="status"]')).not.toBeNull();
});
it("an empty result gives access recovery without invented businesses", async () => {
  f.state.rows = []; await render(); expect(host.textContent).toContain("No active portal access"); expect(host.querySelector("a")).toBeNull(); expect(host.textContent).toContain("invitation");
});
it("retains keyboard position when the load-more control disappears", async () => {
  f.state.more = true; await render(); const more = [...host.querySelectorAll("button")].find(b => b.textContent === "More businesses")!;
  more.focus(); await act(async () => more.click()); expect(f.more).toHaveBeenCalledOnce();
  f.state = {...f.state, more: false, rows: [row(), row(b)], addedId: b}; await render();
  expect(document.activeElement?.getAttribute("href")).toBe(`/app?business=${b}`);
});
it("reports failed sign-out and permits another attempt through the original sign-out engine", async () => {
  await render(); const button = [...host.querySelectorAll("button")].find(b => b.textContent === "Sign out")!;
  await act(async () => button.click()); expect(f.signOut).toHaveBeenCalledWith("/"); expect(host.querySelector('[role="alert"]')?.textContent).toContain("still signed in");
  await act(async () => button.click()); expect(f.signOut).toHaveBeenCalledTimes(2); expect(button.disabled).toBe(false);
});
