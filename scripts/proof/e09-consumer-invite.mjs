// Project-owned executable proof of the actual acceptance migration, in a dedicated
// synthetic loopback PostgreSQL cluster. No remote URL, production key, send or account.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isProofDescendant } from './e09-proof-path.mjs';

const baselineOnly = process.argv.includes('--baseline');
const entry = process.argv.includes('--entry');
const entryBaseline = process.argv.includes('--entry-baseline');
const root = process.cwd();
const bin = process.env.E09_PG_BIN ?? (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/16/bin' : '');
const exe = name => bin ? path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
const port = Number(process.env.E09_PG_PORT ?? 55439);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== 5432, 'Dedicated loopback port required');
const work = path.resolve(root, process.env.E09_PROOF_DIR ?? '../../work/e09-invite-proof');
assert(isProofDescendant(path.resolve(root, '../..'), work), 'Proof directory must remain in this task workspace');
fs.mkdirSync(work, { recursive: true });
const cluster = fs.mkdtempSync(path.join(work, 'cluster-'));
const transcripts = [];
function run(name,args,input) {
 // PostgreSQL's detached Windows server can inherit pipe handles from pg_ctl.
 // Real files keep successful startup from looking like a timeout waiting on those handles.
 const out=path.join(work,`${transcripts.length}-${name}.stdout`), err=path.join(work,`${transcripts.length}-${name}.stderr`);
 const stdout=fs.openSync(out,'w'),stderr=fs.openSync(err,'w');let r;
 try { r=spawnSync(exe(name),args,{input,encoding:'utf8',windowsHide:true,timeout:60000,stdio:['pipe',stdout,stderr]}); }
 finally {fs.closeSync(stdout);fs.closeSync(stderr);}
 r.stdout=fs.readFileSync(out,'utf8');r.stderr=fs.readFileSync(err,'utf8');
 transcripts.push({command:name,args,exitCode:r.status,stdout:r.stdout??'',stderr:r.stderr??''});
 if(r.error)throw r.error;
 if(r.status!==0)throw new Error(`${name} failed: ${r.stderr??r.stdout}`);
 return r.stdout.trim();
}
const args=['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-A','-t','-v','ON_ERROR_STOP=1'];
const sql=s=>run('psql',args,s);
function functionFrom(file,name) {
 const s=fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
 const start=s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
 assert(start>=0,`Source function missing: ${name}`);
 const end=s.indexOf('END $function$;',start);
 const alternative=s.indexOf('END;\n$function$;',start);
 const stop=end>=0?end+'END $function$;'.length:alternative+'END;\n$function$;'.length;
 assert(stop>start,`Function delimiter missing: ${name}`);
 return s.slice(start,stop);
}
const literal=s=>s===null?'NULL':`'${String(s).replaceAll("'","''")}'`;
let serial=0;
function fixture(options={}) {
 const n=++serial, suffix=String(n).padStart(12,'0');
 const actor=`e0900000-0000-0000-0000-${suffix}`, other=`e0910000-0000-0000-0000-${suffix}`;
 const tenant=`e0920000-0000-0000-0000-${suffix}`, foreign=`e0930000-0000-0000-0000-${suffix}`;
 const contact=`e0940000-0000-0000-0000-${suffix}`, invite=`e0950000-0000-0000-0000-${suffix}`;
 const email=`client-${n}@tests.invalid`, token=`synthetic-consumer-${n}`;
 sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${actor}',${literal(options.wrong?'wrong@tests.invalid':email)},${options.unconfirmed?'NULL':'now()'}),('${other}','other@tests.invalid',now());
 INSERT INTO tenants(id,owner_user_id) VALUES('${tenant}','${other}'),('${foreign}','${other}');
 INSERT INTO profiles VALUES('${actor}',NULL);
 INSERT INTO clients(id,tenant_id,linked_user_id,status,merged_into_contact_id) VALUES('${contact}','${options.foreign?foreign:tenant}',${options.occupied?literal(other):'NULL'},${literal(options.inactive?'archived':'active')},${options.merged?literal(other):'NULL'});
 INSERT INTO client_contact_methods(client_id,tenant_id,kind,value,match_key) VALUES('${contact}','${options.foreign?foreign:tenant}','email',${literal(email)},${literal(email)});
 INSERT INTO tenant_invite_tokens(id,tenant_id,token,kind,created_by,expires_at,contact_id,email,max_uses,uses,last_used_at,revoked_at) VALUES('${invite}','${tenant}',${literal(token)},${literal(options.team?'team':'consumer')},'${other}',now()+interval '${options.expired?'-1':'1'} day',${options.unbound?'NULL':literal(contact)},${options.noRecipient?'NULL':literal(email)},${options.limit===undefined?'NULL':options.limit},${options.used?1:0},${options.lastUsed?'now()':'NULL'},${options.revoked?'now()':'NULL'});
 ${options.staff?`INSERT INTO tenant_members VALUES('${tenant}','${actor}','member','active',false,now(),now());`:''}
 ${options.alreadyLinked?`INSERT INTO clients(tenant_id,linked_user_id) VALUES('${foreign}','${actor}');`:''}
 ${options.noAddress?`DELETE FROM client_contact_methods WHERE client_id='${contact}';`:''}
 ${options.missing?`DELETE FROM clients WHERE id='${contact}';`:''}`);
 return {actor,other,tenant,foreign,contact,invite,email,token};
}
function call(f,role='authenticated',token=f.token) {
 return sql(`BEGIN; SELECT set_config('test.actor',${role==='anon'?"''":literal(f.actor)},true); SET LOCAL ROLE ${role}; SELECT public.accept_tenant_invite(${literal(token)}); COMMIT;`);
}
const results=[];
function check(name,fn){try{fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:String(e.message)});}}
function denied(name,options={},role='authenticated',tokenOverride) {
 check(name,()=>{const f=fixture(options), before=sql('SELECT proof_snapshot();'); let refused=false;
 try { call(f,role,tokenOverride===undefined?f.token:tokenOverride); } catch { refused=true; }
 assert(refused,'Expected refusal'); assert.equal(sql('SELECT proof_snapshot();'),before,'Refusal must have zero durable effects'); });
}
let started=false;
try {
 run('initdb',['-D',cluster,'-U','postgres','-A','trust','--no-locale','-E','UTF8']);
 run('pg_ctl',['-D',cluster,'-l',path.join(cluster,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']); started=true;
 sql(fs.readFileSync(path.join(root,'scripts/proof/e09-consumer-invite-fixture.sql'),'utf8'));
 if(entry || entryBaseline) {
 const validator=fs.readFileSync(path.join(root,'supabase/migrations/20271107110000_e09_client_welcome_atomic.sql'),'utf8').replaceAll('\r\n','\n')
   .match(/CREATE OR REPLACE FUNCTION public\._client_portal_welcome_fields\(p_config jsonb\)[\s\S]*?\n\$\$;/)?.[0];
 assert(validator,'Actual Welcome validator required');sql(validator);
 const peek=fs.readFileSync(path.join(root,'supabase/migrations/20260713050000_invite_brand_cascade.sql'),'utf8').replaceAll('\r\n','\n')
   .match(/CREATE OR REPLACE FUNCTION public\.peek_tenant_invite\([\s\S]*?END \$\$;/)?.[0];
 assert(peek,'Actual public invitation reader required');
 // Brand transport is synthetic; the actual native peek body runs unchanged.
 sql(`ALTER TABLE tenants ADD status text DEFAULT 'active', ADD name text DEFAULT 'Test tenant', ADD slug text DEFAULT 'test-tenant';
   CREATE FUNCTION public.resolve_tenant_brand(uuid) RETURNS TABLE(logo_url text,logo_dark_url text,primary_color text,accent_color text)
     LANGUAGE sql AS $$ SELECT NULL::text,NULL::text,'#26483e'::text,NULL::text $$;
   CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
   CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT tenant_id FROM tenant_members WHERE user_id=auth.uid() AND status='active' LIMIT 1 $$;
   CREATE FUNCTION public.client_portal_relationship_id(p_tenant uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT c.id FROM clients c JOIN tenants t ON t.id=c.tenant_id WHERE c.linked_user_id=auth.uid() AND c.status='active' AND c.merged_into_contact_id IS NULL AND t.status='active' AND (p_tenant IS NULL OR c.tenant_id=p_tenant) $$;
   ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
   CREATE POLICY clients_legacy_self ON clients FOR ALL TO authenticated USING(linked_user_id=auth.uid() OR tenant_id=current_user_tenant_id()) WITH CHECK(linked_user_id=auth.uid() OR tenant_id=current_user_tenant_id());
   GRANT SELECT,UPDATE ON clients TO authenticated;
   CREATE TABLE paige_client_events(contact_id uuid,tenant_id uuid,audience text,visibility text);
   CREATE POLICY pce_client_read ON paige_client_events USING(true);
   CREATE TABLE client_files(contact_id uuid,tenant_id uuid,visibility text);
   CREATE POLICY "Clients read own shared/uploads" ON client_files USING(true);
   CREATE TABLE paige_context_loads(contact_id uuid,tenant_id uuid);
   CREATE POLICY csp_loads_subject_read ON paige_context_loads USING(true);
   CREATE TABLE paige_customer_actions(contact_id uuid,tenant_id uuid);
   CREATE POLICY pca_customer_subject_read ON paige_customer_actions USING(true);
   CREATE TABLE paige_customer_responses(contact_id uuid);
   CREATE POLICY pcr_customer_subject_read ON paige_customer_responses USING(true);
   CREATE TABLE paige_pending_approvals(contact_id uuid,tenant_id uuid);
   CREATE POLICY "Clients can read approvals on their own record" ON paige_pending_approvals USING(true);
   CREATE TABLE tenant_entity_relationships(contact_id uuid,tenant_id uuid);
   CREATE POLICY "ter self read" ON tenant_entity_relationships USING(true);`);
 sql(peek);sql('REVOKE ALL ON FUNCTION peek_tenant_invite(text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION peek_tenant_invite(text) TO anon,authenticated,service_role');
 }
 sql(functionFrom('supabase/migrations/20261200000300_solo_team_recipient_binding.sql','accept_tenant_invite'));
 const matching=fs.readFileSync(path.join(root,'supabase/migrations/20270515010000_contact_methods_matching.sql'),'utf8').replaceAll('\r\n','\n');
 const helper=matching.match(/CREATE (?:OR REPLACE )?FUNCTION pg_temp\.replace_fragment[\s\S]*?\$\$;/i)?.[0];
 assert(helper,'Canonical fragment helper missing');
 const begin=matching.indexOf("DO $$\nDECLARE\n  _def text := pg_get_functiondef('public.accept_tenant_invite(text)'::regprocedure);");
 const end=matching.indexOf('END $$;',begin)+'END $$;'.length;
 assert(begin>=0&&end>begin,'Canonical contact-method acceptance patch missing');
 sql(helper+'\n'+matching.slice(begin,end));
 sql(functionFrom('supabase/migrations/20260714144656_tier_rail_phaseB_agency_standing.sql','guard_active_tenant_membership'));
 sql('CREATE TRIGGER trg_guard_active_tenant BEFORE UPDATE OF active_tenant_id ON profiles FOR EACH ROW EXECUTE FUNCTION guard_active_tenant_membership(); REVOKE ALL ON FUNCTION accept_tenant_invite(text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION accept_tenant_invite(text) TO authenticated,service_role;');
 const before=sql("SELECT pg_get_functiondef('public.accept_tenant_invite(text)'::regprocedure);");
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20271102100000_e09_consumer_invite_integrity.sql'),'utf8');
 if(!baselineOnly){sql(migration); const once=sql("SELECT pg_get_functiondef('public.accept_tenant_invite(text)'::regprocedure);"); sql(migration);assert.equal(sql("SELECT pg_get_functiondef('public.accept_tenant_invite(text)'::regprocedure);"),once,'Migration replay must be idempotent');
 check('Other invitation branches preserved byte-for-byte',()=>{const tail=s=>s.slice(s.indexOf("  ELSIF _tok.kind = 'subaccount_owner' THEN"),s.indexOf('  UPDATE public.tenant_invite_tokens SET uses =')); assert.equal(tail(once),tail(before));}); }
 if(entry) {
   const entrySource=fs.readFileSync(path.join(root,'supabase/migrations/20271108120000_e09_customer_invitation_entry.sql'),'utf8');
   sql(entrySource); const applied=sql("SELECT pg_get_functiondef('public.accept_tenant_invite(text)'::regprocedure);");
   sql(entrySource); assert.equal(sql("SELECT pg_get_functiondef('public.accept_tenant_invite(text)'::regprocedure);"),applied);
   for(const [name,options,valid] of [
     ['unused consumer',{limit:null},true],['used unlimited consumer',{used:true},false],
     ['recorded consumer acceptance despite count drift',{lastUsed:true},false],
     ['revoked consumer',{revoked:true},false],['expired consumer',{expired:true},false],
     ['existing unlimited team semantics',{team:true,used:true},true],
   ])check('Public native peek: '+name,()=>{
     const f=fixture(options),before=sql('SELECT proof_snapshot()');
     const values=sql(`BEGIN;SET LOCAL ROLE anon;SELECT is_valid FROM public.peek_tenant_invite(${literal(f.token)});ROLLBACK;`)
       .split(/\r?\n/).filter(value=>value==='t'||value==='f');
     assert.deepEqual(values,[valid?'t':'f']);
     assert.equal(sql('SELECT proof_snapshot()'),before,'Public validity read must not consume or mutate an invitation');
   });
   check('No custom questions uses the existing contact form; malformed published configuration still refuses',()=>{
     assert.equal(sql('SELECT public._client_portal_welcome_fields(NULL);'),'[]');
     assert.equal(sql("SELECT coalesce(public._client_portal_welcome_fields('{}'::jsonb)::text,'REFUSED');"),'REFUSED');
   });
   check('Entry preserves all staff/agency/owner branches',()=>{const tail=s=>s.slice(s.indexOf("  ELSIF _tok.kind = 'subaccount_owner' THEN"));assert.equal(tail(applied),tail(before));});
 }
 denied('Wrong recipient with legitimate staff standing cannot claim consumer contact',{wrong:true,staff:true});
 denied('Matching unconfirmed email refuses',{unconfirmed:true,staff:true});
 denied('Missing recipient refuses',{noRecipient:true,staff:true});
 denied('Anonymous caller denied',{},'anon');
 denied('Expired invitation refuses',{expired:true});
 denied('Revoked invitation refuses',{revoked:true});
 denied('Legacy unlimited token with prior use refuses',{used:true,staff:true});
 denied('Recorded prior acceptance refuses even if count zero',{lastUsed:true,staff:true});
 denied('Missing exact CRM contact refuses',{missing:true,staff:true});
 denied('Foreign exact CRM contact refuses',{foreign:true,staff:true});
 denied('Occupied exact CRM contact refuses',{occupied:true,staff:true});
 denied('Merged contact refuses',{merged:true,staff:true});
 denied('Archived contact refuses',{inactive:true,staff:true});
 denied('Unbound consumer token refuses',{unbound:true,staff:true});
 denied('Recipient address removed from contact refuses',{noAddress:true,staff:true});
 denied('Different existing relationship does not redirect acceptance',{alreadyLinked:true,staff:true});
 denied('Malformed token refuses',{},'authenticated','not-a-real-invite');
 denied('Missing token refuses',{},'authenticated',null);
 denied('Team recipient regression',{team:true,wrong:true,staff:true});
 check('Verified recipient with pre-existing staff standing binds the exact contact once',()=>{const f=fixture({staff:true});call(f); assert.equal(sql(`SELECT linked_user_id FROM clients WHERE id='${f.contact}';`),f.actor);assert.equal(sql(`SELECT count(*) FROM tenant_members WHERE user_id='${f.actor}';`),'1');assert.equal(sql(`SELECT coalesce(active_tenant_id::text,'NONE') FROM profiles WHERE user_id='${f.actor}';`),entry?'NONE':f.tenant);assert.equal(sql(`SELECT uses||':'||(last_used_at IS NOT NULL)::text FROM tenant_invite_tokens WHERE id='${f.invite}';`),'1:true');assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE entity_id='${f.invite}' AND user_id='${f.actor}' AND data->>'client_id'='${f.contact}';`),'1');const snapshot=sql('SELECT proof_snapshot();');assert.throws(()=>call(f));assert.equal(sql('SELECT proof_snapshot();'),snapshot);});
 if (entry || entryBaseline) {
 check('Pure verified external recipient joins without a business seat or staff context',()=>{
   const f=fixture();call(f);
   assert.equal(sql(`SELECT linked_user_id FROM clients WHERE id='${f.contact}';`),f.actor);
   assert.equal(sql(`SELECT count(*) FROM tenant_members WHERE user_id='${f.actor}';`),'0');
   assert.equal(sql(`SELECT coalesce(active_tenant_id::text,'NONE') FROM profiles WHERE user_id='${f.actor}';`),'NONE');
   assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE entity_id='${f.invite}' AND user_id='${f.actor}';`),'1');
   const actorSql=s=>sql(`BEGIN;SELECT set_config('test.actor','${f.actor}',true);SET LOCAL ROLE authenticated;${s};COMMIT;`);
   assert(actorSql(`SELECT count(*) FROM clients WHERE id='${f.contact}'`).split(/\r?\n/).includes('0'),'Customer cannot read raw CRM');
   assert.equal(sql(`SELECT uses FROM tenant_invite_tokens WHERE id='${f.invite}';`),'1');
   const recovered=actorSql(`SELECT client_portal_invite_status('${f.token}')`).split('\n').find(s=>s.startsWith('{'));
   assert.equal(JSON.parse(recovered).client_id,f.contact);
   sql(`UPDATE clients SET linked_user_id=NULL WHERE id='${f.contact}';`);
   assert(!actorSql(`SELECT client_portal_invite_status('${f.token}')`).includes('accepted'),'Revoked relationship cannot recover');
 });
 } else denied('Pure external join stays blocked atomically before safe client read projections exist');
 check('Email normalization accepts only authoritative verified recipient',()=>{const f=fixture({staff:true});sql(`UPDATE auth.users SET email='  ${f.email.toUpperCase()}  ' WHERE id='${f.actor}';`);call(f);});
 check('Team acceptance still grants ordinary member and staff pointer',()=>{const f=fixture({team:true});call(f);assert.equal(sql(`SELECT role::text||':'||is_owner::text FROM tenant_members WHERE user_id='${f.actor}';`),'member:false');assert.equal(sql(`SELECT active_tenant_id FROM profiles WHERE user_id='${f.actor}';`),f.tenant);});
 check('Claimed JWT email cannot override stored auth identity',()=>{const f=fixture({wrong:true,staff:true});assert.throws(()=>sql(`BEGIN; SELECT set_config('test.actor','${f.actor}',true); SELECT set_config('request.jwt.claims',${literal(JSON.stringify({email:f.email,email_verified:true,sub:f.actor}))},true); SET LOCAL ROLE authenticated; SELECT accept_tenant_invite('${f.token}'); COMMIT;`));});
 if(!baselineOnly){
 check('Audit failure rolls back link, role and token consumption',()=>{const f=fixture({staff:true});sql(`CREATE FUNCTION public.proof_reject_acceptance_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$; CREATE TRIGGER proof_reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.proof_reject_acceptance_audit();`);const snapshot=sql('SELECT proof_snapshot();');assert.throws(()=>call(f));assert.equal(sql('SELECT proof_snapshot();'),snapshot);sql('DROP TRIGGER proof_reject_audit ON audit_logs; DROP FUNCTION public.proof_reject_acceptance_audit();');});
 const f=fixture({staff:true});
 const simultaneous=()=>new Promise((resolve,reject)=>{const child=spawn(exe('psql'),args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',code=>{transcripts.push({command:'psql-concurrent',args,exitCode:code,stdout:out,stderr:err});resolve(code);});child.stdin.end(`BEGIN; SELECT set_config('test.actor','${f.actor}',true); SET LOCAL ROLE authenticated; SELECT accept_tenant_invite('${f.token}'); SELECT pg_sleep(0.2); COMMIT;`);});
 const outcomes=await Promise.all([simultaneous(),simultaneous()]);
 check('Concurrent acceptance grants once and records one attributable receipt',()=>{assert.equal(outcomes.filter(x=>x===0).length,1);assert.equal(sql(`SELECT uses FROM tenant_invite_tokens WHERE id='${f.invite}';`),'1');assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE entity_id='${f.invite}';`),'1');assert.equal(sql(`SELECT count(*) FROM user_roles WHERE user_id='${f.actor}' AND role='client';`),'1');});
 }
 const failed=results.filter(x=>x.status==='FAIL');
 const report={mode:baselineOnly?'baseline':'candidate',evidenceClass:'synthetic-native-postgresql',fullSupabaseReplay:'UNVERIFIED',authenticatedAcceptance:'NOT_RUN',host:'127.0.0.1',port,platform:os.platform(),node:process.version,migrationSHA256:createHash('sha256').update(migration).digest('hex'),results,passed:results.length-failed.length,failed:failed.length};
 fs.writeFileSync(path.join(work,baselineOnly?'baseline.json':'candidate.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,failed:report.failed,failures:failed,evidenceDir:work},null,2));
 if(failed.length)process.exitCode=1;
}finally{if(started)run('pg_ctl',['-D',cluster,'-w','stop','-m','fast']);fs.writeFileSync(path.join(work,baselineOnly?'baseline-transcript.json':'candidate-transcript.json'),JSON.stringify(transcripts,null,2));}
