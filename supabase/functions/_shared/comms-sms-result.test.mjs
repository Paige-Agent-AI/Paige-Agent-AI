// Actual original handler AND its registered SMS adapter, with only external ports replaced.
// No provider request is possible: the original transport has separate inert wrapper tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readableMessageBody} from '../../../src/pages/admin/conversations/messageReading.ts';

const tenant='20000000-0000-4000-8000-000000000001';
const actor='10000000-0000-4000-8000-000000000001';
const contact='30000000-0000-4000-8000-000000000001';
const message='40000000-0000-4000-8000-000000000001';
const to='+15555550101', words='Fictional approved text';
const sid='SM'+'1'.repeat(32);

function harness(result,{floor=true,configured=true,actualGate=false,onPrepare=null,onRead=null}={}) {
  const writes=[],attempts=[],adapters=new Map(),faults=new Set(),reads=[];
  let prepared=false;
  const rows={
    messages:{id:message,tenant_id:tenant,status:'draft',contact_id:contact,channel_type:'sms',meta:{}},
    clients:{id:contact,tenant_id:tenant,timezone:'America/New_York',timezone_verified:true},
    paige_suppressions:[],
    paige_consent_events:[{action:'granted',created_at:'2026-10-30T10:00:00Z'}],
    tenant_a2p_registrations:{status:'approved',messaging_service_sid:'MGfixture'},
    tenant_phone_numbers:[{phone_number:'+15555550100',status:'active',is_primary:true,capabilities:{sms:true}}],
    tenant_twilio_subaccounts:{inbound_webhook_secret:null},
    tenant_members:{role:'owner',status:'active'},
    profiles:{active_tenant_id:tenant},
  };
  const admin={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:async name=>({data:
    name==='current_user_tenant_id'?tenant:name==='is_platform_owner'?false:
    name==='comms_provider_execution_allowed'?floor&&!faults.has('floor_disabled'):name==='has_role'||name==='is_tenant_admin_as'?true:null,
    error:name==='comms_provider_execution_allowed'&&faults.has('floor_error')?{message:'Fictional floor read failure'}:null}),
    from(table){
      let change=null;
      const answer=()=>{
        if(!change){
          reads.push(table);
          if(table==='tenant_phone_numbers'&&!prepared){prepared=true;onPrepare?.({rows,faults});}
          onRead?.({table,prepared,rows,faults});
        }
        if(faults.has('throw:'+table))throw new Error('Fictional sensitive database failure');
        if(faults.has(table))return {data:null,error:{message:'Fictional read failure'}};
        return {data:change?{id:message}:rows[table]??null,error:null};
      };
      const q=new Proxy({},{get(_,key){
        if(key==='then')return resolve=>resolve(answer());
        if(key==='single'||key==='maybeSingle')return async()=>answer();
        return(...args)=>{
          if(['insert','update','upsert','delete'].includes(key)){
            change=args[0];writes.push({table,kind:key,payload:structuredClone(change)});
            if(table==='messages')rows.messages={...rows.messages,...structuredClone(change)};
          }
          return q;
        };
      }});
      return q;
    },
  };
  class FixtureDate extends Date {
    constructor(value='2026-10-30T16:00:00Z'){super(value);}
    static now(){return Date.parse('2026-10-30T16:00:00Z');}
  }
  const context=vm.createContext({console,Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,
    AbortController,AbortSignal,Date:FixtureDate,setTimeout,clearTimeout,crypto:webcrypto,btoa,atob,
    createClient:()=>admin,registerOutboundAdapter:a=>adapters.set(a.channel_type,a),getOutboundAdapter:c=>adapters.get(c),
    CLIENT_CONTACT_METHODS_EMBED:'contact_methods',clientAddresses:()=>({emails:[],phones:[to]}),
    // This fixture assumes the separately-tested current consent/location decision allows the attempt.
    runPreSend:async()=>({proceed:true,outcome:'proceed',reason:null,queueUntil:null}),
    resolveTwilioCreds:async()=>configured?{ok:true,data:{accountSid:'ACfixture',authToken:'fixture-secret',apiKeySid:'SKfixture'}}:
      {ok:false,needs_config:true,data:null,error:'twilio_subaccount_not_provisioned'},
    sendSms:async(_account,_secret,options)=>{
      attempts.push({to:options.to,body:options.body});
      if(result==='throw')throw new TypeError('Fictional provider port lost its answer');
      return structuredClone(result);
    },
    Deno:{env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?'internal':'https://fixture.example.test'},serve:fn=>context.handler=fn},
    fetch:async()=>{throw Error('Unexpected network access in inert SMS result test');},
  });
  const floorSource=readFileSync(new URL('./comms-provider-boundary.ts',import.meta.url),'utf8').replace(/\bexport /g,'');
  vm.runInContext(stripTypeScriptTypes(floorSource),context);
  if(actualGate){
    const gateSource=readFileSync(new URL('./pre-send-pipeline.ts',import.meta.url),'utf8')
      .replace(/^import[^\n]*\n/gm,'').replace(/\bexport /g,'');
    vm.runInContext(stripTypeScriptTypes(gateSource),context);
  }
  const raw=process.env.COMMS_SMS_BASELINE
    ?execFileSync('git',['show',`${process.env.COMMS_SMS_BASELINE}:supabase/functions/send-message/index.ts`],{encoding:'utf8'})
    :readFileSync(new URL('../send-message/index.ts',import.meta.url),'utf8');
  const source=raw
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*/gm,'').replace(/^import\s+["'][^"']+["'];?\s*/gm,'');
  vm.runInContext(stripTypeScriptTypes(source),context);
  return {writes,attempts,rows,reads,run:async({existing=true,text=words,channel='sms',overrideClientDnd=false}={})=>{
    const response=await context.handler(new Request('https://fixture.example.test/send-message',{
      method:'POST',headers:{Authorization:'Bearer user','Content-Type':'application/json'},
      body:JSON.stringify({channel,to,body:text,contact_id:contact,override_client_dnd:overrideClientDnd,...existing?{message_id:message}:{}}),
    }));
    return {status:response.status,body:await response.json()};
  }};
}

for(const [label,result] of [
  ['lost response',{ok:false,status:0,error:'Fictional lost response',data:null}],
  ['provider port throws','throw'],
  ['request timeout',{ok:false,status:408,error:'Fictional request timeout',data:null}],
  ['conflict response',{ok:false,status:409,error:'Fictional conflict',data:null}],
  ['server failure',{ok:false,status:503,error:'Fictional provider error',data:null}],
  ['empty successful response',{ok:true,status:201,error:null,data:null}],
  ['missing receipt',{ok:true,status:201,error:null,data:{}}],
  ['empty receipt',{ok:true,status:201,error:null,data:{sid:'   '}}],
  ['non-string receipt',{ok:true,status:201,error:null,data:{sid:42}}],
  ['short receipt',{ok:true,status:201,error:null,data:{sid:'SMfixture'}}],
  ['wrong-resource receipt',{ok:true,status:201,error:null,data:{sid:'PN'+'1'.repeat(32)}}],
  ['space-padded receipt',{ok:true,status:201,error:null,data:{sid:' '+sid+' '}}],
])test(`SMS ${label} is unconfirmed, never sent or plain failed`,async()=>{
  const h=harness(result);const response=await h.run();
  assert.equal(response.status,200,JSON.stringify(response));
  assert.equal(h.attempts.length,1);
  assert.equal(response.body.status,'failed');
  assert.equal(response.body.outcome,'outcome_unknown');
  assert.equal(response.body.unconfirmed,true);
  assert.equal(response.body.scheduled_for,null);
  assert.equal(h.rows.messages.error,'delivery_unconfirmed');
  const again=await h.run();
  assert.equal(again.body.outcome,'outcome_unknown');
  assert.equal(h.attempts.length,1,'same-row replay must stop before another provider attempt');
});

for(const status of [400,401,403,404,422,429])test(`SMS HTTP${status} retains a definitive failed result`,async()=>{
  const h=harness({ok:false,status,error:'Fictional provider rejection',data:{code:status}});
  const response=await h.run();
  assert.equal(h.attempts.length,1);
  assert.equal(response.body.outcome,'failed');
  assert.notEqual(response.body.unconfirmed,true);
  assert.notEqual(h.rows.messages.error,'delivery_unconfirmed');
});

test('a send without an existing draft retains uncertain words on the original thread',async()=>{
  const h=harness({ok:false,status:0,error:'Fictional lost response',data:null});
  const response=await h.run({existing:false});
  assert.equal(response.body.outcome,'outcome_unknown');
  const saved=h.writes.find(x=>x.table==='messages'&&x.kind==='insert')?.payload;
  assert.equal(saved?.thread_key,`contact:${tenant}:${contact}`);
  assert.equal(saved?.error,'delivery_unconfirmed');
  assert.equal(saved?.body_text,words);
  assert.equal(saved?.body_html,null);
  assert.equal(saved?.meta?.delivery_unconfirmed,true);
});

for(const text of ['Use code <1234>','Keep literal &amp; and &lt;safe&gt;','<b>These are literal SMS characters</b>','A < B & C > D'])
test('uncertain SMS reopens through the original reader with literal text: '+text,async()=>{
  const h=harness({ok:false,status:0,error:'Fictional lost response',data:null});
  const response=await h.run({existing:false,text});
  assert.equal(response.body.outcome,'outcome_unknown');
  assert.deepEqual(h.attempts,[{to,body:text}]);
  const saved=h.writes.find(x=>x.table==='messages'&&x.kind==='insert')?.payload;
  assert.equal(saved?.body_text,text);
  assert.equal(saved?.body_html,null);
  assert.equal(readableMessageBody(saved),text,'the actual reopened message reader preserves the attempted SMS');
});

test('known accepted receipt and exact original words retain the existing contract',async()=>{
  const h=harness({ok:true,status:201,error:null,data:{sid,status:'queued'}});
  const response=await h.run();
  assert.equal(response.body.outcome,'sent');
  assert.equal(response.body.vendor_message_id,sid);
  assert.notEqual(response.body.unconfirmed,true);
  assert.deepEqual(h.attempts,[{to,body:words}]);
});

test('the documented MM receipt form is retained unchanged',async()=>{
  const mm='MM'+'A'.repeat(32);
  const h=harness({ok:true,status:201,error:null,data:{sid:mm,status:'queued'}});
  const response=await h.run();
  assert.equal(response.body.outcome,'sent');
  assert.equal(response.body.vendor_message_id,mm);
});

test('unconfigured original SMS provider fails before a provider attempt',async()=>{
  const h=harness(null,{configured:false});const response=await h.run();
  assert.equal(h.attempts.length,0);
  assert.equal(response.body.outcome,'failed');
  assert.notEqual(response.body.unconfirmed,true);
});

test('original provider execution refusal cannot reach SMS adapter transport',async()=>{
  const h=harness(null,{floor:false});const response=await h.run();
  assert.equal(response.status,403);
  assert.equal(h.attempts.length,0);
});

for(const [label,change] of [
  ['consent revoked',({rows})=>{rows.paige_consent_events=[{action:'revoked',created_at:'2026-10-30T16:00:00Z'}];}],
  ['STOP suppression',({rows})=>{rows.paige_suppressions=[{id:'suppression-fixture',reason:'user_stop'}];}],
  ['client DND',({rows})=>{rows.clients.dnd_active=true;}],
  ['location no longer confirmed',({rows})=>{rows.clients.timezone_verified=false;}],
  ['location moves into quiet hours',({rows})=>{rows.clients.timezone='Asia/Tokyo';}],
  ['business DND',({rows})=>{rows.tenant_comms_preferences={autosend_dnd_enabled:true,autosend_dnd_start:'00:00:00',autosend_dnd_end:'23:59:59',autosend_dnd_timezone:'America/New_York',autosend_dnd_channels:['sms']};}],
  ['consent lookup unavailable',({faults})=>{faults.add('paige_consent_events');}],
  ['suppression lookup unavailable',({faults})=>{faults.add('paige_suppressions');}],
  ['consent lookup throws',({faults})=>{faults.add('throw:paige_consent_events');}],
  ['provider execution disabled',({faults})=>{faults.add('floor_disabled');}],
  ['provider execution unreadable',({faults})=>{faults.add('floor_error');}],
])test(`actual gate rechecks ${label} after sending-number preparation`,async()=>{
  const h=harness({ok:true,status:201,data:{sid}},{actualGate:true,onPrepare:change});
  const response=await h.run();
  assert(!String(response.body.reason).startsWith('sms_final_eligibility_'),'original composer receives a readable refusal');
  assert.equal(h.attempts.length,0,'changed final eligibility must stop the actual adapter transport');
  assert.equal(response.body.status,'failed');
  assert.equal(response.body.outcome,'failed');
  assert.notEqual(response.body.unconfirmed,true,'no provider attempt is a known refusal');
  assert.equal(response.body.scheduled_for,null,'recheck does not manufacture an automatic retry');
  assert(!JSON.stringify(response.body).includes("it'll send"),'no false future-send promise');
  assert(h.reads.includes('tenant_phone_numbers'),'initial check passed and reached preparation');
});

test('actual final gate preserves explicit client-DND override and accepted receipt',async()=>{
  const h=harness({ok:true,status:201,data:{sid}},{actualGate:true,onPrepare:({rows})=>{rows.clients.dnd_active=true;}});
  const response=await h.run({overrideClientDnd:true});
  assert.equal(h.attempts.length,1);assert.equal(response.body.outcome,'sent');
  assert(h.reads.filter(table=>table==='paige_consent_events').length>=2,'same original consent gate re-entered');
});

test('actual final gate honors DND activated while its consent lookup waits',async()=>{
  let changed=false;
  const h=harness({ok:true,status:201,data:{sid}},{actualGate:true,onRead:({table,prepared,rows})=>{
    if(prepared&&table==='paige_consent_events'){
      changed=true;rows.clients.dnd_active=true;rows.clients.dnd_reason='Please wait until our meeting.';
    }
  }});
  const response=await h.run();
  assert(changed,'the original adapter reached preparation and its final consent read');
  assert.equal(h.attempts.length,0,'fresh recipient hold stops the actual transport port');
  assert.equal(response.body.status,'failed');assert.equal(response.body.outcome,'failed');
  assert.equal(response.body.scheduled_for,null);assert.notEqual(response.body.unconfirmed,true);
  assert.match(response.body.reason,/meeting/);
  assert(!JSON.stringify(response.body).includes("it'll send"));
});

test('existing explicit DND override also applies to a hold activated during final consent lookup',async()=>{
  const h=harness({ok:true,status:201,data:{sid}},{actualGate:true,onRead:({table,prepared,rows})=>{
    if(prepared&&table==='paige_consent_events')rows.clients.dnd_active=true;
  }});
  const response=await h.run({overrideClientDnd:true});
  assert.deepEqual(h.attempts,[{to,body:words}]);assert.equal(response.body.outcome,'sent');
});

test('client-DND override never bypasses a newly recorded STOP',async()=>{
  const h=harness({ok:true,status:201,data:{sid}},{actualGate:true,onPrepare:({rows})=>{rows.paige_suppressions=[{id:'suppression-fixture',reason:'user_stop'}];}});
  const response=await h.run({overrideClientDnd:true});
  assert.equal(h.attempts.length,0);assert.equal(response.body.outcome,'failed');
});

for(const channel of ['voice','whatsapp','SMS',[],{},true,17])
test('unsupported request channel refuses before any dispatch: '+JSON.stringify(channel),async()=>{
  const h=harness({ok:true,status:201,error:null,data:{sid,status:'queued'}});
  const response=await h.run({channel});
  assert.equal(response.status,400);
  assert.equal(h.attempts.length,0);
  assert.equal(h.writes.length,0);
});
