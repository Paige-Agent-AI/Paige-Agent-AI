// E09 Payments: the ACTUAL sales-invoice-document handler and its real helpers (ledger collector,
// portal client), loaded into a VM with only the network seams stubbed. No database, no Stripe.
// PORTAL_TEST_BASELINE=<ref> loads index.ts from that git ref instead (fail-first against the base).
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const base=new URL('../',import.meta.url);
const strip=s=>stripTypeScriptTypes(s.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'').replace(/\bexport /g,''));
const read=path=>{
  if(process.env.PORTAL_TEST_BASELINE){
    try{return execFileSync('git',['show',`${process.env.PORTAL_TEST_BASELINE}:supabase/functions/${path}`],{encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{return '';}
  }
  const url=new URL(path,base);return existsSync(url)?readFileSync(url,'utf8'):'';
};

const INVOICE='e0995400-0000-4000-8000-000000000001',TENANT='e0995200-0000-4000-8000-000000000001';
const SUBJECT='e0995100-0000-4000-8000-000000000003',OTHER='e0995100-0000-4000-8000-000000000004';
const FORGED_CLIENT='e0995300-0000-4000-8000-000000000002';

function harness({subjects=[SUBJECT,SUBJECT],userError=null,rpcData}={}){
  const clients=[],calls=[],pdfs=[];let getUserCalls=0;
  const ledgerPage={invoice_id:INVOICE,version:2,current_invoice_number:'NW-0001',has_more:false,next_cursor:null,
    payment_ledger:{rows:[{id:'r1',ordinal:1}],count:1,as_of:'2027-01-01T00:00:00Z',receipt_total_cents:12000,reversal_total_cents:0}};
  const paymentRequest={invoice_id:INVOICE,invoice_number:'NW-0001',remaining_cents:335000,test_provider_cents:3000,
    payment_request:{amount_minor:50000,currency:'usd',state:'customer_action_required',environment:'test',provider_url:'https://checkout.stripe.com/c/pay/cs_test_open02',expires_at:'2099-01-01T00:00:00Z'}};
  const answer=name=>rpcData&&Object.hasOwn(rpcData,name)?rpcData[name]
    :name==='client_portal_invoice_payment_request'?paymentRequest
    :name==='read_public_sales_invoice_payment_request'?{invoice_number:'NW-0001',remaining_cents:1,payment_request:null}
    :ledgerPage;
  const createClient=(url,key,options)=>{
    const client={key,authorization:options?.global?.headers?.Authorization??null,
      auth:{getUser:async()=>{const id=subjects[Math.min(getUserCalls++,subjects.length-1)];return userError?{data:null,error:userError}:{data:{user:id?{id}:null},error:null};}},
      rpc:async(name,args)=>{calls.push(JSON.parse(JSON.stringify({key,name,args})));return {data:answer(name),error:null};}};
    clients.push(client);return client;
  };
  const env={SUPABASE_URL:'https://unit.test',SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-key'};
  const ctx=vm.createContext({console,Response,Request,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,JSON,Number,Array,Object,String,Promise,Error,
    createClient,overRateLimit:async()=>false,trustedClientIp:()=>'unit',sha256Hex:async()=>'f'.repeat(64),
    renderSalesInvoiceDocument:value=>`<html>${value.invoice_id}|${value.ledger_complete}</html>`,
    renderDocumentPdf:async html=>{pdfs.push(html);return new Uint8Array([37,80,68,70]);},
    Deno:{env:{get:k=>env[k]},serve:fn=>{ctx.handler=fn;}}});
  vm.runInContext(strip(read('_shared/sales-invoice-ledger.ts')),ctx);
  vm.runInContext(strip(read('_shared/portal-invoice-client.ts')),ctx);
  vm.runInContext(strip(read('sales-invoice-document/index.ts')),ctx);
  const run=(query,authorization='Bearer customer-jwt')=>ctx.handler(new Request(`https://unit.test/functions/v1/sales-invoice-document?${query}`,{method:'GET',headers:authorization?{authorization}:{}}));
  return {run,clients,calls,pdfs,getUserCalls:()=>getUserCalls};
}
const portalQuery=(extra='')=>`portal=1&invoice_id=${INVOICE}${extra}`;

test('payment-request: the caller JWT reads the customer RPC and returns its JSON',async()=>{
  const h=harness();const res=await h.run(portalQuery('&format=payment-request'));
  assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/application\/json/);
  const body=await res.json();assert.equal(body.payment_request.provider_url,'https://checkout.stripe.com/c/pay/cs_test_open02');
  const portalCalls=h.calls.filter(c=>c.name.startsWith('client_portal_'));
  assert.deepEqual(portalCalls,[{key:'anon-key',name:'client_portal_invoice_payment_request',args:{p_invoice_id:INVOICE,p_tenant_id:null}}]);
  assert.ok(h.clients.some(c=>c.key==='anon-key'&&c.authorization==='Bearer customer-jwt'),'the read runs as the caller, never the service role');
  assert.ok(!h.calls.some(c=>c.key==='service-key'),'no service-role read on the portal path');
  assert.equal(h.getUserCalls(),2,'the subject is checked before and after the read');
});

test('a forged client_id is never read: the server derives the client',async()=>{
  const h=harness();await h.run(portalQuery(`&client_id=${FORGED_CLIENT}&format=payment-request`));
  assert.ok(!JSON.stringify(h.calls).includes(FORGED_CLIENT));
});

test('tenant_id only narrows, and passes through when it is a uuid',async()=>{
  const h=harness();await h.run(portalQuery(`&tenant_id=${TENANT}&format=payment-request`));
  assert.deepEqual(h.calls.find(c=>c.name==='client_portal_invoice_payment_request').args,{p_invoice_id:INVOICE,p_tenant_id:TENANT});
  const bad=harness();const res=await bad.run(portalQuery('&tenant_id=not-a-uuid&format=payment-request'));
  assert.equal(res.status,404);assert.equal(bad.calls.length,0);
});

test('no JWT, a malformed JWT header, or a malformed invoice id is refused before any read',async()=>{
  for(const [query,auth] of [[portalQuery('&format=payment-request'),null],[portalQuery('&format=payment-request'),'Basic x'],['portal=1&invoice_id=nope',undefined],['portal=1',undefined]]){
    const h=harness();const res=await h.run(query,auth===undefined?'Bearer customer-jwt':auth);
    assert.equal(res.status,404,query);assert.equal(h.calls.length,0,query);
  }
});

test('a session that changes between the two subject checks answers nothing',async()=>{
  for(const format of ['&format=payment-request','']){
    const h=harness({subjects:[SUBJECT,OTHER]});const res=await h.run(portalQuery(format));
    assert.equal(res.status,404,format||'html');
  }
});

test('a failed or missing subject is refused before the read',async()=>{
  const h=harness({userError:{message:'expired'}});const res=await h.run(portalQuery('&format=payment-request'));
  assert.equal(res.status,404);assert.equal(h.calls.filter(c=>c.name.startsWith('client_portal_')).length,0);
  const n=harness({subjects:[null]});assert.equal((await n.run(portalQuery('&format=payment-request'))).status,404);
  assert.equal(n.calls.filter(c=>c.name.startsWith('client_portal_')).length,0);
});

test('no relationship (NULL) or another invoice in the answer is refused',async()=>{
  const none=harness({rpcData:{client_portal_invoice_payment_request:null,client_portal_invoice_ledger:null}});
  assert.equal((await none.run(portalQuery('&format=payment-request'))).status,404);
  assert.equal((await none.run(portalQuery())).status,404);
  const swapped=harness({rpcData:{client_portal_invoice_payment_request:{invoice_id:'e0995400-0000-4000-8000-000000000008',payment_request:null}}});
  assert.equal((await swapped.run(portalQuery('&format=payment-request'))).status,404);
});

test('the document reads the customer ledger through the incumbent collector and renders HTML',async()=>{
  const h=harness();const res=await h.run(portalQuery());
  assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/html/);
  assert.equal(await res.text(),`<html>${INVOICE}|true</html>`);
  assert.deepEqual(h.calls.filter(c=>c.name.startsWith('client_portal_')).map(c=>c.args),[{p_invoice_id:INVOICE,p_tenant_id:null,_limit:100,_cursor:null}]);
  assert.ok(!h.calls.some(c=>c.name==='read_sales_invoice_payment_ledger'),'never the owner ledger');
});

test('format=pdf returns the PDF of the same customer document',async()=>{
  const h=harness();const res=await h.run(portalQuery('&format=pdf'));
  assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),'application/pdf');
  assert.deepEqual(h.pdfs,[`<html>${INVOICE}|true</html>`]);
});

test('the bearer token path is unchanged and wins over portal=1',async()=>{
  const h=harness();const res=await h.run(`token=${'a'.repeat(64)}&portal=1&invoice_id=${INVOICE}&format=payment-request`,null);
  assert.equal(res.status,200);
  assert.deepEqual(h.calls.map(c=>[c.key,c.name]),[['service-key','read_public_sales_invoice_payment_request']]);
});

test('the owner path is unchanged without portal=1',async()=>{
  const h=harness();const res=await h.run(`invoice_id=${INVOICE}&tenant_id=${TENANT}`);
  assert.equal(res.status,200);
  assert.deepEqual(h.calls.map(c=>[c.key,c.name,c.args]),[['anon-key','read_sales_invoice_payment_ledger',{_expected_tenant_id:TENANT,_invoice_id:INVOICE,_limit:100,_cursor:null}]]);
  const noTenant=harness();assert.equal((await noTenant.run(`invoice_id=${INVOICE}`)).status,404,'the owner path still requires its tenant');
});
