// Dedicated disposable loopback database, incumbent adapter and original SQL sources.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
const db=new OperatorPostgresFixture(Number(process.argv[2]));db.prefix=()=>'';
const read=p=>readFileSync(p,'utf8');
function source(file,name){
 const text=read(`supabase/migrations/${file}.sql`);
 const start=text.search(new RegExp(`create or replace function public\\.${name}\\(`,'i'));
 assert(start>=0,name);const rest=text.slice(start),tag=rest.match(/\bAS\s+(\$\w*\$)/i);
 assert(tag,name);const end=rest.indexOf(`${tag[1]};`,tag.index+tag[0].length);assert(end>=0,name);
 return rest.slice(0,end+tag[1].length+1);
}
const actor='70000000-0000-4000-8000-000000000001';
const tenant='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
const first='20000000-0000-4000-8000-000000000001';
const second='20000000-0000-4000-8000-000000000002';
let checks=0;
function refuse(sql,pattern){assert.throws(()=>db.run(sql),pattern);checks++;}
try{
 db.run(`CREATE SCHEMA auth;
 DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role;END IF;
 END$$;
 CREATE TYPE public.app_role AS ENUM('admin','moderator','user','super_admin','platform_admin');
 CREATE TYPE public.tenant_role AS ENUM('owner','admin','coach','member');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 CREATE TABLE public.tenants(id uuid PRIMARY KEY,account_type text,parent_tenant_id uuid,features jsonb);
 CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
 CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,role tenant_role,status text,joined_at timestamptz DEFAULT now());
 CREATE TABLE public.user_roles(user_id uuid,role app_role);
 CREATE FUNCTION public.agency_can_manage_child(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION public.agency_team_role(uuid,uuid) RETURNS text LANGUAGE sql AS $$SELECT NULL::text$$;
 CREATE TABLE public.tenant_phone_numbers(id uuid PRIMARY KEY,tenant_id uuid,friendly_name text,status text,is_primary boolean DEFAULT false,updated_at timestamptz DEFAULT now());
 CREATE UNIQUE INDEX uq_tenant_phone_numbers_primary ON tenant_phone_numbers(tenant_id) WHERE is_primary;
 INSERT INTO tenants VALUES('${tenant}','standalone',null,'{}'),('${other}','standalone',null,'{}');
 INSERT INTO profiles VALUES('${actor}','${tenant}');
 INSERT INTO tenant_members(tenant_id,user_id,role,status) VALUES('${tenant}','${actor}','owner','active');
 INSERT INTO tenant_phone_numbers(id,tenant_id,status) VALUES('${first}','${tenant}','active'),('${second}','${tenant}','active');`);
 for(const [file,name] of [
 ['20251009234919_3d7566f7-15b7-462f-90a3-b74b713298b6','has_role'],
 ['20260628013834_d790fe45-ba03-445b-bb94-6373e77f9f0b','has_any_role'],
 ['20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c','is_super_admin'],
 ['20260702184358_a1b946ac-338b-4c86-8b70-0850b38b2c8c','is_platform_owner'],
 ['20260714142258_tier_rail_phaseB','is_platform_admin'],
 ['20270521000000_operator_authority_in_company_workspaces','is_company_workspace'],
 ['20270521000000_operator_authority_in_company_workspaces','is_tenant_admin_as'],
 ['20260714144656_tier_rail_phaseB_agency_standing','current_user_tenant_id']])db.run(source(file,name));
 db.run(read('scripts/proof/fixtures/exp03-number-management-before.sql'));
 db.run(`REVOKE ALL ON FUNCTION public.tenant_phone_number_rename(uuid,text,uuid),public.tenant_phone_number_set_primary(uuid,uuid) FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION public.tenant_phone_number_rename(uuid,text,uuid),public.tenant_phone_number_set_primary(uuid,uuid) TO authenticated,service_role;`);
 const asActor=`SELECT set_config('test.actor','${actor}',false);`;
 const primary=`SELECT public.tenant_phone_number_set_primary('${first}')`;
 const rename=`SELECT public.tenant_phone_number_rename('${first}',' Main ')`;
 refuse(asActor+primary,/FORBIDDEN/);refuse(asActor+rename,/FORBIDDEN/);
 db.run(read('scripts/proof/exp03-number-current-authority-patch.sql'));
 for(const role of ['owner','admin']){
  db.run(`UPDATE tenant_members SET role='${role}';`+asActor+primary+';'+rename);
  assert.match(db.run(`SELECT friendly_name||':'||is_primary FROM tenant_phone_numbers WHERE id='${first}'`),/Main:true/);checks++;
 }
 db.run(asActor+`SELECT public.tenant_phone_number_set_primary('${second}');`);
 assert.match(db.run(`SELECT count(*) FROM tenant_phone_numbers WHERE is_primary`),/1/);checks++;
 db.run(asActor+`SELECT public.tenant_phone_number_rename('${first}','');`);
 assert.match(db.run(`SELECT friendly_name IS NULL FROM tenant_phone_numbers WHERE id='${first}'`),/t/);checks++;
 db.run(`UPDATE tenant_members SET role='member'; INSERT INTO user_roles VALUES('${actor}','admin');`);
 refuse(asActor+primary,/FORBIDDEN/);refuse(asActor+rename,/FORBIDDEN/);
 db.run(`DELETE FROM user_roles; UPDATE tenant_members SET role='admin',status='inactive';`);
 refuse(asActor+primary,/NO_TENANT/);
 db.run(`UPDATE tenant_members SET status='active';`);
 refuse(asActor+`SELECT public.tenant_phone_number_set_primary('${first}','${other}')`,/TENANT_MISMATCH/);
 db.run(`UPDATE tenant_phone_numbers SET status='suspended' WHERE id='${first}';`);
 refuse(asActor+primary,/NUMBER_NOT_ACTIVE/);
 refuse(asActor+`SELECT public.tenant_phone_number_rename('${first}',repeat('x',121))`,/NAME_TOO_LONG/);
 refuse(`SELECT set_config('test.actor','',false);`+primary,/TENANT_REQUIRED/);
 // Replaying ONLY exact reviewed source is inert; unknown source or grants refuse.
 const patch=read('scripts/proof/exp03-number-current-authority-patch.sql').replaceAll('\r\n','\n');
 db.run(patch);checks++;
 refuse(`SET ROLE anon;`+primary,/permission denied/);
 db.run(`GRANT EXECUTE ON FUNCTION public.tenant_phone_number_set_primary(uuid,uuid) TO anon;`);
 refuse(patch,/metadata drift/);
 db.run(`REVOKE EXECUTE ON FUNCTION public.tenant_phone_number_set_primary(uuid,uuid) FROM anon;`);
 // Original label writer accepts any owned number; primary requires active status.
 db.run(`SELECT set_config('test.actor','',false);SELECT public.tenant_phone_number_rename('${first}',' Service ','${tenant}');`);
 assert.match(db.run(`SELECT friendly_name FROM tenant_phone_numbers WHERE id='${first}'`),/Service/);checks++;
 db.run(`INSERT INTO tenant_phone_numbers(id,tenant_id,status) VALUES('20000000-0000-4000-8000-000000000003','${other}','active');`);
 refuse(asActor+`SELECT public.tenant_phone_number_set_primary('20000000-0000-4000-8000-000000000003')`,/NUMBER_NOT_FOUND/);
 db.run(`ALTER FUNCTION public.tenant_phone_number_rename(uuid,text,uuid) SET search_path TO public,pg_catalog;`);
 refuse(patch,/metadata drift/);
 // A later writer's unknown source rolls back even the first writer's repair.
 db.run(read('scripts/proof/fixtures/exp03-number-management-before.sql'));
 const primaryDefinition=db.run(`SELECT pg_get_functiondef('public.tenant_phone_number_set_primary(uuid,uuid)'::regprocedure)`).replaceAll('\r\n','\n');
 assert(primaryDefinition.includes('begin\n'));
 db.run(primaryDefinition.replace('begin\n','begin\n  -- synthetic source drift\n'));
 const beforeAtomic=db.run(`SELECT md5(pg_get_functiondef('public.tenant_phone_number_rename(uuid,text,uuid)'::regprocedure))`);
 refuse(patch,/source drift/);
 assert.equal(db.run(`SELECT md5(pg_get_functiondef('public.tenant_phone_number_rename(uuid,text,uuid)'::regprocedure))`),beforeAtomic);checks++;
 if(process.argv.includes('--currentness')){
  db.run(read('scripts/proof/fixtures/exp03-contact-authority-helpers-before.sql'));
  for(const [,name,digest] of read('scripts/proof/fixtures/exp03-contact-authority-helpers-before.sql').matchAll(/^-- ([^\r\n]+): ([a-f0-9]{32})$/gm)){
   assert.equal(db.run(`SELECT md5(pg_get_functiondef('public.${name}'::regprocedure))`),digest);checks++;
  }
  db.run(read('scripts/proof/fixtures/exp03-number-management-before.sql'));db.run(patch);
  const snapshot=()=>db.run('SELECT jsonb_agg(n ORDER BY id) FROM tenant_phone_numbers n');
  const wait=async(writer,kind,allowLost=false)=>{
   db.run(`DELETE FROM user_roles;DELETE FROM tenant_members WHERE user_id='${actor}' AND tenant_id='${other}';UPDATE tenant_members SET role='admin',status='active' WHERE user_id='${actor}';UPDATE profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';UPDATE tenant_phone_numbers SET friendly_name='Before',status='active',is_primary=false,updated_at='2026-10-30T18:00:00.123456Z';`);
   db.run(`INSERT INTO tenant_members(tenant_id,user_id,role,status) SELECT '${tenant}','70000000-0000-4000-8000-000000000003','owner','active' WHERE NOT EXISTS(SELECT 1 FROM tenant_members WHERE user_id='70000000-0000-4000-8000-000000000003');`);
   if(writer==='primary-old-row')db.run(`UPDATE tenant_phone_numbers SET is_primary=true WHERE id='${second}';`);
   if(kind.startsWith('root'))db.run(`INSERT INTO user_roles VALUES('${actor}','super_admin');`);
   const before=snapshot();
   const lock=writer==='primary-advisory'?`SELECT pg_advisory_xact_lock(hashtextextended('${tenant}'::text,0));`:`SELECT 1 FROM tenant_phone_numbers WHERE id='${writer==='primary-old-row'?second:first}' FOR UPDATE;`;
   const held=await db.holdArchive(lock,[],{manualRelease:true});let child,pending;
   try{
    const app=`exp03_number_wait_${process.pid}`;
    child=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let errors='';child.stdout.resume();child.stderr.on('data',d=>{errors+=d;});
    pending=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,errors}));});pending.catch(()=>{});
    const tenantArg=kind==='root-explicit'?`, '${tenant}'`:'';
    const call=writer==='rename'?`SELECT public.tenant_phone_number_rename('${first}','After'${tenantArg});`:`SELECT public.tenant_phone_number_set_primary('${first}'${tenantArg});`;
    child.stdin.end(`SET application_name='${app}';SET lock_timeout='8s';SET statement_timeout='12s';${asActor}SET ROLE authenticated;${call}`);
    let waiting=false;const deadline=Date.now()+6000;
    while(Date.now()<deadline){waiting=db.run(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='${app}' AND wait_event_type='Lock')`)==='t';if(waiting)break;await new Promise(resolve=>setTimeout(resolve,40));}
    assert(waiting,'actual original number writer must be observed waiting');
    if(kind==='role')db.run(`UPDATE tenant_members SET role='member' WHERE tenant_id='${tenant}' AND user_id='${actor}';`);
    if(['workspace','root-workspace','root-explicit'].includes(kind))db.run(`INSERT INTO tenant_members(tenant_id,user_id,role,status) VALUES('${other}','${actor}','owner','active');UPDATE profiles SET active_tenant_id='${other}' WHERE user_id='${actor}';`);
    held.release();await held.completed;const result=await pending;
    if(allowLost||['none','root-explicit'].includes(kind)){assert.equal(result.code,0,JSON.stringify(result));assert.notEqual(snapshot(),before);}
    else{assert.notEqual(result.code,0,`${writer}/${kind}: lost current authority must refuse`);assert.match(result.errors,/NUMBER_AUTHORITY_CHANGED/);assert.equal(snapshot(),before,'no number mutation after authority changed');}
    checks++;
   }finally{held.release(false);await held.completed.catch(()=>{});if(child&&child.exitCode===null)child.kill();if(pending)await pending.catch(()=>{});}
  };
  for(const writer of ['rename','primary-advisory','primary-target-row','primary-old-row'])for(const kind of ['role','workspace','none','root-workspace','root-explicit'])await wait(writer,kind);
  const gate=patch.match(/authority_guard text := \$gate\$([\s\S]*?)\$gate\$;/)[1];
  const renameLock=patch.match(/rename_lock text := \$rlock\$([\s\S]*?)\$rlock\$;/)[1];
  const primaryLock=patch.match(/primary_lock text := \$plock\$([\s\S]*?)\$plock\$;/)[1];
  const definitions=new Map();
  for(const [name,originalHash] of [['tenant_phone_number_rename(uuid,text,uuid)','a8297d7bba472a3148c57e80265ce72d'],['tenant_phone_number_set_primary(uuid,uuid)','f15793f40cdd05c228984d3daa8f5ecc']]){
   const definition=db.run(`SELECT pg_get_functiondef('public.${name}'::regprocedure)`).replaceAll('\r\n','\n');definitions.set(name,definition);
   assert.equal(definition.split(gate).length-1,1);
   const lock=name.startsWith('tenant_phone_number_rename')?renameLock:primaryLock;
   assert.equal(definition.split(lock).length-1,1);
   const inverse=definition.replace(gate,'').replace(lock,'').replace('or public.is_tenant_admin_as(v_caller, v_tenant)',"or public.has_any_role(v_caller, array['admin'])");
   db.run(inverse);assert.equal(db.run(`SELECT md5(pg_get_functiondef('public.${name}'::regprocedure))`),originalHash);db.run(definition);checks++;
  }
  for(const [name,span,writer,kind] of [
   ['tenant_phone_number_rename(uuid,text,uuid)',gate,'rename','role'],
   ['tenant_phone_number_set_primary(uuid,uuid)',gate,'primary-advisory','workspace'],
   ['tenant_phone_number_set_primary(uuid,uuid)',gate,'primary-old-row','role'],
   ['tenant_phone_number_rename(uuid,text,uuid)',renameLock,'rename','role'],
   ['tenant_phone_number_set_primary(uuid,uuid)',primaryLock,'primary-old-row','role'],
  ]){
   const original=definitions.get(name);db.run(original.replace(span,''));await wait(writer,kind,true);db.run(original);
  }
  db.run(`SELECT set_config('test.actor','',false);SET ROLE service_role;SELECT public.tenant_phone_number_set_primary('${second}','${tenant}');`);
  assert.equal(db.run(`SELECT count(*) FROM tenant_phone_numbers WHERE tenant_id='${tenant}' AND is_primary`),'1');assert.equal(db.run(`SELECT is_primary FROM tenant_phone_numbers WHERE id='${second}'`),'t');checks++;
  const beforeForeignService=snapshot();refuse(`SELECT set_config('test.actor','',false);SET ROLE service_role;SELECT public.tenant_phone_number_set_primary('${first}','${other}');`,/NUMBER_NOT_FOUND/);assert.equal(snapshot(),beforeForeignService);
  const beforeReplay=snapshot();db.run(patch);assert.equal(snapshot(),beforeReplay);checks++;

 }
 console.log(JSON.stringify({checks,scope:'native component fixture only; no provider/purchase/runtime/customer proof'}));
}finally{
 const r=spawnSync(db.psql,db.args('postgres'),{input:`DROP DATABASE ${db.database} WITH (FORCE);`,encoding:'utf8',timeout:60000});
 if(r.status!==0)throw new Error('Owned disposable database cleanup failed');
}
