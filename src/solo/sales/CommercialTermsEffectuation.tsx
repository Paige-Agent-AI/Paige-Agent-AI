import React from 'react';
import {supabase} from '@/integrations/supabase/client';
import {readAcceptedCommercialAgreement} from '../../../supabase/functions/_shared/agreements/accepted-commercial-read';
import {parseCommercialEffectuationCommand,type CommercialEffectuationCommand} from '../../../supabase/functions/_shared/sales-commercial/effectuation-command';
import {UUID} from '../../../supabase/functions/_shared/sales-collections/primitives';
import {CollectionCommandReview} from './collections/CollectionCommandReview';
import './collections/collections.css';

type Props={tenantId:string;invoiceId:string;agreementId:string;termsId:string;termsVersion:number;termsUpdatedAt:string;
 onRecorded(message:string):void;onReturnFocus():void};
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** Existing owner-read -> exact source brakes -> incumbent Collections approval.
 * No retained legal text is supplied to the command or copied into intent storage. */
export function CommercialTermsEffectuation({tenantId,invoiceId,agreementId,termsId,termsVersion,termsUpdatedAt,onRecorded,onReturnFocus}:Props){
 const [busy,setBusy]=React.useState(false),[notice,setNotice]=React.useState(''),[command,setCommand]=React.useState<CommercialEffectuationCommand|null>(null);
 const epoch=React.useRef(0),opener=React.useRef<HTMLButtonElement>(null);
 React.useEffect(()=>{
  let actor:string|null|undefined;
  const retire=()=>{epoch.current++;};
  const {data}=supabase.auth.onAuthStateChange((event,session)=>{
   const next= session?.user.id??null,previous=actor;actor=next;
   if(previous===next||previous===undefined&&event==='INITIAL_SESSION')return;
   retire();setBusy(false);setCommand(null);setNotice('Your account changed. Refresh the commercial record before continuing.');
  });
  return()=>{retire();data.subscription.unsubscribe();};
 },[tenantId,invoiceId,agreementId,termsId,termsVersion,termsUpdatedAt]);
 const prepare=async()=>{
  if(busy||command)return;const started=epoch.current;setBusy(true);setNotice('');
  try{
   const read=await readAcceptedCommercialAgreement(tenantId,{invoice_id:invoiceId,agreement_id:agreementId},supabase);
   if(started!==epoch.current)return;
   if(read.state!=='recorded'){setNotice(read.state==='unverified'?'The exact accepted commercial record is not verified. Review the agreement before continuing.':'The accepted agreement could not be read with your current access. Refresh and try again.');return;}
   const source=read.presentation.payload.source;
   const exact=parseCommercialEffectuationCommand({action:'collection.effectuate_terms',agreement_id:source.terms_id,expected_version:source.terms_version,
    expected_updated_at:source.terms_updated_at,signing_id:source.agreement_id,signing_version:source.agreement_version,invoice_id:source.invoice_id,
    invoice_draft_version:source.invoice_draft_version,payload_digest:read.presentation.payload_digest,sealed_sha256:read.sealed_sha256});
   if(exact.agreement_id!==termsId||exact.expected_version!==termsVersion||exact.expected_updated_at!==termsUpdatedAt){
    setNotice('Current commercial terms changed after this agreement was prepared. Review both records and obtain a matching agreement before continuing.');return;
   }
   setCommand(exact);
  }catch{if(started===epoch.current)setNotice('The accepted source could not be prepared for review. Refresh the commercial record and try again.');}
  finally{if(started===epoch.current)setBusy(false);}
 };
 const focus=()=>{if(opener.current?.isConnected)opener.current.focus();else onReturnFocus();};
 return <><button ref={opener} type="button" className="btn" disabled={busy||!!command} onClick={()=>void prepare()}>{busy?'Checking accepted terms…':'Review making terms effective'}</button>
  {notice&&<p role="alert">{notice}</p>}
  {command&&<CollectionCommandReview tenantId={tenantId} command={command} onReturnFocus={focus} onClose={()=>setCommand(null)} onComplete={result=>{
   const row=object(result.row)?result.row:null,operation=object(result.operation)?result.operation:null;
   const matches=result.outcome==='commercial_terms_effectuated'&&result.historical_receipt===true&&typeof result.receipt_id==='string'&&UUID.test(result.receipt_id)
    &&operation?.action==='collection.effectuate_terms'&&row?.id===termsId&&row.signing_id===agreementId&&row.terms_version===command.expected_version&&row.source_digest===command.payload_digest;
   setCommand(null);onRecorded(matches?'The approved operation is recorded. Read the refreshed commercial status below; its receipt does not confirm payment or completed services.':'An earlier collection operation was recovered. Read the refreshed records before starting the newly requested action.');
  }}/>}
 </>;
}
