import React from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, ArrowRight, Check, FileText, Loader2, RefreshCw, Users } from 'lucide-react';
import { useTenantContext } from '@/hooks/useTenantContext';
import type { AgreementClient } from '../useSoloCommercialTerms';
import type { SigningsState, SigningEventsResult } from '../useSoloAgreementSignings';
import { useSalesDraftExit } from '../sales-dialog';
import { AgreementBodyEditor } from './AgreementBodyEditor';
import { AgreementWordingHistory } from './AgreementWordingHistory';
import { AgreementDraftCorrection, type AgreementCorrectionSession } from './AgreementDraftCorrection';
import { AgreementSignerPreparation, type AgreementSignerSession } from './AgreementSignerPreparation';
import type {DocumentGuard} from './AgreementDocumentPreparation';
import type {AgreementSignatureReference} from './agreementDocumentApi';
import { canPrepareAgreementSigners, emptySignerDraft, prepareAgreementSignerCommand, recoverAgreementSigner, saveAgreementSigner, type AgreementSignerReceipt } from './agreementSignerApi';
import { prepareAgreementCorrection, saveAgreementCorrection } from './agreementCorrectionApi';
import { createAgreementDraft, readAgreementPreparation, recoverAgreementCreation, type AgreementPreparation } from './agreementPreparationApi';
import {readAgreementTemplate,type AgreementTemplateVersion} from './agreementTemplateApi';
import { SIGNER_STATE, signingPreparationLabel } from './agreementVocabulary';
import './agreement-preparation.css';
const AgreementDocumentPreparation=React.lazy(()=>import('./AgreementDocumentPreparation').then(module=>({default:module.AgreementDocumentPreparation})));

type Props = {
  tenantId: string | null; canManage: boolean; authorityUnknown: boolean; authorizationReady: boolean;
  clients: readonly AgreementClient[]; clientsReady: boolean; clientsReadable: boolean;
  agreementId: string; requestId: string | null; requestTenantId: string | null; freshlyOpened: boolean;
  templateVersionId?: string | null;
  signerRequestId?: string | null;
  documentRequestId?: string | null;
  signatureReference?:AgreementSignatureReference|null;
  onSignatureRequestRetained?:(reference:AgreementSignatureReference)=>{url:string;replace:()=>void}|undefined;
  onDocumentRequestRetained?: (id: string | null) => { url: string; replace: () => void } | undefined;
  onSignerRequestRetained?: (id: string | null) => { url: string; replace: () => void } | undefined;
  onDraftAttempted: (requestId: string) => void;
  onOpenRecord: (id: string) => void; onClose: () => void; onOpenClients?: () => void;
  onOpenTemplate?: (id:string)=>void;
  signings: Pick<SigningsState, 'signingEvents' | 'signedCopyUrl'>; onRefresh: () => void;
};
type Phase = 'loading' | 'editing' | 'saving' | 'uncertain' | 'record' | 'error';

/** Mount only inside the existing Sales Terms & Agreements page. */
export function AgreementPreparationWorkspace(props: Props) {
  const scope = useTenantContext();
  const subject = scope.accountContextStatus === 'signed_out' ? null : scope.activeUserId;
  return <ScopedPreparation key={`${scope.activeTenantId}:${subject}:${props.agreementId}:${props.requestId}:${props.templateVersionId}`} {...props}
    activeTenantId={scope.activeTenantId} activeUserId={subject} scopeReady={scope.accountContextStatus === 'ready'} />;
}
function WorkspaceMessage({ title, text, onClose, onRetry }: { title: string; text: string; onClose: () => void; onRetry?: () => void }) {
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => { heading.current?.focus(); }, [title]);
  return <section className="e04-preparation"><button className="e04-preparation-back" onClick={onClose}><ArrowLeft size={16} />Agreements and terms</button><div className="e04-preparation-message"><FileText size={28} aria-hidden="true" /><h2 tabIndex={-1} ref={heading}>{title}</h2><p>{text}</p>{onRetry && <button onClick={onRetry}><RefreshCw size={16} />Check again</button>}</div></section>;
}
type SessionProps = Props & { activeTenantId: string | null; activeUserId: string | null; scopeReady: boolean };
function ScopedPreparation({ tenantId, agreementId, requestId, requestTenantId, freshlyOpened, templateVersionId=null, signerRequestId=null, documentRequestId=null,signatureReference=null,onSignatureRequestRetained,onDocumentRequestRetained,onSignerRequestRetained, clients, clientsReady, clientsReadable, onClose, onOpenRecord, onOpenClients, onOpenTemplate, signings, onRefresh, activeTenantId, activeUserId, scopeReady, canManage, authorityUnknown, authorizationReady, onDraftAttempted }: SessionProps) {
  const originalFresh = React.useRef(freshlyOpened && agreementId === 'new');
  const [phase, setPhase] = React.useState<Phase>(originalFresh.current&&!templateVersionId ? 'editing' : 'loading');
  const [templateSource,setTemplateSource]=React.useState<AgreementTemplateVersion|null>(null);
  const templateLoaded=React.useRef(false);
  const [title, setTitle] = React.useState('');
  const [clientId, setClientId] = React.useState('');
  const [body, setBody] = React.useState('');
  const [record, setRecord] = React.useState<AgreementPreparation | null>(null);
  const [correction, setCorrection] = React.useState<AgreementCorrectionSession | null>(null);
  const [correctionReceipt, setCorrectionReceipt] = React.useState<{version:number;updatedAt:string} | null>(null);
  const correctionEpoch = React.useRef(0), correctionBusy = React.useRef(false), correctionRead = React.useRef(0);
  const correctionTrigger = React.useRef<HTMLButtonElement>(null), correctionReturnPending = React.useRef(false);
  const [signer, setSigner] = React.useState<AgreementSignerSession | null>(null);
  const [signerReceipt, setSignerReceipt] = React.useState<AgreementSignerReceipt | null>(null);
  const signerEpoch = React.useRef(0), signerBusy = React.useRef(false), signerRecoverySeen = React.useRef<string | null>(null);
  const signerTrigger = React.useRef<HTMLButtonElement>(null), signerReturnPending = React.useRef(false);
  const [documentOpen,setDocumentOpen]=React.useState(false);
  const [documentGuard,setDocumentGuard]=React.useState<DocumentGuard>({draft:[],busy:false,uncertain:false});
  const documentTrigger=React.useRef<HTMLButtonElement>(null),documentReturnPending=React.useRef(false),documentSeen=React.useRef<string|null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const historyTrigger = React.useRef<HTMLButtonElement>(null);
  const historyReturnPending = React.useRef(false);
  const recordEpoch = React.useRef(-1);
  const [clockTick, refreshClock] = React.useReducer((value: number) => value + 1, 0);
  const [message, setMessage] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  const [foundOriginal, setFoundOriginal] = React.useState<string | null>(null);
  const enteredWording = React.useRef(false);
  enteredWording.current = Boolean(title || body || clientId);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const titleField = React.useRef<HTMLInputElement>(null);
  const clientField = React.useRef<HTMLSelectElement>(null);
  const bodyPanel = React.useRef<HTMLDivElement>(null);
  const busy = phase === 'saving' || correction?.state === 'saving' || signer?.state === 'saving' || signer?.state === 'checking'||(documentOpen&&documentGuard.busy);
  const scopeMatches = Boolean(scopeReady && activeUserId && tenantId && activeTenantId === tenantId);
  // A request URL preserves its originating business across reload and business
  // switching. This is an intent fence; canonical native authority still decides.
  const requestScopeMatches = ((agreementId !== 'new' && !signerRequestId&&!documentRequestId&&!signatureReference) || requestTenantId === tenantId)&&!(signerRequestId&&(documentRequestId||signatureReference))
    &&(!signatureReference||/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(signatureReference.operation_id)&&/^[a-f0-9]{64}$/.test(signatureReference.request_sha256));
  const allowed = scopeMatches && requestScopeMatches && authorizationReady && canManage && !authorityUnknown;
  const accessEpoch = React.useRef({ allowed, value: 0 });
  if (accessEpoch.current.allowed !== allowed) accessEpoch.current = { allowed, value: accessEpoch.current.value + 1 };
  const visibleClients = clientsReady && clientsReadable ? clients : [];
  const exit = useSalesDraftExit(documentOpen?{fields:documentGuard.draft,invitations:documentGuard.signatureDraft??null}:signer ? signer.draft : correction ? { title:correction.title, clientId:correction.original.contact_id, body:correction.body } : { title, clientId, body }, busy, onClose, {
    uncertain: (documentOpen&&documentGuard.uncertain)||signer?.state === 'unconfirmed' || correction?.state === 'unconfirmed' || (agreementId === 'new' && !originalFresh.current && !foundOriginal),
    uncertainKind:documentGuard.signatureUncertain?'signature_request':undefined,
    recordedDraftFound: foundOriginal !== null,
  });
  const navigation = React.useRef({ open: onOpenRecord, finish: exit.exitAfterSave });
  const adoptDraftBaseline = exit.adoptBaseline;
  navigation.current = { open: onOpenRecord, finish: exit.exitAfterSave };
  const retainDocumentRequest=(id:string|null)=>{
    const next=onDocumentRequestRetained?.(id);
    // A real navigation checkpoint is required before a native write.
    return Boolean(next&&exit.retainRequestLocation(next.url,next.replace,'document'));
  };
  const retainSignatureRequest=(reference:AgreementSignatureReference)=>{
    const next=onSignatureRequestRetained?.(reference);
    return Boolean(next&&exit.retainRequestLocation(next.url,next.replace,'signature'));
  };
  const returnFromDocument=()=>{
    documentSeen.current=documentRequestId??signatureReference?.operation_id??null;
    if(!documentGuard.uncertain)retainDocumentRequest(null);
    setDocumentOpen(false);setDocumentGuard({draft:[],busy:false,uncertain:false});
    exit.adoptBaseline({title:'',clientId:'',body:''});documentReturnPending.current=true;
    recordEpoch.current=-1;setRecord(null);setPhase('loading');setAttempt(value=>value+1);onRefresh();
  };
  const beginDocument=()=>{
    if(!allowed||!record||recordEpoch.current!==accessEpoch.current.value||signerRequestId)return;
    documentSeen.current=documentRequestId;exit.adoptBaseline({fields:[],invitations:null});setDocumentGuard({draft:[],busy:false,uncertain:Boolean(documentRequestId)});setDocumentOpen(true);
  };

  const retireCorrection = () => {
    correctionEpoch.current++; correctionRead.current++; correctionBusy.current=false;
    setCorrection(null); exit.adoptBaseline({title:'',clientId:'',body:''});
  };
  const correctionRefused = () => {
    retireCorrection(); setCorrectionReceipt(null); recordEpoch.current=-1; setRecord(null); setPhase('error');
    setMessage('Agreement access could not be confirmed. Recheck the original business and record.'); onRefresh();
  };
  const returnFromCorrection = () => {
    retireCorrection(); correctionReturnPending.current=true;
    recordEpoch.current=-1; setRecord(null); setPhase('loading'); setAttempt(value=>value+1);
  };
  const beginCorrection = () => {
    const original=recordEpoch.current===accessEpoch.current.value ? record?.agreement : null;
    if(!allowed || !original?.can_edit || original.status!=='draft' || original.body_markdown===null
      || original.body_source==='tenant_upload' || original.has_source_document || original.content_sha256 || original.sealed_sha256) return;
    correctionEpoch.current++; correctionRead.current++;
    setCorrectionReceipt(null);
    exit.adoptBaseline({title:original.title,clientId:original.contact_id,body:original.body_markdown});
    setCorrection({original:{...original},title:original.title,body:original.body_markdown,state:'editing',command:null,current:null,reading:false,message:''});
  };
  const saveCorrection = async () => {
    if(!allowed || !tenantId || !correction || correctionBusy.current) return;
    if(correction.command && !(correction.state==='unconfirmed' && correction.current?.agreement.can_edit
      && correction.current.agreement.updated_at===correction.command.expectedUpdatedAt)) return;
    const command=correction.command ?? prepareAgreementCorrection(tenantId,correction.original,correction.title,correction.body);
    if(!command) { setCorrection(value=>value && {...value,state:'blocked',message:'This original record is not an editable text draft. Inspect its current state before continuing.'}); return; }
    const openedEpoch=accessEpoch.current.value, session=correctionEpoch.current;
    correctionBusy.current=true;
    setCorrection(value=>value && {...value,state:'saving',command,message:'',current:null});
    try {
      const result=await saveAgreementCorrection(command);
      if(!exit.alive.current || !accessEpoch.current.allowed || accessEpoch.current.value!==openedEpoch || correctionEpoch.current!==session) return;
      if(result.ok === true) { returnFromCorrection(); setCorrectionReceipt({version:result.value.version,updatedAt:result.value.updatedAt}); onRefresh(); }
      else if(result.refusal==='authority') correctionRefused();
      else setCorrection(value=>value && {...value,state:result.reason==='unconfirmed'?'unconfirmed':result.reason==='conflict'?'conflict':'blocked',message:result.reason==='conflict'?'The original record changed. Your proposal has not been applied by this response; inspect current wording before deciding what to do next.':result.reason==='unconfirmed'?'The correction result is unconfirmed. The original request may still complete. Your reviewed proposal is locked while you check the same agreement.':'The correction was refused. Inspect the current agreement; retained or signed documents cannot be edited here.'});
    } finally {
      if(correctionEpoch.current===session && accessEpoch.current.value===openedEpoch) correctionBusy.current=false;
    }
  };
  const readCurrentForCorrection = async () => {
    if(!allowed || !tenantId || !correction || correctionBusy.current) return;
    const session=correctionEpoch.current, openedEpoch=accessEpoch.current.value, request=++correctionRead.current;
    setCorrection(value=>value && {...value,reading:true,message:''});
    const result=await readAgreementPreparation(tenantId,correction.original.id);
    if(!exit.alive.current || !accessEpoch.current.allowed || accessEpoch.current.value!==openedEpoch || correctionEpoch.current!==session || correctionRead.current!==request) return;
    if(result.ok === true) setCorrection(value=>value && {...value,reading:false,current:result.value,message:'Current stored wording is shown separately below. This read does not confirm the original correction request.'});
    else if(result.reason==='refused') correctionRefused();
    else setCorrection(value=>value && {...value,reading:false,current:null,message:'The current agreement could not be verified. Your proposal remains here; retry the read when the connection is available.'});
  };

  const retireSigner = () => {
    signerEpoch.current++; signerBusy.current=false; setSigner(null);
    exit.adoptBaseline({title:'',clientId:'',body:''});
  };
  const retainSignerRequest = (id: string | null) => {
    const next=onSignerRequestRetained?.(id);
    return !next || exit.retainRequestLocation(next.url,next.replace);
  };
  const signerRefused = () => {
    retireSigner(); setSignerReceipt(null); recordEpoch.current=-1; setRecord(null); setPhase('error');
    setMessage('Agreement access could not be confirmed. Recheck the original business and record.'); onRefresh();
  };
  const returnFromSigner = (receipt?: AgreementSignerReceipt) => {
    retireSigner(); signerReturnPending.current=true;
    if(receipt) setSignerReceipt(receipt);
    // Unknown original work keeps its opaque recovery reference on this record.
    // A fresh signer identity is unavailable until the owner resolves/retires it.
    if(receipt || !signer?.requestId || signer.state==='conflict' || signer.state==='blocked') retainSignerRequest(null);
    recordEpoch.current=-1; setRecord(null); setPhase('loading'); setAttempt(value=>value+1);
    if(receipt) onRefresh();
  };
  const beginSigner = () => {
    const current=recordEpoch.current===accessEpoch.current.value ? record : null;
    if(!allowed || !current || !canPrepareAgreementSigners(current.agreement) || signerRequestId) return;
    signerEpoch.current++; signerBusy.current=false; setSignerReceipt(null);
    const draft=emptySignerDraft(); exit.adoptBaseline(draft);
    setSigner({original:current,draft,requestId:null,state:'editing',command:null,message:''});
  };
  const saveSigner = async () => {
    if(!allowed || !tenantId || !signer || signerBusy.current || (signer.state!=='editing' && signer.state!=='unconfirmed')) return;
    const command=signer.command ?? prepareAgreementSignerCommand(tenantId,signer.original.agreement,crypto.randomUUID(),signer.draft);
    if(!command) { setSigner(value=>value && {...value,message:'Review the signer’s name, email and signing position before saving.'}); return; }
    const session=signerEpoch.current, openedEpoch=accessEpoch.current.value;
    signerBusy.current=true; signerRecoverySeen.current=command.signerId;
    setSigner(value=>value && {...value,command,requestId:command.signerId,state:'saving',message:''});
    // Only opaque identities enter navigation. The exact private command stays
    // in RAM; a reloaded page can recover, never recreate, this original act.
    if(!retainSignerRequest(command.signerId)) {
      signerBusy.current=false;
      setSigner(value=>value && {...value,command:null,requestId:null,state:'editing',message:'The recovery reference could not be retained. Return to the current agreement before trying again.'});
      return;
    }
    try {
      const result=await saveAgreementSigner(command);
      if(!exit.alive.current || !accessEpoch.current.allowed || accessEpoch.current.value!==openedEpoch || signerEpoch.current!==session) return;
      if(result.ok === true) returnFromSigner(result.value);
      else if(result.refusal==='authority') signerRefused();
      else setSigner(value=>value && {...value,state:result.reason==='unconfirmed'?'unconfirmed':result.reason==='conflict'?'conflict':'blocked',message:result.reason==='unconfirmed'?'The signer preparation result is unconfirmed. Check the original request, or retry that exact request.':result.reason==='conflict'?'The reviewed agreement or preparation identity changed. Return to the current agreement before preparing corrected details.':'The signer could not be added. Review existing recipients, signing positions and the current document before preparing corrected details.'});
    } finally {
      if(signerEpoch.current===session && accessEpoch.current.value===openedEpoch) signerBusy.current=false;
    }
  };
  const recoverSigner = async (pending=signer) => {
    if(!allowed || !tenantId || !pending?.requestId || signerBusy.current) return;
    const session=signerEpoch.current, openedEpoch=accessEpoch.current.value;
    signerBusy.current=true; setSigner(value=>value && {...value,state:'checking',message:''});
    try {
      const result=await recoverAgreementSigner(tenantId,pending.original.agreement.id,pending.original.agreement.contact_id,pending.requestId);
      if(!exit.alive.current || !accessEpoch.current.allowed || accessEpoch.current.value!==openedEpoch || signerEpoch.current!==session) return;
      if(result.ok === true && result.value.state==='recovered') returnFromSigner(result.value);
      else if(result.ok === false && result.refusal==='authority') signerRefused();
      else setSigner(value=>value && {...value,state:result.ok === false && result.reason!=='unconfirmed'?'blocked':'unconfirmed',message:result.ok === true?'No confirmed receipt was returned yet. This does not establish cancellation; check the same original request again.':result.reason==='unconfirmed'?'The original signer request could not be checked. Try the read again when the connection is available.':'The original request is unavailable in this agreement context. Return to Sales and inspect the original record.'});
    } finally {
      if(signerEpoch.current===session && accessEpoch.current.value===openedEpoch) signerBusy.current=false;
    }
  };

  React.useEffect(() => {
    let current = true;
    if (!allowed || !tenantId) return;
    const expectedTenant = tenantId;
    const readEpoch = accessEpoch.current.value;
    if(originalFresh.current&&templateVersionId&&!templateLoaded.current){
      setPhase('loading');setMessage('');
      void(async()=>{
        const result=await readAgreementTemplate(expectedTenant,templateVersionId);
        if(!current||!accessEpoch.current.allowed||accessEpoch.current.value!==readEpoch)return;
        if(result.ok===false){setPhase('error');setMessage(result.message);return;}
        const source=result.value;
        if(source.preparation_purpose!=='client_engagement'||!source.is_active||source.has_uploaded_source
          ||source.source_mode!=='tenant_fork'||source.body_markdown===null){
          setPhase('error');setMessage('Select an active retained client template with supplied text wording before preparing this agreement.');return;
        }
        templateLoaded.current=true;setTemplateSource(source);setTitle(source.title);setBody(source.body_markdown);
        adoptDraftBaseline({title:source.title,clientId:'',body:source.body_markdown});setPhase('editing');
      })();
      return()=>{current=false;};
    }
    if(originalFresh.current&&templateLoaded.current)return;
    if (originalFresh.current && attempt === 0) return;
    setPhase('loading'); setMessage('');
    void (async () => {
      if (agreementId === 'new') {
        if (!requestId) return;
        const result = await recoverAgreementCreation(expectedTenant, requestId);
        if (!current) return;
        if (result.ok === true && result.value.state === 'recovered') {
          const originalId = result.value.signing_id;
          if (enteredWording.current) {
            setFoundOriginal(originalId); setPhase('uncertain');
            setMessage('A retained draft was found. Review it before leaving or replacing the wording currently in this editor.');
          } else navigation.current.finish(() => navigation.current.open(originalId));
        } else {
          setPhase('uncertain');
          setMessage(result.ok === true ? 'The original save is not confirmed yet. Check again, inspect recent agreements, or continue the same draft.' : result.message);
        }
      } else {
        const result = await readAgreementPreparation(expectedTenant, agreementId);
        if (!current) return;
        if (result.ok === true) { recordEpoch.current = readEpoch; setRecord(result.value); setPhase('record'); }
        else {
          recordEpoch.current = -1; setRecord(null); setPhase('error'); setMessage(result.message);
          if(result.reason==='refused') { correctionEpoch.current++; correctionRead.current++; correctionBusy.current=false; setCorrection(null); setCorrectionReceipt(null); signerEpoch.current++; signerBusy.current=false; setSigner(null); setSignerReceipt(null); adoptDraftBaseline({title:'',clientId:'',body:''}); }
        }
      }
    })();
    return () => { current = false; };
  }, [allowed, tenantId, agreementId, requestId, templateVersionId, attempt, adoptDraftBaseline]);
  React.useEffect(() => {
    // Unknown authority hides retained RAM work. A conclusive revocation retires it.
    if (scopeMatches && authorizationReady && !authorityUnknown && !canManage) {
      setBody(''); setTitle(''); setClientId(''); setRecord(null);
      setTemplateSource(null);templateLoaded.current=false;
      correctionEpoch.current++; correctionRead.current++; correctionBusy.current=false; setCorrection(null);
      setCorrectionReceipt(null);
      signerEpoch.current++; signerBusy.current=false; signerRecoverySeen.current=null; setSigner(null); setSignerReceipt(null);
      setDocumentOpen(false);setDocumentGuard({draft:[],busy:false,uncertain:false});documentSeen.current=null;
      adoptDraftBaseline({title:'',clientId:'',body:''});
    }
  }, [scopeMatches, authorizationReady, authorityUnknown, canManage, adoptDraftBaseline]);
  React.useEffect(() => {
    if (!allowed && phase === 'saving') setPhase('uncertain');
  }, [allowed, phase]);
  React.useEffect(() => {
    if(!allowed) {
      correctionBusy.current=false; correctionRead.current++;
      setCorrection(value=>value ? {...value,reading:false,state:value.state==='saving'?'unconfirmed':value.state} : null);
      signerBusy.current=false;
      setDocumentGuard(value=>({...value,busy:false,uncertain:value.uncertain||value.busy}));
      setSigner(value=>value ? {...value,state:value.state==='saving'||value.state==='checking'?'unconfirmed':value.state} : null);
    }
  }, [allowed]);
  React.useLayoutEffect(() => {
    if (phase === 'error') { historyReturnPending.current = false; correctionReturnPending.current=false; signerReturnPending.current=false; }
    if (phase === 'record' && signerReturnPending.current) {
      (signerTrigger.current ?? heading.current)?.focus(); signerReturnPending.current=false; return;
    }
    if(phase==='record'&&documentReturnPending.current){(documentTrigger.current??heading.current)?.focus();documentReturnPending.current=false;return;}
    if (phase === 'record' && correctionReturnPending.current) {
      (correctionTrigger.current ?? heading.current)?.focus(); correctionReturnPending.current=false; return;
    }
    if (phase === 'record' && historyReturnPending.current && historyTrigger.current) {
      historyTrigger.current.focus(); historyReturnPending.current = false; return;
    }
    if (phase !== 'saving') heading.current?.focus();
  }, [phase, allowed]);

  const openConfirmed = (id: string) => exit.exitAfterSave(() => onOpenRecord(id));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!allowed || !tenantId) return;
    const openedEpoch = accessEpoch.current.value;
    if (!clientId) { setMessage('Choose the client this agreement belongs to.'); clientField.current?.focus(); return; }
    if (!title.trim()) { setMessage('Give the agreement a title.'); titleField.current?.focus(); return; }
    if (!body.trim()) { setMessage('Add the agreement wording before saving.'); bodyPanel.current?.querySelector<HTMLElement>('textarea,[contenteditable="true"]')?.focus(); return; }
    if (!requestId || !clientsReady || !clientsReadable) return;
    if(templateVersionId&&(!templateSource||templateSource.id.toLowerCase()!==templateVersionId.toLowerCase())){setMessage('The original template version must be verified before saving.');return;}
    onDraftAttempted(requestId);
    originalFresh.current = false;
    setPhase('saving'); setMessage('');
    // The SAME native request atomically creates, recovers an identical intent,
    // or refuses a conflict. No read-then-create check or replacement request.
    const result = await createAgreementDraft({ tenantId, requestId, clientId, title, body,
      ...(templateSource?{source:'tenant_template' as const,sourceVersionId:templateSource.id}:{}) });
    if (!exit.alive.current || !accessEpoch.current.allowed || accessEpoch.current.value !== openedEpoch) return;
    if (result.ok === true) openConfirmed(result.value.signing_id);
    else { setPhase(result.reason === 'unconfirmed' || result.reason === 'conflict' ? 'uncertain' : 'editing'); setMessage(result.message); }
  };
  const visibleRecord = recordEpoch.current === accessEpoch.current.value ? record : null;
  const agreement = visibleRecord?.agreement;
  const recoverSignerRef = React.useRef(recoverSigner);
  recoverSignerRef.current = recoverSigner;
  React.useEffect(() => {
    if(!allowed || !tenantId || phase!=='record' || !visibleRecord || !signerRequestId || signer || signerRecoverySeen.current===signerRequestId) return;
    signerRecoverySeen.current=signerRequestId; signerEpoch.current++;
    const pending:AgreementSignerSession={original:visibleRecord,draft:emptySignerDraft(),requestId:signerRequestId,state:'unconfirmed',command:null,message:''};
    setSigner(pending); adoptDraftBaseline(pending.draft);
    // Read-only actor-bound recovery is the only automatic continuation.
    void recoverSignerRef.current(pending);
  },[allowed,tenantId,phase,visibleRecord,signerRequestId,signer,adoptDraftBaseline]);
  React.useEffect(()=>{
    const reference=documentRequestId??signatureReference?.operation_id??null;
    if(!allowed||phase!=='record'||!visibleRecord||!reference||documentOpen||signer||documentSeen.current===reference)return;
    documentSeen.current=reference;adoptDraftBaseline({fields:[],invitations:null});setDocumentGuard({draft:[],busy:false,uncertain:true});setDocumentOpen(true);
  },[allowed,phase,visibleRecord,documentRequestId,signatureReference?.operation_id,documentOpen,signer,adoptDraftBaseline]);
  const currentClient = visibleClients.find(client => client.id === (agreement?.contact_id ?? clientId));
  const savedStatus = agreement ? signingPreparationLabel(agreement.status, agreement.expires_at) : null;
  const reading = phase === 'loading' || (phase === 'record' && !visibleRecord);
  const correctionAcknowledgment = correctionReceipt && <p className="e04-preparation-notice" role="status">Draft correction acknowledged · content version {correctionReceipt.version}.<span> Recorded {historyTime(correctionReceipt.updatedAt)}.</span></p>;
  const signerAcknowledgment = signerReceipt && <p className="e04-preparation-notice" role="status">Signer preparation acknowledged · content version {signerReceipt.source_version}.<span> Creation receipt {signerReceipt.event_id}. Current signing status is shown separately below.</span></p>;
  const statusLabel = agreement ? savedStatus : reading ? 'Checking original record' : phase === 'error' ? 'Record unavailable' : busy ? 'Confirming save' : foundOriginal ? 'Retained draft found' : !originalFresh.current ? 'Save unconfirmed' : 'Draft preparation';
  React.useEffect(() => {
    // Re-render at the recorded instant using the SAME existing display rule.
    // This UI wake-up schedules no business job, follow-up or external action.
    const expires = agreement?.expires_at ? Date.parse(agreement.expires_at) : NaN;
    const remaining = expires - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = setTimeout(refreshClock, Math.min(remaining + 5, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [agreement?.expires_at, clockTick]);

  if (!scopeMatches || !tenantId) return <><WorkspaceMessage title="Checking the agreement workspace" text="The selected business must be confirmed before agreement wording is shown." onClose={exit.close} />{exit.confirmation}</>;
  if (!requestScopeMatches) return <><WorkspaceMessage title="Return to the original agreement business" text="This draft request was opened in a different business. Select that business to check the original request, or return to its agreement register." onClose={exit.close} />{exit.confirmation}</>;
  if (!authorizationReady || authorityUnknown || !canManage) return <><WorkspaceMessage title={!authorizationReady || authorityUnknown ? 'Agreement access is being checked' : 'Agreement author access required'} text="An owner or authorized agreement administrator can prepare this document." onClose={exit.close} onRetry={onRefresh} />{exit.confirmation}</>;
  if (agreementId === 'new' && !requestId) return <><WorkspaceMessage title="Open a new agreement from Sales" text="Return to agreements to start a draft in the selected business." onClose={exit.close} />{exit.confirmation}</>;
  return <article className="e04-preparation" aria-busy={reading || busy}>
    <header className="e04-preparation-top"><div><button className="e04-preparation-back" onClick={exit.close} disabled={busy}><ArrowLeft size={16} />Agreements and terms</button><h2 ref={heading} tabIndex={-1}>{agreement?.title ?? 'Prepare an agreement'}</h2></div><span className="e04-preparation-status">{signer ? signer.state==='saving'?'Confirming signer':signer.state==='checking'?'Checking signer request':signer.state==='editing'?'Signer preparation':'Signer request requires review' : correction ? correction.state==='saving' ? 'Confirming correction' : correction.state==='editing' ? 'Proposed correction' : 'Correction requires review' : statusLabel}</span></header>
    {phase!=='record' && signerAcknowledgment}
    {phase !== 'record' && correctionAcknowledgment}
    {reading && <div className="e04-preparation-message" role="status"><Loader2 className="e04-preparation-spinner" size={24} aria-hidden="true" /><h3>Reading the original record</h3><p>Confirming the agreement in the selected business.</p></div>}
    {phase === 'error' && <div className="e04-preparation-message" role="alert"><h3>The agreement could not be opened</h3><p>{message}</p><button onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} />Try again</button></div>}
    {phase === 'record' && agreement && historyOpen && <AgreementWordingHistory key={agreement.id} tenantId={tenantId} agreementId={agreement.id} currentVersion={agreement.version} currentUpdatedAt={agreement.updated_at} onAccessRefused={() => { setRecord(null); setHistoryOpen(false); setMessage('Agreement access could not be confirmed. Recheck the original business and record.'); setPhase('error'); onRefresh(); }} onClose={() => { historyReturnPending.current = true; setHistoryOpen(false); setPhase('loading'); setAttempt(value => value + 1); }} />}
    {phase === 'uncertain' && <div className="e04-preparation-recovery" role="alert"><h3>Check the original save</h3><p>{message}</p><div>{foundOriginal && <button className="e04-preparation-primary" onClick={() => exit.request(() => onOpenRecord(foundOriginal))}>Open recorded draft<ArrowRight size={16} /></button>}<button className="e04-preparation-primary" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} />Check original save</button><button onClick={() => { setPhase('editing'); setMessage('Continue the original draft. Saving reuses its original request and will not replace an existing document.'); }}>Continue this draft</button></div></div>}
    {phase==='record' && correction && <AgreementDraftCorrection key={correctionEpoch.current} session={correction} tenantId={tenantId} sessionId={correctionEpoch.current} clientName={visibleClients.find(client=>client.id===correction.original.contact_id)?.name ?? 'Client details are not loaded'} onChange={patch=>setCorrection(value=>value?.state==='editing' && !value.command ? {...value,...patch} : value)} onSave={() => { void saveCorrection(); }} onRead={() => { void readCurrentForCorrection(); }} onReturn={()=>exit.request(returnFromCorrection)}/>}
    {phase==='record' && signer && <AgreementSignerPreparation key={signerEpoch.current} session={signer} clientName={visibleClients.find(client=>client.id===signer.original.agreement.contact_id)?.name ?? 'Client details are not loaded'} onChange={patch=>setSigner(value=>value?.state==='editing'&&!value.command?{...value,draft:{...value.draft,...patch}}:value)} onSave={()=>{void saveSigner();}} onRecover={()=>{void recoverSigner();}} onReturn={()=>exit.request(()=>returnFromSigner())}/>}
    {phase==='record'&&agreement&&documentOpen&&activeUserId&&<React.Suspense fallback={<p role="status">Opening document preparation…</p>}><AgreementDocumentPreparation tenantId={tenantId} actorId={activeUserId} agreementId={agreement.id} requestId={documentRequestId}
      authorityKey={`${tenantId}:${activeUserId}:${accessEpoch.current.value}`} isCurrent={()=>allowed&&accessEpoch.current.allowed&&exit.alive.current}
      resume={documentGuard} onGuard={(value,baseline)=>{setDocumentGuard(value);if(baseline)exit.adoptBaseline({fields:baseline,invitations:value.signatureDraft??null});}}
      onRetainRequest={retainDocumentRequest} onRequest={exit.request} onReturn={returnFromDocument} signatureReference={signatureReference} onRetainSignatureRequest={retainSignatureRequest}
      onAddSigners={()=>{if(documentGuard.uncertain||!retainDocumentRequest(null))return;setDocumentOpen(false);setDocumentGuard({draft:[],busy:false,uncertain:false});beginSigner();}}
      onAccessRefused={()=>{documentSeen.current=documentRequestId;setDocumentOpen(false);setDocumentGuard({draft:[],busy:false,uncertain:false});exit.adoptBaseline({title:'',clientId:'',body:''});recordEpoch.current=-1;setRecord(null);setPhase('error');setMessage('Agreement access could not be confirmed. Recheck the original business and record.');onRefresh();}}
      /></React.Suspense>}
    {(phase === 'editing' || phase === 'saving') && <form onSubmit={save} className="e04-preparation-layout">
      <div className="e04-preparation-document"><div className="e04-preparation-form-row"><label>Agreement title<input ref={titleField} value={title} onChange={event => setTitle(event.target.value)} disabled={busy} placeholder="Client services agreement" /></label><label>Client<select ref={clientField} value={clientId} onChange={event => setClientId(event.target.value)} disabled={busy || !clientsReady || !clientsReadable}><option value="">Select a client</option>{visibleClients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label></div><div ref={bodyPanel}><AgreementBodyEditor scopeKey={`${tenantId}:${requestId}`} value={body} onChange={setBody} readOnly={busy} /></div></div>
      <aside className="e04-preparation-context"><div className="e04-preparation-context-card"><FileText size={22} aria-hidden="true" /><h3>A draft for review</h3><p>Saving retains the agreement wording and client relationship. It does not request a signature or payment.</p><ul><li><Check size={16} aria-hidden="true" />Review the services and responsibilities.</li><li><Check size={16} aria-hidden="true" />Specify the intended fees and payment dates.</li><li><Check size={16} aria-hidden="true" />Use reviewed terms appropriate to the engagement.</li></ul></div>
        {templateSource&&<section className="e04-preparation-context-card" aria-label="Original template source"><h3>{templateSource.title}</h3><p>Retained template version {templateSource.version}</p><dl><dt>Jurisdiction</dt><dd>{templateSource.preparation_options?.jurisdiction||'Not specified'}</dd><dt>Requested wording review</dt><dd>{templateSource.preparation_options?.review_route==='qualified_legal'?'Qualified legal review':templateSource.preparation_options?.review_route==='business'?'Business review':'Not specified'}</dd>{templateSource.preparation_options?.reviewer&&<><dt>Reviewer</dt><dd>{templateSource.preparation_options.reviewer}</dd></>}</dl><p>Source-template options do not record completed review. Review this agreement’s actual wording before signing.</p>{onOpenTemplate&&<button type="button" onClick={()=>exit.request(()=>onOpenTemplate(templateSource.id))}>Inspect source template</button>}</section>}
        {(!clientsReady || !clientsReadable || visibleClients.length === 0) && <div className="e04-preparation-context-card"><h3>{!clientsReady ? 'Client records are not ready' : !clientsReadable ? 'Client records could not be read' : 'Add the client first'}</h3><p>Select an actual client before retaining an agreement.</p>{clientsReady && clientsReadable && onOpenClients ? <button type="button" onClick={() => exit.request(onOpenClients)}>Open Clients<ArrowRight size={16} /></button> : <button type="button" onClick={onRefresh}>Check client records</button>}</div>}
        {message && <p className="e04-preparation-notice" role="alert">{message}</p>}
        <button className="e04-preparation-primary" type="submit" disabled={busy || !clientsReady || !clientsReadable}>{busy ? <><Loader2 size={16} aria-hidden="true" />Confirming draft…</> : <>Save agreement draft<ArrowRight size={16} /></>}</button>
      </aside>
    </form>}
    {phase === 'record' && visibleRecord && agreement && !historyOpen && !correction && !signer && !documentOpen && <div className="e04-preparation-layout"><section className="e04-preparation-document"><div className="e04-preparation-document-heading"><FileText size={17} aria-hidden="true" /><span>Recorded wording · content version {agreement.version}</span></div>{agreement.body_markdown !== null ? <div className="e04-preparation-paper"><ReactMarkdown components={{ img: ({ alt }) => <span>[Embedded image: {alt || 'document image'}]</span> }}>{agreement.body_markdown}</ReactMarkdown></div> : <div className="e04-preparation-message"><FileText size={28} aria-hidden="true" /><h3>Original PDF document</h3><p>Use signature history and files to inspect the retained documents available for this agreement.</p></div>}</section><aside className="e04-preparation-context"><div className="e04-preparation-context-card"><h3>Agreement details</h3><dl><dt>Client</dt><dd>{currentClient?.name ?? 'Client details are not loaded'}</dd><dt>Document source</dt><dd>{agreement.body_source === 'tenant_template' ? 'Business template version' : agreement.body_source === 'tenant_upload' ? 'Uploaded document' : 'Authored agreement'}</dd>{agreement.source_version_id&&onOpenTemplate&&<><dt>Source record</dt><dd><button onClick={()=>exit.request(()=>onOpenTemplate(agreement.source_version_id!))}>Inspect source template</button></dd></>}{agreement.expires_at && <><dt>Signing link deadline</dt><dd>{historyTime(agreement.expires_at)}</dd></>}<dt>Last recorded</dt><dd>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(agreement.updated_at))}</dd></dl></div><div className="e04-preparation-context-card"><Users size={22} aria-hidden="true" /><h3>Signing progress</h3>{signerAcknowledgment}{canPrepareAgreementSigners(agreement) && <button ref={signerTrigger} onClick={beginSigner} disabled={Boolean(signerRequestId)}>Add signer</button>}{signerRequestId && <button onClick={()=>{signerRecoverySeen.current=null;setAttempt(value=>value+1);}}>Check retained signer request</button>}{visibleRecord.signers.length ? <ol className="e04-preparation-signers">{visibleRecord.signers.map(signer => <li key={signer.id}><strong>{signer.full_name}</strong><span>{signer.email}</span><small>{signer.signer_role === 'counterparty' ? 'Client signer' : signer.signer_role === 'tenant_signatory' ? 'Business signer' : 'Witness'} · Order {signer.signing_order} · {SIGNER_STATE[signer.status] ?? 'Status unavailable'}</small></li>)}</ol> : <p>No signer is recorded. A signer is required before signatures can be requested.</p>}</div><div className="e04-preparation-context-card"><h3>Document preparation</h3><p>Review the exact PDF, place signer fields and inspect saved preparation versions.</p><button ref={documentTrigger} onClick={beginDocument} disabled={Boolean(signerRequestId)}>Prepare document and fields</button></div><div className="e04-preparation-context-card"><h3>Document changes</h3>{correctionAcknowledgment}<p>Inspect wording retained under this agreement. Earlier saved versions may not be available.</p>{agreement.can_edit && agreement.status==='draft' && agreement.body_markdown!==null && agreement.body_source!=='tenant_upload' && !agreement.has_source_document && !agreement.content_sha256 && !agreement.sealed_sha256 && <button ref={correctionTrigger} onClick={beginCorrection}>Correct draft wording</button>}<button ref={historyTrigger} onClick={() => setHistoryOpen(true)}>Inspect wording history</button></div><AgreementRecordHistory key={agreement.id} id={agreement.id} tenantId={tenantId} completed={agreement.status === 'completed'} signings={signings} /><p className="e04-preparation-note">A signing status does not establish payment or completion of the agreed services.</p></aside></div>}
    {exit.confirmation}
  </article>;
}

const eventLabels: Record<string, string> = {
  created: 'Draft recorded', edited: 'Draft revised', sent: 'Signature request issued',
  viewed: 'Signing page opened', signed: 'Signature recorded', completed: 'Signing completed',
  declined: 'Signing declined', voided: 'Agreement stopped', expired: 'Signing request expired',
  signer_added: 'Signer added', signer_removed: 'Signer removed',
};
function historyTime(value: string | null) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(time) : 'Time unavailable';
}
function AgreementRecordHistory({ id, tenantId, completed, signings }: { id: string; tenantId: string; completed: boolean; signings: Props['signings'] }) {
  const [trail, setTrail] = React.useState<SigningEventsResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [copyBusy, setCopyBusy] = React.useState(false);
  const [copyMessage, setCopyMessage] = React.useState('');
  const [copyUrl, setCopyUrl] = React.useState<string | null>(null);
  const live = React.useRef(true), historyRequest = React.useRef(0), copyRequest = React.useRef(0), retainedUrl = React.useRef<string | null>(null);
  React.useEffect(() => { live.current = true; return () => { live.current = false; if (retainedUrl.current) URL.revokeObjectURL(retainedUrl.current); }; }, []);
  const load = async () => {
    const turn = ++historyRequest.current; setLoading(true);
    let result: SigningEventsResult;
    try { result = await signings.signingEvents(id, tenantId); }
    catch { result = { ok: false, message: 'Agreement history could not be read. Try the original record again.' }; }
    if (!live.current || turn !== historyRequest.current) return;
    setTrail(result); setLoading(false);
  };
  const copy = async () => {
    const turn = ++copyRequest.current; setCopyBusy(true); setCopyMessage('');
    let result: Awaited<ReturnType<Props['signings']['signedCopyUrl']>>;
    try { result = await signings.signedCopyUrl(id, tenantId); }
    catch { result = { ok: false, message: 'The retained document could not be read. Try again from the original agreement.' }; }
    if (!live.current || turn !== copyRequest.current) { if (result.ok === true && result.url.startsWith('blob:')) URL.revokeObjectURL(result.url); return; }
    setCopyBusy(false);
    if (result.ok === false) { setCopyMessage(result.message); return; }
    if (!result.url.startsWith('blob:')) { setCopyMessage('The retained copy could not be verified for this view. Try again from the original agreement.'); return; }
    if (retainedUrl.current) URL.revokeObjectURL(retainedUrl.current);
    retainedUrl.current = result.url; setCopyUrl(result.url);
  };
  return <section className="e04-preparation-context-card" aria-label="Agreement history and files"><h3>History and files</h3>
    {loading ? <><p role="status">Reading recorded agreement activity…</p><button onClick={() => { historyRequest.current++; setLoading(false); }}>Stop waiting</button></> : <button onClick={() => { void load(); }}><RefreshCw size={16} />{trail ? 'Refresh history' : 'View signing history'}</button>}
    {trail && (trail.ok === true ? <>{trail.events.length ? <ol className="e04-agreement-history">{trail.events.map(event => <li key={event.id}><strong>{eventLabels[event.type] ?? 'Agreement activity recorded'}</strong><span>{historyTime(event.at)}</span><small>{event.actorKind === 'system' ? 'System record' : event.actorKind === 'signer' ? 'Signer record' : 'Authorized account record'}{event.actorEmail ? ` · ${event.actorEmail}` : ''}</small></li>)}</ol> : <p>No agreement activity was returned.</p>}{trail.truncated && <p>Older activity is outside this view. The latest {trail.events.length} recorded events are shown.</p>}</> : <p role="alert">{trail.message}</p>)}
    {completed && <>{copyBusy ? <><p role="status">Reading the retained document…</p><button onClick={() => { copyRequest.current++; setCopyBusy(false); }}>Stop waiting</button></> : <button onClick={() => { void copy(); }}><FileText size={16} />Prepare retained document</button>}{copyUrl && <a className="e04-agreement-file" href={copyUrl} download="completed-agreement.pdf" target="_blank" rel="noopener noreferrer">Download retained document<ArrowRight size={16} /></a>}{copyMessage && <p role="alert">{copyMessage}</p>}</>}
  </section>;
}
