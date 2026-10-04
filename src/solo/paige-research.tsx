import { useEffect, useRef, useState } from "react";
import {
  Search, BookOpen, FileSearch, ChevronLeft, RotateCw, Timer, AlertTriangle,
  CheckCircle2, ExternalLink, ShieldQuestion, ListChecks,
} from "lucide-react";
import { EntityDossier, type EntityProfile } from "@/components/dashboard/EntityDossier";
import { useDeepResearch, type ResearchDepth, type ResearchRunRow } from "@/solo/data/deepResearch";

/**
 * Deep Research — the R1+R2 workspace view (INT-303): ONE research home inside
 * PAIGE (Chat · Knowledge · Deep Research · Helpers · Capabilities), reading
 * and writing the SAME canonical research_runs substrate chat uses. No second
 * engine, no second history, no fake progress: the run state is elapsed-time
 * truth, the result state is the engine's own outcome vocabulary, and "saved"
 * is claimed only after the governed readback proves the row exists.
 */

const DEPTHS: Array<{ id: ResearchDepth; label: string; hint: string }> = [
  { id: "quick", label: "Quick", hint: "One pass — a fast, sourced answer" },
  { id: "standard", label: "Standard", hint: "Balanced depth across sources" },
  { id: "thorough", label: "Thorough", hint: "Widest sweep within the engine's bounds" },
];

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

function StartPanel({
  busy, onStart, onDismiss, dismissLabel,
}: {
  busy: boolean;
  onStart: (question: string, depth: ResearchDepth) => void;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  const [question, setQuestion] = useState("");
  const [depth, setDepth] = useState<ResearchDepth>("standard");
  const trimmed = question.trim();
  const valid = trimmed.length >= 8 && trimmed.length <= 500;
  return (
    <form
      className="dr-start"
      onSubmit={(e) => { e.preventDefault(); if (valid && !busy) onStart(trimmed, depth); }}
    >
      <label className="dr-field">
        <span id="dr-question-label">Research question</span>
        <textarea
          aria-labelledby="dr-question-label"
          rows={3}
          maxLength={500}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What's the current competitive landscape for AI-native CRM platforms for small businesses?"
          disabled={busy}
        />
        <small>{trimmed.length}/500 — at least 8 characters</small>
      </label>
      <fieldset className="dr-depth" disabled={busy}>
        <legend>Depth</legend>
        {DEPTHS.map((d) => (
          <button
            key={d.id}
            type="button"
            aria-pressed={depth === d.id}
            onClick={() => setDepth(d.id)}
          >
            <strong>{d.label}</strong>
            <span>{d.hint}</span>
          </button>
        ))}
      </fieldset>
      <div className="dr-start-actions">
        <button type="submit" className="dr-primary" disabled={!valid || busy}>
          <Search aria-hidden size={14} /> Start research
        </button>
        <button type="button" onClick={onDismiss} disabled={busy}>{dismissLabel}</button>
      </div>
      <p className="dr-start-note">
        PAIGE investigates the live web through her cited research engine — a
        question gets a sourced answer, not a guess. Every finding carries a
        citation you can open.
      </p>
    </form>
  );
}

function RunningPanel({ question, startedAt, timeoutMs }: { question: string; startedAt: number; timeoutMs: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const overBudget = elapsed * 1000 > timeoutMs;
  return (
    <div className="dr-running" role="status" aria-live="polite">
      <Timer className="dr-running-icon" aria-hidden size={20} />
      <div>
        <strong>PAIGE is researching this.</strong>
        <p className="dr-running-question">{question}</p>
        <p className="dr-running-time">
          {minutes}:{String(seconds).padStart(2, "0")} elapsed — bounded by the engine's
          time and search limits{overBudget ? "; taking longer than usual — the result may have been abandoned in transport" : ""}.
        </p>
      </div>
    </div>
  );
}

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

function FailedPanel({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  const words = FAIL_WORDS[reason] ?? {
    title: "Research stopped",
    body: "The engine reported an honest stop. Nothing was saved unless a run appears in the list below.",
  };
  return (
    <div className="dr-failed" role="alert">
      <AlertTriangle aria-hidden size={18} />
      <div>
        <strong>{words.title}</strong>
        <p>{words.body}</p>
      </div>
      <button type="button" onClick={onRetry}>Try again</button>
    </div>
  );
}

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
  const { rows, listError, refresh, detail, detailError, open, close, phase, start, reset } = research;
  const [showStart, setShowStart] = useState(false);
  const detailRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { if (detail) detailRef.current?.focus(); }, [detail]);

  const busy = phase.kind === "running";
  const runningQuestion = phase.kind === "running" ? phase.question : null;
  const startedAt = phase.kind === "running" ? phase.startedAt : null;

  const handleStart = (question: string, depth: ResearchDepth) => {
    close();
    void start(question, depth);
  };

  return (
    <div className="spw-management-view" data-research-view="">
      <header className="spw-view-head">
        <div>
          <span className="spw-eyebrow">Cited investigation</span>
          <h2>Deep Research</h2>
          <p>
            Assign PAIGE's research engine a question. It plans, searches the live web,
            reads the strongest sources, and returns findings whose every claim carries an
            openable citation — saved to this workspace's research history.
          </p>
        </div>
        <span className="spw-truth spw-truth-live">Workspace-scoped</span>
      </header>

      <div className="spw-scroll">
        <div className="dr-layout">
          <section className="spw-stack" aria-label="Research runs">
            {phase.kind === "failed" && <FailedPanel reason={phase.reason} onRetry={reset} />}

            {phase.kind === "running" && startedAt != null && runningQuestion != null && (
              <RunningPanel question={runningQuestion} startedAt={startedAt} timeoutMs={research.runTimeoutMs} />
            )}

            {phase.kind === "done" && (
              <div className={`dr-didrun ${phase.persisted ? "" : "dr-didrun-unsaved"}`} role="status">
                {phase.persisted
                  ? <><CheckCircle2 aria-hidden size={16} /><span>Research completed and saved.</span></>
                  : <><AlertTriangle aria-hidden size={16} /><span>Research completed, but saving could not be confirmed — the result below is shown unsaved. It has not been added to this workspace's history.</span></>}
              </div>
            )}

            {!showStart && !busy && phase.kind !== "done" && phase.kind !== "failed" && (
              <div className="dr-cta">
                <button type="button" className="dr-primary" onClick={() => setShowStart(true)}>
                  <Search aria-hidden size={14} /> Start research
                </button>
              </div>
            )}

            {showStart && !busy && (
              <StartPanel busy={busy} onStart={handleStart} onDismiss={() => setShowStart(false)} dismissLabel="Cancel" />
            )}

            {detail && (
              <article className="spw-source-card dr-detail-card" ref={detailRef} tabIndex={-1}>
                <div className="spw-card-row">
                  <span className="spw-symbol"><BookOpen aria-hidden size={16} /></span>
                  <div className="spw-card-copy">
                    <h3>{detail.question}</h3>
                    <p>
                      {formatDate(detail.created_at)}
                      {detail.domain && detail.domain !== "general" ? ` · ${detail.domain}` : ""}
                      {` · run by ${detail.caller === "workspace" ? "this workspace" : "PAIGE chat"}`}
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
                  Ask PAIGE to investigate a market, company, person, competitor, vendor,
                  regulation, location, or strategic question.
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
              Deep Research here and PAIGE's chat research run one cited engine — planned
              searches, reliability-ranked sources, and a validation gate that refuses to
              invent. One history for the workspace, however it was started.
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
