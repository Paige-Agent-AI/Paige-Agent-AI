import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSoloAgreementSignings, type SigningsState } from './useSoloAgreementSignings';

// Execute the original hook. Auth/query/Storage transports are controlled ports,
// not real JWT, bucket permissions, customer uploads or signing acceptance.
const m=vi.hoisted(()=>({context:{activeTenantId:'test-tenant-a' as string|null,activeUserId:'test-person-a' as string|null,accountContextLoading:false},upload:vi.fn()}));
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>m.context}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
  auth:{getUser:async()=>({data:{user:{id:m.context.activeUserId}},error:null})},
  storage:{from:(bucket:string)=>{expect(bucket).toBe('tenant-agreements');return {upload:m.upload};}},
  from:(table:string)=>{
    const result=()=>({data:table==='tenant_members'?{role:'owner'}:[],error:null});
    const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>result(),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};return q;
  },
}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement,latest:SigningsState;
function Probe(){latest=useSoloAgreementSignings();return null;}
async function render(){await act(async()=>{root.render(<Probe/>);});}
beforeEach(async()=>{
  m.context={activeTenantId:'test-tenant-a',activeUserId:'test-person-a',accountContextLoading:false};
  m.upload.mockReset().mockResolvedValue({data:{path:'controlled'},error:null});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);await render();
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
const file=()=>new File(['controlled source bytes'],'../private agreement.pdf',{type:'application/pdf'});

it('positive original upload retains the private bucket, business prefix and no-overwrite options',async()=>{
  const result=await latest.uploadDocument(file(),'test-tenant-a');expect(result.ok).toBe(true);
  expect(result.path).toMatch(/^test-tenant-a\/source\/[0-9]+-private-agreement\.pdf$/);
  expect(m.upload).toHaveBeenCalledTimes(1);expect(m.upload.mock.calls[0][2]).toEqual({cacheControl:'3600',upsert:false});
});
it('a loaded intent for another business is refused before Storage, even if the same person can access both',async()=>{
  const result=await latest.uploadDocument(file(),'test-tenant-b');expect(result.ok).toBe(false);expect(m.upload).not.toHaveBeenCalled();
});
it('an accepted upload followed by a lost response is unconfirmed, never represented as no effect',async()=>{
  const accepted:string[]=[];m.upload.mockImplementation(async(path:string)=>{accepted.push(path);throw Error('Synthetic private transport detail');});
  const result=await latest.uploadDocument(file(),'test-tenant-a');expect(accepted).toHaveLength(1);expect(result.ok).toBe(false);
  expect(result.message).toMatch(/not.*confirmed|unconfirmed|unknown/i);expect(result.message).not.toMatch(/nothing.*changed|nothing.*uploaded|no document was recorded|Synthetic private/i);
});
it.each(['loading','missing business'] as const)('%s does not start an upload',async state=>{
  if(state==='loading')m.context.accountContextLoading=true;else m.context.activeTenantId=null;await render();
  expect((await latest.uploadDocument(file(),null)).ok).toBe(false);expect(m.upload).not.toHaveBeenCalled();
});
it('a retained callback from the previous business is refused before Storage',async()=>{
  const previous=latest.uploadDocument;m.context.activeTenantId='test-tenant-b';await render();
  expect((await previous(file(),'test-tenant-a')).ok).toBe(false);expect(m.upload).not.toHaveBeenCalled();
});
it('an upload finishing after a business change remains unconfirmed without claiming rollback',async()=>{
  let finish!:(v:unknown)=>void;m.upload.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=latest.uploadDocument(file(),'test-tenant-a');
  m.context.activeTenantId='test-tenant-b';await render();finish({data:{path:'original'},error:null});
  const result=await pending;expect(result.ok).toBe(false);expect(result.message).toMatch(/unconfirmed/);expect(result.message).toContain('original business');
});
it('switching away and back cannot adopt an earlier upload completion',async()=>{
  let finish!:(v:unknown)=>void;m.upload.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=latest.uploadDocument(file(),'test-tenant-a');
  m.context.activeTenantId='test-tenant-b';await render();m.context.activeTenantId='test-tenant-a';await render();
  finish({data:{path:'original'},error:null});expect((await pending).ok).toBe(false);
});
it('a provider error remains unconfirmed and does not log private provider details',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);
  m.upload.mockResolvedValue({data:null,error:{message:'Synthetic private path and credential detail'}});
  const result=await latest.uploadDocument(file(),'test-tenant-a');expect(result.ok).toBe(false);expect(result.message).toMatch(/not.*confirmed|unconfirmed/i);
  expect(JSON.stringify(log.mock.calls)).not.toContain('Synthetic private');
});
