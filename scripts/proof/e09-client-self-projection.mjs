// Executes the real projection migration in a dedicated synthetic native PostgreSQL
// cluster. Surrounding Auth/table shapes are stand-ins; this is not Supabase or QA.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = process.cwd();
const work = path.resolve(root, process.env.E09_PROJECTION_PROOF_DIR ?? '../../work/e09-client-projection-proof');
assert(work.startsWith(path.resolve(root, '../..') + path.sep), 'Proof stays in task workspace');
const port = Number(process.env.E09_PROJECTION_PG_PORT ?? 55443);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535 && ![5432,54322].includes(port), 'Dedicated proof port');
const bin = process.env.E09_PG_BIN ?? (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/16/bin' : '');
const exe = name => bin ? path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
fs.mkdirSync(work, { recursive: true });
const cluster = fs.mkdtempSync(path.join(work, 'cluster-'));
const transcripts = [], results = [];
function run(name,args,input) {
  const out=path.join(work,`${transcripts.length}-${name}.stdout`),err=path.join(work,`${transcripts.length}-${name}.stderr`);
  const stdout=fs.openSync(out,'w'),stderr=fs.openSync(err,'w');let r;
  try {r=spawnSync(exe(name),args,{input,encoding:'utf8',windowsHide:true,timeout:60000,stdio:['pipe',stdout,stderr]});}
  finally {fs.closeSync(stdout);fs.closeSync(stderr);}
  r.stdout=fs.readFileSync(out,'utf8');r.stderr=fs.readFileSync(err,'utf8');
  transcripts.push({command:name,args,exitCode:r.status,stdout:r.stdout,stderr:r.stderr});
  if(r.error)throw r.error;
  if(r.status!==0)throw new Error(`${name} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
const sql=s=>run('psql',['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-A','-t','-v','ON_ERROR_STOP=1'],s);
const uid='e0911000-0000-0000-0000-000000000001',other='e0911000-0000-0000-0000-000000000002';
const tenant='e0921000-0000-0000-0000-000000000001',foreign='e0921000-0000-0000-0000-000000000002';
const contact='e0931000-0000-0000-0000-000000000001',otherContact='e0931000-0000-0000-0000-000000000002';
function call(name='client_portal_self_profile',actor=uid,scope=tenant,role='authenticated') {
  const value=sql(`BEGIN; SELECT set_config('test.actor','${actor??''}',true); SET LOCAL ROLE ${role}; SELECT public.${name}(${scope===null?'NULL':`'${scope}'`}); COMMIT;`);
  return value.split('\n').find(line=>line.startsWith('{')) ?? null;
}
const check=(name,fn)=>{try{fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:String(e.message)});}};
const profile=(actor=uid,scope=tenant)=>{const data=call('client_portal_self_profile',actor,scope);return data?JSON.parse(data):null;};
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20271102120000_e09_client_self_projection.sql'),'utf8');
const presentationMigration=fs.readFileSync(path.join(root,'supabase/migrations/20271106110000_e09_client_presentation_scope.sql'),'utf8');
const brandCascadeSource=fs.readFileSync(path.join(root,'supabase/migrations/20260804030000_debrand_operator_identity_seam.sql'),'utf8');
const brandCascade=brandCascadeSource.match(/CREATE FUNCTION public\.resolve_tenant_brand\([\s\S]*?\$\$;/)?.[0];
assert(brandCascade,'Incumbent native brand cascade must exist');
const unsafeControl=process.argv.includes('--unsafe-control');
const unsafePresentation=process.argv.includes('--presentation-unsafe-control');
const reportStem=unsafePresentation?'presentation-unsafe-control':unsafeControl?'unsafe-control':'candidate';
function presentation(actor=uid,role='authenticated') {
  const output=sql(`BEGIN; SELECT set_config('test.actor','${actor??''}',true); SET LOCAL ROLE ${role}; SELECT jsonb_build_object('brand',(SELECT to_jsonb(b) FROM public.get_client_portal_brand() b),'config',public.get_client_portal_config()); COMMIT;`);
  return JSON.parse(output.split('\n').find(line=>line.startsWith('{')));
}
let started=false;
try {
  run('initdb',['-D',cluster,'-U','postgres','-A','trust','--no-locale','-E','UTF8']);
  run('pg_ctl',['-D',cluster,'-l',path.join(cluster,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
  sql(`CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,status text DEFAULT 'active',name text,slug text,parent_tenant_id uuid,brand jsonb DEFAULT '{}',features jsonb DEFAULT '{}');
    CREATE TABLE public.tenant_legal_profile(tenant_id uuid PRIMARY KEY,brand_logo_url text);
    CREATE TABLE public.clients(id uuid PRIMARY KEY,tenant_id uuid,linked_user_id uuid UNIQUE,status text DEFAULT 'active',merged_into_contact_id uuid,
      first_name text,last_name text,entity_name text,street_address text,city text,state text,zip_code text,
      onboarding_stage text CHECK (onboarding_stage IS NULL OR onboarding_stage IN ('pre_invite','invited','signing_agreement','accepting_payment','completing_intake','uploading_docs','completed')),
      source text,paige_shared_context_consent boolean,paige_shared_context_consent_updated_at timestamptz,updated_at timestamptz,
      current_notes text,lead_score int,created_by uuid,provider_secret text,created_at timestamptz DEFAULT now());
    CREATE TABLE public.client_contact_methods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid,tenant_id uuid,kind text,value text,is_primary boolean,label text,match_key text);
    INSERT INTO tenants(id) VALUES('${tenant}'),('${foreign}');
    INSERT INTO clients(id,tenant_id,linked_user_id,first_name,last_name,entity_name,street_address,city,state,zip_code,onboarding_stage,source,current_notes,lead_score,provider_secret)
      VALUES('${contact}','${tenant}','${uid}','Jordan','Reyes','Client company','1 Test Road','Test City','TS','00000','invited','invitation','INTERNAL NOTES',99,'INTERNAL PROVIDER'),
      ('${otherContact}','${foreign}','${other}','Foreign','Person',NULL,NULL,NULL,NULL,NULL,'invited','signup','FOREIGN NOTES',98,'FOREIGN PROVIDER');
    INSERT INTO client_contact_methods(client_id,tenant_id,kind,value,is_primary,label,match_key) VALUES
      ('${contact}','${tenant}','email','primary@tests.invalid',true,'INTERNAL LABEL','INTERNAL MATCH'),
      ('${contact}','${tenant}','email','secondary@tests.invalid',false,'OTHER LABEL','OTHER MATCH'),
      ('${contact}','${tenant}','phone','+12025550109',true,'PHONE LABEL','PHONE MATCH'),
      ('${contact}','${foreign}','email','poison@tests.invalid',true,'CROSS TENANT','CROSS MATCH'),
      ('${otherContact}','${foreign}','email','foreign@tests.invalid',true,'FOREIGN LABEL','FOREIGN MATCH');
    ALTER TABLE clients ENABLE ROW LEVEL SECURITY; ALTER TABLE client_contact_methods ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON clients,client_contact_methods FROM PUBLIC,authenticated,anon,service_role;`);
  sql(migration);const once=sql("SELECT string_agg(pg_get_functiondef(oid),'|' ORDER BY proname) FROM pg_proc WHERE proname IN ('client_portal_relationship_id','client_portal_self_profile');");sql(migration);
  check('Migration reapplication is idempotent',()=>assert.equal(sql("SELECT string_agg(pg_get_functiondef(oid),'|' ORDER BY proname) FROM pg_proc WHERE proname IN ('client_portal_relationship_id','client_portal_self_profile');"),once));
  sql(brandCascade+` REVOKE ALL ON FUNCTION public.resolve_tenant_brand(uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.resolve_tenant_brand(uuid) TO authenticated,service_role;`);
  sql(presentationMigration);
  const presentationOnce=sql("SELECT string_agg(pg_get_functiondef(oid),'|' ORDER BY proname) FROM pg_proc WHERE proname IN ('get_client_portal_brand','get_client_portal_config');");
  sql(presentationMigration);
  check('Presentation migration reapplication is idempotent',()=>assert.equal(sql("SELECT string_agg(pg_get_functiondef(oid),'|' ORDER BY proname) FROM pg_proc WHERE proname IN ('get_client_portal_brand','get_client_portal_config');"),presentationOnce));
  sql(`UPDATE tenants SET name='Test tenant A',slug='test-tenant-a',brand='{"product_name":"Test portal A","primary_color":"#26483e"}',features='{"portal_config":{"welcome":{"headline":"Saved greeting A"},"modules":[{"key":"documents","visible":false}]}}' WHERE id='${tenant}'; UPDATE tenants SET name='Test tenant B',slug='test-tenant-b',brand='{"product_name":"Foreign portal B"}',features='{"portal_config":{"welcome":{"headline":"Foreign greeting B"}}}' WHERE id='${foreign}'; INSERT INTO tenant_legal_profile VALUES('${tenant}','https://assets.example.test/legacy-logo.png');`);
  if(unsafePresentation){
    assert.equal(presentationMigration.split('WHERE c.id = public.client_portal_relationship_id()').length-1,2,'Both presentation control targets must exist');
    sql(presentationMigration.replaceAll('WHERE c.id = public.client_portal_relationship_id()',"WHERE c.linked_user_id = auth.uid() ORDER BY c.created_at ASC LIMIT 1"));
  }
  if(unsafeControl){
    const profileDef=sql("SELECT pg_get_functiondef('public.client_portal_self_profile(uuid)'::regprocedure);");
    assert(profileDef.includes("'updated_at', c.updated_at,"),'Control mutation target must exist');
    sql(profileDef.replace("'updated_at', c.updated_at,","'updated_at', c.updated_at, 'current_notes', c.current_notes,"));
  }
  check('Actual authenticated caller gets canonical own profile without raw table SELECT',()=>{const p=profile();assert.equal(p.id,contact);assert.equal(p.tenant_id,tenant);assert.equal(p.first_name,'Jordan');});
  check('Complete explicit allowlist and no future/private CRM fields',()=>assert.deepEqual(Object.keys(profile()).sort(),['id','tenant_id','linked_user_id','first_name','last_name','entity_name','street_address','city','state','zip_code','onboarding_stage','is_signup_contact','paige_shared_context_consent','paige_shared_context_consent_updated_at','updated_at','email','phone','contact_methods'].sort()));
  check('Primary addresses come from tenant-matching canonical contact methods',()=>{const p=profile();assert.equal(p.email,'primary@tests.invalid');assert.equal(p.phone,'+12025550109');assert.equal(p.contact_methods.length,3);assert(!JSON.stringify(p).includes('INTERNAL'));assert(!JSON.stringify(p).includes('poison'));for(const m of p.contact_methods)assert.deepEqual(Object.keys(m).sort(),['kind','value','is_primary'].sort());});
  check('Foreign tenant argument supplies no authority',()=>assert.equal(profile(uid,foreign),null));
  check('Foreign subject cannot select this tenant relationship',()=>assert.equal(profile(other,tenant),null));
  check('Unlinked authenticated caller gets no profile',()=>assert.equal(profile('e0911000-0000-0000-0000-000000000099'),null));
  check('No selected tenant resolves only the one legitimate relationship',()=>assert.equal(profile(uid,null).id,contact));
  check('Anonymous callable access is denied',()=>assert.throws(()=>call('client_portal_self_profile',null,tenant,'anon')));
  check('Anonymous helper access is denied',()=>assert.throws(()=>call('client_portal_relationship_id',null,tenant,'anon')));
  check('Authenticated session without subject cannot call profile',()=>assert.throws(()=>call('client_portal_self_profile',null,tenant)));
  check('Service role alone is not a customer identity',()=>assert.throws(()=>call('client_portal_self_profile',null,tenant,'service_role')));
  check('Presentation keeps the valid native tenant brand, ABI and canonical overlay',()=>{const p=presentation();assert.equal(p.brand.tenant_id,tenant);assert.equal(p.brand.product_name,'Test portal A');assert.equal(p.brand.primary_color,'#26483e');assert.equal(p.brand.logo_url,'https://assets.example.test/legacy-logo.png');assert.equal(Object.keys(p.brand).length,13);assert.equal(p.config.welcome.headline,'Saved greeting A');assert.equal(p.config.modules[0].visible,false);assert(!JSON.stringify(p).includes('Foreign'));});
  check('Presentation switches only with the actual authenticated subject',()=>{const p=presentation(other);assert.equal(p.brand.tenant_id,foreign);assert.equal(p.config.welcome.headline,'Foreign greeting B');assert(!JSON.stringify(p).includes('Saved greeting A'));});
  check('Unlinked and missing subjects receive no presentation',()=>{for(const actor of [null,'e0911000-0000-0000-0000-000000000099'])assert.deepEqual(presentation(actor),{brand:null,config:{}});});
  check('Anonymous cannot execute either presentation reader',()=>{assert.equal(sql("SELECT has_function_privilege('anon','public.get_client_portal_brand()','EXECUTE') OR has_function_privilege('anon','public.get_client_portal_config()','EXECUTE');"),'f');assert.throws(()=>presentation(null,'anon'));});
  check('Presentation revocation is effective on the next read',()=>{sql(`UPDATE clients SET linked_user_id=NULL WHERE id='${contact}';`);try{assert.deepEqual(presentation(),{brand:null,config:{}});}finally{sql(`UPDATE clients SET linked_user_id='${uid}' WHERE id='${contact}';`);}});
  check('Presentation excludes archived and merged client relationships',()=>{for(const patch of ["status='archived'",`merged_into_contact_id='${otherContact}'`]){sql(`UPDATE clients SET ${patch} WHERE id='${contact}';`);try{assert.deepEqual(presentation(),{brand:null,config:{}});}finally{sql(`UPDATE clients SET status='active',merged_into_contact_id=NULL WHERE id='${contact}';`);}}});
  check('Presentation excludes an inactive sponsoring business',()=>{sql(`UPDATE tenants SET status='suspended' WHERE id='${tenant}';`);try{assert.deepEqual(presentation(),{brand:null,config:{}});}finally{sql(`UPDATE tenants SET status='active' WHERE id='${tenant}';`);}});
  check('Presentation preserves native ancestor inheritance and own legal-logo fallback',()=>{sql(`UPDATE tenants SET parent_tenant_id='${foreign}',brand='{}' WHERE id='${tenant}';`);try{const p=presentation();assert.equal(p.brand.tenant_id,tenant);assert.equal(p.brand.tenant_name,'Test tenant A');assert.equal(p.brand.product_name,'Foreign portal B');assert.equal(p.brand.logo_url,'https://assets.example.test/legacy-logo.png');assert.equal(p.config.welcome.headline,'Saved greeting A');}finally{sql(`UPDATE tenants SET parent_tenant_id=NULL,brand='{"product_name":"Test portal A","primary_color":"#26483e"}' WHERE id='${tenant}';`);}});
  check('Link revocation takes effect on next read',()=>{sql(`UPDATE clients SET linked_user_id=NULL WHERE id='${contact}';`);assert.equal(profile(),null);sql(`UPDATE clients SET linked_user_id='${uid}' WHERE id='${contact}';`);});
  check('Archived relationship is refused',()=>{sql(`UPDATE clients SET status='archived' WHERE id='${contact}';`);assert.equal(profile(),null);sql(`UPDATE clients SET status='active' WHERE id='${contact}';`);});
  check('Merged relationship is refused',()=>{sql(`UPDATE clients SET merged_into_contact_id='${otherContact}' WHERE id='${contact}';`);assert.equal(profile(),null);sql(`UPDATE clients SET merged_into_contact_id=NULL WHERE id='${contact}';`);});
  check('Inactive business is refused',()=>{sql(`UPDATE tenants SET status='suspended' WHERE id='${tenant}';`);assert.equal(profile(),null);sql(`UPDATE tenants SET status='active' WHERE id='${tenant}';`);});
  check('Reload reads actual updated profile and consent',()=>{sql(`UPDATE clients SET first_name='Updated',paige_shared_context_consent=true WHERE id='${contact}';`);const p=profile();assert.equal(p.first_name,'Updated');assert.equal(p.paige_shared_context_consent,true);});
  check('Reads produce no client, address or tenant mutations',()=>{const snapshot=()=>sql('SELECT jsonb_build_object(\'clients\',(SELECT jsonb_agg(to_jsonb(x)) FROM clients x),\'methods\',(SELECT jsonb_agg(to_jsonb(x)) FROM client_contact_methods x),\'tenants\',(SELECT jsonb_agg(to_jsonb(x)) FROM tenants x));');const before=snapshot();profile();assert.equal(snapshot(),before);});
  // Future multi-business shape is synthetic only: production's unique link is untouched.
  sql(`ALTER TABLE clients DROP CONSTRAINT clients_linked_user_id_key; UPDATE clients SET linked_user_id='${uid}' WHERE id='${otherContact}';`);
  check('Ambiguous relationship refuses instead of earliest-row selection',()=>assert.throws(()=>profile(uid,null)));
  check('Both presentation readers refuse future ambiguous business relationships',()=>assert.throws(()=>presentation()));
  check('Explicit future relationship selection stays isolated',()=>{assert.equal(profile(uid,tenant).id,contact);const p=profile(uid,foreign);assert.equal(p.id,otherContact);assert.equal(p.first_name,'Foreign');assert(!JSON.stringify(p).includes('secondary@'));assert.equal(p.is_signup_contact,true);});
  const failed=results.filter(x=>x.status==='FAIL');
  const report={mode:reportStem,evidenceClass:'synthetic-native-postgresql',fullSupabaseReplay:'UNVERIFIED',authenticatedAcceptance:'NOT_RUN',migrationSHA256:createHash('sha256').update(migration).digest('hex'),presentationSHA256:createHash('sha256').update(presentationMigration).digest('hex'),results,passed:results.length-failed.length,failed:failed.length};
  fs.writeFileSync(path.join(work,`${reportStem}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,failed:report.failed,failures:failed,evidenceDir:work},null,2));
  if(failed.length)process.exitCode=1;
}finally{if(started)run('pg_ctl',['-D',cluster,'-w','stop','-m','fast']);fs.writeFileSync(path.join(work,`${reportStem}-transcript.json`),JSON.stringify(transcripts,null,2));}
