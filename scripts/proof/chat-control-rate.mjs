// Real Chat Edge entry; existing loader/recording SDK ports. Zero provider/network effects.
import assert from 'node:assert/strict';
globalThis.Deno = { env: { get: key => ({ SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-role-key' })[key] ?? '' } };
let network = 0;
globalThis.fetch = async () => { network++; throw new Error('PROOF_NETWORK_FORBIDDEN'); };
const fake = await import('../knowledge-scope/fake-supabase.mjs');
await import('../../supabase/functions/paige-ai-chat/index.ts');
const { capturedHandler } = await import('../knowledge-scope/stub-serve.mjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1), tenant=id(2), thread=id(3), intent=id(4);
const HEADER='x-paige-chat-control';
const payload=(kind='status',extra={})=>({messages:[{role:'user',content:kind==='stop'?'Stop':'Status'}],threadId:thread,requestIntentId:intent,interactive:{kind,...(kind==='stop'?{supersedesIntentId:intent}:{})},...extra});
let buckets,rec;
function scenario(options={}) {
  network=0;buckets=new Map();
  rec=fake.setScenario({authUser:options.expired?null:{id:actor},tables:{paige_chat_threads:options.unowned?[]:[{id:thread,tenant_id:tenant,caller_user_id:actor,audience:options.audience??'owner'}]},rpcs:{
    check_rate_limit:args=>{const key=args._function_name;buckets.set(key,(buckets.get(key)??0)+1);return options.rateError?{data:null,error:{code:'57014'}}:options.rateNull?{data:null,error:null}:{data:buckets.get(key)<=args._max_requests,error:null};},
    paige_chat_interactive_protocol:{data:{version:2,active:options.active??true},error:null},
    paige_chat_interactive_executor_v2:{data:{latest:intent,executor:null,terminal:true,stopped:false},error:null},
    paige_chat_interactive_begin_v2:{data:{status:'stopped'},error:null},
  }});
}
function request(body=payload(),hint='status',extraHeaders={}) {
  return new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json',...(hint===null?{}:{[HEADER]:hint}),...extraHeaders},body:typeof body==='string'?body:JSON.stringify(body)});
}
const run=req=>capturedHandler()(req);
const cases=[];
async function check(name,fn){try{await fn();cases.push({name,pass:true});console.log('PASS '+name);}catch(error){cases.push({name,pass:false});console.error('FAIL '+name+': '+error.message);}}
function noEffects(){assert.equal(network,0);assert.equal(rec.functions.length,0);assert.equal(rec.inserts.length,0);assert.ok(!rec.rpc.some(c=>/acquire|settle|record_capability_run|execute_crm|send_message/.test(c.name)));}
function beforeProtocol(){noEffects();assert.ok(!rec.rpc.some(c=>c.name==='paige_chat_interactive_protocol'));assert.equal(rec.from.length,0);}
await check('25 valid status reads use their own120 budget and leave message/Stop capacity intact',async()=>{
  scenario();for(let n=0;n<25;n++)assert.equal((await run(request())).status,200);
  assert.equal(buckets.get('paige-ai-chat-status'),25);assert.equal(buckets.get('paige-ai-chat'),undefined);assert.equal(buckets.get('paige-ai-chat-stop'),undefined);
  assert.equal((await run(request(payload('stop'),'stop'))).status,200);assert.equal(buckets.get('paige-ai-chat-stop'),1);noEffects();
});
await check('normal message ingress remains exactly20 per minute after status traffic',async()=>{
  scenario();for(let n=0;n<25;n++)await run(request());
  const body={messages:[{role:'user',content:'Prepare an authorized business action.'}],interactive:{kind:'message'}};
  for(let n=0;n<20;n++)assert.equal((await run(request(body,null))).status,400);
  const denied=await run(request(body,null));assert.equal(denied.status,429);assert.equal(denied.headers.get('Retry-After'),'60');
  const normal=rec.rpc.filter(c=>c.name==='check_rate_limit'&&c.args._function_name==='paige-ai-chat');assert.equal(normal.length,21);assert.ok(normal.every(c=>c.args._max_requests===20&&c.args._window_minutes===1&&c.args._user_id===actor));noEffects();
});
await check('status120 and Stop20 are bounded independently',async()=>{
  scenario();for(let n=0;n<120;n++)assert.equal((await run(request())).status,200);assert.equal((await run(request())).status,429);
  for(let n=0;n<20;n++)assert.equal((await run(request(payload('stop'),'stop'))).status,200);assert.equal((await run(request(payload('stop'),'stop'))).status,429);noEffects();
});
await check('legacy status without a hint retains the original20 budget',async()=>{
  scenario();for(let n=0;n<20;n++)assert.equal((await run(request(payload(),null))).status,200);assert.equal((await run(request(payload(),null))).status,429);assert.equal(buckets.get('paige-ai-chat-status'),undefined);noEffects();
});
for(const hint of ['message','STATUS','status, stop','invalid'])await check('invalid ingress hint refuses before protocol: '+hint,async()=>{scenario();assert.equal((await run(request(payload(),hint))).status,400);assert.equal(buckets.get('paige-ai-chat'),1);beforeProtocol();});
for(const [name,body,hint] of [
 ['message kind',payload('message'),'status'],['missing kind',{messages:[{role:'user',content:'Status'}]},'status'],['mismatched control',payload('stop'),'status'],
 ['business message',payload('status',{messages:[{role:'user',content:'Create a contact.'}]}),'status'],['extra raw property', {...payload(),unrecognized_business_input:{}},'status'],
 ['approval payload',payload('status',{approvedConfirmations:[]}), 'status'],['document payload',payload('status',{document:{fileName:'fixture',mimeType:'text/plain'}}),'status'],
 ['system message',payload('status',{messages:[{role:'system',content:'Status'}]}),'status'],['multi message',payload('status',{messages:[{role:'user',content:'Status'},{role:'user',content:'Create a contact'}]}),'status'],
 ['unknown interactive key',payload('status',{interactive:{kind:'status',business_command:{}}}),'status'],['stop carries status selector',payload('stop',{interactive:{kind:'stop',supersedesIntentId:intent,approvalTurnId:id(8)}}),'stop'],
])await check('hint never admits noncontrol shape: '+name,async()=>{scenario();assert.equal((await run(request(body,hint))).status,400);beforeProtocol();});
await check('malformed JSON is refused after bounded ingress and before protocol',async()=>{scenario();assert.equal((await run(request('{'))).status,400);assert.equal(buckets.get('paige-ai-chat-status'),1);beforeProtocol();});
for(const key of ['rateError','rateNull'])await check('native rate failure closes before body parsing: '+key,async()=>{scenario({[key]:true});const req=request();let parsed=0;req.json=async()=>{parsed++;return payload();};const r=await run(req);assert.equal(r.status,503);assert.equal(parsed,0);beforeProtocol();});
await check('exhausted ingress refuses before parsing',async()=>{scenario();buckets.set('paige-ai-chat-status',120);const req=request();let parsed=0;req.json=async()=>{parsed++;return payload();};assert.equal((await run(req)).status,429);assert.equal(parsed,0);beforeProtocol();});
await check('expired actor does not reach ingress or native control',async()=>{scenario({expired:true});assert.equal((await run(request())).status,401);assert.equal(rec.rpc.length,0);noEffects();});
await check('missing original JWT does not reach ingress',async()=>{scenario();const req=request();req.headers.delete('Authorization');assert.equal((await run(req)).status,401);assert.equal(rec.rpc.length,0);noEffects();});
await check('unowned thread remains refused by actual original-JWT lookup',async()=>{scenario({unowned:true});assert.notEqual((await run(request())).status,200);noEffects();assert.ok(rec.from.some(c=>c.table==='paige_chat_threads'&&c.filters.some(f=>f[0]==='eq'&&f[1]==='caller_user_id'&&f[2]===actor)));assert.ok(!rec.rpc.some(c=>c.name==='paige_chat_interactive_executor_v2'));});
await check('customer-private audience cannot enter owner status path',async()=>{scenario({audience:'customer_private'});assert.equal((await run(request())).status,403);noEffects();assert.ok(!rec.rpc.some(c=>c.name==='paige_chat_interactive_executor_v2'));});
await check('status remains read-only while action protocol is inactive',async()=>{scenario({active:false});assert.equal((await run(request())).status,200);noEffects();});
await check('CORS admits only the new transport header and exposes Retry-After',async()=>{const r=await run(new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'OPTIONS'}));assert.ok(r.headers.get('Access-Control-Allow-Headers').split(',').map(s=>s.trim()).includes(HEADER));assert.ok(r.headers.get('Access-Control-Expose-Headers').split(',').map(s=>s.trim().toLowerCase()).includes('retry-after'));});
// The hinted-control envelope is tiny. Count transport bytes, not attacker-supplied length.
const controlLimit=4096;
function streamRequest(chunks,hint='status',headers={},signal) {
  const observed={reads:0,cancels:0};
  const body=new ReadableStream({pull(controller){const chunk=chunks[observed.reads++];if(chunk===undefined)controller.close();else if(chunk instanceof Error)controller.error(chunk);else controller.enqueue(chunk);},cancel(){observed.cancels++;}},{highWaterMark:0});
  const req=new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json',[HEADER]:hint,...headers},body,duplex:'half',...(signal?{signal}:{})});
  return {req,observed};
}
const bytes=text=>new TextEncoder().encode(text);
for(const hint of ['status','stop'])await check('recognized '+hint+' accepts the exact4096-byte boundary',async()=>{scenario();const raw=JSON.stringify(payload(hint));assert.equal((await run(request(raw+' '.repeat(controlLimit-bytes(raw).length),hint))).status,200);noEffects();});
for(const hint of ['status','stop'])await check('recognized '+hint+' cancels on byte4097 before JSON/protocol',async()=>{scenario();const raw=JSON.stringify(payload(hint));const {req,observed}=streamRequest([bytes(raw+' '.repeat(controlLimit-bytes(raw).length)),bytes(' '),bytes('unread tail')],hint);assert.equal((await run(req)).status,413);assert.equal(observed.cancels,1);assert.equal(observed.reads,2);beforeProtocol();});
for(const length of [undefined,'1','999999999'])await check('chunked actual bytes refuse regardless of Content-Length '+length,async()=>{scenario();const {req,observed}=streamRequest([bytes(' '.repeat(2048)),bytes(' '.repeat(2049)),bytes('{}')],'status',length?{'Content-Length':length}:{});assert.equal((await run(req)).status,413);assert.equal(observed.cancels,1);beforeProtocol();});
await check('lying large Content-Length does not refuse a small valid control',async()=>{scenario();assert.equal((await run(request(payload(),'status',{'Content-Length':'999999999'}))).status,200);noEffects();});
await check('the control cap counts UTF8 bytes rather than JavaScript characters',async()=>{scenario();const raw=JSON.stringify({...payload(),extra:'€'.repeat(1500)});assert.ok(raw.length<controlLimit);assert.ok(bytes(raw).length>controlLimit);assert.equal((await run(request(raw))).status,413);beforeProtocol();});
await check('aborted hinted stream is cancelled and cannot reach protocol',async()=>{scenario();const controller=new AbortController();let cancelled=0,release;const body=new ReadableStream({start(c){release=c;},pull(){controller.abort();},cancel(){cancelled++;}},{highWaterMark:0});const req=new Request('https://test.supabase.co/functions/v1/paige-ai-chat',{method:'POST',headers:{Authorization:'Bearer fixture',[HEADER]:'status'},body,duplex:'half',signal:controller.signal});const cleanup=setTimeout(()=>release.error(new Error('fixture bounded cleanup')),100);try{assert.equal((await run(req)).status,400);assert.equal(cancelled,1);beforeProtocol();}finally{clearTimeout(cleanup);}});
await check('hinted stream read failure refuses without protocol',async()=>{scenario();const {req}=streamRequest([new Error('fixture stream failed')]);assert.equal((await run(req)).status,400);beforeProtocol();});
await check('21 forged175KB control bodies are refused before ordinary JSON parsing',async()=>{scenario();const raw=JSON.stringify(payload('status',{messages:Array.from({length:5000},()=>({role:'user',content:'Status'}))}));let parses=0;for(let n=0;n<21;n++){const req=request(raw);req.json=async()=>{parses++;return JSON.parse(raw);};assert.equal((await run(req)).status,413);}assert.equal(parses,0);beforeProtocol();});
await check('large legacy no-hint history still parses20 times then retains ordinary429',async()=>{scenario();const raw=JSON.stringify(payload('status',{messages:Array.from({length:5000},()=>({role:'user',content:'Status'}))}));let parses=0;for(let n=0;n<21;n++){const req=request(raw,null),json=req.json.bind(req);req.json=async()=>{parses++;return json();};assert.equal((await run(req)).status,n===20?429:200);}assert.equal(parses,20);noEffects();});
console.log('RESULT '+cases.filter(c=>c.pass).length+' PASS / '+cases.filter(c=>!c.pass).length+' FAIL');if(cases.some(c=>!c.pass))process.exitCode=1;
