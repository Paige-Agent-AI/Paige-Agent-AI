import React from "react";
import { ArrowLeft, ArrowRight, ExternalLink, FileText, Layers, LayoutTemplate, Search, Send } from "lucide-react";
import { flushSync } from "react-dom";
import { readSocialDesk } from "./social-publishing-data";
import type { SocialDeskPost } from "./social-publishing-model";
import { safeMediaUrl, shortTitle } from "./marketing-content-model";
import { useTenantRead } from "./marketing-planned";
import type { CampaignArtifact } from "./useSoloCampaigns";
import "./content-catalog.css";

const EMPTY_POSTS: SocialDeskPost[] = [];
const readPublishedPosts = async (tenantId: string) =>
  (await readSocialDesk(tenantId, false, null)).posts.filter(post => post.status === "published" && post.receiptId);
const TYPES = { page: "Page", form: "Form", funnel: "Funnel", social: "Social post" } as const;
type Kind = keyof typeof TYPES;
type Entry = {
  id: string;
  kind: Kind;
  title: string;
  text?: string;
  origin?: string;
  href: string | null;
  updatedAt: string;
  media?: SocialDeskPost["media"][number];
};
const icons = { page: LayoutTemplate, form: FileText, funnel: Layers, social: Send };

function dateOf(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}

function entriesFor(artifacts: CampaignArtifact[], posts: SocialDeskPost[]) {
  const studio: Entry[] = artifacts
    .filter(({ type, status }) => type === "page" ? status === "published" : status === "active")
    .map(item => ({
      id: `${item.type}:${item.id}`, kind: item.type, title: item.name,
      href: safeMediaUrl(item.publicHref), updatedAt: item.updatedAt,
    }));
  const social: Entry[] = posts.map(post => ({
    id: post.key, kind: "social", title: shortTitle(post.caption || post.title, 80).text,
    text: post.caption, origin: post.destination ? `Published by PAIGE · ${post.destination}` : "Published by PAIGE",
    href: safeMediaUrl(post.url), updatedAt: post.updatedAt, media: post.media[0],
  }));
  return [...studio, ...social].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.id.localeCompare(b.id));
}

function entryLabel(entry: Entry) {
  return [TYPES[entry.kind], entry.origin].filter(Boolean).join(" · ");
}

function CatalogArt({ entry, motion = false }: { entry: Entry; motion?: boolean }) {
  const Icon = icons[entry.kind];
  const url = safeMediaUrl(entry.media?.url);
  return <span className={`content-catalog-art content-catalog-art--${entry.kind}${motion ? " content-catalog-motion" : ""}`} aria-hidden="true">
    {entry.media?.type === "image" && url ? <img src={url} alt="" loading="lazy"/> :
      entry.media?.type === "video" && url ? <video src={url} muted playsInline preload="metadata" tabIndex={-1}/> : <Icon size={42} strokeWidth={1.2}/>}
  </span>;
}

export function ContentCatalog({ tenantId, artifacts, phase, onRetry }: {
  tenantId: string | null;
  artifacts: CampaignArtifact[];
  phase: string;
  onRetry: () => void;
}) {
  const social = useTenantRead(tenantId, EMPTY_POSTS, readPublishedPosts);
  const entries = React.useMemo(() => entriesFor(artifacts, social.rows), [artifacts, social.rows]);
  const [feature, setFeature] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState("");
  const [search, setSearch] = React.useState("");
  const opener = React.useRef<{ key?: string; scrollTop: number } | null>(null);
  const returning = React.useRef(false);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const root = React.useRef<HTMLElement>(null);
  const transition = React.useRef<Pick<ViewTransition, "skipTransition"> | null>(null);
  const entry = entries.find(item => item.id === selected);
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
      <CatalogArt entry={entry} motion/>
      <div>
        <h2 tabIndex={-1} ref={heading}>{entry.title}</h2>
        <p className="content-catalog-meta">{entryLabel(entry)}</p>
        {entry.text && <p className="content-catalog-caption">{entry.text}</p>}
        {entry.href && <a className="content-catalog-primary" href={entry.href} target="_blank" rel="noreferrer">View published {entry.kind === "social" ? "post" : "work"} <ExternalLink size={15}/></a>}
      </div>
    </div>
  </section>;

  const failed = phase === "error" || phase === "unavailable";
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
    {(failed || social.phase === "error") && <p className="content-catalog-notice" role="status">
      {failed && <>Published pages, forms and funnels couldn’t load. <button type="button" onClick={onRetry}>Retry published work</button> </>}
      {social.phase === "error" && <>Published social posts couldn’t load. <button type="button" onClick={social.retry}>Retry social posts</button></>}
    </p>}
    {!entries.length && !failed && social.phase !== "error" && <p role="status">{phase !== "ready" || social.phase === "loading" ? "Reading published content…" : "No published work yet."}</p>}
    {entries.length > 0 && !visible.length && <p role="status">No published items match these filters.</p>}
    <div className="content-catalog-grid">{visible.map(item => <div key={item.id} className="content-catalog-frame">
      <button type="button" className="content-catalog-item" data-content-opener={item.id} onClick={event => open(item, event)}>
        <CatalogArt entry={item}/><span><strong>{item.title}</strong><small>{TYPES[item.kind]} · {item.origin}</small></span>
      </button>
    </div>)}</div>
  </section>;
}
