// Native original-writer component proof. Dedicated disposable loopback database only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
const db=new OperatorPostgresFixture(Number(process.argv[2]));db.prefix=()=>'';
const read=p=>readFileSync(p,'utf8');
const actor='70000000-0000-4000-8000-000000000001',impostor='70000000-0000-4000-8000-000000000002';
const tenant='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const contact='20000000-0000-4000-8000-000000000001',foreign='20000000-0000-4000-8000-000000000002';
const signature='public.upsert_contact(jsonb,uuid,uuid,uuid,text)';
const patch=read('scripts/proof/exp03-contact-current-authority-patch.sql');let checks=0;
const caller=id=>`SELECT set_config('test.actor','${id}',false);SET ROLE authenticated;`;
const save=(json,id=contact,tenantArg='NULL',actorArg='NULL')=>`SELECT public.upsert_contact('${JSON.stringify(json).replaceAll("'","''")}'::jsonb,${id?`'${id}'`:'NULL'},${tenantArg},${actorArg},'manual');`;
const state=()=>db.run('SELECT jsonb_build_object(\'contacts\',(SELECT jsonb_agg(c ORDER BY id) FROM clients c),\'audits\',(SELECT jsonb_agg(a ORDER BY id) FROM audit_logs a))');
function refuse(sql,pattern){const before=state();assert.throws(()=>db.run(sql),pattern);assert.equal(state(),before,'refusal makes no contact or audit mutation');checks++;}
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
 CREATE TABLE public.clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,first_name text,last_name text,entity_name text,entity_type text,title text,website text,linkedin_url text,street_address text,city text,state text,zip_code text,lifecycle_stage text,source text,tags text[],primary_offer text,current_notes text,status text,assigned_coach_user_id uuid,do_not_contact boolean,created_by uuid,created_by_channel_type text,updated_at timestamptz DEFAULT now());
 CREATE TABLE public.audit_logs(id bigserial PRIMARY KEY,user_id uuid,entity text,action text,entity_id uuid,data jsonb);
 -- Address methods are outside this authority component. Fail loudly if this proof enters them.
 CREATE FUNCTION public.contact_methods_canonical(jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'UNEXERCISED_METHODS';END$$;
 CREATE FUNCTION public._client_contact_methods_payload(uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'UNEXERCISED_METHODS';END$$;
 CREATE FUNCTION public.contact_methods_fingerprint(jsonb) RETURNS text LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'UNEXERCISED_METHODS';END$$;
 CREATE FUNCTION public._replace_client_contact_methods(uuid,uuid,jsonb) RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'UNEXERCISED_METHODS';END$$;
 INSERT INTO tenants VALUES('${tenant}','standalone',null,'{}'),('${other}','standalone',null,'{}');
 INSERT INTO profiles VALUES('${actor}','${tenant}'),('${impostor}','${other}');
 INSERT INTO tenant_members(tenant_id,user_id,role,status) VALUES('${tenant}','${actor}','owner','active'),('${other}','${impostor}','owner','active');
 INSERT INTO clients(id,tenant_id,first_name,last_name,status) VALUES('${contact}','${tenant}','Jordan','Rivera','active'),('${foreign}','${other}','Other','Contact','active');`);
 db.run(read('scripts/proof/fixtures/exp03-contact-authority-helpers-before.sql'));
 for(const [,name,digest] of read('scripts/proof/fixtures/exp03-contact-authority-helpers-before.sql').matchAll(/^-- ([^\r\n]+): ([a-f0-9]{32})$/gm)){
  assert.equal(db.run(`SELECT md5(pg_get_functiondef('public.${name}'::regprocedure))`),digest,'current deployed helper identity');checks++;
 }
 db.run(read('scripts/proof/fixtures/exp03-contact-management-before.sql'));
 db.run(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;GRANT EXECUTE ON FUNCTION ${signature} TO authenticated,service_role;`);
 const verify=()=>db.run(`SELECT md5(pg_get_functiondef('${signature}'::regprocedure))`);
 assert.equal(verify(),'0b3e44a65443104b2068168faf452b0f');checks++;
 refuse(caller(actor)+save({first_name:'Eligible owner'}),/CONTACT_FORBIDDEN/);
 db.run(`UPDATE tenant_members SET role='admin' WHERE user_id='${actor}';`);
 refuse(caller(actor)+save({first_name:'Eligible admin'}),/CONTACT_FORBIDDEN/);
 // A global Admin who is only a member currently succeeds; the repair must remove this bypass.
 db.run(`UPDATE tenant_members SET role='member' WHERE user_id='${actor}';INSERT INTO user_roles VALUES('${actor}','admin');`+caller(actor)+save({first_name:'Old global bypass'}));
 checks++;
 db.run(patch);assert.equal(verify(),'bb9b4de901b59d776ec3c82fa649770f');checks++;
 refuse(caller(actor)+save({first_name:'Forbidden member'}),/CONTACT_FORBIDDEN/);
 db.run(`DELETE FROM user_roles;`);
 for(const role of ['owner','admin']){
  db.run(`UPDATE tenant_members SET role='${role}' WHERE user_id='${actor}';`+caller(actor)+save({first_name:' Current owner ',current_notes:'Preserve my note'}));
  assert.equal(db.run(`SELECT first_name||':'||current_notes FROM clients WHERE id='${contact}'`),'Current owner:Preserve my note');checks++;
 }
 db.run(caller(actor)+save({first_name:'New',last_name:'Lead'},null));
 assert.equal(db.run(`SELECT count(*) FROM clients WHERE tenant_id='${tenant}'`),'2');checks++;
 assert.equal(db.run(`SELECT bool_and(user_id='${actor}' AND data->>'tenant_id'='${tenant}') FROM audit_logs`),'t');checks++;
 refuse(caller(actor)+save({first_name:'Foreign'},foreign),/CONTACT_NOT_FOUND_OR_FORBIDDEN/);
 refuse(caller(actor)+save({first_name:'Wrong workspace'},contact,`'${other}'`),/CONTACT_TENANT_MISMATCH/);
 refuse(caller(impostor)+save({first_name:'Spoof'},contact,'NULL',`'${actor}'`),/CONTACT_NOT_FOUND_OR_FORBIDDEN/);
 db.run(`UPDATE tenant_members SET status='inactive' WHERE user_id='${actor}';`);
 refuse(caller(actor)+save({first_name:'Inactive'}),/CONTACT_NO_TENANT|CONTACT_FORBIDDEN/);
 db.run(`UPDATE tenant_members SET status='active',role='member' WHERE user_id='${actor}';`);
 refuse(caller(actor)+save({first_name:'Member'}),/CONTACT_FORBIDDEN/);
 refuse(`SELECT set_config('test.actor','',false);SET ROLE anon;`+save({first_name:'Anon'}),/permission denied/);
 const service=`SELECT set_config('test.actor','',false);SET ROLE service_role;`;
 refuse(service+save({first_name:'Missing actor'},contact,`'${tenant}'`),/CONTACT_FORBIDDEN/);
 refuse(service+save({first_name:'Unscoped actor'},contact,`'${tenant}'`,`'${actor}'`),/CONTACT_FORBIDDEN/);
 db.run(`UPDATE tenant_members SET role='admin' WHERE user_id='${actor}';`);
 refuse(service+save({first_name:'Missing tenant'},contact,'NULL',`'${actor}'`),/CONTACT_NO_TENANT/);
 db.run(service+save({first_name:'Service actor'},contact,`'${tenant}'`,`'${actor}'`));
 assert.equal(db.run(`SELECT first_name FROM clients WHERE id='${contact}'`),'Service actor');checks++;
 db.run(`INSERT INTO user_roles VALUES('${actor}','super_admin');`+caller(actor)+save({first_name:'Explicit root workspace'},foreign,`'${other}'`));
 assert.equal(db.run(`SELECT first_name FROM clients WHERE id='${foreign}'`),'Explicit root workspace');checks++;
 db.run(`DELETE FROM user_roles;INSERT INTO user_roles VALUES('${actor}','platform_admin');UPDATE profiles SET active_tenant_id='${other}' WHERE user_id='${actor}';`);
 refuse(caller(actor)+save({first_name:'Customer operator bypass'},foreign),/CONTACT_FORBIDDEN/);
 db.run(`UPDATE tenants SET features='{"system_workspace":true}' WHERE id='${other}';`+caller(actor)+save({first_name:'Company operator'},foreign));
 assert.equal(db.run(`SELECT first_name FROM clients WHERE id='${foreign}'`),'Company operator');checks++;
 db.run(`DELETE FROM user_roles;UPDATE tenants SET features='{}';UPDATE profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';`);
 refuse(caller(actor)+save({timezone:'America/New_York',timezone_verified:true}),/CONTACT_FIELDS_FORBIDDEN/);
 refuse(caller(actor)+save({status:'invented'}),/CONTACT_BAD_STATUS/);
 refuse(caller(actor)+save({email:'not-a-method@example.invalid'}),/CONTACT_ADDRESS_FIELDS_RETIRED/);
 // Same exact function replay is inert; metadata/source drift refuses before replacing anything.
 db.run(patch);checks++;
 db.run(`GRANT EXECUTE ON FUNCTION ${signature} TO anon;`);assert.throws(()=>db.run(patch),/metadata drift/);checks++;
 db.run(`REVOKE EXECUTE ON FUNCTION ${signature} FROM anon;ALTER FUNCTION ${signature} SET search_path TO public;`);assert.throws(()=>db.run(patch),/metadata drift/);checks++;
 db.run(`ALTER FUNCTION ${signature} SET search_path TO '';`);
 const definition=db.run(`SELECT pg_get_functiondef('${signature}'::regprocedure)`).replaceAll('\r\n','\n');
 db.run(definition.replace('DECLARE\n','DECLARE\n  -- synthetic source drift\n'));const drift=verify();
 assert.throws(()=>db.run(patch),/source drift/);assert.equal(verify(),drift);checks++;
 console.log(JSON.stringify({checks,scope:'actual original native writer and original authority helpers; contact-method dependencies deliberately unexercised; no UI, delegation, timezone, migration or production proof'}));
}finally{
 const r=spawnSync(db.psql,db.args('postgres'),{input:`DROP DATABASE ${db.database} WITH (FORCE);`,encoding:'utf8',timeout:60000});
 if(r.status!==0)throw new Error('Owned disposable database cleanup failed');
}
