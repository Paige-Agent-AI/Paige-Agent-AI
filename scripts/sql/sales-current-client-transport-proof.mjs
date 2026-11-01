import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// ORIGINAL public SQL/metadata and money only. Explicit synthetic resolver/calendar
// ports are NOT authenticated-customer, original resolver, time-zone or provider proof.
export function proveCurrentClientFinancialTransport({run,read}){
 let checks=0;const check=(label,ok)=>{assert(ok,label);checks++;console.log('CURRENT CLIENT TRANSPORT PASS '+label);};
 const value=q=>JSON.parse(run(q).split(/\r?\n/).filter(s=>s.startsWith('{')).at(-1));
 const f=JSON.parse(read('supabase/tests/fixtures/exp04_reviewed_commercial_native.sql').match(/\$e04_fixture\$([\s\S]*?)\$e04_fixture\$::jsonb/)[1]);
 const tenant=f.tenant_id,client=f.client_id,invoice=f.effective.invoice_id,plain='e044c198-0000-4000-8000-000000000001',safeClient='e044c205-0000-4000-8000-000000000001';
 const quote=s=>"'"+s.replaceAll("'","''")+"'";
 function original(file,name){
  const s=read(file),m=new RegExp('CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public[.]'+name+'\\s*\\(','i').exec(s);
  assert(m,'original function source required');const t=s.slice(m.index),tag=/\bAS\s+(\$[a-zA-Z0-9_]*\$)/i.exec(t);assert(tag);
  return t.slice(0,t.indexOf(tag[1],tag.index+tag[0].length)+tag[1].length)+';';
 }
 run("DO $port$ BEGIN IF to_regprocedure('public._client_portal_billing_client(uuid)') IS NOT NULL OR to_regprocedure('public._business_time_zone_for_tenant(uuid,timestamptz)') IS NOT NULL THEN RAISE EXCEPTION 'Selected resolver/calendar ports changed; do not overwrite real authority';END IF;END $port$;");
 run("CREATE FUNCTION public._client_portal_billing_client(_tenant uuid) RETURNS uuid LANGUAGE sql SET search_path='' AS $port$ SELECT CASE WHEN _tenant='"+tenant+"'::uuid AND current_setting('test.e04_portal_visible',true) IS DISTINCT FROM 'false' THEN nullif(current_setting('test.e04_portal_client',true),'')::uuid END $port$;REVOKE ALL ON FUNCTION public._client_portal_billing_client(uuid) FROM PUBLIC;CREATE FUNCTION public._business_time_zone_for_tenant(_tenant uuid,_at timestamptz) RETURNS jsonb LANGUAGE sql SET search_path='' AS $port$ SELECT jsonb_build_object('state','configured','zone','America/New_York','local_date','2026-11-01') $port$;REVOKE ALL ON FUNCTION public._business_time_zone_for_tenant(uuid,timestamptz) FROM PUBLIC;");
 run(original('supabase/migrations/20271126010011_e09_customer_invoice_business_calendar.sql','client_portal_invoices_calendar_scoped')+"REVOKE ALL ON FUNCTION client_portal_invoices_calendar_scoped(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION client_portal_invoices_calendar_scoped(uuid,uuid,integer,jsonb) TO authenticated;");
 run(original('supabase/migrations/20271110230000_e09_customer_portal_payments.sql','client_portal_invoice_payment_request')+"REVOKE ALL ON FUNCTION client_portal_invoice_payment_request(uuid,uuid) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION client_portal_invoice_payment_request(uuid,uuid) TO authenticated,service_role;");
 const signature=kind=>kind==='list'?'client_portal_invoices_calendar_scoped(uuid,uuid,integer,jsonb)':'client_portal_invoice_payment_request(uuid,uuid)';
 const metadata=kind=>run("SELECT ((to_jsonb(p)-'prosrc'-'proargdefaults')||jsonb_build_object('defaults',pg_get_expr(proargdefaults,0)))::text FROM pg_proc p WHERE oid='"+signature(kind)+"'::regprocedure;");
 const settings=(version,who=client,visible=true,raw)=>"SET request.headers="+quote(raw??JSON.stringify(version===null?{}:{'x-paige-invoice-evidence-version':version}))+";SET test.e04_portal_client="+quote(who)+";SET test.e04_portal_visible="+quote(String(visible))+";";
 const call=(kind,{who=client,invoiceId=invoice,business=tenant}={})=>kind==='list'?"public.client_portal_invoices_calendar_scoped('"+business+"','"+who+"',20,NULL)":"public.client_portal_invoice_payment_request('"+invoiceId+"','"+business+"')";
 const point=(kind,version='3',opts={})=>value((opts.before?'BEGIN;':'')+settings(version,opts.actorClient??client,opts.visible!==false,opts.raw)+(opts.before??'')+"SELECT jsonb_build_object('result',"+call(kind,opts)+");"+(opts.before?'ROLLBACK;':'')).result;
 function refuses(kind,version,code,opts={}){
  assert(/^[0-9A-Z]{5}$/.test(code));run((opts.before?'BEGIN;':'')+settings(version,opts.actorClient??client,opts.visible!==false,opts.raw)+(opts.before??'')
   +"DO $expected$ BEGIN BEGIN PERFORM "+call(kind,opts)+";RAISE EXCEPTION 'expected_source_refusal_not_raised';EXCEPTION WHEN SQLSTATE '"+code+"' THEN NULL;END;END $expected$;"+(opts.before?'ROLLBACK;':''));
 }
 const safe=(kind,version=null)=>value("BEGIN;INSERT INTO clients(id,tenant_id) VALUES('"+safeClient+"','"+tenant+"');UPDATE paige_invoices SET contact_id='"+safeClient+"',status='issued',billing_issued_at='2026-10-01',billing_issued_snapshot_version=1,billing_document='{}'::jsonb WHERE id='"+plain+"';"+settings(version,safeClient)+"SELECT jsonb_build_object('result',"+call(kind,{who:safeClient,invoiceId:plain})+");ROLLBACK;").result;
 const withoutClock=v=>Object.fromEntries(Object.entries(v).filter(([k])=>k!=='read_at'));
 const legacyList=safe('list'),legacyPayment=safe('payment'),listMeta=metadata('list'),paymentMeta=metadata('payment');
 check('actual original calendar source body matches production catalogue',run("SELECT md5(prosrc) FROM pg_proc WHERE oid='"+signature('list')+"'::regprocedure;")==='49a0aa9466e6e7a377bfce8c2c1dbca1');
 check('actual original payment source body matches production catalogue',run("SELECT md5(prosrc) FROM pg_proc WHERE oid='"+signature('payment')+"'::regprocedure;")==='e59ce09de1660f47341787a89b7269ec');
 run(read('supabase/tests/fixtures/exp04_client_invoice_financial_transport.sql'));
 const listSource=read('supabase/tests/fixtures/exp04_client_invoice_actual_financial_transport.sql'),paymentSource=read('supabase/tests/fixtures/exp04_client_invoice_actual_payment_read.sql');
 for(let i=0;i<2;i++)run('BEGIN;'+listSource+paymentSource+'COMMIT;');
 check('same public list OID defaults owner flags settings ACL survive',metadata('list')===listMeta);
 check('same public payment OID defaults owner flags settings ACL survive',metadata('payment')===paymentMeta);
 assert.deepEqual(withoutClock(safe('list')),withoutClock(legacyList));check('whole accurate legacy list except genuine read clock remains exact',true);
 assert.deepEqual(safe('payment'),legacyPayment);check('whole accurate legacy per-invoice response stays exact',true);
 const page=point('list'),row=page.invoices.find(r=>r.id===invoice),payment=point('payment');
 check('current existing list transport declares schema4/native financial3',page.schema_version===4&&page.payment_evidence_version===2&&page.financial_evidence_version===3);
 check('authorized-source selected invoice retains actual debt/refund/credit',row.remaining_minor==='210000'&&row.refund_payable_minor==='15000'&&row.credit_minor==='20000');
 check('an unrelated held invoice keeps whole currency totals and open count unknown',page.open_count===null&&page.balances.find(b=>b.currency===row.currency).remaining_minor===null);
 check('original calendar object is carried unchanged from explicit calendar port',page.calendar.state==='configured'&&page.calendar.zone==='America/New_York'&&page.calendar.local_date==='2026-11-01');
 check('current original payment reader copies the SAME debt and adjustments',payment.invoice_id===invoice&&payment.remaining_cents===210000&&payment.refund_payable_minor===15000&&payment.credit_minor===20000&&payment.payment_evidence_version===2&&payment.financial_evidence_version===3);
 check('private evidence and authority credentials do not leave either public result',!['_native_sources','source_hash','dispatch_claim_token','merchant_account_id'].some(k=>JSON.stringify({page,payment}).includes(k)));
 for(const kind of ['list','payment']){
  refuses(kind,null,'40001');refuses(kind,'2','40001');check('wrong older financial view refuses with40001: '+kind,true);
  for(const v of ['4',3]){refuses(kind,v,'22023');check('unsupported/coerced evidence header refuses: '+kind+'/'+v,true);}
 }
 const inactive="UPDATE tenant_client_agreements SET status='inactive' WHERE id=(SELECT commercial_terms_id FROM paige_agreements WHERE id=(SELECT (billing_draft#>>'{agreement_snapshot,id}')::uuid FROM paige_invoices WHERE id='"+invoice+"'));";
 const heldList=point('list','3',{before:inactive}),heldPayment=point('payment','3',{before:inactive});
 check('held source returns null debt/no due judgment in same public list',heldList.invoices.find(r=>r.id===invoice).remaining_minor===null&&heldList.invoices.find(r=>r.id===invoice).past_due===null);
 check('held source returns null payment amount and never supplies a checkout request',heldPayment.remaining_cents===null&&heldPayment.payment_request===null&&heldPayment.financial_standing!=='recorded');
 refuses('list','3','42501',{who:'ffffffff-ffff-4fff-8fff-ffffffffffff'});check('same original expected-client predicate refuses mismatch under identity port',true);
 refuses('payment','3','42501',{invoiceId:'ffffffff-ffff-4fff-8fff-ffffffffffff'});check('same original invoice/client filter refuses absent-or-foreign record',true);
 const foreignTenant='e044c209-0000-4000-8000-000000000001',foreignClient='e044c209-0000-4000-8000-000000000002',foreignInvoice='e044c209-0000-4000-8000-000000000003';
 // Explicit two-tenant fixture ONLY inside rollback; no Auth account or persistent QA business.
 const foreign="INSERT INTO tenants(id,status,name) VALUES('"+foreignTenant+"','active','Synthetic foreign source fixture');INSERT INTO clients(id,tenant_id) VALUES('"+foreignClient+"','"+foreignTenant+"');INSERT INTO paige_invoices SELECT(jsonb_populate_record(NULL::paige_invoices,to_jsonb(i)||jsonb_build_object('id','"+foreignInvoice+"','tenant_id','"+foreignTenant+"','contact_id','"+foreignClient+"','invoice_number','SYN-FOREIGN','status','issued','billing_draft','{}'::jsonb,'billing_document','{}'::jsonb))).* FROM paige_invoices i WHERE i.id='"+invoice+"';";
 refuses('payment','3','42501',{invoiceId:foreignInvoice,before:foreign});check('existing other-tenant invoice is refused by original record filter',true);
 refuses('list','3','42501',{who:foreignClient,before:foreign});check('existing other-tenant client cannot replace the resolved source client',true);
 check('two-tenant negative fixture leaves no persistent business',run("SELECT count(*) FROM tenants WHERE id='"+foreignTenant+"';")==='0');
 refuses('list','3','42501',{visible:false,raw:'not-json'});check('original list resolver branch remains before header parsing under identity port',true);
 check('original per-invoice absent-relationship result precedes malformed header parsing',point('payment','3',{visible:false,raw:'not-json'})===null);
 const drift=[["GRANT EXECUTE ON FUNCTION client_portal_invoices_calendar_scoped(uuid,uuid,integer,jsonb) TO service_role;",listSource],["ALTER FUNCTION client_portal_invoice_payment_request(uuid,uuid) SECURITY INVOKER;",paymentSource]];
 for(const[mutation,source]of drift){assert.throws(()=>run('BEGIN;'+mutation+source+'ROLLBACK;'),/source\/authority changed/);check('public source/authority drift refuses adoption',true);}
 const after=point('list');assert.deepEqual(withoutClock(after),withoutClock(page));check('rollback/replay retain identical public financial and source fields',true);
 return{proof:'E04_CURRENT_CLIENT_FINANCIAL_TRANSPORT',status:'PASS',checks,sample:{page,payment},source_hashes:Object.fromEntries(['scripts/sql/sales-current-client-transport-proof.mjs','supabase/tests/fixtures/exp04_client_invoice_actual_financial_transport.sql','supabase/tests/fixtures/exp04_client_invoice_actual_payment_read.sql'].map(f=>[f,createHash('sha256').update(read(f)).digest('hex')])),boundary:'Original public SQL, exact metadata/filter/order and native current financial engine; explicit synthetic resolver/calendar/schema/signing/provider facts and owner execution. No actual original resolver/Auth/time-zone/Portal/provider/customer acceptance.'};
}
