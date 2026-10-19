import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Plan, PlanItem } from "@/hooks/usePlanList";
import { OperationsProjects } from "./OperationsProjects";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("flags unfinished work on a closed project without rewriting its source status", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const plan = { id: "synthetic-plan", title: "Illustrative project", status: "completed", summary: null,
    owner_user_id: null, starts_on: null, ends_on: null,
    items: [{ id: "synthetic-work", status: "open", item_type: "task", due_at: null }] } as Plan;
  try {
    act(() => root.render(<OperationsProjects plans={[plan]} members={[]} onInspectItem={vi.fn()} onInspectPlan={vi.fn()} />));
    expect(container.textContent).toContain("Recorded completed, with unfinished work. Review the project status.");
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("0");
    expect(plan.status).toBe("completed");
    plan.items[0].status = "done";
    act(() => root.render(<OperationsProjects plans={[plan]} members={[]} onInspectItem={vi.fn()} onInspectPlan={vi.fn()} />));
    expect(container.textContent).not.toContain("with unfinished work");
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("1");
  } finally { act(() => root.unmount()); }
});

it("counts only genuine task deadlines as overdue, preserving a reminder's distinct saved schedule", () => {
  const container = document.createElement("div"); const root = createRoot(container);
  const reminder = { id:"original-reminder", title:"Review unfinished work", status:"open", item_type:"reminder",
    due_at:"2000-01-01T12:00:00Z", remind_at:"2099-01-01T12:00:00Z" } as PlanItem;
  const task = { id:"original-task", title:"Confirm the client brief", status:"open", item_type:"task", due_at:"2000-01-01T12:00:00Z" } as PlanItem;
  const plan = { id:"original-project", title:"Client onboarding", status:"active", summary:null,
    owner_user_id:null, starts_on:null, ends_on:null, items:[reminder,task] } as Plan;
  try {
    act(() => root.render(<OperationsProjects plans={[plan]} members={[]} onInspectItem={vi.fn()} onInspectPlan={vi.fn()} />));
    expect(container.querySelector(".ops-project-attention")?.textContent).toContain("1 overdue item");
    expect(container.querySelector(".ops-project-attention")?.textContent).not.toContain("2 overdue items");
    expect(reminder.due_at).toBe("2000-01-01T12:00:00Z");
    expect(reminder.remind_at).toBe("2099-01-01T12:00:00Z");
    task.status = "done";
    act(() => root.render(<OperationsProjects plans={[plan]} members={[]} onInspectItem={vi.fn()} onInspectPlan={vi.fn()} />));
    expect(container.querySelector(".ops-project-attention")).toBeNull();
    expect(container.textContent).not.toContain("Overdue work");
  } finally { act(() => root.unmount()); }
});

it.each(["2099-01-02T00:30:00+14:00", "2099-01-02T23:30:00-12:00"])("shows the original milestone instant in local time while preserving date-only project windows (%s)", dueAt => {
  const container = document.createElement("div"); const root = createRoot(container); const inspect = vi.fn();
  const item = { id:"original-milestone", title:"Share the agreed next steps", status:"open", item_type:"milestone", due_at:dueAt } as PlanItem;
  const plan = { id:"original-project", title:"Client onboarding", status:"active", summary:null,
    owner_user_id:null, starts_on:"2099-01-02", ends_on:"2099-01-02", items:[item] } as Plan;
  const expected = new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(new Date(dueAt));
  const civilDate = new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(new Date("2099-01-02T12:00:00"));
  try {
    act(() => root.render(<OperationsProjects plans={[plan]} members={[]} onInspectItem={inspect} onInspectPlan={vi.fn()} />));
    expect(container.querySelector(".ops-project-milestones small")?.textContent).toBe(`${expected} · Ready`);
    expect(container.querySelector(".ops-project-readback")?.textContent).toContain(`${civilDate} — ${civilDate}`);
    act(() => container.querySelector<HTMLButtonElement>(".ops-project-milestones button")!.click());
    expect(inspect).toHaveBeenCalledWith(item);
    expect(item.due_at).toBe(dueAt);
  } finally { act(() => root.unmount()); }
});
