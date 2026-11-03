// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExecutiveActivity } from "./ExecutiveActivity";
import type { SoloActivityFeed, SoloActivityInspection, SoloActivityItem } from "./data/useSoloActivityFeed";
import { readActivityEvidence } from "../../supabase/functions/_shared/paige-context/activity-evidence";
import type { ActivityReturn } from "./executive-activity-return";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const id = "11111111-1111-4111-8111-111111111111", receipt = "22222222-2222-4222-8222-222222222222";
const target = "33333333-3333-4333-8333-333333333333", play = "44444444-4444-4444-8444-444444444444";
const item: SoloActivityItem = { id, title: "Original target change", summary: "Original recorded summary", byPaige: false,
  byPerson: true, actorAgent: null, departmentSlug: "executive_office", occurredAt: "2026-11-01T12:00:00Z" };
const verified = () => readActivityEvidence({ version: 1, kind: "verified_original_result", rail_receipt_id: id,
  recorded_outcome: "capability_succeeded", business_result: { kind: "target_revision", receipt_id: receipt,
    target_id: target, revision: 2, state: "active", operation: "target_revise" },
  record_links: [{ destination: "business_game_plan", record_id: play }] }, id);
let root: Root, host: HTMLDivElement, feed: SoloActivityFeed;
const change = vi.fn();
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); change.mockClear();
  feed = { items: [{ ...item, id: target, title: "More recent different event" }], loading: false, status: "ready", error: null,
    refresh: vi.fn(), inspection: { eventId: id, status: "ready", item, evidence: verified() } }; });
afterEach(() => { act(() => root.unmount()); host.remove(); });
function render(restore?: ActivityReturn, account: string | null = "1234567") {
  act(() => root.render(<MemoryRouter><ExecutiveActivity feed={feed} timezone="UTC" account={account}
    selection={{ eventId: id, onChange: change }} restore={restore} /></MemoryRouter>));
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const article = () => dialog().querySelector<HTMLElement>("article");

it("opens the exact older original result and original domain receipt, not the newer sample", () => {
  render();
  expect(article()?.querySelector("h3")?.textContent).toBe("Original target change");
  expect(article()?.textContent).toContain("Original target change verified");
  expect(article()?.textContent).toContain("business target was achieved");
  expect(article()?.querySelector(".exec-activity-figures dd")?.textContent).toBe("2");
  expect(article()?.querySelector("a")?.getAttribute("href")).toBe(`/solo/1234567/command-center/business-game-plan?play=${play}`);
  expect(article()?.textContent).toContain(receipt);
  expect(article()?.textContent).toContain(id);
  expect([...dialog().querySelectorAll("button")].some(b => /^(Approve|Execute|Send)$/.test(b.textContent ?? ""))).toBe(false);
});
it("does not provide a record destination without a current account", () => {
  render(undefined, null); expect(article()?.querySelector("a")).toBeNull();
  expect(article()?.textContent).toContain("unavailable in this workspace");
});
it("keeps a recorded read receipt distinct from verified business completion", () => {
  feed.inspection!.evidence = readActivityEvidence({ version: 1, kind: "recorded_outcome", rail_receipt_id: id,
    recorded_outcome: "capability_succeeded", business_result: null, record_links: [] }, id);
  render(); expect(article()?.textContent).toContain("underlying business completion are not verified");
  expect(article()?.querySelector(".exec-activity-verified,a")).toBeNull();
});
it.each(["loading", "not_found", "unavailable", "forbidden"] as const)("withholds the original result during %s without selecting a different event", status => {
  feed.inspection = { eventId: id, status, item: null, evidence: { state: "not_provided" } };
  render(); expect(article()).toBeNull(); expect(dialog().querySelector("[data-activity-record-link]")).toBeNull();
  if (status !== "loading") expect(dialog().textContent).toContain("Retry original read");
});
it("withholds an inconsistent original identity even if a consumer supplies ready", () => {
  feed.inspection!.item = { ...item, id: target }; render(); expect(article()).toBeNull();
});
it("restores the original reading panes and source-link focus after original readback", () => {
  render({ eventId: id, filter: "people", listScroll: 160, detailScroll: 240 });
  expect(dialog().querySelector("select")?.value).toBe("people");
  expect(dialog().querySelector<HTMLElement>("nav")?.scrollTop).toBe(160);
  expect(article()?.scrollTop).toBe(240);
  expect(document.activeElement).toBe(article()?.querySelector("a"));
});
it("respects newer keyboard interaction while the original read is pending", () => {
  const restore: ActivityReturn = { eventId: id, filter: "all", listScroll: 160, detailScroll: 240 };
  feed.inspection = { eventId: id, status: "loading", item: null, evidence: { state: "not_provided" } };
  render(restore); const select = dialog().querySelector("select")!;
  act(() => { select.focus(); select.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
  feed.inspection = { eventId: id, status: "ready", item, evidence: verified() } satisfies SoloActivityInspection;
  render(restore); expect(document.activeElement).toBe(select); expect(article()?.scrollTop).toBe(0);
});
