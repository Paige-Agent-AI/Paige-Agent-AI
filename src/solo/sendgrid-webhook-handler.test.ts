// @vitest-environment node
// ANT-148: actual-handler regression for the SendGrid Event Webhook door.
// Executes the REAL Deno entry point (transpiled) with isolated IO — the same
// harness pattern as resend-receipt-handler.test.ts — covering the corrected
// acknowledgment contract and the timestamped signature protocol.
import { createSign, createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const now = 1788480000;

function event(event_name: string, i = 0, extra: Record<string, unknown> = {}) {
  return { event: event_name, sg_message_id: `msg1.0.filterdrecv-abc`, email: 'c@example.invalid', timestamp: now, ...extra, __i: i };
}
function request(events: unknown[], headers: Record<string, string> = {}) {
  const body = JSON.stringify(events);
  // Official protocol: ES256 over timestamp + raw body, DER-encoded.
  const sig = createSign('sha256').update(String(now)).update(body).sign(privateKey);
  return new Request('https://example.invalid/sg', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-twilio-email-event-webhook-signature': sig.toString('base64'),
      'x-twilio-email-event-webhook-timestamp': String(now),
      ...headers,
    },
    body,
  });
}
function harness(rpcImpl: (args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>, env: Record<string, string> = { SENDGRID_WEBHOOK_PUBLIC_KEY: PEM }) {
  let handle!: (req: Request) => Promise<Response>;
  const consoleSpy = { error: (..._a: unknown[]) => {}, warn: (..._a: unknown[]) => {} };
  const requireTest = (name: string) => {
    if (name === 'npm:@supabase/supabase-js@2') {
      return {
        createClient: () => ({
          rpc: (_n: string, args: Record<string, unknown>) => rpcImpl(args),
        }),
      };
    }
    if (name === '../_shared/webhookSig.ts') return webhookSigExports;
    throw new Error('unexpected test import: ' + name);
  };
  const webhookSigExports: Record<string, unknown> = {};
  const frozenDate = class extends Date { static now() { return now * 1000; } };
  const sharedSource = ts.transpileModule(readFileSync('supabase/functions/_shared/webhookSig.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'Date', sharedSource)(requireTest, webhookSigExports, frozenDate);
  const source = ts.transpileModule(readFileSync('supabase/functions/handle-sendgrid-webhook/index.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'Deno', 'Date', 'console', source)(requireTest, {}, {
    env: { get: (n: string) => env[n] ?? undefined },
    serve: (cb: typeof handle) => { handle = cb; },
  }, frozenDate, consoleSpy);
  return { handle, consoleSpy };
}
const ok = (args: Record<string, unknown>) => Promise.resolve({ data: 'processed', error: null });

describe('sendgrid webhook door (ANT-148 corrections)', () => {
  it('accepts a correctly signed batch and reports per-state counts', async () => {
    const h = harness(ok);
    const res = await h.handle(request([event('delivered'), event('open')]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(2);
  });

  it('rejects a tampered timestamp (signature covers timestamp+body)', async () => {
    const h = harness(ok);
    const res = await h.handle(request([event('delivered')], { 'x-twilio-email-event-webhook-timestamp': String(now + 99) }));
    expect(res.status).toBe(401);
  });

  it('rejects an absent timestamp header and an unsigned request', async () => {
    const h = harness(ok);
    const noTs = request([event('delivered')]);
    noTs.headers.delete('x-twilio-email-event-webhook-timestamp');
    expect((await h.handle(noTs)).status).toBe(401);
    const noSig = request([event('delivered')]);
    noSig.headers.delete('x-twilio-email-event-webhook-signature');
    expect((await h.handle(noSig)).status).toBe(401);
  });

  it('returns 503 (retriable) when the RPC reports an error — never 200', async () => {
    const h = harness(() => Promise.resolve({ data: null, error: { message: 'boom' } }));
    const res = await h.handle(request([event('delivered')]));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.retriable).toBe(true);
  });

  it('returns 503 when the RPC returns pending (unpersisted event)', async () => {
    const h = harness(() => Promise.resolve({ data: 'pending', error: null }));
    expect((await h.handle(request([event('delivered')]))).status).toBe(503);
  });

  it('partial batch: one committed + one pending → 503 (redelivery dedups the committed one)', async () => {
    let call = 0;
    const h = harness(() => {
      call += 1;
      return Promise.resolve(call === 1 ? { data: 'processed', error: null } : { data: 'pending', error: null });
    });
    const res = await h.handle(request([event('delivered', 0), event('open', 1)]));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(body.pending).toBe(1);
  });

  it('duplicate (redelivered) events acknowledge 200', async () => {
    const h = harness(() => Promise.resolve({ data: 'duplicate', error: null }));
    const res = await h.handle(request([event('delivered')]));
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(1);
  });

  it('RPC exception → 503, and an oversized batch is refused 413', async () => {
    const h = harness(ok);
    const events = Array.from({ length: 1001 }, (_, i) => event('delivered', i));
    expect((await h.handle(request(events))).status).toBe(413);
    const throwH = harness(() => Promise.reject(new Error('db down')));
    expect((await throwH.handle(request([event('delivered')]))).status).toBe(503);
  });

  it('ignores unmapped events (unsubscribe/processed/unknown) without persisting', async () => {
    const calls: Record<string, unknown>[] = [];
    const h = harness((args) => { calls.push(args); return Promise.resolve({ data: 'processed', error: null }); });
    const res = await h.handle(request([event('unsubscribe'), event('processed'), event('mystery')]));
    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toBe(3);
    expect(calls.length).toBe(0);
  });

  it('stamps the batch index into the identity so same-second events stay distinct', async () => {
    const ids: string[] = [];
    const h = harness((args) => { ids.push(args._receipt_id as string); return Promise.resolve({ data: 'processed', error: null }); });
    await h.handle(request([event('open', 0), event('open', 1)]));
    expect(ids).toEqual([`sg:msg1:open:${now}:0`, `sg:msg1:open:${now}:1`]);
  });

  it('fails closed 503 without the public key configured', async () => {
    const h = harness(ok, {});
    expect((await h.handle(request([event('delivered')]))).status).toBe(503);
  });
});
