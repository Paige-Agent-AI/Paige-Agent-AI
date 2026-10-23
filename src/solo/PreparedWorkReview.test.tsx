// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PreparedWorkReview } from "./PreparedWorkReview";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
function render(scope = "test-scope-a", account?: string) {
  const view = <PreparedWorkReview key={scope} data={data}><button type="button">Inspect prepared work</button></PreparedWorkReview>;
  act(() => root.render(account ? <MemoryRouter initialEntries={[`/solo/${account}/command-center/business-game-plan`]}><Routes><Route path="/solo/:account/*" element={view} /></Routes></MemoryRouter> : view));
}
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
  expect(dialog().querySelector('article')?.textContent).toContain("Recorded summary");
  expect(dialog().querySelector('article')?.textContent).not.toContain("Original draft");
  expect(dialog().querySelector('article')?.textContent?.match(/Summary only/g)).toHaveLength(1);
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

it("links only the exact original finding in the current SOLO account, in an announced new tab", () => {
  data.items[0].sourceLink = { destination: "systems_check", record_id: "e2000000-0000-4000-8000-000000000006" };
  render("test-scope-a", "1234567"); open();
  const link = dialog().querySelector<HTMLAnchorElement>('a')!;
  expect(link.textContent).toContain("Open recorded finding");
  expect(link.textContent).toContain("new tab");
  expect(link.getAttribute('href')).toBe('/solo/1234567/command-center/systems-check?finding=e2000000-0000-4000-8000-000000000006');
  expect(link.target).toBe('_blank'); expect(link.rel).toBe('noopener noreferrer');
  expect(data.refresh).not.toHaveBeenCalled();
});
it.each(["absent", "surface_only", "malformed", "no_account"])("withholds a fabricated direct record link for %s", variant => {
  if (variant !== "absent") data.items[0].sourceLink = { destination: "systems_check", record_id: variant === "surface_only" ? null : variant === "malformed" ? "../other-account" : "e2000000-0000-4000-8000-000000000006" };
  render("test-scope-a", variant === "no_account" ? undefined : "1234567"); open();
  expect(dialog().querySelector('a')).toBeNull();
  expect(dialog().textContent).toContain("original approval or department");
});
it("shows only the original preparation time with its explicit time zone", () => {
  data.items[0].createdAt = "2026-10-22T09:30:00Z"; render(); open();
  const time = dialog().querySelector('time')!;
  expect(time.getAttribute('datetime')).toBe(data.items[0].createdAt);
  expect(time.textContent).toContain('Oct 22, 2026');
  expect(time.textContent).toContain('9:30 AM UTC');
});
it.each(["", "not a date", "1", "2026-10-22T09:30:00"])("does not invent or guess an unavailable preparation date (%s)", date => {
  data.items[0].createdAt = date; render(); open();
  expect(dialog().querySelector('time')).toBeNull();
  expect(dialog().textContent).toContain('Preparation date unavailable');
});
it("does not present a missing summary as an empty original document", () => {
  data.items[0] = { ...data.items[0], draftContent: null, summary: null }; render(); open();
  const article = dialog().querySelector('article')!;
  expect(article.textContent).toContain('No readable draft or summary was returned');
  expect(article.querySelector('section')).toBeNull();
  expect(dialog().querySelector('nav small')?.textContent).toBe('Details unavailable');
});

it("retains inspected source scroll and focus across the original return reread without showing stale details", () => {
  data.items[0].sourceLink = { destination: "systems_check", record_id: "e2000000-0000-4000-8000-000000000006" };
  render("test-scope-a", "1234567"); open();
  const link = dialog().querySelector<HTMLAnchorElement>('a')!;
  (dialog().querySelector('.pwr-document') as HTMLElement).scrollTop = 321;
  (dialog().querySelector('.pwr-workspace') as HTMLElement).scrollTop = 88;
  (dialog().querySelector('.pwr-list') as HTMLElement).scrollTop = 66;
  (dialog().querySelector('.pwr-list') as HTMLElement).scrollLeft = 220;
  link.focus(); act(() => link.click());
  data = { ...data, loading: true }; render("test-scope-a", "1234567");
  expect(dialog().querySelector('a')).toBeNull();
  expect(dialog().textContent).not.toContain('First original paragraph');
  data = { ...data, loading: false }; render("test-scope-a", "1234567");
  expect((dialog().querySelector('.pwr-document') as HTMLElement).scrollTop).toBe(321);
  expect((dialog().querySelector('.pwr-workspace') as HTMLElement).scrollTop).toBe(88);
  expect((dialog().querySelector('.pwr-list') as HTMLElement).scrollTop).toBe(66);
  expect((dialog().querySelector('.pwr-list') as HTMLElement).scrollLeft).toBe(220);
  expect(document.activeElement).toBe(dialog().querySelector('a'));
});

it("does not restore an old source position or focus into a changed reference after reread", () => {
  data.items[0].sourceLink = { destination: "systems_check", record_id: "e2000000-0000-4000-8000-000000000006" };
  render("test-scope-a", "1234567"); open();
  const link = dialog().querySelector<HTMLAnchorElement>('a')!;
  (dialog().querySelector('.pwr-document') as HTMLElement).scrollTop = 321;
  link.focus(); act(() => link.click()); data = { ...data, loading: true }; render("test-scope-a", "1234567");
  data = { ...data, loading: false, items: [{ ...data.items[0], sourceLink: { destination: "systems_check", record_id: "e2000000-0000-4000-8000-000000000007" } }] }; render("test-scope-a", "1234567");
  expect((dialog().querySelector('.pwr-document') as HTMLElement).scrollTop).toBe(0);
  expect(document.activeElement).not.toBe(dialog().querySelector('a'));
});

it("withholds a refused source and lets an explicit retry supersede inspected-source focus", () => {
  data.items[0].sourceLink = { destination: "systems_check", record_id: "e2000000-0000-4000-8000-000000000006" };
  render("test-scope-a", "1234567"); open();
  const link = dialog().querySelector<HTMLAnchorElement>('a')!;
  (dialog().querySelector('.pwr-document') as HTMLElement).scrollTop = 321;
  link.focus(); act(() => link.click());
  data = { ...data, error: "read refused" }; render("test-scope-a", "1234567");
  expect(dialog().querySelector('a')).toBeNull(); expect(dialog().textContent).not.toContain('37 prepared items');
  expect(dialog().textContent).not.toContain('First original paragraph');
  act(() => (dialog().querySelector('.pwr-state button') as HTMLButtonElement).click());
  expect(data.refresh).toHaveBeenCalledOnce();
  data = { ...data, error: null }; render("test-scope-a", "1234567");
  expect((dialog().querySelector('.pwr-document') as HTMLElement).scrollTop).toBe(0);
  expect(document.activeElement).not.toBe(dialog().querySelector('a'));
});
