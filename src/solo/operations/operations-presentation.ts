import type { PlanItem, PlanItemStatus } from "@/hooks/usePlanList";

export const workStatusLabel = (status: string) => ({ open: "Ready", in_progress: "In progress", blocked: "Blocked", done: "Completed", cancelled: "Cancelled" }[status] ?? status.replace(/_/g, " "));
export const workStages: { status: PlanItemStatus; label: string }[] = ["open", "in_progress", "blocked", "done", "cancelled"].map(status => ({ status: status as PlanItemStatus, label: workStatusLabel(status) }));
export const byDueDate = (a: PlanItem, b: PlanItem) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") || a.title.localeCompare(b.title);

/** A reminder's saved time is a schedule, separate from a task's deadline. */
export function workDateLabel(item: { item_type: string; due_at?: string | null; remind_at?: string | null }, detail = false) {
  const reminder = item.item_type === "reminder";
  const value = reminder ? item.remind_at : item.due_at;
  if (value === null) return reminder || detail ? "Not scheduled" : "No due date";
  if (!value || !Number.isFinite(Date.parse(value))) return "Date unavailable";
  const date = new Date(value);
  if (detail) return date.toLocaleString();
  return new Intl.DateTimeFormat(undefined, reminder
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" }).format(date);
}
