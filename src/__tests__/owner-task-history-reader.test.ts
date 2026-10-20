// @vitest-environment node
// Protected client doubles: not PostgreSQL ACL/RLS or authenticated acceptance.
import { describe, expect, it, vi } from 'vitest';
import { readOwnerTaskHistory, type OwnerTaskHistoryClients } from '../../supabase/functions/_shared/paige-orchestration/owner-task-history';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = { approvalId: id(1), tenantId: id(2) };
const actor = id(3), task = id(4), run = id(5), event = id(6), act = id(7), ledger = id(8), process = id(9);
const stamp = '2026-10-19T12:00:00Z';
function fixture() {
  const calls: string[] = [];
  const approval = { id: request.approvalId, tenant_id: request.tenantId, source: 'paige_orchestration', category: 'owner.task', type: 'other', status: 'approved',
    updated_at: stamp, metadata: { source: 'paige_orchestration', capability_id: 'owner.task', event_id: event, act_id: act, act_execution_id: ledger, automation_id: process } };
  const occurrence = { id: ledger, tenant_id: request.tenantId, event_id: event, act_id: act, automation_id: process, adapter_kind: 'native', capability_key: 'owner.task', effective_lane: 'confirm', outcome: 'executed', correlation_ref: id(10), idempotency_key: id(10),
    decided_at: stamp, updated_at: stamp, detail: { approved_by: actor, approved_at: stamp, snapshot_args: { title: 'Original task', description: 'Original instructions' },
      owner_task_source: { v: 1 }, owner_task_approval: { id: request.approvalId } } };
  // Reconciled execution deliberately has no detail.approve.task_id locator.
  const native = { state: 'found', actor_id: actor, result: { ok: true, action: 'task.create', outcome: 'succeeded', receipt_recorded: true, correlation_id: run,
    readback: { id: task, title: 'Original task', description: 'Original instructions', assignee_user_id: actor, external_effect: false, notification_sent: false } } };
  const receipt = { id: id(11), tenant_id: request.tenantId, actor_id: actor, source_kind: 'capability_run', source_id: run, source_revision: 0, capability_key: 'crm_create_task', outcome: 'capability_succeeded', occurred_at: stamp, detail: { action: 'task.create', record_kind: 'task', record_id: task } };
  let authorized = true, user = actor, tenant = request.tenantId;
  let step: ((name: string) => void) | null = null;
  const touch = (name: string) => { calls.push(name); step?.(name); };
  const query = (table: string, data: () => unknown) => {
    const q = { select: (_columns: string) => q, eq: (_key: string, _value: unknown) => q,
      maybeSingle: async () => { touch(table); return { data: structuredClone(data()), error: null }; } };
    return q;
  };
  const clients: OwnerTaskHistoryClients = {
    caller: { auth: { getUser: async () => { touch('auth'); return { data: { user: { id: user } }, error: null }; } },
      rpc: async (name, args) => { touch(name);
        if (name === 'current_user_tenant_id') return { data: tenant, error: null };
        if (name === 'can_read_owner_task_approval') { expect(args).toEqual({ _approval_id: request.approvalId }); return { data: authorized, error: null }; }
        throw Error(`Unexpected caller RPC ${name}`);
      }, from: table => { expect(table).toBe('paige_approval_queue_v'); return query(table, () => approval); } },
    service: { rpc: async (name, args) => { touch(name); expect(name).toBe('read_owner_task_act');
        expect(args).toEqual({ _event_id: event, _act_id: act, _correlation: id(10) }); return { data: structuredClone(native), error: null }; },
      from: table => { expect(['paige_act_executions', 'paige_workspace_events']).toContain(table); return query(table, () => table === 'paige_act_executions' ? occurrence : receipt); } },
  };
  return { clients, calls, approval, occurrence, native, receipt,
    revoke: () => { authorized = false; }, switchActor: () => { user = id(90); }, switchTenant: () => { tenant = id(90); },
    at: (fn: (name: string) => void) => { step = fn; } };
}

describe('original internal-task history read', () => {
  it('recovers the original task and receipt without an optional ledger task locator', async () => {
    const f = fixture(), result = await readOwnerTaskHistory(request, f.clients);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw Error('expected authorized result');
    expect(result.originalTask).toEqual({ state: 'verified', taskId: task, receiptId: id(11), runId: run });
    expect(result.currentTask).toEqual({ state: 'not_read' });
    expect(result.title).toBe('Original task');
    expect(result.recordedOutcome).toBe('executed');
    expect(f.calls.filter(x => /execute|reconcile|approve_act|record_capability|insert|update/.test(x))).toEqual([]);
  });
  it('repeated reads neither replay work nor create receipts', async () => {
    const f = fixture(); expect(await readOwnerTaskHistory(request, f.clients)).toEqual(await readOwnerTaskHistory(request, f.clients));
    expect(f.calls.filter(x => x === 'read_owner_task_act')).toHaveLength(2);
  });
  it.each(['revoke', 'switchTenant'] as const)('refuses %s before privileged reads', async change => {
    const f = fixture(); f[change](); expect((await readOwnerTaskHistory(request, f.clients)).status).toBe('refused');
    expect(f.calls).not.toContain('paige_act_executions');
  });
  it('keeps an authorized later viewer distinct from the original executing actor', async () => {
    const f = fixture(); f.switchActor(); const r = await readOwnerTaskHistory(request, f.clients);
    expect(r.status === 'ready' && r.originalTask.state).toBe('verified');
    // Existing native inspector independently owns present-day visibility.
    expect(r.status === 'ready' && r.currentTask.state).toBe('not_read');
  });
  it.each(['paige_approval_queue_v', 'paige_act_executions', 'read_owner_task_act', 'paige_workspace_events'])('rejects an actor switch during %s', async stage => {
    const f = fixture(); f.at(name => { if (name === stage) f.switchActor(); });
    expect((await readOwnerTaskHistory(request, f.clients)).status).toBe('refused');
  });
  it.each(['paige_approval_queue_v', 'paige_act_executions', 'read_owner_task_act', 'paige_workspace_events'])('withholds evidence after authority loss during %s', async stage => {
    const f = fixture(); f.at(name => { if (name === stage) f.revoke(); });
    expect((await readOwnerTaskHistory(request, f.clients)).status).toBe('refused');
  });
  it.each(['pending', 'rejected'])('keeps %s approval separate from execution', async status => {
    const f = fixture(); f.approval.status = status; f.occurrence.outcome = status === 'pending' ? 'approval_pending' : 'cancelled';
    const r = await readOwnerTaskHistory(request, f.clients); expect(r.status).toBe('ready');
    if (r.status === 'ready') expect(r.originalTask.state).toBe('unconfirmed');
    expect(f.calls).not.toContain('read_owner_task_act');
  });
  it.each(['absent', 'unknown'])('does not interpret native %s as permission to retry', async state => {
    const f = fixture(); f.native.state = state; const r = await readOwnerTaskHistory(request, f.clients);
    expect(r.status === 'ready' && r.originalTask.state).toBe('unconfirmed'); expect(f.calls).not.toContain('operations_crm_work_read');
    expect(JSON.stringify(r)).not.toMatch(/retry|idempotency|snapshot_args|approved_by/);
  });
  it.each(['tenant_id', 'source_id', 'actor_id', 'capability_key', 'outcome', 'source_kind', 'source_revision'])('does not accept mismatched native receipt %s', async key => {
    const f = fixture(); (f.receipt as Record<string, unknown>)[key] = 'foreign'; const r = await readOwnerTaskHistory(request, f.clients);
    expect(r.status === 'ready' && r.originalTask.state).toBe('unconfirmed'); expect(f.calls).not.toContain('operations_crm_work_read');
  });
  it('rejects a receipt for another task despite a successful title', async () => {
    const f = fixture(); f.receipt.detail.record_id = id(91); const r = await readOwnerTaskHistory(request, f.clients);
    expect(r.status === 'ready' && r.originalTask.state).toBe('unconfirmed');
  });
  it.each(['external_effect', 'notification_sent'])('rejects unexpected native %s', async key => {
    const f = fixture(); (f.native.result.readback as Record<string, unknown>)[key] = true;
    const r = await readOwnerTaskHistory(request, f.clients); expect(r.status === 'ready' && r.originalTask.state).toBe('unconfirmed');
  });
  it('leaves current Task visibility to its canonical inspector', async () => {
    const f = fixture(); const r = await readOwnerTaskHistory(request, f.clients);
    expect(r.status === 'ready' && r.originalTask.state).toBe('verified');
    expect(r.status === 'ready' && r.currentTask.state).toBe('not_read');
    expect(f.calls).not.toContain('operations_crm_work_read');
  });
  it('refuses mismatched original occurrence metadata', async () => {
    const f = fixture(); f.approval.metadata.act_execution_id = id(91);
    expect((await readOwnerTaskHistory(request, f.clients)).status).toBe('unavailable'); expect(f.calls).not.toContain('read_owner_task_act');
  });
  it('contains transport failures without exposing raw errors or private records', async () => {
    const f = fixture(); f.clients.service.rpc = async () => { throw Error('private provider detail'); };
    const r = await readOwnerTaskHistory(request, f.clients); expect(JSON.stringify(r)).not.toContain('private provider detail');
    expect(r.status === 'ready' && r.originalTask.state).toBe('unconfirmed');
  });
  it.each(['actor_id', 'state'])('does not trust a mismatched native %s', async key => {
    const f = fixture(); (f.native as Record<string, unknown>)[key] = 'foreign';
    const r = await readOwnerTaskHistory(request, f.clients); expect(r.status === 'ready' && r.originalTask.state).toBe('unconfirmed');
    expect(f.calls).not.toContain('paige_workspace_events');
  });
  it.each(['ok', 'action', 'outcome', 'receipt_recorded', 'correlation_id'])('requires original native result %s', async key => {
    const f = fixture(); (f.native.result as Record<string, unknown>)[key] = 'invalid';
    const r = await readOwnerTaskHistory(request, f.clients); expect(r.status === 'ready' && r.originalTask.state).toBe('unconfirmed');
  });
  it.each(['title', 'description', 'assignee_user_id', 'id'])('requires native task %s binding', async key => {
    const f = fixture(); (f.native.result.readback as Record<string, unknown>)[key] = 'invalid';
    const r = await readOwnerTaskHistory(request, f.clients); expect(r.status === 'ready' && r.originalTask.state).toBe('unconfirmed');
  });
  it('keeps missing receipt evidence unconfirmed', async () => {
    const f = fixture(), original = f.clients.service.from;
    f.clients.service.from = table => table === 'paige_workspace_events' ? {
      select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }),
    } : original(table);
    const r = await readOwnerTaskHistory(request, f.clients); expect(r.status === 'ready' && r.originalTask.state).toBe('unconfirmed');
  });
  it('contains receipt read failures without discarding the recorded occurrence', async () => {
    const f = fixture(), original = f.clients.service.from;
    f.clients.service.from = table => table === 'paige_workspace_events' ? {
      select() { return this; }, eq() { return this; }, maybeSingle: async () => { throw Error('private storage detail'); },
    } : original(table);
    const r = await readOwnerTaskHistory(request, f.clients); expect(r.status === 'ready' && r.originalTask.state).toBe('unconfirmed');
    expect(JSON.stringify(r)).not.toContain('private storage detail');
  });
  it.each(['approved', 'rejected'])('rejects decision-version changes even when status becomes %s', async status => {
    const f = fixture(); f.at(name => { if (name === 'paige_workspace_events') { f.approval.status = status; f.approval.updated_at = '2026-10-19T13:00:00Z'; } });
    expect((await readOwnerTaskHistory(request, f.clients)).status).toBe('unavailable');
  });
  it('rejects an occurrence changing while its receipt is read', async () => {
    const f = fixture(); f.at(name => { if (name === 'paige_workspace_events') f.occurrence.updated_at = '2026-10-19T13:00:00Z'; });
    expect((await readOwnerTaskHistory(request, f.clients)).status).toBe('unavailable');
  });
  it('publishes no raw source, approval, task or provider detail', async () => {
    const f = fixture(); (f.occurrence.detail as Record<string, unknown>).private_provider_payload = 'sensitive';
    (f.receipt.detail as Record<string, unknown>).secret = 'sensitive';
    const r = await readOwnerTaskHistory(request, f.clients);
    expect(JSON.stringify(r)).not.toMatch(/sensitive|snapshot_args|idempotency_key|approved_by|owner_task_source|owner_task_approval/);
  });
  it('cancels a suspended native read without continuing on its late reply', async () => {
    const f = fixture(), abort = new AbortController(); let release!: (value: { data: unknown; error: unknown }) => void;
    f.clients.service.rpc = () => { f.calls.push('suspended_native'); return new Promise(resolve => { release = resolve; }); };
    const pending = readOwnerTaskHistory(request, f.clients, abort.signal);
    await vi.waitFor(() => expect(f.calls).toContain('suspended_native'));
    abort.abort(); expect((await pending).status).toBe('unavailable'); const count = f.calls.length;
    release({ data: f.native, error: null }); await Promise.resolve(); await Promise.resolve();
    expect(f.calls).toHaveLength(count); expect(f.calls).not.toContain('paige_workspace_events');
  });
  it('uses one total deadline and never continues a late preflight', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const f = fixture(); let release!: (value: { data: { user: { id: string } }; error: null }) => void;
      f.clients.caller.auth.getUser = () => new Promise(resolve => { release = resolve; });
      const pending = readOwnerTaskHistory(request, f.clients);
      await vi.advanceTimersByTimeAsync(8001); expect((await pending).status).toBe('unavailable');
      release({ data: { user: { id: actor } }, error: null }); await vi.advanceTimersByTimeAsync(1);
      expect(f.calls).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
