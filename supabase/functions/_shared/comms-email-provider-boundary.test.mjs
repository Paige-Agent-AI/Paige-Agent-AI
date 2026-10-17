import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const base=new URL('../',import.meta.url);
function harness(name,allowed,{provider='resend',queued=false,foreign=false,seatAllowed=true,scopeError=false,switchAfterFloor=false,personal=false,initialOtherOwner=false,ownerChangedAtBoundary=false}={}) {
 const effects=[],writes=[],scopes=[],calls=[]; const adapters=new Map();
 const tenant='20000000-0000-4000-8000-000000000001', actor='10000000-0000-4000-8000-000000000001';
 const connector='30000000-0000-4000-8000-000000000001',otherOwner='10000000-0000-4000-8000-000000000002';let activeTenant=tenant,connectorReads=0;
 const rows={messages:{id:'message',tenant_id:tenant,status:queued?'queued':'draft',connector_id:'connector',channel_type:'email',meta:{}},channel_connectors:{id:name==='gmail-oauth-callback'?connector:'connector',tenant_id:foreign?'foreign':tenant,active:true,status:'active',channel_type:'email',provider,from_address:'sender@example.test',credentials_vault_ref:'protected-ref',mailbox_class:personal?'personal':'shared_support',mailbox_owner_user_id:personal?(initialOtherOwner?otherOwner:actor):null,config:{}},tenant_members:{role:'owner',status:'active'},profiles:{active_tenant_id:tenant}};
 const admin={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:async(n,args)=>{
   calls.push({name:n,args:structuredClone(args)});
   if(n==='comms_provider_execution_allowed'){scopes.push(structuredClone(args));if(switchAfterFloor)activeTenant='40000000-0000-4000-8000-000000000001';if(allowed==='throw')throw Error('unavailable');return {data:allowed==='error'?true:allowed,error:allowed==='error'?{}:null};}
   if(n==='current_user_tenant_id')return {data:activeTenant,error:scopeError?{message:'fixture scope read unavailable'}:null};
   if(n==='is_tenant_admin_as')return {data:seatAllowed&&args?._actor===actor&&args?._tenant===tenant,error:null};
   if(n==='has_role')return {data:true,error:null};
   if(n==='is_platform_owner')return {data:false,error:null};
   if(n==='tenant_sender_identity')return {data:{from_address:'fallback@example.test',from_name:'Sender'},error:null};
   if(n==='provision_gmail_connection'){
     assert.equal(args._actor_user_id,actor);assert.equal(args._expected_tenant_id,tenant);
     assert.equal(args._gmail_address,'sender@example.test');assert.equal(args._google_account_id,'account');
     assert.equal(args._purpose,'send');assert.equal(args._refresh_token,'controlled');
     assert.deepEqual(Array.from(args._granted_scopes),['https://www.googleapis.com/auth/gmail.send']);
     writes.push({table:'native-transaction',kind:'rpc',payload:args});
     return {data:{ok:true,connection_saved:true,tenant_id:tenant,connector_id:connector,gmail_address:'sender@example.test',reconnected:true,mailbox_class:'shared_support'},error:null};
   }
   return {data:null,error:null};
 },from(table){let mutation=false;const result=()=>{let data=mutation?{id:'message'}:rows[table]??null;if(!mutation&&table==='channel_connectors'){connectorReads++;data=structuredClone(data);if(ownerChangedAtBoundary&&connectorReads>1)data.mailbox_owner_user_id=otherOwner;}return {data,error:null};};const q=new Proxy({},{get(_,p){if(p==='then')return r=>r(result());if(p==='maybeSingle'||p==='single')return async()=>result();return(...args)=>{if(['update','insert','upsert','delete'].includes(p)){mutation=true;writes.push({table,kind:p,payload:args[0]});}return q;};}});return q;}};
 const ctx=vm.createContext({console,Response,Request,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,crypto:webcrypto,btoa,atob,Date,
 createClient:()=>admin,createLimiterClient:()=>admin,adminClient:()=>admin,TEMPLATES:{test:{category:'transactional',component:()=>'',subject:'Subject'}},React:{createElement:()=>''},renderAsync:async()=>'<p>Body</p>',resolveTenantEmailContext:async()=>({branding:{logoUrl:null,brandName:'Tenant'}}),
 decideSendAuthority:async()=>({ok:true,kind:'internal'}),safeFromDisplayName:x=>x,isAuthorizedInternalCaller:async()=>true,operatorUserId:async()=>null,overRateLimit:async()=>false,
 CLIENT_CONTACT_METHODS_EMBED:'contact_methods',clientAddresses:()=>({emails:['guest@example.test'],phones:[]}),
 registerOutboundAdapter:a=>adapters.set(a.channel_type,a),getOutboundAdapter:channel=>adapters.get(channel),buildListUnsubscribeHeaders:()=>({}),
 resolveGmailAccessToken:async()=>{effects.push({vault:true});return {accessToken:'controlled'};},gmailSend:async()=>{effects.push({gmail:true});return {ok:true,id:'controlled'};},resolveSmtpCreds:async()=>{effects.push({vault:true});return {user:'controlled',pass:'controlled'};},smtpSend:async()=>{effects.push({smtp:true});return {ok:true,id:'controlled'};},
 runPreSend:async()=>({proceed:true,outcome:'proceed',reason:null,queueUntil:null}),resolveTenantForUser:async()=>({tenantId:tenant}),Deno:{env:{get:n=>n==='SUPABASE_SERVICE_ROLE_KEY'?'service':'configured'},serve:fn=>ctx.handler=fn},fetch:async(url,options)=>{effects.push({url,payload:options?.body});if(String(url).includes('/token'))return new Response(JSON.stringify({refresh_token:'controlled',access_token:'controlled',scope:'https://www.googleapis.com/auth/gmail.send'}));if(String(url).includes('userinfo'))return new Response(JSON.stringify({email:'sender@example.test',sub:'account'}));return new Response(JSON.stringify({id:'controlled'}));}});
 const helper=readFileSync(new URL('comms-provider-boundary.ts',import.meta.url),'utf8').replace(/\bexport /g,'');
 vm.runInContext(stripTypeScriptTypes(helper),ctx);
 // Preserve the handler's real personal/shared mailbox decision. Its import is
 // removed below with the other module syntax; an always-allow port is not policy.
 if(name==='send-message')vm.runInContext(stripTypeScriptTypes(readFileSync(new URL('inbox-intelligence/policy.ts',import.meta.url),'utf8').replace(/\bexport /g,'')),ctx);
 // The actual callback now imports this authority reader. Load its real body,
 // rather than silently stripping the import and failing before the floor.
 if(name==='gmail-oauth-callback')vm.runInContext(stripTypeScriptTypes(readFileSync(new URL('gmail-connection-authority.ts',import.meta.url),'utf8').replace(/\bexport /g,'')),ctx);
 let source=process.env.BOUNDARY_TEST_BASELINE?execFileSync('git',['show',`${process.env.BOUNDARY_TEST_BASELINE}:supabase/functions/${name}/index.ts`],{encoding:'utf8'}):readFileSync(new URL(`${name}/index.ts`,base),'utf8');
 source=source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*/gm,'').replace(/^import\s+["'][^"']+["'];?\s*/gm,'');
 vm.runInContext(stripTypeScriptTypes(source),ctx);
 if(name==='gmail-oauth-callback')vm.runInContext(`verifyState=async()=>({u:'${actor}',w:'${tenant}',r:'https://unit.test',t:Date.now()});`,ctx);
 return {effects,writes,scopes,calls,tenant,actor,get connectorReads(){return connectorReads;},run:body=>ctx.handler(new Request('https://unit.test',{method:'POST',headers:{Authorization:queued?'Bearer service':'Bearer user','Content-Type':'application/json'},body:JSON.stringify(body)}))};
}
for(const mode of [false,'error','throw',null,'true'])for(const provider of ['resend','gmail','smtp'])test(`send-message ${provider}/${mode}: active sender cannot bypass floor`,async()=>{
 const h=harness('send-message',mode,{provider});const r=await h.run({channel:'email',to:'guest@example.test',subject:'Subject',body:'Body',connector_id:'connector'});assert.equal(r.status,403);assert.equal(h.effects.length,0);assert.equal(h.writes.filter(x=>x.payload?.status==='queued').length,0);assert.equal(h.scopes.length,1);
});
for(const mode of [false,'error','throw'])test(`queued service caller ${mode} terminalizes without provider retry`,async()=>{
 const h=harness('send-message',mode,{queued:true});await h.run({channel:'email',to:'guest@example.test',body:'Body',message_id:'message'});assert.equal(h.effects.length,0);assert.ok(h.writes.some(x=>x.payload?.status==='failed'&&x.payload.scheduled_for===null));
});
test('foreign connector refuses before execution authority lookup',async()=>{const h=harness('send-message',true,{foreign:true});const r=await h.run({channel:'email',to:'guest@example.test',body:'Body',connector_id:'connector'});assert.equal(r.status,403);assert.equal(h.effects.length,0);});
for(const mode of [false,'error','throw',null,'true'])test(`Gmail callback ${mode} refuses before token exchange and Vault write`,async()=>{const h=harness('gmail-oauth-callback',mode);const r=await h.run({code:'controlled',state:'controlled',origin:'https://unit.test'});assert.equal(r.status,403,await r.clone().text());assert.deepEqual(await r.json(),{error:'COMMS_PROVIDER_EXECUTION_DISABLED'});assert.equal(h.effects.length,0);assert.equal(h.writes.length,0);assert.deepEqual(h.scopes,[{_tenant_id:h.tenant,_actor_user_id:h.actor,_recipient_email:null}]);assert.equal(h.calls.filter(x=>x.name==='provision_gmail_connection'||x.name==='write_channel_secret').length,0);});
for(const mode of [false,'error','throw'])test(`transactional internal ${mode} refuses before rendering/dispatch`,async()=>{const h=harness('send-transactional-email',mode);const r=await h.run({templateName:'test',recipientEmail:'guest@example.test'});assert.equal(r.status,403);assert.equal(h.effects.length,0);assert.equal(h.writes.length,0);});
test('Gmail ordinary callback retains token exchange payload and confirms the native connection',async()=>{const h=harness('gmail-oauth-callback',true);const r=await h.run({code:'controlled',state:'controlled',origin:'https://unit.test'});assert.equal(r.status,200,await r.clone().text());assert.deepEqual(await r.json(),{ok:true,connection_saved:true,audit_confirmed:true,gmail_address:'sender@example.test',return_origin:'https://unit.test'});assert.equal(h.effects.length,2);assert.equal(h.effects[0].url,'https://oauth2.googleapis.com/token');assert.equal(new URLSearchParams(h.effects[0].payload).get('code'),'controlled');assert.equal(h.calls.filter(x=>x.name==='provision_gmail_connection').length,1);assert.equal(h.calls.filter(x=>x.name==='write_channel_secret').length,0);assert.equal(h.writes.filter(x=>x.table==='channel_connectors').length,0);assert.equal(h.writes.filter(x=>x.table==='audit_logs').length,1);assert.deepEqual(h.scopes,[{_tenant_id:h.tenant,_actor_user_id:h.actor,_recipient_email:null}]);});

for(const [label,options,status,error] of [['ordinary member',{seatAllowed:false},403,'forbidden'],['unavailable workspace authority',{scopeError:true},503,'gmail_authority_unavailable']])test(`Gmail ${label} cannot reach an otherwise allowed provider floor`,async()=>{const h=harness('gmail-oauth-callback',true,options);const r=await h.run({code:'controlled',state:'controlled',origin:'https://unit.test'});assert.equal(r.status,status);assert.deepEqual(await r.json(),{error});assert.equal(h.scopes.length,0);assert.equal(h.effects.length,0);assert.equal(h.writes.length,0);});
test('Gmail workspace switch after allowed provider floor refuses before token exchange or native persistence',async()=>{const h=harness('gmail-oauth-callback',true,{switchAfterFloor:true});const r=await h.run({code:'controlled',state:'controlled',origin:'https://unit.test'});assert.equal(r.status,409);assert.deepEqual(await r.json(),{error:'workspace_changed'});assert.equal(h.scopes.length,1);assert.equal(h.effects.length,0);assert.equal(h.writes.length,0);});

test('ordinary managed Resend still dispatches exactly once',async()=>{const h=harness('send-message',true);await h.run({channel:'email',to:'guest@example.test',subject:'Subject',body:'Body',connector_id:'connector'});assert.equal(h.effects.filter(x=>x.url==='https://api.resend.com/emails').length,1);const sent=JSON.parse(h.effects.find(x=>x.url==='https://api.resend.com/emails').payload);assert.deepEqual(sent.to,['guest@example.test']);assert.equal(sent.subject,'Subject');});

test('personal sender owner uses the real mailbox policy and dispatches once',async()=>{
 const h=harness('send-message',true,{personal:true});
 const r=await h.run({channel:'email',to:'guest@example.test',subject:'Subject',body:'Body',connector_id:'connector'});
 assert.equal(r.status,200);assert.equal((await r.json()).status,'sent');
 assert.equal(h.connectorReads,2);assert.equal(h.effects.filter(x=>x.url==='https://api.resend.com/emails').length,1);
});
test('personal sender nonowner is refused by the real policy despite an allowed provider floor',async()=>{
 const h=harness('send-message',true,{personal:true,initialOtherOwner:true});
 const r=await h.run({channel:'email',to:'guest@example.test',subject:'Subject',body:'Body',connector_id:'connector'});
 assert.equal(r.status,403);assert.deepEqual(await r.json(),{status:'blocked',outcome:'refused',error:'email_sender_unavailable'});
 assert.equal(h.connectorReads,1);assert.equal(h.scopes.length,1);assert.equal(h.effects.length,0);
 assert.equal(h.writes.length,0);
});
test('personal sender owner changed at the final boundary refuses before provider or credential access',async()=>{
 const h=harness('send-message',true,{personal:true,ownerChangedAtBoundary:true});
 const r=await h.run({channel:'email',to:'guest@example.test',subject:'Subject',body:'Body',connector_id:'connector'});
 assert.equal(r.status,200);const result=await r.json();
 assert.equal(result.status,'failed');assert.equal(result.error,'email_sender_unavailable');
 assert.equal(h.connectorReads,2);assert.equal(h.scopes.length,1);assert.equal(h.effects.length,0);
 assert.equal(h.writes.some(x=>x.payload?.status==='sent'),false);
 assert.equal(h.writes.filter(x=>x.table==='paige_messages_audit'&&x.payload?.status==='failed').length,1);
});
