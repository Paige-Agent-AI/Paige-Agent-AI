// Marketing › Audience, Content, Email and Ads (owner ruling 2026-10-04: "these are the ones that I
// want dedicated to marketing"). Each is marked Planned in the tab strip because the feature the
// name promises is not built yet. Each tab still earns its place: it shows what this workspace
// really has today for that job, links to where it lives, and names what is missing in plain words.
//
// Reads (all tenant-scoped, read-only, existing tables and RPCs; nothing new on the server):
//   clients               lifecycle_stage, source, tags              (Audience)
//   marketing_content     saved drafts by channel (RLS: owner/admin/coach)  (Content, Email, Ads)
//   resolve_tenant_domain_identity()  the sending identity Settings shows    (Email)
// No segment, broadcast, ad-account or spend source exists; those stay "Not available yet".
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { getManagedIdentityPresentation } from "./settings-contract";

type Phase = "loading" | "ready" | "error";
type Read<T> = { phase: Phase; rows: T; retry: () => void };

/** A tenant-scoped read that ignores answers for a tenant the page has left. */
function useTenantRead<T>(tenantId: string | null, empty: T, load: (tenantId: string) => Promise<T>): Read<T> {
  const [state, setState] = React.useState<{ tenantId: string | null; phase: Phase; rows: T }>({ tenantId: null, phase: "loading", rows: empty });
  const [attempt, setAttempt] = React.useState(0);
  const loadRef = React.useRef(load);
  loadRef.current = load;
  React.useEffect(() => {
    if (!tenantId) return;
    let live = true;
    setState({ tenantId, phase: "loading", rows: empty });
    loadRef.current(tenantId)
      .then((rows) => { if (live) setState({ tenantId, phase: "ready", rows }); })
      .catch((error) => { console.error("[marketing] read failed", error); if (live) setState({ tenantId, phase: "error", rows: empty }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `empty` is a constant per call site
  }, [tenantId, attempt]);
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

type ContentRow = { id: string; kind: string; channel: string | null; title: string; updated_at: string };
const NO_CONTENT: ContentRow[] = [];
async function readContent(tenantId: string): Promise<ContentRow[]> {
  const { data, error } = await supabase.from("marketing_content" as never).select("id,kind,channel,title,updated_at").eq("tenant_id", tenantId).eq("status", "draft").order("updated_at", { ascending: false }).limit(60);
  if (error) throw error;
  return (data ?? []) as unknown as ContentRow[];
}

type Identity = { default_email_sender?: string | null; default_email_domain?: string | null; default_email_status?: string | null } | null;
async function readIdentity(): Promise<Identity> {
  // The RPC resolves the caller's own workspace server-side (the same read Settings › Connections makes).
  const { data, error } = await (supabase as unknown as { rpc: (name: string) => Promise<{ data: unknown; error: unknown }> }).rpc("resolve_tenant_domain_identity");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as Identity;
}

// Stage words for owners. A stage named for one vertical's outcome reads as a neutral outcome (§2).
const STAGE_LABEL: Record<string, string> = {
  new_lead: "New lead", qualified: "Qualified", nurturing: "Nurturing", hot_lead: "Hot lead", negotiating: "Negotiating",
  won: "Won", client_active: "Active client", client_paused: "Paused client", client_churned: "Former client",
  client_funded: "Outcome reached", client_alumni: "Alumni",
};
const SOURCE_LABEL: Record<string, string> = { paige_form: "Your forms", manual: "Added by hand", import: "Imported", paige: "Added by PAIGE", conversations: "From a conversation" };
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

function Frame({ phase, retry, noun, children }: { phase: Phase; retry: () => void; noun: string; children: React.ReactNode }) {
  if (phase === "loading") return <div className="campaigns-skeleton mp-skeleton" aria-busy="true" aria-label={`Loading ${noun}`}><span/><span/><span/></div>;
  if (phase === "error") return <div className="campaigns-state mp-state"><h3>{`Your ${noun} could not load`}</h3><p>Nothing was changed. Try again.</p><button className="btn btn-s" onClick={retry}>Try again</button></div>;
  return <>{children}</>;
}

/** The head every Planned tab shares: what the tab will be, and that it is not built yet. */
function PlannedHead({ title, promise, children }: { title: string; promise: string; children?: React.ReactNode }) {
  return <header className="mp-head">
    <div><h2>{title} <span className="mk-flag is-planned">Planned</span></h2><p>{promise}</p></div>
    {children && <div className="mp-head-actions">{children}</div>}
  </header>;
}

/** The honest list: each missing piece, why, and where things stand. */
function NotYet({ items }: { items: { title: string; detail: string }[] }) {
  return <section className="campaigns-surface mo-panel mp-notyet" aria-label="Not available yet">
    <div className="mo-panel-head"><div><h2>Not available yet</h2><p>What this tab will do once it is built. Nothing here is estimated.</p></div></div>
    <ul className="mp-list">{items.map((item) => <li key={item.title}><span className="mk-flag">Not available</span><span className="mp-list-main"><strong>{item.title}</strong><small>{item.detail}</small></span></li>)}</ul>
  </section>;
}

function Ranked({ rows, total, empty }: { rows: { key: string; label: string; count: number }[]; total: number; empty: string }) {
  if (!rows.length) return <p className="mo-note">{empty}</p>;
  const max = Math.max(...rows.map((row) => row.count));
  return <ol className="mo-rank mp-rank">{rows.map((row) => <li key={row.key}><span className="mp-rank-row"><span className="mo-rank-name">{row.label}</span><span className="mo-rank-bar" aria-hidden="true"><i style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }}/></span><b>{row.count}</b></span><span className="campaigns-sr-only">{` of ${total}`}</span></li>)}</ol>;
}

function DraftList({ rows, empty }: { rows: ContentRow[]; empty: string }) {
  if (!rows.length) return <p className="mo-note">{empty}</p>;
  return <ul className="mp-list">{rows.map((row) => <li key={row.id}><span className="mk-flag">{pieceLabel(pieceKey(row))}</span><span className="mp-list-main"><strong>{row.title || "Untitled"}</strong><small>Saved {formatDay(row.updated_at)}</small></span></li>)}</ul>;
}

export function MarketingAudience({ tenantId, onOpenClients }: { tenantId: string | null; onOpenClients: () => void }) {
  const read = useTenantRead(tenantId, NO_CONTACTS, readContacts);
  const rows = read.rows;
  const capped = rows.length >= CLIENT_READ_LIMIT;
  const count = (n: number) => (capped ? `${n}+` : String(n));
  const stages = tally(rows.map((row) => row.lifecycle_stage), (key) => STAGE_LABEL[key] ?? key.replace(/_/g, " "));
  const sources = tally(rows.map((row) => row.source), (key) => SOURCE_LABEL[key] ?? key.replace(/_/g, " "));
  const tags = tally(rows.flatMap((row) => row.tags ?? []), (key) => key).filter((row) => row.key !== "__none").slice(0, 10);
  const fromForms = rows.filter((row) => row.source === "paige_form").length;
  return <div className="mk-view mo mp">
    <PlannedHead title="Audience" promise="Who your marketing can reach: the contacts you already have, by stage, source and tag. Saved audiences you can target are planned.">
      <button className="btn btn-s" onClick={onOpenClients}>Open Clients</button>
    </PlannedHead>
    <Frame phase={read.phase} retry={read.retry} noun="contacts">
      {rows.length === 0 ? <section className="campaigns-surface"><div className="campaigns-state"><h2>No contacts yet</h2><p>Contacts arrive from your published forms and from Clients. Once you have some, this tab shows them by stage, source and tag.</p><button className="btn btn-s" onClick={onOpenClients}>Open Clients</button></div></section> : <>
        <dl className="mk-ledger">
          <div className="mk-stat"><dt>Contacts</dt><dd><strong>{count(rows.length)}</strong><span>{capped ? `Counted from the first ${CLIENT_READ_LIMIT}` : "Everyone in Clients"}</span></dd></div>
          <div className="mk-stat"><dt>From your forms</dt><dd><strong>{count(fromForms)}</strong><span>Created when someone submitted a form</span></dd></div>
          <div className="mk-stat"><dt>Stages in use</dt><dd><strong>{stages.filter((row) => row.key !== "__none").length}</strong><span>From new lead to alumni</span></dd></div>
          <div className="mk-stat"><dt>Tags in use</dt><dd><strong>{tags.length}</strong><span>{tags.length ? "Most used are listed below" : "No contact is tagged yet"}</span></dd></div>
        </dl>
        <div className="mo-grid mp-grid">
          <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>By stage</h2><p>Where each contact stands in your relationship with them.</p></div></div><Ranked rows={stages} total={rows.length} empty="No stages recorded."/></section>
          <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>Where they came from</h2><p>The source recorded on each contact.</p></div></div><Ranked rows={sources} total={rows.length} empty="No sources recorded."/></section>
          <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>Most used tags</h2><p>Tags are the closest thing to an audience today.</p></div></div><Ranked rows={tags} total={rows.length} empty="No contact carries a tag yet. Add tags in Clients to group people."/></section>
        </div>
      </>}
    </Frame>
    <NotYet items={[
      { title: "Saved audiences and segments", detail: "There is nowhere to save a group of contacts by rule yet, so campaigns cannot target one." },
      { title: "A contact's tracking tag", detail: "A lead's source tag stays on its form submission (see Analytics); it is not copied onto the contact yet." },
    ]}/>
  </div>;
}

export function MarketingContent({ tenantId, published, unpublished, onOpenCapture, studioLauncher }: { tenantId: string | null; published: { pages: number; funnels: number; forms: number }; unpublished: number; onOpenCapture: () => void; studioLauncher: React.ReactNode }) {
  const read = useTenantRead(tenantId, NO_CONTENT, readContent);
  const drafts = read.rows;
  const byChannel = tally(drafts.map(pieceKey), pieceLabel);
  const totalPublished = published.pages + published.funnels + published.forms;
  return <div className="mk-view mo mp">
    <PlannedHead title="Content" promise="Everything your marketing says, in one place: the images, documents and copy PAIGE made and saved, and the pages and forms you published. A content calendar is planned.">
      {studioLauncher}
    </PlannedHead>
    <dl className="mk-ledger">
      <div className="mk-stat"><dt>Saved drafts</dt><dd><strong>{read.phase === "ready" ? drafts.length : "…"}</strong><span>Images, documents and copy PAIGE saved</span></dd></div>
      <div className="mk-stat"><dt>Published pages and forms</dt><dd><strong>{totalPublished}</strong><span>{`${published.pages} pages · ${published.funnels} funnels · ${published.forms} forms`}</span></dd></div>
      <div className="mk-stat"><dt>Not published yet</dt><dd><strong>{unpublished}</strong><span>Built in Vibe Studio, collecting nothing</span></dd></div>
    </dl>
    <div className="mo-grid mp-grid mp-grid-2">
      <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>Saved drafts</h2><p>The newest first. They are drafts: nothing here has been posted or sent.</p></div></div>
        <Frame phase={read.phase} retry={read.retry} noun="saved drafts"><DraftList rows={drafts.slice(0, 12)} empty="Nothing saved yet. Ask PAIGE for an image, a document or copy, and it is kept here."/></Frame>
      </section>
      <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>By kind</h2><p>What your saved drafts are for.</p></div><button className="mo-link" onClick={onOpenCapture}>Published work</button></div>
        <Frame phase={read.phase} retry={read.retry} noun="saved drafts"><Ranked rows={byChannel} total={drafts.length} empty="No saved drafts to group yet."/></Frame>
      </section>
    </div>
    <NotYet items={[
      { title: "Content calendar", detail: "Briefs record timing as words, not dates, so nothing can be laid out on a calendar yet." },
      { title: "Posting and scheduling from here", detail: "Social posts are drafted with PAIGE and posted by you; scheduling is not connected." },
    ]}/>
  </div>;
}

export function MarketingEmail({ tenantId, onOpenConnections }: { tenantId: string | null; onOpenConnections: () => void }) {
  const identity = useTenantRead<Identity>(tenantId, null, () => readIdentity());
  const content = useTenantRead(tenantId, NO_CONTENT, readContent);
  const emails = content.rows.filter((row) => row.channel === "email_campaign");
  const id = identity.rows;
  // The same reading Settings › Connections gives this identity, so the two can never disagree (§57).
  const shown = getManagedIdentityPresentation({ identity: id, loading: false, error: null });
  const tone = { ok: "is-live", warn: "is-warn", bad: "is-blocked" }[shown.tone] ?? "";
  return <div className="mk-view mo mp">
    <PlannedHead title="Email" promise="Email to the people on your list: broadcasts, sequences and how they performed. Today Marketing can show who your email comes from and the email copy you saved.">
      <button className="btn btn-s" onClick={onOpenConnections}>Sending settings</button>
    </PlannedHead>
    <div className="mo-grid mp-grid mp-grid-2">
      <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>Who your email comes from</h2><p>The sending identity in Settings › Connections. It is used for the email PAIGE sends after you approve it.</p></div></div>
        <Frame phase={identity.phase} retry={identity.retry} noun="sending identity">
          {id?.default_email_sender || id?.default_email_domain ? <dl className="mp-facts">
            <div><dt>Sender</dt><dd>{id.default_email_sender || "Not set"}</dd></div>
            <div><dt>Domain</dt><dd>{id.default_email_domain || "Not set"}</dd></div>
            <div><dt>Status</dt><dd><span className={`mk-flag ${tone}`}>{shown.accountLabel}</span> <small>{shown.healthLabel}</small></dd></div>
          </dl> : <p className="mo-note">No sending identity is set up yet. Set one in Sending settings so email can come from your business.</p>}
        </Frame>
      </section>
      <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>Saved email copy</h2><p>Email copy PAIGE drafted and saved. Nothing here has been sent.</p></div></div>
        <Frame phase={content.phase} retry={content.retry} noun="saved email copy"><DraftList rows={emails.slice(0, 10)} empty="No email copy saved yet. Ask PAIGE to draft one."/></Frame>
      </section>
    </div>
    <NotYet items={[
      { title: "Broadcasts to a list", detail: "Nothing sends one email to many contacts from Marketing yet." },
      { title: "Sequences", detail: "Timed series of marketing emails are not built yet." },
      { title: "Opens, clicks and unsubscribes by campaign", detail: "Marketing email is not sent yet, so there is nothing to measure." },
    ]}/>
  </div>;
}

export function MarketingAds({ tenantId }: { tenantId: string | null }) {
  const content = useTenantRead(tenantId, NO_CONTENT, readContent);
  const ads = content.rows.filter((row) => row.channel === "ad_copy");
  return <div className="mk-view mo mp">
    <PlannedHead title="Ads" promise="Paid ads that bring people to your pages and forms: accounts, spend and what each campaign cost per lead. Today Marketing can show the ad copy you saved."/>
    <div className="mo-grid mp-grid mp-grid-2">
      <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>Saved ad copy</h2><p>Ad copy PAIGE drafted and saved. Nothing here has run.</p></div></div>
        <Frame phase={content.phase} retry={content.retry} noun="saved ad copy"><DraftList rows={ads.slice(0, 10)} empty="No ad copy saved yet. Ask PAIGE to draft some."/></Frame>
      </section>
      <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>Ad accounts</h2><p>The accounts your ads would run from.</p></div></div>
        <p className="mo-note">No ad account is connected to Marketing, so no spend, clicks or leads from ads are shown here, and none are estimated.</p>
      </section>
    </div>
    <NotYet items={[
      { title: "Connected ad accounts", detail: "No ad platform account is linked to Marketing." },
      { title: "Spend, cost per lead and return", detail: "With no account connected there is no spend to read, so none is shown or estimated." },
      { title: "Ads in a campaign brief", detail: "A brief can name ads as a channel and a budget target; that target is not spend." },
    ]}/>
  </div>;
}
