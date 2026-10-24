import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interviewCheckpointMigration, interviewRealFunctions, runInterviewCheckpointProof } from './solo-setup-db-proof/interview-checkpoint.mjs';

// Never uses PGHOST, the existing Windows PostgreSQL service, a configured
// project connection, a cloud database, or production credentials.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = process.env.SOLO_PROOF_PG_BIN || 'C:/Program Files/PostgreSQL/16/bin';
const migrationNames = ['20261102010000_official_2022_naics_reference.sql','20261103000000_solo_setup_business_context.sql','20261104000000_solo_managed_sender_lifecycle.sql',interviewCheckpointMigration];
for (const name of migrationNames) if (!existsSync(join(root,'supabase/migrations',name))) throw new Error(`Required migration absent: ${name}`);
const outputRoot = join(root, 'outputs', 'solo-setup-db-proof');
mkdirSync(outputRoot, { recursive: true });
const runDir = mkdtempSync(join(outputRoot, 'run-'));
const cluster = join(runDir, 'cluster');
if (!resolve(cluster).startsWith(resolve(outputRoot) + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'))) throw new Error('Cluster path escaped isolated output root');
const results = [];
const transcript = [];
const recoveryFindings = [];
const appliedMigrationNames = [];
let schemaFingerprint = null;
let started = false;
let clusterStopped = false;
let port;
const tid = n => `20000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const uid = n => `10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const read = path => readFileSync(join(root,path),'utf8');
function extract(path, name) {
  const source = read(path);
  const start = source.search(new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
  if (start < 0) throw new Error(`Missing source function ${name}`);
  const rest = source.slice(start);
  const delimiter = rest.match(/\bas\s+(\$[a-z0-9_]*\$)/i);
  if (!delimiter) throw new Error(`Missing function delimiter ${name}`);
  const end = rest.indexOf(`${delimiter[1]};`, delimiter.index + delimiter[0].length);
  if (end < 0) throw new Error(`Missing function end ${name}`);
  return rest.slice(0,end + delimiter[1].length + 1);
}
async function run(executable,args,input='',allowFailure=false) {
  return await new Promise((resolveRun,reject) => {
    // pg_ctl's server child inherits pipes on Windows; ignored handles allow
    // pg_ctl to close promptly while server diagnostics stay in postgres.log.
    const controller=executable.endsWith('pg_ctl.exe');
    const child=spawn(executable,args,{cwd:root,windowsHide:true,stdio:controller?'ignore':['pipe','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout?.on('data',data=>stdout+=data);
    child.stderr?.on('data',data=>stderr+=data);
    child.on('error',reject);
    const timer=setTimeout(()=>{child.kill();reject(new Error('Isolated database command timed out'));},45000);
    child.on('close',code=>{
      clearTimeout(timer);
      transcript.push({executable,args,exitCode:code,stdout,stderr});
      if(code!==0&&!allowFailure) reject(new Error(`${executable} failed (${code}): ${stderr}`));
      else resolveRun({code,stdout,stderr});
    });
    child.stdin?.end(input);
  });
}
async function freePort() {
  const server=createServer();
  await new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolveListen);});
  const value=server.address().port;
  await new Promise(resolveClose=>server.close(resolveClose));
  return value;
}
const psql = (sql,allowFailure=false) => run(join(bin,'psql.exe'),['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-X','-q','-A','-t','--no-password','--set','ON_ERROR_STOP=1'],`\\set VERBOSITY verbose\n${sql}`,allowFailure);
const asUser = (n,sql) => `set role authenticated; set request.jwt.claim.sub='${uid(n)}'; ${sql}`;
const registration = (n,local,expected=n) => `select public.register_solo_setup_managed_email('${tid(expected)}','${local}');`;
const json = async sql => JSON.parse((await psql(sql)).stdout.trim());
function assert(condition,message) { if(!condition) throw new Error(message); }
async function test(name,fn) {
  try { await fn();results.push({name,status:'PASS'});console.log(`PASS ${name}`); }
  catch(error) {results.push({name,status:'FAIL',error:error.message});console.error(`FAIL ${name}: ${error.message}`);throw error;}
}
async function rejected(sql,code) {
  const result=await psql(sql,true);
  assert(result.code!==0,`Expected SQLSTATE ${code}, but call succeeded`);
  assert(result.stderr.includes(code),`Expected SQLSTATE ${code}; received ${result.stderr}`);
}
const snapshotSql = n => `select jsonb_build_object('local',(select local_part from public.tenant_email_identities where tenant_id='${tid(n)}'),
  'marker',(select managed_email_local_part from public.tenant_setup_business_context_meta where tenant_id='${tid(n)}'),
  'connector',(select to_jsonb(c)-'created_at'-'updated_at' from public.channel_connectors c where tenant_id='${tid(n)}' and provider='resend' and config->>'managed_default'='true'));`;
const sqlJson = value => value===null?'null':`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const saveSupplement = (n,revision,knowledge,profile,voice) => `select public.save_solo_business_context(
  _expected_tenant_id=>'${tid(n)}',_brief=>'{}'::jsonb,_business_owners=>'[]'::jsonb,
  _primary_business_email=>null,_knowledge_sources=>${sqlJson(knowledge)},_paige_profile=>${sqlJson(profile)},
  _voice_examples=>${sqlJson(voice)},_expected_primary_business_email=>null,_primary_business_email_decision=>null,
  _expected_context_revision=>${revision});`;
const getContext = n => json(asUser(n,'select public.get_solo_business_context();'));
const supplementSnapshot = n => json(`select jsonb_build_object(
  'knowledge',(select jsonb_agg(to_jsonb(k) order by id) from public.tenant_setup_knowledge_sources k where tenant_id='${tid(n)}'),
  'profile',(select to_jsonb(p) from public.tenant_setup_paige_profiles p where tenant_id='${tid(n)}'),
  'voice',(select jsonb_agg(to_jsonb(e) order by id) from public.tenant_setup_voice_examples e where tenant_id='${tid(n)}'),
  'meta',(select to_jsonb(m) from public.tenant_setup_business_context_meta m where tenant_id='${tid(n)}'),
  'baseSaveCalls',(select count(*) from public.fixture_base_save_calls where tenant_id='${tid(n)}'));`);
try {
  port=await freePort();
  await run(join(bin,'initdb.exe'),['-D',cluster,'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8']);
  started=true;
  await run(join(bin,'pg_ctl.exe'),['-D',cluster,'-l',join(runDir,'postgres.log'),'-w','-t','30','-o',`-h 127.0.0.1 -p ${port} -c max_connections=20`,'start']);
  await psql(read('scripts/solo-setup-db-proof/fixture.sql'));
  const definitions=[
    ['supabase/migrations/20260714144656_tier_rail_phaseB_agency_standing.sql','current_user_tenant_id'],
    ['supabase/migrations/20261046000000_solo_setup_persistence_repair.sql','solo_setup_can_read'],
    ['supabase/migrations/20261046000000_solo_setup_persistence_repair.sql','solo_setup_access_scope'],
    ['supabase/migrations/20260711170000_tenant_email_identity_registry.sql','sanitize_email_local_part'],
    ['supabase/migrations/20260711310000_brand_schema_and_cascade.sql','provision_tenant_email_identity'],
    ['supabase/migrations/20260712230000_tier1_per_tenant_default_sender.sql','resolve_tenant_sender'],
    ['supabase/migrations/20260803120000_p1_subaccount_owner_leak_fix.sql','provision_paige_managed_email_connector'],
    ['supabase/migrations/20260730180000_tenant_wildcard_web_hosts.sql','sync_paige_managed_email_connector_on_tenant'],
  ];
  await psql(definitions.map(([path,name])=>extract(path,name)).join('\n'));
  await psql(`revoke all on function public.provision_paige_managed_email_connector(uuid),public.resolve_tenant_sender(uuid),public.provision_tenant_email_identity(uuid) from public,anon,authenticated;
    grant execute on function public.provision_paige_managed_email_connector(uuid),public.resolve_tenant_sender(uuid),public.provision_tenant_email_identity(uuid) to service_role;
    select public.provision_paige_managed_email_connector(id) from public.tenants;
    update public.tenants set status='active' where id='${tid(8)}'; select public.provision_paige_managed_email_connector('${tid(8)}');
    update public.tenants set status='suspended' where id='${tid(8)}'; select public.provision_paige_managed_email_connector('${tid(8)}');
    create trigger trg_tenants_paige_managed_email_connector after insert or update of slug,name,status,account_type,parent_tenant_id,features on public.tenants
      for each row execute function public.sync_paige_managed_email_connector_on_tenant();
    create table public.fixture_nonsolo_before as select tenant_id,to_jsonb(c)-'created_at'-'updated_at' as snapshot from public.channel_connectors c where tenant_id not in ('${tid(1)}','${tid(2)}');`);
  await test('all three new migrations compile and apply on isolated real PostgreSQL',async()=>{
    for(const name of migrationNames.slice(0,3)) {
      await psql(read(`supabase/migrations/${name}`));
      appliedMigrationNames.push(name);
    }
  });
  await test('Agency, Enterprise, child standalone, sub-account, system and suspended behavior is preserved',async()=>{
    await psql(`select public.provision_paige_managed_email_connector(id) from public.tenants where id not in ('${tid(1)}','${tid(2)}');`);
    const mismatch=await json(`select count(*) from public.fixture_nonsolo_before b full join (select tenant_id,to_jsonb(c)-'created_at'-'updated_at' as snapshot from public.channel_connectors c where tenant_id not in ('${tid(1)}','${tid(2)}')) a using(tenant_id) where b.snapshot is distinct from a.snapshot;`);
    assert(mismatch===0,'Non-Solo helper output changed');
    assert(await json(`select count(*) from public.channel_connectors where tenant_id='${tid(7)}';`)===0,'System workspace gained a connector');
  });
  await test('missing tenant is rejected by managed connector helper',async()=>{
    await rejected(`select public.provision_paige_managed_email_connector('${tid(999)}');`,'22023');
  });
  await test('anonymous, Member, Admin and non-Solo actors cannot register',async()=>{
    await rejected(`set role anon; ${registration(1,'anonymous')}`,'42501');
    for(const actor of [9,10]) await rejected(asUser(actor,registration(1,'wrong-role')),'42501');
    await rejected(asUser(3,registration(3,'agency-change')),'42501');
  });
  await test('expected-tenant mismatch refuses before mutation',async()=>{
    const before=await json(snapshotSql(1));
    await rejected(asUser(1,registration(1,'wrong-tenant',2)),'40001');
    assert(JSON.stringify(before)===JSON.stringify(await json(snapshotSql(1))),'Mismatched request mutated sender');
  });
  await test('Solo owner registration updates registry marker and connector atomically and is repeatable',async()=>{
    await psql(asUser(1,registration(1,'chosen-business')));
    const before=await json(snapshotSql(1));
    assert(before.local==='chosen-business'&&before.marker==='chosen-business','Registry or private marker missing');
    assert(before.connector.from_address==='chosen-business@mail.paigeagent.ai'&&before.connector.inbound_address===before.connector.from_address,'Connector and registry disagree');
    await psql(asUser(1,registration(1,'chosen-business')));
    assert(JSON.stringify(before)===JSON.stringify(await json(snapshotSql(1))),'Repeated registration changed identity or duplicated connector');
  });
  await test('tenant rename preserves registered Solo address through the actual lifecycle trigger',async()=>{
    await psql(`update public.tenants set name='Renamed business',slug='renamed-business' where id='${tid(1)}';`);
    const after=await json(snapshotSql(1));
    assert(after.local==='chosen-business'&&after.connector.from_address==='chosen-business@mail.paigeagent.ai','Lifecycle reverted registration');
  });
  await test('verified custom sender priority is unchanged while managed identity stays independently visible',async()=>{
    await psql(`insert into public.tenant_email_domains(tenant_id,domain,status,from_email_local,is_default,verified_at) values('${tid(1)}','custom.example','verified','hello',true,now());`);
    const sender=await json(`select public.resolve_tenant_sender('${tid(1)}');`);
    assert(sender.from_address==='hello@custom.example','Custom sender priority changed');
    const context=await json(asUser(1,'select public.get_solo_business_context();'));
    assert(context.managedEmail.address==='chosen-business@mail.paigeagent.ai','Managed identity is actually custom sender');
  });
  await test('registry, inbound-only and reserved collisions refuse with complete rollback',async()=>{
    await psql(`insert into public.channel_connectors(tenant_id,channel_type,provider,inbound_address,active,status,config) values('${tid(2)}','email','other','connector-only@mail.paigeagent.ai',true,'active','{}'),(null,'email','other','platform-only@mail.paigeagent.ai',true,'active','{}');`);
    const before=await json(snapshotSql(1));
    for(const local of ['fixture-2','connector-only','platform-only','team']) {
      const r=await psql(asUser(1,registration(1,local)),true);
      assert(r.code!==0,`Collision ${local} was allowed`);
      assert(JSON.stringify(before)===JSON.stringify(await json(snapshotSql(1))),`Collision ${local} left partial mutation`);
    }
  });
  await test('two tenants racing for one address yield exactly one complete winner',async()=>{
    const race=await Promise.all([1,2].map(n=>psql(asUser(n,`begin; ${registration(n,'race-winner')} select pg_sleep(0.3); commit;`),true)));
    assert(race.filter(r=>r.code===0).length===1,'Race did not have exactly one winner');
    assert(race.find(r=>r.code!==0).stderr.includes('23505'),'Race loser did not fail with an address collision');
    const identities=await json(`select count(*) from public.tenant_email_identities where local_part='race-winner';`);
    const connectors=await json(`select count(*) from public.channel_connectors where from_address='race-winner@mail.paigeagent.ai';`);
    assert(identities===1&&connectors===1,'Race produced split or duplicated identity');
  });
  await test('held registration and tenant rename resolve without deadlock or sender drift',async()=>{
    // A fixture-only pause holds the row lock before the real lifecycle AFTER
    // trigger. This exposes an advisory-before-row inversion deterministically.
    await psql(`create function public.fixture_pause_rename() returns trigger language plpgsql as $$ begin
      if new.name='Concurrent rename' then perform pg_sleep(3); end if; return new; end $$;
      create trigger fixture_pause_rename before update of name on public.tenants for each row execute function public.fixture_pause_rename();`);
    const two=psql(`set application_name='solo-setup-rename-proof'; update public.tenants set name='Concurrent rename' where id='${tid(1)}';`,true);
    let renameHoldingRow=false;
    for(let attempt=0;attempt<20&&!renameHoldingRow;attempt++) {
      renameHoldingRow=await json(`select to_jsonb(exists(select 1 from pg_stat_activity where application_name='solo-setup-rename-proof' and wait_event='PgSleep'));`);
      if(!renameHoldingRow) await new Promise(resolveDelay=>setTimeout(resolveDelay,50));
    }
    assert(renameHoldingRow,'Could not establish the controlled lifecycle row-lock precondition');
    const one=psql(asUser(1,registration(1,'rename-race')),true);
    const values=await Promise.all([one,two]);
    assert(values.every(v=>v.code===0),`Lifecycle concurrency failure: ${values.map(v=>v.stderr).join(' | ')}`);
    const result=await json(snapshotSql(1));
    assert(result.local==='rename-race'&&result.connector.from_address==='rename-race@mail.paigeagent.ai','Concurrent lifecycle lost registered identity');
  });
  await test('new sealed context tables refuse direct authenticated reads and writes',async()=>{
    await rejected(asUser(1,'select * from public.tenant_setup_business_context_meta;'),'42501');
    await rejected(asUser(1,`update public.tenant_setup_business_context_meta set managed_email_local_part='bypass' where tenant_id='${tid(1)}';`),'42501');
  });
  await test('disabled existing sender refuses registration without silently reactivating',async()=>{
    await psql(`update public.tenant_email_identities set status='disabled' where tenant_id='${tid(2)}';`);
    const before=await json(snapshotSql(2));
    await rejected(asUser(2,registration(2,'disabled-identity')),'42501');
    assert(JSON.stringify(before)===JSON.stringify(await json(snapshotSql(2))),'Disabled identity was modified');
  });
  await test('later authoritative registry changes survive the Solo lifecycle',async()=>{
    await psql(`update public.tenant_email_identities set local_part='registry-authority' where tenant_id='${tid(1)}';
      update public.tenants set name='Registry rename' where id='${tid(1)}';`);
    const sender=await json(snapshotSql(1));
    assert(sender.local==='registry-authority'&&sender.connector.from_address==='registry-authority@mail.paigeagent.ai','Lifecycle trusted stale marker rather than registry authority');
  });
  let context;
  const source={id:'30000000-0000-0000-0000-000000000001',sourceType:'link',title:'Company overview',category:'business',sourceUrl:'https://example.com/company',reference:'',notes:'Owner supplied source',reviewStatus:'ready',provenance:{source:'connection_sourced',confirmedAt:'forged'}};
  const example={id:'40000000-0000-0000-0000-000000000001',channel:'email',kind:'sounds_like',example:'Clear next steps for your business.',note:'Keep it grounded',provenance:{source:'connection_sourced',confirmedAt:'forged'}};
  await test('supplement first use creates real tenant-scoped knowledge profile and voice records',async()=>{
    const first=await getContext(1);
    assert(first.knowledgeSources.length===0&&first.voiceExamples.length===0,'Unexpected first-use records');
    await psql(asUser(1,saveSupplement(1,first.contextRevision,[source],{voiceCharacter:'Direct and warm',provenance:{voiceCharacter:{source:'connection_sourced'}}},[example])));
    context=await getContext(1); // Separate fresh connection proves committed read.
    assert(context.contextRevision===first.contextRevision+1,'Revision did not advance');
    assert(context.knowledgeSources[0].id===source.id&&context.knowledgeSources[0].title===source.title,'Knowledge did not persist');
    assert(context.voiceExamples[0].example===example.example&&context.paigeProfile.voiceCharacter==='Direct and warm','Voice/profile did not persist');
    assert(context.knowledgeSources[0].provenance.source==='owner_confirmed'&&context.voiceExamples[0].provenance.source==='owner_confirmed'&&context.paigeProfile.provenance.voiceCharacter.source==='owner_confirmed','Client provenance was trusted');
    assert(context.knowledgeSources[0].provenance.confirmedAt!=='forged','Client confirmation timestamp was trusted');
  });
  await test('stable-id edits upsert existing supplemental records without duplicates',async()=>{
    await psql(asUser(1,saveSupplement(1,context.contextRevision,[{...source,title:'Updated overview'}],{voiceCharacter:'Warm and precise'},[{...example,example:'Here is your next clear step.'}])));
    context=await getContext(1);
    assert(context.knowledgeSources.length===1&&context.knowledgeSources[0].id===source.id&&context.knowledgeSources[0].title==='Updated overview','Knowledge edit duplicated or lost record');
    assert(context.voiceExamples.length===1&&context.voiceExamples[0].id===example.id&&context.voiceExamples[0].example==='Here is your next clear step.','Voice edit duplicated or lost record');
    assert(context.paigeProfile.voiceCharacter==='Warm and precise','Profile edit missing after reopen');
  });
  await test('no-op supplement save preserves knowledge voice timestamps and all field provenance',async()=>{
    const before=context;
    await psql(asUser(1,saveSupplement(1,context.contextRevision,context.knowledgeSources,context.paigeProfile,context.voiceExamples)));
    context=await getContext(1);
    assert(JSON.stringify(context.knowledgeSources)===JSON.stringify(before.knowledgeSources),'No-op source save rewrote provenance/timestamp');
    assert(JSON.stringify(context.voiceExamples)===JSON.stringify(before.voiceExamples),'No-op example save rewrote provenance/timestamp');
    assert(JSON.stringify(context.paigeProfile)===JSON.stringify(before.paigeProfile),'No-op profile save rewrote field provenance');
  });
  await test('stale revision and expected-tenant save failures rollback every supplement and base seam',async()=>{
    const before=await supplementSnapshot(1);
    await rejected(asUser(1,saveSupplement(1,context.contextRevision-1,[],{},[])),'40001');
    await rejected(asUser(1,saveSupplement(2,0,[],{},[])),'40001');
    assert(JSON.stringify(before)===JSON.stringify(await supplementSnapshot(1)),'Refused save left partial mutation');
  });
  await test('cross-tenant source and voice IDs are refused with complete transaction rollback',async()=>{
    const before=await supplementSnapshot(2);
    await rejected(asUser(2,saveSupplement(2,0,[source],{},[])),'42501');
    await rejected(asUser(2,saveSupplement(2,0,[],{},[example])),'42501');
    assert(JSON.stringify(before)===JSON.stringify(await supplementSnapshot(2)),'Cross-tenant save left records or base writes');
    const other=await getContext(2);
    assert(other.knowledgeSources.length===0&&other.voiceExamples.length===0,'Other tenant can read first tenant records');
  });
  await test('invalid source content and unsupported profile fields fail atomically',async()=>{
    const before=await supplementSnapshot(1);
    await rejected(asUser(1,saveSupplement(1,context.contextRevision,[{...source,sourceUrl:'',notes:''}],{},[])),'22023');
    await rejected(asUser(1,saveSupplement(1,context.contextRevision,[{...source,sourceType:'document',sourceUrl:'',notes:''}],{},[])),'22023');
    await rejected(asUser(1,saveSupplement(1,context.contextRevision,[],{autonomy:'unrestricted'},[])),'22023');
    assert(JSON.stringify(before)===JSON.stringify(await supplementSnapshot(1)),'Invalid save left partial state');
  });
  await test('Admin null supplements preserve owner records while nonnull changes and Member saves refuse',async()=>{
    const before=context;
    await rejected(asUser(9,saveSupplement(1,context.contextRevision,[],null,null)),'42501');
    await rejected(asUser(9,saveSupplement(1,context.contextRevision,null,{},null)),'42501');
    await rejected(asUser(9,saveSupplement(1,context.contextRevision,null,null,[])),'42501');
    await rejected(asUser(10,saveSupplement(1,context.contextRevision,null,null,null)),'42501');
    await psql(asUser(9,saveSupplement(1,context.contextRevision,null,null,null)));
    context=await getContext(1);
    assert(JSON.stringify(context.knowledgeSources)===JSON.stringify(before.knowledgeSources)&&JSON.stringify(context.voiceExamples)===JSON.stringify(before.voiceExamples)&&JSON.stringify(context.paigeProfile)===JSON.stringify(before.paigeProfile),'Admin null supplements changed owner records');
  });
  await test('owner removal persists and never creates Team access records',async()=>{
    const members=await json('select jsonb_agg(to_jsonb(m) order by tenant_id,user_id) from public.tenant_members m;');
    await psql(asUser(1,saveSupplement(1,context.contextRevision,[],context.paigeProfile,[])));
    const removed=await getContext(1);
    assert(removed.knowledgeSources.length===0&&removed.voiceExamples.length===0,'Removal did not persist');
    assert(JSON.stringify(members)===JSON.stringify(await json('select jsonb_agg(to_jsonb(m) order by tenant_id,user_id) from public.tenant_members m;')),'Supplement changed Team roster or roles');
  });
  await runInterviewCheckpointProof({psql,json,asUser,rejected,test,assert,tid,uid,sqlJson,read,extract,
    onMigrationApplied:name=>appliedMigrationNames.push(name)});
} catch(error) {
  process.exitCode=1;
  recoveryFindings.push({error:error.message});
  console.error(error.message);
} finally {
  if(started) {
    try {
      const schema=await json(`select jsonb_build_object(
        'columns',(select jsonb_agg(to_jsonb(c) order by table_schema,table_name,ordinal_position)
          from information_schema.columns c where table_schema in ('public','auth','vault')),
        'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text)
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','vault')));`);
      schemaFingerprint=createHash('sha256').update(JSON.stringify(schema)).digest('hex');
    } catch(error) {process.exitCode=1;recoveryFindings.push({error:error.message});console.error(error.message);}
    try {await run(join(bin,'pg_ctl.exe'),['-D',cluster,'-w','-t','30','-m','fast','stop']);clusterStopped=true;}
    catch(error){process.exitCode=1;recoveryFindings.push({error:error.message});console.error(error.message);}
  }
  const proof={generatedAt:new Date().toISOString(),status:process.exitCode?'FAIL':'PASS',environment:'new disposable local PostgreSQL cluster; synthetic records only',host:'127.0.0.1',port,clusterStopped,
    assurance:'Real PostgreSQL execution of tracked migrations, extracted sender/access functions, canonical Setup save/get functions and checkpoint RPCs. Initial supplemental cases use the explicitly stubbed base seam; interview cases replace it with verbatim real base functions and assert real tenants.brand writes. Synthetic dependency schema; NOT full production schema replay, protected Vault/provider delivery, or authenticated browser proof.',
    interviewFunctions:interviewRealFunctions.map(([name,fn])=>({name,fn,sha256:createHash('sha256').update(extract(`supabase/migrations/${name}`,fn)).digest('hex')})),
    migrations:migrationNames.map(name=>({name,sha256:createHash('sha256').update(read(`supabase/migrations/${name}`)).digest('hex')})),results};
  writeFileSync(join(runDir,'proof.json'),JSON.stringify(proof,null,2));
  writeFileSync(join(runDir,'migration-state.json'),JSON.stringify({generatedAt:proof.generatedAt,
    environment:proof.environment,assurance:'Scoped fixture replay and exact function extraction; not the full production migration chain.',
    trackedMigrations:proof.migrations,appliedMigrations:appliedMigrationNames,schemaFingerprint,
    openRecoveryFindings:[...recoveryFindings,...results.filter(result=>result.status==='FAIL').map(result=>({test:result.name,error:result.error}))]},null,2));
  writeFileSync(join(runDir,'commands.json'),JSON.stringify(transcript,null,2));
  console.log(`Evidence: ${join(runDir,'proof.json')}`);
}
