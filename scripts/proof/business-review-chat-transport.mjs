/** Real existing endpoint + composer + Chat transport, offline recording SDK.
 * No provider/network, native SQL permission proof or customer acceptance claim.
 * node --import ./scripts/client-memory-authz/register.mjs scripts/proof/business-review-chat-transport.mjs
 */
import assert from 'node:assert/strict';
import { setScenario, createClient } from '../client-memory-authz/fake-supabase.mjs';
const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actor='44444444-4444-4444-8444-444444444444';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
globalThis.Deno={env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon'}[k])}};
globalThis.fetch=async()=>{throw Error('UNEXPECTED_OFFLINE_NETWORK');};
await import('../../supabase/functions/paige-business-review/index.ts');
const {capturedHandler}=await import('../client-memory-authz/stub-serve.mjs');
const handler=capturedHandler();
const {readBusinessSnapshotTransport}=await import('../../supabase/functions/_shared/paige-context/business-review-chat.ts');
const ctx={who:{actorId:actor,tenantId:tenant,role:'owner',accountShape:'solo'},timezone:'America/New_York'};
let passed=0;
for(const mode of ['normal','alias','unknown_input','missing_header','foreign_header','no_auth','rate_limited','switch_during_read']){
 let inRemote=false,changed=false,issuerReads=0;
 const rec=setScenario({authUser:{id:actor},rpcs:{
  current_user_tenant_id:()=>({data:changed?other:tenant,error:null}),
  check_rate_limit:{data:mode!=='rate_limited',error:null},
  issue_analytics_evidence_bundle:()=>{
   assert(inRemote,'Chat worker must not compose/issue locally');issuerReads++;
   if(mode==='switch_during_read')changed=true;
   return{data:null,error:{code:'42501'}};
  },
 },functions:{'paige-business-review?chat=1&finance_sources=1':async options=>{
  inRemote=true;
  try{
   const headers={authorization:'Bearer synthetic-jwt','content-type':'application/json',...options.headers};
   if(mode==='missing_header')delete headers['x-paige-review-scope'];
   if(mode==='foreign_header')headers['x-paige-review-scope']=other;
   if(mode==='no_auth')delete headers.authorization;
   const response=await handler(new Request('https://test.supabase.co/functions/v1/paige-business-review?chat=1&finance_sources=1',{
    method:'POST',headers,body:JSON.stringify(options.body),signal:options.signal,
   }));
   const data=await response.json();
   return {data,error:response.ok?null:{message:'bounded transport refusal'}};
  }finally{inRemote=false;}
 }}});
 const caller=createClient('https://test.supabase.co','synthetic-anon',{global:{headers:{Authorization:'Bearer synthetic-jwt'}}});
 const args=mode==='alias'?{focus:['sales']}:mode==='unknown_input'?{unexpected:true}:{};
 const result=await readBusinessSnapshotTransport(ctx,{caller},args);
 if(mode==='normal'||mode==='alias'){
  assert.equal(result.status,'available');assert(issuerReads>0);
  assert(/could not|unavailable|not available|not read|refused/i.test(result.projection),result.projection);
  assert(!result.projection.includes('USD 0'));
  assert(rec.rpc.filter(r=>r.name==='issue_analytics_evidence_bundle').every(r=>r.client==='jwt'&&r.authorization==='Bearer synthetic-jwt'));
 }else{
  assert.equal(result.status,mode==='unknown_input'?'needs_input':mode==='switch_during_read'?'refused':'unavailable');
  assert.equal(result.projection,undefined);
  if(mode!=='switch_during_read')assert.equal(issuerReads,0);
 }
 assert.equal(rec.functions.length,mode==='unknown_input'?0:1);
 assert(rec.clients.every(c=>c.kind==='jwt'));
 assert.equal(rec.inserts.length,0);assert.equal(rec.uploads.length,0);
 passed++;console.log(`PASS actual endpoint/transport: ${mode}`);
}
console.log(`business-review-chat-transport: ${passed} scenarios passed`);
