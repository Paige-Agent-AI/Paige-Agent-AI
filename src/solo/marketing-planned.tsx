// Marketing › Content and Ads (owner ruling 2026-10-04: "these are the ones that I
// want dedicated to marketing"). The feature each name promises is not built yet. Each tab still
// earns its place: it shows what this workspace
// really has today for that job, links to where it lives, and names what is missing in plain words.
//
// Audience lives in marketing-audience.tsx; Email in marketing-email.tsx. These shared helpers
// (useTenantRead, Frame, TabActions, AskPaigeButton) serve all of them.
// Reads (all tenant-scoped, read-only, existing tables and RPCs; nothing new on the server):
//   marketing_content     the saved library, not archived (Content, Ads; email copy shows under Content). RLS: is_tenant_admin
//                         of the row's business, or the platform owner (20270542000000), which is the
//                         same test the briefs read reports as can_manage, so a member who cannot read
//                         it is told so rather than shown an empty library.
// No segment, broadcast, ad-account or spend source exists; those stay "Not available".
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSoloCampaignBriefs } from "./useSoloCampaignBriefs";

export type Phase = "loading" | "ready" | "error";
type Read<T> = { phase: Phase; rows: T; retry: () => void };

/** A tenant-scoped read that ignores answers for a tenant the page has left. `load` null = not yet. */
export function useTenantRead<T>(tenantId: string | null, empty: T, load: ((tenantId: string) => Promise<T>) | null): Read<T> {
  const [state, setState] = React.useState<{ tenantId: string | null; phase: Phase; rows: T }>({ tenantId: null, phase: "loading", rows: empty });
  const [attempt, setAttempt] = React.useState(0);
  const loadRef = React.useRef(load);
  loadRef.current = load;
  const enabled = Boolean(load);
  React.useEffect(() => {
    if (!tenantId || !loadRef.current) return;
    let live = true;
    setState({ tenantId, phase: "loading", rows: empty });
    loadRef.current(tenantId)
      .then((rows) => { if (live) setState({ tenantId, phase: "ready", rows }); })
      .catch((error) => { console.error("[marketing] read failed", error); if (live) setState({ tenantId, phase: "error", rows: empty }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `empty` is a constant per call site
  }, [tenantId, attempt, enabled]);
  const current = state.tenantId === tenantId;
  return { phase: current ? state.phase : "loading", rows: current ? state.rows : empty, retry: () => setAttempt((n) => n + 1) };
}

const LIBRARY_READ_LIMIT = 60;
type ContentRow = { id: string; kind: string; channel: string | null; status: string; title: string; updated_at: string };
const NO_CONTENT: ContentRow[] = [];
/** The newest saved pieces, or only one channel's, filtered on the server so a cap never hides a channel. */
const readLibrary = (channel?: string) => async (tenantId: string): Promise<ContentRow[]> => {
  let query = supabase.from("marketing_content" as never).select("id,kind,channel,status,title,updated_at").eq("tenant_id", tenantId).neq("status", "archived");
  if (channel) query = query.eq("channel", channel);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(LIBRARY_READ_LIMIT);
  if (error) throw error;
  return (data ?? []) as unknown as ContentRow[];
};
const readAll = readLibrary();
const readAds = readLibrary("ad_copy");

const CHANNEL_LABEL: Record<string, string> = {
  social_post: "Social post", ad_copy: "Ad copy", email_campaign: "Email", caption: "Caption", blog_outline: "Blog outline", sms_broadcast: "Text message",
};
// What a saved piece is. Images, video and documents carry no channel; copy is named by its channel.
const KIND_LABEL: Record<string, string> = { image: "Image", video: "Video", document: "Document" };
const pieceKey = (row: ContentRow) => (KIND_LABEL[row.kind] ? row.kind : row.channel || "text");
const pieceLabel = (key: string) => KIND_LABEL[key] ?? CHANNEL_LABEL[key] ?? (key === "text" ? "Copy" : key.replace(/_/g, " "));

function tally(values: (string | null | undefined)[], label: (value: string) => string) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value?.trim() || "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, count]) => ({ key: key || "__none", label: key ? label(key) : "Not recorded", count }));
}

const formatDay = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; };
/** A count from a capped read is a floor, never a total. */
const floor = (n: number, capped: boolean) => (capped ? `${n}+` : String(n));

/** Opens PAIGE with a question in her composer. She drafts; nothing is sent until the owner says so. */
export function AskPaigeButton({ label, prompt }: { label: string; prompt: string }) {
  return <button type="button" className="btn btn-s" onClick={() => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt } }))}>{label}</button>;
}

export function Frame({ phase, retry, noun, children }: { phase: Phase; retry: () => void; noun: string; children: React.ReactNode }) {
  if (phase === "loading") return <div className="campaigns-skeleton mp-skeleton" role="status" aria-busy="true" aria-label={`Loading ${noun}`}><span/><span/><span/></div>;
  if (phase === "error") return <div className="campaigns-state mp-state"><h3>{`Your ${noun} could not load`}</h3><p>Nothing was changed. Try again.</p><button className="btn btn-s" onClick={retry}>Try again</button></div>;
  return <>{children}</>;
}

/** The tab's own acts, right-aligned above its panels. The tab strip already names the tab, so
 *  nothing here repeats its name or what it is for (owner, 2026-10-04: no redundant words). */
export function TabActions({ children }: { children: React.ReactNode }) {
  return <div className="mp-actions">{children}</div>;
}

/** The honest list: each missing piece, and why. */
export function NotYet({ items }: { items: { title: string; detail: string }[] }) {
  return <section className="campaigns-surface mo-panel mp-notyet" aria-label="Not available yet">
    <div className="mo-panel-head"><div><h2>Not available yet</h2><p>What this tab will do once it is built. Nothing here is estimated.</p></div></div>
    <ul className="mp-list">{items.map((item) => <li key={item.title}><span className="mp-list-main"><strong>{item.title}</strong><small>{item.detail}</small></span></li>)}</ul>
  </section>;
}

function Ranked({ rows, total, empty }: { rows: { key: string; label: string; count: number }[]; total: number; empty: string }) {
  if (!rows.length) return <p className="mo-note">{empty}</p>;
  const max = Math.max(...rows.map((row) => row.count));
  return <ol className="mo-rank mp-rank">{rows.map((row) => <li key={row.key}><span className="mp-rank-row"><span className="mo-rank-name">{row.label}</span><span className="mo-rank-bar" aria-hidden="true"><i style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }}/></span><b>{row.count}</b></span><span className="campaigns-sr-only">{` of ${total}`}</span></li>)}</ol>;
}

function LibraryList({ rows, empty }: { rows: ContentRow[]; empty: React.ReactNode }) {
  if (!rows.length) return <div className="mp-empty">{empty}</div>;
  return <ul className="mp-list">{rows.map((row) => <li key={row.id}><span className="mk-flag">{pieceLabel(pieceKey(row))}</span><span className="mp-list-main"><strong>{row.title || "Untitled"}</strong><small>{row.status === "published" ? "Published" : "Draft"} · saved {formatDay(row.updated_at)}</small></span></li>)}</ul>;
}

/** Who may read the saved library: admins of this workspace (the same test its read policy applies). */
function useLibraryAccess(): "checking" | "allowed" | "denied" {
  const briefs = useSoloCampaignBriefs();
  if (briefs.phase === "ready") return briefs.canManage ? "allowed" : "denied";
  // If the briefs read fails, still try the library; its own error state then speaks for it.
  return briefs.phase === "error" || briefs.phase === "unavailable" ? "allowed" : "checking";
}

const LIBRARY_DENIED = "Your workspace's saved library is visible to its owners and admins.";

function libraryPhaseFor(access: ReturnType<typeof useLibraryAccess>, phase: Phase): Phase {
  return access === "denied" ? "ready" : access === "checking" ? "loading" : phase;
}

export type PublishedWork = { phase: string; pages: number; funnels: number; forms: number; unpublished: number };

export function MarketingContent({ tenantId, published, onOpenCapture, onRetryPublished, studioLauncher }: { tenantId: string | null; published: PublishedWork; onOpenCapture: () => void; onRetryPublished: () => void; studioLauncher: React.ReactNode }) {
  const access = useLibraryAccess();
  const read = useTenantRead(tenantId, NO_CONTENT, access === "allowed" ? readAll : null);
  const pieces = read.rows;
  const capped = pieces.length >= LIBRARY_READ_LIMIT;
  const byKind = tally(pieces.map(pieceKey), pieceLabel);
  const libraryPhase = libraryPhaseFor(access, read.phase);
  const publishedReady = published.phase === "ready";
  const publishedFailed = published.phase === "error" || published.phase === "unavailable";
  const publishedValue = (n: number) => (publishedReady ? String(n) : publishedFailed ? "—" : "…");
  const total = published.pages + published.funnels + published.forms;
  const libraryCount = access === "denied" || libraryPhase === "error" ? "—" : libraryPhase === "ready" ? floor(pieces.length, capped) : "…";
  const ask = <AskPaigeButton label="Ask PAIGE for content" prompt="Help me make a piece of marketing content for my business. Ask me what it is for and who it is for before you draft it. Save it as a draft; do not post or send anything."/>;
  return <div className="mk-view mo mp">
    <TabActions>
      {ask}{studioLauncher}
    </TabActions>
    <dl className="mk-ledger mp-ledger-3">
      <div className="mk-stat"><dt>In your library</dt><dd><strong>{libraryCount}</strong><span>{access === "denied" ? "Visible to owners and admins" : capped ? `The newest ${LIBRARY_READ_LIMIT} are counted` : "Images, documents and copy, not archived"}</span></dd></div>
      <div className="mk-stat"><dt>Published</dt><dd><strong>{publishedValue(total)}</strong><span>{publishedReady ? [[published.pages, "page"], [published.funnels, "funnel"], [published.forms, "form"]].map(([n, noun]) => `${n} ${noun}${n === 1 ? "" : "s"}`).join(" · ") : publishedFailed ? "Could not load" : "Loading"}</span></dd></div>
      <div className="mk-stat"><dt>Not published yet</dt><dd><strong>{publishedValue(published.unpublished)}</strong><span>Built in Vibe Studio, collecting nothing</span></dd></div>
    </dl>
    {publishedFailed && <p className="mo-note mp-inline-note">Your published pages, funnels and forms could not load. <button className="mo-link" onClick={onRetryPublished}>Try again</button></p>}
    <div className="mo-grid mp-grid mp-grid-2">
      <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>Your library</h2><p>Newest first. Drafts have not been posted or sent anywhere.</p></div></div>
        <Frame phase={libraryPhase} retry={read.retry} noun="library">{access === "denied" ? <p className="mo-note">{LIBRARY_DENIED}</p> : <LibraryList rows={pieces.slice(0, 12)} empty={<><p className="mo-note">Nothing saved yet. Ask PAIGE for an image, a document or copy, and it is kept here.</p>{ask}</>}/>}</Frame>
      </section>
      <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>By kind</h2><p>What your saved pieces are.</p></div><button className="mo-link" onClick={onOpenCapture}>Published work</button></div>
        <Frame phase={libraryPhase} retry={read.retry} noun="library">{access === "denied" ? <p className="mo-note">{LIBRARY_DENIED}</p> : <Ranked rows={byKind} total={pieces.length} empty="Nothing saved to group yet."/>}</Frame>
      </section>
    </div>
    <NotYet items={[
      { title: "Content calendar", detail: "Briefs record timing as words, not dates, so nothing can be laid out on a calendar yet." },
      { title: "Posting and scheduling from here", detail: "Posts are drafted with PAIGE and posted by you; scheduling is not connected." },
    ]}/>
  </div>;
}

export function MarketingAds({ tenantId, onOpenIntegrations }: { tenantId: string | null; onOpenIntegrations: (() => void) | null }) {
  const access = useLibraryAccess();
  const content = useTenantRead(tenantId, NO_CONTENT, access === "allowed" ? readAds : null);
  const libraryPhase = libraryPhaseFor(access, content.phase);
  const ask = <AskPaigeButton label="Ask PAIGE to draft ad copy" prompt="Draft ad copy for my business. Ask me what I am promoting, who it is for and where it will run before you write it. Save it as a draft; do not run or publish anything."/>;
  return <div className="mk-view mo mp">
    <TabActions>
      {ask}
      {onOpenIntegrations && <button className="btn btn-s" onClick={onOpenIntegrations}>Open Integrations</button>}
    </TabActions>
    <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>Saved ad copy</h2><p>Ad drafts in your library. Nothing here has run.</p></div></div>
      <Frame phase={libraryPhase} retry={content.retry} noun="saved ad copy">{access === "denied" ? <p className="mo-note">{LIBRARY_DENIED}</p> : <LibraryList rows={content.rows.slice(0, 10)} empty={<><p className="mo-note">No ad copy saved yet.</p>{ask}</>}/>}</Frame>
    </section>
    <NotYet items={[
      { title: "Ad accounts in Marketing", detail: "Connecting an ad platform in Settings › Integrations gives PAIGE tools for it in chat. Marketing does not read an ad account yet." },
      { title: "Spend, cost per lead and return", detail: "With no ad account read here, there is no spend to show." },
      { title: "Ads in a campaign brief", detail: "A brief can name ads as a channel and a budget target; that target is not spend." },
    ]}/>
  </div>;
}
