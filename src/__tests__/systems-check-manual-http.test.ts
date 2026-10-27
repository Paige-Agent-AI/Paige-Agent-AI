// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Whole original source at the transport/authority boundary. Only the eventual
// native operation is a controlled port here; the existing179-case Core/adapter
// fixture and separate148 native proof remain separate evidence, not customer QA.
function load(path: string, require: (name: string) => unknown, deno: unknown = {}, edgeRuntime?: unknown) {
  const source = readFileSync(resolve(path), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  if (code.diagnostics?.length) throw new Error('Original source did not compile: ' + path);
  const exports: Record<string, unknown> = {};
  new Function('exports', 'require', 'Deno', 'EdgeRuntime', code.outputText)(exports, require, deno, edgeRuntime);
  return exports;
}
const env = { SUPABASE_URL: 'https://unit-test.invalid', SUPABASE_ANON_KEY: 'synthetic-anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-internal-service' };
const deno = { env: { get: (key: keyof typeof env) => env[key] } };
let activeAdmin: Record<string, unknown>;
const core = load('supabase/functions/_shared/systems-check-runner.ts', name => {
  if (name !== './prompt-forge.ts') throw new Error('Unexpected Core dependency'); return { forge: vi.fn() };
});
const http = load('supabase/functions/_shared/systems-check-http.ts', name => {
  if (name !== 'https://esm.sh/@supabase/supabase-js@2.75.0') throw new Error('Unexpected HTTP dependency');
  return { createClient: () => activeAdmin };
}, deno);
const work = load('supabase/functions/_shared/systems-check-manual-work.ts', name => {
  if (name !== './systems-check-runner.ts') throw new Error('Unexpected adapter dependency'); return core;
});
const consume = vi.fn();
const host = load('supabase/functions/_shared/systems-check-manual-http.ts', name => {
  if (name === './systems-check-http.ts') return http;
  if (name === './systems-check-manual-work.ts') return { ...work, consumeManualSystemsCheckWork: consume };
  if (name === './systems-check-runner.ts') return core;
  throw new Error('Unexpected host dependency: ' + name);
});
const handle = host.handleManualSystemsWork as (request: Request, ports: Record<string, unknown>) => Promise<Response>;
const ID = 'b4000000-0000-4000-8000-00000000a002';
const url = 'https://unit-test.invalid/functions/v1/systems-check-run-onboarding?manual_work=1';
function request(body: unknown = { work_id: ID }, headers: Record<string, string> = {}, target = url) {
  return new Request(target, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-internal-service', ...headers }, body: JSON.stringify(body) });
}
function fixture() {
  const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
  const admin = { rpc }; activeAdmin = admin;
  const tasks: Promise<void>[] = [], controllers: Array<{ milliseconds: number; controller: AbortController }> = [];
  const deadline = vi.fn((milliseconds: number) => { const controller = new AbortController(); controllers.push({ milliseconds, controller }); return controller.signal; });
  const defer = vi.fn((task: Promise<void>) => { tasks.push(task); });
  return { admin, rpc, tasks, controllers, deadline, defer, ports: { admin, defer, deadline } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
beforeEach(() => { vi.restoreAllMocks(); consume.mockReset().mockResolvedValue({ workId: ID, confirmation: 'unconfirmed' }); });

describe('Original Systems host private manual purpose, no public admission', () => {
  it('acknowledges delivery without waiting for or inventing execution; one existing lifetime owns the task', async () => {
    const f = fixture(); let finish!: () => void;
    consume.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const response = await handle(request(), f.ports);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ work_id: ID, dispatch_acknowledged: true, execution_confirmed: false });
    expect(f.defer).toHaveBeenCalledTimes(1); expect(consume).toHaveBeenCalledTimes(1);
    const input = consume.mock.calls[0][0];
    expect(Object.keys(input).sort()).toEqual(['admin', 'captureSignal', 'settlementSignal', 'workId']);
    expect(input.workId).toBe(ID); expect(input.admin).toBe(f.admin);
    expect(f.controllers.map(c => c.milliseconds)).toEqual([5_000, 90_000]);
    f.controllers[1].controller.abort();
    const settlement = input.settlementSignal();
    expect(settlement).not.toBe(input.captureSignal); expect(settlement.aborted).toBe(false);
    expect(f.controllers.at(-1)?.milliseconds).toBe(5_000);
    finish(); await f.tasks[0]; expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each(['', 'Bearer synthetic-anon', 'Bearer ordinary-user-jwt', 'Bearer service_role', 'service_role'])(
    'refuses unsupported credential %j without task/claim/data', async Authorization => {
      const f = fixture(), response = await handle(request(undefined, { Authorization }), f.ports);
      expect(response.status).toBe(401); expect(f.defer).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
      expect(JSON.stringify(await response.json())).not.toContain('synthetic-internal-service');
    });
  it('reuses the original verified cron gate without creating a recurring producer', async () => {
    const f = fixture(); f.rpc.mockResolvedValue({ data: true, error: null });
    const response = await handle(request(undefined, { Authorization: '', 'x-cron-token': 'synthetic-cron' }), f.ports);
    expect(response.status).toBe(202); await f.tasks[0];
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('verify_cron_token', { _token: 'synthetic-cron' });
    expect(consume).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { work_id: 'bad' }, { work_id: ID.toUpperCase() }, { work_id: ID, tenant_id: 'foreign' }, { work_id: ID, runner_keys: ['x'] }, [], null])(
    'refuses malformed/expanded request %j before work', async body => {
      const f = fixture(); expect((await handle(request(body), f.ports)).status).toBe(400);
      expect(consume).not.toHaveBeenCalled(); expect(f.defer).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
    });
  it.each(['manual_work=0', 'manual_work=1&manual_work=1', 'manual_work=1&tenant_id=foreign', ''])('refuses ambiguous purpose %s', async query => {
    const f = fixture(); expect((await handle(request(undefined, {}, url.split('?')[0] + '?' + query), f.ports)).status).toBe(400);
    expect(f.deadline).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
  });
  it.each(['GET', 'PUT', 'DELETE'])('refuses %s without reading a body or creating a task', async method => {
    const f = fixture(); expect((await handle(new Request(url, { method }), f.ports)).status).toBe(405); expect(f.deadline).not.toHaveBeenCalled();
  });
  it('bounds actual UTF8 bytes rather than a supplied Content-Length', async () => {
    const f = fixture(), req = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '1' }, body: JSON.stringify({ work_id: ID, text: 'é'.repeat(2_100) }) });
    expect((await handle(req, f.ports)).status).toBe(400); expect(f.defer).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
  });
  it('refuses non-JSON content, invalid JSON and invalid UTF8', async () => {
    const f = fixture();
    for (const [type, body] of [['text/plain', '{}'], ['application/json', '{'], ['application/json', new Uint8Array([0xff])]] as const) {
      expect((await handle(new Request(url, { method: 'POST', headers: { 'Content-Type': type }, body }), f.ports)).status).toBe(400);
    }
    expect(f.defer).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
  });
  it('cancels an unending body at the native transport deadline without ever claiming', async () => {
    const f = fixture(), cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel });
    const req = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' } as RequestInit);
    const pending = handle(req, f.ports); await tick(); f.controllers[0].controller.abort();
    expect((await pending).status).toBe(400); expect(cancel).toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
  });
  it('bounds an uncooperative original cron preflight; its late answer cannot launch work', async () => {
    const f = fixture(); let release!: (value: unknown) => void;
    f.rpc.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = handle(request(undefined, { Authorization: '', 'x-cron-token': 'synthetic-cron' }), f.ports);
    await tick(); f.controllers[0].controller.abort(); expect((await pending).status).toBe(503);
    release({ data: true, error: null }); await tick(); expect(f.defer).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
  });
  it('refuses a disconnected caller after an otherwise valid original preflight', async () => {
    const f = fixture(), caller = new AbortController(); let release!: (value: unknown) => void;
    f.rpc.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const req = new Request(request(undefined, { Authorization: '', 'x-cron-token': 'synthetic-cron' }), { signal: caller.signal });
    const pending = handle(req, f.ports); await tick(); caller.abort(); release({ data: true, error: null });
    expect((await pending).status).toBe(400); expect(f.defer).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
  });
  it.each([{ data: false, error: null }, { data: 'true', error: null }, { data: true, error: { message: 'private' } }])(
    'retains the original strict cron refusal for %j', async reply => {
      const f = fixture(); f.rpc.mockResolvedValue(reply);
      expect((await handle(request(undefined, { Authorization: '', 'x-cron-token': 'synthetic-cron' }), f.ports)).status).toBe(401);
      expect(consume).not.toHaveBeenCalled(); expect(f.defer).not.toHaveBeenCalled();
    });
  it.each(['missing', 'throws'])('does not claim if existing platform lifetime is %s', async kind => {
    const f = fixture(); const defer = kind === 'missing' ? undefined : () => { throw new Error('Private platform failure'); };
    const response = await handle(request(), { ...f.ports, defer });
    expect(response.status).toBe(503); await tick(); expect(consume).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain('Private platform failure');
  });
  it('contains a failed deferred operation without a success response, replay or unhandled rejection', async () => {
    const f = fixture(); vi.spyOn(console, 'warn').mockImplementation(() => {});
    consume.mockRejectedValue(new Error('Private source detail'));
    const response = await handle(request(), f.ports); await f.tasks[0];
    expect(response.status).toBe(202); expect((await response.json()).execution_confirmed).toBe(false);
    expect(consume).toHaveBeenCalledTimes(1); expect(console.warn).toHaveBeenCalledExactlyOnceWith('[systems-check] private manual dispatch unconfirmed');
  });
});

describe('Actual original onboarding entry point preserves its ordinary contract', () => {
  const scan = vi.fn();
  function originalEntry(runtime?: unknown) {
    let handler!: (req: Request) => Promise<Response>;
    load('supabase/functions/systems-check-run-onboarding/index.ts', name => {
      if (name === '../_shared/systems-check-runner.ts') return { runSystemsCheck: scan };
      if (name === '../_shared/systems-check-runners/index.ts') return {};
      if (name === '../_shared/systems-check-http.ts') return http;
      if (name === '../_shared/systems-check-manual-http.ts') return host;
      throw new Error('Unexpected original entry dependency: ' + name);
    }, { ...deno, serve: (fn: typeof handler) => { handler = fn; } }, runtime);
    return handler;
  }
  beforeEach(() => { scan.mockReset().mockResolvedValue({ run_id: 'original-run' }); });
  const ordinary = (body: unknown, Authorization = 'Bearer synthetic-internal-service') =>
    request(body, { Authorization }, url.split('?')[0]);

  it('keeps CORS and unsupported-method responses outside both execution paths', async () => {
    const f = fixture(), endpoint = originalEntry({ waitUntil: f.defer });
    expect((await endpoint(new Request(url, { method: 'OPTIONS' }))).status).toBe(200);
    expect((await endpoint(new Request(url, { method: 'GET' }))).status).toBe(405);
    expect(scan).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('keeps original provisioning tenant requirement, full flavor and action filing', async () => {
    const f = fixture(), endpoint = originalEntry({ waitUntil: f.defer });
    expect((await endpoint(ordinary({}))).status).toBe(400); expect(scan).not.toHaveBeenCalled();
    const response = await endpoint(ordinary({ tenant_id: 'test-tenant-original' }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, run_id: 'original-run' });
    expect(scan).toHaveBeenCalledExactlyOnceWith({ admin: f.admin, tenantId: 'test-tenant-original', scanFlavor: 'onboarding', actionFiling: 'all', triggeredBy: { source: 'provisioning', owner_initiated: false } });
    expect(f.defer).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
  });
  it('keeps verified ordinary JWT resolution and ignores a supplied foreign tenant', async () => {
    const f = fixture(); Object.assign(f.admin, { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-original' } }, error: null }) } });
    f.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'current_user_tenant_id' ? 'test-tenant-authorized' : false, error: null }));
    const endpoint = originalEntry({ waitUntil: f.defer });
    expect((await endpoint(ordinary({ tenant_id: 'test-tenant-foreign' }, 'Bearer ordinary-verified-user'))).status).toBe(200);
    expect(scan).toHaveBeenCalledExactlyOnceWith({ admin: f.admin, tenantId: 'test-tenant-authorized', scanFlavor: 'onboarding', actionFiling: 'all', triggeredBy: { source: 'onboarding', owner_initiated: false } });
    expect(f.rpc.mock.calls.map(call => call[0])).toEqual(['is_platform_owner', 'current_user_tenant_id']);
    expect(consume).not.toHaveBeenCalled(); expect(f.defer).not.toHaveBeenCalled();
  });
  it('keeps invalid ordinary JWT refusal without native work', async () => {
    const f = fixture(); Object.assign(f.admin, { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } }) } });
    expect((await originalEntry()(ordinary({ tenant_id: 'test-tenant-foreign' }, 'Bearer invalid-user'))).status).toBe(401);
    expect(scan).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
  });
  it('routes only the explicit private purpose to the existing bounded platform lifetime', async () => {
    const f = fixture(), endpoint = originalEntry({ waitUntil: f.defer });
    expect((await endpoint(request())).status).toBe(202); await f.tasks[0];
    expect(f.defer).toHaveBeenCalledTimes(1); expect(consume).toHaveBeenCalledTimes(1); expect(scan).not.toHaveBeenCalled();
  });
  it('does not fall through a malformed private marker to remediation or user authorization', async () => {
    const f = fixture(), endpoint = originalEntry({ waitUntil: f.defer });
    expect((await endpoint(request({ tenant_id: 'test-tenant-original' }, {}, url.replace('=1', '=0')))).status).toBe(400);
    expect((await endpoint(request(undefined, { Authorization: 'Bearer ordinary-user' }))).status).toBe(401);
    expect(f.rpc).not.toHaveBeenCalled(); expect(scan).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
  });
  it('fails closed when the existing background lifetime is absent', async () => {
    const f = fixture(); expect((await originalEntry()(request())).status).toBe(503);
    expect(scan).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled(); expect(f.defer).not.toHaveBeenCalled();
  });
  it('retains the original scan failure without fabricating a completed result', async () => {
    fixture(); vi.spyOn(console, 'error').mockImplementation(() => {}); scan.mockRejectedValue(new Error('synthetic-source-failure'));
    const response = await originalEntry()(ordinary({ tenant_id: 'test-tenant-original' }));
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: 'scan_failed', detail: 'synthetic-source-failure' });
    expect(consume).not.toHaveBeenCalled();
  });
});
