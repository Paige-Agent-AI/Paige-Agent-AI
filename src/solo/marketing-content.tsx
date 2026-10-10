// Marketing › Content (INT-342 S1e, owner ask 2026-10-10: "before Campaigns we need to reimagine Content").
//
// The saved library as a gallery of the work itself. Each piece shows what it really is (model:
// marketing-content-model.ts) and opens in a preview: an image full size with Download, a document drawn
// by the Studio's own renderer (DocumentPreview, with its Print / Save as PDF), saved copy as its words
// with Copy text. Revising is draft-first through PAIGE; nothing here posts, sends or publishes.
// Reads (tenant-scoped, read-only, nothing new on the server):
//   marketing_content  not archived, newest first. RLS: admins of the business or the platform owner, the
//                      same test the briefs read reports as can_manage, so a member is told the library is
//                      for owners and admins rather than shown an empty one.
//   published work     pages, funnels and forms from Vibe Studio (useSoloCampaigns, via growth2).
// `?kind=` keeps the filter in the address and `?piece=` the open preview, so PAIGE can link to a piece.
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { AskPaigeButton, LIBRARY_DENIED, useLibraryAccess, useTenantRead, type Phase, type PublishedWork } from "./marketing-planned";
import { ChartBoundary } from "./marketing-ui";
import { parseAdCopy } from "./marketing-ads";
import { DetailDrawer } from "./detail-drawer";
import type { DonutSlice } from "./marketing-overview-charts";
import {
  CONTENT_KINDS, documentCover, downloadName, kindCounts, kindNoun, parsePieceDocument, pieceKind, pieceLabel, plainCopy, shapeLabel, shortTitle,
  type ContentKindFilter, type ContentPiece, type PieceKind,
} from "./marketing-content-model";
import "./marketing-overview.css";
import "./marketing-content.css";

const Donut = React.lazy(() => import("./marketing-overview-charts").then((module) => ({ default: module.Donut })));
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
const stateWord = (piece: ContentPiece) => (piece.status === "published" ? "Published" : "Draft");
const SLICE: Record<PieceKind, DonutSlice["colorToken"]> = { image: "--chart-1", document: "--chart-2", copy: "--chart-3", video: "--chart-4" };
const KIND_TITLE: Record<PieceKind, string> = { image: "Images", document: "Documents", copy: "Copy", video: "Video" };

const ASK_PROMPT = "Help me make a piece of marketing content for my business. Ask me what it is for and who it is for before you draft it. Save it as a draft; do not post or send anything.";
const reviseNoun: Record<PieceKind, string> = { image: "image", video: "video", document: "document", copy: "copy" };
const revisePrompt = (piece: ContentPiece) =>
  `Revise my saved ${reviseNoun[pieceKind(piece)]} “${shortTitle(piece.title, 120).text}”. Ask me what to change before you start. Save the new version as a draft; do not post, send or publish anything.`;
const openPaige = (prompt: string) => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt } }));

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
  const publishedCount = pieces.filter((p) => p.status === "published").length;
  const ask = <AskPaigeButton label="Ask PAIGE for content" prompt={ASK_PROMPT}/>;

  const total = capped ? `${pieces.length}+` : String(pieces.length);
  const mix = counts.map((row) => `${capped ? "" : `${row.count} `}${capped ? KIND_TITLE[row.key].toLowerCase() : kindNoun(row.key, row.count)}`);
  const summary = access === "denied" ? <>{LIBRARY_DENIED}</>
    : phase === "loading" ? <>Reading your library…</>
    : phase === "error" ? <>Your library could not load.</>
    : !pieces.length ? <>Your library is empty. Ask PAIGE for an image, a document or copy, and it is kept here.</>
    : <><b>{total} {pieces.length === 1 && !capped ? "piece" : "pieces"}</b> in your library{mix.length ? `: ${joinWords(mix)}` : ""}{capped ? `, the newest ${LIBRARY_READ_LIMIT} shown` : ""}. {publishedCount ? <>{publishedCount} published; the rest are drafts.</> : <>All are drafts.</>} Nothing here posts or sends.</>;

  // The filter offers the kinds the library holds, plus whichever one the address names.
  const offered = CONTENT_KINDS.filter((option) => option.key === "all" || option.key === kind || counts.some((row) => row.key === option.key));
  const countOf = (key: ContentKindFilter) => (capped ? null : key === "all" ? pieces.length : counts.find((row) => row.key === key)?.count ?? 0);

  return <div className="mov mct">
    <div className="mov-top">
      <p className="mov-sum" tabIndex={-1}>{summary}</p>
      <div className="mov-acts">{ask}{studioLauncher}</div>
    </div>
    <div className="mct-two">
      <Mix access={access} phase={phase} counts={counts} total={total} capped={capped} kind={kind} onKind={onKind} retry={all.retry}/>
      <Published published={published} onOpenCapture={onOpenCapture} onRetry={onRetryPublished}/>
    </div>
    <section className="mov-card mct-lib" aria-labelledby="mct-lib-h">
      <header className="mov-head">
        <div><h2 id="mct-lib-h">Your library</h2><p>Newest first. Open a piece to preview it, download it or ask PAIGE to revise it.</p></div>
        {access === "allowed" && phase === "ready" && pieces.length > 0 && <div className="campaigns-segmented" role="group" aria-label="Show">
          {offered.map((option) => { const n = countOf(option.key); return <button key={option.key} aria-pressed={kind === option.key} onClick={() => onKind(option.key)}>{option.label}{n !== null && <span className="mct-n">{n}</span>}</button>; })}
        </div>}
      </header>
      {access === "denied" ? <p className="mct-note">{LIBRARY_DENIED}</p>
        : kind === "all" ? <Gallery phase={phase} pieces={pieces} retry={all.retry} capped={capped} onOpen={onPiece} ask={ask}/>
        : <FilteredGallery key={`${tenantId}:${kind}`} tenantId={tenantId} kind={kind} enabled={access === "allowed"} onOpen={onPiece} ask={ask} onAll={() => onKind("all")}/>}
      <p className="mct-foot">PAIGE drafts and you post: posting and scheduling aren’t connected here. Nothing is laid out on a calendar yet, because briefs record timing as words, not dates.</p>
    </section>
    {piece && access === "allowed" && <PiecePreview key={`${tenantId}:${piece}`} tenantId={tenantId} id={piece} known={pieces.find((p) => p.id === piece) ?? null} listPhase={phase} onClose={() => onPiece(null)}/>}
  </div>;
}

function joinWords(words: string[]) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function Mix({ access, phase, counts, total, capped, kind, onKind, retry }: { access: string; phase: Phase; counts: { key: PieceKind; count: number }[]; total: string; capped: boolean; kind: ContentKindFilter; onKind: (kind: ContentKindFilter) => void; retry: () => void }) {
  const [active, setActive] = React.useState<string | null>(null);
  const whole = counts.reduce((sum, row) => sum + row.count, 0);
  const slices: DonutSlice[] = counts.map((row) => ({ key: row.key, label: KIND_TITLE[row.key], count: row.count, colorToken: SLICE[row.key] }));
  return <section className="mov-card" aria-labelledby="mct-mix-h">
    <header className="mov-head"><div><h2 id="mct-mix-h">What’s in your library</h2><p>{capped ? `The newest ${total.replace("+", "")} pieces, by kind` : "Every saved piece, by kind"}</p></div></header>
    <div className="mct-body">
      {access === "denied" ? <p className="mct-note">{LIBRARY_DENIED}</p>
        : phase === "loading" ? <div className="campaigns-skeleton mct-skel" role="status" aria-busy="true" aria-label="Loading your library"><span/><span/></div>
        : phase === "error" ? <div className="mct-state"><p>Your library could not load. Nothing was changed.</p><button type="button" className="btn btn-s" onClick={retry}>Try again</button></div>
        : !whole ? <p className="mct-note">Nothing saved yet.</p>
        : <div className="mo-split mct-split">
          <ChartBoundary className="mo-donut"><Donut slices={slices} total={total} caption={whole === 1 ? "piece" : "pieces"} label="What’s in your library" activeKey={active} onActiveKey={setActive} onSelect={(slice) => onKind(slice.key as ContentKindFilter)}/></ChartBoundary>
          <ul className="mo-keys">{slices.map((slice) => <li key={slice.key}><button type="button" aria-pressed={kind === slice.key} className={active === slice.key ? "is-active" : ""} onMouseEnter={() => setActive(slice.key)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(slice.key)} onBlur={() => setActive(null)} onClick={() => onKind(slice.key as ContentKindFilter)} aria-label={`${slice.label}: ${slice.count}${capped ? " or more" : ""}, ${Math.round((slice.count / whole) * 100)}%. Show only these`}><i style={{ background: `var(${slice.colorToken})` }} aria-hidden="true"/><span>{slice.label}</span><b>{slice.count}{capped ? "+" : ""}</b><em>{Math.round((slice.count / whole) * 100)}%</em></button></li>)}</ul>
        </div>}
    </div>
  </section>;
}

function Published({ published, onOpenCapture, onRetry }: { published: PublishedWork; onOpenCapture: () => void; onRetry: () => void }) {
  const ready = published.phase === "ready";
  const failed = published.phase === "error" || published.phase === "unavailable";
  const value = (n: number) => (ready ? String(n) : failed ? "—" : "…");
  const live = published.pages + published.funnels + published.forms;
  return <section className="mov-card" aria-labelledby="mct-pub-h">
    <header className="mov-head"><div><h2 id="mct-pub-h">Published from Vibe Studio</h2><p>{ready ? (live ? `${live} live, collecting leads where they have a form` : "Nothing published yet") : failed ? "Could not load" : "Loading"}</p></div>
      <button type="button" className="mov-lnk" onClick={onOpenCapture}>Published work</button></header>
    <div className="mct-body">
      <dl className="mct-pub">
        <div><dt>Pages</dt><dd>{value(published.pages)}</dd></div>
        <div><dt>Funnels</dt><dd>{value(published.funnels)}</dd></div>
        <div><dt>Forms</dt><dd>{value(published.forms)}</dd></div>
      </dl>
      {failed ? <p className="mct-note">Your published pages, funnels and forms could not load. <button type="button" className="mov-lnk" onClick={onRetry}>Try again</button></p>
        : <p className="mct-note">{ready ? <><b>{published.unpublished}</b> built in Vibe Studio and not published yet, so collecting nothing.</> : " "}</p>}
    </div>
  </section>;
}

function FilteredGallery({ tenantId, kind, enabled, onOpen, ask, onAll }: { tenantId: string | null; kind: ContentKindFilter; enabled: boolean; onOpen: (id: string) => void; ask: React.ReactNode; onAll: () => void }) {
  const read = useTenantRead(tenantId, NO_PIECES, enabled ? READERS[kind] : null);
  const phase: Phase = enabled ? read.phase : "loading";
  if (phase === "ready" && !read.rows.length) {
    const label = CONTENT_KINDS.find((option) => option.key === kind)?.label.toLowerCase() ?? "pieces";
    return <div className="mct-empty"><p>No {label} saved yet.</p><button type="button" className="mov-lnk" onClick={onAll}>Show everything</button></div>;
  }
  return <Gallery phase={phase} pieces={read.rows} retry={read.retry} capped={read.rows.length >= LIBRARY_READ_LIMIT} onOpen={onOpen} ask={ask}/>;
}

function Gallery({ phase, pieces, retry, capped, onOpen, ask }: { phase: Phase; pieces: ContentPiece[]; retry: () => void; capped: boolean; onOpen: (id: string) => void; ask: React.ReactNode }) {
  if (phase === "loading") return <div className="campaigns-skeleton mct-grid-skel" role="status" aria-busy="true" aria-label="Loading your library">{[0, 1, 2, 3].map((i) => <span key={i}/>)}</div>;
  if (phase === "error") return <div className="mct-state"><p>Your library could not load. Nothing was changed.</p><button type="button" className="btn btn-s" onClick={retry}>Try again</button></div>;
  if (!pieces.length) return <div className="mct-empty"><p>Nothing saved yet. Ask PAIGE for an image, a document or copy, and it is kept here as a draft.</p>{ask}</div>;
  return <>
    <ul className="mct-grid">{pieces.map((piece) => <li key={piece.id}><PieceCard piece={piece} onOpen={() => onOpen(piece.id)}/></li>)}</ul>
    {capped && <p className="mct-note mct-capnote">The newest {LIBRARY_READ_LIMIT} are shown.</p>}
  </>;
}

function PieceCard({ piece, onOpen }: { piece: ContentPiece; onOpen: () => void }) {
  const kind = pieceKind(piece);
  const doc = React.useMemo(() => parsePieceDocument(piece), [piece]);
  const title = shortTitle(piece.title).text;
  const shape = kind === "image" ? shapeLabel(piece.size) : null;
  // Wide pictures fill the frame; square and tall ones are shown whole, never cropped.
  const whole = kind === "image" && !["Landscape", "Wide"].includes(shape ?? "Landscape");
  return <button type="button" className="mct-card" onClick={onOpen}>
    <span className={`mct-frame mct-frame-${kind}${whole ? " mct-whole" : ""}`} aria-hidden="true"><Thumb piece={piece} doc={doc}/></span>
    <span className="mct-meta">
      <span className="mct-kind">{pieceLabel(piece, doc)}{shape ? ` · ${shape}` : ""}</span>
      <strong>{title}</strong>
      <small>{stateWord(piece)} · saved {formatDay(piece.updated_at)}</small>
    </span>
  </button>;
}

function Thumb({ piece, doc }: { piece: ContentPiece; doc: ReturnType<typeof parsePieceDocument> }) {
  const kind = pieceKind(piece);
  const [broken, setBroken] = React.useState(false);
  if (kind === "image") {
    if (!piece.image_url || broken) return <span className="mct-missing">{piece.image_url ? "This image couldn’t load" : "No picture saved with this image"}</span>;
    return <img src={piece.image_url} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)}/>;
  }
  if (kind === "video") return <span className="mct-missing">Video preview isn’t available here</span>;
  if (kind === "document") {
    const cover = documentCover(doc);
    if (!cover) return <span className="mct-missing">This document couldn’t be read</span>;
    return <span className="mct-cover">
      {cover.eyebrow && <small>{cover.eyebrow}</small>}
      <b>{cover.title}</b>
      {cover.subhead && <span>{cover.subhead}</span>}
      <em>{cover.type}{cover.sections ? ` · ${cover.sections} ${cover.sections === 1 ? "section" : "sections"}` : ""}</em>
    </span>;
  }
  if (piece.channel === "ad_copy") {
    const ad = parseAdCopy(piece.body);
    if (ad.headline || ad.cta) return <span className="mct-words mct-ad">{ad.headline && <b>{ad.headline}</b>}{ad.primary && <span>{plainCopy(ad.primary)}</span>}{ad.cta && <i>{ad.cta}</i>}</span>;
  }
  const words = plainCopy(piece.body);
  return <span className="mct-words">{words ? <span>{words}</span> : <span className="mct-missing">No words saved with this piece</span>}</span>;
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
  const body = <div className="mct-preview">
    <p className="mct-facts">{[pieceLabel(piece, doc), shape, stateWord(piece), `saved ${formatDay(piece.updated_at)}`].filter(Boolean).join(" · ")}</p>
    {kind === "image" && (piece.image_url ? <FullImage url={piece.image_url} alt={title.text}/> : <p className="mct-note">No picture was saved with this image.</p>)}
    {kind === "video" && <p className="mct-note">Video can’t be previewed here yet.</p>}
    {kind === "document" && (doc
      ? <div className="mct-doc"><ChartBoundary className="mct-doc-skel"><DocumentPreview document={doc}/></ChartBoundary></div>
      : <p className="mct-note">This document couldn’t be read. Ask PAIGE to make it again.</p>)}
    {kind === "copy" && (plainCopy(piece.body) ? <div className="mct-copy">{plainCopy(piece.body)}</div> : <p className="mct-note">No words were saved with this piece.</p>)}
    {asked && kind === "image" && <div className="mct-asked"><span>What PAIGE was asked</span><p>{asked}</p></div>}
  </div>;
  return <DetailDrawer detail={{ key: piece.id, eyebrow: "Content", wide: true, title: title.text, rows: [], body, actions: <PieceActions piece={piece} onClose={onClose}/> }} onClose={onClose}/>;
}

function FullImage({ url, alt }: { url: string; alt: string }) {
  const [broken, setBroken] = React.useState(false);
  if (broken) return <p className="mct-note">This image couldn’t load. <a className="mov-lnk" href={url} target="_blank" rel="noreferrer">Open it in a new tab</a></p>;
  return <figure className="mct-full"><img src={url} alt={alt} onError={() => setBroken(true)}/></figure>;
}

function PieceActions({ piece, onClose }: { piece: ContentPiece; onClose: () => void }) {
  const kind = pieceKind(piece);
  const [note, setNote] = React.useState("");
  const download = async () => {
    if (!piece.image_url) return;
    setNote("Downloading…");
    try {
      const response = await fetch(piece.image_url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const href = URL.createObjectURL(await response.blob());
      const link = Object.assign(document.createElement("a"), { href, download: downloadName(piece) });
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
      setNote("Downloaded.");
    } catch (error) {
      console.error("[marketing] image download failed", error);
      setNote("The download didn’t start. Use Open full size and save it from there.");
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(plainCopy(piece.body)); setNote("Copied."); }
    catch (error) { console.error("[marketing] copy failed", error); setNote("Couldn’t copy. Select the words and copy them yourself."); }
  };
  return <>
    {kind === "image" && piece.image_url && <><button type="button" className="btn btn-s" onClick={() => void download()}>Download</button><a className="btn btn-s" href={piece.image_url} target="_blank" rel="noreferrer">Open full size</a></>}
    {kind === "copy" && plainCopy(piece.body) && <button type="button" className="btn btn-s" onClick={() => void copy()}>Copy text</button>}
    <button type="button" className="btn btn-s" onClick={() => { onClose(); openPaige(revisePrompt(piece)); }}>Revise with PAIGE</button>
    <span className="mct-act-note" role="status" aria-live="polite">{note}</span>
  </>;
}
