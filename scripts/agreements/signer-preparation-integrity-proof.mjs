// One original agreements cluster; synthetic auth/native state is not customer acceptance.
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const [binary,port,user,directory,mode]=process.argv.slice(2);
assert(binary&&/^\d+$/.test(port??'')&&user&&directory&&['baseline-frozen','baseline-order','repaired'].includes(mode));
let database='postgres',checks=0;const sessions=[];
const args=()=>['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>{const r=spawnSync(binary,args(),{input,encoding:'utf8',windowsHide:true,maxBuffer:8e6,timeout:30000});if(r.status!==0)throw Error(r.stderr||String(r.error));return r.stdout.trim();};
const read=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const normalize=value=>value.replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
assert.equal(normalize(sql('SHOW data_directory;')),normalize(directory),'Only the verified task-owned cluster');
const fixture='signer_preparation_'+randomUUID().replaceAll('-','');sql(`CREATE DATABASE ${fixture};`);database=fixture;
const tenant='aaaaaaaa-0000-4000-8000-000000000001',actor='11111111-0000-4000-8000-000000000001',client='c1111111-0000-4000-8000-000000000001';
const context=`SET ROLE authenticated;SET test.uid='${actor}';SET test.tenant='${tenant}';SET test.admin='true';SET test.member='true';`;
const check=(value,message)=>{assert(value,message);checks++;};
const refused=(statement,code='23514',prefix=context)=>{sql(prefix+`DO $proof$ BEGIN BEGIN ${statement.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};RAISE EXCEPTION 'Expected native refusal ${code}';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);checks++;};
const startSession=(name,input)=>{
 const child=spawn(binary,args(),{windowsHide:true});
 const promise=new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>{child.kill();reject(Error('Owned signer session timed out'));},20000);child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>errors+=v);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);code===0?resolve(output.trim()):reject(Error(errors));});});
 sessions.push(promise);promise.catch(()=>{});child.stdin.end(`SET application_name=${quote(name)};`+input);return promise;
};
const observe=async query=>{const deadline=Date.now()+5000;do{if(sql(query)==='t')return;await new Promise(resolve=>setTimeout(resolve,20));}while(Date.now()<deadline);throw Error('Expected original lock/session state was not observed');};
try{
 sql(read('scripts/agreements/_fixture-schema.sql'));
 sql('ALTER TABLE tenant_client_agreements ADD COLUMN offer_id uuid REFERENCES tenant_products(id),ADD COLUMN catalog_price_id uuid;');
 for(const name of ['20270401000000_agreements_engine_records.sql','20271020000310_sales_agreement_trigger_contracts.sql','20270404000000_agreement_signing_contract.sql','20270405000000_agreement_signer_seam.sql'])sql(read('supabase/migrations/'+name));
 const seed=read('supabase/migrations/20270519010000_contact_methods_dependents.sql');const from=seed.indexOf('CREATE OR REPLACE FUNCTION public.seed_agreement_counterparty()'),to=seed.indexOf('$function$;',from)+'$function$;'.length;assert(from>=0&&to>from);sql(seed.slice(from,to));
 for(const name of ['20271113120000_agreement_draft_request_identity.sql','20271113130000_agreement_draft_revision_history.sql','20271113160000_agreement_frozen_draft_integrity.sql'])sql(read('supabase/migrations/'+name));
 const original=sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.add_agreement_signer(uuid,uuid,text,text,text,integer)'::regprocedure;");check(original==='8202b665bd31e96e815676e9be2335cc','Exact current production signer writer reproduced');
 const save=sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.save_paige_agreement(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,text,timestamptz)'::regprocedure;");
 if(mode==='repaired'){const migration=read('supabase/migrations/20271113240004_agreement_signer_preparation_integrity.sql');sql(migration);sql(migration);}
 const fresh=()=>JSON.parse(sql(context+`SELECT save_paige_agreement('${tenant}',NULL,'${client}','Original supplied document','Exact original supplied words');`));
 const add=(id,email='person@example.test',order='NULL',name='Additional Signer',role='counterparty')=>`SELECT add_agreement_signer('${tenant}','${id}',${quote(name)},${quote(email)},${quote(role)},${order});`;
 const a=fresh(),before=Number(sql(`SELECT count(*) FROM paige_agreement_signers WHERE agreement_id='${a.id}'`));
 const first=JSON.parse(sql(context+add(a.id)));check(first.signing_order===before+1&&first.email==='person@example.test','Original authorized caller/order/closed DTO remains usable');
 check(Object.keys(first).sort().join(',')==='email,full_name,signer_id,signer_role,signing_order,status','No token/IP/consent or private field added to the return contract');
 refused(add(a.id),'23505');
 refused(add(a.id,'foreign@example.test'),'42501',context+"SET test.tenant='bbbbbbbb-0000-4000-8000-000000000002';");
 refused(add(a.id,'member@example.test'),'42501',context+"SET test.admin='false';");
 console.log(JSON.stringify({checkpoint:'Original signer/authority/duplicate positive controls',checks}));
 if(mode!=='baseline-order'){
  const frozen=fresh();sql(`UPDATE paige_agreements SET content_storage_key='${tenant}/${frozen.id}/reviewed.pdf',content_sha256=repeat('a',64) WHERE id='${frozen.id}';`);
  refused(add(frozen.id,'later@example.test'));
  check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE agreement_id='${frozen.id}' AND email='later@example.test'`)==='0','Frozen refusal creates no signer');
 }
 if(mode==='repaired'){
  check(Number(sql(`SELECT version FROM paige_agreements WHERE id='${a.id}'`))===a.version+1,'Changing parties advances original reviewed source version');
  refused(`SELECT save_paige_agreement('${tenant}','${a.id}','${client}','Stale title','Stale supplied words',NULL,NULL,'paige_draft',NULL,NULL,'${a.updated_at}');`,'40001');
  check(JSON.parse(sql(`SELECT to_json(body_markdown) FROM paige_agreements WHERE id='${a.id}'`))==='Exact original supplied words','No supplied wording rewrite');
 }
 // The held table lock guarantees both original callers reach a real lock wait.
 // Old code computes the same order before INSERT; repaired code serializes at
 // the original agreement before choosing the next order.
 const tag='e04_signers_'+randomUUID().replaceAll('-','');
 startSession(tag+'barrier','BEGIN;LOCK TABLE paige_agreement_signers IN SHARE MODE;SELECT pg_sleep(1.5);COMMIT;');
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(tag+'barrier')} AND wait_event='PgSleep');`);
 const left=startSession(tag+'left',context+add(a.id,'left@example.test'));
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(tag+'left')} AND wait_event_type='Lock');`);
 const right=startSession(tag+'right',context+add(a.id,'right@example.test'));
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(tag+'right')} AND wait_event_type='Lock');`);checks++;
 const pair=(await Promise.all([left,right])).map(value=>JSON.parse(value));
 check(new Set(pair.map(value=>value.signing_order)).size===2,'Concurrent original additions must retain distinct signer order');
 check(pair.every(value=>value.signing_order>first.signing_order),'Both additions follow existing original signer');
 if(mode==='repaired'){
  check(Number(sql(`SELECT version FROM paige_agreements WHERE id='${a.id}'`))===a.version+3,'Each actual party change advances the same source exactly once');
  check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${a.id}' AND detail ? 'added_signer_order'`)==='3','One original event per actual addition');
  check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE agreement_id='${a.id}' AND (token_hash IS NOT NULL OR status IN ('signed','viewed'))`)==='0','No signing token/view/consent action fabricated');
  check(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.save_paige_agreement(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,text,timestamptz)'::regprocedure;")===save,'Original SAVE body remains unchanged');
  const meta=JSON.parse(sql("SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'acl',proacl::text,'config',proconfig,'defaults',pronargdefaults) FROM pg_proc WHERE oid='public.add_agreement_signer(uuid,uuid,text,text,text,integer)'::regprocedure;"));
  check(meta.owner==='proofrunner'&&meta.acl.includes('authenticated=X/')&&!meta.acl.includes('anon=X/')&&meta.defaults===2,'Existing owner/ACL/defaulted signature preserved in fixture');
  check(meta.config.includes('search_path=public, pg_temp'),'Original function search path preserved');
  refused(add(a.id,'anon@example.test'),'42501',context+'SET ROLE anon;');
  refused(add(a.id,'service@example.test'),'42501',context+'SET ROLE service_role;');
  refused(add(a.id,'unsigned@example.test'),'42501',context+"SET test.uid='';");
  refused(add(a.id,'badname@example.test','NULL',''));
  refused(add(a.id,'no-address'));
  refused(add(a.id,'invalidrole@example.test','NULL','Additional','unsupported'));
  refused(add(a.id,'zeroorder@example.test','0'));
  const explicit=JSON.parse(sql(context+add(a.id,'witness@example.test','7','Witness','witness')));check(explicit.signing_order===7&&explicit.signer_role==='witness','Explicit witness/order remains usable');
  refused(add(a.id,'occupied@example.test','7'),'23505');
  for(const [column,value] of [['content_storage_key',quote(`${tenant}/retained/source.pdf`)],['content_sha256',"repeat('b',64)"],['sealed_storage_key',quote(`${tenant}/retained/sealed.pdf`)],['sealed_sha256',"repeat('c',64)"]]){
    const doc=fresh();sql(`UPDATE paige_agreements SET ${column}=${value} WHERE id='${doc.id}';`);refused(add(doc.id,'retained@example.test'));
    check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE agreement_id='${doc.id}' AND email='retained@example.test'`)==='0','Partial retained evidence cannot accept another party');
  }
  const race=fresh(),raceTag='e04_signer_freeze_'+randomUUID().replaceAll('-','');
  const freezeSession=startSession(raceTag+'freeze',`BEGIN;UPDATE paige_agreements SET content_storage_key='${tenant}/${race.id}/reviewed.pdf',content_sha256=repeat('d',64) WHERE id='${race.id}';SELECT pg_sleep(1.5);COMMIT;`);
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(raceTag+'freeze')} AND wait_event='PgSleep');`);
  const refusedSession=startSession(raceTag+'add',context+`DO $proof$ BEGIN BEGIN PERFORM add_agreement_signer('${tenant}','${race.id}','Late signer','race@example.test','counterparty',NULL);RAISE EXCEPTION 'Expected frozen refusal';EXCEPTION WHEN SQLSTATE '23514' THEN NULL;END;END $proof$;SELECT 'refused';`);
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(raceTag+'add')} AND wait_event_type='Lock');`);checks++;
  await freezeSession;check(await refusedSession==='refused','Waiting add rechecks the committed frozen source');
  check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE agreement_id='${race.id}' AND email='race@example.test'`)==='0','Concurrent freeze refusal produces no ghost party');
  check(Number(sql(`SELECT version FROM paige_agreements WHERE id='${race.id}'`))===race.version,'Refused party change does not advance source');
  check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${race.id}' AND detail ? 'added_signer_order'`)==='0','Refused party change creates no success event');
  const retainedDefinition=sql("SELECT pg_get_functiondef('public.add_agreement_signer(uuid,uuid,text,text,text,integer)'::regprocedure);");
  sql(retainedDefinition.replace('BEGIN','BEGIN\n  -- A distinct later source change, in this disposable fixture only.'));
  assert.throws(()=>sql(read('supabase/migrations/20271113240004_agreement_signer_preparation_integrity.sql')),/Original signer writer changed; reconcile before applying/);checks++;
  sql(retainedDefinition);
  check(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.add_agreement_signer(uuid,uuid,text,text,text,integer)'::regprocedure;")==='f380cfa97f14e29c8b88721a76b9db4e','Source guard refuses a changed writer rather than overwriting it');

 }
 console.log(JSON.stringify({result:'PASS',checks,migrationReplay:mode==='repaired'?2:0,concurrentSessions:mode==='repaired'?5:3,observedLockWaits:mode==='repaired'?3:2,scope:'Original native signer preparation only; no actual JWT/signature/provider/customer acceptance'}));
}finally{await Promise.allSettled(sessions);database='postgres';sql(`DROP DATABASE ${fixture};`);}
