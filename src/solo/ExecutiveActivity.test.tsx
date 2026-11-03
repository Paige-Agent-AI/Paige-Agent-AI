// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SoloActivityFeed, SoloActivityItem } from "./data/useSoloActivityFeed";
import { ExecutiveActivity } from "./ExecutiveActivity";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, feed: SoloActivityFeed;
const event = (id: string, more: Partial<SoloActivityItem> = {}): SoloActivityItem => ({
  id, title: `Original recorded event ${id}`, summary: "Original source summary",
  byPaige: false, byPerson: false, actorAgent: null, departmentSlug: null,
  occurredAt: "2026-10-25T14:20:00Z", ...more,
});
beforeEach(() => {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  feed = { items: [event("first", { byPaige: true, actorAgent: "VERA", departmentSlug: "finance" }),
    event("second", { byPerson: true }), event("third")], loading: false, status: "ready", error: null, refresh: vi.fn() };
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function render(scope = "test-scope-a") { act(() => root.render(<ExecutiveActivity key={scope} feed={feed} timezone="UTC" />)); }
function open() { const trigger = host.querySelector<HTMLButtonElement>('[data-activity-inspect]')!; trigger.focus(); act(() => trigger.click()); }
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const detail = () => dialog().querySelector<HTMLElement>("article")!;
const choose = (id: string) => act(() => dialog().querySelector<HTMLButtonElement>(`[data-activity-id="${id}"]`)!.click());
const text = () => document.body.textContent ?? "";

it("opens original attribution and facts without promoting an event to completed work", () => {
  render(); open();
  expect(detail().textContent).toContain("VERA");
  expect(detail().textContent).toContain("Finance");
  expect(detail().textContent).toContain("Original source summary");
  expect(detail().querySelector("time")?.dateTime).toBe("2026-10-25T14:20:00Z");
  expect(detail().textContent).toContain("Business result not provided");
  expect(detail().querySelector("a")).toBeNull();
  expect([...dialog().querySelectorAll("button")].some(b => /^(Approve|Execute|Send)$/.test(b.textContent ?? ""))).toBe(false);
  expect(feed.refresh).not.toHaveBeenCalled();
});
it("does not invent a named specialist or credit an unknown actor to PAIGE or a person", () => {
  feed.items = [event("unknown"), event("agent", { byPaige: true })]; render(); open();
  expect(detail().textContent).toContain("Actor not recorded");
  choose("agent");
  expect(detail().textContent).toContain("PAIGE team · specialist not recorded");
  expect(detail().textContent).not.toContain("VERA");
});
it("filters only the returned sample by original actor attribution", () => {
  render(); open();
  act(() => { const select = dialog().querySelector("select")!; select.value = "people"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(dialog().querySelectorAll("[data-activity-id]")).toHaveLength(1);
  expect(dialog().querySelector("[data-activity-id]")?.getAttribute("data-activity-id")).toBe("second");
  expect(dialog().textContent).toContain("1 of 3 returned events");
  expect(dialog().querySelector("article")).toBeNull();
  expect(dialog().textContent).toContain("Select a returned event");
  choose("second"); expect(detail().textContent).toContain("Person");
});
it("withholds previous event details and count when a read is refused or fails", () => {
  render(); open();
  for (const status of ["forbidden", "unavailable", "loading"] as const) {
    feed = { ...feed, status, loading: status === "loading" }; render();
    expect(dialog().textContent).not.toContain("Original source summary");
    expect(dialog().textContent).not.toContain("3 returned events");
    expect(dialog().querySelector("article")).toBeNull();
    expect(dialog().textContent).toContain(status === "forbidden" ? "not authorized" : status === "loading" ? "Reading" : "could not be read");
  }
});
it("does not silently substitute a different event when the selected original leaves the sample", () => {
  render(); open(); choose("second");
  feed = { ...feed, items: [feed.items[0]] }; render();
  expect(dialog().textContent).toContain("selected event is not in this returned sample");
  expect(dialog().querySelector("article")).toBeNull();
  choose("first"); expect(detail().textContent).toContain("Original recorded event first");
});
it("states date absence instead of inventing a timestamp and renders source text as text", () => {
  feed.items = [event("missing", { occurredAt: "", title: "<img src=x onerror=alert(1)>", summary: "<script>not executable</script>" })]; render(); open();
  expect(detail().textContent).toContain("Recording time unavailable");
  expect(detail().querySelector("time")).toBeNull();
  expect(detail().querySelector("img,script")).toBeNull();
  expect(detail().textContent).toContain("<script>not executable</script>");
});
it("distinguishes a returned empty sample and retries only its original read", () => {
  feed.items = []; render(); open();
  expect(dialog().textContent).toContain("No recent events returned");
  const retry = [...dialog().querySelectorAll("button")].find(b => b.textContent?.includes("Refresh activity"))!;
  act(() => retry.click()); expect(feed.refresh).toHaveBeenCalledTimes(1);
});
it("shows all returned events for inspection while retaining a four-event preview", () => {
  feed.items = Array.from({ length: 25 }, (_, i) => event(String(i))); render();
  expect(host.querySelectorAll(".exec-activity-preview > li")).toHaveLength(4);
  open(); expect(dialog().querySelectorAll("[data-activity-id]")).toHaveLength(25);
  expect(dialog().textContent).toContain("25 returned events");
  expect(dialog().textContent).toContain("not a complete activity history");
});
it("drops the open inspection on the original parent scope remount", () => {
  render(); open(); expect(dialog()).not.toBeNull();
  feed = { ...feed, items: [event("new-workspace")] }; render("test-scope-b");
  expect(dialog()).toBeNull(); expect(text()).not.toContain("Original recorded event first");
});
it("returns keyboard focus to the existing visible PAIGE workspace when its overlay covers the invoker", async () => {
  const workspace = document.createElement("aside"); workspace.id = "tenant-paige-workspace";
  workspace.innerHTML = '<header><button type="button">Existing PAIGE control</button></header>';
  document.body.appendChild(workspace);
  const target = workspace.querySelector("button")!;
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 10, 44, 44));
  const original = document.elementFromPoint;
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
  try {
    render(); open();
    act(() => [...dialog().querySelectorAll("button")].find(b => b.textContent === "Close")!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(dialog()).toBeNull(); expect(document.activeElement).toBe(target);
    expect(feed.refresh).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: original });
    workspace.remove(); vi.restoreAllMocks();
  }
});

it("reveals an off-viewport invoker after responsive inspection", async () => {
  render(); open();
  const trigger = host.querySelector<HTMLButtonElement>("[data-activity-inspect]")!;
  // JSDOM has no viewport layout. Model the browser's existing scroll port;
  // the actual released failure is separately reproduced in both SOLO contexts.
  let inView = false;
  vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(() => new DOMRect(10, inView ? 10 : 1200, 160, 44));
  Object.defineProperty(trigger, "scrollIntoView", { configurable: true, value: () => { inView = true; } });
  const original = document.elementFromPoint;
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => inView ? trigger : null });
  try {
    act(() => [...dialog().querySelectorAll("button")].find(b => b.textContent === "Close")!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    const r = trigger.getBoundingClientRect();
    expect(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)).toBe(trigger);
    expect(feed.refresh).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: original });
    vi.restoreAllMocks();
  }
});
