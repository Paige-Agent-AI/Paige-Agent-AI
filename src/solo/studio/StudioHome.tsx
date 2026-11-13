// Studio home: say what you want and Paige opens a project and starts building it. Unpublished work
// lives here as drafts; published work lives in Marketing › Overview. There is no artifact-type picker: the
// brief decides what gets built.
import React from "react";
import { ArrowUp, FileText, Filter, Image as ImageIcon, LayoutTemplate, Sparkles, Images, Minimize2 } from "lucide-react";
import { Ic } from "../_shared";
import { NexusIdentity } from "./NexusIdentity";
import { VsStars } from "./VsStars";
import { listTemplates, loadBrand, plainError, sessionName, startStudioProject, lookupStudioProjectStart, ProjectStartUnknown, type StudioSession, type StudioProjectContext } from "./studio-data";
import { BRIEF_FIELDS, EMPTY_BRIEF_DETAILS, composeBrief, hasBriefDetails, type BriefDetails } from "./brief-fields";
import { loadArtifact, type Brand, type LoadedArtifact } from "./artifact-state";
import { nexusDepartmentRemit, nexusDisplayName, planWithNexusPrompt } from "./nexus";
import { buildGrowthBrandFloor } from "@/components/growth/growth-theme";
import { StudioBusinessContextPanel } from "./StudioBusinessContextPanel";
import { useStudioBusinessContext } from "./useStudioBusinessContext";
import { NEXUS_LANDING_TEMPLATE_ID } from "./nexus-landing-template";
import type { StudioBusinessContext, StudioContextTarget } from "./business-context";

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

export function StudioRail({ view, sessions, onBack, onMinimize, onHome, onMedia, onOpen }: {
  view: "home" | "media";
  sessions: StudioSession[] | null;
  onBack: () => void;
  onMinimize?: () => void;
  onHome: () => void;
  onMedia: () => void;
  onOpen: (s: StudioSession) => void;
}) {
  return (
    <nav className="vs-rail" aria-label="Studio">
      <button type="button" className="vs-rail-back" onClick={onBack}>
        <span style={{ transform: "rotate(180deg)", display: "flex" }}><Ic.chev size={14} style={{}} /></span>Back to Marketing<kbd>Esc</kbd>
      </button>
      <div className="vs-rail-brand"><NexusIdentity /></div>
      {onMinimize && <button type="button" className="vs-rail-item" onClick={onMinimize}><Minimize2 size={15} aria-hidden="true" />Minimize Studio</button>}
      <button type="button" className="vs-rail-item" aria-current={view === "home" ? "page" : undefined} onClick={onHome}><Sparkles size={15} aria-hidden="true" />Build with NEXUS</button>
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

export function StudioHome({ sessions, sessionsError, tenantId, tenantSlug, onNexusHandoff, onOpen, recoverStartId, onStartPending }: {
  sessions: StudioSession[] | null;
  sessionsError: string | null;
  tenantId: string;
  recoverStartId?: string;
  onStartPending?: (requestId: string | null) => void;
  tenantSlug: string;
  /** Present only when the shell can open the global PAIGE chat; the affordance hides without it. */
  onNexusHandoff?: (prompt: string) => void;
  onOpen: (sessionId: string, seedBrief: string | null) => void;
}) {
  const [brand, setBrand] = React.useState<Brand>({ floor: buildGrowthBrandFloor(null), name: null, logoUrl: null });
  React.useEffect(() => { void loadBrand(tenantSlug).then(setBrand); }, [tenantSlug]);
  // EXP07 row 6 — the workspace's templates. Empty (and the section hidden) until someone saves one.
  const [templates, setTemplates] = React.useState<StudioSession[] | null>(null);
  React.useEffect(() => { void listTemplates().then(setTemplates).catch(() => setTemplates([])); }, []);
  const [brief, setBrief] = React.useState("");
  const [details, setDetails] = React.useState<BriefDetails>(EMPTY_BRIEF_DETAILS);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [target, setTarget] = React.useState<StudioContextTarget>({ kind: "workspace" });
  const [projectValues, setProjectValues] = React.useState<StudioBusinessContext["projectValues"]>({});
  const projection = useStudioBusinessContext(tenantId, tenantSlug, target, projectValues);
  const [editorialTemplate, setEditorialTemplate] = React.useState(false);
  const [unknownStart, setUnknownStart] = React.useState(!!recoverStartId);
  const intent = React.useRef<{ requestId: string; brief: string; context: StudioProjectContext } | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  React.useEffect(() => { ref.current?.focus(); }, []);

  const start = async (text: string) => {
    // The owner's own words are the brief; details only add to them (the Build button gates the same way).
    if (unknownStart) { await checkEarlierStart(); return; }
    if (text.trim().length < 4 || creating) return;
    if (projection.issues.some(issue => issue.source === "project" && issue.field && projectValues[issue.field]?.trim())) {
      setError("Review the highlighted project details before starting."); return;
    }
    const authoredValues = Object.fromEntries(Object.keys(projectValues).map(key => [key, projection.projectValues[key as keyof typeof projectValues] ?? ""]));
    const context: StudioProjectContext = { target, values: authoredValues, ...(editorialTemplate ? { template_id: NEXUS_LANDING_TEMPLATE_ID } : {}) };
    const composed = composeBrief(text, details);
    if (composed.length > 32000) { setError("The brief and selected context are too long. Shorten this project's details before starting."); return; }
    intent.current = { requestId: crypto.randomUUID(), brief: composed, context };
    onStartPending?.(intent.current.requestId);
    setCreating(true); setError(null);
    try {
      const result = await startStudioProject({ tenantId, ...intent.current });
      if (!alive.current) return;
      onStartPending?.(null);
      onOpen(result.sessionId, result.created ? composed : null);
    } catch (e) {
      if (!alive.current) return;
      setUnknownStart(e instanceof ProjectStartUnknown);
      if (!(e instanceof ProjectStartUnknown)) onStartPending?.(null);
      setError(plainError(e, "The project couldn't be started. Your brief is still here."));
      setCreating(false);
    }
  };

  const checkEarlierStart = async () => {
    const requestId = intent.current?.requestId ?? recoverStartId;
    if (!requestId || creating) return;
    setCreating(true); setError(null);
    try {
      const result = await lookupStudioProjectStart(tenantId, requestId);
      if (!alive.current) return;
      if (result) { onStartPending?.(null); onOpen(result.sessionId, null); }
      else setError("That earlier start is still unverified. No new project was started; your brief is preserved.");
    } catch (e) { if (alive.current) setError(plainError(e, "The earlier start could not be checked. No new project was started.")); }
    finally { if (alive.current) setCreating(false); }
  };

  // A template starts a NEW project seeded from its brief — the template itself never changes.
  const startFromTemplate = async (t: StudioSession) => {
    const brief = (t.seedBrief ?? sessionName(t)).trim();
    if (brief.length < 4 || creating) return;
    await start(brief);
  };

  return (
    <div className="vs-main">
      <div className="vs-hero">
        <VsStars n={160} />
        <div className="vs-hero-inner">
          <h1>What should NEXUS build?</h1>
          <StudioBusinessContextPanel projection={projection} projectValues={projectValues} onChange={setProjectValues} disabled={creating || unknownStart}
            onTargetChange={kind => { setProjectValues({}); setTarget(kind === "workspace" ? { kind } : { kind, reference: crypto.randomUUID() }); }} />
          <div className="vs-composer">
            <label className="vs-sr" htmlFor="vs-brief">Describe what you want NEXUS to build</label>
            <textarea
              id="vs-brief"
              ref={ref}
              value={brief}
              placeholder="A page, a form, a funnel, or images. Say who it's for and what should happen next."
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void start(brief); } }}
            />
            {detailsOpen && (
              <div className="vs-brief-fields" aria-label="Brief details">
                {BRIEF_FIELDS.map(({ key, label, placeholder }) => (
                  <div className="vs-brief-field" key={key}>
                    <label htmlFor={`vs-brief-${key}`}>{label}</label>
                    <input
                      id={`vs-brief-${key}`}
                      type="text"
                      value={details[key]}
                      placeholder={placeholder}
                      disabled={creating}
                      onChange={(e) => setDetails((d) => ({ ...d, [key]: e.target.value }))}
                    />
                  </div>
                ))}
                <p className="vs-brief-note">Optional. Whatever you add here is saved with the brief and Paige works from it — you can add the rest in chat.</p>
              </div>
            )}
            <div className="vs-composer-foot">
              <span>NEXUS uses the selected project context.</span>
              <button type="button" className="vs-link vs-brief-toggle" aria-expanded={detailsOpen} disabled={creating} onClick={() => setDetailsOpen((o) => !o)}>
                {detailsOpen ? "Hide details" : hasBriefDetails(details) ? "Details · added" : "Add details"}
              </button>
              <button type="button" className="vs-btn vs-btn-violet" style={{ marginLeft: "auto" }} disabled={(!unknownStart && brief.trim().length < 4) || creating} onClick={() => void start(brief)}>
                {creating ? "Checking…" : unknownStart ? "Check earlier start" : "Build it"} <ArrowUp size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
          {error && <p className="vs-alert" role="alert">{error}</p>}
          <button type="button" className="vs-template-choice" aria-pressed={editorialTemplate} disabled={creating || unknownStart}
            onClick={() => { setEditorialTemplate(value => !value); if (!brief.trim()) setBrief("Build a landing page for this offer"); ref.current?.focus(); }}>
            <LayoutTemplate size={18} aria-hidden="true" /><span><b>Editorial landing page</b><small>A clear opening, your offer, one next step · built in your selected brand</small></span><span aria-hidden="true">{editorialTemplate ? "Selected" : "Use template"}</span>
          </button>
          {onNexusHandoff && (
            <p className="vs-dept-line">
              Brand and public presence are {nexusDisplayName()}'s department ({nexusDepartmentRemit()}).
              <button type="button" className="vs-link" onClick={() => onNexusHandoff(planWithNexusPrompt())}>Plan with {nexusDisplayName()}</button>
              — opens your Chat; the question is yours to send.
            </p>
          )}
          <div className="vs-chips" aria-label="Ideas">
            {SUGGESTIONS.map((s) => <button key={s} type="button" className="vs-chip" disabled={creating} onClick={() => { setBrief(s); ref.current?.focus(); }}>{s}</button>)}
          </div>
        </div>
      </div>
      {templates !== null && templates.length > 0 && (
        <section className="vs-section" aria-label="Start from a template">
          <h2>Start from a template</h2>
          <div className="vs-cards">
            {templates.slice(0, 8).map((t) => (
              <button key={t.id} type="button" className="vs-card" disabled={creating} onClick={() => void startFromTemplate(t)}>
                <CardPreview s={t} brand={brand} />
                <div className="vs-card-body"><b className="vs-trunc">{sessionName(t)}</b><span>Starts a new project from this brief</span></div>
              </button>
            ))}
          </div>
        </section>
      )}
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
