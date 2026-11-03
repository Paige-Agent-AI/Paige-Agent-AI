// Only references from the ORIGINAL admitted CRM read; never an address or a
// model-supplied identifier. Native staging must independently admit each Task.
import { readRecordLinks, type ReadRecordLink } from "../paige-turn/record-links.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

export function zionTaskRecordLinks(tool: string, result: unknown): ReadRecordLink[] {
  const data = object(result);
  const rows = tool === "crm_list_tasks" && data?.success === true && Array.isArray(data.tasks) ? data.tasks
    : tool === "crm_get_task" && data?.status === "available" && data.found === true ? [data.task] : [];
  return readRecordLinks(rows.flatMap(raw => {
    const id = object(raw)?.id;
    return typeof id === "string" && UUID.test(id) ? [{ destination: "operations_work", record_id: id }] : [];
  }));
}
