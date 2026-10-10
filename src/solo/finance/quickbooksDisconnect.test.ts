import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function handler(readError = false, updateError = false, user = true) {
  const source = readFileSync('supabase/functions/quickbooks-disconnect/index.ts', 'utf8');
  const body = source.slice(source.indexOf('serve(async (req) => {')).replace(/^serve\(/, 'return (').replace(/\);\s*$/, ');');
  const revokeToken = vi.fn();
  const deleted = vi.fn(() => { throw new Error('Historical connection must not be deleted'); });
  const updates: unknown[] = [];
  let updating = false;
  const query = {
    select: () => query, eq: () => query,
    update: (value: unknown) => { updates.push(value); updating = true; return query; },
    delete: deleted,
    maybeSingle: async () => updating
      ? { data: updateError ? null : { id: 'test-connection' }, error: updateError ? {} : null }
      : { data: { id: 'test-connection', refresh_token_encrypted: 'synthetic' }, error: readError ? {} : null },
    insert: async () => ({ error: null }),
  };
  const client = { from: () => query, rpc: async () => ({ data: 'synthetic-token' }) };
  const createClient = (_url: string, key: string) => key === 'service' ? client : { auth: { getUser: async () => ({ data: { user: user ? { id: 'test-user' } : null } }) } };
  const code = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = new Function('createClient', 'Deno', 'revokeToken', 'corsHeaders', code)(createClient,
    { env: { get: (key: string) => key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service' : 'synthetic' } }, revokeToken, {});
  return { run: run as (request: Request) => Promise<Response>, revokeToken, deleted, updates };
}
const request = () => new Request('https://test.invalid', { method: 'POST', headers: { Authorization: 'Bearer synthetic' } });
describe('actual QuickBooks disconnect lifecycle', () => {
  it('retains the anchor and reports provider revocation as unverified', async () => {
    const h = handler(); const response = await h.run(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, disconnected: true, provider_revocation: 'unverified' });
    expect(h.updates).toEqual([{ is_active: false }]); expect(h.deleted).not.toHaveBeenCalled();
  });
  it.each([[true, false], [false, true]])('refuses read/update failure without provider effects', async (read, update) => {
    const h = handler(read, update); expect((await h.run(request())).status).toBe(503);
    expect(h.revokeToken).not.toHaveBeenCalled(); expect(h.deleted).not.toHaveBeenCalled();
  });
  it('rejects an unverified caller before connection work', async () => {
    const h = handler(false, false, false); expect((await h.run(request())).status).toBe(401);
    expect(h.updates).toEqual([]); expect(h.revokeToken).not.toHaveBeenCalled();
  });
});
