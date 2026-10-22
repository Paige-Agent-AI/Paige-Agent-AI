// Existing local source mount ONLY. Actual PDF/field components and native
// validator; neutral bytes/identity, no hosted save or acceptance evidence.
import React from 'react';
import {AgreementDocumentFields} from '@/solo/sales/AgreementDocumentFields';
import type {AssignedField,DocumentDescriptor,DocumentSigner} from '@/solo/sales/agreementDocumentModel';
import type {AgreementFieldPreparation} from '../../../../supabase/functions/_shared/agreements/field-preparation';
type Fixture={bytes:string;document:DocumentDescriptor;source:unknown;signers:DocumentSigner[]};
export function AgreementDocumentFieldsMount(){
  const [fixture,setFixture]=React.useState<Fixture|null>(null),[epoch,setEpoch]=React.useState(0);
  const [fields,setFields]=React.useState<AssignedField[]>([]),[proposal,setProposal]=React.useState<AgreementFieldPreparation|null>(null);
  const [canView,setCanView]=React.useState(true),[canEdit,setCanEdit]=React.useState(true);
  React.useEffect(()=>{let current=true;setFixture(null);setFields([]);setProposal(null);void fetch('/__e04_document_fixture__').then(response=>response.json()).then(data=>{if(current)setFixture(data);});return()=>{current=false;};},[epoch]);
  React.useEffect(()=>{const listener=(event:Event)=>{const detail=(event as CustomEvent).detail;if('canView'in detail){setCanView(detail.canView);if(!detail.canView){setFixture(current=>current?{...current,bytes:'',source:null,signers:[]}:null);setFields([]);setProposal(null);}else setEpoch(value=>value+1);}if('canEdit'in detail)setCanEdit(detail.canEdit);};window.addEventListener('e04-document-fixture',listener);return()=>window.removeEventListener('e04-document-fixture',listener);},[]);
  const bytes=React.useMemo(()=>fixture?Uint8Array.from(atob(fixture.bytes),char=>char.charCodeAt(0)):null,[fixture]);
  return <div className="e04-preparation" style={{height:'100%',overflowY:'auto'}}>
    {fixture&&bytes?<AgreementDocumentFields authorityKey={`local-source-${epoch}`} canView={canView} canEdit={canEdit} title="Controlled document — page and field proof" bytes={bytes} document={fixture.document} source={fixture.source} signers={fixture.signers} fields={fields} onChange={setFields} onSave={setProposal} onReload={()=>setEpoch(value=>value+1)} onAddSigners={()=>{}}/>:<p role="status">Loading controlled PDF source…</p>}
    {proposal&&<p role="status">Local proposal captured. No native save was executed.</p>}
    <pre hidden data-proof-proposal>{proposal?JSON.stringify(proposal):''}</pre>
  </div>;
}
