import React from 'react';
import {supabase} from '@/integrations/supabase/client';
import type {BillingRpc} from './billingDrafts';
import type {InvoiceReceipt} from './invoiceLifecycleApi';
import {readOriginalManualReceiptAssignments,type ManualReceiptAssignmentRead} from './manualReceiptAssignments';
import {formatPaymentMinor} from './customerPaymentRequest';

type Props={tenantId:string;invoiceId:string;version:number;receipt:InvoiceReceipt;canManage:boolean;accountEpoch?:string|null;onReload():void};
/** Explicit scoped read inside the ORIGINAL receipt history. Data is discarded
 * on any account/session/source incarnation change, including A→B→A. */
export function InvoiceReceiptAssignments({tenantId,invoiceId,version,receipt,canManage,accountEpoch=null,onReload}:Props){
 const [actor,setActor]=React.useState({id:null as string|null,resolved:false,epoch:0});
 React.useEffect(()=>{
  let alive=true,epoch=0;
  void supabase.auth.getSession().then(({data})=>{if(alive&&epoch===0)setActor({id:data.session?.user.id??null,resolved:true,epoch})}).catch(()=>{if(alive&&epoch===0)setActor({id:null,resolved:true,epoch})});
  const {data}=supabase.auth.onAuthStateChange((_event,session)=>{epoch++;if(alive)setActor({id:session?.user.id??null,resolved:true,epoch})});
  return()=>{alive=false;data.subscription.unsubscribe()};
 },[]);
 const key=JSON.stringify([tenantId,invoiceId,version,receipt.id,receipt.amount_cents,receipt.evidence_kind,canManage,accountEpoch,actor]);
 const identity=React.useRef({key});if(identity.current.key!==key)identity.current={key};
 const scope=identity.current;
 const [request,setRequest]=React.useState<{scope:typeof scope}|null>(null),[view,setView]=React.useState<{request:NonNullable<typeof request>;value:ManualReceiptAssignmentRead}|null>(null);
 const latest=React.useRef(request),trigger=React.useRef<HTMLButtonElement>(null),heading=React.useRef<HTMLHeadingElement>(null);
 const eligible=canManage&&actor.resolved&&Boolean(actor.id)&&receipt.kind==='receipt'&&receipt.evidence_kind!=='provider_verified';
 const active=eligible&&request?.scope===scope?request:null,value=active&&view?.request===active?view.value:null,loading=Boolean(active&&!value);
 React.useEffect(()=>{
  if(!active)return;let alive=true;const opened=scope;
  const rpc:BillingRpc=(name,args)=>(supabase.rpc as unknown as BillingRpc).call(supabase,name,args);
  void readOriginalManualReceiptAssignments(rpc,{tenantId,invoiceId,version,receipt}).then(value=>{if(alive&&identity.current===opened&&latest.current===active)setView({request:active,value})});
  return()=>{alive=false};
 },[active,scope,tenantId,invoiceId,version,receipt]);
 React.useLayoutEffect(()=>{if(value)heading.current?.focus()},[value]);
 const inspect=()=>{if(!eligible)return;const next={scope:identity.current};latest.current=next;setRequest(next)};
 const close=()=>{latest.current=null;setRequest(null);setView(null);trigger.current?.focus()};
 if(!eligible)return null;
 return <section className="sb-receipt-assignments" aria-label="Original receipt assignments" aria-busy={loading}>
  <button type="button" className="btn" ref={trigger} disabled={loading} onClick={inspect}>{active?'Refresh receipt assignments':'Inspect payment assignments'}</button>
  {active&&<button type="button" className="btn" onClick={close}>{loading?'Cancel receipt reading':'Close assignments'}</button>}
  {loading&&<p role="status">Reading this original receipt and its immutable payment assignments…</p>}
  {value&&<><h5 ref={heading} tabIndex={-1}>Original payment assignments</h5>
   {value.state==='refused'?<p role="alert">This receipt’s assignments could not be read. Check workspace access and retry. No payment changed.</p>:value.state==='stale'?<p role="status">The invoice changed. <button type="button" className="btn" onClick={onReload}>Reload original invoice</button></p>:<>
    {value.state==='assigned'?<ol>{value.allocations.map(item=><li key={item.obligation.reference.sequence}><strong>Payment {item.obligation.reference.sequence} · {formatPaymentMinor(item.amount_cents,'usd')}</strong><p>Due <time dateTime={item.obligation.due_date}>{item.obligation.due_date}</time> · Accepted terms version {item.obligation.reference.terms_version} · Signing version {item.obligation.reference.signing_version}</p></li>)}</ol>:<p role="status">{value.state==='unassigned'?'No accepted payment assignments were recorded with this original receipt. PAIGE will not guess them.':'The original receipt’s assignment evidence could not be verified. Inspect the original record before correcting it.'}</p>}
    {value.reversalPaymentId&&<p>This receipt has a recorded full correction. Its original assignments are retained as history and no longer reduce the accepted payments.</p>}
    <p>Business-recorded history does not verify a provider payment or refund, or completion of services.</p>
   </>}
  </>}
 </section>;
}
