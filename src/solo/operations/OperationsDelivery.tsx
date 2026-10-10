import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, FileCheck2, FileText, RefreshCw } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useSoloCommercialTerms, type ClientAgreement } from "@/solo/useSoloCommercialTerms";
import { useSoloAgreementSignings, type AgreementSigning } from "@/solo/useSoloAgreementSignings";
import { money } from "@/solo/catalog-offers";
import "./operations-delivery.css";

function date(value: string | null) {
  if (!value) return "Not recorded";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? "Date unavailable" : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function label(value: string | null) { return value ? value.replace(/_/g, " ") : "Not recorded"; }
function amount(row: ClientAgreement) {
  if (row.agreedAmountMinor === null || !row.agreedCurrency) return "Price not recorded";
  try { return money(row.agreedAmountMinor, row.agreedCurrency) ?? "Price unavailable"; }
  catch { return "Currency unavailable"; }
}

/** Read-only Sales evidence. Signature completion never implies fulfillment or client acceptance. */
export default function OperationsDelivery({ openPaige }: { openPaige?: () => void }) {
  const terms = useSoloCommercialTerms();
  const signing = useSoloAgreementSignings();
  const { activeTenantId, accountContextLoading } = useTenantContext();
  const epoch = useRef({ tenant: activeTenantId, loading: accountContextLoading });
  if (epoch.current.tenant !== activeTenantId || epoch.current.loading !== accountContextLoading) epoch.current = { tenant: activeTenantId, loading: accountContextLoading };
  const [selection, setSelection] = useState<{ id: string; epoch: typeof epoch.current } | null>(null);
  const [inspectedEpoch, setInspectedEpoch] = useState<typeof epoch.current | null>(null);
  const [copy, setCopy] = useState<{ url?: string; message?: string; busy?: boolean; epoch: typeof epoch.current } | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const portalTheme = contentRef.current?.closest<HTMLElement>("[data-pg]")?.getAttribute("data-pg") ?? "dark";
  const inspectionInvoker = useRef<HTMLButtonElement | null>(null);
  const mounted = useRef(true);
  const copyRequest = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { if (copy?.url) URL.revokeObjectURL(copy.url); }, [copy]);
  const scoped = !accountContextLoading && terms.tenantId === activeTenantId;
  const rows = scoped ? terms.agreements : [];
  const chosen = selection?.epoch === epoch.current ? rows.find(row => row.id === selection.id) : undefined;
  const engagement = chosen ?? rows[0];
  const clientsKnown = scoped && terms.clientsReadable;
  const clientName = (row: ClientAgreement) => clientsKnown ? terms.clients.find(client => client.id === row.contactId)?.name ?? "Client identity unavailable" : "Client identity unavailable";
  const signaturesKnown = !accountContextLoading && signing.tenantId === activeTenantId && signing.phase === "ready" && signing.readable && !signing.authorityUnknown;
  const documents = engagement && signaturesKnown ? signing.signings.filter(document => document.agreementId === engagement.id && document.contactId === engagement.contactId) : [];
  const sealed = documents.find(document => document.signatureState === "completed" && document.hasSealedCopy);
  const retry = () => { terms.retry(); signing.retry(); };
  async function prepareCopy(document: AgreementSigning) {
    const opened = epoch.current;
    const request = ++copyRequest.current;
    setCopy({ busy: true, epoch: opened });
    try {
      const result = await signing.signedCopyUrl(document.id, signing.tenantId);
      if (!mounted.current || epoch.current !== opened || request !== copyRequest.current) { if (result.ok) URL.revokeObjectURL(result.url); return; }
      setCopy(result.ok === true ? { url: result.url, epoch: opened } : { message: "message" in result ? result.message : "The signed copy could not be prepared. Try again in a moment.", epoch: opened });
    } catch {
      if (mounted.current && epoch.current === opened && request === copyRequest.current) setCopy({ message: "The signed copy could not be prepared. Try again in a moment.", epoch: opened });
    }
  }
  const visibleCopy = copy?.epoch === epoch.current ? copy : null;
  const ready = scoped && terms.phase === "ready";
  return <section ref={contentRef} className="op-delivery" aria-label="Client commitments">
    <header className="op-delivery-heading"><div><h1>Keep the promise.</h1><p>See the agreement behind the work—and the evidence still needed to close it.</p></div><button onClick={retry}><RefreshCw size={16} /> Refresh</button></header>
    {!ready ? <div className="op-delivery-state" role="status"><FileText size={32} /><h2>{terms.phase === "error" ? "Commitments could not be loaded" : terms.phase === "unavailable" ? "Choose a workspace to see its commitments" : "Loading client commitments…"}</h2>{terms.phase === "error" && <p>Refresh to read the current Sales records again.</p>}</div>
      : terms.authorityUnknown || !terms.agreementsReadable ? <div className="op-delivery-state"><FileText size={32} /><h2>{terms.authorityUnknown ? "Your access could not be confirmed" : "Commercial agreements are outside your current access"}</h2><p>{terms.authorityUnknown ? "Refresh before viewing client commitments." : "Ask your workspace owner for the appropriate Sales access."}</p></div>
      : !engagement ? <div className="op-delivery-state"><FileText size={32} /><h2>Your next client promise starts in Sales</h2><p>Record an engagement in Sales. Its terms and signing evidence will appear here for review.</p></div>
      : <>
        <div className="op-delivery-register" aria-label="Choose an engagement">{rows.map(row => <button key={row.id} aria-pressed={engagement.id === row.id} onClick={() => { copyRequest.current += 1; setSelection({ id: row.id, epoch: epoch.current }); setCopy(null); }}><span>{clientName(row)}</span><strong>{row.title || "Untitled engagement"}</strong><small>{label(row.status)}</small></button>)}</div>
        <div className="op-delivery-spread">
          <section className="op-delivery-promise"><div className="op-delivery-client"><span>{clientName(engagement)}</span><span className="op-delivery-status">Engagement · {label(engagement.status)}</span></div><h2>{engagement.title || "Untitled engagement"}</h2><p className="op-delivery-description">{engagement.notes || "No engagement description has been recorded in Sales."}</p><dl className="op-delivery-dates"><div><dt>Starts</dt><dd>{date(engagement.startsOn)}</dd></div><div><dt>Ends</dt><dd>{date(engagement.endsOn)}</dd></div><div><dt>Renewal</dt><dd>{date(engagement.renewsOn)}</dd></div></dl><button onClick={(event) => { inspectionInvoker.current = event.currentTarget; setInspectedEpoch(epoch.current); }}>Inspect agreement <ArrowRight size={16} /></button></section>
          <section className="op-delivery-document" aria-label="Agreement evidence"><FileCheck2 size={30} /><h2>{sealed ? "The signed promise." : "The promise, on record."}</h2><p>{sealed ? sealed.documentTitle : "Review the commercial terms and the linked signing documents."}</p><dl><div><dt>Agreed price</dt><dd>{amount(engagement)}</dd></div><div><dt>Payment arrangement</dt><dd>{label(engagement.termKind)}</dd></div><div><dt>Signature evidence</dt><dd>{!signaturesKnown ? "Cannot be confirmed" : sealed ? `Sealed copy · ${date(sealed.completedAt)}` : documents.length ? "Signing incomplete or sealed copy unavailable" : "No linked signing recorded"}</dd></div></dl>{sealed && <button disabled={visibleCopy?.busy} onClick={() => void prepareCopy(sealed)}>{visibleCopy?.busy ? "Preparing signed copy…" : "Prepare signed copy"}</button>}{visibleCopy?.url && <a href={visibleCopy.url} target="_blank" rel="noopener noreferrer">Open signed copy <ArrowRight size={14} /></a>}{visibleCopy?.message && <p role="alert">{visibleCopy.message}</p>}</section>
        </div>
        <ol className="op-delivery-path" aria-label="Promise to outcome"><li data-observed="true"><Check size={18} /><strong>Commercial terms</strong><span>{label(engagement.status)} engagement</span></li><li data-observed={Boolean(sealed)}><FileCheck2 size={18} /><strong>Signature</strong><span>{sealed ? "Sealed copy recorded" : signaturesKnown ? "Completion not evidenced" : "Evidence unavailable"}</span></li><li><ArrowRight size={18} /><strong>Delivery project</strong><span>Linked handoff unavailable</span></li><li><Check size={18} /><strong>Client outcome</strong><span>Acceptance unavailable</span></li></ol>
        <div className="op-delivery-next"><div><h2>The next link in the promise</h2><p>This engagement has no readable Operations handoff or client acceptance record yet. Its commercial status and signature do not confirm delivery.</p></div>{openPaige && <button onClick={openPaige}>Discuss with PAIGE <ArrowRight size={16} /></button>}</div>
      </>}
    <Sheet open={inspectedEpoch === epoch.current && Boolean(engagement) && ready && terms.agreementsReadable && !terms.authorityUnknown} onOpenChange={open => { if (!open) setInspectedEpoch(null); }}><SheetContent className="op-delivery-drawer paige-solo" data-pg={portalTheme} data-theme={portalTheme} onCloseAutoFocus={(event) => { if (inspectionInvoker.current?.isConnected) { event.preventDefault(); inspectionInvoker.current.focus(); } }}><SheetHeader><SheetTitle>{engagement?.title || "Engagement details"}</SheetTitle><SheetDescription>{engagement ? clientName(engagement) : ""} · Sales agreement</SheetDescription></SheetHeader>{engagement && <><dl className="op-delivery-detail"><div><dt>Engagement status</dt><dd>{label(engagement.status)}</dd></div><div><dt>Agreed price</dt><dd>{amount(engagement)}</dd></div><div><dt>Price basis</dt><dd>{label(engagement.priceBasis)}</dd></div><div><dt>Payment timing</dt><dd>{label(engagement.paymentSchedule)}</dd></div><div><dt>Billing interval</dt><dd>{label(engagement.billingInterval)}</dd></div><div><dt>Last updated</dt><dd>{date(engagement.updatedAt)}</dd></div></dl><h3>Linked signing documents</h3>{!signaturesKnown ? <p>Signing evidence cannot be confirmed. Refresh or ask your owner to check your access.</p> : documents.length === 0 ? <p>No signing document is linked to this engagement.</p> : documents.map(document => <article key={document.id} className="op-delivery-signing"><strong>{document.documentTitle}</strong><span>{label(document.displayState)}</span><p>{document.signerName ? `First signer: ${document.signerName}` : "Signer name unavailable"}</p><p>Completed: {date(document.completedAt)}</p><p>{document.hasSealedCopy ? "Sealed copy recorded" : "No sealed copy recorded"}</p></article>)}</>}</SheetContent></Sheet>
  </section>;
}
