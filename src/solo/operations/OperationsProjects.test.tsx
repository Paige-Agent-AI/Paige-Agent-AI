import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Plan } from "@/hooks/usePlanList";
import { OperationsProjects } from "./OperationsProjects";

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
