import React from "react";
import {flushSync} from "react-dom";
import { Link,useParams,useSearchParams,useNavigate,useLocation,useNavigationType,UNSAFE_NavigationContext } from "react-router-dom";
import { ArrowLeft, ArrowRight, Expand, Image, LayoutGrid, List, Megaphone, Minimize2, Pencil, Plus, X } from "lucide-react";
import type { ContentPiece } from "./marketing-content-model";
import { PublishPiece } from "./publish-piece";
import { PUBLICATION_STATUS_WORDS } from "./publish-piece";
import { checkSocialPerformance, pendingSocialDraft, readSocialDesk, readSocialPiece, recoverSocialDraft, saveSocialDraft, SOCIAL_LIBRARY_LIMIT, type SocialDraft } from "./social-publishing-data";
import { safeSocialUrl, socialDeskPosts, type SocialDeskPost, type SocialMediaPreview } from "./social-publishing-model";
import "./social-publishing-desk.css";
import {socialConversationReturn} from "./social-publication-reference";
import {ContentCalendar} from "./content-calendar";
import {useTenantContext} from "@/hooks/useTenantContext";
import {useClientAccountExit} from "@/components/client/useClientAccountExit";
import {socialScheduleLabel} from "./social-schedule-fields";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const EMPTY: SocialDraft = { title: "", caption: "", mediaIds: [] };
const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Date unavailable";
const status = (post: SocialDeskPost) => ({draft:"Draft",outcome_unknown:"Needs check",approved:"Approved",publishing:"Posting…",failed:"Failed",refused:"Refused"}[post.status] ?? PUBLICATION_STATUS_WORDS[post.status] ?? post.status);

export function SocialMedia({ media, caption, compact = false }: { media: SocialMediaPreview[]; caption: string; compact?: boolean }) {
  const [index, setIndex] = React.useState(0);
  const item = media[Math.min(index, Math.max(0, media.length - 1))];
  return <div className={`sdesk-media${compact ? " sdesk-media--compact" : ""}`}>
    {item?.type === "video" ? <video key={item.url} src={item.url} controls preload="metadata" aria-label={item.alt}/>
      : item ? <img src={item.url} alt={item.alt} loading={compact ? "lazy" : "eager"}/>
      : <p className="sdesk-text-preview">{caption || "No caption saved"}</p>}
    {media.length > 1 && <div className="sdesk-carousel" aria-label="Post media">
      <button type="button" aria-label="Previous media" disabled={index === 0} onClick={() => setIndex(i => Math.max(0, i - 1))}><ArrowLeft size={15}/></button>
      <span>{Math.min(index + 1, media.length)} of {media.length}</span>
      <button type="button" aria-label="Next media" disabled={index >= media.length - 1} onClick={() => setIndex(i => Math.min(media.length - 1, i + 1))}><ArrowRight size={15}/></button>
    </div>}
  </div>;
}

function Performance({ post }: { post: SocialDeskPost }) {
  const p = post.performance;
  return <div className="sdesk-performance">
    {p.state === "available" ? <dl>{Object.entries(p.values).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value.toLocaleString()}</dd></div>)}</dl>
      : <p>{p.state === "pending" ? "Performance is still processing." : p.state === "unsupported" ? "Performance is unavailable for this destination." : p.state === "error" ? "The last performance check failed." : "Performance has not been reported."}</p>}
    {p.state === "available" && p.lastCheckState && p.lastCheckState !== "available" && <p>{({pending:"The latest check is still processing. Showing the last reported metrics.",error:"The latest check failed. Showing the last reported metrics.",unsupported:"The latest check is unavailable. Showing the last reported metrics.",unverified:"The latest read did not include a measurement time.",stale:"The latest read was older than these recorded metrics."})[p.lastCheckState]}</p>}
    {p.state === "available" && <small>{p.measuredAt ? `Measured ${time(p.measuredAt)}` : "Provider measurement time unavailable"}</small>}
    {p.checkedAt && <small>Last checked {time(p.checkedAt)}</small>}
  </div>;
}

type DeskProps={ tenantId:string;canManage:boolean;onOpenStudio:()=>void;onAskPaige:()=>void };
export function SocialPublishingDesk(props:DeskProps) {
  const {activeUserId,activeTenantId,loading,accountContextLoading}=useTenantContext();
  if(loading||accountContextLoading||!activeUserId||props.tenantId!==activeTenantId)return <p role="status">Resolving the Social workspace…</p>;
  return <SocialPublishingDeskWorkspace key={`${activeUserId}:${props.tenantId}:${props.canManage}`} {...props}/>;
}
function SocialPublishingDeskWorkspace({ tenantId, canManage, onOpenStudio, onAskPaige }: DeskProps) {
  const [params, setParams] = useSearchParams();
  const {account}=useParams<{account:string}>();
  const navigatePage=useNavigate();
  const location=useLocation(),navigationType=useNavigationType(),{navigator:routerNavigator}=React.useContext(UNSAFE_NavigationContext);
  const realBrowserPop=navigationType==="POP"&&!("index" in routerNavigator)&&window.location.pathname+window.location.search===location.pathname+location.search;
  const conversationReturn=socialConversationReturn(params.toString(),account);
  const urlPiece = params.get("social_piece"), urlReceipt = params.get("publication");
  const [selection, setSelection] = React.useState({ piece: urlPiece, publication: urlReceipt });
  const requested = selection.piece, receipt = selection.publication;
  const pieceId = requested && UUID.test(requested) ? requested : null;
  const [read, setRead] = React.useState<{ tenant: string; phase: "loading" | "ready" | "error"; pieces: ContentPiece[]; posts: SocialDeskPost[]; capped?: boolean }>({ tenant: tenantId, phase: "loading", pieces: [], posts: [] });
  const [attempt, refresh] = React.useReducer(n => n + 1, 0);
  const [plansOpen,setPlansOpen]=React.useState(false);
  const [search, setSearch] = React.useState("");
  const [platform, setPlatform] = React.useState("");
  const [filter, setFilter] = React.useState("");
  const [sort, setSort] = React.useState("newest");
  const [view, setView] = React.useState("grid");
  const [tab, setTab] = React.useState("post");
  const [minimized, setMinimized] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const creating = requested === "new" && canManage;
  const [draft, setDraft] = React.useState<SocialDraft>(EMPTY);
  const [dirty, setDirty] = React.useState(false);
  const [draftOwner, setDraftOwner] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const busyRef = React.useRef(false), tenantRef = React.useRef(tenantId);
  const selectionEpoch=React.useRef(0),renderSelectionEpoch=selectionEpoch.current;
  // Reuse the mounted form/router/account-switch guard. An explicit own discard
  // is flushed before its own push; forced authentication replacements stay free.
  useClientAccountExit(dirty,false);
  tenantRef.current = tenantId;
  React.useEffect(()=>{tenantRef.current=tenantId;return()=>{tenantRef.current="";};},[tenantId]);
  const opener = React.useRef<HTMLButtonElement | null>(null), heading = React.useRef<HTMLHeadingElement>(null), resume = React.useRef<HTMLButtonElement>(null), deskHeading = React.useRef<HTMLHeadingElement>(null);
  const selected = read.tenant === tenantId ? read.posts.find(p => receipt ? p.receiptId === receipt && p.pieceId === pieceId : p.pieceId === pieceId && !p.receiptId)
    ?? (!receipt && canManage ? socialDeskPosts(tenantId, read.pieces, []).find(p => p.pieceId === pieceId) : null) : null;
  const original = read.tenant === tenantId ? read.pieces.find(p => p.id === pieceId) ?? null : null;
  const editing = creating || Boolean(selected && !selected.receiptId);

  React.useEffect(() => {
    if (urlPiece === selection.piece && urlReceipt === selection.publication) return;
    if ((dirty || busy) && navigationType!=="PUSH" && !realBrowserPop && !window.confirm("Discard the unsaved changes to this draft?")) {
      setParams(prev => { const next = new URLSearchParams(prev);
        if (selection.piece) next.set("social_piece",selection.piece); else next.delete("social_piece");
        if (selection.publication) next.set("publication",selection.publication); else next.delete("publication");
        return next;
      }, { replace: true });
      return;
    }
    selectionEpoch.current++;setDirty(false); setSelection({ piece: urlPiece, publication: urlReceipt });
  }, [urlPiece, urlReceipt, selection, dirty, busy, navigationType, realBrowserPop, setParams]);

  React.useEffect(() => {
    let live = true;
    setRead({ tenant: tenantId, phase: "loading", pieces: [], posts: [] });
    void readSocialDesk(tenantId, canManage, pieceId).then(data => { if (live) setRead({ tenant: tenantId, phase: "ready", ...data }); })
      .catch(() => { if (live) setRead({ tenant: tenantId, phase: "error", pieces: [], posts: [] }); });
    return () => { live = false; };
  }, [tenantId, canManage, pieceId, receipt, attempt]);
  React.useEffect(() => {
    setDraft(EMPTY); setDraftOwner(null); setDirty(false); setMessage(""); setMinimized(false); setExpanded(false); busyRef.current = false; setBusy(false);
  }, [tenantId]);
  React.useEffect(() => {
    if (creating && draftOwner !== "new") { setDraft(EMPTY); setDraftOwner("new"); setDirty(false); }
    else if (original && !receipt && (!dirty || draftOwner !== original.id)) {
      setDraft({ title: original.title ?? "", caption: original.body ?? "", mediaIds: Array.isArray(original.meta?.media_content_ids) ? original.meta.media_content_ids as string[] : [] });
      setDraftOwner(original.id); setDirty(false);
    }
  }, [original, receipt, dirty, creating, draftOwner]);
  React.useEffect(() => {
    if (minimized) resume.current?.focus({ preventScroll: true });
    else if ((pieceId || creating) && read.phase === "ready") heading.current?.focus({ preventScroll: true });
  }, [pieceId, receipt, creating, minimized, read.phase]);
  // A dirty draft stays in the same workspace when minimized; leaving warns before discarding it.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const navigate = (id: string | null, publication: string | null = null) => {
    selectionEpoch.current++;
    setSelection({ piece: id, publication });
    setParams(prev => { const next = new URLSearchParams(prev); if (id) next.set("social_piece", id); else next.delete("social_piece");
      if (publication) next.set("publication", publication); else next.delete("publication"); return next; });
  };
  const leave = () => {
    if(!dirty)return true;
    if(!window.confirm("Discard the unsaved changes to this draft?"))return false;
    flushSync(()=>setDirty(false));return true;
  };
  const open = (post: SocialDeskPost, button: HTMLButtonElement) => {
    if (!leave()) return;
    opener.current = button; setDirty(false); setMessage(""); setMinimized(false); setTab("post"); navigate(post.pieceId, post.receiptId);
  };
  const newPost = (button: HTMLButtonElement) => {
    if (!canManage || !leave()) return;
    if (pendingSocialDraft(tenantId)) { setMessage("A previous draft save is unconfirmed. Check the same save below."); return; }
    opener.current = button; navigate("new"); setDraft(EMPTY); setDraftOwner("new"); setDirty(false); setMinimized(false); setTab("post"); setMessage("");
  };
  const close = () => { if (!busy && leave()) { navigate(null); setDirty(false); if (opener.current?.isConnected) opener.current.focus(); else deskHeading.current?.focus(); } };
  const recorded = (publicationId: string) => { if(tenantRef.current!==tenantId)return; if(selectionEpoch.current!==renderSelectionEpoch){refresh();return;} if (!pieceId || !UUID.test(publicationId)) { refresh(); return; } setDirty(false); navigate(pieceId,publicationId); setTab("result"); refresh(); };
  const edit = (patch: Partial<SocialDraft>) => { setDraft(d => ({ ...d, ...patch })); setDirty(true); setMessage(""); };
  const save = async () => {
    if (busyRef.current || !canManage || draftOwner !== (creating ? "new" : original?.id)) return;
    busyRef.current = true; setBusy(true); const owner = tenantId,generation=selectionEpoch.current;
    try {
      const saved = await saveSocialDraft(owner, draft, creating ? null : original);
      if (tenantRef.current !== owner) return;
      if(selectionEpoch.current!==generation){refresh();return;}
      setDirty(false); setMessage("Draft saved. Nothing was published."); navigate(saved.id); refresh();
    } catch (e) { if (tenantRef.current === owner&&selectionEpoch.current===generation) setMessage(e instanceof Error ? e.message : "The save could not be confirmed."); }
    finally { if (tenantRef.current === owner) { busyRef.current = false; setBusy(false); } }
  };
  const recover = async () => {
    if (busyRef.current || !canManage) return;
    busyRef.current = true; setBusy(true); const owner = tenantId,generation=selectionEpoch.current;
    try {
      const saved = pendingSocialDraft(owner) ? await recoverSocialDraft(owner) : original ? await readSocialPiece(owner, original.id) : null;
      if (tenantRef.current !== owner) return;
      if(selectionEpoch.current!==generation){refresh();return;}
      if (saved) { setDirty(false); navigate(saved.id); refresh(); setMessage("Opened the original saved draft. Check its current caption and media."); }
      else setMessage("That save is not confirmed yet. No new draft was created. Check again later.");
    } catch { if (tenantRef.current === owner&&selectionEpoch.current===generation) setMessage("The original draft could not be checked. No save was repeated."); }
    finally { if (tenantRef.current === owner) { busyRef.current = false; setBusy(false); } }
  };
  const checkPerformance = async () => {
    if (!selected?.receiptId || !canManage || busyRef.current) return;
    const owner = tenantId,generation=selectionEpoch.current; busyRef.current = true; setBusy(true); setMessage("");
    try { await checkSocialPerformance(owner,selected.pieceId,selected.receiptId); if (tenantRef.current === owner) { refresh();if(selectionEpoch.current===generation)setMessage("Checked performance on the original published post. Results are cached for one hour."); } }
    catch (e) { if (tenantRef.current === owner&&selectionEpoch.current===generation) setMessage(e instanceof Error ? e.message : "Performance could not be checked."); }
    finally { if (tenantRef.current === owner) { busyRef.current = false; setBusy(false); } }
  };
  const posts = read.tenant === tenantId ? read.posts : [];
  const mediaLibrary = read.tenant === tenantId && canManage ? read.pieces.filter(p => ["image", "video"].includes(p.kind) && safeSocialUrl(p.image_url)) : [];
  const draftMedia = draft.mediaIds.flatMap(id => { const p = mediaLibrary.find(m => m.id === id), url = safeSocialUrl(p?.image_url);
    return p && url ? [{ contentId: id, type: p.kind as "image" | "video", url, alt: p.title || "Saved media" }] : []; });
  const shown = posts.filter(p => (!platform || p.platform === platform) && (!filter || (filter === "needs_check" ? ["outcome_unknown", "publishing", "approved", "registered", "schedule_changing"].includes(p.status) : p.status === filter))
    && (!search || `${p.title} ${p.caption} ${p.destination ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())));
  if (sort === "oldest") shown.reverse();
  const workspaceOpen = Boolean(pieceId || creating);
  const current = read.tenant === tenantId && read.phase === "ready";
  return <section className="sdesk" aria-labelledby="sdesk-title">
    <header className="sdesk-head"><div><h2 id="sdesk-title" tabIndex={-1} ref={deskHeading}>Social</h2><span className="sdesk-nexus"><Megaphone size={18}/>NEXUS</span></div>
      {conversationReturn&&<Link className="btn btn-s" to={conversationReturn} onClick={event=>{if(busy||!leave())event.preventDefault();}}>Return to conversation</Link>}
      {canManage && <button type="button" className="btn btn-s sdesk-primary" disabled={busy} onClick={e => newPost(e.currentTarget)}><Plus size={16}/>Create post</button>}</header>
    <div className="sdesk-tools">
      <label><span className="sdesk-sr">Platform</span><select value={platform} onChange={e => setPlatform(e.target.value)}><option value="">All platforms</option>{Array.from(new Set(posts.map(p => p.platform).filter(Boolean))).map(p => <option key={p!} value={p!}>{p}</option>)}</select></label>
      <label><span className="sdesk-sr">Status</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All statuses</option><option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="published">Published</option><option value="needs_check">Needs check</option><option value="cancelled">Schedule stopped</option><option value="refused">Refused</option><option value="failed">Failed</option></select></label>
      <input aria-label="Search posts" type="search" placeholder="Search posts…" value={search} onChange={e => setSearch(e.target.value)}/>
      <label><span className="sdesk-sr">Sort posts</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Recently updated</option><option value="oldest">Oldest updated</option></select></label>
      <div className="sdesk-view" aria-label="Post view"><button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={16}/></button><button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={16}/></button></div>
    </div>
    {message && <div className="sdesk-message" role="status">{message}{canManage && /unconfirmed|could not be confirmed/.test(message) && <button className="btn btn-s" disabled={busy} onClick={() => void recover()}>Check the same save</button>}</div>}
    {canManage && pendingSocialDraft(tenantId) && <p className="sdesk-message">A draft save is unconfirmed. <button className="btn btn-s" disabled={busy} onClick={() => void recover()}>Check the same save</button></p>}
    {read.phase === "error" ? <div className="sdesk-empty"><h3>Your posts could not be read</h3><p>Check this workspace again before making another post.</p><button className="btn btn-s" onClick={refresh}>Try again</button></div>
    : !current ? <p role="status" className="sdesk-empty">Reading saved posts and their publication results…</p>
    : <div className={`sdesk-body${workspaceOpen && !minimized ? " sdesk-body--open" : ""}${expanded ? " sdesk-body--expanded" : ""}`}>
      <div className={`sdesk-gallery sdesk-gallery--${view}`}>
        {shown.map(post => <article key={post.key} className="sdesk-card" data-selected={selected?.key === post.key}>
          <header><div><strong>{post.destination || post.platform || "Destination not selected"}</strong><small>{time(post.updatedAt)}</small></div><span className="sdesk-status" data-state={post.status}>{status(post)}</span></header>
          <SocialMedia key={post.key} media={post.media} caption={post.caption} compact/>
          <button type="button" className="sdesk-card-open" onClick={e => open(post, e.currentTarget)}>{post.title}<ArrowRight size={16}/></button>
          {post.schedule && <p className="sdesk-note">{post.status === "scheduled"?"Scheduled: ":post.status === "cancelled"?"Stopped schedule: ":"Time needs a check: "}{socialScheduleLabel(post.schedule)}</p>}
          {post.receiptId && <>{post.status === "published" && <Performance post={post}/>} {post.url && <a className="sdesk-result-link" href={post.url} target="_blank" rel="noreferrer">View published result</a>}</>}
        </article>)}
        {!shown.length && <div className="sdesk-empty"><Image size={28}/><h3>{posts.length ? "No posts match these filters" : "Your next post starts here"}</h3><p>{posts.length ? "Change the filters or search to find a saved post." : canManage ? "Create a draft with your saved images, video or words. Review the exact connected account before publishing." : "No Social publication is visible to your workspace role. Saved drafts are visible to owners and admins."}</p>{canManage && !posts.length && <button className="btn btn-s" onClick={onOpenStudio}>Open Vibe Studio</button>}</div>}
      </div>
      {workspaceOpen && !minimized && <section className="sdesk-workspace" aria-labelledby="sdesk-workspace-title">
        <header><div><h3 id="sdesk-workspace-title" tabIndex={-1} ref={heading}>{creating ? "Create a post" : selected?.title ?? "Original post unavailable"}</h3><p>{dirty ? "Unsaved changes" : selected ? `${status(selected)} · ${time(selected.updatedAt)}` : "Draft"}</p></div>
          <div className="sdesk-window-actions"><button type="button" aria-label={expanded ? "Reduce workspace" : "Expand workspace"} onClick={() => setExpanded(v => !v)}>{expanded ? <Minimize2 size={16}/> : <Expand size={16}/>}</button><button type="button" aria-label="Minimize workspace" onClick={() => { setMinimized(true); opener.current?.focus(); }}><span aria-hidden="true">−</span></button><button type="button" aria-label="Close workspace" disabled={busy} onClick={close}><X size={17}/></button></div></header>
        <div className="sdesk-tabs" role="tablist" aria-label="Post workspace">{["post", "versions", "result"].map(name => <button type="button" key={name} id={`sdesk-tab-${name}`} role="tab" aria-selected={tab === name} aria-controls="sdesk-tab-panel" onClick={() => setTab(name)}>{name === "post" ? "Post" : name === "versions" ? "Versions" : selected?.schedule ? "Schedule & receipt" : "Result"}</button>)}</div>
        <div id="sdesk-tab-panel" role="tabpanel" aria-labelledby={`sdesk-tab-${tab}`}>
          {!creating && !selected ? <p>The original post is not available in this workspace. Check its link or reload.</p>
          : tab === "post" ? <>
            <SocialMedia key={selected?.key ?? "new"} media={editing ? draftMedia : selected?.media ?? []} caption={editing ? draft.caption : selected?.caption ?? ""}/>
            {editing && canManage ? <>
              <label className="sdesk-field">Title<input value={draft.title} maxLength={180} disabled={busy} onChange={e => edit({ title: e.target.value })}/></label>
              <label className="sdesk-field">Caption<textarea value={draft.caption} rows={5} maxLength={2200} disabled={busy} onChange={e => edit({ caption: e.target.value })}/></label>
              <details className="sdesk-asset-picker"><summary>Saved media · {draft.mediaIds.length} selected</summary><p>Choose in publication order. Threads accepts PNG/JPEG images and one MP4 video; other media formats are unavailable here.</p>
                {!!draft.mediaIds.length && <ol className="sdesk-media-order">{draft.mediaIds.map((id,index)=><li key={id}><span>{mediaLibrary.find(p=>p.id===id)?.title || "Saved media unavailable"}</span><button type="button" className="btn btn-s" disabled={busy||index===0} aria-label={`Move media ${index+1} earlier`} onClick={()=>{const ids=[...draft.mediaIds];[ids[index-1],ids[index]]=[ids[index],ids[index-1]];edit({mediaIds:ids});}}>Earlier</button><button type="button" className="btn btn-s" disabled={busy} aria-label={`Remove media ${index+1}`} onClick={()=>edit({mediaIds:draft.mediaIds.filter(x=>x!==id)})}>Remove</button></li>)}</ol>}
                <div>{mediaLibrary.map(asset => <label key={asset.id}><input type="checkbox" checked={draft.mediaIds.includes(asset.id)} disabled={busy || (!draft.mediaIds.includes(asset.id) && draft.mediaIds.length >= 20)} onChange={e => edit({ mediaIds: e.target.checked ? [...draft.mediaIds, asset.id] : draft.mediaIds.filter(id => id !== asset.id) })}/><span>{asset.title || "Saved media"}<small>{asset.kind}</small></span></label>)}</div>{!mediaLibrary.length && <button type="button" className="btn btn-s" onClick={onOpenStudio}>Make media in Vibe Studio</button>}</details>
              <div className="sdesk-editor-actions"><button type="button" className="btn btn-s sdesk-primary" disabled={busy || !draft.caption.trim() || (!dirty && !creating)} onClick={() => void save()}><Pencil size={14}/>{busy ? "Saving…" : "Save draft"}</button><button type="button" className="btn btn-s" onClick={onAskPaige}>Ask PAIGE</button></div>
              {!creating && original && !dirty && <PublishPiece key={`${original.id}:${original.updated_at}`} tenantId={tenantId} piece={original} captionReadOnly onPublicationRecorded={recorded}/>}
              {(creating || dirty) && <p className="sdesk-note">Save the draft to review its exact destination and publication preview.</p>}
            </> : <><p className="sdesk-caption">{selected?.caption}</p><p className="sdesk-note">This is the caption and media recorded for this original attempt.</p>{canManage && original?.channel === "social_post" && <button className="btn btn-s" onClick={()=>{navigate(original.id);setDirty(false);}}>Revise saved draft</button>}</>}
          </> : tab === "versions" ? <>
            <h4>Recorded publication versions</h4><p>Each attempt retains its original caption, media and receipt.</p><ul className="sdesk-version-list">{posts.filter(p => p.pieceId === pieceId).map(p => <li key={p.key}><button type="button" onClick={e => open(p, e.currentTarget)}>{status(p)} · {time(p.updatedAt)}</button></li>)}</ul>
            {!posts.some(p => p.pieceId === pieceId && p.receiptId) && <p>No publication version has been recorded yet.</p>}
          </> : selected?.receiptId ? <>
            <p className="sdesk-status" data-state={selected.status}>{status(selected)}</p><p>{selected.destination || selected.platform}</p>
            {selected.url && <a className="btn btn-s" href={selected.url} target="_blank" rel="noreferrer">View published result</a>}<Performance post={selected}/>
            {canManage && selected.status === "published" && <button type="button" className="btn btn-s" disabled={busy} onClick={()=>void checkPerformance()}>{busy ? "Checking…" : "Check performance"}</button>}
            <p className="sdesk-note">Receipt {selected.receiptId}</p>
            {selected.schedule && <p className="sdesk-note">{selected.status === "scheduled"?"Scheduled: ":selected.status === "cancelled"?"Stopped schedule: ":"Time needs a check: "}{socialScheduleLabel(selected.schedule)}</p>}
            {canManage && ["outcome_unknown", "publishing", "approved", "registered", "scheduled", "schedule_changing", "cancelled"].includes(selected.status) && <PublishPiece key={selected.receiptId} tenantId={tenantId} originalAttempt={{ contentId: selected.pieceId, publicationId: selected.receiptId }} onPublicationRecorded={recorded}/>}
          </> : <p>Save and publish an approved draft to see its original result here.</p>}
        </div>
      </section>}
    </div>}
    {workspaceOpen && minimized && <button type="button" className="sdesk-resume" ref={resume} onClick={() => setMinimized(false)}><Expand size={16}/>Reopen {creating ? "unsaved post" : selected?.title || "original post"}{dirty ? " · unsaved changes" : ""}</button>}
    {current && read.capped && <p className="sdesk-note">Showing the latest {SOCIAL_LIBRARY_LIMIT} library pieces and their referenced media. Original post links can reopen older pieces.</p>}
    <details className="sdesk-saved-plans" onToggle={event=>setPlansOpen(event.currentTarget.open)}>
      <summary>Saved plans</summary>
      {plansOpen&&<ContentCalendar tenantId={tenantId} onOpenPiece={id=>{
        if(busy||!UUID.test(id)||!leave())return;
        if(read.pieces.find(piece=>piece.id===id)?.channel!=="social_post"){
          if(account&&/^\d{1,20}$/.test(account))navigatePage(`/solo/${account}/growth/content?${new URLSearchParams({piece:id})}`);
          else setMessage("Open the original saved piece from this account’s Content library.");
          return;
        }
        setDirty(false);setMessage("");setMinimized(false);setTab("post");navigate(id);
      }}/>}
    </details>
    <p className="sdesk-note">Connections belong to this workspace. A matching handle in another workspace does not grant access here.</p>
  </section>;
}
