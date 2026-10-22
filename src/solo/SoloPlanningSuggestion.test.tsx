// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SoloPlanningSuggestion } from "./SoloPlanningSuggestion";
import { planningWorkRelevant } from "./planning-suggestion-context";
import type { SoloPendingActionsData } from "./data/useSoloPendingActions";
import type { PaigeBusinessPlanScope } from "./paigeClientScope";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const fixture = vi.hoisted(() => ({ data: null as SoloPendingActionsData | null, reads: vi.fn() }));
vi.mock("./data/useSoloPendingActions", () => ({ useSoloPendingActions: (tenant: string | null, actor: string | null) => { fixture.reads(tenant, actor); return fixture.data!; } }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
let host: HTMLDivElement, root: Root;
let props: React.ComponentProps<typeof SoloPlanningSuggestion>;
const plan: PaigeBusinessPlanScope = { tenantId: "test-tenant-plan", surface: "business_game_plan", businessMissionId: null, label: "Business Game Plan" };
beforeEach(() => {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); fixture.reads.mockClear();
  fixture.data = { total: 37, loading: false, error: null, refresh: vi.fn(), items: [
    { id: "test-work-a", title: "Review delivery scope", department: "Operations", summary: "Confirm the original handoff", draftContent: "Original delivery draft", rationale: "Owner review required", createdAt: "2026-01-01" },
    { id: "test-work-b", title: "Review commercial terms", department: "Sales", summary: "Original commercial summary", draftContent: null, rationale: null, createdAt: "2026-01-02" },
  ] };
  props = { api: { threadId: null, ready: true, busy: false, hasOwnerMessages: false, restoreLayout: vi.fn(), focusComposer: vi.fn() }, tenantId: "test-tenant-plan", actorId: "test-actor-a", relevant: true, active: true, plan: null, onClearContext: vi.fn(), sidePanel: true };
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function render() { act(() => root.render(<SoloPlanningSuggestion key={JSON.stringify([props.tenantId, props.actorId])} {...props} />)); }
function click(selector: string) { const button = document.querySelector<HTMLButtonElement>(selector)!; expect(button).toBeTruthy(); act(() => button.click()); }
function open() { click(".e2ps-chip"); }
it("uses the original actor/tenant read, separates actual count from preview and opens the same Desk source", () => {
  render(); expect(fixture.reads).toHaveBeenLastCalledWith("test-tenant-plan", "test-actor-a");
  expect(host.textContent).toContain("37 items to review"); open();
  expect(fixture.data!.refresh).toHaveBeenCalledOnce();
  expect(document.querySelector(".e2ps-count")?.textContent).toContain("37 prepared items · 2 loaded for preview");
  click(".e2ps-item:nth-of-type(2)");
  const article = document.querySelector('.pwr-document')!;
  expect(article.textContent).toContain("Review commercial terms");
  expect(article.textContent).toContain("No readable draft text");
  expect(document.querySelector('.pwr-prose')).toBeNull();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(document.body.textContent).not.toContain("Original delivery draft");
  expect(document.body.textContent).toContain("cannot be edited, approved or executed here");
});
it("keeps unchanged and reordered work dismissed, then resurfaces a genuinely new item at the same count", () => {
  render(); click('[aria-label="Dismiss prepared-work suggestion"]');
  expect(host.querySelector('.e2ps-chip')).toBeNull(); expect(props.api.focusComposer).toHaveBeenCalledOnce();
  fixture.data = { ...fixture.data!, items: [...fixture.data!.items].reverse() }; render();
  expect(host.querySelector('.e2ps-chip')).toBeNull();
  fixture.data = { ...fixture.data!, items: [{ ...fixture.data!.items[0], id: "test-work-new" }] }; render();
  expect(host.textContent).toContain("37 items to review");
});
it("resurfaces changed source content and restores dismissal eligibility only in a new mounted context", () => {
  render(); click('[aria-label="Dismiss prepared-work suggestion"]');
  fixture.data = { ...fixture.data!, items: [{ ...fixture.data!.items[0], draftContent: "Actually revised draft" }] }; render();
  expect(host.querySelector('.e2ps-chip')).not.toBeNull();
  click('[aria-label="Dismiss prepared-work suggestion"]');
  props = { ...props, actorId: "test-actor-b" }; render();
  expect(host.querySelector('.e2ps-chip')).not.toBeNull();
  expect(fixture.reads).toHaveBeenLastCalledWith("test-tenant-plan", "test-actor-b");
});
it("does not revive dismissed work when the same conversation acquires its canonical thread ID", () => {
  render(); click('[aria-label="Dismiss prepared-work suggestion"]');
  props.api = { ...props.api, threadId: "test-adopted-thread" }; render();
  expect(host.querySelector('.e2ps-chip')).toBeNull();
  expect(fixture.reads).toHaveBeenLastCalledWith("test-tenant-plan", "test-actor-a");
});
it("withholds stale counts/content on a failed or loading reread and retry only rereads", () => {
  render(); open(); fixture.data = { ...fixture.data!, error: "permission denied" }; render();
  expect(document.body.textContent).not.toContain("37 prepared items");
  expect(document.body.textContent).not.toContain("Review delivery scope");
  expect(document.body.textContent).toContain("Previous details and counts are withheld");
  click('.e2ps-state button'); expect(fixture.data!.refresh).toHaveBeenCalledTimes(2);
  fixture.data = { ...fixture.data!, error: null, loading: true }; render();
  expect(document.body.textContent).toContain("Checking the original work");
  expect(host.textContent).not.toContain("37");
});
it("keeps empty work quiet and never substitutes the preview length for an unavailable total", () => {
  fixture.data = { ...fixture.data!, items: [], total: 0 }; render(); expect(host.textContent).toBe("");
  fixture.data = { ...fixture.data!, items: [{ id: "test-work-count", title: "Original source", department: "Operations", summary: null, rationale: null, draftContent: null, createdAt: "" }], total: null }; render();
  expect(host.textContent).toContain("Prepared work"); expect(host.textContent).not.toContain("1 item"); open();
  expect(document.querySelector('.e2ps-count')?.textContent).toContain("Total unavailable · 1 loaded for preview");
});
it.each(["actor", "tenant", "irrelevant", "hidden", "hydrating"])("withholds source work while %s is unresolved or ineligible", condition => {
  if (condition === "actor") props.actorId = null;
  if (condition === "tenant") props.tenantId = null;
  if (condition === "irrelevant") props.relevant = false;
  if (condition === "hidden") props.active = false;
  if (condition === "hydrating") props.api.ready = false;
  render(); expect(host.textContent).toBe(""); expect(fixture.reads).toHaveBeenLastCalledWith(null, props.actorId);
});
it("retains a clearable explicit plan context even without pending work, and does not clear it on dismissal", () => {
  props.plan = plan; render(); click('[aria-label="Dismiss prepared-work suggestion"]');
  expect(props.onClearContext).not.toHaveBeenCalled(); expect(host.textContent).toBe("Business Game Plan");
  click('.e2ps-scope'); expect(props.onClearContext).toHaveBeenCalledOnce();
});
it("keeps explicit planning context and its clear action inside the overview while actual work is suggested", () => {
  props.plan = plan; render(); expect(host.querySelector('.e2ps-scope')).toBeNull();
  open(); expect(document.querySelector('.e2ps-context')?.textContent).toContain("Business Game Plan");
  click('.e2ps-context button'); expect(props.onClearContext).toHaveBeenCalledOnce();
});
it("rereads on window return without installing a polling scheduler and retires that listener on leaving context", () => {
  render(); act(() => window.dispatchEvent(new Event("focus"))); expect(fixture.data!.refresh).toHaveBeenCalledOnce();
  props.relevant = false; render(); act(() => window.dispatchEvent(new Event("focus"))); expect(fixture.data!.refresh).toHaveBeenCalledOnce();
});
it("retires an open source portal when the original Chat workspace is hidden", () => {
  render(); open(); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  props.active = false; render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).toBe("");
  expect(fixture.reads).toHaveBeenLastCalledWith(null, "test-actor-a");
});
it("allows a fresh plan-page conversation or explicit generic scope, while withholding unrelated, Mission and other scope work", () => {
  const base = { otherScope: false, plan: null, onPlanPage: true, threadId: null, hasOwnerMessages: false };
  expect(planningWorkRelevant(base)).toBe(true);
  expect(planningWorkRelevant({ ...base, threadId: "test-unrelated-thread" })).toBe(false);
  expect(planningWorkRelevant({ ...base, hasOwnerMessages: true })).toBe(false);
  expect(planningWorkRelevant({ ...base, onPlanPage: false })).toBe(false);
  expect(planningWorkRelevant({ ...base, onPlanPage: false, plan })).toBe(true);
  expect(planningWorkRelevant({ ...base, plan: { ...plan, businessMissionId: "test-mission" } })).toBe(false);
  expect(planningWorkRelevant({ ...base, otherScope: true, plan })).toBe(false);
});
