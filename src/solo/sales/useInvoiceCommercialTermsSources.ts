import {useEffect,useRef,useState} from 'react';
import {useTenantContext} from '@/hooks/useTenantContext';
import {supabase} from '@/integrations/supabase/client';
import {decodeAgreement} from './collections/api';
import {UUID} from '../../../supabase/functions/_shared/sales-collections/contract';
import type {InvoiceCommercialTermsChoice} from './InvoiceDraftEditor';
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function decodeInvoiceCommercialTermsPage(value:unknown,tenant:string){
 if(!obj(value)||value.tenant_id!==tenant||typeof value.receipt_id!=='string'||!UUID.test(value.receipt_id)||!Array.isArray(value.rows)||value.rows.length>50||typeof value.has_more!=='boolean'||!(value.next_cursor===null||typeof value.next_cursor==='string'&&UUID.test(value.next_cursor))||value.has_more!==(value.next_cursor!==null))throw Error('Commercial terms could not be read.');
 const rows=value.rows.map(row=>decodeAgreement(row,tenant));if(rows.some(row=>!row)||new Set(rows.map(row=>row?.id)).size!==rows.length)throw Error('Commercial terms could not be read.');
 return {rows:rows.filter(row=>row!==null).map(row=>({id:row.id,clientId:row.client_id,title:row.title,version:row.collection_terms_version,status:row.status,termsCurrent:row.terms_current})),hasMore:value.has_more,next:value.next_cursor as string|null};
}
async function read(tenant:string,before:string|null){
 const {data,error}=await supabase.rpc('read_sales_collections' as never,{_expected_tenant_id:tenant,_entity:'agreement',_limit:50,_cursor:null,_before_id:before} as never);if(error)throw Error('Commercial terms could not be read.');return decodeInvoiceCommercialTermsPage(data,tenant);
}
type State={identity:object;clientId:string|null;phase:'loading'|'ready'|'error';rows:InvoiceCommercialTermsChoice[];next:string|null;loadingMore:boolean;error:string};
const blank=(identity:object,clientId:string|null):State=>({identity,clientId,phase:'loading',rows:[],next:null,loadingMore:false,error:''});
/** Same caller JWT/read receipt as Collections; no provider, mutation or inferred signing state. */
export function useInvoiceCommercialTermsSources({clientId}:{clientId:string|null}){
 const {activeTenantId,accountContextLoading}=useTenantContext();const identity=useRef({tenant:activeTenantId,resolving:accountContextLoading,clientId});
 if(identity.current.tenant!==activeTenantId||identity.current.resolving!==accountContextLoading||identity.current.clientId!==clientId)identity.current={tenant:activeTenantId,resolving:accountContextLoading,clientId};
 const [state,setState]=useState<State>(()=>blank(identity.current,clientId)),[refresh,setRefresh]=useState(0);const latest=useRef(state);latest.current=state;const claim=useRef<object|null>(null);
 useEffect(()=>{const opened=identity.current;let cancelled=false;claim.current=null;setState(blank(opened,clientId));if(!opened.tenant||opened.resolving||!clientId)return;
 void read(opened.tenant,null).then(page=>{if(!cancelled&&identity.current===opened)setState({identity:opened,clientId,phase:'ready',rows:page.rows,next:page.next,loadingMore:false,error:''})}).catch(()=>{if(!cancelled&&identity.current===opened)setState({...blank(opened,clientId),identity:opened,phase:'error',error:'Commercial terms could not be read. Refresh this workspace.'})});return()=>{cancelled=true};
 },[activeTenantId,accountContextLoading,clientId,refresh]);
 const loadMore=async()=>{const opened=identity.current,current=latest.current;if(!opened.tenant||opened.resolving||claim.current===opened||current.identity!==opened||current.phase!=='ready'||!current.next)return;const before=current.next;claim.current=opened;setState(s=>({...s,loadingMore:true,error:''}));try{const page=await read(opened.tenant,before);if(identity.current!==opened)return;if(page.next===before||page.rows.some(row=>current.rows.some(old=>old.id===row.id)))throw Error('Commercial terms page repeated.');setState(s=>({...s,rows:[...s.rows,...page.rows],next:page.next,loadingMore:false}));}catch{if(identity.current===opened)setState(s=>({...s,loadingMore:false,error:'More commercial terms could not be read. Refresh or retry; existing choices remain.'}));}finally{if(claim.current===opened)claim.current=null;}};
 const visible=state.identity===identity.current?state:blank(identity.current,clientId);return {commercialTerms:visible.rows.filter(row=>row.clientId===clientId),phase:accountContextLoading?'loading' as const:visible.phase,loadingMore:visible.loadingMore,hasMore:visible.next!==null,error:visible.error,loadMore,retry:()=>setRefresh(n=>n+1)};
}
