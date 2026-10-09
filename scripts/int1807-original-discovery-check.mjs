/** Native, rollback-only #1807 discovery proof. No production/provider calls. */
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
const token = `aaaaaaaaaaaaaaaa:${id(7)}`;
const frame = actions => JSON.stringify({ paige_resume: { approval_outcome: { actions } } });
const originalFrame = frame([{ fingerprint: token, outcome: 'unconfirmed' }]);
let count = 0;
const check = (label, changes = '', expected = null, thread = id(1), intent = id(4)) => {
  count++;
  return `savepoint proof_case;
reset role;${changes}
set role authenticated;
do $$begin if public.find_pipeline_metadata_original_effect('${thread}','${intent}') is distinct from ${expected ? `'${expected}'::uuid` : 'null::uuid'} then raise exception 'discovery case: ${label}';end if;end $$;
reset role;rollback to savepoint proof_case;release savepoint proof_case;\n`;
};
const mutateFrame = actions => `update public.paige_chat_turns set bundle_ref='${frame(actions)}'::jsonb;`;
let discovery = process.argv.includes('--negative-control') ? '' : load('_int1807_original_effect_discovery.sql');
let original = load('_int1807_pipeline_metadata_readback.sql');
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
if (mutant) {
  const mutations = {
    role: ["auth.role() is distinct from 'authenticated'", 'false'],
    'token-count': ['v_occurrences <> 1', 'false'],
    actor: ['and r.interactive_actor_id = v_actor', 'and true'],
    'original-read': ['public.read_pipeline_metadata_original(_thread, _intent, v_effect) is null', 'false'],
  };
  const replacement = mutations[mutant];
  if (!replacement || !discovery.includes(replacement[0])) throw Error('Mutation seam missing');
  discovery = discovery.replaceAll(replacement[0], replacement[1]);
  // Exact actor/token checks intentionally exist in both read-only functions.
  // Remove both mirrored defenses in the fixture-only mutant so that rejection
  // measures this invariant, rather than reporting a surviving redundant guard.
  if (mutant === 'actor') original = original.replaceAll('and r.interactive_actor_id=v_actor', 'and true');
  if (mutant === 'token-count') {
    const mirrored = "if v_count<>1 or (select count(*) from jsonb_array_elements(v_frame->'actions') a\n   where a->>'fingerprint'=v_token)<>1";
    const normalized = original.replaceAll('\r\n', '\n');
    if (!normalized.includes(mirrored)) throw Error('Mirrored token-count seam missing');
    original = normalized.replace(mirrored, 'if false');
  }
}
let sql = prelude + load('_int346_server_issued_interactive_receipts.sql') + `
create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
create function public.is_tenant_admin(uuid) returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'true')='true'$$;
alter table public.paige_chat_threads add column is_archived boolean not null default false;
create table public.tenants(id uuid primary key,status text);
create table public.tenant_members(tenant_id uuid,user_id uuid,status text);
create table public.paige_pending_confirmations(id uuid primary key,thread_id uuid,user_id uuid,tenant_id uuid,tool_name text,server_issued_at timestamptz,issued_in_request uuid,consumed_at timestamptz,fingerprint text,args jsonb);
insert into public.tenants values('${id(3)}','active');
insert into public.tenant_members values('${id(3)}','${id(2)}','active');
insert into public.paige_chat_threads(id,caller_user_id,tenant_id,interactive_latest_intent,interactive_executor_intent) values('${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(4)}');
insert into public.paige_pending_confirmations values('${id(5)}','${id(1)}','${id(2)}','${id(3)}','pipeline_configure',now(),'${id(7)}',now(),'aaaaaaaaaaaaaaaa','{"command":{"type":"update-pipeline","pipelineId":"${id(8)}","expectedVersion":7,"name":"Updated"},"idempotency_key":"operation"}');
insert into public.paige_chat_turns(thread_id,role,bundle_ref,interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_terminal_state)
 values('${id(1)}','assistant','${originalFrame}','${id(4)}','${id(2)}','${id(3)}','INTERRUPTED');
set test.actor='${id(2)}';set test.tenant='${id(3)}';set test.admin='true';set request.jwt.claim.role='authenticated';
` + original + discovery;
sql += check('exact consumed card, issuance nonce deliberately differs from execution intent', '', id(5));
sql += check('repeat same read', '', id(5));
sql += check('ran is also exact', mutateFrame([{ fingerprint: token, outcome: 'ran' }]), id(5));
for (const [label, changes] of [
  ['missing JWT role', "set request.jwt.claim.role='';"],
  ['service-role claims cannot act as authenticated caller', "set request.jwt.claim.role='service_role';"],
  ['anon claims cannot act as authenticated caller', "set request.jwt.claim.role='anon';"],
  ['missing actor', "set test.actor='';"],
  ['foreign actor', `set test.actor='${id(9)}';`],
  ['switched tenant', `set test.tenant='${id(9)}';`],
  ['missing current tenant', "set test.tenant='';"],
  ['revoked permission', "set test.admin='false';"],
  ['archived thread', 'update public.paige_chat_threads set is_archived=true;'],
  ['superseded intent', `update public.paige_chat_threads set interactive_latest_intent='${id(9)}';`],
  ['inactive tenant', "update public.tenants set status='inactive';"],
  ['revoked membership', "update public.tenant_members set status='removed';"],
  ['missing membership', 'delete from public.tenant_members;'],
  ['missing active tenant', 'delete from public.tenants;'],
  ['missing card', 'delete from public.paige_pending_confirmations;'],
  ['unspent card', 'update public.paige_pending_confirmations set consumed_at=null;'],
  ['unissued card', 'update public.paige_pending_confirmations set server_issued_at=null;'],
  ['legacy nonce absent', 'update public.paige_pending_confirmations set issued_in_request=null;'],
  ['foreign card actor', `update public.paige_pending_confirmations set user_id='${id(9)}';`],
  ['foreign card tenant', `update public.paige_pending_confirmations set tenant_id='${id(9)}';`],
  ['foreign card thread', `update public.paige_pending_confirmations set thread_id='${id(9)}';`],
  ['wrong tool', "update public.paige_pending_confirmations set tool_name='crm_update_contact';"],
  ['missing original terminal', 'delete from public.paige_chat_turns;'],
  ['foreign terminal actor', `update public.paige_chat_turns set interactive_actor_id='${id(9)}';`],
  ['foreign terminal tenant', `update public.paige_chat_turns set interactive_tenant_id='${id(9)}';`],
  ['legacy JSON is not protected evidence', 'update public.paige_chat_turns set interactive_intent_id=null,interactive_actor_id=null,interactive_tenant_id=null,interactive_terminal_state=null;'],
  ['no approval frame', "update public.paige_chat_turns set bundle_ref='{}';"],
  ['malformed actions', "update public.paige_chat_turns set bundle_ref='{" + '"paige_resume":{"approval_outcome":{"actions":{}}}' + "}';"],
  ['empty actions', mutateFrame([])],
  ['malformed mixed action frame', mutateFrame([{ fingerprint: token, outcome: 'unconfirmed' }, 123])],
  ['unknown action outcome in frame', mutateFrame([{ fingerprint: token, outcome: 'unconfirmed' }, { fingerprint: 'other-token', outcome: 'success' }])],
  ['not run cannot resolve', mutateFrame([{ fingerprint: token, outcome: 'not_run' }])],
  ['duplicate same token', mutateFrame([{ fingerprint: token, outcome: 'unconfirmed' }, { fingerprint: token, outcome: 'unconfirmed' }])],
  ['conflicting same token', mutateFrame([{ fingerprint: token, outcome: 'unconfirmed' }, { fingerprint: token, outcome: 'not_run' }])],
  ['original RPC rejects non-update command', "update public.paige_pending_confirmations set args=jsonb_set(args,'{command,type}','\"create-pipeline\"');"],
  ['original RPC rejects missing key', "update public.paige_pending_confirmations set args=args-'idempotency_key';"],
]) sql += check(label, changes);
sql += check('foreign thread', '', null, id(9));
sql += check('foreign intent', '', null, id(1), id(9));
const secondCard = `insert into public.paige_pending_confirmations select '${id(6)}',thread_id,user_id,tenant_id,tool_name,server_issued_at,issued_in_request,consumed_at,'bbbbbbbbbbbbbbbb',args from public.paige_pending_confirmations;`;
sql += check('multiple original effects', secondCard + mutateFrame([{ fingerprint: token, outcome: 'unconfirmed' }, { fingerprint: `bbbbbbbbbbbbbbbb:${id(7)}`, outcome: 'ran' }]));
sql += check('second effect conflicting outcome still ambiguous', secondCard + mutateFrame([{ fingerprint: token, outcome: 'unconfirmed' }, { fingerprint: `bbbbbbbbbbbbbbbb:${id(7)}`, outcome: 'not_run' }]));
sql += check('two cards same token', `insert into public.paige_pending_confirmations select '${id(6)}',thread_id,user_id,tenant_id,tool_name,server_issued_at,issued_in_request,consumed_at,fingerprint,args from public.paige_pending_confirmations;`);
sql += `
do $$begin
 if has_function_privilege('anon','public.find_pipeline_metadata_original_effect(uuid,uuid)','execute') or has_function_privilege('service_role','public.find_pipeline_metadata_original_effect(uuid,uuid)','execute') then raise exception 'non-caller ACL grant';end if;
end $$;
create temp table observation_snapshot as select
 (select jsonb_agg(to_jsonb(t)) from public.paige_chat_threads t) threads,
 (select jsonb_agg(to_jsonb(t)) from public.paige_chat_turns t) turns,
 (select jsonb_agg(to_jsonb(c)) from public.paige_pending_confirmations c) cards,
 (select jsonb_agg(to_jsonb(t)) from public.tenants t) tenants,
 (select jsonb_agg(to_jsonb(m)) from public.tenant_members m) members,
 (select jsonb_agg(to_jsonb(r)) from public.paige_chat_interactive_rollout r) rollout;
set role authenticated;
do $$begin for i in 1..3 loop if public.find_pipeline_metadata_original_effect('${id(1)}','${id(4)}') is distinct from '${id(5)}'::uuid then raise exception 'unstable repeat';end if;end loop;end $$;
reset role;
do $$begin if exists(select 1 from observation_snapshot s where
 s.threads is distinct from (select jsonb_agg(to_jsonb(t)) from public.paige_chat_threads t) or
 s.turns is distinct from (select jsonb_agg(to_jsonb(t)) from public.paige_chat_turns t) or
 s.cards is distinct from (select jsonb_agg(to_jsonb(c)) from public.paige_pending_confirmations c) or
 s.tenants is distinct from (select jsonb_agg(to_jsonb(t)) from public.tenants t) or
 s.members is distinct from (select jsonb_agg(to_jsonb(m)) from public.tenant_members m) or
 s.rollout is distinct from (select jsonb_agg(to_jsonb(r)) from public.paige_chat_interactive_rollout r))
 or (select interactive_executor_intent from public.paige_chat_threads where id='${id(1)}') is distinct from '${id(4)}'::uuid
 or (select active from public.paige_chat_interactive_rollout where singleton) then raise exception 'read mutated DB/executor/DRAINING';end if;end $$;
rollback;
`;
const run = spawnSync(process.env.PSQL_BIN ?? 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', url], { input: sql, encoding: 'utf8' });
if (run.status !== 0) { console.error(run.stderr); process.exit(run.status ?? 1); }
console.log(`PASS ${count} native discovery cases + caller ACL/repeated full DB/executor/DRAINING invariance. Local fixture only.`);
