// @vitest-environment node
import{readFileSync}from'node:fs';import{expect,it,vi}from'vitest';import ts from'typescript';
import{UUID_INPUT_SHAPE}from'../../supabase/functions/_shared/confirm-fingerprint';
const source=ts.createSourceFile('index.ts',readFileSync('supabase/functions/paige-ai-chat/index.ts','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let initializer:ts.Expression|undefined;function find(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='claimConfirmation')initializer=node.initializer;ts.forEachChild(node,find);}find(source);if(!initializer)throw Error('Original common claim not found');
const expression=ts.transpileModule(`const extracted=${initializer.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const id=(n:number)=>`e09fa000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fp='a'.repeat(16)+':'+id(7),tool='client_portal_request_share';
function setup(){
 const stored={expected_tenant_id:id(2),contact_id:id(4),work_id:id(5),version:'2026-10-25T12:00:00.123456Z',title:'Read the guide',body:'Choose one milestone.',recipient_user_id:id(6),access_version:null};
 const row={id:id(8),fingerprint:'a'.repeat(16),thread_id:id(3),scoped_client_id:null,args:stored};
 const updates:unknown[]=[],selects:string[]=[],queries:unknown[][]=[];let current=true,retireAfterRead=false;
 const response={data:row as typeof row|null,error:null as unknown};
 const query=new Proxy({}, {get:(_target,name)=>name==='maybeSingle'?async()=>{if(retireAfterRead)current=false;return response;}:(...args:unknown[])=>{queries.push([name,...args]);if(name==='update')updates.push(args[0]);if(name==='select')selects.push(String(args[0]));return query;}});
 const claims=new Map<string,unknown>();const scope={actorId:id(1),tenantId:id(2),threadId:id(3),clientId:null,audience:'owner'};
 const deps={cancellationsRecorded:true,approvedConfirmations:new Set([fp]),revalidateProposalScope:async()=>current,interactive:{check:async()=>{}},
  stoppedReminderClaims:new Map(),approvedReminderClaims:new Map(),selectedConfirmationNonce:async()=>id(7),requireRecoveryPermission:async()=>{},supabase:{from:()=>query},user:{id:id(1)},personaCtx:{tenant_id:id(2)},payloadThreadId:id(3),scopedClientId:null,requestNonce:id(9),
  portalRequestClaims:claims,PORTAL_REQUEST_SHARE_TOOL:tool,UUID_INPUT_SHAPE,portalRequestCurrent:()=>current,portalRequestScope:()=>current?scope:null};
 const claim=new Function(...Object.keys(deps),`${expression}\nreturn extracted;`)(...Object.values(deps))as(token:string,name:string)=>Promise<Record<string,unknown>|null>;
 return{stored,row,response,updates,selects,queries,claims,claim,deps,retireAfterClaimRead:()=>{retireAfterRead=true;}};
}
it('preserves the original non-Portal claim payload, projection and stored arguments',async()=>{const f=setup();expect(await f.claim(fp,'action_advance')).toEqual(f.stored);expect(Object.keys(f.updates[0] as object)).toEqual(['consumed_at']);expect(f.selects).toEqual(['args']);expect(f.claims.size).toBe(0);});
it('stamps the original common claim with this request only for the Portal command',async()=>{const f=setup();expect(await f.claim(fp,tool)).toEqual(f.stored);expect(f.updates[0]).toMatchObject({claimed_in_request:id(9)});expect(f.selects[0].split(',').sort()).toEqual(['args','fingerprint','id','scoped_client_id','thread_id']);});
it('captures actual selected row identity outside model arguments',async()=>{const f=setup();await f.claim(fp,tool);expect(f.claims.get(fp)).toMatchObject({state:'claimed',claim:{id:id(8),fingerprint:'a'.repeat(16),requestNonce:id(9),threadId:id(3),clientId:null}});expect(Object.keys(f.stored)).toHaveLength(8);});
it('retains an unknown claim result without treating it as a new proposal',async()=>{vi.spyOn(console,'error').mockImplementation(()=>{});try{const f=setup();f.response.error={code:'503'};f.response.data=null;expect(await f.claim(fp,tool)).toBeNull();expect(f.claims.get(fp)).toMatchObject({state:'unknown'});}finally{vi.restoreAllMocks();}});
it('does not attempt this same claim twice in one turn after an uncertain response',async()=>{vi.spyOn(console,'error').mockImplementation(()=>{});try{const f=setup();f.response.error={code:'503'};f.response.data=null;await f.claim(fp,tool);await f.claim(fp,tool);expect(f.updates).toHaveLength(1);}finally{vi.restoreAllMocks();}});
it('refuses malformed selected metadata instead of fabricating a native claim',async()=>{const f=setup();f.row.fingerprint='b'.repeat(16);expect(await f.claim(fp,tool)).toBeNull();expect(f.claims.get(fp)).toMatchObject({state:'unknown'});});
it('retires the handoff when the original scope changes during the claim await',async()=>{const f=setup();f.retireAfterClaimRead();expect(await f.claim(fp,tool)).toBeNull();expect(f.claims.get(fp)).toMatchObject({state:'unknown'});});
