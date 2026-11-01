// Optional phase of the original owned provider proof. No cluster, provider,
// identity, permission or independent financial infrastructure is created here.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
export async function proveManualFinancial({run,read,execute,actor,tenant,client,invoice,otherTenant}){
 const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 const service=sql=>"SET ROLE service_role;SET test.actor='';"+sql;
 const value=sql=>JSON.parse(run(sql).split('\n').find(x=>x.startsWith('{')));
 let checks=0;const check=(label,ok)=>{assert.equal(ok,true,label);checks++;console.log('MANUAL FINANCIAL PASS '+label);};
 const original=(file,name)=>{const source=read(file),start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),tail=source.slice(start),m=/\bAS\s+(\$[a-zA-Z0-9_]*\$)/i.exec(tail);assert(start>=0&&m,name);return tail.slice(0,tail.indexOf(m[1],m.index+m[0].length)+m[1].length)+';';};
 const lifecycle='supabase/migrations/20270543000000_sales_invoice_lifecycle.sql',allocationFile='supabase/migrations/20271126080004_e04_original_manual_payment_allocations.sql';
 // Compose the ACTUAL published preview chain, including the retained schema3
 // publication predicate. Copying the old lifecycle preview over its wrappers
 // would discard working settings/breakdown/provider preparation behavior.
 const sources=[
  original(lifecycle,'preview_sales_invoice_command').replace('public.preview_sales_invoice_command(','public._sales_invoice_prior_preview(').replace("r.billing_draft->'schema_version'='2'::jsonb","r.billing_draft->'schema_version' IN ('2'::jsonb,'3'::jsonb)"),
  original('supabase/migrations/20270553000000_sales_invoice_preferences.sql','preview_sales_invoice_command').replace('public.preview_sales_invoice_command(','public._sales_invoice_preview_before_payment_breakdown('),
  original('supabase/migrations/20270555000000_sales_invoice_payment_breakdown.sql','preview_sales_invoice_command').replace('public.preview_sales_invoice_command(','public._preview_sales_invoice_before_provider('),
  original('supabase/tests/fixtures/exp04_invoice_actual_obligations.sql','_sales_invoice_prior_execute'),
  original(allocationFile,'_sales_invoice_require_manual_allocations'),
 ];
 for(const source of sources)run(source);
 for(const sig of ['_sales_invoice_prior_preview(uuid,uuid,jsonb)','_sales_invoice_preview_before_payment_breakdown(uuid,uuid,jsonb)','_preview_sales_invoice_before_provider(uuid,uuid,jsonb)','_sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)','_sales_invoice_require_manual_allocations(paige_invoices,jsonb)'])run('REVOKE ALL ON FUNCTION public.'+sig+' FROM PUBLIC,anon,authenticated,service_role;');
 const signatures=['_sales_invoice_prior_preview(uuid,uuid,jsonb)','_preview_sales_invoice_before_provider(uuid,uuid,jsonb)','_sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb)','_sales_invoice_require_manual_allocations(paige_invoices,jsonb)','read_sales_invoice_command_result(uuid,uuid,uuid,jsonb)'];
 const metadata=()=>run(`SELECT jsonb_agg(to_jsonb(x) ORDER BY oid) FROM(SELECT oid,proowner,proacl,prosecdef,proconfig,provolatile,proparallel,proisstrict,proleakproof,proargnames,proargtypes,proallargtypes,proargmodes,pronargdefaults,prorettype,proretset FROM pg_proc WHERE oid IN(${signatures.map(s=>`'public.${s}'::regprocedure`).join(',')}))x;`);
 const beforeMetadata=metadata(),candidate=read('supabase/tests/fixtures/exp04_invoice_manual_financial_write.sql');
 const plan=JSON.parse(read('supabase/tests/fixtures/exp04_reviewed_commercial_native.sql').match(/\$e04_fixture\$([\s\S]*?)\$e04_fixture\$::jsonb/)[1]);assert.match(plan.scope,/^Synthetic/);
 const p={actor:plan.actor_id,tenant:plan.tenant_id,client:plan.client_id,invoice:plan.effective.invoice_id};
 const version=id=>Number(run(`SELECT billing_lifecycle_version FROM paige_invoices WHERE id='${id}';`));
 const position=(t,id)=>value(`SELECT financial_position FROM _sales_invoice_financial_position_rows('${t}','${id}',3,NULL::jsonb);`);
 const target=sequence=>{const row=position(p.tenant,p.invoice).obligations.find(r=>r.reference.sequence===sequence);assert(row);return {reference:row.reference,source_digest:row.source_digest,due_date:row.due_date,scheduled_minor:row.scheduled_minor,remaining_minor:row.actual_outstanding_minor};};
 const governance=(a,t,action)=>({actor_user_id:a,tenant_id:t,action,tool:action==='invoice.record_manual_payment'?'sales_record_manual_payment':action==='invoice.reverse_manual_payment'?'sales_reverse_manual_payment':action==='invoice.payment_request'?'sales_create_payment_request':'sales_record_provider_disposition',approval_channel:'operator_card',approved_fingerprint:'0123456789abcdef',decision_receipt_recorded:true});
 const write=(a,t,id,command)=>service(`SELECT execute_sales_invoice_command('${a}','${t}','${id}',${literal(command)},${literal(governance(a,t,command.action))});`);
 const manual=(id,amount,obligation)=>({action:'invoice.record_manual_payment',invoice_id:id,expected_version:version(id),amount_cents:amount,currency:'usd',method:'bank_transfer',received_at:'2026-10-30T12:00:00Z',reference:'Synthetic received-payment report',notes:null,...(obligation?{allocations:[{obligation,amount_cents:amount}]}:{})});
 const snapshot=(t,id)=>run(`SELECT jsonb_build_object('invoice',(SELECT to_jsonb(i) FROM paige_invoices i WHERE i.id='${id}'),
  'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM paige_invoice_payments p WHERE p.invoice_id='${id}'),
  'journal',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM paige_invoice_operations o WHERE o.invoice_id='${id}'),
  'rail',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM paige_workspace_events e WHERE e.tenant_id='${t}'));`);
 const refused=(label,t,id,sql,pattern)=>{const before=snapshot(t,id);assert.throws(()=>run(sql),pattern,label);check(label,snapshot(t,id)===before);};
 const plain=randomUUID();run(`INSERT INTO paige_invoices SELECT(jsonb_populate_record(NULL::paige_invoices,to_jsonb(i)||jsonb_build_object('id','${plain}','invoice_number','INV-MANUAL-ACTUAL','billing_draft','{}'::jsonb,'status','issued','amount_total_cents',350000,'billing_lifecycle_version',2))).* FROM paige_invoices i WHERE i.id='${invoice}';`);
 const dropRail=id=>`CREATE FUNCTION pg_temp.e04_drop_manual_rail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL;END$$;
 CREATE TRIGGER e04_drop_manual_rail BEFORE INSERT ON paige_workspace_events FOR EACH ROW WHEN(NEW.source_id='${id}'::uuid AND NEW.capability_key='sales_record_manual_payment') EXECUTE FUNCTION pg_temp.e04_drop_manual_rail();`;
 // Capture the genuine original failure INSIDE a rolled-back local transaction.
 const oldId=randomUUID(),oldCommand=manual(plain,10000),oldState=snapshot(tenant,plain);
 const oldOutput=run('BEGIN;'+dropRail(oldId)+write(actor,tenant,oldId,oldCommand)+`RESET ROLE;SELECT count(*) FROM paige_workspace_events WHERE source_id='${oldId}';ROLLBACK;`);
 const oldResult=JSON.parse(oldOutput.split('\n').find(x=>x.startsWith('{')));
 const missingOriginalRail=oldResult.ok===true&&oldOutput.split(/\r?\n/).includes('0');
 assert.equal(missingOriginalRail,true,'original receipt-suppression counterexample must actually reproduce: '+oldOutput);assert.equal(snapshot(tenant,plain),oldState);
 console.log('MANUAL ORIGINAL RED: original success without Rail reproduced and rolled back; no customer or provider action.');
 // Real original request/claim/readback and observation, with synthetic provider facts.
 const payment=randomUUID(),token=randomUUID(),tag=payment.replaceAll('-',''),obligation=target(6),now=new Date(Date.now()-60000).toISOString();
 run(`UPDATE tenant_stripe_accounts SET sales_readback_at=clock_timestamp() WHERE tenant_id='${p.tenant}';`);
 const request={action:'invoice.payment_request',invoice_id:p.invoice,client_id:p.client,expected_version:version(p.invoice),issued_snapshot_version:1,provider:'stripe',merchant_account_id:'acct_fixturePlan',merchant_binding_version:3,environment:'live',amount_minor:obligation.remaining_minor,currency:'usd',purpose:'installment',obligation};
 const facts={provider:'stripe',merchant_account_id:'acct_fixturePlan',environment:'live',provider_object_id:'cs_'+tag,provider_transaction_id:'ch_'+tag,provider_settlement_id:'txn_'+tag,amount_minor:30000,currency:'usd',status:'verified',readback_reference:'req_'+tag,invoice_id:p.invoice,client_id:p.client,invoice_version:request.expected_version,issued_snapshot_version:1,provider_received_at:new Date(Date.now()-120000).toISOString()};
 run(service(`SELECT prepare_sales_invoice_payment_request('${p.actor}','${p.tenant}','${payment}',${literal(request)},${literal(governance(p.actor,p.tenant,request.action))});
 SELECT claim_sales_invoice_payment_request('${p.tenant}','${payment}','${token}');SELECT finalize_sales_invoice_payment_request('${p.tenant}','${payment}','${token}','customer_action_required','cs_${tag}','open','https://checkout.stripe.com/c/pay/cs_${tag}',NULL);
 SELECT allocate_verified_sales_invoice_payment('${p.tenant}','${payment}','${token}',${literal(facts)});`));
 const originalProviderReceipt=run(`SELECT to_jsonb(x) FROM paige_invoice_payments x WHERE provider_operation_id='${payment}';`);
 const context=()=>value(service(`SELECT read_sales_invoice_provider_observation_context('${p.tenant}','${payment}');`));
 const providerSnapshot={state:'observed',provider_transaction_id:'ch_'+tag,provider_settlement_id:'txn_'+tag,refunds:[{id:'re_'+tag,amount_minor:10000,currency:'usd',status:'succeeded',created_at:now,balance_transaction:{id:'txn_refund'+tag,amount_minor:-10000,currency:'usd',status:'available',created_at:now},failure_balance_transaction:null}],disputes:[]};
 const observe=s=>run(service(`SELECT record_sales_invoice_provider_observation('${p.tenant}','${payment}','${token}',${context().observation_version},${literal(s)},'evt_ManualActual');`));
 function decide(credit){const c=context(),prior=position(p.tenant,p.invoice).original_payment_decisions.find(r=>r.provider_operation_id===payment);const cmd={action:'invoice.record_provider_disposition',invoice_id:p.invoice,expected_version:version(p.invoice),provider_operation_id:payment,observation_id:c.observation_id,observation_version:c.observation_version,expected_disposition_version:prior.financial_decision.version,decision:credit?'credit_returned_principal':'balance_due',...(credit?{credit_minor:credit}:{}),reason:'Synthetic owner decision about original principal.'};
 const review=value(service(`SELECT preview_sales_invoice_command('${p.actor}','${p.tenant}',${literal(cmd)});`)).provider_disposition;
 return value(service(`SELECT execute_sales_invoice_command('${p.actor}','${p.tenant}','${randomUUID()}',${literal(cmd)},${literal({...governance(p.actor,p.tenant,cmd.action),approved_financial_review:review})});`));}
 observe(providerSnapshot);decide(0);
 const recordCommand=manual(p.invoice,10000,target(6));assert.equal(recordCommand.allocations[0].obligation.remaining_minor,10000);
 assert.throws(()=>run(write(p.actor,p.tenant,randomUUID(),recordCommand)),/Accepted payment allocation unavailable/);
 console.log('MANUAL ORIGINAL RED: actual refunded target rejected by original gross allocation; no receipt written.');
 run('BEGIN;'+candidate+'COMMIT;');run('BEGIN;'+candidate+'COMMIT;');
 check('all five original entry/helper metadata and OIDs are exact',metadata()===beforeMetadata);
 const preview=value(service(`SELECT preview_sales_invoice_command('${p.actor}','${p.tenant}',${literal(recordCommand)});`));
 console.log('MANUAL REVIEW OBSERVATION: '+JSON.stringify(preview));
 check('manual review uses current actual debt and separate refund without a projected legacy balance',preview.eligible===true&&preview.remaining_cents===220000&&preview.summary.includes('$2200.00')&&preview.summary.includes('$100.00')&&!preview.summary.includes('Outstanding after'));
 const receipt=randomUUID(),recorded=value(write(p.actor,p.tenant,receipt,recordCommand));
 check('actual original manual receipt satisfies its refunded target',recorded.ok===true&&position(p.tenant,p.invoice).actual_outstanding_minor===210000&&position(p.tenant,p.invoice).refund_payable_minor===10000&&target(6).remaining_minor===0);
 check('original manual operation has actual exact owner/action Rail',run(`SELECT count(*) FROM paige_workspace_events WHERE tenant_id='${p.tenant}' AND actor_id='${p.actor}' AND source_id='${receipt}' AND capability_key='sales_record_manual_payment' AND outcome='capability_succeeded';`)==='1');
 check('recovery returns the same original immutable result',JSON.stringify(value(write(p.actor,p.tenant,receipt,recordCommand)))===JSON.stringify(recorded));
 refused('missing original Rail cannot replay a human receipt',p.tenant,p.invoice,`BEGIN;DELETE FROM paige_workspace_events WHERE source_id='${receipt}' AND tenant_id='${p.tenant}';`+service(`SELECT read_sales_invoice_command_result('${p.actor}','${p.tenant}','${receipt}',${literal(recordCommand)});`),/Original manual invoice receipt unavailable/);
 const suppressed=randomUUID();refused('suppressed original Rail rolls back receipt, invoice version and journal',tenant,plain,'BEGIN;'+dropRail(suppressed)+write(actor,tenant,suppressed,manual(plain,10000)),/Original manual invoice receipt unavailable/);
 for(const [cap,outcome,label]of [['fixture_other_action','capability_failed','another action identity is refused'],['sales_record_manual_payment','capability_succeeded','orphan success identity is refused']]){
  const id=randomUUID();run(service(`SELECT record_capability_run('${tenant}','${actor}','${cap}','${outcome}','${id}',NULL);`));refused(label,tenant,plain,write(actor,tenant,id,manual(plain,10000)),/Operation already belongs to another action/);
 }
 const reverseId=randomUUID(),reverse={action:'invoice.reverse_manual_payment',invoice_id:p.invoice,expected_version:version(p.invoice),payment_id:receipt,reason:'Correct the reported human receipt; no provider refund.'};
 const corrected=value(write(p.actor,p.tenant,reverseId,reverse));
 check('full human correction reopens only the original target and preserves refund payable',corrected.ok===true&&target(6).remaining_minor===10000&&position(p.tenant,p.invoice).actual_outstanding_minor===220000&&position(p.tenant,p.invoice).refund_payable_minor===10000);
 check('full correction recovers its original result without another reversal',JSON.stringify(value(write(p.actor,p.tenant,reverseId,reverse)))===JSON.stringify(corrected));
 decide(5000);const stale=manual(p.invoice,10000,{...target(6),remaining_minor:10000});
 refused('stale gross target cannot consume a later credit',p.tenant,p.invoice,write(p.actor,p.tenant,randomUUID(),stale),/Accepted payment allocation changed/);
 refused('manual amount cannot exceed actual debt or net a refund payable',p.tenant,p.invoice,write(p.actor,p.tenant,randomUUID(),manual(p.invoice,215001)),/Payment exceeds outstanding balance/);
 const secondCommand=manual(p.invoice,5000,target(6)),secondId=randomUUID();value(write(p.actor,p.tenant,secondId,secondCommand));
 check('correct current human amount respects the retained credit',target(6).remaining_minor===0&&position(p.tenant,p.invoice).credit_minor===20000&&position(p.tenant,p.invoice).actual_outstanding_minor===210000);
 observe({...providerSnapshot,refunds:[{...providerSnapshot.refunds[0],status:'failed',failure_balance_transaction:{id:'txn_return'+tag,amount_minor:10000,currency:'usd',status:'available',created_at:now}}]});
 const unknown=position(p.tenant,p.invoice),blocked=manual(p.invoice,1);
 const blockedPreview=value(service(`SELECT preview_sales_invoice_command('${p.actor}','${p.tenant}',${literal(blocked)});`));
 check('unknown provider source is not a zero balance or eligible human receipt',unknown.financial_standing==='needs_review'&&unknown.actual_outstanding_minor===null&&blockedPreview.eligible===false&&blockedPreview.remaining_cents===null);
 refused('recording another human receipt waits for source verification',p.tenant,p.invoice,write(p.actor,p.tenant,randomUUID(),blocked),/financial verification required/);
 const correction={action:'invoice.reverse_manual_payment',invoice_id:p.invoice,expected_version:version(p.invoice),payment_id:secondId,reason:'Correct the human report while provider evidence is being reviewed.'};
 const correctionPreview=value(service(`SELECT preview_sales_invoice_command('${p.actor}','${p.tenant}',${literal(correction)});`));
 check('a genuine human correction remains reviewable without guessing current debt',correctionPreview.eligible===true&&correctionPreview.remaining_cents===null&&correctionPreview.summary.includes('needs payment evidence')&&!correctionPreview.summary.includes('Outstanding after'));
 value(write(p.actor,p.tenant,randomUUID(),correction));
 check('correcting the human record does not resolve unrelated provider uncertainty',position(p.tenant,p.invoice).financial_standing==='needs_review'&&position(p.tenant,p.invoice).actual_outstanding_minor===null);
 decide(5000);
 check('current reviewed source returns separate future debt and actual refunds owed',position(p.tenant,p.invoice).actual_outstanding_minor===210000&&position(p.tenant,p.invoice).refund_payable_minor===15000);
 check('original provider-confirmed receipt remains byte exact',run(`SELECT to_jsonb(x) FROM paige_invoice_payments x WHERE provider_operation_id='${payment}';`)===originalProviderReceipt);
 refused('foreign workspace cannot record or inspect the manual action',p.tenant,p.invoice,write(p.actor,otherTenant,randomUUID(),manual(p.invoice,100)),/workspace|authority/i);
 refused('revoked owner cannot use an earlier human receipt approval',tenant,plain,`BEGIN;UPDATE tenant_members SET status='inactive' WHERE tenant_id='${tenant}' AND user_id='${actor}';`+write(actor,tenant,randomUUID(),manual(plain,10000)),/workspace|authority/i);
 const raceId=randomUUID(),raceCommand=manual(plain,10000),session=(id,cmd)=>'BEGIN;'+service(`SELECT jsonb_build_object('backend',pg_backend_pid(),'result',execute_sales_invoice_command('${actor}','${tenant}','${id}',${literal(cmd)},${literal(governance(actor,tenant,cmd.action))}));SELECT pg_sleep(0.1);COMMIT;`);
 const duplicate=await Promise.all([execute(session(raceId,raceCommand)),execute(session(raceId,raceCommand))]);assert(duplicate.every(r=>r.code===0),duplicate.map(r=>r.err).join('\n'));
 const rows=duplicate.map(r=>JSON.parse(r.out.split('\n').find(x=>x.startsWith('{'))));
 check('two actual sessions produce one human receipt and recover one original result',rows[0].backend!==rows[1].backend&&JSON.stringify(rows[0].result)===JSON.stringify(rows[1].result)&&run(`SELECT count(*) FROM paige_invoice_payments WHERE invoice_id='${plain}';`)==='1');
 const competing=manual(plain,10000),competingIds=[randomUUID(),randomUUID()],results=await Promise.all(competingIds.map(id=>execute(session(id,competing))));
 check('different operation identities cannot apply a stale manual approval twice',results.filter(r=>r.code===0).length===1&&results.some(r=>r.code!==0&&/version conflict/.test(r.err))&&run(`SELECT count(*) FROM paige_invoice_payments WHERE invoice_id='${plain}';`)==='2');
 for(const [change,label]of [
  ['GRANT EXECUTE ON FUNCTION _sales_invoice_prior_execute(uuid,uuid,uuid,jsonb,jsonb) TO authenticated;','private writer grant drift'],
  ['GRANT EXECUTE ON FUNCTION read_sales_invoice_command_result(uuid,uuid,uuid,jsonb) TO authenticated;','public receipt-reader authority drift'],
 ])refused(label,tenant,plain,'BEGIN;'+change+candidate+'ROLLBACK;',/Original manual financial source\/authority changed/);
 const current=snapshot(p.tenant,p.invoice);run('BEGIN;'+candidate+'COMMIT;');
 check('repeat source adoption preserves complete original data and metadata',snapshot(p.tenant,p.invoice)===current&&metadata()===beforeMetadata);
 return {proof:'E04_MANUAL_ACTUAL_FINANCIAL_SELECTED_SCHEMA',status:'PASS',checks,baseline:{missingOriginalRail,actualTargetOriginallyRejected:true,scope:'Original bad behavior reproduced only in owned reduced local schema; suppression transaction rolled back.'},
  source_hashes:Object.fromEntries(['scripts/sql/sales-manual-financial-proof.mjs','supabase/tests/fixtures/exp04_invoice_manual_financial_write.sql'].map(f=>[f,createHash('sha256').update(read(f)).digest('hex')])),
  samples:{preview,recorded,corrected,correctionPreview,currentPosition:position(p.tenant,p.invoice)},
  boundary:'Original native invoice/receipt/approval/Rail/accepted-source contracts with synthetic identity/schema/signing/provider facts. Legacy result-row projection still requires paired actual financial read/UI before release. No hosted Auth, actual payment/provider/signature or customer acceptance.'};
}
