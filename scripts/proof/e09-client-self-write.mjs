// Real committed RPC/helper bodies in a disposable native cluster. Surrounding
// Auth/schema are stand-ins: this is not managed Supabase or authenticated QA.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';import {createHash} from 'node:crypto';
const root=process.cwd(),base=path.resolve(root,'../..');
const out=path.resolve(root,process.env.E09_WRITE_PROOF_DIR??'../../work/e09-client-self-write-proof');
assert(out.startsWith(base+path.sep));fs.mkdirSync(out,{recursive:true});
const bin=process.env.E09_PG_BIN??(process.platform==='win32'?'C:/Program Files/PostgreSQL/16/bin':'');
const port=Number(process.env.E09_WRITE_PG_PORT??55447);assert(port>=1024&&port<=65535&&![5432,54322].includes(port));
const exe=n=>bin?path.join(bin,n+(process.platform==='win32'?'.exe':'')):n;
const cluster=fs.mkdtempSync(path.join(out,'cluster-')),transcripts=[],results=[];
function run(name,args,input){const op=path.join(out,`${transcripts.length}-${name}.stdout`),ep=path.join(out,`${transcripts.length}-${name}.stderr`),ofd=fs.openSync(op,'w'),efd=fs.openSync(ep,'w');let r;try{r=spawnSync(exe(name),args,{input,encoding:'utf8',windowsHide:true,timeout:60000,stdio:['pipe',ofd,efd]})}finally{fs.closeSync(ofd);fs.closeSync(efd)}r.stdout=fs.readFileSync(op,'utf8');r.stderr=fs.readFileSync(ep,'utf8');transcripts.push({name,args,exit:r.status,stdout:r.stdout,stderr:r.stderr});if(r.error)throw r.error;if(r.status!==0)throw new Error(r.stderr||r.stdout);return r.stdout.trim()}
const args=['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const sql=s=>run('psql',args,s),lit=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const ids={a:'e0912000-0000-0000-0000-000000000001',b:'e0912000-0000-0000-0000-000000000002',ta:'e0922000-0000-0000-0000-000000000001',tb:'e0922000-0000-0000-0000-000000000002',ca:'e0932000-0000-0000-0000-000000000001',cb:'e0932000-0000-0000-0000-000000000002'};
const snapshot=()=>sql("SELECT jsonb_build_object('clients',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM clients c),'methods',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM client_contact_methods m),'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_logs a));");
const version=()=>sql(`SELECT updated_at::text FROM clients WHERE id='${ids.ca}'`);
function callText(patch,v,actor=ids.a,tenant=ids.ta,role='authenticated'){return `BEGIN;SELECT set_config('test.actor',${lit(actor)},true);SET LOCAL ROLE ${role};SELECT public.client_portal_update_self_profile(${lit(v)}::timestamptz,${lit(JSON.stringify(patch))}::jsonb,${lit(tenant)}::uuid);COMMIT;`}
const call=(patch,v=version(),actor=ids.a,tenant=ids.ta,role='authenticated')=>{const r=sql(callText(patch,v,actor,tenant,role));return JSON.parse(r.split('\n').find(l=>l.startsWith('{')))};
const check=(name,f)=>{try{f();results.push({name,result:'PASS'})}catch(e){results.push({name,result:'FAIL',error:String(e.message)})}};
function deny(name,patch,code='22023',actor=ids.a,tenant=ids.ta,role='authenticated',v=version()){check(name,()=>{const before=snapshot();assert.throws(()=>call(patch,v,actor,tenant,role),e=>e.message.includes(code));assert.equal(snapshot(),before)})}
function load(name,file){const text=fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8');const def=text.match(new RegExp('CREATE(?: OR REPLACE)? FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$\\$;','i'));assert(def,'Actual helper not found: '+name);sql(def[0]);sql(`REVOKE ALL ON FUNCTION public.${name} FROM PUBLIC,anon,authenticated;`)}
const migPath='supabase/migrations/20271102130000_e09_client_self_profile_write.sql';
const baseline=process.argv.includes('--baseline');
const intakeBaseline=process.argv.includes('--intake-baseline');
assert(!(baseline&&intakeBaseline),'Choose one baseline');
const welcomeBaseline=process.argv.includes('--welcome-baseline');
const welcome=welcomeBaseline||process.argv.includes('--welcome');
assert(!welcome||(!baseline&&!intakeBaseline),'Welcome control retains its existing profile/intake prerequisites');
const intakePath='supabase/migrations/20271106130000_e09_client_intake_table_authority.sql';
const welcomePath='supabase/migrations/20271106140000_e09_client_welcome_atomic.sql';
const reportStem=welcome?(welcomeBaseline?'welcome-baseline':'welcome-candidate'):baseline?'baseline':intakeBaseline?'intake-baseline':'candidate';
let started=false,migration='',intakeMigration='';
try{run('initdb',['-D',cluster,'-U','postgres','-A','trust','--no-locale','-E','UTF8']);run('pg_ctl',['-D',cluster,'-l',path.join(cluster,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
sql(`CREATE ROLE authenticated NOLOGIN;CREATE ROLE anon NOLOGIN;CREATE ROLE service_role NOLOGIN;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
CREATE TABLE tenants(id uuid PRIMARY KEY,status text DEFAULT 'active');
CREATE TABLE clients(id uuid PRIMARY KEY,tenant_id uuid,linked_user_id uuid UNIQUE,status text DEFAULT 'active',merged_into_contact_id uuid,first_name text,last_name text,entity_name text,street_address text,city text,state text,zip_code text,onboarding_stage text,source text,paige_shared_context_consent boolean DEFAULT false,paige_shared_context_consent_updated_at timestamptz,updated_at timestamptz DEFAULT now(),current_notes text,lead_score int);
CREATE TABLE client_contact_methods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,client_id uuid,kind text,value text,label text,is_primary boolean,position integer,match_key text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,entity text,action text,entity_id uuid,data jsonb);
CREATE TABLE paige_client_intake_submissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid,section text,payload jsonb NOT NULL DEFAULT '{}');
ALTER TABLE paige_client_intake_submissions ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER,TRUNCATE ON paige_client_intake_submissions TO anon,authenticated,service_role;
-- Explicitly seeded PUBLIC control in this disposable fixture, not a claim
-- that every grant source matches the managed project's catalog.
GRANT TRUNCATE ON paige_client_intake_submissions TO PUBLIC;
INSERT INTO paige_client_intake_submissions(client_id,section,payload) VALUES('${ids.ca}','playbook_intake','{"goal":"Synthetic saved answer"}');
INSERT INTO tenants(id)VALUES('${ids.ta}'),('${ids.tb}');INSERT INTO clients(id,tenant_id,linked_user_id,first_name,last_name,current_notes,lead_score,onboarding_stage)VALUES('${ids.ca}','${ids.ta}','${ids.a}','Original','Customer','PRIVATE NOTE',77,'invited'),('${ids.cb}','${ids.tb}','${ids.b}','Foreign','Customer','FOREIGN NOTE',88,'invited');
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;ALTER TABLE client_contact_methods ENABLE ROW LEVEL SECURITY;REVOKE ALL ON clients,client_contact_methods,audit_logs FROM PUBLIC,anon,authenticated;`);
for(const name of ['contact_method_match_key','contact_methods_canonical','_client_contact_methods_json','_replace_client_contact_methods'])load(name,'20270515000000_contact_methods.sql');
for(const name of ['contact_methods_fingerprint','_client_contact_methods_payload','_replace_client_contact_methods_checked','client_contact_methods_touch_client'])load(name,'20270519000000_contact_methods_concurrency.sql');
load('contact_methods_with_primary','20270519010000_contact_methods_dependents.sql');
sql(`ALTER TABLE client_contact_methods DROP COLUMN match_key;ALTER TABLE client_contact_methods ADD COLUMN match_key text GENERATED ALWAYS AS(public.contact_method_match_key(kind,value)) STORED;CREATE UNIQUE INDEX test_method_unique ON client_contact_methods(client_id,kind,match_key);CREATE UNIQUE INDEX test_email_unique ON client_contact_methods(tenant_id,kind,match_key) WHERE kind='email';CREATE TRIGGER client_contact_methods_touch_client AFTER INSERT OR UPDATE OR DELETE ON client_contact_methods FOR EACH ROW EXECUTE FUNCTION public.client_contact_methods_touch_client();
INSERT INTO client_contact_methods(tenant_id,client_id,kind,value,label,is_primary,position)VALUES('${ids.ta}','${ids.ca}','email','primary@tests.invalid','Private email label',true,0),('${ids.ta}','${ids.ca}','phone','+12025550109','Primary',true,0),('${ids.ta}','${ids.ca}','phone','+12025550110','Secondary',false,1);`);
sql(fs.readFileSync(path.join(root,'supabase/migrations/20271102120000_e09_client_self_projection.sql'),'utf8'));
if(!baseline){migration=fs.readFileSync(path.join(root,migPath),'utf8');sql(migration);const once=sql("SELECT pg_get_functiondef('client_portal_update_self_profile(timestamptz,jsonb,uuid)'::regprocedure)");sql(migration);check('Migration reapplication preserves definition',()=>assert.equal(sql("SELECT pg_get_functiondef('client_portal_update_self_profile(timestamptz,jsonb,uuid)'::regprocedure)"),once))}
if(!baseline){
  const ordinary=()=>sql("SELECT jsonb_agg(jsonb_build_object('role',r.name,'grants',ARRAY(SELECT p.name FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','REFERENCES','TRIGGER']) p(name) WHERE has_table_privilege(r.name,'public.paige_client_intake_submissions',p.name)))) FROM (VALUES('anon'),('authenticated'),('service_role')) r(name)");
  const intakeRows=()=>sql('SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM paige_client_intake_submissions i');
  const security=()=>sql("SELECT jsonb_build_object('rls',relrowsecurity,'force_rls',relforcerowsecurity,'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='paige_client_intake_submissions')) FROM pg_class WHERE oid='public.paige_client_intake_submissions'::regclass");
  const before={ordinary:ordinary(),rows:intakeRows(),security:security()};
  if(!intakeBaseline){
    intakeMigration=fs.readFileSync(path.join(root,intakePath),'utf8');sql(intakeMigration);
    const once=sql("SELECT relacl::text FROM pg_class WHERE oid='public.paige_client_intake_submissions'::regclass");
    sql(intakeMigration);
    check('Intake privilege migration reapplication is idempotent',()=>assert.equal(sql("SELECT relacl::text FROM pg_class WHERE oid='public.paige_client_intake_submissions'::regclass"),once));
  }
  for(const role of ['anon','authenticated'])check('Effective '+role+' destructive intake-table privilege is denied',()=>assert.equal(sql(`SELECT has_table_privilege('${role}','public.paige_client_intake_submissions','TRUNCATE')`),'f'));
  check('Seeded PUBLIC destructive grant is removed',()=>assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid='public.paige_client_intake_submissions'::regclass AND a.grantee=0 AND a.privilege_type='TRUNCATE')"),'f'));
  check('Ordinary intake privileges remain byte-identical',()=>assert.equal(ordinary(),before.ordinary));
  check('Trusted service intake privilege remains unchanged',()=>assert.equal(sql("SELECT has_table_privilege('service_role','public.paige_client_intake_submissions','TRUNCATE')"),'t'));
  check('Existing intake RLS and policy metadata remain unchanged',()=>assert.equal(security(),before.security));
  check('Saved synthetic intake records remain byte-identical',()=>assert.equal(intakeRows(),before.rows));
}
check('Actual customer saves name and canonical primary phone without raw SELECT',()=>{const p=call({first_name:'Updated',phone:'+12025550111'});assert.equal(p.first_name,'Updated');assert.equal(p.phone,'+12025550111');assert.equal(p.email,'primary@tests.invalid');assert(p.contact_methods.some(m=>m.value==='+12025550110'));assert(!JSON.stringify(p).includes('PRIVATE'));assert.equal(p.linked_user_id,ids.a)});
check('Reload reads persisted fields and preserves private CRM/authority',()=>{assert.equal(sql(`SELECT first_name||'|'||current_notes||'|'||lead_score||'|'||onboarding_stage FROM clients WHERE id='${ids.ca}'`),'Updated|PRIVATE NOTE|77|invited');assert.equal(sql(`SELECT first_name FROM clients WHERE id='${ids.cb}'`),'Foreign')});
check('Audit uses real actor, tenant and client without profile values',()=>{const a=JSON.parse(sql('SELECT data::text FROM audit_logs ORDER BY id LIMIT 1'));assert.equal(a.actor_user_id,ids.a);assert.equal(a.client_id,ids.ca);assert.equal(a.tenant_id,ids.ta);assert(!JSON.stringify(a).includes('Updated'));assert.equal(sql('SELECT user_id::text FROM audit_logs LIMIT 1'),ids.a)});
deny('Anonymous caller denied',{first_name:'No'},'42501',null,ids.ta,'anon');deny('Subjectless authenticated caller denied',{first_name:'No'},'42501',null);deny('Service role is not customer identity',{first_name:'No'},'42501',null,ids.ta,'service_role');
deny('Foreign tenant argument grants no authority',{first_name:'No'},'42501',ids.a,ids.tb);deny('Other client cannot target this business',{first_name:'No'},'42501',ids.b,ids.ta);deny('Unlinked caller denied',{first_name:'No'},'42501','e0912000-0000-0000-0000-000000000099');
deny('Private CRM field cannot be submitted',{current_notes:'Overwrite'});deny('Email/linkage cannot be changed',{email:'other@tests.invalid'});deny('Wrong JSON shape refused',['first_name']);deny('Empty patch refused',{});deny('Nonstring name refused',{first_name:42});deny('Blank name refused',{first_name:'   '});deny('Null primary phone refused',{phone:null});deny('Malformed phone refused',{phone:'x'});deny('Stale expected version blocks all mutations',{first_name:'Stale',phone:'+12025550112'},'40001',ids.a,ids.ta,'authenticated','2000-01-01T00:00:00Z');
for(const [name,setup,restore]of [['Archived contact',`UPDATE clients SET status='archived' WHERE id='${ids.ca}'`,`UPDATE clients SET status='active' WHERE id='${ids.ca}'`],['Merged contact',`UPDATE clients SET merged_into_contact_id='${ids.cb}' WHERE id='${ids.ca}'`,`UPDATE clients SET merged_into_contact_id=NULL WHERE id='${ids.ca}'`],['Revoked linkage',`UPDATE clients SET linked_user_id=NULL WHERE id='${ids.ca}'`,`UPDATE clients SET linked_user_id='${ids.a}' WHERE id='${ids.ca}'`],['Inactive business',`UPDATE tenants SET status='suspended' WHERE id='${ids.ta}'`,`UPDATE tenants SET status='active' WHERE id='${ids.ta}'`]]){sql(setup);deny(name+' cannot write',{first_name:'No'},'42501');sql(restore)}
sql("CREATE FUNCTION test_fail_audit()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'TEST_AUDIT_FAILURE';END;$$;CREATE TRIGGER test_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_fail_audit();");deny('Late audit failure rolls back profile AND canonical phone',{first_name:'Rolled back',phone:'+12025550112'},'TEST_AUDIT_FAILURE');sql('DROP TRIGGER test_fail_audit ON audit_logs');
check('Postal null clears only the provided postal fields',()=>{call({street_address:'1 Test Road',city:'Test City'});const p=call({street_address:null});assert.equal(p.street_address,null);assert.equal(p.city,'Test City')});
check('Promoting existing phone preserves prior phone as secondary',()=>{const p=call({phone:'+12025550110'});assert.equal(p.phone,'+12025550110');assert(p.contact_methods.some(m=>m.value==='+12025550111'&&!m.is_primary))});
check('Internal contact-method helpers remain unavailable to customer',()=>assert.equal(sql("SELECT has_function_privilege('authenticated','_replace_client_contact_methods_checked(uuid,uuid,jsonb,jsonb)','EXECUTE')"),'f'));
if(!baseline){const v=version();const asyncCall=input=>new Promise(resolve=>{const child=spawn(exe('psql'),args,{windowsHide:true});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('close',exit=>{transcripts.push({name:'concurrent-psql',exit,stdout,stderr});resolve({exit,stderr})});child.stdin.end(input)});const pair=await Promise.all([asyncCall(callText({first_name:'Concurrent A'},v)),asyncCall(callText({first_name:'Concurrent B'},v))]);check('Concurrent same-version writes accept exactly one',()=>{assert.equal(pair.filter(r=>r.exit===0).length,1);assert(pair.find(r=>r.exit!==0).stderr.includes('40001'))})}
if(welcome){const {runWelcomeCases}=await import('./e09-client-welcome-cases.mjs');await runWelcomeCases({sql,check,ids,lit,root,exe,args,baseline:welcomeBaseline})}
const failed=results.filter(r=>r.result==='FAIL');fs.writeFileSync(path.join(out,reportStem+'.json'),JSON.stringify({mode:reportStem,evidence:'synthetic-native-postgresql',managedSupabase:'UNVERIFIED',authenticatedQA:'NOT_RUN',migrationSHA256:migration?createHash('sha256').update(migration).digest('hex'):null,intakeMigrationSHA256:intakeMigration?createHash('sha256').update(intakeMigration).digest('hex'):null,welcomeMigrationSHA256:welcome&&!welcomeBaseline?createHash('sha256').update(fs.readFileSync(path.join(root,welcomePath))).digest('hex'):null,results},null,2));console.log(JSON.stringify({pass:results.length-failed.length,fail:failed.length,failures:failed,out}));if(failed.length)process.exitCode=1;
}finally{if(started)run('pg_ctl',['-D',cluster,'-w','stop','-m','fast']);fs.writeFileSync(path.join(out,reportStem+'-transcript.json'),JSON.stringify(transcripts,null,2))}
