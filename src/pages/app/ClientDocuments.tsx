import {useEffect, useRef, useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription} from "@/components/ui/dialog";
import {FileText, Upload, Download, Loader2, ExternalLink} from "lucide-react";
import {useClientDocuments, type DocumentLinks} from "@/hooks/useClientDocuments";
import {useClientPortalBrand} from "@/hooks/useClientPortalBrand";
import {useBeforeUnloadGuard} from "@/hooks/useBeforeUnloadGuard";
import {useClientAccountExit} from "@/components/client/useClientAccountExit";
import {CLIENT_DOCUMENT_ACCEPT, clientDocumentMime, type PortalDocument} from "@/lib/client-portal-documents";
import {readableTextOn} from "@/lib/brand/contrast";
import {ClientReleasedWork} from "@/components/client/ClientReleasedWork";

type Preview = {epoch: number; file: PortalDocument; links: DocumentLinks | null; error: string | null; expired: boolean};
/** Only these render inline as a picture; every other type is opened or downloaded, never embedded. */
const PREVIEW_IMAGES = ["image/jpeg", "image/png"];
const size = (bytes: number | null) => bytes === null ? "File" : bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export default function ClientDocuments() {
  const docs = useClientDocuments(), brand = useClientPortalBrand();
  const [selection, setSelection] = useState<{epoch: number; file: File | null}>({epoch: docs.epoch, file: null});
  const [selectionError, setSelectionError] = useState<{epoch: number; text: string}>({epoch: docs.epoch, text: ""});
  const file = selection.epoch === docs.epoch ? selection.file : null;
  const error = selectionError.epoch === docs.epoch ? selectionError.text : "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [downloadStarted, setDownloadStarted] = useState(false);
  const input = useRef<HTMLInputElement>(null), opener = useRef<HTMLButtonElement | null>(null);
  const stopButton = useRef<HTMLButtonElement>(null), checkButton = useRef<HTMLButtonElement>(null);
  const openSequence = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  const shownPreview = preview?.epoch === docs.epoch ? preview : null;
  const working = docs.upload.kind === "working";
  const unresolved = !!docs.upload.id && !["idle", "saved"].includes(docs.upload.kind);
  const accent = brand?.tenant_id === docs.scope?.tenant ? brand?.primary_color : null;
  const accentStyle = accent ? {backgroundColor: accent, color: readableTextOn(accent)} : undefined;
  const business = (brand?.tenant_id === docs.scope?.tenant ? brand?.tenant_name?.trim() : "") || "your business";
  useBeforeUnloadGuard(!!file || working || unresolved);
  useClientAccountExit(!!file || working || unresolved, working);
  useEffect(() => {
    ++openSequence.current; setPreview(null); setDownloadStarted(false);
    setSelection({epoch: docs.epoch, file: null}); setSelectionError({epoch: docs.epoch, text: ""});
    if (input.current) input.current.value = "";
  }, [docs.epoch]);
  useEffect(() => () => {++openSequence.current;}, []);
  // A signed link is short-lived. When it lapses the preview says so and offers a fresh one, rather
  // than leaving a link on screen that now fails.
  const expiresAt = preview?.links?.expiresAt ?? null;
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = window.setTimeout(() => setPreview(current => current?.links?.expiresAt === expiresAt ? {...current, expired: true} : current),
      Math.max(0, expiresAt - Date.now() - 5_000));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  useEffect(() => {
    if (docs.upload.kind === "working") stopButton.current?.focus();
    else if (docs.upload.kind === "uncertain") checkButton.current?.focus();
  }, [docs.upload.kind]);
  useEffect(() => {
    if (docs.upload.kind !== "saved") return;
    setSelection({epoch: docs.epoch, file: null});
    if (input.current) input.current.value = "";
    heading.current?.focus();
  }, [docs.upload.kind, docs.upload.id, docs.epoch]);
  const closePreview = () => {++openSequence.current; setPreview(null); setDownloadStarted(false);};
  const open = async (row: PortalDocument, button: HTMLButtonElement) => {
    const generation = docs.epoch, request = ++openSequence.current;
    opener.current = button; setDownloadStarted(false);
    setPreview({epoch: generation, file: row, links: null, error: null, expired: false});
    try {
      const links = await docs.retrieve(row);
      if (request !== openSequence.current || !docs.isCurrent(generation)) return;
      if (!links) {setPreview({epoch: generation, file: row, links: null, error: "This document is no longer available. Refresh your documents.", expired: false}); return;}
      setPreview({epoch: generation, file: row, links, error: null, expired: false});
    } catch (issue) {
      if (request === openSequence.current && docs.isCurrent(generation)) setPreview({epoch: generation, file: row, links: null, expired: false,
        error: issue instanceof Error ? issue.message : "This document could not be opened. Try again."});
    }
  };
  const label = (row: PortalDocument) => row.state === "pending" ? "Upload incomplete" : row.source === "business" ? `Shared by ${business}` : "Your upload";
  return <section aria-labelledby="client-documents-title" aria-busy={docs.reading} className="mx-auto w-full max-w-4xl space-y-7 [&_button]:min-h-[44px] [&_input]:min-h-[44px] [&_input]:text-[16px]">
    <header><h1 ref={heading} tabIndex={-1} id="client-documents-title" className="text-2xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">Documents</h1>
      <p className="mt-2 text-sm text-muted-foreground">Files {business} shares with you, the documents you send them, and work waiting for your review.</p></header>
    {docs.phase !== "ready" ? docs.phase === "loading" ? <p role="status" className="flex items-center gap-2 py-8 text-sm"><Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none"/>Loading your documents…</p>
      : <div className="space-y-4"><p role="alert" className="max-w-prose text-sm">{docs.notice}</p>
        {docs.phase !== "signed_out" && <Button variant="outline" onClick={() => void docs.refresh()}>Try again</Button>}</div>
    : <>
      <form aria-busy={working || docs.reading} className="space-y-3 rounded-lg border border-border p-4 sm:p-5" onSubmit={event => {event.preventDefault(); if (!unresolved && !docs.reading) void docs.transfer(file ?? undefined);}}>
        <Label htmlFor="client-document-upload">Upload a document</Label>
        <Input ref={input} id="client-document-upload" type="file" accept={CLIENT_DOCUMENT_ACCEPT} disabled={working}
          aria-describedby="client-document-upload-help client-document-selection-error"
          onChange={event => {
            const chosen = event.target.files?.[0] ?? null;
            setSelectionError({epoch: docs.epoch, text: ""});
            try {if (chosen) clientDocumentMime(chosen); setSelection({epoch: docs.epoch, file: chosen});}
            catch (issue) {event.target.value = ""; setSelection({epoch: docs.epoch, file: null});
              setSelectionError({epoch: docs.epoch, text: issue instanceof Error ? issue.message : "Choose a permitted file."});}
          }}/>
        <p id="client-document-upload-help" className="text-sm text-muted-foreground">PDF, JPG, PNG or DOCX · Up to 20 MB. Uploaded files are shared with this business.</p>
        <p id="client-document-selection-error" role={error ? "alert" : undefined} className="text-sm">{error}</p>
        {file && <p className="break-words text-sm">{file.name} · {size(file.size)}</p>}
        <Button type="submit" disabled={!file || working || unresolved || docs.reading} style={accentStyle}><Upload aria-hidden className="mr-2 h-4 w-4"/>Upload document</Button>
        {docs.upload.notice && <div role={docs.upload.kind === "error" ? "alert" : "status"} className="space-y-3 text-sm">
          <p>{docs.upload.notice}</p>
          <div className="flex flex-wrap gap-2">
            {working && <Button ref={stopButton} type="button" variant="outline" onClick={docs.stopWaiting}>Stop waiting</Button>}
            {["uncertain", "error"].includes(docs.upload.kind) && docs.upload.id && <Button ref={checkButton} type="button" variant="outline" onClick={() => void docs.checkUpload()}>Check saved upload</Button>}
            {["finish", "retry"].includes(docs.upload.kind) && <Button type="button" onClick={() => void docs.transfer(file ?? undefined)} style={accentStyle}>
              {docs.upload.kind === "finish" ? "Finish saved upload" : "Continue upload"}</Button>}
          </div>
        </div>}
      </form>
      <ClientReleasedWork businessName={business} accentStyle={accentStyle}/>
      <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Your library</h2>
        <Button variant="ghost" disabled={docs.reading || working} onClick={() => void docs.refresh()}>Refresh documents</Button></div>
        {docs.files.length === 0 ? <p className="py-8 text-sm text-muted-foreground">Nothing here yet. Files {business} shares with you appear here, and so does anything you upload above.</p>
          : <ul className="divide-y divide-border border-y border-border">{docs.files.map(row => <li key={row.id} className="flex flex-wrap items-center gap-4 py-4">
            <FileText aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground"/>
            <div className="min-w-0 flex-1 basis-40"><h3 className="line-clamp-2 break-words text-sm font-medium" title={row.filename}>{row.filename}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{size(row.size_bytes)} · {label(row)}</p></div>
            {row.state === "ready" ? <Button variant="outline" onClick={event => void open(row, event.currentTarget)} aria-label={`Open ${row.filename}`}>Open</Button>
              : row.source === "you" ? <Button variant="outline" disabled={working} onClick={() => void docs.checkUpload(row)} aria-label={`Check upload ${row.filename}`}>Check upload</Button>
              : <span className="text-sm text-muted-foreground">Contact your team for help</span>}
          </li>)}</ul>}
        {docs.more && <Button variant="outline" disabled={docs.reading || working} onClick={() => void docs.refresh(true)}>{docs.reading ? "Loading…" : "Load more documents"}</Button>}
      </div>
    </>}
    <Dialog open={!!shownPreview} onOpenChange={value => {if (!value) closePreview();}}>
      <DialogContent overlayClassName="motion-reduce:!animate-none" className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl motion-reduce:!animate-none [&_button]:min-h-[44px] [&>button]:min-w-[44px]" onCloseAutoFocus={event => {event.preventDefault(); if (opener.current?.isConnected) opener.current.focus();}}>
        <DialogHeader className="pr-12"><DialogTitle className="break-words">{shownPreview?.file.filename ?? "Document"}</DialogTitle>
          <DialogDescription>{shownPreview ? `${size(shownPreview.file.size_bytes)} · ${label(shownPreview.file)}` : ""}</DialogDescription></DialogHeader>
        {shownPreview?.error ? <div className="space-y-4"><p role="alert" className="text-sm">{shownPreview.error}</p><Button variant="outline" onClick={() => {if (opener.current && shownPreview) void open(shownPreview.file, opener.current);}}>Try again</Button></div>
          : !shownPreview?.links ? <p role="status" className="text-sm">Opening your document…</p>
          : shownPreview.expired ? <div className="space-y-4"><p role="status" className="text-sm">For your privacy, this link only works for a minute. Get a fresh one to open or download the file.</p>
            <Button variant="outline" onClick={() => {if (opener.current) void open(shownPreview.file, opener.current);}}>Get a fresh link</Button></div>
          : <div className="space-y-5">
            {PREVIEW_IMAGES.includes(shownPreview.file.mime_type ?? "") && <img src={shownPreview.links.view} alt={shownPreview.file.filename} className="max-h-[50dvh] w-full rounded-md object-contain"/>}
            <div className="flex flex-wrap gap-3">
              <Button asChild style={accentStyle}><a href={shownPreview.links.download} onClick={() => setDownloadStarted(true)} className="min-h-[44px]"><Download aria-hidden className="mr-2 h-4 w-4"/>Download</a></Button>
              <Button asChild variant="outline"><a href={shownPreview.links.view} target="_blank" rel="noopener noreferrer" className="min-h-[44px]"><ExternalLink aria-hidden className="mr-2 h-4 w-4"/>Open file</a></Button>
            </div>
            <p role="status" className="text-sm text-muted-foreground">{downloadStarted ? "Download started." : "The file is ready to open or download. This link works for one minute."}</p>
          </div>}
      </DialogContent>
    </Dialog>
  </section>;
}
