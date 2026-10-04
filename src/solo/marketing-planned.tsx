// Marketing › Audience, Content, Email and Ads (owner ruling 2026-10-04: "these are the ones that I
// want dedicated to marketing"). The feature each name promises is not built yet. Each tab still
// earns its place: it shows what this workspace
// really has today for that job, links to where it lives, and names what is missing in plain words.
//
// Reads (all tenant-scoped, read-only, existing tables and RPCs; nothing new on the server):
//   clients               lifecycle_stage, source, tags   (Audience; RLS may narrow it to assigned contacts)
//   marketing_content     the saved library, not archived (Content, Email, Ads). RLS: is_tenant_admin
//                         of the row's business, or the platform owner (20270542000000), which is the
//                         same test the briefs read reports as can_manage, so a member who cannot read
//                         it is told so rather than shown an empty library.
//   resolve_tenant_domain_identity()  the sending identity Settings shows (Email); the row must name
//                         the workspace on screen, or it is treated as unreadable.
// No segment, broadcast, ad-account or spend source exists; those stay "Not available".
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { getManagedIdentityPresentation } from "./settings-contract";
import { useSoloCampaignBriefs } from "./useSoloCampaignBriefs";

type Phase = "loading" | "ready" | "error";
type Read<T> = { phase: Phase; rows: T; retry: () => void };

/** A tenant-scoped read that ignores answers for a tenant the page has left. `load` null = not yet. */
function useTenantRead<T>(tenantId: string | null, empty: T, load: ((tenantId: string) => Promise<T>) | null): Read<T> {
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

const CLIENT_READ_LIMIT = 1000;
type ContactRow = { lifecycle_stage: string | null; source: string | null; tags: string[] | null };
const NO_CONTACTS: ContactRow[] = [];
async function readContacts(tenantId: string): Promise<ContactRow[]> {
  const { data, error } = await supabase.from("clients").select("lifecycle_stage,source,tags").eq("tenant_id", tenantId).limit(CLIENT_READ_LIMIT);
  if (error) throw error;
  return (data ?? []) as ContactRow[];
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
const readEmails = readLibrary("email_campaign");
const readAds = readLibrary("ad_copy");

type Identity = { tenant_id?: string | null; default_email_sender?: string | null; default_email_domain?: string | null; default_email_status?: string | null } | null;
async function readIdentity(tenantId: string): Promise<Identity> {
  // The RPC resolves the caller's own active workspace server-side (the same read Settings makes).
  const { data, error } = await (supabase as unknown as { rpc: (name: string) => Promise<{ data: unknown; error: unknown }> }).rpc("resolve_tenant_domain_identity");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Identity;
  // A row for a different workspace than the one on screen must not be shown as this one's.
  if (row?.tenant_id && row.tenant_id !== tenantId) throw new Error("The sending identity resolved for a different workspace.");
  return row ?? null;
}

// Stage words for owners. A stage named for one vertical's outcome reads as a neutral outcome (§2).
const STAGE_LABEL: Record<string, string> = {
  new_lead: "New lead", lead: "Lead", prospect: "Prospect", qualified: "Qualified", nurturing: "Nurturing", hot_lead: "Hot lead",
  negotiating: "Negotiating", won: "Won", customer: "Customer", active: "Active", client_active: "Active client",
  inactive: "Inactive", client_paused: "Paused client", churned: "Former client", client_churned: "Former client",
  client_funded: "Outcome reached", client_alumni: "Alumni",
};
const SOURCE_LABEL: Record<string, string> = {
  paige_form: "Your forms", manual: "Added by hand", import: "Imported", referral: "Referral",
  // `paige` is also the default when a tool creates a contact without naming a source.
  paige: "PAIGE or a connected tool", conversations: "From a conversation",
};
const CHANNEL_LABEL: Record<string, string> = {
  social_post: "Social post", ad_copy: "Ad copy", email_campaign: "Email", caption: "Caption", blog_outline: "Blog outline", sms_broadcast: "Text message",
};
// What a saved piece is. Images, video and documents carry no channel; copy is named by its channel.
const KIND_LABEL: Record<string, string> = { image: "Image", video: "Video", document: "Document" };
const pieceKey = (row: ContentRow) => (KIND_LABEL[row.kind] ? row.kind : row.channel || "text");
const pieceLabel = (key: string) => KIND_LABEL[key] ?? CHANNEL_LABEL[key] ?? (key === "text" ? "Copy" : key.replace(/_/g, " "));
const words = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");

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
function AskPaige({ label, prompt }: { label: string; prompt: string }) {
  return <button type="button" className="btn btn-s" onClick={() => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt } }))}>{label}</button>;
}

function Frame({ phase, retry, noun, children }: { phase: Phase; retry: () => void; noun: string; children: React.ReactNode }) {
  if (phase === "loading") return <div className="campaigns-skeleton mp-skeleton" role="status" aria-busy="true" aria-label={`Loading ${noun}`}><span/><span/><span/></div>;
  if (phase === "error") return <div className="campaigns-state mp-state"><h3>{`Your ${noun} could not load`}</h3><p>Nothing was changed. Try again.</p><button className="btn btn-s" onClick={retry}>Try again</button></div>;
  return <>{children}</>;
}

/** The tab's own acts, right-aligned above its panels. The tab strip already names the tab, so
 *  nothing here repeats its name or what it is for (owner, 2026-10-04: no redundant words). */
function TabActions({ children }: { children: React.ReactNode }) {
  return <div className="mp-actions">{children}</div>;
}

/** The honest list: each missing piece, and why. */
function NotYet({ items }: { items: { title: string; detail: string }[] }) {
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

export function MarketingAudience({ tenantId, onOpenClients }: { tenantId: string | null; onOpenClients: () => void }) {
  const read = useTenantRead(tenantId, NO_CONTACTS, readContacts);
  const rows = read.rows;
  const capped = rows.length >= CLIENT_READ_LIMIT;
  const stages = tally(rows.map((row) => row.lifecycle_stage), (key) => STAGE_LABEL[key] ?? words(key));
  const sources = tally(rows.map((row) => row.source), (key) => SOURCE_LABEL[key] ?? words(key));
  const allTags = tally(rows.flatMap((row) => row.tags ?? []), (key) => key).filter((row) => row.key !== "__none");
  const fromForms = rows.filter((row) => row.source === "paige_form").length;
  const recordedStages = stages.filter((row) => row.key !== "__none");
  return <div className="mk-view mo mp">
    <TabActions>
      <button className="btn btn-s" onClick={onOpenClients}>Open Clients</button>
    </TabActions>
    <Frame phase={read.phase} retry={read.retry} noun="contacts">
      {rows.length === 0 ? <section className="campaigns-surface"><div className="campaigns-state"><h2>No contacts yet</h2><p>Contacts arrive from your published forms and from Clients. Once you have some, this tab shows them by stage, source and tag.</p><button className="btn btn-s" onClick={onOpenClients}>Open Clients</button></div></section> : <>
        <dl className="mk-ledger">
          <div className="mk-stat"><dt>Contacts</dt><dd><strong>{floor(rows.length, capped)}</strong><span>{capped ? `Counted from the first ${CLIENT_READ_LIMIT}` : "All the contacts you can see"}</span></dd></div>
          <div className="mk-stat"><dt>From your forms</dt><dd><strong>{floor(fromForms, capped)}</strong><span>Created when someone submitted a form</span></dd></div>
          <div className="mk-stat"><dt>Stages in use</dt><dd><strong>{floor(recordedStages.length, capped)}</strong><span>{recordedStages[0] ? `The most common is ${recordedStages[0].label.toLowerCase()}` : "No stage recorded yet"}</span></dd></div>
          <div className="mk-stat"><dt>Tags in use</dt><dd><strong>{floor(allTags.length, capped)}</strong><span>{allTags.length ? (allTags.length > 10 ? "The ten most used are listed below" : "Listed below") : "No contact is tagged yet"}</span></dd></div>
        </dl>
        <div className="mo-grid mp-grid">
          <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>By stage</h2><p>Where each contact stands with you.</p></div></div><Ranked rows={stages} total={rows.length} empty="No stages recorded."/></section>
          <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>Where they came from</h2><p>The source recorded on each contact.</p></div></div><Ranked rows={sources} total={rows.length} empty="No sources recorded."/></section>
          <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>Most used tags</h2><p>Tags are the closest thing to an audience today.</p></div></div><Ranked rows={allTags.slice(0, 10)} total={rows.length} empty="No contact carries a tag yet. Add tags in Clients to group people."/></section>
        </div>
      </>}
    </Frame>
    <NotYet items={[
      { title: "Saved audiences and segments", detail: "There is nowhere to save a group of contacts by rule yet, so campaigns cannot target one." },
      { title: "A contact's tracking tag", detail: "A lead's source tag stays on its form submission (see Analytics); it is not copied onto the contact yet." },
    ]}/>
  </div>;
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
  const ask = <AskPaige label="Ask PAIGE for content" prompt="Help me make a piece of marketing content for my business. Ask me what it is for and who it is for before you draft it. Save it as a draft; do not post or send anything."/>;
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

export function MarketingEmail({ tenantId, onOpenConnections }: { tenantId: string | null; onOpenConnections: (() => void) | null }) {
  const access = useLibraryAccess();
  const identity = useTenantRead<Identity>(tenantId, null, readIdentity);
  const content = useTenantRead(tenantId, NO_CONTENT, access === "allowed" ? readEmails : null);
  const id = identity.rows;
  // The same reading Settings › Connections gives this identity, so the two can never disagree (§57).
  const shown = getManagedIdentityPresentation({ identity: id, loading: false, error: null });
  const tone = { ok: "is-live", warn: "is-warn", bad: "is-blocked" }[shown.tone] ?? "";
  const libraryPhase = libraryPhaseFor(access, content.phase);
  const ask = <AskPaige label="Ask PAIGE to draft an email" prompt="Draft a marketing email for my business. Ask me who it is for and what it should say before you write it. Save it as a draft; do not send anything."/>;
  return <div className="mk-view mo mp">
    <TabActions>
      {ask}
      {onOpenConnections && <button className="btn btn-s" onClick={onOpenConnections}>Sending settings</button>}
    </TabActions>
    <div className="mo-grid mp-grid mp-grid-2">
      <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>Who your email comes from</h2><p>The sending identity set in Settings › Connections.</p></div></div>
        <Frame phase={identity.phase} retry={identity.retry} noun="sending identity">
          {id?.default_email_sender || id?.default_email_domain ? <dl className="mp-facts">
            <div><dt>Sender</dt><dd>{id.default_email_sender || "Not set"}</dd></div>
            <div><dt>Domain</dt><dd>{id.default_email_domain || "Not set"}</dd></div>
            <div><dt>Status</dt><dd><span className={`mk-flag ${tone}`}>{shown.accountLabel}</span> <small>{shown.healthLabel}</small></dd></div>
          </dl> : <p className="mo-note">No sending identity is set up yet. Set one in Sending settings so email can come from your business.</p>}
        </Frame>
      </section>
      <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>Saved email copy</h2><p>Email drafts in your library. Nothing here has been sent.</p></div></div>
        <Frame phase={libraryPhase} retry={content.retry} noun="saved email copy">{access === "denied" ? <p className="mo-note">{LIBRARY_DENIED}</p> : <LibraryList rows={content.rows.slice(0, 10)} empty={<><p className="mo-note">No email copy saved yet.</p>{ask}</>}/>}</Frame>
      </section>
    </div>
    <NotYet items={[
      { title: "Broadcasts to a list", detail: "Nothing sends one email to many contacts from Marketing yet." },
      { title: "Sequences", detail: "Timed series of marketing emails are not built yet." },
      { title: "Opens, clicks and unsubscribes by campaign", detail: "Marketing email is not sent yet, so there is nothing to measure." },
    ]}/>
  </div>;
}

export function MarketingAds({ tenantId, onOpenIntegrations }: { tenantId: string | null; onOpenIntegrations: (() => void) | null }) {
  const access = useLibraryAccess();
  const content = useTenantRead(tenantId, NO_CONTENT, access === "allowed" ? readAds : null);
  const libraryPhase = libraryPhaseFor(access, content.phase);
  const ask = <AskPaige label="Ask PAIGE to draft ad copy" prompt="Draft ad copy for my business. Ask me what I am promoting, who it is for and where it will run before you write it. Save it as a draft; do not run or publish anything."/>;
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
