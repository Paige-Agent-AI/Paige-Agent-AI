// Companion phase of the original provider proof; no cluster, identity, provider
// client or financial store. All signing/provider facts remain synthetic ports.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';

export async function proveFinancialCollectibility({run,read,actor,tenant,client,invoice,otherTenant,baseline=false}){
 const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 const service=sql=>"SET ROLE service_role;SET test.actor='';"+sql;
 const value=sql=>JSON.parse(run(sql).split('\n').find(line=>line.startsWith('{')));
 let checks=0;const check=(label,ok)=>{assert.equal(ok,true,label);checks++;console.log('COLLECTIBILITY PASS '+label);};
 const original=(file,name)=>{const source=read(file),start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),tail=source.slice(start),tag=/\bAS\s+(\$[a-zA-Z0-9_]*\$)/i.exec(tail);assert(start>=0&&tag,name);return tail.slice(0,tail.indexOf(tag[1],tag.index+tag[0].length)+tag[1].length)+';';};
 const source=read('supabase/tests/fixtures/exp04_invoice_financial_collectibility.sql');
 const acceptedMigration='supabase/migrations/20271126010010_e04_accepted_invoice_payment_obligations.sql';
 run(original(acceptedMigration,'read_sales_invoice_payment_obligation')+'REVOKE ALL ON FUNCTION read_sales_invoice_payment_obligation(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION read_sales_invoice_payment_obligation(uuid,uuid,uuid,jsonb) TO service_role;');
 const fixture=JSON.parse(read('supabase/tests/fixtures/exp04_reviewed_commercial_native.sql').match(/\$e04_fixture\$([\s\S]*?)\$e04_fixture\$::jsonb/)[1]);
 assert.match(fixture.scope,/^Synthetic/);
 const plan={actor:fixture.actor_id,tenant:fixture.tenant_id,client:fixture.client_id,invoice:fixture.effective.invoice_id,signing:fixture.effective.signing_id};
 const position=(t,id)=>value(`SELECT financial_position FROM _sales_invoice_financial_position_rows('${t}','${id}',3,NULL::jsonb);`);
 const accepted=()=>value(`SELECT _sales_invoice_accepted_obligations(i,'${plan.signing}') FROM paige_invoices i WHERE i.id='${plan.invoice}';`);
 const version=id=>Number(run(`SELECT billing_lifecycle_version FROM paige_invoices WHERE id='${id}';`));
 const signatures=[
  '_sales_invoice_accepted_obligations(paige_invoices,uuid)',
  '_sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)',
  '_sales_invoice_require_accepted_obligation(paige_invoices,jsonb)',
  'prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb)',
  'claim_sales_invoice_payment_request(uuid,uuid,uuid)',
  'allocate_verified_sales_invoice_payment(uuid,uuid,uuid,jsonb)',
  'read_sales_invoice_payment_obligation(uuid,uuid,uuid,jsonb)',
  '_sales_invoice_payment_request_mutation_guard()',
  'record_sales_invoice_provider_observation(uuid,uuid,uuid,bigint,jsonb,text)',
 ];
 const metadata=()=>run(`SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM (SELECT oid,proowner,proacl,prosecdef,proconfig,provolatile,proparallel,proisstrict,proleakproof,proargnames,proargtypes,proallargtypes,proargmodes,pronargdefaults,prorettype,proretset FROM pg_proc WHERE oid IN(${signatures.map(s=>`'public.${s}'::regprocedure`).join(',')})) x;`);
 const legacyBefore=accepted(),positionBefore=position(plan.tenant,plan.invoice),metadataBefore=metadata();
 if(!baseline){run('BEGIN;'+source+'COMMIT;');run('BEGIN;'+source+'COMMIT;');}
 check('original writer and read metadata stay exact',metadata()===metadataBefore);
 check('whole legacy accepted-obligation payload stays exact',JSON.stringify(accepted())===JSON.stringify(legacyBefore));
 check('current debt and refund payable survive the companion unchanged',position(plan.tenant,plan.invoice).actual_outstanding_minor===positionBefore.actual_outstanding_minor&&position(plan.tenant,plan.invoice).refund_payable_minor===positionBefore.refund_payable_minor);
 run(`UPDATE tenant_stripe_accounts SET provider_environment='live',binding_version=3,sales_readback_at=clock_timestamp() WHERE tenant_id='${plan.tenant}';`);
 const target=sequence=>{
  const row=position(plan.tenant,plan.invoice).obligations.find(r=>r.reference.sequence===sequence);assert(row,'original accepted target');
  return Object.fromEntries(['reference','source_digest','due_date','scheduled_minor'].map(k=>[k,row[k]]).concat([['remaining_minor',row.actual_outstanding_minor]]));
 };
 const gov=(a,t,action='invoice.payment_request')=>({actor_user_id:a,tenant_id:t,action,tool:action==='invoice.payment_request'?'sales_create_payment_request':'sales_record_provider_disposition',approval_channel:'operator_card',approved_fingerprint:'0123456789abcdef',decision_receipt_recorded:true});
 const command=(sequence)=>({action:'invoice.payment_request',invoice_id:plan.invoice,client_id:plan.client,expected_version:version(plan.invoice),issued_snapshot_version:1,provider:'stripe',merchant_account_id:'acct_fixturePlan',merchant_binding_version:3,environment:'live',amount_minor:target(sequence).remaining_minor,currency:'usd',purpose:'installment',obligation:target(sequence)});
 const prepare=(a,t,id,cmd)=>service(`SELECT prepare_sales_invoice_payment_request('${a}','${t}','${id}',${literal(cmd)},${literal(gov(a,t))});`);
 const readback=(cmd,tag)=>({provider:'stripe',merchant_account_id:cmd.merchant_account_id,environment:cmd.environment,provider_object_id:'cs_'+tag,provider_transaction_id:'ch_'+tag,provider_settlement_id:'txn_'+tag,amount_minor:cmd.amount_minor,currency:'usd',status:'verified',readback_reference:'req_'+tag,invoice_id:cmd.invoice_id,client_id:cmd.client_id,invoice_version:cmd.expected_version,issued_snapshot_version:1,provider_received_at:new Date(Date.now()-120000).toISOString()});
 function settle(cmd,a=plan.actor,t=plan.tenant){
  const id=randomUUID(),token=randomUUID(),tag=id.replaceAll('-','');
  const prepared=value(prepare(a,t,id,cmd));
  run(service(`SELECT claim_sales_invoice_payment_request('${t}','${id}','${token}');SELECT finalize_sales_invoice_payment_request('${t}','${id}','${token}','customer_action_required','cs_${tag}','open','https://checkout.stripe.com/c/pay/cs_${tag}',NULL);`));
  const facts=readback(cmd,tag),allocated=value(service(`SELECT allocate_verified_sales_invoice_payment('${t}','${id}','${token}',${literal(facts)});`));
  return {id,token,tag,cmd,facts,prepared,allocated};
 }
 const first=settle(command(4));
 check('original target request and verified receipt use current actual principal',first.prepared.amount_minor===30000&&first.allocated.state==='settled'&&position(plan.tenant,plan.invoice).actual_outstanding_minor===240000);
 const waitingId=randomUUID(),waitingCommand=command(5);
 if(!baseline){
  value(prepare(plan.actor,plan.tenant,waitingId,waitingCommand));
  for(const [label,sql,refusal]of [
   ['unreceipted invoice-version advance',`UPDATE paige_invoices SET billing_lifecycle_version=billing_lifecycle_version+1 WHERE id='${plan.invoice}';`,/Payment operation unavailable/],
   ['unrelated invoice status change',`UPDATE paige_invoices SET status='void' WHERE id='${plan.invoice}';`,/Payment request is unresolved/],
   ['new manual receipt',`INSERT INTO paige_invoice_payments(id,tenant_id,invoice_id,actor_user_id,kind,amount_cents,currency,method,received_at) VALUES('${randomUUID()}','${plan.tenant}','${plan.invoice}','${plan.actor}','receipt',1,'usd','cash',now());`,/Payment request is unresolved/],
  ]){
   const before=run(`SELECT jsonb_build_object('invoice',to_jsonb(i),'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM paige_invoice_payments p WHERE p.invoice_id=i.id)) FROM paige_invoices i WHERE i.id='${plan.invoice}';`);
   assert.throws(()=>run(sql),refusal);
   assert.equal(run(`SELECT jsonb_build_object('invoice',to_jsonb(i),'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM paige_invoice_payments p WHERE p.invoice_id=i.id)) FROM paige_invoices i WHERE i.id='${plan.invoice}';`),before);
   check('pending request still fences '+label,run(`SELECT state FROM paige_invoice_provider_operations WHERE id='${waitingId}';`)==='prepared');
  }
 }
 const context=value(service(`SELECT read_sales_invoice_provider_observation_context('${plan.tenant}','${first.id}');`));
 const now=new Date(Date.now()-60000).toISOString();
 run(service(`SELECT record_sales_invoice_provider_observation('${plan.tenant}','${first.id}','${first.token}',${context.observation_version},${literal({state:'observed',provider_transaction_id:'ch_'+first.tag,provider_settlement_id:'txn_'+first.tag,refunds:[{id:'re_'+first.tag,amount_minor:10000,currency:'usd',status:'succeeded',created_at:now,balance_transaction:{id:'txn_refund'+first.tag,amount_minor:-10000,currency:'usd',status:'available',created_at:now},failure_balance_transaction:null}],disputes:[]})},'evt_Collectibility');`));
 if(!baseline){
  assert.throws(()=>run(prepare(plan.actor,plan.tenant,randomUUID(),{...waitingCommand,expected_version:version(plan.invoice)})),/financial verification required/);
  check('unreviewed provider change cannot admit a new request',run(`SELECT count(*) FROM paige_invoice_provider_operations WHERE invoice_id='${plan.invoice}' AND state='prepared';`)==='1');
  assert.throws(()=>run(service(`SELECT claim_sales_invoice_payment_request('${plan.tenant}','${waitingId}','${randomUUID()}');`)),/financial verification required/);
  check('a changed financial source cannot claim a previously prepared dispatch',run(`SELECT state='prepared' AND dispatch_claim_token IS NULL AND dispatch_started_at IS NULL FROM paige_invoice_provider_operations WHERE id='${waitingId}';`)==='t');
  const cancelled=value(service(`SELECT cancel_prepared_sales_invoice_payment_request('${plan.tenant}','${waitingId}','invoice_changed');`));
  const replay=value(service(`SELECT cancel_prepared_sales_invoice_payment_request('${plan.tenant}','${waitingId}','invoice_changed');`));
  check('original undispatched cancellation unblocks review and recovers without provider effect',cancelled.state==='cancelled'&&cancelled.provider_object_id===null&&JSON.stringify(cancelled)===JSON.stringify(replay));
 }
 const observed=value(service(`SELECT read_sales_invoice_provider_observation_context('${plan.tenant}','${first.id}');`));
 const reversedRefund={state:'observed',provider_transaction_id:'ch_'+first.tag,provider_settlement_id:'txn_'+first.tag,
  refunds:[{id:'re_'+first.tag,amount_minor:10000,currency:'usd',status:'failed',created_at:now,
   balance_transaction:{id:'txn_refund'+first.tag,amount_minor:-10000,currency:'usd',status:'available',created_at:now},
   failure_balance_transaction:{id:'txn_return'+first.tag,amount_minor:10000,currency:'usd',status:'available',created_at:now}}],disputes:[]};
 if(!baseline){
  const snapshot=()=>run(`SELECT jsonb_build_object('invoice',(SELECT to_jsonb(i) FROM paige_invoices i WHERE i.id='${plan.invoice}'),
   'payment',(SELECT to_jsonb(p) FROM paige_invoice_provider_operations p WHERE p.id='${first.id}'),
   'journal',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM paige_invoice_operations e WHERE e.invoice_id='${plan.invoice}'),
   'rail',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM paige_workspace_events e WHERE e.tenant_id='${plan.tenant}'));`);
  const before=snapshot();
  const failRail=`BEGIN;CREATE FUNCTION pg_temp.e04_collectibility_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Fixture receipt failure';END$$;
   CREATE TRIGGER e04_collectibility_receipt_failure BEFORE INSERT ON paige_workspace_events FOR EACH ROW
   WHEN (NEW.capability_key='sales_payment_reconcile' AND NEW.detail->>'effect'='provider_observation_only') EXECUTE FUNCTION pg_temp.e04_collectibility_receipt_failure();`;
  assert.throws(()=>run(failRail+service(`SELECT record_sales_invoice_provider_observation('${plan.tenant}','${first.id}','${first.token}',${observed.observation_version},${literal(reversedRefund)},'evt_ReceiptFailure');`)),/Fixture receipt failure/);
  check('failed original Rail rolls back observation, pointer and invoice version',snapshot()===before);
 }
 const decision={action:'invoice.record_provider_disposition',invoice_id:plan.invoice,expected_version:version(plan.invoice),provider_operation_id:first.id,observation_id:observed.observation_id,observation_version:observed.observation_version,expected_disposition_version:0,decision:'balance_due',reason:'Fixture owner explicitly retains the original refunded installment principal as owed.'};
 const review=value(service(`SELECT preview_sales_invoice_command('${plan.actor}','${plan.tenant}',${literal(decision)});`)).provider_disposition;
 run(service(`SELECT execute_sales_invoice_command('${plan.actor}','${plan.tenant}','${randomUUID()}',${literal(decision)},${literal({...gov(plan.actor,plan.tenant,decision.action),approved_financial_review:review})});`));
 const owed=target(4),legacy=accepted().obligations.find(r=>r.reference.sequence===4);
 check('refunded target has actual debt despite legacy gross remaining zero',owed.remaining_minor===10000&&legacy.remaining_minor===0&&position(plan.tenant,plan.invoice).refund_payable_minor===10000);
 // Failing-first control: without the companion, the ORIGINAL writer refuses
 // this correct re-collection because it still uses gross captured principal.
 const second=settle(command(4));
 check('refunded original installment can be re-collected once without a second obligation',second.prepared.amount_minor===10000&&second.allocated.state==='settled'&&target(4).remaining_minor===0&&position(plan.tenant,plan.invoice).actual_outstanding_minor===240000&&position(plan.tenant,plan.invoice).refund_payable_minor===10000);
 const recovery=value(service(`SELECT allocate_verified_sales_invoice_payment('${plan.tenant}','${second.id}','${second.token}',${literal(second.facts)});`));
 check('original verified allocation replays the same receipt once',recovery.replayed===true&&recovery.allocation_payment_id===second.allocated.allocation_payment_id&&run(`SELECT count(*) FROM paige_invoice_payments WHERE provider_operation_id='${second.id}';`)==='1');
 const current=value(service(`SELECT read_sales_invoice_payment_obligation('${plan.actor}','${plan.tenant}','${plan.invoice}',${literal(owed.reference)});`));
 assert.deepEqual(current,{tenant_id:plan.tenant,client_id:plan.client,invoice_id:plan.invoice,invoice_version:version(plan.invoice),issued_snapshot_version:1,obligation:target(4)});
 check('original service selector now returns current actual target without changing its DTO',Object.keys(current).length===6);
 const stale={...command(4),amount_minor:30000,obligation:{...target(4),remaining_minor:30000}};
 assert.throws(()=>run(prepare(plan.actor,plan.tenant,randomUUID(),stale)),/Accepted payment obligation changed/);
 check('old gross target cannot request extra principal after recovery',target(4).remaining_minor===0);
 // TEST-to-LIVE is the same original invoice, not a separate test customer.
 const plain=randomUUID();
 run(`INSERT INTO paige_invoices SELECT (jsonb_populate_record(NULL::paige_invoices,to_jsonb(i)||jsonb_build_object('id','${plain}','invoice_number','INV-COLLECTIBILITY-PROOF','billing_draft','{}'::jsonb,'status','issued','amount_total_cents',350000,'billing_lifecycle_version',2))).* FROM paige_invoices i WHERE i.id='${invoice}';UPDATE tenant_stripe_accounts SET stripe_account_id='acct_fixtureA',provider_environment='test',binding_version=4,sales_readback_at=clock_timestamp() WHERE tenant_id='${tenant}';`);
 const plainCommand=environment=>({action:'invoice.payment_request',invoice_id:plain,client_id:client,expected_version:version(plain),issued_snapshot_version:1,provider:'stripe',merchant_account_id:'acct_fixtureA',merchant_binding_version:environment==='test'?4:5,environment,amount_minor:350000,currency:'usd',purpose:'full'});
 const test=settle(plainCommand('test'),actor,tenant);
 check('TEST full capture never consumes actual request eligibility',position(tenant,plain).actual_outstanding_minor===350000&&position(tenant,plain).test_provider_minor===350000&&position(tenant,plain).provider_settled_net_minor===0);
 run(`UPDATE tenant_stripe_accounts SET provider_environment='live',binding_version=5,sales_readback_at=clock_timestamp() WHERE tenant_id='${tenant}';`);
 const live=settle(plainCommand('live'),actor,tenant);
 check('same invoice can settle actual LIVE principal after TEST history',live.allocated.state==='settled'&&position(tenant,plain).actual_outstanding_minor===0&&position(tenant,plain).refund_payable_minor===0&&position(tenant,plain).test_provider_minor===350000);
 assert.throws(()=>run(prepare(actor,tenant,randomUUID(),plainCommand('live'))),/Payment amount or currency unavailable/);
 check('no further full request is admitted after actual principal is satisfied',run(`SELECT count(*) FROM paige_invoice_payments WHERE invoice_id='${plain}';`)==='2');
 assert.throws(()=>run(prepare(actor,otherTenant,randomUUID(),plainCommand('live'))),/workspace|authority/i);
 check('foreign tenant still cannot prepare against the original invoice',metadata()===metadataBefore);
 assert.throws(()=>run("BEGIN;SET ROLE authenticated;SELECT _sales_invoice_collectible_balance(i) FROM paige_invoices i LIMIT 1;ROLLBACK;"),/permission denied/);
 check('new calculation helpers expose no customer execution authority',run("SELECT proacl::text FROM pg_proc WHERE oid='public._sales_invoice_collectible_balance(paige_invoices)'::regprocedure;")==='{postgres=X/postgres}');
 for(const change of [
  'GRANT EXECUTE ON FUNCTION prepare_sales_invoice_payment_request(uuid,uuid,uuid,jsonb,jsonb) TO authenticated;',
  'ALTER FUNCTION _sales_invoice_accepted_obligations(paige_invoices,uuid,integer) SECURITY DEFINER;',
 ])assert.throws(()=>run('BEGIN;'+change+source+'ROLLBACK;'),/consumer source\/authority changed/);
 check('candidate replay refuses public or private authority drift',metadata()===metadataBefore);
 const after=position(plan.tenant,plan.invoice);run('BEGIN;'+source+'COMMIT;');
 check('repeat adoption preserves exact original current position and metadata',JSON.stringify(position(plan.tenant,plan.invoice))===JSON.stringify(after)&&metadata()===metadataBefore);
 assert.equal(checks,23,'all original collectibility controls execute before new service-context controls');
 const collectibilityChecks=checks;
 const contextSQL=(a,t,id,reference)=>`SELECT read_sales_invoice_payment_obligation('${a}','${t}','${id}',${literal(reference)});`;
 const envelope=reference=>({financial_evidence_version:3,reference});
 const targetContext=value(service(contextSQL(plan.actor,plan.tenant,plan.invoice,envelope(owed.reference))));
 check('original endpoint emits a closed current actual target context',Object.keys(targetContext).length===13&&targetContext.financial_evidence_version===3
  &&targetContext.tenant_id===plan.tenant&&targetContext.client_id===plan.client&&targetContext.invoice_id===plan.invoice
  &&targetContext.invoice_version===version(plan.invoice)&&targetContext.status==='issued'&&targetContext.financial_standing==='recorded'
  &&targetContext.actual_outstanding_minor===240000&&targetContext.refund_payable_minor===10000
  &&targetContext.obligation.remaining_minor===0&&/^[a-f0-9]{64}$/.test(targetContext.source_hash));
 const fullContext=value(service(contextSQL(actor,tenant,plain,envelope(null))));
 check('full current context retains actual zero after TEST then LIVE without a selector',Object.keys(fullContext).length===13
  &&fullContext.obligation===null&&fullContext.actual_outstanding_minor===0&&fullContext.refund_payable_minor===0&&fullContext.financial_evidence_version===3);
 const administrator=value(`BEGIN;UPDATE tenant_members SET role='admin' WHERE tenant_id='${plan.tenant}' AND user_id='${plan.actor}';`+service(contextSQL(plan.actor,plan.tenant,plan.invoice,envelope(owed.reference)))+'ROLLBACK;');
 check('existing original financial administrator retains the same authorized read',JSON.stringify(administrator)===JSON.stringify(targetContext));
 for(const [bad,label,pattern]of [
  [{financial_evidence_version:2,reference:null},'unsupported financial version cannot fall back',/Invalid payment financial context request/],
  [{...envelope(null),actor_user_id:plan.actor},'envelope cannot supply actor authority',/Invalid payment financial context request/],
  [{financial_evidence_version:3},'missing selector is not an implicit full request',/Invalid payment financial context request/],
  [envelope(0),'scalar selector cannot become a full read',/Invalid accepted payment selector/],
 ]){assert.throws(()=>run(service(contextSQL(plan.actor,plan.tenant,plan.invoice,bad))),pattern);check(label,true);}
 assert.throws(()=>run(service(contextSQL(plan.actor,plan.tenant,plan.invoice,envelope({...owed.reference,sequence:240})))),/Accepted payment obligation changed/);
 check('foreign accepted selector cannot acquire the current debt',metadata()===metadataBefore);
 assert.throws(()=>run(service(contextSQL(plan.actor,otherTenant,plan.invoice,envelope(null)))),/workspace|authority/i);
 check('new context cannot cross the original workspace boundary',metadata()===metadataBefore);
 for(const [patch,label]of [["status='inactive'",'revoked membership'],["role='member'",'ordinary ungranted member']]){
  assert.throws(()=>run(`BEGIN;UPDATE tenant_members SET ${patch} WHERE tenant_id='${plan.tenant}' AND user_id='${plan.actor}';`+service(contextSQL(plan.actor,plan.tenant,plan.invoice,envelope(null)))),/workspace|authority/i);
  check(label+' cannot read the financial context',metadata()===metadataBefore);
 }
 assert.throws(()=>run(`BEGIN;UPDATE paige_invoices SET status='void' WHERE id='${plain}';`+service(contextSQL(actor,tenant,plain,envelope(null)))),/Invoice changed or unavailable for payment/);
 check('void invoice cannot furnish a collectible current context',position(tenant,plain).actual_outstanding_minor===0);
 const beforeUnknown=JSON.stringify(position(plan.tenant,plan.invoice));
 assert.throws(()=>run(service(`SELECT record_sales_invoice_provider_observation('${plan.tenant}','${first.id}','${first.token}',${observed.observation_version},${literal({state:'observed',provider_transaction_id:'ch_'+first.tag,provider_settlement_id:'txn_'+first.tag,refunds:[],disputes:[]})},'evt_IncompleteContext');`)),/Provider observation incomplete/);
 check('missing verified refund history cannot restore cash or furnish current debt',JSON.stringify(position(plan.tenant,plan.invoice))===beforeUnknown);
 const disputeContext=value(service(`SELECT read_sales_invoice_provider_observation_context('${tenant}','${live.id}');`));
 const plainBeforeDispute=JSON.stringify(position(tenant,plain));
 const disputeSnapshot={state:'observed',provider_transaction_id:'ch_'+live.tag,provider_settlement_id:'txn_'+live.tag,
  refunds:[],disputes:[{id:'du_ContextHistory',amount_minor:1000,currency:'usd',created_at:now,status:'under_review',
   balance_transactions:[{id:'txn_disputeContext',amount_minor:-1000,currency:'usd',status:'available',created_at:now}]}]};
 assert.throws(()=>run('BEGIN;'+service(`SELECT record_sales_invoice_provider_observation('${tenant}','${live.id}','${live.token}',${disputeContext.observation_version},${literal(disputeSnapshot)},'evt_DisputeContext');
  SELECT record_sales_invoice_provider_observation('${tenant}','${live.id}','${live.token}',${disputeContext.observation_version+1},${literal({...disputeSnapshot,disputes:[]})},'evt_MissingDisputeContext');`)),/Provider observation incomplete/);
 check('missing verified dispute history cannot restore cash and both attempted writes roll back',JSON.stringify(position(tenant,plain))===plainBeforeDispute);
 assert.throws(()=>run('BEGIN;'+service(`SELECT record_sales_invoice_provider_observation('${plan.tenant}','${first.id}','${first.token}',${observed.observation_version},${literal(reversedRefund)},'evt_ContextUnknown');`)+service(contextSQL(plan.actor,plan.tenant,plan.invoice,envelope(null)))),/Accepted payment obligation unavailable/);
 check('unreviewed provider change cannot be converted into zero or current debt',JSON.stringify(position(plan.tenant,plan.invoice))===beforeUnknown);
 assert.throws(()=>run("SET ROLE authenticated;"+contextSQL(plan.actor,plan.tenant,plan.invoice,envelope(null))),/permission denied/);
 check('context remains original service-only with no public grant',metadata()===metadataBefore);
 assert.equal(checks,39,'original23 plus16 financial-context controls');
 return {proof:'E04_FINANCIAL_COLLECTIBILITY_SELECTED_SCHEMA',status:'PASS',checks,collectibilityChecks,financialContextChecks:checks-collectibilityChecks,
  source_hashes:Object.fromEntries(['supabase/tests/fixtures/exp04_invoice_financial_collectibility.sql','scripts/sql/sales-financial-collectibility-proof.mjs'].map(f=>[f,createHash('sha256').update(read(f)).digest('hex')])),
  samples:{recollected:second.allocated,actualPosition:after,testThenLive:position(tenant,plain)},financialContexts:{targetContext,fullContext},
  boundary:'Original native payment doors/accepted targets/immutable receipts, synthetic identity/schema/signing/provider facts only. No hosted Auth, real provider, full schema, rendered UI or customer acceptance.'};
}
