import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {CommercialSigningNavigation,type OpenCommercialSigning} from './CommercialSigningNavigation';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({onAuth:null as null|((event:string,session:{user:{id:string}}|null)=>void)}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{onAuthStateChange:(callback:NonNullable<typeof h.onAuth>)=>{h.onAuth=callback;callback('INITIAL_SESSION',{user:{id:'owner'}});return {data:{subscription:{unsubscribe(){}}}};}}}}));
let host:HTMLDivElement,root:Root;const target={tenantId:'workspace-a',agreementId:'exact-agreement',agreementVersion:4,clientId:'exact-client'};
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});afterEach(()=>{act(()=>root.unmount());host.remove();});
async function paint(onOpen:OpenCommercialSigning,version=4){await act(async()=>root.render(<CommercialSigningNavigation target={{...target,agreementVersion:version}} onOpen={onOpen}/>));}
const click=()=>act(async()=>host.querySelector('button')!.click());
it('navigates with exact source identifiers and a live consumer fence, without creating a signing action',async()=>{
 const open=vi.fn<OpenCommercialSigning>().mockImplementation(async(value,current)=>{expect(value).toEqual(target);expect(current()).toBe(true);return {ok:true};});await paint(open);await click();expect(open).toHaveBeenCalledOnce();expect(host.querySelector('button')?.textContent).toBe('Manage signatures');
});
it.each(['actor','source','unmount'])('retires pending navigation when %s changes',async kind=>{
 let finish!:(value:{ok:boolean;message:string})=>void,current!:()=>boolean;const open:OpenCommercialSigning=(_value,fence)=>{current=fence;return new Promise(r=>finish=r);};await paint(open);await click();expect(current()).toBe(true);
 if(kind==='actor')await act(async()=>h.onAuth!('SIGNED_IN',{user:{id:'different'}}));if(kind==='source')await paint(open,5);if(kind==='unmount')await act(async()=>root.render(null));expect(current()).toBe(false);
 await act(async()=>finish({ok:false,message:'Stale private result'}));expect(host.textContent).not.toContain('Stale private result');
});
it('preserves a pending read across the same actor token refresh and reports a current refusal',async()=>{
 let finish!:(value:{ok:boolean;message:string})=>void,current!:()=>boolean;await paint((_value,fence)=>{current=fence;return new Promise(r=>finish=r);});await click();await act(async()=>h.onAuth!('TOKEN_REFRESHED',{user:{id:'owner'}}));expect(current()).toBe(true);
 await act(async()=>finish({ok:false,message:'Refresh this signing version'}));expect(host.querySelector('[role="alert"]')?.textContent).toBe('Refresh this signing version');
});
