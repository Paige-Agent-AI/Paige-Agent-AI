import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const base=new URL('../',import.meta.url);
function harness(name,allowed,{provider='resend',queued=false,foreign=false}={}) {
 const effects=[],writes=[],scopes=[]; const adapters=new Map();
 const tenant='20000000-0000-4000-8000-000000000001', actor='10000000-0000-4000-8000-000000000001';
 const rows={messages:{id:'message',tenant_id:tenant,status:queued?'queued':'draft',connector_id:'connector',channel_type:'email',meta:{}},channel_connectors:{id:'connector',tenant_id:foreign?'foreign':tenant,active:true,status:'active',channel_type:'email',provider,from_address:'sender@example.test',credentials_vault_ref:'protected-ref',config:{}},tenant_members:{role:'owner',status:'active'},profiles:{active_tenant_id:tenant}};
 const admin={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:async(n,args)=>{
   if(n==='comms_provider_execution_allowed'){scopes.push(args);if(allowed==='throw')throw Error('unavailable');return {data:allowed==='error'?true:allowed,error:allowed==='error'?{}:null};}
   if(n==='current_user_tenant_id')return {data:tenant,error:null};
   if(n==='has_role')return {data:true,error:null};
   if(n==='is_platform_owner')return {data:false,error:null};
   if(n==='tenant_sender_identity')return {data:{from_address:'fallback@example.test',from_name:'Sender'},error:null};
   return {data:null,error:null};
 },from(table){let mutation=false;const q=new Proxy({},{get(_,p){if(p==='then')return r=>r({data:mutation?{id:'message'}:rows[table]??null,error:null});if(p==='maybeSingle'||p==='single')return async()=>({data:mutation?{id:'message'}:rows[table]??null,error:null});return(...args)=>{if(['update','insert','upsert','delete'].includes(p)){mutation=true;writes.push({table,kind:p,payload:args[0]});}return q;};}});return q;}};
 const ctx=vm.createContext({console,Response,Request,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,crypto:webcrypto,btoa,atob,Date,
 createClient:()=>admin,createLimiterClient:()=>admin,adminClient:()=>admin,TEMPLATES:{test:{category:'transactional',component:()=>'',subject:'Subject'}},React:{createElement:()=>''},renderAsync:async()=>'<p>Body</p>',resolveTenantEmailContext:async()=>({branding:{logoUrl:null,brandName:'Tenant'}}),
 decideSendAuthority:async()=>({ok:true,kind:'internal'}),safeFromDisplayName:x=>x,isAuthorizedInternalCaller:async()=>true,operatorUserId:async()=>null,overRateLimit:async()=>false,
 CLIENT_CONTACT_METHODS_EMBED:'contact_methods',clientAddresses:()=>({emails:['guest@example.test'],phones:[]}),
 registerOutboundAdapter:a=>adapters.set(a.channel_type,a),getOutboundAdapter:channel=>adapters.get(channel),buildListUnsubscribeHeaders:()=>({}),
 resolveGmailAccessToken:async()=>{effects.push({vault:true});return {accessToken:'controlled'};},gmailSend:async()=>{effects.push({gmail:true});return {ok:true,id:'controlled'};},resolveSmtpCreds:async()=>{effects.push({vault:true});return {user:'controlled',pass:'controlled'};},smtpSend:async()=>{effects.push({smtp:true});return {ok:true,id:'controlled'};},
 runPreSend:async()=>({proceed:true,outcome:'proceed',reason:null,queueUntil:null}),resolveTenantForUser:async()=>({tenantId:tenant}),Deno:{env:{get:n=>n==='SUPABASE_SERVICE_ROLE_KEY'?'service':'configured'},serve:fn=>ctx.handler=fn},fetch:async(url,options)=>{effects.push({url,payload:options?.body});if(String(url).includes('/token'))return new Response(JSON.stringify({refresh_token:'controlled',access_token:'controlled'}));if(String(url).includes('userinfo'))return new Response(JSON.stringify({email:'sender@example.test',sub:'account'}));return new Response(JSON.stringify({id:'controlled'}));}});
 const helper=readFileSync(new URL('comms-provider-boundary.ts',import.meta.url),'utf8').replace(/\bexport /g,'');
 vm.runInContext(stripTypeScriptTypes(helper),ctx);
 let source=process.env.BOUNDARY_TEST_BASELINE?execFileSync('git',['show',`${process.env.BOUNDARY_TEST_BASELINE}:supabase/functions/${name}/index.ts`],{encoding:'utf8'}):readFileSync(new URL(`${name}/index.ts`,base),'utf8');
 source=source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*/gm,'').replace(/^import\s+["'][^"']+["'];?\s*/gm,'');
 vm.runInContext(stripTypeScriptTypes(source),ctx);
 if(name==='gmail-oauth-callback')vm.runInContext(`verifyState=async()=>({u:'${actor}',w:'${tenant}',t:Date.now()});`,ctx);
 return {effects,writes,scopes,run:body=>ctx.handler(new Request('https://unit.test',{method:'POST',headers:{Authorization:queued?'Bearer service':'Bearer user','Content-Type':'application/json'},body:JSON.stringify(body)}))};
}
for(const mode of [false,'error','throw',null,'true'])for(const provider of ['resend','gmail','smtp'])test(`send-message ${provider}/${mode}: active sender cannot bypass floor`,async()=>{
 const h=harness('send-message',mode,{provider});const r=await h.run({channel:'email',to:'guest@example.test',subject:'Subject',body:'Body',connector_id:'connector'});assert.equal(r.status,403);assert.equal(h.effects.length,0);assert.equal(h.writes.filter(x=>x.payload?.status==='queued').length,0);assert.equal(h.scopes.length,1);
});
for(const mode of [false,'error','throw'])test(`queued service caller ${mode} terminalizes without provider retry`,async()=>{
 const h=harness('send-message',mode,{queued:true});await h.run({channel:'email',to:'guest@example.test',body:'Body',message_id:'message'});assert.equal(h.effects.length,0);assert.ok(h.writes.some(x=>x.payload?.status==='failed'&&x.payload.scheduled_for===null));
});
test('foreign connector refuses before execution authority lookup',async()=>{const h=harness('send-message',true,{foreign:true});const r=await h.run({channel:'email',to:'guest@example.test',body:'Body',connector_id:'connector'});assert.equal(r.status,403);assert.equal(h.effects.length,0);});
for(const mode of [false,'error','throw'])test(`Gmail callback ${mode} refuses before token exchange and Vault write`,async()=>{const h=harness('gmail-oauth-callback',mode);const r=await h.run({code:'controlled',state:'controlled',origin:'https://unit.test'});assert.equal(r.status,403);assert.equal(h.effects.length,0);assert.equal(h.writes.length,0);});
for(const mode of [false,'error','throw'])test(`transactional internal ${mode} refuses before rendering/dispatch`,async()=>{const h=harness('send-transactional-email',mode);const r=await h.run({templateName:'test',recipientEmail:'guest@example.test'});assert.equal(r.status,403);assert.equal(h.effects.length,0);assert.equal(h.writes.length,0);});
test('Gmail ordinary callback retains token exchange payload',async()=>{const h=harness('gmail-oauth-callback',true);await h.run({code:'controlled',state:'controlled',origin:'https://unit.test'});assert.equal(h.effects[0].url,'https://oauth2.googleapis.com/token');assert.equal(new URLSearchParams(h.effects[0].payload).get('code'),'controlled');});

test('ordinary managed Resend still dispatches exactly once',async()=>{const h=harness('send-message',true);await h.run({channel:'email',to:'guest@example.test',subject:'Subject',body:'Body',connector_id:'connector'});assert.equal(h.effects.filter(x=>x.url==='https://api.resend.com/emails').length,1);const sent=JSON.parse(h.effects.find(x=>x.url==='https://api.resend.com/emails').payload);assert.deepEqual(sent.to,['guest@example.test']);assert.equal(sent.subject,'Subject');});
