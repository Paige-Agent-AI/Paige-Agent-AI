// The pipeline lead funnel, shared by Ads › Overview and Marketing › Analytics (owner rulings
// 2026-10-11: Sales pipelines are the lifecycle of a lead; Marketing, Sales and Ads read the SAME
// pipelines and stages; Ads and Marketing count leads by stage per campaign tag and per ad tag through
// ONE server read).
//
//   get_pipeline_lead_funnel(p_pipeline_id, p_since)   the server count: deals per stage of the chosen
//                                                       pipeline, and the leads whose deal is in it, by
//                                                       utm_campaign and by utm_content
//
// When that read is not available (not deployed yet, or it failed) the panel counts the same shape from
// records the page holds (ads-model.ts deriveLeadFunnel) and says so in its own words, never silently.
// Nothing here is spend, reach, clicks or return. Nothing is written.
import React from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunction, parseLeadFunnel, type FunnelAd, type FunnelCampaign, type LeadFunnel } from "./ads-model";
import "./pipeline-lead-funnel.css";

const DAY = 86_400_000;
const n = (count: number) => count.toLocaleString();
const plural = (count: number, noun: string) => `${n(count)} ${noun}${count === 1 ? "" : "s"}`;

/** The start of the window, at a day boundary so the read stays the same for the whole day. */
export function sinceFor(days: number | null, now = Date.now()): string | null {
  if (!days) return null;
  const today = new Date(now);
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - days * DAY).toISOString();
}

export type PipelineChoice = { id: string; name: string; isDefault: boolean; deals: number };
export type FunnelRead = {
  phase: "idle" | "loading" | "ready" | "error";
  funnel: LeadFunnel | null;
  /** Where the figures came from: the server count, or the records this page read. */
  source: "server" | "records" | null;
  /** Why the server count was not used: it isn't there yet, or it failed. */
  reason: "unavailable" | "failed" | null;
  /** True when the records were a capped read, so the lead rows are floors. */
  capped: boolean;
  retry: () => void;
};
export type FunnelFallback = (pipeline: PipelineChoice, since: string | null) => Promise<{ funnel: LeadFunnel; capped: boolean }>;

/** Reads the server count for one pipeline and window; falls back to `fallback` when it can't. */
export function useLeadFunnel({ tenantId, pipeline, since, fallback }: { tenantId: string | null; pipeline: PipelineChoice | null; since: string | null; fallback: FunnelFallback }): FunnelRead {
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<Omit<FunnelRead, "retry"> & { key: string | null }>({ key: null, phase: "idle", funnel: null, source: null, reason: null, capped: false });
  const fallbackRef = React.useRef(fallback);
  fallbackRef.current = fallback;
  const pipelineRef = React.useRef(pipeline);
  pipelineRef.current = pipeline;
  // Once the server says the function is not there, this page stops asking for it.
  const missing = React.useRef(false);
  const key = tenantId && pipeline ? `${tenantId}:${pipeline.id}:${since ?? "all"}` : null;
  React.useEffect(() => {
    const chosen = pipelineRef.current;
    if (!key || !chosen) { setState({ key: null, phase: "idle", funnel: null, source: null, reason: null, capped: false }); return; }
    let live = true;
    // Keep the last figures on screen while the next pipeline or window loads, so nothing jumps.
    setState((previous) => ({ ...previous, key, phase: "loading" }));
    void (async () => {
      let reason: FunnelRead["reason"] = "unavailable";
      if (!missing.current) {
        try {
          const { data, error } = await supabase.rpc("get_pipeline_lead_funnel" as never, { p_pipeline_id: chosen.id, p_since: since } as never);
          if (!error) {
            const parsed = parseLeadFunnel(data);
            if (parsed) { if (live) setState({ key, phase: "ready", funnel: parsed, source: "server", reason: null, capped: false }); return; }
            console.error("[lead-funnel] the server answer was not the funnel shape", data);
            reason = "failed";
          } else if (isMissingFunction(error)) {
            missing.current = true;
          } else {
            console.error("[lead-funnel] server read failed", error);
            reason = "failed";
          }
        } catch (error) {
          console.error("[lead-funnel] server read failed", error);
          reason = "failed";
        }
      }
      try {
        const { funnel, capped } = await fallbackRef.current(chosen, since);
        if (live) setState({ key, phase: "ready", funnel, source: "records", reason, capped });
      } catch (error) {
        console.error("[lead-funnel] could not count from records", error);
        if (live) setState({ key, phase: "error", funnel: null, source: null, reason, capped: false });
      }
    })();
    return () => { live = false; };
  }, [key, since, attempt]);
  const current = state.key === key;
  return {
    phase: !key ? "idle" : current ? state.phase : "loading",
    funnel: state.funnel && state.funnel.pipeline.id === pipeline?.id ? state.funnel : null,
    source: current ? state.source : null,
    reason: current ? state.reason : null,
    capped: current ? state.capped : false,
    retry: () => setAttempt((value) => value + 1),
  };
}

/* ───────── choosing a pipeline: built for many (a business may run five or ten) ───────── */

export function PipelinePicker({ choices, value, onChange }: { choices: PipelineChoice[]; value: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [place, setPlace] = React.useState<React.CSSProperties>({});
  const [theme, setTheme] = React.useState("light");
  const wrap = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const pop = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const current = choices.find((choice) => choice.id === value);
  const list = choices.filter((choice) => choice.name.toLowerCase().includes(query.trim().toLowerCase()));
  const searchable = choices.length > 5;
  // The list renders at the page root so a card's overflow never clips it, under its button and inside
  // the viewport, in the button's own theme. An outside press, a scroll outside it or a resize closes it.
  React.useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    // Opens below its button, or above it when the viewport has more room there.
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    setPlace(below >= 240 || below >= above
      ? { position: "fixed", top: rect.bottom + 6, left, width, maxHeight: Math.max(160, Math.min(360, below)) }
      : { position: "fixed", bottom: window.innerHeight - rect.top + 6, left, width, maxHeight: Math.min(360, above) });
    setTheme(button.current.closest("[data-theme]")?.getAttribute("data-theme") ?? "light");
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const away = (event: Event) => { if (!wrap.current?.contains(event.target as Node) && !pop.current?.contains(event.target as Node)) setOpen(false); };
    const scrolled = (event: Event) => { if (!pop.current?.contains(event.target as Node)) setOpen(false); };
    const resized = () => setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", resized);
    return () => { window.removeEventListener("mousedown", away); window.removeEventListener("scroll", scrolled, true); window.removeEventListener("resize", resized); };
  }, [open]);
  React.useEffect(() => { setActive(Math.max(0, list.findIndex((choice) => choice.id === value))); }, [open, query]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when the list opens or the search changes
  if (!choices.length) return null;
  if (choices.length === 1) return <span className="plf-picker is-one"><span className="plf-picker-k">Pipeline</span><strong>{choices[0].name}</strong></span>;
  const choose = (pipelineId: string) => { onChange(pipelineId); setOpen(false); setQuery(""); button.current?.focus(); };
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); button.current?.focus(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(list.length - 1, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === "Home") { event.preventDefault(); setActive(0); }
    else if (event.key === "End") { event.preventDefault(); setActive(list.length - 1); }
    else if (event.key === "Enter" && list[active]) { event.preventDefault(); choose(list[active].id); }
  };
  const activeId = list[active] ? `${id}-${list[active].id}` : undefined;
  return <div className="plf-picker" ref={wrap}>
    <button ref={button} type="button" className="plf-picker-btn" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} onClick={() => setOpen((value) => !value)}>
      <span className="plf-picker-k">Pipeline</span><strong>{current?.name ?? "Choose a pipeline"}</strong>
      <span className="plf-picker-n">{`${choices.length} in Sales`}</span>
      <ChevronDown size={13} aria-hidden="true"/>
    </button>
    {open && createPortal(<div className="paige-solo plf-pop-root" data-theme={theme}><div ref={pop} className="plf-pop" style={place} onKeyDown={onKey}>
      {searchable && <input autoFocus className="plf-pop-q" type="search" placeholder="Find a pipeline" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find a pipeline" aria-controls={`${id}-list`} aria-activedescendant={activeId}/>}
      <ul id={`${id}-list`} role="listbox" aria-label="Sales pipelines" tabIndex={searchable ? -1 : 0} ref={(node) => { if (node && !searchable && document.activeElement === button.current) node.focus(); }} aria-activedescendant={activeId}>
        {list.map((choice, index) => <li key={choice.id} id={`${id}-${choice.id}`} role="option" aria-selected={choice.id === value} className={index === active ? "is-active" : undefined} onMouseEnter={() => setActive(index)} onClick={() => choose(choice.id)}>
          <span>{choice.name}</span>{choice.isDefault && <small className="pill pill-v">Default</small>}<em>{plural(choice.deals, "deal")}</em>
        </li>)}
        {!list.length && <li className="plf-pop-none" aria-disabled="true">No pipeline matches “{query}”</li>}
      </ul>
    </div></div>, document.body)}
  </div>;
}

/* ───────── the panel ───────── */

const ROWS = 8;
export type AdName = { title: string; thumb: string | null; kind: "image" | "video" };

export type LeadFunnelPanelProps = {
  /** The heading and its one line; each department words its own. */
  title: string;
  /** "in the last 30 days", "over all time": appended to the summary lines. */
  periodWords: string;
  choices: PipelineChoice[];
  /** False while the pipelines themselves are still being read. */
  choicesReady: boolean;
  choicesFailed?: boolean;
  pipelineId: string | null;
  onPipeline: (id: string) => void;
  read: FunnelRead;
  /** A control of the host's own, e.g. a period switch, beside the pipeline picker. */
  controls?: React.ReactNode;
  /** Ad tags that are library pictures: drawn with their thumbnail and title. */
  adNames?: Map<string, AdName>;
  /** How a lead gets credited to an ad, said where the ad table is empty. */
  adHint: string;
  /** How many leads the records fallback read at most, for its honest note. */
  recordLimit: number;
  onOpenSales?: (() => void) | null;
};

export function LeadFunnelPanel({ title, periodWords, choices, choicesReady, choicesFailed, pipelineId, onPipeline, read, controls, adNames, adHint, recordLimit, onOpenSales }: LeadFunnelPanelProps) {
  const headingId = React.useId();
  const funnel = read.funnel;
  const head = <header className="mov-head plf-head">
    <div><h2 id={headingId}>{title}</h2><p>{funnel ? <>Deals by stage on <b>{funnel.pipeline.name}</b>, and the leads {periodWords} that reached it, by campaign tag and ad tag</> : "Deals by stage on one Sales pipeline, and the leads that reached it"}</p></div>
    <div className="plf-acts">{controls}<PipelinePicker choices={choices} value={pipelineId} onChange={onPipeline}/></div>
  </header>;

  let body: React.ReactNode;
  if (!choicesReady && !choicesFailed) body = <div className="campaigns-skeleton plf-skel" role="status" aria-busy="true" aria-label="Loading your pipelines"><span/><span/><span/></div>;
  else if (choicesFailed) body = <div className="plf-empty" role="alert"><h3>Your pipelines couldn’t load</h3><p>Nothing was changed. Reload the page to try again.</p></div>;
  else if (!choices.length) body = <div className="plf-empty"><h3>No Sales pipeline yet</h3><p>Leads from your forms land in your default pipeline’s first stage. Once Sales has a pipeline, every lead and where it stands shows here.</p>{onOpenSales && <button type="button" className="btn btn-s" onClick={onOpenSales}>Open Sales</button>}</div>;
  else if (read.phase === "error") body = <div className="plf-empty" role="alert"><h3>These counts couldn’t load</h3><p>Nothing was changed.</p><button type="button" className="btn btn-s" onClick={read.retry}>Try again</button></div>;
  else if (!funnel) body = <div className="campaigns-skeleton plf-skel" role="status" aria-busy="true" aria-label="Counting leads by stage"><span/><span/><span/></div>;
  else body = <FunnelBody funnel={funnel} read={read} periodWords={periodWords} adNames={adNames} adHint={adHint} recordLimit={recordLimit}/>;

  return <section className="mov-card plf" aria-labelledby={headingId} aria-busy={read.phase === "loading" || undefined} data-funnel-source={read.source ?? undefined}>
    {head}
    {body}
  </section>;
}

function FunnelBody({ funnel, read, periodWords, adNames, adHint, recordLimit }: { funnel: LeadFunnel; read: FunnelRead; periodWords: string; adNames?: Map<string, AdName>; adHint: string; recordLimit: number }) {
  const deals = funnel.stages.reduce((sum, stage) => sum + stage.deals, 0);
  const max = Math.max(1, ...funnel.stages.map((stage) => stage.deals));
  const floor = (count: number) => `${n(count)}${read.capped ? "+" : ""}`;
  const stageName = new Map(funnel.stages.map((stage) => [stage.id, stage.name]));
  return <div className="plf-body">
    <div className="plf-shape">
      {funnel.stages.length
        ? <ol className="plf-stages" aria-label={`Deals by stage on ${funnel.pipeline.name}`}>{funnel.stages.map((stage) => <li key={stage.id} className={`plf-stage is-${stage.stageType}`}>
          <span className="plf-stage-t">{stage.name}{stage.stageType !== "open" && <small>{stage.stageType === "won" ? "Won" : "Lost"}</small>}</span>
          <span className="plf-stage-bar" aria-hidden="true"><i style={{ transform: `scaleX(${stage.deals ? Math.max(0.06, stage.deals / max) : 0})` }}/></span>
          <b className="plf-stage-n" aria-label={plural(stage.deals, "deal")}>{n(stage.deals)}</b>
        </li>)}</ol>
        : <div className="plf-empty is-inline"><h3>This pipeline has no stages yet</h3><p>Add stages in Sales and its deals show here, stage by stage.</p></div>}
      <p className="plf-sum">
        <b>{plural(deals, "deal")}</b> on this pipeline now. <b>{read.capped ? floor(funnel.leads.total) : n(funnel.leads.total)}</b> {funnel.leads.total === 1 ? "lead" : "leads"} {periodWords} reached it{funnel.leads.total ? <>, and <b>{floor(funnel.leads.tagged)}</b> carried a campaign or ad tag</> : ""}.
      </p>
    </div>
    <OutcomeTable area="camp" caption="By campaign" first="Campaign" rows={funnel.campaigns.map((row) => ({ key: row.campaign, label: <span className="plf-tag">{row.campaign}</span>, detail: stageSpread(row, stageName), ...row }))}
        empty={funnel.leads.total ? `None of these leads carried a campaign tag (utm_campaign). Tag the links in your ads, posts and emails and each campaign’s leads show here.` : `No lead ${periodWords} has reached this pipeline yet.`} floor={floor}/>
    <OutcomeTable area="ad" caption="By ad" first="Ad" rows={funnel.ads.map((row) => ({ key: row.ad, label: <AdLabel row={row} names={adNames}/>, detail: row.campaign ? `Campaign ${row.campaign}` : null, ...row }))}
        empty={funnel.leads.total ? adHint : `No lead ${periodWords} has reached this pipeline yet.`} floor={floor}/>
    {read.source === "records" && <p className="mov-foot plf-note">{read.reason === "failed" ? "The server count couldn’t load" : "The server count isn’t available yet"}, so these figures are counted from {read.capped ? `the latest ${n(recordLimit)} leads read here; each lead count is a floor` : "the leads read here"}. Deals by stage count every deal in the pipeline.</p>}
  </div>;
}

function stageSpread(row: FunnelCampaign, names: Map<string, string>): string | null {
  const parts = Object.entries(row.byStage).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([stage, count]) => `${n(count)} in ${names.get(stage) ?? "a stage no longer on this pipeline"}`);
  return parts.length ? parts.join(" · ") : null;
}

function AdLabel({ row, names }: { row: FunnelAd; names?: Map<string, AdName> }) {
  const known = names?.get(row.ad.toLowerCase());
  // A library picture's tag is its id: unnamed here, it reads as a picture, not as a raw id.
  if (!known) return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.ad)
    ? <span className="plf-tag" title={`The ad tag on the lead’s link: utm_content=${row.ad}`}>Library picture …{row.ad.slice(-4)}</span>
    : <span className="plf-tag" title="The ad tag (utm_content) on the lead’s link">{row.ad}</span>;
  return <span className="plf-ad">
    <span className="plf-thumb" aria-hidden="true">{known.thumb ? known.kind === "video" ? <video src={known.thumb} muted playsInline preload="metadata"/> : <img src={known.thumb} alt="" loading="lazy"/> : null}</span>
    <span className="plf-ad-t">{known.title}</span>
  </span>;
}

type Row = { key: string; label: React.ReactNode; detail: string | null; leads: number; open: number; won: number; lost: number };

function OutcomeTable({ area, caption, first, rows, empty, floor }: { area: "camp" | "ad"; caption: string; first: string; rows: Row[]; empty: string; floor: (count: number) => string }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? rows : rows.slice(0, ROWS);
  return <div className={`plf-table is-${area}`}>
    <h3>{caption}</h3>
    {rows.length
      ? <>
        <table>
          <caption className="campaigns-sr-only">{caption}: leads, and how many are open, won or lost</caption>
          <thead><tr><th scope="col">{first}</th><th scope="col">Leads</th><th scope="col">Open</th><th scope="col">Won</th><th scope="col">Lost</th></tr></thead>
          <tbody>{shown.map((row) => <tr key={row.key}>
            <th scope="row">{row.label}{row.detail && <small>{row.detail}</small>}</th>
            <td>{floor(row.leads)}</td><td>{floor(row.open)}</td><td className={row.won ? "is-won" : undefined}>{floor(row.won)}</td><td>{floor(row.lost)}</td>
          </tr>)}</tbody>
        </table>
        {rows.length > ROWS && <button type="button" className="mov-lnk plf-more" aria-expanded={all} onClick={() => setAll((value) => !value)}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>}
      </>
      : <p className="plf-table-empty">{empty}</p>}
  </div>;
}
