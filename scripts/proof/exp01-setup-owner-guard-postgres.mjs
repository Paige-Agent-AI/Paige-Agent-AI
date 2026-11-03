// Real PostgreSQL transactions and original writer; dependency tables/identity/CAS
// are MODELED here. Actual schema/authority coverage is a separate rollback proof.
import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
import {candidate,originalSetupWriter,guardedWriter,bodyHash} from './build-exp01-setup-owner-guard.mjs';

const port=Number(process.argv[2]??55461);
assert.ok(port===55461||(port===54322&&process.env.CI),'only the dedicated local proof or existing CI loopback stack');
if(process.argv.includes('--self-test')){
 const baseline=spawnSync(process.execPath,[process.argv[1],String(port),'--without-owner-guard'],{encoding:'utf8',timeout:60000});
 if(baseline.error)throw baseline.error;
 assert.equal(baseline.status,1,'unguarded original writer must fail the actual protection assertion');
 assert.match(baseline.stderr,/seated refuses omit/,'infrastructure errors are not the causal negative control');
 console.log('EXPECTED BASELINE FAILURE: seated refuses omit; original writer has no new guard');
 const guarded=spawnSync(process.execPath,[process.argv[1],String(port)],{stdio:'inherit',timeout:60000});
 if(guarded.error)throw guarded.error;
 assert.equal(guarded.status,0,'guarded original writer passes');
 process.exit(0);
}
const probe=spawnSync(process.env.OPERATOR_PROOF_PSQL??'psql',['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-Atc',
 "SELECT json_build_object('database',current_database(),'user',current_user,'address',host(inet_server_addr()),'directory',current_setting('data_directory'))"],{encoding:'utf8',timeout:10000});
if(probe.error)throw probe.error;
assert.equal(probe.status,0,'local-only PostgreSQL probe: '+probe.stderr);
const identity=JSON.parse(probe.stdout);
assert.equal(identity.database,'postgres');assert.equal(identity.user,'postgres');
if(port===54322){
 // The client still connects ONLY to hard-coded loopback54322. Docker reports
 // its container address, not the host's loopback address. Match the exact
 // existing CI stack directory independently read by the parent runner.
 assert.ok(process.env.CI&&process.env.OPERATOR_PROOF_EXPECTED_DATA_DIRECTORY);
 assert.equal(identity.directory,process.env.OPERATOR_PROOF_EXPECTED_DATA_DIRECTORY);
}else assert.equal(identity.address,'127.0.0.1');
const db=new OperatorPostgresFixture(port);
const tenant='e0110200-0000-4000-8000-000000000001',actor='e0110100-0000-4000-8000-000000000001';
const owner='e0110600-0000-4000-8000-000000000001',replacement='e0110100-0000-4000-8000-000000000002';
const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const caller=`SELECT set_config('test.actor','${actor}',false); SET ROLE authenticated;`;
const scalar=sql=>db.run(sql).split('\n').at(-1);
let checks=0,waits=0;
async function raceHeld(first,second,name,expire=false){
 const held=await db.holdArchive(first,[],{manualRelease:true});
 const p=spawn(db.psql,db.args(),{stdio:['pipe','pipe','pipe'],windowsHide:true});let out='',error='';
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>error+=b);
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',resolve);});
 p.stdin.end(`SET application_name='${name}';${second};`);
 try{
  const end=Date.now()+5000;let blocked=false;
  while(Date.now()<end){
   blocked=scalar(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND cardinality(pg_blocking_pids(pid))>0`)==='1';
   if(blocked)break;await new Promise(r=>setTimeout(r,25));
  }
  assert.ok(blocked,name+' observes a real blocking connection');waits++;
  if(expire)await new Promise(r=>setTimeout(r,1100));
 }finally{held.release();await held.completed;}
 return {status:await done,out,error};
}
try{
 db.run(`CREATE SCHEMA auth; CREATE SCHEMA vault;
 DO $$BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END$$;
 DO $$BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END$$;
 DO $$BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END$$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 CREATE TABLE tenant_members(tenant_id uuid,user_id uuid,status text,role text,is_owner boolean,business_owner_id uuid);
 CREATE TABLE tenant_business_owners(id uuid PRIMARY KEY,tenant_id uuid,owner_kind text,legal_name text,display_name text,
 ownership_interest numeric,effective_date date,ownership_status text,representative_user_id uuid,setup_provenance jsonb,
 owner_seat_vacant_since timestamptz,created_by uuid,updated_by uuid,created_at timestamptz,updated_at timestamptz);
 CREATE TABLE tenant_invite_tokens(tenant_id uuid,business_owner_id uuid REFERENCES tenant_business_owners(id) ON DELETE SET NULL,
 default_role text,kind text,revoked_at timestamptz,business_owner_removed_at timestamptz,uses integer,max_uses integer,expires_at timestamptz);
 CREATE TABLE tenant_setup_private_context(tenant_id uuid PRIMARY KEY,private_brief jsonb,setup_provenance jsonb,created_by uuid,updated_by uuid,updated_at timestamptz);
 CREATE TABLE tenant_legal_profile(tenant_id uuid,business_regions_of_operation text[],updated_at timestamptz);
 CREATE TABLE tenants(id uuid PRIMARY KEY,name text);
 CREATE TABLE proof_context(tenant_id uuid PRIMARY KEY,revision integer,brief jsonb);
 CREATE TABLE paige_audit_log(actor_user_id uuid,actor_role text,action text,target_type text,target_id uuid,tenant_id uuid,payload jsonb);
 INSERT INTO tenants VALUES('${tenant}','Example');
 INSERT INTO proof_context VALUES('${tenant}',0,'{"publicName":"Example","updatedAt":"0"}');
 INSERT INTO tenant_members VALUES('${tenant}','${actor}','active','owner',true,NULL),('${tenant}','${replacement}','active','member',false,NULL);
 CREATE FUNCTION current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT '${tenant}'::uuid$$;
 CREATE FUNCTION solo_setup_can_read() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT auth.uid()='${actor}'::uuid$$;
 CREATE FUNCTION solo_setup_access_scope() RETURNS text LANGUAGE sql STABLE AS $$SELECT CASE WHEN auth.uid()='${actor}'::uuid THEN 'owner_full' ELSE 'none' END$$;
 CREATE FUNCTION get_solo_setup_context() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$SELECT jsonb_build_object('brief',brief,'businessOwners',
  (SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]') FROM tenant_business_owners o)) FROM proof_context WHERE tenant_id='${tenant}'$$;
 CREATE FUNCTION save_solo_setup_identity(jsonb,text,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
  IF $2 IS DISTINCT FROM (SELECT revision::text FROM proof_context WHERE tenant_id='${tenant}') THEN RAISE EXCEPTION 'stale modeled CAS' USING ERRCODE='40001'; END IF;
  UPDATE proof_context SET revision=revision+1,brief=$1||jsonb_build_object('updatedAt',(revision+1)::text) WHERE tenant_id='${tenant}';
  RETURN get_solo_setup_context(); END$$;
 ${originalSetupWriter()}
 REVOKE ALL ON FUNCTION save_solo_setup_context(jsonb,jsonb,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION save_solo_setup_context(jsonb,jsonb,text,uuid) TO authenticated;
 GRANT USAGE ON SCHEMA auth TO authenticated;
 REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;`);
 assert.equal(scalar("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.save_solo_setup_context(jsonb,jsonb,text,uuid)'::regprocedure"),'d70cdc664b5c703395e4f077a30fdbd8');checks++;
 if(!process.argv.includes('--without-owner-guard')){
  const old=scalar("SELECT oid::text||'/'||proacl::text FROM pg_proc WHERE oid='public.save_solo_setup_context(jsonb,jsonb,text,uuid)'::regprocedure");
  db.run(candidate);db.run(candidate);
  assert.equal(scalar("SELECT oid::text||'/'||proacl::text FROM pg_proc WHERE oid='public.save_solo_setup_context(jsonb,jsonb,text,uuid)'::regprocedure"),old);checks++;
  assert.equal(scalar("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.save_solo_setup_context(jsonb,jsonb,text,uuid)'::regprocedure"),bodyHash(guardedWriter));checks++;
 }
 const reset=()=>db.run(`DELETE FROM tenant_invite_tokens;UPDATE tenant_members SET business_owner_id=NULL;
 DELETE FROM tenant_business_owners; INSERT INTO tenant_business_owners(id,tenant_id,owner_kind,legal_name,ownership_status,setup_provenance)
 VALUES('${owner}','${tenant}','company','Example Legal Owner','active','{}');`);
 const base={id:owner,ownerKind:'company',legalName:'Example Legal Owner',status:'active'};
 const save=owners=>{const context=JSON.parse(scalar(caller+'SELECT public.get_solo_setup_context()'));
  return caller+`SELECT public.save_solo_setup_context(${literal(context.brief)},${literal(owners)},'${context.brief.updatedAt}',NULL)`;};
 const count=()=>scalar(`SELECT count(*) FROM tenant_business_owners WHERE id='${owner}'`);
 const mint=`INSERT INTO tenant_invite_tokens VALUES('${tenant}','${owner}','owner','team',NULL,NULL,0,1,clock_timestamp()+interval '1 day')`;
 for(const protection of ['seated','held','invited','legacy_link'])for(const operation of ['omit','delete','kind','representative']){
  reset();
  if(protection==='seated'||protection==='legacy_link')db.run(`UPDATE tenant_members SET business_owner_id='${owner}',is_owner=${protection==='seated'} WHERE user_id='${actor}'`);
  if(protection==='held')db.run('UPDATE tenant_business_owners SET owner_seat_vacant_since=clock_timestamp()');
  if(protection==='invited')db.run(mint);
  const requested=operation==='omit'?[]:[{...base,...(operation==='delete'?{deleteRequested:true}:operation==='kind'?{ownerKind:'trust'}:{representativeUserId:replacement})}];
  const before=scalar("SELECT md5(jsonb_build_object('owners',(SELECT jsonb_agg(to_jsonb(o)) FROM tenant_business_owners o),'context',(SELECT jsonb_agg(to_jsonb(c)) FROM proof_context c),'private',(SELECT jsonb_agg(to_jsonb(p)) FROM tenant_setup_private_context p))::text)");
  assert.throws(()=>db.run(save(requested)),e=>e.code==='42501'&&/holds an owner seat/.test(e.message),protection+' refuses '+operation);checks++;
  assert.equal(scalar("SELECT md5(jsonb_build_object('owners',(SELECT jsonb_agg(to_jsonb(o)) FROM tenant_business_owners o),'context',(SELECT jsonb_agg(to_jsonb(c)) FROM proof_context c),'private',(SELECT jsonb_agg(to_jsonb(p)) FROM tenant_setup_private_context p))::text)"),before,'denial rolls back preceding modeled identity and original private writes');checks++;
  db.run(save([{...base,displayName:'Permitted label'}]));
  assert.equal(scalar(`SELECT display_name FROM tenant_business_owners WHERE id='${owner}'`),'Permitted label');checks++;
 }
 for(const state of ['expired','revoked','used','exhausted','consumer','agency_team','removed']){
  reset();db.run(mint);
  const update={expired:"expires_at=clock_timestamp()-interval '1 second'",revoked:'revoked_at=clock_timestamp()',used:'uses=1',exhausted:'max_uses=0',consumer:"kind='consumer'",agency_team:"kind='agency_team'",removed:'business_owner_removed_at=clock_timestamp()'}[state];
  db.run('UPDATE tenant_invite_tokens SET '+update);db.run(save([]));assert.equal(count(),'0',state+' is not an active protected invitation');checks++;
 }
 reset();db.run(save([{...base,ownerKind:'trust',representativeUserId:replacement}]));
 assert.equal(scalar(`SELECT owner_kind FROM tenant_business_owners WHERE id='${owner}'`),'trust');checks++;
 reset();db.run(mint);const first=await raceHeld('UPDATE tenant_business_owners SET display_name=display_name',save([]),'e01_owner_live_after_wait');
 assert.notEqual(first.status,0);assert.match(first.error,/holds an owner seat/);assert.equal(count(),'1');checks+=3;
 reset();const issued=await raceHeld(mint,save([]),'e01_owner_invite_first');
 assert.notEqual(issued.status,0);assert.match(issued.error,/holds an owner seat/);assert.equal(count(),'1');checks+=3;
 reset();const removed=await raceHeld(save([]),mint,'e01_owner_save_first');
 assert.notEqual(removed.status,0);assert.match(removed.error,/foreign key/);assert.equal(count(),'0');checks+=3;
 reset();db.run(mint);db.run("UPDATE tenant_invite_tokens SET expires_at=clock_timestamp()+interval '900 milliseconds'");
 const expired=await raceHeld('UPDATE tenant_business_owners SET display_name=display_name',save([]),'e01_owner_expiry_after_wait',true);
 assert.equal(expired.status,0,expired.error);assert.equal(count(),'0');checks+=2;
 console.log(JSON.stringify({checks,waits,result:'PASS',scope:'original writer + guard; MODELED identity/CAS/seat/invitation schema, not full-schema/customer proof'}));
}finally{
 db.run(`DROP DATABASE ${db.database}`,[],'postgres');
 await db.close();
}
