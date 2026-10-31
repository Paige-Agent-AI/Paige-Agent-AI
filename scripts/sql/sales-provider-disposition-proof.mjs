// Optional phase of the ONE existing native provider proof. No cluster/DB setup,
// provider API or separate execution engine. Identity/tables remain disclosed ports.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
export async function proveProviderDisposition({run,read,execute,actor,tenant,client,invoice,otherTenant,baseline=false}){
 const literal=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
 const service=sql=>"SET ROLE service_role;SET test.actor='';"+sql;
 const value=sql=>JSON.parse(run(sql).split('\n').find(line=>line.startsWith('{')));
 let checks=0;const check=(label,ok)=>{assert.equal(ok,true,label);checks++;console.log('DISPOSITION PASS '+label);};
 const original=(file,name)=>{
  const source=read(file.startsWith('supabase/')?file:'supabase/migrations/'+file),start=source.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');
  assert(start>=0,'original function '+name);const tail=source.slice(start),body=/\bAS\s+(\$[a-zA-Z0-9_]*\$)/i.exec(tail);
  assert(body,'original dollar body '+name);const end=tail.indexOf(body[1],body.index+body[0].length);
  assert(end>0,'closed original function '+name);return tail.slice(0,end+body[1].length)+';';
 };
 // Current original entry bodies, unchanged source and actual canonical ACLs.
 const doors=[
  ['preview_sales_invoice_command','20271126080004_e04_original_manual_payment_allocations.sql','uuid,uuid,jsonb','9ecfe85e6d8638082ee14f9b13acff47'],
  ['execute_sales_invoice_command','20270553000000_sales_invoice_preferences.sql','uuid,uuid,uuid,jsonb,jsonb','b4da1d303e969a5bb33d89cd60103375'],
  ['read_sales_invoice_command_result','20270543000000_sales_invoice_lifecycle.sql','uuid,uuid,uuid,jsonb','94fd1e3deb3547b4bb72388b2a0549e9'],
 ];
 for(const [name,file,args,hash]of doors){
  run(original(file,name));
  run(`REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO service_role;`);
  check('current original '+name+' source is exact',run(`SELECT md5(prosrc)='${hash}' FROM pg_proc WHERE oid='public.${name}(${args})'::regprocedure;`)==='t');
 }
 run(`CREATE TABLE IF NOT EXISTS public.messages(id uuid PRIMARY KEY,meta jsonb);
 UPDATE tenant_members SET status='active',role='owner' WHERE user_id='${actor}' AND tenant_id='${tenant}';
 UPDATE auth.users SET deleted_at=NULL,banned_until=NULL WHERE id='${actor}';
 UPDATE profiles SET active_tenant_id='${tenant}' WHERE user_id='${actor}';UPDATE tenants SET status='active' WHERE id='${tenant}';
 UPDATE tenant_stripe_accounts SET stripe_account_id='acct_fixtureA',provider_environment='live',binding_version=1,
 charges_enabled=true,payouts_enabled=true,details_submitted=true,sales_payment_permission=true,sales_readback_at=now() WHERE tenant_id='${tenant}';`);
 const metadata=()=>run(`SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'name',p.proname,'owner',p.proowner,'args',p.proargnames,
 'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'volatile',p.provolatile,'defaults',p.pronargdefaults,'result',p.prorettype)
 ORDER BY p.proname) FROM pg_proc p WHERE p.oid IN(${doors.map(([name,,args])=>`'public.${name}(${args})'::regprocedure`).join(',')});`);
 const beforeMetadata=metadata();
 // SAME original neutral signed-source metadata used by the accepted-obligation
 // proof. Retained fixture consent/evidence is synthetic, never a real signature.
 const typeFixture=JSON.parse(read('supabase/tests/fixtures/exp04_accepted_obligation_types.json'));
 const retained=read('supabase/tests/fixtures/exp04_reviewed_commercial_native.sql').match(/\$e04_fixture\$([\s\S]*?)\$e04_fixture\$::jsonb/);
 assert(retained,'original retained commercial fixture');const plan=JSON.parse(retained[1]);assert.match(plan.scope,/^Synthetic/);
 for(const sql of typeFixture.enum_ddl??[])run(sql);
 const originalTables=['tenant_client_agreements','paige_agreements','paige_agreement_signers','paige_agreement_events','paige_sales_collection_operations'];
 for(const table of originalTables){const sql=typeFixture.table_ddl.find(sql=>sql.startsWith('CREATE TABLE public.'+table+' '));assert(sql,'original table type '+table);run(sql);}
 const acceptedSources=[
  ['_paige_commercial_canonical_json','20271113230004_agreement_commercial_presentation.sql'],
  ['_paige_retained_commercial_payload','20271113810004_e04_accepted_commercial_evidence.sql'],
  ['_paige_accepted_commercial_payload','20271113810004_e04_accepted_commercial_evidence.sql'],
  ['_sales_collection_accepted_total_evidence','20271121131304_sales_collection_total_evidence.sql'],
  ...['_sales_invoice_manual_allocation_intent','_sales_invoice_manual_receipt_allocations','_sales_invoice_manual_allocations'].map(name=>[name,'20271126080004_e04_original_manual_payment_allocations.sql']),
  ['_sales_invoice_accepted_obligations','supabase/tests/fixtures/exp04_invoice_actual_obligations.sql'],
 ];
 for(const [name,file]of acceptedSources){run(original(file,name));run(`DO $acl$ DECLARE p regprocedure;BEGIN FOR p IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='${name}' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',p);END LOOP;END $acl$;`);}
 run(`INSERT INTO auth.users(id) VALUES('${plan.actor_id}');INSERT INTO tenants VALUES('${plan.tenant_id}','active');
 INSERT INTO profiles VALUES('${plan.actor_id}','${plan.tenant_id}','Fixture plan owner');
 INSERT INTO tenant_members(tenant_id,user_id,status,role) VALUES('${plan.tenant_id}','${plan.actor_id}','active','owner');
 INSERT INTO clients VALUES('${plan.client_id}','${plan.tenant_id}');
 INSERT INTO tenant_stripe_accounts(tenant_id,stripe_account_id,binding_version,provider_environment,charges_enabled,payouts_enabled,details_submitted,sales_payment_permission,sales_readback_at)
 VALUES('${plan.tenant_id}','acct_fixturePlan',1,'live',true,true,true,true,now());`);
 for(const table of [...originalTables,'paige_workspace_events','paige_invoices']){
  const rows=structuredClone(plan.records[table]);
  if(table==='tenant_client_agreements')for(const row of rows)row.status='active';
  if(table==='paige_invoices')for(const row of rows)Object.assign(row,{status:'issued',billing_lifecycle_version:2,billing_issued_snapshot_version:1,billing_issued_at:'2026-10-29T12:00:00Z',billing_document:{schema_version:1,scope:'Synthetic issued metadata only'}});
  run(`INSERT INTO public.${table} SELECT * FROM jsonb_populate_recordset(NULL::public.${table},${literal(rows)});`);
 }
 const candidate=read('supabase/tests/fixtures/exp04_invoice_provider_disposition.sql');
 if(!baseline){run('BEGIN;'+candidate+'COMMIT;');run('BEGIN;'+candidate+'COMMIT;');}
 check('native financial decision implementation exists',run("SELECT to_regprocedure('public._sales_invoice_record_provider_disposition(uuid,uuid,uuid,jsonb,jsonb)') IS NOT NULL;")==='t');
 check('all original entry metadata is exact',metadata()===beforeMetadata);
 const life=read('supabase/migrations/20270543000000_sales_invoice_lifecycle.sql');
 run(original('20270543000000_sales_invoice_lifecycle.sql','_sales_invoice_immutable'));
 run(`CREATE TRIGGER e04_disposition_immutable BEFORE UPDATE OR DELETE ON paige_invoice_operations FOR EACH ROW EXECUTE FUNCTION _sales_invoice_immutable();
 CREATE TRIGGER e04_disposition_payment_immutable BEFORE UPDATE OR DELETE ON paige_invoice_payments FOR EACH ROW EXECUTE FUNCTION _sales_invoice_immutable();`);
 assert(life.includes('Invoice history is append-only'),'actual original immutable function source');
 const target=randomUUID(),payment=randomUUID(),claim=randomUUID();
 run(`INSERT INTO paige_invoices SELECT (jsonb_populate_record(NULL::paige_invoices,to_jsonb(i)||jsonb_build_object('id','${target}',
 'invoice_number','INV-DISPOSITION-PROOF','status','issued','amount_total_cents',350000,'billing_lifecycle_version',2))).* FROM paige_invoices i WHERE i.id='${invoice}';`);
 const currentVersion=()=>Number(run(`SELECT billing_lifecycle_version FROM paige_invoices WHERE id='${target}';`));
 const paymentCommand={action:'invoice.payment_request',invoice_id:target,client_id:client,expected_version:2,issued_snapshot_version:1,
  provider:'stripe',merchant_account_id:'acct_fixtureA',merchant_binding_version:1,environment:'live',amount_minor:50000,currency:'usd',purpose:'partial'};
 const governance=action=>({actor_user_id:actor,tenant_id:tenant,action,tool:action==='invoice.payment_request'?'sales_create_payment_request':'sales_record_provider_disposition',approval_channel:'operator_card',approved_fingerprint:'0123456789abcdef',decision_receipt_recorded:true});
 run(service(`SELECT prepare_sales_invoice_payment_request('${actor}','${tenant}','${payment}',${literal(paymentCommand)},${literal(governance(paymentCommand.action))});
 SELECT claim_sales_invoice_payment_request('${tenant}','${payment}','${claim}');
 SELECT finalize_sales_invoice_payment_request('${tenant}','${payment}','${claim}','customer_action_required','cs_live_Disposition','open','https://checkout.stripe.com/c/pay/cs_live_Disposition',NULL);
 SELECT allocate_verified_sales_invoice_payment('${tenant}','${payment}','${claim}',${literal({provider:'stripe',merchant_account_id:'acct_fixtureA',environment:'live',provider_object_id:'cs_live_Disposition',provider_transaction_id:'ch_Disposition',provider_settlement_id:'txn_Disposition',amount_minor:50000,currency:'usd',status:'verified',readback_reference:'req_Disposition',invoice_id:target,client_id:client,invoice_version:2,issued_snapshot_version:1,provider_received_at:new Date(Date.now()-120000).toISOString()})});`));
 const empty={state:'observed',provider_transaction_id:'ch_Disposition',provider_settlement_id:'txn_Disposition',refunds:[],disputes:[]};
 const balance=(id,amount)=>({id,amount_minor:amount,currency:'usd',status:'available',created_at:new Date(Date.now()-60000).toISOString()});
 const refund={id:'re_Disposition',amount_minor:10000,currency:'usd',status:'succeeded',created_at:new Date(Date.now()-60000).toISOString(),balance_transaction:balance('txn_DispositionRefund',-10000),failure_balance_transaction:null};
 const observe=snapshot=>{
  const context=value(service(`SELECT read_sales_invoice_provider_observation_context('${tenant}','${payment}');`));
  return run(service(`SELECT record_sales_invoice_provider_observation('${tenant}','${payment}','${claim}',${context.observation_version},${literal(snapshot)},'evt_Disposition');`));
 };
 observe({...empty,refunds:[refund]});
 const command=(decision='balance_due',credit_minor)=>({action:'invoice.record_provider_disposition',invoice_id:target,expected_version:currentVersion(),provider_operation_id:payment,
  ...value(`SELECT jsonb_build_object('observation_id',provider_observation_operation_id,'observation_version',provider_observation_version) FROM paige_invoice_provider_operations WHERE id='${payment}';`),
  expected_disposition_version:Number(value(`SELECT financial_position FROM _sales_invoice_financial_position_rows('${tenant}','${target}',3,NULL::jsonb);`).original_payment_decisions[0].financial_decision.version),
  decision,...(credit_minor===undefined?{}:{credit_minor}),reason:'Fixture owner reviewed original payment and exact credit.'});
 const preview=cmd=>value(service(`SELECT preview_sales_invoice_command('${actor}','${tenant}',${literal(cmd)});`));
 const native=(id,cmd,profile)=>service(`SELECT execute_sales_invoice_command('${actor}','${tenant}','${id}',${literal(cmd)},${literal({...governance(cmd.action),approved_financial_review:profile})});`);
 const position=()=>value(`SELECT financial_position FROM _sales_invoice_financial_position_rows('${tenant}','${target}',3,NULL::jsonb);`);
 const journalCount=()=>Number(run(`SELECT count(*) FROM paige_invoice_operations WHERE invoice_id='${target}' AND command->>'action'='invoice.record_provider_disposition';`));
 const unchanged=()=>run(`SELECT jsonb_build_object('invoice',to_jsonb(i),'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM paige_invoice_payments p WHERE p.invoice_id=i.id),
 'journal',(SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM paige_invoice_operations o WHERE o.invoice_id=i.id),
 'rail',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM paige_workspace_events e WHERE e.tenant_id=i.tenant_id)) FROM paige_invoices i WHERE i.id='${target}';`);
 const refused=(label,sql,pattern)=>{const before=unchanged();assert.throws(()=>run(sql),pattern,label);check(label,unchanged()===before);};
 const before=position(),cmd=command(),p=preview(cmd);
 check('returned cash cannot silently reopen or forgive debt',before.financial_standing==='needs_review'&&before.actual_outstanding_minor===null&&before.refund_payable_minor===null);
 check('original native preview binds exact payment and debt consequence',p.eligible===true&&p.provider_disposition.review_version===2&&p.provider_disposition.provider_operation_id===payment&&p.provider_disposition.retained_minor===40000&&p.provider_disposition.outstanding_after_minor===310000);
 refused('changed native consequence cannot execute',native(randomUUID(),cmd,{...p.provider_disposition,outstanding_after_minor:0}),/Approved financial consequence changed/);
 refused('existing canonical confirmation remains required',service(`SELECT execute_sales_invoice_command('${actor}','${tenant}','${randomUUID()}',${literal(cmd)},${literal({...governance(cmd.action),approval_channel:'standing_autonomy_setting',approved_financial_review:p.provider_disposition})});`),/Canonical invoice governance required/);
 const originalPayment=run(`SELECT to_jsonb(p) FROM paige_invoice_payments p WHERE p.provider_operation_id='${payment}';`);
 const id=randomUUID(),recorded=value(native(id,cmd,p.provider_disposition));
 check('actual original command writes one internal decision and real Rail',recorded.ok===true&&recorded.outcome==='financial_decision_recorded'&&recorded.payment_moved===false&&recorded.customer_notified===false&&recorded.rail_recorded===true&&journalCount()===1);
 check('original captured receipt stays immutable and exact',run(`SELECT to_jsonb(p) FROM paige_invoice_payments p WHERE p.provider_operation_id='${payment}';`)===originalPayment);
 check('current canonical native standing returns owner-selected debt',position().financial_standing==='recorded'&&position().actual_outstanding_minor===310000&&position().refund_payable_minor===0);
 const version=currentVersion(),recovered=value(native(id,cmd,p.provider_disposition));
 check('lost acknowledgment recovers exact original result with no extra effect',JSON.stringify(recovered)===JSON.stringify(recorded)&&currentVersion()===version&&journalCount()===1);
 refused('manual correction cannot alter the disposition journal',`UPDATE paige_invoice_operations SET result='{}' WHERE id='${id}';`,/append-only/);
 refused('financial receipt absence prevents success replay',`BEGIN;DELETE FROM paige_workspace_events WHERE id='${recorded.receipt_id}';`+service(`SELECT read_sales_invoice_command_result('${actor}','${tenant}','${id}',${literal(cmd)});`),/Original financial decision receipt unavailable/);
 const creditCommand=command('credit_returned_principal',10000),creditPreview=preview(creditCommand),creditId=randomUUID();
 check('a correction presents original credit and revised debt before execution',creditPreview.provider_disposition.credit_before_minor===0&&creditPreview.provider_disposition.credit_after_minor===10000&&creditPreview.provider_disposition.outstanding_after_minor===300000);
 const credited=value(native(creditId,creditCommand,creditPreview.provider_disposition));
 check('correction appends without replacing the initial decision',credited.disposition_version===2&&journalCount()===2&&position().credit_minor===10000&&position().actual_outstanding_minor===300000);
 const sameCommand=command('credit_returned_principal',10000),samePreview=preview(sameCommand),sameVersion=currentVersion();
 const noChange=value(native(randomUUID(),sameCommand,samePreview.provider_disposition));
 check('a fresh same-treatment review adds no financial credit or version',noChange.outcome==='financial_decision_unchanged'&&noChange.disposition_version===2&&currentVersion()===sameVersion&&position().credit_minor===10000);
 const staleCommand=command(),staleProfile=preview(staleCommand).provider_disposition;
 observe({...empty,refunds:[{...refund,status:'failed',failure_balance_transaction:balance('txn_DispositionFailure',10000)}]});
 refused('a new original provider event invalidates the old review',native(randomUUID(),staleCommand,staleProfile),/Invoice financial source changed/);
 check('a provider refund reversal retains the prior credit without guessing debt',position().financial_standing==='needs_review'&&position().actual_outstanding_minor===null&&position().credit_minor===10000);
 const retainedCommand=command('credit_returned_principal',10000),retainedPreview=preview(retainedCommand);
 check('failed refund does not silently cancel an owner credit',retainedPreview.provider_disposition.retained_minor===50000&&retainedPreview.provider_disposition.returned_minor===0&&retainedPreview.provider_disposition.credit_after_minor===10000&&retainedPreview.provider_disposition.outstanding_after_minor===290000);
 value(native(randomUUID(),retainedCommand,retainedPreview.provider_disposition));
 check('same credit amount on a changed provider incarnation records a new decision',position().original_payment_decisions[0].financial_decision.version===3&&position().credit_minor===10000&&position().actual_outstanding_minor===290000);
 const bad={...command('credit_returned_principal',50001)};
 refused('credit cannot exceed its original captured payment',service(`SELECT preview_sales_invoice_command('${actor}','${tenant}',${literal(bad)});`),/Credit exceeds original captured principal/);
 refused('a foreign workspace cannot inspect the financial review',service(`SELECT preview_sales_invoice_command('${actor}','${otherTenant}',${literal(command())});`),/workspace|authority/i);
 refused('unapproved browser role cannot invoke private financial calculation',`SET ROLE authenticated;SELECT * FROM _sales_invoice_financial_position_rows('${tenant}','${target}',3,NULL::jsonb);`,/permission denied/);
 const replayBefore=position();run('BEGIN;'+candidate+'COMMIT;');
 check('candidate replay retains current financial result and exact door metadata',JSON.stringify(position())===JSON.stringify(replayBefore)&&metadata()===beforeMetadata);
 const sameId=randomUUID(),raceCommand=command(),raceProfile=preview(raceCommand).provider_disposition;
 const raceCount=journalCount(),raceVersion=currentVersion();
 const session=(id,cmd,profile)=>`BEGIN;`+service(`SELECT jsonb_build_object('backend',pg_backend_pid(),'result',execute_sales_invoice_command('${actor}','${tenant}','${id}',${literal(cmd)},${literal({...governance(cmd.action),approved_financial_review:profile})}));SELECT pg_sleep(0.1);COMMIT;`);
 const duplicate=await Promise.all([execute(session(sameId,raceCommand,raceProfile)),execute(session(sameId,raceCommand,raceProfile))]);
 assert(duplicate.every(row=>row.code===0),duplicate.map(row=>row.err).join('\n'));
 const raceRows=duplicate.map(row=>JSON.parse(row.out.split('\n').find(line=>line.startsWith('{'))));
 check('two actual sessions recover one original financial decision',raceRows[0].backend!==raceRows[1].backend&&JSON.stringify(raceRows[0].result)===JSON.stringify(raceRows[1].result)&&journalCount()===raceCount+1&&currentVersion()===raceVersion+1);
 check('duplicate sessions retain exactly one canonical Rail receipt',run(`SELECT count(*) FROM paige_workspace_events WHERE tenant_id='${tenant}' AND source_id='${sameId}' AND capability_key='sales_record_provider_disposition';`)==='1');
 const competingCommand=command('credit_returned_principal',5000),competingProfile=preview(competingCommand).provider_disposition;
 const ids=[randomUUID(),randomUUID()],countBefore=journalCount();
 const competing=await Promise.all(ids.map(id=>execute(session(id,competingCommand,competingProfile))));
 check('different operation identities cannot apply the same stale financial review twice',competing.filter(row=>row.code===0).length===1&&competing.some(row=>row.code!==0&&/Invoice financial source changed/.test(row.err))&&journalCount()===countBefore+1&&position().credit_minor===5000);
 const interruptedId=randomUUID(),interruptedCommand=command('credit_returned_principal',10000),interruptedProfile=preview(interruptedCommand).provider_disposition;
 const interruptCount=journalCount();
 const interrupted=await execute('BEGIN;'+native(interruptedId,interruptedCommand,interruptedProfile)+'COMMIT;SELECT 1/0;');
 assert(interrupted.code!==0&&/division by zero/.test(interrupted.err),'deliberate failure occurs only after native commit');
 // Explicit post-commit client-observation fault, not a network/provider crash claim.
 const restored=value(native(interruptedId,interruptedCommand,interruptedProfile));
 check('post-commit observation failure recovers one stored operation and receipt',restored.ok===true&&restored.operation.id===interruptedId&&journalCount()===interruptCount+1&&position().credit_minor===10000
  &&run(`SELECT count(*) FROM paige_workspace_events WHERE tenant_id='${tenant}' AND source_id='${interruptedId}' AND capability_key='sales_record_provider_disposition';`)==='1');
 assert.equal(checks,30,'all original30 financial-decision controls retained before accepted-plan composition');
 const originalChecks=checks;
 const planInvoice=plan.effective.invoice_id;
 const planVersion=()=>Number(run(`SELECT billing_lifecycle_version FROM paige_invoices WHERE id='${planInvoice}';`));
 const accepted=()=>value(`SELECT _sales_invoice_accepted_obligations(i,'${plan.effective.signing_id}') FROM paige_invoices i WHERE i.id='${planInvoice}';`);
 const planPosition=()=>value(`SELECT financial_position FROM _sales_invoice_financial_position_rows('${plan.tenant_id}','${planInvoice}',3,NULL::jsonb);`);
 const planGov=action=>({...governance(action),actor_user_id:plan.actor_id,tenant_id:plan.tenant_id});
 const planPreview=cmd=>value(service(`SELECT preview_sales_invoice_command('${plan.actor_id}','${plan.tenant_id}',${literal(cmd)});`));
 const planNative=(id,cmd,profile)=>service(`SELECT execute_sales_invoice_command('${plan.actor_id}','${plan.tenant_id}','${id}',${literal(cmd)},${literal({...planGov(cmd.action),approved_financial_review:profile})});`);
 const initial=accepted();
 check('the real accepted-source reader retains original deposit and ten installments',initial.state==='available'&&initial.obligations.length===11&&initial.obligations[0].scheduled_minor===50000&&initial.obligations.slice(1).every(row=>row.scheduled_minor===30000));
 const retainedTerms=run(`SELECT jsonb_build_object('terms',to_jsonb(t),'signing',(SELECT to_jsonb(a) FROM paige_agreements a WHERE a.id='${plan.effective.signing_id}'),
 'invoice_principal',(SELECT amount_total_cents FROM paige_invoices WHERE id='${planInvoice}'),'invoice_document',(SELECT billing_document FROM paige_invoices WHERE id='${planInvoice}')) FROM tenant_client_agreements t WHERE t.id='${plan.effective.commercial_terms_id}';`);
 function settlePlan(sequence,environment='live'){
  const obligation=accepted().obligations[sequence-1],id=randomUUID(),token=randomUUID(),tag=id.replaceAll('-','');
  assert(obligation&&obligation.remaining_minor>0,'original positive accepted target');
  const cmd={action:'invoice.payment_request',invoice_id:planInvoice,client_id:plan.client_id,expected_version:planVersion(),issued_snapshot_version:1,
   provider:'stripe',merchant_account_id:'acct_fixturePlan',merchant_binding_version:environment==='live'?1:2,environment,amount_minor:obligation.remaining_minor,currency:'usd',purpose:sequence===1?'deposit':'installment',obligation};
  run(service(`SELECT prepare_sales_invoice_payment_request('${plan.actor_id}','${plan.tenant_id}','${id}',${literal(cmd)},${literal(planGov(cmd.action))});
   SELECT claim_sales_invoice_payment_request('${plan.tenant_id}','${id}','${token}');
   SELECT finalize_sales_invoice_payment_request('${plan.tenant_id}','${id}','${token}','customer_action_required','cs_${environment}_${tag}','open','https://checkout.stripe.com/c/pay/cs_${environment}_${tag}',NULL);
   SELECT allocate_verified_sales_invoice_payment('${plan.tenant_id}','${id}','${token}',${literal({provider:'stripe',merchant_account_id:'acct_fixturePlan',environment,provider_object_id:`cs_${environment}_${tag}`,provider_transaction_id:`ch_${tag}`,provider_settlement_id:`txn_${tag}`,amount_minor:cmd.amount_minor,currency:'usd',status:'verified',readback_reference:`req_${tag}`,invoice_id:planInvoice,client_id:plan.client_id,invoice_version:cmd.expected_version,issued_snapshot_version:1,provider_received_at:new Date(Date.now()-120000).toISOString()})});`));
  return {id,token,tag};
 }
 function observePlan(payment,amount,status){
  const context=value(service(`SELECT read_sales_invoice_provider_observation_context('${plan.tenant_id}','${payment.id}');`));
  const row={id:'re_'+payment.tag,amount_minor:amount,currency:'usd',status,created_at:new Date(Date.now()-60000).toISOString(),
   balance_transaction:balance('txn_debit'+payment.tag,-amount),failure_balance_transaction:status==='succeeded'?null:balance('txn_return'+payment.tag,amount)};
  run(service(`SELECT record_sales_invoice_provider_observation('${plan.tenant_id}','${payment.id}','${payment.token}',${context.observation_version},${literal({state:'observed',provider_transaction_id:'ch_'+payment.tag,provider_settlement_id:'txn_'+payment.tag,refunds:[row],disputes:[]})},'evt_PlanDisposition');`));
 }
 function planCommand(payment,credit_minor){
  const context=value(service(`SELECT read_sales_invoice_provider_observation_context('${plan.tenant_id}','${payment.id}');`));
  const old=planPosition().original_payment_decisions.find(row=>row.provider_operation_id===payment.id);
  return {action:'invoice.record_provider_disposition',invoice_id:planInvoice,expected_version:planVersion(),provider_operation_id:payment.id,
   observation_id:context.observation_id,observation_version:context.observation_version,expected_disposition_version:old?.financial_decision.version??0,
   decision:'credit_returned_principal',credit_minor,reason:'Fixture owner reviewed the exact accepted payment and retained cash.'};
 }
 const deposit=settlePlan(1);observePlan(deposit,10000,'failed');
 const depositCommand=planCommand(deposit,10000),depositReview=planPreview(depositCommand).provider_disposition;
 check('accepted deposit credit keeps unpaid future installments and a separate refund payable',depositReview.outstanding_after_minor===300000&&depositReview.refund_payable_after_minor===10000&&depositReview.retained_minor===50000);
 value(planNative(randomUUID(),depositCommand,depositReview));
 check('canonical original targets retain both liabilities without offset',planPosition().actual_outstanding_minor===300000&&planPosition().refund_payable_minor===10000
  &&planPosition().obligations[0].refund_payable_minor===10000&&planPosition().obligations.slice(1).every(row=>row.actual_outstanding_minor===30000));
 const installment=settlePlan(2);observePlan(installment,5000,'succeeded');observePlan(deposit,10000,'canceled');
 check('two changed original payment sources keep total standing unknown',planPosition().financial_standing==='needs_review'&&planPosition().actual_outstanding_minor===null&&planPosition().refund_payable_minor===null);
 const installmentCommand=planCommand(installment,5000),installmentReview=planPreview(installmentCommand).provider_disposition;
 check('one original payment can be reviewed without inventing other balances',installmentReview.standing_before==='needs_review'&&installmentReview.standing_after==='needs_review'&&installmentReview.outstanding_after_minor===null&&installmentReview.refund_payable_after_minor===null);
 const installmentResult=value(planNative(randomUUID(),installmentCommand,installmentReview));
 check('actual first decision persists while the other payment is unresolved',installmentResult.ok===true&&installmentResult.provider_disposition_review.standing_after==='needs_review'&&planPosition().credit_minor===15000&&planPosition().actual_outstanding_minor===null);
 const repeatCommand=planCommand(installment,5000),repeatReview=planPreview(repeatCommand).provider_disposition,repeatVersion=planVersion();
 const repeated=value(planNative(randomUUID(),repeatCommand,repeatReview));
 check('same selected treatment recovers without claiming global completion',repeated.outcome==='financial_decision_unchanged'&&repeated.invoice_version===repeatVersion&&repeated.provider_disposition_review.outstanding_after_minor===null);
 const currentDeposit=planCommand(deposit,10000),currentDepositReview=planPreview(currentDeposit).provider_disposition;
 value(planNative(randomUUID(),currentDeposit,currentDepositReview));
 check('final native target balances never net refund liability against future installments',planPosition().financial_standing==='recorded'&&planPosition().actual_outstanding_minor===270000&&planPosition().refund_payable_minor===10000&&planPosition().credit_minor===15000);
 check('the exact original installment remains independently satisfied by cash and explicit credit',planPosition().obligations[1].scheduled_minor===30000&&planPosition().obligations[1].credit_minor===5000&&planPosition().obligations[1].actual_allocated_minor===25000&&planPosition().obligations[1].actual_outstanding_minor===0);
 run(`UPDATE tenant_stripe_accounts SET provider_environment='test',binding_version=2 WHERE tenant_id='${plan.tenant_id}';`);
 const testPayment=settlePlan(3,'test');observePlan(testPayment,1000,'succeeded');
 check('TEST receipt and refund history cannot satisfy actual accepted obligations',planPosition().actual_outstanding_minor===270000&&planPosition().refund_payable_minor===10000&&planPosition().credit_minor===15000&&planPosition().obligations[2].actual_outstanding_minor===30000);
 assert.throws(()=>planPreview(planCommand(testPayment,1000)),/Original LIVE payment unavailable/);
 check('TEST provider cash cannot acquire an actual commercial credit',planPosition().credit_minor===15000&&planPosition().actual_outstanding_minor===270000);
 check('signed terms, original agreement and issued document remain byte exact',run(`SELECT jsonb_build_object('terms',to_jsonb(t),'signing',(SELECT to_jsonb(a) FROM paige_agreements a WHERE a.id='${plan.effective.signing_id}'),
 'invoice_principal',(SELECT amount_total_cents FROM paige_invoices WHERE id='${planInvoice}'),'invoice_document',(SELECT billing_document FROM paige_invoices WHERE id='${planInvoice}')) FROM tenant_client_agreements t WHERE t.id='${plan.effective.commercial_terms_id}';`)===retainedTerms);
 assert.equal(checks,42,'all30 original and12 accepted-plan controls retained before source/authority controls');
 const acceptedChecks=checks-originalChecks;
 for(const [change,label,pattern]of [
  ['GRANT EXECUTE ON FUNCTION execute_sales_invoice_command(uuid,uuid,uuid,jsonb,jsonb) TO authenticated;','widened original execution authority is refused',/Original invoice financial door changed/],
  ['GRANT EXECUTE ON FUNCTION _sales_invoice_provider_disposition_command(jsonb) TO authenticated;','widened private financial command authority is refused',/Private invoice financial source changed/],
  ['GRANT EXECUTE ON FUNCTION _sales_invoice_financial_position_rows(uuid,uuid,integer) TO authenticated;','widened original cash reader authority is refused',/Original invoice position source changed/],
  ['ALTER FUNCTION _sales_invoice_accepted_obligations(paige_invoices,uuid) SECURITY DEFINER;','changed original accepted-source invoker boundary is refused',/Original accepted invoice source changed/],
  ['ALTER FUNCTION _sales_invoice_record_provider_disposition(uuid,uuid,uuid,jsonb,jsonb) SECURITY DEFINER;','changed private decision writer invoker boundary is refused',/Private invoice financial source changed/],
 ])refused(label,'BEGIN;'+change+candidate+'ROLLBACK;',pattern);
 const doorDefinition=value("SELECT jsonb_build_object('definition',pg_get_functiondef('public.preview_sales_invoice_command(uuid,uuid,jsonb)'::regprocedure));").definition;
 assert(doorDefinition.includes('\nBEGIN\n'),'exact original preview body anchor');
 refused('changed original preview source is refused before adoption','BEGIN;'+doorDefinition.replace('\nBEGIN\n','\nBEGIN\n -- deliberately changed original source\n')+';'+candidate+'ROLLBACK;',/Original invoice financial door changed/);
 const authorityCommand=command(),authorityReview=preview(authorityCommand).provider_disposition;
 for(const [patch,label]of [["status='inactive'",'revoked membership cannot use an earlier financial review'],["role='member'",'ordinary member cannot use an earlier owner financial review']])
  refused(label,`BEGIN;UPDATE tenant_members SET ${patch} WHERE tenant_id='${tenant}' AND user_id='${actor}';`+native(randomUUID(),authorityCommand,authorityReview),/workspace|authority/i);
 refused('changed prior-decision version cannot be proposed',service(`SELECT preview_sales_invoice_command('${actor}','${tenant}',${literal({...authorityCommand,expected_disposition_version:authorityCommand.expected_disposition_version+1})});`),/Original payment decision source changed/);
 check('all guard controls restore original entry metadata and current financial position',metadata()===beforeMetadata&&planPosition().actual_outstanding_minor===270000&&planPosition().refund_payable_minor===10000);
 for(const [capability,outcome,label]of [
  ['other_fixture_action','capability_failed','another action receipt identity cannot be repurposed'],
  ['sales_record_provider_disposition','capability_succeeded','a success receipt without its original operation cannot authorize a new write'],
 ]){
  const occupied=randomUUID();run(service(`SELECT record_capability_run('${tenant}','${actor}','${capability}','${outcome}','${occupied}',NULL);`));
  const fresh=command(),review=preview(fresh).provider_disposition;
  refused(label,'BEGIN;'+native(occupied,fresh,review)+'ROLLBACK;',/Operation already belongs to another action/);
 }
 const nativeSamples=[id,creditId,installmentResult.operation.id].map(id=>value(`SELECT jsonb_build_object('command',e.command,'operation_id',e.id,'tenant_id',e.tenant_id,'result',e.result) FROM paige_invoice_operations e WHERE e.id='${id}';`));
 check('financial receipt exposes the reviewed consequence without a stale legacy balance',nativeSamples.every(sample=>Object.keys(sample.result.row).length===3
  &&sample.result.row.id===sample.command.invoice_id&&sample.result.row.tenant_id===sample.tenant_id&&sample.result.row.version===sample.result.invoice_version));
 return {proof:'E04_PROVIDER_DISPOSITION_SELECTED_SCHEMA',checks,originalChecks,acceptedChecks,sourceAuthorityChecks:checks-originalChecks-acceptedChecks,status:'PASS',
  source_sha256:createHash('sha256').update(candidate).digest('hex'),source_hashes:Object.fromEntries(['scripts/sql/sales-provider-disposition-proof.mjs','supabase/tests/fixtures/exp04_invoice_provider_disposition.sql','supabase/tests/fixtures/exp04_invoice_provider_cash_position.sql','supabase/tests/fixtures/exp04_invoice_actual_obligations.sql','supabase/tests/fixtures/exp04_accepted_obligation_types.json','supabase/tests/fixtures/exp04_reviewed_commercial_native.sql'].map(file=>[file,createHash('sha256').update(read(file)).digest('hex')])),
  boundary:'Real selected original command/actor/receipt/Rail/provider doors and accepted-source readers with synthetic identity/tables/signing/provider inputs. No hosted Auth, genuine signatures, actual Stripe, full schema or customer acceptance.',samples:{recorded,credited,installmentResult},nativeSamples};
}
