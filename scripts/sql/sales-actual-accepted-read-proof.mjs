
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
// Original public caller read and actual financial engine; synthetic schema,
// identity/signing/provider ports only. No hosted Auth or provider acceptance.
export function proveActualAcceptedRead({run,read,otherTenant}){
 const equal=(a,b)=>{try{assert.deepEqual(a,b);return true;}catch{return false;}};
 let checks=0;const check=(label,ok)=>{assert(ok,label);checks++;console.log('ACTUAL ACCEPTED PASS '+label);};
 const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 const value=sql=>JSON.parse(run(sql).split(/\r?\n/).filter(l=>l.startsWith('{')).at(-1));
 const original=(file,name)=>{const s=read(file),a=s.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),t=s.slice(a),m=/\bAS\s+(\$[a-zA-Z0-9_]*\$)/i.exec(t);assert(a>=0&&m,name);return t.slice(0,t.indexOf(m[1],m.index+m[0].length)+m[1].length)+';';};
 const fixture=JSON.parse(read('supabase/tests/fixtures/exp04_reviewed_commercial_native.sql').match(/\$e04_fixture\$([\s\S]*?)\$e04_fixture\$::jsonb/)[1]);
 const p={actor:fixture.actor_id,tenant:fixture.tenant_id,client:fixture.client_id,invoice:fixture.effective.invoice_id,agreement:fixture.effective.signing_id??fixture.effective.agreement_id};
 if(!p.agreement)p.agreement=run("SELECT billing_draft#>>'{agreement_snapshot,id}' FROM paige_invoices WHERE id='"+p.invoice+"';");
 const owned=(sql,version='3',actor=p.actor,tenant=p.tenant)=>"SET ROLE authenticated;SET test.actor='"+actor+"';SET test.workspace='"+tenant+"';SET request.headers='"+(version===null?'{}':JSON.stringify({'x-paige-invoice-evidence-version':version}))+"';"+sql;
 const point=(version='3')=>value(owned("SELECT read_sales_accepted_invoice_obligations('"+p.tenant+"','"+p.invoice+"','"+p.agreement+"');",version));
 run("CREATE TABLE IF NOT EXISTS tenant_products(id uuid PRIMARY KEY,tenant_id uuid);INSERT INTO tenant_products SELECT DISTINCT (l#>>'{catalog_facts,product_id}')::uuid,i.tenant_id FROM paige_invoices i CROSS JOIN LATERAL jsonb_array_elements(coalesce(i.billing_draft->'items','[]'))l WHERE l#>>'{catalog_facts,product_id}' IS NOT NULL ON CONFLICT(id)DO NOTHING;INSERT INTO tenant_products SELECT DISTINCT offer_id,tenant_id FROM tenant_client_agreements WHERE offer_id IS NOT NULL ON CONFLICT(id)DO NOTHING;");
 run(original('supabase/migrations/20270547000000_sales_collections.sql','_sales_collection_validate_terms'));
 run(original('supabase/migrations/20270598000001_sales_commercial_package_read.sql','read_sales_commercial_package'));
 run(original('supabase/migrations/20271113810004_e04_accepted_commercial_evidence.sql','read_sales_accepted_agreement'));
 run(original('supabase/migrations/20271126010010_e04_accepted_invoice_payment_obligations.sql','read_sales_accepted_invoice_obligations'));
 run("REVOKE ALL ON FUNCTION read_sales_accepted_invoice_obligations(uuid,uuid,uuid),read_sales_accepted_agreement(uuid,uuid,uuid),read_sales_commercial_package(uuid,uuid) FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION read_sales_accepted_invoice_obligations(uuid,uuid,uuid),read_sales_accepted_agreement(uuid,uuid,uuid),read_sales_commercial_package(uuid,uuid) TO authenticated;");
 const metadata=()=>run("SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='read_sales_accepted_invoice_obligations(uuid,uuid,uuid)'::regprocedure;");
 const before=metadata(),old=point(null),source=read('supabase/tests/fixtures/exp04_invoice_actual_accepted_read.sql');
 const canonical=value("SELECT financial_position FROM _sales_invoice_financial_position_rows('"+p.tenant+"','"+p.invoice+"',3,NULL::jsonb);");
 const expected=canonical.obligations.map(r=>({reference:r.reference,source_digest:r.source_digest,due_date:r.due_date,scheduled_minor:r.scheduled_minor,remaining_minor:r.actual_outstanding_minor}));
 console.log('ACTUAL ACCEPTED BASELINE '+JSON.stringify({state:old.state,observationState:old.payment_obligations.state,reason:old.payment_obligations.reason,canonicalStanding:canonical.financial_standing,oldFirst:old.payment_obligations.obligations[0],actualFirst:expected[0]}));
 check('baseline cannot expose the current adjusted original targets',old.state==='recorded'&&canonical.financial_standing==='recorded'&&(old.payment_obligations.state==='available'?!equal(old.payment_obligations.obligations,expected):['allocation_conflict','allocation_required'].includes(old.payment_obligations.reason)));
 run('BEGIN;'+source+'COMMIT;');run('BEGIN;'+source+'COMMIT;');
 check('original public OID, arguments, owner, ACL, flags, path and defaults are preserved',metadata()===before);
 const actual=point();
 check('current caller read explicitly versions its native financial target projection',actual.payment_obligations.schema_version===2&&actual.payment_obligations.financial_evidence_version===3&&actual.payment_obligations.state==='available');
 check('all eleven original dated references and exact actual debts equal the canonical engine',expected.length===11&&equal(actual.payment_obligations.obligations,expected));
 check('source-only scheduled targets are never exposed as money owed',!('financial_source_only' in actual.payment_obligations)&&actual.payment_obligations.obligations.some((r,i)=>r.remaining_minor!==canonical.obligations[i].remaining_minor));
 const strip=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['receipt_id','payment_obligations'].includes(k)));
 check('exact original signed payload, wording and immutable evidence remain unchanged',equal(strip(actual),strip(old)));
 const receiptCount=run("SELECT count(*) FROM paige_workspace_events WHERE tenant_id='"+p.tenant+"' AND actor_id='"+p.actor+"' AND source_id='"+actual.receipt_id+"' AND capability_key='read_sales_commercial_package' AND outcome='capability_succeeded';");
 check('original commercial read receipt remains in the canonical Rail',receiptCount==='1');
 if(old.payment_obligations.state==='available'){assert.throws(()=>point(null),/reload the current financial view/);check('older gross callers refuse inaccurate refunded target amounts',true);}else check('older safely held callers keep the exact original held representation',equal(point(null).payment_obligations,old.payment_obligations));
 for(const version of ['4',3]){assert.throws(()=>point(version),/Invalid invoice financial representation/);check('coerced or unsupported target representation refused '+version,true);}
 for(const role of ['anon','service_role']){assert.throws(()=>run("SET ROLE "+role+";SELECT read_sales_accepted_invoice_obligations('"+p.tenant+"','"+p.invoice+"','"+p.agreement+"');"),/permission denied/);check(role+' cannot acquire an Owner target read',true);}
 assert.throws(()=>run(owned("SELECT read_sales_accepted_invoice_obligations('"+otherTenant+"','"+p.invoice+"','"+p.agreement+"');")),/unavailable|authority/i);check('foreign tenant remains refused',true);
 assert.throws(()=>run("BEGIN;UPDATE tenant_members SET status='inactive' WHERE tenant_id='"+p.tenant+"' AND user_id='"+p.actor+"';"+owned("SELECT read_sales_accepted_invoice_obligations('"+p.tenant+"','"+p.invoice+"','"+p.agreement+"');")),/unavailable|authority/i);check('retired actor cannot reuse a target read',true);
 const financialBefore=run("SELECT jsonb_build_object('invoice',(SELECT to_jsonb(i) FROM paige_invoices i WHERE id='"+p.invoice+"'),'operations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM paige_invoice_operations o WHERE invoice_id='"+p.invoice+"'),'payments',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM paige_invoice_payments o WHERE invoice_id='"+p.invoice+"'));");
 const held=value("BEGIN;UPDATE paige_invoices SET status='draft' WHERE id='"+p.invoice+"';"+owned("SELECT read_sales_accepted_invoice_obligations('"+p.tenant+"','"+p.invoice+"','"+p.agreement+"');")+"ROLLBACK;");
 check('unissued original plan stays held without money or selectable targets',held.payment_obligations.state==='held'&&held.payment_obligations.reason==='invoice_not_issued'&&held.payment_obligations.obligations.length===0);
 const missing=value("BEGIN;UPDATE tenant_client_agreements SET status='inactive' WHERE id=(SELECT commercial_terms_id FROM paige_agreements WHERE id='"+p.agreement+"');"+owned("SELECT read_sales_accepted_invoice_obligations('"+p.tenant+"','"+p.invoice+"','"+p.agreement+"');")+"ROLLBACK;");
 check('inactive original terms cannot offer payment targets',missing.payment_obligations.state==='held'&&missing.payment_obligations.obligations.length===0);

 const pendingPayment=canonical.provider_decisions.find(r=>r.verification_pending===false&&r.retained_minor>1);
 assert(pendingPayment,'verified original retained principal for pending observation');
 // The earlier original full-payment proof deliberately installs another synthetic
 // merchant version. Prove that mismatched custody refuses before restoring ONLY
 // this owned fixture's original binding inside a transaction that rolls back.
 assert.throws(()=>run("BEGIN;UPDATE tenant_stripe_accounts SET binding_version=binding_version+1000 WHERE tenant_id='"+p.tenant+"';SET ROLE service_role;SET test.actor='';SELECT read_sales_invoice_provider_observation_context('"+p.tenant+"','"+pendingPayment.provider_operation_id+"');"),/Original payment scope unavailable/);
 check('a mismatched synthetic merchant binding is refused before observation',true);
 const fixtureBinding="UPDATE tenant_stripe_accounts m SET stripe_account_id=o.merchant_account_id,binding_version=o.merchant_binding_version,provider_environment=o.environment FROM paige_invoice_provider_operations o WHERE o.id='"+pendingPayment.provider_operation_id+"' AND m.tenant_id=o.tenant_id;";
 const context=value("BEGIN;"+fixtureBinding+"SET ROLE service_role;SET test.actor='';SELECT read_sales_invoice_provider_observation_context('"+p.tenant+"','"+pendingPayment.provider_operation_id+"');ROLLBACK;");
 const prior=context.observation_version>0?value("SELECT _sales_provider_observation_entry(o,e,o.provider_observation_version-1,true) FROM paige_invoice_provider_operations o JOIN paige_invoice_operations e ON e.id=o.provider_observation_operation_id WHERE o.id='"+pendingPayment.provider_operation_id+"';"):{refunds:[],disputes:[]};
 const snapshot={state:'observed',provider_transaction_id:context.settlement.provider_transaction_id,provider_settlement_id:context.settlement.provider_settlement_id,refunds:[...prior.refunds,{id:'re_Accepted'+randomUUID().replaceAll('-',''),amount_minor:1,currency:'usd',status:'pending',created_at:new Date(Date.now()-60000).toISOString(),balance_transaction:null,failure_balance_transaction:null}],disputes:prior.disputes};
 const pendingSql="BEGIN;"+fixtureBinding+"SET ROLE service_role;SET test.actor='';DO $pending$ BEGIN PERFORM record_sales_invoice_provider_observation('"+p.tenant+"','"+pendingPayment.provider_operation_id+"','"+context.dispatch.dispatch_claim_token+"',"+context.observation_version+","+literal(snapshot)+",'evt_ActualAcceptedPending');END $pending$;";
 const pending=value(pendingSql+owned("SELECT read_sales_accepted_invoice_obligations('"+p.tenant+"','"+p.invoice+"','"+p.agreement+"');")+"ROLLBACK;");
 check('genuine pending original observation holds every target without guessing a zero',pending.payment_obligations.state==='held'&&pending.payment_obligations.reason==='financial_review_required'&&pending.payment_obligations.obligations.length===0);
 for(const change of ["GRANT EXECUTE ON FUNCTION read_sales_accepted_invoice_obligations(uuid,uuid,uuid) TO service_role;","ALTER FUNCTION read_sales_accepted_invoice_obligations(uuid,uuid,uuid) STABLE;"]){assert.throws(()=>run('BEGIN;'+change+source+'ROLLBACK;'),/source\/authority changed/);check('native public authority/metadata drift refuses adoption',true);}
 const after=run("SELECT jsonb_build_object('invoice',(SELECT to_jsonb(i) FROM paige_invoices i WHERE id='"+p.invoice+"'),'operations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM paige_invoice_operations o WHERE invoice_id='"+p.invoice+"'),'payments',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM paige_invoice_payments o WHERE invoice_id='"+p.invoice+"'));");
 check('read/replay and refused cases preserve original financial records exactly',after===financialBefore&&metadata()===before);
 return{proof:'E04_ACTUAL_ACCEPTED_READ_SELECTED_SCHEMA',status:'PASS',checks,sample:actual,boundary:'Original native public read/commercial package/signed-source and current financial engine; synthetic schema/identity/signing/provider ports, no hosted Auth or provider/customer acceptance.',source_hashes:Object.fromEntries(['scripts/sql/sales-actual-accepted-read-proof.mjs','supabase/tests/fixtures/exp04_invoice_actual_accepted_read.sql'].map(f=>[f,createHash('sha256').update(read(f)).digest('hex')]))};
}
