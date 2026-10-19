// E09 Slice 3 — the Paige-callable seam for sharing one client-linked work item with that client's
// portal (plan §1d). Synthetic ids only (CLAUDE.md §63): no real tenant, client or person appears here.
import { describe, expect, it, vi } from 'vitest';
import {
  setPlanItemClientShare, writeScopedPlanning, type ClientShareCaller, type PlanningCaller, type PlanningDecision,
} from '../../../supabase/functions/_shared/planning/scoped-write';
import { classifyAction, clampLaneByRisk, mutatingTools } from '../../../supabase/functions/_shared/action-risk';
import {
  PLANNING_CLIENT_SHARE_CAPABILITIES, PLANNING_CLIENT_SHARE_CAPABILITY, PLANNING_CLIENT_SHARE_TOOLS, PLANNING_WRITE_CAPABILITIES,
} from '../../../supabase/functions/_shared/paige-spine/domains/planning_writes';
import { requiresWorkspaceAdmin } from '../../../supabase/functions/_shared/workspace-authority';
import { PAIGE_SPINE_CAPABILITIES } from '../../../supabase/functions/_shared/paige-spine/registry';
import { composeClientEngagementStatus, type ClientEngagementSource } from '../../../supabase/functions/_shared/client-engagement/status';
import engagementFixture from '../../__tests__/fixtures/exp04-client-status-source.json';

const id = (n: number) => `e0930000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const ACTOR = id(1), TENANT = id(2), ITEM = id(4), FORGED_TENANT = id(77), FORGED_ACTOR = id(78);
const VERSION = '2026-10-14T12:00:00.123456+00:00';
const AFTER = '2026-10-14T12:05:00.654321+00:00';
const SHARED_AT = '2026-10-14T12:05:00.654321+00:00';
const ack = (over: Record<string, unknown> = {}) =>
  ({ ok: true, replayed: false, item_id: ITEM, shared: true, shared_at: SHARED_AT, updated_at: AFTER, portal_connected: true, ...over });
const row = (over: Record<string, unknown> = {}) => ({ id: ITEM, tenant_id: TENANT, client_shared_at: SHARED_AT, updated_at: AFTER, ...over });

function caller(reply: { data: unknown; error: unknown } = { data: ack(), error: null }, read: unknown = row()) {
  return {
    rpc: vi.fn().mockResolvedValue(reply),
    readItem: vi.fn().mockResolvedValue({ data: read, error: null }),
  } satisfies ClientShareCaller;
}
const share = (c: ClientShareCaller, args: unknown) =>
  setPlanItemClientShare({ caller: c, expectedActorId: ACTOR, expectedTenantId: TENANT, args });
const args = { item_id: ITEM, shared: true, expected_updated_at: VERSION };

describe('setPlanItemClientShare — the one share executor (chat + scoped adapter)', () => {
  it('carries the writer\'s portal access, so a paused client is never reported as connected (E09 Slice 7)', async () => {
    const c = caller({ data: ack({ portal_connected: false, portal_access: 'paused' }), error: null });
    expect(await share(c, args)).toMatchObject({ success: true, portalConnected: false, portalAccess: 'paused' });
  });
  it('maps to the scoped RPC with the server-resolved actor and tenant, then proves it by readback', async () => {
    const c = caller();
    expect(await share(c, args)).toEqual({ success: true, itemId: ITEM, shared: true, replayed: false,
      sharedAt: SHARED_AT, updatedAt: AFTER, portalConnected: true, portalAccess: null });
    expect(c.rpc).toHaveBeenCalledTimes(1);
    expect(c.rpc).toHaveBeenCalledWith('plan_item_set_client_share', { p_expected_actor_id: ACTOR,
      p_expected_tenant_id: TENANT, p_item_id: ITEM, p_shared: true, p_expected_updated_at: VERSION });
    expect(c.readItem).toHaveBeenCalledWith(ITEM, TENANT);
  });

  it('ignores a forged tenant_id or actor in the chat arguments — they never reach the RPC or the read', async () => {
    const c = caller();
    const r = await share(c, { ...args, tenant_id: FORGED_TENANT, p_expected_tenant_id: FORGED_TENANT,
      actor_id: FORGED_ACTOR, p_expected_actor_id: FORGED_ACTOR });
    expect(r.success).toBe(true);
    const sent = JSON.stringify([c.rpc.mock.calls, c.readItem.mock.calls]);
    expect(sent).not.toContain(FORGED_TENANT);
    expect(sent).not.toContain(FORGED_ACTOR);
    expect(c.rpc.mock.calls[0][1]).toMatchObject({ p_expected_tenant_id: TENANT, p_expected_actor_id: ACTOR });
  });

  it('an ok:true acknowledgement is not success until the row reads back in the asked state', async () => {
    const c = caller({ data: ack(), error: null }, row({ client_shared_at: null }));
    expect(await share(c, args)).toMatchObject({ success: false, reason: 'outcome_unknown', writeAttempted: true });
    const other = caller({ data: ack(), error: null }, row({ tenant_id: FORGED_TENANT }));
    expect(await share(other, args)).toMatchObject({ success: false, reason: 'outcome_unknown', writeAttempted: true });
  });

  it('unsharing reads back a cleared share', async () => {
    const c = caller({ data: ack({ shared: false, shared_at: null }), error: null }, row({ client_shared_at: null }));
    expect(await share(c, { ...args, shared: false })).toMatchObject({ success: true, shared: false, sharedAt: null });
    expect(c.rpc.mock.calls[0][1]).toMatchObject({ p_shared: false });
  });

  it('a state replay is success with replayed:true, still verified by readback', async () => {
    const c = caller({ data: ack({ replayed: true }), error: null });
    expect(await share(c, args)).toMatchObject({ success: true, replayed: true });
    expect(c.readItem).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['INVALID_REQUEST', 'bad_request'], ['CLIENT_SHARE_UNAVAILABLE', 'not_for_account'], ['ITEM_NOT_FOUND', 'not_found'],
    ['ITEM_NOT_CLIENT_LINKED', 'not_client_linked'], ['ITEM_NOT_SHAREABLE', 'not_shareable'],
    ['CONTACT_NOT_FOUND', 'client_not_found'], ['SOMETHING_NEW', 'refused'],
  ])('a named refusal %s is %s and proves nothing was written', async (code, reason) => {
    const c = caller({ data: { ok: false, error: code }, error: null });
    expect(await share(c, args)).toMatchObject({ success: false, reason, writeAttempted: false });
    expect(c.readItem).not.toHaveBeenCalled();
  });

  it('ITEM_CHANGED carries the current version so the owner re-reads before sharing', async () => {
    const c = caller({ data: { ok: false, error: 'ITEM_CHANGED', updated_at: AFTER }, error: null });
    expect(await share(c, args)).toMatchObject({ success: false, reason: 'changed', writeAttempted: false, currentUpdatedAt: AFTER });
  });

  it('a SQL refusal is not applied; an error with no SQLSTATE may have committed and is unknown', async () => {
    expect(await share(caller({ data: null, error: { code: '42501', message: 'PLAN_SCOPE_CHANGED' } }), args))
      .toMatchObject({ success: false, reason: 'scope_changed', writeAttempted: false });
    expect(await share(caller({ data: null, error: { message: 'FetchError: network' } }), args))
      .toMatchObject({ success: false, reason: 'outcome_unknown', writeAttempted: true });
    const thrown = caller(); thrown.rpc.mockRejectedValue(new Error('socket hang up'));
    expect(await share(thrown, args)).toMatchObject({ success: false, reason: 'outcome_unknown', writeAttempted: true });
  });

  it.each([
    ['no item id', { shared: true, expected_updated_at: VERSION }],
    ['a non-uuid item id', { ...args, item_id: 'item-4' }],
    ['a string for shared', { ...args, shared: 'true' }],
    ['no version', { item_id: ITEM, shared: true }],
    ['a date-only version', { ...args, expected_updated_at: '2026-10-14' }],
  ])('refuses %s before any write', async (_label, bad) => {
    const c = caller();
    expect(await share(c, bad)).toMatchObject({ success: false, reason: 'bad_request', writeAttempted: false });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it('refuses with no server-resolved workspace', async () => {
    const c = caller();
    expect(await setPlanItemClientShare({ caller: c, expectedActorId: ACTOR, expectedTenantId: null, args }))
      .toMatchObject({ success: false, reason: 'no_workspace' });
    expect(c.rpc).not.toHaveBeenCalled();
  });
});

describe('writeScopedPlanning — the planning adapter allowlist (item_id, shared, expected_updated_at)', () => {
  const scope = { actorId: ACTOR, tenantId: TENANT };
  const decision = (a: unknown): PlanningDecision => ({ kind: 'execute', args: a, audit: { capability: 'plan_item_set_client_share',
    decision: 'execute', effect: 'mutate', principal: 'person', userId: ACTOR, tenantId: TENANT } });
  const planningCaller = () => ({ getScope: vi.fn().mockResolvedValue(scope), rpc: vi.fn().mockResolvedValue({ data: ack(), error: null }),
    readRecord: vi.fn().mockResolvedValue({ data: row(), error: null }) }) satisfies PlanningCaller;

  it('maps the allowlist to the scoped RPC and returns a verified plan_items record', async () => {
    const c = planningCaller();
    expect(await writeScopedPlanning({ caller: c, decision: decision(args), scope, operationIdentity: 'op-1', current: () => true }))
      .toEqual({ outcome: 'source_verified', operationIdentity: 'op-1', record: { table: 'plan_items', id: ITEM },
        readback: { id: ITEM, shared: true, shared_at: SHARED_AT, updated_at: AFTER }, proofBoundary: 'planning_record_only', retryAllowed: false });
    expect(c.rpc).toHaveBeenCalledWith('plan_item_set_client_share', { p_expected_actor_id: ACTOR, p_expected_tenant_id: TENANT,
      p_item_id: ITEM, p_shared: true, p_expected_updated_at: VERSION });
    expect(c.readRecord).toHaveBeenCalledWith('plan_items', ITEM, scope);
  });

  it('refuses any key outside the allowlist, a tenant_id included, before any write', async () => {
    const c = planningCaller();
    expect(await writeScopedPlanning({ caller: c, decision: decision({ ...args, tenant_id: FORGED_TENANT }), scope,
      operationIdentity: 'op-2', current: () => true })).toMatchObject({ outcome: 'refused', writeAttempted: false });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it('a stale version is a conflict, and an unconfirmed write is unverified', async () => {
    const stale = planningCaller(); stale.rpc.mockResolvedValue({ data: { ok: false, error: 'ITEM_CHANGED', updated_at: AFTER }, error: null });
    expect(await writeScopedPlanning({ caller: stale, decision: decision(args), scope, operationIdentity: 'op-3', current: () => true }))
      .toMatchObject({ outcome: 'conflict', writeAttempted: false });
    const lost = planningCaller(); lost.readRecord.mockResolvedValue({ data: row({ client_shared_at: null }), error: null });
    expect(await writeScopedPlanning({ caller: lost, decision: decision(args), scope, operationIdentity: 'op-4', current: () => true }))
      .toMatchObject({ outcome: 'unverified', writeAttempted: true });
  });
});

describe('governance — risk class, seat and declaration', () => {
  it('is classified high, so it is gated and never runs unattended on an auto grant', () => {
    expect(classifyAction('plan_item_set_client_share')).toBe('high');
    expect(mutatingTools().has('plan_item_set_client_share')).toBe(true);
    expect(clampLaneByRisk('auto', 'plan_item_set_client_share')).toBe('confirm');
  });

  it('is registered as planning.share_with_client with an owner/admin seat and the high risk key', () => {
    const cap = PAIGE_SPINE_CAPABILITIES.find((c) => c.key === 'planning.share_with_client');
    expect(PLANNING_CLIENT_SHARE_CAPABILITIES).toContain(cap);
    // The incumbent planning writers stay exactly as frozen; this one is registered beside them.
    expect(PLANNING_WRITE_CAPABILITIES.some((c) => c.key === 'planning.share_with_client')).toBe(false);
    expect(cap?.action).toMatchObject({ classification: 'mutate', executor: 'public.plan_item_set_client_share',
      chatTool: 'plan_item_set_client_share', seatAuthority: 'workspace-admin', riskPolicyKey: 'high' });
    expect(cap?.action?.idempotency).toContain('replayed:true');
    expect(cap?.action?.idempotency).toContain('ITEM_CHANGED');
    // The early chat refusal reads the same declaration, so a member hears no before any approval card.
    expect(requiresWorkspaceAdmin('plan_item_set_client_share', new Set())).toBe(true);
  });

  it('declares the tool through defineCapability, and the model sees exactly that schema', () => {
    expect(PLANNING_CLIENT_SHARE_CAPABILITY.governance).toMatchObject({ actionRiskKey: 'plan_item_set_client_share', risk: 'high', approval: 'confirm' });
    const [tool] = PLANNING_CLIENT_SHARE_TOOLS;
    expect(tool.function.name).toBe('plan_item_set_client_share');
    expect(tool.function.parameters).toEqual(PLANNING_CLIENT_SHARE_CAPABILITY.input);
    expect(Object.keys(PLANNING_CLIENT_SHARE_CAPABILITY.input.properties).sort()).toEqual(['expected_updated_at', 'item_id', 'shared']);
    expect(JSON.stringify(PLANNING_CLIENT_SHARE_CAPABILITY.input)).not.toMatch(/tenant/i);
  });

  it('hands the chat a writable copy of the frozen declaration, so the confirm flag can be added', () => {
    // paige-ai-chat writes `confirm` onto every gated tool's parameters on every business-account turn.
    // Handing it the deep-frozen declaration itself threw "object is not extensible" and ended the turn.
    expect(Object.isFrozen(PLANNING_CLIENT_SHARE_CAPABILITY.input)).toBe(true);
    const params = PLANNING_CLIENT_SHARE_TOOLS[0].function.parameters as { properties: Record<string, unknown> };
    expect(params).not.toBe(PLANNING_CLIENT_SHARE_CAPABILITY.input);
    expect(Object.isFrozen(params)).toBe(false);
    expect(Object.isFrozen(params.properties)).toBe(false);
    expect(() => { params.properties.__probe = { type: 'boolean' }; }).not.toThrow();
    delete params.properties.__probe;
    expect(PLANNING_CLIENT_SHARE_CAPABILITY.input.properties).not.toHaveProperty('__probe');
  });
});

describe('read_client_engagement_status composer — share state passes through (plan §1e)', () => {
  it('keeps each item\'s shared flag and exact version, which the owner switch and Paige need', () => {
    const source = structuredClone(engagementFixture) as unknown as ClientEngagementSource;
    const [first, second] = source.work.items;
    Object.assign(first, { shared: true, updated_at: VERSION });
    Object.assign(second, { shared: false, updated_at: AFTER });
    source.work.shared = 1;
    const items = composeClientEngagementStatus(source).work.items;
    expect(items[0]).toMatchObject({ id: first.id, shared: true, updated_at: VERSION });
    expect(items[1]).toMatchObject({ id: second.id, shared: false, updated_at: AFTER });
  });

  it('exposes work.shared from the reader, and null (unknown, never zero) when the reader omits it', () => {
    const source = structuredClone(engagementFixture) as unknown as ClientEngagementSource;
    source.work.shared = 5;
    expect(composeClientEngagementStatus(source).work.shared).toBe(5);
    source.work.shared = 0;
    expect(composeClientEngagementStatus(source).work.shared).toBe(0);
    delete source.work.shared;
    expect(composeClientEngagementStatus(source).work.shared).toBeNull();
    (source.work as { shared?: unknown }).shared = '5';
    expect(composeClientEngagementStatus(source).work.shared).toBeNull();
    source.work.shared = -1;
    expect(composeClientEngagementStatus(source).work.shared).toBeNull();
  });
});
