export type ActorFilter = "all" | "paige" | "people" | "unattributed";
export type ActivityReturn = { eventId: string; filter: ActorFilter; listScroll: number; detailScroll: number; receiptsOpen?: boolean };

/** Display bookmark inside the ORIGINAL Executive return contract; no business facts or authority. */
export function readActivityReturn(value: unknown): ActivityReturn | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as ActivityReturn;
  return typeof v.eventId === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v.eventId)
    && ["all", "paige", "people", "unattributed"].includes(v.filter)
    && (v.receiptsOpen === undefined || typeof v.receiptsOpen === "boolean")
    && [v.listScroll, v.detailScroll].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 10_000_000) ? v : null;
}
