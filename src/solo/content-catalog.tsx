import React from "react";
import { ArrowLeft, ArrowRight, ExternalLink, FileText, Film, Image as ImageIcon, Layers, LayoutTemplate, Search, Send } from "lucide-react";
import { flushSync } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { readSocialDesk } from "./social-publishing-data";
import type { SocialDeskPost } from "./social-publishing-model";
import { safeMediaUrl, shortTitle } from "./marketing-content-model";
import { useLibraryAccess, useTenantRead } from "./marketing-planned";
import { parseStudioSavedMediaHandoff, type StudioSavedMediaHandoff } from "./studio/saved-media-handoff";
import type { CampaignArtifact } from "./useSoloCampaigns";
import "./content-catalog.css";

const EMPTY_POSTS: SocialDeskPost[] = [];
const readPublishedPosts = async (tenantId: string) =>
  (await readSocialDesk(tenantId, false, null)).posts.filter(post => post.status === "published" && post.receiptId);
const TYPES = { page: "Page", form: "Form", funnel: "Funnel", social: "Social post", image: "Image", video: "Video" } as const;
type Kind = keyof typeof TYPES;
type PublishedMedia = {
  id: string;
  tenant_id: string;
  kind: "image" | "video";
  status: "published";
  title: string | null;
  published_at: string;
  image_path: string | null;
  image_url: string | null;
};
type Entry = {
  id: string;
  kind: Kind;
  title: string;
  text?: string;
  origin?: string;
  href: string | null;
  updatedAt: string;
  media?: Pick<SocialDeskPost["media"][number], "type" | "url">;
  asset?: StudioSavedMediaHandoff | null;
  pieceId?: string;
};
const icons = { page: LayoutTemplate, form: FileText, funnel: Layers, social: Send, image: ImageIcon, video: Film };
const EMPTY_MEDIA: PublishedMedia[] = [];
const MEDIA_PAGE_SIZE = 60;
const EMPTY_MEDIA_READ = { rows: EMPTY_MEDIA, capped: false };

function publishedMediaQuery(tenantId: string) {
  return supabase.from("marketing_content" as never)
    .select("id,tenant_id,kind,status,title,published_at,image_path,image_url")
    .eq("tenant_id", tenantId).eq("status", "published").in("kind", ["image", "video"])
    .not("published_at", "is", null);
}

function publishedMediaRows(data: unknown, tenantId: string) {
  return (Array.isArray(data) ? data as PublishedMedia[] : []).filter(row =>
    row.tenant_id === tenantId && row.status === "published" && (row.kind === "image" || row.kind === "video")
    && typeof row.published_at === "string" && Number.isFinite(Date.parse(row.published_at)));
}

async function readPublishedMedia(tenantId: string, linkedPieceId?: string | null): Promise<typeof EMPTY_MEDIA_READ> {
  const result = await publishedMediaQuery(tenantId).order("published_at", { ascending: false }).limit(MEDIA_PAGE_SIZE + 1);
  if (result.error) throw result.error;
  const matches = publishedMediaRows(result.data, tenantId);
  const rows = matches.slice(0, MEDIA_PAGE_SIZE);
  if (linkedPieceId && !rows.some(item => item.id === linkedPieceId)) {
    const linked = await publishedMediaQuery(tenantId).eq("id", linkedPieceId).limit(1);
    if (linked.error) throw linked.error;
    const exact = publishedMediaRows(linked.data, tenantId).find(item => item.id === linkedPieceId);
    if (exact) rows.push(exact);
  }
  return { rows, capped: matches.length > MEDIA_PAGE_SIZE };
}

function publishedMediaSource(item: PublishedMedia) {
  if (!item.image_path?.startsWith(`${item.tenant_id}/`) || !item.image_url) return null;
  const path = item.image_path.split("/");
  if (path.length < 2 || !path.every(segment => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))) return null;
  try {
    const storage = new URL(import.meta.env.VITE_SUPABASE_URL);
    if (storage.protocol !== "https:") return null;
    const encodedPath = path.map(encodeURIComponent).join("/");
    for (const bucket of ["paige-generated", "growth-assets"] as const) {
      const url = `${storage.origin}/storage/v1/object/public/${bucket}/${encodedPath}`;
      if (item.image_url === url) return { url, bucket };
    }
  } catch { return null; }
  return null;
}

function dateOf(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}

function entriesFor(artifacts: CampaignArtifact[], posts: SocialDeskPost[], media: PublishedMedia[]) {
  const studio: Entry[] = artifacts
    .filter(({ type, status }) => type === "page" ? status === "published" : status === "active")
    .map(item => ({
      id: `${item.type}:${item.id}`, kind: item.type, title: item.name,
      href: safeMediaUrl(item.publicHref), updatedAt: item.updatedAt,
    }));
  const social: Entry[] = posts.map(post => ({
    id: post.key, kind: "social", title: shortTitle(post.caption || post.title, 80).text,
    text: post.caption, origin: post.destination ? `Published by PAIGE · ${post.destination}` : "Published by PAIGE",
    href: safeMediaUrl(post.url), updatedAt: post.updatedAt, media: post.media[0], pieceId: post.pieceId,
  }));
  const originals: Entry[] = media.map(item => {
    const source = publishedMediaSource(item);
    const url = source?.url ?? null;
    const reusable = source?.bucket === "paige-generated" && (item.kind === "image" ? /\.(png|jpe?g)$/i.test(source.url) : /\.mp4$/i.test(source.url));
    return {
      id: `media:${item.id}`, pieceId: item.id, kind: item.kind, title: item.title?.trim() || `Untitled ${item.kind}`,
      href: url, updatedAt: item.published_at, ...(url ? { media: { type: item.kind, url } } : {}),
      asset: reusable ? parseStudioSavedMediaHandoff({ source: "marketing_content", id: item.id, kind: item.kind, expectedTenantId: item.tenant_id }) : null,
    };
  });
  return [...studio, ...social, ...originals].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.id.localeCompare(b.id));
}

function entryLabel(entry: Entry) {
  return [TYPES[entry.kind], entry.origin].filter(Boolean).join(" · ");
}

function CatalogArt({ entry, motion = false, detail = false }: { entry: Entry; motion?: boolean; detail?: boolean }) {
  const Icon = icons[entry.kind];
  const url = safeMediaUrl(entry.media?.url);
  return <span className={`content-catalog-art content-catalog-art--${entry.kind}${motion ? " content-catalog-motion" : ""}`} aria-hidden={!detail || !url}>
    {entry.media?.type === "image" && url ? <img src={url} alt={detail ? entry.title : ""} loading="lazy"/> :
      entry.media?.type === "video" && url ? <video src={url} controls={detail} muted={!detail} playsInline preload="metadata"
        aria-label={detail ? entry.title : undefined} tabIndex={detail ? undefined : -1}/> : <Icon size={42} strokeWidth={1.2}/>}
  </span>;
}

export function ContentCatalog({ tenantId, artifacts, phase, onRetry, linkedPieceId, onClearLinkedPiece }: {
  tenantId: string | null;
  artifacts: CampaignArtifact[];
  phase: string;
  onRetry: () => void;
  linkedPieceId?: string | null;
  onClearLinkedPiece?: () => void;
}) {
  const social = useTenantRead(tenantId, EMPTY_POSTS, readPublishedPosts);
  const access = useLibraryAccess();
  const media = useTenantRead(tenantId, EMPTY_MEDIA_READ, access === "allowed" ? id => readPublishedMedia(id, linkedPieceId) : null);
  const mediaRows = access === "allowed" ? media.rows.rows : EMPTY_MEDIA;
  const mediaCapped = access === "allowed" && media.rows.capped;
  const entries = React.useMemo(() => entriesFor(artifacts, social.rows, mediaRows), [artifacts, social.rows, mediaRows]);
  const [feature, setFeature] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState("");
  const [search, setSearch] = React.useState("");
  const opener = React.useRef<{ key?: string; scrollTop: number } | null>(null);
  const returning = React.useRef(false);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const root = React.useRef<HTMLElement>(null);
  const transition = React.useRef<Pick<ViewTransition, "skipTransition"> | null>(null);
  const linkedEntry = linkedPieceId ? entries.find(item => item.pieceId === linkedPieceId) : undefined;
  const entry = entries.find(item => item.id === selected) ?? linkedEntry;
  const featured = entries.find(item => item.id === feature) ?? entries[0];
  const recent = entries.slice(0, 5);
  const query = search.trim().toLowerCase();
  const visible = entries.filter(item => (!kind || item.kind === kind) &&
    (!query || `${item.title} ${entryLabel(item)}`.toLowerCase().includes(query)));

  function shift(delta: number) {
    if (recent.length < 2) return;
    const index = recent.findIndex(item => item.id === featured?.id);
    setFeature(recent[(index + delta + recent.length) % recent.length].id);
  }

  // Keep fast keyboard navigation immediate. Pointer selection carries the artwork into detail.
  function reveal(change: () => void, animate: boolean) {
    transition.current?.skipTransition();
    if (!animate || document.visibilityState === "hidden" || !document.startViewTransition || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      change();
      return;
    }
    const active = document.startViewTransition(() => flushSync(change));
    transition.current = active;
    void active.ready.catch(() => {});
    void active.finished.catch(() => {}).finally(() => {
      if (transition.current === active) transition.current = null;
    });
  }

  function open(item: Entry, event: React.MouseEvent<HTMLButtonElement>) {
    const key = event.currentTarget.dataset.contentOpener;
    opener.current = { key, scrollTop: root.current?.closest(".campaigns-scroll")?.scrollTop ?? 0 };
    root.current?.querySelectorAll(".content-catalog-motion").forEach(node => node.classList.remove("content-catalog-motion"));
    if (event.detail > 0) event.currentTarget.closest(".content-catalog-frame")?.querySelector(".content-catalog-art")?.classList.add("content-catalog-motion");
    reveal(() => setSelected(item.id), event.detail > 0 && Boolean(key));
  }

  function close(animate: boolean) {
    reveal(() => {
      returning.current = true;
      setSelected(null);
      if (linkedEntry) onClearLinkedPiece?.();
    }, animate);
  }

  const entryId = entry?.id;
  React.useLayoutEffect(() => {
    const scroller = root.current?.closest(".campaigns-scroll");
    if (entryId) {
      if (scroller) scroller.scrollTop = 0;
      heading.current?.focus({ preventScroll: true });
    } else if (returning.current) {
      returning.current = false;
      const previous = opener.current;
      const target = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-content-opener]") ?? [])
        .find(button => button.dataset.contentOpener === previous?.key);
      if (transition.current) target?.closest(".content-catalog-frame")?.querySelector(".content-catalog-art")?.classList.add("content-catalog-motion");
      if (scroller) scroller.scrollTop = previous?.scrollTop ?? 0;
      (target ?? root.current)?.focus({ preventScroll: true });
    }
  }, [entryId]);

  if (entry) return <section className="content-catalog content-catalog-detail" ref={root} tabIndex={-1}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close(false); } }}>
    <button className="content-catalog-back" type="button" onClick={event => close(event.detail > 0)}><ArrowLeft size={17}/> Back to published</button>
    <div className="content-catalog-detail-stage">
      <CatalogArt entry={entry} motion detail/>
      <div>
        <h2 tabIndex={-1} ref={heading}>{entry.title}</h2>
        <p className="content-catalog-meta">{entryLabel(entry)}</p>
        {entry.text && <p className="content-catalog-caption">{entry.text}</p>}
        <div className="content-catalog-detail-actions">
          {entry.asset && <button type="button" className="content-catalog-primary" data-solo-vibe-studio-launcher
            onClick={event => window.dispatchEvent(new CustomEvent("paige-studio", {
              detail: { returnFocus: event.currentTarget, asset: entry.asset },
            }))}>Use in social post</button>}
          {entry.href && <a className={entry.asset ? "content-catalog-back" : "content-catalog-primary"} href={entry.href} target="_blank" rel="noreferrer">
            {entry.kind === "image" || entry.kind === "video" ? "Open full size" : `View published ${entry.kind === "social" ? "post" : "work"}`} <ExternalLink size={15}/>
          </a>}
        </div>
      </div>
    </div>
  </section>;

  const failed = phase === "error" || phase === "unavailable";
  const mediaFailed = access === "allowed" && media.phase === "error";
  const loading = phase !== "ready" || social.phase === "loading" || access === "checking"
    || (access === "allowed" && media.phase === "loading");
  return <section className="content-catalog" ref={root} tabIndex={-1} aria-label="Published content">
    {featured && <div className="content-catalog-feature">
      <article className="content-catalog-stage content-catalog-frame">
        <CatalogArt entry={featured}/>
        <div className="content-catalog-stage-copy">
          <h2>{featured.title}</h2>
          <p className="content-catalog-meta">{entryLabel(featured)}</p>
          <button type="button" className="content-catalog-primary" data-content-opener="featured" onClick={event => open(featured, event)}>Open {TYPES[featured.kind].toLowerCase()} <ArrowRight size={16}/></button>
        </div>
      </article>
      <section className="content-catalog-rail" aria-labelledby="content-recent-title" onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          shift(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}>
        <header><h2 id="content-recent-title">Recently updated</h2><div>
          <button type="button" aria-label="Previous featured item" onClick={() => shift(-1)} disabled={recent.length < 2}><ArrowLeft size={17}/></button>
          <button type="button" aria-label="Next featured item" onClick={() => shift(1)} disabled={recent.length < 2}><ArrowRight size={17}/></button>
        </div></header>
        {recent.map(item => <button type="button" className="content-catalog-recent" key={item.id} aria-pressed={item.id === featured.id} onClick={() => setFeature(item.id)}>
          <CatalogArt entry={item}/><span><strong>{item.title}</strong><small>{TYPES[item.kind]}{dateOf(item.updatedAt) && ` · ${dateOf(item.updatedAt)}`}</small></span>
        </button>)}
      </section>
    </div>}
    <header className="content-catalog-tools">
      <h2>Published library</h2>
      <div>
        <label><Search size={17}/><input type="search" aria-label="Search published content" placeholder="Search content" value={search} onChange={event => setSearch(event.target.value)}/></label>
        <select aria-label="Filter published content by type" value={kind} onChange={event => setKind(event.target.value)}>
          <option value="">All types</option>{Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
    </header>
    {(failed || social.phase === "error" || mediaFailed) && <p className="content-catalog-notice" role="status">
      {failed && <>Published pages, forms and funnels couldn’t load. <button type="button" onClick={onRetry}>Retry published work</button> </>}
      {social.phase === "error" && <>Published social posts couldn’t load. <button type="button" onClick={social.retry}>Retry social posts</button></>}
      {mediaFailed && <>Published images and videos couldn’t load. <button type="button" onClick={media.retry}>Retry published media</button></>}
    </p>}
    {!entries.length && !failed && social.phase !== "error" && !mediaFailed && <p role="status">{loading ? "Reading published content…" : "No published work yet."}</p>}
    {linkedPieceId && !loading && !failed && !mediaFailed && social.phase !== "error" &&
      <p className="content-catalog-notice" role="status">This original is unavailable in published Content.</p>}
    {mediaCapped && <p className="content-catalog-notice">Showing the latest {MEDIA_PAGE_SIZE} published images and videos.</p>}
    {entries.length > 0 && !visible.length && <p role="status">{mediaCapped ? "No matches in the published items shown." : "No published items match these filters."}</p>}
    <div className="content-catalog-grid">{visible.map(item => <div key={item.id} className="content-catalog-frame">
      <button type="button" className="content-catalog-item" data-content-opener={item.id} onClick={event => open(item, event)}>
        <CatalogArt entry={item}/><span><strong>{item.title}</strong><small>{entryLabel(item)}</small></span>
      </button>
    </div>)}</div>
  </section>;
}
