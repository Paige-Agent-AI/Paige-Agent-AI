import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
// Optional phase of the ORIGINAL disposable PostgreSQL proof. All identities and
// provider facts here are synthetic; no hosted, Stripe or customer acceptance.
export async function proveCaptureObservation({run,read,execute,actor,tenant,client,otherTenant,baseline=false}){
 const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 const service=q=>"SET ROLE service_role;SET test.actor='';"+q;
 const value=q=>JSON.parse(run(q).split(/\r?\n/).find(l=>l.startsWith('{')));
 let checks=0;const check=(label,ok)=>{assert.equal(ok,true,label);checks++;console.log('CAPTURE OBSERVATION PASS '+label);};
 const fixture=read('supabase/tests/fixtures/exp04_capture_observation_commit.sql');
 const candidate=read('supabase/migrations/20271130000004_e04_atomic_capture_observation.sql');
 assert(candidate.endsWith(fixture+'\nCOMMIT;\n'),'CLI carrier retains the exact proven native candidate');
 const guard=candidate.match(/DO \$source\$[\s\S]*?END \$source\$;/)?.[0];assert(guard,'actual carrier source guard');
 if(!baseline){run(candidate);run(candidate);}
 const originalHashes=run("SELECT jsonb_object_agg(oid::regprocedure::text,md5(prosrc)) FROM pg_proc WHERE oid IN ('public.allocate_verified_sales_invoice_payment(uuid,uuid,uuid,jsonb)'::regprocedure,'public.record_sales_invoice_provider_observation(uuid,uuid,uuid,bigint,jsonb,text)'::regprocedure,'public.complete_sales_payment_reconciliation_work(uuid,uuid,text,integer,text)'::regprocedure);");
 const make=()=>{
  const invoice=randomUUID(),operation=randomUUID(),token=randomUUID();
  run(`UPDATE tenant_stripe_accounts SET sales_readback_at=now() WHERE tenant_id='${tenant}';
   INSERT INTO paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,billing_draft_version,billing_draft,
    billing_lifecycle_version,billing_issued_snapshot_version,billing_issued_at,billing_issued_by,billing_document,billing_document_digest)
   VALUES('${invoice}','${tenant}','${client}','INV-CAPTURE-${invoice}','issued',80000,'USD',1,'{}',2,1,now(),'${actor}','{}',repeat('a',64));`);
  const merchant=value(`SELECT jsonb_build_object('account',stripe_account_id,'version',binding_version,'environment',provider_environment) FROM tenant_stripe_accounts WHERE tenant_id='${tenant}';`);
  const command={action:'invoice.payment_request',invoice_id:invoice,client_id:client,expected_version:2,issued_snapshot_version:1,provider:'stripe',
   merchant_account_id:merchant.account,merchant_binding_version:merchant.version,environment:merchant.environment,amount_minor:50000,currency:'usd',purpose:'partial'};
  const gov={actor_user_id:actor,tenant_id:tenant,action:'invoice.payment_request',tool:'sales_create_payment_request',approval_channel:'operator_card',approved_fingerprint:'0123456789abcdef',decision_receipt_recorded:true};
  run(service(`SELECT prepare_sales_invoice_payment_request('${actor}','${tenant}','${operation}',${literal(command)},${literal(gov)});
   SELECT claim_sales_invoice_payment_request('${tenant}','${operation}','${token}');
   SELECT register_sales_payment_reconciliation_work('${tenant}','${operation}');`));
  const claims=value(service('SELECT claim_sales_payment_reconciliation_work(25);')).claims;
  const work=claims.find(w=>w.operation_id===operation);assert(work,'original worker claims the original new operation');
  const suffix=operation.replaceAll('-',''),time=new Date(Date.now()-300000).toISOString();
  const capture={status:'verified',provider:'stripe',merchant_account_id:merchant.account,environment:merchant.environment,
   invoice_id:invoice,client_id:client,invoice_version:2,issued_snapshot_version:1,amount_minor:50000,currency:'usd',provider_object_id:'cs_test_'+suffix,
   provider_transaction_id:'ch_'+suffix,provider_settlement_id:'txn_'+suffix,provider_received_at:time,readback_reference:'initial-work-'+work.work_id};
  const snapshot={state:'observed',provider_transaction_id:capture.provider_transaction_id,provider_settlement_id:capture.provider_settlement_id,
   refunds:[{id:'re_'+suffix,amount_minor:10000,currency:'usd',created_at:time,status:'succeeded',
    balance_transaction:{id:'txn_refund'+suffix,amount_minor:-10000,currency:'usd',status:'available',created_at:time},failure_balance_transaction:null}],disputes:[]};
  return {invoice,operation,token,work,capture,snapshot};
 };
 const call=(f,{scope=tenant,work=f.work,capture=f.capture,snapshot=f.snapshot}={})=>`SELECT complete_sales_capture_observation_work('${scope}','${work.work_id}','${work.server_idempotency_key}',${work.attempt_count},${literal(capture)},${literal(snapshot)});`;
 const f=make();
 const before=()=>run(`SELECT jsonb_build_object('operation',to_jsonb(p),'invoice',to_jsonb(i),'work',to_jsonb(w),
  'payments',(SELECT jsonb_agg(to_jsonb(x)) FROM paige_invoice_payments x WHERE x.provider_operation_id=p.id),
  'journal',(SELECT jsonb_agg(to_jsonb(x)) FROM paige_invoice_operations x WHERE x.invoice_id=i.id),
  'rail',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM paige_workspace_events x WHERE x.tenant_id=p.tenant_id))
  FROM paige_invoice_provider_operations p JOIN paige_invoices i ON i.id=p.invoice_id JOIN paige_durable_work w ON w.id=p.reconciliation_work_id WHERE p.id='${f.operation}';`);
 const pristine=before();
 if(baseline)value(service(call(f))); // genuine old-source positive: missing atomic native seam
 for(const change of [
  'ALTER FUNCTION public.allocate_verified_sales_invoice_payment(uuid,uuid,uuid,jsonb) SECURITY INVOKER;',
  'GRANT EXECUTE ON FUNCTION public.record_sales_invoice_provider_observation(uuid,uuid,uuid,bigint,jsonb,text) TO authenticated;',
  'ALTER FUNCTION public.heartbeat_sales_payment_reconciliation_work(uuid,uuid,text,integer) SET search_path=public;',
  'ALTER FUNCTION public.complete_sales_capture_observation_work(uuid,uuid,text,integer,jsonb,jsonb) SECURITY INVOKER;',
  'GRANT EXECUTE ON FUNCTION public.complete_sales_capture_observation_work(uuid,uuid,text,integer,jsonb,jsonb) TO authenticated;'
 ]){
  assert.throws(()=>run('BEGIN;'+change+guard+'ROLLBACK;'),/recovery.*source\/authority changed/);
  check('actual carrier refuses changed dependency or own replay metadata',before()===pristine);
 }
 for(const role of ['anon','authenticated']){
  assert.throws(()=>run('SET ROLE '+role+';'+call(f)),/permission denied/);check(role+' cannot invoke the service writer',true);
 }
 assert.throws(()=>run("SET ROLE service_role;SET test.actor='"+actor+"';"+call(f)),/Payment operation unavailable/);check('service caller with customer identity is refused',true);
 for(const options of [{scope:otherTenant},{work:{...f.work,server_idempotency_key:'wrong-key'}},{work:{...f.work,attempt_count:f.work.attempt_count+1}},
  {capture:{...f.capture,invoice_id:randomUUID()}},{capture:{...f.capture,amount_minor:49999}},{snapshot:{...f.snapshot,provider_transaction_id:'ch_wrong'}}]){
  assert.throws(()=>run(service(call(f,options))),/unavailable|match|readback|conflict/i);check('scope, attempt or provider source mismatch rolls back',before()===pristine);
 }
 const expired=`BEGIN;UPDATE paige_durable_work SET lease_until=now()-interval '1 second' WHERE id='${f.work.work_id}';`;
 assert.throws(()=>run(expired+service(call(f))+'ROLLBACK;'),/lease unavailable/);check('expired original lease cannot commit provider facts',before()===pristine);
 run(`CREATE FUNCTION proof_capture_observation_rail_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'proof initial observation Rail unavailable';END$$;
  CREATE TRIGGER proof_capture_observation_rail_fail BEFORE INSERT ON paige_workspace_events FOR EACH ROW
  WHEN(NEW.detail->>'effect'='provider_observation_only') EXECUTE FUNCTION proof_capture_observation_rail_fail();`);
 assert.throws(()=>run(service(call(f))),/proof initial observation Rail unavailable/);
 check('second-leg Rail failure rolls back allocation, invoice, journal and original Work together',before()===pristine);
 run('DROP TRIGGER proof_capture_observation_rail_fail ON paige_workspace_events;DROP FUNCTION proof_capture_observation_rail_fail();');
 const success=value(service(call(f)));
 check('commits one historical capture and its actual adjustment receipt',success.state==='reconciled'&&success.operation_id===f.operation&&success.work_id===f.work.work_id&&success.work_status==='succeeded'&&success.observation.state==='observed'&&success.observation.snapshot.refunds[0].amount_minor===10000);
 check('original operation retains the genuine capture and exact observation version',run(`SELECT state='settled' AND verified_readback=${literal(f.capture)} AND provider_observation_version=1 FROM paige_invoice_provider_operations WHERE id='${f.operation}';`)==='t');
 check('one original allocation and one original observation journal entry',run(`SELECT (SELECT count(*) FROM paige_invoice_payments WHERE provider_operation_id='${f.operation}')=1 AND (SELECT count(*) FROM paige_invoice_operations WHERE invoice_id='${f.invoice}' AND command->>'action'='invoice.provider_observation')=1;`)==='t');
 const settled=before(),replayed=value(service(call(f)));
 check('acknowledgment retry returns the SAME receipt without any writes',replayed.replayed===true&&replayed.observation.observation_id===success.observation.observation_id&&before()===settled);
 assert.throws(()=>run(service(call(f,{snapshot:{...f.snapshot,refunds:[]}}))),/replay required|observation changed/);
 check('terminal replay cannot insert a changed first observation',before()===settled);
 const racing=make();
 const race=await Promise.all([execute(service('BEGIN;'+call(racing)+'SELECT pg_sleep(0.15);COMMIT;')),execute(service('BEGIN;'+call(racing)+'COMMIT;'))]);
 check('two real concurrent sessions both return safely',race.every(r=>r.code===0));
 check('race creates exactly one capture and one first observation',run(`SELECT (SELECT count(*) FROM paige_invoice_payments WHERE provider_operation_id='${racing.operation}')=1 AND (SELECT count(*) FROM paige_invoice_operations WHERE invoice_id='${racing.invoice}' AND command->>'action'='invoice.provider_observation')=1;`)==='t');
 const definitionsAfter=run("SELECT jsonb_object_agg(oid::regprocedure::text,md5(prosrc)) FROM pg_proc WHERE oid IN ('public.allocate_verified_sales_invoice_payment(uuid,uuid,uuid,jsonb)'::regprocedure,'public.record_sales_invoice_provider_observation(uuid,uuid,uuid,bigint,jsonb,text)'::regprocedure,'public.complete_sales_payment_reconciliation_work(uuid,uuid,text,integer,text)'::regprocedure);");
 check('all original allocator, observation and Work writer bodies remain exact',definitionsAfter===originalHashes);
 return {status:'PASS',checks,concurrency_cases:1,boundary:'Original selected-schema SQL, real PostgreSQL roles, rollback and concurrent sessions; synthetic provider/identity ports. Hosted and provider acceptance UNVERIFIED.'};
}
