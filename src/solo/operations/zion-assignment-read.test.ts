import { afterEach, expect, it, vi } from 'vitest';
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, createClient, FunctionsHttpError } from '@supabase/supabase-js';
import { readZionAssignments } from './zion-assignment-read';

const actor = '10000000-0000-4000-8000-000000000001';
const tenant = '20000000-0000-4000-8000-000000000001';
const id = '30000000-0000-4000-8000-000000000001';
const receipt = '40000000-0000-4000-8000-000000000001';
const time = '2026-10-25T15:12:00Z';
const scope = { actorId: actor, tenantId: tenant, epoch: 1 };
const summary = { id, specialist: 'zion', recorded_status: 'succeeded', created_at: time };
const sample = () => ({ ok: true, matches: [], recent_invocations: [summary], sample_only: true, limit: 5, note: 'A permitted sample only.' });
const detail = () => ({ ok: true, matches: [], invocation: { ...summary, created_at: time as string | null, observed_at: time,
  receipt_state: 'verified', receipt_id: receipt as string | null, receipt_at: time as string | null, response_text: 'Review the original commitment.',
  response_truncated: false, completion_scope: 'specialist_response_only', note: 'Response only, no business effect.' } });
function ports(data: unknown = sample()) {
  type SessionRead = Awaited<ReturnType<Parameters<typeof readZionAssignments>[1]['auth']['getSession']>>;
  return { auth: { getSession: vi.fn(async (): Promise<SessionRead> => ({ data: { session: { user: { id: actor } } }, error: null })) },
    functions: { invoke: vi.fn(async (_name: string, _options: { body: Record<string, unknown> }) => ({ data, error: null as unknown })) } };
}
afterEach(() => vi.useRealTimers());
it.each(['sample-before', 'sample-after', 'detail-before', 'detail-after'])('keeps actual retryable Auth503 unavailable during %s', async stage => {
  const isDetail = stage.startsWith('detail'), caller = ports(isDetail ? detail() : sample());
  const failed = { data: { session: null }, error: new AuthRetryableFetchError('Temporary Auth outage', 503) };
  if (stage.endsWith('before')) caller.auth.getSession.mockResolvedValueOnce(failed);
  else caller.auth.getSession.mockResolvedValueOnce({ data: { session: { user: { id: actor } } }, error: null }).mockResolvedValueOnce(failed);
  expect(await readZionAssignments(scope, caller, () => scope, isDetail ? summary : undefined)).toEqual({ status: 'unavailable' });
  expect(caller.auth.getSession).toHaveBeenCalledTimes(stage.endsWith('before') ? 1 : 2);
  expect(caller.functions.invoke).toHaveBeenCalledTimes(stage.endsWith('before') ? 0 : 1);
});
it.each([new AuthRetryableFetchError('Network unavailable', 0), new AuthApiError('Rate limited', 429, 'over_request_rate_limit'), new TypeError('Unknown Auth transport failure')])('does not claim revoked access from ambiguous Auth: %s', async error => {
  const caller = ports(); caller.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error });
  expect(await readZionAssignments(scope, caller, () => scope)).toEqual({ status: 'unavailable' });
  expect(caller.functions.invoke).not.toHaveBeenCalled();
});
it.each([new AuthSessionMissingError(), new AuthApiError('Invalid session', 401, 'bad_jwt'), new AuthApiError('Denied', 403, 'not_admin')])('preserves actual confirmed SDK session denial: %s', async error => {
  const caller = ports(); caller.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error });
  expect(await readZionAssignments(scope, caller, () => scope)).toEqual({ status: 'refused' });
  expect(caller.functions.invoke).not.toHaveBeenCalled();
});
it('uses only caller-bound original discovery and keeps non-ZION sample coverage honest', async () => {
  const payload = sample(); payload.recent_invocations.push({ ...summary, id: '30000000-0000-4000-8000-000000000002', specialist: 'vera' });
  const caller = ports(payload);
  expect(await readZionAssignments(scope, caller, () => scope)).toEqual({ status: 'ready', entries: [summary] });
  expect(caller.functions.invoke).toHaveBeenCalledExactlyOnceWith('paige-orchestrator', {
    body: { action: 'tool_search', tenant_id: tenant, recent_assignments: true },
  });
  expect(caller.auth.getSession).toHaveBeenCalledTimes(2);
});
it('treats an empty permitted sample as empty while transport failure stays unavailable', async () => {
  expect(await readZionAssignments(scope, ports({ ...sample(), recent_invocations: [] }), () => scope)).toEqual({ status: 'ready', entries: [] });
  const caller = ports(); caller.functions.invoke.mockResolvedValue({ data: null, error: {} });
  expect(await readZionAssignments(scope, caller, () => scope)).toEqual({ status: 'unavailable' });
});
it('reads only the selected original ZION identity and preserves separate response/receipt evidence', async () => {
  const caller = ports(detail());
  expect(await readZionAssignments(scope, caller, () => scope, summary)).toEqual({ status: 'ready', invocation: detail().invocation });
  expect(caller.functions.invoke).toHaveBeenCalledExactlyOnceWith('paige-orchestrator', {
    body: { action: 'tool_search', tenant_id: tenant, invocation_id: id },
  });
});
it.each(['foreign-actor', 'foreign-tenant', 'epoch', 'persona', 'invalid-id'])('refuses %s before the original transport', async kind => {
  const caller = ports();
  const current = { ...scope, ...(kind === 'foreign-actor' ? { actorId: tenant } : kind === 'foreign-tenant' ? { tenantId: actor }
    : kind === 'epoch' ? { epoch: 2 } : kind === 'persona' ? { actAsClientId: id } : {}) };
  expect(await readZionAssignments(kind === 'invalid-id' ? { ...scope, tenantId: 'route-number' } : scope, caller, () => current)).toEqual({ status: 'refused' });
  expect(caller.functions.invoke).not.toHaveBeenCalled();
});
it('refuses a session belonging to a different person without invoking anything', async () => {
  const caller = ports(); caller.auth.getSession.mockResolvedValue({ data: { session: { user: { id: tenant } } }, error: null });
  expect(await readZionAssignments(scope, caller, () => scope)).toEqual({ status: 'refused' });
  expect(caller.functions.invoke).not.toHaveBeenCalled();
});
it.each(['duplicate', 'oversized', 'not-sample', 'payload-leak', 'unknown-status'])('rejects malformed discovery: %s', async kind => {
  const raw = sample();
  if (kind === 'duplicate') raw.recent_invocations.push(summary);
  if (kind === 'oversized') raw.recent_invocations = Array.from({ length: 6 }, () => summary);
  if (kind === 'not-sample') raw.sample_only = false;
  if (kind === 'payload-leak') Object.assign(raw.recent_invocations[0] = { ...summary }, { output: 'private' });
  if (kind === 'unknown-status') raw.recent_invocations[0] = { ...summary, recorded_status: 'running for sure' };
  expect(await readZionAssignments(scope, ports(raw), () => scope)).toEqual({ status: 'unavailable' });
});
it.each(['other-id', 'other-specialist', 'missing-receipt', 'contradictory-response', 'raw-input', 'oversized-text'])('rejects malformed original result: %s', async kind => {
  const raw = detail();
  if (kind === 'other-id') raw.invocation.id = tenant;
  if (kind === 'other-specialist') raw.invocation.specialist = 'vera';
  if (kind === 'missing-receipt') raw.invocation.receipt_id = null;
  if (kind === 'contradictory-response') raw.invocation.recorded_status = 'pending';
  if (kind === 'raw-input') Object.assign(raw.invocation, { input: 'private' });
  if (kind === 'oversized-text') raw.invocation.response_text = 'x'.repeat(8001);
  expect(await readZionAssignments(scope, ports(raw), () => scope, summary)).toEqual({ status: 'unavailable' });
});
it('keeps a stored response distinct from a conflicting receipt and permits an unknown original date', async () => {
  const raw = detail(); Object.assign(raw.invocation, { created_at: null, receipt_state: 'conflicting', receipt_id: null, receipt_at: null });
  expect(await readZionAssignments(scope, ports(raw), () => scope, summary)).toEqual({ status: 'ready', invocation: raw.invocation });
});
it('retires a delayed identity read at eight seconds and never starts the inspector afterward', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  let resolve!: (x: unknown) => void;
  const caller = ports(); caller.auth.getSession.mockImplementationOnce(() => new Promise(r => { resolve = r; }) as never);
  const pending = readZionAssignments(scope, caller, () => scope);
  await vi.advanceTimersByTimeAsync(8001);
  expect(await pending).toEqual({ status: 'unavailable' });
  resolve({ data: { session: { user: { id: actor } } }, error: null }); await vi.advanceTimersByTimeAsync(1);
  expect(caller.functions.invoke).not.toHaveBeenCalled();
});
it('discards an already-issued result after current scope changes and does not retry it', async () => {
  let resolve!: (x: unknown) => void; let current = scope;
  const caller = ports(); caller.functions.invoke.mockImplementationOnce(() => new Promise(r => { resolve = r; }) as never);
  const pending = readZionAssignments(scope, caller, () => current);
  await vi.waitFor(() => expect(caller.functions.invoke).toHaveBeenCalledTimes(1));
  current = { ...scope, epoch: 2 }; resolve({ data: sample(), error: null });
  expect(await pending).toEqual({ status: 'refused' });
  expect(caller.functions.invoke).toHaveBeenCalledTimes(1);
});

// The installed SDK, not a name-like error object. The only fetch is an explicit
// local transport fixture; no browser Auth, native record or provider is used.
it.each(['http-401', 'http-403', 'http-400', 'http-404', 'http-409', 'http-500',
  'relay', 'offline', 'name-only', 'fake-response'] as const)(
  'classifies the original inspector transport without consuming its body or replaying: %s', async kind => {
    let response: Response | undefined, receivedError: unknown;
    let calls = 0;
    const sdk = createClient('https://unit-test.invalid', 'synthetic-nonsecret-fixture', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async () => {
        calls++;
        if (kind === 'offline') throw Error('synthetic offline');
        response = new Response('ignored private transport body', { status: kind.startsWith('http-') ? Number(kind.slice(5)) : 403,
          ...(kind === 'relay' ? { headers: { 'x-relay-error': 'true' } } : {}) });
        return response;
      } },
    });
    const caller = ports();
    caller.functions.invoke.mockImplementation(async (name, options) => {
      if (kind === 'name-only') return { data: null, error: { name: 'FunctionsHttpError', context: new Response(null, { status: 403 }) } };
      if (kind === 'fake-response') return { data: null, error: new FunctionsHttpError({ status: 403 }) };
      const reply = await sdk.functions.invoke(name, options); receivedError = reply.error; return reply;
    });
    expect(await readZionAssignments(scope, caller, () => scope)).toEqual({ status: ['http-401', 'http-403'].includes(kind) ? 'refused' : 'unavailable' });
    expect(caller.functions.invoke).toHaveBeenCalledExactlyOnceWith('paige-orchestrator', {
      body: { action: 'tool_search', tenant_id: tenant, recent_assignments: true },
    });
    expect(calls).toBe(['name-only', 'fake-response'].includes(kind) ? 0 : 1);
    if (response) {
      expect(response.bodyUsed).toBe(false);
      if (kind !== 'relay') expect(receivedError).toBeInstanceOf(FunctionsHttpError);
    }
  });
