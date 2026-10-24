import assert from 'node:assert/strict';

// Reuse the original signing-handler transport pattern: execute THIS actual
// handler and real supabase-js client, with every transport intercepted and
// runtime network/env access denied. Native SQL/roles/files remain separate.
Deno.test('the original owner command requires exact effectuation consequence and durable receipt',async t=>{
 const serve=Deno.serve,envGet=Deno.env.get,fetch=globalThis.fetch;
 let handler!:(request:Request)=>Promise<Response>;
 const id=(n:number)=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
 const tenant=id(1),actor=id(9),operation=id(7),capability='sales_effectuate_commercial_terms';
 const command={action:'collection.effectuate_terms',agreement_id:id(5),expected_version:3,
  expected_updated_at:'2026-10-15T05:17:00.123456+00:00',signing_id:id(4),signing_version:4,
  invoice_id:id(6),invoice_draft_version:2,payload_digest:'a'.repeat(64),sealed_sha256:'b'.repeat(64)};
 const consequence={agreement_id:id(5),signing_id:id(4),signing_version:4,terms_version:3,invoice_id:id(6),
  payload_digest:command.payload_digest,sealed_sha256:command.sealed_sha256,expected_updated_at:command.expected_updated_at,invoice_draft_version:2,
  client_id:id(2),amount_cents:350000,currency:'usd',starts_on:'2026-10-15',ends_on:null,price_basis:'negotiated',
  state_before:'draft',state_after:'active',effect:'activate_matching_terms'};
 const receipt=()=>({ok:true,outcome:'commercial_terms_effectuated',historical_receipt:true,receipt_id:id(8),
  row:{id:id(5),tenant_id:tenant,status_at_execution:'active',signing_id:id(4),signing_version:4,terms_version:3,
   effective_at:'2026-10-15T05:17:01.000001Z',source_digest:command.payload_digest,actor_user_id:actor,effect:'activate_matching_terms'},
  operation:{id:operation,action:command.action}});
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
 let replay:unknown=null,preview:Record<string,unknown>={},result:unknown=null,stored:Record<string,unknown>|null=null;
 let lane='confirm',member='owner',anonymous=false,previewCalls=0,executeCalls=0,proposalWrites=0;
 let workspaceChanged=false,flipAfterHistory=false,flipAfterExecute=false;
 const nativeArgs:Record<string,unknown>[]=[];
 const reset=()=>{replay=null;preview={eligible:true,summary:'Synthetic exact signed-term review',consequence};result=receipt();stored=null;
  lane='confirm';member='owner';anonymous=false;workspaceChanged=false;flipAfterHistory=false;flipAfterExecute=false;
  previewCalls=0;executeCalls=0;proposalWrites=0;nativeArgs.length=0;};
 try{
  Deno.serve=((callback:typeof handler)=>{handler=callback;return {} as never;}) as unknown as typeof Deno.serve;
  Deno.env.get=name=>name==='SUPABASE_URL'?'https://synthetic.invalid':
   ['SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'].includes(name)?'synthetic-not-a-credential':undefined;
  globalThis.fetch=async(input,init)=>{
   const req=new Request(input,init),url=new URL(req.url);assert.equal(url.origin,'https://synthetic.invalid');
   if(url.pathname==='/auth/v1/user')return json({id:actor,is_anonymous:anonymous,role:'authenticated',aud:'authenticated'});
   if(url.pathname==='/rest/v1/rpc/current_user_tenant_id')return json(workspaceChanged?id(30):tenant);
   if(url.pathname==='/rest/v1/tenant_members'){
    assert.equal(url.searchParams.get('tenant_id'),'eq.'+tenant);assert.equal(url.searchParams.get('user_id'),'eq.'+actor);
    return json({role:member,status:'active'});
   }
   if(url.pathname.startsWith('/rest/v1/rpc/')){
    const args=await req.json();
    if(url.pathname.endsWith('/resolve_tool_autonomy')){assert.equal(args._tenant_id,tenant);assert.equal(args._tool_key,capability);return json(lane);}
    assert.equal(args._actor_user_id,actor);assert.equal(args._expected_tenant_id,tenant);
    assert.deepEqual(args._command,command,'source revisions/microseconds are carried by the actual handler');
    if(url.pathname.endsWith('/read_sales_collection_command_result')){if(flipAfterHistory)workspaceChanged=true;return json(replay);}
    if(url.pathname.endsWith('/preview_sales_collection_command')){previewCalls++;return json(preview);}
    if(url.pathname.endsWith('/execute_sales_collection_command')){executeCalls++;nativeArgs.push(args);if(flipAfterExecute)workspaceChanged=true;return json(result);}
   }
   if(url.pathname==='/rest/v1/paige_pending_confirmations'){
    if(req.method==='GET')return json(stored?{args:stored}:null);
    if(req.method==='POST'){const row=await req.json();proposalWrites++;assert.equal(row.user_id,actor);assert.equal(row.tenant_id,tenant);
     assert.equal(row.tool_name,capability);stored=row.args;return json({summary:row.summary,expires_at:row.expires_at});}
    if(req.method==='PATCH'){assert.equal(url.searchParams.get('tenant_id'),'eq.'+tenant);assert.equal(url.searchParams.get('user_id'),'eq.'+actor);
     return json(url.searchParams.get('select')==='args'?{args:stored}:null);}
   }
   if(url.pathname==='/rest/v1/paige_audit_log'&&req.method==='POST'){const row=await req.json();assert.equal(row.actor_user_id,actor);assert.equal(row.tenant_id,tenant);return json(null);}
   throw Error('Unexpected synthetic request: '+req.method+' '+url.pathname);
  };
  await import('./index.ts');assert.equal(typeof handler,'function');
  const invoke=(extra:Record<string,unknown>={})=>handler(new Request('https://synthetic.invalid/sales-collection-command',{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-owner'},
   body:JSON.stringify({expected_tenant_id:tenant,operation_id:operation,command,...extra})}));

  for(const mode of ['confirm','auto'])await t.step('a real high-risk Kit proposal never executes from '+mode,async()=>{
   reset();lane=mode;const response=await invoke(),body=await response.json();assert.equal(response.status,202);assert.equal(body.outcome,'approval_required');
   assert.match(body.fingerprint,/^[a-f0-9]{16}$/);assert.equal(proposalWrites,1);assert.equal(executeCalls,0);
  });
  await t.step('a stored exact proposal executes through the original native operation and approval receipt',async()=>{
   reset();const proposed=await(await invoke()).json();const response=await invoke({approved_fingerprint:proposed.fingerprint});
   assert.equal(response.status,200);assert.equal((await response.json()).outcome,'commercial_terms_effectuated');assert.equal(executeCalls,1);
   assert.equal(nativeArgs[0]._operation_id,operation);assert.deepEqual(nativeArgs[0]._command,command);
   assert.deepEqual(nativeArgs[0]._governance,{actor_user_id:actor,tenant_id:tenant,tool:capability,action:command.action,
    approval_channel:'operator_card',approved_fingerprint:proposed.fingerprint,decision_receipt_recorded:true});
  });
  await t.step('a valid original accepted-pair receipt is recovered before preview or another approval',async()=>{
   reset();replay={...receipt(),operation:{id:id(17),action:command.action}};const response=await invoke(),body=await response.json();
   assert.equal(response.status,200);assert.equal(body.replayed,true);assert.equal(body.operation.id,id(17));assert.equal(body.row.status_at_execution,'active');
   assert.equal(previewCalls,0);assert.equal(proposalWrites,0);assert.equal(executeCalls,0);assert.equal(body.row.current_status,undefined);
  });
  for(const cause of ['anonymous','staff','off'])await t.step('original authority refuses '+cause,async()=>{
   reset();if(cause==='anonymous')anonymous=true;if(cause==='staff')member='member';if(cause==='off')lane='off';
   const response=await invoke();assert([401,403].includes(response.status));assert.equal(executeCalls,0);assert.equal(proposalWrites,0);
  });
  for(const patch of [{amount_cents:'350000'},{signing_version:99},{expected_updated_at:'2026-10-15T05:17:00.123Z'}])await t.step('malformed authoritative consequence refuses before proposal '+JSON.stringify(patch),async()=>{
   reset();preview={...preview,consequence:{...consequence,...patch}};const response=await invoke();assert.equal(response.status,422);
   assert.equal(proposalWrites,0);assert.equal(executeCalls,0);
  });
  for(const invalid of [{ok:true},{...receipt(),row:{...receipt().row,tenant_id:id(20)}},{...receipt(),receipt_id:null},[],false,'corrupted'])await t.step('incomplete or foreign history cannot retire an operation '+JSON.stringify(invalid),async()=>{
   reset();replay=invalid;const response=await invoke(),body=await response.json();assert.equal(response.status,503);assert.equal(body.outcome,'outcome_unknown');
   assert.equal(body.operation_id,operation);assert.equal(executeCalls,0);assert.equal(previewCalls,0);assert.equal(proposalWrites,0);
  });
  await t.step('a success flag without the approved original receipt stays uncertain after execute',async()=>{
   reset();const proposed=await(await invoke()).json();result={ok:true};const response=await invoke({approved_fingerprint:proposed.fingerprint}),body=await response.json();
   assert.equal(response.status,503);assert.equal(body.outcome,'outcome_unknown');assert.equal(body.operation_id,operation);assert.equal(executeCalls,1);
  });
  await t.step('a workspace change while reading history cannot return another active context as success',async()=>{
   reset();replay=receipt();flipAfterHistory=true;const response=await invoke(),body=await response.json();
   assert.equal(response.status,409);assert.equal(body.outcome,'outcome_unknown');assert.equal(body.operation_id,operation);
   assert.equal(body.row,undefined);assert.equal(previewCalls,0);assert.equal(executeCalls,0);
  });
  await t.step('a workspace change after execution keeps the original work identity and withholds success',async()=>{
   reset();const proposed=await(await invoke()).json();flipAfterExecute=true;
   const response=await invoke({approved_fingerprint:proposed.fingerprint}),body=await response.json();
   assert.equal(response.status,409);assert.equal(body.outcome,'outcome_unknown');assert.equal(body.operation_id,operation);
   assert.equal(body.row,undefined);assert.equal(executeCalls,1);
  });
 }finally{Deno.serve=serve;Deno.env.get=envGet;globalThis.fetch=fetch;}
});
