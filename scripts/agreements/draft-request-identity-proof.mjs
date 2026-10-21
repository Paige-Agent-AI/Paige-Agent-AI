// Native synthetic PostgreSQL proof, reusing the agreements integrity runner's cluster.
// Auth helpers are declared fixture stand-ins, not JWT/production/customer acceptance.
import {readFileSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const [binary,port,user,expectedDirectory,mode]=process.argv.slice(2);
assert(binary && /^\d+$/.test(port??'') && user && expectedDirectory);
assert(['baseline','repaired'].includes(mode),'Explicit baseline/repaired mode required');
let db='postgres',checks=0;
const args=()=>['-h','127.0.0.1','-p',port,'-U',user,'-d',db,'-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>{
  const r=spawnSync(binary,args(),{input,encoding:'utf8',windowsHide:true,maxBuffer:8e6,timeout:30000});
  if(r.status!==0) throw new Error(r.stderr || String(r.error));
  return r.stdout.trim();
};
const check=(condition,message)=>{assert(condition,message);checks++;};
const normalize=s=>s.replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
assert.equal(normalize(sql('SHOW data_directory;')),normalize(expectedDirectory));
const fixture=`agreement_draft_${randomUUID().replaceAll('-','')}`;
sql(`CREATE DATABASE ${fixture};`);db=fixture;
const read=name=>readFileSync(new URL(`../../${name}`,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const tenant='aaaaaaaa-0000-4000-8000-000000000001',other='bbbbbbbb-0000-4000-8000-000000000002';
const actor='11111111-0000-4000-8000-000000000001',client='c1111111-0000-4000-8000-000000000001';
const context=(overrides={})=>{
  const c={actor,tenant,admin:true,role:'authenticated',...overrides};
  return `SET ROLE ${c.role}; SET test.uid='${c.actor??''}'; SET test.tenant='${c.tenant??''}'; SET test.admin='${c.admin}'; SET test.member='true'; `;
};
const oldCreate=()=>`create_agreement_signing('${tenant}','${client}',NULL,'Synthetic scope','paige_draft','Original synthetic scope',NULL)`;
const request=randomUUID();
const create=(key=request,overrides={})=>{
  const p={tenant:`'${tenant}'`,key:key?`'${key}'`:'NULL',client:`'${client}'`,title:"'Synthetic scope'",body:"'Original synthetic scope'",offer:'NULL',terms:'NULL',source:"'paige_draft'",version:'NULL',path:'NULL',...overrides};
  return `create_paige_agreement_draft_once(${Object.values(p).join(',')})`;
};
const refused=(statement,code='42501',who={})=>{
  sql(context(who)+`DO $proof$ BEGIN BEGIN ${statement}; RAISE EXCEPTION 'expected refusal ${code}'; EXCEPTION WHEN SQLSTATE '${code}' THEN NULL; END; END $proof$;`);
  checks++;
};
const children=new Set();
const concurrent=(input,onOutput=()=>{})=>new Promise((resolve,reject)=>{
  const child=spawn(binary,args(),{windowsHide:true,stdio:['pipe','pipe','pipe']});children.add(child);
  let output='',error='';
  const timer=setTimeout(()=>{child.kill();reject(new Error('Concurrent native request exceeded 30 seconds'));},30000);
  child.stdout.on('data',b=>{output+=b;onOutput(output);});child.stderr.on('data',b=>error+=b);
  child.on('error',e=>{clearTimeout(timer);children.delete(child);reject(e);});
  child.on('close',code=>{clearTimeout(timer);children.delete(child);code===0?resolve(output.trim()):reject(new Error(error));});
  child.stdin.end(input);
});

try {
  sql(read('scripts/agreements/_fixture-schema.sql'));
  sql(`ALTER TABLE tenant_client_agreements ADD COLUMN offer_id uuid REFERENCES tenant_products(id), ADD COLUMN catalog_price_id uuid;`);
  sql(read('supabase/migrations/20270401000000_agreements_engine_records.sql'));
  sql(read('supabase/migrations/20271020000310_sales_agreement_trigger_contracts.sql'));
  sql(read('supabase/migrations/20270404000000_agreement_signing_contract.sql'));
  sql(read('supabase/migrations/20270405000000_agreement_signer_seam.sql'));
  const currentSeed=read('supabase/migrations/20270519010000_contact_methods_dependents.sql');
  const start=currentSeed.indexOf('CREATE OR REPLACE FUNCTION public.seed_agreement_counterparty()');
  const end=currentSeed.indexOf('$function$;',start)+'$function$;'.length;
  assert(start>=0 && end>start);sql(currentSeed.slice(start,end));
  check(sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='public.save_paige_agreement(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,text,timestamptz)'::regprocedure;`)==='1bd28e75afa0f50bb07b717795a5be0e','Original production SAVE body is reproduced without rewriting it');

  if(mode==='baseline') {
    const a=JSON.parse(sql(context()+`SELECT ${oldCreate()};`));
    const b=JSON.parse(sql(context()+`SELECT ${oldCreate()};`));
    console.log(JSON.stringify({mode,first:a.signing_id,second:b.signing_id,rows:sql('SELECT count(*) FROM paige_agreements;'),signers:sql('SELECT count(*) FROM paige_agreement_signers;')}));
    check(a.signing_id===b.signing_id,'A retried creation request must recover one original draft; the legacy call duplicates it');
  } else {
    const migration=read('supabase/migrations/20271113120000_agreement_draft_request_identity.sql');
    sql(migration);sql(migration);
    const a=JSON.parse(sql(context()+`SELECT ${create()};`));
    const b=JSON.parse(sql(context()+`SELECT ${create()};`));
    const recover=(key=request,expected=tenant)=>`recover_paige_agreement_draft_creation('${expected}',${key?`'${key}'`:'NULL'})`;
    check(a.state==='created'&&b.state==='recovered'&&a.signing_id===b.signing_id,'Same request recovers original identity');
    check(a.creation_event_id===b.creation_event_id&&Object.keys(a).length===6,'Same original native event and explicit six-field receipt');
    check(sql('SELECT count(*) FROM paige_agreements;')==='1','One original agreement');
    check(sql('SELECT count(*) FROM paige_agreement_signers;')==='1','One counterparty from the actual current primary-address seed');
    check(sql('SELECT count(*) FROM paige_agreement_events;')==='1','Recovery creates no new activity');
    const id=a.signing_id;
    const readOne=(identifier=id,expected=tenant)=>`read_paige_agreement_preparation('${expected}','${identifier}')`;
    const dto=JSON.parse(sql(context()+`SELECT ${readOne()};`));
    check(dto.agreement.id===id&&dto.agreement.body_markdown==='Original synthetic scope'&&dto.agreement.can_edit===true,'Human reader returns real editable original record');
    check(dto.signers.length===1&&dto.signers[0].email==='a-client@example.com','Actual original signer, not input echo');
    check(Object.keys(dto).sort().join(',')==='agreement,signers'&&Object.keys(dto.agreement).sort().join(',')==='body_markdown,body_source,can_edit,commercial_terms_id,contact_id,content_sha256,has_source_document,id,offer_id,sealed_sha256,source_version_id,status,title,updated_at,version'&&Object.keys(dto.signers[0]).sort().join(',')==='declined_at,email,full_name,id,signed_at,signer_role,signing_order,status','Reader has exact closed human DTO shape');
    check(!/token|storage_key|ip_address|document_path|request_sha256/.test(JSON.stringify(dto)),'Reader excludes credentials, private object locators and request digests');
    check(sql('SELECT count(*) FROM paige_agreement_events;')==='1','Preparation read is not an activity write');
    const keyRecovery=JSON.parse(sql(context()+`SELECT ${recover()};`));
    check(keyRecovery.state==='recovered'&&keyRecovery.signing_id===id&&keyRecovery.creation_event_id===a.creation_event_id,'A fresh page recovers the original receipt using only its opaque request ID');
    const unknown=JSON.parse(sql(context()+`SELECT ${recover(randomUUID())};`));
    check(Object.keys(unknown).length===1&&unknown.state==='unconfirmed','Absent correlation is unconfirmed, never a rollback/new-create claim');
    check(JSON.parse(sql(context({actor:'22222222-0000-4000-8000-000000000002'})+`SELECT ${recover()};`)).state==='unconfirmed','Request read never exposes another author original');
    for(const who of [{tenant:other},{tenant:null},{actor:null},{admin:false}]) refused(`PERFORM ${recover()}`,'42501',who);
    refused(`PERFORM ${recover(request,other)}`);refused(`PERFORM ${recover(null)}`,'22023');
    check(sql('SELECT count(*) FROM paige_agreement_events;')==='1','Opaque request recovery writes no new event');

    // Every original creation input participates in the fingerprint; changed intent
    // cannot be hidden by an already-existing request key.
    for(const change of [{title:"'Changed'"},{body:"'Changed'"},{client:"'c2222222-0000-4000-8000-000000000002'"},{offer:`'${randomUUID()}'`},{terms:`'${randomUUID()}'`},
      {source:"'tenant_upload'",body:'NULL',path:`'${tenant}/uploaded.pdf'`},
      {source:"'tenant_template'",version:`'${randomUUID()}'`}]) refused(`PERFORM ${create(request,change)}`,'40001');
    refused(`PERFORM ${create()}`,'40001',{actor:'22222222-0000-4000-8000-000000000002'});
    for(const who of [{tenant:other},{tenant:null},{actor:null},{admin:false}]) {
      refused(`PERFORM ${create()}`,'42501',who);refused(`PERFORM ${readOne()}`,'42501',who);
    }
    refused(`PERFORM ${readOne(randomUUID())}`);
    refused(`PERFORM ${readOne(id,other)}`);
    refused(`PERFORM ${create(null)}`,'22023');
    refused(`PERFORM ${create(randomUUID(),{client:"'c2222222-0000-4000-8000-000000000002'"})}`);
    refused(`PERFORM ${create(randomUUID(),{title:"' '"})}`,'23514');
    refused(`PERFORM ${create(randomUUID(),{body:"' '"})}`,'23514');
    refused(`PERFORM ${create(randomUUID(),{source:'NULL'})}`,'22023');
    refused(`PERFORM ${create(randomUUID(),{source:"'tenant_template'"})}`,'22023');
    refused(`PERFORM ${create(randomUUID(),{version:`'${randomUUID()}'`})}`,'22023');
    refused(`PERFORM ${create(randomUUID(),{path:"'hidden.pdf'"})}`,'22023');
    for(const path of ["'foreign/upload.pdf'",`'${tenant}/../upload.pdf'`,`'${tenant}/' || chr(92) || 'upload.pdf'`,'NULL']) {
      refused(`PERFORM ${create(randomUUID(),{source:"'tenant_upload'",body:'NULL',path})}`);
    }
    refused(`PERFORM ${create(randomUUID(),{source:"'tenant_upload'",path:`'${tenant}/upload.pdf'`})}`,'22023');
    check(sql('SELECT count(*) FROM paige_agreements;')==='1','Rejected new/replayed inputs create nothing');

    // The paired metadata check must reject SQL NULL, not merely return UNKNOWN.
    for(const update of [`draft_creation_request_sha256=NULL`,`draft_creation_request_id=NULL`,`draft_creation_request_sha256=repeat('f',64)`,`created_by='${randomUUID()}'`]) {
      sql(`DO $proof$ BEGIN BEGIN UPDATE paige_agreements SET ${update} WHERE id='${id}'; RAISE EXCEPTION 'immutable request accepted'; EXCEPTION WHEN check_violation THEN NULL; END; END $proof$;`);checks++;
    }
    const edited=JSON.parse(sql(context()+`SELECT save_paige_agreement('${tenant}','${id}','${client}','Edited scope','Later revised scope',NULL,NULL,'paige_draft',NULL,NULL,'${a.updated_at}');`));
    check(edited.version===2&&edited.body_markdown==='Later revised scope','Original SAVE still edits using its real ID and revision/CAS');
    refused(`PERFORM save_paige_agreement('${tenant}','${id}','${client}','Stale edit','Stale body',NULL,NULL,'paige_draft',NULL,NULL,'${a.updated_at}')`,'40001');
    const recovered=JSON.parse(sql(context()+`SELECT ${create()};`));
    const reread=JSON.parse(sql(context()+`SELECT ${readOne()};`));
    check(recovered.state==='recovered'&&recovered.version===2&&recovered.updated_at===edited.updated_at&&reread.agreement.body_markdown==='Later revised scope','Recovery reads current metadata without overwriting later edits');
    sql(`UPDATE paige_agreements SET status='sent',content_sha256=repeat('a',64),content_storage_key='synthetic-only/approved.pdf',sent_at=now() WHERE id='${id}';`);
    const sent=JSON.parse(sql(context()+`SELECT ${create()};`));
    check(sent.signature_state==='sent'&&sent.signing_id===id,'Lost response can recover an already-sent original without returning to draft');
    const lateRecovery=JSON.parse(sql(context()+`SELECT ${recover()};`));
    check(lateRecovery.signature_state==='sent'&&lateRecovery.version===2&&lateRecovery.signing_id===id,'Later-page request read returns actual current sent revision');
    check(JSON.parse(sql(context()+`SELECT ${readOne()};`)).agreement.can_edit===false,'Frozen record is read-only');
    refused(`PERFORM save_paige_agreement('${tenant}','${id}','${client}','Rewrite sent','Unauthorized rewrite')`,'23514');
    check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${id}';`)==='2','Only native created+edited activity, no recovery or mock sending event');

    // Separate native sessions are started together; the first keeps its transaction
    // open so the second must wait on the same database request lock.
    const racingKey=randomUUID();
    const outputs=await Promise.allSettled([
      concurrent(context()+`BEGIN; SELECT ${create(racingKey)}; SELECT pg_sleep(0.4); COMMIT;`),
      concurrent(context()+`BEGIN; SELECT ${create(racingKey)}; COMMIT;`),
    ]);
    for(const out of outputs) if(out.status==='rejected') throw out.reason;
    const receipts=outputs.map(out=>JSON.parse(out.value));
    check(receipts[0].signing_id===receipts[1].signing_id&&receipts.map(r=>r.state).sort().join(',')==='created,recovered','Concurrent sessions produce one creator and one recovered identity');
    check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${receipts[0].signing_id}';`)==='1'&&sql(`SELECT count(*) FROM paige_agreement_signers WHERE agreement_id='${receipts[0].signing_id}';`)==='1','Concurrent requests retain one native event/signer');
    // Start a recovery statement WHILE its creator holds the native request lock.
    // After waiting it must read a fresh snapshot, not falsely report unconfirmed.
    const reconciliationKey=randomUUID();let markReady;
    const ready=new Promise(resolve=>markReady=resolve);
    const creator=concurrent(context()+`BEGIN; SELECT ${create(reconciliationKey)};\n\\echo E04_CREATOR_LOCK_HELD\nSELECT pg_sleep(4); SELECT 'COMMITTING='||clock_timestamp()::text; COMMIT;`,out=>{if(out.includes('E04_CREATOR_LOCK_HELD'))markReady();});
    await Promise.race([ready,creator.then(()=>{throw new Error('Creator exited before its lock fence');})]);
    const readWhileCreating=concurrent(context()+`SELECT jsonb_build_object('started_at',statement_timestamp(),'receipt',${recover(reconciliationKey)});`);
    const reconciliation=await Promise.allSettled([creator,readWhileCreating]);
    for(const out of reconciliation) if(out.status==='rejected')throw out.reason;
    const createdLine=reconciliation[0].value.split(/\r?\n/).find(line=>line.startsWith('{'));
    const committing=reconciliation[0].value.split(/\r?\n/).find(line=>line.startsWith('COMMITTING='))?.slice('COMMITTING='.length);
    const reading=JSON.parse(reconciliation[1].value),originalReceipt=JSON.parse(createdLine);
    check(Date.parse(reading.started_at)<Date.parse(committing),'Recovery statement truly began before original commit');
    check(reading.receipt.state==='recovered'&&reading.receipt.signing_id===originalReceipt.signing_id&&reading.receipt.creation_event_id===originalReceipt.creation_event_id,'Waiting recovery sees committed original receipt with a fresh snapshot');
    check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${originalReceipt.signing_id}';`)==='1','Concurrent reconciliation remains read-only');
    const intentional=JSON.parse(sql(context()+`SELECT ${create(randomUUID())};`));
    check(intentional.state==='created'&&intentional.signing_id!==id,'Deliberate separate request may create a separate agreement');
    // Existing caller and old NULL metadata stay compatible; NULL pairing is enforced
    // even before the immutable-on-update guard has an old request identity.
    const legacy=JSON.parse(sql(context()+`SELECT ${oldCreate()};`));
    check(legacy.signature_state==='draft','Legacy call remains available');
    for(const assignment of [`draft_creation_request_id='${randomUUID()}'`,`draft_creation_request_sha256=repeat('c',64)`]) {
      sql(`DO $proof$ BEGIN BEGIN UPDATE paige_agreements SET ${assignment} WHERE id='${legacy.signing_id}'; RAISE EXCEPTION 'unpaired metadata accepted'; EXCEPTION WHEN check_violation THEN NULL; END; END $proof$;`);checks++;
    }
    sql(`DO $proof$ BEGIN BEGIN UPDATE paige_agreements SET draft_creation_request_id='${randomUUID()}',draft_creation_request_sha256='invalid' WHERE id='${legacy.signing_id}'; RAISE EXCEPTION 'invalid digest accepted'; EXCEPTION WHEN check_violation THEN NULL; END; END $proof$;`);checks++;
    // Reuse legitimate templates/uploads and ordinary drafts without inventing a
    // signer address or claiming that a referenced object exists in Storage.
    const template=randomUUID(),foreignTemplate=randomUUID();
    sql(`INSERT INTO tenant_agreement_versions(id,tenant_id) VALUES('${template}','${tenant}'),('${foreignTemplate}','${other}');`);
    const templated=JSON.parse(sql(context()+`SELECT ${create(randomUUID(),{source:"'tenant_template'",version:`'${template}'`})};`));
    check(JSON.parse(sql(context()+`SELECT ${readOne(templated.signing_id)};`)).agreement.source_version_id===template,'Original template provenance is retained on the canonical row');
    refused(`PERFORM ${create(randomUUID(),{source:"'tenant_template'",version:`'${foreignTemplate}'`})}`);
    const uploaded=JSON.parse(sql(context()+`SELECT ${create(randomUUID(),{source:"'tenant_upload'",body:'NULL',path:`'${tenant}/synthetic-reference.pdf'`})};`));
    const uploadRead=JSON.parse(sql(context()+`SELECT ${readOne(uploaded.signing_id)};`));
    check(uploadRead.agreement.has_source_document===true&&uploadRead.agreement.body_markdown===null&&!JSON.stringify(uploadRead).includes('synthetic-reference.pdf'),'Upload reference is retained privately, not claimed to be a rendered/verified document');
    const noAddressClient=randomUUID();
    sql(`INSERT INTO clients(id,tenant_id) VALUES('${noAddressClient}','${tenant}');`);
    const noAddress=JSON.parse(sql(context()+`SELECT ${create(randomUUID(),{client:`'${noAddressClient}'`})};`));
    check(JSON.parse(sql(context()+`SELECT ${readOne(noAddress.signing_id)};`)).signers.length===0,'Missing email creates a draft without inventing a signer');
    refused(`PERFORM ${create(randomUUID(),{tenant:"'dddddddd-0000-4000-8000-000000000004'",client:"'c4444444-0000-4000-8000-000000000004'"})}`,'42501',{tenant:'dddddddd-0000-4000-8000-000000000004'});
    for(const signature of ['create_paige_agreement_draft_once(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,text)','read_paige_agreement_preparation(uuid,uuid)','recover_paige_agreement_draft_creation(uuid,uuid)']) {
      check(sql(`SELECT has_function_privilege('authenticated','public.${signature}','EXECUTE') AND NOT has_function_privilege('anon','public.${signature}','EXECUTE') AND NOT has_function_privilege('service_role','public.${signature}','EXECUTE');`)==='t','Exact authenticated-only callable ACL');
      check(sql(`SELECT NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.${signature}'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE');`)==='t','No PUBLIC execution grant');
    }
    refused(`PERFORM ${create()}`,'42501',{role:'anon'});refused(`PERFORM ${readOne()}`,'42501',{role:'anon'});
    refused(`PERFORM ${recover()}`,'42501',{role:'anon'});
    check(sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='public.save_paige_agreement(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,text,timestamptz)'::regprocedure;`)==='1bd28e75afa0f50bb07b717795a5be0e','Canonical SAVE unchanged after additive migration and calls');
    console.log(JSON.stringify({result:'PASS',checks,migrationReplay:2,concurrentSessions:4,scope:'Native synthetic original engine/trigger/roles; fixture auth helpers; no production/JWT/customer/provider acceptance'}));
  }
} finally {
  // Promise.allSettled above accounts for both native sessions before dropping.
  for(const child of children) child.kill();
  db='postgres';sql(`DROP DATABASE ${fixture};`);
}
