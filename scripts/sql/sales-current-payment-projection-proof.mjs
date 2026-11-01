import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// Canonical link reader ONLY. Checkout-ready operations/URLs are explicitly
// synthetic read fixtures, not prepare/claim/approval/dispatch/provider evidence.
export function proveCurrentPaymentProjection({run,read}){
 let checks=0;const check=(label,ok)=>{assert(ok,label);checks++;console.log('CURRENT PAYMENT LINK PASS '+label);};
 const value=q=>JSON.parse(run(q).split(/\r?\n/).filter(s=>s.startsWith('{')).at(-1));
 const f=JSON.parse(read('supabase/tests/fixtures/exp04_reviewed_commercial_native.sql').match(/\$e04_fixture\$([\s\S]*?)\$e04_fixture\$::jsonb/)[1]);
 const tenant=f.tenant_id,invoice=f.effective.invoice_id,id='e044c204-0000-4000-8000-000000000001',url='https://checkout.stripe.com/c/pay/e04_synthetic_read_fixture_only';
 const original=value("SELECT jsonb_build_object('invoice_version',i.billing_lifecycle_version,'issued_snapshot_version',i.billing_issued_snapshot_version,'client_id',i.contact_id,'currency',lower(i.currency),'merchant',(SELECT to_jsonb(m) FROM tenant_stripe_accounts m WHERE m.tenant_id=i.tenant_id),'template_id',(SELECT op.id FROM paige_invoice_provider_operations op WHERE op.tenant_id=i.tenant_id AND op.invoice_id=i.id ORDER BY op.id LIMIT 1),'financial',(SELECT b.financial_position FROM _sales_invoice_financial_position_rows(i.tenant_id,i.id,3,NULL::jsonb)b)) FROM paige_invoices i WHERE i.id='"+invoice+"' AND i.tenant_id='"+tenant+"';");
 const financial=original.financial,target=financial.obligations.find(r=>r.actual_outstanding_minor>0);
 assert(target&&financial.financial_standing==='recorded'&&original.template_id,'canonical current target/source required');
 const amount=target.actual_outstanding_minor,total=financial.actual_outstanding_minor;
 assert(amount+1<=total,'stale approved target must still fit whole invoice for causal proof');
 const obligation={reference:target.reference,source_digest:target.source_digest,due_date:target.due_date,scheduled_minor:target.scheduled_minor,remaining_minor:amount};
 const command={action:'invoice.payment_request',invoice_id:invoice,client_id:original.client_id,expected_version:original.invoice_version,issued_snapshot_version:original.issued_snapshot_version,provider:'stripe',merchant_account_id:original.merchant.stripe_account_id,merchant_binding_version:original.merchant.binding_version,environment:original.merchant.provider_environment,amount_minor:amount,currency:original.currency,purpose:target.reference.sequence===1?'deposit':'installment',obligation};
 const expiry=value("SELECT jsonb_build_object('valid',clock_timestamp()+interval '1 hour','expired',clock_timestamp()-interval '1 hour');");
 const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 function point({stale=false,unknown=false,remaining=total,foreign=false,expired=false}={}){
  const draft=stale?{...command,amount_minor:amount+1,obligation:{...obligation,remaining_minor:amount+1}}:command;
  const patch={id,tenant_id:tenant,invoice_id:invoice,client_id:original.client_id,invoice_version:original.invoice_version,issued_snapshot_version:original.issued_snapshot_version,provider:'stripe',merchant_account_id:original.merchant.stripe_account_id,merchant_binding_version:original.merchant.binding_version,environment:original.merchant.provider_environment,amount_minor:draft.amount_minor,currency:original.currency,purpose:draft.purpose,command:draft,idempotency_key:'sales-payment-'+id,state:'customer_action_required',provider_object_id:'cs_e04_c204_synthetic_read_only',provider_status:'open',provider_url:url,expires_at:expired?expiry.expired:expiry.valid,cancellation_reason:null,verified_readback:null,settled_at:null,allocation_payment_id:null,reconciliation_work_id:null,provider_observation_version:0,provider_observation_operation_id:null};
  const sql="BEGIN;INSERT INTO paige_invoice_provider_operations SELECT(jsonb_populate_record(NULL::paige_invoice_provider_operations,to_jsonb(op)||"+literal(patch)+"||jsonb_build_object('dispatch_claim_token',gen_random_uuid(),'dispatch_started_at',clock_timestamp()))).* FROM paige_invoice_provider_operations op WHERE op.id='"+original.template_id+"';"
   +(unknown?"UPDATE tenant_client_agreements SET status='inactive' WHERE id=(SELECT commercial_terms_id FROM paige_agreements WHERE id=(SELECT (billing_draft#>>'{agreement_snapshot,id}')::uuid FROM paige_invoices WHERE id='"+invoice+"'));":"")
   +"SELECT _sales_invoice_payment_projection('"+tenant+"','"+(foreign?'ffffffff-ffff-4fff-8fff-ffffffffffff':invoice)+"','"+id+"',"+remaining+");ROLLBACK;";
  return value(sql);
 }
 const metadata=()=>run("SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='_sales_invoice_payment_projection(uuid,uuid,uuid,bigint)'::regprocedure;");
 const meta=metadata(),oldReady=point(),oldStale=point({stale:true}),oldUnknown=point({unknown:true});
 check('baseline original reader exposes the synthetic otherwise valid link',oldReady.provider_url===url);
 check('causal original gap: stale exact target still fits invoice-wide amount',oldStale.provider_url===url);
 check('causal original gap: unknown accepted source did not withhold the link',oldUnknown.provider_url===url);
 const source=read('supabase/tests/fixtures/exp04_invoice_current_payment_projection.sql');
 run('BEGIN;'+source+'COMMIT;');run('BEGIN;'+source+'COMMIT;');
 check('same private OID signature settings flags and ACL remain',metadata()===meta);
 assert.deepEqual(point(),oldReady);check('whole valid original projection stays exact',true);
 const stale=point({stale:true}),held=point({unknown:true});
 check('canonical accepted-target validator withholds the stale URL',stale.provider_url===null);
 check('canonical financial uncertainty withholds the URL',held.provider_url===null);
 check('actual provider state and original closed output remain truthful',stale.state===oldStale.state&&held.state===oldUnknown.state&&Object.keys(stale).sort().join(',')===Object.keys(oldStale).sort().join(','));
 check('an incompatible zero balance cannot unmask an existing link',point({remaining:0}).provider_url===null);
 check('expired original request remains withheld',point({expired:true}).provider_url===null);
 assert.throws(()=>point({foreign:true}),/Invoice unavailable/);check('original tenant/invoice filter still refuses a foreign read',true);
 for(const mutation of ["GRANT EXECUTE ON FUNCTION _sales_invoice_payment_projection(uuid,uuid,uuid,bigint) TO authenticated;","ALTER FUNCTION _sales_invoice_payment_projection(uuid,uuid,uuid,bigint) STABLE;"]){
  assert.throws(()=>run('BEGIN;'+mutation+source+'ROLLBACK;'),/source\/authority changed/);check('source/authority drift refuses installation',true);
 }
 check('all synthetic operations rolled back',run("SELECT count(*) FROM paige_invoice_provider_operations WHERE id='"+id+"';")==='0');
 assert.deepEqual(point(),oldReady);check('refusal and rollback preserve the same valid read',true);
 return{proof:'E04_CANONICAL_PAYMENT_LINK_CURRENTNESS',status:'PASS',checks,source_hashes:Object.fromEntries(['scripts/sql/sales-current-payment-projection-proof.mjs','supabase/tests/fixtures/exp04_invoice_current_payment_projection.sql'].map(f=>[f,createHash('sha256').update(read(f)).digest('hex')])),boundary:'Original native projection, current financial engine and exact target validation. Synthetic selected schema/identity/signing/provider facts and checkout-ready operation/URL fixtures. No approval/prepare/dispatch/provider/customer/Auth acceptance.'};
}
