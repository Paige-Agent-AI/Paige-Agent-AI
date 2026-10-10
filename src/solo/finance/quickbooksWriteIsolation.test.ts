import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { refuseLegacyQuickBooksWrite } from '../../../supabase/functions/_shared/finance/quickbooks-write-isolation';

// Execute the deployed handler with controlled Auth, not a copied handler.
function handler(getUser: ReturnType<typeof vi.fn>) {
  const source = readFileSync('supabase/functions/quickbooks-update-transaction-category/index.ts', 'utf8');
  const code = source.slice(source.indexOf('serve(async')).replace(/^serve\(/, 'return (').replace(/\);\s*$/, ');');
  const clients: string[] = [];
  const providerAccess = vi.fn(() => { throw new Error('Forbidden provider access'); });
  const createClient = (_url: string, key: string) => {
    clients.push(key);
    if (key !== 'test-anon') throw new Error('Privileged client created');
    return { auth: { getUser }, from: providerAccess, rpc: providerAccess, functions: { invoke: providerAccess } };
  };
  const javascript = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = new Function('createClient', 'Deno', 'refuseLegacyQuickBooksWrite', 'corsHeaders', javascript)(
    createClient, { env: { get: (key: string) => ({ SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service' })[key] } },
    refuseLegacyQuickBooksWrite, {},
  ) as (request: Request) => Promise<Response>;
  return { run, clients, providerAccess };
}
const request = (authorization?: string, body = '{}', method = 'POST') => new Request('https://test.invalid', {
  method, headers: authorization ? { Authorization: authorization } : {},
  ...(method === 'POST' ? { body } : {}),
});

describe('deployed QuickBooks accounting-write isolation', () => {
  it.each([undefined, '', 'Basic test', 'Bearer ', 'Bearer test extra'])('refuses malformed credentials before Auth: %s', async auth => {
    const getUser = vi.fn(); const h = handler(getUser);
    expect((await h.run(request(auth))).status).toBe(401);
    expect(getUser).not.toHaveBeenCalled(); expect(h.clients).toEqual([]);
    expect(h.providerAccess).not.toHaveBeenCalled();
  });
  it.each(['test-invalid', 'test-expired', 'test-revoked', 'test-service'])('requires a verified actor: %s', async token => {
    const h = handler(vi.fn(async () => ({ data: { user: null }, error: { message: 'private Auth error' } })));
    const response = await h.run(request(`Bearer ${token}`));
    expect(response.status).toBe(401); expect(await response.text()).not.toContain('private');
    expect(h.clients).toEqual(['test-anon']); expect(h.providerAccess).not.toHaveBeenCalled();
  });
  it.each(['{}', 'null', '[]', 'invalid JSON', JSON.stringify({ user_id: 'test-other', tenant_id: 'test-other', qb_transaction_id: 'private-id', new_account_id: 'private-account' })])('contains authenticated input without effects: %s', async body => {
    const getUser = vi.fn(async () => ({ data: { user: { id: 'test-owner' } }, error: null }));
    const h = handler(getUser); const response = await h.run(request('Bearer test-owner-token', body));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'ACCOUNTING_WRITE_UNAVAILABLE', reason: 'Accounting changes are unavailable', provider_effect: false });
    expect(getUser).toHaveBeenCalledOnce(); expect(h.clients).toEqual(['test-anon']);
    expect(h.providerAccess).not.toHaveBeenCalled(); expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('sanitizes Auth errors without reading financial records', async () => {
    const h = handler(vi.fn(async () => { throw new Error('private credential'); }));
    const response = await h.run(request('Bearer test-owner-token'));
    expect(response.status).toBe(401); expect(await response.text()).not.toContain('private');
    expect(h.providerAccess).not.toHaveBeenCalled();
  });
  it.each(['GET', 'PUT', 'DELETE'])('does not authenticate or execute unsupported %s', async method => {
    const getUser = vi.fn(); const h = handler(getUser);
    const response = await h.run(request('Bearer test-owner-token', '{}', method));
    expect(response.status).toBe(405); expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
    expect(getUser).not.toHaveBeenCalled(); expect(h.clients).toEqual([]);
  });
  it('permits effect-free preflight', async () => {
    const getUser = vi.fn(); const h = handler(getUser);
    expect((await h.run(request(undefined, '{}', 'OPTIONS'))).status).toBe(204);
    expect(getUser).not.toHaveBeenCalled(); expect(h.clients).toEqual([]);
  });
});
