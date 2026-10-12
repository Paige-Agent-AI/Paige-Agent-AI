import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
const base = new URL('../', import.meta.url);
function source(file) {
  return process.env.COMMS_FAILING_FIRST === '1'
    ? execFileSync('git', ['show', `HEAD:supabase/functions/${file}/index.ts`], { encoding: 'utf8' })
    : fs.readFileSync(new URL(`${file}/index.ts`, base), 'utf8');
}
function load(file, decision) {
  let handler; const effects = []; const scopes = [];
  const admin = { rpc: async name => ({ data: name === 'current_user_tenant_id' ? 'tenant' : true, error: null }), auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }) }, from: () => { throw Error('unexpected durable access'); } };
  const sandbox = { Request, Response, URL, Date, JSON, console,
    resolveTenantForUser: async () => ({ tenantId: 'tenant' }),
    assertHostAllowed: async () => { effects.push({ kind: 'dns' }); return { ok: true }; },
    Deno: { env: { get: key => key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'internal' : 'https://local.invalid' }, serve: fn => { handler = fn; } },
    serve: fn => { handler = fn; }, createClient: () => admin,
    commsProviderExecutionAllowed: async (_admin, scope) => { scopes.push(scope); return decision; },
    fetch: async (url, init) => { effects.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ success: true }), { status: 200 }); },
  };
  const code = stripTypeScriptTypes(source(file).replace(/^import .*?;?\r?\n/gm, ''), { mode: 'transform' });
  vm.runInNewContext(code, sandbox);
  return { handler, effects, scopes };
}
for (const [file, body] of [
  ['send-sms', { user_id: 'actor', message_type: 'verification', message_body: 'Synthetic check' }],
  ['send-sms-verification', { phone_number: '+12025550123' }],
  ['send-sms-reminder', { userId: 'actor', to: '+12025550123', message: 'Synthetic check' }],
  ['smtp-connect', { host: 'smtp.invalid', port: 465, username: 'synthetic', password: 'test-only', from_address: 'qa@example.invalid' }],
]) {
  test(`${file} refuses before provider or durable work`, async () => {
    const state = load(file, false);
    const result = await state.handler(new Request('https://local.invalid', { method: 'POST', headers: { Authorization: 'Bearer internal' }, body: JSON.stringify(body) }));
    assert.equal(state.effects.length, 0); assert.equal(result.status, 403); assert.equal(state.scopes[0].actorUserId, 'actor');
  });
}
test('ordinary reminder retains dispatcher payload', async () => {
  const state = load('send-sms-reminder', true);
  const result = await state.handler(new Request('https://local.invalid', { method: 'POST', headers: { Authorization: 'Bearer internal' }, body: JSON.stringify({ userId: 'actor', to: '+12025550123', message: 'Synthetic check' }) }));
  assert.equal(result.status, 200); assert.equal(state.effects.length, 1);
  assert.deepEqual(state.effects[0].body, { user_id: 'actor', message_type: 'service_notification', message_body: 'Synthetic check', to_phone: '+12025550123' });
});
