// Isolated canonical agreement/actor fixtures only. No customer login, signing or provider.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync,spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {prepareCommercialPresentation,canonicalPresentationJson} from '../../supabase/functions/_shared/agreements/commercial-presentation.ts';
import {assembleFixedRepaymentSchedule} from '../../supabase/functions/_shared/sales-collections/model.ts';
import {proveAcceptedCommercialRecord} from './accepted-commercial-proof.mjs';
import {proveEffectiveCommercialTerms} from './effective-commercial-proof.mjs';
import {proveEffectuationCatalogue} from './effectuation-catalogue-proof.mjs';
import {provePreparationCommercialSchema} from './preparation-commercial-proof.mjs';
const [psql,port,user,directory,mode]=process.argv.slice(2);
const contextIndex=process.argv.indexOf('--signing-context');
const contextMigration=contextIndex>=0?process.argv[contextIndex+1]:null;
const acceptedIndex=process.argv.indexOf('--accepted-record');
const acceptedMigration=acceptedIndex>=0?process.argv[acceptedIndex+1]:null;
const effectiveIndex=process.argv.indexOf('--effective-terms');
const effectiveMigration=effectiveIndex>=0?process.argv[effectiveIndex+1]:null;
const catalogueIndex=process.argv.indexOf('--effectuation-catalogue');
const catalogueMigration=catalogueIndex>=0?process.argv[catalogueIndex+1]:null;
const preparationIndex=process.argv.indexOf('--preparation-schema');
const preparationMigration=preparationIndex>=0?process.argv[preparationIndex+1]:null;
if(preparationIndex>=0)assert(preparationMigration&&effectiveMigration&&mode==='repaired');
if(catalogueIndex>=0)assert(catalogueMigration&&effectiveMigration&&mode==='repaired');
if(effectiveIndex>=0)assert(effectiveMigration&&acceptedMigration&&contextMigration&&mode==='repaired');
if(acceptedIndex>=0)assert(acceptedMigration&&contextMigration&&mode==='repaired');
if(contextIndex>=0)assert(contextMigration&&mode==='repaired');
assert(psql&&/^\d+$/.test(port??'')&&user&&directory&&['baseline','repaired'].includes(mode));
let database='postgres',checks=0,contextChecks=0;
const sql=(input)=>{const r=spawnSync(psql,['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input,encoding:'utf8',windowsHide:true,maxBuffer:8e6});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
const concurrent=async inputs=>{
  const results=await Promise.allSettled(inputs.map(input=>new Promise((resolve,reject)=>{assert(database.startsWith('commercial_presentation_'));const child=spawn(psql,['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{windowsHide:true});let out='',err='';child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)));child.stdin.end(input);})));
  // Wait for every owned connection before finally drops the unique database,
  // including when one participant fails. Never leave a sibling query behind.
  const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
  return results.map(result=>result.value);
};
const read=p=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const literal=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const text=value=>`'${value.replaceAll("'","''")}'`;
const digest=value=>createHash('sha256').update(value).digest('hex');
const normalize=p=>p.replaceAll('\\','/').toLowerCase().replace(/\/$/,'');
assert.equal(normalize(sql('SHOW data_directory;')),normalize(directory));
const own=`commercial_presentation_${randomUUID().replaceAll('-','')}`;
sql(`CREATE DATABASE ${own};`);database=own;
const tenant='aaaaaaaa-0000-4000-8000-000000000001',actor='11111111-0000-4000-8000-000000000001';
const client='c1111111-0000-4000-8000-000000000001',offer='44444444-0000-4000-8000-000000000001';
const termsId='55555555-0000-4000-8000-000000000001',invoiceId='66666666-0000-4000-8000-000000000001';
const scope=`SET test.uid='${actor}';SET test.tenant='${tenant}';SET test.admin='true';SET test.member='true';`;
try{
  sql(read('scripts/agreements/_fixture-schema.sql'));
  sql(`ALTER TABLE tenants ADD COLUMN status text DEFAULT 'active';
    CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
    CREATE TABLE tenant_members(user_id uuid,tenant_id uuid,status text,role text);
    ALTER TABLE tenant_client_agreements ADD COLUMN offer_id uuid,ADD COLUMN catalog_price_id uuid,ADD COLUMN status text DEFAULT 'draft',
      ADD COLUMN collection_terms jsonb,ADD COLUMN collection_terms_version bigint DEFAULT 1,ADD COLUMN installments_total integer,ADD COLUMN updated_at timestamptz DEFAULT now();
    INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO profiles VALUES('${actor}','${tenant}');
    INSERT INTO tenant_members VALUES('${actor}','${tenant}','active','owner');
    INSERT INTO tenant_products(id,tenant_id) VALUES('${offer}','${tenant}');
    CREATE TABLE paige_invoices(id uuid PRIMARY KEY,tenant_id uuid,contact_id uuid,status text,currency text,
      billing_lifecycle_version bigint,billing_draft_version bigint,billing_draft jsonb,updated_at timestamptz DEFAULT now());`);
  sql(read('supabase/migrations/20270401000000_agreements_engine_records.sql'));
  sql(read('supabase/migrations/20271020000310_sales_agreement_trigger_contracts.sql'));
  const actorSql=read('supabase/migrations/20270543000000_sales_invoice_lifecycle.sql');
  const start=actorSql.indexOf('CREATE OR REPLACE FUNCTION public._sales_invoice_actor('),end=actorSql.indexOf('\nCREATE OR REPLACE FUNCTION public._sales_invoice_read(',start);
  assert(start>=0&&end>start);sql(actorSql.slice(start,end));
  const conditionsSql=read('supabase/migrations/20270601000009_sales_commercial_conditions.sql');
  sql(conditionsSql.slice(0,conditionsSql.indexOf('-- Extend the ONE canonical writer.')));
  const schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-10-15',installment_cents:30000,first_installment_date:'2026-11-15',cadence:'monthly'});
  assert.equal(schedule.state,'ready');
  const treatment={state:'not_applicable',charges:[],source:'Synthetic owner decision',policy:'No applicable charge recorded'};
  const conditions={schema_version:1,tax:treatment,fees:treatment};
  sql(`INSERT INTO tenant_client_agreements(id,tenant_id,contact_id,offer_id,agreed_amount_minor,agreed_currency,term_kind,installments_total,collection_terms)
    VALUES('${termsId}','${tenant}','${client}','${offer}',350000,'USD','installment',10,${literal(schedule.terms)});`);
  const created=JSON.parse(sql(scope+`SELECT save_paige_agreement(_expected_tenant_id=>'${tenant}',_agreement_id=>NULL,_contact_id=>'${client}',_offer_id=>'${offer}',_commercial_terms_id=>'${termsId}',_title=>'Synthetic package',_body_markdown=>'Existing owner-authored service agreement.');`));
  const agreementId=created.id;assert(/^[0-9a-f-]{36}$/.test(agreementId));
  const draft={schema_version:3,total_minor:350000,agreement_snapshot:{id:agreementId,version:1},commercial_terms_reference:{id:termsId,version:1},commercial_conditions:conditions,
    items:[{unit_minor:350000,quantity:1,catalog_facts:{product_id:offer,price_id:'88888888-0000-4000-8000-000000000001',unit_minor:350000,currency:'usd'}}]};
  sql(`INSERT INTO paige_invoices(id,tenant_id,contact_id,status,currency,billing_lifecycle_version,billing_draft_version,billing_draft) VALUES('${invoiceId}','${tenant}','${client}','draft','usd',1,1,${literal(draft)});`);
  const stamps=JSON.parse(sql(`SELECT jsonb_build_object('agreement',a.updated_at,'terms',t.updated_at,'invoice',i.updated_at) FROM paige_agreements a,tenant_client_agreements t,paige_invoices i WHERE a.id='${agreementId}' AND t.id='${termsId}' AND i.id='${invoiceId}';`));
  const input={schema_version:1,source:{tenant_id:tenant,client_id:client,offer_id:offer,agreement_id:agreementId,agreement_version:1,agreement_updated_at:stamps.agreement,body_source:'paige_draft',status:'draft',content_sha256:null,
    terms_id:termsId,terms_version:1,terms_updated_at:stamps.terms,invoice_id:invoiceId,invoice_version:1,invoice_draft_version:1,invoice_updated_at:stamps.invoice},
    title:'Synthetic package',body_markdown:'Existing owner-authored service agreement.',principal_minor:350000,currency:'usd',collection_terms:schedule.terms,conditions,lines:[{unit_minor:350000,quantity:1}]};
  const prepared=await prepareCommercialPresentation(input);
  const presented=input.body_markdown+'\n\n'+prepared.appendix;
  const key=`${tenant}/${agreementId}/presented-commercial-fixture.pdf`,pdfHash='a'.repeat(64);
  if(mode==='repaired'){const migration=read('supabase/migrations/20271105101000_agreement_commercial_presentation.sql');sql(migration);sql(migration);}
  const call=(payload=prepared.payload,payloadDigest=prepared.payload_digest,who=actor,role='service_role')=>`SET ROLE ${role}; SELECT _freeze_paige_commercial_presentation('${who}','${tenant}',${literal(payload)},${text(payloadDigest)},${text(presented)},${text(digest(presented))},${text(key)},${text(pdfHash)});`;
  // Recomputed adversarial digests must fail source/semantic validation,
  // rather than merely failing the transport checksum.
  for(const [change,code] of [
    [p=>{p.source.status='completed'},/22023/],
    [p=>{p.source.content_sha256='a'.repeat(64)},/22023/],
    [p=>{p.source.body_source='tenant_upload'},/40001/],
    [p=>{p.source.client_id='bbbbbbbb-0000-4000-8000-000000000002'},/42501/],
    [p=>{p.source.agreement_version=2},/40001/],
    [p=>{p.source.terms_version=2},/40001/],
    [p=>{p.source.invoice_version=2},/40001/],
    [p=>{p.title='Changed title'},/40001/],
    [p=>{p.unknown_approval=true},/22023/],
    [p=>{delete p.source.invoice_updated_at},/22023/],
    [p=>{p.obligations[0].amount_cents++},/22023/],
    [p=>{p.obligations[0].due_date='2026-10-16'},/22023/],
    [p=>{p.obligations[1].sequence=1},/22023/],
    [p=>{p.obligations.push(p.obligations[0])},/22023/],
  ]){const bad=structuredClone(prepared.payload);change(bad);assert.throws(()=>sql(call(bad,digest(canonicalPresentationJson(bad)))),code);checks++;}
  assert.equal(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${agreementId}' AND detail->>'action'='commercial_presentation_frozen';`),'0');checks++;
  assert.equal(sql(`SELECT commercial_presentation IS NULL AND content_sha256 IS NULL FROM paige_agreements WHERE id='${agreementId}';`),'t');checks++;
  const result=JSON.parse(sql(call()));assert.equal(result.state,'frozen');checks++;
  // JSON escapes preserve database newlines through Windows psql's output translation.
  assert.equal(JSON.parse(sql(`SELECT to_json(body_markdown) FROM paige_agreements WHERE id='${agreementId}';`)),input.body_markdown);checks++;
  assert.equal(JSON.parse(sql(`SELECT to_json(presented_body_markdown) FROM paige_agreements WHERE id='${agreementId}';`)),presented);checks++;
  const repeated=JSON.parse(sql(call()));assert.equal(repeated.replayed,true);checks++;
  assert.equal(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${agreementId}' AND detail->>'action'='commercial_presentation_frozen';`),'1');checks++;
  for(const role of ['anon','authenticated']){assert.throws(()=>sql(call(prepared.payload,prepared.payload_digest,actor,role)),/42501/);checks++;}
  sql(`UPDATE profiles SET active_tenant_id='bbbbbbbb-0000-4000-8000-000000000002' WHERE user_id='${actor}';`);
  assert.throws(()=>sql(call()),/42501/);checks++;sql(`UPDATE profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';`);
  sql(`UPDATE tenant_members SET role='member' WHERE user_id='${actor}';`);assert.throws(()=>sql(call()),/42501/);checks++;
  sql(`UPDATE tenant_members SET role='admin' WHERE user_id='${actor}';`);assert.equal(JSON.parse(sql(call())).replayed,true);checks++;
  sql(`UPDATE tenant_client_agreements SET collection_terms_version=2 WHERE id='${termsId}';`);assert.throws(()=>sql(call()),/40001/);checks++;
  sql(`UPDATE tenant_client_agreements SET collection_terms_version=1 WHERE id='${termsId}';`);
  assert.throws(()=>sql(call(prepared.payload,'b'.repeat(64))),/22023|40001/);checks++;
  assert.throws(()=>sql(`UPDATE paige_agreements SET presented_body_markdown='Changed' WHERE id='${agreementId}';`),/23514/);checks++;
  assert.throws(()=>sql(`UPDATE paige_agreements SET commercial_presentation='{}'::jsonb WHERE id='${agreementId}';`),/23514/);checks++;
  assert.equal(sql(`SELECT commercial_presentation->>'payload_digest' FROM paige_agreements WHERE id='${agreementId}';`),prepared.payload_digest);checks++;
  if(contextMigration){
    const contextStart=checks;
    sql(read('supabase/migrations/20270407000000_agreement_view_tracking.sql'));
    sql(read('supabase/migrations/20271105100000_signing_context_unknown_economics.sql'));
    sql(read(contextMigration));sql(read(contextMigration));
    sql(`UPDATE paige_agreements SET status='sent',sent_at=now(),expires_at=now()+interval '1 day' WHERE id='${agreementId}';
      INSERT INTO paige_agreement_signers(agreement_id,tenant_id,full_name,email,signing_order,token_hash,token_expires_at)
      VALUES('${agreementId}','${tenant}','Synthetic Signer','signer@example.test',1,encode(digest(repeat('c',64),'sha256'),'hex'),now()+interval '1 day');`);
    const context=(token="repeat('c',64)",role='anon')=>JSON.parse(sql(`SET ROLE ${role};SELECT row_to_json(p) FROM public.peek_agreement_signing(${token}) p;`));
    const shown=context();assert.equal(shown.document_body,null);checks++;
    assert.equal(shown.document_path,'retained-document');checks++;
    assert.equal(shown.amount_minor,350000);checks++;assert.equal(shown.amount_currency,'usd');checks++;
    assert.equal(JSON.stringify(shown).includes(key),false);checks++;
    assert.equal(shown.is_valid,true);checks++;
    assert.equal(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${agreementId}' AND event_type='viewed';`),'1');checks++;
    context();assert.equal(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${agreementId}' AND event_type='viewed';`),'1');checks++;
    sql(`UPDATE tenant_client_agreements SET agreed_amount_minor=999900,collection_terms_version=2 WHERE id='${termsId}';`);
    assert.equal(context().amount_minor,350000);checks++;
    const absent=context("repeat('d',64)");assert.equal(absent.is_valid,false);checks++;assert.equal(absent.document_path,null);checks++;
    sql(`UPDATE paige_agreement_signers SET token_revoked_at=now() WHERE agreement_id='${agreementId}';`);
    assert.equal(context().is_valid,false);checks++;
    sql(`UPDATE paige_agreement_signers SET token_revoked_at=NULL,token_expires_at=now()-interval '1 second' WHERE agreement_id='${agreementId}';`);
    assert.equal(context().is_valid,false);checks++;
    sql(`UPDATE paige_agreement_signers SET token_expires_at=now()+interval '1 day' WHERE agreement_id='${agreementId}';
      UPDATE paige_agreements SET expires_at=now()-interval '1 second' WHERE id='${agreementId}';`);
    assert.equal(context().is_valid,false);checks++;
    assert.equal(sql(`SELECT has_function_privilege('anon','public.peek_agreement_signing(text)','EXECUTE') AND has_function_privilege('authenticated','public.peek_agreement_signing(text)','EXECUTE');`),'t');checks++;
    assert.equal(sql(`SELECT NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.peek_agreement_signing(text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE');`),'t');checks++;
    assert.equal(JSON.parse(sql(`SELECT to_json(body_markdown) FROM paige_agreements WHERE id='${agreementId}';`)),input.body_markdown);checks++;
    // Existing text-only contracts remain text, without invented economics.
    const legacyBody='Synthetic historical text-only agreement.';
    const legacy=JSON.parse(sql(scope+`SELECT save_paige_agreement(_expected_tenant_id=>'${tenant}',_agreement_id=>NULL,_contact_id=>'${client}',_title=>'Synthetic historical text',_body_markdown=>${text(legacyBody)});`));
    sql(`UPDATE paige_agreements SET status='sent',sent_at=now(),content_sha256=encode(digest(${text(legacyBody)},'sha256'),'hex'),expires_at=now()+interval '1 day' WHERE id='${legacy.id}';
      INSERT INTO paige_agreement_signers(agreement_id,tenant_id,full_name,email,signing_order,token_hash,token_expires_at)
      VALUES('${legacy.id}','${tenant}','Synthetic Historical Signer','historical@example.test',1,encode(digest(repeat('b',64),'sha256'),'hex'),now()+interval '1 day');`);
    const old=context("repeat('b',64)");assert.equal(old.document_body,legacyBody);checks++;
    assert.equal(old.document_path,null);checks++;assert.equal(old.amount_minor,null);checks++;
    // A historical frozen PDF keeps unknown economics and never exposes its key.
    sql(`UPDATE paige_agreements SET expires_at=now()+interval '1 day' WHERE id='${agreementId}';
      INSERT INTO paige_agreement_signers(agreement_id,tenant_id,full_name,email,signing_order,token_hash,token_expires_at)
      VALUES('${agreementId}','${tenant}','Synthetic Second Signer','second@example.test',2,encode(digest(repeat('e',64),'sha256'),'hex'),now()+interval '1 day');`);
    const original=JSON.parse(sql(`SELECT commercial_presentation FROM paige_agreements WHERE id='${agreementId}';`));
    // Privileged fault injection in this unique synthetic DB only; not an
    // ordinary-role write path or a production reproduction.
    const corrupt=value=>sql(`BEGIN;SET LOCAL session_replication_role=replica;
      UPDATE paige_agreements SET commercial_presentation=${value===null?'NULL':literal(value)} WHERE id='${agreementId}';COMMIT;`);
    for(const change of [
      value=>{value.payload_digest='b'.repeat(64);},
      value=>{value.payload.source.client_id='bbbbbbbb-0000-4000-8000-000000000002';value.payload_digest=digest(canonicalPresentationJson(value.payload));},
      value=>{value.payload.source.terms_version=99;value.payload_digest=digest(canonicalPresentationJson(value.payload));},
      value=>{value.document_sha256='b'.repeat(64);},
      value=>{value.presented_body_sha256='b'.repeat(64);},
      value=>{value.payload.principal_minor='350000';value.payload_digest=digest(canonicalPresentationJson(value.payload));},
    ]){
      const changed=structuredClone(original);change(changed);corrupt(changed);
      assert.equal(context("repeat('e',64)").is_valid,false);checks++;
      assert.equal(sql(`SELECT status FROM paige_agreement_signers WHERE agreement_id='${agreementId}' AND signing_order=2;`),'pending');checks++;
    }
    corrupt(null);const historical=context();assert.equal(historical.document_body,null);checks++;
    assert.equal(historical.document_path,'retained-document');checks++;assert.equal(historical.amount_minor,null);checks++;
    corrupt(original);assert.equal(context("repeat('e',64)").amount_minor,350000);checks++;
    assert.equal(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${agreementId}' AND event_type='viewed';`),'2');checks++;
    sql(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE paige_agreement_signers SET tenant_id='bbbbbbbb-0000-4000-8000-000000000002' WHERE agreement_id='${agreementId}' AND signing_order=2;COMMIT;`);
    assert.equal(context("repeat('e',64)").is_valid,false);checks++;
    sql(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE paige_agreement_signers SET tenant_id='${tenant}' WHERE agreement_id='${agreementId}' AND signing_order=2;COMMIT;`);
    assert.equal(context("repeat('e',64)").is_valid,true);checks++;
    contextChecks=checks-contextStart;
  }
  const acceptedChecks=acceptedMigration?await proveAcceptedCommercialRecord({sql,read,scope,tenant,actor,client,offer,termsId,invoiceId,agreementId,prepared,input,presented,migration:acceptedMigration}):0;
  const effectiveChecks=effectiveMigration?await proveEffectiveCommercialTerms({sql,concurrent,read,scope,tenant,actor,termsId,invoiceId,agreementId,prepared,migration:effectiveMigration}):0;
  const catalogue=catalogueMigration?proveEffectuationCatalogue({sql,read,scope,tenant,migration:catalogueMigration}):null;
  const preparation=preparationMigration?await provePreparationCommercialSchema({sql,concurrent,read,scope,tenant,actor,client,offer,termsId,invoiceId,agreementId,prepared,input,migration:preparationMigration}):null;
  console.log(JSON.stringify({result:'PASS',checks,contextChecks,acceptedChecks,effectiveChecks,catalogue,preparation,migrationReplay:2,scope:'Native synthetic service actor/canonical draft/freeze and optional signing/accepted/effective context; PDF hash fixture is not hosted upload, signature or provider acceptance'}));
}finally{database='postgres';sql(`DROP DATABASE ${own};`);}
