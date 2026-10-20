export type OperationsTaskFocus = { kind: "task"; id: string } | { kind: "invalid" } | null;

/** A Task URL is an address only; Planning and CRM identities never overlap. */
export function parseOperationsTaskFocus(search: string): OperationsTaskFocus {
  const query = new URLSearchParams(search);
  if (!query.has("task")) return null;
  const ids = query.getAll("task");
  if (ids.length !== 1 || query.has("weeklySource") || query.has("item") ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ids[0])) return { kind: "invalid" };
  return { kind: "task", id: ids[0].toLowerCase() };
}
