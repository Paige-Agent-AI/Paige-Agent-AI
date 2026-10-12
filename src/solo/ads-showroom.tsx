// Ads › Overview showroom (owner-approved 2026-10-11): the page is pleasing on the first visit with
// nothing connected. Four ad placements stand on a stage; each one shows the business's OWN material
// when it exists and otherwise a fixed, curated artwork labelled "Sample" so it is never mistaken for
// their ad. The pictures are the business's own (owner ruling the same day): the ones the owner
// features first, then the ones whose tracking tag brought the most won deals and leads, then the
// newest (ranked in ads-model.ts rankShowroomMedia). Saved ad copy fills the words. Each placement
// names why its picture is there. Nothing here runs, pays for or publishes anything.
import React from "react";
import { Facebook, Instagram, Linkedin, Search, Youtube, Music2 } from "lucide-react";
import "./ads-showroom.css";

export type ShowroomCopy = { headline: string | null; primary: string; cta: string | null; title: string };
/** One placement's picture: the file, what it is called, and why it is in this slot ("Featured",
 *  "2 won · 9 leads", "Newest"). */
export type ShowroomMedia = { src: string; kind: "image" | "video"; title: string; badge: string };

/* ───────── fixed artwork ─────────
 * Each placement has its own composition, drawn from the theme's chart palette so it reads in light
 * and dark. These are the "fixed images": they stay until the owner's own media takes the slot. */
type ArtKind = "dawn" | "studio" | "field" | "horizon";
export function AdArt({ kind, label }: { kind: ArtKind; label?: string }) {
  const id = React.useId().replace(/:/g, "");
  return <svg className={`asr-art asr-art-${kind}`} viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <defs>
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="var(--asr-a)"/><stop offset="1" stopColor="var(--asr-b)"/></linearGradient>
      <radialGradient id={`${id}-sun`} cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="var(--asr-c)" stopOpacity="1"/><stop offset="0.6" stopColor="var(--asr-c)" stopOpacity=".55"/><stop offset="1" stopColor="var(--asr-c)" stopOpacity="0"/></radialGradient>
      <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="18"/></filter>
      <filter id={`${id}-grain`}><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .07"/></feComponentTransfer></filter>
    </defs>
    <rect width="400" height="500" fill={`url(#${id}-sky)`}/>
    {kind === "dawn" && <>
      <circle cx="268" cy="196" r="150" fill={`url(#${id}-sun)`}/>
      <path d="M-20 360 C 80 300 170 330 250 300 S 380 250 430 270 L430 520 L-20 520Z" fill="var(--asr-d)" opacity=".85"/>
      <path d="M-20 410 C 90 370 200 400 290 372 S 400 350 430 360 L430 520 L-20 520Z" fill="var(--asr-e)"/>
    </>}
    {kind === "studio" && <>
      <ellipse cx="200" cy="420" rx="210" ry="46" fill="var(--asr-e)" opacity=".7" filter={`url(#${id}-soft)`}/>
      <g transform="rotate(-9 200 250)">
        <rect x="118" y="120" width="164" height="232" rx="22" fill="var(--asr-d)"/>
        <rect x="134" y="138" width="132" height="132" rx="14" fill={`url(#${id}-sun)`}/>
        <rect x="134" y="288" width="96" height="10" rx="5" fill="var(--asr-c)" opacity=".8"/>
        <rect x="134" y="308" width="64" height="10" rx="5" fill="var(--asr-c)" opacity=".45"/>
      </g>
      <circle cx="318" cy="132" r="34" fill="var(--asr-c)" opacity=".9"/>
    </>}
    {kind === "field" && <>
      <circle cx="120" cy="150" r="120" fill="var(--asr-c)" opacity=".55" filter={`url(#${id}-soft)`}/>
      <circle cx="300" cy="300" r="150" fill="var(--asr-d)" opacity=".75" filter={`url(#${id}-soft)`}/>
      {Array.from({ length: 6 }, (_, row) => Array.from({ length: 5 }, (_, col) => <circle key={`${row}-${col}`} cx={60 + col * 70} cy={90 + row * 70} r={row % 2 === col % 2 ? 5 : 2.5} fill="var(--asr-e)" opacity=".75"/>))}
    </>}
    {kind === "horizon" && <>
      <circle cx="96" cy="250" r="86" fill={`url(#${id}-sun)`}/>
      <path d="M0 330 L 120 250 L 210 310 L 300 210 L 400 300 L400 500 L0 500Z" fill="var(--asr-d)" opacity=".9"/>
      <path d="M0 400 L 140 340 L 260 380 L 400 330 L400 500 L0 500Z" fill="var(--asr-e)"/>
    </>}
    <rect width="400" height="500" filter={`url(#${id}-grain)`}/>
  </svg>;
}

function Media({ media, art }: { media: ShowroomMedia | null; art: ArtKind }) {
  if (media?.kind === "image") return <img className="asr-media" src={media.src} alt={media.title} loading="lazy"/>;
  if (media?.kind === "video") return <video className="asr-media" src={media.src} muted playsInline preload="metadata" aria-label={media.title}/>;
  return <AdArt kind={art}/>;
}

/** The chip in a placement's corner: "Sample" on fixed artwork, or why the owner's picture is here. */
function Chip({ media }: { media: ShowroomMedia | null }) {
  return media ? <span className="asr-sample is-own" data-showroom-reason={media.badge}>{media.badge}</span> : <span className="asr-sample">Sample</span>;
}

/* ───────── placements ───────── */
type PlacementProps = { brand: string; copy: ShowroomCopy | null; media: ShowroomMedia | null };
const labelOf = (where: string, media: ShowroomMedia | null) => media ? `${where} with your ${media.kind === "video" ? "video" : "picture"} “${media.title}”` : `${where}, sample`;

function FeedPost({ brand, copy, media }: PlacementProps) {
  const own = Boolean(copy || media);
  return <figure className="asr-frame asr-feed" aria-label={media ? labelOf("Feed post", media) : own ? "Feed post with your ad copy, sample picture" : "Feed post, sample"}>
    <header><span className="asr-avatar" aria-hidden="true">{brand.slice(0, 1)}</span><span><b>{brand}</b><small>Sponsored</small></span></header>
    <p className="asr-feed-copy">{copy?.primary ?? "Your ad’s opening line sits here, above the picture."}</p>
    <div className="asr-pic"><Media media={media} art="dawn"/><Chip media={media}/></div>
    <footer><span><small>{copy ? "From your saved ad" : "Your headline"}</small><b>{copy?.headline ?? "A headline people stop for"}</b></span><span className="asr-cta">{copy?.cta ?? "Learn more"}</span></footer>
  </figure>;
}

function Story({ brand, media }: PlacementProps) {
  return <figure className="asr-frame asr-story" aria-label={labelOf("Story", media)}>
    <div className="asr-pic"><Media media={media} art="studio"/></div>
    <div className="asr-story-top" aria-hidden="true"><i/><i/><i/></div>
    <span className="asr-story-who" aria-hidden="true"><span className="asr-avatar">{brand.slice(0, 1)}</span>{brand}</span>
    <span className="asr-story-cta" aria-hidden="true">Swipe up</span>
    <Chip media={media}/>
  </figure>;
}

function SearchAd({ copy }: PlacementProps) {
  return <figure className="asr-frame asr-search" aria-label={copy ? "Search ad with your copy" : "Search ad, sample"}>
    <div className="asr-search-bar" aria-hidden="true"><Search size={12}/><span>{copy?.headline ? copy.headline.toLowerCase().split(" ").slice(0, 4).join(" ") : "what your customers search"}</span></div>
    <small className="asr-search-url"><b>Sponsored</b> · yourwebsite.com</small>
    <b className="asr-search-h">{copy?.headline ?? "Your headline, as a search result"}</b>
    <p>{copy?.primary ?? "Two lines of your ad copy, written to answer what they searched."}</p>
    {!copy && <span className="asr-sample">Sample</span>}
  </figure>;
}

function Display({ brand, copy, media }: PlacementProps) {
  return <figure className="asr-frame asr-display" aria-label={labelOf("Display banner", media)}>
    <div className="asr-pic"><Media media={media} art="horizon"/></div>
    <div className="asr-display-copy"><b>{copy?.headline ?? brand}</b><span className="asr-cta">{copy?.cta ?? "Book now"}</span></div>
    <Chip media={media}/>
  </figure>;
}

/* ───────── the stage ───────── */
/** `media` fills the picture placements in rank order: the feed post first, then the story, then the
 *  display banner (the search result carries words only). `lede` says, in the host's words, what put
 *  each picture there; `status` carries an upload's outcome. */
export function Showroom({ brand, copy, media, lede, actions, status }: { brand: string; copy: ShowroomCopy | null; media: readonly (ShowroomMedia | null)[]; lede: React.ReactNode; actions?: React.ReactNode; status?: React.ReactNode }) {
  const [feed = null, story = null, display = null] = media;
  return <section className="asr" aria-labelledby="asr-h">
    <div className="asr-intro">
      <h2 id="asr-h">See your ads where people will see them</h2>
      <p>{lede}</p>
      {actions && <div className="asr-actions">{actions}</div>}
      {status}
    </div>
    <div className="asr-stage">
      <Story brand={brand} copy={copy} media={story}/>
      <FeedPost brand={brand} copy={copy} media={feed}/>
      <SearchAd brand={brand} copy={copy} media={null}/>
      <Display brand={brand} copy={copy} media={display}/>
    </div>
  </section>;
}

/* ───────── channels: slots that fill as accounts are imported ───────── */
const CHANNELS: { key: string; name: string; Icon: typeof Instagram; art: ArtKind; state: string }[] = [
  { key: "instagram", name: "Instagram", Icon: Instagram, art: "studio", state: "Import isn’t available yet" },
  { key: "facebook", name: "Facebook", Icon: Facebook, art: "dawn", state: "Import isn’t available yet" },
  { key: "tiktok", name: "TikTok", Icon: Music2, art: "field", state: "Not available" },
  { key: "youtube", name: "YouTube", Icon: Youtube, art: "horizon", state: "Not available" },
  { key: "linkedin", name: "LinkedIn", Icon: Linkedin, art: "field", state: "Not available" },
];

export function ChannelShelf() {
  return <section className="asr-shelf" aria-labelledby="asr-shelf-h">
    <header className="asr-shelf-head"><div><h2 id="asr-shelf-h">Your channels</h2><p>When an account can be imported, its recent posts fill these frames. Samples hold the place until then.</p></div></header>
    <ul>{CHANNELS.map(({ key, name, Icon, art, state }) => <li key={key} className="asr-chan" data-channel={key}>
      <div className="asr-chan-pics" aria-hidden="true"><span><AdArt kind={art}/></span><span><AdArt kind={art === "field" ? "dawn" : "field"}/></span><span><AdArt kind={art === "horizon" ? "studio" : "horizon"}/></span></div>
      <div className="asr-chan-b"><span className="asr-chan-ic" aria-hidden="true"><Icon size={15}/></span><strong>{name}</strong><small>{state}</small></div>
    </li>)}</ul>
  </section>;
}
