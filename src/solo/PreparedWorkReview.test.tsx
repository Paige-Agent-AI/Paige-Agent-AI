// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PreparedWorkReview } from "./PreparedWorkReview";
import type { SoloPendingActionsData } from "./data/useSoloPendingActions";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
let root: Root, host: HTMLDivElement, data: SoloPendingActionsData;
beforeEach(() => {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  data = { loading: false, error: null, total: 37, refresh: vi.fn(), items: [
    { id: "test-work-a", title: "Review the service handoff", summary: "Existing recorded scope", rationale: "Confirm the receiving team.", draftContent: "First original paragraph.\n\nSecond original paragraph.", department: "Operations", createdAt: "" },
    { id: "test-work-b", title: "Review the commercial scope", summary: "Summary only", rationale: null, draftContent: null, department: "Sales", createdAt: "" },
  ] };
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function render(scope = "test-scope-a") { act(() => root.render(<PreparedWorkReview key={scope} data={data}><button type="button">Inspect prepared work</button></PreparedWorkReview>)); }
function open() { const trigger = host.querySelector("button")!; trigger.focus(); act(() => trigger.click()); }
function dialog() { return document.querySelector('[role="dialog"]')!; }

it("opens a spacious source-labelled read without executing, approving or sending", () => {
  render(); open();
  expect(dialog().textContent).toContain("37 prepared items");
  expect(dialog().textContent).toContain("2 shown");
  expect(dialog().textContent).toContain("Prepared work · Operations");
  expect(dialog().textContent).toContain("Confirm the receiving team.");
  expect(dialog().querySelector('.pwr-prose')?.textContent).toBe(data.items[0].draftContent);
  expect(dialog().textContent).toContain("cannot be edited, approved or executed here");
  expect([...dialog().querySelectorAll('button')].some(b => /^(Approve|Send|Execute)$/.test(b.textContent ?? ""))).toBe(false);
  expect(data.refresh).not.toHaveBeenCalled();
});
it("selects the other original source and does not invent missing draft content", () => {
  render(); open(); act(() => (dialog().querySelectorAll('nav button')[1] as HTMLButtonElement).click());
  expect(dialog().querySelector('article')?.textContent).toContain("Prepared work · Sales");
  expect(dialog().querySelector('article')?.textContent).toContain("No readable draft text");
  expect(dialog().querySelector('article')?.textContent).not.toContain("First original paragraph");
});
it("withholds details and counts during a failed or loading reread, and retry only refreshes", () => {
  render(); open(); data = { ...data, error: "read denied" }; render();
  expect(dialog().textContent).not.toContain("37 prepared items");
  expect(dialog().textContent).not.toContain("First original paragraph");
  act(() => (dialog().querySelector('.pwr-state button') as HTMLButtonElement).click());
  expect(data.refresh).toHaveBeenCalledOnce();
  data = { ...data, error: null, loading: true }; render();
  expect(dialog().textContent).toContain("Checking this workspace");
  expect(dialog().textContent).not.toContain("First original paragraph");
});
it("distinguishes positive exact count with no readable preview from an empty result", () => {
  data = { ...data, items: [] }; render(); open();
  expect(dialog().textContent).toContain("recorded count is positive");
  data = { ...data, total: 0 }; render();
  expect(dialog().textContent).toContain("No prepared items returned");
  expect(dialog().textContent).not.toContain("All caught up");
});
it("does not turn a capped preview into a total when the native count is unavailable", () => {
  data.total = null; render(); open();
  expect(dialog().textContent).toContain("2 shown · total unavailable");
  expect(dialog().textContent).not.toContain("2 prepared items");
});
it("retires the entire review when the caller changes the identity key", () => {
  render(); open(); expect(dialog()).toBeTruthy(); render("test-scope-b");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
