// One Vibe Studio project (owner-locked layout C, 2026-10-03): the conversation with Paige on the
// left, the work itself on the stage, every saved version along the bottom, and one Publish. The
// owner never picks an artifact type: Paige decides from the brief, and the project holds whatever
// she builds. Pending image approvals for this project surface here, beside the conversation.
import React from "react";
import { ArrowLeft, Monitor, Smartphone, MessageSquare, SlidersHorizontal, ArrowUp, Check, AlertCircle, Loader2, Circle, Minimize2, ChevronRight } from "lucide-react";
import { NexusGlyph, NexusIdentity } from "./NexusIdentity";
import { buildGrowthBrandFloor } from "@/components/growth/growth-theme";
import { useMediaJobs } from "../useMediaJobs";
import { MediaApprovalCard } from "./MediaApprovalCard";
import { formFromRow, isUnnamed, sessionName, loadBrand, openSession, pageFromRow, plainError, renameSession, setSessionTemplate, type ArtifactRef, type StudioSession as Session, type StudioVersion } from "./studio-data";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { useStudioChat, type Choices } from "./useStudioChat";
import { StudioStage } from "./StudioStage";
import { artifactId, loadArtifact, hasPendingChanges, isLive, type Brand, type Device, type LoadedArtifact } from "./artifact-state";
import { PublishPanel } from "./PublishPanel";
import { FormSettings } from "./FormSettings";
import { Timeline } from "./Timeline";
import { PageConversionSettings, type PageConversionBlock } from "./PageConversionSettings";
import { parseStudioChatConversionPaste } from "./conversion-input";
import { loadStudioConversionResources, saveStudioPageConversion, loadStudioProjectContext, saveStudioProjectContext, loadStudioPublicationReceipts, type StudioPublicationReceipt, type StudioConversionResources, type StudioProjectContext } from "./studio-data";
import { StudioBusinessContextPanel } from "./StudioBusinessContextPanel";
import { StudioBusinessSelector } from "./StudioBusinessSelector";
import { applyStudioBusinessSelection } from "./studio-business-selection";
import { projectStudioBusinessContext } from "./business-context";
import { useStudioBusinessContext } from "./useStudioBusinessContext";

const KIND_WORD: Record<ArtifactRef["kind"], string> = { form: "Form", page: "Page", funnel: "Funnel", content: "Content" };

function AskCard({ choices, disabled, onAnswer }: { choices: Choices; disabled: boolean; onAnswer: (value: string, display: string) => void }) {
  const [picked, setPicked] = React.useState<string[]>([]);
  React.useEffect(() => { setPicked([]); }, [choices]);
  const toggle = (v: string) => setPicked((p) => (choices.multi ? (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]) : [v]));
  const chosen = choices.options.filter((o) => picked.includes(o.value));
  return (
    <div className="vs-ask" role="group" aria-label={choices.prompt || "NEXUS has a design question"}>
      {choices.prompt && <b>{choices.prompt}</b>}
      <div className="vs-ask-options">
        {choices.options.map((o) => (
          <button key={o.value} type="button" aria-pressed={picked.includes(o.value)} disabled={disabled} onClick={() => toggle(o.value)}>
            {o.label}{o.description && <small>{o.description}</small>}
          </button>
        ))}
      </div>
      <div className="vs-ask-foot">
        <button type="button" className="vs-btn vs-btn-violet" disabled={disabled || chosen.length === 0}
          onClick={() => onAnswer(chosen.map((o) => o.value).join(", "), chosen.map((o) => o.label).join(", "))}>
          {choices.multi ? "Use these" : "Use this"}
        </button>
        <button type="button" className="vs-link" disabled={disabled} onClick={() => onAnswer("Use your design judgment and the saved permitted context. Do not invent business facts, offers, claims or destinations that were not provided.", "Use your design judgment")}>
          Use your design judgment
        </button>
      </div>
    </div>
  );
}

export function StudioSession({ tenantId, tenantSlug, sessionId, seedBrief, onNexusHandoff, onBack, onMinimize, minimized = false, onScopeRefused }: {
  tenantId: string; tenantSlug: string; sessionId: string; seedBrief: string | null;
  /** "Review with NEXUS" pre-approval handoff to the global PAIGE chat; absent ⇒ no affordance. */
  onNexusHandoff?: (prompt: string) => void;
  onBack: () => void;
  onMinimize?: () => void;
  minimized?: boolean;
  onScopeRefused?: () => void;
}) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [sessionError, setSessionError] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [artifact, setArtifact] = React.useState<LoadedArtifact | null>(null);
  const [artifactError, setArtifactError] = React.useState<string | null>(null);
  const [brand, setBrand] = React.useState<Brand>({ floor: buildGrowthBrandFloor(null), name: null, logoUrl: null });
  const [device, setDevice] = React.useState<Device>("desktop");
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [conversionOpen, setConversionOpen] = React.useState(false);
  const [conversionPaste, setConversionPaste] = React.useState<{
    pageId: string; originalText: string; sequence: number;
    input: string; kind: "external_form" | "external_booking" | null; mode: "link" | "embed";
  } | null>(null);
  const conversionPasteSequence = React.useRef(0);
  const [conversionResources, setConversionResources] = React.useState<StudioConversionResources | null>(null);
  const [conversionSaving, setConversionSaving] = React.useState(false);
  const [conversionError, setConversionError] = React.useState<string | null>(null);
  const [projectContext, setProjectContext] = React.useState<StudioProjectContext | null>(null);
  const [contextDraft, setContextDraft] = React.useState<StudioProjectContext | null>(null);
  const [legacyContext, setLegacyContext] = React.useState<false | "unselected" | "chosen">(false);
  const [contextSaving, setContextSaving] = React.useState(false);
  const [publicationReceipts, setPublicationReceipts] = React.useState<StudioPublicationReceipt[] | null>(null);
  const [receiptUnavailable, setReceiptUnavailable] = React.useState(false);
  const [arrivalMotion, setArrivalMotion] = React.useState(Boolean(seedBrief));
  const alive = React.useRef(true), readEpoch = React.useRef(0);
  React.useEffect(() => { const epoch = readEpoch; alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
  const contextProjection = useStudioBusinessContext(tenantId, tenantSlug, legacyContext === "unselected" ? undefined : contextDraft?.target, contextDraft?.values ?? {});
  const [chatOpen, setChatOpen] = React.useState(false);
  const [briefOpen, setBriefOpen] = React.useState(true);
  const [templating, setTemplating] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [previewing, setPreviewing] = React.useState<StudioVersion | null>(null);
  const [input, setInput] = React.useState("");
  const logRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const publishBtnRef = React.useRef<HTMLButtonElement | null>(null);

  const refs = session?.artifacts ?? [];
  // Until it is named, a project is called by what was asked for.
  const displayTitle = session ? sessionName(session) : "Project";
  const activeRef = refs.find((r) => r.id === activeId) ?? refs[0] ?? null;

  const named = React.useRef<string | null>(null);
  const renameFailed = React.useRef(false);
  const reloadSession = React.useCallback(async (select?: string) => {
    const epoch = ++readEpoch.current;
    try {
      const [opened, authored] = await Promise.all([openSession(sessionId), loadStudioProjectContext(tenantId, sessionId)]);
      if (!alive.current || epoch !== readEpoch.current) return;
      const input = authored && typeof authored === "object" && !Array.isArray(authored) ? authored as StudioProjectContext : null;
      const admitted = projectStudioBusinessContext({ expectedTenantId: tenantId, target: input?.target, projectValues: input?.values, readStatus: "unavailable", context: null });
      if (input && Object.keys(input).length === 0) {
        // Existing projects have no authored target. Their saved work remains
        // readable; an explicit choice is required before new generation.
        setProjectContext(null); setLegacyContext(current => current || "unselected");
        setContextDraft(current => current ?? { target: { kind: "workspace" }, values: {} });
      } else {
        if (!input || !admitted.target || !input.values || typeof input.values !== "object" || Array.isArray(input.values)) throw new Error("Project context is unavailable");
        setProjectContext(input); setLegacyContext(false); setContextDraft(current => current ?? input);
      }
      let s = opened;
      // A project nobody named takes the name of the first thing Paige saves in it.
      const first = s.artifacts.find((r) => r.id === select) ?? s.artifacts[0];
      // A project is still unnamed while its name is a placeholder or just the brief it started from
      // (Studio home titles a new project with its brief).
      const placeholder = isUnnamed(s.title) || (!!s.seedBrief && s.title.trim() === s.seedBrief.trim().replace(/\s+/g, " ").slice(0, 60));
      if (placeholder && named.current) {
        // A reload that read the row before the rename landed keeps the name already given.
        s = { ...s, title: named.current };
      } else if (placeholder && first && !isUnnamed(first.title) && !renameFailed.current) {
        // Two reloads end a turn (the produced piece and the turn itself); only one names it.
        named.current = first.title.trim();
        try {
          await renameSession(sessionId, named.current);
          if (!alive.current || epoch !== readEpoch.current) return;
          s = { ...s, title: named.current };
        } catch (e) {
          // Only the creator or an admin may rename; anyone else keeps the brief as the name. Say so
          // once and stop retrying on every reload.
          console.warn("[studio] project rename refused:", e);
          named.current = null; renameFailed.current = true;
        }
      }
      setSession(s);
      setSessionError(null);
      if (select) setActiveId(select);
    } catch (e) {
      if (!alive.current || epoch !== readEpoch.current) return;
      setSession(null); setArtifact(null); setProjectContext(null); setContextDraft(null); setLegacyContext(false);
      setSessionError(plainError(e, "This project couldn't be opened."));
      if ((e as { code?: string })?.code === "42501") onScopeRefused?.();
    }
  }, [sessionId, tenantId, onScopeRefused]);

  React.useEffect(() => { void reloadSession(); }, [reloadSession]);
  React.useEffect(() => {
    let current = true;
    if (!projectContext) return;
    if (projectContext.target.kind !== "workspace") {
      setBrand({ floor: { primary: projectContext.values.primaryColor || "#26242C", accent: projectContext.values.accentColor || "#D8D5DF" }, name: projectContext.values.publicName || null, logoUrl: projectContext.values.logoUrl || null, primaryColor: projectContext.values.primaryColor || null });
      return;
    }
    void loadBrand(tenantSlug).then(next => {
      if (!current) return;
      const values = projectContext.values;
      const own = (key: keyof typeof values) => Object.prototype.hasOwnProperty.call(values, key);
      setBrand({ ...next,
        floor: { ...next.floor, ...(own("primaryColor") ? { primary: values.primaryColor || "#26242C" } : {}), ...(own("accentColor") ? { accent: values.accentColor || "#D8D5DF" } : {}) },
        ...(own("publicName") ? { name: values.publicName || null } : {}),
        ...(own("logoUrl") ? { logoUrl: values.logoUrl || null } : {}),
        ...(own("primaryColor") ? { primaryColor: values.primaryColor || null } : {}),
      });
    });
    return () => { current = false; };
  }, [tenantSlug, projectContext]);
  const wasMinimized = React.useRef(minimized);
  React.useEffect(() => {
    if (minimized) setArrivalMotion(false);
    if (wasMinimized.current && !minimized) { setSession(null); setArtifact(null); void reloadSession(); }
    wasMinimized.current = minimized;
  }, [minimized, reloadSession]);
  React.useEffect(() => {
    if (!conversionOpen) return;
    let current = true;
    setConversionResources(null);
    void loadStudioConversionResources(tenantId).then(value => { if (current) setConversionResources(value); }).catch(() => { if (current) setConversionResources({ forms: [], bookingLinks: [], formsStatus: "unavailable", bookingLinksStatus: "unavailable" }); });
    return () => { current = false; };
  }, [conversionOpen, tenantId]);

  const saveConversion = async (conversion: PageConversionBlock) => {
    if (chat.sending || conversionSaving || artifact?.kind !== "page" || !artifact.page.updatedAt) return;
    const page = artifact.page;
    setConversionSaving(true); setConversionError(null);
    try {
      const saved = await saveStudioPageConversion({ tenantId, sessionId, pageId: page.id, expectedUpdatedAt: page.updatedAt!, conversion });
      if (!alive.current) return;
      setArtifact({ kind: "page", page: saved.page }); setRefreshKey(value => value + 1); setConversionOpen(false);
      if (conversionPaste?.pageId === page.id) {
        setInput(current => current.trim() === conversionPaste.originalText ? "" : current);
        setConversionPaste(null);
      }
      setNotice(saved.changed ? "Conversion saved in this page draft. Publish reviews the saved version." : "This conversion is already saved in the original page draft.");
    } catch (e) { if (alive.current) setConversionError(plainError(e, "The conversion save isn't verified. Check the saved page before retrying.")); }
    finally { if (alive.current) setConversionSaving(false); }
  };
  const saveContext = async () => {
    if (legacyContext === "unselected") { setNotice("Choose the brand for this project before asking NEXUS to build."); return false; }
    if (!contextDraft || (!projectContext && !legacyContext) || contextSaving) return false;
    if (contextProjection.issues.some(issue => issue.source === "project" && issue.field && contextDraft.values[issue.field]?.trim())) { setNotice("Review the highlighted project values before saving."); return false; }
    const values = Object.fromEntries(Object.keys(contextDraft.values).map(key => [key, contextProjection.projectValues[key as keyof typeof contextDraft.values] ?? ""]));
    setContextSaving(true);
    try {
      const saved = await saveStudioProjectContext(tenantId, sessionId, { ...contextDraft, values }, projectContext ?? {});
      if (!alive.current) return false;
      setProjectContext(saved as StudioProjectContext); setContextDraft(saved as StudioProjectContext); setLegacyContext(false);
      setNotice("Project context saved. Ask NEXUS to apply it to this draft; Setup stays unchanged.");
      return true;
    } catch (e) { if (alive.current) setNotice(plainError(e, "The context save isn't verified. Check the saved project before retrying.")); return false; }
    finally { if (alive.current) setContextSaving(false); }
  };

  // EXP07 row 6 — flag this project as a workspace template (or bring it back to drafts). The
  // governed setter answers; the returned row is what changed. A refusal (not owner/admin) is a
  // sentence, never a silent no-op.
  const toggleTemplate = async () => {
    if (!session || templating) return;
    setTemplating(true);
    try {
      const next = await setSessionTemplate(sessionId, !session.isTemplate);
      setSession((s) => (s ? { ...s, isTemplate: next.isTemplate } : s));
      setNotice(next.isTemplate
        ? "Saved as a workspace template — it moved out of your drafts and now appears under “Start from a template”."
        : "Back in your drafts. It no longer appears as a template.");
    } catch (e) {
      setNotice(plainError(e, "The template change didn't save. Try again."));
    } finally {
      setTemplating(false);
    }
  };

  React.useEffect(() => {
    let live = true;
    setArtifactError(null);
    if (!activeRef) { setArtifact(null); return; }
    // Never leave the previous piece on the stage (and under Publish) while another one loads.
    setArtifact((a) => (a && artifactId(a) === activeRef.id ? a : null));
    loadArtifact(activeRef)
      .then((a) => { if (live) setArtifact(a); })
      .catch((e) => { if (live) { setArtifact(null); setArtifactError(plainError(e, "This piece couldn't be loaded.")); } });
    return () => { live = false; };
  }, [activeRef?.id, activeRef?.kind, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const receiptPageId = artifact?.kind === "page" ? artifact.page.id : null;
  React.useEffect(() => {
    let current = true;
    setPublicationReceipts(null); setReceiptUnavailable(false);
    if (!receiptPageId) return;
    void loadStudioPublicationReceipts(tenantId, sessionId, receiptPageId).then(value => { if (current) setPublicationReceipts(value); })
      .catch(() => { if (current) setReceiptUnavailable(true); });
    return () => { current = false; };
  }, [tenantId, sessionId, receiptPageId, refreshKey]);

  const chat = useStudioChat({
    sessionId,
    seedBrief,
    canvas: activeRef ? { kind: activeRef.kind, id: activeRef.id } : null,
    onArtifact: (a) => { void reloadSession(a.id); },
    // A turn can link pieces without a produced-artifact frame (a page's form, a document), so the
    // manifest is re-read after every turn as well as the stage.
    onTurnDone: () => { setRefreshKey((k) => k + 1); void reloadSession(); },
  });

  // Images Paige starts in this project run as media jobs: approvals land here, and a finished image
  // is filed onto the project by the server, so a completed job means the manifest changed.
  const media = useMediaJobs();
  const sessionJobs = React.useMemo(
    () => media.jobs.filter((j) => (j.params as Record<string, unknown> | null)?.studio_session_id === sessionId),
    [media.jobs, sessionId],
  );
  const pendingApprovals = sessionJobs.filter((j) => j.state === "blocked" && j.approval_state === "pending");
  const finishedIds = sessionJobs.filter((j) => j.state === "succeeded" && j.content_id).map((j) => String(j.content_id)).join(",");
  React.useEffect(() => {
    if (!finishedIds || !session) return;
    const missing = finishedIds.split(",").find((id) => !session.artifacts.some((r) => r.id === id));
    if (missing) void reloadSession(missing);
  }, [finishedIds, session, reloadSession]);

  // On a narrow screen the chat is a drawer: it opens whenever Paige asks something or is working,
  // so her question is never hidden behind a closed panel.
  const waitingCount = chat.confirms.filter((c) => !c.state).length;
  React.useEffect(() => { if (chat.choices || chat.sending || waitingCount) setChatOpen(true); }, [chat.choices, chat.sending, waitingCount]);
  // Opening a project puts focus in the conversation (the card that opened it is gone).
  React.useEffect(() => { if (chat.ready && !minimized) inputRef.current?.focus({ preventScroll: true }); }, [chat.ready, minimized]);

  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [chat.turns, chat.steps, chat.choices, chat.confirms.length, pendingApprovals.length]);

  // Esc steps back out of the project, unless the owner has typed something or a panel is open (each
  // panel closes itself first).
  React.useEffect(() => {
    if (minimized) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "SELECT" || t.isContentEditable)) return;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT") && (t as HTMLInputElement).value.trim()) return;
      if (publishOpen) { setPublishOpen(false); publishBtnRef.current?.focus(); return; }
      if (settingsOpen) { setSettingsOpen(false); return; }
      if (conversionOpen) { setConversionOpen(false); return; }
      if (chatOpen) { setChatOpen(false); return; }
      onBack();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onBack, publishOpen, settingsOpen, conversionOpen, chatOpen, minimized]);

  const submit = async () => {
    const text = input.trim();
    if (!text || chat.sending || !chat.ready || contextSaving || conversionSaving) return;
    if (artifact?.kind === "page" && artifact.page.updatedAt) {
      const paste = parseStudioChatConversionPaste(text);
      if (paste.matched) {
        if (paste.error) { setNotice(paste.error); return; }
        setConversionPaste({ pageId: artifact.page.id, originalText: text, sequence: ++conversionPasteSequence.current,
          input: paste.input, kind: paste.kind, mode: paste.mode });
        setConversionError(null); setConversionOpen(true);
        setNotice("Review the form or booking destination before saving it in this page draft.");
        return;
      }
    }
    if (contextDraft && (legacyContext || JSON.stringify(contextDraft) !== JSON.stringify(projectContext)) && !await saveContext()) return;
    if (!alive.current) return;
    setInput("");
    void chat.send(text);
  };
  const buildSavedBrief = async () => {
    if (!session?.seedBrief || chat.sending || !chat.ready || contextSaving || conversionSaving) return;
    if (contextDraft && (legacyContext || JSON.stringify(contextDraft) !== JSON.stringify(projectContext)) && !await saveContext()) return;
    if (alive.current) void chat.send(session.seedBrief);
  };

  // A picked version shows on the stage from its own snapshot until the owner goes back to it or
  // picks again. Forms and pages carry everything needed; other kinds say so honestly.
  const previewArtifact: LoadedArtifact | null = (() => {
    if (!previewing?.snapshot || !artifact) return null;
    if (artifact.kind === "form") return { kind: "form", form: formFromRow(previewing.snapshot) };
    if (artifact.kind === "page") return { kind: "page", page: pageFromRow(previewing.snapshot) };
    return null;
  })();

  const live = artifact ? isLive(artifact) : false;
  const pending = artifact ? hasPendingChanges(artifact) : false;
  const saveState = chat.sending ? { tone: "busy", text: chat.status ?? "NEXUS is building" }
    : !artifact ? (chat.preview ? { tone: "idle", text: chat.confirms.some((c) => !c.state) ? "Designed · waiting for your approval" : "Designed · not saved" } : { tone: "idle", text: "Nothing built yet" })
    : live ? (pending ? { tone: "good", text: "Saved · changes not live yet" } : { tone: "good", text: "Live" })
    : { tone: "good", text: "Saved · draft" };
  const publishLabel = live ? (pending ? "Publish changes" : "Live · Manage") : "Publish";
  const savedConversion = artifact?.kind === "page" ? artifact.page.blocks.find((block): block is PageConversionBlock => block.type === "conversion") : undefined;
  const savedLegacyForm = artifact?.kind === "page" && !savedConversion ? artifact.page.blocks.find(block => block.type === "embedded_form") : undefined;

  const lastAssistant = (() => { for (let i = chat.turns.length - 1; i >= 0; i--) if (chat.turns[i].role === "assistant") return i; return -1; })();

  if (sessionError) {
    return (
      <div className="vs-session" style={{ gridTemplateRows: "54px 1fr" }}>
        <div className="vs-top"><button type="button" className="vs-icon-btn" aria-label="Back to Studio" onClick={onBack}><ArrowLeft size={17} /></button></div>
        <div className="vs-stage-empty" role="alert"><b>This project couldn't be opened</b>{sessionError}</div>
      </div>
    );
  }

  return (
    <div className="vs-session">
      <header className="vs-top">
        <button type="button" className="vs-icon-btn" aria-label="Back to Studio" onClick={onBack}><ArrowLeft size={17} /></button>
        <NexusIdentity compact />
        <button type="button" className="vs-btn vs-chat-toggle" aria-expanded={chatOpen} onClick={() => setChatOpen((o) => !o)}><MessageSquare size={15} aria-hidden="true" />{chatOpen ? "Hide chat" : "Chat"}</button>
        <nav className="vs-crumbs" aria-label="Project">
          <div className="vs-project-heading">
            <b className="vs-trunc vs-project-title" title={displayTitle}>{displayTitle}</b>
            <span className="vs-status" data-tone={saveState.tone} role="status" aria-live="polite">{saveState.text}</span>
          </div>
          {refs.length > 1 && (
            <select aria-label="Piece in this project" value={activeRef?.id ?? ""} onChange={(e) => setActiveId(e.target.value)}>
              {refs.map((r) => <option key={r.id} value={r.id}>{r.title} · {KIND_WORD[r.kind]}</option>)}
            </select>
          )}
        </nav>
        {onMinimize && <button type="button" className="vs-icon-btn" aria-label="Minimize Studio" title="Minimize Studio" onClick={onMinimize}><Minimize2 size={16} aria-hidden="true" /></button>}
        <div className="vs-top-actions">
          {session && (
            <button
              type="button"
              className="vs-btn"
              aria-pressed={session.isTemplate}
              disabled={templating}
              title={session.isTemplate ? "This project is a workspace template. Click to bring it back to your drafts." : "Save this project as a template your whole workspace can start from."}
              onClick={() => void toggleTemplate()}
            >
              {templating ? "Saving…" : session.isTemplate ? "Saved as template" : "Save as template"}
            </button>
          )}
          {artifact?.kind === "form" && (
            <button type="button" className="vs-btn" aria-pressed={settingsOpen} onClick={() => setSettingsOpen((o) => !o)}><SlidersHorizontal size={14} />Form settings</button>
          )}
          {artifact?.kind === "page" && <button type="button" className="vs-btn" aria-pressed={conversionOpen} disabled={chat.sending || !artifact.page.updatedAt} onClick={() => { setConversionPaste(null); setConversionOpen(value => !value); }}><SlidersHorizontal size={14} aria-hidden="true" />Form or booking</button>}
          <div className="vs-seg" role="group" aria-label="Preview size">
            <button type="button" aria-pressed={device === "desktop"} aria-label="Desktop" onClick={() => setDevice("desktop")}><Monitor size={14} /></button>
            <button type="button" aria-pressed={device === "phone"} aria-label="Phone" onClick={() => setDevice("phone")}><Smartphone size={14} /></button>
          </div>
          <button
            ref={publishBtnRef}
            type="button"
            className={live && !pending ? "vs-btn" : "vs-btn vs-btn-gold"}
            disabled={!artifact || chat.sending}
            aria-expanded={publishOpen}
            aria-haspopup="dialog"
            onClick={() => setPublishOpen((o) => !o)}
          >
            {live && !pending && <Check size={14} />}{publishLabel}
          </button>
        </div>
        {publishOpen && artifact && (
          <PublishPanel
            // A different piece is a different door preparation: never carry a fingerprint across.
            key={`${artifact.kind}:${artifactId(artifact)}`}
            tenantSlug={tenantSlug}
            tenantName={brand.name}
            brandFloor={brand.floor}
            artifact={artifact}
            minimized={minimized}
            onNexusHandoff={onNexusHandoff}
            onClose={() => { setPublishOpen(false); publishBtnRef.current?.focus(); }}
            onDone={(m) => { setNotice(m); setRefreshKey((k) => k + 1); }}
            onRefresh={() => setRefreshKey((k) => k + 1)}
          />
        )}
      </header>

      <div className="vs-body">
        <section className="vs-chat" aria-label="Chat with NEXUS" data-open={chatOpen}>
          <div className="vs-chat-context">
          {/* The brief the project started from, pinned above the conversation so it survives reopen
              (EXP07 row 1): the chat's first message already carries it, but nothing showed it after
              that. Open when the project opens; the owner's own toggle always wins. */}
          {session?.seedBrief && (
            <details className="vs-brief-card" open={briefOpen} onToggle={(e) => setBriefOpen(e.currentTarget.open)}>
              <summary><ChevronRight className="vs-brief-chevron" size={14} aria-hidden="true" />The brief</summary>
              <MarkdownMessage content={session.seedBrief} className="vs-md" />
            </details>
          )}
          {contextDraft && <div className="vs-project-context-editor">
            <StudioBusinessContextPanel projection={contextProjection} projectValues={contextDraft.values} disabled={contextSaving || chat.sending}
              businessSelection={<StudioBusinessSelector tenantId={tenantId} target={contextDraft.target} selected={contextDraft.business_source} disabled={contextSaving || chat.sending} onSelect={business => {
                setContextDraft(value => value ? applyStudioBusinessSelection(value, business, crypto.randomUUID()) : value);
              }} />}
              onChange={values => setContextDraft(value => value ? { ...value, values } : value)}
              onTargetChange={kind => { if (legacyContext) setLegacyContext("chosen"); setContextDraft(value => {
                if (!value) return value;
                if (value.target.kind === kind && legacyContext !== "unselected") return value;
                const { business_source: _previous, ...rest } = value;
                return { ...rest, target: kind === "workspace" ? { kind } : { kind, reference: crypto.randomUUID() }, values: {} };
              }); }} />
            {legacyContext === "unselected" && <p className="vs-inspector-note">Choose the brand for this project before asking NEXUS to build. Your saved work is available.</p>}
            {(legacyContext || JSON.stringify(contextDraft) !== JSON.stringify(projectContext)) && <button type="button" className="vs-btn" disabled={contextSaving || chat.sending || legacyContext === "unselected"} onClick={() => void saveContext()}>{contextSaving ? "Saving context…" : "Save project context"}</button>}
          </div>}
          {session && (
            <p className="vs-brand-line">
              <b>{projectContext?.target.kind === "workspace" ? "Working from your brand" : "Selected project brand"}</b>
              {brand.logoUrl && <img className="vs-brand-logo" src={brand.logoUrl} alt="" loading="lazy" />}
              <span>
                {brand.name ? brand.name : projectContext?.target.kind === "workspace" ? "No business name yet — add it in Setup" : "Business name not provided"}
                {" · "}
                {brand.primaryColor
                  ? <><i className="vs-brand-swatch" style={{ background: brand.primaryColor }} aria-hidden="true" />your page color</>
                  : "No saved page color"}
                {!brand.logoUrl && " · no logo yet — pages use your name and color"}
              </span>
            </p>
          )}
          </div>
          <div className="vs-chat-log" ref={logRef}>
            {chat.loadError && <p className="vs-alert" role="alert">{chat.loadError}</p>}
            {!chat.ready && !chat.loadError && <p className="vs-inspector-note" role="status">Opening the conversation…</p>}
            {chat.ready && chat.turns.length === 0 && !chat.sending && <div className="vs-nexus-arrival" data-arrival={arrivalMotion ? "new" : undefined} onAnimationEnd={() => setArrivalMotion(false)}>
              <NexusGlyph /><p>NEXUS is ready{session?.seedBrief ? " with your saved brief" : ""}.</p>
              {!seedBrief && session?.seedBrief && refs.length === 0 && <button type="button" className="vs-btn vs-btn-violet" disabled={contextSaving || conversionSaving} onClick={() => void buildSavedBrief()}>Build from saved brief</button>}
            </div>}
            {chat.turns.map((t, i) => t.role === "user" ? (
              <div key={i} className="vs-msg-you">{t.content}</div>
            ) : (
              <div key={i}>
                {(t.content || (i === lastAssistant && chat.sending && chat.steps.length === 0)) && (
                  <div className="vs-msg-paige">
                    <NexusGlyph />
                    {t.content ? <MarkdownMessage content={t.content} className="vs-md" /> : <p>{chat.status ?? "Working on it…"}</p>}
                  </div>
                )}
                {i === lastAssistant && chat.steps.length > 0 && (
                  <ol className="vs-steps" aria-label="What NEXUS did">
                    {chat.steps.map((s) => (
                      <li key={s.id} data-status={s.status}>
                        {s.status === "error" ? <AlertCircle size={14} color="var(--vs-bad)" aria-label="Didn't work" />
                          // Under way: a spinner when motion is welcome, a still ring when it is not (studio.css).
                          : s.status === "running" ? (
                            <span className="vs-step-busy" role="img" aria-label="Working on it">
                              <Loader2 size={14} className="vs-step-spin" aria-hidden />
                              <Circle size={14} className="vs-step-still" aria-hidden />
                            </span>
                          )
                          : <Check size={14} color="var(--vs-good)" aria-label="Done" />}
                        <span>{s.label}{s.detail && <small>{s.detail}</small>}</span>
                        <time>{new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
            {chat.choices && <AskCard choices={chat.choices} disabled={chat.sending} onAnswer={(v, d) => void chat.send(v, { display: d })} />}
            {chat.confirms.map((c) => (
              <div key={c.fingerprint} className="vs-confirm" data-state={c.state ?? "waiting"} role="group" aria-label={c.state ? "Your decision" : "NEXUS is waiting for your approval"}>
                <b>{!c.state ? "Waiting for your approval" : c.state === "declined" ? "Skipped" : c.state === "sent" ? "Approved" : c.state === "ran" ? "Done" : c.state === "not_run" ? "Didn't run" : "Not confirmed"}</b>
                <span>{c.summary}</span>
                {!c.state ? (
                  <div className="vs-confirm-actions">
                    <button type="button" className="vs-btn vs-btn-violet" disabled={chat.sending} onClick={() => void chat.decide(c.fingerprint, true)}>Approve</button>
                    <button type="button" className="vs-btn vs-btn-quiet" disabled={chat.sending} onClick={() => void chat.decide(c.fingerprint, false)}>Not this</button>
                  </div>
                ) : c.state === "sent" ? (
                  <small role="status">NEXUS is running it…</small>
                ) : c.note ? <small role="status">{c.note}</small> : null}
              </div>
            ))}
            {pendingApprovals.map((job) => <MediaApprovalCard key={job.id} job={job} media={media} />)}
            {chat.sendError && <p className="vs-alert" role="alert">{chat.sendError}</p>}
            {media.actionError && pendingApprovals.length > 0 && <p className="vs-alert" role="alert">{media.actionError}</p>}
          </div>
          <div className="vs-chat-input">
            <div className="vs-chat-box">
              <label className="vs-sr" htmlFor="vs-chat-input">Tell NEXUS what to change</label>
              <textarea
                id="vs-chat-input"
                ref={inputRef}
                value={input}
                placeholder={chat.choices ? "Answer above, or type here" : artifact ? "Tell NEXUS what to change" : "Tell NEXUS what to build"}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              />
              <button type="button" className="vs-send" aria-label="Send" disabled={!input.trim() || chat.sending || !chat.ready || contextSaving || conversionSaving} onClick={() => void submit()}><ArrowUp size={16} /></button>
            </div>
          </div>
        </section>

        <div className="vs-stage-wrap">
          <div className="vs-stage" role="region" aria-label="Stage">
            {notice && !publishOpen && (
              <p role="status" className="vs-notice">{notice} <button type="button" className="vs-link" onClick={() => setNotice(null)}>Dismiss</button></p>
            )}
            {previewing && (
              <p role="status" className="vs-notice vs-notice-preview">
                {previewArtifact ? `Showing version ${previewing.versionNo}. Your working copy is unchanged.` : `Version ${previewing.versionNo} can't be shown here, but going back restores it.`}
              </p>
            )}
            {artifactError ? (
              <div className="vs-stage-empty" role="alert"><b>This piece couldn't be loaded</b>{artifactError}</div>
            ) : (
              <StudioStage
                artifact={previewArtifact ?? artifact} brand={brand} device={device} tenantId={tenantId}
                building={chat.sending && !previewing} steps={chat.steps} status={chat.status}
                preview={previewing ? null : chat.preview} waitingApproval={chat.confirms.some((c) => !c.state)}
              />
            )}
          </div>
          {settingsOpen && artifact?.kind === "form" && (
            <FormSettings tenantId={tenantId} formId={artifact.form.id} onClose={() => setSettingsOpen(false)} onSaved={() => setRefreshKey((k) => k + 1)} />
          )}
          {conversionOpen && artifact?.kind === "page" && <PageConversionSettings key={`${tenantId}:${artifact.page.id}:${conversionPaste?.pageId === artifact.page.id ? conversionPaste.sequence : "saved"}`}
            value={savedConversion} legacyForm={savedLegacyForm?.type === "embedded_form" ? { slug: savedLegacyForm.form_slug, title: savedLegacyForm.title } : undefined}
            paste={conversionPaste?.pageId === artifact.page.id ? conversionPaste : undefined}
            forms={conversionResources?.forms ?? []} bookingLinks={conversionResources?.bookingLinks ?? []}
            formsStatus={conversionResources?.formsStatus ?? "loading"} bookingLinksStatus={conversionResources?.bookingLinksStatus ?? "loading"}
            saving={conversionSaving} disabled={chat.sending} error={conversionError} onSave={saveConversion} onClose={() => { setConversionPaste(null); setConversionOpen(false); }} />}
          {artifact?.kind === "page" && <details className="vs-publication-receipts">
            <summary>Publication receipts{publicationReceipts?.length ? ` · ${publicationReceipts.length}` : ""}</summary>
            {receiptUnavailable ? <p role="status">Receipts are unavailable right now. This does not change the page’s published state.</p>
              : publicationReceipts === null ? <p role="status">Reading original receipts…</p>
                : publicationReceipts.length === 0 ? <p>No publication receipt is recorded for this page.</p>
                  : <ol>{publicationReceipts.map(receipt => <li key={receipt.id}><b>{receipt.action === "publish" ? "Publish" : "Take offline"} · {receipt.outcome}</b><time dateTime={receipt.occurredAt}>{new Date(receipt.occurredAt).toLocaleString()}</time><code>{receipt.id}</code></li>)}</ol>}
          </details>}
        </div>
      </div>

      <Timeline
        sessionId={sessionId}
        target={activeRef ? { kind: activeRef.kind, id: activeRef.id } : null}
        refreshKey={refreshKey}
        building={chat.sending ? (chat.status ?? "Working on it") : null}
        onRestored={(m) => { setPreviewing(null); setNotice(m); setRefreshKey((k) => k + 1); }}
        onPreview={setPreviewing}
      />
    </div>
  );
}
