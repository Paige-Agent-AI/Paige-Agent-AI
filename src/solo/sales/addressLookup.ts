import type{InvoiceAddress}from'./invoiceDraftSnapshot';
export interface AddressSearchContext{tenantId:string;clientId:string;country:string;address:string}
export interface AddressCandidate{label:string;line1:string;city:string;region:string;postal_code:string;country:'US'}
export type AddressSearchResult={status:'ready';context:AddressSearchContext;candidates:AddressCandidate[]}|{status:'cancelled'|'unavailable'};
export type AddressLookupInvoke=(body:{expected_tenant_id:string;country:'US';address:string})=>Promise<unknown>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const safe=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max&&!Array.from(v).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127);
const candidate=(v:unknown):v is AddressCandidate=>object(v)&&Object.keys(v).length===6&&v.country==='US'&&safe(v.label,400)&&safe(v.line1,200)&&/^\d+[A-Za-z]?(?:-\d+)?\s+/.test(String(v.line1))&&safe(v.city,100)&&/^[A-Z]{2}$/.test(String(v.region))&&/^\d{5}(?:-\d{4})?$/.test(String(v.postal_code));
/** Invoke is injected; no effect until an explicit human Search calls this helper.
 * Abort/current-scope guards cancel response publication, not outbound network transport. */
export async function searchUsAddress(context:AddressSearchContext,invoke:AddressLookupInvoke,guard:{signal?:AbortSignal;isCurrent():boolean}):Promise<AddressSearchResult>{
 const snapshot={...context};const stale=()=>guard.signal?.aborted||!guard.isCurrent();if(stale())return{status:'cancelled'};
 if(snapshot.country!=='US'||!uuid.test(snapshot.tenantId)||!snapshot.clientId||!safe(snapshot.address,300))return{status:'unavailable'};
 try{const response=await invoke({expected_tenant_id:snapshot.tenantId,country:'US',address:snapshot.address});if(stale())return{status:'cancelled'};if(!object(response)||response.source!=='census_geocoding_suggestion'||response.verification!=='not_postal_verified'||!Array.isArray(response.candidates)||response.candidates.length>20||!response.candidates.every(candidate))return{status:'unavailable'};return{status:'ready',context:snapshot,candidates:response.candidates.map(c=>({...c}))}}catch{return{status:stale()?'cancelled':'unavailable'}}
}
/** Explicit selection only. Caller must still honor editor lock and current request generation. */
export function applyAddressCandidate(result:Extract<AddressSearchResult,{status:'ready'}>,index:number,current:InvoiceAddress|null,context:AddressSearchContext):InvoiceAddress|null{
 if(!Number.isInteger(index)||index<0||Object.keys(result.context).some(key=>result.context[key as keyof AddressSearchContext]!==context[key as keyof AddressSearchContext]))return null;
 const chosen=result.candidates[index];if(!chosen||!candidate(chosen))return null;return{line1:chosen.line1,line2:current?.line2??null,city:chosen.city,region:chosen.region,postal_code:chosen.postal_code,country:chosen.country};
}
