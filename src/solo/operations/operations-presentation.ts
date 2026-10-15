import type { PlanItem, PlanItemStatus } from "@/hooks/usePlanList";

export const workStatusLabel = (status: string) => ({ open: "Ready", in_progress: "In progress", blocked: "Blocked", done: "Completed", cancelled: "Cancelled" }[status] ?? status.replace(/_/g, " "));
export const workStages: { status: PlanItemStatus; label: string }[] = ["open", "in_progress", "blocked", "done", "cancelled"].map(status => ({ status: status as PlanItemStatus, label: workStatusLabel(status) }));
export const byDueDate = (a: PlanItem, b: PlanItem) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") || a.title.localeCompare(b.title);
