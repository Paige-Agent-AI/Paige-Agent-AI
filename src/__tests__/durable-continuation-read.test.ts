// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readDurableContinuation } from '../../supabase/functions/_shared/durable-job/continuation-read';
import { clearCeilingCacheForTests, PLATFORM_CEILING_KEY } from '../../supabase/functions/_shared/router-budget/mod';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ref = { threadId: id(1), intentId: id(2), workId: id(3) };
const row = (patch: Record<string, unknown> = {}) => ({
  workId: ref.workId, tenantId: id(4), actorId: id(5), threadId: ref.threadId, intentId: ref.intentId,
  workIntentId: id(6), scopeEpoch: 'epoch', capabilityKey: 'document_generate', workKind: 'document_authoring',
  status: 'succeeded', settledAt: '2026-01-01T00:00:00.000Z',
  terminalOutcome: { verified_readback: true }, errorCode: null, blockedReason: null,
  canonicalObjective: 'Write the guide', approvalPending: false, ...patch,
});
function caller(rowValue: unknown = row(), opts: { driftActor?: boolean } = {}) {
  const getUser = vi.fn(async () => ({ data: { user: { id: id(5) } }, error: null }));
  const rpc = vi.fn(async () => ({ data: rowValue, error: null }));
  const c = {
    auth: { getUser },
    rpc,
  };
  if (opts.driftActor) getUser.mockImplementationOnce(async () => ({ data: { user: { id: id(5) } }, error: null }))
    .mockImplementationOnce(async () => ({ data: { user: { id: id(9) } }, error: null }));
  return c;
}
function budgetDb(ceiling: number | null, accrued: number | null) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, gte: () => chain,
        maybeSingle: async () => table === 'admin_app_settings'
          ? { data: ceiling === null ? null : { value: ceiling }, error: null }
          : { data: null, error: null },
      };
      chain.then = async (resolve: (v: unknown) => unknown) => resolve(
        accrued === null ? { data: null, error: { message: 'unreadable' } }
          : { data: [{ cost_estimate_usd: accrued }], error: null });
      return chain;
    },
  } as unknown as Parameters<typeof readDurableContinuation>[2];
}

describe('durable continuation eligibility adapter', () => {
  it('projects an eligible verified terminal success', async () => {
    clearCeilingCacheForTests();
    const result = await readDurableContinuation(ref, caller(), budgetDb(50, 1));
    expect(result).toEqual({ eligibleForContext: true, state: 'succeeded', reason: 'canonical_terminal', workId: ref.workId });
  });
  it('a hard budget block denies with the budget reason', async () => {
    clearCeilingCacheForTests();
    const result = await readDurableContinuation(ref, caller(), budgetDb(1, 5));
    expect(result?.eligibleForContext).toBe(false);
    expect(result?.reason).toBe('budget_unavailable');
  });
  it('an unknown accrual is never budget-allowed', async () => {
    clearCeilingCacheForTests();
    const result = await readDurableContinuation(ref, caller(), budgetDb(50, null));
    expect(result?.reason).toBe('budget_unavailable');
  });
  it('no budget source denies with the budget reason', async () => {
    const result = await readDurableContinuation(ref, caller(), null);
    expect(result?.reason).toBe('budget_unavailable');
  });
  it('a capability outside the Spine registry denies', async () => {
    clearCeilingCacheForTests();
    const result = await readDurableContinuation(ref, caller(row({ capabilityKey: 'not_registered_anywhere' })), budgetDb(50, 1));
    expect(result?.reason).toBe('capability_unavailable');
  });
  it('an expired approval pending denies with the approval reason', async () => {
    clearCeilingCacheForTests();
    const result = await readDurableContinuation(ref, caller(row({ status: 'blocked', approvalPending: true, settledAt: null, terminalOutcome: null })), budgetDb(50, 1));
    expect(result?.reason).toBe('approval_pending');
  });
  it('nonterminal work denies with the nonterminal reason', async () => {
    clearCeilingCacheForTests();
    const result = await readDurableContinuation(ref, caller(row({ status: 'claimed', settledAt: null, terminalOutcome: null })), budgetDb(50, 1));
    expect(result?.reason).toBe('nonterminal');
  });
  it('unknown-outcome work requires reconciliation, never continuation', async () => {
    clearCeilingCacheForTests();
    const result = await readDurableContinuation(ref, caller(row({ status: 'outcome_unknown' })), budgetDb(50, 1));
    expect(result?.reason).toBe('reconciliation_required');
  });
  it('an unverified terminal success denies', async () => {
    clearCeilingCacheForTests();
    const result = await readDurableContinuation(ref, caller(row({ terminalOutcome: { verified_readback: false } })), budgetDb(50, 1));
    expect(result?.reason).toBe('terminal_unverified');
  });
  it('a failed terminal with an error code is continuable context', async () => {
    clearCeilingCacheForTests();
    const result = await readDurableContinuation(ref, caller(row({ status: 'failed', errorCode: 'document_provider_refused', terminalOutcome: { failed: true } })), budgetDb(50, 1));
    expect(result?.eligibleForContext).toBe(true);
    expect(result?.state).toBe('failed');
  });
  it('a settled_at in the future denies as unverified', async () => {
    clearCeilingCacheForTests();
    const result = await readDurableContinuation(ref, caller(row({ settledAt: new Date(Date.now() + 60_000).toISOString() })), budgetDb(50, 1));
    expect(result?.reason).toBe('terminal_unverified');
  });
  it('research-kind work with its frozen question is continuable context', async () => {
    clearCeilingCacheForTests();
    const result = await readDurableContinuation(ref, caller(row({
      capabilityKey: 'deep_research', workKind: 'research',
      canonicalObjective: 'Which channel converts best?',
      status: 'failed', errorCode: 'research_provider_error', terminalOutcome: { failed: true },
    })), budgetDb(50, 1));
    expect(result?.eligibleForContext).toBe(true);
    expect(result?.state).toBe('failed');
  });
  it('an actor drift after the read refuses', async () => {
    clearCeilingCacheForTests();
    const result = await readDurableContinuation(ref, caller(row(), { driftActor: true }), budgetDb(50, 1));
    expect(result).toBeNull();
  });
  it('an rpc error or null row returns null', async () => {
    clearCeilingCacheForTests();
    expect(await readDurableContinuation(ref, caller(null), budgetDb(50, 1))).toBeNull();
    const failing = caller(row());
    failing.rpc = vi.fn(async () => ({ data: null, error: { message: 'x' } }));
    expect(await readDurableContinuation(ref, failing, budgetDb(50, 1))).toBeNull();
  });
  it.each([
    ['a non-boolean approvalPending', row({ approvalPending: 'yes' })],
    ['a binding mismatch on the work id', row({ workId: id(9) })],
    ['a missing canonical objective', row({ canonicalObjective: '  ' })],
    ['a foreign tenant shape', row({ tenantId: 'not-a-uuid' })],
  ])('shape drift (%s) returns null', async (_label, bad) => {
    clearCeilingCacheForTests();
    expect(await readDurableContinuation(ref, caller(bad), budgetDb(50, 1))).toBeNull();
  });
});
