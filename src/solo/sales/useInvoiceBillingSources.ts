import { useEffect, useRef, useState } from 'react';
import { useTenantContext } from '@/hooks/useTenantContext';
import { supabase } from '@/integrations/supabase/client';
import { CLIENT_CONTACT_METHODS_EMBED, orderContactMethods, type ContactMethodRow } from '@/lib/contact-methods';
import type { InvoiceCustomerChoice, InvoiceAgreementChoice } from './InvoiceDraftEditor';
type ReadResult = {data:Record<string,unknown>[]|null;error:unknown};
interface SourceQuery extends PromiseLike<ReadResult>{select(columns:string):SourceQuery;eq(column:string,value:string):SourceQuery;order(column:string,options:{ascending:boolean}):SourceQuery;limit(count:number):SourceQuery;range(from:number,to:number):SourceQuery;or(filters:string):SourceQuery;}
const from = supabase.from as unknown as (table:string)=>SourceQuery;
const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null;
export function invoiceCustomerFromRow(row: Record<string, unknown>): InvoiceCustomerChoice {
  const methods = orderContactMethods(row.client_contact_methods as ContactMethodRow[] | null).map(m => ({...m,value:m.value.trim()}));
  const full = [text(row.first_name),text(row.last_name)].filter(Boolean).join(' ');
  const company = text(row.entity_name);
  const name = company && (text(row.entity_type) || !full) ? company : full || company || methods.find(m=>m.kind==='email'&&m.isPrimary)?.value || 'Unnamed contact';
  const address = {line1:text(row.street_address),line2:null,city:text(row.city),region:text(row.state),postal_code:text(row.zip_code),country:null};
  return {id:String(row.id),name,methods,address:Object.values(address).some(Boolean)?address:null};
}
export function invoiceAgreementFromRow(row: Record<string, unknown>): InvoiceAgreementChoice {
  const status = String(row.status); const expiresAt=text(row.expires_at);
  return {id:String(row.id),clientId:String(row.contact_id),title:text(row.title)||'Agreement',version:Number(row.version),status,expiresAt,
    eligible:['draft','sent','viewed','partially_signed','completed'].includes(status)&&(!expiresAt||(Number.isFinite(Date.parse(expiresAt))&&Date.parse(expiresAt)>Date.now()))};
}

export type BillingSourceOptions={customerSearch?:string;customerPage?:number;clientId?:string|null;agreementPage?:number;agreementId?:string|null};
export function billingClientSearchFilter(search:string){
 const special='.*+?^${}()|[]'+String.fromCharCode(92);
 return search.trim().split(/\s+/).filter(Boolean).flatMap(term=>{const literal=[...term].map(character=>special.includes(character)?String.fromCharCode(92)+character:character).join('');return ['first_name','last_name','entity_name'].map(column=>`${column}.imatch.${JSON.stringify(literal)}`);}).join(',');
}
type State={identity:object;queryKey:string;phase:'loading'|'ready'|'error';customers:InvoiceCustomerChoice[];agreements:InvoiceAgreementChoice[];customersHasMore:boolean;agreementsHasMore:boolean};
const PAGE_SIZE=50;
const customerColumns=`id,tenant_id,first_name,last_name,entity_name,entity_type,street_address,city,state,zip_code,${CLIENT_CONTACT_METHODS_EMBED}`;
const agreementColumns='id,tenant_id,contact_id,title,version,status,expires_at';
const empty={customers:[],agreements:[],customersHasMore:false,agreementsHasMore:false};
/** Bounded SELECT-only sources plus exact selected-record reads, all tenant guarded. */
export function useInvoiceBillingSources(options:BillingSourceOptions={}){
 const {activeTenantId,accountContextLoading}=useTenantContext();
 const identity=useRef({tenant:activeTenantId,resolving:accountContextLoading});
 if(identity.current.tenant!==activeTenantId||identity.current.resolving!==accountContextLoading)identity.current={tenant:activeTenantId,resolving:accountContextLoading};
 const search=(options.customerSearch??'').trim().slice(0,100),page=Math.max(0,Math.floor(options.customerPage??0)),agreementPage=Math.max(0,Math.floor(options.agreementPage??0)),clientId=options.clientId??null,agreementId=options.agreementId??null;
 const queryKey=JSON.stringify([search,page,clientId,agreementPage,agreementId]);
 const [refresh,setRefresh]=useState(0);const [state,setState]=useState<State>({identity:identity.current,queryKey,phase:'loading',...empty});
 useEffect(()=>{const opened=identity.current;let cancelled=false;setState({identity:opened,queryKey,phase:'loading',...empty});if(!opened.tenant||opened.resolving)return;
 let customers=from('clients').select(customerColumns).eq('tenant_id',opened.tenant).order('created_at',{ascending:false}).order('id',{ascending:false});
 if(search)customers=customers.or(billingClientSearchFilter(search));
 const noRows:ReadResult={data:[],error:null};
 void Promise.all([
 customers.range(page*PAGE_SIZE,page*PAGE_SIZE+PAGE_SIZE),
 clientId?from('clients').select(customerColumns).eq('tenant_id',opened.tenant).eq('id',clientId).limit(1):Promise.resolve(noRows),
 clientId?from('paige_agreements').select(agreementColumns).eq('tenant_id',opened.tenant).eq('contact_id',clientId).order('created_at',{ascending:false}).order('id',{ascending:false}).range(agreementPage*PAGE_SIZE,agreementPage*PAGE_SIZE+PAGE_SIZE):Promise.resolve(noRows),
 clientId&&agreementId?from('paige_agreements').select(agreementColumns).eq('tenant_id',opened.tenant).eq('contact_id',clientId).eq('id',agreementId).limit(1):Promise.resolve(noRows),
 ]).then(([list,selected,agreements,selectedAgreement])=>{
 if(cancelled||identity.current!==opened)return;
 const all=[list,selected,agreements,selectedAgreement];
 if(all.some(result=>result.error)||(list.data??[]).some(row=>row.tenant_id!==opened.tenant)||(selected.data??[]).some(row=>row.tenant_id!==opened.tenant||row.id!==clientId)||[...(agreements.data??[]),...(selectedAgreement.data??[])].some(row=>row.tenant_id!==opened.tenant||row.contact_id!==clientId)||(selectedAgreement.data??[]).some(row=>row.id!==agreementId)){setState({identity:opened,queryKey,phase:'error',...empty});return;}
 const unique=(rows:Record<string,unknown>[])=>[...new Map(rows.map(row=>[row.id,row])).values()];
 setState({identity:opened,queryKey,phase:'ready',customers:unique([...(list.data??[]).slice(0,PAGE_SIZE),...(selected.data??[])]).map(invoiceCustomerFromRow),agreements:unique([...(agreements.data??[]).slice(0,PAGE_SIZE),...(selectedAgreement.data??[])]).map(invoiceAgreementFromRow),customersHasMore:(list.data??[]).length>PAGE_SIZE,agreementsHasMore:(agreements.data??[]).length>PAGE_SIZE});
 }).catch(()=>{if(!cancelled&&identity.current===opened)setState({identity:opened,queryKey,phase:'error',...empty});});return()=>{cancelled=true};
 },[activeTenantId,accountContextLoading,refresh,queryKey,search,page,clientId,agreementPage,agreementId]);
 const visible=state.identity===identity.current&&state.queryKey===queryKey?state:{phase:'loading' as const,...empty};
 return {...visible,tenantId:activeTenantId??null,phase:accountContextLoading?'loading' as const:visible.phase,retry:()=>setRefresh(n=>n+1)};
}
