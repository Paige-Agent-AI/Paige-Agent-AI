// PC-1 — concurrent budget enforcement proof (#2003 coordinator P2): 12 service-role callers race
// the browse budget gate against a day budget that admits exactly 4 worst-case reservations; the
// limits-row FOR UPDATE + day-window reservation in secure_browser_browse_budget_gate must let
// EXACTLY 4 through and refuse the other 8 with control_plane:daily_budget — the reserved column
// can never exceed the cap. Mirrors scripts/proof/resend-receipt-concurrency.mjs (psql children on
// the disposable CI database; never echoes DB error text).
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const url = new URL(process.env.RECEIPT_TEST_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
assert.equal(url.hostname, '127.0.0.1', 'Disposable loopback database required');
assert.ok(process.env.CI === 'true' && url.port === '54322' && url.pathname === '/postgres', 'Run only against the disposable CI database');
const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', url.toString()];
const run = sql => execFileSync('psql', args, { input: sql, encoding: 'utf8', windowsHide: true });

const T = '5c000000-0000-4000-8000-00000000cccc';
const U = '5c000000-0000-4000-8000-000000000001';
const suffix = randomUUID().slice(0, 8);
try {
  run(`INSERT INTO auth.users(id,aud,role,email) VALUES ('${U}','authenticated','authenticated','browse-conc-${suffix}@tests.invalid');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,owner_user_id)
 VALUES ('${T}','browse-conc-${suffix}','Browse Concurrency','active','standalone','SBX',9395999,'{"secure_browser":true}','${U}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES ('${T}','${U}','owner','active',true,now());
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES ('${U}','${T}') ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=excluded.active_tenant_id;
INSERT INTO public.secure_browser_tenant_limits(tenant_id,enabled,worker_available,max_active_sessions,max_session_seconds,max_daily_session_seconds,max_monthly_cost_microusd,configured_by)
 VALUES ('${T}',true,true,5,900,180,0,'${U}');`);

  const invoke = () => new Promise((resolve, reject) => {
    const child = spawn('psql', args, { windowsHide: true }); let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.resume();
    child.on('error', () => reject(new Error('concurrency process unavailable')));
    child.on('close', code => (code === 0 ? resolve(output.trim()) : reject(new Error('concurrency query failed'))));
    child.stdin.end(`SELECT public.secure_browser_browse_budget_gate('${T}',45)->>'allowed';`);
  });

  const outcomes = await Promise.all(Array.from({ length: 12 }, invoke));
  assert.equal(outcomes.filter(v => v === 'true').length, 4, 'exactly 4 reservations fit the 180s budget');
  assert.equal(outcomes.filter(v => v === 'false').length, 8, 'the other 8 racers were refused');
  const reserved = Number(run(`SELECT reserved_seconds FROM public.secure_browser_usage_windows WHERE tenant_id='${T}' AND window_kind='day';`).trim());
  assert.equal(reserved, 180, 'reserved seconds never exceed the daily cap under concurrency');
  console.log('PASS: 12 concurrent service callers, exactly 4 reservations, reserved==cap, no overbook.');
} finally {
  run(`DELETE FROM public.secure_browser_usage_windows WHERE tenant_id='${T}';
DELETE FROM public.secure_browser_tenant_limits WHERE tenant_id='${T}';
DELETE FROM public.profiles WHERE user_id='${U}';
DELETE FROM public.tenant_members WHERE tenant_id='${T}';
DELETE FROM public.tenants WHERE id='${T}';
DELETE FROM auth.users WHERE id='${U}';`);
}
