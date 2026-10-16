// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const actor = '00000000-0000-4000-8000-000000000001';
const victim = '00000000-0000-4000-8000-000000000002';
type Body = Record<string, unknown>;

// Execute the actual compatibility handler, replacing only its network and
// environment ports. An ordinary JWT must never become a service-role request.
function shim(serviceKey: string | undefined = 'fixture-service') {
  let handler!: (request: Request) => Promise<Response>;
  const forwarded = vi.fn(async (_url: string, _init: RequestInit) => Response.json({
    run_id: '00000000-0000-4000-8000-000000000003', findings: [], sources: [],
    coverage: { configured: true, stop_reason: 'no_results', note: 'Protected fixture' },
  }));
  const scope = { corsHeaders: { 'Access-Control-Allow-Origin': '*' }, fetch: forwarded,
    Deno: { env: { get: (key: string) => key === 'SUPABASE_SERVICE_ROLE_KEY' ? serviceKey : 'https://local.invalid' }, serve: (fn: typeof handler) => { handler = fn; } } };
  const raw = readFileSync('supabase/functions/subagent-financial-research/index.ts', 'utf8');
  const ast = ts.createSourceFile('shim.ts', raw, ts.ScriptTarget.Latest, true);
  const code = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n');
  new Function(...Object.keys(scope), ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText)(...Object.values(scope));
  const run = async (authorization?: string, body: Body = { input: { question: 'Protected fixture question' }, user_id: actor }, method = 'POST') => {
    const response = await handler(new Request('https://local.invalid/shim', { method,
      headers: { ...(authorization === undefined ? {} : { Authorization: authorization }), 'X-Orchestrator-Call': '1' },
      ...(method === 'OPTIONS' ? {} : { body: JSON.stringify(body) }),
    }));
    return { response, body: method === 'OPTIONS' ? null : await response.json() };
  };
  return { run, forwarded };
}

describe('deprecated research compatibility door preserves service authority', () => {
  it.each([undefined, '', 'Bearer fixture-ordinary-user', 'Bearer arbitrary-token', 'fixture-service'])('refuses untrusted caller %s before forwarding any asserted actor', async authorization => {
    const test = shim(); const { response, body } = await test.run(authorization, { input: { question: 'Protected question', user_id: victim }, user_id: victim });
    expect(response.status).toBe(401); expect(body.ok).toBe(false); expect(test.forwarded).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(victim);
  });
  it('fails closed when trusted service authority is unconfigured', async () => {
    const test = shim(''); const { response } = await test.run('Bearer fixture-ordinary-user');
    expect(response.status).toBe(401); expect(test.forwarded).not.toHaveBeenCalled();
  });
  it.each([false, true])('preserves the existing trusted service payload including its actor location (nested=%s)', async nested => {
    const test = shim(); const { response } = await test.run('Bearer fixture-service', nested
      ? { input: { question: 'Protected question', user_id: actor } }
      : { input: { question: 'Protected question' }, user_id: actor });
    expect(response.status).toBe(200); expect(test.forwarded).toHaveBeenCalledTimes(1);
    const [url, init] = test.forwarded.mock.calls[0]; expect(url).toBe('https://local.invalid/functions/v1/paige-deep-research');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer fixture-service' });
    expect(JSON.parse(String(init.body))).toMatchObject({ user_id: actor, persist: false, max_hops: 2, strict: true });
  });
  it('retains service request validation without making a provider call', async () => {
    const test = shim(); const { response } = await test.run('Bearer fixture-service', { input: { question: 'Protected question' } });
    expect(response.status).toBe(400); expect(test.forwarded).not.toHaveBeenCalled();
  });
  it('keeps CORS preflight non-effectful', async () => {
    const test = shim(); const { response } = await test.run(undefined, {}, 'OPTIONS');
    expect(response.status).toBe(200); expect(test.forwarded).not.toHaveBeenCalled();
  });
});
