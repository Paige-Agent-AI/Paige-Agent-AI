import {useEffect,useRef,useState,useCallback} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useTenantContext} from '@/hooks/useTenantContext';
import {CLIENT_CONTACT_METHODS_EMBED,primaryAddressesOf,type ContactMethodRow} from '@/lib/contact-methods';

export type DealClient={id:string;name:string;primaryEmail:string|null};
const SELECT:string=`id,first_name,last_name,entity_name,entity_type,${CLIENT_CONTACT_METHODS_EMBED}`;
/** Read-only picker over canonical clients. No title matching or relationship writes. */
export function useSoloDealClients(tenantId:string|null,enabled=true){
 const {activeTenantId,accountContextLoading}=useTenantContext();
 const current=useRef({tenantId,activeTenantId,enabled,accountContextLoading});
 current.current={tenantId,activeTenantId,enabled,accountContextLoading};
 const [generation,setGeneration]=useState(0),[pages,setPages]=useState(1);
 const [state,setState]=useState<{tenantId:string|null;phase:'loading'|'ready'|'error';clients:DealClient[];hasMore:boolean}>({tenantId,phase:'loading',clients:[],hasMore:false});
 useEffect(()=>{setPages(1)},[tenantId]);
 useEffect(()=>{
  let alive=true;const capture=current.current;
  if(!enabled||!tenantId||activeTenantId!==tenantId||accountContextLoading)return;
  setState({tenantId,phase:'loading',clients:[],hasMore:false});
  void (async()=>{try{
   const {data,error}=await supabase.from('clients').select(SELECT).eq('tenant_id',tenantId).order('id').range(0,pages*250);
   if(!alive||current.current.tenantId!==capture.tenantId||current.current.activeTenantId!==capture.activeTenantId||!current.current.enabled||current.current.accountContextLoading)return;
   if(error){setState({tenantId,phase:'error',clients:[],hasMore:false});return;}
   const rows=(data??[]) as unknown as Record<string,unknown>[];
   const clients=rows.slice(0,pages*250).map(row=>{const full=[row.first_name,row.last_name].filter(x=>typeof x==='string').join(' ').trim(),company=typeof row.entity_name==='string'?row.entity_name.trim():'';const email=primaryAddressesOf(row.client_contact_methods as ContactMethodRow[]|null).email;return {id:String(row.id),name:company&&(!!row.entity_type||!full)?company:full||company||email||'Unnamed contact',primaryEmail:email};});
   setState({tenantId,phase:'ready',clients,hasMore:rows.length>pages*250});
  }catch{if(alive&&current.current.tenantId===capture.tenantId&&current.current.activeTenantId===capture.activeTenantId&&current.current.enabled&&!current.current.accountContextLoading)setState({tenantId,phase:'error',clients:[],hasMore:false});}})();
  return()=>{alive=false};
 },[tenantId,activeTenantId,enabled,accountContextLoading,generation,pages]);
 const retry=useCallback(()=>setGeneration(x=>x+1),[]),loadMore=useCallback(()=>setPages(x=>x+1),[]);
 const valid=enabled&&tenantId===activeTenantId&&!accountContextLoading&&state.tenantId===tenantId;
 return {...(valid?state:{tenantId,phase:'loading' as const,clients:[],hasMore:false}),retry,loadMore};
}
