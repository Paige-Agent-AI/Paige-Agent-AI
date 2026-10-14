import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({ reason: null as string | null }));
vi.mock("@/lib/routing/useSubtabRoute", () => ({ useSubtabRoute: () => {
  const location = useLocation(); const navigate = useNavigate();
  return [location.pathname.endsWith("/capacity") ? "capacity" : "work", (view: string) => navigate(`/solo/123/operations/${view}`)];
} }));
vi.mock("./OperationsWorkspace", () => ({ OperationsWorkspace: ({ view, weeklySourceSearch, onNavigationGuardChange, onViewChange, onWeeklySourceDismiss }: {
  view: string; weeklySourceSearch: string; onViewChange: (view: string) => void; onWeeklySourceDismiss: () => void;
  onNavigationGuardChange: (guard: (() => string | null) | null) => void;
}) => {
  React.useLayoutEffect(() => { onNavigationGuardChange(() => harness.reason); return () => onNavigationGuardChange(null); }, [onNavigationGuardChange]);
  return <div data-view={view} data-query={weeklySourceSearch}><button onClick={() => onViewChange("capacity")}>Capacity</button>
    <button onClick={onWeeklySourceDismiss}>Dismiss source</button></div>;
} }));
import { OperationsRoute } from "./OperationsRoute";
function HistoryControls() {
  const navigate = useNavigate(); const location = useLocation();
  return <div><output>{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Back</button>
    <button onClick={() => navigate("/solo/123/operations/work?weeklySource=planning_item&item=40000000-0000-4000-8000-000000000001")}>Another source</button></div>;
}
let root: Root; let container: HTMLDivElement;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const search = "?weeklySource=planning_item&item=30000000-0000-4000-8000-000000000001";
beforeEach(() => { harness.reason = null; container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render() {
  await act(async () => root.render(<MemoryRouter initialEntries={["/solo/123/operations/work", `/solo/123/operations/work${search}`]} initialIndex={1}>
    <HistoryControls /><OperationsRoute openPaige={vi.fn()} /></MemoryRouter>));
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(candidate => candidate.textContent === label)!;
  await act(async () => button.click());
}
it("keeps the accepted query through dirty Back and repeated-source transitions without a replace loop", async () => {
  await render(); harness.reason = "Unsaved draft";
  await click("Back"); expect(container.querySelector("output")?.textContent).toContain(search);
  expect(container.querySelector("[data-query]")?.getAttribute("data-query")).toBe(search);
  await click("Another source"); expect(container.querySelector("output")?.textContent).toContain(search);
  await click("Capacity"); expect(container.querySelector("[data-view]")?.getAttribute("data-view")).toBe("work");
});
it("accepts clean Back and clears only typed source parameters when the inspection closes", async () => {
  await render(); await click("Dismiss source");
  expect(container.querySelector("output")?.textContent).toBe("/solo/123/operations/work");
  expect(container.querySelector("[data-query]")?.getAttribute("data-query")).toBe("");
  await click("Capacity"); expect(container.querySelector("[data-view]")?.getAttribute("data-view")).toBe("capacity");
});
