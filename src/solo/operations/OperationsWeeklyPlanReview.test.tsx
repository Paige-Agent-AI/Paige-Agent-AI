import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { OperationsWeeklyPlanReview } from "./OperationsWeeklyPlanReview";
import { operationsWeek } from "./operations-week";
import type { CrmWorkRecord } from "./operations-native-work";
import type { TeamMemberRecord } from "../team-workspace-contract";
const f = vi.hoisted(() => ({ save: vi.fn(), retained: false }));
vi.mock("./operations-weekly-plan-save", async original => ({ ...await original<typeof import("./operations-weekly-plan-save")>(),
  retainedWeeklyPlanAttempt: () => f.retained ? "e5020000-0000-4000-8000-000000000009" : null,
  releaseWeeklyPlanAttempt: vi.fn(), saveWeeklyPlanReview: (...args: unknown[]) => f.save(...args) }));
const id = (n: number) => `e5020000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1), actor = id(2);
const task = { id: id(3), tenant_id: tenant, user_id: actor, title: "Prepare original client review", status: "pending", due_date: "2026-11-04T15:00:00Z", estimated_minutes: 90, updated_at: "2026-11-03T12:00:00Z", recorded_priority: "normal" } as CrmWorkRecord;
const member = { user_id: actor, membership_id: id(4), status: "active", permission: "owner", is_owner: true, full_name: "Morgan Reed" } as TeamMemberRecord;
const week = operationsWeek(tenant, [], [task], { kind: "configured", zone: "America/New_York", date: "2026-11-03" });
if (week.kind !== "ready") throw Error("Expected original civil week");
let root: Root, host: HTMLDivElement;
const guard = vi.fn(), saved = vi.fn();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); f.save.mockReset(); f.retained = false; guard.mockClear(); saved.mockClear(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const mount = async () => { await act(async () => root.render(<OperationsWeeklyPlanReview actorId={actor} tenantId={tenant} week={week as Extract<typeof week, {kind:"ready"}>} items={[]} tasks={[task]} members={[member]} onGuardChange={guard} onSaved={saved} openByLink />)); };
const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text)!;
const change = async (node: HTMLInputElement | HTMLTextAreaElement, value: string) => { await act(async () => { const type = node.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(type.prototype,"value")!.set!.call(node,value); node.dispatchEvent(new Event("input", {bubbles:true})); }); };
const prepare = async () => { await mount(); await change(host.querySelector("textarea")!, "Finish the confirmed client review"); await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); };
it("requires genuine selected work, confirmed goal/capacity and a feasible review before Save", async () => {
  await prepare(); expect(button("Save this reviewed plan").disabled).toBe(true);
  expect(host.textContent).toContain("Confirm this person's net available hours");
  await change(host.querySelector('input[step="0.25"]')!, "1");
  expect(host.textContent).toContain("exceeds this person's entered budget"); expect(button("Save this reviewed plan").disabled).toBe(true);
  await change(host.querySelector('input[aria-label^="Remaining minutes"]')!, "45");
  expect(button("Save this reviewed plan").disabled).toBe(false); expect(f.save).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Owner-confirmed proposal estimate");
  expect(guard.mock.calls.at(-1)?.[0]()).toContain("Finish or decline");
});
it("saves only the reviewed references and opens only the verified original Plan", async () => {
  await prepare(); await change(host.querySelector('input[step="0.25"]')!, "2");
  f.save.mockResolvedValue({ kind: "verified", planId: id(8), receiptId: id(7), requestId: id(9), workId: id(10) });
  await act(async () => button("Save this reviewed plan").click());
  expect(f.save).toHaveBeenCalledTimes(1); expect(f.save.mock.calls[0][1].included).toEqual([`crm:${task.id}`]);
  expect(host.textContent).toContain("Weekly plan saved and verified"); expect(saved).not.toHaveBeenCalled();
  await act(async () => button("Open saved plan and receipt").click()); expect(saved).toHaveBeenCalledWith(id(8));
});
it("reopened unknown save permits only original-result inspection and never another write", async () => {
  f.retained = true; await mount(); expect(button("Save this reviewed plan")).toBeUndefined();
  f.save.mockResolvedValue({ kind: "uncertain", message: "Result remains unknown" });
  await act(async () => button("Check the same save").click());
  expect(f.save.mock.calls[0][1]).toBeNull(); expect(host.textContent).not.toContain("saved and verified");
  expect(button("Decline review").disabled).toBe(true);
});
it("declining an unsaved review clears its navigation hold and writes nothing", async () => {
  await prepare(); await act(async () => button("Decline review").click());
  expect(host.querySelector("textarea")!.value).toBe(""); expect(guard.mock.calls.at(-1)?.[0]()).toBeNull(); expect(f.save).not.toHaveBeenCalled();
});
