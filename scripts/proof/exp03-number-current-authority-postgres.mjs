// Dedicated disposable loopback database, incumbent adapter and original SQL sources.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
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
 // Strict source drift guard must refuse even an otherwise valid second application.
 refuse(read('scripts/proof/exp03-number-current-authority-patch.sql'),/source drift/);
 console.log(JSON.stringify({checks,scope:'native component fixture only; no provider/purchase/runtime/customer proof'}));
}finally{
 const r=spawnSync(db.psql,db.args('postgres'),{input:`DROP DATABASE ${db.database} WITH (FORCE);`,encoding:'utf8',timeout:60000});
 if(r.status!==0)throw new Error('Owned disposable database cleanup failed');
}
