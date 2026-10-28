// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { createClient, type User } from '@supabase/supabase-js';
import * as review from '../../supabase/functions/_shared/paige-context/business-review.ts';
import * as chat from '../../supabase/functions/_shared/paige-context/business-review-chat.ts';
import * as snapshot from '../../supabase/functions/_shared/paige-context/snapshot.ts';
import * as classification from '../../supabase/functions/_shared/calendar-booking-read.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const source = readFileSync(resolve('supabase/functions/paige-business-review/index.ts'), 'utf8');
const now = new Date('2026-10-27T12:00:00Z');
function fixture() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const options = { role: 'owner', actor: id(1), tenant: id(2), shape: [{ id: id(2), account_type: 'standalone', parent_tenant_id: null }] as unknown,
    denyRail: false, denyAgenda: false, teamAdmin: true, member: true, emptyAgenda: false,
    hangIdentity: false, onRead: (_name: string, _count: number): void => undefined };
  // Real SDK/query/abort and real endpoint/composer/adapters. Only Auth/HTTP/serve/env are synthetic.
  const caller = createClient('https://test-tenant.example', 'public-test-key', { auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)), name = url.pathname.split('/').pop()!;
      if (url.origin !== 'https://test-tenant.example') throw Error('Unexpected origin');
      const args = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ name, args }); options.onRead(name, calls.filter(c => c.name === name).length);
      let data: unknown;
      if (name === 'check_rate_limit') data = true;
      else if (name === 'current_user_tenant_id') data = options.tenant;
      else if (name === 'tenants') data = options.shape;
      else if (name === 'is_tenant_admin') data = options.teamAdmin;
      else if (name === 'is_tenant_member') data = options.member;
      else if (name === 'list_team_bookings') {
        if (options.denyAgenda) return new Response(JSON.stringify({ code: '42501', message: 'PRIVATE CALENDAR DIAGNOSTIC' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } });
        data = options.emptyAgenda ? [] : [{ id: id(4), tenant_id: id(2), calendar_id: id(5), host_user_id: id(1), contact_id: null,
          title: 'Original source appointment', start_at: '2026-10-26T16:00:00Z', end_at: '2026-10-26T16:30:00Z',
          timezone: 'America/New_York', status: 'scheduled', booking_kind: 'single' }];
      }
      else if (name === 'has_tenant_role') {
        if (options.hangIdentity) return await new Promise<Response>(() => {});
        if (args._user_id !== id(1) || args._tenant_id !== id(2)) throw Error('Retargeted membership read');
        data = args._role === options.role;
      } else if (name === 'get_solo_rail_activity') {
        if (options.denyRail) return new Response(JSON.stringify({ code: '42501', message: 'PRIVATE RAIL DIAGNOSTIC' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } });
        data = [{ id: id(3), actor_type: 'paige_agent', actor_agent: 'VERA', audience: 'owner', visibility: 'owner_internal',
          title: 'Original recorded review', summary: 'No business records changed.', occurred_at: '2026-10-26T12:00:00Z' }];
      } else throw Error('Unexpected native request: ' + name);
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const auth = vi.spyOn(caller.auth, 'getUser').mockImplementation(async () => ({ data: { user: { id: options.actor } as User }, error: null }));
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const factory = vi.fn(() => caller);
  const imports: Record<string, unknown> = {
    'https://deno.land/std@0.168.0/http/server.ts': { serve: (fn: typeof handler) => { handler = fn; } },
    'https://esm.sh/@supabase/supabase-js@2.75.0': { createClient: factory },
    '../_shared/paige-context/business-review.ts': review, '../_shared/paige-context/business-review-chat.ts': chat,
    '../_shared/paige-context/snapshot.ts': snapshot, '../_shared/calendar-booking-read.ts': classification,
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  expect(compiled.diagnostics).toEqual([]);
  const exports = {};
  new Function('exports', 'require', 'Deno', compiled.outputText)(exports, (name: string) => {
    if (!(name in imports)) throw Error('Unexpected endpoint dependency: ' + name); return imports[name];
  }, { env: { get(name: string) {
    if (name === 'SUPABASE_URL') return 'https://test-tenant.example';
    if (name === 'SUPABASE_ANON_KEY') return 'public-test-key';
    throw Error('Unexpected environment authority');
  } } });
  if (!handler) throw Error('Original handler not captured');
  async function invoke(mode: 'normal' | 'chat', body: Record<string, unknown> = { focus: ['outcomes'], timezone: 'UTC' }, header = id(2)) {
    const response = await handler!(new Request(`https://test-tenant.example/functions/v1/paige-business-review?${mode === 'chat' ? 'chat=1' : 'finance_sources=1'}`, {
      method: 'POST', headers: { Authorization: 'Bearer original-user', 'Content-Type': 'application/json', 'x-paige-review-scope': header }, body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  }
  return { options, calls, auth, factory, invoke };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe.each(['normal', 'chat'] as const)('actual Business Review %s endpoint eligibility', mode => {
  it.each(['owner', 'admin'])('reaches original Calendar through the real endpoint for native SOLO %s', async role => {
    const f = fixture(); f.options.role = role;
    const result = await f.invoke(mode, { focus: ['bookings'], timezone: 'UTC' });
    expect(result.status).toBe(200); expect(JSON.stringify(result.body)).toContain('Original source appointment');
    expect(f.calls.filter(c => c.name === 'list_team_bookings')).toHaveLength(1);
    expect(f.calls.filter(c => c.name === 'is_tenant_admin')).toHaveLength(2);
    expect(f.calls.filter(c => c.name === 'is_tenant_member')).toHaveLength(1);
    if (mode === 'normal') {
      expect(result.body.snapshot.domains.bookings.status).toBe('available');
      expect(result.body.snapshot.domains.bookings.data.outcomes).toEqual([]);
    } else {
      expect(result.body.result.status).toBe('available');
      expect(result.body.result.record_links).toContainEqual({ destination: 'calendar', record_id: null });
    }
    expect(f.calls.every(c => ['check_rate_limit', 'current_user_tenant_id', 'tenants', 'has_tenant_role',
      'is_tenant_admin', 'is_tenant_member', 'list_team_bookings'].includes(c.name))).toBe(true);
  });
  it('retains native team-admin refusal rather than borrowing endpoint membership', async () => {
    const f = fixture(); f.options.teamAdmin = false;
    const result = await f.invoke(mode, { focus: ['bookings'], timezone: 'UTC' });
    expect(JSON.stringify(result.body)).not.toContain('Original source appointment');
    expect(f.calls.some(c => c.name === 'list_team_bookings')).toBe(false);
  });
  it.each([false, true])('withholds populated/empty Calendar after native role withdrawal (empty=%s)', async empty => {
    const f = fixture(); f.options.emptyAgenda = empty;
    f.options.onRead = (name, count) => { if (name === 'is_tenant_admin' && count === 2) f.options.teamAdmin = false; };
    const result = await f.invoke(mode, { focus: ['bookings'], timezone: 'UTC' });
    expect(f.calls.filter(c => c.name === 'list_team_bookings')).toHaveLength(1);
    expect(f.calls.filter(c => c.name === 'is_tenant_admin')).toHaveLength(2);
    expect(JSON.stringify(result.body)).not.toContain('Original source appointment');
    if (mode === 'normal') expect(result.body.snapshot.domains.bookings.data).toBeNull();
    else expect(result.body.result.record_links).toEqual([]);
  });
  it.each(['actor', 'tenant'] as const)('withholds Calendar if %s changes during the original read', async field => {
    const f = fixture(); f.options.onRead = name => { if (name === 'list_team_bookings') f.options[field] = id(90); };
    const result = await f.invoke(mode, { focus: ['bookings'], timezone: 'UTC' });
    expect(f.calls.some(c => c.name === 'list_team_bookings')).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain('Original source appointment');
  });
  it('keeps original Calendar source refusal private', async () => {
    const f = fixture(); f.options.denyAgenda = true;
    const result = await f.invoke(mode, { focus: ['bookings'], timezone: 'UTC' });
    expect(f.calls.some(c => c.name === 'list_team_bookings')).toBe(true);
    expect(JSON.stringify(result.body)).not.toMatch(/Original source appointment|PRIVATE CALENDAR/);
    if (mode === 'normal') expect(result.body.snapshot.domains.bookings.data).toBeNull();
    else expect(result.body.result.record_links).toEqual([]);
  });
  it('refuses model-authored Calendar eligibility before original source access', async () => {
    const f = fixture(); f.options.role = 'member';
    const result = await f.invoke(mode, { focus: ['bookings'], timezone: 'UTC', role: 'owner', accountShape: 'solo' });
    expect(JSON.stringify(result.body)).not.toContain('Original source appointment');
    expect(f.calls.some(c => c.name === 'list_team_bookings')).toBe(false);
  });
  it.each(['owner', 'admin'])('reaches the original Rail reader for a natively verified SOLO %s', async role => {
    const f = fixture(); f.options.role = role;
    const result = await f.invoke(mode); expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).toContain('Original recorded review');
    expect(f.calls.filter(c => c.name === 'get_solo_rail_activity')).toHaveLength(2);
    expect(f.factory).toHaveBeenCalledWith('https://test-tenant.example', 'public-test-key', { global: { headers: { Authorization: 'Bearer original-user' } } });
    expect(f.calls.filter(c => c.name === 'has_tenant_role').map(c => c.args)).toEqual(expect.arrayContaining([
      { _user_id: id(1), _tenant_id: id(2), _role: 'owner' }, { _user_id: id(1), _tenant_id: id(2), _role: 'admin' },
    ]));
    if (mode === 'normal') expect(result.body.snapshot.domains.outcomes.status).toBe('available');
    else expect(result.body.result.status).toBe('available');
  });
  it.each(['member', 'coach', 'unknown'])('does not invent owner/admin metadata for %s', async role => {
    const f = fixture(); f.options.role = role;
    const result = await f.invoke(mode); expect(JSON.stringify(result.body)).not.toContain('Original recorded review');
    expect(f.calls.some(c => c.name === 'get_solo_rail_activity')).toBe(false);
  });
  it.each([
    { shape: [] }, { shape: [{ id: id(90), account_type: 'standalone', parent_tenant_id: null }] },
    { shape: [{ id: id(2), account_type: 'standalone' }] }, { shape: [{ id: id(2), account_type: 'agency', parent_tenant_id: null }] },
    { shape: [{ id: id(2), account_type: 'operator', parent_tenant_id: null }] }, { shape: [{ id: id(2), account_type: 'standalone', parent_tenant_id: id(90) }] },
  ])('withholds unresolved/foreign/non-SOLO classification $shape', async ({ shape }) => {
    const f = fixture(); f.options.shape = shape;
    expect(JSON.stringify((await f.invoke(mode)).body)).not.toContain('Original recorded review');
    expect(f.calls.some(c => c.name === 'get_solo_rail_activity')).toBe(false);
  });
  it('re-proves actor after eligibility resolution instead of borrowing the first Auth answer', async () => {
    const f = fixture(); f.options.onRead = name => { if (name === 'tenants') f.options.actor = id(90); };
    expect(JSON.stringify((await f.invoke(mode)).body)).not.toContain('Original recorded review');
    expect(f.calls.some(c => c.name === 'get_solo_rail_activity')).toBe(false);
  });
  it('does not use resolved metadata to override a later native Rail refusal', async () => {
    const f = fixture(); f.options.denyRail = true;
    const result = await f.invoke(mode); expect(JSON.stringify(result.body)).not.toMatch(/Original recorded review|PRIVATE RAIL/);
    expect(f.calls.some(c => c.name === 'get_solo_rail_activity')).toBe(true);
  });
  it('discards a changed active workspace before any Rail content', async () => {
    const f = fixture(); f.options.onRead = name => { if (name === 'tenants') f.options.tenant = id(90); };
    expect(JSON.stringify((await f.invoke(mode)).body)).not.toContain('Original recorded review');
    expect(f.calls.some(c => c.name === 'get_solo_rail_activity')).toBe(false);
  });
  it('never grants context from model-authored role or account fields', async () => {
    const f = fixture(); f.options.role = 'member';
    expect(JSON.stringify((await f.invoke(mode, { focus: ['outcomes'], timezone: 'UTC', role: 'owner', accountShape: 'solo' })).body)).not.toContain('Original recorded review');
    expect(f.calls.some(c => c.name === 'get_solo_rail_activity')).toBe(false);
  });
});
it('refuses a foreign Chat binding before resolving membership or reading source data', async () => {
  const f = fixture(); expect((await f.invoke('chat', undefined, id(90))).status).toBe(403);
  expect(f.calls.some(c => c.name === 'has_tenant_role' || c.name === 'tenants' || c.name === 'get_solo_rail_activity')).toBe(false);
});
it('bounds an unresponsive eligibility lookup without inventing context or hanging the review', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(now);
  const f = fixture(); f.options.hangIdentity = true;
  const pending = f.invoke('normal'); await vi.advanceTimersByTimeAsync(2_001);
  const result = await pending; expect(result.status).toBe(200);
  expect(result.body.snapshot.domains.outcomes.data).toBeNull();
  expect(f.calls.some(c => c.name === 'get_solo_rail_activity')).toBe(false);
});
