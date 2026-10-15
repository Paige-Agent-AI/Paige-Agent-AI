import React from 'react';
import {useTheme} from 'next-themes';
import {supabase} from '@/integrations/supabase/client';
import {Dialog,DialogClose,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
import {prepareCommercialPresentationFromRecords,type CommercialPresentationProposal} from '../../../supabase/functions/_shared/agreements/commercial-presentation-read';
import {readAcceptedCommercialAgreement,type AcceptedCommercialRead} from '../../../supabase/functions/_shared/agreements/accepted-commercial-read';
import './commercial-agreement-preview.css';

const missingCopy:Record<string,string>={
  canonical_invoice_draft:'Save the invoice draft before preparing this agreement.',
  agreement_source_version:'Select the current signing agreement in the saved invoice draft.',
  commercial_terms_reference:'Select the recorded payment plan in the saved invoice draft.',
  recorded_collection_terms:'Record the dated payment schedule in Terms & Agreements.',
  tax_and_fee_treatment:'Record tax and fee treatment in the invoice draft.',
  recorded_invoice_lines:'Save the agreed service items in the invoice draft.',
  complete_supported_commercial_presentation:'These recorded terms cannot currently be prepared together as a supported commercial agreement. Keep the recorded terms and review this limitation before sending.',
};

/** Explicit owner review of the same canonical C1 proposal; no freeze, signing,
 * approval, send or payment. Parent keys this to account/source/read generation. */
export function CommercialAgreementPreview({tenantId,invoiceId,agreementId,mode='proposed'}:{tenantId:string;invoiceId:string;agreementId:string;mode?:'proposed'|'accepted'}){
  const {resolvedTheme}=useTheme();
  const heading=React.useRef<HTMLHeadingElement>(null);
  const [open,setOpen]=React.useState(false),[attempt,setAttempt]=React.useState(0);
  const accepted=mode==='accepted',scope=`${tenantId}:${invoiceId}:${agreementId}:${mode}`;
  const [read,setRead]=React.useState<{scope:string;value:CommercialPresentationProposal|AcceptedCommercialRead}|null>(null);
  const proposal=read?.scope===scope?read.value:null;
  React.useEffect(()=>{
    setRead(null);if(!open)return;let current=true;
    const reader=accepted?readAcceptedCommercialAgreement:prepareCommercialPresentationFromRecords;
    void reader(tenantId,{invoice_id:invoiceId,agreement_id:agreementId},supabase)
      .then(value=>{if(current)setRead({scope,value});})
      .catch(()=>{if(current)setRead({scope,value:{state:'refused',code:'PRESENTATION_SOURCE_UNAVAILABLE'}});});
    return()=>{current=false;};
  },[open,attempt,tenantId,invoiceId,agreementId,scope,accepted]);
  const document=proposal?.state==='proposed'||proposal?.state==='recorded'?proposal:null;
  const source=document?.presentation.payload.source;
  return <Dialog open={open} onOpenChange={next=>{setRead(null);setOpen(next);}}>
    <DialogTrigger asChild><button type="button" className="btn commercial-agreement-preview-trigger">{accepted?'Review accepted agreement':'Review saved agreement'}</button></DialogTrigger>
    <DialogContent className="paige-solo commercial-agreement-preview" data-theme={resolvedTheme==='dark'?'dark':'light'} overlayClassName="commercial-agreement-preview-overlay" onOpenAutoFocus={event=>{event.preventDefault();heading.current?.focus();}}>
      <DialogHeader className="commercial-agreement-preview__heading">
        <DialogTitle ref={heading} tabIndex={-1}>{accepted?'Accepted agreement record':'Proposed agreement text'}</DialogTitle>
        <DialogDescription>{accepted?'Read the exact retained wording and payment terms. This record does not activate commercial terms or confirm payment or completed services.':'Review the saved wording and dated payment terms. This preview does not send an agreement or record a signature.'}</DialogDescription>
      </DialogHeader>
      {!proposal?<p role="status">{accepted?'Reading accepted agreement…':'Preparing agreement text…'}</p>:proposal.state==='unverified'?<p role="status">Accepted commercial economics are unverified for this agreement. Current payment terms cannot establish what was signed.</p>:proposal.state==='needs_input'?<section role="status">
        <h3>Information still needed</h3><ul>{proposal.fields.map(field=><li key={field}>{missingCopy[field]??'Review the saved agreement, payment terms and invoice before continuing.'}</li>)}</ul>
        <p>Correct the saved source records, then reopen this preview.</p>
      </section>:proposal.state==='refused'?<section role="alert">
        <p>{accepted?'The retained agreement could not be read in this workspace. Check access and try again.':'The saved agreement could not be prepared in this workspace. Review the agreement, payment terms and invoice, then try again.'}</p>
        <button type="button" className="btn" onClick={()=>{setRead(null);setAttempt(n=>n+1);}}>Try again</button>
      </section>:<>
        <p className="commercial-agreement-preview__versions">Agreement version {source?.agreement_version} · {accepted?'Source invoice draft version':'Invoice draft version'} {source?.invoice_draft_version} · {accepted?'Accepted payment terms version':'Payment terms version'} {source?.terms_version}</p>
        {document?.state==='recorded'&&<p className="commercial-agreement-preview__versions">Signing completion recorded at {document.completed_at}</p>}
        <h3>{document?.presentation.payload.title}</h3>
        <article className="commercial-agreement-preview__text" aria-label={accepted?'Accepted agreement document':'Proposed agreement document'} tabIndex={0}>{document?.presented_body_markdown}</article>
      </>}
      <div><DialogClose asChild><button type="button" className="btn">Back to invoice</button></DialogClose></div>
    </DialogContent>
  </Dialog>;
}
