import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ports = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn(), rpc: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: ports.invoke }, from: ports.from, rpc: ports.rpc,
} }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isFetched: true }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: ports.invalidate }),
}));
import { usePaigeThreads, type UsePaigeThreads } from './usePaigeThreads';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const id = (n: number) => `a2343000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { threadId: id(1), turnId: id(2), intentId: id(3), tenantId: id(4) };
const history = () => ({ v: 1, status: 'verified_original', thread_id: scope.threadId, turn_id: scope.turnId,
  origin_intent_id: scope.intentId, tenant_id: scope.tenantId, historical: true, replayed: true,
  new_effect_possible: false, confirmations_restored: false,
  results: [{ tool: 'plan_set_reminder', receipt_version: 1, original: { item_id: id(5), title: 'Original service review',
    remind_at: '2030-01-02T10:00:00.123456Z', source_version: '2026-10-18T06:40:00.765432Z', receipt_run_id: id(6) } }] });
const response = () => ({ data: { approval_history: history() }, error: null });
const specialistHistory = () => ({ v: 1, status: 'recorded_assignment', thread_id: scope.threadId, turn_id: scope.turnId,
  origin_intent_id: scope.intentId, tenant_id: scope.tenantId, read_only: true, new_effect_possible: false, limited: false,
  results: [{ id: id(8), specialist: 'zion', recorded_status: 'pending', created_at: '2026-10-23T12:00:00Z',
    observed_at: '2026-10-23T12:01:00Z', receipt_state: 'missing', receipt_id: null, receipt_at: null,
    response_text: null, response_truncated: false, completion_scope: 'specialist_response_only' }] });
type Props = { callerUserId: string | null; tenantId: string | null; platform?: boolean };
const eligible: Props = { callerUserId: id(7), tenantId: scope.tenantId, platform: false };
const cleanup: Array<() => Promise<void>> = [];
async function mount(initial: Props = eligible) {
  let props = { ...initial }, api: UsePaigeThreads | null = null;
  const Probe = () => { api = usePaigeThreads(props); return null; };
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe />));
  cleanup.push(async () => { await act(async () => root.unmount()); });
  return { get api() { return api!; }, async render(next: Props) {
    props = { ...next }; await act(async () => root.render(<Probe />));
  } };
}
const read = (api: UsePaigeThreads, signal = new AbortController().signal) =>
  api.loadOriginalReminderHistory(scope.threadId, scope.turnId, scope.intentId, signal);
function noEffects() {
  expect(ports.from).not.toHaveBeenCalled(); expect(ports.rpc).not.toHaveBeenCalled();
  expect(ports.invalidate).not.toHaveBeenCalled();
  for (const [, options] of ports.invoke.mock.calls) {
    expect(options.headers).toEqual({ 'x-paige-chat-control': 'status' });
    expect(options.body).toEqual({ messages: [{ role: 'user', content: 'Read pending approval status.' }],
      threadId: scope.threadId, requestIntentId: scope.intentId, interactive: { kind: 'status', approvalTurnId: scope.turnId } });
  }
}

beforeEach(() => {
  ports.invoke.mockReset().mockResolvedValue(response());
  ports.from.mockReset().mockImplementation(() => { throw new Error('No direct table reader/writer'); });
  ports.rpc.mockReset().mockImplementation(() => { throw new Error('No direct effect RPC'); });
  ports.invalidate.mockReset();
});
describe('original specialist history shares the native status owner', () => {
  const specialistRead = (api: UsePaigeThreads, signal = new AbortController().signal) =>
    api.loadOriginalSpecialistHistory(scope.threadId, scope.turnId, scope.intentId, signal);
  it('selects original specialist status with the same physical abort signal and no action payload', async () => {
    ports.invoke.mockResolvedValue({ data: { specialist_history: specialistHistory() }, error: null });
    const view = await mount(), abort = new AbortController();
    expect(await specialistRead(view.api, abort.signal)).toEqual(specialistHistory());
    expect(ports.invoke).toHaveBeenCalledExactlyOnceWith('paige-ai-chat', {
      signal: abort.signal, headers: { 'x-paige-chat-control': 'status' },
      body: { messages: [{ role: 'user', content: 'Read pending approval status.' }], threadId: scope.threadId,
        requestIntentId: scope.intentId, interactive: { kind: 'status', approvalTurnId: scope.turnId, includeSpecialistHistory: true } },
    });
    expect(ports.from).not.toHaveBeenCalled(); expect(ports.rpc).not.toHaveBeenCalled(); expect(ports.invalidate).not.toHaveBeenCalled();
  });
  it('does not hydrate a result from the stored bundle or approval container', async () => {
    ports.invoke.mockResolvedValue({ data: { approval_history: specialistHistory(), bundle_ref: { specialist_history: specialistHistory() } }, error: null });
    expect(await specialistRead((await mount()).api)).toBeNull();
  });
  it('uses one result generation across reminder and specialist reads', async () => {
    let finish!: (value: unknown) => void;
    ports.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ data: { specialist_history: specialistHistory() }, error: null });
    const view = await mount(), oldReminder = read(view.api);
    expect(await specialistRead(view.api)).toEqual(specialistHistory());
    finish(response()); expect(await oldReminder).toBeNull();
  });
  it.each(['actor', 'tenant', 'platform', 'abort'] as const)('rejects a late specialist result after %s change', async change => {
    let finish!: (value: unknown) => void;
    ports.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = await mount(), abort = new AbortController(), pending = specialistRead(view.api, abort.signal);
    if (change === 'abort') abort.abort();
    else {
      await view.render({ ...eligible, ...(change === 'actor' ? { callerUserId: id(98) }
        : change === 'tenant' ? { tenantId: id(99) } : { platform: true }) });
      await view.render(eligible);
    }
    finish({ data: { specialist_history: specialistHistory() }, error: null }); expect(await pending).toBeNull();
    expect(ports.invoke).toHaveBeenCalledTimes(1);
  });
});
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
  vi.useRealTimers(); vi.restoreAllMocks();
});

describe('original Reminder history status hook', () => {
  it('uses the original status control and exact caller AbortSignal, returning only parsed historical data', async () => {
    const view = await mount(), abort = new AbortController();
    expect(await read(view.api, abort.signal)).toEqual(history());
    expect(ports.invoke).toHaveBeenCalledExactlyOnceWith('paige-ai-chat', {
      headers: { 'x-paige-chat-control': 'status' }, signal: abort.signal,
      body: { messages: [{ role: 'user', content: 'Read pending approval status.' }], threadId: scope.threadId,
        requestIntentId: scope.intentId, interactive: { kind: 'status', approvalTurnId: scope.turnId } },
    });
    noEffects();
  });
  it.each([
    { ...eligible, callerUserId: null }, { ...eligible, tenantId: null },
    { ...eligible, platform: true }, { callerUserId: null, tenantId: null, platform: true },
  ])('cannot read in an ineligible actor/tenant/platform scope %j', async props => {
    const view = await mount(props); expect(await read(view.api)).toBeNull();
    expect(ports.invoke).not.toHaveBeenCalled(); noEffects();
  });
  it.each([
    { approval_recovery: history() }, history(), { bundle_ref: { approval_history: history() } },
    { paige_resume: [{ approval_history: history() }] }, { approval_history: null, approval_recovery: history() },
    { approval_history: { ...history(), confirmations_restored: true } },
  ])('never hydrates another container or effectful card %j', async data => {
    ports.invoke.mockResolvedValue({ data, error: null });
    expect(await read((await mount()).api)).toBeNull();
    expect(ports.invoke).toHaveBeenCalledTimes(1); noEffects();
  });
  it.each(['thread_id', 'turn_id', 'origin_intent_id', 'tenant_id'])('binds the parsed %s to the requested current scope', async key => {
    ports.invoke.mockResolvedValue({ data: { approval_history: { ...history(), [key]: id(99) } }, error: null });
    expect(await read((await mount()).api)).toBeNull(); noEffects();
  });
  it('returns a detached response without creating a pending approval or current-record alias', async () => {
    const raw = history(); ports.invoke.mockResolvedValue({ data: { approval_history: raw }, error: null });
    const parsed = await read((await mount()).api); expect(parsed).toEqual(raw);
    raw.results[0].original.title = 'Later response mutation'; raw.results.length = 0;
    expect(parsed).toEqual(history());
    for (const key of ['confirmations', 'command', 'fingerprint', 'retry', 'currentReadback']) expect(parsed).not.toHaveProperty(key);
    noEffects();
  });
  it.each(['throw', 'error', 'lost', 'malformed'] as const)('keeps %s response unverified without a second request', async failure => {
    ports.invoke.mockImplementation(async () => {
      if (failure === 'throw') throw new TypeError('PRIVATE_NATIVE missing acknowledgement');
      if (failure === 'error') return { data: { approval_history: history() }, error: { message: 'PRIVATE_NATIVE refusal' } };
      return failure === 'lost' ? { data: null, error: null } : { data: { approval_history: { status: 'succeeded' } }, error: null };
    });
    expect(await read((await mount()).api)).toBeNull();
    expect(ports.invoke).toHaveBeenCalledTimes(1); noEffects();
  });
  it('does not dispatch when already aborted', async () => {
    const view = await mount(), abort = new AbortController(); abort.abort();
    expect(await read(view.api, abort.signal)).toBeNull(); expect(ports.invoke).not.toHaveBeenCalled(); noEffects();
  });
  it('ignores a successful late response after an abort even if the port ignores cancellation', async () => {
    let finish!: (value: unknown) => void;
    ports.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = await mount(), abort = new AbortController(), pending = read(view.api, abort.signal);
    abort.abort(); finish(response()); expect(await pending).toBeNull();
    expect(ports.invoke).toHaveBeenCalledTimes(1); noEffects();
  });
  for (const change of ['actor', 'tenant', 'platform'] as const) {
    for (const aba of [false, true]) {
      it('rejects a late ' + change + (aba ? ' A→B→A' : ' A→B') + ' response by generation identity', async () => {
        let finish!: (value: unknown) => void;
        ports.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const view = await mount(), pending = read(view.api);
        const next = { ...eligible, ...(change === 'actor' ? { callerUserId: id(98) }
          : change === 'tenant' ? { tenantId: id(99) } : { platform: true }) };
        await view.render(next); if (aba) await view.render(eligible);
        finish(response()); expect(await pending).toBeNull();
        expect(ports.invoke).toHaveBeenCalledTimes(1); noEffects();
      });
    }
  }
  it('does not start a read from an older scope callback after a tenant transition', async () => {
    const view = await mount(), old = view.api;
    await view.render({ ...eligible, tenantId: id(99) });
    expect(await read(old)).toBeNull(); expect(ports.invoke).not.toHaveBeenCalled(); noEffects();
  });
  it('backs off429 without timers/retry and permits only a later explicit read', async () => {
    const view = await mount(), time = Date.UTC(2026, 9, 18), clock = vi.spyOn(Date, 'now').mockReturnValue(time);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    ports.invoke.mockResolvedValueOnce({ data: null, error: { context: new Response('{}', {
      status: 429, headers: { 'Retry-After': '10' },
    }) } }).mockResolvedValue(response());
    expect(await read(view.api)).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000); expect(ports.invoke).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(time + 9_999); expect(await read(view.api)).toBeNull();
    expect(ports.invoke).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(time + 10_000); expect(await read(view.api)).toEqual(history());
    expect(ports.invoke).toHaveBeenCalledTimes(2); noEffects();
  });
  it.each(['history-first', 'pending-first'] as const)('shares only the incumbent status cooldown: %s', async order => {
    const view = await mount(); vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 18));
    ports.invoke.mockResolvedValueOnce({ data: null, error: { context: new Response('{}', {
      status: 429, headers: { 'Retry-After': '10' },
    }) } });
    if (order === 'history-first') {
      expect(await read(view.api)).toBeNull();
      expect(await view.api.loadApprovalRecovery(scope.threadId, scope.turnId, scope.intentId)).toBeNull();
    } else {
      expect(await view.api.loadApprovalRecovery(scope.threadId, scope.turnId, scope.intentId)).toBeNull();
      expect(await read(view.api)).toBeNull();
    }
    expect(ports.invoke).toHaveBeenCalledTimes(1); noEffects();
  });
  it('does not lend an old429 cooldown to a new scope after an ABA transition', async () => {
    let finish!: (value: unknown) => void;
    ports.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(response());
    const view = await mount(), pending = read(view.api);
    await view.render({ ...eligible, tenantId: id(99) }); await view.render(eligible);
    finish({ data: null, error: { context: new Response('{}', { status: 429, headers: { 'Retry-After': '300' } }) } });
    expect(await pending).toBeNull(); expect(await read(view.api)).toEqual(history());
    expect(ports.invoke).toHaveBeenCalledTimes(2); noEffects();
  });
  it('allows repeated sequential explicit observations without retrying or touching writer/cache ports', async () => {
    const view = await mount();
    const first = await read(view.api), second = await read(view.api);
    expect(first).toEqual(history()); expect(second).toEqual(first);
    expect(ports.invoke).toHaveBeenCalledTimes(2); noEffects();
  });
  it('returns only the latest explicit read when an earlier response arrives last', async () => {
    const finishes: Array<(value: unknown) => void> = [];
    ports.invoke.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
    const view = await mount(), earlier = read(view.api), latest = read(view.api);
    finishes[1](response()); expect(await latest).toEqual(history());
    finishes[0](response()); expect(await earlier).toBeNull();
    expect(ports.invoke).toHaveBeenCalledTimes(2); noEffects();
  });
});


// CURA selects only its original metadata through the same transport, scope and cooldown.
const curaHistory = () => ({ v: 1, status: 'recorded_preparation', thread_id: scope.threadId, turn_id: scope.turnId,
  origin_intent_id: scope.intentId, tenant_id: scope.tenantId, historical: true, retry_authorized: false,
  confirmations_restored: false, new_effect_possible: false, settles_interrupted_turn: false,
  preparations: [{ tool: 'save_to_knowledge_base', preparation_recorded: true, work_id: id(8), work_status: 'succeeded',
    knowledge_doc_id: id(9), current_document_revision: 2, work_updated_at: '2026-10-21T20:00:00Z' }] });
const curaRead = (api: UsePaigeThreads, signal = new AbortController().signal) =>
  api.loadOriginalCuraPreparationHistory(scope.threadId, scope.turnId, scope.intentId, signal);

describe('CURA original preparation on the incumbent status transport', () => {
  beforeEach(() => ports.invoke.mockResolvedValue({ data: { cura_preparation_history: curaHistory() }, error: null }));
  const noCuraEffects = () => {
    expect(ports.from).not.toHaveBeenCalled(); expect(ports.rpc).not.toHaveBeenCalled(); expect(ports.invalidate).not.toHaveBeenCalled();
    for (const [name, options] of ports.invoke.mock.calls) {
      expect(name).toBe('paige-ai-chat'); expect(options.headers).toEqual({ 'x-paige-chat-control': 'status' });
      expect(options.body).toEqual({ messages: [{ role: 'user', content: 'Read pending approval status.' }],
        threadId: scope.threadId, requestIntentId: scope.intentId,
        interactive: { kind: 'status', approvalTurnId: scope.turnId, includeCuraPreparationHistory: true } });
    }
  };
  it('passes the exact physical signal and selects only original CURA metadata', async () => {
    const view = await mount(), abort = new AbortController();
    expect(await curaRead(view.api, abort.signal)).toEqual(curaHistory());
    expect(ports.invoke.mock.calls[0][1].signal).toBe(abort.signal); expect(ports.invoke).toHaveBeenCalledTimes(1); noCuraEffects();
  });
  it.each([null, { approval_history: history() }, { bundle_ref: { cura_preparation_history: curaHistory() } },
    { cura_preparation_history: { ...curaHistory(), tenant_id: id(99) } },
    { cura_preparation_history: { ...curaHistory(), retry_authorized: true } }])('rejects invalid or foreign data %j', async data => {
    ports.invoke.mockResolvedValue({ data, error: null });
    expect(await curaRead((await mount()).api)).toBeNull(); expect(ports.invoke).toHaveBeenCalledTimes(1); noCuraEffects();
  });
  it.each(['actor', 'tenant', 'platform'] as const)('rejects late %s A-B-A evidence without lending its rate limit', async change => {
    let finish!: (value: unknown) => void;
    ports.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = await mount(), pending = curaRead(view.api);
    await view.render({ ...eligible, ...(change === 'actor' ? { callerUserId: id(98) }
      : change === 'tenant' ? { tenantId: id(99) } : { platform: true }) });
    await view.render(eligible); finish({ data: { cura_preparation_history: curaHistory() }, error: null });
    expect(await pending).toBeNull(); expect(await curaRead(view.api)).toEqual(curaHistory()); noCuraEffects();
  });
  it('cannot read with revoked local scope or a pre-aborted signal', async () => {
    const view = await mount(), old = view.api, abort = new AbortController(); abort.abort();
    expect(await curaRead(view.api, abort.signal)).toBeNull();
    await view.render({ ...eligible, tenantId: null }); expect(await curaRead(old)).toBeNull();
    expect(ports.invoke).not.toHaveBeenCalled(); noCuraEffects();
  });
  it('discards late success after physical cancellation without retry', async () => {
    let finish!: (value: unknown) => void;
    ports.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = await mount(), abort = new AbortController(), pending = curaRead(view.api, abort.signal);
    abort.abort(); finish({ data: { cura_preparation_history: curaHistory() }, error: null });
    expect(await pending).toBeNull(); expect(ports.invoke).toHaveBeenCalledTimes(1); noCuraEffects();
  });
  it('shares the existing cooldown with reminder status and never schedules retries', async () => {
    const view = await mount(), now = Date.UTC(2026, 9, 21); vi.spyOn(Date, 'now').mockReturnValue(now);
    ports.invoke.mockResolvedValueOnce({ data: null, error: { context: new Response('{}', { status: 429, headers: { 'Retry-After': '10' } }) } });
    expect(await curaRead(view.api)).toBeNull(); expect(await read(view.api)).toBeNull();
    expect(await view.api.loadApprovalRecovery(scope.threadId, scope.turnId, scope.intentId)).toBeNull();
    expect(ports.invoke).toHaveBeenCalledTimes(1); noCuraEffects();
  });
  it('uses one generation across original result kinds', async () => {
    let finish!: (value: unknown) => void;
    ports.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = await mount(), olderReminder = read(view.api);
    expect(await curaRead(view.api)).toEqual(curaHistory());
    finish(response()); expect(await olderReminder).toBeNull(); expect(ports.invoke).toHaveBeenCalledTimes(2);
    expect(ports.invoke.mock.calls[0][1].body.interactive).not.toHaveProperty('includeCuraPreparationHistory');
    expect(ports.from).not.toHaveBeenCalled(); expect(ports.rpc).not.toHaveBeenCalled();
  });
});
