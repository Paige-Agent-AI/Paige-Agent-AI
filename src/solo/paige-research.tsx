import { useEffect, useRef } from "react";
import {
  Search, BookOpen, FileSearch, ChevronLeft, RotateCw, ExternalLink, ShieldQuestion, ListChecks,
} from "lucide-react";
import { EntityDossier, type EntityProfile } from "@/components/dashboard/EntityDossier";
import { useDeepResearch, type ResearchRunRow } from "@/solo/data/deepResearch";

/**
 * Research — the evidence LIBRARY of the R2b reshape (owner ruling 2026-10-03;
 * INT-303 lineage): PAIGE Chat is where research is invoked and experienced
 * (the inline card), and every saved run lands here through the SAME governed
 * list/get the chat reload uses — one substrate, one citation identity, no
 * second engine, no second history. No hero form and no fake progress: the
 * detail state is the engine's own outcome vocabulary, and "saved" is claimed
 * only after the governed readback proves the row exists.
 */

const STOP_WORDS: Record<string, string> = {
  answered: "Completed",
  max_hops: "Depth reached",
  budget: "Research budget reached",
  wall_clock: "Time limit reached",
  no_results: "No credible sources",
  unconfigured: "Search not configured",
  error: "Engine error",
};

const stopLabel = (reason: string | null) =>
  reason ? (STOP_WORDS[reason] ?? "Stopped") : "Completed";

const ConfidencePill = ({ level }: { level: string }) => {
  const tone = level === "high" ? "spw-truth-live" : level === "medium" ? "spw-truth-partial" : "spw-truth-neutral";
  return <span className={`spw-truth ${tone}`}>{level} confidence</span>;
};

const ReliabilityMark = ({ tier, reliability }: { tier: string | null; reliability: string | null }) => (
  <span className="dr-source-grade">{tier ?? "—"} · {reliability ?? "unrated"}</span>
);

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return "—"; }
};

const FAIL_WORDS: Record<string, { title: string; body: string }> = {
  engine_unreachable: {
    title: "Research could not run",
    body: "The research engine could not be reached. Check your connection and try again — nothing was charged or saved.",
  },
  search_unconfigured: {
    title: "Live web search is not configured",
    body: "PAIGE's cited research needs the web-search provider, which is not configured for this platform yet. Ask in Chat for a same-session answer from her own knowledge, clearly flagged as not freshly sourced.",
  },
  workspace_changed: {
    title: "Your workspace changed mid-research",
    body: "The research was started under a different workspace. Its result stays with that workspace — it has not been shown or saved here.",
  },
  engine_error: {
    title: "The research engine reported an error",
    body: "The engine stopped honestly and nothing was saved. Check the question and try again; if it repeats, the provider may be unreachable.",
  },
  not_signed_in: {
    title: "Sign in to research",
    body: "Research runs are saved to your workspace, so you need to be signed in first.",
  },
};

function RunCard({ row, onOpen }: { row: ResearchRunRow; onOpen: (id: string) => void }) {
  return (
    <article className="spw-source-card dr-run-card">
      <div className="spw-card-row">
        <span className="spw-symbol"><FileSearch aria-hidden size={16} /></span>
        <div className="spw-card-copy">
          <h3>{row.question}</h3>
          <p>
            {formatDate(row.created_at)}
            {row.domain && row.domain !== "general" ? ` · ${row.domain}` : ""}
            {` · ${row.source_count} source${row.source_count === 1 ? "" : "s"}`}
          </p>
        </div>
        <span className={`spw-truth ${row.is_dossier ? "spw-truth-proposed" : "spw-truth-live"}`}>
          {row.is_dossier ? "Dossier" : "Research"}
        </span>
      </div>
      <footer className="spw-card-actions">
        <span className="dr-run-state">{stopLabel(row.stop_reason)}</span>
        <button type="button" onClick={() => onOpen(row.id)} aria-label={`Open research: ${row.question}`}>
          Review findings
        </button>
      </footer>
    </article>
  );
}

function DetailBody({ run }: { run: NonNullable<ReturnType<typeof useDeepResearch>["detail"]> }) {
  const findings = run.findings ?? [];
  const sources = run.sources ?? [];
  const cov = run.coverage ?? {};
  const profile = (run.entity_profile ?? null) as EntityProfile | null;
  const citedBy = (n: number) => sources.filter((s) => s.index === n);
  return (
    <div className="dr-detail">
      <div className="dr-coverage">
        <ListChecks aria-hidden size={15} />
        <span>
          {cov.searches ?? 0} search{(cov.searches ?? 0) === 1 ? "" : "es"} · {cov.reads ?? 0} page{(cov.reads ?? 0) === 1 ? "" : "s"} read · {cov.hops_used ?? 0} hop{(cov.hops_used ?? 0) === 1 ? "" : "s"} · {stopLabel(run.stop_reason)}
          {cov.note ? ` — ${cov.note}` : ""}
        </span>
      </div>

      {findings.length === 0 && !profile && (
        <div className="spw-state">
          <ShieldQuestion aria-hidden size={22} />
          <strong>No findings survived validation</strong>
          <span>The engine found no claims it could ground to a real, non-excluded source. It reports that honestly rather than guessing.</span>
        </div>
      )}

      {findings.length > 0 && (
        <section aria-label="Findings" className="dr-findings">
          <h4>Findings</h4>
          {findings.map((f, i) => (
            <article key={i} className="dr-finding">
              <ConfidencePill level={f.confidence} />
              <p>{f.text}</p>
              <div className="dr-finding-cites">
                {f.citations.map((n) => citedBy(n).map((s) => (
                  <a key={`${i}-${n}-${s.index}`} href={s.url} target="_blank" rel="noreferrer noopener">
                    [{n}] {s.title ?? new URL(s.url).hostname} <ExternalLink aria-hidden size={10} />
                  </a>
                )))}
                {f.unverifiedFields && f.unverifiedFields.length > 0 && (
                  <span className="dr-unverified">Could not verify: {f.unverifiedFields.join(", ")}</span>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      {profile && (
        <section aria-label="Entity dossier">
          <h4>Entity dossier</h4>
          <EntityDossier
            profile={profile}
            sources={sources.map((s) => ({
              index: s.index, url: s.url, title: s.title ?? s.url,
              tier: s.tier ?? undefined, reliability: (s.reliability as "high" | "medium" | "low" | null) ?? undefined,
              excluded: s.excluded ?? undefined,
            }))}
          />
        </section>
      )}

      <section aria-label="Sources" className="dr-sources">
        <h4>Sources ({sources.length})</h4>
        <ol>
          {sources.map((s) => (
            <li key={s.index} className={s.excluded ? "dr-source-excluded" : undefined}>
              <div className="dr-source-main">
                <ReliabilityMark tier={s.tier} reliability={s.reliability} />
                <a href={s.url} target="_blank" rel="noreferrer noopener">
                  [{s.index}] {s.title ?? new URL(s.url).hostname} <ExternalLink aria-hidden size={10} />
                </a>
                {s.snippet && <p>{s.snippet}</p>}
              </div>
              <div className="dr-source-dates">
                <span>Published {formatDate(s.published_at)}</span>
                <span>Fetched {formatDate(s.fetched_at)}</span>
                {s.excluded && <span className="dr-excluded-tag">Excluded from findings</span>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function ResearchView({ activeTenantId }: { activeTenantId: string | null }) {
  const research = useDeepResearch(activeTenantId);
  const { rows, listError, refresh, detail, detailError, open, close } = research;
  const detailRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { if (detail) detailRef.current?.focus(); }, [detail]);

  return (
    <div className="spw-management-view" data-research-view="">
      <header className="spw-view-head">
        <div>
          <span className="spw-eyebrow">Evidence library</span>
          <h2>Research</h2>
          <p>
            Every investigation PAIGE runs in Chat lands here — the question, the
            findings with their citations, and the sources behind them. Ask PAIGE to
            research something deeply and the saved run appears in this library.
          </p>
        </div>
        <span className="spw-truth spw-truth-live">Workspace-scoped</span>
      </header>

      <div className="spw-scroll">
        <div className="dr-layout">
          <section className="spw-stack" aria-label="Research runs">
            {detail && (
              <article className="spw-source-card dr-detail-card" ref={detailRef} tabIndex={-1}>
                <div className="spw-card-row">
                  <span className="spw-symbol"><BookOpen aria-hidden size={16} /></span>
                  <div className="spw-card-copy">
                    <h3>{detail.question}</h3>
                    <p>
                      {formatDate(detail.created_at)}
                      {detail.domain && detail.domain !== "general" ? ` · ${detail.domain}` : ""}
                      {` · run in ${detail.caller === "chat" || detail.caller === "subagent" ? "PAIGE chat" : "this workspace"}`}
                    </p>
                  </div>
                  <span className={`spw-truth ${detail.entity_profile ? "spw-truth-proposed" : "spw-truth-live"}`}>
                    {detail.entity_profile ? "Dossier" : "Research"}
                  </span>
                </div>
                <DetailBody run={detail} />
                <footer className="spw-card-actions">
                  <button type="button" onClick={close}>
                    <ChevronLeft aria-hidden size={13} /> Back to research history
                  </button>
                </footer>
              </article>
            )}

            {detailError && (
              <div className="spw-state spw-state-error" role="alert">
                <strong>That research could not be opened.</strong>
                <span>{detailError}</span>
              </div>
            )}

            {rows === null && !listError && (
              <div className="spw-state" role="status">Loading this workspace's research…</div>
            )}

            {listError && (
              <div className="spw-state spw-state-error" role="alert">
                <strong>Research history could not be loaded.</strong>
                <span>{listError}</span>
                <button type="button" onClick={() => void refresh()}><RotateCw aria-hidden size={14} /> Retry</button>
              </div>
            )}

            {rows !== null && rows.length === 0 && (
              <div className="spw-state">
                <Search aria-hidden size={24} />
                <strong>No saved research yet</strong>
                <span>
                  Ask PAIGE in Chat — "research this deeply", "do a deep dive", or just a
                  question that deserves real sources — and the saved run appears here.
                </span>
              </div>
            )}

            {rows !== null && rows.length > 0 && rows.map((r) => (
              <RunCard key={r.id} row={r} onOpen={(id) => void open(id)} />
            ))}
          </section>

          <aside className="spw-explainer" aria-label="How this research works">
            <span className="spw-truth spw-truth-live">One research engine</span>
            <h3>The same engine chat uses</h3>
            <p>
              Ask in Chat — PAIGE decides when a question deserves real sources — and the
              saved run lands here: planned searches, reliability-ranked sources, and a
              validation gate that refuses to invent. One history, however it was started.
            </p>
            <hr />
            <span className="spw-truth spw-truth-neutral">Bounded by design</span>
            <p>
              Each run is bounded in time, searches, and reads. Sparse verified truth beats
              polished guessing: a finding only appears when a real, openable source stands
              behind it.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
