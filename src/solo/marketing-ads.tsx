// The Ads desk (INT-342 S1c, owner-approved prototype v2, 2026-10-10; owner ruling the same day: "Desk now,
// Meta read next"). docs/product/int342-marketing-convergence.md §G/§K. Mounted by its own department since
// 2026-10-10 (src/solo/AdsWorkspace.tsx, directly below Marketing); it was Marketing's Ads tab before.
//
// The paid-acquisition desk, built before any ad platform can be read. Paige cannot read an ad account yet
// (connecting Meta or Metricool in Integrations does not change that), so every provider figure (spend, impressions, clicks, cost per
// lead, return) is shown as not available, never as zero or an estimate. What IS real is shown in full:
//   marketing_content (channel ad_copy, not archived)  saved ad copy, previewed as an ad would read it;
//                                                      owners and admins only (its RLS), members are told so
//   campaign briefs (useSoloCampaignBriefs)            a budget the owner wrote in a brief, quoted verbatim
//                                                      as a plan, never as spend
//   marketing_content (kind image | video)             the business's own pictures and videos: the
//                                                      showroom's pictures (owners and admins, its RLS)
//   get_pipeline_lead_funnel                           leads by Sales pipeline stage per campaign tag
//                                                      and per ad tag (pipeline-lead-funnel.tsx)
// Writes, each through an existing or contracted seam, owners and admins only:
//   uploadToLibrary (studio.ts)                        "Add a picture or video": files into the library
//   set_ad_creative_featured                           "Feature in showroom" (meta.ads_featured, max 6)
// "Copy tagged link" joins a picture's tag onto one of the business's live pages or forms, read by the
// same Marketing read that lists them (useSoloCampaigns), only while the owner is choosing one.
// The server functions above ship before this page; if they turn out not to be deployed
// (ads-intake-capability.ts), "Feature in showroom" is withdrawn rather than offered to fail.
// Nothing on this page runs, pauses, pays for or publishes anything.
import React from "react";
import { Copy, Link2, Star, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { uploadToLibrary } from "@/components/admin/studio/studio";
import { GROWTH_MEDIA_ACCEPT } from "@/lib/growth";
import { useSoloCampaignBriefs } from "./useSoloCampaignBriefs";
import { useSoloCampaigns } from "./useSoloCampaigns";
import { AskPaigeButton, LIBRARY_DENIED, useLibraryAccess, useTenantRead } from "./marketing-planned";
import { safeMediaUrl } from "./marketing-content-model";
import { FEATURED_LIMIT, deriveLeadFunnel, isFeatured, isMissingFunction, pipelineChoices, rankShowroomMedia, taggedLink, trackingTag, type FunnelSubmission, type MediaRow, type ShowroomPick } from "./ads-model";
import { noteAdsIntakeAnswer, useAdsIntakeCapability } from "./ads-intake-capability";
import { LeadFunnelPanel, sinceFor, useLeadFunnel, type AdName, type FunnelFallback, type PipelineChoice } from "./pipeline-lead-funnel";
import "./marketing-overview.css";
import "./marketing-ads.css";
import { ChannelShelf, Showroom, type ShowroomMedia } from "./ads-showroom";

export const ADS_VIEWS = [
  { key: "overview", label: "Overview" },
  { key: "campaigns", label: "Campaigns" },
  { key: "creative", label: "Creative" },
  { key: "audiences", label: "Audiences" },
  { key: "performance", label: "Performance" },
] as const;
export type AdsView = (typeof ADS_VIEWS)[number]["key"];
export const adsViewOf = (value: string | null | undefined): AdsView => ADS_VIEWS.find((view) => view.key === value)?.key ?? "overview";

const AD_READ_LIMIT = 24;
export type AdCopyRow = { id: string; title: string; body: string | null; status: string; updated_at: string };
const NO_ADS: AdCopyRow[] = [];
const readAdCopy = async (tenantId: string): Promise<AdCopyRow[]> => {
  const { data, error } = await supabase.from("marketing_content" as never).select("id,title,body,status,updated_at")
    .eq("tenant_id", tenantId).eq("channel", "ad_copy").neq("status", "archived")
    .order("updated_at", { ascending: false }).limit(AD_READ_LIMIT);
  if (error) throw error;
  return (data ?? []) as unknown as AdCopyRow[];
};

/** PAIGE writes ad copy as labelled parts (content-draft asks for a headline, primary text and a call to
 *  action), but the chat model's formatting varies: markdown headings, list markers, bold or italic labels,
 *  a label alone on its line, a dash or colon. A label is read only where it opens a line; everything else
 *  stays as written. Words after a one-line call to action go back to the primary text, so a preview never
 *  drops or misplaces them. */
export function parseAdCopy(body: string | null | undefined): { headline: string | null; primary: string; cta: string | null } {
  const text = (body ?? "").replace(/\r/g, "").trim();
  // Labels: headline, primary text, call to action / CTA. A bare "body" or "text" counts only with a colon.
  const label = /^(headline|primary[ -]text|cta|call[- ]to[- ]action|body(?=\s*:)|text(?=\s*:))\s*(?::|[-–—](?=\s)|$)\s*/i;
  const parts: Record<"headline" | "primary" | "cta", string[]> = { headline: [], primary: [], cta: [] };
  let current: "headline" | "primary" | "cta" = "primary";
  for (const raw of text.split("\n")) {
    // Markdown dressing around a label: "## ", "- ", "• ", "**", "__", "*".
    const line = raw.trim().replace(/^#+\s*/, "").replace(/^[-*•]\s+/, "");
    const bare = line.replace(/^(\*\*|__|\*|_)(.+?)\1/, "$2");
    const match = bare.match(label);
    if (match) {
      const key = match[1].toLowerCase().replace(/[- ]/g, "");
      current = key === "headline" ? "headline" : key === "cta" || key === "calltoaction" ? "cta" : "primary";
      const rest = bare.slice(match[0].length).replace(/^(\*\*|__)\s*/, "").trim();
      if (rest) parts[current].push(rest);
      continue;
    }
    if (!line) continue;
    // A call to action is one line: anything after it belongs to the body.
    if (current === "cta" && parts.cta.length) current = "primary";
    parts[current].push(line);
  }
  const join = (lines: string[]) => lines.join(" ").replace(/\*\*|__/g, "").replace(/^["“]|["”]$/g, "").trim();
  return { headline: join(parts.headline) || null, primary: join(parts.primary), cta: join(parts.cta) || null };
}

// The business's own pictures and videos, newest first. Owners and admins only (the library's RLS).
const MEDIA_READ_LIMIT = 48;
const NO_MEDIA: MediaRow[] = [];
const readMedia = async (tenantId: string): Promise<MediaRow[]> => {
  const { data, error } = await supabase.from("marketing_content" as never).select("id,kind,title,image_url,updated_at,meta")
    .eq("tenant_id", tenantId).in("kind", ["image", "video"]).neq("status", "archived")
    .order("updated_at", { ascending: false }).limit(MEDIA_READ_LIMIT);
  if (error) throw error;
  return ((data ?? []) as unknown as MediaRow[]).filter((row) => row.kind === "image" || row.kind === "video");
};

// The records fallback for the lead funnel: the latest submissions in the window, with their link tags.
const FUNNEL_RECORD_LIMIT = 200;
const utm = (json: unknown, key: string) => { const value = json && typeof json === "object" ? (json as Record<string, unknown>)[key] : null; return typeof value === "string" && value.trim() ? value.trim() : null; };
async function readFunnelSubmissions(tenantId: string, since: string | null): Promise<{ rows: FunnelSubmission[]; capped: boolean }> {
  let query = supabase.from("growth_form_submissions" as never).select("id,created_at,deal_id,utm_json").eq("tenant_id", tenantId);
  if (since) query = query.gte("created_at", since);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(FUNNEL_RECORD_LIMIT);
  if (error) throw error;
  const rows = ((data ?? []) as unknown as { created_at: string; deal_id: string | null; utm_json: unknown }[])
    .map((row) => ({ createdAt: row.created_at, dealId: row.deal_id, campaign: utm(row.utm_json, "utm_campaign"), ad: utm(row.utm_json, "utm_content") }));
  return { rows, capped: rows.length >= FUNNEL_RECORD_LIMIT };
}

const PERIODS = [{ key: "30", label: "30 days", days: 30 }, { key: "90", label: "90 days", days: 90 }, { key: "all", label: "All time", days: null }] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];
const periodWords = (days: number | null) => (days ? `in the last ${days} days` : "so far");

const formatDay = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; };
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
export const ADS_ASK_PROMPT = "Draft ad copy for my business. Ask me what I am promoting, who it is for and where it will run before you write it. Give it a headline, primary text and a call to action, and save it as a draft; do not run or publish anything.";

export type MarketingAdsProps = {
  businessName?: string | null;
  tenantId: string | null;
  view: AdsView;
  onView: (view: AdsView) => void;
  onOpenIntegrations: (() => void) | null;
  onOpenAudience: () => void;
  onOpenAnalytics: () => void;
  onOpenCampaigns: () => void;
  onOpenSales?: (() => void) | null;
  /** Marketing's list of forms and where each sends its leads. */
  onOpenFormRouting?: (() => void) | null;
};

export function MarketingAds({ tenantId, businessName, view, onView, onOpenIntegrations, onOpenAudience, onOpenAnalytics, onOpenCampaigns, onOpenSales, onOpenFormRouting }: MarketingAdsProps) {
  const access = useLibraryAccess();
  const ads = useTenantRead(tenantId, NO_ADS, access === "allowed" ? readAdCopy : null);
  const library = useMediaLibrary(tenantId, access === "allowed");
  const briefs = useSoloCampaignBriefs();
  const adsPhase = access === "denied" ? "ready" : access === "checking" ? "loading" : ads.phase;
  const count = ads.rows.length;
  const countText = count >= AD_READ_LIMIT ? `${count}+` : String(count);
  const drafts = access === "denied" ? <>Saved ad copy is visible to owners and admins.</>
    : adsPhase === "loading" ? <>Reading your saved ad copy…</>
    : adsPhase === "error" ? <>Your saved ad copy could not load.</>
    : count ? <><b>{countText} ad copy {count === 1 ? "draft" : "drafts"}</b> ready.</> : <>No ad copy saved yet.</>;
  const plans = briefs.phase === "ready" ? (briefs.briefs ?? []).filter((brief) => brief.budgetTarget && !["archived", "completed"].includes(brief.lifecycleStatus)) : [];

  return <div className="mov mad">
    <div className="mov-top">
      <p className="mov-sum" tabIndex={-1}>Paige can’t read an ad account yet, so nothing here is estimated. {drafts}</p>
    </div>
    {view === "overview" && <OverviewStage tenantId={tenantId} brand={businessName || "Your business"} access={access} library={library}
      copyRow={access === "allowed" && adsPhase === "ready" ? ads.rows[0] ?? null : null} copyCount={count} onCreative={() => onView("creative")} onOpenSales={onOpenSales ?? null} onOpenRouting={onOpenFormRouting ?? null}/>}
    <section className="mov-card mad-prov" aria-label="Ad account">
      <span className="mad-logo" aria-hidden="true"><PlugIcon/></span>
      <div className="mad-prov-b"><strong>No ad account is read here</strong><small>Campaigns, spend and results from Meta, Google, LinkedIn, TikTok or YouTube can’t be read yet, even with an account connected in Integrations.</small></div>
      <span className="pill pill-n">Not read yet</span>
      {onOpenIntegrations && <button type="button" className="btn btn-s" onClick={onOpenIntegrations}>Open Integrations</button>}
    </section>
    {view === "overview" && <ChannelShelf/>}
    {view === "overview" && <Overview drafts={drafts} adsPhase={adsPhase} count={count} access={access} plans={plans} briefsPhase={briefs.phase} onCreative={() => onView("creative")} newest={access === "allowed" && adsPhase === "ready" ? ads.rows.slice(0, 3) : []} onRetry={ads.retry}/>}
    {view === "campaigns" && <section className="mov-card"><div className="mad-empty"><h2>No ad campaigns to show.</h2><p>Ad campaigns run inside the ad platform. Once Paige can read an ad account they appear here, next to the brief each one serves.</p><button type="button" className="mov-lnk" onClick={onOpenCampaigns}>Open your campaign briefs</button></div></section>}
    {view === "creative" && <Creative access={access} phase={adsPhase} rows={ads.rows} retry={ads.retry} library={library}/>}
    {view === "audiences" && <section className="mov-card"><div className="mad-empty"><h2>Audiences</h2><p>Shown only when an ad platform shares them, and Paige can’t read one yet.</p><p>Your own people live in Clients, and Audience shows who you can reach.</p><button type="button" className="mov-lnk" onClick={onOpenAudience}>Open Audience</button></div></section>}
    {view === "performance" && <Performance onOpenAnalytics={onOpenAnalytics}/>}
  </div>;
}

function PlugIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8ZM12 18v4"/></svg>;
}

type Plan = { id: string; name: string; budgetTarget: string | null; lifecycleStatus: string };
const BRIEF_STATE: Record<string, string> = { active: "running", approved: "approved", paused: "paused", ready_for_review: "awaiting review", blocked: "blocked", draft: "draft" };

function Overview({ drafts, adsPhase, count, access, plans, briefsPhase, onCreative, newest, onRetry }: { drafts: React.ReactNode; adsPhase: string; count: number; access: string; plans: Plan[]; briefsPhase: string; onCreative: () => void; newest: AdCopyRow[]; onRetry: () => void }) {
  return <>
    <section className="mov-card mad-pace" aria-labelledby="mad-pace-h">
      <header className="mov-head"><div><h2 id="mad-pace-h">Spend this month</h2><p>What you’ll see once Paige can read an ad account</p></div><span className="pill pill-n">Not read yet</span></header>
      <div className="mad-pace-b">
        <dl className="mad-nums">
          <div><dt>Actual spend</dt><dd>—</dd></div>
          <div><dt>Provider budget</dt><dd>—</dd></div>
          <div><dt>Pacing</dt><dd>—</dd></div>
        </dl>
        <div className="mad-track" aria-hidden="true"/>
        <div className="mad-plan">
          {briefsPhase === "ready" ? plans.length
            ? <ul aria-label="Budgets written in your briefs">{plans.map((plan) => <li key={plan.id}><span>Written in <b>{plan.name || "a brief"}</b> ({BRIEF_STATE[plan.lifecycleStatus] ?? "draft"}): “{plan.budgetTarget}”</span><small>A plan, never spend</small></li>)}</ul>
            : <p>No budget is written in any brief. If one is, it shows here as written, never as spend.</p>
            : briefsPhase === "error" || briefsPhase === "unavailable" ? <p>Your briefs couldn’t load, so any budget written in them isn’t shown.</p> : <p>Reading your briefs…</p>}
        </div>
      </div>
      <p className="mov-foot">Return on ad spend isn’t shown. A lead can’t yet be followed to a payment, so any number would be a guess.</p>
    </section>
    <div className="mad-two">
      <section className="mov-card" aria-labelledby="mad-ready-h">
        <header className="mov-head"><div><h2 id="mad-ready-h">Ready now</h2><p>Saved in your library. Paige never runs or pays for ads.</p></div></header>
        <div className="mad-row"><span className="mad-ini" aria-hidden="true">Ad</span><div className="mad-row-b"><strong>{drafts}</strong><small>{access === "denied" ? "Ask an owner or admin" : adsPhase === "error" ? "Try again below" : adsPhase === "ready" && !count ? "Ask PAIGE for ad copy and it’s kept here" : "Each one previews as an ad would read"}</small></div>{access !== "denied" && count > 0 && <button type="button" className="btn btn-s" onClick={onCreative}>Open Creative</button>}</div>
        {adsPhase === "loading" && access !== "denied" && <div className="campaigns-skeleton mad-skel" role="status" aria-busy="true" aria-label="Loading saved ad copy"><span/><span/></div>}
        {adsPhase === "error" && <div className="mad-row mad-retry" role="alert"><div className="mad-row-b"><strong>Nothing was changed.</strong><small>Reading your library failed.</small></div><button type="button" className="btn btn-s" onClick={onRetry}>Try again</button></div>}
        {newest.length > 0 && <ul className="mad-list mad-newest" aria-label="Newest ad copy">{newest.map((row) => <li key={row.id}><div className="mad-row-b"><strong>{row.title || "Untitled"}</strong><small>{parseAdCopy(row.body).headline ?? "No headline written"} · saved {formatDay(row.updated_at)}</small></div><span className="pill pill-n">{row.status === "published" ? "Published" : "Draft"}</span></li>)}</ul>}
      </section>
      <section className="mov-card" aria-labelledby="mad-plat-h">
        <header className="mov-head"><div><h2 id="mad-plat-h">Ad platforms</h2><p>None can be read by Paige yet</p></div></header>
        <ul className="mad-list">{[
          ["Meta Ads", "Listed in Integrations; connecting it doesn’t let Paige read ads yet"],
          ["Metricool", "Listed in Integrations; same limit"],
          ["Google Ads", "Only through a Zapier connection; not read by Paige"],
          ["LinkedIn · TikTok · YouTube Ads", "Not available"],
        ].map(([name, detail]) => <li key={name}><div className="mad-row-b"><strong>{name}</strong><small>{detail}</small></div><span className="pill pill-n">{detail === "Not available" ? "Not available" : "Not read yet"}</span></li>)}</ul>
        <p className="mov-foot">Which one Paige reads first is your call.</p>
      </section>
    </div>
  </>;
}

function Creative({ access, phase, rows, retry, library }: { access: string; phase: string; rows: AdCopyRow[]; retry: () => void; library: MediaLibrary }) {
  if (access === "denied") return <section className="mov-card"><div className="mad-empty"><p>{LIBRARY_DENIED}</p></div></section>;
  return <>
    <MediaSection library={library}/>
    <CopySection phase={phase} rows={rows} retry={retry}/>
  </>;
}

function CopySection({ phase, rows, retry }: { phase: string; rows: AdCopyRow[]; retry: () => void }) {
  if (phase === "loading") return <div className="campaigns-skeleton" role="status" aria-busy="true" aria-label="Loading ad copy"><span/><span/><span/></div>;
  if (phase === "error") return <section className="mov-card"><div className="mad-empty"><h2>Your saved ad copy could not load</h2><p>Nothing was changed. Try again.</p><button type="button" className="btn btn-s" onClick={retry}>Try again</button></div></section>;
  if (!rows.length) return <section className="mov-card"><div className="mad-empty"><h2>No ad copy yet.</h2><p>Ask PAIGE for ad copy for a campaign. She saves it here as a draft; saving never publishes or pays for anything.</p><AskPaigeButton label="Ask PAIGE for ad copy" prompt={ADS_ASK_PROMPT}/></div></section>;
  return <>
    <div className="mad-grid">{rows.map((row) => {
      const ad = parseAdCopy(row.body);
      return <article className="mad-card" key={row.id} aria-label={row.title || "Ad copy"}>
        <div className="mad-prev">
          <div className="mad-prev-h"><span className="mad-av" aria-hidden="true"/><span><b>Your business</b><small>Sponsored</small></span></div>
          <p className="mad-prev-t">{ad.primary || <span className="mad-missing">No primary text written</span>}</p>
          <div className="mad-prev-img" aria-hidden="true">Your image or video</div>
          <div className="mad-prev-f"><span>{ad.headline ?? <span className="mad-missing">No headline written</span>}</span>{ad.cta ? <span className="mad-cta" title={ad.cta}>{ad.cta}</span> : <span className="mad-cta is-missing">No call to action</span>}</div>
        </div>
        <div className="mad-meta"><strong>{row.title || "Untitled"}</strong><small>{row.status === "published" ? "Published" : "Draft"} · saved {formatDay(row.updated_at)}</small>
          <div className="mad-meta-a"><span className="pill pill-n">Not run by Paige</span><AskPaigeButton label="Revise with PAIGE" prompt={`Revise my saved ad copy "${row.title || "Untitled"}". Ask me what to change first, then save the new version as a draft; do not run or publish anything.`}/></div>
        </div>
      </article>;
    })}</div>
    <p className="mad-note">Previews show how the copy reads in a feed. Nothing is published. {plural(rows.length, "draft")} shown{rows.length >= AD_READ_LIMIT ? `, the newest ${AD_READ_LIMIT}` : ""}.</p>
  </>;
}

function Performance({ onOpenAnalytics }: { onOpenAnalytics: () => void }) {
  const rows: [string, string, string][] = [
    ["Spend", "What the ad platform actually charged", "Not read yet"],
    ["Impressions · reach", "Counted by the ad platform", "Not read yet"],
    ["Clicks · click-through rate", "Counted by the ad platform", "Not read yet"],
    ["Cost per lead", "Spend divided by the leads the platform reports", "Not read yet"],
    ["Leads on your forms", "Form submissions whose link carries an ad’s tracking tag. Leads by tag are in Analytics today", "Partly available"],
    ["Return on ad spend", "Revenue divided by spend, once a lead can be followed to a payment", "Not available"],
  ];
  return <section className="mov-card" aria-labelledby="mad-perf-h">
    <header className="mov-head"><div><h2 id="mad-perf-h">Every figure and where it comes from</h2><p>Nothing appears without a source and a definition</p></div></header>
    <ul className="mad-list">{rows.map(([name, detail, state]) => <li key={name}><div className="mad-row-b"><strong>{name}</strong><small>{detail}</small></div>{state === "Partly available" ? <button type="button" className="mov-lnk" onClick={onOpenAnalytics}>Open Analytics</button> : <span className="pill pill-n">{state}</span>}</li>)}</ul>
  </section>;
}

/* ───────── the business's own pictures and videos: read, feature, upload ───────── */

type Notice = { tone: "ok" | "bad"; text: string; featureId?: string } | null;
export type MediaLibrary = {
  enabled: boolean;
  phase: "loading" | "ready" | "error";
  rows: MediaRow[];
  retry: () => void;
  featuredCount: number;
  pending: ReadonlySet<string>;
  toggleFeatured: (row: MediaRow) => Promise<void>;
  uploading: boolean;
  upload: (file: File) => Promise<void>;
  /** The id of the picture or video uploaded last in this visit, so the page can say where it went. */
  lastUpload: string | null;
  notice: Notice;
  dismiss: () => void;
};

const FEATURE_WORDS = {
  limit: `You can feature up to ${FEATURED_LIMIT} pictures and videos. Take one out of the showroom first; nothing was changed.`,
  missing: "Featuring isn’t available yet. Nothing was changed.",
  forbidden: "Only the workspace owner or an admin can choose what the showroom shows. Nothing was changed.",
  failed: "That didn’t save. Nothing was changed; try again.",
  archived: "That picture is archived, so it can’t stand in the showroom. Nothing was changed.",
};

function useMediaLibrary(tenantId: string | null, enabled: boolean): MediaLibrary {
  const read = useTenantRead(tenantId, NO_MEDIA, enabled ? readMedia : null);
  // Featured flags the owner just set, laid over the read so the change shows at once; a failed save
  // takes its flag back off.
  const [flags, setFlags] = React.useState<Record<string, { featured: boolean; at: string }>>({});
  const [pending, setPending] = React.useState<ReadonlySet<string>>(new Set());
  const [uploading, setUploading] = React.useState(false);
  const [lastUpload, setLastUpload] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<Notice>(null);
  const tenantRef = React.useRef(tenantId);
  tenantRef.current = tenantId;
  React.useEffect(() => { setFlags({}); setPending(new Set()); setUploading(false); setLastUpload(null); setNotice(null); }, [tenantId]);

  const rows = React.useMemo(() => read.rows.map((row) => {
    const flag = flags[row.id];
    return flag ? { ...row, meta: { ...(row.meta ?? {}), ads_featured: flag.featured, ads_featured_at: flag.at } } : row;
  }), [read.rows, flags]);
  const featuredCount = rows.filter(isFeatured).length;

  const toggleFeatured = React.useCallback(async (row: MediaRow) => {
    if (!tenantId) return;
    const started = tenantId;
    const next = !isFeatured(row);
    if (next && featuredCount >= FEATURED_LIMIT) { setNotice({ tone: "bad", text: FEATURE_WORDS.limit }); return; }
    const previous = flags[row.id];
    setFlags((current) => ({ ...current, [row.id]: { featured: next, at: new Date().toISOString() } }));
    setPending((current) => new Set(current).add(row.id));
    setNotice(null);
    try {
      const { data, error } = await supabase.rpc("set_ad_creative_featured" as never, { p_content_id: row.id, p_featured: next } as never);
      noteAdsIntakeAnswer(error);
      if (error) throw error;
      if (tenantRef.current !== started) return;
      const saved = (data ?? {}) as { featured?: unknown };
      const featured = typeof saved.featured === "boolean" ? saved.featured : next;
      setFlags((current) => ({ ...current, [row.id]: { featured, at: current[row.id]?.at ?? new Date().toISOString() } }));
      setNotice({ tone: "ok", text: featured ? `“${row.title || "Untitled"}” is featured in the showroom.` : `“${row.title || "Untitled"}” is out of the showroom’s featured places.` });
    } catch (error) {
      console.error("[ads] featuring failed", error);
      if (tenantRef.current !== started) return;
      setFlags((current) => { const copy = { ...current }; if (previous) copy[row.id] = previous; else delete copy[row.id]; return copy; });
      const message = String((error as { message?: unknown })?.message ?? "");
      setNotice({ tone: "bad", text: /AD_FEATURED_LIMIT/.test(message) ? FEATURE_WORDS.limit : /AD_CREATIVE_ARCHIVED/.test(message) ? FEATURE_WORDS.archived : isMissingFunction(error) ? FEATURE_WORDS.missing : /forbidden|permission|not allowed|42501/i.test(message) || (error as { code?: unknown })?.code === "42501" ? FEATURE_WORDS.forbidden : FEATURE_WORDS.failed });
    } finally {
      if (tenantRef.current === started) setPending((current) => { const copy = new Set(current); copy.delete(row.id); return copy; });
    }
  }, [tenantId, featuredCount, flags]);

  const upload = React.useCallback(async (file: File) => {
    if (!tenantId) return;
    const started = tenantId;
    setUploading(true);
    setNotice(null);
    try {
      const saved = await uploadToLibrary(started, file);
      if (tenantRef.current !== started) return;
      setLastUpload(saved.artifactId);
      setNotice({ tone: "ok", text: `“${saved.title}” is in your library. Nothing was published.`, featureId: saved.artifactId });
      read.retry();
    } catch (error) {
      console.error("[ads] upload failed", error);
      if (tenantRef.current !== started) return;
      const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
      setNotice({ tone: "bad", text: code === "FORBIDDEN" ? "Only the workspace owner or an admin can add pictures and videos. Nothing was saved."
        : typeof message === "string" && /too large|can attach/i.test(message) ? `${message} Nothing was saved.`
        : "The upload didn’t finish. Nothing was saved; try again." });
    } finally {
      if (tenantRef.current === started) setUploading(false);
    }
  }, [tenantId, read]);

  return { enabled, phase: read.phase, rows, retry: read.retry, featuredCount, pending, toggleFeatured, uploading, upload, lastUpload, notice, dismiss: () => setNotice(null) };
}

function UploadButton({ library, label = "Add a picture or video" }: { library: MediaLibrary; label?: string }) {
  const input = React.useRef<HTMLInputElement>(null);
  return <>
    <button type="button" className="btn btn-s" disabled={library.uploading} aria-busy={library.uploading || undefined} onClick={() => input.current?.click()}>
      <Upload size={13} aria-hidden="true"/>{library.uploading ? "Uploading…" : label}
    </button>
    <input ref={input} type="file" hidden accept={GROWTH_MEDIA_ACCEPT} aria-label={label} data-ads-upload onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void library.upload(file); }}/>
  </>;
}

/** The outcome of the last upload or featuring, in a live region, with the next step when there is one.
 *  Always mounted, empty or not, so a screen reader hears each new outcome. */
function LibraryNotice({ library, placed, canFeature }: { library: MediaLibrary; placed?: boolean | null | undefined; canFeature: boolean }) {
  const notice = library.notice;
  const offer = canFeature && notice?.featureId ? library.rows.find((row) => row.id === notice.featureId) : undefined;
  return <p className={`mad-notice${notice ? ` is-${notice.tone}` : ""}`} role="status" aria-live="polite">{notice && <>
    {notice.text}
    {notice.featureId && typeof placed === "boolean" && <> {placed
      ? canFeature ? "It stands in the first placement while you’re here; feature it to keep it there." : "It stands in the first placement while you’re here."
      : canFeature ? "It isn’t in the showroom; feature it to put it there." : "It isn’t in the showroom’s placements."}</>}
    {offer && !isFeatured(offer) && typeof placed === "boolean" && <button type="button" className="mov-lnk" disabled={library.pending.has(offer.id)} onClick={() => void library.toggleFeatured(offer)}>Feature it</button>}
  </>}</p>;
}

/* ───────── Overview: the showroom and the pipeline funnel under it ───────── */

function OverviewStage({ tenantId, brand, access, library, copyRow, copyCount, onCreative, onOpenSales, onOpenRouting }: { tenantId: string | null; brand: string; access: string; library: MediaLibrary; copyRow: AdCopyRow | null; copyCount: number; onCreative: () => void; onOpenSales: (() => void) | null; onOpenRouting: (() => void) | null }) {
  const sales = useSoloCampaigns({ scope: "pipeline" });
  const workspace = sales.pipelineWorkspace;
  const choices = React.useMemo<PipelineChoice[]>(() => pipelineChoices(workspace.pipelines), [workspace.pipelines]);
  const [pipelineId, setPipelineId] = React.useState<string | null>(null);
  const [period, setPeriod] = React.useState<PeriodKey>("90");
  const chosen = choices.find((choice) => choice.id === pipelineId) ?? choices[0] ?? null;
  const days = PERIODS.find((option) => option.key === period)!.days;
  const since = React.useMemo(() => sinceFor(days), [days]);
  const content = library.rows;
  const fallback = React.useCallback<FunnelFallback>(async (pipeline, from) => {
    const { rows, capped } = tenantId ? await readFunnelSubmissions(tenantId, from) : { rows: [], capped: false };
    return { funnel: deriveLeadFunnel({ pipeline, stages: workspace.stages, deals: workspace.deals, submissions: rows, since: from, content }), capped };
  }, [tenantId, workspace.stages, workspace.deals, content]);
  const own = access === "allowed";
  // The counts are the owners' and admins' (the server refuses anyone else), so a member's page asks for none.
  const funnel = useLeadFunnel({ tenantId, pipeline: chosen, since, fallback, restricted: access === "denied" });
  // The funnel read answers whether the ads-intake functions are deployed; nothing extra is asked here.
  const canFeature = useAdsIntakeCapability(false) !== "missing";

  // What ranks the pictures: the last funnel read that finished. While the next pipeline or window loads,
  // useLeadFunnel keeps those figures (marked stale), so the placements keep their ranking and say they
  // are updating instead of reshuffling.
  const ranking = { ads: funnel.funnel?.ads ?? null, capped: funnel.capped, pipeline: funnel.funnel?.pipeline.name ?? null };
  const updating = funnel.stale;

  const picks = own && library.phase === "ready" ? rankShowroomMedia(library.rows, ranking.ads, 3, library.lastUpload) : [];
  const recentIndex = picks.findIndex((pick) => pick.reason === "recent");
  const media: ShowroomMedia[] = picks.map((pick, index) => ({ src: pick.src, kind: pick.kind, title: pick.row.title || "Untitled", badge: badgeOf(pick, index === recentIndex, ranking.capped) }));
  const parsed = copyRow ? parseAdCopy(copyRow.body) : null;
  const copy = copyRow && parsed ? { title: copyRow.title || "Untitled", headline: parsed.headline, primary: parsed.primary, cta: parsed.cta } : null;
  // Where the last upload went, once the library read includes it (undefined while it is still loading).
  const placed = !library.lastUpload ? null : !library.rows.some((row) => row.id === library.lastUpload) ? undefined : picks.some((pick) => pick.row.id === library.lastUpload);

  // The order, said as the page applies it: featured (when featuring is offered), performing, newest.
  const order: React.ReactNode[] = [
    ...(canFeature ? ["the ones you feature first"] : []),
    ...(ranking.pipeline ? [<React.Fragment key="perf">the ones whose tracking tag brought the most won deals and leads on <b>{ranking.pipeline}</b> {periodWords(days)}{updating ? " (updating…)" : ""}</React.Fragment>] : []),
    "your newest",
  ].map((part, index) => <React.Fragment key={index}>{index ? ", then " : ""}{part}</React.Fragment>);
  const lede = !own
    ? access === "denied"
      ? <>Each placement shows a sample. Your workspace’s pictures and saved ads are visible to its owners and admins.</>
      : <>Reading your pictures and saved ads…</>
    : library.phase === "error"
      ? <>Your pictures couldn’t load, so each placement shows a sample. Nothing was changed.</>
      : media.length
        ? <>Your own pictures stand in the placements: {order}.{media.length < 3 ? " Samples fill what is left." : ""}{copy ? <> The words are from your saved ad <b>{copy.title}</b>.</> : null}</>
        : copy
          ? <>Your saved ad <b>{copy.title}</b> is set into each placement. Add a picture or video and it takes the first placement; samples hold the rest.</>
          : <>Each placement shows a sample until you add a picture or video, or save ad copy.</>;

  return <>
    <Showroom brand={brand} copy={copy} media={media} lede={lede}
      actions={<>
        {own && <UploadButton library={library}/>}
        {own && (copyCount > 0 || library.rows.length > 0) && <button type="button" className="btn btn-s" onClick={onCreative}>Open Creative</button>}
        {own && library.phase === "error" && <button type="button" className="btn btn-s" onClick={library.retry}>Try again</button>}
      </>}
      status={own ? <LibraryNotice library={library} placed={placed} canFeature={canFeature}/> : null}/>
    <LeadFunnelPanel title="Leads through your pipeline" periodWords={periodWords(days)} choices={choices}
      choicesReady={sales.phase === "ready"} choicesFailed={sales.phase === "error" || sales.phase === "unavailable"}
      pipelineId={chosen?.id ?? null} onPipeline={setPipelineId} read={funnel}
      controls={<div className="campaigns-segmented" role="group" aria-label="Period">{PERIODS.map((option) => <button type="button" key={option.key} aria-pressed={period === option.key} onClick={() => setPeriod(option.key)}>{option.label}</button>)}</div>}
      adNames={adNamesOf(library.rows)} recordLimit={FUNNEL_RECORD_LIMIT} onOpenSales={onOpenSales} onOpenRouting={onOpenRouting}
      adHint={own ? "None of these leads carried an ad tag (utm_content). In Creative, copy a picture’s tagged link and use it as the link its ad points at; leads from that link are credited to that picture." : "None of these leads carried an ad tag (utm_content)."}/>
  </>;
}

/** Why a picture stands in its placement. A capped records count is a floor, so its figures carry "+". */
function badgeOf(pick: ShowroomPick, newest: boolean, capped: boolean): string {
  if (pick.reason === "added") return isFeatured(pick.row) ? "Featured" : "Just added";
  if (pick.reason === "featured") return "Featured";
  if (pick.reason === "performing") {
    const plus = capped ? "+" : "";
    const leads = `${pick.leads}${plus} ${pick.leads === 1 && !capped ? "lead" : "leads"}`;
    return pick.won ? `${pick.won}${plus} won · ${leads}` : leads;
  }
  return newest ? "Newest" : "Recent";
}

function adNamesOf(rows: readonly MediaRow[]): Map<string, AdName> {
  return new Map(rows.map((row) => [row.id.toLowerCase(), { title: row.title || "Untitled", thumb: safeMediaUrl(row.image_url), kind: row.kind === "video" ? "video" : "image" }]));
}

/* ───────── Creative: the pictures and videos, each with its feature switch and tagged link ───────── */

type Copied = { id: string; ok: boolean; text: string; what: "link" | "tag"; where?: string };

function MediaSection({ library }: { library: MediaLibrary }) {
  // Creative is where featuring is offered, so it asks once whether the server can do it.
  const canFeature = useAdsIntakeCapability(true) !== "missing";
  const [copied, setCopied] = React.useState<Copied | null>(null);
  const [linkFor, setLinkFor] = React.useState<string | null>(null);
  const openers = React.useRef(new Map<string, HTMLButtonElement | null>());
  const panelId = React.useId();
  const write = async (text: string) => {
    try { await navigator.clipboard.writeText(text); return true; } catch (error) { console.error("[ads] copying failed", error); return false; }
  };
  const copyTag = async (row: MediaRow) => {
    const tag = trackingTag(row.id);
    setCopied({ id: row.id, ok: await write(tag), text: tag, what: "tag" });
  };
  const closeLink = (focus = true) => {
    const id = linkFor;
    setLinkFor(null);
    if (focus && id) openers.current.get(id)?.focus();
  };
  const copyLink = async (row: MediaRow, url: string, where: string) => {
    const ok = await write(url);
    setCopied({ id: row.id, ok, text: url, what: "link", where });
    if (ok) closeLink();
  };
  const copiedRow = copied ? library.rows.find((row) => row.id === copied.id) : undefined;
  const atLimit = library.featuredCount >= FEATURED_LIMIT;
  return <section className="mov-card mad-media" aria-labelledby="mad-media-h">
    <header className="mov-head">
      <div><h2 id="mad-media-h">Pictures and videos</h2><p>{canFeature && library.phase === "ready" ? `${library.featuredCount} of ${FEATURED_LIMIT} featured in the showroom. ` : ""}When an ad’s link carries a picture’s tag, the leads it brings are credited to that picture.</p></div>
      <UploadButton library={library}/>
    </header>
    <LibraryNotice library={library} canFeature={canFeature}/>
    <p className={`mad-notice${copiedRow ? copied!.ok ? " is-ok" : " is-bad" : ""}`} role="status" aria-live="polite">{copiedRow && (copied!.ok
      ? copied!.what === "link"
        ? <>Copied the link to <b>{copied!.where}</b> tagged for “{copiedRow.title || "Untitled"}”. Use it as the link your ad points at; leads that arrive on it are credited to that picture.</>
        : <>Copied <code>{copied!.text}</code>. Add it to the link this ad points at; leads that arrive on it are credited to “{copiedRow.title || "Untitled"}”.</>
      : <>Couldn’t copy. Select it and copy it yourself: <code>{copied!.text}</code></>)}</p>
    {library.phase === "loading" ? <div className="campaigns-skeleton mad-skel" role="status" aria-busy="true" aria-label="Loading pictures and videos"><span/><span/></div>
      : library.phase === "error" ? <div className="mad-row mad-retry" role="alert"><div className="mad-row-b"><strong>Your pictures and videos couldn’t load.</strong><small>Nothing was changed.</small></div><button type="button" className="btn btn-s" onClick={library.retry}>Try again</button></div>
      : !library.rows.length ? <div className="mad-empty"><h2>No pictures or videos yet.</h2><p>Add one and it stands in your showroom straight away, ahead of the samples. Adding never publishes or pays for anything.</p></div>
      : <ul className="mad-mgrid" aria-label="Your pictures and videos">{library.rows.map((row) => {
        const src = safeMediaUrl(row.image_url);
        const featured = isFeatured(row);
        const busy = library.pending.has(row.id);
        const linking = linkFor === row.id;
        return <React.Fragment key={row.id}>
          <li className={`mad-mcard${linking ? " is-linking" : ""}`} data-media-id={row.id}>
            <span className="mad-mthumb">{src ? row.kind === "video" ? <video src={src} muted playsInline preload="metadata" aria-label={row.title || "Video"}/> : <img src={src} alt={row.title || "Picture"} loading="lazy"/> : <span className="mad-missing">No file saved</span>}{featured && canFeature && <span className="mad-mflag"><Star size={11} aria-hidden="true"/>Featured</span>}</span>
            <span className="mad-mmeta"><strong title={row.title ?? undefined}>{row.title || "Untitled"}</strong><small>{row.kind === "video" ? "Video" : "Picture"} · saved {formatDay(row.updated_at)}</small></span>
            <span className="mad-macts">
              <button type="button" className="btn btn-p btn-s" ref={(node) => { openers.current.set(row.id, node); }} aria-expanded={linking} aria-controls={linking ? panelId : undefined} onClick={() => setLinkFor(linking ? null : row.id)}><Link2 size={13} aria-hidden="true"/>Copy tagged link</button>
              {canFeature && <button type="button" className="btn btn-s" aria-pressed={featured} disabled={busy || (!featured && atLimit)} title={!featured && atLimit ? FEATURE_WORDS.limit : undefined} onClick={() => void library.toggleFeatured(row)}>
                <Star size={13} aria-hidden="true"/>{featured ? "Featured" : "Feature in showroom"}
              </button>}
              <button type="button" className="mov-lnk mad-tagonly" onClick={() => void copyTag(row)}><Copy size={12} aria-hidden="true"/>Copy tag only</button>
            </span>
          </li>
          {linking && <li className="mad-linker-row"><TaggedLinkPanel id={panelId} row={row} onClose={() => closeLink()} onCopy={(url, where) => void copyLink(row, url, where)}/></li>}
        </React.Fragment>;
      })}</ul>}
  </section>;
}

const DEST_TYPE: Record<string, string> = { page: "Page", funnel: "Funnel", form: "Form" };

/** Choose one live page, funnel or form and an optional campaign tag; the link is built as the owner
 *  types, shown in full, and copied with the picture's tag joined on. The list comes from the read that
 *  lists them in Marketing (useSoloCampaigns), mounted only while this panel is open. */
function TaggedLinkPanel({ id, row, onClose, onCopy }: { id: string; row: MediaRow; onClose: () => void; onCopy: (url: string, where: string) => void }) {
  const campaigns = useSoloCampaigns();
  const live = React.useMemo(() => (campaigns.artifacts ?? []).filter((item) => item.publicHref), [campaigns.artifacts]);
  const [destination, setDestination] = React.useState<string | null>(null);
  const [campaign, setCampaign] = React.useState("");
  const chosen = live.find((item) => item.id === destination) ?? live[0] ?? null;
  const url = chosen ? taggedLink(chosen.publicHref, window.location.origin, { content: row.id, campaign }) : null;
  const headingId = `${id}-h`;
  const options = React.useRef<(HTMLButtonElement | null)[]>([]);
  const first = React.useRef<HTMLElement | null>(null);
  const ready = campaigns.phase === "ready";
  React.useEffect(() => { first.current?.focus(); }, [ready]);
  const onRadioKey = (event: React.KeyboardEvent, index: number) => {
    const last = live.length - 1;
    const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? Math.min(last, index + 1) : event.key === "ArrowUp" || event.key === "ArrowLeft" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    setDestination(live[next].id);
    options.current[next]?.focus();
  };
  return <div id={id} className="mad-linker" role="group" aria-labelledby={headingId} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <header><h3 id={headingId}>Tagged link for “{row.title || "Untitled"}”</h3><button type="button" className="mad-linker-x" aria-label="Close" onClick={onClose}><X size={14} aria-hidden="true"/></button></header>
    {!ready && campaigns.phase !== "error" && campaigns.phase !== "unavailable"
      ? <div className="campaigns-skeleton" role="status" aria-busy="true" aria-label="Loading your live pages and forms"><span/><span/></div>
      : !ready
        ? <div className="mad-linker-msg" role="alert"><p>Your pages and forms couldn’t load. Nothing was changed.</p><button type="button" className="btn btn-s" ref={(node) => { first.current = node; }} onClick={() => campaigns.retry?.()}>Try again</button></div>
        : !live.length
          ? <div className="mad-linker-msg"><p>No page, funnel or form is live yet, so there is no link to tag. Publish one in Vibe Studio, or copy the tag only and add it to a link of your own.</p></div>
          : <>
            <div className="mad-linker-f">
              <span className="mad-linker-k" id={`${id}-dest`}>Where the ad sends people</span>
              <div className="mad-dests" role="radiogroup" aria-labelledby={`${id}-dest`}>{live.map((item, index) => {
                const on = item.id === chosen?.id;
                return <button type="button" key={item.id} role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
                  ref={(node) => { options.current[index] = node; if (on) first.current = node; }}
                  onClick={() => setDestination(item.id)} onKeyDown={(event) => onRadioKey(event, index)}>
                  <small>{DEST_TYPE[item.type] ?? "Page"}</small><span>{item.name || "Untitled"}</span>
                </button>;
              })}</div>
            </div>
            <label className="mad-linker-f"><span className="mad-linker-k">Campaign tag <small>optional</small></span>
              <input type="text" value={campaign} maxLength={80} placeholder="spring-workshop" autoComplete="off" spellCheck={false} onChange={(event) => setCampaign(event.target.value)} aria-describedby={`${id}-camp`}/>
              <small id={`${id}-camp`}>Added as utm_campaign, so this ad’s leads also count under that campaign.</small>
            </label>
            <div className="mad-linker-f"><span className="mad-linker-k">The link</span><code className="mad-linker-url" data-tagged-link>{url ?? "This link can’t be tagged."}</code></div>
            <div className="mad-linker-a">
              <button type="button" className="btn btn-p btn-s" disabled={!url} onClick={() => url && chosen && onCopy(url, chosen.name || "Untitled")}><Copy size={13} aria-hidden="true"/>Copy link</button>
              <button type="button" className="btn btn-s" onClick={onClose}>Cancel</button>
            </div>
          </>}
  </div>;
}
