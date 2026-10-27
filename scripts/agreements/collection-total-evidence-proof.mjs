import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readAcceptedCollectionTotalEvidence,readCollectionAmountBasis,RECURRING_COLLECTION_AMOUNT_REFUSAL} from '../../supabase/functions/_shared/sales-collections/amount-basis.ts';

/** Extends the incumbent fenced native fixture only. No hosted account, consent,
 * real document, provider, privileged production caller or customer acceptance.
 */
export async function proveCollectionTotalEvidence({sql,read,tenant,actor,c}){
 let checks=0;const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
 const json=q=>JSON.parse(sql(q)),migration=read('supabase/migrations/20271118100304_sales_collection_total_evidence.sql');
 const reader='public.list_sales_collection_agreements(uuid,integer,uuid)',basis='public._sales_collection_amount_basis(public.tenant_client_agreements)',proof='public._sales_collection_accepted_total_evidence(public.tenant_client_agreements)';
 const definition=signature=>sql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`).replaceAll('\r\n','\n');
 const metadata=signature=>json(`SELECT jsonb_build_object('owner',proowner,'acl',proacl::text,'definer',prosecdef,'path',proconfig,'volatility',provolatile) FROM pg_proc WHERE oid='${signature}'::regprocedure;`);
 const previewSignature='public.preview_sales_collection_command(uuid,uuid,jsonb)',executor='public.execute_sales_collection_command(uuid,uuid,uuid,jsonb,jsonb)';
 const before={reader:definition(reader),basis:definition(basis),preview:definition(previewSignature),executor:definition(executor),readerMeta:metadata(reader),basisMeta:metadata(basis),previewMeta:metadata(previewSignature)};
 sql(migration);const after={reader:definition(reader),basis:definition(basis),proof:definition(proof)};sql(migration);
 equal(definition(reader),after.reader,'Evidence projection replays exactly');equal(definition(basis),after.basis,'One basis helper replays exactly');equal(definition(proof),after.proof,'Private evidence producer replays exactly');
 equal(metadata(reader),before.readerMeta,'Original reader authority metadata preserved');equal(metadata(basis),before.basisMeta,'Original private basis authority metadata preserved');
 const oldCycleGuard=migration.match(/original_cycle_guard CONSTANT text:=\$cycle_before\$([\s\S]*?)\$cycle_before\$/)[1],newCycleGuard=migration.match(/verified_cycle_guard CONSTANT text:=\$cycle_after\$([\s\S]*?)\$cycle_after\$/)[1];
 equal(definition(previewSignature).replace(newCycleGuard,oldCycleGuard),before.preview,'Whole original preview inverse retains every other branch/authority check');
 equal(metadata(previewSignature),before.previewMeta,'Original preview authority metadata preserved');equal(definition(executor),before.executor,'Whole original locked executor unchanged');
 const patches=[...migration.matchAll(/EXECUTE replace\(definition,\$before\$([\s\S]*?)\$before\$,\$after\$([\s\S]*?)\$after\$\)/g)];equal(patches.length,2,'Only original basis and read projection change');
 equal(after.basis.replace(patches[0][2],patches[0][1]),before.basis,'Whole basis inverse preserves all other meanings');
 equal(after.reader.replace(patches[1][2],patches[1][1]),before.reader,'Whole reader inverse preserves original scope/bounds/cursor');
 const oldQuery=patches[0][1].slice(patches[0][1].indexOf('EXISTS(')+7,patches[0][1].lastIndexOf(") THEN 'total'"));
 assert(after.proof.includes(oldQuery.slice('SELECT 1'.length)),'The original accepted/effectuation/operation/Rail predicate is reused unchanged');checks++;
 const row=(patch='')=>{
  const page=json(`BEGIN;SET LOCAL session_replication_role=replica;${patch}SET test.uid='${actor}';SET test.tenant='${tenant}';SET ROLE authenticated;SELECT list_sales_collection_agreements('${tenant}');ROLLBACK;`);
  const found=page.rows.find(v=>v.id===c.terms);assert(found);return found;
 };
 const original=row(),e=readAcceptedCollectionTotalEvidence(original),controlledRows={installment:original};
 assert(e);checks++;equal(e.commercial_terms_id,c.terms,'Proof belongs to this exact original commercial record');equal(e.signing_id,c.p.source.agreement_id,'Proof names the original accepted signing record');
 equal(readCollectionAmountBasis(original),'total','The original installment path remains usable');
 for(const kind of ['deposit','custom_quote']){
  const current=row(`UPDATE tenant_client_agreements SET term_kind='${kind}' WHERE id='${c.terms}';`);
  controlledRows[kind]=current;
  equal(current.agreed_amount_basis,'unverified','An older reader stays usable and gated for '+kind);
  assert(readAcceptedCollectionTotalEvidence(current));checks++;
  equal(readCollectionAmountBasis(current),'total','An upgraded reader needs matching original native proof for '+kind);
  equal(readCollectionAmountBasis({...current,agreed_amount_total_evidence:null}),'unverified','No evidence means no new eligibility');
  assert.throws(()=>readCollectionAmountBasis({...current,agreed_amount_basis:'total',agreed_amount_total_evidence:null}),/COLLECTION_AMOUNT_BASIS_UNVERIFIED/);checks++;
  const missing=row(`UPDATE tenant_client_agreements SET term_kind='${kind}',effective_signing_id=NULL,effective_operation_id=NULL,effective_source_digest=NULL,effective_terms_version=NULL,effective_at=NULL WHERE id='${c.terms}';`);
  equal(missing.agreed_amount_total_evidence,null,'Native missing provenance produces no evidence');equal(readCollectionAmountBasis(missing),'unverified','The current read cannot infer an accepted total');
  const regressed=row(`UPDATE tenant_client_agreements SET term_kind='${kind}',collection_terms_version=0 WHERE id='${c.terms}';`);
  equal(regressed.agreed_amount_total_evidence,null,'Native evidence refuses a current revision older than its accepted revision');
  equal(sql(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE tenant_client_agreements SET term_kind='${kind}',collection_terms_version=0 WHERE id='${c.terms}';SELECT _sales_collection_amount_basis(t) FROM tenant_client_agreements t WHERE id='${c.terms}';ROLLBACK;`),'unverified','Native writer basis independently refuses revision regression');
  assert.throws(()=>readCollectionAmountBasis({...current,agreed_amount_total_evidence:{...current.agreed_amount_total_evidence,client_id:'c2222222-0000-4000-8000-000000000002'}}),/COLLECTION_TOTAL_EVIDENCE_UNVERIFIED/);checks++;
  const command={action:'collection.save_terms',agreement_id:c.terms,expected_version:current.collection_terms_version,terms:current.collection_terms};
  const governance={actor_user_id:actor,tenant_id:tenant,tool:'sales_save_collection_terms',action:command.action,approval_channel:'operator_card',approved_fingerprint:'a'.repeat(16),decision_receipt_recorded:true};
  const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb",operation=randomUUID();
  const context=`SET test.uid='${actor}';SET test.tenant='${tenant}';SET test.admin='true';SET test.member='true';SET ROLE service_role;`;
  const preview=value=>`SELECT preview_sales_collection_command('${actor}','${tenant}',${literal(value)});`;
  const save=`SELECT execute_sales_collection_command('${actor}','${tenant}','${operation}',${literal(command)},${literal(governance)});`;
  const counts="SELECT jsonb_build_object('replication_role',current_setting('session_replication_role'),'operations',(SELECT count(*) FROM paige_sales_collection_operations),'receipts',(SELECT count(*) FROM paige_workspace_events),'invoices',(SELECT count(*) FROM paige_invoices),'payments',(SELECT count(*) FROM paige_invoice_payments),'signing_events',(SELECT count(*) FROM paige_agreement_events));";
  const beforeCounts=json(counts);
  equal(beforeCounts.replication_role,'origin','Original native execution starts with its integrity triggers enabled');
  const results=sql(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE tenant_client_agreements SET term_kind='${kind}' WHERE id='${c.terms}';SET LOCAL session_replication_role=origin;${context}${preview(command)}${save}${save}RESET ROLE;${counts}ROLLBACK;`).split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
  equal(results[0].eligible,true,'Original native preview re-reads the evidenced source for '+kind);
  equal(results[1].ok,true,'Original canonical save remains usable');equal(results[2],results[1],'Exact original operation replays without duplicate save');
  equal(results[1].row.collection_terms_version,current.collection_terms_version+1,'One approved native draft revision');
  equal(results[3],{...beforeCounts,operations:beforeCounts.operations+1,receipts:beforeCounts.receipts+1},'No invoice, payment or signing event is produced');
  equal(json(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE tenant_client_agreements SET term_kind='${kind}',effective_signing_id=NULL,effective_operation_id=NULL,effective_source_digest=NULL,effective_terms_version=NULL,effective_at=NULL WHERE id='${c.terms}';SET LOCAL session_replication_role=origin;${context}${preview(command)}ROLLBACK;`).eligible,false,'Previously read evidence cannot override missing current native provenance');
  assert.throws(()=>sql(context+preview({...command,agreed_amount_total_evidence:current.agreed_amount_total_evidence})),/22023:/);checks++;
 }
 const cycleTerms={...original.collection_terms,kind:'recurring',cadence:'monthly',count:null,dates:[],deposit_cents:null,end_date:null};
 const cycleCommand={action:'collection.save_terms',agreement_id:c.terms,expected_version:original.collection_terms_version,terms:cycleTerms};
 const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 const context=`SET test.uid='${actor}';SET test.tenant='${tenant}';SET test.admin='true';SET test.member='true';SET ROLE service_role;`;
 const cyclePreview=`SELECT preview_sales_collection_command('${actor}','${tenant}',${literal(cycleCommand)});`;
 const incompatible=json(context+cyclePreview);equal(incompatible.eligible,false,'A fixed principal cannot silently become a cycle price');equal(incompatible.summary,RECURRING_COLLECTION_AMOUNT_REFUSAL,'Exact known recurring refusal reaches the existing domain response');
 const cycleId=randomUUID(),governance={actor_user_id:actor,tenant_id:tenant,tool:'sales_save_collection_terms',action:cycleCommand.action,approval_channel:'operator_card',approved_fingerprint:'a'.repeat(16),decision_receipt_recorded:true};
 const cycleSave=`SELECT execute_sales_collection_command('${actor}','${tenant}','${cycleId}',${literal(cycleCommand)},${literal(governance)});`;
 assert.throws(()=>sql(context+cycleSave),/22023:/);checks++;
 const cycleResults=sql(`BEGIN;SET LOCAL session_replication_role=replica;UPDATE tenant_client_agreements SET term_kind='recurring' WHERE id='${c.terms}';SET LOCAL session_replication_role=origin;${context}${cyclePreview}${cycleSave}${cycleSave}RESET ROLE;SELECT jsonb_build_object('replication_role',current_setting('session_replication_role'),'collection_terms_version',(SELECT collection_terms_version FROM tenant_client_agreements WHERE id='${c.terms}'));ROLLBACK;`).split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
 equal(cycleResults[0].eligible,true,'Preserve legitimate original per-cycle recurring source');equal(cycleResults[1].ok,true,'Original recurring save remains usable');equal(cycleResults[2],cycleResults[1],'Recurring replay is one original operation');
 equal(cycleResults[3],{replication_role:'origin',collection_terms_version:original.collection_terms_version+1},'Recurring save advances once with original integrity triggers active');
 for(const role of ['anon','authenticated','service_role']){
  equal(sql(`SELECT has_function_privilege('${role}','${proof}','EXECUTE');`),'f','Evidence helper is not an authority RPC');
  assert.throws(()=>sql(`SET ROLE ${role};SELECT _sales_collection_accepted_total_evidence(NULL::public.tenant_client_agreements);`),/42501:/);checks++;
 }
 for(const signature of [reader,basis,proof,'public.preview_sales_collection_command(uuid,uuid,jsonb)','public.execute_sales_collection_command(uuid,uuid,uuid,jsonb,jsonb)',
  'public._paige_accepted_commercial_payload(public.paige_agreements)','public._paige_retained_commercial_payload(public.paige_agreements)','public._paige_commercial_canonical_json(jsonb)']){
  const prior=definition(signature),drift=prior.replace(/\nAS \$function\$/,'\nAS $function$\n/* synthetic evidence source drift */');assert.notEqual(drift,prior,signature);
  assert.throws(()=>sql('BEGIN;'+drift+';'+migration),/55000:/);checks++;
  assert.throws(()=>sql(`BEGIN;ALTER FUNCTION ${signature} SET search_path=pg_catalog;`+migration),/55000:/);checks++;
  equal(definition(signature),prior,'Rejected metadata/source drift rolls back');
 }
 if(process.argv.includes('--emit-collection-evidence'))console.log(JSON.stringify({checkpoint:'C61 actual controlled native read',rows:controlledRows}));
 return {checks,migrationReplay:2,scope:'Real original native read/private evidence validation; synthetic authority and document metadata, no hosted acceptance'};
}
