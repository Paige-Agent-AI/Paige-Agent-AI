import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({preview:vi.fn(),read:vi.fn(),run:vi.fn()}));
vi.mock('@/operator/data/accountControls',async original=>({...await original<typeof import('@/operator/data/accountControls')>(),previewRetirementResources:h.preview,readRetirementResources:h.read,runRetirementResources:h.run}));
import AccountResourcesPanel from './AccountResourcesPanel';
const details={id:'test-tenant-a',name:'Example Agency',status:'canceled',account_type:'agency',parent_tenant_id:null,version:'v1'};
const review={tenant_id:details.id,mode:'archive',version:'r1',accounts:[{id:details.id,name:details.name,account_type:'agency'}],resources:[{provider:'twilio',tenant_id:details.id,action:'suspend'},{provider:'n8n',tenant_id:details.id,action:'disconnect',external_retention:true}],blockers:[],execution_available:true};
const ready={tenant_id:details.id,operation_id:'test-operation',mode:'archive',state:'resources_ready',account_count:1,results:[{provider:'twilio',state:'verified',provider_status:'suspended',reason:null},{provider:'n8n',state:'verified',provider_status:'disconnected',reason:null}]};
let root:Root,host:HTMLDivElement;
beforeEach(()=>{(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;vi.resetAllMocks();h.read.mockResolvedValue(null);h.preview.mockResolvedValue(review);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const button=(name:string)=>{const b=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===name);if(!b)throw Error('Missing button: '+name);return b;};
const click=(name:string)=>act(()=>button(name).click());
const confirm=()=>act(()=>{const input=host.querySelector<HTMLInputElement>('#fleet-resource-confirm')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,details.name);input.dispatchEvent(new Event('input',{bubbles:true}));for(const checkbox of host.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))if(!checkbox.checked)checkbox.click();});
async function open(mode:'archive'|'delete'='archive'){const prepared=vi.fn(),cancel=vi.fn(),busy=vi.fn();await act(async()=>root.render(<AccountResourcesPanel details={details} mode={mode} onPrepared={prepared} onCancel={cancel} onBusy={busy}/>));await vi.waitFor(()=>expect(host.querySelector('#fleet-resource-confirm')).not.toBeNull());return{prepared,cancel,busy};}
describe('operator connected-resource flow',()=>{
 it.each([
  ['twilio_call_access_refused','Twilio refused this account’s call-inventory access.'],
  ['twilio_call_credentials_unavailable','This account’s stored calling credential is unavailable.'],
  ['twilio_call_credential_binding_mismatch','The calling credential belongs to a different account.'],
 ])('reports %s without claiming that a call is active',async(reason,message)=>{
  h.read.mockResolvedValue({...ready,state:'resources_unknown',results:[{provider:'twilio',state:'blocked',provider_status:null,reason}]});
  await open();expect(host.textContent).toContain(message);expect(host.textContent).not.toContain('Calls remain in flight');expect(host.textContent).not.toContain('READY ·');
  expect(button('Read resource outcome')).toBeTruthy();expect(h.run).not.toHaveBeenCalled();
 });
 it('retires generated media through the same confirmation and fresh Delete preflight',async()=>{
  const mediaReview={...review,mode:'delete',resources:[{provider:'generated_media',tenant_id:details.id,action:'remove_media',object_count:2}]};
  h.preview.mockResolvedValue(mediaReview);const {prepared}=await open('delete');
  expect(host.textContent).toContain('Remove 2 generated media files');expect(host.textContent).toContain('Existing public links will stop working');
  expect(host.textContent).not.toContain('Close the listed Twilio');expect(host.textContent).not.toContain('Disconnect PAIGE from n8n');
  expect(button('Retire listed resources').disabled).toBe(true);confirm();
  h.run.mockResolvedValue({...ready,mode:'delete',results:[{provider:'generated_media',state:'verified',provider_status:'removed',reason:null}]});click('Retire listed resources');
  await vi.waitFor(()=>expect(host.textContent).toContain('READY ·'));expect(prepared).not.toHaveBeenCalled();
  expect(h.run).toHaveBeenCalledWith(details.id,expect.any(String),'prepare',mediaReview,details.name,false);
  click('Refresh account preflight');expect(prepared).toHaveBeenCalledTimes(1);
 });
 it('retires cached audio with exact scope and consequences, then requires a fresh Delete preflight',async()=>{
  const cacheReview={...review,mode:'delete',resources:[{provider:'tts_cache',tenant_id:details.id,action:'remove_cache',object_count:2}]};
  h.preview.mockResolvedValue(cacheReview);const {prepared}=await open('delete');
  expect(host.textContent).toContain('Remove 2 cached audio files');expect(host.textContent).not.toContain('Close the listed Twilio');
  expect(host.textContent).toContain('Cached audio cannot be restored');expect(button('Retire listed resources').disabled).toBe(true);
  confirm();h.run.mockResolvedValue({...ready,mode:'delete',results:[{provider:'tts_cache',state:'verified',provider_status:'removed',reason:null}]});click('Retire listed resources');
  await vi.waitFor(()=>expect(host.textContent).toContain('READY ·'));expect(prepared).not.toHaveBeenCalled();
  expect(h.run).toHaveBeenCalledWith(details.id,expect.any(String),'prepare',cacheReview,details.name,false);
  click('Refresh account preflight');expect(prepared).toHaveBeenCalledTimes(1);
 });
 it('requires exact name, provider consequences and explicit external n8n retention',async()=>{
  await open();expect(button('Suspend connections').disabled).toBe(true);expect(host.textContent).toContain('may continue running independently');
  confirm();expect(button('Suspend connections').disabled).toBe(false);
  act(()=>host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1].click());expect(button('Suspend connections').disabled).toBe(true);expect(h.run).not.toHaveBeenCalled();
 });
 it('does not archive from a provider response; refreshes the canonical preflight separately',async()=>{
  const {prepared}=await open();confirm();h.run.mockResolvedValue(ready);click('Suspend connections');await vi.waitFor(()=>expect(host.textContent).toContain('READY ·'));
  expect(prepared).not.toHaveBeenCalled();expect(h.run).toHaveBeenCalledWith(details.id,expect.any(String),'prepare',review,details.name,true);
  click('Refresh account preflight');expect(prepared).toHaveBeenCalledTimes(1);
 });
 it('prevents duplicate dispatch and keeps typed input through an uncertain response',async()=>{
  await open();confirm();let reject!:(e:Error)=>void;h.run.mockImplementation(()=>new Promise((_r,j)=>{reject=j;}));const submit=button('Suspend connections');act(()=>{submit.click();submit.click();});expect(h.run).toHaveBeenCalledTimes(1);
  await act(async()=>reject(new Error('interrupted')));expect(host.textContent).toContain('OUTCOME UNKNOWN');expect((host.querySelector('#fleet-resource-confirm') as HTMLInputElement).value).toBe(details.name);
  expect(button('Continue preparation').disabled).toBe(true);h.run.mockResolvedValue({...ready,state:'resources_unknown',results:[]});click('Read resource outcome');await vi.waitFor(()=>expect(h.run).toHaveBeenCalledTimes(2));
  expect(h.run.mock.calls[1][2]).toBe('read');expect(h.run.mock.calls[1][1]).toBe(h.run.mock.calls[0][1]);
 });
 it('resumes the server-bound operation after reopening instead of generating a new one',async()=>{
  h.read.mockResolvedValue({...ready,state:'resources_preparing',results:[]});await open();confirm();h.run.mockResolvedValue(ready);click('Continue preparation');await vi.waitFor(()=>expect(h.run).toHaveBeenCalledTimes(1));expect(h.run.mock.calls[0].slice(0,3)).toEqual([details.id,'test-operation','continue']);
 });
 it('keeps independent obligations blocked and cancellation causes no provider operation',async()=>{
  h.preview.mockResolvedValue({...review,execution_available:false,blockers:['A financial retention obligation remains.']});const {cancel}=await open();confirm();expect(button('Suspend connections').disabled).toBe(true);click('Back');expect(cancel).toHaveBeenCalledTimes(1);expect(h.run).not.toHaveBeenCalled();
 });
});
