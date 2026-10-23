import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useSoloAgreementSignings,type SigningsState} from './useSoloAgreementSignings';

// Actual original hook; only Auth/query/Edge transport is controlled. These
// cases send no email and do not prove hosted/provider authorization/acceptance.
const m=vi.hoisted(()=>({context:{activeTenantId:'aaaaaaaa-0000-4000-8000-000000000001' as string|null,activeUserId:'bbbbbbbb-0000-4000-8000-000000000001' as string|null,accountContextLoading:false},invoke:vi.fn()}));
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>m.context}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
  auth:{getUser:async()=>({data:{user:{id:m.context.activeUserId}},error:null}),getSession:async()=>({data:{session:{user:{id:m.context.activeUserId,is_anonymous:false},access_token:'controlled-session'}},error:null})},functions:{invoke:m.invoke},
  from:(table:string)=>{const result=()=>({data:table==='tenant_members'?{role:'owner'}:[],error:null});const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>result(),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};return q;},
}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const tenant='aaaaaaaa-0000-4000-8000-000000000001',agreement='cccccccc-0000-4000-8000-000000000001';
let root:Root,host:HTMLDivElement,latest:SigningsState;
function Probe(){latest=useSoloAgreementSignings();return null;}
async function render(){await act(async()=>root.render(<Probe/>));}
const success=()=>({data:{ok:true,status:'sent',sent:[{email:'client@example.test'}],notDelivered:[],failed:[]},error:null});
beforeEach(async()=>{m.context={activeTenantId:tenant,activeUserId:'bbbbbbbb-0000-4000-8000-000000000001',accountContextLoading:false};m.invoke.mockReset().mockResolvedValue(success());host=document.createElement('div');document.body.append(host);root=createRoot(host);await render();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
async function send(){let result!:Awaited<ReturnType<SigningsState['sendForSignature']>>;await act(async()=>{result=await latest.sendForSignature(agreement,tenant);});return result;}
it('preserves the original valid request/recipient response without claiming provider delivery',async()=>{
  expect(await send()).toMatchObject({ok:true,sent:['client@example.test'],notDelivered:[]});expect(m.invoke).toHaveBeenCalledWith('agreement-send',expect.objectContaining({body:{agreementId:agreement,resend:false}}));
});
it('refuses a row loaded under a different business before any dispatch',async()=>{
  let result:unknown;await act(async()=>{result=await latest.sendForSignature(agreement,'aaaaaaaa-0000-4000-8000-000000000002');});expect(m.invoke).not.toHaveBeenCalled();expect(result).toMatchObject({ok:false,state:'refused'});
});
it('a network exception is unconfirmed and cannot claim nothing was delivered',async()=>{
  m.invoke.mockRejectedValue(new Error('Controlled transport interruption'));const result=await send();expect(result).toMatchObject({ok:false,state:'unconfirmed'});expect(JSON.stringify(result)).not.toMatch(/nothing was (sent|delivered)/i);
});
it('a context change after dispatch does not prove the earlier request was rolled back',async()=>{
  let resolve!:(value:ReturnType<typeof success>)=>void;m.invoke.mockReturnValue(new Promise(done=>{resolve=done;}));let pending!:ReturnType<SigningsState['sendForSignature']>;
  await act(async()=>{pending=latest.sendForSignature(agreement,tenant);});m.context={...m.context,activeTenantId:'aaaaaaaa-0000-4000-8000-000000000002'};await render();let result:unknown;await act(async()=>{resolve(success());result=await pending;});expect(result).toMatchObject({ok:false,state:'unconfirmed'});expect(JSON.stringify(result)).not.toMatch(/nothing was (sent|delivered)/i);expect(JSON.stringify(result)).not.toContain('client@example.test');
});
it('an actor change in the same business cannot publish the earlier actor response',async()=>{
  let resolve!:(value:ReturnType<typeof success>)=>void;m.invoke.mockReturnValue(new Promise(done=>{resolve=done;}));let pending!:ReturnType<SigningsState['sendForSignature']>;
  await act(async()=>{pending=latest.sendForSignature(agreement,tenant);});m.context={...m.context,activeUserId:'bbbbbbbb-0000-4000-8000-000000000002'};await render();let result:unknown;await act(async()=>{resolve(success());result=await pending;});expect(result).toMatchObject({ok:false,state:'unconfirmed'});expect(JSON.stringify(result)).not.toContain('client@example.test');
});
it('switching actors and returning cannot revive an earlier request completion',async()=>{
  const originalActor=m.context.activeUserId;let resolve!:(value:ReturnType<typeof success>)=>void;m.invoke.mockReturnValue(new Promise(done=>{resolve=done;}));let pending!:ReturnType<SigningsState['sendForSignature']>;
  await act(async()=>{pending=latest.sendForSignature(agreement,tenant);});m.context={...m.context,activeUserId:'bbbbbbbb-0000-4000-8000-000000000002'};await render();m.context={...m.context,activeUserId:originalActor};await render();let result:unknown;await act(async()=>{resolve(success());result=await pending;});expect(result).toMatchObject({ok:false,state:'unconfirmed'});expect(JSON.stringify(result)).not.toContain('client@example.test');
});
it('retains actual partial-failure and post-send status-warning evidence',async()=>{
  const response=success();Object.assign(response.data,{failed:[{email:'other@example.test',reason:'The request was accepted but its link could not be activated.'}],warning:'The request was accepted but its record status could not be updated.'});m.invoke.mockResolvedValue(response);
  expect(await send()).toMatchObject({ok:true,sent:['client@example.test'],failed:[{email:'other@example.test',reason:expect.stringContaining('link')}],warning:expect.stringContaining('record status')});
});
it('a malformed apparent success cannot become an empty successful send',async()=>{
  m.invoke.mockResolvedValue({data:{ok:true,sent:null,notDelivered:[]},error:null});expect(await send()).toMatchObject({ok:false,state:'unconfirmed'});
});
it('duplicate gestures in one original hook do not dispatch two simultaneous sends',async()=>{
  let resolve!:(value:ReturnType<typeof success>)=>void;m.invoke.mockReturnValue(new Promise(done=>{resolve=done;}));let first!:ReturnType<SigningsState['sendForSignature']>,second!:ReturnType<SigningsState['sendForSignature']>;
  await act(async()=>{first=latest.sendForSignature(agreement,tenant);second=latest.sendForSignature(agreement,tenant);});expect(m.invoke).toHaveBeenCalledOnce();let refused:unknown;await act(async()=>{resolve(success());await first;refused=await second;});expect(refused).toMatchObject({ok:false,state:'refused'});
});
