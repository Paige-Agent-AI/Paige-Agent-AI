import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
import {spawnSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {assembleFixedRepaymentSchedule} from '../../supabase/functions/_shared/sales-collections/model.ts';
import {FIXED_COLLECTION_TOTAL_REFUSAL} from '../../supabase/functions/_shared/sales-collections/amount-basis.ts';
const [binary,port,expectedDirectory,user='collections_proof']=process.argv.slice(2);
if(!binary||port!=='56347'||!expectedDirectory)throw Error('Explicit isolated cluster arguments required');
let database='postgres';
const run=sql=>{const r=spawnSync(binary,['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:sql,encoding:'utf8',maxBuffer:2e6});assert.equal(r.status,0,r.stderr);return r.stdout;};
assert.equal(run('SHOW data_directory;').trim().replaceAll('\\','/').toLowerCase(),expectedDirectory.replaceAll('\\','/').toLowerCase());
const name='commercial_create_'+randomUUID().replaceAll('-','');run(`CREATE DATABASE ${name};`);database=name;
const read=p=>readFileSync(root+p,'utf8');
const extract=(source,fn)=>{const start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+fn+'(');assert(start>=0,fn);const end=source.indexOf('END $$;',start);assert(end>start,fn);return source.slice(start,end+7);};
const actor='11111111-0000-4000-8000-000000000001',tenant='aaaaaaaa-0000-4000-8000-000000000001';
const command={action:'collection.create_commercial_terms',client_id:'c1111111-0000-4000-8000-000000000001',offer_id:'00000000-0000-4000-8000-0000000000f1',term_kind:'installment',agreed_amount_minor:350000,agreed_currency:'usd',billing_interval:'month',interval_count:1,installments_total:10,payment_schedule:'custom',starts_on:'2026-11-01',ends_on:null,title:null,notes:null};
const governance={actor_user_id:actor,tenant_id:tenant,action:command.action,tool:'sales_create_commercial_terms',approval_channel:'operator_card',decision_receipt_recorded:true,approved_fingerprint:'abcdef0123456789'};
const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const execute=(op,cmd=command,gov=governance)=>`SELECT public.execute_sales_collection_command('${actor}','${tenant}','${op}',${literal(cmd)},${literal(gov)});`;
const deny=(sql,state,prefix='')=>run(`DO $proof$ BEGIN ${prefix} BEGIN ${sql.replace(/^SELECT /,'PERFORM ')} EXCEPTION WHEN OTHERS THEN IF SQLSTATE='${state}' THEN RETURN;END IF;RAISE;END;RAISE EXCEPTION 'missing refusal'; END $proof$;`);
const concurrent=sql=>new Promise((resolve,reject)=>{const child=spawn(binary,['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-At'],{windowsHide:true});let output='',error='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>error+=v);child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(output.trim())):reject(Error(error)));child.stdin.end(sql);});
try {
 run(read('scripts/sales/_stub-schema.sql').replace('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;',()=>"DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon;END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated;END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role;END IF;END $$;"));
 run(`CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
 CREATE TABLE tenants(id uuid PRIMARY KEY,status text);CREATE TABLE profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
 CREATE TABLE tenant_members(tenant_id uuid,user_id uuid,status text,role text);
 INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO tenants VALUES('${tenant}','active');INSERT INTO profiles VALUES('${actor}','${tenant}');INSERT INTO tenant_members VALUES('${tenant}','${actor}','active','owner');
 CREATE TABLE paige_sales_collection_operations(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,actor_user_id uuid NOT NULL,command jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE paige_workspace_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,actor_id uuid,source_kind text,source_id uuid,source_revision bigint,outcome text,occurred_at timestamptz DEFAULT clock_timestamp(),actor_agent_slug text,actor_agent_label text,capability_key text,UNIQUE(tenant_id,source_kind,source_id,source_revision,outcome));
 CREATE TABLE paige_subagents(slug text,tenant_id uuid,rail_display_name text);CREATE SCHEMA realtime;CREATE FUNCTION realtime.send(jsonb,text,text,boolean) RETURNS void LANGUAGE sql AS 'SELECT';
 CREATE FUNCTION resolve_tool_autonomy(uuid,text) RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('proof.mode',true),''),'confirm')$$;`);
 const original=read('supabase/migrations/20261200000000_a_solo_owner_can_record_what_one_client_agreed_to.sql');
 const tableStart=original.indexOf('CREATE TABLE IF NOT EXISTS public.tenant_client_agreements (');
 const tableEnd=original.indexOf('\n);',tableStart);assert(tableStart>=0&&tableEnd>tableStart);
 run(`DROP TABLE tenant_client_agreements;ALTER TABLE clients ADD PRIMARY KEY(id);ALTER TABLE tenant_products ADD PRIMARY KEY(id);ALTER TABLE tenant_prices ADD PRIMARY KEY(id);`);
 run(original.slice(tableStart,tableEnd+4));
 run(`CREATE UNIQUE INDEX uq_tca_live_per_client_offer ON tenant_client_agreements(tenant_id,contact_id,offer_id) WHERE status IN ('active','paused');`);
 run(read('supabase/migrations/20270532100000_commercial_terms_refusals_reach_the_operator.sql'));
 run(read('supabase/migrations/20270586000000_sales_shared_commercial_writer.sql'));
 const lifecycle=read('supabase/migrations/20270543000000_sales_invoice_lifecycle.sql'),collections=read('supabase/migrations/20270547000000_sales_collections.sql');
 run(extract(lifecycle,'_sales_invoice_actor')+extract(lifecycle,'_sales_invoice_governance')+extract(collections,'read_sales_collection_command_result'));
 run(extract(collections,'_sales_collection_frozen')+"CREATE TRIGGER collection_operations_frozen BEFORE UPDATE OR DELETE ON paige_sales_collection_operations FOR EACH ROW EXECUTE FUNCTION _sales_collection_frozen();");
 const rail12=read('supabase/migrations/20261212000000_paige_can_show_her_work.sql'),rail20=read('supabase/migrations/20261220000000_an_act_that_landed_but_was_not_recorded.sql');
 run(extract(rail20,'_workspace_event_display')+extract(rail12,'_record_workspace_rail_event')+extract(rail20,'record_capability_run'));
 run(`CREATE TABLE paige_invoices(id uuid,tenant_id uuid,status text,billing_import_provenance jsonb,billing_import_version bigint,billing_lifecycle_version bigint,currency text,amount_total_cents integer);
 CREATE TABLE paige_invoice_payments(id uuid,tenant_id uuid,invoice_id uuid,kind text,amount_cents integer,currency text,method text,received_at timestamptz);
 CREATE TABLE paige_sales_import_batches(id uuid,tenant_id uuid,actor_user_id uuid,state text,content_digest text,source_account text,rows jsonb,review jsonb);
 CREATE TABLE paige_sales_import_bindings(tenant_id uuid,source_account text,entity text,entity_id text,invoice_id uuid,payment_id uuid);
 CREATE TABLE tenant_tool_autonomy(tenant_id uuid,tool_key text,mode text,updated_at timestamptz);
 CREATE FUNCTION is_platform_owner() RETURNS boolean LANGUAGE sql AS 'SELECT false';
 CREATE FUNCTION list_tool_autonomy(_tenant_id uuid DEFAULT NULL) RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz) LANGUAGE sql AS $$SELECT 'existing'::text,'Existing'::text,'Sales'::text,'confirm'::text,true,NULL::timestamptz$$;`);
 run(`ALTER TABLE clients ADD COLUMN first_name text,ADD COLUMN last_name text,ADD COLUMN entity_name text,ADD COLUMN entity_type text;ALTER TABLE tenant_products ADD COLUMN name text;UPDATE clients SET first_name='Client X';UPDATE tenant_products SET name='Advisory';`);run(extract(collections,'_sales_collection_client_name'));
 const sql=read('supabase/migrations/20270587000000_sales_governed_commercial_create.sql');run(sql);run(sql);
 assert.equal(run("SELECT has_function_privilege('service_role','public._create_sales_commercial_terms_command(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE');").trim(),'f');
 deny(execute(randomUUID(),command,{...governance,approved_fingerprint:'wrong'}),'42501');
 deny(execute(randomUUID(),command,{...governance,approval_channel:'standing_autonomy_setting',approved_fingerprint:null}),'42501',"PERFORM set_config('proof.mode','auto',true);");
 for(const change of [{starts_on:'1899-12-31'},{ends_on:'2026-10-31'},{agreed_amount_minor:2147483648},{interval_count:13},{installments_total:241},{actor_user_id:actor},{title:1},{title:' padded '},{notes:'   '}])deny(execute(randomUUID(),{...command,...change}),'22023');
 deny(execute(randomUUID(),{...command,starts_on:'2026-02-30'}),'22008');
 // Exercise normalized text through the actual writer and readback; rollback keeps count proofs stable.
 for(const fields of [{title:'Agreed terms',notes:'No discount'},{title:null,notes:null}]){
  const saved=JSON.parse(run('BEGIN;'+execute(randomUUID(),{...command,...fields})+'ROLLBACK;').trim().split(/\r?\n/).find(line=>line.startsWith('{')));
  assert.equal(saved.outcome,'commercial_terms_created');
 }
 const preview=JSON.parse(run(`SELECT preview_sales_collection_command('${actor}','${tenant}',${literal(command)});`).trim());
 assert.equal(preview.eligible,true);assert.equal(preview.consequence.amount_cents,350000);assert.equal(preview.consequence.record_owner,'commercial_collection_terms');
 assert.equal(run('SELECT count(*) FROM tenant_client_agreements;').trim(),'0');assert.equal(run('SELECT count(*) FROM paige_sales_collection_operations;').trim(),'0');
 const unavailable=JSON.parse(run(`SELECT preview_sales_collection_command('${actor}','${tenant}',${literal({...command,client_id:'ffffffff-0000-4000-8000-000000000001'})});`).trim());assert.equal(unavailable.eligible,false);
 const op=randomUUID(),first=JSON.parse(run(execute(op)).trim());assert.equal(first.outcome,'commercial_terms_created');assert.equal(first.row.amount_cents,350000);
 // Read the amount's meaning from the same commercial row and its immutable original operation.
 // No new financial writer, principal multiplication, approval or receipt source is introduced.
 run('ALTER TABLE tenant_client_agreements ADD COLUMN collection_terms jsonb,ADD COLUMN collection_terms_version integer NOT NULL DEFAULT 0;');
 const listStart=collections.indexOf('CREATE OR REPLACE FUNCTION public.list_sales_collection_agreements(');
 const listEnd=collections.indexOf('TO authenticated;',listStart)+'TO authenticated;'.length;
 assert(listStart>=0&&listEnd>listStart);run(collections.slice(listStart,listEnd));
 const routine="'public.list_sales_collection_agreements(uuid,integer,uuid)'::regprocedure";
 // psql uses platform line endings on Windows; normalize its textual transport only.
 const readDefinition=()=>run(`SELECT pg_get_functiondef(${routine});`).replaceAll('\r\n','\n').trim();
 const originalDefinition=readDefinition();
 const originalMetadata=run(`SELECT jsonb_build_object('security',prosecdef,'config',proconfig,'acl',proacl::text) FROM pg_proc WHERE oid=${routine};`).trim();
 assert(!JSON.parse(run(`SELECT list_sales_collection_agreements('${tenant}');`).trim()).rows[0].agreed_amount_basis,'original reader has no basis evidence');
 const basisMigration=read('supabase/migrations/20271120131104_sales_collection_amount_basis.sql');
 run(basisMigration);const appliedDefinition=readDefinition();run(basisMigration);
 assert.equal(readDefinition(),appliedDefinition,'read migration replays exactly');
 assert.equal(run(`SELECT jsonb_build_object('security',prosecdef,'config',proconfig,'acl',proacl::text) FROM pg_proc WHERE oid=${routine};`).trim(),originalMetadata,'original security/search path/ACL retained');
 const projection=basisMigration.match(/EXECUTE replace\(definition,\$projection\$([\s\S]*?)\$projection\$,\$projection\$([\s\S]*?)\$projection\$\)/);
 assert(projection);assert.equal(appliedDefinition.replace(projection[2],projection[1]),originalDefinition,'whole original reader inverse retains all other bytes');
 const list=`SELECT list_sales_collection_agreements('${tenant}');`;
 const readRow=(patch='',role='authenticated')=>{
  const output=run(`BEGIN;${patch}SET LOCAL ROLE ${role};${list}ROLLBACK;`);
  const page=JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('{')));
  assert.equal(page.rows.length,1);assert.equal(page.rows[0].id,first.row.id);
  return page.rows[0];
 };
 assert.equal(readRow().agreed_amount_basis,'total','governed negotiated installment is a fixed total');
 assert.equal(readRow().agreed_amount_minor,350000,'original principal is never multiplied');
 assert.equal(readRow().title,null,'a canonical newly recorded fixed agreement may legitimately have no title');
 assert.equal(readRow("UPDATE tenant_client_agreements SET term_kind='recurring';").agreed_amount_basis,'per_cycle');
 assert.equal(readRow("UPDATE tenant_client_agreements SET term_kind='one_time',installments_total=NULL,billing_interval=NULL;").agreed_amount_basis,'total');
 assert.equal(readRow("UPDATE tenant_client_agreements SET price_basis='catalog',catalog_price_snapshot_minor=350000,catalog_price_snapshot_currency='usd',catalog_price_snapshot_kind='installment',catalog_price_snapshot_at=now();").agreed_amount_basis,'per_installment');
 for(const patch of [
  "agreed_amount_minor=350001", "agreed_currency='eur'", "billing_interval='year'", "interval_count=2",
  'installments_total=11', "payment_schedule='on_start'", "starts_on='2026-11-02'", "ends_on='2027-12-01'",
  "term_kind='deposit'", "term_kind='custom_quote'",
 ])assert.equal(readRow('UPDATE tenant_client_agreements SET '+patch+';').agreed_amount_basis,'unverified','changed economic/source fact: '+patch);
 const otherClient=randomUUID(),otherOffer=randomUUID(),otherActor=randomUUID();
 assert.equal(readRow(`INSERT INTO clients(id,tenant_id) VALUES('${otherClient}','${tenant}');UPDATE tenant_client_agreements SET contact_id='${otherClient}';`).agreed_amount_basis,'unverified','changed original customer');
 assert.equal(readRow(`INSERT INTO tenant_products(id,tenant_id,name) VALUES('${otherOffer}','${tenant}','Other offer');UPDATE tenant_client_agreements SET offer_id='${otherOffer}';`).agreed_amount_basis,'unverified','changed original offer');
 assert.equal(readRow(`INSERT INTO auth.users(id) VALUES('${otherActor}');UPDATE tenant_client_agreements SET created_by='${otherActor}';`).agreed_amount_basis,'unverified','foreign creation actor');
 assert.equal(readRow("UPDATE tenant_client_agreements SET title='Corrected label',notes='Internal note';").agreed_amount_basis,'total','non-economic correction does not erase original total evidence');
 const legacy=randomUUID();
 const legacyRow=`INSERT INTO tenant_client_agreements(id,tenant_id,contact_id,offer_id,status,term_kind,price_basis,agreed_amount_minor,agreed_currency,billing_interval,interval_count,installments_total,payment_schedule,starts_on,created_by)
  SELECT '${legacy}',tenant_id,contact_id,offer_id,status,term_kind,price_basis,agreed_amount_minor,agreed_currency,billing_interval,interval_count,installments_total,payment_schedule,starts_on,created_by FROM tenant_client_agreements WHERE id='${first.row.id}';`;
 const legacyOutput=run(`BEGIN;${legacyRow}SET LOCAL ROLE authenticated;${list}ROLLBACK;`);
 const legacyPage=JSON.parse(legacyOutput.split(/\r?\n/).find(line=>line.startsWith('{')));
 assert.equal(legacyPage.rows.find(row=>row.id===legacy).agreed_amount_basis,'unverified','legacy negotiated installment is not inferred from the same amount');
 const foreignTenant='bbbbbbbb-0000-4000-8000-000000000001';
 const forgedForeignOperation=`INSERT INTO paige_sales_collection_operations(id,tenant_id,actor_user_id,command,result)
  SELECT '${randomUUID()}','${foreignTenant}',actor_user_id,command,jsonb_set(result,'{row,id}',to_jsonb('${legacy}'::text)) FROM paige_sales_collection_operations WHERE id='${op}';`;
 const foreignOutput=run(`BEGIN;${legacyRow}${forgedForeignOperation}SET LOCAL ROLE authenticated;${list}ROLLBACK;`);
 assert.equal(JSON.parse(foreignOutput.split(/\r?\n/).find(line=>line.startsWith('{'))).rows.find(row=>row.id===legacy).agreed_amount_basis,'unverified','another tenant operation never establishes this total');
 deny(`SELECT list_sales_collection_agreements('${foreignTenant}');`,'42501');
 for(const role of ['anon','service_role'])deny(list,'42501',`SET LOCAL ROLE ${role};`);
 deny(list,'42501',"UPDATE tenant_members SET status='revoked'; SET LOCAL ROLE authenticated;");
 run("UPDATE tenant_members SET status='active';");
 // A future concurrent reader change must cause a guarded migration refusal, not be overwritten.
 const changedDefinition=appliedDefinition.replace('DECLARE rows jsonb;','DECLARE rows jsonb; -- concurrent source change\n');
 assert.notEqual(changedDefinition,appliedDefinition);
 assert.throws(()=>run('BEGIN;'+changedDefinition+';'+basisMigration),/Collections agreement reader changed/);
 assert.equal(readDefinition(),appliedDefinition,'guarded refusal rolled back the test change');
 process.stdout.write('PASS amount basis: original whole-reader inverse/ACL and exact replay; governed fixed total, per-cycle and per-installment distinctions; ambiguous legacy, changed economics, foreign provenance, revoked role and source-drift refusals. No new obligations or financial effects.\n');
 // C60: the existing native execution rechecks its preview after locking the original agreement.
 // Install the ORIGINAL accepted-record validators on their original empty table definitions.
 // Positive signing/effectuation continuity belongs to the full fenced document runner;
 // this commercial runner must not stand in a fake accepted=true helper.
 run('CREATE TABLE tenant_agreement_versions(id uuid PRIMARY KEY);');
 const agreementRecords=read('supabase/migrations/20270401000000_agreements_engine_records.sql');
 for(const table of ['paige_agreements','paige_agreement_signers','paige_agreement_events']){
  const from=agreementRecords.indexOf('CREATE TABLE IF NOT EXISTS public.'+table+' ('),to=agreementRecords.indexOf('\n);',from);
  assert(from>=0&&to>from,table);run(agreementRecords.slice(from,to+4));
 }
 run('ALTER TABLE paige_agreements ADD COLUMN commercial_presentation jsonb,ADD COLUMN presented_body_markdown text;ALTER TABLE tenant_client_agreements ADD COLUMN effective_signing_id uuid,ADD COLUMN effective_terms_version bigint,ADD COLUMN effective_at timestamptz,ADD COLUMN effective_operation_id uuid,ADD COLUMN effective_source_digest text;ALTER TABLE paige_workspace_events ADD COLUMN detail jsonb;');
 run(extract(read('supabase/migrations/20271113230004_agreement_commercial_presentation.sql'),'_paige_commercial_canonical_json'));
 const acceptedSource=read('supabase/migrations/20271113810004_e04_accepted_commercial_evidence.sql');
 run(extract(acceptedSource,'_paige_retained_commercial_payload')+extract(acceptedSource,'_paige_accepted_commercial_payload'));
 for(const signature of ['_paige_commercial_canonical_json(jsonb)','_paige_retained_commercial_payload(public.paige_agreements)','_paige_accepted_commercial_payload(public.paige_agreements)'])run(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC,anon,authenticated,service_role;`);
 run(extract(collections,'_sales_collection_validate_terms'));
 const effective=read('supabase/migrations/20271113820004_e04_exact_signed_terms.sql');
 const routerStart=effective.indexOf('DO $$',effective.indexOf('-- Extend the installed command router'));
 const routerEnd=effective.indexOf('END $$;',routerStart)+7;
 assert(routerStart>=0&&routerEnd>routerStart);run(effective.slice(routerStart,routerEnd));
 assert.equal(run("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.preview_sales_collection_command(uuid,uuid,jsonb)'::regprocedure;").trim(),'9ccde31a3199fefc4aac2afbd9547fc0','actual current canonical preview');
 const fixed=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-11-01',installment_cents:30000,first_installment_date:'2026-12-01',cadence:'monthly'});
 assert.equal(fixed.state,'ready');
 const finite={action:'collection.save_terms',agreement_id:first.row.id,expected_version:0,terms:fixed.terms};
 const previewFinite=(value=finite)=>`SELECT preview_sales_collection_command('${actor}','${tenant}',${literal(value)});`;
 const readPreview=(prefix='',value=finite)=>JSON.parse(run('BEGIN;'+prefix+previewFinite(value)+'ROLLBACK;').split(/\r?\n/).find(line=>line.startsWith('{')));
 const sourceGuard=read('supabase/migrations/20271120131204_sales_collection_fixed_source_guard.sql');
 const commandRoutine="'public.preview_sales_collection_command(uuid,uuid,jsonb)'::regprocedure";
 const executeRoutine="'public.execute_sales_collection_command(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure";
 const definitionOf=identity=>run(`SELECT pg_get_functiondef(${identity});`).replaceAll('\r\n','\n').trim();
 const priorPreview=definitionOf(commandRoutine),priorReader=readDefinition(),priorExecute=definitionOf(executeRoutine);
 const metadataOf=identity=>run(`SELECT jsonb_build_object('security',prosecdef,'config',proconfig,'acl',proacl::text) FROM pg_proc WHERE oid=${identity};`).trim();
 const previewMetadata=metadataOf(commandRoutine);
 run(sourceGuard);const guardedPreview=definitionOf(commandRoutine),guardedReader=readDefinition();run(sourceGuard);
 assert.equal(definitionOf(commandRoutine),guardedPreview,'write guard replays exactly');
 assert.equal(readDefinition(),guardedReader,'shared basis read replays exactly');
 assert.equal(metadataOf(commandRoutine),previewMetadata,'original preview authority metadata is preserved');
 assert.equal(definitionOf(executeRoutine),priorExecute,'whole original executor remains byte-identical');
 assert.equal(run(`SELECT md5(prosrc) FROM pg_proc WHERE oid=${executeRoutine};`).trim(),'4a25621d37c0b292aa3b38d5b7f055f2','actual current original executor');
 const helperIdentity="'public._sales_collection_amount_basis(public.tenant_client_agreements)'::regprocedure";
 for(const signature of ['_paige_commercial_canonical_json(jsonb)','_paige_retained_commercial_payload(public.paige_agreements)','_paige_accepted_commercial_payload(public.paige_agreements)']){
  const identity=`'public.${signature}'::regprocedure`,before=definitionOf(identity);
  const drift=before.replace('\nBEGIN','\nBEGIN /* synthetic accepted-validator source drift */');assert.notEqual(drift,before);
  assert.throws(()=>run('BEGIN;'+drift+';'+sourceGuard),/Original accepted commercial validator changed/);
  for(const change of [`ALTER FUNCTION public.${signature} SECURITY DEFINER;`,`ALTER FUNCTION public.${signature} SET search_path=public;`,`GRANT EXECUTE ON FUNCTION public.${signature} TO anon;`]){
   assert.throws(()=>run('BEGIN;'+change+sourceGuard),/Original accepted commercial validator changed/);
   assert.equal(definitionOf(identity),before,'accepted-validator source/authority drift rolls back');
  }
 }
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(run(`SELECT has_function_privilege('${role}',${helperIdentity},'EXECUTE');`).trim(),'f');
  deny('SELECT public._sales_collection_amount_basis(NULL::public.tenant_client_agreements);','42501',`SET LOCAL ROLE ${role};`);
 }
 const basisExpression=projection[2].slice(projection[2].indexOf("'agreed_amount_basis',")+"'agreed_amount_basis',".length,-1);
 assert.equal(guardedReader.replace('public._sales_collection_amount_basis(a)',basisExpression),priorReader,'only read-basis extraction changes the original reader');
 const originalSummary="    summary:='Save this client agreement collection schedule and agreed fee metadata. No invoice, accrual or charge is created.';";
 const sourcePatch=sourceGuard.match(/EXECUTE replace\(definition,\$before\$([\s\S]*?)\$before\$,\$after\$([\s\S]*?)\$after\$\)/g);
 assert.equal(sourcePatch.length,2);
 const previewPatch=sourcePatch[1].match(/\$before\$([\s\S]*?)\$before\$,\$after\$([\s\S]*?)\$after\$/);
 assert.equal(previewPatch[1],originalSummary);
 assert.equal(guardedPreview.replace(previewPatch[2],originalSummary),priorPreview,'all other preview branches and checks remain byte-identical');
 assert.equal(readPreview().eligible,true,'original negotiated fixed total remains eligible');
 for(const kind of ['deposit','custom_quote'])assert.equal(readRow(`UPDATE tenant_client_agreements SET term_kind='${kind}';`).agreed_amount_basis,'unverified','A different original creation kind cannot establish accepted total meaning');
 assert.equal(readPreview("UPDATE tenant_client_agreements SET term_kind='recurring';").eligible,false,'finite plan requires an original verified total at native revalidation');
 const saveGovernance={...governance,action:finite.action,tool:'sales_save_collection_terms'};
 const save=(operation=randomUUID(),value=finite)=>execute(operation,value,saveGovernance);
 for(const prefix of [
  "UPDATE tenant_client_agreements SET term_kind='recurring';",
  "UPDATE tenant_client_agreements SET price_basis='catalog',catalog_price_snapshot_minor=350000,catalog_price_snapshot_currency='usd',catalog_price_snapshot_kind='installment',catalog_price_snapshot_at=now();",
  'UPDATE tenant_client_agreements SET interval_count=2;',
  'UPDATE tenant_client_agreements SET installments_total=11;',
 ]){
  const preview=readPreview(prefix);assert.equal(preview.eligible,false);assert.equal(preview.summary,FIXED_COLLECTION_TOTAL_REFUSAL,'native and customer response use the same exact refusal vocabulary');
  deny(save(),'22023',prefix);
  run(`UPDATE tenant_client_agreements SET term_kind='installment',price_basis='negotiated',catalog_price_snapshot_minor=NULL,catalog_price_snapshot_currency=NULL,catalog_price_snapshot_kind=NULL,catalog_price_snapshot_at=NULL,interval_count=1,installments_total=10;`);
 }
 assert.equal(readPreview(legacyRow,{...finite,agreement_id:legacy}).eligible,false,'unverified legacy fixed meaning cannot be promoted by the new save');
 const saveId=randomUUID();
 const savedRows=run(`BEGIN;SET LOCAL ROLE service_role;${save(saveId)}RESET ROLE;UPDATE tenant_client_agreements SET term_kind='recurring';SET LOCAL ROLE service_role;${save(saveId)}RESET ROLE;SELECT jsonb_build_object('terms_version',(SELECT collection_terms_version FROM tenant_client_agreements WHERE id='${first.row.id}'),'operations',(SELECT count(*) FROM paige_sales_collection_operations),'receipts',(SELECT count(*) FROM paige_workspace_events));ROLLBACK;`).split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
 assert.deepEqual(savedRows[0],savedRows[1],'exact original operation replays one saved result');
 assert.equal(savedRows[0].row.collection_terms_version,1);assert.equal(savedRows[0].row.collection_terms.dates.length,11);
 assert.deepEqual(savedRows[2],{terms_version:1,operations:2,receipts:2},'historical replay is not a second save or a current-source status claim');
 // The read of fixture counts above is through the local proof role only; production callers
 // inspect the writer's returned record and canonical scoped reads, never raw privileged tables.
 const recurring={...finite,terms:{...finite.terms,kind:'recurring',cadence:'monthly',count:null,dates:[],deposit_cents:null}};
 const recurringResult=JSON.parse(run("BEGIN;UPDATE tenant_client_agreements SET term_kind='recurring';"+save(randomUUID(),recurring)+'ROLLBACK;').split(/\r?\n/).find(line=>line.startsWith('{')));
 assert.equal(recurringResult.row.collection_terms.kind,'recurring','original recurring save path is preserved');
 deny(execute(randomUUID(),{...finite,agreed_amount_basis:'total'},saveGovernance),'22023');
 assert.equal(run(`SELECT collection_terms_version FROM tenant_client_agreements WHERE id='${first.row.id}';`).trim(),'0');
 assert.equal(run('SELECT count(*) FROM paige_sales_collection_operations;').trim(),'1');
 assert.equal(run('SELECT count(*) FROM paige_workspace_events;').trim(),'1');
 assert.throws(()=>run(`BEGIN;CREATE FUNCTION fail_terms_rail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected terms receipt failure' USING ERRCODE='55000';END $$;CREATE TRIGGER fail_terms_rail BEFORE INSERT ON paige_workspace_events FOR EACH ROW EXECUTE FUNCTION fail_terms_rail();${save()}`),/injected terms receipt failure/);
 assert.equal(run(`SELECT collection_terms_version FROM tenant_client_agreements WHERE id='${first.row.id}';`).trim(),'0','receipt failure rolls back the original save');
 // Two actual sessions: a new save waits for the existing source writer's row lock and must
 // validate the newly committed recurring meaning, rather than the earlier fixed preview.
 assert.equal(readPreview().eligible,true);
 const basisHolder=spawn(binary,['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-At'],{windowsHide:true});
 let basisOutput='',basisError='';
 const basisReady=new Promise((resolve,reject)=>{basisHolder.stdout.on('data',v=>{basisOutput+=v;if(basisOutput.includes('BASIS_SOURCE_LOCKED'))resolve();});basisHolder.stderr.on('data',v=>basisError+=v);basisHolder.on('error',reject);basisHolder.on('close',code=>{if(code!==0)reject(Error(basisError));});});
 const basisDone=new Promise((resolve,reject)=>{basisHolder.on('error',reject);basisHolder.on('close',code=>code===0?resolve():reject(Error(basisError)));});
 basisHolder.stdin.write(`BEGIN;UPDATE tenant_client_agreements SET term_kind='recurring' WHERE id='${first.row.id}';SELECT 'BASIS_SOURCE_LOCKED';\n`);
 await basisReady;
 const application='e04_basis_'+randomUUID();
 const queuedSave=concurrent(`SET application_name='${application}';SET ROLE service_role;${save()}`).then(()=>({ok:true}),error=>({ok:false,message:error.message}));
 let blocked=false;
 try{
  for(let attempt=0;attempt<150;attempt++){
   if(run(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${application}' AND wait_event_type='Lock';`).trim()==='1'){blocked=true;break;}
   await new Promise(resolve=>setTimeout(resolve,20));
  }
 }finally{basisHolder.stdin.end('COMMIT;\n');await basisDone;}
 assert(blocked,'new native save was observed waiting for the original source lock');
 const queuedResult=await queuedSave;assert.equal(queuedResult.ok,false);assert.match(queuedResult.message,/stale, unavailable or conflicted/);
 assert.equal(run(`SELECT collection_terms_version FROM tenant_client_agreements WHERE id='${first.row.id}';`).trim(),'0','source-change race cannot save stale finite terms');
 assert.equal(run('SELECT count(*) FROM paige_sales_collection_operations;').trim(),'1');
 assert.equal(run('SELECT count(*) FROM paige_workspace_events;').trim(),'1');
 run("UPDATE tenant_client_agreements SET term_kind='installment';");
 for(const [identity,find,replace] of [[commandRoutine,'DECLARE agreement','DECLARE agreement'],[routine,'DECLARE rows','DECLARE rows'],[helperIdentity,' SELECT CASE',' SELECT CASE'],[executeRoutine,'DECLARE action','DECLARE action']]){
  const before=definitionOf(identity),drift=before.replace(find,replace+' /* synthetic current-source drift */');assert.notEqual(before,drift);
  assert.throws(()=>run('BEGIN;'+drift+';'+sourceGuard),/Collections .*changed/);
  assert.equal(definitionOf(identity),before,'source-drift refusal preserves the original function');
 }
 assert.throws(()=>run(`BEGIN;GRANT EXECUTE ON FUNCTION public.preview_sales_collection_command(uuid,uuid,jsonb) TO authenticated;${sourceGuard}`),/Collections source or metadata changed/);
 assert.equal(metadataOf(commandRoutine),previewMetadata,'metadata drift is refused and rolled back');
 assert.throws(()=>run(`BEGIN;GRANT EXECUTE ON FUNCTION public.preview_sales_collection_command(uuid,uuid,jsonb) TO service_role WITH GRANT OPTION;${sourceGuard}`),/Collections source or metadata changed/);
 assert.equal(metadataOf(commandRoutine),previewMetadata,'unexpected delegated execute authority is refused and rolled back');
 for(const [signature,alteration] of [
  ['public._sales_collection_amount_basis(public.tenant_client_agreements)','VOLATILE'],
  ['public._sales_collection_amount_basis(public.tenant_client_agreements)','SECURITY DEFINER'],
  ['public._sales_collection_amount_basis(public.tenant_client_agreements)','SET search_path=pg_catalog'],
  ['public.preview_sales_collection_command(uuid,uuid,jsonb)','STABLE'],
  ['public.list_sales_collection_agreements(uuid,integer,uuid)','SECURITY INVOKER'],
  ['public.execute_sales_collection_command(uuid,uuid,uuid,jsonb,jsonb)','SECURITY INVOKER'],
 ]){
  const identity=`'${signature}'::regprocedure`,before=definitionOf(identity);
  assert.throws(()=>run(`BEGIN;ALTER FUNCTION ${signature} ${alteration};${sourceGuard}`),/Collections .*changed/);
  assert.equal(definitionOf(identity),before,'semantic authority metadata drift is rolled back');
 }
 process.stdout.write('PASS native fixed-source revalidation: one private invoker basis; original reader/preview inverses and whole executor/authority unchanged; fixed save/historical replay, recurring preservation, periodic/catalog/legacy/source-change refusal, actual source-lock race, receipt rollback and drift/ACL negatives.\n');
 assert.deepEqual(JSON.parse(run(execute(op)).trim()),first);
 assert.deepEqual(JSON.parse(run('SET ROLE service_role;'+execute(op)).trim().split(/\r?\n/).at(-1)),first);
 for(const role of ['anon','authenticated'])run(`SET ROLE ${role};DO $proof$ BEGIN BEGIN ${execute(randomUUID()).replace(/^SELECT /,'PERFORM ')} EXCEPTION WHEN OTHERS THEN IF SQLSTATE='42501' THEN RETURN;END IF;RAISE;END;RAISE EXCEPTION 'missing public ACL refusal';END $proof$;`);
 assert.equal(run('SELECT count(*) FROM tenant_client_agreements;').trim(),'1');assert.equal(run('SELECT count(*) FROM paige_sales_collection_operations;').trim(),'1');assert.equal(run('SELECT count(*) FROM paige_workspace_events;').trim(),'1');
 deny('UPDATE paige_sales_collection_operations SET command=command;', '42501');
 deny(execute(op,{...command,agreed_amount_minor:350001}),'22023');
 deny("DELETE FROM clients WHERE id='"+command.client_id+"';",'23503');
 deny("DELETE FROM tenant_products WHERE id='"+command.offer_id+"';",'23503');
 deny(execute(randomUUID()),'42501',"PERFORM set_config('proof.mode','off',true);");
 run("UPDATE tenant_members SET status='revoked';");deny(execute(randomUUID()),'42501');run("UPDATE tenant_members SET status='active';");
 deny(execute(randomUUID(),{...command,client_id:'ffffffff-0000-4000-8000-000000000001'}),'PA002');
 run("CREATE FUNCTION fail_rail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected receipt failure' USING ERRCODE='55000';END $$;CREATE TRIGGER fail_rail BEFORE INSERT ON paige_workspace_events FOR EACH ROW EXECUTE FUNCTION fail_rail();");
 deny(execute(randomUUID()),'55000');
 assert.equal(run('SELECT count(*) FROM tenant_client_agreements;').trim(),'1');assert.equal(run('SELECT count(*) FROM paige_sales_collection_operations;').trim(),'1');assert.equal(run('SELECT count(*) FROM paige_workspace_events;').trim(),'1');
 run('DROP TRIGGER fail_rail ON paige_workspace_events;');
 const raceId=randomUUID(),race=await Promise.all([concurrent(execute(raceId)),concurrent(execute(raceId))]);assert.deepEqual(race[0],race[1]);
 assert.equal(run('SELECT count(*) FROM tenant_client_agreements;').trim(),'2');assert.equal(run('SELECT count(*) FROM paige_sales_collection_operations;').trim(),'2');assert.equal(run('SELECT count(*) FROM paige_workspace_events;').trim(),'2');
 // Coordinate two actual sessions: the create transaction must prevent resource reparenting.
 const holder=spawn(binary,['-h','127.0.0.1','-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-At'],{windowsHide:true});
 let heldOutput='',heldError='';
 const held= new Promise((resolve,reject)=>{holder.stdout.on('data',v=>{heldOutput+=v;if(heldOutput.includes('commercial_terms_created'))resolve();});holder.stderr.on('data',v=>heldError+=v);holder.on('error',reject);holder.on('close',code=>{if(code!==0)reject(Error(heldError));});});
 const released=new Promise((resolve,reject)=>holder.on('close',code=>code===0?resolve():reject(Error(heldError))));
 holder.stdin.write('BEGIN;'+execute(randomUUID())+'\n');
 try {await held;
  deny("UPDATE clients SET tenant_id='ffffffff-0000-4000-8000-000000000001' WHERE id='"+command.client_id+"';",'55P03',"PERFORM set_config('lock_timeout','250ms',true);");
  deny("UPDATE tenant_products SET tenant_id='ffffffff-0000-4000-8000-000000000001' WHERE id='"+command.offer_id+"';",'55P03',"PERFORM set_config('lock_timeout','250ms',true);");
 } finally {holder.stdin.end('COMMIT;\n');await released;}
 assert.equal(run('SELECT count(*) FROM tenant_client_agreements;').trim(),'3');
 for(const role of ['anon','authenticated','service_role'])run(`SET ROLE ${role};DO $proof$ BEGIN BEGIN ${execute(randomUUID()).replace('public.execute_sales_collection_command','public._create_sales_commercial_terms_command').replace(/^SELECT /,'PERFORM ')} EXCEPTION WHEN OTHERS THEN IF SQLSTATE='42501' THEN RETURN;END IF;RAISE;END;RAISE EXCEPTION 'missing private ACL refusal';END $proof$;`);
 assert.equal(run("SELECT count(*) FROM list_tool_autonomy('aaaaaaaa-0000-4000-8000-000000000001') WHERE tool_key IN ('existing','sales_create_commercial_terms');").trim(),'2');
 console.log('PASS development canonical dispatch: canonical table CHECKs and foreign keys; real actor/governance/replay/Rail bodies; one commercial row/operation/Rail per successful identity, exact and competing concurrent replay, immutable operations, two-session client/offer ownership locks, private caller ACL, changed command and revoked role refused, injected Rail failure rolls back. Autonomy helper and approval stamp remain fixtures; hosted authority/capability binding UNVERIFIED.');
} finally {database='postgres';run(`DROP DATABASE ${name} WITH (FORCE);`);}
