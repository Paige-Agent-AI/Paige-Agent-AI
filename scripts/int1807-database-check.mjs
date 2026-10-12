/** Real PostgreSQL read-only proof; never a production/authenticated acceptance simulation. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const url = process.env.INT336_DATABASE_URL;
const parsed = new URL(url);
if (!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname) || !parsed.pathname.startsWith('/int336_test')) throw Error('Empty isolated localhost database required');
const root = path.resolve(import.meta.dirname, '..');
const emitted = spawnSync(process.execPath, [path.join(root, 'scripts/int336-database-check.mjs'), '--emit-fixture', '--emit-baseline'], { encoding: 'utf8', env: process.env });
if (emitted.status !== 0) throw Error(emitted.stderr);
const prelude = emitted.stdout.slice(0, emitted.stdout.indexOf('insert into paige_chat_threads(id,caller_user_id,tenant_id)values'));
const migrations = path.join(root, 'supabase/migrations');
const load = suffix => fs.readFileSync(path.join(migrations, fs.readdirSync(migrations).find(f => f.endsWith(suffix))), 'utf8').replace(/^begin;\r?$/mg, '').replace(/^commit;\r?$/mg, '');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const token = `aaaaaaaaaaaaaaaa:${id(7)}`;
const sql = prelude + load('_int346_server_issued_interactive_receipts.sql') + `
create function public.is_tenant_admin(uuid) returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'true')='true'$$;
create table public.paige_pending_confirmations(id uuid primary key,thread_id uuid,user_id uuid,tenant_id uuid,tool_name text,server_issued_at timestamptz,issued_in_request uuid,consumed_at timestamptz,fingerprint text,args jsonb);
insert into paige_chat_threads(id,caller_user_id,tenant_id) values('${id(1)}','${id(2)}','${id(3)}');
insert into paige_pending_confirmations values('${id(5)}','${id(1)}','${id(2)}','${id(3)}','pipeline_configure',now(),'${id(7)}',now(),'aaaaaaaaaaaaaaaa','{"command":{"type":"update-pipeline","pipelineId":"${id(8)}","expectedVersion":7,"name":"Updated"},"idempotency_key":"operation"}');
insert into paige_chat_turns(thread_id,role,bundle_ref,interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_terminal_state)
 values('${id(1)}','assistant','{"paige_resume":{"approval_outcome":{"actions":[{"fingerprint":"${token}","outcome":"unconfirmed"}]}}}','${id(4)}','${id(2)}','${id(3)}','INTERRUPTED');
set test.actor='${id(2)}';set test.tenant='${id(3)}';
` + (process.argv.includes('--negative-control') ? '' : load('_int1807_pipeline_metadata_readback.sql')) + `
set role authenticated;
do $$declare r jsonb;begin
 r:=public.read_pipeline_metadata_original('${id(1)}','${id(4)}','${id(5)}');
 if r is null or r->>'commandHash' is distinct from md5((select '{"type":"update-pipeline","pipelineId":"${id(8)}","expectedVersion":7,"name":"Updated"}'::jsonb)::text)
   or r->>'actorId'<>'${id(2)}' or r->>'tenantId'<>'${id(3)}' or r->>'idempotencyKey'<>'operation' then raise exception 'original command not independently resolved';end if;
 if r is distinct from public.read_pipeline_metadata_original('${id(1)}','${id(4)}','${id(5)}') then raise exception 'read replay unstable';end if;
 if public.read_pipeline_metadata_original('${id(1)}','${id(9)}','${id(5)}') is not null then raise exception 'foreign intent resolved';end if;
 if public.read_pipeline_metadata_original('${id(9)}','${id(4)}','${id(5)}') is not null then raise exception 'foreign thread resolved';end if;
 if public.read_pipeline_metadata_original('${id(1)}','${id(4)}','${id(9)}') is not null then raise exception 'foreign effect resolved';end if;
 perform set_config('test.actor','${id(9)}',true);
 if public.read_pipeline_metadata_original('${id(1)}','${id(4)}','${id(5)}') is not null then raise exception 'switched actor resolved';end if;
 perform set_config('test.actor','${id(2)}',true);perform set_config('test.tenant','${id(9)}',true);
 if public.read_pipeline_metadata_original('${id(1)}','${id(4)}','${id(5)}') is not null then raise exception 'foreign tenant resolved';end if;
 perform set_config('test.tenant','${id(3)}',true);perform set_config('test.admin','false',true);
 if public.read_pipeline_metadata_original('${id(1)}','${id(4)}','${id(5)}') is not null then raise exception 'revoked Pipeline permission resolved';end if;
end $$;reset role;set test.tenant='${id(3)}';
set test.admin='true';
do $$begin
 if has_function_privilege('anon','public.read_pipeline_metadata_original(uuid,uuid,uuid)','execute')
 or has_function_privilege('service_role','public.read_pipeline_metadata_original(uuid,uuid,uuid)','execute') then raise exception 'noncaller role granted';end if;
end $$;
update paige_pending_confirmations set server_issued_at=null;set role authenticated;
do $$begin if public.read_pipeline_metadata_original('${id(1)}','${id(4)}','${id(5)}') is not null then raise exception 'unissued card accepted';end if;end $$;reset role;
update paige_pending_confirmations set server_issued_at=now(),consumed_at=null;set role authenticated;
do $$begin if public.read_pipeline_metadata_original('${id(1)}','${id(4)}','${id(5)}') is not null then raise exception 'unspent card accepted';end if;end $$;reset role;
update paige_pending_confirmations set consumed_at=now();
alter table paige_chat_turns disable trigger user;
update paige_chat_turns set bundle_ref='{"paige_resume":{"approval_outcome":{"actions":[{"fingerprint":"${token}","outcome":"unconfirmed"},{"fingerprint":"${token}","outcome":"not_run"}]}}}';
alter table paige_chat_turns enable trigger user;set role authenticated;
do $$begin if public.read_pipeline_metadata_original('${id(1)}','${id(4)}','${id(5)}') is not null then raise exception 'contradictory observations accepted';end if;end $$;reset role;
-- Protected fields are cleared only by the fixture owner, never a runtime caller.
alter table paige_chat_turns disable trigger user;
update paige_chat_turns set interactive_intent_id=null,interactive_actor_id=null,interactive_tenant_id=null,interactive_terminal_state=null;
alter table paige_chat_turns enable trigger user;set role authenticated;
do $$begin if public.read_pipeline_metadata_original('${id(1)}','${id(4)}','${id(5)}') is not null then raise exception 'legacy forged JSON accepted';end if;end $$;reset role;
do $$begin if(select message_count from paige_chat_threads where id='${id(1)}')<>0
 or (select interactive_executor_intent from paige_chat_threads where id='${id(1)}') is not null
 or (select active from paige_chat_interactive_rollout where singleton) then raise exception 'read altered execution authority';end if;end $$;
rollback;
`;
const run = spawnSync(process.env.PSQL_BIN ?? 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', url], { input: sql, encoding: 'utf8' });
if (run.status !== 0) { console.error(run.stderr); process.exit(run.status ?? 1); }
console.log('PASS native read-only original-command hash, exact scope/intent/effect, replay, switched identity, unissued/unspent cards, forged legacy JSON, role ACL and unchanged DRAINING/executor');
