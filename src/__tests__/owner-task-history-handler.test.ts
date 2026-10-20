// @vitest-environment node
// Real transport with recording ports; not Auth/PostgreSQL/production evidence.
import { describe, expect, it, vi } from 'vitest';
import { createOwnerTaskHistoryHandler, type OwnerTaskHistoryTransport } from '../../supabase/functions/_shared/paige-orchestration/owner-task-history-handler';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const calls: string[] = []; let signedIn = true;
  const transport: OwnerTaskHistoryTransport = {
    caller: header => { calls.push('caller'); expect(header).toBe('Bearer ordinary-fixture'); return {
      auth: { getUser: async () => ({ data: { user: signedIn ? { id: id(1) } : null }, error: null }) },
      from: () => { throw Error('No row read permitted in this held fixture'); },
      rpc: async name => { calls.push(name); return { data: name === 'current_user_tenant_id' ? id(2) : false, error: null }; },
    }; },
    service: () => { calls.push('service_client'); return { from: () => { calls.push('private_lookup'); throw Error('forbidden'); },
      rpc: async () => { calls.push('private_lookup'); throw Error('forbidden'); } }; },
  };
  return { calls, transport, handler: createOwnerTaskHistoryHandler(transport), logout: () => { signedIn = false; } };
}
const request = (value: unknown) => new Request('https://fixture.invalid/history', { method: 'POST', headers: { Authorization: 'Bearer ordinary-fixture' }, body: JSON.stringify(value) });
const valid = { approvalId: id(3), tenantId: id(2) };
describe('exact owner-task history transport', () => {
  it.each(['GET', 'PUT', 'DELETE'])('refuses %s without constructing clients', async method => {
    const f = fixture(); expect((await f.handler(new Request('https://fixture.invalid', { method }))).status).toBe(405); expect(f.calls).toEqual([]);
  });
  it('handles CORS without data access', async () => {
    const f = fixture(), r = await f.handler(new Request('https://fixture.invalid', { method: 'OPTIONS' }));
    expect(r.status).toBe(200); expect(f.calls).toEqual([]);
  });
  it.each([undefined, '', 'Basic fixture', 'Bearer two words'])('refuses missing/invalid authorization %s', async header => {
    const f = fixture(), r = await f.handler(new Request('https://fixture.invalid', { method: 'POST', headers: header === undefined ? {} : { Authorization: header }, body: '{}' }));
    expect(r.status).toBe(401); expect(f.calls).toEqual([]);
  });
  it('requires authentic getUser before constructing a service client', async () => {
    const f = fixture(); f.logout(); expect((await f.handler(request(valid))).status).toBe(401); expect(f.calls).toEqual(['caller']);
  });
  it.each([null, [], {}, { approvalId: id(3) }, { ...valid, actorId: id(1) }, { ...valid, args: {} }, { ...valid, tenantId: 'invalid' }, { ...valid, approvalId: 'invalid' }])('refuses noncanonical request %j', async value => {
    const f = fixture(); expect((await f.handler(request(value))).status).toBe(400); expect(f.calls).toEqual(['caller']);
  });
  it('bounds the request before any private client or lookup', async () => {
    const f = fixture(); expect((await f.handler(request({ ...valid, extra: 'x'.repeat(2048) }))).status).toBe(400); expect(f.calls).toEqual(['caller']);
  });
  it('uses the original caller predicate and refuses before any private lookup', async () => {
    const f = fixture(), r = await f.handler(request(valid));
    expect(r.status).toBe(403); expect(await r.json()).toEqual({ status: 'refused' }); expect(f.calls).not.toContain('private_lookup');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('has a finite body-read deadline and never proceeds after a late body', async () => {
    vi.useFakeTimers(); try {
      const f = fixture(); let cancelled = false;
      const stream = new ReadableStream({ cancel: () => { cancelled = true; } });
      const req = new Request('https://fixture.invalid', { method: 'POST', headers: { Authorization: 'Bearer ordinary-fixture' }, body: stream, duplex: 'half' } as RequestInit);
      const pending = f.handler(req); await vi.advanceTimersByTimeAsync(5001); const r = await pending;
      expect(await r.json()).toEqual({ status: 'unavailable' }); expect(cancelled).toBe(true); expect(f.calls).toEqual(['caller']);
    } finally { vi.useRealTimers(); }
  });
  it.each(['deadline', 'abort'])('ends suspended initial Auth on %s without continuing on its late answer', async mode => {
    vi.useFakeTimers(); try {
      const f = fixture(), abort = new AbortController(); let release!: (value: { data: { user: { id: string } }; error: null }) => void;
      const original = f.transport.caller;
      f.transport.caller = header => ({ ...original(header), auth: { getUser: () => new Promise(resolve => { release = resolve; }) } });
      const req = new Request(request(valid), { signal: abort.signal }); const pending = f.handler(req);
      await vi.advanceTimersByTimeAsync(1);
      if (mode === 'abort') abort.abort(); else await vi.advanceTimersByTimeAsync(5001);
      expect(await (await pending).json()).toEqual({ status: 'unavailable' }); expect(f.calls).toEqual(['caller']);
      release({ data: { user: { id: id(1) } }, error: null }); await vi.advanceTimersByTimeAsync(1);
      expect(f.calls).toEqual(['caller']);
    } finally { vi.useRealTimers(); }
  });
  it('does not wait for a suspended oversized-body cancellation hook', async () => {
    const f = fixture(); let cancelled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1025)); }, cancel() { cancelled = true; return new Promise(() => {}); } });
    const req = new Request('https://fixture.invalid', { method: 'POST', headers: { Authorization: 'Bearer ordinary-fixture' }, body: stream, duplex: 'half' } as RequestInit);
    const r = await f.handler(req); expect(r.status).toBe(400); expect(cancelled).toBe(true); expect(f.calls).toEqual(['caller']);
  });
});
