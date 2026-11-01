import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// The ORIGINAL disposable runner and actual SQL only; identity/schema/signing/provider
// ports remain synthetic. No hosted customer or provider acceptance is asserted.
export function proveActualFinancialLedger({run,read}){
 let checks=0;const check=(label,ok)=>{assert(ok,label);checks++;console.log('ACTUAL FINANCIAL LEDGER PASS '+label);};
 const value=q=>JSON.parse(run(q).split(/\r?\n/).find(l=>l.startsWith('{')));
 const fixture=JSON.parse(read('supabase/tests/fixtures/exp04_reviewed_commercial_native.sql').match(/\$e04_fixture\$([\s\S]*?)\$e04_fixture\$::jsonb/)[1]);
 const tenant=fixture.tenant_id,client=fixture.client_id,invoice=fixture.effective.invoice_id;
 const plain='ffffffff-ffff-4fff-8fff-ffffffffffff';
 const plainTenant=run("SELECT tenant_id FROM paige_invoices WHERE id='"+plain+"';");assert(/^[a-f0-9-]{36}$/.test(plainTenant));
 const meta=()=>run("SELECT ((to_jsonb(p)-'prosrc'-'proargdefaults')||jsonb_build_object('defaults',pg_get_expr(proargdefaults,0)))::text FROM pg_proc p WHERE oid='public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb)'::regprocedure;");
 const call=(id=invoice,version='3',limit=100,cursor=null,before='',scopeTenant=tenant)=>value((before?'BEGIN;':'')+"SET request.headers='"+JSON.stringify(version===null?{}:{'x-paige-invoice-evidence-version':version})+"';"+before+
  "SELECT public._sales_invoice_payment_ledger('"+scopeTenant+"','"+id+"',"+limit+","+(cursor?"'"+JSON.stringify(cursor)+"'::jsonb":"NULL")+");"+(before?'ROLLBACK;':''));
 const deployedDefinition=run("SELECT pg_get_functiondef('public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb)'::regprocedure);");
 const deployedHash=run("SELECT md5(prosrc) FROM pg_proc WHERE oid='public._sales_invoice_payment_ledger(uuid,uuid,integer,jsonb)'::regprocedure;");assert.equal(deployedHash,'327e4883b78725137137e1ad7349ba20','actual deployed original ledger source');
 const getterHash=run("SELECT md5(prosrc) FROM pg_proc WHERE oid='public._sales_invoice_read(uuid,uuid,integer)'::regprocedure;");
 const originalMetadata=meta(),oldPlain=call(plain,null,100,null,'',plainTenant);
 run(read('supabase/tests/fixtures/exp04_invoice_financial_ledger.sql'));
 // Reconstruct the earlier evidence2 prototype only within rollback; keep the
 // deployed three-argument reader unmodified for every actual adoption path.
 const oldPlain2=call(plain,'2',100,null,read('supabase/tests/fixtures/exp04_invoice_environment_read.sql'),plainTenant),oldAdjusted=call(invoice,'2');
 check('old ledger demonstrates gross remaining differs from current obligation',oldAdjusted.remaining_cents!==210000);
 assert.throws(()=>call(invoice,'3'),/representation unavailable/);check('old ledger cannot supply the new representation',true);
 const sql=read('supabase/tests/fixtures/exp04_invoice_actual_financial_ledger.sql');
 for(let i=0;i<2;i++)run('BEGIN;'+sql+'COMMIT;');
 check('same original ledger OID ABI flags defaults owner ACL settings survive',meta()===originalMetadata);
 assert.deepEqual(call(plain,null,100,null,'',plainTenant),oldPlain);check('whole accurate legacy default response is retained',true);
 assert.deepEqual(call(plain,'2',100,null,'',plainTenant),oldPlain2);check('whole accurate version2 response is retained',true);
 const current=call(),summary=current.financial_summary,canonical=value("SELECT _sales_invoice_read('"+tenant+"','"+invoice+"',0,3);").financial_summary;
 assert.deepEqual(summary,canonical);check('the existing ledger copies the SAME closed native financial summary',Object.keys(summary).length===13);
 check('actual outstanding refund and credit stay distinct from original allocation history',current.financial_evidence_version===3&&current.payment_evidence_version===2&&current.remaining_cents===210000&&summary.refund_payable_minor===15000&&summary.credit_minor===20000&&current.allocated_cents!==350000-current.remaining_cents);
 check('current projection never calls an adjusted obligation paid',current.settlement==='outstanding');
 assert.deepEqual(current.document,oldAdjusted.document);check('exact original issued document and digest survive',current.document_input_digest===oldAdjusted.document_input_digest);
 assert.deepEqual(current.payment_ledger,oldAdjusted.payment_ledger);check('whole immutable receipt history and running original positions survive',true);
 check('native financial identity binds the same invoice and version',summary.invoice_id===current.invoice_id&&summary.invoice_version===current.version&&summary.currency===current.currency);
 for(const version of [null,'2']){assert.throws(()=>call(invoice,version),/financial representation changed/);check('inaccurate old ledger representation refuses: '+version,true);}
 const heldId=run("SELECT id FROM paige_invoices WHERE tenant_id='"+tenant+"' AND invoice_number='INV-MISSING-ACCEPTED';");
 assert(/^[a-f0-9-]{36}$/.test(heldId));const held=call(heldId);
 check('missing accepted source remains a readable immutable record with unknown debt',held.financial_summary.standing==='allocation_required'&&held.remaining_cents===null&&held.settlement==='verification_pending');
 check('held record never fabricates refund or credit',held.financial_summary.refund_payable_minor===null&&held.financial_summary.credit_minor===null);
 const voided=call(invoice,'3',100,null,"UPDATE paige_invoices SET status='void' WHERE id='"+invoice+"';");
 check('void retains its original document and not-applicable financial status',voided.status==='void'&&voided.settlement==='void'&&voided.remaining_cents===null&&voided.financial_summary.standing==='not_applicable');
 const first=call(invoice,'3',1),second=call(invoice,'3',1,first.next_cursor);
 check('original ledger cursor continues unchanged source with one financial identity',first.has_more&&second.financial_summary.source_hash===first.financial_summary.source_hash&&second.document_input_digest===first.document_input_digest);
 for(const version of ['4',3]){assert.throws(()=>call(invoice,version),/representation unavailable/);check('unsupported/coerced ledger representation refuses: '+version,true);}
 for(const role of ['anon','authenticated','service_role']){
  assert.throws(()=>run("SET ROLE "+role+";SELECT public._sales_invoice_payment_ledger('"+tenant+"','"+invoice+"',1,NULL);"),/permission denied/);check('private helper gains no direct '+role+' access',meta()===originalMetadata);
 }
 function original(file,name){
  const all=read(file),m=new RegExp('CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public[.]'+name+'\\s*\\(','i').exec(all);assert(m);
  const rest=all.slice(m.index),tag=/\bAS\s+(\$[A-Za-z0-9_]*\$)/i.exec(rest);assert(tag);
  return rest.slice(0,rest.indexOf(tag[1],tag.index+tag[0].length)+tag[1].length)+';';
 }
 const owner=original('supabase/migrations/20270555000000_sales_invoice_payment_breakdown.sql','read_sales_invoice_payment_ledger');
 run(owner+"REVOKE ALL ON FUNCTION read_sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION read_sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) TO authenticated;");
 const ownerReply=value("SET ROLE authenticated;SET test.actor='"+fixture.actor_id+"';SET test.workspace='"+tenant+"';SET request.headers='{\"x-paige-invoice-evidence-version\":\"3\"}';SELECT read_sales_invoice_payment_ledger('"+tenant+"','"+invoice+"',100,NULL);");
 assert.deepEqual(ownerReply,current);check('original Owner public wrapper reads the same original ledger under identity port',true);
 const portal=original('supabase/migrations/20271110230000_e09_customer_portal_payments.sql','client_portal_invoice_ledger');
 run(portal+"REVOKE ALL ON FUNCTION client_portal_invoice_ledger(uuid,uuid,integer,jsonb) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION client_portal_invoice_ledger(uuid,uuid,integer,jsonb) TO authenticated,service_role;");
 const portalReply=value("SET test.e04_portal_client='"+client+"';SET request.headers='{\"x-paige-invoice-evidence-version\":\"3\"}';SELECT client_portal_invoice_ledger('"+invoice+"','"+tenant+"',100,NULL);");
 check('original client wrapper retains the same current financial and frozen document',portalReply.remaining_cents===current.remaining_cents&&portalReply.financial_summary.source_hash===summary.source_hash&&portalReply.document_input_digest===current.document_input_digest);
 check('original client minimizer still strips internal operation identity from history',portalReply.payment_ledger.rows.every(r=>!('provider_operation_id'in r)));
 const heldPayment=value("SET test.e04_portal_client='"+client+"';SET request.headers='{\"x-paige-invoice-evidence-version\":\"3\"}';SELECT client_portal_invoice_payment_request('"+heldId+"','"+tenant+"');");
 check('original current payment packet retains missing-source null debt/no request',heldPayment.invoice_id===heldId&&heldPayment.remaining_cents===null&&heldPayment.payment_request===null);
 // Existing typed55000 recovery, with no engine/authority change: the source
 // failure is injected ONLY inside rollback and original metadata must restore.
 const positionHash=run("SELECT md5(prosrc) FROM pg_proc WHERE oid='public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)'::regprocedure;");
 const unavailable=value(`BEGIN;
 CREATE OR REPLACE FUNCTION public._sales_invoice_financial_position_rows(_tenant uuid,_invoice uuid,_evidence_version integer,_proposal jsonb)
 RETURNS TABLE(invoice_id uuid,financial_position jsonb) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $e04_unavailable$
 BEGIN RAISE EXCEPTION 'Explicit synthetic source unavailable' USING ERRCODE='55000';END $e04_unavailable$;
 SET test.e04_portal_client='${client}';SET request.headers='{"x-paige-invoice-evidence-version":"3"}';
 SELECT jsonb_build_object('ledger',public._sales_invoice_payment_ledger('${tenant}','${invoice}',100,NULL),
  'page',public.client_portal_invoices_calendar_scoped('${tenant}','${client}',20,NULL),
  'payment',public.client_portal_invoice_payment_request('${invoice}','${tenant}'));
 ROLLBACK;`);
 check('existing unavailable-source recovery retains original document and receipt history',unavailable.ledger.financial_summary.standing==='unavailable'&&unavailable.ledger.remaining_cents===null&&JSON.stringify(unavailable.ledger.document)===JSON.stringify(current.document)&&JSON.stringify(unavailable.ledger.payment_ledger)===JSON.stringify(current.payment_ledger));
 check('the same unavailable source keeps original page and payment money unknown',unavailable.page.open_count===null&&unavailable.payment.remaining_cents===null&&unavailable.payment.payment_request===null);
 check('source failure injection restores the original engine byte-exactly',run("SELECT md5(prosrc) FROM pg_proc WHERE oid='public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)'::regprocedure;")===positionHash);
 for(const mutation of ["GRANT EXECUTE ON FUNCTION _sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) TO authenticated;","ALTER FUNCTION _sales_invoice_payment_ledger(uuid,uuid,integer,jsonb) SECURITY INVOKER;"]){
  assert.throws(()=>run('BEGIN;'+mutation+sql+'ROLLBACK;'),/source\/authority changed/);check('ledger adoption refuses private authority drift',true);
 }
 assert.deepEqual(call(),current);check('replay and rolled-back negatives preserve original ledger result',true);
 run(deployedDefinition);run(sql);assert.deepEqual(call(),current);check('direct adoption from independently verified deployed original source is exact',true);
 check('original three-argument historical getter stays byte-exact',run("SELECT md5(prosrc) FROM pg_proc WHERE oid='public._sales_invoice_read(uuid,uuid,integer)'::regprocedure;")===getterHash);

 // SAME public bearer endpoint, actual original token/invoice authority first.
 const publicMeta=()=>run("SELECT ((to_jsonb(p)-'prosrc'-'proargdefaults')||jsonb_build_object('defaults',pg_get_expr(proargdefaults,0)))::text FROM pg_proc p WHERE oid='public.read_public_sales_invoice_payment_request(text)'::regprocedure;");
 const bearerMeta=publicMeta(),plainToken='1'.repeat(64),currentToken='2'.repeat(64),heldToken='3'.repeat(64);
 assert.equal(run("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.read_public_sales_invoice_payment_request(text)'::regprocedure;"),'fa82176ce57fba9b1b9d82080ce07bc0');
 for(const [token,id,scopeTenant] of [[plainToken,plain,plainTenant],[currentToken,invoice,tenant],[heldToken,heldId,tenant]]){
  run("INSERT INTO paige_invoice_access_grants VALUES('"+token+"','"+scopeTenant+"','"+id+"',(SELECT billing_issued_snapshot_version FROM paige_invoices WHERE id='"+id+"'),NULL,now()+interval '1 hour');");
 }
 const publicCall=(token=currentToken,version='3',before='')=>{
  const out=run("BEGIN;SET request.headers='"+JSON.stringify(version===null?{}:{'x-paige-invoice-evidence-version':version})+"';"+before+"SET LOCAL ROLE service_role;SELECT coalesce(read_public_sales_invoice_payment_request('"+token+"')::text,'null');ROLLBACK;");
  return JSON.parse(out.split(/\r?\n/).find(l=>l.startsWith('{')||l==='null'));
 };
 const originalPublic=publicCall(plainToken,null),publicSql=read('supabase/tests/fixtures/exp04_invoice_actual_public_payment_read.sql');
 const oldPublic=publicCall();check('old public read lacks current marker and returns historical debt',oldPublic.financial_evidence_version===undefined&&oldPublic.remaining_cents!==summary.outstanding_minor);
 for(let i=0;i<2;i++)run('BEGIN;'+publicSql+'COMMIT;');
 check('public bearer OID ABI owner service-only ACL settings remain exact',publicMeta()===bearerMeta);
 for(const version of [null,'2']){assert.deepEqual(publicCall(plainToken,version),originalPublic);check('whole accurate public legacy reply remains exact: '+version,true);}
 const publicPayment=publicCall();
 assert.deepEqual(publicPayment.financial_summary,summary);check('public bearer copies the exact same current native summary',publicPayment.remaining_cents===summary.outstanding_minor&&publicPayment.invoice_id===invoice&&publicPayment.invoice_version===summary.invoice_version&&publicPayment.currency===summary.currency);
 check('public read exposes no raw token merchant operation or source context',!JSON.stringify(publicPayment).includes('merchant_account_id')&&!JSON.stringify(publicPayment).includes('provider_operation_id')&&!JSON.stringify(publicPayment).includes(currentToken)&&!JSON.stringify(publicPayment).includes('_native_sources'));
 const publicHeld=publicCall(heldToken);check('public missing-source read retains unknown debt and no payment request',publicHeld.remaining_cents===null&&publicHeld.payment_request===null&&publicHeld.financial_summary.standing==='allocation_required');
 for(const version of [null,'2']){assert.throws(()=>publicCall(currentToken,version),/financial representation changed/);check('public adjusted legacy debt refuses safely: '+version,true);}
 for(const version of ['4',3]){assert.throws(()=>publicCall(currentToken,version),/representation unavailable/);check('public unsupported or coerced representation refuses: '+version,true);}
 for(const [label,mutation] of [
  ['revoked',"UPDATE paige_invoice_access_grants SET revoked_at=now() WHERE token_hash='"+currentToken+"';"],
  ['expired',"UPDATE paige_invoice_access_grants SET expires_at=now()-interval '1 second' WHERE token_hash='"+currentToken+"';"],
  ['wrong snapshot',"UPDATE paige_invoice_access_grants SET issued_snapshot_version=999 WHERE token_hash='"+currentToken+"';"],
  ['foreign tenant',"UPDATE paige_invoice_access_grants SET tenant_id='"+plainTenant+"' WHERE token_hash='"+currentToken+"';"]
 ]){assert.equal(publicCall(currentToken,'invalid',mutation),null);check('original '+label+' bearer refuses BEFORE representation parsing',true);}
 assert.equal(publicCall('4'.repeat(64),'invalid'),null);check('unknown bearer refuses before header negotiation',true);
 for(const role of ['anon','authenticated']){assert.throws(()=>run("SET ROLE "+role+";SELECT read_public_sales_invoice_payment_request('"+currentToken+"');"),/permission denied/);check('original public bearer grants no '+role+' access',publicMeta()===bearerMeta);}
 assert.deepEqual(publicCall(),publicPayment);check('public negative controls roll back without changing the original current reply',true);
 const sourceContract=value("SELECT jsonb_build_object('functions',jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body_hash',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'result',pg_get_function_result(p.oid),'returns_set',p.proretset,'defaults',pg_get_expr(p.proargdefaults,0),'default_count',p.pronargdefaults,'argument_names',p.proargnames,'settings',p.proconfig,'acl',p.proacl::text) ORDER BY p.oid::regprocedure::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(ARRAY['_sales_provider_observation_time','_sales_provider_observation_balance','_sales_provider_observation_snapshot','_sales_provider_observation_entry','_sales_provider_observation_link_guard','read_sales_invoice_provider_observation_context','record_sales_invoice_provider_observation','_sales_provider_observation_work_payload','_sales_provider_observation_work_scope','register_sales_provider_observation_work','register_sales_provider_observation_event','claim_sales_provider_observation_work','read_sales_provider_observation_work_context','complete_sales_provider_observation_work','_sales_invoice_financial_position_rows','_sales_invoice_balance_rows','_sales_invoice_provider_disposition_command','_sales_invoice_provider_disposition_history','_sales_invoice_provider_disposition_review','_sales_invoice_provider_disposition_receipt','_sales_invoice_record_provider_disposition','_sales_invoice_accepted_obligations','_sales_invoice_prior_execute','_sales_invoice_collectible_balance','_sales_invoice_require_accepted_obligation','prepare_sales_invoice_payment_request','claim_sales_invoice_payment_request','allocate_verified_sales_invoice_payment','read_sales_invoice_payment_obligation','_sales_invoice_payment_request_mutation_guard','_sales_invoice_require_manual_allocations','_sales_invoice_prior_preview','_preview_sales_invoice_before_provider','read_sales_invoice_command_result','_sales_invoice_financial_read_version','_sales_invoice_read','read_sales_invoice','list_sales_invoices','read_sales_accepted_invoice_obligations','list_sales_collection_register','_client_portal_invoice_facts_for_client','client_portal_invoices_calendar_scoped','client_portal_invoice_payment_request','_sales_invoice_payment_projection','_sales_invoice_payment_ledger','read_public_sales_invoice_payment_request']);");
 return{proof:'E04_ACTUAL_FINANCIAL_LEDGER',status:'PASS',checks,sourceContract,samples:{current,portal:portalReply,held,heldPayment,voided,unavailable,publicPayment,publicHeld},source_hashes:Object.fromEntries(['scripts/sql/sales-actual-financial-ledger-proof.mjs','supabase/tests/fixtures/exp04_invoice_actual_financial_ledger.sql','supabase/tests/fixtures/exp04_invoice_actual_public_payment_read.sql'].map(f=>[f,createHash('sha256').update(read(f)).digest('hex')])),boundary:'Original ledger/public wrapper SQL and current financial engine, explicit synthetic schema/actor/signing/resolver/provider ports; owner execution. No original Auth, full managed schema, provider or customer acceptance.'};
}
