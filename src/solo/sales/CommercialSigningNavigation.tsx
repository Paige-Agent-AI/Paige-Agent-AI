import React from 'react';
import {supabase} from '@/integrations/supabase/client';
import './commercial-agreement-preview.css';
export type CommercialSigningTarget={tenantId:string;agreementId:string;agreementVersion:number;clientId:string};
export type OpenCommercialSigning=(target:CommercialSigningTarget,stillCurrent:()=>boolean)=>Promise<{ok:boolean;message?:string}>;
/** Open the incumbent signature manager for THIS record. No signer, signing
 * link, message or business mutation is created by navigation. */
export function CommercialSigningNavigation({target,onOpen}:{target:CommercialSigningTarget;onOpen:OpenCommercialSigning}){
 const [busy,setBusy]=React.useState(false),[notice,setNotice]=React.useState('');
 const epoch=React.useRef(0),alive=React.useRef(true),scope=React.useRef('');
 scope.current=`${target.tenantId}:${target.agreementId}:${target.agreementVersion}:${target.clientId}`;
 React.useEffect(()=>{
  const lifecycle=epoch;
  alive.current=true;let actor:string|null|undefined;
  const {data}=supabase.auth.onAuthStateChange((event,session)=>{const next=session?.user.id??null,previous=actor;actor=next;if(previous===next||previous===undefined&&event==='INITIAL_SESSION')return;epoch.current++;setBusy(false);setNotice('Your account changed. Refresh the signing record before continuing.');});
  return()=>{alive.current=false;lifecycle.current++;data.subscription.unsubscribe();};
 },[target.tenantId,target.agreementId,target.agreementVersion,target.clientId]);
 const open=async()=>{
  if(busy)return;const started=epoch.current,captured=scope.current;setBusy(true);setNotice('');
  const current=()=>alive.current&&epoch.current===started&&scope.current===captured;
  try{const result=await onOpen(target,current);if(current()&&!result.ok)setNotice(result.message??'The signing record could not be opened. Refresh and try again.');}
  catch{if(current())setNotice('The signing record could not be opened. Refresh and try again.');}
  finally{if(current())setBusy(false);}
 };
 return <><button type="button" className="btn commercial-agreement-preview-trigger" disabled={busy} onClick={()=>void open()}>{busy?'Reading signing record…':'Manage signatures'}</button>{notice&&<p role="alert">{notice}</p>}</>;
}
