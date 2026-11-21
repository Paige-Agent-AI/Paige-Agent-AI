import { createWeeklyDraftDeadline } from "./weekly-draft-deadline.ts";

type Caller = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
type Draft = { name: string; category?: string; trigger_key: string;
  steps: Array<{ action_kind?: string; tool_key?: string; config?: Record<string, unknown> }> };
type Scope = { actorId: string; tenantId: string; requestId: string };
type Options = Scope & { draft: Draft; current(): boolean; signal: AbortSignal; remainingMs: number };
export type AutomationDraftSaveResult =
  | { status: "saved"; automationId: string; receiptId: string; requestId: string; steps: number; recovered: boolean }
  | { status: "observed"; requestId: string; phase: "changed" | "saved_unreceipted" }
  | { status: "refused"; reason: "name_conflict" | "trigger_unavailable" | "not_applied" }
  | { status: "unavailable" | "unknown" };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Original process writer port only. The surface supplies its server-bound
 * identity AFTER its existing Trust/Harness gate. This module grants no approval,
 * activates no process and never repeats a sent save after uncertainty. */
export async function saveAutomationDraft(caller: Caller, options: Options): Promise<AutomationDraftSaveResult> {
  let attempted = false;
  const uncertain = (): AutomationDraftSaveResult => ({ status: attempted ? "unknown" : "unavailable" });
  try {
    if (!options || !uuid(options.actorId) || !uuid(options.tenantId) || !uuid(options.requestId)
      || !options.signal || typeof options.current !== "function" || typeof caller?.rpc !== "function"
      || !Number.isFinite(options.remainingMs) || options.remainingMs <= 0 || options.remainingMs > 12000) return uncertain();
    // Freeze inputs before any await. The model cannot replace scope, request
    // identity, enabled state or grant fields while a read/save is in flight.
    const scope: Scope = { actorId: options.actorId.toLowerCase(), tenantId: options.tenantId.toLowerCase(), requestId: options.requestId.toLowerCase() };
    const draft = JSON.parse(JSON.stringify(options.draft));
    if (!object(draft) || JSON.stringify(draft).length > 32768) return uncertain();
    const { signal, current, remainingMs } = options;
    const active = () => { try { return !signal.aborted && current() === true; } catch { return false; } };
    if (!active()) return uncertain();
    const stage = createWeeklyDraftDeadline(remainingMs, active);
    const project = (raw: unknown, recovered: boolean): AutomationDraftSaveResult => {
      if (!active() || !object(raw) || raw.request_id !== scope.requestId) return uncertain();
      if (raw.phase === "absent") return uncertain();
      if (raw.tenant_id !== scope.tenantId || raw.actor_id !== scope.actorId || raw.automation_id !== scope.requestId) return uncertain();
      if (raw.phase === "changed" || raw.phase === "saved_unreceipted")
        return { status: "observed", requestId: scope.requestId, phase: raw.phase };
      if (raw.phase !== "saved" || !uuid(raw.receipt_id) || raw.state !== "draft" || raw.granted_lane !== "confirm"
        || raw.execution_started !== false || !Array.isArray(draft.steps) || raw.steps !== draft.steps.length
        || typeof raw.updated_at !== "string" || !Number.isFinite(Date.parse(raw.updated_at))) return uncertain();
      return { status: "saved", automationId: scope.requestId, requestId: scope.requestId,
        receiptId: raw.receipt_id, steps: raw.steps as number, recovered };
    };
    const recover = async (): Promise<AutomationDraftSaveResult> => {
      if (!active()) return uncertain();
      try {
        const read = await stage(() => caller.rpc("read_automation_draft", {
          _request_id: scope.requestId, _expected_tenant_id: scope.tenantId, _expected_draft: draft,
        }));
        return read?.error === null ? project(read.data, true) : uncertain();
      } catch { return uncertain(); }
    };
    try {
      const saved = await stage(() => {
        attempted = true;
        return caller.rpc("save_automation_draft", { _request_id: scope.requestId, _expected_tenant_id: scope.tenantId, _draft: draft });
      });
      if (!active()) return uncertain();
      if (saved?.error === null) {
        const result = project(saved.data, false);
        return result.status === "unknown" ? await recover() : result;
      }
      // These are definite single-transaction SQL refusals. A transport error,
      // malformed answer or loss of acknowledgment is never proof of rollback.
      const code = object(saved?.error) ? saved.error.code : null;
      if (typeof code === "string" && ["22023", "23503", "23505", "23514", "42501", "40001", "55P03"].includes(code))
        return { status: "refused", reason: code === "23505" ? "name_conflict"
          : object(saved.error) && saved.error.message === "AUTOMATION_DRAFT_TRIGGER_UNAVAILABLE" ? "trigger_unavailable" : "not_applied" };
      return await recover();
    } catch { return await recover(); }
  } catch { return uncertain(); }
}
