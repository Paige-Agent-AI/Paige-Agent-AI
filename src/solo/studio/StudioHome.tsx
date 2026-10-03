// Studio home: say what you want and Paige opens a project and starts building it. Unpublished work
// lives here as drafts; published work lives in the Catalog. There is no artifact-type picker: the
// brief decides what gets built.
import React from "react";
import { ArrowUp, FileText, Filter, Image as ImageIcon, LayoutTemplate, Sparkles, Images } from "lucide-react";
import { Ic, Logo } from "../_shared";
import { VsStars } from "./VsStars";
import { createSession, listSessions, plainError, type StudioSession } from "./studio-data";

const SUGGESTIONS = [
  "An intake form for new clients",
  "A landing page for my next workshop",
  "A funnel for a free consultation",
  "Social images for this week",
];

function SessionIcon({ s }: { s: StudioSession }) {
  const k = s.artifacts[0]?.kind;
  const props = { size: 15, "aria-hidden": true } as const;
  return k === "form" ? <FileText {...props} /> : k === "funnel" ? <Filter {...props} /> : k === "content" ? <ImageIcon {...props} /> : k === "page" ? <LayoutTemplate {...props} /> : <Sparkles {...props} />;
}

function describe(s: StudioSession): string {
  if (s.artifacts.length === 0) return "Not started";
  const words: Record<string, string> = { form: "Form", page: "Page", funnel: "Funnel", content: "Image" };
  const kinds = Array.from(new Set(s.artifacts.map((a) => words[a.kind])));
  return kinds.join(" and ");
}

export function StudioRail({ view, sessions, onBack, onHome, onMedia, onOpen }: {
  view: "home" | "media";
  sessions: StudioSession[] | null;
  onBack: () => void;
  onHome: () => void;
  onMedia: () => void;
  onOpen: (s: StudioSession) => void;
}) {
  return (
    <nav className="vs-rail" aria-label="Studio">
      <button type="button" className="vs-rail-back" onClick={onBack}>
        <span style={{ transform: "rotate(180deg)", display: "flex" }}><Ic.chev size={14} style={{}} /></span>Back to Campaigns<kbd>Esc</kbd>
      </button>
      <div className="vs-rail-brand"><Logo size={20} />Vibe Studio</div>
      <button type="button" className="vs-rail-item" aria-current={view === "home" ? "page" : undefined} onClick={onHome}><Sparkles size={15} aria-hidden="true" />Build with Paige</button>
      <button type="button" className="vs-rail-item" aria-current={view === "media" ? "page" : undefined} onClick={onMedia}><Images size={15} aria-hidden="true" />Images &amp; video</button>
      <div className="vs-rail-label">Drafts</div>
      {sessions === null ? <span className="vs-rail-note" style={{ marginTop: 0 }}>Loading…</span>
        : sessions.length === 0 ? <span className="vs-rail-note" style={{ marginTop: 0 }}>Nothing yet.</span>
        : sessions.slice(0, 12).map((s) => (
          <button key={s.id} type="button" className="vs-rail-item" data-draft="" onClick={() => onOpen(s)}>
            <SessionIcon s={s} /><span className="vs-trunc">{s.title}</span>
          </button>
        ))}
      <p className="vs-rail-note">Published work is in your Catalog.</p>
    </nav>
  );
}

export function StudioHome({ sessions, sessionsError, onOpen }: {
  sessions: StudioSession[] | null;
  sessionsError: string | null;
  onOpen: (sessionId: string, seedBrief: string | null) => void;
}) {
  const [brief, setBrief] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  React.useEffect(() => { ref.current?.focus(); }, []);

  const start = async (text: string) => {
    const t = text.trim();
    if (t.length < 4 || creating) return;
    setCreating(true); setError(null);
    try {
      const s = await createSession(t);
      onOpen(s.id, t);
    } catch (e) {
      setError(plainError(e, "The project couldn't be started. Try again."));
      setCreating(false);
    }
  };

  return (
    <div className="vs-main">
      <div className="vs-hero">
        <VsStars n={160} />
        <div className="vs-hero-inner">
          <h1>What should Paige build?</h1>
          <div className="vs-composer">
            <label className="vs-sr" htmlFor="vs-brief">Describe what you want Paige to build</label>
            <textarea
              id="vs-brief"
              ref={ref}
              value={brief}
              placeholder="A page, a form, a funnel, or images. Say who it's for and what should happen next."
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void start(brief); } }}
            />
            <div className="vs-composer-foot">
              <span>Paige works from <b>your brand</b> and your business details.</span>
              <button type="button" className="vs-btn vs-btn-violet" style={{ marginLeft: "auto" }} disabled={brief.trim().length < 4 || creating} onClick={() => void start(brief)}>
                {creating ? "Starting…" : "Build it"} <ArrowUp size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
          {error && <p className="vs-alert" role="alert">{error}</p>}
          <div className="vs-chips" aria-label="Ideas">
            {SUGGESTIONS.map((s) => <button key={s} type="button" className="vs-chip" disabled={creating} onClick={() => { setBrief(s); ref.current?.focus(); }}>{s}</button>)}
          </div>
        </div>
      </div>
      <section className="vs-section" aria-label="Pick up where you left off">
        <h2>Pick up where you left off</h2>
        {sessionsError ? <p className="vs-alert" role="alert">{sessionsError}</p>
          : sessions === null ? <p className="vs-inspector-note" role="status">Loading your drafts…</p>
          : sessions.length === 0 ? <div className="vs-empty">Nothing here yet. What you build appears here as a draft until you publish it.</div>
          : (
            <div className="vs-cards">
              {sessions.slice(0, 8).map((s) => (
                <button key={s.id} type="button" className="vs-card" onClick={() => onOpen(s.id, s.seedBrief)}>
                  <div className="vs-card-sheet" aria-hidden="true"><i /><i /><i /></div>
                  <div className="vs-card-body"><b className="vs-trunc">{s.title}</b><span>{describe(s)}</span></div>
                </button>
              ))}
            </div>
          )}
      </section>
    </div>
  );
}
