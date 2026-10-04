import { useState } from "react";
import { Search, FileSearch, ExternalLink, ChevronDown } from "lucide-react";

/**
 * PaigeResearchCard — the inline Deep Research result card (R2b, INT-303 reshape).
 *
 * The Perplexity-like evidence experience INSIDE the one Paige turn: the research
 * ran as a tool inside the assistant's own reply (the activity state lives in the
 * step trace's fixed-vocabulary label "Researching the live web" — no invented
 * per-step progress, ruling §5), and this card is what the turn carries after:
 * the question, the coverage line in owner words, findings with confidence and
 * CITATION CHIPS whose [n] markers are the CANONICAL engine indices (never rebuilt
 * client-side — one run, one evidence set, consistent with the Research library,
 * ruling §11), and the source list collapsed by default but inspectable without
 * leaving the conversation (§6). The `saved` flag is the SERVER's governed-
 * readback verdict (§10) — "saved to this workspace's research library" appears
 * only when the M0 RPC proved the row.
 */

export type PaigeResearchFinding = {
  text: string;
  citations: number[];
  confidence: string;
};

export type PaigeResearchSource = {
  index: number;
  url: string;
  title: string | null;
  reliability: string | null;
  tier: string | null;
  published_at?: string | null;
  excluded?: boolean;
};

export type PaigeResearchResult = {
  run_id: string | null;
  question: string;
  saved: boolean;
  configured: boolean;
  stop_reason: string | null;
  is_dossier: boolean;
  findings: PaigeResearchFinding[];
  sources: PaigeResearchSource[];
  unverified_notes: string[];
  /** The reload path's reference state — the evidence is being fetched through the
   *  governed get RPC; a null readback settles the honest not-saved state instead. */
  rehydrating?: boolean;
};

const STOP_WORDS: Record<string, string> = {
  answered: "Completed",
  max_hops: "Depth reached",
  budget: "Research budget reached",
  wall_clock: "Time limit reached",
  no_results: "No credible sources",
  unconfigured: "Search not configured",
  error: "Engine error",
};

const grade = (s: PaigeResearchSource) =>
  `${s.tier ?? "—"} · ${s.reliability ?? "unrated"}`;

const hostOf = (url: string) => {
  try { return new URL(url).hostname; } catch { return url; }
};

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return null; }
};

export function PaigeResearchCard({ result }: { result: PaigeResearchResult }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const cited = new Set(result.findings.flatMap((f) => f.citations));
  const showingSources = result.sources.filter((s) => !s.excluded);
  const stateWord = result.stop_reason ? (STOP_WORDS[result.stop_reason] ?? "Stopped") : "Completed";

  return (
    <div className="dr-card" data-research-card="">
      <div className="dr-card-head">
        <span className="dr-card-icon"><FileSearch aria-hidden size={15} /></span>
        <div className="dr-card-title">
          <strong>{result.question || "Research run"}</strong>
          <span>
            {result.is_dossier ? "Entity dossier" : "Deep research"} · {stateWord}
            {` · ${showingSources.length} source${showingSources.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {result.saved
          ? <span className="dr-saved">Saved to this workspace's research library</span>
          : <span className="dr-unsaved">Not saved — the run could not be confirmed in this workspace</span>}
      </div>

      {result.rehydrating && result.findings.length === 0 && (
        <p className="dr-card-note" role="status">Loading this run's evidence…</p>
      )}

      {!result.configured && (
        <p className="dr-card-note" role="note">
          Live web search is not configured, so the engine returned no findings. Nothing above is freshly sourced.
        </p>
      )}

      {result.findings.length > 0 && (
        <ul className="dr-card-findings">
          {result.findings.map((f, i) => (
            <li key={i}>
              <span className={`dr-conf dr-conf-${f.confidence}`}>{f.confidence}</span>
              <p>{f.text}</p>
              {f.citations.length > 0 && (
                <div className="dr-cites">
                  {f.citations.map((n) => {
                    const src = result.sources.find((s) => s.index === n && !s.excluded);
                    return src ? (
                      <a key={n} href={src.url} target="_blank" rel="noreferrer noopener" title={src.title ?? src.url}>
                        [{n}] {src.title ?? hostOf(src.url)} <ExternalLink aria-hidden size={9} />
                      </a>
                    ) : null;
                  })}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!result.rehydrating && result.findings.length === 0 && result.configured && (
        <p className="dr-card-note">
          No findings survived validation — the engine reports honestly rather than guessing.
        </p>
      )}

      {result.unverified_notes.length > 0 && (
        <p className="dr-card-note dr-unverified">
          Could not verify: {result.unverified_notes.slice(0, 6).join(" · ")}
          {result.unverified_notes.length > 6 ? " · …" : ""}
        </p>
      )}

      {showingSources.length > 0 && (
        <div className="dr-card-sources">
          <button
            type="button"
            onClick={() => setSourcesOpen((v) => !v)}
            aria-expanded={sourcesOpen}
            className="dr-sources-toggle"
          >
            <ChevronDown aria-hidden size={13} data-open={sourcesOpen ? "" : undefined} />
            {sourcesOpen ? "Hide sources" : `Sources (${showingSources.length})`}
            <span className="dr-cited-count">{cited.size} cited</span>
          </button>
          {sourcesOpen && (
            <ol>
              {showingSources.map((s) => (
                <li key={s.index}>
                  <span className="dr-grade">{grade(s)}</span>
                  <a href={s.url} target="_blank" rel="noreferrer noopener">
                    [{s.index}] {s.title ?? hostOf(s.url)} <ExternalLink aria-hidden size={9} />
                  </a>
                  {formatDate(s.published_at) && <span className="dr-pub">Published {formatDate(s.published_at)}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
