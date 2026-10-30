// Native original-writer component proof. Dedicated disposable loopback database only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
const db=new OperatorPostgresFixture(Number(process.argv[2]));db.prefix=()=>'';
const read=p=>readFileSync(p,'utf8');
const actor='70000000-0000-4000-8000-000000000001',impostor='70000000-0000-4000-8000-000000000002';
const tenant='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const contact='20000000-0000-4000-8000-000000000001',foreign='20000000-0000-4000-8000-000000000002';
const signature='public.upsert_contact(jsonb,uuid,uuid,uuid,text)';
const patch=read('scripts/proof/exp03-contact-current-authority-patch.sql');let checks=0;
const caller=id=>`SELECT set_config('test.actor','${id}',false);SET ROLE authenticated;`;
const save=(json,id=contact,tenantArg='NULL',actorArg='NULL',channel='manual')=>`SELECT public.upsert_contact('${JSON.stringify(json).replaceAll("'","''")}'::jsonb,${id?`'${id}'`:'NULL'},${tenantArg},${actorArg},${channel===null?'NULL':`'${channel}'`});`;
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
 CREATE TABLE public.clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,first_name text,last_name text,entity_name text,entity_type text,title text,website text,linkedin_url text,street_address text,city text,state text,zip_code text,lifecycle_stage text,source text,tags text[],primary_offer text,current_notes text,status text,assigned_coach_user_id uuid,do_not_contact boolean,timezone text,timezone_verified boolean NOT NULL DEFAULT false,created_by uuid,created_by_channel_type text,updated_at timestamptz DEFAULT now());
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
 if(process.argv.includes('--recipient-timezone')){
  // Reset ONLY the original disposable function after the authority drift tests.
  db.run(read('scripts/proof/fixtures/exp03-contact-management-before.sql'));db.run(patch);
  // psql/native definitions use LF; compare the tracked SQL source without Windows CRLF transport.
  const timezonePatch=read('scripts/proof/exp03-contact-recipient-timezone-patch.sql').replaceAll('\r\n','\n');
  if(process.env.EXP03_ZONE_BASELINE!=='1')db.run(timezonePatch);
  const zone=()=>JSON.parse(db.run(`SELECT json_build_object('timezone',timezone,'verified',timezone_verified) FROM clients WHERE id='${contact}'`));
  const expected=()=>({expected_timezone:zone().timezone,expected_timezone_verified:zone().verified});
  const write=(fields)=>caller(actor)+save({...expected(),...fields});
  db.run(write({timezone:'America/New_York',timezone_verified:true}));
  assert.deepEqual(zone(),{timezone:'America/New_York',verified:true});checks++;
  const confirmation=JSON.parse(db.run(`SELECT data->'recipient_timezone' FROM audit_logs ORDER BY id DESC LIMIT 1`));
  assert.equal(confirmation.timezone,'America/New_York');assert.equal(confirmation.verified,true);assert.equal(confirmation.actor_user_id,actor);assert.equal(confirmation.source,'authenticated_manual_confirmation');assert(Number.isFinite(Date.parse(confirmation.recorded_at)));checks++;
  const auditedFields=JSON.parse(db.run(`SELECT data->'fields' FROM audit_logs ORDER BY id DESC LIMIT 1`));
  assert(!auditedFields.includes('expected_timezone')&&!auditedFields.includes('expected_timezone_verified'));checks++;
  db.run(caller(actor)+save({current_notes:'Keep the confirmed time zone'}));
  assert.deepEqual(zone(),{timezone:'America/New_York',verified:true});assert.equal(db.run(`SELECT data ? 'recipient_timezone' FROM audit_logs ORDER BY id DESC LIMIT 1`),'f');checks++;
  db.run(write({timezone:'America/Chicago'}));assert.deepEqual(zone(),{timezone:'America/Chicago',verified:false});checks++;
  refuse(caller(actor)+save({timezone:'America/New_York',timezone_verified:true,expected_timezone:'America/New_York',expected_timezone_verified:true}),/CONTACT_TIMEZONE_STALE/);
  refuse(caller(actor)+save({timezone:'America/Chicago',timezone_verified:true,expected_timezone:'America/Chicago',expected_timezone_verified:true}),/CONTACT_TIMEZONE_STALE/);
  refuse(write({timezone_verified:true}),/CONTACT_TIMEZONE_MANUAL_CONFIRMATION_REQUIRED/);
  refuse(caller(actor)+save({timezone:'America/Chicago',timezone_verified:true}),/CONTACT_TIMEZONE_EXPECTED_REQUIRED/);
  refuse(caller(actor)+save({timezone:'America/Chicago',expected_timezone:'America/Chicago'}),/CONTACT_TIMEZONE_EXPECTED_REQUIRED/);
  refuse(caller(actor)+save({timezone:'America/Chicago',expected_timezone:'America/Chicago',expected_timezone_verified:'false'}),/CONTACT_BAD_TIMEZONE_EXPECTED/);
  refuse(caller(actor)+save({expected_timezone:'America/Chicago'}),/CONTACT_TIMEZONE_EXPECTED_WITHOUT_CHANGE/);
  for(const invalid of ['UTC','Etc/GMT+5','EST','Nope/Unknown',42,{}])refuse(write({timezone:invalid,timezone_verified:true}),/CONTACT_BAD_TIMEZONE/);
  for(const invalid of ['true',null,1,{}])refuse(write({timezone:'America/Chicago',timezone_verified:invalid}),/CONTACT_BAD_TIMEZONE_CONFIRMATION/);
  refuse(caller(actor)+save({...expected(),timezone:'America/Chicago',timezone_verified:true},contact,'NULL','NULL','api'),/CONTACT_TIMEZONE_MANUAL_CONFIRMATION_REQUIRED/);
  refuse(caller(actor)+save({...expected(),timezone:'America/Chicago',timezone_verified:true},contact,'NULL','NULL',null),/CONTACT_TIMEZONE_MANUAL_CONFIRMATION_REQUIRED/);
  refuse(service+save({...expected(),timezone:'America/Chicago',timezone_verified:true},contact,`'${tenant}'`,`'${actor}'`),/CONTACT_TIMEZONE_MANUAL_CONFIRMATION_REQUIRED/);
  db.run(service+save({...expected(),timezone:'America/Denver'},contact,`'${tenant}'`,`'${actor}'`,'api'));assert.deepEqual(zone(),{timezone:'America/Denver',verified:false});checks++;
  db.run(write({timezone:'America/Denver',timezone_verified:true}));assert.equal(zone().verified,true);checks++;
  db.run(write({timezone_verified:false}));assert.deepEqual(zone(),{timezone:'America/Denver',verified:false});checks++;
  db.run(write({timezone:'  America/Denver  ',timezone_verified:true}));assert.deepEqual(zone(),{timezone:'America/Denver',verified:true});checks++;
  db.run(write({timezone:null}));assert.deepEqual(zone(),{timezone:null,verified:false});checks++;
  refuse(write({timezone:null,timezone_verified:true}),/CONTACT_TIMEZONE_MANUAL_CONFIRMATION_REQUIRED/);
  db.run(caller(actor)+save({first_name:'Zone contact',timezone:'Europe/London',timezone_verified:true},null));
  assert.equal(db.run(`SELECT timezone||':'||timezone_verified FROM clients WHERE first_name='Zone contact'`),'Europe/London:true');checks++;
  db.run(caller(actor)+save({first_name:'Unconfirmed zone',timezone:'Europe/London'},null));
  assert.equal(db.run(`SELECT timezone||':'||timezone_verified FROM clients WHERE first_name='Unconfirmed zone'`),'Europe/London:false');checks++;
  refuse(caller(actor)+save({timezone:'Europe/London',expected_timezone:null,expected_timezone_verified:false},null),/CONTACT_TIMEZONE_EXPECTED_ON_CREATE/);
  db.run(`UPDATE tenant_members SET role='member' WHERE user_id='${actor}';`);
  refuse(write({timezone:'America/New_York',timezone_verified:true}),/CONTACT_FORBIDDEN/);
  db.run(`UPDATE tenant_members SET role='admin' WHERE user_id='${actor}';`);
  refuse(caller(actor)+save({timezone:'America/New_York',timezone_verified:true,expected_timezone:null,expected_timezone_verified:false},foreign),/CONTACT_NOT_FOUND_OR_FORBIDDEN/);
  const reviewedZoneDefinition=db.run(`SELECT pg_get_functiondef('${signature}'::regprocedure)`).replaceAll('\r\n','\n');
  assert.equal(createHash('md5').update(reviewedZoneDefinition+'\n').digest('hex'),'119df7983978f861e538be500064a946','exact native definition export');
  const changes=[...timezonePatch.matchAll(/revised := replace\(revised, \$old(\d+)\$([\s\S]*?)\$old\1\$, \$new\1\$([\s\S]*?)\$new\1\$\);/g)];
  assert.equal(changes.length,9);let inverse=reviewedZoneDefinition;
  for(const [,index,before,after] of changes.reverse()){assert.equal(inverse.split(after).length-1,1,`source inverse span ${index}`);inverse=inverse.replace(after,()=>before);}
  assert.equal(createHash('md5').update(inverse+'\n').digest('hex'),'bb9b4de901b59d776ec3c82fa649770f','complete non-owned original source inverse');checks++;
  // Observe an actual second native writer waiting on the original contact row lock.
  for(const removeLock of [false,true]){
   if(removeLock){assert(reviewedZoneDefinition.includes('FOR UPDATE;'));db.run(reviewedZoneDefinition.replace('FOR UPDATE;',';'));}
   db.run(`UPDATE clients SET timezone=NULL,timezone_verified=false WHERE id='${contact}';`);
   const loaded={expected_timezone:null,expected_timezone_verified:false};
   const held=await db.holdArchive(caller(actor)+save({...loaded,timezone:'America/New_York',timezone_verified:true}),[],{manualRelease:true});
   let child,pending;
   try{
    const app=`exp03_zone_wait_${process.pid}`;
    child=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let errors='';
    child.stdout.resume();child.stderr.on('data',d=>{errors+=d;});
    pending=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,errors}));});pending.catch(()=>{});
    child.stdin.end(`SET application_name='${app}';SET lock_timeout='6s';SET statement_timeout='10s';${caller(actor)}${save({...loaded,timezone:'America/Los_Angeles',timezone_verified:true})}`);
    let waiting=false;const deadline=Date.now()+5000;
    while(Date.now()<deadline){
     waiting=db.run(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='${app}' AND wait_event_type='Lock')`)==='t';
     if(waiting)break;await new Promise(resolve=>setTimeout(resolve,40));
    }
    assert(waiting,'second original native writer must be observed waiting');held.release();await held.completed;
    const result=await pending;
    if(removeLock){assert.equal(result.code,0,'without row lock the stale-write defect must reproduce');assert.deepEqual(zone(),{timezone:'America/Los_Angeles',verified:true});}
    else{assert.notEqual(result.code,0);assert.match(result.errors,/CONTACT_TIMEZONE_STALE/);assert.deepEqual(zone(),{timezone:'America/New_York',verified:true});}
    checks++;
   }finally{
    held.release(false);await held.completed.catch(()=>{});
    if(child&&child.exitCode===null)child.kill();if(pending)await pending.catch(()=>{});
   }
   db.run(reviewedZoneDefinition);
  }
  const flagCheck="OR _existing_timezone_verified IS DISTINCT FROM (p_patch->>'expected_timezone_verified')::boolean";
  assert(reviewedZoneDefinition.includes(flagCheck));db.run(reviewedZoneDefinition.replace(flagCheck,'OR false'));
  db.run(caller(actor)+save({timezone:'America/Los_Angeles',timezone_verified:true,expected_timezone:'America/Los_Angeles',expected_timezone_verified:false}));checks++;
  db.run(reviewedZoneDefinition);
  const manualCheck="_caller IS NULL OR p_channel IS DISTINCT FROM 'manual'";
  assert(reviewedZoneDefinition.includes(manualCheck));db.run(reviewedZoneDefinition.replace(manualCheck,'false'));
  db.run(service+save({...expected(),timezone:'America/Chicago',timezone_verified:true},contact,`'${tenant}'`,`'${actor}'`));
  assert.deepEqual(zone(),{timezone:'America/Chicago',verified:true});checks++;db.run(reviewedZoneDefinition);
  assert.equal(verify(),'119df7983978f861e538be500064a946');checks++;
  const auditCount=db.run('SELECT count(*) FROM audit_logs');db.run(timezonePatch);assert.equal(db.run('SELECT count(*) FROM audit_logs'),auditCount);checks++;
  db.run(`GRANT EXECUTE ON FUNCTION ${signature} TO anon;`);assert.throws(()=>db.run(timezonePatch),/metadata drift/);checks++;
  db.run(`REVOKE EXECUTE ON FUNCTION ${signature} FROM anon;`);
  const zoneDefinition=db.run(`SELECT pg_get_functiondef('${signature}'::regprocedure)`).replaceAll('\r\n','\n');
  db.run(zoneDefinition.replace('DECLARE\n','DECLARE\n  -- unknown timezone writer drift\n'));const unknown=verify();
  assert.throws(()=>db.run(timezonePatch),/source drift/);assert.equal(verify(),unknown);checks++;
 }
 console.log(JSON.stringify({checks,scope:'actual original native writer and current authority helpers; optional timezone recovery is inert native-only; contact methods unexercised; no UI/both-chat/delegation/jurisdiction/migration/production proof'}));
}finally{
 const r=spawnSync(db.psql,db.args('postgres'),{input:`DROP DATABASE ${db.database} WITH (FORCE);`,encoding:'utf8',timeout:60000});
 if(r.status!==0)throw new Error('Owned disposable database cleanup failed');
}
