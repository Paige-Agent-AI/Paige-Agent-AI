/** Native, rollback-only #1807 non-application record proof (INT-304 CL-2). No
 * production/provider calls. Proves, on an isolated localhost database:
 *  - the service-only write derives every binding field from the thread and the CONSUMED
 *    card (nothing from the caller's JSON), stays idempotent per effect, and refuses
 *    shape-drifted tokens, non-database answer codes, unspent/unissued cards, wrong
 *    nonces and foreign threads with the typed binding error;
 *  - the authenticated read composes discovery + the original resolver, returns
 *    classifier-shaped evidence ONLY for an exactly-matching record, and returns null
 *    for foreign actor/tenant, revoked admin, wrong intent, explicit-effect mismatch,
 *    a missing record and a drifted record;
 *  - the ACL boundary: anon/authenticated cannot execute the write, service/anon cannot
 *    execute the read, and no client role can read the table directly. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const url = process.env.INT336_DATABASE_URL;
if (!url) throw Error('Set isolated INT336_DATABASE_URL');
const parsed = new URL(url);
if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || !parsed.pathname.startsWith('/int336_test')) throw Error('Only isolated localhost int336_test database permitted');
const root = path.resolve(import.meta.dirname, '..');
const emitted = spawnSync(process.execPath, [path.join(root, 'scripts/int336-database-check.mjs'), '--emit-fixture', '--emit-baseline'], { encoding: 'utf8', env: process.env });
if (emitted.status !== 0) throw Error(emitted.stderr);
const marker = 'insert into paige_chat_threads(id,caller_user_id,tenant_id)values';
if (!emitted.stdout.includes(marker)) throw Error('Canonical fixture prelude unavailable');
const prelude = emitted.stdout.slice(0, emitted.stdout.indexOf(marker));
const migrations = path.join(root, 'supabase/migrations');
const load = suffix => {
  const files = fs.readdirSync(migrations).filter(f => f.endsWith(suffix));
  if (files.length !== 1) throw Error(`Exact migration required: ${suffix}`);
  return fs.readFileSync(path.join(migrations, files[0]), 'utf8').replace(/^begin;\r?$/mg, '').replace(/^commit;\r?$/mg, '');
};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const thread = id(1), actor = id(2), tenant = id(3), intent = id(4), card = id(5), nonce = id(7);
const token = `aaaaaaaaaaaaaaaa:${nonce}`;
const frame = JSON.stringify({ paige_resume: { approval_outcome: { actions: [{ fingerprint: token, outcome: 'unconfirmed' }] } } });
// Positive writes are NOT savepoint-isolated: the whole proof runs in the prelude's one
// transaction, and the record must persist for the later read cases. Refusal cases never
// insert, so they need no isolation either; only mutating read cases roll back.
const write = (label, threadId = thread, tok = token, sqlstate = 'P0001', intentId = intent) =>
  `reset role;do $$begin
   if public.record_pipeline_metadata_non_application('${threadId}','${intentId}','${tok}','${sqlstate}') is null then raise exception 'write returned null: ${label}';end if;end $$;\n`;
const writeFails = (label, threadId = thread, tok = token, sqlstate = 'P0001', intentId = intent, pre = '') =>
  `reset role;${pre}do $$begin
   perform public.record_pipeline_metadata_non_application('${threadId}','${intentId}','${tok}','${sqlstate}');
   raise exception 'write accepted: ${label}';
   exception when others then if sqlerrm<>'PIPELINE_NON_APPLICATION_BINDING_INVALID' then raise;end if;end $$;\n`;
const readIs = (label, changes = '', expected /* 'evidence' | 'null' */, effect = 'null', threadId = thread, intentId = intent) => {
  const body = expected === 'evidence'
    ? `jsonb_build_object('authoritative',true,'effect','none','conflicting',false,'kind','failed_not_applied',
       'binding',jsonb_build_object('tenantId','${tenant}','actorId','${actor}','threadId','${thread}',
       'intentId','${intent}','operationId','${card}','scopeEpoch','${nonce}'))`
    : 'null::jsonb';
  return `savepoint proof_case;${changes}set role authenticated;
   do $$begin if public.read_pipeline_metadata_observation('${threadId}','${intentId}',${effect}) is distinct from ${body}
   then raise exception 'read case: ${label}';end if;end $$;
   reset role;rollback to savepoint proof_case;release savepoint proof_case;\n`;
};
let sql = prelude + load('_int346_server_issued_interactive_receipts.sql') + `
create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
create function public.is_tenant_admin(uuid) returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'true')='true'$$;
alter table public.paige_chat_threads add column is_archived boolean not null default false;
create table public.tenants(id uuid primary key,status text);
create table public.tenant_members(tenant_id uuid,user_id uuid,status text);
create table public.paige_pending_confirmations(id uuid primary key,thread_id uuid,user_id uuid,tenant_id uuid,tool_name text,server_issued_at timestamptz,issued_in_request uuid,consumed_at timestamptz,fingerprint text,args jsonb);
insert into public.tenants values('${tenant}','active');
insert into public.tenant_members values('${tenant}','${actor}','active');
insert into public.paige_chat_threads(id,caller_user_id,tenant_id,interactive_latest_intent,interactive_executor_intent) values('${thread}','${actor}','${tenant}','${intent}','${intent}');
insert into public.paige_pending_confirmations values('${card}','${thread}','${actor}','${tenant}','pipeline_configure',now(),'${nonce}',now(),'aaaaaaaaaaaaaaaa','{"command":{"type":"update-pipeline","pipelineId":"${id(8)}","expectedVersion":7,"name":"Updated"},"idempotency_key":"operation"}');
insert into public.paige_chat_turns(thread_id,role,bundle_ref,interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_terminal_state)
 values('${thread}','assistant','${frame}','${intent}','${actor}','${tenant}','INTERRUPTED');
set test.actor='${actor}';set test.tenant='${tenant}';set test.admin='true';set request.jwt.claim.role='authenticated';
` + load('_int1807_pipeline_metadata_readback.sql') + load('_int1807_original_effect_discovery.sql')
  + (process.argv.includes('--negative-control') ? '' : load('_int1807_pipeline_non_application.sql'));

sql += write('exact consumed card, database-answered refusal');
sql += `reset role;do $$begin
  if (select count(*) from public.pipeline_metadata_non_application) <> 1 then raise exception 'record count';end if;
  if not exists(select 1 from public.pipeline_metadata_non_application r where r.effect_id='${card}'
   and r.tenant_id='${tenant}' and r.actor_user_id='${actor}' and r.thread_id='${thread}' and r.intent_id='${intent}'
   and r.idempotency_key='operation'
   and r.command_hash = (public.read_pipeline_metadata_original('${thread}','${intent}','${card}')->>'commandHash')
   and r.scope_epoch='${nonce}' and r.kind='failed_not_applied' and r.sqlstate='P0001')
   then raise exception 'record binding not derived from thread and card';end if;end $$;\n`;
sql += write('replay returns the same record');
sql += `reset role;do $$begin
  if (select count(*) from public.pipeline_metadata_non_application) <> 1 then raise exception 'replay inserted a second record';end if;end $$;\n`;
// Write refusals — only definite, database-answered evidence may become a record.
sql += writeFails('malformed token (no colon)', thread, 'aaaaaaaaaaaaaaaa', 'P0001');
sql += writeFails('bad fingerprint shape', thread, 'ZZZZZZZZZZZZZZZZ:' + nonce, 'P0001');
sql += writeFails('bad nonce shape', thread, 'aaaaaaaaaaaaaaaa:not-a-uuid', 'P0001');
sql += writeFails('transport-style code is not a database answer', thread, token, 'ECONNRESET');
sql += writeFails('lowercase non-state code', thread, token, 'failed');
sql += writeFails('foreign thread', id(9), token, 'P0001');
sql += writeFails('wrong issuance nonce', thread, `aaaaaaaaaaaaaaaa:${id(9)}`, 'P0001');
sql += writeFails('unconsumed card', thread, token, 'P0001', intent, `update public.paige_pending_confirmations set consumed_at=null;`);
sql += writeFails('unissued card', thread, token, 'P0001', intent, `update public.paige_pending_confirmations set server_issued_at=null;`);
sql += `reset role;update public.paige_pending_confirmations set consumed_at=now(), server_issued_at=now();\n`;
// ACL boundary on the write seam and the table.
sql += `savepoint proof_case;set role authenticated;do $$begin
  perform public.record_pipeline_metadata_non_application('${thread}','${intent}','${token}','P0001');
  raise exception 'authenticated executed the write';exception when insufficient_privilege then null;end $$;
  set role anon;do $$begin
  perform public.record_pipeline_metadata_non_application('${thread}','${intent}','${token}','P0001');
  raise exception 'anon executed the write';exception when insufficient_privilege then null;end $$;
  reset role;set role service_role;do $$begin
  if public.record_pipeline_metadata_non_application('${thread}','${intent}','${token}','P0001') is null then raise exception 'service write returned null';end if;end $$;
  reset role;do $$begin
  if (select count(*) from public.pipeline_metadata_non_application) <> 1 then raise exception 'acl write changed the record count';end if;end $$;
  set role authenticated;do $$begin
  perform 1 from public.pipeline_metadata_non_application;
  raise exception 'authenticated read the table directly';exception when insufficient_privilege then null;end $$;
  reset role;rollback to savepoint proof_case;release savepoint proof_case;\n`;
// Reads — evidence only for the exact original effect, through full lineage.
sql += readIs('exact evidence for the original effect', '', 'evidence', `'${card}'`);
sql += readIs('repeat read is stable', '', 'evidence', `'${card}'`);
sql += readIs('discovered effect (explicit null)', '', 'evidence', 'null');
sql += readIs('explicit effect mismatch', '', 'null', `'${id(9)}'`);
sql += readIs('foreign actor', `savepoint proof_case;reset role;set test.actor='${id(9)}';`, 'null', `'${card}'`);
sql += readIs('switched tenant', `savepoint proof_case;reset role;set test.tenant='${id(9)}';`, 'null', `'${card}'`);
sql += readIs('revoked admin', `savepoint proof_case;reset role;set test.admin='false';`, 'null', `'${card}'`);
sql += readIs('wrong intent', `savepoint proof_case;reset role;`, 'null', `'${card}'`, thread, id(9));
sql += readIs('missing record', `savepoint proof_case;reset role;delete from public.pipeline_metadata_non_application;`, 'null', `'${card}'`);
sql += readIs('drifted scope epoch', `savepoint proof_case;reset role;update public.pipeline_metadata_non_application set scope_epoch='${id(9)}';`, 'null', `'${card}'`);
sql += readIs('drifted idempotency key', `savepoint proof_case;reset role;update public.pipeline_metadata_non_application set idempotency_key='other';`, 'null', `'${card}'`);
sql += readIs('drifted command hash', `savepoint proof_case;reset role;update public.pipeline_metadata_non_application set command_hash=repeat('0',32);`, 'null', `'${card}'`);
sql += readIs('superseded intent', `savepoint proof_case;reset role;update public.paige_chat_threads set interactive_latest_intent='${id(9)}';`, 'null', `'${card}'`);
sql += readIs('unspent card breaks lineage', `savepoint proof_case;reset role;update public.paige_pending_confirmations set consumed_at=null;`, 'null', `'${card}'`);
// ACL boundary on the read seam.
sql += `savepoint proof_case;set role service_role;do $$begin
  perform public.read_pipeline_metadata_observation('${thread}','${intent}','${card}');
  raise exception 'service executed the read';exception when insufficient_privilege then null;end $$;
  set role anon;do $$begin
  perform public.read_pipeline_metadata_observation('${thread}','${intent}','${card}');
  raise exception 'anon executed the read';exception when insufficient_privilege then null;end $$;
  reset role;rollback to savepoint proof_case;release savepoint proof_case;\n`;

const out = spawnSync(process.env.PSQL_BIN ?? 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', url], { input: sql, encoding: 'utf8' });
if (out.status !== 0) { console.error(out.stderr); process.exit(out.status ?? 1); }
console.log('PASS pipeline metadata non-application: service write derives the binding from thread and consumed card (idempotent per effect, refuses transport codes and shape drift), authenticated read composes discovery + original resolver and returns classifier evidence only for the exact effect, ACLs refuse client writes and service reads');
