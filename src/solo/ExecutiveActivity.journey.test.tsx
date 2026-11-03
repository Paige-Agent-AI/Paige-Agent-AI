// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TEST_BUSINESS_REVIEW as SNAPSHOT } from "@/test/fixtures/business-review";
import { ExecutiveOverview } from "./ExecutiveOverview";

const h = vi.hoisted(() => ({ mode: "ready", sample: [] as unknown[], original: [] as unknown[], calls: [] as Record<string, unknown>[], review: vi.fn(), prompt: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async (name: string, args: Record<string, unknown>) => {
  if (name !== "get_solo_rail_activity") throw Error("Unexpected capability or write");
  h.calls.push({ ...args });
  if (h.mode === "forbidden") return { data: null, error: { code: "42501", message: "RAIL_FORBIDDEN" } };
  if (args.p_event_id === undefined) return { data: h.sample, error: null };
  return { data: h.mode === "mismatched" ? h.sample : h.original, error: null };
} } }));
vi.mock("./data/useBusinessReview", () => ({ useBusinessReview: h.review }));
vi.mock("./data/useSoloPendingActions", () => ({ useSoloPendingActions: () => ({ items: [], total: 0, loading: false, error: null, refresh: vi.fn() }) }));
vi.mock("./data/useBusinessGamePlanMissions", () => ({ useBusinessGamePlanMissions: () => ({ items: [], status: "ready", refresh: vi.fn() }) }));
vi.mock("./data/useBusinessTimeZone", async original => ({ ...await original<typeof import("./data/useBusinessTimeZone")>(),
  useBusinessCalendarDay: () => ({ day: { kind: "withheld", reason: "missing", canSet: true }, refresh: vi.fn() }) }));
vi.mock("@/lib/paigePromptHandoff", () => ({ handOffPaigePrompt: h.prompt }));
vi.mock("@/components/paige/live/PaigePresence", () => ({ PaigePresence: () => null }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const id = "11111111-1111-4111-8111-111111111111", receipt = "22222222-2222-4222-8222-222222222222";
const target = "33333333-3333-4333-8333-333333333333", play = "44444444-4444-4444-8444-444444444444";
const executive = "/solo/1234567/command-center/executive";
const address = `${executive}?review_period=last_30_days&activity_event=${id}`;
let root: Root, host: HTMLDivElement;
function Navigation() { const location = useLocation(), navigate = useNavigate(); return <>
  <output data-address>{location.pathname + location.search}</output><output data-state>{JSON.stringify(location.state)}</output>
  <button onClick={() => navigate(-1)}>Browser Back</button></>; }
async function mount(entry: string) { await act(async () => { root.render(<MemoryRouter initialEntries={[entry]}><Routes>
  <Route path="/solo/:account/command-center/executive" element={<ExecutiveOverview account="1234567" accountEpoch="test-tenant-a" actorId="test-owner-a" />} />
  <Route path="/solo/:account/command-center/business-game-plan" element={<h1>Original departmental record</h1>} />
  </Routes><Navigation /></MemoryRouter>); }); }
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  h.mode = "ready"; h.calls = []; h.prompt.mockClear(); h.review.mockReturnValue({ state: "ready", snapshot: structuredClone(SNAPSHOT), refresh: vi.fn() });
  const event = { id, title: "Original older target change", summary: "Original recorded summary", occurred_at: "2026-11-01T12:00:00Z", actor_type: "owner_staff" };
  h.sample = [{ ...event, id: target, title: "More recent unrelated event" }];
  h.original = [{ ...event, evidence: { version: 1, kind: "verified_original_result", rail_receipt_id: id,
    recorded_outcome: "capability_succeeded", business_result: { kind: "target_revision", receipt_id: receipt,
      target_id: target, revision: 2, state: "active", operation: "target_revise" },
    record_links: [{ destination: "business_game_plan", record_id: play }] } }]; });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const article = () => dialog()?.querySelector<HTMLElement>("article");
const route = () => host.querySelector("[data-address]")?.textContent;
async function openDepartment() { const source = article()!.querySelector<HTMLAnchorElement>("[data-activity-record-link]")!;
  source.focus(); await act(async () => { source.click(); }); }
async function back() { await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "Browser Back")!.click(); }); }

it("reloads an exact original event beyond the sample through the original hook", async () => {
  await mount(address); expect(article()?.querySelector("h3")?.textContent).toBe("Original older target change");
  expect(h.calls).toContainEqual({ p_limit: 1, p_event_id: id });
  expect(article()?.textContent).toContain(receipt);
  act(() => root.unmount()); root = createRoot(host);
  await mount(address); expect(article()?.querySelector("h3")?.textContent).toBe("Original older target change");
  expect(h.calls.filter(call => call.p_event_id === id)).toHaveLength(2);
  expect(h.prompt).not.toHaveBeenCalled();
});
it("returns from the original departmental record to fresh same-event readback and reading position", async () => {
  await mount(address);
  const list = dialog()!.querySelector<HTMLElement>("nav")!; list.scrollTop = 160; article()!.scrollTop = 240;
  await openDepartment(); expect(route()).toBe(`/solo/1234567/command-center/business-game-plan?play=${play}`);
  expect(host.querySelector("h1")?.textContent).toBe("Original departmental record");
  await back(); expect(route()).toBe(address);
  expect(article()?.querySelector("h3")?.textContent).toBe("Original older target change");
  expect(dialog()!.querySelector<HTMLElement>("nav")?.scrollTop).toBe(160); expect(article()?.scrollTop).toBe(240);
  expect(document.activeElement).toBe(article()?.querySelector("a"));
  expect(h.calls.filter(call => call.p_event_id === id)).toHaveLength(2); expect(h.prompt).not.toHaveBeenCalled();
});
it("returns to expanded original receipts before restoring a narrow reading position", async () => {
  // A real narrow pane clamps scrollTop when the collapsed receipt reduces its height.
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;
  const positions = new WeakMap<Element, number>();
  Object.defineProperty(Element.prototype, "scrollTop", { configurable: true,
    get() { return positions.get(this) ?? 0; },
    set(value: number) { positions.set(this, this.matches(".exec-activity-detail") && !this.querySelector("details")?.open
      ? Math.min(value, 200) : value); },
  });
  try {
    await mount(address);
    await act(async () => { article()!.querySelector("summary")!.click(); });
    expect(article()!.querySelector("details")!.open).toBe(true);
    article()!.scrollTop = 350;
    await openDepartment(); await back();
    expect(article()!.querySelector("details")!.open).toBe(true);
    expect(article()!.scrollTop).toBe(350);
    expect(document.activeElement).toBe(article()?.querySelector("a"));
    expect(article()?.textContent).toContain(receipt);
    expect(h.calls.filter(call => call.p_event_id === id)).toHaveLength(2);
    expect(h.prompt).not.toHaveBeenCalled();
  } finally { Object.defineProperty(Element.prototype, "scrollTop", descriptor); }
});
it("reauthorizes on return and withholds previously verified facts after refusal", async () => {
  await mount(address); await openDepartment(); h.mode = "forbidden"; await back();
  expect(dialog()?.textContent).toContain("not authorized"); expect(article()).toBeNull();
  expect(document.body.textContent).not.toContain("Original older target change");
  expect(document.body.textContent).not.toContain(receipt);
});
it.each([`${executive}?activity_event=invalid`, `${executive}?activity_event=${id}&activity_event=${target}`])("refuses an invalid or ambiguous locator without another lookup (%s)", async entry => {
  await mount(entry); expect(article()).toBeNull(); expect(h.calls).toEqual([{ p_limit: 25 }]);
  expect(dialog()?.textContent).toContain("could not be read or verified");
});
it("does not use a returned different event as exact readback", async () => {
  h.mode = "mismatched"; await mount(address); expect(article()).toBeNull();
  expect(dialog()?.textContent).toContain("could not be read or verified");
});
