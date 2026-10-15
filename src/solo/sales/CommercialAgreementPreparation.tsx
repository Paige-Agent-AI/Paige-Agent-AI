import React from 'react';
import {supabase} from '@/integrations/supabase/client';
import {prepareCommercialPresentationFromRecords} from '../../../supabase/functions/_shared/agreements/commercial-presentation-read';
import {commercialPreparationCommand,hasCommercialPreparationReceipt,type CommercialPreparationCommand} from '../../../supabase/functions/_shared/sales-commercial/preparation-command';
import {CollectionCommandReview} from './collections/CollectionCommandReview';
import {commercialMissingCopy} from './commercialMissingCopy';
import './commercial-agreement-preview.css';
type Props={tenantId:string;invoiceId:string;agreementId:string;onRecorded(message:string):void;onReturnFocus():void};
/** Fresh caller source -> closed intent -> existing high/confirm review. Legal
 * text stays in explicit human reads; recovery stores only IDs/versions/digest. */
export function CommercialAgreementPreparation({tenantId,invoiceId,agreementId,onRecorded,onReturnFocus}:Props){
 const [busy,setBusy]=React.useState(false),[notice,setNotice]=React.useState(''),[prepared,setPrepared]=React.useState<{scope:string;command:CommercialPreparationCommand}|null>(null);
 const scope=`${tenantId}:${invoiceId}:${agreementId}`,latestScope=React.useRef(scope);latestScope.current=scope;
 const command=prepared?.scope===scope?prepared.command:null;
 const epoch=React.useRef(0),opener=React.useRef<HTMLButtonElement>(null);
 React.useEffect(()=>{
  const lifecycle=epoch;
  setBusy(false);setPrepared(null);setNotice('');
  let actor:string|null|undefined;
  const {data}=supabase.auth.onAuthStateChange((event,session)=>{
   const next=session?.user.id??null,previous=actor;actor=next;
   if(previous===next||previous===undefined&&event==='INITIAL_SESSION')return;
   epoch.current++;setBusy(false);setPrepared(null);setNotice('Your account changed. Refresh the agreement before continuing.');
  });
  return()=>{lifecycle.current++;data.subscription.unsubscribe();};
 },[tenantId,invoiceId,agreementId]);
 const prepare=async()=>{
  if(busy||command)return;const started=epoch.current,captured=scope;setBusy(true);setNotice('');
  const current=()=>started===epoch.current&&latestScope.current===captured;
  try{
   const source=await prepareCommercialPresentationFromRecords(tenantId,{invoice_id:invoiceId,agreement_id:agreementId},supabase);
   if(!current())return;
   if(source.state==='needs_input'){setNotice(source.fields.map(field=>commercialMissingCopy[field]??'Review the saved agreement, payment terms and invoice.').join(' '));return;}
   if(source.state!=='proposed'){setNotice('The agreement could not be prepared with your current access. Refresh its source records before continuing.');return;}
   setPrepared({scope:captured,command:commercialPreparationCommand(source.presentation)});
  }catch{if(current())setNotice('The current document could not be prepared for review. Refresh the agreement and try again.');}
  finally{if(current())setBusy(false);}
 };
 const focus=()=>{if(opener.current?.isConnected)opener.current.focus();else onReturnFocus();};
 return <><button ref={opener} type="button" className="btn commercial-agreement-preview-trigger" disabled={busy||!!command} onClick={()=>void prepare()}>{busy?'Checking agreement…':'Prepare agreement for signing'}</button>
  {notice&&<p role="alert">{notice}</p>}
  {command&&<CollectionCommandReview tenantId={tenantId} command={command} onReturnFocus={focus} onClose={()=>setPrepared(null)} onComplete={result=>{
   const matches=hasCommercialPreparationReceipt(result,tenantId,command);setPrepared(null);
   onRecorded(matches?'The approved agreement document is recorded. Inspect its retained version and current signing status below. This does not confirm a signature, message, payment or completed service.':'An earlier operation was recovered. Read the refreshed records before starting the newly requested preparation.');
  }}/>}
 </>;
}
