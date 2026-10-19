import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import Progress from "./Progress";
import { groupOpenWork, PORTAL_PROGRESS_REFRESH_ERROR } from "@/hooks/useClientPortalProgress";
import type { ClientPortalProgressState, PortalProgressItem } from "@/hooks/useClientPortalProgress";

// Synthetic test tenant (Northwind Studio); never a real account.
const T = "e0923000-0000-0000-0000-000000000002";
const f = vi.hoisted(() => ({
  state: null as unknown as ClientPortalProgressState,
  openActions: [] as unknown[],
}));
vi.mock("@/hooks/useClientPortalProgress", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useClientPortalProgress")>()),
  useClientPortalProgress: () => f.state,
}));
vi.mock("@/hooks/useClientPortalBrand", () => ({
  useClientPortalBrand: () => ({ tenant_id: T, tenant_name: "Northwind Studio", primary_color: null, logo_url: null }),
}));
vi.mock("@/hooks/useMyActions", () => ({ useMyActions: () => ({ open: f.openActions }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const it_ = (id: string, extra: Partial<PortalProgressItem> = {}): PortalProgressItem => ({
  id, kind: "task", title: `Task ${id}`, state: "not_started", due_at: iso(Date.now() + 5 * DAY),
  completed_at: null, shared_at: iso(Date.now() - 5 * DAY), parent_id: null, ...extra,
});
const withItems = (items: PortalProgressItem[], extra: Partial<ClientPortalProgressState> = {}) => {
  const done = items.filter(i => i.state === "done").length;
  f.state = {
    ...f.state,
    items,
    summary: {
      shared: items.length, done, open: items.length - done,
      overdue: items.filter(i => i.state !== "done" && i.due_at && Date.parse(i.due_at) < Date.now()).length,
    },
    ...extra,
  };
};

let root: Root, host: HTMLDivElement;
const render = async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={["/app/progress"]}>
      <Routes>
        <Route path="/app/progress" element={<Progress />} />
        <Route path="/app/messages" element={<p>Messages page</p>} />
        <Route path="/app/actions" element={<p>Action items page</p>} />
        <Route path="/app" element={<p>Home page</p>} />
      </Routes>
    </MemoryRouter>,
  ));
  await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
};
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });
const ids = (scope: ParentNode) => Array.from(scope.querySelectorAll("[data-testid=progress-item]")).map(e => e.getAttribute("data-item-id"));

beforeEach(() => {
  vi.clearAllMocks();
  f.openActions = [];
  f.state = {
    items: [], summary: null, hasMore: false, serverNow: iso(Date.now()), loading: false, error: null,
    unavailable: false, multipleBusinesses: false, tenantId: T, scopeEpoch: 0, refresh: vi.fn().mockResolvedValue(undefined),
  };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("groups open work under its shared milestone, with everything else under Other work", async () => {
  withItems([
    it_("m1", { kind: "milestone", title: "Brand launch", state: "in_progress" }),
    it_("t1", { title: "Approve the logo", parent_id: "m1", state: "in_progress" }),
    it_("t2", { title: "Book the photographer" }),
    it_("t3", { title: "Pick the palette", parent_id: "m1" }),
  ]);
  await render();
  const cards = Array.from(host.querySelectorAll("section[aria-labelledby=progress-open] > ol > li"));
  expect(cards.map(c => c.getAttribute("aria-label"))).toEqual(["Brand launch", "Other work"]);
  expect(ids(cards[0])).toEqual(["m1", "t1", "t3"]);
  expect(ids(cards[1])).toEqual(["t2"]);
  expect(cards[0].querySelector("h3")?.textContent).toContain("Brand launch");
});

it("folds nested milestones into their top-level one and treats an unseen parent as Other work", () => {
  const { groups, other } = groupOpenWork([
    it_("m1", { kind: "milestone" }),
    it_("m2", { kind: "milestone", parent_id: "m1" }),
    it_("t1", { parent_id: "m2" }),
    it_("t2", { parent_id: "not-on-this-page" }),
    it_("d1", { state: "done", parent_id: "m1" }),
  ]);
  expect(groups.map(g => [g.milestone.id, g.open.map(i => i.id)])).toEqual([["m1", ["m2", "t1"]]]);
  expect(other.map(i => i.id)).toEqual(["t2"]);
});

it("keeps a finished milestone heading its still-open work", () => {
  const { groups } = groupOpenWork([it_("t1", { parent_id: "m1" }), it_("m1", { kind: "milestone", state: "done" })]);
  expect(groups.map(g => [g.milestone.id, g.milestone.state, g.open.map(i => i.id)])).toEqual([["m1", "done", ["t1"]]]);
});

it("says how much is done and how much is past due, and marks the late item", async () => {
  withItems([
    it_("late", { title: "Send the signed brief", due_at: iso(Date.now() - 2 * DAY) }),
    it_("soon"),
    it_("d1", { state: "done", completed_at: iso(Date.now() - DAY) }),
  ]);
  await render();
  const summary = host.querySelector("[data-testid=progress-summary]")!;
  expect(summary.textContent).toContain("1 of 3 done");
  expect(summary.textContent).toContain("1 past due");
  const late = host.querySelector('[data-item-id="late"]')!;
  expect(late.querySelector("[data-testid=past-due]")?.textContent).toMatch(/^Past due · /);
  expect(host.querySelector('[data-item-id="soon"] [data-testid=past-due]')).toBeNull();
});

it("shows the customer states in words, and says finished work once", async () => {
  withItems([it_("a"), it_("b", { state: "in_progress" }), it_("c", { state: "done", completed_at: iso(Date.now()) })]);
  await render();
  await click(Array.from(host.querySelectorAll("button")).find(b => b.textContent?.startsWith("Done"))!);
  const pills = Array.from(host.querySelectorAll("[data-testid=state-pill]")).map(p => p.textContent);
  expect(pills).toEqual(["Not started", "In progress"]);
  // A finished row says "Finished <date>" and carries no Done pill beside it.
  const finished = host.querySelector('[data-item-id="c"]')!;
  expect(finished.querySelector("[data-testid=state-pill]")).toBeNull();
  expect(finished.textContent).toMatch(/Finished \w{3}, \w{3} \d+/);
  expect(finished.textContent).not.toMatch(/\bDone\b/);
});

it("tints In progress and leaves Not started as plain muted text", async () => {
  withItems([it_("a"), it_("b", { state: "in_progress" })]);
  await render();
  const [notStarted, inProgress] = Array.from(host.querySelectorAll("[data-testid=state-pill]"));
  expect(inProgress.className).toContain("bg-primary/10");
  expect(notStarted.className).toContain("border-transparent");
  expect(notStarted.className).toContain("text-muted-foreground");
  expect(notStarted.className).not.toMatch(/\bbg-/);
});

it("on a phone drops the pill column and leads the due line with the state; children indent 16px", async () => {
  withItems([it_("m1", { kind: "milestone" }), it_("t1", { parent_id: "m1", state: "in_progress" })]);
  await render();
  const row = host.querySelector('[data-item-id="t1"]')!;
  const pill = row.querySelector("[data-testid=state-pill]")!;
  expect(pill.className.split(" ")).toEqual(expect.arrayContaining(["hidden", "sm:inline-flex"]));
  const inline = row.querySelector("[data-testid=state-inline]")!;
  expect(inline.className).toContain("sm:hidden");
  expect(inline.parentElement!.textContent).toMatch(/^In progress · Due /);
  const children = host.querySelector('[aria-label="Task m1"] ol')!;
  expect(children.className.split(" ")).toEqual(expect.arrayContaining(["ml-4", "sm:ml-7"]));
});

it("offers no way to mark a progress item done: the business updates it", async () => {
  withItems([it_("a", { kind: "milestone" }), it_("b", { parent_id: "a" }), it_("c", { state: "done" })]);
  await render();
  const controls = Array.from(host.querySelectorAll("button, input, [role=checkbox], [role=switch]"));
  // The only control is the Done disclosure.
  expect(controls.map(c => c.textContent?.trim())).toEqual(["Done (1)"]);
  expect(host.textContent).not.toMatch(/mark (as )?(complete|done)/i);
  expect(host.textContent).toContain("Northwind Studio updates this list. Questions?");
});

it("folds Done away while work is open, and opens it when everything is done", async () => {
  withItems([it_("a"), it_("d1", { state: "done" })]);
  await render();
  const toggle = Array.from(host.querySelectorAll("button")).find(b => b.textContent?.startsWith("Done"))!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect((document.getElementById(toggle.getAttribute("aria-controls")!) as HTMLElement).hidden).toBe(true);
  await click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");

  withItems([it_("d1", { state: "done" }), it_("d2", { state: "done" })]);
  await render();
  // One strong line at the headline step, not a count followed by a sentence saying the same thing.
  const line = host.querySelector("[data-testid=all-done]")!;
  expect(line.textContent).toContain("Everything Northwind Studio has shared with you is done.");
  expect(line.className).toContain("text-xl");
  expect(host.querySelector("header")!.contains(line)).toBe(true);
  expect(host.textContent).not.toContain("2 of 2 done");
  expect(host.querySelectorAll("[data-testid=all-done]")).toHaveLength(1);
  // The "sharing with you" subtitle adds nothing under the all-done line.
  expect(host.textContent).not.toContain("The work Northwind Studio is sharing with you.");
});

it("leads with how much is done, at the headline step", async () => {
  withItems([it_("a"), it_("d", { state: "done" })]);
  await render();
  const count = Array.from(host.querySelectorAll("[data-testid=progress-summary] span")).find(e => e.textContent === "1 of 2 done")!;
  expect(count.className).toContain("text-xl");
  expect(count.className).toContain("tabular-nums");
});

const DAYS = (n: number) => iso(Date.now() + n * DAY);
it("names what's next: past due first, then due today, then soonest, with the milestone as context", async () => {
  // "Due today" is one minute ahead; run at midday so the minute never crosses midnight in any zone CI uses.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(process.env.PROGRESS_TEST_NOW ?? "2026-10-15T16:00:00Z"));
  onTestFinished(() => { vi.useRealTimers(); });
  withItems([
    it_("m1", { kind: "milestone", title: "Brand identity", due_at: DAYS(20) }),
    it_("later", { parent_id: "m1", due_at: DAYS(9) }),
    it_("today", { parent_id: "m1", title: "Review the moodboard", due_at: iso(Date.now() + 60_000) }),
    it_("undated", { due_at: null }),
    it_("late", { title: "Send the signed brief", due_at: DAYS(-2) }),
    it_("soon", { due_at: DAYS(3) }),
  ]);
  await render();
  const next = host.querySelector("[data-testid=next-up]")!;
  expect(next.querySelector("h2")!.textContent).toBe("Next up");
  const rows = Array.from(next.querySelectorAll("[data-testid=next-up-item]"));
  expect(rows.map(r => r.getAttribute("data-item-id"))).toEqual(["late", "today", "soon"]);
  expect(rows[0].querySelector("[data-testid=past-due]")).not.toBeNull();
  expect(rows[1].textContent).toContain("Due today · in Brand identity");
  // "in {milestone}" moves to the next line as one unit on a phone, never "in Brand / identity".
  expect(rows[1].querySelector("[data-testid=next-context]")!.className).toContain("inline-block");
  expect(rows[0].textContent).not.toContain(" · in ");
  // It comes before the full grouped list, which is still all there.
  const open = host.querySelector("section[aria-labelledby=progress-open]")!;
  expect(next.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect([...ids(open)].sort()).toEqual(["late", "later", "m1", "soon", "today", "undated"]);
});

it("leaves Next up out when it would only repeat the whole open list, or nothing open is dated", async () => {
  withItems([it_("a", { due_at: DAYS(1) }), it_("b", { due_at: DAYS(2) })]);
  await render();
  expect(host.querySelector("[data-testid=next-up]")).toBeNull();
  withItems([it_("a", { due_at: null }), it_("b", { due_at: null }), it_("c", { due_at: null }), it_("d", { due_at: null })]);
  await render();
  expect(host.querySelector("[data-testid=next-up]")).toBeNull();
});

it("points questions at Messages", async () => {
  withItems([it_("a")]);
  await render();
  const link = Array.from(host.querySelectorAll("footer a"))[0];
  expect(link.getAttribute("href")).toBe("/app/messages?topic=progress");
  await click(link);
  expect(host.textContent).toContain("Messages page");
});

it("links waiting action items only when there are some", async () => {
  withItems([it_("a")]);
  await render();
  expect(host.querySelector("[data-testid=action-items-waiting]")).toBeNull();
  f.openActions = [{ id: "x" }, { id: "y" }];
  await render();
  const line = host.querySelector("[data-testid=action-items-waiting]")!;
  expect(line.textContent).toContain("You have 2 action items waiting");
  expect(line.getAttribute("href")).toBe("/app/actions");
  f.openActions = [{ id: "x" }];
  await render();
  expect(host.querySelector("[data-testid=action-items-waiting]")!.textContent).toContain("You have 1 action item waiting");
});

it("says the business hasn't shared anything yet, with a way to ask", async () => {
  withItems([]);
  await render();
  expect(host.textContent).toContain("Northwind Studio hasn't shared any progress with you yet");
  expect(host.querySelector("[data-testid=progress-summary]")).toBeNull();
  const ask = Array.from(host.querySelectorAll("a")).find(a => a.textContent?.includes("Message Northwind Studio"))!;
  expect(ask.getAttribute("href")).toBe("/app/messages?topic=progress");
});

it("shows a skeleton on the first read, not an empty state", async () => {
  f.state = { ...f.state, loading: true, summary: null };
  await render();
  expect(host.querySelector("[data-testid=progress-skeleton]")).not.toBeNull();
  expect(host.textContent).not.toContain("hasn't shared");
});

it("says progress isn't available on an account with no business", async () => {
  f.state = { ...f.state, unavailable: true };
  await render();
  expect(host.textContent).toContain("Progress isn't available on this account");
  expect(host.querySelector('a[href="/app"]')).not.toBeNull();
  expect(host.querySelector("[data-testid=action-items-waiting]")).toBeNull();
});

it("says progress for several businesses isn't available yet, and points to Support", async () => {
  f.state = { ...f.state, multipleBusinesses: true };
  await render();
  expect(host.textContent).toContain("Progress for more than one business isn't available yet");
  expect(host.querySelector('a[href="/app/support"]')).not.toBeNull();
});

it("keeps the last list on a failed refresh, says so, and offers a retry", async () => {
  withItems([it_("a")], { error: PORTAL_PROGRESS_REFRESH_ERROR });
  await render();
  expect(host.querySelector("[role=alert]")?.textContent).toContain("We couldn't refresh this list, so it may be out of date.");
  expect(ids(host)).toEqual(["a"]);
  await click(Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Try again")!);
  expect(f.state.refresh).toHaveBeenCalledTimes(1);
});

it("says when only part of the shared list is shown", async () => {
  withItems([it_("a")], { hasMore: true });
  f.state = { ...f.state, summary: { shared: 140, done: 0, open: 140, overdue: 0 } };
  await render();
  expect(host.textContent).toContain("Showing the first 1 of 140 shared items.");
});

it("says why finished work is missing from Done when open work fills the page", async () => {
  // 100 open items fill the page; the 3 finished ones sort after the cutoff.
  withItems(Array.from({ length: 3 }, (_, n) => it_(`o${n}`)), { hasMore: true });
  f.state = { ...f.state, summary: { shared: 103, done: 3, open: 100, overdue: 0 } };
  await render();
  const note = host.querySelector("[data-testid=done-unlisted]")!;
  expect(note.textContent).toBe("3 finished items aren't listed here. This page shows up to 100 items, open work first.");
  expect(note.closest("section")!.querySelector("h2")!.textContent).toBe("Done (3)");

  // Part of Done fits: the listed ones show, and the note counts the rest.
  withItems([it_("o1"), it_("d1", { state: "done" })], { hasMore: true });
  f.state = { ...f.state, summary: { shared: 103, done: 2, open: 101, overdue: 0 } };
  await render();
  expect(host.querySelector("[data-testid=done-unlisted]")!.textContent).toMatch(/^1 finished item isn't listed here\./);

  // Everything finished is listed: no note.
  withItems([it_("o1"), it_("d1", { state: "done" })]);
  await render();
  expect(host.querySelector("[data-testid=done-unlisted]")).toBeNull();
});

it("keeps every control at the 44px touch target", async () => {
  withItems([it_("a"), it_("d", { state: "done" })]);
  await render();
  expect(host.querySelector("section")!.className).toContain("[&_button]:min-h-[44px]");
  for (const a of Array.from(host.querySelectorAll("a"))) expect(a.className).toMatch(/min-h-\[44px\]/);
});
