// INT-328 comms.email_send — REAL two-session PostgreSQL concurrency proof.
//
// Creates and drops one fresh database in the explicitly verified disposable local cluster, applies
// scripts/sql/comms-email-send-concurrency-schema.sql (dependency stub) and then the migration
// supabase/migrations/20270596000000_comms_email_send.sql VERBATIM, seeds two tenants, and races
// separate psql sessions (separate backends, separate transactions) against the SQL.
//
// Usage: node scripts/sql/comms-email-send-concurrency-proof.mjs <psql> <local-port> <local-user> <verified-disposable-data-directory>
//
// Interleaving is forced, not hoped for: every racer first waits on a shared advisory "starting gate"
// that a separate holder session owns, the holder is released only once every racer is queued on it,
// and each racer sleeps INSIDE its transaction after the call under test, so a racer that is not
// serialized by the SQL observes the other's uncommitted window. Gate lock ids (7_328_xxx) never
// overlap the migration's hashtextextended(...) keys in practice; the gate takes no lock on any table.
//
// COMMS_EMAIL_MIGRATION_OVERRIDE (optional) applies a different migration file instead — used ONLY to
// prove the assertions bite against a deliberately broken scratch copy. The path used is printed.
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';

const [binary, port, user, expectedDirectory] = process.argv.slice(2);
if (!binary || !/^\d+$/.test(port ?? '') || !user || !expectedDirectory) throw new Error('Usage: node scripts/sql/comms-email-send-concurrency-proof.mjs <psql> <local-port> <local-user> <verified-disposable-data-directory>');
const cwd = fileURLToPath(new URL('.', import.meta.url));
const migrationPath = process.env.COMMS_EMAIL_MIGRATION_OVERRIDE
  || fileURLToPath(new URL('../../supabase/migrations/20270596000000_comms_email_send.sql', import.meta.url));
const args = database => ['-h', '127.0.0.1', '-p', port, '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-q'];
function sync(database, sql) {
  const result = spawnSync(binary, args(database), { cwd, input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const normalized = value => value.trim().replaceAll('\\', '/').toLowerCase().replace(/\/$/, '');
assert.equal(normalized(sync('postgres', 'SHOW data_directory;')), normalized(expectedDirectory), 'refuse any other cluster');
const database = 'comms_email_race_' + randomUUID().replaceAll('-', '');
assert(/^comms_email_race_[a-f0-9]{32}$/.test(database));
sync('postgres', `CREATE DATABASE ${database};`);

// ── sessions ────────────────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function session(sql, appName = 'comms_email_race') {
  return new Promise(resolve => {
    const child = spawn(binary, args(database), { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PGAPPNAME: appName } });
    let stdout = '', stderr = '', done = false;
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const finish = code => { if (!done) { done = true; resolve(parse({ code, stdout, stderr })); } };
    child.on('error', error => { stderr += String(error); finish(1); });
    child.on('close', finish);
    child.stdin.end('\\set VERBOSITY verbose\n' + sql);
  });
}
function parse(run) {
  const line = run.stdout.split(/\r?\n/).find(l => l.startsWith('RESULT '));
  const error = /ERROR:\s+([0-9A-Z]{5}): ([^\n]*)/.exec(run.stderr);
  return { ...run, result: line ? JSON.parse(line.slice(7)) : undefined, sqlstate: error?.[1], message: error?.[2] };
}
async function waitFor(sql, expected, label, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (sync(database, sql) === expected) return;
    if (Date.now() > until) throw new Error('timed out waiting for ' + label);
    await sleep(20);
  }
}
let gateKey = 7328000;
// Runs every body as its own service_role session, all released at the same instant.
async function race(bodies, { holdMs = 500 } = {}) {
  const key = ++gateKey;
  const holder = spawn(binary, args(database), { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const holderClosed = new Promise(resolve => holder.on('close', resolve));
  holder.stdin.write(`SELECT pg_advisory_lock(${key});\n`);
  const lockCount = granted => `SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=${key} AND objsubid=1 AND ${granted ? '' : 'NOT '}granted;`;
  await waitFor(lockCount(true), '1', 'gate holder');
  const runs = bodies.map((body, i) => session(
    `BEGIN;\nSET LOCAL ROLE service_role;\nSELECT pg_advisory_xact_lock_shared(${key});\n${body}\nSELECT pg_sleep(${holdMs / 1000});\nCOMMIT;\n`,
    `comms_email_racer_${key}_${i}`));
  await waitFor(lockCount(false), String(bodies.length), 'every racer queued on the gate');
  holder.stdin.end(`SELECT pg_advisory_unlock(${key});\n`);
  const results = await Promise.all(runs);
  await holderClosed;
  return results;
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const uA = 'f0000000-0328-4000-8000-00000000000a', uB = 'f0000000-0328-4000-8000-00000000000b';
const tA = 'a0000000-0328-4000-8000-00000000000a', tB = 'a0000000-0328-4000-8000-00000000000b';
const cA = 'b0000000-0328-4000-8000-00000000000a', cB = 'b0000000-0328-4000-8000-00000000000b';
const kA = 'c0000000-0328-4000-8000-00000000000a', kB = 'c0000000-0328-4000-8000-00000000000b';
const A = { actor: uA, tenant: tA, contact: cA, recipient: 'client.a@example.invalid', connector: kA, from: 'owner@a.example.invalid' };
const B = { actor: uB, tenant: tB, contact: cB, recipient: 'client.b@example.invalid', connector: kB, from: 'owner@b.example.invalid' };
const op = n => `d0000000-0328-4000-8000-${String(n).padStart(12, '0')}`;
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

function prepareCall(o) {
  const p = { ...A, subject: 'Quick follow-up', body: 'Hello there.', ...o };
  const govActor = p.govActor ?? p.actor, govTenant = p.govTenant ?? p.tenant;
  const digest = sha256(`${p.recipient}\n${p.connector}\n${p.subject}\n${p.body}`);
  const command = { action: 'comms.email_send', contact_id: p.contact, connector_id: p.connector, subject: p.subject, body: p.body };
  const governance = { actor_user_id: govActor, tenant_id: govTenant, tool: 'comms_send_email', action: 'comms.email_send',
    approval_channel: 'operator_card', approved_fingerprint: '0123456789abcdef', decision_receipt_recorded: true };
  return `public.prepare_comms_email_send(${q(p.actor)}::uuid,${q(p.tenant)}::uuid,${q(p.op)}::uuid,${q(p.contact)}::uuid,${q(p.recipient)},`
    + `${q(p.connector)}::uuid,${q(p.from)},${q(p.subject)},${q(p.body)},${q('<p>' + p.body + '</p>')},${q(digest)},`
    + `${q(JSON.stringify(command))}::jsonb,${q(JSON.stringify(governance))}::jsonb)`;
}
// The message id is resolved here and passed as a literal, exactly as send-message passes body.message_id.
const msg = n => {
  const id = sync(database, `SELECT id FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=${q(op(n))};`);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`no prepared message for operation ${op(n)}`);
  return `${q(id)}::uuid`;
};
const claimCall = (n, reconcile = false) => `public.claim_comms_email_send(${msg(n)},${q(op(n))}::uuid,${reconcile})`;
const finalizeCall = (n, outcome, providerId, reason, attempt) =>
  `public.finalize_comms_email_send(${msg(n)},${q(op(n))}::uuid,${q(outcome)},${providerId == null ? 'NULL' : q(providerId)},${reason == null ? 'NULL' : q(reason)},${attempt == null ? 'NULL' : attempt})`;
const asService = sql => sync(database, `BEGIN; SET LOCAL ROLE service_role; ${sql} COMMIT;`);
const selectResult = call => `SELECT 'RESULT '||(${call})::text;`;
const binding = n => JSON.parse(sync(database, `SELECT meta->'comms_email_binding' FROM public.messages WHERE id=${msg(n)};`));
const transitions = n => sync(database, `SELECT coalesce(json_agg(json_build_object('old',old_state,'new',new_state,'old_attempts',old_attempts,'new_attempts',new_attempts) ORDER BY id),'[]') FROM proof_binding_transitions WHERE operation_id=${q(op(n))};`);
// send-message's admission predicate, verbatim in meaning (supabase/functions/send-message/index.ts,
// the claim_comms_email_send call): admitted iff no error, admitted === true, state === 'dispatching', attempts integer >= 1.
const admitted = run => run.code === 0 && run.result?.admitted === true && run.result?.state === 'dispatching' && Number.isInteger(run.result?.attempts) && run.result.attempts >= 1;
const brief = runs => JSON.stringify(runs.map(r => ({ code: r.code, result: r.result, sqlstate: r.sqlstate, message: r.message })));

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

// (a) Two simultaneous prepares of the SAME operation.
scenario('(a) same-operation prepare race: one row, both callers succeed, exactly one is a replay', async () => {
  const runs = await race([selectResult(prepareCall({ op: op(1) })), selectResult(prepareCall({ op: op(1) }))]);
  globalThis.prepareRace = runs;
  assert(runs.every(r => r.code === 0), 'both exact-operation callers must succeed: ' + brief(runs));
  assert.deepEqual(runs.map(r => r.result.replayed).sort(), [false, true], 'exactly one fresh prepare and one replay: ' + brief(runs));
  assert.equal(runs[0].result.message_id, runs[1].result.message_id, 'both callers are given the same message');
  assert.equal(sync(database, `SELECT count(*) FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=${q(op(1))};`), '1');
});

// (b) Two simultaneous claims of the SAME prepared operation — split into what the DATABASE records
// and what each CALLER is told, because send-message decides to call the provider from the latter.
scenario('(b-db) same-operation claim race: the row is admitted to dispatching exactly once, attempts=1', async () => {
  asService(`SELECT ${prepareCall({ op: op(2), subject: 'Claim race' })};`);
  const runs = await race([selectResult(claimCall(2)), selectResult(claimCall(2))]);
  globalThis.claimRace = runs;
  assert(runs.every(r => r.code === 0), 'both claim calls return: ' + brief(runs));
  const b = binding(2);
  assert.equal(b.state, 'dispatching'); assert.equal(b.attempts, 1, 'DB attempts must be 1');
  const t = JSON.parse(transitions(2)).filter(x => x.new === 'dispatching');
  assert.equal(t.length, 1, 'exactly one write into dispatching (a second is an unserialized double admission): ' + JSON.stringify(t));
  assert.equal(t[0].old, 'prepared');
});
scenario('(b-api) same-operation claim race: exactly ONE caller is told dispatching (send-message admission predicate)', async () => {
  const runs = globalThis.claimRace;
  assert(runs, 'depends on (b-db)');
  assert.equal(runs.filter(admitted).length, 1, 'only one racer may pass send-message\'s admission check; returns were ' + brief(runs));
});

// (c) Two DIFFERENT approved operations with identical recipient + content.
scenario('(c) identical-content claim race across two operations: exactly one admitted', async () => {
  asService(`SELECT ${prepareCall({ op: op(3), subject: 'Twin', body: 'Twin body.' })}; SELECT ${prepareCall({ op: op(4), subject: 'Twin', body: 'Twin body.' })};`);
  const runs = await race([selectResult(claimCall(3)), selectResult(claimCall(4))]);
  assert(runs.every(r => r.code === 0), brief(runs));
  assert.equal(runs.filter(admitted).length, 1, 'exactly one identical-content operation admitted: ' + brief(runs));
  assert.deepEqual([binding(3).state, binding(4).state].sort(), ['dispatching', 'prepared'], 'DB holds one dispatching, one still prepared');
  assert.equal(runs.find(r => !admitted(r)).result.state, 'prepared', 'the held operation is told prepared');
});

// (d) The claimant's finalize racing an unclaimed 'refused' finalize of the same operation.
scenario('(d-sim) claimant finalize vs unclaimed refused, released together: refused fails, claimant outcome stands', async () => {
  asService(`SELECT ${prepareCall({ op: op(5), subject: 'Finalize race' })};`);
  asService(`SELECT ${claimCall(5)};`);
  const [claimant, refused] = await race([
    selectResult(finalizeCall(5, 'provider_accepted', 're_race_5', null, 1)),
    selectResult(finalizeCall(5, 'refused', null, 'blocked_suppressed', null)),
  ]);
  assert.equal(claimant.code, 0, 'claimant must finalize: ' + brief([claimant]));
  assert.notEqual(refused.code, 0, 'unclaimed refused must fail: ' + brief([refused]));
  // Which refusal the SQL gives depends on who took the row lock first: before the claimant commits
  // the refusal reads 'dispatching' -> 42501 NOT_CLAIMED; after, it reads a terminal state -> 40001.
  assert(['42501 COMMS_EMAIL_NOT_CLAIMED', '40001 COMMS_EMAIL_RECEIPT_CONFLICT'].includes(`${refused.sqlstate} ${refused.message}`), brief([refused]));
  globalThis.dSimRefusal = `${refused.sqlstate} ${refused.message}`;
  const b = binding(5);
  assert.equal(b.state, 'provider_accepted'); assert.equal(b.provider_message_id, 're_race_5');
  assert.equal(sync(database, `SELECT status FROM public.messages WHERE id=${msg(5)};`), 'sent');
  assert.equal(sync(database, `SELECT string_agg(outcome,',') FROM public.paige_workspace_events WHERE source_id=${q(op(5))};`), 'capability_succeeded');
});
scenario('(d-ordered) unclaimed refused arrives while the claimant is in flight: 42501 NOT_CLAIMED, claimant outcome stands', async () => {
  asService(`SELECT ${prepareCall({ op: op(6), subject: 'Finalize ordered' })};`);
  asService(`SELECT ${claimCall(6)};`);
  // The refusing request runs first while the claimant is "at the provider" (state dispatching, no
  // DB lock held). If it were wrongly allowed it would sit in pg_sleep holding the row lock, and the
  // claimant (started only once it is there or gone) would then hit its terminal state.
  const refusedRun = session(`BEGIN;\nSET LOCAL ROLE service_role;\n${selectResult(finalizeCall(6, 'refused', null, 'blocked_suppressed', null))}\nSELECT pg_sleep(0.8);\nCOMMIT;\n`, 'comms_email_d_refused');
  let refusedDone = false; refusedRun.then(() => { refusedDone = true; });
  const until = Date.now() + 15000;
  while (!refusedDone && sync(database, `SELECT count(*) FROM pg_stat_activity WHERE application_name='comms_email_d_refused' AND query LIKE 'SELECT pg_sleep%';`) !== '1') {
    if (Date.now() > until) throw new Error('refused session never reached a decision');
    await sleep(10);
  }
  const claimantRun = session(`BEGIN;\nSET LOCAL ROLE service_role;\n${selectResult(finalizeCall(6, 'provider_accepted', 're_race_6', null, 1))}\nCOMMIT;\n`, 'comms_email_d_claimant');
  const [refused, claimant] = await Promise.all([refusedRun, claimantRun]);
  assert.equal(`${refused.sqlstate} ${refused.message}`, '42501 COMMS_EMAIL_NOT_CLAIMED', 'refusal over a dispatching op: ' + brief([refused]));
  assert.equal(claimant.code, 0, 'claimant must still record its outcome: ' + brief([claimant]));
  assert.equal(binding(6).state, 'provider_accepted');
  assert.equal(sync(database, `SELECT status||'|'||provider_message_id FROM public.messages WHERE id=${msg(6)};`), 'sent|re_race_6');
});

// (d-claimant) Even the attempt that HOLDS the claim may never record 'refused' afterwards: once a
// claim exists the email may have gone out, and "Not sent" would invite a resend. Its own session.
scenario('(d-claimant) the claimant itself cannot record refused after its claim: 42501 NOT_CLAIMED, still dispatching', async () => {
  asService(`SELECT ${prepareCall({ op: op(20), subject: 'Claimant refusal' })};`);
  asService(`SELECT ${claimCall(20)};`);
  const run = await session(`BEGIN;\nSET LOCAL ROLE service_role;\n${selectResult(finalizeCall(20, 'refused', null, 'blocked_suppressed', 1))}\nCOMMIT;\n`, 'comms_email_d_claimant_refused');
  assert.equal(`${run.sqlstate} ${run.message}`, '42501 COMMS_EMAIL_NOT_CLAIMED', 'claimant refusal after claim: ' + brief([run]));
  assert.equal(binding(20).state, 'dispatching', 'the claimed row stays dispatching');
  assert.equal(sync(database, `SELECT status FROM public.messages WHERE id=${msg(20)};`), 'draft', 'never shown as not sent or blocked');
});

// (g) Two simultaneous RECONCILE claims of one stale dispatching operation (same admission shape as b).
scenario('(g-db) stale-dispatching reconcile race: re-admitted exactly once, attempts=2', async () => {
  asService(`SELECT ${prepareCall({ op: op(7), subject: 'Reconcile race' })};`);
  asService(`SELECT ${claimCall(7)};`);
  sync(database, `UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,claimed_at}',to_jsonb(now()-interval '200 seconds')) WHERE id=${msg(7)};`);
  const runs = await race([selectResult(claimCall(7, true)), selectResult(claimCall(7, true))]);
  globalThis.reconcileRace = runs;
  assert(runs.every(r => r.code === 0), brief(runs));
  assert.equal(binding(7).attempts, 2, 'DB attempts must be 2');
  assert.equal(JSON.parse(transitions(7)).filter(x => x.new_attempts === '2').length, 1, 'exactly one write of attempt 2: ' + transitions(7));
});
scenario('(g-api) stale-dispatching reconcile race: exactly ONE caller is told dispatching', async () => {
  const runs = globalThis.reconcileRace;
  assert(runs, 'depends on (g-db)');
  assert.equal(runs.filter(admitted).length, 1, 'only one reconcile may pass send-message\'s admission check; returns were ' + brief(runs));
});

// (e) Second-tenant isolation, every probe its own session, all released together.
scenario('(e) tenant B actor cannot prepare against or read tenant A, as concurrent separate sessions', async () => {
  asService(`SELECT ${prepareCall({ op: op(8), subject: 'Tenant A only' })};`);
  const probes = [
    ['B actor, B workspace, A contact', prepareCall({ ...B, op: op(81), contact: cA, recipient: A.recipient }), '42501 COMMS_EMAIL_CONTACT_NOT_IN_WORKSPACE'],
    ['B actor claiming A workspace', prepareCall({ ...A, actor: uB, op: op(82) }), '42501 COMMS_EMAIL_WORKSPACE_CHANGED'],
    ['B actor, B contact, A connector', prepareCall({ ...B, op: op(83), connector: kA, from: A.from }), '40001 COMMS_EMAIL_SENDER_CHANGED'],
    ['B actor reads A operation in B workspace', `public.read_comms_email_send_result(${q(uB)}::uuid,${q(tB)}::uuid,${q(op(8))}::uuid)`, '22023 COMMS_EMAIL_REPLAY_MISMATCH'],
    ['B actor reads A operation naming A workspace', `public.read_comms_email_send_result(${q(uB)}::uuid,${q(tA)}::uuid,${q(op(8))}::uuid)`, '42501 COMMS_EMAIL_WORKSPACE_CHANGED'],
    ['control: A actor reads its own operation', `public.read_comms_email_send_result(${q(uA)}::uuid,${q(tA)}::uuid,${q(op(8))}::uuid)`, 'ok'],
  ];
  const runs = await race(probes.map(([, call]) => selectResult(call)), { holdMs: 100 });
  probes.forEach(([label, , expected], i) => {
    const got = runs[i].code === 0 ? 'ok' : `${runs[i].sqlstate} ${runs[i].message}`;
    assert.equal(got, expected, label + ': ' + brief([runs[i]]));
  });
  assert.equal(runs[5].result.outcome, 'prepared');
  assert.equal(sync(database, `SELECT count(*) FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}' IN (${[81, 82, 83].map(n => q(op(n))).join(',')});`), '0', 'no refused prepare wrote a row');
});

// (f) authenticated and anon cannot EXECUTE any of the six service functions (or the three helpers).
scenario('(f) authenticated and anon are refused EXECUTE on every comms email function', async () => {
  // msg() yields a literal id, so a refusal can only come from the FUNCTION grant, never a table grant.
  const id8 = msg(8);
  const calls = [
    ['prepare_comms_email_send', prepareCall({ op: op(90) })],
    ['read_comms_email_send_binding', `public.read_comms_email_send_binding(${id8})`],
    ['claim_comms_email_send', `public.claim_comms_email_send(${id8},${q(op(8))}::uuid,false)`],
    ['finalize_comms_email_send', `public.finalize_comms_email_send(${id8},${q(op(8))}::uuid,'refused',NULL,'x',NULL)`],
    ['read_comms_email_send_result', `public.read_comms_email_send_result(${q(uA)}::uuid,${q(tA)}::uuid,${q(op(8))}::uuid)`],
    ['find_comms_email_pending_reconciliation', `public.find_comms_email_pending_reconciliation(${q(tA)}::uuid,${q(A.recipient)},'x')`],
    ['_comms_email_actor', `public._comms_email_actor(${q(uA)}::uuid,${q(tA)}::uuid)`],
    ['_comms_email_governance', `public._comms_email_governance(${q(uA)}::uuid,${q(tA)}::uuid,'{}'::jsonb)`],
    ['_comms_email_reconcilable', `public._comms_email_reconcilable('{}'::jsonb)`],
  ];
  const jobs = [];
  for (const role of ['authenticated', 'anon']) for (const [name, call] of calls) {
    jobs.push({ role, name, run: session(`BEGIN;\nSELECT set_config('request.jwt.claims', ${q(JSON.stringify({ sub: uA, role }))}, true);\nSET LOCAL ROLE ${role};\n${selectResult(call)}\nCOMMIT;\n`, `comms_email_f_${role}`) });
  }
  for (const job of jobs) {
    const run = await job.run;
    assert.equal(`${run.sqlstate} ${run.message}`, `42501 permission denied for function ${job.name}`, `${job.role} -> ${job.name}: ` + brief([run]));
  }
  assert.equal(binding(8).state, 'prepared', 'refused callers changed nothing');
});

let failed = 0;
try {
  console.log(`Migration under test: ${migrationPath}${process.env.COMMS_EMAIL_MIGRATION_OVERRIDE ? '   (OVERRIDE — scratch mutant, not the repo migration)' : ''}`);
  sync(database, readFileSync(new URL('comms-email-send-concurrency-schema.sql', import.meta.url), 'utf8'));
  sync(database, readFileSync(migrationPath, 'utf8'));
  // Proof instrument (NOT a stub of anything in prod): records every binding write so a double
  // admission is visible even when both writers store the same attempts value.
  sync(database, `
CREATE TABLE proof_binding_transitions(id bigserial PRIMARY KEY, operation_id text, old_state text, new_state text, old_attempts text, new_attempts text);
CREATE FUNCTION proof_log_transition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO proof_binding_transitions(operation_id,old_state,new_state,old_attempts,new_attempts)
  VALUES (NEW.meta#>>'{comms_email_binding,operation_id}',
          CASE WHEN TG_OP='UPDATE' THEN OLD.meta#>>'{comms_email_binding,state}' END, NEW.meta#>>'{comms_email_binding,state}',
          CASE WHEN TG_OP='UPDATE' THEN OLD.meta#>>'{comms_email_binding,attempts}' END, NEW.meta#>>'{comms_email_binding,attempts}');
  RETURN NULL;
END $$;
CREATE TRIGGER proof_log_transition AFTER INSERT OR UPDATE ON public.messages FOR EACH ROW
  WHEN (NEW.meta ? 'comms_email_binding') EXECUTE FUNCTION proof_log_transition();
INSERT INTO auth.users(id,email) VALUES (${q(uA)},'cea-race-a@example.invalid'),(${q(uB)},'cea-race-b@example.invalid');
INSERT INTO public.tenants(id,slug,status) VALUES (${q(tA)},'cea-race-a','active'),(${q(tB)},'cea-race-b','active');
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES (${q(uA)},${q(tA)}),(${q(uB)},${q(tB)});
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES (${q(tA)},${q(uA)},'owner','active',true),(${q(tB)},${q(uB)},'owner','active',true);
INSERT INTO public.clients(id,tenant_id,first_name) VALUES (${q(cA)},${q(tA)},'Race A'),(${q(cB)},${q(tB)},'Race B');
INSERT INTO public.client_contact_methods(tenant_id,client_id,kind,value,is_primary) VALUES
  (${q(tA)},${q(cA)},'email','Client.A@Example.invalid',true),(${q(tB)},${q(cB)},'email','client.b@example.invalid',true);
INSERT INTO public.channel_connectors(id,tenant_id,channel_type,provider,from_address,status,active) VALUES
  (${q(kA)},${q(tA)},'email','resend','Owner@A.example.invalid','active',true),(${q(kB)},${q(tB)},'email','resend','owner@b.example.invalid','active',true);`);
  for (const { name, fn } of scenarios) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failed += 1; console.log(`FAIL ${name}\n     ${String(error.message).split('\n')[0]}`); }
  }
  if (globalThis.prepareRace) console.log(`     note (a): prepare returns were ${brief(globalThis.prepareRace).replace(/,?"message_id":"[^"]+"/g, '')}`);
  if (globalThis.dSimRefusal) console.log(`     note (d-sim): the simultaneous refused finalize was refused with ${globalThis.dSimRefusal}`);
  console.log(failed === 0
    ? `PASS: all ${scenarios.length} concurrency scenarios held. Real PostgreSQL sessions and roles; auth/workspace dependencies are local stubs.`
    : `FAIL: ${failed} of ${scenarios.length} concurrency scenarios did not hold.`);
} finally {
  sync('postgres', `DROP DATABASE ${database} WITH (FORCE);`);
  console.log('Disposable concurrency database removed.');
}
process.exitCode = failed === 0 ? 0 : 1;
