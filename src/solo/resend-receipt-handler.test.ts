// @vitest-environment node
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as persistence from '../../supabase/functions/handle-resend-webhook/handler';

const secret = 'whsec_' + Buffer.from('isolated-receipt-test-key').toString('base64');
const now = 1788480000000;
const payload = { type: 'email.delivered', created_at: '2026-09-04T00:00:00Z', data: { email_id: 'provider-message-1', to: ['never-store@example.invalid'], subject: 'never-store-content' } };
function request(body = JSON.stringify(payload), id = 'msg_receipt1', timestamp = String(now / 1000)) {
  const sig = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64');
  return new Request('https://example.invalid/receipt', { method: 'POST', headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${sig}` }, body });
}
function harness(result: unknown = { data: 'processed', error: null }, signingSecret = secret, settingsSecret: unknown = null) {
  const ingest = vi.fn().mockResolvedValue(result);
  const log = vi.fn();
  let handle!: (request: Request) => Promise<Response>;
  // Answers only the exact read the real schema supports (admin_app_settings.key → value), so a
  // handler that asks for the wrong column gets nothing, as it would in production.
  const settingsRead = vi.fn((table: string, field: string, column: string, key: string) => ({
    data: table === 'admin_app_settings' && field === 'value' && column === 'key' && key === 'resend_webhook_secret' && settingsSecret !== null ? { value: settingsSecret } : null,
    error: null,
  }));
  const createClient = vi.fn(() => ({
    rpc: (_name: string, args: Record<string, unknown>) => ingest({
      receiptId: args._receipt_id, messageId: args._message_id, status: args._status, eventAt: args._event_at,
    }),
    from: (table: string) => ({ select: (field: string) => ({ eq: (column: string, key: string) => ({ maybeSingle: async () => settingsRead(table, field, column, key) }) }) }),
  }));
  const source = ts.transpileModule(readFileSync('supabase/functions/handle-resend-webhook/index.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requireTest = (name: string) => {
    if (name === 'npm:@supabase/supabase-js@2') return { createClient };
    if (name === './handler.ts') return persistence;
    throw new Error('unexpected test import');
  };
  // Execute the real Deno entry point with isolated IO, not a second handler implementation.
  new Function('require', 'exports', 'Deno', 'Date', 'console', source)(requireTest, {}, {
    env: { get: (name: string) => name === 'RESEND_WEBHOOK_SECRET' ? signingSecret : 'isolated-config' },
    serve: (callback: typeof handle) => { handle = callback; },
  }, class extends Date { static now() { return now; } }, { info: log, error: log });
  return { ingest, log, handle, createClient, settingsRead };
}
describe('verified shared receipt boundary', () => {
  it('passes only minimal verified fields to persistence', async () => {
    const h = harness(); expect((await h.handle(request())).status).toBe(200);
    expect(h.ingest).toHaveBeenCalledWith({ receiptId: 'msg_receipt1', messageId: 'provider-message-1', status: 'delivered', eventAt: '2026-09-04T00:00:00.000Z' });
    expect(JSON.stringify(h.ingest.mock.calls)).not.toMatch(/never-store|subject|recipient|tenant/);
  });
  it('refuses tampering before persistence', async () => {
    const h = harness(); const r = request(); r.headers.set('svix-signature', 'v1,invalid');
    expect((await h.handle(r)).status).toBe(401); expect(h.ingest).not.toHaveBeenCalled(); expect(h.createClient).not.toHaveBeenCalled();
  });
  it('refuses stale signatures before persistence', async () => {
    const h = harness(); expect((await h.handle(request(undefined, undefined, String(now / 1000 - 301)))).status).toBe(401); expect(h.ingest).not.toHaveBeenCalled();
  });
  it('fails closed when signing is unconfigured', async () => {
    const { ingest, handle, settingsRead, log } = harness(undefined, '');
    expect((await handle(request())).status).toBe(503); expect(ingest).not.toHaveBeenCalled();
    expect(settingsRead).toHaveBeenCalledWith('admin_app_settings', 'value', 'key', 'resend_webhook_secret'); expect(log).toHaveBeenCalledWith('receipt_not_configured');
  });
  it('refuses a settings-row value that is not a signing secret', async () => {
    const h = harness(undefined, '', 'not-a-whsec'); expect((await h.handle(request())).status).toBe(503); expect(h.ingest).not.toHaveBeenCalled();
  });
  it('verifies against the operator settings secret when env is unset', async () => {
    const h = harness(undefined, '', secret); expect((await h.handle(request())).status).toBe(200);
    expect(h.ingest).toHaveBeenCalledWith({ receiptId: 'msg_receipt1', messageId: 'provider-message-1', status: 'delivered', eventAt: '2026-09-04T00:00:00.000Z' });
    const t = harness(undefined, '', secret); const r = request(); r.headers.set('svix-signature', 'v1,invalid');
    expect((await t.handle(r)).status).toBe(401); expect(t.ingest).not.toHaveBeenCalled();
  });
  it('fails closed on malformed signing configuration without database access', async () => {
    const h = harness(undefined, 'whsec_%%%'); const r = await h.handle(request());
    expect(r.status).toBe(401); expect(h.createClient).not.toHaveBeenCalled();
  });
  it('rejects oversized signed bodies without database access', async () => {
    const h = harness(); const r = await h.handle(request(JSON.stringify({ ...payload, padding: 'x'.repeat(262145) })));
    expect(r.status).toBe(400); expect(h.createClient).not.toHaveBeenCalled();
  });
  it('ignores inbound tenant and invitation claims; only source correlation crosses the boundary', async () => {
    const h = harness(); await h.handle(request(JSON.stringify({ ...payload, tenant_id: 'other-tenant', data: { ...payload.data, invite_id: 'other-invite' } })));
    expect(JSON.stringify(h.ingest.mock.calls)).not.toMatch(/other-tenant|other-invite/);
  });
  it.each(['null', '[]', '{', JSON.stringify({ ...payload, data: { email_id: {} } }), JSON.stringify({ ...payload, created_at: 'invalid' })])('rejects malformed payload %s without writes', async body => {
    const h = harness(); expect((await h.handle(request(body))).status).toBe(400); expect(h.ingest).not.toHaveBeenCalled();
  });
  it('ignores unknown types without reflecting them or accessing persistence', async () => {
    const h = harness(); const r = await h.handle(request(JSON.stringify({ ...payload, type: 'private-payload-text' })));
    expect(r.status).toBe(200); expect(await r.text()).not.toContain('private-payload-text'); expect(h.ingest).not.toHaveBeenCalled();
  });
  it.each(['pending', 'processed', 'duplicate', 'unresolved'])('acknowledges durable %s without inventing an outcome', async state => {
    const h = harness({ data: state, error: null }); const r = await h.handle(request());
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ ok: true });
  });
  it('refuses conflicting identity safely', async () => {
    const h = harness({ data: 'conflict', error: null }); expect((await h.handle(request())).status).toBe(409);
  });
  it('never logs returned database error text', async () => {
    const h = harness({ data: null, error: { message: 'secret-db-error-recipient', details: 'invite-token' } });
    const r = await h.handle(request()); expect(r.status).toBe(503);
    expect(JSON.stringify(h.log.mock.calls)).toBe('[["receipt_store_unavailable"]]'); expect(await r.text()).not.toMatch(/secret|token|recipient/);
  });
  it('never logs thrown database error text', async () => {
    const h = harness(); h.ingest.mockRejectedValue(new Error('secret-db-error-recipient'));
    expect((await h.handle(request())).status).toBe(503); expect(h.log.mock.calls).toEqual([['receipt_store_unavailable']]);
  });
  it('rejects unexpected persistence results', async () => {
    const h = harness({ data: 'raw-private-output', error: null }); const r = await h.handle(request());
    expect(r.status).toBe(503); expect(await r.text()).not.toContain('raw-private-output');
  });
  it('accepts each already-supported provider status without adding types', async () => {
    for (const status of ['sent', 'delivered', 'delivery_delayed', 'opened', 'clicked', 'bounced', 'complained']) {
      const h = harness(); expect((await h.handle(request(JSON.stringify({ ...payload, type: `email.${status}` })))).status).toBe(200);
      expect(h.ingest.mock.calls[0][0].status).toBe(status);
    }
  });
});
