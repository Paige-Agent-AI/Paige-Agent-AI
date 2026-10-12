// Campaigns › dossier: what this campaign uses (INT-298 MBC slice 3b). The two lanes of the approved
// campaign map (docs/prototypes/int342-marketing-convergence.html, "Campaign map"): Reach — the emails,
// series, posts and ad copy that bring people in — and Land — the pages, forms and funnels they arrive on.
// Owners and admins attach and remove pieces through the governed links (useCampaignAssets); members read
// them. A piece here is part of the plan; it never means anything was sent or published.
// The third lane, Brought in (Experience 03 S1d-1), is the approved map's outcome lane: how many leads the
// campaign was credited with when they arrived, and how many became opportunities. Opportunities and revenue
// are Sales' records, so the lane counts and routes there; it never values a deal or claims revenue.
import React from "react";
import { Ic as SharedIcons } from "./_shared";
import { broughtInNote, useCampaignLeads, type CampaignLeadsState } from "./useCampaignLeads";
import { CampaignLeadRows } from "./campaign-leads";
import { kindLabel, statusLabel, type AttachableAsset, type CampaignAssetKind, type CampaignAssetLink, type CampaignAssetsState, type LinkableKind } from "./useCampaignAssets";

const Ic = SharedIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>;

const REACH: readonly CampaignAssetKind[] = ["email_campaign", "email_series", "social_post", "content"];
const LAND: readonly CampaignAssetKind[] = ["page", "form", "funnel"];

function Lane({ id, title, help, kinds, links, available, canManage, addLabel, makeWhere, onAttach, onDetach }: {
  id: string; title: string; help: string; kinds: readonly CampaignAssetKind[]; links: readonly CampaignAssetLink[];
  available: readonly AttachableAsset[]; canManage: boolean; addLabel: string; makeWhere: string;
  onAttach: (asset: AttachableAsset) => Promise<boolean>; onDetach: (link: CampaignAssetLink) => Promise<void>;
}) {
  const [picking, setPicking] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const addRef = React.useRef<HTMLButtonElement>(null);
  const linked = new Set(links.map((link) => `${link.kind}:${link.id}`));
  const choices = available.filter((asset) => kinds.includes(asset.kind) && !linked.has(`${asset.kind}:${asset.id}`)
    && (!query.trim() || asset.name.toLowerCase().includes(query.trim().toLowerCase())));
  const close = () => { setPicking(false); setQuery(""); requestAnimationFrame(() => addRef.current?.focus()); };
  return (
    <section className="cc-lane" aria-labelledby={`${id}-h`}>
      <div className="cc-h"><h5 id={`${id}-h`}>{title}</h5><span>{help}</span></div>
      {links.length ? <ul className="cc-list">{links.map((link) => {
        const label = kindLabel(link.kind, link.channel);
        const status = statusLabel(link.kind, link.status);
        return <li key={`${link.kind}:${link.id}`} className="cc-row">
          <span className="cc-k">{label}</span>
          <span className="cc-n">{link.name ?? <span className="cc-hidden">Owners and admins can see which</span>}</span>
          {status && <span className="cc-s">{status}</span>}
          {canManage && link.detachable && <button type="button" className="btn btn-s" disabled={busy !== null}
            aria-label={`Remove ${link.name ?? label} from this campaign`}
            onClick={async () => { setBusy(`${link.kind}:${link.id}`); try { await onDetach(link); } finally { setBusy(null); requestAnimationFrame(() => addRef.current?.focus()); } }}>Remove</button>}
        </li>;
      })}</ul> : <p className="cc-empty">Nothing attached yet.</p>}
      {canManage && !picking && <button ref={addRef} type="button" className="cc-add" onClick={() => setPicking(true)}><Ic.plus size={13}/> {addLabel}</button>}
      {canManage && picking && <div className="cc-pick" role="group" aria-label={addLabel}
        onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
        {available.filter((asset) => kinds.includes(asset.kind)).length > 6 && <input className="cc-q" type="search" value={query} autoFocus
          aria-label="Find a piece" placeholder="Find by name" onChange={(event) => setQuery(event.target.value)}/>}
        {choices.length ? <ul className="cc-choices">{choices.map((asset) => <li key={`${asset.kind}:${asset.id}`}>
          <button type="button" disabled={busy !== null} autoFocus={choices[0] === asset && available.filter((a) => kinds.includes(a.kind)).length <= 6}
            onClick={async () => { setBusy(`${asset.kind}:${asset.id}`); try { if (await onAttach(asset)) close(); } finally { setBusy(null); } }}>
            <span className="cc-k">{kindLabel(asset.kind, asset.channel)}</span><span className="cc-n">{asset.name}</span>
            {statusLabel(asset.kind, asset.status) && <span className="cc-s">{statusLabel(asset.kind, asset.status)}</span>}
          </button></li>)}</ul>
          : <p className="cc-empty">{query.trim() ? "Nothing matches that name." : `Everything you've made of this kind is already attached, or there's nothing yet. Make it in ${makeWhere}.`}</p>}
        <button type="button" className="btn btn-s" onClick={close}>Cancel</button>
      </div>}
    </section>
  );
}

/** The outcome lane. Counts are the server's, over every lead credited to this campaign. */
export function BroughtIn({ id, leads, archived = false, onRoute }: { id: string; leads: CampaignLeadsState; archived?: boolean; onRoute?: (route: string) => void }) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  // S1d-2 (owner-approved): the rows open under the counts on request, so the lane stays a summary by default.
  const [open, setOpen] = React.useState(false);
  // Try again unmounts while the read reloads, so focus moves to the lane's heading rather than the page.
  const retry = () => { leads.retry(); requestAnimationFrame(() => headingRef.current?.focus()); };
  return (
    <section className="cc-lane cc-out" aria-labelledby={`${id}-h`} aria-busy={leads.phase === "loading"}>
      <div className="cc-h"><h5 id={`${id}-h`} ref={headingRef} tabIndex={-1}>Brought in</h5><span>What came of it</span></div>
      {leads.phase === "loading" && <div className="campaigns-skeleton" style={{ padding: 0 }}><span style={{ height: 52 }}/></div>}
      {leads.phase === "error" && <p className="cc-empty" role="alert">The leads this campaign brought in couldn’t load. <button type="button" className="btn btn-s" onClick={retry}>Try again</button></p>}
      {leads.phase === "ready" && <>
        <dl className="cc-outs">
          <div className="cc-outv"><dt>{leads.counts.leads}</dt><dd>{leads.counts.leads === 1 ? "lead" : "leads"} credited to this campaign</dd></div>
          <div className="cc-outv"><dt>{leads.counts.opportunities}</dt><dd>{leads.counts.opportunities === 1 ? "opportunity" : "opportunities"}
            {onRoute && leads.counts.opportunities > 0 && <> · <button type="button" className="cc-lnk" onClick={() => onRoute("sales")}>open Sales</button></>}</dd></div>
          <div className="cc-outv cc-muted"><dt><span aria-hidden="true">—</span><span className="campaigns-sr-only">No figure:</span></dt><dd>Revenue lives in Sales</dd></div>
        </dl>
        {leads.counts.leads > 0 && <>
          <button type="button" className="cc-add cl-toggle" aria-expanded={open} aria-controls={`${id}-rows`} onClick={() => setOpen((value) => !value)}>
            {open ? "Hide the leads" : `Show the ${leads.counts.leads === 1 ? "lead" : `${Math.min(leads.counts.leads, leads.leads.length).toLocaleString()} newest leads`}`}
          </button>
          {open && <CampaignLeadRows id={`${id}-rows`} leads={leads}/>}
        </>}
        <p className="cc-foot">{broughtInNote(leads, archived)}</p>
      </>}
    </section>
  );
}

export function CampaignComposition({ briefId, assets, onToast, tenantId = null, archived = false, onRoute }: {
  briefId: string; assets: CampaignAssetsState; onToast: (message: string, kind: "ok" | "err") => void;
  tenantId?: string | null; archived?: boolean; onRoute?: (route: string) => void;
}) {
  const leads = useCampaignLeads(tenantId, briefId);
  if (assets.phase === "loading") return <div className="campaigns-skeleton" style={{ padding: 0 }}><span style={{ height: 64 }}/></div>;
  if (assets.phase === "error") return <div className="dw-note" role="alert">What this campaign uses couldn’t load. Nothing was changed. <button type="button" className="btn btn-s" onClick={assets.retry}>Try again</button></div>;
  const mine = assets.links.filter((link) => link.briefId === briefId);
  const attach = async (asset: AttachableAsset) => { const r = await assets.attach(briefId, asset.kind as LinkableKind, asset.id); onToast(r.message, r.ok ? "ok" : "err"); return r.ok; };
  const detach = async (link: CampaignAssetLink) => { const r = await assets.detach(briefId, link.kind as LinkableKind, link.id); onToast(r.message, r.ok ? "ok" : "err"); };
  return (
    <div className="cc">
      <Lane id={`cc-reach-${briefId}`} title="Reach" help="How people hear about it" kinds={REACH} links={mine.filter((link) => REACH.includes(link.kind))}
        available={assets.available} canManage={assets.canManage} addLabel="Add an email, series or library piece" makeWhere="Email, or save it to your library from Vibe Studio" onAttach={attach} onDetach={detach}/>
      <Lane id={`cc-land-${briefId}`} title="Land" help="Where they arrive and sign up" kinds={LAND} links={mine.filter((link) => LAND.includes(link.kind))}
        available={assets.available} canManage={assets.canManage} addLabel="Add the page, form or funnel they land on" makeWhere="Vibe Studio" onAttach={attach} onDetach={detach}/>
      {tenantId && <BroughtIn id={`cc-out-${briefId}`} leads={leads} archived={archived} onRoute={onRoute}/>}
      <p className="cc-foot">Attaching a piece records that it's part of this campaign. Nothing is sent or published from here. A social post that names this campaign shows here too.</p>
    </div>
  );
}
