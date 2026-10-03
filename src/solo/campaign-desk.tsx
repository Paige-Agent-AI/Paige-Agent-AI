// @ts-nocheck
// Campaigns -> Overview: the Campaign Command Desk. The production port of the owner-approved
// prototype (docs/prototypes/campaigns-overview.html). Overview COORDINATES a campaign across the
// source-owning subtabs (Catalog/Sales/Pipeline/Social/Performance/Vibe Studio); it recreates none
// of them and fabricates no campaign state.
//
// TRUTH MODEL (§13/§70). A campaign is an OWNER-AUTHORED brief (useSoloCampaignBriefs), never proof
// of a live campaign. Each growth-loop stage reads "Ready" ONLY where a real fact backs it: a
// tenant-validated offer link, a tenant-validated pipeline link (with a LIVE deal count), or a
// recorded workspace artifact. Distribution, Conversations and Recorded outcome are UNAVAILABLE —
// no connected provider, no campaign attribution — and say so. No counts, revenue, reach, ad spend,
// audience size, active status, or completion is invented.
import React from "react";
import { createPortal } from "react-dom";
import { Ic } from "./_shared";
import { useSoloCampaignBriefs } from "./useSoloCampaignBriefs";
import { useCatalogOffers } from "./useCatalogOffers";

// ── vocab ──────────────────────────────────────────────────────────────────────────────────────
const ST = {
  ready:   { label: "Ready",             cls: "st-ready" },
  partial: { label: "Partial",           cls: "st-partial" },
  await:   { label: "Awaiting approval",  cls: "st-await" },
  blocked: { label: "Blocked",           cls: "st-blocked" },
  unavail: { label: "Unavailable",       cls: "st-unavail" },
  setup:   { label: "Needs setup",       cls: "st-setup" },
  planned: { label: "Planned",           cls: "st-planned" },
};
const PHASE = {
  draft:            ["Draft",             "st-planned"],
  ready_for_review: ["Awaiting review",   "st-await"],
  blocked:          ["Blocked",           "st-blocked"],
  approved:         ["Approved",          "st-partial"],
  active:           ["Active",            "st-ready"],
  paused:           ["Paused",            "st-unavail"],
  completed:        ["Completed",         "st-ready"],
  archived:         ["Archived",          "st-unavail"],
};
// The 7 growth-loop stages and the subtab that OWNS each. Overview routes; it never does their work.
const LOOP = [
  { k: "offer",         name: "Offer",            ic: "grid",  owner: "Offers",    route: "catalog",     src: "Your offers" },
  { k: "audience",      name: "Audience",         ic: "users", owner: "Relationships", route: "clients", src: "Segments / People" },
  { k: "content",       name: "Content",          ic: "spark", owner: "Vibe Studio", route: "studio",    src: "Published Vibe assets" },
  { k: "distribution",  name: "Distribution",     ic: "send",  owner: "Social",    route: "social",      src: "No connected provider" },
  { k: "conversations", name: "Conversations",    ic: "mail",  owner: "Social",    route: "social",      src: "No connected provider" },
  { k: "pipeline",      name: "Pipeline",         ic: "trend", owner: "Pipeline",  route: "pipeline",    src: "Deal workspace" },
  { k: "outcome",       name: "Recorded outcome", ic: "chart", owner: "Analytics", route: "analytics",   src: "No campaign attribution" },
];

// Owner ruling 2026-09-23: the four capability states are said in the customer's words on a tenant
// surface, never as release vocabulary. Same mapping as growth2.tsx's PLAIN_STATE.
const PLAIN_TRUTH = { LIVE: "Available", PARTIAL: "Partly available", PROPOSED: "Planned", UNAVAILABLE: "Not available" };
// The name a person sees on each route's button. Offers was "Catalog" and Analytics was
// "Performance" before the Marketing department (owner ruling 2026-10-03).
const ROUTE_LABEL = { catalog: "Offers", analytics: "Analytics", studio: "Vibe Studio", clients: "Clients", social: "Social", pipeline: "Pipeline", sales: "Sales" };
const routeLabel = (route) => ROUTE_LABEL[route] || route[0].toUpperCase() + route.slice(1);
const truth = (s) => <span className={`campaigns-truth campaigns-truth--${s.toLowerCase()}`}>{PLAIN_TRUTH[s] || PLAIN_TRUTH.UNAVAILABLE}</span>;
const stateChip = (k) => { const s = ST[k] || ST.unavail; return <span className={`loop-state ${s.cls}`}><span className="sd"/>{s.label}</span>; };
const phasePill = (p) => { const [lbl, cls] = PHASE[p] || ["—", "st-unavail"]; return <span className={`phasepill ${cls}`}><span className="sd"/>{lbl}</span>; };
const fmt = (v) => { if (!v) return "Not recorded"; const d = new Date(v); return Number.isNaN(d.getTime()) ? "Not recorded" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d); };

// ── honest per-brief loop derivation (never fabricates a link) ──────────────────────────────────
function briefLoop(b) {
  return {
    offer:         b.offerId ? "ready" : "setup",
    audience:      b.audience ? "partial" : "setup",
    content:       b.contentNeeds ? "planned" : "setup",
    distribution:  "unavail",
    conversations: "unavail",
    pipeline:      b.pipelineId ? "ready" : "setup",
    outcome:       "unavail",
  };
}
// Workspace-scope loop posture, derived ONLY from real reads. Every non-"setup"/"unavail" state
// here is backed by a fact this workspace actually holds — never a decorative default (§13).
//   • offer   — the tenant's Catalog read (`offerSignal`): "partial" only when offers really exist,
//               "blocked" if that read failed, "setup" when the workspace has none / not yet read.
//   • audience — there is NO segment source wired into this workspace, so it is honestly "setup".
//               (A per-brief audience is owner-authored text, handled in `briefLoop`.)
//   • content  — the published-Vibe artifacts read.
//   • pipeline — the tenant-scoped pipeline workspace read.
function workspaceLoop(data, offerSignal) {
  const hasArtifacts = (data.artifacts || []).length > 0;
  const hasPipelines = ((data.pipelineWorkspace && data.pipelineWorkspace.pipelines) || []).length > 0;
  const pipelineFailed = data.phase === "error";
  const offer = offerSignal === "error" ? "blocked" : offerSignal === "has" ? "partial" : "setup";
  return {
    offer,
    audience:      "setup",
    content:       hasArtifacts ? "partial" : "setup",
    distribution:  "unavail",
    conversations: "unavail",
    pipeline:      pipelineFailed ? "blocked" : hasPipelines ? "ready" : "setup",
    outcome:       "unavail",
  };
}

function loopNeed(seg, stKey, b, data) {
  if (seg.k === "pipeline" && stKey === "ready" && b) {
    return `Linked to “${b.pipelineName || "a pipeline"}” · ${b.pipelineDealCount} deal${b.pipelineDealCount === 1 ? "" : "s"} read live from Pipeline.`;
  }
  if (seg.k === "pipeline" && stKey === "blocked") return "The pipeline read failed. Your records were not changed.";
  if (seg.k === "offer" && stKey === "blocked") return "Your offers could not be read. Your records were not changed.";
  if (seg.k === "offer" && stKey === "ready" && b) return `Linked offer: ${b.offerName || "recorded in Offers"}.`;
  if (seg.k === "offer" && stKey === "partial" && !b) return "Your offers are recorded. Link one to a brief to make the ask concrete.";
  if (seg.k === "distribution" || seg.k === "conversations") return "No connected provider. Connect one in Social — no reach, queue or schedule is shown.";
  if (seg.k === "outcome") return "Attribution needs a verified source; not available yet.";
  if (stKey === "ready") return "Source connected.";
  if (seg.k === "offer") return "Define or link what this campaign sells.";
  if (seg.k === "audience") return "Name the segment this reaches.";
  if (seg.k === "content") return "Create the page, funnel or form in Vibe Studio.";
  return "Not set up yet.";
}

// ── growth-loop command map ──────────────────────────────────────────────────────────────────
function LoopMap({ data, focus, onClearFocus, onRoute, offerSignal }) {
  const loop = focus ? briefLoop(focus) : workspaceLoop(data, offerSignal);
  return (
    <section className="loop" aria-label="Growth-loop command map">
      <div className="loop-head">
        <span className="loop-ic st-partial" style={{ background: "var(--surface-sunk)" }}><Ic.pulse size={16}/></span>
        <div><h3>Growth-loop command map</h3><div className="sub">Offer → Audience → Content → Distribution → Conversations → Pipeline → Recorded outcome</div></div>
        <div className="scope">
          {focus
            ? <>Campaign · <b>{focus.name}</b> <button className="btn btn-s" onClick={onClearFocus}>Workspace scope</button></>
            : <>Workspace scope</>}
        </div>
      </div>
      <div className="loop-track">
        {LOOP.map((seg) => {
          const stKey = loop[seg.k];
          const st = ST[stKey] || ST.unavail;
          const failed = (seg.k === "pipeline" || seg.k === "offer") && stKey === "blocked";
          return (
            <div className="loop-seg" key={seg.k}>
              <button className="loop-node" data-solo-vibe-studio-launcher={seg.route === "studio" ? "" : undefined} onClick={(event) => onRoute(seg.route, event)} aria-label={`${seg.name}: ${st.label}. Owned by ${seg.owner}. Open ${seg.owner}.`}>
                <span className={`loop-ic ${st.cls}`} style={{ background: "var(--surface-sunk)" }}>{React.createElement(Ic[seg.ic], { size: 16 })}</span>
                <span className="loop-name">{seg.name}</span>
                {stateChip(stKey)}
                <span className="loop-src">{failed ? "Read failed" : seg.src}</span>
                <span className="loop-need">{loopNeed(seg, stKey, focus, data)} <span className="rroute">Open {seg.owner} <Ic.arrow size={11}/></span></span>
              </button>
              <span className="loop-arrow"><Ic.arrow size={15}/></span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── launch readiness (sourced + routed, no score / no green-all) ───────────────────────────────
function readinessRows(b) {
  const loop = briefLoop(b);
  return [
    ["Offer ready", loop.offer, "catalog", b.offerId ? `Linked: ${b.offerName || "recorded in Offers"}` : "No offer linked to this brief."],
    ["Audience identified", loop.audience, "clients", b.audience ? `Recorded: ${b.audience}` : "No audience recorded."],
    ["Source content / creative ready", loop.content, "studio", b.contentNeeds ? "Content needs recorded; create it in Vibe Studio." : "No content needs recorded."],
    ["Target channels connected", "unavail", "social", "No customer-facing social / publishing provider is connected."],
    ["Publishing / distribution path", "unavail", "social", "Depends on a connected provider — not checked."],
    ["Conversations / follow-up path", "unavail", "social", "No connected messaging provider on this workspace."],
    ["Pipeline route ready", loop.pipeline, "pipeline", b.pipelineId ? `Linked to “${b.pipelineName || "a pipeline"}” · ${b.pipelineDealCount} deal${b.pipelineDealCount === 1 ? "" : "s"} (live).` : "Not routed to a pipeline."],
    ["Tracking / attribution evidence", "unavail", "analytics", "Leads count toward a campaign only when their link carries its tag (see Analytics). No order names a campaign, so revenue is never attributed to one."],
    ["Approvals complete", b.lifecycleStatus === "approved" || b.lifecycleStatus === "active" ? "ready" : b.lifecycleStatus === "ready_for_review" ? "await" : "planned", "overview",
      b.lifecycleStatus === "ready_for_review" ? "Awaiting your review." : b.lifecycleStatus === "approved" || b.lifecycleStatus === "active" ? "Approved." : "Not sent for review yet."],
  ];
}
function Readiness({ brief, onRoute }) {
  return (
    <div className="rd">
      <div className="rd-head"><Ic.shield size={15}/><h4>Launch readiness</h4>
        <div className="note">Every item is sourced and routed. No score, no green-all. “Unavailable / needs confirmation” where the platform can’t know.</div></div>
      <div className="rd-grid">
        {readinessRows(brief).map(([label, stKey, route, meta]) => {
          const st = ST[stKey] || ST.unavail;
          return (
            <div className="rd-item" key={label}>
              <div className="rk">{label}</div>
              <div className={`rs ${st.cls}`}><span className="sd"/>{st.label}</div>
              <div className="rmeta">{meta}</div>
              {route !== "overview" && <button className="rroute" data-solo-vibe-studio-launcher={route === "studio" ? "" : undefined} onClick={(event) => onRoute(route, event)}>Open {routeLabel(route)} <Ic.arrow size={11}/></button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CampaignOverview({ data, onRoute, autoOpenBrief = false, onAutoOpenConsumed = undefined }) {
  const briefsState = useSoloCampaignBriefs();
  // A REAL tenant-scoped Catalog read — the honest backing for the workspace-scope "Offer" loop
  // stage (§13). Only EXISTENCE is needed here, so a single-row page is enough (never the whole
  // catalog). "has" only when offers truly exist; "error" when the read failed; else unknown.
  const catalog = useCatalogOffers({ pageSize: 1 });
  const offerSignal = catalog.phase === "error" ? "error" : catalog.phase === "ready" ? (catalog.offers.length > 0 || catalog.hasMore ? "has" : "none") : "unknown";
  const [filters, setFilters] = React.useState({ phase: "all", src: "all", q: "" });
  const [openRow, setOpenRow] = React.useState(null);
  const [focusId, setFocusId] = React.useState(null);
  const [drawer, setDrawer] = React.useState(null); // {kind:'dossier'|'brief', briefId?}
  const [toast, setToast] = React.useState(null);
  const lastFocus = React.useRef(null);
  // Portal host for the drawers (BLOCKER §39). `useDrawerA11y` marks `.solo-campaigns > .campaigns-scroll`
  // `inert`; the desk renders INSIDE that node, so a drawer rendered inline would inert ITSELF the
  // instant it opened. We portal both drawers to the `.solo-campaigns` element — a SIBLING of the
  // inerted scroll region (never inerted) and still inside `.paige-solo` so the design tokens and the
  // light/dark theme resolve. This mirrors the pre-existing `DetailDrawer`, which is already a direct
  // child of `.solo-campaigns` for exactly this reason.
  const deskRef = React.useRef(null);

  const canManage = briefsState.canManage;
  const briefs = briefsState.briefs;
  const focus = focusId ? briefs.find((b) => b.id === focusId) : null;

  const showToast = React.useCallback((msg, kind = "nav") => {
    setToast({ msg, kind });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToast(null), 2600);
  }, []);
  const askPaige = React.useCallback((brief) => {
    // Opens the EXISTING Paige experience with campaign context. No second chat system, and Paige
    // does not launch/send/spend from here — the event carries context only.
    window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt: brief
      ? `Tell me only what is genuinely on record for the campaign brief “${brief.name}”, and name the source. Do not claim it is live, launched, sent, or published unless a governed action proves it. If a loop stage has no connected source, say so.`
      : "Using only the campaign briefs and connected sources on record for this workspace, help me plan or coordinate a campaign. Do not report reach, spend, attribution, or live status that no source proves." } }));
    showToast("Opening PAIGE with this campaign’s context. Paige can prepare and route — she never launches, sends, or spends without your approval.");
  }, [showToast]);

  const openDrawer = (kind, briefId) => { lastFocus.current = document.activeElement; setDrawer({ kind, briefId }); };
  const closeDrawer = React.useCallback(() => {
    setDrawer(null);
    if (lastFocus.current && lastFocus.current.isConnected) lastFocus.current.focus();
    lastFocus.current = null;
  }, []);

  // filtered portfolio
  const shown = briefs.filter((b) => {
    if (filters.phase !== "all" && b.lifecycleStatus !== filters.phase) return false;
    if (filters.q && !(b.name + " " + (b.objective || "")).toLowerCase().includes(filters.q.toLowerCase())) return false;
    if (filters.src !== "all") {
      const l = briefLoop(b);
      const live = Object.values(l).some((v) => v === "ready" || v === "partial");
      if (filters.src === "live" && !live) return false;
      if (filters.src === "unavail" && live) return false;
    }
    return true;
  });

  // command line — derived from ALL briefs, never the filtered subset
  const commandLine = () => {
    if (!briefs.length) return <>Nothing is in motion yet. <b className="move">Create a campaign brief</b> to give this workspace its first initiative.</>;
    const moving = briefs.filter((b) => ["active", "approved", "ready_for_review", "draft"].includes(b.lifecycleStatus)).length;
    const blocked = briefs.filter((b) => b.lifecycleStatus === "blocked" || b.blocker).length;
    const awaiting = briefs.filter((b) => b.lifecycleStatus === "ready_for_review").length;
    const next = briefs.find((b) => b.lifecycleStatus === "ready_for_review")
      || briefs.find((b) => b.lifecycleStatus === "blocked")
      || briefs.find((b) => b.blocker)
      || briefs.find((b) => b.lifecycleStatus === "draft") || briefs[0];
    let move;
    if (awaiting) move = <>Highest-value move: <b className="move">review the brief awaiting you — {next.name}</b>.</>;
    else if (blocked) move = <>Highest-value move: <b className="move">clear the blocker on {next.name}</b>{next.blocker ? ` — ${next.blocker}` : ""}.</>;
    else if (next && !next.offerId) move = <>Highest-value move: <b className="move">link an offer to {next.name}</b> so the ask is concrete.</>;
    else move = <>Highest-value move: <b className="move">keep building {next ? next.name : "your first campaign"}</b>.</>;
    return <>
      <span className="moving">{moving} moving</span>{blocked ? <> · <span className="blocked">{blocked} blocked</span></> : null} across {briefs.length} initiative{briefs.length > 1 ? "s" : ""}. {move}
    </>;
  };

  // ── loading / error / unavailable / first-run ────────────────────────────────────────────────
  // The desk depends on TWO tenant-scoped reads: the owner briefs (useSoloCampaignBriefs) and the
  // loop-source facts (useSoloCampaigns `data`: pipeline, artifacts). The top-level identity takes
  // the worse of the two, and Retry re-reads both — so no read failing is ever shown as "empty".
  const retryAll = () => { briefsState.retry(); if (typeof data.retry === "function") data.retry(); };
  const worst = (() => {
    const both = [briefsState.phase, data.phase];
    if (both.includes("unavailable")) return "unavailable";
    if (both.includes("resolving")) return "resolving";
    if (both.includes("error")) return "error";
    if (both.includes("loading")) return "loading";
    return "ready";
  })();
  // Marketing › Overview's "Create campaign brief" lands here with `?brief=new`. Open the builder once
  // both reads are ready (the drawer portals into the mounted desk), then hand the request back so a
  // refresh or Back does not reopen it. A member who cannot manage briefs is not shown a builder.
  React.useEffect(() => {
    if (!autoOpenBrief || worst !== "ready") return;
    if (canManage) {
      // The Overview button that asked for this has unmounted with the route change, so return focus
      // to the Campaigns tab instead of dropping it on <body> when the builder closes.
      const active = document.activeElement;
      lastFocus.current = active instanceof HTMLElement && active !== document.body && active.isConnected ? active : document.getElementById("campaigns-tab-campaigns");
      setDrawer({ kind: "brief" });
    }
    onAutoOpenConsumed?.();
  }, [autoOpenBrief, worst, canManage, onAutoOpenConsumed]);
  if (worst === "resolving")
    return <div className="campaigns-state" role="status"><span className="campaigns-spinner"/>Resolving this account’s Campaigns workspace…</div>;
  if (worst === "unavailable")
    return <div className="campaigns-state">{truth("UNAVAILABLE")}<h2>Campaigns needs a resolved workspace</h2><p>No tenant data is read until your account context is confirmed. Nothing is inferred and no rows are invented.</p></div>;
  if (worst === "loading")
    return <div className="desk"><div className="cmd" style={{ padding: "16px 18px" }}><div className="campaigns-skeleton" style={{ padding: 0 }}><span style={{ height: 44 }}/></div></div><div className="campaigns-skeleton"><span/><span/><span/></div></div>;
  if (worst === "error")
    return <div className="campaigns-state" role="alert">{truth("UNAVAILABLE")}<h2>Campaigns could not load</h2><p>Your records were not changed. Try the tenant-scoped read again.</p><button className="btn btn-s" onClick={retryAll}><Ic.arrow size={13}/>Retry</button></div>;

  // Portal host + drawer fragment, defined ABOVE the first-run branch so a brand-new tenant (0
  // briefs) can open the builder from the empty state too (§70 first use) — the drawers and
  // `deskRef` must exist in BOTH returns, not only the populated desk. `portalHost` resolves from
  // the mounted `.desk` node so the portal targets THIS campaigns instance, never a stray
  // `.solo-campaigns`; on the render that first opens a drawer, `deskRef` already holds the node
  // committed on the prior render (a drawer can only be opened from within a rendered `.desk`).
  const portalHost = deskRef.current ? deskRef.current.closest(".solo-campaigns") : null;
  const drawers = (
    <>
      {drawer?.kind === "dossier" && portalHost && (() => { const b = briefs.find((x) => x.id === drawer.briefId); return b
        ? createPortal(<DossierDrawer brief={b} canManage={canManage} onClose={closeDrawer} onRoute={onRoute} onAsk={() => askPaige(b)}
            onEdit={() => setDrawer({ kind: "brief", briefId: b.id })}
            onTransition={async (status, blocker, idem) => { const r = await briefsState.transitionBrief(b.id, status, b.version, blocker, idem); showToast(r.message, r.ok ? "ok" : "err"); if (r.ok) closeDrawer(); return r; }}
            onArchive={async (idem) => { const r = await briefsState.archiveBrief(b.id, b.version, idem); showToast(r.message, r.ok ? "ok" : "err"); if (r.ok) closeDrawer(); return r; }}/>, portalHost)
        : null; })()}
      {drawer?.kind === "brief" && portalHost && createPortal(
        <BriefBuilder existing={drawer.briefId ? briefs.find((x) => x.id === drawer.briefId) : null} data={data}
          onClose={closeDrawer} onRoute={onRoute}
          onSave={(draft, idem) => briefsState.saveBrief(draft, idem)}
          onRequestReview={async (briefId, version, idem) => briefsState.transitionBrief(briefId, "ready_for_review", version, undefined, idem)}
          onDone={(msg, kind = "ok") => { closeDrawer(); showToast(msg, kind); }}/>,
        portalHost,
      )}
    </>
  );

  if (briefs.length === 0) return <><div className="desk" ref={deskRef}><FirstRun canManage={canManage} onNew={() => canManage && openDrawer("brief")} onRoute={onRoute} data={data}/></div>{drawers}{toast && <Toast toast={toast}/>}</>;

  // ── the desk ─────────────────────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="desk" ref={deskRef}>
        {/* command header — compact, one gold act */}
        <section className="cmd" aria-label="Campaign command">
          <div className="cmd-brief">
            <div>
              <div className="eyebrow"><Ic.bolt size={13}/> Marketing · Campaigns</div>
              <div className="cmd-line">{commandLine()}</div>
              <div className="cmd-meta">
                <span><span className="dot" style={{ background: "var(--ok)" }}/>Live: Pipeline deals, published Vibe assets, recorded payments</span>
                <span><span className="dot" style={{ background: "var(--ink-3)" }}/>Unavailable: campaign rollup, attribution, provider figures</span>
              </div>
            </div>
            <div className="cmd-actions">
              {canManage && <button className="btn btn-g" onClick={() => openDrawer("brief")}><Ic.plus size={14}/> Create campaign brief</button>}
              <button className="btn" onClick={() => askPaige(null)}><Ic.spark size={14}/> Ask Paige to plan a campaign</button>
              <button className="btn" disabled title="No campaign calendar source is connected yet"><Ic.cal size={14}/> Campaign calendar</button>
              <span className="hint">Calendar/timeline appears when a real scheduling source is connected.</span>
            </div>
          </div>
          <div className="cmd-tools">
            <div className="cmd-search"><Ic.search size={15}/><input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Search campaigns, offers, objectives…" aria-label="Search campaigns"/></div>
            <span className="filterchip"><label>Phase</label>
              <select value={filters.phase} onChange={(e) => setFilters({ ...filters, phase: e.target.value })} aria-label="Filter by phase">
                <option value="all">All phases</option>
                {Object.keys(PHASE).filter((p) => p !== "archived").map((p) => <option key={p} value={p}>{PHASE[p][0]}</option>)}
              </select></span>
            <span className="filterchip"><label>Source state</label>
              <select value={filters.src} onChange={(e) => setFilters({ ...filters, src: e.target.value })} aria-label="Filter by source state">
                <option value="all">All</option><option value="live">Live-backed</option><option value="unavail">No live source</option>
              </select></span>
            <span className="filterchip is-off" title="Owner and channel filters need a campaign-object source that does not exist yet"><Ic.shield size={12}/><span className="lockmini">Owner · Channel · Date — available with a campaign source</span></span>
            <button className="btn btn-s" style={{ marginLeft: "auto" }} onClick={retryAll}><Ic.pulse size={13}/> Refresh sources</button>
          </div>
        </section>

        <LoopMap data={data} focus={focus} onClearFocus={() => setFocusId(null)} onRoute={onRoute} offerSignal={offerSignal}/>

        <div className="desk-grid">
          <section className="pf" aria-label="Campaign portfolio">
            <div className="pf-head"><Ic.grid size={16}/><h3>Campaign portfolio</h3><span className="count">{shown.length} of {briefs.length} shown{briefsState.archivedCount ? ` · ${briefsState.archivedCount} archived` : ""}</span></div>
            {shown.length === 0
              ? <div className="campaigns-state" style={{ minHeight: 150 }}>{truth("PARTIAL")}<h2>No campaigns match these filters</h2><p>Clear the filters, or create a brief. Campaign status is never inferred from partial or global records.</p><button className="btn btn-s" onClick={() => setFilters({ phase: "all", src: "all", q: "" })}>Clear filters</button></div>
              : shown.map((b) => (
                <PortfolioRow key={b.id} b={b} open={openRow === b.id} onToggle={() => setOpenRow(openRow === b.id ? null : b.id)}
                  onDossier={() => openDrawer("dossier", b.id)} onFocus={() => { setFocusId(b.id); }} onAsk={() => askPaige(b)} onRoute={onRoute}/>
              ))}
          </section>
          <WorkInMotion briefs={briefs} data={data} onDossier={(id) => openDrawer("dossier", id)} onAsk={() => askPaige(null)}/>
        </div>

        <div style={{ textAlign: "center", fontSize: 10.5, color: "var(--ink-3)", padding: "2px 0 6px" }}>
          Campaigns coordinates each initiative across Offers, Sales, Pipeline, Social, Analytics and Vibe Studio. It does not recreate them — every value routes to the surface that owns it.
        </div>
      </div>

      {drawers}

      {toast && <Toast toast={toast}/>}
    </>
  );
}

// ── portfolio row ──────────────────────────────────────────────────────────────────────────────
function PortfolioRow({ b, open, onToggle, onDossier, onFocus, onAsk, onRoute }) {
  const phaseIcon = b.lifecycleStatus === "active" ? "pulse" : b.lifecycleStatus === "paused" ? "clock" : b.lifecycleStatus === "blocked" ? "bell" : b.lifecycleStatus === "ready_for_review" ? "clock" : "bolt";
  return (
    <div className={`pf-row ${open ? "open" : ""}`}>
      <div className="pf-main" role="button" tabIndex={0} aria-expanded={open}
        aria-label={`${b.name}. ${b.objective || ""}. Expand launch readiness.`}
        onClick={(e) => { if (e.target.closest("[data-stop]")) return; onToggle(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}>
        <span className={`pf-phase ${(PHASE[b.lifecycleStatus] || ["", "st-unavail"])[1]}`}>{React.createElement(Ic[phaseIcon] || Ic.bolt, { size: 17 })}</span>
        <div className="pf-id">
          <div className="nm">{b.name} {phasePill(b.lifecycleStatus)}</div>
          {b.objective && <div className="obj">{b.objective}</div>}
          <div className="pf-facts">
            <span className={`pf-fact ${b.offerId ? "" : "warn"}`}><span className="fk">Offer</span>{b.offerName || (b.offerId ? "Linked" : "None linked")}</span>
            <span className={`pf-fact ${b.audience ? "" : "dim"}`}><span className="fk">Audience</span>{b.audience || "Not recorded"}</span>
            <span className={`pf-fact ${b.channels.length ? "" : "dim"}`}><span className="fk">Channels</span>{b.channels.length ? b.channels.join(" · ") : "None configured"}</span>
            {b.blocker && <span className="pf-fact warn"><Ic.bell size={11}/> {b.blocker}</span>}
          </div>
        </div>
        <div className="pf-end">
          <div className="pf-next"><b>Ref</b> {b.shortRef || "—"}</div>
          <div className="row" style={{ gap: 8 }} data-stop>
            <button className="btn btn-s" onClick={onDossier}>Open dossier</button>
            <span className="pf-caret"><Ic.chev size={16}/></span>
          </div>
        </div>
      </div>
      {open && (
        <div className="pf-fold">
          <Readiness brief={b} onRoute={onRoute}/>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-s" onClick={onFocus}><Ic.pulse size={13}/> Focus loop map on this</button>
            <button className="btn btn-s" onClick={onDossier}><Ic.doc size={13}/> Open dossier</button>
            <button className="btn btn-s" onClick={onAsk}><Ic.spark size={13}/> Ask PAIGE about this campaign</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── work in motion (real, attributable items only) ─────────────────────────────────────────────
function WorkInMotion({ briefs, data, onDossier, onAsk }) {
  const items = [];
  const awaiting = briefs.find((b) => b.lifecycleStatus === "ready_for_review");
  if (awaiting) items.push({ st: "await", ic: "clock", t: "Brief awaiting your review", s: `${awaiting.name}`, src: "Owner brief · ready for review", id: awaiting.id });
  const blocked = briefs.find((b) => b.blocker || b.lifecycleStatus === "blocked");
  if (blocked) items.push({ st: "blocked", ic: "bell", t: "Blocked initiative", s: `${blocked.name}${blocked.blocker ? `: ${blocked.blocker}` : ""}`, src: "Owner brief · dependency unmet" });
  const drafting = briefs.find((b) => b.lifecycleStatus === "draft");
  if (drafting) items.push({ st: "partial", ic: "doc", t: "Draft in progress", s: `${drafting.name}`, src: "Owner brief · draft" });
  const artifacts = (data.artifacts || []).length;
  if (artifacts) items.push({ st: "ready", ic: "spark", t: "Published creative", s: "Published Vibe assets are on record in this workspace.", src: "Read from your published pages, funnels and forms" });
  if (!items.length) items.push({ st: "planned", ic: "dots", t: "Nothing queued yet", s: "Real, attributable work appears here — a prepared brief, a review, a blocker, a completed outcome.", src: "No attributable work on record" });
  return (
    <section className="pf" aria-label="Work in motion">
      <div className="pf-head"><Ic.pulse size={16}/><h3>Work in motion</h3></div>
      <div style={{ padding: "12px 14px 14px" }}>
        <div className="wm-list">
          {items.map((it, i) => (
            <div className="wm" key={i}>
              <span className={`wm-ic ${ST[it.st].cls}`} style={{ background: "var(--surface-sunk)" }}>{React.createElement(Ic[it.ic] || Ic.dots, { size: 15 })}</span>
              <div><div className="wm-t">{it.t}</div><div className="wm-s">{it.s}</div><div className="wm-src">{it.src}</div></div>
              {it.id && <button className="btn btn-s" onClick={() => onDossier(it.id)}>Review</button>}
            </div>
          ))}
        </div>
        <button className="btn btn-s" style={{ marginTop: 12, width: "100%", justifyContent: "center" }} onClick={onAsk}><Ic.spark size={13}/> Ask PAIGE to coordinate this campaign</button>
        <p style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 9 }}>PAIGE can recommend, prepare, and route. She does not launch campaigns, spend, publish, or send without a governed approval.</p>
      </div>
    </section>
  );
}

// ── first-run guided sequence ──────────────────────────────────────────────────────────────────
function FirstRun({ canManage, onNew, onRoute, data }) {
  const steps = [
    ["1", "Identify what you sell", "Define your first offer — a product, service, program, or package. It becomes the thing a campaign points at.", "catalog"],
    ["2", "Choose a campaign objective", "Pick the outcome this initiative is for: fill a cohort, book calls, renew retainers, grow the list.", "new"],
    ["3", "Define the intended audience", "Name the segment this reaches — a saved segment, or describe it and Paige drafts the rule.", "clients"],
    ["4", "Choose the first distribution / content path", "A landing page, a form, an email — created in Vibe Studio and routed into a pipeline.", "studio"],
    ["5", "Connect sources only when needed", "Publishing and messaging providers connect in Social when a campaign actually needs them — not before.", "social"],
  ];
  return (
    <div className="fr">
      <div className="fr-hero">
        <div className="eyebrow"><Ic.bolt size={13}/> Marketing · Campaigns</div>
        <h2>Start your first growth initiative</h2>
        <p>This workspace has no campaigns yet. A campaign here is a <b>brief you author</b> — an objective, an offer, an audience, and a path through the loop. Nothing is invented for you. Build the first one step by step, or ask Paige to draft it.</p>
        <div className="fr-cta">
          {canManage && <button className="btn btn-g" onClick={onNew}><Ic.plus size={14}/> Create campaign brief</button>}
          <button className="btn" onClick={() => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt: "Help me plan my first campaign for this workspace. Ask me what I sell and who it is for; do not assume reach, spend, or live status." } }))}><Ic.spark size={14}/> Ask Paige to plan a campaign</button>
        </div>
        {!canManage && <p style={{ marginTop: 8, fontSize: 11.5 }}>You have read-only access. A workspace admin can create the first campaign brief.</p>}
      </div>
      <div className="fr-steps">
        {steps.map(([n, h, p, route]) => (
          <div className="fr-step" key={n}><span className="n">{n}</span><h4>{h}</h4><p>{p}</p>
            {route === "new"
              ? <button className="rroute" onClick={() => canManage && onNew()}>Start here <Ic.arrow size={12}/></button>
              : <button className="rroute" data-solo-vibe-studio-launcher={route === "studio" ? "" : undefined} onClick={(event) => onRoute(route, event)}>Open {routeLabel(route)} <Ic.arrow size={12}/></button>}
          </div>
        ))}
      </div>
      <div className="loop" style={{ opacity: 0.92 }}>
        <div className="loop-head"><span className="loop-ic st-planned" style={{ background: "var(--surface-sunk)" }}><Ic.pulse size={15}/></span><div><h3>The loop you’re building toward</h3><div className="sub">Each stage lights up as its real source connects. Nothing here claims data you don’t have.</div></div></div>
        <div className="loop-track">
          {LOOP.map((seg) => (
            <div className="loop-seg" key={seg.k}><div className="loop-node" style={{ cursor: "default" }}><span className="loop-ic st-planned" style={{ background: "var(--surface-sunk)" }}>{React.createElement(Ic[seg.ic], { size: 16 })}</span><span className="loop-name">{seg.name}</span>{stateChip("planned")}<span className="loop-src">{seg.owner}</span></div><span className="loop-arrow"><Ic.arrow size={15}/></span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── toast (pinned to the surface) ──────────────────────────────────────────────────────────────
function Toast({ toast }) {
  return <div className={`campaign-toast ${toast.kind}`} role="status"><span className="ti">{toast.kind === "ok" ? <Ic.check size={15}/> : toast.kind === "err" ? <Ic.bell size={15}/> : <Ic.spark size={15}/>}</span>{toast.msg}</div>;
}

// ── focus-trapped drawer shell ─────────────────────────────────────────────────────────────────
function useDrawerA11y(onClose) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const node = ref.current; if (!node) return;
    const bg = document.querySelectorAll(".solo-campaigns > .campaigns-nav, .solo-campaigns > .campaigns-scroll");
    bg.forEach((n) => n.setAttribute("inert", ""));
    const first = node.querySelector("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    first?.focus?.({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const f = [...node.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")].filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); bg.forEach((n) => n.removeAttribute("inert")); };
  }, [onClose]);
  return ref;
}

// ── dossier drawer ─────────────────────────────────────────────────────────────────────────────
function DossierDrawer({ brief: b, canManage, onClose, onRoute, onAsk, onEdit, onTransition, onArchive }) {
  const ref = useDrawerA11y(onClose);
  const [busy, setBusy] = React.useState(false);
  const act = (fn) => async () => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return (
    <>
      <button className="dw-scrim" tabIndex={-1} aria-label="Close" onClick={onClose}/>
      <aside className="dw" role="dialog" aria-modal="true" aria-labelledby="dw-title" ref={ref}>
        <header>
          <div><div className="eyebrow">Campaign dossier</div><h2 id="dw-title">{b.name}</h2><div className="sub">{(PHASE[b.lifecycleStatus] || ["—"])[0]}{b.shortRef ? ` · ${b.shortRef}` : ""} · updated {fmt(b.updatedAt)}</div></div>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close dossier"><Ic.x size={15}/></button>
        </header>
        <div className="dw-body">
          <div className="dw-sec"><h4>Brief</h4><div className="dw-note">{b.objective || "No objective recorded yet."}</div></div>
          <div className="dw-sec"><h4>Audience &amp; offer</h4>
            <div className="dw-kv">
              <div className="r"><span className="k">Linked offer</span><span className={`v ${b.offerId ? "" : "dim"}`}>{b.offerName || (b.offerId ? "Linked" : "None linked")}</span></div>
              <div className="r"><span className="k">Audience</span><span className={`v ${b.audience ? "" : "dim"}`}>{b.audience || "Not recorded"}</span></div>
              <div className="r"><span className="k">Channels</span><span className={`v ${b.channels.length ? "" : "dim"}`}>{b.channels.length ? b.channels.join(" · ") : "None configured"}</span></div>
              <div className="r"><span className="k">Budget target</span><span className={`v ${b.budgetTarget ? "" : "dim"}`}>{b.budgetTarget || "None set"}</span></div>
              <div className="r"><span className="k">Phase</span><span className="v">{(PHASE[b.lifecycleStatus] || ["—"])[0]}</span></div>
            </div>
            {b.budgetTarget && <div className="dw-note" style={{ marginTop: 8 }}>The budget target is a figure you set — not actual ad spend, a forecast, or connected media buying.</div>}
          </div>
          {b.blocker && <div className="dw-note" style={{ borderColor: "var(--bad)", background: "var(--bad-tint)", color: "var(--bad)" }}><Ic.bell size={13}/> Blocker: {b.blocker}</div>}
          <div className="dw-sec"><h4>Launch readiness</h4><Readiness brief={b} onRoute={onRoute}/></div>
          <div className="dw-sec"><h4>Source-linked evidence</h4>
            <div className="dw-links">
              <button className="dw-link" onClick={() => onRoute("pipeline")}><Ic.trend size={14}/> {b.pipelineId ? `Linked to “${b.pipelineName || "a pipeline"}” · ${b.pipelineDealCount} deal${b.pipelineDealCount === 1 ? "" : "s"} (live).` : "Not routed to a pipeline."} <span className="rroute">Pipeline <Ic.arrow size={11}/></span></button>
              <button className="dw-link" data-solo-vibe-studio-launcher onClick={(event) => onRoute("studio", event)}><Ic.spark size={14}/> {b.contentNeeds ? "Content needs recorded; creative lives in Vibe Studio." : "No content needs recorded."} <span className="rroute">Vibe <Ic.arrow size={11}/></span></button>
              <button className="dw-link" onClick={() => onRoute("analytics")}><Ic.chart size={14}/> Attribution: no order names a campaign. Revenue is never attributed here. <span className="rroute">Analytics <Ic.arrow size={11}/></span></button>
            </div>
          </div>
          <div className="dw-sec"><h4>Decision &amp; lifecycle</h4>
            <div className="dw-note" style={b.lifecycleStatus === "ready_for_review" ? { borderColor: "var(--warn)", background: "var(--warn-tint)" } : {}}>
              {b.lifecycleStatus === "ready_for_review" ? <><Ic.clock size={13}/> This brief is awaiting your review.</> : `Lifecycle: ${(PHASE[b.lifecycleStatus] || ["—"])[0]}. Only a governed action changes it — nothing is launched, sent, or published from here.`}
            </div>
          </div>
        </div>
        <div className="dw-foot">
          {canManage ? <>
            {b.lifecycleStatus === "ready_for_review" && <button className="btn btn-g" disabled={busy} onClick={act(() => onTransition("approved"))}><Ic.check size={14}/> Approve</button>}
            {["draft", "approved", "paused"].includes(b.lifecycleStatus) && <button className="btn" disabled={busy} onClick={act(() => onTransition("active"))}>Mark active</button>}
            {b.lifecycleStatus === "active" && <button className="btn" disabled={busy} onClick={act(() => onTransition("paused"))}>Pause</button>}
            <button className="btn" disabled={busy} onClick={onEdit}><Ic.gear size={13}/> Edit brief</button>
            <button className="btn" disabled={busy} onClick={act(() => onArchive())}>Archive</button>
          </> : <span style={{ fontSize: 11, color: "var(--ink-3)", display: "inline-flex", gap: 6, alignItems: "center" }}><Ic.shield size={12}/> Read-only — editing is unavailable for this role.</span>}
          <button className="btn" style={{ marginLeft: "auto" }} onClick={onAsk}><Ic.spark size={13}/> Ask PAIGE about this</button>
        </div>
      </aside>
    </>
  );
}

// ── brief builder ──────────────────────────────────────────────────────────────────────────────
const BB_STAGES = ["Name & objective", "Offer", "Audience", "Outcome", "Channels", "Timing & budget", "Content needs", "Conversion & follow-up", "Success evidence"];
const CHANNEL_OPTIONS = ["Landing page", "Email", "Form"];

function BriefBuilder({ existing, data, onClose, onRoute, onSave, onRequestReview, onDone }) {
  const ref = useDrawerA11y(onClose);
  const [stage, setStage] = React.useState(0);
  const [save, setSave] = React.useState("idle"); // idle | saving | error
  const [saveErr, setSaveErr] = React.useState(""); // the REAL server sentence, never a hardcoded line
  const [nameError, setNameError] = React.useState(false); // inline validation shown AT the name field
  // Double-submit guard (§39 MAJOR): a synchronous latch so a rapid double-click can't fire two
  // creates before React disables the button. Paired with a STABLE per-submit idempotency key —
  // regenerated for a fresh submit, REUSED on Retry — so the ledger dedupes a resend of the same
  // action instead of writing a second brief.
  const submitting = React.useRef(false);
  const idemRef = React.useRef(null);
  const wantReview = React.useRef(false); // preserves the "then request review" intent across a Retry
  const [d, setD] = React.useState(() => ({
    id: existing?.id ?? null,
    expectedVersion: existing?.version ?? null,
    name: existing?.name ?? "",
    objective: existing?.objective ?? "",
    audience: existing?.audience ?? "",
    positioning: existing?.positioning ?? "",
    channels: existing?.channels ? [...existing.channels] : [],
    desiredOutcome: existing?.desiredOutcome ?? "",
    successDefinition: existing?.successDefinition ?? "",
    budgetTarget: existing?.budgetTarget ?? "",
    timing: existing?.timing ?? "",
    constraints: existing?.constraints ?? "",
    contentNeeds: existing?.contentNeeds ?? "",
    conversionDestination: existing?.conversionDestination ?? "",
    followupPath: existing?.followupPath ?? "",
    offerId: existing?.offerId ?? null,
    pipelineId: existing?.pipelineId ?? null,
  }));
  const set = (patch) => setD((p) => ({ ...p, ...patch }));
  const toggleChannel = (c) => setD((p) => ({ ...p, channels: p.channels.includes(c) ? p.channels.filter((x) => x !== c) : [...p.channels, c] }));

  const pipelines = ((data.pipelineWorkspace && data.pipelineWorkspace.pipelines) || []).filter((p) => p.lifecycleStatus !== "archived");

  // Offer picker (§39 MAJOR): a REAL Catalog read, not a paste-a-UUID box. The server still
  // tenant-validates the chosen id; this only stops the owner from having to hand-type an offer id
  // that isn't theirs. `referenceIds` keeps the currently-linked offer resolvable while searching.
  const [offerSearch, setOfferSearch] = React.useState("");
  const [offerPage, setOfferPage] = React.useState(0);
  const offers = useCatalogOffers({ search: offerSearch, page: offerPage, pageSize: 5, referenceIds: d.offerId ? [d.offerId] : [] });
  const offerRows = [...offers.offers, ...(offers.referencedOffers || [])].filter((o, i, rows) => rows.findIndex((x) => x.id === o.id) === i);

  // `retry` reuses the SAME idempotency key so a resend of a submit that actually persisted is
  // deduped by the ledger; a fresh submit mints a new one.
  const persist = async (thenReview, isRetry = false) => {
    if (submitting.current) return;
    if (!d.name.trim()) { setStage(0); setSave("idle"); setNameError(true); return; }
    submitting.current = true;
    wantReview.current = thenReview;
    if (!isRetry || !idemRef.current) idemRef.current = { save: crypto.randomUUID(), review: crypto.randomUUID() };
    setSave("saving"); setSaveErr("");
    try {
      const res = await onSave(d, idemRef.current.save);
      if (!res.ok) {
        // A stale (version-conflict) refusal was refreshed by the hook; a blind Retry would just fail
        // again on the frozen expected version. Surface the real message and close so the owner reopens
        // on current data. Any other failure keeps the drawer open with a Retry (a resend is valid).
        if (res.stale) { onDone(res.message, "err"); return; }
        setSaveErr(res.message || "That change could not be saved. Nothing else was changed."); setSave("error");
        return;
      }
      if (thenReview) {
        const id = res.data?.brief_id || d.id;
        const version = typeof res.data?.version === "number" ? res.data.version : (d.expectedVersion ? d.expectedVersion + 1 : 1);
        if (!id) { onDone(d.id ? "Campaign brief saved." : "Campaign brief saved as a draft on this workspace.", "ok"); return; }
        const rev = await onRequestReview(id, version, idemRef.current.review);
        if (rev && rev.ok) onDone("Brief saved and sent for review.", "ok");
        else onDone(`Saved as a draft — but it could not be sent for review. ${rev?.message || "Open it to try again."}`, "err");
      } else {
        onDone(d.id ? "Campaign brief saved." : "Campaign brief saved as a draft on this workspace.", "ok");
      }
    } finally {
      submitting.current = false;
    }
  };

  let body;
  if (stage === 0) body = <>
    <div className="bb-field"><label>Campaign name <span className="req">Required</span></label><input value={d.name} onChange={(e) => { set({ name: e.target.value }); if (nameError) setNameError(false); }} placeholder="e.g. Spring Masterclass launch" aria-invalid={nameError || undefined}/>{nameError && <span className="help warn">A campaign brief needs a name before it can be saved.</span>}</div>
    <div className="bb-field"><label>Objective</label><textarea value={d.objective} onChange={(e) => set({ objective: e.target.value })} placeholder="The measurable outcome — fill a cohort, book 10 calls, renew the retainers…"/><span className="help">Plain English. This becomes the “what is this for” the whole loop points at.</span></div>
  </>;
  else if (stage === 1) body = <>
    <div className="bb-field"><label>Linked offer <span className="opt">Optional</span></label>
      <input type="search" value={offerSearch} onChange={(e) => { setOfferSearch(e.target.value); setOfferPage(0); }} placeholder="Search your offers by name…" aria-label="Search offers"/>
      <div className="bb-pagerow">
        <span role="status">{offers.phase === "ready" ? `Offer page ${offerPage + 1}` : offers.phase === "error" ? "Could not load offers" : "Loading offers…"}</span>
        {offers.phase === "error" && <button type="button" className="btn btn-s" onClick={offers.retry}>Retry</button>}
        <button type="button" className="btn btn-s" disabled={!offerPage || offers.phase !== "ready"} onClick={() => setOfferPage((p) => p - 1)}>Previous</button>
        <button type="button" className="btn btn-s" disabled={!offers.hasMore || offers.phase !== "ready"} onClick={() => setOfferPage((p) => p + 1)}>Next</button>
      </div>
      <select value={d.offerId || ""} onChange={(e) => set({ offerId: e.target.value || null })} aria-label="Linked offer">
        <option value="">No offer linked</option>
        {offerRows.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <span className="help">Offers live in <b>Offers</b>. The server validates the offer belongs to this workspace; an offer that isn’t yours is refused.</span></div>
    {offers.phase === "ready" && !offerRows.length && !offerSearch && <div className="dw-note">This workspace has no offers yet. Create one in Offers, then link it here.</div>}
    <div className="bb-link"><Ic.plus size={13}/> Manage your offers. <button className="rroute" onClick={() => onRoute("catalog")}>Open Offers <Ic.arrow size={11}/></button></div>
  </>;
  else if (stage === 2) body = <>
    <div className="bb-field"><label>Target audience</label><input value={d.audience} onChange={(e) => set({ audience: e.target.value })} placeholder="A saved segment, or describe who this reaches"/><span className="help">Segments live in <b>Relationships</b>. Sizing stays honest — a segment is never given a fabricated count.</span></div>
    <div className="bb-field"><label>Positioning</label><textarea value={d.positioning} onChange={(e) => set({ positioning: e.target.value })} placeholder="The angle — why this audience, why now."/></div>
  </>;
  else if (stage === 3) body = <div className="bb-field"><label>Desired business outcome</label><textarea value={d.desiredOutcome} onChange={(e) => set({ desiredOutcome: e.target.value })} placeholder="What changes for the business if this works."/></div>;
  else if (stage === 4) body = <div className="bb-field"><label>Channels / tactics</label>
    <div className="chips-pick">
      {CHANNEL_OPTIONS.map((c) => <button key={c} aria-pressed={d.channels.includes(c)} onClick={() => toggleChannel(c)}>{c}</button>)}
      <button aria-pressed={false} disabled title="No connected social provider"><Ic.shield size={11}/> Social publishing</button>
      <button aria-pressed={false} disabled title="No connected messaging provider"><Ic.shield size={11}/> SMS</button>
    </div>
    <span className="help warn">Social publishing and SMS are disabled until a provider is connected in Social — the brief never pretends a channel is ready.</span></div>;
  else if (stage === 5) body = <>
    <div className="bb-field"><label>Timing</label><input value={d.timing} onChange={(e) => set({ timing: e.target.value })} placeholder="e.g. Launch April 8, close April 22"/></div>
    <div className="bb-field"><label>Budget target <span className="opt">Optional</span></label><input value={d.budgetTarget} onChange={(e) => set({ budgetTarget: e.target.value })} placeholder="e.g. $500"/>
      <span className="help warn">This is a target you’re setting — <b>not</b> actual ad spend, a forecast, or connected media buying. Real spend needs a connected ad provider, which doesn’t exist yet.</span></div>
  </>;
  else if (stage === 6) body = <>
    <div className="bb-field"><label>Content / source-material needs</label><textarea value={d.contentNeeds} onChange={(e) => set({ contentNeeds: e.target.value })} placeholder="What creative this needs — a page, a funnel, a form, an email sequence."/><span className="help">Creative is made in <b>Vibe Studio</b>. This just records what’s needed.</span></div>
    <div className="bb-link"><Ic.spark size={13}/> Create the creative in Vibe Studio. <button className="rroute" data-solo-vibe-studio-launcher onClick={(event) => onRoute("studio", event)}>Open Vibe Studio <Ic.arrow size={11}/></button></div>
  </>;
  else if (stage === 7) body = <>
    <div className="bb-field"><label>Conversion destination</label><input value={d.conversionDestination} onChange={(e) => set({ conversionDestination: e.target.value })} placeholder="Where the audience lands — a page, a form, a booking."/></div>
    <div className="bb-field"><label>Route to a pipeline <span className="opt">Optional</span></label>
      <select value={d.pipelineId || ""} onChange={(e) => set({ pipelineId: e.target.value || null })}>
        <option value="">Not routed to a pipeline</option>
        {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}{p.shortRef ? ` · ${p.shortRef}` : ""}</option>)}
      </select>
      <span className="help">Pipelines are owned by <b>Pipeline</b>. Routing here links the campaign; deals stay in Pipeline.</span></div>
    <div className="bb-field"><label>Follow-up path</label><input value={d.followupPath} onChange={(e) => set({ followupPath: e.target.value })} placeholder="How you follow up — 1:1, sequence, call"/><span className="help">Automated follow-up needs a connected messaging provider. Until then, follow-up is manual and the brief says so.</span></div>
  </>;
  else body = <>
    <div className="bb-field"><label>Success evidence / measurement plan</label><textarea value={d.successDefinition} onChange={(e) => set({ successDefinition: e.target.value })} placeholder="How you’ll know it worked — recorded payments, deals moved, seats filled."/><span className="help">Only sources that exist can measure it. Cross-campaign attribution isn’t available yet, so name the concrete evidence you’ll check.</span></div>
    <div className="dw-note">Review: “{d.name || "Untitled brief"}” — {d.objective || "no objective yet"}. Saving files this as a <b>draft</b> on this workspace. Nothing is launched, sent, or published.</div>
  </>;

  const saveEcho = save === "saving" ? <span className="bb-save saving"><Ic.pulse size={13}/> Saving…</span>
    : save === "error" ? <span className="bb-save err"><Ic.bell size={13}/> {saveErr || "That change could not be saved. Nothing else was changed."} <button className="btn btn-s" onClick={() => persist(wantReview.current, true)}>Retry</button></span>
    : null;

  return (
    <>
      <button className="dw-scrim" tabIndex={-1} aria-label="Cancel" onClick={onClose}/>
      <aside className="dw" role="dialog" aria-modal="true" aria-labelledby="bb-title" ref={ref}>
        <header>
          <div><div className="eyebrow">{d.id ? "Edit brief" : "New campaign brief"}</div><h2 id="bb-title">{d.name || "Untitled campaign"}</h2><div className="sub">Step {stage + 1} of {BB_STAGES.length} · {BB_STAGES[stage]}</div></div>
          <button className="btn btn-icon" onClick={onClose} aria-label="Cancel and close"><Ic.x size={15}/></button>
        </header>
        <div className="dw-body">
          <div className="bb-stages">{BB_STAGES.map((s, i) => <button key={s} className="bb-chip" data-done={i < stage} aria-current={i === stage} onClick={() => setStage(i)}>{i < stage ? <Ic.check size={11}/> : null}{s}</button>)}</div>
          {body}
        </div>
        <div className="dw-foot">
          <button className="btn" disabled={stage === 0} onClick={() => setStage(Math.max(0, stage - 1))}>Back</button>
          {stage < BB_STAGES.length - 1 && <button className="btn btn-p" onClick={() => setStage(stage + 1)}>Continue</button>}
          <span style={{ marginLeft: "auto" }}/>
          {saveEcho || <>
            <button className="btn" disabled={save === "saving"} onClick={() => persist(false)}><Ic.doc size={13}/> Save draft</button>
            {stage === BB_STAGES.length - 1 && <button className="btn btn-g" disabled={save === "saving"} onClick={() => persist(true)}><Ic.check size={14}/> Request review</button>}
          </>}
        </div>
      </aside>
    </>
  );
}
