// PC-1 — concurrent budget enforcement proof (#2003 coordinator P2): 12 service-role callers race
// the browse budget gate (61s worst-case reservations — the interpreter's retry-aware constant)
// against a day budget that admits exactly 2; the
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
    // The child's LAST stdout line is the gate verdict — earlier statements (set_config) emit
    // their own result rows, so match on the final line only (CI round 3 fix).
    child.on('close', code => (code === 0 ? resolve(output.trim().split('\n').pop()) : reject(new Error('concurrency query failed'))));
    child.stdin.end(`BEGIN; SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',true); SELECT public.secure_browser_browse_budget_gate('${T}',61)->>'allowed'; COMMIT;`);
  });

  const outcomes = await Promise.all(Array.from({ length: 12 }, invoke));
  assert.equal(outcomes.filter(v => v === 'true').length, 2, 'exactly 2 reservations fit the 180s budget (61s each)');
  assert.equal(outcomes.filter(v => v === 'false').length, 10, 'the other 10 racers were refused');
  const reserved = Number(run(`SELECT reserved_seconds FROM public.secure_browser_usage_windows WHERE tenant_id='${T}' AND window_kind='day';`).trim());
  assert.equal(reserved, 122, 'reserved seconds never exceed the daily cap under concurrency');
  console.log('PASS: 12 concurrent service callers, exactly 2 reservations (61s each), reserved==122 of 180 cap, no overbook.');
} finally {
  // Best-effort child-row cleanup ONLY: tenants/users are guarded by the operator-archive lane
  // (raw DELETE raises "permanent deletion requires the canonical confirmed operation" — hit in
  // CI). The CI database is disposable (asserted above), so the synthetic 5c…cc rows may remain.
  try {
    run(`DELETE FROM public.secure_browser_usage_windows WHERE tenant_id='${T}';
DELETE FROM public.secure_browser_tenant_limits WHERE tenant_id='${T}';
DELETE FROM public.profiles WHERE user_id='${U}';
DELETE FROM public.tenant_members WHERE tenant_id='${T}';`);
  } catch { /* guards may refuse even child rows on a shared DB — the DB is disposable in CI */ }
}
