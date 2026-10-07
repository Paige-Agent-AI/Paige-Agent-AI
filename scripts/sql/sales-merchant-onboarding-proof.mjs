// Disposable localhost PostgreSQL integrity proof. No hosted connection.
import {readFileSync,mkdirSync} from 'node:fs';import {spawnSync,spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
const binary='C:/Program Files/PostgreSQL/16/bin/',cluster=new URL('../../work/merchant-proof-pg-'+randomUUID(),import.meta.url).pathname.replace(/^\/(?:([A-Z]:))/,'$1'),port='56479';
const command=(exe,args,input='',ignore=false)=>{const p=spawnSync(binary+exe,args,{input,encoding:'utf8',windowsHide:true,stdio:ignore?'ignore':undefined,timeout:30000});if(p.status!==0)throw Error(p.stderr||`${exe} exit ${p.status}`);return p.stdout?.trim()??'';};
mkdirSync(cluster,{recursive:true});command('initdb.exe',['-D',cluster,'-U','merchant_proof','--auth=trust','--no-locale']);command('pg_ctl.exe',['-D',cluster,'-l',cluster+'/server.log','-w','-o',`-p ${port} -h 127.0.0.1`,'start'],'',true);
const run=sql=>command('psql.exe',['-h','127.0.0.1','-p',port,'-U','merchant_proof','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-At'],sql);
const concurrent=sql=>new Promise((resolve,reject)=>{const proc=spawn(binary+'psql.exe',['-h','127.0.0.1','-p',port,'-U','merchant_proof','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',error='';proc.stdout.on('data',data=>output+=data);proc.stderr.on('data',data=>error+=data);proc.on('error',reject);proc.on('close',code=>code?reject(Error(error)):resolve(JSON.parse(output.split('\n').find(line=>line.startsWith('{')))));proc.stdin.end(sql);});
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');const extract=(src,name)=>{const a=src.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),b=src.indexOf('END $$;',a);assert(a>=0&&b>a,name);return src.slice(a,b+7);};
const actor=randomUUID(),tenant=randomUUID(),other=randomUUID(),op=randomUUID(),claim=randomUUID();let checks=0;
const deny=(sql,pattern)=>{assert.throws(()=>run(sql),pattern);checks++;};
try{
 assert.equal(run('SHOW data_directory;').replaceAll('\\','/').toLowerCase(),cluster.toLowerCase());
 run(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);CREATE TABLE tenants(id uuid PRIMARY KEY,status text);CREATE TABLE profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);CREATE TABLE tenant_members(tenant_id uuid,user_id uuid,status text,role text);
 CREATE TABLE tenant_stripe_accounts(tenant_id uuid PRIMARY KEY REFERENCES tenants(id),stripe_account_id text NOT NULL UNIQUE,account_type text NOT NULL DEFAULT 'express',charges_enabled boolean NOT NULL DEFAULT false,payouts_enabled boolean NOT NULL DEFAULT false,details_submitted boolean NOT NULL DEFAULT false,country text,default_currency text,requirements jsonb);
 CREATE TABLE paige_workspace_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,actor_id uuid,source_kind text,source_id uuid,source_revision bigint,outcome text,occurred_at timestamptz DEFAULT clock_timestamp(),actor_agent_slug text,actor_agent_label text,capability_key text,UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
 CREATE TABLE paige_subagents(slug text,tenant_id uuid,rail_display_name text);CREATE SCHEMA realtime;CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS 'SELECT';
 GRANT USAGE ON SCHEMA auth,public TO service_role,authenticated,anon;GRANT ALL ON tenant_stripe_accounts TO service_role;
 INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO tenants VALUES('${tenant}','active'),('${other}','active');INSERT INTO profiles VALUES('${actor}','${tenant}');INSERT INTO tenant_members VALUES('${tenant}','${actor}','active','owner');`);
 run(extract(read('supabase/migrations/20270543000000_sales_invoice_lifecycle.sql'),'_sales_invoice_actor')+extract(read('supabase/migrations/20270597000001_sales_invoice_provider_operations.sql'),'_sales_payment_operation_service'));
 const rail12=read('supabase/migrations/20261212000000_paige_can_show_her_work.sql'),rail20=read('supabase/migrations/20261220000000_an_act_that_landed_but_was_not_recorded.sql');run(extract(rail20,'_workspace_event_display')+extract(rail12,'_record_workspace_rail_event')+extract(rail20,'record_capability_run'));
 run(read('supabase/migrations/20270566000000_sales_merchant_readback.sql'));run(read('supabase/migrations/20270600000000_sales_merchant_onboarding.sql'));run(read('supabase/migrations/20270600000000_sales_merchant_onboarding.sql'));
 const reserve=(t=tenant,e='test',o=op)=>`SELECT reserve_sales_merchant_onboarding('${actor}','${t}','${e}','${o}','${claim}');`;
 const scoped='SET ROLE service_role;';const get=sql=>JSON.parse(run(sql).split('\n').find(x=>x.startsWith('{')));
 deny('SET ROLE authenticated;'+reserve(),/42501/);deny('SET ROLE anon;'+reserve(),/42501/);deny(scoped+reserve(other),/42501/);
 const racers=await Promise.all([concurrent(scoped+reserve()),concurrent(scoped+reserve())]);assert.equal(racers.filter(r=>r.dispatch).length,1);checks++;const first=racers.find(r=>r.dispatch);assert(first.dispatch);assert.equal(first.binding.stripe_account_id,null);checks+=2;
 const duplicate=get(scoped+reserve(tenant,'test',randomUUID()));assert(!duplicate.dispatch);assert.equal(duplicate.binding.onboarding_id,op);checks+=2;
 deny(scoped+reserve(tenant,'live'),/42501/);
 deny(scoped+`SELECT record_sales_stripe_readback('${tenant}','acct_notBound',1,'test',true,true,true,true,'US','usd','{}');`,/40001/);
 const persist=`SELECT persist_sales_merchant_onboarding('${actor}','${tenant}','test','${op}','${claim}',1,'acct_fixture');`;
 run(`UPDATE profiles SET active_tenant_id='${other}';`);deny(scoped+persist,/42501/);run(`UPDATE profiles SET active_tenant_id='${tenant}';`);
 deny(scoped+persist.replace(claim,randomUUID()),/40001/);
 run(`CREATE FUNCTION reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'receipt failed';END$$;CREATE TRIGGER receipt_failure BEFORE INSERT ON paige_workspace_events FOR EACH ROW EXECUTE FUNCTION reject_receipt();`);
 deny(scoped+persist,/receipt failed/);assert.equal(run('SELECT stripe_account_id IS NULL AND binding_version=1 FROM tenant_stripe_accounts;'),'t');checks++;
 run('DROP TRIGGER receipt_failure ON paige_workspace_events;');const bound=get(scoped+persist);assert.equal(bound.binding_version,2);assert.equal(bound.stripe_account_id,'acct_fixture');checks+=2;
 assert.equal(run(`SELECT count(*) FROM paige_workspace_events WHERE capability_key='sales_merchant_onboarding' AND outcome='capability_succeeded';`),'1');checks++;
 deny(scoped+persist,/40001/);deny(scoped+`UPDATE tenant_stripe_accounts SET onboarding_claim=gen_random_uuid();`,/22023/);deny(scoped+`UPDATE tenant_stripe_accounts SET stripe_account_id='acct_other';`,/22023/);
 console.log(`PASS ${checks} PostgreSQL integrity assertions; real actor/service guards, real Rail functions, canonical reservation/CAS, wrong roles/tenant/environment/claim, duplicate claim, version advance, immutable binding, receipt failure rollback. Synthetic local identities only.`);
}finally{command('pg_ctl.exe',['-D',cluster,'-m','fast','-w','stop'],'',true);}
