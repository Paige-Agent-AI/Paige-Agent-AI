// Native PostgreSQL proof, never a hosted acceptance drive. Requires an EMPTY disposable
// loopback database named test_e03_*. Canonical Messages/Threads DDL and trigger bodies are
// loaded from their real migrations; managed Auth and parent records are explicit fixtures.
import { readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const target = new URL(process.env.E03_FORM_PROOF_DATABASE_URL ?? 'invalid:');
assert(['localhost','127.0.0.1','[::1]'].includes(target.hostname), 'Disposable loopback database required');
assert(/^\/test_e03_[a-z0-9_]+$/.test(target.pathname), 'Synthetic database name required');
assert(!target.password, 'This proof accepts no credential-bearing URL');
const psql = process.env.E03_PSQL_BINARY || 'psql';
const args = ['-X','-q','-v','ON_ERROR_STOP=1','-A','-t',target.href];
const run = sql => execFileSync(psql,args,{input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
assert.equal(run("select count(*) from pg_tables where schemaname='public'"),'0','Refusing a non-empty database');
const c1 = readFileSync('supabase/migrations/20260726190000_comms_c1_messages_channel_connectors.sql','utf8');
const c15 = readFileSync('supabase/migrations/20260726210500_comms_c15_inbox_depth_foundation.sql','utf8');
const table = (source,name) => {
  const found = source.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`,'i'));
  assert(found,`Canonical ${name} DDL not found`); return found[0];
};
const fn = (source,name) => {
  const found = source.match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`,'i'));
  assert(found,`Canonical ${name} function not found`); return found[0];
};
run(`begin;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function public.current_user_tenant_id() returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
create table public.tenants(id uuid primary key);
create table public.clients(id uuid primary key,tenant_id uuid references tenants,first_name text,last_name text);
create table public.channel_connectors(id uuid primary key,tenant_id uuid references tenants);
create table public.paige_actions(id uuid primary key);
create table public.growth_forms(id uuid primary key,tenant_id uuid references tenants,name text,lead_reply_enabled boolean);
create table public.growth_form_submissions(id uuid primary key,tenant_id uuid references tenants,form_id uuid references growth_forms,contact_id uuid references clients,created_at timestamptz default now());
create table public.client_contact_methods(id uuid primary key default gen_random_uuid(),tenant_id uuid,client_id uuid,kind text,value text,is_primary boolean,position integer default 0,created_at timestamptz default now());
${table(c1,'messages')}
${table(c15,'threads')}
${fn(c1,'set_message_tenant')}
${fn(c15,'set_thread_tenant')}
${fn(c15,'tg_message_upsert_thread')}
create trigger trg_messages_tenant before insert on public.messages for each row execute function public.set_message_tenant();
create trigger trg_threads_tenant before insert on public.threads for each row execute function public.set_thread_tenant();
create trigger trg_messages_upsert_thread after insert on public.messages for each row execute function public.tg_message_upsert_thread();
grant usage on schema public to anon,authenticated,service_role;
grant all on all tables in schema public to service_role;
grant select,insert,update on messages to authenticated;
${readFileSync('supabase/migrations/20271103140117_e03_form_inquiry_conversations.sql','utf8')}
create function public.proof_assert(ok boolean,note text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',note;end if;end$$;
insert into tenants values('11111111-1111-4111-8111-111111111111'),('99999999-9999-4999-8999-999999999999');
insert into clients values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Test','Lead'),('88888888-8888-4888-8888-888888888888','99999999-9999-4999-8999-999999999999','Other','Lead');
insert into growth_forms values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Test inquiry',true),('77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999','Other inquiry',true);
insert into client_contact_methods(tenant_id,client_id,kind,value,is_primary) values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','email','lead@example.test',true);
insert into growth_form_submissions(id,tenant_id,form_id,contact_id) select ('44444444-4444-4444-8444-'||lpad(n::text,12,'0'))::uuid,'11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222' from generate_series(1,7)n;
commit;`);
const id = n => `44444444-4444-4444-8444-${String(n).padStart(12,'0')}`;
const call = (n,email='lead@example.test',body='Question: Can we talk?') => `select public.growth_record_form_inquiry('${id(n)}','${email}','${body}');`;
const service = sql => run(`set role service_role;${sql}`);
assert.equal(JSON.parse(service(call(1))).ok,true);
assert.equal(JSON.parse(service(call(1,'lead@example.test','Changed replay'))).replayed,true);
run(`select proof_assert((select count(*)=1 from messages),'one canonical message');
select proof_assert((select count(*)=1 and max(unread_count)=1 from threads),'one canonical unread/thread');
select proof_assert((select tenant_id='11111111-1111-4111-8111-111111111111' and thread_key='contact:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222' and channel_type='form' and direction='inbound' and provider_message_id is null and body_text='Question: Can we talk?' from messages),'derived identity, truthful channel and immutable replay');
select proof_assert(not has_function_privilege('anon','public.growth_record_form_inquiry(uuid,text,text)','execute'),'anon RPC denied');
select proof_assert(not has_function_privilege('authenticated','public.growth_record_form_inquiry(uuid,text,text)','execute'),'authenticated RPC denied');
select proof_assert((select not prosecdef from pg_proc where oid='public.growth_record_form_inquiry(uuid,text,text)'::regprocedure),'invoker preserves role');`);
assert.equal(JSON.parse(service(call(2,'stranger@example.test'))).reason,'submitted_email_not_contact_email');
run("update growth_form_submissions set contact_id='88888888-8888-4888-8888-888888888888' where id='"+id(2)+"'");
assert.equal(JSON.parse(service(call(2))).reason,'no_contact');
run("update growth_form_submissions set form_id='77777777-7777-4777-8777-777777777777' where id='"+id(2)+"'");
function refuses(sql,pattern) { assert.throws(()=>run(sql),e=>pattern.test(String(e.stderr)),`Expected refusal ${pattern}`); }
refuses(`set role service_role;${call(2)}`,/FORM_INQUIRY_WORKSPACE_MISMATCH/);
run("update growth_forms set lead_reply_enabled=false where id='33333333-3333-4333-8333-333333333333'");
assert.equal(JSON.parse(service(call(3))).reason,'form_not_opted_in');
run("update growth_forms set lead_reply_enabled=true where id='33333333-3333-4333-8333-333333333333'");
refuses(`set role authenticated;${call(3)}`,/permission denied/);
refuses(`set role authenticated;insert into messages(contact_id,thread_key,channel_type,direction,form_submission_id) values('22222222-2222-4222-8222-222222222222','forged','form','inbound','${id(3)}')`,/FORM_INQUIRY_PROCESSOR_ONLY/);
refuses("set role authenticated;update messages set body_text='Forged'",/FORM_INQUIRY_IMMUTABLE/);
refuses("set role service_role;update messages set form_submission_id=null",/FORM_INQUIRY_IMMUTABLE/);
refuses(`set role service_role;insert into messages(contact_id,thread_key,channel_type,direction,form_submission_id) values('22222222-2222-4222-8222-222222222222','forged','form','outbound','${id(3)}')`,/messages_form_inbound_only/);
run("set role authenticated;update messages set status='read'");
run("update client_contact_methods set is_primary=false");
assert.equal(JSON.parse(service(call(3))).reason,'submitted_email_not_contact_email');
run("update client_contact_methods set is_primary=true");
refuses(`set role service_role;select growth_record_form_inquiry('${id(3)}','lead@example.test',repeat('x',10001))`,/FORM_INQUIRY_CONTENT_INVALID/);
assert.equal(JSON.parse(service(call(3))).ok,true);
const concurrent = sql => new Promise((resolve,reject)=>{
 const child=spawn(psql,args,{stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.on('data',b=>{stderr+=b});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(stderr)));child.stdin.end(sql);
});
await Promise.all([
 concurrent(`begin;set role service_role;${call(4)}select pg_sleep(1);commit;`),
 concurrent(`begin;set role service_role;${call(4)}commit;`),
]);
run(`select proof_assert((select count(*)=3 from messages),'concurrent replay inserted once');
select proof_assert((select count(*)=1 and max(unread_count)=3 from threads),'canonical trigger incremented once per inquiry');
set role service_role;
insert into messages(contact_id,thread_key,channel_type,direction,status,body_text) values('22222222-2222-4222-8222-222222222222','contact:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222','email','outbound','draft','Existing draft');
update messages set body_text='Existing draft edited' where channel_type='email';reset role;
select proof_assert((select count(*)=1 and max(body_text)='Existing draft edited' from messages where channel_type='email'),'existing email editing preserved');`);
console.log('PASS native PostgreSQL: canonical Messages/Threads DDL+triggers; derived tenant/contact, primary-email mismatch and foreign form/contact refusal, service-only invoker ACL, immutable inquiry/read status, exact and concurrent replay, one contact thread/unread, preserved email editing. Managed Auth/RLS and full migration replay remain UNVERIFIED; no provider or production access.');
