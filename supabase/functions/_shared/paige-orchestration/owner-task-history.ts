// Original owner.task observation. No dispatch, approval, reconciliation or
// receipt writer is available through these ports. Not a callable endpoint.
import { ACT_OUTCOMES } from './outcomes.ts';
type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };
interface Query {
  eq(column: string, value: unknown): Query;
  maybeSingle(): PromiseLike<Result>;
}
interface Reads { from(table: string): { select(columns: string): Query }; rpc(name: string, args?: Row): PromiseLike<Result> }
export interface OwnerTaskHistoryClients {
  /** Must carry the original request JWT, never the service key. */
  caller: Reads & { auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> } };
  /** Server-only. Existing native reader retains its service/null-actor gate. */
  service: Reads;
}
type OriginalTask = { state: 'unconfirmed' } | { state: 'verified'; taskId: string; receiptId: string; runId: string };
export type OwnerTaskHistory = { status: 'refused' | 'unavailable' } | {
  status: 'ready'; approvalId: string; occurrenceId: string; processId: string;
  approvalStatus: string; recordedOutcome: string; decidedAt: string; title: string;
  originalTask: OriginalTask; currentTask: { state: 'not_read' };
};
const obj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const instant = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => obj(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const APPROVAL_COLUMNS = 'id,tenant_id,source,category,type,status,updated_at,metadata';
const OCCURRENCE_COLUMNS = 'id,tenant_id,event_id,act_id,automation_id,adapter_kind,capability_key,effective_lane,outcome,correlation_ref,idempotency_key,decided_at,updated_at,detail';
const OUTCOMES = new Set<string>(ACT_OUTCOMES);
class Refused extends Error {}

/** Exact original approval is the only locator; actor, occurrence, args and
 * correlation are derived from canonical records. Caller tenant is refusal-only.
 * History never restores a decision button or grants replay authority. */
export async function readOwnerTaskHistory(request: { approvalId: string; tenantId: string }, clients: OwnerTaskHistoryClients,
  signal?: AbortSignal): Promise<OwnerTaskHistory> {
  const { approvalId, tenantId } = request; // Freeze before the first await.
  if (!uuid(approvalId) || !uuid(tenantId)) return { status: 'refused' };
  const expires = performance.now() + 8_000;
  const check = () => { if (signal?.aborted || performance.now() >= expires) throw Error('read_unavailable'); };
  // One total budget. A late reply cannot resume this reader or start another
  // private lookup after timeout/cancellation. No pending effect exists to retry.
  const wait = async <T>(start: () => PromiseLike<T>): Promise<T> => {
    check();
    return await new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(); } };
      const abort = () => finish(() => reject(Error('read_unavailable')));
      const timer = setTimeout(abort, Math.max(0, expires - performance.now()));
      signal?.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => { check(); return start(); }).then(value => {
        try { check(); finish(() => resolve(value)); } catch { abort(); }
      }, () => abort());
    });
  };
  let actorId = '';
  const authority = async () => {
    const auth = await wait(() => clients.caller.auth.getUser());
    if (auth.error || !uuid(auth.data.user?.id) || actorId && auth.data.user.id !== actorId) throw new Refused();
    actorId = auth.data.user.id;
    const tenant = await wait(() => clients.caller.rpc('current_user_tenant_id'));
    if (tenant.error || tenant.data !== tenantId) throw new Refused();
    // Existing closed predicate verifies live owner/admin seat, selected profile,
    // Auth state, sealed native occurrence, exact unique approval and domain.
    const allowed = await wait(() => clients.caller.rpc('can_read_owner_task_approval', { _approval_id: approvalId }));
    if (allowed.error || allowed.data !== true) throw new Refused();
  };
  const approvalRead = () => clients.caller.from('paige_approval_queue_v').select(APPROVAL_COLUMNS).eq('id', approvalId).eq('tenant_id', tenantId).maybeSingle();
  try {
    await authority();
    const a = await wait(approvalRead); await authority();
    if (a.error || !obj(a.data)) return { status: 'unavailable' };
    const approval = a.data, meta = approval.metadata;
    if (approval.id !== approvalId || approval.tenant_id !== tenantId || approval.source !== 'paige_orchestration'
      || approval.category !== 'owner.task' || approval.type !== 'other' || !['pending', 'approved', 'rejected'].includes(String(approval.status))
      || !instant(approval.updated_at) || !obj(meta) || meta.source !== 'paige_orchestration' || meta.capability_id !== 'owner.task'
      || 'action_id' in meta || 'governed_send' in meta || ![meta.act_execution_id, meta.event_id, meta.act_id, meta.automation_id].every(uuid)) return { status: 'unavailable' };
    const occurrenceRead = () => clients.service.from('paige_act_executions').select(OCCURRENCE_COLUMNS)
      .eq('id', meta.act_execution_id).eq('tenant_id', tenantId).maybeSingle();
    const l = await wait(occurrenceRead); await authority();
    if (l.error || !obj(l.data)) return { status: 'unavailable' };
    const row = l.data, detail = row.detail;
    if (row.id !== meta.act_execution_id || row.tenant_id !== tenantId || row.event_id !== meta.event_id || row.act_id !== meta.act_id
      || row.automation_id !== meta.automation_id || row.adapter_kind !== 'native' || row.capability_key !== 'owner.task'
      || row.effective_lane !== 'confirm' || !OUTCOMES.has(String(row.outcome)) || !uuid(row.correlation_ref)
      || row.idempotency_key !== row.correlation_ref || !instant(row.decided_at) || !instant(row.updated_at)
      || !obj(detail) || !obj(detail.owner_task_source) || detail.owner_task_source.v !== 1 || !obj(detail.owner_task_approval)
      || !obj(detail.snapshot_args) || typeof detail.snapshot_args.title !== 'string' || !detail.snapshot_args.title.trim()
      || [...detail.snapshot_args.title].length > 500) return { status: 'unavailable' };
    const result: OwnerTaskHistory = { status: 'ready', approvalId, occurrenceId: row.id as string, processId: row.automation_id as string,
      approvalStatus: approval.status as string, recordedOutcome: row.outcome as string, decidedAt: row.decided_at,
      title: detail.snapshot_args.title.trim(), originalTask: { state: 'unconfirmed' }, currentTask: { state: 'not_read' } };
    // Even 'executed' is only the recorded orchestration state until the native
    // result AND its own receipt are independently read. No optional task locator.
    if (approval.status === 'approved' && uuid(detail.approved_by) && instant(detail.approved_at)) {
      let native: Result;
      try { native = await wait(() => clients.service.rpc('read_owner_task_act', { _event_id: row.event_id, _act_id: row.act_id, _correlation: row.correlation_ref })); }
      catch { native = { data: null, error: true }; }
      await authority();
      const n = native.data, r = obj(n) && obj(n.result) ? n.result : null, task = r && obj(r.readback) ? r.readback : null;
      if (!native.error && obj(n) && n.state === 'found' && n.actor_id === detail.approved_by && r && task && r.ok === true
        && r.action === 'task.create' && r.outcome === 'succeeded' && r.receipt_recorded === true && uuid(r.correlation_id) && uuid(task.id)
        && task.assignee_user_id === n.actor_id && task.title === result.title
        && task.description === (typeof detail.snapshot_args.description === 'string' ? detail.snapshot_args.description.trim() || null : null)
        && task.external_effect === false && task.notification_sent === false) {
        const receipt = await wait(() => clients.service.from('paige_workspace_events')
          .select('id,tenant_id,actor_id,source_kind,source_id,source_revision,capability_key,outcome,occurred_at,detail')
          .eq('tenant_id', tenantId).eq('actor_id', n.actor_id).eq('source_kind', 'capability_run').eq('source_id', r.correlation_id)
          .eq('source_revision', 0).eq('capability_key', 'crm_create_task').eq('outcome', 'capability_succeeded').maybeSingle())
          .catch((): Result => ({ data: null, error: true }));
        await authority();
        const rail = receipt.data;
        if (!receipt.error && obj(rail) && uuid(rail.id) && rail.tenant_id === tenantId && rail.actor_id === n.actor_id
          && rail.source_kind === 'capability_run' && rail.source_id === r.correlation_id && rail.source_revision === 0
          && rail.capability_key === 'crm_create_task' && rail.outcome === 'capability_succeeded' && instant(rail.occurred_at)
          && obj(rail.detail) && rail.detail.action === 'task.create' && rail.detail.record_kind === 'task' && rail.detail.record_id === task.id) {
          result.originalTask = { state: 'verified', taskId: task.id, receiptId: rail.id, runId: r.correlation_id };
          // This is a historical locator, never current Task data. The existing
          // native Task inspector/readOperationsTask owns the later current read.
        }
      }
    }
    // A changed decision/occurrence is not assembled into a mixed-version result.
    const lastA = await wait(approvalRead); await authority();
    const lastL = await wait(occurrenceRead); await authority();
    if (lastA.error || lastL.error || canonical(lastA.data) !== canonical(approval) || canonical(lastL.data) !== canonical(row)) return { status: 'unavailable' };
    check(); return result;
  } catch (error) { return { status: error instanceof Refused ? 'refused' : 'unavailable' }; }
}
