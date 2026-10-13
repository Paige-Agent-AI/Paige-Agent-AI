// Test-only transport into the parent's disposable PostgreSQL fixture. Runs the
// unmodified governed engine and native adapter; never fabricates RPC successes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assert(/^paige_weekly_proof_\d+_\d+$/.test(config.database), 'disposable proof database only');
assert(Number.isInteger(config.port) && config.port >= 1024 && config.port <= 65535);
assert(/^[0-9a-f-]{36}$/.test(config.eventId));
globalThis.fetch = async () => { throw new Error('Outbound requests forbidden in this proof'); };
const identifier = value => { assert(/^[a-z_][a-z0-9_]*$/.test(value)); return `"${value}"`; };
const literal = value => value == null ? 'NULL' : typeof value === 'boolean' || typeof value === 'number'
  ? String(value) : `'${(typeof value === 'object' ? JSON.stringify(value) : String(value)).replaceAll("'", "''")}'${typeof value === 'object' ? '::jsonb' : ''}`;
function sql(query) {
  const result = execFileSync(config.psql, ['-X', '-q', '-h', '127.0.0.1', '-p', String(config.port), '-U', 'postgres',
    '-d', config.database, '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { encoding: 'utf8', windowsHide: true, timeout: 60000,
    input: `SET ROLE service_role; DO $$ BEGIN PERFORM set_config('test.actor','',false); PERFORM set_config('test.tenant','',false); END $$;\n${query}` });
  return result.trim() ? JSON.parse(result.trim()) : null;
}
const calls = [];
const db = {
  async rpc(name, args = {}) {
    calls.push(name);
    try {
      const parameters = Object.entries(args).map(([key, value]) => `${identifier(key)} => ${literal(value)}`).join(',');
      return { data: sql(`SELECT to_jsonb(public.${identifier(name)}(${parameters}));`), error: null };
    } catch (error) { return { data: null, error: { message: String(error.message), code: 'proof_transport_error' } }; }
  },
  from(table) {
    let columns = '*', cap = 1000, ordering = '', single = false; const filters = [];
    const query = {
      select(value) { columns = value === '*' ? '*' : value.split(',').map(c => identifier(c.trim())).join(','); return query; },
      eq(key, value) { filters.push(`${identifier(key)} = ${literal(value)}`); return query; },
      lte(key, value) { filters.push(`${identifier(key)} <= ${literal(value)}`); return query; },
      in(key, values) { filters.push(`${identifier(key)} IN (${values.map(literal).join(',')})`); return query; },
      limit(value) { assert(Number.isInteger(value) && value >= 0 && value <= 1000); cap = value; return query; },
      order(key, options = {}) { ordering = ` ORDER BY ${identifier(key)} ${options.ascending === false ? 'DESC' : 'ASC'}`; return query; },
      maybeSingle() { single = true; return query; },
      then(resolve, reject) {
        try { const data = sql(`SELECT coalesce(json_agg(result),'[]'::json) FROM
          (SELECT ${columns} FROM public.${identifier(table)}${filters.length ? ' WHERE ' + filters.join(' AND ') : ''}${ordering} LIMIT ${cap}) result;`);
          return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve, reject); }
        catch (error) { return Promise.resolve({ data: null, error: { message: String(error.message) } }).then(resolve, reject); }
      },
    }; return query;
  },
};
const { runEventActs } = await import('../../supabase/functions/_shared/paige-orchestration/engine.ts');
const { verifySubjectTenant } = await import('../../supabase/functions/_shared/paige-orchestration/subject-tenant.ts');
const rolePosture=sql(`SELECT jsonb_build_object('role',current_user,'bypass_rls',
  (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user),'auth_uid',auth.uid(),
  'event_table_rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.paige_native_events'::regclass));`);
const eventRead=await db.from('paige_native_events').select('*').eq('id',config.eventId).limit(1);
assert.equal(eventRead.error,null,`canonical event read failed: ${JSON.stringify({error:eventRead.error,role_posture:rolePosture})}`);
assert(Array.isArray(eventRead.data)&&eventRead.data.length===1,
  `canonical claimed event is not visible: ${JSON.stringify({row_count:eventRead.data?.length??null,role_posture:rolePosture})}`);
const event=eventRead.data[0];
assert.equal(event.processing_state, 'claimed', 'canonical event claim required');
assert.equal(event.subject_table, 'paige_automations');
assert.equal((await verifySubjectTenant(db, event.subject_table, event.subject_id, event.tenant_id)).ok, true);
const automationRead=await db.from('paige_automations').select('*').eq('id',event.subject_id).limit(1);
assert.equal(automationRead.error,null,`canonical process read failed: ${JSON.stringify({error:automationRead.error,role_posture:rolePosture})}`);
assert(Array.isArray(automationRead.data)&&automationRead.data.length===1,
  `canonical process is not visible: ${JSON.stringify({row_count:automationRead.data?.length??null,role_posture:rolePosture})}`);
const automation=automationRead.data[0];
const claimed = { ...event, event_id: event.id };
const first = await runEventActs(db, claimed, [automation]);
assert.equal(first.records.length, 1);
assert.equal(first.records[0].outcome, 'executed', JSON.stringify(first));
assert.deepEqual(first.persist_failures, []);
const second = await runEventActs(db, claimed, [automation]);
assert.equal(second.records[0].outcome, 'executed');
assert.equal(calls.filter(n => n === 'execute_weekly_commitment_check').length, 1, 'redrain adopts the existing observation');
const rows = (await db.from('paige_act_executions').select('*').eq('event_id', event.id)).data;
assert.equal(rows.length, 1); assert(rows[0].detail.weekly_commitment_observation);
console.log(JSON.stringify({ status: 'PASS', actual_engine: true, executed: 1, redrain_adopted: true,role_posture:rolePosture,
  outbound_requests: 0, boundary: 'real engine/adapter/Gateway over disposable PostgreSQL; Auth/tier/authority fixture dependencies; no HTTP drainer or authenticated platform proof' }));
