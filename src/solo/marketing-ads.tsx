// Marketing › Ads (INT-342 S1c, owner-approved prototype v2, 2026-10-10; owner ruling the same day: "Desk
// now, Meta read next"). docs/product/int342-marketing-convergence.md §G/§K.
//
// The paid-acquisition desk, built before any ad platform can be read. Paige cannot read an ad account yet
// (connecting Meta or Metricool in Integrations does not change that), so every provider figure (spend, impressions, clicks, cost per
// lead, return) is shown as not available, never as zero or an estimate. What IS real is shown in full:
//   marketing_content (channel ad_copy, not archived)  saved ad copy, previewed as an ad would read it;
//                                                      owners and admins only (its RLS), members are told so
//   campaign briefs (useSoloCampaignBriefs)            a budget the owner wrote in a brief, quoted verbatim
//                                                      as a plan, never as spend
// Nothing on this page runs, pauses, pays for or publishes anything.
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSoloCampaignBriefs } from "./useSoloCampaignBriefs";
import { AskPaigeButton, LIBRARY_DENIED, useLibraryAccess, useTenantRead } from "./marketing-planned";
import "./marketing-overview.css";
import "./marketing-ads.css";

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

const formatDay = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; };
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const ASK_PROMPT = "Draft ad copy for my business. Ask me what I am promoting, who it is for and where it will run before you write it. Give it a headline, primary text and a call to action, and save it as a draft; do not run or publish anything.";

export type MarketingAdsProps = {
  tenantId: string | null;
  view: AdsView;
  onView: (view: AdsView) => void;
  onOpenIntegrations: (() => void) | null;
  onOpenAudience: () => void;
  onOpenAnalytics: () => void;
  onOpenCampaigns: () => void;
};

export function MarketingAds({ tenantId, view, onView, onOpenIntegrations, onOpenAudience, onOpenAnalytics, onOpenCampaigns }: MarketingAdsProps) {
  const access = useLibraryAccess();
  const ads = useTenantRead(tenantId, NO_ADS, access === "allowed" ? readAdCopy : null);
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
      <div className="mov-acts">
        <div className="campaigns-segmented" role="group" aria-label="Ads views">{ADS_VIEWS.map((item) => <button key={item.key} aria-pressed={view === item.key} onClick={() => onView(item.key)}>{item.label}</button>)}</div>
        <AskPaigeButton label="Ask PAIGE for ad copy" prompt={ASK_PROMPT}/>
      </div>
    </div>
    <section className="mov-card mad-prov" aria-label="Ad account">
      <span className="mad-logo" aria-hidden="true"><PlugIcon/></span>
      <div className="mad-prov-b"><strong>No ad account is read here</strong><small>Campaigns, spend and results from Meta, Google, LinkedIn, TikTok or YouTube can’t be read yet, even with an account connected in Integrations.</small></div>
      <span className="pill pill-n">Not read yet</span>
      {onOpenIntegrations && <button type="button" className="btn btn-s" onClick={onOpenIntegrations}>Open Integrations</button>}
    </section>
    {view === "overview" && <Overview drafts={drafts} adsPhase={adsPhase} count={count} access={access} plans={plans} briefsPhase={briefs.phase} onCreative={() => onView("creative")} newest={access === "allowed" && adsPhase === "ready" ? ads.rows.slice(0, 3) : []} onRetry={ads.retry}/>}
    {view === "campaigns" && <section className="mov-card"><div className="mad-empty"><h2>No ad campaigns to show.</h2><p>Ad campaigns run inside the ad platform. Once Paige can read an ad account they appear here, next to the brief each one serves.</p><button type="button" className="mov-lnk" onClick={onOpenCampaigns}>Open your campaign briefs</button></div></section>}
    {view === "creative" && <Creative access={access} phase={adsPhase} rows={ads.rows} retry={ads.retry}/>}
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

function Creative({ access, phase, rows, retry }: { access: string; phase: string; rows: AdCopyRow[]; retry: () => void }) {
  if (access === "denied") return <section className="mov-card"><div className="mad-empty"><p>{LIBRARY_DENIED}</p></div></section>;
  if (phase === "loading") return <div className="campaigns-skeleton" role="status" aria-busy="true" aria-label="Loading ad copy"><span/><span/><span/></div>;
  if (phase === "error") return <section className="mov-card"><div className="mad-empty"><h2>Your saved ad copy could not load</h2><p>Nothing was changed. Try again.</p><button type="button" className="btn btn-s" onClick={retry}>Try again</button></div></section>;
  if (!rows.length) return <section className="mov-card"><div className="mad-empty"><h2>No ad copy yet.</h2><p>Ask PAIGE for ad copy for a campaign. She saves it here as a draft; saving never publishes or pays for anything.</p><AskPaigeButton label="Ask PAIGE for ad copy" prompt={ASK_PROMPT}/></div></section>;
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
