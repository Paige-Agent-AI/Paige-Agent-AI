import React from 'react';
import {useTheme} from 'next-themes';
import {supabase} from '@/integrations/supabase/client';
import {Dialog,DialogClose,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
import {prepareCommercialPresentationFromRecords,type CommercialPresentationProposal} from '../../../supabase/functions/_shared/agreements/commercial-presentation-read';
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
export function CommercialAgreementPreview({tenantId,invoiceId,agreementId}:{tenantId:string;invoiceId:string;agreementId:string}){
  const {resolvedTheme}=useTheme();
  const heading=React.useRef<HTMLHeadingElement>(null);
  const [open,setOpen]=React.useState(false),[attempt,setAttempt]=React.useState(0);
  const scope=`${tenantId}:${invoiceId}:${agreementId}`;
  const [read,setRead]=React.useState<{scope:string;value:CommercialPresentationProposal}|null>(null);
  const proposal=read?.scope===scope?read.value:null;
  React.useEffect(()=>{
    setRead(null);if(!open)return;let current=true;
    void prepareCommercialPresentationFromRecords(tenantId,{invoice_id:invoiceId,agreement_id:agreementId},supabase)
      .then(value=>{if(current)setRead({scope,value});})
      .catch(()=>{if(current)setRead({scope,value:{state:'refused',code:'PRESENTATION_SOURCE_UNAVAILABLE'}});});
    return()=>{current=false;};
  },[open,attempt,tenantId,invoiceId,agreementId,scope]);
  const source=proposal?.state==='proposed'?proposal.presentation.payload.source:null;
  return <Dialog open={open} onOpenChange={next=>{setRead(null);setOpen(next);}}>
    <DialogTrigger asChild><button type="button" className="btn commercial-agreement-preview-trigger">Review saved agreement</button></DialogTrigger>
    <DialogContent className="paige-solo commercial-agreement-preview" data-theme={resolvedTheme==='dark'?'dark':'light'} overlayClassName="commercial-agreement-preview-overlay" onOpenAutoFocus={event=>{event.preventDefault();heading.current?.focus();}}>
      <DialogHeader className="commercial-agreement-preview__heading">
        <DialogTitle ref={heading} tabIndex={-1}>Proposed agreement text</DialogTitle>
        <DialogDescription>Review the saved wording and dated payment terms. This preview does not send an agreement or record a signature.</DialogDescription>
      </DialogHeader>
      {!proposal?<p role="status">Preparing agreement text…</p>:proposal.state==='needs_input'?<section role="status">
        <h3>Information still needed</h3><ul>{proposal.fields.map(field=><li key={field}>{missingCopy[field]??'Review the saved agreement, payment terms and invoice before continuing.'}</li>)}</ul>
        <p>Correct the saved source records, then reopen this preview.</p>
      </section>:proposal.state==='refused'?<section role="alert">
        <p>The saved agreement could not be prepared in this workspace. Review the agreement, payment terms and invoice, then try again.</p>
        <button type="button" className="btn" onClick={()=>{setRead(null);setAttempt(n=>n+1);}}>Try again</button>
      </section>:<>
        <p className="commercial-agreement-preview__versions">Agreement version {source?.agreement_version} · Invoice draft version {source?.invoice_draft_version} · Payment terms version {source?.terms_version}</p>
        <h3>{proposal.presentation.payload.title}</h3>
        <article className="commercial-agreement-preview__text" aria-label="Proposed agreement document" tabIndex={0}>{proposal.presented_body_markdown}</article>
      </>}
      <div><DialogClose asChild><button type="button" className="btn">Back to invoice</button></DialogClose></div>
    </DialogContent>
  </Dialog>;
}
