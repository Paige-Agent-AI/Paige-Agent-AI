// Existing Sales source-mount only. The ORIGINAL panel renders unchanged;
// synthetic request results are never delivery, authority or customer proof.
import React from 'react';
import {SignatureSender} from '@/solo/sales-ops';
import type {SigningSendResult} from '@/solo/useSoloAgreementSignings';

const email='alexandra.montgomery.advisory.engagements@example.test';
export function AgreementSignatureRequestMount(){
  const [open,setOpen]=React.useState(false);
  const [requests,setRequests]=React.useState(0);
  const mode=new URLSearchParams(location.search).get('signatureOutcome')??'accepted';
  const signings={
    sendForSignature:async():Promise<SigningSendResult>=>{
      setRequests(value=>value+1);
      if(mode==='pending')return new Promise(()=>{});
      if(mode==='unknown')return {ok:false,state:'unconfirmed',message:'The request may have completed. Inspect the original agreement before sending again.'};
      if(mode==='refused')return {ok:false,state:'refused',message:'Agreement access changed before dispatch. This page did not request a send.'};
      return {ok:true,sent:[email],notDelivered:mode==='partial'?['earlier.recipient@example.test']:[],
        failed:mode==='partial'?[{email:'secondary.recipient.with.a.long.address@example.test',reason:'the email went out but its link could not be activated — resend it'}]:[],
        ...(mode==='partial'?{warning:'The agreement status could not be updated. Inspect its original record.'}:{})};
    },
    issueLink:async()=>({ok:false,message:'No signing link is created in this read-only local proof.'}),
    voidSigning:async()=>({ok:false,message:'No signing record is changed in this read-only local proof.'}),
  };
  return <section className="solo-campaigns" style={{height:'100%',display:'flex',flexDirection:'column'}}>
    <div className="campaigns-nav"><h1>Agreement request review</h1></div>
    <div className="campaigns-scroll" style={{padding:24}}>
      <p>Controlled unsigned agreement · No customer or provider connected</p>
      <button className="btn btn-p" onClick={()=>setOpen(true)}>Review signature request</button>
      <p role="status">Controlled request count: {requests}</p>
    </div>
    {open&&<SignatureSender tenantId="aaaaaaaa-0000-4000-8000-000000000001" signings={signings}
      signing={{id:'cccccccc-0000-4000-8000-000000000001',documentTitle:'Controlled unsigned advisory document',displayState:'sent'}}
      clientName="Alexandra Montgomery — Advisory Services Client" agreedLabel="From the original agreement"
      onClose={()=>setOpen(false)} onVoided={()=>{throw Error('No void permitted in local read-only proof');}}/>}
  </section>;
}
