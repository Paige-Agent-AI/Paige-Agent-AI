// Studio home: say what you want and Paige opens a project and starts building it. Unpublished work
// lives here as drafts; published work lives in Marketing › Overview. There is no artifact-type picker: the
// brief decides what gets built.
import React from "react";
import { ArrowUp, FileText, Filter, Image as ImageIcon, LayoutTemplate, Sparkles, Images } from "lucide-react";
import { Ic, Logo } from "../_shared";
import { VsStars } from "./VsStars";
import { createSession, loadBrand, plainError, sessionName, type StudioSession } from "./studio-data";
import { loadArtifact, type Brand, type LoadedArtifact } from "./artifact-state";
import { buildGrowthBrandFloor } from "@/components/growth/growth-theme";

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

/** The card's picture of the work: a real image when the project has one, otherwise a scaled-down
 *  render of what is actually saved. A project with nothing in it says so. */
function CardPreview({ s, brand }: { s: StudioSession; brand: Brand }) {
  const first = s.artifacts[0] ?? null;
  const [work, setWork] = React.useState<LoadedArtifact | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    if (s.thumbnailUrl || !first) return;
    loadArtifact(first).then((a) => { if (live) setWork(a); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [s.thumbnailUrl, first?.id, first?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const imageUrl = s.thumbnailUrl ?? (work?.kind === "content" && work.image.contentKind === "image" ? work.image.imageUrl : null);
  if (imageUrl) return <div className="vs-card-shot" aria-hidden="true"><img src={imageUrl} alt="" loading="lazy" /></div>;
  if (!first) return <div className="vs-card-shot vs-card-empty" aria-hidden="true">Not started</div>;
  if (failed) return <div className="vs-card-shot vs-card-empty" aria-hidden="true">Preview unavailable</div>;
  if (!work) return <div className="vs-card-shot vs-card-loading" aria-hidden="true" />;
  if (work.kind === "form") {
    // Drawn from the saved questions with plain elements: a card is a button, so it can't hold the
    // real form's labels and inputs.
    return (
      <div className="vs-card-shot vs-card-form" aria-hidden="true">
        <div className="vs-mini-sheet">
          <span className="vs-mini-title">{work.form.name}</span>
          {work.form.fields.slice(0, 3).map((f) => <span key={f.key} className="vs-mini-q"><span>{f.label}</span><i /></span>)}
          <span className="vs-mini-submit" style={{ background: brand.floor.primary ?? undefined }}>{work.form.submitLabel}</span>
        </div>
      </div>
    );
  }
  if (work.kind === "page") {
    const hero = work.page.blocks.find((b) => b.type === "hero" || b.type === "hero_scene") as { eyebrow?: string; title?: string } | undefined;
    const title = hero?.title ?? work.page.title;
    return (
      <div className="vs-card-shot vs-card-page" aria-hidden="true" style={{ background: brand.floor.primary ?? undefined }}>
        {hero?.eyebrow && <small>{hero.eyebrow}</small>}
        <b>{title}</b>
        <span>{work.page.blocks.length} section{work.page.blocks.length === 1 ? "" : "s"}</span>
      </div>
    );
  }
  if (work.kind === "funnel") {
    const word = { page: "Page", form: "Form", payment: "Payment", booking: "Booking", thankyou: "Thank you" } as const;
    return (
      <div className="vs-card-shot vs-card-funnel" aria-hidden="true">
        {work.funnel.steps.length === 0 ? <span>No steps yet</span> : work.funnel.steps.slice(0, 4).map((st, i) => <i key={st.id}>{i + 1} {word[st.type]}</i>)}
      </div>
    );
  }
  if (work.kind === "content" && work.image.contentKind !== "image") {
    return <div className="vs-card-shot vs-card-copy" aria-hidden="true"><b>{work.image.title}</b><span>{work.image.contentKind === "document" ? "Document" : "Copy"}</span></div>;
  }
  return <div className="vs-card-shot vs-card-empty" aria-hidden="true">This image has no file yet</div>;
}

function describe(s: StudioSession): string {
  if (s.artifacts.length === 0) return "Not started";
  const words: Record<string, string> = { form: "Form", page: "Page", funnel: "Funnel", content: "Content" };
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
        <span style={{ transform: "rotate(180deg)", display: "flex" }}><Ic.chev size={14} style={{}} /></span>Back to Marketing<kbd>Esc</kbd>
      </button>
      <div className="vs-rail-brand"><Logo size={20} />Vibe Studio</div>
      <button type="button" className="vs-rail-item" aria-current={view === "home" ? "page" : undefined} onClick={onHome}><Sparkles size={15} aria-hidden="true" />Build with Paige</button>
      <button type="button" className="vs-rail-item" aria-current={view === "media" ? "page" : undefined} onClick={onMedia}><Images size={15} aria-hidden="true" />Images &amp; video</button>
      <div className="vs-rail-label">Drafts</div>
      {sessions === null ? <span className="vs-rail-skel" role="status" aria-label="Loading your drafts"><i /><i /><i /></span>
        : sessions.length === 0 ? <span className="vs-rail-note" style={{ marginTop: 0 }}>Nothing yet.</span>
        : sessions.slice(0, 12).map((s) => (
          <button key={s.id} type="button" className="vs-rail-item" data-draft="" onClick={() => onOpen(s)}>
            <SessionIcon s={s} /><span className="vs-trunc">{sessionName(s)}</span>
          </button>
        ))}
      <p className="vs-rail-note">Published work is in Marketing › Overview.</p>
    </nav>
  );
}

export function StudioHome({ sessions, sessionsError, tenantSlug, onOpen }: {
  sessions: StudioSession[] | null;
  sessionsError: string | null;
  tenantSlug: string;
  onOpen: (sessionId: string, seedBrief: string | null) => void;
}) {
  const [brand, setBrand] = React.useState<Brand>({ floor: buildGrowthBrandFloor(null), name: null, logoUrl: null });
  React.useEffect(() => { void loadBrand(tenantSlug).then(setBrand); }, [tenantSlug]);
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
          : sessions === null ? <div className="vs-cards" role="status" aria-label="Loading your drafts">{[0, 1, 2].map((i) => <div key={i} className="vs-card vs-card-skel" aria-hidden="true"><div className="vs-card-shot vs-card-loading" /><div className="vs-card-body"><i /><i /></div></div>)}</div>
          : sessions.length === 0 ? <div className="vs-empty">Nothing here yet. What you build appears here as a draft until you publish it.</div>
          : (
            <div className="vs-cards">
              {sessions.slice(0, 8).map((s) => (
                <button key={s.id} type="button" className="vs-card" onClick={() => onOpen(s.id, null)}>
                  <CardPreview s={s} brand={brand} />
                  <div className="vs-card-body"><b className="vs-trunc">{sessionName(s)}</b><span>{describe(s)}</span></div>
                </button>
              ))}
            </div>
          )}
      </section>
    </div>
  );
}
