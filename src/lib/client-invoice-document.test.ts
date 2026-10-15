import {expect,it,vi} from 'vitest';
import {withClientInvoiceRead} from './client-invoice-document';

const id=(n:number)=>`ec041102-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),target={tenantId:id(2),clientId:id(3),invoiceId:id(4)};
function fixture(){
 const profile=vi.fn().mockResolvedValue({data:{id:target.clientId,tenant_id:target.tenantId,linked_user_id:actor},error:null});
 return {profile,caller:{auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:actor}},error:null}),
   getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:actor},access_token:'synthetic-transport-only'}},error:null})},
   from:vi.fn(()=>{throw Error('Raw CRM read unavailable');}),rpc:vi.fn((name:string,args:Record<string,unknown>)=>{
    expect(name).toBe('client_portal_self_profile');expect(args).toEqual({});return profile();
   })}};
}
it('re-proves the actual link and passes the existing token only as an Authorization header',async()=>{
 const {caller}=fixture(),read=vi.fn().mockResolvedValue('<html>Issued document</html>');
 const result=await withClientInvoiceRead(caller,target,()=>true,read);
 expect(result).toMatchObject({kind:'ready',scope:{actorId:actor,tenantId:target.tenantId,clientId:target.clientId},value:'<html>Issued document</html>'});
 expect(JSON.stringify(result)).not.toContain('synthetic-transport-only');
 expect(read).toHaveBeenCalledWith({target,headers:{Authorization:'Bearer synthetic-transport-only'}});
 expect(caller.auth.getUser).toHaveBeenCalledTimes(5);expect(caller.rpc).toHaveBeenCalledTimes(2);expect(caller.from).not.toHaveBeenCalled();
});
it('refuses a foreign client or tenant selector before any document request',async()=>{
 const {caller}=fixture(),read=vi.fn();
 expect(await withClientInvoiceRead(caller,{...target,clientId:id(8)},()=>true,read)).toEqual({kind:'refused'});
 expect(await withClientInvoiceRead(caller,{...target,tenantId:id(8)},()=>true,read)).toEqual({kind:'refused'});
 expect(read).not.toHaveBeenCalled();expect(caller.auth.getSession).not.toHaveBeenCalled();
});
it('does not use a cached session identity as authority',async()=>{
 const {caller}=fixture(),read=vi.fn();caller.auth.getSession.mockResolvedValue({data:{session:{user:{id:id(8)},access_token:'wrong-actor'}},error:null});
 expect(await withClientInvoiceRead(caller,target,()=>true,read)).toEqual({kind:'refused'});expect(read).not.toHaveBeenCalled();
});
it('discards document data after a link changes',async()=>{
 const {caller,profile}=fixture();
 const result=await withClientInvoiceRead(caller,target,()=>true,async()=>{profile.mockResolvedValue({data:null,error:null});return 'private document';});
 expect(result).toEqual({kind:'refused'});expect(JSON.stringify(result)).not.toContain('private document');
});
it('discards downloaded bytes after the view retires',async()=>{
 const {caller}=fixture();let current=true;
 const result=await withClientInvoiceRead(caller,target,()=>current,async()=>{current=false;return new Blob(['synthetic PDF']);});
 expect(result).toEqual({kind:'scope_changed'});
});
it('captures selected record identity before asynchronous authentication',async()=>{
 const {caller}=fixture(),selected={...target},read=vi.fn().mockResolvedValue('document');
 caller.auth.getSession.mockImplementation(async()=>{selected.invoiceId=id(8);return {data:{session:{user:{id:actor},access_token:'synthetic'}},error:null};});
 expect((await withClientInvoiceRead(caller,selected,()=>true,read)).kind).toBe('ready');
 expect(read.mock.calls[0][0].target.invoiceId).toBe(target.invoiceId);
});
