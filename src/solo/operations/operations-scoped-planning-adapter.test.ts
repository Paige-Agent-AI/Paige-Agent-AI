import { expect, it, vi } from 'vitest';
import { writeScopedPlanning, type PlanningCaller, type PlanningDecision } from '../../../supabase/functions/_shared/planning/scoped-write';

const id = (n: number) => `ef910000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const scope = { actorId: id(1), tenantId: id(2) };
const operationIdentity = id(9);
const decision = (tool: string, args: unknown): PlanningDecision => ({ kind: 'execute', args,
  audit: { capability: tool, decision: 'execute', effect: 'mutate', principal: 'person',
    userId: id(1), tenantId: id(2) } });
const project = { title: 'Delivery plan', horizon: 'custom', starts_on: '2026-10-14', ends_on: '2026-11-14',
  scope: 'team', owner_user_id: id(3), summary: 'Work agreed internally' };
const item = { id: id(4), tenant_id: id(2), created_by: id(1), item_type: 'task', title: 'Prepare workshop',
  summary: null, assigned_to_user_id: id(3), plan_id: id(5), parent_item_id: null, priority: 'normal',
  due_at: null, contact_id: id(6), status: 'open', updated_at: '2026-10-14T12:00:00.123456+00:00' };
function caller(row: unknown, ack: unknown = { ok: true, item_id: id(4), actor_id: id(1), tenant_id: id(2) }) {
  return { getScope: vi.fn().mockResolvedValue(scope), rpc: vi.fn().mockResolvedValue({ data: ack, error: null }),
    readRecord: vi.fn().mockResolvedValue({ data: row, error: null }) };
}
const run = (c: PlanningCaller, d: PlanningDecision, current = () => true) =>
  writeScopedPlanning({ caller: c, decision: d, scope, operationIdentity, current });

it('creates through the scoped project writer and independent exact plans readback', async () => {
  const c = caller({ ...project, id: id(4), tenant_id: id(2), created_by: id(1), status: 'active', updated_at: item.updated_at },
    { ok: true, plan_id: id(4), actor_id: id(1), tenant_id: id(2) });
  expect(await run(c, decision('plan_create', project))).toEqual({ outcome: 'source_verified',
    operationIdentity, record: { table: 'plans', id: id(4) }, readback: { ...project, tenant_id: id(2), created_by: id(1), status: 'active', updated_at: item.updated_at },
    proofBoundary: 'planning_record_only', retryAllowed: false });
  expect(c.rpc).toHaveBeenCalledWith('plan_create_scoped', { p_expected_actor_id: id(1), p_expected_tenant_id: id(2),
    p_title: project.title, p_horizon: project.horizon, p_starts_on: project.starts_on, p_ends_on: project.ends_on,
    p_scope: 'team', p_owner_user_id: id(3), p_summary: project.summary });
  expect(c.readRecord).toHaveBeenCalledWith('plans', id(4), scope);
});
it('task identity is plan_items, never the related plan or customer', async () => {
  const c = caller(item);
  expect(await run(c, decision('plan_assign_task', { title: item.title, assigned_to_user_id: id(3), plan_id: id(5), contact_id: id(6) })))
    .toMatchObject({ outcome: 'source_verified', record: { table: 'plan_items', id: id(4) } });
  expect(c.readRecord).toHaveBeenCalledWith('plan_items', id(4), scope);
  expect(c.rpc.mock.calls[0][1]).toMatchObject({ p_plan_id: id(5), p_contact_id: id(6), p_priority: 'normal' });
});
it('milestone requires an explicit responsible person and exact milestone readback', async () => {
  const c = caller({ ...item, item_type: 'milestone', title: 'Internal review', contact_id: undefined });
  expect(await run(c, decision('plan_add_milestone', { plan_id: id(5), title: 'Internal review', assigned_to_user_id: id(3) })))
    .toMatchObject({ outcome: 'source_verified', record: { table: 'plan_items', id: id(4) } });
  expect(c.rpc.mock.calls[0][0]).toBe('plan_add_milestone_scoped');
});
it('versioned update keeps the untouched source timestamp and verifies the intended field', async () => {
  const c = caller({ ...item, status: 'in_progress', updated_at: '2026-10-14T12:01:00.654321+00:00' });
  c.readRecord.mockResolvedValueOnce({ data: item, error: null });
  expect(await run(c, decision('plan_update_item', { item_id: id(4), expected_updated_at: item.updated_at, status: 'in_progress' })))
    .toMatchObject({ outcome: 'source_verified', record: { table: 'plan_items', id: id(4) } });
  expect(c.rpc).toHaveBeenCalledWith('plan_update_item_versioned', { p_item_id: id(4), p_expected_actor_id: id(1),
    p_expected_tenant_id: id(2), p_expected_updated_at: item.updated_at, p_status: 'in_progress', p_due_at: null, p_assigned_to_user_id: null });
});
it('stale timestamp cannot be replaced with a freshly fetched version', async () => {
  const c = caller(item);
  expect(await run(c, decision('plan_update_item', { item_id: id(4), expected_updated_at: '2026-10-14T12:00:00.123455+00:00', status: 'done' })))
    .toMatchObject({ outcome: 'conflict', writeAttempted: false, retryAllowed: false });
  expect(c.rpc).not.toHaveBeenCalled();
});
it('unsupported update fields, clearing values and campaign links refuse rather than vanish', async () => {
  for (const extra of [{ title: 'Changed' }, { summary: 'Changed' }, { remind_at: '2026-10-15T00:00:00Z' },
    { due_at: null }, { assigned_to_user_id: null }, { confirm: true }]) {
    const c = caller(item);
    expect(await run(c, decision('plan_update_item', { item_id: id(4), expected_updated_at: item.updated_at, status: 'done', ...extra })))
      .toMatchObject({ outcome: 'refused', writeAttempted: false });
    expect(c.rpc).not.toHaveBeenCalled();
  }
  const c = caller(item);
  expect(await run(c, decision('plan_create', { ...project, campaign_ref: { id: id(6) } }))).toMatchObject({ outcome: 'refused' });
  expect(c.rpc).not.toHaveBeenCalled();
});
it('priority uses the existing stricter atomic versioned writer with the other requested fields', async () => {
  const c = caller({ ...item, priority: 'high', status: 'in_progress', assigned_to_user_id: id(7), updated_at: '2026-10-14T12:01:00Z' });
  c.readRecord.mockResolvedValueOnce({ data: item, error: null });
  expect(await run(c, decision('plan_update_item', { item_id: id(4), expected_updated_at: item.updated_at,
    priority: 'high', status: 'in_progress', assigned_to_user_id: id(7) })))
    .toMatchObject({ outcome: 'source_verified', readback: { priority: 'high', status: 'in_progress', assigned_to_user_id: id(7) } });
  expect(c.rpc).toHaveBeenCalledWith('plan_update_item_priority_versioned', {
    p_item_id: id(4), p_expected_actor_id: id(1), p_expected_tenant_id: id(2), p_expected_updated_at: item.updated_at,
    p_priority: 'high', p_status: 'in_progress', p_due_at: null, p_assigned_to_user_id: id(7),
  });
});
it('removal and scheduling have no legacy or silent cancellation fallback', async () => {
  for (const tool of ['plan_remove_item', 'plan_set_reminder']) {
    const c = caller(item);
    expect(await run(c, decision(tool, { item_id: id(4), title: 'Reminder' }))).toMatchObject({ outcome: 'unavailable', writeAttempted: false });
    expect(c.rpc).not.toHaveBeenCalled();
  }
});
it('proposal, refusal and wrong capability/actor/tenant assertions never reach a writer', async () => {
  for (const d of [{ ...decision('plan_create', project), kind: 'propose' }, { ...decision('plan_create', project), kind: 'refuse' },
    { ...decision('plan_create', project), audit: { ...decision('plan_create', project).audit!, userId: id(8) } },
    { ...decision('plan_create', project), audit: { ...decision('plan_create', project).audit!, tenantId: id(8) } },
    { ...decision('plan_create', project), audit: { ...decision('plan_create', project).audit!, effect: 'read' } }]) {
    const c = caller(item);
    expect(await run(c, d)).not.toMatchObject({ outcome: 'source_verified' }); expect(c.rpc).not.toHaveBeenCalled();
  }
});
it('missing operation identity, owner, milestone assignee and impossible window refuse before mutation', async () => {
  const c = caller(item);
  expect(await writeScopedPlanning({ caller: c, decision: decision('plan_create', project), scope, operationIdentity: '', current: () => true }))
    .toMatchObject({ outcome: 'unavailable', writeAttempted: false });
  for (const args of [{ ...project, owner_user_id: undefined }, { ...project, starts_on: '2026-02-30' },
    { ...project, starts_on: '2026-12-14' }]) expect(await run(c, decision('plan_create', args))).toMatchObject({ outcome: 'refused' });
  expect(await run(c, decision('plan_add_milestone', { title: 'Review', plan_id: id(5) }))).toMatchObject({ outcome: 'refused' });
  expect(c.rpc).not.toHaveBeenCalled();
});
it('scope changed during an attempt conceals the source identity', async () => {
  let current = true; const c = caller(item);
  c.rpc.mockImplementation(async () => { current = false; return { data: { ok: true, item_id: id(4), actor_id: id(1), tenant_id: id(2) }, error: null }; });
  const result = await run(c, decision('plan_assign_task', { title: item.title, assigned_to_user_id: id(3) }), () => current);
  expect(result).toMatchObject({ outcome: 'scope_changed', writeAttempted: true }); expect(result).not.toHaveProperty('record');
});
it('foreign acknowledgement or mismatched source never becomes successful creation', async () => {
  for (const ack of [{ ok: true, item_id: id(4), actor_id: id(8), tenant_id: id(2) },
    { ok: true, item_id: id(4), actor_id: id(1), tenant_id: id(8) }, { ok: true, plan_id: id(4), actor_id: id(1), tenant_id: id(2) }]) {
    expect(await run(caller(item, ack), decision('plan_assign_task', { title: item.title, assigned_to_user_id: id(3) })))
      .toMatchObject({ outcome: 'unverified', retryAllowed: false });
  }
  expect(await run(caller({ ...item, assigned_to_user_id: id(8) }), decision('plan_assign_task', { title: item.title, assigned_to_user_id: id(3) })))
    .toMatchObject({ outcome: 'unverified', retryAllowed: false });
});
it('transport and readback failure perform at most one call without leaking raw errors', async () => {
  const c = caller(item); c.rpc.mockRejectedValue(new Error('PRIVATE_INTERNAL_ERROR'));
  const result = await run(c, decision('plan_assign_task', { title: item.title, assigned_to_user_id: id(3) }));
  expect(result).toMatchObject({ outcome: 'unverified', writeAttempted: true, retryAllowed: false });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_INTERNAL'); expect(c.rpc).toHaveBeenCalledTimes(1);
  const read = caller(item); read.readRecord.mockResolvedValue({ data: null, error: { message: 'PRIVATE_ERROR' } });
  expect(await run(read, decision('plan_assign_task', { title: item.title, assigned_to_user_id: id(3) })))
    .toMatchObject({ outcome: 'unverified', retryAllowed: false });
});
it('known SQL refusal and stale conflict retain their distinct rollback outcomes', async () => {
  for (const [code, outcome] of [['42501', 'refused'], ['40001', 'conflict']]) {
    const c = caller(item); c.rpc.mockResolvedValue({ data: null, error: { code, message: 'PRIVATE_SQL' } });
    const result = await run(c, decision('plan_assign_task', { title: item.title, assigned_to_user_id: id(3) }));
    expect(result).toMatchObject({ outcome, writeAttempted: true, retryAllowed: false }); expect(JSON.stringify(result)).not.toContain('PRIVATE_SQL');
  }
});
it('due-time readback retains submillisecond precision rather than millisecond coincidence', async () => {
  const c = caller({ ...item, plan_id: null, contact_id: null, due_at: '2026-10-15T10:00:00.123457+00:00' });
  expect(await run(c, decision('plan_assign_task', { title: item.title, assigned_to_user_id: id(3), due_at: '2026-10-15T10:00:00.123456Z' })))
    .toMatchObject({ outcome: 'unverified' });
});
it('a reminder item cannot inherit task update authority through this adapter', async () => {
  const c = caller({ ...item, item_type: 'reminder' });
  expect(await run(c, decision('plan_update_item', { item_id: id(4), expected_updated_at: item.updated_at, status: 'cancelled' })))
    .toMatchObject({ outcome: 'unavailable', writeAttempted: false }); expect(c.rpc).not.toHaveBeenCalled();
});

it('a missing explicit priority cannot silently turn into normal on an update', async () => {
  const c = caller(item);
  expect(await run(c, decision('plan_update_item', { item_id: id(4), expected_updated_at: item.updated_at,
    priority: undefined, status: 'done' }))).toMatchObject({ outcome: 'refused', writeAttempted: false });
  expect(c.rpc).not.toHaveBeenCalled();
});
it('an unreadable current-request fence fails closed before and after an attempted change', async () => {
  const d = decision('plan_assign_task', { title: item.title, assigned_to_user_id: id(3) });
  const c = caller(item);
  const result = await run(c, d, () => { throw new Error('PRIVATE_FENCE'); });
  expect(result).toMatchObject({ outcome: 'scope_changed', writeAttempted: false });
  expect(c.rpc).not.toHaveBeenCalled();
  let fenceFailed = false;
  const attempted = caller(item);
  attempted.rpc.mockImplementation(async () => {
    fenceFailed = true;
    return { data: { ok: true, item_id: id(4), actor_id: id(1), tenant_id: id(2) }, error: null };
  });
  const after = await run(attempted, d, () => { if (fenceFailed) throw new Error('PRIVATE_FENCE'); return true; });
  expect(after).toMatchObject({ outcome: 'scope_changed', writeAttempted: true, retryAllowed: false });
  expect(after).not.toHaveProperty('record');
  expect(JSON.stringify(after)).not.toContain('PRIVATE_FENCE');
});
it('actual caller scope changes at each read fence prevent foreign source disclosure', async () => {
  const d = decision('plan_assign_task', { title: item.title, assigned_to_user_id: id(3) });
  for (const fence of [1, 2, 3]) {
    const c = caller({ ...item, plan_id: null, contact_id: null });
    let count = 0;
    c.getScope.mockImplementation(async () => ++count === fence ? { ...scope, tenantId: id(8) } : scope);
    const result = await run(c, d);
    expect(result).toMatchObject({ outcome: 'scope_changed', writeAttempted: fence === 3 });
    expect(result).not.toHaveProperty('record');
    expect(c.rpc).toHaveBeenCalledTimes(fence === 3 ? 1 : 0);
  }
});
it.each([2, 3])('request retirement inside scope read %i fences mutation and publication', async (fence) => {
    let active = true, calls = 0;
    const c = caller({ ...item, plan_id: null, contact_id: null });
    c.getScope.mockImplementation(async () => { if (++calls === fence) active = false; return scope; });
    const result = await run(c, decision('plan_assign_task', { title: item.title, assigned_to_user_id: id(3) }), () => active);
    expect(result).toMatchObject({ outcome: 'scope_changed', writeAttempted: fence === 3 });
    expect(result).not.toHaveProperty('record');
    expect(c.rpc).toHaveBeenCalledTimes(fence === 3 ? 1 : 0);
});
it('named readback strips unknown internal columns and does not manufacture a receipt', async () => {
  const c = caller({ ...item, plan_id: null, contact_id: null, private_trace: 'PRIVATE_INTERNAL' });
  const result = await run(c, decision('plan_assign_task', { title: item.title, assigned_to_user_id: id(3) }));
  expect(result).toMatchObject({ outcome: 'source_verified', proofBoundary: 'planning_record_only' });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_INTERNAL');
  expect(result).not.toHaveProperty('receipt');
});
it('service principals and unadmitted decisions cannot use the ordinary-person writer', async () => {
  for (const extra of [{ principal: 'service' }, { decision: 'propose' }, { userId: null }, { tenantId: null }]) {
    const c = caller(item), d = decision('plan_create', project);
    expect(await run(c, { ...d, audit: { ...d.audit!, ...extra } })).toMatchObject({ outcome: 'refused', writeAttempted: false });
    expect(c.rpc).not.toHaveBeenCalled();
  }
});
it('a changed unrequested relationship prevents false update readback', async () => {
  const c = caller({ ...item, status: 'done', plan_id: id(7) });
  c.readRecord.mockResolvedValueOnce({ data: item, error: null });
  expect(await run(c, decision('plan_update_item', { item_id: id(4), expected_updated_at: item.updated_at, status: 'done' })))
    .toMatchObject({ outcome: 'unverified', writeAttempted: true, retryAllowed: false });
});
