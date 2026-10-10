// Marketing › Content (INT-342 S1e, owner ask 2026-10-10: "before Campaigns we need to reimagine Content").
//
// The saved library as a gallery of the work itself, leading the page. Each piece shows what it really is
// (model: marketing-content-model.ts) and opens in a preview: an image full size and a video playing, each
// with Download; a document drawn by the Studio's own renderer (DocumentPreview) with Print / Save as PDF;
// ad copy laid out as an ad; other copy as its words with Copy text. Revising is draft-first through PAIGE;
// nothing here posts, sends or publishes.
// Reads (tenant-scoped, read-only, nothing new on the server):
//   marketing_content  not archived, newest first. RLS: admins of the business or the platform owner, the
//                      same test the briefs read reports as can_manage, so a member is told the library is
//                      for owners and admins rather than shown an empty one. `published` on a piece means it
//                      is in the Catalog (Vibe Studio's publish lifecycle), so it is labelled that way.
//   published work     pages, funnels and forms from Vibe Studio (useSoloCampaigns, via growth2).
// `?kind=` keeps the filter in the address and `?piece=` the open preview, so PAIGE can link to a piece.
import React from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { printStudioDocument } from "@/components/admin/studio/studio-document";
import { AskPaigeButton, LIBRARY_DENIED, useLibraryAccess, useTenantRead, type Phase, type PublishedWork } from "./marketing-planned";
import { ChartBoundary } from "./marketing-ui";
import { parseAdCopy } from "./marketing-ads";
import { DetailDrawer } from "./detail-drawer";
import {
  CONTENT_KINDS, channelCounts, copyParts, safeMediaUrl, documentCover, downloadName, kindCounts, kindNoun, parsePieceDocument, pieceKind, pieceLabel, plainCopy, shapeLabel, shortTitle,
  type ContentKindFilter, type ContentPiece, type PieceKind,
} from "./marketing-content-model";
import "./marketing-overview.css";
import "./marketing-content.css";

const DocumentPreview = React.lazy(() => import("@/components/admin/studio/DocumentPreview").then((module) => ({ default: module.DocumentPreview })));

export const LIBRARY_READ_LIMIT = 60;
const COLUMNS = "id,kind,channel,status,title,body,image_url,size,brief,updated_at";
const NO_PIECES: ContentPiece[] = [];

/** The newest saved pieces, or only one kind's, filtered on the server so the cap never hides a kind. */
const readPieces = (kind: ContentKindFilter) => async (tenantId: string): Promise<ContentPiece[]> => {
  let query = supabase.from("marketing_content" as never).select(COLUMNS).eq("tenant_id", tenantId).neq("status", "archived");
  if (kind === "copy") query = query.not("kind", "in", "(image,video,document)");
  else if (kind !== "all") query = query.eq("kind", kind);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(LIBRARY_READ_LIMIT);
  if (error) throw error;
  return (data ?? []) as unknown as ContentPiece[];
};
const READERS = Object.fromEntries(CONTENT_KINDS.map((kind) => [kind.key, readPieces(kind.key)])) as Record<ContentKindFilter, ReturnType<typeof readPieces>>;

/** One piece by id, for a preview opened from its address when the newest read doesn't hold it. */
const readPiece = (id: string) => async (tenantId: string): Promise<ContentPiece | null> => {
  const { data, error } = await supabase.from("marketing_content" as never).select(COLUMNS).eq("tenant_id", tenantId).eq("id", id).neq("status", "archived").maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as ContentPiece | null;
};

const formatDay = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; };
const IN_CATALOG = "In your Catalog";
const KIND_TITLE: Record<PieceKind, string> = { image: "Images", document: "Documents", copy: "Copy", video: "Video" };
const KIND_COLOR: Record<PieceKind, string> = { image: "--chart-1", document: "--chart-2", copy: "--chart-3", video: "--chart-4" };

const ASK_PROMPT = "Help me make a piece of marketing content for my business. Ask me what it is for and who it is for before you draft it. Save it as a draft; do not post or send anything.";
// First use proposes something concrete rather than a blank ask (§15/§36).
const STARTERS = [
  { label: "A launch image", prompt: "Make an image announcing something new in my business. Ask me what it announces and where it will be posted before you make it. Save it as a draft; do not post anything." },
  { label: "A one-page offer", prompt: "Write a one-page offer document for my main service. Ask me who it is for and what it costs before you draft it. Save it as a draft; do not send anything." },
  { label: "A welcome email", prompt: "Write a welcome email for new people on my list. Ask me what they signed up for before you draft it. Save it as a draft; do not send anything." },
];
const reviseNoun: Record<PieceKind, string> = { image: "image", video: "video", document: "document", copy: "copy" };
const revisePrompt = (piece: ContentPiece) =>
  `Revise my saved ${reviseNoun[pieceKind(piece)]} “${shortTitle(piece.title, 120).text}” (library piece ${piece.id}). Ask me what to change before you start. Save the new version as a draft; do not post, send or publish anything.`;
// The drawer returns focus to the card as it closes; PAIGE opens after that, so her composer keeps focus.
const reviseAfterClose = (prompt: string) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt } }))));

export type MarketingContentProps = {
  tenantId: string | null;
  published: PublishedWork;
  onOpenCapture: () => void;
  onRetryPublished: () => void;
  studioLauncher: React.ReactNode;
  kind: ContentKindFilter;
  onKind: (kind: ContentKindFilter) => void;
  piece: string | null;
  onPiece: (id: string | null) => void;
};

export function MarketingContent({ tenantId, published, onOpenCapture, onRetryPublished, studioLauncher, kind, onKind, piece, onPiece }: MarketingContentProps) {
  const access = useLibraryAccess();
  const all = useTenantRead(tenantId, NO_PIECES, access === "allowed" ? READERS.all : null);
  const phase: Phase = access === "denied" ? "ready" : access === "checking" ? "loading" : all.phase;
  const pieces = all.rows;
  const capped = pieces.length >= LIBRARY_READ_LIMIT;
  const counts = kindCounts(pieces);
  const inCatalog = pieces.filter((p) => p.status === "published").length;
  const filled = access === "allowed" && phase === "ready" && pieces.length > 0;

  const total = capped ? `${pieces.length}+` : String(pieces.length);
  const mix = counts.map((row) => (capped ? KIND_TITLE[row.key].toLowerCase() : `${row.count} ${kindNoun(row.key, row.count)}`));
  const summary = access === "denied" ? <>{LIBRARY_DENIED}</>
    : phase === "loading" ? <>Reading your library…</>
    : phase === "error" ? <>Your library could not load.</>
    : !pieces.length ? <>Your library is empty. Everything PAIGE makes for you is kept here.</>
    : <><b>{total} {pieces.length === 1 && !capped ? "piece" : "pieces"}</b> in your library{mix.length ? `: ${joinWords(mix)}` : ""}{capped ? `, the newest ${LIBRARY_READ_LIMIT} shown` : ""}.{inCatalog ? <> {inCatalog}{capped ? ` of the newest ${LIBRARY_READ_LIMIT}` : ""} {inCatalog === 1 ? "is" : "are"} in your Catalog.</> : null} Nothing here posts or sends.</>;

  // The filter offers the kinds the library holds, plus whichever one the address names.
  const offered = CONTENT_KINDS.filter((option) => option.key === "all" || option.key === kind || counts.some((row) => row.key === option.key));
  const countOf = (key: ContentKindFilter) => (capped ? null : key === "all" ? pieces.length : counts.find((row) => row.key === key)?.count ?? 0);

  // The preview portals to `.solo-campaigns`, a sibling of the scroll region the drawer marks inert;
  // rendered inline it would inert itself (the same reason as campaign-desk.tsx's drawers).
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [host, setHost] = React.useState<Element | null>(null);
  React.useEffect(() => { setHost(rootRef.current?.closest(".solo-campaigns") ?? document.body); }, []);

  return <div className="mov mct" ref={rootRef}>
    <div className="mov-top">
      <p className="mov-sum" tabIndex={-1}>{summary}</p>
      <div className="mov-acts">{filled && <AskPaigeButton label="Ask PAIGE for content" prompt={ASK_PROMPT}/>}{studioLauncher}</div>
    </div>
    {access !== "denied" && <section className="mov-card mct-lib" aria-labelledby="mct-lib-h">
      <header className="mov-head">
        <div><h2 id="mct-lib-h">Your library</h2>{filled && <p>Newest first. Open a piece to preview it, download it or ask PAIGE to revise it.</p>}</div>
        {filled && <div className="mct-filter">
          <MiniRing counts={counts}/>
          <div className="campaigns-segmented" role="group" aria-label="Show">
            {offered.map((option) => { const n = countOf(option.key); return <button key={option.key} aria-pressed={kind === option.key} onClick={() => onKind(kind === option.key && option.key !== "all" ? "all" : option.key)}>
              {option.key !== "all" && <i aria-hidden="true" style={{ background: `var(${KIND_COLOR[option.key as PieceKind]})` }}/>}{option.label}{n !== null && <span className="mct-n">{n}</span>}
            </button>; })}
          </div>
        </div>}
      </header>
      {kind === "all" || !filled
        ? <Gallery phase={phase} pieces={pieces} retry={all.retry} capped={capped} onOpen={onPiece}/>
        : <FilteredGallery key={`${tenantId}:${kind}`} tenantId={tenantId} kind={kind} onOpen={onPiece} onAll={() => onKind("all")}/>}
    </section>}
    <Published published={published} onOpenCapture={onOpenCapture} onRetry={onRetryPublished}/>
    <p className="mct-foot">Posting, scheduling and a content calendar aren’t connected yet: PAIGE drafts, and you post.</p>
    {host && piece && access === "allowed" && createPortal(<PiecePreview key={`${tenantId}:${piece}`} tenantId={tenantId} id={piece} known={pieces.find((p) => p.id === piece) ?? null} listPhase={phase} onClose={() => onPiece(null)}/>, host)}
  </div>;
}

function joinWords(words: string[]) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The library's mix as a small ring beside the filter that names each kind. */
function MiniRing({ counts }: { counts: { key: PieceKind; count: number }[] }) {
  const whole = counts.reduce((sum, row) => sum + row.count, 0);
  let at = 0;
  const stops = counts.map((row) => { const from = at; at += (row.count / whole) * 100; return `var(${KIND_COLOR[row.key]}) ${from}% ${at}%`; });
  return <span className="mct-ring" role="img" aria-label={`Your library by kind: ${counts.map((row) => `${KIND_TITLE[row.key]} ${row.count}`).join(", ")}`} style={{ background: `conic-gradient(${stops.join(", ")})` }}/>;
}

function Published({ published, onOpenCapture, onRetry }: { published: PublishedWork; onOpenCapture: () => void; onRetry: () => void }) {
  const ready = published.phase === "ready";
  const failed = published.phase === "error" || published.phase === "unavailable";
  const value = (n: number) => (ready ? String(n) : failed ? "—" : "…");
  return <section className="mov-card mct-pubrow" aria-labelledby="mct-pub-h">
    <div className="mct-pub-h"><h2 id="mct-pub-h">Published from Vibe Studio</h2>
      <p>{failed ? <>Could not load. <button type="button" className="mov-lnk" onClick={onRetry}>Try again</button></> : !ready ? "Loading" : published.unpublished ? `${published.unpublished} more built and not published yet, so collecting nothing.` : published.pages + published.funnels + published.forms ? "Everything you built is published." : "Nothing built in Vibe Studio yet."}</p></div>
    <dl className="mct-pub">
      <div><dt>Pages</dt><dd>{value(published.pages)}</dd></div>
      <div><dt>Funnels</dt><dd>{value(published.funnels)}</dd></div>
      <div><dt>Forms</dt><dd>{value(published.forms)}</dd></div>
    </dl>
    <button type="button" className="mov-lnk" onClick={onOpenCapture}>Published work</button>
  </section>;
}

function FilteredGallery({ tenantId, kind, onOpen, onAll }: { tenantId: string | null; kind: ContentKindFilter; onOpen: (id: string) => void; onAll: () => void }) {
  const read = useTenantRead(tenantId, NO_PIECES, READERS[kind]);
  if (read.phase === "ready" && !read.rows.length) {
    const label = CONTENT_KINDS.find((option) => option.key === kind)?.label.toLowerCase() ?? "pieces";
    return <div className="mct-empty"><p>No {label} saved yet.</p><button type="button" className="mov-lnk" onClick={onAll}>Show everything</button></div>;
  }
  // Copy keeps the old "By kind" split by channel (§58): email, social post, ad copy and the rest.
  const channels = kind === "copy" && read.phase === "ready" ? channelCounts(read.rows) : [];
  return <>
    {channels.length > 1 && <p className="mct-note mct-channels">{channels.map((row) => `${row.count} ${row.label.toLowerCase()}`).join(" · ")}{read.rows.length >= LIBRARY_READ_LIMIT ? ", in the newest 60" : ""}</p>}
    <Gallery phase={read.phase} pieces={read.rows} retry={read.retry} capped={read.rows.length >= LIBRARY_READ_LIMIT} onOpen={onOpen}/>
  </>;
}

function Gallery({ phase, pieces, retry, capped, onOpen }: { phase: Phase; pieces: ContentPiece[]; retry: () => void; capped: boolean; onOpen: (id: string) => void }) {
  if (phase === "loading") return <div className="campaigns-skeleton mct-grid-skel" role="status" aria-busy="true" aria-label="Loading your library">{[0, 1, 2, 3].map((i) => <span key={i}/>)}</div>;
  if (phase === "error") return <div className="mct-state"><p>Nothing was changed.</p><button type="button" className="btn btn-s" onClick={retry}>Try again</button></div>;
  if (!pieces.length) return <div className="mct-empty"><p>Ask PAIGE for something to start with. She drafts it and keeps it here; nothing is posted or sent.</p>
    <div className="mct-starters">{STARTERS.map((starter) => <AskPaigeButton key={starter.label} label={starter.label} prompt={starter.prompt}/>)}<AskPaigeButton label="Something else" prompt={ASK_PROMPT}/></div></div>;
  return <>
    <ul className="mct-grid">{pieces.map((piece) => <li key={piece.id}><PieceCard piece={piece} onOpen={() => onOpen(piece.id)}/></li>)}</ul>
    {capped && <p className="mct-note mct-capnote">The newest {LIBRARY_READ_LIMIT} are shown.</p>}
  </>;
}

function PieceCard({ piece, onOpen }: { piece: ContentPiece; onOpen: () => void }) {
  const kind = pieceKind(piece);
  const doc = React.useMemo(() => parsePieceDocument(piece), [piece]);
  // Wide pictures fill the frame; square and tall ones are shown whole, never cropped.
  const shape = kind === "image" ? shapeLabel(piece.size) : null;
  const whole = kind === "image" && !["Landscape", "Wide"].includes(shape ?? "Landscape");
  return <button type="button" className="mct-card" onClick={onOpen}>
    <span className={`mct-frame mct-frame-${kind}${whole ? " mct-whole" : ""}`} aria-hidden="true"><Thumb piece={piece} doc={doc}/></span>
    <span className="mct-meta">
      <span className="mct-kind">{pieceLabel(piece, doc)}</span>
      <strong>{shortTitle(piece.title).text}</strong>
      <small>{piece.status === "published" ? `${IN_CATALOG} · ` : ""}saved {formatDay(piece.updated_at)}</small>
    </span>
  </button>;
}

function Thumb({ piece, doc }: { piece: ContentPiece; doc: ReturnType<typeof parsePieceDocument> }) {
  const kind = pieceKind(piece);
  const [broken, setBroken] = React.useState(false);
  if (kind === "image" || kind === "video") {
    const url = safeMediaUrl(piece.image_url);
    if (!url || broken) return <span className="mct-missing">{url ? `This ${kind} couldn’t load` : `No file saved with this ${kind}`}</span>;
    return kind === "image"
      ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)}/>
      : <><video src={url} muted playsInline preload="metadata" tabIndex={-1} onError={() => setBroken(true)}/><span className="mct-play"/></>;
  }
  if (kind === "document") {
    const cover = documentCover(doc);
    if (!cover) return <span className="mct-missing">This document couldn’t be read</span>;
    return <span className="mct-cover">
      {cover.eyebrow && <small>{cover.eyebrow}</small>}
      <b>{cover.title}</b>
      {cover.subhead && <span>{cover.subhead}</span>}
      <em>{cover.sections ? `${cover.sections} ${cover.sections === 1 ? "section" : "sections"}` : cover.type}</em>
    </span>;
  }
  if (piece.channel === "ad_copy") {
    const ad = parseAdCopy(piece.body);
    if (ad.headline || ad.cta) return <span className="mct-words mct-ad">{ad.headline && <b>{ad.headline}</b>}{ad.primary && <span>{plainCopy(ad.primary)}</span>}{ad.cta && <i>{ad.cta}</i>}</span>;
  }
  const parts = copyParts(piece.body, piece.channel);
  if (!parts.lead && !parts.rest) return <span className="mct-missing">No words saved with this piece</span>;
  return <span className="mct-words">{parts.lead && <b>{parts.lead}</b>}{parts.rest && <span>{parts.rest}</span>}</span>;
}

function PiecePreview({ tenantId, id, known, listPhase, onClose }: { tenantId: string | null; id: string; known: ContentPiece | null; listPhase: Phase; onClose: () => void }) {
  // The list usually holds the piece; a link to an older one reads it on its own.
  const fetchOne = !known && listPhase !== "loading";
  const single = useTenantRead<ContentPiece | null>(tenantId, null, fetchOne ? readPiece(id) : null);
  const piece = known ?? single.rows;
  const doc = React.useMemo(() => (piece ? parsePieceDocument(piece) : null), [piece]);
  if (!piece) {
    if (!fetchOne || single.phase === "loading") return <DetailDrawer detail={{ key: id, eyebrow: "Content", title: "Opening…", rows: [], body: <div className="campaigns-skeleton mct-skel" role="status" aria-busy="true" aria-label="Loading this piece"><span/><span/></div> }} onClose={onClose}/>;
    if (single.phase === "error") return <DetailDrawer detail={{ key: id, eyebrow: "Content", title: "This piece could not load", rows: [], body: <p className="mct-note">Nothing was changed.</p>, actions: <button type="button" className="btn btn-s" onClick={single.retry}>Try again</button> }} onClose={onClose}/>;
    return <DetailDrawer detail={{ key: id, eyebrow: "Content", title: "This piece isn’t in your library", rows: [], body: <p className="mct-note">It may have been archived, or it belongs to another workspace.</p> }} onClose={onClose}/>;
  }
  const kind = pieceKind(piece);
  const title = shortTitle(piece.title, 120);
  const asked = piece.brief?.trim() && piece.brief.trim() !== (piece.title ?? "").trim() ? piece.brief.trim() : title.cut ? (piece.title ?? "").trim() : null;
  const shape = kind === "image" ? shapeLabel(piece.size) : null;
  const ad = kind === "copy" && piece.channel === "ad_copy" ? parseAdCopy(piece.body) : null;
  const parts = kind === "copy" ? copyParts(piece.body, piece.channel) : null;
  const body = <div className="mct-preview">
    <p className="mct-facts">{[pieceLabel(piece, doc), shape, piece.status === "published" ? IN_CATALOG : "Draft", `saved ${formatDay(piece.updated_at)}`].filter(Boolean).join(" · ")}</p>
    {(kind === "image" || kind === "video") && (safeMediaUrl(piece.image_url) ? <FullMedia kind={kind} url={safeMediaUrl(piece.image_url)!} alt={title.text}/> : <p className="mct-note">No file was saved with this {kind}.</p>)}
    {kind === "document" && (doc
      ? <div className="mct-doc"><ChartBoundary className="mct-doc-skel" failed="This document couldn’t be shown. Reload the page to try again; nothing was changed."><DocumentPreview document={doc} toolbar={false}/></ChartBoundary></div>
      : <p className="mct-note">This document couldn’t be read. Ask PAIGE to make it again.</p>)}
    {ad && (ad.headline || ad.cta)
      ? <div className="mct-adfull">{ad.headline && <b>{ad.headline}</b>}{ad.primary && <p>{plainCopy(ad.primary)}</p>}{ad.cta ? <i>{ad.cta}</i> : <small>No call to action written</small>}</div>
      : parts && (parts.lead || parts.rest ? <div className="mct-copy">{parts.lead && <b>{parts.lead}</b>}{parts.rest}</div> : <p className="mct-note">No words were saved with this piece.</p>)}
    {asked && (kind === "image" || kind === "video") && <div className="mct-asked"><span>What PAIGE was asked</span><p>{asked}</p></div>}
  </div>;
  return <DetailDrawer detail={{ key: piece.id, eyebrow: "Content", wide: true, title: title.text, rows: [], body, actions: <PieceActions piece={piece} hasDoc={Boolean(doc)} onClose={onClose}/> }} onClose={onClose}/>;
}

function FullMedia({ kind, url, alt }: { kind: "image" | "video"; url: string; alt: string }) {
  const [broken, setBroken] = React.useState(false);
  if (broken) return <p className="mct-note">This {kind} couldn’t load. <a className="mov-lnk" href={url} target="_blank" rel="noreferrer">Open it in a new tab</a></p>;
  return <figure className="mct-full">{kind === "image" ? <img src={url} alt={alt} onError={() => setBroken(true)}/> : <video src={url} controls playsInline preload="metadata" aria-label={alt} onError={() => setBroken(true)}/>}</figure>;
}

function PieceActions({ piece, hasDoc, onClose }: { piece: ContentPiece; hasDoc: boolean; onClose: () => void }) {
  const kind = pieceKind(piece);
  const [note, setNote] = React.useState("");
  const url = kind === "image" || kind === "video" ? safeMediaUrl(piece.image_url) : null;
  const [busy, setBusy] = React.useState(false);
  const download = async () => {
    if (!url || busy) return;
    setBusy(true);
    setNote("Downloading…");
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const href = URL.createObjectURL(await response.blob());
      const link = Object.assign(document.createElement("a"), { href, download: downloadName(piece) });
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
      setNote("Download started.");
    } catch (error) {
      console.error("[marketing] download failed", error);
      setNote("The download didn’t start. Use Open full size and save it from there.");
    } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(plainCopy(piece.body)); setNote("Copied."); }
    catch (error) { console.error("[marketing] copy failed", error); setNote("Couldn’t copy. Select the words and copy them yourself."); }
  };
  return <>
    {url && <><button type="button" className="btn btn-s" disabled={busy} onClick={() => void download()}>Download</button><a className="btn btn-s" href={url} target="_blank" rel="noreferrer">Open full size</a></>}
    {kind === "document" && hasDoc && <button type="button" className="btn btn-s" onClick={printStudioDocument}>Print / Save as PDF</button>}
    {kind === "copy" && plainCopy(piece.body) && <button type="button" className="btn btn-s" onClick={() => void copy()}>Copy text</button>}
    <button type="button" className="btn btn-s" onClick={() => { onClose(); reviseAfterClose(revisePrompt(piece)); }}>Revise with PAIGE</button>
    <span className="mct-act-note" role="status" aria-live="polite">{note}</span>
  </>;
}
